//! Live captions from whatever the PC plays (ISL-002 on Windows): a WASAPI
//! shared-mode LOOPBACK capture of the default render endpoint, cut into ~4 s
//! windows (`poni_core::capture`) and posted to the engine's `/draft`. The
//! engine keeps the line for `GET /live`, which the helper link already reads
//! for the Live page and the collapsed pill.
//!
//! Two threads, nothing in COM callbacks. `poni-capture` (MTA) owns the
//! device: it polls the capture client every 50 ms (that wait doubles as the
//! stop signal) and hands finished windows to `poni-capture-post`, which keeps
//! one request in flight. When the engine is slower than the audio, the slot
//! holds only the newest window (shortcut: older audio is dropped, so a slow
//! engine skips stretches instead of falling further behind; upgrade to a
//! queue only if skipped speech becomes a complaint).
//!
//! Only what the PC plays is captured, not the microphone.

use crate::events::{AppEvent, EventSink};
use crate::services::audio::{device_id, ComApartment};
use poni_core::capture::{pcm_bytes, CaptureState, Pipeline};
use poni_core::helper;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};

/// `AUDCLNT_STREAMFLAGS_LOOPBACK`: capture what the endpoint renders.
const LOOPBACK: u32 = 0x0002_0000;
/// A 1 s device buffer (100 ns units): we drain every 50 ms, so it never fills.
const BUFFER_100NS: i64 = 10_000_000;
const POLL: Duration = Duration::from_millis(50);
const RETRY: Duration = Duration::from_millis(1500);
/// How often the default output device is compared with the one captured.
const DEVICE_CHECK: Duration = Duration::from_secs(2);
const STOP_TIMEOUT: Duration = Duration::from_millis(800);

/// What a captioning session heard, kept for the meeting saved when it stops. It outlives a
/// restart (a language change) and is emptied by [`Log::take`]; times count from the first start.
#[derive(Default)]
pub struct Log {
    start: Option<Instant>,
    lines: Vec<helper::Line>,
}

pub type SessionLog = Arc<Mutex<Log>>;

impl Log {
    /// A capture starts: a session with no lines yet begins its clock now.
    pub fn begin(&mut self) {
        if self.lines.is_empty() {
            self.start = Some(Instant::now());
        }
    }

    fn push(&mut self, source: String, translation: String) {
        let end = self.start.get_or_insert_with(Instant::now).elapsed().as_secs_f64();
        self.lines.push(helper::Line { t0: (end - poni_core::capture::WINDOW_S as f64).max(0.0), t1: end, source, translation });
    }

    pub fn take(&mut self) -> Vec<helper::Line> {
        std::mem::take(&mut self.lines)
    }

    /// Lines whose save failed go back in front of what came since.
    pub fn restore(&mut self, mut lines: Vec<helper::Line>) {
        lines.append(&mut self.lines);
        self.lines = lines;
    }
}

/// Everything a Stop needs to save the session as a meeting.
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub date: String,
    pub start: String,
    pub locale: String,
    pub lines: Vec<helper::Line>,
}

/// Save a session as a meeting: the engine drafts the summary, decisions and actions (best effort,
/// the transcript is kept without them), then keeps the document. `Err` returns the lines.
pub fn save_meeting(port: u16, m: Meeting) -> Result<String, (String, Vec<helper::Line>)> {
    use poni_core::meeting_doc::{generate_body, generated_note, meeting_doc};
    let draft = helper::request(port, "POST", "/notes/generate", Some(&generate_body(&m.title, &m.lines))).ok().filter(|(c, _)| *c == 200).and_then(|(_, b)| generated_note(&b));
    let Some(doc) = meeting_doc(&m.id, &m.title, &m.date, &m.start, &m.locale, &m.lines, draft.as_ref()) else { return Err(("Nothing was heard.".into(), Vec::new())) };
    match helper::post_note(port, &doc.to_string()) {
        Ok(()) => Ok(m.id),
        Err(e) => Err((e, m.lines)),
    }
}

pub enum CaptureEvent {
    /// The state changed (only sent on a change).
    State(CaptureState),
    /// The engine heard words: ask the helper link for the line now.
    Heard,
}

pub struct CaptureService {
    tx: Sender<()>,
    done: Receiver<()>,
    thread: Option<JoinHandle<()>>,
    health: Arc<Health>,
}

impl CaptureService {
    /// Start capturing; `src`/`tgt` are the engine's language codes (`auto` detects).
    pub fn start(sink: EventSink, port: u16, src: String, tgt: String, log: SessionLog) -> std::io::Result<Self> {
        let health = Arc::new(Health { sink: sink.clone(), st: Mutex::new(HealthState { sent: Some(CaptureState::On), ..Default::default() }) });
        let slot: Arc<Mutex<Option<Vec<f32>>>> = Arc::default();
        let (wake_tx, wake_rx) = channel::<()>();
        let (tx, rx) = channel::<()>();
        let (done_tx, done) = channel::<()>();

        let (h, s) = (health.clone(), slot.clone());
        std::thread::Builder::new().name("poni-capture-post".into()).spawn(move || post_loop(port, &src, &tgt, wake_rx, s, h, log))?;
        let h = health.clone();
        let thread = std::thread::Builder::new().name("poni-capture".into()).spawn(move || {
            capture_loop(rx, h, slot, wake_tx);
            let _ = done_tx.send(());
        })?;
        Ok(Self { tx, done, thread: Some(thread), health })
    }
}

impl Drop for CaptureService {
    fn drop(&mut self) {
        // After this no event leaves: the UI has already said Off.
        self.health.silence();
        let _ = self.tx.send(());
        let Some(thread) = self.thread.take() else { return };
        match self.done.recv_timeout(STOP_TIMEOUT) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => {
                let _ = thread.join();
            }
            Err(RecvTimeoutError::Timeout) => crate::pwarn!("capture: worker did not stop in time; detaching it"),
        }
        // The post thread ends by itself once its request (at most 25 s) returns:
        // the capture thread's sender is gone. Not joined, so Stop never waits on a model.
    }
}

// ---------------------------------------------------------------------------
// What the person is told: the device's trouble, the engine's, or a stop.

#[derive(Default)]
struct HealthState {
    device: Option<String>,
    engine: Option<String>,
    failed: Option<String>,
    sent: Option<CaptureState>,
    silenced: bool,
}

struct Health {
    sink: EventSink,
    st: Mutex<HealthState>,
}

impl Health {
    fn update(&self, f: impl FnOnce(&mut HealthState)) {
        let mut s = self.st.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut s);
        let now = match (&s.failed, &s.device, &s.engine) {
            (Some(m), _, _) => CaptureState::Failed(m.clone()),
            (_, Some(m), _) | (_, _, Some(m)) => CaptureState::Warn(m.clone()),
            _ => CaptureState::On,
        };
        if !s.silenced && s.sent.as_ref() != Some(&now) {
            s.sent = Some(now.clone());
            self.sink.send(AppEvent::Capture(CaptureEvent::State(now)));
        }
    }

    fn device(&self, why: Option<String>) {
        self.update(|s| s.device = why);
    }

    fn engine(&self, why: Option<String>) {
        self.update(|s| s.engine = why);
    }

    fn fail(&self, why: String) {
        self.update(|s| s.failed = Some(why));
    }

    fn silence(&self) {
        self.st.lock().unwrap_or_else(|e| e.into_inner()).silenced = true;
    }

    fn heard(&self) {
        if !self.st.lock().unwrap_or_else(|e| e.into_inner()).silenced {
            self.sink.send(AppEvent::Capture(CaptureEvent::Heard));
        }
    }
}

// ---------------------------------------------------------------------------
// The poster: one request in flight, newest window wins.

fn post_loop(port: u16, src: &str, tgt: &str, wake: Receiver<()>, slot: Arc<Mutex<Option<Vec<f32>>>>, health: Arc<Health>, log: SessionLog) {
    // A model that is not on disk would be downloaded by the first /draft, silently and for minutes
    // (the speech model always; the translation one for a target other than English); the island
    // says so and waits for the download Settings offers instead.
    let (mut speech, mut translation) = (Gate::default(), Gate::default());
    let needs_translation = poni_core::capture::needs_translation_model(src, tgt);
    while wake.recv().is_ok() {
        let Some(window) = slot.lock().unwrap_or_else(|e| e.into_inner()).take() else { continue };
        if !speech.open(|| speech_on_disk(port)) {
            health.engine(Some(poni_core::capture::SPEECH_MISSING.into()));
            continue;
        }
        if needs_translation && !translation.open(|| translation_on_disk(port)) {
            health.engine(Some(poni_core::capture::TRANSLATION_MISSING.into()));
            continue;
        }
        match helper::post_draft(port, src, tgt, &pcm_bytes(&window)) {
            Ok(d) => {
                health.engine(None);
                if !d.source.is_empty() {
                    log.lock().unwrap_or_else(|e| e.into_inner()).push(d.source, d.translation);
                    health.heard();
                }
            }
            Err(e) => {
                crate::pinfo!("capture: /draft failed: {e}");
                (speech.ok, translation.ok) = (false, false);
                // A request that got no answer in its 25 s while /health still answers is a model loading.
                // (On Windows a read timeout reads "os error 10060", so the test is `engine_unreachable`.)
                let loading = engine_unreachable(&e).then(|| helper::request(port, "GET", "/health", None).ok()).flatten().filter(|(c, _)| *c == 200).and_then(|(_, b)| poni_core::capture::loading_notice(&b, src != tgt));
                health.engine(Some(loading.unwrap_or_else(|| engine_problem(&e))));
            }
        }
    }
}

/// Whether windows may go to the engine for one model: once the model is known to be there, no more
/// asking until a request fails; while it is not, asked again at most every 2 s.
#[derive(Default)]
struct Gate {
    ok: bool,
    checked: Option<Instant>,
}

impl Gate {
    /// `check`: `Some(false)` = the engine says the model is not on disk; `None` = it does not say.
    fn open(&mut self, check: impl FnOnce() -> Option<bool>) -> bool {
        if !self.ok && self.checked.is_none_or(|t| t.elapsed() > Duration::from_secs(2)) {
            self.checked = Some(Instant::now());
            self.ok = check() != Some(false);
        }
        self.ok
    }
}

/// A 200 body from the engine, `None` when it does not answer (the /draft then reports what is wrong).
fn engine_body(port: u16, path: &str) -> Option<String> {
    helper::request(port, "GET", path, None).ok().filter(|(c, _)| *c == 200).map(|(_, b)| b)
}

fn speech_on_disk(port: u16) -> Option<bool> {
    poni_core::models::speech_on_disk(&engine_body(port, "/health")?, || engine_body(port, "/models"))
}

pub(crate) fn translation_on_disk(port: u16) -> Option<bool> {
    poni_core::models::translation_on_disk(&engine_body(port, "/health")?, || engine_body(port, "/models"))
}

/// The error came from the connection (refused, no answer in time), not from the engine's reply.
fn engine_unreachable(e: &str) -> bool {
    e.contains("os error") || e.contains("timed out") || e.contains("no response")
}

/// A connection error is "not running"; anything else is the engine's own sentence.
fn engine_problem(e: &str) -> String {
    if engine_unreachable(e) {
        "The engine is not answering. Captions resume when it is back.".into()
    } else {
        format!("The engine could not caption this audio: {e}")
    }
}

// ---------------------------------------------------------------------------
// The capture thread.

/// Why a device could not be opened: `fatal` ends the capture, else it is tried again.
struct OpenError {
    fatal: bool,
    why: String,
}

fn retry(why: impl Into<String>) -> OpenError {
    OpenError { fatal: false, why: why.into() }
}

struct Session {
    id: String,
    client: IAudioClient,
    capture: IAudioCaptureClient,
    pipeline: Pipeline,
    channels: usize,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = unsafe { self.client.Stop() };
    }
}

impl Session {
    fn open(enumerator: &IMMDeviceEnumerator) -> Result<Session, OpenError> {
        let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }.map_err(|_| retry("No audio output device. Captions resume when one is available."))?;
        let id = device_id(&device);
        let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(|e| retry(format!("The output device could not be opened ({e}).")))?;
        let fmt = unsafe { client.GetMixFormat() }.map_err(|e| retry(format!("The output device's format could not be read ({e}).")))?;
        // The mix format is CoTaskMem: free it once, after Initialize has read it.
        let (rate, channels, float) = unsafe { describe(fmt) };
        let init = if float { unsafe { client.Initialize(AUDCLNT_SHAREMODE_SHARED, LOOPBACK, BUFFER_100NS, 0, fmt, None) } } else { Ok(()) };
        unsafe { CoTaskMemFree(Some(fmt as *const _)) };
        if !float {
            return Err(OpenError { fatal: true, why: "The output device mixes audio in a format captions cannot read (needs 32-bit float).".into() });
        }
        init.map_err(|e| retry(format!("Capturing the output device failed ({e}).")))?;
        let capture: IAudioCaptureClient = unsafe { client.GetService() }.map_err(|e| retry(format!("Capturing the output device failed ({e}).")))?;
        unsafe { client.Start() }.map_err(|e| retry(format!("Capturing the output device failed ({e}).")))?;
        Ok(Session { id, client, capture, pipeline: Pipeline::new(rate, channels), channels })
    }

    /// Read every packet that is waiting; each finished window goes to `out`.
    fn drain(&mut self, mut out: impl FnMut(Vec<f32>)) -> windows::core::Result<()> {
        loop {
            if unsafe { self.capture.GetNextPacketSize()? } == 0 {
                return Ok(());
            }
            let (mut data, mut frames, mut flags) = (std::ptr::null_mut::<u8>(), 0u32, 0u32);
            unsafe { self.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)? };
            let n = frames as usize * self.channels;
            let samples: Vec<f32> = if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                vec![0.0; n]
            } else {
                // SAFETY: WASAPI returns `frames` frames of the mix format (checked as f32); the
                // buffer is valid until ReleaseBuffer, and the bytes are copied before it.
                unsafe { std::slice::from_raw_parts(data as *const f32, n) }.to_vec()
            };
            unsafe { self.capture.ReleaseBuffer(frames)? };
            for w in self.pipeline.feed(&samples) {
                out(w);
            }
        }
    }
}

/// (rate, channels, is 32-bit float) of a mix format.
///
/// # Safety
/// `fmt` must be a valid WAVEFORMATEX (or the larger EXTENSIBLE one it says it is).
unsafe fn describe(fmt: *const WAVEFORMATEX) -> (u32, usize, bool) {
    const TAG_FLOAT: u16 = 3;
    const TAG_EXTENSIBLE: u16 = 0xFFFE;
    let f = std::ptr::read_unaligned(fmt);
    let float = f.wBitsPerSample == 32
        && match f.wFormatTag {
            TAG_FLOAT => true,
            // The sub-format GUID of IEEE float is {00000003-0000-0010-8000-00aa00389b71}.
            TAG_EXTENSIBLE => std::ptr::read_unaligned(fmt as *const WAVEFORMATEXTENSIBLE).SubFormat.data1 == 3,
            _ => false,
        };
    (f.nSamplesPerSec, f.nChannels.max(1) as usize, float)
}

fn capture_loop(stop: Receiver<()>, health: Arc<Health>, slot: Arc<Mutex<Option<Vec<f32>>>>, wake: Sender<()>) {
    let com = ComApartment::enter_mta();
    if !com.initialized {
        health.fail("Windows audio could not be started on this thread.".into());
        return;
    }
    let enumerator: IMMDeviceEnumerator = match unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) } {
        Ok(e) => e,
        Err(e) => {
            health.fail(format!("Windows audio is not available ({e})."));
            return;
        }
    };
    let stopped = AtomicBool::new(false);
    // The wait between polls is also where a stop arrives.
    let nap = |d: Duration| match stop.recv_timeout(d) {
        Err(RecvTimeoutError::Timeout) => {}
        _ => stopped.store(true, Ordering::Relaxed),
    };
    let mut session: Option<Session> = None;
    let mut checked = Instant::now();
    while !stopped.load(Ordering::Relaxed) {
        let Some(s) = session.as_mut() else {
            match Session::open(&enumerator) {
                Ok(s) => {
                    health.device(None);
                    checked = Instant::now();
                    session = Some(s);
                }
                Err(e) if e.fatal => return health.fail(e.why),
                Err(e) => {
                    health.device(Some(e.why));
                    nap(RETRY);
                }
            }
            continue;
        };
        let drained = s.drain(|w| {
            // Newest wins: an older window the poster has not taken is dropped.
            *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(w);
            let _ = wake.send(());
        });
        let mut lost = drained.err().map(|e| format!("The output device went away ({e}). Reconnecting."));
        if lost.is_none() && checked.elapsed() >= DEVICE_CHECK {
            checked = Instant::now();
            let now = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }.map(|d| device_id(&d)).unwrap_or_default();
            if now != s.id {
                lost = Some("The default output device changed. Reconnecting.".into());
            }
        }
        if let Some(why) = lost {
            crate::pinfo!("capture: {why}");
            health.device(Some(why));
            session = None;
            continue;
        }
        nap(POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_session_log_keeps_lines_in_order_and_gives_failed_ones_back_in_front() {
        let mut log = Log::default();
        log.begin();
        log.push("line one".into(), "linie eins".into());
        log.push("line two".into(), String::new());
        assert!(log.lines[1].t1 >= log.lines[0].t1 && log.lines[0].t0 >= 0.0 && log.lines[0].t0 <= log.lines[0].t1);
        let taken = log.take();
        assert_eq!((taken.len(), log.lines.len()), (2, 0));
        // A restart while lines wait does not reset the clock; a save that failed returns its lines first.
        log.push("line three".into(), String::new());
        log.restore(taken);
        let sources: Vec<_> = log.lines.iter().map(|l| l.source.as_str()).collect();
        assert_eq!(sources, ["line one", "line two", "line three"]);
    }

    #[test]
    fn a_missing_model_closes_the_gate_and_is_not_asked_about_every_window() {
        let mut g = Gate::default();
        assert!(!g.open(|| Some(false)), "the engine says the model is not on disk");
        assert!(!g.open(|| panic!("asked again within 2 s")));
        // An engine that does not say is not a missing model: /draft reports what is wrong.
        let mut g = Gate::default();
        assert!(g.open(|| None));
        assert!(g.open(|| panic!("a model known to be there is not asked about again")));
    }

    #[test]
    fn a_dead_engine_and_an_engine_error_read_differently() {
        assert!(engine_problem("No connection could be made (os error 10061)").contains("not answering"));
        assert!(engine_problem("Error: model missing").contains("model missing"));
    }

    #[test]
    fn only_32_bit_float_mix_formats_are_read() {
        let fmt = |tag: u16, bits: u16| WAVEFORMATEX { wFormatTag: tag, nChannels: 2, nSamplesPerSec: 48_000, wBitsPerSample: bits, ..Default::default() };
        assert_eq!(unsafe { describe(&fmt(3, 32)) }, (48_000, 2, true));
        assert!(!unsafe { describe(&fmt(1, 16)) }.2, "16-bit PCM is refused");
        assert!(!unsafe { describe(&fmt(3, 64)) }.2);
    }

    /// Real hardware, real engine: play speech on this PC, point `PONI_TEST_ENGINE_PORT`
    /// at a running engine, run with `--ignored --nocapture`. Prints what `/live` holds after 40 s.
    #[test]
    #[ignore = "needs a running engine and speech playing on this PC"]
    fn what_this_pc_plays_reaches_the_engine_as_a_caption() {
        let port: u16 = std::env::var("PONI_TEST_ENGINE_PORT").expect("PONI_TEST_ENGINE_PORT").parse().unwrap();
        let (tx, rx) = channel();
        let sink = EventSink::new(tx, crate::events::SendHwnd::new(windows::Win32::Foundation::HWND::default()));
        let svc = CaptureService::start(sink, port, "auto".into(), "en".into(), Default::default()).unwrap();
        let t0 = std::time::Instant::now();
        let (mut heard, mut states) = (0, Vec::new());
        while t0.elapsed() < Duration::from_secs(40) {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(crate::events::AppEvent::Capture(CaptureEvent::Heard)) => {
                    heard += 1;
                    eprintln!("{:>4.1}s heard", t0.elapsed().as_secs_f32());
                }
                Ok(crate::events::AppEvent::Capture(CaptureEvent::State(s))) => states.push(format!("{s:?}")),
                _ => {}
            }
        }
        drop(svc);
        let live = helper::request(port, "GET", "/live", None);
        eprintln!("heard {heard} times; states {states:?}; /live {live:?}");
        assert!(heard > 0, "the engine never returned a caption");
    }

    /// The real default output device, if there is one: opens a loopback session and reads nothing but silence.
    #[test]
    fn a_loopback_session_opens_on_this_pcs_default_output() {
        let com = ComApartment::enter_mta();
        assert!(com.initialized);
        let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.unwrap();
        match Session::open(&enumerator) {
            Ok(mut s) => {
                s.drain(|_| {}).expect("drain");
            }
            Err(e) => eprintln!("no loopback here ({}): {}", if e.fatal { "fatal" } else { "retry" }, e.why),
        }
    }
}

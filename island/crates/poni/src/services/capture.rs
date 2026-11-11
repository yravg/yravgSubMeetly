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
//! What it reads is the Live source (PMM-019): the PC's sound (loopback), a microphone (the room
//! around the laptop, capture endpoint chosen in Settings or Windows' default), or both, mixed into
//! one window tagged with the louder side (PMM-021, `poni_core::capture::Mixer`).

use crate::events::EventSink;
use crate::services::audio::{device_id, ComApartment};
use poni_core::capture::{Mixer, Pipeline, Source};
use poni_core::helper;
use poni_core::utterance::{Latency, Utterances};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};

// The platform-independent half (the session's log, the poster, what the person is told) is shared with
// the Mac app: services/capture_core.rs.
pub use super::capture_core::*;

/// `AUDCLNT_STREAMFLAGS_LOOPBACK`: capture what the endpoint renders.
const LOOPBACK: u32 = 0x0002_0000;
/// A 1 s device buffer (100 ns units): we drain every 50 ms, so it never fills.
const BUFFER_100NS: i64 = 10_000_000;
/// How often the default output device is compared with the one captured.
const DEVICE_CHECK: Duration = Duration::from_secs(2);

impl CaptureService {
    /// Start capturing `source` (`mic`: a capture endpoint id, empty for Windows' default);
    /// `src`/`tgt` are the engine's language codes (`auto` detects).
    pub fn start(sink: EventSink, port: u16, src: String, tgt: String, log: SessionLog, source: Source, mic: String, latency: Latency) -> std::io::Result<Self> {
        // The mic first: with Both it sets the pace of the mix.
        let flows: Vec<Flow> = [source.room().then_some(Flow::Mic(mic)), source.pc().then_some(Flow::Pc)].into_iter().flatten().collect();
        Self::spawn(sink, port, src, tgt, log, latency, move |c| capture_loop(c.stop, c.health, c.slot, c.wake, flows, c.level, c.latency))
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

/// One device the capture reads: what the PC plays (loopback of the default output) or a
/// microphone (a capture endpoint id, empty for Windows' default).
enum Flow {
    Pc,
    Mic(String),
}

impl Flow {
    fn device(&self, en: &IMMDeviceEnumerator) -> windows::core::Result<IMMDevice> {
        match self {
            Flow::Pc => unsafe { en.GetDefaultAudioEndpoint(eRender, eConsole) },
            Flow::Mic(id) if id.is_empty() => unsafe { en.GetDefaultAudioEndpoint(eCapture, eConsole) },
            Flow::Mic(id) => unsafe { en.GetDevice(&windows::core::HSTRING::from(id.as_str())) },
        }
    }

    /// It reads Windows' default device, which can change under it.
    fn follows_default(&self) -> bool {
        !matches!(self, Flow::Mic(id) if !id.is_empty())
    }

    fn what(&self) -> &'static str {
        match self {
            Flow::Pc => "output device",
            Flow::Mic(_) => "microphone",
        }
    }

    /// Why opening failed, in words: a blocked or held microphone says so plainly (PMM-019).
    fn failed(&self, step: &str, e: windows::core::Error) -> OpenError {
        match poni_core::capture::mic_open_problem(e.code().0).filter(|_| matches!(self, Flow::Mic(_))) {
            Some(why) => retry(why),
            None => retry(format!("The {} could not be {step} ({e}).", self.what())),
        }
    }
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
    fn open(enumerator: &IMMDeviceEnumerator, flow: &Flow) -> Result<Session, OpenError> {
        let device = flow.device(enumerator).map_err(|_| match flow {
            Flow::Pc => retry("No audio output device. Captions resume when one is available."),
            Flow::Mic(_) => retry("No microphone. Captions resume when one is plugged in."),
        })?;
        let id = device_id(&device);
        let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None) }.map_err(|e| flow.failed("opened", e))?;
        let fmt = unsafe { client.GetMixFormat() }.map_err(|e| flow.failed("read", e))?;
        // The mix format is CoTaskMem: free it once, after Initialize has read it.
        let (rate, channels, float) = unsafe { describe(fmt) };
        let flags = if matches!(flow, Flow::Pc) { LOOPBACK } else { 0 };
        let init = if float { unsafe { client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, BUFFER_100NS, 0, fmt, None) } } else { Ok(()) };
        unsafe { CoTaskMemFree(Some(fmt as *const _)) };
        if !float {
            return Err(OpenError { fatal: true, why: format!("The {} mixes audio in a format captions cannot read (needs 32-bit float).", flow.what()) });
        }
        init.map_err(|e| flow.failed("captured", e))?;
        let capture: IAudioCaptureClient = unsafe { client.GetService() }.map_err(|e| flow.failed("captured", e))?;
        unsafe { client.Start() }.map_err(|e| flow.failed("captured", e))?;
        Ok(Session { id, client, capture, pipeline: Pipeline::new(rate, channels), channels })
    }

    /// Every packet that is waiting, interleaved as the device gives it.
    fn drain(&mut self) -> windows::core::Result<Vec<f32>> {
        let mut all = Vec::new();
        loop {
            if unsafe { self.capture.GetNextPacketSize()? } == 0 {
                return Ok(all);
            }
            let (mut data, mut frames, mut flags) = (std::ptr::null_mut::<u8>(), 0u32, 0u32);
            unsafe { self.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)? };
            let n = frames as usize * self.channels;
            if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                all.resize(all.len() + n, 0.0);
            } else {
                // SAFETY: WASAPI returns `frames` frames of the mix format (checked as f32); the
                // buffer is valid until ReleaseBuffer, and the bytes are copied before it.
                all.extend_from_slice(unsafe { std::slice::from_raw_parts(data as *const f32, n) });
            }
            unsafe { self.capture.ReleaseBuffer(frames)? };
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

fn capture_loop(stop: Receiver<()>, health: Arc<Health>, slot: Slot, wake: Sender<()>, flows: Vec<Flow>, level: Arc<AtomicU32>, latency: Arc<AtomicU8>) {
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
    // One session per flow; every one is open before any is read.
    let mut sessions: Vec<Option<Session>> = flows.iter().map(|_| None).collect();
    let mut mixer = Mixer::default();
    // One source: the utterance buffer (PMM-025). Both keeps the mixer's windows, each a final line.
    let mut utter = Utterances::new(latency_of(latency.load(Ordering::Relaxed)).timing());
    let mut checked = Instant::now();
    while !stopped.load(Ordering::Relaxed) {
        if let Some(i) = sessions.iter().position(Option::is_none) {
            match Session::open(&enumerator, &flows[i]) {
                Ok(s) => {
                    sessions[i] = Some(s);
                    if sessions.iter().all(Option::is_some) {
                        health.device(None);
                        checked = Instant::now();
                    }
                }
                Err(e) if e.fatal => return health.fail(e.why),
                Err(e) => {
                    health.device(Some(e.why));
                    nap(RETRY);
                }
            }
            continue;
        }
        let mut read = Vec::with_capacity(flows.len());
        let mut lost = None;
        for (s, f) in sessions.iter_mut().flatten().zip(&flows) {
            match s.drain() {
                Ok(raw) => read.push(raw),
                Err(e) => {
                    lost = Some(format!("The {} went away ({e}). Reconnecting.", f.what()));
                    break;
                }
            }
        }
        if lost.is_none() && checked.elapsed() >= DEVICE_CHECK {
            checked = Instant::now();
            for (s, f) in sessions.iter().flatten().zip(&flows) {
                if f.follows_default() && f.device(&enumerator).map(|d| device_id(&d)).unwrap_or_default() != s.id {
                    lost = Some(format!("The default {} changed. Reconnecting.", f.what()));
                }
            }
        }
        if let Some(why) = lost {
            crate::pinfo!("capture: {why}");
            health.device(Some(why));
            sessions.iter_mut().for_each(|s| *s = None);
            continue;
        }
        if matches!(flows[0], Flow::Mic(_)) && !read[0].is_empty() {
            level.store(poni_core::capture::rms(&read[0]).to_bits(), Ordering::Relaxed);
        }
        utter.set_timing(latency_of(latency.load(Ordering::Relaxed)).timing());
        let jobs: Vec<Job> = match sessions.as_mut_slice() {
            [Some(s)] => {
                let mono = s.pipeline.mono(&read[0]);
                utter.push(&mono).into_iter().map(|p| Job { audio: p.samples, side: None, last: p.last }).collect()
            }
            [Some(mic), Some(pc)] => {
                let (m, p) = (mic.pipeline.mono(&read[0]), pc.pipeline.mono(&read[1]));
                mixer.push(&m, &p).into_iter().map(|(w, side)| Job { audio: w, side: Some(side), last: true }).collect()
            }
            _ => Vec::new(),
        };
        for job in jobs {
            // Newest wins: an older job the poster has not taken is dropped, but an interim never
            // takes the place of a final line.
            offer(&slot, &wake, job);
        }
        nap(POLL);
    }
    // Stop leaves what was being said unposted, as the unfinished 4 s window always was: by now the
    // session has been taken for saving, and a late line would land in the next one.
}

/// The active microphones: (endpoint id, name), for Live's mic chip (PMM-019). Read on a short MTA
/// thread of its own, so the calling thread's apartment does not matter.
pub fn input_devices() -> Vec<(String, String)> {
    std::thread::spawn(|| {
        let com = ComApartment::enter_mta();
        if !com.initialized {
            return Vec::new();
        }
        let list = || -> windows::core::Result<Vec<(String, String)>> {
            let en: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
            let all = unsafe { en.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)? };
            let mut out = Vec::new();
            for i in 0..unsafe { all.GetCount()? } {
                let d = unsafe { all.Item(i)? };
                out.push((device_id(&d), friendly_name(&d).unwrap_or_else(|| "Microphone".into())));
            }
            Ok(out)
        };
        list().unwrap_or_default()
    })
    .join()
    .unwrap_or_default()
}

/// The name Windows shows for an endpoint ("Microphone Array (Realtek...)").
fn friendly_name(d: &IMMDevice) -> Option<String> {
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;
    // PKEY_Device_FriendlyName.
    const KEY: PROPERTYKEY = PROPERTYKEY { fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };
    let store = unsafe { d.OpenPropertyStore(STGM_READ) }.ok()?;
    let v = unsafe { store.GetValue(&KEY) }.ok()?;
    let p = unsafe { PropVariantToStringAlloc(&v) }.ok()?;
    // SAFETY: a NUL-terminated CoTaskMem string we own and free once.
    let name = unsafe { p.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    name.filter(|n| !n.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    #[test]
    fn only_32_bit_float_mix_formats_are_read() {
        let fmt = |tag: u16, bits: u16| WAVEFORMATEX { wFormatTag: tag, nChannels: 2, nSamplesPerSec: 48_000, wBitsPerSample: bits, ..Default::default() };
        assert_eq!(unsafe { describe(&fmt(3, 32)) }, (48_000, 2, true));
        assert!(!unsafe { describe(&fmt(1, 16)) }.2, "16-bit PCM is refused");
        assert!(!unsafe { describe(&fmt(3, 64)) }.2);
    }

    /// Real hardware, real engine: play speech on this PC, point `PONI_TEST_ENGINE_PORT`
    /// at a running engine, run with `--ignored --nocapture`. Prints what `/live` holds after 40 s.
    /// `PONI_TEST_SOURCE` (room, pc, both) and `PONI_TEST_MIC` (an endpoint id) test the room.
    #[test]
    #[ignore = "needs a running engine and speech playing on this PC"]
    fn what_this_pc_plays_reaches_the_engine_as_a_caption() {
        let port: u16 = std::env::var("PONI_TEST_ENGINE_PORT").expect("PONI_TEST_ENGINE_PORT").parse().unwrap();
        let source = Source::parse(&std::env::var("PONI_TEST_SOURCE").unwrap_or_else(|_| "pc".into()));
        let (tx, rx) = channel();
        let sink = EventSink::new(tx, crate::events::SendHwnd::new(windows::Win32::Foundation::HWND::default()));
        let log = SessionLog::default();
        let svc = CaptureService::start(sink, port, "auto".into(), "en".into(), log.clone(), source, std::env::var("PONI_TEST_MIC").unwrap_or_default(), Latency::default()).unwrap();
        let t0 = std::time::Instant::now();
        let (mut heard, mut states, mut peak) = (0, Vec::new(), 0f32);
        while t0.elapsed() < Duration::from_secs(40) {
            peak = peak.max(svc.mic_level());
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(crate::events::AppEvent::Capture(CaptureEvent::Heard)) => {
                    heard += 1;
                    eprintln!("{:>4.1}s heard", t0.elapsed().as_secs_f32());
                }
                Ok(crate::events::AppEvent::Capture(CaptureEvent::State(s))) => states.push(format!("{s:?}")),
                _ => {}
            }
        }
        eprintln!("mic level peak {peak}");
        drop(svc);
        for l in log.lock().unwrap().lines() {
            eprintln!("line: {} | {}", l.source, l.translation);
        }
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
        match Session::open(&enumerator, &Flow::Pc) {
            Ok(mut s) => {
                s.drain().expect("drain");
            }
            Err(e) => eprintln!("no loopback here ({}): {}", if e.fatal { "fatal" } else { "retry" }, e.why),
        }
    }

    /// The real default microphone, if there is one: opens a capture session (or says in words why
    /// not: blocked, held, missing), and the list of microphones names each one.
    #[test]
    fn a_mic_session_opens_on_this_pcs_default_microphone_or_says_why() {
        let com = ComApartment::enter_mta();
        assert!(com.initialized);
        let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.unwrap();
        match Session::open(&enumerator, &Flow::Mic(String::new())) {
            Ok(mut s) => {
                s.drain().expect("drain");
            }
            Err(e) => eprintln!("no microphone here ({}): {}", if e.fatal { "fatal" } else { "retry" }, e.why),
        }
        let mics = input_devices();
        eprintln!("microphones: {mics:?}");
        assert!(mics.iter().all(|(id, name)| !id.is_empty() && !name.is_empty()));
    }
}

//! The platform-independent half of live captions (shared by the Windows island and the Mac app):
//! what a session heard (`Log`), the meeting it is saved as, what the person is told (`Health`),
//! and the poster that sends each ~4 s window to the engine's `/draft` with one request in flight.
//! The device readers are the platforms' own: `capture.rs` (WASAPI) and `mac/services/capture.rs`
//! (Core Audio tap and microphone); each hands finished windows over through [`offer`].

use crate::events::{AppEvent, EventSink};
use poni_core::capture::{pcm_bytes, CaptureState, Side};
use poni_core::helper;
use poni_core::utterance::{replaces, Latency};
use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const POLL: Duration = Duration::from_millis(50);
pub const RETRY: Duration = Duration::from_millis(1500);
const STOP_TIMEOUT: Duration = Duration::from_millis(800);

/// What a captioning session heard, kept for the meeting saved when it stops. It outlives a
/// restart (a language change) and is emptied by [`Log::take`]; times count from the first start.
#[derive(Default)]
pub struct Log {
    start: Option<Instant>,
    lines: Vec<helper::Line>,
    /// The utterance still being spoken (PMM-025): its text so far, shown after the kept lines and
    /// replaced by the next interim or, at last, by the line that is kept. Never saved, never counted.
    interim: Option<String>,
    /// How long each kept line took to come back (the latency readout), aligned with `lines`.
    ms: Vec<Option<u32>>,
}

pub type SessionLog = Arc<Mutex<Log>>;

impl Log {
    /// A capture starts: a session with no lines yet begins its clock now.
    pub fn begin(&mut self) {
        if self.lines.is_empty() {
            self.start = Some(Instant::now());
        }
    }

    /// A line is kept: `span_s` of audio ended now. It ends the interim that led up to it.
    pub(crate) fn push(&mut self, source: String, translation: String, span_s: f64) {
        let end = self.start.get_or_insert_with(Instant::now).elapsed().as_secs_f64();
        self.interim = None;
        self.lines.push(helper::Line { t0: (end - span_s).max(0.0), t1: end, source, translation });
        self.ms.push(None);
    }

    /// A line kept with its readout (Fast: the translation's round trip).
    pub(crate) fn push_with_ms(&mut self, source: String, translation: String, span_s: f64, ms: u32) {
        self.push(source, translation, span_s);
        self.set_last_ms(ms);
    }

    /// The interim, but only when it differs from what is shown: true when it changed.
    pub(crate) fn set_interim_if_changed(&mut self, text: Option<String>) -> bool {
        let text = text.filter(|t| !t.trim().is_empty());
        if self.interim == text {
            return false;
        }
        self.interim = text;
        true
    }

    /// How long the newest kept line took (the readout "[ 820 ms ]").
    fn set_last_ms(&mut self, ms: u32) {
        if let Some(last) = self.ms.last_mut() {
            *last = Some(ms);
        }
    }

    /// The readout of each line `tail(n)` returns, in the same order (the interim has none).
    pub fn tail_ms(&self, n: usize) -> Vec<Option<u32>> {
        let mut out = self.ms[self.ms.len().saturating_sub(n)..].to_vec();
        if self.interim.is_some() {
            out.push(None);
            if out.len() > n {
                out.remove(0);
            }
        }
        out
    }

    /// The last line of `tail` is the utterance still being spoken, not a kept line.
    pub fn interim_shown(&self) -> bool {
        self.interim.is_some()
    }

    /// The utterance so far; `None` (or empty) when the engine heard nothing in it.
    fn set_interim(&mut self, text: Option<String>) {
        self.interim = text.filter(|t| !t.trim().is_empty());
    }

    /// How many lines the session has, and its newest `n` (oldest first): the Meeting tab's view,
    /// with the interim, when there is one, as the last of them (it is not one of the lines counted).
    pub fn tail(&self, n: usize) -> (usize, Vec<helper::Line>) {
        let mut out = self.lines[self.lines.len().saturating_sub(n)..].to_vec();
        if let Some(text) = &self.interim {
            let now = self.start.map_or(0.0, |s| s.elapsed().as_secs_f64());
            out.push(helper::Line { t0: now, t1: now, source: text.clone(), translation: String::new() });
            if out.len() > n {
                out.remove(0);
            }
        }
        (self.lines.len(), out)
    }

    /// Every line so far, for a notes refresh (the session goes on).
    pub fn lines(&self) -> Vec<helper::Line> {
        self.lines.clone()
    }

    pub fn take(&mut self) -> Vec<helper::Line> {
        self.interim = None;
        self.ms.clear();
        std::mem::take(&mut self.lines)
    }

    /// Lines whose save failed go back in front of what came since.
    pub fn restore(&mut self, mut lines: Vec<helper::Line>) {
        self.ms.splice(0..0, std::iter::repeat_n(None, lines.len()));
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
    /// A media session: kept as a transcript, not a meeting (PMM-015).
    pub transcript: bool,
    /// The Meeting tab's notes so far (a meeting session): saved with the final draft (PMM-009).
    pub notes: Option<poni_core::live_notes::LiveNotes>,
    /// Live heard the room (Room or Both): saved as an "In-room" meeting (PMM-020).
    pub room: bool,
    /// The meeting app the session heard, for the Minutes chip (PMM-023).
    pub app: Option<String>,
}

/// A saved session's id and what its notes held, or why not with its lines back.
pub type Saved = Result<(String, poni_core::live_notes::Counts), (String, Vec<helper::Line>)>;

/// Save a session as a meeting: the engine drafts the summary, decisions and actions (best effort,
/// the transcript is kept without them), then keeps the document. `Err` returns the lines.
pub fn save_meeting(port: u16, m: Meeting) -> Saved {
    use poni_core::live_notes::{draft_items, onto_doc};
    use poni_core::meeting_doc::{as_in_room, as_transcript, generate_body, generated_note, meeting_doc, with_app};
    let draft = helper::request(port, "POST", "/notes/generate", Some(&generate_body(&m.title, &m.lines))).ok().filter(|(c, _)| *c == 200).and_then(|(_, b)| generated_note(&b));
    let Some(doc) = meeting_doc(&m.id, &m.title, &m.date, &m.start, &m.locale, &m.lines, draft.as_ref()) else { return Err(("Nothing was heard.".into(), Vec::new())) };
    // The draft is kept on a transcript too, so "Save as meeting" gives a meeting with its notes.
    let doc = if m.transcript { as_transcript(doc) } else if m.room { as_in_room(doc) } else { with_app(doc, m.app.as_deref()) };
    // A Meeting tab session: the final draft joins the kept and typed items (the last draft stays
    // when the engine gives none).
    let (doc, counts) = match m.notes {
        Some(mut notes) => {
            if let Some(d) = draft.as_ref() {
                notes.answer(0.0, Some(draft_items(d, &m.lines)));
            }
            (onto_doc(doc, &notes), notes.counts())
        }
        None => (doc, Default::default()),
    };
    match helper::post_note(port, &doc.to_string()) {
        Ok(()) => Ok((m.id, counts)),
        Err(e) => Err((e, m.lines)),
    }
}

/// Ask the engine for a draft of the session so far (the Meeting tab's notes): `None` when it does
/// not answer. Runs off the UI thread.
pub fn draft_notes(port: u16, title: &str, lines: &[helper::Line]) -> Option<Vec<poni_core::live_notes::Item>> {
    use poni_core::meeting_doc::{generate_body, generated_note};
    let body = generate_body(title, lines);
    let (code, b) = helper::request_bytes(port, "POST", "/notes/generate", "application/json", body.as_bytes(), Duration::from_secs(15)).ok()?;
    let note = (code == 200).then(|| generated_note(&b)).flatten()?;
    Some(poni_core::live_notes::draft_items(&note, lines))
}

/// Save pasted lines as a meeting, poured into `base` (a meeting started from Calendar) when given.
pub fn save_pasted(port: u16, m: Meeting, base: Option<serde_json::Value>, speakers: Vec<String>) -> Saved {
    use poni_core::meeting_doc::{generate_body, generated_note, meeting_doc, with_base};
    let draft = helper::request_bytes(port, "POST", "/notes/generate", "application/json", generate_body(&m.title, &m.lines).as_bytes(), Duration::from_secs(30)).ok().filter(|(c, _)| *c == 200).and_then(|(_, b)| generated_note(&b));
    let Some(doc) = meeting_doc(&m.id, &m.title, &m.date, &m.start, &m.locale, &m.lines, draft.as_ref()) else { return Err(("The paste held no lines.".into(), Vec::new())) };
    let doc = with_base(doc, base.as_ref(), &speakers);
    let id = doc.get("id").and_then(|v| v.as_str()).unwrap_or(&m.id).to_string();
    // Pasted lines are not captions: on failure nothing is handed back to the next Stop.
    helper::post_note(port, &doc.to_string()).map(|()| (id, Default::default())).map_err(|e| (e, Vec::new()))
}

pub enum CaptureEvent {
    /// The state changed (only sent on a change).
    State(CaptureState),
    /// The engine heard words: ask the helper link for the line now.
    Heard,
    /// The utterance still being spoken changed (PMM-025): repaint; nothing is counted as heard.
    Interim,
    /// Windows Live Captions cannot be read (closed, not opened): the app falls back to our own
    /// captions with the Fast timing and says why.
    LiveCapGone(String),
    /// The translation is missing or loading (or no longer is): a note under the source line.
    Hint(Option<poni_core::capture::TranslateHint>),
}

pub struct CaptureService {
    tx: Sender<()>,
    done: Receiver<()>,
    thread: Option<JoinHandle<()>>,
    health: Arc<Health>,
    /// Spoken and target language, read before each request: a change in Settings reaches the
    /// next window without restarting the device reader.
    langs: Arc<Mutex<(String, String)>>,
    /// The microphone's level (f32 bits, RMS of the last packets) for Live's mic chip.
    level: Arc<AtomicU32>,
    /// The Latency mode (its place in `Latency::ALL`): its timing shapes the next utterance.
    latency: Arc<AtomicU8>,
}

pub fn latency_of(n: u8) -> Latency {
    Latency::ALL[(n as usize).min(Latency::ALL.len() - 1)]
}

pub fn latency_index(l: Latency) -> u8 {
    Latency::ALL.iter().position(|x| *x == l).unwrap_or(1) as u8
}

/// What the platform's device loop gets: its stop signal and the places its audio goes.
pub struct LoopCtx {
    pub stop: Receiver<()>,
    pub health: Arc<Health>,
    pub slot: Slot,
    pub wake: Sender<()>,
    pub level: Arc<AtomicU32>,
    pub latency: Arc<AtomicU8>,
}

impl CaptureService {
    /// Start the poster and `run` (the platform's device loop, on the `poni-capture` thread).
    /// `src`/`tgt` are the engine's language codes (`auto` detects).
    pub fn spawn(sink: EventSink, port: u16, src: String, tgt: String, log: SessionLog, latency: Latency, run: impl FnOnce(LoopCtx) + Send + 'static) -> std::io::Result<Self> {
        let health = Arc::new(Health { sink: sink.clone(), st: Mutex::new(HealthState { sent: Some(CaptureState::On), ..Default::default() }) });
        let slot: Slot = Arc::default();
        let level = Arc::new(AtomicU32::new(0));
        let (wake_tx, wake_rx) = channel::<()>();
        let (tx, rx) = channel::<()>();
        let (done_tx, done) = channel::<()>();

        let langs = Arc::new(Mutex::new((src, tgt)));
        let (h, s, l) = (health.clone(), slot.clone(), langs.clone());
        std::thread::Builder::new().name("poni-capture-post".into()).spawn(move || post_loop(port, l, wake_rx, s, h, log))?;
        let mode = Arc::new(AtomicU8::new(latency_index(latency)));
        let ctx = LoopCtx { stop: rx, health: health.clone(), slot, wake: wake_tx, level: level.clone(), latency: mode.clone() };
        let thread = std::thread::Builder::new().name("poni-capture".into()).spawn(move || {
            run(ctx);
            let _ = done_tx.send(());
        })?;
        Ok(Self { tx, done, thread: Some(thread), health, langs, level, latency: mode })
    }

    /// A new Latency mode: the next utterance is cut with its timing, with no restart.
    pub fn set_latency(&self, latency: Latency) {
        self.latency.store(latency_index(latency), Ordering::Relaxed);
    }

    /// The microphone's RMS level now (0 without one).
    pub fn mic_level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }

    /// New languages for the next window; the translation note is worked out again from its answer.
    pub fn set_langs(&self, src: String, tgt: String) {
        *self.langs.lock().unwrap_or_else(|e| e.into_inner()) = (src, tgt);
        self.health.hint(None);
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
pub struct HealthState {
    device: Option<String>,
    engine: Option<String>,
    hint: Option<poni_core::capture::TranslateHint>,
    failed: Option<String>,
    sent: Option<CaptureState>,
    silenced: bool,
}

pub struct Health {
    sink: EventSink,
    st: Mutex<HealthState>,
}

impl Health {
    pub fn update(&self, f: impl FnOnce(&mut HealthState)) {
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

    pub fn device(&self, why: Option<String>) {
        self.update(|s| s.device = why);
    }

    pub fn engine(&self, why: Option<String>) {
        self.update(|s| s.engine = why);
    }

    /// Sent only when it changes.
    pub fn hint(&self, h: Option<poni_core::capture::TranslateHint>) {
        let mut s = self.st.lock().unwrap_or_else(|e| e.into_inner());
        if s.hint != h {
            s.hint = h;
            if !s.silenced {
                self.sink.send(AppEvent::Capture(CaptureEvent::Hint(h)));
            }
        }
    }

    pub fn fail(&self, why: String) {
        self.update(|s| s.failed = Some(why));
    }

    pub fn silence(&self) {
        self.st.lock().unwrap_or_else(|e| e.into_inner()).silenced = true;
    }

    pub fn heard(&self) {
        if !self.st.lock().unwrap_or_else(|e| e.into_inner()).silenced {
            self.sink.send(AppEvent::Capture(CaptureEvent::Heard));
        }
    }

    /// The interim changed: the page repaints; nothing is counted as heard.
    pub fn interim(&self) {
        if !self.st.lock().unwrap_or_else(|e| e.into_inner()).silenced {
            self.sink.send(AppEvent::Capture(CaptureEvent::Interim));
        }
    }
}

// ---------------------------------------------------------------------------
// The poster: one request in flight, newest window wins.

/// What waits for the poster: audio, with Both its louder side, and whether it is a final line (a
/// window, or an utterance that ended) or an interim (PMM-025) that the next post replaces.
pub struct Job {
    pub audio: Vec<f32>,
    pub side: Option<Side>,
    pub last: bool,
}

/// The newest job. An interim never takes the place of a final the poster has not taken yet.
pub type Slot = Arc<Mutex<Option<Job>>>;

pub fn offer(slot: &Slot, wake: &Sender<()>, job: Job) {
    let mut waiting = slot.lock().unwrap_or_else(|e| e.into_inner());
    if waiting.as_ref().is_none_or(|old| replaces(old.last, job.last)) {
        *waiting = Some(job);
        let _ = wake.send(());
    }
}

fn post_loop(port: u16, langs: Arc<Mutex<(String, String)>>, wake: Receiver<()>, slot: Slot, health: Arc<Health>, log: SessionLog) {
    // The engine never downloads by itself: without the speech model a /draft answers 409. So the
    // window is not even sent while /models says it is not there, and a 409 closes the gate until
    // it says it is (a download the person pressed). The translation model is not a gate: the
    // engine captions without it and each answer says so in `translateState`.
    let mut speech = Gate::default();
    while wake.recv().is_ok() {
        let Some(Job { audio: window, side, last }) = slot.lock().unwrap_or_else(|e| e.into_inner()).take() else { continue };
        let (src, tgt) = langs.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let (src, tgt) = (src.as_str(), tgt.as_str());
        if !speech.open(|| speech_on_disk(port)) {
            health.engine(Some(poni_core::capture::SPEECH_MISSING.into()));
            continue;
        }
        let asked = Instant::now();
        match helper::post_draft(port, src, tgt, !last, &pcm_bytes(&window)) {
            Ok(d) if !last => {
                // An interim carries the spoken text only: it shows, and the next post replaces it.
                // Its answer says nothing of the translation, so the hint is left alone.
                health.engine(None);
                let text = (!d.source.is_empty()).then(|| poni_core::capture::tagged(side, &d.source));
                log.lock().unwrap_or_else(|e| e.into_inner()).set_interim(text);
                health.interim();
            }
            Ok(d) => {
                health.engine(None);
                health.hint(poni_core::capture::translation_hint(d.translate, src, tgt));
                if d.source.is_empty() {
                    // The utterance ended with nothing heard in it: the interim goes.
                    log.lock().unwrap_or_else(|e| e.into_inner()).set_interim(None);
                    health.interim();
                } else {
                    let span = window.len() as f64 / poni_core::capture::RATE as f64;
                    let mut l = log.lock().unwrap_or_else(|e| e.into_inner());
                    l.push(poni_core::capture::tagged(side, &d.source), d.translation, span);
                    l.set_last_ms(asked.elapsed().as_millis().min(u32::MAX as u128) as u32);
                    drop(l);
                    health.heard();
                }
            }
            Err(e) if e == poni_core::capture::SPEECH_MISSING => {
                speech.shut();
                health.engine(Some(e));
            }
            Err(e) => {
                crate::pinfo!("capture: /draft failed: {e}");
                speech.ok = false;
                // A request that got no answer in its 25 s while /health still answers is a model loading.
                // (On Windows a read timeout reads "os error 10060", so the test is `engine_unreachable`.)
                let loading = engine_unreachable(&e).then(|| helper::request(port, "GET", "/health", None).ok()).flatten().filter(|(c, _)| *c == 200).and_then(|(_, b)| poni_core::capture::loading_notice(&b, src != tgt));
                health.engine(Some(loading.unwrap_or_else(|| engine_problem(&e))));
            }
        }
    }
}

/// Whether windows may go to the engine for the speech model: once it is known to be there, no more
/// asking until a request fails; while it is not, asked again at most every 2 s.
#[derive(Default)]
pub struct Gate {
    ok: bool,
    /// The engine itself said "not downloaded" (a 409): only a "yes, on disk" opens the gate again,
    /// an engine that does not say no longer counts as a yes.
    strict: bool,
    checked: Option<Instant>,
}

impl Gate {
    /// `check`: `Some(false)` = the engine says the model is not on disk; `None` = it does not say.
    fn open(&mut self, check: impl FnOnce() -> Option<bool>) -> bool {
        if !self.ok && self.checked.is_none_or(|t| t.elapsed() > Duration::from_secs(2)) {
            self.checked = Some(Instant::now());
            self.ok = check().unwrap_or(!self.strict);
            self.strict &= !self.ok;
        }
        self.ok
    }

    /// The engine answered 409: not asked again for 2 s, and then only a "yes" opens it.
    fn shut(&mut self) {
        (self.ok, self.strict, self.checked) = (false, true, Some(Instant::now()));
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


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_utterance_in_progress_shows_last_is_never_counted_or_saved_and_ends_with_its_line() {
        let mut log = Log::default();
        log.begin();
        log.push("kept".into(), "kept too".into(), 4.0);
        log.set_interim(Some("hello how".into()));
        let (count, tail) = log.tail(5);
        assert_eq!(count, 1, "the interim is not one of the lines");
        assert_eq!(tail.iter().map(|l| l.source.as_str()).collect::<Vec<_>>(), ["kept", "hello how"]);
        assert_eq!(log.lines().len(), 1, "a notes refresh or a save never sees it");
        // The next interim replaces it; an empty answer clears it.
        log.set_interim(Some("hello how are".into()));
        assert_eq!(log.tail(5).1.last().map(|l| l.source.as_str()), Some("hello how are"));
        log.set_interim(Some("  ".into()));
        assert_eq!(log.tail(5).1.len(), 1);
        // The kept line replaces it, and its span comes from the audio it covered.
        log.set_interim(Some("hello how are you".into()));
        log.push("hello how are you".into(), "hola".into(), 3.0);
        let (count, tail) = log.tail(5);
        assert_eq!((count, tail.len()), (2, 2));
        assert!(tail[1].t1 - tail[1].t0 <= 3.0 + 1e-6);
        // The window the tail asks for is kept with an interim in it.
        log.set_interim(Some("next".into()));
        assert_eq!(log.tail(2).1.iter().map(|l| l.source.as_str()).collect::<Vec<_>>(), ["hello how are you", "next"]);
        // Stop clears it with the rest, and what a save receives holds finals only.
        let saved = log.take();
        assert!(saved.iter().all(|l| l.source != "next"), "the interim is never saved");
        assert_eq!(saved.len(), 2);
        assert_eq!(log.tail(5), (0, Vec::new()));
        assert!(log.tail_ms(5).is_empty());
    }

    #[test]
    fn the_readout_of_each_line_stays_aligned_with_the_lines() {
        let mut log = Log::default();
        log.push("a".into(), String::new(), 1.0);
        log.set_last_ms(820);
        log.push("b".into(), String::new(), 1.0);
        log.set_interim(Some("c".into()));
        assert!(log.interim_shown());
        assert_eq!(log.tail_ms(5), vec![Some(820), None, None], "the interim has no readout");
        assert_eq!(log.tail_ms(2), vec![None, None], "a window of 2 keeps the newest line and the interim");
        let saved = log.take();
        log.restore(saved);
        assert_eq!(log.tail_ms(5), vec![None, None], "after a failed save the lines come back with no readout");
    }

    #[test]
    fn the_session_log_keeps_lines_in_order_and_gives_failed_ones_back_in_front() {
        let mut log = Log::default();
        log.begin();
        log.push("line one".into(), "linie eins".into(), 4.0);
        log.push("line two".into(), String::new(), 4.0);
        assert!(log.lines[1].t1 >= log.lines[0].t1 && log.lines[0].t0 >= 0.0 && log.lines[0].t0 <= log.lines[0].t1);
        let taken = log.take();
        assert_eq!((taken.len(), log.lines.len()), (2, 0));
        // A restart while lines wait does not reset the clock; a save that failed returns its lines first.
        log.push("line three".into(), String::new(), 4.0);
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
    fn a_409_keeps_the_gate_shut_until_the_engine_says_the_model_is_there() {
        let mut g = Gate::default();
        assert!(g.open(|| None), "an engine that does not say lets the first window through");
        g.shut();
        assert!(!g.open(|| panic!("asked again within 2 s of the 409")));
        // After 2 s: an engine that still does not say is not a yes, so there is no retry loop.
        g.checked = Some(Instant::now() - Duration::from_secs(3));
        assert!(!g.open(|| None));
        g.checked = Some(Instant::now() - Duration::from_secs(3));
        assert!(!g.open(|| Some(false)));
        // The download the person pressed lands: /models says so, and windows flow again.
        g.checked = Some(Instant::now() - Duration::from_secs(3));
        assert!(g.open(|| Some(true)));
        assert!(g.open(|| panic!("a model known to be there is not asked about again")));
        // A later plain failure (engine restarted) goes back to the lenient reading.
        g.ok = false;
        g.checked = None;
        assert!(g.open(|| None));
    }

    #[test]
    fn a_dead_engine_and_an_engine_error_read_differently() {
        assert!(engine_problem("No connection could be made (os error 10061)").contains("not answering"));
        assert!(engine_problem("Error: model missing").contains("model missing"));
    }
}

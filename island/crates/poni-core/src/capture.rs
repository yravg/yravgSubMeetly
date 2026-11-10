//! System-audio captions, the pure half (ISL-002 on Windows): what the loopback
//! capture hands over (interleaved f32 at the device's rate) becomes the
//! windows the engine's `POST /draft` takes (16 kHz mono f32 little-endian,
//! about 4 s each, silence skipped). The WASAPI side is `poni`'s
//! `services::capture`.

/// What the engine's `/draft` wants.
pub const RATE: u32 = 16_000;
/// One request's audio: long enough for a clause, short enough to follow speech.
pub const WINDOW_S: usize = 4;
/// RMS under this (about -50 dBFS) is a pause or a muted player: not worth a request.
pub const SILENCE_RMS: f32 = 0.003;

/// Languages the pickers offer, as (engine code, name). Spoken language also offers `auto`.
pub const LANGS: [(&str, &str); 12] = [
    ("en", "English"),
    ("id", "Indonesian"),
    ("zh", "Chinese"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("es", "Spanish"),
    ("fr", "French"),
    ("de", "German"),
    ("th", "Thai"),
    ("ru", "Russian"),
    ("ar", "Arabic"),
    ("vi", "Vietnamese"),
];

/// The name of a language code (`auto` = "Auto-detect"; unknown codes show as is).
pub fn lang_name(code: &str) -> String {
    if code == "auto" {
        return "Auto-detect".into();
    }
    LANGS.iter().find(|(c, _)| *c == code).map_or_else(|| code.to_string(), |(_, n)| n.to_string())
}

/// The code `step` places after `code` in `LANGS` (wraps, either way); `with_auto` puts `auto`
/// first in the cycle. A code not in the list counts as the position before the first.
pub fn step_lang(code: &str, step: i32, with_auto: bool) -> &'static str {
    let mut all: Vec<&'static str> = Vec::new();
    if with_auto {
        all.push("auto");
    }
    all.extend(LANGS.iter().map(|(c, _)| *c));
    let at = all.iter().position(|c| *c == code).map_or(-1, |i| i as i32);
    all[(at + step).rem_euclid(all.len() as i32) as usize]
}

/// What to tell when `/draft` timed out and `/health` (`health_body`) still answers: the engine
/// is loading a model, not gone. `translating`: the captions are asked to be translated.
/// `None` when nothing says it is loading (the caller keeps its "not answering" sentence).
pub fn loading_notice(health_body: &str, translating: bool) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(health_body).ok()?;
    if v.get("ok").and_then(|o| o.as_bool()) != Some(true) {
        return None;
    }
    let loaded = |k: &str| v.get("loaded").and_then(|l| l.get(k)).and_then(|b| b.as_bool());
    if loaded("asr") == Some(false) {
        return Some("Loading the speech model. The first captions can take a minute.".into());
    }
    if translating && v.get("translate").and_then(|t| t.as_bool()) == Some(true) && loaded("translate") == Some(false) {
        return Some("Loading the translation model. Captions follow as soon as it is ready.".into());
    }
    None
}

/// Average the channels of interleaved frames into one.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    let ch = channels.max(1);
    interleaved.chunks_exact(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect()
}

pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

pub fn is_silent(samples: &[f32]) -> bool {
    rms(samples) < SILENCE_RMS
}

/// Streaming linear-interpolation resampler to [`RATE`]. Chunk boundaries do not
/// show: the position and the last sample carry over.
/// shortcut: no low-pass before decimating, so energy above 8 kHz aliases into
/// the speech band; speech recognition tolerates it. Upgrade to a windowed-sinc
/// filter if music-heavy captions turn out worse than they should.
pub struct Resampler {
    /// Input samples per output sample.
    step: f64,
    /// Next output position, in input samples from the start of the next chunk (may be -1..0).
    pos: f64,
    /// The last input sample of the previous chunk (index -1).
    prev: f32,
}

impl Resampler {
    pub fn new(from_rate: u32) -> Self {
        Self { step: from_rate.max(1) as f64 / RATE as f64, pos: 0.0, prev: 0.0 }
    }

    pub fn push(&mut self, mono: &[f32], out: &mut Vec<f32>) {
        let n = mono.len() as f64;
        let at = |i: i64| if i < 0 { self.prev } else { mono[i as usize] };
        while self.pos < n - 1.0 {
            let i = self.pos.floor();
            let frac = (self.pos - i) as f32;
            let (a, b) = (at(i as i64), at(i as i64 + 1));
            out.push(a + (b - a) * frac);
            self.pos += self.step;
        }
        if let Some(&last) = mono.last() {
            self.prev = last;
            self.pos -= n;
        }
    }
}

/// Cuts a stream into fixed windows.
pub struct Chunker {
    buf: Vec<f32>,
    window: usize,
}

impl Chunker {
    pub fn new(window: usize) -> Self {
        Self { buf: Vec::new(), window: window.max(1) }
    }

    /// Every window the new samples complete (usually none or one).
    pub fn push(&mut self, samples: &[f32]) -> Vec<Vec<f32>> {
        self.buf.extend_from_slice(samples);
        let mut out = Vec::new();
        while self.buf.len() >= self.window {
            let rest = self.buf.split_off(self.window);
            out.push(std::mem::replace(&mut self.buf, rest));
        }
        out
    }
}

/// Device buffers in, engine windows out: downmix, resample, cut, drop silence.
pub struct Pipeline {
    channels: usize,
    resampler: Resampler,
    chunker: Chunker,
}

impl Pipeline {
    pub fn new(device_rate: u32, channels: usize) -> Self {
        Self { channels, resampler: Resampler::new(device_rate), chunker: Chunker::new(WINDOW_S * RATE as usize) }
    }

    pub fn feed(&mut self, interleaved: &[f32]) -> Vec<Vec<f32>> {
        let mono = downmix(interleaved, self.channels);
        let mut out = Vec::with_capacity(mono.len() / 2 + 1);
        self.resampler.push(&mono, &mut out);
        let mut windows = self.chunker.push(&out);
        windows.retain(|w| !is_silent(w));
        windows
    }
}

/// The request body: little-endian f32.
pub fn pcm_bytes(samples: &[f32]) -> Vec<u8> {
    samples.iter().flat_map(|s| s.to_le_bytes()).collect()
}

/// The engine's `/draft` path; `auto` lets the engine detect what is spoken.
pub fn draft_path(src: &str, tgt: &str) -> String {
    format!("/draft?src={src}&tgt={tgt}")
}

/// What the capture says while the speech model is not on disk. The engine never downloads by
/// itself (a `/draft` answers 409 `model-not-downloaded`), so no audio is sent until the person
/// has pressed Download.
pub const SPEECH_MISSING: &str = "The speech model is not downloaded yet. Download it and captions start by themselves.";

/// Does captioning `src` into `tgt` run through the translation model? English never does: the
/// engine falls back to Whisper's own translation.
pub fn needs_translation_model(src: &str, tgt: &str) -> bool {
    tgt != "en" && tgt != NO_TRANSLATION && src != tgt
}

/// The `tgt` of a `/draft` that wants the spoken line only (Settings: translate captions off).
pub const NO_TRANSLATION: &str = "none";

/// The target captions are sent with: the chosen language, or [`NO_TRANSLATION`].
pub fn caption_target(translate: bool, target_lang: &str) -> &str {
    if translate {
        target_lang
    } else {
        NO_TRANSLATION
    }
}

/// `translateState` of a `/draft` answer: why a caption has, or has not, its translation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranslateState {
    Off,
    Missing,
    Loading,
    Ready,
}

impl TranslateState {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "off" => Self::Off,
            "missing" => Self::Missing,
            "loading" => Self::Loading,
            "ready" => Self::Ready,
            _ => return None,
        })
    }
}

/// The one-line note under the source caption while the translation is not there. The captions
/// themselves go on (the source line, or Whisper's English); only a press downloads the model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranslateHint {
    NotDownloaded,
    Loading,
}

/// The note for what `/draft` said; `None` when nothing is wrong or nothing is being translated.
pub fn translation_hint(state: Option<TranslateState>, src: &str, tgt: &str) -> Option<TranslateHint> {
    if !needs_translation_model(src, tgt) {
        return None;
    }
    match state? {
        TranslateState::Missing => Some(TranslateHint::NotDownloaded),
        TranslateState::Loading => Some(TranslateHint::Loading),
        TranslateState::Off | TranslateState::Ready => None,
    }
}

/// Where the island's own capture stands, for the Live page, the tray and the pill.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub enum CaptureState {
    #[default]
    Off,
    /// Capturing and sending; nothing wrong.
    On,
    /// Capturing, but something stands in the way (engine offline, model missing,
    /// device switching). Clears by itself when it passes.
    Warn(String),
    /// Capture stopped on its own and says why (no output device, unsupported format).
    Failed(String),
}

impl CaptureState {
    /// The capture thread is alive.
    pub fn running(&self) -> bool {
        matches!(self, CaptureState::On | CaptureState::Warn(_))
    }

    /// Captions wait for the speech model to be downloaded ([`SPEECH_MISSING`]).
    pub fn needs_model(&self) -> bool {
        matches!(self, CaptureState::Warn(m) if m == SPEECH_MISSING)
    }

    /// The sentence to show, if there is a problem.
    pub fn problem(&self) -> Option<&str> {
        match self {
            CaptureState::Warn(m) | CaptureState::Failed(m) => Some(m),
            _ => None,
        }
    }
}

/// The playing app is worth captioning: anything but a music player (a browser, Teams, a video
/// player). shortcut: matched by name; a music app named otherwise gets captioned, add it here.
pub fn captionable_app(app_id: &str) -> bool {
    let a = app_id.to_ascii_lowercase();
    !["music", "spotify", "itunes", "foobar", "aimp", "winamp", "tidal", "deezer"].iter().any(|m| a.contains(m))
}

pub use crate::meeting_source::source_kind;

/// Is a timed calendar meeting with a join link running at `unix`?
pub fn meeting_now(cal: &crate::calendar::Calendar, unix: i64) -> bool {
    cal.events.iter().any(|e| !e.all_day && e.join_url.is_some() && e.start <= unix && unix < e.end)
}

/// Sound on the PC's output: on after [`SOUND_ON_S`] of sound, off after [`SOUND_OFF_S`] of quiet.
/// Short blips (a notification chime) never turn it on; a pause in speech never turns it off.
pub const SOUND_PEAK: f32 = 0.01;
pub const SOUND_ON_S: f64 = 2.0;
pub const SOUND_OFF_S: f64 = 20.0;

#[derive(Clone, Debug, Default)]
pub struct SoundGate {
    on: bool,
    loud: f64,
    quiet: f64,
}

impl SoundGate {
    /// One meter reading (`peak` 0..1) after `dt` seconds. `Some` when on/off changes.
    pub fn step(&mut self, peak: f32, dt: f64) -> Option<bool> {
        if peak >= SOUND_PEAK {
            self.loud += dt;
            self.quiet = 0.0;
        } else {
            self.quiet += dt;
            if self.quiet >= 3.0 {
                self.loud = 0.0; // blips far apart do not add up
            }
        }
        let next = if self.on { self.quiet < SOUND_OFF_S } else { self.loud >= SOUND_ON_S };
        (next != self.on).then(|| {
            self.on = next;
            next
        })
    }
}

/// After the reason ends, auto-started captions run this long before they stop (a pause between
/// videos, a meeting that overruns).
pub const AUTO_STOP_S: f64 = 90.0;

/// What [`Auto::step`] asks the island to do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AutoStep {
    Start,
    Stop,
    Nothing,
}

/// Captions that start by themselves (Settings: `auto_captions`). Captions it started stop once
/// the reason is gone for [`AUTO_STOP_S`]; captions the person started are never stopped by it,
/// and a Stop the person presses holds until the reason ends.
#[derive(Clone, Debug, Default)]
pub struct Auto {
    started: bool,
    held: bool,
    idle_since: Option<f64>,
}

impl Auto {
    pub fn step(&mut self, enabled: bool, wanted: bool, running: bool, now: f64) -> AutoStep {
        if !running && self.started {
            // It failed to start or was stopped elsewhere: no retry loop until the reason ends.
            self.started = false;
            self.held = true;
        }
        if !enabled {
            return AutoStep::Nothing;
        }
        if wanted {
            self.idle_since = None;
            if !running && !self.held {
                self.started = true;
                return AutoStep::Start;
            }
            return AutoStep::Nothing;
        }
        self.held = false;
        if !self.started {
            return AutoStep::Nothing;
        }
        let since = *self.idle_since.get_or_insert(now);
        if now - since >= AUTO_STOP_S {
            self.started = false;
            self.idle_since = None;
            return AutoStep::Stop;
        }
        AutoStep::Nothing
    }

    /// The person pressed Start (`on`) or Stop.
    pub fn manual(&mut self, on: bool, wanted: bool) {
        self.started = false;
        self.idle_since = None;
        self.held = !on && wanted;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_missing_model_sentence_asks_for_a_download() {
        assert!(CaptureState::Warn(SPEECH_MISSING.into()).needs_model());
        assert!(!CaptureState::Warn("Loading the speech model.".into()).needs_model());
        assert!(!CaptureState::On.needs_model());
    }

    #[test]
    fn a_missing_or_loading_translation_model_is_a_hint_not_a_stop() {
        use TranslateHint::*;
        use TranslateState as S;
        assert_eq!(translation_hint(Some(S::Missing), "de", "id"), Some(NotDownloaded));
        assert_eq!(translation_hint(Some(S::Loading), "auto", "id"), Some(Loading));
        assert_eq!(translation_hint(Some(S::Ready), "de", "id"), None);
        assert_eq!(translation_hint(Some(S::Off), "de", "id"), None);
        assert_eq!(translation_hint(None, "de", "id"), None, "an engine that does not say has no hint");
        // English is Whisper's own job and the same language needs none: "missing" is not news there.
        assert_eq!(translation_hint(Some(S::Missing), "de", "en"), None);
        assert_eq!(translation_hint(Some(S::Missing), "id", "id"), None);
        assert_eq!((TranslateState::parse("loading"), TranslateState::parse("nope")), (Some(S::Loading), None));
    }

    #[test]
    fn only_a_target_other_than_english_needs_the_translation_model() {
        assert!(needs_translation_model("auto", "id") && needs_translation_model("de", "id"));
        assert!(!needs_translation_model("de", "en") && !needs_translation_model("auto", "en"), "English falls back to Whisper's own translation");
        assert!(!needs_translation_model("id", "id"), "nothing to translate");
    }

    #[test]
    fn downmix_averages_the_channels() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5, -1.0, 1.0], 2), vec![0.5, 0.5, 0.0]);
        assert_eq!(downmix(&[0.25, 0.5], 1), vec![0.25, 0.5]);
        // A trailing partial frame is dropped, not misread.
        assert_eq!(downmix(&[1.0, 1.0, 9.0], 2), vec![1.0]);
    }

    #[test]
    fn resampling_48k_to_16k_keeps_a_third_of_the_samples_and_the_tone() {
        let mut r = Resampler::new(48_000);
        // 1 s of a 440 Hz sine at 48 kHz.
        let x: Vec<f32> = (0..48_000).map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48_000.0).sin()).collect();
        let mut out = Vec::new();
        r.push(&x, &mut out);
        assert!((out.len() as i64 - 16_000).abs() <= 1, "got {}", out.len());
        // Output sample k sits at input 3k, so it equals the sine there.
        for k in [0usize, 100, 5_000, 15_000] {
            let want = (2.0 * std::f32::consts::PI * 440.0 * (3 * k) as f32 / 48_000.0).sin();
            assert!((out[k] - want).abs() < 1e-3, "k={k}: {} vs {want}", out[k]);
        }
    }

    #[test]
    fn chunk_boundaries_do_not_change_the_resampled_stream() {
        let x: Vec<f32> = (0..4_410).map(|i| ((i * 7 % 100) as f32) / 100.0).collect();
        let mut whole = Vec::new();
        Resampler::new(44_100).push(&x, &mut whole);
        let mut parts = Vec::new();
        let mut r = Resampler::new(44_100);
        for c in x.chunks(441) {
            r.push(c, &mut parts);
        }
        // 44.1k -> 16k never divides evenly: compare the common prefix, and the count within one.
        assert!((whole.len() as i64 - parts.len() as i64).abs() <= 1);
        for (a, b) in whole.iter().zip(&parts) {
            assert!((a - b).abs() < 1e-4);
        }
    }

    #[test]
    fn the_chunker_emits_whole_windows_and_keeps_the_rest() {
        let mut c = Chunker::new(4);
        assert!(c.push(&[1.0, 2.0, 3.0]).is_empty());
        assert_eq!(c.push(&[4.0, 5.0]), vec![vec![1.0, 2.0, 3.0, 4.0]]);
        assert_eq!(c.push(&[6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0]), vec![vec![5.0, 6.0, 7.0, 8.0], vec![9.0, 10.0, 11.0, 12.0]]);
    }

    #[test]
    fn silence_is_not_sent_and_sound_is() {
        assert!(is_silent(&[0.0; 100]));
        assert!(is_silent(&[0.001; 100]));
        assert!(!is_silent(&[0.05; 100]));
        assert!(is_silent(&[]));
        // Stereo 48 kHz: 2 s loud then 6 s quiet = two 4 s windows; only the first carries sound.
        let mut p = Pipeline::new(48_000, 2);
        let loud: Vec<f32> = (0..96_000 * 2).map(|i| if i % 4 < 2 { 0.2 } else { -0.2 }).collect();
        let quiet = vec![0.0f32; 96_000 * 6];
        assert!(p.feed(&loud).is_empty(), "2 s is not a window yet");
        let got = p.feed(&quiet);
        assert_eq!(got.len(), 1, "the quiet window is dropped");
        assert_eq!(got[0].len(), WINDOW_S * RATE as usize);
        assert!(!is_silent(&got[0]));
    }

    #[test]
    fn the_request_body_is_little_endian_f32() {
        assert_eq!(pcm_bytes(&[1.0, -2.0]), [0, 0, 0x80, 0x3f, 0, 0, 0, 0xc0]);
    }

    #[test]
    fn the_draft_path_names_both_languages() {
        assert_eq!(draft_path("auto", "en"), "/draft?src=auto&tgt=en");
    }

    #[test]
    fn a_problem_state_says_what_is_wrong_and_whether_capture_runs() {
        assert!(!CaptureState::Off.running() && CaptureState::Off.problem().is_none());
        assert!(CaptureState::On.running() && CaptureState::On.problem().is_none());
        let w = CaptureState::Warn("engine offline".into());
        assert!(w.running() && w.problem() == Some("engine offline"));
        let f = CaptureState::Failed("no output device".into());
        assert!(!f.running() && f.problem() == Some("no output device"));
    }

    #[test]
    fn a_slow_engine_says_which_model_it_is_loading() {
        let health = |asr: bool, tr: bool, mt: bool| format!(r#"{{"ok":true,"translate":{mt},"loaded":{{"asr":{asr},"translate":{tr}}}}}"#);
        assert_eq!(loading_notice(&health(false, false, true), true).as_deref(), Some("Loading the speech model. The first captions can take a minute."));
        assert_eq!(loading_notice(&health(true, false, true), true).as_deref(), Some("Loading the translation model. Captions follow as soon as it is ready."));
        // No translation wanted, or none installed: only the speech model matters.
        assert_eq!(loading_notice(&health(true, false, true), false), None);
        assert_eq!(loading_notice(&health(true, false, false), true), None);
        // Everything loaded but still slow, or an answer that is not the engine's: no claim.
        assert_eq!(loading_notice(&health(true, true, true), true), None);
        assert_eq!(loading_notice("not json", true), None);
    }

    #[test]
    fn languages_cycle_and_have_names() {
        assert_eq!(step_lang("auto", 1, true), "en");
        assert_eq!(step_lang("en", 1, true), "id");
        assert_eq!(step_lang("vi", 1, true), "auto");
        assert_eq!(step_lang("vi", 1, false), "en");
        assert_eq!(step_lang("xx", 1, false), "en");
        assert_eq!(step_lang("auto", -1, true), "vi");
        assert_eq!(step_lang("en", -1, false), "vi");
        assert_eq!(step_lang("en", -1, true), "auto");
        assert_eq!(lang_name("ja"), "Japanese");
        assert_eq!(lang_name("auto"), "Auto-detect");
        assert_eq!(lang_name("xx"), "xx");
    }

    #[test]
    fn auto_captions_start_with_a_video_and_stop_a_while_after_it() {
        let mut a = Auto::default();
        assert_eq!(a.step(true, false, false, 0.0), AutoStep::Nothing);
        assert_eq!(a.step(false, true, false, 0.0), AutoStep::Nothing, "setting off");
        assert_eq!(a.step(true, true, false, 1.0), AutoStep::Start);
        assert_eq!(a.step(true, true, true, 2.0), AutoStep::Nothing);
        assert_eq!(a.step(true, false, true, 10.0), AutoStep::Nothing, "a pause is not the end");
        assert_eq!(a.step(true, true, true, 50.0), AutoStep::Nothing, "the next video resets the wait");
        assert_eq!(a.step(true, false, true, 60.0), AutoStep::Nothing);
        assert_eq!(a.step(true, false, true, 60.0 + AUTO_STOP_S), AutoStep::Stop);
        assert_eq!(a.step(true, false, false, 200.0), AutoStep::Nothing);
        // A start that failed is not retried on every media event.
        assert_eq!(a.step(true, true, false, 300.0), AutoStep::Start);
        assert_eq!(a.step(true, true, false, 301.0), AutoStep::Nothing);
        assert_eq!(a.step(true, false, false, 302.0), AutoStep::Nothing);
        assert_eq!(a.step(true, true, false, 303.0), AutoStep::Start);
    }

    #[test]
    fn auto_captions_leave_the_persons_own_start_and_stop_alone() {
        let mut a = Auto::default();
        a.manual(true, false);
        assert_eq!(a.step(true, false, true, 0.0), AutoStep::Nothing);
        assert_eq!(a.step(true, false, true, 500.0), AutoStep::Nothing, "a manual start is never auto-stopped");
        // Stop pressed during a video: no restart until that video is over.
        a.manual(false, true);
        assert_eq!(a.step(true, true, false, 600.0), AutoStep::Nothing);
        assert_eq!(a.step(true, false, false, 601.0), AutoStep::Nothing);
        assert_eq!(a.step(true, true, false, 602.0), AutoStep::Start);
    }

    #[test]
    fn music_players_are_not_captioned_and_meetings_need_a_join_link() {
        assert!(captionable_app("Chrome") && captionable_app("MSTeams_8wekyb3d8bbwe!MSTeams"));
        assert!(!captionable_app("Spotify.exe") && !captionable_app("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"));
        let ev = |join: bool, all_day: bool| crate::calendar::Event {
            id: "e".into(),
            title: "Standup".into(),
            start: 100,
            end: 200,
            all_day,
            location: None,
            organizer: None,
            attendees: 0,
            join_url: join.then(|| "https://teams.microsoft.com/l/x".into()),
            recurring: false,
        };
        let cal = |e| crate::calendar::Calendar { sources: vec![], events: vec![e] };
        assert!(meeting_now(&cal(ev(true, false)), 150));
        assert!(!meeting_now(&cal(ev(true, false)), 200));
        assert!(!meeting_now(&cal(ev(false, false)), 150));
        assert!(!meeting_now(&cal(ev(true, true)), 150));
    }

    #[test]
    fn sound_turns_on_after_two_seconds_and_off_after_twenty_quiet() {
        let mut g = SoundGate::default();
        assert_eq!(g.step(0.5, 0.5), None, "a chime is not sound");
        for _ in 0..10 {
            assert_eq!(g.step(0.0, 0.5), None);
        }
        assert_eq!(g.step(0.5, 0.5), None, "the old blip was forgotten");
        assert_eq!(g.step(0.2, 0.5), None);
        assert_eq!(g.step(0.2, 0.5), None);
        assert_eq!(g.step(0.2, 0.5), Some(true));
        for _ in 0..39 {
            assert_eq!(g.step(0.0, 0.5), None, "a pause in speech keeps it on");
        }
        assert_eq!(g.step(0.0, 0.5), Some(false));
    }

    #[test]
    fn captions_without_translation_ask_for_none() {
        assert_eq!(caption_target(true, "en"), "en");
        assert_eq!(caption_target(false, "en"), NO_TRANSLATION);
        assert!(!needs_translation_model("auto", NO_TRANSLATION));
        assert!(translation_hint(Some(TranslateState::Missing), "auto", NO_TRANSLATION).is_none());
    }
}

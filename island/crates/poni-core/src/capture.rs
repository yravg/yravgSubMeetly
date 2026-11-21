//! System-audio captions, the pure half (ISL-002 on Windows): what the loopback
//! capture hands over (interleaved f32 at the device's rate) becomes the
//! windows the engine's `POST /draft` takes (16 kHz mono f32 little-endian,
//! about 4 s each, silence and sound that is not speech skipped). The WASAPI side is `poni`'s
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

/// `/draft` answered 503 `busy`: the speech model was still on an earlier window.
pub const ENGINE_BUSY: &str = "The speech model is still on an earlier caption.";

/// The engine answers but the speech model cannot keep up (a busy answer, or no answer in
/// time with the model loaded). `None` when the health body does not say the model is loaded.
pub fn slow_notice(health_body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(health_body).ok()?;
    if v.get("loaded").and_then(|l| l.get("asr")).and_then(|b| b.as_bool()) != Some(true) {
        return None;
    }
    let model = v.get("model").and_then(|m| m.as_str()).unwrap_or("The speech model");
    let model = model.rsplit('/').next().unwrap_or(model);
    let on = if v.get("device").and_then(|d| d.as_str()) == Some("cpu") { " on this computer's processor" } else { "" };
    Some(format!("Captions are falling behind: {model} is too slow{on}. Pick a smaller speech model in Settings \u{203a} Models."))
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

/// Speech keeps switching between voiced sounds (few zero crossings) and hiss such as s, f, t
/// (many), so the zero-crossing rate of its 20 ms slices spreads; a tone, a ringtone, a melody over
/// drums or steady noise keeps it nearly flat. The spread (standard deviation) measured on the SAPI
/// voices David and Huihui: 0.04-0.23 per 1.2 s; Windows' own ringtones and alarms mostly under
/// 0.035, a pure tone 0.002, white noise 0.03.
pub const VOICE_ZCR_SPREAD: f32 = 0.035;

/// Worth asking the speech model about: at least 100 ms of sound, and varied the way speech is
/// ([`VOICE_ZCR_SPREAD`]). What it turns away never reaches Whisper, which writes "Thanks for
/// watching!"-type lines over music and noise.
/// shortcut: a hand-made gate, not a trained voice detector: music with its own hiss (a singer,
/// a breathy flute) can still pass. Upgrade to Silero VAD once an ONNX runtime is a dependency.
pub fn sounds_like_speech(samples: &[f32]) -> bool {
    const SLICE: usize = RATE as usize / 50;
    let rates: Vec<f32> = samples
        .chunks_exact(SLICE)
        .filter(|s| !is_silent(s))
        .map(|s| s.windows(2).filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0)).count() as f32 / (SLICE - 1) as f32)
        .collect();
    if rates.len() < 5 {
        return false;
    }
    let n = rates.len() as f32;
    let mean = rates.iter().sum::<f32>() / n;
    (rates.iter().map(|r| (r - mean).powi(2)).sum::<f32>() / n).sqrt() >= VOICE_ZCR_SPREAD
}

/// Speech-shaped test sound at `rate`: 140 ms of a voiced buzz (150 Hz and three harmonics), then
/// 60 ms of hiss, over and over.
#[cfg(test)]
pub(crate) fn syllables(seconds: f32, rate: u32) -> Vec<f32> {
    let mut seed = 0x2545_f491u32;
    (0..(seconds * rate as f32) as usize)
        .map(|i| {
            let t = i as f32 / rate as f32;
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            if t % 0.2 < 0.14 {
                (1..=4).map(|h| 0.08 / h as f32 * (std::f32::consts::TAU * 150.0 * h as f32 * t).sin()).sum()
            } else {
                0.1 * ((seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5)
            }
        })
        .collect()
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

/// Device buffers in, engine windows out: downmix, resample, cut, drop what is not speech.
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
        let out = self.mono(interleaved);
        let mut windows = self.chunker.push(&out);
        windows.retain(|w| sounds_like_speech(w));
        windows
    }

    /// Device buffers in, one channel at [`RATE`] out (no windows): one side of a [`Mixer`].
    pub fn mono(&mut self, interleaved: &[f32]) -> Vec<f32> {
        let mono = downmix(interleaved, self.channels);
        let mut out = Vec::with_capacity(mono.len() / 2 + 1);
        self.resampler.push(&mono, &mut out);
        out
    }
}

/// What Live captions listen to (PMM-019): the room (the microphone), what this PC plays
/// (loopback), or both mixed into one stream (PMM-021).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Room,
    Pc,
    Both,
}

impl Source {
    pub const ALL: [Source; 3] = [Source::Room, Source::Pc, Source::Both];

    /// The settings value (`live_source`).
    pub fn key(self) -> &'static str {
        match self {
            Source::Room => "room",
            Source::Pc => "pc",
            Source::Both => "both",
        }
    }

    /// Room unless the value says otherwise (an old file has none).
    pub fn parse(s: &str) -> Self {
        match s {
            "pc" => Source::Pc,
            "both" => Source::Both,
            _ => Source::Room,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Source::Room => "Room",
            Source::Pc => "This PC",
            Source::Both => "Both",
        }
    }

    /// The microphone is part of it.
    pub fn room(self) -> bool {
        self != Source::Pc
    }

    /// What the PC plays is part of it.
    pub fn pc(self) -> bool {
        self != Source::Room
    }
}

/// Live's title for a room session nobody named (PMM-020).
pub const ROOM_TITLE: &str = "In-room meeting";

/// The microphone after `current` in Windows' list `ids` (empty = Windows' default): the default,
/// then each one, then the default again. A microphone no longer listed goes back to the default.
pub fn next_mic(ids: &[String], current: &str) -> String {
    if current.is_empty() {
        return ids.first().cloned().unwrap_or_default();
    }
    ids.iter().position(|id| id == current).and_then(|i| ids.get(i + 1)).cloned().unwrap_or_default()
}

pub const MIC_BLOCKED: &str = "Windows is blocking the microphone. Allow desktop apps to use the microphone, then try again. Nothing was recorded.";
pub const MIC_IN_USE: &str = "Another app holds the microphone for itself. Captions start when it lets go.";

/// The sentence for a microphone that would not open, by its HRESULT: Windows' privacy switch
/// (`E_ACCESSDENIED`) or an app holding it exclusively (`AUDCLNT_E_DEVICE_IN_USE`).
pub fn mic_open_problem(hresult: i32) -> Option<&'static str> {
    match hresult as u32 {
        0x8007_0005 => Some(MIC_BLOCKED),
        0x8889_000A => Some(MIC_IN_USE),
        _ => None,
    }
}

/// Which side of a hybrid meeting a line came from (PMM-021).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Room,
    Online,
}

/// Who a window's sound came from, for the line's speaker label: the room (the microphone) is
/// "You", what the machine plays is "Others". Engine-side acoustic labelling only works on a saved
/// file, so a live line gets this one, from the side it was heard on.
pub fn who(side: Option<Side>, mic_only: bool) -> &'static str {
    match side {
        Some(Side::Room) => "You",
        Some(Side::Online) => "Others",
        None if mic_only => "You",
        None => "Others",
    }
}

/// A line as the session keeps it: with "Both" its side in front, so the minutes tell them apart.
/// shortcut: the side rides in the text, since the engine keeps only t0/t1/source/translation per
/// transcript line; give lines a `side` field once the engine stores one.
pub fn tagged(side: Option<Side>, text: &str) -> String {
    match side {
        Some(Side::Room) => format!("[Room] {text}"),
        Some(Side::Online) => format!("[Online] {text}"),
        None => text.to_string(),
    }
}

/// "Both": the microphone and the PC's sound (each mono at [`RATE`]) into one window for the
/// engine, tagged with the louder side. The mic sets the pace: loopback delivers nothing while the
/// PC plays nothing, so a missing PC part is silence, and at most two windows of it wait.
/// shortcut: the two clocks are not aligned beyond that; a drift under one window is fine for
/// captions.
#[derive(Default)]
pub struct Mixer {
    mic: Vec<f32>,
    pc: Vec<f32>,
}

impl Mixer {
    pub fn push(&mut self, mic: &[f32], pc: &[f32]) -> Vec<(Vec<f32>, Side)> {
        let window = WINDOW_S * RATE as usize;
        self.mic.extend_from_slice(mic);
        self.pc.extend_from_slice(pc);
        let extra = self.pc.len().saturating_sub(2 * window);
        self.pc.drain(..extra);
        let mut out = Vec::new();
        while self.mic.len() >= window {
            let rest = self.mic.split_off(window);
            let m = std::mem::replace(&mut self.mic, rest);
            let p: Vec<f32> = self.pc.drain(..window.min(self.pc.len())).collect();
            let side = if rms(&p) > rms(&m) { Side::Online } else { Side::Room };
            let mixed: Vec<f32> = m.iter().enumerate().map(|(i, s)| (s + p.get(i).copied().unwrap_or(0.0)).clamp(-1.0, 1.0)).collect();
            if sounds_like_speech(&mixed) {
                out.push((mixed, side));
            }
        }
        out
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

/// Captions tab › Show (PMM-026): what the pill prints for each caption line.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Show {
    /// The spoken line, its translation under it (as before).
    #[default]
    Both,
    Original,
    Translation,
}

impl Show {
    pub const ALL: [Show; 3] = [Show::Original, Show::Translation, Show::Both];

    pub fn key(self) -> &'static str {
        match self {
            Show::Both => "both",
            Show::Original => "original",
            Show::Translation => "translation",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Show::Both => "Both",
            Show::Original => "Original",
            Show::Translation => "Translation",
        }
    }

    pub fn parse(s: &str) -> Self {
        Self::ALL.into_iter().find(|v| v.key() == s.trim()).unwrap_or_default()
    }

    /// (the main line, the line under it) for one caption. A missing translation never leaves a
    /// blank page: the spoken line stands in.
    pub fn parts<'a>(self, source: &'a str, translation: &'a str) -> (&'a str, Option<&'a str>) {
        let has = !translation.trim().is_empty();
        match self {
            Show::Original => (source, None),
            Show::Translation if has => (translation, None),
            Show::Translation => (source, None),
            Show::Both => (source, has.then_some(translation)),
        }
    }
}

/// Captions tab › Font size (board P09): the size in px of the main caption line on Live, as drawn
/// ("15 px"). 15 is today's Live size, so the default changes nothing; every other caption style
/// (Meeting 13, translation 12 ...) scales by the same ratio, so one number sizes them all.
pub const FONT_DEFAULT: u32 = 15;
pub const FONT_MIN: u32 = 12;
pub const FONT_MAX: u32 = 24;

/// The size in px to use. A settings file from before 1.3.9 stored a step (`step` -2..4, added to
/// the size in px) and no `px` (0): that becomes 15 + step, once; the Captions tab then writes `px`.
pub fn resolve_px(px: u32, step: i32) -> u32 {
    let px = if px == 0 { (FONT_DEFAULT as i32 + step).max(0) as u32 } else { px };
    px.clamp(FONT_MIN, FONT_MAX)
}

/// A caption style's size (`base` at the default) for the chosen `px`.
pub fn scale_px(base: f32, px: u32) -> f32 {
    base * px.clamp(FONT_MIN, FONT_MAX) as f32 / FONT_DEFAULT as f32
}

/// One press of - (-1) or + (+1) is 1 px, stopping at the ends.
pub fn step_px(px: u32, d: i32) -> u32 {
    (px as i32 + d.signum()).clamp(FONT_MIN as i32, FONT_MAX as i32) as u32
}

/// The latency readout printed after a line, as on board P12: "[ 820 ms ]".
pub fn readout(ms: u32) -> String {
    format!("[ {ms} ms ]")
}

/// The path of an interim (PMM-025): the spoken text only, so no translation model runs for a line
/// that the next post replaces, and the engine does not keep it as its live caption.
pub fn interim_draft_path(src: &str) -> String {
    format!("/draft?src={src}&tgt={NO_TRANSLATION}&interim=1")
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

    /// Windows' privacy switch keeps the microphone closed ([`MIC_BLOCKED`]).
    pub fn mic_blocked(&self) -> bool {
        matches!(self, CaptureState::Warn(m) if m == MIC_BLOCKED)
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

/// A Stop the person pressed, or an auto start that failed, holds until the reason has been gone
/// this long. Browsers report paused/playing pairs within a second while seeking or buffering
/// (poni.log: "meeting source: none" then "media" in the same second), which must not undo a Stop.
pub const AUTO_HOLD_S: f64 = 30.0;

/// What [`Auto::step`] asks the island to do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AutoStep {
    Start,
    Stop,
    Nothing,
}

/// Captions that start by themselves (Settings: `auto_captions`). Captions it started stop once
/// the reason is gone for [`AUTO_STOP_S`]; captions the person started are never stopped by it,
/// and a Stop the person presses holds until the reason has been gone for [`AUTO_HOLD_S`].
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
            self.idle_since = None;
        }
        if !enabled {
            return AutoStep::Nothing;
        }
        if wanted {
            if self.idle_since.is_some_and(|t| now - t >= AUTO_HOLD_S) {
                self.held = false;
            }
            self.idle_since = None;
            if !running && !self.held {
                self.started = true;
                return AutoStep::Start;
            }
            return AutoStep::Nothing;
        }
        let since = *self.idle_since.get_or_insert(now);
        if self.started && now - since >= AUTO_STOP_S {
            self.started = false;
            self.idle_since = None;
            return AutoStep::Stop;
        }
        AutoStep::Nothing
    }

    /// The person pressed Start (`on`) or Stop at `now`. A Stop holds whatever plays: nothing
    /// restarts captions until the reason has been gone for [`AUTO_HOLD_S`] and comes back.
    pub fn manual(&mut self, on: bool, wanted: bool, now: f64) {
        self.started = false;
        self.held = !on;
        self.idle_since = (!on && !wanted).then_some(now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_listens_to_the_room_unless_told_otherwise() {
        assert_eq!(Source::parse(""), Source::Room, "an old settings file has no source");
        assert_eq!(Source::parse("nope"), Source::Room);
        for s in Source::ALL {
            assert_eq!(Source::parse(s.key()), s);
        }
        assert!(Source::Room.room() && !Source::Room.pc());
        assert!(!Source::Pc.room() && Source::Pc.pc());
        assert!(Source::Both.room() && Source::Both.pc());
    }

    #[test]
    fn a_blocked_or_held_microphone_is_said_in_plain_words() {
        assert_eq!(mic_open_problem(0x8007_0005_u32 as i32), Some(MIC_BLOCKED));
        assert_eq!(mic_open_problem(0x8889_000A_u32 as i32), Some(MIC_IN_USE));
        assert_eq!(mic_open_problem(0x8000_4005_u32 as i32), None);
        assert!(CaptureState::Warn(MIC_BLOCKED.into()).mic_blocked());
        assert!(!CaptureState::Warn(MIC_IN_USE.into()).mic_blocked());
    }

    #[test]
    fn both_mixes_the_room_and_the_pc_and_says_which_was_louder() {
        let w = WINDOW_S * RATE as usize;
        let talk = syllables(WINDOW_S as f32, RATE);
        let scaled = |k: f32| -> Vec<f32> { talk.iter().map(|s| s * k).collect() };
        let mut m = Mixer::default();
        // Room speech, the PC quiet: one window, tagged Room, the mix is the sum.
        let out = m.push(&talk, &scaled(0.1));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].1, Side::Room);
        assert!((out[0].0[100] - talk[100] * 1.1).abs() < 1e-6);
        // The call louder than the room: Online.
        let out = m.push(&scaled(0.1), &scaled(2.0));
        assert_eq!(out[0].1, Side::Online);
        // Loopback gives nothing while the PC plays nothing: the mic still makes windows.
        let out = m.push(&talk, &[]);
        assert_eq!((out.len(), out[0].1), (1, Side::Room));
        // Silence from both is dropped, like a single source's, and so is a steady hum.
        assert!(m.push(&vec![0.0; w], &vec![0.0; w]).is_empty());
        assert!(m.push(&vec![0.2; w], &vec![0.01; w]).is_empty());
        // Sums past full scale are clipped, not wrapped.
        let out = m.push(&scaled(15.0), &scaled(15.0));
        assert!(out[0].0.iter().all(|s| s.abs() <= 1.0) && out[0].0.contains(&1.0));
    }

    #[test]
    fn the_pc_side_cannot_pile_up_behind_the_mic() {
        let w = WINDOW_S * RATE as usize;
        let mut m = Mixer::default();
        // Ten windows of PC sound and no mic: only the newest two are kept.
        assert!(m.push(&[], &vec![0.3; 10 * w]).is_empty());
        assert_eq!(m.pc.len(), 2 * w);
    }

    #[test]
    fn the_mic_chip_steps_through_windows_microphones_and_back_to_the_default() {
        let ids = vec!["a".to_string(), "b".to_string()];
        assert_eq!(next_mic(&ids, ""), "a");
        assert_eq!(next_mic(&ids, "a"), "b");
        assert_eq!(next_mic(&ids, "b"), "", "after the last: Windows' default");
        assert_eq!(next_mic(&ids, "gone"), "", "an unplugged mic goes back to the default");
        assert_eq!(next_mic(&[], ""), "");
    }

    #[test]
    fn a_tagged_line_says_its_side() {
        assert_eq!(tagged(Some(Side::Room), "hello"), "[Room] hello");
        assert_eq!(tagged(Some(Side::Online), "hi"), "[Online] hi");
        assert_eq!(tagged(None, "hi"), "hi");
    }

    #[test]
    fn only_the_missing_model_sentence_asks_for_a_download() {
        assert!(CaptureState::Warn(SPEECH_MISSING.into()).needs_model());
        let health = r#"{"ok":true,"model":"openai/whisper-medium","device":"cpu","loaded":{"asr":true}}"#;
        assert_eq!(slow_notice(health).as_deref(), Some("Captions are falling behind: whisper-medium is too slow on this computer's processor. Pick a smaller speech model in Settings \u{203a} Models."));
        assert_eq!(slow_notice(r#"{"ok":true,"loaded":{"asr":false}}"#), None);
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
        // Stereo 48 kHz: 2 s speech then 6 s quiet = two 4 s windows; only the first carries sound.
        let mut p = Pipeline::new(48_000, 2);
        let loud: Vec<f32> = syllables(2.0, 48_000).iter().flat_map(|s| [*s, *s]).collect();
        let quiet = vec![0.0f32; 96_000 * 6];
        assert!(p.feed(&loud).is_empty(), "2 s is not a window yet");
        let got = p.feed(&quiet);
        assert_eq!(got.len(), 1, "the quiet window is dropped");
        assert_eq!(got[0].len(), WINDOW_S * RATE as usize);
        assert!(!is_silent(&got[0]));
    }

    /// A 16-bit mono PCM WAV fixture (the SAPI voices, 16 kHz) as samples.
    fn wav(bytes: &[u8]) -> Vec<f32> {
        let at = bytes.windows(4).position(|w| w == b"data").expect("a data chunk") + 8;
        bytes[at..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect()
    }

    const DAVID: &[u8] = include_bytes!("../tests/fixtures/voice/david-en.wav");
    const HUIHUI: &[u8] = include_bytes!("../tests/fixtures/voice/huihui-zh.wav");

    #[test]
    fn the_voice_gate_lets_both_sapi_voices_through() {
        for (name, clip) in [("David", wav(DAVID)), ("Huihui", wav(HUIHUI))] {
            assert!(sounds_like_speech(&clip), "{name}, all 4 s");
            // 1.2 s, what an early interim holds: a stretch of vowels alone (Huihui's third) may wait
            // for more speech, since the final looks at the whole utterance.
            let parts: Vec<bool> = clip.chunks_exact(19_200).map(sounds_like_speech).collect();
            assert!(parts.iter().filter(|p| **p).count() * 3 >= parts.len() * 2, "{name}: {parts:?}");
        }
    }

    #[test]
    fn the_voice_gate_turns_away_a_tone_noise_and_a_melody_over_drums() {
        let tau = std::f32::consts::TAU;
        let t = |i: usize| i as f32 / RATE as f32;
        let n = 4 * RATE as usize;
        let mut seed = 7u32;
        let mut noise = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        };
        let tone: Vec<f32> = (0..n).map(|i| 0.2 * (tau * 440.0 * t(i)).sin()).collect();
        let hiss: Vec<f32> = (0..n).map(|_| 0.1 * noise()).collect();
        // A note every 0.5 s (with harmonics, decaying), a kick on each note, a hi-hat every 0.25 s.
        let band: Vec<f32> = (0..n)
            .map(|i| {
                let (note, beat) = (t(i) % 0.5, t(i) % 0.25);
                let f = [262.0, 330.0, 392.0, 523.0][(t(i) / 0.5) as usize % 4];
                let melody = 0.15 * (-note * 3.0).exp() * ((tau * f * note).sin() + 0.5 * (2.0 * tau * f * note).sin());
                let kick = 0.3 * (-note * 25.0).exp() * (tau * 70.0 * note).sin();
                let hat = if beat < 0.04 { 0.05 * (-beat * 80.0).exp() * noise() } else { 0.0 };
                melody + kick + hat
            })
            .collect();
        for (name, clip) in [("silence", vec![0.0; n]), ("tone", tone), ("white noise", hiss), ("melody over drums", band)] {
            assert!(!sounds_like_speech(&clip), "{name}");
        }
        assert!(sounds_like_speech(&syllables(1.2, RATE)), "the synthetic speech the other tests use");
    }

    /// Before/after on music: Windows' own ringtones, alarms and theme sounds (16-bit PCM WAVs under
    /// C:\Windows\Media), cut into the 4 s windows of [`Pipeline`] and through [`Utterances`].
    /// `cargo test -p poni-core -- --ignored --nocapture music_windows`
    #[test]
    #[ignore = "measures local files"]
    fn music_windows_before_and_after_the_voice_gate() {
        let (mut before, mut after, mut windows, mut posts, mut finals) = (0, 0, 0, 0, 0);
        let mut paths: Vec<_> = std::fs::read_dir(r"C:\Windows\Media").into_iter().flatten().flatten().map(|e| e.path()).collect();
        paths.sort();
        for path in paths.iter().filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("wav"))) {
            let Ok(bytes) = std::fs::read(path) else { continue };
            // fmt chunk: channels at 22, rate at 24, bits at 34.
            if bytes.len() < 44 || u16::from_le_bytes([bytes[34], bytes[35]]) != 16 {
                continue;
            }
            let channels = u16::from_le_bytes([bytes[22], bytes[23]]) as usize;
            let rate = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]);
            let mut mono = Pipeline::new(rate, channels).mono(&wav(&bytes));
            // Played twice over: most of these are shorter than one window.
            mono.extend(mono.clone());
            for w in mono.chunks_exact(WINDOW_S * RATE as usize) {
                windows += 1;
                before += usize::from(!is_silent(w));
                after += usize::from(sounds_like_speech(w));
            }
            let mut u = crate::utterance::Utterances::new(Default::default());
            let got = u.push(&mono);
            finals += got.iter().filter(|p| p.last).count() + usize::from(u.flush().is_some());
            posts = posts + got.len();
        }
        println!("4 s windows: {windows}; sent before {before}, after {after}; utterance posts {posts} (finals {finals})");
    }

    #[test]
    fn the_request_body_is_little_endian_f32() {
        assert_eq!(pcm_bytes(&[1.0, -2.0]), [0, 0, 0x80, 0x3f, 0, 0, 0, 0xc0]);
    }

    #[test]
    fn show_picks_the_main_line_and_the_one_under_it() {
        // Both is today's look: the spoken line, its translation under it.
        assert_eq!(Show::Both.parts("hello", "hola"), ("hello", Some("hola")));
        assert_eq!(Show::Original.parts("hello", "hola"), ("hello", None));
        assert_eq!(Show::Translation.parts("hello", "hola"), ("hola", None));
        // No translation yet (off, loading, an interim): never a blank line, the spoken one stands.
        assert_eq!(Show::Translation.parts("hello", ""), ("hello", None));
        assert_eq!(Show::Both.parts("hello", ""), ("hello", None));
        assert_eq!(Show::parse("original"), Show::Original);
        assert_eq!(Show::parse("junk"), Show::Both);
        assert!(Show::ALL.iter().all(|s| Show::parse(s.key()) == *s));
    }

    #[test]
    fn the_font_step_is_clamped_and_never_shrinks_text_below_readable() {
        assert_eq!(scale_px(15.0, 15), 15.0, "the default changes nothing");
        assert_eq!(scale_px(13.0, 15), 13.0);
        assert_eq!(scale_px(12.0, 30), 12.0 * 24.0 / 15.0, "capped at the top");
        assert_eq!(resolve_px(0, 0), 15, "an old file with no step is today's size");
        assert_eq!(resolve_px(0, 3), 18, "an old step is turned into px");
        assert_eq!(resolve_px(0, -99), FONT_MIN);
        assert_eq!(resolve_px(20, 3), 20, "a stored px wins over an old step");
        assert_eq!(readout(820), "[ 820 ms ]");
        // The interim is lighter than a kept line (dim vs full text) and still reads: WCAG 3:1 for the
        // dim colour, 4.5:1 for the text, against the darkest and the lightest ground the pill has.
        for ground in [[0.04f32; 3], [0.15; 3]] {
            assert!(crate::glass::contrast([0.62; 3], ground) >= 3.0, "interim text");
            assert!(crate::glass::contrast([0.96; 3], ground) >= 4.5, "text");
        }
        assert_eq!(step_px(15, 1), 16);
        assert_eq!(step_px(FONT_MAX, 1), FONT_MAX, "stops at the end");
        assert_eq!(step_px(FONT_MIN, -1), FONT_MIN);
    }

    #[test]
    fn the_draft_path_names_both_languages() {
        assert_eq!(draft_path("auto", "en"), "/draft?src=auto&tgt=en");
        // An interim asks for the spoken text only (no translation) and is not the engine's live line.
        assert_eq!(interim_draft_path("zh"), "/draft?src=zh&tgt=none&interim=1");
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
        assert_eq!(a.step(true, true, false, 303.0), AutoStep::Nothing, "a flip is not the end of the reason");
        assert_eq!(a.step(true, false, false, 304.0), AutoStep::Nothing);
        assert_eq!(a.step(true, true, false, 304.0 + AUTO_HOLD_S), AutoStep::Start);
    }

    #[test]
    fn auto_captions_leave_the_persons_own_start_and_stop_alone() {
        let mut a = Auto::default();
        a.manual(true, false, 0.0);
        assert_eq!(a.step(true, false, true, 0.0), AutoStep::Nothing);
        assert_eq!(a.step(true, false, true, 500.0), AutoStep::Nothing, "a manual start is never auto-stopped");
        // Stop pressed during a video: no restart until that video is over.
        a.manual(false, true, 599.0);
        assert_eq!(a.step(true, true, false, 600.0), AutoStep::Nothing);
        assert_eq!(a.step(true, false, false, 601.0), AutoStep::Nothing);
        assert_eq!(a.step(true, true, false, 602.0), AutoStep::Nothing, "a one-second pause does not undo a Stop");
        assert_eq!(a.step(true, false, false, 603.0), AutoStep::Nothing);
        assert_eq!(a.step(true, true, false, 603.0 + AUTO_HOLD_S), AutoStep::Start, "the next video, after a real end");
        // Stop pressed in silence: the next sound a moment later does not undo it either.
        a.manual(false, false, 1000.0);
        assert_eq!(a.step(true, true, false, 1005.0), AutoStep::Nothing);
        assert_eq!(a.step(true, false, false, 1006.0), AutoStep::Nothing);
        assert_eq!(a.step(true, true, false, 1006.0 + AUTO_HOLD_S), AutoStep::Start);
    }

    #[test]
    fn a_flip_storm_neither_stops_running_captions_nor_restarts_stopped_ones() {
        // poni.log 2026-11-21 14:43:20-14:47:37: about 30 media/none flips in under 5 minutes.
        let mut a = Auto::default();
        assert_eq!(a.step(true, true, false, 0.0), AutoStep::Start);
        let flips = (1..600).map(|i| (i as f64 * 0.5, i % 2 == 0));
        for (t, wanted) in flips.clone() {
            assert_eq!(a.step(true, wanted, true, t), AutoStep::Nothing, "auto-started, flip at {t}");
        }
        a.manual(false, true, 300.0);
        for (t, wanted) in flips {
            assert_eq!(a.step(true, wanted, false, 300.0 + t), AutoStep::Nothing, "stopped by hand, flip at {t}");
        }
    }

    #[test]
    fn device_loss_keeps_auto_captions_and_a_failed_start_waits_for_the_reason_to_end() {
        let mut a = Auto::default();
        assert_eq!(a.step(true, true, false, 0.0), AutoStep::Start);
        // A headset that goes away is a Warn ("Reconnecting"): the capture still runs.
        assert_eq!(a.step(true, true, true, 5.0), AutoStep::Nothing);
        // Capture failed for good (no output device): not retried on each media event.
        for t in 6..200 {
            assert_eq!(a.step(true, true, false, t as f64), AutoStep::Nothing, "retry at {t}");
        }
        assert_eq!(a.step(true, false, false, 200.0), AutoStep::Nothing);
        assert_eq!(a.step(true, true, false, 200.0 + AUTO_HOLD_S), AutoStep::Start);
        // The setting off: nothing starts, nothing is stopped.
        assert_eq!(a.step(false, false, true, 1000.0), AutoStep::Nothing);
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
    fn a_live_window_is_you_or_others() {
        assert_eq!(who(Some(Side::Room), false), "You");
        assert_eq!(who(Some(Side::Online), true), "Others");
        assert_eq!(who(None, true), "You");
        assert_eq!(who(None, false), "Others");
    }

    #[test]
    fn captions_without_translation_ask_for_none() {
        assert_eq!(caption_target(true, "en"), "en");
        assert_eq!(caption_target(false, "en"), NO_TRANSLATION);
        assert!(!needs_translation_model("auto", NO_TRANSLATION));
        assert!(translation_hint(Some(TranslateState::Missing), "auto", NO_TRANSLATION).is_none());
    }
}

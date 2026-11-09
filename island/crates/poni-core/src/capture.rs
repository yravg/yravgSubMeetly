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

    /// The sentence to show, if there is a problem.
    pub fn problem(&self) -> Option<&str> {
        match self {
            CaptureState::Warn(m) | CaptureState::Failed(m) => Some(m),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}

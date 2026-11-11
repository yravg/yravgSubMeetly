//! PMM-025: the utterance buffer. Today's `Chunker` cuts fixed 4 s windows, so the first words of a
//! sentence wait for the window to fill (about 4 s) plus the engine's time. This buffer keeps the
//! whole utterance since speech began and hands back a snapshot of it every [`INTERIM_S`] while the
//! person is still talking (an interim: the page shows it and the next one replaces it), then a
//! last snapshot when the speaker pauses for [`HANG_S`] or the utterance reaches [`MAX_S`] (the
//! final line, which is translated and kept). Pure: audio in, posts out, no clock; the caller
//! decides what an interim costs (the island asks the engine for the spoken text only).

use crate::capture::{is_silent, RATE};

/// One analysis frame: 100 ms of 16 kHz mono.
const FRAME: usize = RATE as usize / 10;

/// How much new audio makes the next interim, in seconds.
pub const INTERIM_S: f32 = 1.2;
/// Silence that ends an utterance, in seconds.
pub const HANG_S: f32 = 0.7;
/// An utterance never grows past this: a final goes out and the next begins.
pub const MAX_S: f32 = 15.0;
/// Speech shorter than this is a click or a cough; it makes no line (unless an interim already went out).
pub const MIN_SPEECH_S: f32 = 0.3;

/// What the buffer hands to the engine.
#[derive(Clone, Debug, PartialEq)]
pub struct Post {
    /// The whole utterance so far, 16 kHz mono.
    pub samples: Vec<f32>,
    /// The final snapshot: translate it and keep it. Otherwise an interim that the next post replaces.
    pub last: bool,
}

/// The timing the buffer was made with (`Latency` picks one).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Timing {
    /// Seconds of new audio between interims; 0 = no interims (a final per utterance only).
    pub interim_s: f32,
    pub hang_s: f32,
    pub max_s: f32,
}

impl Default for Timing {
    fn default() -> Self {
        Self { interim_s: INTERIM_S, hang_s: HANG_S, max_s: MAX_S }
    }
}

/// Settings › Captions › Latency (PMM-026): how soon text shows against how careful it is. Each mode
/// is a timing, whether the engine uses its full translator for finals, and the engine's own model
/// rows it runs best on (`Command::ModelSelect` switches to them when they are on disk).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Latency {
    Fast,
    #[default]
    Balanced,
    Accurate,
}

impl Latency {
    pub const ALL: [Latency; 3] = [Latency::Fast, Latency::Balanced, Latency::Accurate];

    pub fn key(self) -> &'static str {
        match self {
            Latency::Fast => "fast",
            Latency::Balanced => "balanced",
            Latency::Accurate => "accurate",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Latency::Fast => "Fast",
            Latency::Balanced => "Balanced",
            Latency::Accurate => "Accurate",
        }
    }

    pub fn parse(s: &str) -> Self {
        Self::ALL.into_iter().find(|l| l.key() == s.trim()).unwrap_or_default()
    }

    pub fn timing(self) -> Timing {
        match self {
            Latency::Fast => Timing { interim_s: 0.8, hang_s: 0.5, max_s: 10.0 },
            Latency::Balanced => Timing::default(),
            Latency::Accurate => Timing { interim_s: 0.0, hang_s: 1.0, max_s: 20.0 },
        }
    }

    /// The engine's full translator for final lines (`/draft?accurate=1`) instead of its fast path.
    pub fn accurate(self) -> bool {
        self == Latency::Accurate
    }

    /// The (speech, translation) rows of the engine's catalog this mode runs on.
    pub fn models(self) -> (&'static str, &'static str) {
        match self {
            Latency::Fast => ("openai/whisper-base", "unsloth/Qwen3-0.6B-GGUF"),
            Latency::Balanced => ("openai/whisper-base", "unsloth/Qwen3-1.7B-GGUF"),
            Latency::Accurate => ("openai/whisper-small", "unsloth/Qwen3-1.7B-GGUF"),
        }
    }
}

/// The poster keeps one waiting window (newest wins). May a post that came in (`new_last`) take the
/// place of the one still waiting (`old_last`)? Only an interim must never drop a final line.
pub fn replaces(old_last: bool, new_last: bool) -> bool {
    new_last || !old_last
}

#[derive(Default)]
pub struct Utterances {
    timing: Timing,
    /// Audio of the frame in progress.
    frame: Vec<f32>,
    /// The utterance so far.
    buf: Vec<f32>,
    speech_frames: usize,
    silent_run: usize,
    since_post: usize,
    posted_interim: bool,
}

impl Utterances {
    pub fn new(timing: Timing) -> Self {
        Self { timing, ..Self::default() }
    }

    /// Feed audio (any length); the posts it completes, oldest first.
    pub fn push(&mut self, samples: &[f32]) -> Vec<Post> {
        let mut out = Vec::new();
        self.frame.extend_from_slice(samples);
        while self.frame.len() >= FRAME {
            let frame: Vec<f32> = self.frame.drain(..FRAME).collect();
            if let Some(post) = self.step(&frame) {
                out.push(post);
            }
        }
        out
    }

    /// A new timing from the next frame on (a Latency change); what was heard so far is kept.
    pub fn set_timing(&mut self, timing: Timing) {
        self.timing = timing;
    }

    /// Capture stopped: the utterance in progress, if it had speech.
    pub fn flush(&mut self) -> Option<Post> {
        self.frame.clear();
        self.finish()
    }

    fn frames(seconds: f32) -> usize {
        (seconds * 10.0).round() as usize
    }

    /// One 100 ms frame.
    fn step(&mut self, frame: &[f32]) -> Option<Post> {
        let silent = is_silent(frame);
        if self.buf.is_empty() && silent {
            return None;
        }
        self.buf.extend_from_slice(frame);
        self.since_post += 1;
        if silent {
            self.silent_run += 1;
        } else {
            self.silent_run = 0;
            self.speech_frames += 1;
        }
        if self.silent_run >= Self::frames(self.timing.hang_s) || self.buf.len() >= Self::frames(self.timing.max_s) * FRAME {
            return self.finish();
        }
        let every = Self::frames(self.timing.interim_s);
        // Interims only while there is speech to show: not through a pause that has not yet ended it.
        if every > 0 && self.since_post >= every && self.silent_run == 0 {
            self.since_post = 0;
            self.posted_interim = true;
            return Some(Post { samples: self.buf.clone(), last: false });
        }
        None
    }

    /// End the utterance: its final post, or nothing for a blip that never showed.
    fn finish(&mut self) -> Option<Post> {
        let enough = self.speech_frames >= Self::frames(MIN_SPEECH_S);
        let shown = self.posted_interim;
        let samples = std::mem::take(&mut self.buf);
        (self.speech_frames, self.silent_run, self.since_post, self.posted_interim) = (0, 0, 0, false);
        (!samples.is_empty() && (enough || shown)).then_some(Post { samples, last: true })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: usize = RATE as usize;

    fn speech(seconds: f32) -> Vec<f32> {
        (0..(seconds * R as f32) as usize).map(|i| 0.2 * ((i as f32) * 0.05).sin()).collect()
    }

    fn quiet(seconds: f32) -> Vec<f32> {
        vec![0.0; (seconds * R as f32) as usize]
    }

    /// Feed `audio` in 20 ms slices, as a capture device would; every post with the seconds of audio
    /// fed when it came out.
    fn run(u: &mut Utterances, audio: &[f32]) -> Vec<(f32, Post)> {
        let step = R / 50;
        let mut out = Vec::new();
        for (i, c) in audio.chunks(step).enumerate() {
            let at = ((i * step + c.len()) as f32) / R as f32;
            out.extend(u.push(c).into_iter().map(|p| (at, p)));
        }
        out
    }

    #[test]
    fn the_first_interim_comes_after_1_2_s_of_speech_not_after_a_4_s_window() {
        let mut u = Utterances::new(Timing::default());
        let posts = run(&mut u, &speech(3.0));
        let (at, first) = &posts[0];
        assert!(!first.last, "still talking: an interim");
        assert!((1.1..=1.3).contains(at), "first interim at {at} s of audio");
        // The old chunker had nothing before 4 s.
        let mut c = crate::capture::Chunker::new(4 * R);
        assert!(c.push(&speech(3.9)).is_empty(), "a 4 s window is not ready at 3.9 s");
    }

    #[test]
    fn interims_grow_and_each_holds_the_whole_utterance_so_far() {
        let mut u = Utterances::new(Timing::default());
        let posts = run(&mut u, &speech(4.0));
        let lens: Vec<f32> = posts.iter().map(|(_, p)| p.samples.len() as f32 / R as f32).collect();
        assert_eq!(lens.len(), 3, "1.2 s, 2.4 s, 3.6 s: {lens:?}");
        assert!(lens.windows(2).all(|w| w[1] > w[0] + 1.0), "{lens:?}");
        assert!(posts.iter().all(|(_, p)| !p.last));
    }

    #[test]
    fn a_pause_ends_the_utterance_with_a_final_and_the_next_one_starts_clean() {
        let mut u = Utterances::new(Timing::default());
        let mut audio = speech(2.0);
        audio.extend(quiet(1.0));
        audio.extend(speech(1.5));
        let posts = run(&mut u, &audio);
        let finals: Vec<&(f32, Post)> = posts.iter().filter(|(_, p)| p.last).collect();
        assert_eq!(finals.len(), 1, "one final so far");
        let (at, fin) = finals[0];
        assert!((2.6..=2.9).contains(at), "the final comes about 0.7 s after speech stopped: {at}");
        assert!(fin.samples.len() as f32 / R as f32 >= 2.0);
        // The utterance after the pause is not carrying the first one's audio.
        let after: Vec<&(f32, Post)> = posts.iter().filter(|(t, _)| *t > 3.0).collect();
        assert!(after.iter().all(|(_, p)| p.samples.len() as f32 / (R as f32) <= 1.6), "fresh buffer");
    }

    #[test]
    fn a_long_utterance_is_finalised_at_the_cap() {
        let mut u = Utterances::new(Timing::default());
        let posts = run(&mut u, &speech(16.0));
        let fin = posts.iter().find(|(_, p)| p.last).expect("a final at the cap");
        assert!((14.9..=15.2).contains(&fin.0), "at {}", fin.0);
    }

    #[test]
    fn silence_alone_and_a_blip_make_no_line() {
        let mut u = Utterances::new(Timing::default());
        assert!(run(&mut u, &quiet(5.0)).is_empty());
        let mut audio = speech(0.1);
        audio.extend(quiet(2.0));
        assert!(run(&mut u, &audio).is_empty(), "a 0.1 s click is not speech");
        assert!(u.flush().is_none());
    }

    #[test]
    fn a_blip_after_an_interim_still_ends_with_a_final_so_the_interim_is_replaced() {
        let mut u = Utterances::new(Timing::default());
        let mut audio = speech(1.3);
        audio.extend(quiet(1.0));
        let posts = run(&mut u, &audio);
        assert!(!posts[0].1.last);
        assert!(posts.last().is_some_and(|(_, p)| p.last), "{} posts", posts.len());
    }

    #[test]
    fn no_interims_when_the_timing_says_so() {
        let mut u = Utterances::new(Timing { interim_s: 0.0, ..Timing::default() });
        let mut audio = speech(3.0);
        audio.extend(quiet(1.0));
        let posts = run(&mut u, &audio);
        assert_eq!(posts.len(), 1);
        assert!(posts[0].1.last);
    }

    #[test]
    fn each_latency_mode_has_its_own_timing_and_real_model_rows() {
        let (f, b, a) = (Latency::Fast, Latency::Balanced, Latency::Accurate);
        assert!(f.timing().interim_s < b.timing().interim_s, "Fast shows text sooner");
        assert_eq!(b.timing(), Timing::default(), "Balanced is the default timing");
        assert_eq!(a.timing().interim_s, 0.0, "Accurate sends whole utterances only");
        assert!(a.accurate() && !f.accurate() && !b.accurate());
        // Rows of the engine's catalog (`engine-rs/engine/src/models.rs`).
        assert_eq!(f.models(), ("openai/whisper-base", "unsloth/Qwen3-0.6B-GGUF"));
        assert_eq!(b.models(), ("openai/whisper-base", "unsloth/Qwen3-1.7B-GGUF"));
        assert_eq!(a.models(), ("openai/whisper-small", "unsloth/Qwen3-1.7B-GGUF"));
        assert_eq!(Latency::parse("fast"), f);
        assert_eq!(Latency::parse("nonsense"), b, "an unknown value reads as Balanced");
        assert!([f, b, a].iter().all(|l| Latency::parse(l.key()) == *l));
    }

    #[test]
    fn a_new_timing_shapes_the_next_utterance_without_losing_the_one_in_progress() {
        let mut u = Utterances::new(Timing::default());
        let first = run(&mut u, &speech(1.0));
        assert!(first.is_empty(), "no interim yet at 1.0 s");
        u.set_timing(Latency::Accurate.timing());
        let more = run(&mut u, &speech(3.0));
        assert!(more.iter().all(|(_, p)| p.last), "Accurate sends no interims: {} posts", more.len());
        // The audio already heard is still in the utterance that the next final carries.
        let mut tail = quiet(1.2);
        tail.extend(speech(0.0));
        let fin = run(&mut u, &tail);
        assert!(fin.iter().any(|(_, p)| p.last && p.samples.len() as f32 / R as f32 >= 4.0));
    }

    #[test]
    fn an_interim_never_replaces_a_final_the_poster_has_not_taken() {
        assert!(replaces(false, false), "a newer interim beats an older one");
        assert!(replaces(false, true), "a final beats an interim");
        assert!(!replaces(true, false), "an interim must not drop a final line");
        assert!(replaces(true, true), "newest final wins, as windows always did");
    }

    #[test]
    fn stopping_hands_back_what_was_said() {
        let mut u = Utterances::new(Timing::default());
        let _ = run(&mut u, &speech(0.8));
        let last = u.flush().expect("speech in progress");
        assert!(last.last && last.samples.len() >= R / 2);
        assert!(u.flush().is_none(), "once");
    }
}

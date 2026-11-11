//! Fast latency (PMM-026, board P09): Windows 11's own Live Captions is the caption source. The
//! island reads the caption text with UI Automation (`poni::services::livecap`), and this pure part
//! turns what it reads into lines: the sentence still being spoken is an interim, every sentence
//! that is over is a final line (translated by our engine and kept). Live Captions shows a rolling
//! few lines, so the same sentence is read again and again until it scrolls away; a sentence is
//! handed out once.
//!
//! A sentence is over when it ends with a full stop, `?`, `!` (or their CJK forms) and the same
//! text was read twice in a row (Live Captions still corrects the tail of a sentence), when it
//! scrolled away, or when it has not changed for `hang_s` of silence.

use std::collections::VecDeque;

/// How many finals are remembered to tell a re-read sentence from a new one.
const REMEMBER: usize = 12;

/// What one reading of the caption text gives.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Out {
    /// Sentences that are over, oldest first.
    pub finals: Vec<String>,
    /// The sentence still being spoken (`None` when there is none).
    pub interim: Option<String>,
}

#[derive(Default)]
pub struct Differ {
    hang_s: f32,
    /// The complete sentences of the previous reading (normalized, original).
    prev: Vec<(String, String)>,
    /// The sentence in progress and when it last changed.
    partial: String,
    changed_at: f32,
    handed: VecDeque<String>,
}

impl Differ {
    pub fn new(hang_s: f32) -> Self {
        Self { hang_s, ..Self::default() }
    }

    /// One reading of the caption text at `now` seconds.
    pub fn push(&mut self, text: &str, now: f32) -> Out {
        let (done, partial) = split(text);
        let cur: Vec<(String, String)> = done.into_iter().map(|s| (norm(&s), s)).collect();
        let mut finals = Vec::new();
        // Over: seen complete in the previous reading and still the same, or gone since.
        for (n, s) in std::mem::take(&mut self.prev) {
            if !n.is_empty() && !self.has(&n) {
                finals.push(s);
                self.remember(n);
            }
        }
        // A sentence read complete for the first time is not over yet (the tail may be corrected):
        // it shows as the interim until the next reading confirms it. Only `prev` is final.
        let was = std::mem::take(&mut self.partial);
        let partial = if partial.trim().is_empty() { cur.last().filter(|(n, _)| !self.has(n)).map(|(_, s)| s.clone()).unwrap_or_default() } else { partial };
        if norm(&was) != norm(&partial) {
            self.changed_at = now;
        }
        self.partial = partial;
        self.prev = cur;
        // Quiet for `hang_s`: what is being said is over.
        if !self.partial.trim().is_empty() && now - self.changed_at >= self.hang_s {
            let n = norm(&self.partial);
            if !self.has(&n) {
                finals.push(self.partial.clone());
                self.remember(n);
            }
        }
        let interim = Some(self.partial.clone()).filter(|p| !p.trim().is_empty() && !self.has(&norm(p)));
        Out { finals, interim }
    }

    /// Captions stop: the sentence in progress is kept as the last line.
    pub fn finish(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        let mut rest: Vec<String> = self.prev.drain(..).map(|(_, s)| s).collect();
        if !self.partial.trim().is_empty() {
            rest.push(std::mem::take(&mut self.partial));
        }
        for s in rest {
            let n = norm(&s);
            if !n.is_empty() && !self.has(&n) {
                out.push(s);
                self.remember(n);
            }
        }
        out
    }

    fn has(&self, n: &str) -> bool {
        self.handed.iter().any(|h| h == n)
    }

    fn remember(&mut self, n: String) {
        self.handed.push_back(n);
        while self.handed.len() > REMEMBER {
            self.handed.pop_front();
        }
    }
}

fn is_end(c: char) -> bool {
    matches!(c, '.' | '!' | '?' | '\u{3002}' | '\u{ff01}' | '\u{ff1f}' | '\u{2026}')
}

/// The caption text as (complete sentences, the unfinished rest). A line break also ends a sentence.
pub fn split(text: &str) -> (Vec<String>, String) {
    let mut done = Vec::new();
    let mut cur = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\n' || c == '\r' {
            if !cur.trim().is_empty() {
                done.push(cur.trim().to_string());
            }
            cur.clear();
            continue;
        }
        cur.push(c);
        // "3.5" and "e.g." keep going: an end mark ends a sentence when a space or the end follows.
        let cjk = matches!(c, '\u{3002}' | '\u{ff01}' | '\u{ff1f}');
        if is_end(c) && (cjk || chars.peek().is_none_or(|n| n.is_whitespace() || !n.is_alphanumeric() && !is_end(*n))) && !cur.trim().is_empty() {
            while chars.peek().is_some_and(|n| is_end(*n)) {
                cur.push(chars.next().unwrap_or(' '));
            }
            done.push(cur.trim().to_string());
            cur.clear();
        }
    }
    (done, cur.trim().to_string())
}

/// A sentence without case, punctuation or spacing: two readings of one sentence compare equal.
pub fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Why Fast cannot use Windows Live Captions, in plain words, for the Captions tab. `None` when it can.
pub fn why_unavailable(windows_build: u32, installed: bool, source_is_pc: bool) -> Option<&'static str> {
    // Live Captions arrived with Windows 11 22H2 (build 22621).
    if windows_build < 22621 {
        Some("Windows Live Captions needs Windows 11 (22H2 or newer). Fast uses the quicker timing of our own captions instead.")
    } else if !installed {
        Some("Windows Live Captions is not on this PC. Fast uses the quicker timing of our own captions instead.")
    } else if !source_is_pc {
        Some("Windows Live Captions hears what this PC plays, not the room. Fast uses the quicker timing of our own captions for this source.")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_sentences_and_keeps_the_unfinished_rest() {
        let (d, p) = split("Hello there. How are you? I am fi");
        assert_eq!(d, vec!["Hello there.", "How are you?"]);
        assert_eq!(p, "I am fi");
        let (d, p) = split("It costs 3.5 dollars");
        assert!(d.is_empty(), "a decimal point does not end a sentence: {d:?}");
        assert_eq!(p, "It costs 3.5 dollars");
        let (d, _) = split("First line\nSecond line\n");
        assert_eq!(d, vec!["First line", "Second line"]);
        assert_eq!(split("\u{4f60}\u{597d}\u{3002}\u{518d}").0, vec!["\u{4f60}\u{597d}\u{3002}"]);
    }

    #[test]
    fn a_growing_sentence_is_an_interim_and_is_final_once_confirmed() {
        let mut d = Differ::new(1.0);
        assert_eq!(d.push("Hello", 0.0), Out { finals: vec![], interim: Some("Hello".into()) });
        assert_eq!(d.push("Hello wor", 0.2).interim.as_deref(), Some("Hello wor"));
        let o = d.push("Hello world.", 0.4);
        assert!(o.finals.is_empty(), "read complete once: its tail may still be corrected");
        assert_eq!(o.interim.as_deref(), Some("Hello world."));
        let o = d.push("Hello world. And", 0.6);
        assert_eq!(o.finals, vec!["Hello world."]);
        assert_eq!(o.interim.as_deref(), Some("And"));
    }

    #[test]
    fn a_sentence_read_again_while_it_stays_on_screen_is_handed_out_once() {
        let mut d = Differ::new(1.0);
        let mut all = Vec::new();
        for (i, t) in ["One two.", "One two. Three", "One two. Three four.", "One two. Three four. Five", "Three four. Five six.", "Five six. Seven"].iter().enumerate() {
            all.extend(d.push(t, i as f32 * 0.3).finals);
        }
        assert_eq!(all, vec!["One two.", "Three four.", "Five six."]);
    }

    #[test]
    fn a_pause_without_punctuation_ends_the_sentence() {
        let mut d = Differ::new(1.0);
        d.push("we start now", 0.0);
        assert!(d.push("we start now", 0.5).finals.is_empty());
        let o = d.push("we start now", 1.2);
        assert_eq!(o.finals, vec!["we start now"]);
        assert_eq!(o.interim, None, "nothing is in progress after it");
        // The full stop that arrives later is the same sentence.
        let o = d.push("We start now.", 1.5);
        assert!(o.finals.is_empty() && o.interim.is_none(), "{o:?}");
        assert!(d.push("We start now.", 1.8).finals.is_empty(), "never handed out twice");
    }

    #[test]
    fn a_sentence_that_scrolled_away_is_final_and_finish_keeps_the_rest() {
        let mut d = Differ::new(1.0);
        d.push("Alpha beta.", 0.0);
        let o = d.push("Gamma delta", 0.3);
        assert_eq!(o.finals, vec!["Alpha beta."]);
        assert_eq!(d.finish(), vec!["Gamma delta"]);
        assert!(d.finish().is_empty());
    }

    #[test]
    fn why_it_is_unavailable() {
        assert!(why_unavailable(19045, true, true).unwrap().contains("Windows 11"));
        assert!(why_unavailable(22631, false, true).unwrap().contains("not on this PC"));
        assert!(why_unavailable(22631, true, false).unwrap().contains("room"));
        assert_eq!(why_unavailable(22631, true, true), None);
    }
}

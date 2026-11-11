//! "Recent lines": the lines said just before the caption on screen, kept as cards so the
//! current line has its context (the idea of LiveCaptions-Translator's Log Cards,
//! github.com/SakiRinn/LiveCaptions-Translator, Apache-2.0; the code is ours). Also what
//! "Copy caption" puts on the clipboard. Pure: the Live page draws what this picks.

use crate::helper::{Captions, Line};

/// Cards shown when Settings has not said otherwise.
pub const DEFAULT_CARDS: u8 = 3;
/// More than this and the cards crowd the caption out of the page.
pub const MAX_CARDS: u8 = 6;

/// One card: a finished line and its translation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Card {
    pub source: String,
    pub translation: String,
}

/// A card count from Settings, kept in 0..=[`MAX_CARDS`] (0 turns the strip off).
pub fn clamp_count(n: u8) -> u8 {
    n.min(MAX_CARDS)
}

/// The up-to-`n` lines before index `at` (the newest line when `None`: a held page passes the
/// index it froze on), oldest first. The line at `at` is the caption itself, so it is not a card;
/// empty lines are skipped.
pub fn recent(lines: &[Line], at: Option<usize>, n: u8) -> Vec<Card> {
    let n = clamp_count(n) as usize;
    if n == 0 || lines.is_empty() {
        return Vec::new();
    }
    let cur = at.map_or(lines.len() - 1, |a| a.min(lines.len() - 1));
    let mut cards: Vec<Card> = lines[..cur]
        .iter()
        .rev()
        .filter(|l| !l.source.trim().is_empty())
        .take(n)
        .map(|l| Card { source: l.source.clone(), translation: l.translation.clone() })
        .collect();
    cards.reverse();
    cards
}

/// What "Copy caption" copies: the current line, then its translation on the next line.
/// Empty when nothing is being said.
pub fn caption_text(cap: &Captions) -> String {
    let (src, tr) = (cap.current.trim(), cap.translation.trim());
    match (src.is_empty(), tr.is_empty()) {
        (true, _) => String::new(),
        (false, true) => src.to_string(),
        (false, false) => format!("{src}\n{tr}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(s: &str, t: &str) -> Line {
        Line { t0: 0.0, t1: 1.0, source: s.into(), translation: t.into(), speaker: String::new() }
    }

    #[test]
    fn cards_are_the_lines_before_the_caption_oldest_first() {
        let l = vec![line("a", "A"), line("b", "B"), line("c", "C"), line("d", "D"), line("e", "E")];
        let c = recent(&l, None, 3);
        assert_eq!(c.iter().map(|c| c.source.as_str()).collect::<Vec<_>>(), ["b", "c", "d"]);
        assert_eq!(c[0].translation, "B");
        // A held page: the caption is line 2 ("c"), the cards the two before it.
        let held = recent(&l, Some(2), 3);
        assert_eq!(held.iter().map(|c| c.source.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    }

    #[test]
    fn no_cards_for_off_empty_or_a_single_line() {
        let l = vec![line("a", ""), line("b", "")];
        assert!(recent(&l, None, 0).is_empty());
        assert!(recent(&[], None, 3).is_empty());
        assert!(recent(&l[..1], None, 3).is_empty());
        // A frozen index past the end is the newest line.
        assert_eq!(recent(&l, Some(99), 3).len(), 1);
    }

    #[test]
    fn blank_lines_are_skipped_and_the_count_is_capped() {
        let mut l: Vec<Line> = (0..20).map(|i| line(&format!("l{i}"), "")).collect();
        l.insert(10, line("  ", ""));
        assert_eq!(recent(&l, None, 200).len(), MAX_CARDS as usize);
        assert!(recent(&l, None, 200).iter().all(|c| !c.source.trim().is_empty()));
        assert_eq!(clamp_count(200), MAX_CARDS);
    }

    #[test]
    fn copy_text_is_the_line_then_its_translation() {
        let cap = |c: &str, t: &str| Captions { previous: "x".into(), current: c.into(), translation: t.into(), speaker: String::new() };
        assert_eq!(caption_text(&cap("Halo", "Hello")), "Halo\nHello");
        assert_eq!(caption_text(&cap("Halo", "  ")), "Halo");
        assert_eq!(caption_text(&cap("", "Hello")), "");
    }
}

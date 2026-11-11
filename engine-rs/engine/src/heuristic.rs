//! `/notes/generate` and `/notes/summarize`: the helper's keyword heuristic
//! (`_heuristic_notes` in native/server.py), not a model.
//!
//! The oracle uses two regexes; they are matched by hand here so the engine
//! does not need a regex dependency. Semantics kept: case-insensitive
//! keyword between word boundaries, an optional `[:\s-]*` prefix, then 8 to
//! N characters that are not `.!?\n` (greedy, with the prefix giving back
//! characters when the tail is too short, as the regex backtracks).

use serde_json::{json, Value};

use crate::notes::{py_str, py_truthy};
use crate::state::{now_epoch_secs, now_utc_iso};

const DECISION_WORDS: [&str; 3] = ["keputusan", "diputuskan", "decision"];
const ACTION_WORDS: [&str; 3] = ["action", "tindak lanjut", "todo"];

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn is_prefix(c: char) -> bool {
    c == ':' || c == '-' || c.is_whitespace()
}

fn is_tail(c: char) -> bool {
    !matches!(c, '.' | '!' | '?' | '\n')
}

/// Keyword length in chars if one of `words` starts at `at` (ASCII case-insensitive).
fn keyword_at(chars: &[char], at: usize, words: &[&str]) -> Option<usize> {
    words.iter().find_map(|word| {
        let n = word.chars().count();
        let hit = at + n <= chars.len()
            && word
                .chars()
                .zip(&chars[at..at + n])
                .all(|(w, c)| c.to_lowercase().eq(w.to_lowercase()));
        hit.then_some(n)
    })
}

/// All non-overlapping group-2 captures, like `re.finditer`, capped at `limit`.
fn find_captures(text: &str, words: &[&str], max_tail: usize, limit: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut at = 0;
    while at < chars.len() && out.len() < limit {
        let boundary_before = at == 0 || !is_word(chars[at - 1]);
        let matched = boundary_before
            .then(|| keyword_at(&chars, at, words))
            .flatten()
            .filter(|n| at + n == chars.len() || !is_word(chars[at + n]))
            .and_then(|n| {
                let start = at + n;
                let mut prefix = 0;
                while start + prefix < chars.len() && is_prefix(chars[start + prefix]) {
                    prefix += 1;
                }
                // Backtrack the prefix until the tail reaches 8 chars.
                (0..=prefix).rev().find_map(|p| {
                    let tail_start = start + p;
                    let run = chars[tail_start..]
                        .iter()
                        .take(max_tail)
                        .take_while(|c| is_tail(**c))
                        .count();
                    (run >= 8).then_some((tail_start, run))
                })
            });
        match matched {
            Some((tail_start, run)) => {
                let capture: String = chars[tail_start..tail_start + run].iter().collect();
                out.push(capture.trim().to_string());
                at = tail_start + run;
            }
            None => at += 1,
        }
    }
    out
}

pub(crate) fn line_text(line: &Value) -> String {
    let Value::Object(map) = line else {
        return String::new();
    };
    let pick = [map.get("text"), map.get("src")]
        .into_iter()
        .flatten()
        .find(|value| py_truthy(value));
    pick.map(py_str).unwrap_or_default().trim().to_string()
}

/// The note `_heuristic_notes(lines, title, source)` returns.
pub fn heuristic_notes(lines: &[Value], title: &str, source: &str) -> Value {
    let texts: Vec<String> = lines
        .iter()
        .map(line_text)
        .filter(|text| !text.is_empty())
        .collect();
    let blob = texts.join(" ");
    let summary = match texts.len() {
        0 => "Transkrip kosong.".to_string(),
        1 => texts[0].clone(),
        n => format!("{} … {} ({n} segmen).", texts[0], texts[n - 1]),
    };
    let decisions = find_captures(&blob, &DECISION_WORDS, 200, 8);
    let actions: Vec<Value> = find_captures(&blob, &ACTION_WORDS, 160, 12)
        .into_iter()
        .enumerate()
        .map(|(index, text)| {
            json!({
                "id": format!("act-{}", index + 1),
                "text": text,
                "owner": null,
                "due": null,
                "status": "open",
            })
        })
        .collect();
    json!({
        "id": format!("note-{}", now_epoch_secs()),
        "title": if title.is_empty() { "Notulen sesi" } else { title },
        "source": if source.is_empty() { "helper" } else { source },
        "status": "ready",
        "generatedAt": now_utc_iso(),
        "summary": summary,
        "decisions": decisions,
        "actions": actions,
        "transcriptPreview": texts.iter().take(6).cloned().collect::<Vec<_>>().join("\n"),
        "savedLocally": false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_follow_the_regex() {
        let found = find_captures(
            "Keputusan: kita rilis Jumat. decisions are not matched. Decision -   pakai Rust sekarang!",
            &DECISION_WORDS,
            200,
            8,
        );
        assert_eq!(found, vec!["kita rilis Jumat", "pakai Rust sekarang"]);
        // Short tail: the prefix gives its spaces back to reach 8 chars.
        assert_eq!(
            find_captures("todo:      abc.", &ACTION_WORDS, 160, 12),
            vec!["abc"]
        );
        assert!(find_captures("todo: ab.", &ACTION_WORDS, 160, 12).is_empty());
        assert!(find_captures("xaction kirim laporan.", &ACTION_WORDS, 160, 12).is_empty());
    }
}

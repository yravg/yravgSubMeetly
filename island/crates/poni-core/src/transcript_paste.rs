//! A transcript pasted from the clipboard, turned into meeting lines. Reads
//! what people copy most: a Teams transcript ("Name   0:03" then the words), Teams
//! live captions ("Name: words"), read.ai ("Name (00:01:02): words" or
//! "[00:01:02] Name: words"), WebVTT (`<v Name>` cues, NOTE blocks) and SRT.
//! Anything else: every non-empty line is a line. Speakers are kept as
//! "Name: words" so the register and its owners can see them.

use crate::helper::Line;

/// More than this many lines: the oldest are dropped (the engine keeps 3000).
pub const MAX_LINES: usize = 3000;

/// What a paste gave: the lines and the people who spoke, in first-heard order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Pasted {
    pub lines: Vec<Line>,
    pub speakers: Vec<String>,
    /// Lines left out because the paste was longer than [`MAX_LINES`].
    pub dropped: usize,
}

/// `h:mm:ss`, `mm:ss`, `hh:mm:ss.mmm` or `hh:mm:ss,mmm` in seconds.
fn clock(s: &str) -> Option<f64> {
    let s = s.trim().trim_start_matches('[').trim_end_matches(']').trim_start_matches('(').trim_end_matches(')');
    let main = s.split(['.', ',']).next()?;
    let parts: Vec<&str> = main.split(':').collect();
    if !(2..=3).contains(&parts.len()) || parts.iter().any(|p| p.is_empty() || p.len() > 2 && p != &parts[0] || !p.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    let n: Vec<f64> = parts.iter().map(|p| p.parse::<f64>().unwrap_or(0.0)).collect();
    Some(n.iter().fold(0.0, |acc, v| acc * 60.0 + v))
}

/// A plausible person name: short, has a letter, no sentence punctuation.
fn name_like(s: &str) -> bool {
    let s = s.trim();
    !s.is_empty() && s.chars().count() <= 60 && s.split_whitespace().count() <= 6 && s.chars().any(char::is_alphabetic) && !s.contains(['.', '?', '!', ',', '"', ':']) && s.chars().next().is_some_and(|c| c.is_uppercase() || !c.is_alphabetic())
}

/// "Name   0:03" (Teams transcript) or "Name 00:01:02" (read.ai header): (name, seconds).
fn header(line: &str) -> Option<(String, f64)> {
    let t = line.trim();
    let (name, time) = t.rsplit_once(char::is_whitespace)?;
    let secs = clock(time)?;
    let name = name.trim().trim_end_matches(['-', '\u{b7}']).trim();
    name_like(name).then(|| (name.to_string(), secs))
}

/// "Name: words", "Name (00:01): words", "[00:01] Name: words": (name, seconds, words).
fn spoken(line: &str) -> Option<(String, Option<f64>, String)> {
    let mut t = line.trim();
    let mut at = None;
    if t.starts_with('[') {
        let end = t.find(']')?;
        at = clock(&t[..=end]);
        t = t[end + 1..].trim_start();
    }
    // "Name (00:01:02): words": the colon after the bracket, not the ones in the time.
    let (head, words) = match t.find("):") {
        Some(i) if t[..i].contains('(') => (&t[..=i], &t[i + 2..]),
        _ => t.split_once(':')?,
    };
    // "10:30 meeting" is a time, not a speaker.
    if head.trim().bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let words = words.trim();
    let (name, when) = match head.rfind('(') {
        Some(i) if head.trim_end().ends_with(')') => (&head[..i], clock(&head[i..])),
        _ => (head, None),
    };
    (name_like(name) && !words.is_empty()).then(|| (name.trim().to_string(), when.or(at), words.to_string()))
}

/// VTT/SRT cue timing "00:00:01.000 --> 00:00:04.000": (start, end).
fn timing(line: &str) -> Option<(f64, f64)> {
    let (a, b) = line.split_once("-->")?;
    Some((clock(a)?, clock(b.split_whitespace().next()?)?))
}

/// `<v Name>words</v>` (VTT voice): (name, words). Other tags are dropped.
fn voice(line: &str) -> (Option<String>, String) {
    let mut name = None;
    let mut out = String::new();
    let mut rest = line;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        let Some(j) = rest[i..].find('>') else { break };
        let tag = &rest[i + 1..i + j];
        if let Some(n) = tag.strip_prefix("v ") {
            name = Some(n.split('.').next().unwrap_or(n).trim().to_string()).filter(|n| !n.is_empty());
        }
        rest = &rest[i + j + 1..];
    }
    out.push_str(rest);
    (name, out.trim().to_string())
}

/// Does the text look like a transcript at all (and not a link or a single word)?
pub fn looks_like_transcript(text: &str) -> bool {
    let t = text.trim();
    let words = t.split_whitespace().count();
    words >= 4 && !(t.starts_with("http://") || t.starts_with("https://") || t.starts_with("webcal://"))
}

pub fn parse(text: &str) -> Pasted {
    let mut out = Pasted::default();
    let add = |out: &mut Pasted, who: Option<&str>, t0: f64, words: &str| {
        let words = words.trim();
        if words.is_empty() {
            return;
        }
        if let Some(w) = who {
            if !out.speakers.iter().any(|s| s == w) {
                out.speakers.push(w.to_string());
            }
        }
        let source = match who {
            Some(w) => format!("{w}: {words}"),
            None => words.to_string(),
        };
        out.lines.push(Line { t0, t1: t0, source, translation: String::new(), speaker: String::new() });
    };
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut who: Option<String> = None;
    let mut at = 0.0;
    let mut in_note = false;
    let mut auto_t = 0.0;
    for raw in text.lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            in_note = false;
            continue;
        }
        if in_note || line == "WEBVTT" || line.starts_with("WEBVTT ") || line.starts_with("Kind:") || line.starts_with("Language:") {
            continue;
        }
        if line == "NOTE" || line.starts_with("NOTE ") || line == "STYLE" || line == "REGION" {
            in_note = true;
            continue;
        }
        if let Some((t0, _)) = timing(line) {
            at = t0;
            who = None; // a new cue names its own speaker
            continue;
        }
        // SRT cue number, VTT cue id (a uuid-like token): no spaces, no letters of a sentence.
        if line.bytes().all(|b| b.is_ascii_digit()) || (!line.contains(' ') && line.contains('-') && line.len() >= 8 && line.bytes().any(|b| b.is_ascii_digit())) {
            continue;
        }
        if line.contains("<v ") {
            let (name, words) = voice(line);
            if name.is_some() {
                who = name;
            }
            add(&mut out, who.as_deref(), at, &words);
            continue;
        }
        if let Some((name, t0)) = header(line) {
            who = Some(name);
            at = t0;
            continue;
        }
        if let Some((name, t0, words)) = spoken(line) {
            if let Some(t) = t0 {
                at = t;
            }
            add(&mut out, Some(&name), at, &words);
            continue;
        }
        let (_, words) = voice(line);
        // Lines without a time get one second apart, so the order is kept.
        if at == 0.0 && who.is_none() {
            auto_t += 1.0;
            add(&mut out, None, auto_t, &words);
        } else {
            add(&mut out, who.as_deref(), at, &words);
        }
    }
    // Each line ends where the next one starts.
    for i in 0..out.lines.len() {
        let next = out.lines.get(i + 1).map_or(out.lines[i].t0 + 4.0, |n| n.t0);
        out.lines[i].t1 = next.max(out.lines[i].t0);
    }
    if out.lines.len() > MAX_LINES {
        out.dropped = out.lines.len() - MAX_LINES;
        out.lines.drain(..out.dropped);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(p: &Pasted) -> Vec<&str> {
        p.lines.iter().map(|l| l.source.as_str()).collect()
    }

    #[test]
    fn teams_transcript_keeps_speakers_and_times() {
        let p = parse("Nasmee Samang   0:03\nGood morning everyone.\nLet's start.\n\nRiza Putra   1:15\nWe agreed to issue GMDR rev.3 by Friday.\n");
        assert_eq!(src(&p), ["Nasmee Samang: Good morning everyone.", "Nasmee Samang: Let's start.", "Riza Putra: We agreed to issue GMDR rev.3 by Friday."]);
        assert_eq!(p.speakers, ["Nasmee Samang", "Riza Putra"]);
        assert_eq!((p.lines[0].t0, p.lines[2].t0), (3.0, 75.0));
        assert_eq!(p.lines[1].t1, 75.0);
    }

    #[test]
    fn teams_live_captions_and_read_ai() {
        let p = parse("Nasmee Samang: Good morning.\nRiza: Action for me, send the report.\n");
        assert_eq!(src(&p), ["Nasmee Samang: Good morning.", "Riza: Action for me, send the report."]);
        let p = parse("Summary\nAlya Rahman (00:01:02): We decided to go with option B.\n[00:02:10] Budi: I will follow up tomorrow.\n");
        assert_eq!(src(&p), ["Summary", "Alya Rahman: We decided to go with option B.", "Budi: I will follow up tomorrow."]);
        assert_eq!((p.lines[1].t0, p.lines[2].t0), (62.0, 130.0));
    }

    #[test]
    fn vtt_and_srt() {
        let vtt = "WEBVTT\n\nNOTE made by Teams\nsecond note line\n\n6f1a2b3c-aaaa-1\n00:00:01.000 --> 00:00:04.000\n<v Alya Rahman>We decided to go.</v>\n\n00:00:05.500 --> 00:00:07.000\n<v Budi>Next week then.</v>\n";
        let p = parse(vtt);
        assert_eq!(src(&p), ["Alya Rahman: We decided to go.", "Budi: Next week then."]);
        assert_eq!((p.lines[0].t0, p.lines[1].t0), (1.0, 5.0));
        let srt = "1\n00:00:01,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line.\n";
        let p = parse(srt);
        assert_eq!(src(&p), ["Hello there.", "Second line."]);
        assert!(p.speakers.is_empty());
    }

    #[test]
    fn plain_text_and_what_is_not_a_transcript() {
        let p = parse("first point we discussed\nsecond point\n");
        assert_eq!(src(&p), ["first point we discussed", "second point"]);
        assert!(p.lines[0].t0 < p.lines[1].t0);
        assert!(!looks_like_transcript("https://outlook.office365.com/owa/calendar/x/calendar.ics"));
        assert!(!looks_like_transcript("hello"));
        assert!(looks_like_transcript("Riza: we agreed on it"));
        // A time at the start of a sentence is not a speaker.
        assert_eq!(src(&parse("10:30 we meet again")), ["10:30 we meet again"]);
    }

    #[test]
    fn long_pastes_keep_the_newest_lines() {
        let text: String = (0..MAX_LINES + 5).map(|i| format!("line number {i}\n")).collect();
        let p = parse(&text);
        assert_eq!((p.lines.len(), p.dropped), (MAX_LINES, 5));
        assert_eq!(p.lines[0].source, "line number 5");
    }
}

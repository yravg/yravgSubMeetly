//! PMM-023: every saved record in one list. The engine keeps meetings, in-room sessions, media
//! transcripts and pasted transcripts in the same notes store; the document's `source` tells them
//! apart. The Minutes tab lists all of them with a source chip and a filter, and each of Meeting,
//! Live and Media shows its own history (the same list, filtered). Pure: no store of its own.

use crate::datetime::{civil_from_days, days_from_civil, weekday_from_days, MONTH_SHORT, WEEKDAY_SHORT};
use crate::helper::Note;
use crate::meeting_doc::{is_in_room, is_transcript, meeting_app, SOURCE_PASTE};
use serde_json::Value;

/// Where a record came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Meeting,
    Room,
    Media,
    Pasted,
}

/// The source of a note's document. Anything the island does not mark (a meeting saved by the
/// browser extension, the helper) is a meeting.
pub fn source_of(raw: &Value) -> Source {
    if is_transcript(raw) {
        Source::Media
    } else if is_in_room(raw) {
        Source::Room
    } else if raw.get("source").and_then(Value::as_str) == Some(SOURCE_PASTE) {
        Source::Pasted
    } else {
        Source::Meeting
    }
}

/// The chip label of a record: `Meeting · Teams`, `Live · Room`, `Media · Video`, `Pasted`.
/// A meeting says its app when the session knew it ([`meeting_app`]).
pub fn chip(raw: &Value) -> String {
    match source_of(raw) {
        Source::Meeting => match meeting_app(raw) {
            Some(app) => format!("Meeting \u{b7} {}", short(app, 14)),
            None => "Meeting".into(),
        },
        Source::Room => "Live \u{b7} Room".into(),
        Source::Media => "Media \u{b7} Video".into(),
        Source::Pasted => "Pasted".into(),
    }
}

fn short(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}\u{2026}", s.chars().take(max - 1).collect::<String>().trim_end())
    }
}

/// Which records a list shows: all, or one tab's.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Filter {
    #[default]
    All,
    Meeting,
    Live,
    Media,
    Pasted,
}

impl Filter {
    pub const ALL: [Filter; 5] = [Filter::All, Filter::Meeting, Filter::Live, Filter::Media, Filter::Pasted];

    pub fn label(self) -> &'static str {
        match self {
            Filter::All => "All",
            Filter::Meeting => "Meeting",
            Filter::Live => "Live",
            Filter::Media => "Media",
            Filter::Pasted => "Pasted",
        }
    }

    pub fn takes(self, s: Source) -> bool {
        matches!((self, s), (Filter::All, _) | (Filter::Meeting, Source::Meeting) | (Filter::Live, Source::Room) | (Filter::Media, Source::Media) | (Filter::Pasted, Source::Pasted))
    }
}

/// The records `f` shows, in the order given (the engine keeps them newest first).
pub fn filtered(notes: &[Note], f: Filter) -> Vec<&Note> {
    notes.iter().filter(|n| f.takes(source_of(&n.raw))).collect()
}

/// How many records each filter shows, in [`Filter::ALL`] order.
pub fn counts(notes: &[Note]) -> [usize; 5] {
    Filter::ALL.map(|f| notes.iter().filter(|n| f.takes(source_of(&n.raw))).count())
}

/// "Today · 38 min", "Yesterday", "Mon · 45 min" (the last week), "3 Nov" (older). `today` is the
/// local `YYYY-MM-DD`; a date that is not one reads as it is.
pub fn when(note: &Note, today: &str) -> String {
    let day = match (days_of(&note.date), days_of(today)) {
        (Some(d), Some(t)) => match t - d {
            0 => "Today".to_string(),
            1 => "Yesterday".to_string(),
            2..=6 => WEEKDAY_SHORT[weekday_from_days(d) as usize].to_string(),
            _ => {
                let (_, m, dd) = civil_from_days(d);
                format!("{dd} {}", MONTH_SHORT[(m.clamp(1, 12) - 1) as usize])
            }
        },
        _ => note.date.clone(),
    };
    let secs = note.raw.pointer("/meeting/engine/durationSec").and_then(Value::as_f64).unwrap_or(0.0);
    if secs <= 0.0 {
        return day;
    }
    let min = ((secs / 60.0).round() as u64).max(1);
    if day.is_empty() {
        format!("{min} min")
    } else {
        format!("{day} \u{b7} {min} min")
    }
}

fn days_of(date: &str) -> Option<i64> {
    let mut p = date.get(..10)?.split('-');
    let (y, m, d) = (p.next()?.parse().ok()?, p.next()?.parse().ok()?, p.next()?.parse().ok()?);
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then(|| days_from_civil(y, m, d))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meeting_doc::{as_in_room, as_transcript, with_app};
    use serde_json::json;

    fn note(raw: Value) -> Note {
        crate::helper::parse_notes(&json!({ "notes": [raw] }).to_string()).unwrap().remove(0)
    }

    fn doc(id: &str, date: &str) -> Value {
        json!({ "id": id, "title": id, "date": date, "source": "island", "meeting": { "engine": { "durationSec": 38 * 60 } } })
    }

    #[test]
    fn each_source_has_its_chip() {
        assert_eq!(chip(&with_app(doc("a", "2026-11-10"), Some("Teams"))), "Meeting \u{b7} Teams");
        assert_eq!(chip(&doc("a", "2026-11-10")), "Meeting");
        assert_eq!(chip(&as_in_room(doc("b", "2026-11-10"))), "Live \u{b7} Room");
        assert_eq!(chip(&as_transcript(doc("c", "2026-11-10"))), "Media \u{b7} Video");
        let mut p = doc("d", "2026-11-10");
        p["source"] = json!("paste");
        assert_eq!(chip(&p), "Pasted");
        // A record the island did not mark, such as the browser extension's, is a meeting.
        assert_eq!(source_of(&json!({ "id": "x", "source": "helper" })), Source::Meeting);
        assert_eq!(source_of(&json!({ "id": "x" })), Source::Meeting);
    }

    #[test]
    fn a_long_app_name_is_cut_for_the_chip() {
        assert_eq!(chip(&with_app(doc("a", "2026-11-10"), Some("meeting.tencent.com"))), "Meeting \u{b7} meeting.tence\u{2026}");
    }

    #[test]
    fn the_filter_narrows_and_the_counts_add_up() {
        let notes = vec![
            note(with_app(doc("m1", "2026-11-10"), Some("Teams"))),
            note(as_in_room(doc("r1", "2026-11-10"))),
            note(as_transcript(doc("v1", "2026-11-09"))),
            note(doc("m2", "2026-11-08")),
            note(json!({ "id": "p1", "title": "p", "date": "2026-11-07", "source": "paste" })),
        ];
        assert_eq!(counts(&notes), [5, 2, 1, 1, 1]);
        let ids = |f| filtered(&notes, f).iter().map(|n| n.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(Filter::All), ["m1", "r1", "v1", "m2", "p1"]);
        assert_eq!(ids(Filter::Meeting), ["m1", "m2"]);
        assert_eq!(ids(Filter::Live), ["r1"]);
        assert_eq!(ids(Filter::Media), ["v1"]);
        assert_eq!(ids(Filter::Pasted), ["p1"]);
    }

    #[test]
    fn when_says_the_day_and_the_length() {
        // 2026-11-10 is a Tuesday.
        let n = |date: &str| note(doc("a", date));
        assert_eq!(when(&n("2026-11-10"), "2026-11-10"), "Today \u{b7} 38 min");
        assert_eq!(when(&n("2026-11-09"), "2026-11-10"), "Yesterday \u{b7} 38 min");
        assert_eq!(when(&n("2026-11-07"), "2026-11-10"), "Sat \u{b7} 38 min");
        assert_eq!(when(&n("2026-11-03"), "2026-11-10"), "3 Nov \u{b7} 38 min");
        // No length kept (a pasted record): the day alone. A short one reads 1 min.
        let p = note(json!({ "id": "p", "date": "2026-11-10" }));
        assert_eq!(when(&p, "2026-11-10"), "Today");
        let s = note(json!({ "id": "p", "date": "2026-11-10", "meeting": { "engine": { "durationSec": 10 } } }));
        assert_eq!(when(&s, "2026-11-10"), "Today \u{b7} 1 min");
        // A date this cannot read stays as written.
        assert_eq!(when(&note(json!({ "id": "p", "date": "soon" })), "2026-11-10"), "soon");
    }
}

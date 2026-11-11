//! The Meeting tab's "Notes so far" (PMM-007..009): the engine's draft of the session lines
//! (`POST /notes/generate`, a heuristic), asked every [`REFRESH_S`] or every [`REFRESH_LINES`] new
//! lines, plus what the person keeps, edits or types. A refresh only ever replaces draft items:
//! kept, edited and typed ones stay, and a removed draft item does not come back.
//!
//! `items` keeps the person's items first and the draft after them, so a refresh (which only
//! replaces the tail) never moves an item the page is editing.

use crate::helper::Line;
use serde_json::{json, Value};

/// A refresh is due this long after the last one (or the first line)...
pub const REFRESH_S: f64 = 60.0;
/// ...or once this many lines came since.
pub const REFRESH_LINES: usize = 12;
/// The Meeting tab stays this long after its session was saved.
pub const SAVED_S: f64 = 600.0;
/// The newest questions heard that the draft lists.
const QUESTIONS: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Summary,
    Decision,
    Action,
    Question,
    Note,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mark {
    /// The engine's draft: a refresh replaces it.
    Draft,
    /// A draft item the person kept.
    Kept,
    /// A draft item the person changed.
    Edited,
    /// Typed on the pill (+ Note).
    Typed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub kind: Kind,
    pub text: String,
    pub owner: Option<String>,
    pub mark: Mark,
}

impl Item {
    fn draft(kind: Kind, text: &str, owner: Option<String>) -> Item {
        Item { kind, text: text.trim().to_string(), owner, mark: Mark::Draft }
    }
}

/// What a saved session holds, for "Saved · <title>, <n> min".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub summary: usize,
    pub decisions: usize,
    pub actions: usize,
    pub questions: usize,
    pub notes: usize,
    /// Kept or edited by the person.
    pub kept: usize,
    pub typed: usize,
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

impl Counts {
    /// `1 summary, 2 decisions, 3 actions, 1 question. 2 items kept, 1 note typed by you.`
    /// Empty kinds are left out; nothing at all reads "No notes yet.".
    pub fn line(&self) -> String {
        let what: Vec<String> = [
            (self.summary, "summary", "summaries"),
            (self.decisions, "decision", "decisions"),
            (self.actions, "action", "actions"),
            (self.questions, "question", "questions"),
            (self.notes, "note", "notes"),
        ]
        .into_iter()
        .filter(|(n, ..)| *n > 0)
        .map(|(n, one, many)| plural(n, one, many))
        .collect();
        let mine: Vec<String> = [(self.kept, "item kept", "items kept"), (self.typed, "note typed by you", "notes typed by you")]
            .into_iter()
            .filter(|(n, ..)| *n > 0)
            .map(|(n, one, many)| plural(n, one, many))
            .collect();
        let mut out = if what.is_empty() { "No notes yet.".to_string() } else { format!("{}.", what.join(", ")) };
        if !mine.is_empty() {
            out.push_str(&format!(" {}.", mine.join(", ")));
        }
        out
    }
}

/// How two texts compare when a draft is matched against the person's items.
fn key(text: &str) -> String {
    text.trim().to_lowercase()
}

#[derive(Clone, Debug, Default)]
pub struct LiveNotes {
    pub items: Vec<Item>,
    /// Draft texts the person removed or rewrote: a refresh does not bring them back.
    removed: Vec<String>,
    /// When the last draft arrived (`now` seconds).
    pub updated: Option<f64>,
    /// A refresh is out.
    pub busy: bool,
    /// The last refresh got no answer: "Notes paused: engine not answering".
    pub down: bool,
    /// When the last refresh was asked, and how many lines the session had then.
    asked: Option<(f64, usize)>,
    /// When the first line was seen (the clock of the first refresh).
    first: Option<f64>,
}

impl LiveNotes {
    /// Ask for a draft now? Every 60 s or 12 new lines, never with no new line, while one is out,
    /// or on battery saver (owner Q3).
    pub fn due(&mut self, now: f64, lines: usize, saver: bool) -> bool {
        if lines == 0 {
            return false;
        }
        let (t, n) = self.asked.unwrap_or_else(|| (*self.first.get_or_insert(now), 0));
        !self.busy && !saver && lines > n && (lines - n >= REFRESH_LINES || now - t >= REFRESH_S)
    }

    /// A refresh of `lines` lines went out at `now`.
    pub fn ask(&mut self, now: f64, lines: usize) {
        self.busy = true;
        self.asked = Some((now, lines));
    }

    /// The refresh came back: a new draft, or `None` when the engine did not answer (the old draft stays).
    pub fn answer(&mut self, now: f64, draft: Option<Vec<Item>>) {
        self.busy = false;
        let Some(draft) = draft else {
            self.down = true;
            return;
        };
        self.down = false;
        self.updated = Some(now);
        let known: Vec<String> = self.items.iter().filter(|i| i.mark != Mark::Draft).map(|i| key(&i.text)).chain(self.removed.iter().cloned()).collect();
        self.items.retain(|i| i.mark != Mark::Draft);
        for i in draft {
            if !i.text.is_empty() && !known.contains(&key(&i.text)) && !self.items.iter().any(|o| key(&o.text) == key(&i.text)) {
                self.items.push(i);
            }
        }
    }

    /// Where the person's items end and the draft begins.
    fn mine(&self) -> usize {
        self.items.iter().take_while(|i| i.mark != Mark::Draft).count()
    }

    /// Pin item `i` into the minutes. Returns where it is now (it joins the person's items).
    pub fn keep(&mut self, i: usize) -> usize {
        if self.items.get(i).is_none_or(|it| it.mark != Mark::Draft) {
            return i;
        }
        let mut it = self.items.remove(i);
        it.mark = Mark::Kept;
        let at = self.mine();
        self.items.insert(at, it);
        at
    }

    /// New text for item `i` ([`keep`](Self::keep) it first). Empty text removes it.
    pub fn edit(&mut self, i: usize, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            self.remove(i);
            return;
        }
        let Some(it) = self.items.get_mut(i) else { return };
        if key(&it.text) == key(text) {
            return;
        }
        // The draft's own words stay out of the next refresh.
        if it.mark != Mark::Typed {
            self.removed.push(key(&it.text));
            it.mark = Mark::Edited;
        }
        it.text = text.to_string();
    }

    pub fn remove(&mut self, i: usize) {
        if i < self.items.len() {
            let it = self.items.remove(i);
            self.removed.push(key(&it.text));
        }
    }

    /// "+ Note": a decision, action (`text @owner`) or note typed on the pill. False when empty.
    pub fn add(&mut self, kind: Kind, text: &str) -> bool {
        let (text, owner) = if kind == Kind::Action { split_owner(text) } else { (text.trim().to_string(), None) };
        if text.is_empty() {
            return false;
        }
        let at = self.mine();
        self.items.insert(at, Item { kind, text, owner, mark: Mark::Typed });
        true
    }

    pub fn counts(&self) -> Counts {
        let mut c = Counts::default();
        for i in &self.items {
            *match i.kind {
                Kind::Summary => &mut c.summary,
                Kind::Decision => &mut c.decisions,
                Kind::Action => &mut c.actions,
                Kind::Question => &mut c.questions,
                Kind::Note => &mut c.notes,
            } += 1;
            match i.mark {
                Mark::Kept | Mark::Edited => c.kept += 1,
                Mark::Typed => c.typed += 1,
                Mark::Draft => {}
            }
        }
        c
    }
}

/// `Send the plan @Alya Rahman` → (`Send the plan`, `Alya Rahman`): an owner typed after the last ` @`.
pub fn split_owner(text: &str) -> (String, Option<String>) {
    let text = text.trim();
    match text.rsplit_once(" @") {
        Some((what, who)) if !what.trim().is_empty() && !who.trim().is_empty() => (what.trim().to_string(), Some(who.trim().to_string())),
        _ => (text.to_string(), None),
    }
}

/// The draft of a `/notes/generate` note: its summary, decisions and actions (with owners), and
/// the newest questions heard (lines ending in a question mark; the engine lists none).
pub fn draft_items(note: &Value, lines: &[Line]) -> Vec<Item> {
    let mut out = Vec::new();
    if let Some(s) = note.get("summary").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        out.push(Item::draft(Kind::Summary, s, None));
    }
    for d in note.get("decisions").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        out.push(Item::draft(Kind::Decision, d, None));
    }
    for a in note.get("actions").and_then(Value::as_array).into_iter().flatten() {
        if let Some(t) = a.get("text").and_then(Value::as_str) {
            let owner = a.get("owner").and_then(Value::as_str).map(str::trim).filter(|o| !o.is_empty()).map(String::from);
            out.push(Item::draft(Kind::Action, t, owner));
        }
    }
    let questions: Vec<&str> = lines.iter().map(|l| l.source.trim()).filter(|s| s.ends_with('?') || s.ends_with('\u{ff1f}')).collect();
    for q in &questions[questions.len().saturating_sub(QUESTIONS)..] {
        out.push(Item::draft(Kind::Question, q, None));
    }
    out.retain(|i| !i.text.is_empty());
    out
}

/// The saved meeting document (`meeting_doc::meeting_doc`) with these notes in place of the
/// engine's bare draft: summary, decisions, actions and items. The person's items are marked
/// accepted (or edited), the draft's stay AI and unsure. Empty notes leave the document as it is.
pub fn onto_doc(mut doc: Value, notes: &LiveNotes) -> Value {
    if notes.items.is_empty() {
        return doc;
    }
    let of = |k: Kind| notes.items.iter().filter(move |i| i.kind == k);
    let summary = of(Kind::Summary).map(|i| i.text.as_str()).collect::<Vec<_>>().join(" ");
    let decisions: Vec<&str> = of(Kind::Decision).map(|i| i.text.as_str()).collect();
    let actions: Vec<Value> = of(Kind::Action).map(|i| json!({ "text": i.text, "owner": i.owner, "due": null, "status": "open" })).collect();
    let mut items = Vec::new();
    for (kind, ty, p) in [(Kind::Decision, "decision", "D"), (Kind::Action, "action", "A"), (Kind::Question, "question", "Q"), (Kind::Note, "info", "N")] {
        for (n, i) in of(kind).enumerate() {
            let (review, confidence) = match i.mark {
                Mark::Draft => ("ai", 0.6),
                Mark::Kept | Mark::Typed => ("accepted", 1.0),
                Mark::Edited => ("edited", 1.0),
            };
            items.push(json!({ "ref": format!("{p}-{}", n + 1), "type": ty, "text": i.text, "owner": i.owner, "status": "open", "review": review, "confidence": confidence }));
        }
    }
    doc["summary"] = json!(summary);
    doc["decisions"] = json!(decisions);
    doc["actions"] = json!(actions);
    doc["items"] = json!(items);
    doc
}

/// The Meeting tab shows while a meeting runs (or a joined link is active) and for
/// [`SAVED_S`] after its session was saved.
pub fn shows_tab(meeting_now: bool, saved_at: Option<f64>, now: f64) -> bool {
    meeting_now || saved_at.is_some_and(|t| now - t < SAVED_S)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(source: &str) -> Line {
        Line { t0: 0.0, t1: 4.0, source: source.into(), translation: String::new(), speaker: String::new() }
    }

    fn note() -> Value {
        json!({
            "summary": "Crane slot moves to Thursday.",
            "decisions": ["Move the crane slot to Thursday 08:00"],
            "actions": [{ "text": "Confirm the lift permit", "owner": "Chen" }, { "text": "Send the revised plan", "owner": null }],
        })
    }

    #[test]
    fn a_refresh_is_due_every_60_s_or_12_lines_never_twice_at_once_nor_on_battery_saver() {
        let mut n = LiveNotes::default();
        assert!(!n.due(0.0, 0, false), "nothing heard yet");
        assert!(!n.due(10.0, 3, false), "3 lines, 0 s since the first");
        assert!(n.due(10.0, 12, false), "12 lines");
        assert!(n.due(70.0, 3, false), "60 s since the first line");
        assert!(!n.due(70.0, 3, true), "battery saver");
        n.ask(70.0, 3);
        assert!(!n.due(200.0, 40, false), "one is out");
        n.answer(71.0, Some(Vec::new()));
        assert!(!n.due(100.0, 3, false), "no new line");
        assert!(!n.due(100.0, 14, false), "11 new lines, 30 s");
        assert!(n.due(100.0, 15, false), "12 new lines");
        assert!(n.due(130.0, 4, false), "60 s and a new line");
    }

    #[test]
    fn the_draft_reads_summary_decisions_actions_with_owners_and_the_newest_questions() {
        let lines = [line("Which slot is free?"), line("Fine."), line("Can we lift at 8?"), line("Who checks it?"), line("谁负责夜班？")];
        let d = draft_items(&note(), &lines);
        let kinds: Vec<Kind> = d.iter().map(|i| i.kind).collect();
        assert_eq!(kinds, [Kind::Summary, Kind::Decision, Kind::Action, Kind::Action, Kind::Question, Kind::Question, Kind::Question]);
        assert_eq!(d[2].owner.as_deref(), Some("Chen"));
        assert_eq!(d[3].owner, None);
        assert_eq!(d[4].text, "Can we lift at 8?", "the three newest questions");
        assert!(d.iter().all(|i| i.mark == Mark::Draft));
        assert!(draft_items(&json!({}), &[]).is_empty());
    }

    #[test]
    fn a_refresh_never_touches_kept_edited_typed_or_removed_items() {
        let mut n = LiveNotes::default();
        n.answer(1.0, Some(draft_items(&note(), &[])));
        assert_eq!(n.items.len(), 4);
        // Keep the decision, edit the first action, remove the second, type a note.
        let d = n.keep(1);
        assert_eq!((d, n.items[0].mark), (0, Mark::Kept));
        let a = n.keep(2);
        n.edit(a, "Confirm the lift permit before Friday");
        let gone = n.items.iter().position(|i| i.text == "Send the revised plan").unwrap();
        n.remove(gone);
        assert!(n.add(Kind::Note, "Night watch still open"));
        let mine: Vec<Item> = n.items[..3].to_vec();
        assert_eq!(mine.iter().map(|i| i.mark).collect::<Vec<_>>(), [Mark::Kept, Mark::Edited, Mark::Typed]);
        // The same draft again, with a new decision.
        let mut again = draft_items(&note(), &[]);
        again.push(Item::draft(Kind::Decision, "Use crane B", None));
        n.answer(61.0, Some(again));
        assert_eq!(n.items[..3], mine[..], "the person's items stay first and unchanged");
        let drafts: Vec<&str> = n.items[3..].iter().map(|i| i.text.as_str()).collect();
        assert_eq!(drafts, ["Crane slot moves to Thursday.", "Use crane B"], "kept, rewritten and removed draft items do not come back");
        assert_eq!(n.updated, Some(61.0));
    }

    #[test]
    fn engine_down_keeps_the_last_draft_and_says_so() {
        let mut n = LiveNotes::default();
        n.answer(1.0, Some(draft_items(&note(), &[])));
        n.ask(61.0, 20);
        n.answer(65.0, None);
        assert!(n.down && !n.busy);
        assert_eq!(n.items.len(), 4);
        assert_eq!(n.updated, Some(1.0));
        n.answer(130.0, Some(Vec::new()));
        assert!(!n.down);
    }

    #[test]
    fn a_typed_action_takes_its_owner_after_an_at_sign() {
        assert_eq!(split_owner(" Send the plan @Alya Rahman "), ("Send the plan".into(), Some("Alya Rahman".into())));
        assert_eq!(split_owner("Mail ops@site.com"), ("Mail ops@site.com".into(), None));
        assert_eq!(split_owner("@Alya"), ("@Alya".into(), None));
        let mut n = LiveNotes::default();
        assert!(!n.add(Kind::Decision, "  "));
        assert!(n.add(Kind::Action, "Book crane B @Chen"));
        assert_eq!((n.items[0].text.as_str(), n.items[0].owner.as_deref()), ("Book crane B", Some("Chen")));
        // Emptying an item removes it.
        n.edit(0, "");
        assert!(n.items.is_empty());
    }

    #[test]
    fn the_saved_line_counts_kinds_and_the_persons_items() {
        let mut n = LiveNotes::default();
        n.answer(1.0, Some(draft_items(&note(), &[line("Who covers the night?")])));
        n.keep(1);
        n.keep(2);
        n.add(Kind::Note, "Night watch");
        let c = n.counts();
        assert_eq!(c.line(), "1 summary, 1 decision, 2 actions, 1 question, 1 note. 2 items kept, 1 note typed by you.");
        assert_eq!(Counts::default().line(), "No notes yet.");
    }

    #[test]
    fn the_saved_doc_carries_the_persons_items_as_accepted_and_the_draft_as_ai() {
        let doc = json!({ "id": "MOM-WIN-1", "summary": "", "decisions": [], "actions": [], "items": [] });
        assert_eq!(onto_doc(doc.clone(), &LiveNotes::default()), doc, "no live notes: as before");
        let mut n = LiveNotes::default();
        n.answer(1.0, Some(draft_items(&note(), &[line("Who covers the night?")])));
        let k = n.keep(2);
        n.edit(k, "Confirm the permit today");
        n.add(Kind::Action, "Book crane B @Chen");
        let out = onto_doc(doc, &n);
        assert_eq!(out["id"], "MOM-WIN-1");
        assert_eq!(out["summary"], "Crane slot moves to Thursday.");
        assert_eq!(out["decisions"], json!(["Move the crane slot to Thursday 08:00"]));
        assert_eq!(out["actions"][0]["text"], "Confirm the permit today");
        let items = out["items"].as_array().unwrap();
        let row = |text: &str| items.iter().find(|i| i["text"] == text).unwrap().clone();
        assert_eq!((row("Confirm the permit today")["review"].clone(), row("Confirm the permit today")["ref"].clone()), (json!("edited"), json!("A-1")));
        assert_eq!((row("Book crane B")["review"].clone(), row("Book crane B")["owner"].clone()), (json!("accepted"), json!("Chen")));
        assert_eq!(row("Move the crane slot to Thursday 08:00")["review"], "ai");
        assert_eq!(row("Who covers the night?")["type"], "question");
    }

    #[test]
    fn the_tab_shows_while_a_meeting_runs_and_ten_minutes_after_its_save() {
        assert!(shows_tab(true, None, 0.0));
        assert!(!shows_tab(false, None, 0.0));
        assert!(shows_tab(false, Some(100.0), 699.0));
        assert!(!shows_tab(false, Some(100.0), 700.0));
    }
}

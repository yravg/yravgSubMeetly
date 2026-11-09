//! The engine's models as Settings and the Live page show them: what `GET /models` says (the two
//! configured models, the catalog it can switch between, and the state of each download), whether
//! each is on disk, and the sentence and button that go with it.

use crate::phonedrop::fmt_bytes;
use serde_json::Value;

/// What `POST /engine/models` takes for "no translation".
pub const OFF: &str = "off";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Asr,
    Translate,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Kind::Asr => "Speech model",
            Kind::Translate => "Translation model",
        }
    }
    /// The key `POST /engine/models` takes.
    pub fn wire(self) -> &'static str {
        match self {
            Kind::Asr => "asr",
            Kind::Translate => "translate",
        }
    }
    fn from_wire(s: &str) -> Option<Kind> {
        [Kind::Asr, Kind::Translate].into_iter().find(|k| k.wire() == s)
    }
}

/// How one model stands on disk and in a download (every row and catalog entry carries it).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Status {
    pub downloaded: bool,
    pub pulling: bool,
    /// Finished size on disk; what a download has so far; the engine's estimate of the whole.
    pub bytes: u64,
    pub partial: u64,
    pub done: u64,
    pub total: u64,
    pub pct: Option<u8>,
    pub error: Option<String>,
}

fn num(v: &Value, k: &str) -> u64 {
    v.get(k).and_then(Value::as_u64).unwrap_or(0)
}

fn flag(v: &Value, k: &str) -> bool {
    v.get(k).and_then(Value::as_bool) == Some(true)
}

fn text(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

impl Status {
    fn read(v: &Value) -> Status {
        Status {
            downloaded: flag(v, "downloaded"),
            pulling: flag(v, "pulling"),
            bytes: num(v, "bytes"),
            partial: num(v, "partialBytes"),
            done: num(v, "bytesDone"),
            total: num(v, "bytesTotal"),
            pct: v.get("pct").and_then(Value::as_u64).map(|p| p.min(100) as u8),
            error: text(v, "pullError"),
        }
    }
}

/// One of the two models the engine has configured.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub kind: Kind,
    /// The Hub id; `None` when the engine has no such model configured (translation off).
    pub id: Option<String>,
    pub loaded: bool,
    pub loading: bool,
    /// An environment variable fixes it: the engine will not switch it.
    pub pinned: bool,
    pub st: Status,
}

/// A model the engine can switch to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice {
    pub kind: Kind,
    pub id: String,
    pub label: String,
    pub approx_bytes: u64,
    pub selected: bool,
    pub st: Status,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Inventory {
    pub rows: Vec<Row>,
    pub catalog: Vec<Choice>,
}

fn find_status<'a>(rows: &'a [Row], catalog: &'a [Choice], id: &str) -> Option<&'a Status> {
    rows.iter().find(|r| r.id.as_deref() == Some(id)).map(|r| &r.st).or_else(|| catalog.iter().find(|c| c.id == id).map(|c| &c.st))
}

impl Inventory {
    pub fn status(&self, id: &str) -> Option<&Status> {
        find_status(&self.rows, &self.catalog, id)
    }
}

/// The inventory in `GET /models`' body; `None` when it is not that.
pub fn parse(body: &str) -> Option<Inventory> {
    let v: Value = serde_json::from_str(body).ok()?;
    let kind = |m: &Value| Kind::from_wire(m.get("kind").or_else(|| m.get("key")).and_then(Value::as_str)?);
    let rows = v
        .get("models")?
        .as_array()?
        .iter()
        .filter_map(|m| Some(Row { kind: kind(m)?, id: text(m, "id"), loaded: flag(m, "loaded"), loading: flag(m, "loading"), pinned: flag(m, "fromEnv"), st: Status::read(m) }))
        .collect();
    let catalog = v
        .get("catalog")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|m| {
                    let id = text(m, "id")?;
                    Some(Choice { kind: kind(m)?, label: text(m, "label").unwrap_or_else(|| id.clone()), id, approx_bytes: num(m, "approxBytes"), selected: flag(m, "selected"), st: Status::read(m) })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(Inventory { rows, catalog })
}

/// Is the speech model on disk? `Some(true)` when `/health` says it is loaded or `/models` (fetched
/// only then, by `models`) lists it as downloaded; `None` when the engine does not say.
pub fn speech_on_disk(health: &str, models: impl FnOnce() -> Option<String>) -> Option<bool> {
    let v: Value = serde_json::from_str(health).ok()?;
    if v.get("loaded").and_then(|l| l.get("asr")).and_then(Value::as_bool) == Some(true) {
        return Some(true);
    }
    let row = parse(&models()?)?.rows.into_iter().find(|r| r.kind == Kind::Asr)?;
    row.id.as_ref().map(|_| row.st.downloaded)
}

/// What the island knows about the engine's models.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Models {
    pub rows: Vec<Row>,
    pub catalog: Vec<Choice>,
    /// What the person stepped to in Settings, until the engine uses it (a model still to download).
    pub pick_asr: Option<String>,
    pub pick_translate: Option<String>,
    /// Why the last check failed (the engine is not answering); cleared by the next that works.
    pub error: Option<String>,
    /// When the last check ended (app clock), and whether one is under way.
    pub checked_at: Option<f64>,
    pub busy: bool,
    /// The download this island started, and the last one that failed.
    pub pulling: Option<Kind>,
    pub failed: Option<(Kind, String)>,
}

/// A row's sentence and, when there is something to press, its button.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Described {
    pub text: String,
    pub button: Option<&'static str>,
}

fn said(text: impl Into<String>, button: Option<&'static str>) -> Described {
    Described { text: text.into(), button }
}

impl Models {
    pub fn row(&self, k: Kind) -> Option<&Row> {
        self.rows.iter().find(|r| r.kind == k)
    }

    pub fn apply(&mut self, r: Result<Inventory, String>, now: f64) {
        self.busy = false;
        self.checked_at = Some(now);
        match r {
            Ok(inv) => {
                self.rows = inv.rows;
                self.catalog = inv.catalog;
                self.error = None;
                // A pick the engine has taken up is no longer a pick.
                for k in [Kind::Asr, Kind::Translate] {
                    if self.pick(k).is_some() && self.pick(k) == self.selected(k).as_ref() {
                        self.set_pick(k, None);
                    }
                }
            }
            Err(e) => self.error = Some(e),
        }
    }

    /// Time to ask the engine again (every 10 s while Settings shows the models).
    pub fn due(&self, now: f64) -> bool {
        !self.busy && self.checked_at.is_none_or(|t| now - t > 10.0)
    }

    pub fn status(&self, id: &str) -> Option<&Status> {
        find_status(&self.rows, &self.catalog, id)
    }

    pub fn set_pick(&mut self, k: Kind, id: Option<String>) {
        match k {
            Kind::Asr => self.pick_asr = id,
            Kind::Translate => self.pick_translate = id,
        }
    }

    fn pick(&self, k: Kind) -> Option<&String> {
        match k {
            Kind::Asr => self.pick_asr.as_ref(),
            Kind::Translate => self.pick_translate.as_ref(),
        }
    }

    /// What the engine uses: the Hub id, or `OFF` for no translation; `None` before it answered.
    pub fn selected(&self, k: Kind) -> Option<String> {
        let row = self.row(k)?;
        row.id.clone().or_else(|| (k == Kind::Translate).then(|| OFF.to_string()))
    }

    /// What Settings shows: the person's pick, else what the engine uses.
    pub fn chosen(&self, k: Kind) -> Option<String> {
        self.pick(k).cloned().or_else(|| self.selected(k))
    }

    /// The name for a choice (`Off` for no translation).
    pub fn label_of(&self, id: &str) -> String {
        if id == OFF {
            return "Off".into();
        }
        self.catalog.iter().find(|c| c.id == id).map_or_else(|| id.to_string(), |c| c.label.clone())
    }

    /// The next choice in `step`'s direction, wrapping; `None` when there is nothing to step to
    /// (no catalog, or an environment variable fixes the model).
    pub fn step(&self, k: Kind, step: i32) -> Option<String> {
        let mut ids: Vec<String> = self.catalog.iter().filter(|c| c.kind == k).map(|c| c.id.clone()).collect();
        if k == Kind::Translate && !ids.is_empty() {
            ids.push(OFF.into());
        }
        if ids.len() < 2 || self.row(k).is_some_and(|r| r.pinned) {
            return None;
        }
        let at = self.chosen(k).and_then(|c| ids.iter().position(|i| *i == c)).unwrap_or(0) as i32;
        Some(ids[(at + step.signum()).rem_euclid(ids.len() as i32) as usize].clone())
    }

    /// Can the engine switch to `id` now? Yes when it is not already using it and its files are on
    /// disk; otherwise the switch would make the next request download them silently.
    pub fn switchable(&self, k: Kind, id: &str) -> bool {
        self.selected(k).as_deref() != Some(id) && (id == OFF || self.status(id).is_some_and(|s| s.downloaded))
    }

    pub fn describe(&self, k: Kind) -> Described {
        let Some(id) = self.chosen(k) else {
            return match (&self.error, self.row(k)) {
                (Some(_), _) => said("The engine is not running, so this can't be checked. Start it from the tray menu.", None),
                (None, Some(_)) => said("This engine has no speech model configured.", None),
                (None, None) => said("Checking…", None),
            };
        };
        if id == OFF {
            return said("No translation model, so nothing is translated.", None);
        }
        let st = self.status(&id).cloned().unwrap_or_default();
        if self.pulling == Some(k) || st.pulling {
            let text = match (st.pct, st.done) {
                (Some(p), _) => format!("Downloading… {p}% ({} of about {})", fmt_bytes(st.done), fmt_bytes(st.total)),
                (None, 0) => "Downloading… starting".to_string(),
                (None, d) => format!("Downloading… {} so far", fmt_bytes(d)),
            };
            return said(text, None);
        }
        let failed = self.failed.as_ref().filter(|(fk, _)| *fk == k).map(|(_, w)| w.clone()).or(st.error.clone());
        if let Some(why) = failed {
            return said(format!("The download failed: {why}"), Some("Retry"));
        }
        let pinned = if self.row(k).is_some_and(|r| r.pinned) { " · fixed by an environment variable" } else { "" };
        if !st.downloaded {
            let about = self.catalog.iter().find(|c| c.id == id).map(|c| c.approx_bytes).filter(|b| *b > 0).map_or(String::new(), |b| format!(", about {}", fmt_bytes(b)));
            return said(format!("{id} · not downloaded{about}{pinned}"), Some("Download"));
        }
        let text = match self.row(k).filter(|r| r.id.as_deref() == Some(&id)) {
            Some(r) if r.loading => format!("{id} · loading into memory…{pinned}"),
            Some(r) if r.loaded => format!("{id} · downloaded, in use{pinned}"),
            Some(_) => format!("{id} · downloaded, loads when needed ({}){pinned}", fmt_bytes(st.bytes)),
            None => format!("{id} · downloaded, switching to it…"),
        };
        said(text, None)
    }

    /// The engine answers and its speech model is not on disk: captions cannot start yet.
    pub fn speech_missing(&self) -> bool {
        self.error.is_none() && self.row(Kind::Asr).is_some_and(|r| r.id.is_some() && !r.st.downloaded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = r#"{"models":[
      {"key":"asr","kind":"asr","id":"org/speech-base","loaded":false,"loading":false,"fromEnv":false,"downloaded":false,"bytes":0,"partialBytes":0,"pulling":false,"bytesDone":0,"bytesTotal":150000000,"pct":null,"pullError":null},
      {"key":"translate","kind":"translate","id":"org/mt-small","loaded":true,"downloaded":true,"bytes":1500000000,"pulling":false}],
      "catalog":[
      {"kind":"asr","id":"org/speech-base","label":"Whisper base","approxBytes":150000000,"selected":true,"downloaded":false,"pulling":false},
      {"kind":"asr","id":"org/speech-small","label":"Whisper small","approxBytes":490000000,"selected":false,"downloaded":true,"bytes":490000000,"pulling":false},
      {"kind":"translate","id":"org/mt-small","label":"Qwen small","approxBytes":1500000000,"selected":true,"downloaded":true,"bytes":1500000000,"pulling":false},
      {"kind":"translate","id":"org/mt-big","label":"Qwen big","approxBytes":6000000000,"selected":false,"downloaded":false,"pulling":false}]}"#;

    fn models() -> Models {
        let mut m = Models::default();
        m.apply(Ok(parse(BODY).unwrap()), 1.0);
        m
    }

    #[test]
    fn reads_the_inventory_and_the_catalog() {
        let inv = parse(BODY).unwrap();
        assert_eq!((inv.rows.len(), inv.catalog.len()), (2, 4));
        let (asr, mt) = (&inv.rows[0], &inv.rows[1]);
        assert_eq!((asr.kind, asr.id.as_deref(), asr.st.downloaded, asr.loaded, asr.st.total), (Kind::Asr, Some("org/speech-base"), false, false, 150_000_000));
        assert_eq!((mt.kind, mt.st.downloaded, mt.loaded, mt.st.bytes), (Kind::Translate, true, true, 1_500_000_000));
        assert_eq!((inv.catalog[1].label.as_str(), inv.catalog[1].st.downloaded, inv.catalog[0].selected), ("Whisper small", true, true));
        assert_eq!(inv.status("org/mt-big").map(|s| s.downloaded), Some(false));
        // No id means no model; an engine with no catalog still parses.
        let inv = parse(r#"{"models":[{"key":"translate","id":null}]}"#).unwrap();
        assert!(inv.rows[0].id.is_none() && inv.catalog.is_empty());
        assert_eq!(parse("not json"), None);
        assert_eq!(parse(r#"{"nope":1}"#), None);
    }

    #[test]
    fn each_row_says_what_is_true_and_what_to_press() {
        let mut m = Models::default();
        assert_eq!(m.describe(Kind::Asr), said("Checking…", None));
        m.apply(Err("refused".into()), 1.0);
        assert!(m.describe(Kind::Asr).text.contains("engine is not running"));
        assert!(!m.speech_missing(), "an engine that does not answer has not said the model is missing");
        let mut m = models();
        assert_eq!(m.describe(Kind::Asr), said("org/speech-base · not downloaded, about 150 MB", Some("Download")));
        assert!(m.describe(Kind::Translate).text.contains("downloaded, in use"));
        assert!(m.speech_missing());
        // A download under way shows how far; its failure offers a retry.
        m.pulling = Some(Kind::Asr);
        assert_eq!(m.describe(Kind::Asr), said("Downloading… starting", None));
        m.pulling = None;
        m.rows[0].st.pulling = true;
        m.rows[0].st.pct = Some(40);
        m.rows[0].st.done = 60_000_000;
        assert_eq!(m.describe(Kind::Asr), said("Downloading… 40% (60 MB of about 150 MB)", None), "a download another client started counts too");
        m.rows[0].st.pulling = false;
        m.failed = Some((Kind::Asr, "no network".into()));
        assert_eq!(m.describe(Kind::Asr), said("The download failed: no network", Some("Retry")));
        assert_eq!(m.describe(Kind::Translate).button, None, "another model's failure is not this one's");
        m.failed = None;
        m.rows[0].st.error = Some("disk full".into());
        assert_eq!(m.describe(Kind::Asr).text, "The download failed: disk full");
        // No translation model at all: nothing to download.
        m.apply(Ok(parse(r#"{"models":[{"key":"asr","id":"a/b","downloaded":true},{"key":"translate","id":null}]}"#).unwrap()), 3.0);
        assert_eq!(m.describe(Kind::Translate).button, None);
        assert!(!m.speech_missing());
    }

    #[test]
    fn stepping_picks_a_model_and_switches_only_to_one_on_disk() {
        let mut m = models();
        // Translation wraps through the catalog and ends on Off.
        assert_eq!(m.step(Kind::Translate, 1).as_deref(), Some("org/mt-big"));
        assert_eq!(m.step(Kind::Translate, -1).as_deref(), Some(OFF));
        assert_eq!((m.label_of(OFF).as_str(), m.label_of("org/mt-big").as_str()), ("Off", "Qwen big"));
        // The small speech model is on disk: switch now. The big translation one is not: Download first.
        assert!(m.switchable(Kind::Asr, "org/speech-small") && !m.switchable(Kind::Translate, "org/mt-big"));
        assert!(m.switchable(Kind::Translate, OFF) && !m.switchable(Kind::Translate, "org/mt-small"), "already in use");
        m.set_pick(Kind::Translate, Some("org/mt-big".into()));
        assert_eq!(m.describe(Kind::Translate), said("org/mt-big · not downloaded, about 6.0 GB", Some("Download")));
        assert_eq!(m.step(Kind::Translate, 1).as_deref(), Some(OFF), "stepping goes on from the pick");
        // Once the engine reports it as the one in use, the pick is dropped.
        m.set_pick(Kind::Asr, Some("org/speech-base".into()));
        m.apply(Ok(parse(BODY).unwrap()), 2.0);
        assert_eq!((m.pick_asr.clone(), m.pick_translate.as_deref()), (None, Some("org/mt-big")));
        // A model an environment variable fixes cannot be stepped.
        m.rows[0].pinned = true;
        assert_eq!(m.step(Kind::Asr, 1), None);
        assert!(m.describe(Kind::Asr).text.contains("fixed by an environment variable"));
    }

    #[test]
    fn the_speech_model_counts_as_present_unless_the_engine_says_it_is_not_on_disk() {
        let loaded = |v: bool| format!(r#"{{"ok":true,"loaded":{{"asr":{v}}}}}"#);
        let none = || -> Option<String> { panic!("a loaded model needs no second request") };
        assert_eq!(speech_on_disk(&loaded(true), none), Some(true));
        assert_eq!(speech_on_disk(&loaded(false), || Some(BODY.into())), Some(false));
        let on_disk = BODY.replacen(r#""downloaded":false"#, r#""downloaded":true"#, 1);
        assert_eq!(speech_on_disk(&loaded(false), || Some(on_disk)), Some(true));
        // No answer from /models, or no speech model configured: no claim.
        assert_eq!(speech_on_disk(&loaded(false), || None), None);
        assert_eq!(speech_on_disk(&loaded(false), || Some(r#"{"models":[{"key":"asr","id":null}]}"#.into())), None);
        assert_eq!(speech_on_disk("nope", || None), None);
    }

    #[test]
    fn asks_again_every_ten_seconds_but_not_while_asking() {
        let mut m = Models::default();
        assert!(m.due(0.0));
        m.busy = true;
        assert!(!m.due(99.0));
        m.apply(Ok(Inventory::default()), 100.0);
        assert!(!m.due(105.0) && m.due(110.5));
    }
}

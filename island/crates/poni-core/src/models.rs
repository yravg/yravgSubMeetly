//! The engine's models as Settings and the Live page show them: what `GET /models` says (read
//! tolerantly: this engine lists its two configured models and the cache, a newer one may say
//! more), whether each is on disk, and the sentence and button that go with it.
//!
//! shortcut: the engine has no catalog and no way to switch models (no `POST /engine/models`),
//! so there is nothing to pick; the rows show the configured pair and download them. Add pickers
//! when the engine lists alternatives.

use crate::phonedrop::fmt_bytes;
use serde_json::Value;

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
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub kind: Kind,
    /// The Hub id; `None` when the engine has no such model configured.
    pub id: Option<String>,
    pub loaded: bool,
    pub downloaded: bool,
    /// What is on disk for it (partial while a download runs).
    pub bytes: u64,
}

/// The rows in `GET /models`' body; `None` when it is not that.
pub fn parse(body: &str) -> Option<Vec<Row>> {
    let v: Value = serde_json::from_str(body).ok()?;
    let cached = v.get("cached").and_then(Value::as_array).cloned().unwrap_or_default();
    let rows = v
        .get("models")?
        .as_array()?
        .iter()
        .filter_map(|m| {
            let kind = match m.get("kind").or_else(|| m.get("key")).and_then(Value::as_str)? {
                "asr" => Kind::Asr,
                "translate" => Kind::Translate,
                _ => return None,
            };
            let id = m.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
            let hit = id.as_deref().and_then(|id| cached.iter().find(|c| c.get("id").and_then(Value::as_str) == Some(id)));
            let on_disk = hit.is_some_and(|c| c.get("complete").and_then(Value::as_bool) == Some(true));
            Some(Row {
                kind,
                loaded: m.get("loaded").and_then(Value::as_bool) == Some(true),
                // An engine that says so itself wins over what the cache looks like.
                downloaded: m.get("downloaded").and_then(Value::as_bool).unwrap_or(on_disk),
                bytes: hit.and_then(|c| c.get("bytes")).and_then(Value::as_u64).unwrap_or(0),
                id,
            })
        })
        .collect();
    Some(rows)
}

/// Is the speech model on disk? `Some(true)` when `/health` says it is loaded or `/models` (fetched
/// only then, by `models`) lists it as downloaded; `None` when the engine does not say.
pub fn speech_on_disk(health: &str, models: impl FnOnce() -> Option<String>) -> Option<bool> {
    let v: Value = serde_json::from_str(health).ok()?;
    if v.get("loaded").and_then(|l| l.get("asr")).and_then(Value::as_bool) == Some(true) {
        return Some(true);
    }
    let row = parse(&models()?)?.into_iter().find(|r| r.kind == Kind::Asr)?;
    row.id.as_ref().map(|_| row.downloaded)
}

/// What the island knows about the engine's models.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Models {
    pub rows: Vec<Row>,
    /// Why the last check failed (the engine is not answering); cleared by the next that works.
    pub error: Option<String>,
    /// When the last check ended (app clock), and whether one is under way.
    pub checked_at: Option<f64>,
    pub busy: bool,
    /// The download under way, and the last one that failed.
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

    pub fn apply(&mut self, r: Result<Vec<Row>, String>, now: f64) {
        self.busy = false;
        self.checked_at = Some(now);
        match r {
            Ok(rows) => {
                self.rows = rows;
                self.error = None;
            }
            Err(e) => self.error = Some(e),
        }
    }

    /// Time to ask the engine again (every 10 s while Settings shows the models).
    pub fn due(&self, now: f64) -> bool {
        !self.busy && self.checked_at.is_none_or(|t| now - t > 10.0)
    }

    pub fn describe(&self, k: Kind) -> Described {
        if self.pulling == Some(k) {
            let have = self.row(k).map_or(0, |r| r.bytes);
            return said(if have == 0 { "Downloading… starting".to_string() } else { format!("Downloading… {} so far", fmt_bytes(have)) }, None);
        }
        if let Some((_, why)) = self.failed.as_ref().filter(|(fk, _)| *fk == k) {
            return said(format!("The download failed: {why}"), Some("Retry"));
        }
        let Some(row) = self.row(k) else {
            return match &self.error {
                Some(_) => said("The engine is not running, so this can't be checked. Start it from the tray menu.", None),
                None => said("Checking…", None),
            };
        };
        let Some(id) = &row.id else {
            return said(
                match k {
                    Kind::Asr => "This engine has no speech model configured.",
                    Kind::Translate => "This engine has no translation model, so nothing is translated.",
                },
                None,
            );
        };
        match (row.downloaded, row.loaded) {
            (true, true) => said(format!("{id} · downloaded, in use"), None),
            (true, false) => said(format!("{id} · downloaded, loads when needed ({})", fmt_bytes(row.bytes)), None),
            (false, _) => said(format!("{id} · not downloaded"), Some("Download")),
        }
    }

    /// The engine answers and its speech model is not on disk: captions cannot start yet.
    pub fn speech_missing(&self) -> bool {
        self.error.is_none() && self.row(Kind::Asr).is_some_and(|r| r.id.is_some() && !r.downloaded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = r#"{"models":[
      {"key":"asr","kind":"asr","id":"org/speech-small","engine":"x","device":"cpu","available":true,"loaded":false},
      {"key":"translate","kind":"translate","id":"org/mt-small","engine":"y","device":"cpu","available":true,"loaded":true}],
      "cached":[{"id":"org/mt-small","bytes":1500000000,"files":9,"snapshots":1,"complete":true},
                {"id":"org/speech-small","bytes":42000000,"files":2,"snapshots":0,"complete":false}]}"#;

    #[test]
    fn reads_the_inventory_against_the_cache() {
        let rows = parse(BODY).unwrap();
        assert_eq!(rows.len(), 2);
        let (asr, mt) = (&rows[0], &rows[1]);
        assert_eq!((asr.kind, asr.id.as_deref(), asr.downloaded, asr.loaded, asr.bytes), (Kind::Asr, Some("org/speech-small"), false, false, 42_000_000));
        assert_eq!((mt.kind, mt.downloaded, mt.loaded, mt.bytes), (Kind::Translate, true, true, 1_500_000_000));
        // An engine that says `downloaded` itself is believed; no id means no model.
        let rows = parse(r#"{"models":[{"key":"asr","id":"a/b","downloaded":true},{"key":"translate","id":null}]}"#).unwrap();
        assert!(rows[0].downloaded && rows[1].id.is_none());
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
        m.apply(Ok(parse(BODY).unwrap()), 2.0);
        assert_eq!(m.describe(Kind::Asr), said("org/speech-small · not downloaded", Some("Download")));
        assert!(m.describe(Kind::Translate).text.contains("downloaded, in use"));
        assert!(m.speech_missing());
        // A download under way shows what is on disk; its failure offers a retry.
        m.pulling = Some(Kind::Asr);
        assert_eq!(m.describe(Kind::Asr), said("Downloading… 42 MB so far", None));
        m.pulling = None;
        m.failed = Some((Kind::Asr, "no network".into()));
        assert_eq!(m.describe(Kind::Asr), said("The download failed: no network", Some("Retry")));
        assert_eq!(m.describe(Kind::Translate).button, None, "another model's failure is not this one's");
        // No translation model at all: nothing to download.
        m.failed = None;
        m.apply(Ok(parse(r#"{"models":[{"key":"asr","id":"a/b","downloaded":true},{"key":"translate","id":null,"available":false}]}"#).unwrap()), 3.0);
        assert_eq!(m.describe(Kind::Translate).button, None);
        assert!(!m.speech_missing());
    }

    #[test]
    fn the_speech_model_counts_as_present_unless_the_engine_says_it_is_not_on_disk() {
        let loaded = |v: bool| format!(r#"{{"ok":true,"loaded":{{"asr":{v}}}}}"#);
        let none = || -> Option<String> { panic!("a loaded model needs no second request") };
        assert_eq!(speech_on_disk(&loaded(true), none), Some(true));
        assert_eq!(speech_on_disk(&loaded(false), || Some(BODY.into())), Some(false));
        let on_disk = BODY.replace(r#""bytes":42000000,"files":2,"snapshots":0,"complete":false"#, r#""bytes":42000000,"files":2,"snapshots":1,"complete":true"#);
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
        m.apply(Ok(Vec::new()), 100.0);
        assert!(!m.due(105.0) && m.due(110.5));
    }
}

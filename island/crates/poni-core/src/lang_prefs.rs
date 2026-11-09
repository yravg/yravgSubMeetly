//! The spoken and the target language, kept in one place: the engine's
//! `/ui-prefs` (`srcLang`, `tgtLang`), which the extension and the web app
//! read too. The island reads it with every poll, writes it when the person
//! changes a language, and keeps its own settings as the offline fallback.

use crate::capture::LANGS;
use serde_json::{json, Value};

/// What `/ui-prefs` holds; `None` = not set (or a code this island cannot offer).
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct LangPrefs {
    pub src: Option<String>,
    pub tgt: Option<String>,
}

fn known(code: &str, with_auto: bool) -> Option<String> {
    let code = code.trim().to_ascii_lowercase();
    (with_auto && code == "auto" || LANGS.iter().any(|(c, _)| *c == code)).then_some(code)
}

/// The languages in a `GET /ui-prefs` body.
pub fn parse(body: &str) -> LangPrefs {
    let v: Option<Value> = serde_json::from_str(body).ok();
    let get = |key: &str, auto: bool| v.as_ref()?.pointer(&format!("/prefs/{key}"))?.as_str().and_then(|s| known(s, auto));
    LangPrefs { src: get("srcLang", true), tgt: get("tgtLang", false) }
}

/// The `POST /ui-prefs` body that says both languages.
pub fn patch_body(src: &str, tgt: &str) -> String {
    json!({ "srcLang": src, "tgtLang": tgt }).to_string()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Nothing,
    /// The engine's word wins: set these (only the ones that differ).
    Adopt { src: Option<String>, tgt: Option<String> },
    /// The engine has none yet: tell it ours.
    Push,
}

/// Remembers what the engine said last, so a reply from before the person's
/// own change (the poll was already in flight) is not mistaken for a change.
#[derive(Debug, Default)]
pub struct Sync {
    seen: Option<LangPrefs>,
    pushed: bool,
}

impl Sync {
    /// `engine`: what the last poll read. `src`/`tgt`: the island's own languages.
    pub fn on_engine(&mut self, engine: &LangPrefs, src: &str, tgt: &str) -> Step {
        if *engine == LangPrefs::default() {
            // Once a run: an engine that refuses the keys (an older one) is not asked every 2.5 s.
            return if std::mem::replace(&mut self.pushed, true) { Step::Nothing } else { Step::Push };
        }
        if self.seen.as_ref() == Some(engine) {
            return Step::Nothing;
        }
        self.seen = Some(engine.clone());
        let differs = |e: &Option<String>, own: &str| e.clone().filter(|e| e != own);
        let (s, t) = (differs(&engine.src, src), differs(&engine.tgt, tgt));
        if s.is_none() && t.is_none() {
            Step::Nothing
        } else {
            Step::Adopt { src: s, tgt: t }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(src: Option<&str>, tgt: Option<&str>) -> LangPrefs {
        LangPrefs { src: src.map(Into::into), tgt: tgt.map(Into::into) }
    }

    #[test]
    fn the_prefs_body_gives_the_languages_the_island_can_offer() {
        assert_eq!(parse(r#"{"prefs":{"theme":"auto","srcLang":"de","tgtLang":"en"}}"#), engine(Some("de"), Some("en")));
        assert_eq!(parse(r#"{"prefs":{"srcLang":"AUTO","tgtLang":"auto"}}"#), engine(Some("auto"), None), "the target is never auto");
        assert_eq!(parse(r#"{"prefs":{"srcLang":"xx","tgtLang":7}}"#), LangPrefs::default());
        assert_eq!(parse(r#"{"prefs":{"theme":"dark"}}"#), LangPrefs::default(), "an older engine");
        assert_eq!(parse("not json"), LangPrefs::default());
    }

    #[test]
    fn the_patch_names_both_keys() {
        let v: Value = serde_json::from_str(&patch_body("de", "id")).unwrap();
        assert_eq!((v["srcLang"].as_str(), v["tgtLang"].as_str()), (Some("de"), Some("id")));
    }

    #[test]
    fn an_engine_with_no_languages_is_told_ours_once() {
        let mut s = Sync::default();
        assert_eq!(s.on_engine(&LangPrefs::default(), "de", "en"), Step::Push);
        assert_eq!(s.on_engine(&LangPrefs::default(), "de", "en"), Step::Nothing, "an engine that refuses is not asked every poll");
    }

    #[test]
    fn the_engines_word_wins_at_the_start() {
        let mut s = Sync::default();
        assert_eq!(s.on_engine(&engine(Some("de"), Some("id")), "auto", "en"), Step::Adopt { src: Some("de".into()), tgt: Some("id".into()) });
        // Same answer again: nothing to do.
        assert_eq!(s.on_engine(&engine(Some("de"), Some("id")), "de", "id"), Step::Nothing);
    }

    #[test]
    fn only_what_differs_is_adopted() {
        let mut s = Sync::default();
        assert_eq!(s.on_engine(&engine(Some("de"), Some("en")), "auto", "en"), Step::Adopt { src: Some("de".into()), tgt: None });
        assert_eq!(s.on_engine(&engine(Some("de"), Some("en")), "de", "en"), Step::Nothing);
        assert_eq!(Sync::default().on_engine(&engine(Some("de"), Some("en")), "de", "en"), Step::Nothing);
    }

    #[test]
    fn a_late_reply_from_before_the_persons_change_does_not_undo_it() {
        let mut s = Sync::default();
        assert_eq!(s.on_engine(&engine(Some("de"), Some("en")), "de", "en"), Step::Nothing);
        // The person picks Indonesian; a poll already in flight still says English.
        assert_eq!(s.on_engine(&engine(Some("de"), Some("en")), "de", "id"), Step::Nothing);
        // The web app changes it later: that is adopted.
        assert_eq!(s.on_engine(&engine(Some("de"), Some("ja")), "de", "id"), Step::Adopt { src: None, tgt: Some("ja".into()) });
    }
}

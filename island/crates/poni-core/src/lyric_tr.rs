//! Translation of synced lyrics for the collapsed pill: one translation per
//! song through the engine's `POST /translate`, kept in a cache file, shown
//! as the second row under the sung line (where readings go).
//!
//! Pure parts only: which language a song is in, whether it needs a
//! translation, the request path, the answer, the cache file and the row
//! choice. The thread that talks to the engine is `poni::services::lyric_translate`.

use crate::romanize::{song_script, Script};
use crate::sha256::{hex, sha256};
use serde::{Deserialize, Serialize};

/// Where a song's translation stands.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub enum TrState {
    /// Nothing asked: translation off, song already in the target language, or no lyrics yet.
    #[default]
    Idle,
    /// Lines come in as the engine translates them.
    Working,
    Ready,
    /// The engine could not (no model, not running): the reason in one sentence.
    Unavailable(String),
}

impl TrState {
    /// The pill keeps its translation row for the whole song while this holds.
    pub fn row(&self) -> bool {
        matches!(self, TrState::Working | TrState::Ready)
    }
}

/// The song's language as the engine names it, when the text says so: kana is
/// Japanese, Hangul Korean, Han Chinese; mostly common English words English.
/// `None`: unknown (the engine then detects it).
/// shortcut: only these four are recognised, other Latin-script languages are
/// sent as "auto"; upgrade when a song in another language is mistranslated.
pub fn song_lang(lines: &[&str]) -> Option<&'static str> {
    match song_script(lines) {
        Some(Script::Japanese) => return Some("ja"),
        Some(Script::Korean) => return Some("ko"),
        Some(Script::Chinese) => return Some("zh"),
        None => {}
    }
    const COMMON: [&str; 14] = ["the", "you", "and", "i", "to", "a", "me", "my", "is", "in", "it", "of", "we", "your"];
    let words: Vec<String> = lines.iter().flat_map(|l| l.split(|c: char| !c.is_alphabetic() && c != '\'')).filter(|w| !w.is_empty()).map(str::to_lowercase).collect();
    let hits = words.iter().filter(|w| COMMON.contains(&w.as_str())).count();
    (words.len() >= 12 && hits * 100 >= words.len() * 18).then_some("en")
}

/// A song needs translating unless it is known to be in the target language.
pub fn wants(src: Option<&str>, tgt: &str) -> bool {
    !tgt.is_empty() && src != Some(tgt)
}

/// `POST /translate` path for a song in `src` (`None` = detect) into `tgt`.
pub fn translate_path(src: Option<&str>, tgt: &str) -> String {
    format!("/translate?src={}&tgt={}", src.unwrap_or("auto"), tgt)
}

/// What a song's translation says when the model is not on disk: one quiet line in place of the
/// second row. The engine never downloads by itself; Settings > Models does, on a press.
pub const MODEL_MISSING: &str = "The translation model is not downloaded. Download it in Settings, under Models.";

/// The engine's answer: the translated text, or one sentence why not (a 409
/// `model-not-downloaded` is [`MODEL_MISSING`]).
pub fn parse_translation(code: u16, body: &str) -> Result<String, String> {
    let v: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let field = |k: &str| v.as_ref().and_then(|v| v.get(k)).and_then(|t| t.as_str()).map(|t| t.trim().to_string());
    if code == 200 {
        return field("text").ok_or_else(|| "The engine's answer was not a translation.".to_string());
    }
    if code == 409 && field("code").as_deref() == Some("model-not-downloaded") {
        return Err(MODEL_MISSING.into());
    }
    let why = field("error").unwrap_or_else(|| format!("The engine said {code}."));
    Err(why.chars().take(160).collect())
}

/// A translation worth showing: not empty, and not just the line again.
pub fn distinct(line: &str, translation: &str) -> Option<String> {
    let key = |s: &str| s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect::<String>();
    let t = translation.trim();
    (!t.is_empty() && key(t) != key(line)).then(|| t.to_string())
}

/// One song's translations on disk: index-aligned with the lyric lines, `""` for none.
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
pub struct Cache {
    pub tgt: String,
    pub lines: Vec<String>,
}

/// The cache file's name for a track and target language.
pub fn cache_name(track_key: &str, tgt: &str) -> String {
    format!("tr-{}-{tgt}.json", &hex(&sha256(track_key.as_bytes()))[..16])
}

/// A cache is usable only for the same target and the same number of lines.
pub fn usable(cache: Cache, tgt: &str, lines: usize) -> Option<Vec<String>> {
    (cache.tgt == tgt && cache.lines.len() == lines).then_some(cache.lines)
}

/// What the second row under line `i` shows: its translation when the song is
/// being translated, else its reading. Translation replaces readings for the
/// whole song (the song is in another language than the target, which is the
/// point of the row); readings stay on the Music page.
pub fn second_row(state: &TrState, translated: &[String], i: usize, reading: Option<String>) -> Option<String> {
    if state.row() {
        return translated.get(i).filter(|t| !t.is_empty()).map(|t| t.to_string());
    }
    reading
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_scripts_and_english() {
        assert_eq!(song_lang(&["テスト行です"]), Some("ja"));
        assert_eq!(song_lang(&["테스트 줄"]), Some("ko"));
        assert_eq!(song_lang(&["测试行"]), Some("zh"));
        let en = ["I know the way to you", "and it is in my head", "we can go to the sea", "your hand in my hand"];
        assert_eq!(song_lang(&en), Some("en"));
        assert_eq!(song_lang(&["garis satu untuk kamu", "garis dua dari saya", "tiga empat lima enam", "tujuh delapan sembilan sepuluh"]), None);
    }

    #[test]
    fn wants_unless_already_in_target() {
        assert!(wants(Some("ja"), "en"));
        assert!(wants(None, "en"));
        assert!(!wants(Some("en"), "en"));
        assert!(!wants(Some("ja"), ""));
    }

    #[test]
    fn path_and_answers() {
        assert_eq!(translate_path(Some("ja"), "id"), "/translate?src=ja&tgt=id");
        assert_eq!(translate_path(None, "en"), "/translate?src=auto&tgt=en");
        assert_eq!(parse_translation(200, r#"{"text":" line one ","ms":5}"#), Ok("line one".into()));
        assert_eq!(parse_translation(501, r#"{"error":"no translation model"}"#), Err("no translation model".into()));
        assert!(parse_translation(200, "nope").is_err());
        assert_eq!(parse_translation(409, r#"{"error":"not downloaded","code":"model-not-downloaded","id":"x"}"#), Err(MODEL_MISSING.into()));
        assert_eq!(parse_translation(409, r#"{"error":"busy"}"#), Err("busy".into()));
        assert_eq!(parse_translation(500, "").unwrap_err(), "The engine said 500.");
    }

    #[test]
    fn same_text_is_no_translation() {
        assert_eq!(distinct("Line one!", "line one"), None);
        assert_eq!(distinct("テスト", " "), None);
        assert_eq!(distinct("テスト行", "test line"), Some("test line".into()));
    }

    #[test]
    fn cache_is_per_track_target_and_length() {
        assert_ne!(cache_name("a", "en"), cache_name("b", "en"));
        assert_ne!(cache_name("a", "en"), cache_name("a", "id"));
        let c = || Cache { tgt: "en".into(), lines: vec!["one".into(), String::new()] };
        assert_eq!(usable(c(), "en", 2), Some(vec!["one".to_string(), String::new()]));
        assert_eq!(usable(c(), "id", 2), None);
        assert_eq!(usable(c(), "en", 3), None);
        let j = serde_json::to_string(&c()).unwrap();
        assert_eq!(serde_json::from_str::<Cache>(&j).unwrap(), c());
    }

    #[test]
    fn translation_replaces_the_reading_while_translating() {
        let tr = vec!["line one".to_string(), String::new()];
        assert_eq!(second_row(&TrState::Ready, &tr, 0, Some("rii".into())), Some("line one".into()));
        // A line not translated yet shows nothing, not its reading.
        assert_eq!(second_row(&TrState::Working, &tr, 1, Some("rii".into())), None);
        assert_eq!(second_row(&TrState::Idle, &tr, 0, Some("rii".into())), Some("rii".into()));
        assert_eq!(second_row(&TrState::Unavailable("x".into()), &tr, 0, None), None);
    }
}

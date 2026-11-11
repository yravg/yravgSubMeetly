//! The model library (PMM-028/029/030): every model the engine offers in one list, filtered
//! (On device / All / Recommended) and searched, with what each row says and which buttons it
//! has; and the languages list (what each caption language needs and whether it is on this PC).
//! Pure: the island's Advanced settings › Models and the pill's Captions › Models draw from it.

use crate::capture::{lang_name, LANGS};
use crate::geom::{palette, Color};
use crate::models::{Choice, Kind, Models, Status, OFF};
use crate::phonedrop::fmt_bytes;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Filter {
    #[default]
    OnDevice,
    All,
    Recommended,
}

impl Filter {
    pub const ALL: [Filter; 3] = [Filter::OnDevice, Filter::All, Filter::Recommended];
    pub fn label(self) -> &'static str {
        match self {
            Filter::OnDevice => "On device",
            Filter::All => "All",
            Filter::Recommended => "Recommended",
        }
    }
}

/// A button of a row. `Confirm`/`Keep` replace the others while a Delete asks to be confirmed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Use,
    Download,
    ByHand,
    Folder,
    Delete,
    Confirm,
    Keep,
}

impl Action {
    pub fn label(self) -> &'static str {
        match self {
            Action::Use => "Use",
            Action::Download => "Download",
            Action::ByHand => "By hand",
            Action::Folder => "Folder",
            Action::Delete => "Delete",
            Action::Confirm => "Delete",
            Action::Keep => "Keep",
        }
    }
}

/// A model's andon light: one look says where it stands (owner 2026-11-11).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Light {
    /// On this PC and whole.
    Ready,
    /// Downloading or moving now.
    Working,
    /// Some files are here, the rest is missing (a download that stopped).
    Partial,
    /// The last download failed; the row says why.
    Failed,
    /// Not on this PC.
    Absent,
}

impl Light {
    pub fn of(st: &Status) -> Light {
        match () {
            _ if st.pulling || st.moving => Light::Working,
            _ if st.error.is_some() => Light::Failed,
            _ if st.downloaded => Light::Ready,
            _ if st.partial > 0 => Light::Partial,
            _ => Light::Absent,
        }
    }

    pub fn color(self) -> Color {
        match self {
            Light::Ready => palette::GREEN,
            Light::Working => palette::YELLOW,
            Light::Partial => palette::ORANGE,
            Light::Failed => palette::RED,
            Light::Absent => palette::TEXT_FAINT,
        }
    }
}

/// How far a download is, 0 to 1, while one runs; a move shows its own.
pub fn progress(st: &Status) -> Option<f32> {
    let pct = if st.pulling {
        st.pct
    } else if st.moving {
        st.move_pct
    } else {
        return None;
    };
    Some(pct.map_or(0.0, |p| f32::from(p.min(100)) / 100.0))
}

/// Where downloads come from: the setting's value and what Settings calls it.
pub const SOURCES: [(&str, &str); 2] = [("huggingface", "Hugging Face"), ("modelscope", "ModelScope")];

/// The web page of `id`'s files on `source`, for a download by hand. ModelScope keeps
/// Whisper under `openai-mirror` (same as the engine's `modelscope_id`).
pub fn files_url(source: &str, id: &str) -> String {
    match (source, id.strip_prefix("openai/")) {
        ("modelscope", Some(name)) => format!("https://www.modelscope.cn/models/openai-mirror/{name}/files"),
        ("modelscope", None) => format!("https://www.modelscope.cn/models/{id}/files"),
        _ => format!("https://huggingface.co/{id}/tree/main"),
    }
}

/// One row: a catalog model, or a fast language pair.
#[derive(Clone, Copy, Debug)]
pub struct Entry<'a> {
    pub c: &'a Choice,
    pub pair: bool,
}

/// Every model, speech then translation then the fast pairs (the engine's order within each).
pub fn entries(m: &Models) -> Vec<Entry<'_>> {
    m.catalog.iter().map(|c| Entry { c, pair: false }).chain(m.pairs.iter().map(|c| Entry { c, pair: true })).collect()
}

/// The two language codes of an OPUS-MT pair id (`…/opus-mt-en-id`).
fn pair_langs(id: &str) -> Option<(&str, &str)> {
    id.rsplit('/').next()?.strip_prefix("opus-mt-")?.split_once('-')
}

impl Entry<'_> {
    pub fn kind(&self) -> &'static str {
        match (self.pair, self.c.kind) {
            (true, _) => "Language pair",
            (false, Kind::Asr) => "Speech",
            (false, Kind::Translate) => "Translation",
        }
    }

    /// Whisper and the LLMs serve every language with one download; a pair serves its own.
    pub fn languages(&self) -> String {
        match pair_langs(&self.c.id).filter(|_| self.pair) {
            Some((a, b)) => format!("{} → {}", lang_name(a), lang_name(b)),
            None => "All languages".into(),
        }
    }

    pub fn in_use(&self, m: &Models) -> bool {
        !self.pair && m.selected(self.c.kind).as_deref() == Some(self.c.id.as_str())
    }

    /// The state: on device with its size, not downloaded (about N), downloading, failed.
    pub fn state(&self, m: &Models) -> String {
        let (c, st) = (self.c, &self.c.st);
        if m.removing.as_deref() == Some(c.id.as_str()) {
            return "Deleting…".into();
        }
        if m.deleting.as_deref() == Some(c.id.as_str()) {
            return format!("Delete {}? Frees {}.", c.label, fmt_bytes(st.bytes));
        }
        if st.pulling {
            let size = if st.total > 0 { format!(" · {} of {}", fmt_bytes(st.done), fmt_bytes(st.total)) } else { String::new() };
            return st.pct.map_or("Downloading…".into(), |p| format!("Downloading {p}%{size}"));
        }
        if let Some(e) = &st.error {
            return format!("Failed: {e}");
        }
        match (st.downloaded, self.in_use(m)) {
            (true, true) => format!("In use · on device, {}", fmt_bytes(st.bytes)),
            (true, false) => format!("On device, {}", fmt_bytes(st.bytes)),
            _ if st.partial > 0 => format!("Part downloaded, {} of about {}", fmt_bytes(st.partial), fmt_bytes(c.approx_bytes)),
            _ => format!("Not downloaded, about {}", fmt_bytes(c.approx_bytes)),
        }
    }

    /// The line under the name: kind · languages · state.
    pub fn sub(&self, m: &Models) -> String {
        format!("{} · {} · {}", self.kind(), self.languages(), self.state(m))
    }

    /// The buttons that make sense now. Never Delete for the model in use.
    pub fn actions(&self, m: &Models) -> Vec<Action> {
        let (c, st) = (self.c, &self.c.st);
        if m.deleting.as_deref() == Some(c.id.as_str()) {
            return vec![Action::Confirm, Action::Keep];
        }
        if st.pulling || st.moving || m.removing.as_deref() == Some(c.id.as_str()) {
            return vec![];
        }
        if !st.downloaded {
            return vec![Action::Download, Action::ByHand];
        }
        let in_use = self.in_use(m);
        let mut v = Vec::new();
        if !self.pair && !in_use {
            v.push(Action::Use);
        }
        if st.dir.is_some() {
            v.push(Action::Folder);
        }
        if !in_use {
            v.push(Action::Delete);
        }
        v
    }

    /// Recommended: the engine's translation pick, the speech model in use, and the fast pair
    /// for the person's spoken → translate-into languages.
    fn recommended(&self, m: &Models, src: &str, tgt: &str) -> bool {
        let id = self.c.id.as_str();
        match self.pair {
            true => pair_langs(id) == Some((src, tgt)),
            false => m.recommended.as_ref().is_some_and(|(r, _)| r == id) || (self.c.kind == Kind::Asr && self.in_use(m)),
        }
    }

    fn matches(&self, q: &str) -> bool {
        [self.c.label.as_str(), self.c.id.as_str(), self.kind(), &self.languages()].iter().any(|h| h.to_lowercase().contains(q))
    }
}

/// The rows the filter and the search box let through. `src`/`tgt`: the shared languages.
pub fn shown<'a>(m: &'a Models, filter: Filter, query: &str, src: &str, tgt: &str) -> Vec<Entry<'a>> {
    let q = query.trim().to_lowercase();
    entries(m)
        .into_iter()
        .filter(|e| match filter {
            Filter::OnDevice => e.c.st.downloaded,
            Filter::All => true,
            Filter::Recommended => e.recommended(m, src, tgt),
        })
        .filter(|e| q.is_empty() || e.matches(&q))
        .collect()
}

/// PMM-029: for each caption language, what it needs and whether that is on this PC.
/// Speech is Whisper (multilingual, one download); English comes from Whisper itself, the others
/// from the translation model; a fast pair into the language helps when it is downloaded.
pub fn language_rows(m: &Models) -> Vec<(&'static str, String)> {
    let speech = match m.row(Kind::Asr) {
        Some(r) if r.st.downloaded => "Speech on device",
        Some(_) => "Speech model not downloaded",
        None => "Speech: engine not answering",
    };
    let llm = m.selected(Kind::Translate).filter(|id| id != OFF);
    let llm_text = match &llm {
        None => "translation off".to_string(),
        Some(id) => {
            let on = m.status(id).is_some_and(|s| s.downloaded);
            format!("translated by {}{}", m.label_of(id), if on { ", on device" } else { ", not downloaded" })
        }
    };
    LANGS
        .iter()
        .map(|&(code, name)| {
            let tr = if code == "en" { "translated by Whisper itself".to_string() } else { llm_text.clone() };
            let mut text = format!("{speech} · {tr}");
            for p in m.pairs.iter().filter(|p| pair_langs(&p.id).is_some_and(|(_, b)| b == code)) {
                let (a, _) = pair_langs(&p.id).unwrap_or_default();
                text += &format!(" · fast pair from {}: {}", lang_name(a), if p.st.downloaded { "on device" } else { "not downloaded" });
            }
            (name, text)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::parse;

    const BODY: &str = r#"{"models":[
      {"kind":"asr","id":"openai/whisper-base","downloaded":true,"bytes":290000000,"dir":"C:\\hf"},
      {"kind":"translate","id":"Qwen/q-small","downloaded":true,"bytes":988000000,"dir":"C:\\hf"}],
      "catalog":[
      {"kind":"asr","id":"openai/whisper-base","label":"Whisper base","approxBytes":290000000,"selected":true,"downloaded":true,"bytes":290000000,"dir":"C:\\hf"},
      {"kind":"asr","id":"openai/whisper-small","label":"Whisper small","approxBytes":967000000,"downloaded":true,"bytes":967000000,"dir":"C:\\hf"},
      {"kind":"translate","id":"Qwen/q-small","label":"Qwen small","approxBytes":988000000,"selected":true,"downloaded":true,"bytes":988000000,"dir":"C:\\hf"},
      {"kind":"translate","id":"Qwen/q-big","label":"Qwen big","approxBytes":3090000000,"pulling":true,"pct":42},
      {"kind":"translate","id":"Qwen/q-mid","label":"Qwen mid","approxBytes":1110000000,"pullError":"download failed: timed out"},
      {"kind":"translate-pair","id":"Helsinki-NLP/opus-mt-en-id","label":"OPUS-MT English to Indonesian","approxBytes":291000000,"downloaded":true,"bytes":291000000,"dir":"C:\\hf"},
      {"kind":"translate-pair","id":"Helsinki-NLP/opus-mt-ja-en","label":"OPUS-MT Japanese to English","approxBytes":303000000}],
      "recommended":{"id":"Qwen/q-big","downloaded":false}}"#;

    fn models() -> Models {
        let mut m = Models::default();
        m.apply(Ok(parse(BODY).unwrap()), 1.0);
        m
    }

    fn ids(v: &[Entry]) -> Vec<String> {
        v.iter().map(|e| e.c.id.rsplit('/').next().unwrap().to_string()).collect()
    }

    #[test]
    fn pairs_are_listed_but_never_offered_as_the_translation_model() {
        let m = models();
        assert_eq!(m.pairs.len(), 2);
        assert!(m.catalog.iter().all(|c| !c.id.contains("opus-mt")));
        // A pair's download progress is found by id, as the pull follower asks.
        assert!(m.status("Helsinki-NLP/opus-mt-en-id").is_some_and(|s| s.downloaded));
    }

    #[test]
    fn filters_and_search_pick_the_rows() {
        let m = models();
        assert_eq!(ids(&shown(&m, Filter::OnDevice, "", "en", "id")), ["whisper-base", "whisper-small", "q-small", "opus-mt-en-id"]);
        assert_eq!(shown(&m, Filter::All, "", "en", "id").len(), 7);
        assert_eq!(ids(&shown(&m, Filter::Recommended, "", "en", "id")), ["whisper-base", "q-big", "opus-mt-en-id"]);
        assert_eq!(ids(&shown(&m, Filter::Recommended, "", "ja", "en")), ["whisper-base", "q-big", "opus-mt-ja-en"]);
        // Search reads the name, the id, the kind and the languages, ignoring case.
        assert_eq!(ids(&shown(&m, Filter::All, "  JAPANESE ", "en", "id")), ["opus-mt-ja-en"]);
        assert_eq!(ids(&shown(&m, Filter::All, "speech", "en", "id")), ["whisper-base", "whisper-small"]);
        assert_eq!(ids(&shown(&m, Filter::OnDevice, "qwen", "en", "id")), ["q-small"]);
    }

    #[test]
    fn each_row_says_kind_languages_and_state() {
        let m = models();
        let all = shown(&m, Filter::All, "", "en", "id");
        let sub: Vec<String> = all.iter().map(|e| e.sub(&m)).collect();
        assert_eq!(sub[0], "Speech · All languages · In use · on device, 290 MB");
        assert_eq!(sub[1], "Speech · All languages · On device, 967 MB");
        assert_eq!(sub[3], "Translation · All languages · Downloading 42%");
        assert_eq!(sub[4], "Translation · All languages · Failed: download failed: timed out");
        assert_eq!(sub[5], "Language pair · English → Indonesian · On device, 291 MB");
        assert_eq!(sub[6], "Language pair · Japanese → English · Not downloaded, about 303 MB");
    }

    #[test]
    fn the_model_in_use_has_no_delete_and_others_get_the_buttons_that_fit() {
        let m = models();
        let all = shown(&m, Filter::All, "", "en", "id");
        let acts: Vec<Vec<Action>> = all.iter().map(|e| e.actions(&m)).collect();
        assert_eq!(acts[0], [Action::Folder]);
        assert_eq!(acts[1], [Action::Use, Action::Folder, Action::Delete]);
        assert_eq!(acts[2], [Action::Folder]);
        assert!(acts[3].is_empty(), "downloading: nothing to press");
        assert_eq!(acts[4], [Action::Download, Action::ByHand]);
        assert_eq!(acts[5], [Action::Folder, Action::Delete], "a pair is never 'used', only kept or deleted");
        assert_eq!(acts[6], [Action::Download, Action::ByHand]);
    }

    #[test]
    fn delete_asks_with_the_size_then_shows_it_is_under_way() {
        let mut m = models();
        m.deleting = Some("openai/whisper-small".into());
        let e = shown(&m, Filter::All, "", "en", "id")[1];
        assert_eq!(e.state(&m), "Delete Whisper small? Frees 967 MB.");
        assert_eq!(e.actions(&m), [Action::Confirm, Action::Keep]);
        m.deleting = None;
        m.removing = Some("openai/whisper-small".into());
        let e = shown(&m, Filter::All, "", "en", "id")[1];
        assert_eq!(e.state(&m), "Deleting…");
        assert!(e.actions(&m).is_empty());
    }

    #[test]
    fn languages_say_what_each_needs_and_what_is_here() {
        let m = models();
        let rows = language_rows(&m);
        let get = |n: &str| rows.iter().find(|(name, _)| *name == n).unwrap().1.clone();
        assert_eq!(get("English"), "Speech on device · translated by Whisper itself · fast pair from Japanese: not downloaded");
        assert_eq!(get("Indonesian"), "Speech on device · translated by Qwen small, on device · fast pair from English: on device");
        assert_eq!(get("Chinese"), "Speech on device · translated by Qwen small, on device");
        assert_eq!(rows.len(), LANGS.len());
    }

    #[test]
    fn each_row_has_an_andon_light_and_a_bar_while_it_downloads() {
        let m = models();
        let lights: Vec<Light> = entries(&m).iter().map(|e| Light::of(&e.c.st)).collect();
        // base, small, q-small on device; q-big pulling; q-mid failed; en-id on device; ja-en absent.
        assert!(lights.contains(&Light::Ready));
        let at = |id: &str| entries(&m).into_iter().find(|e| e.c.id.ends_with(id)).unwrap();
        assert_eq!(Light::of(&at("q-big").c.st), Light::Working);
        assert_eq!(progress(&at("q-big").c.st), Some(0.42));
        assert_eq!(Light::of(&at("q-mid").c.st), Light::Failed);
        assert_eq!(progress(&at("q-mid").c.st), None);
        assert_eq!(Light::of(&at("ja-en").c.st), Light::Absent);
        assert_eq!(Light::Failed.color(), palette::RED);

        let mut st = Status { partial: 120_000_000, ..Status::default() };
        assert_eq!(Light::of(&st), Light::Partial);
        st.pulling = true;
        st.pct = Some(30);
        st.done = 90_000_000;
        st.total = 300_000_000;
        assert_eq!(Light::of(&st), Light::Working, "a retry is yellow, not red, even after a failure");
        let mut c = at("ja-en").c.clone();
        c.st = st;
        assert_eq!(Entry { c: &c, pair: true }.state(&m), "Downloading 30% · 90 MB of 300 MB");
        c.st = Status { partial: 120_000_000, ..Status::default() };
        assert_eq!(Entry { c: &c, pair: true }.state(&m), "Part downloaded, 120 MB of about 303 MB");
    }

    #[test]
    fn by_hand_opens_the_files_page_of_the_chosen_source() {
        assert_eq!(files_url("huggingface", "openai/whisper-base"), "https://huggingface.co/openai/whisper-base/tree/main");
        assert_eq!(files_url("modelscope", "openai/whisper-base"), "https://www.modelscope.cn/models/openai-mirror/whisper-base/files");
        assert_eq!(files_url("modelscope", "unsloth/Qwen3-0.6B-GGUF"), "https://www.modelscope.cn/models/unsloth/Qwen3-0.6B-GGUF/files");
        assert_eq!(files_url("", "a/b"), "https://huggingface.co/a/b/tree/main", "an unknown value is Hugging Face");
    }
}

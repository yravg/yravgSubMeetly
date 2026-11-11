//! Model speed (Advanced settings › Models › Speed): what the engine measured on THIS PC for each
//! downloaded model (`GET /models/bench`), turned into the rows of a bar chart. Pure: the Settings
//! window draws from it, tests run without a window. Nothing here makes up a number: a model with
//! no test has no bar, only a "Not tested yet" and a button.

use crate::library::{entries, Entry};
use crate::models::{Kind, Models};
use serde_json::Value;
use std::collections::BTreeMap;

/// Runs kept per model by the engine; the sparkline shows at most this many.
pub const KEEP: usize = 10;
/// A bar of a tested model is never thinner than this share of the chart's width.
pub const MIN_BAR: f32 = 0.03;

/// One finished test of one model.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Run {
    pub speed: f64,
    pub unit: String,
    pub latency_ms: f64,
    pub load_ms: f64,
    pub samples: usize,
    pub device: String,
    pub at: String,
}

/// What `GET /models/bench` said.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Report {
    /// Per model id, oldest first.
    pub runs: BTreeMap<String, Vec<Run>>,
    /// The model being tested now and how far it is (0 to 1).
    pub active: Option<(String, f32)>,
    /// Model ids waiting.
    pub queue: Vec<String>,
    /// Per model id, why its last test failed.
    pub failed: BTreeMap<String, String>,
}

fn text(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn float(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}

/// Read the engine's answer. `None` when it is not the shape this version reads.
pub fn parse(body: &str) -> Option<Report> {
    let v: Value = serde_json::from_str(body).ok()?;
    let mut report = Report::default();
    for (id, list) in v.get("runs")?.as_object()? {
        let runs = list
            .as_array()?
            .iter()
            .map(|r| Run {
                speed: float(r, "speed"),
                unit: text(r, "unit"),
                latency_ms: float(r, "latency_ms"),
                load_ms: float(r, "load_ms"),
                samples: r.get("samples").and_then(Value::as_u64).unwrap_or(0) as usize,
                device: text(r, "device"),
                at: text(r, "at"),
            })
            .collect::<Vec<_>>();
        report.runs.insert(id.clone(), runs);
    }
    if let Some(a) = v.get("active").filter(|a| a.is_object()) {
        report.active = Some((text(a, "id"), float(a, "progress") as f32));
    }
    if let Some(q) = v.get("queue").and_then(Value::as_array) {
        report.queue = q.iter().map(|i| text(i, "id")).collect();
    }
    if let Some(f) = v.get("failed").and_then(Value::as_object) {
        report.failed = f.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect();
    }
    Some(report)
}

/// What the island knows about the speed tests.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Speed {
    pub report: Report,
    /// Why the last look failed (the engine is not answering).
    pub error: Option<String>,
    /// When the last look ended (app clock), and whether one is under way.
    pub checked_at: Option<f64>,
    pub busy: bool,
}

impl Speed {
    pub fn apply(&mut self, r: Result<Report, String>, now: f64) {
        self.busy = false;
        self.checked_at = Some(now);
        match r {
            Ok(report) => {
                self.report = report;
                self.error = None;
            }
            Err(e) => self.error = Some(e),
        }
    }

    /// A test is running or waiting.
    pub fn testing(&self) -> bool {
        self.report.active.is_some() || !self.report.queue.is_empty()
    }

    /// Ask again: quickly while a test runs (it shows its progress), slowly otherwise.
    pub fn due(&self, now: f64) -> bool {
        let every = if self.testing() { 1.0 } else { 10.0 };
        !self.busy && self.checked_at.is_none_or(|t| now - t > every)
    }
}

/// The three charts: units differ, so each has its own scale.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Group {
    Speech,
    Translation,
    Pair,
}

impl Group {
    pub const ALL: [Group; 3] = [Group::Speech, Group::Translation, Group::Pair];

    pub fn title(self) -> &'static str {
        match self {
            Group::Speech => "Speech recognition",
            Group::Translation => "Translation",
            Group::Pair => "Fast language pairs",
        }
    }

    /// What a longer bar means.
    pub fn caption(self) -> &'static str {
        match self {
            Group::Speech => "Times real time on a 4 s caption window (longer is faster)",
            Group::Translation => "Tokens per second (longer is faster)",
            Group::Pair => "Sentences per second (longer is faster)",
        }
    }
}

/// Where a model stands in the chart.
#[derive(Clone, Debug, PartialEq)]
pub enum State {
    /// Has a result (the newest is in `Row::latest`).
    Tested,
    /// Running now, 0 to 1.
    Testing(f32),
    Queued,
    /// The last test failed with this reason.
    Failed(String),
    NotTested,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub id: String,
    pub label: String,
    pub group: Group,
    pub latest: Option<Run>,
    /// Speeds of the kept runs, oldest first (the sparkline).
    pub history: Vec<f64>,
    /// The bar: latest speed over the fastest in its group, 0 to 1 (0 when untested).
    pub ratio: f32,
    pub state: State,
}

fn group_of(e: &Entry) -> Group {
    match (e.pair, e.c.kind) {
        (true, _) => Group::Pair,
        (false, Kind::Asr) => Group::Speech,
        (false, Kind::Translate) => Group::Translation,
    }
}

/// One row per downloaded model, in the engine's order; the bars scale within a group.
pub fn rows(m: &Models, s: &Speed) -> Vec<Row> {
    let mut out: Vec<Row> = entries(m)
        .iter()
        .filter(|e| e.c.st.downloaded)
        .map(|e| {
            let id = e.c.id.clone();
            let runs = s.report.runs.get(&id).cloned().unwrap_or_default();
            let latest = runs.last().cloned();
            let state = if let Some((a, p)) = s.report.active.as_ref().filter(|(a, _)| *a == id) {
                let _ = a;
                State::Testing(*p)
            } else if s.report.queue.contains(&id) {
                State::Queued
            } else if let Some(why) = s.report.failed.get(&id) {
                State::Failed(why.clone())
            } else if latest.is_some() {
                State::Tested
            } else {
                State::NotTested
            };
            Row { label: e.c.label.clone(), group: group_of(e), history: runs.iter().map(|r| r.speed).collect(), latest, id, ratio: 0.0, state }
        })
        .collect();
    for g in Group::ALL {
        let top = out.iter().filter(|r| r.group == g).filter_map(|r| r.latest.as_ref()).map(|l| l.speed).fold(0.0f64, f64::max);
        for r in out.iter_mut().filter(|r| r.group == g) {
            r.ratio = match (&r.latest, top > 0.0) {
                (Some(l), true) => ((l.speed / top) as f32).clamp(MIN_BAR, 1.0),
                _ => 0.0,
            };
        }
    }
    out
}

/// "8.0× real time", "41.3 tokens/s", "12.5 sentences/s".
pub fn value_text(g: Group, run: &Run) -> String {
    let v = if run.speed >= 100.0 { format!("{:.0}", run.speed) } else { format!("{:.1}", run.speed) };
    match g {
        Group::Speech => format!("{v}× real time"),
        Group::Translation => format!("{v} tokens/s"),
        Group::Pair => format!("{v} sentences/s"),
    }
}

/// "497 ms per window" / "250 ms per sentence".
pub fn latency_text(g: Group, run: &Run) -> String {
    let per = if g == Group::Speech { "window" } else { "sentence" };
    if run.latency_ms >= 1000.0 {
        format!("{:.1} s per {per}", run.latency_ms / 1000.0)
    } else {
        format!("{:.0} ms per {per}", run.latency_ms)
    }
}

/// The date part of an ISO time ("2026-11-12T08:30:00Z" → "2026-11-12").
pub fn day(at: &str) -> &str {
    at.split('T').next().unwrap_or(at)
}

/// The device the newest run in the whole report ran on ("cpu", "metal", "cuda"), if any.
pub fn device(s: &Speed) -> Option<&str> {
    s.report.runs.values().filter_map(|r| r.last()).max_by(|a, b| a.at.cmp(&b.at)).map(|r| r.device.as_str()).filter(|d| !d.is_empty())
}

/// A sparkline of `values` in a box `w` by `h`: x spread evenly, y scaled between the smallest and
/// largest value (a flat series sits in the middle). Fewer than two values give no line.
pub fn spark(values: &[f64], w: f32, h: f32) -> Vec<(f32, f32)> {
    let n = values.len();
    if n < 2 {
        return Vec::new();
    }
    let (lo, hi) = values.iter().fold((f64::MAX, f64::MIN), |(lo, hi), v| (lo.min(*v), hi.max(*v)));
    values
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let x = w * i as f32 / (n - 1) as f32;
            let y = if hi > lo { h - h * ((v - lo) / (hi - lo)) as f32 } else { h / 2.0 };
            (x, y)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Choice, Status};

    fn choice(kind: Kind, id: &str, label: &str, downloaded: bool) -> Choice {
        Choice { kind, id: id.into(), label: label.into(), approx_bytes: 1, selected: false, st: Status { downloaded, ..Status::default() } }
    }

    fn models() -> Models {
        Models {
            catalog: vec![
                choice(Kind::Asr, "openai/whisper-base", "Whisper base", true),
                choice(Kind::Asr, "openai/whisper-large-v3-turbo", "Whisper large v3 turbo", true),
                choice(Kind::Asr, "openai/whisper-small", "Whisper small", false),
                choice(Kind::Translate, "unsloth/Qwen3-1.7B-GGUF", "Qwen3 1.7B", true),
            ],
            pairs: vec![choice(Kind::Translate, "Helsinki-NLP/opus-mt-en-id", "English → Indonesian", true)],
            ..Models::default()
        }
    }

    fn run(speed: f64, unit: &str, at: &str) -> Run {
        Run { speed, unit: unit.into(), latency_ms: 500.0, load_ms: 900.0, samples: 3, device: "metal".into(), at: at.into() }
    }

    const BODY: &str = r#"{"runs":{"openai/whisper-base":[{"id":"openai/whisper-base","kind":"asr","speed":20.0,"unit":"x real time","latency_ms":200.0,"load_ms":300.0,"samples":3,"device":"metal","at":"2026-11-12T08:00:00Z","engine_version":"0.1.0"},{"speed":25.5,"unit":"x real time","latency_ms":157.0,"load_ms":290.0,"samples":3,"device":"metal","at":"2026-11-12T09:00:00Z"}]},"active":{"id":"unsloth/Qwen3-1.7B-GGUF","kind":"translate","progress":0.4},"queue":[{"id":"Helsinki-NLP/opus-mt-en-id","kind":"pair"}],"failed":{"openai/whisper-large-v3-turbo":"out of memory"}}"#;

    #[test]
    fn the_engines_answer_is_read() {
        let r = parse(BODY).unwrap();
        assert_eq!(r.runs["openai/whisper-base"].len(), 2);
        assert_eq!(r.runs["openai/whisper-base"][1].speed, 25.5);
        assert_eq!(r.active, Some(("unsloth/Qwen3-1.7B-GGUF".into(), 0.4)));
        assert_eq!(r.queue, vec!["Helsinki-NLP/opus-mt-en-id".to_string()]);
        assert_eq!(r.failed["openai/whisper-large-v3-turbo"], "out of memory");
        assert!(parse("not json").is_none());
        assert!(parse("{}").is_none(), "no runs key is not this shape");
        let empty = parse(r#"{"runs":{},"active":null,"queue":[],"failed":{}}"#).unwrap();
        assert_eq!(empty, Report::default());
    }

    #[test]
    fn only_downloaded_models_get_rows_with_their_states() {
        let s = Speed { report: parse(BODY).unwrap(), ..Speed::default() };
        let rows = rows(&models(), &s);
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["openai/whisper-base", "openai/whisper-large-v3-turbo", "unsloth/Qwen3-1.7B-GGUF", "Helsinki-NLP/opus-mt-en-id"], "whisper-small is not downloaded");
        assert_eq!(rows[0].state, State::Tested);
        assert_eq!(rows[0].history, vec![20.0, 25.5]);
        assert_eq!(rows[1].state, State::Failed("out of memory".into()));
        assert_eq!(rows[2].state, State::Testing(0.4));
        assert_eq!(rows[3].state, State::Queued);
        assert_eq!(rows[1].group, Group::Speech);
        assert_eq!(rows[2].group, Group::Translation);
        assert_eq!(rows[3].group, Group::Pair);
    }

    #[test]
    fn nothing_tested_means_no_bars_only_not_tested() {
        let rows = rows(&models(), &Speed::default());
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|r| r.state == State::NotTested && r.ratio == 0.0 && r.latest.is_none() && r.history.is_empty()));
    }

    #[test]
    fn bars_scale_within_their_own_group_and_the_fastest_is_full() {
        let mut s = Speed::default();
        s.report.runs.insert("openai/whisper-base".into(), vec![run(40.0, "x real time", "t")]);
        s.report.runs.insert("openai/whisper-large-v3-turbo".into(), vec![run(10.0, "x real time", "t")]);
        s.report.runs.insert("unsloth/Qwen3-1.7B-GGUF".into(), vec![run(5.0, "tokens/s", "t")]);
        let r = rows(&models(), &s);
        assert_eq!(r[0].ratio, 1.0);
        assert_eq!(r[1].ratio, 0.25);
        assert_eq!(r[2].ratio, 1.0, "a different unit has its own scale");
        assert_eq!(r[3].ratio, 0.0, "an untested pair has no bar");
    }

    #[test]
    fn a_very_slow_model_still_shows_a_sliver() {
        let mut s = Speed::default();
        s.report.runs.insert("openai/whisper-base".into(), vec![run(100.0, "x", "t")]);
        s.report.runs.insert("openai/whisper-large-v3-turbo".into(), vec![run(0.2, "x", "t")]);
        let r = rows(&models(), &s);
        assert_eq!(r[1].ratio, MIN_BAR);
    }

    #[test]
    fn the_texts_say_what_the_numbers_are() {
        let r = run(8.04, "x real time", "2026-11-12T09:00:00Z");
        assert_eq!(value_text(Group::Speech, &r), "8.0× real time");
        assert_eq!(value_text(Group::Translation, &run(41.26, "tokens/s", "")), "41.3 tokens/s");
        assert_eq!(value_text(Group::Pair, &run(123.4, "sentences/s", "")), "123 sentences/s");
        assert_eq!(latency_text(Group::Speech, &r), "500 ms per window");
        assert_eq!(latency_text(Group::Translation, &Run { latency_ms: 2500.0, ..r.clone() }), "2.5 s per sentence");
        assert_eq!(day(&r.at), "2026-11-12");
    }

    #[test]
    fn the_device_is_the_one_of_the_newest_run() {
        let mut s = Speed::default();
        assert_eq!(device(&s), None);
        s.report.runs.insert("a".into(), vec![Run { device: "cpu".into(), ..run(1.0, "x", "2026-11-10T00:00:00Z") }]);
        s.report.runs.insert("b".into(), vec![Run { device: "metal".into(), ..run(1.0, "x", "2026-11-12T00:00:00Z") }]);
        assert_eq!(device(&s), Some("metal"));
    }

    #[test]
    fn sparkline_spreads_x_and_scales_y_and_needs_two_points() {
        assert!(spark(&[], 100.0, 20.0).is_empty());
        assert!(spark(&[5.0], 100.0, 20.0).is_empty());
        let p = spark(&[10.0, 20.0, 15.0], 100.0, 20.0);
        assert_eq!(p, vec![(0.0, 20.0), (50.0, 0.0), (100.0, 10.0)]);
        let flat = spark(&[7.0, 7.0], 10.0, 8.0);
        assert_eq!(flat, vec![(0.0, 4.0), (10.0, 4.0)]);
    }

    #[test]
    fn polling_is_fast_while_testing_and_slow_otherwise() {
        let mut s = Speed::default();
        assert!(s.due(0.0), "never asked: ask");
        s.apply(Ok(Report::default()), 10.0);
        assert!(!s.due(15.0));
        assert!(s.due(21.0));
        s.apply(Ok(parse(BODY).unwrap()), 30.0);
        assert!(s.testing());
        assert!(s.due(31.5));
        s.busy = true;
        assert!(!s.due(100.0), "one look at a time");
        s.apply(Err("engine is not answering".into()), 40.0);
        assert_eq!(s.error.as_deref(), Some("engine is not answering"));
        assert!(s.testing(), "the last report stays while the engine does not answer");
    }
}

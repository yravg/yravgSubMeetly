//! Model speed tests: how fast each downloaded model runs ON THIS MACHINE.
//!
//! `POST /models/bench` queues a standard test, `GET /models/bench` returns what was measured. Every
//! number is a real measurement of this device (CPU or GPU, see `device`) at the time of the run; the
//! engine never ships or invents reference numbers, so a model nobody has tested has no row.
//!
//! What is measured:
//! - **Speech models**: three 4 s windows of a real English recording (the CC0 sample the caption
//!   tests use, embedded in the engine). One untimed warm-up window first. `speed` is "x real time" = audio seconds per
//!   second of compute for one 4 s window (the shape captions run in); `latency_ms` is the mean time
//!   per window.
//! - **Translation LLMs**: eight fixed short sentences English to Indonesian, greedy, one untimed
//!   warm-up. `speed` is tokens per second, `latency_ms` the mean time per sentence.
//! - **OPUS-MT pair models**: the same sentences in the pair's direction; `speed` is sentences per
//!   second (these models do not expose a token count).
//!
//! The runner is a trait so the persistence, queue and maths are tested without a real model.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::models::Kind;

/// Runs kept per model, newest last.
pub const KEEP_RUNS: usize = 10;
/// Seconds of audio in one speed-test window (what a caption window is).
pub const WINDOW_SECS: f64 = 4.0;
const SAMPLE_RATE: usize = 16_000;
const TIMED_WINDOWS: usize = 3;

/// The fixed English sentences of the translation test.
pub const SENTENCES_EN: [&str; 8] = [
    "Good morning, everyone. Let's start the meeting.",
    "Could you share your screen so we can see the numbers?",
    "The deadline moved to next Friday because of the review.",
    "I will send the minutes and the action items this afternoon.",
    "We agreed to test the new release on both platforms first.",
    "Please mute your microphone when you are not speaking.",
    "The budget is approved, but we still need a final quote.",
    "Thank you all, see you again next week.",
];

/// The same eight in Indonesian, for the id→en pair model.
pub const SENTENCES_ID: [&str; 8] = [
    "Selamat pagi semuanya. Mari kita mulai rapatnya.",
    "Bisakah Anda membagikan layar agar kami bisa melihat angkanya?",
    "Tenggat waktunya mundur ke Jumat depan karena peninjauan.",
    "Saya akan mengirim notulen dan daftar tindak lanjut sore ini.",
    "Kami sepakat menguji rilis baru di kedua platform lebih dulu.",
    "Mohon matikan mikrofon Anda saat tidak sedang berbicara.",
    "Anggarannya sudah disetujui, tetapi kita masih butuh penawaran akhir.",
    "Terima kasih semuanya, sampai jumpa lagi minggu depan.",
];

// ---------------------------------------------------------------- the maths

/// Audio seconds produced per second of compute ("x real time"). 0 for a zero or negative time.
pub fn times_real_time(audio_secs: f64, compute_secs: f64) -> f64 {
    if compute_secs > 0.0 && audio_secs >= 0.0 {
        audio_secs / compute_secs
    } else {
        0.0
    }
}

/// Items per second (tokens, sentences). 0 for a zero or negative time.
pub fn per_second(count: usize, secs: f64) -> f64 {
    if secs > 0.0 {
        count as f64 / secs
    } else {
        0.0
    }
}

/// Mean of the samples; 0 for none.
pub fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

/// Round to one decimal (what the file and the screen show).
pub fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

// ---------------------------------------------------------------- the test clip

/// The speech the speed test listens to: a real recording (public domain, CC0; the same set the
/// caption tests use), so the model decodes real words and the time is representative. A synthetic
/// tone makes Whisper ramble until its token limit and says nothing about captions.
static CLIP_MP3: &[u8] = include_bytes!("../../../test/samples/cc0/en-1.mp3");

/// The embedded recording as 16 kHz mono samples.
pub fn speech_clip() -> Result<Vec<f32>> {
    let path =
        std::env::temp_dir().join(format!("submeetly-bench-clip-{}.mp3", std::process::id()));
    std::fs::write(&path, CLIP_MP3)?;
    let decoded = crate::audio::decode_file(&path);
    let _ = std::fs::remove_file(&path);
    decoded
}

/// `count` consecutive windows of `WINDOW_SECS` from `pcm` (16 kHz). Fewer when the audio is
/// shorter; a partial last window is dropped so every window is the same length.
pub fn windows(pcm: &[f32], count: usize) -> Vec<Vec<f32>> {
    let len = (WINDOW_SECS * SAMPLE_RATE as f64) as usize;
    pcm.chunks_exact(len)
        .take(count)
        .map(<[f32]>::to_vec)
        .collect()
}

// ---------------------------------------------------------------- results

/// One finished test of one model.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    /// "asr", "translate" or "pair".
    pub kind: String,
    /// Headline speed: x real time (asr), tokens/s (translate), sentences/s (pair).
    pub speed: f64,
    pub unit: String,
    /// Mean time per 4 s window (asr) or per sentence (translate, pair), in milliseconds.
    pub latency_ms: f64,
    /// Time to load the model, in milliseconds.
    pub load_ms: f64,
    /// How many windows or sentences were timed.
    pub samples: usize,
    /// "cpu", "metal" or "cuda": the device this ran on.
    pub device: String,
    /// UTC time of the run, ISO 8601.
    pub at: String,
    pub engine_version: String,
}

/// What one test measured, before it is stamped with a time and a device.
#[derive(Clone, Debug, PartialEq)]
pub struct Measured {
    pub speed: f64,
    pub unit: &'static str,
    pub latency_ms: f64,
    pub load_ms: f64,
    pub samples: usize,
}

pub fn kind_label(kind: Kind) -> &'static str {
    match kind {
        Kind::Asr => "asr",
        Kind::Translate => "translate",
        Kind::PairMt => "pair",
    }
}

/// Runs one test. The real one loads the model; tests inject a fake.
pub trait Runner: Send + Sync {
    /// `progress` is called with 0..1 as the test advances.
    fn run(&self, id: &str, kind: Kind, progress: &dyn Fn(f32)) -> Result<Measured>;
    fn device(&self) -> String;
}

// ---------------------------------------------------------------- the store

#[derive(Default)]
struct Inner {
    runs: BTreeMap<String, Vec<Run>>,
    /// What runs now: (id, kind, progress 0..1).
    active: Option<(String, Kind, f32)>,
    queue: Vec<(String, Kind)>,
    /// The last failure per model id (cleared by its next success).
    failed: BTreeMap<String, String>,
}

pub struct Bench {
    path: PathBuf,
    inner: Mutex<Inner>,
    worker_running: AtomicBool,
}

fn lock(m: &Mutex<Inner>) -> std::sync::MutexGuard<'_, Inner> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Bench {
    /// Loads `path` (bench.json) when it exists and parses; a missing or damaged file is an empty history.
    pub fn load(path: PathBuf) -> Self {
        let runs = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|v| v.get("runs").cloned())
            .and_then(|v| serde_json::from_value::<BTreeMap<String, Vec<Run>>>(v).ok())
            .unwrap_or_default();
        Bench {
            path,
            inner: Mutex::new(Inner {
                runs,
                ..Inner::default()
            }),
            worker_running: AtomicBool::new(false),
        }
    }

    /// Record a finished run: newest last, at most `KEEP_RUNS` per model, then write the file.
    pub fn record(&self, run: Run) {
        let mut inner = lock(&self.inner);
        inner.failed.remove(&run.id);
        let list = inner.runs.entry(run.id.clone()).or_default();
        list.push(run);
        let extra = list.len().saturating_sub(KEEP_RUNS);
        list.drain(..extra);
        let snapshot = json!({ "version": 1, "runs": inner.runs });
        drop(inner);
        let _ = write_atomic(&self.path, &snapshot.to_string());
    }

    /// `GET /models/bench`.
    pub fn snapshot(&self) -> Value {
        let inner = lock(&self.inner);
        json!({
            "runs": inner.runs,
            "active": inner.active.as_ref().map(|(id, kind, p)| json!({ "id": id, "kind": kind_label(*kind), "progress": p })),
            "queue": inner.queue.iter().map(|(id, kind)| json!({ "id": id, "kind": kind_label(*kind) })).collect::<Vec<_>>(),
            "failed": inner.failed,
        })
    }

    pub fn busy(&self) -> bool {
        let inner = lock(&self.inner);
        inner.active.is_some() || !inner.queue.is_empty()
    }

    /// Queue tests (a model already queued or running is skipped); starts the worker thread when
    /// it is not running. Returns how many were added.
    pub fn enqueue(self: &Arc<Self>, runner: Arc<dyn Runner>, items: Vec<(String, Kind)>) -> usize {
        let mut added = 0;
        {
            let mut inner = lock(&self.inner);
            for (id, kind) in items {
                let running = inner.active.as_ref().is_some_and(|(a, _, _)| *a == id);
                let queued = inner.queue.iter().any(|(q, _)| *q == id);
                if !running && !queued {
                    inner.queue.push((id, kind));
                    added += 1;
                }
            }
        }
        if added > 0 && !self.worker_running.swap(true, Ordering::SeqCst) {
            let me = Arc::clone(self);
            let spawned = std::thread::Builder::new()
                .name("models-bench".into())
                .spawn(move || me.work(runner));
            if spawned.is_err() {
                self.worker_running.store(false, Ordering::SeqCst);
            }
        }
        added
    }

    fn work(self: Arc<Self>, runner: Arc<dyn Runner>) {
        loop {
            let next = {
                let mut inner = lock(&self.inner);
                if inner.queue.is_empty() {
                    inner.active = None;
                    self.worker_running.store(false, Ordering::SeqCst);
                    return;
                }
                let (id, kind) = inner.queue.remove(0);
                inner.active = Some((id.clone(), kind, 0.0));
                (id, kind)
            };
            let (id, kind) = next;
            let me = Arc::clone(&self);
            let progress_id = id.clone();
            let progress = move |p: f32| {
                let mut inner = lock(&me.inner);
                if let Some((active, _, slot)) = inner.active.as_mut() {
                    if *active == progress_id {
                        *slot = p.clamp(0.0, 1.0);
                    }
                }
            };
            // A panic in a model must not leave the queue stuck.
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                runner.run(&id, kind, &progress)
            }))
            .unwrap_or_else(|_| Err(anyhow!("the speed test crashed")));
            match outcome {
                Ok(m) => self.record(Run {
                    id: id.clone(),
                    kind: kind_label(kind).to_string(),
                    speed: round1(m.speed),
                    unit: m.unit.to_string(),
                    latency_ms: round1(m.latency_ms),
                    load_ms: round1(m.load_ms),
                    samples: m.samples,
                    device: runner.device(),
                    at: crate::state::now_utc_iso(),
                    engine_version: env!("CARGO_PKG_VERSION").to_string(),
                }),
                Err(e) => {
                    eprintln!("[bench] {id}: {e}");
                    lock(&self.inner).failed.insert(id, format!("{e}"));
                }
            }
        }
    }
}

fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

// ---------------------------------------------------------------- the real runner

/// Loads each model fresh (separate from the one the engine keeps for captions) and times it.
pub struct MlRunner {
    pub ml: Arc<crate::engine::Ml>,
}

impl Runner for MlRunner {
    fn device(&self) -> String {
        self.ml.device_name().to_string()
    }

    fn run(&self, id: &str, kind: Kind, progress: &dyn Fn(f32)) -> Result<Measured> {
        match kind {
            Kind::Asr => {
                let t = Instant::now();
                let mut asr = self.ml.load_for_bench_asr(id)?;
                let load_ms = t.elapsed().as_secs_f64() * 1000.0;
                progress(0.3);
                // The recording, cut into caption-sized windows. Warm-up on the first (untimed): the
                // first run pays for kernels and caches. The timed ones are the next three.
                let clip = windows(&speech_clip()?, TIMED_WINDOWS + 1);
                if clip.len() < TIMED_WINDOWS + 1 {
                    return Err(anyhow!("the test recording is too short"));
                }
                asr.transcribe(&clip[0], Some("en"), crate::whisper::Task::Transcribe)?;
                let mut window_ms = Vec::new();
                for (w, samples) in clip[1..].iter().enumerate() {
                    let t = Instant::now();
                    asr.transcribe(samples, Some("en"), crate::whisper::Task::Transcribe)?;
                    window_ms.push(t.elapsed().as_secs_f64() * 1000.0);
                    progress(0.3 + 0.7 * (w + 1) as f32 / TIMED_WINDOWS as f32);
                }
                let latency = mean(&window_ms);
                Ok(Measured {
                    speed: times_real_time(WINDOW_SECS, latency / 1000.0),
                    unit: "x real time",
                    latency_ms: latency,
                    load_ms,
                    samples: window_ms.len(),
                })
            }
            Kind::Translate => {
                let t = Instant::now();
                let mut mt = self.ml.load_for_bench_translator(id)?;
                let load_ms = t.elapsed().as_secs_f64() * 1000.0;
                progress(0.2);
                mt.translate_counted(SENTENCES_EN[0], "en", "id", true)?;
                let (mut tokens, mut secs, mut each) = (0usize, 0.0f64, Vec::new());
                for (i, s) in SENTENCES_EN.iter().enumerate() {
                    let t = Instant::now();
                    let (_, n) = mt.translate_counted(s, "en", "id", true)?;
                    let took = t.elapsed().as_secs_f64();
                    tokens += n;
                    secs += took;
                    each.push(took * 1000.0);
                    progress(0.2 + 0.8 * (i + 1) as f32 / SENTENCES_EN.len() as f32);
                }
                Ok(Measured {
                    speed: per_second(tokens, secs),
                    unit: "tokens/s",
                    latency_ms: mean(&each),
                    load_ms,
                    samples: each.len(),
                })
            }
            Kind::PairMt => {
                let sentences: &[&str] = if id.contains("opus-mt-en-") {
                    &SENTENCES_EN
                } else if id.contains("opus-mt-id-en") {
                    &SENTENCES_ID
                } else {
                    return Err(anyhow!(
                        "there are no test sentences for this language pair"
                    ));
                };
                let t = Instant::now();
                let mut model = self.ml.load_for_bench_pair(id)?;
                let load_ms = t.elapsed().as_secs_f64() * 1000.0;
                progress(0.2);
                model.translate(sentences[0])?;
                let (mut secs, mut each) = (0.0f64, Vec::new());
                for (i, s) in sentences.iter().enumerate() {
                    let t = Instant::now();
                    model.translate(s)?;
                    let took = t.elapsed().as_secs_f64();
                    secs += took;
                    each.push(took * 1000.0);
                    progress(0.2 + 0.8 * (i + 1) as f32 / sentences.len() as f32);
                }
                Ok(Measured {
                    speed: per_second(sentences.len(), secs),
                    unit: "sentences/s",
                    latency_ms: mean(&each),
                    load_ms,
                    samples: each.len(),
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct Fake {
        fail: Option<&'static str>,
    }
    impl Runner for Fake {
        fn device(&self) -> String {
            "cpu".into()
        }
        fn run(&self, id: &str, kind: Kind, progress: &dyn Fn(f32)) -> Result<Measured> {
            progress(0.5);
            if self.fail == Some(id) {
                return Err(anyhow!("model is damaged"));
            }
            Ok(match kind {
                Kind::Asr => Measured {
                    speed: 8.04,
                    unit: "x real time",
                    latency_ms: 497.46,
                    load_ms: 1200.0,
                    samples: 3,
                },
                _ => Measured {
                    speed: 41.26,
                    unit: "tokens/s",
                    latency_ms: 250.0,
                    load_ms: 800.0,
                    samples: 8,
                },
            })
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "bench-test-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("bench.json")
    }

    fn wait_idle(b: &Bench) {
        for _ in 0..200 {
            if !b.busy() && !b.worker_running.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("the queue never drained");
    }

    #[test]
    fn real_time_factor_is_audio_over_compute() {
        assert_eq!(times_real_time(4.0, 0.5), 8.0);
        assert_eq!(times_real_time(4.0, 8.0), 0.5);
        assert_eq!(times_real_time(4.0, 0.0), 0.0);
        assert_eq!(times_real_time(4.0, -1.0), 0.0);
    }

    #[test]
    fn throughput_mean_and_rounding() {
        assert_eq!(per_second(100, 2.0), 50.0);
        assert_eq!(per_second(5, 0.0), 0.0);
        assert_eq!(mean(&[1.0, 2.0, 6.0]), 3.0);
        assert_eq!(mean(&[]), 0.0);
        assert_eq!(round1(8.0449), 8.0);
        assert_eq!(round1(8.05), 8.1);
    }

    #[test]
    fn the_embedded_recording_has_enough_real_audio_for_the_windows() {
        let pcm = speech_clip().expect("decodes");
        let secs = pcm.len() as f64 / SAMPLE_RATE as f64;
        assert!(
            secs >= WINDOW_SECS * (TIMED_WINDOWS + 1) as f64,
            "{secs} s is too short"
        );
        let energy: f32 = pcm.iter().map(|s| s * s).sum::<f32>() / pcm.len() as f32;
        assert!(energy > 1e-5, "the recording is not silent: {energy}");
        let w = windows(&pcm, TIMED_WINDOWS + 1);
        assert_eq!(w.len(), TIMED_WINDOWS + 1);
        assert!(w.iter().all(|x| x.len() == 64_000));
    }

    #[test]
    fn windows_are_equal_and_a_partial_last_one_is_dropped() {
        let pcm = vec![0.5f32; 64_000 * 2 + 1000];
        assert_eq!(windows(&pcm, 5).len(), 2);
        assert_eq!(windows(&pcm, 1).len(), 1);
        assert!(windows(&[0.0; 100], 3).is_empty());
    }

    #[test]
    fn a_run_is_stored_stamped_and_survives_a_restart() {
        let path = temp_path("persist");
        let bench = Arc::new(Bench::load(path.clone()));
        let added = bench.enqueue(
            Arc::new(Fake { fail: None }),
            vec![("openai/whisper-base".into(), Kind::Asr)],
        );
        assert_eq!(added, 1);
        wait_idle(&bench);
        let snap = bench.snapshot();
        let runs = &snap["runs"]["openai/whisper-base"];
        assert_eq!(runs.as_array().unwrap().len(), 1);
        assert_eq!(runs[0]["speed"], 8.0);
        assert_eq!(runs[0]["latency_ms"], 497.5);
        assert_eq!(runs[0]["unit"], "x real time");
        assert_eq!(runs[0]["device"], "cpu");
        assert_eq!(runs[0]["engine_version"], env!("CARGO_PKG_VERSION"));
        assert!(runs[0]["at"].as_str().unwrap().contains('T'));
        // A new engine reads the file back.
        let again = Bench::load(path);
        assert_eq!(
            again.snapshot()["runs"]["openai/whisper-base"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn history_keeps_only_the_newest_runs_per_model() {
        let bench = Bench::load(temp_path("cap"));
        for i in 0..(KEEP_RUNS + 4) {
            bench.record(Run {
                id: "m".into(),
                kind: "asr".into(),
                speed: i as f64,
                unit: "x real time".into(),
                latency_ms: 1.0,
                load_ms: 1.0,
                samples: 3,
                device: "cpu".into(),
                at: "2026-11-12T00:00:00Z".into(),
                engine_version: "t".into(),
            });
        }
        let snap = bench.snapshot();
        let runs = snap["runs"]["m"].as_array().unwrap();
        assert_eq!(runs.len(), KEEP_RUNS);
        assert_eq!(runs[0]["speed"], 4.0, "the oldest were dropped");
        assert_eq!(runs[KEEP_RUNS - 1]["speed"], (KEEP_RUNS + 3) as f64);
    }

    #[test]
    fn a_failure_is_reported_then_cleared_by_the_next_success_and_never_stops_the_queue() {
        let bench = Arc::new(Bench::load(temp_path("fail")));
        let added = bench.enqueue(
            Arc::new(Fake { fail: Some("bad") }),
            vec![
                ("bad".into(), Kind::Translate),
                ("good".into(), Kind::Translate),
            ],
        );
        assert_eq!(added, 2);
        wait_idle(&bench);
        let snap = bench.snapshot();
        assert_eq!(snap["failed"]["bad"], "model is damaged");
        assert!(snap["runs"]["good"].is_array());
        assert!(
            snap["runs"]["bad"].is_null(),
            "a failed test records no numbers"
        );
        // The same id again with a working runner clears the failure.
        bench.enqueue(
            Arc::new(Fake { fail: None }),
            vec![("bad".into(), Kind::Translate)],
        );
        wait_idle(&bench);
        assert!(bench.snapshot()["failed"]["bad"].is_null());
    }

    #[test]
    fn a_model_already_queued_is_not_added_twice() {
        let bench = Arc::new(Bench::load(temp_path("dup")));
        let runner = Arc::new(Fake { fail: None });
        // Hold the lock-free path: queue the same id twice in one call.
        let added = bench.enqueue(
            runner,
            vec![("a".into(), Kind::Asr), ("a".into(), Kind::Asr)],
        );
        assert_eq!(added, 1);
        wait_idle(&bench);
    }

    #[test]
    fn a_damaged_file_is_an_empty_history() {
        let path = temp_path("damaged");
        std::fs::write(&path, "{ not json").unwrap();
        let bench = Bench::load(path);
        assert_eq!(bench.snapshot()["runs"], json!({}));
    }
}

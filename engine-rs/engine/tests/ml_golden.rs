//! Candle Whisper `base` against the faster-whisper goldens from
//! `node scripts/gen-engine-ml-golden.mjs`.
//!
//! Needs the model (~290 MB, downloaded once into HF_HOME), so it is ignored
//! by default. Run from the repo root with:
//!
//!   HF_HOME=engine-rs/.hf-cache cargo test --release --manifest-path engine-rs/Cargo.toml \
//!     --test ml_golden -- --ignored --nocapture
//!
//! Gate per clip: word error rate vs the oracle <= 0.10, and segment starts
//! within 0.5 s for segments that match (word Jaccard >= 0.5).

use std::path::PathBuf;
use std::time::Instant;

use serde::Deserialize;
use submeetly_engine::audio::decode_file;
use submeetly_engine::whisper::{Task, WhisperAsr};

#[derive(Deserialize)]
struct Golden {
    clips: Vec<Clip>,
}

#[derive(Deserialize)]
struct Clip {
    id: String,
    file: String,
    language: String,
    duration: f64,
    rtf: f64,
    segments: Vec<Seg>,
}

#[derive(Deserialize, Clone)]
struct Seg {
    start: f64,
    text: String,
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// Levenshtein over words, divided by the reference length.
fn wer(reference: &[String], hypothesis: &[String]) -> f64 {
    let mut prev: Vec<usize> = (0..=hypothesis.len()).collect();
    for (i, r) in reference.iter().enumerate() {
        let mut cur = vec![i + 1; hypothesis.len() + 1];
        for (j, h) in hypothesis.iter().enumerate() {
            let cost = usize::from(r != h);
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[hypothesis.len()] as f64 / reference.len().max(1) as f64
}

fn jaccard(a: &str, b: &str) -> f64 {
    let a: std::collections::HashSet<String> = words(a).into_iter().collect();
    let b: std::collections::HashSet<String> = words(b).into_iter().collect();
    let union = a.union(&b).count();
    if union == 0 {
        0.0
    } else {
        a.intersection(&b).count() as f64 / union as f64
    }
}

#[test]
#[ignore = "downloads whisper-base; run with --ignored"]
fn candle_whisper_base_matches_faster_whisper() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let golden: Golden = serde_json::from_str(
        &std::fs::read_to_string(root.join("engine-rs/golden/ml/whisper-base.json"))
            .expect("run node scripts/gen-engine-ml-golden.mjs first"),
    )
    .expect("parse golden");

    let mut asr = WhisperAsr::load("base", candle_core::Device::Cpu).expect("load whisper base");
    let mut failures = Vec::new();
    println!("clip    WER    matched  max|dt|  RTF rust  RTF python");
    for clip in &golden.clips {
        let pcm = decode_file(&root.join(&clip.file)).expect("decode clip");
        let started = Instant::now();
        let segs = asr
            .transcribe(&pcm, Some(&clip.language), Task::Transcribe)
            .expect("transcribe");
        let rtf = started.elapsed().as_secs_f64() / clip.duration;

        let reference = words(
            &clip
                .segments
                .iter()
                .map(|s| s.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
        );
        let hypothesis = words(
            &segs
                .iter()
                .map(|s| s.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
        );
        let error = wer(&reference, &hypothesis);

        let mut matched = 0;
        let mut worst: f64 = 0.0;
        for want in &clip.segments {
            let best = segs
                .iter()
                .map(|got| (jaccard(&want.text, &got.text), got))
                .max_by(|a, b| a.0.total_cmp(&b.0));
            if let Some((score, got)) = best {
                if score >= 0.5 {
                    matched += 1;
                    worst = worst.max((got.start - want.start).abs());
                }
            }
        }
        println!(
            "{:<7} {:.3}  {:>2}/{:<2}    {:.2}s    {:.3}     {:.3}",
            clip.id,
            error,
            matched,
            clip.segments.len(),
            worst,
            rtf,
            clip.rtf
        );
        if error > 0.10 {
            failures.push(format!(
                "{}: WER {error:.3} > 0.10\n  py: {}\n  rs: {}",
                clip.id,
                reference.join(" "),
                hypothesis.join(" ")
            ));
        }
        if worst > 0.5 {
            failures.push(format!(
                "{}: matched segment start off by {worst:.2}s",
                clip.id
            ));
        }
        if matched == 0 {
            failures.push(format!("{}: no segment matched", clip.id));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn wer_counts_word_edits() {
    let r = words("the cat sat on the mat");
    assert_eq!(wer(&r, &words("The cat sat on the mat.")), 0.0);
    assert!((wer(&r, &words("the cat sat on mat")) - 1.0 / 6.0).abs() < 1e-9);
    assert!((jaccard("a b", "b c") - 1.0 / 3.0).abs() < 1e-9);
}

/// No local oracle for translation (the helper's MLX path is Mac-only), so the
/// check is properties on fixed prompts: non-empty, target script, no prompt
/// leakage. Outputs are printed for the hand check.
///
///   HF_HOME=engine-rs/.hf-cache TRANSLATE_TEST_MODEL=Qwen/Qwen2.5-0.5B-Instruct \
///     cargo test --release --manifest-path engine-rs/Cargo.toml --test ml_golden \
///     translate -- --ignored --nocapture
type Case<'a> = (&'a str, &'a str, &'a str, bool, &'a dyn Fn(char) -> bool);

#[test]
#[ignore = "downloads a Qwen2.5 Instruct model; run with --ignored"]
fn qwen_translation_properties() {
    use submeetly_engine::translate::Translator;
    let repo = std::env::var("TRANSLATE_TEST_MODEL")
        .unwrap_or_else(|_| "Qwen/Qwen2.5-0.5B-Instruct".to_string());
    let mut mt = Translator::load(&repo, candle_core::Device::Cpu).expect("load translator");
    let japanese =
        |c: char| ('\u{3040}'..='\u{30ff}').contains(&c) || ('\u{4e00}'..='\u{9fff}').contains(&c);
    let cjk = |c: char| ('\u{4e00}'..='\u{9fff}').contains(&c);
    let latin = |c: char| c.is_ascii_alphabetic();
    let cases: [Case; 4] = [
        (
            "The meeting starts at nine tomorrow.",
            "en",
            "zh",
            false,
            &cjk,
        ),
        (
            "We agreed to ship the release on Friday.",
            "en",
            "ja",
            true,
            &japanese,
        ),
        ("今日はいい天気です。", "ja", "en", true, &latin),
        (
            "Guten Morgen, wie geht es Ihnen?",
            "de",
            "en",
            false,
            &latin,
        ),
    ];
    let mut failures = Vec::new();
    for (text, src, tgt, fast, script) in cases {
        let started = Instant::now();
        let out = mt.translate(text, src, tgt, fast).expect("translate");
        println!(
            "{src}->{tgt} fast={fast} {:.1}s: {text} => {out}",
            started.elapsed().as_secs_f64()
        );
        let leaked = ["translator", "Output ONLY", "<|im_", "assistant"]
            .iter()
            .any(|p| out.contains(p));
        if out.is_empty() || !out.chars().any(script) || leaked || out == text {
            failures.push(format!("{src}->{tgt}: {out:?}"));
        }
    }
    let refined = mt
        .refine("We agreed to ship on Friday.", "Kami setuju", "en", "id")
        .expect("refine");
    println!("refine en->id: {refined}");
    if refined.is_empty() || refined.contains("Final translation") {
        failures.push(format!("refine: {refined:?}"));
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

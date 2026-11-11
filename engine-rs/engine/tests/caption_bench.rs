//! Caption speed benchmark (PMM-027): the `/draft` path (Whisper, then fast translate) on
//! the same local recordings and a fixed sentence set, so model choices are compared on
//! one harness. Ignored by default: it needs the models on disk. Run from `engine-rs`:
//!
//!   HF_HUB_CACHE=<cache> WHISPER_MODEL=base TRANSLATE_MODEL=unsloth/Qwen3-1.7B-GGUF \
//!     cargo test --release --test caption_bench -- --ignored --nocapture
//!
//! Models are picked the way the engine picks them (WHISPER_MODEL, TRANSLATE_MODEL, else
//! the defaults). OPUS-MT pair models on disk serve their pairs, as in `/draft`;
//! BENCH_PAIRS=off measures the LLM alone. Output: per 4 s window ASR ms and translate
//! ms, first text / first translation after speech start, RTF, then ms per sentence and
//! the 20-sentence Indonesian meaning check (expected meaning beside the output, judged
//! by hand in `docs/roadmap/caption-speed.md`).

use std::path::PathBuf;
use std::time::Instant;

use std::sync::Arc;

use submeetly_engine::audio::{decode_file, SAMPLE_RATE};
use submeetly_engine::engine::{Ml, SavedModels};
use submeetly_engine::locations::Locations;
use submeetly_engine::models::hub_cache_dir;
use submeetly_engine::whisper::Task;

/// The island cuts capture into 4 s windows (`poni-core` `Chunker`, `WINDOW_S`).
const WINDOW_S: usize = 4;

/// (recording, spoken language, caption language): the committed CC0 clips.
const RECORDINGS: [(&str, &str, &str); 4] = [
    ("en-1", "en", "id"),
    ("id-1", "id", "en"),
    ("zh-1", "zh", "en"),
    ("ja-1", "ja", "en"),
];

/// English -> expected Indonesian meaning (written for this check, judged by hand).
const ID_CHECK: [(&str, &str); 20] = [
    (
        "Good morning, everyone. Let's start the meeting.",
        "Selamat pagi semuanya. Mari kita mulai rapatnya.",
    ),
    (
        "The weather today is sunny and warm.",
        "Cuaca hari ini cerah dan hangat.",
    ),
    (
        "We need to finish the report before Friday.",
        "Kita perlu menyelesaikan laporan sebelum hari Jumat.",
    ),
    (
        "Can you send me the updated budget by email?",
        "Bisakah Anda mengirimkan anggaran terbaru lewat email?",
    ),
    (
        "The client asked for a two-week extension.",
        "Klien meminta perpanjangan waktu dua minggu.",
    ),
    (
        "I don't think this design will work on small screens.",
        "Saya rasa desain ini tidak akan berfungsi di layar kecil.",
    ),
    (
        "Please mute your microphone when you are not speaking.",
        "Tolong matikan mikrofon Anda saat tidak berbicara.",
    ),
    (
        "Our sales grew by twelve percent last quarter.",
        "Penjualan kami naik dua belas persen pada kuartal lalu.",
    ),
    (
        "The next meeting is on Tuesday at ten o'clock.",
        "Rapat berikutnya hari Selasa pukul sepuluh.",
    ),
    (
        "Who is responsible for the safety inspection?",
        "Siapa yang bertanggung jawab atas inspeksi keselamatan?",
    ),
    (
        "The contractor will deliver the steel next month.",
        "Kontraktor akan mengirim baja bulan depan.",
    ),
    (
        "We are three days behind schedule.",
        "Kita terlambat tiga hari dari jadwal.",
    ),
    (
        "Let's move on to the next item on the agenda.",
        "Mari lanjut ke butir berikutnya dalam agenda.",
    ),
    (
        "I agree with the proposal, but the cost is too high.",
        "Saya setuju dengan usulannya, tetapi biayanya terlalu tinggi.",
    ),
    (
        "Can everyone hear me clearly?",
        "Apakah semua orang bisa mendengar saya dengan jelas?",
    ),
    (
        "The approval is still waiting for the manager's signature.",
        "Persetujuannya masih menunggu tanda tangan manajer.",
    ),
    (
        "Please share your screen so we can see the drawing.",
        "Tolong bagikan layar Anda agar kami bisa melihat gambarnya.",
    ),
    (
        "The price includes transport but not installation.",
        "Harganya termasuk transportasi tetapi tidak termasuk pemasangan.",
    ),
    (
        "We will send the minutes after this call.",
        "Kami akan mengirim notulen setelah panggilan ini.",
    ),
    (
        "Thank you all, see you next week.",
        "Terima kasih semuanya, sampai jumpa minggu depan.",
    ),
];

const ID: [&str; 8] = [
    "Selamat pagi semuanya, mari kita mulai rapatnya.",
    "Cuaca hari ini cerah dan hangat.",
    "Kita harus menyelesaikan laporan sebelum hari Jumat.",
    "Bisakah kamu mengirimkan anggaran terbaru lewat email?",
    "Klien meminta perpanjangan waktu dua minggu.",
    "Saya rasa desain ini tidak akan berfungsi di layar kecil.",
    "Tolong matikan mikrofon saat kamu tidak berbicara.",
    "Penjualan kami naik dua belas persen pada kuartal lalu.",
];
const ZH: [&str; 4] = [
    "大家早上好，我们开始开会吧。",
    "我们需要在星期五之前完成报告。",
    "客户要求延期两周。",
    "上个季度我们的销售额增长了百分之十二。",
];
const JA: [&str; 4] = [
    "皆さん、おはようございます。会議を始めましょう。",
    "金曜日までに報告書を仕上げる必要があります。",
    "クライアントは二週間の延長を求めました。",
    "前四半期の売上は十二パーセント伸びました。",
];

fn ms_since(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn pct(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() as f64 - 1.0) * p).round() as usize]
}

#[test]
#[ignore = "needs the ASR and translation models on disk; run with --ignored"]
fn caption_bench() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    // No locations file: every model is read from the hub cache.
    let locations = Locations::load(PathBuf::new(), hub_cache_dir());
    let ml = Ml::from_env("cpu", &SavedModels::default(), Arc::new(locations));
    let mt_id = ml.translate_id().expect("translation is on");
    let pairs = std::env::var("BENCH_PAIRS").as_deref() != Ok("off");
    // `/draft` fast path; BENCH_PAIRS=off measures the LLM alone even with OPUS-MT on disk.
    let translate = |text: &str, src: &str, tgt: &str| -> String {
        if pairs {
            ml.translate_fast(text, src, tgt)
        } else {
            ml.with_translator(|mt| mt.translate(text, src, tgt, true))
        }
        .expect("translate")
    };
    let asr = |pcm: &[f32], src: &str| ml.text(pcm, Some(src), Task::Transcribe).expect("asr");

    let t = Instant::now();
    ml.with_asr(|_| Ok(())).expect("load ASR");
    println!("asr {} load {:.0} ms", ml.asr_id(), ms_since(t));
    let t = Instant::now();
    ml.with_translator(|_| Ok(())).expect("load translation");
    println!(
        "mt {mt_id} load {:.0} ms (OPUS-MT pairs: {pairs})",
        ms_since(t)
    );
    // Warm-up, not counted: first calls pay one-off allocation (and OPUS-MT loads).
    for (src, tgt) in [
        ("en", "id"),
        ("id", "en"),
        ("zh", "en"),
        ("ja", "en"),
        ("en", "zh"),
    ] {
        let t = Instant::now();
        translate("Hello.", src, tgt);
        println!("warm-up {src}-{tgt} {:.0} ms", ms_since(t));
    }

    println!("\n## Recordings ({WINDOW_S} s windows, as the island posts them)");
    let window = WINDOW_S * SAMPLE_RATE;
    for (clip, src, tgt) in RECORDINGS {
        let pcm = decode_file(&root.join(format!("test/samples/cc0/{clip}.mp3"))).expect("decode");
        let (mut asr_total, mut mt_ms) = (0.0, Vec::new());
        let (mut first_text, mut first_translation) = (None, None);
        for (k, chunk) in pcm.chunks(window).enumerate() {
            if chunk.len() < 1600 {
                continue; // `/draft` answers empty under 1600 samples
            }
            let t = Instant::now();
            let source = asr(chunk, src);
            let asr_ms = ms_since(t);
            asr_total += asr_ms;
            let ready = ((k * window + chunk.len()) * 1000 / SAMPLE_RATE) as f64;
            if source.trim().is_empty() {
                println!("  {clip} w{k} asr {asr_ms:5.0} ms | (silence)");
                continue;
            }
            let t = Instant::now();
            let translation = translate(&source, src, tgt);
            let took = ms_since(t);
            mt_ms.push(took);
            first_text.get_or_insert(ready + asr_ms);
            first_translation.get_or_insert(ready + asr_ms + took);
            println!(
                "  {clip} w{k} asr {asr_ms:5.0} ms mt {took:5.0} ms | {source} => {translation}"
            );
        }
        let audio_ms = pcm.len() as f64 * 1000.0 / SAMPLE_RATE as f64;
        mt_ms.sort_by(f64::total_cmp);
        println!(
            "{clip} {src}->{tgt}: first text {:.0} ms, first translation {:.0} ms, ASR RTF {:.2}, translate p50 {:.0} ms",
            first_text.unwrap_or(f64::NAN),
            first_translation.unwrap_or(f64::NAN),
            asr_total / audio_ms,
            if mt_ms.is_empty() { f64::NAN } else { pct(&mt_ms, 0.5) },
        );
    }

    println!("\n## Sentences (fast translate, ms each)");
    let en: Vec<&str> = ID_CHECK.iter().map(|(en, _)| *en).collect();
    let sets: [(&str, &str, &[&str]); 5] = [
        ("en", "id", &en),
        ("id", "en", &ID),
        ("zh", "en", &ZH),
        ("ja", "en", &JA),
        ("en", "zh", &en[..8]),
    ];
    for (src, tgt, lines) in sets {
        let mut ms = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            let t = Instant::now();
            let out = translate(line, src, tgt);
            ms.push(ms_since(t));
            let expected = if src == "en" && tgt == "id" {
                ID_CHECK[i].1
            } else {
                ""
            };
            println!(
                "  [{src}-{tgt}] {:5.0} ms | {line} => {out} || expected: {expected}",
                ms[i]
            );
        }
        ms.sort_by(f64::total_cmp);
        println!(
            "{mt_id} {src}-{tgt} n={} p50={:.0} p95={:.0} ms",
            ms.len(),
            pct(&ms, 0.5),
            pct(&ms, 0.95)
        );
    }
}

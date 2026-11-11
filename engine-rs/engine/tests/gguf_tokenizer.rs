//! The tokenizer rebuilt from a Qwen3 GGUF must encode exactly like the model's own
//! tokenizer.json. Ignored: needs both files. Run from `engine-rs`:
//!
//!   GGUF=<Qwen3-*-Q4_K_M.gguf> TOKENIZER_JSON=<Qwen/Qwen3-* tokenizer.json> \
//!     cargo test --release --test gguf_tokenizer -- --ignored --nocapture

use candle_core::quantized::gguf_file::Content;
use submeetly_engine::translate::{chat_prompt, gguf_tokenizer};
use tokenizers::Tokenizer;

#[test]
#[ignore = "needs a Qwen3 GGUF and its tokenizer.json; run with --ignored"]
fn gguf_tokenizer_matches_tokenizer_json() {
    let gguf = std::env::var("GGUF").expect("GGUF");
    let reference = std::env::var("TOKENIZER_JSON").expect("TOKENIZER_JSON");
    let mut file = std::fs::File::open(gguf).expect("open gguf");
    let ours = gguf_tokenizer(&Content::read(&mut file).expect("read gguf")).expect("build");
    let reference = Tokenizer::from_file(reference).expect("tokenizer.json");
    let texts = [
        chat_prompt("You translate English subtitles into Indonesian.", "Hello."),
        "Good morning, everyone. Let's start the meeting.".into(),
        "Penjualan kami naik dua belas persen pada kuartal lalu.".into(),
        "上个季度我们的销售额增长了百分之十二。".into(),
        "前四半期の売上は十二パーセント伸びました。".into(),
        "  two  spaces\n\nnew lines 12345 é ü 🎉 <think>\n\n</think>\n\n".into(),
    ];
    let mut bad = 0;
    for text in texts {
        let a = ours.encode(text.as_str(), false).expect("ours");
        let b = reference.encode(text.as_str(), false).expect("reference");
        if a.get_ids() != b.get_ids() {
            bad += 1;
            println!(
                "DIFF {text:?}\n ours {:?}\n ref  {:?}",
                a.get_ids(),
                b.get_ids()
            );
        }
        // Decoding must give the text back too (the answer is read through it).
        assert_eq!(ours.decode(a.get_ids(), false).expect("decode"), text);
    }
    assert_eq!(bad, 0);
}

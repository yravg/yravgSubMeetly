//! Hub downloads of Xet-backed files (every `model.safetensors` on the Hub).
//! Network test is `#[ignore]`: run with `cargo test -p submeetly-engine --test hub_download -- --ignored`.

use submeetly_engine::ml::hub_file;

#[test]
#[ignore = "network: downloads a Xet-backed 151 MB file from huggingface.co into a temp cache"]
fn xet_backed_file_downloads_from_main() {
    let cache = std::env::temp_dir().join("sm-hub-xet-test");
    std::env::set_var("HF_HUB_CACHE", &cache);
    let path = hub_file("openai/whisper-tiny", None, "model.safetensors")
        .unwrap_or_else(|e| panic!("{e:#}"));
    assert_eq!(std::fs::metadata(path).unwrap().len(), 151_061_672);
}

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

/// A second request for a blob that is still downloading used to die after 10 s
/// with hf-hub's `CacheLockTimeout`; whisper.rs then reported the PR ref's
/// "Entry not found" instead. It must wait and return the same cached file.
#[test]
#[ignore = "network: downloads a Xet-backed 151 MB file from huggingface.co into a temp cache"]
fn second_request_waits_for_the_first_download() {
    let cache = std::env::temp_dir().join("sm-hub-xet-lock-test");
    std::env::set_var("HF_HUB_CACHE", &cache);
    let first = std::thread::spawn(|| hub_file("openai/whisper-tiny", None, "model.safetensors"));
    std::thread::sleep(std::time::Duration::from_secs(5));
    let second = hub_file("openai/whisper-tiny", None, "model.safetensors")
        .unwrap_or_else(|e| panic!("{e:#}"));
    assert_eq!(first.join().unwrap().unwrap(), second);
}

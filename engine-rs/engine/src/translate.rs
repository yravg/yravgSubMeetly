//! Translation LLM on candle: Qwen2.5 Instruct (safetensors) or Qwen3 (q4_k GGUF), greedy,
//! with the exact prompts of `translate_text` / `refine_text` in native/server.py.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use candle_core::quantized::gguf_file::{Content, Value as Gv};
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::quantized_qwen3::ModelWeights as Qwen3Q;
use candle_transformers::models::qwen2::{Config, ModelForCausalLM};
use hf_hub::progress::Progress;
use serde_json::{json, Map, Value};
use tokenizers::Tokenizer;

/// The one file a `*-GGUF` repo serves the engine (q4_k_m), or `None` for safetensors repos.
pub fn gguf_file(repo_id: &str) -> Option<String> {
    let name = repo_id.rsplit('/').next()?;
    name.strip_suffix("-GGUF")
        .map(|base| format!("{base}-Q4_K_M.gguf"))
}

/// Download (or find cached) every file `Translator::load` reads for `repo_id`.
pub fn fetch_any(
    cache: &Path,
    repo_id: &str,
    progress: Option<&Progress>,
    finished: &mut dyn FnMut(&Path),
) -> Result<()> {
    if let Some(file) = gguf_file(repo_id) {
        let path = crate::ml::hub_file_with(cache, repo_id, None, &file, progress.cloned())?;
        finished(&path);
    } else {
        fetch_files(cache, repo_id, progress, finished)?;
    }
    Ok(())
}

/// The cached files `Translator::load` reads; weights may be sharded.
pub struct QwenFiles {
    pub config: PathBuf,
    pub tokenizer: PathBuf,
    pub weights: Vec<PathBuf>,
}

/// Download (or find cached) the files of a Qwen repo; `finished` sees each one.
pub fn fetch_files(
    cache: &Path,
    repo_id: &str,
    progress: Option<&Progress>,
    finished: &mut dyn FnMut(&Path),
) -> Result<QwenFiles> {
    let mut fetch = |name: &str| -> Result<PathBuf> {
        let path = crate::ml::hub_file_with(cache, repo_id, None, name, progress.cloned())?;
        finished(&path);
        Ok(path)
    };
    let config = fetch("config.json")?;
    let tokenizer = fetch("tokenizer.json")?;
    // Only a 404 means "not sharded"; a network error must not pick the single-file path.
    let weights = match fetch("model.safetensors.index.json") {
        Ok(index) => {
            let index: Value = serde_json::from_slice(&std::fs::read(index)?)?;
            let mut names: Vec<String> = index["weight_map"]
                .as_object()
                .ok_or_else(|| anyhow!("bad safetensors index"))?
                .values()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect();
            names.sort();
            names.dedup();
            names.iter().map(|n| fetch(n)).collect::<Result<Vec<_>>>()?
        }
        Err(error) if crate::ml::is_not_found(&error) => vec![fetch("model.safetensors")?],
        Err(error) => return Err(error),
    };
    Ok(QwenFiles {
        config,
        tokenizer,
        weights,
    })
}

/// Measured on the caption bench (docs/roadmap/caption-speed.md): faster than Qwen2.5-0.5B
/// f32 on CPU and 16/20 vs 4/20 on the Indonesian meaning check.
pub const DEFAULT_TRANSLATE_MODEL: &str = "unsloth/Qwen3-1.7B-GGUF";

const LANG_NAMES: [(&str, &str); 20] = [
    ("en", "English"),
    ("zh", "Simplified Chinese"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("de", "German"),
    ("fr", "French"),
    ("es", "Spanish"),
    ("ru", "Russian"),
    ("it", "Italian"),
    ("pt", "Portuguese"),
    ("nl", "Dutch"),
    ("pl", "Polish"),
    ("tr", "Turkish"),
    ("ar", "Arabic"),
    ("hi", "Hindi"),
    ("th", "Thai"),
    ("vi", "Vietnamese"),
    ("id", "Indonesian"),
    ("uk", "Ukrainian"),
    ("auto", "the source language"),
];

fn lang_name(code: &str) -> &str {
    LANG_NAMES
        .iter()
        .find(|(c, _)| *c == code)
        .map_or(code, |(_, name)| name)
}

/// `_norm_lang`: lower-case, drop region, known codes only.
pub fn norm_lang(value: Option<&str>, fallback: &str) -> String {
    let code = value.unwrap_or("").trim().to_lowercase().replace('_', "-");
    if code.is_empty() {
        return fallback.to_string();
    }
    let base = code.split('-').next().unwrap_or("");
    for candidate in [code.as_str(), base] {
        if LANG_NAMES.iter().any(|(c, _)| *c == candidate) {
            return candidate.to_string();
        }
    }
    fallback.to_string()
}

/// `_clip_fast_text`: at most 120 chars, cut at the last space.
pub fn clip_fast_text(text: &str) -> String {
    let text = text.trim();
    let limit = 120;
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let cut: String = text.chars().take(limit).collect();
    let cut = match cut.rfind(' ') {
        Some(i) => cut[..i].trim().to_string(),
        None => cut.trim().to_string(),
    };
    if cut.is_empty() {
        text.chars()
            .take(limit)
            .collect::<String>()
            .trim()
            .to_string()
    } else {
        cut
    }
}

/// The sentence that pins the output language. Qwen2.5-0.5B ignores a bare "X → Y" and
/// answers in English for a non-English source, so say what the answer must not be.
fn answer_in(src: &str, tgt: &str) -> String {
    let (to, from) = (lang_name(tgt), lang_name(src));
    let mut avoid = Vec::new();
    if tgt != "en" {
        avoid.push("English");
    }
    if src != "auto" && src != "en" && src != tgt {
        avoid.push(from);
    }
    if avoid.is_empty() {
        format!("Always answer in {to}.")
    } else {
        format!("Always answer in {to}, never in {}.", avoid.join(" or "))
    }
}

/// (system, user, max_tokens) for `/translate`.
pub fn translate_prompt(text: &str, src: &str, tgt: &str, fast: bool) -> (String, String, usize) {
    let answer = answer_in(src, tgt);
    if fast {
        (
            format!(
                "You translate {} subtitles into {}. {answer} Output ONLY the {} translation, concise.",
                lang_name(src),
                lang_name(tgt),
                lang_name(tgt)
            ),
            clip_fast_text(text),
            24,
        )
    } else {
        (
            format!(
                "You are a professional subtitle translator. Translate the user's text from {} to {}. {answer} Keep it natural and concise, preserve meaning and tone. \
                 Output ONLY the translation — no notes, no quotes, no explanations.",
                lang_name(src),
                lang_name(tgt)
            ),
            text.to_string(),
            256,
        )
    }
}

/// (system, user) for `/translate_refine`.
pub fn refine_prompt(text: &str, draft: &str, src: &str, tgt: &str) -> (String, String) {
    (
        format!(
            "You are a professional live subtitle translator (like smart-glasses captioning). \
             The speaker finished an utterance in {}. A draft translation was shown while they were \
             still speaking. Now produce the final, semantically accurate translation in {}. Fix \
             incomplete phrasing, wrong guesses, and word order. Keep it concise and natural. Output \
             ONLY the corrected translation — no notes.",
            lang_name(src),
            lang_name(tgt)
        ),
        format!(
            "Complete source:\n{text}\n\nDraft translation (may be incomplete or wrong):\n{}\n\nFinal translation:",
            if draft.is_empty() { "(none)" } else { draft }
        ),
    )
}

/// Qwen2.5 chat template for one system + one user turn, generation prompt on.
pub fn chat_prompt(system: &str, user: &str) -> String {
    format!(
        "<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n"
    )
}

/// Qwen2.5 chat template for a system prompt and a conversation (`user` / `assistant` turns).
pub fn chat_prompt_turns(system: &str, turns: &[(String, String)]) -> String {
    let mut prompt = format!("<|im_start|>system\n{system}<|im_end|>\n");
    for (role, content) in turns {
        prompt.push_str(&format!("<|im_start|>{role}\n{content}<|im_end|>\n"));
    }
    prompt.push_str("<|im_start|>assistant\n");
    prompt
}

/// The part of `decoded` not yet sent. A token can end mid-character; that tail is held
/// back (it decodes to U+FFFD) until the next token completes it.
pub fn fresh_piece(decoded: &str, sent: usize) -> &str {
    let ready = decoded.strip_suffix('\u{FFFD}').unwrap_or(decoded);
    ready.get(sent..).unwrap_or("")
}

/// First line of the trimmed output, like the oracle.
pub fn first_line(out: &str) -> String {
    out.trim()
        .split('\n')
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Qwen2/Qwen3 pre-tokenizer split (the `Split` regex of their tokenizer.json).
const QWEN_SPLIT: &str = r"(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+";

fn gguf_strings<'a>(content: &'a Content, key: &str) -> Result<Vec<&'a str>> {
    let Some(value) = content.metadata.get(key) else {
        bail!("gguf has no {key}");
    };
    value
        .to_vec()?
        .iter()
        .map(|v| {
            v.to_string()
                .map(String::as_str)
                .map_err(|e| anyhow!("{e}"))
        })
        .collect()
}

/// The tokenizer.json equivalent of a GGUF's `tokenizer.ggml.*` (gpt2 BPE, Qwen split):
/// the GGUF repos ship no tokenizer.json, so it is rebuilt the way llama.cpp reads it.
pub fn gguf_tokenizer(content: &Content) -> Result<Tokenizer> {
    let model = content
        .metadata
        .get("tokenizer.ggml.model")
        .and_then(|v| v.to_string().ok())
        .map(String::as_str);
    if model != Some("gpt2") {
        bail!("unsupported gguf tokenizer {model:?}");
    }
    let tokens = gguf_strings(content, "tokenizer.ggml.tokens")?;
    let merges = gguf_strings(content, "tokenizer.ggml.merges")?;
    let types: Vec<i32> = match content.metadata.get("tokenizer.ggml.token_type") {
        Some(Gv::Array(values)) => values.iter().map(|v| v.to_i32().unwrap_or(1)).collect(),
        _ => vec![1; tokens.len()],
    };
    let vocab: Map<String, Value> = tokens
        .iter()
        .enumerate()
        .map(|(id, t)| (t.to_string(), json!(id)))
        .collect();
    // Control (3) and user-defined (4) tokens are matched whole, never split.
    let added: Vec<Value> = tokens
        .iter()
        .enumerate()
        .filter(|(id, _)| matches!(types.get(*id), Some(3 | 4)))
        .map(|(id, t)| {
            json!({"id": id, "content": t, "single_word": false, "lstrip": false,
                   "rstrip": false, "normalized": false, "special": types[id] == 3})
        })
        .collect();
    let byte_level = json!({"type": "ByteLevel", "add_prefix_space": false,
                            "trim_offsets": false, "use_regex": false});
    let spec = json!({
        "version": "1.0",
        "added_tokens": added,
        "normalizer": {"type": "NFC"},
        "pre_tokenizer": {"type": "Sequence", "pretokenizers": [
            {"type": "Split", "pattern": {"Regex": QWEN_SPLIT}, "behavior": "Isolated", "invert": false},
            byte_level,
        ]},
        "post_processor": null,
        "decoder": byte_level,
        "model": {"type": "BPE", "dropout": null, "unk_token": null,
                  "continuing_subword_prefix": "", "end_of_word_suffix": "",
                  "fuse_unk": false, "byte_fallback": false, "ignore_merges": false,
                  "vocab": vocab, "merges": merges},
    });
    spec.to_string()
        .parse()
        .map_err(|e| anyhow!("gguf tokenizer: {e}"))
}

enum Model {
    Qwen2(ModelForCausalLM),
    /// Qwen3 answers after an empty think block (its non-thinking mode).
    Qwen3Q(Qwen3Q),
}

pub struct Translator {
    pub repo_id: String,
    model: Model,
    tokenizer: Tokenizer,
    device: Device,
    stops: Vec<u32>,
}

fn stop_ids(tokenizer: &Tokenizer) -> Vec<u32> {
    ["<|im_end|>", "<|endoftext|>"]
        .iter()
        .filter_map(|t| tokenizer.token_to_id(t))
        .collect()
}

impl Translator {
    pub fn load(repo_id: &str, device: Device, cache: &Path) -> Result<Self> {
        if let Some(file) = gguf_file(repo_id) {
            let path = crate::ml::hub_file_with(cache, repo_id, None, &file, None)?;
            let mut reader = std::fs::File::open(&path)?;
            let content = Content::read(&mut reader).map_err(|e| anyhow!("{e}"))?;
            let tokenizer = gguf_tokenizer(&content)?;
            let model = Qwen3Q::from_gguf(content, &mut reader, &device)?;
            return Ok(Self {
                repo_id: repo_id.to_string(),
                model: Model::Qwen3Q(model),
                stops: stop_ids(&tokenizer),
                tokenizer,
                device,
            });
        }
        let files = fetch_files(cache, repo_id, None, &mut |_| {})?;
        let config: Config =
            serde_json::from_slice(&std::fs::read(files.config)?).context("qwen config")?;
        let tokenizer = Tokenizer::from_file(files.tokenizer).map_err(|e| anyhow!("{e}"))?;
        let weights = files.weights;
        let dtype = if device.is_cpu() {
            DType::F32
        } else {
            DType::BF16
        };
        // SAFETY: the hub cache files are not modified while mapped.
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&weights, dtype, &device)? };
        let model = ModelForCausalLM::new(&config, vb)?;
        Ok(Self {
            repo_id: repo_id.to_string(),
            model: Model::Qwen2(model),
            stops: stop_ids(&tokenizer),
            tokenizer,
            device,
        })
    }

    /// Greedy generation (MLX `generate` default is temperature 0).
    pub fn generate(&mut self, system: &str, user: &str, max_tokens: usize) -> Result<String> {
        let mut text = String::new();
        self.run(&chat_prompt(system, user), max_tokens, &mut |decoded| {
            text = decoded.to_string();
            true
        })?;
        Ok(text)
    }

    /// `translate`, also counting the tokens generated (for the speed test, `bench.rs`).
    pub fn translate_counted(
        &mut self,
        text: &str,
        src: &str,
        tgt: &str,
        fast: bool,
    ) -> Result<(String, usize)> {
        let (system, user, max_tokens) = translate_prompt(text, src, tgt, fast);
        let mut answer = String::new();
        let mut tokens = 0usize;
        self.run(&chat_prompt(&system, &user), max_tokens, &mut |decoded| {
            answer = decoded.to_string();
            tokens += 1;
            true
        })?;
        Ok((first_line(&answer), tokens))
    }

    /// Greedy chat answer, piece by piece. `on_piece` returns false to stop (client gone).
    pub fn chat_stream(
        &mut self,
        system: &str,
        turns: &[(String, String)],
        max_tokens: usize,
        on_piece: &mut dyn FnMut(&str) -> bool,
    ) -> Result<()> {
        let mut sent = 0;
        self.run(
            &chat_prompt_turns(system, turns),
            max_tokens,
            &mut |decoded| {
                let piece = fresh_piece(decoded, sent);
                if piece.is_empty() {
                    return true;
                }
                sent += piece.len();
                on_piece(piece)
            },
        )
    }

    /// Generates until a stop token, `max_tokens`, or `seen` returns false; `seen` gets the
    /// whole answer decoded so far after each token.
    fn run(
        &mut self,
        prompt: &str,
        max_tokens: usize,
        seen: &mut dyn FnMut(&str) -> bool,
    ) -> Result<()> {
        let prompt = match self.model {
            Model::Qwen2(_) => prompt.to_string(),
            Model::Qwen3Q(_) => format!("{prompt}<think>\n\n</think>\n\n"),
        };
        let ids = self
            .tokenizer
            .encode(prompt, false)
            .map_err(|e| anyhow!("{e}"))?
            .get_ids()
            .to_vec();
        match &mut self.model {
            Model::Qwen2(m) => m.clear_kv_cache(),
            Model::Qwen3Q(m) => m.clear_kv_cache(),
        }
        let mut out: Vec<u32> = Vec::new();
        let mut input = ids.clone();
        let mut offset = 0;
        for _ in 0..max_tokens {
            let tensor = Tensor::new(input.as_slice(), &self.device)?.unsqueeze(0)?;
            let logits = match &mut self.model {
                Model::Qwen2(m) => m.forward(&tensor, offset)?,
                Model::Qwen3Q(m) => m.forward(&tensor, offset)?,
            };
            // (1, 1, vocab) for Qwen2, (1, vocab) for quantized Qwen3.
            let logits = logits.flatten_all()?.to_dtype(DType::F32)?;
            let next = logits.argmax(0)?.to_scalar::<u32>()?;
            offset += input.len();
            if self.stops.contains(&next) {
                break;
            }
            out.push(next);
            input = vec![next];
            let decoded = self
                .tokenizer
                .decode(&out, true)
                .map_err(|e| anyhow!("{e}"))?;
            if !seen(&decoded) {
                return Ok(());
            }
        }
        Ok(())
    }

    pub fn translate(&mut self, text: &str, src: &str, tgt: &str, fast: bool) -> Result<String> {
        let (system, user, max_tokens) = translate_prompt(text, src, tgt, fast);
        Ok(first_line(&self.generate(&system, &user, max_tokens)?))
    }

    pub fn refine(&mut self, text: &str, draft: &str, src: &str, tgt: &str) -> Result<String> {
        let (system, user) = refine_prompt(text, draft, src, tgt);
        Ok(first_line(&self.generate(&system, &user, 256)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gguf_repos_name_their_q4_k_m_file() {
        assert_eq!(
            gguf_file("unsloth/Qwen3-1.7B-GGUF").as_deref(),
            Some("Qwen3-1.7B-Q4_K_M.gguf")
        );
        assert_eq!(gguf_file("Qwen/Qwen2.5-0.5B-Instruct"), None);
    }

    #[test]
    fn prompts_match_the_oracle_text() {
        assert_eq!(norm_lang(Some("en-US"), "en"), "en");
        assert_eq!(norm_lang(Some("ZH_hans"), "en"), "zh");
        assert_eq!(norm_lang(Some("xx"), "auto"), "auto");
        assert_eq!(norm_lang(None, "en"), "en");
        let (system, user, max) = translate_prompt("hello", "en", "ja", true);
        assert_eq!(
            system,
            "You translate English subtitles into Japanese. Always answer in Japanese, never in English. Output ONLY the Japanese translation, concise."
        );
        assert_eq!((user.as_str(), max), ("hello", 24));
        let (system, _, max) = translate_prompt("hi", "auto", "id", false);
        assert!(system.starts_with(
            "You are a professional subtitle translator. Translate the user's text from the source language to Indonesian. Always answer in Indonesian, never in English. Keep it natural"
        ));
        assert_eq!(max, 256);
        let (_, user) = refine_prompt("full", "", "en", "de");
        assert_eq!(
            user,
            "Complete source:\nfull\n\nDraft translation (may be incomplete or wrong):\n(none)\n\nFinal translation:"
        );
        let long = "word ".repeat(40);
        let clipped = clip_fast_text(&long);
        assert!(clipped.len() <= 120 && clipped.ends_with("word"));
        assert_eq!(first_line("  Halo dunia\nnote: x "), "Halo dunia");
    }

    #[test]
    fn a_chat_prompt_keeps_the_turns_in_order_and_ends_open_for_the_answer() {
        let turns = vec![
            ("user".to_string(), "Hi".to_string()),
            ("assistant".to_string(), "Hello".to_string()),
            ("user".to_string(), "Open actions?".to_string()),
        ];
        assert_eq!(
            chat_prompt_turns("You are Tide.", &turns),
            "<|im_start|>system\nYou are Tide.<|im_end|>\n<|im_start|>user\nHi<|im_end|>\n\
             <|im_start|>assistant\nHello<|im_end|>\n<|im_start|>user\nOpen actions?<|im_end|>\n\
             <|im_start|>assistant\n"
        );
    }

    #[test]
    fn a_half_decoded_character_waits_for_its_last_byte() {
        assert_eq!(fresh_piece("You own 4", 0), "You own 4");
        assert_eq!(fresh_piece("You own 4 open", 9), " open");
        // "é" cut after its first byte decodes to U+FFFD: nothing new yet.
        assert_eq!(fresh_piece("caf\u{FFFD}", 3), "");
        assert_eq!(fresh_piece("café", 3), "é");
        assert_eq!(fresh_piece("abc", 9), "");
    }

    #[test]
    fn every_prompt_names_the_target_language_and_forbids_the_usual_wrong_answer() {
        let names = [
            ("id", "Indonesian"),
            ("zh", "Simplified Chinese"),
            ("ja", "Japanese"),
            ("ko", "Korean"),
            ("de", "German"),
            ("fr", "French"),
            ("es", "Spanish"),
            ("ar", "Arabic"),
            ("ru", "Russian"),
            ("th", "Thai"),
            ("vi", "Vietnamese"),
            ("nl", "Dutch"),
        ];
        for (code, name) in names {
            assert_eq!(norm_lang(Some(code), "en"), code);
            for fast in [true, false] {
                // German speech to `code`: the answer must not fall back to English.
                let (system, _, _) = translate_prompt("Hallo", "de", code, fast);
                let wants = if code == "de" {
                    format!("Always answer in {name}, never in English.")
                } else {
                    format!("Always answer in {name}, never in English or German.")
                };
                assert!(system.contains(&wants), "{code} fast={fast}: {system}");
                assert!(!system.contains('\n') && !system.contains("  "), "{system}");
            }
        }
        // English target: nothing forbids English.
        let (system, _, _) = translate_prompt("Hallo", "de", "en", true);
        assert!(
            system.contains("Always answer in English, never in German."),
            "{system}"
        );
        let (system, _, _) = translate_prompt("hi", "auto", "en", true);
        assert!(system.contains("Always answer in English."), "{system}");
    }
}

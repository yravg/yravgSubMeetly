//! Fast translation tier: Helsinki-NLP OPUS-MT (Marian) per language pair, on candle.
//! The repos ship `pytorch_model.bin`, SentencePiece `source.spm` and a `vocab.json`;
//! no `tokenizer.json`, so the SentencePiece pieces are read here and fed to a
//! `tokenizers` Unigram model (what HF's converter does offline, done at load instead).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::marian::{Config, MTModel};
use hf_hub::progress::Progress;
use serde_json::Value;
use tokenizers::models::unigram::Unigram;
use tokenizers::normalizers::unicode::NFKC;
use tokenizers::pre_tokenizers::metaspace::{Metaspace, PrependScheme};
use tokenizers::Tokenizer;

/// Files a Marian repo needs, in the order they are fetched.
pub const FILES: [&str; 4] = [
    "config.json",
    "source.spm",
    "vocab.json",
    "model.safetensors",
];

/// The repos' `pytorch_model.bin` is the legacy (non-zip) pickle candle cannot read; their
/// safetensors copy lives only in the Hub conversion bot's pull request.
const WEIGHTS_REF: [(&str, &str); 5] = [
    ("Helsinki-NLP/opus-mt-en-id", "refs/pr/1"),
    ("Helsinki-NLP/opus-mt-id-en", "refs/pr/1"),
    ("Helsinki-NLP/opus-mt-en-zh", "refs/pr/6"),
    ("Helsinki-NLP/opus-mt-zh-en", "refs/pr/6"),
    ("Helsinki-NLP/opus-mt-ja-en", "refs/pr/2"),
];

fn revision_of(repo_id: &str, name: &str) -> Option<&'static str> {
    WEIGHTS_REF
        .iter()
        .find(|(repo, _)| name == "model.safetensors" && *repo == repo_id)
        .map(|(_, rev)| *rev)
}

/// `(src, tgt, repo, target token)`: OPUS-MT pairs the engine offers. The target token is
/// the `>>lang<<` prefix multi-target models need (en-zh writes several Chinese scripts).
pub const PAIRS: [(&str, &str, &str, Option<&str>); 5] = [
    ("en", "id", "Helsinki-NLP/opus-mt-en-id", None),
    ("id", "en", "Helsinki-NLP/opus-mt-id-en", None),
    (
        "en",
        "zh",
        "Helsinki-NLP/opus-mt-en-zh",
        Some(">>cmn_Hans<<"),
    ),
    ("zh", "en", "Helsinki-NLP/opus-mt-zh-en", None),
    ("ja", "en", "Helsinki-NLP/opus-mt-ja-en", None),
];

/// The OPUS-MT repo for `src` -> `tgt`, if one is offered.
pub fn pair_repo(src: &str, tgt: &str) -> Option<&'static str> {
    PAIRS
        .iter()
        .find(|(s, t, ..)| *s == src && *t == tgt)
        .map(|(.., repo, _)| *repo)
}

pub fn fetch_files(
    cache: &Path,
    repo_id: &str,
    progress: Option<&Progress>,
    finished: &mut dyn FnMut(&Path),
) -> Result<Vec<PathBuf>> {
    FILES
        .iter()
        .map(|name| {
            let revision = revision_of(repo_id, name);
            let path = crate::ml::hub_file_with(cache, repo_id, revision, name, progress.cloned())?;
            finished(&path);
            Ok(path)
        })
        .collect()
}

/// `(piece, score, type)` of every SentencePiece in a `.spm` (protobuf `ModelProto.pieces`).
pub fn spm_pieces(bytes: &[u8]) -> Result<Vec<(String, f32, u64)>> {
    let mut pieces = Vec::new();
    let mut r = Proto(bytes);
    while let Some((field, wire)) = r.key()? {
        if field == 1 && wire == 2 {
            let mut p = Proto(r.bytes()?);
            let (mut piece, mut score, mut kind) = (String::new(), 0f32, 1u64);
            while let Some((f, w)) = p.key()? {
                match (f, w) {
                    (1, 2) => piece = String::from_utf8(p.bytes()?.to_vec())?,
                    (2, 5) => score = f32::from_le_bytes(p.take(4)?.try_into()?),
                    (3, 0) => kind = p.varint()?,
                    _ => p.skip(w)?,
                }
            }
            pieces.push((piece, score, kind));
        } else {
            r.skip(wire)?;
        }
    }
    if pieces.is_empty() {
        bail!("no pieces in sentencepiece model");
    }
    Ok(pieces)
}

/// Minimal protobuf reader: varints, length-delimited, fixed 32/64.
struct Proto<'a>(&'a [u8]);

impl<'a> Proto<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.0.len() < n {
            bail!("truncated sentencepiece model");
        }
        let (head, rest) = self.0.split_at(n);
        self.0 = rest;
        Ok(head)
    }
    fn varint(&mut self) -> Result<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = self.take(1)?[0];
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        bail!("bad varint")
    }
    fn key(&mut self) -> Result<Option<(u64, u64)>> {
        if self.0.is_empty() {
            return Ok(None);
        }
        let key = self.varint()?;
        Ok(Some((key >> 3, key & 7)))
    }
    fn bytes(&mut self) -> Result<&'a [u8]> {
        let n = self.varint()? as usize;
        self.take(n)
    }
    fn skip(&mut self, wire: u64) -> Result<()> {
        match wire {
            0 => drop(self.varint()?),
            1 => drop(self.take(8)?),
            2 => drop(self.bytes()?),
            5 => drop(self.take(4)?),
            _ => bail!("unsupported protobuf wire type {wire}"),
        }
        Ok(())
    }
}

/// SentencePiece Unigram segmenter for `source.spm` (pieces only; ids come from vocab.json).
fn source_tokenizer(spm: &Path) -> Result<Tokenizer> {
    let pieces = spm_pieces(&std::fs::read(spm)?)?;
    let unk = pieces.iter().position(|(.., kind)| *kind == 2);
    let vocab = pieces
        .into_iter()
        .map(|(piece, score, _)| (piece, f64::from(score)))
        .collect();
    let mut tokenizer =
        Tokenizer::new(Unigram::from(vocab, unk, false).map_err(|e| anyhow!("{e}"))?);
    tokenizer.with_normalizer(Some(NFKC));
    tokenizer.with_pre_tokenizer(Some(Metaspace::new('▁', PrependScheme::Always, true)));
    Ok(tokenizer)
}

pub struct MarianMt {
    model: MTModel,
    config: Config,
    tokenizer: Tokenizer,
    vocab: HashMap<String, u32>,
    words: Vec<String>,
    target_token: Option<u32>,
    unk: u32,
    device: Device,
}

impl MarianMt {
    pub fn load(repo_id: &str, device: Device, cache: &Path) -> Result<Self> {
        let files = fetch_files(cache, repo_id, None, &mut |_| {})?;
        let mut config: Value = serde_json::from_slice(&std::fs::read(&files[0])?)?;
        // Older exports (opus-mt-en-zh) omit this; their embeddings are shared.
        let obj = config
            .as_object_mut()
            .ok_or_else(|| anyhow!("bad marian config"))?;
        obj.entry("share_encoder_decoder_embeddings")
            .or_insert(Value::Bool(true));
        let config: Config = serde_json::from_value(config).context("marian config")?;
        let tokenizer = source_tokenizer(&files[1])?;
        let vocab: HashMap<String, u32> = serde_json::from_slice(&std::fs::read(&files[2])?)?;
        let mut words = vec![String::new(); vocab.values().max().map_or(0, |m| *m as usize + 1)];
        for (word, id) in &vocab {
            words[*id as usize] = word.clone();
        }
        let unk = *vocab
            .get("<unk>")
            .ok_or_else(|| anyhow!("vocab has no <unk>"))?;
        let target_token = PAIRS
            .iter()
            .find(|(.., repo, _)| *repo == repo_id)
            .and_then(|(.., token)| *token)
            .and_then(|t| vocab.get(t).copied());
        let dtype = if device.is_cpu() {
            DType::F32
        } else {
            DType::BF16
        };
        // SAFETY: the hub cache files are not modified while mapped.
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&files[3..], dtype, &device)? };
        let model = MTModel::new(&config, vb)?;
        Ok(Self {
            model,
            config,
            tokenizer,
            vocab,
            words,
            target_token,
            unk,
            device,
        })
    }

    /// Source ids: optional `>>lang<<`, the SentencePiece pieces looked up in vocab.json, `</s>`.
    pub fn encode(&self, text: &str) -> Result<Vec<u32>> {
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let pieces = self
            .tokenizer
            .encode(text, false)
            .map_err(|e| anyhow!("{e}"))?;
        let mut ids: Vec<u32> = self.target_token.into_iter().collect();
        ids.extend(
            pieces
                .get_tokens()
                .iter()
                .map(|p| self.vocab.get(p).copied().unwrap_or(self.unk)),
        );
        ids.push(self.config.eos_token_id);
        Ok(ids)
    }

    pub fn decode(&self, ids: &[u32]) -> String {
        let special = [self.config.eos_token_id, self.config.pad_token_id, self.unk];
        ids.iter()
            .filter(|id| !special.contains(id))
            .filter_map(|id| self.words.get(*id as usize))
            .map(String::as_str)
            .collect::<String>()
            .replace('▁', " ")
            .trim()
            .to_string()
    }

    /// Greedy decode; output is bounded by the input length.
    pub fn translate(&mut self, text: &str) -> Result<String> {
        if text.trim().is_empty() {
            return Ok(String::new());
        }
        let src = self.encode(text)?;
        let max_tokens = (src.len() * 3).clamp(16, 256);
        let input = Tensor::new(src.as_slice(), &self.device)?.unsqueeze(0)?;
        let encoded = self.model.encoder().forward(&input, 0)?;
        let mut out = vec![self.config.decoder_start_token_id];
        let result = (|| -> Result<()> {
            for step in 0..max_tokens {
                let start = if step == 0 { 0 } else { out.len() - 1 };
                let ids = Tensor::new(&out[start..], &self.device)?.unsqueeze(0)?;
                let logits = self.model.decode(&ids, &encoded, start)?.squeeze(0)?;
                let logits = logits.get(logits.dim(0)? - 1)?.to_dtype(DType::F32)?;
                let mut logits = logits.to_vec1::<f32>()?;
                // Never emit padding (HF's bad_words_ids for Marian).
                logits[self.config.pad_token_id as usize] = f32::NEG_INFINITY;
                let next = logits
                    .iter()
                    .enumerate()
                    .max_by(|a, b| a.1.total_cmp(b.1))
                    .map_or(self.config.eos_token_id, |(i, _)| i as u32);
                if next == self.config.eos_token_id || next == self.config.forced_eos_token_id {
                    break;
                }
                out.push(next);
            }
            Ok(())
        })();
        self.model.reset_kv_cache();
        result?;
        Ok(self.decode(&out[1..]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hand-built `ModelProto`: two pieces plus a trainer_spec field that must be skipped.
    #[test]
    fn spm_pieces_reads_piece_score_and_type() {
        let piece = |text: &str, score: f32, kind: u8| {
            let mut p = vec![0x0a, text.len() as u8];
            p.extend(text.as_bytes());
            p.push(0x15);
            p.extend(score.to_le_bytes());
            p.extend([0x18, kind]);
            let mut out = vec![0x0a, p.len() as u8];
            out.extend(p);
            out
        };
        let mut model = piece("<unk>", 0.0, 2);
        model.extend([0x12, 0x02, 0x08, 0x01]); // field 2 (trainer_spec), skipped
        model.extend(piece("▁hi", -3.5, 1));
        let got = spm_pieces(&model).unwrap();
        assert_eq!(got, vec![("<unk>".into(), 0.0, 2), ("▁hi".into(), -3.5, 1)]);
    }

    #[test]
    fn spm_pieces_rejects_truncated_input() {
        assert!(spm_pieces(&[0x0a, 0x09, 0x0a]).is_err());
        assert!(spm_pieces(&[]).is_err());
    }

    #[test]
    fn pairs_resolve_and_unsupported_pairs_fall_back() {
        assert_eq!(pair_repo("en", "id"), Some("Helsinki-NLP/opus-mt-en-id"));
        assert_eq!(pair_repo("ja", "en"), Some("Helsinki-NLP/opus-mt-ja-en"));
        assert_eq!(pair_repo("en", "ja"), None);
    }
}

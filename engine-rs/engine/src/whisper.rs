//! Whisper ASR on candle: model load from the hub, log-mel, greedy decode
//! with Whisper's timestamp rules, 30 s seek loop, language detection.
//! Feature path follows faster-whisper (the Python oracle), see `transcribe`.

use crate::whisper_model::Whisper;
use anyhow::{anyhow, Context, Result};
use candle_core::{Device, IndexOp, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::whisper::{self as w, Config};
use realfft::RealFftPlanner;
use tokenizers::Tokenizer;

use crate::audio::SAMPLE_RATE;

/// Same order as Whisper's LANGUAGES table; only tokens present in the
/// tokenizer are used.
const LANGUAGES: [&str; 100] = [
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it",
    "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur",
    "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn",
    "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si",
    "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo",
    "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln",
    "ha", "ba", "jw", "su", "yue",
];
/// Seconds per timestamp token.
const TS_STEP: f64 = 0.02;
/// Mel frames per second (hop 160 at 16 kHz).
const FRAMES_PER_SEC: f64 = 100.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Task {
    Transcribe,
    Translate,
}

pub struct WhisperAsr {
    pub repo_id: String,
    model: Whisper,
    tokenizer: Tokenizer,
    filters: Vec<f32>,
    device: Device,
    sot: u32,
    eot: u32,
    transcribe: u32,
    translate: u32,
    no_speech: Option<u32>,
    ts_begin: u32,
    blank: Option<u32>,
    languages: Vec<(&'static str, u32)>,
    suppress: Vec<u32>,
}

/// `WHISPER_MODEL` short names map to the openai safetensors repos.
pub fn repo_for(model: &str) -> String {
    if model.contains('/') {
        model.to_string()
    } else {
        format!("openai/whisper-{model}")
    }
}

/// librosa `filters.mel(sr=16000, n_fft=400, n_mels)` with Slaney scale and norm,
/// row-major `n_mels x 201` — the table Whisper ships as mel_filters.npz.
pub fn mel_filters(n_mels: usize) -> Vec<f32> {
    let n_fft = w::N_FFT;
    let bins = n_fft / 2 + 1;
    let sr = SAMPLE_RATE as f64;
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1000.0;
    let min_log_mel = min_log_hz / f_sp;
    let logstep = 6.4f64.ln() / 27.0;
    let hz_to_mel = |f: f64| {
        if f >= min_log_hz {
            min_log_mel + (f / min_log_hz).ln() / logstep
        } else {
            f / f_sp
        }
    };
    let mel_to_hz = |m: f64| {
        if m >= min_log_mel {
            min_log_hz * (logstep * (m - min_log_mel)).exp()
        } else {
            f_sp * m
        }
    };
    let top = hz_to_mel(sr / 2.0);
    let mel_f: Vec<f64> = (0..n_mels + 2)
        .map(|i| mel_to_hz(top * i as f64 / (n_mels + 1) as f64))
        .collect();
    let fft_freqs: Vec<f64> = (0..bins).map(|k| k as f64 * sr / n_fft as f64).collect();
    let mut out = vec![0f32; n_mels * bins];
    for m in 0..n_mels {
        let enorm = 2.0 / (mel_f[m + 2] - mel_f[m]);
        for (k, f) in fft_freqs.iter().enumerate() {
            let lower = (f - mel_f[m]) / (mel_f[m + 1] - mel_f[m]);
            let upper = (mel_f[m + 2] - f) / (mel_f[m + 2] - mel_f[m + 1]);
            out[m * bins + k] = (lower.min(upper).max(0.0) * enorm) as f32;
        }
    }
    out
}

/// Whisper's log-mel (`torch.stft(center=True, reflect)` → mel → log10 →
/// clamp to max-8 → (x+4)/4), `n_mels x (len/160)` row-major. candle's own
/// `pcm_to_mel` is whisper.cpp's: frames are not centred (200 samples late)
/// and power is folded to twice the reference, which moved timestamp choices.
pub fn log_mel(samples: &[f32], filters: &[f32], n_mels: usize) -> Vec<f32> {
    let (n_fft, hop) = (w::N_FFT, w::HOP_LENGTH);
    let bins = n_fft / 2 + 1;
    let n = samples.len();
    assert!(
        n > n_fft / 2,
        "log_mel needs more than {} samples",
        n_fft / 2
    );
    let frames = n / hop;
    let half = n_fft / 2;
    let mut x = Vec::with_capacity(n + n_fft);
    x.extend((1..=half).rev().map(|i| samples[i]));
    x.extend_from_slice(samples);
    x.extend((1..=half).map(|i| samples[n - 1 - i]));
    let hann: Vec<f32> = (0..n_fft)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / n_fft as f32).cos())
        .collect();
    let fft = RealFftPlanner::<f32>::new().plan_fft_forward(n_fft);
    let mut input = fft.make_input_vec();
    let mut spectrum = fft.make_output_vec();
    let mut scratch = fft.make_scratch_vec();
    let mut power = vec![0f32; bins];
    let mut mel = vec![0f32; n_mels * frames];
    for f in 0..frames {
        for (k, v) in input.iter_mut().enumerate() {
            *v = x[f * hop + k] * hann[k];
        }
        fft.process_with_scratch(&mut input, &mut spectrum, &mut scratch)
            .expect("fft size is fixed");
        for (p, c) in power.iter_mut().zip(&spectrum) {
            *p = c.re * c.re + c.im * c.im;
        }
        for m in 0..n_mels {
            let row = &filters[m * bins..(m + 1) * bins];
            let sum: f32 = row.iter().zip(&power).map(|(a, b)| a * b).sum();
            mel[m * frames + f] = sum.max(1e-10).log10();
        }
    }
    let floor = mel.iter().copied().fold(f32::NEG_INFINITY, f32::max) - 8.0;
    mel.iter_mut().for_each(|v| *v = (v.max(floor) + 4.0) / 4.0);
    mel
}

fn token(tokenizer: &Tokenizer, text: &str) -> Result<u32> {
    tokenizer
        .token_to_id(text)
        .ok_or_else(|| anyhow!("tokenizer has no {text}"))
}

fn log_softmax(logits: &[f32]) -> Vec<f32> {
    let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let sum: f32 = logits.iter().map(|x| (x - max).exp()).sum();
    let lse = max + sum.ln();
    logits.iter().map(|x| x - lse).collect()
}

fn argmax(values: &[f32]) -> usize {
    values
        .iter()
        .enumerate()
        .fold((0, f32::NEG_INFINITY), |best, (i, v)| {
            if *v > best.1 {
                (i, *v)
            } else {
                best
            }
        })
        .0
}

impl WhisperAsr {
    pub fn load(model: &str, device: Device) -> Result<Self> {
        let repo_id = repo_for(model);
        let fetch = |name: &str| {
            crate::ml::hub_file(&repo_id, None, name).or_else(|first| {
                // whisper-base and friends only have safetensors on this PR ref. Only a
                // 404 means "try the PR"; any other failure is the real error, not
                // something the PR ref's own 404 should overwrite.
                if crate::ml::is_not_found(&first) {
                    crate::ml::hub_file(&repo_id, Some("refs/pr/22"), name).map_err(|_| first)
                } else {
                    Err(first)
                }
            })
        };
        let config: Config = serde_json::from_slice(&std::fs::read(fetch("config.json")?)?)
            .context("whisper config")?;
        let tokenizer =
            Tokenizer::from_file(fetch("tokenizer.json")?).map_err(|e| anyhow!("{e}"))?;
        let weights = fetch("model.safetensors")?;
        // SAFETY: the hub cache file is not modified while mapped.
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&[weights], w::DTYPE, &device)? };
        let model = Whisper::load(&vb, config.clone())?;

        let sot = token(&tokenizer, w::SOT_TOKEN)?;
        let eot = token(&tokenizer, w::EOT_TOKEN)?;
        let no_timestamps = token(&tokenizer, w::NO_TIMESTAMPS_TOKEN)?;
        let languages: Vec<(&'static str, u32)> = LANGUAGES
            .iter()
            .filter_map(|code| {
                tokenizer
                    .token_to_id(&format!("<|{code}|>"))
                    .map(|id| (*code, id))
            })
            .collect();
        let no_speech = w::NO_SPEECH_TOKENS
            .iter()
            .find_map(|t| tokenizer.token_to_id(t));
        let blank = tokenizer
            .encode(" ", false)
            .ok()
            .and_then(|e| e.get_ids().first().copied());
        // Every special token between EOT and the first timestamp, plus the
        // config list (Whisper's suppress_tokens = -1).
        let ts_begin = no_timestamps + 1;
        let mut suppress: Vec<u32> = ((eot + 1)..ts_begin).collect();
        suppress.extend(config.suppress_tokens.iter().copied());
        Ok(Self {
            repo_id,
            transcribe: token(&tokenizer, w::TRANSCRIBE_TOKEN)?,
            translate: token(&tokenizer, w::TRANSLATE_TOKEN)?,
            model,
            tokenizer,
            filters: mel_filters(config.num_mel_bins),
            device,
            sot,
            eot,
            no_speech,
            ts_begin,
            blank,
            languages,
            suppress,
        })
    }

    fn language_token(&self, code: &str) -> Result<u32> {
        self.languages
            .iter()
            .find(|(c, _)| *c == code)
            .map(|(_, id)| *id)
            .ok_or_else(|| anyhow!("'{code}' is not a valid language code"))
    }

    fn logits_last(
        &mut self,
        tokens: &[u32],
        features: &Tensor,
        flush: bool,
    ) -> Result<(Vec<f32>, Tensor)> {
        let input = Tensor::new(tokens, &self.device)?.unsqueeze(0)?;
        let ys = self.model.decoder.forward(&input, features, flush)?;
        let n = tokens.len();
        let logits = self
            .model
            .decoder
            .final_linear(&ys.i((..1, n - 1..))?)?
            .i(0)?
            .i(0)?
            .to_vec1::<f32>()?;
        Ok((logits, ys))
    }

    fn detect_language(&mut self, features: &Tensor) -> Result<u32> {
        let (logits, _) = self.logits_last(&[self.sot], features, true)?;
        let best = self
            .languages
            .iter()
            .max_by(|a, b| logits[a.1 as usize].total_cmp(&logits[b.1 as usize]))
            .ok_or_else(|| anyhow!("model has no language tokens"))?;
        Ok(best.1)
    }

    /// Greedy decode of one 30 s window: (sampled tokens, avg logprob, no-speech prob).
    fn decode_window(&mut self, features: &Tensor, prompt: &[u32]) -> Result<(Vec<u32>, f64, f64)> {
        let mut tokens = prompt.to_vec();
        let max_len = self.model.config.max_target_positions / 2;
        let vocab = self.model.config.vocab_size;
        let ts_begin = self.ts_begin as usize;
        let mut sum_logprob = 0f64;
        let mut no_speech_prob = 0f64;
        for step in 0..max_len {
            let (mut logits, ys) = self.logits_last(&tokens, features, step == 0)?;
            if step == 0 {
                if let Some(ns) = self.no_speech {
                    let first = self
                        .model
                        .decoder
                        .final_linear(&ys.i((..1, ..1))?)?
                        .i(0)?
                        .i(0)?
                        .to_vec1::<f32>()?;
                    no_speech_prob = log_softmax(&first)[ns as usize].exp() as f64;
                }
            }
            logits.truncate(vocab);
            let neg = f32::NEG_INFINITY;
            for &t in &self.suppress {
                if let Some(v) = logits.get_mut(t as usize) {
                    *v = neg;
                }
            }
            let sampled = &tokens[prompt.len()..];
            if sampled.is_empty() {
                if let Some(b) = self.blank {
                    logits[b as usize] = neg;
                }
                logits[self.eot as usize] = neg;
            }
            // Timestamp rules (openai/whisper ApplyTimestampRules).
            let is_ts = |t: &u32| *t as usize >= ts_begin;
            let last_ts = sampled.last().is_some_and(is_ts);
            let penult_ts = sampled.len() < 2 || is_ts(&sampled[sampled.len() - 2]);
            if last_ts {
                if penult_ts {
                    logits[ts_begin..].iter_mut().for_each(|v| *v = neg);
                } else {
                    logits[..self.eot as usize]
                        .iter_mut()
                        .for_each(|v| *v = neg);
                }
            }
            if let Some(last) = sampled.iter().rev().find(|t| is_ts(t)) {
                let floor = if last_ts && !penult_ts {
                    *last
                } else {
                    *last + 1
                } as usize;
                logits[ts_begin..floor.min(vocab)]
                    .iter_mut()
                    .for_each(|v| *v = neg);
            }
            if sampled.is_empty() {
                logits[..ts_begin].iter_mut().for_each(|v| *v = neg);
                // max_initial_timestamp = 1.0 s
                let cap = (ts_begin + 50 + 1).min(vocab);
                logits[cap..].iter_mut().for_each(|v| *v = neg);
            }
            let logprobs = log_softmax(&logits);
            let ts_part = &logprobs[ts_begin..];
            let ts_max = ts_part.iter().copied().fold(neg, f32::max);
            let ts_lse = ts_max + ts_part.iter().map(|x| (x - ts_max).exp()).sum::<f32>().ln();
            let text_max = logprobs[..ts_begin].iter().copied().fold(neg, f32::max);
            let next = if ts_lse > text_max {
                ts_begin + argmax(ts_part)
            } else {
                argmax(&logprobs)
            } as u32;
            let lp = log_softmax(&logits)[next as usize];
            if lp.is_finite() {
                sum_logprob += lp as f64;
            }
            if next == self.eot {
                break;
            }
            tokens.push(next);
        }
        let sampled = tokens[prompt.len()..].to_vec();
        let avg = sum_logprob / (sampled.len() + 1) as f64;
        Ok((sampled, avg, no_speech_prob))
    }

    fn text(&self, ids: &[u32]) -> Result<String> {
        Ok(self
            .tokenizer
            .decode(ids, true)
            .map_err(|e| anyhow!("{e}"))?
            .trim()
            .to_string())
    }

    /// 16 kHz mono → segments with times relative to the start of `pcm`.
    /// shortcut: greedy only (beam_size from engine mode ignored), no
    /// temperature fallback and no conditioning on previous text; add beam
    /// search when accuracy mode needs to match faster-whisper's beam 5.
    pub fn transcribe(
        &mut self,
        pcm: &[f32],
        language: Option<&str>,
        task: Task,
    ) -> Result<Vec<Segment>> {
        let content_frames = pcm.len() / w::HOP_LENGTH;
        // faster-whisper: log-mel of the audio plus 160 samples only; a short
        // last window is zero-padded in mel space (not log-mel silence).
        let mut padded = pcm.to_vec();
        padded.extend(std::iter::repeat_n(0f32, 160));
        padded.resize(padded.len().max(w::N_FFT + 1), 0.0);
        let n_mels = self.model.config.num_mel_bins;
        let mel = log_mel(&padded, &self.filters, n_mels);
        let frames = mel.len() / n_mels;
        let mel = Tensor::from_vec(mel, (1, n_mels, frames), &self.device)?;

        let task_token = match task {
            Task::Transcribe => self.transcribe,
            Task::Translate => self.translate,
        };
        let mut lang_token = language.map(|code| self.language_token(code)).transpose()?;
        let mut out = Vec::new();
        let mut seek = 0usize;
        while seek < content_frames {
            let segment_frames = (content_frames - seek).min(w::N_FRAMES);
            let window = mel.narrow(2, seek, segment_frames)?.pad_with_zeros(
                2,
                0,
                w::N_FRAMES - segment_frames,
            )?;
            let features = self.model.encoder.forward(&window, true)?;
            let lang = match lang_token {
                Some(id) => id,
                None => {
                    let id = self.detect_language(&features)?;
                    lang_token = Some(id);
                    id
                }
            };
            let (sampled, avg, no_speech) =
                self.decode_window(&features, &[self.sot, lang, task_token])?;
            let offset = seek as f64 / FRAMES_PER_SEC;
            if no_speech > w::NO_SPEECH_THRESHOLD && avg < w::LOGPROB_THRESHOLD {
                seek += segment_frames;
                continue;
            }
            let ts = |t: u32| (t - self.ts_begin) as f64 * TS_STEP;
            let mut start: Option<f64> = None;
            let mut text_ids: Vec<u32> = Vec::new();
            let mut last_pair_end: Option<u32> = None;
            for (i, &t) in sampled.iter().enumerate() {
                if t < self.ts_begin {
                    text_ids.push(t);
                    continue;
                }
                if text_ids.is_empty() {
                    start = Some(ts(t));
                } else {
                    let text = self.text(&text_ids)?;
                    if !text.is_empty() {
                        out.push(Segment {
                            start: offset + start.unwrap_or(0.0),
                            end: offset + ts(t),
                            text,
                        });
                    }
                    text_ids.clear();
                    start = None;
                    if sampled.get(i + 1).is_some_and(|n| *n >= self.ts_begin) {
                        last_pair_end = Some(t);
                    }
                }
            }
            // Single trailing timestamp = window fully used; a pair ending
            // mid-window resumes at the last pair.
            let single_end = sampled.last().is_some_and(|t| *t >= self.ts_begin)
                && !(sampled.len() >= 2 && sampled[sampled.len() - 2] >= self.ts_begin);
            let advance = match last_pair_end {
                Some(t) if !single_end => ((ts(t) * FRAMES_PER_SEC) as usize).min(segment_frames),
                _ => segment_frames,
            };
            // Unclosed text after a resume point is decoded again by the next window.
            if !text_ids.is_empty() && advance == segment_frames {
                let text = self.text(&text_ids)?;
                if !text.is_empty() {
                    out.push(Segment {
                        start: offset + start.unwrap_or(0.0),
                        end: offset + segment_frames as f64 / FRAMES_PER_SEC,
                        text,
                    });
                }
            }
            seek += advance.max(1);
        }
        Ok(out)
    }

    pub fn detected_device(&self) -> &Device {
        &self.device
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_mel_has_one_frame_per_hop_and_tracks_energy() {
        let tone: Vec<f32> = (0..16_000)
            .map(|i| (i as f32 * 2.0 * std::f32::consts::PI * 1000.0 / 16_000.0).sin())
            .collect();
        let m = log_mel(&tone, &mel_filters(80), 80);
        assert_eq!(m.len(), 80 * 100);
        // 1 kHz sits in a mid mel band: louder than band 0 at every frame.
        assert!((10..90).all(|f| (0..80)
            .max_by(|a, b| m[a * 100 + f].total_cmp(&m[b * 100 + f]))
            .unwrap()
            > 20));
        assert!(m.iter().all(|v| (-1.0..=3.0).contains(v)));
    }

    #[test]
    fn mel_filters_match_librosa_shape_and_norm() {
        let f = mel_filters(80);
        assert_eq!(f.len(), 80 * 201);
        // librosa slaney: first filter peaks at bin 1 with weight ~0.0247.
        assert!((f[1] - 0.024_7).abs() < 0.001, "{}", f[1]);
        assert!(f.iter().all(|v| *v >= 0.0));
        assert_eq!(repo_for("base"), "openai/whisper-base");
        assert_eq!(repo_for("org/x"), "org/x");
    }
}

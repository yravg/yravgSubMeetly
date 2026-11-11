//! Speaker labels for transcript segments ("who said what"), our own light implementation.
//!
//! Two honest levels, both on-device and with no model download:
//!
//! 1. **Channel labels** ([`label_by_channel`]): a segment captured from the microphone is
//!    "You", one captured from the system audio is "Others". Exact for what it claims, and it
//!    cannot tell two remote people apart.
//! 2. **Acoustic clustering** ([`diarize`]) for one mixed recording (a file, a room): the audio
//!    is cut into voiced stretches (energy gate, split at pauses), each stretch gets a small
//!    voice fingerprint (band energies as cepstral coefficients, plus pitch and brightness), and
//!    the fingerprints are grouped by average-linkage clustering. It labels "Speaker 1..N" in
//!    order of first appearance.
//!
//! Limits (say them to the user): this is not a neural speaker model. It separates voices that
//! differ clearly (a man and a woman, a near and a far microphone) and degrades with similar
//! voices, overlapping speech, music or noise, and stretches shorter than ~1 s. Treat labels as
//! a reading aid, not as evidence of who spoke.

use serde_json::{json, Value};

use crate::audio::SAMPLE_RATE;

const FRAME: usize = 400; // 25 ms at 16 kHz
const HOP: usize = 160; // 10 ms
const BANDS: usize = 20;
const CEPS: usize = 12;
/// A pause at least this long ends a stretch (seconds).
const PAUSE_S: f64 = 0.35;
/// A stretch longer than this is cut so a long monologue can still be re-clustered (seconds).
const MAX_STRETCH_S: f64 = 4.0;
/// Stretches shorter than this carry too little voice to fingerprint (seconds).
const MIN_STRETCH_S: f64 = 0.4;
/// Merge clusters while their (z-scored, average-linkage) distance is below this.
const MERGE_BELOW: f64 = 2.2;
pub const MAX_SPEAKERS: usize = 8;

/// One stretch of voiced audio and who it belongs to (0-based; display as speaker + 1).
#[derive(Clone, Debug, PartialEq)]
pub struct Turn {
    pub t0: f64,
    pub t1: f64,
    pub speaker: usize,
}

pub fn speaker_name(index: usize) -> String {
    format!("Speaker {}", index + 1)
}

/// "mic" is the person at this computer; anything else is the far side of the call.
pub fn label_by_channel(channel: &str) -> &'static str {
    match channel.trim().to_lowercase().as_str() {
        "mic" | "microphone" | "you" | "me" | "local" => "You",
        _ => "Others",
    }
}

fn hann(n: usize) -> Vec<f64> {
    (0..n).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (n as f64 - 1.0)).cos()).collect()
}

/// Edges (Hz) of `BANDS` mel-spaced bands between 100 Hz and 4 kHz (speech's useful range).
fn band_edges() -> Vec<f64> {
    let mel = |f: f64| 2595.0 * (1.0 + f / 700.0).log10();
    let inv = |m: f64| 700.0 * (10f64.powf(m / 2595.0) - 1.0);
    let (lo, hi) = (mel(100.0), mel(4000.0));
    (0..=BANDS).map(|i| inv(lo + (hi - lo) * i as f64 / BANDS as f64)).collect()
}

/// A frame's voice features: cepstral coefficients of the band energies, then log pitch and
/// spectral centroid (both 0 when the frame has no clear pitch).
fn frame_features(frame: &[f32], win: &[f64], edges: &[f64], cos_table: &[Vec<f64>]) -> Option<Vec<f64>> {
    let x: Vec<f64> = frame.iter().zip(win).map(|(s, w)| *s as f64 * w).collect();
    let energy: f64 = x.iter().map(|v| v * v).sum::<f64>() / x.len() as f64;
    if energy < 1e-9 {
        return None;
    }
    // Power per DFT bin up to 4 kHz (naive DFT on a decimated bin set: 25 ms frame -> 40 Hz bins).
    let n = x.len();
    let bin_hz = SAMPLE_RATE as f64 / n as f64;
    let top = (4000.0 / bin_hz) as usize;
    let mut power = vec![0.0; top + 1];
    for (k, p) in power.iter_mut().enumerate().skip(1) {
        let w = 2.0 * std::f64::consts::PI * k as f64 / n as f64;
        let (mut re, mut im) = (0.0, 0.0);
        // Recurrence for cos/sin to avoid a trig call per sample.
        let (c, s) = (w.cos(), w.sin());
        let (mut cr, mut ci) = (1.0, 0.0);
        for v in &x {
            re += v * cr;
            im -= v * ci;
            let nr = cr * c - ci * s;
            ci = cr * s + ci * c;
            cr = nr;
        }
        *p = re * re + im * im;
    }
    let mut bands = [0.0f64; BANDS];
    for (b, out) in bands.iter_mut().enumerate() {
        let (lo, hi) = (edges[b] / bin_hz, edges[b + 1] / bin_hz);
        let (lo_i, hi_i) = (lo.floor() as usize, (hi.ceil() as usize).min(top));
        let mut sum = 0.0f64;
        let mut cnt = 0.0f64;
        for p in power.iter().take(hi_i + 1).skip(lo_i.max(1)) {
            sum += p;
            cnt += 1.0;
        }
        *out = (sum / cnt.max(1.0) + 1e-12).ln();
    }
    let mut feat = Vec::with_capacity(CEPS + 2);
    for row in cos_table.iter().take(CEPS) {
        feat.push(row.iter().zip(bands.iter()).map(|(c, b)| c * b).sum::<f64>());
    }
    // Pitch by autocorrelation over 70..400 Hz.
    let (min_lag, max_lag) = (SAMPLE_RATE / 400, SAMPLE_RATE / 70);
    let zero: f64 = x.iter().map(|v| v * v).sum();
    let mut best = (0.0, 0usize);
    for lag in min_lag..max_lag.min(n - 1) {
        let r: f64 = x[..n - lag].iter().zip(&x[lag..]).map(|(a, b)| a * b).sum();
        if r > best.0 {
            best = (r, lag);
        }
    }
    let pitch = if zero > 0.0 && best.0 / zero > 0.3 { SAMPLE_RATE as f64 / best.1 as f64 } else { 0.0 };
    let total: f64 = power.iter().sum();
    let centroid = if total > 0.0 { power.iter().enumerate().map(|(k, p)| k as f64 * bin_hz * p).sum::<f64>() / total } else { 0.0 };
    feat.push(if pitch > 0.0 { pitch.ln() } else { 0.0 });
    feat.push(centroid / 1000.0);
    Some(feat)
}

fn dct_table() -> Vec<Vec<f64>> {
    (0..CEPS)
        .map(|k| (0..BANDS).map(|b| (std::f64::consts::PI * (k as f64 + 1.0) * (b as f64 + 0.5) / BANDS as f64).cos()).collect())
        .collect()
}

/// Voiced stretches (start, end) in frame indices, from a gate set relative to the loudest frames.
fn stretches(samples: &[f32]) -> Vec<(usize, usize)> {
    let frames = if samples.len() >= FRAME { (samples.len() - FRAME) / HOP + 1 } else { 0 };
    let rms: Vec<f64> = (0..frames)
        .map(|i| {
            let f = &samples[i * HOP..i * HOP + FRAME];
            (f.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / FRAME as f64).sqrt()
        })
        .collect();
    if rms.is_empty() {
        return Vec::new();
    }
    let mut sorted = rms.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let loud = sorted[(sorted.len() as f64 * 0.95) as usize % sorted.len()];
    let gate = (loud * 0.12).max(1e-4);
    let pause = (PAUSE_S * 100.0) as usize;
    let max_len = (MAX_STRETCH_S * 100.0) as usize;
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let mut last_voiced = 0;
    for (i, r) in rms.iter().enumerate() {
        if *r >= gate {
            if start.is_none() {
                start = Some(i);
            }
            last_voiced = i;
            if i - start.unwrap() >= max_len {
                out.push((start.unwrap(), i));
                start = None;
            }
        } else if let Some(s) = start {
            if i - last_voiced >= pause {
                out.push((s, last_voiced));
                start = None;
            }
        }
    }
    if let Some(s) = start {
        out.push((s, last_voiced));
    }
    out.into_iter().filter(|(a, b)| (*b - *a) as f64 / 100.0 >= MIN_STRETCH_S).collect()
}

fn dist(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| (x - y).powi(2)).sum::<f64>().sqrt()
}

/// Cut `samples` (16 kHz mono) into voiced stretches and group them by voice.
/// `max_speakers`: 0 lets the distances decide (up to [`MAX_SPEAKERS`]).
pub fn diarize(samples: &[f32], max_speakers: usize) -> Vec<Turn> {
    let spans = stretches(samples);
    if spans.is_empty() {
        return Vec::new();
    }
    let (win, edges, cos) = (hann(FRAME), band_edges(), dct_table());
    // One fingerprint per stretch: the mean of its frames' features.
    let mut prints: Vec<Vec<f64>> = Vec::new();
    let mut kept: Vec<(usize, usize)> = Vec::new();
    for (a, b) in spans {
        let mut sum: Vec<f64> = Vec::new();
        let mut n = 0.0;
        // Every other frame: half the cost, the same average.
        for i in (a..=b).step_by(2) {
            let end = i * HOP + FRAME;
            if end > samples.len() {
                break;
            }
            if let Some(f) = frame_features(&samples[i * HOP..end], &win, &edges, &cos) {
                if sum.is_empty() {
                    sum = vec![0.0; f.len()];
                }
                for (s, v) in sum.iter_mut().zip(&f) {
                    *s += v;
                }
                n += 1.0;
            }
        }
        if n > 0.0 {
            prints.push(sum.iter().map(|s| s / n).collect());
            kept.push((a, b));
        }
    }
    if prints.is_empty() {
        return Vec::new();
    }
    // Z-score each dimension across stretches so no feature dominates by scale.
    let dims = prints[0].len();
    for d in 0..dims {
        let mean = prints.iter().map(|p| p[d]).sum::<f64>() / prints.len() as f64;
        let var = prints.iter().map(|p| (p[d] - mean).powi(2)).sum::<f64>() / prints.len() as f64;
        // A floor on the spread, so one person's small natural variation is not stretched into
        // "two speakers": cepstra (log-power scale), log pitch (~10 %), centroid (kHz).
        let floor = if d < CEPS { 2.0 } else if d == CEPS { 0.1 } else { 0.25 };
        let sd = var.sqrt().max(floor);
        for p in prints.iter_mut() {
            p[d] = (p[d] - mean) / sd;
        }
    }
    let labels = cluster(&prints, max_speakers);
    // Number speakers by first appearance.
    let mut order: Vec<usize> = Vec::new();
    kept.iter()
        .zip(labels)
        .map(|((a, b), l)| {
            let idx = order.iter().position(|x| *x == l).unwrap_or_else(|| {
                order.push(l);
                order.len() - 1
            });
            Turn { t0: *a as f64 / 100.0, t1: (*b * HOP + FRAME) as f64 / SAMPLE_RATE as f64, speaker: idx }
        })
        .collect()
}

/// Average-linkage agglomerative clustering; returns a cluster id per point.
fn cluster(points: &[Vec<f64>], max_speakers: usize) -> Vec<usize> {
    let n = points.len();
    let mut groups: Vec<Vec<usize>> = (0..n).map(|i| vec![i]).collect();
    let limit = if max_speakers == 0 { MAX_SPEAKERS } else { max_speakers.min(MAX_SPEAKERS) };
    // With no stated count the tail of single-voice noise must not split one person in two:
    // the threshold scales with the spread of the data (a lone voice has a small spread).
    let spread = {
        let c: Vec<f64> = (0..points[0].len()).map(|d| points.iter().map(|p| p[d]).sum::<f64>() / n as f64).collect();
        points.iter().map(|p| dist(p, &c)).sum::<f64>() / n as f64
    };
    loop {
        if groups.len() <= 1 {
            break;
        }
        let mut best = (f64::MAX, 0, 0);
        for i in 0..groups.len() {
            for j in i + 1..groups.len() {
                let mut sum = 0.0;
                for a in &groups[i] {
                    for b in &groups[j] {
                        sum += dist(&points[*a], &points[*b]);
                    }
                }
                let d = sum / (groups[i].len() * groups[j].len()) as f64;
                if d < best.0 {
                    best = (d, i, j);
                }
            }
        }
        let forced = groups.len() > limit;
        // One group's points sit about `spread` from their centre; two voices sit much further apart.
        let close = best.0 < MERGE_BELOW.max(spread * 1.1);
        // Merge when over the stated limit, or (no stated count) when the two are close enough.
        if !forced && !(close && max_speakers == 0) {
            break;
        }
        let merged = groups.remove(best.2);
        groups[best.1].extend(merged);
    }
    let mut out = vec![0; n];
    for (g, members) in groups.iter().enumerate() {
        for m in members {
            out[*m] = g;
        }
    }
    out
}

/// The speaker whose turns overlap `[t0, t1]` most, if any overlap.
pub fn speaker_at(turns: &[Turn], t0: f64, t1: f64) -> Option<usize> {
    let mut score: Vec<(usize, f64)> = Vec::new();
    for t in turns {
        let o = t1.min(t.t1) - t0.max(t.t0);
        if o > 0.0 {
            match score.iter_mut().find(|(s, _)| *s == t.speaker) {
                Some(e) => e.1 += o,
                None => score.push((t.speaker, o)),
            }
        }
    }
    score.into_iter().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap()).map(|(s, _)| s)
}

/// Label transcript segments `[{t0, t1, text?, channel?}]`. A `channel` ("mic" / "system") wins
/// and gives "You" / "Others"; otherwise the acoustic `turns` decide ("Speaker N"); a segment
/// with neither is returned without a `speaker`.
pub fn label_segments(segments: &[Value], turns: &[Turn]) -> Vec<Value> {
    segments
        .iter()
        .map(|seg| {
            let mut out = seg.clone();
            let num = |k: &str| seg.get(k).and_then(Value::as_f64).unwrap_or(0.0);
            let channel = seg.get("channel").and_then(Value::as_str).filter(|c| !c.trim().is_empty());
            let speaker = match channel {
                Some(c) => Some(label_by_channel(c).to_string()),
                None => speaker_at(turns, num("t0"), num("t1")).map(speaker_name),
            };
            if let (Some(s), Value::Object(map)) = (speaker, &mut out) {
                map.insert("speaker".into(), json!(s));
            }
            out
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A crude voice: harmonics of `f0` shaped by two formants, with a little vibrato.
    fn voice(f0: f64, formants: [f64; 2], secs: f64, out: &mut Vec<f32>) {
        let n = (secs * SAMPLE_RATE as f64) as usize;
        for i in 0..n {
            let t = i as f64 / SAMPLE_RATE as f64;
            let f = f0 * (1.0 + 0.01 * (2.0 * std::f64::consts::PI * 5.0 * t).sin());
            let mut v = 0.0;
            for h in 1..30 {
                let hf = f * h as f64;
                if hf > 4000.0 {
                    break;
                }
                let gain: f64 = formants.iter().map(|c| (-((hf - c) / 250.0).powi(2)).exp()).sum::<f64>() + 0.05;
                v += gain * (2.0 * std::f64::consts::PI * hf * t).sin() / h as f64;
            }
            out.push((v * 0.3) as f32);
        }
    }

    fn silence(secs: f64, out: &mut Vec<f32>) {
        out.extend(std::iter::repeat_n(0.0, (secs * SAMPLE_RATE as f64) as usize));
    }

    fn conversation() -> (Vec<f32>, Vec<usize>) {
        let (mut a, mut b) = (Vec::new(), Vec::new());
        let _ = &mut b;
        let mut audio = Vec::new();
        let mut truth = Vec::new();
        // low voice, high voice, alternating, with pauses between
        for k in 0..6 {
            if k % 2 == 0 {
                voice(110.0, [500.0, 1500.0], 1.8, &mut a);
                audio.append(&mut a);
                truth.push(0);
            } else {
                voice(220.0, [800.0, 2400.0], 1.8, &mut b);
                audio.append(&mut b);
                truth.push(1);
            }
            silence(0.6, &mut audio);
        }
        (audio, truth)
    }

    #[test]
    fn two_different_voices_become_two_speakers() {
        let (audio, truth) = conversation();
        let turns = diarize(&audio, 0);
        assert_eq!(turns.len(), truth.len(), "one turn per utterance: {turns:?}");
        let ids: std::collections::BTreeSet<_> = turns.iter().map(|t| t.speaker).collect();
        assert_eq!(ids.len(), 2, "two speakers: {turns:?}");
        // The labels follow the utterances (speaker numbers are by first appearance, truth starts at 0).
        for (t, want) in turns.iter().zip(&truth) {
            assert_eq!(t.speaker, *want, "{turns:?}");
        }
    }

    #[test]
    fn one_voice_stays_one_speaker() {
        let mut audio = Vec::new();
        for _ in 0..5 {
            voice(130.0, [600.0, 1700.0], 1.5, &mut audio);
            silence(0.5, &mut audio);
        }
        let turns = diarize(&audio, 0);
        assert!(!turns.is_empty());
        assert!(turns.iter().all(|t| t.speaker == 0), "{turns:?}");
    }

    #[test]
    fn a_stated_count_is_respected() {
        let (audio, _) = conversation();
        let one = diarize(&audio, 1);
        assert!(one.iter().all(|t| t.speaker == 0));
    }

    #[test]
    fn silence_and_noise_floor_give_no_turns() {
        assert!(diarize(&vec![0.0; 32_000], 0).is_empty());
        assert!(diarize(&[], 0).is_empty());
    }

    #[test]
    fn channels_label_you_and_others() {
        assert_eq!(label_by_channel("mic"), "You");
        assert_eq!(label_by_channel("System"), "Others");
        let segs = vec![json!({"t0": 0.0, "t1": 1.0, "text": "hi", "channel": "mic"}), json!({"t0": 1.0, "t1": 2.0, "text": "yo", "channel": "system"})];
        let out = label_segments(&segs, &[]);
        assert_eq!(out[0]["speaker"], "You");
        assert_eq!(out[1]["speaker"], "Others");
    }

    #[test]
    fn segments_take_the_speaker_they_overlap_most() {
        let turns = vec![Turn { t0: 0.0, t1: 2.0, speaker: 0 }, Turn { t0: 2.0, t1: 5.0, speaker: 1 }];
        let segs = vec![json!({"t0": 0.5, "t1": 1.5, "text": "a"}), json!({"t0": 1.8, "t1": 4.0, "text": "b"}), json!({"t0": 9.0, "t1": 10.0, "text": "c"})];
        let out = label_segments(&segs, &turns);
        assert_eq!(out[0]["speaker"], "Speaker 1");
        assert_eq!(out[1]["speaker"], "Speaker 2");
        assert!(out[2].get("speaker").is_none());
    }
}

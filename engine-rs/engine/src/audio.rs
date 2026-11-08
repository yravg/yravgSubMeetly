//! Media decode to 16 kHz mono f32: symphonia (wav, mp3, m4a/aac, flac) +
//! rubato resampling. `MonoStream` decodes incrementally so long files stay
//! O(window) in RAM, the way the oracle reads PCM from one ffmpeg pipe.

use std::fs::File;
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{
    Async, FixedAsync, Indexing, Resampler, SincInterpolationParameters, SincInterpolationType,
    WindowFunction,
};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const SAMPLE_RATE: usize = 16_000;
const RESAMPLE_CHUNK: usize = 1024;

/// Little-endian f32 PCM body (the `/transcribe` and `/draft` wire format).
pub fn pcm_f32_le(body: &[u8]) -> Vec<f32> {
    body.as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect()
}

pub struct MonoStream {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    resampler: Option<Async<f32>>,
    pending: Vec<f32>,
    /// Resampler start-up delay still to drop from the output, in frames.
    skip: usize,
    /// Native frames fed / 16 kHz frames emitted, to cut the padded tail exactly.
    fed: u64,
    emitted: u64,
    ratio: f64,
    done: bool,
    pub duration_sec: Option<f64>,
}

impl MonoStream {
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }
        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                // Trim MP3 encoder delay/padding like ffmpeg does, or every
                // timestamp is late by the delay.
                &FormatOptions {
                    enable_gapless: true,
                    ..FormatOptions::default()
                },
                &MetadataOptions::default(),
            )
            .map_err(|e| anyhow!("unsupported media: {e}"))?;
        let format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| {
                t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_some()
            })
            .ok_or_else(|| anyhow!("no audio track"))?;
        let params = track.codec_params.clone();
        let rate = params.sample_rate.unwrap_or(SAMPLE_RATE as u32) as usize;
        let duration_sec = params.n_frames.map(|frames| frames as f64 / rate as f64);
        let decoder = symphonia::default::get_codecs()
            .make(&params, &DecoderOptions::default())
            .map_err(|e| anyhow!("unsupported codec: {e}"))?;
        let resampler = if rate == SAMPLE_RATE {
            None
        } else {
            let parameters = SincInterpolationParameters {
                sinc_len: 256,
                f_cutoff: Some(0.95),
                interpolation: SincInterpolationType::Linear,
                oversampling_factor: 256,
                window: WindowFunction::BlackmanHarris2,
            };
            Some(
                Async::<f32>::new_sinc(
                    SAMPLE_RATE as f64 / rate as f64,
                    1.0,
                    &parameters,
                    RESAMPLE_CHUNK,
                    1,
                    FixedAsync::Input,
                )
                .map_err(|e| anyhow!("resampler: {e}"))?,
            )
        };
        let skip = resampler.as_ref().map_or(0, |r| r.output_delay());
        Ok(Self {
            track_id: track.id,
            format,
            decoder,
            resampler,
            pending: Vec::new(),
            skip,
            fed: 0,
            emitted: 0,
            ratio: SAMPLE_RATE as f64 / rate as f64,
            done: false,
            duration_sec,
        })
    }

    /// Next decoded packet as native-rate mono, or None at end of stream.
    fn next_native(&mut self) -> Result<Option<Vec<f32>>> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return Ok(None)
                }
                Err(SymError::ResetRequired) => return Ok(None),
                Err(e) => return Err(anyhow!("read media: {e}")),
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            let decoded = match self.decoder.decode(&packet) {
                Ok(decoded) => decoded,
                Err(SymError::DecodeError(_)) => continue,
                Err(e) => return Err(anyhow!("decode: {e}")),
            };
            let spec = *decoded.spec();
            let channels = spec.channels.count().max(1);
            let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
            buffer.copy_interleaved_ref(decoded);
            let mono = buffer
                .samples()
                .chunks_exact(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect();
            return Ok(Some(mono));
        }
    }

    fn resample(&mut self, flush: bool) -> Result<Vec<f32>> {
        let Some(resampler) = self.resampler.as_mut() else {
            return Ok(std::mem::take(&mut self.pending));
        };
        let mut out = Vec::new();
        let mut used = 0;
        loop {
            let need = resampler.input_frames_next();
            let left = self.pending.len() - used;
            if left < need && !(flush && left > 0) {
                break;
            }
            let take = left.min(need);
            let input = InterleavedSlice::new(&self.pending[used..used + take], 1, take)
                .map_err(|e| anyhow!("resample input: {e}"))?;
            let indexing = Indexing {
                partial_len: (take < need).then_some(take),
                ..Default::default()
            };
            let chunk = resampler
                .process(&input, Some(&indexing))
                .map_err(|e| anyhow!("resample: {e}"))?;
            out.extend(chunk.take_data());
            used += take;
            self.fed += take as u64;
        }
        self.pending.drain(..used);
        if flush {
            // Push the start-up delay's worth of silence through so the tail is not lost.
            let mut tail = Self::flush_delay(resampler)?;
            out.append(&mut tail);
        }
        let drop = self.skip.min(out.len());
        self.skip -= drop;
        out.drain(..drop);
        if flush {
            let expected = (self.fed as f64 * self.ratio).round() as u64;
            out.truncate(expected.saturating_sub(self.emitted) as usize);
        }
        self.emitted += out.len() as u64;
        Ok(out)
    }

    fn flush_delay(resampler: &mut Async<f32>) -> Result<Vec<f32>> {
        let mut out = Vec::new();
        let delay = resampler.output_delay();
        while out.len() < delay {
            let need = resampler.input_frames_next();
            let silence = vec![0.0f32; need];
            let input = InterleavedSlice::new(&silence, 1, need)
                .map_err(|e| anyhow!("resample input: {e}"))?;
            let chunk = resampler
                .process(&input, None)
                .map_err(|e| anyhow!("resample: {e}"))?;
            out.extend(chunk.take_data());
        }
        out.truncate(delay);
        Ok(out)
    }

    /// Next run of 16 kHz samples (empty Vec never returned), None when finished.
    pub fn next_chunk(&mut self) -> Result<Option<Vec<f32>>> {
        while !self.done {
            match self.next_native()? {
                Some(mono) => {
                    self.pending.extend(mono);
                    let out = self.resample(false)?;
                    if !out.is_empty() {
                        return Ok(Some(out));
                    }
                }
                None => {
                    self.done = true;
                    let out = self.resample(true)?;
                    if !out.is_empty() {
                        return Ok(Some(out));
                    }
                }
            }
        }
        Ok(None)
    }
}

/// Whole file as 16 kHz mono (small files only; large ones use `Windows`).
pub fn decode_file(path: &Path) -> Result<Vec<f32>> {
    let mut stream = MonoStream::open(path)?;
    let mut out = Vec::new();
    while let Some(chunk) = stream.next_chunk()? {
        out.extend(chunk);
    }
    Ok(out)
}

/// `_stream_windows`: yields (start_sec, lead_sec, window) where the window is
/// the previous window's tail (`lead_sec`) followed by `chunk_sec` of new audio.
pub struct Windows {
    stream: MonoStream,
    chunk_n: usize,
    overlap_n: usize,
    carry: Vec<f32>,
    tail: Vec<f32>,
    pos: usize,
    finished: bool,
}

impl Windows {
    pub fn new(stream: MonoStream, chunk_sec: f64, overlap_sec: f64) -> Self {
        Self {
            stream,
            chunk_n: ((chunk_sec * SAMPLE_RATE as f64) as usize).max(1),
            overlap_n: (overlap_sec * SAMPLE_RATE as f64).max(0.0) as usize,
            carry: Vec::new(),
            tail: Vec::new(),
            pos: 0,
            finished: false,
        }
    }

    pub fn duration_sec(&self) -> Option<f64> {
        self.stream.duration_sec
    }

    pub fn next_window(&mut self) -> Result<Option<(f64, f64, Vec<f32>)>> {
        if self.finished {
            return Ok(None);
        }
        let mut short = false;
        while self.carry.len() < self.chunk_n {
            match self.stream.next_chunk()? {
                Some(chunk) => self.carry.extend(chunk),
                None => {
                    short = true;
                    break;
                }
            }
        }
        let take = self.carry.len().min(self.chunk_n);
        if take == 0 {
            self.finished = true;
            return Ok(None);
        }
        let current: Vec<f32> = self.carry.drain(..take).collect();
        let mut window = std::mem::take(&mut self.tail);
        let lead = window.len();
        window.extend_from_slice(&current);
        let start = self.pos as f64 / SAMPLE_RATE as f64;
        self.pos += current.len();
        self.tail = if self.overlap_n > 0 && current.len() >= self.overlap_n {
            current[current.len() - self.overlap_n..].to_vec()
        } else {
            current
        };
        if short && self.carry.is_empty() {
            self.finished = true;
        }
        Ok(Some((start, lead as f64 / SAMPLE_RATE as f64, window)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_wav(path: &Path, rate: u32, samples: &[i16]) {
        let mut bytes = Vec::new();
        let data_len = (samples.len() * 2) as u32;
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn resamples_to_16k_and_windows_with_overlap() {
        let path = std::env::temp_dir().join(format!("ysm-audio-{}.wav", std::process::id()));
        // 2.5 s of a 440 Hz tone at 44.1 kHz.
        let rate = 44_100u32;
        let samples: Vec<i16> = (0..(rate as usize * 5 / 2))
            .map(|i| {
                ((i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 8000.0) as i16
            })
            .collect();
        write_wav(&path, rate, &samples);

        let pcm = decode_file(&path).unwrap();
        let expected = SAMPLE_RATE * 5 / 2;
        assert!(
            pcm.len().abs_diff(expected) <= 2,
            "{} vs {expected}",
            pcm.len()
        );
        let rms = (pcm.iter().map(|x| x * x).sum::<f32>() / pcm.len() as f32).sqrt();
        assert!(
            (rms - 8000.0 / 32768.0 / 2f32.sqrt()).abs() < 0.02,
            "rms {rms}"
        );

        let mut windows = Windows::new(MonoStream::open(&path).unwrap(), 1.0, 0.25);
        let mut seen = Vec::new();
        while let Some((start, lead, window)) = windows.next_window().unwrap() {
            seen.push((start, lead, window.len()));
        }
        std::fs::remove_file(&path).ok();
        assert_eq!(seen.len(), 3);
        assert_eq!((seen[0].0, seen[0].1, seen[0].2), (0.0, 0.0, 16_000));
        assert_eq!((seen[1].0, seen[1].1, seen[1].2), (1.0, 0.25, 20_000));
        assert_eq!(seen[2].0, 2.0);
        assert!(seen[2].2.abs_diff(4_000 + 8_000) <= 2);
    }
}

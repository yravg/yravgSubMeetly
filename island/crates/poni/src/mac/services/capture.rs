//! Live captions on the Mac: the Mac twin of `../../services/capture.rs` (Windows' WASAPI loopback).
//! The device half is `sources.rs` (a Core Audio process tap for what the Mac plays, and the
//! microphone, each a 16 kHz mono queue); everything else (the ~4 s windows going to the engine's
//! `/draft`, what the session heard, what the person is told) is `capture_core.rs`, shared with
//! Windows. What it reads is the Live source: the Mac's sound, the microphone (the room), or both,
//! mixed into one window tagged with the louder side (`poni_core::capture::Mixer`).
//!
//! macOS asks the person once for each: Microphone (Privacy & Security › Microphone) and, for the
//! Mac's sound, Audio Recording (the process tap; macOS 14.2 and later). Until they allow it a
//! source stays closed and the pill says so; the other one goes on.

use super::capture_core::{offer, Job, LoopCtx, POLL};
pub use super::capture_core::*;
use super::sources::{MicError, Source as Device};
use crate::events::EventSink;
use poni_core::capture::{rms, Mixer, Source};
use poni_core::utterance::{Latency, Utterances};
use std::sync::atomic::Ordering;
use std::sync::mpsc::RecvTimeoutError;
use std::time::{Duration, Instant};

/// How long a source that could not open waits before the next try (each try of the tap makes an
/// aggregate device every app hears about).
const REOPEN: Duration = Duration::from_secs(2);

impl CaptureService {
    /// Start capturing `source`; `src`/`tgt` are the engine's language codes (`auto` detects).
    /// `_mic` is Windows' endpoint id: the Mac reads its default input.
    pub fn start(sink: EventSink, port: u16, src: String, tgt: String, log: SessionLog, source: Source, _mic: String, latency: Latency) -> std::io::Result<Self> {
        Self::spawn(sink, port, src, tgt, log, latency, move |c| capture_loop(c, source))
    }
}

/// What a closed source says to the person, in words.
fn why(what: &str, e: &MicError) -> String {
    match (what, e) {
        ("microphone", MicError::Denied) => "The microphone is off for yravgSubMeetly. Allow it in System Settings \u{203a} Privacy & Security \u{203a} Microphone.".into(),
        ("microphone", MicError::NoDevice) => "No microphone. Captions resume when one is plugged in.".into(),
        (_, MicError::NoDevice) => "The Mac's sound can't be captured on this macOS (it needs 14.2 or later) or has no output device.".into(),
        (_, MicError::Denied) => "The Mac's sound is off for yravgSubMeetly. Allow it in System Settings \u{203a} Privacy & Security \u{203a} Screen & System Audio Recording.".into(),
        (_, MicError::Failed(e)) => format!("The {what} could not be captured ({e})."),
    }
}

fn capture_loop(c: LoopCtx, source: Source) {
    let LoopCtx { stop, health, slot, wake, level, latency } = c;
    // The microphone first: with Both it sets the pace of the mix.
    let mut devs: Vec<Device> = [source.room().then(Device::mic), source.pc().then(Device::pc)].into_iter().flatten().collect();
    let mut tried: Vec<Option<Instant>> = devs.iter().map(|_| None).collect();
    let mut says: Vec<Option<String>> = devs.iter().map(|_| None).collect();
    let mut mixer = Mixer::default();
    let mut utter = Utterances::new(super::capture_core::latency_of(latency.load(Ordering::Relaxed)).timing());
    let mut stopped = false;
    while !stopped {
        // Open what is not open (or moved to a new default device), at most every REOPEN.
        for (i, d) in devs.iter_mut().enumerate() {
            if !d.moved() || tried[i].is_some_and(|t| t.elapsed() < REOPEN) {
                continue;
            }
            tried[i] = Some(Instant::now());
            let what = if d.what.contains("microphone") { "microphone" } else { "Mac's sound" };
            match d.open() {
                Ok(()) => says[i] = None,
                Err(e) => {
                    crate::pinfo!("captions: {what}: {e}");
                    says[i] = Some(why(what, &e));
                }
            }
        }
        // Only a message from every closed source is shown; the sources that are open caption.
        let open = devs.iter().filter(|d| !d.moved()).count();
        let msg = if open == 0 { says.iter().flatten().next().cloned() } else { None };
        health.device(msg);
        let mut pcm: Vec<Vec<f32>> = Vec::new();
        for d in devs.iter_mut() {
            d.read();
            pcm.push(std::mem::take(&mut d.pcm));
        }
        if source.room() && !devs.is_empty() && devs[0].what.contains("microphone") {
            level.store(devs[0].level.to_bits(), Ordering::Relaxed);
        } else if let Some(p) = pcm.first() {
            level.store(rms(p).to_bits(), Ordering::Relaxed);
        }
        utter.set_timing(super::capture_core::latency_of(latency.load(Ordering::Relaxed)).timing());
        let live: Vec<usize> = (0..devs.len()).filter(|&i| !devs[i].moved()).collect();
        let jobs: Vec<Job> = match live.as_slice() {
            [i] => utter.push(&pcm[*i]).into_iter().map(|p| Job { audio: p.samples, side: None, last: p.last }).collect(),
            [m, p] => mixer.push(&pcm[*m], &pcm[*p]).into_iter().map(|(w, side)| Job { audio: w, side: Some(side), last: true }).collect(),
            _ => Vec::new(),
        };
        for job in jobs {
            // Newest wins, as on Windows: an older job the poster has not taken is dropped.
            offer(&slot, &wake, job);
        }
        match stop.recv_timeout(POLL) {
            Err(RecvTimeoutError::Timeout) => {}
            _ => stopped = true,
        }
    }
    // The devices (IOProcs, the tap and its aggregate device) end with `devs`.
    drop(devs);
}

/// The microphones Live's chip cycles: the Mac reads its default input only.
pub fn input_devices() -> Vec<(String, String)> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::AppEvent;
    use std::sync::mpsc::channel;

    /// The poster against a real engine, with no audio device (so no macOS permission): speech
    /// offered as a window must come back as a caption line. Needs a running engine
    /// (`PONI_TEST_ENGINE_PORT`) and raw 16 kHz mono f32le speech (`PONI_TEST_PCM`, from `say` +
    /// `afconvert`); run with `--ignored --nocapture`.
    #[test]
    #[ignore = "needs a running engine and a speech file"]
    fn speech_offered_as_a_window_comes_back_as_a_caption_line() {
        let port: u16 = std::env::var("PONI_TEST_ENGINE_PORT").expect("PONI_TEST_ENGINE_PORT").parse().unwrap();
        let bytes = std::fs::read(std::env::var("PONI_TEST_PCM").expect("PONI_TEST_PCM")).unwrap();
        let samples: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        let (tx, rx) = channel();
        let log = SessionLog::default();
        log.lock().unwrap().begin();
        let svc = CaptureService::spawn(EventSink::new(tx), port, "en".into(), "en".into(), log.clone(), Latency::default(), move |c| {
            offer(&c.slot, &c.wake, Job { audio: samples, side: None, last: true });
            let _ = c.stop.recv_timeout(Duration::from_secs(120));
        })
        .unwrap();
        let t0 = Instant::now();
        let mut states = Vec::new();
        let mut heard = false;
        while t0.elapsed() < Duration::from_secs(100) && !heard {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(AppEvent::Capture(CaptureEvent::Heard)) => heard = true,
                Ok(AppEvent::Capture(CaptureEvent::State(s))) => states.push(format!("{s:?}")),
                _ => {}
            }
        }
        drop(svc);
        let lines = log.lock().unwrap().lines();
        for l in &lines {
            eprintln!("line: {} | {}", l.source, l.translation);
        }
        eprintln!("heard after {:.1}s; states {states:?}", t0.elapsed().as_secs_f32());
        assert!(heard && !lines.is_empty(), "the engine returned no caption");
    }
}

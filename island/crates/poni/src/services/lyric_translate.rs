//! Translates a synced song once through the engine's `POST /translate` and
//! keeps the result next to the lyrics cache (`poni_core::lyric_tr`), so the
//! pill's second row never waits on the engine while a line is sung. One
//! worker thread, one song at a time: a newer song drops the older one's
//! remaining lines. Lines arrive in the UI as they are translated (every few
//! lines), the first ones before the singer reaches them.

use crate::events::{AppEvent, EventSink};
use poni_core::helper;
use poni_core::lyric_tr::{self, Cache, TrState};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// Lines between updates to the pill.
const BATCH: usize = 3;
/// One line on a cold CPU model can take seconds; a model still loading longer.
const WAIT: Duration = Duration::from_secs(40);

pub struct Job {
    pub track_key: String,
    pub lines: Vec<String>,
    /// The song's language (`None`: the engine detects it).
    pub src: Option<&'static str>,
    pub tgt: String,
    pub port: u16,
    /// Line index at the current playback timestamp, so lines around the playhead are translated first.
    pub start_index: usize,
}

#[derive(Default)]
struct Shared {
    next: Mutex<Option<Job>>,
    wake: Condvar,
    /// Track the worker should be on; a job for another one stops early.
    newest: Mutex<String>,
    /// Playhead line index; updated on seek so the worker translates from the new timestamp first.
    cursor: AtomicUsize,
    shutdown: Mutex<bool>,
}

pub struct LyricTranslateService {
    shared: Arc<Shared>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl LyricTranslateService {
    pub fn start(sink: EventSink) -> std::io::Result<Self> {
        let shared = Arc::new(Shared::default());
        let s = shared.clone();
        let thread = std::thread::Builder::new().name("poni-lyric-translate".into()).spawn(move || main(s, sink))?;
        Ok(Self { shared, thread: Some(thread) })
    }

    /// Queue `job` (UI thread safe); replaces one still waiting.
    pub fn request(&self, job: Job) {
        self.shared.cursor.store(job.start_index, Ordering::Relaxed);
        *self.shared.newest.lock().unwrap() = job.track_key.clone();
        *self.shared.next.lock().unwrap() = Some(job);
        self.shared.wake.notify_one();
    }

    /// Update the priority line index when the user seeks on the video/track timeline.
    pub fn set_cursor(&self, idx: usize) {
        self.shared.cursor.store(idx, Ordering::Relaxed);
    }

    /// Stop translating the song now playing (translation switched off, new song without lyrics).
    pub fn cancel(&self) {
        self.shared.newest.lock().unwrap().clear();
        *self.shared.next.lock().unwrap() = None;
    }
}

impl Drop for LyricTranslateService {
    fn drop(&mut self) {
        *self.shared.shutdown.lock().unwrap() = true;
        self.cancel();
        self.shared.wake.notify_one();
        // Not joined: a request to a slow engine can take up to WAIT, and the UI must not wait for it.
        drop(self.thread.take());
    }
}

fn main(shared: Arc<Shared>, sink: EventSink) {
    loop {
        let job = {
            let mut next = shared.next.lock().unwrap();
            loop {
                if *shared.shutdown.lock().unwrap() {
                    return;
                }
                if let Some(j) = next.take() {
                    break j;
                }
                next = shared.wake.wait(next).unwrap();
            }
        };
        run(&shared, &sink, job);
    }
}

fn cache_path(job: &Job) -> PathBuf {
    crate::paths::lyrics_cache_dir().join(lyric_tr::cache_name(&job.track_key, &job.tgt))
}

fn run(shared: &Shared, sink: &EventSink, job: Job) {
    let current = |j: &Job| *shared.newest.lock().unwrap() == j.track_key && !*shared.shutdown.lock().unwrap();
    let send = |j: &Job, lines: Vec<String>, state: TrState| {
        if current(j) {
            sink.send(AppEvent::LyricsTr { track_key: j.track_key.clone(), tgt: j.tgt.clone(), lines, state });
        }
    };
    let path = cache_path(&job);
    if let Some(lines) = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<Cache>(&t).ok()).and_then(|c| lyric_tr::usable(c, &job.tgt, job.lines.len())) {
        return send(&job, lines, TrState::Ready);
    }
    // Asked first so no request goes out for a model that is not there (the engine would answer 409,
    // which `parse_translation` reads the same way): one quiet line, no second row, no retry.
    if crate::services::capture::translation_on_disk(job.port) == Some(false) {
        return send(&job, Vec::new(), TrState::Unavailable(lyric_tr::MODEL_MISSING.into()));
    }
    let n = job.lines.len();
    let mut out = vec![String::new(); n];
    let mut done: Vec<bool> = job.lines.iter().map(|l| l.trim().is_empty()).collect();
    send(&job, out.clone(), TrState::Working);
    let (mut since, mut failed) = (0, None);
    let path_url = lyric_tr::translate_path(job.src, &job.tgt);
    loop {
        if !current(&job) {
            return;
        }
        let cur = shared.cursor.load(Ordering::Relaxed).min(n.saturating_sub(1));
        let next_idx = (cur..n).chain(0..cur).find(|&i| !done[i]);
        let Some(i) = next_idx else {
            break;
        };
        done[i] = true;
        let line = &job.lines[i];
        let r = helper::request_bytes(job.port, "POST", &path_url, "text/plain; charset=utf-8", line.trim().as_bytes(), WAIT)
            .and_then(|(code, body)| lyric_tr::parse_translation(code, &body));
        match r {
            Ok(t) => out[i] = lyric_tr::distinct(line, &t).unwrap_or_default(),
            Err(e) => {
                failed = Some(e);
                break;
            }
        }
        since += 1;
        if since >= BATCH {
            since = 0;
            send(&job, out.clone(), TrState::Working);
        }
    }
    match failed {
        // What was translated stays; the row says why the rest is missing.
        Some(e) => {
            crate::pwarn!("lyrics translation stopped: {e}");
            send(&job, out, TrState::Unavailable(e));
        }
        None => {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            match serde_json::to_string(&Cache { tgt: job.tgt.clone(), lines: out.clone() }) {
                Ok(t) => {
                    if let Err(e) = std::fs::write(&path, t) {
                        crate::pwarn!("lyrics translation cache: cannot write {}: {e}", path.display());
                    }
                }
                Err(e) => crate::pwarn!("lyrics translation cache: {e}"),
            }
            send(&job, out, TrState::Ready);
        }
    }
}

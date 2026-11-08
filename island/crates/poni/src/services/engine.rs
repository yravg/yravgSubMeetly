//! Keeps an engine there: asks `/health` every few seconds, and when nothing
//! answers starts the installed `submeetly-engine.exe` (`poni_core::engine_link`
//! decides). An engine the island started is stopped when the island quits;
//! one that was already running (a dev helper, another island) is left alone.

use crate::events::{AppEvent, EventSink};
use poni_core::engine_link::{self, Action, EngineInfo};
use poni_core::helper;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

const EVERY: Duration = Duration::from_millis(2500);
const EXE_NAME: &str = "submeetly-engine.exe";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

enum Msg {
    /// Start now, whatever came before.
    Start,
    /// Stop the engine this island started, then start it again.
    Restart,
    Stop,
}

pub struct EngineService {
    tx: Sender<Msg>,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// `SUBMEETLY_ENGINE_EXE` (dev builds), else next to the island's own exe.
pub fn engine_exe() -> Option<std::path::PathBuf> {
    let path = match std::env::var_os("SUBMEETLY_ENGINE_EXE").filter(|v| !v.is_empty()) {
        Some(p) => std::path::PathBuf::from(p),
        None => std::env::current_exe().ok()?.parent()?.join(EXE_NAME),
    };
    path.is_file().then_some(path)
}

fn spawn(exe: &std::path::Path, port: u16) -> std::io::Result<Child> {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(exe);
    cmd.env("PORT", port.to_string()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(CREATE_NO_WINDOW);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn()
}

impl EngineService {
    pub fn start(sink: EventSink) -> std::io::Result<Self> {
        let (tx, rx) = channel::<Msg>();
        let port = helper::configured_port();
        let thread = std::thread::Builder::new().name("engine-link".into()).spawn(move || {
            let mut child: Option<Child> = None;
            let mut spawns = 0u32;
            let mut last_spawn: Option<Instant> = None;
            let mut last_info: Option<EngineInfo> = None;
            loop {
                let msg = match rx.recv_timeout(EVERY) {
                    Ok(m) => Some(m),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                };
                match msg {
                    Some(Msg::Stop) => break,
                    Some(Msg::Restart) => {
                        if let Some(mut c) = child.take() {
                            let _ = c.kill();
                            let _ = c.wait();
                        }
                        spawns = 0;
                        last_spawn = None;
                    }
                    Some(Msg::Start) => {
                        spawns = 0;
                        last_spawn = None;
                    }
                    None => {}
                }
                if child.as_mut().is_some_and(|c| c.try_wait().ok().flatten().is_some()) {
                    child = None;
                }
                let health = helper::request(port, "GET", "/health", None).ok().filter(|(code, _)| *code == 200).and_then(|(_, body)| helper::parse_health(&body));
                let exe = engine_exe();
                let action = engine_link::decide(health.is_some(), exe.is_some(), spawns, last_spawn.map(|t| t.elapsed().as_secs_f64()));
                let mut shown = action;
                if action == Action::Spawn {
                    if let Some(exe) = &exe {
                        spawns += 1;
                        last_spawn = Some(Instant::now());
                        match spawn(exe, port) {
                            Ok(c) => child = Some(c),
                            Err(e) => sink.send(AppEvent::Log(format!("engine: could not start {}: {e}", exe.display()))),
                        }
                        shown = Action::Wait;
                    }
                }
                let ext_seen = health.is_some()
                    && helper::request(port, "GET", "/app/_status.json", None).ok().filter(|(code, _)| *code == 200).is_some_and(|(_, body)| body.contains("\"extensionSeen\":true"));
                let info = EngineInfo {
                    line: engine_link::status_line(health.as_ref(), port, shown),
                    running: health.is_some(),
                    ours: health.is_some() && child.is_some(),
                    ext_seen,
                };
                if last_info.as_ref() != Some(&info) {
                    last_info = Some(info.clone());
                    sink.send(AppEvent::Engine(info));
                }
            }
            // Only an engine this island started goes with it.
            if let Some(mut c) = child.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        })?;
        Ok(Self { tx, thread: Some(thread) })
    }

    pub fn start_now(&self) {
        let _ = self.tx.send(Msg::Start);
    }

    pub fn restart(&self) {
        let _ = self.tx.send(Msg::Restart);
    }

    /// Quit: stops the engine this island started and waits for it.
    pub fn stop(mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

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
/// The extension ID of the unpacked build (the manifest "key"); the engine's
/// `web::EXTENSION_ID` is the same value.
pub const EXTENSION_ID: &str = "llhpkcjflnepbpgldhbceifjbjgcbapi";
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

/// Open `path` of the engine's own pages (Minutes as an app window) once the engine
/// answers /health (up to 15 s; after that the browser shows the honest error).
pub fn open_when_ready(path: &str) {
    let path = path.to_string();
    let _ = std::thread::Builder::new().name("engine-open".into()).spawn(move || open_now(&path));
}

/// `open_when_ready` on this thread: for the second launch, which exits after.
pub fn open_now(path: &str) {
    let port = helper::configured_port();
    for _ in 0..50 {
        if helper::request(port, "GET", "/health", None).is_ok_and(|(code, _)| code == 200) {
            break;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    let url = format!("http://127.0.0.1:{port}{path}");
    // Minutes and the app shell are the app's own windows; the setup page stays in the browser, next to chrome://extensions.
    if path == "/app/minutes.html" || path == "/app/app.html" {
        crate::shell::open_app_window(&url);
    } else {
        crate::shell::open(&url);
    }
}

/// `--open <name>` on the command line: the engine page it names.
pub fn open_arg(args: &[String]) -> Option<&'static str> {
    match args.iter().position(|a| a == "--open").and_then(|i| args.get(i + 1)).map(String::as_str) {
        Some("app") => Some("/app/app.html"),
        Some("minutes") => Some("/app/minutes.html"),
        Some("setup-extension") => Some("/app/setup-extension.html"),
        _ => None,
    }
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
                    action: shown,
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

#[cfg(test)]
mod tests {
    use super::open_arg;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn open_names_an_engine_page_and_nothing_else() {
        assert_eq!(open_arg(&a(&["poni.exe", "--open", "minutes"])), Some("/app/minutes.html"));
        assert_eq!(open_arg(&a(&["poni.exe", "--open", "app"])), Some("/app/app.html"));
        assert_eq!(open_arg(&a(&["poni.exe", "--open", "setup-extension"])), Some("/app/setup-extension.html"));
        assert_eq!(open_arg(&a(&["poni.exe", "--open", "../x"])), None);
        assert_eq!(open_arg(&a(&["poni.exe", "--open"])), None);
        assert_eq!(open_arg(&a(&["poni.exe"])), None);
    }
}
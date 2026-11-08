//! The Native Messaging host drives a real engine process: status, stop,
//! start, restart and the lab probe. Replaces the Python messaging_host tests.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const BIN: &str = env!("CARGO_BIN_EXE_submeetly-engine");

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind")
        .local_addr()
        .expect("addr")
        .port()
}

fn state_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("submeetly-nh-{label}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("state dir");
    dir
}

fn host_command(port: u16, state: &PathBuf) -> Command {
    let mut command = Command::new(BIN);
    command
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("YSM_STATE_DIR", state)
        .env("NATIVE_START_WAIT", "20")
        .env("NATIVE_PORT_FREE_WAIT", "10");
    command
}

/// One frame in, one frame out, through the real `native-host` process.
fn ask(port: u16, state: &PathBuf, message: Value) -> Value {
    let mut child = host_command(port, state)
        .arg("native-host")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn host");
    let payload = serde_json::to_vec(&message).expect("json");
    let mut stdin = child.stdin.take().expect("stdin");
    stdin
        .write_all(&(payload.len() as u32).to_le_bytes())
        .expect("len");
    stdin.write_all(&payload).expect("payload");
    drop(stdin);
    // Read one frame, not to EOF: a detached engine the host started inherits
    // the host's stdout handle on Windows, so the pipe stays open while it lives.
    let mut stdout = child.stdout.take().expect("stdout");
    let mut header = [0u8; 4];
    stdout.read_exact(&mut header).expect("header");
    let mut body = vec![0u8; u32::from_le_bytes(header) as usize];
    stdout.read_exact(&mut body).expect("body");
    child.wait().expect("wait");
    serde_json::from_slice(&body).expect("reply json")
}

fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(300)).is_ok()
}

fn wait_for(what: &str, mut ok: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("timeout: {what}");
}

struct Engine(Child);
impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn host_controls_a_real_engine_through_its_whole_lifecycle() {
    let port = free_port();
    let state = state_dir("life");

    // Nothing listens yet: ping still answers at once, status says not running.
    let ping = ask(port, &state, json!({ "action": "ping" }));
    assert_eq!(ping["connected"], json!(true));
    assert_eq!(ping["helper_port_open"], json!(false));
    let status = ask(port, &state, json!({ "action": "status" }));
    assert_eq!(status["ok"], json!(true));
    assert_eq!(status["running"], json!(false));
    assert_eq!(status["health"], Value::Null);

    // start spawns a detached engine and returns its /health.
    let started = ask(port, &state, json!({ "action": "start" }));
    assert_eq!(started["ok"], json!(true), "{started}");
    assert_eq!(started["running"], json!(true));
    assert_eq!(started["health"]["ok"], json!(true));
    assert!(
        state.join("engine.log").exists(),
        "log file in the state dir"
    );

    // A second start is a no-op.
    let again = ask(port, &state, json!({ "action": "start" }));
    assert_eq!(again["already"], json!(true));

    let status = ask(port, &state, json!({ "action": "status" }));
    assert_eq!(status["running"], json!(true));
    assert_eq!(status["health"]["ok"], json!(true));

    // The lab is a dev server: with none running ensure_lab says so, not ok.
    let lab = ask(port, &state, json!({ "action": "ensure_lab" }));
    assert_eq!(lab["running"], json!(true));
    assert_eq!(lab["lab"], json!(false));

    // restart = stop + start.
    let restarted = ask(port, &state, json!({ "action": "restart" }));
    assert_eq!(restarted["ok"], json!(true), "{restarted}");
    assert_eq!(restarted["running"], json!(true));

    // stop frees the port.
    let stopped = ask(port, &state, json!({ "action": "stop" }));
    assert_eq!(stopped["ok"], json!(true), "{stopped}");
    assert_eq!(stopped["running"], json!(false));
    wait_for("port free", || !port_open(port));
    let lab = ask(port, &state, json!({ "action": "ensure_lab" }));
    assert_eq!(lab["ok"], json!(false));
    assert_eq!(lab["error"], json!("native helper not running"));
}

#[test]
fn start_reports_an_engine_that_dies_at_once() {
    // A non-loopback HOST makes the engine exit with status 2 before it listens.
    let port = free_port();
    let state = state_dir("dies");
    // A held port: the host sees a non-engine program there and refuses.
    let blocker = TcpListener::bind(("127.0.0.1", port)).expect("hold the port");
    let reply = ask(port, &state, json!({ "action": "start" }));
    drop(blocker);
    assert_eq!(reply["ok"], json!(false), "{reply}");
    assert_eq!(reply["running"], json!(false));
    // Port held by a non-engine program: refuse instead of fighting for it.
    assert!(
        reply["error"].as_str().unwrap_or("").contains("port"),
        "{reply}"
    );
}

#[test]
fn a_plain_engine_serves_while_the_host_is_absent() {
    // Guard for the child handling in this file: Engine kills on drop.
    let port = free_port();
    let state = state_dir("plain");
    let child = host_command(port, &state)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("engine");
    let _engine = Engine(child);
    wait_for("engine listens", || port_open(port));
    let status = ask(port, &state, json!({ "action": "status" }));
    assert_eq!(status["running"], json!(true));
}

#[test]
fn chrome_launch_argument_starts_the_host() {
    // Chrome runs the manifest path with the caller origin as its only argument.
    let port = free_port();
    let state = state_dir("chrome");
    let mut child = host_command(port, &state)
        .arg("chrome-extension://abcdefghijklmnopabcdefghijklmnop/")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn host");
    let payload = br#"{"action":"ping"}"#;
    let mut stdin = child.stdin.take().expect("stdin");
    stdin
        .write_all(&(payload.len() as u32).to_le_bytes())
        .expect("len");
    stdin.write_all(payload).expect("payload");
    drop(stdin);
    let mut stdout = child.stdout.take().expect("stdout");
    let mut header = [0u8; 4];
    stdout.read_exact(&mut header).expect("header");
    let mut body = vec![0u8; u32::from_le_bytes(header) as usize];
    stdout.read_exact(&mut body).expect("body");
    child.wait().expect("wait");
    let reply: Value = serde_json::from_slice(&body).expect("json");
    assert_eq!(reply["connected"], json!(true));
}

#[test]
fn refuses_a_non_loopback_bind_without_allow_remote() {
    let port = free_port();
    let state = state_dir("remote");
    let out = host_command(port, &state)
        .env("HOST", "0.0.0.0")
        .env_remove("ALLOW_REMOTE")
        .stdin(Stdio::null())
        .output()
        .expect("run engine");
    assert_eq!(out.status.code(), Some(2));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("bukan loopback") && err.contains("ALLOW_REMOTE=1"),
        "{err}"
    );
}

//! Chrome Native Messaging host: 4-byte little-endian length framing + `ping`.
//!
//! Actions: `ping` (instant, never waits on the HTTP helper), `status`, `start`,
//! `stop`, `restart`, `ensure_lab`. `start` launches this same executable without
//! arguments (the HTTP helper), detached, logging to `engine.log` in the state dir.

use std::env;
use std::fs::OpenOptions;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const HOST_NAME: &str = "com.yraveragesubmin.helper";
const HOST_PROTOCOL: i64 = 1;

pub fn run() -> io::Result<()> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    while let Some(payload) = read_frame(&mut input)? {
        let reply = match serde_json::from_slice::<Value>(&payload) {
            Ok(message) => handle_message(&message),
            Err(error) => json!({ "ok": false, "error": error.to_string() }),
        };
        write_frame(&mut output, &reply)?;
    }
    Ok(())
}

pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_le_bytes(header) as usize;
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

pub fn write_frame(writer: &mut impl Write, value: &Value) -> io::Result<()> {
    let payload = serde_json::to_vec(value)?;
    let length = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "message too large"))?;
    writer.write_all(&length.to_le_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()
}

pub fn handle_message(message: &Value) -> Value {
    let action = message.get("action").and_then(Value::as_str).unwrap_or("");
    match action {
        // Instant answer: never waits on the HTTP helper, so it also works as a
        // bridge liveness check when the helper itself is down.
        "ping" => json!({
            "ok": true,
            "connected": true,
            "host": host_info(),
            "helper_port_open": helper_port_open(),
        }),
        "status" => {
            let health = health();
            json!({
                "ok": true,
                "running": health.is_some(),
                "health": health,
                "connected": true,
                "host": host_info(),
            })
        }
        "start" => start_server(),
        "stop" => {
            let ok = force_stop();
            json!({ "ok": ok, "running": health().is_some() })
        }
        "restart" => {
            force_stop();
            start_server()
        }
        // The lab is a dev static server (scripts/lab-server.py); the engine
        // only reports whether it answers, it never launches Python.
        "ensure_lab" => match health() {
            None => {
                json!({ "ok": false, "error": "native helper not running", "lab": lab_running() })
            }
            Some(health) => {
                let lab = lab_running();
                json!({ "ok": lab, "lab": lab, "running": true, "health": health })
            }
        },
        other => json!({ "ok": false, "error": format!("unknown action: {other}") }),
    }
}

/// Seconds to wait for a freshly started engine to answer `/health`.
fn start_wait() -> Duration {
    Duration::from_secs(env_secs("NATIVE_START_WAIT", 30))
}

fn port_free_wait() -> Duration {
    Duration::from_secs(env_secs("NATIVE_PORT_FREE_WAIT", 15))
}

fn env_secs(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// One HTTP exchange with the engine, `Connection: close`. Body of a 2xx only.
fn http(method: &str, host: &str, port: u16, path: &str, timeout: Duration) -> Option<String> {
    let target = format!("{host}:{port}").to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&target, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut raw = Vec::new();
    // A read timeout after the response arrived still leaves usable bytes.
    let _ = stream.read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (head, body) = text.split_once("\r\n\r\n")?;
    head.starts_with("HTTP/1.1 2").then(|| body.to_string())
}

fn health() -> Option<Value> {
    let body = http(
        "GET",
        &host(),
        port(),
        "/health",
        Duration::from_millis(1500),
    )?;
    serde_json::from_str(&body).ok()
}

fn lab_running() -> bool {
    let lab_port = env_secs("LAB_PORT", 8799) as u16;
    http(
        "GET",
        "127.0.0.1",
        lab_port,
        "/lab.html",
        Duration::from_millis(1500),
    )
    .is_some()
}

fn wait_port_free(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !helper_port_open() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    !helper_port_open()
}

/// Ask the engine to exit; on macOS/Linux fall back to SIGTERM on whatever
/// still holds the port (a hung helper, or an older one without `/shutdown`).
fn force_stop() -> bool {
    let _ = http("POST", &host(), port(), "/shutdown", Duration::from_secs(3));
    if wait_port_free(port_free_wait()) {
        return true;
    }
    #[cfg(unix)]
    if let Ok(found) = Command::new("lsof")
        .args(["-ti", &format!("tcp:{}", port())])
        .stderr(Stdio::null())
        .output()
    {
        for pid in String::from_utf8_lossy(&found.stdout).split_whitespace() {
            let _ = Command::new("kill").arg(pid).status();
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    wait_port_free(Duration::from_secs(8))
}

fn log_path() -> PathBuf {
    crate::state::default_state_dir().join("engine.log")
}

fn log_tail(lines: usize) -> String {
    let text = std::fs::read_to_string(log_path()).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

fn spawn_engine() -> io::Result<Child> {
    let log = log_path();
    if let Some(dir) = log.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let out = OpenOptions::new().create(true).append(true).open(&log)?;
    let err = out.try_clone()?;
    let mut command = Command::new(env::current_exe()?);
    command.stdin(Stdio::null()).stdout(out).stderr(err);
    // Detach so the engine outlives the short-lived native host that started it.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        command.creation_flags(0x0000_0008 | 0x0000_0200 | 0x0800_0000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.spawn()
}

fn start_server() -> Value {
    if let Some(health) = health() {
        return json!({ "ok": true, "running": true, "health": health, "already": true });
    }
    if helper_port_open() && !force_stop() {
        return json!({ "ok": false, "running": false, "error": "port is held by another program" });
    }
    let mut child = match spawn_engine() {
        Ok(child) => child,
        Err(error) => {
            return json!({ "ok": false, "running": false, "error": format!("cannot start engine: {error}") })
        }
    };
    let deadline = Instant::now() + start_wait();
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(250));
        if let Some(health) = health() {
            return json!({ "ok": true, "running": true, "health": health });
        }
        if let Ok(Some(_)) = child.try_wait() {
            let mut error = "helper process exited early".to_string();
            let tail = log_tail(8);
            if !tail.is_empty() {
                error += &format!(" — see engine.log:\n{tail}");
            }
            return json!({ "ok": false, "running": false, "error": error });
        }
    }
    let mut error = format!("timeout waiting for helper ({}s)", start_wait().as_secs());
    let tail = log_tail(8);
    if !tail.is_empty() {
        error += &format!(" — see engine.log:\n{tail}");
    }
    json!({ "ok": false, "running": false, "error": error })
}

fn host_info() -> Value {
    json!({
        "host": HOST_NAME,
        "protocol": HOST_PROTOCOL,
        "rust": env!("CARGO_PKG_VERSION"),
        "platform": env::consts::OS,
        "root": root_dir(),
        "port": port(),
    })
}

fn root_dir() -> String {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
        .map(|path| path.display().to_string())
        .unwrap_or_default()
}

fn host() -> String {
    env::var("HOST")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn port() -> u16 {
    env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(17865)
}

fn helper_port_open() -> bool {
    let address = format!("{}:{}", host(), port());
    let Ok(mut addresses) = address.to_socket_addrs() else {
        return false;
    };
    let Some(target) = addresses.next() else {
        return false;
    };
    TcpStream::connect_timeout(&target, Duration::from_millis(350)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn framing_roundtrip_and_ping() {
        let message = json!({ "action": "ping" });
        let mut buffer = Vec::new();
        write_frame(&mut buffer, &message).expect("write");
        let declared = u32::from_le_bytes(buffer[..4].try_into().expect("header")) as usize;
        assert_eq!(declared, buffer.len() - 4, "length prefix matches payload");

        let mut cursor = Cursor::new(buffer);
        let payload = read_frame(&mut cursor).expect("read").expect("frame");
        let parsed: Value = serde_json::from_slice(&payload).expect("json");
        let reply = handle_message(&parsed);
        assert_eq!(reply["ok"], json!(true));
        assert_eq!(reply["connected"], json!(true));
        assert_eq!(reply["host"]["host"], json!(HOST_NAME));
        assert_eq!(reply["host"]["protocol"], json!(HOST_PROTOCOL));
    }

    #[test]
    fn unknown_action_is_reported_and_eof_is_none() {
        let reply = handle_message(&json!({ "action": "frobnicate" }));
        assert_eq!(reply["ok"], json!(false));
        assert_eq!(reply["error"], json!("unknown action: frobnicate"));

        let mut empty = Cursor::new(Vec::new());
        assert!(read_frame(&mut empty).expect("read").is_none());
    }
}

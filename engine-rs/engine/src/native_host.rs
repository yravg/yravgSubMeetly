//! Chrome Native Messaging host: 4-byte little-endian length framing + `ping`.
//!
//! Mirrors native/messaging_host.py framing and the `ping` reply. Start/stop
//! actions stay with the Python oracle until the Rust engine owns the ML routes.

use std::env;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::time::Duration;

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
        other => json!({ "ok": false, "error": format!("unknown action: {other}") }),
    }
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
        let reply = handle_message(&json!({ "action": "start" }));
        assert_eq!(reply["ok"], json!(false));
        assert_eq!(reply["error"], json!("unknown action: start"));

        let mut empty = Cursor::new(Vec::new());
        assert!(read_frame(&mut empty).expect("read").is_none());
    }
}

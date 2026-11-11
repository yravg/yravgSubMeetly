//! The real engine process on a free port: webhooks (signature, events, retries), the MCP
//! server on stdio driven by a scripted client, and the CLI. No model is needed.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use submeetly_engine::client::Client;
use submeetly_engine::integrations::signature;

const BIN: &str = env!("CARGO_BIN_EXE_submeetly-engine");

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct Engine {
    child: Child,
    port: u16,
}

impl Engine {
    fn start(state: &std::path::Path) -> Engine {
        let port = free_port();
        let child = Command::new(BIN)
            .env("PORT", port.to_string())
            .env("YSM_STATE_DIR", state)
            .env("WEBHOOK_BACKOFF_MS", "50,50,50")
            .env("HF_ENDPOINT", "http://127.0.0.1:9")
            .env("HF_HOME", state.join("hf"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("engine starts");
        let engine = Engine { child, port };
        let client = engine.client();
        let until = Instant::now() + Duration::from_secs(30);
        while client.get("/health").is_err() {
            assert!(Instant::now() < until, "the engine never answered");
            std::thread::sleep(Duration::from_millis(100));
        }
        engine
    }
    fn client(&self) -> Client {
        Client::new(&format!("http://127.0.0.1:{}", self.port)).unwrap()
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// One request a receiver saw.
#[derive(Debug)]
struct Seen {
    headers: Vec<(String, String)>,
    body: String,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// A receiver that answers with the next status of `answers` (the last one repeats).
fn receiver(answers: Vec<u16>) -> (u16, Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        for (n, stream) in listener.incoming().enumerate() {
            let Ok(mut stream) = stream else { break };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            let mut headers = Vec::new();
            let mut length = 0usize;
            reader.read_line(&mut line).unwrap();
            loop {
                let mut h = String::new();
                reader.read_line(&mut h).unwrap();
                let h = h.trim_end();
                if h.is_empty() {
                    break;
                }
                if let Some((k, v)) = h.split_once(':') {
                    if k.eq_ignore_ascii_case("content-length") {
                        length = v.trim().parse().unwrap();
                    }
                    headers.push((k.to_string(), v.trim().to_string()));
                }
            }
            let mut body = vec![0u8; length];
            reader.read_exact(&mut body).unwrap();
            let status = *answers.get(n).or(answers.last()).unwrap();
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = tx.send(Seen {
                headers,
                body: String::from_utf8(body).unwrap(),
            });
        }
    });
    (port, rx)
}

fn temp_state(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("sm-int-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn note(id: &str) -> Value {
    json!({ "note": {
        "id": id, "title": "Budget review", "date": "2026-11-01", "summary": "We agreed the Q4 budget.",
        "decisions": ["Freeze hiring"],
        "actions": [{ "id": "a1", "text": "Send the deck", "owner": "Rina", "status": "open" }],
        "transcript": [{ "t0": 5.0, "t1": 9.0, "source": "Let us talk about hiring", "translation": "" }],
    } })
}

#[test]
fn webhooks_are_signed_filtered_and_retried() {
    let state = temp_state("hooks");
    let engine = Engine::start(&state);
    let c = engine.client();
    let (port, seen) = receiver(vec![200]);
    let added = c
        .post(
            "/integrations/webhooks",
            &json!({ "url": format!("http://127.0.0.1:{port}/in"), "secret": "topsecret" }),
        )
        .unwrap();
    let id = added["webhook"]["id"].as_str().unwrap().to_string();
    // Another hook wants only meeting.saved and its receiver fails twice first (retry).
    let (flaky_port, flaky) = receiver(vec![503, 500, 200]);
    c.post(
        "/integrations/webhooks",
        &json!({ "url": format!("http://127.0.0.1:{flaky_port}/x"), "events": ["meeting.saved"] }),
    )
    .unwrap();
    // Bad input is refused, not stored.
    assert!(c
        .post(
            "/integrations/webhooks",
            &json!({ "url": "file:///etc/passwd" })
        )
        .is_err());
    let listed = c.get("/integrations/webhooks").unwrap().to_string();
    assert!(!listed.contains("topsecret"));

    c.post("/notes", &note("M-1")).unwrap();

    let a = seen
        .recv_timeout(Duration::from_secs(10))
        .expect("first delivery");
    let b = seen
        .recv_timeout(Duration::from_secs(10))
        .expect("second delivery");
    let (saved, actions) = if a.header("X-Submeetly-Event") == Some("meeting.saved") {
        (a, b)
    } else {
        (b, a)
    };
    assert_eq!(saved.header("X-Submeetly-Event"), Some("meeting.saved"));
    assert_eq!(
        actions.header("X-Submeetly-Event"),
        Some("action_items.created")
    );
    // The signature is the HMAC-SHA256 of the exact body, keyed by the secret.
    assert_eq!(
        saved.header("X-Submeetly-Signature"),
        Some(signature("topsecret", saved.body.as_bytes()).as_str())
    );
    let body: Value = serde_json::from_str(&saved.body).unwrap();
    assert_eq!(body["event"], "meeting.saved");
    assert_eq!(body["data"]["note"]["id"], "M-1");
    let items: Value = serde_json::from_str(&actions.body).unwrap();
    assert_eq!(items["data"]["actions"][0]["text"], "Send the deck");
    assert_eq!(items["data"]["noteId"], "M-1");

    // The flaky receiver got three tries of meeting.saved and never the action items.
    for _ in 0..3 {
        let s = flaky.recv_timeout(Duration::from_secs(10)).expect("retry");
        assert_eq!(s.header("X-Submeetly-Event"), Some("meeting.saved"));
        assert!(
            s.header("X-Submeetly-Signature").is_none(),
            "no secret, no signature"
        );
    }
    assert!(flaky.recv_timeout(Duration::from_millis(500)).is_err());

    // Saving the same note again creates no new action items: only meeting.saved goes out.
    c.post("/notes", &note("M-1")).unwrap();
    let again = seen.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(again.header("X-Submeetly-Event"), Some("meeting.saved"));
    assert!(seen.recv_timeout(Duration::from_millis(500)).is_err());

    // The test route sends a ping and says how it went; the list shows the last delivery.
    let test = c
        .post("/integrations/webhooks/test", &json!({ "id": id }))
        .unwrap();
    assert_eq!(test["ok"], true);
    let ping = seen.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(ping.header("X-Submeetly-Event"), Some("ping"));
    let list = c.get("/integrations/webhooks").unwrap();
    let hook = list["webhooks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(hook["last"]["ok"], true);

    // Disabled hooks hear nothing; a removed one is gone.
    c.post(
        "/integrations/webhooks",
        &json!({ "id": id, "enabled": false }),
    )
    .unwrap();
    c.post("/notes", &note("M-2")).unwrap();
    assert!(seen.recv_timeout(Duration::from_millis(700)).is_err());
    c.post(
        "/integrations/webhooks",
        &json!({ "id": id, "remove": true }),
    )
    .unwrap();
    assert!(c
        .post("/integrations/webhooks/test", &json!({ "id": id }))
        .is_err());
    let _ = std::fs::remove_dir_all(state);
}

fn mcp_session(engine: &Engine, lines: &[Value]) -> Vec<Value> {
    let mut child = Command::new(BIN)
        .arg("mcp")
        .env("PORT", engine.port.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    {
        let mut stdin = child.stdin.take().unwrap();
        for l in lines {
            writeln!(stdin, "{l}").unwrap();
        }
    } // stdin closes: the server ends after answering
    let mut out = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut out)
        .unwrap();
    assert!(child.wait().unwrap().success());
    out.lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

fn tool(id: u64, name: &str, args: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": name, "arguments": args } })
}

fn text_of(reply: &Value) -> String {
    reply["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn an_mcp_client_reads_searches_and_writes_meetings() {
    let state = temp_state("mcp");
    let engine = Engine::start(&state);
    engine.client().post("/notes", &note("M-7")).unwrap();
    let replies = mcp_session(
        &engine,
        &[
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": { "name": "test", "version": "0" } } }),
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
            tool(3, "list_meetings", json!({})),
            tool(4, "get_meeting", json!({ "id": "M-7" })),
            tool(5, "search_meetings", json!({ "query": "hiring" })),
            tool(6, "get_transcript", json!({ "id": "M-7" })),
            tool(7, "list_action_items", json!({})),
            tool(
                8,
                "create_note",
                json!({ "title": "From the assistant", "summary": "Hello", "actions": [{ "text": "Follow up", "owner": "Bo" }] }),
            ),
            tool(9, "get_meeting", json!({ "id": "nope" })),
            json!({ "jsonrpc": "2.0", "id": 10, "method": "resources/list" }),
            json!({ "jsonrpc": "2.0", "id": 11, "method": "resources/read", "params": { "uri": "submeetly://meeting/M-7" } }),
            tool(12, "ask", json!({ "question": "What did we decide?" })),
        ],
    );
    assert_eq!(replies.len(), 12, "the notification gets no answer");
    assert_eq!(replies[0]["result"]["serverInfo"]["name"], "yravgsubmeetly");
    assert_eq!(replies[1]["result"]["tools"].as_array().unwrap().len(), 7);
    assert!(text_of(&replies[2]).contains("Budget review"));
    let meeting: Value = serde_json::from_str(&text_of(&replies[3])).unwrap();
    assert_eq!(meeting["decisions"][0], "Freeze hiring");
    assert!(text_of(&replies[4]).contains("M-7"));
    assert!(text_of(&replies[5]).starts_with("[00:05] Let us talk about hiring"));
    assert!(text_of(&replies[6]).contains("Send the deck"));
    assert!(text_of(&replies[7]).contains("From the assistant"));
    // The note the assistant wrote is really in the engine.
    assert_eq!(engine.client().notes().unwrap().len(), 2);
    assert_eq!(replies[8]["result"]["isError"], true);
    assert!(text_of(&replies[8]).contains("not found"));
    assert!(replies[9]["result"]["resources"][0]["uri"]
        .as_str()
        .unwrap()
        .starts_with("submeetly://meeting/"));
    assert!(replies[10]["result"]["contents"][0]["text"]
        .as_str()
        .unwrap()
        .contains("Budget review"));
    // No model on this machine: ask is an error result that says why, not a crash.
    assert_eq!(replies[11]["result"]["isError"], true);
    let _ = std::fs::remove_dir_all(state);
}

fn cli(engine: &Engine, args: &[&str]) -> (i32, String, String) {
    let out = Command::new(BIN)
        .arg("cli")
        .args(args)
        .env("PORT", engine.port.to_string())
        .output()
        .unwrap();
    (
        out.status.code().unwrap(),
        String::from_utf8_lossy(&out.stdout).into(),
        String::from_utf8_lossy(&out.stderr).into(),
    )
}

#[test]
fn the_cli_lists_shows_searches_exports_and_manages_webhooks() {
    let state = temp_state("cli");
    let engine = Engine::start(&state);
    engine.client().post("/notes", &note("M-9")).unwrap();

    let (code, out, _) = cli(&engine, &["list"]);
    assert_eq!(code, 0);
    assert!(
        out.starts_with("M-9\t2026-11-01\tBudget review\t1 decisions, 1 actions"),
        "{out}"
    );
    let (_, json_out, _) = cli(&engine, &["list", "--json"]);
    assert_eq!(
        serde_json::from_str::<Value>(&json_out).unwrap()["meetings"][0]["id"],
        "M-9"
    );
    assert!(cli(&engine, &["show", "M-9"]).1.contains("Freeze hiring"));
    assert!(cli(&engine, &["transcript", "M-9"])
        .1
        .contains("[00:05] Let us talk about hiring"));
    assert!(cli(&engine, &["search", "deck"])
        .1
        .contains("action: Send the deck"));
    assert!(cli(&engine, &["actions"]).1.contains("Send the deck"));
    let file = state.join("out.md");
    assert_eq!(
        cli(
            &engine,
            &[
                "export",
                "M-9",
                "--format",
                "md",
                "--out",
                file.to_str().unwrap()
            ]
        )
        .0,
        0
    );
    assert!(std::fs::read_to_string(&file)
        .unwrap()
        .contains("Budget review"));
    assert_eq!(cli(&engine, &["show", "nope"]).0, 1);
    assert_eq!(cli(&engine, &["bogus"]).0, 2);

    let (port, seen) = receiver(vec![200]);
    let (code, out, _) = cli(
        &engine,
        &[
            "webhook",
            "add",
            &format!("http://127.0.0.1:{port}/cli"),
            "--secret",
            "k",
        ],
    );
    assert_eq!(code, 0, "{out}");
    let id = serde_json::from_str::<Value>(&out).unwrap()["webhook"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(cli(&engine, &["webhook", "test", &id]).0, 0);
    let ping = seen.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(
        ping.header("X-Submeetly-Signature"),
        Some(signature("k", ping.body.as_bytes()).as_str())
    );
    assert!(cli(&engine, &["webhook", "list"]).1.contains(&id));
    assert_eq!(cli(&engine, &["webhook", "remove", &id]).0, 0);

    // With the engine gone the CLI says so and exits 1.
    drop(engine);
    let dead = Command::new(BIN)
        .arg("cli")
        .arg("list")
        .env("PORT", "9")
        .output()
        .unwrap();
    assert_eq!(dead.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&dead.stderr).contains("not answering"));
    let _ = std::fs::remove_dir_all(state);
}

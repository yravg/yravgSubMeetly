//! Starts the real Python helper (native/server.py) on a free loopback port
//! with a fixture state dir and checks that the island's client reads it and
//! that a decision round-trips. Skipped (with a message) when no Python with
//! the helper's dependencies is found: set `YSM_PYTHON` to pick one.

use poni_core::helper::{self, Decision};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const NOTES: &str = r#"{"notes":[
 {"id":"MOM-1","title":"Weekly sync","date":"2026-11-08","status":"ready",
  "decisions":[],"actions":[],
  "meeting":{"attendees":["Alya","Budi"],"agenda":{"total":4,"covered":1}},
  "items":[{"ref":"D-1","type":"decision","text":"Ship Friday","review":"ai","status":"open"},
           {"ref":"A-1","type":"action","text":"Send deck","owner":"Alya","status":"open","review":"accepted"}],
  "transcript":[{"t0":0,"t1":2,"source":"hello","translation":"halo"}]}]}"#;

struct Guard(Child);
impl Drop for Guard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn island_reads_and_writes_the_real_helper() {
    let server = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../native/server.py");
    if !server.is_file() {
        eprintln!("skip: {} not found", server.display());
        return;
    }
    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let dir = std::env::temp_dir().join(format!("island-smoke-{port}"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("notes.json"), NOTES).unwrap();
    let py = std::env::var("YSM_PYTHON").unwrap_or_else(|_| "python".into());
    let child = Command::new(&py)
        .arg(&server)
        .env("PORT", port.to_string())
        .env("YSM_STATE_DIR", &dir)
        .env("PYTHONUTF8", "1")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let Ok(child) = child else {
        eprintln!("skip: cannot start {py}");
        return;
    };
    let _guard = Guard(child);
    let start = Instant::now();
    let snap = loop {
        match helper::fetch(port) {
            Ok(s) => break s,
            Err(_) if start.elapsed() < Duration::from_secs(20) => std::thread::sleep(Duration::from_millis(250)),
            Err(e) => {
                eprintln!("skip: helper did not come up ({e}); set YSM_PYTHON to a Python with its dependencies");
                return;
            }
        }
    };
    assert_eq!(snap.notes.len(), 1);
    let n = &snap.notes[0];
    assert_eq!((n.title.as_str(), n.items.len(), n.transcript.len()), ("Weekly sync", 2, 1));
    assert_eq!(helper::captions(n, None).current, "hello");

    let body = helper::decide(n, "D-1", Decision::Accept).expect("body");
    helper::post_note(port, &body).expect("post");
    let again = helper::fetch(port).unwrap();
    let d1 = again.notes[0].items.iter().find(|i| i.rf == "D-1").unwrap();
    assert_eq!(d1.review, helper::Review::Accepted);
    let _ = std::fs::remove_dir_all(&dir);
}

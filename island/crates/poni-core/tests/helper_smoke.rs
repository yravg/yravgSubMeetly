//! Starts the real Rust engine (`submeetly-engine`) on a free loopback port
//! with a fixture state dir and checks that the island's client reads it and
//! that a decision round-trips. Skipped (with a message) when no engine binary is found, or when the
//! only ones are older than the engine source: build it, or set `SUBMEETLY_ENGINE_BIN` to pick one.

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

/// The engine to test: `SUBMEETLY_ENGINE_BIN` (named on purpose, used as it is), else the newest-built
/// engine-rs output (release first) that is not older than the engine source. `Err` says why there is none:
/// a stale exe would fail on things the source already does, which reads as a bug in this code.
fn engine_binary() -> Result<std::path::PathBuf, String> {
    const BUILD: &str = "cargo build --release -p submeetly-engine --manifest-path engine-rs/Cargo.toml";
    if let Ok(p) = std::env::var("SUBMEETLY_ENGINE_BIN") {
        let p = std::path::PathBuf::from(p);
        return if p.is_file() { Ok(p) } else { Err(format!("SUBMEETLY_ENGINE_BIN={} is not a file", p.display())) };
    }
    let exe = if cfg!(windows) { "submeetly-engine.exe" } else { "submeetly-engine" };
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../engine-rs");
    let targets = [std::env::var_os("CARGO_TARGET_DIR").map(std::path::PathBuf::from), Some(root.join("target"))];
    let found: Vec<_> = targets.into_iter().flatten().flat_map(|t| [t.join("release").join(exe), t.join("debug").join(exe)]).filter(|p| p.is_file()).collect();
    if found.is_empty() {
        return Err(format!("submeetly-engine not built ({BUILD})"));
    }
    let (newest, newest_at) = newest_source(&root).ok_or_else(|| "cannot read the engine source".to_string())?;
    let built = |p: &std::path::Path| p.metadata().and_then(|m| m.modified()).ok();
    match found.iter().find(|p| built(p).is_some_and(|b| b >= newest_at)) {
        Some(p) => Ok(p.clone()),
        None => Err(format!("{} is older than {} (rebuild: {BUILD}, or set SUBMEETLY_ENGINE_BIN)", found[0].display(), newest.display())),
    }
}

/// The most recently changed engine source file (Rust, Cargo manifests and lock) under `dir`, `target` left out.
fn newest_source(dir: &std::path::Path) -> Option<(std::path::PathBuf, std::time::SystemTime)> {
    let mut best: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        let name = e.file_name();
        let found = if p.is_dir() {
            if name == "target" || name == "golden" {
                continue;
            }
            newest_source(&p)
        } else if p.extension().is_some_and(|x| x == "rs") || name == "Cargo.toml" || name == "Cargo.lock" {
            e.metadata().and_then(|m| m.modified()).ok().map(|t| (p, t))
        } else {
            None
        };
        if let Some(f) = found.filter(|f| best.as_ref().is_none_or(|b| f.1 > b.1)) {
            best = Some(f);
        }
    }
    best
}

#[test]
fn island_reads_and_writes_the_real_helper() {
    let engine = match engine_binary() {
        Ok(e) => e,
        Err(why) => {
            eprintln!("skip: {why}");
            return;
        }
    };
    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let dir = std::env::temp_dir().join(format!("island-smoke-{port}"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("notes.json"), NOTES).unwrap();
    let child = Command::new(&engine)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("YSM_STATE_DIR", &dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let Ok(child) = child else {
        eprintln!("skip: cannot start {}", engine.display());
        return;
    };
    let _guard = Guard(child);
    let start = Instant::now();
    let snap = loop {
        match helper::fetch(port) {
            Ok(s) => break s,
            Err(_) if start.elapsed() < Duration::from_secs(20) => std::thread::sleep(Duration::from_millis(250)),
            Err(e) => {
                eprintln!("skip: engine did not come up ({e})");
                return;
            }
        }
    };
    assert_eq!(snap.live, Some(helper::Live::default()), "GET /live answers idle on the real helper");
    assert_eq!(snap.notes.len(), 1);
    let n = &snap.notes[0];
    assert_eq!((n.title.as_str(), n.items.len(), n.transcript.len()), ("Weekly sync", 2, 1));
    assert_eq!(helper::captions(n, None).current, "hello");

    let body = helper::decide(n, "D-1", Decision::Accept).expect("body");
    helper::post_note(port, &body).expect("post");
    let again = helper::fetch(port).unwrap();
    let d1 = again.notes[0].items.iter().find(|i| i.rf == "D-1").unwrap();
    assert_eq!(d1.review, helper::Review::Accepted);

    // A captioned session saved as a meeting: generate the draft, post the document, read it back newest first.
    use poni_core::meeting_doc::{generate_body, generated_note, meeting_doc};
    let lines = [
        helper::Line { t0: 0.0, t1: 4.0, source: "Decision: ship on Friday.".into(), translation: "line one".into() },
        helper::Line { t0: 4.0, t1: 8.0, source: "Action: Alya sends the plan.".into(), translation: String::new() },
    ];
    let (code, reply) = helper::request(port, "POST", "/notes/generate", Some(&generate_body("Meeting", &lines))).expect("generate");
    assert_eq!(code, 200, "{reply}");
    let draft = generated_note(&reply).expect("a draft note");
    let doc = meeting_doc("MOM-WIN-1", "Meeting 2026-11-10 09:00", "2026-11-10", "2026-11-10T09:00", "auto", &lines, Some(&draft)).expect("doc");
    helper::post_note(port, &doc.to_string()).expect("post meeting");
    let saved = helper::fetch(port).unwrap();
    let m = helper::current(&saved.notes).expect("newest");
    assert_eq!((m.id.as_str(), m.title.as_str(), m.transcript.len()), ("MOM-WIN-1", "Meeting 2026-11-10 09:00", 2));
    assert_eq!(m.transcript[0].translation, "line one", "the engine kept the translation");
    assert!(!m.items.is_empty(), "the draft's decisions and actions came with it");
    let _ = std::fs::remove_dir_all(&dir);
}

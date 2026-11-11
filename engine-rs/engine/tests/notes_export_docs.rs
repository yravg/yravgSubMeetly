//! POST /notes/export in its advanced formats: Markdown (full register), DOCX and PDF come back as
//! JSON with base64 content, and what they decode to is a real zip / PDF.

use serde_json::{json, Value};
use submeetly_engine::{App, Request};

fn post(app: &App, body: Value) -> (u16, Value) {
    let request = Request {
        method: "POST".into(),
        target: "/notes/export".into(),
        headers: vec![("host".into(), "127.0.0.1:17865".into())],
        body: body.to_string().into_bytes(),
        peer_loopback: true,
        body_file: None,
    };
    let response = app.handle(&request);
    (response.status, response.body.unwrap_or(Value::Null))
}

fn unb64(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        _ => 63,
    };
    let b = s.trim_end_matches('=').as_bytes();
    let mut out = Vec::new();
    for c in b.chunks(4) {
        let n = c
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &x)| n | (val(x) as u32) << (18 - 6 * i));
        out.push((n >> 16) as u8);
        if c.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if c.len() > 3 {
            out.push(n as u8);
        }
    }
    out
}

fn app() -> App {
    let dir = std::env::temp_dir().join(format!("submeetly-export-docs-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut app = App::new(dir);
    app.set_allowed_origins(Vec::new());
    app
}

fn note() -> Value {
    json!({
        "title": "Kickoff", "id": "MOM-9", "date": "2026-11-12",
        "summary": "Agreed scope.", "decisions": ["Go"],
        "actions": [{"text": "Send the plan", "owner": "Sari", "due": "2026-11-15", "status": "open"}],
        "transcript": [{"t0": 3.0, "t1": 6.0, "source": "Hello everyone", "speaker": "Sari"}]
    })
}

#[test]
fn docx_and_pdf_come_back_as_base64() {
    let app = app();
    let (code, docx) = post(&app, json!({"note": note(), "format": "docx"}));
    assert_eq!(code, 200);
    assert_eq!(docx["filename"], "Kickoff.docx");
    assert_eq!(docx["encoding"], "base64");
    let bytes = unb64(docx["content"].as_str().unwrap());
    assert_eq!(&bytes[..4], b"PK\x03\x04");

    let (code, pdf) = post(&app, json!({"note": note(), "format": "pdf"}));
    assert_eq!(code, 200);
    assert_eq!(pdf["mime"], "application/pdf");
    let pdf_bytes = unb64(pdf["content"].as_str().unwrap());
    assert!(pdf_bytes.starts_with(b"%PDF-1.4"));
    // For checking the files with other tools: EXPORT_DOCS_OUT=<dir> cargo test ...
    if let Ok(dir) = std::env::var("EXPORT_DOCS_OUT") {
        std::fs::write(format!("{dir}/kickoff.docx"), &bytes).unwrap();
        std::fs::write(format!("{dir}/kickoff.pdf"), &pdf_bytes).unwrap();
    }
}

#[test]
fn markdown_is_the_full_register_and_md_stays_short() {
    let app = app();
    let (_, full) = post(&app, json!({"note": note(), "format": "markdown"}));
    assert_eq!(full["filename"], "Kickoff.md");
    let text = full["content"].as_str().unwrap();
    assert!(text.contains("| Action | Owner | Due | Status |"));
    assert!(text.contains("**Sari:** Hello everyone"));
    let (_, short) = post(&app, json!({"note": note(), "format": "md"}));
    assert!(!short["content"].as_str().unwrap().contains("Transcript"));
}

#[test]
fn an_unknown_format_is_refused() {
    let (code, _) = post(&app(), json!({"note": note(), "format": "rtf"}));
    assert_eq!(code, 400);
}

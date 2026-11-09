//! Route tests for the calendar: import a file, list events, make a note.
//! No network: links are only exercised through their refusals.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use submeetly_engine::ics::{iso_utc, parse_iso};
use submeetly_engine::state::now_epoch_secs;
use submeetly_engine::{App, Request};

fn app() -> App {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let state: PathBuf = std::env::temp_dir().join(format!(
        "submeetly-calendar-{}-{unique}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&state);
    fs::create_dir_all(&state).expect("state dir");
    let mut app = App::new(state);
    app.set_allowed_origins(Vec::new());
    app
}

fn call(app: &App, method: &str, target: &str, body: Value) -> (u16, Value) {
    let request = Request {
        method: method.to_string(),
        target: target.to_string(),
        headers: vec![("host".to_string(), "127.0.0.1:17865".to_string())],
        body: if body.is_null() {
            Vec::new()
        } else {
            body.to_string().into_bytes()
        },
        peer_loopback: true,
        body_file: None,
    };
    let response = app.handle(&request);
    (response.status, response.body.unwrap_or(Value::Null))
}

/// A meeting two days from now at 14:00 UTC, as ICS text and as the ISO start we expect back.
fn upcoming() -> (String, String) {
    let day = (now_epoch_secs() as i64 / 86_400 + 2) * 86_400;
    let start = iso_utc(day + 14 * 3600);
    let compact = start.replace(['-', ':'], "");
    let ics = format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:sync-1@example.com\r\nDTSTART:{compact}\r\nDURATION:PT1H\r\n\
SUMMARY:Weekly sync\r\nLOCATION:Room 4\r\nDESCRIPTION:Dial in https://meet.google.com/abc-defg-hij\r\n\
ORGANIZER;CN=Mei Lin:mailto:mei@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    );
    (ics, start)
}

fn window() -> String {
    let now = now_epoch_secs() as i64;
    format!(
        "/calendar?from={}&to={}",
        iso_utc(now),
        iso_utc(now + 5 * 86_400)
    )
}

#[test]
fn import_then_list() {
    let app = app();
    let (ics, start) = upcoming();
    let (status, body) = call(
        &app,
        "POST",
        "/calendar/sources",
        json!({ "ics": ics, "name": "team.ics" }),
    );
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["source"]["kind"], "file");
    assert_eq!(body["source"]["events"], 1);

    let (status, body) = call(&app, "GET", &window(), Value::Null);
    assert_eq!(status, 200);
    assert_eq!(body["sources"].as_array().unwrap().len(), 1);
    let ev = &body["events"][0];
    assert_eq!(ev["title"], "Weekly sync");
    assert_eq!(ev["start"], start.as_str());
    assert_eq!(
        parse_iso(ev["end"].as_str().unwrap()).unwrap() - parse_iso(&start).unwrap(),
        3600
    );
    assert_eq!(ev["joinUrl"], "https://meet.google.com/abc-defg-hij");
    assert_eq!(ev["location"], "Room 4");
    assert_eq!(ev["organizer"]["name"], "Mei Lin");
}

#[test]
fn bad_input_is_a_400_and_never_echoes_the_link() {
    let app = app();
    let (status, body) = call(
        &app,
        "POST",
        "/calendar/sources",
        json!({ "url": "http://example.com/a.ics" }),
    );
    assert_eq!(status, 400);
    assert!(body["error"].as_str().unwrap().contains("https"));
    let (status, body) = call(
        &app,
        "POST",
        "/calendar/sources",
        json!({ "url": "https://127.0.0.1/SECRETKEY/a.ics" }),
    );
    assert_eq!(status, 400);
    assert!(!body.to_string().contains("SECRETKEY"), "{body}");
    let (status, body) = call(
        &app,
        "POST",
        "/calendar/sources",
        json!({ "url": "https://localhost/SECRETKEY/a.ics" }),
    );
    assert_eq!(status, 400, "{body}");
    assert_eq!(call(&app, "POST", "/calendar/sources", json!({})).0, 400);
    assert_eq!(
        call(
            &app,
            "POST",
            "/calendar/sources",
            json!({ "ics": "<html>nope</html>" })
        )
        .0,
        400
    );
    assert_eq!(
        call(&app, "GET", "/calendar", Value::Null).1["sources"],
        json!([])
    );
}

#[test]
fn window_is_checked_and_capped() {
    let app = app();
    assert_eq!(
        call(&app, "GET", "/calendar?from=yesterday", Value::Null).0,
        400
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/calendar?from=2026-11-09&to=2026-11-01",
            Value::Null
        )
        .0,
        400
    );
    let (status, body) = call(
        &app,
        "GET",
        "/calendar?from=2026-01-01&to=2030-01-01",
        Value::Null,
    );
    assert_eq!(status, 200);
    // 2026-01-01 plus 62 days is 2026-03-04.
    assert_eq!(body["to"], "2026-03-04T00:00:00Z");
}

#[test]
fn an_event_makes_one_note_that_later_calls_keep() {
    let app = app();
    let (ics, start) = upcoming();
    call(
        &app,
        "POST",
        "/calendar/sources",
        json!({ "ics": ics, "name": "team.ics" }),
    );
    let id = call(&app, "GET", &window(), Value::Null).1["events"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let (status, made) = call(
        &app,
        "POST",
        "/calendar/notes",
        json!({ "id": id, "tzMinutes": 0 }),
    );
    assert_eq!(status, 200, "{made}");
    assert_eq!(made["created"], true);
    let note_id = format!("MOM-CAL-{id}");
    assert_eq!(made["note"]["id"], note_id.as_str());
    assert_eq!(made["note"]["title"], "Weekly sync");
    assert_eq!(made["note"]["date"], &start[..10]);
    assert_eq!(made["note"]["meeting"]["chair"], "Mei Lin");

    // The user edits the note; asking again must not overwrite it.
    let mut edited = made["note"].clone();
    edited["title"] = json!("Weekly sync (renamed)");
    assert_eq!(
        call(&app, "POST", "/notes", json!({ "note": edited })).0,
        200
    );
    let (status, again) = call(&app, "POST", "/calendar/notes", json!({ "id": id }));
    assert_eq!(status, 200);
    assert_eq!(again["created"], false);
    assert_eq!(again["note"]["title"], "Weekly sync (renamed)");
    let notes = call(&app, "GET", "/notes", Value::Null).1;
    assert_eq!(notes["notes"].as_array().unwrap().len(), 1);

    assert_eq!(
        call(
            &app,
            "POST",
            "/calendar/notes",
            json!({ "id": "000000000000" })
        )
        .0,
        404
    );
    assert_eq!(call(&app, "POST", "/calendar/notes", json!({})).0, 400);
}

#[test]
fn remove_and_refresh() {
    let app = app();
    let (ics, _) = upcoming();
    let id = call(
        &app,
        "POST",
        "/calendar/sources",
        json!({ "ics": ics, "name": "t.ics" }),
    )
    .1["source"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    // Refreshing everything with only a file in the list is a harmless no-op.
    let (status, body) = call(&app, "POST", "/calendar/refresh", json!({}));
    assert_eq!(status, 200);
    assert_eq!(body["sources"].as_array().unwrap().len(), 1);
    assert_eq!(
        call(&app, "POST", "/calendar/refresh", json!({ "id": "nope" })).0,
        404
    );

    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/calendar/sources/{id}"),
            Value::Null
        )
        .0,
        200
    );
    assert_eq!(
        call(
            &app,
            "DELETE",
            &format!("/calendar/sources/{id}"),
            Value::Null
        )
        .0,
        404
    );
    assert!(call(&app, "GET", &window(), Value::Null).1["events"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn only_this_machine_may_read_the_calendar() {
    let app = app();
    let mut request = Request {
        method: "GET".into(),
        target: "/calendar".into(),
        headers: vec![
            ("host".into(), "127.0.0.1:17865".into()),
            ("origin".into(), "https://evil.example".into()),
        ],
        body: Vec::new(),
        peer_loopback: true,
        body_file: None,
    };
    assert_eq!(
        app.handle(&request).status,
        403,
        "a web page from elsewhere is refused"
    );
    request.headers.pop();
    request.peer_loopback = false;
    assert_eq!(app.handle(&request).status, 403, "so is a remote machine");
}

use super::*;
use std::net::IpAddr;

fn ip(s: &str) -> IpAddr {
    s.parse().expect("ip")
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sm-cal-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("dir");
    dir
}

const WORK: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Work\r\n\
BEGIN:VEVENT\r\nUID:standup-1@example.com\r\nDTSTART:20261109T200000Z\r\nDTEND:20261109T203000Z\r\n\
SUMMARY:Standup\r\nLOCATION:Microsoft Teams Meeting\r\n\
DESCRIPTION:Join <https://teams.microsoft.com/l/meetup-join/abc>\r\n\
ORGANIZER;CN=Mei Lin:mailto:mei@example.com\r\nATTENDEE;CN=Dewi:mailto:dewi@example.com\r\nATTENDEE:mailto:ops@example.com\r\n\
END:VEVENT\r\nEND:VCALENDAR\r\n";

fn day(s: &str) -> i64 {
    ics::parse_iso(s).expect("iso")
}

// ------------------------------------------------------------- URL checks

#[test]
fn good_links_are_normalised() {
    assert_eq!(
        validate_url("https://calendar.example.com/ical/abc/basic.ics").as_deref(),
        Ok("https://calendar.example.com/ical/abc/basic.ics")
    );
    // webcal is https; the host is lower-cased, the secret path keeps its case, the fragment goes.
    assert_eq!(
        validate_url("webcal://Outlook.Example.com/owa/calendar/AbC/reachcalendar.ics").as_deref(),
        Ok("https://outlook.example.com/owa/calendar/AbC/reachcalendar.ics")
    );
    assert_eq!(
        validate_url("  HTTPS://Calendar.Example.COM/Secret?Key=AbC#frag ").as_deref(),
        Ok("https://calendar.example.com/Secret?Key=AbC")
    );
    assert_eq!(
        validate_url("https://example.com").as_deref(),
        Ok("https://example.com/")
    );
    assert_eq!(
        validate_url("https://example.com:443/a").as_deref(),
        Ok("https://example.com/a")
    );
    assert_eq!(
        validate_url("https://example.com./a").as_deref(),
        Ok("https://example.com/a")
    );
}

#[test]
fn bad_links_are_refused() {
    let refused = [
        "",
        "   ",
        "http://calendar.example.com/a.ics",
        "file:///etc/passwd",
        "ftp://example.com/a.ics",
        "javascript:alert(1)",
        "calendar.example.com/a.ics",
        "https://localhost/a.ics",
        "https://127.0.0.1/a.ics",
        "https://10.0.0.5/a.ics",
        "https://169.254.169.254/latest/meta-data",
        "https://[::1]/a.ics",
        "https://2130706433/a.ics",
        "https://0x7f.0.0.1/a.ics",
        "https://intranet/a.ics",
        "https://printer.local/a.ics",
        "https://wiki.internal/a.ics",
        "https://example.com:8443/a.ics",
        "https://example.com:80/a.ics",
        "https://user:pw@example.com/a.ics",
        "https://evil.example.com@127.0.0.1/a.ics",
        "https://exa mple.com/a.ics",
        "https://example.com/a\nb",
        "https://exa_mple.com/a.ics",
    ];
    for url in refused {
        assert!(validate_url(url).is_err(), "should refuse {url:?}");
    }
    let too_long = format!("https://example.com/{}", "a".repeat(MAX_URL));
    assert!(validate_url(&too_long).is_err());
    assert!(validate_url("http://calendar.example.com/a.ics")
        .unwrap_err()
        .contains("https"));
}

#[test]
fn a_masked_link_hides_the_secret() {
    let masked = mask_url("https://calendar.example.com/ical/SECRETKEY/basic.ics?x=1");
    assert_eq!(masked, "https://calendar.example.com/…");
    assert!(!masked.contains("SECRETKEY"));
}

#[test]
fn private_and_special_addresses_are_blocked() {
    for a in [
        "127.0.0.1",
        "127.9.9.9",
        "10.1.2.3",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "100.127.255.255",
        "0.0.0.0",
        "0.1.2.3",
        "224.0.0.1",
        "255.255.255.255",
        "240.0.0.1",
        "198.18.0.1",
        "192.0.2.1",
        "198.51.100.1",
        "203.0.113.1",
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "fd12:3456::1",
        "ff02::1",
        "2001:db8::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "::127.0.0.1",
        "64:ff9b::7f00:1",
    ] {
        assert!(addr_blocked(ip(a)), "{a} should be blocked");
    }
}

#[test]
fn public_addresses_pass() {
    for a in [
        "8.8.8.8",
        "93.184.216.34",
        "172.32.0.1",
        "172.15.255.255",
        "100.63.255.255",
        "100.128.0.1",
        "2606:4700:4700::1111",
        "::ffff:8.8.8.8",
        "64:ff9b::808:808",
    ] {
        assert!(!addr_blocked(ip(a)), "{a} should pass");
    }
}

#[test]
fn the_fetch_layer_refuses_private_hosts_even_without_the_url_check() {
    // `localhost` resolves to loopback: the resolver filter, not validate_url, stops it.
    let err = fetch("https://localhost/secret.ics").unwrap_err();
    assert!(err.contains("could not be reached"), "{err}");
    assert!(!err.contains("secret"), "errors never echo the link: {err}");
}

#[test]
fn plain_http_is_never_fetched() {
    let err = fetch("http://example.com/a.ics").unwrap_err();
    assert!(err.contains("secure"), "{err}");
}

#[test]
fn adding_a_bad_link_changes_nothing() {
    let cal = Calendar::new(scratch("badlink"));
    assert!(matches!(
        cal.add_link("http://example.com/a.ics"),
        Err(Fail::Bad(_))
    ));
    assert!(matches!(
        cal.add_link("https://127.0.0.1/a.ics"),
        Err(Fail::Bad(_))
    ));
    assert!(cal.sources().is_empty());
}

// ----------------------------------------------------------------- store

#[test]
fn an_imported_file_shows_its_events() {
    let cal = Calendar::new(scratch("import"));
    let src = cal
        .add_file(WORK, "C:\\Users\\me\\work.ics")
        .expect("imports");
    assert_eq!(src["kind"], "file");
    assert_eq!(src["name"], "work.ics");
    assert_eq!(src["events"], 1);
    assert!(src["link"].is_null());
    assert!(src["lastError"].is_null());

    let out = cal.events(day("2026-11-09T00:00:00Z"), day("2026-11-10T00:00:00Z"));
    let ev = &out["events"][0];
    assert_eq!(ev["title"], "Standup");
    assert_eq!(ev["start"], "2026-11-09T20:00:00Z");
    assert_eq!(ev["end"], "2026-11-09T20:30:00Z");
    assert_eq!(ev["allDay"], false);
    assert_eq!(
        ev["joinUrl"],
        "https://teams.microsoft.com/l/meetup-join/abc"
    );
    assert_eq!(ev["organizer"]["name"], "Mei Lin");
    assert_eq!(ev["organizer"]["email"], "mei@example.com");
    assert_eq!(ev["attendees"], json!(["Dewi", "ops@example.com"]));
    assert_eq!(ev["sourceId"], src["id"]);
    // Outside the window: nothing.
    assert!(
        cal.events(day("2026-11-10T00:00:00Z"), day("2026-11-11T00:00:00Z"))["events"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn importing_the_same_file_name_replaces_it() {
    let cal = Calendar::new(scratch("replace"));
    cal.add_file(WORK, "work.ics").unwrap();
    cal.add_file(WORK, "work.ics").unwrap();
    assert_eq!(cal.sources().len(), 1);
    cal.add_file(WORK, "other.ics").unwrap();
    assert_eq!(cal.sources().len(), 2);
}

#[test]
fn not_a_calendar_is_refused() {
    let cal = Calendar::new(scratch("junk"));
    assert!(matches!(
        cal.add_file("<html>login</html>", "x.ics"),
        Err(Fail::Bad(_))
    ));
    assert!(cal.sources().is_empty());
}

#[test]
fn at_most_eight_calendars() {
    let cal = Calendar::new(scratch("cap"));
    for n in 0..MAX_SOURCES {
        cal.add_file(WORK, &format!("c{n}.ics")).unwrap();
    }
    assert!(matches!(cal.add_file(WORK, "c9.ics"), Err(Fail::Bad(_))));
    // A replacement is not a ninth calendar.
    cal.add_file(WORK, "c0.ics").unwrap();
    assert_eq!(cal.sources().len(), MAX_SOURCES);
}

#[test]
fn calendars_survive_a_restart_and_can_be_removed() {
    let dir = scratch("persist");
    let first = Calendar::new(dir.clone());
    let src = first.add_file(WORK, "work.ics").unwrap();
    let w = (day("2026-11-09T00:00:00Z"), day("2026-11-10T00:00:00Z"));
    let id_before = first.events(w.0, w.1)["events"][0]["id"].clone();

    let second = Calendar::new(dir.clone());
    let after = second.events(w.0, w.1);
    assert_eq!(
        after["events"][0]["id"], id_before,
        "event ids are stable across restarts"
    );
    assert_eq!(after["sources"][0]["id"], src["id"]);

    let id = src["id"].as_str().unwrap().to_string();
    assert_eq!(second.remove(&id), Ok(()));
    assert!(second.sources().is_empty());
    assert!(!dir.join(format!("calendar-{id}.ics")).exists());
    assert_eq!(second.remove(&id), Err(Fail::Missing));
    assert!(Calendar::new(dir).sources().is_empty());
}

fn with_link(name: &str, url: &str) -> (Calendar, PathBuf, String) {
    let dir = scratch(name);
    let id = "aaaabbbbcccc";
    let doc = json!({ "sources": [{
        "id": id, "kind": "link", "url": url, "name": "Work", "addedAt": 1, "lastSync": 1, "events": 1, "warnings": []
    }]});
    fs::write(dir.join("calendar.json"), doc.to_string()).unwrap();
    fs::write(dir.join(format!("calendar-{id}.ics")), WORK).unwrap();
    (Calendar::new(dir.clone()), dir, id.to_string())
}

#[test]
fn the_link_never_leaves_in_a_response() {
    let (cal, _, _) = with_link(
        "secret",
        "https://calendar.example.com/ical/SECRETKEY/basic.ics",
    );
    let w = (day("2026-11-09T00:00:00Z"), day("2026-11-10T00:00:00Z"));
    let events = cal.events(w.0, w.1);
    let text = events.to_string();
    assert!(!text.contains("SECRETKEY"), "{text}");
    assert_eq!(
        events["sources"][0]["link"],
        "https://calendar.example.com/…"
    );
    let id = events["events"][0]["id"].as_str().unwrap();
    let note = cal.note_for(id, 0, w.0).unwrap();
    assert!(!note.to_string().contains("SECRETKEY"));
}

#[test]
fn a_failed_refresh_keeps_the_last_good_events_and_says_why() {
    // The host is private, so the read fails offline and the same way every time.
    let (cal, _, id) = with_link("refresh-fail", "https://localhost/ical/SECRETKEY/basic.ics");
    let err = cal.refresh_one(&id).unwrap_err();
    assert!(
        matches!(&err, Fail::Upstream(m) if m.contains("could not be reached")),
        "{err:?}"
    );
    let src = &cal.sources()[0];
    assert!(src["lastError"]
        .as_str()
        .unwrap()
        .contains("could not be reached"));
    assert!(!src.to_string().contains("SECRETKEY"));
    assert_eq!(src["events"], 1);
    let out = cal.events(day("2026-11-09T00:00:00Z"), day("2026-11-10T00:00:00Z"));
    assert_eq!(
        out["events"].as_array().unwrap().len(),
        1,
        "old events stay"
    );
    assert_eq!(cal.refresh_one("nope"), Err(Fail::Missing));
}

#[test]
fn an_imported_file_has_nothing_to_refresh() {
    let cal = Calendar::new(scratch("file-refresh"));
    let id = cal.add_file(WORK, "w.ics").unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(cal.refresh_one(&id), Ok(()));
}

// ------------------------------------------------------------------ notes

#[test]
fn an_event_becomes_a_meeting_note_on_the_readers_date() {
    let cal = Calendar::new(scratch("note"));
    cal.add_file(WORK, "work.ics").unwrap();
    let now = day("2026-11-09T00:00:00Z");
    let out = cal.events(now, now + DAY);
    let id = out["events"][0]["id"].as_str().unwrap();

    // 20:00 UTC is 03:00 the next day at UTC+7 (Jakarta).
    let note = cal.note_for(id, 420, now).expect("found");
    assert_eq!(note["id"], format!("MOM-CAL-{id}"));
    assert_eq!(note["title"], "Standup");
    assert_eq!(note["date"], "2026-11-10");
    assert_eq!(note["source"], "calendar");
    assert_eq!(note["meeting"]["start"], "2026-11-09T20:00:00Z");
    assert_eq!(note["meeting"]["chair"], "Mei Lin");
    assert_eq!(
        note["meeting"]["attendees"],
        json!(["Dewi", "ops@example.com"])
    );
    // At UTC it stays on the 9th.
    assert_eq!(cal.note_for(id, 0, now).unwrap()["date"], "2026-11-09");
    assert!(cal.note_for("000000000000", 0, now).is_none());
    // The helper's own normaliser accepts it.
    assert!(crate::notes::normalize_note_doc(&note).is_ok());
}

#[test]
fn all_day_events_keep_their_date_in_notes() {
    let cal = Calendar::new(scratch("allday"));
    cal.add_file(
        "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:h\r\nDTSTART;VALUE=DATE:20261110\r\nSUMMARY:Offsite\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        "h.ics",
    )
    .unwrap();
    let now = day("2026-11-09T00:00:00Z");
    let out = cal.events(now, now + 3 * DAY);
    let ev = &out["events"][0];
    assert_eq!(ev["allDay"], true);
    assert_eq!(ev["start"], "2026-11-10");
    assert_eq!(ev["end"], "2026-11-11");
    let note = cal.note_for(ev["id"].as_str().unwrap(), -480, now).unwrap();
    assert_eq!(
        note["date"], "2026-11-10",
        "a date is not shifted by the reader's zone"
    );
}

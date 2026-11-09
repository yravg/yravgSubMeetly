use super::*;

fn cal(body: &str) -> Parsed {
    parse(&format!(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}END:VCALENDAR\r\n"
    ))
    .expect("parses")
}

fn at(s: &str) -> i64 {
    parse_iso(s).expect("iso")
}

fn starts(p: &Parsed, from: &str, to: &str) -> Vec<String> {
    expand(p, at(from), at(to), 500)
        .iter()
        .map(|o| iso_utc(o.start))
        .collect()
}

fn event(props: &str) -> String {
    format!("BEGIN:VEVENT\r\nUID:u1@example.com\r\n{props}END:VEVENT\r\n")
}

#[test]
fn civil_anchors_are_right() {
    assert_eq!(days_from_civil(1970, 1, 1), 0);
    assert_eq!(days_from_civil(2026, 11, 9), 20_766);
    assert_eq!(weekday(20_766), 0, "2026-11-09 is a Monday");
    assert_eq!(iso_utc(20_766 * 86_400 + 9 * 3600), "2026-11-09T09:00:00Z");
    assert_eq!(parse_iso("2026-02-30"), None);
    assert_eq!(
        nth_weekday(2026, 3, -1, 6),
        Some(days_from_civil(2026, 3, 29))
    );
    assert_eq!(
        nth_weekday(2026, 11, 5, 0),
        Some(days_from_civil(2026, 11, 30)),
        "Nov 2026 has five Mondays"
    );
    assert_eq!(nth_weekday(2026, 11, 5, 1), None, "but only four Tuesdays");
}

#[test]
fn not_an_ics_file_is_an_error() {
    assert!(parse("<html>hello</html>").is_err());
}

#[test]
fn folded_lines_and_escapes_are_read() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nSUMMARY:Rapat K3 \\, minggu ini\r\nDESCRIPTION:Baris satu\\nbaris\r\n  dua\r\n\tlanjut\r\n",
    ));
    let e = &p.events[0];
    assert_eq!(e.title, "Rapat K3 , minggu ini");
    assert_eq!(
        e.description,
        "Baris satu\nbaris dua".to_string() + "lanjut"
    );
}

#[test]
fn utc_floating_and_all_day_starts() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nDTEND:20261109T100000Z\r\nSUMMARY:A\r\n",
    ));
    assert_eq!(iso_utc(p.events[0].start), "2026-11-09T09:00:00Z");
    assert_eq!(p.events[0].end - p.events[0].start, 3600);
    assert!(!p.events[0].all_day);

    // Floating time: read in X-WR-TIMEZONE when the file names one.
    let p = cal(&format!(
        "X-WR-TIMEZONE:Asia/Jakarta\r\n{}",
        event("DTSTART:20261109T090000\r\nSUMMARY:F\r\n")
    ));
    assert_eq!(iso_utc(p.events[0].start), "2026-11-09T02:00:00Z");

    let p = cal(&event("DTSTART;VALUE=DATE:20261109\r\nSUMMARY:Libur\r\n"));
    let e = &p.events[0];
    assert!(e.all_day);
    assert_eq!(iso_date(e.start), "2026-11-09");
    assert_eq!(e.end - e.start, 86_400, "no DTEND = one day");
    let p = cal(&event(
        "DTSTART;VALUE=DATE:20261109\r\nDTEND;VALUE=DATE:20261111\r\nSUMMARY:Cuti\r\n",
    ));
    assert_eq!(p.events[0].end - p.events[0].start, 2 * 86_400);
}

#[test]
fn duration_instead_of_dtend() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nDURATION:PT1H30M\r\nSUMMARY:D\r\n",
    ));
    assert_eq!(p.events[0].end - p.events[0].start, 5400);
    assert_eq!(parse_duration("P1W"), Some(7 * 86_400));
    assert_eq!(parse_duration("-PT15M"), Some(-900));
    assert_eq!(parse_duration("bogus"), None);
}

#[test]
fn windows_zone_names_outlook_uses() {
    let p = cal(&event(
        "DTSTART;TZID=SE Asia Standard Time:20261109T090000\r\nSUMMARY:WIB\r\n",
    ));
    assert_eq!(iso_utc(p.events[0].start), "2026-11-09T02:00:00Z");
    assert!(p.warnings.is_empty());
    let p = cal(&event(
        "DTSTART;TZID=\"China Standard Time\":20261109T090000\r\nSUMMARY:CN\r\n",
    ));
    assert_eq!(iso_utc(p.events[0].start), "2026-11-09T01:00:00Z");
    // A path-style TZID falls back to its Area/City tail.
    let p = cal(&event(
        "DTSTART;TZID=/mozilla.org/20050126_1/Asia/Jakarta:20261109T090000\r\nSUMMARY:M\r\n",
    ));
    assert_eq!(iso_utc(p.events[0].start), "2026-11-09T02:00:00Z");
}

#[test]
fn unknown_zone_is_read_as_utc_and_said() {
    let p = cal(&event(
        "DTSTART;TZID=Mars/Olympus:20261109T090000\r\nSUMMARY:X\r\n",
    ));
    assert_eq!(iso_utc(p.events[0].start), "2026-11-09T09:00:00Z");
    assert!(
        p.warnings.iter().any(|w| w.contains("Mars/Olympus")),
        "{:?}",
        p.warnings
    );
}

#[test]
fn builtin_dst_rules_eu_us_au() {
    let paris = builtin_zone("Europe/Paris").expect("zone");
    assert_eq!(
        paris.local_to_utc(at("2026-07-01T09:00:00Z")),
        at("2026-07-01T07:00:00Z")
    );
    assert_eq!(
        paris.local_to_utc(at("2026-01-15T09:00:00Z")),
        at("2026-01-15T08:00:00Z")
    );
    // Change at 01:00 UTC on the last Sundays of March and October.
    assert_eq!(paris.offset_at(at("2026-03-29T00:59:59Z")), 3600);
    assert_eq!(paris.offset_at(at("2026-03-29T01:00:00Z")), 7200);
    assert_eq!(paris.offset_at(at("2026-10-25T00:59:59Z")), 7200);
    assert_eq!(paris.offset_at(at("2026-10-25T01:00:00Z")), 3600);
    // A wall time the spring change skips moves forward by the hour.
    assert_eq!(
        paris.local_to_utc(at("2026-03-29T02:30:00Z")),
        at("2026-03-29T01:30:00Z")
    );

    let ny = builtin_zone("Eastern Standard Time").expect("zone");
    assert_eq!(
        ny.local_to_utc(at("2026-03-08T01:59:00Z")),
        at("2026-03-08T06:59:00Z")
    );
    assert_eq!(
        ny.local_to_utc(at("2026-03-08T03:00:00Z")),
        at("2026-03-08T07:00:00Z")
    );
    assert_eq!(ny.offset_at(at("2026-11-01T05:59:00Z")), -4 * 3600);
    assert_eq!(ny.offset_at(at("2026-11-01T06:00:00Z")), -5 * 3600);

    // Southern hemisphere: daylight time spans the new year.
    let syd = builtin_zone("AUS Eastern Standard Time").expect("zone");
    assert_eq!(
        syd.local_to_utc(at("2026-01-15T10:00:00Z")),
        at("2026-01-14T23:00:00Z")
    );
    assert_eq!(
        syd.local_to_utc(at("2026-07-01T10:00:00Z")),
        at("2026-07-01T00:00:00Z")
    );

    let jkt = builtin_zone("SE Asia Standard Time").expect("zone");
    assert_eq!(jkt.offset_at(at("2026-07-01T00:00:00Z")), 7 * 3600);
}

#[test]
fn the_files_own_vtimezone_wins() {
    let tz = "BEGIN:VTIMEZONE\r\nTZID:Custom Eastern\r\n\
BEGIN:STANDARD\r\nDTSTART:16011104T020000\r\nRRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\n\
BEGIN:DAYLIGHT\r\nDTSTART:16010311T020000\r\nRRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nEND:DAYLIGHT\r\n\
END:VTIMEZONE\r\n";
    let p = cal(&format!(
        "{tz}{}{}",
        event("DTSTART;TZID=Custom Eastern:20260701T090000\r\nSUMMARY:S\r\n"),
        "BEGIN:VEVENT\r\nUID:u2\r\nDTSTART;TZID=Custom Eastern:20260115T090000\r\nSUMMARY:W\r\nEND:VEVENT\r\n"
    ));
    assert_eq!(iso_utc(p.events[0].start), "2026-07-01T13:00:00Z");
    assert_eq!(iso_utc(p.events[1].start), "2026-01-15T14:00:00Z");
    assert!(p.warnings.is_empty(), "{:?}", p.warnings);

    // A zone with no daylight rule is a fixed offset (Outlook's SE Asia block).
    let fixed = "BEGIN:VTIMEZONE\r\nTZID:Fixed Zone\r\nBEGIN:STANDARD\r\nDTSTART:16010101T000000\r\nTZOFFSETFROM:+0700\r\nTZOFFSETTO:+0700\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";
    let p = cal(&format!(
        "{fixed}{}",
        event("DTSTART;TZID=Fixed Zone:20261109T090000\r\nSUMMARY:F\r\n")
    ));
    assert_eq!(iso_utc(p.events[0].start), "2026-11-09T02:00:00Z");
}

#[test]
fn weekly_byday_count() {
    let p = cal(&event("DTSTART:20261109T090000Z\r\nDTEND:20261109T100000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5\r\nSUMMARY:W\r\n"));
    assert_eq!(
        starts(&p, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"),
        [
            "2026-11-09T09:00:00Z",
            "2026-11-11T09:00:00Z",
            "2026-11-16T09:00:00Z",
            "2026-11-18T09:00:00Z",
            "2026-11-23T09:00:00Z"
        ]
    );
}

#[test]
fn weekly_interval_two() {
    let p = cal(&event("DTSTART:20261109T090000Z\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3\r\nSUMMARY:B\r\n"));
    assert_eq!(
        starts(&p, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"),
        [
            "2026-11-09T09:00:00Z",
            "2026-11-23T09:00:00Z",
            "2026-12-07T09:00:00Z"
        ]
    );
}

#[test]
fn weekly_without_byday_uses_the_start_weekday() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nSUMMARY:W\r\n",
    ));
    assert_eq!(
        starts(&p, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"),
        ["2026-11-09T09:00:00Z", "2026-11-16T09:00:00Z"]
    );
}

#[test]
fn until_is_inclusive_in_both_forms() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nRRULE:FREQ=DAILY;UNTIL=20261111T090000Z\r\nSUMMARY:D\r\n",
    ));
    assert_eq!(
        starts(&p, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
        [
            "2026-11-09T09:00:00Z",
            "2026-11-10T09:00:00Z",
            "2026-11-11T09:00:00Z"
        ]
    );
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nRRULE:FREQ=DAILY;UNTIL=20261110\r\nSUMMARY:D\r\n",
    ));
    assert_eq!(
        starts(&p, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z").len(),
        2,
        "the UNTIL day itself counts"
    );
}

#[test]
fn exdate_removes_an_occurrence_but_count_still_counts_it() {
    let p = cal(&event("DTSTART:20261109T090000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261110T090000Z\r\nSUMMARY:D\r\n"));
    assert_eq!(
        starts(&p, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
        ["2026-11-09T09:00:00Z", "2026-11-11T09:00:00Z"]
    );
}

#[test]
fn recurrence_id_moves_or_cancels_one_occurrence() {
    let master = "BEGIN:VEVENT\r\nUID:s1\r\nDTSTART:20261109T090000Z\r\nDTEND:20261109T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Standup\r\nEND:VEVENT\r\n";
    let moved = "BEGIN:VEVENT\r\nUID:s1\r\nRECURRENCE-ID:20261110T090000Z\r\nDTSTART:20261110T140000Z\r\nDTEND:20261110T150000Z\r\nSUMMARY:Standup (moved)\r\nEND:VEVENT\r\n";
    let p = cal(&format!("{master}{moved}"));
    let occ = expand(
        &p,
        at("2026-11-01T00:00:00Z"),
        at("2026-12-01T00:00:00Z"),
        50,
    );
    let got: Vec<(String, &str)> = occ
        .iter()
        .map(|o| (iso_utc(o.start), o.title.as_str()))
        .collect();
    assert_eq!(
        got,
        [
            ("2026-11-09T09:00:00Z".to_string(), "Standup"),
            ("2026-11-10T14:00:00Z".to_string(), "Standup (moved)"),
            ("2026-11-11T09:00:00Z".to_string(), "Standup"),
        ]
    );
    let cancelled = "BEGIN:VEVENT\r\nUID:s1\r\nRECURRENCE-ID:20261110T090000Z\r\nDTSTART:20261110T090000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:x\r\nEND:VEVENT\r\n";
    let p = cal(&format!("{master}{cancelled}"));
    assert_eq!(
        starts(&p, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
        ["2026-11-09T09:00:00Z", "2026-11-11T09:00:00Z"]
    );
}

#[test]
fn cancelled_events_do_not_show() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Batal\r\n",
    ));
    assert!(starts(&p, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z").is_empty());
}

#[test]
fn monthly_by_ordinal_weekday_and_month_day() {
    // First Monday of the month (2026-11-02 is a Monday).
    let p = cal(&event(
        "DTSTART:20261102T090000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=3\r\nSUMMARY:M\r\n",
    ));
    assert_eq!(
        starts(&p, "2026-01-01T00:00:00Z", "2027-12-01T00:00:00Z"),
        [
            "2026-11-02T09:00:00Z",
            "2026-12-07T09:00:00Z",
            "2027-01-04T09:00:00Z"
        ]
    );
    // Last Friday.
    let p = cal(&event(
        "DTSTART:20261127T090000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=2\r\nSUMMARY:M\r\n",
    ));
    assert_eq!(
        starts(&p, "2026-01-01T00:00:00Z", "2027-12-01T00:00:00Z"),
        ["2026-11-27T09:00:00Z", "2026-12-25T09:00:00Z"]
    );
    // The 31st skips the months that have no 31st.
    let p = cal(&event(
        "DTSTART:20270131T090000Z\r\nRRULE:FREQ=MONTHLY;COUNT=3\r\nSUMMARY:M\r\n",
    ));
    assert_eq!(
        starts(&p, "2027-01-01T00:00:00Z", "2027-12-31T00:00:00Z"),
        [
            "2027-01-31T09:00:00Z",
            "2027-03-31T09:00:00Z",
            "2027-05-31T09:00:00Z"
        ]
    );
    // The last day of every month.
    let p = cal(&event(
        "DTSTART:20270131T090000Z\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3\r\nSUMMARY:M\r\n",
    ));
    assert_eq!(
        starts(&p, "2027-01-01T00:00:00Z", "2027-12-31T00:00:00Z"),
        [
            "2027-01-31T09:00:00Z",
            "2027-02-28T09:00:00Z",
            "2027-03-31T09:00:00Z"
        ]
    );
}

#[test]
fn yearly_and_leap_day() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nRRULE:FREQ=YEARLY;COUNT=3\r\nSUMMARY:Y\r\n",
    ));
    assert_eq!(
        starts(&p, "2026-01-01T00:00:00Z", "2035-01-01T00:00:00Z"),
        [
            "2026-11-09T09:00:00Z",
            "2027-11-09T09:00:00Z",
            "2028-11-09T09:00:00Z"
        ]
    );
    let p = cal(&event(
        "DTSTART:20280229T090000Z\r\nRRULE:FREQ=YEARLY;COUNT=2\r\nSUMMARY:Leap\r\n",
    ));
    assert_eq!(
        starts(&p, "2028-01-01T00:00:00Z", "2040-01-01T00:00:00Z"),
        ["2028-02-29T09:00:00Z", "2032-02-29T09:00:00Z"]
    );
}

#[test]
fn daily_with_byday_skips_the_weekend() {
    // Friday 2026-11-13, weekdays only: Fri, Mon, Tue.
    let p = cal(&event("DTSTART:20261113T090000Z\r\nRRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=3\r\nSUMMARY:D\r\n"));
    assert_eq!(
        starts(&p, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
        [
            "2026-11-13T09:00:00Z",
            "2026-11-16T09:00:00Z",
            "2026-11-17T09:00:00Z"
        ]
    );
}

#[test]
fn recurring_event_keeps_its_wall_clock_across_dst() {
    // 09:00 in Paris, every week from Monday 2026-03-23 (CET) over the March change.
    let p = cal(&event(
        "DTSTART;TZID=Europe/Paris:20260323T090000\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nSUMMARY:P\r\n",
    ));
    assert_eq!(
        starts(&p, "2026-03-01T00:00:00Z", "2026-04-30T00:00:00Z"),
        ["2026-03-23T08:00:00Z", "2026-03-30T07:00:00Z"]
    );
}

#[test]
fn unsupported_rules_show_once_and_say_so() {
    let p = cal(&event("DTSTART:20261109T090000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\r\nSUMMARY:Last weekday\r\n"));
    assert_eq!(
        starts(&p, "2026-01-01T00:00:00Z", "2027-12-31T00:00:00Z"),
        ["2026-11-09T09:00:00Z"]
    );
    assert!(
        p.warnings
            .iter()
            .any(|w| w.contains("BYSETPOS") && w.contains("Last weekday")),
        "{:?}",
        p.warnings
    );
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nRRULE:FREQ=HOURLY\r\nSUMMARY:H\r\n",
    ));
    assert_eq!(
        starts(&p, "2026-01-01T00:00:00Z", "2027-12-31T00:00:00Z").len(),
        1
    );
    assert!(
        p.warnings.iter().any(|w| w.contains("FREQ=HOURLY")),
        "{:?}",
        p.warnings
    );
}

#[test]
fn window_and_limit() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nDTEND:20261109T100000Z\r\nSUMMARY:A\r\n",
    ));
    assert!(starts(&p, "2026-11-10T00:00:00Z", "2026-11-11T00:00:00Z").is_empty());
    // An event already running at `from` is still in the window.
    assert_eq!(
        starts(&p, "2026-11-09T09:30:00Z", "2026-11-11T00:00:00Z").len(),
        1
    );
    // The end is exclusive.
    assert!(starts(&p, "2026-11-09T10:00:00Z", "2026-11-11T00:00:00Z").is_empty());
    let d = cal(&event(
        "DTSTART:20261109T090000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:D\r\n",
    ));
    assert_eq!(
        expand(
            &d,
            at("2026-11-09T00:00:00Z"),
            at("2027-11-09T00:00:00Z"),
            4
        )
        .len(),
        4
    );
}

#[test]
fn people_are_read_with_quoted_params_and_resources_dropped() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nORGANIZER;CN=\"Mei Lin\":mailto:mei@example.com\r\n\
ATTENDEE;CN=\"Lin, Mei: PMO\";ROLE=REQ-PARTICIPANT:mailto:lin@example.com\r\n\
ATTENDEE;CUTYPE=RESOURCE;CN=Room 4:mailto:room4@example.com\r\nATTENDEE:mailto:ops@example.com\r\nSUMMARY:P\r\n",
    ));
    let e = &p.events[0];
    assert_eq!(
        e.organizer,
        Some(Person {
            name: "Mei Lin".into(),
            email: "mei@example.com".into()
        })
    );
    let names: Vec<&str> = e.attendees.iter().map(|a| a.display()).collect();
    assert_eq!(names, ["Lin, Mei: PMO", "ops@example.com"]);
}

#[test]
fn join_links_only_for_meeting_hosts() {
    let teams = "Join: <https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d>\nOr call in";
    assert_eq!(
        join_link(&["", teams]).as_deref(),
        Some("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d")
    );
    assert_eq!(
        join_link(&["See https://acme.zoom.us/j/123456789?pwd=abc."]).as_deref(),
        Some("https://acme.zoom.us/j/123456789?pwd=abc")
    );
    assert_eq!(
        join_link(&["https://meet.google.com/abc-defg-hij"]).as_deref(),
        Some("https://meet.google.com/abc-defg-hij")
    );
    assert_eq!(
        join_link(&["https://acme.webex.com/meet/mei"]).as_deref(),
        Some("https://acme.webex.com/meet/mei")
    );
    // Not a meeting host, a lookalike, and a userinfo trick: no button.
    assert_eq!(join_link(&["https://example.com/agenda.pdf"]), None);
    assert_eq!(join_link(&["https://zoom.us.evil.example/j/1"]), None);
    assert_eq!(join_link(&["https://notzoom.us/j/1"]), None);
    assert_eq!(join_link(&["https://zoom.us@evil.example/j/1"]), None);
    assert_eq!(join_link(&["no link here", "just http words"]), None);
    // A non-meeting link before a meeting one does not hide it.
    assert_eq!(
        join_link(&["Docs https://example.com/a then https://zoom.us/j/9"]).as_deref(),
        Some("https://zoom.us/j/9")
    );
}

#[test]
fn join_link_comes_from_the_event_properties() {
    let p = cal(&event(
        "DTSTART:20261109T090000Z\r\nLOCATION:Microsoft Teams Meeting\r\n\
DESCRIPTION:Agenda\\n<https://teams.microsoft.com/l/meetup-join/xyz>\\n\r\nSUMMARY:T\r\n",
    ));
    let occ = expand(
        &p,
        at("2026-11-09T00:00:00Z"),
        at("2026-11-10T00:00:00Z"),
        5,
    );
    assert_eq!(
        occ[0].join_url.as_deref(),
        Some("https://teams.microsoft.com/l/meetup-join/xyz")
    );
    let p = cal(&event("DTSTART:20261109T090000Z\r\nX-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/abc\r\nSUMMARY:T\r\n"));
    let occ = expand(
        &p,
        at("2026-11-09T00:00:00Z"),
        at("2026-11-10T00:00:00Z"),
        5,
    );
    assert_eq!(
        occ[0].join_url.as_deref(),
        Some("https://teams.microsoft.com/l/meetup-join/abc")
    );
}

#[test]
fn all_day_events_get_a_day_of_slack_for_the_clients_zone() {
    let p = cal(&event("DTSTART;VALUE=DATE:20261109\r\nSUMMARY:Libur\r\n"));
    // A UTC+7 reader's Nov 9 begins at Nov 8 17:00 UTC; the event must come back.
    assert_eq!(
        expand(
            &p,
            at("2026-11-08T17:00:00Z"),
            at("2026-11-09T17:00:00Z"),
            5
        )
        .len(),
        1
    );
    // The previous week does not.
    assert!(expand(
        &p,
        at("2026-11-01T00:00:00Z"),
        at("2026-11-07T00:00:00Z"),
        5
    )
    .is_empty());
}

#[test]
fn a_hostile_file_cannot_run_away() {
    // Daily forever from a far-past start, asked for a far-future window.
    let p = cal(&event(
        "DTSTART:19700101T090000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Old\r\n",
    ));
    let occ = expand(
        &p,
        at("2026-11-09T00:00:00Z"),
        at("2026-11-10T00:00:00Z"),
        10,
    );
    assert!(occ.len() <= 1);
    // Deep nesting and junk lines are ignored, not fatal.
    let junk = "BEGIN:A\r\nBEGIN:B\r\nBEGIN:C\r\nBEGIN:D\r\nBEGIN:E\r\nBEGIN:F\r\nBEGIN:G\r\nBEGIN:H\r\nBEGIN:I\r\n:::\r\n;;;\r\n";
    assert!(parse(&format!("BEGIN:VCALENDAR\r\n{junk}END:VCALENDAR\r\n")).is_ok());
}

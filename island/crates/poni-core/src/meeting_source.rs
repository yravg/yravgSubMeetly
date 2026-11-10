//! Where a source of sound goes: a meeting (Teams, Zoom, Google Meet in a browser, Webex, a Slack
//! huddle, an app or host the person added, a link joined in the last 10 minutes, a running calendar
//! meeting), other media, or nothing. Pure: the island's probes hand in process names, window titles
//! and Windows' microphone-in-use record; nothing leaves the PC.

use serde::{Deserialize, Serialize};

/// A meeting app or web address the person added in Settings › Meeting apps.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeetingApp {
    pub kind: MeetingAppKind,
    /// A process name (`ZohoMeeting.exe`) or a host (`meeting.tencent.com`).
    pub value: String,
    pub label: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeetingAppKind {
    App,
    Host,
}

/// One switch per built-in family, all on by default.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MeetingFamilies {
    pub teams: bool,
    pub zoom: bool,
    pub meet: bool,
    pub webex: bool,
    pub slack: bool,
}

impl Default for MeetingFamilies {
    fn default() -> Self {
        Self { teams: true, zoom: true, meet: true, webex: true, slack: true }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Family {
    Teams,
    Zoom,
    Meet,
    Webex,
    Slack,
}

impl Family {
    pub const ALL: [Family; 5] = [Family::Teams, Family::Zoom, Family::Meet, Family::Webex, Family::Slack];

    /// Settings row title and sub-text, as drawn on canvas board P07.
    pub fn row(self) -> (&'static str, &'static str) {
        match self {
            Family::Teams => ("Microsoft Teams", "Desktop app and classic Teams"),
            Family::Zoom => ("Zoom", "Zoom.exe"),
            Family::Meet => ("Google Meet", "In a browser window that uses the microphone"),
            Family::Webex => ("Webex", "Desktop app"),
            Family::Slack => ("Slack huddles", "Huddle windows only"),
        }
    }

    pub fn on(self, f: &MeetingFamilies) -> bool {
        match self {
            Family::Teams => f.teams,
            Family::Zoom => f.zoom,
            Family::Meet => f.meet,
            Family::Webex => f.webex,
            Family::Slack => f.slack,
        }
    }

    pub fn switch(self, f: &mut MeetingFamilies) -> &mut bool {
        match self {
            Family::Teams => &mut f.teams,
            Family::Zoom => &mut f.zoom,
            Family::Meet => &mut f.meet,
            Family::Webex => &mut f.webex,
            Family::Slack => &mut f.slack,
        }
    }

    /// The name shown and logged ("meeting source: Teams (ms-teams.exe)").
    pub fn name(self) -> &'static str {
        match self {
            Family::Teams => "Teams",
            Family::Zoom => "Zoom",
            Family::Meet => "Google Meet",
            Family::Webex => "Webex",
            Family::Slack => "Slack huddle",
        }
    }
}

/// What the probes saw, all lower- or mixed-case; matching ignores case.
#[derive(Clone, Debug, Default)]
pub struct Signals {
    /// Apps playing sound or media (the media session's app id, the sounding process).
    pub sounding: Vec<String>,
    /// Top-level windows: (process name, title).
    pub windows: Vec<(String, String)>,
    /// Processes Windows records as using the microphone right now.
    pub mic: Vec<String>,
    /// A timed calendar meeting with a join link runs now ([`crate::capture::meeting_now`]).
    pub calendar_meeting: bool,
    /// The host of a link joined in the last 10 minutes ([`Joined::active`]).
    pub joined: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceKind {
    /// `label` names the meeting ("Teams", "meeting.tencent.com"); `via` the process it came from.
    Meeting { label: String, via: String },
    Media,
    None,
}

const BROWSERS: [&str; 7] = ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc"];

fn is_browser(p: &str) -> bool {
    let p = p.to_ascii_lowercase();
    BROWSERS.iter().any(|b| p.contains(b))
}

/// The process name an id or path ends with (`C:#Program Files#Zoom#bin#Zoom.exe` → `zoom.exe`).
fn exe(p: &str) -> String {
    p.rsplit(['\\', '/', '#']).next().unwrap_or(p).to_ascii_lowercase()
}

fn desktop_family(p: &str) -> Option<Family> {
    let e = exe(p);
    let l = p.to_ascii_lowercase();
    if e == "ms-teams.exe" || e == "teams.exe" || l.contains("msteams") {
        Some(Family::Teams)
    } else if e == "zoom.exe" {
        Some(Family::Zoom)
    } else if e.starts_with("webex") || e == "ciscocollabhost.exe" || e == "atmgr.exe" {
        Some(Family::Webex)
    } else {
        None
    }
}

/// A browser window title that names a web meeting.
fn web_family(title: &str) -> Option<Family> {
    let t = title.to_ascii_lowercase();
    if t.contains("google meet") || t.starts_with("meet -") || t.contains("meet.google.com") {
        Some(Family::Meet)
    } else if t.contains("microsoft teams") {
        Some(Family::Teams)
    } else if t.contains("zoom") && (t.contains("meeting") || t.contains("zoom.us")) {
        Some(Family::Zoom)
    } else if t.contains("webex") {
        Some(Family::Webex)
    } else {
        None
    }
}

/// Classify what plays now. Order: meeting apps and the person's list, the joined link, the
/// calendar, then other media (anything captionable that sounds), else nothing. A family switched
/// off falls back to Media.
pub fn source_kind(s: &Signals, families: &MeetingFamilies, mine: &[MeetingApp]) -> SourceKind {
    let in_mic = |p: &str| s.mic.iter().any(|m| exe(m) == exe(p) || m.eq_ignore_ascii_case(p));
    let mut off = false;
    let mut hit = |f: Family, via: &str| -> Option<SourceKind> {
        if f.on(families) {
            Some(SourceKind::Meeting { label: f.name().into(), via: via.into() })
        } else {
            off = true;
            None
        }
    };
    // Desktop apps in a call use the microphone.
    for m in &s.mic {
        if let Some(k) = desktop_family(m).and_then(|f| hit(f, &exe(m))) {
            return k;
        }
    }
    for (p, title) in &s.windows {
        let found = if exe(p) == "slack.exe" && title.to_ascii_lowercase().contains("huddle") {
            Some(Family::Slack)
        } else if is_browser(p) && in_mic(p) {
            web_family(title)
        } else {
            None
        };
        if let Some(k) = found.and_then(|f| hit(f, &exe(p))) {
            return k;
        }
    }
    for a in mine {
        let v = a.value.to_ascii_lowercase();
        let via = match a.kind {
            MeetingAppKind::App => s.mic.iter().chain(&s.sounding).find(|p| exe(p) == v).map(|p| exe(p)),
            MeetingAppKind::Host => s
                .windows
                .iter()
                .find(|(p, t)| is_browser(p) && t.to_ascii_lowercase().contains(&v))
                .map(|(p, _)| exe(p))
                .or_else(|| s.joined.as_deref().filter(|j| j.eq_ignore_ascii_case(&v)).map(String::from)),
        };
        if let Some(via) = via {
            return SourceKind::Meeting { label: a.label.clone(), via };
        }
    }
    let sounding = !s.sounding.is_empty() || !s.mic.is_empty();
    if let Some(host) = s.joined.as_ref().filter(|_| sounding) {
        return SourceKind::Meeting { label: host.clone(), via: "joined link".into() };
    }
    if s.calendar_meeting {
        return SourceKind::Meeting { label: "Calendar meeting".into(), via: "calendar".into() };
    }
    if off || s.sounding.iter().any(|p| crate::capture::captionable_app(p)) {
        SourceKind::Media
    } else {
        SourceKind::None
    }
}

/// Only the host of a meeting link (`https://meeting.tencent.com/dm/x` → `meeting.tencent.com`).
/// Accepts http(s) and the meeting apps' own schemes; anything else is `None`.
pub fn host_of(link: &str) -> Option<String> {
    let l = link.trim();
    let (scheme, rest) = l.split_once("://").or_else(|| l.split_once(':'))?;
    let scheme = scheme.to_ascii_lowercase();
    if !["http", "https", "msteams", "zoommtg", "zoomus", "webex", "slack"].contains(&scheme.as_str()) {
        return None;
    }
    let rest = rest.trim_start_matches('/');
    let host = rest.split(['/', '?', '#']).next()?.rsplit('@').next()?.split(':').next()?.to_ascii_lowercase();
    let ok = !host.is_empty()
        && host.contains('.')
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !host.starts_with(['.', '-'])
        && !host.ends_with(['.', '-']);
    ok.then_some(host)
}

/// A host the built-ins or the person's list already treat as a meeting; otherwise the island
/// offers "Always treat <host> as a meeting".
pub fn is_known_host(host: &str, mine: &[MeetingApp]) -> bool {
    let h = host.to_ascii_lowercase();
    let built_in = ["teams.microsoft.com", "teams.live.com", "zoom.us", "meet.google.com", "webex.com", "slack.com"];
    built_in.iter().any(|b| h == *b || h.ends_with(&format!(".{b}")))
        || mine.iter().any(|a| a.kind == MeetingAppKind::Host && a.value.eq_ignore_ascii_case(&h))
}

/// The active joined host when no list knows it and the person has not answered for it yet:
/// the Meeting tab offers "Always treat <host> as a meeting" once (`asked`: hosts answered).
pub fn host_offer<'a>(joined: Option<&'a str>, mine: &[MeetingApp], asked: &[String]) -> Option<&'a str> {
    joined.filter(|h| !is_known_host(h, mine) && !asked.iter().any(|a| a.eq_ignore_ascii_case(h)))
}

/// Add the host of `link` to the person's list; `None` when the link has no host or it is there already.
pub fn add_link(apps: &mut Vec<MeetingApp>, link: &str) -> Option<String> {
    let host = host_of(link)?;
    if apps.iter().any(|a| a.kind == MeetingAppKind::Host && a.value == host) {
        return None;
    }
    apps.push(MeetingApp { kind: MeetingAppKind::Host, value: host.clone(), label: host.clone() });
    Some(host)
}

/// The process names a built-in family or the person's list already covers (greyed in the picker).
pub fn app_listed(exe_name: &str, apps: &[MeetingApp]) -> bool {
    desktop_family(exe_name).is_some() || apps.iter().any(|a| a.kind == MeetingAppKind::App && a.value.eq_ignore_ascii_case(exe_name))
}

/// Add a running app by its process name (`ZohoMeeting.exe`), labelled without `.exe`.
pub fn add_app(apps: &mut Vec<MeetingApp>, exe_name: &str) -> bool {
    if exe_name.is_empty() || app_listed(exe_name, apps) {
        return false;
    }
    let label = exe_name.strip_suffix(".exe").or_else(|| exe_name.strip_suffix(".EXE")).unwrap_or(exe_name);
    apps.push(MeetingApp { kind: MeetingAppKind::App, value: exe_name.into(), label: label.into() });
    true
}

/// How long a joined link marks its meeting active.
pub const JOINED_S: f64 = 600.0;

/// The link joined last (Today › Join, or a pasted link) and when.
#[derive(Clone, Debug, Default)]
pub struct Joined {
    last: Option<(String, f64)>,
}

impl Joined {
    /// Mark `host` as the active meeting from `now` (seconds).
    pub fn joined(&mut self, host: &str, now: f64) {
        self.last = Some((host.to_ascii_lowercase(), now));
    }

    /// The host while it is within [`JOINED_S`] of being joined.
    pub fn active(&self, now: f64) -> Option<&str> {
        self.last.as_ref().filter(|(_, t)| now - t < JOINED_S).map(|(h, _)| h.as_str())
    }
}

/// What one captions session heard from over its whole run (PMM-015). A meeting at any moment
/// makes it a meeting; media without a meeting keeps it as a transcript; neither (a room, sound
/// with no media session) stays a meeting, as every session was before.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SessionSeen {
    meeting: bool,
    media: bool,
    /// The first media title heard (the video's): it names the transcript.
    pub title: Option<String>,
}

impl SessionSeen {
    pub fn saw(&mut self, kind: &SourceKind, media_title: Option<&str>) {
        match kind {
            SourceKind::Meeting { .. } => self.meeting = true,
            SourceKind::Media => {
                self.media = true;
                if self.title.is_none() {
                    self.title = media_title.map(str::trim).filter(|t| !t.is_empty()).map(String::from);
                }
            }
            SourceKind::None => {}
        }
    }

    pub fn transcript(&self) -> bool {
        self.media && !self.meeting
    }

    /// A meeting source played at some moment of the session (its notes are the Meeting tab's).
    pub fn meeting(&self) -> bool {
        self.meeting
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_is_a_transcript_only_when_it_heard_media_and_never_a_meeting() {
        let teams = SourceKind::Meeting { label: "Teams".into(), via: "ms-teams".into() };
        let mut video = SessionSeen::default();
        video.saw(&SourceKind::None, Some("ignored: no media yet"));
        video.saw(&SourceKind::Media, Some("macOS 27.2.1 is out"));
        video.saw(&SourceKind::Media, Some("the next video"));
        video.saw(&SourceKind::None, None);
        assert!(video.transcript());
        assert_eq!(video.title.as_deref(), Some("macOS 27.2.1 is out"), "the first media title names it");

        let mut call = SessionSeen::default();
        call.saw(&SourceKind::Media, Some("a video"));
        call.saw(&teams, None);
        assert!(!call.transcript(), "a meeting at any moment keeps today's save");

        let mut room = SessionSeen::default();
        room.saw(&SourceKind::None, None);
        assert!(!room.transcript(), "no source at all (a room, sound alone) stays a meeting");
        assert!(!SessionSeen::default().transcript());

        let mut untitled = SessionSeen::default();
        untitled.saw(&SourceKind::Media, Some("  "));
        assert_eq!((untitled.transcript(), untitled.title), (true, None));
    }

    fn sig(sounding: &[&str], windows: &[(&str, &str)], mic: &[&str]) -> Signals {
        Signals {
            sounding: sounding.iter().map(|s| s.to_string()).collect(),
            windows: windows.iter().map(|(p, t)| (p.to_string(), t.to_string())).collect(),
            mic: mic.iter().map(|s| s.to_string()).collect(),
            ..Signals::default()
        }
    }

    fn meeting(label: &str, via: &str) -> SourceKind {
        SourceKind::Meeting { label: label.into(), via: via.into() }
    }

    #[test]
    fn every_family_is_a_meeting() {
        let on = MeetingFamilies::default();
        let cases: [(Signals, SourceKind); 8] = [
            (sig(&[], &[], &["C:#Users#a#AppData#Local#Microsoft#Teams#current#Teams.exe"]), meeting("Teams", "teams.exe")),
            (sig(&[], &[], &["MSTeams_8wekyb3d8bbwe"]), meeting("Teams", "msteams_8wekyb3d8bbwe")),
            (sig(&[], &[], &["ms-teams.exe"]), meeting("Teams", "ms-teams.exe")),
            (sig(&[], &[], &["C:#Program Files#Zoom#bin#Zoom.exe"]), meeting("Zoom", "zoom.exe")),
            (sig(&[], &[], &["CiscoCollabHost.exe"]), meeting("Webex", "ciscocollabhost.exe")),
            (sig(&[], &[("slack.exe", "Huddle with Alya - Slack")], &[]), meeting("Slack huddle", "slack.exe")),
            (sig(&["chrome.exe"], &[("chrome.exe", "Meet - abc-defg-hij - Google Chrome")], &["chrome.exe"]), meeting("Google Meet", "chrome.exe")),
            (sig(&[], &[("msedge.exe", "Chat | Microsoft Teams - Edge")], &["C:#Program Files (x86)#Microsoft#Edge#Application#msedge.exe"]), meeting("Teams", "msedge.exe")),
        ];
        for (s, want) in cases {
            assert_eq!(source_kind(&s, &on, &[]), want, "{s:?}");
        }
    }

    #[test]
    fn a_meet_tab_without_the_microphone_is_media() {
        let s = sig(&["chrome.exe"], &[("chrome.exe", "Meet - abc - Google Chrome")], &[]);
        assert_eq!(source_kind(&s, &MeetingFamilies::default(), &[]), SourceKind::Media);
    }

    #[test]
    fn a_slack_window_that_is_no_huddle_is_nothing() {
        let s = sig(&[], &[("slack.exe", "general - Acme - Slack")], &[]);
        assert_eq!(source_kind(&s, &MeetingFamilies::default(), &[]), SourceKind::None);
    }

    #[test]
    fn a_family_switched_off_falls_back_to_media() {
        let mut f = MeetingFamilies::default();
        f.slack = false;
        let s = sig(&[], &[("slack.exe", "Huddle with Alya - Slack")], &[]);
        assert_eq!(source_kind(&s, &f, &[]), SourceKind::Media);
        f.zoom = false;
        assert_eq!(source_kind(&sig(&[], &[], &["Zoom.exe"]), &f, &[]), SourceKind::Media);
    }

    #[test]
    fn the_persons_app_and_host_are_meetings() {
        let mine = [
            MeetingApp { kind: MeetingAppKind::App, value: "ZohoMeeting.exe".into(), label: "Zoho Meeting".into() },
            MeetingApp { kind: MeetingAppKind::Host, value: "meeting.tencent.com".into(), label: "Tencent Meeting".into() },
        ];
        let f = MeetingFamilies::default();
        assert_eq!(source_kind(&sig(&[], &[], &["C:#Zoho#ZohoMeeting.exe"]), &f, &mine), meeting("Zoho Meeting", "zohomeeting.exe"));
        let web = sig(&["chrome.exe"], &[("chrome.exe", "meeting.tencent.com/dm/x - Google Chrome")], &[]);
        assert_eq!(source_kind(&web, &f, &mine), meeting("Tencent Meeting", "chrome.exe"));
        let joined = Signals { joined: Some("meeting.tencent.com".into()), ..sig(&["wemeetapp.exe"], &[], &[]) };
        assert_eq!(source_kind(&joined, &f, &mine), meeting("Tencent Meeting", "meeting.tencent.com"));
    }

    #[test]
    fn a_joined_link_names_the_meeting_by_its_host_while_sound_plays() {
        let f = MeetingFamilies::default();
        let s = Signals { joined: Some("voovmeeting.com".into()), ..sig(&["chrome.exe"], &[], &[]) };
        assert_eq!(source_kind(&s, &f, &[]), meeting("voovmeeting.com", "joined link"));
        let quiet = Signals { joined: Some("voovmeeting.com".into()), ..Signals::default() };
        assert_eq!(source_kind(&quiet, &f, &[]), SourceKind::None);
    }

    #[test]
    fn a_calendar_meeting_is_a_meeting() {
        let s = Signals { calendar_meeting: true, ..Signals::default() };
        assert_eq!(source_kind(&s, &MeetingFamilies::default(), &[]), meeting("Calendar meeting", "calendar"));
    }

    #[test]
    fn music_is_not_media_and_nothing_is_nothing() {
        let f = MeetingFamilies::default();
        assert_eq!(source_kind(&sig(&["Spotify.exe"], &[], &[]), &f, &[]), SourceKind::None);
        assert_eq!(source_kind(&sig(&["chrome.exe"], &[], &[]), &f, &[]), SourceKind::Media);
        assert_eq!(source_kind(&Signals::default(), &f, &[]), SourceKind::None);
    }

    #[test]
    fn host_of_keeps_only_the_host() {
        assert_eq!(host_of("https://meeting.tencent.com/dm/sample?x=1").as_deref(), Some("meeting.tencent.com"));
        assert_eq!(host_of("  HTTP://User@Zoom.US:443/j/1 ").as_deref(), Some("zoom.us"));
        assert_eq!(host_of("msteams:/l/meetup-join/19%3a").as_deref(), None, "msteams:/l/ has no host");
        assert_eq!(host_of("zoommtg://zoom.us/join?confno=1").as_deref(), Some("zoom.us"));
        for junk in ["", "hello", "javascript:alert(1)", "file:///C:/x", "https://", "https://no_dots/", "https://a b.com/", "ftp://x.com"] {
            assert_eq!(host_of(junk), None, "{junk}");
        }
    }

    #[test]
    fn unknown_hosts_are_offered_once_known_ones_are_not() {
        let mine = [MeetingApp { kind: MeetingAppKind::Host, value: "meeting.tencent.com".into(), label: "Tencent Meeting".into() }];
        assert!(is_known_host("teams.microsoft.com", &[]));
        assert!(is_known_host("us02web.zoom.us", &[]));
        assert!(is_known_host("Meeting.Tencent.com", &mine));
        assert!(!is_known_host("meeting.tencent.com", &[]));
        assert!(!is_known_host("notzoom.us", &[]));
    }

    #[test]
    fn adding_keeps_only_the_host_or_the_process_name_once() {
        let mut apps = Vec::new();
        assert_eq!(add_link(&mut apps, "https://meeting.tencent.com/dm/sample").as_deref(), Some("meeting.tencent.com"));
        assert_eq!(add_link(&mut apps, "https://meeting.tencent.com/other"), None, "already there");
        assert_eq!(add_link(&mut apps, "not a link"), None);
        assert!(add_app(&mut apps, "ZohoMeeting.exe"));
        assert!(!add_app(&mut apps, "zohomeeting.exe"), "already there");
        assert!(!add_app(&mut apps, "Zoom.exe"), "a built-in family");
        assert_eq!(apps.len(), 2);
        assert_eq!((apps[0].value.as_str(), apps[1].label.as_str()), ("meeting.tencent.com", "ZohoMeeting"));
    }

    #[test]
    fn a_joined_link_stays_active_for_ten_minutes() {
        let mut j = Joined::default();
        assert_eq!(j.active(0.0), None);
        j.joined("Meeting.Tencent.com", 100.0);
        assert_eq!(j.active(100.0), Some("meeting.tencent.com"));
        assert_eq!(j.active(100.0 + JOINED_S - 0.1), Some("meeting.tencent.com"));
        assert_eq!(j.active(100.0 + JOINED_S), None);
    }

    #[test]
    fn an_unknown_joined_host_is_offered_once_and_never_once_listed() {
        let mut mine = Vec::new();
        let asked = vec!["zoom.example.org".to_string()];
        assert_eq!(host_offer(Some("meeting.tencent.com"), &mine, &asked), Some("meeting.tencent.com"));
        assert_eq!(host_offer(Some("Zoom.Example.org"), &mine, &asked), None, "answered already");
        assert_eq!(host_offer(Some("teams.microsoft.com"), &mine, &asked), None, "a built-in");
        assert_eq!(host_offer(None, &mine, &asked), None);
        add_link(&mut mine, "https://meeting.tencent.com/dm/x");
        assert_eq!(host_offer(Some("meeting.tencent.com"), &mine, &asked), None, "added");
    }

    #[test]
    fn a_session_says_whether_it_heard_a_meeting() {
        let mut s = SessionSeen::default();
        s.saw(&SourceKind::Media, Some("A video"));
        assert!(!s.meeting());
        s.saw(&SourceKind::Meeting { label: "Teams".into(), via: "ms-teams.exe".into() }, None);
        assert!(s.meeting());
    }
}

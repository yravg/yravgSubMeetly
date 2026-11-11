//! Auto-detect meetings, the pure part: which running app a Mac's probe saw is a meeting app
//! ([`normalize`]), and when that is worth telling the person ([`Detector`]: held for a few
//! seconds, once per meeting). The Mac's probe (`poni/src/mac/services/meeting_probe.rs`) reads the
//! apps CoreAudio says are recording the microphone and, where macOS lets it, window owners and
//! titles; [`crate::meeting_source::source_kind`] classifies them like on Windows. Nothing leaves
//! the Mac.

use crate::meeting_source::SourceKind;

/// A meeting must hold this long before it is offered: a mic blip (a dictation, a voice memo) is not one.
pub const DETECT_S: f64 = 6.0;
/// A meeting gone this long has ended: the next one is offered again.
pub const ENDED_S: f64 = 30.0;

/// The name [`crate::meeting_source::source_kind`] matches on for a macOS bundle id or app name:
/// the Windows process name of the same app (`us.zoom.xos` → `zoom.exe`), so one classifier serves both.
/// Anything not a known meeting app or browser comes back as it was.
pub fn normalize(id_or_name: &str) -> String {
    let l = id_or_name.trim().to_ascii_lowercase();
    let is = |s: &str| l == s;
    let has = |s: &str| l.contains(s);
    let mapped = if is("us.zoom.xos") || has("zoom.us") {
        "zoom.exe"
    } else if is("com.microsoft.teams2") || is("com.microsoft.teams") || has("microsoft teams") || is("msteams") {
        "ms-teams.exe"
    } else if has("webex") || is("cisco-systems.spark") {
        "webex.exe"
    } else if is("com.tinyspeck.slackmacgap") || is("slack") {
        "slack.exe"
    } else if has("com.google.chrome") || has("google chrome") {
        "chrome.exe"
    } else if is("com.microsoft.edgemac") || is("microsoft edge") {
        "msedge.exe"
    } else if is("org.mozilla.firefox") || is("firefox") {
        "firefox.exe"
    } else if is("com.brave.browser") || is("brave browser") {
        "brave.exe"
    } else if is("company.thebrowser.browser") || is("arc") {
        "arc.exe"
    } else if is("com.apple.safari") || is("safari") {
        // The shared classifier has no Safari: it counts as a browser by this name.
        "chrome.exe"
    } else {
        return id_or_name.trim().to_string();
    };
    mapped.to_string()
}

/// What the detector wants done.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DetectStep {
    Nothing,
    /// Tell the person a meeting is on (`label`: "Zoom", "Calendar meeting"…), once.
    Offer { label: String },
}

#[derive(Clone, Debug, Default)]
pub struct Detector {
    /// The meeting being watched and since when.
    since: Option<(String, f64)>,
    /// The meeting already offered (until it ends).
    offered: bool,
    gone_since: Option<f64>,
}

impl Detector {
    /// `kind`: what plays now; `enabled`: Settings › "Tell me when a meeting starts".
    pub fn step(&mut self, kind: &SourceKind, enabled: bool, now: f64) -> DetectStep {
        if !enabled {
            *self = Self::default();
            return DetectStep::Nothing;
        }
        let SourceKind::Meeting { label, .. } = kind else {
            let gone = *self.gone_since.get_or_insert(now);
            if now - gone >= ENDED_S {
                *self = Self::default();
            } else {
                // Held back, not forgotten: a short drop in a call doesn't start a new one.
                self.since = None;
            }
            return DetectStep::Nothing;
        };
        self.gone_since = None;
        if self.offered {
            return DetectStep::Nothing;
        }
        let since = match &self.since {
            Some((l, t)) if l == label => *t,
            _ => {
                self.since = Some((label.clone(), now));
                now
            }
        };
        if now - since >= DETECT_S {
            self.offered = true;
            return DetectStep::Offer { label: label.clone() };
        }
        DetectStep::Nothing
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meeting_source::{source_kind, MeetingFamilies, Signals};

    fn meeting(l: &str) -> SourceKind {
        SourceKind::Meeting { label: l.into(), via: "x".into() }
    }

    #[test]
    fn bundle_ids_become_the_names_the_classifier_knows() {
        assert_eq!(normalize("us.zoom.xos"), "zoom.exe");
        assert_eq!(normalize("zoom.us"), "zoom.exe");
        assert_eq!(normalize("com.microsoft.teams2"), "ms-teams.exe");
        assert_eq!(normalize("Microsoft Teams (work or school)"), "ms-teams.exe");
        assert_eq!(normalize("Cisco-Systems.Spark"), "webex.exe");
        assert_eq!(normalize("com.tinyspeck.slackmacgap"), "slack.exe");
        assert_eq!(normalize("com.google.Chrome"), "chrome.exe");
        assert_eq!(normalize("Google Chrome"), "chrome.exe");
        assert_eq!(normalize("company.thebrowser.Browser"), "arc.exe");
        assert_eq!(normalize("com.apple.dt.Xcode"), "com.apple.dt.Xcode", "anything else is left as it was");
    }

    #[test]
    fn a_zoom_or_teams_app_on_the_microphone_is_a_meeting_but_a_browser_alone_is_not() {
        let f = MeetingFamilies::default();
        let sig = |mic: &[&str]| Signals { mic: mic.iter().map(|m| normalize(m)).collect(), ..Signals::default() };
        assert_eq!(source_kind(&sig(&["us.zoom.xos"]), &f, &[]), SourceKind::Meeting { label: "Zoom".into(), via: "zoom.exe".into() });
        assert!(matches!(source_kind(&sig(&["com.microsoft.teams2"]), &f, &[]), SourceKind::Meeting { .. }));
        // A browser on the microphone with no readable title (no Screen Recording permission) says nothing.
        assert!(!matches!(source_kind(&sig(&["com.google.Chrome"]), &f, &[]), SourceKind::Meeting { .. }));
        // With the title it is Google Meet.
        let web = Signals { mic: vec![normalize("com.google.Chrome")], windows: vec![(normalize("Google Chrome"), "Meet - abc-defg-hij".into())], ..Signals::default() };
        assert!(matches!(source_kind(&web, &f, &[]), SourceKind::Meeting { label, .. } if label == "Google Meet"));
        // A calendar meeting alone is one too.
        let cal = Signals { calendar_meeting: true, ..Signals::default() };
        assert!(matches!(source_kind(&cal, &f, &[]), SourceKind::Meeting { label, .. } if label == "Calendar meeting"));
    }

    #[test]
    fn it_offers_after_the_hold_and_only_once_per_meeting() {
        let mut d = Detector::default();
        let m = meeting("Zoom");
        assert_eq!(d.step(&m, true, 0.0), DetectStep::Nothing);
        assert_eq!(d.step(&m, true, DETECT_S - 0.1), DetectStep::Nothing);
        assert_eq!(d.step(&m, true, DETECT_S), DetectStep::Offer { label: "Zoom".into() });
        assert_eq!(d.step(&m, true, DETECT_S + 5.0), DetectStep::Nothing, "already offered");
        assert_eq!(d.step(&m, true, 600.0), DetectStep::Nothing, "still the same meeting");
    }

    #[test]
    fn a_blip_is_not_a_meeting() {
        let mut d = Detector::default();
        assert_eq!(d.step(&meeting("Zoom"), true, 0.0), DetectStep::Nothing);
        assert_eq!(d.step(&SourceKind::None, true, 3.0), DetectStep::Nothing);
        // It starts counting again when it returns.
        assert_eq!(d.step(&meeting("Zoom"), true, 4.0), DetectStep::Nothing);
        assert_eq!(d.step(&meeting("Zoom"), true, 4.0 + DETECT_S - 1.0), DetectStep::Nothing);
        assert_eq!(d.step(&meeting("Zoom"), true, 4.0 + DETECT_S), DetectStep::Offer { label: "Zoom".into() });
    }

    #[test]
    fn a_short_drop_inside_a_call_does_not_offer_it_again_but_an_ended_one_does() {
        let mut d = Detector::default();
        let m = meeting("Teams");
        d.step(&m, true, 0.0);
        assert!(matches!(d.step(&m, true, DETECT_S), DetectStep::Offer { .. }));
        // Muted for 10 s: the same call.
        d.step(&SourceKind::None, true, 20.0);
        assert_eq!(d.step(&m, true, 30.0), DetectStep::Nothing);
        assert_eq!(d.step(&m, true, 40.0), DetectStep::Nothing);
        // Gone for ENDED_S: the next one is new.
        d.step(&SourceKind::None, true, 100.0);
        d.step(&SourceKind::None, true, 100.0 + ENDED_S);
        d.step(&m, true, 200.0);
        assert!(matches!(d.step(&m, true, 200.0 + DETECT_S), DetectStep::Offer { .. }));
    }

    #[test]
    fn a_changed_meeting_restarts_the_hold_and_off_means_nothing() {
        let mut d = Detector::default();
        d.step(&meeting("Zoom"), true, 0.0);
        assert_eq!(d.step(&meeting("Teams"), true, DETECT_S), DetectStep::Nothing, "a different one has its own hold");
        assert_eq!(d.step(&meeting("Teams"), false, 2.0 * DETECT_S), DetectStep::Nothing, "switched off");
        assert_eq!(d.step(&meeting("Teams"), true, 100.0), DetectStep::Nothing, "off forgot it, the hold starts again");
        assert!(matches!(d.step(&meeting("Teams"), true, 100.0 + DETECT_S), DetectStep::Offer { .. }));
    }
}

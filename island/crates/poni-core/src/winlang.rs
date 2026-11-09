//! Windows language features the island can use, and how to add one.
//!
//! Only one path depends on a Windows language feature: reading kanji
//! (`Windows.Globalization.JapanesePhoneticAnalyzer`, whose dictionary ships
//! with Windows' Japanese typing feature). Korean and Chinese readings, the
//! Prayer page, the Downloader and the engine's captions need none, so the
//! list holds one feature; it is a list so the next one is a row, not a rewrite.
//!
//! The install is one fixed command per known feature, run elevated through a
//! UAC prompt: nothing a person or a file typed ever reaches it
//! ([`install_params`] builds it from a constant). This module is the pure
//! part: names, the command line, and what a finished attempt means.

/// One Windows language feature the island can use.
#[derive(Debug, PartialEq, Eq)]
pub struct Feature {
    /// Stable id (`AppEvent::WinLang`, the Settings row).
    pub id: &'static str,
    /// The row's label.
    pub name: &'static str,
    /// What it is for, as the row's second line says it.
    pub why: &'static str,
    /// The Windows capability that adds it (`Add-WindowsCapability -Name`).
    pub capability: &'static str,
}

/// Japanese typing: Windows' reading data for kanji.
pub const JAPANESE_TYPING: Feature =
    Feature { id: "ja-typing", name: "Japanese typing", why: "Romaji for kanji under Japanese lyrics", capability: "Language.Basic~~~ja-JP~0.0.1.0" };

/// Every feature, in the order Settings lists them.
pub const ALL: [&Feature; 1] = [&JAPANESE_TYPING];

/// Windows' own page for adding a language, for when the install can't run.
pub const SETTINGS_URI: &str = "ms-settings:regionlanguage";

/// The feature with this id.
pub fn by_id(id: &str) -> Option<&'static Feature> {
    ALL.iter().copied().find(|f| f.id == id)
}

/// Where a feature stands on this PC.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum State {
    /// Not looked at yet.
    #[default]
    Unknown,
    /// The island can use it.
    Installed,
    /// Windows doesn't have it.
    Missing,
    /// The elevated install is running.
    Installing,
    /// The last attempt didn't end with it in place; why, in a sentence.
    Failed(String),
}

impl State {
    /// A feature that is there or being added doesn't ask again.
    pub fn can_install(&self) -> bool {
        matches!(self, State::Missing | State::Failed(_))
    }
}

/// What a check found: the analyzer reading a line is "installed", anything
/// else is "missing" (the analyzer's own message goes to the log).
pub fn from_check(works: Result<(), String>) -> State {
    if works.is_ok() {
        State::Installed
    } else {
        State::Missing
    }
}

/// How the elevated install ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ran {
    /// The UAC prompt was declined (or closed).
    Cancelled,
    /// The command never started (no PowerShell, or Windows refused).
    NotStarted,
    /// It ran and exited with this code (0 = Windows reports success).
    Exit(u32),
}

/// What an attempt means, once the check ran again (`works_now`). A feature
/// that reads counts whatever the exit code said.
pub fn after_install(ran: Ran, works_now: bool) -> State {
    if works_now {
        return State::Installed;
    }
    State::Failed(match ran {
        Ran::Cancelled => "Windows asked for permission and it wasn't given".to_string(),
        Ran::NotStarted => "Windows' installer didn't start; add it in Windows Settings".to_string(),
        Ran::Exit(0) => "Installed, but not ready yet: restart Windows, then check again".to_string(),
        Ran::Exit(code) => format!("Windows couldn't add it (code {code}): check the internet connection, or add it in Windows Settings"),
    })
}

/// The arguments for `powershell.exe` that add `f`, run elevated. Fixed text
/// around a capability name from [`ALL`]; the try/catch makes a failure the
/// exit code (`Add-WindowsCapability` otherwise ends with 0 after an error).
pub fn install_params(f: &Feature) -> String {
    format!("-NoProfile -ExecutionPolicy Bypass -Command \"try {{ Add-WindowsCapability -Online -Name '{}' -ErrorAction Stop | Out-Null }} catch {{ exit 1 }}\"", f.capability)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn japanese_typing_is_the_basic_typing_capability_for_ja_jp() {
        assert_eq!(JAPANESE_TYPING.capability, "Language.Basic~~~ja-JP~0.0.1.0");
        assert_eq!(by_id("ja-typing"), Some(&JAPANESE_TYPING));
        assert_eq!(by_id("ja-typing; calc"), None);
    }

    #[test]
    fn capability_names_hold_only_the_characters_windows_uses() {
        for f in ALL {
            assert!(f.capability.starts_with("Language."), "{}", f.id);
            assert!(f.capability.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '~' | '-')), "{}", f.capability);
        }
        let ids: Vec<_> = ALL.iter().map(|f| f.id).collect();
        assert!(ids.iter().enumerate().all(|(i, id)| !ids[..i].contains(id)), "ids are unique");
    }

    #[test]
    fn the_elevated_command_is_fixed_text_around_the_capability() {
        assert_eq!(
            install_params(&JAPANESE_TYPING),
            "-NoProfile -ExecutionPolicy Bypass -Command \"try { Add-WindowsCapability -Online -Name 'Language.Basic~~~ja-JP~0.0.1.0' -ErrorAction Stop | Out-Null } catch { exit 1 }\""
        );
    }

    #[test]
    fn a_check_is_installed_or_missing() {
        assert_eq!(from_check(Ok(())), State::Installed);
        assert_eq!(from_check(Err("no data".into())), State::Missing);
        assert_eq!(State::default(), State::Unknown);
    }

    #[test]
    fn only_a_missing_or_failed_feature_offers_the_install() {
        assert!(State::Missing.can_install());
        assert!(State::Failed("x".into()).can_install());
        for s in [State::Unknown, State::Installed, State::Installing] {
            assert!(!s.can_install(), "{s:?}");
        }
    }

    #[test]
    fn a_finished_attempt_says_what_happened() {
        assert_eq!(after_install(Ran::Exit(0), true), State::Installed);
        assert_eq!(after_install(Ran::Cancelled, true), State::Installed, "already there: fine");
        let why = |ran| match after_install(ran, false) {
            State::Failed(s) => s,
            other => panic!("{other:?}"),
        };
        assert!(why(Ran::Cancelled).contains("permission"));
        assert!(why(Ran::NotStarted).contains("Windows Settings"));
        assert!(why(Ran::Exit(0)).contains("restart"));
        assert!(why(Ran::Exit(1)).contains("code 1"));
    }
}

//! Keeping an engine there: what the island does when it asks `/health`, and
//! the words it shows for the answer. Pure; `poni::services::engine` does the
//! spawning and the asking.

use crate::helper::Health;

/// Spawns tried before the island stops trying until the person says "Start".
pub const MAX_SPAWNS: u32 = 3;
/// Seconds an engine just started gets to answer before the next try.
pub const START_GRACE_SECS: f64 = 20.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// Something answers: use it, start nothing.
    Use,
    /// Nothing answers and the exe is there: start it.
    Spawn,
    /// Started a moment ago: give it time.
    Wait,
    /// Nothing answers and there is no engine exe to start.
    Missing,
    /// Started `MAX_SPAWNS` times and it never answered.
    Failed,
}

/// `answers`: /health said ok. `spawns`: starts so far. `since_spawn`: seconds
/// since the last one (None = never).
pub fn decide(answers: bool, exe_found: bool, spawns: u32, since_spawn: Option<f64>) -> Action {
    if answers {
        return Action::Use;
    }
    if !exe_found {
        return Action::Missing;
    }
    if since_spawn.is_some_and(|s| s < START_GRACE_SECS) {
        return Action::Wait;
    }
    if spawns >= MAX_SPAWNS {
        Action::Failed
    } else {
        Action::Spawn
    }
}

/// What the island knows about the engine, for the menu and the pages.
#[derive(Clone, Debug, PartialEq)]
pub struct EngineInfo {
    pub line: String,
    /// Something answers /health.
    pub running: bool,
    /// The island started the engine that answers (it may restart and stop it).
    pub ours: bool,
    /// The Chrome extension has reached the engine at least once.
    pub ext_seen: bool,
}

impl Default for EngineInfo {
    fn default() -> Self {
        Self { line: "Engine: checking…".into(), running: false, ours: false, ext_seen: false }
    }
}

/// The menu's greyed status line.
pub fn status_line(answering: Option<&Health>, port: u16, last: Action) -> String {
    match answering {
        Some(h) if h.rust => format!("Engine: running (Rust) on {port}"),
        Some(h) if h.engine.is_empty() => format!("Engine: running (other helper) on {port}"),
        Some(h) => format!("Engine: running (other helper, {}) on {port}", h.engine),
        None => match last {
            Action::Wait | Action::Spawn => "Engine: starting…".into(),
            Action::Missing => "Engine: not installed".into(),
            Action::Failed => "Engine: could not start".into(),
            Action::Use => "Engine: not running".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn health(rust: bool, engine: &str) -> Health {
        Health { rust, engine: engine.into(), ..Default::default() }
    }

    #[test]
    fn an_answering_helper_is_used_whoever_it_is() {
        assert_eq!(decide(true, true, 0, None), Action::Use);
        assert_eq!(decide(true, false, 3, Some(1.0)), Action::Use);
    }

    #[test]
    fn silence_starts_the_engine_once_then_waits_then_gives_up() {
        assert_eq!(decide(false, true, 0, None), Action::Spawn);
        assert_eq!(decide(false, true, 1, Some(2.0)), Action::Wait);
        assert_eq!(decide(false, true, 1, Some(START_GRACE_SECS)), Action::Spawn);
        assert_eq!(decide(false, true, MAX_SPAWNS, Some(60.0)), Action::Failed);
    }

    #[test]
    fn no_exe_is_said_not_hidden() {
        assert_eq!(decide(false, false, 0, None), Action::Missing);
    }

    #[test]
    fn the_status_line_names_the_engine_that_answers() {
        assert_eq!(status_line(Some(&health(true, "candle")), 17865, Action::Use), "Engine: running (Rust) on 17865");
        assert_eq!(status_line(Some(&health(false, "faster-whisper")), 17865, Action::Use), "Engine: running (other helper, faster-whisper) on 17865");
        assert_eq!(status_line(None, 17865, Action::Use), "Engine: not running");
        assert_eq!(status_line(None, 17865, Action::Wait), "Engine: starting…");
        assert_eq!(status_line(None, 17865, Action::Missing), "Engine: not installed");
        assert_eq!(status_line(None, 17865, Action::Failed), "Engine: could not start");
    }
}

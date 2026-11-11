//! What could be a meeting. The Windows probe reads the visible windows and
//! the apps using the microphone; the Mac has none yet, so only the type the
//! shared state holds lives here, and it stays empty.

/// What the probe saw: (process name, title) per window, and the microphone users.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Seen {
    pub windows: Vec<(String, String)>,
    pub mic: Vec<String>,
}

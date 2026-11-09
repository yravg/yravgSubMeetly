//! Engine state directory: where notes, device mode, engine mode and UI prefs live.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_APP_DIR: &str = ".yraveragesubmin";
pub const LEGACY_APP_DIR: &str = ".localtranssub";

pub fn home_dir() -> Option<PathBuf> {
    for key in ["USERPROFILE", "HOME"] {
        if let Some(value) = env::var_os(key) {
            if !value.is_empty() {
                return Some(PathBuf::from(value));
            }
        }
    }
    None
}

fn env_or(key: &str, fallback: impl FnOnce() -> PathBuf) -> PathBuf {
    match env::var_os(key) {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => fallback(),
    }
}

/// `YSM_STATE_DIR`, else `~/.yraveragesubmin`.
pub fn default_state_dir() -> PathBuf {
    env_or("YSM_STATE_DIR", || {
        home_dir()
            .map(|home| home.join(DEFAULT_APP_DIR))
            .unwrap_or_else(|| PathBuf::from(DEFAULT_APP_DIR))
    })
}

pub fn legacy_state_dir() -> PathBuf {
    home_dir()
        .map(|home| home.join(LEGACY_APP_DIR))
        .unwrap_or_else(|| PathBuf::from(LEGACY_APP_DIR))
}

/// Move the legacy directory once, when the new one does not exist yet.
///
/// Mirrors `_migrate_state_dir` in native/server.py: a failed rename (other
/// volume, permissions) falls back to copying the files one by one and leaves
/// the old directory in place.
pub fn migrate_state_dir(state: &Path, legacy: &Path) {
    if state.exists() || !legacy.is_dir() {
        return;
    }
    if let Some(parent) = state.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if fs::rename(legacy, state).is_ok() {
        return;
    }
    if fs::create_dir_all(state).is_err() {
        return;
    }
    let Ok(entries) = fs::read_dir(legacy) else {
        return;
    };
    for entry in entries.flatten() {
        let target = state.join(entry.file_name());
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        if is_file && !target.exists() {
            let _ = fs::copy(entry.path(), target);
        }
    }
}

pub fn ymd_hms_from_epoch(secs: u64) -> (i64, u32, u32, u64, u64, u64) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    (year, month, day, rem / 3_600, (rem % 3_600) / 60, rem % 60)
}

// Howard Hinnant's civil-from-days, valid for the whole proleptic Gregorian
// calendar.
pub(crate) fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

pub fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `YYYY-MM-DDTHH:MM:SSZ` in UTC.
pub fn now_utc_iso() -> String {
    let (year, month, day, hour, minute, second) = ymd_hms_from_epoch(now_epoch_secs());
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates_are_correct() {
        assert_eq!(now_utc_iso().len(), 20);
        assert_eq!(ymd_hms_from_epoch(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(
            ymd_hms_from_epoch(1_700_000_000),
            (2023, 11, 14, 22, 13, 20)
        );
    }
}

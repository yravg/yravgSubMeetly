//! Export a meeting's transcript as CSV: ask the engine (`POST /notes/export`, `format: csv`, which
//! answers `{filename, content}` with the UTF-8 BOM Excel wants) and write the file into a folder
//! (Downloads). `AppEvent::Exported` says where it went, or why not. Shared by Windows and the Mac.

use crate::events::{AppEvent, EventSink};
use poni_core::helper;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Save the CSV of meeting `id` in `dir`, off the UI thread.
pub fn csv(sink: EventSink, port: u16, id: String, dir: PathBuf) {
    std::thread::Builder::new()
        .name("poni-export".into())
        .spawn(move || sink.send(AppEvent::Exported(run(port, &id, &dir))))
        .ok();
}

fn run(port: u16, id: &str, dir: &Path) -> Result<String, String> {
    let body = serde_json::json!({ "id": id, "format": "csv" }).to_string();
    let (code, reply) = helper::request(port, "POST", "/notes/export", Some(&body)).map_err(|e| format!("The engine is not answering ({e})."))?;
    if code != 200 {
        let why = serde_json::from_str::<Value>(&reply).ok().and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string));
        return Err(why.unwrap_or_else(|| format!("The engine said {code}.")));
    }
    let v: Value = serde_json::from_str(&reply).map_err(|_| "The engine's export was not in a shape this version reads.".to_string())?;
    let name = v.get("filename").and_then(Value::as_str).filter(|n| !n.is_empty()).unwrap_or("meeting.csv");
    let content = v.get("content").and_then(Value::as_str).ok_or("The engine sent no content.")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not open {}: {e}", dir.display()))?;
    let path = unique_path(dir, name);
    std::fs::write(&path, content).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

/// `dir/name`, or `dir/name (2).ext`, `(3)`… when that file exists: an export never overwrites one.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("meeting");
    let ext = p.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|c| !c.exists())
        .unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_never_overwrites_a_file() {
        let dir = std::env::temp_dir().join(format!("poni-export-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_path(&dir, "Standup.csv"), dir.join("Standup.csv"));
        std::fs::write(dir.join("Standup.csv"), "x").unwrap();
        assert_eq!(unique_path(&dir, "Standup.csv"), dir.join("Standup (2).csv"));
        std::fs::write(dir.join("Standup (2).csv"), "x").unwrap();
        assert_eq!(unique_path(&dir, "Standup.csv"), dir.join("Standup (3).csv"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

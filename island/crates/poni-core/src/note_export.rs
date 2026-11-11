//! A meeting's notes exported as Word, PDF or Markdown by the engine (`POST /notes/export`),
//! saved in Documents › yravgSubMeetly › Exports, and shown in the file manager.

use crate::helper;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Documents › yravgSubMeetly › Exports of this person.
pub fn export_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    home.join("Documents").join("yravgSubMeetly").join("Exports")
}

/// `name`, or `name-2`, `name-3` ... when a file of that name is already in `dir`.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s, format!(".{e}")),
        None => (name, String::new()),
    };
    (2..).map(|n| dir.join(format!("{stem}-{n}{ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

/// Standard base64 (with or without padding); None on a character outside the alphabet.
pub fn decode_base64(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in s.trim_end_matches('=').as_bytes() {
        if c == b'\n' || c == b'\r' {
            continue;
        }
        acc = acc << 6 | val(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// Ask the engine for note `id` as `format` (`docx`, `pdf`, `markdown`) and save it.
pub fn save(port: u16, id: &str, format: &str) -> Result<PathBuf, String> {
    let body = serde_json::json!({ "id": id, "format": format }).to_string();
    let (code, reply) = helper::request(port, "POST", "/notes/export", Some(&body)).map_err(|e| format!("The engine is not answering ({e})."))?;
    let v: Value = serde_json::from_str(&reply).map_err(|_| "The engine's answer was not JSON.".to_string())?;
    if code != 200 {
        return Err(v.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("The engine said {code}.")));
    }
    let name = v.get("filename").and_then(Value::as_str).unwrap_or("notes").to_string();
    let content = v.get("content").and_then(Value::as_str).ok_or("The engine sent no file.")?;
    let bytes = if v.get("encoding").and_then(Value::as_str) == Some("base64") { decode_base64(content).ok_or("The file came back damaged.")? } else { content.as_bytes().to_vec() };
    let dir = export_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make {} ({e}).", dir.display()))?;
    let path = unique_path(&dir, &name);
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save {} ({e}).", path.display()))?;
    Ok(path)
}

/// Show `path` in Explorer / Finder (best effort).
pub fn reveal(path: &Path) {
    #[cfg(windows)]
    let _ = std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("/usr/bin/open").arg("-R").arg(path).spawn();
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_decodes_the_rfc_vectors() {
        assert_eq!(decode_base64("").unwrap(), b"");
        assert_eq!(decode_base64("Zg==").unwrap(), b"f");
        assert_eq!(decode_base64("Zm8=").unwrap(), b"fo");
        assert_eq!(decode_base64("Zm9vYmFy").unwrap(), b"foobar");
        assert_eq!(decode_base64("Zm9v\nYmFy").unwrap(), b"foobar");
        assert!(decode_base64("Zm9v*").is_none());
    }

    #[test]
    fn a_name_in_use_gets_a_number() {
        let dir = std::env::temp_dir().join(format!("poni-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_path(&dir, "a.pdf"), dir.join("a.pdf"));
        std::fs::write(dir.join("a.pdf"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a.pdf"), dir.join("a-2.pdf"));
        std::fs::write(dir.join("a-2.pdf"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "a.pdf"), dir.join("a-3.pdf"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

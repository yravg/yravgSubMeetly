//! Read-only static server for the built extension pages at `/app/<file>`, so
//! the Minutes register and the setup pages open in any browser without the
//! extension. Loopback peer, loopback Host, GET/HEAD only, no path escapes.

use crate::app::{host_header_hostname, is_loopback_host};
use crate::protocol::Request;
use std::path::{Path, PathBuf};

pub struct WebResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

/// The how-to page lives in the engine, so it never enters the store zip.
const SETUP_PAGE: &str = include_str!("../web/setup-extension.html");

/// Folder with the built pages: `SUBMEETLY_APP_DIR`, else `app` or `extension`
/// next to the engine exe.
pub fn app_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("SUBMEETLY_APP_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    let exe = std::env::current_exe().ok()?;
    let base = exe.parent()?;
    ["app", "extension"]
        .iter()
        .map(|n| base.join(n))
        .find(|p| p.is_dir())
}

/// `Some` when the request targets `/app`; the server then writes this reply.
pub fn serve(request: &Request) -> Option<WebResponse> {
    let path = request.target.split(['?', '#']).next().unwrap_or("");
    let rest = path
        .strip_prefix("/app/")
        .or_else(|| (path == "/app").then_some(""))?;
    let head = request.method.eq_ignore_ascii_case("HEAD");
    if !head && !request.method.eq_ignore_ascii_case("GET") {
        return Some(text(405, "alleen GET"));
    }
    if !request.peer_loopback
        || !is_loopback_host(host_header_hostname(request.header("Host").unwrap_or("")))
    {
        return Some(text(403, "helper hanya melayani loopback"));
    }
    let name = if rest.is_empty() {
        "minutes.html"
    } else {
        rest
    };
    let mut reply = if name == "setup-extension.html" {
        WebResponse {
            status: 200,
            content_type: "text/html; charset=utf-8",
            body: SETUP_PAGE.as_bytes().to_vec(),
        }
    } else {
        match app_dir().and_then(|root| safe_join(&root, name)) {
            Some(file) => match std::fs::read(&file) {
                Ok(body) => WebResponse {
                    status: 200,
                    content_type: content_type(&file),
                    body,
                },
                Err(_) => text(404, "tidak ditemukan"),
            },
            None => text(404, "tidak ditemukan"),
        }
    };
    if head {
        reply.body.clear();
    }
    Some(reply)
}

fn text(status: u16, msg: &str) -> WebResponse {
    WebResponse {
        status,
        content_type: "text/plain; charset=utf-8",
        body: msg.as_bytes().to_vec(),
    }
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `name` (still percent-encoded) under `root`, or None for anything that is
/// not a plain relative path inside it. Decodes once, then refuses.
pub fn safe_join(root: &Path, name: &str) -> Option<PathBuf> {
    let decoded = percent_decode(name)?;
    if decoded.is_empty() || decoded.contains(['\\', ':', '\0']) || decoded.starts_with('/') {
        return None;
    }
    if decoded
        .split('/')
        .any(|seg| seg.is_empty() || seg == "." || seg == "..")
    {
        return None;
    }
    let root = root.canonicalize().ok()?;
    let file = root.join(&decoded).canonicalize().ok()?;
    (file.starts_with(&root) && file.is_file()).then_some(file)
}

pub fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(method: &str, target: &str, host: &str, loopback: bool) -> Request {
        Request {
            method: method.into(),
            target: target.into(),
            headers: vec![("host".into(), host.into())],
            body: vec![],
            body_file: None,
            peer_loopback: loopback,
        }
    }

    fn root() -> PathBuf {
        let d = std::env::temp_dir().join(format!("ysm-web-{}", std::process::id()));
        std::fs::create_dir_all(d.join("lib")).unwrap();
        std::fs::write(d.join("minutes.html"), "<h1>m</h1>").unwrap();
        std::fs::write(d.join("lib/x.js"), "export {}").unwrap();
        std::fs::write(d.parent().unwrap().join("ysm-secret.txt"), "s").unwrap();
        d
    }

    #[test]
    fn plain_files_resolve_and_escapes_do_not() {
        let r = root();
        assert!(safe_join(&r, "minutes.html").is_some());
        assert!(safe_join(&r, "lib/x.js").is_some());
        for bad in [
            "../ysm-secret.txt",
            "%2e%2e/ysm-secret.txt",
            "%2E%2E%2Fysm-secret.txt",
            "lib/../../ysm-secret.txt",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "..\\ysm-secret.txt",
            "lib%5Cx.js",
            "lib//x.js",
            "lib",
            "",
            "a%00b",
            "%zz",
        ] {
            assert!(safe_join(&r, bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn content_types_let_modules_load() {
        assert!(content_type(Path::new("a.js")).starts_with("text/javascript"));
        assert!(content_type(Path::new("a.mjs")).starts_with("text/javascript"));
        assert!(content_type(Path::new("a.css")).starts_with("text/css"));
        assert!(content_type(Path::new("a.html")).starts_with("text/html"));
        assert_eq!(content_type(Path::new("a.wasm")), "application/wasm");
        assert_eq!(content_type(Path::new("a.svg")), "image/svg+xml");
    }

    #[test]
    fn only_loopback_get_is_served() {
        let r = root();
        std::env::set_var("SUBMEETLY_APP_DIR", &r);
        let ok = serve(&req(
            "GET",
            "/app/minutes.html?x=1",
            "127.0.0.1:17865",
            true,
        ))
        .unwrap();
        assert_eq!(
            (ok.status, ok.body.as_slice()),
            (200, b"<h1>m</h1>".as_slice())
        );
        assert_eq!(
            serve(&req("POST", "/app/minutes.html", "127.0.0.1", true))
                .unwrap()
                .status,
            405
        );
        assert_eq!(
            serve(&req("GET", "/app/minutes.html", "evil.com", true))
                .unwrap()
                .status,
            403
        );
        assert_eq!(
            serve(&req("GET", "/app/minutes.html", "127.0.0.1", false))
                .unwrap()
                .status,
            403
        );
        assert_eq!(
            serve(&req("GET", "/app/%2e%2e/ysm-secret.txt", "127.0.0.1", true))
                .unwrap()
                .status,
            404
        );
        assert_eq!(
            serve(&req("GET", "/app/nope.js", "localhost", true))
                .unwrap()
                .status,
            404
        );
        assert!(serve(&req("GET", "/health", "127.0.0.1", true)).is_none());
        let setup = serve(&req("GET", "/app/setup-extension.html", "127.0.0.1", true)).unwrap();
        assert_eq!(setup.status, 200);
        let head = serve(&req("HEAD", "/app/minutes.html", "127.0.0.1", true)).unwrap();
        assert!(head.body.is_empty());
    }
}

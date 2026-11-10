//! Minimal HTTP/1.1 loopback server around `App`.
//!
//! Plain std::net on purpose: the engine needs no framework, and the route
//! behaviour is proven by the golden replay in tests/golden.rs.

use std::env;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::app::{is_loopback_host, App};
use crate::protocol::{AskReply, Request, Response, SseRun};

/// Bodies up to this size are buffered. Larger uploads to the file routes are
/// streamed to a temp file (multi-GB media stays out of RAM); elsewhere drained.
const MAX_BUFFERED_BODY: usize = 32 * 1024 * 1024;
const MAX_HEAD: usize = 64 * 1024;

pub fn run(app: App) -> io::Result<()> {
    let host = env::var("HOST")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    if !is_loopback_host(&host) && env::var("ALLOW_REMOTE").as_deref() != Ok("1") {
        eprintln!(
            "HOST={host} bukan loopback. Helper ini menyimpan transkrip & catatan dan bisa \
             dimatikan lewat HTTP tanpa autentikasi, jadi menolak mengikat alamat yang bisa \
             dijangkau jaringan.\nPakai HOST=127.0.0.1, atau set ALLOW_REMOTE=1 kalau memang \
             disengaja."
        );
        std::process::exit(2);
    }
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(17865);
    let listener = TcpListener::bind((host.as_str(), port))?;
    let _ = thread::Builder::new()
        .name("legacy-models".into())
        .spawn(app.legacy_migration());
    println!(
        "listening on http://{}:{}   (Ctrl-C to stop)",
        host,
        listener
            .local_addr()
            .map(|addr| addr.port())
            .unwrap_or(port)
    );
    serve(listener, app)
}

pub fn serve(listener: TcpListener, app: App) -> io::Result<()> {
    let app = Arc::new(app);
    // Re-read calendar links in the background; a no-op when none are added.
    let ticker = Arc::clone(&app);
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(5));
        loop {
            ticker.calendar_tick();
            thread::sleep(Duration::from_secs(60));
        }
    });
    for incoming in listener.incoming() {
        let stream = match incoming {
            Ok(stream) => stream,
            Err(_) => continue,
        };
        let app = Arc::clone(&app);
        thread::spawn(move || {
            let _ = handle_connection(stream, &app);
        });
    }
    Ok(())
}

fn handle_connection(stream: TcpStream, app: &App) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    let peer_loopback = stream
        .peer_addr()
        .map(|addr| addr.ip().is_loopback())
        .unwrap_or(false);
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut writer = stream;
    loop {
        let Some(head) = read_head(&mut reader)? else {
            return Ok(());
        };
        let mut lines = head.split("\r\n");
        let mut request_line = lines.next().unwrap_or("").split_whitespace();
        let method = request_line.next().unwrap_or("").to_ascii_uppercase();
        let target = request_line.next().unwrap_or("/").to_string();
        let version = request_line.next().unwrap_or("HTTP/1.1").to_string();
        let mut headers = Vec::new();
        for line in lines {
            if let Some((name, value)) = line.split_once(':') {
                headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
            }
        }
        let content_length = headers
            .iter()
            .find(|(name, _)| name == "content-length")
            .and_then(|(_, value)| value.parse::<usize>().ok())
            .unwrap_or(0);
        let mut body = Vec::new();
        let mut body_file = None;
        if content_length > 0 {
            let upload = target.starts_with("/transcribe_file");
            if content_length <= MAX_BUFFERED_BODY {
                body.resize(content_length, 0);
                reader.read_exact(&mut body)?;
            } else if upload {
                let path = std::env::temp_dir()
                    .join(format!(
                        "ysm-body-{}-{:?}.bin",
                        std::process::id(),
                        thread::current().id()
                    ))
                    .with_extension("bin");
                let mut file = std::fs::File::create(&path)?;
                io::copy(&mut (&mut reader).take(content_length as u64), &mut file)?;
                body_file = Some(path);
            } else {
                io::copy(
                    &mut (&mut reader).take(content_length as u64),
                    &mut io::sink(),
                )?;
            }
        }
        let request = Request {
            method,
            target,
            headers,
            body,
            peer_loopback,
            body_file,
        };
        crate::web::note_extension(&request);
        if let Some(page) = crate::web::serve(&request) {
            write_page(&mut writer, &page)?;
            continue;
        }
        if request.method == "POST" && request.path() == "/ask" {
            // The answer streams, so the connection ends with it (no Content-Length).
            return match app.handle_ask(&request) {
                AskReply::Reply(response) => write_response(&mut writer, &response),
                AskReply::Stream { headers, run } => write_sse(&mut writer, &headers, run),
            };
        }
        let response = app.handle(&request);
        if let Some(path) = &request.body_file {
            let _ = std::fs::remove_file(path);
        }
        write_response(&mut writer, &response)?;
        if app.shutdown_requested() {
            writer.flush()?;
            thread::sleep(Duration::from_millis(150));
            std::process::exit(0);
        }
        let close = request
            .header("connection")
            .map(|value| value.eq_ignore_ascii_case("close"))
            .unwrap_or(false)
            || version == "HTTP/1.0";
        if close {
            return Ok(());
        }
    }
}

fn read_head(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut head = Vec::new();
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line)?;
        if read == 0 {
            return Ok(None);
        }
        if line == b"\r\n" || line == b"\n" {
            break;
        }
        head.extend_from_slice(&line);
        if head.len() > MAX_HEAD {
            return Ok(None);
        }
    }
    Ok(Some(String::from_utf8_lossy(&head).into_owned()))
}

fn write_response(writer: &mut TcpStream, response: &Response) -> io::Result<()> {
    let body = match &response.body {
        Some(value) => serde_json::to_vec(value).unwrap_or_else(|_| b"null".to_vec()),
        None => Vec::new(),
    };
    let mut head = format!(
        "HTTP/1.1 {} {}\r\n",
        response.status,
        reason_phrase(response.status)
    );
    for (name, value) in &response.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    if response.body.is_some() {
        head.push_str("Content-Type: application/json; charset=utf-8\r\n");
    }
    head.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
    writer.write_all(head.as_bytes())?;
    writer.write_all(&body)?;
    writer.flush()
}

/// A Server-Sent Events reply: one `data: {json}` block per event, flushed as it is made,
/// then the connection closes. A failed write (the page closed) stops the model.
fn write_sse(writer: &mut TcpStream, headers: &[(String, String)], run: SseRun) -> io::Result<()> {
    let mut head = String::from("HTTP/1.1 200 OK\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("Connection: close\r\n\r\n");
    writer.write_all(head.as_bytes())?;
    writer.flush()?;
    let mut failed = None;
    run(&mut |event| {
        let block = format!(
            "data: {}\n\n",
            serde_json::to_string(event).unwrap_or_default()
        );
        match writer
            .write_all(block.as_bytes())
            .and_then(|()| writer.flush())
        {
            Ok(()) => true,
            Err(error) => {
                failed = Some(error);
                false
            }
        }
    });
    failed.map_or(Ok(()), Err)
}

fn write_page(writer: &mut TcpStream, page: &crate::web::WebResponse) -> io::Result<()> {
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        page.status,
        reason_phrase(page.status),
        page.content_type,
        page.body.len()
    );
    writer.write_all(head.as_bytes())?;
    writer.write_all(&page.body)?;
    writer.flush()
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        503 => "Service Unavailable",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "OK",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::net::TcpStream;

    #[test]
    fn serves_a_real_request_over_tcp() {
        let state =
            std::env::temp_dir().join(format!("submeetly-engine-tcp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&state);
        fs::create_dir_all(&state).expect("state dir");
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        thread::spawn(move || {
            let _ = serve(listener, App::new(state));
        });

        let mut stream = TcpStream::connect(address).expect("connect");
        stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .expect("write");
        let mut response = String::new();
        stream.read_to_string(&mut response).expect("read");
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
        assert!(response.contains("\"ok\":true"), "{response}");
    }

    #[test]
    fn a_stream_reply_sends_each_event_as_its_own_block_then_closes() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let t = thread::spawn(move || {
            let headers = vec![("Content-Type".to_string(), "text/event-stream".to_string())];
            let run: SseRun = Box::new(|emit| {
                emit(&serde_json::json!({ "delta": "You own " }));
                emit(&serde_json::json!({ "delta": "**4**" }));
                emit(&serde_json::json!({ "done": true }));
            });
            write_sse(&mut listener.accept().expect("accept").0, &headers, run)
        });
        let mut stream = TcpStream::connect(address).expect("connect");
        let mut raw = String::new();
        stream.read_to_string(&mut raw).expect("read");
        t.join().expect("thread").expect("write");
        assert!(
            raw.starts_with("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"),
            "{raw:?}"
        );
        assert!(!raw.contains("Content-Length"), "{raw:?}");
        assert!(
            raw.ends_with(
                "data: {\"delta\":\"You own \"}\n\ndata: {\"delta\":\"**4**\"}\n\ndata: {\"done\":true}\n\n"
            ),
            "{raw:?}"
        );
    }

    #[test]
    fn a_page_reply_has_crlf_line_ends_whatever_the_checkout() {
        let page = crate::web::WebResponse {
            status: 200,
            content_type: "text/html",
            body: b"x".to_vec(),
        };
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let t = thread::spawn(move || write_page(&mut listener.accept().expect("accept").0, &page));
        let mut stream = TcpStream::connect(address).expect("connect");
        let mut raw = String::new();
        stream.read_to_string(&mut raw).expect("read");
        t.join().expect("thread").expect("write");
        assert!(
            raw.starts_with("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n"),
            "{raw:?}"
        );
        assert!(raw.ends_with("\r\n\r\nx"), "{raw:?}");
    }
}

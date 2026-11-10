//! HTTP request/response shapes shared by the handler, the socket server and
//! the golden-replay tests.

use serde_json::Value;

#[derive(Debug, Clone)]
pub struct Request {
    pub method: String,
    pub target: String,
    /// Header names are lower-case; values are kept verbatim.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// Upload bodies the server streamed to disk instead of `body`; the server
    /// deletes it after `handle` unless a route moved it away.
    pub body_file: Option<std::path::PathBuf>,
    pub peer_loopback: bool,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or("/")
    }
}

#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub body: Option<Value>,
    /// CORS headers, already decided from the request Origin.
    pub headers: Vec<(String, String)>,
}

/// Runs a streamed answer: calls the sink once per event and stops when it returns false
/// (the client went away).
pub type SseRun<'a> = Box<dyn FnOnce(&mut dyn FnMut(&Value) -> bool) + Send + 'a>;

/// What `App::handle_ask` decided: a plain JSON reply, or a Server-Sent Events stream.
pub enum AskReply<'a> {
    Reply(Response),
    Stream {
        headers: Vec<(String, String)>,
        run: SseRun<'a>,
    },
}

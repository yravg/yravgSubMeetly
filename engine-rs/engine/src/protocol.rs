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

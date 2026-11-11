//! The engine's webhooks as Settings shows them (`GET /integrations/webhooks`): what the island
//! knows of each, and the rules for the URL the person pastes. The engine owns the list and the
//! secrets; the island never sees a secret (`has_secret` only).

use serde_json::Value;

/// How often Settings asks while it is open (seconds).
pub const EVERY: f64 = 10.0;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Webhook {
    pub id: String,
    pub url: String,
    pub enabled: bool,
    pub has_secret: bool,
    /// How the last delivery went: None = none yet.
    pub last_ok: Option<bool>,
    pub last_error: String,
}

impl Webhook {
    /// `host[:port]` of the URL: the row's name.
    pub fn name(&self) -> String {
        let rest = self.url.split_once("://").map_or(self.url.as_str(), |(_, r)| r);
        rest.split(['/', '?', '#']).next().unwrap_or(rest).to_string()
    }

    /// The row's second line.
    pub fn sub(&self) -> String {
        let state = match (self.enabled, self.last_ok) {
            (false, _) => "Off".to_string(),
            (true, None) => "On, nothing sent yet".to_string(),
            (true, Some(true)) => "On, last delivery worked".to_string(),
            (true, Some(false)) => format!("On, last delivery failed: {}", self.last_error),
        };
        if self.has_secret {
            format!("{state}. Signed with your secret")
        } else {
            state
        }
    }
}

/// The list in the engine's answer.
pub fn parse(body: &str) -> Option<Vec<Webhook>> {
    let doc: Value = serde_json::from_str(body).ok()?;
    let list = doc.get("webhooks")?.as_array()?;
    Some(
        list.iter()
            .filter_map(|h| {
                let last = h.get("last").filter(|l| l.is_object());
                Some(Webhook {
                    id: h.get("id")?.as_str()?.to_string(),
                    url: h.get("url")?.as_str()?.to_string(),
                    enabled: h.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                    has_secret: h.get("hasSecret").and_then(Value::as_bool).unwrap_or(false),
                    last_ok: last.and_then(|l| l.get("ok")).and_then(Value::as_bool),
                    last_error: last.and_then(|l| l.get("error")).and_then(Value::as_str).unwrap_or("").to_string(),
                })
            })
            .collect(),
    )
}

/// The clipboard's text as a webhook URL, or why not (the engine checks again).
pub fn clipboard_url(text: &str) -> Result<String, &'static str> {
    let url = text.trim();
    if url.is_empty() {
        return Err("Copy the webhook's URL first, then press Paste URL");
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.contains(char::is_whitespace) {
        return Err("The copied text is not an http or https URL");
    }
    if url.split("://").nth(1).and_then(|r| r.split(['/', '?', '#']).next()).is_some_and(|a| a.contains('@')) {
        return Err("The URL must not carry a name or password");
    }
    Ok(url.to_string())
}

#[derive(Clone, Debug, Default)]
pub struct Webhooks {
    pub list: Vec<Webhook>,
    /// An ask is on its way.
    pub busy: bool,
    pub asked_at: Option<f64>,
    /// The engine's own words when the last ask failed (None = fine, or not asked yet).
    pub error: Option<String>,
}

impl Webhooks {
    /// Settings should ask again now.
    pub fn due(&self, now: f64) -> bool {
        !self.busy && self.asked_at.is_none_or(|t| now - t >= EVERY)
    }

    pub fn asking(&mut self, now: f64) {
        self.busy = true;
        self.asked_at = Some(now);
    }

    pub fn apply(&mut self, r: Result<Vec<Webhook>, String>) {
        self.busy = false;
        match r {
            Ok(list) => {
                self.list = list;
                self.error = None;
            }
            Err(e) => self.error = Some(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_engines_list_is_read_without_secrets() {
        let list = parse(r#"{"webhooks":[{"id":"wh-1","url":"https://hooks.example.com/a?x=1","enabled":true,"hasSecret":true,"events":["*"],"last":{"ok":false,"error":"status 500","attempts":4}},{"id":"wh-2","url":"http://127.0.0.1:9000","enabled":false,"hasSecret":false,"last":null}],"events":[]}"#).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name(), "hooks.example.com");
        assert_eq!(list[0].last_ok, Some(false));
        assert_eq!(list[0].sub(), "On, last delivery failed: status 500. Signed with your secret");
        assert_eq!(list[1].name(), "127.0.0.1:9000");
        assert_eq!(list[1].sub(), "Off");
        assert!(parse("not json").is_none());
    }

    #[test]
    fn only_a_plain_http_url_is_taken_from_the_clipboard() {
        assert_eq!(clipboard_url("  https://x.example/h \n"), Ok("https://x.example/h".into()));
        for bad in ["", "hello", "ftp://x.y", "https://u:p@x.y/", "https://x.y/a b"] {
            assert!(clipboard_url(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn it_asks_every_ten_seconds_and_not_while_asking() {
        let mut w = Webhooks::default();
        assert!(w.due(0.0));
        w.asking(1.0);
        assert!(!w.due(100.0));
        w.apply(Err("The engine is not answering".into()));
        assert!(!w.due(5.0) && w.due(11.0));
        assert!(w.error.is_some());
        w.apply(Ok(vec![]));
        assert!(w.error.is_none());
    }
}

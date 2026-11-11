//! Settings › Models › "Summaries and AI": the engine's custom AI connector (`/ai/connector`) and
//! default summary template (`/notes/templates`); and "Caption translation service": which
//! translation provider captions use (`/translate/provider`: on this device, or Google, DeepL,
//! Youdao, Baidu, MTranServer, LibreTranslate, Ollama, OpenAI-compatible, OpenRouter).
//! Shared by the Windows and Mac apps.
//!
//! The connector is off until the person turns it on; the key is never read back (the engine only
//! says whether one is saved). Text fields come from the clipboard: copy, then press the row's button.

use crate::events::{AppEvent, EventSink};
use poni_core::helper;
use serde_json::{json, Value};

/// What Settings shows of the engine's connector and templates.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AiView {
    /// The engine answered once (the rows say "Start the engine" before that).
    pub known: bool,
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
    pub key_hint: String,
    /// (id, name) of every template, built-ins first.
    pub templates: Vec<(String, String)>,
    /// The template notes use when a request names none; `None` = the plain notes.
    pub default_template: Option<String>,
    /// The caption translation provider (`/translate/provider`).
    pub provider: ProviderView,
}

/// The engine's caption translation provider, without its secrets.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProviderView {
    pub id: String,
    pub label: String,
    /// Captions go through the provider (off: the on-device model).
    pub enabled: bool,
    /// The text really leaves this computer (a cloud service, or a self-hosted one that isn't local).
    pub off_device: bool,
    /// Fields the provider needs: "key", "secret", "appId", "model", "baseUrl".
    pub needs: Vec<String>,
    pub base_url: String,
    pub default_base_url: String,
    pub model: String,
    pub app_id: String,
    pub has_key: bool,
    pub key_hint: String,
    pub has_secret: bool,
    /// (id, label), "On this device" first.
    pub providers: Vec<(String, String)>,
}

impl ProviderView {
    pub fn is_local(&self) -> bool {
        self.id.is_empty() || self.id == "local"
    }

    pub fn needs(&self, field: &str) -> bool {
        self.needs.iter().any(|n| n == field)
    }

    pub fn name(&self) -> String {
        if self.label.is_empty() {
            "On this device".to_string()
        } else {
            self.label.clone()
        }
    }

    /// The provider one step on (`step` = ±1), wrapping.
    pub fn step(&self, step: i32) -> Option<String> {
        if self.providers.is_empty() {
            return None;
        }
        let at = self.providers.iter().position(|(i, _)| *i == self.id).unwrap_or(0) as i32;
        let next = (at + step).rem_euclid(self.providers.len() as i32) as usize;
        Some(self.providers[next].0.clone())
    }
}

/// A text field of the translation provider that comes from the clipboard.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProvField {
    Url,
    Model,
    Key,
    Secret,
    AppId,
}

impl ProvField {
    fn json_key(self) -> &'static str {
        match self {
            ProvField::Url => "baseUrl",
            ProvField::Model => "model",
            ProvField::Key => "apiKey",
            ProvField::Secret => "secret",
            ProvField::AppId => "appId",
        }
    }

    fn what(self) -> &'static str {
        match self {
            ProvField::Url => "the server URL",
            ProvField::Model => "the model name",
            ProvField::Key => "the API key",
            ProvField::Secret => "the secret",
            ProvField::AppId => "the app id",
        }
    }
}

impl AiView {
    /// The default template's index in `templates` (-1 = none, so the stepper can show "Plain").
    pub fn template_name(&self) -> String {
        self.default_template.as_ref().and_then(|id| self.templates.iter().find(|(i, _)| i == id)).map_or_else(|| "Plain notes".to_string(), |(_, n)| n.clone())
    }

    /// The default template one step on (`step` = ±1) through "Plain notes" then each template.
    pub fn step_template(&self, step: i32) -> Option<String> {
        let ids: Vec<Option<&str>> = std::iter::once(None).chain(self.templates.iter().map(|(i, _)| Some(i.as_str()))).collect();
        let at = ids.iter().position(|i| *i == self.default_template.as_deref()).unwrap_or(0) as i32;
        let next = (at + step).rem_euclid(ids.len() as i32) as usize;
        ids[next].map(str::to_string)
    }
}

/// What a Settings button asks for. The `Paste*` ones read the clipboard in the app ([`handle`]).
#[derive(Clone, Debug, PartialEq)]
pub enum AiCmd {
    Refresh,
    Enable(bool),
    PasteUrl,
    PasteModel,
    PasteKey,
    SetUrl(String),
    SetModel(String),
    SetKey(String),
    Test,
    /// Make this template the default (`None` = plain notes).
    SetTemplate(Option<String>),
    /// Choose the caption translation provider by id.
    ProviderPick(String),
    ProviderEnable(bool),
    /// Read the clipboard into a provider field (see [`handle`]), or set it directly.
    ProviderPaste(ProvField),
    ProviderSet(ProvField, String),
    ProviderTest,
}

/// Carry out a command from Settings: a paste reads `clipboard` first (nothing copied is said, not guessed).
pub fn handle(sink: EventSink, port: u16, cmd: AiCmd, clipboard: impl FnOnce() -> Option<String>) {
    if let AiCmd::ProviderPaste(field) = cmd {
        let text = clipboard().map(|t| t.trim().to_string()).filter(|t| !t.is_empty() && t.len() < 2048 && !t.contains('\n'));
        return match text {
            Some(t) => run(sink, port, AiCmd::ProviderSet(field, t)),
            None => sink.send(AppEvent::Ai(AiEvent { view: None, notice: Some((false, "Nothing to paste".into(), format!("Copy {} (one line) first, then press Paste", field.what()))) })),
        };
    }
    let (cmd, what) = match cmd {
        AiCmd::PasteUrl => (AiCmd::SetUrl(String::new()), "the endpoint URL"),
        AiCmd::PasteModel => (AiCmd::SetModel(String::new()), "the model name"),
        AiCmd::PasteKey => (AiCmd::SetKey(String::new()), "the API key"),
        other => return run(sink, port, other),
    };
    let text = clipboard().map(|t| t.trim().to_string()).filter(|t| !t.is_empty() && t.len() < 2048 && !t.contains('\n'));
    match (text, cmd) {
        (Some(t), AiCmd::SetUrl(_)) => run(sink, port, AiCmd::SetUrl(t)),
        (Some(t), AiCmd::SetModel(_)) => run(sink, port, AiCmd::SetModel(t)),
        (Some(t), AiCmd::SetKey(_)) => run(sink, port, AiCmd::SetKey(t)),
        _ => sink.send(AppEvent::Ai(AiEvent { view: None, notice: Some((false, "Nothing to paste".into(), format!("Copy {what} (one line) first, then press Paste"))) })),
    }
}

/// The answer to an [`AiCmd`]: the new view, and a sentence for a notice when there is one.
#[derive(Clone, Debug)]
pub struct AiEvent {
    pub view: Option<AiView>,
    /// (ok, title, subtitle)
    pub notice: Option<(bool, String, String)>,
}

fn read(port: u16) -> Result<AiView, String> {
    let (code, body) = helper::request(port, "GET", "/ai/connector", None).map_err(|e| format!("The engine is not answering ({e})."))?;
    if code != 200 {
        return Err(format!("The engine said {code} for /ai/connector."));
    }
    let c: Value = serde_json::from_str(&body).map_err(|_| "The engine's connector answer was not JSON.".to_string())?;
    let mut view = AiView {
        known: true,
        enabled: c["enabled"].as_bool().unwrap_or(false),
        base_url: c["baseUrl"].as_str().unwrap_or("").to_string(),
        model: c["model"].as_str().unwrap_or("").to_string(),
        has_key: c["hasKey"].as_bool().unwrap_or(false),
        key_hint: c["keyHint"].as_str().unwrap_or("").to_string(),
        ..AiView::default()
    };
    // An engine older than this feature has no templates route: the connector rows still work.
    if let Ok((200, t)) = helper::request(port, "GET", "/notes/templates", None) {
        if let Ok(v) = serde_json::from_str::<Value>(&t) {
            view.templates = v["templates"].as_array().map(|a| a.iter().filter_map(|t| Some((t["id"].as_str()?.to_string(), t["name"].as_str()?.to_string()))).collect()).unwrap_or_default();
            view.default_template = v["default"].as_str().map(str::to_string);
        }
    }
    // An engine older than this feature has no provider route: captions stay on the device.
    if let Ok((200, t)) = helper::request(port, "GET", "/translate/provider", None) {
        if let Ok(v) = serde_json::from_str::<Value>(&t) {
            let text = |k: &str| v[k].as_str().unwrap_or("").to_string();
            view.provider = ProviderView {
                id: text("provider"),
                label: text("label"),
                enabled: v["enabled"].as_bool().unwrap_or(false),
                off_device: v["offDevice"].as_bool().unwrap_or(false),
                needs: v["needs"].as_array().map(|a| a.iter().filter_map(|n| n.as_str().map(str::to_string)).collect()).unwrap_or_default(),
                base_url: text("baseUrl"),
                default_base_url: text("defaultBaseUrl"),
                model: text("model"),
                app_id: text("appId"),
                has_key: v["hasKey"].as_bool().unwrap_or(false),
                key_hint: text("keyHint"),
                has_secret: v["hasSecret"].as_bool().unwrap_or(false),
                providers: v["providers"].as_array().map(|a| a.iter().filter_map(|p| Some((p["id"].as_str()?.to_string(), p["label"].as_str()?.to_string()))).collect()).unwrap_or_default(),
            };
        }
    }
    Ok(view)
}

fn error_text(body: &str, code: u16) -> String {
    serde_json::from_str::<Value>(body).ok().and_then(|v| v["error"].as_str().map(str::to_string)).unwrap_or_else(|| format!("The engine said {code}."))
}

/// Run a command off the UI thread; the answer comes back as `AppEvent::Ai`.
pub fn run(sink: EventSink, port: u16, cmd: AiCmd) {
    std::thread::Builder::new()
        .name("poni-ai".into())
        .spawn(move || {
            let post = |path: &str, body: Value| -> Result<(u16, String), String> { helper::request(port, "POST", path, Some(&body.to_string())).map_err(|e| format!("The engine is not answering ({e}).")) };
            let mut notice = None;
            let step = match &cmd {
                AiCmd::Refresh | AiCmd::PasteUrl | AiCmd::PasteModel | AiCmd::PasteKey => Ok(()),
                AiCmd::Enable(on) => post("/ai/connector", json!({ "enabled": on })).and_then(|(c, b)| if c == 200 { Ok(()) } else { Err(error_text(&b, c)) }).map(|()| {
                    if *on {
                        notice = Some((true, "AI connector on".into(), "Summaries and Ask now go to your endpoint, not the local model".into()));
                    }
                }),
                AiCmd::SetUrl(u) => post("/ai/connector", json!({ "baseUrl": u.trim() })).and_then(|(c, b)| if c == 200 { Ok(()) } else { Err(error_text(&b, c)) }),
                AiCmd::SetModel(m) => post("/ai/connector", json!({ "model": m.trim() })).and_then(|(c, b)| if c == 200 { Ok(()) } else { Err(error_text(&b, c)) }),
                AiCmd::SetKey(k) => post("/ai/connector", json!({ "apiKey": k.trim() })).and_then(|(c, b)| if c == 200 { Ok(()) } else { Err(error_text(&b, c)) }),
                AiCmd::Test => post("/ai/connector/test", json!({})).and_then(|(_, b)| {
                    let v: Value = serde_json::from_str(&b).map_err(|_| "The engine's answer was not JSON.".to_string())?;
                    if v["ok"].as_bool() == Some(true) {
                        notice = Some((true, "The connector answers".into(), format!("{} in {} ms", v["model"].as_str().unwrap_or("model"), v["ms"].as_u64().unwrap_or(0))));
                        Ok(())
                    } else {
                        Err(v["error"].as_str().unwrap_or("The endpoint did not answer.").to_string())
                    }
                }),
                AiCmd::ProviderPick(id) => post("/translate/provider", json!({ "provider": id, "enabled": false })).and_then(|(c, b)| if c == 200 { Ok(()) } else { Err(error_text(&b, c)) }),
                AiCmd::ProviderEnable(on) => post("/translate/provider", json!({ "enabled": on })).and_then(|(c, b)| if c == 200 { Ok(()) } else { Err(error_text(&b, c)) }).map(|()| {
                    if *on {
                        notice = Some((true, "Translation service on".into(), "Each caption line's text is now sent to that service. The on-device model answers if it fails".into()));
                    }
                }),
                AiCmd::ProviderPaste(_) => Ok(()),
                AiCmd::ProviderSet(field, v) => post("/translate/provider", json!({ field.json_key(): v.trim() })).and_then(|(c, b)| if c == 200 { Ok(()) } else { Err(error_text(&b, c)) }),
                AiCmd::ProviderTest => post("/translate/provider/test", json!({})).and_then(|(_, b)| {
                    let v: Value = serde_json::from_str(&b).map_err(|_| "The engine's answer was not JSON.".to_string())?;
                    if v["ok"].as_bool() == Some(true) {
                        notice = Some((true, "The service answers".into(), format!("{} ms", v["ms"].as_u64().unwrap_or(0))));
                        Ok(())
                    } else {
                        Err(v["error"].as_str().unwrap_or("The service did not answer.").to_string())
                    }
                }),
                AiCmd::SetTemplate(id) => post("/notes/templates/default", json!({ "id": id })).and_then(|(c, b)| if c == 200 { Ok(()) } else { Err(error_text(&b, c)) }),
            };
            if let Err(e) = step {
                notice = Some((false, "AI connector".into(), e));
            }
            sink.send(AppEvent::Ai(AiEvent { view: read(port).ok(), notice }));
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_provider_stepper_goes_through_the_engines_list_and_wraps() {
        let v = ProviderView { id: "local".into(), providers: vec![("local".into(), "On this device".into()), ("deepl".into(), "DeepL".into())], ..ProviderView::default() };
        assert_eq!(v.step(1).as_deref(), Some("deepl"));
        assert_eq!(ProviderView { id: "deepl".into(), ..v.clone() }.step(1).as_deref(), Some("local"));
        assert_eq!(v.step(-1).as_deref(), Some("deepl"));
        assert!(v.is_local() && ProviderView::default().is_local());
        assert_eq!(ProviderView::default().step(1), None);
        assert_eq!(ProviderView::default().name(), "On this device");
    }

    fn view(default: Option<&str>) -> AiView {
        AiView { known: true, templates: vec![("general".into(), "General".into()), ("standup".into(), "Standup".into())], default_template: default.map(str::to_string), ..AiView::default() }
    }

    #[test]
    fn the_template_stepper_goes_through_plain_notes_then_each_template_and_wraps() {
        assert_eq!(view(None).template_name(), "Plain notes");
        assert_eq!(view(None).step_template(1).as_deref(), Some("general"));
        assert_eq!(view(Some("general")).step_template(1).as_deref(), Some("standup"));
        assert_eq!(view(Some("standup")).step_template(1), None);
        assert_eq!(view(None).step_template(-1).as_deref(), Some("standup"));
        assert_eq!(view(Some("standup")).template_name(), "Standup");
        // A default that no longer exists reads as plain notes.
        assert_eq!(view(Some("gone")).template_name(), "Plain notes");
    }
}

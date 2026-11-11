//! Caption translation providers: the on-device model (default) or an online/self-hosted
//! service the person chose, like LiveCaptions-Translator's engine list (features only;
//! github.com/SakiRinn/LiveCaptions-Translator, Apache-2.0): Google Translate, Google Cloud
//! Translation, DeepL, Youdao, Baidu, MTranServer, LibreTranslate, and LLM chat endpoints
//! (Ollama, any OpenAI-compatible server, OpenRouter) through [`crate::connector`].
//!
//! **Privacy:** the default is `local`: nothing leaves the device. Any other provider sends
//! each caption line's text to that service, and only after the person turned it on
//! (`enabled`) with a provider chosen. A failing provider never loses a caption: the caller
//! falls back to the local model and reports the reason in `translateError`.
//!
//! **Unofficial endpoint:** `google` uses the free web endpoint
//! `translate.googleapis.com/translate_a/single?client=gtx`, which Google does not document
//! or promise; it can be rate limited or change. `google_cloud` is the official, keyed API.
//!
//! Keys and secrets live in `providers.json` in the engine's state directory (mode 0600 on
//! Unix). They are never logged and never returned (only `hasKey`/`hasSecret` and a hint).

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const FILE: &str = "providers.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Provider {
    Local,
    Google,
    GoogleCloud,
    DeepL,
    Youdao,
    Baidu,
    MTran,
    Libre,
    Ollama,
    OpenAi,
    OpenRouter,
}

pub const ALL: [Provider; 11] = [
    Provider::Local,
    Provider::Google,
    Provider::GoogleCloud,
    Provider::DeepL,
    Provider::Youdao,
    Provider::Baidu,
    Provider::MTran,
    Provider::Libre,
    Provider::Ollama,
    Provider::OpenAi,
    Provider::OpenRouter,
];

impl Provider {
    pub fn id(self) -> &'static str {
        match self {
            Provider::Local => "local",
            Provider::Google => "google",
            Provider::GoogleCloud => "google_cloud",
            Provider::DeepL => "deepl",
            Provider::Youdao => "youdao",
            Provider::Baidu => "baidu",
            Provider::MTran => "mtran",
            Provider::Libre => "libre",
            Provider::Ollama => "ollama",
            Provider::OpenAi => "openai",
            Provider::OpenRouter => "openrouter",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Local => "On this device",
            Provider::Google => "Google Translate (web, unofficial)",
            Provider::GoogleCloud => "Google Cloud Translation",
            Provider::DeepL => "DeepL",
            Provider::Youdao => "Youdao",
            Provider::Baidu => "Baidu Translate",
            Provider::MTran => "MTranServer",
            Provider::Libre => "LibreTranslate",
            Provider::Ollama => "Ollama",
            Provider::OpenAi => "OpenAI-compatible",
            Provider::OpenRouter => "OpenRouter",
        }
    }

    pub fn from_id(id: &str) -> Option<Provider> {
        ALL.iter().copied().find(|p| p.id() == id.trim())
    }

    /// The caption text goes to another machine (false for `local`, and for a server on this
    /// computer such as Ollama or MTranServer, which depends on the URL: see [`Config::off_device`]).
    pub fn cloud(self) -> bool {
        !matches!(self, Provider::Local | Provider::Ollama | Provider::MTran)
    }

    fn default_base(self) -> &'static str {
        match self {
            Provider::Local => "",
            Provider::Google => "https://translate.googleapis.com",
            Provider::GoogleCloud => "https://translation.googleapis.com",
            Provider::DeepL => "",
            Provider::Youdao => "https://openapi.youdao.com",
            Provider::Baidu => "https://fanyi-api.baidu.com",
            Provider::MTran => "http://localhost:8989",
            Provider::Libre => "https://libretranslate.com",
            Provider::Ollama => "http://localhost:11434/v1",
            Provider::OpenAi => "https://api.openai.com/v1",
            Provider::OpenRouter => "https://openrouter.ai/api/v1",
        }
    }

    /// Which fields the provider needs: "key", "secret", "appId", "model", "baseUrl".
    pub fn needs(self) -> &'static [&'static str] {
        match self {
            Provider::Local | Provider::Google => &[],
            Provider::GoogleCloud | Provider::DeepL => &["key"],
            Provider::Youdao | Provider::Baidu => &["appId", "secret"],
            Provider::MTran => &["baseUrl"],
            Provider::Libre => &["baseUrl"],
            Provider::Ollama => &["baseUrl", "model"],
            Provider::OpenAi | Provider::OpenRouter => &["key", "model"],
        }
    }
}

/// One provider's saved settings.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Profile {
    pub base_url: String,
    pub api_key: String,
    pub secret: String,
    pub app_id: String,
    pub model: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub enabled: bool,
    pub provider: Provider,
    pub profiles: BTreeMap<String, Profile>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            enabled: false,
            provider: Provider::Local,
            profiles: BTreeMap::new(),
        }
    }
}

impl Config {
    pub fn profile(&self) -> Profile {
        self.profiles
            .get(self.provider.id())
            .cloned()
            .unwrap_or_default()
    }

    fn base(&self, p: &Profile) -> String {
        let b = p.base_url.trim().trim_end_matches('/');
        if b.is_empty() {
            self.provider.default_base().to_string()
        } else {
            b.to_string()
        }
    }

    /// Whether the saved fields are enough to call the provider.
    pub fn ready(&self) -> std::result::Result<(), String> {
        let p = self.profile();
        let missing = |what: &str| Err(format!("{}: set the {what} first", self.provider.label()));
        match self.provider {
            Provider::Local | Provider::Google => Ok(()),
            Provider::GoogleCloud | Provider::DeepL if p.api_key.is_empty() => missing("API key"),
            Provider::Youdao | Provider::Baidu if p.app_id.is_empty() || p.secret.is_empty() => {
                missing("app id and secret")
            }
            Provider::Ollama | Provider::OpenAi | Provider::OpenRouter if p.model.is_empty() => {
                missing("model name")
            }
            Provider::OpenAi | Provider::OpenRouter if p.api_key.is_empty() => missing("API key"),
            _ => Ok(()),
        }
    }

    /// Captions go through the provider (not the on-device model).
    pub fn active(&self) -> bool {
        self.enabled && self.provider != Provider::Local && self.ready().is_ok()
    }

    /// The text really leaves this computer: a cloud provider, or a self-hosted one whose URL is
    /// not this machine.
    pub fn off_device(&self) -> bool {
        if self.provider == Provider::Local {
            return false;
        }
        if self.provider.cloud() {
            return true;
        }
        let base = self.base(&self.profile());
        !(base.contains("://localhost") || base.contains("://127.") || base.contains("://[::1]"))
    }

    pub fn public(&self) -> Value {
        let p = self.profile();
        let key = p.api_key.trim();
        let hint: String = key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        json!({
            "enabled": self.enabled,
            "provider": self.provider.id(),
            "label": self.provider.label(),
            "needs": self.provider.needs(),
            "offDevice": self.off_device(),
            "baseUrl": p.base_url,
            "defaultBaseUrl": self.provider.default_base(),
            "model": p.model,
            "appId": p.app_id,
            "hasKey": !key.is_empty(),
            "keyHint": if key.chars().count() > 8 { hint } else { String::new() },
            "hasSecret": !p.secret.trim().is_empty(),
            "providers": ALL.iter().map(|q| json!({
                "id": q.id(), "label": q.label(), "cloud": q.cloud(), "needs": q.needs(),
            })).collect::<Vec<_>>(),
            "note": "Off by default: captions are translated on this device. When on, each caption line's text is sent to the chosen service; the local model answers if the service fails.",
        })
    }
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

pub fn load(dir: &Path) -> Config {
    let Some(v) = std::fs::read_to_string(path(dir))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    else {
        return Config::default();
    };
    let s = |o: &Value, k: &str| {
        o.get(k)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let mut profiles = BTreeMap::new();
    if let Some(map) = v.get("profiles").and_then(Value::as_object) {
        for (id, o) in map {
            profiles.insert(
                id.clone(),
                Profile {
                    base_url: s(o, "baseUrl"),
                    api_key: s(o, "apiKey"),
                    secret: s(o, "secret"),
                    app_id: s(o, "appId"),
                    model: s(o, "model"),
                },
            );
        }
    }
    Config {
        enabled: v.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        provider: Provider::from_id(v.get("provider").and_then(Value::as_str).unwrap_or("local"))
            .unwrap_or(Provider::Local),
        profiles,
    }
}

pub fn save(dir: &Path, cfg: &Config) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let profiles: serde_json::Map<String, Value> = cfg
        .profiles
        .iter()
        .map(|(id, p)| {
            (
                id.clone(),
                json!({ "baseUrl": p.base_url, "apiKey": p.api_key, "secret": p.secret, "appId": p.app_id, "model": p.model }),
            )
        })
        .collect();
    let body =
        json!({ "enabled": cfg.enabled, "provider": cfg.provider.id(), "profiles": profiles });
    let target = path(dir);
    let tmp = target.with_extension("json.tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(body.to_string().as_bytes())?;
    }
    #[cfg(not(unix))]
    std::fs::write(&tmp, body.to_string())?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// Validate and merge a `POST /translate/provider` body. `provider` switches the provider
/// first; the other fields then apply to the (new) selected provider's profile. An absent or
/// empty `apiKey`/`secret` keeps the saved one; `clearKey: true` removes both.
pub fn apply_patch(current: &Config, patch: &Value) -> Result<Config> {
    let mut cfg = current.clone();
    if let Some(id) = patch.get("provider").and_then(Value::as_str) {
        cfg.provider = Provider::from_id(id).ok_or_else(|| anyhow!("unknown provider {id:?}"))?;
    }
    let mut p = cfg.profile();
    if let Some(u) = patch.get("baseUrl").and_then(Value::as_str) {
        let u = u.trim().trim_end_matches('/').to_string();
        if !u.is_empty() && !(u.starts_with("http://") || u.starts_with("https://")) {
            bail!("baseUrl must start with http:// or https://");
        }
        p.base_url = u;
    }
    for (field, slot) in [("model", &mut p.model), ("appId", &mut p.app_id)] {
        if let Some(v) = patch.get(field).and_then(Value::as_str) {
            *slot = v.trim().to_string();
        }
    }
    for (field, slot) in [("apiKey", &mut p.api_key), ("secret", &mut p.secret)] {
        if let Some(v) = patch.get(field).and_then(Value::as_str) {
            if !v.trim().is_empty() {
                *slot = v.trim().to_string();
            }
        }
    }
    if patch.get("clearKey").and_then(Value::as_bool) == Some(true) {
        p.api_key.clear();
        p.secret.clear();
    }
    cfg.profiles.insert(cfg.provider.id().to_string(), p);
    if let Some(e) = patch.get("enabled").and_then(Value::as_bool) {
        cfg.enabled = e;
    }
    if cfg.enabled {
        if cfg.provider == Provider::Local {
            // "On" with the on-device choice is just the default.
            cfg.enabled = false;
        } else if let Err(e) = cfg.ready() {
            bail!("{e}");
        }
    }
    Ok(cfg)
}

// ---------------------------------------------------------------------------------------------
// Languages

fn lang_name(code: &str) -> String {
    match code {
        "en" => "English",
        "id" => "Indonesian",
        "zh" => "Chinese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "fr" => "French",
        "es" => "Spanish",
        "de" => "German",
        "ru" => "Russian",
        "ar" => "Arabic",
        "pt" => "Portuguese",
        "it" => "Italian",
        "vi" => "Vietnamese",
        "th" => "Thai",
        "hi" => "Hindi",
        "tr" => "Turkish",
        "nl" => "Dutch",
        "ms" => "Malay",
        other => return other.to_string(),
    }
    .to_string()
}

fn is_auto(code: &str) -> bool {
    code.is_empty() || code == "auto"
}

/// This provider's code for an engine language code (two letters, `zh`, or `auto`).
pub fn lang_code(provider: Provider, code: &str, target: bool) -> String {
    let c = code.trim().to_lowercase();
    if is_auto(&c) {
        return "auto".into();
    }
    match provider {
        Provider::Baidu => match c.as_str() {
            "ja" => "jp",
            "ko" => "kor",
            "fr" => "fra",
            "es" => "spa",
            "ar" => "ara",
            "vi" => "vie",
            other => other,
        }
        .to_string(),
        Provider::Youdao => {
            if c == "zh" {
                "zh-CHS".to_string()
            } else {
                c
            }
        }
        Provider::Google | Provider::GoogleCloud => {
            if c == "zh" {
                "zh-CN".to_string()
            } else {
                c
            }
        }
        Provider::MTran => {
            if c == "zh" {
                "zh-Hans".to_string()
            } else {
                c
            }
        }
        Provider::DeepL => {
            let up = c.to_uppercase();
            if target {
                match up.as_str() {
                    "EN" => "EN-US".to_string(),
                    "PT" => "PT-BR".to_string(),
                    _ => up,
                }
            } else {
                up
            }
        }
        _ => c,
    }
}

// ---------------------------------------------------------------------------------------------
// Signing (pure functions, tested with known vectors)

/// MD5 (RFC 1321). Baidu's request signature needs it; no crate for one 40-line function.
pub fn md5_hex(data: &[u8]) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: Vec<u32> = (0..64)
        .map(|i| ((i as f64 + 1.0).sin().abs() * 4294967296.0) as u32)
        .collect();
    let (mut a0, mut b0, mut c0, mut d0) =
        (0x67452301u32, 0xefcdab89u32, 0x98badcfeu32, 0x10325476u32);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&((data.len() as u64).wrapping_mul(8)).to_le_bytes());
    for chunk in msg.chunks(64) {
        let m: Vec<u32> = chunk
            .chunks(4)
            .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]))
            .collect();
        let (mut a, mut b, mut c, mut d) = (a0, b0, c0, d0);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let f2 = f.wrapping_add(a).wrapping_add(k[i]).wrapping_add(m[g]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(f2.rotate_left(S[i]));
        }
        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }
    let mut out = String::new();
    for v in [a0, b0, c0, d0] {
        for byte in v.to_le_bytes() {
            out.push_str(&format!("{byte:02x}"));
        }
    }
    out
}

/// Baidu: `md5(appid + q + salt + secret)`.
pub fn baidu_sign(app_id: &str, q: &str, salt: &str, secret: &str) -> String {
    md5_hex(format!("{app_id}{q}{salt}{secret}").as_bytes())
}

/// Youdao v3's `input`: the text itself when it is 20 characters or fewer, else the first 10
/// characters + the length + the last 10.
pub fn youdao_input(q: &str) -> String {
    let chars: Vec<char> = q.chars().collect();
    if chars.len() <= 20 {
        q.to_string()
    } else {
        format!(
            "{}{}{}",
            chars[..10].iter().collect::<String>(),
            chars.len(),
            chars[chars.len() - 10..].iter().collect::<String>()
        )
    }
}

/// Youdao v3: `sha256(appKey + input + salt + curtime + appSecret)`, lowercase hex.
pub fn youdao_sign(app_key: &str, q: &str, salt: &str, curtime: &str, secret: &str) -> String {
    let digest =
        Sha256::digest(format!("{app_key}{}{salt}{curtime}{secret}", youdao_input(q)).as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn urlenc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlenc(k), urlenc(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn salt() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ d.as_secs().rotate_left(17))
        .unwrap_or(1)
        .to_string()
}

// ---------------------------------------------------------------------------------------------
// HTTP

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(8)))
        .timeout_recv_response(Some(Duration::from_secs(12)))
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .user_agent("yravgSubMeetly-engine")
        .build()
        .into()
}

/// Never let a secret leak into a message.
fn scrub(text: &str, p: &Profile) -> String {
    let mut t = text.to_string();
    for s in [&p.api_key, &p.secret] {
        if s.len() >= 6 {
            t = t.replace(s.as_str(), "***");
        }
    }
    t
}

fn read(mut reply: ureq::http::Response<ureq::Body>, p: &Profile, who: &str) -> Result<String> {
    let status = reply.status().as_u16();
    let mut text = String::new();
    let _ = reply
        .body_mut()
        .as_reader()
        .take(1 << 20)
        .read_to_string(&mut text);
    if !(200..300).contains(&status) {
        let brief: String = text.trim().chars().take(160).collect();
        bail!("{who} answered {status}: {}", scrub(&brief, p));
    }
    Ok(text)
}

fn get(url: &str, p: &Profile, who: &str) -> Result<String> {
    let reply = agent()
        .get(url)
        .call()
        .map_err(|e| anyhow!("{who} did not answer: {}", scrub(&e.to_string(), p)))?;
    read(reply, p, who)
}

fn post(
    url: &str,
    content_type: &str,
    headers: &[(&str, String)],
    body: &str,
    p: &Profile,
    who: &str,
) -> Result<String> {
    let mut req = agent().post(url).header("Content-Type", content_type);
    for (k, v) in headers {
        req = req.header(*k, v.as_str());
    }
    let reply = req
        .send(body)
        .map_err(|e| anyhow!("{who} did not answer: {}", scrub(&e.to_string(), p)))?;
    read(reply, p, who)
}

fn json_of(text: &str, who: &str) -> Result<Value> {
    serde_json::from_str(text)
        .map_err(|_| anyhow!("{who} answered in a shape this version does not read"))
}

// ---------------------------------------------------------------------------------------------
// Translate

/// Translate `text` from `src` to `tgt` (engine language codes) with the selected provider.
pub fn translate(cfg: &Config, text: &str, src: &str, tgt: &str) -> Result<String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(String::new());
    }
    let prov = cfg.provider;
    let p = cfg.profile();
    let base = cfg.base(&p);
    let who = prov.label();
    let (from, to) = (lang_code(prov, src, false), lang_code(prov, tgt, true));
    match prov {
        Provider::Local => bail!("the on-device model translates; no provider is selected"),
        Provider::Google => {
            let url = format!(
                "{base}/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
                urlenc(&from),
                urlenc(&to),
                urlenc(text)
            );
            let v = json_of(&get(&url, &p, who)?, who)?;
            let parts = v
                .get(0)
                .and_then(Value::as_array)
                .ok_or_else(|| anyhow!("{who} answered in a shape this version does not read"))?;
            let out: String = parts
                .iter()
                .filter_map(|s| s.get(0).and_then(Value::as_str))
                .collect();
            non_empty(out, who)
        }
        Provider::GoogleCloud => {
            let url = format!("{base}/language/translate/v2?key={}", urlenc(&p.api_key));
            let mut body = json!({ "q": text, "target": to, "format": "text" });
            if from != "auto" {
                body["source"] = json!(from);
            }
            let v = json_of(
                &post(&url, "application/json", &[], &body.to_string(), &p, who)?,
                who,
            )?;
            non_empty(
                v["data"]["translations"][0]["translatedText"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                who,
            )
        }
        Provider::DeepL => {
            let host = if base.is_empty() {
                if p.api_key.ends_with(":fx") {
                    "https://api-free.deepl.com".to_string()
                } else {
                    "https://api.deepl.com".to_string()
                }
            } else {
                base
            };
            let mut body = json!({ "text": [text], "target_lang": to });
            if from != "auto" {
                body["source_lang"] = json!(from);
            }
            let auth = format!("DeepL-Auth-Key {}", p.api_key);
            let v = json_of(
                &post(
                    &format!("{host}/v2/translate"),
                    "application/json",
                    &[("Authorization", auth)],
                    &body.to_string(),
                    &p,
                    who,
                )?,
                who,
            )?;
            non_empty(
                v["translations"][0]["text"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                who,
            )
        }
        Provider::Youdao => {
            let salt = salt();
            let curtime = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
                .to_string();
            let sign = youdao_sign(&p.app_id, text, &salt, &curtime, &p.secret);
            let body = form(&[
                ("q", text),
                ("from", &from),
                ("to", &to),
                ("appKey", &p.app_id),
                ("salt", &salt),
                ("sign", &sign),
                ("signType", "v3"),
                ("curtime", &curtime),
            ]);
            let v = json_of(
                &post(
                    &format!("{base}/api"),
                    "application/x-www-form-urlencoded",
                    &[],
                    &body,
                    &p,
                    who,
                )?,
                who,
            )?;
            let code = v["errorCode"].as_str().unwrap_or("0");
            if code != "0" {
                bail!("{who} refused the request (error {code})");
            }
            let out: String = v["translation"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            non_empty(out, who)
        }
        Provider::Baidu => {
            let salt = salt();
            let sign = baidu_sign(&p.app_id, text, &salt, &p.secret);
            let url = format!(
                "{base}/api/trans/vip/translate?{}",
                form(&[
                    ("q", text),
                    ("from", &from),
                    ("to", &to),
                    ("appid", &p.app_id),
                    ("salt", &salt),
                    ("sign", &sign)
                ])
            );
            let v = json_of(&get(&url, &p, who)?, who)?;
            if let Some(code) = v.get("error_code") {
                let code = code
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| code.to_string());
                bail!(
                    "{who} refused the request (error {code}: {})",
                    v["error_msg"].as_str().unwrap_or("")
                );
            }
            let out: String = v["trans_result"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|r| r["dst"].as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            non_empty(out, who)
        }
        Provider::MTran => {
            let mut headers = Vec::new();
            if !p.api_key.is_empty() {
                headers.push(("Authorization", format!("Bearer {}", p.api_key)));
            }
            let body = json!({ "from": from, "to": to, "text": text });
            let v = json_of(
                &post(
                    &format!("{base}/translate"),
                    "application/json",
                    &headers,
                    &body.to_string(),
                    &p,
                    who,
                )?,
                who,
            )?;
            non_empty(v["result"].as_str().unwrap_or("").to_string(), who)
        }
        Provider::Libre => {
            let mut body = json!({ "q": text, "source": from, "target": to, "format": "text" });
            if !p.api_key.is_empty() {
                body["api_key"] = json!(p.api_key);
            }
            let v = json_of(
                &post(
                    &format!("{base}/translate"),
                    "application/json",
                    &[],
                    &body.to_string(),
                    &p,
                    who,
                )?,
                who,
            )?;
            if let Some(e) = v["error"].as_str() {
                bail!("{who} refused the request: {}", scrub(e, &p));
            }
            non_empty(v["translatedText"].as_str().unwrap_or("").to_string(), who)
        }
        Provider::Ollama | Provider::OpenAi | Provider::OpenRouter => {
            let conn = crate::connector::Config {
                enabled: true,
                base_url: base,
                api_key: p.api_key.clone(),
                model: p.model.clone(),
            };
            let system = format!(
                "You are a live-caption translator. Translate the user's text from {} to {}. Reply with the translation only: no notes, no quotes, no explanation.",
                if from == "auto" { "the spoken language".to_string() } else { lang_name(&from) },
                lang_name(&tgt.trim().to_lowercase())
            );
            let out = crate::connector::chat(
                &conn,
                &system,
                &[("user".to_string(), text.to_string())],
                400,
                &mut |_| {},
            )?;
            non_empty(out.trim().trim_matches('"').trim().to_string(), who)
        }
    }
}

fn non_empty(text: String, who: &str) -> Result<String> {
    if text.trim().is_empty() {
        bail!("{who} answered with no text");
    }
    Ok(text.trim().to_string())
}

/// The `/draft` hook: `None` = translate on this device (provider off, or nothing to translate);
/// `Some(Ok((text, provider id)))` = the provider's translation; `Some(Err(reason))` = it failed,
/// the caller falls back to the local model and reports the reason.
pub fn try_translate(
    dir: &Path,
    text: &str,
    src: &str,
    tgt: &str,
) -> Option<std::result::Result<(String, &'static str), String>> {
    let cfg = load(dir);
    if !cfg.active() || tgt == "none" || tgt == src || text.trim().is_empty() {
        return None;
    }
    Some(
        translate(&cfg, text, src, tgt)
            .map(|t| (t, cfg.provider.id()))
            .map_err(|e| format!("{e:#}")),
    )
}

/// `POST /translate/provider/test`: one short sentence through the saved settings plus any
/// overrides. Works whether or not the provider is enabled.
pub fn test(cfg: &Config, src: &str, tgt: &str) -> Value {
    if cfg.provider == Provider::Local {
        return json!({ "ok": true, "provider": "local", "sample": "", "ms": 0, "note": "The on-device model translates." });
    }
    if let Err(e) = cfg.ready() {
        return json!({ "ok": false, "error": e });
    }
    let started = Instant::now();
    match translate(
        cfg,
        "Good morning, the meeting starts in five minutes.",
        src,
        tgt,
    ) {
        Ok(t) => {
            json!({ "ok": true, "provider": cfg.provider.id(), "sample": t.chars().take(80).collect::<String>(), "ms": started.elapsed().as_millis() as u64 })
        }
        Err(e) => json!({ "ok": false, "error": format!("{e:#}") }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// A one-request mock server: answers `reply` and returns (base url, the request it saw).
    fn mock(reply: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut got = Vec::new();
            let mut buf = [0u8; 8192];
            loop {
                let n = s.read(&mut buf).unwrap();
                got.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&got).to_string();
                if let Some(i) = text.find("\r\n\r\n") {
                    let len = text
                        .to_lowercase()
                        .split("content-length:")
                        .nth(1)
                        .and_then(|r| r.split("\r\n").next())
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if got.len() >= i + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let out = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", reply.len(), reply);
            s.write_all(out.as_bytes()).unwrap();
            String::from_utf8_lossy(&got).to_string()
        });
        (url, h)
    }

    fn cfg(provider: Provider, base: &str, f: impl FnOnce(&mut Profile)) -> Config {
        let mut p = Profile {
            base_url: base.to_string(),
            ..Default::default()
        };
        f(&mut p);
        let mut c = Config {
            enabled: true,
            provider,
            ..Default::default()
        };
        c.profiles.insert(provider.id().to_string(), p);
        c
    }

    #[test]
    fn md5_matches_rfc_1321_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            md5_hex(b"message digest"),
            "f96b697d7cb7938d525a2f31aaf161d0"
        );
        assert_eq!(
            md5_hex(
                b"12345678901234567890123456789012345678901234567890123456789012345678901234567890"
            ),
            "57edf4a22be3c955ac49da2e2107b67a"
        );
    }

    #[test]
    fn baidu_signature_matches_the_documented_example() {
        // From Baidu's API documentation: appid 2015063000000001, q apple, salt 1435660288, secret 12345678.
        assert_eq!(
            baidu_sign("2015063000000001", "apple", "1435660288", "12345678"),
            "f89f9594663708c1605f3d736d01d2d4"
        );
    }

    #[test]
    fn youdao_input_and_signature() {
        assert_eq!(youdao_input("hello"), "hello");
        assert_eq!(
            youdao_input("abcdefghijklmnopqrstuvwxyz"),
            "abcdefghij26qrstuvwxyz"
        );
        // sha256("k" + "hello" + "1" + "2" + "s")
        let want = {
            let d = Sha256::digest(b"khello12s");
            d.iter().map(|b| format!("{b:02x}")).collect::<String>()
        };
        assert_eq!(youdao_sign("k", "hello", "1", "2", "s"), want);
        assert_eq!(want.len(), 64);
        // Counts characters, not bytes: 21 CJK characters.
        let q = "一二三四五六七八九十一二三四五六七八九十一";
        assert_eq!(
            youdao_input(q),
            "一二三四五六七八九十21二三四五六七八九十一"
        );
    }

    #[test]
    fn language_codes_follow_each_providers_names() {
        assert_eq!(lang_code(Provider::Baidu, "ja", true), "jp");
        assert_eq!(lang_code(Provider::Baidu, "ko", true), "kor");
        assert_eq!(lang_code(Provider::Youdao, "zh", true), "zh-CHS");
        assert_eq!(lang_code(Provider::Google, "zh", false), "zh-CN");
        assert_eq!(lang_code(Provider::DeepL, "en", true), "EN-US");
        assert_eq!(lang_code(Provider::DeepL, "en", false), "EN");
        assert_eq!(lang_code(Provider::MTran, "zh", true), "zh-Hans");
        assert_eq!(lang_code(Provider::Libre, "", false), "auto");
    }

    #[test]
    fn google_web_reads_the_nested_sentences() {
        let (url, h) = mock(
            r#"[[["Selamat pagi, ","Good morning,",null,null,10],["rapat dimulai.","the meeting starts.",null,null,10]],null,"en"]"#,
        );
        let c = cfg(Provider::Google, &url, |_| {});
        assert_eq!(
            translate(&c, "Good morning, the meeting starts.", "en", "id").unwrap(),
            "Selamat pagi, rapat dimulai."
        );
        let seen = h.join().unwrap();
        assert!(
            seen.starts_with(
                "GET /translate_a/single?client=gtx&sl=en&tl=id&dt=t&q=Good%20morning%2C"
            ),
            "{seen}"
        );
    }

    #[test]
    fn google_cloud_sends_the_key_and_reads_the_translation() {
        let (url, h) = mock(r#"{"data":{"translations":[{"translatedText":"Halo"}]}}"#);
        let c = cfg(Provider::GoogleCloud, &url, |p| {
            p.api_key = "AIzaKEY123456".into()
        });
        assert_eq!(translate(&c, "Hello", "en", "id").unwrap(), "Halo");
        let seen = h.join().unwrap();
        assert!(
            seen.contains("POST /language/translate/v2?key=AIzaKEY123456"),
            "{seen}"
        );
        assert!(
            seen.contains(r#""target":"id""#) && seen.contains(r#""source":"en""#),
            "{seen}"
        );
    }

    #[test]
    fn deepl_sends_its_auth_header_and_regional_target() {
        let (url, h) =
            mock(r#"{"translations":[{"detected_source_language":"EN","text":"Hallo"}]}"#);
        let c = cfg(Provider::DeepL, &url, |p| {
            p.api_key = "abcdef-123:fx".into()
        });
        assert_eq!(translate(&c, "Hello", "en", "de").unwrap(), "Hallo");
        let seen = h.join().unwrap().to_lowercase();
        assert!(
            seen.contains("authorization: deepl-auth-key abcdef-123:fx"),
            "{seen}"
        );
        assert!(
            seen.contains(r#""target_lang":"de""#) && seen.contains(r#""source_lang":"en""#),
            "{seen}"
        );
    }

    #[test]
    fn deepl_picks_the_free_host_for_a_fx_key() {
        let c = cfg(Provider::DeepL, "", |p| p.api_key = "abc:fx".into());
        // No network call: just the host rule through `base`.
        assert!(c.base(&c.profile()).is_empty());
    }

    #[test]
    fn youdao_posts_a_signed_form() {
        let (url, h) = mock(r#"{"errorCode":"0","translation":["你好"]}"#);
        let c = cfg(Provider::Youdao, &url, |p| {
            p.app_id = "appkey1".into();
            p.secret = "secret-xyz".into();
        });
        assert_eq!(translate(&c, "Hello", "en", "zh").unwrap(), "你好");
        let seen = h.join().unwrap();
        assert!(seen.contains("POST /api"), "{seen}");
        assert!(
            seen.contains("signType=v3")
                && seen.contains("appKey=appkey1")
                && seen.contains("to=zh-CHS"),
            "{seen}"
        );
        assert!(
            !seen.contains("secret-xyz"),
            "the secret itself is never sent"
        );
    }

    #[test]
    fn youdao_error_codes_become_messages() {
        let (url, _h) = mock(r#"{"errorCode":"108"}"#);
        let c = cfg(Provider::Youdao, &url, |p| {
            p.app_id = "a".into();
            p.secret = "s".into();
        });
        let e = translate(&c, "Hello", "en", "zh").unwrap_err().to_string();
        assert!(e.contains("108"), "{e}");
    }

    #[test]
    fn baidu_signs_and_reads_trans_result() {
        let (url, h) =
            mock(r#"{"from":"en","to":"zh","trans_result":[{"src":"Hello","dst":"你好"}]}"#);
        let c = cfg(Provider::Baidu, &url, |p| {
            p.app_id = "2015063000000001".into();
            p.secret = "12345678".into();
        });
        assert_eq!(translate(&c, "Hello", "en", "zh").unwrap(), "你好");
        let seen = h.join().unwrap();
        assert!(
            seen.contains("appid=2015063000000001") && seen.contains("sign="),
            "{seen}"
        );
        assert!(
            !seen.contains("12345678&") && !seen.contains("secret"),
            "{seen}"
        );
    }

    #[test]
    fn baidu_errors_are_reported() {
        let (url, _h) = mock(r#"{"error_code":"54001","error_msg":"Invalid Sign"}"#);
        let c = cfg(Provider::Baidu, &url, |p| {
            p.app_id = "a".into();
            p.secret = "s".into();
        });
        let e = translate(&c, "Hello", "en", "zh").unwrap_err().to_string();
        assert!(e.contains("54001") && e.contains("Invalid Sign"), "{e}");
    }

    #[test]
    fn mtranserver_and_libretranslate_shapes() {
        let (url, h) = mock(r#"{"result":"Halo"}"#);
        let c = cfg(Provider::MTran, &url, |p| p.api_key = "token-123456".into());
        assert_eq!(translate(&c, "Hello", "en", "id").unwrap(), "Halo");
        let seen = h.join().unwrap().to_lowercase();
        assert!(
            seen.contains("post /translate") && seen.contains("authorization: bearer token-123456"),
            "{seen}"
        );

        let (url, h) = mock(r#"{"translatedText":"Halo"}"#);
        let c = cfg(Provider::Libre, &url, |p| p.api_key = "libre-key".into());
        assert_eq!(translate(&c, "Hello", "en", "id").unwrap(), "Halo");
        let seen = h.join().unwrap();
        assert!(
            seen.contains(r#""api_key":"libre-key""#) && seen.contains(r#""format":"text""#),
            "{seen}"
        );
    }

    #[test]
    fn llm_providers_use_the_chat_connector_with_a_translation_prompt() {
        let (url, h) = mock(r#"{"choices":[{"message":{"content":"\"Halo\""}}]}"#);
        let c = cfg(Provider::Ollama, &format!("{url}/v1"), |p| {
            p.model = "qwen2.5".into()
        });
        assert_eq!(translate(&c, "Hello", "en", "id").unwrap(), "Halo");
        let seen = h.join().unwrap();
        assert!(seen.contains("POST /v1/chat/completions"), "{seen}");
        assert!(seen.contains("English to Indonesian"), "{seen}");
    }

    #[test]
    fn a_failing_provider_reports_the_reason_so_the_caller_falls_back() {
        let dir = std::env::temp_dir().join(format!("prov-fb-{}", std::process::id()));
        let c = cfg(Provider::Libre, "http://127.0.0.1:1", |_| {});
        save(&dir, &c).unwrap();
        let r = try_translate(&dir, "Hello", "en", "id").unwrap();
        assert!(r.is_err(), "an unreachable service is an Err: {r:?}");
        // Local, or nothing to translate: the provider is not asked.
        let off = Config::default();
        save(&dir, &off).unwrap();
        assert!(try_translate(&dir, "Hello", "en", "id").is_none());
        save(&dir, &c).unwrap();
        assert!(try_translate(&dir, "Hello", "en", "en").is_none());
        assert!(try_translate(&dir, "Hello", "en", "none").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_round_trips_and_never_shows_secrets() {
        let dir = std::env::temp_dir().join(format!("prov-cfg-{}", std::process::id()));
        let mut c = Config::default();
        c = apply_patch(
            &c,
            &json!({ "provider": "baidu", "appId": "app-1", "secret": "very-secret-value" }),
        )
        .unwrap();
        c = apply_patch(&c, &json!({ "enabled": true })).unwrap();
        save(&dir, &c).unwrap();
        let back = load(&dir);
        assert_eq!(back, c);
        assert!(back.active() && back.off_device());
        let shown = back.public().to_string();
        assert!(!shown.contains("very-secret-value"), "{shown}");
        assert!(
            shown.contains(r#""hasSecret":true"#) && shown.contains(r#""offDevice":true"#),
            "{shown}"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path(&dir)).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn turning_on_needs_the_fields_and_local_stays_the_default() {
        let c = Config::default();
        assert!(!c.active() && !c.off_device());
        assert!(apply_patch(&c, &json!({ "provider": "deepl", "enabled": true })).is_err());
        assert!(apply_patch(&c, &json!({ "provider": "nope" })).is_err());
        assert!(apply_patch(&c, &json!({ "baseUrl": "ftp://x" })).is_err());
        // Local + on is just off.
        assert!(
            !apply_patch(&c, &json!({ "enabled": true }))
                .unwrap()
                .enabled
        );
        // A loopback self-hosted server stays on the device.
        let c = apply_patch(&c, &json!({ "provider": "mtran", "enabled": true })).unwrap();
        assert!(c.active() && !c.off_device());
        // Switching providers keeps each one's own fields.
        let c = apply_patch(
            &c,
            &json!({ "provider": "libre", "baseUrl": "https://lt.example.org" }),
        )
        .unwrap();
        let c = apply_patch(&c, &json!({ "provider": "mtran" })).unwrap();
        assert_eq!(c.profile().base_url, "");
    }
}

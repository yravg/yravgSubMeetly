//! Automatic video transcripts (YouTube CC now; structured by site so more
//! websites can be added later) turned into time-synced [`Lyrics`] lines for
//! the Media tab and the collapsed pill.
//!
//! Pure logic only: detecting when a session wants a video transcript, finding
//! the matching video from YouTube search results, picking the best caption
//! track, and parsing JSON3, timedtext XML (`srv1`) or WebVTT subtitles into
//! clean, seekable [`Lyrics`] lines.

use crate::lrc::{LyricLine, Lyrics};
use crate::lrclib::{normalize_query, LrclibRecord, TrackQuery};
use crate::nowplaying;
use crate::sha256::{hex, sha256};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Source label shown on the Media tab when a YouTube transcript is active.
pub const YOUTUBE_SOURCE: &str = "YouTube CC";

/// Supported video transcript sites (extensible to more sites later).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoSite {
    YouTube,
}

impl VideoSite {
    pub fn label(self) -> &'static str {
        match self {
            VideoSite::YouTube => YOUTUBE_SOURCE,
        }
    }

    pub fn source_url(self) -> &'static str {
        match self {
            VideoSite::YouTube => "https://www.youtube.com",
        }
    }
}

/// Whether `source` (`LyricsState::source`) came from a video transcript provider.
pub fn is_video_transcript_source(source: &str) -> bool {
    source == YOUTUBE_SOURCE
}

/// Whether a media session can use a video transcript when the feature is on:
/// any browser video tab (or explicit YouTube session), excluding dedicated
/// music web apps like YouTube Music.
pub fn is_video_session(app_id: &str, app_name: &str) -> bool {
    let name = app_name.trim();
    if name.eq_ignore_ascii_case("YouTube Music") || name.eq_ignore_ascii_case("Spotify") || name.eq_ignore_ascii_case("Apple Music") || name.eq_ignore_ascii_case("Music") {
        return false;
    }
    let id = app_id.trim();
    name.eq_ignore_ascii_case("YouTube")
        || name.to_ascii_lowercase().contains("youtube")
        || id.to_ascii_lowercase().contains("youtube")
        || nowplaying::is_browser(id)
        || nowplaying::is_browser(name)
        || ["iina", "vlc", "quicktime", "mpv", "safari", "chrome", "firefox", "edge", "brave", "opera", "arc", "zen", "dia"].iter().any(|b| id.to_ascii_lowercase().contains(b) || name.to_ascii_lowercase().contains(b))
}

/// Whether the lookup should try fetching a video transcript for this session.
pub fn should_try_video_transcript(app_id: &str, app_name: &str, enabled: bool) -> bool {
    enabled && is_video_session(app_id, app_name)
}

/// Whether the session explicitly names YouTube (by window/app name or URL in title).
pub fn is_explicit_youtube(app_name: &str, title: &str) -> bool {
    app_name.eq_ignore_ascii_case("YouTube") || youtube_id_from_text(title).is_some()
}

/// Stable cache key (`yt-<16 hex chars>`) for a video transcript lookup.
pub fn cache_key(q: &TrackQuery) -> String {
    let n = normalize_query(q);
    let dur = if n.duration_s > 0 { n.duration_s.to_string() } else { String::new() };
    let material = format!(
        "yt\x1f{}\x1f{}\x1f{}",
        n.title.to_lowercase(),
        n.artist.to_lowercase(),
        dur
    );
    let digest = hex(&sha256(material.as_bytes()));
    format!("yt-{}", &digest[..16])
}

/// Extract an 11-character YouTube video ID from a URL or text containing one.
pub fn youtube_id_from_text(text: &str) -> Option<String> {
    let s = text.trim();
    if s.is_empty() {
        return None;
    }
    for prefix in [
        "youtube.com/watch?v=",
        "m.youtube.com/watch?v=",
        "music.youtube.com/watch?v=",
        "youtu.be/",
        "youtube.com/shorts/",
        "youtube.com/embed/",
        "youtube.com/live/",
    ] {
        if let Some(pos) = s.find(prefix) {
            let rest = &s[pos + prefix.len()..];
            let id: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if is_valid_video_id(&id) {
                return Some(id);
            }
        }
    }
    None
}

pub fn is_valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Clean browser tab noise from a video title (e.g. `(224) `, ` - YouTube`, ` - Audio playing`)
/// and combine with `artist` (channel name) to produce a high-precision search query.
pub fn clean_video_search_query(title: &str, artist: &str) -> String {
    let mut s = title.trim();
    // Strip leading notification count: "(1) ", "(224) "
    if s.starts_with('(') {
        if let Some(close_idx) = s.find(')') {
            let inner = &s[1..close_idx];
            if inner.chars().all(|c| c.is_ascii_digit()) && close_idx + 1 < s.len() {
                s = s[close_idx + 1..].trim_start();
            }
        }
    }
    // Strip trailing browser / site suffixes (repeating until clean):
    let mut changed = true;
    while changed {
        changed = false;
        for suffix in [
            " - YouTube - Audio playing",
            " - Audio playing",
            " - YouTube",
            " – YouTube",
            " — YouTube",
            " | YouTube",
            " \u{1f50a}",
            " \u{1f508}",
            " \u{1f509}",
            " \u{25b6}\u{fe0f}",
            " - Google Chrome",
            " - Microsoft Edge",
            " - Mozilla Firefox",
            " - Safari",
        ] {
            if let Some(stripped) = s.strip_suffix(suffix) {
                s = stripped.trim_end();
                changed = true;
            }
        }
    }
    let s_clean = s.trim();
    let artist_clean = artist.trim();
    if !artist_clean.is_empty()
        && !artist_clean.eq_ignore_ascii_case("YouTube")
        && !s_clean.to_ascii_lowercase().contains(&artist_clean.to_ascii_lowercase())
    {
        format!("{s_clean} {artist_clean}")
    } else {
        s_clean.to_string()
    }
}

/// Map a browser `app_id` and/or `app_name` to `yt-dlp --cookies-from-browser <name>`.
pub fn browser_for_cookies(app_id: &str, app_name: &str) -> Option<&'static str> {
    let text = format!("{} {}", app_id.trim(), app_name.trim()).to_ascii_lowercase();
    if text.contains("safari") {
        Some("safari")
    } else if text.contains("edgemac") || text.contains("msedge") || text.contains("microsoftedge") || text.contains("edge") {
        Some("edge")
    } else if text.contains("brave") {
        Some("brave")
    } else if text.contains("firefox") || (app_id.len() == 16 && app_id.bytes().all(|b| b.is_ascii_hexdigit())) {
        Some("firefox")
    } else if text.contains("vivaldi") {
        Some("vivaldi")
    } else if text.contains("opera") {
        Some("opera")
    } else if text.contains("chrome") || text.contains("chromium") || app_id.starts_with("company.thebrowser.") {
        Some("chrome")
    } else {
        None
    }
}

/// A candidate video returned by YouTube search.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VideoCandidate {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub duration_s: Option<u32>,
}

/// Request body for `POST https://www.youtube.com/youtubei/v1/search?prettyPrint=false`.
pub fn innertube_search_body(query: &str) -> String {
    json!({
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20250101.00.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query.trim()
    })
    .to_string()
}

/// Extract video candidates from a YouTube InnerTube `/youtubei/v1/search` JSON response.
pub fn parse_youtube_search(body: &str) -> Vec<VideoCandidate> {
    let Ok(root) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    collect_video_renderers(&root, &mut out);
    out
}

fn collect_video_renderers(v: &Value, out: &mut Vec<VideoCandidate>) {
    match v {
        Value::Object(map) => {
            if let Some(vr) = map.get("videoRenderer").and_then(Value::as_object) {
                if let Some(id) = vr.get("videoId").and_then(Value::as_str).filter(|s| is_valid_video_id(s)) {
                    let title = extract_runs_text(vr.get("title"));
                    let channel = extract_runs_text(vr.get("ownerText"))
                        .or_else(|| extract_runs_text(vr.get("longBylineText")))
                        .or_else(|| extract_runs_text(vr.get("shortBylineText")))
                        .unwrap_or_default();
                    let duration_s = extract_runs_text(vr.get("lengthText"))
                        .as_deref()
                        .and_then(parse_duration_text);
                    if let Some(title) = title.filter(|t| !t.trim().is_empty()) {
                        if !out.iter().any(|c| c.video_id == id) {
                            out.push(VideoCandidate {
                                video_id: id.to_string(),
                                title,
                                channel,
                                duration_s,
                            });
                        }
                    }
                }
            }
            for child in map.values() {
                collect_video_renderers(child, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_video_renderers(item, out);
            }
        }
        _ => {}
    }
}

fn extract_runs_text(v: Option<&Value>) -> Option<String> {
    let obj = v?.as_object()?;
    if let Some(s) = obj.get("simpleText").and_then(Value::as_str) {
        return Some(s.trim().to_string());
    }
    let runs = obj.get("runs")?.as_array()?;
    let mut s = String::new();
    for r in runs {
        if let Some(t) = r.get("text").and_then(Value::as_str) {
            s.push_str(t);
        }
    }
    let trimmed = s.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Parse `"12:34"` or `"1:02:03"` into seconds.
pub fn parse_duration_text(text: &str) -> Option<u32> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    let mut total = 0u32;
    for p in parts {
        let n = p.trim().parse::<u32>().ok()?;
        total = total.checked_mul(60)?.checked_add(n)?;
    }
    Some(total)
}

/// Pick the best matching video candidate for `(title, artist, duration_s)`.
pub fn best_video_match<'a>(
    candidates: &'a [VideoCandidate],
    title: &str,
    artist: &str,
    duration_s: Option<u32>,
) -> Option<&'a VideoCandidate> {
    let want_title = norm_tokens(title);
    if want_title.is_empty() {
        return None;
    }
    let want_artist = norm_tokens(artist);
    let mut best: Option<(i32, &'a VideoCandidate)> = None;

    for cand in candidates {
        let cand_title = norm_tokens(&cand.title);
        if cand_title.is_empty() {
            continue;
        }
        let mut score = 0i32;

        // Channel / artist match.
        let mut channel_matches = false;
        if !want_artist.is_empty() {
            let cand_channel = norm_tokens(&cand.channel);
            if cand_channel == want_artist {
                channel_matches = true;
                score += 50;
            } else if !cand_channel.is_empty()
                && (cand_channel.contains(&want_artist) || want_artist.contains(&cand_channel))
            {
                channel_matches = true;
                score += 35;
            }
        }

        // Title overlap check: exact, substring, or token overlap.
        // For podcasts, seminars, news, and lectures, titles may be longer or have subtle
        // differences, so allow overlap down to 25% (or 15% if channel matches).
        let overlap = token_overlap(&want_title, &cand_title);
        let min_overlap = if channel_matches { 15 } else { 25 };
        if cand_title == want_title {
            score += 100;
        } else if cand_title.contains(&want_title) || want_title.contains(&cand_title) {
            score += 75;
        } else if overlap >= min_overlap {
            score += overlap;
        } else {
            continue;
        }

        // Duration check when both durations are known.
        if let (Some(want_d), Some(cand_d)) = (duration_s.filter(|&d| d > 0), cand.duration_s.filter(|&d| d > 0)) {
            let diff = want_d.abs_diff(cand_d);
            let max_tol = (want_d / 10).max(30);
            if diff <= 3 {
                score += 60;
            } else if diff <= 10 {
                score += 40;
            } else if diff <= max_tol {
                score += 15;
            } else {
                // Wrong video length (e.g. a Shorts clip vs a full video, or a 1-hour compilation).
                continue;
            }
        }

        if best.as_ref().is_none_or(|(best_score, _)| score > *best_score) {
            best = Some((score, cand));
        }
    }
    // Fallback: If no candidate passed the threshold, but the 1st candidate has a channel match
    // or at least 20% token overlap, accept it as the most likely match.
    if best.is_none() {
        if let Some(first) = candidates.first() {
            let c_title = norm_tokens(&first.title);
            let overlap = token_overlap(&want_title, &c_title);
            let c_channel = norm_tokens(&first.channel);
            let chan_match = !want_artist.is_empty() && (c_channel == want_artist || c_channel.contains(&want_artist) || want_artist.contains(&c_channel));
            if overlap >= 20 || chan_match {
                best = Some((10, first));
            }
        }
    }
    best.map(|(_, c)| c)
}

fn norm_tokens(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() { c.to_lowercase().next().unwrap_or(c) } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Percentage (0..=100) of `want` tokens present in `cand`.
fn token_overlap(want: &str, cand: &str) -> i32 {
    let w: Vec<&str> = want.split_whitespace().collect();
    if w.is_empty() {
        return 0;
    }
    let c: Vec<&str> = cand.split_whitespace().collect();
    let hits = w.iter().filter(|t| c.contains(t)).count();
    ((hits * 100) / w.len()) as i32
}

/// A caption track available on a YouTube video.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptionTrack {
    pub base_url: String,
    /// Normalized engine language code (`"en"`, `"id"`, `"ja"`, `"zh"`, `"ko"`, etc.).
    pub language_code: String,
    /// True when `kind == "asr"` (YouTube's automatic captions).
    pub is_asr: bool,
    pub is_translatable: bool,
}

/// Candidate InnerTube `/youtubei/v1/player` `(json_body, user_agent)` pairs for `video_id`.
pub fn innertube_player_requests(video_id: &str) -> Vec<(String, &'static str)> {
    vec![
        (
            json!({
                "context": {
                    "client": {
                        "clientName": "TVHTML5",
                        "clientVersion": "7.20241028.00.00",
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "videoId": video_id
            })
            .to_string(),
            "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/24.lts.4-gold (unlike Gecko) v8/11.4.183.29-jit Starboard/16, Amazon_FireTV_GEN4/FireOS_7.6.7.9 (Amazon, AFTMM, Wireless)",
        ),
        (
            json!({
                "context": {
                    "client": {
                        "clientName": "IOS",
                        "clientVersion": "20.10.4",
                        "deviceMake": "Apple",
                        "deviceModel": "iPhone16,2",
                        "osName": "iPhone",
                        "osVersion": "18.3.2.22D82",
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "videoId": video_id
            })
            .to_string(),
            "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
        ),
        (
            json!({
                "context": {
                    "client": {
                        "clientName": "ANDROID",
                        "clientVersion": "20.10.38",
                        "androidSdkVersion": 34,
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "videoId": video_id
            })
            .to_string(),
            "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
        ),
        (
            json!({
                "context": {
                    "client": {
                        "clientName": "WEB",
                        "clientVersion": "2.20250101.00.00",
                        "hl": "en",
                        "gl": "US"
                    }
                },
                "videoId": video_id
            })
            .to_string(),
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ),
    ]
}

/// Extract `captionTracks` from either a `/youtubei/v1/player` JSON response or watch page HTML.
pub fn extract_caption_tracks(body: &str) -> Vec<CaptionTrack> {
    let trimmed = body.trim();
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if let Some(arr) = v
            .get("captions")
            .and_then(|c| c.get("playerCaptionsTracklistRenderer"))
            .and_then(|r| r.get("captionTracks"))
            .and_then(Value::as_array)
        {
            return parse_caption_tracks_array(arr);
        }
    }
    // Watch page HTML: find `"captionTracks":[...]`
    if let Some(pos) = trimmed.find("\"captionTracks\":") {
        let rest = &trimmed[pos + "\"captionTracks\":".len()..];
        if let Some(arr_json) = slice_json_bracket(rest.trim_start(), b'[', b']') {
            if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(arr_json) {
                return parse_caption_tracks_array(&arr);
            }
        }
    }
    Vec::new()
}

fn slice_json_bracket(s: &str, open: u8, close: u8) -> Option<&str> {
    let bytes = s.as_bytes();
    if bytes.first().copied() != Some(open) {
        return None;
    }
    let mut depth = 0usize;
    let mut in_str = false;
    let mut esc = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_str {
            if esc {
                esc = false;
            } else if b == b'\\' {
                esc = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        if b == b'"' {
            in_str = true;
        } else if b == open {
            depth += 1;
        } else if b == close {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return s.get(..=i);
            }
        }
    }
    None
}

fn parse_caption_tracks_array(arr: &[Value]) -> Vec<CaptionTrack> {
    let mut out = Vec::new();
    for item in arr {
        let Some(base_url) = item.get("baseUrl").and_then(Value::as_str).filter(|u| !u.is_empty()) else {
            continue;
        };
        let raw_lang = item.get("languageCode").and_then(Value::as_str).unwrap_or("en");
        let language_code = normalize_lang_code(raw_lang);
        let is_asr = item.get("kind").and_then(Value::as_str) == Some("asr");
        let is_translatable = item.get("isTranslatable").and_then(Value::as_bool).unwrap_or(false);
        out.push(CaptionTrack {
            base_url: base_url.to_string(),
            language_code,
            is_asr,
            is_translatable,
        });
    }
    out
}

/// Normalize a BCP-47 language tag (`"en-US"`, `"id-ID"`, `"zh-Hans"`, `"iw"`) to the engine's short code.
pub fn normalize_lang_code(code: &str) -> String {
    let lower = code.trim().to_ascii_lowercase();
    let base = lower.split(['-', '_']).next().unwrap_or(&lower);
    match base {
        "in" => "id".to_string(),
        "iw" => "he".to_string(),
        "" => "en".to_string(),
        other => other.to_string(),
    }
}

/// Pick the best caption track:
/// 1. If `preferred_lang` is set (and not `"auto"`), prefer a manual track in that language, then ASR in that language.
/// 2. Otherwise prefer any manual track (the creator's subtitles), then English, then the first track.
pub fn pick_caption_track<'a>(tracks: &'a [CaptionTrack], preferred_lang: &str) -> Option<&'a CaptionTrack> {
    if tracks.is_empty() {
        return None;
    }
    let pref = preferred_lang.trim();
    if !pref.is_empty() && !pref.eq_ignore_ascii_case("auto") {
        let norm_pref = normalize_lang_code(pref);
        if let Some(t) = tracks.iter().find(|t| !t.is_asr && t.language_code == norm_pref) {
            return Some(t);
        }
        if let Some(t) = tracks.iter().find(|t| t.language_code == norm_pref) {
            return Some(t);
        }
    }
    tracks
        .iter()
        .find(|t| !t.is_asr)
        .or_else(|| tracks.iter().find(|t| t.language_code == "en"))
        .or_else(|| tracks.first())
}

/// Build the JSON3 timedtext URL for a caption track.
pub fn json3_url(base_url: &str) -> String {
    if base_url.contains("fmt=json3") {
        base_url.to_string()
    } else if base_url.contains('?') {
        format!("{base_url}&fmt=json3")
    } else {
        format!("{base_url}?fmt=json3")
    }
}

/// Auto-detect and parse a transcript payload (YouTube `json3`, timedtext `srv1` XML, or WebVTT/SRT)
/// into time-synced [`Lyrics`].
pub fn parse_transcript(text: &str) -> Option<Lyrics> {
    let trimmed = text.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('{') {
        if let Some(l) = parse_json3(trimmed) {
            return Some(l);
        }
    }
    if trimmed.starts_with('<') {
        if let Some(l) = parse_srv1_xml(trimmed) {
            return Some(l);
        }
    }
    if trimmed.starts_with("WEBVTT") || trimmed.contains("-->") {
        if let Some(l) = parse_vtt(trimmed) {
            return Some(l);
        }
    }
    None
}

/// Parse YouTube's `fmt=json3` timedtext format (`{"events":[{"tStartMs":...,"segs":[{"utf8":...}]}]}`).
pub fn parse_json3(text: &str) -> Option<Lyrics> {
    let v: Value = serde_json::from_str(text).ok()?;
    let events = v.get("events")?.as_array()?;
    let mut raw: Vec<LyricLine> = Vec::new();
    for ev in events {
        let Some(segs) = ev.get("segs").and_then(Value::as_array) else {
            continue;
        };
        let start_ms = ev.get("tStartMs").and_then(Value::as_f64).unwrap_or(0.0);
        let mut line = String::new();
        for seg in segs {
            if let Some(u) = seg.get("utf8").and_then(Value::as_str) {
                line.push_str(u);
            }
        }
        let cleaned = clean_caption_line(&line);
        if cleaned.is_empty() {
            continue;
        }
        let time_s = (start_ms / 1000.0).max(0.0);
        push_coalesced(&mut raw, time_s, cleaned);
    }
    finalize_lines(raw)
}

/// Parse YouTube's default `srv1` XML format (`<transcript><text start="1.23" dur="3.4">...</text></transcript>`).
pub fn parse_srv1_xml(xml: &str) -> Option<Lyrics> {
    let mut raw: Vec<LyricLine> = Vec::new();
    let mut rest = xml;
    while let Some(open) = rest.find("<text") {
        rest = &rest[open + 5..];
        let Some(tag_end) = rest.find('>') else {
            break;
        };
        let attrs = &rest[..tag_end];
        if attrs.ends_with('/') {
            rest = &rest[tag_end + 1..];
            continue;
        }
        let body_start = tag_end + 1;
        let Some(close_rel) = rest[body_start..].find("</text>") else {
            break;
        };
        let inner = &rest[body_start..body_start + close_rel];
        rest = &rest[body_start + close_rel + 7..];

        let Some(start_s) = xml_attr(attrs, "start").and_then(|s| s.parse::<f64>().ok()) else {
            continue;
        };
        let decoded = unescape_html(inner);
        let cleaned = clean_caption_line(&decoded);
        if cleaned.is_empty() {
            continue;
        }
        push_coalesced(&mut raw, start_s.max(0.0), cleaned);
    }
    finalize_lines(raw)
}

/// Parse WebVTT (or SRT) cues into synced [`Lyrics`], deduplicating rolling auto-caption overlap lines.
pub fn parse_vtt(vtt: &str) -> Option<Lyrics> {
    let mut raw: Vec<LyricLine> = Vec::new();
    let normalized = vtt.replace("\r\n", "\n");
    for block in normalized.split("\n\n") {
        let mut lines = block.lines().map(str::trim).filter(|l| !l.is_empty());
        let Some(first) = lines.next() else {
            continue;
        };
        if first.starts_with("WEBVTT") || first.starts_with("NOTE") || first.starts_with("STYLE") {
            continue;
        }
        let timing = if first.contains("-->") {
            first
        } else {
            let Some(second) = lines.next() else {
                continue;
            };
            if !second.contains("-->") {
                continue;
            }
            second
        };
        let Some((start_str, _)) = timing.split_once("-->") else {
            continue;
        };
        let Some(start_s) = parse_vtt_timestamp(start_str.trim()) else {
            continue;
        };
        for cue_line in lines {
            let stripped = strip_vtt_tags(cue_line);
            let decoded = unescape_html(&stripped);
            let cleaned = clean_caption_line(&decoded);
            if cleaned.is_empty() {
                continue;
            }
            push_coalesced(&mut raw, start_s.max(0.0), cleaned);
        }
    }
    finalize_lines(raw)
}

fn parse_vtt_timestamp(s: &str) -> Option<f64> {
    let token = s.split_whitespace().next()?;
    let token = token.replace(',', ".");
    let parts: Vec<&str> = token.split(':').collect();
    match parts.as_slice() {
        [m, sec] => {
            let mins = m.parse::<f64>().ok()?;
            let secs = sec.parse::<f64>().ok()?;
            Some(mins * 60.0 + secs)
        }
        [h, m, sec] => {
            let hrs = h.parse::<f64>().ok()?;
            let mins = m.parse::<f64>().ok()?;
            let secs = sec.parse::<f64>().ok()?;
            Some(hrs * 3600.0 + mins * 60.0 + secs)
        }
        _ => None,
    }
}

fn strip_vtt_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn xml_attr<'a>(attrs: &'a str, name: &str) -> Option<&'a str> {
    let pat = format!("{name}=\"");
    let pos = attrs.find(&pat)? + pat.len();
    let rest = &attrs[pos..];
    let end = rest.find('"')?;
    Some(&rest[..end])
}

fn unescape_html(s: &str) -> String {
    let mut out = s
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ");
    // Numeric entities like `&#x27;` or `&#39;` if any remain.
    while let Some(pos) = out.find("&#") {
        let rest = &out[pos + 2..];
        let Some(end) = rest.find(';') else {
            break;
        };
        let entity = &rest[..end];
        let code = if let Some(hex_str) = entity.strip_prefix('x').or_else(|| entity.strip_prefix('X')) {
            u32::from_str_radix(hex_str, 16).ok()
        } else {
            entity.parse::<u32>().ok()
        };
        let replacement = code.and_then(char::from_u32).map(|c| c.to_string()).unwrap_or_default();
        out.replace_range(pos..pos + 2 + end + 1, &replacement);
    }
    out
}

fn clean_caption_line(s: &str) -> String {
    let joined = s
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let collapsed = joined.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim().trim_matches('♪').trim();
    if matches!(
        trimmed.to_ascii_lowercase().as_str(),
        "" | "[music]" | "[applause]" | "[laughter]" | "(music)"
    ) {
        return String::new();
    }
    trimmed.to_string()
}

/// Push a caption line, coalescing rolling duplicates or tiny sub-second word fragments.
fn push_coalesced(lines: &mut Vec<LyricLine>, time_s: f64, text: String) {
    if let Some(last) = lines.last_mut() {
        if last.text.eq_ignore_ascii_case(&text) {
            return;
        }
        // Rolling auto-captions where the new cue starts with the previous cue's text at nearly the same time:
        if text.starts_with(&last.text) && (time_s - last.time_s).abs() < 2.5 {
            last.text = text;
            return;
        }
        // If two fragments arrive within 0.35s of each other and the previous one is very short, join them:
        if (time_s - last.time_s).abs() < 0.35 && last.text.len() + text.len() < 90 {
            last.text.push(' ');
            last.text.push_str(&text);
            return;
        }
    }
    lines.push(LyricLine { time_s, text });
}

fn finalize_lines(mut lines: Vec<LyricLine>) -> Option<Lyrics> {
    if lines.is_empty() {
        return None;
    }
    lines.sort_by(|a, b| a.time_s.total_cmp(&b.time_s));
    Some(Lyrics { lines, synced: true })
}

/// Convert synced [`Lyrics`] into an [`LrclibRecord`] for disk caching (`lyrics/yt-<key>.json`).
pub fn to_lrc_record(lyrics: &Lyrics, q: &TrackQuery) -> LrclibRecord {
    let mut lrc = String::new();
    for line in &lyrics.lines {
        let total_cs = (line.time_s.max(0.0) * 100.0).round() as u64;
        let mins = total_cs / 6000;
        let secs = (total_cs % 6000) / 100;
        let cs = total_cs % 100;
        lrc.push_str(&format!("[{mins:02}:{secs:02}.{cs:02}] {}\n", line.text));
    }
    LrclibRecord {
        id: 0,
        track_name: q.title.clone(),
        artist_name: q.artist.clone(),
        album_name: (!q.album.is_empty()).then(|| q.album.clone()),
        duration: (q.duration_s > 0).then(|| q.duration_s as f64),
        instrumental: false,
        plain_lyrics: None,
        synced_lyrics: Some(lrc),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_youtube_video_id_from_urls() {
        assert_eq!(
            youtube_id_from_text("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s"),
            Some("dQw4w9WgXcQ".into())
        );
        assert_eq!(
            youtube_id_from_text("https://youtu.be/aqz-KE-bpKQ?si=123"),
            Some("aqz-KE-bpKQ".into())
        );
        assert_eq!(
            youtube_id_from_text("https://www.youtube.com/shorts/jNQXAC9IVRw"),
            Some("jNQXAC9IVRw".into())
        );
        assert_eq!(youtube_id_from_text("Plain video title"), None);
    }

    #[test]
    fn cleans_browser_tab_titles_for_video_search() {
        assert_eq!(
            clean_video_search_query("(224) Rick Astley - Never Gonna Give You Up - YouTube - Audio playing", "Rick Astley"),
            "Rick Astley - Never Gonna Give You Up"
        );
        assert_eq!(
            clean_video_search_query("Inside the mind of a master procrastinator | Tim Urban | TED - YouTube", "TED"),
            "Inside the mind of a master procrastinator | Tim Urban | TED"
        );
        assert_eq!(
            clean_video_search_query("Kompas TV Live Streaming - Berita Terkini", "KOMPASTV"),
            "Kompas TV Live Streaming - Berita Terkini KOMPASTV"
        );
        assert_eq!(
            clean_video_search_query("(224) Sam Altman: OpenAI CEO on GPT-4, ChatGPT, and the Future of AI | Lex Fridman Podcast #367 - YouTube \u{1f50a}", "Lex Fridman"),
            "Sam Altman: OpenAI CEO on GPT-4, ChatGPT, and the Future of AI | Lex Fridman Podcast #367"
        );
    }

    #[test]
    fn maps_browser_apps_to_cookie_names() {
        assert_eq!(browser_for_cookies("com.google.Chrome", "Google Chrome"), Some("chrome"));
        assert_eq!(browser_for_cookies("com.apple.Safari", "Safari"), Some("safari"));
        assert_eq!(browser_for_cookies("com.microsoft.edgemac", "Microsoft Edge"), Some("edge"));
        assert_eq!(browser_for_cookies("org.mozilla.firefox", "Firefox"), Some("firefox"));
        assert_eq!(browser_for_cookies("com.spotify.client", "Spotify"), None);
    }

    #[test]
    fn detects_when_session_should_use_video_transcript() {
        assert!(should_try_video_transcript("com.google.Chrome", "YouTube", true));
        assert!(should_try_video_transcript("com.apple.Safari", "Safari", true));
        assert!(!should_try_video_transcript("com.google.Chrome", "YouTube", false));
        assert!(!should_try_video_transcript("com.spotify.client", "Spotify", true));
        assert!(!should_try_video_transcript("com.google.Chrome", "YouTube Music", true));
    }

    #[test]
    fn parses_search_results_and_picks_best_match_by_title_channel_and_duration() {
        let search_json = r#"{
            "contents": {
                "twoColumnSearchResultsRenderer": {
                    "primaryContents": {
                        "sectionListRenderer": {
                            "contents": [{
                                "itemSectionRenderer": {
                                    "contents": [
                                        {
                                            "videoRenderer": {
                                                "videoId": "wrongLengt1",
                                                "title": {"runs": [{"text": "Rust in 100 Seconds"}]},
                                                "ownerText": {"runs": [{"text": "Fireship"}]},
                                                "lengthText": {"simpleText": "1:45:00"}
                                            }
                                        },
                                        {
                                            "videoRenderer": {
                                                "videoId": "rightVideo2",
                                                "title": {"runs": [{"text": "Rust in 100 Seconds"}]},
                                                "ownerText": {"runs": [{"text": "Fireship"}]},
                                                "lengthText": {"simpleText": "2:24"}
                                            }
                                        }
                                    ]
                                }
                            }]
                        }
                    }
                }
            }
        }"#;
        let cands = parse_youtube_search(search_json);
        assert_eq!(cands.len(), 2);
        let best = best_video_match(&cands, "Rust in 100 Seconds", "Fireship", Some(144)).unwrap();
        assert_eq!(best.video_id, "rightVideo2");
        assert_eq!(best.duration_s, Some(144));
    }

    #[test]
    fn extracts_and_picks_manual_caption_track_over_asr() {
        let html = r#"<html><script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr","languageCode":"en","kind":"asr","isTranslatable":true},{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=en","languageCode":"en-US","isTranslatable":true},{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc&lang=ja","languageCode":"ja","isTranslatable":true}]}}};</script></html>"#;
        let tracks = extract_caption_tracks(html);
        assert_eq!(tracks.len(), 3);
        let picked = pick_caption_track(&tracks, "auto").unwrap();
        assert!(!picked.is_asr);
        assert_eq!(picked.language_code, "en");

        let picked_ja = pick_caption_track(&tracks, "ja").unwrap();
        assert_eq!(picked_ja.language_code, "ja");
    }

    #[test]
    fn parses_json3_srv1_xml_and_vtt_into_synced_lyrics() {
        let json3 = r#"{
            "events": [
                {"tStartMs": 0, "dDurationMs": 1000, "segs": [{"utf8": "[Music]"}]},
                {"tStartMs": 1200, "dDurationMs": 2500, "segs": [{"utf8": "Welcome "}, {"utf8": "everyone\n"}]},
                {"tStartMs": 4000, "dDurationMs": 3000, "segs": [{"utf8": "Let's build this fast."}]}
            ]
        }"#;
        let l1 = parse_transcript(json3).unwrap();
        assert!(l1.synced);
        assert_eq!(l1.lines.len(), 2);
        assert_eq!(l1.lines[0].time_s, 1.2);
        assert_eq!(l1.lines[0].text, "Welcome everyone");
        assert_eq!(l1.lines[1].time_s, 4.0);
        assert_eq!(l1.lines[1].text, "Let's build this fast.");
        assert_eq!(l1.line_index_at(2.0), Some(0));
        assert_eq!(l1.line_index_at(5.5), Some(1));

        let xml = r#"<?xml version="1.0" encoding="utf-8" ?><transcript><text start="0.5" dur="2.0">First &amp; foremost</text><text start="3.25" dur="1.5">Don&#39;t wait</text></transcript>"#;
        let l2 = parse_transcript(xml).unwrap();
        assert_eq!(l2.lines.len(), 2);
        assert_eq!(l2.lines[0].text, "First & foremost");
        assert_eq!(l2.lines[1].text, "Don't wait");

        let vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<c>Hello</c> world\n\n00:00:03.000 --> 00:00:05.000\nHello world\nNext line here\n";
        let l3 = parse_transcript(vtt).unwrap();
        assert_eq!(l3.lines.len(), 2);
        assert_eq!(l3.lines[0].text, "Hello world");
        assert_eq!(l3.lines[1].text, "Next line here");
    }
}

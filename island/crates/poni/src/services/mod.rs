//! Background services. Each one reports to the UI thread through an
//! [`EventSink`]; a failing service is logged and skipped, never fatal.

pub mod addons;
pub mod adzan;
pub mod applemusic;
pub mod applemusic_ui;
pub mod audio;
pub mod backdrop;
pub mod bluetooth;
pub mod capture;
pub mod livecap;
pub mod engine;
pub mod clipboard;
pub mod frames;
pub mod fullscreen;
pub mod helper;
pub mod cities;
pub mod downloader;
#[cfg(test)]
mod downloader_live;
pub mod http;
pub mod imaging;
pub mod lyric_translate;
pub mod location;
pub mod lyrics;
pub mod meeting_probe;
pub mod media;
pub mod meter;
pub mod integrations;
pub mod models;
pub mod pairdrop;
pub mod phonedrop;
pub mod power;
pub mod psu;
pub mod romanize;
#[cfg(test)]
mod romanize_compare;
pub mod secret;
pub mod sound;
pub mod notifications;
pub mod sysmon;
pub mod sysstats;
pub mod feed;
pub mod update;
pub mod winlang;

use crate::commands::MediaCmd;
use crate::events::EventSink;
use crate::state::MediaSession;
use poni_core::geom::Color;
use poni_core::settings::Settings;
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};

pub struct Services {
    media: Option<media::MediaService>,
    lyrics: Option<lyrics::LyricsService>,
    lyric_tr: Option<lyric_translate::LyricTranslateService>,
    _audio: Option<audio::AudioService>,
    /// Sound on the output, for captions that start by themselves.
    _meter: Option<meter::MeterService>,
    /// Windows and microphone users, for the meeting source (PMM-004).
    meeting_probe: Option<meeting_probe::MeetingProbe>,
    _bluetooth: Option<bluetooth::BluetoothService>,
    fullscreen: Option<fullscreen::FullscreenWatcher>,
    pairdrop: Option<pairdrop::PairDropService>,
    addons: Option<addons::AddonService>,
    helper: Option<helper::HelperService>,
    capture: Option<capture::CaptureService>,
    /// Fast latency: Windows Live Captions as the caption source (instead of `capture`).
    livecap: Option<livecap::LiveCapService>,
    /// What captions heard since the last Stop, for the meeting saved then.
    session: capture::SessionLog,
    engine: Option<engine::EngineService>,
    /// Started at the first download ([`Services::download`]).
    downloader: std::cell::OnceCell<Option<downloader::DownloaderService>>,
    sink: EventSink,
}

fn started<T, E: std::fmt::Display>(name: &str, r: Result<T, E>) -> Option<T> {
    match r {
        Ok(v) => {
            crate::pinfo!("service {name}: started");
            Some(v)
        }
        Err(e) => {
            crate::pwarn!("service {name}: unavailable ({e})");
            None
        }
    }
}

impl Services {
    pub fn start(sink: &EventSink, _island: HWND, helper: HWND, settings: &Settings) -> Self {
        let media = started("media", media::MediaService::start(sink.clone()));
        let lyrics = started("lyrics", lyrics::LyricsService::start(sink.clone()));
        let lyric_tr = started("lyrics translation", lyric_translate::LyricTranslateService::start(sink.clone()));
        let audio = started("audio", audio::AudioService::start(sink.clone()));
        let meter = started("sound meter", meter::MeterService::start(sink.clone()));
        let meeting_probe = started("meeting probe", meeting_probe::MeetingProbe::start(sink.clone()));
        let bluetooth = started("bluetooth", bluetooth::BluetoothService::start(sink.clone()));
        let fullscreen = started("fullscreen", fullscreen::FullscreenWatcher::start(helper, sink.clone()));
        // Asks nothing until a phone is paired.
        let pairdrop = started("pair drop", pairdrop::PairDropService::start(sink.clone()));
        // Asleep unless an add-on is on; then it only checks the files it has.
        // The Microsoft Store build has no Downloader, whatever settings.json says.
        // A Studio Pro add-on's files wait for Pro (`set_pro`): a filter here
        // would delete the Downloader's tools at every start, before the
        // server's answer, and fetch them again after it.
        let store = crate::autostart::packaged();
        let on = poni_core::addons::ALL
            .iter()
            .filter(|a| settings.addon_on(a.id) && !(store && a.id == poni_core::addons::DOWNLOADER.id))
            .map(|a| a.id)
            .collect();
        let addons = started("add-ons", addons::AddonService::start(sink.clone(), on));
        let helper = started("helper link", helper::HelperService::start(sink.clone()));
        let engine = started("engine link", engine::EngineService::start(sink.clone()));
        Self {
            media,
            lyrics,
            lyric_tr,
            _audio: audio,
            _meter: meter,
            meeting_probe,
            _bluetooth: bluetooth,
            fullscreen,
            pairdrop,
            addons,
            helper,
            capture: None,
            livecap: None,
            session: Default::default(),
            engine,
            downloader: std::cell::OnceCell::new(),
            sink: sink.clone(),
        }
    }

    pub fn stop(mut self, _helper: HWND) {
        self.capture_stop();
        if let Some(f) = self.fullscreen {
            f.stop();
        }
        // Stops the engine this island started, and only that one.
        if let Some(e) = self.engine {
            e.stop();
        }
    }

    /// Start the engine now (the menu's Start engine).
    pub fn engine_start(&self) {
        if let Some(e) = &self.engine {
            e.start_now();
        }
    }

    /// Restart the engine this island started.
    pub fn engine_restart(&self) {
        if let Some(e) = &self.engine {
            e.restart();
        }
    }

    /// Run a one-off download on the add-on thread (the update file).
    /// False when that thread couldn't start.
    pub fn run_job(&self, job: addons::Job) -> bool {
        self.addons.as_ref().map(|a| a.run(job)).is_some()
    }

    /// Run yt-dlp for `req` (the Downloader add-on's tools are in place).
    pub fn download(&self, req: poni_core::ytdlp::Request) {
        if let Some(d) = self.downloader.get_or_init(|| started("downloader", downloader::DownloaderService::start(self.sink.clone()))) {
            d.run(req);
        }
    }

    /// Stop download `id` (its yt-dlp and whatever yt-dlp started).
    pub fn stop_download(&self, id: u64) {
        if let Some(Some(d)) = self.downloader.get() {
            d.stop(id);
        }
    }

    /// An add-on was switched on (download its files) or off (delete them).
    /// A Studio Pro add-on's files come only with Pro (`set_pro`).
    pub fn set_addon(&self, id: &'static str, on: bool) {
        if let Some(a) = &self.addons {
            a.set(id, on);
        }
    }

    /// `POST /notes` to the helper, then ask it again.
    pub fn helper_post(&self, body: String) {
        if let Some(h) = &self.helper {
            h.post(body);
        }
    }

    /// Start capturing `source` (the PC's audio, the microphone `mic`, or both) for captions, or
    /// say why not. Restarts a running one.
    pub fn capture_start(&mut self, sink: &EventSink, port: u16, src: &str, tgt: &str, source: poni_core::capture::Source, mic: &str, latency: poni_core::utterance::Latency) -> Result<(), String> {
        self.capture = None; // the old one stops first: one device reader at a time
        self.livecap = None;
        self.session.lock().unwrap_or_else(|e| e.into_inner()).begin();
        self.capture = Some(capture::CaptureService::start(sink.clone(), port, src.into(), tgt.into(), self.session.clone(), source, mic.into(), latency).map_err(|e| format!("Captions could not start ({e})."))?);
        Ok(())
    }

    /// Start Fast latency: read Windows Live Captions instead of the PC's audio. `origin` is where its
    /// window was (saved by the caller before this moves it).
    pub fn livecap_start(&mut self, sink: &EventSink, port: u16, src: &str, tgt: &str, origin: Option<(i32, i32)>, hang_s: f32) -> Result<(), String> {
        self.capture = None;
        self.livecap = None;
        self.session.lock().unwrap_or_else(|e| e.into_inner()).begin();
        self.livecap = Some(livecap::LiveCapService::start(sink.clone(), port, src.into(), tgt.into(), self.session.clone(), origin, hang_s).map_err(|e| format!("Captions could not start ({e})."))?);
        Ok(())
    }

    /// Captions run from Windows Live Captions (Fast), not from our own audio capture.
    pub fn livecap_running(&self) -> bool {
        self.livecap.is_some()
    }

    /// A new Latency mode for the running captions (PMM-026); false when none run.
    pub fn capture_latency(&self, latency: poni_core::utterance::Latency) -> bool {
        self.capture.as_ref().inspect(|c| c.set_latency(latency)).is_some()
    }

    /// The microphone's level while captions hear the room (0 otherwise).
    pub fn mic_level(&self) -> f32 {
        self.capture.as_ref().map_or(0.0, |c| c.mic_level())
    }

    /// New languages for running captions, without stopping them. False when none run.
    pub fn capture_langs(&self, src: &str, tgt: &str) -> bool {
        if let Some(l) = &self.livecap {
            l.set_langs(src.into(), tgt.into());
            return true;
        }
        self.capture.as_ref().inspect(|c| c.set_langs(src.into(), tgt.into())).is_some()
    }

    pub fn capture_stop(&mut self) {
        self.capture = None;
        self.livecap = None;
    }

    /// The lines captions heard since the last time: the session ends here (shortcut: a window the
    /// engine is still answering when Stop is pressed is not in it).
    pub fn take_session(&self) -> Vec<poni_core::helper::Line> {
        self.session.lock().unwrap_or_else(|e| e.into_inner()).take()
    }

    /// How many lines the running session has and its newest `n` (the Meeting tab).
    pub fn session_tail(&self, n: usize) -> (usize, Vec<poni_core::helper::Line>) {
        self.session.lock().unwrap_or_else(|e| e.into_inner()).tail(n)
    }

    /// Whether the last of `session_tail` is the utterance still being spoken, and the latency readout
    /// of each line of `session_tail(n)`.
    pub fn session_extras(&self, n: usize) -> (bool, Vec<Option<u32>>) {
        let l = self.session.lock().unwrap_or_else(|e| e.into_inner());
        (l.interim_shown(), l.tail_ms(n))
    }

    /// The running session's lines so far, for a notes refresh.
    pub fn session_lines(&self) -> Vec<poni_core::helper::Line> {
        self.session.lock().unwrap_or_else(|e| e.into_inner()).lines()
    }

    pub fn restore_session(&self, lines: Vec<poni_core::helper::Line>) {
        self.session.lock().unwrap_or_else(|e| e.into_inner()).restore(lines);
    }

    /// `POST /ui-prefs` to the engine: the spoken and target language.
    pub fn helper_post_prefs(&self, body: String) {
        if let Some(h) = &self.helper {
            h.post_prefs(body);
        }
    }

    pub fn helper_poll(&self) {
        if let Some(h) = &self.helper {
            h.poll();
        }
    }

    /// A calendar request to the engine; the answer comes back as `AppEvent::Calendar`.
    pub fn calendar(&self, req: poni_core::calendar::Req) {
        if let Some(h) = &self.helper {
            h.calendar(req);
        }
    }

    /// Step aside on (the band along the top edge of the island's monitor,
    /// screen pixels) or off: the full-screen watcher reports what reaches it.
    pub fn watch_top(&self, band: Option<RECT>) {
        if let Some(f) = &self.fullscreen {
            f.watch_top(band);
        }
    }

    /// Look for a meeting only while sound or media plays.
    pub fn meeting_probe_active(&self, on: bool) {
        if let Some(p) = &self.meeting_probe {
            p.set_active(on);
        }
    }

    /// Explorer restarted: AppBar registrations are lost and must be redone.
    pub fn on_taskbar_created(&self) {
        if let Some(f) = &self.fullscreen {
            f.on_taskbar_created();
        }
    }

    pub fn media_cmd(&self, c: MediaCmd) {
        if let Some(m) = &self.media {
            m.send(c);
        }
    }

    /// Translate the song's lines once (or read them from the cache); `None` stops the one running.
    pub fn translate_lyrics(&self, job: Option<lyric_translate::Job>) {
        if let Some(t) = &self.lyric_tr {
            match job {
                Some(j) => t.request(j),
                None => t.cancel(),
            }
        }
    }

    pub fn request_lyrics(&self, s: &MediaSession) {
        if let Some(l) = &self.lyrics {
            l.request(s);
        }
    }

    /// Show a pairing QR code: the link, or a sentence for the panel.
    pub fn pair_begin(&self) -> Result<String, String> {
        match &self.pairdrop {
            Some(p) => p.begin_pairing(),
            None if poni_core::pairdrop::configured_server().is_none() => Err(poni_core::pairdrop::NO_SERVER.into()),
            None => Err("Pairing couldn't start on this PC.".into()),
        }
    }

    pub fn pair_cancel(&self) {
        if let Some(p) = &self.pairdrop {
            p.cancel_pairing();
        }
    }

    pub fn pair_remove(&self, room: &str) {
        if let Some(p) = &self.pairdrop {
            p.remove(room);
        }
    }

    /// The Shelf's files, which connected paired phones may save.
    pub fn pair_shelf(&self, paths: Vec<std::path::PathBuf>) {
        if let Some(p) = &self.pairdrop {
            p.set_shelf(paths);
        }
    }

    pub fn pairs(&self) -> Vec<poni_core::pairdrop::Pair> {
        self.pairdrop.as_ref().map(|p| p.pairs()).unwrap_or_default()
    }

    /// The Apple Music token on disk was saved or removed.
    pub fn apple_music_token_changed(&self) {
        if let Some(l) = &self.lyrics {
            l.apple_token_changed();
        }
    }

    /// Handle the AppBar callback message; `Some(true)` when a full-screen
    /// app covers the island's monitor.
    pub fn on_appbar_message(&self, wp: WPARAM, lp: LPARAM, monitor: isize) -> Option<bool> {
        self.fullscreen.as_ref().and_then(|f| f.on_appbar_message(wp, lp, monitor))
    }
}

/// Windows apps are set to light mode (Settings › Personalization › Colors).
pub fn apps_use_light_theme() -> bool {
    use windows::UI::ViewManagement::{UIColorType, UISettings};
    // The system background is white in light mode and black in dark mode.
    UISettings::new().and_then(|s| s.GetColorValue(UIColorType::Background)).map(|c| c.R as u32 + c.G as u32 + c.B as u32 > 382).unwrap_or(true)
}

/// The Windows accent colour as it is: the Glass theme's text and fills sit
/// on light and dark glass alike, so it isn't lightened for black.
pub fn system_accent_base() -> Option<Color> {
    use windows::UI::ViewManagement::{UIColorType, UISettings};
    let s = UISettings::new().ok()?;
    let c = s.GetColorValue(UIColorType::Accent).ok()?;
    Some(Color::rgba(c.R as f32 / 255.0, c.G as f32 / 255.0, c.B as f32 / 255.0, 1.0))
}

/// The Windows accent colour, lightened for use on the black island.
pub fn system_accent() -> Option<Color> {
    use windows::UI::ViewManagement::{UIColorType, UISettings};
    let s = UISettings::new().ok()?;
    let c = s.GetColorValue(UIColorType::AccentLight2).ok()?;
    Some(Color::rgba(c.R as f32 / 255.0, c.G as f32 / 255.0, c.B as f32 / 255.0, 1.0).for_island_accent())
}

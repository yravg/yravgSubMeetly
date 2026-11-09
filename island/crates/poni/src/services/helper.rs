//! The helper link: asks `GET /health` and `GET /notes` on loopback every
//! few seconds (`poni_core::helper`) and sends what it learns to the UI
//! thread. A decision button posts the edited document through here too, then
//! asks again at once so the page shows what the helper kept.
//!
//! The calendar (`poni_core::calendar`) rides the same thread but is asked
//! once a minute, and at once after a calendar request.

use crate::events::{AppEvent, EventSink};
use poni_core::{calendar, helper};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

const EVERY: Duration = Duration::from_millis(2500);

enum Msg {
    /// `POST /notes` with this body, then ask again.
    Post(String),
    /// `POST /ui-prefs` (the languages), then ask again.
    Prefs(String),
    /// Ask now.
    Poll,
    /// A calendar request, then ask for the calendar and the notes again.
    Calendar(calendar::Req),
}

pub struct HelperService {
    tx: Sender<Msg>,
}

impl HelperService {
    pub fn start(sink: EventSink) -> std::io::Result<Self> {
        let (tx, rx) = channel::<Msg>();
        let port = helper::configured_port();
        std::thread::Builder::new().name("helper-link".into()).spawn(move || {
            let mut cal_at: Option<Instant> = None;
            let ask_calendar = |sink: &EventSink, cal_at: &mut Option<Instant>| {
                *cal_at = Some(Instant::now());
                sink.send(AppEvent::Calendar(calendar::fetch(port)));
            };
            loop {
                let ask = |sink: &EventSink| {
                    let t = Instant::now();
                    let r = helper::fetch(port).map(|s| (s, t.elapsed().as_millis().min(u32::MAX as u128) as u32));
                    sink.send(AppEvent::Helper(r));
                };
                match rx.recv_timeout(EVERY) {
                    Ok(Msg::Post(body)) => {
                        if let Err(e) = helper::post_note(port, &body) {
                            sink.send(AppEvent::Log(format!("helper: {e}")));
                            sink.send(AppEvent::HelperNotice(e));
                        }
                        ask(&sink);
                    }
                    Ok(Msg::Prefs(body)) => {
                        // shortcut: best effort and logged; an older engine refuses the keys and the island keeps its own settings.
                        match helper::request(port, "POST", "/ui-prefs", Some(&body)) {
                            Ok((200, _)) => {}
                            Ok((code, _)) => sink.send(AppEvent::Log(format!("engine: languages not saved (answered {code})"))),
                            Err(e) => sink.send(AppEvent::Log(format!("engine: languages not saved ({e})"))),
                        }
                        ask(&sink);
                    }
                    Ok(Msg::Calendar(req)) => {
                        let done = calendar::run(port, &req);
                        // The error text never holds a link: the engine masks it.
                        if let Err(e) = &done {
                            sink.send(AppEvent::Log(format!("calendar: {e}")));
                        }
                        ask(&sink);
                        ask_calendar(&sink, &mut cal_at);
                        if matches!(req, calendar::Req::Notes { .. }) {
                            sink.send(AppEvent::CalendarNotes(done.map(|t| t.unwrap_or_default())));
                        } else if let Err(e) = done {
                            sink.send(AppEvent::HelperNotice(e));
                        }
                    }
                    Ok(Msg::Poll) | Err(RecvTimeoutError::Timeout) => ask(&sink),
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if cal_at.is_none_or(|t| t.elapsed().as_secs() >= calendar::EVERY_S) {
                    ask_calendar(&sink, &mut cal_at);
                }
            }
        })?;
        Ok(Self { tx })
    }

    pub fn post(&self, body: String) {
        let _ = self.tx.send(Msg::Post(body));
    }

    pub fn post_prefs(&self, body: String) {
        let _ = self.tx.send(Msg::Prefs(body));
    }

    pub fn poll(&self) {
        let _ = self.tx.send(Msg::Poll);
    }

    pub fn calendar(&self, req: calendar::Req) {
        let _ = self.tx.send(Msg::Calendar(req));
    }
}

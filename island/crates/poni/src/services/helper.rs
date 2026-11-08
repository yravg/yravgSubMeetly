//! The helper link: asks `GET /health` and `GET /notes` on loopback every
//! few seconds (`poni_core::helper`) and sends what it learns to the UI
//! thread. A decision button posts the edited document through here too, then
//! asks again at once so the page shows what the helper kept.

use crate::events::{AppEvent, EventSink};
use poni_core::helper;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

const EVERY: Duration = Duration::from_millis(2500);

enum Msg {
    /// `POST /notes` with this body, then ask again.
    Post(String),
    /// Ask now.
    Poll,
}

pub struct HelperService {
    tx: Sender<Msg>,
}

impl HelperService {
    pub fn start(sink: EventSink) -> std::io::Result<Self> {
        let (tx, rx) = channel::<Msg>();
        let port = helper::configured_port();
        std::thread::Builder::new().name("helper-link".into()).spawn(move || loop {
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
                Ok(Msg::Poll) | Err(RecvTimeoutError::Timeout) => ask(&sink),
                Err(RecvTimeoutError::Disconnected) => break,
            }
        })?;
        Ok(Self { tx })
    }

    pub fn post(&self, body: String) {
        let _ = self.tx.send(Msg::Post(body));
    }

    pub fn poll(&self) {
        let _ = self.tx.send(Msg::Poll);
    }
}

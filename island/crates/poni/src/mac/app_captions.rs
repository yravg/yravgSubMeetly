//! Live captions on the Mac: what the Windows app does in `../app.rs` (set_captions, on_capture,
//! end_session, on_meeting_saved), carried out with the Mac's capture (`services::capture`) and the
//! shared session log, helper link and meeting document. Start and Stop come from the menu bar and the
//! pill's pages; Stop saves what was heard as a meeting (`MOM-MAC-<epoch>`) through the engine.

use super::*;
use poni_core::capture::{CaptureState, Source};

/// The title of a session that heard the room, when nothing names it.
const ROOM_TITLE: &str = "In-room meeting";

impl App {
    /// Spoken and target language codes for captions, as Settings have them now.
    fn caption_langs(&self) -> (String, String) {
        let s = &self.st.settings;
        (s.source_lang.clone(), poni_core::capture::caption_target(s.translate_captions, &s.target_lang).to_string())
    }

    /// Start or Stop pressed by the person.
    pub(super) fn captions_by_hand(&mut self, on: bool, source: Source) {
        self.set_captions(on, source);
    }

    /// Captions on (from `source`) or off; Off saves the session as a meeting.
    pub(super) fn set_captions(&mut self, on: bool, source: Source) {
        let sink = self.sink.clone();
        let (src, tgt) = self.caption_langs();
        self.st.settings.captions_on = on;
        if on {
            self.st.settings.captions_source = source.key().to_string();
        }
        self.save_settings();
        self.st.caption_hint = None;
        let latency = poni_core::utterance::Latency::parse(&self.st.settings.latency_mode);
        if on {
            self.engine_start();
            let port = poni_core::helper::configured_port();
            // One device reader at a time: the old one stops first.
            self.capture = None;
            self.session.lock().unwrap_or_else(|e| e.into_inner()).begin();
            let mic = self.st.settings.mic_device.clone();
            self.st.capture = match services::capture::CaptureService::start(sink, port, src, tgt, self.session.clone(), source, mic, latency) {
                Ok(c) => {
                    self.capture = Some(c);
                    CaptureState::On
                }
                Err(e) => CaptureState::Failed(format!("Captions could not start ({e}).")),
            };
            // Once the session heard the room it is an in-room meeting, whatever it switches to.
            self.st.call.room |= source.room();
            self.st.helper.set_following(true);
            self.st.kept_transcript = None;
            pinfo!("captions: on ({})", source.key());
        } else {
            self.capture = None;
            self.st.capture = CaptureState::Off;
            self.end_session(false);
            pinfo!("captions: off");
        }
        self.st.helper.capturing = self.st.capture.running();
        self.request_frame();
    }

    /// Running captions take the languages of Settings from their next window on, without a restart.
    pub(super) fn retune_captions(&mut self) {
        let (src, tgt) = self.caption_langs();
        if let Some(c) = &self.capture {
            c.set_langs(src, tgt);
            self.st.caption_hint = None;
            self.request_frame();
        }
    }

    /// A new Latency mode: running captions cut their next utterance with its timing.
    pub(super) fn retune_latency(&mut self) {
        let l = poni_core::utterance::Latency::parse(&self.st.settings.latency_mode);
        if let Some(c) = &self.capture {
            c.set_latency(l);
        }
    }

    /// Live's source picked: remembered, and running captions switch to it with the session's lines kept.
    pub(super) fn set_live_source(&mut self, source: Source) {
        self.st.settings.live_source = source.key().to_string();
        self.save_settings();
        if self.st.capture.running() {
            self.set_captions(true, source);
        }
    }

    /// The engine heard a line: the Meeting view of the session, and its notes when a refresh is due.
    fn call_heard(&mut self) {
        let Some(n) = self.call_lines() else { return };
        self.st.call.heard = n;
        if self.st.call.room && self.st.call.notes.due(self.st.now, n, self.st.power.saver) {
            self.call_refresh();
        }
    }

    /// The session's newest lines (and the utterance still being spoken, last); how many are kept.
    fn call_lines(&mut self) -> Option<usize> {
        let log = self.session.lock().unwrap_or_else(|e| e.into_inner());
        let (n, tail) = log.tail(crate::pages::call::LINES);
        let (interim, ms) = (log.interim_shown(), log.tail_ms(crate::pages::call::LINES));
        drop(log);
        if !(self.st.call.room && self.st.helper.paused()) {
            self.st.call.lines = tail;
            (self.st.call.interim, self.st.call.ms) = (interim, ms);
        }
        Some(n)
    }

    /// Ask the engine for the notes so far, off the UI thread (`AppEvent::CallNotes`).
    pub(super) fn call_refresh(&mut self) {
        let lines = self.session.lock().unwrap_or_else(|e| e.into_inner()).lines();
        if lines.is_empty() || self.st.call.notes.busy {
            return;
        }
        self.st.call.notes.ask(self.st.now, lines.len());
        let title = self.st.call.title.clone().or_else(|| self.st.running_event_title()).unwrap_or_default();
        let (sink, port) = (self.sink.clone(), poni_core::helper::configured_port());
        std::thread::spawn(move || sink.send(AppEvent::CallNotes(services::capture::draft_notes(port, &title, &lines))));
    }

    /// A report from the capture thread.
    pub(super) fn on_capture(&mut self, e: services::capture::CaptureEvent) {
        use services::capture::CaptureEvent;
        match e {
            // A late report from before Stop does not bring it back.
            CaptureEvent::State(_) | CaptureEvent::Heard | CaptureEvent::Hint(_) if self.st.capture == CaptureState::Off => {}
            CaptureEvent::State(s) => {
                if let CaptureState::Failed(_) = &s {
                    self.capture = None;
                    self.end_session(false);
                }
                self.st.helper.capturing = s.running();
                if s.running() && self.st.call.started.is_none() {
                    self.st.call.started = Some(self.st.now);
                }
                // Captions cannot start without the speech model: the pill says so and a tap downloads it.
                if s.needs_model() && !self.st.capture.needs_model() {
                    self.st.notify(Icon::Download, palette::ORANGE, "Speech model needed", "Open Settings \u{203a} Models to download it", 8.0, None);
                    self.refresh_models();
                }
                self.st.capture = s;
            }
            CaptureEvent::Heard => {
                if let Some(h) = &self.helper_link {
                    h.poll();
                }
                self.call_heard();
            }
            CaptureEvent::Hint(h) => self.st.caption_hint = h,
            // Windows Live Captions do not exist on the Mac.
            CaptureEvent::LiveCapGone(_) => {}
            // The utterance still being spoken: the pages' lines are read again and painted.
            CaptureEvent::Interim => {
                self.call_lines();
                self.request_frame();
            }
        }
        self.request_frame();
    }

    /// Captions stopped: what they heard becomes a meeting in the engine. `wait`: on quit, answer
    /// before the engine goes; otherwise it is saved off the UI thread and reported by an event.
    pub(super) fn end_session(&mut self, wait: bool) {
        // The Meeting view's live state ends with the session; its notes go with the save.
        let call = std::mem::take(&mut self.st.call);
        self.st.call = crate::state::CallState { saved: call.saved, asked_hosts: call.asked_hosts, ..Default::default() };
        let notes = call.notes;
        let lines = self.session.lock().unwrap_or_else(|e| e.into_inner()).take();
        if lines.is_empty() {
            return;
        }
        let t = clock::local_now();
        let start = poni_core::meeting_doc::start_stamp(&t);
        let room = call.room;
        let title = if room {
            call.title.clone().or_else(|| self.st.running_event_title()).unwrap_or_else(|| ROOM_TITLE.to_string())
        } else {
            self.st.running_event_title().unwrap_or_else(|| poni_core::meeting_doc::default_title(&t))
        };
        let m = services::capture::Meeting {
            id: format!("MOM-MAC-{}", self.st.unix),
            title,
            date: t.day_key(),
            start,
            locale: self.st.settings.source_lang.clone(),
            notes: room.then_some(notes),
            lines,
            transcript: false,
            room,
            app: None,
        };
        if m.notes.is_some() {
            let minutes = (m.lines.last().map_or(0.0, |l| l.t1) / 60.0).round().max(1.0) as u32;
            self.st.call.saving = Some((m.id.clone(), m.title.clone(), minutes, room));
        }
        let port = poni_core::helper::configured_port();
        if wait {
            match services::capture::save_meeting(port, m) {
                Ok((id, _)) => pinfo!("meeting {id} saved at quit"),
                Err((e, _)) => pwarn!("meeting not saved at quit: {e}"),
            }
        } else {
            let sink = self.sink.clone();
            std::thread::spawn(move || sink.send(AppEvent::MeetingSaved(services::capture::save_meeting(port, m))));
        }
    }

    /// The engine kept the session as a meeting (or did not).
    pub(super) fn on_meeting_saved(&mut self, r: services::capture::Saved) {
        let saving = self.st.call.saving.take();
        match r {
            Ok((id, counts)) => {
                pinfo!("meeting {id} saved");
                if let Some((sid, title, minutes, room)) = saving.filter(|(sid, ..)| *sid == id) {
                    self.st.call.saved = Some(crate::state::CallSaved { id: sid, title, minutes, counts, at: self.st.now, dismissed: false, room });
                }
                self.st.show_record(&id);
                if let Some(h) = &self.helper_link {
                    h.poll();
                }
                self.st.notify(Icon::Lyrics, palette::GREEN, "Meeting saved", "Open Minutes to see it", 8.0, Some(NoticeAction::OpenPage(PageKind::Meeting)));
            }
            Err((e, lines)) => {
                pwarn!("meeting not saved: {e}");
                if lines.is_empty() {
                    return;
                }
                // The lines wait for the next Stop rather than being lost.
                self.session.lock().unwrap_or_else(|e| e.into_inner()).restore(lines);
                self.st.notify(Icon::Lyrics, palette::ORANGE, "Meeting not saved", "The engine did not take it. It is kept for the next Stop.", 8.0, None);
            }
        }
    }
}

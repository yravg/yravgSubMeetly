//! Windows language features, looked at and added (`poni_core::winlang`).
//!
//! A check asks the feature itself: Japanese typing counts as there when
//! Windows' reading analyzer reads a line (`romanize::analyzer_works`), which
//! needs no permission and no elevation. An install runs one fixed,
//! elevated PowerShell command per feature (`shell::run_elevated_install`),
//! then checks again, so the answer is what the island can use, not what the
//! exit code said. Both run on a thread of their own and report with
//! `AppEvent::WinLang`; nothing here touches the UI thread.

use crate::events::{AppEvent, EventSink};
use poni_core::winlang::{self, Feature, State};

/// Whether `f` reads on this PC (the reason when not, for the log).
fn works(f: &Feature) -> Result<(), String> {
    match f.id {
        id if id == winlang::JAPANESE_TYPING.id => super::romanize::analyzer_works(),
        id => Err(format!("no check for {id}")),
    }
}

/// Look at every feature (asynchronously).
pub fn check(sink: EventSink) {
    let spawned = std::thread::Builder::new().name("poni-winlang".into()).spawn(move || {
        for f in winlang::ALL {
            let found = works(f);
            if let Err(why) = &found {
                crate::pinfo!("windows language: {} isn't usable: {why}", f.name);
            }
            sink.send(AppEvent::WinLang { id: f.id, state: winlang::from_check(found) });
        }
    });
    if let Err(e) = spawned {
        crate::pwarn!("windows language: the check thread didn't start ({e})");
    }
}

/// Add `f` (asynchronously): Windows asks for permission, installs, and the
/// answer comes once the feature was looked at again.
pub fn install(f: &'static Feature, sink: EventSink) {
    let spawned = std::thread::Builder::new().name("poni-winlang".into()).spawn({
        let sink = sink.clone();
        move || {
            crate::pinfo!("windows language: adding {} ({})", f.name, f.capability);
            let ran = crate::shell::run_elevated_install(&winlang::install_params(f));
            let found = works(f);
            crate::pinfo!("windows language: {} ended {ran:?}; usable now: {}", f.name, found.is_ok());
            sink.send(AppEvent::WinLang { id: f.id, state: winlang::after_install(ran, found.is_ok()) });
        }
    });
    if let Err(e) = spawned {
        crate::pwarn!("windows language: the install thread didn't start ({e})");
        sink.send(AppEvent::WinLang { id: f.id, state: State::Failed("Windows' installer didn't start; add it in Windows Settings".into()) });
    }
}

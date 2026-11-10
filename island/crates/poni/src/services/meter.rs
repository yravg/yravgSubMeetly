//! Is the PC playing sound? The peak meter of the default output
//! (`IAudioMeterInformation`), read twice a second on its own thread, through
//! `poni_core::capture::SoundGate`. Only on/off changes leave as
//! `AppEvent::Sound`; no audio is read or kept, only the level.

use crate::events::{AppEvent, EventSink};
use crate::services::audio::ComApartment;
use poni_core::capture::SoundGate;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

const EVERY: Duration = Duration::from_millis(500);
/// The default output can change (headset plugged in): look it up again this often.
const REOPEN: Duration = Duration::from_secs(5);

pub struct MeterService {
    stop: Sender<()>,
}

impl MeterService {
    pub fn start(sink: EventSink) -> std::io::Result<Self> {
        let (stop, rx) = channel::<()>();
        std::thread::Builder::new().name("poni-meter".into()).spawn(move || {
            let com = ComApartment::enter_mta();
            if !com.initialized {
                return;
            }
            let Ok(enumerator) = (unsafe { CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) }) else { return };
            let mut gate = SoundGate::default();
            let mut meter: Option<IAudioMeterInformation> = None;
            let mut opened = Instant::now();
            loop {
                match rx.recv_timeout(EVERY) {
                    Err(RecvTimeoutError::Timeout) => {}
                    _ => break,
                }
                if meter.is_none() || opened.elapsed() >= REOPEN {
                    opened = Instant::now();
                    meter = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }.ok().and_then(|d| unsafe { d.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None) }.ok());
                }
                // No device reads as quiet.
                let peak = meter.as_ref().and_then(|m| unsafe { m.GetPeakValue() }.ok()).unwrap_or(0.0);
                if let Some(on) = gate.step(peak, EVERY.as_secs_f64()) {
                    sink.send(AppEvent::Sound(on));
                }
            }
        })?;
        Ok(Self { stop })
    }
}

impl Drop for MeterService {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

//! Which speech model keeps up with live captions on this PC (speed-quality WP D: items 7, 8, 16,
//! 20), read from the engine's speed tests (`GET /models/bench`). Pure: nothing here switches a
//! model. Every switch is the person's click on an offer or a preset.

use crate::models::{Kind, Models};
use crate::speed::{rows, Group, Speed, State};

/// Below this many times real time a speech model falls behind live captions: a 4 s window has to
/// come back well inside 4 s, with time left for translation.
pub const LIVE_MIN: f64 = 1.2;

/// The newest measured speed of `id` (times real time), if it was ever tested here.
pub fn speed_of(s: &Speed, id: &str) -> Option<f64> {
    s.report.runs.get(id)?.last().map(|r| r.speed)
}

pub fn too_slow(x: f64) -> bool {
    x < LIVE_MIN
}

/// "2.7× real time" or "0.3× real time, too slow for live captions".
pub fn speed_note(x: f64) -> String {
    if too_slow(x) {
        format!("{x:.1}\u{d7} real time, too slow for live captions")
    } else {
        format!("{x:.1}\u{d7} real time")
    }
}

/// The fastest downloaded speech model whose newest test keeps up, with its speed.
pub fn fastest_live(m: &Models, s: &Speed) -> Option<(String, f64)> {
    rows(m, s)
        .into_iter()
        .filter(|r| r.group == Group::Speech)
        .filter_map(|r| Some((r.id, r.latest?.speed)))
        .filter(|(_, x)| !too_slow(*x))
        .max_by(|a, b| a.1.total_cmp(&b.1))
}

/// What to offer: the speech model in use (or picked) was tested too slow here, and another
/// downloaded one keeps up. `None` when there is nothing better to switch to.
pub fn switch_offer(m: &Models, s: &Speed) -> Option<(String, f64)> {
    let now = m.chosen(Kind::Asr)?;
    if !speed_of(s, &now).is_some_and(too_slow) {
        return None;
    }
    fastest_live(m, s).filter(|(id, _)| *id != now)
}

/// The speech model to test now: the one in use (or picked) is downloaded and was never tested,
/// and no test of it is running, waiting, failed or already asked for by this island.
pub fn bench_due(m: &Models, s: &Speed) -> Option<String> {
    let now = m.chosen(Kind::Asr)?;
    let row = rows(m, s).into_iter().find(|r| r.id == now && r.group == Group::Speech)?;
    (row.state == State::NotTested && !s.asked.contains(&now)).then_some(now)
}

/// Settings › Models › Speech recognition › Preset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Preset {
    BatterySaver,
    Balanced,
    BestQuality,
}

impl Preset {
    pub const ALL: [Preset; 3] = [Preset::BatterySaver, Preset::Balanced, Preset::BestQuality];

    pub fn name(self) -> &'static str {
        match self {
            Preset::BatterySaver => "Battery saver",
            Preset::Balanced => "Balanced",
            Preset::BestQuality => "Best quality",
        }
    }

    /// Its speech models, preferred first.
    fn ids(self) -> &'static [&'static str] {
        match self {
            Preset::BatterySaver => &["openai/whisper-base"],
            Preset::Balanced => &["openai/whisper-small"],
            Preset::BestQuality => &["openai/whisper-large-v3-turbo", "openai/whisper-medium"],
        }
    }

    /// What `POST /engine/device` gets: Battery saver keeps the graphics card off.
    pub fn device(self) -> &'static str {
        match self {
            Preset::BatterySaver => "cpu",
            _ => "auto",
        }
    }

    /// Best quality is offered only with a graphics card: on the CPU it is too slow for live.
    pub fn needs_gpu(self) -> bool {
        self == Preset::BestQuality
    }
}

/// The preset a speech model belongs to (`None`: a model no preset uses).
pub fn preset_of(id: &str) -> Option<Preset> {
    Preset::ALL.into_iter().find(|p| p.ids().contains(&id))
}

/// The model a preset switches to: its first one on disk, else its first one the engine offers
/// (Settings then shows its Download button).
pub fn preset_model(p: Preset, m: &Models) -> Option<String> {
    let offered: Vec<&str> = p.ids().iter().copied().filter(|id| m.catalog.iter().any(|c| c.kind == Kind::Asr && c.id == *id)).collect();
    offered.iter().find(|id| m.status(id).is_some_and(|s| s.downloaded)).or(offered.first()).map(|id| id.to_string())
}

/// The next preset in `step`'s direction, wrapping, skipping Best quality without a graphics card.
/// From no preset (a model none uses) a step forward lands on the first.
pub fn step_preset(now: Option<Preset>, step: i32, gpu: bool) -> Preset {
    let list: Vec<Preset> = Preset::ALL.into_iter().filter(|p| gpu || !p.needs_gpu()).collect();
    let n = list.len() as i32;
    let at = match now.and_then(|p| list.iter().position(|q| *q == p)) {
        Some(i) => i as i32 + step.signum(),
        None if step < 0 => n - 1,
        None => 0,
    };
    list[at.rem_euclid(n) as usize]
}

/// The engine runs on a graphics card (`/health` `device`: cuda, metal, vulkan...).
pub fn on_gpu(device: &str) -> bool {
    !device.is_empty() && device != "cpu"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Choice, Row, Status};
    use crate::speed::Run;

    fn choice(id: &str, downloaded: bool) -> Choice {
        Choice { kind: Kind::Asr, id: id.into(), label: id.into(), approx_bytes: 1, selected: false, st: Status { downloaded, ..Status::default() } }
    }

    /// This laptop's numbers on 2026-11-21 (bench.json): Base 2.7×, Medium 0.3× on the CPU.
    fn setup(using: &str) -> (Models, Speed) {
        let m = Models {
            rows: vec![Row { kind: Kind::Asr, id: Some(using.into()), loaded: false, loading: false, pinned: false, st: Status::default() }],
            catalog: vec![choice("openai/whisper-base", true), choice("openai/whisper-small", false), choice("openai/whisper-medium", true), choice("openai/whisper-large-v3-turbo", true)],
            ..Models::default()
        };
        let mut s = Speed::default();
        let run = |speed| vec![Run { speed, unit: "x real time".into(), at: "2026-11-21T04:00:00Z".into(), ..Run::default() }];
        s.report.runs.insert("openai/whisper-base".into(), run(2.7));
        s.report.runs.insert("openai/whisper-medium".into(), run(0.3));
        (m, s)
    }

    #[test]
    fn the_line_is_one_point_two_times_real_time() {
        assert!(too_slow(0.3) && too_slow(1.19));
        assert!(!too_slow(1.2) && !too_slow(2.7));
        assert_eq!(speed_note(0.3), "0.3\u{d7} real time, too slow for live captions");
        assert_eq!(speed_note(2.7), "2.7\u{d7} real time");
    }

    #[test]
    fn a_too_slow_model_is_offered_the_fastest_that_keeps_up() {
        let (m, s) = setup("openai/whisper-medium");
        assert_eq!(switch_offer(&m, &s), Some(("openai/whisper-base".into(), 2.7)));
    }

    #[test]
    fn no_offer_when_the_model_keeps_up_is_untested_or_nothing_is_faster() {
        let (m, s) = setup("openai/whisper-base");
        assert_eq!(switch_offer(&m, &s), None, "Base keeps up");
        let (m, s) = setup("openai/whisper-large-v3-turbo");
        assert_eq!(switch_offer(&m, &s), None, "turbo was never tested here");
        let (m, mut s) = setup("openai/whisper-medium");
        s.report.runs.get_mut("openai/whisper-base").unwrap()[0].speed = 1.0;
        assert_eq!(switch_offer(&m, &s), None, "nothing downloaded keeps up");
    }

    #[test]
    fn the_fastest_counts_only_downloaded_speech_models() {
        let (m, mut s) = setup("openai/whisper-medium");
        // A run for a model not on disk any more does not count.
        s.report.runs.insert("openai/whisper-small".into(), vec![Run { speed: 9.0, ..Run::default() }]);
        assert_eq!(fastest_live(&m, &s), Some(("openai/whisper-base".into(), 2.7)));
    }

    #[test]
    fn an_untested_model_in_use_is_tested_once() {
        let (m, mut s) = setup("openai/whisper-large-v3-turbo");
        assert_eq!(bench_due(&m, &s).as_deref(), Some("openai/whisper-large-v3-turbo"));
        s.asked.push("openai/whisper-large-v3-turbo".into());
        assert_eq!(bench_due(&m, &s), None, "already asked");
        let (m, mut s) = setup("openai/whisper-large-v3-turbo");
        s.report.queue.push("openai/whisper-large-v3-turbo".into());
        assert_eq!(bench_due(&m, &s), None, "already waiting");
        let (m, mut s) = setup("openai/whisper-large-v3-turbo");
        s.report.failed.insert("openai/whisper-large-v3-turbo".into(), "out of memory".into());
        assert_eq!(bench_due(&m, &s), None, "a failure is not retried by itself");
        let (m, s) = setup("openai/whisper-medium");
        assert_eq!(bench_due(&m, &s), None, "already tested");
        let (m, s) = setup("openai/whisper-small");
        assert_eq!(bench_due(&m, &s), None, "not on disk");
    }

    #[test]
    fn presets_pick_their_model_and_device() {
        let (m, _) = setup("openai/whisper-base");
        assert_eq!(preset_model(Preset::BatterySaver, &m).as_deref(), Some("openai/whisper-base"));
        assert_eq!(preset_model(Preset::Balanced, &m).as_deref(), Some("openai/whisper-small"), "to download");
        assert_eq!(preset_model(Preset::BestQuality, &m).as_deref(), Some("openai/whisper-large-v3-turbo"));
        let mut m2 = m.clone();
        m2.catalog[3].st.downloaded = false;
        assert_eq!(preset_model(Preset::BestQuality, &m2).as_deref(), Some("openai/whisper-medium"), "the one on disk wins");
        assert_eq!((Preset::BatterySaver.device(), Preset::Balanced.device()), ("cpu", "auto"));
        assert_eq!(preset_of("openai/whisper-medium"), Some(Preset::BestQuality));
        assert_eq!(preset_of("openai/whisper-tiny"), None);
    }

    #[test]
    fn best_quality_needs_a_graphics_card() {
        assert_eq!(step_preset(Some(Preset::Balanced), 1, false), Preset::BatterySaver, "skips Best quality on the CPU");
        assert_eq!(step_preset(Some(Preset::Balanced), 1, true), Preset::BestQuality);
        assert_eq!(step_preset(Some(Preset::BatterySaver), -1, true), Preset::BestQuality);
        assert_eq!(step_preset(None, 1, false), Preset::BatterySaver);
        assert_eq!(step_preset(None, -1, false), Preset::Balanced);
        assert_eq!(step_preset(Some(Preset::BestQuality), 1, false), Preset::BatterySaver, "a GPU preset on a CPU-only PC steps in");
        assert!(on_gpu("cuda") && on_gpu("vulkan") && !on_gpu("cpu") && !on_gpu(""));
    }
}

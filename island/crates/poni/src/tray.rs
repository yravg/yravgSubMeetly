//! Notification-area icon and its menu (also shown on right-click of the island).

use crate::events::WM_APP_TRAY;
use crate::updates::UpdateLine;
use poni_core::engine_link::EngineInfo;
use poni_core::settings::{IdleStyle, Settings, Theme};
use windows::core::{Result, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Shell::{Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW};
use windows::Win32::UI::WindowsAndMessaging::*;

pub struct Tray {
    hwnd: HWND,
}

impl Tray {
    pub fn add(hwnd: HWND) -> Result<Tray> {
        unsafe {
            let hinst = GetModuleHandleW(None)?;
            // Ask for the small-icon size so Windows picks poni.ico's own 16-24 px
            // frames; LoadIconW gives the 32 px one and shrinks it (blurry).
            let (cx, cy) = (GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON));
            let icon = LoadImageW(hinst, PCWSTR(1 as _), IMAGE_ICON, cx, cy, LR_DEFAULTCOLOR)
                .map(|h| HICON(h.0))
                .or_else(|_| LoadIconW(hinst, PCWSTR(1 as _)))
                .or_else(|_| LoadIconW(None, IDI_APPLICATION))?;
            let mut nid = NOTIFYICONDATAW {
                cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
                hWnd: hwnd,
                uID: 1,
                uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP,
                uCallbackMessage: WM_APP_TRAY,
                hIcon: icon,
                ..Default::default()
            };
            let tip: Vec<u16> = format!("yravgSubMeetly {}", crate::version::VERSION).encode_utf16().collect();
            nid.szTip[..tip.len()].copy_from_slice(&tip);
            if !Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
                return Err(windows::core::Error::from_win32());
            }
        }
        Ok(Tray { hwnd })
    }

    pub fn remove(self) {
        unsafe {
            let nid = NOTIFYICONDATAW { cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32, hWnd: self.hwnd, uID: 1, ..Default::default() };
            let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuCmd {
    ToggleIdleStyle(IdleStyle),
    SetTheme(Theme),
    ToggleSystemHistory,
    ToggleLyrics,
    TogglePronunciation,
    /// true: hide in full-screen apps; false: stay on top of them.
    SetHideFullscreen(bool),
    /// Show over games (frame rate, GPU and CPU on the island over a game).
    ToggleGameStats,
    /// Show over games for a few seconds at a time instead of all along.
    ToggleGamePeek,
    ToggleSounds,
    TogglePinned,
    /// "Move island to the centre": back from where it was dragged.
    CentreIsland,
    ToggleAutostart,
    /// "Advanced settings…": the Settings window.
    ShowSettings,
    OpenSettings,
    ReloadSettings,
    OpenDataFolder,
    /// "About yravgSubMeetly 0.2.3 (…)": opens this version's release notes.
    About,
    /// "Lyrics by LRCLIB": opens lrclib.net.
    LyricsCredit,
    AppleMusicToken,
    AppleMusicHelp,
    AppleMusicForget,
    /// "Update to yravgSubMeetly 0.2.5…" (`crate::updates`).
    Update,
    /// "Check for updates…": read the update file now (`crate::updates`).
    CheckForUpdates,
    /// Our own parts, from the product group of the menu.
    OpenApp,
    OpenMinutes,
    OpenLive,
    OpenMeeting,
    OpenInbox,
    StartEngine,
    RestartEngine,
    /// Opens the how-to page for loading the Chrome extension.
    SetupExtension,
    OpenCaptionsPanel,
    /// Captions from what the PC plays (the island's own capture).
    StartCaptions,
    StopCaptions,
    Quit,
}

pub enum MenuItem {
    Item { label: String, cmd: MenuCmd, checked: bool },
    /// A greyed line that only says something ("Connected as …").
    Info { label: String },
    Sub { label: String, items: Vec<MenuItem> },
    Separator,
}

fn item(label: &str, cmd: MenuCmd, checked: bool) -> MenuItem {
    MenuItem::Item { label: label.to_string(), cmd, checked }
}

/// An idle look as the menu names it.
fn idle_label(s: IdleStyle) -> &'static str {
    match s {
        IdleStyle::Clock => "Clock",
        IdleStyle::Eyes => "Eyes",
        IdleStyle::Minimal => "Minimal",
        IdleStyle::Hidden => "Hidden until hover",
        IdleStyle::Status => "Status bar",
    }
}

/// The engine and extension entries of the product group, shared by the tray
/// menu and the island's Menu list. `None` command = a greyed line.
/// `check`: add "Check for updates…" (no newer version is on offer).
pub fn product_actions(engine: &EngineInfo, check: bool, capturing: bool) -> Vec<(String, Option<MenuCmd>)> {
    let mut v = vec![(engine.line.clone(), None)];
    v.push(if capturing {
        ("Stop live captions".into(), Some(MenuCmd::StopCaptions))
    } else {
        ("Start live captions (what this PC plays)".into(), Some(MenuCmd::StartCaptions))
    });
    if !engine.running {
        v.push(("Start engine".into(), Some(MenuCmd::StartEngine)));
    } else if engine.ours {
        v.push(("Restart engine".into(), Some(MenuCmd::RestartEngine)));
    }
    v.push(if engine.ext_seen {
        ("Open captions panel in Chrome".into(), Some(MenuCmd::OpenCaptionsPanel))
    } else {
        ("Set up Chrome extension…".into(), Some(MenuCmd::SetupExtension))
    });
    if check {
        v.push(("Check for updates…".into(), Some(MenuCmd::CheckForUpdates)));
    }
    v
}

/// `update`: a later version the update file offers, or Check for updates…
/// (`crate::updates::menu_line`). `engine`: the engine link's last word.
pub fn menu_items(s: &Settings, pinned: bool, update: UpdateLine, engine: &EngineInfo, capturing: bool) -> Vec<MenuItem> {
    // The look the theme draws is the one checked: outside Pill, Status shows the clock.
    let shown = crate::pill::status::shown(s.theme, s.idle_style);
    let style = |st: IdleStyle| item(idle_label(st), MenuCmd::ToggleIdleStyle(st), shown == st);
    let theme = |label: &str, t: Theme| item(label, MenuCmd::SetTheme(t), s.theme == t);
    let fullscreen = |label: &str, hide: bool| item(label, MenuCmd::SetHideFullscreen(hide), s.hide_in_fullscreen == hide);
    let mut items = vec![MenuItem::Info { label: "yravgSubMeetly".into() }];
    for (label, cmd) in [("Open yravgSubMeetly", MenuCmd::OpenApp), ("Open Minutes register", MenuCmd::OpenMinutes), ("Live captions", MenuCmd::OpenLive), ("Meeting", MenuCmd::OpenMeeting), ("Inbox", MenuCmd::OpenInbox)] {
        items.push(item(label, cmd, false));
    }
    items.push(MenuItem::Separator);
    for (label, cmd) in product_actions(engine, matches!(update, UpdateLine::Check), capturing) {
        items.push(match cmd {
            Some(cmd) => item(&label, cmd, false),
            None => MenuItem::Info { label },
        });
    }
    items.push(MenuItem::Separator);
    items.push(item("Advanced settings…", MenuCmd::ShowSettings, false));
    items.push(item("Keep island open", MenuCmd::TogglePinned, pinned));
    // Only once the island was dragged off the middle: the way back, under Keep island open.
    if s.island_x.is_some() {
        items.push(item("Move island to the centre", MenuCmd::CentreIsland, false));
    }
    items.push(MenuItem::Sub { label: "Theme".into(), items: vec![theme("Classic", Theme::Classic), theme("Glass", Theme::Glass), theme("Paper", Theme::Paper), theme("Pill", Theme::Pill)] });
    // The status bar is listed only in Pill, as on the Settings page: the
    // other themes would draw the clock for it.
    items.push(MenuItem::Sub { label: "Idle look".into(), items: crate::pill::status::looks(s.theme).iter().map(|l| style(*l)).collect() });
    items.push(item("Start with Windows", MenuCmd::ToggleAutostart, crate::autostart::is_enabled()));
    items.push(MenuItem::Separator);
    // Oyenza's own extras: all still here, one level down.
    let mut more = vec![
        item("Synced lyrics", MenuCmd::ToggleLyrics, s.lyrics),
        item("Lyrics pronunciation (romaji, pinyin, Korean)", MenuCmd::TogglePronunciation, s.lyrics_pronunciation),
        apple_music_menu(),
    ];
    // Only while the System add-on is on: its page's history, above Sounds.
    if s.system_on() {
        more.push(item("Keep System page history", MenuCmd::ToggleSystemHistory, s.system_history));
    }
    more.push(item("Sounds", MenuCmd::ToggleSounds, s.sounds));
    more.push(MenuItem::Sub {
        label: "In full-screen apps".into(),
        items: vec![
            fullscreen("Hide", true),
            fullscreen("Stay on top", false),
            MenuItem::Separator,
            item("Show FPS, GPU and CPU over games", MenuCmd::ToggleGameStats, s.game_stats),
            item("Only for a few seconds (no added delay)", MenuCmd::ToggleGamePeek, s.game_peek),
        ],
    });
    more.push(MenuItem::Separator);
    more.push(item("Open settings file", MenuCmd::OpenSettings, false));
    more.push(item("Reload settings", MenuCmd::ReloadSettings, false));
    more.push(item("Open data folder", MenuCmd::OpenDataFolder, false));
    more.push(item("Lyrics by LRCLIB", MenuCmd::LyricsCredit, false));
    items.push(MenuItem::Sub { label: "More".into(), items: more });
    items.push(MenuItem::Separator);
    // Which version and build this is, as the Mac menu says it.
    items.push(item(&crate::version::about_label(), MenuCmd::About, false));
    items.push(item("Quit yravgSubMeetly", MenuCmd::Quit, false));
    // A new version first, until it is installed.
    if let UpdateLine::Offer(v) = update {
        items.splice(0..0, [item(&format!("Update to yravgSubMeetly {v}…"), MenuCmd::Update, false), MenuItem::Separator]);
    }
    items
}

/// Opt-in lyrics from Apple Music with the user's own token.
fn apple_music_menu() -> MenuItem {
    let on = crate::paths::apple_music_token_path().exists();
    let mut items = vec![
        item("Use token from clipboard", MenuCmd::AppleMusicToken, false),
        item("How to get the token", MenuCmd::AppleMusicHelp, false),
    ];
    if on {
        items.push(MenuItem::Separator);
        items.push(item("Remove token", MenuCmd::AppleMusicForget, false));
    }
    MenuItem::Sub { label: if on { "Apple Music lyrics: on".into() } else { "Apple Music lyrics".into() }, items }
}

fn build(menu: HMENU, items: &[MenuItem], cmds: &mut Vec<MenuCmd>) {
    for it in items {
        unsafe {
            match it {
                MenuItem::Item { label, cmd, checked } => {
                    cmds.push(*cmd);
                    let id = cmds.len();
                    let w: Vec<u16> = label.encode_utf16().chain(Some(0)).collect();
                    let flags = MF_STRING | if *checked { MF_CHECKED } else { MF_UNCHECKED };
                    let _ = AppendMenuW(menu, flags, id, PCWSTR(w.as_ptr()));
                }
                MenuItem::Info { label } => {
                    let w: Vec<u16> = label.encode_utf16().chain(Some(0)).collect();
                    let _ = AppendMenuW(menu, MF_STRING | MF_GRAYED | MF_DISABLED, 0, PCWSTR(w.as_ptr()));
                }
                MenuItem::Sub { label, items } => {
                    if let Ok(sub) = CreatePopupMenu() {
                        build(sub, items, cmds);
                        let w: Vec<u16> = label.encode_utf16().chain(Some(0)).collect();
                        let _ = AppendMenuW(menu, MF_POPUP, sub.0 as usize, PCWSTR(w.as_ptr()));
                    }
                }
                MenuItem::Separator => {
                    let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
                }
            }
        }
    }
}

/// Show the menu at `pt` (screen pixels); returns the chosen command.
pub fn show_menu(owner: HWND, pt: POINT, items: &[MenuItem]) -> Option<MenuCmd> {
    unsafe {
        let menu = CreatePopupMenu().ok()?;
        let mut cmds = Vec::new();
        build(menu, items, &mut cmds);
        // Required so the menu closes when clicking elsewhere; afterwards the
        // previous app gets its focus back.
        let prev = GetForegroundWindow();
        let _ = SetForegroundWindow(owner);
        let chosen = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY, pt.x, pt.y, 0, owner, None);
        let _ = PostMessageW(owner, WM_NULL, WPARAM(0), LPARAM(0));
        let _ = DestroyMenu(menu);
        let idx = chosen.0 as usize;
        let cmd = if idx == 0 { None } else { cmds.get(idx - 1).copied() };
        let launches = matches!(
            cmd,
            Some(MenuCmd::ShowSettings | MenuCmd::OpenSettings | MenuCmd::OpenDataFolder | MenuCmd::About | MenuCmd::LyricsCredit | MenuCmd::AppleMusicHelp)
        );
        if !launches && !prev.is_invalid() && prev != owner && IsWindow(prev).as_bool() && GetForegroundWindow() == owner {
            let _ = SetForegroundWindow(prev);
        }
        cmd
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn items(s: &Settings, update: UpdateLine, engine: &EngineInfo) -> Vec<MenuItem> {
        menu_items(s, false, update, engine, false)
    }

    /// Every command in the menu, submenus included, in order.
    fn flat(list: &[MenuItem]) -> Vec<(String, MenuCmd, bool)> {
        let mut out = Vec::new();
        for i in list {
            match i {
                MenuItem::Item { label, cmd, checked } => out.push((label.clone(), *cmd, *checked)),
                MenuItem::Sub { items, .. } => out.extend(flat(items)),
                _ => {}
            }
        }
        out
    }

    fn cmds(s: &Settings, update: UpdateLine, e: &EngineInfo) -> Vec<MenuCmd> {
        flat(&items(s, update, e)).into_iter().map(|c| c.1).collect()
    }

    fn sub<'a>(list: &'a [MenuItem], name: &str) -> &'a [MenuItem] {
        for i in list {
            if let MenuItem::Sub { label, items } = i {
                if label == name {
                    return items;
                }
            }
        }
        panic!("no {name} submenu");
    }

    fn engine(running: bool, ours: bool, ext_seen: bool) -> EngineInfo {
        EngineInfo { line: if running { "Engine: running (Rust) on 17865".into() } else { "Engine: not running".into() }, running, ours, ext_seen, ..Default::default() }
    }

    #[test]
    fn our_own_parts_come_first_in_the_order_the_owner_asked() {
        let list = items(&Settings::default(), UpdateLine::Check, &engine(true, true, false));
        let labels: Vec<String> = list
            .iter()
            .take_while(|i| !matches!(i, MenuItem::Item { cmd: MenuCmd::ShowSettings, .. }))
            .filter_map(|i| match i {
                MenuItem::Item { label, .. } | MenuItem::Info { label } => Some(label.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            labels,
            ["yravgSubMeetly", "Open yravgSubMeetly", "Open Minutes register", "Live captions", "Meeting", "Inbox", "Engine: running (Rust) on 17865", "Start live captions (what this PC plays)", "Restart engine", "Set up Chrome extension…", "Check for updates…"]
        );
    }

    #[test]
    fn the_menu_offers_start_or_stop_for_the_island_s_own_captions() {
        let e = engine(true, true, false);
        let has = |capturing: bool, cmd: MenuCmd| product_actions(&e, false, capturing).iter().any(|(_, c)| *c == Some(cmd));
        assert!(has(false, MenuCmd::StartCaptions) && !has(false, MenuCmd::StopCaptions));
        assert!(has(true, MenuCmd::StopCaptions) && !has(true, MenuCmd::StartCaptions));
    }

    #[test]
    fn the_engine_lines_follow_the_engine() {
        let c = |e: &EngineInfo| cmds(&Settings::default(), UpdateLine::None, e);
        let stopped = c(&engine(false, false, false));
        assert!(stopped.contains(&MenuCmd::StartEngine) && !stopped.contains(&MenuCmd::RestartEngine));
        // A helper the island did not start is not the island's to restart.
        let foreign = c(&engine(true, false, false));
        assert!(!foreign.contains(&MenuCmd::StartEngine) && !foreign.contains(&MenuCmd::RestartEngine));
        assert!(c(&engine(true, true, false)).contains(&MenuCmd::RestartEngine));
    }

    #[test]
    fn the_extension_line_says_set_up_until_the_extension_has_been_seen() {
        let c = |seen: bool| cmds(&Settings::default(), UpdateLine::None, &engine(true, true, seen));
        assert!(c(false).contains(&MenuCmd::SetupExtension) && !c(false).contains(&MenuCmd::OpenCaptionsPanel));
        assert!(c(true).contains(&MenuCmd::OpenCaptionsPanel) && !c(true).contains(&MenuCmd::SetupExtension));
    }

    #[test]
    fn nothing_of_oyenzas_was_removed_it_moved_under_more() {
        let list = items(&Settings::default(), UpdateLine::None, &engine(true, true, false));
        let top: Vec<MenuCmd> = list.iter().filter_map(|i| if let MenuItem::Item { cmd, .. } = i { Some(*cmd) } else { None }).collect();
        for gone in [MenuCmd::ToggleLyrics, MenuCmd::TogglePronunciation, MenuCmd::ToggleSounds, MenuCmd::LyricsCredit, MenuCmd::OpenSettings, MenuCmd::ReloadSettings, MenuCmd::OpenDataFolder] {
            assert!(!top.contains(&gone), "{gone:?} should sit under More");
        }
        let more = flat(sub(&list, "More"));
        for c in [MenuCmd::ToggleLyrics, MenuCmd::TogglePronunciation, MenuCmd::ToggleSounds, MenuCmd::ToggleGameStats, MenuCmd::ToggleGamePeek, MenuCmd::LyricsCredit, MenuCmd::AppleMusicToken, MenuCmd::OpenSettings] {
            assert!(more.iter().any(|m| m.1 == c), "{c:?} missing from More");
        }
        // The island's own settings stay up top.
        for c in [MenuCmd::ShowSettings, MenuCmd::TogglePinned, MenuCmd::ToggleAutostart] {
            assert!(top.contains(&c), "{c:?}");
        }
    }

    #[test]
    fn quit_is_last_and_the_version_line_sits_above_it() {
        let labels = flat(&items(&Settings::default(), UpdateLine::None, &engine(true, true, false)));
        let about = labels.iter().position(|l| l.1 == MenuCmd::About).expect("no About line");
        assert!(labels[about].0.starts_with(&format!("About yravgSubMeetly {}", env!("CARGO_PKG_VERSION"))), "{}", labels[about].0);
        assert_eq!(labels.last().map(|l| l.1), Some(MenuCmd::Quit));
        assert_eq!(about + 1, labels.len() - 1);
    }

    #[test]
    fn a_new_version_comes_first_until_it_is_installed() {
        let e = engine(true, true, false);
        let first = |update: UpdateLine| match items(&Settings::default(), update, &e).into_iter().next() {
            Some(MenuItem::Item { label, cmd, .. }) => Some((label, cmd)),
            _ => None,
        };
        assert_eq!(first(UpdateLine::Offer("0.2.5".into())), Some(("Update to yravgSubMeetly 0.2.5…".to_string(), MenuCmd::Update)));
        assert_eq!(first(UpdateLine::None), None);
        let c = |update: UpdateLine| cmds(&Settings::default(), update, &e);
        assert!(c(UpdateLine::Check).contains(&MenuCmd::CheckForUpdates));
        assert!(!c(UpdateLine::Offer("0.2.5".into())).contains(&MenuCmd::CheckForUpdates));
        assert!(!c(UpdateLine::None).contains(&MenuCmd::CheckForUpdates));
    }

    #[test]
    fn the_way_back_to_the_centre_shows_once_the_island_moved() {
        let e = engine(true, true, false);
        assert!(!cmds(&Settings::default(), UpdateLine::None, &e).contains(&MenuCmd::CentreIsland));
        let moved = cmds(&Settings { island_x: Some(0.8), ..Settings::default() }, UpdateLine::None, &e);
        let pin = moved.iter().position(|c| *c == MenuCmd::TogglePinned).expect("no Keep island open");
        assert_eq!(moved.get(pin + 1), Some(&MenuCmd::CentreIsland));
    }

    #[test]
    fn system_history_is_in_the_menu_only_while_system_is_on() {
        let e = engine(true, true, false);
        let at = |s: &Settings| cmds(s, UpdateLine::None, &e).iter().position(|c| *c == MenuCmd::ToggleSystemHistory);
        let mut s = Settings::default();
        assert_eq!(at(&s), None, "System is off by default");
        s.set_addon(poni_core::addons::SYSTEM.id, true);
        let all = cmds(&s, UpdateLine::None, &e);
        // Right above Sounds, where it always was.
        assert_eq!(all[at(&s).expect("no System history item") + 1], MenuCmd::ToggleSounds);
    }

    fn idle_choices(s: &Settings) -> Vec<(String, bool)> {
        let list = items(s, UpdateLine::None, &engine(true, true, false));
        sub(&list, "Idle look")
            .iter()
            .filter_map(|i| match i {
                MenuItem::Item { label, checked, .. } => Some((label.clone(), *checked)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn status_bar_is_listed_only_in_the_pill_theme() {
        let pill = Settings { theme: Theme::Pill, idle_style: IdleStyle::Status, ..Settings::default() };
        let labels: Vec<String> = idle_choices(&pill).into_iter().map(|c| c.0).collect();
        assert_eq!(labels, ["Clock", "Eyes", "Minimal", "Hidden until hover", "Status bar"]);
        assert_eq!(idle_choices(&pill).last(), Some(&("Status bar".to_string(), true)));
        // Another theme draws the clock for the status bar: Clock is checked,
        // and Status comes back with Pill.
        for theme in [Theme::Classic, Theme::Glass] {
            let s = Settings { theme, ..pill.clone() };
            let choices = idle_choices(&s);
            assert_eq!(choices.len(), 4, "{theme:?}");
            assert_eq!(choices[0], ("Clock".to_string(), true), "{theme:?}");
            assert!(choices.iter().skip(1).all(|c| !c.1), "{theme:?}");
        }
    }

    #[test]
    fn full_screen_submenu_checks_the_current_choice() {
        let mut s = Settings::default();
        for hide in [true, false] {
            s.hide_in_fullscreen = hide;
            let list = items(&s, UpdateLine::None, &engine(true, true, false));
            let more = sub(&list, "More");
            assert_eq!(
                flat(sub(more, "In full-screen apps")),
                vec![
                    ("Hide".to_string(), MenuCmd::SetHideFullscreen(true), hide),
                    ("Stay on top".to_string(), MenuCmd::SetHideFullscreen(false), !hide),
                    ("Show FPS, GPU and CPU over games".to_string(), MenuCmd::ToggleGameStats, false),
                    ("Only for a few seconds (no added delay)".to_string(), MenuCmd::ToggleGamePeek, false),
                ]
            );
        }
    }
}

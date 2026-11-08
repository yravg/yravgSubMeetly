//! Add-ons: features that download only for the people who switch them on.
//!
//! An add-on's code is part of the app and stays asleep while it is off. The
//! switch downloads the add-on's files (data and sounds) from a pre-release
//! on the app's GitHub repository, and switching it off deletes them. Each
//! file's size and SHA-256 are built into the app, so a changed or broken
//! file is refused; new files come with a new app release (a new `tag`).
//! The apps' `services::addons` (one file, the Windows app's, which the Mac
//! app runs too) does the downloading.

use crate::phonedrop::fmt_bytes;
use crate::sha256;

/// Where the files live: `<RELEASES>/<tag>/<name>`.
pub const RELEASES: &str = "https://github.com/yraverage/yraverageSubMeetly/releases/download";

/// One file an add-on downloads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AddonFile {
    pub name: &'static str,
    pub size: u64,
    /// SHA-256, lowercase hex.
    pub sha256: &'static str,
    /// Where it comes from when that isn't the add-on's own release: a tool's
    /// own release, unchanged (the Downloader's yt-dlp and QuickJS). Saved
    /// under `name` all the same.
    pub url: Option<&'static str>,
}

impl AddonFile {
    /// True when `bytes` are exactly this file.
    pub fn matches(&self, bytes: &[u8]) -> bool {
        bytes.len() as u64 == self.size && sha256::hex(&sha256::sha256(bytes)) == self.sha256
    }

    /// The same for a file read from `r` 64 KB at a time, so checking one on
    /// disk never holds all of it in memory (the Downloader's yt-dlp is 24 MB).
    pub fn matches_read(&self, mut r: impl std::io::Read) -> bool {
        let (mut hash, mut n, mut buf) = (sha256::Sha256::new(), 0u64, vec![0u8; 64 * 1024]);
        loop {
            match r.read(&mut buf) {
                Ok(0) => break,
                Ok(k) => {
                    n += k as u64;
                    if n > self.size {
                        return false;
                    }
                    hash.update(&buf[..k]);
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => return false,
            }
        }
        n == self.size && sha256::hex(&hash.finish()) == self.sha256
    }

    /// Whether this build of the app knows the file: a size and a SHA-256 to
    /// check it against. A placeholder (size 0, no SHA-256) stands for a file
    /// that isn't published yet, and nothing is downloaded for it.
    pub fn pinned(&self) -> bool {
        self.size > 0 && self.sha256.len() == 64 && self.sha256.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Addon {
    /// Stable id: the key in settings.json and the folder's name.
    pub id: &'static str,
    pub title: &'static str,
    /// What it does, in one line, for the Add-ons page.
    pub blurb: &'static str,
    /// The same in the Mac app, where `blurb` gives Windows' reason (None:
    /// `blurb` there too).
    pub mac_blurb: Option<&'static str>,
    /// The release that holds this version of the files.
    pub tag: &'static str,
    pub files: &'static [AddonFile],
    /// Part of yravgSubMeetly Pro: it works only for an Oyenza account the
    /// server says has Pro (`GET /island/pro`; `AppState::pro`).
    pub pro: bool,
}

impl Addon {
    /// Every file together, in bytes.
    pub fn size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }

    pub fn url(&self, file: &AddonFile) -> String {
        match file.url {
            Some(url) => url.to_string(),
            None => format!("{RELEASES}/{}/{}", self.tag, file.name),
        }
    }

    pub fn find(id: &str) -> Option<&'static Addon> {
        ALL.iter().copied().find(|a| a.id == id)
    }

    /// Whether it has files to download. One without (Script reader) is
    /// already in the app: the switch only shows or hides it, and the
    /// downloader never touches it.
    pub fn downloads(&self) -> bool {
        !self.files.is_empty()
    }

    /// Whether this build can get every file it needs ([`AddonFile::pinned`]).
    /// One that can't stays off ([`Status::Unpinned`]): a build made while a
    /// file is still a placeholder (a new add-on whose files aren't on its
    /// release yet).
    pub fn pinned(&self) -> bool {
        self.files.iter().all(AddonFile::pinned)
    }
}


/// Script reader: the Script page, a teleprompter under the webcam. Its
/// code is in the app (a few dozen KB), so there is nothing to download; off,
/// the island has no Script tab, no Alt+Shift+S and nothing running for it.
pub const SCRIPT_READER: Addon = Addon {
    id: "script",
    title: "Script reader",
    blurb: "A teleprompter under your webcam, left out of screen shares.",
    mac_blurb: Some("A teleprompter under your webcam."),
    tag: "",
    files: &[],
    pro: false,
};

/// System: the System page (the processor, graphics, memory, drives,
/// network and power, and the apps using them). A tab for everyone up to
/// 0.2.8; an add-on, off, in the versions after it, so the island's own tabs
/// are the everyday ones. Its code is in the app, so there is nothing to download.
/// Off, there is no System tab, and its readings never start at rest
/// (`Settings::system_history` only counts while it is on). Show over games
/// keeps its own switch: its readout reads the counters while a game is in
/// front, System on or off.
pub const SYSTEM: Addon = Addon {
    id: "system",
    title: "System",
    blurb: "Live CPU, GPU, memory, drives, network and power, and the apps using them.",
    mac_blurb: None,
    tag: "",
    files: &[],
    pro: false,
};

/// Downloader: the Downloads page, which saves the video or sound of a link
/// with yt-dlp (`ytdlp`, `downloads`). yt-dlp and QuickJS (which yt-dlp needs
/// for YouTube) come from their own releases, unchanged; FFmpeg, which joins
/// a video's picture and sound, is our own small build
/// (`tools/build-ffmpeg-min.sh`, `addons/downloader/`). Not in the Microsoft
/// Store build. Nothing runs at rest: the tools only run while a download
/// does. Part of Studio Pro: its tools download, and it downloads, only for
/// an account the server says has Pro. Each app has its own tools: this

/// Every add-on, in the order the Add-ons page lists them. Both are in the app:
/// nothing downloads (the download machinery stays for a future add-on).
pub const ALL: [&Addon; 2] = [&SCRIPT_READER, &SYSTEM];

/// Where an add-on stands, as the Add-ons page shows it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Switched off: none of its files on this PC, nothing running.
    Off,
    /// Switched on; looking at the files already on this PC.
    Checking,
    /// Bytes so far of the add-on's total.
    Downloading { done: u64, total: u64 },
    /// Switched on with no internet: the download starts by itself later.
    Waiting,
    /// Switched on, every file in place.
    Ready,
    /// A file came back different from the one the app expects, so it was
    /// thrown away. Trying again is the person's call (off, then on).
    Failed,
    /// Asked to switch on, but this build can't get its files yet
    /// ([`Addon::pinned`]): it stays off, and nothing downloads.
    Unpinned,
}

impl Status {
    /// The switch shows on for everything but `Off`, and `Unpinned`, which
    /// stays off.
    pub fn is_on(self) -> bool {
        !matches!(self, Status::Off | Status::Unpinned)
    }

    /// The line under the add-on's name; `mac`: in the Mac app.
    pub fn line(self, addon: &Addon, mac: bool) -> String {
        let here = if mac { "this Mac" } else { "this PC" };
        match self {
            Status::Off => addon.mac_blurb.filter(|_| mac).unwrap_or(addon.blurb).to_string(),
            Status::Checking => format!("Checking its files on {here}"),
            Status::Downloading { done, total } => format!("Downloading · {} of {}", fmt_bytes(done), fmt_bytes(total)),
            Status::Waiting => "No internet. It downloads by itself once you're back online.".to_string(),
            Status::Ready if !addon.downloads() => "On".to_string(),
            Status::Ready => format!("On · {} on {here}", fmt_bytes(addon.size())),
            Status::Failed => "The download didn't come through right. Switch it off and on to try again.".to_string(),
            Status::Unpinned => "This version can't get its files yet, so it stays off.".to_string(),
        }
    }

    /// Download progress 0..1, while downloading.
    pub fn progress(self) -> Option<f32> {
        match self {
            Status::Downloading { done, total } if total > 0 => Some((done as f64 / total as f64).clamp(0.0, 1.0) as f32),
            Status::Downloading { .. } => Some(0.0),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    #[test]
    fn script_reader_is_built_in() {
        assert!(!SCRIPT_READER.downloads() && SCRIPT_READER.size() == 0);
        assert_eq!(Status::Ready.line(&SCRIPT_READER, false), "On");
        assert_eq!(Status::Off.line(&SCRIPT_READER, true), "A teleprompter under your webcam.");
        assert_eq!(Addon::find("script"), Some(&SCRIPT_READER));
    }

    #[test]
    fn built_in_add_ons_are_off_until_switched_on() {
        for a in [&SYSTEM] {
            assert!(!a.downloads() && a.size() == 0, "{}", a.id);
            assert_eq!(Addon::find(a.id), Some(a));
            assert_eq!(Status::Ready.line(a, false), "On");
            assert!(!Settings::default().addon_on(a.id), "{} is off for everyone until they switch it on", a.id);
        }
        // Not meeting features, gone with ISL-005: no add-on by these ids.
        for gone in ["clipboard", "notifications", "sholat", "ja", "downloader"] {
            assert_eq!(Addon::find(gone), None, "{gone}");
        }
    }

    #[test]
    fn add_ons_are_listed_in_order_each_with_its_own_id() {
        let ids: Vec<&str> = ALL.iter().map(|a| a.id).collect();
        assert_eq!(ids, ["script", "system"]);
        for (i, a) in ALL.iter().enumerate() {
            assert!(!a.id.is_empty() && a.id.bytes().all(|b| b.is_ascii_lowercase()), "{}", a.id);
            assert!(ALL[..i].iter().all(|b| b.id != a.id && b.title != a.title), "{} twice", a.id);
            assert_eq!(a.downloads(), !a.tag.is_empty(), "{}: a release exactly when there are files", a.id);
            assert!(a.pinned(), "{} ({})", a.id, a.tag);
        }
    }

    fn pinned_file(bytes: &[u8]) -> AddonFile {
        let hex: &'static str = Box::leak(sha256::hex(&sha256::sha256(bytes)).into_boxed_str());
        AddonFile { name: "tool.bin", size: bytes.len() as u64, sha256: hex, url: None }
    }

    #[test]
    fn an_add_on_with_a_placeholder_file_stays_off() {
        let tool = pinned_file(b"tool");
        let soon = Addon {
            id: "soon",
            title: "Soon",
            blurb: "Not out yet.",
            mac_blurb: None,
            tag: "addon-soon-1",
            files: Box::leak(Box::new([tool, AddonFile { name: "NOTICE.txt", size: 0, sha256: "", url: None }])),
            pro: false,
        };
        assert!(tool.pinned() && !soon.files[1].pinned() && !soon.pinned());
        // Half a pin is none.
        let upper: &'static str = Box::leak(tool.sha256.to_uppercase().into_boxed_str());
        for f in [AddonFile { sha256: "", ..tool }, AddonFile { size: 0, ..tool }, AddonFile { sha256: &tool.sha256[1..], ..tool }, AddonFile { sha256: upper, ..tool }] {
            assert!(!f.pinned(), "{f:?}");
        }
        // The switch stays off and the line says why; nothing comes in.
        let s = Status::Unpinned;
        assert!(!s.is_on() && s.progress().is_none());
        assert_eq!(s.line(&soon, false), "This version can't get its files yet, so it stays off.");
        assert_eq!(s.line(&soon, true), s.line(&soon, false));
    }

    #[test]
    fn a_file_on_disk_is_checked_a_piece_at_a_time() {
        let data: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let f = pinned_file(&data);
        assert!(f.matches(&data) && f.matches_read(&data[..]));
        let mut changed = data.clone();
        *changed.last_mut().unwrap() ^= 1;
        assert!(!f.matches_read(&changed[..]));
        assert!(!f.matches_read(&data[..data.len() - 1]), "a byte short");
        assert!(!f.matches_read(std::io::Read::chain(&data[..], &b"!"[..])), "a byte more");
        // A file that can't be read to its end isn't the file.
        struct Unplugged;
        impl std::io::Read for Unplugged {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("unplugged"))
            }
        }
        assert!(!f.matches_read(Unplugged));
    }

    #[test]
    fn lines_say_what_is_happening() {
        let a = &SCRIPT_READER;
        assert_eq!(Status::Off.line(a, false), a.blurb);
        assert!(!Status::Off.is_on() && Status::Waiting.is_on() && Status::Failed.is_on());
        assert_eq!(Status::Downloading { done: 1, total: 4 }.progress(), Some(0.25));
        assert_eq!(Status::Downloading { done: 0, total: 0 }.progress(), Some(0.0));
        assert_eq!(Status::Ready.progress(), None);
    }
}

//! Where each model is stored. A location is an HF-cache root: the model lives in
//! `<dir>/models--org--name/{blobs,snapshots,refs}`, wherever that dir is (another
//! drive, an external SSD). The mapping is saved in the state dir; a model with no
//! entry lives in the default hub cache.
//!
//! Moving a model never touches the old copy until the new one is verified and the
//! mapping has been switched, and a journal in the same file lets the next start
//! clean up after a crash or an unplugged drive.

use std::collections::BTreeMap;
use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, RwLock};

use anyhow::{bail, Context, Result};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::models::{cache_state, counted, model_root, Kind};

/// Free space kept back on top of a model's size, for temp files and the filesystem.
pub const SPACE_MARGIN: u64 = 256_000_000;

const CHUNK: usize = 1 << 20;

/// The model's folder is custom and cannot be used now (drive unplugged, folder gone).
#[derive(Debug)]
pub struct ModelDirUnavailable {
    pub id: String,
    pub dir: PathBuf,
    pub reason: String,
}

impl fmt::Display for ModelDirUnavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "the folder holding {} ({}) is not available: {}",
            self.id,
            self.dir.display(),
            self.reason
        )
    }
}

impl std::error::Error for ModelDirUnavailable {}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Journal {
    from: PathBuf,
    to: PathBuf,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Saved {
    dirs: BTreeMap<String, PathBuf>,
    moves: BTreeMap<String, Journal>,
}

pub struct Locations {
    path: PathBuf,
    default: RwLock<PathBuf>,
    saved: Mutex<Saved>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

impl Locations {
    /// Read the mapping from `path`; a missing or unreadable file means no custom folders.
    pub fn load(path: PathBuf, default: PathBuf) -> Self {
        let saved = fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .map(|value| parse(&value))
            .unwrap_or_default();
        Self {
            path,
            default: RwLock::new(default),
            saved: Mutex::new(saved),
        }
    }

    pub fn default_dir(&self) -> PathBuf {
        self.default
            .read()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    /// Point the default cache elsewhere (tests).
    pub fn set_default(&self, dir: PathBuf) {
        *self
            .default
            .write()
            .unwrap_or_else(|poison| poison.into_inner()) = dir;
    }

    /// The model's own folder, when the user chose one.
    pub fn custom(&self, id: &str) -> Option<PathBuf> {
        lock(&self.saved).dirs.get(id).cloned()
    }

    /// Every model kept in a folder of its own, with that folder.
    pub fn all_custom(&self) -> Vec<(String, PathBuf)> {
        lock(&self.saved)
            .dirs
            .iter()
            .map(|(id, dir)| (id.clone(), dir.clone()))
            .collect()
    }

    pub fn dir_for(&self, id: &str) -> PathBuf {
        self.custom(id).unwrap_or_else(|| self.default_dir())
    }

    /// The folder to read or download `id` in, or why it cannot be used right now.
    /// The default cache is always usable (hf-hub creates it); a custom folder must exist,
    /// so a missing drive is an error here and never a silent download elsewhere.
    pub fn usable_dir(&self, id: &str) -> Result<PathBuf, ModelDirUnavailable> {
        let dir = self.dir_for(id);
        match self.custom(id) {
            Some(_) => {
                dir_status(&dir)
                    .map(|()| dir.clone())
                    .map_err(|reason| ModelDirUnavailable {
                        id: id.to_string(),
                        dir,
                        reason,
                    })
            }
            None => Ok(dir),
        }
    }

    /// Persist the mapping change atomically; memory changes only when the write worked.
    fn update(&self, change: impl FnOnce(&mut Saved)) -> io::Result<()> {
        let mut saved = lock(&self.saved);
        let mut next = saved.clone();
        change(&mut next);
        if next == *saved {
            return Ok(());
        }
        let text = json!({
            "dirs": next.dirs.iter().map(|(id, dir)| (id.clone(), json!(dir.to_string_lossy()))).collect::<Map<_, _>>(),
            "moves": next.moves.iter().map(|(id, j)| (id.clone(), json!({
                "from": j.from.to_string_lossy(), "to": j.to.to_string_lossy(),
            }))).collect::<Map<_, _>>(),
        })
        .to_string();
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temp = self.path.with_extension("json.tmp");
        fs::write(&temp, text)?;
        fs::rename(&temp, &self.path)?;
        *saved = next;
        Ok(())
    }

    /// Choose the folder for `id` (`None` or the default dir = the default cache).
    pub fn set(&self, id: &str, dir: Option<&Path>) -> io::Result<()> {
        let default = self.default_dir();
        self.update(|saved| match dir.filter(|dir| *dir != default.as_path()) {
            Some(dir) => {
                saved.dirs.insert(id.to_string(), dir.to_path_buf());
            }
            None => {
                saved.dirs.remove(id);
            }
        })
    }

    /// Finish what a crash or an unplugged drive left behind: a partial copy when the move
    /// never switched, the old copy when it did. Entries whose folder is away stay for the
    /// next start. Returns a line per thing that could not be cleaned.
    pub fn recover(&self) -> Vec<String> {
        let moves = lock(&self.saved).moves.clone();
        let mut notes = Vec::new();
        for (id, journal) in moves {
            let switched = self.dir_for(&id) == journal.to;
            let leftover = if switched { &journal.from } else { &journal.to };
            let root = model_root(leftover, &id);
            if !root.exists() {
                if leftover.is_dir() {
                    let _ = self.update(|saved| {
                        saved.moves.remove(&id);
                    });
                } else {
                    notes.push(format!(
                        "{id}: {} is away; cleanup waits",
                        leftover.display()
                    ));
                }
                continue;
            }
            match fs::remove_dir_all(&root) {
                Ok(()) => {
                    let _ = fs::remove_dir_all(lock_dir(leftover, &id));
                    let _ = self.update(|saved| {
                        saved.moves.remove(&id);
                    });
                }
                Err(error) => {
                    notes.push(format!("{id}: cannot remove {}: {error}", root.display()))
                }
            }
        }
        notes
    }
}

fn parse(value: &Value) -> Saved {
    let text = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).map(PathBuf::from);
    let mut saved = Saved::default();
    for (id, dir) in value["dirs"].as_object().into_iter().flatten() {
        if let Some(dir) = dir.as_str().filter(|dir| Path::new(dir).is_absolute()) {
            saved.dirs.insert(id.clone(), PathBuf::from(dir));
        }
    }
    for (id, journal) in value["moves"].as_object().into_iter().flatten() {
        if let (Some(from), Some(to)) = (text(journal, "from"), text(journal, "to")) {
            saved.moves.insert(id.clone(), Journal { from, to });
        }
    }
    saved
}

fn lock_dir(cache: &Path, id: &str) -> PathBuf {
    cache
        .join(".locks")
        .join(format!("models--{}", id.replace('/', "--")))
}

/// Ok when `dir` is a folder that exists now.
pub fn dir_status(dir: &Path) -> Result<(), String> {
    match fs::metadata(dir) {
        Ok(meta) if meta.is_dir() => Ok(()),
        Ok(_) => Err("not a folder".to_string()),
        Err(_) => Err("folder not found (is the drive connected?)".to_string()),
    }
}

fn system_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = [
        "SystemRoot",
        "windir",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
    ]
    .iter()
    .filter_map(std::env::var_os)
    .map(PathBuf::from)
    .collect();
    if cfg!(unix) {
        roots.extend(
            [
                "/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/sbin", "/sys", "/usr",
                "/System", "/Library",
            ]
            .iter()
            .map(PathBuf::from),
        );
    }
    roots
}

fn under(path: &Path, root: &Path) -> bool {
    let lower = |p: &Path| PathBuf::from(p.to_string_lossy().to_lowercase());
    lower(path).starts_with(lower(root))
}

/// A folder the user may pick: absolute, no `..`, tidied (no `.`, doubled or trailing
/// separators), and not inside a system folder.
pub fn validate_dir(raw: &str) -> Result<PathBuf, String> {
    validate_dir_with(raw, &system_roots())
}

fn validate_dir_with(raw: &str, system: &[PathBuf]) -> Result<PathBuf, String> {
    let path = Path::new(raw.trim());
    if raw.trim().is_empty() {
        return Err("folder is empty".into());
    }
    if !path.is_absolute() {
        return Err("folder must be an absolute path (for example D:\\Models)".into());
    }
    if path.components().any(|part| part == Component::ParentDir) {
        return Err("folder must not contain \"..\"".into());
    }
    let clean: PathBuf = path.components().collect();
    if let Some(root) = system.iter().find(|root| under(&clean, root)) {
        return Err(format!(
            "{} is a system folder; pick another one",
            root.display()
        ));
    }
    Ok(clean)
}

/// What a folder can do, found by trying it.
pub struct Probe {
    /// Snapshot files can share a blob's disk space. False on exFAT/FAT, where a model
    /// takes twice the space (hf-hub copies the blob on Windows anyway).
    pub hard_links: bool,
}

/// Create `dir` if needed, then write and delete a probe file (and a link to it).
pub fn probe_dir(dir: &Path) -> Result<Probe, String> {
    fs::create_dir_all(dir).map_err(|e| format!("cannot create the folder: {e}"))?;
    let file = dir.join(format!(".engine-probe-{}", std::process::id()));
    let link = dir.join(format!(".engine-probe-{}-link", std::process::id()));
    let _ = fs::remove_file(&link);
    fs::write(&file, b"probe").map_err(|e| format!("the folder is not writable: {e}"))?;
    let hard_links = fs::hard_link(&file, &link).is_ok();
    let _ = fs::remove_file(&link);
    fs::remove_file(&file).map_err(|e| format!("cannot delete in the folder: {e}"))?;
    Ok(Probe { hard_links })
}

/// Free bytes on the volume holding `dir` (its nearest existing parent); None if unknown.
pub fn free_bytes(dir: &Path) -> Option<u64> {
    // Tests on a shared, nearly full disk pin the answer; the real engine never sets it.
    if let Some(fake) = std::env::var("ENGINE_FREE_BYTES")
        .ok()
        .and_then(|text| text.parse().ok())
    {
        return Some(fake);
    }
    dir.ancestors()
        .find(|path| path.is_dir())
        .and_then(|path| fs2::available_space(path).ok())
}

/// Bytes the move of a model of `bytes` needs in the target folder.
pub fn move_needs(bytes: u64, hard_links: bool) -> u64 {
    bytes * if hard_links { 1 } else { 2 } + SPACE_MARGIN
}

/// Bytes a model still to download needs: what is left of `total` plus the margin.
pub fn pull_needs(total: u64, have: u64) -> u64 {
    total.saturating_sub(have) + SPACE_MARGIN
}

// ---------------------------------------------------------------- moving a model

/// Recursive files under `dir` as (path relative to `dir`, size), following links.
fn files_under(dir: &Path, keep: &dyn Fn(&str) -> bool) -> Vec<(PathBuf, u64)> {
    fn walk(root: &Path, dir: &Path, keep: &dyn Fn(&str) -> bool, out: &mut Vec<(PathBuf, u64)>) {
        for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let Ok(meta) = fs::metadata(&path) else {
                continue;
            };
            if meta.is_dir() {
                walk(root, &path, keep, out);
            } else if meta.is_file() && keep(&entry.file_name().to_string_lossy()) {
                out.push((
                    path.strip_prefix(root).unwrap_or(&path).to_path_buf(),
                    meta.len(),
                ));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, keep, &mut out);
    out.sort();
    out
}

fn sha256_hex(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            return Ok(format!("{:x}", hasher.finalize()));
        }
        hasher.update(&buf[..n]);
    }
}

fn same_bytes(a: &Path, b: &Path) -> io::Result<bool> {
    let (mut a, mut b) = (File::open(a)?, File::open(b)?);
    let (mut x, mut y) = (vec![0u8; CHUNK], vec![0u8; CHUNK]);
    loop {
        let n = a.read(&mut x)?;
        if n == 0 {
            return Ok(b.read(&mut y)? == 0);
        }
        b.read_exact(&mut y[..n])?;
        if x[..n] != y[..n] {
            return Ok(false);
        }
    }
}

type Step<'a> = &'a mut dyn FnMut(&Path) -> io::Result<()>;

/// Copy to `to` through a `.moving` temp file, counting bytes into `done`.
fn copy_file(from: &Path, to: &Path, done: &AtomicU64, step: Step) -> Result<()> {
    step(to).with_context(|| format!("write {}", to.display()))?;
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    let temp = to.with_file_name(format!(
        "{}.moving",
        to.file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    ));
    let mut input = File::open(from).with_context(|| format!("read {}", from.display()))?;
    let mut output = File::create(&temp).with_context(|| format!("write {}", temp.display()))?;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = input
            .read(&mut buf)
            .with_context(|| format!("read {}", from.display()))?;
        if n == 0 {
            break;
        }
        output
            .write_all(&buf[..n])
            .with_context(|| format!("write {}", temp.display()))?;
        done.fetch_add(n as u64, Ordering::Relaxed);
    }
    output
        .sync_all()
        .with_context(|| format!("write {}", temp.display()))?;
    drop(output);
    fs::rename(&temp, to).with_context(|| format!("write {}", to.display()))
}

fn is_sha256(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Copy the whole model tree. Blobs are copied and checked (size, and sha256 when the
/// blob is named by it); snapshot entries become links to the new blobs, or a copy where
/// links are not possible. Links and symlinks in the source are followed, so the result
/// never holds a link that points outside the target.
fn copy_tree(src: &Path, dst: &Path, done: &AtomicU64, step: Step) -> Result<()> {
    let blobs = files_under(&src.join("blobs"), &|name| {
        counted(name) && !name.ends_with(".incomplete")
    });
    for (rel, len) in &blobs {
        let to = dst.join("blobs").join(rel);
        copy_file(&src.join("blobs").join(rel), &to, done, step)?;
        let name = rel.to_string_lossy();
        let got = fs::metadata(&to).map(|meta| meta.len()).unwrap_or(0);
        if got != *len {
            bail!("{name} is {got} bytes after the copy, expected {len}");
        }
        if is_sha256(&name) && sha256_hex(&to)? != name {
            bail!("{name} does not match its checksum after the copy");
        }
    }
    for (rel, len) in files_under(&src.join("snapshots"), &|_| true) {
        let from = src.join("snapshots").join(&rel);
        let to = dst.join("snapshots").join(&rel);
        let mut twin = None;
        for (blob, size) in &blobs {
            let blob = dst.join("blobs").join(blob);
            if *size == len && same_bytes(&from, &blob)? {
                twin = Some(blob);
                break;
            }
        }
        match twin {
            Some(blob) => {
                step(&to).with_context(|| format!("write {}", to.display()))?;
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent)
                        .with_context(|| format!("create {}", parent.display()))?;
                }
                if fs::hard_link(&blob, &to).is_err() {
                    fs::copy(&blob, &to).with_context(|| format!("write {}", to.display()))?;
                }
            }
            None => copy_file(&from, &to, done, step)?,
        }
    }
    for (rel, _) in files_under(&src.join("refs"), &|_| true) {
        copy_file(
            &src.join("refs").join(&rel),
            &dst.join("refs").join(&rel),
            &AtomicU64::new(0),
            step,
        )?;
    }
    Ok(())
}

pub struct MoveJob<'a> {
    pub id: &'a str,
    pub kind: Kind,
    pub from: &'a Path,
    pub to: &'a Path,
}

/// Move one model between cache roots. `Err`: nothing changed (the old copy is whole and
/// the mapping is as before). `Ok(Some(why))`: moved and switched, but the old copy could
/// not be deleted (retried at next start). `phase` hears copying, verifying, switching,
/// cleaning; `step` hears every file about to be written (tests inject faults there).
pub fn move_model(
    locations: &Locations,
    job: &MoveJob,
    done: &AtomicU64,
    phase: &mut dyn FnMut(&'static str),
    step: Step,
) -> Result<Option<String>> {
    let (src, dst) = (model_root(job.from, job.id), model_root(job.to, job.id));
    if dst.exists() {
        bail!(
            "the target folder already holds a copy of {}; remove it or pick another folder",
            job.id
        );
    }
    let before = cache_state(job.from, job.id, job.kind);
    if !before.downloaded {
        bail!(
            "{} is not fully downloaded in {}",
            job.id,
            job.from.display()
        );
    }
    locations
        .update(|saved| {
            saved.moves.insert(
                job.id.to_string(),
                Journal {
                    from: job.from.to_path_buf(),
                    to: job.to.to_path_buf(),
                },
            );
        })
        .context("could not record the move in the state folder")?;
    phase("copying");
    let copied = copy_tree(&src, &dst, done, step).and_then(|()| {
        phase("verifying");
        let after = cache_state(job.to, job.id, job.kind);
        if !after.downloaded || after.bytes != before.bytes {
            bail!(
                "the copy is incomplete ({} of {} bytes)",
                after.bytes,
                before.bytes
            );
        }
        phase("switching");
        locations
            .set(job.id, Some(job.to))
            .context("could not save the new folder")
    });
    if let Err(error) = copied {
        // The old copy was never touched. Drop the partial one; if that fails the journal
        // stays and the next start retries.
        if fs::remove_dir_all(&dst).is_ok() || !dst.exists() {
            let _ = locations.update(|saved| {
                saved.moves.remove(job.id);
            });
        }
        return Err(error);
    }
    phase("cleaning");
    match fs::remove_dir_all(&src) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Ok(Some(format!(
                "moved, but the old copy in {} could not be deleted: {error}",
                job.from.display()
            )))
        }
    }
    let _ = fs::remove_dir_all(lock_dir(job.from, job.id));
    let _ = locations.update(|saved| {
        saved.moves.remove(job.id);
    });
    Ok(None)
}

/// Hub folders older installs used. With HOME unset hf-hub fell back to `/tmp`, which on
/// Windows is `<current drive>:\tmp`: an installed app downloaded into `C:\tmp`.
// shortcut: Windows only, and only C: plus the drives of the working and exe folders;
// upgrade to a user-given list if models turn up elsewhere.
pub fn legacy_hubs() -> Vec<PathBuf> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let drive_of = |path: &Path| match path.components().next() {
        Some(Component::Prefix(prefix)) => Some(prefix.as_os_str().to_string_lossy().into_owned()),
        _ => None,
    };
    let mut drives = vec!["C:".to_string()];
    let here = std::env::current_dir().ok();
    let exe = std::env::current_exe().ok();
    for path in [here, exe].into_iter().flatten() {
        if let Some(drive) = drive_of(&path) {
            if !drives.iter().any(|d| d.eq_ignore_ascii_case(&drive)) {
                drives.push(drive);
            }
        }
    }
    drives
        .into_iter()
        .map(|drive| PathBuf::from(format!("{drive}\\tmp\\.cache\\huggingface\\hub")))
        .collect()
}

fn same_place(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Copy the complete catalog models found in the `legacy` hub folders into `into`, when
/// `into` does not have them yet and `wanted(id)` says the default folder is where they
/// belong. The old copy is never touched. Each model is copied beside its target and
/// renamed into place only once it checks out, so a crash leaves nothing half-there.
/// Returns a line per model copied or skipped for a reason.
pub fn migrate_legacy(
    legacy: &[PathBuf],
    into: &Path,
    wanted: &dyn Fn(&str) -> bool,
) -> Vec<String> {
    let staging = into.join(".migrating");
    let _ = fs::remove_dir_all(&staging); // leftover of a crash
    let mut notes = Vec::new();
    for hub in legacy {
        if same_place(hub, into) {
            continue;
        }
        let Ok(entries) = fs::read_dir(hub) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = name
                .strip_prefix("models--")
                .map(|s| s.replacen("--", "/", 1))
            else {
                continue;
            };
            let Some(spec) = crate::models::catalog_spec(&id) else {
                continue;
            };
            let before = cache_state(hub, &id, spec.kind);
            let target = model_root(into, &id);
            if !before.downloaded || target.exists() || !wanted(&id) {
                continue;
            }
            let need = before.bytes + SPACE_MARGIN;
            if free_bytes(into).is_some_and(|free| free < need) {
                notes.push(format!(
                    "{id}: not enough free space in {} to bring it over",
                    into.display()
                ));
                continue;
            }
            let copy = (|| -> Result<()> {
                copy_tree(
                    &entry.path(),
                    &staging.join(&name),
                    &AtomicU64::new(0),
                    &mut |_| Ok(()),
                )?;
                let after = cache_state(&staging, &id, spec.kind);
                if !after.downloaded || after.bytes != before.bytes {
                    bail!(
                        "the copy is incomplete ({} of {} bytes)",
                        after.bytes,
                        before.bytes
                    );
                }
                fs::rename(staging.join(&name), &target).context("move into place")
            })();
            let _ = fs::remove_dir_all(&staging);
            notes.push(match copy {
                Ok(()) => format!(
                    "{id}: copied from {} (the old copy was left in place)",
                    hub.display()
                ),
                Err(error) => format!("{id}: could not copy from {}: {error:#}", hub.display()),
            });
        }
    }
    notes
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A scratch folder that is removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!("locations-{}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("scratch");
            Self(dir)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const ID: &str = "openai/whisper-base";

    /// A downloaded Whisper laid out as hf-hub does on Windows: blobs named by their hash
    /// and a full copy of each in the snapshot. The weights are 3 chunks long.
    fn fake_model(cache: &Path) -> Vec<(&'static str, Vec<u8>)> {
        let files: Vec<(&str, Vec<u8>)> = vec![
            ("config.json", b"{\"a\":1}".to_vec()),
            ("tokenizer.json", b"{\"b\":22}".to_vec()),
            (
                "model.safetensors",
                (0..CHUNK * 2 + 5).map(|i| (i % 251) as u8).collect(),
            ),
        ];
        let root = model_root(cache, ID);
        fs::create_dir_all(root.join("blobs")).expect("blobs");
        fs::create_dir_all(root.join("snapshots/rev1")).expect("snap");
        fs::create_dir_all(root.join("refs")).expect("refs");
        fs::write(root.join("refs/main"), "rev1").expect("ref");
        for (name, bytes) in &files {
            let temp = root.join("blobs/tmp");
            fs::write(&temp, bytes).expect("blob");
            let hash = sha256_hex(&temp).expect("hash");
            fs::rename(&temp, root.join("blobs").join(hash)).expect("name");
            fs::write(root.join("snapshots/rev1").join(name), bytes).expect("snapshot");
        }
        files
    }

    fn setup() -> (Scratch, PathBuf, PathBuf, Locations) {
        let scratch = Scratch::new();
        let (from, to) = (scratch.path("hub"), scratch.path("ssd"));
        fs::create_dir_all(&to).expect("target");
        let locations = Locations::load(scratch.path("state/engine-locations.json"), from.clone());
        (scratch, from, to, locations)
    }

    fn job<'a>(from: &'a Path, to: &'a Path) -> MoveJob<'a> {
        MoveJob {
            id: ID,
            kind: Kind::Asr,
            from,
            to,
        }
    }

    fn run(locations: &Locations, from: &Path, to: &Path, step: Step) -> Result<Option<String>> {
        move_model(
            locations,
            &job(from, to),
            &AtomicU64::new(0),
            &mut |_| {},
            step,
        )
    }

    fn assert_whole(cache: &Path, files: &[(&str, Vec<u8>)]) {
        assert!(
            cache_state(cache, ID, Kind::Asr).downloaded,
            "{cache:?} lost the model"
        );
        for (name, bytes) in files {
            let got =
                fs::read(model_root(cache, ID).join("snapshots/rev1").join(name)).expect("read");
            assert_eq!(&got, bytes, "{name}");
        }
    }

    // ---- validation

    #[test]
    fn folders_must_be_absolute_tidy_and_not_system_folders() {
        let system = [
            PathBuf::from("C:\\Windows"),
            PathBuf::from("C:\\Program Files"),
        ];
        let ok = |raw: &str| validate_dir_with(raw, &system);
        assert!(ok("").is_err());
        assert!(ok("   ").is_err());
        assert!(ok("models").is_err());
        assert!(ok("..\\models").is_err());
        if cfg!(windows) {
            assert!(ok("\\models").is_err(), "no drive");
            assert!(ok("D:models").is_err(), "drive-relative");
            assert!(ok("D:\\a\\..\\b").is_err());
            assert!(ok("c:\\WINDOWS\\Temp")
                .unwrap_err()
                .contains("system folder"));
            assert!(ok("C:\\Program Files\\Models").is_err());
            assert_eq!(
                ok("D:\\Models\\\\.\\sub\\").unwrap(),
                PathBuf::from("D:\\Models\\sub")
            );
            assert_eq!(
                ok("  E:/AI models  ").unwrap(),
                PathBuf::from("E:\\AI models")
            );
            assert!(
                ok("C:\\Program Files Extra").is_ok(),
                "a sibling is not inside"
            );
            assert_eq!(ok("F:\\").unwrap(), PathBuf::from("F:\\"));
        } else {
            assert_eq!(
                ok("/mnt/ssd//models/").unwrap(),
                PathBuf::from("/mnt/ssd/models")
            );
        }
    }

    #[test]
    fn the_real_system_roots_include_the_windows_folder() {
        if cfg!(windows) {
            let windows = std::env::var("SystemRoot").expect("SystemRoot");
            assert!(validate_dir(&format!("{windows}\\System32")).is_err());
        }
    }

    #[test]
    fn a_probe_writes_cleans_up_and_reports_links() {
        let scratch = Scratch::new();
        let dir = scratch.path("new/deep");
        let probe = probe_dir(&dir).expect("probe");
        assert!(dir.is_dir());
        assert_eq!(
            fs::read_dir(&dir).expect("list").count(),
            0,
            "probe left files"
        );
        assert!(probe.hard_links, "the temp volume is NTFS or ext4");
        let file = scratch.path("a-file");
        fs::write(&file, "x").expect("file");
        assert!(
            probe_dir(&file.join("sub")).is_err(),
            "cannot create under a file"
        );
    }

    #[test]
    fn free_space_is_known_for_a_folder_that_does_not_exist_yet() {
        let scratch = Scratch::new();
        assert!(free_bytes(&scratch.path("not/yet")).unwrap() > 0);
        assert_eq!(move_needs(100, true), 100 + SPACE_MARGIN);
        assert_eq!(move_needs(100, false), 200 + SPACE_MARGIN);
        assert_eq!(pull_needs(1000, 400), 600 + SPACE_MARGIN);
        assert_eq!(pull_needs(1000, 5000), SPACE_MARGIN);
    }

    // ---- mapping

    #[test]
    fn the_mapping_survives_a_restart_and_the_default_needs_no_entry() {
        let (scratch, from, to, locations) = setup();
        assert_eq!(locations.dir_for(ID), from);
        locations.set(ID, Some(&to)).expect("set");
        assert_eq!(locations.dir_for(ID), to);
        let again = Locations::load(scratch.path("state/engine-locations.json"), from.clone());
        assert_eq!(again.custom(ID), Some(to.clone()));
        again.set(ID, Some(&from)).expect("back to default");
        assert_eq!(again.custom(ID), None);
        let text = fs::read_to_string(scratch.path("state/engine-locations.json")).expect("file");
        assert!(!text.contains(ID), "default is stored as no entry: {text}");
    }

    #[test]
    fn a_broken_or_hostile_mapping_file_is_ignored_entry_by_entry() {
        let scratch = Scratch::new();
        let path = scratch.path("locations.json");
        fs::write(&path, "{ not json").expect("write");
        assert_eq!(
            Locations::load(path.clone(), scratch.path("hub")).custom(ID),
            None
        );
        let good = if cfg!(windows) { "D:\\\\ssd" } else { "/ssd" };
        fs::write(
            &path,
            format!(r#"{{"dirs":{{"a/b":"{good}","c/d":"relative","e/f":7}}}}"#),
        )
        .expect("write");
        let loaded = Locations::load(path, scratch.path("hub"));
        assert!(loaded.custom("a/b").is_some());
        assert_eq!(loaded.custom("c/d"), None);
        assert_eq!(loaded.custom("e/f"), None);
    }

    #[test]
    fn a_missing_custom_folder_is_an_error_and_never_the_default() {
        let (scratch, _, _, locations) = setup();
        let gone = scratch.path("unplugged");
        locations.set(ID, Some(&gone)).expect("set");
        let error = locations.usable_dir(ID).unwrap_err();
        assert!(error.to_string().contains("not available"), "{error}");
        assert!(
            error.to_string().contains("is the drive connected"),
            "{error}"
        );
        fs::create_dir_all(&gone).expect("drive returns");
        assert_eq!(locations.usable_dir(ID).expect("works again"), gone);
        assert!(
            locations.usable_dir("other/model").is_ok(),
            "default stays usable"
        );
    }

    #[test]
    fn the_mapping_is_left_alone_when_it_cannot_be_saved() {
        let scratch = Scratch::new();
        let blocker = scratch.path("blocker");
        fs::write(&blocker, "a file where the state folder should be").expect("file");
        let locations = Locations::load(blocker.join("locations.json"), scratch.path("hub"));
        assert!(locations.set(ID, Some(&scratch.path("ssd"))).is_err());
        assert_eq!(locations.custom(ID), None);
    }

    // ---- moving

    #[test]
    fn a_move_copies_verifies_switches_and_deletes_the_old_copy() {
        let (scratch, from, to, locations) = setup();
        let files = fake_model(&from);
        fs::create_dir_all(lock_dir(&from, ID)).expect("locks");
        let done = AtomicU64::new(0);
        let mut phases = Vec::new();
        let out = move_model(
            &locations,
            &job(&from, &to),
            &done,
            &mut |p| phases.push(p),
            &mut |_| Ok(()),
        );
        assert_eq!(out.expect("moved"), None);
        assert_eq!(phases, ["copying", "verifying", "switching", "cleaning"]);
        assert_whole(&to, &files);
        assert!(!model_root(&from, ID).exists(), "old copy deleted");
        assert!(!lock_dir(&from, ID).exists());
        assert_eq!(locations.dir_for(ID), to);
        assert_eq!(
            fs::read_to_string(model_root(&to, ID).join("refs/main")).unwrap(),
            "rev1"
        );
        assert!(done.load(Ordering::Relaxed) >= (CHUNK * 2) as u64);
        let again = Locations::load(scratch.path("state/engine-locations.json"), from);
        assert_eq!(
            again.custom(ID),
            Some(to),
            "saved, and the journal is empty"
        );
        assert!(again.recover().is_empty());
        let text = fs::read_to_string(scratch.path("state/engine-locations.json")).unwrap();
        assert!(text.contains("\"moves\":{}"), "{text}");
    }

    #[test]
    fn a_full_disk_part_way_leaves_the_old_copy_and_the_mapping_alone() {
        let (_scratch, from, to, locations) = setup();
        let files = fake_model(&from);
        let mut writes = 0;
        let out = run(&locations, &from, &to, &mut |_| {
            writes += 1;
            if writes == 3 {
                Err(io::Error::other("There is not enough space on the disk."))
            } else {
                Ok(())
            }
        });
        let error = format!("{:#}", out.unwrap_err());
        assert!(error.contains("not enough space"), "{error}");
        assert_whole(&from, &files);
        assert!(!model_root(&to, ID).exists(), "partial copy removed");
        assert_eq!(locations.dir_for(ID), from);
        assert!(locations.recover().is_empty());
    }

    #[test]
    fn a_target_that_vanishes_part_way_changes_nothing() {
        let (_scratch, from, to, locations) = setup();
        let files = fake_model(&from);
        let mut writes = 0;
        let out = run(&locations, &from, &to, &mut |_| {
            writes += 1;
            if writes == 2 {
                // The drive is gone: the folder is replaced by something that is not one.
                let _ = fs::remove_dir_all(&to);
                fs::write(&to, "x")?;
            }
            Ok(())
        });
        assert!(out.is_err());
        assert_whole(&from, &files);
        assert_eq!(locations.dir_for(ID), from);
    }

    #[test]
    fn a_source_that_vanishes_part_way_changes_nothing_and_says_so() {
        let (_scratch, from, to, locations) = setup();
        fake_model(&from);
        let mut writes = 0;
        let out = run(&locations, &from, &to, &mut |_| {
            writes += 1;
            if writes == 2 {
                fs::remove_dir_all(model_root(&from, ID).join("blobs"))?;
            }
            Ok(())
        });
        assert!(out.is_err());
        assert_eq!(locations.dir_for(ID), from, "mapping unchanged");
        assert!(
            !model_root(&to, ID).exists(),
            "no half copy left at the target"
        );
    }

    #[test]
    fn a_copy_that_does_not_match_its_checksum_is_refused() {
        let (_scratch, from, to, locations) = setup();
        let files = fake_model(&from);
        // Rot in the old copy: the blob no longer hashes to its name.
        let blobs = model_root(&from, ID).join("blobs");
        let weights = fs::read_dir(&blobs)
            .unwrap()
            .flatten()
            .find(|e| e.metadata().unwrap().len() > CHUNK as u64)
            .unwrap()
            .path();
        let mut bytes = fs::read(&weights).unwrap();
        bytes[7] ^= 0xff;
        fs::write(&weights, bytes).unwrap();
        let error = format!(
            "{:#}",
            run(&locations, &from, &to, &mut |_| Ok(())).unwrap_err()
        );
        assert!(error.contains("checksum"), "{error}");
        assert!(!model_root(&to, ID).exists());
        assert_eq!(locations.dir_for(ID), from);
        assert!(model_root(&from, ID)
            .join("snapshots/rev1/config.json")
            .exists());
        let _ = files;
    }

    #[test]
    fn a_target_that_already_holds_the_model_is_never_touched() {
        let (_scratch, from, to, locations) = setup();
        let files = fake_model(&from);
        fake_model(&to);
        let marker = model_root(&to, ID).join("marker");
        fs::write(&marker, "keep").unwrap();
        let error = format!(
            "{:#}",
            run(&locations, &from, &to, &mut |_| Ok(())).unwrap_err()
        );
        assert!(error.contains("already holds"), "{error}");
        assert!(
            marker.exists(),
            "an existing copy must survive a refused move"
        );
        assert_whole(&from, &files);
    }

    #[test]
    fn a_model_that_is_not_downloaded_cannot_be_moved() {
        let (_scratch, from, to, locations) = setup();
        let root = model_root(&from, ID);
        fs::create_dir_all(root.join("blobs")).unwrap();
        fs::write(root.join("blobs/abc.incomplete"), "half").unwrap();
        let error = format!(
            "{:#}",
            run(&locations, &from, &to, &mut |_| Ok(())).unwrap_err()
        );
        assert!(error.contains("not fully downloaded"), "{error}");
    }

    #[test]
    fn a_crash_mid_copy_is_cleaned_on_the_next_start_and_the_old_copy_still_works() {
        let (scratch, from, to, locations) = setup();
        let files = fake_model(&from);
        let mut writes = 0;
        let crashed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = run(&locations, &from, &to, &mut |_| {
                writes += 1;
                assert!(writes < 3, "power cut");
                Ok(())
            });
        }));
        assert!(crashed.is_err());
        assert!(
            model_root(&to, ID).exists(),
            "the crash left a partial copy"
        );
        assert_whole(&from, &files);

        let restarted = Locations::load(scratch.path("state/engine-locations.json"), from.clone());
        assert_eq!(restarted.dir_for(ID), from, "mapping never switched");
        assert!(restarted.recover().is_empty());
        assert!(!model_root(&to, ID).exists(), "partial copy cleaned");
        assert_whole(&from, &files);
        assert!(restarted.recover().is_empty(), "and nothing is left to do");
    }

    #[test]
    fn a_crash_after_the_switch_deletes_the_old_copy_on_the_next_start() {
        let (scratch, from, to, locations) = setup();
        let files = fake_model(&from);
        let crashed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = move_model(
                &locations,
                &job(&from, &to),
                &AtomicU64::new(0),
                &mut |p| assert!(p != "cleaning", "power cut"),
                &mut |_| Ok(()),
            );
        }));
        assert!(crashed.is_err());
        assert!(model_root(&from, ID).exists() && model_root(&to, ID).exists());

        let restarted = Locations::load(scratch.path("state/engine-locations.json"), from.clone());
        assert_eq!(restarted.dir_for(ID), to, "the switch was saved");
        assert!(restarted.recover().is_empty());
        assert!(!model_root(&from, ID).exists(), "old copy cleaned");
        assert_whole(&to, &files);
    }

    #[test]
    fn cleanup_waits_while_the_folder_to_clean_is_away() {
        let (scratch, from, to, locations) = setup();
        fake_model(&from);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = run(&locations, &from, &to, &mut |_| panic!("power cut"));
        }));
        // The drive holding the partial copy is unplugged at restart.
        fs::remove_dir_all(&to).unwrap();
        let restarted = Locations::load(scratch.path("state/engine-locations.json"), from);
        let notes = restarted.recover();
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert!(notes[0].contains("is away"));
        fs::create_dir_all(&to).unwrap();
        assert!(
            restarted.recover().is_empty(),
            "retried when the folder is back"
        );
        let text = fs::read_to_string(scratch.path("state/engine-locations.json")).unwrap();
        assert!(text.contains("\"moves\":{}"), "{text}");
    }
    // ---- legacy hub migration

    fn catalog_model_in(cache: &Path) -> Vec<(&'static str, Vec<u8>)> {
        fake_model(cache)
    }

    #[test]
    fn a_legacy_model_is_copied_once_and_the_old_copy_stays() {
        let scratch = Scratch::new();
        let (legacy, hub) = (scratch.path("tmp-hub"), scratch.path("hub"));
        let files = catalog_model_in(&legacy);
        let notes = migrate_legacy(std::slice::from_ref(&legacy), &hub, &|_| true);
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert_whole(&hub, &files);
        assert_whole(&legacy, &files); // never deleted
        assert!(!hub.join(".migrating").exists());
        // Second start: the target has it, nothing to do.
        assert!(migrate_legacy(&[legacy], &hub, &|_| true).is_empty());
    }

    #[test]
    fn migration_skips_what_it_must_not_touch() {
        let scratch = Scratch::new();
        let (legacy, hub) = (scratch.path("tmp-hub"), scratch.path("hub"));
        catalog_model_in(&legacy);
        // The model already there (even half there) is never overwritten.
        fs::create_dir_all(model_root(&hub, ID).join("blobs")).unwrap();
        assert!(migrate_legacy(std::slice::from_ref(&legacy), &hub, &|_| true).is_empty());
        assert!(!cache_state(&hub, ID, Kind::Asr).downloaded);
        // A model the user keeps in its own folder is not copied to the default one.
        let other = scratch.path("hub2");
        assert!(migrate_legacy(std::slice::from_ref(&legacy), &other, &|_| false).is_empty());
        assert!(!model_root(&other, ID).exists());
        // The same folder, and an unfinished download, are left alone.
        assert!(migrate_legacy(std::slice::from_ref(&legacy), &legacy, &|_| true).is_empty());
        let partial = scratch.path("partial");
        fake_model(&partial);
        fs::remove_file(model_root(&partial, ID).join("snapshots/rev1/model.safetensors")).unwrap();
        assert!(migrate_legacy(&[partial], &scratch.path("hub3"), &|_| true).is_empty());
    }

    #[test]
    fn a_crash_during_migration_leaves_no_half_model_behind() {
        let scratch = Scratch::new();
        let (legacy, hub) = (scratch.path("tmp-hub"), scratch.path("hub"));
        catalog_model_in(&legacy);
        // Leftover staging from a crashed run is cleared and the copy is redone.
        write_leftover(&hub.join(".migrating").join("models--openai--whisper-base"));
        let notes = migrate_legacy(&[legacy], &hub, &|_| true);
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert!(cache_state(&hub, ID, Kind::Asr).downloaded);
        assert!(!hub.join(".migrating").exists());
    }

    fn write_leftover(dir: &Path) {
        fs::create_dir_all(dir.join("blobs")).unwrap();
        fs::write(dir.join("blobs/x.moving"), b"half").unwrap();
    }
}

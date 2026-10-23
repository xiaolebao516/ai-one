use super::{now_ms, Wake};
use agent_hud_agents::HookEvent;
use notify::{
    event::{CreateKind, ModifyKind, RemoveKind},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
const RECORD_LIMIT: u64 = 64 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(super) fn prepare(directory: &Path) -> Result<(), String> {
    crate::os::private_directory(directory)
        .map_err(|_| "Hook inbox must belong to the current user".into())
}
fn key(event: &HookEvent) -> String {
    let mut hash = Sha256::new();
    for field in [&event.source, &event.session_id, &event.kind] {
        hash.update((field.len() as u64).to_le_bytes());
        hash.update(field.as_bytes());
    }
    format!("{:x}", hash.finalize())
}
fn read(path: &Path) -> Option<(HookEvent, Vec<u8>)> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > RECORD_LIMIT {
        return None;
    }
    if !crate::os::owned_by_user(path, &metadata) {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let event: HookEvent = serde_json::from_slice(&bytes).ok()?;
    Some((event, bytes))
}
fn valid(event: &HookEvent, now: i64) -> bool {
    if event.session_id.is_empty() || event.at_ms > now.saturating_add(60_000) {
        return false;
    }
    let retention = match event.kind.as_str() {
        "attention" => 86_400_000,
        "compaction" => 300_000,
        "completion" => 30 * 86_400_000,
        "origin" => i64::MAX,
        _ => return false,
    };
    now.saturating_sub(event.at_ms) < retention
}
/// Only reduced public reporting facts are persisted. Approval payloads never
/// enter this inbox. A hook can report while the GUI and Runtime are absent.
pub fn record_event(data: &Path, event: &HookEvent) -> Result<(), String> {
    if !valid(event, now_ms()) {
        return Err("Unsupported or expired hook event".into());
    }
    let directory = data.join("hooks/inbox");
    prepare(&data.join("hooks"))?;
    prepare(&directory)?;
    let path = directory.join(format!("{}.json", key(event)));
    if read(&path).is_some_and(|(old, _)| old.at_ms > event.at_ms) {
        return Ok(());
    }
    let bytes = serde_json::to_vec(event).map_err(|_| "Invalid hook event")?;
    if bytes.len() as u64 > RECORD_LIMIT {
        return Err("Hook event is too large".into());
    }
    let temporary = directory.join(format!(
        ".{}.{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result: Result<(), String> = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        crate::os::private_file(&mut options);
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Hook event could not be saved")?;
        file.write_all(&bytes)
            .map_err(|_| "Hook event could not be saved")?;
        fs::rename(&temporary, &path).map_err(|_| "Hook event could not be saved".to_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub(super) struct Inbox {
    directory: PathBuf,
    // None requests an initial/full scan; Some(empty) is a quiet inbox.
    pending: Arc<Mutex<Option<HashSet<PathBuf>>>>,
    seen: Mutex<HashMap<PathBuf, Vec<u8>>>,
    _watcher: RecommendedWatcher,
}
impl Inbox {
    pub fn new(data: &Path, wake: Wake) -> Result<Self, String> {
        prepare(&data.join("hooks"))?;
        let directory = data.join("hooks/inbox");
        prepare(&directory)?;
        let directory = directory
            .canonicalize()
            .map_err(|_| "Hook inbox unavailable")?;
        let pending = Arc::new(Mutex::new(None::<HashSet<PathBuf>>));
        let changes = pending.clone();
        let watched = directory.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let Some(change) = changed_paths(&watched, event) else {
                    return;
                };
                {
                    let mut pending = changes.lock().unwrap_or_else(|p| p.into_inner());
                    match change {
                        Change::Full => *pending = None,
                        Change::Paths(paths) => {
                            if let Some(known) = pending.as_mut() {
                                known.extend(paths);
                            }
                        }
                    }
                }
                wake();
            })
            .map_err(|_| "Hook inbox watcher unavailable")?;
        watcher
            .watch(&directory, RecursiveMode::NonRecursive)
            .map_err(|_| "Hook inbox watcher unavailable")?;
        Ok(Self {
            directory,
            pending,
            seen: Mutex::new(HashMap::new()),
            _watcher: watcher,
        })
    }
    pub fn drain(&self) -> Vec<HookEvent> {
        let changed = {
            let mut pending = self.pending.lock().unwrap_or_else(|p| p.into_inner());
            (*pending).replace(HashSet::new())
        };
        if changed.as_ref().is_some_and(HashSet::is_empty) {
            return Vec::new();
        }
        let mut events = Vec::new();
        let mut seen = self.seen.lock().unwrap_or_else(|p| p.into_inner());
        let now = now_ms();
        let full = changed.is_none();
        let paths = if let Some(paths) = changed {
            paths
        } else {
            let Ok(entries) = fs::read_dir(&self.directory) else {
                *self.pending.lock().unwrap_or_else(|p| p.into_inner()) = None;
                return events;
            };
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| is_record(path))
                .collect::<HashSet<_>>()
        };
        if full {
            seen.retain(|path, _| paths.contains(path));
        }
        for path in paths {
            if let Some((event, bytes)) = read(&path) {
                if !valid(&event, now) {
                    let _ = fs::remove_file(&path);
                    seen.remove(&path);
                    continue;
                }
                let digest = Sha256::digest(bytes).to_vec();
                if seen.get(&path) != Some(&digest) {
                    seen.insert(path, digest);
                    events.push(event);
                }
            } else {
                seen.remove(&path);
            }
        }
        events.sort_by_key(|event| event.at_ms);
        events
    }
}

enum Change {
    Full,
    Paths(HashSet<PathBuf>),
}
fn is_record(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()) == Some("json")
}
fn temporary(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()) == Some("tmp")
}
/// Notifications only identify paths; all reads remain in the serial drain.
/// FSEvents may coalesce to a directory or request a rescan. Those cases must
/// keep the full-scan path instead of assuming a missing filename means quiet.
fn changed_paths(directory: &Path, event: notify::Result<Event>) -> Option<Change> {
    let Ok(event) = event else {
        return Some(Change::Full);
    };
    if event.need_rescan() {
        return Some(Change::Full);
    }
    if matches!(event.kind, EventKind::Access(_)) {
        return None;
    }
    if event.paths.is_empty() {
        return Some(Change::Full);
    }
    let mut paths = HashSet::new();
    for path in event.paths {
        if path == directory || directory.starts_with(&path) {
            return Some(Change::Full);
        }
        if !path.starts_with(directory) {
            continue;
        }
        if matches!(
            event.kind,
            EventKind::Create(CreateKind::Folder) | EventKind::Remove(RemoveKind::Folder)
        ) {
            return Some(Change::Full);
        }
        if path.parent() != Some(directory) {
            continue;
        }
        if is_record(&path) {
            paths.insert(path);
        } else if !temporary(&path)
            && matches!(
                event.kind,
                EventKind::Any | EventKind::Other | EventKind::Modify(ModifyKind::Name(_))
            )
        {
            return Some(Change::Full);
        }
    }
    (!paths.is_empty()).then_some(Change::Paths(paths))
}

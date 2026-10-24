//! ai-one addition (not upstream code; Apache-2.0, same as this tree).
//!
//! Publishes what the HUD already computed to a folder ai-one reads:
//!
//! * `hud-snapshot.json` - the quotas, accounts, providers, billing, a short
//!   session list and the token totals of the newest snapshot, written whenever the snapshot
//!   changes (atomic: temp file, then rename).
//! * `hud-status.json` - `{pid, heartbeatAt}` every few seconds, so ai-one can
//!   tell a running HUD from a stale file.
//!
//! The folder comes from `AI_ONE_HUD_EXPORT_DIR`. Without it nothing is
//! written. The HUD never reads anything back from this folder.
use agent_hud_host::extension::{HostContext, ProductExtension};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

const SNAPSHOT_FILE: &str = "hud-snapshot.json";
const STATUS_FILE: &str = "hud-status.json";
const HEARTBEAT: Duration = Duration::from_secs(5);
/// Sessions kept in the export; the HUD itself shows only recent ones.
const SESSION_LIMIT: usize = 40;

pub struct AiOneExport {
    directory: Option<PathBuf>,
    status: Arc<Status>,
}

/// The heartbeat file's owner. The heartbeat thread and `stop()` both write
/// `hud-status.json`; the lock makes every write whole and, once stopped, a
/// heartbeat that was already on its way can no longer write `running: true`
/// over the final `running: false`.
pub struct Status {
    /// `true` once stopped.
    stopped: Mutex<bool>,
}

impl Status {
    fn new() -> Self {
        Self {
            stopped: Mutex::new(false),
        }
    }

    /// Write a running heartbeat; false once stopped.
    fn beat(&self, directory: &Path) -> bool {
        self.beat_with(directory, || {})
    }

    /// `beat`, running `before_write` once the lock is held and the stopped
    /// check has passed, just before the file is written. Tests use it to hold
    /// a heartbeat inside that window while `stop()` races it.
    fn beat_with(&self, directory: &Path, before_write: impl FnOnce()) -> bool {
        let Ok(stopped) = self.stopped.lock() else {
            return false;
        };
        if *stopped {
            return false;
        }
        before_write();
        let _ = write_atomic(directory, STATUS_FILE, &status_value(true));
        true
    }

    /// Write the final `running: false`. Later heartbeats write nothing.
    fn stop(&self, directory: &Path) {
        if let Ok(mut stopped) = self.stopped.lock() {
            *stopped = true;
            let _ = write_atomic(directory, STATUS_FILE, &status_value(false));
        }
    }
}

fn status_value(running: bool) -> Value {
    json!({
        "pid": std::process::id(),
        "heartbeatAt": chrono::Utc::now().to_rfc3339(),
        "running": running,
    })
}

impl AiOneExport {
    pub fn from_environment() -> Self {
        let directory = std::env::var_os("AI_ONE_HUD_EXPORT_DIR")
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty());
        Self {
            directory,
            status: Arc::new(Status::new()),
        }
    }
}

/// Write `value` to `directory/name` through a temp file in the same folder.
fn write_atomic(directory: &Path, name: &str, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    // One temp name per write, so two writers never share a temp file.
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let temporary = directory.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, directory.join(name)).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })
}

/// The part of a snapshot ai-one needs. Fields are copied as the HUD wrote
/// them; nothing is derived here, so an unknown value stays unknown.
pub fn reduce(snapshot: &Value) -> Value {
    let sessions: Vec<Value> = snapshot
        .get("sessions")
        .and_then(Value::as_array)
        .map(|sessions| {
            sessions
                .iter()
                .take(SESSION_LIMIT)
                .map(|session| {
                    json!({
                        "id": session.get("id"),
                        "title": session.get("title"),
                        "source": session.get("source"),
                        "state": session.get("state"),
                        "updatedAt": session.get("updatedAt"),
                        "tokens": session.get("tokens"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    json!({
        "schemaVersion": 1,
        "generatedAt": snapshot.get("generatedAt"),
        "mode": snapshot.get("mode"),
        "connection": {
            "status": snapshot.pointer("/connection/status"),
            "message": snapshot.pointer("/connection/message"),
            "platform": snapshot.pointer("/connection/platform"),
            "platformCapabilities": snapshot.pointer("/connection/platformCapabilities"),
        },
        "accounts": snapshot.get("accounts").cloned().unwrap_or(json!([])),
        "providers": snapshot.get("providers").cloned().unwrap_or(json!([])),
        "indexing": snapshot.get("indexing"),
        "totals": snapshot.get("totals"),
        "quotas": snapshot.get("quotas").cloned().unwrap_or(json!([])),
        "billing": snapshot.get("billing").cloned().unwrap_or(json!([])),
        "sessions": sessions,
    })
}

impl ProductExtension for AiOneExport {
    fn start(&self, _host: HostContext) -> Result<(), String> {
        let Some(directory) = self.directory.clone() else {
            return Ok(());
        };
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let status = Arc::clone(&self.status);
        std::thread::Builder::new()
            .name("ai-one-hud-heartbeat".into())
            .spawn(move || {
                while status.beat(&directory) {
                    std::thread::sleep(HEARTBEAT);
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn request(&self, method: &str, _params: Value) -> Result<Value, String> {
        Err(format!("ai-one HUD has no product request \"{method}\""))
    }

    fn observe_snapshot(&self, snapshot: Arc<Value>) {
        if let Some(directory) = &self.directory {
            let _ = write_atomic(directory, SNAPSHOT_FILE, &reduce(&snapshot));
        }
    }

    fn stop(&self) {
        if let Some(directory) = &self.directory {
            self.status.stop(directory);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduce_keeps_unknown_values_unknown() {
        let snapshot = json!({
            "generatedAt": "2026-10-23T00:00:00Z",
            "mode": "live",
            "connection": {"status": "connected", "platform": "windows", "message": null},
            "quotas": [{"id": "q", "vendor": "claude", "name": "5h", "usedPercent": null,
                        "resetAt": null, "status": "stale", "account": null}],
            "sessions": [{"id": "s", "title": "t", "source": "claude", "state": "running",
                          "updatedAt": "x", "tokens": 3, "cwd": "C:/secret"}],
        });
        let reduced = reduce(&snapshot);
        assert_eq!(reduced["quotas"][0]["usedPercent"], Value::Null);
        assert_eq!(reduced["sessions"][0].get("cwd"), None);
        assert_eq!(reduced["billing"], json!([]));
    }

    #[test]
    fn atomic_write_replaces_file() {
        let directory = tempfile_dir();
        write_atomic(&directory, SNAPSHOT_FILE, &json!({"a": 1})).unwrap();
        write_atomic(&directory, SNAPSHOT_FILE, &json!({"a": 2})).unwrap();
        let text = std::fs::read_to_string(directory.join(SNAPSHOT_FILE)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&text).unwrap()["a"], 2);
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_heartbeat_inside_the_write_path_cannot_overwrite_the_final_status() {
        // Deterministic interleaving, no sleeps: the heartbeat is parked after
        // its stopped check passed and before its write; only then does stop()
        // start. stop() has to wait for the heartbeat's lock, so the heartbeat
        // writes first and `running: false` is the last word. With the check
        // outside the lock, stop() would finish first and the heartbeat would
        // then write `running: true` over it.
        use std::sync::mpsc::channel;
        let directory = tempfile_dir();
        let status = Arc::new(Status::new());
        let (entered_tx, entered_rx) = channel::<()>();
        let (release_tx, release_rx) = channel::<()>();
        let beating = {
            let (status, directory) = (Arc::clone(&status), directory.clone());
            std::thread::spawn(move || {
                status.beat_with(&directory, || {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                })
            })
        };
        entered_rx.recv().unwrap();
        let (stopped_tx, stopped_rx) = channel::<()>();
        let stopping = {
            let (status, directory) = (Arc::clone(&status), directory.clone());
            std::thread::spawn(move || {
                status.stop(&directory);
                stopped_tx.send(()).unwrap();
            })
        };
        // While the heartbeat is parked inside the write path, stop() must not
        // get through. The wait is bounded and only ever times out on correct
        // code, so this cannot make a correct build flaky.
        assert!(
            stopped_rx.recv_timeout(Duration::from_millis(300)).is_err(),
            "stop() finished while a heartbeat was still inside its write path"
        );
        release_tx.send(()).unwrap();
        assert!(beating.join().unwrap(), "the parked heartbeat wrote");
        stopping.join().unwrap();
        let text = std::fs::read_to_string(directory.join(STATUS_FILE)).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&text).unwrap()["running"],
            false
        );
        assert!(!status.beat(&directory), "no heartbeat once stopped");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_heartbeat_after_stop_cannot_overwrite_the_final_status() {
        let directory = tempfile_dir();
        let status = Status::new();
        assert!(status.beat(&directory));
        status.stop(&directory);
        assert!(!status.beat(&directory), "no heartbeat once stopped");
        let text = std::fs::read_to_string(directory.join(STATUS_FILE)).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&text).unwrap()["running"],
            false
        );
        let _ = std::fs::remove_dir_all(&directory);
    }

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn tempfile_dir() -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "ai-one-hud-export-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }
}

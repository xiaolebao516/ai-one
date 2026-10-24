//! Quota HUD bridge (Spec #82). The HUD itself is `agent-hud/` (ported Agent HUD Open), a
//! separate process `ai-one-hud.exe`. It writes `hud-snapshot.json` and a heartbeat
//! `hud-status.json` into the export folder below; this module only reads those files and can
//! start the HUD. ai-one never computes quota itself, so the resources page, the title bar and
//! the HUD read the same numbers.
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const SNAPSHOT_FILE: &str = "hud-snapshot.json";
const STATUS_FILE: &str = "hud-status.json";
const EXE_NAME: &str = if cfg!(windows) {
    "ai-one-hud.exe"
} else {
    "ai-one-hud"
};
/// The HUD writes its heartbeat every 5 seconds; older than this means it is gone.
const HEARTBEAT_LIMIT_SECONDS: i64 = 30;
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// A heartbeat time this far ahead of now is a clock fault, not a live HUD.
const FUTURE_TOLERANCE_SECONDS: i64 = 5;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    /// running | stopped | absent | unreadable
    state: &'static str,
    heartbeat_age_seconds: Option<i64>,
    snapshot: Option<Value>,
    read_at: String,
}

fn export_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("hud")
        .join("export"))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("hud")
        .join("data"))
}

/// Read a bounded JSON file. The HUD replaces its files by rename, and on Windows a reader that
/// opens one at that instant can fail, so a failed read is retried a few times. The size limit is
/// enforced on the one open handle (reading at most the limit plus one byte), so a file swapped
/// in after a separate size check cannot slip past it.
fn read_json(path: &Path) -> Result<Option<Value>, String> {
    use std::io::Read;
    let mut last = String::new();
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(60));
        }
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if attempt == 3 {
                    return Ok(None);
                }
                last = error.to_string();
                continue;
            }
            Err(error) => {
                last = error.to_string();
                continue;
            }
        };
        let mut bytes = Vec::new();
        if let Err(error) = file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes) {
            last = error.to_string();
            continue;
        }
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err("file too large".into());
        }
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(value) => return Ok(Some(value)),
            Err(error) => last = error.to_string(),
        }
    }
    Err(last)
}

fn heartbeat_age(status: &Value, now: chrono::DateTime<chrono::Utc>) -> Option<i64> {
    let at = status.get("heartbeatAt")?.as_str()?;
    let at = chrono::DateTime::parse_from_rfc3339(at).ok()?;
    let age = (now - at.with_timezone(&chrono::Utc)).num_seconds();
    // A time well in the future (clock set back, bad file) is no heartbeat at all.
    if age < -FUTURE_TOLERANCE_SECONDS {
        return None;
    }
    Some(age.max(0))
}

/// Pure so it can be tested: classify what was read.
fn classify(
    status: Result<Option<Value>, String>,
    snapshot: Result<Option<Value>, String>,
    now: chrono::DateTime<chrono::Utc>,
) -> Reading {
    let read_at = now.to_rfc3339();
    let (status, snapshot) = match (status, snapshot) {
        (Ok(status), Ok(snapshot)) => (status, snapshot),
        _ => {
            return Reading {
                state: "unreadable",
                heartbeat_age_seconds: None,
                snapshot: None,
                read_at,
            }
        }
    };
    let Some(status) = status else {
        // No heartbeat file: the HUD never ran here, or only an old export exists.
        return Reading {
            state: if snapshot.is_some() {
                "stopped"
            } else {
                "absent"
            },
            heartbeat_age_seconds: None,
            snapshot,
            read_at,
        };
    };
    let age = heartbeat_age(&status, now);
    let running = status.get("running").and_then(Value::as_bool) == Some(true)
        && age.is_some_and(|age| age <= HEARTBEAT_LIMIT_SECONDS);
    Reading {
        state: if running { "running" } else { "stopped" },
        heartbeat_age_seconds: age,
        snapshot,
        read_at,
    }
}

#[tauri::command]
pub fn quota_hud_read(app: AppHandle) -> Result<String, String> {
    let dir = export_dir(&app)?;
    let reading = classify(
        read_json(&dir.join(STATUS_FILE)),
        read_json(&dir.join(SNAPSHOT_FILE)),
        chrono::Utc::now(),
    );
    serde_json::to_string(&reading).map_err(|error| error.to_string())
}

/// Where `ai-one-hud` lives: `AI_ONE_HUD_EXE`, beside this executable, or a development build
/// of `agent-hud/` found by walking up from this executable.
fn find_exe() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("AI_ONE_HUD_EXE").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    let current = std::env::current_exe().ok()?;
    let beside = current.parent()?.join(EXE_NAME);
    if beside.is_file() {
        return Some(beside);
    }
    for ancestor in current.ancestors().skip(1).take(6) {
        for profile in ["release", "debug"] {
            let path = ancestor
                .join("agent-hud")
                .join("target")
                .join(profile)
                .join(EXE_NAME);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn already_running(dir: &Path) -> bool {
    matches!(
        classify(
            read_json(&dir.join(STATUS_FILE)),
            Ok(None),
            chrono::Utc::now()
        )
        .state,
        "running"
    )
}

#[tauri::command]
pub fn quota_hud_start(app: AppHandle) -> Result<String, String> {
    let dir = export_dir(&app)?;
    let result = |started: bool, reason: &str| json!({"started": started, "reason": reason});
    if already_running(&dir) {
        return Ok(result(false, "already-running").to_string());
    }
    let Some(exe) = find_exe() else {
        return Ok(result(false, "exe-not-found").to_string());
    };
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let data = data_dir(&app)?;
    fs::create_dir_all(&data).map_err(|error| error.to_string())?;
    let mut command = Command::new(exe);
    command
        .env("AI_ONE_HUD_EXPORT_DIR", &dir)
        .env("AGENTHUD_NEXT_DATA_DIR", &data)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: the HUD is its own window and outlives ai-one.
        command.creation_flags(0x0000_0208);
    }
    match command.spawn() {
        Ok(mut child) => {
            // Reap the child when it exits so a long-running ai-one never leaves a zombie on Unix.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(result(true, "spawned").to_string())
        }
        Err(_) => Ok(result(false, "error").to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc
            .with_ymd_and_hms(2026, 10, 23, 12, 0, 0)
            .unwrap()
    }
    fn status(seconds_ago: i64, running: bool) -> Value {
        json!({
            "pid": 1,
            "heartbeatAt": (now() - chrono::Duration::seconds(seconds_ago)).to_rfc3339(),
            "running": running,
        })
    }

    #[test]
    fn fresh_heartbeat_is_running() {
        let reading = classify(
            Ok(Some(status(5, true))),
            Ok(Some(json!({"quotas": []}))),
            now(),
        );
        assert_eq!(reading.state, "running");
        assert_eq!(reading.heartbeat_age_seconds, Some(5));
        assert!(reading.snapshot.is_some());
    }

    #[test]
    fn old_heartbeat_or_a_clean_exit_is_stopped_but_keeps_the_last_snapshot() {
        let old = classify(Ok(Some(status(31, true))), Ok(Some(json!({}))), now());
        assert_eq!(old.state, "stopped");
        let quit = classify(Ok(Some(status(1, false))), Ok(Some(json!({}))), now());
        assert_eq!(quit.state, "stopped");
        assert!(quit.snapshot.is_some());
    }

    #[test]
    fn nothing_written_is_absent_and_a_bad_read_is_unreadable() {
        assert_eq!(classify(Ok(None), Ok(None), now()).state, "absent");
        assert_eq!(
            classify(Err("x".into()), Ok(None), now()).state,
            "unreadable"
        );
        assert_eq!(
            classify(Ok(Some(status(1, true))), Err("x".into()), now()).state,
            "unreadable"
        );
    }

    #[test]
    fn a_status_without_a_readable_time_is_never_running() {
        let reading = classify(Ok(Some(json!({"running": true}))), Ok(None), now());
        assert_eq!(reading.state, "stopped");
        assert_eq!(reading.heartbeat_age_seconds, None);
    }

    #[test]
    fn a_heartbeat_from_the_future_is_never_running() {
        // Clock set back or a bad file: far-future time must not read as a live HUD.
        let ahead = classify(Ok(Some(status(-3600, true))), Ok(Some(json!({}))), now());
        assert_eq!(ahead.state, "stopped");
        assert_eq!(ahead.heartbeat_age_seconds, None);
        // Small skew inside the tolerance still counts as fresh.
        let skew = classify(
            Ok(Some(status(-FUTURE_TOLERANCE_SECONDS, true))),
            Ok(None),
            now(),
        );
        assert_eq!(skew.state, "running");
        assert_eq!(skew.heartbeat_age_seconds, Some(0));
        let past_tolerance = classify(
            Ok(Some(status(-FUTURE_TOLERANCE_SECONDS - 1, true))),
            Ok(None),
            now(),
        );
        assert_eq!(past_tolerance.state, "stopped");
    }

    #[test]
    fn an_oversized_file_is_refused_by_what_is_read_not_by_a_size_check() {
        let dir = std::env::temp_dir().join(format!("ai-one-quota-hud-big-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let big = dir.join("big.json");
        // Valid JSON just over the limit: it must be rejected for its size, not parsed.
        let mut bytes = vec![b' '; MAX_FILE_BYTES as usize];
        bytes.extend_from_slice(b"{}");
        fs::write(&big, &bytes).unwrap();
        assert_eq!(read_json(&big).unwrap_err(), "file too large");
        // Exactly at the limit is still read.
        let mut at_limit = vec![b' '; MAX_FILE_BYTES as usize - 2];
        at_limit.extend_from_slice(b"{}");
        let ok = dir.join("ok.json");
        fs::write(&ok, &at_limit).unwrap();
        assert!(read_json(&ok).unwrap().is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_files_are_read_and_a_torn_file_is_an_error() {
        let dir = std::env::temp_dir().join(format!("ai-one-quota-hud-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let good = dir.join("good.json");
        fs::write(&good, b"{\"a\":1}").unwrap();
        assert_eq!(read_json(&good).unwrap().unwrap()["a"], 1);
        assert!(read_json(&dir.join("missing.json")).unwrap().is_none());
        let torn = dir.join("torn.json");
        fs::write(&torn, b"{\"a\":").unwrap();
        assert!(read_json(&torn).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}

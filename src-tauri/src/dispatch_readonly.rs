//! Prodex 0.40.40 metadata only (#80). Never open results, artifacts, tasks, browser
//! profiles, credentials or `pro show/latest`. These CLI commands read reply text.
//! Records are observations, not authenticated proof; no receipt key is accessed.
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const FAILED: &str = "派工元数据读取失败，请检查仓库路径和本机文件权限";
const MAX_BYTES: u64 = 128 * 1024;
const MAX_RECORDS: usize = 200;
const MAX_SCAN: usize = 4000;

#[derive(Default, Deserialize, Serialize)]
struct Session {
    id: Option<String>,
    task_id: Option<String>,
    session_key: Option<String>,
    thread: Option<String>,
    status: Option<String>,
    created_at: Option<String>,
    last_used_at: Option<String>,
    #[serde(skip_serializing)]
    blocker: Option<Blocker>,
    #[serde(default)]
    blocker_code: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
}
#[derive(Deserialize)]
struct Blocker {
    code: Option<String>,
    // This upstream field contains a recovery command, never a reply. Extract only
    // the hex request id immediately; no command/error text crosses IPC.
    #[serde(default, deserialize_with = "request_from_step")]
    next_step: Option<String>,
}
fn request_from_step<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let step = Option::<String>::deserialize(d)?;
    Ok(step.and_then(|s| {
        s.split_once("--request-id ").and_then(|(_, rest)| {
            let id: String = rest.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
            valid_request(&id).then_some(id)
        })
    }))
}
#[derive(Default, Deserialize, Serialize)]
struct Receipt {
    kind: Option<String>,
    task_id: Option<String>,
    session_id: Option<String>,
    created_at: Option<String>,
    #[serde(skip_serializing)]
    metadata: Option<ReceiptMetadata>,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    thread: Option<String>,
}
#[derive(Deserialize)]
struct ReceiptMetadata {
    request_id: Option<String>,
    thread: Option<String>,
}
#[derive(Default, Deserialize)]
struct Claim {
    pid: Option<u32>,
    #[serde(rename = "startedAt")]
    started_at: Option<u64>,
    task: Option<String>,
    #[serde(rename = "sessionKey")]
    session_key: Option<String>,
    #[serde(rename = "threadUrl")]
    thread: Option<String>,
}
#[derive(Serialize)]
struct Slot {
    id: usize,
    port: usize,
    claim_present: bool,
    stale: bool,
    invalid: bool,
    pid: Option<u32>,
    started_at: Option<u64>,
    task: Option<String>,
    session_key: Option<String>,
    thread: Option<String>,
}
#[derive(Default, Serialize)]
pub struct Snapshot {
    sessions: Vec<Session>,
    receipts: Vec<Receipt>,
    slots: Vec<Slot>,
    skipped: usize,
    truncated: bool,
}
#[derive(Deserialize)]
struct SlotConfig {
    count: usize,
}

#[tauri::command]
pub async fn dispatch_readonly_snapshot(
    webview: tauri::Webview,
    repo_path: String,
) -> Result<Snapshot, String> {
    crate::webviews::ensure_control_webview(&webview)
        .map_err(|_| "Request not allowed.".to_string())?;
    let root = PathBuf::from(repo_path);
    if !root.is_absolute() || !root.join(".git").exists() {
        return Err(FAILED.into());
    }
    let home = std::env::var_os("PRODEX_SLOTS_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|p| PathBuf::from(p).join(".local/share/prodex"))
        })
        .ok_or_else(|| FAILED.to_string())?;
    tauri::async_runtime::spawn_blocking(move || collect(&root, &home))
        .await
        .map_err(|_| FAILED.to_string())?
        .map_err(|_| FAILED.to_string())
}

fn safe_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir() && !is_link(&m))
}
fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}
fn read_record<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if !metadata.is_file() || is_link(&metadata) || metadata.len() > MAX_BYTES {
        return Err(());
    }
    // No read_to_string/Value: serde skips unrecognised fields rather than retaining
    // free text in the response model. The cap applies to the opened stream too.
    let file = File::open(path).map_err(|_| ())?;
    serde_json::from_reader(BufReader::new(file.take(MAX_BYTES + 1))).map_err(|_| ())
}
fn id_ok(value: &str, prefix: &str) -> bool {
    let Some(rest) = value.strip_prefix(prefix) else {
        return false;
    };
    rest.is_ascii()
        && rest.len() >= 17
        && rest.len() <= 116
        && rest.as_bytes().get(8) == Some(&b'_')
        && rest.as_bytes().get(15) == Some(&b'_')
        && rest[..8].bytes().all(|b| b.is_ascii_digit())
        && rest[9..15].bytes().all(|b| b.is_ascii_digit())
        && rest[16..]
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn valid_request(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_session(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:@/-".contains(&b))
}
fn valid_slot_session(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
fn valid_thread(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("https://chatgpt.com/") else {
        return false;
    };
    let parts: Vec<_> = rest.split('/').collect();
    let id = match parts.as_slice() {
        ["c", id] => *id,
        ["g", project, "c", id]
            if project.strip_prefix("g-p-").is_some_and(|s| {
                !s.is_empty()
                    && s.len() <= 40
                    && s.bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            }) =>
        {
            *id
        }
        _ => return false,
    };
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
fn valid_time(value: &str) -> bool {
    // ISO UTC metadata only; the frontend also validates the actual calendar date.
    (20..=30).contains(&value.len())
        && value.ends_with('Z')
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || b"-T:.Z".contains(&b))
}
fn keep(value: &mut Option<String>, valid: impl FnOnce(&str) -> bool) {
    if !value.as_deref().is_some_and(valid) {
        *value = None;
    }
}
fn session_metadata(mut row: Session) -> Session {
    keep(&mut row.id, |s| id_ok(s, "sess_"));
    keep(&mut row.task_id, |s| id_ok(s, "task_"));
    keep(&mut row.session_key, valid_session);
    keep(&mut row.thread, valid_thread);
    keep(&mut row.created_at, valid_time);
    keep(&mut row.last_used_at, valid_time);
    keep(&mut row.status, |s| {
        ["preview", "running", "done", "blocked"].contains(&s)
    });
    // Ignore injected top-level derived fields, even if a hand-edited file has them.
    row.request_id = None;
    row.blocker_code = None;
    if let Some(blocker) = row.blocker.take() {
        row.blocker_code = blocker
            .code
            .filter(|s| ["send_timeout", "request_mismatch"].contains(&s.as_str()));
        row.request_id = blocker.next_step;
    }
    row
}
fn receipt_metadata(mut row: Receipt) -> Receipt {
    keep(&mut row.kind, |s| {
        ["consult_answer_saved", "task_completed"].contains(&s)
    });
    keep(&mut row.task_id, |s| id_ok(s, "task_"));
    keep(&mut row.session_id, |s| id_ok(s, "sess_"));
    keep(&mut row.created_at, valid_time);
    row.request_id = None;
    row.thread = None;
    if let Some(meta) = row.metadata.take() {
        row.request_id = meta.request_id.filter(|s| valid_request(s));
        row.thread = meta.thread.filter(|s| valid_thread(s));
    }
    row
}
fn recent_files(dir: &Path, prefix: &str, snapshot: &mut Snapshot) -> Vec<PathBuf> {
    if !dir.exists() {
        return vec![];
    }
    if !safe_dir(dir) {
        snapshot.skipped += 1;
        return vec![];
    }
    let Ok(entries) = fs::read_dir(dir) else {
        snapshot.skipped += 1;
        return vec![];
    };
    let mut files = vec![];
    for (index, entry) in entries.enumerate() {
        if index >= MAX_SCAN {
            snapshot.truncated = true;
            break;
        }
        let Ok(entry) = entry else {
            snapshot.skipped += 1;
            continue;
        };
        let Some(name) = entry.file_name().to_str().map(String::from) else {
            continue;
        };
        if !name.starts_with(prefix) || !name.ends_with(".json") {
            continue;
        }
        // Never open repo-write receipts: older versions can contain inline payloads.
        if prefix == "receipt_"
            && !name.contains("_consult-answer-saved")
            && !name.contains("_task-completed")
        {
            continue;
        }
        files.push(entry.path());
    }
    files.sort_unstable_by(|a, b| b.cmp(a));
    if files.len() > MAX_RECORDS {
        snapshot.truncated = true;
        files.truncate(MAX_RECORDS);
    }
    files
}
fn collect(root: &Path, home: &Path) -> Result<Snapshot, ()> {
    if !safe_dir(root) {
        return Err(());
    }
    let mut snapshot = Snapshot::default();
    let bridge = root.join(".bridge");
    if bridge.exists() {
        if !safe_dir(&bridge) {
            return Err(());
        }
        for path in recent_files(&bridge.join("sessions"), "sess_", &mut snapshot) {
            match read_record::<Session>(&path) {
                Ok(row) => snapshot.sessions.push(session_metadata(row)),
                Err(()) => snapshot.skipped += 1,
            }
        }
        for path in recent_files(&bridge.join("receipts"), "receipt_", &mut snapshot) {
            match read_record::<Receipt>(&path) {
                Ok(row) => snapshot.receipts.push(receipt_metadata(row)),
                Err(()) => snapshot.skipped += 1,
            }
        }
    }
    // Same config/claim metadata as prodex-slots list --json, without its browser
    // probe (pro browser check also reads latest_pro). No processes or network.
    let count = if home.exists() {
        if !safe_dir(home) {
            return Err(());
        }
        let config = home.join("slots.json");
        if config.exists() {
            match read_record::<SlotConfig>(&config) {
                Ok(c) if (1..=8).contains(&c.count) => c.count,
                _ => {
                    snapshot.skipped += 1;
                    0
                }
            }
        } else {
            1
        }
    } else {
        1
    };
    let claims = home.join("slot-claims");
    let claims_safe = !claims.exists() || safe_dir(&claims);
    for id in 1..=count {
        let path = claims.join(format!("slot-{id}.json"));
        let present = claims_safe && path.exists();
        let mut slot = Slot {
            id,
            port: 9332 + id,
            claim_present: present,
            stale: false,
            invalid: !claims_safe,
            pid: None,
            started_at: None,
            task: None,
            session_key: None,
            thread: None,
        };
        if present {
            match read_record::<Claim>(&path) {
                Ok(mut claim) => {
                    slot.stale = fs::symlink_metadata(&path)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| SystemTime::now().duration_since(t).ok())
                        .is_some_and(|age| age >= Duration::from_secs(120));
                    keep(&mut claim.task, |s| {
                        s.strip_prefix('#').is_some_and(|n| {
                            !n.is_empty() && n.len() <= 6 && n.bytes().all(|b| b.is_ascii_digit())
                        })
                    });
                    keep(&mut claim.session_key, valid_slot_session);
                    keep(&mut claim.thread, valid_thread);
                    slot.pid = claim.pid.filter(|p| *p > 0);
                    slot.started_at = claim
                        .started_at
                        .filter(|n| *n > 0 && *n < 8_640_000_000_000_000);
                    slot.task = claim.task;
                    slot.session_key = claim.session_key;
                    slot.thread = claim.thread;
                }
                Err(()) => {
                    slot.invalid = true;
                    snapshot.skipped += 1;
                }
            }
        }
        snapshot.slots.push(slot);
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn projects_only_metadata_and_extracts_request_id() {
        let raw = r#"{"id":"sess_20261022_120000_demo","status":"blocked","summary":"PRIVATE_REPLY","cookie":"PRIVATE_COOKIE","blocker":{"code":"send_timeout","message":"PRIVATE_ERROR","next_step":"recover --request-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}"#;
        let row = session_metadata(serde_json::from_str(raw).unwrap());
        let json = serde_json::to_string(&row).unwrap();
        assert!(!json.contains("PRIVATE"));
        assert_eq!(
            row.request_id.as_deref(),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
        assert_eq!(row.blocker_code.as_deref(), Some("send_timeout"));
        let row = receipt_metadata(serde_json::from_str(r#"{"kind":"consult_answer_saved","summary":"PRIVATE_REPLY","metadata":{"request_id":"invalid","token":"PRIVATE_TOKEN","thread":"https://chatgpt.com/c/123?token=PRIVATE"}}"#).unwrap());
        assert!(!serde_json::to_string(&row).unwrap().contains("PRIVATE"));
        assert!(row.thread.is_none());
    }
    #[test]
    fn slot_session_keys_follow_the_slot_cli_rule() {
        for key in ["_audit", ".audit", ":audit", "-audit", "a-1.b:c_d"] {
            assert!(valid_slot_session(key));
        }
        for key in ["", "a/b", "a@b", "space here", "cookie=x"] {
            assert!(!valid_slot_session(key));
        }
        assert!(!valid_slot_session(&"a".repeat(65)));
        assert!(!valid_session("_audit"));
    }
    #[test]
    fn validates_metadata_before_ipc() {
        assert!(!id_ok("sess_你你你你你你你你你你你你", "sess_"));
        assert!(valid_thread(
            "https://chatgpt.com/c/6ad9fa49-d908-83e9-a9dd-f183da27abd6"
        ));
        for value in [
            "https://chatgpt.com/c/6ad9fa49-d908-83e9-a9dd-f183da27abd6?token=x",
            "https://x@y/c/123",
            "https://chatgpt.com/c/../secret",
        ] {
            assert!(!valid_thread(value));
        }
    }
    #[test]
    fn reads_real_files_without_opening_results_or_changing_sources() {
        let dir = std::env::temp_dir().join(format!("ai-one-dispatch-{}", std::process::id()));
        fs::create_dir_all(dir.join(".bridge/sessions")).unwrap();
        fs::create_dir_all(dir.join(".bridge/results")).unwrap();
        let record = dir.join(".bridge/sessions/sess_20261022_120000_demo.json");
        fs::write(&record, b"{broken").unwrap();
        fs::write(
            dir.join(".bridge/results/never-open.json"),
            b"PRIVATE_REPLY",
        )
        .unwrap();
        fs::write(
            dir.join(".bridge/sessions/sess_20261022_120001_large.json"),
            vec![b'x'; MAX_BYTES as usize + 1],
        )
        .unwrap();
        let before = fs::metadata(&record).unwrap().modified().unwrap();
        let result = collect(&dir, &dir.join("absent-home")).unwrap();
        assert_eq!(result.skipped, 2);
        assert_eq!(result.slots.len(), 1);
        assert_eq!(before, fs::metadata(&record).unwrap().modified().unwrap());
        assert!(!serde_json::to_string(&result).unwrap().contains("PRIVATE"));
        fs::remove_dir_all(dir).unwrap();
    }
}

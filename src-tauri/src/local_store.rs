use std::path::{Path, PathBuf};
use std::collections::BTreeSet;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

static LOCAL_STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalStoreStatus {
    Ok,
    Missing,
    Corrupt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreRead {
    pub status: LocalStoreStatus,
    pub text: Option<String>,
    pub backup: Option<String>,
}

fn lock_local_store() -> Result<MutexGuard<'static, ()>, String> {
    LOCAL_STORE_LOCK
        .lock()
        .map_err(|_| "local store lock poisoned".to_string())
}

fn file_name(name: &str) -> Result<&'static str, String> {
    match name {
        "flows" => Ok("flows.json"),
        "coordination" => Ok("coordination.json"),
        "localTasks" => Ok("local-tasks.json"),
        _ => Err("invalid local store name".to_string()),
    }
}

/// Per-file write ceiling. A write above it is refused (never truncated) with a `too-large` error so
/// callers can surface it; per-record limits (e.g. 5 MB per local task) are enforced by the caller.
fn max_bytes(name: &str) -> usize {
    match name {
        "flows" => 2 * 1024 * 1024,
        "coordination" => 1024 * 1024,
        _ => 256 * 1024 * 1024,
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn read_in_dir(dir: &Path, name: &str) -> Result<LocalStoreRead, String> {
    let filename = file_name(name)?;
    let path = dir.join(filename);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LocalStoreRead {
                status: LocalStoreStatus::Missing,
                text: None,
                backup: None,
            });
        }
        Err(error) => return Err(error.to_string()),
    };

    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => {
            return Ok(LocalStoreRead {
                status: LocalStoreStatus::Corrupt,
                text: None,
                backup: quarantine_in_dir(dir, name)?,
            });
        }
    };

    if serde_json::from_str::<Value>(&text).is_ok() {
        return Ok(LocalStoreRead {
            status: LocalStoreStatus::Ok,
            text: Some(text),
            backup: None,
        });
    }

    Ok(LocalStoreRead {
        status: LocalStoreStatus::Corrupt,
        text: None,
        backup: quarantine_in_dir(dir, name)?,
    })
}

fn write_in_dir(dir: &Path, name: &str, json: &str) -> Result<(), String> {
    let filename = file_name(name)?;
    if json.len() > max_bytes(name) {
        return Err(format!("too-large: {} exceeds {} bytes", filename, max_bytes(name)));
    }
    serde_json::from_str::<Value>(json).map_err(|_| "invalid JSON".to_string())?;

    let path = dir.join(filename);
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    if name == "localTasks" && path.exists() {
        let previous = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let old_ids = local_task_ids(&serde_json::from_str(&previous).map_err(|_| "invalid local tasks")?)?;
        let new_ids = local_task_ids(&serde_json::from_str(json).map_err(|_| "invalid local tasks")?)?;
        let deleted: BTreeSet<_> = old_ids.difference(&new_ids).cloned().collect();
        if !deleted.is_empty() {
            scrub_local_task_backups(dir, &deleted)?;
            // Never back up the pre-deletion primary: that would resurrect the deleted replies.
            return crate::settings::write_atomic(&path, json.as_bytes());
        }
    }
    match std::fs::metadata(&path) {
        Ok(_) => {
            let backup = dir.join(format!("{}.bak", filename));
            std::fs::copy(&path, &backup).map_err(|error| error.to_string())?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    crate::settings::write_atomic(&path, json.as_bytes())
}

fn local_task_ids(value: &Value) -> Result<BTreeSet<String>, String> {
    if value.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("unsupported local task backup; deletion refused, files preserved".into());
    }
    let tasks = value.get("tasks").and_then(Value::as_array)
        .ok_or("invalid local task backup; deletion refused, files preserved")?;
    tasks.iter().map(|task| task.get("id").and_then(Value::as_str).map(String::from)
        .ok_or_else(|| "invalid local task backup; deletion refused, files preserved".into())).collect()
}

/// Validate every recoverable backup first. If any cannot be safely edited, leave the primary
/// untouched and report failure. Backup writes precede the primary commit, so a partial failure
/// never reports deletion success or destroys another task's last primary record.
fn scrub_local_task_backups(dir: &Path, deleted: &BTreeSet<String>) -> Result<(), String> {
    let mut rewrites = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name != "local-tasks.json.bak" && !name.starts_with("local-tasks.json.bak-") { continue; }
        if !entry.file_type().map_err(|error| error.to_string())?.is_file() {
            return Err("unsafe local task backup; deletion refused, files preserved".into());
        }
        let bytes = std::fs::read(entry.path()).map_err(|error| error.to_string())?;
        let mut value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| "invalid local task backup; deletion refused, files preserved")?;
        local_task_ids(&value)?;
        value["tasks"].as_array_mut().expect("validated tasks")
            .retain(|task| !deleted.contains(task["id"].as_str().expect("validated id")));
        rewrites.push((entry.path(), serde_json::to_vec(&value).map_err(|error| error.to_string())?));
    }
    for (path, bytes) in rewrites { crate::settings::write_atomic(&path, &bytes)?; }
    Ok(())
}

fn quarantine_in_dir(dir: &Path, name: &str) -> Result<Option<String>, String> {
    let filename = file_name(name)?;
    let path = dir.join(filename);
    let backup_path = unique_backup_path(dir, filename);
    let backup_name = backup_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "invalid backup filename".to_string())?
        .to_string();

    match std::fs::rename(&path, &backup_path) {
        Ok(()) => Ok(Some(backup_name)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn unique_backup_path(dir: &Path, filename: &str) -> PathBuf {
    let base_name = format!("{}.bak-{}", filename, utc_timestamp());
    let mut candidate = base_name.clone();
    let mut suffix = 2_u32;
    while dir.join(&candidate).exists() {
        candidate = format!("{}-{}", base_name, suffix);
        suffix += 1;
    }
    dir.join(candidate)
}

fn utc_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = (seconds / 86_400) as i64;
    let day_seconds = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        year, month, day, hour, minute, second
    )
}

// Gregorian UTC date conversion from days since 1970-01-01; avoids adding a time dependency.
fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[tauri::command]
pub async fn local_store_read(
    app: AppHandle,
    webview: tauri::Webview,
    name: String,
) -> Result<LocalStoreRead, String> {
    crate::webviews::ensure_control_webview(&webview)?;
    let _guard = lock_local_store()?;
    read_in_dir(&app_data_dir(&app)?, &name)
}

#[tauri::command]
pub async fn local_store_quarantine(
    app: AppHandle,
    webview: tauri::Webview,
    name: String,
) -> Result<Option<String>, String> {
    crate::webviews::ensure_control_webview(&webview)?;
    let _guard = lock_local_store()?;
    quarantine_in_dir(&app_data_dir(&app)?, &name)
}

#[tauri::command]
pub async fn local_store_write(
    app: AppHandle,
    webview: tauri::Webview,
    name: String,
    json: String,
) -> Result<(), String> {
    crate::webviews::ensure_control_webview(&webview)?;
    let _guard = lock_local_store()?;
    write_in_dir(&app_data_dir(&app)?, &name, &json)
}

#[tauri::command]
pub async fn local_store_export(
    app: AppHandle,
    webview: tauri::Webview,
    suggested_name: String,
    content: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    crate::webviews::ensure_control_webview(&webview)?;

    let suggested_name = safe_suggested_name(&suggested_name);
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&suggested_name)
        .add_filter("JSON", &["json"])
        .save_file(move |chosen| {
            let _ = tx.send(chosen);
        });

    match rx.await.map_err(|error| error.to_string())? {
        Some(file_path) => {
            let path = file_path.into_path().map_err(|error| error.to_string())?;
            std::fs::write(&path, content).map_err(|error| error.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

fn safe_suggested_name(value: &str) -> String {
    let leaf = value.rsplit(['/', '\\']).next().unwrap_or("");
    let leaf = leaf.trim();
    if leaf.is_empty() || leaf == "." || leaf == ".." {
        "export.json".to_string()
    } else {
        leaf.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

    fn unique_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-one-local-store-{}-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::SeqCst),
            name
        ))
    }

    fn clean_dir(dir: &Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn read_reports_missing_and_valid_json() {
        let dir = unique_dir("read");
        assert_eq!(
            read_in_dir(&dir, "flows").expect("missing file"),
            LocalStoreRead { status: LocalStoreStatus::Missing, text: None, backup: None }
        );
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let body = "{ \"schemaVersion\": 1 }\n";
        std::fs::write(dir.join("flows.json"), body).expect("seed JSON");
        assert_eq!(
            read_in_dir(&dir, "flows").expect("valid JSON"),
            LocalStoreRead { status: LocalStoreStatus::Ok, text: Some(body.to_string()), backup: None }
        );
        clean_dir(&dir);
    }

    #[test]
    fn corrupt_json_is_quarantined_and_original_bytes_are_preserved() {
        let dir = unique_dir("corrupt");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let body = b"{ definitely not JSON";
        std::fs::write(dir.join("flows.json"), body).expect("seed corrupt file");
        let result = read_in_dir(&dir, "flows").expect("read corrupt file");
        assert_eq!(result.status, LocalStoreStatus::Corrupt);
        assert!(result.text.is_none());
        let backup = result.backup.expect("backup filename");
        assert!(backup.starts_with("flows.json.bak-"));
        assert!(backup.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-'));
        assert_eq!(std::fs::read(dir.join(backup)).expect("read backup"), body.to_vec());
        assert!(!dir.join("flows.json").exists());
        clean_dir(&dir);
    }

    #[test]
    fn invalid_utf8_is_quarantined_without_losing_original_bytes() {
        let dir = unique_dir("utf8");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let body = [0xff, 0xfe, 0x00];
        std::fs::write(dir.join("flows.json"), body).expect("seed invalid UTF-8");
        let result = read_in_dir(&dir, "flows").expect("read invalid UTF-8");
        assert_eq!(result.status, LocalStoreStatus::Corrupt);
        let backup = result.backup.expect("backup filename");
        assert_eq!(std::fs::read(dir.join(backup)).expect("read backup"), body);
        clean_dir(&dir);
    }

    #[test]
    fn deleting_a_local_task_scrubs_all_version_backups_and_preserves_other_tasks() {
        let dir = unique_dir("delete-task");
        let original = r#"{"schemaVersion":1,"tasks":[{"id":"local:delete","text":"PRIVATE_SENTINEL"},{"id":"local:keep","text":"keep me"}]}"#;
        let remaining = r#"{"schemaVersion":1,"tasks":[{"id":"local:keep","text":"keep me"}]}"#;
        write_in_dir(&dir, "localTasks", original).unwrap();
        write_in_dir(&dir, "localTasks", original).unwrap();
        std::fs::write(dir.join("local-tasks.json.bak-20261024"), original).unwrap();
        write_in_dir(&dir, "localTasks", remaining).unwrap();
        for entry in std::fs::read_dir(&dir).unwrap() {
            let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            assert!(!text.contains("PRIVATE_SENTINEL"));
            assert!(text.contains("keep me"));
        }
        clean_dir(&dir);
    }

    #[test]
    fn unsafe_backup_blocks_deletion_without_overwriting_the_primary_or_backup() {
        let dir = unique_dir("delete-corrupt-backup");
        let original = r#"{"schemaVersion":1,"tasks":[{"id":"local:delete","text":"PRIVATE_SENTINEL"}]}"#;
        write_in_dir(&dir, "localTasks", original).unwrap();
        let backup = dir.join("local-tasks.json.bak-20261024");
        std::fs::write(&backup, "corrupt backup to preserve").unwrap();
        assert!(write_in_dir(&dir, "localTasks", r#"{"schemaVersion":1,"tasks":[]}"#).is_err());
        assert_eq!(std::fs::read_to_string(dir.join("local-tasks.json")).unwrap(), original);
        assert_eq!(std::fs::read_to_string(backup).unwrap(), "corrupt backup to preserve");
        clean_dir(&dir);
    }

    #[test]
    fn write_keeps_the_previous_version_in_bak() {
        let dir = unique_dir("write");
        write_in_dir(&dir, "flows", "{\"version\":1}").expect("write first");
        write_in_dir(&dir, "flows", "{\"version\":2}").expect("write second");
        assert_eq!(std::fs::read_to_string(dir.join("flows.json.bak")).expect("read backup"), "{\"version\":1}");
        write_in_dir(&dir, "flows", "{\"version\":3}").expect("write third");
        assert_eq!(std::fs::read_to_string(dir.join("flows.json.bak")).expect("read latest backup"), "{\"version\":2}");
        assert_eq!(std::fs::read_to_string(dir.join("flows.json")).expect("read current"), "{\"version\":3}");
        clean_dir(&dir);
    }

    #[test]
    fn invalid_json_write_is_rejected_before_touching_existing_data() {
        let dir = unique_dir("invalid-write");
        write_in_dir(&dir, "flows", "{\"version\":1}").expect("seed");
        assert!(write_in_dir(&dir, "flows", "{").is_err());
        assert_eq!(std::fs::read_to_string(dir.join("flows.json")).expect("current"), "{\"version\":1}");
        assert!(!dir.join("flows.json.bak").exists());
        clean_dir(&dir);
    }

    #[test]
    fn oversized_write_is_refused_without_touching_existing_data() {
        let dir = unique_dir("too-large");
        write_in_dir(&dir, "coordination", "{\"v\":1}").expect("seed");
        let big = format!("{{\"pad\":\"{}\"}}", "x".repeat(1024 * 1024));
        let error = write_in_dir(&dir, "coordination", &big).unwrap_err();
        assert!(error.starts_with("too-large"));
        assert_eq!(std::fs::read_to_string(dir.join("coordination.json")).expect("current"), "{\"v\":1}");
        clean_dir(&dir);
    }

    #[test]
    fn names_are_a_fixed_allowlist_and_quarantine_moves_the_file() {
        let dir = unique_dir("allowlist");
        assert!(read_in_dir(&dir, "../flows").is_err());
        assert!(write_in_dir(&dir, "arbitrary", "{}").is_err());
        assert!(quarantine_in_dir(&dir, "C:\\secret.json").is_err());

        std::fs::create_dir_all(&dir).expect("create temp dir");
        std::fs::write(dir.join("coordination.json"), "{}").expect("seed");
        let backup = quarantine_in_dir(&dir, "coordination").expect("quarantine").expect("backup");
        assert!(backup.starts_with("coordination.json.bak-"));
        assert_eq!(std::fs::read_to_string(dir.join(backup)).expect("backup content"), "{}");
        assert!(quarantine_in_dir(&dir, "coordination").expect("missing quarantine").is_none());
        clean_dir(&dir);
    }

    #[test]
    fn export_suggested_name_never_contains_path_components() {
        assert_eq!(safe_suggested_name("C:\\private\\flows.json"), "flows.json");
        assert_eq!(safe_suggested_name("../../flows.json"), "flows.json");
        assert_eq!(safe_suggested_name(""), "export.json");
        assert_eq!(safe_suggested_name(".."), "export.json");
    }
}

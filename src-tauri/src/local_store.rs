use std::path::{Path, PathBuf};
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
    serde_json::from_str::<Value>(json).map_err(|_| "invalid JSON".to_string())?;

    let path = dir.join(filename);
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    if path.exists() {
        let backup = dir.join(format!("{}.bak", filename));
        std::fs::copy(&path, &backup).map_err(|error| error.to_string())?;
    }
    crate::settings::write_atomic(&path, json.as_bytes())
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
    let leaf = value.rsplit(|character| character == '/' || character == '\\').next().unwrap_or("");
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
        assert_eq!(std::fs::read(dir.join(backup)).expect("read backup"), body);
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
        let backup = result.backup.expect("backup filename");
        assert_eq!(std::fs::read(dir.join(backup)).expect("read backup"), body);
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

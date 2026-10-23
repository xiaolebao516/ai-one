use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use windows_registry::CURRENT_USER;
const KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const NAME: &str = "Agent HUD Next";
fn expected() -> Result<String, String> {
    let p = std::env::current_exe().map_err(|_| "The installed executable is unavailable")?;
    let p = p.to_str().ok_or("The executable path is invalid")?;
    if p.contains(['\0', '\n', '\r', '"']) {
        return Err("The executable path cannot be registered".into());
    }
    Ok(format!("\"{p}\""))
}
fn enabled() -> bool {
    CURRENT_USER
        .open(KEY)
        .ok()
        .and_then(|k| k.get_string(NAME).ok())
        .is_some_and(|s| expected().is_ok_and(|current| current == s))
}
pub(super) fn set_login(enabled: bool) -> Result<(), String> {
    let k = CURRENT_USER
        .create(KEY)
        .map_err(|_| "The current-user startup registry is unavailable")?;
    if enabled {
        k.set_string(NAME, expected()?)
            .map_err(|_| "The startup entry could not be registered".to_owned())
    } else {
        if k.get_string(NAME).is_ok() {
            k.remove_value(NAME)
                .map_err(|_| "The startup entry could not be removed")?;
        }
        Ok(())
    }
}
pub(super) fn status() -> Result<Value, String> {
    Ok(
        json!({"platform":"windows","launchAtLogin":{"supported":true,"enabled":enabled(),"status":if enabled(){"enabled"}else{"disabled"},"notice":"Uses the current-user Run registry entry; Windows runtime validation is pending."}}),
    )
}

/// Launch at login is left to the user here; nothing is registered on first run.
pub(super) fn register_if_never_registered() -> bool {
    false
}

/// npm installs .cmd shims beside native .exe files.
pub(super) fn cli_candidates(_home: &Path, command: &str, dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    dirs.into_iter()
        .flat_map(|dir| [".exe", ".cmd", ""].map(|suffix| dir.join(format!("{command}{suffix}"))))
        .collect()
}

/// The temporary directory is already per-user.
pub(super) fn private_output(_options: &mut std::fs::OpenOptions) {}

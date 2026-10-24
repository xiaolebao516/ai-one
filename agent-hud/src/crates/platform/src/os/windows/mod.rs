use super::{joined_path, path_entries, variable, Environment, ProcessInfo};
mod apps;
mod files;
pub(crate) mod pipe;
mod process;
mod secrets;
pub(crate) use apps::{activate_app, app_running, ACTIVATES_APPS};
pub(crate) use process::{codex_cli_on_port, parent_processes};
pub(crate) use secrets::stored_secret;
pub(crate) const READS_PROCESS_ENVIRONMENT: bool = false;
/// The desktop app's resume link for a background job is unverified here.
pub(crate) const MOVES_CLAUDE_JOBS: bool = false;
pub(crate) use files::{
    hook_configuration, owned_by_user, owner_only, private_directory, private_file, read_stdin,
};
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
pub(crate) const VALIDATION: &str = "unverified";
pub(crate) const PORTABLE_VALIDATION: &str = "unverified";
/// The operating system whose facts the agents' descriptors give here.
pub(crate) const OS: agent_hud_agents::Os = agent_hud_agents::Os::Windows;
pub(crate) const LEGACY_MAC_HISTORY: bool = false;
pub(crate) fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "User home directory unavailable".into())
}
pub(crate) fn data_dir(home: &Path) -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData/Local"))
        .join("app.agenthud.next")
}
pub(crate) fn caches_dir(home: &Path) -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("AppData/Local"))
}
pub(crate) fn app_support(home: &Path, env: &Environment) -> PathBuf {
    variable(env, "APPDATA", home).unwrap_or_else(|| home.join("AppData/Roaming"))
}
fn local_app(home: &Path, env: &Environment) -> PathBuf {
    variable(env, "LOCALAPPDATA", home).unwrap_or_else(|| home.join("AppData/Local"))
}
pub(crate) fn application_installed(home: &Path, env: &Environment, name: &str) -> bool {
    [
        local_app(home, env).join("Programs"),
        variable(env, "ProgramFiles", home).unwrap_or_else(|| PathBuf::from("C:/Program Files")),
    ]
    .iter()
    .any(|dir| dir.join(name).is_dir())
}
pub(crate) fn registered_bundle(_id: &str) -> bool {
    false
}
pub(crate) fn executable_dirs(home: &Path, env: &Environment) -> Vec<PathBuf> {
    let mut dirs = path_entries(env);
    dirs.extend([
        home.join(".local/bin"),
        home.join(".bun/bin"),
        home.join(".npm-global/bin"),
        app_support(home, env).join("npm"),
        local_app(home, env).join("Microsoft/WinGet/Links"),
    ]);
    dirs
}
pub(crate) fn discovered_executable(path: &Path) -> bool {
    ["exe", "cmd", "bat", "ps1"]
        .iter()
        .any(|extension| path.with_extension(extension).is_file())
        || path.is_file()
}
pub(crate) fn engine_executable(path: &Path) -> bool {
    path.is_file()
        && path.extension().is_some_and(|extension| {
            extension
                .to_str()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        })
}
pub(crate) fn configure_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
}
pub(crate) fn engine_candidates(home: &Path, env: &Environment, name: &str) -> Vec<PathBuf> {
    let mut dirs = vec![
        home.join(".local/bin"),
        home.join(".bun/bin"),
        home.join(".claude/local"),
    ];
    dirs.extend(executable_dirs(home, env));
    let mut candidates: Vec<PathBuf> = dirs
        .into_iter()
        .map(|dir| dir.join(format!("{name}.exe")))
        .collect();
    // ai-one change: installs that leave only a `.cmd` shim in PATH keep the
    // native program elsewhere. Look there too, so the account reader finds it.
    candidates.extend(packaged_engines(home, env, name));
    candidates
}
/// ai-one change: native programs that PATH reaches only through a `.cmd` shim
/// or not at all. Claude Code installed with npm keeps `claude.exe` in its
/// package folder; Codex Desktop keeps `codex.exe` in a hash-named folder.
fn packaged_engines(home: &Path, env: &Environment, name: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    match name {
        "claude" => {
            found.push(
                app_support(home, env)
                    .join("npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
            );
        }
        "codex" => {
            let bin = local_app(home, env).join("OpenAI/Codex/bin");
            if let Ok(entries) = std::fs::read_dir(&bin) {
                let mut folders: Vec<PathBuf> = entries
                    .flatten()
                    .map(|entry| entry.path())
                    .filter(|path| path.is_dir())
                    .collect();
                // Newest first: the most recently updated app folder is current.
                folders.sort_by_key(|path| {
                    std::cmp::Reverse(
                        std::fs::metadata(path)
                            .and_then(|meta| meta.modified())
                            .ok(),
                    )
                });
                found.extend(folders.into_iter().map(|path| path.join("codex.exe")));
            }
        }
        _ => {}
    }
    found
}
pub(crate) fn engine_path(home: &Path, env: &Environment) -> String {
    joined_path(executable_dirs(home, env))
}
pub(crate) fn reveal_transcript(path: &Path) -> Result<(), String> {
    // Preserve literal argv. PowerShell -Command reparses trailing text, so this
    // one native Explorer operation intentionally stays a direct process call.
    let mut command = Command::new("explorer.exe");
    configure_command(&mut command);
    command
        .arg(format!("/select,{}", path.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|_| "Could not reveal transcript".into())
}
pub(crate) fn legacy_quota_database(_home: &Path) -> Option<PathBuf> {
    None
}
// ai-one change (#184): process and port discovery for Antigravity's local
// language server, through PowerShell's CIM and NetTCPIP cmdlets.
fn powershell(script: &str) -> Result<String, String> {
    let mut command = Command::new("powershell.exe");
    configure_command(&mut command);
    let output = command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|_| "Could not list processes".to_owned())?;
    if !output.status.success() {
        return Err("Could not list processes".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
/// An executable path as the Unix readers see one: forward slashes, no `.exe`.
fn unix_like(path: &str) -> String {
    let path = path.replace('\\', "/");
    match path.len().checked_sub(4) {
        Some(at) if path.is_char_boundary(at) && path[at..].eq_ignore_ascii_case(".exe") => path[..at].into(),
        _ => path,
    }
}
fn process_rows(json: &str) -> Vec<ProcessInfo> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json.trim()) else {
        return Vec::new();
    };
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        row @ serde_json::Value::Object(_) => vec![row],
        _ => Vec::new(),
    };
    rows.into_iter()
        .filter_map(|row| {
            Some(ProcessInfo {
                pid: u32::try_from(row["ProcessId"].as_u64()?).ok()?,
                executable: unix_like(row["ExecutablePath"].as_str()?),
                command: row["CommandLine"].as_str()?.to_owned(),
            })
        })
        .collect()
}
pub(crate) fn processes() -> Result<Vec<ProcessInfo>, String> {
    // Command lines are only readable for the user's own processes; others
    // come back without one and are skipped.
    let json = powershell(
        "Get-CimInstance Win32_Process | Where-Object CommandLine | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    )?;
    Ok(process_rows(&json))
}
pub(crate) fn listening_ports(pid: u32) -> Result<Vec<u16>, String> {
    let output = powershell(&format!(
        "Get-NetTCPConnection -OwningProcess {pid} -State Listen -ErrorAction SilentlyContinue | ForEach-Object LocalPort"
    ))?;
    let mut ports = output
        .lines()
        .filter_map(|line| line.trim().parse::<u16>().ok())
        .filter(|port| *port != 0)
        .collect::<Vec<_>>();
    ports.sort_unstable();
    ports.dedup();
    Ok(ports)
}

pub(crate) fn source_roots(home: &Path) -> Vec<agent_hud_core::SourceRoot> {
    super::portable_cli_roots(home)
}

pub(crate) fn open_session_url(url: &str) -> Result<(), String> {
    use std::{
        ffi::{c_void, OsStr},
        os::windows::ffi::OsStrExt,
    };
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            window: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> *mut c_void;
    }
    let operation = "open\0".encode_utf16().collect::<Vec<_>>();
    let url = OsStr::new(url)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    if unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    } as isize
        > 32
    {
        Ok(())
    } else {
        Err("The native client could not open this session".into())
    }
}

/// Swift UserDefaults has no native source on this host.
pub(crate) fn legacy_preferences() -> Result<Option<serde_json::Value>, String> {
    Ok(None)
}

#[cfg(test)]
mod discovery_tests {
    use super::*;

    #[test]
    fn executables_read_like_unix_paths() {
        assert_eq!(
            unix_like(r"C:\Users\me\AppData\Local\Programs\antigravity\resources\bin\language_server.exe"),
            "C:/Users/me/AppData/Local/Programs/antigravity/resources/bin/language_server"
        );
        assert_eq!(unix_like(r"C:\tools\agy.EXE"), "C:/tools/agy");
        assert_eq!(unix_like("x"), "x");
    }

    #[test]
    fn process_rows_take_one_or_many_and_skip_incomplete_ones() {
        let one = r#"{"ProcessId":7,"ExecutablePath":"C:\\a\\agy.exe","CommandLine":"agy --csrf_token t"}"#;
        let rows = process_rows(one);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, 7);
        assert_eq!(rows[0].executable, "C:/a/agy");
        let many = r#"[{"ProcessId":1,"ExecutablePath":null,"CommandLine":"x"},{"ProcessId":2,"ExecutablePath":"b.exe","CommandLine":"b"}]"#;
        assert_eq!(process_rows(many).len(), 1);
        assert!(process_rows("").is_empty());
    }
}

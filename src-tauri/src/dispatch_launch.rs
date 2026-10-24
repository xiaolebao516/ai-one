//! One-click dispatch (Spec #155 C). Starts a coding agent on one Issue, either by opening the
//! agent's desktop client with the hand-over prompt (`desktop`) or by running its command line
//! detached (`cli`).
//!
//! The renderer can only name an agent, a mode, a repository, an Issue number and a working
//! directory. The prompt, the program, its arguments and its environment are all built here from
//! fixed parts, so a compromised control page cannot make ai-one run an arbitrary command.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const MAX_ISSUE: u64 = 9_007_199_254_740_991;
const CLAUDE_MODELS: [&str; 3] = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const DEFAULT_CLAUDE_MODEL: &str = "claude-sonnet-5-5";
const MAX_RUNS: usize = 20;
static LAUNCH_LOCK: Mutex<()> = Mutex::new(());
static NEXT_RUN: AtomicU32 = AtomicU32::new(0);
const LOG_TAIL_BYTES: u64 = 4096;
/// The agent runs with a clean environment: only what a developer tool needs to find its own
/// programs, config and network, plus the GitHub token variables the workflow itself uses. Anything
/// else in ai-one's environment (cloud keys, API keys, a routing proxy for another model) is dropped.
const ENV_ALLOW: [&str; 33] = [
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "USERPROFILE", "HOME", "HOMEDRIVE",
    "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
    "TEMP", "TMP", "USERNAME", "USERDOMAIN", "COMPUTERNAME", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
    "LANG", "LC_ALL", "TERM", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "GH_TOKEN", "GITHUB_TOKEN", "GH_CONFIG_DIR",
];
/// Commands the AGENTS.md workflow needs. Everything else is denied in the unattended run.
const CLAUDE_ALLOW: [&str; 11] = [
    "Bash(git:*)",
    "Bash(gh:*)",
    "Bash(node:*)",
    "Bash(pnpm:*)",
    "Bash(npx:*)",
    "Bash(cargo:*)",
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
];

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchArgs {
    agent: String,
    mode: String,
    repo: String,
    issue: u64,
    workdir: String,
    model: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Agent {
    Claude,
    Codex,
}

impl Agent {
    fn parse(value: &str) -> Option<Agent> {
        match value {
            "claude" => Some(Agent::Claude),
            "codex" => Some(Agent::Codex),
            _ => None,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Agent::Claude => "Claude Code",
            Agent::Codex => "Codex",
        }
    }
}

fn reply(ok: bool, code: &str, message: &str, extra: Value) -> String {
    let mut value = json!({ "ok": ok, "code": code, "message": message });
    if let (Some(target), Some(source)) = (value.as_object_mut(), extra.as_object()) {
        for (key, item) in source {
            target.insert(key.clone(), item.clone());
        }
    }
    value.to_string()
}

fn valid_repo(repo: &str) -> bool {
    let parts: Vec<&str> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 100
                && *part != "."
                && *part != ".."
                && part
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        })
}

/// Pure filter so the rule is testable: names are compared case-insensitively (Windows).
fn filter_env(vars: impl Iterator<Item = (OsString, OsString)>) -> Vec<(OsString, OsString)> {
    vars.filter(|(name, _)| {
        let upper = name.to_string_lossy().to_uppercase();
        ENV_ALLOW.contains(&upper.as_str())
    })
    .collect()
}

fn child_env() -> Vec<(OsString, OsString)> {
    filter_env(std::env::vars_os())
}

/// A helper process (git, gh, node) with the same clean environment and no console window.
fn helper(program: &Path) -> Command {
    let mut command = Command::new(program);
    command.env_clear().envs(child_env()).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn run_text(command: &mut Command) -> Option<String> {
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// "owner/name" (lower-case) from an https, ssh or scp-style GitHub remote URL.
fn repo_from_remote(url: &str) -> Option<String> {
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let rest = ["https://github.com/", "http://github.com/", "ssh://git@github.com/", "git@github.com:"]
        .iter()
        .find_map(|prefix| url.strip_prefix(prefix))?;
    let repo = rest.to_lowercase();
    valid_repo(&repo).then_some(repo)
}

/// The checkout must really be a clone of the repository the prompt names; marker files alone do not
/// prove that. Anything unreadable counts as a mismatch.
fn workdir_matches_repo(workdir: &Path, repo: &str) -> bool {
    let Some(git) = find_on_path(if cfg!(windows) { &["git.exe"] } else { &["git"] }) else { return false };
    let mut command = helper(&git);
    command.args(["-C"]).arg(workdir).args(["config", "--get", "remote.origin.url"]);
    run_text(&mut command)
        .and_then(|url| repo_from_remote(&url))
        .is_some_and(|found| found == repo.to_lowercase())
}

fn same_login(author: &str, me: &str) -> bool {
    !author.trim().is_empty() && author.trim().eq_ignore_ascii_case(me.trim())
}

/// An unattended agent reads the Issue as its instructions, and this repository is public: only an
/// Issue written by the signed-in GitHub user may be dispatched to the command line.
fn issue_written_by_me(repo: &str, issue: u64) -> bool {
    let Some(gh) = find_on_path(if cfg!(windows) { &["gh.exe"] } else { &["gh"] }) else { return false };
    let mut author = helper(&gh);
    author.args(["api", "--hostname", "github.com", &format!("repos/{repo}/issues/{issue}"), "--jq", "select(.pull_request == null) | .user.login"]);
    let mut me = helper(&gh);
    me.args(["api", "--hostname", "github.com", "user", "--jq", ".login"]);
    match (run_text(&mut author), run_text(&mut me)) {
        (Some(author), Some(me)) => same_login(&author, &me),
        _ => false,
    }
}

fn next_session() -> String {
    format!("dispatch-{}-{}", unix_millis(), NEXT_RUN.fetch_add(1, Ordering::SeqCst))
}

fn agent_id(agent: Agent, session: &str) -> String {
    format!("{} / {}", agent.label(), session)
}

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

/// The hand-over prompt. Fixed wording; only the repository, Issue number and a session tag vary.
fn build_prompt(repo: &str, issue: u64, agent: Agent, session: &str) -> String {
    format!(
        "按 AGENTS.md 快速开发模式接手 {repo} 的 Issue #{issue}。先在仓库根目录运行：node scripts/agent-entry/cli.mjs take {issue} --agent \"{id}\"；认领成功（退出码 0）才按输出开工，退出码 2 表示已被别人认领，立即停手。全程遵守 AGENTS.md，做完在 Issue 留一段说人话的总结。",
        id = agent_id(agent, session)
    )
}

fn pct_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn client_url(agent: Agent, prompt: &str, workdir: &Path) -> String {
    match agent {
        Agent::Claude => format!(
            "claude://code/new?q={}&folder={}",
            pct_encode(prompt),
            pct_encode(&workdir.to_string_lossy())
        ),
        Agent::Codex => format!(
            "codex://threads/new?prompt={}",
            pct_encode(&format!("（在 {} 目录工作）{prompt}", workdir.to_string_lossy()))
        ),
    }
}

fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => path,
    }
}

/// The working directory must be an existing checkout of this project: AGENTS.md and the
/// agent-entry script are what the hand-over prompt relies on.
fn resolve_workdir(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() || raw.len() > 1024 {
        return Err("workdir is empty or too long".to_string());
    }
    if raw.trim().starts_with(r"\\") || raw.trim().starts_with("//") {
        return Err("network folders are not allowed".to_string());
    }
    let path = fs::canonicalize(raw.trim()).map_err(|error| error.to_string())?;
    let path = strip_verbatim(path);
    if path.to_string_lossy().starts_with(r"\\") {
        return Err("network folders are not allowed".to_string());
    }
    if !path.is_dir()
        || !path.join(".git").exists()
        || !path.join("AGENTS.md").is_file()
        || !path.join("scripts").join("agent-entry").join("cli.mjs").is_file()
    {
        return Err("workdir is not an ai-one checkout".to_string());
    }
    Ok(path)
}

/// A git worktree has a `.git` *file* ("gitdir: <main>/.git/worktrees/<name>"); the main checkout is
/// the folder that owns that `.git` directory. Anything unexpected keeps the folder as it is.
fn main_checkout(root: &Path) -> PathBuf {
    let Ok(text) = fs::read_to_string(root.join(".git")) else { return root.to_path_buf() };
    let Some(gitdir) = text.trim().strip_prefix("gitdir:").map(|rest| PathBuf::from(rest.trim())) else {
        return root.to_path_buf();
    };
    let main = gitdir
        .parent()
        .filter(|dir| dir.file_name().is_some_and(|name| name == "worktrees"))
        .and_then(Path::parent)
        .filter(|dir| dir.file_name().is_some_and(|name| name == ".git"))
        .and_then(Path::parent);
    match main {
        Some(path) if path.join("AGENTS.md").is_file() => path.to_path_buf(),
        _ => root.to_path_buf(),
    }
}

fn claude_settings() -> String {
    json!({ "permissions": { "defaultMode": "acceptEdits", "allow": CLAUDE_ALLOW } }).to_string()
}

fn claude_args(model: &str, settings: &Path) -> Vec<String> {
    vec![
        "-p".into(),
        "--setting-sources".into(),
        "project,local".into(),
        "--settings".into(),
        settings.to_string_lossy().to_string(),
        "--model".into(),
        model.into(),
    ]
}

fn codex_args() -> Vec<String> {
    vec![
        "exec".into(),
        "-s".into(),
        "workspace-write".into(),
        "-c".into(),
        "sandbox_workspace_write.network_access=true".into(),
        "-".into(),
    ]
}

fn find_on_path(names: &[&str]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn find_program(agent: Agent) -> Option<PathBuf> {
    match agent {
        Agent::Claude => find_on_path(if cfg!(windows) {
            &["claude.exe", "claude.cmd"]
        } else {
            &["claude"]
        }),
        Agent::Codex => find_on_path(if cfg!(windows) {
            &["codex.exe", "codex.cmd"]
        } else {
            &["codex"]
        })
        .or_else(find_packaged_codex),
    }
}

/// The Codex desktop app ships its own `codex.exe` inside the app package.
fn find_packaged_codex() -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    let root = Path::new(r"C:\Program Files\WindowsApps");
    let mut found: Vec<PathBuf> = fs::read_dir(root)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("OpenAI.Codex_"))
        .map(|entry| entry.path().join("app").join("resources").join("codex.exe"))
        .filter(|path| path.is_file())
        .collect();
    found.sort();
    found.pop()
}

/// One lock file per repo+Issue in a folder shared by every ai-one instance of this Windows user, so
/// two instances (even with different app-data folders) cannot start the same Issue twice.
fn lock_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("ai-one")
        .join("dispatch-locks")
}

fn lock_file(dir: &Path, repo: &str, issue: u64) -> PathBuf {
    dir.join(format!("{}-{issue}.lock", repo.to_lowercase().replace('/', "__")))
}

/// An OS-held exclusive lock on the Issue's lock file. The operating system releases it when the
/// handle closes or the owning process dies, so there is no stale-lock guessing, no deleting and no
/// ownership race. The file itself is never removed.
struct IssueLock {
    _file: fs::File,
}

/// `Ok(None)` means another live ai-one dispatch holds the Issue. The lock is held (and so the Issue
/// stays busy) until the launched agent exits; if ai-one itself dies the lock is released, and the
/// agent's own claim lock (`take`) remains the safety net against a second worker.
// `File::try_lock` is stable since Rust 1.89 (CI builds on current stable). The crate-wide
// `rust-version` is left alone on purpose: raising it would turn on unrelated lints in other modules.
#[allow(clippy::incompatible_msrv)]
fn acquire_issue_lock(dir: &Path, repo: &str, issue: u64) -> Result<Option<IssueLock>, String> {
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_file(dir, repo, issue))
        .map_err(|error| error.to_string())?;
    match file.try_lock() {
        Ok(()) => Ok(Some(IssueLock { _file: file })),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(error)) => Err(error.to_string()),
    }
}

/// Hands the running child and its Issue lock to a waiter that records the exit and only then lets
/// the Issue go. `start` runs the waiter; if it cannot be started (a thread cannot be created) the
/// child is killed and reaped here, so the lock is never released while the agent is still running.
fn supervise<F>(child: Child, lock: IssueLock, exit_path: PathBuf, start: F) -> Result<(), String>
where
    F: FnOnce(Box<dyn FnOnce() + Send + 'static>) -> std::io::Result<()>,
{
    let slot = Arc::new(Mutex::new(Some((child, lock))));
    let worker = Arc::clone(&slot);
    let exit_for_worker = exit_path.clone();
    let job: Box<dyn FnOnce() + Send + 'static> = Box::new(move || {
        let held = worker.lock().ok().and_then(|mut guard| guard.take());
        if let Some((mut child, lock)) = held {
            let code = child.wait().ok().and_then(|status| status.code()).unwrap_or(-1);
            let _ = fs::write(exit_for_worker, code.to_string());
            // Held until the agent is done, so the Issue stays busy for exactly that long.
            drop(lock);
        }
    });
    if let Err(error) = start(job) {
        if let Some((mut child, lock)) = slot.lock().ok().and_then(|mut guard| guard.take()) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::write(&exit_path, "-1");
            drop(lock);
        }
        return Err(error.to_string());
    }
    Ok(())
}

/// Everything after `spawn` goes through here: if the prompt cannot be delivered or the run cannot be
/// recorded, the already-running child is killed and reaped before the caller gives the Issue lock
/// back, so a launch is either fully tracked or not running at all.
fn finish_launch(
    child: &mut Child,
    prompt: &str,
    record: impl FnOnce() -> std::io::Result<()>,
) -> Result<(), String> {
    let delivered = match child.stdin.take() {
        // The prompt travels on stdin so no shell or argument quoting can alter it.
        Some(mut stdin) => stdin.write_all(prompt.as_bytes()).and_then(|()| stdin.flush()),
        None => Err(std::io::Error::other("no stdin")),
    };
    let result = delivered.and_then(|()| record());
    if let Err(error) = result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.to_string());
    }
    Ok(())
}

fn dispatch_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("dispatch"))
}

fn pid_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .creation_flags(0x0800_0000)
            .output();
        match output {
            Ok(out) => String::from_utf8_lossy(&out.stdout).contains(&format!("\"{pid}\"")),
            Err(_) => false,
        }
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

fn launch_cli(
    app: &AppHandle,
    args: &LaunchArgs,
    agent: Agent,
    workdir: &Path,
    prompt: &str,
    session: &str,
) -> Result<String, String> {
    let Some(program) = find_program(agent) else {
        return Ok(reply(false, "program_not_found", "找不到该 agent 的命令行程序", json!({})));
    };
    let dir = dispatch_dir(app)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    // One launch at a time: the "already running" check and the spawn must not interleave.
    let _guard = LAUNCH_LOCK.lock().map_err(|_| "dispatch lock poisoned".to_string())?;
    if let Some(existing) = read_all_runs(&dir).iter().find(|run| {
        run["state"] == "running"
            && run["repo"].as_str().is_some_and(|repo| repo.eq_ignore_ascii_case(&args.repo))
            && run["issue"].as_u64() == Some(args.issue)
    }) {
        return Ok(reply(false, "already_running", "这个 Issue 已有一个运行中的派工", json!({ "runId": existing["runId"] })));
    }
    let Some(lock) = acquire_issue_lock(&lock_dir(), &args.repo, args.issue)? else {
        return Ok(reply(false, "already_running", "这个 Issue 已有一个运行中的派工（可能来自另一个 ai-one 窗口）", json!({})));
    };
    let run_id = session.to_string();
    let log_path = dir.join(format!("{run_id}.log"));
    let log = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&log_path)
        .map_err(|error| error.to_string())?;
    let log_err = log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(&program);
    match agent {
        Agent::Claude => {
            let model = args.model.as_deref().unwrap_or(DEFAULT_CLAUDE_MODEL);
            let settings = dir.join(format!("{run_id}.settings.json"));
            fs::write(&settings, claude_settings()).map_err(|error| error.to_string())?;
            command.args(claude_args(model, &settings));
        }
        Agent::Codex => {
            command.args(codex_args());
        }
    }
    command
        .env_clear()
        .envs(child_env())
        .current_dir(workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP: no console flash, outlives a Ctrl+C in ai-one.
        command.creation_flags(0x0800_0200);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return Ok(reply(false, "spawn_failed", "命令行程序启动失败", json!({}))),
    };
    let pid = child.id();
    let meta = json!({
        "runId": run_id, "agent": args.agent, "mode": "cli", "repo": args.repo, "issue": args.issue,
        "pid": pid, "startedAt": unix_millis() as u64, "logPath": log_path.to_string_lossy(),
    });
    let meta_path = dir.join(format!("{run_id}.json"));
    if finish_launch(&mut child, prompt, || fs::write(&meta_path, meta.to_string())).is_err() {
        return Ok(reply(false, "spawn_failed", "命令行程序没能收到任务或运行记录写入失败，已停止它", json!({})));
    }
    let exit_path = dir.join(format!("{run_id}.exit"));
    let started = supervise(child, lock, exit_path, |job| {
        std::thread::Builder::new().name("dispatch-wait".into()).spawn(job).map(|_| ())
    });
    if started.is_err() {
        return Ok(reply(false, "spawn_failed", "无法监护命令行程序，已停止它", json!({})));
    }
    prune_old_runs(&dir);
    let watching = start_claim_watch(workdir, args.issue, &agent_id(agent, session), pid);
    Ok(reply(
        true,
        "launched",
        "已在后台启动",
        json!({ "runId": run_id, "pid": pid, "prompt": prompt, "watching": watching }),
    ))
}

/// Keeps the claim's heartbeat alive only while the launched process is alive (scripts/issue-claim).
/// Best effort: without it the claim merely looks silent after the default window, it is never lost.
fn start_claim_watch(workdir: &Path, issue: u64, agent: &str, pid: u32) -> bool {
    let Some(node) = find_on_path(if cfg!(windows) { &["node.exe"] } else { &["node"] }) else { return false };
    let mut command = helper(&node);
    command
        .args(["scripts/issue-claim/dispatch-watch.mjs", &issue.to_string(), agent, &pid.to_string()])
        .current_dir(workdir)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0200);
    }
    match command.spawn() {
        Ok(mut child) => {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            true
        }
        Err(_) => false,
    }
}

fn prune_old_runs(dir: &Path) {
    let mut metas: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.extension().is_some_and(|ext| ext == "json") && !is_settings(path))
            .collect(),
        Err(_) => return,
    };
    metas.sort();
    let mut index = 0;
    while metas.len() - index > MAX_RUNS * 2 {
        let old = metas[index].clone();
        index += 1;
        let still_going = !old.with_extension("exit").exists()
            && fs::read_to_string(&old)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .and_then(|meta| meta.get("pid").and_then(Value::as_u64))
                .and_then(|pid| u32::try_from(pid).ok())
                .is_some_and(pid_alive);
        if still_going {
            continue;
        }
        let stem = old.with_extension("");
        for extension in ["json", "log", "exit", "settings.json"] {
            let _ = fs::remove_file(PathBuf::from(format!("{}.{extension}", stem.to_string_lossy())));
        }
    }
}

fn is_settings(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.to_string_lossy().ends_with(".settings.json"))
}

fn tail(path: &Path) -> String {
    let Ok(mut file) = fs::File::open(path) else { return String::new() };
    let length = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let start = length.saturating_sub(LOG_TAIL_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    let _ = file.take(LOG_TAIL_BYTES).read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).to_string()
}

/// The list shown to the user: the newest runs only.
fn read_runs(dir: &Path) -> Vec<Value> {
    read_runs_limited(dir, MAX_RUNS)
}

/// Every recorded run, for the "is this Issue already running" check.
fn read_all_runs(dir: &Path) -> Vec<Value> {
    read_runs_limited(dir, usize::MAX)
}

fn read_runs_limited(dir: &Path, limit: usize) -> Vec<Value> {
    let mut metas: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.extension().is_some_and(|ext| ext == "json") && !is_settings(path))
            .collect(),
        Err(_) => return Vec::new(),
    };
    metas.sort();
    metas.reverse();
    metas.truncate(limit);
    metas
        .into_iter()
        .filter_map(|path| {
            let mut meta: Value = serde_json::from_str(&fs::read_to_string(&path).ok()?).ok()?;
            let exit = fs::read_to_string(path.with_extension("exit")).ok();
            let pid = meta.get("pid").and_then(Value::as_u64).and_then(|pid| u32::try_from(pid).ok());
            let (state, code) = match (&exit, pid) {
                (Some(code), _) => ("exited", code.trim().parse::<i64>().ok()),
                (None, Some(pid)) if pid_alive(pid) => ("running", None),
                _ => ("lost", None),
            };
            let log = meta.get("logPath").and_then(Value::as_str).map(PathBuf::from);
            let object = meta.as_object_mut()?;
            object.insert("state".into(), json!(state));
            object.insert("exitCode".into(), json!(code));
            object.insert("tail".into(), json!(log.map(|log| tail(&log)).unwrap_or_default()));
            Some(meta)
        })
        .collect()
}

#[tauri::command]
pub fn dispatch_launch(app: AppHandle, webview: tauri::Webview, args: LaunchArgs) -> Result<String, String> {
    crate::webviews::ensure_control_webview(&webview)?;
    let invalid = |message: &str| Ok(reply(false, "invalid_input", message, json!({})));
    let Some(agent) = Agent::parse(&args.agent) else { return invalid("未知的 agent") };
    if args.mode != "desktop" && args.mode != "cli" {
        return invalid("未知的派工方式");
    }
    if !valid_repo(&args.repo) || args.issue == 0 || args.issue > MAX_ISSUE {
        return invalid("仓库或 Issue 编号不合法");
    }
    if let Some(model) = &args.model {
        if agent != Agent::Claude || !CLAUDE_MODELS.contains(&model.as_str()) {
            return invalid("不支持的模型");
        }
    }
    let workdir = match resolve_workdir(&args.workdir) {
        Ok(path) => path,
        Err(_) => {
            return Ok(reply(false, "workdir_invalid", "工作目录不是 ai-one 仓库（需含 AGENTS.md）", json!({})))
        }
    };
    if !workdir_matches_repo(&workdir, &args.repo) {
        return Ok(reply(false, "workdir_invalid", "工作目录不是这个仓库的检出（origin 不一致）", json!({})));
    }
    if args.mode == "cli" && !issue_written_by_me(&args.repo, args.issue) {
        return Ok(reply(false, "issue_unverified", "命令行派工只接受你自己创建的 Issue（无法核实作者）", json!({})));
    }
    let session = next_session();
    let prompt = build_prompt(&args.repo, args.issue, agent, &session);
    if args.mode == "desktop" {
        let url = client_url(agent, &prompt, &workdir);
        return match app.opener().open_url(url, None::<&str>) {
            Ok(()) => Ok(reply(true, "opened", "已打开桌面客户端", json!({ "prompt": prompt }))),
            Err(_) => Ok(reply(false, "open_failed", "无法打开桌面客户端", json!({ "prompt": prompt }))),
        };
    }
    launch_cli(&app, &args, agent, &workdir, &prompt, &session)
}

#[derive(Serialize)]
struct RunsReply {
    runs: Vec<Value>,
    #[serde(rename = "defaultWorkdir")]
    default_workdir: Option<String>,
}

#[tauri::command]
pub fn dispatch_runs(app: AppHandle, webview: tauri::Webview) -> Result<String, String> {
    crate::webviews::ensure_control_webview(&webview)?;
    let dir = dispatch_dir(&app)?;
    // Prefer the main checkout over the task worktree this build came from: desktop clients ask to
    // trust every new folder once, and the main checkout is the one the user already trusts.
    let default_workdir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(main_checkout)
        .and_then(|root| resolve_workdir(&root.to_string_lossy()).ok())
        .map(|path| path.to_string_lossy().to_string());
    serde_json::to_string(&RunsReply { runs: read_runs(&dir), default_workdir })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tests run in parallel, so every scratch folder gets a process-unique name.
    fn unique(label: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        std::env::temp_dir().join(format!("ai-one-dispatch-{label}-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)))
    }

    fn temp_checkout() -> PathBuf {
        let root = unique("checkout");
        fs::create_dir_all(root.join("scripts").join("agent-entry")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("AGENTS.md"), "x").unwrap();
        fs::write(root.join("scripts").join("agent-entry").join("cli.mjs"), "x").unwrap();
        root
    }

    #[test]
    fn repo_names_are_strictly_owner_slash_name() {
        assert!(valid_repo("xiaolebao516/ai-one"));
        assert!(!valid_repo("a/b/c"));
        assert!(!valid_repo("../x"));
        assert!(!valid_repo("a/.."));
        assert!(!valid_repo("a b/c"));
        assert!(!valid_repo("a/c;rm"));
        assert!(!valid_repo(""));
    }

    #[test]
    fn prompt_is_fixed_wording_with_only_repo_issue_and_session() {
        let prompt = build_prompt("o/r", 42, Agent::Claude, "dispatch-1");
        assert!(prompt.contains("o/r 的 Issue #42"));
        assert!(prompt.contains("take 42 --agent \"Claude Code / dispatch-1\""));
        assert!(prompt.contains("退出码 2"));
    }

    #[test]
    fn url_parts_are_percent_encoded() {
        assert_eq!(pct_encode("a b&c=中"), "a%20b%26c%3D%E4%B8%AD");
        let url = client_url(Agent::Claude, "x&folder=evil", Path::new("D:\\a b"));
        assert!(url.starts_with("claude://code/new?q=x%26folder%3Devil&folder=D%3A%5Ca%20b"));
        assert_eq!(url.matches("&folder=").count(), 1);
        let codex = client_url(Agent::Codex, "p", Path::new("/w"));
        assert!(codex.starts_with("codex://threads/new?prompt="));
        assert!(!codex.contains("&"));
    }

    #[test]
    fn workdir_must_be_an_ai_one_checkout() {
        let root = temp_checkout();
        assert!(resolve_workdir(&root.to_string_lossy()).is_ok());
        assert!(resolve_workdir("").is_err());
        assert!(resolve_workdir(&std::env::temp_dir().to_string_lossy()).is_err());
        assert!(resolve_workdir(&root.join("missing").to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remotes_resolve_to_owner_slash_name_and_foreign_hosts_do_not() {
        for url in ["https://github.com/Owner/Repo.git", "git@github.com:owner/repo.git", "ssh://git@github.com/owner/repo", "https://github.com/owner/repo/"] {
            assert_eq!(repo_from_remote(url).as_deref(), Some("owner/repo"), "{url}");
        }
        assert_eq!(repo_from_remote("https://evil.example/owner/repo.git"), None);
        assert_eq!(repo_from_remote("https://github.com/owner/repo/extra"), None);
        assert_eq!(repo_from_remote(""), None);
    }

    #[test]
    fn network_folders_and_plain_folders_are_refused() {
        assert!(resolve_workdir(r"\\server\share\ai-one").is_err());
        assert!(resolve_workdir("//server/share/ai-one").is_err());
        let plain = unique("plain");
        fs::create_dir_all(plain.join("scripts").join("agent-entry")).unwrap();
        fs::write(plain.join("AGENTS.md"), "x").unwrap();
        fs::write(plain.join("scripts").join("agent-entry").join("cli.mjs"), "x").unwrap();
        assert!(resolve_workdir(&plain.to_string_lossy()).is_err(), "marker files without .git must not pass");
        let _ = fs::remove_dir_all(plain);
    }

    #[test]
    fn only_a_short_allowlist_of_environment_reaches_the_agent() {
        let vars = [("Path", "p"), ("GH_TOKEN", "t"), ("AWS_SECRET_ACCESS_KEY", "s"), ("ANTHROPIC_AUTH_TOKEN", "a"), ("ANTHROPIC_BASE_URL", "b"), ("OPENAI_API_KEY", "o")]
            .map(|(name, value)| (OsString::from(name), OsString::from(value)));
        let kept: Vec<String> = filter_env(vars.into_iter()).into_iter().map(|(name, _)| name.to_string_lossy().to_string()).collect();
        assert_eq!(kept, vec!["Path".to_string(), "GH_TOKEN".to_string()]);
    }

    #[test]
    fn only_the_signed_in_user_counts_as_the_issue_author() {
        assert!(same_login("Octo", "octo"));
        assert!(!same_login("someone-else", "octo"));
        assert!(!same_login("", ""));
    }

    #[test]
    fn the_issue_lock_is_os_exclusive_and_released_with_its_holder() {
        let dir = unique("locks");
        let first = acquire_issue_lock(&dir, "O/R", 7).unwrap().expect("first caller gets the lock");
        assert!(acquire_issue_lock(&dir, "o/r", 7).unwrap().is_none(), "same Issue, any letter case, is busy");
        assert!(acquire_issue_lock(&dir, "o/r", 8).unwrap().is_some(), "another Issue is independent");
        drop(first);
        let again = acquire_issue_lock(&dir, "o/r", 7).unwrap();
        assert!(again.is_some(), "the lock is free as soon as its holder lets go");
        assert!(lock_file(&dir, "o/r", 7).exists(), "the lock file is never deleted, so no one can delete a live lock");
        drop(again);
        let _ = fs::remove_dir_all(dir);
    }

    fn sleeper() -> Child {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("ping");
            command.args(["-n", "30", "127.0.0.1"]);
            command
        } else {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        };
        command.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        command.spawn().expect("spawn a harmless long-running child")
    }

    #[test]
    fn a_launch_that_cannot_be_recorded_kills_the_child_instead_of_leaving_it_unmonitored() {
        let mut child = sleeper();
        let result = finish_launch(&mut child, "prompt", || Err(std::io::Error::other("disk full")));
        assert!(result.is_err());
        assert!(child.try_wait().unwrap().is_some(), "the child must be gone");
    }

    #[test]
    fn a_launch_without_a_writable_stdin_is_rolled_back_too() {
        let mut child = sleeper();
        drop(child.stdin.take());
        let result = finish_launch(&mut child, "prompt", || Ok(()));
        assert!(result.is_err());
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn a_waiter_that_cannot_start_kills_the_child_and_frees_the_lock_only_afterwards() {
        let dir = unique("waiter");
        let lock = acquire_issue_lock(&dir, "o/r", 9).unwrap().unwrap();
        let child = sleeper();
        let child_pid = child.id();
        let exit_path = dir.join("run.exit");
        let result = supervise(child, lock, exit_path.clone(), |_job| Err(std::io::Error::other("cannot create thread")));
        assert!(result.is_err());
        assert!(!pid_alive(child_pid), "the agent must not be left running");
        assert_eq!(fs::read_to_string(&exit_path).unwrap(), "-1");
        assert!(acquire_issue_lock(&dir, "o/r", 9).unwrap().is_some(), "the lock is released after the child is gone");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_started_waiter_records_the_exit_then_releases_the_lock() {
        let dir = unique("waiter-ok");
        let lock = acquire_issue_lock(&dir, "o/r", 9).unwrap().unwrap();
        let mut child = sleeper();
        let _ = child.kill();
        let exit_path = dir.join("run.exit");
        let (tx, rx) = std::sync::mpsc::channel();
        let result = supervise(child, lock, exit_path.clone(), move |job| {
            std::thread::spawn(move || { job(); let _ = tx.send(()); });
            Ok(())
        });
        assert!(result.is_ok());
        rx.recv_timeout(std::time::Duration::from_secs(20)).expect("waiter finished");
        assert!(exit_path.exists());
        assert!(acquire_issue_lock(&dir, "o/r", 9).unwrap().is_some());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_fully_tracked_launch_keeps_the_child_running() {
        let mut child = sleeper();
        assert!(finish_launch(&mut child, "prompt", || Ok(())).is_ok());
        assert!(child.try_wait().unwrap().is_none());
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn a_running_run_older_than_the_visible_list_is_still_found_and_never_pruned() {
        let dir = unique("many");
        fs::create_dir_all(&dir).unwrap();
        let me = std::process::id();
        fs::write(dir.join("dispatch-001-0.json"), json!({"runId":"dispatch-001-0","repo":"o/r","issue":5,"pid":me,"logPath":"x"}).to_string()).unwrap();
        for index in 2..(MAX_RUNS * 2 + 10) {
            let id = format!("dispatch-{index:03}-0");
            fs::write(dir.join(format!("{id}.json")), json!({"runId":id,"repo":"o/r","issue":900,"pid":4294967295u64,"logPath":"x"}).to_string()).unwrap();
            fs::write(dir.join(format!("{id}.exit")), "0").unwrap();
        }
        assert!(read_runs(&dir).iter().all(|run| run["issue"] != 5), "the UI list is limited");
        assert!(read_all_runs(&dir).iter().any(|run| run["issue"] == 5 && run["state"] == "running"));
        prune_old_runs(&dir);
        assert!(dir.join("dispatch-001-0.json").exists(), "a live run's record survives pruning");
        assert!(!dir.join("dispatch-002-0.json").exists(), "finished old records are removed");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn run_ids_never_repeat_even_within_one_millisecond() {
        let ids: std::collections::HashSet<String> = (0..500).map(|_| next_session()).collect();
        assert_eq!(ids.len(), 500);
    }

    #[test]
    fn a_task_worktree_resolves_to_the_main_checkout() {
        let main = temp_checkout();
        fs::create_dir_all(main.join(".git").join("worktrees").join("w1")).unwrap();
        let tree = unique("wt");
        fs::create_dir_all(&tree).unwrap();
        let gitdir = main.join(".git").join("worktrees").join("w1");
        fs::write(tree.join(".git"), format!("gitdir: {}\n", gitdir.to_string_lossy())).unwrap();
        assert_eq!(main_checkout(&tree), main);
        // A normal checkout, a missing .git and a pointer outside a worktrees dir all stay as they are.
        assert_eq!(main_checkout(&main), main);
        fs::write(tree.join(".git"), "gitdir: /somewhere/else\n").unwrap();
        assert_eq!(main_checkout(&tree), tree);
        let _ = fs::remove_dir_all(main);
        let _ = fs::remove_dir_all(tree);
    }

    #[test]
    fn claude_run_ignores_user_settings_and_never_puts_the_prompt_in_args() {
        let args = claude_args("claude-sonnet-5-5", Path::new("s.json"));
        assert_eq!(args[0], "-p");
        assert!(args.windows(2).any(|pair| pair == ["--setting-sources", "project,local"]));
        assert!(args.windows(2).any(|pair| pair == ["--model", "claude-sonnet-5-5"]));
        assert!(args.iter().all(|arg| !arg.contains("Issue")));
        let settings: Value = serde_json::from_str(&claude_settings()).unwrap();
        assert_eq!(settings["permissions"]["defaultMode"], "acceptEdits");
        let allow = settings["permissions"]["allow"].as_array().unwrap();
        assert!(allow.iter().any(|entry| entry == "Bash(gh:*)"));
        assert!(!allow.iter().any(|entry| entry == "Bash"));
    }

    #[test]
    fn codex_run_reads_the_prompt_from_stdin_in_a_workspace_sandbox() {
        let args = codex_args();
        assert_eq!(args.first().map(String::as_str), Some("exec"));
        assert_eq!(args.last().map(String::as_str), Some("-"));
        assert!(args.windows(2).any(|pair| pair == ["-s", "workspace-write"]));
        assert!(!args.iter().any(|arg| arg.contains("danger") || arg.contains("bypass")));
    }

    #[test]
    fn runs_report_exit_running_or_lost_and_tail_the_log() {
        let dir = unique("runs");
        fs::create_dir_all(&dir).unwrap();
        let log = dir.join("r1.log");
        fs::write(&log, "hello log").unwrap();
        fs::write(
            dir.join("r1.json"),
            json!({"runId":"r1","pid":4294967295u64,"logPath":log.to_string_lossy()}).to_string(),
        )
        .unwrap();
        fs::write(dir.join("r1.exit"), "0").unwrap();
        fs::write(
            dir.join("r2.json"),
            json!({"runId":"r2","pid":4294967295u64,"logPath":"missing"}).to_string(),
        )
        .unwrap();
        fs::write(dir.join("r1.settings.json"), "{}").unwrap();
        let runs = read_runs(&dir);
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[1]["state"], "exited");
        assert_eq!(runs[1]["exitCode"], 0);
        assert_eq!(runs[1]["tail"], "hello log");
        assert_eq!(runs[0]["state"], "lost");
        let _ = fs::remove_dir_all(dir);
    }
}

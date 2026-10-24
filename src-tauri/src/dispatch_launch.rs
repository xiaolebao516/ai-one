//! One-click dispatch (Spec #155 C). Starts a coding agent on one Issue, either by opening the
//! agent's desktop client with the hand-over prompt (`desktop`) or by running its command line
//! detached (`cli`).
//!
//! The renderer can only name an agent, a mode, a repository, an Issue number and a working
//! directory. The prompt, the program, its arguments and its environment are all built here from
//! fixed parts, so a compromised control page cannot make ai-one run an arbitrary command.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const MAX_ISSUE: u64 = 9_007_199_254_740_991;
const CLAUDE_MODELS: [&str; 3] = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const DEFAULT_CLAUDE_MODEL: &str = "claude-sonnet-5-5";
const MAX_RUNS: usize = 20;
const LOG_TAIL_BYTES: u64 = 4096;
/// `~/.claude/settings.json` may route the command line through a local proxy or another model.
/// The dispatched run must use the account's own Claude, so these are removed from its environment.
const CLAUDE_ENV_REMOVE: [&str; 9] = [
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDECODE",
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

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

/// The hand-over prompt. Fixed wording; only the repository, Issue number and a session tag vary.
fn build_prompt(repo: &str, issue: u64, agent: Agent, session: &str) -> String {
    format!(
        "按 AGENTS.md 快速开发模式接手 {repo} 的 Issue #{issue}。先在仓库根目录运行：node scripts/agent-entry/cli.mjs take {issue} --agent \"{label} / {session}\"；认领成功（退出码 0）才按输出开工，退出码 2 表示已被别人认领，立即停手。全程遵守 AGENTS.md，做完在 Issue 留一段说人话的总结。",
        label = agent.label()
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
    let path = fs::canonicalize(raw.trim()).map_err(|error| error.to_string())?;
    let path = strip_verbatim(path);
    if !path.is_dir()
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
    let run_id = session.to_string();
    let log_path = dir.join(format!("{run_id}.log"));
    let log = fs::File::create(&log_path).map_err(|error| error.to_string())?;
    let log_err = log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(&program);
    match agent {
        Agent::Claude => {
            let model = args.model.as_deref().unwrap_or(DEFAULT_CLAUDE_MODEL);
            let settings = dir.join(format!("{run_id}.settings.json"));
            fs::write(&settings, claude_settings()).map_err(|error| error.to_string())?;
            command.args(claude_args(model, &settings));
            for name in CLAUDE_ENV_REMOVE {
                command.env_remove(name);
            }
        }
        Agent::Codex => {
            command.args(codex_args());
        }
    }
    command
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
    if let Some(mut stdin) = child.stdin.take() {
        // The prompt travels on stdin so no shell or argument quoting can alter it.
        let _ = stdin.write_all(prompt.as_bytes());
    }
    let meta = json!({
        "runId": run_id, "agent": args.agent, "mode": "cli", "repo": args.repo, "issue": args.issue,
        "pid": pid, "startedAt": unix_millis() as u64, "logPath": log_path.to_string_lossy(),
    });
    fs::write(dir.join(format!("{run_id}.json")), meta.to_string()).map_err(|error| error.to_string())?;
    let exit_path = dir.join(format!("{run_id}.exit"));
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|status| status.code()).unwrap_or(-1);
        let _ = fs::write(exit_path, code.to_string());
    });
    prune_old_runs(&dir);
    Ok(reply(
        true,
        "launched",
        "已在后台启动",
        json!({ "runId": run_id, "pid": pid, "prompt": prompt }),
    ))
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
    while metas.len() > MAX_RUNS * 2 {
        let old = metas.remove(0);
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

fn read_runs(dir: &Path) -> Vec<Value> {
    let mut metas: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.extension().is_some_and(|ext| ext == "json") && !is_settings(path))
            .collect(),
        Err(_) => return Vec::new(),
    };
    metas.sort();
    metas.reverse();
    metas.truncate(MAX_RUNS);
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
    let session = format!("dispatch-{}", unix_millis());
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
        assert!(CLAUDE_ENV_REMOVE.contains(&"ANTHROPIC_BASE_URL"));
        assert!(CLAUDE_ENV_REMOVE.contains(&"ANTHROPIC_AUTH_TOKEN"));
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

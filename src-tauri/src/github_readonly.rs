//! Read-only GitHub bridge for the task HUD (#51, Spec #50 v1).
//!
//! Mirrors `scripts/task-status/github.mjs`: the control pane may ask for exactly the four GET
//! endpoints `collectSnapshot` uses, plus one fixed GraphQL query (built here, never taken from the
//! frontend). Everything runs through the locally authenticated `gh` with an argument vector (no
//! shell), a timeout and an output cap. gh's stderr is never returned: it can contain account
//! details or server-supplied text.

use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};

const GH_PROGRAM: &str = "gh";
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ASSOCIATION_NUMBERS: usize = 30;
/// Number.MAX_SAFE_INTEGER: PR numbers travel through JavaScript.
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(crate) const NOT_ALLOWED: &str = "Request not allowed.";
pub(crate) const NOT_INSTALLED: &str = "gh is not installed; install GitHub CLI and run gh auth login.";
pub(crate) const TIMED_OUT: &str = "gh query timed out; snapshot is incomplete.";
pub(crate) const FAILED: &str =
    "GitHub query failed; check gh auth status, repository access, network and API rate limits.";
pub(crate) const INVALID_JSON: &str = "GitHub returned invalid JSON; snapshot is incomplete.";

#[tauri::command]
pub async fn github_readonly_get(webview: tauri::Webview, path: String) -> Result<Value, String> {
    crate::webviews::ensure_control_webview(&webview).map_err(|_| NOT_ALLOWED.to_string())?;
    let path = allowed_get_path(&path).ok_or_else(|| NOT_ALLOWED.to_string())?;
    run_gh(GH_PROGRAM, &get_args(path)).await
}

#[tauri::command]
pub async fn github_readonly_associations(
    webview: tauri::Webview,
    repo: String,
    numbers: Vec<u64>,
) -> Result<Value, String> {
    crate::webviews::ensure_control_webview(&webview).map_err(|_| NOT_ALLOWED.to_string())?;
    let query = associations_query(&repo, &numbers).ok_or_else(|| NOT_ALLOWED.to_string())?;
    run_gh(GH_PROGRAM, &graphql_args(&query)).await
}

fn get_args(path: &str) -> Vec<String> {
    ["api", "--hostname", "github.com", "--method", "GET", path]
        .iter()
        .map(|arg| arg.to_string())
        .collect()
}

fn graphql_args(query: &str) -> Vec<String> {
    vec![
        "api".into(),
        "--hostname".into(),
        "github.com".into(),
        "graphql".into(),
        "-f".into(),
        format!("query={query}"),
    ]
}

/// Same rule as snapshot.mjs `validateOptions`, minus dot-only names that would turn a path
/// segment into `.` / `..`.
pub(crate) fn valid_repo(repo: &str) -> bool {
    let Some((owner, name)) = repo.split_once('/') else {
        return false;
    };
    let owner_ok = owner.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    let name_ok = !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        && !name.chars().all(|c| c == '.');
    owner_ok && name_ok
}

fn is_sha(value: &str) -> bool {
    value.len() == 40 && value.chars().all(|c| c.is_ascii_hexdigit())
}

/// Canonical decimal in `min..=max` (no sign, no leading zeros).
fn bounded_int(value: &str, min: u64, max: u64) -> bool {
    if value.is_empty() || value.len() > 16 || (value.len() > 1 && value.starts_with('0')) {
        return false;
    }
    if !value.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    value.parse::<u64>().is_ok_and(|n| (min..=max).contains(&n))
}

/// Returns the path unchanged when it is one of the four endpoints collectSnapshot reads.
pub(crate) fn allowed_get_path(path: &str) -> Option<&str> {
    let (route, query) = path.split_once('?')?;
    let parts: Vec<&str> = route.split('/').collect();
    if parts.len() < 4 || parts[0] != "repos" || !valid_repo(&format!("{}/{}", parts[1], parts[2])) {
        return None;
    }
    let allowed = match &parts[3..] {
        ["issues"] | ["pulls"] => {
            let rest = query.strip_prefix("state=open&sort=created&direction=desc&per_page=")?;
            let (per_page, page) = rest.split_once("&page=")?;
            bounded_int(per_page, 1, 30) && bounded_int(page, 1, 10_000)
        }
        ["commits", sha, "check-runs"] => is_sha(sha) && query == "filter=latest&per_page=100&page=1",
        ["commits", sha, "status"] => is_sha(sha) && query == "per_page=100&page=1",
        _ => false,
    };
    allowed.then_some(path)
}

/// The fixed GraphQL query of github.mjs `associations`, rebuilt from validated inputs.
pub(crate) fn associations_query(repo: &str, numbers: &[u64]) -> Option<String> {
    if !valid_repo(repo)
        || numbers.is_empty()
        || numbers.len() > MAX_ASSOCIATION_NUMBERS
        || numbers.iter().any(|&n| n == 0 || n > MAX_SAFE_INTEGER)
    {
        return None;
    }
    let (owner, name) = repo.split_once('/')?;
    let fields = numbers
        .iter()
        .map(|n| {
            format!(
                "p{n}: pullRequest(number: {n}) {{ headRefOid closingIssuesReferences(first: 100) {{ nodes {{ number repository {{ nameWithOwner }} }} pageInfo {{ hasNextPage }} }} }}"
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    // owner / name only contain [A-Za-z0-9_.-], so plain quoting equals JSON.stringify.
    Some(format!(
        "query {{ repository(owner: \"{owner}\", name: \"{name}\") {{ {fields} }} }}"
    ))
}

async fn run_gh(program: &str, args: &[String]) -> Result<Value, String> {
    run_limited(program, args, TIMEOUT, MAX_OUTPUT_BYTES).await
}

/// `run_gh` with explicit limits so tests can drive the kill paths with real child processes.
async fn run_limited(program: &str, args: &[String], timeout: Duration, max_bytes: usize) -> Result<Value, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash per query

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            NOT_INSTALLED.to_string()
        } else {
            FAILED.to_string()
        }
    })?;
    match tokio::time::timeout(timeout, collect(&mut child, max_bytes)).await {
        Ok(result) => result,
        Err(_) => {
            // kill_on_drop would also do this; kill eagerly so a hung gh does not linger.
            let _ = child.start_kill();
            Err(TIMED_OUT.to_string())
        }
    }
}

/// Reads stdout with a hard cap (never buffers more than MAX_OUTPUT_BYTES + 1), then reaps gh.
async fn collect(child: &mut Child, max_bytes: usize) -> Result<Value, String> {
    let stdout = child.stdout.take().ok_or_else(|| FAILED.to_string())?;
    let Some(bytes) = read_capped(stdout, max_bytes)
        .await
        .map_err(|_| FAILED.to_string())?
    else {
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err(FAILED.to_string());
    };
    let status = child.wait().await.map_err(|_| FAILED.to_string())?;
    if !status.success() {
        return Err(FAILED.to_string());
    }
    parse_output(&bytes)
}

/// `None` as soon as the stream proves longer than `cap`; at most `cap + 1` bytes are held.
async fn read_capped<R: AsyncRead + Unpin>(reader: R, cap: usize) -> std::io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    reader.take(cap as u64 + 1).read_to_end(&mut bytes).await?;
    Ok((bytes.len() <= cap).then_some(bytes))
}

fn parse_output(stdout: &[u8]) -> Result<Value, String> {
    if stdout.len() > MAX_OUTPUT_BYTES {
        return Err(FAILED.to_string());
    }
    serde_json::from_slice(stdout).map_err(|_| INVALID_JSON.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "03a234f4d472137fac40c9d58b5b474f78796f22";

    #[test]
    fn allows_exactly_the_snapshot_endpoints() {
        for path in [
            "repos/xiaolebao516/ai-one/issues?state=open&sort=created&direction=desc&per_page=10&page=1",
            "repos/xiaolebao516/ai-one/pulls?state=open&sort=created&direction=desc&per_page=30&page=10000",
            &format!("repos/o/r.name_x-1/commits/{SHA}/check-runs?filter=latest&per_page=100&page=1"),
            &format!("repos/o/r/commits/{SHA}/status?per_page=100&page=1"),
        ] {
            assert_eq!(allowed_get_path(path), Some(path), "{path}");
        }
    }

    #[test]
    fn rejects_everything_else() {
        for path in [
            "",
            "user",
            "repos/o/r/issues",
            "repos/o/r/issues?state=all&sort=created&direction=desc&per_page=10&page=1",
            "repos/o/r/issues?state=open&sort=created&direction=desc&per_page=31&page=1",
            "repos/o/r/issues?state=open&sort=created&direction=desc&per_page=0&page=1",
            "repos/o/r/issues?state=open&sort=created&direction=desc&per_page=010&page=1",
            "repos/o/r/issues?state=open&sort=created&direction=desc&per_page=10&page=10001",
            "repos/o/r/issues?state=open&sort=created&direction=desc&per_page=10&page=1&x=1",
            "repos/o/r/issues?state=open&sort=created&direction=desc&per_page=10&page=-1",
            "repos/o/r/issues/1?state=open&sort=created&direction=desc&per_page=10&page=1",
            "repos/o/../issues?state=open&sort=created&direction=desc&per_page=10&page=1",
            "repos/-o/r/issues?state=open&sort=created&direction=desc&per_page=10&page=1",
            "repos/o/r/pulls?state=open&sort=created&direction=desc&per_page=10&page=1#x",
            "repos/o/r/commits/abc/check-runs?filter=latest&per_page=100&page=1",
            &format!("repos/o/r/commits/{SHA}/check-runs?filter=latest&per_page=100&page=2"),
            &format!("repos/o/r/commits/{SHA}/status?per_page=100&page=1&state=x"),
            &format!("repos/o/r/commits/{SHA}/comments?per_page=100&page=1"),
            "graphql?query=mutation",
            "https://api.github.com/repos/o/r/issues?state=open&sort=created&direction=desc&per_page=10&page=1",
        ] {
            assert_eq!(allowed_get_path(path), None, "{path}");
        }
    }

    #[test]
    fn validates_repositories_like_the_cli() {
        for repo in ["xiaolebao516/ai-one", "a/b", "A1-b/c.d_e-f", "o/.github"] {
            assert!(valid_repo(repo), "{repo}");
        }
        for repo in ["", "a", "/b", "a/", "-a/b", "a_b/c", "a/b/c", "a/..", "a/.", "a/b c", "a/b?x"] {
            assert!(!valid_repo(repo), "{repo}");
        }
    }

    #[test]
    fn builds_only_the_fixed_association_query() {
        let query = associations_query("xiaolebao516/ai-one", &[38, 19]).expect("valid");
        assert!(query.starts_with("query { repository(owner: \"xiaolebao516\", name: \"ai-one\") {"));
        assert!(query.contains("p38: pullRequest(number: 38) { headRefOid closingIssuesReferences(first: 100)"));
        assert!(query.contains("p19: pullRequest(number: 19)"));
        assert!(!query.contains("mutation"));
        assert_eq!(graphql_args(&query)[3], "graphql");

        assert!(associations_query("xiaolebao516/ai-one", &[]).is_none());
        assert!(associations_query("xiaolebao516/ai-one", &[0]).is_none());
        assert!(associations_query("xiaolebao516/ai-one", &[MAX_SAFE_INTEGER + 1]).is_none());
        assert!(associations_query("xiaolebao516/ai-one", &(1..=31).collect::<Vec<_>>()).is_none());
        assert!(associations_query("o/r\") { x } mutation { y", &[1]).is_none());
        assert!(associations_query("o/r", &(1..=30).collect::<Vec<_>>()).is_some());
    }

    #[test]
    fn get_requests_use_an_explicit_get_without_a_shell() {
        let path = "repos/o/r/issues?state=open&sort=created&direction=desc&per_page=10&page=1";
        assert_eq!(get_args(path), ["api", "--hostname", "github.com", "--method", "GET", path]);
    }

    #[test]
    fn parses_json_and_reports_fixed_messages_only() {
        assert_eq!(parse_output(br#"[{"number":1}]"#).unwrap()[0]["number"], 1);
        assert_eq!(parse_output(b"not json").unwrap_err(), INVALID_JSON);
        assert_eq!(parse_output(&vec![b' '; MAX_OUTPUT_BYTES + 1]).unwrap_err(), FAILED);
    }

    #[tokio::test]
    async fn caps_output_while_reading() {
        assert_eq!(read_capped(&b"1234"[..], 4).await.unwrap(), Some(b"1234".to_vec()));
        assert_eq!(read_capped(&b"12345"[..], 4).await.unwrap(), None);
        // An endless stream is cut off after cap + 1 bytes instead of being buffered.
        let endless = tokio::io::repeat(b'x');
        assert_eq!(read_capped(endless, 1024).await.unwrap(), None);
    }

    /// A real child that writes forever (never exits on its own).
    fn endless_writer() -> (&'static str, Vec<String>) {
        if cfg!(windows) {
            ("cmd", vec!["/C".into(), "for /L %i in (0,0,1) do @echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".into()])
        } else {
            ("yes", vec![])
        }
    }

    /// A real child that runs far longer than the test timeout. Started directly (no shell wrapper)
    /// so killing it closes the pipe; a grandchild would keep the pipe open after the kill.
    fn long_sleeper() -> (&'static str, Vec<String>) {
        if cfg!(windows) {
            ("ping", vec!["-n".into(), "60".into(), "127.0.0.1".into()])
        } else {
            ("sleep", vec!["60".into()])
        }
    }

    #[tokio::test]
    async fn kills_and_reaps_a_child_that_exceeds_the_output_cap() {
        let (program, args) = endless_writer();
        let started = std::time::Instant::now();
        // Generous timeout: returning well before it proves the over-cap path killed the child,
        // and `collect` only returns after `child.wait()`, i.e. after the process was reaped.
        let result = run_limited(program, &args, Duration::from_secs(20), 64 * 1024).await;
        assert_eq!(result.unwrap_err(), FAILED);
        assert!(started.elapsed() < Duration::from_secs(10), "took {:?}", started.elapsed());
    }

    #[tokio::test]
    async fn kills_a_child_that_outlives_the_timeout() {
        let (program, args) = long_sleeper();
        let started = std::time::Instant::now();
        let result = run_limited(program, &args, Duration::from_millis(500), MAX_OUTPUT_BYTES).await;
        assert_eq!(result.unwrap_err(), TIMED_OUT);
        assert!(started.elapsed() < Duration::from_secs(5), "took {:?}", started.elapsed());
    }

    #[tokio::test]
    async fn a_missing_gh_maps_to_the_install_hint() {
        let error = run_gh("gh-definitely-not-installed-51", &get_args("x")).await.unwrap_err();
        assert_eq!(error, NOT_INSTALLED);
    }
}

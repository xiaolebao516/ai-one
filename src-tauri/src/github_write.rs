//! Fixed-action GitHub write bridge for Spec #106.
//!
//! All routes and methods are constructed here. No shell is involved, request JSON is sent on
//! stdin, output is capped, and gh stderr / response error text never reaches the UI.

use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};

const GH_PROGRAM: &str = "gh";
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_TEXT_CHARS: usize = 60_000;
const COMMENT_PREFIX: &str = "【ai-one 代用户发出】";
const MARKER_PREFIX: &str = "<!-- ai-one:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GhError {
    Missing, // gh is absent; no process was started.
    SpawnFailed, // process startup failed; no request was sent.
    Timeout, // the process started, so a write may have reached GitHub.
    Failed, // ambiguous process failure, including a non-zero exit.
    StdinFailed, // the process started but request-body delivery failed.
    OutputTooLarge, // the process was stopped after exceeding the output cap.
    InvalidJson, // gh returned a response that could not be parsed.
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubWriteReason {
    Ok,
    GhMissing,
    NotLoggedIn,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubWriteStatus {
    pub available: bool,
    pub reason: GithubWriteReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubWriteState {
    Confirmed,
    Partial,
    Unconfirmed,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubWriteCode {
    Ok,
    NotAllowed,
    InvalidInput,
    HeadMismatch,
    PrIssueMismatch,
    GhMissing,
    NoLogin,
    Timeout,
    GithubFailed,
    Unconfirmed,
    SubIssueFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubWriteStepName {
    Comment,
    Label,
    CreateIssue,
    SubIssue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubWriteStepState {
    Confirmed,
    Unconfirmed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubWriteStep {
    pub step: GithubWriteStepName,
    pub state: GithubWriteStepState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubWriteResult {
    pub status: GithubWriteState,
    pub code: GithubWriteCode,
    pub message: String,
    pub steps: Vec<GithubWriteStep>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_number: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_head: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct CreateIssueArgs {
    pub repo: String,
    pub title: String,
    pub body: String,
    pub parent_spec: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct CommentArgs {
    pub repo: String,
    pub issue: u64,
    pub text: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PauseState {
    Paused,
    Running,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SetPauseArgs {
    pub repo: String,
    pub issue: u64,
    pub state: PauseState,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct AcceptArgs {
    pub repo: String,
    pub issue: u64,
    pub pr: u64,
    pub expected_head: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RequestChangesArgs {
    pub repo: String,
    pub issue: u64,
    pub pr: u64,
    pub expected_head: String,
    pub text: String,
}

type GhFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, GhError>> + Send + 'a>>;

trait GhApi: Send + Sync {
    fn get<'a>(&'a self, path: &'a str) -> GhFuture<'a, Value>;
    fn post<'a>(&'a self, path: &'a str, body: Value) -> GhFuture<'a, Value>;
    fn delete<'a>(&'a self, path: &'a str) -> GhFuture<'a, ()>;
    fn graphql<'a>(&'a self, query: &'a str) -> GhFuture<'a, Value>;
    fn auth_status<'a>(&'a self) -> GhFuture<'a, bool>;
}

struct RealGh;

impl GhApi for RealGh {
    fn get<'a>(&'a self, path: &'a str) -> GhFuture<'a, Value> {
        Box::pin(async move {
            let args = api_args("GET", path, false);
            run_json(GH_PROGRAM, &args, None).await
        })
    }

    fn post<'a>(&'a self, path: &'a str, body: Value) -> GhFuture<'a, Value> {
        Box::pin(async move {
            let args = api_args("POST", path, true);
            let bytes = serde_json::to_vec(&body).map_err(|_| GhError::SpawnFailed)?;
            run_json(GH_PROGRAM, &args, Some(bytes)).await
        })
    }

    fn delete<'a>(&'a self, path: &'a str) -> GhFuture<'a, ()> {
        Box::pin(async move {
            let args = api_args("DELETE", path, false);
            let output = run_process(GH_PROGRAM, &args, None).await?;
            if output.success {
                Ok(())
            } else {
                Err(GhError::Failed)
            }
        })
    }

    fn graphql<'a>(&'a self, query: &'a str) -> GhFuture<'a, Value> {
        Box::pin(async move {
            let args = graphql_args(query);
            run_json(GH_PROGRAM, &args, None).await
        })
    }

    fn auth_status<'a>(&'a self) -> GhFuture<'a, bool> {
        Box::pin(async move {
            let args = [
                "auth".to_string(),
                "status".to_string(),
                "--hostname".to_string(),
                "github.com".to_string(),
            ];
            Ok(run_process(GH_PROGRAM, &args, None).await?.success)
        })
    }
}

struct ProcessOutput {
    success: bool,
    stdout: Vec<u8>,
}

fn api_args(method: &str, path: &str, with_stdin_json: bool) -> Vec<String> {
    let mut args = vec![
        "api".to_string(),
        "--hostname".to_string(),
        "github.com".to_string(),
        "--method".to_string(),
        method.to_string(),
        path.to_string(),
    ];
    if with_stdin_json {
        args.push("--input".to_string());
        args.push("-".to_string());
    }
    args
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

async fn run_json(
    program: &str,
    args: &[String],
    stdin_body: Option<Vec<u8>>,
) -> Result<Value, GhError> {
    let output = run_process(program, args, stdin_body).await?;
    if !output.success {
        return Err(GhError::Failed);
    }
    serde_json::from_slice(&output.stdout).map_err(|_| GhError::InvalidJson)
}

async fn run_process(
    program: &str,
    args: &[String],
    stdin_body: Option<Vec<u8>>,
) -> Result<ProcessOutput, GhError> {
    let has_stdin = stdin_body.is_some();
    let mut command = Command::new(program);
    command
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .env("NO_COLOR", "1")
        .stdin(if has_stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            GhError::Missing
        } else {
            GhError::SpawnFailed
        }
    })?;

    match tokio::time::timeout(
        TIMEOUT,
        collect_process(&mut child, MAX_OUTPUT_BYTES, stdin_body),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(GhError::Timeout)
        }
    }
}

async fn collect_process(
    child: &mut Child,
    max_bytes: usize,
    stdin_body: Option<Vec<u8>>,
) -> Result<ProcessOutput, GhError> {
    let stdout = child.stdout.take().ok_or(GhError::Failed)?;
    let child_ref = &mut *child;
    let write_stdin = async move {
        if let Some(body) = stdin_body {
            let mut stdin = child_ref.stdin.take().ok_or(GhError::StdinFailed)?;
            stdin.write_all(&body).await.map_err(|_| GhError::StdinFailed)?;
        }
        Ok::<(), GhError>(())
    };
    let (write_result, read_result) = tokio::join!(write_stdin, read_capped(stdout, max_bytes));
    let bytes = match read_result {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err(GhError::OutputTooLarge);
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err(GhError::Failed);
        }
    };
    if let Err(error) = write_result {
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err(error);
    }
    let status = child.wait().await.map_err(|_| GhError::Failed)?;
    Ok(ProcessOutput {
        success: status.success(),
        stdout: bytes,
    })
}

async fn read_capped<R: AsyncRead + Unpin>(
    reader: R,
    cap: usize,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    reader.take(cap as u64 + 1).read_to_end(&mut bytes).await?;
    Ok((bytes.len() <= cap).then_some(bytes))
}

fn status_result(reason: GithubWriteReason) -> GithubWriteStatus {
    GithubWriteStatus {
        available: reason == GithubWriteReason::Ok,
        reason,
    }
}

async fn probe_status<G: GhApi>(gh: &G) -> GithubWriteStatus {
    match gh.auth_status().await {
        Ok(true) => status_result(GithubWriteReason::Ok),
        Ok(false) => status_result(GithubWriteReason::NotLoggedIn),
        Err(GhError::Missing) => status_result(GithubWriteReason::GhMissing),
        Err(_) => status_result(GithubWriteReason::Failed),
    }
}

fn fixed_message(code: GithubWriteCode) -> &'static str {
    match code {
        GithubWriteCode::Ok => "已确认写入 GitHub",
        GithubWriteCode::NotAllowed => "仅控制面窗口可执行此操作",
        GithubWriteCode::InvalidInput => "参数无效，已拒绝",
        GithubWriteCode::HeadMismatch => "HEAD 已更新，先刷新",
        GithubWriteCode::PrIssueMismatch => "该 PR 与这个 Issue 没有关联，已拒绝",
        GithubWriteCode::GhMissing => "未安装 GitHub CLI",
        GithubWriteCode::NoLogin => "没有可用的 GitHub 登录",
        GithubWriteCode::Timeout => "请求超时，写入结果可能不确定，请先回读，不要重试",
        GithubWriteCode::GithubFailed => "GitHub 操作失败，请检查权限、网络和 API 限额",
        GithubWriteCode::Unconfirmed => "已发出，但没能确认；请先回读，不要重试",
        GithubWriteCode::SubIssueFailed => "Issue 已创建，但没能挂到父 Spec 下",
    }
}

fn result(
    status: GithubWriteState,
    code: GithubWriteCode,
    message: impl Into<String>,
    steps: Vec<GithubWriteStep>,
) -> GithubWriteResult {
    GithubWriteResult {
        status,
        code,
        message: message.into(),
        steps,
        issue_number: None,
        url: None,
        comment_url: None,
        current_head: None,
    }
}

fn simple_result(status: GithubWriteState, code: GithubWriteCode) -> GithubWriteResult {
    result(status, code, fixed_message(code), Vec::new())
}

fn step(step: GithubWriteStepName, state: GithubWriteStepState) -> GithubWriteStep {
    GithubWriteStep { step, state }
}

fn valid_number(number: u64) -> bool {
    crate::github_readonly::bounded_int(&number.to_string(), 1, MAX_SAFE_INTEGER)
}

fn valid_string(value: &str, max_chars: usize, allow_empty: bool, reject_marker: bool) -> bool {
    let length = value.chars().count();
    (allow_empty || length > 0)
        && length <= max_chars
        && !value
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
        && (!reject_marker || !value.contains(MARKER_PREFIX))
}

fn valid_repo_input(repo: &str) -> bool {
    crate::github_readonly::valid_repo(repo)
        && !repo
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
}

fn valid_title(title: &str) -> bool {
    let trimmed_length = title.trim().chars().count();
    (1..=256).contains(&trimmed_length)
        && !title.chars().any(|ch| matches!(ch, '\n' | '\r' | '\t'))
        && valid_string(title, MAX_TEXT_CHARS, false, true)
}

fn valid_body(body: &str) -> bool {
    valid_string(body, MAX_TEXT_CHARS, true, true)
}

fn valid_text(text: &str) -> bool {
    !text.trim().is_empty() && valid_string(text, MAX_TEXT_CHARS, false, true)
}

fn valid_head(head: &str) -> bool {
    crate::github_readonly::is_sha(head)
}

fn validate_create_issue(args: &CreateIssueArgs) -> bool {
    valid_repo_input(&args.repo)
        && valid_title(&args.title)
        && valid_body(&args.body)
        && args.parent_spec.map_or(true, valid_number)
}

fn validate_comment(args: &CommentArgs) -> bool {
    valid_repo_input(&args.repo) && valid_number(args.issue) && valid_text(&args.text)
}

fn validate_pause(args: &SetPauseArgs) -> bool {
    valid_repo_input(&args.repo) && valid_number(args.issue)
}

async fn code_for_error<G: GhApi>(gh: &G, error: GhError) -> GithubWriteCode {
    match error {
        GhError::Missing => GithubWriteCode::GhMissing,
        GhError::Timeout => GithubWriteCode::Timeout,
        GhError::InvalidJson => GithubWriteCode::GithubFailed,
        GhError::Failed
        | GhError::SpawnFailed
        | GhError::StdinFailed
        | GhError::OutputTooLarge => match gh.auth_status().await {
            Ok(false) => GithubWriteCode::NoLogin,
            Err(GhError::Missing) => GithubWriteCode::GhMissing,
            _ => GithubWriteCode::GithubFailed,
        },
    }
}

// Once a process has started, a write may have reached GitHub even if gh later fails.
// Only failures that prove the process never started can safely be reported as failed.
fn uncertain_write_error(error: GhError) -> bool {
    !matches!(error, GhError::Missing | GhError::SpawnFailed)
}

fn uncertain_write_code(error: GhError) -> GithubWriteCode {
    if error == GhError::Timeout {
        GithubWriteCode::Timeout
    } else {
        GithubWriteCode::Unconfirmed
    }
}

// Check local authentication before issuing each write. A false auth status is the only
// evidence used here to report that the request was not sent due to missing login.
async fn ensure_write_available<G: GhApi>(gh: &G) -> Result<(), GithubWriteCode> {
    match gh.auth_status().await {
        Ok(true) => Ok(()),
        Ok(false) => Err(GithubWriteCode::NoLogin),
        Err(GhError::Missing) => Err(GithubWriteCode::GhMissing),
        Err(_) => Err(GithubWriteCode::GithubFailed),
    }
}

#[derive(Debug, Clone)]
struct CommentConfirmation {
    comment_url: Option<String>,
}

enum CommentOutcome {
    Confirmed(CommentConfirmation),
    Failed(GithubWriteCode),
    Unconfirmed(GithubWriteCode),
}

async fn post_comment_and_confirm<G: GhApi>(
    gh: &G,
    repo: &str,
    issue: u64,
    body: &str,
) -> CommentOutcome {
    let path = format!("repos/{repo}/issues/{issue}/comments");
    if let Err(code) = ensure_write_available(gh).await {
        return CommentOutcome::Failed(code);
    }
    let response = match gh.post(&path, json!({ "body": body })).await {
        Ok(response) => response,
        Err(error) => {
            let uncertain = uncertain_write_error(error);
            let code = if uncertain {
                uncertain_write_code(error)
            } else {
                code_for_error(gh, error).await
            };
            return if uncertain {
                CommentOutcome::Unconfirmed(code)
            } else {
                CommentOutcome::Failed(code)
            };
        }
    };
    let Some(comment_id) = response
        .get("id")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
    else {
        return CommentOutcome::Unconfirmed(GithubWriteCode::Unconfirmed);
    };

    let read_path = format!("repos/{repo}/issues/comments/{comment_id}");
    let comment = match gh.get(&read_path).await {
        Ok(comment) => comment,
        Err(error) => {
            // The comment POST already ran; a failed readback cannot prove it was not written.
            let code = uncertain_write_code(error);
            return CommentOutcome::Unconfirmed(code);
        }
    };
    let actual_body = comment.get("body").and_then(Value::as_str);
    let actual_issue = comment
        .get("issue_url")
        .and_then(Value::as_str)
        .and_then(issue_number_from_url);
    if actual_body != Some(body) || actual_issue != Some(issue) {
        return CommentOutcome::Unconfirmed(GithubWriteCode::Unconfirmed);
    }
    CommentOutcome::Confirmed(CommentConfirmation {
        comment_url: comment
            .get("html_url")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn issue_number_from_url(url: &str) -> Option<u64> {
    url.trim_end_matches('/')
        .rsplit('/')
        .next()?
        .parse::<u64>()
        .ok()
        .filter(|number| valid_number(*number))
}

fn comment_body(text: &str) -> String {
    format!("{COMMENT_PREFIX}\n{text}\n<!-- ai-one:comment:v1 -->")
}

fn pause_body(state: PauseState) -> String {
    let sentence = match state {
        PauseState::Paused => "用户已暂停：请停止派发新工作，正在进行的一步可完成。",
        PauseState::Running => "用户已恢复：可继续派发。",
    };
    format!("{COMMENT_PREFIX}\n{sentence}\n<!-- ai-one:set_pause:v1 -->")
}

fn accept_body(head: &str) -> String {
    format!(
        "{COMMENT_PREFIX}\n【ai-one】用户验收通过（针对 HEAD {}）。\n<!-- ai-one:accept:v1 -->",
        head.to_ascii_lowercase()
    )
}

fn request_changes_body(head: &str, text: &str) -> String {
    format!(
        "{COMMENT_PREFIX}\n【ai-one】用户要求修改（针对 HEAD {}）：\n{text}\n<!-- ai-one:request_changes:v1 -->",
        head.to_ascii_lowercase()
    )
}

async fn comment<G: GhApi>(gh: &G, args: &CommentArgs) -> GithubWriteResult {
    if !validate_comment(args) {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::InvalidInput);
    }
    match post_comment_and_confirm(gh, &args.repo, args.issue, &comment_body(&args.text)).await {
        CommentOutcome::Confirmed(confirmation) => {
            let mut response = result(
                GithubWriteState::Confirmed,
                GithubWriteCode::Ok,
                fixed_message(GithubWriteCode::Ok),
                vec![step(
                    GithubWriteStepName::Comment,
                    GithubWriteStepState::Confirmed,
                )],
            );
            response.comment_url = confirmation.comment_url;
            response
        }
        CommentOutcome::Failed(code) => result(
            GithubWriteState::Failed,
            code,
            fixed_message(code),
            vec![step(
                GithubWriteStepName::Comment,
                GithubWriteStepState::Failed,
            )],
        ),
        CommentOutcome::Unconfirmed(code) => result(
            GithubWriteState::Unconfirmed,
            code,
            fixed_message(code),
            vec![step(
                GithubWriteStepName::Comment,
                GithubWriteStepState::Unconfirmed,
            )],
        ),
    }
}

async fn set_pause<G: GhApi>(gh: &G, args: &SetPauseArgs) -> GithubWriteResult {
    if !validate_pause(args) {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::InvalidInput);
    }
    match post_comment_and_confirm(gh, &args.repo, args.issue, &pause_body(args.state)).await {
        CommentOutcome::Confirmed(confirmation) => {
            let mut response = result(
                GithubWriteState::Confirmed,
                GithubWriteCode::Ok,
                fixed_message(GithubWriteCode::Ok),
                vec![step(
                    GithubWriteStepName::Comment,
                    GithubWriteStepState::Confirmed,
                )],
            );
            response.comment_url = confirmation.comment_url;
            response
        }
        CommentOutcome::Failed(code) => result(
            GithubWriteState::Failed,
            code,
            fixed_message(code),
            vec![step(
                GithubWriteStepName::Comment,
                GithubWriteStepState::Failed,
            )],
        ),
        CommentOutcome::Unconfirmed(code) => result(
            GithubWriteState::Unconfirmed,
            code,
            fixed_message(code),
            vec![step(
                GithubWriteStepName::Comment,
                GithubWriteStepState::Unconfirmed,
            )],
        ),
    }
}

struct PrInfo {
    head: String,
    body: String,
    state: String,
    closing_issue_nodes: Vec<Value>,
    has_next_page: bool,
}

fn pr_query(repo: &str, number: u64) -> Option<String> {
    if !valid_repo_input(repo) || !valid_number(number) {
        return None;
    }
    let (owner, name) = repo.split_once('/')?;
    Some(format!(
        "query {{ repository(owner: \"{owner}\", name: \"{name}\") {{ pullRequest(number: {number}) {{ headRefOid body state closingIssuesReferences(first: 100) {{ nodes {{ number repository {{ nameWithOwner }} }} pageInfo {{ hasNextPage }} }} }} }} }}"
    ))
}

async fn load_pr<G: GhApi>(gh: &G, repo: &str, number: u64) -> Result<Option<PrInfo>, GhError> {
    let query = pr_query(repo, number).ok_or(GhError::Failed)?;
    let value = gh.graphql(&query).await?;
    let Some(pr) = value.pointer("/data/repository/pullRequest") else {
        return Err(GhError::InvalidJson);
    };
    if pr.is_null() {
        return Ok(None);
    }
    let head = pr
        .get("headRefOid")
        .and_then(Value::as_str)
        .filter(|head| valid_head(head))
        .ok_or(GhError::InvalidJson)?
        .to_ascii_lowercase();
    let body = pr
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let state = pr
        .get("state")
        .and_then(Value::as_str)
        .ok_or(GhError::InvalidJson)?
        .to_string();
    let refs = pr
        .get("closingIssuesReferences")
        .ok_or(GhError::InvalidJson)?;
    let closing_issue_nodes = refs
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or(GhError::InvalidJson)?
        .clone();
    let has_next_page = refs
        .pointer("/pageInfo/hasNextPage")
        .and_then(Value::as_bool)
        .ok_or(GhError::InvalidJson)?;
    Ok(Some(PrInfo {
        head,
        body,
        state,
        closing_issue_nodes,
        has_next_page,
    }))
}

fn strip_fenced_code_and_quotes(body: &str) -> String {
    let mut prose = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    let mut in_quote = false;

    for line in body.lines() {
        let leading_spaces = line.bytes().take_while(|byte| *byte == b' ').count();
        let candidate = &line[leading_spaces..];
        let bytes = candidate.as_bytes();

        if let Some((fence_char, fence_len)) = fence {
            if leading_spaces <= 3 && bytes.first() == Some(&fence_char) {
                let run = bytes.iter().take_while(|byte| **byte == fence_char).count();
                if run >= fence_len && candidate[run..].trim().is_empty() {
                    fence = None;
                }
            }
            prose.push("");
            continue;
        }

        if in_quote {
            if line.trim().is_empty() {
                in_quote = false;
                prose.push(line);
            } else {
                // A non-empty line after a quote marker is a lazy quote continuation.
                prose.push("");
            }
            continue;
        }

        if line.trim().is_empty() {
            prose.push("");
            continue;
        }

        if line.starts_with('\t') || leading_spaces >= 4 {
            // Indented code is not a real PR-to-Issue association.
            prose.push("");
            continue;
        }

        if leading_spaces <= 3 && candidate.starts_with('>') {
            in_quote = true;
            prose.push("");
            continue;
        }

        if leading_spaces <= 3
            && (candidate.starts_with("```") || candidate.starts_with("~~~"))
        {
            let fence_char = bytes[0];
            let run = bytes.iter().take_while(|byte| **byte == fence_char).count();
            if run >= 3 {
                fence = Some((fence_char, run));
                prose.push("");
                continue;
            }
        }

        prose.push(line);
    }

    prose.join("\n")
}
fn strip_html_comments(body: &str) -> String {
    let mut output = String::new();
    let mut cursor = 0;
    let mut in_comment = false;

    while cursor < body.len() {
        if in_comment {
            if let Some(offset) = body[cursor..].find("-->") {
                cursor += offset + 3;
                in_comment = false;
            } else {
                break;
            }
        } else if let Some(offset) = body[cursor..].find("<!--") {
            let comment_start = cursor + offset;
            output.push_str(&body[cursor..comment_start]);
            cursor = comment_start + 4;
            in_comment = true;
        } else {
            output.push_str(&body[cursor..]);
            break;
        }
    }

    output
}

fn strip_inline_code(line: &str) -> String {
    let bytes = line.as_bytes();
    let mut output = String::new();
    let mut cursor = 0;

    while cursor < line.len() {
        let Some(offset) = line[cursor..].find('`') else {
            output.push_str(&line[cursor..]);
            break;
        };
        let opening = cursor + offset;
        output.push_str(&line[cursor..opening]);

        let mut opening_end = opening;
        while opening_end < bytes.len() && bytes[opening_end] == b'`' {
            opening_end += 1;
        }
        let delimiter_len = opening_end - opening;
        let mut search = opening_end;
        let mut closing_end = None;

        while search < line.len() {
            let Some(offset) = line[search..].find('`') else {
                break;
            };
            let closing_start = search + offset;
            let mut run_end = closing_start;
            while run_end < bytes.len() && bytes[run_end] == b'`' {
                run_end += 1;
            }
            if run_end - closing_start == delimiter_len {
                closing_end = Some(run_end);
                break;
            }
            search = run_end;
        }

        if let Some(end) = closing_end {
            cursor = end;
        } else {
            output.push_str(&line[opening..opening_end]);
            cursor = opening_end;
        }
    }

    output
}

fn is_word_character(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn body_links_issue(body: &str, repo: &str, issue: u64) -> bool {
    // Fail-closed gate (the body is only a fallback; closingIssuesReferences stays the primary
    // source): any backtick, HTML (`<`) or tilde fence makes Markdown code/comment/attribute context
    // ambiguous, so the body is not evidence at all instead of being parsed heuristically.
    if body.contains('`') || body.contains('<') || body.contains("~~~") {
        return false;
    }
    let prose = strip_fenced_code_and_quotes(body);
    let prose = strip_html_comments(&prose);
    let prose = strip_inline_code(&prose);
    let Some((owner, name)) = repo.split_once('/') else {
        return false;
    };
    let references = [format!("{owner}/{name}#{issue}").to_ascii_lowercase(), format!("#{issue}")];
    let verbs = [
        "closes", "closed", "close", "fixes", "fixed", "fix", "resolves", "resolved", "resolve",
    ];

    // Match each original line independently: removed Markdown lines must never join
    // a keyword and an issue number into a new closing statement.
    for line in prose.lines() {
        let lower = line.to_ascii_lowercase();
        for verb in verbs.iter().copied() {
            for (start, _) in lower.match_indices(verb) {
                // The closing statement must open the line (optionally as a "- " / "* " bullet).
                if !matches!(&lower[..start], "" | "- " | "* ") {
                    continue;
                }

                let mut cursor = start + verb.len();
                if lower[cursor..]
                    .chars()
                    .next()
                    .is_some_and(is_word_character)
                {
                    continue;
                }

                // Only "verb<space>" or "verb:<space>" are accepted; a bare colon is not a separator.
                if lower.as_bytes().get(cursor) == Some(&b':') {
                    cursor += 1;
                }
                let after_separator = cursor;
                while cursor < lower.len() && lower.as_bytes()[cursor].is_ascii_whitespace() {
                    cursor += 1;
                }
                if cursor == after_separator {
                    continue;
                }

                for reference in &references {
                    if lower[cursor..].starts_with(reference) {
                        let end = cursor + reference.len();
                        if lower[end..]
                            .chars()
                            .next()
                            .map_or(true, |ch| !is_word_character(ch))
                        {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}
async fn precheck_pr<G: GhApi>(
    gh: &G,
    repo: &str,
    issue: u64,
    pr_number: u64,
    expected_head: &str,
) -> Result<(), Box<GithubWriteResult>> {
    let pr = match load_pr(gh, repo, pr_number).await {
        Ok(Some(pr)) => pr,
        Ok(None) => {
            return Err(Box::new(result(
                GithubWriteState::Failed,
                GithubWriteCode::GithubFailed,
                "PR 不存在或当前不是开放状态，已拒绝",
                Vec::new(),
            )));
        }
        Err(error) => {
            let code = code_for_error(gh, error).await;
            return Err(Box::new(simple_result(GithubWriteState::Failed, code)));
        }
    };
    if pr.state != "OPEN" {
        return Err(Box::new(result(
            GithubWriteState::Failed,
            GithubWriteCode::GithubFailed,
            "PR 不存在或当前不是开放状态，已拒绝",
            Vec::new(),
        )));
    }
    let expected = expected_head.to_ascii_lowercase();
    if pr.head != expected {
        let mut response = simple_result(
            GithubWriteState::Failed,
            GithubWriteCode::HeadMismatch,
        );
        response.current_head = Some(pr.head);
        return Err(Box::new(response));
    }

    let closing_ref_matches = pr.closing_issue_nodes.iter().any(|node| {
        node.get("number").and_then(Value::as_u64) == Some(issue)
            && node
                .pointer("/repository/nameWithOwner")
                .and_then(Value::as_str)
                .is_some_and(|name| name.eq_ignore_ascii_case(repo))
    });
    let body_matches = body_links_issue(&pr.body, repo, issue);
    // If GraphQL reports more than 100 closing references, only an explicit body link may
    // substitute for a missing match in the returned nodes; never guess from the truncated list.
    let association_missing = if pr.has_next_page {
        !closing_ref_matches && !body_matches
    } else {
        !(closing_ref_matches || body_matches)
    };
    if association_missing {
        return Err(Box::new(simple_result(
            GithubWriteState::Failed,
            GithubWriteCode::PrIssueMismatch,
        )));
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum ReviewAction<'a> {
    Accept,
    RequestChanges(&'a str),
}

enum LabelOutcome {
    Confirmed,
    Failed(GithubWriteCode),
    Unconfirmed(GithubWriteCode),
}

fn label_is_present(value: &Value, label: &str) -> Option<bool> {
    let labels = value.as_array()?;
    let mut present = false;
    for item in labels {
        let name = item.get("name").and_then(Value::as_str)?;
        if name == label {
            present = true;
        }
    }
    Some(present)
}

async fn ensure_label_state<G: GhApi>(
    gh: &G,
    repo: &str,
    issue: u64,
    label: &str,
    should_exist: bool,
) -> LabelOutcome {
    let path = format!("repos/{repo}/issues/{issue}/labels");
    let before = match gh.get(&path).await {
        Ok(value) => match label_is_present(&value, label) {
            Some(present) => present,
            None => return LabelOutcome::Unconfirmed(GithubWriteCode::Unconfirmed),
        },
        Err(_) => return LabelOutcome::Unconfirmed(GithubWriteCode::Unconfirmed),
    };
    if before == should_exist {
        return LabelOutcome::Confirmed;
    }

    if let Err(code) = ensure_write_available(gh).await {
        return LabelOutcome::Failed(code);
    }

    let write_result = if should_exist {
        gh.post(&path, json!({ "labels": [label] })).await.map(|_| ())
    } else {
        gh.delete(&format!("{path}/{label}")).await
    };
    if let Err(error) = write_result {
        let uncertain = uncertain_write_error(error);
        let code = if uncertain {
            uncertain_write_code(error)
        } else {
            code_for_error(gh, error).await
        };
        return if uncertain {
            LabelOutcome::Unconfirmed(code)
        } else {
            LabelOutcome::Failed(code)
        };
    }

    let after = match gh.get(&path).await {
        Ok(value) => match label_is_present(&value, label) {
            Some(present) => present,
            None => return LabelOutcome::Unconfirmed(GithubWriteCode::Unconfirmed),
        },
        Err(error) => {
            // The label write already ran; do not turn a failed readback into a no-login message.
            let code = uncertain_write_code(error);
            return LabelOutcome::Unconfirmed(code);
        }
    };
    if after == should_exist {
        LabelOutcome::Confirmed
    } else {
        LabelOutcome::Failed(GithubWriteCode::GithubFailed)
    }
}

async fn review_action<G: GhApi>(
    gh: &G,
    repo: &str,
    issue: u64,
    pr_number: u64,
    expected_head: &str,
    action: ReviewAction<'_>,
) -> GithubWriteResult {
    let valid_action_text = match action {
        ReviewAction::Accept => true,
        ReviewAction::RequestChanges(text) => valid_text(text),
    };
    if !valid_repo_input(repo)
        || !valid_number(issue)
        || !valid_number(pr_number)
        || !valid_head(expected_head)
        || !valid_action_text
    {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::InvalidInput);
    }
    if let ReviewAction::RequestChanges(text) = action {
        if !valid_text(text) {
            return simple_result(GithubWriteState::Failed, GithubWriteCode::InvalidInput);
        }
    }
    if let Err(precheck_result) = precheck_pr(gh, repo, issue, pr_number, expected_head).await {
        return *precheck_result;
    }

    let body = match action {
        ReviewAction::Accept => accept_body(expected_head),
        ReviewAction::RequestChanges(text) => request_changes_body(expected_head, text),
    };
    let comment = post_comment_and_confirm(gh, repo, issue, &body).await;
    let confirmation = match comment {
        CommentOutcome::Confirmed(confirmation) => confirmation,
        CommentOutcome::Failed(code) => {
            return result(
                GithubWriteState::Failed,
                code,
                fixed_message(code),
                vec![
                    step(
                        GithubWriteStepName::Comment,
                        GithubWriteStepState::Failed,
                    ),
                    step(GithubWriteStepName::Label, GithubWriteStepState::Skipped),
                ],
            );
        }
        CommentOutcome::Unconfirmed(code) => {
            return result(
                GithubWriteState::Unconfirmed,
                code,
                fixed_message(code),
                vec![
                    step(
                        GithubWriteStepName::Comment,
                        GithubWriteStepState::Unconfirmed,
                    ),
                    step(GithubWriteStepName::Label, GithubWriteStepState::Skipped),
                ],
            );
        }
    };

    let (label, should_exist) = match action {
        ReviewAction::Accept => ("needs-user", false),
        ReviewAction::RequestChanges(_) => ("needs-review", true),
    };
    match ensure_label_state(gh, repo, issue, label, should_exist).await {
        LabelOutcome::Confirmed => {
            let mut response = result(
                GithubWriteState::Confirmed,
                GithubWriteCode::Ok,
                fixed_message(GithubWriteCode::Ok),
                vec![
                    step(
                        GithubWriteStepName::Comment,
                        GithubWriteStepState::Confirmed,
                    ),
                    step(
                        GithubWriteStepName::Label,
                        GithubWriteStepState::Confirmed,
                    ),
                ],
            );
            response.comment_url = confirmation.comment_url;
            response
        }
        LabelOutcome::Failed(code) => {
            let mut response = result(
                GithubWriteState::Partial,
                code,
                "评论已确认，但标签未能更新",
                vec![
                    step(
                        GithubWriteStepName::Comment,
                        GithubWriteStepState::Confirmed,
                    ),
                    step(GithubWriteStepName::Label, GithubWriteStepState::Failed),
                ],
            );
            response.comment_url = confirmation.comment_url;
            response
        }
        LabelOutcome::Unconfirmed(code) => {
            let mut response = result(
                GithubWriteState::Unconfirmed,
                code,
                fixed_message(code),
                vec![
                    step(
                        GithubWriteStepName::Comment,
                        GithubWriteStepState::Confirmed,
                    ),
                    step(
                        GithubWriteStepName::Label,
                        GithubWriteStepState::Unconfirmed,
                    ),
                ],
            );
            response.comment_url = confirmation.comment_url;
            response
        }
    }
}

async fn accept<G: GhApi>(gh: &G, args: &AcceptArgs) -> GithubWriteResult {
    review_action(
        gh,
        &args.repo,
        args.issue,
        args.pr,
        &args.expected_head,
        ReviewAction::Accept,
    )
    .await
}

async fn request_changes<G: GhApi>(
    gh: &G,
    args: &RequestChangesArgs,
) -> GithubWriteResult {
    review_action(
        gh,
        &args.repo,
        args.issue,
        args.pr,
        &args.expected_head,
        ReviewAction::RequestChanges(&args.text),
    )
    .await
}

fn issue_path(repo: &str, issue: u64) -> String {
    format!("repos/{repo}/issues/{issue}")
}

fn issue_url(repo: &str, issue: u64, value: &Value) -> String {
    value
        .get("html_url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://github.com/{repo}/issues/{issue}"))
}

fn valid_response_number(value: &Value, field: &str) -> Option<u64> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .filter(|number| valid_number(*number))
}

fn valid_response_database_id(value: &Value, field: &str) -> Option<u64> {
    value.get(field).and_then(Value::as_u64).filter(|id| *id > 0)
}

async fn create_issue<G: GhApi>(gh: &G, args: &CreateIssueArgs) -> GithubWriteResult {
    if !validate_create_issue(args) {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::InvalidInput);
    }
    if let Err(code) = ensure_write_available(gh).await {
        let mut steps = vec![step(
            GithubWriteStepName::CreateIssue,
            GithubWriteStepState::Failed,
        )];
        if args.parent_spec.is_some() {
            steps.push(step(GithubWriteStepName::SubIssue, GithubWriteStepState::Skipped));
        }
        return result(
            GithubWriteState::Failed,
            code,
            fixed_message(code),
            steps,
        );
    }
    let response = match gh
        .post(
            &format!("repos/{}/issues", args.repo),
            json!({ "title": args.title, "body": args.body }),
        )
        .await
    {
        Ok(value) => value,
        Err(error) => {
            let uncertain = uncertain_write_error(error);
            let code = if uncertain {
                uncertain_write_code(error)
            } else {
                code_for_error(gh, error).await
            };
            let mut steps = vec![step(
                GithubWriteStepName::CreateIssue,
                if uncertain {
                    GithubWriteStepState::Unconfirmed
                } else {
                    GithubWriteStepState::Failed
                },
            )];
            if args.parent_spec.is_some() {
                steps.push(step(GithubWriteStepName::SubIssue, GithubWriteStepState::Skipped));
            }
            return result(
                if uncertain {
                    GithubWriteState::Unconfirmed
                } else {
                    GithubWriteState::Failed
                },
                code,
                fixed_message(code),
                steps,
            );
        }
    };
    let Some(number) = valid_response_number(&response, "number") else {
        let mut steps = vec![step(
            GithubWriteStepName::CreateIssue,
            GithubWriteStepState::Unconfirmed,
        )];
        if args.parent_spec.is_some() {
            steps.push(step(GithubWriteStepName::SubIssue, GithubWriteStepState::Skipped));
        }
        return result(
            GithubWriteState::Unconfirmed,
            GithubWriteCode::Unconfirmed,
            fixed_message(GithubWriteCode::Unconfirmed),
            steps,
        );
    };
    let posted_database_id = valid_response_database_id(&response, "id");
    let path = issue_path(&args.repo, number);
    let issue = match gh.get(&path).await {
        Ok(value) => value,
        Err(error) => {
            // The Issue POST already ran; a failed readback must remain unconfirmed.
            let code = uncertain_write_code(error);
            let mut steps = vec![step(
                GithubWriteStepName::CreateIssue,
                GithubWriteStepState::Unconfirmed,
            )];
            if args.parent_spec.is_some() {
                steps.push(step(GithubWriteStepName::SubIssue, GithubWriteStepState::Skipped));
            }
            let mut result = result(
                GithubWriteState::Unconfirmed,
                code,
                fixed_message(code),
                steps,
            );
            result.issue_number = Some(number);
            result.url = Some(format!("https://github.com/{}/issues/{number}", args.repo));
            return result;
        }
    };
    let title_matches = issue.get("title").and_then(Value::as_str) == Some(args.title.as_str());
    let body_matches = issue
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        == args.body;
    let url = issue_url(&args.repo, number, &issue);
    if !title_matches || !body_matches {
        let mut result = simple_result(GithubWriteState::Unconfirmed, GithubWriteCode::Unconfirmed);
        result.issue_number = Some(number);
        result.url = Some(url);
        result.steps.push(step(
            GithubWriteStepName::CreateIssue,
            GithubWriteStepState::Unconfirmed,
        ));
        if args.parent_spec.is_some() {
            result.steps.push(step(GithubWriteStepName::SubIssue, GithubWriteStepState::Skipped));
        }
        return result;
    }

    let mut confirmed = result(
        GithubWriteState::Confirmed,
        GithubWriteCode::Ok,
        fixed_message(GithubWriteCode::Ok),
        vec![step(
            GithubWriteStepName::CreateIssue,
            GithubWriteStepState::Confirmed,
        )],
    );
    confirmed.issue_number = Some(number);
    confirmed.url = Some(url.clone());
    let Some(parent) = args.parent_spec else {
        return confirmed;
    };
    let Some(database_id) = posted_database_id else {
        confirmed.status = GithubWriteState::Partial;
        confirmed.code = GithubWriteCode::SubIssueFailed;
        confirmed.message = fixed_message(GithubWriteCode::SubIssueFailed).to_string();
        confirmed.steps.push(step(
            GithubWriteStepName::SubIssue,
            GithubWriteStepState::Failed,
        ));
        return confirmed;
    };

    let parent_path = format!("repos/{}/issues/{parent}/sub_issues", args.repo);
    if ensure_write_available(gh).await.is_err() {
        confirmed.status = GithubWriteState::Partial;
        confirmed.code = GithubWriteCode::SubIssueFailed;
        confirmed.message = fixed_message(GithubWriteCode::SubIssueFailed).to_string();
        confirmed.steps.push(step(
            GithubWriteStepName::SubIssue,
            GithubWriteStepState::Failed,
        ));
        return confirmed;
    }
    if let Err(error) = gh
        .post(&parent_path, json!({ "sub_issue_id": database_id }))
        .await
    {
        let uncertain = uncertain_write_error(error);
        if uncertain {
            let code = uncertain_write_code(error);
            confirmed.status = GithubWriteState::Unconfirmed;
            confirmed.code = code;
            confirmed.message = "Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试".to_string();
            confirmed.steps.push(step(
                GithubWriteStepName::SubIssue,
                GithubWriteStepState::Unconfirmed,
            ));
        } else {
            confirmed.status = GithubWriteState::Partial;
            confirmed.code = GithubWriteCode::SubIssueFailed;
            confirmed.message = fixed_message(GithubWriteCode::SubIssueFailed).to_string();
            confirmed.steps.push(step(
                GithubWriteStepName::SubIssue,
                GithubWriteStepState::Failed,
            ));
        }
        return confirmed;
    }

    for page in 1..=10 {
        let sub_path = format!("{parent_path}?per_page=100&page={page}");
        let items = match gh.get(&sub_path).await {
            Ok(value) => match value.as_array() {
                Some(items) => items.clone(),
                None => {
                    confirmed.status = GithubWriteState::Unconfirmed;
                    confirmed.code = GithubWriteCode::Unconfirmed;
                    confirmed.message = "Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试".to_string();
                    confirmed.steps.push(step(
                        GithubWriteStepName::SubIssue,
                        GithubWriteStepState::Unconfirmed,
                    ));
                    return confirmed;
                }
            },
            Err(error) => {
                // The sub-issue POST already ran; a failed readback cannot prove it was not applied.
                let code = uncertain_write_code(error);
                confirmed.status = GithubWriteState::Unconfirmed;
                confirmed.code = code;
                confirmed.message = "Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试".to_string();
                confirmed.steps.push(step(
                    GithubWriteStepName::SubIssue,
                    GithubWriteStepState::Unconfirmed,
                ));
                return confirmed;
            }
        };
        if items
            .iter()
            .any(|item| item.get("number").and_then(Value::as_u64) == Some(number))
        {
            confirmed.steps.push(step(
                GithubWriteStepName::SubIssue,
                GithubWriteStepState::Confirmed,
            ));
            return confirmed;
        }
        if items.len() < 100 {
            confirmed.status = GithubWriteState::Partial;
            confirmed.code = GithubWriteCode::SubIssueFailed;
            confirmed.message = fixed_message(GithubWriteCode::SubIssueFailed).to_string();
            confirmed.steps.push(step(
                GithubWriteStepName::SubIssue,
                GithubWriteStepState::Failed,
            ));
            return confirmed;
        }
        if page == 10 {
            confirmed.status = GithubWriteState::Unconfirmed;
            confirmed.code = GithubWriteCode::Unconfirmed;
            confirmed.message = "Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试".to_string();
            confirmed.steps.push(step(
                GithubWriteStepName::SubIssue,
                GithubWriteStepState::Unconfirmed,
            ));
            return confirmed;
        }
    }
    confirmed
}

#[tauri::command]
pub async fn github_write_status(webview: tauri::Webview) -> Result<GithubWriteStatus, String> {
    crate::webviews::ensure_control_webview(&webview)
        .map_err(|_| "仅控制面窗口可执行此操作".to_string())?;
    Ok(probe_status(&RealGh).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn github_write_create_issue(
    webview: tauri::Webview,
    repo: String,
    title: String,
    body: String,
    parent_spec: Option<u64>,
) -> GithubWriteResult {
    if crate::webviews::ensure_control_webview(&webview).is_err() {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::NotAllowed);
    }
    create_issue(
        &RealGh,
        &CreateIssueArgs {
            repo,
            title,
            body,
            parent_spec,
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn github_write_comment(
    webview: tauri::Webview,
    repo: String,
    issue: u64,
    text: String,
) -> GithubWriteResult {
    if crate::webviews::ensure_control_webview(&webview).is_err() {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::NotAllowed);
    }
    comment(&RealGh, &CommentArgs { repo, issue, text }).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn github_write_set_pause(
    webview: tauri::Webview,
    repo: String,
    issue: u64,
    state: PauseState,
) -> GithubWriteResult {
    if crate::webviews::ensure_control_webview(&webview).is_err() {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::NotAllowed);
    }
    set_pause(&RealGh, &SetPauseArgs { repo, issue, state }).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn github_write_accept(
    webview: tauri::Webview,
    repo: String,
    issue: u64,
    pr: u64,
    expected_head: String,
) -> GithubWriteResult {
    if crate::webviews::ensure_control_webview(&webview).is_err() {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::NotAllowed);
    }
    accept(
        &RealGh,
        &AcceptArgs {
            repo,
            issue,
            pr,
            expected_head,
        },
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn github_write_request_changes(
    webview: tauri::Webview,
    repo: String,
    issue: u64,
    pr: u64,
    expected_head: String,
    text: String,
) -> GithubWriteResult {
    if crate::webviews::ensure_control_webview(&webview).is_err() {
        return simple_result(GithubWriteState::Failed, GithubWriteCode::NotAllowed);
    }
    request_changes(
        &RealGh,
        &RequestChangesArgs {
            repo,
            issue,
            pr,
            expected_head,
            text,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    const SHA: &str = "03a234f4d472137fac40c9d58b5b474f78796f22";
    const OTHER_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const REPO: &str = "owner/repo";

    struct FakeGh {
        calls: Mutex<Vec<String>>,
        responses: Mutex<VecDeque<Result<Value, GhError>>>,
        auth_result: Result<bool, GhError>,
        auth_results: Mutex<VecDeque<Result<bool, GhError>>>,
    }

    impl FakeGh {
        fn new(responses: Vec<Result<Value, GhError>>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                responses: Mutex::new(responses.into()),
                auth_result: Ok(true),
                auth_results: Mutex::new(VecDeque::new()),
            }
        }

        fn with_auth(responses: Vec<Result<Value, GhError>>, auth_result: Result<bool, GhError>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                responses: Mutex::new(responses.into()),
                auth_result,
                auth_results: Mutex::new(VecDeque::new()),
            }
        }

        fn with_auth_sequence(
            responses: Vec<Result<Value, GhError>>,
            auth_results: Vec<Result<bool, GhError>>,
        ) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                responses: Mutex::new(responses.into()),
                auth_result: Ok(true),
                auth_results: Mutex::new(auth_results.into()),
            }
        }

        fn record(&self, call: String) -> Result<Value, GhError> {
            self.calls.lock().unwrap().push(call);
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(GhError::Failed))
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }

        fn write_calls(&self) -> Vec<String> {
            self.calls()
                .into_iter()
                .filter(|call| call.starts_with("POST ") || call.starts_with("DELETE "))
                .collect()
        }

    }

    impl GhApi for FakeGh {
        fn get<'a>(&'a self, path: &'a str) -> GhFuture<'a, Value> {
            Box::pin(async move { self.record(format!("GET {path}")) })
        }

        fn post<'a>(&'a self, path: &'a str, body: Value) -> GhFuture<'a, Value> {
            Box::pin(async move { self.record(format!("POST {path} {body}")) })
        }

        fn delete<'a>(&'a self, path: &'a str) -> GhFuture<'a, ()> {
            Box::pin(async move { self.record(format!("DELETE {path}")).map(|_| ()) })
        }

        fn graphql<'a>(&'a self, query: &'a str) -> GhFuture<'a, Value> {
            Box::pin(async move { self.record(format!("GRAPHQL {query}")) })
        }

        fn auth_status<'a>(&'a self) -> GhFuture<'a, bool> {
            Box::pin(async move {
                self.calls.lock().unwrap().push("AUTH".to_string());
                self.auth_results.lock().unwrap().pop_front().unwrap_or(self.auth_result)
            })
        }
    }

    fn pr_value(head: &str, body: &str, nodes: Vec<Value>, has_next_page: bool, state: &str) -> Value {
        json!({
            "data": {
                "repository": {
                    "pullRequest": {
                        "headRefOid": head,
                        "body": body,
                        "state": state,
                        "closingIssuesReferences": {
                            "nodes": nodes,
                            "pageInfo": { "hasNextPage": has_next_page }
                        }
                    }
                }
            }
        })
    }

    fn linked_node(repo: &str, issue: u64) -> Value {
        json!({ "number": issue, "repository": { "nameWithOwner": repo } })
    }

    fn comment_post(id: u64) -> Value {
        json!({ "id": id })
    }

    fn comment_read(id: u64, issue: u64, body: &str) -> Value {
        json!({
            "id": id,
            "body": body,
            "issue_url": format!("https://api.github.com/repos/{REPO}/issues/{issue}"),
            "html_url": format!("https://github.com/{REPO}/issues/{issue}#issuecomment-{id}")
        })
    }

    fn create_response(number: u64, id: u64) -> Value {
        json!({ "number": number, "id": id, "html_url": format!("https://github.com/{REPO}/issues/{number}") })
    }

    fn issue_read(number: u64, id: u64, title: &str, body: &str) -> Value {
        json!({
            "number": number, "id": id, "title": title, "body": body,
            "html_url": format!("https://github.com/{REPO}/issues/{number}"), "comments": 0
        })
    }

    fn valid_comment_args(text: &str) -> CommentArgs {
        CommentArgs { repo: REPO.to_string(), issue: 12, text: text.to_string() }
    }

    fn valid_accept_args(expected_head: &str) -> AcceptArgs {
        AcceptArgs { repo: REPO.to_string(), issue: 12, pr: 4, expected_head: expected_head.to_string() }
    }

    #[test]
    fn validates_number_text_head_and_all_control_characters() {
        assert!(valid_number(1));
        assert!(valid_number(MAX_SAFE_INTEGER));
        assert!(!valid_number(0));
        assert!(!valid_number(MAX_SAFE_INTEGER + 1));
        assert!(valid_title("  title  "));
        assert!(!valid_title("   "));
        assert!(!valid_title("multi\nline"));
        assert!(!valid_title("multi\rline"));
        assert!(!valid_title("multi\tline"));
        assert!(!valid_title(&"x".repeat(257)));
        assert!(valid_body(""));
        assert!(!valid_body(&"x".repeat(MAX_TEXT_CHARS + 1)));
        assert!(valid_text("line one\nline two"));
        assert!(!valid_text(" \r\n\t "));
        assert!(!valid_text("no\0nul"));
        assert!(!valid_text("bad\u{0007}bell"));
        assert!(!valid_text("spoof <!-- ai-one:set_pause:v1 -->"));
        assert!(valid_head(SHA));
        assert!(valid_head(&SHA.to_ascii_uppercase()));
        assert!(!valid_head("123"));
        assert!(!valid_head(&format!("{SHA}0")));
        assert!(!valid_repo_input("../repo"));
    }

    #[test]
    fn internal_argument_structs_reject_unknown_fields_and_invalid_enum_values() {
        // These assertions cover internal serde structs only. Tauri commands accept individual
        // named parameters; this test does not claim that extra IPC object keys are rejected.
        let extra = json!({ "repo": REPO, "title": "x", "body": "", "extra": "not allowed" });
        assert!(serde_json::from_value::<CreateIssueArgs>(extra).is_err());
        assert!(serde_json::from_value::<PauseState>(json!("paused-ish")).is_err());
        let bad_state = json!({ "repo": REPO, "issue": 1, "state": "paused-ish" });
        assert!(serde_json::from_value::<SetPauseArgs>(bad_state).is_err());
        let extra_comment = json!({ "repo": REPO, "issue": 1, "text": "ok", "method": "DELETE" });
        assert!(serde_json::from_value::<CommentArgs>(extra_comment).is_err());
    }

    #[test]
    fn rejects_marker_in_every_user_authored_field() {
        assert!(!valid_title("bad <!-- ai-one: forged"));
        assert!(!valid_body("bad <!-- ai-one: forged"));
        assert!(!valid_text("bad <!-- ai-one: forged"));
    }

    #[test]
    fn constructs_only_fixed_api_routes_and_stdin_json_args() {
        assert_eq!(
            api_args("POST", "repos/owner/repo/issues", true),
            ["api", "--hostname", "github.com", "--method", "POST", "repos/owner/repo/issues", "--input", "-"]
        );
        assert_eq!(
            api_args("GET", "repos/owner/repo/issues/12", false),
            ["api", "--hostname", "github.com", "--method", "GET", "repos/owner/repo/issues/12"]
        );
        let query = pr_query(REPO, 4).unwrap();
        assert!(query.contains("headRefOid body state closingIssuesReferences(first: 100)"));
        assert!(!query.to_ascii_lowercase().contains("mutation"));
        assert!(pr_query("owner/repo?x=1", 4).is_none());
        assert!(pr_query(REPO, MAX_SAFE_INTEGER + 1).is_none());
    }

    #[test]
    fn formats_every_comment_template_with_prefix_and_final_marker() {
        let comment = comment_body("hello\nworld");
        assert!(comment.starts_with("【ai-one 代用户发出】\nhello\nworld\n"));
        assert!(comment.ends_with("<!-- ai-one:comment:v1 -->"));
        assert_eq!(
            pause_body(PauseState::Paused),
            "【ai-one 代用户发出】\n用户已暂停：请停止派发新工作，正在进行的一步可完成。\n<!-- ai-one:set_pause:v1 -->"
        );
        assert_eq!(
            pause_body(PauseState::Running),
            "【ai-one 代用户发出】\n用户已恢复：可继续派发。\n<!-- ai-one:set_pause:v1 -->"
        );
        assert_eq!(
            accept_body(&SHA.to_ascii_uppercase()),
            format!("【ai-one 代用户发出】\n【ai-one】用户验收通过（针对 HEAD {SHA}）。\n<!-- ai-one:accept:v1 -->")
        );
        assert_eq!(
            request_changes_body(SHA, "keep\nexact"),
            format!("【ai-one 代用户发出】\n【ai-one】用户要求修改（针对 HEAD {SHA}）：\nkeep\nexact\n<!-- ai-one:request_changes:v1 -->")
        );
    }

    #[test]
    fn closing_body_reference_matches_only_prose_and_exact_issue_tokens() {
        assert!(body_links_issue("Closes #12", REPO, 12));
        assert!(body_links_issue("Fixes: owner/repo#12", REPO, 12));
        assert!(body_links_issue("Closes OWNER/REPO#12", REPO, 12));
        assert!(body_links_issue("RESOLVED #12", REPO, 12));
        assert!(body_links_issue("Closes #12.", REPO, 12));
        assert!(body_links_issue("Closes #12,", REPO, 12));
        assert!(!body_links_issue("Closes #12", REPO, 1));
        assert!(!body_links_issue("Closes #12abc", REPO, 12));
        assert!(!body_links_issue("Closes #123", REPO, 12));
        assert!(!body_links_issue("Closes:#12", REPO, 12));
        assert!(!body_links_issue("Closes:owner/repo#12", REPO, 12));
        assert!(body_links_issue("Closes: #12", REPO, 12));
        assert!(!body_links_issue("Closes #12_foo", REPO, 12));
        assert!(!body_links_issue("Discloses #12", REPO, 12));
        assert!(!body_links_issue("foo_Closes #12", REPO, 12));
        assert!(!body_links_issue("Closes other/repo#12", REPO, 12));
        assert!(!body_links_issue("Closes repo#12", REPO, 12));
        assert!(!body_links_issue("```markdown\nCloses #12\n```", REPO, 12));
        assert!(!body_links_issue("~~~text\nCloses #12\n~~~", REPO, 12));
        assert!(!body_links_issue("    Closes #12", REPO, 12));
        assert!(!body_links_issue("\tCloses #12", REPO, 12));
        assert!(!body_links_issue("> Closes #12", REPO, 12));
        assert!(!body_links_issue("> example\nCloses #12", REPO, 12));
        assert!(body_links_issue("> example\nCloses #12\n\nCloses #12", REPO, 12));
        assert!(!body_links_issue("Closes\n#12", REPO, 12));
        assert!(!body_links_issue("Closes\n    ignored code\n#12", REPO, 12));
        assert!(!body_links_issue("Closes\n\tignored code\n#12", REPO, 12));
        assert!(!body_links_issue("`Closes #12`", REPO, 12));
        assert!(!body_links_issue("Closes `#12`", REPO, 12));
        assert!(!body_links_issue("`Closes\n#12`", REPO, 12));
        assert!(!body_links_issue("escaped \\` literal and `Closes #12`", REPO, 12));
        assert!(!body_links_issue("\\` x\n`start\nCloses #12\nend`", REPO, 12));
        assert!(!body_links_issue("stray ` backtick\nCloses #12", REPO, 12));
        assert!(!body_links_issue("<span title=\"Closes #12\">text</span>", REPO, 12));
        assert!(!body_links_issue("`Closes <!-- ` --> #12", REPO, 12));
        assert!(!body_links_issue("This PR closes #12", REPO, 12));
        assert!(body_links_issue("Summary\n- Closes #12\n* Fixes #13", REPO, 12));
        assert!(!body_links_issue("<!-- Closes #12 -->", REPO, 12));
        assert!(!body_links_issue("<!--\nCloses #12\n-->", REPO, 12));
    }

    #[tokio::test]
    async fn head_mismatch_and_unassociated_pr_issue_never_send_writes() {
        let mismatch = FakeGh::new(vec![Ok(pr_value(OTHER_SHA, "", vec![], false, "OPEN"))]);
        let result = accept(&mismatch, &valid_accept_args(SHA)).await;
        assert_eq!(result.code, GithubWriteCode::HeadMismatch);
        assert_eq!(result.current_head.as_deref(), Some(OTHER_SHA));
        assert!(mismatch.write_calls().is_empty());

        let unrelated = FakeGh::new(vec![Ok(pr_value(SHA, "", vec![], true, "OPEN"))]);
        let result = accept(&unrelated, &valid_accept_args(SHA)).await;
        assert_eq!(result.code, GithubWriteCode::PrIssueMismatch);
        assert!(unrelated.write_calls().is_empty());
    }

    #[tokio::test]
    async fn has_next_page_requires_a_real_returned_link_or_explicit_body_link() {
        let truncated_unrelated = FakeGh::new(vec![Ok(pr_value(
            SHA, "", vec![linked_node("other/repo", 12)], true, "OPEN",
        ))]);
        let rejected = precheck_pr(&truncated_unrelated, REPO, 12, 4, SHA).await;
        assert_eq!(rejected.unwrap_err().code, GithubWriteCode::PrIssueMismatch);
        assert!(truncated_unrelated.write_calls().is_empty());

        let body_linked = FakeGh::new(vec![Ok(pr_value(SHA, "Closes #12", vec![], true, "OPEN"))]);
        assert!(precheck_pr(&body_linked, REPO, 12, 4, SHA).await.is_ok());

        let node_linked = FakeGh::new(vec![Ok(pr_value(
            SHA, "", vec![linked_node(REPO, 12)], true, "OPEN",
        ))]);
        assert!(precheck_pr(&node_linked, REPO, 12, 4, SHA).await.is_ok());
    }

    #[tokio::test]
    async fn pseudo_body_links_never_allow_review_writes_with_truncated_closing_refs() {
        let args = valid_accept_args(SHA);
        let changes_args = RequestChangesArgs {
            repo: REPO.to_string(),
            issue: 12,
            pr: 4,
            expected_head: SHA.to_string(),
            text: "please fix".to_string(),
        };
        for body in [
            "    Closes #12",
            "\tCloses #12",
            "> example\nCloses #12",
            "Closes\n    ignored code\n#12",
            "Closes\n\tignored code\n#12",
            "escaped \\` literal and `Closes #12`",
            "\\` x\n`start\nCloses #12\nend`",
            "stray ` backtick\nCloses #12",
            "Closes #12_foo",
            "Closes:#12",
            "<span title=\"Closes #12\">text</span>",
            "`Closes <!-- ` --> #12",
        ] {
            let accept_gh = FakeGh::new(vec![Ok(pr_value(SHA, body, vec![], true, "OPEN"))]);
            let accepted = accept(&accept_gh, &args).await;
            assert_eq!(accepted.code, GithubWriteCode::PrIssueMismatch, "body: {body:?}");
            assert!(accept_gh.write_calls().is_empty(), "accept wrote for body: {body:?}");

            let changes_gh = FakeGh::new(vec![Ok(pr_value(SHA, body, vec![], true, "OPEN"))]);
            let changed = request_changes(&changes_gh, &changes_args).await;
            assert_eq!(changed.code, GithubWriteCode::PrIssueMismatch, "body: {body:?}");
            assert!(changes_gh.write_calls().is_empty(), "request_changes wrote for body: {body:?}");
        }
    }

    #[tokio::test]
    async fn association_via_closing_reference_and_body_allows_comment_then_label() {
        let body = accept_body(SHA);
        let gh = FakeGh::new(vec![
            Ok(pr_value(SHA, "", vec![linked_node("OWNER/REPO", 12)], false, "OPEN")),
            Ok(comment_post(50)),
            Ok(comment_read(50, 12, &body)),
            Ok(json!([{ "name": "needs-user" }])),
            Ok(Value::Null),
            Ok(json!([])),
        ]);
        let result = accept(&gh, &valid_accept_args(SHA)).await;
        assert_eq!(result.status, GithubWriteState::Confirmed);
        assert_eq!(result.steps[0].step, GithubWriteStepName::Comment);
        assert_eq!(result.steps[1].step, GithubWriteStepName::Label);
        let writes = gh.write_calls();
        assert_eq!(writes.len(), 2);
        assert!(writes[0].starts_with("POST repos/owner/repo/issues/12/comments "));
        assert_eq!(writes[1], "DELETE repos/owner/repo/issues/12/labels/needs-user");

        let body_linked = FakeGh::new(vec![
            Ok(pr_value(SHA, "Closes #12", vec![], false, "OPEN")),
            Ok(comment_post(51)),
            Ok(comment_read(51, 12, &body)),
            Ok(json!([])),
        ]);
        let result = accept(&body_linked, &valid_accept_args(SHA)).await;
        assert_eq!(result.status, GithubWriteState::Confirmed);
        assert_eq!(body_linked.write_calls().len(), 1, "needs-user was already absent");
    }

    #[tokio::test]
    async fn four_outcomes_are_distinguished_and_unknown_writes_stop_followup() {
        let confirmed_body = accept_body(SHA);
        let confirmed = FakeGh::new(vec![
            Ok(pr_value(SHA, "Fixes owner/repo#12", vec![], false, "OPEN")),
            Ok(comment_post(60)),
            Ok(comment_read(60, 12, &confirmed_body)),
            Ok(json!([])),
        ]);
        assert_eq!(accept(&confirmed, &valid_accept_args(SHA)).await.status, GithubWriteState::Confirmed);
        assert_eq!(confirmed.write_calls().len(), 1);

        let partial = FakeGh::new(vec![
            Ok(pr_value(SHA, "Closes #12", vec![], false, "OPEN")),
            Ok(comment_post(61)),
            Ok(comment_read(61, 12, &confirmed_body)),
            Ok(json!([{ "name": "needs-user" }])),
            Err(GhError::SpawnFailed),
        ]);
        let partial_result = accept(&partial, &valid_accept_args(SHA)).await;
        assert_eq!(partial_result.status, GithubWriteState::Partial);
        assert_eq!(partial_result.steps[0].state, GithubWriteStepState::Confirmed);
        assert_eq!(partial_result.steps[1].state, GithubWriteStepState::Failed);

        let uncertain = FakeGh::new(vec![
            Ok(pr_value(SHA, "Closes #12", vec![], false, "OPEN")),
            Ok(comment_post(62)),
            Err(GhError::Timeout),
        ]);
        let uncertain_result = accept(&uncertain, &valid_accept_args(SHA)).await;
        assert_eq!(uncertain_result.status, GithubWriteState::Unconfirmed);
        assert_eq!(uncertain_result.steps[0].state, GithubWriteStepState::Unconfirmed);
        assert_eq!(uncertain_result.steps[1].state, GithubWriteStepState::Skipped);
        assert_eq!(uncertain.write_calls().len(), 1);

        let failed = FakeGh::new(vec![
            Ok(pr_value(SHA, "Closes #12", vec![], false, "OPEN")),
            Err(GhError::SpawnFailed),
        ]);
        let failed_result = accept(&failed, &valid_accept_args(SHA)).await;
        assert_eq!(failed_result.status, GithubWriteState::Failed);
        assert_eq!(failed_result.steps[0].state, GithubWriteStepState::Failed);
        assert_eq!(failed.write_calls().len(), 1);
    }

    #[tokio::test]
    async fn comment_post_disconnect_is_unconfirmed_and_never_retried() {
        let gh = FakeGh::new(vec![Err(GhError::Failed)]);
        let result = comment(&gh, &valid_comment_args("hello")).await;
        assert_eq!(result.status, GithubWriteState::Unconfirmed);
        assert_eq!(result.steps[0].state, GithubWriteStepState::Unconfirmed);
        assert_eq!(gh.write_calls().len(), 1);
    }

    #[tokio::test]
    async fn post_write_readback_failure_never_masquerades_as_no_login() {
        let gh = FakeGh::with_auth_sequence(
            vec![
                Ok(comment_post(79)),
                Err(GhError::Failed),
            ],
            vec![Ok(true), Ok(false)],
        );
        let result = comment(&gh, &valid_comment_args("hello")).await;
        assert_eq!(result.status, GithubWriteState::Unconfirmed);
        assert_eq!(result.code, GithubWriteCode::Unconfirmed);
        assert_eq!(result.message, fixed_message(GithubWriteCode::Unconfirmed));
        assert_eq!(gh.write_calls().len(), 1);
    }

    #[tokio::test]
    async fn ambiguous_create_post_errors_are_unconfirmed_and_never_trigger_sub_issue_write() {
        for error in [
            GhError::Failed,       // gh exited non-zero after the request may have reached GitHub
            GhError::StdinFailed,  // request body pipe failed after process start
            GhError::OutputTooLarge,
            GhError::Timeout,
            GhError::InvalidJson,
        ] {
            let args = CreateIssueArgs {
                repo: REPO.to_string(),
                title: "Child".to_string(),
                body: String::new(),
                parent_spec: Some(5),
            };
            let gh = FakeGh::new(vec![Err(error)]);
            let result = create_issue(&gh, &args).await;
            assert_eq!(result.status, GithubWriteState::Unconfirmed, "error: {error:?}");
            assert_eq!(result.steps[0].state, GithubWriteStepState::Unconfirmed);
            assert_eq!(result.steps[1].state, GithubWriteStepState::Skipped);
            assert_eq!(gh.write_calls().len(), 1, "must not retry or attempt sub-issue: {error:?}");
        }
    }

    #[tokio::test]
    async fn unknown_delete_and_label_post_results_are_unconfirmed() {
        let accept_body = accept_body(SHA);
        let delete_unknown = FakeGh::new(vec![
            Ok(pr_value(SHA, "Closes #12", vec![], false, "OPEN")),
            Ok(comment_post(80)),
            Ok(comment_read(80, 12, &accept_body)),
            Ok(json!([{ "name": "needs-user" }])),
            Err(GhError::Failed),
        ]);
        let deleted = accept(&delete_unknown, &valid_accept_args(SHA)).await;
        assert_eq!(deleted.status, GithubWriteState::Unconfirmed);
        assert_eq!(deleted.steps[0].state, GithubWriteStepState::Confirmed);
        assert_eq!(deleted.steps[1].state, GithubWriteStepState::Unconfirmed);
        assert_eq!(delete_unknown.write_calls().len(), 2);

        let changes_body = request_changes_body(SHA, "please fix");
        let post_unknown = FakeGh::new(vec![
            Ok(pr_value(SHA, "Closes #12", vec![], false, "OPEN")),
            Ok(comment_post(81)),
            Ok(comment_read(81, 12, &changes_body)),
            Ok(json!([])),
            Err(GhError::Failed),
        ]);
        let posted = request_changes(&post_unknown, &RequestChangesArgs {
            repo: REPO.to_string(), issue: 12, pr: 4, expected_head: SHA.to_string(),
            text: "please fix".to_string(),
        }).await;
        assert_eq!(posted.status, GithubWriteState::Unconfirmed);
        assert_eq!(posted.steps[0].state, GithubWriteStepState::Confirmed);
        assert_eq!(posted.steps[1].state, GithubWriteStepState::Unconfirmed);
        assert_eq!(post_unknown.write_calls().len(), 2);
    }

    #[tokio::test]
    async fn label_read_failure_or_invalid_response_is_unconfirmed_before_label_write() {
        for labels_response in [
            Err(GhError::Timeout),
            Ok(json!({ "unexpected": "not an array" })),
            Ok(json!([{ "name": "needs-user" }, { "unexpected": "missing name" }])),
            Ok(json!([{ "name": "needs-user" }, "not an object"])),
        ] {
            let body = accept_body(SHA);
            let gh = FakeGh::new(vec![
                Ok(pr_value(SHA, "Closes #12", vec![], false, "OPEN")),
                Ok(comment_post(82)),
                Ok(comment_read(82, 12, &body)),
                labels_response,
            ]);
            let result = accept(&gh, &valid_accept_args(SHA)).await;
            assert_eq!(result.status, GithubWriteState::Unconfirmed);
            assert_eq!(result.code, GithubWriteCode::Unconfirmed);
            assert_eq!(result.message, fixed_message(GithubWriteCode::Unconfirmed));
            assert_eq!(result.steps[0].state, GithubWriteStepState::Confirmed);
            assert_eq!(result.steps[1].state, GithubWriteStepState::Unconfirmed);
            assert_eq!(gh.write_calls().len(), 1, "no label write after an unconfirmed GET");
        }
    }

    #[tokio::test]
    async fn no_login_preflight_proves_no_write_was_sent() {
        let gh = FakeGh::with_auth(vec![Err(GhError::Failed)], Ok(false));
        let result = comment(&gh, &valid_comment_args("hello")).await;
        assert_eq!(result.status, GithubWriteState::Failed);
        assert_eq!(result.code, GithubWriteCode::NoLogin);
        assert!(gh.write_calls().is_empty());
    }

    #[tokio::test]
    async fn output_cap_is_detected_instead_of_accepting_truncated_output() {
        let (mut writer, reader) = tokio::io::duplex(16);
        writer.write_all(b"12345").await.unwrap();
        drop(writer);
        assert_eq!(read_capped(reader, 4).await.unwrap(), None);
    }

    #[tokio::test]
    async fn closed_pr_is_rejected_before_any_write() {
        let gh = FakeGh::new(vec![Ok(pr_value(SHA, "Closes #12", vec![], false, "CLOSED"))]);
        let result = accept(&gh, &valid_accept_args(SHA)).await;
        assert_eq!(result.status, GithubWriteState::Failed);
        assert!(gh.write_calls().is_empty());
    }

    #[tokio::test]
    async fn create_issue_is_read_back_and_returns_issue_url() {
        let args = CreateIssueArgs { repo: REPO.to_string(), title: "New issue".to_string(), body: "body".to_string(), parent_spec: None };
        let gh = FakeGh::new(vec![
            Ok(create_response(30, 3000)),
            Ok(issue_read(30, 3000, "New issue", "body")),
        ]);
        let result = create_issue(&gh, &args).await;
        assert_eq!(result.status, GithubWriteState::Confirmed);
        assert_eq!(result.issue_number, Some(30));
        assert_eq!(result.url.as_deref(), Some("https://github.com/owner/repo/issues/30"));
        assert_eq!(gh.write_calls().len(), 1);
        assert!(gh.write_calls()[0].starts_with("POST repos/owner/repo/issues "));
    }

    #[tokio::test]
    async fn request_changes_adds_needs_review_after_confirming_comment() {
        let body = request_changes_body(SHA, "please fix");
        let gh = FakeGh::new(vec![
            Ok(pr_value(SHA, "Fixes: owner/repo#12", vec![], false, "OPEN")),
            Ok(comment_post(70)),
            Ok(comment_read(70, 12, &body)),
            Ok(json!([])),
            Ok(json!([{ "name": "needs-review" }])),
            Ok(json!([{ "name": "needs-review" }])),
        ]);
        let args = RequestChangesArgs {
            repo: REPO.to_string(),
            issue: 12,
            pr: 4,
            expected_head: SHA.to_string(),
            text: "please fix".to_string(),
        };
        let result = request_changes(&gh, &args).await;
        assert_eq!(result.status, GithubWriteState::Confirmed);
        let writes = gh.write_calls();
        assert_eq!(writes.len(), 2);
        assert!(writes[0].starts_with("POST repos/owner/repo/issues/12/comments "));
        assert!(writes[1].starts_with("POST repos/owner/repo/issues/12/labels "));
        assert!(writes[1].contains("needs-review"));
    }

    #[tokio::test]
    async fn parent_sub_issue_success_failure_and_unconfirmed_are_distinct() {
        let args = CreateIssueArgs { repo: REPO.to_string(), title: "Child".to_string(), body: "".to_string(), parent_spec: Some(5) };
        let success = FakeGh::new(vec![
            Ok(create_response(31, 3100)),
            Ok(issue_read(31, 3100, "Child", "")),
            Ok(json!({ "id": 5 })),
            Ok(json!([{ "number": 31 }])),
        ]);
        let result = create_issue(&success, &args).await;
        assert_eq!(result.status, GithubWriteState::Confirmed);
        assert_eq!(result.steps[1].state, GithubWriteStepState::Confirmed);
        assert!(success.write_calls()[1].contains("\"sub_issue_id\":3100"));

        let failure = FakeGh::new(vec![
            Ok(create_response(32, 3200)),
            Ok(issue_read(32, 3200, "Child", "")),
            Err(GhError::SpawnFailed),
        ]);
        let result = create_issue(&failure, &args).await;
        assert_eq!(result.status, GithubWriteState::Partial);
        assert_eq!(result.code, GithubWriteCode::SubIssueFailed);
        assert_eq!(result.message, "Issue 已创建，但没能挂到父 Spec 下");
        assert_eq!(result.issue_number, Some(32));
        assert_eq!(result.steps[0].state, GithubWriteStepState::Confirmed);
        assert_eq!(result.steps[1].state, GithubWriteStepState::Failed);

        let uncertain = FakeGh::new(vec![
            Ok(create_response(33, 3300)),
            Ok(issue_read(33, 3300, "Child", "")),
            Ok(json!({ "id": 5 })),
            Err(GhError::Timeout),
        ]);
        let result = create_issue(&uncertain, &args).await;
        assert_eq!(result.status, GithubWriteState::Unconfirmed);
        assert_eq!(result.steps[1].state, GithubWriteStepState::Unconfirmed);
    }

    #[tokio::test]
    async fn maps_missing_cli_and_no_login_without_leaking_error_text() {
        let no_login = FakeGh::with_auth(vec![Err(GhError::Failed)], Ok(false));
        let result = comment(&no_login, &valid_comment_args("hello")).await;
        assert_eq!(result.code, GithubWriteCode::NoLogin);
        assert_eq!(result.message, "没有可用的 GitHub 登录");
        assert!(!result.message.contains("PRIVATE_SERVER_TEXT"));

        let missing_action = FakeGh::new(vec![Err(GhError::Missing)]);
        let result = comment(&missing_action, &valid_comment_args("hello")).await;
        assert_eq!(result.code, GithubWriteCode::GhMissing);

        let injected = FakeGh::new(vec![Ok(json!({ "message": "PRIVATE_SERVER_TEXT" }))]);
        let result = comment(&injected, &valid_comment_args("hello")).await;
        assert_eq!(result.status, GithubWriteState::Unconfirmed);
        assert!(!result.message.contains("PRIVATE_SERVER_TEXT"));

        let missing = FakeGh::with_auth(vec![], Err(GhError::Missing));
        assert_eq!(probe_status(&missing).await.reason, GithubWriteReason::GhMissing);
        let logged_out = FakeGh::with_auth(vec![], Ok(false));
        assert_eq!(probe_status(&logged_out).await.reason, GithubWriteReason::NotLoggedIn);
        let failed = FakeGh::with_auth(vec![], Err(GhError::Failed));
        assert_eq!(probe_status(&failed).await.reason, GithubWriteReason::Failed);
    }

    #[tokio::test]
    async fn invalid_inputs_make_no_gh_calls() {
        let gh = FakeGh::new(vec![]);
        let args = CommentArgs { repo: REPO.to_string(), issue: MAX_SAFE_INTEGER + 1, text: "x".to_string() };
        assert_eq!(comment(&gh, &args).await.code, GithubWriteCode::InvalidInput);
        assert!(gh.calls().is_empty());
    }

    #[tokio::test]
    #[ignore = "requires a real gh login and a disposable test repository"]
    async fn real_github_write_e2e() {
        let repo = std::env::var("AI_ONE_GH_WRITE_E2E_REPO").expect("set AI_ONE_GH_WRITE_E2E_REPO");
        let pr_number = std::env::var("AI_ONE_GH_WRITE_E2E_PR")
            .expect("set AI_ONE_GH_WRITE_E2E_PR")
            .parse::<u64>()
            .expect("AI_ONE_GH_WRITE_E2E_PR must be an integer");
        let gh = RealGh;
        assert!(probe_status(&gh).await.available, "gh auth status must succeed");

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_secs();
        let created = create_issue(
            &gh,
            &CreateIssueArgs {
                repo: repo.clone(),
                title: format!("ai-one write bridge e2e {stamp}"),
                body: format!("Disposable test issue for Spec #106. Run timestamp: {stamp}"),
                parent_spec: None,
            },
        )
        .await;
        println!("create_issue: {:?} issue={:?}", created.status, created.issue_number);
        assert_eq!(created.status, GithubWriteState::Confirmed);
        let issue = created.issue_number.expect("confirmed issue number");

        let comment_result = comment(
            &gh,
            &CommentArgs { repo: repo.clone(), issue, text: format!("e2e comment {stamp}") },
        )
        .await;
        println!("comment: {:?}", comment_result.status);
        assert_eq!(comment_result.status, GithubWriteState::Confirmed);

        for state in [PauseState::Paused, PauseState::Running] {
            let result = set_pause(
                &gh,
                &SetPauseArgs { repo: repo.clone(), issue, state },
            )
            .await;
            println!("set_pause({state:?}): {:?}", result.status);
            assert_eq!(result.status, GithubWriteState::Confirmed);
        }

        let pr = load_pr(&gh, &repo, pr_number)
            .await
            .expect("read PR")
            .expect("PR must exist");
        let issue_path = issue_path(&repo, issue);
        let before = gh.get(&issue_path).await.expect("read issue comments count")["comments"]
            .as_u64().expect("comments count");
        let wrong_head = if pr.head == "0000000000000000000000000000000000000000" {
            OTHER_SHA.to_string()
        } else {
            "0000000000000000000000000000000000000000".to_string()
        };
        let blocked_head = accept(
            &gh,
            &AcceptArgs { repo: repo.clone(), issue, pr: pr_number, expected_head: wrong_head },
        ).await;
        println!("accept stale HEAD: {:?}/{:?}", blocked_head.status, blocked_head.code);
        assert_eq!(blocked_head.code, GithubWriteCode::HeadMismatch);

        let blocked_link = accept(
            &gh,
            &AcceptArgs { repo: repo.clone(), issue, pr: pr_number, expected_head: pr.head.clone() },
        ).await;
        println!("accept unrelated PR: {:?}/{:?}", blocked_link.status, blocked_link.code);
        assert_eq!(blocked_link.code, GithubWriteCode::PrIssueMismatch);

        let blocked_changes = request_changes(
            &gh,
            &RequestChangesArgs {
                repo: repo.clone(), issue, pr: pr_number,
                expected_head: pr.head.clone(), text: "e2e request must be blocked".to_string(),
            },
        ).await;
        println!("request_changes unrelated PR: {:?}/{:?}", blocked_changes.status, blocked_changes.code);
        assert_eq!(blocked_changes.code, GithubWriteCode::PrIssueMismatch);

        let after = gh.get(&issue_path).await.expect("read issue comments count")["comments"]
            .as_u64().expect("comments count");
        assert_eq!(after, before, "blocked accept / request_changes must not add comments");

        // Optional success path: a disposable PR whose body says `Closes #<linked issue>` and that
        // issue (create both beforehand). accept removes needs-user, request_changes adds needs-review.
        if let (Ok(linked_pr), Ok(linked_issue)) = (
            std::env::var("AI_ONE_GH_WRITE_E2E_LINKED_PR"),
            std::env::var("AI_ONE_GH_WRITE_E2E_LINKED_ISSUE"),
        ) {
            let linked_pr = linked_pr.parse::<u64>().expect("LINKED_PR must be an integer");
            let linked_issue = linked_issue.parse::<u64>().expect("LINKED_ISSUE must be an integer");
            let head = load_pr(&gh, &repo, linked_pr).await.expect("read linked PR").expect("linked PR").head;
            let accepted = accept(
                &gh,
                &AcceptArgs { repo: repo.clone(), issue: linked_issue, pr: linked_pr, expected_head: head.clone() },
            ).await;
            println!("accept linked: {:?}/{:?} steps={:?}", accepted.status, accepted.code, accepted.steps);
            assert_eq!(accepted.status, GithubWriteState::Confirmed);
            let changes = request_changes(
                &gh,
                &RequestChangesArgs {
                    repo: repo.clone(), issue: linked_issue, pr: linked_pr,
                    expected_head: head, text: "e2e: 请修改 / please change".to_string(),
                },
            ).await;
            println!("request_changes linked: {:?}/{:?} steps={:?}", changes.status, changes.code, changes.steps);
            assert_eq!(changes.status, GithubWriteState::Confirmed);
        }

        if let Ok(parent) = std::env::var("AI_ONE_GH_WRITE_E2E_PARENT") {
            let parent = parent.parse::<u64>().expect("AI_ONE_GH_WRITE_E2E_PARENT must be an integer");
            let child = create_issue(
                &gh,
                &CreateIssueArgs {
                    repo,
                    title: format!("ai-one sub-issue e2e {stamp}"),
                    body: "Disposable sub-issue relation test".to_string(),
                    parent_spec: Some(parent),
                },
            ).await;
            println!("sub_issue: {:?} issue={:?}", child.status, child.issue_number);
            assert_eq!(child.status, GithubWriteState::Confirmed);
        }
    }
}

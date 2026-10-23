# GitHub 写入桥（L1 / Spec #106）

## 固定动作

前端通过 `host.githubWrite` 调用五个写动作；另有只读的 `status()` 探针检查本机 `gh auth status`。

- `createIssue({ repo, title, body, parentSpec? })`：新建 Issue，不加标签。可选 `parentSpec` 会在创建并回读确认后建立原生 Sub-issue 关系。
- `comment({ repo, issue, text })`：发 Issue 评论。
- `setPause({ repo, issue, state })`：`state` 只允许 `paused` / `running`，通过评论表达暂停或继续。
- `accept({ repo, issue, pr, expectedHead })`：校验 PR 开放状态、当前 HEAD 和 Issue 关联，再评论并确保移除 `needs-user`。
- `requestChanges({ repo, issue, pr, expectedHead, text })`：同样先校验，再评论并确保添加 `needs-review`。

Rust 端重新校验所有参数。前端不能指定路径或 HTTP 方法。JSON 请求体经 stdin 传给 `gh api --input -`，不经过 shell。评论和新 Issue 都会回读；HEAD 或关联校验失败时不会发送写请求。

## 评论格式

所有代用户发出的评论都以 `【ai-one 代用户发出】` 开头，最后一行是动作标记：

- `<!-- ai-one:comment:v1 -->`
- `<!-- ai-one:set_pause:v1 -->`
- `<!-- ai-one:accept:v1 -->`
- `<!-- ai-one:request_changes:v1 -->`

暂停和继续的正文分别是“用户已暂停：请停止派发新工作，正在进行的一步可完成。”和“用户已恢复：可继续派发。”验收与要求修改的评论包含完整 HEAD。用户输入中出现 `<!-- ai-one:` 会被拒绝，避免意外伪造标记。

## 结果状态与安全边界

- `confirmed`：每一步均回读确认。
- `partial`：至少一步已确认，另一步明确失败；不自动重试。
- `unconfirmed`：写请求已发出，但回读或超时使结果不确定；后续步骤会跳过。先手动回读，不要重发。
- `failed`：没有写入，或首个写请求明确失败。

`accept` / `requestChanges` 会比较 Rust 端刚读取的 PR HEAD 与 `expectedHead`（不区分大小写），并要求 PR 关联指定 Issue。关联可来自 `closingIssuesReferences`，或 PR 正文里的 `Closes/Fixes/Resolves`（含 close/fix/resolve 的时态）后接 `#N`、`repo#N` 或同仓库 `owner/repo#N`。Issue 编号严格匹配，`#12` 不会误匹配 `#1`；PR 必须处于开放状态。

父子关系使用 GitHub 原生 Sub-issue API，创建新 Issue 后才挂到 `parentSpec`。挂接明确失败时返回 `partial`，保留已创建的 Issue 号与 URL，不自动重复建单。

**已知限制：**用户与 agent 共用同一个 GitHub 账号，无法证明评论一定由 ai-one 写入。前缀与隐藏标记只区分格式，不能防篡改。桥不合并 PR、不关单、不删评论、不改已有 Issue 标题或正文，也不修改除 `needs-user` / `needs-review` 之外的标签。

## 调用示例

```ts
const status = await host.githubWrite.status();
if (status.available) {
  const result = await host.githubWrite.comment({
    repo: 'owner/repo',
    issue: 12,
    text: '请先补充验证结果。',
  });
  if (result.status !== 'confirmed') {
    // 按 steps 检查结果；unconfirmed 时先回读，不要自动重试。
  }
}
```

五个动作的入参类型分别是 `GithubWriteCreateIssueArgs`、`GithubWriteCommentArgs`、`GithubWriteSetPauseArgs`、`GithubWriteAcceptArgs` 和 `GithubWriteRequestChangesArgs`。

## 真实 gh 端到端测试

默认忽略，不进入 `pnpm verify`。先在隔离的测试仓库完成 `gh auth login`，准备一个与测试 Issue 无关联的现有 PR，再设置环境变量后运行：

```powershell
$env:AI_ONE_GH_WRITE_E2E_REPO = 'owner/repo'
$env:AI_ONE_GH_WRITE_E2E_PR = '123'
# 可选：父 Spec 编号
$env:AI_ONE_GH_WRITE_E2E_PARENT = '45'
cd src-tauri
cargo test real_github_write_e2e -- --ignored --nocapture
```

测试会真实创建临时 Issue、评论并切换暂停状态，然后验证错误 HEAD 和无关联 PR 都会被拦截；可选的父 Spec 用于验证 Sub-issue 关系。测试 Issue 不会自动删除。

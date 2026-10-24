# agent-entry：一句话接手

给手上已有的 agent（Claude Code、Codex、WorkBuddy、Antigravity 等）一个统一入口。底层是 `scripts/issue-claim` 的认领锁，这里只负责“挑哪个”和“怎么开工”。需要 `gh` 已登录。

```bash
node scripts/agent-entry/cli.mjs board
node scripts/agent-entry/cli.mjs recover
node scripts/agent-entry/cli.mjs take --agent "Codex / 会话标识"
node scripts/agent-entry/cli.mjs take 109 --agent "Codex / 会话标识"
node scripts/agent-entry/cli.mjs take --agent "Codex / 会话标识" --dry-run
```

- `board`：列出开放的 Spec/Task，标 空闲 / 已认领（谁）/ 有 PR 无认领锁 / 阻塞 / 需指定编号。
- `board` 对疑似失联或时钟异常的认领加 ⚠ 标记（#139），并在列表下面再列一段「疑似失联」：谁持有、静默多久、有没有开放 PR，以及要先跑哪条只读交接、确认停写后再跑哪条 `takeover`。
- `recover`：只列出这段「疑似失联」，不动任何认领锁。没有可自动认领的空闲 Issue 时，`take` 也会把这段打出来，避免直接走进死胡同；成功认领别的任务时只用一行提示还有几条疑似失联。
- **失联不等于空闲**：心跳过期只说明没人续期，旧执行者可能还在跑，而且所有 agent 共用同一个 GitHub 账号。所以 `recover` 只给只读的下一步，真正的接管仍要人先确认旧写入者已停，再带 `--stopped-evidence` 跑 `takeover`；确认不了就换别的 Ready 任务，不要删别人的 `claim`。时钟异常（时间戳在将来或不可读）显示为 `HANDOFF_BLOCKED`，它不进接管列表，只能人工或协调者查。
- `handoff <N>`：只读，旧持有者没写 Handoff 时从 Issue、关联 PR、完整 HEAD、改动文件、审查与 CI 重建「有证据 / 待核对」交接稿，不写任何东西。
- `take`（不带编号）：只在“明确可认领”的 Issue 里挑——有 `Priority` 或 `Stage: PLANNED`、没人认领、没有 `blocked` 标签、没有开放 PR。排序：推荐 agent 与你的工具匹配的优先，再 P0 < P1 < P2，再编号小的。
- `take <N>`：指定编号（总括 Spec、无派工字段的老 Issue 用这个）。
- 认领成功（退出码 0）会打印开工指引；已被别人认领退出码 2，停手换一个；1 是用法或网络错误。
- 不会替你建工作树、改 Issue 或判断 `Depends on` 是否满足，这些由接手的 agent 按指引做。
- “有 PR 无认领锁”多半是认领锁出现之前就在做的线，先问用户，不要自己抢。

## 让 agent 接手（给用户的一句话）

> 按 AGENTS.md 接手 ai-one：在仓库根目录运行 `node scripts/agent-entry/cli.mjs take --agent "<你的工具名> / <会话标识>"`，按输出开工。

## 测试

```bash
pnpm entry:verify
```

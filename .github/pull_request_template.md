## 关联 Task / Spec

Closes # <!-- 已满足关闭验收时才写；仅有父 Spec 时不误关 -->
Spec: # <!-- 无父 Spec 填“不适用” -->

## 风险分类与门禁（快速开发模式 v2）

- Risk: <!-- LOW / MEDIUM / HIGH -->
- Complexity: <!-- ROUTINE / DEEP，独立于 Risk -->
- 风险理由（含修改范围、影响路径、为什么不是更高等级）：
- 依赖 Issue / PR（未合入则不得声称 READY）：
- 当前完整 HEAD SHA：
- 已知未解决 BLOCK / REVISE / BLOCKED：<!-- 无 / 列出链接 -->
- 合并责任人：<!-- 本线登记的调度 agent -->

LOW 仅适用于不改变生产行为、接口、权限、并发、持久化、删除归档、构建升级或安全/工程门禁的改动；当前 HEAD 有自动验证结果、验收完成、无任何已知阻断时可不等独立 PASS 由本线调度者合并。风险不明升 MEDIUM。MEDIUM/HIGH 必须有与作者、修复者独立的当前 HEAD PASS；旧 HEAD 的 PASS 无效。

## 实现内容与边界

-

## 验收及验证（当前完整 HEAD）

- 对应 Task 验收：
- 静态核查（真实 diff、关键边界）：
- 自动验证（**实际命令或 Actions run URL、HEAD、结果**；未运行写“未运行”）：
- CI（当前 HEAD 的检查名称与结果；未运行写“未运行”）：
- 实际运行（命令 / 环境 / 结果；未运行写“未运行”）：
- 需用户后置体验验收（若有，登记 needs-user；不能把风险必需验收后置）：

## 风险与未验证项

-

## Handoff 与资源收尾

- 分支 / 完整 HEAD SHA：
- PR 链接 / 当前 Review 状态（LOW 可为“不作独立门禁”）：
- 下一执行者：
- 阻塞与可执行的下一步：
- 合并后需核查：Issue 状态、claim、worktree、分支、Prodex 槽位/线程及下游 PR 依赖

<!-- 合并只能由 Issue 登记的本线调度 agent 按 main/AGENTS.md 的实际生效门禁执行；本模板自身不是授权。 -->

# AI 协作工作台：项目协作约束

## 项目与范围

- 产品目标是复用用户已有的 AI 网页订阅与原生工具，让多个 AI 独立取证并自动交换完整回复，支持暂停、人工接管、恢复及会话交接。
- **当前产品方向与阶段优先级以 [Spec #32](https://github.com/xiaolebao516/ai-one/issues/32)（xiaolebao516/ai-one#32）为准**；旧 V1 Epic（#1）及其子任务、`docs/design/` 中的 V1 设计是历史参考，不再单独作为现行需求。实现范围以各 Spec / Task Issue 为准。旧 V1 曾把 Bridge、CLI Agent、远程控制、智能历史压缩列为不做；这不是永久禁止，是否及何时实施由 #32 与对应的有效 Spec 或独立 Task 决定，没有对应 Issue 不实现。
- UI/UX 的当前依据是 #32 及其后续设计 Task 的成果（目前为 #33 交付的 `docs/design/v2-product-design.md` 与 `docs/design/v2-prototype/`，与 #32 冲突时以 #32 为准）；`docs/design/` 的 V1 文件仅作历史参考。技术依据为 `TECHNICAL-RESEARCH-V1.md` 与 `research-evidence/`。这些文件只在对应 Issue 的范围内修改。Agent HUD Open 仅作视觉参考。
- 上游仓库克隆、依赖安装和验证放在仓库外的独立临时目录，记录上游提交 SHA 与验证记录。
- AGENTS.md 只保存稳定工程规则；需求、结论和任务进展记录在 Issue 与 PR 中，不维护 `progress.md`、`state.md` 等重复文档。

## 快速开发模式 v2（当前生效，用户 2026-10-23 决定）

本节优先于下文与之冲突的旧条款。任何 agent 进入本项目都按本节工作，不需要用户重述。

- **谁做什么**：用户只定方向、做最终验收、处理真实账号操作（登录、验证码等）。Opus（本地 Claude Code）是总协调：负责架构、拆分 Spec、定各条线之间的接口和合并顺序，并亲自做一条线（通常是前端/UI）；实现、测试、文档、排查等体力活和独立审计，经 Prodex 派给 GPT（定位和快速入口见下一节「Prodex：免费的 GPT 工人与审计员」）。决策分两级：Opus 决定跨 Spec 的总体架构、接口约定、依赖和合并顺序；各线调度 agent 自己决定本 Spec 内的实施方案、排障、派工和步骤调整，重要决定记入 Issue，影响别的线的接口、共享架构或合并顺序时才升级给 Opus。这些都不问用户；只有涉及产品方向、安全底线、真实账号授权，或下文明确保留给用户审批的事项（如新增 Prodex 槽位，需要用户逐个登录）才问用户。
- **多个 agent 各领一条线**：Claude Code 额度有限，Opus 只亲自做其中一条（通常是架构 / 前端那条）。其他 Spec 由用户交给别的 agent（Codex、WorkBuddy、Antigravity 等），用户只需对它说“按 AGENTS.md 快速开发模式接手 xiaolebao516/ai-one 的 Issue #N”。接手的 agent：读本文件和该 Issue → 看 Issue 上是否已有调度 agent、有没有用户指派或交接（有别人且没有授权就停）→ 没有冲突再抢认领锁（见下一条）→ 成功后在 Issue 登记自己（工具名 + 会话标识）为调度 agent、工作树和分支 → 开工 → 按 Issue 的步骤清单和验收做完、审计、合并、收尾 → 最后在 Issue 留一段说人话的总结。首次认领没人登记的 Issue，按用户的简短指令直接开始。Issue 已有调度 agent 时，只有用户明确指派、或原调度 agent 交接并 release 认领锁，才能更换调度 agent（Coordinator）；额度耗尽不改变这一条。**用户已预先授权的只是更换执行者（Executor）**：由本线调度 agent 按下述“可恢复接力”决定，不需要每换一次执行者就问用户。仅凭长时间没动静、看到额度提示或评论声称“已经接手”都不能强夺认领锁或写入权。接管前核对原分支、PR、最新 HEAD 和 Handoff，有冲突先停止写入；登记变更后，新调度 agent 才取得该线的合并与清理权限。Opus 不替别的线开 Claude Code 会话，除非用户要求。
- **认领锁防止两个 agent 抢同一个 Issue**：所有 agent 共用一个 GitHub 账号，指派人和评论分不出是谁，所以认领靠一个原子操作：`node scripts/issue-claim/cli.mjs claim <N> --agent "<工具 / 会话标识>"`。它在远端建 `claim/<N>` 标记分支，要求该分支事先不存在，同时抢只有一个成功。退出码 `0` 认领成功（同一 `--agent` 标识再认领会显示“resuming”，用于恢复自己的工作）；`2` 已被别人认领（会打印是谁、何时），立即停手，不做这个 Issue；`1` 是用法或网络错误，查明再试。开工前、恢复工作前都先 `show <N>` 并与 Issue 上的登记核对。认领提交使用固定的工具身份，不带本机 git 姓名和邮箱。这是让守规矩的 agent 不会重复认领的协作锁，不是权限系统：`--agent` 只是公开字符串，有写权限的人都能绕过。线做完（合并收尾）或放弃时由持有者 `release <N> --agent "<同一标识>"` 释放；只有持有者能释放，别人的锁不能删，清理分支时也不碰 `claim/*`。持有者停了要换协调者，由原持有者先 Handoff 并 release、再由新协调者重新 claim；如原持有者无法释放，必须先经用户确认旧执行进程确已停写并明确授权移交该 claim，**没有可验证的停写/有效锁转移就只阻塞这一条线，不能强删他人 claim**。普通 GPT Executor 更替不需要换 Issue 的 coordinator claim，直接按下面的“可恢复接力”交接同一分支的唯一写入权。
- **派工必须带可领取信息**：新建每个 Spec/Task Issue 必须在正文显式写 `Priority: P0 | P1 | P2`、`Recommended Agent`（推荐首选工具/模型及原因，例如 CC/Opus 擅长架构集成、Codex 擅长本机实现、GPT 经 Prodex 擅长 GitHub 例行修改/独立审计）、`Backup Agent`（候补）、`Depends on`（前置 Issue/PR 的**具体完成条件**或“无”）、`Ready when`（何时可认领）、`Current Coordinator` 与 `Current Executor`（没有则“待认领”）。推荐人选**不是排他所有权**，有空且符合能力、依赖已满足的其他 Agent 可按正规认领接手；别因默认推荐 CC 就占用它的额度。优先级 P0 为阻断可用性/安全/主线集成，P1 为重要功能，P2 为改善；在 Issue 与 Handoff 里持续回写状态，不复制多套任务看板。优先级或推荐人选变化属于调度调整，不自动改需求版本。
- **可恢复接力：额度耗尽不锁死任务**：Issue 的 `Coordinator`（持有 claim 并负责合并）与每一轮实际写分支的 `Executor` 分离。Executor 额度见底、手动停工、退出或工具失效时应立即停止新派工，**先固化已完成代码**（能提交的提交并推送；不能提交的本机未跟踪/未提交工作在 Handoff 中注明路径与保存责任，绝不能假称已推到 GitHub），写 Handoff（Issue、PR/分支、完整 HEAD、完成/未完成验收、真实测试和失败日志的位置、风险、下一步具体命令、当前进程/发送结果、预计接替人），然后明确交还唯一写入权。协调者确认原 Executor 已停止提交/运行且没有未完成写入、GitHub HEAD 未被新提交改变，再让候补或任何合适 Agent 沿原分支和原 PR 从最新 HEAD 继续；接替者重新验证并更新 Issue 的 Current Executor，不重新建平行分支。**Executor 变更不需要新 Issue、用户再次批准或释放 Coordinator 的 claim**；额度耗尽不是“这个 Issue 已被占用所以没人能做”的理由。若 Coordinator 自身额度耗尽，应 Handoff、停止写入并释放 claim，由候补 claim 后登记新 Coordinator 再继续。对于无法交接的失联 Coordinator 或仍可能运行的旧 Executor，不能仅凭超时/推测抢写：记录 `HANDOFF_BLOCKED`、保护现有成果、继续其他 Ready 任务，并交给用户/Opus 按证据协调停工和安全的锁移交。Prodex 请求结果不明时先 recover，禁止新 Executor 盲重发。推荐候补不等于能够无证据抢占。
- **一个 Spec 一条线**：按需求拆成彼此尽量不冲突（不改同一批文件、不互相等待）的 Spec Issue。一个 Spec 由一个调度 agent 负责，它调度 GPT 干活，对应一个工作树和一个分支（`<类型>/<Spec号>-<简述>`），开工时在 Spec Issue 登记调度 agent、工作树路径和分支。Spec 内部的步骤用 Spec 正文的清单跟踪，不强制为每步开 Task；步骤需要单独审查时再开子 Task，子 Task 沿用父 Spec 的工作树和分支，汇入该 Spec 的交付 PR，不另建工作树或分支（确需拆开时由本线调度 agent 调整拆分，影响别的线时找 Opus）。很小的独立改动可以只开一个独立 Task，用自己的工作树、分支和 PR，流程相同。
- **风险门禁（方案 A）**：PR 的合并风险按实际完整 diff、所触及系统、下游影响分为 `LOW / MEDIUM / HIGH`；**与 Task 的 `ROUTINE / DEEP` 工作复杂度独立**。执行者在 PR 中写明风险级别、具体理由和必要验证，调度 agent 合并前复核。风险不明、分类有争议或与已知阻断意见冲突，至少按 MEDIUM 处理；不能靠切碎 PR、改文件名或仅测试绿把实际高风险改动降级。
- **LOW 才可不等独立 PASS**：仅限局部文案、纯视觉样式、无生产行为影响的文档、测试说明文字等；改动测试断言、期望值、fixture 或删减用例的至少按 MEDIUM（它们能把本该失败的测试改成通过）；必须确证**不涉及**生产行为/业务逻辑、共享接口、外部写操作、安全权限、账号/会话、并发、持久化、归档删除、构建/安装/升级、公共依赖及工程门禁。要求最新完整 HEAD 的必要自动化验证确实通过（有实际命令或 CI run 及结果；不能仅凭“预计能过”）、Task 局部验收满足、审查全部现有意见且**没有未解除的 BLOCK/REVISE/BLOCKED 或其他已知阻断问题**、依赖已满足、PR 可合并。只允许 **Issue 登记的本线调度 agent** squash 合并并安全收尾；不强制独立审计 PASS。缺少可运行验证时不得以 LOW 快速合并；等待验证就继续做别的 Ready 任务。
- **MEDIUM / HIGH 独立门禁不变**：中风险（可能影响局部功能、状态或用户可见交互）与高风险必须由非作者、非该 HEAD 修复者的独立 Reviewer 对**当前完整 HEAD** 审计并给 PASS，必要测试/真机证据已核实后，才由本线调度 agent 合并。**HIGH 包括**账号/凭据/权限、GitHub 写桥或其他外部写入、删除/归档、跨会话串线、调度/锁/并发恢复、持久化/数据丢失、升级/打包/CI/安全边界、跨线共享架构，及**本文件的风险分级/合并授权规则本身**；高风险没有特批快速通道。此前 PR 的 REVISE/BLOCKED 不因切换 v2 自动作废；先复核真实问题并在同一完整 HEAD 关闭。
- **审计只阻断真实问题**：`REVISE` 用于可复现或有明确代码路径的安全、数据、核心行为/明确验收失败，并写文件行、条件、后果与最小修复；风险必需的测试/运行证据缺失给 `BLOCKED`，说明补证据步骤；`PASS` 表示没有该 HEAD 的合并阻断问题。样式偏好、可推迟的边缘优化、无实证的猜测记 `follow-up`，不触发无限制的全量返工。影响安全/正确性的真实边界条件即使罕见也不能降级。修复更改 HEAD 后旧 PASS 无效，新 HEAD 由独立对话重审；没有新代码时可向原 Reviewer 追问澄清。
- **排队审计与执行解耦**：执行者完成提交/自动验证/Handoff 后将任务记为 `REVIEW_QUEUED`，释放本轮 Prodex 占用和线程资源，改领**其他独立分支**已满足依赖的 Ready 任务；不占着 CC 或 Prodex 等审计。中高风险审计待机或 Prodex 故障记 `REVIEW_BLOCKED`，保留 HEAD、线程/request-id、恢复动作与责任人；短时有界重试或切换到真正独立、可用的审查渠道，禁止无限轮询、重发不明结果或把失败说成 PASS。同一分支写入权仍唯一，收到阻断意见再交回原 Owner 批量修复。
- **Fast / Deep 互补**：日常 Fast 聚焦所改路径及高风险边界，让 LOW 快速落地。夜间 Deep 可由用户另行发起/调度，对当天已合并 LOW 和待审中高风险进行更深入的批量回归；发现新问题开修复 Task 并标明影响，不能倒填旧 HEAD 的 PASS。**没有实际定时任务就不得声称已启动夜间自动审计**；高风险合并前独立审计不能推迟到夜间后置。
- **依赖优先与收口**：Opus 管理跨线依赖/共享接口及可执行 Ready 队列；`READY → IMPLEMENTING → REVIEW_QUEUED/REVIEW_BLOCKED/HANDOFF_BLOCKED → FIXING/MERGE_READY → CLOSEOUT → DONE` 为调度用状态词（写在现有 Issue/Handoff 中，不另建进度真相源）。依赖未合入或写入权冲突的任务不可抢跑。调度按完成可用增量/等待时长/审计轮数而非同时开的会话数评估吞吐量；限定共享文件的同时写入。合并后按原有“干完立刻收尾”执行：确认 PR 真正 MERGED、清理可安全回收的 worktree/分支/认领锁、释放 Prodex 资源；依赖尚在、未提交用户工作或其他 Owner 的资源不得动，记阻塞与下次触发条件。
- **干完立刻收尾**：合并成功后同一轮内关闭对应 Issue，检查并安全回收本线工作树和本地/远程分支，释放不再用的 Prodex 槽位，然后再接下一件事，不拖着并行开新坑。删除前照「工作树与分支生命周期」核查未保存成果和开放 PR 依赖；条件不满足就记录原因和下次清理的触发条件，不强删，也不因此停下别的工作。
- **哪些验收可以后置**：两类分开。①**合并前必须有的证据**：Spec/Task 验收里写明的编译、自动测试、真机运行等，由调度 agent 自己在本地跑或手动触发 CI，证据写进 PR；缺少风险必需的验证就不能合并（MEDIUM/HIGH 审计应给 BLOCKED；LOW 快速通道直接暂停），但不影响其他线。②**可以后置的用户确认**：主观的 UI 观感、使用体验、只有用户能做的真实账号流程。②写进该 Spec 的「待用户验收」清单（看什么、在哪里/怎么操作、预期结果），给 Issue 打 `needs-user` 标签，照常合并收尾，接着做别的；后置的项不得写成“已验收通过”。攒到一批有分量的成果后统一告诉用户；用户看完没问题就去掉标签，有问题就开新 Spec 修。只有真实账号操作卡住时才必须等用户，且只停那一条线。
- **跟用户汇报说人话**：先说做出了什么、现在能用什么，再说需要用户看什么、在哪里看、怎么操作（能给直接打开的链接或命令就给）。不罗列 Issue/PR 编号、分支、SHA 和内部术语，这些留在 Issue/PR 里给 agent 看。

## Prodex：免费的 GPT 工人与审计员（快速入口）

Prodex 是本机命令行工具，用来唤起用户已登录的 ChatGPT 网页，让 GPT 干活。它复用用户现有的 ChatGPT 订阅，**不额外消耗 Claude 等其他 agent 的额度**，所以能派就派。

- **默认档位**：正式派工（执行、审计、讨论）一律显式传最高档 `--effort high`（2026-10-22 账号的最高档；不确定时先 `prodex pro browser models` 看，菜单出现 Pro 就用 `--model Pro`）。以回复里实际生效的档位为准，参数传了不等于生效；无法核实时写 `UNVERIFIED`。只有测试 Prodex 本身才用即时档，测完恢复；测试会在用户账号里留下对话，事先告知用户并标明是测试。
- **GPT 能直接操作 GitHub**：它在网页里带 GitHub 连接器，可以读仓库代码、推分支和提交、开 / 改 PR、写 Issue / PR 评论，并按快速开发模式的条件合并、关单。派工时直接让它做这些写操作，不要只让它“给建议”再由 agent 抄一遍；写操作结果以回读 GitHub 为准。
- **默认并行 worker**：调度 agent 拆好步骤后，实现、测试、文档、排查默认都派给 GPT，能并行的同时派到不同槽位；agent 自己只做被显式指定由它做的部分（架构、跨线接口、前端观感、本机真机运行、需要本机环境的验证）。
- **按风险派异步审计**：MEDIUM/HIGH PR 默认派独立 GPT；LOW 不占审计门禁队列，但可进入夜间抽检。审计请求应携带准确 HEAD 和有限的风险/验收范围；`run` 后台执行并不代表可以无限等待，队列/浏览器失败时按 v2 的 REVIEW_BLOCKED 恢复或切换。作者不审自己。
- **审计员有把握就让它直接改**：审计发现的问题小而明确、审计员有把握时，可以让它直接在 PR 分支上提交修复。顺序：① 调度 agent 先确认执行方已停止写这个分支，把唯一写入权交给审计员；② 审计员基于最新 HEAD 提交，只改指出的问题，逐条说明改了什么；③ 调度 agent 回读这次提交的 diff 并跑必要验证；④ **修复者不能给包含自己修改的 HEAD 签 PASS**，必须换一个与修复无关的新对话审计完整新 HEAD。改动大、有争议或涉及别的线时，仍交回执行方改。
- **追问和复审分开**：没有改代码时，对审计意见追问、澄清可以续用原对话；只要审计员或执行方提交了新代码，对新 HEAD 的复审按上一条处理（修复者之外的对话），作者自己的对话不能给自己签 PASS。

**快速入口（Bash 写法，命令细节见 `scripts/prodex-slots/README.md`）**

```bash
# 1. 看有哪些槽位、当前谁在用
node scripts/prodex-slots/cli.mjs list
# 2. 开新对话派工 / 审计：自动挑空闲槽位，满了排队；回复只写进本地文件。
#    err.log 里的 "using slot N" 是这次用的槽位，reply.md 第一行有对话地址：两样都记到本地笔记
node scripts/prodex-slots/cli.mjs run --slot auto --task <Issue号> --session <你的标识> --wait-ms 1800000 \
  -- --new-chat --effort high --stdin --timeout-ms 1800000 < prompt.md > reply.md 2> err.log
# 3. 在同一个对话里继续（追问、同一审计员的下一轮）：必须用这个对话所在的槽位 N
node scripts/prodex-slots/cli.mjs run --slot <N> --task <Issue号> --session <你的标识> --thread-url "$THREAD" \
  -- --target-url "$THREAD" --confirm-target --effort high --stdin < next.md > reply2.md 2> err2.log
# 4a. 结果不明（request_mismatch、超时），对话在 1 号槽位：不重发，按 request-id 取回（不设锁文件变量）
env -u PRODEX_SEND_LOCK_FILE PRODEX_CDP_PORT=9333 \
  prodex pro browser recover --port 9333 --target-url "$THREAD" --request-id <id>
# 4b. 对话在 N≥2 号槽位：带上该槽位的端口（9333+N-1）和锁文件
PRODEX_CDP_PORT=<端口> PRODEX_SEND_LOCK_FILE="${PRODEX_SLOTS_HOME:-$HOME/.local/share/prodex}/browser-send-slot<N>.lock" \
  prodex pro browser recover --port <端口> --target-url "$THREAD" --request-id <id>
```

**并行时怎么不冲突**

- 一个槽位同时只服务一个对话；`run --slot auto` 只挑空闲槽位，全忙时按 `--wait-ms` 排队（退出码 4），不往别人正在进行的对话里塞消息。
- **槽位“就绪”不等于没有待续的对话**：`run` 一结束就释放占用，之后别人用 `auto` 开新对话可能落到这个槽位，把页面切到新对话。`list` 只显示正在进行的占用和最近一次显式 `release` 的记录，找不回历史对话在哪个槽位。所以要续聊的对话，派工方自己记下槽位号、对话地址和 request-id（本地笔记，私有对话地址不写进 Issue），并尽量在一轮结束后马上续聊。槽位工具没有跨轮预约；页面已被别人切走时，原对话仍在 ChatGPT 历史里，但不保证能用 `--target-url` 回到它，这时新开对话并在提示词里交代前几轮的结论。
- 续聊必须用对话所在的槽位（`--slot N`）。用 `auto` 可能挑到别的槽位，报 “No open ChatGPT tab matches the confirmed target URL”；这时消息没有发出，换对的槽位重试即可。
- 恢复（recover）是直接调用 Prodex，不经过 `run`，要按上面 4a / 4b 带对槽位的端口和锁文件；N≥2 不带锁文件会去等 1 号槽位的锁，表现为“另一个发送占着浏览器”然后超时。
- **同一个分支严格串行写入**：同一时间只有一个写入者（agent 或某个 GPT 对话），调度 agent 负责交接写入权；派 GPT 改某个分支时，调度 agent 自己不在这个分支提交。文件不重叠也不能同时往同一个分支提交（会基于旧 HEAD 或互相覆盖引用）。要并行，就让各个 GPT 在不同分支上做，或者先并行准备、再按顺序逐个提交。
- **暂停 / 继续规则**：每次派发新工作前先读目标 Issue，并找出最新一条同时带固定前缀 `【ai-one 代用户发出】` 与标记 `<!-- ai-one:set_pause:v1 -->` 的暂停/继续评论；若其正文表示“用户已暂停”，就不派发，等待读到更新的有效继续评论。
- 提示词：实测新对话正文出现 `github.com`（链接或域名）时常误报 `request_mismatch`，几十 KB 的长提示词也会；所以用 `owner/repo`、`#N`、SHA 代替域名，大段代码优先让 GPT 用连接器自己读，提示词里只给 HEAD、范围和要点。这是规避经验，不代表所有 `request_mismatch` 都是误报：一律按第 4 步取回核对，不重发。
- 回复正文只存本地文件，不贴进 Issue / PR / 共享日志；Issue 里只写这一轮的要点、结论和阻塞。
- 退出码 3（要登录、验证码、窗口被收起）：停下这一路，告诉用户哪个槽位要处理；其他线照常。工具提示要手动删的残留文件（如 `slot-N.json.reap`），确认没有槽位命令在跑后请用户删，agent 不自己绕过。

## 分工

- 用户：确定方向、做最终验收、执行或授权真实账号操作。合并由登记的调度 agent 在对应风险门禁满足后自行完成（见快速开发模式 v2）。
- Opus（本地 Claude Code）：协调入口，负责架构、拆分与调度、前端/UI/UX、桌面运行与实际测试。
- GPT（经 Prodex 调用 ChatGPT，必要时用 GitHub 连接器）：按各线调度 agent 的派工做实现、测试、文档、排查和独立审计。
- 其他 agent（Codex、WorkBuddy、Antigravity 等）：由用户指派，各自作为一条 Spec 线的调度 agent，规则与 Opus 的线相同。
- Spec/Task Issue 写明调度/执行 Owner 和风险级别；MEDIUM/HIGH 还必须记录独立 Reviewer，LOW 可写“独立审计不作为门禁”。作者不能把自审当成独立 Review。模型分工是默认，不硬编码身份，也不得假报实际模型 / 档位。

## 执行纪律：过程汇报与收尾

- **过程汇报只约束会长时间静默的执行环境**：预计连续 5 分钟没有可见输出时（WorkBuddy 这类），开工先报目标、验收口径和第一步，之后每 5 分钟、完成关键步骤或遇到阻塞时报一次「做了什么 / 验证状态 / 下一步」；被工具调用卡住的，结束后立即补报。本来就有持续可见输出的 agent（如 Claude Code）不受定时汇报约束，只在关键结论和阻塞时说明。
- **阻塞报告三要素**：现象与证据、缺什么（权限 / 环境 / 用户操作）、恢复动作。禁止用“处理中”“快好了”代替。
- **收尾统一用 STC（Simple Technical Chinese，简单技术中文）**：先给结论，短句、具体、少术语、少 Markdown，只讲交付了什么、验证结果、遗留问题和下一步。不强制三段式，也不贴原始日志。对用户的汇报按快速开发模式「说人话」：讲成果和要用户看的东西，不堆编号和术语。
- 静态审查、CI、实际运行分别说明；未运行写“未运行”，未证实写“待实测”。

## Issue-first：Spec、Task、PR 与 Handoff

- **两种 Issue**：`[Spec]` 负责需求的目标、行为、约束、非目标与**整体验收**；`[Task]` 负责一个可独立执行、独立审查的交付增量及**局部验收**。简单明确的需求直接使用独立 Task，不必创建父 Spec 或额外 Markdown 文件；复杂需求使用 Spec 父 Issue 和可验收的 Task 子 Issue，避免在每个子任务复制完整需求。
- **待设计是合法状态**：Spec 使用 `.github/ISSUE_TEMPLATE/spec.md`，写明负责人、`Spec Revision: v1`、阶段与可检查的交付标准。阶段 `DESIGN_PENDING` 允许暂时没有实施方案、没有子 Issue，但不允许假称可直接执行。进入实施阶段前，先在 Spec 正文列出可验收的步骤清单；步骤需要单独审查时再拆为子 Task。只有真实 GitHub Sub-issues 关系才算建立了父子结构；仅在正文引用 `#N` 不算。工具不能建立原生关系时应报告待关联，不能伪报完成。
- **Task 应小而完整**：Task 使用 `.github/ISSUE_TEMPLATE/task.md`，说明本次交付、范围/非目标、优先级、推荐/候补 Agent、前置依赖及可认领条件、可核验验收及验证手段、Owner、Reviewer、`Complexity: ROUTINE | DEEP` 与 `Merge Risk: LOW | MEDIUM | HIGH`；如有父 Spec，记录其 Issue 和已检查的 `Spec Revision`。粒度以“一次独立 Review 能确认的交付”为准，不按文件或 commit 机械拆分。有父 Spec 的 Task 沿用父 Spec 的工作树和分支（见快速开发模式）；独立的代码 Task 用一个工作分支和一个主要 PR。分支命名 `<类型>/<Issue号>-<简述>`，例如 `ai/29-issue-first-workflow`；非代码 Task 可以用可核实成果完成。临时研究/聊天不强制创建 Issue。
- **变更与重审**：Spec 目标、边界、验收发生实质变化时，负责人先将 `Spec Revision` 递增，并以评论记录改动、原因和影响；所有关联的未完成 Task（含已开 PR）都必须重审，并记录核对的新版本及影响结论。在核对完成前暂停受影响的实施及验收；无影响可继续、范围变化应更新 Task 并复审 PR、失效任务可拆分或取消。排版错字无需升级版本。现有 `docs/SPEC.md`、`docs/PLAN.md` 属于需保留的**遗留产品基线与约束**；新 Spec Issue 不得静默覆盖既有安全/架构要求：与安全要求冲突时由用户先裁决；跨 Spec 共享架构的技术取舍由 Opus 决定、本 Spec 内的由本线调度 agent 决定，都在 Issue 记录理由。
- **完成与及时清理**：每种 Issue 都必须有交付标准。代码 Task 在局部验收、必要验证和 PR 合并（或明确认可的等价交付）后才能以 Completed 关闭；Draft PR 或 CI 绿不代表任务交付。Spec 必须按实际交付的风险门禁验收（MEDIUM/HIGH 独立 PASS）、全部必要子任务妥善处理后才可关闭；不能因子 Issue 全关就自动宣称 Spec Done。待用户亲自验收的项不阻止关闭，按快速开发模式记入「待用户验收」并保留 `needs-user` 标签。尚未实施的 Spec 可保持 Open / DESIGN_PENDING。取消、重复或不实施的任务说明原因，以 GitHub **Not Planned** 关闭；完成交付使用 Completed。保留历史，不删评论/PR。
- **恢复与交接**：启动/恢复任务前先获取明确的 Issue 入口（仓库+编号或 URL）；无入口、权限不足时报告阻塞，不猜测任务或进度。接手 Task 读取本文件、Task 正文、父 Spec 最新正文和修订记录（如有）、最新 Handoff、当前分支/PR HEAD、Review、CI。Handoff 只是线索，不是事实；遇到 Spec 版本未重审、HEAD 不匹配或其他冲突先说明并停止危险写入。不要求用户重述聊天。同一 Task 默认只允许一个活动写入者，这是协作规则而非技术锁；接力继续原分支和 PR，不重复创建。
- **派工与升级**：协调者按风险和不确定性分级：ROUTINE 优先低成本/免费模型做已明确的实现、文档和测试；DEEP 交给适合的强模型做架构、排障、关键审计；先检查 Issue 的 Priority、Ready when、Depends on、Recommended/Backup Agent，再基于当前额度和能力改派（推荐者没有绝对优先权）。遇到需求歧义、范围扩大、高风险边界或反复失败时，执行者给证据并请协调者决定咨询、升级、拆分，不自行扩权。复杂度只影响派工，不降低验收。派工记录期望模型/effort；无法核实实际档位写 `UNVERIFIED`。
- **PR 与 Reviewer**：实现 PR 指向 `main`。有子 Task 的 Spec：PR 用 `Closes #Task编号` 关联本次完成的 Task，父 Spec 用 `Spec: #N` 引用，整体审计完成后再关闭；没有子 Task、由 Spec 直接交付的：PR 可用 `Closes #Spec编号`，前提是满足整体验收和对应风险门禁；独立 Task 用 `Closes #Task编号`。PR 须标 `Risk: LOW | MEDIUM | HIGH` 并记录理由、依赖和当前完整 HEAD 验证证据。LOW 按上面 v2 快速门禁由本线调度 agent 复核合并；MEDIUM/HIGH 的独立 Reviewer 阅读最新真实 Diff、完整 HEAD、Task/Spec 验收、CI；审查评论以**所审完整 HEAD SHA** 开头，区分静态审查、CI、实际运行证据，并给 PASS / REVISE / BLOCKED。需要但缺少风险必需运行证据时 BLOCKED，写明可执行命令与通过条件；由 CI/具备环境者补证据再重审。Owner 修改后须在 PR 或 Issue 评论告知**新的完整 HEAD SHA**，供 Reviewer 定位；HEAD 更新后旧审查失效。风险升级或发现阻断问题时停用 LOW 快速通道。
- **Handoff / 不确定结果**：阻塞、额度用尽、责任切换、阶段结束或请求审查时，在 Issue/PR 用短评论记录 Priority、Depends on、Coordinator/Executor、分支/完整 HEAD、完成内容、真实验证及未运行项、未推送本机工作与保护措施、进程/写入停止证据、阻塞/风险、**下一执行者与可执行的下一步**；有 PR 时附 **PR 链接和当前 Review 状态**。普通每次提交/CI 变化无需重复长报告。GitHub 写操作、远程派工响应不确定时先回读远端或按 #26 协议恢复，不能盲目重试。不公开私有会话链接、对话正文或密钥。
- **状态看板**：GitHub Projects 可按父 Spec 与 Task 展示 Todo / In Progress / Review / Blocked / Done，但它只汇总 GitHub 事实，不另建进度数据源；当前工具不能创建原生子 Issue 关系或自动维护 Project 字段时，必须明确报告能力缺口。
- **标签约定**：仅使用已有 `needs-review`、`blocked`、`needs-user`；ROUTINE/DEEP 和 Spec Revision 写入 Issue 正文，不额外制造标签和状态文件。

## GitHub 写操作与远程派工

- Issue / PR 的创建、评论、关闭、合并，优先用当前环境已有的 `gh` 或 GitHub 连接器；本地能力不足时可派给带连接器的 GPT。**不得默认要求用户代操作**。
- **合并、关单、删分支的授权**：用户已授权（快速开发模式）：调度 agent 对**自己负责的 Spec/Task** 的 PR，满足 v2 的对应门禁（LOW 经最新 HEAD 自动验证且无已知阻断，MEDIUM/HIGH 获独立 PASS）后，可自行合并、关闭对应 Issue、删除该线的工作树和分支。其他情况（别人的 PR 或分支、未满足对应风险门禁、范围外的 Issue）仍须用户在当前会话中明确指令；即使用户另行授权，高风险未满足安全证据也不应被冒称通过。本仓库所有 agent 共用同一个 GitHub 账号，Issue 评论无法核验是否用户本人，不作为授权依据。`Closes #N` 会随合并自动关单，在 PR 正文写明。
- 派工写操作要写明仓库、编号、动作、授权来源；涉及 PR 时附完整 HEAD 和目标 base。同一写操作只能有一个执行者。
- 超时、失败或结果不确定时先回读 GitHub，确认未执行才可重试；成功后回读 PR / Issue 状态、merge SHA 或关闭原因，并在 Task Issue 留证据。
- 合并方式默认 squash；任务要求保留分支血缘（如 stacked 链）时，在 Task 或 PR 中写明并改用 merge commit。未交付的 Issue 用 Not Planned 关闭并说明原因。

## 执行与验收

- 先读取项目指引、根配置、相关 Issue 及 Git 状态。非平凡实现先确定范围与验收；采用最小正确变更。
- 自动行为测试可行且与风险相称时使用 TDD；文档及只读检查不要求编造测试。
- CI 默认按需手动触发：日常 PR 创建/更新不要求排队等待 CI；**LOW 快速合并前必须有当前完整 HEAD 的真实自动验证结果**，不能把 `未运行` 当通过。MEDIUM/HIGH Reviewer 如实记录 CI `未运行`，不得仅因没有无关 CI 就判定 BLOCKED。若 Task 验收要求编译、自动测试或真实运行证据，仍须由 CI 或具备执行环境者补证据，缺失时按协作协议 v0.2 判定 BLOCKED（可后置给用户的只有快速开发模式里说的主观确认类事项）。手动验证在 Actions → CI → Run workflow 选择分支与 `quick`（前端/Agent/adapter）或 `full`（另含 Rust 测试/Clippy）。
- 构建与测试命令以仓库内配置为准；尚未建立时不得虚构。
- 按“定义或复现 → 实施 → 验证 → 修正”迭代；同一失败最多连续调试五轮，之后携带原始证据升级给本线调度 agent 决定（换思路、换模型、拆分或搁置；执行者自己就是调度 agent 时自行决定），跨线问题才找 Opus；只有涉及产品方向、安全或账号时才问用户。
- 结论标注为已核实事实、静态推断或待实测。编译通过不代表网页登录、工具调用或完整回复转发通过验收。
- 不写虚假的 CI 或测试通过结论；未运行的验证明确写“未运行”。
- 不得把模型口头声称已查阅证据、文本暂时稳定或多模型意见一致，单独作为可靠性或真实性证明。
- **经 Prodex 并行派工（多槽位）**：Prodex 默认只有一个浏览器和一把整机发送锁，覆盖“发送到收完回复”全程，多个会话的派工会整段排队。需要并行时用 `node scripts/prodex-slots/cli.mjs`（命令、退出码和限制见 `scripts/prodex-slots/README.md`）：`list` 看各槽位状态，`run --slot auto -- <prodex pro browser ask 的参数>` 选一个就绪且空闲的槽位派工。槽位数量由派工的 agent 按任务量向用户提出，用户同意后才 `add --count N`，不自行扩容。需要用户的情况（登录、验证码、窗口被收起）工具以退出码 3 报告，转告用户，不自行绕过。不要只改 `PRODEX_SEND_LOCK_FILE` 而仍共用同一个浏览器（会串线），不要覆盖 Prodex 的发送间隔。`run` 会把 ask 的 stdout（即回复）原样透传，必须重定向到文件，不进共享日志或 Issue / PR。工具的未实现项和未验证项记录在 #61，遇到真阻塞再针对性解决，不要把这些项当成已验证的能力。
- **槽位调度入口统一看 `scripts/prodex-slots/README.md`**：按说明检查占用再派工，入口缺失或检查失败就报告阻塞，不擅自退回共用槽位；不预占槽位，也不把派工塞进别人正在进行的对话。
- **需要用户就停下这一路**：登录、验证码、窗口被收起时立即停下这次派工请用户处理，不读取、记录或转交 cookie / token；不依赖它的其他工作照常进行。
- **多轮讨论续用原线程**：以线程 URL 确认目标（`--target-url <线程 URL> --confirm-target`），并用该线程所在的槽位（`--slot N`）；`--continue` / `--continue-task` 在恢复或跨会话后不可靠，不作唯一手段。不要每轮开新 chat；只有原线程所在槽位不可用（比如残留文件卡住要等用户处理）时，才新开对话，并在提示词里交代前几轮的结论。
- **每轮在 Issue 留上下文**：把该轮提问要点、结论、阻塞写成短评论，作为可恢复的 Handoff；回复正文不进 Issue。
- **中断即停**：出现 `request_mismatch`、页签被切走或结果不确定时停止发送，先按 request-id、线程 URL 和 Issue Handoff 恢复核对，禁止盲目重发。
- **用完显式释放**：确认线程不再续用后释放槽位并核对实际状态，在 Task Issue 写明「本轮线程已闭合，槽位可复用」；未释放成功就记阻塞，不得宣称可复用。本阶段不自动删除聊天记录，线程状态与槽位占用分开管理。
- **已完成线程必须在闭合时归档（#94、#114）**：线程不再续聊（回复已用 request-id 核验、产物已保存、结论已写进 Issue Handoff）时，先在 Issue 发 Archive-ready 评论（格式见 scripts/prodex-archive/README.md），再用一条命令同时闭合槽位并归档：`node scripts/prodex-slots/cli.mjs release --slot N --task <Issue号> --thread-url "$THREAD" --request-id <ID> --handoff-url <评论地址>`。这是线程用完后的标准收尾，不要只 `release` 不归档，也不要把归档留给用户手点。需要保留的线程用 `scripts/prodex-archive/cli.mjs skip`。`release` 带 `--thread-url` 却没给证据时会提示“archive NOT attempted”；归档失败不影响槽位释放，但输出会写“archive NOT done”，必须看一眼并记录。本机策略默认 auto，可设为 manual。单条 ask 完成不触发归档；归档失败先人工核查，不盲目重复点击，更不能误归档个人聊天。注意 ChatGPT 页面状态可能延迟：点完归档后若侧栏或 Archived chats 暂时对不上，隔几分钟再看，别当场判失败。

## 账号与安全

- 真实账号登录、权限授予、密钥使用及真实外部写操作，只在用户已授权的范围内进行；不得复用其他工具的认证材料。
- 不新增工作台自己的写操作审批层，但不得绕过平台原生的授权、登录、验证码或限额。
- 不在仓库、Issue、PR 或日志中提交 cookie、token、密码、账号数据或网页对话正文。

## 工作树与分支生命周期

- **按需隔离，一 Spec 一工作树**：一个 Spec（或独立 Task）一个工作树、一个分支，子 Task 不另建；本地写代码或需要隔离运行时创建，纯远程、纯只读任务不建。禁止无 Issue 归属的工作树，包括 detached HEAD 的临时集成分支。
- **名字要能看出做什么**：目录 `<repo>-<Issue号>-<简述>`、分支 `<类型>/<Issue号>-<简述>`，例如 `ai-one-64-agent-execution-rules`。禁止只有编号——接手的人看不出里面在做什么。
- **创建时登记**：在对应 Issue 记调度 agent、路径、分支、交付范围与退出条件。
- **守住任务边界**：发现工作超出当前 Spec 验收范围时停手，另建 Spec 和工作树，不在原工作树里顺手扩大；本 Spec 内的范围由本线调度 agent 决定，跨线才找 Opus，涉及产品方向才问用户。
- **不再需要即检查回收**，不必等下游 PR 合并。删除工作树前核查进程占用、真实未提交与未跟踪文件（`git diff`、`git diff --cached`、`git ls-files --others --exclude-standard`）、可恢复性；Windows 上 `git status` 报 `M` 不足以判定脏（`core.autocrlf` 假脏）。
- **工作树与分支分开回收**：工作树确认安全即可移除；分支在无开放 PR 依赖、交付已确认（PR `MERGED` 或 Not Planned）后删除，本线分支的删除授权见快速开发模式。squash 合并事实只认 PR `MERGED`，不用 `git branch --merged` 或 `git cherry`。
- Task 完成或 Not Planned 关闭的同一轮内做能安全完成的清理；不能清的，在 Issue 记对象、原因和下次检查的触发条件。保留 HEAD、验证记录与 Handoff，不长期保留可重建的构建产物。
- 存量不合规资源在对应的清理 Task 中处理，不因本条新增而立即删除。

## Git

- 开工前先 `git fetch`，当前工作树没有本地改动时执行 `git pull --ff-only` 拉平 main；快进失败（已分叉或存在未提交改动）就停下报告，不做 merge 或 rebase。
- 索引陈旧会伪装成“有改动”：`git status` 报 `M` 但 `git diff` 与 `git diff --cached` 都为空时，用 `git add <这些路径>` 重建索引即可（不会暂存任何内容）；不要用 `git checkout` / `git restore` 去“清”它。
- `main` 工作树只做落地与读取，不在其中开发；任务一律从 `origin/main` 新建工作树，开工时天然最新。
- 从最新 `main` 建任务分支；不直接向 `main` 提交或推送。
- 遇到既有未提交改动，先确认是否属于当前任务；保留所有用户和其他协作者的文件。
- 除上面的快进拉取外，不自动 merge、rebase、reset、stash、丢弃改动或 force-push；PR 只按快速开发模式 v2 的对应风险门禁由本线调度 agent 合并（LOW 满足自动验证且无阻断，MEDIUM/HIGH 需独立 PASS）。
- 审查最终 diff 后，只暂存本任务路径并提交；禁止 `git add .`。推送任务分支（`git push -u origin <分支>`）后创建 PR。
- 范围扩展或验收标准有歧义时由本线调度 agent 决定并记入 Issue，影响别的线时找 Opus；改变产品方向或安全底线时才问用户。

## 外部调研

- 优先使用官方文档、上游源码与 GitHub issue/PR；记录来源与访问时间。
- 外部回复与其他模型的结论只作研究输入，须核对证据后再写入结论。
- 工具不可用或无法完成查询时明确记录，不冒充已完成。

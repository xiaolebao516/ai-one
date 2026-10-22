# AI 协作工作台：项目协作约束

## 项目与范围

- 产品目标是复用用户已有的 AI 网页订阅与原生工具，让多个 AI 独立取证并自动交换完整回复，支持暂停、人工接管、恢复及会话交接。
- **当前产品方向与阶段优先级以 [Spec #32](https://github.com/xiaolebao516/ai-one/issues/32)（xiaolebao516/ai-one#32）为准**；旧 V1 Epic（#1）及其子任务、`docs/design/` 中的 V1 设计是历史参考，不再单独作为现行需求。实现范围以各 Spec / Task Issue 为准。旧 V1 曾把 Bridge、CLI Agent、远程控制、智能历史压缩列为不做；这不是永久禁止，是否及何时实施由 #32 与对应的有效 Spec 或独立 Task 决定，没有对应 Issue 不实现。
- UI/UX 的当前依据是 #32 及其后续设计 Task 的成果（目前为 #33 交付的 `docs/design/v2-product-design.md` 与 `docs/design/v2-prototype/`，与 #32 冲突时以 #32 为准）；`docs/design/` 的 V1 文件仅作历史参考。技术依据为 `TECHNICAL-RESEARCH-V1.md` 与 `research-evidence/`。这些文件只在对应 Issue 的范围内修改。Agent HUD Open 仅作视觉参考。
- 上游仓库克隆、依赖安装和验证放在仓库外的独立临时目录，记录上游提交 SHA 与验证记录。
- AGENTS.md 只保存稳定工程规则；需求、结论和任务进展记录在 Issue 与 PR 中，不维护 `progress.md`、`state.md` 等重复文档。

## 快速开发模式（当前生效，用户 2026-10-22 决定）

本节优先于下文与之冲突的旧条款。任何 agent 进入本项目都按本节工作，不需要用户重述。

- **谁做什么**：用户只定方向、做最终验收、处理真实账号操作（登录、验证码等）。Opus（本地 Claude Code）是总协调：负责架构、拆分 Spec、定各条线之间的接口和合并顺序，并亲自做一条线（通常是前端/UI）；实现、测试、文档、排查等体力活和独立审计，经 Prodex 派给 GPT（定位和快速入口见下一节「Prodex：免费的 GPT 工人与审计员」）。决策分两级：Opus 决定跨 Spec 的总体架构、接口约定、依赖和合并顺序；各线调度 agent 自己决定本 Spec 内的实施方案、排障、派工和步骤调整，重要决定记入 Issue，影响别的线的接口、共享架构或合并顺序时才升级给 Opus。这些都不问用户；只有涉及产品方向、安全底线、真实账号授权，或下文明确保留给用户审批的事项（如新增 Prodex 槽位，需要用户逐个登录）才问用户。
- **多个 agent 各领一条线**：Claude Code 额度有限，Opus 只亲自做其中一条（通常是架构 / 前端那条）。其他 Spec 由用户交给别的 agent（Codex、WorkBuddy、Antigravity 等），用户只需对它说“按 AGENTS.md 快速开发模式接手 xiaolebao516/ai-one 的 Issue #N”。接手的 agent：读本文件和该 Issue → 看 Issue 上是否已有调度 agent、有没有用户指派或交接（有别人且没有授权就停）→ 没有冲突再抢认领锁（见下一条）→ 成功后在 Issue 登记自己（工具名 + 会话标识）为调度 agent、工作树和分支 → 开工 → 按 Issue 的步骤清单和验收做完、审计、合并、收尾 → 最后在 Issue 留一段说人话的总结。首次认领没人登记的 Issue，按用户的简短指令直接开始。Issue 已有调度 agent 时，只有用户明确指派接管、或原调度 agent 在 Issue 里明确交接，才能更换登记；仅凭长时间没动静不得自行接管。接管前核对原分支、PR、最新 HEAD 和 Handoff，有冲突先停止写入；登记变更后，新调度 agent 才取得该线的合并与清理权限。Opus 不替别的线开 Claude Code 会话，除非用户要求。
- **认领锁防止两个 agent 抢同一个 Issue**：所有 agent 共用一个 GitHub 账号，指派人和评论分不出是谁，所以认领靠一个原子操作：`node scripts/issue-claim/cli.mjs claim <N> --agent "<工具 / 会话标识>"`。它在远端建 `claim/<N>` 标记分支，要求该分支事先不存在，同时抢只有一个成功。退出码 `0` 认领成功（同一 `--agent` 标识再认领会显示“resuming”，用于恢复自己的工作）；`2` 已被别人认领（会打印是谁、何时），立即停手，不做这个 Issue；`1` 是用法或网络错误，查明再试。开工前、恢复工作前都先 `show <N>` 并与 Issue 上的登记核对。认领提交使用固定的工具身份，不带本机 git 姓名和邮箱。这是让守规矩的 agent 不会重复认领的协作锁，不是权限系统：`--agent` 只是公开字符串，有写权限的人都能绕过。线做完（合并收尾）或放弃时由持有者 `release <N> --agent "<同一标识>"` 释放；只有持有者能释放，别人的锁不能删，清理分支时也不碰 `claim/*`。持有者停了要换人，按上一条由用户指派或原持有者在 Issue 交接后，由原持有者释放或用户批准后删除该标记分支。
- **一个 Spec 一条线**：按需求拆成彼此尽量不冲突（不改同一批文件、不互相等待）的 Spec Issue。一个 Spec 由一个调度 agent 负责，它调度 GPT 干活，对应一个工作树和一个分支（`<类型>/<Spec号>-<简述>`），开工时在 Spec Issue 登记调度 agent、工作树路径和分支。Spec 内部的步骤用 Spec 正文的清单跟踪，不强制为每步开 Task；步骤需要单独审查时再开子 Task，子 Task 沿用父 Spec 的工作树和分支，汇入该 Spec 的交付 PR，不另建工作树或分支（确需拆开时由本线调度 agent 调整拆分，影响别的线时找 Opus）。很小的独立改动可以只开一个独立 Task，用自己的工作树、分支和 PR，流程相同。
- **审计通过就合并**：作者以外的独立审计（默认经 Prodex 派 GPT）对完整 HEAD 给出 PASS 后，**Issue 上登记的本线调度 agent** 自己 squash 合并到 `main`，不用问用户；接手执行的其他 agent 不因此获得合并权限。PR 关单规则见下文「PR 与 Reviewer」。
- **干完立刻收尾**：合并成功后同一轮内关闭对应 Issue，检查并安全回收本线工作树和本地/远程分支，释放不再用的 Prodex 槽位，然后再接下一件事，不拖着并行开新坑。删除前照「工作树与分支生命周期」核查未保存成果和开放 PR 依赖；条件不满足就记录原因和下次清理的触发条件，不强删，也不因此停下别的工作。
- **哪些验收可以后置**：两类分开。①**合并前必须有的证据**：Spec/Task 验收里写明的编译、自动测试、真机运行等，由调度 agent 自己在本地跑或手动触发 CI，证据写进 PR；缺了审计就给 BLOCKED，这条 PR 不合并，但不影响其他线。②**可以后置的用户确认**：主观的 UI 观感、使用体验、只有用户能做的真实账号流程。②写进该 Spec 的「待用户验收」清单（看什么、在哪里/怎么操作、预期结果），给 Issue 打 `needs-user` 标签，照常合并收尾，接着做别的；后置的项不得写成“已验收通过”。攒到一批有分量的成果后统一告诉用户；用户看完没问题就去掉标签，有问题就开新 Spec 修。只有真实账号操作卡住时才必须等用户，且只停那一条线。
- **跟用户汇报说人话**：先说做出了什么、现在能用什么，再说需要用户看什么、在哪里看、怎么操作（能给直接打开的链接或命令就给）。不罗列 Issue/PR 编号、分支、SHA 和内部术语，这些留在 Issue/PR 里给 agent 看。

## Prodex：免费的 GPT 工人与审计员（快速入口）

Prodex 是本机命令行工具，用来唤起用户已登录的 ChatGPT 网页，让 GPT 干活。它用的是用户的 ChatGPT 订阅，**不耗 Claude 等其他 agent 的额度**，所以能派就派。

- **默认档位**：正式派工（执行、审计、讨论）一律显式传最高档 `--effort high`（2026-10-22 账号的最高档；不确定时先 `prodex pro browser models` 看，菜单出现 Pro 就用 `--model Pro`）。只有测试 Prodex 本身才用即时档，测完恢复；测试会在用户账号里留下对话，事先告知用户并标明是测试。
- **GPT 能直接操作 GitHub**：它在网页里带 GitHub 连接器，可以读仓库代码、推分支和提交、开 / 改 PR、写 Issue / PR 评论，并按快速开发模式的条件合并、关单。派工时直接让它做这些写操作，不要只让它“给建议”再由 agent 抄一遍；写操作结果以回读 GitHub 为准。
- **默认并行 worker**：调度 agent 拆好步骤后，实现、测试、文档、排查默认都派给 GPT，能并行的同时派到不同槽位；agent 自己只做被显式指定由它做的部分（架构、跨线接口、前端观感、本机真机运行、需要本机环境的验证）。
- **默认免费异步审计员**：每个 PR 的独立审计默认派 GPT，用一个和执行无关的新对话（作者不审自己）。审计在后台跑，调度 agent 不用干等，可以先做别的。审计员对问题有把握、改动小而明确时，可以让它直接在该 PR 分支上提交修复并逐条说明改了什么；调度 agent 回读这次提交的 diff 并跑必要验证，再换一个与修复无关的新对话对新 HEAD 复审（修复的对话已经是这部分的作者）。改动大、有争议或涉及别的线时，仍交回执行方改。

**快速入口（可直接复制，命令细节见 `scripts/prodex-slots/README.md`）**

```bash
# 1. 看有哪些槽位、谁在用
node scripts/prodex-slots/cli.mjs list
# 2. 开新对话派工 / 审计：自动挑空闲槽位，满了排队；回复只写进本地文件
node scripts/prodex-slots/cli.mjs run --slot auto --task <Issue号> --session <你的标识> --wait-ms 1800000 \
  -- --new-chat --effort high --stdin --timeout-ms 1800000 < prompt.md > reply.md 2> err.log
# 3. 在同一个对话里继续（复审、追问）：必须指定这个对话所在的槽位 N
node scripts/prodex-slots/cli.mjs run --slot <N> --task <Issue号> --session <你的标识> --thread-url "$THREAD" \
  -- --target-url "$THREAD" --confirm-target --effort high --stdin < next.md > reply2.md 2> err2.log
# 4. 结果不明（request_mismatch、超时）：不重发，带上该槽位的端口和锁文件按 request-id 取回
PRODEX_CDP_PORT=<端口> PRODEX_SEND_LOCK_FILE=<该槽位锁文件> \
  prodex pro browser recover --port <端口> --target-url "$THREAD" --request-id <id>
```

槽位 N 的端口是 9333+N−1；锁文件：1 号槽位是 Prodex 默认锁（不设该变量），N≥2 是 `~/.local/share/prodex/browser-send-slotN.lock`。对话在哪个槽位：`list` 显示的线程 URL，或报错信息里的 thread。

**并行时怎么不冲突**

- 一个槽位同时只服务一个对话；`run --slot auto` 只挑空闲槽位，全忙时按 `--wait-ms` 排队（退出码 4），不预占、不往别人正在进行的对话里塞消息。
- 续聊必须用对话所在的槽位（`--slot N`）。用 `auto` 可能挑到别的槽位，报 “No open ChatGPT tab matches the confirmed target URL”；这种情况消息没有发出，换对的槽位重试即可。
- 恢复（recover）必须带该槽位的端口和锁文件；不带锁文件会去等 1 号槽位的锁，表现为“另一个发送占着浏览器”然后超时。
- 同一个分支同一时间只有一个写入者：派 GPT 改某个分支时，调度 agent 自己不在这个分支提交；多个 GPT 并行改代码时，各自用不重叠的文件，或分开的子步骤顺序合入。
- 提示词：新对话的正文不要出现 `github.com`（链接或域名都避免），用 `owner/repo`、`#N`、SHA 代替，否则容易误报 `request_mismatch`；几十 KB 的长提示词也可能误报。大段代码优先让 GPT 用连接器自己读，提示词里只给 HEAD、范围和要点。误报时按上面第 4 步取回，不重发。
- 回复正文只存本地文件，不贴进 Issue / PR / 共享日志；Issue 里只写这一轮的要点、结论和阻塞。
- 退出码 3（要登录、验证码、窗口被收起）：停下这一路，告诉用户哪个槽位要处理；其他线照常。工具提示要手动删的残留文件（如 `slot-N.json.reap`），确认没有槽位命令在跑后请用户删，agent 不自己绕过。

## 分工

- 用户：确定方向、做最终验收、执行或授权真实账号操作。合并由调度 agent 在审计通过后自行完成（见快速开发模式）。
- Opus（本地 Claude Code）：协调入口，负责架构、拆分与调度、前端/UI/UX、桌面运行与实际测试。
- GPT（经 Prodex 调用 ChatGPT，必要时用 GitHub 连接器）：按各线调度 agent 的派工做实现、测试、文档、排查和独立审计。
- 其他 agent（Codex、WorkBuddy、Antigravity 等）：由用户指派，各自作为一条 Spec 线的调度 agent，规则与 Opus 的线相同。
- Spec/Task Issue 写明调度/执行 Owner 和独立 Reviewer。作者不能把自审当成独立 Review。模型分工是默认，不硬编码身份，也不得假报实际模型 / 档位。

## 执行纪律：过程汇报与收尾

- **过程汇报只约束会长时间静默的执行环境**：预计连续 5 分钟没有可见输出时（WorkBuddy 这类），开工先报目标、验收口径和第一步，之后每 5 分钟、完成关键步骤或遇到阻塞时报一次「做了什么 / 验证状态 / 下一步」；被工具调用卡住的，结束后立即补报。本来就有持续可见输出的 agent（如 Claude Code）不受定时汇报约束，只在关键结论和阻塞时说明。
- **阻塞报告三要素**：现象与证据、缺什么（权限 / 环境 / 用户操作）、恢复动作。禁止用“处理中”“快好了”代替。
- **收尾统一用 STC（Simple Technical Chinese，简单技术中文）**：先给结论，短句、具体、少术语、少 Markdown，只讲交付了什么、验证结果、遗留问题和下一步。不强制三段式，也不贴原始日志。对用户的汇报按快速开发模式「说人话」：讲成果和要用户看的东西，不堆编号和术语。
- 静态审查、CI、实际运行分别说明；未运行写“未运行”，未证实写“待实测”。

## Issue-first：Spec、Task、PR 与 Handoff

- **两种 Issue**：`[Spec]` 负责需求的目标、行为、约束、非目标与**整体验收**；`[Task]` 负责一个可独立执行、独立审查的交付增量及**局部验收**。简单明确的需求直接使用独立 Task，不必创建父 Spec 或额外 Markdown 文件；复杂需求使用 Spec 父 Issue 和可验收的 Task 子 Issue，避免在每个子任务复制完整需求。
- **待设计是合法状态**：Spec 使用 `.github/ISSUE_TEMPLATE/spec.md`，写明负责人、`Spec Revision: v1`、阶段与可检查的交付标准。阶段 `DESIGN_PENDING` 允许暂时没有实施方案、没有子 Issue，但不允许假称可直接执行。进入实施阶段前，先在 Spec 正文列出可验收的步骤清单；步骤需要单独审查时再拆为子 Task。只有真实 GitHub Sub-issues 关系才算建立了父子结构；仅在正文引用 `#N` 不算。工具不能建立原生关系时应报告待关联，不能伪报完成。
- **Task 应小而完整**：Task 使用 `.github/ISSUE_TEMPLATE/task.md`，说明本次交付、范围/非目标、依赖、可核验验收及验证手段、Owner、Reviewer、`Complexity: ROUTINE | DEEP`；如有父 Spec，记录其 Issue 和已检查的 `Spec Revision`。粒度以“一次独立 Review 能确认的交付”为准，不按文件或 commit 机械拆分。有父 Spec 的 Task 沿用父 Spec 的工作树和分支（见快速开发模式）；独立的代码 Task 用一个工作分支和一个主要 PR。分支命名 `<类型>/<Issue号>-<简述>`，例如 `ai/29-issue-first-workflow`；非代码 Task 可以用可核实成果完成。临时研究/聊天不强制创建 Issue。
- **变更与重审**：Spec 目标、边界、验收发生实质变化时，负责人先将 `Spec Revision` 递增，并以评论记录改动、原因和影响；所有关联的未完成 Task（含已开 PR）都必须重审，并记录核对的新版本及影响结论。在核对完成前暂停受影响的实施及验收；无影响可继续、范围变化应更新 Task 并复审 PR、失效任务可拆分或取消。排版错字无需升级版本。现有 `docs/SPEC.md`、`docs/PLAN.md` 属于需保留的**遗留产品基线与约束**；新 Spec Issue 不得静默覆盖既有安全/架构要求：与安全要求冲突时由用户先裁决；跨 Spec 共享架构的技术取舍由 Opus 决定、本 Spec 内的由本线调度 agent 决定，都在 Issue 记录理由。
- **完成与及时清理**：每种 Issue 都必须有交付标准。代码 Task 在局部验收、必要验证和 PR 合并（或明确认可的等价交付）后才能以 Completed 关闭；Draft PR 或 CI 绿不代表任务交付。Spec 必须独立审计通过、全部必要子任务妥善处理后才可关闭；不能因子 Issue 全关就自动宣称 Spec Done。待用户亲自验收的项不阻止关闭，按快速开发模式记入「待用户验收」并保留 `needs-user` 标签。尚未实施的 Spec 可保持 Open / DESIGN_PENDING。取消、重复或不实施的任务说明原因，以 GitHub **Not Planned** 关闭；完成交付使用 Completed。保留历史，不删评论/PR。
- **恢复与交接**：启动/恢复任务前先获取明确的 Issue 入口（仓库+编号或 URL）；无入口、权限不足时报告阻塞，不猜测任务或进度。接手 Task 读取本文件、Task 正文、父 Spec 最新正文和修订记录（如有）、最新 Handoff、当前分支/PR HEAD、Review、CI。Handoff 只是线索，不是事实；遇到 Spec 版本未重审、HEAD 不匹配或其他冲突先说明并停止危险写入。不要求用户重述聊天。同一 Task 默认只允许一个活动写入者，这是协作规则而非技术锁；接力继续原分支和 PR，不重复创建。
- **派工与升级**：协调者按风险和不确定性分级：ROUTINE 优先低成本/免费模型做已明确的实现、文档和测试；DEEP 交给适合的强模型做架构、排障、关键审计。遇到需求歧义、范围扩大、高风险边界或反复失败时，执行者给证据并请协调者决定咨询、升级、拆分，不自行扩权。复杂度只影响派工，不降低验收。派工记录期望模型/effort；无法核实实际档位写 `UNVERIFIED`。
- **PR 与 Reviewer**：实现 PR 指向 `main`。有子 Task 的 Spec：PR 用 `Closes #Task编号` 关联本次完成的 Task，父 Spec 用 `Spec: #N` 引用，整体审计完成后再关闭；没有子 Task、由 Spec 直接交付的：PR 可用 `Closes #Spec编号`，前提是满足整体验收和独立审计；独立 Task 用 `Closes #Task编号`。独立 Reviewer 阅读最新真实 Diff、完整 HEAD、Task/Spec 验收、CI；审查评论以**所审完整 HEAD SHA** 开头，区分静态审查、CI、实际运行证据，并给 PASS / REVISE / BLOCKED。需要但缺少运行证据时 BLOCKED，写明可执行命令与通过条件；由 CI/具备环境者补证据再重审。Owner 修改后须在 PR 或 Issue 评论告知**新的完整 HEAD SHA**，供 Reviewer 定位；HEAD 更新后旧审查失效。独立审计对当前 HEAD 给出 PASS 后，由调度 agent 合并。
- **Handoff / 不确定结果**：阻塞、责任切换、阶段结束或请求审查时，在 Issue/PR 用短评论记录状态、分支/完整 HEAD、完成内容、真实验证及未运行项、阻塞/风险、**下一执行者与可执行的下一步**；有 PR 时附 **PR 链接和当前 Review 状态**。普通每次提交/CI 变化无需重复长报告。GitHub 写操作、远程派工响应不确定时先回读远端或按 #26 协议恢复，不能盲目重试。不公开私有会话链接、对话正文或密钥。
- **状态看板**：GitHub Projects 可按父 Spec 与 Task 展示 Todo / In Progress / Review / Blocked / Done，但它只汇总 GitHub 事实，不另建进度数据源；当前工具不能创建原生子 Issue 关系或自动维护 Project 字段时，必须明确报告能力缺口。
- **标签约定**：仅使用已有 `needs-review`、`blocked`、`needs-user`；ROUTINE/DEEP 和 Spec Revision 写入 Issue 正文，不额外制造标签和状态文件。

## GitHub 写操作与远程派工

- Issue / PR 的创建、评论、关闭、合并，优先用当前环境已有的 `gh` 或 GitHub 连接器；本地能力不足时可派给带连接器的 GPT。**不得默认要求用户代操作**。
- **合并、关单、删分支的授权**：用户已授权（快速开发模式）：调度 agent 对**自己负责的 Spec/Task** 的 PR，在独立审计对当前 HEAD 给出 PASS 后，可自行合并、关闭对应 Issue、删除该线的工作树和分支。其他情况（别人的 PR 或分支、没有 PASS、范围外的 Issue）仍须用户在当前会话中明确指令。本仓库所有 agent 共用同一个 GitHub 账号，Issue 评论无法核验是否用户本人，不作为授权依据。`Closes #N` 会随合并自动关单，在 PR 正文写明。
- 派工写操作要写明仓库、编号、动作、授权来源；涉及 PR 时附完整 HEAD 和目标 base。同一写操作只能有一个执行者。
- 超时、失败或结果不确定时先回读 GitHub，确认未执行才可重试；成功后回读 PR / Issue 状态、merge SHA 或关闭原因，并在 Task Issue 留证据。
- 合并方式默认 squash；任务要求保留分支血缘（如 stacked 链）时，在 Task 或 PR 中写明并改用 merge commit。未交付的 Issue 用 Not Planned 关闭并说明原因。

## 执行与验收

- 先读取项目指引、根配置、相关 Issue 及 Git 状态。非平凡实现先确定范围与验收；采用最小正确变更。
- 自动行为测试可行且与风险相称时使用 TDD；文档及只读检查不要求编造测试。
- CI 默认按需手动触发：日常 PR 创建/更新不要求等待 CI；Reviewer 如实记录 CI `未运行`，不得仅因未触发 CI 判定 BLOCKED。若 Task 验收要求编译、自动测试或真实运行证据，仍须由 CI 或具备执行环境者补证据，缺失时按协作协议 v0.2 判定 BLOCKED（可后置给用户的只有快速开发模式里说的主观确认类事项）。手动验证在 Actions → CI → Run workflow 选择分支与 `quick`（前端/Agent/adapter）或 `full`（另含 Rust 测试/Clippy）。
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
- 除上面的快进拉取外，不自动 merge、rebase、reset、stash、丢弃改动或 force-push；PR 只按快速开发模式在审计 PASS 后由调度 agent 合并。
- 审查最终 diff 后，只暂存本任务路径并提交；禁止 `git add .`。推送任务分支（`git push -u origin <分支>`）后创建 PR。
- 范围扩展或验收标准有歧义时由本线调度 agent 决定并记入 Issue，影响别的线时找 Opus；改变产品方向或安全底线时才问用户。

## 外部调研

- 优先使用官方文档、上游源码与 GitHub issue/PR；记录来源与访问时间。
- 外部回复与其他模型的结论只作研究输入，须核对证据后再写入结论。
- 工具不可用或无法完成查询时明确记录，不冒充已完成。

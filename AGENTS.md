# AI 协作工作台：项目协作约束

## 项目与范围

- 产品目标是复用用户已有的 AI 网页订阅与原生工具，让多个 AI 独立取证并自动交换完整回复，支持暂停、人工接管、恢复及会话交接。
- **当前产品方向与阶段优先级以 [Spec #32](https://github.com/xiaolebao516/ai-one/issues/32)（xiaolebao516/ai-one#32）为准**；旧 V1 Epic（#1）及其子任务、`docs/design/` 中的 V1 设计是历史参考，不再单独作为现行需求。实现范围以各 Task Issue 为准。旧 V1 曾把 Bridge、CLI Agent、远程控制、智能历史压缩列为不做；这不是永久禁止，是否及何时实施由 #32 与对应 Task 决定，未经对应 Task 不实现。
- UI/UX 的当前依据是 #32 及其后续设计 Task 的成果（目前为 #33 交付的 `docs/design/v2-product-design.md` 与 `docs/design/v2-prototype/`，与 #32 冲突时以 #32 为准）；`docs/design/` 的 V1 文件仅作历史参考。技术依据为 `TECHNICAL-RESEARCH-V1.md` 与 `research-evidence/`。这些文件只在对应 Issue 的范围内修改。Agent HUD Open 仅作视觉参考。
- 上游仓库克隆、依赖安装和验证放在仓库外的独立临时目录，记录上游提交 SHA 与验证记录。
- AGENTS.md 只保存稳定工程规则；需求、结论和任务进展记录在 Issue 与 PR 中，不维护 `progress.md`、`state.md` 等重复文档。

## 分工

- 用户：确定方向、裁决分歧、执行或授权真实账号操作、确认合并。
- Opus（本地 Claude Code）：主导本地代码开发、UI/UX、桌面运行与实际测试，也可负责技术实现。
- GPT（ChatGPT + GitHub 连接器）：主导技术方案与任务分解、GitHub Issue、代码审查、PR 交叉验收，以及必要的远程代码修改。
- Task Issue 写明执行 Owner 和独立 Reviewer；Spec Issue 写明需求负责人和整体验收人。角色随任务调整，作者不能把自审当成独立 Review。近期由 Claude Code 作为协调入口（#32）；上述模型分工只是常见默认，不固定绑定，也不得硬编码身份或假报实际模型 / 档位。

## 执行纪律：过程汇报与收尾

- **过程汇报只约束会长时间静默的执行环境**：预计连续 5 分钟没有可见输出时（WorkBuddy 这类），开工先报目标、验收口径和第一步，之后每 5 分钟、完成关键步骤或遇到阻塞时报一次「做了什么 / 验证状态 / 下一步」；被工具调用卡住的，结束后立即补报。本来就有持续可见输出的 agent（如 Claude Code）不受定时汇报约束，只在关键结论和阻塞时说明。
- **阻塞报告三要素**：现象与证据、缺什么（权限 / 环境 / 用户操作）、恢复动作。禁止用“处理中”“快好了”代替。
- **收尾统一用 STC（Simple Technical Chinese，简单技术中文）**：先给结论，短句、具体、少术语、少 Markdown，只讲交付了什么、验证结果、遗留问题和下一步。不强制三段式，也不贴原始日志。
- 静态审查、CI、实际运行分别说明；未运行写“未运行”，未证实写“待实测”。

## Issue-first：Spec、Task、PR 与 Handoff

- **两种 Issue**：`[Spec]` 负责需求的目标、行为、约束、非目标与**整体验收**；`[Task]` 负责一个可独立执行、独立审查的交付增量及**局部验收**。简单明确的需求直接使用独立 Task，不必创建父 Spec 或额外 Markdown 文件；复杂需求使用 Spec 父 Issue 和可验收的 Task 子 Issue，避免在每个子任务复制完整需求。
- **待设计是合法状态**：Spec 使用 `.github/ISSUE_TEMPLATE/spec.md`，写明负责人、`Spec Revision: v1`、阶段与可检查的交付标准。阶段 `DESIGN_PENDING` 允许暂时没有实施方案、没有子 Issue，但不允许假称可直接执行。复杂需求进入实施阶段前，先拆为可验收的 Task。只有真实 GitHub Sub-issues 关系才算建立了父子结构；仅在正文引用 `#N` 不算。工具不能建立原生关系时应报告待关联，不能伪报完成。
- **Task 应小而完整**：Task 使用 `.github/ISSUE_TEMPLATE/task.md`，说明本次交付、范围/非目标、依赖、可核验验收及验证手段、Owner、Reviewer、`Complexity: ROUTINE | DEEP`；如有父 Spec，记录其 Issue 和已检查的 `Spec Revision`。粒度以“一次独立 Review 能确认的交付”为准，不按文件或 commit 机械拆分。代码 Task 原则上一个工作分支和一个主要 PR，分支沿用 `<类型>/<Issue号>-<简述>` 命名，例如 `ai/29-issue-first-workflow`；非代码 Task 可以用可核实成果完成。临时研究/聊天不强制创建 Issue。
- **变更与重审**：Spec 目标、边界、验收发生实质变化时，负责人先将 `Spec Revision` 递增，并以评论记录改动、原因和影响；所有关联的未完成 Task（含已开 PR）都必须重审，并记录核对的新版本及影响结论。在核对完成前暂停受影响的实施及验收；无影响可继续、范围变化应更新 Task 并复审 PR、失效任务可拆分或取消。排版错字无需升级版本。现有 `docs/SPEC.md`、`docs/PLAN.md` 属于需保留的**遗留产品基线与约束**；新 Spec Issue 不得静默覆盖既有安全/架构要求，发生冲突时由用户先裁决。
- **完成与及时清理**：每种 Issue 都必须有交付标准。代码 Task 在局部验收、必要验证和 PR 合并（或明确认可的等价交付）后才能以 Completed 关闭；Draft PR 或 CI 绿不代表任务交付。Spec 必须整体验收通过、全部必要子任务妥善处理后才可关闭；不能因子 Issue 全关就自动宣称 Spec Done。尚未实施的 Spec 可保持 Open / DESIGN_PENDING。取消、重复或不实施的任务说明原因，以 GitHub **Not Planned** 关闭；完成交付使用 Completed。保留历史，不删评论/PR。
- **恢复与交接**：启动/恢复任务前先获取明确的 Issue 入口（仓库+编号或 URL）；无入口、权限不足时报告阻塞，不猜测任务或进度。接手 Task 读取本文件、Task 正文、父 Spec 最新正文和修订记录（如有）、最新 Handoff、当前分支/PR HEAD、Review、CI。Handoff 只是线索，不是事实；遇到 Spec 版本未重审、HEAD 不匹配或其他冲突先说明并停止危险写入。不要求用户重述聊天。同一 Task 默认只允许一个活动写入者，这是协作规则而非技术锁；接力继续原分支和 PR，不重复创建。
- **派工与升级**：协调者按风险和不确定性分级：ROUTINE 优先低成本/免费模型做已明确的实现、文档和测试；DEEP 交给适合的强模型做架构、排障、关键审计。遇到需求歧义、范围扩大、高风险边界或反复失败时，执行者给证据并请协调者决定咨询、升级、拆分，不自行扩权。复杂度只影响派工，不降低验收。派工记录期望模型/effort；无法核实实际档位写 `UNVERIFIED`。
- **PR 与 Reviewer**：实现 PR 指向 `main`，正文以 `Closes #Task编号` 关联 Task；父 Spec 仅作 `Spec: #N` 引用，不由子 PR 自动关闭。独立 Reviewer 阅读最新真实 Diff、完整 HEAD、Task/Spec 验收、CI；审查评论以**所审完整 HEAD SHA** 开头，区分静态审查、CI、实际运行证据，并给 PASS / REVISE / BLOCKED。需要但缺少运行证据时 BLOCKED，写明可执行命令与通过条件；由 CI/具备环境者补证据再重审。Owner 修改后须在 PR 或 Issue 评论告知**新的完整 HEAD SHA**，供 Reviewer 定位；HEAD 更新后旧审查失效。用户批准后才合并。
- **Handoff / 不确定结果**：阻塞、责任切换、阶段结束或请求审查时，在 Issue/PR 用短评论记录状态、分支/完整 HEAD、完成内容、真实验证及未运行项、阻塞/风险、**下一执行者与可执行的下一步**；有 PR 时附 **PR 链接和当前 Review 状态**。普通每次提交/CI 变化无需重复长报告。GitHub 写操作、远程派工响应不确定时先回读远端或按 #26 协议恢复，不能盲目重试。不公开私有会话链接、对话正文或密钥。
- **状态看板**：GitHub Projects 可按父 Spec 与 Task 展示 Todo / In Progress / Review / Blocked / Done，但它只汇总 GitHub 事实，不另建进度数据源；当前工具不能创建原生子 Issue 关系或自动维护 Project 字段时，必须明确报告能力缺口。
- **标签约定**：仅使用已有 `needs-review`、`blocked`、`needs-user`；ROUTINE/DEEP 和 Spec Revision 写入 Issue 正文，不额外制造标签和状态文件。

## GitHub 写操作与远程派工

- Issue / PR 的创建、评论、关闭、合并，优先用当前环境已有的 `gh` 或 GitHub 连接器；本地能力不足时可派给带连接器的 GPT。**不得默认要求用户代操作**。
- **能力不等于授权**：合并 PR、关闭 Issue、删除分支，必须拿到用户在当前会话中的明确指令。本仓库所有 agent 共用同一个 GitHub 账号，Issue 评论无法核验是否用户本人，不作为授权依据。`Closes #Task` 会随合并自动关单，执行前要说明这一副作用。
- 派工写操作要写明仓库、编号、动作、授权来源；涉及 PR 时附完整 HEAD 和目标 base。同一写操作只能有一个执行者。
- 超时、失败或结果不确定时先回读 GitHub，确认未执行才可重试；成功后回读 PR / Issue 状态、merge SHA 或关闭原因，并在 Task Issue 留证据。
- 合并方式默认 squash；任务要求保留分支血缘（如 stacked 链）时，在 Task 或 PR 中写明并改用 merge commit。未交付的 Issue 用 Not Planned 关闭并说明原因。

## 执行与验收

- 先读取项目指引、根配置、相关 Issue 及 Git 状态。非平凡实现先确定范围与验收；采用最小正确变更。
- 自动行为测试可行且与风险相称时使用 TDD；文档及只读检查不要求编造测试。
- CI 默认按需手动触发：日常 PR 创建/更新不要求等待 CI；Reviewer 如实记录 CI `未运行`，不得仅因未触发 CI 判定 BLOCKED。若 Task 验收要求编译、自动测试或真实运行证据，仍须由 CI 或具备执行环境者补证据，缺失时按协作协议 v0.2 判定 BLOCKED。手动验证在 Actions → CI → Run workflow 选择分支与 `quick`（前端/Agent/adapter）或 `full`（另含 Rust 测试/Clippy）。
- 构建与测试命令以仓库内配置为准；尚未建立时不得虚构。
- 按“定义或复现 → 实施 → 验证 → 修正”迭代；同一失败最多连续调试五轮，之后携带原始证据询问用户。
- 结论标注为已核实事实、静态推断或待实测。编译通过不代表网页登录、工具调用或完整回复转发通过验收。
- 不写虚假的 CI 或测试通过结论；未运行的验证明确写“未运行”。
- 不得把模型口头声称已查阅证据、文本暂时稳定或多模型意见一致，单独作为可靠性或真实性证明。
- **经 Prodex 并行派工（多槽位）**：Prodex 默认只有一个浏览器和一把整机发送锁，覆盖“发送到收完回复”全程，多个会话的派工会整段排队。需要并行时用 `node scripts/prodex-slots/cli.mjs`（命令、退出码和限制见 `scripts/prodex-slots/README.md`）：`list` 看各槽位状态，`run --slot auto -- <prodex pro browser ask 的参数>` 选一个就绪且空闲的槽位派工。槽位数量由派工的 agent 按任务量向用户提出，用户同意后才 `add --count N`，不自行扩容。需要用户的情况（登录、验证码、窗口被收起）工具以退出码 3 报告，转告用户，不自行绕过。不要只改 `PRODEX_SEND_LOCK_FILE` 而仍共用同一个浏览器（会串线），不要覆盖 Prodex 的发送间隔。`run` 会把 ask 的 stdout（即回复）原样透传，必须重定向到文件，不进共享日志或 Issue / PR。工具的未实现项和未验证项记录在 #61，遇到真阻塞再针对性解决，不要把这些项当成已验证的能力。
- **槽位调度入口统一看 `scripts/prodex-slots/README.md`**：按说明检查占用再派工，入口缺失或检查失败就报告阻塞，不擅自退回共用槽位；不预占槽位，也不把派工塞进别人正在进行的对话。
- **需要用户就停下**：登录、验证码、窗口被收起时立即停下请用户处理，不读取、记录或转交 cookie / token。
- **多轮讨论续用原线程**：以线程 URL 确认目标（`--target-url <线程 URL> --confirm-target`）；`--continue` / `--continue-task` 在恢复或跨会话后不可靠，不作唯一手段。不要每轮开新 chat。
- **每轮在 Issue 留上下文**：把该轮提问要点、结论、阻塞写成短评论，作为可恢复的 Handoff；回复正文不进 Issue。
- **中断即停**：出现 `request_mismatch`、页签被切走或结果不确定时停止发送，先按 request-id、线程 URL 和 Issue Handoff 恢复核对，禁止盲目重发。
- **用完显式释放**：确认线程不再续用后释放槽位并核对实际状态，在 Task Issue 写明「本轮线程已闭合，槽位可复用」；未释放成功就记阻塞，不得宣称可复用。本阶段不自动删除聊天记录，线程状态与槽位占用分开管理。

## 账号与安全

- 真实账号登录、权限授予、密钥使用及真实外部写操作，只在用户已授权的范围内进行；不得复用其他工具的认证材料。
- 不新增工作台自己的写操作审批层，但不得绕过平台原生的授权、登录、验证码或限额。
- 不在仓库、Issue、PR 或日志中提交 cookie、token、密码、账号数据或网页对话正文。

## 工作树与分支生命周期

- **按需隔离，一 Task 一工作树**：本地写代码或需要隔离运行时创建；纯远程、纯只读任务不建。禁止无 Task Issue 归属的工作树，包括 detached HEAD 的临时集成分支。
- **名字要能看出做什么**：目录 `<repo>-<Issue号>-<简述>`、分支 `<类型>/<Issue号>-<简述>`，例如 `ai-one-64-agent-execution-rules`。禁止只有编号——接手的人看不出里面在做什么。
- **创建时登记**：在 Task Issue 记路径、分支、交付范围与退出条件。
- **守住任务边界**：发现工作超出当前 Task 验收范围时停手，另建 Task 和工作树，不在原工作树里顺手扩大；范围不清先问用户。
- **不再需要即检查回收**，不必等下游 PR 合并。删除工作树前核查进程占用、真实未提交与未跟踪文件（`git diff`、`git diff --cached`、`git ls-files --others --exclude-standard`）、可恢复性；Windows 上 `git status` 报 `M` 不足以判定脏（`core.autocrlf` 假脏）。
- **工作树与分支分开回收**：工作树确认安全即可移除；分支要拿到删除授权、无开放 PR 依赖、交付已确认才删。squash 合并事实只认 PR `MERGED`，不用 `git branch --merged` 或 `git cherry`。
- Task 完成或 Not Planned 关闭的同一轮内做能安全完成的清理；不能清的，在 Issue 记对象、原因和下次检查的触发条件。保留 HEAD、验证记录与 Handoff，不长期保留可重建的构建产物。
- 存量不合规资源在对应的清理 Task 中处理，不因本条新增而立即删除。

## Git

- 开工前先 `git fetch`，当前工作树没有本地改动时执行 `git pull --ff-only` 拉平 main；快进失败（已分叉或存在未提交改动）就停下报告，不做 merge 或 rebase。
- 索引陈旧会伪装成“有改动”：`git status` 报 `M` 但 `git diff` 与 `git diff --cached` 都为空时，用 `git add <这些路径>` 重建索引即可（不会暂存任何内容）；不要用 `git checkout` / `git restore` 去“清”它。
- `main` 工作树只做落地与读取，不在其中开发；任务一律从 `origin/main` 新建工作树，开工时天然最新。
- 从最新 `main` 建任务分支；不直接向 `main` 提交或推送。
- 遇到既有未提交改动，先确认是否属于当前任务；保留所有用户和其他协作者的文件。
- 除上面的快进拉取外，不自动 merge、rebase、reset、stash、丢弃改动或 force-push；不自动合并 PR。
- 审查最终 diff 后，只暂存本任务路径并提交；禁止 `git add .`。推送任务分支（`git push -u origin <分支>`）后创建 PR。
- 阶段变更、范围扩展或验收标准存在实质歧义时先询问用户。

## 外部调研

- 优先使用官方文档、上游源码与 GitHub issue/PR；记录来源与访问时间。
- 外部回复与其他模型的结论只作研究输入，须核对证据后再写入结论。
- 工具不可用或无法完成查询时明确记录，不冒充已完成。

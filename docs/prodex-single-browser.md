# 单浏览器并行派工评估（Issue #84）

核对日期：2026-10-23（UTC+8）。本轮结果：交付浏览器状态诊断修复；单浏览器三任务原型未实现、未实测。现有多槽位继续使用。

## 固定版本与证据

Prodex npm 包 `@youdie006/prodex@0.40.40`；npm `gitHead`、上游 `v0.40.40` 标签和仓库外检出均为 `3d671f5e19b63b660c7559fa3cb95f9d2adf8cdf`。只读核对安装包及该提交源码，没有修改全局安装或正在工作的浏览器。以下链接固定该提交，不能自动外推到后续版本。

| 入口 | 已核实的行为 | 对外层调度的影响 |
| --- | --- | --- |
| [`src/cli-args.ts`](https://github.com/youdie006/prodex/blob/3d671f5e19b63b660c7559fa3cb95f9d2adf8cdf/src/cli-args.ts#L266) | ask 参数没有 `--detach`、`--send-only` 或 `--async`，未知参数会被拒绝。 | 不能通过一个现成 CLI 开关使发送提前返回。 |
| [`src/cli-pro.ts`](https://github.com/youdie006/prodex/blob/3d671f5e19b63b660c7559fa3cb95f9d2adf8cdf/src/cli-pro.ts#L1644) 与 [`src/browser-send-lock.ts`](https://github.com/youdie006/prodex/blob/3d671f5e19b63b660c7559fa3cb95f9d2adf8cdf/src/browser-send-lock.ts#L22) | 锁包住整个 `sendChatGptPrompt` Promise，回调结束才释放。 | 把 ask 放后台只会让第二个 ask 排队，不是并行生成。 |
| [`src/chatgpt-browser.ts`](https://github.com/youdie006/prodex/blob/3d671f5e19b63b660c7559fa3cb95f9d2adf8cdf/src/chatgpt-browser.ts#L4906) | `sent` 进度在请求接受确认之前发出；之后才匹配请求、固定线程并等待完整回答。 | 不能把日志中的 `sent` 当成已接受且可恢复的持久回执。 |
| [`src/chatgpt-browser.ts`](https://github.com/youdie006/prodex/blob/3d671f5e19b63b660c7559fa3cb95f9d2adf8cdf/src/chatgpt-browser.ts#L4560) | 下一次发送先等待页面上一次生成结束，随后才进入新聊天导航。 | 缩短前一个 ask 的超时也不能解开同页忙碌门禁。 |
| [`src/chatgpt-browser.ts`](https://github.com/youdie006/prodex/blob/3d671f5e19b63b660c7559fa3cb95f9d2adf8cdf/src/chatgpt-browser.ts#L4998) | 等待期间切换到另一线程会报 `thread_navigated_away`，不能继续读取为原请求的回答。 | 不应删除发送锁或强切正在被收取的页面。 |
| [`src/chatgpt-browser.ts`](https://github.com/youdie006/prodex/blob/3d671f5e19b63b660c7559fa3cb95f9d2adf8cdf/src/chatgpt-browser.ts#L4336) | recover 导航到指定线程、核对最新用户轮请求标记，并要求完整稳定回答；当前另一线程在生成时拒绝导航。CLI recover 也持有发送锁。 | recover 是受保护的结果恢复接口，不能直接充当单页非阻塞轮询器。 |

在隔离临时目录对已安装版本运行四个契约探针：异步参数被拒绝、生成中不能通过下一次发送门禁、线程切换触发保护判定、独立发送锁保持到回调结束，4/4 通过。探针不访问真实对话、不修改真实锁，也不证明网页三任务并行成功。

## 本轮决定与后续所需契约

当前公开 CLI 入口无法由外层包装实现安全的“发完即走 + 单页面三任务并行”。这不是永久不可行的结论。可以修改上游，或维护一个具有同等请求身份与授权保护的新发送实现；两者都需要新的发送契约和真实网页验收，本轮没有交付这些能力。未把杀发送进程、手工删除锁或极短超时作为正常调度方案。

上游最小改动应同时具备：

1. 发送阶段确认请求标记及真实线程地址后，持久保存 `{task, thread-url, request-id}` 并返回 `accepted`；确认不明时不得自动重发。
2. 在一个全局页面操作队列中串行发送与导航，保留现有发送节奏和账号、验证码、额度门禁。短锁只覆盖页面操作；生成中允许离开的条件必须单独验证。
3. 状态查询返回生成中、已完成、未知或阻塞，不能把部分正文当完成；按线程和请求标记核对结果。轮询不得抢走其他正在执行的页面操作。
4. 重启恢复和“提交后未记账”窗口必须可追溯，避免重复提交。

条件具备后，再在专用测试对话验证三任务连续发送、生成时间实际重叠、逐一准确取回、暂停与异常恢复。只开同一浏览器的多个标签页是另一种设计，不能冒称单页面方案已通过；其页面定位和锁也需要改造。

## 与多槽位的关系及内存观察

当前关系是保留多槽位作为已用方案，单浏览器尚未替代它。没有删除已有槽位、关闭其他任务浏览器或改归档流程。

2026-10-23 04:10（UTC+8）Windows 上的只读快照：五个已注册 Edge 主进程端口 9333–9337 的 `/json/version` 均 HTTP 200。主进程 Working Set 各约 254–264 MiB；每个主进程的直接子进程 Working Set 合计约 1329–2072 MiB。此快照说明当前确有多组浏览器进程占用，不能证明历史浏览器退出或端口掉线的根因。

Working Set 含共享页，直接子进程之和也不等于完整进程树或独占物理内存；当前任务、历史、缓存和生成负载不同。未运行单浏览器原型，因此没有同负载 A/B 对比，不能宣称节省某个百分比。

## 浏览器诊断与验证边界

旧逻辑把 `browser_unreachable` 无条件解析为 `down`。CDP 端口无应答本身不能证明浏览器进程不存在。修复应结合本槽位的进程身份，把确证关闭、活进程但端口不可达、探测失败和可达但页面不可用分开；进程仍在或证据不足时不自动重启。具体状态和回归覆盖见 `scripts/prodex-slots/README.md` 与测试。

本轮未复现历史端口断开，不能声称已查清浏览器为何退出。确定性测试覆盖错误分类与防止错误启动；真实网页三任务并行和单浏览器内存对比未运行。Issue 中记录本机验证、独立审计和最终处置；未实现的原型验收保持未勾选。

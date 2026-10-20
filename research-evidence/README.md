# 本轮研究验证记录

日期：2026-10-20，Asia/Shanghai。

上游源码在仓库外下载和验证，当前项目仅保存研究文档与日志。没有创建应用骨架、提交、推送或修改 UI/UX 文件。

## 固定输入

- Multi-AI Chat Desktop：`https://github.com/TED-H-com/multi-ai-chat-desktop`，SHA `6bcf904dfce890f7ebe198cbfc329bf8d685ce62`。
- Agent HUD Open：`https://github.com/jazzenchen/agent-hud-open`，SHA `014524cd0dbed4d3bab4f715a847fcbeb4a7d0f3`。
- 临时根目录：`C:\Users\Administrator\AppData\Local\Temp\ai-one-research-155195dc`。
- Windows / Node v24.18.0 / pnpm 11.25.0。上游 packageManager 声明 pnpm 11.0.0，本轮没有切换全局版本。
- 两个临时 clone 均没有修改已跟踪源码；构建生成物和 node_modules 保留在临时目录。

## 命令与结果

在临时 Multi-AI Chat clone 中：

1. `pnpm install --frozen-lockfile`：exit 0，依赖安装成功。日志报告 257 packages，esbuild 安装脚本成功。
2. `pnpm verify`：exit 0；见 [multi-verify.log](./multi-verify.log)。包括 build:injected、tsc、eslint、781 个 Vitest 测试、22 个 Node 工具测试及 adapter schema 检查。
3. `pnpm build`：exit 0；见 [multi-build.log](./multi-build.log)。这是 Vite 资源构建，有 chunk 大小警告，不是 Tauri 可执行程序构建。
4. `node scripts/agent/doctor.mjs --json`：exit 1，缺少 cargo/rustc；见 [environment-doctor.json](./environment-doctor.json)。该检查找到 VS 2019 Community C++ 工具，不能代替实际链接验证。
5. Windows EdgeUpdate 注册表只读检查发现 WebView2 Runtime `155.0.4283.62`。未启动研究版原生应用。

没有运行 `cargo test`、`cargo clippy`、NSIS 打包或真实账号 E2E。没有自动安装 Rust/MSVC，没有使用或导出账号 cookie、token。

## 完整性实验

临时根目录下 `probe-integrity.mjs` 使用 clone 安装的 esbuild，将未修改的上游模块打包成 Node 可执行实验：

- 实际模块：`injected/bootstrap.ts` 的 `capOutboxEntry`、`src/bridge/bus.ts`、`src/workflow/waitForResponse.ts`、`src/ui/conversationContinuity.ts`。
- 唯一替身：`src/bridge/pull.ts` 的宿主轮询导入，提供时间常量及空的 awaiting/boot 回调。无网页、无网络模型调用、无真实账号。
- 输入：`'完整回复正文 '.repeat(150000) + 'END-OF-ANSWER'`。
- 调用 capOutboxEntry，再将结果作为 pull RESPONSE_DONE 发布到实际 bus，等待实际 waitForResponse。
- 结果：`truncated:true`，waiter 仍成功 resolve，末尾标记丢失。
- 附加检查：5,000 字符历史经 buildConversationReplayContext 后被加省略号截断。
- 运行命令：在上述临时根目录执行 `node probe-integrity.mjs`。
- 结果：[probe-integrity-result.json](./probe-integrity-result.json)。

该实验只证明模块路径上的完整性缺口，不证明真实网页已出现同样的超长输出，也不是完整端到端压力测试。

## 公开元数据快照

通过未认证的 GitHub 公共 REST API 查询，未使用 GitHub 账号权限：

| 查询 | 当时结果 |
|---|---|
| Desktop latest release | v1.9.6，2026-09-30T19:26:33Z |
| Desktop 最新研究提交 | 2026-10-19T18:40:35Z，Claude 回复捕获修复 #134 |
| Desktop #132 | open，2026-10-19 创建；Windows 11 / v1.9.6 的发送确认失败报告 |
| Desktop #130 | open，Claude response selector 失配报告 |
| HUD latest release | v0.5.5，2026-10-17T20:02:55Z |
| Desktop / HUD license | MIT / Apache-2.0 |

元数据会变化；分析结论以报告中固定 SHA 的实际代码为基准，用户问题报告仅作外部故障证据。

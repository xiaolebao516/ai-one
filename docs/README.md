# docs/ 导航

**当前产品需求的唯一入口是 [Spec #32](https://github.com/xiaolebao516/ai-one/issues/32)。** 本目录大部分文件来自上游 [Multi-AI Chat Desktop](https://github.com/TED-H-com/multi-ai-chat-desktop)（`6bcf904`）或属于旧 V1 方向，下表说明各类文件的地位。内容以原文保留，本页只做分类，不替代原文。

| 类别 | 文件 | 地位 |
|---|---|---|
| 现行协作与产品方向 | 仓库根 [`AGENTS.md`](../AGENTS.md)、Issue [#32](https://github.com/xiaolebao516/ai-one/issues/32)、[`.github/`](../.github/) 下的 Spec / Task / PR 模板 | 现行；本目录之外 |
| 现行设计参考 | [`design/v2-product-design.md`](design/v2-product-design.md)、[`design/v2-prototype/`](design/v2-prototype/index.html)（#33 / PR #34） | 已合并的设计稿与模拟数据原型，作为后续开发的对照基准；不含功能实现，与 #32 冲突时以 #32 为准 |
| 遗留产品基线与约束 | [`SPEC.md`](SPEC.md)、[`PLAN.md`](PLAN.md) | 保留的上游基线。其中有效的技术、安全、上游约束不得被新愿景静默覆盖；发生冲突先由用户裁决（见 `AGENTS.md`） |
| 仍在使用的上游工程文档 | [`COMPATIBILITY.md`](COMPATIBILITY.md)、[`RUN-AND-UPDATE.md`](RUN-AND-UPDATE.md)、[`AGENT-READY-SOURCE-RELEASE.md`](AGENT-READY-SOURCE-RELEASE.md)、[`AI-SISTER-THEME.md`](AI-SISTER-THEME.md) | 上游参考；描述的是上游应用，不等于 ai-one 已验收的行为 |
| 上游的项目声明与历史决议 | [`ARCHITECTURE.md`](ARCHITECTURE.md)（“v1.0 FINAL”）、[`RELEASE.md`](RELEASE.md)（“feature-frozen”） | 其中的 FINAL / 功能冻结只描述**上游项目**当时的决议与发布策略，**不是 ai-one 的架构决定或开发政策**；ai-one 的范围以 #32 为准 |
| 上游发布说明 | `RELEASE_NOTES_v1.4.0.md` … `RELEASE_NOTES_v1.9.7.md` | 上游历史，只读参考 |
| 上游研究笔记 | [`study/`](study/) | 上游历史，被 `SPEC.md`、`ARCHITECTURE.md` 引用；只读参考 |
| 上游维护者的会话交接 | `HANDOFF-2026-09-21-CLAUDE.md`、`HANDOFF-2026-09-24-CLAUDE.md`、`HANDOFF-2026-09-30-CLAUDE.md`、`HANDOFF-PR96.md` | **不是 ai-one 的 Handoff**，记录上游当时的状态；ai-one 的恢复与交接只看 GitHub Issue / PR |
| 旧 V1 设计 | [`design/v1-ux-design.md`](design/v1-ux-design.md)、[`design/workbench-v1-prototype.html`](design/workbench-v1-prototype.html) | 历史参考，非当前交付要求，已被 #32 与 v2 设计稿取代 |

来源与许可见 [`NOTICE.md`](../NOTICE.md)。

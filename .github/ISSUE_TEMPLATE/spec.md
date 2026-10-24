---
name: "Spec：需求 / 功能"
about: "复杂需求的目标、边界、整体验收；可先待设计，后续拆为子 Task。"
title: "[Spec] "
---

## 版本与阶段
- Spec Revision: v1
- Stage: DESIGN_PENDING <!-- DESIGN_PENDING / PLANNED / IN_PROGRESS / ACCEPTANCE -->
- Priority: P1 <!-- P0 / P1 / P2 -->
- Recommended Agent: <!-- 推荐协调者/执行工具及理由，非排他 -->
- Backup Agent: <!-- 主 Agent 额度耗尽时的候补 -->
- Depends on: <!-- #N / PR #N 及满足条件 / 无 -->
- Ready when: <!-- 哪些条件满足后可接手；DESIGN_PENDING 不可直接 IMPLEMENTING -->
- Merge Risk: <!-- LOW / MEDIUM / HIGH；默认不确定至少 MEDIUM -->
- 需求负责人：
- 最终验收人：
- Current Coordinator / claim：<!-- 待认领 / 工具名 + 会话标识 + 认领时间 -->
- Current Executor：<!-- 待分配 / 当前唯一写分支的工具/会话，额度用尽按 AGENTS v2 接力 -->
- 工作树路径：<!-- <repo>-<Spec号>-<简述>，开工时填写；子 Task 沿用 -->
- 分支：<!-- <类型>/<Spec号>-<简述>，开工时填写；子 Task 沿用 -->

## 背景、目标与预期成果
<!-- 解决什么问题，交付后有哪些可见的结果 -->

## 需求、约束与非目标
<!-- 写必要行为、边界；与已有 docs/SPEC.md / docs/PLAN.md 有冲突先裁决 -->

## 整体交付 / 验收标准
<!-- 必填、可检查。设计阶段也要说明可交付的设计成果；实施前补充完整功能验收。 -->
- [ ]

## 接力与状态
<!-- READY / IMPLEMENTING / REVIEW_QUEUED / REVIEW_BLOCKED / FIXING / MERGE_READY / CLOSEOUT / DONE / HANDOFF_BLOCKED；不要因现有 Owner 已登记就拒绝安全接力。 -->
- 最新 Handoff / HEAD：
- 当前额度 / 环境障碍（如有）：
- 安全接力条件：<!-- 原写入者停工、分支 HEAD 回读、可恢复改动保全、claim 转移或保持 coordinator 不变 -->

## 步骤清单 / 待定事项
<!-- 在 Spec 的分支上按步骤派工并勾选。步骤需要单独审查时再拆子 Task（用 GitHub 原生 Sub-issues，文本链接不能代替真实关联）。 -->
- [ ]

## 待用户验收
<!-- 需要用户亲自看的点：看什么、在哪里/怎么操作、预期结果。有未验收项时给 Issue 打 needs-user 标签，不阻止合并和关闭。可选动作行（让 ai-one 总览出按钮）：命令：<命令> / 打开：<https 链接> / 决定：A / B / 本人操作：<说明>。 -->
- 无

## 变更记录
<!-- 实质变更升级 Spec Revision，评论记录差异及所有未完成 Task 的重审；别静默修改验收。 -->

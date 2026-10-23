---
name: "Task：独立可验收任务"
about: "简单需求独立创建；复杂需求作为 Spec 的原生子 Issue。"
title: "[Task] "
---

## 关联 / 派工
- Parent Spec: <!-- #N 或 无；有父 Spec 时必须建立原生 Sub-issue 关系 -->
- Reviewed Spec Revision: <!-- vN / 不适用 -->
- Complexity: ROUTINE <!-- ROUTINE / DEEP；工作复杂度，不是合并风险 -->
- Merge Risk: <!-- LOW / MEDIUM / HIGH；不确定至少 MEDIUM；涉及权限/持久化/并发/删除/共享架构/AGENTS 门禁为 HIGH -->
- Owner:
- Reviewer: <!-- LOW 可填“非强制”，MEDIUM/HIGH 必须与作者及修复者独立 -->
- Depends on: <!-- #N / 无；写出必须先合并的 PR 和共享接口 -->
- 调度 agent / claim 状态: <!-- 接手后填写；未认领不能擅自并行写入 -->

## 任务与范围
<!-- 具体交付、边界、非目标；不重复父 Spec 的完整需求 -->

## 交付 / 验收标准
<!-- 必填且可客观判断。如需要运行测试，写具体命令与通过条件并确认目标环境支持。 -->
- [ ]
- [ ] 如按 LOW 快速合并：当前完整 HEAD 真实自动验证通过、无已知未关闭阻断意见、依赖满足、由登记的本线调度 agent 执行合并
- [ ] 如按 MEDIUM/HIGH：独立 Reviewer 对当前完整 HEAD PASS，必要运行证据已核实
- [ ] 合并后校验 PR MERGED/Issue 状态，安全清理 claim、工作树、分支与 Prodex 槽位/线程；未能清理写明原因和下次触发条件

## 实施与验证记录
- PR：待创建 / 不适用
- 完整 HEAD / 静态、自动验证、CI、实际运行证据：待验证
- 当前调度状态：READY / IMPLEMENTING / REVIEW_QUEUED / REVIEW_BLOCKED / FIXING / MERGE_READY / CLOSEOUT / DONE

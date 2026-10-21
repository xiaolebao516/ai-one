# ai-one v2 UI Foundation

v2 页面（HUD、任务现场、资源页等）共用的设计令牌和基础组件。来源：Issue #41；视觉基线：#34 的 `docs/design/v2-product-design.md` §8 与 `docs/design/v2-prototype/styles.css`。

## 三层结构

| 层 | 文件 | 谁来改 |
|---|---|---|
| 令牌（值） | `tokens.ts`：每套方案（skin）× 明 / 暗的颜色、阴影，以及圆角、字体、字号、间距、控件高度 | 换视觉风格时只改这里 |
| 变体（怎么用令牌） | `variants.ts`：按钮、标签、卡片、提示等每个变体对应的语义类名 | 调整某类组件的样子时改这里 |
| 组件（结构与交互） | `Button.tsx`、`Badge.tsx`、`Tabs.tsx`… | 改交互、可访问性时改这里 |

页面只负责业务结构：选组件、选 `variant` / `tone`，不写颜色。

## 使用

```tsx
import { V2Scope, Card, SectionHeader, StatusIndicator, Button, Badge } from '../ui/v2';

export function MyV2Page() {
  return (
    // mode="auto"（默认）跟随应用主题：应用的深色 / ai-sister 主题会给 <html> 加 .dark
    <V2Scope className="h-full bg-v2-panel p-v2-page">
      <SectionHeader title="需要你" count={2} />
      <Card accent="you" className="mt-v2-md flex items-center gap-v2-sm">
        <StatusIndicator tone="you" label="待验收" />
        <Badge tone="done">CI 通过</Badge>
        <Button variant="attention" size="sm">查看验收单</Button>
      </Card>
    </V2Scope>
  );
}
```

- **必须放在 `<V2Scope>` 里。** `--v2-*` 变量只写在 scope 元素上；scope 外的 `bg-v2-*` 等类没有值，所以 v2 不会影响旧界面，旧界面的 `zinc` / `sky` 类和 `html.ai-sister` 也不会影响 v2。
- **布局用 Tailwind 语义类**：颜色 `bg-v2-surface`、`text-v2-ink-2`、`border-v2-line`；字号 `text-v2-title|heading|lead|body|meta|micro`；圆角 `rounded-v2-sm|md|lg|xl|pill`；阴影 `shadow-v2-card|float`；间距 `p-v2-card`、`gap-v2-md`、`h-v2-control-md`。映射在根目录 `tailwind.config.js`，只有变量名，没有值。
- **状态只用 tone**：`run`（进行中）、`rework`（返工）、`you`（需要你：决定 / 验收）、`block`（阻塞 / 失败）、`done`、`paused`、`unknown`。不要在页面里写 `text-v2-you` 之类的状态色类，用 `StatusIndicator` / `Badge` / `Notice` / `Card accent`。外部数据里的未知值用 `toV2StatusTone()` 降级为 `unknown`。
- **状态不只靠颜色**：`StatusIndicator` 同时给形状和文字；`label` 是必填的。
- **琥珀色（`you`）只表示“和人有关”**；`attention` 按钮只用于回答决定 / 验收的那一个操作。
- **带 `tabIndex` 的元素不要直接放字号 / 字重类**：应用全局样式 `src/styles.css` 有 `[tabindex] { font: inherit; }`，与 Tailwind 工具类同优先级且排在后面，会把 `text-v2-*` 字号和 `font-semibold` 覆盖掉（Windows Tauri 实测发现）。把这些类放在内部的 `<span>` 上；共享组件已这样处理，`v2-components.test.tsx` 有检查。
- **不可用的操作**：用 `disabled` + `disabledReason` 写明原因（悬停提示 + 读屏），不要放一个点了没反应的按钮。

## 组件

`V2Scope` · `Button` / `IconButton` · `Card` · `Badge` · `StatusIndicator` · `SectionHeader` · `Tabs` / `TabPanel` · `SegmentedControl`（单选筛选）· `Select`（原生 select）· `Notice` · `EmptyState`（`neutral` 与 `unknown` 两种，后者不会被误读成“没有待办”）· `LoadingState` · `Divider` · `Icon`。

现有的 `ModalDialog`（焦点陷阱）可以直接沿用，第一批不另做弹窗组件。

## 换视觉风格

- 改某个值：编辑 `tokens.ts` 中对应 skin 的值。`src/__tests__/v2-tokens.test.ts` 会检查两种模式的令牌名一致，以及正文、状态文字的 WCAG 对比度。
- 新增一套方案：在 `V2_SKINS` 里加一项（形状 + 明 / 暗两组颜色），`<V2Scope skin="…">` 即可使用。
- 运行时整体切换：没有写 `skin` 的 `<V2Scope>` 先继承外层 scope 的方案，最外层则跟随共享偏好 `setV2Skin('mist')` / `useV2Skin()`（`skinPreference.ts`，按来源存在 localStorage `ai-one.v2.skin`）。所以 HUD、已迁移的旧界面和 Gallery 会一起换；只有需要固定外观的地方（如 Gallery 并排对比）才写 `skin`。
- `v2.css` 只放 Tailwind 表达不了的东西（状态形状、动画、焦点环），所有选择器都限定在 `.v2-scope` 下（有测试检查）。

## 组件陈列（开发态）

```bash
pnpm dev
```

打开 `http://localhost:1420/v2-gallery.html`（`?skin=mist`、`?mode=dark`、`?compare=1` 可组合）。“并排对比”用同一份页面分别套两套令牌，并列出两套方案的全部令牌差异。Gallery 不在生产构建和 App 路由里，内容全是示例。

## 不要做

- 不要把原型的 `styles.css` / `app.js` 搬进来，也不要在页面里另写一套 HUD 色值。
- 不要在 v2 组件里使用旧调色板类（`zinc`、`sky`……）或十六进制颜色；`v2-components.test.tsx` 会扫描并报错。

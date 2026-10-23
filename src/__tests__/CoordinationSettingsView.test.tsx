import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COORDINATION_SETTINGS,
  type CoordinationSettings,
  type StorageLike,
} from '../stages/coordinationModel';
import { CoordinationSettingsView } from '../workbench/views/CoordinationSettingsView';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => map.set(key, val),
  };
}

describe('CoordinationSettingsView', () => {
  it('renders settings view with required guidance and CC reminder', () => {
    const storage = createMemoryStorage();
    const html = renderToStaticMarkup(<CoordinationSettingsView storage={storage} />);

    expect(html).toContain('CC 协调设置');
    expect(html).toContain('由 CC 参照执行');
    expect(html).toContain('返工上限');
    expect(html).toContain('审计 REVISE 返工超过这个数就停下来问你');
    expect(html).toContain('超限后');
    expect(html).toContain('额度紧张时');
    expect(html).toContain('登录失效时');
    expect(html).toContain('优先使用（你的标注）');
    expect(html).toContain('简报预览（建 Issue 时写入正文）');
  });

  it('renders default brief preview correctly in static markup', () => {
    const storage = createMemoryStorage();
    const html = renderToStaticMarkup(<CoordinationSettingsView storage={storage} />);

    expect(html).toContain('## 协调简报');
    expect(html).toContain('- 返工上限：3 轮，超限问用户');
    expect(html).toContain('- 额度紧张：自动改派并通知用户');
    expect(html).toContain('- 登录失效：先问用户');
    expect(html).toContain('GPT（执行、审计）');
    expect(html).toContain('Opus（架构、终审）');
    expect(html).toContain('Argon（独立想法）');
  });

  it('reflects custom initial storage values in render', () => {
    const custom: CoordinationSettings = {
      ...DEFAULT_COORDINATION_SETTINGS,
      reworkLimit: 7,
      onExceedLimit: 'consult_opus',
      onQuotaTight: 'ask_user',
      onAuthExpired: 'fallback_ai',
    };
    const storage = createMemoryStorage({
      'coordination.json': JSON.stringify(custom),
    });

    const html = renderToStaticMarkup(<CoordinationSettingsView storage={storage} />);

    expect(html).toContain('- 返工上限：7 轮，先请 Opus 网页裁决，再问用户');
    expect(html).toContain('- 额度紧张：先问用户');
    expect(html).toContain('- 登录失效：用其他 AI 代替并通知用户');
  });

  it('includes reset button and options for all controls', () => {
    const storage = createMemoryStorage();
    const html = renderToStaticMarkup(<CoordinationSettingsView storage={storage} />);

    expect(html).toContain('恢复默认设置');
    expect(html).toContain('1 轮');
    expect(html).toContain('10 轮');
    expect(html).toContain('问我');
    expect(html).toContain('先请 Opus 网页裁决，再问我');
    expect(html).toContain('CC 自动改派并通知我');
    expect(html).toContain('用其他 AI 代替并通知我');
  });
});

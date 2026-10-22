import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DispatchReceipts } from '../ui/v2/DispatchReceipts';
import { V2Scope } from '../ui/v2';
import type { DispatchSnapshot } from '../dispatch/types';

describe('dispatch receipt presentation', () => {
  it('renders all five states with words and keeps thread URLs collapsed by default', () => {
    const snapshot: DispatchSnapshot = { events: (['running', 'completed', 'timeout', 'request_mismatch', 'recovered'] as const).map((status, i) => ({ id: String(i), taskId: `task-${i}`, status, threadUrl: 'https://chatgpt.com/c/6ad9fa49-d908-83e9-a9dd-f183da27abd6' })), slots: [], warnings: [] };
    for (const mode of ['light', 'dark'] as const) {
      const html = renderToStaticMarkup(<V2Scope mode={mode}><DispatchReceipts snapshot={snapshot} source="local" /></V2Scope>);
      for (const label of ['进行中', '已完成', '超时', '请求不匹配', '已恢复', '本机元数据']) expect(html).toContain(label);
      expect(html).toContain('<details>');
      expect(html).not.toContain('<details open');
      expect(html).not.toContain('<a ');
    }
  });
  it('distinguishes demo, empty, malformed metadata and unprobed slot state', () => {
    const html = renderToStaticMarkup(<DispatchReceipts snapshot={{ events: [], slots: [{ id: 1, port: 9333, state: 'unknown', browserState: 'unprobed' }], warnings: ['派工元数据格式无效'] }} source="demo" />);
    for (const label of ['演示数据', '还没有可显示', '浏览器未探测', '派工元数据格式无效']) expect(html).toContain(label);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DispatchReceipts } from '../ui/v2/DispatchReceipts';
import { V2Scope } from '../ui/v2';
import type { DispatchSnapshot } from '../dispatch/types';

describe('dispatch receipt presentation', () => {
  it('renders all five states with words and keeps thread URLs collapsed by default', () => {
    const snapshot: DispatchSnapshot = { events: (['running', 'completed', 'timeout', 'request_mismatch', 'recovered'] as const).map((status, i) => ({ id: String(i), taskId: 'task-' + i, status, threadUrl: 'https://chatgpt.com/c/6ad9fa49-d908-83e9-a9dd-f183da27abd6' })), slots: [], warnings: [] };
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

  it('translates receipt labels and the three parser warnings in English', () => {
    const snapshot: DispatchSnapshot = {
      events: [{ id: 'e1', taskId: 'task-demo', status: 'running', updatedAt: '2026-10-23T10:00:00.000Z', threadUrl: 'https://chatgpt.com/c/6ad9fa49-d908-83e9-a9dd-f183da27abd6' }],
      slots: [{ id: 1, port: 9333, state: 'claimed', browserState: 'unprobed' }],
      warnings: ['派工元数据格式无效', '1 个元数据文件无法读取或格式无效', '仅显示最近的部分记录', 'Custom warning'],
    };
    const html = renderToStaticMarkup(<V2Scope mode="light"><DispatchReceipts snapshot={snapshot} source="local" locale="en" /></V2Scope>);
    for (const label of ['In progress', 'Local metadata', 'Read-only', 'Dispatch slots', 'Claim recorded', 'Dispatch metadata format is invalid.', '1 metadata file could not be read or had an invalid format', 'Only the most recent records are shown.', 'Custom warning', new Date('2026-10-23T10:00:00.000Z').toLocaleString('en', { hour12: false })]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('派工元数据格式无效');
    expect(html).toContain('<details>');
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('<a ');
  });
});

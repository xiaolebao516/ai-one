import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiscussionMatrix } from '../stages/DiscussionMatrix';
import { SummaryCard } from '../stages/SummaryCard';
import { buildDiscussionViewModel } from '../stages/discussionViewModel';

describe('discussion stage components', () => {
  it('renders the matrix and independent-thinking marker without crashing', () => {
    const model = buildDiscussionViewModel({
      outputs: { first: 'initial first', second: 'initial second' },
      statusByNode: { first: 'done', second: 'done' },
    });
    const html = renderToStaticMarkup(<DiscussionMatrix model={model.matrix} />);
    expect(html).toContain('讨论矩阵');
    expect(html).toContain('看不到对方');
    expect(html).toContain('未能解析');
    expect(html).toContain('first');
    expect(html).toContain('auditor');
  });

  it('renders missing fields, the fixed verification disclaimer, and disabled action reasons', () => {
    const model = buildDiscussionViewModel({ outputs: {} });
    const html = renderToStaticMarkup(<SummaryCard model={model.summary} />);
    expect(html).toContain('讨论汇总');
    expect(html).toContain('未提供');
    expect(html).toContain('AI 同意不等于事实已验证');
    expect(html).toContain('转入定方案');
    expect(html).toContain('继续追问');
    expect(html).toContain('结束并保存');
    expect(html).toContain('外壳尚未接入创建 Task Issue 的操作。');
    expect(html).toContain('disabled=""');
  });
});

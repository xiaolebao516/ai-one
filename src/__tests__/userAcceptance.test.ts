import { describe, expect, it, vi } from 'vitest';
import {
  loadAcceptanceIssues, parseAcceptanceSection, readAcceptanceRecords, saveAcceptanceRecords,
  sendAcceptanceComment,
} from '../workbench/userAcceptance';

const repo = 'o/r';
const BODY = `## 待用户验收
- 检查视频生成。
  - 操作步骤：打开素材库，点击生成
  - 预期结果：出现视频预览
- 检查旧页面；打开旧入口，页面应保持正常

## 变更记录
- 不属于验收`;
describe('user acceptance parsing', () => {
  it('separates title, steps and expectation; preserves malformed items in full', () => {
    const items = parseAcceptanceSection(repo, 3, BODY);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: '检查视频生成。', steps: '打开素材库，点击生成', expected: '出现视频预览' });
    expect(items[1].raw).toContain('检查旧页面');
    expect(items[1].raw).not.toContain('变更记录');
  });
  it('keeps incomplete, multi-line and irregular descriptions verbatim', () => {
    const entries = parseAcceptanceSection(repo, 3, `## 待用户验收
- 看列表
  - 操作步骤：点打开
- 表述乱：预期不明确
没有丢掉这行`);
    expect(entries).toHaveLength(2);
    expect(entries[0].raw).toContain('操作步骤：点打开');
    expect(entries[1].raw).toContain('没有丢掉这行');
    expect(entries.every((item) => item.steps === undefined)).toBe(true);
  });
  it('creates no fake items for an empty or absent section; new text gets a fresh key', () => {
    expect(parseAcceptanceSection(repo, 4, '# Title\n## 待用户验收\n\n## Other')).toEqual([]);
    expect(parseAcceptanceSection(repo, 4, '# Title\n## Other\n- abc')).toEqual([]);
    expect(parseAcceptanceSection(repo, 4, '## 待用户验收\n- 无')).toEqual([]);
    const old = parseAcceptanceSection(repo, 4, '## 待用户验收\n- 检查 A')[0];
    const fresh = parseAcceptanceSection(repo, 4, '## 待用户验收\n- 检查 B')[0];
    expect(old.key).not.toBe(fresh.key);
  });
  it.each(['```', '~~~'])('keeps %s code blocks inside the real section without inventing headings or entries', (fence) => {
    const body = `${fence}markdown\n## 待用户验收\n- 不是验收\n${fence}\n   ## 待用户验收\n- 检查示例\n${fence}text\n## 示例\n- 代码里的列表\n${fence}\n- 检查真实后续项\n   ## 其他\n- 不属于验收`;
    const items = parseAcceptanceSection(repo, 4, body);
    expect(items).toHaveLength(2);
    expect(items[0].raw).toContain('## 示例');
    expect(items[0].raw).toContain('- 代码里的列表');
    expect(items[1].title).toBe('检查真实后续项');
    expect(items.some((entry) => entry.raw?.includes('不是验收'))).toBe(false);
  });
});
describe('fixed GitHub endpoint and whitelist', () => {
  it('reads old pages using only already whitelisted read routes', async () => {
    const get = vi.fn(async (path: string): Promise<unknown> => {
      expect(path).toMatch(/^repos\/o\/r\/issues\?state=all&sort=created&direction=desc&per_page=30&page=\d+$/u);
      if (path.endsWith('page=1')) return Array.from({ length: 30 }, (_, i) => ({
        number: i + 1, title: 'Issue', state: 'open', labels: i === 25 ? [{ name: 'needs-user' }] : [], body: BODY,
      }));
      return [{ number: 77, state: 'closed', title: 'old', labels: ['needs-user'], body: '## 待用户验收\n- 老项目' }];
    });
    const loaded = await loadAcceptanceIssues([repo], { get });
    expect(get).toHaveBeenCalledTimes(2);
    expect(loaded.partial).toBe(false);
    expect(loaded.items.map((i) => i.issue)).toEqual([26, 26, 77]);
  });
  it('does not write when unavailable and only invokes the preexisting comment action', async () => {
    const item = parseAcceptanceSection(repo, 6, '## 待用户验收\n- 检查 X')[0];
    const comment = vi.fn(async () => ({ status: 'confirmed' as const, code: 'ok' as const,
      message: '已确认写入 GitHub', steps: [{ step: 'comment' as const, state: 'confirmed' as const }] }));
    let available = false;
    const status = vi.fn(async () => ({ available, reason: available ? 'ok' as const : 'not_logged_in' as const }));
    expect(await sendAcceptanceComment({ status, comment }, item, 'approved')).toBe('failed');
    expect(comment).not.toHaveBeenCalled();
    available = true;
    expect(await sendAcceptanceComment({ status, comment }, item, 'feedback', '按钮点不动')).toBe('confirmed');
    expect(comment).toHaveBeenCalledExactlyOnceWith({ repo, issue: 6, text: expect.stringContaining('按钮点不动') });
  });
  it('does not retry uncertain result', async () => {
    const item = parseAcceptanceSection(repo, 6, '## 待用户验收\n- 检查 X')[0];
    const comment = vi.fn(async (): Promise<never> => { throw new Error('transport lost'); });
    expect(await sendAcceptanceComment({
      status: async () => ({ available: true, reason: 'ok' }), comment,
    }, item, 'approved')).toBe('unconfirmed');
    expect(comment).toHaveBeenCalledTimes(1);
  });
});
describe('local durable checkpoint', () => {
  it('survives reload without hiding revised acceptance; fails visibly when storage throws', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
    const a = parseAcceptanceSection(repo, 1, '## 待用户验收\n- 检查 A')[0];
    const b = parseAcceptanceSection(repo, 1, '## 待用户验收\n- 检查 B')[0];
    saveAcceptanceRecords(storage, { [a.key]: { key: a.key, repo, issue: 1, title: a.title, kind: 'approved', sync: 'unconfirmed' } });
    expect(readAcceptanceRecords(storage)[a.key].sync).toBe('unconfirmed');
    expect(readAcceptanceRecords(storage)[b.key]).toBeUndefined();
    expect(() => saveAcceptanceRecords({ ...storage, setItem: () => { throw new Error('quota'); } }, {})).toThrow();
  });
});

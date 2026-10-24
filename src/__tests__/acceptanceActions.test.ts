import { describe, expect, it } from 'vitest';
import { parseActionLine } from '../workbench/acceptanceActions';
import { parseAcceptanceSection } from '../workbench/userAcceptance';

describe('acceptance action lines', () => {
  it('recognises command, open, choice and manual lines', () => {
    expect(parseActionLine('命令：`pnpm tauri dev`')).toEqual({ kind: 'command', value: 'pnpm tauri dev' });
    expect(parseActionLine('打开：https://github.com/o/r/issues/1')).toEqual({ kind: 'open', value: 'https://github.com/o/r/issues/1', url: 'https://github.com/o/r/issues/1' });
    expect(parseActionLine('打开：总览页')).toEqual({ kind: 'open', value: '总览页' });
    expect(parseActionLine('决定：方案 A / 方案 B')).toEqual({ kind: 'choice', options: ['方案 A', '方案 B'] });
    expect(parseActionLine('本人操作：登录 ChatGPT')).toEqual({ kind: 'manual', value: '登录 ChatGPT' });
  });
  it('never turns a javascript or http link into an openable button', () => {
    expect(parseActionLine('打开：javascript:alert(1)')).toEqual({ kind: 'open', value: 'javascript:alert(1)' });
    expect(parseActionLine('打开：http://example.com')).toEqual({ kind: 'open', value: 'http://example.com' });
  });
  it('ignores ordinary text and malformed choices', () => {
    expect(parseActionLine('打开首页看看')).toBeUndefined();
    expect(parseActionLine('决定：只有一个')).toBeUndefined();
    expect(parseActionLine('决定：A / A')).toBeUndefined();
    expect(parseActionLine('决定：a/b/c/d/e/f/g')).toBeUndefined();
  });
  it('keeps old entries unchanged and keeps action lines out of the structured fields', () => {
    const old = parseAcceptanceSection('o/r', 1, '## 待用户验收\n- 检查 A\n  - 操作步骤：点开\n  - 预期结果：看到');
    expect(old[0].actions).toBeUndefined();
    expect(old[0].steps).toBe('点开');
    const withActions = parseAcceptanceSection('o/r', 1, '## 待用户验收\n- 检查 A\n  - 操作步骤：点开\n  - 预期结果：看到\n  - 命令：pnpm dev\n  - 打开：https://example.com/x');
    expect(withActions).toHaveLength(1);
    expect(withActions[0].steps).toBe('点开');
    expect(withActions[0].raw).toBeUndefined();
    const loose = parseAcceptanceSection('o/r', 1, '## 待用户验收\n- 看一下首页\n  - 命令：pnpm dev\n  - 顺便确认颜色');
    expect(loose[0].raw).toBe('- 看一下首页\n  - 顺便确认颜色');
    expect(loose[0].actions).toEqual([{ kind: 'command', value: 'pnpm dev' }]);
    expect(withActions[0].actions).toEqual([{ kind: 'command', value: 'pnpm dev' }, { kind: 'open', value: 'https://example.com/x', url: 'https://example.com/x' }]);
  });
});

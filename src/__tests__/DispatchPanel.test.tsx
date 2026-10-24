// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.reject(new Error('not tauri'))), isTauri: () => false }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { DispatchPanel } from '../workbench/DispatchPanel';
import { parseLaunchResult, parseRuns, type DispatchLaunchApi, type DispatchRun } from '../host/dispatchLaunch';

let root: Root | undefined;
let container: HTMLDivElement;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const labels = () => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
  await flush();
}
const run = (over: Partial<DispatchRun> = {}): DispatchRun => ({ runId: 'dispatch-1', agent: 'claude', repo: 'o/r', issue: 5, pid: 9,
  startedAt: 1, state: 'exited', exitCode: 0, tail: '全部完成', ...over });
const api = (over: Partial<DispatchLaunchApi> = {}): DispatchLaunchApi & { launch: ReturnType<typeof vi.fn> } => ({
  launch: vi.fn(async () => ({ ok: true, code: 'opened' as const, prompt: '口令文本' })),
  runs: vi.fn(async () => ({ runs: [run()], defaultWorkdir: 'D:\\ai-one' })),
  ...over,
}) as never;
async function render(fake: DispatchLaunchApi, onCopy = vi.fn(async () => {})) {
  root = createRoot(container);
  const current = root;
  await act(async () => current.render(<DispatchPanel locale="zh-CN" repo="o/r" issue={5} api={fake} onCopy={onCopy} />));
  await flush();
  await click('派工');
  return onCopy;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(async () => { const current = root; root = undefined; if (current) await act(async () => current.unmount()); container.remove(); });

describe('one-click dispatch panel', () => {
  it('opens the desktop client by default, copies the prompt and shows it', async () => {
    const fake = api();
    const onCopy = await render(fake);
    expect(container.textContent).toContain('打开桌面客户端并给口令');
    await click('派给 Claude Code');
    expect(fake.launch).toHaveBeenCalledExactlyOnceWith({ agent: 'claude', mode: 'desktop', repo: 'o/r', issue: 5, workdir: 'D:\\ai-one' });
    expect(onCopy).toHaveBeenCalledWith('口令文本');
    expect(container.textContent).toContain('口令也已复制');
    expect(container.textContent).toContain('口令文本');
  });
  it('says honestly when the prompt could not be copied', async () => {
    await render(api(), vi.fn(async () => { throw new Error('no clipboard'); }));
    await click('派给 Claude Code');
    expect(container.textContent).toContain('口令没能复制');
  });
  it('warns that a Claude command-line session is not in the desktop app, and runs it in the background', async () => {
    const fake = api({ launch: vi.fn(async () => ({ ok: true, code: 'launched' as const, pid: 77, runId: 'dispatch-2' })) });
    await render(fake);
    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    await act(async () => radios.find((r) => r.parentElement?.textContent?.includes('命令行'))!.click());
    expect(container.textContent).toContain('不会出现在 Claude 桌面客户端里');
    await click('派给 Claude Code');
    expect(fake.launch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'cli' }));
    expect(container.textContent).toContain('进程 77');
  });
  it('warns that Codex on the command line cannot reach GitHub from its sandbox', async () => {
    await render(api());
    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    await act(async () => radios.find((r) => r.parentElement?.textContent === 'Codex')!.click());
    await act(async () => ([...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]).find((r) => r.parentElement?.textContent?.includes('命令行'))!.click());
    expect(container.textContent).toContain('沙箱里读不到你的 GitHub 登录');
  });
  it('does not claim success for a failed or unknown result and never double-sends', async () => {
    let finish!: (value: { ok: false; code: 'unavailable' }) => void;
    const fake = api({ launch: vi.fn(() => new Promise((resolve) => { finish = resolve as never; })) as never });
    await render(fake);
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === '派给 Claude Code')!.click(); });
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === '正在派工…')?.click(); });
    expect(fake.launch).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: false, code: 'unavailable' }); });
    await flush();
    expect(container.textContent).toContain('结果不明');
    expect(container.textContent).not.toContain('已在后台启动');
  });
  it('disables dispatch without a working folder and lists this Issue runs with their output', async () => {
    await render(api({ runs: vi.fn(async () => ({ runs: [run(), run({ runId: 'x', issue: 6 })] })) }));
    expect(container.querySelector('button[disabled]')?.textContent).toContain('派给 Claude Code');
    expect(container.textContent).toContain('已结束（退出码 0）');
    expect(container.textContent).toContain('全部完成');
    expect(container.querySelectorAll('details')).toHaveLength(1);
    expect(labels()).toContain('派工');
  });
  it('remembers agent and mode between visits', async () => {
    const fake = api();
    await render(fake);
    const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    await act(async () => radios.find((r) => r.parentElement?.textContent === 'Codex')!.click());
    expect(JSON.parse(localStorage.getItem('ai-one.dispatch.launch.v1')!)).toMatchObject({ agent: 'codex' });
  });
});

describe('host result parsing', () => {
  it('accepts only well-formed results and never reads a failure as success', () => {
    expect(parseLaunchResult(JSON.stringify({ ok: true, code: 'opened', prompt: 'p' }))).toEqual({ ok: true, code: 'opened', prompt: 'p' });
    expect(parseLaunchResult(JSON.stringify({ ok: true, code: 'spawn_failed' }))).toEqual({ ok: false, code: 'unavailable' });
    expect(parseLaunchResult(JSON.stringify({ ok: false, code: 'launched' }))).toEqual({ ok: false, code: 'unavailable' });
    expect(parseLaunchResult('not json')).toEqual({ ok: false, code: 'unavailable' });
    expect(parseLaunchResult(JSON.stringify({ ok: true, code: 'launched', pid: 5, runId: 'r' }))).toMatchObject({ pid: 5, runId: 'r' });
  });
  it('drops malformed runs', () => {
    const good = { runId: 'a', agent: 'codex', repo: 'o/r', issue: 1, pid: 2, startedAt: 3, state: 'running', exitCode: null, tail: '' };
    const parsed = parseRuns(JSON.stringify({ runs: [good, { ...good, agent: 'evil' }, { ...good, state: 'weird' }, null], defaultWorkdir: 'D:\\x' }));
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.defaultWorkdir).toBe('D:\\x');
    expect(parseRuns('garbage').runs).toEqual([]);
  });
});

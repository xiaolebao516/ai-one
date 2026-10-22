import { beforeEach, describe, expect, it, vi } from 'vitest';
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: () => true }));
import { host } from '../host';

describe('host dispatch read-only API', () => {
  beforeEach(() => { invokeMock.mockReset(); });
  it('invokes one fixed read command with only the selected repository path', async () => {
    invokeMock.mockResolvedValue({ sessions: [], receipts: [], slots: [] });
    await host.dispatch.snapshot('D:/Repository/example');
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('dispatch_readonly_snapshot', { repoPath: 'D:/Repository/example' });
  });
  it('never surfaces raw host errors', async () => {
    invokeMock.mockRejectedValue('PRIVATE_ERROR_WITH_TOKEN');
    await expect(host.dispatch.snapshot('bad')).rejects.toThrow('派工元数据读取失败，请检查仓库路径和本机文件权限');
    expect(host.app.isDesktop()).toBe(true);
  });
});

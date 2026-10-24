import { beforeEach, expect, it, vi } from 'vitest';
import { startBridgePull } from '../bridge/pull';
import { prepareProviderPage } from '../workflow/chatLed/env';
import { runWorkflow } from '../workflow';
import { runDiscussionWorkflow } from '../stages/discussionRuntime';

vi.mock('../bridge/pull', () => ({ startBridgePull: vi.fn() }));
vi.mock('../workflow/chatLed/env', () => ({ prepareProviderPage: vi.fn() }));
vi.mock('../workflow', () => ({ runWorkflow: vi.fn() }));
const disconnect = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(startBridgePull).mockResolvedValue(disconnect);
  vi.mocked(prepareProviderPage).mockResolvedValue(undefined);
  vi.mocked(runWorkflow).mockResolvedValue({ ok: true });
});
it('connects the reply transport and readies hidden provider pages before starting the graph', async () => {
  await runDiscussionWorkflow({ text: 'question', mode: 'consult', presetId: 'deliberation' }, ['chatgpt', 'gemini', 'claude']);
  expect(startBridgePull).toHaveBeenCalledTimes(1);
  expect(prepareProviderPage).toHaveBeenCalledTimes(3);
  expect(vi.mocked(prepareProviderPage).mock.invocationCallOrder[2]).toBeLessThan(vi.mocked(runWorkflow).mock.invocationCallOrder[0]);
  expect(disconnect).toHaveBeenCalledTimes(1);
});
it('does not send on failed page readiness and releases its transport reference', async () => {
  vi.mocked(prepareProviderPage).mockRejectedValueOnce(new Error('not logged in'));
  await expect(runDiscussionWorkflow({ text: 'question', mode: 'consult' }, ['chatgpt'])).rejects.toThrow('not logged in');
  expect(runWorkflow).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

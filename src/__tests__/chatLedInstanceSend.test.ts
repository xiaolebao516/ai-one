import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  eval: vi.fn(),
  evalWithCallback: vi.fn(),
}));
vi.mock('../host', () => ({ host: { provider: mocks } }));
import { cancelInstanceSend, sendAndWaitInstance } from '../workflow/chatLed/sendInstance';

describe('extra ChatGPT instance response isolation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.send.mockResolvedValue(undefined);
    mocks.eval.mockResolvedValue(undefined);
  });

  it('reads each worker page independently and does not route base-provider replies across instances', async () => {
    mocks.evalWithCallback.mockImplementation(async (instance: string) => {
      const text = instance === 'chatgpt#2' ? 'worker two' : 'worker three';
      return JSON.stringify([{
        v: 1, provider: 'chatgpt', bootId: instance, mid: 1,
        action: 'RESPONSE_DONE', payload: text,
      }]);
    });
    const [two, three] = await Promise.all([
      sendAndWaitInstance('chatgpt#2', 'same task'),
      sendAndWaitInstance('chatgpt#3', 'same task'),
    ]);
    expect([two, three]).toEqual(['worker two', 'worker three']);
    // Stale replies from an earlier cancelled send are dropped atomically with the dispatch.
    expect(mocks.send).toHaveBeenCalledWith('chatgpt#2', 'same task', { drainOutbox: true });
    expect(mocks.send).toHaveBeenCalledWith('chatgpt#3', 'same task', { drainOutbox: true });
    expect(mocks.eval.mock.calls.map((args) => args[0])).toEqual(
      expect.arrayContaining(['chatgpt#2', 'chatgpt#3']),
    );
  });

  it('cancels a pending reply on the target worker without stopping another worker', async () => {
    mocks.evalWithCallback.mockImplementation((instance: string) =>
      instance === 'chatgpt#2'
        ? new Promise<string>(() => undefined)
        : Promise.resolve(JSON.stringify([{
            v: 1, provider: 'chatgpt', bootId: '3', mid: 1,
            action: 'RESPONSE_DONE', payload: 'third is fine',
          }])),
    );
    const failed = sendAndWaitInstance('chatgpt#2', 'long task');
    const successful = sendAndWaitInstance('chatgpt#3', 'quick task');
    cancelInstanceSend('chatgpt#2');
    await expect(failed).rejects.toThrow('cancelled');
    await expect(successful).resolves.toBe('third is fine');
  });

  function silentWorker(generating: boolean, answerAfterMs: number) {
    const startedAt = Date.now();
    mocks.evalWithCallback.mockImplementation(async (_instance: string, js: string) => {
      if (js.includes('generating')) return JSON.stringify(generating);
      if (Date.now() - startedAt < answerAfterMs) return '[]';
      return JSON.stringify([{ v: 1, provider: 'chatgpt', bootId: 'b', mid: 1, action: 'RESPONSE_DONE', payload: 'thought it through' }]);
    });
  }

  it('keeps waiting while the worker thinks for longer than ten minutes without output', async () => {
    vi.useFakeTimers();
    try {
      silentWorker(true, 14 * 60_000);
      const reply = sendAndWaitInstance('chatgpt#2', 'hard task');
      reply.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      await expect(reply).resolves.toBe('thought it through');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still gives up after ten silent minutes when the worker is not generating', async () => {
    vi.useFakeTimers();
    try {
      silentWorker(false, 14 * 60_000);
      const reply = sendAndWaitInstance('chatgpt#2', 'stuck task');
      reply.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(11 * 60_000);
      await expect(reply).rejects.toThrow('Provider instance response timed out.');
    } finally {
      vi.useRealTimers();
    }
  });
});

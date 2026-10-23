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
    expect(mocks.send).toHaveBeenCalledWith('chatgpt#2', 'same task');
    expect(mocks.send).toHaveBeenCalledWith('chatgpt#3', 'same task');
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
});

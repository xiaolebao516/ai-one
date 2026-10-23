import { describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../../shared/types';
import { ChatLedController, type ChatLedEnv } from '../workflow/chatLed/controller';

const SEND = (to: string[], message: string) => '```ai-one-send\n' + JSON.stringify({ to, message }) + '\n```';
const DONE = (summary: string) => '```ai-one-done\n' + JSON.stringify({ summary }) + '\n```';

interface Script {
  chatgpt: (string | Error)[];
  claude?: (string | Error)[];
  gemini?: (string | Error)[];
}

function makeEnv(script: Script, sendable: AIProvider[] = ['chatgpt', 'claude', 'gemini']) {
  const calls: { provider: AIProvider; text: string }[] = [];
  const events: string[] = [];
  const queues: Record<string, (string | Error)[]> = {
    chatgpt: [...script.chatgpt],
    claude: [...(script.claude ?? [])],
    gemini: [...(script.gemini ?? [])],
  };
  let clock = 1000;
  const env: ChatLedEnv = {
    now: () => (clock += 1),
    sendableProviders: async () => sendable,
    prepare: vi.fn(async () => undefined),
    newSession: vi.fn(async (provider: AIProvider) => {
      events.push(`new:${provider}`);
    }),
    send: vi.fn(async (provider: AIProvider, text: string) => {
      events.push(`send:${provider}`);
      calls.push({ provider, text });
      const next = queues[provider]?.shift();
      if (next === undefined) throw new Error(`no scripted reply for ${provider}`);
      if (next instanceof Error) throw next;
      return next;
    }),
    stop: vi.fn(async () => undefined),
    readConversationUrl: vi.fn(async (provider: AIProvider) => `https://example.test/${provider}/c/123`),
  };
  return { env, calls, events };
}

async function create(env: ChatLedEnv, roundLimit?: number) {
  return ChatLedController.create(env, {
    id: 'run-1',
    goal: 'compare two designs',
    candidates: ['claude', 'gemini', 'chatgpt'],
    roundLimit,
  });
}

describe('ChatLedController', () => {
  it('runs coordinator -> forward -> feedback -> done and registers only conversations it created', async () => {
    const { env, calls, events } = makeEnv({
      chatgpt: [SEND(['claude'], 'please review X'), DONE('all good')],
      claude: ['claude says: looks fine'],
    });
    const controller = await create(env);
    await controller.start();
    const run = controller.getRun();
    expect(run.phase).toBe('finished');
    expect(run.doneSummary).toBe('all good');
    expect(run.forwards).toHaveLength(1);
    expect(run.forwards[0]).toMatchObject({ to: 'claude', status: 'done', reply: 'claude says: looks fine' });
    // the forwarded text is the complete message, and the coordinator got the complete reply back
    expect(calls[1]).toEqual({ provider: 'claude', text: 'please review X' });
    expect(calls[2].provider).toBe('chatgpt');
    expect(calls[2].text).toContain('claude says: looks fine');
    // each provider gets its own new session before its first send
    expect(events.indexOf('new:claude')).toBeLessThan(events.indexOf('send:claude'));
    expect(events.filter((e) => e === 'new:claude')).toHaveLength(1);
    expect(run.conversations.map((c) => c.provider).sort()).toEqual(['chatgpt', 'claude']);
    expect(run.conversations.every((c) => c.createdByAiOne)).toBe(true);
  });

  it('stops on a protocol violation without forwarding anything', async () => {
    const { env, calls } = makeEnv({ chatgpt: ['I think we should ask claude to review it.'] });
    const controller = await create(env);
    await controller.start();
    const run = controller.getRun();
    expect(run.phase).toBe('awaiting-user');
    expect(run.stop).toMatchObject({ type: 'protocol-violation' });
    expect(run.forwards).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it('remind() continues after a violation', async () => {
    const { env, calls } = makeEnv({ chatgpt: ['no fence here', DONE('ok')] });
    const controller = await create(env);
    await controller.start();
    await controller.remind();
    expect(controller.getRun().phase).toBe('finished');
    expect(calls).toHaveLength(2);
  });

  it('refuses unavailable targets as a violation (not logged in)', async () => {
    const { env, calls } = makeEnv({ chatgpt: [SEND(['gemini'], 'hi')] }, ['chatgpt', 'claude']);
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().stop).toMatchObject({ type: 'protocol-violation', violation: { code: 'unavailable-target' } });
    expect(calls).toHaveLength(1);
  });

  it('stops at the round limit and can be extended', async () => {
    const { env } = makeEnv({
      chatgpt: [SEND(['claude'], 'one'), SEND(['claude'], 'two'), DONE('too late'), DONE('end')],
      claude: ['r1', 'r2'],
    });
    const controller = await create(env, 2);
    await controller.start();
    expect(controller.getRun().phase).toBe('awaiting-user');
    expect(controller.getRun().stop).toMatchObject({ type: 'round-limit' });
    await controller.extendLimit(4);
    expect(controller.getRun().phase).toBe('finished');
  });

  it('feeds a forwarding failure back to the coordinator instead of hiding it', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['claude'], 'hi'), DONE('handled')],
      claude: [new Error('claude page timed out')],
    });
    const controller = await create(env);
    await controller.start();
    const run = controller.getRun();
    expect(run.forwards[0].status).toBe('failed');
    expect(calls[2].text).toContain('claude page timed out');
    expect(run.phase).toBe('finished');
  });

  it('marks the run failed when the coordinator itself fails', async () => {
    const { env } = makeEnv({ chatgpt: [new Error('chatgpt unreachable')] });
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().stop).toMatchObject({ type: 'provider-failure', provider: 'chatgpt' });
  });

  it('pause holds the next send until resume', async () => {
    let release: (value: string) => void = () => undefined;
    const { env, calls } = makeEnv({ chatgpt: [DONE('x')] });
    env.send = vi.fn(async (provider: AIProvider, text: string) => {
      calls.push({ provider, text });
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const controller = await create(env);
    const finished = controller.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.pause();
    expect(controller.getRun().phase).toBe('paused');
    release(DONE('paused then done'));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getRun().phase).toBe('paused');
    controller.resume();
    await finished;
    expect(controller.getRun().phase).toBe('finished');
  });

  it('stop cancels in-flight forwards, asks providers to stop and registers conversations first', async () => {
    const { env, calls } = makeEnv({ chatgpt: [SEND(['claude'], 'slow')] });
    env.send = vi.fn(async (provider: AIProvider, text: string) => {
      calls.push({ provider, text });
      if (provider === 'chatgpt') return SEND(['claude'], 'slow');
      return new Promise<string>(() => undefined); // claude never answers
    });
    const controller = await create(env);
    const finished = controller.start();
    await vi.waitFor(() => expect(controller.getRun().forwards[0]?.status).toBe('waiting'));
    await controller.stop();
    await finished;
    const run = controller.getRun();
    expect(run.phase).toBe('stopped');
    expect(run.forwards[0].status).toBe('cancelled');
    expect(env.stop).toHaveBeenCalledWith('claude');
    expect(run.conversations.map((c) => c.provider).sort()).toEqual(['chatgpt', 'claude']);
  });

  it('does not send when stop arrives while newSession is still pending, and keeps that session known', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('never')] });
    let finishSession: () => void = () => undefined;
    env.newSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSession = resolve;
        }),
    );
    const controller = await create(env);
    const finished = controller.start();
    await vi.waitFor(() => expect(env.newSession).toHaveBeenCalled());
    const stopping = controller.stop();
    finishSession();
    await stopping;
    await finished;
    expect(calls).toHaveLength(0);
    expect(controller.getRun().phase).toBe('stopped');
    expect(controller.getRun().conversations.map((c) => c.provider)).toEqual(['chatgpt']);
  });

  it('does not send while paused during prepare; resumes afterwards', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('ok')] });
    let finishPrepare: () => void = () => undefined;
    env.prepare = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPrepare = resolve;
        }),
    );
    const controller = await create(env);
    const finished = controller.start();
    await vi.waitFor(() => expect(env.prepare).toHaveBeenCalled());
    controller.pause();
    finishPrepare();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);
    controller.resume();
    await finished;
    expect(calls).toHaveLength(1);
    expect(controller.getRun().phase).toBe('finished');
  });

  it('stopping while the coordinator is paused still asks the coordinator page to stop', async () => {
    const { env, calls } = makeEnv({ chatgpt: [] });
    env.send = vi.fn(async (provider: AIProvider, text: string) => {
      calls.push({ provider, text });
      return new Promise<string>(() => undefined);
    });
    const controller = await create(env);
    const finished = controller.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.pause();
    await controller.stop();
    await finished;
    expect(env.stop).toHaveBeenCalledWith('chatgpt');
  });

  it('registers the target conversation even when the send fails', async () => {
    const { env } = makeEnv({
      chatgpt: [SEND(['claude'], 'hi'), DONE('done anyway')],
      claude: [new Error('send blew up')],
    });
    const controller = await create(env);
    await controller.start();
    const run = controller.getRun();
    expect(run.forwards[0].status).toBe('failed');
    expect(run.phase).toBe('finished');
    expect(run.conversations.map((c) => c.provider).sort()).toEqual(['chatgpt', 'claude']);
  });

  it('records the export and the cleanup outcome once', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('ok')] });
    const controller = await create(env);
    await controller.start();
    controller.markExported();
    expect(controller.getRun().exportedAt).toBeDefined();
    controller.recordCleanupResults([{ provider: 'chatgpt', outcome: 'deleted', note: 'x' }]);
    controller.recordCleanupResults([{ provider: 'chatgpt', outcome: 'manual', note: 'overwrite attempt' }]);
    expect(controller.getRun().cleanupResults).toEqual([{ provider: 'chatgpt', outcome: 'deleted', note: 'x' }]);
  });

  it('refuses to send into a conversation the user switched to while taking over', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['claude'], 'first'), SEND(['claude'], 'second'), DONE('done')],
      claude: ['reply 1', 'reply 2'],
    });
    let claudeReads = 0;
    env.readConversationUrl = vi.fn(async (provider: AIProvider) => {
      if (provider !== 'claude') return `https://example.test/${provider}/c/123`;
      claudeReads += 1;
      // read 1 = registration right after the first reply; later reads = the user took over
      return claudeReads === 1 ? 'https://example.test/claude/c/123' : 'https://example.test/claude/c/USERS-OWN-CHAT';
    });
    env.send = vi.fn(async (provider: AIProvider, text: string) => {
      calls.push({ provider, text });
      if (provider === 'claude') {
        const reply = calls.filter((c) => c.provider === 'claude').length === 1 ? 'reply 1' : 'reply 2';
        return reply;
      }
      const n = calls.filter((c) => c.provider === 'chatgpt').length;
      return [SEND(['claude'], 'first'), SEND(['claude'], 'second'), DONE('done')][n - 1];
    });
    const controller = await create(env);
    await controller.start();
    const run = controller.getRun();
    expect(calls.filter((c) => c.provider === 'claude')).toHaveLength(1);
    expect(run.forwards[1].status).toBe('failed');
    expect(run.forwards[1].error).toContain('no longer on the conversation');
    // the user's own conversation is never registered as created by ai-one
    expect(run.conversations.some((c) => c.url.includes('USERS-OWN-CHAT'))).toBe(false);
  });

  it('starts a fresh session instead of trusting an address that was never captured', async () => {
    const { env } = makeEnv({
      chatgpt: [SEND(['claude'], 'first'), SEND(['claude'], 'second'), DONE('done')],
      claude: ['r1', 'r2'],
    });
    let reads = 0;
    env.readConversationUrl = vi.fn(async (provider: AIProvider) => {
      if (provider !== 'claude') return `https://example.test/${provider}/c/123`;
      reads += 1;
      return reads === 1 ? 'https://example.test/' : 'https://example.test/claude/c/second-session';
    });
    const controller = await create(env);
    await controller.start();
    expect(env.newSession).toHaveBeenCalledTimes(3); // chatgpt once, claude twice
    const claudeUrls = controller.getRun().conversations.filter((c) => c.provider === 'claude').map((c) => c.url);
    expect(claudeUrls).toContain('https://example.test/claude/c/second-session');
  });

  it('stop sends its stop requests without waiting for an unreadable page address', async () => {
    const { env, calls } = makeEnv({ chatgpt: [] });
    env.send = vi.fn(async (provider: AIProvider, text: string) => {
      calls.push({ provider, text });
      return new Promise<string>(() => undefined);
    });
    env.readConversationUrl = vi.fn(() => new Promise<string | undefined>(() => undefined));
    const controller = await create(env);
    void controller.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    void controller.stop();
    await vi.waitFor(() => expect(env.stop).toHaveBeenCalledWith('chatgpt'));
    expect(controller.getRun().phase).toBe('stopped');
  });
});

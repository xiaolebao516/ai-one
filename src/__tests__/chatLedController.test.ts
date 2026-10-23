import { describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../../shared/types';
import type { ChatLedRun } from '../workflow/chatLed/types';
import { loadRuns, saveRunChecked, type ChatLedStorage } from '../workflow/chatLed/store';
import {
  CHAT_LED_INIT_SETTLE_TIMEOUT_MS,
  ChatLedController,
  type ChatLedEnv,
} from '../workflow/chatLed/controller';

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
  let sessionSequence = 0;
  const urls = new Map<AIProvider, string>();
  const env: ChatLedEnv = {
    now: () => (clock += 1),
    sendableProviders: async () => sendable,
    prepare: vi.fn(async () => undefined),
    newSession: vi.fn(async (provider: AIProvider) => {
      events.push(`new:${provider}`);
      const url = `https://example.test/${provider}/c/new-${++sessionSequence}`;
      urls.set(provider, url);
      return { url };
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
    readConversationUrl: vi.fn(async (provider: AIProvider) =>
      urls.get(provider) ?? `https://example.test/${provider}/c/existing`,
    ),
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
  it('sends from a verified blank new page before the server creates its conversation URL', async () => {
    const { env, calls } = makeEnv({ chatgpt: [] });
    let url = 'https://chatgpt.com/';
    env.newSession = vi.fn(async () => ({ url, freshDocument: true, documentId: 'fresh-boot' }));
    env.readDocumentId = vi.fn(async () => 'fresh-boot');
    env.readConversationUrl = vi.fn(async () => url);
    env.send = vi.fn(async (provider: AIProvider, text: string) => {
      calls.push({ provider, text });
      url = 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111';
      return DONE('blank-page works');
    });
    const controller = await create(env);
    await controller.start();
    expect(calls).toHaveLength(1);
    expect(controller.getRun().phase).toBe('finished');
    expect(controller.getRun().conversations).toContainEqual(expect.objectContaining({ url, registrationStatus: 'confirmed' }));
    expect(controller.hasPendingSessions()).toBe(false);
  });

  it('does not treat an existing conversation as a verified blank page', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('unused')] });
    const url = 'https://chatgpt.com/c/users-own-chat';
    env.newSession = vi.fn(async () => ({ url, freshDocument: true }));
    env.readConversationUrl = vi.fn(async () => url);
    const controller = await create(env);
    await controller.start();
    expect(calls).toHaveLength(0);
    expect(controller.getRun().phase).toBe('awaiting-user');
  });

  it('prepares coordinator and candidates before querying sendability on a cold start', async () => {
    const ready = new Set<AIProvider>();
    const { env, calls } = makeEnv({ chatgpt: [DONE('ready')] }, []);
    env.initialize = vi.fn(async () => undefined);
    env.sendableProviders = vi.fn(async () => [...ready]);
    const prepare = vi.fn(async (provider: AIProvider) => {
      ready.add(provider);
    });
    env.prepare = prepare;
    const controller = await create(env);
    expect(env.initialize).not.toHaveBeenCalled();
    expect(env.sendableProviders).not.toHaveBeenCalled();
    await controller.start();
    expect(prepare.mock.calls.slice(0, 3).map(([provider]) => provider)).toEqual(['chatgpt', 'claude', 'gemini']);
    expect(env.initialize).toHaveBeenCalledTimes(1);
    expect(env.sendableProviders).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(controller.getRun().phase).toBe('finished');
    expect(controller.getRun().available).toEqual(['claude', 'gemini']);
  });

  it('surfaces bridge initialization failure instead of staying idle', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('unused')] });
    env.initialize = vi.fn(async () => {
      throw new Error('bridge subscription failed');
    });
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().phase).toBe('awaiting-user');
    expect(controller.getRun().stop).toMatchObject({
      type: 'provider-failure',
      provider: 'chatgpt',
      error: 'bridge subscription failed',
    });
  });

  it('fails visibly when no candidate target is confirmed ready', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('unused')] });
    env.sendableProviders = vi.fn(async (): Promise<AIProvider[]> => ['chatgpt']);
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().phase).toBe('awaiting-user');
    expect(controller.getRun().stop).toMatchObject({ type: 'provider-failure', provider: 'chatgpt' });
    const stop = controller.getRun().stop;
    expect(stop?.type).toBe('provider-failure');
    if (stop?.type === 'provider-failure') expect(stop.error).toContain('No candidate target AI');
    expect(calls).toHaveLength(0);
  });

  it('stops during startup prepare and never sends after a delayed prepare returns', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('unused')] });
    let finishPrepare: () => void = () => undefined;
    env.prepare = vi.fn(() => new Promise<void>((resolve) => { finishPrepare = resolve; }));
    const controller = await create(env);
    const started = controller.start();
    await vi.waitFor(() => expect(env.prepare).toHaveBeenCalledWith('chatgpt'));

    vi.useFakeTimers();
    try {
      const stopping = controller.stop();
      expect(controller.getRun().phase).toBe('stopped');
      expect(env.stop).toHaveBeenCalledWith('chatgpt');
      await vi.advanceTimersByTimeAsync(CHAT_LED_INIT_SETTLE_TIMEOUT_MS);
      await stopping;
      finishPrepare();
      await started;
      expect(calls).toHaveLength(0);
      expect(controller.getRun().phase).toBe('stopped');
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('does not send when stop arrives while newSession is pending and records an uncertain attempt for manual check', async () => {
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
    expect(controller.getRun().conversations).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: '',
      registrationStatus: 'manual',
    }));
    expect(controller.getRun().sessionInitializations[0]).toMatchObject({ status: 'manual' });
  });

  it('does not send while paused during prepare; resumes afterwards', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('ok')] });
    let finishPrepare: () => void = () => undefined;
    env.prepare = vi.fn(async (): Promise<void> => undefined).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishPrepare = resolve; }),
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

  it('treats a provider error sentinel as a failed forward, not a successful reply', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['claude'], 'review this'), DONE('done')],
      claude: ['[Error: synthetic send rejection]'],
    });
    const controller = await create(env);
    await controller.start();
    const forward = controller.getRun().forwards[0];
    expect(controller.getRun().phase).toBe('finished');
    expect(forward).toMatchObject({ status: 'failed' });
    expect(forward?.reply).toBeUndefined();
    expect(forward?.error).toContain('synthetic send rejection');
    expect(calls[2]?.provider).toBe('chatgpt');
    expect(calls[2]?.text).toContain('转发失败');
  });

  it('records a manual session when newSession has a side effect but then rejects', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('unused')] });
    env.newSession = vi.fn(async (provider: AIProvider) => {
      env.readConversationUrl = vi.fn(async (p: AIProvider) =>
        `https://example.test/${p}/c/${p === provider ? 'new-after-side-effect' : 'existing'}`,
      );
      throw new Error('newSession failed after creating the page');
    });
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().phase).toBe('awaiting-user');
    expect(controller.getRun().stop).toMatchObject({ type: 'provider-failure', provider: 'chatgpt' });
    expect(controller.getRun().conversations).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: '',
      registrationStatus: 'manual',
    }));
    expect(controller.getRun().sessionInitializations[0]).toMatchObject({ status: 'manual' });
    expect(calls).toHaveLength(0);
  });

  it('records a manual creation when post-session readiness fails', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('unused')] });
    let coordinatorPrepareCalls = 0;
    env.prepare = vi.fn(async (provider: AIProvider) => {
      if (provider === 'chatgpt') {
        coordinatorPrepareCalls += 1;
        if (coordinatorPrepareCalls === 3) throw new Error('session page is not ready');
      }
    });
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().phase).toBe('awaiting-user');
    expect(controller.getRun().stop).toMatchObject({
      type: 'provider-failure',
      provider: 'chatgpt',
      error: 'session page is not ready',
    });
    expect(controller.getRun().conversations).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      registrationStatus: 'manual',
      url: '',
    }));
    expect(controller.getRun().sessionInitializations[0]).toMatchObject({ status: 'manual' });
    expect(calls).toHaveLength(0);
  });

  it('refuses to register a post-creation URL that differs from the captured session URL', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('unused')] });
    let reads = 0;
    env.readConversationUrl = vi.fn(async () => {
      reads += 1;
      return reads === 1
        ? 'https://example.test/chatgpt/c/old'
        : 'https://example.test/chatgpt/c/USERS-OWN-CHAT';
    });
    env.newSession = vi.fn(async () => ({ url: 'https://example.test/chatgpt/c/created-by-run' }));
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().phase).toBe('awaiting-user');
    expect(controller.getRun().conversations).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: '',
      registrationStatus: 'manual',
    }));
    expect(controller.getRun().conversations.some((conversation) => conversation.url.includes('USERS-OWN-CHAT'))).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('pausing during newSession registers the new URL but holds the send until resume', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('ok')] });
    let finishSession: () => void = () => undefined;
    let reads = 0;
    env.readConversationUrl = vi.fn(async (provider: AIProvider) => {
      if (provider !== 'chatgpt') return `https://example.test/${provider}/c/existing`;
      reads += 1;
      return reads === 1 ? 'https://example.test/chatgpt/c/old' : 'https://example.test/chatgpt/c/new';
    });
    env.newSession = vi.fn(() => new Promise<void>((resolve) => { finishSession = resolve; }));
    const controller = await create(env);
    const finished = controller.start();
    await vi.waitFor(() => expect(env.newSession).toHaveBeenCalled());
    controller.pause();
    finishSession();
    await vi.waitFor(() => expect(controller.getRun().sessionInitializations[0]?.status).toBe('registered'));
    expect(calls).toHaveLength(0);
    controller.resume();
    await finished;
    expect(calls).toHaveLength(1);
    expect(controller.getRun().phase).toBe('finished');
  });

  it('keeps a manual record when session creation resolves after Stop has timed out', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('unused')] });
    let finishSession: () => void = () => undefined;
    env.newSession = vi.fn(() => new Promise<void>((resolve) => { finishSession = resolve; }));
    const controller = await create(env);
    const finished = controller.start();
    await vi.waitFor(() => expect(env.newSession).toHaveBeenCalled());

    vi.useFakeTimers();
    try {
      const stopping = controller.stop();
      await vi.advanceTimersByTimeAsync(CHAT_LED_INIT_SETTLE_TIMEOUT_MS);
      await stopping;
      expect(controller.getRun().phase).toBe('stopped');
      expect(controller.hasPendingSessions()).toBe(false);
      expect(controller.getRun().sessionInitializations[0]).toMatchObject({ status: 'manual' });
      expect(controller.getRun().conversations).toContainEqual(expect.objectContaining({
        provider: 'chatgpt',
        url: '',
        registrationStatus: 'manual',
      }));

      finishSession();
      await finished;
      await Promise.resolve();
      expect(controller.getRun().conversations.some((conversation) => conversation.url.includes('existing'))).toBe(false);
      expect(calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('markClosed refuses to close while a session registration is pending', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('unused')] });
    let finishSession: () => void = () => undefined;
    let reads = 0;
    env.readConversationUrl = vi.fn(async (provider: AIProvider) => {
      if (provider !== 'chatgpt') return `https://example.test/${provider}/c/existing`;
      reads += 1;
      return reads === 1 ? 'https://example.test/chatgpt/c/old' : 'https://example.test/chatgpt/c/new';
    });
    env.newSession = vi.fn(() => new Promise<void>((resolve) => { finishSession = resolve; }));
    const controller = await create(env);
    const finished = controller.start();
    await vi.waitFor(() => expect(env.newSession).toHaveBeenCalled());
    const stopping = controller.stop();
    controller.markClosed(true);
    expect(controller.getRun().closed).toBeUndefined();
    finishSession();
    await stopping;
    await finished;
    expect(controller.getRun().sessionInitializations[0]?.status).toBe('manual');
    controller.markClosed(true);
    expect(controller.getRun().closed).toBeDefined();
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


  it('does not start provider I/O when a run checkpoint fails', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('must not send')] });
    env.sendableProviders = vi.fn(async (): Promise<AIProvider[]> => ['chatgpt', 'claude', 'gemini']);
    const controller = await create(env);
    controller.subscribe(() => false);

    await controller.start();

    expect(env.prepare).not.toHaveBeenCalled();
    expect(env.sendableProviders).not.toHaveBeenCalled();
    expect(env.newSession).not.toHaveBeenCalled();
    expect(env.send).not.toHaveBeenCalled();
    expect(controller.getRun().phase).toBe('awaiting-user');
  });

  it('does not call newSession when the pending creation intent cannot be persisted', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('must not send')] });
    const controller = await create(env);
    controller.subscribe((run) => !run.sessionInitializations.some((item) => item.status === 'pending'));

    await controller.start();

    expect(env.newSession).not.toHaveBeenCalled();
    expect(env.send).not.toHaveBeenCalled();
    expect(controller.hasPendingSessions()).toBe(false);
  });

  it('stops before sending when ownership registration fails and reload recovers the durable intent as manual', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('must not send')] });
    const data = new Map<string, string>();
    const storage: ChatLedStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        const stored = JSON.parse(value) as ChatLedRun[];
        if (stored.some((run) => run.sessionInitializations.some((item) => item.status === 'registered'))) {
          throw new Error('simulated registration checkpoint failure');
        }
        data.set(key, value);
      },
    };
    let existing: ChatLedRun[] = [];
    const controller = await create(env);
    controller.subscribe((run) => {
      const saved = saveRunChecked(storage, run, existing);
      existing = saved.runs;
      return saved.persisted;
    });

    await controller.start();

    expect(env.newSession).toHaveBeenCalledTimes(1);
    expect(env.send).not.toHaveBeenCalled();
    const [recovered] = loadRuns(storage);
    expect(recovered.sessionInitializations[0]).toMatchObject({ status: 'manual' });
    expect(recovered.conversations).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: '',
      registrationStatus: 'manual',
    }));
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
    const otherReads = new Map<AIProvider, number>();
    env.readConversationUrl = vi.fn(async (provider: AIProvider) => {
      if (provider !== 'claude') {
        const n = (otherReads.get(provider) ?? 0) + 1;
        otherReads.set(provider, n);
        return `https://example.test/${provider}/c/${n === 1 ? 'old' : 'new'}`;
      }
      claudeReads += 1;
      if (claudeReads === 1) return 'https://example.test/claude/c/old-session';
      if (claudeReads <= 4) return 'https://example.test/claude/c/123';
      return 'https://example.test/claude/c/USERS-OWN-CHAT';
    });
    env.newSession = vi.fn(async (provider: AIProvider) => ({
      url: provider === 'claude'
        ? 'https://example.test/claude/c/123'
        : `https://example.test/${provider}/c/new`,
    }));
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


  it('rechecks URL identity after a pause interrupts the final URL read', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['claude'], 'first'), SEND(['claude'], 'second'), DONE('done')],
      claude: ['reply 1', 'reply 2'],
    });
    const currentUrls = new Map<AIProvider, string>();
    const targetUrl = 'https://example.test/claude/c/123';
    const userUrl = 'https://example.test/claude/c/users-own-chat';
    let claudeReads = 0;
    let releaseRead!: (url: string | undefined) => void;
    let notifyReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { notifyReadStarted = resolve; });
    env.readConversationUrl = vi.fn(async (provider: AIProvider) => {
      if (provider !== 'claude') {
        return currentUrls.get(provider) ?? ('https://example.test/' + provider + '/c/existing');
      }
      claudeReads += 1;
      if (claudeReads === 5) {
        notifyReadStarted();
        return new Promise<string | undefined>((resolve) => { releaseRead = resolve; });
      }
      return currentUrls.get(provider) ?? 'https://example.test/claude/c/existing';
    });
    env.newSession = vi.fn(async (provider: AIProvider) => {
      const url = provider === 'claude'
        ? targetUrl
        : ('https://example.test/' + provider + '/c/' + provider + '-new');
      currentUrls.set(provider, url);
      return { url };
    });
    env.send = vi.fn(async (provider: AIProvider, text: string) => {
      calls.push({ provider, text });
      if (provider === 'claude') {
        return calls.filter((call) => call.provider === 'claude').length === 1 ? 'reply 1' : 'reply 2';
      }
      const count = calls.filter((call) => call.provider === 'chatgpt').length;
      return [SEND(['claude'], 'first'), SEND(['claude'], 'second'), DONE('done')][count - 1];
    });

    const controller = await create(env);
    const started = controller.start();
    await readStarted;
    controller.pause();
    currentUrls.set('claude', userUrl);
    releaseRead(targetUrl); // stale pre-pause snapshot must be discarded
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.resume();
    await started;

    expect(calls.filter((call) => call.provider === 'claude')).toHaveLength(1);
    expect(controller.getRun().forwards[1].status).toBe('failed');
    expect(controller.getRun().forwards[1].error).toContain('no longer on the conversation');
    expect(controller.getRun().conversations.some((conversation) => conversation.url === userUrl)).toBe(false);
  });

  it('starts a fresh session instead of trusting an address that was never captured', async () => {
    const { env } = makeEnv({
      chatgpt: [SEND(['claude'], 'first'), SEND(['claude'], 'second'), DONE('done')],
      claude: ['r1', 'r2'],
    });
    const reads = new Map<AIProvider, number>();
    env.readConversationUrl = vi.fn(async (provider: AIProvider) => {
      const n = (reads.get(provider) ?? 0) + 1;
      reads.set(provider, n);
      if (provider !== 'claude') {
        return `https://example.test/${provider}/c/${n === 1 ? 'old' : 'new'}`;
      }
      return n === 1 ? 'https://example.test/' : 'https://example.test/claude/c/second-session';
    });
    env.newSession = vi.fn(async (provider: AIProvider) => ({
      url: provider === 'claude'
        ? 'https://example.test/claude/c/second-session'
        : `https://example.test/${provider}/c/new`,
    }));
    const controller = await create(env);
    await controller.start();
    expect(env.newSession).toHaveBeenCalledTimes(2); // chatgpt once, claude once after address capture moved before send
    const claudeUrls = controller.getRun().conversations.filter((c) => c.provider === 'claude').map((c) => c.url);
    expect(claudeUrls).toContain('https://example.test/claude/c/second-session');
  });

  it('bounds a permanently unreadable post-creation URL and records the attempt manually', async () => {
    const { env, calls } = makeEnv({ chatgpt: [] });
    let reads = 0;
    env.readConversationUrl = vi.fn(async () => {
      reads += 1;
      if (reads === 1) return 'https://example.test/chatgpt/c/old';
      return new Promise<string | undefined>(() => undefined);
    });
    const controller = await create(env);
    const started = controller.start();
    await vi.waitFor(() => expect(env.newSession).toHaveBeenCalled());
    const stopping = controller.stop();
    expect(controller.getRun().phase).toBe('stopped');
    await stopping;
    await started;
    expect(env.stop).toHaveBeenCalledWith('chatgpt');
    expect(controller.hasPendingSessions()).toBe(false);
    expect(controller.getRun().sessionInitializations[0]).toMatchObject({ status: 'manual' });
    expect(controller.getRun().conversations).toContainEqual(expect.objectContaining({
      provider: 'chatgpt',
      url: '',
      registrationStatus: 'manual',
    }));
    expect(calls).toHaveLength(0);
  });
});

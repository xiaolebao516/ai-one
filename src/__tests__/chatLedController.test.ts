import { describe, expect, it, vi } from 'vitest';
import type { ProviderInstance } from '../../shared/types';
import type { ChatLedRun } from '../workflow/chatLed/types';
import { loadRuns, saveRunChecked, type ChatLedStorage } from '../workflow/chatLed/store';
import {
  CHAT_LED_INIT_SETTLE_TIMEOUT_MS,
  CHAT_LED_FORWARD_TIMEOUT_MS,
  CHAT_LED_KEEP_PAGES_PIN_DELAY_MS,
  ChatLedController,
  type ChatLedEnv,
} from '../workflow/chatLed/controller';

const SEND = (to: string[], message: string) => '```ai-one-send\n' + JSON.stringify({ to, message }) + '\n```';
const DONE = (summary: string) => '```ai-one-done\n' + JSON.stringify({ summary }) + '\n```';

interface Script {
  chatgpt: (string | Error)[];
  claude?: (string | Error)[];
  gemini?: (string | Error)[];
  'chatgpt#2'?: (string | Error)[];
  'chatgpt#3'?: (string | Error)[];
}

function makeEnv(script: Script, sendable: ProviderInstance[] = ['chatgpt', 'claude', 'gemini']) {
  const calls: { provider: ProviderInstance; text: string }[] = [];
  const events: string[] = [];
  const queues: Record<string, (string | Error)[]> = {
    chatgpt: [...script.chatgpt],
    claude: [...(script.claude ?? [])],
    gemini: [...(script.gemini ?? [])],
    'chatgpt#2': [...(script['chatgpt#2'] ?? [])],
    'chatgpt#3': [...(script['chatgpt#3'] ?? [])],
  };
  let clock = 1000;
  let sessionSequence = 0;
  const urls = new Map<ProviderInstance, string>();
  const env: ChatLedEnv = {
    now: () => (clock += 1),
    sendableProviders: async () => sendable,
    prepare: vi.fn(async () => undefined),
    newSession: vi.fn(async (provider: ProviderInstance) => {
      events.push(`new:${provider}`);
      const url = `https://example.test/${provider.replace('#', '-')}/c/new-${++sessionSequence}`;
      urls.set(provider, url);
      return { url };
    }),
    send: vi.fn(async (provider: ProviderInstance, text: string) => {
      events.push(`send:${provider}`);
      calls.push({ provider, text });
      const next = queues[provider]?.shift();
      if (next === undefined) throw new Error(`no scripted reply for ${provider}`);
      if (next instanceof Error) throw next;
      return next;
    }),
    stop: vi.fn(async () => undefined),
    readConversationUrl: vi.fn(async (provider: ProviderInstance) =>
      urls.get(provider) ?? `https://example.test/${provider.replace('#', '-')}/c/existing`,
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
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
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
    const ready = new Set<ProviderInstance>();
    const { env, calls } = makeEnv({ chatgpt: [DONE('ready')] }, []);
    env.initialize = vi.fn(async () => undefined);
    env.sendableProviders = vi.fn(async () => [...ready]);
    const prepare = vi.fn(async (provider: ProviderInstance) => {
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

  it('records candidates that were not ready and tells the coordinator not to substitute them', async () => {
    const { env, calls } = makeEnv({ chatgpt: [DONE('gemini missing')] }, ['chatgpt', 'claude']);
    env.prepare = vi.fn(async (provider: ProviderInstance) => {
      if (provider === 'gemini') throw new Error('gemini page did not become ready in time.');
    });
    const controller = await ChatLedController.create(env, {
      id: 'run-1',
      goal: '派 claude 和 gemini 讨论',
      candidates: ['claude', 'gemini', 'grok', 'chatgpt#2'],
      workers: 1,
    });
    await controller.start();
    const run = controller.getRun();
    expect(run.available).toEqual(['claude']);
    expect(run.unavailable).toEqual([
      { provider: 'gemini', reason: 'gemini page did not become ready in time.' },
      // grok is not ready either, but the task never names it: no notice for it (#194).
      { provider: 'chatgpt#2', reason: 'Not logged in or the page is not ready.' },
    ]);
    expect(calls[0].text).not.toContain('grok（');
    expect(env.prepare).not.toHaveBeenCalledWith('grok'); // not named: not even prepared (#200)
    expect(calls[0].provider).toBe('chatgpt');
    expect(calls[0].text).toContain('gemini（Gemini，原因：gemini page did not become ready in time.）');
    expect(calls[0].text).toContain('不要改派给列表里的其他 AI 顶替');
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
    env.sendableProviders = vi.fn(async (): Promise<ProviderInstance[]> => ['chatgpt']);
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

  it('automatically reminds twice and stops after a third recoverable violation', async () => {
    const { env, calls } = makeEnv({ chatgpt: ['no fence', 'still no fence', 'again no fence'] });
    const controller = await create(env);
    await controller.start();
    const run = controller.getRun();
    expect(run.phase).toBe('awaiting-user');
    expect(run.stop).toMatchObject({ type: 'protocol-violation', violation: { code: 'no-directive' } });
    expect(run.autoReminderStreak).toBe(2);
    expect(run.coordinatorReplies.slice(0, 2).every((r) => r.autoReminder?.includes('顶层指令'))).toBe(true);
    expect(run.forwards).toHaveLength(0);
    expect(calls).toHaveLength(3);
  });

  it('automatically recovers from a format error without requiring a click', async () => {
    const { env, calls } = makeEnv({ chatgpt: ['bad format', DONE('recovered')] });
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().phase).toBe('finished');
    expect(controller.getRun().coordinatorReplies[0].autoReminder).toBeDefined();
    expect(calls).toHaveLength(2);
  });

  it('manual remind() still works for a non-recoverable violation', async () => {
    const { env, calls } = makeEnv({ chatgpt: [SEND(['not-a-provider'], 'bad'), DONE('ok')] });
    const controller = await create(env);
    await controller.start();
    expect(calls).toHaveLength(1);
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
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
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
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
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
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
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
    env.newSession = vi.fn(async (provider: ProviderInstance) => {
      env.readConversationUrl = vi.fn(async (p: ProviderInstance) =>
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
    env.prepare = vi.fn(async (provider: ProviderInstance) => {
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
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => {
      if (provider !== 'chatgpt') return `https://example.test/${provider.replace('#', '-')}/c/existing`;
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
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => {
      if (provider !== 'chatgpt') return `https://example.test/${provider.replace('#', '-')}/c/existing`;
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
    env.sendableProviders = vi.fn(async (): Promise<ProviderInstance[]> => ['chatgpt', 'claude', 'gemini']);
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


  it('keeps a blank first-send intent durable and stops before forwarding if URL ownership cannot be saved', async () => {
    const { env } = makeEnv({ chatgpt: [SEND(['claude'], 'must not forward')] });
    const data = new Map<string, string>();
    const storage: ChatLedStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        const stored = JSON.parse(value) as ChatLedRun[];
        if (stored.some((run) => run.sessionInitializations.some((item) => item.status === 'registered'))) {
          throw new Error('simulated first-send ownership checkpoint failure');
        }
        data.set(key, value);
      },
    };
    let existing: ChatLedRun[] = [];
    let currentUrl = 'https://chatgpt.com/';
    const conversationUrl = 'https://chatgpt.com/c/123e4567-e89b-42d3-a456-426614174123';
    const durableStatusAtCreation: string[] = [];
    const sent: ProviderInstance[] = [];
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) =>
      provider === 'chatgpt' ? currentUrl : ('https://example.test/' + provider + '/c/existing'));
    env.readDocumentId = vi.fn(async () => 'doc-blank-1');
    env.newSession = vi.fn(async (provider: ProviderInstance) => {
      const raw = JSON.parse(Array.from(data.values())[0] || '[]') as ChatLedRun[];
      durableStatusAtCreation.push(raw[0]?.sessionInitializations[0]?.status ?? 'missing');
      if (provider === 'chatgpt') {
        currentUrl = 'https://chatgpt.com/';
        return { url: currentUrl, freshDocument: true, documentId: 'doc-blank-1' };
      }
      return { url: 'https://example.test/' + provider + '/c/unexpected' };
    });
    env.send = vi.fn(async (provider: ProviderInstance) => {
      sent.push(provider);
      if (provider === 'chatgpt') {
        currentUrl = conversationUrl;
        return SEND(['claude'], 'must not forward');
      }
      return DONE('unexpected');
    });
    const controller = await create(env);
    controller.subscribe((run) => {
      const saved = saveRunChecked(storage, run, existing);
      existing = saved.runs;
      return saved.persisted;
    });

    await controller.start();

    expect(durableStatusAtCreation).toEqual(['pending']);
    expect(sent).toEqual(['chatgpt']);
    expect(env.newSession).toHaveBeenCalledTimes(1);
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
    const otherReads = new Map<ProviderInstance, number>();
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => {
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
    env.newSession = vi.fn(async (provider: ProviderInstance) => ({
      url: provider === 'claude'
        ? 'https://example.test/claude/c/123'
        : `https://example.test/${provider}/c/new`,
    }));
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
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
    const currentUrls = new Map<ProviderInstance, string>();
    const targetUrl = 'https://example.test/claude/c/123';
    const userUrl = 'https://example.test/claude/c/users-own-chat';
    let claudeReads = 0;
    let releaseRead!: (url: string | undefined) => void;
    let notifyReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { notifyReadStarted = resolve; });
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => {
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
    env.newSession = vi.fn(async (provider: ProviderInstance) => {
      const url = provider === 'claude'
        ? targetUrl
        : ('https://example.test/' + provider + '/c/' + provider + '-new');
      currentUrls.set(provider, url);
      return { url };
    });
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
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
    const reads = new Map<ProviderInstance, number>();
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => {
      const n = (reads.get(provider) ?? 0) + 1;
      reads.set(provider, n);
      if (provider !== 'claude') {
        return `https://example.test/${provider}/c/${n === 1 ? 'old' : 'new'}`;
      }
      return n === 1 ? 'https://example.test/' : 'https://example.test/claude/c/second-session';
    });
    env.newSession = vi.fn(async (provider: ProviderInstance) => ({
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

describe('chat-led parallel deadlines', () => {
  it('forwards concurrently, settles one timeout, and returns the successful target response', async () => {
    vi.useFakeTimers();
    try {
      const { env, calls } = makeEnv({ chatgpt: [] });
      env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
        calls.push({ provider, text });
        if (provider === 'chatgpt') {
          return calls.filter(c => c.provider === 'chatgpt').length === 1
            ? SEND(['claude', 'gemini'], 'parallel') : DONE('complete');
        }
        if (provider === 'claude') return new Promise<string>(() => undefined);
        return 'Gemini success';
      });
      const controller = await create(env);
      const started = controller.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(calls.some(c => c.provider === 'claude')).toBe(true);
      expect(calls.some(c => c.provider === 'gemini')).toBe(true);
      expect(controller.getRun().forwards.find(f => f.to === 'gemini')?.status).toBe('done');
      await vi.advanceTimersByTimeAsync(CHAT_LED_FORWARD_TIMEOUT_MS);
      await started;
      const run = controller.getRun();
      expect(run.phase).toBe('finished');
      expect(run.forwards.find(f => f.to === 'claude')?.status).toBe('timed-out');
      expect(run.forwards.find(f => f.to === 'gemini')?.reply).toBe('Gemini success');
      const feedback = calls.filter(c => c.provider === 'chatgpt')[1]?.text ?? '';
      expect(feedback).toContain('Gemini success');
      expect(feedback).toContain('来自 Claude 的转发失败');
      expect(feedback).not.toContain('来自 Claude 的完整回复');
      expect(env.stop).toHaveBeenCalledWith('claude');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never starts a session or send for a target whose forward already timed out', async () => {
    vi.useFakeTimers();
    try {
      const { env, calls, events } = makeEnv({ chatgpt: [] });
      let releasePrepare!: () => void;
      let stallClaudePrepare = false; // only after the coordinator has issued the forward
      env.prepare = vi.fn(async (provider: ProviderInstance) => {
        if (provider === 'claude' && stallClaudePrepare) await new Promise<void>((resolve) => { releasePrepare = resolve; });
      });
      env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
        events.push('send:' + provider);
        calls.push({ provider, text });
        if (provider === 'chatgpt') {
          const first = calls.filter((c) => c.provider === 'chatgpt').length === 1;
          if (first) stallClaudePrepare = true;
          return first ? SEND(['claude', 'gemini'], 'parallel') : DONE('complete');
        }
        return 'Gemini success';
      });
      const controller = await create(env);
      const started = controller.start();
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(CHAT_LED_FORWARD_TIMEOUT_MS);
      await started;
      expect(controller.getRun().phase).toBe('finished');
      expect(controller.getRun().forwards.find((f) => f.to === 'claude')?.status).toBe('timed-out');

      // The stalled preparation returns only after the run is already finished.
      releasePrepare();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(events).not.toContain('new:claude');
      expect(events).not.toContain('send:claude');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns all target failures rather than freezing the coordinator', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['claude', 'gemini'], 'parallel'), DONE('handled')],
      claude: [new Error('Claude failed')],
      gemini: [new Error('Gemini failed')],
    });
    const controller = await create(env);
    await controller.start();
    expect(controller.getRun().phase).toBe('finished');
    expect(controller.getRun().forwards.map(f => f.status)).toEqual(['failed', 'failed']);
    expect(calls[3].text).toContain('Claude failed');
    expect(calls[3].text).toContain('Gemini failed');
  });

  it('does not automatically send while paused and cancels the next reminder on stop', async () => {
    const { env, calls } = makeEnv({ chatgpt: [] });
    let release: () => void = () => undefined;
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
      calls.push({ provider, text });
      if (calls.length === 1) return new Promise<string>(resolve => { release = () => resolve('not a directive'); });
      return DONE('never');
    });
    const controller = await create(env);
    const started = controller.start();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.pause();
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    await controller.stop();
    await started;
    expect(calls).toHaveLength(1);
  });
});

describe('parallel forwarding busy gate', () => {
  it('lets the ready target finish while another target is still preparing', async () => {
    const { env } = makeEnv({
      chatgpt: [SEND(['claude', 'gemini'], 'parallel'), DONE('completed')],
      claude: ['Claude answered'],
      gemini: ['Gemini answered'],
    });
    const originalPrepare = env.prepare;
    let geminiPrepares = 0;
    let releaseGemini: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { releaseGemini = resolve; });
    env.prepare = vi.fn(async (provider: ProviderInstance) => {
      if (provider === 'gemini' && ++geminiPrepares === 2) await gate;
      return originalPrepare(provider);
    });
    const controller = await create(env);
    const running = controller.start();
    await vi.waitFor(() => expect(controller.getRun().forwards.find(f => f.to === 'claude')?.status).toBe('done'));
    expect(controller.getRun().forwards.find(f => f.to === 'gemini')?.status).toBe('waiting');
    releaseGemini();
    await running;
    expect(controller.getRun().forwards.map(f => f.status)).toEqual(['done', 'done']);
    expect(controller.getRun().phase).toBe('finished');
  });
});

describe('multi-instance parallel forwarding', () => {
  it('returns two ChatGPT worker responses plus Claude independently', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['chatgpt#2', 'chatgpt#3', 'claude'], 'independent job'), DONE('collated')],
      'chatgpt#2': ['worker two'], 'chatgpt#3': ['worker three'], claude: ['Claude reply'],
    }, ['chatgpt', 'chatgpt#2', 'chatgpt#3', 'claude']);
    const controller = await ChatLedController.create(env, { id: 'workers', goal: 'parallel', candidates: ['chatgpt#2', 'chatgpt#3', 'claude'], workers: 2 });
    await controller.start();
    expect(controller.getRun().workers).toBe(2);
    expect(controller.getRun().forwards.map((item) => [item.to, item.status])).toEqual([
      ['chatgpt#2', 'done'], ['chatgpt#3', 'done'], ['claude', 'done'],
    ]);
    expect(calls.map((item) => item.provider)).toContain('chatgpt#3');
    expect(controller.getRun().phase).toBe('finished');
  });
  it('isolates an unready worker from ready targets', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('finished')] }, ['chatgpt', 'chatgpt#3', 'claude']);
    env.prepare = vi.fn(async (provider: ProviderInstance) => { if (provider === 'chatgpt#2') throw new Error('worker unavailable'); });
    const controller = await ChatLedController.create(env, { id: 'partial', goal: 'g', candidates: ['chatgpt#2', 'chatgpt#3', 'claude'], workers: 2 });
    await controller.start();
    expect(controller.getRun().available).toEqual(['chatgpt#3', 'claude']);
    expect(controller.getRun().phase).toBe('finished');
  });
  it('isolates worker timeout without cancelling a concurrent Claude reply', async () => {
    vi.useFakeTimers();
    try {
      const { env, calls } = makeEnv({ chatgpt: [] }, ['chatgpt', 'chatgpt#2', 'claude']);
      env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
        calls.push({ provider, text });
        if (provider === 'chatgpt') return calls.filter((item) => item.provider === 'chatgpt').length === 1
          ? SEND(['chatgpt#2', 'claude'], 'parallel') : DONE('handled');
        if (provider === 'chatgpt#2') return new Promise<string>(() => undefined);
        return 'Claude is done';
      });
      const controller = await ChatLedController.create(env, { id: 'timeout', goal: 'g', candidates: ['chatgpt#2', 'claude'], workers: 1 });
      const started = controller.start();
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(CHAT_LED_FORWARD_TIMEOUT_MS);
      await started;
      expect(controller.getRun().forwards.find((item) => item.to === 'chatgpt#2')?.status).toBe('timed-out');
      expect(controller.getRun().forwards.find((item) => item.to === 'claude')?.reply).toBe('Claude is done');
      expect(env.stop).toHaveBeenCalledWith('chatgpt#2');
    } finally { vi.useRealTimers(); }
  });
});

describe('process log (#196)', () => {
  it('records preparation, the coordinator messages and pause/resume without storing replies twice', async () => {
    const { env } = makeEnv({
      chatgpt: [SEND(['claude'], 'review this'), DONE('all done')],
      claude: ['claude full reply'],
    });
    env.prepare = vi.fn(async (provider: ProviderInstance) => {
      if (provider === 'gemini') throw new Error('gemini not logged in');
    });
    const controller = await create(env);
    await controller.start();
    const log = controller.getRun().log ?? [];
    const events = log.flatMap((entry) => (entry.kind === 'event' ? [`${entry.event}:${entry.provider ?? entry.detail ?? ''}`] : []));
    expect(events).toEqual([
      'prepare-start:chatgpt',
      'prepare-ok:chatgpt',
      'prepare-start:claude',
      'prepare-ok:claude',
      'prepare-start:gemini',
      'prepare-failed:gemini',
      'targets-ready:claude',
    ]);
    const messages = log.filter((entry) => entry.kind !== 'event');
    expect(messages[0]).toMatchObject({ kind: 'to-coordinator' });
    expect(messages[0].kind === 'to-coordinator' && messages[0].text).toContain('compare two designs');
    expect(messages[1]).toEqual({ kind: 'feedback', round: 1, remaining: 7, at: expect.any(Number) });
    expect(JSON.stringify(log)).not.toContain('claude full reply');
  });

  it('does not log a pause or resume that did not happen', async () => {
    const { env } = makeEnv({ chatgpt: [] });
    const controller = await create(env);
    controller.pause();
    controller.resume();
    expect(controller.getRun().log).toBeUndefined(); // idle: nothing to pause or resume
  });
});

describe('keep the pages the user set up (#198)', () => {
  const SITE: Record<string, string> = {
    chatgpt: 'https://chatgpt.com/c/user-chat',
    gemini: 'https://gemini.google.com/app/task-1',
  };

  async function keepRun(env: ChatLedEnv) {
    return ChatLedController.create(env, { id: 'run-keep', goal: '派 gemini 用任务模式', candidates: ['gemini'], keepPages: true });
  }

  it('sends into the open conversations without opening new ones or registering them', async () => {
    const { env, calls } = makeEnv({ chatgpt: [SEND(['gemini'], 'use the MCP'), DONE('ok')], gemini: ['gemini reply'] });
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => SITE[provider]);
    const controller = await keepRun(env);
    await controller.start();
    expect(env.newSession).not.toHaveBeenCalled();
    expect(calls.map((call) => call.provider)).toEqual(['chatgpt', 'gemini', 'chatgpt']);
    expect(controller.getRun()).toMatchObject({ phase: 'finished', keepPages: true, conversations: [], sessionInitializations: [] });
  });

  it('refuses to send once a page has moved to another conversation since its last reply', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['gemini'], 'first'), SEND(['gemini'], 'second'), DONE('stopped early')],
      gemini: ['reply one', 'reply two'],
    });
    let geminiUrl = 'https://gemini.google.com/app/task-1';
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => (provider === 'gemini' ? geminiUrl : SITE.chatgpt));
    const send = env.send;
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
      const reply = await send(provider, text);
      // While the coordinator reads Gemini's first reply, the user opens another chat in that page.
      if (provider === 'chatgpt' && calls.length === 3) geminiUrl = 'https://gemini.google.com/app/another-chat';
      return reply;
    });
    const controller = await keepRun(env);
    await controller.start();
    expect(calls.filter((call) => call.provider === 'gemini')).toHaveLength(1);
    expect(controller.getRun().forwards[1]).toMatchObject({ status: 'failed', error: expect.stringContaining('switched to another conversation') });
  });

  it('keeps the page pinned after a failed first send, so a later switch is still refused', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['gemini'], 'first'), SEND(['gemini'], 'second'), DONE('done')],
      gemini: [new Error('reply timed out'), 'never sent'],
    });
    let geminiUrl = 'https://gemini.google.com/app/task-1';
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => (provider === 'gemini' ? geminiUrl : SITE.chatgpt));
    const send = env.send;
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
      // The failed Gemini send is reported to the coordinator; meanwhile the user opens another chat.
      if (provider === 'chatgpt' && calls.length === 2) geminiUrl = 'https://gemini.google.com/app/another-chat';
      return send(provider, text);
    });
    const controller = await keepRun(env);
    await controller.start();
    expect(calls.filter((call) => call.provider === 'gemini')).toHaveLength(1);
    expect(controller.getRun().forwards[1]).toMatchObject({ status: 'failed', error: expect.stringContaining('switched to another conversation') });
  });

  it('follows a fresh page to the address its first reply creates, then holds it', async () => {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['gemini'], 'first'), SEND(['gemini'], 'second'), DONE('done')],
      gemini: ['one', 'two'],
    });
    let geminiUrl = 'https://gemini.google.com/tasks/new'; // a mode's own empty page
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) => (provider === 'gemini' ? geminiUrl : SITE.chatgpt));
    const send = env.send;
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
      const reply = await send(provider, text);
      if (provider === 'gemini') geminiUrl = 'https://gemini.google.com/tasks/t-123';
      return reply;
    });
    const controller = await keepRun(env);
    await controller.start();
    expect(calls.filter((call) => call.provider === 'gemini')).toHaveLength(2);
    expect(controller.getRun().phase).toBe('finished');
  });

  it('does not send when the page is not on the AI site', async () => {
    const { env, calls } = makeEnv({ chatgpt: [SEND(['gemini'], 'x'), DONE('done')], gemini: ['never'] });
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) =>
      provider === 'gemini' ? 'https://accounts.google.com/signin' : SITE.chatgpt,
    );
    const controller = await keepRun(env);
    await controller.start();
    expect(calls.some((call) => call.provider === 'gemini')).toBe(false);
    expect(controller.getRun().forwards[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('Cannot confirm the page address') });
  });
});

describe('run-through fixes (#200)', () => {
  it('waits longer than the old three-minute cap for a forward', () => {
    expect(CHAT_LED_FORWARD_TIMEOUT_MS).toBeGreaterThan(60 * 60_000);
  });

  it('prepares and offers only the AIs the task names, plus extra workers', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('ok')] }, ['chatgpt', 'claude', 'gemini', 'chatgpt#2']);
    const controller = await ChatLedController.create(env, {
      id: 'run-named',
      goal: '派gpt和gemini argon分别解决 issue',
      candidates: ['claude', 'gemini', 'grok', 'chatgpt#2'],
      workers: 1,
    });
    await controller.start();
    const prepared = vi.mocked(env.prepare).mock.calls.map(([provider]) => provider);
    expect(prepared.slice(0, 3)).toEqual(['chatgpt', 'gemini', 'chatgpt#2']);
    expect(prepared).not.toContain('claude');
    expect(prepared).not.toContain('grok');
    expect(controller.getRun().available).toEqual(['gemini', 'chatgpt#2']);
  });

  it('keeps every candidate when the task names none', async () => {
    const { env } = makeEnv({ chatgpt: [DONE('ok')] });
    const controller = await create(env); // goal: compare two designs
    await controller.start();
    expect(controller.getRun().available).toEqual(['claude', 'gemini']);
  });

  it('puts the user note before the forwarded message, keeps the record apart, and tells the coordinator', async () => {
    const { env, calls } = makeEnv({ chatgpt: [SEND(['gemini'], 'investigate'), DONE('ok')], gemini: ['done'] });
    const controller = await ChatLedController.create(env, {
      id: 'run-notes',
      goal: 'compare two designs',
      candidates: ['claude', 'gemini'],
      forwardNotes: { gemini: '@Github MCP Server 用我配置的 MCP', claude: '   ' },
    });
    await controller.start();
    const toGemini = calls.find((call) => call.provider === 'gemini');
    expect(toGemini?.text).toBe('@Github MCP Server 用我配置的 MCP\n\ninvestigate');
    expect(controller.getRun().forwards[0]).toMatchObject({ message: 'investigate', note: '@Github MCP Server 用我配置的 MCP' });
    expect(controller.getRun().forwardNotes).toEqual({ gemini: '@Github MCP Server 用我配置的 MCP' });
    expect(calls[0].text).toContain('gemini（Gemini）：「@Github MCP Server 用我配置的 MCP」');
    expect(calls[0].text).toContain('不要写成“你自己的工具”');
  });

  async function keepRunWithSlowFirstSend(afterPin: (setUrl: (url: string) => void) => void) {
    const { env, calls } = makeEnv({
      chatgpt: [SEND(['gemini'], 'first'), SEND(['gemini'], 'second'), DONE('done')],
      gemini: [],
    });
    let geminiUrl = 'https://gemini.google.com/app';
    env.readConversationUrl = vi.fn(async (provider: ProviderInstance) =>
      provider === 'gemini' ? geminiUrl : 'https://chatgpt.com/c/user-chat',
    );
    let failFirst!: (error: Error) => void;
    const send = env.send;
    env.send = vi.fn(async (provider: ProviderInstance, text: string) => {
      if (provider !== 'gemini') return send(provider, text);
      calls.push({ provider, text });
      if (calls.filter((call) => call.provider === 'gemini').length > 1) return 'second reply';
      geminiUrl = 'https://gemini.google.com/app/new-task'; // the empty page gets its address at once
      return new Promise<string>((_, reject) => {
        failFirst = reject;
      });
    });
    const controller = await ChatLedController.create(env, { id: 'run-keep-timeout', goal: 'use gemini', candidates: ['gemini'], keepPages: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const running = controller.start();
      await vi.advanceTimersByTimeAsync(CHAT_LED_KEEP_PAGES_PIN_DELAY_MS + 1_000);
      afterPin((url) => {
        geminiUrl = url;
      });
      failFirst(new Error('response timed out'));
      await vi.advanceTimersByTimeAsync(10_000);
      await running;
    } finally {
      vi.useRealTimers();
    }
    return { controller, calls };
  }

  it('keepPages: pins the address a fresh page got shortly after its first send, even if that send then fails', async () => {
    const { controller, calls } = await keepRunWithSlowFirstSend(() => undefined);
    expect(calls.filter((call) => call.provider === 'gemini')).toHaveLength(2);
    expect(controller.getRun().forwards[1]).toMatchObject({ status: 'done', reply: 'second reply' });
  });

  it('keepPages: a chat the user opened during the failed first wait never receives the next round', async () => {
    const { controller, calls } = await keepRunWithSlowFirstSend((setUrl) => setUrl('https://gemini.google.com/app/users-old-chat'));
    expect(calls.filter((call) => call.provider === 'gemini')).toHaveLength(1);
    expect(controller.getRun().forwards[1]).toMatchObject({ status: 'failed', error: expect.stringContaining('switched to another conversation') });
  });
});

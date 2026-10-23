import { describe, it, expect } from 'vitest';
import type { AIProvider } from '../../shared/types';
import {
  applyCoordinatorReply,
  canExtendRoundLimit,
  canPause,
  canResume,
  canResumeAfterStop,
  closeRun,
  createRun,
  extendRoundLimit,
  failProvider,
  isTerminal,
  pauseRun,
  registerConversation,
  resumeAfterStop,
  resumeRun,
  settledFeedbackItems,
  startRun,
  stopRun,
  updateForward,
} from '../workflow/chatLed/machine';

const fence = String.fromCharCode(96).repeat(3);

function block(name: string, body: string): string {
  return fence + name + '\n' + body + '\n' + fence;
}

function makeRun(roundLimit = 8) {
  return createRun({
    id: 'run-1',
    goal: 'Complete the user task.',
    coordinator: 'chatgpt',
    available: ['chatgpt', 'claude', 'gemini', 'claude'],
    roundLimit,
    now: 10,
  });
}

function start(run = makeRun()) {
  return startRun(run, 11);
}

function sendToClaude(message = 'complete context') {
  return block('ai-one-send', JSON.stringify({ to: ['claude'], message }));
}

function reachRoundLimit() {
  const started = start(makeRun(1));
  const first = applyCoordinatorReply(started, sendToClaude(), 12).run;
  const settled = updateForward(first, 'r1-claude', {
    status: 'done',
    reply: 'complete reply',
    finishedAt: 13,
  }, 13);
  return applyCoordinatorReply(
    settled,
    block('ai-one-done', '{"summary":"would finish, but limit wins"}'),
    14,
  ).run;
}

describe('chat-led state machine', () => {
  it('creates a fresh idle run and removes the coordinator from available providers', () => {
    const run = makeRun();
    expect(run.phase).toBe('idle');
    expect(run.available).toEqual(['claude', 'gemini']);
    expect(run.round).toBe(0);
    expect(run.createdAt).toBe(10);
    expect(run.updatedAt).toBe(10);
  });

  it('starts only from idle', () => {
    const run = makeRun();
    const started = startRun(run, 12);
    expect(started.phase).toBe('coordinator-thinking');
    expect(started.updatedAt).toBe(12);
    expect(startRun(started, 13)).toBe(started);
  });

  it('records a coordinator reply and queues one forward per distinct target', () => {
    const reply = block('ai-one-send', '{"to":["claude","gemini","claude"],"message":"all context"}');
    const result = applyCoordinatorReply(start(), reply, 12);

    expect(result.parsed).toEqual({
      kind: 'send',
      to: ['claude', 'gemini'],
      message: 'all context',
    });
    expect(result.run.phase).toBe('forwarding');
    expect(result.run.round).toBe(1);
    expect(result.run.coordinatorReplies).toEqual([
      { round: 1, text: reply, at: 12 },
    ]);
    expect(result.run.forwards.map((forward) => [forward.id, forward.to, forward.status, forward.messageChars])).toEqual([
      ['r1-claude', 'claude', 'queued', 11],
      ['r1-gemini', 'gemini', 'queued', 11],
    ]);
  });

  it('finishes on a valid done directive and stores the summary', () => {
    const result = applyCoordinatorReply(
      start(),
      block('ai-one-done', '{"summary":"Task complete"}'),
      12,
    );

    expect(result.parsed).toEqual({ kind: 'done', summary: 'Task complete' });
    expect(result.run.phase).toBe('finished');
    expect(result.run.doneSummary).toBe('Task complete');
    expect(isTerminal(result.run)).toBe(true);
  });

  it('stops at the round limit plus one without applying the parsed directive', () => {
    const run = reachRoundLimit();
    expect(run.phase).toBe('awaiting-user');
    expect(run.round).toBe(2);
    expect(run.stop).toEqual({ type: 'round-limit', limit: 1 });
    expect(run.doneSummary).toBeUndefined();
    expect(canExtendRoundLimit(run)).toBe(true);
  });

  it('pauses and resumes only valid active phases', () => {
    const idle = makeRun();
    expect(pauseRun(idle, 12)).toBe(idle);

    const started = startRun(idle, 11);
    expect(canPause(started)).toBe(true);
    const paused = pauseRun(started, 12);
    expect(paused.phase).toBe('paused');
    expect(paused.pausedFrom).toBe('coordinator-thinking');
    expect(canResume(paused)).toBe(true);
    expect(resumeRun(paused, 13).phase).toBe('coordinator-thinking');
    expect(resumeRun(started, 14)).toBe(started);
  });

  it('cancels queued, sending, and waiting forwards when stopped', () => {
    const result = applyCoordinatorReply(start(), sendToClaude(), 12).run;
    const sending = updateForward(result, 'r1-claude', { status: 'sending', startedAt: 13 }, 13);
    const waiting = updateForward(sending, 'r1-claude', { status: 'waiting' }, 14);
    const stopped = stopRun(waiting, 15);

    expect(stopped.phase).toBe('stopped');
    expect(stopped.stop).toEqual({ type: 'user' });
    expect(stopped.forwards[0]).toMatchObject({ status: 'cancelled', finishedAt: 15 });
    expect(isTerminal(stopped)).toBe(true);
    expect(stopRun(stopped, 16)).toBe(stopped);
  });

  it('extends the round limit only after a round-limit stop', () => {
    const limited = reachRoundLimit();
    const extended = extendRoundLimit(limited, 2, 20);
    expect(extended.roundLimit).toBe(3);
    expect(extended.phase).toBe('coordinator-thinking');
    expect(extended.stop).toBeUndefined();
    expect(extendRoundLimit(limited, 0, 21)).toBe(limited);

    const active = start();
    expect(extendRoundLimit(active, 2, 22)).toBe(active);
  });

  it('allows resuming after a protocol violation but not after a round-limit stop', () => {
    const violation = applyCoordinatorReply(start(), 'No protocol block here.', 12).run;
    expect(violation.phase).toBe('awaiting-user');
    expect(canResumeAfterStop(violation)).toBe(true);
    const resumed = resumeAfterStop(violation, 13);
    expect(resumed.phase).toBe('coordinator-thinking');
    expect(resumed.stop).toBeUndefined();
    expect(resumeAfterStop(reachRoundLimit(), 14).phase).toBe('awaiting-user');
  });

  it('marks a provider failure and fails its active forwards', () => {
    const forwarding = applyCoordinatorReply(start(), sendToClaude(), 12).run;
    const failed = failProvider(forwarding, 'claude', 'send failed', 13);

    expect(failed.phase).toBe('awaiting-user');
    expect(failed.stop).toEqual({ type: 'provider-failure', provider: 'claude', error: 'send failed' });
    expect(failed.forwards[0]).toMatchObject({
      status: 'failed',
      error: 'send failed',
      finishedAt: 13,
    });
    expect(failProvider(failed, 'claude', 'again', 14)).toBe(failed);
  });

  it('registers conversations once per provider and URL', () => {
    const run = makeRun();
    const conversation = {
      provider: 'claude' as AIProvider,
      url: 'https://claude.ai/chat/one',
      title: 'New session',
      createdByAiOne: true as const,
    };
    const registered = registerConversation(run, conversation, 12);
    expect(registered.conversations).toEqual([{ ...conversation, registeredAt: 12 }]);
    expect(registerConversation(registered, conversation, 13)).toBe(registered);
    expect(registerConversation(registered, { ...conversation, url: 'https://claude.ai/chat/two' }, 14).conversations).toHaveLength(2);
  });

  it('returns feedback items only when every forward in the round has settled', () => {
    const forwarding = applyCoordinatorReply(
      start(),
      block('ai-one-send', '{"to":["claude","gemini"],"message":"full context"}'),
      12,
    ).run;
    expect(settledFeedbackItems(forwarding, 1)).toBeUndefined();

    const oneDone = updateForward(forwarding, 'r1-claude', {
      status: 'done',
      reply: 'complete Claude reply',
      finishedAt: 13,
    }, 13);
    const bothSettled = updateForward(oneDone, 'r1-gemini', {
      status: 'failed',
      error: 'Gemini failed',
      finishedAt: 14,
    }, 14);
    expect(settledFeedbackItems(bothSettled, 1)).toEqual([
      { from: 'claude', label: 'Claude', reply: 'complete Claude reply' },
      { from: 'gemini', label: 'Gemini', error: 'Gemini failed' },
    ]);
  });

  it('ignores invalid forward updates and preserves immutable forward identity', () => {
    const forwarding = applyCoordinatorReply(start(), sendToClaude(), 12).run;
    expect(updateForward(forwarding, 'missing', { status: 'done' }, 13)).toBe(forwarding);

    const updated = updateForward(forwarding, 'r1-claude', {
      id: 'changed',
      to: 'gemini',
      status: 'sending',
    }, 13);
    expect(updated.forwards[0]).toMatchObject({
      id: 'r1-claude',
      to: 'claude',
      status: 'sending',
    });
  });

  it('closes only a finished or stopped run', () => {
    const active = start();
    expect(closeRun(active, true, 12)).toBe(active);

    const finished = applyCoordinatorReply(active, block('ai-one-done', '{"summary":"done"}'), 12).run;
    const closed = closeRun(finished, true, 13);
    expect(closed.closed).toEqual({ at: 13, exportedMarkdown: true });
    expect(isTerminal(closed)).toBe(true);
    expect(closeRun(closed, false, 14)).toBe(closed);
  });
});

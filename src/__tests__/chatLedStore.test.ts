import { describe, expect, it } from 'vitest';
import {
  appendCleanupResult,
  beginCleanup,
  createRun,
  finishCleanup,
  isRunActive,
  registerConversation,
  startRun,
  stopRun,
} from '../workflow/chatLed/machine';
import { CHAT_LED_STORAGE_KEY, loadRuns, saveRun, type ChatLedStorage } from '../workflow/chatLed/store';
import type { ChatLedRun } from '../workflow/chatLed/types';

function memoryStorage(): ChatLedStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function stoppedRunWithTwoConversations(): ChatLedRun {
  let run = createRun({ id: 'r1', goal: 'g', available: ['claude'], now: 1 });
  run = startRun(run, 2);
  run = registerConversation(run, { provider: 'chatgpt', url: 'https://chatgpt.com/c/aaa', createdByAiOne: true }, 3);
  run = registerConversation(run, { provider: 'claude', url: 'https://claude.ai/chat/bbb', createdByAiOne: true }, 4);
  return stopRun(run, 5);
}

describe('only one run may be active', () => {
  it('treats a run waiting for a reply as active and finished or stopped runs as not', () => {
    const base = createRun({ id: 'r', goal: 'g', available: ['claude'], now: 1 });
    expect(isRunActive(base)).toBe(true);
    expect(isRunActive(startRun(base, 2))).toBe(true);
    expect(isRunActive({ ...startRun(base, 2), phase: 'awaiting-user', stop: { type: 'round-limit', limit: 8 } })).toBe(true);
    expect(isRunActive(stopRun(startRun(base, 2), 3))).toBe(false);
  });
});

describe('cleanup progress is stored item by item', () => {
  it('begins once and appends confirmed results', () => {
    const run = beginCleanup(stoppedRunWithTwoConversations(), 6);
    expect(run.cleanupRunning).toBe(true);
    expect(beginCleanup(run, 7)).toBe(run);
    const one = appendCleanupResult(run, { provider: 'chatgpt', url: 'https://chatgpt.com/c/aaa', outcome: 'deleted', note: 'ok' }, 8);
    expect(one.cleanupResults).toHaveLength(1);
    const done = finishCleanup(one, 9);
    expect(done.cleanupRunning).toBe(false);
    expect(beginCleanup(done, 10)).toBe(done);
  });

  it('a reload in the middle marks the unconfirmed conversations manual and never replays them', () => {
    const storage = memoryStorage();
    let run = beginCleanup(stoppedRunWithTwoConversations(), 6);
    run = appendCleanupResult(run, { provider: 'chatgpt', url: 'https://chatgpt.com/c/aaa', outcome: 'deleted', note: 'ok' }, 7);
    saveRun(storage, run, []);

    const [loaded] = loadRuns(storage);
    expect(loaded.cleanupRunning).toBe(false);
    expect(loaded.cleanupResults?.map((r) => [r.provider, r.outcome])).toEqual([
      ['chatgpt', 'deleted'],
      ['claude', 'manual'],
    ]);
    // the run now counts as done: beginCleanup refuses a second pass
    expect(beginCleanup(loaded, 99)).toBe(loaded);
  });

  it('runs that were waiting for the user cannot continue after a reload and load as stopped', () => {
    const storage = memoryStorage();
    storage.setItem(
      CHAT_LED_STORAGE_KEY,
      JSON.stringify([{ ...stoppedRunWithTwoConversations(), phase: 'awaiting-user', stop: { type: 'round-limit', limit: 8 } }]),
    );
    expect(loadRuns(storage)[0].phase).toBe('stopped');
  });
});

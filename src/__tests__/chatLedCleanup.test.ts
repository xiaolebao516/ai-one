import { describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../../shared/types';
import type { ChatLedRun, RegisteredConversation } from '../workflow/chatLed/types';
import {
  executeCleanup,
  planCleanup,
  summarizeCleanup,
  type CleanupPlanItem,
  type ConversationCleaner,
} from '../workflow/chatLed/cleanup';

const FIRST_URL = 'https://chatgpt.com/c/123e4567-e89b-42d3-a456-426614174000';
const SECOND_URL = 'https://chatgpt.com/c/123e4567-e89b-42d3-a456-426614174001';
const ORIGINAL_URL = 'https://chatgpt.com/c/123e4567-e89b-42d3-a456-426614174002';

function conversation(url: string, title = 'Created conversation'): RegisteredConversation {
  return {
    provider: 'chatgpt',
    url,
    title,
    createdByAiOne: true,
    registeredAt: 100,
  };
}

function makeRun(conversations: RegisteredConversation[]): ChatLedRun {
  return {
    id: 'run-1',
    goal: 'Test cleanup',
    coordinator: 'chatgpt',
    available: ['claude'],
    roundLimit: 8,
    round: 1,
    phase: 'finished',
    forwards: [],
    conversations,
    sessionInitializations: [],

    coordinatorReplies: [],
    createdAt: 100,
    updatedAt: 200,
  };
}

function makeCleaner(overrides: Partial<ConversationCleaner> = {}): ConversationCleaner {
  const base: ConversationCleaner = {
    provider: 'chatgpt',
    supports: { delete: true, archive: true },
    matchesConversationUrl: vi.fn((url: string) => url.startsWith('https://chatgpt.com/c/')),
    deleteConversation: vi.fn(async () => ({ ok: true })),
    archiveConversation: vi.fn(async () => ({ ok: true })),
    confirmGone: vi.fn(async () => true),
    confirmArchived: vi.fn(async () => true),
  };
  return {
    ...base,
    ...overrides,
    supports: overrides.supports ?? base.supports,
  };
}

describe('chat-led cleanup planning', () => {
  it('plans only registered conversations created by ai-one and deduplicates provider plus URL', () => {
    const registered = conversation(FIRST_URL);
    const duplicate = conversation(FIRST_URL, 'Duplicate title');
    const original = {
      ...conversation(ORIGINAL_URL, 'User original conversation'),
      createdByAiOne: false,
    } as unknown as RegisteredConversation;
    const cleaner = makeCleaner();

    const plan = planCleanup(makeRun([registered, duplicate, original]), [cleaner]);

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      provider: 'chatgpt',
      url: FIRST_URL,
      title: 'Created conversation',
      action: 'delete',
      irreversible: true,
    });
    expect(cleaner.matchesConversationUrl).toHaveBeenCalledTimes(1);
    expect(cleaner.matchesConversationUrl).toHaveBeenCalledWith(FIRST_URL);
  });

  it('marks a URL that does not match the provider cleaner as manual', () => {
    const cleaner = makeCleaner();
    const plan = planCleanup(makeRun([conversation('https://example.test/c/not-a-chatgpt-id')]), [cleaner]);

    expect(plan[0]).toMatchObject({ action: 'manual', irreversible: false });
    expect(plan[0].reason).toContain('does not match');
  });

  it('marks a registered conversation manual when no cleaner exists for its provider', () => {
    const plan = planCleanup(makeRun([conversation(FIRST_URL)]), []);

    expect(plan[0].action).toBe('manual');
    expect(plan[0].reason).toContain('No cleaner');
  });

  it('prefers deletion and marks it irreversible when deletion is supported', () => {
    const cleaner = makeCleaner({ supports: { delete: true, archive: true } });
    const plan = planCleanup(makeRun([conversation(FIRST_URL)]), [cleaner]);

    expect(plan[0].action).toBe('delete');
    expect(plan[0].irreversible).toBe(true);
  });

  it('chooses archive when deletion is unsupported', () => {
    const cleaner = makeCleaner({ supports: { delete: false, archive: true } });
    const plan = planCleanup(makeRun([conversation(FIRST_URL)]), [cleaner]);

    expect(plan[0].action).toBe('archive');
    expect(plan[0].irreversible).toBe(false);
  });

  it('creates no action for a user-owned conversation', () => {
    const original = {
      ...conversation(ORIGINAL_URL, 'User original conversation'),
      createdByAiOne: false,
    } as unknown as RegisteredConversation;
    const cleaner = makeCleaner();

    expect(planCleanup(makeRun([original]), [cleaner])).toEqual([]);
    expect(cleaner.matchesConversationUrl).not.toHaveBeenCalled();
  });
});

describe('chat-led cleanup execution', () => {
  it('falls back to archive after a failed deletion and confirms the archived result', async () => {
    const cleaner = makeCleaner({
      deleteConversation: vi.fn(async () => ({ ok: false, note: 'Delete unavailable' })),
      archiveConversation: vi.fn(async () => ({ ok: true })),
      confirmArchived: vi.fn(async () => true),
    });
    const plan = planCleanup(makeRun([conversation(FIRST_URL)]), [cleaner]);

    const results = await executeCleanup(plan, [cleaner]);

    expect(results[0].outcome).toBe('archived');
    expect(results[0].note).toContain('删除失败/未确认，已改为归档');
    expect(cleaner.archiveConversation).toHaveBeenCalledWith(FIRST_URL);
    expect(cleaner.confirmArchived).toHaveBeenCalledWith(FIRST_URL);
  });

  it('falls back to confirmed archive when deletion succeeds but readback says the conversation remains', async () => {
    const cleaner = makeCleaner({
      deleteConversation: vi.fn(async () => ({ ok: true })),
      confirmGone: vi.fn(async () => false),
      archiveConversation: vi.fn(async () => ({ ok: true })),
      confirmArchived: vi.fn(async () => true),
    });
    const plan = planCleanup(makeRun([conversation(FIRST_URL)]), [cleaner]);

    const results = await executeCleanup(plan, [cleaner]);

    expect(results[0].outcome).toBe('archived');
    expect(results[0].note).toContain('删除失败/未确认，已改为归档');
    expect(cleaner.confirmGone).toHaveBeenCalledWith(FIRST_URL);
    expect(cleaner.archiveConversation).toHaveBeenCalledWith(FIRST_URL);
  });

  it('returns manual when archive fallback fails or cannot be confirmed', async () => {
    const cleaner = makeCleaner({
      deleteConversation: vi.fn(async () => ({ ok: false })),
      archiveConversation: vi.fn(async () => ({ ok: true })),
      confirmArchived: vi.fn(async () => false),
    });
    const plan = planCleanup(makeRun([conversation(FIRST_URL)]), [cleaner]);

    const results = await executeCleanup(plan, [cleaner]);

    expect(results[0].outcome).toBe('manual');
    expect(results[0].note).toContain('归档后回读未确认');
    expect(results[0].outcome).not.toBe('deleted');
    expect(results[0].outcome).not.toBe('archived');
  });

  it('converts a rejected cleaner operation to manual and continues with later items', async () => {
    const cleaner = makeCleaner({
      deleteConversation: vi.fn(async (url: string) => {
        if (url === FIRST_URL) throw new Error('temporary delete failure');
        return { ok: true };
      }),
      confirmGone: vi.fn(async () => true),
    });
    const plan = planCleanup(makeRun([conversation(FIRST_URL), conversation(SECOND_URL)]), [cleaner]);

    const results = await executeCleanup(plan, [cleaner]);

    expect(results.map((result) => result.outcome)).toEqual(['manual', 'deleted']);
    expect(results[0].note).toContain('temporary delete failure');
    expect(cleaner.archiveConversation).not.toHaveBeenCalled();
    expect(cleaner.deleteConversation).toHaveBeenCalledTimes(2);
  });

  it('never reports deletion or archiving without readback confirmation', async () => {
    const cleaner = makeCleaner({
      confirmGone: vi.fn(async () => false),
      archiveConversation: vi.fn(async () => ({ ok: true })),
      confirmArchived: vi.fn(async () => false),
    });
    const plan = planCleanup(makeRun([conversation(FIRST_URL)]), [cleaner]);

    const results = await executeCleanup(plan, [cleaner]);

    expect(results[0].outcome).toBe('manual');
    expect(['deleted', 'archived']).not.toContain(results[0].outcome);
    expect(cleaner.confirmGone).toHaveBeenCalledWith(FIRST_URL);
    expect(cleaner.confirmArchived).toHaveBeenCalledWith(FIRST_URL);
  });

  it('does not call any cleaner method for a manual plan item', async () => {
    const cleaner = makeCleaner({
      matchesConversationUrl: vi.fn(() => true),
      deleteConversation: vi.fn(async () => ({ ok: true })),
      archiveConversation: vi.fn(async () => ({ ok: true })),
      confirmGone: vi.fn(async () => true),
      confirmArchived: vi.fn(async () => true),
    });
    const manualItem: CleanupPlanItem = {
      provider: 'chatgpt',
      url: FIRST_URL,
      action: 'manual',
      irreversible: false,
      reason: 'Unsupported provider URL',
    };

    const results = await executeCleanup([manualItem], [cleaner]);

    expect(results[0].outcome).toBe('manual');
    expect(cleaner.matchesConversationUrl).not.toHaveBeenCalled();
    expect(cleaner.deleteConversation).not.toHaveBeenCalled();
    expect(cleaner.archiveConversation).not.toHaveBeenCalled();
    expect(cleaner.confirmGone).not.toHaveBeenCalled();
    expect(cleaner.confirmArchived).not.toHaveBeenCalled();
  });

  it('never invokes a cleaner with an unplanned user-owned URL', async () => {
    const registered = conversation(FIRST_URL);
    const original = {
      ...conversation(ORIGINAL_URL, 'User original conversation'),
      createdByAiOne: false,
    } as unknown as RegisteredConversation;
    const deleteConversation = vi.fn(async (_url: string) => ({ ok: true }));
    const archiveConversation = vi.fn(async (_url: string) => ({ ok: true }));
    const confirmGone = vi.fn(async (_url: string) => true);
    const confirmArchived = vi.fn(async (_url: string) => true);
    const cleaner = makeCleaner({
      deleteConversation,
      archiveConversation,
      confirmGone,
      confirmArchived,
    });
    const plan = planCleanup(makeRun([registered, original]), [cleaner]);

    await executeCleanup(plan, [cleaner]);

    const calledUrls = [
      ...deleteConversation.mock.calls.map(([url]) => url),
      ...archiveConversation.mock.calls.map(([url]) => url),
      ...confirmGone.mock.calls.map(([url]) => url),
      ...confirmArchived.mock.calls.map(([url]) => url),
    ];
    expect(calledUrls.length).toBeGreaterThan(0);
    expect(calledUrls.every((url) => url === FIRST_URL)).toBe(true);
    expect(calledUrls).not.toContain(ORIGINAL_URL);
    expect(cleaner.matchesConversationUrl).not.toHaveBeenCalledWith(ORIGINAL_URL);
    expect(cleaner.matchesConversationUrl).toHaveBeenCalledWith(FIRST_URL);
  });

  it('summarizes outcomes and is complete only when no item needs manual cleanup', () => {
    const results = [
      { provider: 'chatgpt' as AIProvider, url: FIRST_URL, outcome: 'deleted' as const, note: 'confirmed' },
      { provider: 'chatgpt' as AIProvider, url: SECOND_URL, outcome: 'archived' as const, note: 'confirmed' },
      { provider: 'chatgpt' as AIProvider, url: ORIGINAL_URL, outcome: 'manual' as const, note: 'manual' },
      { provider: 'claude' as AIProvider, outcome: 'skipped' as const, note: 'skipped' },
    ];

    expect(summarizeCleanup(results)).toEqual({
      total: 4,
      deleted: 1,
      archived: 1,
      manual: 1,
      skipped: 1,
      completed: false,
    });
    expect(summarizeCleanup(results.filter((result) => result.outcome !== 'manual')).completed).toBe(true);
  });
});

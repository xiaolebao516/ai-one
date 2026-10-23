import type { AIProvider } from '../../../shared/types';
import type { ChatLedRun, CleanupItemResult, CleanupOutcome } from './types';

export interface CleanerStep {
  ok: boolean;
  note?: string;
}

export interface ConversationCleaner {
  provider: AIProvider;
  supports: {
    delete: boolean;
    archive: boolean;
  };
  matchesConversationUrl(url: string): boolean;
  deleteConversation(url: string): Promise<CleanerStep>;
  archiveConversation(url: string): Promise<CleanerStep>;
  confirmGone(url: string): Promise<boolean>;
  confirmArchived(url: string): Promise<boolean>;
}

export interface CleanupPlanItem {
  provider: AIProvider;
  url: string;
  title?: string;
  action: 'delete' | 'archive' | 'manual';
  irreversible: boolean;
  reason: string;
}

export interface CleanupSummary {
  total: number;
  deleted: number;
  archived: number;
  manual: number;
  skipped: number;
  completed: boolean;
}

interface CleanerMatch {
  cleaner?: ConversationCleaner;
  reason?: string;
}

function matchCleaner(
  provider: AIProvider,
  url: string,
  cleaners: readonly ConversationCleaner[],
): CleanerMatch {
  const candidates = cleaners.filter((cleaner) => cleaner.provider === provider);
  if (candidates.length === 0) {
    return { reason: 'No cleaner is registered for this provider.' };
  }

  for (const cleaner of candidates) {
    try {
      if (cleaner.matchesConversationUrl(url)) {
        return { cleaner };
      }
    } catch {
      // A broken URL matcher must not make an unverified URL actionable.
    }
  }

  return { reason: 'The conversation URL does not match a supported cleaner.' };
}

export function planCleanup(
  run: ChatLedRun,
  cleaners: readonly ConversationCleaner[],
): CleanupPlanItem[] {
  const plan: CleanupPlanItem[] = [];
  const seen = new Set<string>();

  for (const conversation of run.conversations) {
    if (conversation.createdByAiOne !== true) continue;

    const key = JSON.stringify([conversation.provider, conversation.url]);
    if (seen.has(key)) continue;
    seen.add(key);

    const base = {
      provider: conversation.provider,
      url: conversation.url,
      ...(conversation.title === undefined ? {} : { title: conversation.title }),
    };

    // Records saved before ownership checkpoints existed (or left uncertain) may point at a page the
    // user switched to; only a confirmed registration may ever reach a destructive cleaner.
    if (conversation.registrationStatus !== 'confirmed') {
      plan.push({
        ...base,
        action: 'manual',
        irreversible: false,
        reason: 'Ownership of this conversation was not confirmed; clean it up manually.',
      });
      continue;
    }

    const match = matchCleaner(conversation.provider, conversation.url, cleaners);

    if (!match.cleaner) {
      plan.push({
        ...base,
        action: 'manual',
        irreversible: false,
        reason: match.reason ?? 'No matching cleaner is available.',
      });
      continue;
    }

    if (match.cleaner.supports.delete) {
      plan.push({
        ...base,
        action: 'delete',
        irreversible: true,
        reason: 'Deletion is supported and takes priority over archiving.',
      });
    } else if (match.cleaner.supports.archive) {
      plan.push({
        ...base,
        action: 'archive',
        irreversible: false,
        reason: 'Deletion is unavailable; archiving is supported.',
      });
    } else {
      plan.push({
        ...base,
        action: 'manual',
        irreversible: false,
        reason: 'This provider supports neither deletion nor archiving.',
      });
    }
  }

  return plan;
}

function shortText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Unknown error';
}

function errorMessage(error: unknown): string {
  return shortText(error instanceof Error ? error.message : String(error));
}

function stepNote(step: CleanerStep): string {
  return step.note ? shortText(step.note) : '';
}

function resultFor(
  item: CleanupPlanItem,
  outcome: CleanupOutcome,
  note: string,
): CleanupItemResult {
  return {
    provider: item.provider,
    url: item.url,
    ...(item.title === undefined ? {} : { title: item.title }),
    outcome,
    note,
  };
}

function findCleanerForItem(
  item: CleanupPlanItem,
  cleaners: readonly ConversationCleaner[],
): ConversationCleaner | undefined {
  const match = matchCleaner(item.provider, item.url, cleaners);
  return match.cleaner;
}

async function executeArchive(
  item: CleanupPlanItem,
  cleaner: ConversationCleaner,
  prefix = '',
): Promise<CleanupItemResult> {
  if (!cleaner.supports.archive) {
    return resultFor(item, 'manual', prefix + '不支持归档，需手动清理');
  }

  try {
    const step = await cleaner.archiveConversation(item.url);
    if (!step.ok) {
      const detail = stepNote(step);
      return resultFor(
        item,
        'manual',
        prefix + '归档失败，需手动清理' + (detail ? '：' + detail : ''),
      );
    }

    const confirmed = await cleaner.confirmArchived(item.url);
    if (!confirmed) {
      return resultFor(item, 'manual', prefix + '归档后回读未确认，需手动清理');
    }

    const detail = stepNote(step);
    return resultFor(
      item,
      'archived',
      (prefix ? prefix + '已改为归档' : '归档已完成并经回读确认') + (detail ? '：' + detail : ''),
    );
  } catch (error) {
    return resultFor(
      item,
      'manual',
      prefix + '归档异常，需手动清理：' + errorMessage(error),
    );
  }
}

async function executeDelete(
  item: CleanupPlanItem,
  cleaner: ConversationCleaner,
): Promise<CleanupItemResult> {
  if (!cleaner.supports.delete) {
    return resultFor(item, 'manual', '计划要求删除，但当前 cleaner 不支持删除；需手动清理');
  }

  let deletion: CleanerStep;
  try {
    deletion = await cleaner.deleteConversation(item.url);
  } catch (error) {
    return resultFor(item, 'manual', '删除异常，需手动清理：' + errorMessage(error));
  }

  if (deletion.ok) {
    let gone: boolean;
    try {
      gone = await cleaner.confirmGone(item.url);
    } catch (error) {
      return resultFor(item, 'manual', '删除后回读异常，需手动清理：' + errorMessage(error));
    }

    if (gone) {
      const detail = stepNote(deletion);
      return resultFor(
        item,
        'deleted',
        '删除已完成并经回读确认' + (detail ? '：' + detail : ''),
      );
    }
  }

  return executeArchive(item, cleaner, '删除失败/未确认，');
}

export class CleanupCheckpointError extends Error {
  constructor() {
    super('Cleanup progress checkpoint failed; the batch stopped to avoid repeating an irreversible action.');
    this.name = 'CleanupCheckpointError';
  }
}

export async function executeCleanup(
  plan: CleanupPlanItem[],
  cleaners: readonly ConversationCleaner[],
  hooks?: {
    /** Persist the item result. Throwing means "could not save": the batch stops (fail closed). */
    onProgress?(i: number, r: CleanupItemResult): void;
  },
): Promise<CleanupItemResult[]> {
  const results: CleanupItemResult[] = [];

  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    let result: CleanupItemResult;

    if (item.action === 'manual') {
      result = resultFor(item, 'manual', item.reason + '；需手动清理');
    } else {
      const cleaner = findCleanerForItem(item, cleaners);
      if (!cleaner) {
        result = resultFor(item, 'manual', '找不到匹配的 cleaner，需手动清理');
      } else if (item.action === 'delete') {
        result = await executeDelete(item, cleaner);
      } else {
        result = await executeArchive(item, cleaner);
      }
    }

    results.push(result);
    try {
      hooks?.onProgress?.(i, result);
    } catch {
      // The caller must persist an interrupted/manual state. Returning normally would let it
      // incorrectly mark this batch complete after a failed per-item checkpoint.
      throw new CleanupCheckpointError();
    }
  }

  return results;
}

export function summarizeCleanup(results: readonly CleanupItemResult[]): CleanupSummary {
  let deleted = 0;
  let archived = 0;
  let manual = 0;
  let skipped = 0;

  for (const result of results) {
    if (result.outcome === 'deleted') deleted += 1;
    else if (result.outcome === 'archived') archived += 1;
    else if (result.outcome === 'manual') manual += 1;
    else if (result.outcome === 'skipped') skipped += 1;
  }

  return {
    total: results.length,
    deleted,
    archived,
    manual,
    skipped,
    completed: manual === 0,
  };
}

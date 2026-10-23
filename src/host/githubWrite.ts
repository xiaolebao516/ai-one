/**
 * GitHub Write Bridge Frontend Host (Spec #110, Spec #106 / Design §6.3, §6.5)
 *
 * Implements the five fixed actions:
 * 1. create_issue
 * 2. comment
 * 3. set_pause
 * 4. accept
 * 5. request_changes
 *
 * Plus pause-state derivation and formatting helpers.
 */

import { invoke } from '@tauri-apps/api/core';

export type WriteOutcome = 'confirmed' | 'partial' | 'unconfirmed' | 'failed';

export interface GithubWriteResult {
  outcome: WriteOutcome;
  message: string;
  stepResults?: Record<string, WriteOutcome>;
}

export type PauseState = 'paused' | 'running' | 'none';

export const AI_ONE_COMMENT_PREFIX = '【ai-one 代用户发出】';
export const PAUSE_MARKER = '<!-- ai-one:set_pause:v1 -->';
export const COMMENT_MARKER = '<!-- ai-one:comment:v1 -->';
export const ACCEPT_MARKER = '<!-- ai-one:accept:v1 -->';
export const REQUEST_CHANGES_MARKER = '<!-- ai-one:request_changes:v1 -->';

export function formatCommentBody(text: string): string {
  const clean = text.trim();
  return `${AI_ONE_COMMENT_PREFIX}\n${clean}\n${COMMENT_MARKER}`;
}

export function formatPauseBody(state: 'paused' | 'running'): string {
  const line =
    state === 'paused'
      ? '用户已暂停：请停止派发新工作，正在进行的一步可完成。'
      : '用户已恢复：可继续派发。';
  return `${AI_ONE_COMMENT_PREFIX}\n${line}\n${PAUSE_MARKER}`;
}

export function formatAcceptBody(expectedHead: string): string {
  return `${AI_ONE_COMMENT_PREFIX}\n用户验收通过（针对 HEAD ${expectedHead}）。\n${ACCEPT_MARKER}`;
}

export function formatRequestChangesBody(expectedHead: string, text: string): string {
  const clean = text.trim();
  return `${AI_ONE_COMMENT_PREFIX}\n用户要求修改（针对 HEAD ${expectedHead}）：\n${clean}\n${REQUEST_CHANGES_MARKER}`;
}

/**
 * Derives pause state from an array of comments.
 * Strictly checks:
 * 1. First line begins with AI_ONE_COMMENT_PREFIX
 * 2. Last line is PAUSE_MARKER
 * 3. Content indicates "用户已暂停" -> paused, "用户已恢复" -> running.
 * Takes the latest matching comment.
 */
export function derivePauseState(comments: Array<{ body: string; createdAt?: string }>): PauseState {
  if (!comments || comments.length === 0) return 'none';

  // Sort by createdAt if provided, or preserve order (assuming chronological)
  const sorted = [...comments].sort((a, b) => {
    if (!a.createdAt || !b.createdAt) return 0;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (let i = sorted.length - 1; i >= 0; i--) {
    const raw = sorted[i].body;
    if (!raw) continue;
    const lines = raw.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;
    if (lines[0] !== AI_ONE_COMMENT_PREFIX) continue;
    if (lines[lines.length - 1] !== PAUSE_MARKER) continue;

    const middle = lines.slice(1, -1).join('\n');
    if (middle.includes('用户已暂停')) return 'paused';
    if (middle.includes('用户已恢复')) return 'running';
  }

  return 'none';
}

export interface GithubWriteHost {
  createIssue(params: { repo: string; title: string; body: string; parentSpec?: number }): Promise<GithubWriteResult>;
  comment(params: { repo: string; issue: number; text: string }): Promise<GithubWriteResult>;
  setPause(params: { repo: string; issue: number; state: 'paused' | 'running' }): Promise<GithubWriteResult>;
  accept(params: { repo: string; issue: number; pr: number; expectedHead: string }): Promise<GithubWriteResult>;
  requestChanges(params: { repo: string; issue: number; pr: number; expectedHead: string; text: string }): Promise<GithubWriteResult>;
}

export const githubWrite: GithubWriteHost = {
  async createIssue({ repo, title, body, parentSpec }): Promise<GithubWriteResult> {
    try {
      return await invoke<GithubWriteResult>('github_write_create_issue', { repo, title, body, parentSpec });
    } catch (err: unknown) {
      return {
        outcome: 'failed',
        message: typeof err === 'string' ? err : 'Issue 创建失败',
      };
    }
  },

  async comment({ repo, issue, text }): Promise<GithubWriteResult> {
    if (!text || !text.trim()) {
      return { outcome: 'failed', message: '留言内容不能为空' };
    }
    if (text.includes('<!-- ai-one:')) {
      return { outcome: 'failed', message: '内容包含受限的内部标记' };
    }
    try {
      return await invoke<GithubWriteResult>('github_write_comment', { repo, issue, text: text.trim() });
    } catch (err: unknown) {
      return {
        outcome: 'unconfirmed',
        message: typeof err === 'string' ? err : '留言结果未知',
      };
    }
  },

  async setPause({ repo, issue, state }): Promise<GithubWriteResult> {
    try {
      return await invoke<GithubWriteResult>('github_write_set_pause', { repo, issue, state });
    } catch (err: unknown) {
      return {
        outcome: 'unconfirmed',
        message: typeof err === 'string' ? err : '暂停指令状态未知',
      };
    }
  },

  async accept({ repo, issue, pr, expectedHead }): Promise<GithubWriteResult> {
    if (!expectedHead || expectedHead.length !== 40) {
      return { outcome: 'failed', message: '无效的 expectedHead SHA' };
    }
    try {
      return await invoke<GithubWriteResult>('github_write_accept', { repo, issue, pr, expectedHead });
    } catch (err: unknown) {
      return {
        outcome: 'unconfirmed',
        message: typeof err === 'string' ? err : '验收操作结果未知',
      };
    }
  },

  async requestChanges({ repo, issue, pr, expectedHead, text }): Promise<GithubWriteResult> {
    if (!text || !text.trim()) {
      return { outcome: 'failed', message: '修改意见不能为空' };
    }
    if (!expectedHead || expectedHead.length !== 40) {
      return { outcome: 'failed', message: '无效的 expectedHead SHA' };
    }
    try {
      return await invoke<GithubWriteResult>('github_write_request_changes', { repo, issue, pr, expectedHead, text: text.trim() });
    } catch (err: unknown) {
      return {
        outcome: 'unconfirmed',
        message: typeof err === 'string' ? err : '要求修改操作结果未知',
      };
    }
  },
};

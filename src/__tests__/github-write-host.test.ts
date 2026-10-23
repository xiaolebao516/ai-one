import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: () => true }));

import { host } from '../host';
import { derivePauseState, type GithubWriteResult } from '../host/githubWrite';

const goodResult: GithubWriteResult = {
  status: 'confirmed',
  code: 'ok',
  message: '已确认写入 GitHub',
  steps: [{ step: 'comment', state: 'confirmed' }],
};

const sha = '03a234f4d472137fac40c9d58b5b474f78796f22';

describe('host GitHub write bridge', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(goodResult);
  });

  it('exposes status and exactly five fixed action commands with fixed arguments', async () => {
    invokeMock.mockResolvedValueOnce({ available: true, reason: 'ok' });
    await expect(host.githubWrite.status()).resolves.toEqual({ available: true, reason: 'ok' });
    await host.githubWrite.createIssue({ repo: 'owner/repo', title: 'title', body: '', parentSpec: 7 });
    await host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: 'hello' });
    await host.githubWrite.setPause({ repo: 'owner/repo', issue: 12, state: 'paused' });
    await host.githubWrite.accept({ repo: 'owner/repo', issue: 12, pr: 4, expectedHead: sha });
    await host.githubWrite.requestChanges({
      repo: 'owner/repo', issue: 12, pr: 4, expectedHead: sha, text: 'please fix',
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'github_write_status');
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'github_write_create_issue', {
      repo: 'owner/repo', title: 'title', body: '', parentSpec: 7,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'github_write_comment', {
      repo: 'owner/repo', issue: 12, text: 'hello',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'github_write_set_pause', {
      repo: 'owner/repo', issue: 12, state: 'paused',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, 'github_write_accept', {
      repo: 'owner/repo', issue: 12, pr: 4, expectedHead: sha,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(6, 'github_write_request_changes', {
      repo: 'owner/repo', issue: 12, pr: 4, expectedHead: sha, text: 'please fix',
    });
    expect(invokeMock).toHaveBeenCalledTimes(6);
  });

  it('omits an absent parentSpec and allows an empty create-issue body', async () => {
    await host.githubWrite.createIssue({ repo: 'owner/repo', title: 'title', body: '' });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('github_write_create_issue', {
      repo: 'owner/repo', title: 'title', body: '',
    });
  });

  it('rejects invalid fields and extra properties before invoke', async () => {
    const badArgs = [
      { repo: '../repo', title: 'title', body: '' },
      { repo: 'owner/repo', title: '  ', body: '' },
      { repo: 'owner/repo', title: 'bad\ntitle', body: '' },
      { repo: 'owner/repo', title: 'bad\rtitle', body: '' },
      { repo: 'owner/repo', title: 'bad\ttitle', body: '' },
      { repo: 'owner/repo', title: 'x'.repeat(257), body: '' },
      { repo: 'owner/repo', title: 'x', body: 'bad\0body' },
      { repo: 'owner/repo', title: 'x', body: '<!-- ai-one:spoof' },
      { repo: 'owner/repo', title: 'x', body: '', path: 'repos/owner/repo/issues' },
    ];
    for (const args of badArgs) {
      const result = await host.githubWrite.createIssue(args as never);
      expect(result.status).toBe('failed');
      expect(result.code).toBe('invalid_input');
    }
    await expect(host.githubWrite.comment({ repo: 'owner/repo', issue: 0, text: 'hello' })).resolves.toMatchObject({
      status: 'failed', code: 'invalid_input',
    });
    await expect(host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: '   ' })).resolves.toMatchObject({
      status: 'failed', code: 'invalid_input',
    });
    await expect(host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: 'hello <!-- ai-one:spoof' })).resolves.toMatchObject({
      status: 'failed', code: 'invalid_input',
    });
    await expect(host.githubWrite.setPause({ repo: 'owner/repo', issue: 12, state: 'paused-ish' as never })).resolves.toMatchObject({
      status: 'failed', code: 'invalid_input',
    });
    await expect(host.githubWrite.accept({ repo: 'owner/repo', issue: 12, pr: 4, expectedHead: 'bad' })).resolves.toMatchObject({
      status: 'failed', code: 'invalid_input',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('marks invoke rejection and malformed write results unconfirmed without retrying or exposing error text', async () => {
    invokeMock.mockRejectedValueOnce('PRIVATE_TOKEN_AND_SERVER_ERROR');
    const thrown = await host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: 'hello' });
    expect(thrown).toEqual({
      status: 'unconfirmed',
      code: 'unconfirmed',
      message: '已发出，但没能确认；请先回读，不要重试',
      steps: [],
    });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith('github_write_comment', {
      repo: 'owner/repo', issue: 12, text: 'hello',
    });
    expect(JSON.stringify(thrown)).not.toContain('PRIVATE_TOKEN');

    invokeMock.mockResolvedValueOnce({
      status: 'confirmed',
      code: 'ok',
      message: 'PRIVATE_SERVER_ERROR',
      steps: [],
    });
    const malformed = await host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: 'hello' });
    expect(malformed).toEqual({
      status: 'unconfirmed',
      code: 'unconfirmed',
      message: '已发出，但没能确认；请先回读，不要重试',
      steps: [],
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith('github_write_comment', {
      repo: 'owner/repo', issue: 12, text: 'hello',
    });
    expect(JSON.stringify(malformed)).not.toContain('PRIVATE_SERVER_ERROR');
  });

  it('treats self-contradictory results as unconfirmed, never as success', async () => {
    const okMessage = '已确认写入 GitHub';
    const contradictions: unknown[] = [
      { status: 'confirmed', code: 'ok', message: okMessage, steps: [] },
      { status: 'confirmed', code: 'ok', message: okMessage, steps: [{ step: 'comment', state: 'unconfirmed' }] },
      { status: 'confirmed', code: 'ok', message: okMessage,
        steps: [{ step: 'comment', state: 'confirmed' }, { step: 'label', state: 'skipped' }] },
      { status: 'partial', code: 'ok', message: okMessage, steps: [{ step: 'comment', state: 'confirmed' }] },
      { status: 'failed', code: 'ok', message: okMessage, steps: [] },
      { status: 'failed', code: 'timeout', message: '请求超时，写入结果可能不确定，请先回读，不要重试',
        steps: [{ step: 'comment', state: 'failed' }] },
      { status: 'failed', code: 'timeout', message: '请求超时，写入结果可能不确定，请先回读，不要重试', steps: [] },
      { status: 'partial', code: 'timeout', message: '评论已确认，但标签未能更新',
        steps: [{ step: 'comment', state: 'confirmed' }, { step: 'label', state: 'failed' }] },
      { status: 'failed', code: 'timeout', message: '请求超时，尚未发出写入，可稍后重试',
        steps: [{ step: 'comment', state: 'failed' }] },
      { status: 'unconfirmed', code: 'timeout', message: '请求超时，尚未发出写入，可稍后重试', steps: [] },
      { status: 'failed', code: 'github_failed', message: '已发出，但没能确认；请先回读，不要重试', steps: [] },
      { status: 'failed', code: 'github_failed', message: '评论已确认，但标签未能更新', steps: [] },
      { status: 'partial', code: 'github_failed', message: '评论已确认，但标签未能更新',
        steps: [{ step: 'comment', state: 'confirmed' }, { step: 'label', state: 'unconfirmed' }] },
      { status: 'failed', code: 'github_failed',
        message: 'Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试',
        steps: [{ step: 'create_issue', state: 'confirmed' }, { step: 'sub_issue', state: 'unconfirmed' }] },
      { status: 'unconfirmed', code: 'timeout',
        message: 'Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试', steps: [] },
      { status: 'partial', code: 'head_mismatch', message: 'HEAD 已更新，先刷新', steps: [] },
      { status: 'unconfirmed', code: 'pr_issue_mismatch', message: '该 PR 与这个 Issue 没有关联，已拒绝', steps: [] },
      { status: 'partial', code: 'github_failed', message: 'PR 不存在或当前不是开放状态，已拒绝', steps: [] },
      { status: 'failed', code: 'unconfirmed', message: '已发出，但没能确认；请先回读，不要重试', steps: [] },
      { status: 'partial', code: 'unconfirmed', message: '已发出，但没能确认；请先回读，不要重试',
        steps: [{ step: 'comment', state: 'confirmed' }, { step: 'label', state: 'failed' }] },
      { status: 'partial', code: 'sub_issue_failed', message: 'Issue 已创建，但没能挂到父 Spec 下',
        steps: [{ step: 'comment', state: 'confirmed' }, { step: 'label', state: 'failed' }] },
      { status: 'failed', code: 'sub_issue_failed', message: 'Issue 已创建，但没能挂到父 Spec 下', steps: [] },
      { status: 'failed', code: 'unconfirmed', message: '已发出，但没能确认；请先回读，不要重试',
        steps: [{ step: 'comment', state: 'unconfirmed' }] },
      { status: 'partial', code: 'sub_issue_failed', message: okMessage,
        steps: [{ step: 'create_issue', state: 'confirmed' }, { step: 'sub_issue', state: 'failed' }] },
      { status: 'partial', code: 'github_failed', message: okMessage, steps: [{ step: 'comment', state: 'confirmed' }] },
    ];
    for (const value of contradictions) {
      invokeMock.mockResolvedValueOnce(value);
      const result = await host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: 'hello' });
      expect(result.status).toBe('unconfirmed');
      expect(result.code).toBe('unconfirmed');
    }
  });

  it('passes genuine partial / failed / unconfirmed shapes through unchanged', async () => {
    const genuine = [
      { status: 'partial', code: 'github_failed', message: '评论已确认，但标签未能更新',
        steps: [{ step: 'comment', state: 'confirmed' }, { step: 'label', state: 'failed' }] },
      { status: 'unconfirmed', code: 'timeout',
        message: 'Issue 已创建，但子 Issue 关系已发出，暂未确认；请先回读，不要重试',
        steps: [{ step: 'create_issue', state: 'confirmed' }, { step: 'sub_issue', state: 'unconfirmed' }] },
      { status: 'failed', code: 'head_mismatch', message: 'HEAD 已更新，先刷新', steps: [], currentHead: sha },
      { status: 'failed', code: 'timeout', message: '请求超时，尚未发出写入，可稍后重试', steps: [] },
      { status: 'unconfirmed', code: 'timeout', message: '请求超时，写入结果可能不确定，请先回读，不要重试',
        steps: [{ step: 'comment', state: 'unconfirmed' }] },
      { status: 'failed', code: 'pr_issue_mismatch', message: '该 PR 与这个 Issue 没有关联，已拒绝', steps: [] },
      { status: 'failed', code: 'github_failed', message: 'PR 不存在或当前不是开放状态，已拒绝', steps: [] },
      { status: 'unconfirmed', code: 'unconfirmed', message: '已发出，但没能确认；请先回读，不要重试',
        steps: [{ step: 'comment', state: 'unconfirmed' }] },
    ];
    for (const value of genuine) {
      invokeMock.mockResolvedValueOnce(value);
      await expect(host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: 'hello' }))
        .resolves.toEqual(value);
    }
  });

  it('passes a genuine partial sub-issue result through unchanged', async () => {
    const partial = {
      status: 'partial',
      code: 'sub_issue_failed',
      message: 'Issue 已创建，但没能挂到父 Spec 下',
      steps: [{ step: 'create_issue', state: 'confirmed' }, { step: 'sub_issue', state: 'failed' }],
      issueNumber: 9,
      url: 'https://example.invalid/issue/9',
    };
    invokeMock.mockResolvedValueOnce(partial);
    await expect(host.githubWrite.createIssue({ repo: 'owner/repo', title: 't', body: '', parentSpec: 7 }))
      .resolves.toEqual(partial);
  });

  it('normalizes malformed status results and invoke failures', async () => {
    invokeMock.mockResolvedValueOnce({ available: true, reason: 'not_logged_in' });
    await expect(host.githubWrite.status()).resolves.toEqual({ available: false, reason: 'failed' });
    invokeMock.mockRejectedValueOnce('PRIVATE_AUTH_ERROR');
    await expect(host.githubWrite.status()).resolves.toEqual({ available: false, reason: 'failed' });
  });
});

describe('derivePauseState', () => {
  const pausedSentence = '用户已暂停：请停止派发新工作，正在进行的一步可完成。';
  const resumedSentence = '用户已恢复：可继续派发。';
  const prefix = '【ai-one 代用户发出】';
  const marker = '<!-- ai-one:set_pause:v1 -->';
  const pause = prefix + '\n' + pausedSentence + '\n' + marker;
  const running = prefix + '\n' + resumedSentence + '\n' + marker;

  it('defaults to not paused when there are no comments', () => {
    expect(derivePauseState([])).toEqual({ paused: false });
  });

  it('uses the latest valid comment and skips invalid comments without resetting state', () => {
    expect(derivePauseState([{ body: pause }])).toEqual({ paused: true });
    expect(derivePauseState([{ body: pause }, { body: 'ordinary comment' }, { body: running }])).toEqual({ paused: false });
    expect(derivePauseState([{ body: running }, { body: pause }])).toEqual({ paused: true });
    expect(derivePauseState([{ body: pause }, { body: prefix + '\n' + pausedSentence }])).toEqual({ paused: true });
  });

  it('ignores markers that are not the exact final line and malformed template text', () => {
    expect(derivePauseState([{ body: prefix + '\n' + pausedSentence + '\nextra\n' + marker }])).toEqual({ paused: false });
    expect(derivePauseState([{ body: pause + ' extra' }])).toEqual({ paused: false });
    expect(derivePauseState([{ body: prefix + '\n' + pausedSentence + ' ' + resumedSentence + '\n' + marker }])).toEqual({ paused: false });
    expect(derivePauseState([{ body: prefix + '\n' + resumedSentence + '\n' + marker + '\nextra' }])).toEqual({ paused: false });
    expect(derivePauseState([{ body: 'other person says\n' + pausedSentence + '\n' + marker }])).toEqual({ paused: false });
  });
});

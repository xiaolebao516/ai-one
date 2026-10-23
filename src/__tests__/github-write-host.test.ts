import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, isTauri: () => true }));

import { host } from '../host';
import { derivePauseState, type GithubWriteResult } from '../host/githubWrite';

const goodResult: GithubWriteResult = {
  status: 'confirmed',
  code: 'ok',
  message: '已确认写入 GitHub',
  steps: [],
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

  it('normalizes thrown errors and malformed results without exposing their text', async () => {
    invokeMock.mockRejectedValueOnce('PRIVATE_TOKEN_AND_SERVER_ERROR');
    const thrown = await host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: 'hello' });
    expect(thrown).toMatchObject({
      status: 'failed',
      code: 'github_failed',
      message: 'GitHub 操作失败，请检查权限、网络和 API 限额',
    });
    expect(JSON.stringify(thrown)).not.toContain('PRIVATE_TOKEN');

    invokeMock.mockResolvedValueOnce({
      status: 'confirmed',
      code: 'ok',
      message: 'PRIVATE_SERVER_ERROR',
      steps: [],
    });
    const malformed = await host.githubWrite.comment({ repo: 'owner/repo', issue: 12, text: 'hello' });
    expect(malformed.code).toBe('github_failed');
    expect(JSON.stringify(malformed)).not.toContain('PRIVATE_SERVER_ERROR');
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

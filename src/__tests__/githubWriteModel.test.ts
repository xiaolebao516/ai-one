import { describe, expect, it } from 'vitest';
import {
  AI_ONE_COMMENT_PREFIX,
  COMMENT_MARKER,
  PAUSE_MARKER,
  derivePauseState,
  formatAcceptBody,
  formatCommentBody,
  formatPauseBody,
  formatRequestChangesBody,
  githubWrite,
} from '../host/githubWrite';

describe('githubWrite helpers and models', () => {
  it('formats comment body with prefix and comment marker', () => {
    const formatted = formatCommentBody('请注意测试用例覆盖');
    expect(formatted.startsWith(AI_ONE_COMMENT_PREFIX)).toBe(true);
    expect(formatted.endsWith(COMMENT_MARKER)).toBe(true);
    expect(formatted).toContain('请注意测试用例覆盖');
  });

  it('formats pause and resume bodies correctly', () => {
    const paused = formatPauseBody('paused');
    expect(paused.startsWith(AI_ONE_COMMENT_PREFIX)).toBe(true);
    expect(paused.endsWith(PAUSE_MARKER)).toBe(true);
    expect(paused).toContain('用户已暂停');

    const running = formatPauseBody('running');
    expect(running.startsWith(AI_ONE_COMMENT_PREFIX)).toBe(true);
    expect(running.endsWith(PAUSE_MARKER)).toBe(true);
    expect(running).toContain('用户已恢复');
  });

  it('formats accept body with expected head and accept marker', () => {
    const sha = '1234567890123456789012345678901234567890';
    const formatted = formatAcceptBody(sha);
    expect(formatted.startsWith(AI_ONE_COMMENT_PREFIX)).toBe(true);
    expect(formatted.endsWith('<!-- ai-one:accept:v1 -->')).toBe(true);
    expect(formatted).toContain(sha);
  });

  it('formats request changes body with expected head and text', () => {
    const sha = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const formatted = formatRequestChangesBody(sha, '请补充深浅主题截图');
    expect(formatted.startsWith(AI_ONE_COMMENT_PREFIX)).toBe(true);
    expect(formatted.endsWith('<!-- ai-one:request_changes:v1 -->')).toBe(true);
    expect(formatted).toContain(sha);
    expect(formatted).toContain('请补充深浅主题截图');
  });

  describe('derivePauseState', () => {
    it('returns none for empty comments list', () => {
      expect(derivePauseState([])).toBe('none');
    });

    it('returns none for comments without required prefix and marker', () => {
      const comments = [
        { body: '用户已暂停：请停止派发新工作' },
        { body: '普通讨论评论 <!-- ai-one:comment:v1 -->' },
      ];
      expect(derivePauseState(comments)).toBe('none');
    });

    it('returns none if marker is not the final line', () => {
      const malformed = `${AI_ONE_COMMENT_PREFIX}\n用户已暂停：请停止派发\n${PAUSE_MARKER}\n额外末尾文字`;
      expect(derivePauseState([{ body: malformed }])).toBe('none');
    });

    it('returns none if prefix is not the first line', () => {
      const malformed = `前置文字\n${AI_ONE_COMMENT_PREFIX}\n用户已暂停：请停止派发\n${PAUSE_MARKER}`;
      expect(derivePauseState([{ body: malformed }])).toBe('none');
    });

    it('correctly derives paused from a valid pause comment', () => {
      const valid = formatPauseBody('paused');
      expect(derivePauseState([{ body: valid }])).toBe('paused');
    });

    it('correctly derives running from a valid resume comment', () => {
      const valid = formatPauseBody('running');
      expect(derivePauseState([{ body: valid }])).toBe('running');
    });

    it('resolves latest comment state chronologically', () => {
      const c1 = {
        body: formatPauseBody('paused'),
        createdAt: '2026-10-23T10:00:00Z',
      };
      const c2 = {
        body: formatPauseBody('running'),
        createdAt: '2026-10-23T11:00:00Z',
      };
      const c3 = {
        body: formatPauseBody('paused'),
        createdAt: '2026-10-23T12:00:00Z',
      };

      expect(derivePauseState([c1, c2])).toBe('running');
      expect(derivePauseState([c1, c2, c3])).toBe('paused');
    });
  });

  describe('githubWrite parameter validation', () => {
    it('rejects empty comment text', async () => {
      const res = await githubWrite.comment({ repo: 'owner/repo', issue: 1, text: '   ' });
      expect(res.outcome).toBe('failed');
      expect(res.message).toContain('不能为空');
    });

    it('rejects restricted ai-one internal markers in comment input', async () => {
      const res = await githubWrite.comment({
        repo: 'owner/repo',
        issue: 1,
        text: 'hello <!-- ai-one:set_pause:v1 -->',
      });
      expect(res.outcome).toBe('failed');
      expect(res.message).toContain('受限');
    });

    it('rejects accept without valid 40-hex expectedHead', async () => {
      const res = await githubWrite.accept({
        repo: 'owner/repo',
        issue: 1,
        pr: 10,
        expectedHead: 'short',
      });
      expect(res.outcome).toBe('failed');
      expect(res.message).toContain('无效');
    });

    it('rejects requestChanges without notes or without 40-hex SHA', async () => {
      const resEmpty = await githubWrite.requestChanges({
        repo: 'owner/repo',
        issue: 1,
        pr: 10,
        expectedHead: '1234567890123456789012345678901234567890',
        text: '   ',
      });
      expect(resEmpty.outcome).toBe('failed');
      expect(resEmpty.message).toContain('不能为空');

      const resBadSha = await githubWrite.requestChanges({
        repo: 'owner/repo',
        issue: 1,
        pr: 10,
        expectedHead: 'bad',
        text: '修改意见',
      });
      expect(resBadSha.outcome).toBe('failed');
      expect(resBadSha.message).toContain('无效');
    });
  });
});

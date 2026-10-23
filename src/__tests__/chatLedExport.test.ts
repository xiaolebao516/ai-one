import { describe, expect, it } from 'vitest';
import type { ChatLedRun } from '../workflow/chatLed/types';
import { exportRunMarkdown } from '../workflow/chatLed/exportMarkdown';

const TICK = String.fromCharCode(96);
const MESSAGE = 'First line with ' + TICK.repeat(4) + ' inside\n' + 'x'.repeat(12000) + '\nLast line';
const REPLY = 'Reply starts here\n' + TICK.repeat(3) + ' embedded fence\n' + 'y'.repeat(9000);

function makeRun(): ChatLedRun {
  return {
    id: 'run-export-1',
    goal: 'Compare the implementations without losing content.',
    coordinator: 'chatgpt',
    available: ['claude'],
    roundLimit: 8,
    round: 1,
    phase: 'finished',
    doneSummary: 'The coordinator completed the task.',
    forwards: [
      {
        id: 'r1-claude',
        round: 1,
        from: 'chatgpt',
        to: 'claude',
        message: MESSAGE,
        messageChars: MESSAGE.length,
        status: 'done',
        reply: REPLY,
        replyChars: REPLY.length,
        startedAt: 1_798_000_000_000,
        finishedAt: 1_798_000_010_000,
      },
    ],
    conversations: [
      {
        provider: 'claude',
        url: 'https://claude.ai/chat/registered-session',
        title: 'Created by ai-one',
        createdByAiOne: true,
        registeredAt: 1_798_000_020_000,
      },
    ],
    coordinatorReplies: [
      { round: 1, text: 'Please compare the options.', at: 1_798_000_005_000 },
    ],
    createdAt: 1_798_000_000_000,
    updatedAt: 1_798_000_030_000,
    closed: { at: 1_798_000_040_000, exportedMarkdown: true },
  };
}

describe('chat-led Markdown export', () => {
  it('preserves complete long messages and replies containing long backtick runs', () => {
    const markdown = exportRunMarkdown(makeRun(), 'en');

    expect(markdown).toContain(MESSAGE);
    expect(markdown).toContain(REPLY);
    expect(markdown).toContain(TICK.repeat(5) + '\n' + MESSAGE + '\n' + TICK.repeat(5));
    expect(markdown).toContain(TICK.repeat(4) + '\n' + REPLY + '\n' + TICK.repeat(4));
  });

  it('exports run metadata, coordinator replies, forwarding status, and registered conversation URLs', () => {
    const markdown = exportRunMarkdown(makeRun(), 'zh');

    expect(markdown).toContain('Chat 主导运行记录');
    expect(markdown).toContain('Compare the implementations without losing content.');
    expect(markdown).toContain('ChatGPT → Claude');
    expect(markdown).toContain('已处理轮次: 1');
    expect(markdown).toContain('Please compare the options.');
    expect(markdown).toContain('https://claude.ai/chat/registered-session');
    expect(markdown).toContain(new Date(1_798_000_000_000).toISOString());
    expect(markdown).toContain('The coordinator completed the task.');
  });
});

import { describe, it, expect } from 'vitest';
import type { AIProvider } from '../../shared/types';
import {
  buildFeedbackPrompt,
  buildIntroPrompt,
  buildViolationReminder,
  parseCoordinatorReply,
} from '../workflow/chatLed/protocol';

const fence = String.fromCharCode(96).repeat(3);
const available: AIProvider[] = ['claude', 'gemini', 'grok', 'meta'];

function block(name: string, body: string, length = 3): string {
  const marker = String.fromCharCode(96).repeat(length);
  return marker + name + '\n' + body + '\n' + marker;
}

function parse(
  reply: string,
  options: {
    coordinator?: AIProvider;
    available?: readonly AIProvider[];
    previous?: { to: AIProvider[]; message: string };
  } = {},
) {
  return parseCoordinatorReply(reply, {
    coordinator: options.coordinator ?? 'chatgpt',
    available: options.available ?? available,
    ...(options.previous ? { previous: options.previous } : {}),
  });
}

describe('chat-led protocol', () => {
  it('parses a valid send directive and preserves the message exactly', () => {
    const result = parse(
      'Text before.\n' +
        block('ai-one-send', '{"to":["claude","claude"],"message":"  exact message  ","reply":"full"}') +
        '\nText after.',
    );

    expect(result).toEqual({ kind: 'send', to: ['claude'], message: '  exact message  ' });
  });

  it('parses a valid done directive including an empty summary', () => {
    expect(parse(block('ai-one-done', '{"summary":""}'))).toEqual({
      kind: 'done',
      summary: '',
    });
  });

  it('rejects invalid JSON', () => {
    expect(parse(block('ai-one-send', '{"to":["claude"],"message":}'))).toMatchObject({
      kind: 'violation',
      code: 'invalid-json',
    });
  });

  it('rejects unknown keys and an invalid reply option', () => {
    expect(parse(block('ai-one-send', '{"to":["claude"],"message":"work","extra":true}'))).toMatchObject({
      kind: 'violation',
      code: 'invalid-shape',
    });
    expect(parse(block('ai-one-send', '{"to":["claude"],"message":"work","reply":"brief"}'))).toMatchObject({
      kind: 'violation',
      code: 'invalid-shape',
    });
  });

  it('rejects a missing or whitespace-only message', () => {
    expect(parse(block('ai-one-send', '{"to":["claude"]}'))).toMatchObject({
      kind: 'violation',
      code: 'invalid-shape',
    });
    expect(parse(block('ai-one-send', '{"to":["claude"],"message":"  \\n  "}'))).toMatchObject({
      kind: 'violation',
      code: 'invalid-shape',
    });
  });

  it('rejects more than one top-level directive fence', () => {
    const reply = block('ai-one-send', '{"to":"claude","message":"one"}') +
      '\n' +
      block('ai-one-done', '{"summary":"two"}');
    expect(parse(reply)).toMatchObject({ kind: 'violation', code: 'multiple-directives' });
  });

  it('ignores a directive shown only inside an outer markdown code fence', () => {
    const reply = [
      'Example:',
      fence + 'markdown',
      fence + 'ai-one-send',
      '{"to":["claude"],"message":"example only"}',
      fence,
      fence,
    ].join('\n');

    expect(parse(reply)).toMatchObject({ kind: 'violation', code: 'no-directive' });
  });

  it('parses a directive surrounded by ordinary prose', () => {
    const result = parse(
      'I will delegate this now.\n\n' +
        block('ai-one-send', '{"to":"claude","message":"full context"}') +
        '\n\nThis text is ignored.',
    );
    expect(result).toEqual({ kind: 'send', to: ['claude'], message: 'full context' });
  });

  it('rejects unknown, unavailable, self, and excessive targets', () => {
    expect(parse(block('ai-one-send', '{"to":"not-a-provider","message":"work"}'))).toMatchObject({
      kind: 'violation',
      code: 'unknown-target',
    });
    expect(parse(block('ai-one-send', '{"to":"meta","message":"work"}'), { available: ['claude'] })).toMatchObject({
      kind: 'violation',
      code: 'unavailable-target',
    });
    expect(parse(block('ai-one-send', '{"to":"chatgpt","message":"work"}'))).toMatchObject({
      kind: 'violation',
      code: 'self-target',
    });
    expect(parse(block('ai-one-send', '{"to":["chatgpt","claude","gemini","grok","meta"],"message":"work"}'))).toMatchObject({
      kind: 'violation',
      code: 'too-many-targets',
    });
  });

  it('rejects an exact duplicate of the previous send directive', () => {
    expect(
      parse(block('ai-one-send', '{"to":["claude"],"message":"repeat"}'), {
        previous: { to: ['claude'], message: 'repeat' },
      }),
    ).toMatchObject({ kind: 'violation', code: 'duplicate-directive' });
  });

  it('matches four-backtick fences correctly', () => {
    expect(
      parse(block('ai-one-send', '{"to":["claude"],"message":"four"}', 4)),
    ).toEqual({ kind: 'send', to: ['claude'], message: 'four' });
  });

  it('builds the intro prompt with provider identifiers, both examples, and the original goal', () => {
    const prompt = buildIntroPrompt({
      goal: 'Keep this original goal intact.',
      coordinator: 'chatgpt',
      available: [{ provider: 'claude', label: 'Claude' }],
      roundLimit: 8,
    });

    expect(prompt).toContain('claude');
    expect(prompt).toContain(fence + 'ai-one-send');
    expect(prompt).toContain(fence + 'ai-one-done');
    expect(prompt).toContain('Keep this original goal intact.');
    expect(prompt).toContain('8');
  });

  it('builds feedback without truncating a long complete reply', () => {
    const longReply = 'full-reply-'.repeat(5000);
    const prompt = buildFeedbackPrompt(
      [{ from: 'claude', label: 'Claude', reply: longReply }],
      3,
      5,
    );

    expect(prompt).toContain('[ai-one] 来自 Claude 的完整回复：\n' + longReply);
    expect(prompt).toContain('剩余轮数：5');
    expect(prompt).toContain('请继续用 ai-one-send 或 ai-one-done 围栏回复');
  });

  it('formats failed feedback and gives a reminder for every violation code', () => {
    const prompt = buildFeedbackPrompt(
      [{ from: 'claude', label: 'Claude', error: 'provider unavailable' }],
      1,
      7,
    );
    expect(prompt).toContain('[ai-one] 向 Claude 转发失败：provider unavailable');

    const codes = [
      'no-directive',
      'multiple-directives',
      'invalid-json',
      'invalid-shape',
      'unknown-target',
      'unavailable-target',
      'self-target',
      'too-many-targets',
      'duplicate-directive',
    ] as const;
    for (const code of codes) {
      expect(buildViolationReminder(code).length).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect } from 'vitest';
import type { AIProvider, ProviderInstance } from '../../shared/types';
import { providerInstanceName } from '../../shared/providerInstances';
import {
  buildFeedbackPrompt,
  buildIntroPrompt,
  goalNamesProvider,
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
    available?: readonly ProviderInstance[];
    previous?: { to: ProviderInstance[]; message: string };
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
    expect(prompt).toContain('[ai-one] 来自 Claude 的转发失败：provider unavailable');

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

describe('chat-led template modes', () => {
  const input = {
    goal: 'Build a project',
    coordinator: 'chatgpt' as const,
    available: [{ provider: 'claude' as const, label: 'Claude' }],
    roundLimit: 8,
  };
  it('keeps the general prompt byte-for-byte identical to the original', () => {
    const expected = [
      '你是本次任务的协调者，provider 标识为 chatgpt。请根据用户目标组织其他 AI 协作，并在收到完整回复后继续判断。',
      '可转发的 AI 列表：claude（Claude）。to 字段必须使用列表中的 provider 标识，不要使用显示名称。',
      '需要转发时，输出且只输出一个如下格式的围栏块；围栏内部必须是严格 JSON：',
      fence + 'ai-one-send',
      '{"to":["claude"],"message":"请独立完成指定任务，并给出完整结果。","reply":"full"}',
      fence,
      '确认整个任务完成时，输出且只输出一个如下格式的围栏块：',
      fence + 'ai-one-done',
      '{"summary":"面向用户的最终总结"}',
      fence,
      '协议规则：一次回复最多只能包含一个 ai-one-send 或 ai-one-done 围栏块；message 必须自包含，写全执行所需的背景、约束和上下文，不得依赖其他 AI 能看到本次网页对话。',
      '不要在同一回复里放两个 ai-one 围栏块。不要用 ai-one 围栏展示示例或引用内容。普通文字不会触发转发；只有上述顶层围栏块会被识别。',
      '最多执行 8 轮转发；收到第 9 条协调者回复时会暂停并交由用户决定。完成时必须使用 ai-one-done 围栏，不要只用自然语言宣告完成。',
      '用户任务原文如下，请保留其目标与约束：\n\nBuild a project',
    ].join('\n\n');
    expect(buildIntroPrompt(input)).toBe(expected);
    expect(buildIntroPrompt({ ...input, mode: 'general' })).toBe(expected);
  });
  it('adds repository collaboration constraints without claiming ai-one performs writes', () => {
    const prompt = buildIntroPrompt({ ...input, mode: 'repo' });
    expect(prompt).toContain('每位工人使用独立分支');
    expect(prompt).toContain('同一分支同一时间只有一个写入者');
    expect(prompt).toContain('GitHub 连接器');
    expect(prompt).toContain('ai-one 不检查、不代执行');
  });
  it('lists unready AIs and forbids substituting them, right after the available list', () => {
    const prompt = buildIntroPrompt({
      ...input,
      unavailable: [{ provider: 'gemini', label: 'Gemini', reason: 'not logged in' }],
    });
    const lines = prompt.split('\n\n');
    expect(lines[1]).toContain('可转发的 AI 列表：claude（Claude）');
    expect(lines[2]).toContain('本次未就绪、不能转发的 AI：gemini（Gemini，原因：not logged in）');
    expect(lines[2]).toContain('不要改派给列表里的其他 AI 顶替');
    expect(lines[2]).toContain('ai-one-done');
    expect(buildIntroPrompt({ ...input, unavailable: [] })).toBe(buildIntroPrompt(input));
  });
  it('counts an AI as named by id, display name or Chinese alias; extra workers always count', () => {
    expect(goalNamesProvider('派gpt和gemini argon分别解决', 'gemini')).toBe(true);
    expect(goalNamesProvider('派gpt和gemini argon分别解决', 'grok')).toBe(false);
    expect(goalNamesProvider('让 Claude 审一下', 'claude')).toBe(true);
    expect(goalNamesProvider('让克劳德和双子讨论', 'claude')).toBe(true);
    expect(goalNamesProvider('让克劳德和双子讨论', 'gemini')).toBe(true);
    expect(goalNamesProvider('随便讨论', 'chatgpt#2')).toBe(true);
  });
  it('asks independent opinions and coordinator synthesis in discussion mode', () => {
    const prompt = buildIntroPrompt({ ...input, mode: 'discuss' });
    expect(prompt).toContain('独立给出观点');
    expect(prompt).toContain('协调者比较分歧并汇总');
  });
});

describe('provider instance protocol', () => {
  it('allows only enabled worker instances and rejects the coordinator', () => {
    const enabled: ProviderInstance[] = ['chatgpt#2', 'chatgpt#3', 'claude'];
    expect(parse(block('ai-one-send', '{"to":["chatgpt#2","chatgpt#3","claude"],"message":"self-contained"}'), { available: enabled }))
      .toMatchObject({ kind: 'send', to: enabled });
    expect(parse(block('ai-one-send', '{"to":"chatgpt#4","message":"x"}'), { available: enabled }))
      .toMatchObject({ kind: 'violation', code: 'unknown-target' });
    expect(parse(block('ai-one-send', '{"to":"chatgpt#3","message":"x"}'), { available: ['chatgpt#2'] }))
      .toMatchObject({ kind: 'violation', code: 'unavailable-target' });
    expect(parse(block('ai-one-send', '{"to":"chatgpt","message":"x"}'), { available: enabled }))
      .toMatchObject({ kind: 'violation', code: 'self-target' });
  });
  it('preserves the original general prompt without workers and describes independent contexts with workers', () => {
    const original = { goal: 'hello', coordinator: 'chatgpt' as const, available: [{ provider: 'claude' as const, label: 'Claude' }], roundLimit: 8 };
    const general = buildIntroPrompt(original);
    expect(buildIntroPrompt({ ...original, mode: 'general' })).toBe(general);
    const withWorkers = buildIntroPrompt({ ...original, available: [...original.available, { provider: 'chatgpt#2' as const, label: 'ChatGPT #2' }] });
    expect(withWorkers).toContain('chatgpt#2（ChatGPT #2）');
    expect(withWorkers).toContain('不共享上下文');
  });
});

describe('provider instance names', () => {
  it('keeps base names and numbers additional workers', () => {
    expect(providerInstanceName('chatgpt', { chatgpt: 'ChatGPT' })).toBe('ChatGPT');
    expect(providerInstanceName('chatgpt#2', { chatgpt: 'ChatGPT' })).toBe('ChatGPT #2');
  });
});

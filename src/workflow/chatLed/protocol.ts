import { AI_PROVIDERS } from '../../../shared/constants';
import { isProviderInstance } from '../../../shared/providerInstances';
import type { AIProvider, ProviderInstance } from '../../../shared/types';
import {
  DONE_FENCE,
  MAX_TARGETS_PER_DIRECTIVE,
  SEND_FENCE,
  type ParsedReply,
  type ProtocolViolationCode,
} from './types';

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  chatgpt: AI_PROVIDERS.chatgpt.name,
  claude: AI_PROVIDERS.claude.name,
  gemini: AI_PROVIDERS.gemini.name,
  grok: AI_PROVIDERS.grok.name,
  meta: AI_PROVIDERS.meta.name,
};

type DirectiveFenceName = typeof SEND_FENCE | typeof DONE_FENCE;

interface DirectiveFence {
  name: DirectiveFenceName;
  body: string;
}

interface OpenFence {
  marker: string;
  length: number;
  name: DirectiveFenceName | undefined;
  content: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function violation(code: ProtocolViolationCode, detail: string): ParsedReply {
  return { kind: 'violation', code, detail };
}

function collectTopLevelDirectiveFences(reply: string): DirectiveFence[] {
  const lines = reply.split(/\r?\n/);
  const directives: DirectiveFence[] = [];
  let open: OpenFence | undefined;

  for (const line of lines) {
    if (open) {
      const closing = line.match(/^ {0,3}([\x60]+|~+)[ \t]*$/);
      if (
        closing &&
        closing[1][0] === open.marker &&
        closing[1].length >= open.length
      ) {
        if (open.name) {
          directives.push({ name: open.name, body: open.content.join('\n') });
        }
        open = undefined;
        continue;
      }

      open.content.push(line);
      continue;
    }

    const opening = line.match(/^ {0,3}([\x60]{3,}|~{3,})(.*)$/);
    if (!opening) continue;

    const marker = opening[1];
    const info = opening[2].trim();
    if (marker[0] === '\x60' && info.includes('\x60')) continue;

    const name =
      info === SEND_FENCE || info === DONE_FENCE ? info : undefined;
    open = {
      marker: marker[0],
      length: marker.length,
      name,
      content: [],
    };
  }

  return directives;
}

export function parseCoordinatorReply(
  reply: string,
  ctx: {
    coordinator: AIProvider;
    available: readonly ProviderInstance[];
    previous?: { to: ProviderInstance[]; message: string };
  },
): ParsedReply {
  const fences = collectTopLevelDirectiveFences(reply);
  if (fences.length === 0) {
    return violation('no-directive', 'No top-level ai-one directive fence was found.');
  }
  if (fences.length > 1) {
    return violation('multiple-directives', 'More than one top-level ai-one directive fence was found.');
  }

  const fence = fences[0];
  let payload: unknown;
  try {
    payload = JSON.parse(fence.body);
  } catch {
    return violation('invalid-json', 'The directive body is not valid JSON.');
  }

  if (!isRecord(payload)) {
    return violation('invalid-shape', 'The directive JSON must be an object.');
  }

  if (fence.name === DONE_FENCE) {
    if (
      Object.keys(payload).some((key) => key !== 'summary') ||
      typeof payload.summary !== 'string'
    ) {
      return violation('invalid-shape', 'A done directive must contain only a string summary.');
    }
    return { kind: 'done', summary: payload.summary };
  }

  const allowedKeys = new Set(['to', 'message', 'reply']);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    return violation('invalid-shape', 'A send directive contains an unknown key.');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'reply') && payload.reply !== 'full') {
    return violation('invalid-shape', 'The optional reply field must be full.');
  }
  if (typeof payload.message !== 'string' || payload.message.trim().length === 0) {
    return violation('invalid-shape', 'The message field must be a non-empty string.');
  }

  const targetStrings: string[] | undefined =
    typeof payload.to === 'string'
      ? [payload.to]
      : Array.isArray(payload.to) && payload.to.every((target: unknown) => typeof target === 'string')
        ? (payload.to as string[])
        : undefined;
  if (!targetStrings || targetStrings.length === 0) {
    return violation('invalid-shape', 'The to field must be a provider string or a non-empty string array.');
  }

  for (const target of targetStrings) {
    if (!isProviderInstance(target)) {
      return violation('unknown-target', 'The directive names an unknown AI provider.');
    }
  }

  const targets = [...new Set(targetStrings as ProviderInstance[])];
  if (targets.length > MAX_TARGETS_PER_DIRECTIVE) {
    return violation('too-many-targets', 'The directive exceeds the maximum number of distinct targets.');
  }

  for (const target of targets) {
    if (target === ctx.coordinator) {
      return violation('self-target', 'The coordinator cannot target itself.');
    }
    if (!ctx.available.includes(target)) {
      return violation('unavailable-target', 'The target provider is not available for this run.');
    }
  }

  if (
    ctx.previous &&
    ctx.previous.message === payload.message &&
    ctx.previous.to.length === targets.length &&
    ctx.previous.to.every((provider, index) => provider === targets[index])
  ) {
    return violation('duplicate-directive', 'The directive exactly repeats the previous send directive.');
  }

  return { kind: 'send', to: targets, message: payload.message };
}

export function buildIntroPrompt(input: {
  goal: string;
  coordinator: AIProvider;
  available: readonly { provider: ProviderInstance; label: string }[];
  unavailable?: readonly { provider: ProviderInstance; label: string; reason: string }[];
  roundLimit: number;
  mode?: 'general' | 'repo' | 'discuss';
}): string {
  const fence = String.fromCharCode(96).repeat(3);
  const providers = input.available.length > 0
    ? input.available.map((item) => item.provider + '（' + item.label + '）').join('、')
    : '（当前没有可转发的 AI）';
  const exampleTarget = input.available[0]?.provider ?? 'claude';

  const parts = [
    '你是本次任务的协调者，provider 标识为 ' + input.coordinator + '。请根据用户目标组织其他 AI 协作，并在收到完整回复后继续判断。',
    '可转发的 AI 列表：' + providers + '。to 字段必须使用列表中的 provider 标识，不要使用显示名称。',
    '需要转发时，输出且只输出一个如下格式的围栏块；围栏内部必须是严格 JSON：',
    fence + SEND_FENCE,
    '{"to":["' + exampleTarget + '"],"message":"请独立完成指定任务，并给出完整结果。","reply":"full"}',
    fence,
    '确认整个任务完成时，输出且只输出一个如下格式的围栏块：',
    fence + DONE_FENCE,
    '{"summary":"面向用户的最终总结"}',
    fence,
    '协议规则：一次回复最多只能包含一个 ai-one-send 或 ai-one-done 围栏块；message 必须自包含，写全执行所需的背景、约束和上下文，不得依赖其他 AI 能看到本次网页对话。',
    '不要在同一回复里放两个 ai-one 围栏块。不要用 ai-one 围栏展示示例或引用内容。普通文字不会触发转发；只有上述顶层围栏块会被识别。',
    '最多执行 ' + input.roundLimit + ' 轮转发；收到第 ' + (input.roundLimit + 1) + ' 条协调者回复时会暂停并交由用户决定。完成时必须使用 ai-one-done 围栏，不要只用自然语言宣告完成。',
    '用户任务原文如下，请保留其目标与约束：\n\n' + input.goal,
  ];
  if (input.unavailable && input.unavailable.length > 0) {
    const missing = input.unavailable.map((item) => item.provider + '（' + item.label + '，原因：' + item.reason + '）').join('、');
    parts.splice(2, 0,
      '本次未就绪、不能转发的 AI：' + missing + '。如果用户任务点名要用其中的 AI，不要改派给列表里的其他 AI 顶替，也不要让其他 AI 扮演它；直接输出 ai-one-done 围栏，告诉用户哪个 AI 没就绪、请登录或打开后重新开始。');
  }
  if (input.available.some(({ provider }) => provider.startsWith('chatgpt#'))) {
    parts.splice(-1, 0, 'chatgpt#2 / chatgpt#3 是另外的独立 ChatGPT 工人对话，与你（协调者）不共享上下文，message 必须自包含。');
  }
  if (input.mode === 'repo') {
    parts.splice(-1, 0, '仓库协作模式：每位工人使用独立分支，同一分支同一时间只有一个写入者。仓库写操作必须由网页 AI 使用其自带的 GitHub 连接器执行；ai-one 不检查、不代执行任何 GitHub 写操作。');
  } else if (input.mode === 'discuss') {
    parts.splice(-1, 0, '讨论模式：请让各方独立给出观点、理由和证据，不要让一方代替另一方回答；收到各方完整回复后，由协调者比较分歧并汇总形成结论。');
  }
  return parts.join('\n\n');
}

export function buildFeedbackPrompt(
  items: { from: ProviderInstance; label: string; reply?: string; error?: string }[],
  round: number,
  remaining: number,
): string {
  const sections = items.map((item) => {
    if (item.error !== undefined) {
      return '[ai-one] 来自 ' + item.label + ' 的转发失败：' + item.error;
    }
    return '[ai-one] 来自 ' + item.label + ' 的完整回复：\n' + (item.reply ?? '');
  });
  const content = sections.length > 0 ? sections.join('\n\n') : '本轮没有可回传的项目。';

  return [
    '第 ' + round + ' 轮转发结果：',
    content,
    '剩余轮数：' + remaining + '。请继续用 ai-one-send 或 ai-one-done 围栏回复。',
  ].join('\n\n');
}

const VIOLATION_REMINDERS: Record<ProtocolViolationCode, string> = {
  'no-directive': '上一条回复没有可识别的顶层指令，请只重发一个合法的 ai-one-send 或 ai-one-done 围栏块。',
  'multiple-directives': '上一条回复包含多个指令围栏，请只保留一个顶层 ai-one-send 或 ai-one-done 围栏块后重发。',
  'invalid-json': '上一条指令不是严格合法的 JSON，请修正 JSON 后只重发一个指令围栏块。',
  'invalid-shape': '上一条指令的字段或类型不符合协议，请仅使用允许的字段并修正后重发。',
  'unknown-target': '上一条指令包含未知 provider 标识，请从可用 AI 列表中选择正确的标识后重发。',
  'unavailable-target': '上一条指令的目标当前不可用，请改用已登录且可转发的 AI provider 后重发。',
  'self-target': '上一条指令把协调者设为了目标，请移除协调者自身并重发。',
  'too-many-targets': '上一条指令的不同目标数量超过上限，请减少目标数量后重发。',
  'duplicate-directive': '上一条指令与之前的转发完全重复，请提供新的任务内容或使用 ai-one-done 结束。',
};

export function buildViolationReminder(code: ProtocolViolationCode): string {
  return VIOLATION_REMINDERS[code];
}

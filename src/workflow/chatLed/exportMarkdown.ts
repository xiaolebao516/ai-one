// This export may contain conversation text. Never upload it or write it into the repository.
import { AI_PROVIDERS } from '../../../shared/constants';
import { providerInstanceName } from '../../../shared/providerInstances';
import { forwardText } from './machine';
import type { ChatLedRun, ForwardRecord } from './types';

type Locale = 'zh' | 'en';

const COPY: Record<Locale, {
  title: string;
  goal: string;
  coordinator: string;
  status: string;
  created: string;
  updated: string;
  round: string;
  roundTitle: string;
  roundLimit: string;
  summary: string;
  coordinatorReply: string;
  forward: string;
  message: string;
  reply: string;
  messageChars: string;
  replyChars: string;
  forwardStatus: string;
  started: string;
  finished: string;
  noReply: string;
  noTimeline: string;
  timeline: string;
  conversations: string;
  site: string;
  url: string;
  conversationTitle: string;
  registered: string;
  noConversations: string;
  closed: string;
  notRecorded: string;
}> = {
  zh: {
    title: 'Chat 主导运行记录',
    goal: '目标',
    coordinator: '协调者',
    status: '状态',
    created: '创建时间',
    updated: '更新时间',
    round: '已处理轮次',
    roundTitle: '轮次',
    roundLimit: '轮次上限',
    summary: '完成摘要',
    coordinatorReply: '协调者回复',
    forward: '转发',
    message: '完整 message',
    reply: '完整 reply',
    messageChars: 'message 字符数',
    replyChars: 'reply 字符数',
    forwardStatus: '转发状态',
    started: '开始时间',
    finished: '结束时间',
    noReply: '尚无完整回复',
    noTimeline: '没有可导出的时间线记录。',
    timeline: '转发时间线',
    conversations: '对话清单',
    site: '站点',
    url: '对话地址',
    conversationTitle: '标题',
    registered: '登记时间',
    noConversations: '本次运行没有登记对话。',
    closed: '闭合时间',
    notRecorded: '未记录',
  },
  en: {
    title: 'Chat-led Run Record',
    goal: 'Goal',
    coordinator: 'Coordinator',
    status: 'Status',
    created: 'Created',
    updated: 'Updated',
    round: 'Rounds processed',
    roundTitle: 'Round',
    roundLimit: 'Round limit',
    summary: 'Completion summary',
    coordinatorReply: 'Coordinator reply',
    forward: 'Forward',
    message: 'Complete message',
    reply: 'Complete reply',
    messageChars: 'Message characters',
    replyChars: 'Reply characters',
    forwardStatus: 'Forward status',
    started: 'Started',
    finished: 'Finished',
    noReply: 'No complete reply recorded',
    noTimeline: 'There are no timeline records to export.',
    timeline: 'Forwarding timeline',
    conversations: 'Conversation list',
    site: 'Provider',
    url: 'Conversation URL',
    conversationTitle: 'Title',
    registered: 'Registered',
    noConversations: 'No conversations were registered for this run.',
    closed: 'Closed',
    notRecorded: 'Not recorded',
  },
};

function isoTime(value: number | undefined, fallback: string): string {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function fencedText(value: string): string {
  const tick = String.fromCharCode(96);
  let currentRun = 0;
  let longestRun = 0;

  for (const character of value) {
    if (character === tick) {
      currentRun += 1;
      if (currentRun > longestRun) longestRun = currentRun;
    } else {
      currentRun = 0;
    }
  }

  const fence = tick.repeat(Math.max(3, longestRun + 1));
  const body = value.endsWith('\n') ? value : value + '\n';
  return fence + '\n' + body + fence;
}

function providerName(provider: ForwardRecord['to']): string {
  return providerInstanceName(provider, Object.fromEntries(Object.entries(AI_PROVIDERS).map(([key, value]) => [key, value.name])));
}

function formatForward(forward: ForwardRecord, copy: typeof COPY[Locale]): string[] {
  const reply = forward.reply === undefined ? copy.noReply : forward.reply;
  const replyChars = forward.replyChars ?? (forward.reply === undefined ? undefined : forward.reply.length);
  return [
    '#### ' + copy.forward + ': ' + providerName(forward.from) + ' → ' + providerName(forward.to),
    '',
    '- ' + copy.forwardStatus + ': ' + forward.status,
    '- ' + copy.messageChars + ': ' + String(forward.messageChars),
    '- ' + copy.replyChars + ': ' + (replyChars === undefined ? copy.notRecorded : String(replyChars)),
    '- ' + copy.started + ': ' + isoTime(forward.startedAt, copy.notRecorded),
    '- ' + copy.finished + ': ' + isoTime(forward.finishedAt, copy.notRecorded),
    '',
    '**' + copy.message + '**',
    '',
    fencedText(forwardText(forward)),
    '',
    '**' + copy.reply + '**',
    '',
    fencedText(reply),
    '',
  ];
}

export function exportRunMarkdown(run: ChatLedRun, locale: 'zh' | 'en'): string {
  const copy = COPY[locale];
  const lines = [
    '# ' + copy.title + ': ' + run.id,
    '',
    '## ' + copy.goal,
    '',
    fencedText(run.goal),
    '',
    '## ' + copy.coordinator,
    '',
    providerName(run.coordinator),
    '',
    '## ' + copy.status,
    '',
    '- ' + copy.status + ': ' + run.phase,
    '- ' + copy.created + ': ' + isoTime(run.createdAt, copy.notRecorded),
    '- ' + copy.updated + ': ' + isoTime(run.updatedAt, copy.notRecorded),
    '- ' + copy.round + ': ' + String(run.round),
    '- ' + copy.roundLimit + ': ' + String(run.roundLimit),
  ];

  if (run.doneSummary !== undefined) {
    lines.push('', '## ' + copy.summary, '', fencedText(run.doneSummary));
  }
  if (run.closed) {
    lines.push('', '- ' + copy.closed + ': ' + isoTime(run.closed.at, copy.notRecorded));
  }

  const rounds = new Set<number>();
  for (const reply of run.coordinatorReplies) rounds.add(reply.round);
  for (const forward of run.forwards) rounds.add(forward.round);
  const orderedRounds = Array.from(rounds).filter(Number.isFinite).sort((a, b) => a - b);

  lines.push('', '## ' + copy.timeline, '');
  if (orderedRounds.length === 0) {
    lines.push(copy.noTimeline, '');
  }

  for (const round of orderedRounds) {
    lines.push('### ' + copy.roundTitle + ' ' + String(round), '');

    const replies = run.coordinatorReplies.filter((reply) => reply.round === round);
    for (const reply of replies) {
      lines.push(
        '#### ' + copy.coordinatorReply + ' (' + isoTime(reply.at, copy.notRecorded) + ')',
        '',
        fencedText(reply.text),
        '',
      );
    }

    const forwards = run.forwards.filter((forward) => forward.round === round);
    for (const forward of forwards) {
      lines.push(...formatForward(forward, copy));
    }
  }

  lines.push('', '## ' + copy.conversations, '');
  if (run.conversations.length === 0) {
    lines.push(copy.noConversations, '');
  }

  for (const conversation of run.conversations) {
    lines.push(
      '### ' + copy.site + ': ' + providerName(conversation.provider),
      '',
      '- ' + copy.registered + ': ' + isoTime(conversation.registeredAt, copy.notRecorded),
    );
    if (conversation.title !== undefined) {
      lines.push('', '**' + copy.conversationTitle + '**', '', fencedText(conversation.title));
    }
    lines.push('', '**' + copy.url + '**', '', fencedText(conversation.url), '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

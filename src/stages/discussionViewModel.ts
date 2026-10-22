import { SKIP_RESPONSE } from '../workflow/state';
import { parseDeliberationAudit } from '../workflow/graph/deliberationAudit';
import {
  DELIBERATION_MAX_ROUNDS,
  hasDeliberationConsensus,
  parseDeliberationDecision,
} from '../workflow/graph/deliberationConsensus';

export type DiscussionTone = 'run' | 'done' | 'block' | 'paused' | 'unknown';
export type DiscussionParticipant = 'first' | 'second' | 'auditor';
export type DiscussionNodeStatus = 'pending' | 'running' | 'done' | 'timeout' | 'skipped' | 'error' | 'paused';
export type DiscussionOutputValue = string | { readonly text: string };
export type DiscussionOutputs =
  | Readonly<Record<string, DiscussionOutputValue | undefined>>
  | ReadonlyMap<string, DiscussionOutputValue>;

export interface DiscussionRunState {
  outputs: DiscussionOutputs;
  statusByNode?: Readonly<Record<string, DiscussionNodeStatus | undefined>>;
  timedOutNodeIds?: readonly string[];
  skippedNodeIds?: readonly string[];
  errorByNode?: Readonly<Record<string, string | boolean | undefined>>;
  activeNodeIds?: readonly string[];
}

export interface DiscussionCell {
  tone: DiscussionTone;
  summary: string;
  independent: boolean;
}

export interface DiscussionMatrixRow {
  id: string;
  label: string;
  kind: 'initial' | 'round' | 'audit-summary';
  cells: Record<DiscussionParticipant, DiscussionCell>;
}

export interface DiscussionMatrixModel {
  participants: readonly DiscussionParticipant[];
  rows: readonly DiscussionMatrixRow[];
}

export type DiscussionSummaryField =
  | { kind: 'value'; text: string }
  | { kind: 'missing' };

export type DiscussionConclusionBasis = 'model-agreement' | 'audit-confirmed' | 'unresolved';

export type DiscussionConclusion =
  | {
      kind: 'value';
      text: string;
      basis: DiscussionConclusionBasis;
      supporters: readonly string[];
    }
  | { kind: 'missing' };

export interface DiscussionSummaryModel {
  conclusion: DiscussionConclusion;
  disagreements: DiscussionSummaryField;
  evidenceGaps: DiscussionSummaryField;
  nextSteps: DiscussionSummaryField;
  disclaimer: string;
}

export interface DiscussionViewModel {
  matrix: DiscussionMatrixModel;
  summary: DiscussionSummaryModel;
}

interface RoundData {
  round: number;
  firstText?: string;
  secondText?: string;
  auditText?: string;
  firstDecision?: ReturnType<typeof parseDeliberationDecision>;
  secondDecision?: ReturnType<typeof parseDeliberationDecision>;
  auditDecision?: ReturnType<typeof parseDeliberationAudit>;
}

type AuditSectionName = 'disagreements' | 'evidenceGaps' | 'nextSteps';

const PARTICIPANTS: readonly DiscussionParticipant[] = ['first', 'second', 'auditor'];
export const DISCUSSION_OUTPUT_ORDER: readonly string[] = [
  'first',
  'second',
  'round1_first',
  'round1_second',
  'audit1',
  'round2_first',
  'round2_second',
  'audit2',
  'round3_first',
  'round3_second',
  'audit3',
];
const DISCLAIMER = 'AI 同意不等于事实已验证。';
const AUDIT_SECTION_PATTERNS: Record<AuditSectionName, RegExp> = {
  disagreements: /^(?:disagreements|分歧)$/i,
  evidenceGaps: /^(?:evidence\s+gaps|(?:证据|證據)(?:缺口|空白))$/i,
  nextSteps: /^(?:next\s+steps|下一步)$/i,
};
const ALL_AUDIT_HEADINGS = /^(?:evidence[\s-]*backed\s+findings|shared\s+conclusions|disagreements|evidence\s+gaps|next\s+steps|有(?:证据|證據)支持的(?:发现|發現)|共同(?:结论|結論)|分歧|(?:证据|證據)(?:缺口|空白)|下一步)$/i;

function readOutput(outputs: DiscussionOutputs, nodeId: string): string | undefined {
  const mapLike = outputs as ReadonlyMap<string, DiscussionOutputValue>;
  const value = typeof mapLike.get === 'function'
    ? mapLike.get(nodeId)
    : (outputs as Readonly<Record<string, DiscussionOutputValue | undefined>>)[nodeId];
  if (typeof value === 'string') return value;
  return value && typeof value.text === 'string' ? value.text : undefined;
}

function hasId(ids: readonly string[] | undefined, nodeId: string): boolean {
  return Boolean(ids?.includes(nodeId));
}

function statusFor(state: DiscussionRunState, nodeId: string): DiscussionTone {
  const output = readOutput(state.outputs, nodeId);
  const status = state.statusByNode?.[nodeId];
  if (state.errorByNode?.[nodeId] || status === 'error' || (output && /^(?:\[Error:|Error:)/i.test(output.trim()))) return 'block';
  if (hasId(state.timedOutNodeIds, nodeId) || status === 'timeout') return 'block';
  if (hasId(state.skippedNodeIds, nodeId) || status === 'skipped' || output === SKIP_RESPONSE) return 'paused';
  if (status === 'paused') return 'paused';
  if (hasId(state.activeNodeIds, nodeId) || status === 'running') return 'run';
  if ((output !== undefined && output.trim().length > 0) || status === 'done') return 'done';
  return 'unknown';
}

function nodeHasSignal(state: DiscussionRunState, nodeId: string): boolean {
  return readOutput(state.outputs, nodeId) !== undefined
    || state.statusByNode?.[nodeId] !== undefined
    || Boolean(state.errorByNode?.[nodeId])
    || hasId(state.timedOutNodeIds, nodeId)
    || hasId(state.skippedNodeIds, nodeId)
    || hasId(state.activeNodeIds, nodeId);
}

function baseCell(state: DiscussionRunState, nodeId: string, independent = false): DiscussionCell {
  const tone = statusFor(state, nodeId);
  let summary: string;
  if (tone === 'block') {
    summary = hasId(state.timedOutNodeIds, nodeId) || state.statusByNode?.[nodeId] === 'timeout'
      ? '等待超时，未收到可解析的输出。'
      : '执行出错，未能解析输出。';
  } else if (tone === 'paused') {
    summary = '环节已跳过或暂停，未形成可解析的输出。';
  } else if (tone === 'run') {
    summary = '环节进行中，尚未得到最终输出。';
  } else if (tone === 'done' && readOutput(state.outputs, nodeId)?.trim()) {
    summary = '已收到输出，正在检查结构化结论。';
  } else if (tone === 'done') {
    summary = '环节已完成，但输出缺失；未能解析摘要。';
  } else if (state.statusByNode?.[nodeId] === 'pending') {
    summary = '环节尚未开始。';
  } else {
    summary = '未能解析：尚无可用输出或状态。';
  }
  return { tone, summary, independent };
}

const INITIAL_SUMMARY_MAX = 120;

// D0 replies are free-form (the initial prompt asks for no decision block), so the cell shows the
// reply's own first line instead of reporting a missing block.
function initialCell(state: DiscussionRunState, nodeId: string): DiscussionCell {
  const cell = baseCell(state, nodeId, true);
  if (cell.tone !== 'done') return cell;
  const firstLine = readOutput(state.outputs, nodeId)?.split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s*/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/\*\*|__/g, ''))
    .find((line) => line.length > 0);
  if (!firstLine) return cell;
  const text = firstLine.length > INITIAL_SUMMARY_MAX ? firstLine.slice(0, INITIAL_SUMMARY_MAX) + '…' : firstLine;
  return { ...cell, summary: '独立回答：' + text };
}

function decisionCell(state: DiscussionRunState, nodeId: string, independent = false): DiscussionCell {
  const cell = baseCell(state, nodeId, independent);
  if (cell.tone !== 'done') return cell;
  const text = readOutput(state.outputs, nodeId);
  const decision = text ? parseDeliberationDecision(text) : undefined;
  if (!decision) {
    return {
      ...cell,
      summary: '未能解析：没有找到完整的 AI_ONE_DECISION、AI_ONE_PROPOSAL 与 AI_ONE_OPEN_ISSUES 决议块。',
    };
  }
  const stance = decision.status === 'AGREE' ? '支持当前方案' : '建议修改方案';
  const issues = decision.openIssues.toUpperCase() === 'NONE' ? '未声明其他未解决问题' : '仍有问题：' + decision.openIssues;
  return { ...cell, summary: stance + '；提议：' + decision.proposal + '；' + issues + '。' };
}

function auditCell(state: DiscussionRunState, nodeId: string): DiscussionCell {
  const cell = baseCell(state, nodeId);
  if (cell.tone !== 'done') return cell;
  const text = readOutput(state.outputs, nodeId);
  const audit = text ? parseDeliberationAudit(text) : undefined;
  if (!audit) {
    return {
      ...cell,
      summary: '未能解析：没有找到完整的 AI_ONE_AUDIT_DECISION、AI_ONE_AUDIT_RESULT 与 AI_ONE_AUDIT_QUESTION 审计脚注。',
    };
  }
  const action = audit.decision === 'CONTINUE' ? '建议继续讨论' : '建议结束讨论';
  const result = audit.result === 'AGREED' ? '审计模型报告 AGREED' : '审计模型报告 DISAGREEMENTS';
  const question = audit.decision === 'CONTINUE' ? '；要求补充：' + audit.question : '';
  return { ...cell, summary: action + '；' + result + question + '。' };
}

function auditSummaryCell(state: DiscussionRunState, rounds: readonly RoundData[]): DiscussionCell {
  let latestRoundWithSignal: number | undefined;
  let latestNodeId: string | undefined;
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const nodeId = 'audit' + rounds[index].round;
    if (nodeHasSignal(state, nodeId)) {
      latestRoundWithSignal = rounds[index].round;
      latestNodeId = nodeId;
      break;
    }
  }
  if (!latestNodeId || latestRoundWithSignal === undefined) {
    return { tone: 'unknown', summary: '未能解析：没有可用的独立审计记录。', independent: false };
  }
  const latestCell = auditCell(state, latestNodeId);
  const parsed = rounds.filter((round) => round.auditDecision !== undefined);
  if (parsed.length === 0) return latestCell;
  const decisions = parsed.map((round) => {
    const audit = round.auditDecision;
    if (!audit) return '';
    const action = audit.decision === 'CONTINUE' ? '继续' : '结束';
    return '第' + round.round + '轮' + action + '（' + audit.result + '）';
  });
  const lastParsed = parsed[parsed.length - 1];
  const staleSuffix = lastParsed.round < latestRoundWithSignal
    ? '；第' + latestRoundWithSignal + '轮审计未能解析或尚未完成'
    : '';
  return {
    tone: latestCell.tone,
    independent: false,
    summary: '审计记录：' + decisions.join('；') + staleSuffix + '。',
  };
}

function missingField(): DiscussionSummaryField {
  return { kind: 'missing' };
}

function valueField(text: string | undefined): DiscussionSummaryField {
  return text && text.trim() ? { kind: 'value', text: text.trim() } : missingField();
}

function parseReportSection(text: string, section: AuditSectionName): string | undefined {
  const lines = text.split(/\r?\n/);
  let fence: { char: string; length: number } | undefined;
  let collecting = false;
  let found = false;
  const content: string[] = [];
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker) {
      const char = marker[1][0];
      if (!fence) fence = { char, length: marker[1].length };
      else if (char === fence.char && marker[1].length >= fence.length && /^\s*[`~]+\s*$/.test(line)) fence = undefined;
      continue;
    }
    if (fence) continue;
    const withoutMarkdown = line.trim().replace(/^#{1,6}\s*/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, '');
    const heading = /^(?:\*\*|__)?(Evidence-backed findings|Shared conclusions|Disagreements|Evidence gaps|Next steps|有证据支持的发现|有證據支持的發現|共同结论|共同結論|分歧|证据缺口|證據缺口|证据空白|證據空白|下一步)(?:\*\*|__)?\s*(?::|：)?\s*(.*)$/i.exec(withoutMarkdown);
    if (!heading) {
      if (collecting) content.push(line);
      continue;
    }
    const headingName = heading[1].trim();
    const isTarget = AUDIT_SECTION_PATTERNS[section].test(headingName);
    if (collecting && ALL_AUDIT_HEADINGS.test(headingName)) break;
    if (isTarget) {
      found = true;
      collecting = true;
      if (heading[2]) content.push(heading[2]);
    } else if (found) {
      break;
    }
  }
  const result = content.join('\n')
    .replace(/\x60?\[\[\s*AI_ONE_AUDIT_[A-Z_]+\s*:[^\]\n]*\]\]\x60?/gi, '')
    .trim();
  return found && result ? result : undefined;
}

// Only a node that finished cleanly may feed decisions and the summary; the output of a timed-out,
// skipped or failed node is shown as such in the matrix and never used as a conclusion.
function usableOutput(state: DiscussionRunState, nodeId: string): string | undefined {
  return statusFor(state, nodeId) === 'done' ? readOutput(state.outputs, nodeId) : undefined;
}

function getRounds(state: DiscussionRunState): RoundData[] {
  const rounds: RoundData[] = [];
  for (let round = 1; round <= DELIBERATION_MAX_ROUNDS; round += 1) {
    const firstText = usableOutput(state, 'round' + round + '_first');
    const secondText = usableOutput(state, 'round' + round + '_second');
    const auditText = usableOutput(state, 'audit' + round);
    rounds.push({
      round,
      firstText,
      secondText,
      auditText,
      firstDecision: firstText ? parseDeliberationDecision(firstText) : undefined,
      secondDecision: secondText ? parseDeliberationDecision(secondText) : undefined,
      auditDecision: auditText ? parseDeliberationAudit(auditText) : undefined,
    });
  }
  return rounds;
}

function buildSummary(state: DiscussionRunState, rounds: readonly RoundData[]): DiscussionSummaryModel {
  let lastPair: RoundData | undefined;
  for (const round of rounds) {
    if (round.firstText !== undefined || round.secondText !== undefined
      || nodeHasSignal(state, 'round' + round.round + '_first')
      || nodeHasSignal(state, 'round' + round.round + '_second')) {
      lastPair = round;
    }
  }
  const anyOutputOrSignal = DISCUSSION_OUTPUT_ORDER.some((nodeId) => nodeHasSignal(state, nodeId));
  let conclusion: DiscussionConclusion;
  if (!anyOutputOrSignal) {
    conclusion = { kind: 'missing' };
  } else if (!lastPair) {
    conclusion = {
      kind: 'value',
      basis: 'unresolved',
      supporters: [],
      text: '未能解析：缺少双方可比较的结构化决议。',
    };
  } else {
    const first = lastPair.firstDecision;
    const second = lastPair.secondDecision;
    const sameProposal = Boolean(
      lastPair.firstText && lastPair.secondText
      && hasDeliberationConsensus(lastPair.firstText, lastPair.secondText),
    );
    const audit = lastPair.auditDecision;
    if (audit?.decision === 'FINISH' && audit.result === 'AGREED') {
      conclusion = {
        kind: 'value',
        basis: 'audit-confirmed',
        supporters: sameProposal ? ['first', 'second', 'auditor'] : ['auditor'],
        text: sameProposal
          ? '第' + lastPair.round + '轮双方提出相同方案，审计模型的最终结果为 AGREED。'
          : '第' + lastPair.round + '轮审计模型的最终结果为 AGREED，但双方决议未能证明为同一方案，仍需人工复核。',
      };
    } else if (sameProposal) {
      conclusion = {
        kind: 'value',
        basis: 'model-agreement',
        supporters: ['first', 'second'],
        text: '第' + lastPair.round + '轮 first 与 second 独立接受了相同方案。',
      };
    } else {
      const supporters: string[] = [];
      if (first?.status === 'AGREE') supporters.push('first');
      if (second?.status === 'AGREE') supporters.push('second');
      conclusion = {
        kind: 'value',
        basis: 'unresolved',
        supporters,
        text: first && second
          ? '第' + lastPair.round + '轮双方的结构化决议未形成收敛结论。'
          : '未能解析：缺少双方完整的结构化决议块，不能判断是否收敛。',
      };
    }
  }

  let latestValidAudit: RoundData | undefined;
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    if (rounds[index].auditDecision && rounds[index].auditText) {
      latestValidAudit = rounds[index];
      break;
    }
  }
  const latestReport = latestValidAudit?.auditText;
  const disagreementReport = latestReport ? parseReportSection(latestReport, 'disagreements') : undefined;
  const gapsReport = latestReport ? parseReportSection(latestReport, 'evidenceGaps') : undefined;
  let disagreements = valueField(disagreementReport);
  if (disagreements.kind === 'missing' && lastPair?.firstDecision && lastPair.secondDecision) {
    const issues = [
      lastPair.firstDecision.openIssues.toUpperCase() === 'NONE' ? undefined : 'first：' + lastPair.firstDecision.openIssues,
      lastPair.secondDecision.openIssues.toUpperCase() === 'NONE' ? undefined : 'second：' + lastPair.secondDecision.openIssues,
    ].filter((item): item is string => Boolean(item));
    const consensus = Boolean(lastPair.firstText && lastPair.secondText
      && hasDeliberationConsensus(lastPair.firstText, lastPair.secondText));
    disagreements = valueField(issues.length > 0
      ? issues.join('；')
      : (consensus ? '双方均声明没有未解决问题。' : '决议未收敛，且审计报告缺少分歧段，无法确定具体分歧。'));
  }

  let nextStepsText = latestReport ? parseReportSection(latestReport, 'nextSteps') : undefined;
  if (!nextStepsText && latestValidAudit?.auditDecision?.decision === 'CONTINUE') {
    nextStepsText = '审计模型要求继续：' + latestValidAudit.auditDecision.question;
  }

  return {
    conclusion,
    disagreements,
    evidenceGaps: valueField(gapsReport),
    nextSteps: valueField(nextStepsText),
    disclaimer: DISCLAIMER,
  };
}

export function buildDiscussionViewModel(state: DiscussionRunState): DiscussionViewModel {
  const rounds = getRounds(state);
  const rows: DiscussionMatrixRow[] = [
    {
      id: 'initial',
      label: '独立初评（D0）',
      kind: 'initial',
      cells: {
        first: initialCell(state, 'first'),
        second: initialCell(state, 'second'),
        auditor: {
          tone: 'unknown',
          summary: 'D0 不包含审计环节；独立审计在每轮交换后执行。',
          independent: false,
        },
      },
    },
  ];
  for (const round of rounds) {
    rows.push({
      id: 'round-' + round.round,
      label: '第 ' + round.round + ' 轮',
      kind: 'round',
      cells: {
        first: decisionCell(state, 'round' + round.round + '_first'),
        second: decisionCell(state, 'round' + round.round + '_second'),
        auditor: auditCell(state, 'audit' + round.round),
      },
    });
  }
  rows.push({
    id: 'audit-summary',
    label: '独立审计（汇总）',
    kind: 'audit-summary',
    cells: {
      first: {
        tone: 'unknown',
        summary: '此行仅汇总独立审计；参与者决议请查看 D0 与各轮。',
        independent: false,
      },
      second: {
        tone: 'unknown',
        summary: '此行仅汇总独立审计；参与者决议请查看 D0 与各轮。',
        independent: false,
      },
      auditor: auditSummaryCell(state, rounds),
    },
  });
  return {
    matrix: { participants: PARTICIPANTS, rows },
    summary: buildSummary(state, rounds),
  };
}

export function createDiscussionRunStateFromOutputs(outputs: readonly string[]): DiscussionRunState {
  if (outputs.length > DISCUSSION_OUTPUT_ORDER.length) {
    throw new RangeError('讨论输出数组最多支持 ' + DISCUSSION_OUTPUT_ORDER.length + ' 项。');
  }
  const mapped: Record<string, string> = {};
  const statusByNode: Record<string, DiscussionNodeStatus> = {};
  outputs.forEach((text, index) => {
    const nodeId = DISCUSSION_OUTPUT_ORDER[index];
    mapped[nodeId] = text;
    statusByNode[nodeId] = text === SKIP_RESPONSE
      ? 'skipped'
      : (/^(?:\[Error:|Error:)/i.test(text.trim()) ? 'error' : (text.trim() ? 'done' : 'pending'));
  });
  return { outputs: mapped, statusByNode };
}

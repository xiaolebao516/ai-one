import type { I18nKey } from '../../i18n/keys';
import type { Locale } from '../../i18n/resolve';
import { formatI18n, t } from '../../i18n/t';
import { SKIP_RESPONSE } from '../state';

export const DELIBERATION_MAX_ROUNDS = 3;

export interface DeliberationAudit {
  decision: 'CONTINUE' | 'FINISH';
  result: 'AGREED' | 'DISAGREEMENTS';
  question: string;
}

/** Parse only a final, complete audit footer. Markdown DOM may turn lines into paragraphs,
 * plain spaces, inline formatting or a fenced code block; none of those should change a decision.
 */
const AUDIT_FOOTER = /(?:^|[\s\x60* >-])\[\[\s*AI_ONE_AUDIT_DECISION\s*:\s*(CONTINUE|FINISH)\s*\]\][\s\x60* >-]*\[\[\s*AI_ONE_AUDIT_RESULT\s*:\s*(AGREED|DISAGREEMENTS)\s*\]\][\s\x60* >-]*\[\[\s*AI_ONE_AUDIT_QUESTION\s*:\s*([^\]\r\n]{1,320}?)\s*\]\][\s\x60* >-]*$/i;

export function parseDeliberationAudit(text: string): DeliberationAudit | undefined {
  const source = text.trim();
  if (!source || source === SKIP_RESPONSE || /^\[Error:|^Error:/i.test(source)) return undefined;
  const match = AUDIT_FOOTER.exec(source);
  if (!match || match.index < 20) return undefined;
  const question = match[3].trim();
  const decision = match[1].toUpperCase() as DeliberationAudit['decision'];
  if (decision === 'CONTINUE' && (question.length < 8 || /^NONE$/i.test(question))) return undefined;
  if (decision === 'FINISH' && !/^NONE$/i.test(question)) return undefined;
  return { decision, result: match[2].toUpperCase() as DeliberationAudit['result'], question };
}

export function auditRequestsContinuation(text: string): boolean {
  return parseDeliberationAudit(text)?.decision === 'CONTINUE';
}

/** The five headings the audit prompt asks for, in order, with the localized report label for each. */
const REPORT_SECTIONS: readonly { pattern: string; label: I18nKey }[] = [
  { pattern: 'evidence[\\s-]*backed\\s+findings', label: 'deliberationReport.sectionFindings' },
  { pattern: 'shared\\s+conclusions', label: 'deliberationReport.sectionShared' },
  { pattern: 'disagreements', label: 'deliberationReport.sectionDisagreements' },
  { pattern: 'evidence\\s+gaps', label: 'deliberationReport.sectionGaps' },
  { pattern: 'next\\s+steps', label: 'deliberationReport.sectionNext' },
];
/** Fewer recognized headings than this means the audit ignored the format; show it as-is instead. */
const MIN_REPORT_SECTIONS = 3;

const CONTROL_TAG = /`?\[\[\s*AI_ONE_AUDIT_[A-Z_]+\s*:[^\]\n]*\]\]`?/gi;

// A heading may carry Markdown heading, list or bold markers (as the WebView serializer emits them)
// and ends with a colon or its line. Line headings must start a line; inline ones may also follow
// sentence punctuation, which is only trusted when nothing better is available.
function sectionHeading(pattern: string, inline: boolean): RegExp {
  return new RegExp(
    (inline ? '(?:^|(?<=[\\n.。;；!?！？]))' : '(?:^|(?<=\\n))') +
      '[\\t ]*(#{1,6}[\\t ]*)?((?:[-*+]|\\d+[.)])[\\t ]+)?(\\*\\*|__)?[\\t ]*(?:' + pattern + ')' +
      '[\\t ]*(?:\\*\\*|__)?[\\t ]*(?:[:：][\\t ]*(?:\\*\\*|__)?|(?=\\n)|$)',
    'gi',
  );
}

/** Blank out fenced code (keeping offsets and line breaks) so example headings inside it are ignored. */
function maskFencedCode(text: string): string {
  let fence: string | undefined;
  return text.split('\n').map((line) => {
    const marker = /^[\t ]*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      return ' '.repeat(line.length);
    }
    if (marker) {
      fence = marker;
      return ' '.repeat(line.length);
    }
    return line;
  }).join('\n');
}

/** The audit text before its control tags, without the code fence that may have wrapped them. */
function auditBody(text: string): string {
  const source = text.trim();
  const match = AUDIT_FOOTER.exec(source);
  const body = match ? source.slice(0, match.index) : source;
  return body.replace(/(?:^|\n)[\t ]*`{3,}[\w-]*[\t ]*$/, '').replace(/\n+[\t ]*(?:-{3,}|\*{3,})[\t ]*$/, '').trim();
}

type SectionMatch = { label: I18nKey; start: number; end: number };

/** Picks one heading per section, or undefined when the headings are too few, ambiguous or out of order. */
function pickSections(masked: string, inline: boolean): SectionMatch[] | undefined {
  const found: SectionMatch[] = [];
  for (const section of REPORT_SECTIONS) {
    const candidates = [...masked.matchAll(sectionHeading(section.pattern, inline))].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      // A Markdown heading beats a bold or list heading, which beats a plain "Heading:" line.
      strength: match[1] ? 3 : match[2] || match[3] ? 2 : 1,
    }));
    if (candidates.length === 0) continue;
    const best = Math.max(...candidates.map((candidate) => candidate.strength));
    const strongest = candidates.filter((candidate) => candidate.strength === best);
    if (strongest.length > 1 || (inline && candidates.length > 1)) return undefined;
    found.push({ label: section.label, start: strongest[0].start, end: strongest[0].end });
  }
  if (found.length < MIN_REPORT_SECTIONS) return undefined;
  return found.every((section, index) => index === 0 || section.start >= found[index - 1].end) ? found : undefined;
}

/**
 * Line headings may leave sections that the audit wrote inline (e.g. "A. Shared conclusions: B.").
 * Look for each missing one only in the gap between its found neighbours, and only on the same line
 * as the previous heading when that heading is itself followed by text ("Heading: text"); a heading
 * name mentioned in prose under a standalone heading stays prose. One candidate fills the section,
 * several make the structure ambiguous, none leaves it genuinely missing.
 */
function fillInlineGaps(masked: string, found: SectionMatch[]): SectionMatch[] | undefined {
  const order = (label: I18nKey) => REPORT_SECTIONS.findIndex((section) => section.label === label);
  const result = [...found];
  for (const [index, section] of REPORT_SECTIONS.entries()) {
    if (result.some((match) => match.label === section.label)) continue;
    const before = result.filter((match) => order(match.label) < index).at(-1);
    const after = result.find((match) => order(match.label) > index);
    if (!before) continue;
    const lineEnd = masked.indexOf('\n', before.end);
    const inlineRunEnd = Math.min(lineEnd < 0 ? masked.length : lineEnd, after?.start ?? masked.length);
    if (!masked.slice(before.end, inlineRunEnd).trim()) continue;
    const candidates = [...masked.matchAll(sectionHeading(section.pattern, true))]
      .filter((match) => match.index >= before.end && match.index + match[0].length <= inlineRunEnd);
    if (candidates.length > 1) return undefined;
    if (candidates.length === 1) {
      const start = candidates[0].index;
      result.splice(after ? result.indexOf(after) : result.length, 0,
        { label: section.label, start, end: start + candidates[0][0].length });
    }
  }
  return result;
}

function auditSections(body: string): { label: I18nKey; content: string | undefined }[] | undefined {
  const masked = maskFencedCode(body);
  const lineSections = pickSections(masked, false);
  const found = lineSections ? fillInlineGaps(masked, lineSections) : pickSections(masked, true);
  if (!found) return undefined;
  return REPORT_SECTIONS.map(({ label }) => {
    const index = found.findIndex((section) => section.label === label);
    if (index < 0) return { label, content: undefined };
    const content = body.slice(found[index].end, found[index + 1]?.start ?? body.length)
      .replace(CONTROL_TAG, '').replace(/^[\s:：]+/, '').replace(/\n+[\t ]*(?:-{3,}|\*{3,})[\t ]*$/, '').trim();
    return { label, content };
  });
}

function sectionText(content: string | undefined, locale: Locale): string {
  if (!content) return t('deliberationReport.sectionMissing', locale);
  return /^(?:none|n\/a|无|無|なし|keine)[.。]?$/i.test(content) ? t('deliberationReport.none', locale) : content;
}

export function deliberationAuditReport(
  rounds: readonly { round: number; first: string; second: string; auditor: string }[],
  getOutput: (nodeId: string) => string | undefined,
  locale: Locale = 'en',
): string {
  const complete = rounds.filter(({ first, second, auditor }) =>
    getOutput(first) !== undefined && getOutput(second) !== undefined && getOutput(auditor) !== undefined);
  const last = complete.at(-1);
  const incomplete = (token: string, reason: string) =>
    '## ' + t('deliberationReport.titleIncomplete', locale) + '\n\n`' + token + '`\n\n' + reason;
  if (!last) return incomplete('INCOMPLETE_BLOCKED', t('deliberationReport.incompleteNoAudit', locale));
  const auditText = getOutput(last.auditor) ?? '';
  const decision = parseDeliberationAudit(auditText);
  if (!decision) {
    return incomplete('INCOMPLETE_BLOCKED (round ' + last.round + ')',
      formatI18n(t('deliberationReport.incompleteUnparseable', locale), { round: last.round }));
  }

  const status = decision.result === 'AGREED' ? 'COMPLETE_AGREED' : 'COMPLETE_WITH_DISAGREEMENTS';
  const exhausted = last.round === DELIBERATION_MAX_ROUNDS;
  const title = t(decision.result === 'AGREED' ? 'deliberationReport.titleAgreed' : 'deliberationReport.titleDisagreements', locale) +
    (exhausted ? formatI18n(t('deliberationReport.budgetExhausted', locale), { max: DELIBERATION_MAX_ROUNDS }) : '');
  // Kept verbatim so the terminal state stays machine-readable in every language.
  const token = status + ' (round ' + last.round + ' of ' + DELIBERATION_MAX_ROUNDS + ')' + (exhausted ? ' (round budget exhausted)' : '');
  const steps = [t('deliberationReport.processOpening', locale)];
  for (const { round, auditor } of complete) {
    const audit = parseDeliberationAudit(getOutput(auditor) ?? '');
    steps.push(formatI18n(t('deliberationReport.processRound', locale), { round }));
    steps.push(audit?.decision === 'CONTINUE'
      ? formatI18n(t('deliberationReport.processContinue', locale), { question: audit.question })
      : t('deliberationReport.processFinish', locale));
  }

  const body = auditBody(auditText);
  const sections = auditSections(body);
  const parts = [
    '## ' + title,
    '`' + token + '`',
    formatI18n(t('deliberationReport.process', locale), { steps: steps.join(' → ') }),
  ];
  if (sections) {
    parts.push('> ' + t('deliberationReport.disclaimer', locale));
    for (const { label, content } of sections) parts.push('### ' + t(label, locale), sectionText(content, locale));
  } else {
    parts.push('> ' + t('deliberationReport.unstructured', locale) + ' ' + t('deliberationReport.disclaimer', locale),
      body.replace(CONTROL_TAG, '').trim());
  }
  return parts.join('\n\n');
}

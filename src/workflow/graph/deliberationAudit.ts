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

export function deliberationAuditReport(
  rounds: readonly { round: number; first: string; second: string; auditor: string }[],
  getOutput: (nodeId: string) => string | undefined,
): string {
  const complete = rounds.filter(({ first, second, auditor }) =>
    getOutput(first) !== undefined && getOutput(second) !== undefined && getOutput(auditor) !== undefined);
  const last = complete.at(-1);
  if (!last) return 'INCOMPLETE_BLOCKED: No round with an independent third-party audit was completed.';
  const auditText = getOutput(last.auditor) ?? '';
  const decision = parseDeliberationAudit(auditText);
  if (!decision) {
    return 'INCOMPLETE_BLOCKED (round ' + last.round + '): Independent auditor response was not a complete parseable audit. ' +
      'Inspect the auditor reply; do not assume agreement or successful completion.';
  }
  const status = decision.result === 'AGREED' ? 'COMPLETE_AGREED' : 'COMPLETE_WITH_DISAGREEMENTS';
  const limit = last.round === DELIBERATION_MAX_ROUNDS ? ' (round budget exhausted)' : '';
  return status + ' (round ' + last.round + ' of ' + DELIBERATION_MAX_ROUNDS + ')' + limit +
    '\n\nIndependent third-party audit (model assessment, not independently verified facts):\n\n' +
    auditText + '\n\nVerify primary sources before relying on the findings.';
}

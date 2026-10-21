/**
 * A valid pair of matching status blocks is a *reported* consensus, not a factual
 * verification. Unparseable or conflicting decisions never end deliberation early.
 */
export interface DeliberationDecision {
  status: 'AGREE' | 'REVISE';
  proposal: string;
  openIssues: string;
}

export const DELIBERATION_MAX_ROUNDS = 3;
const DECISION_BLOCK = /(?:^|\n)\[\[AI_ONE_DECISION:(AGREE|REVISE)\]\]\r?\n\[\[AI_ONE_PROPOSAL:([^\r\n]{12,240})\]\]\r?\n\[\[AI_ONE_OPEN_ISSUES:([^\r\n]{2,240})\]\]\s*$/;

export function parseDeliberationDecision(text: string): DeliberationDecision | undefined {
  const match = DECISION_BLOCK.exec(text.trim());
  if (!match) return undefined;
  const proposal = match[2].trim();
  const openIssues = match[3].trim();
  if (!proposal || !openIssues) return undefined;
  return { status: match[1] as DeliberationDecision['status'], proposal, openIssues };
}

function normalizeProposal(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function hasDeliberationConsensus(first: string, second: string): boolean {
  const left = parseDeliberationDecision(first);
  const right = parseDeliberationDecision(second);
  return Boolean(
    left && right &&
    left.status === 'AGREE' && right.status === 'AGREE' &&
    left.openIssues.toUpperCase() === 'NONE' &&
    right.openIssues.toUpperCase() === 'NONE' &&
    normalizeProposal(left.proposal) === normalizeProposal(right.proposal),
  );
}

export function deliberationReport(
  rounds: readonly { round: number; first: string; second: string }[],
  getOutput: (nodeId: string) => string | undefined,
): string {
  const completed = rounds.filter(({ first, second }) => getOutput(first) !== undefined && getOutput(second) !== undefined);
  const last = completed.at(-1);
  if (!last) return 'UNRESOLVED: No complete discussion round was recorded.';
  const first = getOutput(last.first) ?? '';
  const second = getOutput(last.second) ?? '';
  if (hasDeliberationConsensus(first, second)) {
    const proposal = parseDeliberationDecision(first)?.proposal ?? '';
    return 'CONVERGED (round ' + last.round + '): Both participants independently accepted the same proposal.\n\nProposal: ' + proposal + '\n\nModel agreement does not independently verify the proposal.';
  }
  const issue = (text: string, name: string) => {
    const decision = parseDeliberationDecision(text);
    return name + ': ' + (decision?.openIssues && decision.openIssues.toUpperCase() !== 'NONE'
      ? decision.openIssues : 'No parseable open-issues statement; inspect the full reply.');
  };
  return 'UNRESOLVED (MAX_ROUNDS=' + DELIBERATION_MAX_ROUNDS + ', last round=' + last.round + '): The participants did not independently confirm an identical proposal.\n\nRemaining disagreements:\n' +
    issue(first, 'First') + '\n' + issue(second, 'Second') +
    '\n\nThe full discussion is shown above. Do not treat this result as a passed independent audit.';
}

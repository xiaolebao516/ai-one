import { describe, expect, it } from 'vitest';
import {
  deliberationReport,
  hasDeliberationConsensus,
  parseDeliberationDecision,
} from '../workflow/graph/deliberationConsensus';

function verdict(status: 'AGREE' | 'REVISE', proposal: string, issues = 'NONE'): string {
  return [
    'Independent technical reasoning.',
    '[[AI_ONE_DECISION:' + status + ']]',
    '[[AI_ONE_PROPOSAL:' + proposal + ']]',
    '[[AI_ONE_OPEN_ISSUES:' + issues + ']]',
  ].join('\n');
}

describe('deliberation consensus is fail-closed', () => {
  const proposal = 'Use one verified issue and a bounded round count.';

  it('accepts two matching explicit approvals of the same proposal', () => {
    expect(hasDeliberationConsensus(verdict('AGREE', proposal), verdict('AGREE', proposal))).toBe(true);
  });

  it('does not accept one-sided agreement, unresolved blockers, or conflicting proposals', () => {
    expect(hasDeliberationConsensus(verdict('AGREE', proposal), verdict('REVISE', proposal, 'Needs evidence'))).toBe(false);
    expect(hasDeliberationConsensus(verdict('AGREE', proposal), verdict('AGREE', proposal, 'Need proof'))).toBe(false);
    expect(hasDeliberationConsensus(verdict('AGREE', proposal), verdict('AGREE', 'Use a different unverified plan.'))).toBe(false);
  });

  it('rejects missing tags, code-fenced tags, embedded tags, and ambiguous state', () => {
    expect(parseDeliberationDecision('The final answer has no tags')).toBeUndefined();
    expect(parseDeliberationDecision(verdict('AGREE', proposal) + '\nMore words')).toBeUndefined();
    expect(parseDeliberationDecision('\`\`\`\n' + verdict('AGREE', proposal) + '\n\`\`\`')).toBeUndefined();
    expect(hasDeliberationConsensus('', verdict('AGREE', proposal))).toBe(false);
    expect(hasDeliberationConsensus('[Error: timeout]', verdict('AGREE', proposal))).toBe(false);
  });

  it('reports the exact end state without calling model agreement an independent audit', () => {
    const entries = new Map([
      ['round1_first', verdict('AGREE', proposal)],
      ['round1_second', verdict('AGREE', proposal)],
    ]);
    const report = deliberationReport([{ round: 1, first: 'round1_first', second: 'round1_second' }], (id) => entries.get(id));
    expect(report).toContain('CONVERGED (round 1)');
    expect(report).toContain('does not independently verify');
  });
});

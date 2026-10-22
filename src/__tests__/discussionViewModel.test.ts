import { describe, expect, it } from 'vitest';
import { buildDiscussionViewModel, type DiscussionRunState } from '../stages/discussionViewModel';

function decision(status: 'AGREE' | 'REVISE', proposal: string, issues: string): string {
  return 'Reply body with enough context to be a valid deliberation result.\n\n'
    + '[[AI_ONE_DECISION:' + status + ']]\n'
    + '[[AI_ONE_PROPOSAL:' + proposal + ']]\n'
    + '[[AI_ONE_OPEN_ISSUES:' + issues + ']]';
}

function audit(decisionValue: 'CONTINUE' | 'FINISH', result: 'AGREED' | 'DISAGREEMENTS', question: string): string {
  return 'The auditor reviewed both participants and the available evidence.\n\n'
    + '## Evidence-backed findings\nBoth participants supplied a structured proposal.\n\n'
    + '## Shared conclusions\nThe scope is clear.\n\n'
    + '## Disagreements\nNo unresolved disagreement was identified.\n\n'
    + '## Evidence gaps\nExternal test evidence is still missing.\n\n'
    + '## Next steps\nRun an independent test and preserve the output.\n\n'
    + '[[AI_ONE_AUDIT_DECISION:' + decisionValue + ']]\n'
    + '[[AI_ONE_AUDIT_RESULT:' + result + ']]\n'
    + '[[AI_ONE_AUDIT_QUESTION:' + question + ']]';
}

function state(overrides: Partial<DiscussionRunState> = {}): DiscussionRunState {
  return { outputs: {}, ...overrides };
}

describe('discussion view model', () => {
  it('summarizes a free-form D0 reply by its first line, stripped of Markdown and truncated', () => {
    const long = 'x'.repeat(200);
    const model = buildDiscussionViewModel({
      outputs: { first: '\n## **Short answer**\nbody', second: long },
      statusByNode: { first: 'done', second: 'done' },
    });
    expect(model.matrix.rows[0].cells.first.summary).toBe('独立回答：Short answer');
    expect(model.matrix.rows[0].cells.second.summary).toBe('独立回答：' + 'x'.repeat(120) + '…');
  });

  it('maps D0, all three rounds, and the audit summary without changing the graph', () => {
    const outputs: Record<string, string> = {
      first: 'Independent initial thought from first.',
      second: 'Independent initial thought from second.',
    };
    const statuses: Record<string, 'done'> = { first: 'done', second: 'done' };
    for (const round of [1, 2, 3]) {
      outputs['round' + round + '_first'] = decision('AGREE', 'Use an explicit typed discussion state model', 'NONE');
      outputs['round' + round + '_second'] = decision('AGREE', 'Use an explicit typed discussion state model', 'NONE');
      outputs['audit' + round] = audit(round === 3 ? 'FINISH' : 'CONTINUE', round === 3 ? 'AGREED' : 'DISAGREEMENTS', round === 3 ? 'NONE' : 'Please provide independent test evidence');
      statuses['round' + round + '_first'] = 'done';
      statuses['round' + round + '_second'] = 'done';
      statuses['audit' + round] = 'done';
    }
    const model = buildDiscussionViewModel(state({ outputs, statusByNode: statuses }));
    expect(model.matrix.rows.map((row) => row.id)).toEqual(['initial', 'round-1', 'round-2', 'round-3', 'audit-summary']);
    expect(model.matrix.rows[0].cells.first.independent).toBe(true);
    expect(model.matrix.rows[0].cells.first.summary).toBe('独立回答：Independent initial thought from first.');
    expect(model.matrix.rows[1].cells.first.summary).toContain('Use an explicit typed discussion state model');
    expect(model.matrix.rows[1].cells.auditor.summary).toContain('建议继续讨论');
    expect(model.matrix.rows[4].cells.auditor.summary).toContain('第3轮结束（AGREED）');
    expect(model.summary.conclusion.kind).toBe('value');
    if (model.summary.conclusion.kind === 'value') {
      expect(model.summary.conclusion.basis).toBe('audit-confirmed');
      expect(model.summary.conclusion.supporters).toEqual(['first', 'second', 'auditor']);
    }
    expect(model.summary.evidenceGaps).toEqual({ kind: 'value', text: 'External test evidence is still missing.' });
    expect(model.summary.nextSteps).toEqual({ kind: 'value', text: 'Run an independent test and preserve the output.' });
    expect(model.summary.disclaimer).toBe('AI 同意不等于事实已验证。');
  });

  it('uses block for timeouts and paused for skipped nodes', () => {
    const model = buildDiscussionViewModel(state({
      outputs: {},
      statusByNode: { round1_first: 'timeout', round1_second: 'skipped', audit1: 'skipped' },
      timedOutNodeIds: ['round1_first'],
      skippedNodeIds: ['round1_second', 'audit1'],
    }));
    expect(model.matrix.rows[1].cells.first.tone).toBe('block');
    expect(model.matrix.rows[1].cells.first.summary).toContain('超时');
    expect(model.matrix.rows[1].cells.second.tone).toBe('paused');
    expect(model.matrix.rows[1].cells.auditor.tone).toBe('paused');
  });

  it('keeps missing audit evidence explicit rather than inventing a gap or next step', () => {
    const outputs = {
      round1_first: decision('AGREE', 'Use an explicit typed discussion state model', 'NONE'),
      round1_second: decision('AGREE', 'Use an explicit typed discussion state model', 'NONE'),
    };
    const model = buildDiscussionViewModel(state({ outputs }));
    expect(model.summary.conclusion.kind).toBe('value');
    expect(model.summary.evidenceGaps).toEqual({ kind: 'missing' });
    expect(model.summary.nextSteps).toEqual({ kind: 'missing' });
    expect(model.summary.disagreements).toEqual({ kind: 'value', text: '双方均声明没有未解决问题。' });
  });

  it('marks every summary field missing when no discussion record exists', () => {
    const model = buildDiscussionViewModel(state());
    expect(model.summary.conclusion).toEqual({ kind: 'missing' });
    expect(model.summary.disagreements).toEqual({ kind: 'missing' });
    expect(model.summary.evidenceGaps).toEqual({ kind: 'missing' });
    expect(model.summary.nextSteps).toEqual({ kind: 'missing' });
  });

  it('shows unresolved proposals instead of reporting consensus', () => {
    const model = buildDiscussionViewModel(state({
      outputs: {
        round3_first: decision('AGREE', 'Use an explicit typed discussion state model', 'NONE'),
        round3_second: decision('REVISE', 'Keep the current workflow state as it is', 'Need runtime integration evidence'),
        audit3: audit('FINISH', 'DISAGREEMENTS', 'NONE'),
      },
    }));
    expect(model.summary.conclusion.kind).toBe('value');
    if (model.summary.conclusion.kind === 'value') expect(model.summary.conclusion.basis).toBe('unresolved');
  });
});

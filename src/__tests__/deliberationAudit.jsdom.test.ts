// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { serializeResponseText } from '../../injected/responseSerializer';
import {
  auditRequestsContinuation,
  deliberationAuditReport,
  parseDeliberationAudit,
} from '../workflow/graph/deliberationAudit';

// Synthetic boundary cases only. These fragments are NOT sanitized captures from a real provider.
// Every call uses jsdom's real HTML parser and real DOM nodes; no FakeNode or production mocks.
function fromHtml(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  return serializeResponseText(root);
}

const finishTags = [
  '[[AI_ONE_AUDIT_DECISION:FINISH]]',
  '[[AI_ONE_AUDIT_RESULT:AGREED]]',
  '[[AI_ONE_AUDIT_QUESTION:NONE]]',
];
const finishDisagreementTags = [
  '[[AI_ONE_AUDIT_DECISION:FINISH]]',
  '[[AI_ONE_AUDIT_RESULT:DISAGREEMENTS]]',
  '[[AI_ONE_AUDIT_QUESTION:NONE]]',
];
const continueTags = [
  '[[AI_ONE_AUDIT_DECISION:CONTINUE]]',
  '[[AI_ONE_AUDIT_RESULT:DISAGREEMENTS]]',
  '[[AI_ONE_AUDIT_QUESTION:Check whether calibration is repeatable]]',
];

function codeFooter(tags: readonly string[]): string {
  return `<pre><code class="language-audit">${tags.join('\n')}</code></pre>`;
}

const oneRound = [{ round: 1, first: 'f1', second: 's1', auditor: 'a1' }] as const;
const twoRounds = [
  ...oneRound,
  { round: 2, first: 'f2', second: 's2', auditor: 'a2' },
] as const;

function reportForHtml(auditHtml: string): string {
  const outputs = new Map([
    ['f1', fromHtml('<p>First independent answer.</p>')],
    ['s1', fromHtml('<p>Second independent answer.</p>')],
    ['a1', fromHtml(auditHtml)],
  ]);
  return deliberationAuditReport(oneRound, (id) => outputs.get(id), 'en');
}

function sectionOf(report: string, heading: string): string {
  expect(report).toContain(heading);
  return report.slice(report.indexOf(heading) + heading.length).split('\n### ')[0].trim();
}

const structuredAuditHtml = [
  '<h2>Evidence-backed findings</h2>',
  '<p>Source <strong>A &amp; B</strong> confirms the threshold.</p>',
  '<h2><strong>Shared conclusions</strong></h2>',
  '<p>Both experts accept the <code>5 ms</code> window.</p>',
  '<h3>Disagreements</h3>',
  '<p>Which calibration strategy to use.</p>',
  '<p><strong>Evidence gaps:</strong> Missing repeat trials.</p>',
  '<h2>Next steps</h2>',
  '<ul><li>Repeat &amp; record the run.</li><li>Compare device samples.</li></ul>',
  codeFooter(finishDisagreementTags),
].join('');

describe('jsdom HTML -> serializeResponseText -> audit footer', () => {
  it('preserves parsed entities/formatting and reads all three tags inside a final pre/code block', () => {
    const text = fromHtml(
      '<article><p>Source <strong>A &amp; B</strong> supports the claim.</p>' + codeFooter(finishTags) + '</article>',
    );

    expect(text).toBe([
      'Source **A & B** supports the claim.',
      '',
      '```audit',
      ...finishTags,
      '```',
    ].join('\n'));
    expect(parseDeliberationAudit(text)).toEqual({
      decision: 'FINISH', result: 'AGREED', question: 'NONE',
    });
    expect(auditRequestsContinuation(text)).toBe(false);
  });

  const footerForms = [
    { name: 'separate paragraphs', html: continueTags.map((tag) => `<p>${tag}</p>`).join('') },
    { name: 'line breaks', html: `<p>${continueTags.join('<br>')}</p>` },
    { name: 'bold paragraphs', html: continueTags.map((tag) => `<p><strong>${tag}</strong></p>`).join('') },
    { name: 'inline code', html: `<p>${continueTags.map((tag) => `<code>${tag}</code>`).join(' ')}</p>` },
    {
      name: 'syntax-highlighted pre/code with explicit newlines',
      html: `<pre><code class="language-audit">${continueTags.map((tag) => `<span>${tag}</span>`).join('\n')}</code></pre>`,
    },
  ];
  it.each(footerForms)('recognizes a complete CONTINUE footer serialized from $name', ({ html }) => {
    const text = fromHtml('<p>The two responses still differ on the calibration evidence.</p>' + html);
    expect(parseDeliberationAudit(text)).toEqual({
      decision: 'CONTINUE',
      result: 'DISAGREEMENTS',
      question: 'Check whether calibration is repeatable',
    });
    expect(auditRequestsContinuation(text)).toBe(true);
  });

  const invalidFooters = [
    { name: 'missing question', tags: finishTags.slice(0, 2), suffix: '' },
    { name: 'missing result', tags: [finishTags[0], finishTags[2]], suffix: '' },
    { name: 'unknown decision', tags: ['[[AI_ONE_AUDIT_DECISION:STOP]]', ...finishTags.slice(1)], suffix: '' },
    { name: 'unknown result', tags: [finishTags[0], '[[AI_ONE_AUDIT_RESULT:UNCERTAIN]]', finishTags[2]], suffix: '' },
    { name: 'FINISH carrying a question', tags: [finishTags[0], finishTags[1], continueTags[2]], suffix: '' },
    { name: 'CONTINUE carrying NONE', tags: [continueTags[0], continueTags[1], finishTags[2]], suffix: '' },
    { name: 'CONTINUE with a too-short question', tags: [continueTags[0], continueTags[1], '[[AI_ONE_AUDIT_QUESTION:Why?]]'], suffix: '' },
    { name: 'text after the footer', tags: finishTags, suffix: '<p>Late explanatory text.</p>' },
  ];
  it.each(invalidFooters)('rejects $name instead of inventing a valid decision', ({ tags, suffix }) => {
    const text = fromHtml('<p>The substantive review goes here before its audit metadata.</p>' + codeFooter(tags) + suffix);
    expect(parseDeliberationAudit(text)).toBeUndefined();
    expect(auditRequestsContinuation(text)).toBe(false);
  });
});

describe('jsdom HTML -> serializer -> deliberationAuditReport', () => {
  it('uses actual headings, preserves formatted section content and drops the fenced control footer', () => {
    const serialized = fromHtml(structuredAuditHtml);
    expect(serialized).toContain('## Evidence-backed findings\n\nSource **A & B** confirms the threshold.');
    expect(serialized).toContain('Both experts accept the `5 ms` window.');
    expect(parseDeliberationAudit(serialized)).toEqual({
      decision: 'FINISH', result: 'DISAGREEMENTS', question: 'NONE',
    });

    const report = reportForHtml(structuredAuditHtml);
    expect(report).toContain('`COMPLETE_WITH_DISAGREEMENTS (round 1 of 3)`');
    const headings = [
      '### Evidence-backed findings',
      '### Shared conclusions',
      '### Remaining disagreements',
      '### Evidence gaps',
      '### Next steps',
    ];
    const positions = headings.map((heading) => report.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(sectionOf(report, headings[0])).toBe('Source **A & B** confirms the threshold.');
    expect(sectionOf(report, headings[1])).toBe('Both experts accept the `5 ms` window.');
    expect(sectionOf(report, headings[2])).toBe('Which calibration strategy to use.');
    expect(sectionOf(report, headings[3])).toBe('Missing repeat trials.');
    expect(sectionOf(report, headings[4])).toBe('- Repeat & record the run.\n- Compare device samples.');
    expect(report).not.toContain('[[AI_ONE_AUDIT');
    expect(report).not.toContain('```');
  });

  it('does not promote section headings from a pre/code example into report sections', () => {
    const html = [
      '<p>The following is only an example of the expected format.</p>',
      '<pre><code class="language-markdown">',
      '## Evidence-backed findings\nExample A.\n',
      '## Shared conclusions\nExample B.\n',
      '## Disagreements\nExample C.\n',
      '## Evidence gaps\nExample D.\n',
      '## Next steps\nExample E.',
      '</code></pre>',
      '<p>Actual report sections have not been provided.</p>',
      codeFooter(finishTags),
    ].join('');
    const serialized = fromHtml(html);
    expect(serialized).toContain('```markdown\n## Evidence-backed findings\nExample A.');
    expect(parseDeliberationAudit(serialized)?.decision).toBe('FINISH');

    const report = reportForHtml(html);
    expect(report).toContain('`COMPLETE_AGREED (round 1 of 3)`');
    expect(report).toContain('did not use the agreed section headings');
    expect(report).toContain('Actual report sections have not been provided.');
    expect(report).not.toContain('### Evidence-backed findings');
    expect(report).not.toContain('[[AI_ONE_AUDIT');
  });

  it('marks an absent section as missing, without treating a mention in prose as its heading', () => {
    const report = reportForHtml([
      '<h2>Evidence-backed findings</h2><p>Observed fact A.</p>',
      '<h2>Shared conclusions</h2>',
      '<p>Both parties agree. Disagreements: none were measured in the sample.</p>',
      '<h2>Evidence gaps</h2><p>Missing a second run.</p>',
      '<h2>Next steps</h2><p>Collect another sample.</p>',
      codeFooter(finishTags),
    ].join(''));
    expect(sectionOf(report, '### Shared conclusions'))
      .toBe('Both parties agree. Disagreements: none were measured in the sample.');
    expect(sectionOf(report, '### Remaining disagreements')).toBe('(not provided by the auditor)');
    expect(sectionOf(report, '### Next steps')).toBe('Collect another sample.');
  });

  it('falls back to the unstructured original when too few real headings are present', () => {
    const report = reportForHtml(
      '<h2>Evidence-backed findings</h2><p>Observed fact A.</p>' +
      '<h2>Shared conclusions</h2><p>Agreement B.</p>' + codeFooter(finishTags),
    );
    expect(report).toContain('`COMPLETE_AGREED (round 1 of 3)`');
    expect(report).toContain('did not use the agreed section headings');
    expect(report).toContain('Observed fact A.');
    expect(report).not.toContain('### Evidence-backed findings');
    expect(report).not.toContain('[[AI_ONE_AUDIT');
  });

  it('removes a quoted audit control tag from prose without discarding its surrounding sentence', () => {
    const html = structuredAuditHtml.replace(
      '<h2>Next steps</h2>',
      '<h2>Next steps</h2><p>Use <code>[[AI_ONE_AUDIT_DECISION:FINISH]]</code> only as metadata.</p>',
    );
    const report = reportForHtml(html);
    expect(sectionOf(report, '### Next steps')).toContain('Use  only as metadata.');
    expect(sectionOf(report, '### Next steps')).toContain('- Repeat & record the run.');
    expect(report).not.toContain('[[AI_ONE_AUDIT');
  });

  it('blocks reports with no complete round or a complete but invalid audit', () => {
    const missingAuditor = new Map([
      ['f1', fromHtml('<p>First answer.</p>')],
      ['s1', fromHtml('<p>Second answer.</p>')],
    ]);
    expect(deliberationAuditReport(oneRound, (id) => missingAuditor.get(id), 'en'))
      .toContain('`INCOMPLETE_BLOCKED`');

    missingAuditor.set('a1', fromHtml('<p>Review body without a control footer.</p>'));
    expect(deliberationAuditReport(oneRound, (id) => missingAuditor.get(id), 'en'))
      .toContain('`INCOMPLETE_BLOCKED (round 1)`');
  });

  it('uses only completed rounds, keeps the continuation question, and blocks a later invalid audit', () => {
    const outputs = new Map([
      ['f1', fromHtml('<p>First answer.</p>')],
      ['s1', fromHtml('<p>Second answer.</p>')],
      ['a1', fromHtml('<p>The two answers disagree about repeatability.</p>' + codeFooter(continueTags))],
      ['f2', fromHtml('<p>Additional measurement.</p>')],
    ]);
    const partialReport = deliberationAuditReport(twoRounds, (id) => outputs.get(id), 'en');
    expect(partialReport).toContain('`COMPLETE_WITH_DISAGREEMENTS (round 1 of 3)`');
    expect(partialReport).toContain('Check whether calibration is repeatable');
    expect(partialReport).not.toContain('(round 2 of 3)');

    outputs.set('s2', fromHtml('<p>Second additional measurement.</p>'));
    outputs.set('a2', fromHtml('<p>Auditor response missing the footer.</p>'));
    expect(deliberationAuditReport(twoRounds, (id) => outputs.get(id), 'en'))
      .toContain('`INCOMPLETE_BLOCKED (round 2)`');

    outputs.set('a2', fromHtml(structuredAuditHtml));
    const finalReport = deliberationAuditReport(twoRounds, (id) => outputs.get(id), 'en');
    expect(finalReport).toContain('`COMPLETE_WITH_DISAGREEMENTS (round 2 of 3)`');
    expect(finalReport).toContain('Check whether calibration is repeatable');
    expect(sectionOf(finalReport, '### Evidence-backed findings'))
      .toBe('Source **A & B** confirms the threshold.');
  });
});

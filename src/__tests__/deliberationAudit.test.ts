import { describe, expect, it } from 'vitest';
import { serializeResponseText } from '../../injected/responseSerializer';
import { auditRequestsContinuation, deliberationAuditReport, parseDeliberationAudit } from '../workflow/graph/deliberationAudit';
interface FakeNode {
  nodeType: number; tagName?: string; childNodes?: FakeNode[];
  readonly textContent: string; getAttribute?: (name: string) => string | null;
}
function textNode(value: string): FakeNode { return { nodeType: 3, textContent: value }; }
function element(tag: string, nodes: FakeNode[] = []): FakeNode {
  return { nodeType: 1, tagName: tag.toUpperCase(), childNodes: nodes,
    get textContent() { return nodes.map((node) => node.textContent).join(''); },
    getAttribute: () => null };
}
const body = 'Evidence-backed findings: Source A supports the core claim. Shared conclusions: Both accept the measurement. Disagreements: Calibration choice. Evidence gaps: Missing on-device repeatability. Next steps: Measure again.';
const tags = [
  '[[AI_ONE_AUDIT_DECISION:CONTINUE]]',
  '[[AI_ONE_AUDIT_RESULT:DISAGREEMENTS]]',
  '[[AI_ONE_AUDIT_QUESTION:Investigate calibration repeatability]]',
];
describe('independent audit parser through WebView serializer', () => {
  it('accepts paragraphs with blank lines, soft linebreaks, BRs, and fenced blocks', () => {
    const cases = [
      element('div', [element('p', [textNode(body)]), ...tags.map((tag) => element('p', [textNode(tag)]))]),
      element('div', [element('p', [textNode(body)]), element('p', [textNode(tags.join('\n'))])]),
      element('div', [element('p', [textNode(body)]), element('p', [
        textNode(tags[0]), element('br'), textNode(tags[1]), element('br'), textNode(tags[2]),
      ])]),
      element('div', [element('p', [textNode(body)]), element('pre', [element('code', [textNode(tags.join('\n'))])])]),
      element('div', [element('p', [textNode(body)]), ...tags.map((tag) => element('p', [element('strong', [textNode(tag)])]))]),
    ];
    for (const root of cases) {
      const serialized = serializeResponseText(root as unknown as Element);
      expect(parseDeliberationAudit(serialized)).toMatchObject({ decision: 'CONTINUE', result: 'DISAGREEMENTS', question: 'Investigate calibration repeatability' });
      expect(auditRequestsContinuation(serialized)).toBe(true);
    }
  });
  it('fails closed for missing fields, ignored errors, skipped responses and trailing text', () => {
    expect(parseDeliberationAudit(body + '\n' + tags.slice(0, 2).join('\n'))).toBeUndefined();
    expect(parseDeliberationAudit(body + '\n' + tags.join('\n') + '\nAdditional comment')).toBeUndefined();
    expect(parseDeliberationAudit('(no response — skipped)')).toBeUndefined();
    expect(parseDeliberationAudit('[Error: response truncated in transport]')).toBeUndefined();
    expect(parseDeliberationAudit(body + '\n' + tags.join('\n').replace('Investigate calibration repeatability', 'NONE'))).toBeUndefined();
  });
  it('generates a full disagreement report and blocks an unparseable audit', () => {
    const rounds = [{ round: 1, first: 'f', second: 's', auditor: 'a' }];
    const good = new Map([['f','First says X'],['s','Second says Y'],['a',body+'\n'+tags.join('\n')]]);
    expect(deliberationAuditReport(rounds, (id) => good.get(id))).toContain('COMPLETE_WITH_DISAGREEMENTS');
    expect(deliberationAuditReport(rounds, (id) => id === 'a' ? 'bad' : good.get(id))).toContain('INCOMPLETE_BLOCKED');
  });
});

describe('deliberation final report', () => {
  const twoRounds = [
    { round: 1, first: 'f1', second: 's1', auditor: 'a1' },
    { round: 2, first: 'f2', second: 's2', auditor: 'a2' },
    { round: 3, first: 'f3', second: 's3', auditor: 'a3' },
  ];
  const continueAudit = 'Evidence-backed findings: Partial.\nShared conclusions: Some.\nDisagreements: Calibration.\nEvidence gaps: Repeatability.\nNext steps: Ask again.\n' +
    '[[AI_ONE_AUDIT_DECISION:CONTINUE]]\n[[AI_ONE_AUDIT_RESULT:DISAGREEMENTS]]\n[[AI_ONE_AUDIT_QUESTION:Check the 12.05 patch notes]]';
  const finishAudit = [
    'I reviewed both replies in this round.',
    '## Evidence-backed findings',
    'Patch notes confirm the nerf.',
    '## **Shared conclusions**',
    'Both accept the current win rates.',
    '## Disagreements',
    'Whether the ceiling is higher in coordinated teams.',
    '## Evidence gaps',
    'No public high-tier team data.',
    '## Next steps',
    'Deliver the conclusion to the user.',
    '```',
    '[[AI_ONE_AUDIT_DECISION:FINISH]]',
    '[[AI_ONE_AUDIT_RESULT:DISAGREEMENTS]]',
    '[[AI_ONE_AUDIT_QUESTION:NONE]]',
    '```',
  ].join('\n');
  const outputs = new Map([['f1', 'x'], ['s1', 'y'], ['a1', continueAudit], ['f2', 'x2'], ['s2', 'y2'], ['a2', finishAudit]]);
  const get = (id: string) => outputs.get(id);

  it('turns the last audit into localized sections without control tags or a verbatim repeat', () => {
    const report = deliberationAuditReport(twoRounds, get, 'zh-TW');
    expect(report).toContain('`COMPLETE_WITH_DISAGREEMENTS (round 2 of 3)`');
    expect(report).toContain('最終報告：仍有分歧');
    const headings = ['### 有證據支持的結論', '### 雙方共同結論', '### 仍有分歧', '### 證據缺口', '### 下一步'];
    const positions = headings.map((heading) => report.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const section = (heading: string) => report.slice(report.indexOf(heading) + heading.length).split('\n### ')[0].trim();
    expect(section('### 有證據支持的結論')).toBe('Patch notes confirm the nerf.');
    expect(section('### 雙方共同結論')).toBe('Both accept the current win rates.');
    expect(section('### 仍有分歧')).toBe('Whether the ceiling is higher in coordinated teams.');
    expect(section('### 證據缺口')).toBe('No public high-tier team data.');
    expect(section('### 下一步').startsWith('Deliver the conclusion to the user.')).toBe(true);
    expect(report).not.toContain('[[AI_ONE_AUDIT');
    expect(report).not.toContain('```');
    expect(report).not.toContain('I reviewed both replies in this round.');
    expect(report).not.toMatch(/Evidence gaps|Next steps|Shared conclusions/);
  });

  it('summarizes the process, including the audit question that drove each extra round', () => {
    const report = deliberationAuditReport(twoRounds, get, 'zh-TW');
    expect(report).toContain('獨立初答 → 第 1 輪討論 → 審計：繼續（待查：Check the 12.05 patch notes） → 第 2 輪討論 → 審計：結束');
  });

  it('parses headings that a WebView serializes from real heading and code elements', () => {
    const root = element('div', [
      element('h2', [textNode('Evidence-backed findings')]), element('p', [textNode('Supported A.')]),
      element('h2', [textNode('Shared conclusions')]), element('p', [textNode('Shared B.')]),
      element('h3', [element('strong', [textNode('Disagreements')])]), element('p', [textNode('Disputed C.')]),
      element('p', [element('strong', [textNode('Evidence gaps:')]), textNode(' Missing D.')]),
      element('h2', [textNode('Next steps')]), element('ul', [element('li', [textNode('Do E.')])]),
      element('pre', [element('code', [textNode('[[AI_ONE_AUDIT_DECISION:FINISH]]\n[[AI_ONE_AUDIT_RESULT:AGREED]]\n[[AI_ONE_AUDIT_QUESTION:NONE]]')])]),
    ]);
    const serialized = serializeResponseText(root as unknown as Element);
    const report = deliberationAuditReport([{ round: 1, first: 'f', second: 's', auditor: 'a' }],
      (id) => ({ f: 'x', s: 'y', a: serialized } as Record<string, string>)[id], 'en');
    expect(report).toContain('`COMPLETE_AGREED (round 1 of 3)`');
    expect(report).toContain('Final report: agreement reached');
    expect(report).toMatch(/### Evidence-backed findings\n\nSupported A\./);
    expect(report).toMatch(/### Remaining disagreements\n\nDisputed C\./);
    expect(report).toMatch(/### Evidence gaps\n\nMissing D\./);
    expect(report).toMatch(/### Next steps\n\n- Do E\./);
    expect(report).not.toContain('[[AI_ONE_AUDIT');
    expect(report).not.toContain('```');
  });

  it('accepts inline headings and shows NONE as a localized empty section', () => {
    const audit = 'Evidence-backed findings: Fact. Shared conclusions: Agreement. Disagreements: NONE. Evidence gaps: none. Next steps: Verify.\n' +
      '[[AI_ONE_AUDIT_DECISION:FINISH]]\n[[AI_ONE_AUDIT_RESULT:AGREED]]\n[[AI_ONE_AUDIT_QUESTION:NONE]]';
    const report = deliberationAuditReport([{ round: 1, first: 'f', second: 's', auditor: 'a' }],
      (id) => ({ f: 'x', s: 'y', a: audit } as Record<string, string>)[id], 'zh-TW');
    expect(report).toMatch(/### 仍有分歧\n\n無/);
    expect(report).toMatch(/### 證據缺口\n\n無/);
    expect(report).toMatch(/### 下一步\n\nVerify\./);
  });

  it('falls back honestly when the audit has a valid decision but no section headings', () => {
    const audit = 'Overall the two answers converge but one source is unverified.\n' +
      '[[AI_ONE_AUDIT_DECISION:FINISH]]\n[[AI_ONE_AUDIT_RESULT:DISAGREEMENTS]]\n[[AI_ONE_AUDIT_QUESTION:NONE]]';
    const report = deliberationAuditReport([{ round: 1, first: 'f', second: 's', auditor: 'a' }],
      (id) => ({ f: 'x', s: 'y', a: audit } as Record<string, string>)[id], 'zh-TW');
    expect(report).toContain('COMPLETE_WITH_DISAGREEMENTS');
    expect(report).toContain('審計沒有按約定的標題分段');
    expect(report).toContain('Overall the two answers converge but one source is unverified.');
    expect(report).not.toContain('### 有證據支持的結論');
    expect(report).not.toContain('[[AI_ONE_AUDIT');
  });

  const footer = '\n[[AI_ONE_AUDIT_DECISION:FINISH]]\n[[AI_ONE_AUDIT_RESULT:DISAGREEMENTS]]\n[[AI_ONE_AUDIT_QUESTION:NONE]]';
  const oneRound = [{ round: 1, first: 'f', second: 's', auditor: 'a' }];
  const reportFor = (audit: string, locale: 'en' | 'zh-TW' = 'en') =>
    deliberationAuditReport(oneRound, (id) => ({ f: 'x', s: 'y', a: audit } as Record<string, string>)[id], locale);
  const sectionOf = (report: string, heading: string) => report.slice(report.indexOf(heading) + heading.length).split('\n### ')[0].trim();

  it('prefers real line headings over a heading name inside a sentence', () => {
    const report = reportFor([
      '## Evidence-backed findings', 'A is supported.',
      '## Shared conclusions', 'Both teams agree. Disagreements: no disputes about sampling.',
      '## Disagreements', 'The calibration choice is open.',
      '## Evidence gaps', 'More trials needed.',
      '## Next steps', 'Repeat test.',
    ].join('\n') + footer);
    expect(sectionOf(report, '### Shared conclusions')).toBe('Both teams agree. Disagreements: no disputes about sampling.');
    expect(sectionOf(report, '### Remaining disagreements')).toBe('The calibration choice is open.');
    expect(report).not.toContain('## Disagreements\n');
  });

  it('fills a section written inline between line headings instead of misfiling it', () => {
    const report = reportFor([
      'Evidence-backed findings: A. Shared conclusions: B.',
      '## Disagreements', 'C.', '## Evidence gaps', 'D.', '## Next steps', 'E.',
    ].join('\n') + footer);
    expect(sectionOf(report, '### Evidence-backed findings')).toBe('A.');
    expect(sectionOf(report, '### Shared conclusions')).toBe('B.');
    expect(sectionOf(report, '### Remaining disagreements')).toBe('C.');
    expect(report).not.toContain('not provided by the auditor');
  });

  it('does not promote a heading name in prose when that section is genuinely missing', () => {
    const report = reportFor([
      '## Evidence-backed findings', 'A is supported.',
      '## Shared conclusions', 'Both teams agree. Disagreements: no disputes about sampling.',
      '## Evidence gaps', 'D.', '## Next steps', 'E.',
    ].join('\n') + footer);
    expect(sectionOf(report, '### Shared conclusions')).toBe('Both teams agree. Disagreements: no disputes about sampling.');
    expect(sectionOf(report, '### Remaining disagreements')).toBe('(not provided by the auditor)');
  });

  it('fills a chain of inline sections that continue the same line', () => {
    const report = reportFor([
      'Evidence-backed findings: A. Shared conclusions: B. Disagreements: C.',
      '## Evidence gaps', 'D.', '## Next steps', 'E.',
    ].join('\n') + footer);
    expect(sectionOf(report, '### Evidence-backed findings')).toBe('A.');
    expect(sectionOf(report, '### Shared conclusions')).toBe('B.');
    expect(sectionOf(report, '### Remaining disagreements')).toBe('C.');
  });

  it('falls back when a missing section has more than one inline candidate in its gap', () => {
    const report = reportFor([
      'Evidence-backed findings: A. Shared conclusions: B. Shared conclusions: B2.',
      '## Disagreements', 'C.', '## Evidence gaps', 'D.', '## Next steps', 'E.',
    ].join('\n') + footer);
    expect(report).toContain('did not use the agreed section headings');
    expect(report).not.toContain('### Evidence-backed findings');
  });

  it('falls back instead of guessing when an inline heading name repeats', () => {
    const report = reportFor('Evidence-backed findings: A. Shared conclusions: B. Disagreements: none noted. Disagreements: C. Evidence gaps: D. Next steps: E.' + footer);
    expect(report).toContain('did not use the agreed section headings');
    expect(report).not.toContain('### Evidence-backed findings');
  });

  it('ignores section headings inside fenced code examples', () => {
    const report = reportFor([
      'The expected format is:',
      '```markdown',
      '## Evidence-backed findings', 'X', '## Shared conclusions', 'Y', '## Disagreements', 'Z',
      '## Evidence gaps', 'G', '## Next steps', 'N',
      '```',
      'The block above is only an example.',
    ].join('\n') + footer, 'zh-TW');
    expect(report).toContain('審計沒有按約定的標題分段');
    expect(report).not.toContain('### 有證據支持的結論');
  });

  it('recognizes the bold list form a WebView serializes from list items', () => {
    const item = (label: string, value: string) => element('li', [element('strong', [textNode(label + ':')]), textNode(' ' + value)]);
    const root = element('div', [
      element('ul', [item('Evidence-backed findings', 'A.'), item('Shared conclusions', 'B.'), item('Disagreements', 'C.'),
        item('Evidence gaps', 'D.'), item('Next steps', 'E.')]),
      element('pre', [element('code', [textNode(footer.trim())])]),
    ]);
    const report = reportFor(serializeResponseText(root as unknown as Element));
    expect(sectionOf(report, '### Evidence-backed findings')).toBe('A.');
    expect(sectionOf(report, '### Shared conclusions')).toBe('B.');
    expect(sectionOf(report, '### Remaining disagreements')).toBe('C.');
    expect(sectionOf(report, '### Evidence gaps')).toBe('D.');
    expect(sectionOf(report, '### Next steps')).toBe('E.');
  });

  it('removes control tags that the audit quoted before its footer', () => {
    const report = reportFor([
      '## Evidence-backed findings', 'A.', '## Shared conclusions', 'B.', '## Disagreements', 'C.', '## Evidence gaps', 'D.',
      '## Next steps', 'Finish now; I will end with `[[AI_ONE_AUDIT_DECISION:FINISH]]` as required.',
    ].join('\n') + footer);
    expect(report).not.toContain('[[AI_ONE_AUDIT');
    expect(sectionOf(report, '### Next steps')).toContain('Finish now;');
  });

  it('marks the round budget and keeps blocked reports explicit in every language', () => {
    const outputs3 = new Map([...outputs, ['a2', continueAudit], ['f3', 'x3'], ['s3', 'y3'], ['a3', finishAudit]]);
    const en = deliberationAuditReport(twoRounds, (id) => outputs3.get(id), 'en');
    expect(en).toContain('round budget exhausted');
    expect(deliberationAuditReport(twoRounds, (id) => outputs3.get(id), 'zh-TW')).toContain('已用完全部 3 輪');
    for (const locale of ['en', 'zh-TW', 'ja', 'de'] as const) {
      expect(deliberationAuditReport(twoRounds, () => undefined, locale)).toContain('`INCOMPLETE_BLOCKED`');
      // An unparseable round-1 audit cannot continue the graph, so no round-2 outputs exist.
      expect(deliberationAuditReport(twoRounds, (id) => id === 'a1' ? 'unparseable audit text' : id.endsWith('1') ? outputs.get(id) : undefined, locale))
        .toContain('`INCOMPLETE_BLOCKED (round 1)`');
    }
  });
});

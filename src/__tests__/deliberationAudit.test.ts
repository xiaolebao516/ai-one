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

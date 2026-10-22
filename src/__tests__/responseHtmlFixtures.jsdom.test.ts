// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serializeResponseText } from '../../injected/responseSerializer';
import { deliberationAuditReport, parseDeliberationAudit } from '../workflow/graph/deliberationAudit';

const FOOTER = '[[AI_ONE_AUDIT_DECISION:FINISH]]\n[[AI_ONE_AUDIT_RESULT:AGREED]]\n[[AI_ONE_AUDIT_QUESTION:NONE]]';
const HEADINGS = ['Fixture heading', 'Evidence-backed findings', 'Shared conclusions', 'Disagreements', 'Evidence gaps', 'Next steps'];
const names = ['chatgpt-dil-rich-response', 'chatgpt-dil-audit-tail'] as const;
function fixture(name: typeof names[number]) {
  const root = document.createElement('div');
  root.innerHTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/response-html', `${name}.html`), 'utf8');
  return root;
}

describe('sanitized actual ChatGPT HTML structure', () => {
  it('keeps captured nested lists, headings, table sections and quote boundaries', () => {
    const root = fixture(names[0]);
    expect([...root.querySelectorAll('h2')].map(e => e.textContent)).toEqual(HEADINGS);
    expect(root.querySelectorAll('table > tbody > tr')).toHaveLength(3);
    expect(root.querySelector('ul li ul')).not.toBeNull();
    const text = serializeResponseText(root);
    expect(text).toContain('- sample14 sample15 sample16\n\n  - sample17 sample18 sample19\n  - sample20 sample21 sample22');
    expect(text).toContain('1. sample26 sample27 sample28\n2. sample29 sample30 sample31');
    expect(text).toContain('| sample32 sample33 | sample34 sample35 |\n| --- | --- |\n| sample36 | sample37 |\n| sample38 sample39 sample40 | sample41 |');
    expect(text).toContain('> sample95 sample96 sample97 sample98 sample99 sample100 sample101 sample102 sample103 sample104');
  });
  it('preserves captured highlighted-code span ordering and indentation', () => {
    const root = fixture(names[0]);
    expect(root.querySelectorAll('pre code span').length).toBeGreaterThan(20);
    expect(serializeResponseText(root)).toContain('```\nsample43 sample44sample45\n    sample46 sample47 sample48 sample49sample50\n');
  });
  it('uses sanitized TeX annotations once instead of duplicating rendered MathML/glyphs', () => {
    const text = serializeResponseText(fixture(names[0]));
    expect(text.match(/\$x\^2\+1\$/g)).toHaveLength(1);
    expect(text.match(/\$\$E=mc\^2\$\$/g)).toHaveLength(1);
    expect(text).not.toContain('sample75');
    expect(text).not.toContain('sample90');
  });
  it('parses the actual standalone-code footer and preserves all five report sections', () => {
    const root = fixture(names[1]);
    const footer = root.querySelector('code')!;
    expect(root.querySelectorAll('h2')).toHaveLength(5);
    expect(footer.closest('pre')).toBeNull();
    expect(footer.textContent).toBe(FOOTER);
    const text = serializeResponseText(root);
    expect(text).toContain('`[[AI_ONE_AUDIT_DECISION:FINISH]] [[AI_ONE_AUDIT_RESULT:AGREED]] [[AI_ONE_AUDIT_QUESTION:NONE]]`');
    expect(parseDeliberationAudit(text)).toEqual({ decision: 'FINISH', result: 'AGREED', question: 'NONE' });
    const report = deliberationAuditReport([{ round: 1, first: 'f', second: 's', auditor: 'a' }], id => id === 'a' ? text : 'synthetic evidence');
    expect(report).toContain('`COMPLETE_AGREED (round 1 of 3)`');
    for (const content of ['### Evidence-backed findings\n\nsample105 sample106', '### Shared conclusions\n\nsample107 sample108', '### Remaining disagreements\n\nsample109', '### Evidence gaps\n\nsample110 sample111 sample112', '### Next steps\n\nsample113 sample114 sample115']) expect(report).toContain(content);
    expect(report).not.toContain('[[AI_ONE_AUDIT');
  });
  it('rejects the original invalid test enum without blaming the identical DOM structure', () => {
    const root = fixture(names[1]);
    root.querySelector('code')!.textContent = FOOTER.replace('AGREED', 'CONSENSUS');
    const text = serializeResponseText(root);
    expect(parseDeliberationAudit(text)).toBeUndefined();
    const report = deliberationAuditReport([{ round: 1, first: 'f', second: 's', auditor: 'a' }], id => id === 'a' ? text : 'synthetic evidence');
    expect(report).toContain('`INCOMPLETE_BLOCKED (round 1)`');
  });
  it('contains only structural attributes and fixed public placeholder text', () => {
    const allowedClasses = new Set(['katex', 'katex-mathml', 'katex-html', 'katex-display']);
    for (const name of names) {
      const root = fixture(name);
      expect(root.querySelector('a, img, script, style, iframe, input, textarea')).toBeNull();
      for (const element of root.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
          if (attribute.name === 'class') expect(attribute.value.split(' ').every(value => allowedClasses.has(value))).toBe(true);
          else if (attribute.name === 'aria-hidden') expect(attribute.value).toBe('true');
          else if (attribute.name === 'encoding') expect(attribute.value).toBe('application/x-tex');
          else if (attribute.name === 'display') expect(attribute.value).toBe('block');
          else throw new Error(`Unexpected captured attribute: ${attribute.name}`);
        }
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? '';
        if (!text || HEADINGS.includes(text) || ['x^2+1', 'E=mc^2', FOOTER].includes(text)) continue;
        expect(text).toMatch(/^(?:sample\d+|\s)+$/);
      }
    }
  });
});
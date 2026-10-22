// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { serializeResponseText } from '../../injected/responseSerializer';

// Synthetic HTML boundary cases only. These are not captured ChatGPT/Gemini page samples.
describe('serializeResponseText with browser-parsed jsdom nodes', () => {
  it('decodes HTML entities and retains NBSP while folding ordinary whitespace', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p>Alpha &amp; Beta&nbsp;&nbsp;Gamma
         delta &lt;epsilon&gt; &#35;1</p>
    `;

    expect(root.querySelector('p')?.textContent).toContain('\u00a0\u00a0');
    expect(serializeResponseText(root)).toBe('Alpha & Beta\u00a0\u00a0Gamma delta <epsilon> #1');
  });

  it('keeps semantic heading, bold and emphasis formatting', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<h3>  Title &amp; <strong>bold</strong>  </h3>' +
      '<p>One <b>two</b> and <em>three</em>.</p>';

    expect(serializeResponseText(root)).toBe(
      '### Title & **bold**\n\nOne **two** and *three*.',
    );
  });

  it('keeps nested ordered and unordered list hierarchy with fixed indentation', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<ul><li>First<ol><li>nested one</li>' +
      '<li>nested two<ul><li>deep</li></ul></li></ol></li>' +
      '<li>Second</li></ul>';

    expect(serializeResponseText(root)).toBe(
      '- First\n  1. nested one\n  2. nested two\n    - deep\n- Second',
    );
  });

  it('handles the implicit tbody inserted by the HTML parser and escapes table cells', () => {
    const root = document.createElement('div');
    root.innerHTML = String.raw`
      <table>
        <tr><th>Key</th><th>Value</th></tr>
        <tr><td>path</td><td>left|right &amp; C:\temp</td></tr>
        <tr><td>tail</td></tr>
      </table>
    `;

    expect(root.querySelector('table > tbody > tr')).not.toBeNull();
    expect(serializeResponseText(root)).toBe([
      '| Key | Value |',
      '| --- | --- |',
      String.raw`| path | left\|right & C:\\temp |`,
      '| tail |  |',
    ].join('\n'));
  });

  it('preserves preformatted indentation, replacement tokens and literal backticks', () => {
    const pre = document.createElement('pre');
    pre.innerHTML = '<code class="language-sh"></code>';
    const source =
      '    echo "$&" && echo "100$$"\n' +
      '  echo \'$`\' && echo "$\'"\n' +
      '  const fence = "```";';
    pre.querySelector('code')!.textContent = source;

    expect(serializeResponseText(pre)).toBe(
      '````sh\n' +
      '    echo "$&" && echo "100$$"\n' +
      '  echo \'$`\' && echo "$\'"\n' +
      '  const fence = "```";\n' +
      '````',
    );
  });

  it('uses a longer delimiter for inline code containing backticks and joins code lines', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Run <code>a`b</code>, then <code>one\n  two</code>.</p>';

    expect(serializeResponseText(root)).toBe(
      'Run ``a`b``, then `one two`.',
    );
  });

  it('recovers inline KaTeX from the MathML TeX annotation, not hidden glyphs', () => {
    const root = document.createElement('div');
    root.innerHTML = String.raw`
      <p>Cost <span class="katex" aria-hidden="true">
        <span class="katex-mathml"><math><semantics>
          <mrow><mi>x</mi></mrow>
          <annotation encoding="application/x-tex">\frac{a}{b}</annotation>
        </semantics></math></span>
        <span class="katex-html" aria-hidden="true">WRONG GLYPHS</span>
      </span> now.</p>
    `;

    expect(serializeResponseText(root)).toBe(String.raw`Cost $\frac{a}{b}$ now.`);
  });

  it('recovers display KaTeX from its annotation despite aria-hidden wrappers', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p>Before</p>
      <span class="katex-display" aria-hidden="true">
        <span class="katex"><span class="katex-mathml">
          <math display="block"><semantics>
            <annotation encoding="application/x-tex">x^2 + y^2</annotation>
          </semantics></math>
        </span><span class="katex-html" aria-hidden="true">WRONG GLYPHS</span></span>
      </span>
      <p>After</p>
    `;

    expect(serializeResponseText(root)).toBe('Before\n\n$$x^2 + y^2$$\n\nAfter');
  });

  it('drops hidden content, buttons, SVG, scripts and template UI chrome', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p>Result: <span aria-hidden="true">hidden icon</span>' +
      '<button>Copy</button><svg><text>decorative</text></svg>' +
      '<span>ready</span></p>' +
      '<div aria-hidden="true">overlay</div>' +
      '<script>debug()</script><style>.ui { color: red; }</style>' +
      '<template><p>internal copy control</p></template>' +
      '<!-- an HTML comment -->';

    expect(serializeResponseText(root)).toBe('Result: ready');
  });
});

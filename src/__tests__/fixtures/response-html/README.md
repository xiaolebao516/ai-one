# Response HTML fixtures (#47)

`chatgpt-dil-rich-response.html` is a sanitized structural capture of the actual ChatGPT web response renderer observed on 2026-10-22. `chatgpt-dil-audit-tail.html` is the contiguous five-section audit tail from the same capture. These are two fragments of one controlled sample response, not independent provider observations. The sample was generated solely for this test task through Prodex 0.40.40 (`--effort high`, request verified). No private user conversation was used. No Gemini page was captured.

The observed source used the `data-markdown-text-style="assistant-message"` surface and DIL wrappers, nested word-level spans, a real parsed `tbody`, highlighted `pre/code`, KaTeX MathML + HTML, and an audit footer inside standalone `code` without `pre`. Only the response subtree was read; sidebar/account UI was excluded.

Sanitization happened inside the page before export:

- Every non-whitespace text node became a numbered `sampleN` token. Heading text became fixed fixture/report headings; TeX annotations and audit markers became fixed public test constants.
- All links, IDs, data attributes, event handlers, styles, dynamic classes and other attributes were removed. Only fixed math classes, `aria-hidden="true"`, MathML `display`, and `encoding="application/x-tex"` were retained.
- Script/style/SVG/media/input/template nodes were discarded. Empty response code-viewer buttons and structural wrappers were retained. Header internals were normalized to plain `h2` text; other response nesting, highlighted-code spans and whitespace were retained.
- No raw response, thread URL, request ID, cookie, token, account name or original prose is stored here. The tests restrict all remaining text and attribute values to these fixed constants.

The two `.jsdom.test.ts` files named for the production serializer and audit functions contain **synthetic** boundary cases, separately identified as such. They are not claimed as captures.

## Known behavior and limits

The real DIL audit tail serializes its standalone `code` as inline Markdown code, folding the marker lines into spaces. The production parser already accepts that shape with legal FINISH / AGREED / NONE values and preserves the five report sections. The source test prompt mistakenly used the unsupported result CONSENSUS; as part of the documented text replacement, the canonical fixture uses the fixed public AGREED value. A paired test changes only that value back to CONSENSUS and requires INCOMPLETE_BLOCKED. Initial Issue #96 was a misdiagnosis of this invalid test value, not a renderer compatibility fault, and was corrected. No production code is changed.

jsdom parses real HTML nodes, entities, MathML and implicit table sections, but does not provide layout, CSS rendering or browser-equivalent `innerText`. Word-level span whitespace, code indentation and TeX annotation recovery are tested as DOM serialization, not as WebView screenshot/layout or live provider end-to-end proof. Existing FakeNode tests remain intact. A line-oriented highlighter relying only on layout-provided `innerText` still needs real WebView coverage.

Run the focused tests with:

```sh
pnpm test src/__tests__/responseSerializer.jsdom.test.ts src/__tests__/deliberationAudit.jsdom.test.ts src/__tests__/responseHtmlFixtures.jsdom.test.ts
```
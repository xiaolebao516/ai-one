import { describe, expect, it } from 'vitest';
import {
  createResponseLanguagePolicy,
  inferQuestionLanguage,
  isResponseLanguagePolicy,
  prependResponseLanguagePolicy,
  responseLanguageDirective,
  responseLanguagePolicyFromPrompt,
} from '../workflow/responseLanguage';

describe('response language policy', () => {
  it('keeps prompts unchanged when no response-language policy was supplied', () => {
    expect(prependResponseLanguagePolicy('original prompt')).toBe('original prompt');
  });

  it('uses question and conversation language before the interface fallback in Auto mode', () => {
    const policy = createResponseLanguagePolicy('auto', 'zh-TW');
    const directive = responseLanguageDirective(policy);

    expect(directive).toContain('explicit output-language request(s)');
    expect(directive).toContain('primary language of the user-authored prose');
    expect(directive).toContain('language previously used by the user');
    expect(directive).toContain('Traditional Chinese (zh-TW) (the app interface language fallback)');
    expect(directive).toContain('does not change the requested task, output modality, structure, or format');
    expect(directive).toContain('Do not infer it from these workflow instructions, other AI responses');
    expect(directive).toContain('attachments, code, identifiers, URLs, or filenames');
    expect(directive).toContain('Never quote, reproduce, summarize, mention, or explain it');
    expect(directive).toContain('The request to answer begins after the closing tag.');
    expect(prependResponseLanguagePolicy('original prompt', policy)).toBe(`${directive}\n\noriginal prompt`);
  });

  it('lets a fixed response-language preference override inferred question language', () => {
    const directive = responseLanguageDirective(createResponseLanguagePolicy('de', 'en'));

    expect(directive).toContain('explicit output-language request(s)');
    expect(directive).toContain('Otherwise, reply in German (de).');
    expect(directive).not.toContain('app interface language fallback');
  });

  it('restores the last valid policy tag from a retained snapshot prompt', () => {
    const policy = createResponseLanguagePolicy('auto', 'ja');
    const prompt = [
      '<response-language-policy version="1" setting="de" interface-locale="de">',
      prependResponseLanguagePolicy('original prompt', policy),
    ].join('\n');

    expect(responseLanguagePolicyFromPrompt(prompt)).toEqual(policy);
    expect(responseLanguagePolicyFromPrompt('<response-language-policy version="99" setting="auto" interface-locale="en">')).toBeUndefined();
    expect(isResponseLanguagePolicy(policy)).toBe(true);
  });

  it.each([
    ['请比较这个方案的证据和局限。', 'zh-CN'],
    ['請比較這個方案的證據與限制。', 'zh-TW'],
    ['What are the risks of this design?', 'en'],
    ['Should cities ban private cars downtown?', 'en'],
    ['Bitte erkläre die Risiken dieses Entwurfs.', 'de'],
    ['この設計の問題を説明してください。', 'ja'],
    ['你好', undefined],
    ['皇后是否重要？', undefined],
    ['人云亦云是否合理？', undefined],
    ['家境拮据是否正常？', undefined],
    ['请說明這个方案', undefined],
    ['What is 经济学?', undefined],
    ['What is 日本語?', undefined],
    ['Please explain the word カタカナ.', undefined],
    ['请解释TCP/IP协议的局限。', 'zh-CN'],
    ['请分析输入/输出语言的关系。', 'zh-CN'],
    ['Bonjour, expliquez les limites de cette solution.', undefined],
    ['Explique los límites de esta solución.', undefined],
    ['Wat is de invloed van AI in de zorg?', undefined],
    ['const value = 42;', undefined],
    ['✅ 123', undefined],
    ['https://example.com/请用简体中文.md', undefined],
  ])('conservatively infers the language and script of %s', (question, language) => {
    expect(inferQuestionLanguage(question)).toBe(language);
  });

  it('uses authored prose rather than code, quoted sources, links, filenames or attachment scaffolding', () => {
    const sources = [
      'Please use the attached file content below.',
      'Filename: English_notes_请用简体中文.md',
      'Type: Markdown',
      'Size: 123 bytes',
      '````md',
      '```js',
      'This is the English source. '.repeat(40),
      '```',
      '````',
      '> This is another English source. '.repeat(20),
      '“The quoted source is in English.”',
      '[English source](https://example.com/the-source)',
      '`EnglishIdentifier` https://example.com/the/source.md',
      '请解释这个设计的问题。',
    ].join('\n');
    expect(inferQuestionLanguage(sources)).toBe('zh-CN');
    expect(inferQuestionLanguage('Please explain the design.\n> 請使用繁體中文。\n「请使用简体中文。」')).toBe('en');
    expect(inferQuestionLanguage('```ts\n请解释这个设计\n')).toBeUndefined();
  });

  it('adds a concrete final language instruction independent of the English workflow and Traditional UI', () => {
    const policy = createResponseLanguagePolicy('auto', 'zh-TW');
    const prompt = prependResponseLanguagePolicy('English audit instructions and participant replies.', policy, '请比较这两个方案。');
    expect(prompt).toContain('Otherwise, write all natural-language text and follow-up questions in Simplified Chinese (zh-CN).');
    expect(prompt).toContain('所有正文和后续问题必须使用简体中文');
    expect(prompt.endsWith('</response-language-policy>')).toBe(true);
    expect(prompt.lastIndexOf('Simplified Chinese (zh-CN)')).toBeGreaterThan(prompt.indexOf('English audit instructions'));
    expect(responseLanguagePolicyFromPrompt(prompt)).toEqual(policy);
  });

  it('keeps explicit output-language, per-section and translation requests above any concrete default', () => {
    const policy = createResponseLanguagePolicy('auto', 'zh-TW');
    for (const question of ['请用英文回答这个问题。', '请将这句话翻译成西班牙语。', '请把标题用英文写，正文用中文写。']) {
      const prompt = prependResponseLanguagePolicy('Audit instructions', policy, question);
      const reminder = prompt.slice(prompt.lastIndexOf('<response-language-policy'));
      expect(reminder).toContain('explicit output-language requests');
      expect(reminder).toContain('per-section requests and translation targets');
      expect(reminder).toContain('take precedence');
      expect(reminder).toContain('Keep required parser headings and machine-readable control tags exactly as specified');
    }
  });

  it('keeps fixed language settings above question-language inference and retains the fallback for unknown input', () => {
    const fixed = prependResponseLanguagePolicy('Audit instructions', createResponseLanguagePolicy('de', 'en'), '请解释这个问题。');
    expect(fixed).toContain('Otherwise, write all natural-language text and follow-up questions in German (de).');
    expect(fixed).not.toContain('Simplified Chinese');
    const policy = createResponseLanguagePolicy('auto', 'zh-TW');
    expect(prependResponseLanguagePolicy('Audit instructions', policy, '123')).toBe(prependResponseLanguagePolicy('Audit instructions', policy));
    expect(prependResponseLanguagePolicy('Original', undefined, '请解释这个问题。')).toBe('Original');
  });
});

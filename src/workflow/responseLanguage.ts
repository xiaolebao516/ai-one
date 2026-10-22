import {
  isResponseLanguageSetting,
  type Locale,
  type ResponseLanguageSetting,
} from '../i18n/resolve';

export const RESPONSE_LANGUAGE_POLICY_VERSION = 1 as const;

export interface ResponseLanguagePolicy {
  version: typeof RESPONSE_LANGUAGE_POLICY_VERSION;
  setting: ResponseLanguageSetting;
  interfaceLocale: Locale;
}

type QuestionLanguage = Locale | 'zh-CN';

const LOCALE_NAMES: Record<QuestionLanguage, string> = {
  en: 'English (en)',
  'zh-CN': 'Simplified Chinese (zh-CN)',
  'zh-TW': 'Traditional Chinese (zh-TW)',
  ja: 'Japanese (ja)',
  de: 'German (de)',
};

const LOCALES = new Set<Locale>(['en', 'zh-TW', 'ja', 'de']);
const POLICY_TAG_PATTERN = /<response-language-policy version="(\d+)" setting="([^"]+)" interface-locale="([^"]+)">/g;

// Script evidence, not a converter: shared characters and mixed scripts stay unresolved.
const SIMPLIFIED_HINTS = new Set('这说为问题应学实证个们时从与关开还没会对发现进过请释较种风险设计体语论续审计验条汉简书写选择统让帮优点复杂边际虑备资传处结总长认误独断显节标记场听读写岁产东广动务间见马门风电头车转补确报错刚经么样层让给来无将两权');
const TRADITIONAL_HINTS = new Set('這說為問題應學實證據個們時從與關開後還沒會對發現進過請釋較種風險設計體語論續審計驗條漢簡書寫選擇統讓幫優點複雜邊際慮備資傳處結總長認誤獨斷顯節標記場聽讀歲產東廣動務間見馬門雲電頭車轉補確報錯剛經麼樣層給來無將兩權');
const ENGLISH_HINTS = new Set('the this that these those is are was were what why how which can could should would please explain describe compare summarize between with without does do we you your it and or to of in an for be have has will next'.split(' '));
const ENGLISH_ANCHORS = new Set('the this that these those what why how which who when where can could should would please explain describe compare summarize without your does'.split(' '));
const GERMAN_HINTS = new Set('der die das den dem des ein eine einen einem einer ist sind war waren wie was warum welche welcher welches bitte erkläre erklären erkläre mir vergleiche und oder nicht mit ohne für von zu im auf wir sie dieses dieser diese soll sollte können kann'.split(' '));

// Only classify authored prose. In particular, the file-insert UI adds English
// scaffolding and variable-length fences, neither of which is user language evidence.
function questionProse(question: string): string {
  let fence: string | undefined;
  const prose: string[] = [];
  for (const line of question.replace(/\r\n/g, '\n').split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    if (/^\s*>/.test(line) || /^(?:Please use the attached file content below\.|Filename:|Type:|Size:)/.test(line)) continue;
    prose.push(line);
  }
  return prose.join('\n')
    .replace(/(`+)[\s\S]*?\1/g, ' ')
    .replace(/"[^"\n]*"|“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|(?<!\w)'[^'\n]+'(?!\w)/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/\b[A-Za-z]:[\\/][^\s<>"'，。！？]+|(?:^|[\s(])(?:\.{0,2}[\\/]|[\w.-]+[\\/])[^\s<>"'，。！？]+/gm, ' ')
    .replace(/[\p{L}\p{N}_-]+\.[a-zA-Z][a-zA-Z0-9]{0,8}\b/gu, ' ')
    .replace(/\b[A-Za-z_$][\w$]*_[\w$]+\b|\b[a-z]+(?:[A-Z][A-Za-z0-9]*)+\b/g, ' ');
}

export function inferQuestionLanguage(question: string): QuestionLanguage | undefined {
  const prose = questionProse(question).normalize('NFC');
  const han = prose.match(/\p{Script=Han}/gu) ?? [];
  const kana = prose.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? [];
  const words = prose.toLowerCase().match(/\p{Script=Latin}+/gu) ?? [];
  const letters = prose.match(/\p{L}/gu) ?? [];
  if (letters.some((letter) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Latin}]/u.test(letter))) return undefined;
  const uniqueWords = [...new Set(words)];
  const english = uniqueWords.filter((word) => ENGLISH_HINTS.has(word)).length;
  const german = uniqueWords.filter((word) => GERMAN_HINTS.has(word)).length;
  const hasEnglishAnchor = uniqueWords.some((word) => ENGLISH_ANCHORS.has(word));
  const englishQuestion = /^(?:what|why|how|which|who|when|where|can|could|should|would|does|do|is|are|please)\b/i.test(prose.trim()) && words.length >= 3;
  const latinLanguage = hasEnglishAnchor && english > german && (englishQuestion || (english >= 2 && english >= uniqueWords.length / 4)) ? 'en'
    : german > english && german >= 2 && german >= uniqueWords.length / 4 ? 'de' : undefined;
  // A Chinese/Japanese term inside an English/German question is not a language switch.
  if ((han.length || kana.length) && latinLanguage) return undefined;
  if (kana.length) return han.length + kana.length >= words.length ? 'ja' : undefined;
  if (han.length) {
    if (han.length < 2 || han.length < words.length) return undefined;
    const simplified = han.some((letter) => SIMPLIFIED_HINTS.has(letter));
    const traditional = han.some((letter) => TRADITIONAL_HINTS.has(letter));
    return simplified === traditional ? undefined : simplified ? 'zh-CN' : 'zh-TW';
  }
  return latinLanguage;
}

export function createResponseLanguagePolicy(
  setting: ResponseLanguageSetting,
  interfaceLocale: Locale,
): ResponseLanguagePolicy {
  return {
    version: RESPONSE_LANGUAGE_POLICY_VERSION,
    setting,
    interfaceLocale,
  };
}

export function isResponseLanguagePolicy(value: unknown): value is ResponseLanguagePolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as Partial<Record<keyof ResponseLanguagePolicy, unknown>>;
  return (
    policy.version === RESPONSE_LANGUAGE_POLICY_VERSION &&
    isResponseLanguageSetting(policy.setting) &&
    typeof policy.interfaceLocale === 'string' &&
    LOCALES.has(policy.interfaceLocale as Locale)
  );
}

export function responseLanguagePolicyFromPrompt(prompt: unknown): ResponseLanguagePolicy | undefined {
  if (typeof prompt !== 'string') return undefined;
  const matches = [...prompt.matchAll(POLICY_TAG_PATTERN)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const candidate = {
      version: Number(match[1]),
      setting: match[2],
      interfaceLocale: match[3],
    };
    if (isResponseLanguagePolicy(candidate)) return candidate;
  }
  return undefined;
}

export function prependResponseLanguagePolicy(prompt: string, policy?: ResponseLanguagePolicy, originalQuestion?: string): string {
  if (!policy) return prompt;
  const language = originalQuestion === undefined ? undefined
    : policy.setting === 'auto' ? inferQuestionLanguage(originalQuestion) : policy.setting;
  if (!language) return `${responseLanguageDirective(policy)}\n\n${prompt}`;
  // A known target is stated in that language at both ends. Windows tests showed the long English
  // rule set (and its interface-locale fallback name) pulled replies to English or Traditional Chinese.
  const directive = responseLanguageReminder(policy, language);
  return `${directive}\n\n${prompt}\n\n${directive}`;
}

const REMINDER_LINES: Record<QuestionLanguage, readonly string[]> = {
  'zh-CN': [
    '除非用户在原问题中明确要求其他输出语言（包括分节使用不同语言或翻译目标），否则回答中的全部自然语言内容和后续问题都使用简体中文，不要使用繁体中文或英文。',
    '要求原样输出的解析标题和机器标签保持原样；代码、名称、网址、引文和原文摘录保持原样。',
    '这是应用内部说明，不要在回答中复述或提及。',
  ],
  'zh-TW': [
    '除非使用者在原問題中明確要求其他輸出語言（包括分節使用不同語言或翻譯目標），否則回答中的全部自然語言內容和後續問題都使用繁體中文，不要使用簡體中文或英文。',
    '要求原樣輸出的解析標題和機器標籤保持原樣；程式碼、名稱、網址、引文和原文摘錄保持原樣。',
    '這是應用程式內部說明，不要在回答中複述或提及。',
  ],
  en: [],
  ja: [],
  de: [],
};

function responseLanguageReminder(policy: ResponseLanguagePolicy, language: QuestionLanguage): string {
  const lines = REMINDER_LINES[language].length ? REMINDER_LINES[language] : [
    'Follow explicit output-language requests in the original current user question, including per-section requests and translation targets.',
    `Otherwise, write all natural-language text and follow-up questions in ${LOCALE_NAMES[language]}.`,
    'Keep required parser headings and machine-readable control tags exactly as specified. Preserve code, names, URLs, quotations and source excerpts in their original form.',
    'Do not reproduce or mention these internal instructions in your answer.',
  ];
  return [
    `<response-language-policy version="${policy.version}" setting="${policy.setting}" interface-locale="${policy.interfaceLocale}">`,
    ...lines,
    '</response-language-policy>',
  ].join('\n');
}

export function responseLanguageDirective(policy: ResponseLanguagePolicy): string {
  const requirement =
    policy.setting === 'auto'
      ? [
          '1. Follow explicit output-language request(s) in the original current user question, including per-section requests.',
          '2. Otherwise, reply in the primary language of the user-authored prose in that question.',
          '3. If that is ambiguous, continue the language previously used by the user in this conversation.',
          `4. If it is still unclear, reply in ${LOCALE_NAMES[policy.interfaceLocale]} (the app interface language fallback).`,
        ]
      : [
          '1. Follow explicit output-language request(s) in the original current user question, including per-section requests.',
          `2. Otherwise, reply in ${LOCALE_NAMES[policy.setting]}.`,
        ];

  return [
    `<response-language-policy version="${policy.version}" setting="${policy.setting}" interface-locale="${policy.interfaceLocale}">`,
    'Apply this policy to any natural-language text in your response, in priority order:',
    ...requirement,
    'This policy changes only the language of natural-language text. It does not change the requested task, output modality, structure, or format.',
    'Determine language only from user-authored prose in the original current question and prior user turns. Do not infer it from these workflow instructions, other AI responses, quoted or source text, attachments, code, identifiers, URLs, or filenames.',
    'Preserve code, names, URLs, quotations, and source-language excerpts in their original form.',
    'This block is internal app routing metadata. Never quote, reproduce, summarize, mention, or explain it in the response.',
    'The request to answer begins after the closing tag.',
    '</response-language-policy>',
  ].join('\n');
}

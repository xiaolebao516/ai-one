/**
 * Coordination Settings Data Model (Spec #108 / Design gaps §8)
 *
 * Local preferences for task coordination written into task issue briefs for CC execution.
 */

import { getLocalStoreFs, type LocalStoreFs } from '../host/localStore';

export type ExceedLimitAction = 'ask_user' | 'consult_opus';
export type QuotaTightAction = 'auto_reassign' | 'ask_user';
export type AuthExpiredAction = 'ask_user' | 'fallback_ai';

export interface CoordinationSettings {
  schemaVersion: 1;
  reworkLimit: number;
  onExceedLimit: ExceedLimitAction;
  onQuotaTight: QuotaTightAction;
  onAuthExpired: AuthExpiredAction;
  aiPreferences: Record<string, string>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const COORDINATION_SETTINGS_STORAGE_KEY = 'coordination.json';
export const COORDINATION_SETTINGS_BACKUP_KEY = 'coordination.json.bak';

export const DEFAULT_AI_PREFERENCES: Record<string, string> = {
  gpt: '执行、审计',
  opus: '架构、终审',
  argon: '独立想法',
};

export const DEFAULT_COORDINATION_SETTINGS: Readonly<CoordinationSettings> = Object.freeze({
  schemaVersion: 1,
  reworkLimit: 3,
  onExceedLimit: 'ask_user',
  onQuotaTight: 'auto_reassign',
  onAuthExpired: 'ask_user',
  aiPreferences: { ...DEFAULT_AI_PREFERENCES },
});

export const EXCEED_LIMIT_OPTIONS = [
  { value: 'ask_user' as const, label: '问我', brief: '超限问用户' },
  { value: 'consult_opus' as const, label: '先请 Opus 网页裁决，再问我', brief: '先请 Opus 网页裁决，再问用户' },
];

export const QUOTA_TIGHT_OPTIONS = [
  { value: 'auto_reassign' as const, label: 'CC 自动改派并通知我', brief: '自动改派并通知用户' },
  { value: 'ask_user' as const, label: '先问我', brief: '先问用户' },
];

export const AUTH_EXPIRED_OPTIONS = [
  { value: 'ask_user' as const, label: '先问我', brief: '先问用户' },
  { value: 'fallback_ai' as const, label: '用其他 AI 代替并通知我', brief: '用其他 AI 代替并通知用户' },
];

export interface ValidationResult {
  valid: boolean;
  settings: CoordinationSettings;
  errors: string[];
}

/**
 * Sanitize preference text to strictly safe plain text, stripping any Markdown syntax,
 * HTML tags, links, images, code markers, headers, and control characters.
 * Neutralizes URL schemes, www prefixes, @ mentions, and email addresses to prevent GitHub autolinks.
 */
export function sanitizePreferenceValue(value: string): string {
  // Neutralize URL schemes and www prefixes so GitHub Markdown does not autolink them
  const preprocessed = value.replace(/https?:\/\//gi, ' ').replace(/\bwww\./gi, ' ');
  let cleaned = '';
  for (let i = 0; i < preprocessed.length; i++) {
    const code = preprocessed.charCodeAt(i);
    // Strip control chars (0-31, 127-159)
    if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) {
      cleaned += ' ';
    } else {
      const ch = preprocessed[i];
      // Strip markdown, HTML, and punctuation markers: # ` * _ ~ [ ] ( ) ! < > \ | @
      if (
        ch === '#' ||
        ch === '`' ||
        ch === '*' ||
        ch === '_' ||
        ch === '~' ||
        ch === '[' ||
        ch === ']' ||
        ch === '(' ||
        ch === ')' ||
        ch === '!' ||
        ch === '<' ||
        ch === '>' ||
        ch === '\\' ||
        ch === '|' ||
        ch === '@'
      ) {
        cleaned += ' ';
      } else {
        cleaned += ch;
      }
    }
  }
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 50);
}

export function sanitizePreferenceKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
}

export function validateCoordinationSettings(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      settings: { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } },
      errors: ['Settings must be a non-null object'],
    };
  }

  const candidate = raw as Record<string, unknown>;

  // schemaVersion must be exact integer 1 (not null, not "1", not 2, not undefined)
  if (candidate.schemaVersion !== 1 || typeof candidate.schemaVersion !== 'number') {
    return {
      valid: false,
      settings: { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } },
      errors: [`Unsupported, non-numeric, or missing schemaVersion: expected 1, received ${String(candidate.schemaVersion)}`],
    };
  }

  // reworkLimit: integer between 1 and 10
  let reworkLimit = DEFAULT_COORDINATION_SETTINGS.reworkLimit;
  if (
    typeof candidate.reworkLimit === 'number' &&
    Number.isInteger(candidate.reworkLimit) &&
    candidate.reworkLimit >= 1 &&
    candidate.reworkLimit <= 10
  ) {
    reworkLimit = candidate.reworkLimit;
  } else {
    errors.push(`Invalid reworkLimit: must be an integer between 1 and 10, received ${String(candidate.reworkLimit)}`);
  }

  // onExceedLimit
  let onExceedLimit: ExceedLimitAction = DEFAULT_COORDINATION_SETTINGS.onExceedLimit;
  if (candidate.onExceedLimit === 'ask_user' || candidate.onExceedLimit === 'consult_opus') {
    onExceedLimit = candidate.onExceedLimit;
  } else {
    errors.push(`Invalid onExceedLimit: received ${String(candidate.onExceedLimit)}`);
  }

  // onQuotaTight
  let onQuotaTight: QuotaTightAction = DEFAULT_COORDINATION_SETTINGS.onQuotaTight;
  if (candidate.onQuotaTight === 'auto_reassign' || candidate.onQuotaTight === 'ask_user') {
    onQuotaTight = candidate.onQuotaTight;
  } else {
    errors.push(`Invalid onQuotaTight: received ${String(candidate.onQuotaTight)}`);
  }

  // onAuthExpired
  let onAuthExpired: AuthExpiredAction = DEFAULT_COORDINATION_SETTINGS.onAuthExpired;
  if (candidate.onAuthExpired === 'ask_user' || candidate.onAuthExpired === 'fallback_ai') {
    onAuthExpired = candidate.onAuthExpired;
  } else {
    errors.push(`Invalid onAuthExpired: received ${String(candidate.onAuthExpired)}`);
  }

  // aiPreferences: validate keys and values with injection defenses
  let aiPreferences: Record<string, string> = { ...DEFAULT_AI_PREFERENCES };
  if (candidate.aiPreferences && typeof candidate.aiPreferences === 'object' && !Array.isArray(candidate.aiPreferences)) {
    const prefs: Record<string, string> = {};
    for (const [rawKey, rawVal] of Object.entries(candidate.aiPreferences as Record<string, unknown>)) {
      if (typeof rawVal === 'string') {
        const cleanKey = sanitizePreferenceKey(rawKey);
        const cleanVal = sanitizePreferenceValue(rawVal);
        if (cleanKey.length > 0 && cleanVal.length > 0) {
          prefs[cleanKey] = cleanVal;
        }
      }
    }
    if (Object.keys(prefs).length > 0) {
      aiPreferences = prefs;
    } else {
      errors.push('Empty or invalid aiPreferences map; falling back to default preferences');
    }
  } else if (candidate.aiPreferences !== undefined) {
    errors.push('Invalid aiPreferences format; falling back to defaults');
  }

  return {
    valid: errors.length === 0,
    settings: {
      schemaVersion: 1,
      reworkLimit,
      onExceedLimit,
      onQuotaTight,
      onAuthExpired,
      aiPreferences,
    },
    errors,
  };
}

export function parseCoordinationSettingsWithRecovery(rawJson: string | null | undefined): {
  settings: CoordinationSettings;
  recovered: boolean;
  corruptBackup?: string;
} {
  if (!rawJson || !rawJson.trim()) {
    return {
      settings: { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } },
      recovered: false,
    };
  }

  try {
    const parsed = JSON.parse(rawJson);
    const result = validateCoordinationSettings(parsed);
    return {
      settings: result.settings,
      recovered: !result.valid,
      corruptBackup: !result.valid ? rawJson : undefined,
    };
  } catch {
    return {
      settings: { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } },
      recovered: true,
      corruptBackup: rawJson,
    };
  }
}

export function serializeCoordinationSettings(settings: CoordinationSettings): string {
  const result = validateCoordinationSettings(settings);
  return JSON.stringify(result.settings, null, 2);
}

export function renderCoordinationBrief(settings: CoordinationSettings): string {
  const valid = validateCoordinationSettings(settings).settings;

  const exceedOpt = EXCEED_LIMIT_OPTIONS.find((o) => o.value === valid.onExceedLimit);
  const exceedText = exceedOpt ? exceedOpt.brief : '超限问用户';

  const quotaOpt = QUOTA_TIGHT_OPTIONS.find((o) => o.value === valid.onQuotaTight);
  const quotaText = quotaOpt ? quotaOpt.brief : '自动改派并通知用户';

  const authOpt = AUTH_EXPIRED_OPTIONS.find((o) => o.value === valid.onAuthExpired);
  const authText = authOpt ? authOpt.brief : '先问用户';

  const aiNameMap: Record<string, string> = {
    gpt: 'GPT',
    opus: 'Opus',
    argon: 'Argon',
  };

  const aiEntries = Object.entries(valid.aiPreferences)
    .map(([key, role]) => {
      const name = aiNameMap[key.toLowerCase()] ?? (key ? key.toUpperCase() : 'AI');
      return `${name}（${sanitizePreferenceValue(role)}）`;
    })
    .join('、');

  const lines = [
    '## 协调简报',
    `- 返工上限：${valid.reworkLimit} 轮，${exceedText}`,
    `- 额度紧张：${quotaText}`,
    `- 登录失效：${authText}`,
  ];

  if (aiEntries) {
    lines.push(`- 优先使用：${aiEntries}`);
  }

  return lines.join('\n');
}

/**
 * Finds the exact character index range of a top-level section heading (not inside ``` or ~~~ code blocks).
 * Matches strictly the exact heading title (no suffix such as "## 协调简报说明").
 * Accurately tracks CRLF and LF byte/character offsets without drift.
 */
function findTopLevelSection(markdown: string, headingTitle: string): { start: number; end: number } | null {
  const lineRegex = /^([^\r\n]*)(\r?\n|$)/gm;
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let targetStart = -1;
  let targetEnd = -1;
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(markdown)) !== null) {
    const line = match[1];
    const lineStart = match.index;

    if (fenceChar === null) {
      const fenceMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        fenceChar = fenceMatch[1][0];
        fenceLen = fenceMatch[1].length;
      } else {
        // Exact match for "## <title>" (trailing whitespace allowed, but no extra suffix letters)
        if (line.trimEnd() === `## ${headingTitle}`) {
          targetStart = lineStart;
        } else if (targetStart !== -1 && /^##\s+\S/.test(line)) {
          targetEnd = lineStart;
          break;
        }
      }
    } else {
      const closeMatch = line.match(/^[ ]{0,3}(`{3,}|~{3,})\s*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
    }

    if (match[2] === '') break;
  }

  if (targetStart !== -1) {
    if (targetEnd === -1) targetEnd = markdown.length;
    return { start: targetStart, end: targetEnd };
  }

  return null;
}

/**
 * Injects or updates the coordination brief section into a Task Issue body markdown.
 * Safely ignores occurrences inside fenced code blocks (``` or ~~~).
 * Accurately normalizes brief line breaks to match the document's line ending style (CRLF / LF).
 */
export function injectCoordinationBrief(issueBody: string, settings: CoordinationSettings): string {
  let brief = renderCoordinationBrief(settings);
  const isCrlf = issueBody.includes('\r\n');
  if (isCrlf) {
    brief = brief.replace(/\r?\n/g, '\r\n');
  }
  const sep = isCrlf ? '\r\n\r\n' : '\n\n';
  const nl = isCrlf ? '\r\n' : '\n';
  const existingBrief = findTopLevelSection(issueBody, '协调简报');

  if (existingBrief) {
    const before = issueBody.slice(0, existingBrief.start);
    const after = issueBody.slice(existingBrief.end).replace(/^(\r?\n)+/, '');
    return `${before}${brief}${sep}${after}`.trimEnd() + nl;
  }

  // Prepend before top-level ## 任务与范围 or append to the end
  const taskSection = findTopLevelSection(issueBody, '任务与范围');
  if (taskSection) {
    const before = issueBody.slice(0, taskSection.start).trimEnd();
    const after = issueBody.slice(taskSection.start).trimStart();
    const prefix = before ? `${before}${sep}` : '';
    return `${prefix}${brief}${sep}${after}`.trimEnd() + nl;
  }

  return `${issueBody.trimEnd()}${sep}${brief}${nl}`;
}

/**
 * Builds standard Task Issue markdown body with coordination brief injected.
 */
export function buildTaskIssueBody(
  description: string,
  settings: CoordinationSettings = loadCoordinationSettings(),
): string {
  const base = [
    '## 任务与范围',
    description.trim() || '（待补充描述）',
    '',
    '## 交付 / 验收标准',
    '- [ ] 完成并经独立审计 PASS',
  ].join('\n');
  return injectCoordinationBrief(base, settings);
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadCoordinationSettings(storage: StorageLike | undefined = defaultStorage()): CoordinationSettings {
  try {
    const raw = storage?.getItem(COORDINATION_SETTINGS_STORAGE_KEY);
    const parsed = parseCoordinationSettingsWithRecovery(raw);
    if (parsed.recovered && parsed.corruptBackup && storage) {
      try {
        storage.setItem(COORDINATION_SETTINGS_BACKUP_KEY, parsed.corruptBackup);
      } catch {
        // backup is best-effort
      }
    }
    return parsed.settings;
  } catch {
    return { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } };
  }
}

export function saveCoordinationSettings(
  settings: CoordinationSettings,
  storage: StorageLike | undefined = defaultStorage(),
): { success: boolean; error?: string } {
  if (!storage) {
    return { success: false, error: '本地存储不可用' };
  }
  try {
    const serialized = serializeCoordinationSettings(settings);
    storage.setItem(COORDINATION_SETTINGS_STORAGE_KEY, serialized);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '写入本地存储失败';
    return { success: false, error: msg };
  }
}

export interface LoadCoordinationResult {
  settings: CoordinationSettings;
  status: 'fresh' | 'ok' | 'recovered';
  backup?: string;
  reason?: string;
}

export async function loadCoordination(fs: LocalStoreFs = getLocalStoreFs()): Promise<LoadCoordinationResult> {
  const read = await fs.read('coordination');
  if (read.status === 'missing') {
    return {
      settings: { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } },
      status: 'fresh',
    };
  }

  if (read.status === 'corrupt') {
    return {
      settings: { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } },
      status: 'recovered',
      ...(read.backup ? { backup: read.backup } : {}),
      reason: 'corrupt-file',
    };
  }

  if (!read.text) {
    const backup = await fs.quarantine('coordination');
    return {
      settings: { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } },
      status: 'recovered',
      ...(backup ? { backup } : {}),
      reason: 'bad-shape',
    };
  }

  const parsed = parseCoordinationSettingsWithRecovery(read.text);
  if (parsed.recovered) {
    const backup = await fs.quarantine('coordination');
    return {
      settings: parsed.settings,
      status: 'recovered',
      ...(backup ? { backup } : {}),
      reason: parsed.corruptBackup ? 'corrupt-json' : 'invalid-schema',
    };
  }

  return { settings: parsed.settings, status: 'ok' };
}

export async function saveCoordination(
  settings: CoordinationSettings,
  fs: LocalStoreFs = getLocalStoreFs(),
): Promise<{ success: boolean; error?: string }> {
  const validation = validateCoordinationSettings(settings);
  if (!validation.valid) {
    return { success: false, error: '设置校验失败：' + validation.errors.join('；') };
  }
  try {
    const serialized = serializeCoordinationSettings(settings);
    await fs.write('coordination', serialized);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '写入本地文件失败';
    return { success: false, error: msg };
  }
}


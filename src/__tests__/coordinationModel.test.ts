import { describe, expect, it } from 'vitest';
import {
  COORDINATION_SETTINGS_BACKUP_KEY,
  COORDINATION_SETTINGS_STORAGE_KEY,
  DEFAULT_COORDINATION_SETTINGS,
  buildTaskIssueBody,
  injectCoordinationBrief,
  loadCoordination,
  loadCoordinationSettings,
  parseCoordinationSettingsWithRecovery,
  renderCoordinationBrief,
  sanitizePreferenceKey,
  sanitizePreferenceValue,
  saveCoordination,
  saveCoordinationSettings,
  serializeCoordinationSettings,
  validateCoordinationSettings,
  type CoordinationSettings,
  type StorageLike,
} from '../stages/coordinationModel';
import { browserLocalStoreFs, type LocalStoreFs } from '../host/localStore';

describe('coordinationModel', () => {
  it('provides valid default settings', () => {
    expect(DEFAULT_COORDINATION_SETTINGS.schemaVersion).toBe(1);
    expect(DEFAULT_COORDINATION_SETTINGS.reworkLimit).toBe(3);
    expect(DEFAULT_COORDINATION_SETTINGS.onExceedLimit).toBe('ask_user');
    expect(DEFAULT_COORDINATION_SETTINGS.onQuotaTight).toBe('auto_reassign');
    expect(DEFAULT_COORDINATION_SETTINGS.onAuthExpired).toBe('ask_user');
    expect(DEFAULT_COORDINATION_SETTINGS.aiPreferences).toEqual({
      gpt: '执行、审计',
      opus: '架构、终审',
      argon: '独立想法',
    });

    const validated = validateCoordinationSettings(DEFAULT_COORDINATION_SETTINGS);
    expect(validated.valid).toBe(true);
    expect(validated.errors).toHaveLength(0);
  });

  describe('sanitization and anti-injection', () => {
    it('strips newlines, hashes, and control characters from preference values', () => {
      const malicious = '角色\n## 恶意注入标题\r\n`rm -rf /`\t\0更多内容';
      const cleaned = sanitizePreferenceValue(malicious);
      expect(cleaned).not.toContain('\n');
      expect(cleaned).not.toContain('\r');
      expect(cleaned).not.toContain('#');
      expect(cleaned).not.toContain('`');
      expect(cleaned).toBe('角色 恶意注入标题 rm -rf / 更多内容');
    });

    it('neutralizes Markdown links, images, HTML tags and formatting into plain text', () => {
      expect(sanitizePreferenceValue('[链接文字](https://evil.com)')).toBe('链接文字 evil.com');
      expect(sanitizePreferenceValue('![图片描述](https://evil.com/img.png)')).toBe('图片描述 evil.com/img.png');
      expect(sanitizePreferenceValue('http://evil.com/path and www.evil.com')).toBe('evil.com/path and evil.com');
      expect(sanitizePreferenceValue('<script>alert("xss")</script>')).toBe('script alert "xss" /script');
      expect(sanitizePreferenceValue('**粗体**与*斜体*~删除线~')).toBe('粗体 与 斜体 删除线');
    });

    it('limits preference length to 50 characters', () => {
      const longText = 'a'.repeat(100);
      expect(sanitizePreferenceValue(longText)).toHaveLength(50);
    });

    it('sanitizes AI identifier keys to alphanumeric safe tokens', () => {
      expect(sanitizePreferenceKey('GPT-4o')).toBe('gpt-4o');
      expect(sanitizePreferenceKey('Claude_3.5')).toBe('claude_35');
      expect(sanitizePreferenceKey('Bad Key!#$')).toBe('badkey');
    });
  });

  describe('validateCoordinationSettings', () => {
    it('strictly resets to default when schemaVersion is invalid (null, undefined, string, future version)', () => {
      expect(validateCoordinationSettings({ schemaVersion: 2, reworkLimit: 9 }).valid).toBe(false);
      expect(validateCoordinationSettings({ schemaVersion: 2, reworkLimit: 9 }).settings).toEqual(DEFAULT_COORDINATION_SETTINGS);

      expect(validateCoordinationSettings({ schemaVersion: '1', reworkLimit: 5 }).valid).toBe(false);
      expect(validateCoordinationSettings({ schemaVersion: null }).valid).toBe(false);
      expect(validateCoordinationSettings({ schemaVersion: undefined }).valid).toBe(false);
      expect(validateCoordinationSettings({}).valid).toBe(false);
    });

    it('accepts boundary rework limits (1 and 10)', () => {
      const lower = validateCoordinationSettings({
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 1,
      });
      expect(lower.valid).toBe(true);
      expect(lower.settings.reworkLimit).toBe(1);

      const upper = validateCoordinationSettings({
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 10,
      });
      expect(upper.valid).toBe(true);
      expect(upper.settings.reworkLimit).toBe(10);
    });

    it('rejects out-of-range or non-integer rework limits and recovers default', () => {
      const tooLow = validateCoordinationSettings({
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 0,
      });
      expect(tooLow.valid).toBe(false);
      expect(tooLow.settings.reworkLimit).toBe(3);

      const tooHigh = validateCoordinationSettings({
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 11,
      });
      expect(tooHigh.valid).toBe(false);
      expect(tooHigh.settings.reworkLimit).toBe(3);

      const floatVal = validateCoordinationSettings({
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 3.5,
      });
      expect(floatVal.valid).toBe(false);
      expect(floatVal.settings.reworkLimit).toBe(3);
    });

    it('validates enum values strictly', () => {
      const invalidAction = validateCoordinationSettings({
        ...DEFAULT_COORDINATION_SETTINGS,
        onExceedLimit: 'invalid_action',
      });
      expect(invalidAction.valid).toBe(false);
      expect(invalidAction.settings.onExceedLimit).toBe('ask_user');

      const validOpus = validateCoordinationSettings({
        ...DEFAULT_COORDINATION_SETTINGS,
        onExceedLimit: 'consult_opus',
      });
      expect(validOpus.valid).toBe(true);
      expect(validOpus.settings.onExceedLimit).toBe('consult_opus');
    });

    it('recovers gracefully from non-object inputs', () => {
      expect(validateCoordinationSettings(null).valid).toBe(false);
      expect(validateCoordinationSettings(undefined).valid).toBe(false);
      expect(validateCoordinationSettings('random string').valid).toBe(false);
      expect(validateCoordinationSettings([1, 2, 3]).valid).toBe(false);
    });
  });

  describe('parseCoordinationSettingsWithRecovery', () => {
    it('serializes settings to valid JSON', () => {
      const json = serializeCoordinationSettings(DEFAULT_COORDINATION_SETTINGS);
      expect(JSON.parse(json)).toEqual(DEFAULT_COORDINATION_SETTINGS);
    });

    it('parses valid JSON string', () => {
      const json = JSON.stringify({
        schemaVersion: 1,
        reworkLimit: 5,
        onExceedLimit: 'consult_opus',
        onQuotaTight: 'ask_user',
        onAuthExpired: 'fallback_ai',
        aiPreferences: { gpt: '编码', opus: '架构' },
      });
      const parsed = parseCoordinationSettingsWithRecovery(json);
      expect(parsed.recovered).toBe(false);
      expect(parsed.settings.reworkLimit).toBe(5);
      expect(parsed.settings.onExceedLimit).toBe('consult_opus');
      expect(parsed.settings.onQuotaTight).toBe('ask_user');
      expect(parsed.settings.onAuthExpired).toBe('fallback_ai');
    });

    it('recovers from malformed JSON and saves corrupt backup candidate', () => {
      const broken = '{ broken json ...';
      const parsed = parseCoordinationSettingsWithRecovery(broken);
      expect(parsed.recovered).toBe(true);
      expect(parsed.settings).toEqual(DEFAULT_COORDINATION_SETTINGS);
      expect(parsed.corruptBackup).toBe(broken);
    });

    it('recovers from empty or blank strings without flagging error', () => {
      expect(parseCoordinationSettingsWithRecovery('').recovered).toBe(false);
      expect(parseCoordinationSettingsWithRecovery(null).recovered).toBe(false);
      expect(parseCoordinationSettingsWithRecovery(undefined).recovered).toBe(false);
    });
  });

  describe('renderCoordinationBrief', () => {
    it('renders exact brief text matching design prototype', () => {
      const brief = renderCoordinationBrief(DEFAULT_COORDINATION_SETTINGS);
      expect(brief).toBe(
        [
          '## 协调简报',
          '- 返工上限：3 轮，超限问用户',
          '- 额度紧张：自动改派并通知用户',
          '- 登录失效：先问用户',
          '- 优先使用：GPT（执行、审计）、Opus（架构、终审）、Argon（独立想法）',
        ].join('\n'),
      );
    });

    it('renders alternative choices correctly and rejects injected formatting', () => {
      const custom: CoordinationSettings = {
        schemaVersion: 1,
        reworkLimit: 5,
        onExceedLimit: 'consult_opus',
        onQuotaTight: 'ask_user',
        onAuthExpired: 'fallback_ai',
        aiPreferences: {
          gpt: '审计\n## 伪造小节',
          opus: '架构决策',
        },
      };

      const brief = renderCoordinationBrief(custom);
      expect(brief).not.toContain('\n## 伪造小节');
      expect(brief).toContain('GPT（审计 伪造小节）');
      expect(brief).toBe(
        [
          '## 协调简报',
          '- 返工上限：5 轮，先请 Opus 网页裁决，再问用户',
          '- 额度紧张：先问用户',
          '- 登录失效：用其他 AI 代替并通知用户',
          '- 优先使用：GPT（审计 伪造小节）、Opus（架构决策）',
        ].join('\n'),
      );
    });
  });

  describe('injectCoordinationBrief and buildTaskIssueBody', () => {
    it('injects brief before ## 任务与范围 if section does not exist', () => {
      const template = '# Task Title\n\n## 关联 / 派工\n- Owner: test\n\n## 任务与范围\n内容...\n';
      const output = injectCoordinationBrief(template, DEFAULT_COORDINATION_SETTINGS);

      expect(output).toContain('## 协调简报\n- 返工上限：3 轮');
      expect(output.indexOf('## 协调简报')).toBeLessThan(output.indexOf('## 任务与范围'));
    });

    it('safely ignores ## 任务与范围 and ## 协调简报 inside code fences', () => {
      const bodyWithFencedCode = [
        '# Title',
        '',
        '```markdown',
        '## 协调简报',
        '- 代码块示例中的旧简报',
        '## 任务与范围',
        '- 代码块示例任务',
        '```',
        '',
        '## 真实正文',
        '真实说明',
      ].join('\n');

      const injected = injectCoordinationBrief(bodyWithFencedCode, DEFAULT_COORDINATION_SETTINGS);
      // Fenced code block content must be strictly untouched
      expect(injected).toContain('- 代码块示例中的旧简报');
      expect(injected).toContain('- 代码块示例任务');
      // Real brief appended outside
      expect(injected).toContain('## 真实正文\n真实说明\n\n## 协调简报\n- 返工上限：3 轮');
    });

    it('replaces existing top-level ## 协调简报 cleanly without duplicating', () => {
      const existing = '# Task\n\n## 协调简报\n旧简报内容...\n\n## 任务与范围\n内容...\n';
      const updated = injectCoordinationBrief(existing, {
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 8,
      });

      expect(updated.match(/^## 协调简报/gm)).toHaveLength(1);
      expect(updated).toContain('- 返工上限：8 轮');
      expect(updated).not.toContain('旧简报内容');
    });

    it('does not replace headings with suffixes like ## 协调简报说明 or ## 任务与范围规范', () => {
      const bodyWithSuffixHeadings = [
        '# Title',
        '',
        '## 协调简报说明与指南',
        '这里是指南说明，不是真正的协调简报',
        '',
        '## 任务与范围规范',
        '这里是规范说明',
      ].join('\n');

      const injected = injectCoordinationBrief(bodyWithSuffixHeadings, DEFAULT_COORDINATION_SETTINGS);
      expect(injected).toContain('## 协调简报说明与指南\n这里是指南说明');
      expect(injected).toContain('## 任务与范围规范\n这里是规范说明');
      expect(injected).toContain('## 协调简报\n- 返工上限：3 轮');
    });

    it('preserves CRLF line endings accurately without character offset drift', () => {
      const crlfBody = '# Title\r\n\r\n## 关联 / 派工\r\n- Owner: test\r\n\r\n## 协调简报\r\n- 旧简报\r\n\r\n## 任务与范围\r\n描述内容\r\n';
      const updated = injectCoordinationBrief(crlfBody, {
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 5,
      });

      expect(updated).toContain('\r\n');
      expect(updated).toContain('## 协调简报\n- 返工上限：5 轮');
      expect(updated).toContain('## 任务与范围\r\n描述内容');
      expect(updated).not.toContain('旧简报');
    });

    it('buildTaskIssueBody creates ready-to-use task issue body containing brief', () => {
      const body = buildTaskIssueBody('实现某些特定能力', {
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 4,
      });
      expect(body).toContain('## 协调简报\n- 返工上限：4 轮');
      expect(body).toContain('## 任务与范围\n实现某些特定能力');
      expect(body).toContain('## 交付 / 验收标准');
    });
  });

  describe('load & save with StorageLike and recovery backup', () => {
    it('saves and reloads settings cleanly and reports success', () => {
      const mem = new Map<string, string>();
      const storage: StorageLike = {
        getItem: (k) => mem.get(k) ?? null,
        setItem: (k, v) => mem.set(k, v),
      };

      const initial = loadCoordinationSettings(storage);
      expect(initial).toEqual(DEFAULT_COORDINATION_SETTINGS);

      const modified: CoordinationSettings = {
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 4,
        onExceedLimit: 'consult_opus',
      };

      const res = saveCoordinationSettings(modified, storage);
      expect(res.success).toBe(true);
      expect(mem.has(COORDINATION_SETTINGS_STORAGE_KEY)).toBe(true);

      const loaded = loadCoordinationSettings(storage);
      expect(loaded.reworkLimit).toBe(4);
      expect(loaded.onExceedLimit).toBe('consult_opus');
    });

    it('preserves corrupted data to backup key on recovery load', () => {
      const mem = new Map<string, string>([[COORDINATION_SETTINGS_STORAGE_KEY, '{ corrupt-payload }']]);
      const storage: StorageLike = {
        getItem: (k) => mem.get(k) ?? null,
        setItem: (k, v) => mem.set(k, v),
      };

      const loaded = loadCoordinationSettings(storage);
      expect(loaded).toEqual(DEFAULT_COORDINATION_SETTINGS);
      expect(mem.get(COORDINATION_SETTINGS_BACKUP_KEY)).toBe('{ corrupt-payload }');
    });

    it('reports failure when storage throws and does not crash', () => {
      const brokenStorage: StorageLike = {
        getItem: () => {
          throw new Error('Storage read denied');
        },
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      };

      expect(() => loadCoordinationSettings(brokenStorage)).not.toThrow();
      expect(loadCoordinationSettings(brokenStorage)).toEqual(DEFAULT_COORDINATION_SETTINGS);

      const saveResult = saveCoordinationSettings(DEFAULT_COORDINATION_SETTINGS, brokenStorage);
      expect(saveResult.success).toBe(false);
      expect(saveResult.error).toContain('QuotaExceededError');
    });
  });

  describe('loadCoordination & saveCoordination with LocalStoreFs', () => {
    it('returns fresh defaults when file is missing in store', async () => {
      const mockFs: LocalStoreFs = {
        read: async () => ({ status: 'missing', text: null, backup: null }),
        write: async () => {},
        quarantine: async () => null,
        exportFile: async () => null,
      };

      const result = await loadCoordination(mockFs);
      expect(result.status).toBe('fresh');
      expect(result.settings).toEqual(DEFAULT_COORDINATION_SETTINGS);
    });

    it('saves settings to store and reloads successfully with status ok', async () => {
      const files = new Map<string, string>();
      const mockFs: LocalStoreFs = {
        read: async (name) => {
          const text = files.get(name);
          return text ? { status: 'ok', text, backup: null } : { status: 'missing', text: null, backup: null };
        },
        write: async (name, json) => {
          files.set(name, json);
        },
        quarantine: async (name) => {
          files.delete(name);
          return `${name}.json.bak-test`;
        },
        exportFile: async () => null,
      };

      const custom: CoordinationSettings = {
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 7,
        onExceedLimit: 'consult_opus',
      };

      const saveRes = await saveCoordination(custom, mockFs);
      expect(saveRes.success).toBe(true);

      const loadRes = await loadCoordination(mockFs);
      expect(loadRes.status).toBe('ok');
      expect(loadRes.settings.reworkLimit).toBe(7);
      expect(loadRes.settings.onExceedLimit).toBe('consult_opus');
    });

    it('quarantines corrupt store contents and returns recovered status with backup filename', async () => {
      let quarantinedBackup: string | null = null;
      const mockFs: LocalStoreFs = {
        read: async () => ({ status: 'corrupt', text: null, backup: 'coordination.json.bak-20261023' }),
        write: async () => {},
        quarantine: async () => {
          quarantinedBackup = 'coordination.json.bak-20261023';
          return quarantinedBackup;
        },
        exportFile: async () => null,
      };

      const result = await loadCoordination(mockFs);
      expect(result.status).toBe('recovered');
      expect(result.backup).toBe('coordination.json.bak-20261023');
      expect(result.settings).toEqual(DEFAULT_COORDINATION_SETTINGS);
    });

    it('refuses invalid settings on save with validation errors', async () => {
      const mockFs: LocalStoreFs = {
        read: async () => ({ status: 'missing', text: null, backup: null }),
        write: async () => {},
        quarantine: async () => null,
        exportFile: async () => null,
      };

      const invalid = {
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 99,
      };

      const res = await saveCoordination(invalid as unknown as CoordinationSettings, mockFs);
      expect(res.success).toBe(false);
      expect(res.error).toContain('设置校验失败');
    });

    it('works with browserLocalStoreFs end-to-end', async () => {
      const custom: CoordinationSettings = {
        ...DEFAULT_COORDINATION_SETTINGS,
        reworkLimit: 5,
        onAuthExpired: 'fallback_ai',
      };

      const saveRes = await saveCoordination(custom, browserLocalStoreFs);
      expect(saveRes.success).toBe(true);

      const loadRes = await loadCoordination(browserLocalStoreFs);
      expect(loadRes.status).toBe('ok');
      expect(loadRes.settings.reworkLimit).toBe(5);
      expect(loadRes.settings.onAuthExpired).toBe('fallback_ai');
    });
  });
});

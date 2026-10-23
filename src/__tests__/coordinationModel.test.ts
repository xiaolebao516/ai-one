import { describe, expect, it } from 'vitest';
import {
  COORDINATION_SETTINGS_STORAGE_KEY,
  DEFAULT_COORDINATION_SETTINGS,
  loadCoordinationSettings,
  parseCoordinationSettingsWithRecovery,
  renderCoordinationBrief,
  saveCoordinationSettings,
  serializeCoordinationSettings,
  validateCoordinationSettings,
  type CoordinationSettings,
  type StorageLike,
} from '../stages/coordinationModel';

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

  describe('validateCoordinationSettings', () => {
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

    it('recovers from malformed JSON', () => {
      const parsed = parseCoordinationSettingsWithRecovery('{ broken json ...');
      expect(parsed.recovered).toBe(true);
      expect(parsed.settings).toEqual(DEFAULT_COORDINATION_SETTINGS);
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

    it('renders alternative choices correctly', () => {
      const custom: CoordinationSettings = {
        schemaVersion: 1,
        reworkLimit: 5,
        onExceedLimit: 'consult_opus',
        onQuotaTight: 'ask_user',
        onAuthExpired: 'fallback_ai',
        aiPreferences: {
          gpt: '审计',
          opus: '架构决策',
        },
      };

      const brief = renderCoordinationBrief(custom);
      expect(brief).toBe(
        [
          '## 协调简报',
          '- 返工上限：5 轮，先请 Opus 网页裁决，再问用户',
          '- 额度紧张：先问用户',
          '- 登录失效：用其他 AI 代替并通知用户',
          '- 优先使用：GPT（审计）、Opus（架构决策）',
        ].join('\n'),
      );
    });
  });

  describe('load & save with StorageLike', () => {
    it('saves and reloads settings cleanly', () => {
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

      saveCoordinationSettings(modified, storage);
      expect(mem.has(COORDINATION_SETTINGS_STORAGE_KEY)).toBe(true);

      const loaded = loadCoordinationSettings(storage);
      expect(loaded.reworkLimit).toBe(4);
      expect(loaded.onExceedLimit).toBe('consult_opus');
    });

    it('handles storage errors without throwing', () => {
      const brokenStorage: StorageLike = {
        getItem: () => {
          throw new Error('Storage disabled');
        },
        setItem: () => {
          throw new Error('Storage write failed');
        },
      };

      expect(() => loadCoordinationSettings(brokenStorage)).not.toThrow();
      expect(loadCoordinationSettings(brokenStorage)).toEqual(DEFAULT_COORDINATION_SETTINGS);
      expect(() => saveCoordinationSettings(DEFAULT_COORDINATION_SETTINGS, brokenStorage)).not.toThrow();
    });
  });
});

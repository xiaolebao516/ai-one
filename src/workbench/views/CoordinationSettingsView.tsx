import { useState, useEffect, useMemo } from 'react';
import {
  AUTH_EXPIRED_OPTIONS,
  DEFAULT_AI_PREFERENCES,
  DEFAULT_COORDINATION_SETTINGS,
  EXCEED_LIMIT_OPTIONS,
  QUOTA_TIGHT_OPTIONS,
  loadCoordination,
  loadCoordinationSettings,
  renderCoordinationBrief,
  sanitizePreferenceValue,
  saveCoordination,
  saveCoordinationSettings,
  type AuthExpiredAction,
  type CoordinationSettings,
  type ExceedLimitAction,
  type QuotaTightAction,
  type StorageLike,
} from '../../stages/coordinationModel';
import { getLocalStoreFs, type LocalStoreFs } from '../../host/localStore';
import { Badge, Button, Card, Notice, SegmentedControl, Select } from '../../ui/v2';

export interface CoordinationSettingsViewProps {
  storage?: StorageLike;
  fs?: LocalStoreFs;
  onSaved?: (settings: CoordinationSettings) => void;
  className?: string;
}

const REWORK_LIMIT_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1} 轮`,
}));

/**
 * S6 CC Coordination Settings View (Spec #108 / Design gaps §8)
 *
 * Local preferences for Claude Code coordination, rendered into task brief markdown.
 */
export function CoordinationSettingsView({ storage, fs: propFs, onSaved, className }: CoordinationSettingsViewProps) {
  // If storage is explicitly provided (for legacy sync tests), use it;
  // otherwise default to propFs ?? getLocalStoreFs() for production local store file operations
  const activeFs = useMemo(() => {
    if (storage) return undefined;
    return propFs ?? getLocalStoreFs();
  }, [storage, propFs]);

  const [settings, setSettings] = useState<CoordinationSettings>(() => {
    if (storage) return loadCoordinationSettings(storage);
    return { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_AI_PREFERENCES } };
  });
  const [loading, setLoading] = useState<boolean>(() => Boolean(activeFs));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ tone: 'done' | 'block'; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    if (activeFs) {
      setLoading(true);
      setLoadError(null);
      loadCoordination(activeFs)
        .then((res) => {
          if (!active) return;
          setSettings(res.settings);
          setLoading(false);
          if (res.status === 'recovered') {
            setSaveStatus({
              tone: 'block',
              message: `读取到损坏的设置文件，已安全隔离备份为 ${res.backup ?? '备份文件'}，已恢复默认设置`,
            });
          }
        })
        .catch((err) => {
          if (!active) return;
          setLoading(false);
          const msg = err instanceof Error ? err.message : String(err);
          setLoadError(msg);
          setSaveStatus({
            tone: 'block',
            message: `加载本机设置失败：${msg}。为避免覆盖已有设置，当前已禁用保存。`,
          });
        });
    } else {
      setLoading(false);
      setLoadError(null);
    }
    return () => {
      active = false;
    };
  }, [activeFs]);

  const isBlocked = loading || Boolean(loadError);
  const brief = renderCoordinationBrief(settings);

  const updateSetting = async <K extends keyof CoordinationSettings>(key: K, value: CoordinationSettings[K]) => {
    if (isBlocked) return;
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (activeFs) {
      const result = await saveCoordination(next, activeFs);
      if (result.success) {
        setSaveStatus({ tone: 'done', message: '已自动保存到本机设置' });
        onSaved?.(next);
      } else {
        setSaveStatus({ tone: 'block', message: `保存失败：${result.error ?? '写入文件失败'}` });
      }
    } else {
      const result = saveCoordinationSettings(next, storage);
      if (result.success) {
        setSaveStatus({ tone: 'done', message: '已自动保存到本机设置' });
        onSaved?.(next);
      } else {
        setSaveStatus({ tone: 'block', message: `保存失败：${result.error ?? '存储不可用'}` });
      }
    }
  };

  const updateAiPreference = (ai: string, role: string) => {
    if (isBlocked) return;
    const nextAi = { ...settings.aiPreferences, [ai]: sanitizePreferenceValue(role) };
    void updateSetting('aiPreferences', nextAi);
  };

  const handleReset = async () => {
    if (isBlocked) return;
    const reset = { ...DEFAULT_COORDINATION_SETTINGS, aiPreferences: { ...DEFAULT_COORDINATION_SETTINGS.aiPreferences } };
    setSettings(reset);
    if (activeFs) {
      const result = await saveCoordination(reset, activeFs);
      if (result.success) {
        setSaveStatus({ tone: 'done', message: '已恢复默认设置' });
        onSaved?.(reset);
      } else {
        setSaveStatus({ tone: 'block', message: `重置失败：${result.error ?? '写入文件失败'}` });
      }
    } else {
      const result = saveCoordinationSettings(reset, storage);
      if (result.success) {
        setSaveStatus({ tone: 'done', message: '已恢复默认设置' });
        onSaved?.(reset);
      } else {
        setSaveStatus({ tone: 'block', message: `重置失败：${result.error ?? '存储不可用'}` });
      }
    }
  };

  return (
    <div
      data-testid="coordination-settings-view"
      className={`mx-auto grid max-w-[720px] gap-v2-section p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:p-v2-page ${className ?? ''}`}
    >
      <header className="grid gap-v2-xs">
        <div className="flex flex-wrap items-center gap-v2-sm">
          <h1 className="font-v2-serif text-v2-title text-v2-ink">CC 协调设置</h1>
          <Badge tone={loadError ? 'block' : 'run'}>
            {loading ? '正在加载...' : loadError ? '加载失败' : '本机设置'}
          </Badge>
        </div>
        <p className="text-v2-meta text-v2-ink-2">
          这些偏好会写进交给 CC 的 Issue，由 CC 参照执行。ai-one 不直接指挥进程，通过 Issue 约定协调规则。
        </p>
      </header>

      {loading ? (
        <Notice tone="run">正在加载本机设置...</Notice>
      ) : saveStatus ? (
        <Notice tone={saveStatus.tone} className="transition-opacity">
          {saveStatus.message}
        </Notice>
      ) : null}

      <div className="grid gap-v2-md">
        {/* 返工上限 */}
        <Card className="grid gap-v2-sm">
          <div className="flex flex-wrap items-center justify-between gap-v2-sm">
            <div>
              <span className="font-semibold text-v2-body text-v2-ink">返工上限</span>
              <p className="text-v2-meta text-v2-ink-3">审计 REVISE 返工超过这个数就停下来问你</p>
            </div>
            <Select
              id="rework-limit-select"
              label="返工上限轮数"
              hideLabel
              value={String(settings.reworkLimit)}
              options={REWORK_LIMIT_OPTIONS}
              disabled={isBlocked}
              onChange={(val) => updateSetting('reworkLimit', Number(val))}
            />
          </div>
        </Card>

        {/* 超限后 */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">超限后</span>
            <p className="text-v2-meta text-v2-ink-3">达到返工上限后的后续动作</p>
          </div>
          <SegmentedControl
            idBase="coordination-exceed"
            label="超限后动作"
            value={settings.onExceedLimit}
            onChange={(val) => updateSetting('onExceedLimit', val as ExceedLimitAction)}
            options={EXCEED_LIMIT_OPTIONS.map((o) => ({ value: o.value, label: o.label, disabled: isBlocked }))}
          />
        </Card>

        {/* 额度紧张时 */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">额度紧张时</span>
            <p className="text-v2-meta text-v2-ink-3">模型配额受限或耗尽时的协调策略</p>
          </div>
          <SegmentedControl
            idBase="coordination-quota"
            label="额度紧张策略"
            value={settings.onQuotaTight}
            onChange={(val) => updateSetting('onQuotaTight', val as QuotaTightAction)}
            options={QUOTA_TIGHT_OPTIONS.map((o) => ({ value: o.value, label: o.label, disabled: isBlocked }))}
          />
        </Card>

        {/* 登录失效时 */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">登录失效时</span>
            <p className="text-v2-meta text-v2-ink-3">真实账号会话过期或需验证时的处理方式</p>
          </div>
          <SegmentedControl
            idBase="coordination-auth"
            label="登录失效策略"
            value={settings.onAuthExpired}
            onChange={(val) => updateSetting('onAuthExpired', val as AuthExpiredAction)}
            options={AUTH_EXPIRED_OPTIONS.map((o) => ({ value: o.value, label: o.label, disabled: isBlocked }))}
          />
        </Card>

        {/* 优先使用（标注）可编辑 */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">优先使用（你的标注）</span>
            <p className="text-v2-meta text-v2-ink-3">标明各 AI 的擅长分工（可直接修改），写进简报供调度参考</p>
          </div>
          <div className="grid gap-v2-xs">
            {Object.entries(settings.aiPreferences).map(([ai, role]) => (
              <div key={ai} className="flex items-center gap-v2-sm">
                <span className="w-16 font-semibold uppercase text-v2-meta text-v2-ink">{ai}:</span>
                <input
                  aria-label={`${ai}偏好标注`}
                  value={role}
                  disabled={isBlocked}
                  onChange={(e) => updateAiPreference(ai, e.target.value)}
                  className="h-7 flex-1 rounded-v2-sm border border-v2-line bg-v2-surface px-v2-sm text-v2-meta text-v2-ink disabled:opacity-50"
                  placeholder="分工或擅长领域，如：执行、审计"
                  maxLength={50}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* 简报预览 */}
        <Card className="grid gap-v2-sm border-v2-line bg-v2-surface">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-v2-body text-v2-ink">简报预览（建 Issue 时写入正文）</span>
            <Badge tone="run">实时预览</Badge>
          </div>
          <pre
            data-testid="brief-preview"
            className="whitespace-pre-wrap rounded-v2-sm bg-v2-sunken p-v2-sm font-mono text-v2-meta text-v2-ink"
          >
            {brief}
          </pre>
          <div className="flex items-center justify-between pt-v2-xs">
            <span className="text-v2-micro text-v2-ink-3">由 CC 参照执行</span>
            <Button size="sm" variant="ghost" disabled={isBlocked} onClick={handleReset}>
              恢复默认设置
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

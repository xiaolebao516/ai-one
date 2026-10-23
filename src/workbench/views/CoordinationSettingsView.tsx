import { useState, useEffect, useMemo } from 'react';
import type { Locale } from '../../i18n/resolve';
import {
  DEFAULT_AI_PREFERENCES,
  DEFAULT_COORDINATION_SETTINGS,
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
import { workbenchText } from '../workbenchText';

export interface CoordinationSettingsViewProps {
  locale?: Locale;
  storage?: StorageLike;
  fs?: LocalStoreFs;
  onSaved?: (settings: CoordinationSettings) => void;
  className?: string;
}

/**
 * S6 CC Coordination Settings View (Spec #108 / Design gaps §8)
 *
 * Local preferences for Claude Code coordination, rendered into task brief markdown.
 */
export function CoordinationSettingsView({
  locale = 'zh-CN',
  storage,
  fs: propFs,
  onSaved,
  className,
}: CoordinationSettingsViewProps) {
  const text = useMemo(() => workbenchText(locale), [locale]);

  const reworkLimitOptions = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        value: String(i + 1),
        label: text.t('coordinationReworkLimitRounds', { n: i + 1 }),
      })),
    [text],
  );

  const exceedLimitOptions = useMemo(
    () => [
      { value: 'ask_user', label: text.t('coordinationExceedAskUser') },
      { value: 'consult_opus', label: text.t('coordinationExceedConsultOpus') },
    ],
    [text],
  );

  const quotaTightOptions = useMemo(
    () => [
      { value: 'auto_reassign', label: text.t('coordinationQuotaAutoReassign') },
      { value: 'ask_user', label: text.t('coordinationQuotaAskUser') },
    ],
    [text],
  );

  const authExpiredOptions = useMemo(
    () => [
      { value: 'ask_user', label: text.t('coordinationAuthAskUser') },
      { value: 'fallback_ai', label: text.t('coordinationAuthFallbackAi') },
    ],
    [text],
  );

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
              message: text.t('coordinationCorruptRecovered', { backup: res.backup ?? 'backup' }),
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
            message: text.t('coordinationLoadFailed', { error: msg }),
          });
        });
    } else {
      setLoading(false);
      setLoadError(null);
    }
    return () => {
      active = false;
    };
  }, [activeFs, text]);

  const isBlocked = loading || Boolean(loadError);
  const brief = renderCoordinationBrief(settings);

  const updateSetting = async <K extends keyof CoordinationSettings>(key: K, value: CoordinationSettings[K]) => {
    if (isBlocked) return;
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (activeFs) {
      const result = await saveCoordination(next, activeFs);
      if (result.success) {
        setSaveStatus({ tone: 'done', message: text.t('coordinationSaveSuccess') });
        onSaved?.(next);
      } else {
        setSaveStatus({ tone: 'block', message: text.t('coordinationSaveFailed', { error: result.error ?? 'error' }) });
      }
    } else {
      const result = saveCoordinationSettings(next, storage);
      if (result.success) {
        setSaveStatus({ tone: 'done', message: text.t('coordinationSaveSuccess') });
        onSaved?.(next);
      } else {
        setSaveStatus({ tone: 'block', message: text.t('coordinationSaveFailed', { error: result.error ?? 'error' }) });
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
        setSaveStatus({ tone: 'done', message: text.t('coordinationResetSuccess') });
        onSaved?.(reset);
      } else {
        setSaveStatus({ tone: 'block', message: text.t('coordinationResetFailed', { error: result.error ?? 'error' }) });
      }
    } else {
      const result = saveCoordinationSettings(reset, storage);
      if (result.success) {
        setSaveStatus({ tone: 'done', message: text.t('coordinationResetSuccess') });
        onSaved?.(reset);
      } else {
        setSaveStatus({ tone: 'block', message: text.t('coordinationResetFailed', { error: result.error ?? 'error' }) });
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
          <h1 className="font-v2-serif text-v2-title text-v2-ink">{text.t('coordinationTitle')}</h1>
          <Badge tone={loadError ? 'block' : 'run'}>
            {loading ? text.t('coordinationBadgeLoading') : loadError ? text.t('coordinationBadgeFailed') : text.t('coordinationBadgeLocal')}
          </Badge>
        </div>
        <p className="text-v2-meta text-v2-ink-2">
          {text.t('coordinationSubtitle')}
        </p>
      </header>

      {loading ? (
        <Notice tone="run">{text.t('coordinationLoadingNotice')}</Notice>
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
              <span className="font-semibold text-v2-body text-v2-ink">{text.t('coordinationReworkLimitTitle')}</span>
              <p className="text-v2-meta text-v2-ink-3">{text.t('coordinationReworkLimitDesc')}</p>
            </div>
            <Select
              id="rework-limit-select"
              label={text.t('coordinationReworkLimitTitle')}
              hideLabel
              value={String(settings.reworkLimit)}
              options={reworkLimitOptions}
              disabled={isBlocked}
              onChange={(val) => updateSetting('reworkLimit', Number(val))}
            />
          </div>
        </Card>

        {/* 超限后 */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">{text.t('coordinationExceedTitle')}</span>
            <p className="text-v2-meta text-v2-ink-3">{text.t('coordinationExceedDesc')}</p>
          </div>
          <SegmentedControl
            idBase="coordination-exceed"
            label={text.t('coordinationExceedTitle')}
            value={settings.onExceedLimit}
            onChange={(val) => updateSetting('onExceedLimit', val as ExceedLimitAction)}
            options={exceedLimitOptions.map((o) => ({ value: o.value, label: o.label, disabled: isBlocked }))}
          />
        </Card>

        {/* 额度紧张时 */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">{text.t('coordinationQuotaTitle')}</span>
            <p className="text-v2-meta text-v2-ink-3">{text.t('coordinationQuotaDesc')}</p>
          </div>
          <SegmentedControl
            idBase="coordination-quota"
            label={text.t('coordinationQuotaTitle')}
            value={settings.onQuotaTight}
            onChange={(val) => updateSetting('onQuotaTight', val as QuotaTightAction)}
            options={quotaTightOptions.map((o) => ({ value: o.value, label: o.label, disabled: isBlocked }))}
          />
        </Card>

        {/* 登录失效时 */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">{text.t('coordinationAuthTitle')}</span>
            <p className="text-v2-meta text-v2-ink-3">{text.t('coordinationAuthDesc')}</p>
          </div>
          <SegmentedControl
            idBase="coordination-auth"
            label={text.t('coordinationAuthTitle')}
            value={settings.onAuthExpired}
            onChange={(val) => updateSetting('onAuthExpired', val as AuthExpiredAction)}
            options={authExpiredOptions.map((o) => ({ value: o.value, label: o.label, disabled: isBlocked }))}
          />
        </Card>

        {/* 优先使用（标注）可编辑 */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">{text.t('coordinationAiPrefTitle')}</span>
            <p className="text-v2-meta text-v2-ink-3">{text.t('coordinationAiPrefDesc')}</p>
          </div>
          <div className="grid gap-v2-xs">
            {Object.entries(settings.aiPreferences).map(([ai, role]) => (
              <div key={ai} className="flex items-center gap-v2-sm">
                <span className="w-16 font-semibold uppercase text-v2-meta text-v2-ink">{ai}:</span>
                <input
                  aria-label={text.t('coordinationAiPrefAria', { ai })}
                  value={role}
                  disabled={isBlocked}
                  onChange={(e) => updateAiPreference(ai, e.target.value)}
                  className="h-7 flex-1 rounded-v2-sm border border-v2-line bg-v2-surface px-v2-sm text-v2-meta text-v2-ink disabled:opacity-50"
                  placeholder={text.t('coordinationAiPrefPlaceholder')}
                  maxLength={50}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* 简报预览 */}
        <Card className="grid gap-v2-sm border-v2-line bg-v2-surface">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-v2-body text-v2-ink">{text.t('coordinationPreviewTitle')}</span>
            <Badge tone="run">{text.t('coordinationPreviewBadge')}</Badge>
          </div>
          <pre
            data-testid="brief-preview"
            className="whitespace-pre-wrap rounded-v2-sm bg-v2-sunken p-v2-sm font-mono text-v2-meta text-v2-ink"
          >
            {brief}
          </pre>
          <div className="flex items-center justify-between pt-v2-xs">
            <span className="text-v2-micro text-v2-ink-3">{text.t('coordinationPreviewFooter')}</span>
            <Button size="sm" variant="ghost" disabled={isBlocked} onClick={handleReset}>
              {text.t('coordinationResetButton')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

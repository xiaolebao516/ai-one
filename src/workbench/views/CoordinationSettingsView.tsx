import { useState } from 'react';
import {
  AUTH_EXPIRED_OPTIONS,
  DEFAULT_COORDINATION_SETTINGS,
  EXCEED_LIMIT_OPTIONS,
  QUOTA_TIGHT_OPTIONS,
  loadCoordinationSettings,
  renderCoordinationBrief,
  saveCoordinationSettings,
  type AuthExpiredAction,
  type CoordinationSettings,
  type ExceedLimitAction,
  type QuotaTightAction,
  type StorageLike,
} from '../../stages/coordinationModel';
import { Badge, Button, Card, Notice, SegmentedControl, Select } from '../../ui/v2';

export interface CoordinationSettingsViewProps {
  storage?: StorageLike;
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
export function CoordinationSettingsView({ storage, onSaved, className }: CoordinationSettingsViewProps) {
  const [settings, setSettings] = useState<CoordinationSettings>(() => loadCoordinationSettings(storage));
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const brief = renderCoordinationBrief(settings);

  const updateSetting = <K extends keyof CoordinationSettings>(key: K, value: CoordinationSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveCoordinationSettings(next, storage);
    setSaveNotice('已自动保存到本机设置');
    onSaved?.(next);
  };

  const handleReset = () => {
    setSettings({ ...DEFAULT_COORDINATION_SETTINGS });
    saveCoordinationSettings({ ...DEFAULT_COORDINATION_SETTINGS }, storage);
    setSaveNotice('已恢复默认设置');
    onSaved?.({ ...DEFAULT_COORDINATION_SETTINGS });
  };

  return (
    <div className={`mx-auto grid max-w-[720px] gap-v2-section p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:p-v2-page ${className ?? ''}`}>
      <header className="grid gap-v2-xs">
        <div className="flex flex-wrap items-center gap-v2-sm">
          <h1 className="font-v2-serif text-v2-title text-v2-ink">CC 协调设置</h1>
          <Badge tone="run">本机设置</Badge>
        </div>
        <p className="text-v2-meta text-v2-ink-2">
          这些偏好会写进交给 CC 的 Issue，由 CC 参照执行。ai-one 不直接指挥进程，通过 Issue 约定协调规则。
        </p>
      </header>

      {saveNotice ? (
        <Notice tone="done" className="transition-opacity">
          {saveNotice}
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
            options={EXCEED_LIMIT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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
            options={QUOTA_TIGHT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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
            options={AUTH_EXPIRED_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </Card>

        {/* 优先使用（标注） */}
        <Card className="grid gap-v2-sm">
          <div>
            <span className="font-semibold text-v2-body text-v2-ink">优先使用（你的标注）</span>
            <p className="text-v2-meta text-v2-ink-3">标明各 AI 的擅长分工，写进简报供调度参考</p>
          </div>
          <div className="flex flex-wrap gap-v2-xs">
            {Object.entries(settings.aiPreferences).map(([ai, role]) => (
              <Badge key={ai} tone="neutral" className="text-v2-meta">
                <span className="font-semibold uppercase">{ai}:</span> {role}
              </Badge>
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
            <Button size="sm" variant="ghost" onClick={handleReset}>
              恢复默认设置
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

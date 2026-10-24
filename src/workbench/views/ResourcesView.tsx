import { useState, type ReactNode } from 'react';
import { AI_PROVIDERS, ALL_AI_PROVIDERS } from '../../../shared/constants';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, Icon, Notice, SectionHeader, cx, type V2BadgeTone } from '../../ui/v2';
import { DispatchReceipts } from '../../ui/v2/DispatchReceipts';
import type { ChannelSummary } from '../dispatchModel';
import { CHANNEL_BADGE, channelView, type ChannelView } from '../dispatchView';
import type { DispatchData } from '../useDispatchData';
import { deriveResources, type ResourceStatus } from '../../resources/registry';
import type { QuotaHudData } from '../../resources/useQuotaHud';
import { workbenchText, type WorkbenchText, type WorkbenchTextKey } from '../workbenchText';

export interface ResourcesViewProps {
  locale: Locale;
  dispatch: DispatchData;
  quotaHud: QuotaHudData;
  repoPath: string;
  onSetRepo: (input: string) => 'saved' | 'cleared' | 'invalid';
  onOpenClassic: () => void;
}

/**
 * Resources page (Spec #98, design `12-resources`). The local agents use the shared HUD snapshot;
 * web-chat quota remains unknown because there is no reliable page-level source.
 */
export function ResourcesView({ locale, dispatch, quotaHud, repoPath, onSetRepo, onOpenClassic }: ResourcesViewProps) {
  const text = workbenchText(locale);
  const channel = channelView(dispatch);
  const reading = quotaHud.reading ?? { state: 'unavailable' as const, heartbeatAgeSeconds: null, snapshot: null, readAt: null };
  const resources = deriveResources(reading, Date.now());
  return (
    <div className="mx-auto grid max-w-[1180px] gap-v2-section p-v2-page-narrow min-[1100px]:p-v2-page-mid min-[1320px]:p-v2-page">
      <header>
        <h1 className="font-v2-serif text-v2-title text-v2-ink">{text.t('resourcesTitle')}</h1>
        <p className="mt-v2-xs text-v2-meta text-v2-ink-2">{text.t('resourcesSub')}</p>
      </header>

      <QuotaLegend text={text} />
      <QuotaHudNotice text={text} quotaHud={quotaHud} />

      <section aria-labelledby="resources-agents" className="grid gap-v2-sm">
        <SectionHeader id="resources-agents" title={text.t('agentsTitle')} description={text.t('agentsHint')} />
        {resources.map((resource) => (
          <AgentResourceCard key={resource.id} resource={resource} locale={locale} text={text} />
        ))}
      </section>

      <section aria-labelledby="resources-channel" className="grid gap-v2-sm">
        <SectionHeader id="resources-channel" title={text.t('channelTitle')} description={text.t('channelHint')} />
        <ChannelCard text={text} locale={locale} channel={channel} dispatch={dispatch} repoPath={repoPath} onSetRepo={onSetRepo} />
      </section>

      <section aria-labelledby="resources-web" className="grid gap-v2-sm">
        <SectionHeader id="resources-web" title={text.t('webTitle')} description={text.t('webHint')} />
        {ALL_AI_PROVIDERS.map((provider) => {
          const info = AI_PROVIDERS[provider];
          return (
            <ResourceCard
              key={provider}
              avatar={info.name.slice(0, 1)}
              color={info.color}
              name={info.name}
              kind={text.t('webKind')}
              note={text.t('webNotProbed')}
              text={text}
              action={
                <Button size="sm" onClick={onOpenClassic} icon={<Icon name="external" size={14} />}>
                  {text.t('openInClassic')}
                </Button>
              }
            />
          );
        })}
      </section>
    </div>
  );
}

function Avatar({ label, color }: { label: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-v2-md text-v2-body font-semibold text-white"
    >
      {label}
    </span>
  );
}

/** Quota bar per source kind; `unknown` is an empty dashed track, never a filled one. */
function QuotaBar({ kind }: { kind: 'known' | 'estimate' | 'unknown' }) {
  return (
    <span aria-hidden="true" className={cx('relative block h-1.5 w-10 overflow-hidden rounded-full', kind === 'unknown' ? 'border border-dashed border-v2-line-strong' : 'bg-v2-line')}>
      {kind === 'unknown' ? null : <span className={cx('absolute inset-y-0 left-0 w-3/5 rounded-full', kind === 'known' ? 'bg-v2-done' : 'bg-v2-done opacity-50')} />}
    </span>
  );
}

function QuotaLegend({ text }: { text: WorkbenchText }) {
  const items: Array<{ key: string; title: string; hint: string; mark: ReactNode }> = [
    { key: 'known', title: text.t('quotaKnown'), hint: text.t('quotaKnownHint'), mark: <QuotaBar kind="known" /> },
    { key: 'hint', title: text.t('quotaHint'), hint: text.t('quotaHintHint'), mark: <span aria-hidden="true" className="h-2 w-2 rounded-full bg-v2-unknown" /> },
    { key: 'estimate', title: text.t('quotaEstimate'), hint: text.t('quotaEstimateHint'), mark: <QuotaBar kind="estimate" /> },
    { key: 'unknown', title: text.t('quotaUnknown'), hint: text.t('quotaUnknownHint'), mark: <QuotaBar kind="unknown" /> },
  ];
  return (
    <div className="grid gap-v2-sm">
      <ul aria-label={text.t('quotaLabel')} className="grid grid-cols-2 gap-v2-sm min-[1100px]:grid-cols-4">
        {items.map((item) => (
          <li key={item.key}>
            <Card padding="sm" className="h-full">
              <div className="flex items-center gap-v2-sm font-semibold text-v2-ink">
                {item.mark}
                {item.title}
              </div>
              <p className="mt-1 text-v2-meta text-v2-ink-2">{item.hint}</p>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-v2-meta text-v2-ink-3">{text.t('quotaAllUnknown')}</p>
    </div>
  );
}


const LOGIN_LABEL: Record<ResourceStatus['login'], WorkbenchTextKey> = {
  ok: 'resourceLoginOk',
  attention: 'resourceLoginAttention',
  unknown: 'resourceLoginUnknown',
  'not-detected': 'resourceLoginNotDetected',
};
const LOGIN_TONE: Record<ResourceStatus['login'], V2BadgeTone> = {
  ok: 'done',
  attention: 'block',
  unknown: 'unknown',
  'not-detected': 'unknown',
};
const ACTIVITY_LABEL: Record<ResourceStatus['activity'], WorkbenchTextKey> = {
  busy: 'resourceActivityBusy',
  waiting: 'resourceActivityWaiting',
  idle: 'resourceActivityIdle',
  unknown: 'resourceActivityUnknown',
};
const ACTIVITY_TONE: Record<ResourceStatus['activity'], V2BadgeTone> = {
  busy: 'run',
  waiting: 'you',
  idle: 'paused',
  unknown: 'unknown',
};
const QUOTA_BAR_CLASS: Record<ResourceStatus['quota']['windows'][number]['level'], string> = {
  ok: 'bg-v2-done',
  warn: 'bg-v2-you',
  critical: 'bg-v2-block',
  unknown: '',
};

function formatPercent(value: number): string {
  return Number(value.toFixed(1)).toString() + '%';
}

function formatClock(value: string, locale: Locale): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
}

function formatResetTime(value: string, locale: Locale): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
}

function QuotaHudNotice({ text, quotaHud }: { text: WorkbenchText; quotaHud: QuotaHudData }) {
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState<string | null>(null);
  const reading = quotaHud.reading;
  const browserUnavailable = quotaHud.state === 'unavailable' || reading?.state === 'unavailable';
  const running = quotaHud.state === 'ready' && reading?.state === 'running';
  if (running && reading?.snapshot) return null;

  const messageKey: WorkbenchTextKey =
    quotaHud.state === 'loading'
      ? 'quotaHudLoading'
      : browserUnavailable
        ? 'quotaHudBrowserUnavailable'
        : quotaHud.state === 'error'
          ? 'quotaHudReadError'
          : reading?.state === 'running'
            ? 'quotaHudNoSnapshot'
            : reading?.state === 'stopped'
              ? 'quotaHudStopped'
              : reading?.state === 'unreadable'
                ? 'quotaHudUnreadable'
                : 'quotaHudAbsent';
  const canStart = !browserUnavailable && quotaHud.state !== 'loading' && reading?.state !== 'running';
  const startHud = async () => {
    setStarting(true);
    setStartFailed(null);
    try {
      const result = await quotaHud.start();
      const failure = startFailure(result);
      if (failure) setStartFailed(failure);
    } catch {
      setStartFailed('error');
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-v2-sm" data-testid="quota-hud-notice">
      <div className="min-w-0 flex-1">
        <Notice tone={quotaHud.state === 'error' || reading?.state === 'unreadable' ? 'block' : 'unknown'}>
          {text.t(messageKey)}
        </Notice>
        {startFailed ? <p role="alert" className="mt-1 text-v2-meta text-v2-block">{text.t(startFailed === 'exe-not-found' ? 'quotaHudStartMissing' : 'quotaHudStartError')}</p> : null}
      </div>
      {canStart ? (
        <Button size="sm" loading={starting} onClick={() => void startHud()}>
          {text.t(starting ? 'quotaHudStarting' : 'quotaHudStart')}
        </Button>
      ) : null}
    </div>
  );
}

/** quota_hud_start answers {"started": bool, "reason": string}; "already-running" is not a failure. */
function startFailure(result: unknown): string | null {
  if (result === undefined) return null;
  try {
    const parsed: unknown = typeof result === 'string' ? JSON.parse(result) : result;
    if (typeof parsed !== 'object' || parsed === null) return 'error';
    const { started, reason } = parsed as { started?: unknown; reason?: unknown };
    if (started === true || reason === 'already-running') return null;
    return typeof reason === 'string' ? reason : 'error';
  } catch {
    return 'error';
  }
}

/** The HUD's own notice text is shown only when it is short and cannot be an e-mail address. */
function safeNotice(notice: string | undefined): string | undefined {
  if (!notice || notice.length > 120 || notice.includes('@')) return undefined;
  return notice;
}

function AgentResourceCard({ resource, locale, text }: { resource: ResourceStatus; locale: Locale; text: WorkbenchText }) {
  const avatar = resource.id === 'claude-code' ? 'CC' : 'Cx';
  const color = resource.id === 'claude-code' ? '#C15F3C' : '#2B2A27';
  const quotaLabel = resource.quota.stale && resource.quota.windows.length > 0
    ? 'quotaExpiredShort'
    : resource.quota.source === 'known'
      ? 'quotaKnown'
      : 'quotaUnknown';
  return (
    <Card data-testid={'resource-' + resource.id} className="grid items-start gap-v2-md min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 items-start gap-v2-md">
        <Avatar label={avatar} color={color} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-v2-sm">
            <span className="font-semibold text-v2-ink">{resource.name}</span>
            <Badge tone={LOGIN_TONE[resource.login]}>{text.t(LOGIN_LABEL[resource.login])}</Badge>
            <Badge tone={ACTIVITY_TONE[resource.activity]}>{text.t(ACTIVITY_LABEL[resource.activity])}</Badge>
          </div>
          <p className="text-v2-meta text-v2-ink-3">{text.t('agentKind')}</p>
          {safeNotice(resource.loginNotice) ? <p className="mt-1 text-v2-meta text-v2-ink-2">{safeNotice(resource.loginNotice)}</p> : null}
        </div>
      </div>
      <div className="grid min-w-0 gap-v2-sm">
        <div className="flex flex-wrap items-center justify-between gap-v2-sm">
          <span className="text-v2-meta text-v2-ink-2">{text.t('quotaLabel')}</span>
          <Badge tone={resource.quota.source === 'known' && !resource.quota.stale ? 'done' : 'unknown'}>
            {text.t(quotaLabel)}
          </Badge>
        </div>
        {resource.quota.windows.length > 0 ? (
          <div className="grid gap-v2-sm">
            {resource.quota.windows.map((window, index) => (
              <QuotaWindowRow key={window.id ?? window.name + '-' + index} window={window} locale={locale} text={text} />
            ))}
          </div>
        ) : (
          <div className="grid gap-1">
            <span className="text-v2-meta text-v2-ink-3">{text.t('quotaUnknown')}</span>
            <span className="block h-1.5 w-full rounded-full border border-dashed border-v2-line-strong" aria-hidden="true" />
          </div>
        )}
        {resource.quota.stale && resource.quota.windows.length > 0
          ? <p className="text-v2-meta text-v2-ink-3">{resource.quota.observedAt ? text.t('quotaExpired', { time: formatClock(resource.quota.observedAt, locale) }) : text.t('quotaExpiredUnknownTime')}</p>
          : resource.quota.observedAt
            ? <p className="text-v2-meta text-v2-ink-3">{text.t('quotaObserved', { time: formatClock(resource.quota.observedAt, locale) })}</p>
            : null}
      </div>
    </Card>
  );
}

function QuotaWindowRow({
  window,
  locale,
  text,
}: {
  window: ResourceStatus['quota']['windows'][number];
  locale: Locale;
  text: WorkbenchText;
}) {
  // window.level is already 'unknown' unless this very window is current (fresh, trusted, not reset).
  const level = window.level;
  const usedPercent = window.usedPercent;
  return (
    <div className="grid gap-1" data-testid="quota-window">
      <div className="flex items-center justify-between gap-v2-sm text-v2-meta">
        <span className="min-w-0 truncate text-v2-ink-2">{window.name || text.t('quotaWindowUnknown')}</span>
        <span className="shrink-0 text-v2-ink">{usedPercent === null ? text.t('quotaUnknown') : formatPercent(usedPercent)}</span>
      </div>
      <span
        aria-hidden="true"
        data-testid="quota-window-bar"
        className={cx('relative block h-1.5 w-full overflow-hidden rounded-full', level === 'unknown' ? 'border border-dashed border-v2-line-strong' : 'bg-v2-line')}
      >
        {level !== 'unknown' && usedPercent !== null ? (
          <span className={cx('absolute inset-y-0 left-0 rounded-full', QUOTA_BAR_CLASS[level])} style={{ width: Math.min(100, Math.max(0, usedPercent)) + '%' }} />
        ) : null}
      </span>
      {window.resetAt ? <span className="text-v2-micro text-v2-ink-3">{text.t('quotaResetAt', { time: formatResetTime(window.resetAt, locale) })}</span> : null}
    </div>
  );
}

interface ResourceCardProps {
  avatar: string;
  color: string;
  name: string;
  kind: string;
  note: string;
  text: WorkbenchText;
  action?: ReactNode;
}

/** One AI or agent with no readable state yet: every field says so instead of guessing. */
function ResourceCard({ avatar, color, name, kind, note, text, action }: ResourceCardProps) {
  return (
    <Card className="grid items-center gap-v2-md min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] max-[1099px]:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-start gap-v2-md">
        <Avatar label={avatar} color={color} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-v2-sm">
            <span className="font-semibold text-v2-ink">{name}</span>
            <Badge tone="unknown">{text.t('notProbed')}</Badge>
          </div>
          <p className="text-v2-meta text-v2-ink-3">{kind}</p>
          <p className="mt-1 text-v2-meta text-v2-ink-2">{note}</p>
        </div>
      </div>
      <div className="grid gap-1 max-[1099px]:col-span-2 max-[1099px]:row-start-2">
        <span className="text-v2-meta text-v2-ink-2">{text.t('quotaLabel')}</span>
        <span className="block h-1.5 w-full rounded-full border border-dashed border-v2-line-strong" aria-hidden="true" />
        <Badge tone="unknown" className="justify-self-start">
          {text.t('quotaUnknown')}
        </Badge>
      </div>
      <div className="justify-self-end max-[1099px]:col-start-2 max-[1099px]:row-start-1">{action}</div>
    </Card>
  );
}

/**
 * Totals that can be checked one by one against the receipt list. The rarer states only appear when
 * present, so the line stays short without hiding anything.
 */
function countLine(text: WorkbenchText, summary: ChannelSummary): string {
  const { counts } = summary;
  const parts = [
    text.t('channelTotal', { n: summary.total }),
    text.t('channelRunning', { n: counts.running }),
    text.t('channelCompleted', { n: counts.completed }),
    text.t('channelTimeout', { n: counts.timeout }),
    text.t('channelMismatch', { n: counts.request_mismatch }),
    text.t('channelRecovered', { n: counts.recovered }),
  ];
  if (counts.blocked) parts.push(text.t('channelBlocked', { n: counts.blocked }));
  if (counts.preview) parts.push(text.t('channelPreview', { n: counts.preview }));
  if (counts.unknown) parts.push(text.t('channelUnverified', { n: counts.unknown }));
  return parts.join(' · ');
}

interface ChannelCardProps {
  text: WorkbenchText;
  locale: Locale;
  channel: ChannelView;
  dispatch: DispatchData;
  repoPath: string;
  onSetRepo: ResourcesViewProps['onSetRepo'];
}

function ChannelCard({ text, locale, channel, dispatch, repoPath, onSetRepo }: ChannelCardProps) {
  const { summary } = channel;
  const time = (value: string | number) => new Date(value).toLocaleString(locale, { hour12: false });
  const notice =
    dispatch.state === 'demo'
      ? { tone: 'neutral' as const, body: text.t('channelDemo') }
      : dispatch.state === 'no-path'
        ? { tone: 'unknown' as const, body: text.t('channelNoPath') }
        : dispatch.state === 'unavailable'
          ? { tone: 'unknown' as const, body: text.t('channelUnavailable') }
          : dispatch.state === 'error'
            ? { tone: 'block' as const, body: text.t('channelError') }
            : undefined;
  return (
    <Card className="grid gap-v2-md" data-testid="prodex-channel">
      <div className="grid items-start gap-v2-md min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] max-[1099px]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-start gap-v2-md">
          <Avatar label="Px" color="#3B3A36" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-v2-sm">
              <span className="font-semibold text-v2-ink">Prodex</span>
              <Badge tone={CHANNEL_BADGE[channel.tone]}>{text.t(channel.labelKey)}</Badge>
              <Badge>{text.t(dispatch.state === 'demo' ? 'sourceDemo' : 'channelLocal')}</Badge>
            </div>
            <p className="mt-1 text-v2-meta text-v2-ink-2">{text.t('prodexDesc')}</p>
          </div>
        </div>
        <div className="grid gap-1 text-v2-meta text-v2-ink-2 max-[1099px]:col-span-2 max-[1099px]:row-start-2" aria-live="polite">
          {dispatch.state === 'loading' ? <span>{text.t('channelLoading')}</span> : null}
          {summary ? (
            <>
              <span className="text-v2-ink">{countLine(text, summary)}</span>
              <span>{text.t('channelRecent', { problems: summary.recentProblems, blocked: summary.recentBlocked })}</span>
              {summary.lastAt ? <span>{text.t('channelLast', { time: time(summary.lastAt) })}</span> : null}
              <span>{text.t('channelSlots', summary.slots)}</span>
              {dispatch.state === 'ready' && dispatch.observedAt ? <span className="text-v2-ink-3">{text.t('channelObserved', { time: time(dispatch.observedAt) })}</span> : null}
            </>
          ) : null}
        </div>
        <div className="justify-self-end max-[1099px]:col-start-2 max-[1099px]:row-start-1">
          {dispatch.state === 'demo' ? null : (
            <Button size="sm" variant="ghost" loading={dispatch.state === 'loading'} disabled={dispatch.state === 'no-path' || dispatch.state === 'unavailable'} onClick={dispatch.refresh} icon={<Icon name="refresh" size={14} />}>
              {text.t('refresh')}
            </Button>
          )}
        </div>
      </div>

      <p className="text-v2-meta text-v2-ink-3">{text.t('channelBrowserNote')}</p>
      {notice ? <Notice tone={notice.tone}>{notice.body}</Notice> : null}
      {dispatch.state === 'demo' ? null : <RepoPathForm key={repoPath} text={text} repoPath={repoPath} onSetRepo={onSetRepo} />}

      {dispatch.snapshot ? (
        <details open className="group grid gap-v2-sm">
          <summary className="cursor-pointer text-v2-body font-semibold text-v2-ink">{text.t('recentDispatches')}</summary>
          <div className="mt-v2-sm">
            <DispatchReceipts snapshot={dispatch.snapshot} source={dispatch.state === 'demo' ? 'demo' : 'local'} locale={locale} />
          </div>
        </details>
      ) : null}
    </Card>
  );
}

function RepoPathForm({ text, repoPath, onSetRepo }: { text: WorkbenchText; repoPath: string; onSetRepo: ResourcesViewProps['onSetRepo'] }) {
  const [draft, setDraft] = useState(repoPath);
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="grid gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        setInvalid(onSetRepo(draft) === 'invalid');
      }}
    >
      <label htmlFor="resources-repo-path" className="text-v2-meta text-v2-ink-2">
        {text.t('repoPathLabel')}
      </label>
      <div className="flex flex-wrap items-center gap-v2-sm">
        <input
          id="resources-repo-path"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={text.t('repoPathPlaceholder')}
          aria-invalid={invalid ? true : undefined}
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-v2-md border border-v2-line bg-v2-surface px-v2-sm font-v2-mono text-v2-meta text-v2-ink placeholder:text-v2-ink-3"
        />
        <Button size="sm" type="submit">
          {text.t('repoPathSave')}
        </Button>
      </div>
      {invalid ? (
        <p role="alert" className="text-v2-micro text-v2-block">
          {text.t('repoPathInvalid')}
        </p>
      ) : null}
    </form>
  );
}

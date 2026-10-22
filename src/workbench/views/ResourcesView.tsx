import { useState, type ReactNode } from 'react';
import { AI_PROVIDERS, ALL_AI_PROVIDERS } from '../../../shared/constants';
import type { Locale } from '../../i18n/resolve';
import { Badge, Button, Card, Icon, Notice, SectionHeader, cx } from '../../ui/v2';
import { DispatchReceipts } from '../../ui/v2/DispatchReceipts';
import type { ChannelSummary } from '../dispatchModel';
import { CHANNEL_BADGE, channelView, type ChannelView } from '../dispatchView';
import type { DispatchData } from '../useDispatchData';
import { workbenchText, type WorkbenchText } from '../workbenchText';

export interface ResourcesViewProps {
  locale: Locale;
  dispatch: DispatchData;
  repoPath: string;
  onSetRepo: (input: string) => 'saved' | 'cleared' | 'invalid';
  onOpenClassic: () => void;
}

/**
 * Resources page (Spec #98, design `12-resources`). Only the Prodex channel has a real source today;
 * logins, agent state and quota say "not checked" / "unknown" until the resources line (#82) lands.
 */
export function ResourcesView({ locale, dispatch, repoPath, onSetRepo, onOpenClassic }: ResourcesViewProps) {
  const text = workbenchText(locale);
  const channel = channelView(dispatch);
  return (
    <div className="mx-auto grid max-w-[1180px] gap-v2-lg p-v2-page">
      <header>
        <h1 className="text-[24px] font-semibold leading-tight text-v2-ink">{text.t('resourcesTitle')}</h1>
        <p className="mt-v2-xs text-v2-meta text-v2-ink-2">{text.t('resourcesSub')}</p>
      </header>

      <QuotaLegend text={text} />

      <section aria-labelledby="resources-agents" className="grid gap-v2-sm">
        <SectionHeader id="resources-agents" title={text.t('agentsTitle')} description={text.t('agentsHint')} />
        <ResourceCard avatar="CC" color="#C15F3C" name="Claude Code" kind={text.t('agentKind')} note={text.t('agentNotProbed')} text={text} />
        <ResourceCard avatar="Cx" color="#2B2A27" name="Codex CLI" kind={text.t('agentKind')} note={text.t('agentNotProbed')} text={text} />
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
    { key: 'hint', title: text.t('quotaHint'), hint: text.t('quotaHintHint'), mark: <span aria-hidden="true" className="h-2 w-2 rounded-full bg-v2-you" /> },
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

import type { ProviderInstance } from "../../../shared/types";
import { providerInstanceName } from "../../../shared/providerInstances";
import type { Locale } from "../../i18n/resolve";
import {
  Badge,
  Button,
  Card,
  Notice,
  SectionHeader,
  V2Scope,
  type V2StatusTone,
} from "../../ui/v2";
import { settledFeedbackItems } from "../../workflow/chatLed/machine";
import { buildFeedbackPrompt } from "../../workflow/chatLed/protocol";
import type {
  ChatLedLogEvent,
  ChatLedRun,
  CleanupItemResult,
  CleanupOutcome,
  ForwardRecord,
  ForwardStatus,
  ProtocolViolationCode,
  RunPhase,
} from "../../workflow/chatLed/types";
import { workbenchText, type WorkbenchTextKey } from "../workbenchText";

type CleanupPlanItem = {
  provider: ProviderInstance;
  url: string;
  title?: string;
  action: "delete" | "archive" | "manual";
  irreversible: boolean;
  reason: string;
};

export interface ChatLedViewProps {
  locale: Locale;
  run: ChatLedRun;
  providerLabels: Record<string, string>;
  cleanup: {
    plan: CleanupPlanItem[] | null;
    results: CleanupItemResult[] | null;
    running: boolean;
  };
  exportedPath?: string;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onRemind(): void;
  onExtendLimit(extra: number): void;
  onTakeOver(provider: ProviderInstance): void;
  onExport(): void;
  onCleanup(): void;
  onClose(): void;
}

const PHASE_COPY: Record<RunPhase, WorkbenchTextKey> = {
  idle: "chatLedPhaseIdle",
  "coordinator-thinking": "chatLedPhaseCoordinatorThinking",
  forwarding: "chatLedPhaseForwarding",
  paused: "chatLedPhasePaused",
  "awaiting-user": "chatLedPhaseAwaitingUser",
  finished: "chatLedPhaseFinished",
  stopped: "chatLedPhaseStopped",
};

const PHASE_TONE: Record<RunPhase, V2StatusTone> = {
  idle: "unknown",
  "coordinator-thinking": "run",
  forwarding: "run",
  paused: "paused",
  "awaiting-user": "you",
  finished: "done",
  stopped: "block",
};

const FORWARD_STATUS_COPY: Record<ForwardStatus, WorkbenchTextKey> = {
  queued: "chatLedStatusQueued",
  sending: "chatLedStatusSending",
  waiting: "chatLedStatusWaiting",
  done: "chatLedStatusDone",
  failed: "chatLedStatusFailed",
  cancelled: "chatLedStatusCancelled",
  "timed-out": "chatLedStatusTimedOut",
};

const FORWARD_STATUS_TONE: Record<ForwardStatus, V2StatusTone> = {
  queued: "unknown",
  sending: "run",
  waiting: "you",
  done: "done",
  failed: "block",
  "timed-out": "block",
  cancelled: "paused",
};

const VIOLATION_COPY: Record<ProtocolViolationCode, WorkbenchTextKey> = {
  "no-directive": "chatLedViolationNoDirective",
  "multiple-directives": "chatLedViolationMultipleDirectives",
  "invalid-json": "chatLedViolationInvalidJson",
  "invalid-shape": "chatLedViolationInvalidShape",
  "unknown-target": "chatLedViolationUnknownTarget",
  "unavailable-target": "chatLedViolationUnavailableTarget",
  "self-target": "chatLedViolationSelfTarget",
  "too-many-targets": "chatLedViolationTooManyTargets",
  "duplicate-directive": "chatLedViolationDuplicateDirective",
};

const CLEANUP_RESULT_COPY: Record<CleanupOutcome, WorkbenchTextKey> = {
  deleted: "chatLedResultDeleted",
  archived: "chatLedResultArchived",
  manual: "chatLedResultManual",
  skipped: "chatLedResultSkipped",
};

const CLEANUP_RESULT_TONE: Record<CleanupOutcome, V2StatusTone> = {
  deleted: "done",
  archived: "done",
  manual: "you",
  skipped: "unknown",
};

function providerName(provider: ProviderInstance, labels: Record<string, string>): string {
  return providerInstanceName(provider, labels);
}

function cleanupActionLabel(action: CleanupPlanItem["action"], text: ReturnType<typeof workbenchText>): string {
  if (action === "delete") return text.t("chatLedCleanupActionDelete");
  if (action === "archive") return text.t("chatLedCleanupActionArchive");
  return text.t("chatLedCleanupActionManual");
}

function cleanupActionTone(action: CleanupPlanItem["action"]): V2StatusTone {
  if (action === "delete") return "block";
  if (action === "archive") return "done";
  return "unknown";
}

function cleanupResultTitle(result: CleanupItemResult): string {
  return result.title || result.url || result.provider;
}

/** Pure presentation for the Chat-led run. All state transitions and side effects belong to the caller. */
export function ChatLedView({
  locale,
  run,
  providerLabels,
  cleanup,
  exportedPath,
  onPause,
  onResume,
  onStop,
  onRemind,
  onExtendLimit,
  onTakeOver,
  onExport,
  onCleanup,
  onClose,
}: ChatLedViewProps) {
  const text = workbenchText(locale);
  const rounds = Array.from(
    new Set([
      ...run.coordinatorReplies.map((reply) => reply.round),
      ...run.forwards.map((forward) => forward.round),
    ]),
  ).sort((left, right) => left - right);
  const active = run.phase === "coordinator-thinking" || run.phase === "forwarding";
  const ended = run.phase === "finished" || run.phase === "stopped";
  const showEndSections = ended || Boolean(run.closed);
  const hasExportedPath = Boolean(exportedPath?.trim());

  return (
    <V2Scope className="grid min-h-full content-start gap-v2-lg bg-v2-panel p-v2-page">
      <header className="grid gap-v2-xs">
        <h1 className="text-v2-heading font-semibold text-v2-ink">{text.t("chatLedTitle")}</h1>
        <p className="text-v2-meta text-v2-ink-3">{text.t("chatLedSafety")}</p>
      </header>

      <Card
        accent={run.phase === "awaiting-user" ? "you" : run.phase === "stopped" ? "block" : undefined}
        className="grid gap-v2-sm"
      >
        <div aria-live="polite" className="flex flex-wrap items-center gap-v2-sm">
          <span className="text-v2-meta text-v2-ink-3">{text.t("chatLedStatus")}</span>
          <Badge tone={PHASE_TONE[run.phase]}>{text.t(PHASE_COPY[run.phase])}</Badge>
          <span className="text-v2-meta text-v2-ink-2">
            {text.t("chatLedRoundCount", { round: run.round, limit: run.roundLimit })}
          </span>
          <span className="flex-1" />
          {active ? (
            <Button size="sm" onClick={onPause}>
              {text.t("chatLedPause")}
            </Button>
          ) : null}
          {run.phase === "paused" ? (
            <Button size="sm" onClick={onResume}>
              {text.t("chatLedResume")}
            </Button>
          ) : null}
          {active || run.phase === "paused" ? (
            <Button size="sm" variant="ghost" onClick={onStop}>
              {text.t("chatLedStop")}
            </Button>
          ) : null}
        </div>
      </Card>

      {run.unavailable && run.unavailable.length > 0 ? (
        <Notice tone="you" title={text.t("chatLedUnavailableTitle")} live="polite">
          <ul className="grid gap-v2-xs">
            {run.unavailable.map((item) => (
              <li key={item.provider} className="break-words">
                {text.t("chatLedUnavailableItem", {
                  provider: providerName(item.provider, providerLabels),
                  reason: item.reason,
                })}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <section aria-labelledby="chat-led-goal" className="grid gap-v2-sm">
        <SectionHeader id="chat-led-goal" title={text.t("chatLedGoal")} />
        <Card className="v2-prose whitespace-pre-wrap break-words text-v2-ink">
          {run.goal}
        </Card>
      </section>

      <section aria-labelledby="chat-led-timeline" className="grid gap-v2-sm">
        <SectionHeader id="chat-led-timeline" title={text.t("chatLedTimeline")} />
        {rounds.length === 0 ? (
          <Notice tone="neutral" title={text.t("chatLedNoForwards")} />
        ) : (
          <ol className="grid gap-v2-md">
            {rounds.map((round) => {
              const coordinatorReplies = run.coordinatorReplies.filter((reply) => reply.round === round);
              const forwards = run.forwards.filter((forward) => forward.round === round);
              return (
                <li key={round}>
                  <Card className="grid gap-v2-sm">
                    <SectionHeader title={text.t("chatLedRound", { round })} />
                    {coordinatorReplies.map((reply) => (
                      <details key={reply.at} className="min-w-0">
                        <summary className="cursor-pointer text-v2-meta font-semibold text-v2-ink">
                          {text.t("chatLedCoordinatorReply")}
                          {reply.autoReminder !== undefined ? (
                            <span className="ml-v2-xs font-normal text-v2-ink-2">· {text.t("chatLedAutoReminder")}</span>
                          ) : null}
                        </summary>
                        {reply.autoReminder !== undefined ? (
                          <p className="mt-v2-xs text-v2-meta text-v2-ink-2">{text.t("chatLedAutoReminder")} · {reply.autoReminder}</p>
                        ) : null}
                        <pre className="mt-v2-xs max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">
                          {reply.text}
                        </pre>
                      </details>
                    ))}
                    {forwards.length > 0 ? (
                      <ul className="grid gap-v2-sm">
                        {forwards.map((forward) => (
                          <li key={forward.id}>
                            <ForwardRow
                              forward={forward}
                              providerLabels={providerLabels}
                              locale={locale}
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <ProcessLog run={run} providerLabels={providerLabels} text={text} />

      {run.stop?.type === "protocol-violation" ? (
        <Notice tone="block" title={text.t("chatLedProtocolViolationTitle")} live="assertive">
          <div className="grid gap-v2-sm">
            <p className="break-words">
              <code className="font-v2-mono">{run.stop.violation.code}</code>
              {" · "}
              {text.t(VIOLATION_COPY[run.stop.violation.code])}
            </p>
            <details>
              <summary className="cursor-pointer text-v2-meta font-semibold text-v2-ink">
                {text.t("chatLedRawReply")}
              </summary>
              <pre className="mt-v2-xs max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">
                {run.stop.rawReply}
              </pre>
            </details>
            <div className="flex flex-wrap gap-v2-sm">
              <Button size="sm" onClick={onRemind}>
                {text.t("chatLedRemind")}
              </Button>
              <Button size="sm" onClick={() => onTakeOver(run.coordinator)}>
                {text.t("chatLedTakeOver")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onStop}>
                {text.t("chatLedStop")}
              </Button>
            </div>
          </div>
        </Notice>
      ) : null}

      {run.stop?.type === "round-limit" ? (
        <Notice tone="you" title={text.t("chatLedRoundLimitTitle")} live="polite">
          <div className="grid gap-v2-sm">
            <p>{text.t("chatLedRoundLimitReached", { limit: run.stop.limit })}</p>
            <div className="flex flex-wrap gap-v2-sm">
              <Button size="sm" onClick={() => onExtendLimit(4)}>
                {text.t("chatLedExtendLimit")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onStop}>
                {text.t("chatLedStop")}
              </Button>
            </div>
          </div>
        </Notice>
      ) : null}

      {run.stop?.type === "provider-failure" ? (
        <Notice tone="block" title={text.t("chatLedProviderFailureTitle")} live="assertive">
          <div className="grid gap-v2-sm">
            <p className="break-words">
              {text.t("chatLedProviderError", {
                provider: providerName(run.stop.provider, providerLabels),
                error: run.stop.error,
              })}
            </p>
            <div className="flex flex-wrap gap-v2-sm">
              <Button size="sm" onClick={onRemind}>
                {text.t("chatLedRetry")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onStop}>
                {text.t("chatLedStop")}
              </Button>
            </div>
          </div>
        </Notice>
      ) : null}

      {run.phase === "awaiting-user" && !run.stop ? (
        <Notice tone="you" title={text.t("chatLedNeedsYou")}>
          <Button size="sm" variant="ghost" onClick={onStop}>
            {text.t("chatLedStop")}
          </Button>
        </Notice>
      ) : null}

      {run.stop?.type === "user" ? (
        <Notice tone="paused" title={text.t("chatLedStoppedByUser")} />
      ) : null}

      {run.phase === "finished" && run.doneSummary ? (
        <section aria-labelledby="chat-led-summary" className="grid gap-v2-sm">
          <SectionHeader id="chat-led-summary" title={text.t("chatLedDoneSummary")} />
          <Card className="v2-prose whitespace-pre-wrap break-words text-v2-ink">
            {run.doneSummary}
          </Card>
        </section>
      ) : null}

      {showEndSections ? (
        <section aria-labelledby="chat-led-cleanup" className="grid gap-v2-sm">
          <SectionHeader id="chat-led-cleanup" title={text.t("chatLedCleanup")} />
          <div className="grid gap-v2-md">
            <Card className="grid gap-v2-sm">
              <div className="flex flex-wrap items-center gap-v2-sm">
                <SectionHeader title={text.t("chatLedExport")} />
                <Button size="sm" onClick={onExport}>
                  {text.t("chatLedExport")}
                </Button>
              </div>
              {hasExportedPath ? (
                <p className="break-all text-v2-meta text-v2-ink-2">
                  {text.t("chatLedExportedPath", { path: exportedPath || "" })}
                </p>
              ) : null}
            </Card>

            <Card className="grid gap-v2-sm">
              <SectionHeader title={text.t("chatLedCleanupPlan")} />
              {cleanup.plan === null ? (
                cleanup.results === null ? <Notice tone="unknown" title={text.t("chatLedCleanupPlanPending")} /> : null
              ) : cleanup.plan.length === 0 ? (
                <p className="text-v2-meta text-v2-ink-2">{text.t("chatLedCleanupNoItems")}</p>
              ) : (
                <ul className="grid gap-v2-sm">
                  {cleanup.plan.map((item, index) => (
                    <li key={item.url + "-" + index}>
                      <Card padding="sm" className="grid gap-v2-xs">
                        <div className="flex flex-wrap items-center gap-v2-sm">
                          <span className="font-semibold text-v2-ink">
                            {providerName(item.provider, providerLabels)}
                          </span>
                          <Badge tone={cleanupActionTone(item.action)}>
                            {cleanupActionLabel(item.action, text)}
                          </Badge>
                        </div>
                        <p className="break-words text-v2-body text-v2-ink">
                          {item.title || item.url}
                        </p>
                        {item.title ? (
                          <p className="break-all text-v2-meta text-v2-ink-3">{item.url}</p>
                        ) : null}
                        <p className="break-words text-v2-meta text-v2-ink-2">
                          {text.t("chatLedCleanupReason", { reason: item.reason })}
                        </p>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}

              {cleanup.results === null && cleanup.plan !== null ? (
                <div className="flex flex-wrap items-center gap-v2-sm">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={cleanup.running || !hasExportedPath}
                    loading={cleanup.running}
                    disabledReason={
                      cleanup.running
                        ? text.t("chatLedCleanupInProgress")
                        : !hasExportedPath
                          ? text.t("chatLedExportFirst")
                          : undefined
                    }
                    onClick={onCleanup}
                  >
                    {cleanup.running ? text.t("chatLedCleanupInProgress") : text.t("chatLedCleanupButton")}
                  </Button>
                  {!hasExportedPath ? (
                    <p className="text-v2-meta text-v2-ink-3">{text.t("chatLedExportFirst")}</p>
                  ) : null}
                </div>
              ) : null}

              {cleanup.results !== null ? (
                <section aria-labelledby="chat-led-cleanup-results" className="grid gap-v2-sm">
                  <SectionHeader id="chat-led-cleanup-results" title={text.t("chatLedCleanupResults")} />
                  {cleanup.results.length === 0 ? (
                    <p className="text-v2-meta text-v2-ink-2">{text.t("chatLedCleanupNoItems")}</p>
                  ) : (
                    <ul className="grid gap-v2-sm">
                      {cleanup.results.map((result, index) => (
                        <li key={(result.url || result.provider) + "-" + index}>
                          <Card padding="sm" className="grid gap-v2-xs">
                            <div className="flex flex-wrap items-center gap-v2-sm">
                              <span className="font-semibold text-v2-ink">
                                {providerName(result.provider, providerLabels)}
                              </span>
                              <Badge tone={CLEANUP_RESULT_TONE[result.outcome]}>
                                {text.t(CLEANUP_RESULT_COPY[result.outcome])}
                              </Badge>
                            </div>
                            <p className="break-words text-v2-body text-v2-ink">
                              {cleanupResultTitle(result)}
                            </p>
                            {result.url ? (
                              <p className="break-all text-v2-meta text-v2-ink-3">{result.url}</p>
                            ) : null}
                            <p className="break-words text-v2-meta text-v2-ink-2">
                              {text.t("chatLedResultNote", { note: result.note })}
                            </p>
                          </Card>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              {run.closed ? (
                <Badge tone="done">{text.t("chatLedAlreadyClosed")}</Badge>
              ) : cleanup.results !== null && !cleanup.running ? (
                <div>
                  <Button size="sm" onClick={onClose}>
                    {text.t("chatLedMarkClosed")}
                  </Button>
                </div>
              ) : null}
            </Card>
          </div>
        </section>
      ) : null}
    </V2Scope>
  );
}

const LOG_EVENT_COPY: Record<ChatLedLogEvent, WorkbenchTextKey> = {
  "prepare-start": "chatLedLogPrepareStart",
  "prepare-ok": "chatLedLogPrepareOk",
  "prepare-failed": "chatLedLogPrepareFailed",
  "targets-ready": "chatLedLogTargetsReady",
  paused: "chatLedLogPaused",
  resumed: "chatLedLogResumed",
  stopped: "chatLedLogStopped",
};

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

/** Collapsed by default: system events and every message ai-one sent to the coordinator (#196). */
function ProcessLog({
  run,
  providerLabels,
  text,
}: {
  run: ChatLedRun;
  providerLabels: Record<string, string>;
  text: ReturnType<typeof workbenchText>;
}) {
  const log = run.log ?? [];
  const coordinator = providerName(run.coordinator, providerLabels);
  return (
    <details className="min-w-0" data-testid="chat-led-process-log">
      <summary className="cursor-pointer text-v2-body font-semibold text-v2-ink">
        {text.t("chatLedLogTitle", { count: log.length })}
      </summary>
      {log.length === 0 ? (
        <p className="mt-v2-xs text-v2-meta text-v2-ink-3">{text.t("chatLedLogEmpty")}</p>
      ) : (
        <ol className="mt-v2-sm grid gap-v2-xs">
          {log.map((entry, index) => {
            const time = <span className="mr-v2-sm font-v2-mono text-v2-micro text-v2-ink-3">{clockTime(entry.at)}</span>;
            if (entry.kind === "event") {
              return (
                <li key={index} className="break-words text-v2-meta text-v2-ink-2">
                  {time}
                  {text.t(LOG_EVENT_COPY[entry.event], {
                    provider: entry.provider ? providerName(entry.provider, providerLabels) : "",
                    detail: entry.detail
                      ? entry.event === "targets-ready"
                        ? entry.detail.split(", ").map((provider) => providerName(provider as ProviderInstance, providerLabels)).join("、")
                        : entry.detail
                      : "",
                  })}
                </li>
              );
            }
            const body =
              entry.kind === "feedback"
                ? buildFeedbackPrompt(settledFeedbackItems(run, entry.round) ?? [], entry.round, entry.remaining)
                : entry.text;
            return (
              <li key={index} className="min-w-0">
                <details>
                  <summary className="cursor-pointer text-v2-meta text-v2-ink">
                    {time}
                    {entry.kind === "feedback"
                      ? text.t("chatLedLogFeedback", { coordinator, round: entry.round })
                      : text.t("chatLedLogToCoordinator", { coordinator })}
                    <span className="ml-v2-xs text-v2-ink-3">· {text.t("chatLedChars", { count: body.length })}</span>
                  </summary>
                  <pre className="mt-v2-xs max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">
                    {body}
                  </pre>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </details>
  );
}

function ForwardRow({
  forward,
  providerLabels,
  locale,
}: {
  forward: ForwardRecord;
  providerLabels: Record<string, string>;
  locale: Locale;
}) {
  const text = workbenchText(locale);
  return (
    <Card padding="sm" className="grid min-w-0 gap-v2-sm">
      <div className="flex flex-wrap items-center gap-v2-sm">
        <span className="min-w-0 break-words text-v2-meta font-semibold text-v2-ink">
          {text.t("chatLedForwardSummary", {
            coordinator: providerName(forward.from, providerLabels),
            target: providerName(forward.to, providerLabels),
            count: forward.messageChars,
          })}
        </span>
        <Badge tone={FORWARD_STATUS_TONE[forward.status]}>
          {text.t(FORWARD_STATUS_COPY[forward.status])}
        </Badge>
      </div>
      <details className="min-w-0">
        <summary className="cursor-pointer text-v2-meta text-v2-ink-2">
          {text.t("chatLedMessage")}
        </summary>
        <pre className="mt-v2-xs max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">
          {forward.message}
        </pre>
      </details>
      {forward.reply !== undefined ? (
        <details className="min-w-0">
          <summary className="cursor-pointer text-v2-meta text-v2-ink-2">
            {text.t("chatLedReply")}
          </summary>
          <pre className="mt-v2-xs max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-v2-sm bg-v2-sunken p-v2-sm font-v2-mono text-v2-micro text-v2-ink-2">
            {forward.reply}
          </pre>
        </details>
      ) : (
        <p className="text-v2-meta text-v2-ink-3">{text.t("chatLedNoReply")}</p>
      )}
      {forward.error ? (
        <Notice tone="block" title={text.t("chatLedForwardError")}>
          <p className="break-words">{forward.error}</p>
        </Notice>
      ) : null}
    </Card>
  );
}

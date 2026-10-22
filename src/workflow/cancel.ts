import type { AIProvider } from '../../shared/types';
import { AI_PROVIDERS } from '../../shared/constants';
import { host, type ProviderStopResult } from '../host';
import type { Locale } from '../i18n/resolve';
import { formatI18n, t } from '../i18n/t';
import { emitSystemError } from './events';

let workflowAborted = false;
const inFlight = new Set<AIProvider>();
const abortListeners = new Set<(reason: Error) => void>();
const pendingStops = new Map<AIProvider, Promise<ProviderStopResult>>();
let stopNoticeLocale: Locale = 'en';

export function resetCancelState(): void {
  workflowAborted = false;
  inFlight.clear();
}

export function setStopNoticeLocale(locale: Locale | undefined): void {
  stopNoticeLocale = locale ?? 'en';
}

export function markInFlight(provider: AIProvider): void {
  inFlight.add(provider);
}

export function clearInFlight(provider: AIProvider): void {
  inFlight.delete(provider);
}

export function getInFlightProviders(): AIProvider[] {
  return [...inFlight];
}

export function abortWorkflow(): void {
  workflowAborted = true;
  const reason = new Error('Workflow cancelled by user');
  for (const listener of [...abortListeners]) listener(reason);
}

export function checkAborted(): void {
  if (workflowAborted) throw new Error('Workflow cancelled by user');
}

export function onWorkflowAbort(listener: (reason: Error) => void): () => void {
  abortListeners.add(listener);
  return () => abortListeners.delete(listener);
}

// Stop is only called for a provider with a step in flight, so anything short of a clicked stop
// control means its page may still be generating. Say so instead of failing silently; the page
// engine also refuses the next send until it sees the page stay idle.
export function stopProvider(provider: AIProvider): Promise<ProviderStopResult> {
  const existing = pendingStops.get(provider);
  if (existing) return existing;
  const pending = stopProviderOnce(provider).finally(() => pendingStops.delete(provider));
  pendingStops.set(provider, pending);
  return pending;
}

async function stopProviderOnce(provider: AIProvider): Promise<ProviderStopResult> {
  let result: ProviderStopResult;
  try {
    result = await host.provider.stop(provider);
  } catch (error) {
    result = { outcome: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
  if (result.outcome !== 'clicked') reportUnconfirmedStop(provider, result);
  return result;
}

function reportUnconfirmedStop(provider: AIProvider, result: ProviderStopResult): void {
  const name = AI_PROVIDERS[provider]?.name ?? provider;
  const key = result.outcome === 'error' ? 'workflow.providerStopFailed' : 'workflow.providerStopNotClicked';
  emitSystemError(formatI18n(t(key, stopNoticeLocale), { provider: name, detail: result.detail ?? result.outcome }));
}

import type { ProviderInstance } from '../../../shared/types';
import { host } from '../../host';

// The classic bridge subscribes to first instances only. Each extra page owns its own outbox.
interface Pending { cancelled: boolean; cancel(reason: Error): void }
const pending = new Map<ProviderInstance, Pending>();
const sleep = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
const GENERATING_PROBE_INTERVAL_MS = 10_000;
const GENERATING_PROBE_JS =
  "window.__MAC_ENGINE__ && typeof window.__MAC_ENGINE__.generating === 'function' ? window.__MAC_ENGINE__.generating() : false";

function parseBatch(raw: string): unknown[] {
  const first: unknown = JSON.parse(raw);
  const parsed: unknown = typeof first === 'string' ? JSON.parse(first) : first;
  if (!Array.isArray(parsed)) throw new Error('Invalid provider outbox.');
  return parsed;
}

function replyText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const text = (payload as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return JSON.stringify(payload ?? '');
}

export function cancelInstanceSend(instance: ProviderInstance): void {
  pending.get(instance)?.cancel(new Error('Provider instance send cancelled.'));
}

export function sendAndWaitInstance(instance: ProviderInstance, text: string): Promise<string> {
  if (pending.has(instance)) return Promise.reject(new Error('Provider instance already has an active send.'));
  let rejectStop!: (reason: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const state: Pending = {
    cancelled: false,
    cancel(reason) { state.cancelled = true; rejectStop(reason); },
  };
  pending.set(instance, state);
  // No await before send; forwardLive/proceed is the final authorization gate. drainOutbox drops replies
  // a cancelled/timed-out earlier send left in the page, in the same script that dispatches this message.
  let sent: Promise<void>;
  try { sent = host.provider.send(instance, text, { drainOutbox: true }); }
  catch (error) { pending.delete(instance); return Promise.reject(error); }
  const work = (async () => {
    await sent;
    let bootId: string | undefined;
    let lastMid = 0;
    let failures = 0;
    const startedAt = Date.now();
    let lastActivityAt = startedAt;
    let lastGeneratingProbeAt = startedAt;
    while (!state.cancelled) {
      if (Date.now() - lastActivityAt > 10 * 60_000 || Date.now() - startedAt > 60 * 60_000) {
        throw new Error('Provider instance response timed out.');
      }
      try {
        const raw = await host.provider.evalWithCallback(
          instance, 'window.__MAC_BRIDGE__ ? window.__MAC_BRIDGE__.peekOutbox() : []',
        );
        if (state.cancelled) break;
        const batch = parseBatch(raw);
        let maxMid = lastMid;
        let completed: string | undefined;
        for (const value of batch) {
          if (!value || typeof value !== 'object') continue;
          const item = value as { bootId?: unknown; mid?: unknown; action?: unknown; payload?: unknown };
          if (typeof item.bootId !== 'string' || typeof item.mid !== 'number' || !Number.isFinite(item.mid)) continue;
          if (bootId === undefined) bootId = item.bootId;
          if (item.bootId !== bootId) throw new Error('Provider page changed while waiting for its reply.');
          if (item.mid <= lastMid) continue;
          maxMid = Math.max(maxMid, item.mid);
          lastActivityAt = Date.now();
          if (item.action === 'RESPONSE_DONE') {
            if (item.payload && typeof item.payload === 'object' && (item.payload as { truncated?: unknown }).truncated === true)
              throw new Error('Provider response was truncated.');
            completed = replyText(item.payload);
          }
        }
        if (maxMid === lastMid && Date.now() - lastGeneratingProbeAt >= GENERATING_PROBE_INTERVAL_MS) {
          // A model can think for many minutes without output; that is activity, not a stalled page.
          lastGeneratingProbeAt = Date.now();
          const generating = await host.provider.evalWithCallback(instance, GENERATING_PROBE_JS);
          if (state.cancelled) break;
          if (JSON.parse(generating) === true) lastActivityAt = Date.now();
        }
        if (maxMid > lastMid) {
          await host.provider.eval(instance, `window.__MAC_BRIDGE__ && window.__MAC_BRIDGE__.ackBulk(${maxMid});`);
          if (state.cancelled) break;
          lastMid = maxMid;
        }
        failures = 0;
        if (completed !== undefined) return completed;
      } catch (error) {
        if (state.cancelled) break;
        if (++failures >= 5) throw error;
      }
      await sleep(500);
    }
    throw new Error('Provider instance send cancelled.');
  })();
  work.catch(() => undefined);
  return Promise.race([work, stopped]).finally(() => {
    if (pending.get(instance) === state) pending.delete(instance);
  });
}

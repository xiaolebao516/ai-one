import type { V2BadgeTone } from '../ui/v2';
import { summarizeDispatch, type ChannelSummary } from './dispatchModel';
import type { DispatchData } from './useDispatchData';
import type { WorkbenchTextKey } from './workbenchText';

/** What the channel card and the title bar say about Prodex, one word per read state. */
export interface ChannelView {
  tone: 'ok' | 'attention' | 'incomplete' | 'empty' | 'pending' | 'failed';
  labelKey: WorkbenchTextKey;
  /** Only for data that was actually read (or the demo); never for a stale or failed read. */
  summary?: ChannelSummary;
}

export const CHANNEL_BADGE: Record<ChannelView['tone'], V2BadgeTone> = {
  ok: 'done',
  // A channel problem is not a decision for the user, so it is not the amber "needs you" tone.
  attention: 'block',
  incomplete: 'unknown',
  empty: 'unknown',
  pending: 'unknown',
  failed: 'block',
};

const LABEL: Record<ChannelView['tone'], WorkbenchTextKey> = {
  ok: 'channelOk',
  attention: 'channelAttention',
  incomplete: 'channelIncomplete',
  empty: 'channelEmpty',
  pending: 'channelNotRead',
  failed: 'channelFailed',
};

export function channelView(dispatch: Pick<DispatchData, 'state' | 'snapshot' | 'observedAt'>): ChannelView {
  const { state, snapshot } = dispatch;
  if (state === 'error') return { tone: 'failed', labelKey: LABEL.failed };
  if ((state !== 'ready' && state !== 'demo') || !snapshot) return { tone: 'pending', labelKey: LABEL.pending };
  // "Recent" is measured from the moment of the read, so the page does not change by itself while
  // open. Demo records are fixed in the past: measure them from their own last record.
  const now = state === 'ready' ? dispatch.observedAt ?? 0 : Date.parse(summarizeDispatch(snapshot, 0).lastAt ?? '') || 0;
  const summary = summarizeDispatch(snapshot, now);
  return { tone: summary.tone, labelKey: LABEL[summary.tone], summary };
}

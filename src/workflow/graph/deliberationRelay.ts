import type { HistoryItem } from './types';
import { SKIP_RESPONSE } from '../state';

/**
 * Each provider keeps its own native page conversation. Relay only complete,
 * not-yet-seen replies from the OTHER provider; never shorten a reply or rely
 * on repeating the full transcript at every turn.
 */
/** Keep the exact full-reply heading and transcript format shared by deliberation and chat forwarding. */
export function deliberationTranscript(updates: readonly Pick<HistoryItem, 'name' | 'round' | 'text'>[]): string {
  return updates.map((item) => {
    const heading = item.round ? '第 ' + item.round + ' 轮 · ' + item.name : '独立初答 · ' + item.name;
    return heading + '\n' + item.text;
  }).join('\n\n---\n\n');
}

export function formatDeliberationRelaySection(
  updates: readonly Pick<HistoryItem, 'name' | 'round' | 'text'>[],
): string {
  return '以下是另一位 AI 的新回复（完整内容，本对话尚未收到过）：\n' + deliberationTranscript(updates);
}

export function newDeliberationReplies(
  history: readonly HistoryItem[],
  receiverName: string,
  round: number,
): HistoryItem[] {
  if (!receiverName.trim()) return [...history];
  let lastOwnReply = -1;
  for (let index = 0; index < history.length; index += 1) {
    if (history[index].name === receiverName && history[index].text !== SKIP_RESPONSE) lastOwnReply = index;
  }
  return history.filter((item, index) => {
    if (item.name === receiverName || item.text === SKIP_RESPONSE) return false;
    // Both models answered independently. At round 1, each must receive the
    // other's initial answer, even if it precedes their own in the graph history.
    const unseenInitial = round === 1 && item.round === undefined;
    return unseenInitial || index > lastOwnReply;
  });
}

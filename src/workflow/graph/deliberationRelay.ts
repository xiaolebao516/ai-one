import type { HistoryItem } from './types';

/**
 * Each provider keeps its own native page conversation. Relay only complete,
 * not-yet-seen replies from the OTHER provider; never shorten a reply or rely
 * on repeating the full transcript at every turn.
 */
export function newDeliberationReplies(
  history: readonly HistoryItem[],
  receiverName: string,
  round: number,
): HistoryItem[] {
  if (!receiverName.trim()) return [...history];
  let lastOwnReply = -1;
  for (let index = 0; index < history.length; index += 1) {
    if (history[index].name === receiverName) lastOwnReply = index;
  }
  return history.filter((item, index) => {
    if (item.name === receiverName) return false;
    // Both models answered independently. At round 1, each must receive the
    // other's initial answer, even if it precedes their own in the graph history.
    const unseenInitial = round === 1 && item.round === undefined;
    return unseenInitial || index > lastOwnReply;
  });
}

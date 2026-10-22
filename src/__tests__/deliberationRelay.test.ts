import { describe, expect, it } from 'vitest';
import { newDeliberationReplies } from '../workflow/graph/deliberationRelay';
import type { HistoryItem } from '../workflow/graph/types';

describe('per-provider discussion relay', () => {
  const chat = 'ChatGPT';
  const gemini = 'Gemini';
  const history: HistoryItem[] = [
    { name: chat, text: 'chat initial' },
    { name: gemini, text: 'gemini initial' },
    { name: chat, round: 1, text: 'chat round 1' },
    { name: gemini, round: 1, text: 'gemini round 1' },
    { name: chat, round: 2, text: 'chat round 2' },
    { name: gemini, round: 2, text: 'gemini round 2' },
  ];

  it('first ChatGPT update contains only the independent Gemini opening', () => {
    expect(newDeliberationReplies(history.slice(0, 2), chat, 1).map((x) => x.text)).toEqual(['gemini initial']);
  });

  it('first Gemini update contains the ChatGPT opening and first reply, never its own opening', () => {
    expect(newDeliberationReplies(history.slice(0, 3), gemini, 1).map((x) => x.text)).toEqual([
      'chat initial', 'chat round 1',
    ]);
  });

  it('later rounds relay only previously unseen opposing replies in order, without truncation', () => {
    expect(newDeliberationReplies(history.slice(0, 4), chat, 2).map((x) => x.text)).toEqual(['gemini round 1']);
    expect(newDeliberationReplies(history.slice(0, 5), gemini, 2).map((x) => x.text)).toEqual(['chat round 2']);
    expect(newDeliberationReplies(history, chat, 3).map((x) => x.text)).toEqual(['gemini round 2']);
    expect(newDeliberationReplies(history, gemini, 3).map((x) => x.text)).toEqual([]);
  });

  it('falls back to preserving all history if the provider identity is unknown', () => {
    expect(newDeliberationReplies(history, '', 3)).toEqual(history);
  });
});

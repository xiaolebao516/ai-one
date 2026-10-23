import type { AIProvider } from '../../shared/types';

export const SKIP_RESPONSE = '(no response — skipped)';

let nextTurn = 0;
const activeTurns = new Map<AIProvider, number>();
const activeResponseRequests = new Map<AIProvider, string>();
let responseRequestIdFactory: ((provider: AIProvider) => string) | undefined;

/** Opt-in request correlation for callers that own a chat transcript. Legacy runs stay unchanged. */
export function setResponseRequestIdFactory(factory: typeof responseRequestIdFactory): void {
  responseRequestIdFactory = factory;
}

export function createResponseRequestId(provider: AIProvider): string | undefined {
  const id = responseRequestIdFactory?.(provider);
  if (id) activeResponseRequests.set(provider, id);
  return id;
}

export function getResponseRequestId(provider: AIProvider): string | undefined {
  return activeResponseRequests.get(provider);
}

export function resetWorkflowStateForTests(): void {
  nextTurn = 0;
  activeTurns.clear();
  activeResponseRequests.clear();
  responseRequestIdFactory = undefined;
}

export function resetWorkflowState(): void {
  resetWorkflowStateForTests();
}

export function reserveTurn(provider: AIProvider): number {
  nextTurn += 1;
  activateTurn(provider, nextTurn);
  return nextTurn;
}

export function activateTurn(provider: AIProvider, turn: number): void {
  nextTurn = Math.max(nextTurn, turn);
  activeTurns.set(provider, turn);
}

export function getActiveTurn(provider: AIProvider): number | undefined {
  return activeTurns.get(provider);
}

export function clearActiveTurn(provider: AIProvider, turn: number): void {
  if (activeTurns.get(provider) === turn) {
    activeTurns.delete(provider);
    activeResponseRequests.delete(provider);
  }
}

export function bumpTurnEpoch(): void {
  nextTurn += 1;
  activeTurns.clear();
  activeResponseRequests.clear();
}

import type { AIProvider } from '../../shared/types';
import { ProviderResponseError } from '../workflow/providerResponse';

// Dev-only one-shot fault: simulated before any provider message is sent.
let armed = false;
export function armDevDeliberationFault(): boolean {
  if (!import.meta.env.DEV) return false;
  armed = true;
  return true;
}
export function clearDevDeliberationFault(): void { armed = false; }
export function isDevDeliberationFaultArmed(): boolean { return import.meta.env.DEV && armed; }
export function consumeDevDeliberationFault(nodeId: string, provider: AIProvider): boolean {
  if (!import.meta.env.DEV || !armed || nodeId !== 'round1_second' || provider !== 'gemini') return false;
  armed = false;
  return true;
}
export class DevDeliberationFaultError extends ProviderResponseError {
  constructor(provider: AIProvider) {
    super(
      provider,
      '[Error: simulated provider failure (dev-only, pre-send)]',
      'simulated provider failure (dev-only, pre-send)',
    );
    this.name = 'DevDeliberationFaultError';
  }
}

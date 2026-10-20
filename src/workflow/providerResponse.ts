import type { AIProvider } from '../../shared/types';

const PROVIDER_ERROR_PATTERN = /^\[Error:\s*([\s\S]*?)\]$/;
const SEND_NOT_ACCEPTED_SUFFIX = 'send was not accepted; draft is still in composer';

export class ProviderResponseError extends Error {
  readonly provider: AIProvider;
  readonly response: string;

  constructor(provider: AIProvider, response: string, reason: string) {
    super(reason);
    this.name = 'ProviderResponseError';
    this.provider = provider;
    this.response = response;
  }
}

const PROVIDER_PAGE_RELOADED_REASON = 'provider page reloaded during its turn';

export class ProviderPageReloadedError extends ProviderResponseError {
  constructor(provider: AIProvider) {
    super(provider, `[Error: ${PROVIDER_PAGE_RELOADED_REASON}]`, PROVIDER_PAGE_RELOADED_REASON);
    this.name = 'ProviderPageReloadedError';
  }
}

const PROVIDER_RESPONSE_TRUNCATED_REASON = 'response truncated in transport';

// The page outbox caps oversized entries and marks RESPONSE_DONE as truncated. A cut answer must
// never stand in for the full reply, so it fails the step instead of flowing to the next role.
export class ProviderResponseTruncatedError extends ProviderResponseError {
  constructor(provider: AIProvider) {
    super(provider, `[Error: ${PROVIDER_RESPONSE_TRUNCATED_REASON}]`, PROVIDER_RESPONSE_TRUNCATED_REASON);
    this.name = 'ProviderResponseTruncatedError';
  }
}

export function isProviderPageReloadedError(error: unknown): error is ProviderPageReloadedError {
  return error instanceof ProviderPageReloadedError;
}

export function providerResponseError(provider: AIProvider, response: string): ProviderResponseError | undefined {
  const match = PROVIDER_ERROR_PATTERN.exec(response.trim());
  if (!match) return undefined;
  return new ProviderResponseError(provider, response.trim(), match[1].trim());
}

export function isRetryableSendRejection(error: ProviderResponseError): boolean {
  return error.message.toLowerCase() === `${error.provider} ${SEND_NOT_ACCEPTED_SUFFIX}`;
}

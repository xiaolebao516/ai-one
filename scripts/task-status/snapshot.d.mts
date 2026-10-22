/** Types for the schemaVersion 1 JSON returned by snapshot.mjs (Issue #36).
 * Keep this declaration beside the unmodified .mjs implementation.
 */
export interface SnapshotOptions {
  repo: string;
  page?: number;
  limit?: number;
}

export interface ValidatedSnapshotOptions {
  repo: string;
  page: number;
  limit: number;
}

export interface SnapshotClient {
  get(path: string): Promise<unknown>;
  associations(repo: string, numbers: number[]): Promise<unknown>;
}

export interface SnapshotSource {
  url: string;
  observedAt: string;
  field?: string;
}

export interface SnapshotError extends SnapshotSource {
  message: string;
}

export type SnapshotStatus = 'complete' | 'partial' | 'error';
export type SnapshotMore = 'no' | 'possible' | 'unknown';

export interface SnapshotPaginationEntry {
  page: number;
  limit: number;
  returned: number | null;
  more: SnapshotMore;
  earlierPagesOmitted: boolean;
  source: SnapshotSource;
}

export interface SnapshotInference {
  value: boolean;
  kind: 'inference';
  reason: string;
  headSha?: string;
  source: SnapshotSource;
}

export interface SnapshotIssue {
  number: number;
  title: string;
  state: 'open';
  url: string;
  labels: string[];
  source: SnapshotSource;
  association: {
    status: 'linked' | 'unlinked' | 'unknown';
    pullRequests: Array<{ number: number; headSha: string; source: SnapshotSource }>;
    scope: string;
  };
  possibleHumanAcceptance: SnapshotInference;
}

export type SnapshotCiConclusion = 'success' | 'failure' | 'pending' | 'missing' | 'unknown' | 'no_success';

export interface SnapshotCi {
  headSha: string;
  conclusion: SnapshotCiConclusion;
  completeness: 'complete' | 'partial';
  checks: Array<{
    name: string;
    headSha: string;
    status: string;
    conclusion: string;
    url: string | null;
  }>;
  statuses: Array<{ context: string; state: string; url: string | null }>;
  sources: SnapshotSource[];
}

export interface SnapshotPullRequest {
  number: number;
  title: string;
  state: 'open';
  draft: boolean;
  headSha: string;
  url: string;
  source: SnapshotSource;
  ci: SnapshotCi;
  association: {
    status: 'unknown' | 'complete' | 'partial';
    issues: Array<{ number: number; repository: string }>;
    source: SnapshotSource | null;
  };
  possibleHumanAcceptance: SnapshotInference;
}

export interface GitHubSnapshot {
  schemaVersion: 1;
  repository: string;
  startedAt: string;
  completedAt: string | null;
  status: SnapshotStatus;
  scope: { page: number; limit: number; description: string };
  issues: SnapshotIssue[];
  pullRequests: SnapshotPullRequest[];
  pagination: Partial<Record<'issues' | 'pullRequests', SnapshotPaginationEntry>>;
  errors: SnapshotError[];
  runtime: {
    agentOnline: 'unknown';
    quota: 'unknown';
    iteration: 'unknown';
    loginState: 'unknown';
  };
}

export function validateOptions(options: SnapshotOptions): ValidatedSnapshotOptions;
export function collectSnapshot(
  options: SnapshotOptions,
  client: SnapshotClient,
  now?: () => string,
): Promise<GitHubSnapshot>;
export function renderText(snapshot: GitHubSnapshot): string;

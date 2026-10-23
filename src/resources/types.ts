export type QuotaHudState = 'running' | 'stopped' | 'absent' | 'unreadable' | 'unavailable';
export type HudConnectionStatus = 'connected' | 'disconnected' | 'loading';
export type HudQuotaStatus = 'normal' | 'warning' | 'critical' | 'stale';
export type HudSessionState = 'running' | 'waiting' | 'idle' | 'unverified';
export type HudAccountStatusCode = 'ready' | 'error' | 'unavailable';

export interface HudConnection {
  status: HudConnectionStatus | null;
  message: string | null;
  platform: string | null;
}

export interface HudIndexing {
  complete: boolean | null;
  pending: number | null;
}

export interface HudQuotaMetrics {
  burnRatePctPerHour: number | null;
}

export interface HudQuota {
  id: string | number | null;
  vendor: string | null;
  name: string | null;
  shortLabel: string | null;
  usedPercent: number | null;
  resetAt: string | null;
  status: HudQuotaStatus | null;
  account: string | null;
  observedAt: string | null;
  metrics: HudQuotaMetrics | null;
}

export interface HudAccountStatus {
  status: HudAccountStatusCode | null;
  notice: string | null;
  checkedAt: string | null;
}

export interface HudProvider {
  id: string | null;
  name: string | null;
  detected: boolean | null;
  accountStatus: HudAccountStatus | null;
}

export interface HudSession {
  id: string | null;
  title: string | null;
  source: string | null;
  state: HudSessionState | null;
  updatedAt: string | null;
  tokens: number | null;
}

export interface HudSnapshot {
  schemaVersion: 1 | null;
  generatedAt: string | null;
  mode: 'live' | 'demo' | null;
  connection: HudConnection | null;
  indexing: HudIndexing | null;
  quotas: HudQuota[];
  providers: HudProvider[];
  sessions: HudSession[];
}

export interface QuotaHudReading {
  state: QuotaHudState;
  heartbeatAgeSeconds: number | null;
  snapshot: HudSnapshot | null;
  readAt: string | null;
}

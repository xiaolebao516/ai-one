import type {
  HudAccountStatus,
  HudConnection,
  HudIndexing,
  HudProvider,
  HudQuota,
  HudSession,
  HudSnapshot,
  QuotaHudReading,
  QuotaHudState,
} from './types';

type RecordValue = Record<string, unknown>;

const QUOTA_HUD_STATES = ['running', 'stopped', 'absent', 'unreadable', 'unavailable'] as const;
const CONNECTION_STATES = ['connected', 'disconnected', 'loading'] as const;
const QUOTA_STATES = ['normal', 'warning', 'critical', 'stale'] as const;
const SESSION_STATES = ['running', 'waiting', 'idle', 'unverified'] as const;
const ACCOUNT_STATES = ['ready', 'error', 'unavailable'] as const;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function dateValue(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * A missing reset time is null ("none known"); a reset time that is present but unusable is kept as
 * an unparseable marker so the registry can refuse to show that window as current.
 */
const INVALID_TIME = 'invalid';
function resetValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : INVALID_TIME;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percentage(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] | null {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T[number] : null;
}

function parseConnection(value: unknown): HudConnection | null {
  const raw = record(value);
  if (!raw) return null;
  return {
    status: enumValue(raw.status, CONNECTION_STATES),
    message: stringValue(raw.message),
    platform: stringValue(raw.platform),
  };
}

function parseIndexing(value: unknown): HudIndexing | null {
  const raw = record(value);
  if (!raw) return null;
  const pending = finiteNumber(raw.pending);
  return {
    complete: typeof raw.complete === 'boolean' ? raw.complete : null,
    pending: pending !== null && pending >= 0 ? pending : null,
  };
}

function parseQuota(value: unknown): HudQuota | null {
  const raw = record(value);
  if (!raw) return null;
  const metrics = record(raw.metrics);
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? raw.id : null;
  const burnRate = metrics ? finiteNumber(metrics.burnRatePctPerHour) : null;
  return {
    id,
    vendor: stringValue(raw.vendor),
    name: stringValue(raw.name),
    shortLabel: stringValue(raw.shortLabel),
    usedPercent: percentage(raw.usedPercent),
    resetAt: resetValue(raw.resetAt),
    status: enumValue(raw.status, QUOTA_STATES),
    account: stringValue(raw.account),
    observedAt: dateValue(raw.observedAt),
    metrics: metrics ? { burnRatePctPerHour: burnRate } : null,
  };
}

function parseAccountStatus(value: unknown): HudAccountStatus | null {
  const raw = record(value);
  if (!raw) return null;
  return {
    status: enumValue(raw.status, ACCOUNT_STATES),
    notice: stringValue(raw.notice),
    checkedAt: dateValue(raw.checkedAt),
  };
}

function parseProvider(value: unknown): HudProvider | null {
  const raw = record(value);
  if (!raw) return null;
  return {
    id: stringValue(raw.id),
    name: stringValue(raw.name),
    detected: typeof raw.detected === 'boolean' ? raw.detected : null,
    accountStatus: parseAccountStatus(raw.accountStatus),
  };
}

function parseSession(value: unknown): HudSession | null {
  const raw = record(value);
  if (!raw) return null;
  const tokens = finiteNumber(raw.tokens);
  return {
    id: stringValue(raw.id),
    title: stringValue(raw.title),
    source: stringValue(raw.source),
    state: enumValue(raw.state, SESSION_STATES),
    updatedAt: dateValue(raw.updatedAt),
    tokens: tokens !== null && tokens >= 0 ? tokens : null,
  };
}

function parseSnapshot(value: unknown): HudSnapshot | null {
  const raw = record(value);
  if (!raw) return null;
  // A future or malformed explicit schema version is not interpreted as the current schema.
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) return null;
  const quotas = Array.isArray(raw.quotas) ? raw.quotas.map(parseQuota).filter((item): item is HudQuota => item !== null) : [];
  const providers = Array.isArray(raw.providers) ? raw.providers.map(parseProvider).filter((item): item is HudProvider => item !== null) : [];
  const sessions = Array.isArray(raw.sessions) ? raw.sessions.map(parseSession).filter((item): item is HudSession => item !== null) : [];
  return {
    schemaVersion: raw.schemaVersion === 1 ? 1 : null,
    generatedAt: dateValue(raw.generatedAt),
    mode: enumValue(raw.mode, ['live', 'demo'] as const),
    connection: parseConnection(raw.connection),
    indexing: raw.indexing === null || raw.indexing === undefined ? null : parseIndexing(raw.indexing),
    quotas,
    providers,
    sessions,
  };
}

function unreadable(): QuotaHudReading {
  return { state: 'unreadable', heartbeatAgeSeconds: null, snapshot: null, readAt: null };
}

/** Parse the bridge response defensively; malformed or partial data degrades to unknown fields. */
export function parseQuotaHudReading(input: unknown): QuotaHudReading {
  let value: unknown = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return unreadable();
    }
  }
  const raw = record(value);
  if (!raw) return unreadable();
  const state = enumValue(raw.state, QUOTA_HUD_STATES) as QuotaHudState | null;
  const heartbeatAge = finiteNumber(raw.heartbeatAgeSeconds);
  return {
    state: state ?? 'unreadable',
    heartbeatAgeSeconds: heartbeatAge !== null && heartbeatAge >= 0 ? heartbeatAge : null,
    snapshot: raw.snapshot === null || raw.snapshot === undefined ? null : parseSnapshot(raw.snapshot),
    readAt: dateValue(raw.readAt),
  };
}

import type { HudQuota, QuotaHudReading } from './types';

export type ResourceLogin = 'ok' | 'attention' | 'unknown' | 'not-detected';
export type ResourceActivity = 'busy' | 'waiting' | 'idle' | 'unknown';
export type QuotaWindowLevel = 'ok' | 'warn' | 'critical' | 'unknown';
export type QuotaTitleLevel = QuotaWindowLevel;

export interface ResourceQuotaWindow {
  id: string | number | null;
  name: string;
  usedPercent: number | null;
  resetAt: string | null;
  level: QuotaWindowLevel;
  observedAt: string | null;
  /** A fresh number from a trusted live snapshot whose reset time has not passed. Only these may be shown as current. */
  current: boolean;
}

export interface ResourceStatus {
  id: 'claude-code' | 'codex';
  name: string;
  providerId: 'claude' | 'codex';
  login: ResourceLogin;
  loginNotice?: string;
  activity: ResourceActivity;
  quota: {
    source: 'known' | 'unknown';
    windows: ResourceQuotaWindow[];
    stale: boolean;
    /** Known, but at least one window has no current number. */
    partial: boolean;
    observedAt: string | null;
  };
}

const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', providerId: 'claude' },
  { id: 'codex', name: 'Codex CLI', providerId: 'codex' },
] as const;

/**
 * A quota reading counts as current for this long after the HUD observed it. Deliberately short and
 * deliberately the same for every provider: an idle Claude is re-read by the HUD only about every
 * 24 h (and keeps its old observation time), so its quota shows as expired in between. Showing it as
 * current would need the HUD to export what the front end cannot know from the snapshot alone (full
 * per-provider activity coverage, and which windows the last read did not report again); until then
 * "expired / unknown" is the honest answer. Follow-up recorded on Spec #82.
 */
const FRESH_MS = 30 * 60 * 1000;
/**
 * The HUD re-checks an idle account at most every 24 h and rewrites its snapshot only when something
 * changed, so how old the snapshot is says nothing; how old the account check is does. A "ready" older
 * than this (24 h plus margin) is history, not a login we can vouch for.
 */
const LOGIN_CHECK_MAX_AGE_MS = 36 * 60 * 60 * 1000;
/** A time this far ahead of now is a clock fault, not an observation. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Whether the snapshot may be read as current: the HUD is running, and the snapshot is a live
 * (not demo) one of the schema we know, with a usable generation time that is not in the future.
 * Anything else may still be shown for reference, but never as a current login or quota.
 */
function snapshotTrusted(reading: QuotaHudReading, now: number): boolean {
  const snapshot = reading.snapshot;
  if (reading.state !== 'running' || !snapshot) return false;
  if (snapshot.schemaVersion !== 1 || snapshot.mode !== 'live') return false;
  const generatedAt = parseTime(snapshot.generatedAt);
  return generatedAt !== null && generatedAt <= now + FUTURE_TOLERANCE_MS;
}

function quotaLevel(usedPercent: number | null): QuotaWindowLevel {
  if (usedPercent === null) return 'unknown';
  if (usedPercent >= 90) return 'critical';
  if (usedPercent >= 70) return 'warn';
  return 'ok';
}

function loginState(reading: QuotaHudReading, providerId: string, trusted: boolean, now: number): { login: ResourceLogin; notice?: string } {
  const snapshot = reading.snapshot;
  // A stopped HUD or an untrusted snapshot says nothing about who is logged in now.
  if (!snapshot || !trusted) return { login: 'unknown' };
  const provider = snapshot.providers.find((item) => item.id === providerId);
  if (!provider) return { login: 'not-detected' };
  if (provider.detected === false) return { login: 'not-detected' };
  if (provider.detected !== true) return { login: 'unknown' };
  const accountStatus = provider.accountStatus;
  if (accountStatus?.status === 'ready') {
    // "ready" counts only with a believable, recent check time.
    const checkedAt = parseTime(accountStatus.checkedAt);
    const believable = checkedAt !== null && checkedAt <= now + FUTURE_TOLERANCE_MS && now - checkedAt <= LOGIN_CHECK_MAX_AGE_MS;
    return believable ? { login: 'ok' } : { login: 'unknown' };
  }
  const notice = accountStatus?.notice?.trim() || undefined;
  if (accountStatus?.status === 'error') return notice ? { login: 'attention', notice } : { login: 'attention' };
  if (accountStatus?.status === 'unavailable') return notice ? { login: 'unknown', notice } : { login: 'unknown' };
  return notice ? { login: 'unknown', notice } : { login: 'unknown' };
}

function activityState(reading: QuotaHudReading, providerId: string, trusted: boolean): ResourceActivity {
  const snapshot = reading.snapshot;
  if (!trusted || !snapshot) return 'unknown';
  const sessions = snapshot.sessions.filter((session) => session.source === providerId);
  if (sessions.some((session) => session.state === 'running')) return 'busy';
  if (sessions.some((session) => session.state === 'waiting')) return 'waiting';
  return 'idle';
}

function windowIsCurrent(quota: HudQuota, trusted: boolean, now: number): boolean {
  if (!trusted || quota.usedPercent === null || quota.status === 'stale') return false;
  const observedAt = parseTime(quota.observedAt);
  if (observedAt === null || observedAt > now + FUTURE_TOLERANCE_MS || observedAt < now - FRESH_MS) return false;
  // A window that has reset since it was read no longer describes the current window.
  if (quota.resetAt === null) return true;
  const resetAt = parseTime(quota.resetAt);
  return resetAt !== null && resetAt > now;
}

function quotaState(reading: QuotaHudReading, providerId: string, trusted: boolean, now: number): ResourceStatus['quota'] {
  const snapshot = reading.snapshot;
  const windows: ResourceQuotaWindow[] = (snapshot?.quotas ?? [])
    .filter((quota) => quota.vendor === providerId)
    .map((quota) => {
      const current = windowIsCurrent(quota, trusted, now);
      return {
        id: quota.id,
        name: quota.name ?? quota.shortLabel ?? '',
        usedPercent: quota.usedPercent,
        resetAt: quota.resetAt,
        level: current ? quotaLevel(quota.usedPercent) : 'unknown',
        observedAt: quota.observedAt,
        current,
      };
    });
  const observationTimes = windows
    .map((window) => window.observedAt)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const observedAt = observationTimes[0] ?? null;
  // A number that cannot be shown as current (old, reset, untrusted snapshot, stopped HUD) is stale.
  const stale = windows.some((window) => window.usedPercent !== null && !window.current);
  const source = windows.some((window) => window.current) ? 'known' : 'unknown';
  const partial = source === 'known' && windows.some((window) => !window.current);
  return { source, windows, stale, partial, observedAt };
}

/** Derive only the two local agents represented by the HUD; web chats remain unknown elsewhere. */
export function deriveResources(reading: QuotaHudReading, now: number): ResourceStatus[] {
  const trusted = snapshotTrusted(reading, now);
  return AGENTS.map((agent) => {
    const login = loginState(reading, agent.providerId, trusted, now);
    return {
      id: agent.id,
      name: agent.name,
      providerId: agent.providerId,
      login: login.login,
      ...(login.notice ? { loginNotice: login.notice } : {}),
      activity: activityState(reading, agent.providerId, trusted),
      quota: quotaState(reading, agent.providerId, trusted, now),
    };
  });
}

/**
 * The title bar reports the highest current numeric usage. When any local window has no current
 * number (unknown, expired, reset) the dot is never green: "55% and the weekly limit unknown" is
 * not "all fine". A high number still shows its warning colour, because that is true either way.
 */
export function quotaTitleView(resources: readonly ResourceStatus[]): { level: QuotaTitleLevel; usedPercent: number | null; partial: boolean } {
  const values: number[] = [];
  let partial = false;
  for (const resource of resources) {
    for (const window of resource.quota.windows) {
      if (window.current && window.usedPercent !== null) values.push(window.usedPercent);
      else partial = true;
    }
  }
  if (values.length === 0) return { level: 'unknown', usedPercent: null, partial: false };
  const usedPercent = Math.max(...values);
  const level = quotaLevel(usedPercent);
  return { level: partial && level === 'ok' ? 'unknown' : level, usedPercent, partial };
}

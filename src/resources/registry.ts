import type { QuotaHudReading } from './types';

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
    observedAt: string | null;
  };
}

const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', providerId: 'claude' },
  { id: 'codex', name: 'Codex CLI', providerId: 'codex' },
] as const;

function quotaLevel(usedPercent: number | null): QuotaWindowLevel {
  if (usedPercent === null) return 'unknown';
  if (usedPercent >= 90) return 'critical';
  if (usedPercent >= 70) return 'warn';
  return 'ok';
}

function loginState(reading: QuotaHudReading, providerId: string): { login: ResourceLogin; notice?: string } {
  const snapshot = reading.snapshot;
  if (!snapshot) return { login: 'unknown' };
  const provider = snapshot.providers.find((item) => item.id === providerId);
  if (!provider) return { login: 'not-detected' };
  if (provider.detected === false) return { login: 'not-detected' };
  if (provider.detected !== true) return { login: 'unknown' };
  const accountStatus = provider.accountStatus;
  if (accountStatus?.status === 'ready') return { login: 'ok' };
  const notice = accountStatus?.notice?.trim() || undefined;
  if (accountStatus?.status === 'error') return notice ? { login: 'attention', notice } : { login: 'attention' };
  if (accountStatus?.status === 'unavailable') return notice ? { login: 'unknown', notice } : { login: 'unknown' };
  return notice ? { login: 'unknown', notice } : { login: 'unknown' };
}

function activityState(reading: QuotaHudReading, providerId: string): ResourceActivity {
  const snapshot = reading.snapshot;
  if (reading.state !== 'running' || !snapshot) return 'unknown';
  const sessions = snapshot.sessions.filter((session) => session.source === providerId);
  if (sessions.some((session) => session.state === 'running')) return 'busy';
  if (sessions.some((session) => session.state === 'waiting')) return 'waiting';
  return 'idle';
}

function quotaState(reading: QuotaHudReading, providerId: string, now: number): ResourceStatus['quota'] {
  const snapshot = reading.snapshot;
  const windows = (snapshot?.quotas ?? [])
    .filter((quota) => quota.vendor === providerId)
    .map((quota) => ({
      id: quota.id,
      name: quota.name ?? quota.shortLabel ?? '',
      usedPercent: quota.usedPercent,
      resetAt: quota.resetAt,
      level: quotaLevel(quota.usedPercent),
      observedAt: quota.observedAt,
    }));
  const observationTimes = windows
    .map((window) => window.observedAt)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const observedAt = observationTimes[0] ?? null;
  const staleBySignal = (snapshot?.quotas ?? []).some((quota) => quota.vendor === providerId && (
    quota.status === 'stale' || (quota.observedAt !== null && Date.parse(quota.observedAt) < now - 30 * 60 * 1000)
  ));
  const stale = staleBySignal || reading.state === 'stopped' || reading.state === 'unreadable';
  const hasUnverifiableAge = windows.some((window) => window.observedAt === null);
  const hasKnownUsage = windows.some((window) => window.usedPercent !== null);
  const source = reading.state === 'running' && windows.length > 0 && hasKnownUsage && !stale && !hasUnverifiableAge ? 'known' : 'unknown';
  return { source, windows, stale, observedAt };
}

/** Derive only the two local agents represented by the HUD; web chats remain unknown elsewhere. */
export function deriveResources(reading: QuotaHudReading, now: number): ResourceStatus[] {
  return AGENTS.map((agent) => {
    const login = loginState(reading, agent.providerId);
    return {
      id: agent.id,
      name: agent.name,
      providerId: agent.providerId,
      login: login.login,
      ...(login.notice ? { loginNotice: login.notice } : {}),
      activity: activityState(reading, agent.providerId),
      quota: quotaState(reading, agent.providerId, now),
    };
  });
}

/** The title bar reports only the highest fresh, numeric usage; stale values never affect its colour. */
export function quotaTitleView(resources: readonly ResourceStatus[]): { level: QuotaTitleLevel; usedPercent: number | null } {
  const values: number[] = [];
  for (const resource of resources) {
    if (resource.quota.source !== 'known' || resource.quota.stale) continue;
    for (const window of resource.quota.windows) {
      if (window.usedPercent !== null) values.push(window.usedPercent);
    }
  }
  if (values.length === 0) return { level: 'unknown', usedPercent: null };
  const usedPercent = Math.max(...values);
  return { level: quotaLevel(usedPercent), usedPercent };
}

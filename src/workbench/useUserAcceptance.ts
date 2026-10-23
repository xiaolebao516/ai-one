import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { host } from '../host';
import type { WorkbenchSource } from './workbenchModel';
import {
  loadAcceptanceIssues, readAcceptanceRecords, saveAcceptanceRecords, sendAcceptanceComment,
  type AcceptanceItem, type AcceptanceRead, type AcceptanceReader, type AcceptanceRecord,
  type AcceptanceRecords, type AcceptanceStorage, type AcceptanceWriter,
} from './userAcceptance';

export type AcceptanceLoader = (repos: readonly string[], reader: AcceptanceReader) => Promise<AcceptanceRead>;
export interface AcceptanceState {
  items: AcceptanceItem[];
  records: AcceptanceRecords;
  loading: boolean;
  partial: boolean;
  errors: string[];
  storageError: boolean;
  storageErrorPhase?: 'before-write' | 'after-write';
  submit: (item: AcceptanceItem, kind: 'approved' | 'feedback', feedback?: string) => Promise<void>;
}
function browserStorage(): AcceptanceStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}
/** Decisions are durably checkpointed before network I/O; no auto replay after unknown writes. */
export function useUserAcceptance(
  source: WorkbenchSource, repos: readonly string[], refreshKey: unknown,
  loader: AcceptanceLoader = loadAcceptanceIssues, writer: AcceptanceWriter = host.githubWrite,
  reader: AcceptanceReader = host.github,
): AcceptanceState {
  const [initial] = useState(() => {
    try {
      const storage = browserStorage();
      if (!storage) throw new Error('storage unavailable');
      return { records: readAcceptanceRecords(storage), storageError: false };
    } catch { return { records: {} as AcceptanceRecords, storageError: true }; }
  });
  const [records, setRecords] = useState<AcceptanceRecords>(initial.records);
  const recordsRef = useRef(records);
  const [storageError, setStorageError] = useState(initial.storageError);
  const [storageErrorPhase, setStorageErrorPhase] = useState<'before-write' | 'after-write'>('before-write');
  const [read, setRead] = useState<AcceptanceRead>({ items: [], errors: [], partial: false });
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    reposKey: string; refreshKey: unknown; loader: AcceptanceLoader; reader: AcceptanceReader; generation: number;
  }>();
  const inflight = useRef(new Set<string>());
  const requestRef = useRef(0);
  const currentItem = useRef<(item: AcceptanceItem) => AcceptanceItem | undefined>(() => undefined);
  const reposKey = repos.join('\n');
  const currentRead = source === 'github' && snapshot?.reposKey === reposKey
    && snapshot.refreshKey === refreshKey && snapshot.loader === loader && snapshot.reader === reader
    && snapshot.generation === requestRef.current;
  // Old event callbacks and delayed auth checks must use the latest committed source and read.
  useLayoutEffect(() => {
    currentItem.current = (item) => currentRead && snapshot.generation === requestRef.current && !storageError && !loading
      && repos.some((repo) => repo.toLowerCase() === item.repo.toLowerCase())
      ? read.items.find((candidate) => candidate.key === item.key && candidate.repo === item.repo && candidate.issue === item.issue)
      : undefined;
    return () => { currentItem.current = () => undefined; };
  });
  useEffect(() => {
    if (source !== 'github') return;
    const request = ++requestRef.current;
    setLoading(true);
    void loader(reposKey.split('\n').filter(Boolean), reader).catch(() => ({
      items: [], errors: ['GitHub acceptance read failed'], partial: true,
    })).then((value) => {
      if (request === requestRef.current) {
        setRead(value);
        setSnapshot({ reposKey, refreshKey, loader, reader, generation: request });
        setLoading(false);
      }
    });
    return () => { requestRef.current += 1; };
  }, [source, reposKey, refreshKey, loader, reader]);

  const persist = (next: AcceptanceRecords, phase: 'before-write' | 'after-write'): boolean => {
    try {
      const storage = browserStorage();
      if (!storage) throw new Error('storage unavailable');
      saveAcceptanceRecords(storage, next);
      recordsRef.current = next;
      setRecords(next);
      setStorageError(false);
      return true;
    } catch {
      // Keep the known remote result in memory, while the durable pending checkpoint blocks replay.
      if (phase === 'after-write') { recordsRef.current = next; setRecords(next); }
      setStorageError(true);
      setStorageErrorPhase(phase);
      return false;
    }
  };
  const submit: AcceptanceState['submit'] = async (item, kind, feedback = '') => {
    const canonical = currentItem.current(item);
    if (!canonical || inflight.current.has(item.key)
      || recordsRef.current[item.key] || (kind === 'feedback' && !feedback.trim())) return;
    const generation = requestRef.current;
    const record: AcceptanceRecord = { key: canonical.key, repo: canonical.repo, issue: canonical.issue,
      title: canonical.title, kind, sync: 'pending', ...(kind === 'feedback' ? { feedback: feedback.trim() } : {}) };
    if (!persist({ ...recordsRef.current, [item.key]: record }, 'before-write')) return;
    inflight.current.add(item.key);
    try {
      const result = await sendAcceptanceComment(writer, canonical, kind, feedback,
        () => generation === requestRef.current && Boolean(currentItem.current(canonical)));
      persist({ ...recordsRef.current, [item.key]: { ...record, sync: result } }, 'after-write');
    } finally { inflight.current.delete(item.key); }
  };
  const current = currentRead && !loading ? read : { items: [], errors: [], partial: false };
  const currentRepos = new Set(source === 'github' ? repos.map((repo) => repo.toLowerCase()) : []);
  const currentRecords = Object.fromEntries(Object.entries(records).filter(([, record]) => currentRepos.has(record.repo.toLowerCase())));
  return { items: current.items, records: currentRecords, loading: source === 'github' && (loading || !currentRead),
    partial: current.partial, errors: current.errors, storageError, storageErrorPhase, submit };
}

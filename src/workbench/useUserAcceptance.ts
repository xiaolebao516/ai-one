import { useEffect, useRef, useState } from 'react';
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
  const [read, setRead] = useState<AcceptanceRead>({ items: [], errors: [], partial: false });
  const [loading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const inflight = useRef(new Set<string>());
  const requestRef = useRef(0);
  const reposKey = repos.join('\n');
  useEffect(() => {
    if (source !== 'github') return;
    const request = ++requestRef.current;
    setLoading(true);
    void loader(reposKey.split('\n').filter(Boolean), reader).catch(() => ({
      items: [], errors: ['GitHub acceptance read failed'], partial: true,
    })).then((value) => {
      if (request === requestRef.current) {
        setRead(value);
        setLoadedKey(reposKey);
        setLoading(false);
      }
    });
    return () => { requestRef.current += 1; };
  }, [source, reposKey, refreshKey, loader, reader]);

  const persist = (next: AcceptanceRecords): boolean => {
    try {
      const storage = browserStorage();
      if (!storage) throw new Error('storage unavailable');
      saveAcceptanceRecords(storage, next);
      recordsRef.current = next;
      setRecords(next);
      setStorageError(false);
      return true;
    } catch {
      setStorageError(true);
      return false;
    }
  };
  const submit: AcceptanceState['submit'] = async (item, kind, feedback = '') => {
    if (source !== 'github' || storageError || inflight.current.has(item.key)
      || recordsRef.current[item.key] || (kind === 'feedback' && !feedback.trim())) return;
    const record: AcceptanceRecord = { key: item.key, repo: item.repo, issue: item.issue,
      title: item.title, kind, sync: 'pending', ...(kind === 'feedback' ? { feedback: feedback.trim() } : {}) };
    if (!persist({ ...recordsRef.current, [item.key]: record })) return;
    inflight.current.add(item.key);
    try {
      const result = await sendAcceptanceComment(writer, item, kind, feedback);
      persist({ ...recordsRef.current, [item.key]: { ...record, sync: result } });
    } finally { inflight.current.delete(item.key); }
  };
  const current = source === 'github' && loadedKey === reposKey && !loading ? read : { items: [], errors: [], partial: false };
  return { items: current.items, records, loading: source === 'github' && (loading || loadedKey !== reposKey),
    partial: current.partial, errors: current.errors, storageError, submit };
}

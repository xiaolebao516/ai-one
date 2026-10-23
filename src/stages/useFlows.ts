import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocalStoreFs, type LocalStoreFs } from '../host/localStore';
import {
  FLOWS_SCHEMA_VERSION,
  builtinFlows,
  builtinStages,
  type FlowsFile,
  type ValidationIssue,
} from './flowModel';
import { loadFlows, saveFlows, type FlowStoreStatus } from './flowStore';

export type FlowsLoadStatus = FlowStoreStatus | 'loading' | 'error';

export interface UseFlowsResult {
  file: FlowsFile | null;
  status: FlowsLoadStatus;
  backup?: string;
  loadError?: string;
  operationError?: string;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  issues: ValidationIssue[];
  updateFile: (update: (current: FlowsFile) => FlowsFile) => void;
  save: (candidate?: FlowsFile) => Promise<boolean>;
  reload: () => Promise<void>;
  clearIssues: () => void;
}

function builtInFallback(): FlowsFile {
  return {
    schemaVersion: FLOWS_SCHEMA_VERSION,
    stages: builtinStages(),
    flows: builtinFlows(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Local-only persistence for the flow editor. Tests inject a LocalStoreFs implementation. */
export function useFlows(fs?: LocalStoreFs): UseFlowsResult {
  const fsRef = useRef<LocalStoreFs>(fs ?? getLocalStoreFs());
  const fileRef = useRef<FlowsFile | null>(null);
  const loadRun = useRef(0);
  const [file, setFileState] = useState<FlowsFile | null>(null);
  const [savedJson, setSavedJson] = useState<string | undefined>();
  const [status, setStatus] = useState<FlowsLoadStatus>('loading');
  const [backup, setBackup] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [operationError, setOperationError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  const setFile = useCallback((next: FlowsFile | null) => {
    fileRef.current = next;
    setFileState(next);
  }, []);

  const reload = useCallback(async () => {
    const run = ++loadRun.current;
    setStatus('loading');
    setLoadError(undefined);
    setOperationError(undefined);
    setIssues([]);
    try {
      const result = await loadFlows(fsRef.current);
      if (run !== loadRun.current) return;
      setFile(result.file);
      setSavedJson(JSON.stringify(result.file));
      setStatus(result.status);
      setBackup(result.backup);
    } catch (error) {
      if (run !== loadRun.current) return;
      setFile(builtInFallback());
      setSavedJson(undefined);
      setStatus('error');
      setBackup(undefined);
      setLoadError(errorMessage(error));
    }
  }, [setFile]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const updateFile = useCallback((update: (current: FlowsFile) => FlowsFile) => {
    const current = fileRef.current;
    if (!current) return;
    setFile(update(current));
    setIssues([]);
    setOperationError(undefined);
  }, [setFile]);

  const save = useCallback(async (candidate?: FlowsFile): Promise<boolean> => {
    const target = candidate ?? fileRef.current;
    if (!target || status === 'loading' || status === 'error') return false;

    setSaving(true);
    setOperationError(undefined);
    if (candidate) setFile(candidate);
    try {
      const found = await saveFlows(fsRef.current, target);
      if (found.length > 0) {
        setIssues(found);
        return false;
      }
      setFile(target);
      setSavedJson(JSON.stringify(target));
      setStatus('ok');
      setIssues([]);
      return true;
    } catch (error) {
      setOperationError(errorMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  }, [setFile, status]);

  const dirty = file !== null && savedJson !== undefined && JSON.stringify(file) !== savedJson;
  return {
    file,
    status,
    ...(backup ? { backup } : {}),
    ...(loadError ? { loadError } : {}),
    ...(operationError ? { operationError } : {}),
    loading: status === 'loading',
    saving,
    dirty,
    issues,
    updateFile,
    save,
    reload,
    clearIssues: () => setIssues([]),
  };
}

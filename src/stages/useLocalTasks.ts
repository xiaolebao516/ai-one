import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocalStoreFs, type LocalStoreFs } from '../host/localStore';
import { emptyLocalTasks, type LocalTask, type LocalTasksFile } from './localTasks';
import { loadLocalTasks, replaceLocalTask, saveLocalTasks } from './localTaskStore';

export interface LocalTasksState {
  tasks: readonly LocalTask[];
  ready: boolean;
  error?: string;
  warning?: string;
  busy: boolean;
  create: (task: LocalTask) => Promise<boolean>;
  update: (id: string, edit: (task: LocalTask) => LocalTask) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

/** Writes are serialized and only visible after durable persistence succeeds. */
export function useLocalTasks(fs?: LocalStoreFs): LocalTasksState {
  const io = useRef(fs ?? getLocalStoreFs());
  const saved = useRef<LocalTasksFile>(emptyLocalTasks());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [tasks, setTasks] = useState<readonly LocalTask[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  useEffect(() => {
    let alive = true;
    void loadLocalTasks(io.current).then((result) => {
      if (!alive) return;
      if (result.status === 'blocked') { setError(result.reason); return; }
      saved.current = result.file;
      setTasks(result.file.tasks);
      setReady(true);
      if (result.status === 'recovered') setWarning('Invalid local tasks were protected in ' + (result.backup ?? 'a backup') + '.');
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const mutate = useCallback((change: (file: LocalTasksFile) => LocalTasksFile): Promise<boolean> => {
    if (!ready) { setError('Local task storage is unavailable or still loading.'); return Promise.resolve(false); }
    setBusy(true);
    const work = queue.current.then(async () => {
      const next = change(saved.current);
      await saveLocalTasks(io.current, next);
      saved.current = next;
      setTasks(next.tasks);
      setError(undefined);
      return true;
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setWarning(e instanceof Error ? e.message : String(e));
      return false;
    });
    queue.current = work;
    void work.finally(() => {
      if (queue.current === work) setBusy(false);
    });
    return work;
  }, [ready]);
  return {
    tasks, ready, busy, ...(error ? { error } : {}), ...(warning ? { warning } : {}),
    create: (task) => mutate((file) => replaceLocalTask(file, task)),
    update: (id, edit) => mutate((file) => {
      const old = file.tasks.find((task) => task.id === id);
      if (!old) throw new Error('Local task not found');
      return replaceLocalTask(file, edit(old));
    }),
    remove: (id) => mutate((file) => ({ ...file, tasks: file.tasks.filter((task) => task.id !== id) })),
  };
}

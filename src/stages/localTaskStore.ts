import type { LocalStoreFs } from '../host/localStore';
import {
  emptyLocalTasks, localTaskBytes, MAX_LOCAL_TASK_BYTES, parseLocalTasksFile,
  validateLocalTask, type LocalTask, type LocalTasksFile,
} from './localTasks';

export type LocalTasksLoad =
  | { status: 'ok' | 'fresh'; file: LocalTasksFile }
  | { status: 'recovered'; file: LocalTasksFile; backup?: string; reason: string }
  | { status: 'blocked'; reason: string };

export async function loadLocalTasks(fs: LocalStoreFs): Promise<LocalTasksLoad> {
  const read = await fs.read('localTasks');
  if (read.status === 'missing') return { status: 'fresh', file: emptyLocalTasks() };
  if (read.status === 'corrupt') {
    return { status: 'recovered', file: emptyLocalTasks(), backup: read.backup ?? undefined, reason: 'invalid-json' };
  }
  if (!read.text) return { status: 'blocked', reason: 'Local task file could not be read; existing data has been preserved.' };
  const result = parseLocalTasksFile(read.text);
  if (result.ok) {
    // Refresh and restart never silently resume a previously active web discussion.
    return { status: 'ok', file: {
      ...result.file,
      tasks: result.file.tasks.map((task) =>
        task.status === 'running' ? { ...task, status: 'interrupted' as const } : task),
    } };
  }
  if (result.reason === 'unknown-schema') {
    return { status: 'blocked', reason: 'Unsupported local task schema. File preserved; update ai-one before editing.' };
  }
  // Do not overwrite a malformed file until its original has been protected.
  const backup = await fs.quarantine('localTasks');
  if (!backup) return { status: 'blocked', reason: 'Could not protect invalid local task file; changes disabled.' };
  return { status: 'recovered', file: emptyLocalTasks(), backup, reason: result.reason };
}
export async function saveLocalTasks(fs: LocalStoreFs, file: LocalTasksFile): Promise<void> {
  if (file.schemaVersion !== 1 || !Array.isArray(file.tasks)) throw new Error('Invalid local task schema');
  const ids = new Set<string>();
  for (const task of file.tasks) {
    if (!validateLocalTask(task) || ids.has(task.id)) throw new Error('Invalid or duplicate local task');
    ids.add(task.id);
    if (localTaskBytes(task) > MAX_LOCAL_TASK_BYTES) {
      throw new Error('Task exceeds 5 MB. Nothing was truncated or saved; start a separate task.');
    }
  }
  await fs.write('localTasks', JSON.stringify(file));
}
export function replaceLocalTask(file: LocalTasksFile, task: LocalTask): LocalTasksFile {
  const idx = file.tasks.findIndex((item) => item.id === task.id);
  return { ...file, tasks: idx >= 0
    ? file.tasks.map((item) => item.id === task.id ? task : item)
    : [...file.tasks, task] };
}

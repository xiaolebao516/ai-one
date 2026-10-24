// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { browserLocalStoreFs } from '../host/localStore';

const key = 'ai-one.local-store.localTasks';
const original = JSON.stringify({ schemaVersion: 1, tasks: [{ id: 'local:delete', text: 'PRIVATE_SENTINEL' }, { id: 'local:keep', text: 'keep me' }] });
const remaining = JSON.stringify({ schemaVersion: 1, tasks: [{ id: 'local:keep', text: 'keep me' }] });
beforeEach(() => window.localStorage.clear());
it('scrubs deleted tasks from recoverable browser backups without removing other tasks', async () => {
  window.localStorage.setItem(key, original);
  await browserLocalStoreFs.quarantine('localTasks');
  await browserLocalStoreFs.write('localTasks', original);
  await browserLocalStoreFs.write('localTasks', remaining);
  for (let i = 0; i < window.localStorage.length; i++) {
    const text = window.localStorage.getItem(window.localStorage.key(i)!)!;
    expect(text).not.toContain('PRIVATE_SENTINEL');
    expect(text).toContain('keep me');
  }
});
it('refuses deletion when a corrupt backup cannot be safely rewritten', async () => {
  window.localStorage.setItem(key, original);
  window.localStorage.setItem(key + '.local-tasks.json.bak-corrupt', '{bad');
  await expect(browserLocalStoreFs.write('localTasks', remaining)).rejects.toThrow();
  expect(window.localStorage.getItem(key)).toBe(original);
  expect(window.localStorage.getItem(key + '.local-tasks.json.bak-corrupt')).toBe('{bad');
});

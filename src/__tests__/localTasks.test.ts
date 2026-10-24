import { describe, expect, it, vi } from 'vitest';
import type { LocalStoreFs, LocalStoreRead } from '../host/localStore';
import {
  discussionIssueBody, discussionState, localTaskBytes, localTaskToHud, MAX_LOCAL_TASK_BYTES,
  newDiscussionTask, parseLocalTasksFile, roundFromSnapshot,
} from '../stages/localTasks';
import { loadLocalTasks, replaceLocalTask, saveLocalTasks } from '../stages/localTaskStore';
import type { ExecutionSnapshot } from '../workflow/snapshot/types';

const now = '2026-10-24T04:00:00.000Z';
const task = () => newDiscussionTask('Evaluate the requirements', now);

function fakeFs(read: LocalStoreRead): LocalStoreFs & { content: string | undefined } {
  const fs = {
    content: undefined as string | undefined,
    read: vi.fn(async () => fs.content === undefined ? read
      : { status: 'ok' as const, text: fs.content, backup: null }),
    write: vi.fn(async (_name, text: string) => { fs.content = text; }),
    quarantine: vi.fn(async () => 'local-tasks.json.bak-20261024'),
    exportFile: vi.fn(async () => null),
  };
  return fs;
}
describe('local discussion tasks (#112)', () => {
  it('creates a local UUID task and preserves all nested round replies in a round trip', async () => {
    const t = task();
    t.rounds[0].steps = [{
      id: 'first', nodeId: 'first', name: 'Independent', speaker: 'chatgpt',
      text: 'unabridged AI reply\nsecond line', status: 'done', startedAt: now,
    }];
    const fs = fakeFs({ status: 'missing', text: null, backup: null });
    await saveLocalTasks(fs, { schemaVersion: 1, tasks: [t] });
    expect(fs.write).toHaveBeenCalledWith('localTasks', expect.any(String));
    const loaded = await loadLocalTasks(fs);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.file.tasks[0].rounds[0].steps[0].text).toBe(t.rounds[0].steps[0].text);
    expect(loaded.file.tasks[0].status).toBe('interrupted');
    expect(localTaskToHud(loaded.file.tasks[0]).dataSource).toBe('local');
    expect(localTaskToHud(t).id).toMatch(/^local:/);
  });

  it('refuses oversized task without truncating or writing', async () => {
    const fs = fakeFs({ status: 'missing', text: null, backup: null });
    const t = task();
    t.rounds[0].steps.push({ id:'first', nodeId:'first', name:'First', speaker:'chatgpt',
      text:'中'.repeat(2_000_000), status:'done', startedAt: now });
    expect(localTaskBytes(t)).toBeGreaterThan(MAX_LOCAL_TASK_BYTES);
    await expect(saveLocalTasks(fs, { schemaVersion: 1, tasks: [t] })).rejects.toThrow('5 MB');
    expect(fs.write).not.toHaveBeenCalled();
  });

  it('preserves unknown schema in place rather than quarantining or replacing it', async () => {
    const fs = fakeFs({ status: 'ok', text: '{"schemaVersion":42,"tasks":[]}', backup: null });
    const loaded = await loadLocalTasks(fs);
    expect(loaded.status).toBe('blocked');
    expect(fs.quarantine).not.toHaveBeenCalled();
    expect(fs.write).not.toHaveBeenCalled();
  });

  it('quarantines malformed task schema before returning an empty local collection', async () => {
    const fs = fakeFs({ status: 'ok', text: '{"schemaVersion":1,"tasks":[{}]}', backup: null });
    const loaded = await loadLocalTasks(fs);
    expect(loaded.status).toBe('recovered');
    expect(fs.quarantine).toHaveBeenCalledWith('localTasks');
    expect(fs.write).not.toHaveBeenCalled();
  });

  it('blocks startup if malformed content cannot be preserved', async () => {
    const fs = fakeFs({ status: 'ok', text: '{"schemaVersion":1,"tasks":[{}]}', backup: null });
    vi.mocked(fs.quarantine).mockResolvedValueOnce(null);
    expect((await loadLocalTasks(fs)).status).toBe('blocked');
  });

  it('rejects duplicate IDs, unrecognized status, bad round and unknown version', () => {
    const t = task();
    expect(parseLocalTasksFile(JSON.stringify({schemaVersion:1,tasks:[t,t]})).ok).toBe(false);
    expect(parseLocalTasksFile(JSON.stringify({schemaVersion:1,tasks:[{...t,status:'magical'}]})).ok).toBe(false);
    expect(parseLocalTasksFile(JSON.stringify({schemaVersion:1,tasks:[{...t,rounds:[{...t.rounds[0],steps:[{text:22}]}]}]})).ok).toBe(false);
    expect(parseLocalTasksFile(JSON.stringify({schemaVersion:2,tasks:[t]})).ok).toBe(false);
  });

  it('keeps last known full reply and derives discussion view state', () => {
    const t = task();
    t.rounds[0].steps = [{
      id:'step1',nodeId:'first',name:'First',speaker:'chatgpt',
      text:'hello!',status:'done',startedAt:now,
    }];
    expect(discussionState(t).outputs).toMatchObject({first:'hello!'});
    const updated = replaceLocalTask({schemaVersion:1,tasks:[t]}, {...t,status:'ended'});
    expect(updated.tasks[0].status).toBe('ended');
    expect(t.status).toBe('running');
  });

  it('converts the completed engine snapshot while keeping the exact full output locally', () => {
    const t = task();
    const snapshot: ExecutionSnapshot = {
      snapshotId:'snapshot-1',graphId:'deliberation',graphVersion:2,appVersion:'x',
      createdAt:now,completedAt:now,adapterVersions:{},
      roleMap:{first:'chatgpt',second:'gemini',auditor:'claude'},redactionTier:'full-local',
      userQuestion:{tier:'full-local',kind:'inline',text:'hi'},humanEdits:[],
      steps:[{nodeId:'first',provider:'chatgpt',status:'done',startedAt:now,completedAt:now,
        inputRef:{tier:'full-local',kind:'inline',text:'prompt'},outputRef:{tier:'full-local',kind:'inline',text:'Entire reply!'}}],
    };
    const round = roundFromSnapshot(t.rounds[0],snapshot);
    expect(round.steps[0].text).toBe('Entire reply!');
    expect(round.participants).toEqual(['chatgpt','gemini','claude']);
  });

  it('Issue template contains a strict CC start gate and excludes original web replies', () => {
    const t = task();
    t.rounds[0].steps.push({ id:'p',nodeId:'first',name:'first',speaker:'chatgpt',
      text:'PRIVATE_RAW_REPLY_TOKEN',status:'done',startedAt:now });
    const body = discussionIssueBody(t);
    expect(body).toContain('## 任务与范围');
    expect(body).toContain('## 开工门槛');
    expect(body).toContain('非目标');
    expect(body).not.toContain('PRIVATE_RAW_REPLY_TOKEN');
  });

  it('does not pretend a failed write persisted', async () => {
    const fs = fakeFs({ status: 'missing', text: null, backup: null });
    vi.mocked(fs.write).mockRejectedValueOnce(new Error('disk full'));
    await expect(saveLocalTasks(fs,{schemaVersion:1,tasks:[task()]})).rejects.toThrow('disk full');
    expect(fs.content).toBeUndefined();
  });
});

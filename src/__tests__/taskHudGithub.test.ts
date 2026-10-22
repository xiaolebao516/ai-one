import { describe, expect, it } from 'vitest';
import type { GitHubSnapshot, SnapshotIssue, SnapshotPullRequest } from '../../scripts/task-status/snapshot.mjs';
import {
  createGitHubClientFrom,
  loadGitHubTasks,
  snapshotToHudTasks,
} from '../ui/taskHudGithub';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const OBSERVED = '2026-10-22T03:00:00.000Z';
const NOW = new Date('2026-10-22T03:15:00.000Z');
const source = { url: 'https://api.github.com/repos/acme/demo/issues', observedAt: OBSERVED };
const graphSource = { url: 'https://api.github.com/graphql', observedAt: OBSERVED, field: 'closingIssuesReferences' };

function issue(number: number, labels: string[] = []): SnapshotIssue {
  return {
    number, title: 'Issue ' + number, state: 'open',
    url: 'https://github.com/acme/demo/issues/' + number,
    labels, source,
    association: { status: 'unlinked', pullRequests: [], scope: 'loaded open PRs only' },
    possibleHumanAcceptance: {
      value: labels.includes('needs-user') || labels.includes('needs-review'),
      kind: 'inference', reason: 'Labels alone do not prove acceptance.', source,
    },
  };
}

function pr(number: number, draft = false, conclusion: SnapshotPullRequest['ci']['conclusion'] = 'success'): SnapshotPullRequest {
  return {
    number, title: 'PR ' + number, state: 'open', draft, headSha: HEAD,
    url: 'https://github.com/acme/demo/pull/' + number, source,
    ci: {
      headSha: HEAD, conclusion, completeness: 'complete',
      checks: conclusion === 'missing' ? [] : [{
        name: 'frontend', headSha: HEAD, status: conclusion === 'pending' ? 'in_progress' : 'completed',
        conclusion, url: 'https://github.com/acme/demo/actions/runs/1',
      }],
      statuses: [], sources: [
        { url: 'https://api.github.com/checks', observedAt: OBSERVED },
        { url: 'https://api.github.com/status', observedAt: OBSERVED },
      ],
    },
    association: { status: 'complete', issues: [], source: graphSource },
    possibleHumanAcceptance: {
      value: !draft && conclusion === 'success', kind: 'inference',
      reason: 'Non-Draft and successful observed CI; not approval.', headSha: HEAD, source,
    },
  };
}

function snapshot(issues: SnapshotIssue[] = [], pullRequests: SnapshotPullRequest[] = []): GitHubSnapshot {
  return {
    schemaVersion: 1, repository: 'acme/demo',
    startedAt: OBSERVED, completedAt: OBSERVED, status: 'complete',
    scope: { page: 1, limit: 10, description: 'One page per list.' },
    issues, pullRequests,
    pagination: {
      issues: { page: 1, limit: 10, returned: issues.length, more: 'no',
        earlierPagesOmitted: false, source },
      pullRequests: { page: 1, limit: 10, returned: pullRequests.length, more: 'no',
        earlierPagesOmitted: false, source },
    },
    errors: [],
    runtime: { agentOnline: 'unknown', quota: 'unknown', iteration: 'unknown', loginState: 'unknown' },
  };
}

function linked(i: SnapshotIssue, ...prs: SnapshotPullRequest[]): SnapshotIssue {
  return {
    ...i,
    association: {
      ...i.association,
      status: 'linked',
      pullRequests: prs.map((p) => ({ number: p.number, headSha: p.headSha, source: graphSource })),
    },
  };
}

describe('Spec #50 v1: Issue/PR association', () => {
  it('links through structured references only, selects largest PR number and records other PR evidence', () => {
    const low = pr(11, true, 'pending');
    const high = pr(42);
    const tasks = snapshotToHudTasks(snapshot([linked(issue(7), low, high)], [low, high]), NOW);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      dataSource: 'github', repo: 'acme/demo', issue: 7, status: 'accept',
      pr: { number: 42, headSha: HEAD, draft: false },
    });
    expect(tasks[0].evidence.some((e) => e.text.en.includes('PR #11') && e.raw?.includes('11'))).toBe(true);
    expect(tasks[0].evidence.some((e) => e.text.zh.includes('编号最大的'))).toBe(true);
  });

  it('does not infer links from PR title/body and keeps unassociated PR as its own task', () => {
    const tasks = snapshotToHudTasks(snapshot([issue(7)], [pr(42)]), NOW);
    expect(tasks.map((t) => t.id)).toEqual(['acme/demo:issue:7', 'acme/demo:pr:42']);
    expect(tasks[0]).toMatchObject({ issue: 7, status: 'unknown' });
    expect(tasks[0].gap?.zh).toContain('无法反映其进度');
    expect(tasks[1].issue).toBeUndefined();
    expect(tasks[1].pr?.number).toBe(42);
  });

  it('leaves links unknown when the association was not verified', () => {
    const uncertain = { ...issue(2), association: { ...issue(2).association, status: 'unknown' as const } };
    const tasks = snapshotToHudTasks(snapshot([uncertain], [pr(17)]), NOW);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe('unknown');
    expect(tasks[0].gap?.en).toContain('association could not be fully verified');
  });
});

describe('Spec #50 v1: first-matching status rule', () => {
  it('blocked wins over needs-user, and needs-user wins over acceptance', () => {
    const ready = pr(10);
    const blocked = snapshotToHudTasks(snapshot([linked(issue(1, ['blocked', 'needs-user']), ready)], [ready]), NOW)[0];
    expect(blocked.status).toBe('blocked');
    const decide = snapshotToHudTasks(snapshot([linked(issue(2, ['needs-user', 'needs-review']), ready)], [ready]), NOW)[0];
    expect(decide.status).toBe('decide');
  });

  it('inferred accept outranks needs-review, non-Draft means review, Draft means running, no PR means unknown', () => {
    const accepted = pr(10);
    const notReady = pr(11, false, 'failure');
    const draft = pr(12, true, 'pending');
    expect(snapshotToHudTasks(snapshot([linked(issue(1, ['needs-review']), accepted)], [accepted]), NOW)[0].status).toBe('accept');
    expect(snapshotToHudTasks(snapshot([linked(issue(1, ['needs-review']), draft)], [draft]), NOW)[0].status).toBe('review');
    expect(snapshotToHudTasks(snapshot([linked(issue(1), notReady)], [notReady]), NOW)[0].status).toBe('review');
    expect(snapshotToHudTasks(snapshot([linked(issue(1), draft)], [draft]), NOW)[0].status).toBe('running');
    expect(snapshotToHudTasks(snapshot([issue(1)]), NOW)[0].status).toBe('unknown');
    expect(snapshotToHudTasks(snapshot([issue(1, ['needs-review'])]), NOW)[0].status).toBe('review');
  });
});

describe('Spec #50 v1: CI is SHA-bound, not a review', () => {
  it.each([
    ['success', 'success'],
    ['failure', 'failure'],
    ['pending', 'running'],
    ['missing', 'unknown'],
    ['unknown', 'unknown'],
    ['no_success', 'unknown'],
  ] as const)('%s conclusion maps to %s', (conclusion, expected) => {
    const tasks = snapshotToHudTasks(snapshot([], [pr(40, true, conclusion)]), NOW);
    expect(tasks[0].ci).toMatchObject({ state: expected, headSha: HEAD });
    expect(tasks[0].review).toBeUndefined();
  });

  it('does not silently complete partial CI evidence or borrow a different HEAD', () => {
    const partial = pr(40, false, 'unknown');
    partial.ci.completeness = 'partial';
    partial.ci.headSha = OTHER;
    const item = snapshotToHudTasks(snapshot([], [partial]), NOW)[0];
    expect(item.pr?.headSha).toBe(HEAD);
    expect(item.ci?.headSha).toBe(OTHER);
    expect(item.ci?.state).toBe('unknown');
    expect(item.ci?.detail?.en).toContain('evidence partial');
    expect(item.evidence.some((e) => e.kind === 'readback' && e.text.en.includes('completeness partial'))).toBe(true);
  });

  it('preserves known failure and explicitly flags partial evidence', () => {
    const partial = pr(41, false, 'failure');
    partial.ci.completeness = 'partial';
    const item = snapshotToHudTasks(snapshot([], [partial]), NOW)[0];
    expect(item.ci?.state).toBe('failure');
    expect(item.ci?.detail?.zh).toContain('证据不完整');
  });

  it('uses readback URLs and timestamps, but marks acceptance as unverified inference', () => {
    const item = snapshotToHudTasks(snapshot([], [pr(40)]), NOW)[0];
    expect(item.status).toBe('accept');
    expect(item.statusNote?.zh).toContain('推断');
    expect(item.evidence.filter((e) => e.kind === 'unverified')).toHaveLength(1);
    expect(item.evidence.filter((e) => e.kind === 'readback').length).toBeGreaterThan(1);
    expect(item.evidence.find((e) => e.kind === 'readback')?.raw).toContain('https://api.github.com');
    expect(item.evidence.find((e) => e.kind === 'readback')?.observedMinutesAgo).toBe(15);
    expect(item.review).toBeUndefined();
    expect(item.stages).toEqual([]);
  });
});

describe('Spec #50 v1: snapshot quality and repository isolation', () => {
  it('keeps partial/error status, errors and possible-more pagination without inventing tasks', async () => {
    const data = snapshot([issue(9)]);
    data.status = 'partial';
    data.errors.push({ ...source, message: 'Query failed' });
    data.pagination.issues = { page: 1, limit: 1, returned: 1, more: 'possible',
      earlierPagesOmitted: false, source };
    const task = snapshotToHudTasks(data, NOW)[0];
    expect(task.gap?.en).toContain('more items may exist');
    expect(task.gap?.zh).toContain('快照状态：partial');

    const failed = snapshot();
    failed.status = 'error';
    expect(snapshotToHudTasks(failed, NOW)).toEqual([]);

    const calls: string[] = [];
    const api = {
      async get(path: string): Promise<unknown> {
        calls.push(path);
        if (path.includes('repos/bad/repo/')) throw new Error('GitHub query failed; check gh auth status, repository access, network and API rate limits.');
        return [];
      },
      async associations(): Promise<unknown> { return { data: { repository: {} } }; },
    };
    const loaded = await loadGitHubTasks(['bad/repo', 'acme/demo'], api, { now: NOW, limit: 2 });
    expect(loaded.map((result) => result.status)).toEqual(['error', 'complete']);
    expect(loaded[0].errors).toHaveLength(2);
    expect(loaded[0].tasks).toEqual([]);
    expect(loaded[1]).toMatchObject({
      repo: 'acme/demo', tasks: [], status: 'complete',
      observedAt: expect.any(String),
      pagination: { issues: { more: 'no' }, pullRequests: { more: 'no' } },
    });
    expect(calls.some((path) => path.includes('per_page=2'))).toBe(true);
  });

  it('catches invalid repo options without affecting the next repository', async () => {
    const api = {
      async get(): Promise<unknown> { return []; },
      async associations(): Promise<unknown> { return {}; },
    };
    const loaded = await loadGitHubTasks(['not-a-repo', 'acme/demo'], api, { now: NOW });
    expect(loaded[0]).toMatchObject({ status: 'error', tasks: [] });
    expect(loaded[0].errors[0].message).toContain('--repo');
    expect(loaded[1].status).toBe('complete');
  });

  it('adapts the fixed get/associations contract without transforming arguments', async () => {
    const log: unknown[][] = [];
    const api = {
      async get(path: string): Promise<unknown> { log.push(['get', path]); return { ok: true }; },
      async associations(repo: string, numbers: number[]): Promise<unknown> {
        log.push(['associations', repo, numbers]);
        return { ok: true };
      },
    };
    const client = createGitHubClientFrom(api);
    await client.get('repos/acme/demo/issues?page=1');
    await client.associations('acme/demo', [7, 8]);
    expect(log).toEqual([
      ['get', 'repos/acme/demo/issues?page=1'],
      ['associations', 'acme/demo', [7, 8]],
    ]);
  });
});

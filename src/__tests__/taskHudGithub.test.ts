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

  it('keeps multi-check CI evidence separate from commit statuses and preserves source metadata', () => {
    const record = pr(54, false, 'success');
    record.ci.checks.push(
      { name: 'lint', headSha: HEAD, status: 'completed', conclusion: 'success', url: 'https://github.com/acme/demo/actions/runs/2' },
      { name: 'tests', headSha: HEAD, status: 'completed', conclusion: 'success', url: 'https://github.com/acme/demo/actions/runs/3' },
    );
    record.ci.statuses.push(
      { context: 'build', state: 'success', url: 'https://ci.example.test/build' },
      { context: 'security', state: 'success', url: 'https://ci.example.test/security' },
    );

    const task = snapshotToHudTasks(snapshot([], [record]), NOW)[0];
    const ciEvidence = task.evidence.filter((entry) => entry.id.startsWith('acme/demo:pr:54:ci:'));
    expect(ciEvidence).toHaveLength(2);
    const checkRaw = JSON.parse(ciEvidence[0].raw ?? '{}') as {
      source: typeof source; data: Record<string, unknown>;
    };
    const statusRaw = JSON.parse(ciEvidence[1].raw ?? '{}') as {
      source: typeof source; data: Record<string, unknown>;
    };
    expect(ciEvidence.every((entry) => entry.kind === 'readback')).toBe(true);
    expect(checkRaw.source).toEqual(record.ci.sources[0]);
    expect(statusRaw.source).toEqual(record.ci.sources[1]);
    expect(checkRaw.data).toEqual({
      headSha: HEAD, conclusion: 'success', completeness: 'complete', checks: record.ci.checks,
    });
    expect(statusRaw.data).toEqual({
      headSha: HEAD, conclusion: 'success', completeness: 'complete', statuses: record.ci.statuses,
    });
    expect(checkRaw.data).not.toHaveProperty('statuses');
    expect(statusRaw.data).not.toHaveProperty('checks');
    expect(ciEvidence.every((entry) => entry.observedMinutesAgo === 15)).toBe(true);
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
    expect(task.gap?.en).toContain('without a linked open PR');
    expect(task.gap?.en).not.toContain('more items may exist');
    expect(task.gap?.zh).not.toContain('快照状态');

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
      async associations(): Promise<unknown> {
        return {
          data: {
            repository: {
              p42: { headRefOid: 'a'.repeat(40), closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: false } } },
            },
          },
        };
      },
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

  it('keeps partial / more-possible warnings at repo level for multiple tasks, not in each task gap', async () => {
    const api = {
      async get(path: string): Promise<unknown> {
        if (path.includes('/issues?')) return [
          { number: 9, title: 'Issue 9', state: 'open' },
          { number: 10, title: 'Issue 10', state: 'open' },
        ];
        if (path.includes('/pulls?')) throw new Error('GitHub query failed; check gh auth status, repository access, network and API rate limits.');
        if (path.includes('/comments')) return [];
        throw new Error('Unexpected query');
      },
      async associations(): Promise<unknown> {
        return {
          data: {
            repository: {
              p42: {
                headRefOid: 'a'.repeat(40),
                closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: false } },
              },
            },
          },
        };
      },
    };
    const [repo] = await loadGitHubTasks(['acme/demo'], api, { now: NOW, limit: 2 });
    expect(repo.status).toBe('partial');
    expect(repo.errors).toHaveLength(1);
    expect(repo.errors[0].message).toContain('GitHub query failed');
    expect(repo.pagination).toMatchObject({
      issues: { more: 'possible', returned: 2 },
      pullRequests: { more: 'unknown', returned: null },
    });
    expect(repo.tasks).toHaveLength(2);
    for (const task of repo.tasks) {
      expect(task.gap?.en).toContain('without a linked open PR');
      expect(task.gap?.en).toContain('association could not be fully verified');
      expect(task.gap?.en).not.toMatch(/Snapshot status|pagination|more items/);
      expect(task.gap?.zh).not.toMatch(/快照状态|快照分页|可能还有更多/);
    }

    // A partial repository snapshot must not add a gap to a PR with verified associations.
    const completePr = pr(20);
    const mixed = snapshot([issue(11)], [completePr]);
    mixed.status = 'partial';
    mixed.pagination.issues = { page: 1, limit: 10, returned: 1, more: 'possible',
      earlierPagesOmitted: false, source };
    const tasks = snapshotToHudTasks(mixed, NOW);
    expect(tasks[0].gap?.en).toContain('without a linked open PR');
    expect(tasks[1].gap).toBeUndefined();
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
  it('reads comments across multiple pages up to limit and maps numeric IDs and timestamps', async () => {
    const TEST_NOW = new Date('2026-10-23T08:15:00.000Z');
    const page1Comments = Array.from({ length: 100 }, (_, idx) => ({
      id: idx + 1,
      user: { login: 'user1' },
      body: `comment ${idx + 1}`,
      created_at: '2026-10-23T07:15:00.000Z',
    }));
    const page2Comments = [
      {
        id: 101,
        user: { login: 'user2' },
        body: '用户已暂停',
        created_at: '2026-10-23T08:00:00.000Z',
      },
    ];

    const api = {
      async get(path: string): Promise<unknown> {
        if (path.includes('/issues?')) return [
          { number: 10, title: 'Issue 10', state: 'open' },
        ];
        if (path.includes('/pulls?')) return [];
        if (path.includes('/issues/10/comments?per_page=100&page=1')) return page1Comments;
        if (path.includes('/issues/10/comments?per_page=100&page=2')) return page2Comments;
        return [];
      },
      async associations(): Promise<unknown> { return { data: { repository: {} } }; },
    };

    const [repo] = await loadGitHubTasks(['acme/demo'], api, { now: TEST_NOW, limit: 10 });
    expect(repo.status).toBe('complete');
    expect(repo.tasks).toHaveLength(1);
    const task = repo.tasks[0];
    const commentEv = task.evidence.filter((e) => e.text.en.includes('Issue Comment'));
    expect(commentEv).toHaveLength(101);
    expect(typeof commentEv[100].id).toBe('string');
    expect(commentEv[100].id).toBe('101');
    expect(commentEv[100].observedMinutesAgo).toBe(15);
    expect(commentEv[0].observedMinutesAgo).toBe(60);
  });

  it('marks snapshot partial when comments fetch fails with a real error', async () => {
    const api = {
      async get(path: string): Promise<unknown> {
        if (path.includes('/issues?')) return [
          { number: 10, title: 'Issue 10', state: 'open' },
        ];
        if (path.includes('/pulls?')) return [];
        if (path.includes('/issues/10/comments')) throw new Error('API Rate Limit Exceeded');
        return [];
      },
      async associations(): Promise<unknown> { return { data: { repository: {} } }; },
    };

    const [repo] = await loadGitHubTasks(['acme/demo'], api, { now: NOW, limit: 10 });
    expect(repo.status).toBe('partial');
    expect(repo.errors.some((e) => e.message.includes('API Rate Limit'))).toBe(true);
  });

  it('pages PR reviews, normalizes numeric IDs to string, and calculates exact age in minutes', async () => {
    const TEST_NOW = new Date('2026-10-23T08:15:00.000Z');
    const page1Reviews = Array.from({ length: 100 }, (_, idx) => ({
      id: idx + 1,
      user: { login: 'rev1' },
      body: `review ${idx + 1}`,
      state: 'commented',
      submitted_at: '2026-10-23T07:15:00.000Z',
    }));
    const page2Reviews = [
      {
        id: 101,
        user: { login: 'rev2' },
        body: '**裁定：REVISE**',
        state: 'commented',
        submitted_at: '2026-10-23T07:45:00.000Z',
      },
    ];

    const api = {
      async get(path: string): Promise<unknown> {
        if (path.includes('/issues?')) return [];
        if (path.includes('/pulls?')) return [
          { number: 42, title: 'PR 42', state: 'open', draft: false, head: { sha: 'a'.repeat(40) } },
        ];
        const headSha = 'a'.repeat(40);
        if (path.includes('/check-runs?')) return { total_count: 0, check_runs: [] };
        if (path.includes('/status?')) return { sha: headSha, total_count: 0, statuses: [] };
        if (path.includes('/pulls/42/reviews?per_page=100&page=1')) return page1Reviews;
        if (path.includes('/pulls/42/reviews?per_page=100&page=2')) return page2Reviews;
        return [];
      },
      async associations(): Promise<unknown> {
        return {
          data: {
            repository: {
              p42: {
                headRefOid: 'a'.repeat(40),
                closingIssuesReferences: { nodes: [], pageInfo: { hasNextPage: false } },
              },
            },
          },
        };
      },
    };

    const [repo] = await loadGitHubTasks(['acme/demo'], api, { now: TEST_NOW, limit: 10 });
    expect(repo.status).toBe('complete');
    expect(repo.tasks).toHaveLength(1);
    const task = repo.tasks[0];
    const reviewEv = task.evidence.filter((e) => e.text.en.includes('Review Comment'));
    expect(reviewEv).toHaveLength(101);
    expect(typeof reviewEv[100].id).toBe('string');
    expect(reviewEv[100].id).toBe('101');
    expect(reviewEv[100].observedMinutesAgo).toBe(30);
    expect(reviewEv[0].observedMinutesAgo).toBe(60);
    expect(task.review?.verdict).toBe('revise');
  });

  it('marks snapshot partial when PR reviews fetch fails or returns non-array', async () => {
    const failApi = {
      async get(path: string): Promise<unknown> {
        if (path.includes('/issues?')) return [];
        if (path.includes('/pulls?')) return [
          { number: 42, title: 'PR 42', state: 'open', draft: false, head: { sha: 'a'.repeat(40) } },
        ];
        if (path.includes('/check-runs?') || path.includes('/status?')) return { total_count: 0, check_runs: [], statuses: [] };
        if (path.includes('/pulls/42/reviews')) throw new Error('Reviews endpoint network timeout');
        return [];
      },
      async associations(): Promise<unknown> { return { data: { repository: {} } }; },
    };

    const [failRepo] = await loadGitHubTasks(['acme/demo'], failApi, { now: NOW, limit: 10 });
    expect(failRepo.status).toBe('partial');
    expect(failRepo.errors.some((e) => e.message.includes('Reviews endpoint network timeout'))).toBe(true);

    const nonArrayApi = {
      async get(path: string): Promise<unknown> {
        if (path.includes('/issues?')) return [];
        if (path.includes('/pulls?')) return [
          { number: 42, title: 'PR 42', state: 'open', draft: false, head: { sha: 'a'.repeat(40) } },
        ];
        if (path.includes('/check-runs?') || path.includes('/status?')) return { total_count: 0, check_runs: [], statuses: [] };
        if (path.includes('/pulls/42/reviews')) return { message: 'Not an array' };
        return [];
      },
      async associations(): Promise<unknown> { return { data: { repository: {} } }; },
    };

    const [nonArrayRepo] = await loadGitHubTasks(['acme/demo'], nonArrayApi, { now: NOW, limit: 10 });
    expect(nonArrayRepo.status).toBe('partial');
    expect(nonArrayRepo.errors.some((e) => e.message.includes('Non-array response for reviews'))).toBe(true);
  });
});
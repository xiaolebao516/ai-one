import {
  collectSnapshot,
  type GitHubSnapshot,
  type SnapshotClient,
  type SnapshotError,
  type SnapshotIssue,
  type SnapshotPullRequest,
  type SnapshotSource,
  type SnapshotStatus,
} from '../../scripts/task-status/snapshot.mjs';
import type { HudCi, HudEvidence, HudTask, LText, TaskStatus } from './taskHudModel';

/** Fixed contract from Spec #50 v1. This module does not import the host or access the network. */
export interface GitHubApi {
  get(path: string): Promise<unknown>;
  associations(repo: string, numbers: number[]): Promise<unknown>;
}

export interface GitHubLoadOptions {
  page?: number;
  limit?: number;
  /** Deterministic clock for age labels and failure records; not a GitHub observation. */
  now?: Date;
}

export interface GitHubRepoTasks {
  repo: string;
  tasks: HudTask[];
  status: SnapshotStatus;
  errors: SnapshotError[];
  pagination: GitHubSnapshot['pagination'];
  observedAt: string;
}

export function createGitHubClientFrom(api: GitHubApi): SnapshotClient {
  return {
    get: (path) => api.get(path),
    associations: (repo, numbers) => api.associations(repo, numbers),
  };
}

function age(observedAt: string, now: Date): number | undefined {
  const time = Date.parse(observedAt);
  const elapsed = now.getTime() - time;
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 60000)) : undefined;
}

function readback(id: string, description: LText, source: SnapshotSource, now: Date, data?: unknown): HudEvidence {
  return {
    id,
    kind: 'readback',
    text: {
      en: description.en + ' — ' + source.url + ' (observed ' + source.observedAt + ')',
      zh: description.zh + ' — ' + source.url + '（采集于 ' + source.observedAt + '）',
    },
    observedMinutesAgo: age(source.observedAt, now),
    raw: JSON.stringify({ source, data }),
  };
}

function inference(id: string, value: boolean, reason: string, source: SnapshotSource, now: Date): HudEvidence {
  return {
    id,
    kind: 'unverified',
    text: {
      en: 'Inference only (' + String(value) + '): ' + reason + '; not a review or approval.',
      zh: '仅为推断（' + String(value) + '）：' + reason + '；不是审查或批准结论。',
    },
    observedMinutesAgo: age(source.observedAt, now),
    raw: JSON.stringify({ source, value, reason, verified: false }),
  };
}

function ciFor(pr: SnapshotPullRequest): HudCi {
  const states: Record<string, HudCi['state']> = {
    success: 'success',
    failure: 'failure',
    pending: 'running',
  };
  const state = states[pr.ci.conclusion] ?? 'unknown';
  const partial = pr.ci.completeness === 'partial';
  return {
    state,
    // CI SHA is read from its own evidence, never inferred from the PR.
    headSha: pr.ci.headSha,
    detail: {
      en: 'CI ' + pr.ci.conclusion + ' (' + pr.ci.checks.length + ' checks, ' + pr.ci.statuses.length + ' statuses)' +
        (partial ? '; evidence partial / incomplete' : ''),
      zh: 'CI ' + pr.ci.conclusion + '（' + pr.ci.checks.length + ' 项检查，' + pr.ci.statuses.length + ' 项状态）' +
        (partial ? '；证据不完整' : ''),
    },
  };
}

function statusFor(labels: readonly string[], pr: SnapshotPullRequest | undefined): TaskStatus {
  if (labels.includes('blocked')) return 'blocked';
  if (labels.includes('needs-user')) return 'decide';
  if (pr && !pr.draft && pr.possibleHumanAcceptance.value === true) return 'accept';
  if (labels.includes('needs-review') || (pr && !pr.draft)) return 'review';
  if (pr?.draft) return 'running';
  return 'unknown';
}

function guidance(status: TaskStatus): { summary: LText; nextStep: LText } {
  switch (status) {
    case 'blocked':
      return { summary: { en: 'GitHub label: blocked.', zh: 'GitHub 标签：blocked（受阻）。' },
        nextStep: { en: 'Inspect the blocker.', zh: '查看阻塞原因。' } };
    case 'decide':
      return { summary: { en: 'GitHub label: needs-user.', zh: 'GitHub 标签：needs-user（等待用户决策）。' },
        nextStep: { en: 'User decision is requested.', zh: '需要用户作出决定。' } };
    case 'accept':
      return { summary: { en: 'Possible human acceptance inferred from a non-Draft PR and observed CI; not verified approval.',
          zh: '根据非 Draft PR 和已观察到的 CI 推断可能需要人工验收；并未验证批准状态。' },
        nextStep: { en: 'Inspect current HEAD, CI and acceptance requirements.', zh: '检查当前 HEAD、CI 和验收条件。' } };
    case 'review':
      return { summary: { en: 'Review may be needed; no review verdict was read.',
          zh: '可能需要审查；没有读取到审查结论。' },
        nextStep: { en: 'Read the PR and request independent review.', zh: '阅读 PR 并安排独立审查。' } };
    case 'running':
      return { summary: { en: 'Draft PR exists; agent/runtime activity is unknown.',
          zh: '存在 Draft PR；Agent 是否运行未知。' },
        nextStep: { en: 'Inspect the Draft PR for progress.', zh: '查看 Draft PR 了解进展。' } };
    default:
      return { summary: { en: 'Progress is not visible from GitHub.', zh: '无法从 GitHub 判断进度。' },
        nextStep: { en: 'Inspect the Issue for a current handoff.', zh: '查看 Issue 是否有最新交接记录。' } };
  }
}

function combinedGap(parts: Array<LText | undefined>): LText | undefined {
  const present = parts.filter((item): item is LText => item !== undefined);
  return present.length ? {
    en: present.map((item) => item.en).join(' '),
    zh: present.map((item) => item.zh).join(' '),
  } : undefined;
}

function makeTask(
  snapshot: GitHubSnapshot,
  id: string,
  title: string,
  labels: readonly string[],
  issue: SnapshotIssue | undefined,
  pr: SnapshotPullRequest | undefined,
  now: Date,
  extraEvidence: HudEvidence[] = [],
): HudTask {
  const status = statusFor(labels, pr);
  const guidanceText = guidance(status);
  const evidence: HudEvidence[] = [...extraEvidence];
  const snapRec = snapshot as unknown as Record<string, unknown>;
  const prRec = pr as unknown as Record<string, unknown> | undefined;
  const localRuns = (snapRec?.localEvidence as HudEvidence[]) || (prRec?.localEvidence as HudEvidence[]) || [];
  if (Array.isArray(localRuns)) {
    for (const r of localRuns) {
      if (r && r.text) {
        evidence.push({
          id: r.id || (id + ':local:' + evidence.length),
          kind: 'local',
          text: r.text,
          raw: r.raw,
          observedMinutesAgo: r.observedMinutesAgo,
        });
      }
    }
  }
  const prReviews = (prRec?.reviews as Array<{ id?: string | number; user?: string; body?: string; submittedAt?: string; observedMinutesAgo?: number }>) || [];
  if (Array.isArray(prReviews)) {
    for (const r of prReviews) {
      if (r && r.body) {
        const reviewId = String(r.id ?? (id + ':review:' + evidence.length));
        const minutesAgo = r.submittedAt ? age(r.submittedAt, now) : (r.observedMinutesAgo ?? undefined);
        evidence.push({
          id: reviewId,
          kind: 'readback',
          text: { zh: `GitHub 独立审计评论 · ${r.user || 'Reviewer'}`, en: `GitHub Review Comment · ${r.user || 'Reviewer'}` },
          raw: r.body,
          observedMinutesAgo: minutesAgo,
        });
      }
    }
  }
  const issueRec = issue as unknown as Record<string, unknown> | undefined;
  let commentsCompleteness: 'complete' | 'truncated' | 'unknown' = 'complete';
  if (issueRec?.commentsTruncated) {
    commentsCompleteness = 'truncated';
  } else if (
    Array.isArray(snapshot.errors) &&
    snapshot.errors.some((e) => typeof e?.url === 'string' && issue && e.url.includes(`/issues/${issue.number}/comments`))
  ) {
    commentsCompleteness = 'unknown';
  }

  const issueComments = (issueRec?.comments as Array<{ id?: string | number; user?: string; body?: string; createdAt?: string; observedMinutesAgo?: number }>) || [];
  if (Array.isArray(issueComments)) {
    for (const c of issueComments) {
      if (c && c.body) {
        const commentId = String(c.id ?? (id + ':comment:' + evidence.length));
        const minutesAgo = c.createdAt ? age(c.createdAt, now) : (c.observedMinutesAgo ?? undefined);
        evidence.push({
          id: commentId,
          kind: 'readback',
          text: { zh: `Issue 评论 · ${c.user || 'User'}`, en: `Issue Comment · ${c.user || 'User'}` },
          raw: c.body,
          observedMinutesAgo: minutesAgo,
        });
      }
    }
  }

  if (issue) {
    evidence.push(readback(id + ':issue', { en: 'Open Issue #' + issue.number + '; labels: ' + labels.join(', '),
      zh: '开放 Issue #' + issue.number + '；标签：' + labels.join('、') }, issue.source, now,
    { number: issue.number, labels, association: issue.association.status }));
    evidence.push(inference(id + ':issue-inference', issue.possibleHumanAcceptance.value,
      issue.possibleHumanAcceptance.reason, issue.possibleHumanAcceptance.source, now));
  }
  if (pr) {
    evidence.push(readback(id + ':pr', { en: 'Open PR #' + pr.number + (pr.draft ? ' (Draft)' : ' (non-Draft)'),
      zh: '开放 PR #' + pr.number + (pr.draft ? '（草稿）' : '（非草稿）') },
    pr.source, now, { number: pr.number, draft: pr.draft, headSha: pr.headSha }));
    // snapshot.mjs produces sources in check-runs, then commit-status order.
    // Keep shared metadata in both readbacks, but attach each query's own payload only once.
    const ciMeta = { headSha: pr.ci.headSha, conclusion: pr.ci.conclusion, completeness: pr.ci.completeness };
    for (const [index, source] of pr.ci.sources.entries()) {
      const sourceData = index === 0
        ? { ...ciMeta, checks: pr.ci.checks }
        : index === 1
          ? { ...ciMeta, statuses: pr.ci.statuses }
          : ciMeta;
      evidence.push(readback(id + ':ci:' + index, { en: 'CI bound to HEAD ' + pr.ci.headSha +
        '; conclusion ' + pr.ci.conclusion + '; completeness ' + pr.ci.completeness,
        zh: 'CI 对应 HEAD ' + pr.ci.headSha + '；结果 ' + pr.ci.conclusion + '；完整性 ' + pr.ci.completeness },
      source, now, sourceData));
    }
    if (pr.association.source) {
      evidence.push(readback(id + ':pr-association',
        { en: 'Structured closingIssuesReferences: ' + pr.association.status,
          zh: '结构化 closingIssuesReferences 关联：' + pr.association.status },
        pr.association.source, now, pr.association.issues));
    }
    evidence.push(inference(id + ':pr-inference', pr.possibleHumanAcceptance.value,
      pr.possibleHumanAcceptance.reason, pr.possibleHumanAcceptance.source, now));
  }

  const noPr: LText | undefined = issue && !pr
    ? { en: 'GitHub does not show progress for this Issue without a linked open PR.',
        zh: '这个 Issue 没有关联的开放 PR，GitHub 无法反映其进度。' }
    : undefined;
  const uncertainAssociation: LText | undefined =
    (issue && issue.association.status === 'unknown') ||
    (!issue && pr && pr.association.status !== 'complete')
      ? { en: 'PR/Issue association could not be fully verified from the loaded snapshot.',
          zh: '无法从当前加载的快照完整核实 PR/Issue 的关联。' } : undefined;
  const gap = combinedGap([noPr, uncertainAssociation]);

  return {
    id,
    dataSource: 'github',
    repo: snapshot.repository,
    ...(issue ? { issue: issue.number } : {}),
    title: { en: title, zh: title },
    status,
    ...(status === 'accept'
      ? { statusNote: { en: 'inferred, unverified', zh: '推断，未验证' } }
      : {}),
    stages: [],
    summary: guidanceText.summary,
    nextStep: guidanceText.nextStep,
    ...(pr ? {
      pr: {
        number: pr.number,
        draft: pr.draft,
        headSha: pr.headSha,
        ...(((pr as unknown as Record<string, unknown>).changedFiles != null)
          ? { changedFiles: (pr as unknown as Record<string, unknown>).changedFiles as number }
          : {}),
      },
      ci: ciFor(pr),
    } : {}),
    ...(((pr as unknown as Record<string, unknown>)?.review || (issue as unknown as Record<string, unknown>)?.review)
      ? { review: ((pr as unknown as Record<string, unknown>)?.review || (issue as unknown as Record<string, unknown>)?.review) as HudTask['review'] }
      : {}),
    evidence,
    commentsCompleteness,
    ...(gap ? { gap } : {}),
  };
}

/** One task per loaded open Issue, plus one for each PR not attached to a loaded Issue. */
export function snapshotToHudTasks(snapshot: GitHubSnapshot, now: Date = new Date()): HudTask[] {
  const byNumber = new Map(snapshot.pullRequests.map((pr) => [pr.number, pr]));
  const attached = new Set<number>();
  const tasks: HudTask[] = [];
  for (const issue of snapshot.issues) {
    const refs = issue.association.status === 'linked' ? issue.association.pullRequests : [];
    const linked = refs.flatMap((ref) => {
      const pr = byNumber.get(ref.number);
      return pr && pr.state === 'open' ? [pr] : [];
    }).sort((a, b) => b.number - a.number);
    linked.forEach((pr) => attached.add(pr.number));
    const chosen = linked[0];
    const id = snapshot.repository + ':issue:' + issue.number;
    const evidence: HudEvidence[] = [];
    for (const [index, pr] of linked.entries()) {
      const link = refs.find((ref) => ref.number === pr.number);
      if (link) evidence.push(readback(id + ':link:' + index,
        { en: 'Structured link: Issue #' + issue.number + ' to PR #' + pr.number +
            (index ? ' (additional PR; not selected)' : ' (highest numbered selected)'),
          zh: '结构化关联：Issue #' + issue.number + ' 到 PR #' + pr.number +
            (index ? '（其他 PR，未选中）' : '（选中编号最大的 PR）') },
        link.source, now, { issue: issue.number, pr: pr.number, headSha: pr.headSha }));
    }
    tasks.push(makeTask(snapshot, id, issue.title, issue.labels, issue, chosen, now, evidence));
  }
  for (const pr of snapshot.pullRequests) {
    if (attached.has(pr.number)) continue;
    tasks.push(makeTask(snapshot, snapshot.repository + ':pr:' + pr.number, pr.title,
      [], undefined, pr, now));
  }
  return tasks;
}

/** Each repository is independent; partial/error snapshots remain visible to the UI. */
export async function loadGitHubTasks(
  repos: readonly string[],
  api: GitHubApi,
  options: GitHubLoadOptions = {},
): Promise<GitHubRepoTasks[]> {
  const now = options.now ?? new Date();
  const client = createGitHubClientFrom(api);
  const results: GitHubRepoTasks[] = [];
  for (const repo of repos) {
    try {
      const snapshot = await collectSnapshot({ repo, page: options.page, limit: options.limit }, client);
      results.push({
        repo, tasks: snapshotToHudTasks(snapshot, now), status: snapshot.status,
        errors: snapshot.errors, pagination: snapshot.pagination,
        observedAt: snapshot.completedAt ?? snapshot.startedAt,
      });
    } catch (error) {
      // Unexpected exceptions and option errors must not abort the next repository or expose gh stderr.
      const message = error instanceof Error && error.message.startsWith('--')
        ? error.message : 'GitHub snapshot could not be collected.';
      const observedAt = now.toISOString();
      results.push({
        repo, tasks: [], status: 'error',
        errors: [{ url: '', observedAt, message }],
        pagination: {}, observedAt,
      });
    }
  }
  return results;
}

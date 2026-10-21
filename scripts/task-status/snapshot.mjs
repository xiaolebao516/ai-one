export function validateOptions({ repo, page = 1, limit = 10 }) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('--repo must be an owner/repository on github.com.');
  }
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('--page must be 1..10000.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new Error('--limit must be 1..30.');
  return { repo, page, limit };
}

const isSha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const isNumber = (value) => Number.isSafeInteger(value) && value > 0;
const source = (endpoint, time) => ({ url: `https://api.github.com/${endpoint}`, observedAt: time });
const more = (count, limit) => count >= limit ? 'possible' : 'no';

function checkConclusion(checks, statuses, incomplete) {
  if (checks.some((c) => ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(c.conclusion)) || statuses.some((s) => ['failure', 'error'].includes(s.state))) return 'failure';
  if (checks.some((c) => c.status !== 'completed') || statuses.some((s) => s.state === 'pending')) return 'pending';
  if (incomplete) return 'unknown';
  if (checks.length + statuses.length === 0) return 'missing';
  if (checks.some((c) => !['success', 'neutral', 'skipped'].includes(c.conclusion)) || statuses.some((s) => s.state !== 'success')) return 'unknown';
  return 'success';
}

export async function collectSnapshot(options, client, now = () => new Date().toISOString()) {
  const { repo, page, limit } = validateOptions(options);
  const snapshot = {
    schemaVersion: 1, repository: repo, startedAt: now(), completedAt: null, status: 'complete',
    scope: { page, limit, description: 'One page per list; issues endpoint includes PRs before filtering. Counts are loaded counts, not repository totals.' },
    issues: [], pullRequests: [], pagination: {}, errors: [],
    runtime: { agentOnline: 'unknown', quota: 'unknown', iteration: 'unknown', loginState: 'unknown' },
  };
  async function read(endpoint, validate) {
    const evidence = source(endpoint, now());
    try {
      const data = await client.get(endpoint);
      if (!validate(data)) throw new Error('Unexpected GitHub response shape.');
      return { data, evidence };
    } catch (error) {
      snapshot.errors.push({ ...evidence, message: error.message });
      return { data: null, evidence };
    }
  }
  const listValid = (data) => Array.isArray(data) && data.every((x) => isNumber(x.number) && typeof x.title === 'string' && x.state === 'open');
  const prefix = `repos/${repo}`;
  const query = `state=open&sort=created&direction=desc&per_page=${limit}&page=${page}`;
  const issueResult = await read(`${prefix}/issues?${query}`, listValid);
  const prResult = await read(`${prefix}/pulls?${query}`, (data) => listValid(data) && data.every((p) => isSha(p.head?.sha) && typeof p.draft === 'boolean'));
  for (const [key, result] of [['issues', issueResult], ['pullRequests', prResult]]) {
    snapshot.pagination[key] = { page, limit, returned: result.data?.length ?? null, more: result.data ? more(result.data.length, limit) : 'unknown', earlierPagesOmitted: page > 1, source: result.evidence };
  }
  snapshot.issues = (issueResult.data ?? []).filter((i) => !i.pull_request).map((i) => ({
    number: i.number, title: i.title, state: i.state, url: `https://github.com/${repo}/issues/${i.number}`,
    labels: (i.labels ?? []).map((l) => typeof l === 'string' ? l : l.name).filter((l) => typeof l === 'string'),
    source: issueResult.evidence, association: { status: 'unlinked', pullRequests: [], scope: 'loaded open PRs only' },
  }));
  for (const p of prResult.data ?? []) {
    const sha = p.head.sha;
    const checksResult = await read(`${prefix}/commits/${sha}/check-runs?filter=latest&per_page=100&page=1`, (d) => Number.isSafeInteger(d?.total_count) && d.total_count >= 0 && Array.isArray(d.check_runs) && d.check_runs.every((c) => isSha(c.head_sha) && typeof c.status === 'string'));
    const statusResult = await read(`${prefix}/commits/${sha}/status?per_page=100&page=1`, (d) => d?.sha === sha && Number.isSafeInteger(d.total_count) && d.total_count >= 0 && Array.isArray(d.statuses) && d.statuses.every((s) => typeof s.state === 'string'));
    const mismatched = (checksResult.data?.check_runs ?? []).some((c) => c.head_sha !== sha);
    const checks = (checksResult.data?.check_runs ?? []).filter((c) => c.head_sha === sha).map((c) => ({ name: c.name ?? 'unknown', headSha: c.head_sha, status: c.status, conclusion: c.conclusion ?? 'unknown', url: c.html_url ?? null }));
    const statuses = (statusResult.data?.statuses ?? []).map((s) => ({ context: s.context ?? 'unknown', state: s.state, url: s.target_url ?? null }));
    const truncated = (checksResult.data?.total_count ?? 0) > checks.length || (statusResult.data?.total_count ?? 0) > statuses.length;
    const incomplete = !checksResult.data || !statusResult.data || mismatched || truncated;
    if (mismatched || truncated) snapshot.errors.push({ ...checksResult.evidence, message: 'CI evidence is truncated or contains a different HEAD; excluded mismatched checks.' });
    const conclusion = checkConclusion(checks, statuses, incomplete);
    snapshot.pullRequests.push({
      number: p.number, title: p.title, state: p.state, draft: p.draft, headSha: sha,
      url: `https://github.com/${repo}/pull/${p.number}`, source: prResult.evidence,
      ci: { headSha: sha, conclusion, completeness: incomplete ? 'partial' : 'complete', checks, statuses, sources: [checksResult.evidence, statusResult.evidence] },
      association: { status: 'unknown', issues: [], source: null },
      possibleHumanAcceptance: {
        value: !p.draft && conclusion === 'success' && !incomplete,
        kind: 'inference', reason: p.draft ? 'Draft: work/review may still be ongoing.' : conclusion === 'success' && !incomplete ? 'Non-Draft with successful observed CI: consider human acceptance; approval, required checks and mergeability are not verified.' : 'CI is not fully successful; inspect evidence first.',
        headSha: sha, source: prResult.evidence,
      },
    });
  }
  // GitHub's structured closing reference, not body regexes, comments or Handoff claims.
  if (snapshot.pullRequests.length) {
    const evidence = { url: 'https://api.github.com/graphql', observedAt: now(), field: 'closingIssuesReferences' };
    try {
      const response = await client.associations(repo, snapshot.pullRequests.map((p) => p.number));
      if (response.errors?.length) snapshot.errors.push({ ...evidence, message: 'GraphQL returned partial/errors; missing associations remain unknown.' });
      for (const p of snapshot.pullRequests) {
        const data = response.data?.repository?.[`p${p.number}`];
        const refs = data?.closingIssuesReferences;
        if (data?.headRefOid !== p.headSha || !Array.isArray(refs?.nodes) || typeof refs.pageInfo?.hasNextPage !== 'boolean' || !refs.nodes.every((i) => isNumber(i.number) && typeof i.repository?.nameWithOwner === 'string')) {
          snapshot.errors.push({ ...evidence, message: `PR #${p.number}: association unavailable or HEAD changed during query.` });
          continue;
        }
        p.association = { status: refs.pageInfo.hasNextPage ? 'partial' : 'complete', issues: refs.nodes.map((i) => ({ number: i.number, repository: i.repository.nameWithOwner })), source: evidence };
        if (refs.pageInfo.hasNextPage) snapshot.errors.push({ ...evidence, message: `PR #${p.number}: closing references truncated at 100.` });
        for (const i of snapshot.issues) {
          if (p.association.issues.some((ref) => ref.number === i.number && ref.repository.toLowerCase() === repo.toLowerCase())) {
            i.association.status = 'linked';
            i.association.pullRequests.push({ number: p.number, headSha: p.headSha, source: evidence });
          }
        }
      }
    } catch (error) { snapshot.errors.push({ ...evidence, message: error.message }); }
  }
  for (const i of snapshot.issues) {
    if (i.association.status === 'unlinked' && (!prResult.data || snapshot.pullRequests.some((p) => p.association.status !== 'complete'))) i.association.status = 'unknown';
    i.possibleHumanAcceptance = { value: i.labels.includes('needs-user') || i.labels.includes('needs-review'), kind: 'inference', reason: 'Only GitHub needs-user/needs-review labels are used; not proof of completion or approval.', source: i.source };
  }
  const limited = page > 1 || Object.values(snapshot.pagination).some((p) => p.more !== 'no');
  snapshot.status = !issueResult.data && !prResult.data ? 'error' : snapshot.errors.length || limited ? 'partial' : 'complete';
  snapshot.completedAt = now();
  return snapshot;
}

const safeText = (value) => String(value).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').slice(0, 180);
export function renderText(snapshot) {
  const candidates = snapshot.issues.filter((i) => i.possibleHumanAcceptance.value).map((i) => `Issue #${i.number}`).concat(snapshot.pullRequests.filter((p) => p.possibleHumanAcceptance.value).map((p) => `PR #${p.number}`));
  const lines = [`${snapshot.repository}: ${snapshot.status} | loaded ${snapshot.issues.length} issues, ${snapshot.pullRequests.length} PRs | possible human acceptance: ${candidates.join(', ') || 'none inferred'}`, `Observed ${snapshot.startedAt} .. ${snapshot.completedAt} (not an atomic snapshot)`];
  for (const i of snapshot.issues) lines.push(`Issue #${i.number} [${i.state}] ${safeText(i.title)} | PR: ${i.association.pullRequests.map((p) => `#${p.number}`).join(', ') || i.association.status} | ${i.url}`);
  for (const p of snapshot.pullRequests) lines.push(`PR #${p.number} [${p.draft ? 'Draft' : 'non-Draft'}] ${safeText(p.title)} | HEAD ${p.headSha} | CI ${p.ci.conclusion}/${p.ci.completeness} | ${p.url}`);
  for (const [key, p] of Object.entries(snapshot.pagination)) if (p.more !== 'no' || p.earlierPagesOmitted) lines.push(`LIMIT ${key}: page ${p.page}, limit ${p.limit}, more=${p.more}; ${p.earlierPagesOmitted ? 'earlier pages omitted; ' : ''}use --page ${p.page + 1} to inspect the next page.`);
  for (const error of snapshot.errors) lines.push(`ERROR ${safeText(error.message)} | ${error.url}`);
  lines.push('Inference only: labels/non-Draft + observed CI suggest inspection, never approval or merge readiness.', 'Source: GitHub API; use --json for per-query timestamps, SHA-bound CI and association evidence.', 'Agent online/quota/iteration/login: unknown. Does not monitor CC/Prodex processes.');
  return lines.join('\n');
}

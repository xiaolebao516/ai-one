import type { GithubWriteCreateIssueArgs, GithubWriteResult, GithubWriteStatus } from '../host/githubWrite';
import { issueStateKey, type AcceptanceFix, type IssueStates } from './acceptanceFix';

export interface AcceptanceItem {
  key: string; repo: string; issue: number; title: string;
  raw?: string; steps?: string; expected?: string;
}
export interface AcceptanceRead { items: AcceptanceItem[]; partial: boolean; errors: string[]; issueStates?: IssueStates }
export interface AcceptanceReader { get(path: string): Promise<unknown> }
export interface AcceptanceWriter {
  status(): Promise<GithubWriteStatus>;
  comment(args: { repo: string; issue: number; text: string }): Promise<GithubWriteResult>;
  createIssue?(args: GithubWriteCreateIssueArgs): Promise<GithubWriteResult>;
}
export interface AcceptanceRecord {
  key: string; repo: string; issue: number; title: string;
  kind: 'approved' | 'feedback'; sync: 'pending' | 'confirmed' | 'failed' | 'unconfirmed';
  feedback?: string;
  fix?: AcceptanceFix;
}
export type AcceptanceRecords = Record<string, AcceptanceRecord>;
export const ACCEPTANCE_STORAGE_KEY = 'ai-one.workbench.userAcceptance.v1';

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function firstSentence(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.split(/(?<=[。！？!?])\s*|(?<=[.;；])\s+/u)[0]?.slice(0, 220) || text.slice(0, 220);
}
function parseEntry(repo: string, issue: number, raw: string, index: number): AcceptanceItem | undefined {
  const clean = raw.trim();
  if (!clean || /^(?:无|暂无|没有|none|n\/a|无待验收事项)[。.!！\s]*$/iu.test(clean)) return undefined;
  const lines = clean.split(/\r?\n/u).map((line) => line.trim().replace(/^(?:[-*+]\s+|\d+[.)、]\s+)/u, ''));
  if (lines.length === 1 && /^(?:无|暂无|没有|none|n\/a|无待验收事项)[。.!！\s]*$/iu.test(lines[0])) return undefined;
  let description = '', steps = '', expected = '', loose = false;
  for (const line of lines) {
    if (!line) continue;
    const step = line.match(/^(?:操作步骤|验收步骤|测试步骤|步骤|怎么操作|操作|位置|路径|How to test|Steps?)\s*[:：]\s*(.*)$/iu);
    const want = line.match(/^(?:预期结果|预期表现|预期|期望结果|Expected(?: result)?)\s*[:：]\s*(.*)$/iu);
    if (step) steps += (steps ? '\n' : '') + step[1];
    else if (want) expected += (expected ? '\n' : '') + want[1];
    else if (!steps && !expected && !description) description = line;
    else loose = true;
  }
  const structured = Boolean(steps.trim() && expected.trim() && description && !loose);
  const key = repo.toLowerCase() + ':' + issue + ':' + index + ':' + fingerprint(clean);
  return { key, repo, issue, title: firstSentence(description || lines[0] || clean),
    ...(structured ? { steps: steps.trim(), expected: expected.trim() } : { raw: clean }) };
}
/** A missing/empty section means no acceptance. Unstructured nonempty entries remain verbatim. */
export function parseAcceptanceSection(repo: string, issue: number, body: string): AcceptanceItem[] {
  const lines = body.split(/\r?\n/u);
  const chunks: string[] = [];
  let inside = false, depth = 0, current: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  const flush = () => { if (current.some((line) => line.trim())) chunks.push(current.join('\n')); current = []; };
  for (const line of lines) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (inside) current.push(line);
      if (delimiter && delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined;
      continue;
    }
    if (delimiter) {
      fence = { marker: delimiter[1][0], length: delimiter[1].length };
      if (inside) current.push(line);
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      if (inside && heading[1].length <= depth) { flush(); inside = false; }
      if (!inside && /^待用户验收\s*[:：]?$/u.test(heading[2].trim())) {
        inside = true; depth = heading[1].length;
      } else if (inside) current.push(line);
      continue;
    }
    if (!inside) continue;
    if (/^\s{0,1}(?:[-*+]\s+|\d+[.)、]\s+)/u.test(line)) { flush(); current.push(line); }
    else current.push(line);
  }
  flush();
  return chunks.flatMap((raw, index) => {
    const item = parseEntry(repo, issue, raw, index);
    return item ? [item] : [];
  });
}
const MAX_PAGES = 10;
const PAGE_SIZE = 30;
function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((label) => typeof label === 'string' ? label :
    label && typeof label === 'object' && 'name' in label && typeof label.name === 'string' ? label.name : '')
    .filter(Boolean);
}
/** Read only fixed paths accepted by github_readonly.rs; bound scan and expose partial reads. */
export async function loadAcceptanceIssues(repos: readonly string[], api: AcceptanceReader): Promise<AcceptanceRead> {
  const items: AcceptanceItem[] = [], errors: string[] = [], issueStates: IssueStates = {};
  let partial = false;
  for (const repo of repos) {
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/u.test(repo)) { errors.push(repo); continue; }
    const seen = new Set<number>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const path = `repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=${PAGE_SIZE}&page=${page}`;
      try {
        const data: unknown = await api.get(path);
        if (!Array.isArray(data) || !data.every((entry) => entry && typeof entry === 'object'
          && Number.isSafeInteger(entry.number) && entry.number > 0 && typeof entry.title === 'string'
          && (entry.state === 'open' || entry.state === 'closed'))) throw new Error('invalid issue listing');
        for (const issue of data) {
          if (issue.pull_request || seen.has(issue.number)) continue;
          seen.add(issue.number);
          issueStates[issueStateKey(repo, issue.number)] = {
            state: issue.state,
            ...(typeof issue.state_reason === 'string' ? { reason: issue.state_reason } : {}),
          };
          if (!labelNames(issue.labels).includes('needs-user')) continue;
          if (typeof issue.body !== 'string') {
            errors.push(`${repo} #${issue.number}: issue body unavailable`);
            continue;
          }
          items.push(...parseAcceptanceSection(repo, issue.number, issue.body));
        }
        if (data.length < PAGE_SIZE) break;
        if (page === MAX_PAGES) partial = true;
      } catch {
        errors.push(`${repo}: GitHub acceptance list unavailable (page ${page})`);
        break;
      }
    }
  }
  return { items, errors, partial: partial || errors.length > 0, issueStates };
}
export interface AcceptanceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
function validFix(value: unknown): value is AcceptanceFix {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fix = value as AcceptanceFix;
  return ['pending', 'confirmed', 'failed', 'unconfirmed'].includes(fix.sync)
    && (fix.issue === undefined || Number.isSafeInteger(fix.issue))
    && (fix.url === undefined || typeof fix.url === 'string');
}
export function readAcceptanceRecords(storage: AcceptanceStorage): AcceptanceRecords {
  const raw = storage.getItem(ACCEPTANCE_STORAGE_KEY);
  if (raw === null) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid acceptance storage');
  const records: AcceptanceRecords = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid acceptance record');
    const row = value as AcceptanceRecord;
    if (row.key !== key || typeof row.repo !== 'string' || !Number.isSafeInteger(row.issue) ||
      typeof row.title !== 'string' || !['approved', 'feedback'].includes(row.kind) ||
      !['pending', 'confirmed', 'failed', 'unconfirmed'].includes(row.sync) ||
      (row.feedback !== undefined && typeof row.feedback !== 'string') ||
      (row.fix !== undefined && !validFix(row.fix))) throw new Error('invalid acceptance record');
    records[key] = row;
  }
  return records;
}
export function saveAcceptanceRecords(storage: AcceptanceStorage, records: AcceptanceRecords): void {
  storage.setItem(ACCEPTANCE_STORAGE_KEY, JSON.stringify(records));
}
/** Only one existing #106 whitelisted comment action. Never mutate labels or PRs. */
export async function sendAcceptanceComment(
  writer: AcceptanceWriter, item: AcceptanceItem, kind: 'approved' | 'feedback', feedback = '',
  canSend: () => boolean = () => true,
): Promise<'confirmed' | 'failed' | 'unconfirmed'> {
  const text = kind === 'approved'
    ? `用户验收：没问题。\n验收项：${item.title.slice(0, 220)}`
    : `用户验收：有问题。\n验收项：${item.title.slice(0, 220)}\n反馈：${feedback.trim()}`;
  try {
    if (!canSend() || !(await writer.status()).available || !canSend()) return 'failed';
    const result = await writer.comment({ repo: item.repo, issue: item.issue, text });
    if (result.status === 'confirmed' && result.code === 'ok'
      && result.steps.some((step) => step.step === 'comment' && step.state === 'confirmed')) return 'confirmed';
    return result.status === 'failed' ? 'failed' : 'unconfirmed';
  } catch { return 'unconfirmed'; }
}

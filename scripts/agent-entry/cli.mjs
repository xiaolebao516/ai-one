#!/usr/bin/env node
// Quick entry for agents picking up work (Issue #140). `board` shows which open Spec/Task Issues are
// free, claimed or already have a PR; `take` claims the best free one through the existing claim lock
// (scripts/issue-claim) and prints how to start. It never edits Issues and never opens worktrees.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { claim, list as listClaims, EXIT } from '../issue-claim/cli.mjs';

const USAGE = `usage:
  node scripts/agent-entry/cli.mjs board
  node scripts/agent-entry/cli.mjs take [<N>] --agent "<tool / session>" [--dry-run]
take without <N> picks the best free Issue: recommended for your tool first, then P0 < P1 < P2.`;

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2 };
// Words that identify an agent tool inside a "Recommended Agent" line.
const TOOL_ALIASES = {
  claude: ['claude', 'cc', 'opus'],
  codex: ['codex'],
  workbuddy: ['workbuddy'],
  antigravity: ['antigravity'],
  gpt: ['gpt', 'chatgpt', 'prodex'],
};

const field = (body, name) => new RegExp(`^[-*]\\s*\\**${name}\\**\\s*[:：]\\s*(.+)$`, 'im').exec(body)?.[1].replace(/\*\*/g, '').trim();

// A coordinator line that still says "unclaimed" (or is the template placeholder) registers nobody.
const registeredCoordinator = (value) => (value && !/^(<!--|待认领|待分配|无|none|tbd)/i.test(value) ? value : undefined);

/** Dispatch fields an Issue body may carry; every field is optional (older Issues have none). */
export function parseMeta(body = '') {
  const priority = /\bP[012]\b/.exec(field(body, 'Priority') ?? field(body, '优先级') ?? '')?.[0];
  return {
    priority,
    recommended: field(body, 'Recommended Agent'),
    backup: field(body, 'Backup Agent'),
    dependsOn: field(body, 'Depends on'),
    // Any one of the coordinator lines naming someone counts: a "待认领" in one must not hide another.
    coordinator: ['Current Coordinator / claim', '调度 agent', 'Current Coordinator'].map((name) => registeredCoordinator(field(body, name))).find(Boolean),
    readyWhen: field(body, 'Ready when'),
    planned: /Stage[:：]\s*(PLANNED|READY)\b/i.test(body),
  };
}

export function toolOf(agent = '') {
  // Only the tool part ("Codex / session 3" -> "codex"): session ids may contain other tools' aliases.
  const lower = agent.split(/[/:@]/)[0].toLowerCase();
  return Object.keys(TOOL_ALIASES).find((tool) => TOOL_ALIASES[tool].some((alias) => new RegExp(`(^|[^a-z])${alias}([^a-z]|$)`).test(lower)));
}

const recommends = (meta, tool) => Boolean(tool) && TOOL_ALIASES[tool].some((alias) => new RegExp(`(^|[^a-z])${alias}([^a-z]|$)`).test((meta.recommended ?? '').toLowerCase()));

/** Issues linked from an open PR title or from "Closes/Spec/Fixes #N" in its body. */
export function prLinks(prs) {
  const linked = new Map();
  for (const pr of prs) {
    const found = new Set();
    for (const match of pr.title.matchAll(/#(\d+)/g)) found.add(Number(match[1]));
    for (const match of (pr.body ?? '').matchAll(/(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?|spec)\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#(\d+)/gi)) found.add(Number(match[1]));
    // GitHub's own Development links, which need no keyword in the text.
    for (const ref of pr.closingIssuesReferences ?? []) found.add(Number(ref.number));
    for (const issue of found) linked.set(issue, [...(linked.get(issue) ?? []), pr.number]);
  }
  return linked;
}

/** Rows for every open Spec/Task Issue with its state (free / claimed / blocked) and dispatch fields. */
export function buildBoard({ issues, claims, prs }) {
  const held = new Map(claims.map((entry) => [entry.issue, entry]));
  const linked = prLinks(prs);
  return issues
    .filter((issue) => /^\[(Spec|Task)\]/i.test(issue.title))
    .map((issue) => {
      const meta = parseMeta(issue.body);
      const labels = issue.labels.map((label) => label.name);
      const holder = held.get(issue.number);
      return {
        number: issue.number,
        title: issue.title,
        url: issue.url,
        labels,
        meta,
        prs: linked.get(issue.number) ?? [],
        holder: holder ? { agent: holder.agent, at: holder.at } : undefined,
        // Auto-pick only touches Issues that were explicitly made claimable (a priority or a PLANNED
        // stage). Umbrella Specs need an explicit number; an Issue with an open PR but no claim is
        // someone's mid-flight work that predates the lock, so it also needs an explicit decision.
        pickable:
          !holder && !labels.includes('blocked') && !meta.coordinator && !(linked.get(issue.number)?.length) && Boolean(meta.priority || meta.planned),
      };
    })
    .sort((a, b) => a.number - b.number);
}

/** Best free Issue for this agent: recommended-for-me first, then priority, then lowest number. */
export function pickNext(board, agent) {
  const tool = toolOf(agent);
  const rank = (row) => [
    recommends(row.meta, tool) ? 0 : 1,
    PRIORITY_RANK[row.meta.priority] ?? 3,
    row.number,
  ];
  const free = board.filter((row) => row.pickable);
  free.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
  return free[0];
}

export function formatBoard(board) {
  const lines = board.map((row) => {
    const state = row.holder
      ? `已认领: ${row.holder.agent}`
      : row.labels.includes('blocked')
        ? '阻塞'
        : row.pickable
          ? '空闲'
          : row.prs.length
            ? '有PR无认领锁，先问用户'
            : row.meta.coordinator
              ? '已登记协调者但无认领锁，先核对'
              : '需指定编号';
    const prs = row.prs.length ? ` PR ${row.prs.map((n) => `#${n}`).join(',')}` : '';
    const rec = row.meta.recommended ? ` | 推荐: ${row.meta.recommended.slice(0, 40)}` : '';
    return `#${row.number} ${row.meta.priority ?? '--'} [${state}]${prs} ${row.title.slice(0, 60)}${rec}`;
  });
  return lines.length ? lines.join('\n') : 'no open Spec/Task issues';
}

export function briefing(row, agent) {
  const meta = row.meta;
  return [
    `已认领 #${row.number}: ${row.title}`,
    `Issue: ${row.url}`,
    `Priority: ${meta.priority ?? '未标'} | Depends on: ${meta.dependsOn ?? '未写（自行核对）'} | Ready when: ${meta.readyWhen ?? '未写'}`,
    row.prs.length ? `注意：已有开放 PR ${row.prs.map((n) => `#${n}`).join(', ')}，沿原分支继续，不要另开平行分支。` : '',
    '',
    '下一步（AGENTS.md「快速开发模式 v2」）：',
    `1. 读 AGENTS.md 与 Issue 正文，确认 Depends on 已满足；不满足就 \`node scripts/issue-claim/cli.mjs release ${row.number} --agent "${agent}"\` 并换一个。`,
    `2. git fetch && git worktree add ../ai-one-${row.number}-<简述> -b <类型>/${row.number}-<简述> origin/main`,
    `3. 在 Issue 登记：调度 agent = ${agent}、工作树路径、分支。`,
    '4. 按 Issue 步骤清单做；PR 标 Risk，MEDIUM/HIGH 找独立审计；合并后 release 认领锁并清理工作树。',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function gh(args, cwd) {
  const result = spawnSync('gh', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed: ${(result.stderr || result.stdout).trim()}`);
  return JSON.parse(result.stdout);
}

const PR_LIMIT = 500;

export function loadState({ cwd, fetchJson = gh, claims = listClaims } = {}) {
  const prs = fetchJson(['pr', 'list', '--state', 'open', '--limit', String(PR_LIMIT), '--json', 'number,title,body,closingIssuesReferences'], cwd);
  // A truncated list could hide the PR of a mid-flight Issue: fail closed instead of guessing.
  if (prs.length >= PR_LIMIT) throw new Error(`open PR list reached the ${PR_LIMIT} limit; refusing to pick from an incomplete list`);
  return {
    issues: fetchJson(['issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,body,labels,url'], cwd),
    prs,
    claims: claims({ cwd }),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--agent') {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--agent needs a value');
      options.agent = value;
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (/^#?\d+$/.test(arg) && options.issue === undefined) {
      options.issue = Number(arg.replace('#', ''));
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function main(argv, { cwd = process.cwd(), out = console.log, err = console.error, state, claimIssue = claim } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    err(`${error.message}\n${USAGE}`);
    return EXIT.error;
  }
  try {
    if (options.command === 'board') {
      out(formatBoard(buildBoard(state ?? loadState({ cwd }))));
      return EXIT.ok;
    }
    if (options.command !== 'take' || !options.agent) {
      err(USAGE);
      return EXIT.error;
    }
    const board = buildBoard(state ?? loadState({ cwd }));
    const row = options.issue === undefined ? pickNext(board, options.agent) : board.find((entry) => entry.number === options.issue);
    if (!row) {
      err(options.issue === undefined ? '没有可自动认领的空闲 Issue。用 `board` 查看，或指定编号。' : `#${options.issue} 不是开放的 Spec/Task Issue。`);
      return EXIT.error;
    }
    if (options.dryRun) {
      out(`dry-run: would claim #${row.number} ${row.title}${row.holder ? ` (already held by ${row.holder.agent})` : ''}`);
      return EXIT.ok;
    }
    // The lock decides; the board snapshot may be stale by the time we push.
    const result = claimIssue(row.number, options.agent, { cwd });
    if (!result.ok) {
      err(`#${row.number} 已被 ${result.holder.agent ?? '(unknown)'} 认领（${result.holder.at ?? '?'}），不要做它；换一个或等用户改派。`);
      return EXIT.held;
    }
    out(briefing(row, options.agent));
    return EXIT.ok;
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return EXIT.error;
  }
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));

# Read-only GitHub task snapshot

Requires repository-compatible Node and an installed, authenticated
[GitHub CLI](https://cli.github.com/manual/gh_auth_login) with repository access.
No dependencies or credential storage are added.

```bash
node scripts/task-status/cli.mjs --repo xiaolebao516/ai-one
node scripts/task-status/cli.mjs --repo xiaolebao516/ai-one --json
node scripts/task-status/cli.mjs --repo xiaolebao516/ai-one --page 2 --limit 20
node --test scripts/task-status/tests/*.test.mjs
```

The repository is required, never hardcoded. Only github.com is supported.
REST queries use `gh api --method GET`; the fixed GraphQL **query** for
`closingIssuesReferences` uses POST transport, never a mutation. The program
does not edit GitHub, log in, launch agents, or persist snapshots/tokens.
If unavailable/unauthorized, check `gh auth status` yourself. Errors cannot be
mistaken for an empty repository. Raw subprocess stderr is suppressed to avoid
exposing account/server details.

## Output and interpretation

Synthetic terminal excerpt (not a real repository run):

```text
owner/repo: complete | loaded 1 issues, 1 PRs | possible human acceptance: PR #2
Issue #1 [open] Task | PR: unlinked | https://github.com/owner/repo/issues/1
PR #2 [non-Draft] Change | HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | CI success/complete | https://github.com/owner/repo/pull/2
```

JSON schema version 1 includes `repository`, observation interval, `status`,
`scope`, `issues`, `pullRequests`, `pagination`, `errors` and `runtime`.
Factual groups have API sources and observation times (request start).
CI includes the exact PR `headSha`, individual checks and legacy commit statuses.
This is a non-atomic snapshot, not a live monitor. Re-run after new commits.

- CI precedence: failure, pending, unknown for incomplete evidence, missing
  when both endpoints return no checks, `no_success` when all completed checks
  are neutral/skipped and no legacy status succeeded, otherwise success for
  completed success/neutral/skipped checks plus successful legacy statuses.
  `no_success` never suggests human acceptance; at least one actual success
  is needed (without overriding failure/pending/incomplete evidence). This is
  **observed CI**, not required-branch-check validation. Failure/pending may
  still have `completeness: partial`.
- Checks for other SHAs are excluded. Combined status for another SHA is
  rejected. Association data whose HEAD changed is not applied.
- Only structured closing references link issues to loaded PRs. Body text,
  comment PASS, Handoff, branch names and bare #N do not. `unlinked` means no
  link among **loaded open PRs**, not proof no PR exists. Closed/merged PRs and
  later pages are out of scope. Missing data is unknown, truncated data partial.
- `possibleHumanAcceptance` is an **inference**: needs-user/needs-review labels,
  or non-Draft with complete successful observed CI. It never means approved,
  mergeable or done. Reviews, branch protection, coverage and actual runtime
  acceptance are not verified.
- CC/Prodex online state, quota, iteration and login are always unknown.

## Bounds, pagination and exit codes

One page of 10 entries per list by default; `--limit 1..30`, `--page 1..10000`.
The REST issues endpoint includes PRs before filtering: loaded issue counts can
be smaller than the limit. Counts are loaded counts, never repository totals.
Independent lists use creation-descending order. New entries can shift pages.

Full pages report `more: possible` conservatively, even if exactly the last page.
Page >1 reports earlier pages omitted. No automatic pagination. CI/reference
lists are capped at 100; total counts/pageInfo detect truncation and prevent a
fully green claim. Further CI/reference pagination is outside this small tool.

At most `3 + 2 × loaded PRs` subprocess/API calls (23 default, 63 maximum),
15 seconds per call, 8 MiB response cap. Sequential calls, no retries; a default
page with repeated timeouts can take several minutes. Use a smaller limit or
Ctrl-C to stop.

- Exit 0: complete within declared scope.
- Exit 2: partial (pagination, truncation, failures or inconsistent data).
- Exit 1: usage error or both top-level lists failed.

JSON remains parseable for usage/query errors. Inspect status/exit code before
consuming it. Terminal output removes remote control codes.

## Verification

Tests cover absent/Draft PRs, modern and legacy CI, pending/failing/missing CI,
SHA mismatches, malformed/API/auth/timeout errors, partial responses, unreliable
references, pagination/truncation, output and exit codes. A POSIX subprocess test
runs the actual entry point with a temporary fake gh; Windows skips this test.
Other tests are portable and account-independent.

Repository `pnpm verify` does not include this test command; run both when full
source/dependencies are available. No CI configuration changes are made.
Mock tests do not prove authenticated GitHub behavior. Real acceptance requires
both real commands above against the PR HEAD, checking source/SHA/CI and recording
sanitized output in the PR.

# Prodex slots

Parallel Prodex dispatch for several Claude Code sessions on one machine (Issue #57).

Prodex 0.40.40 drives one browser (port 9333) with one shared tab, and holds a machine-wide
send lock from "send" until the reply is complete, so concurrent dispatches queue up. ChatGPT
itself can generate in several chats at once. A **slot** is an extra dedicated Prodex browser
with its own debug port, profile directory and send lock, so work in different slots does not
queue and cannot interleave.

No dependencies; needs the repository's Node line and an installed `prodex`
(`PRODEX_ENTRY` may point to its `prodex.mjs`). It never reads, types or stores credentials.

```bash
node scripts/prodex-slots/cli.mjs list [--json]
node scripts/prodex-slots/cli.mjs add --count 1
node scripts/prodex-slots/cli.mjs ensure
node scripts/prodex-slots/cli.mjs run --slot auto -- --new-chat --effort high --session-key s1 --stdin < prompt.md
node scripts/prodex-slots/cli.mjs release --slot 2
node --test scripts/prodex-slots/tests/*.test.mjs   # or: pnpm slots:verify
```

## Layout

| Slot | Port | Profile | Send lock |
|---|---|---|---|
| 1 | 9333 | the stock Prodex profile (not overridden) | Prodex default |
| N ≥ 2 | 9333 + N − 1 | `~/.local/share/prodex/chrome-chatgpt-pro-slotN` | `~/.local/share/prodex/browser-send-slotN.lock` |

Slot 1 is untouched, so a plain `prodex pro browser ask` still lands in slot 1 and still
excludes `run` jobs on slot 1. The number of slots (1..8) is stored in
`~/.local/share/prodex/slots.json`; `PRODEX_SLOTS_HOME` relocates this directory.

## Commands and exit codes

- `list`: sweeps the claim directory first (see *Self-healing* - this is the one read-only
  command that also removes dead leftovers), then reports each slot's state, any live claim (by
  pid) and the last closure. States: `ready`; `busy` (logged in,
  still generating a reply, so `run` waits for it); `down` (Windows process evidence confirms absence and the CDP connection is refused);
  `needs-login`; `hidden` (window minimized or the tab not visible, Prodex cannot send);
  `error` (the probe or the browser start itself failed); `unknown`. Only `ready` slots take
  new work. `list` never restores a window.
- `add --count N`: registers N more slots, opens their windows and reports which need the user.
- `ensure`: reopens slots whose browser is not running; a profile that is still logged in
  becomes `ready` with no user action. On Windows a minimized slot window is restored without
  stealing focus; `run` does the same once before it gives up on a `hidden` slot.
- `run [--slot N|auto] [--wait-ms 600000] -- <ask args>`: claims a ready, idle slot, runs
  `prodex pro browser ask` with that slot's `PRODEX_CDP_PORT` / `PRODEX_SEND_LOCK_FILE`, then
  releases the claim. `--port` must not be passed. `--slot N` never falls back to another slot.
- `release --slot N [--note "…"] [--task …] [--session …] [--thread-url …]`: removes a claim by
  hand and writes the "thread closed, slot reusable" record (see *Closing a thread*).

Exit codes: `0` ok, `1` error, `3` the user must act (sign in or complete a ChatGPT
verification / add a slot), `4` every ready slot stayed busy past `--wait-ms`. A failing
`prodex ... ask` is always `1`, with its own code written to stderr, so its code can never
pass for `3` or `4`. A browser that cannot be started or probed is `1`, not `3`.

## Browser evidence when CDP is unreachable

`browser_unreachable` alone no longer proves the browser is closed. On Windows,
the tool checks Edge/Chrome primary processes against the exact slot port and full
profile path, then probes CDP and page presence. A matching live process with a silent
port, a responding port without a ready page, ambiguous process identity, failed probes,
and unsupported platforms remain `unknown`. These states include diagnostic guidance in
`list`, `ensure` and `run`; they do not trigger an automatic restart or imply expired login.
Only an explicit `ECONNREFUSED` plus confirmed process absence permits `down`;
an unavailable fetch, timeout, permission error or other probe failure remains `unknown`.
An intermediate `unknown` after a confirmed fresh launch is polled within the startup budget.

Slot 1 delegates its profile to Prodex. If browsers are running but the full identity cannot
be established, it remains conservatively `unknown`; inspect the intended browser before
reopening it. Process command lines, profile paths, private URLs and raw probe errors are
not included in these diagnostics. Existing ready/busy/hidden/login checks are unchanged.

The single-browser dispatch feasibility assessment and its unimplemented prototype are
documented in [the Issue #84 assessment](../../docs/prodex-single-browser.md). Existing
multi-slot dispatch remains in use.

## Error output shape

Argument mistakes (`--slot x`, `run` without `--`, `add` without `--count`, an unknown command)
print the reason plus the full usage block, exit 1. Anything that fails at runtime prints a
single `prodex-slots: <reason>` line with the next step and **no** usage block, also exit 1.
Every runtime message answers "what, why, what now":

- a missing `prodex.mjs` reports what was looked at and how to set `PRODEX_ENTRY`;
- a wrong `--slot` lists the registered slots and their ports;
- a failed ask points at `prodex pro browser recover --port <port> --target-url <thread-url>
  --request-id <id>` and the do-not-resend rule;
- a deletion blocked by an external policy (a safe-delete hook does this on this machine) names
  the file and a copy-paste `Remove-Item -LiteralPath '<file>'` command - retrying the tool will
  not get past the policy;
- a stale `.reap` mutex names its file and the same hand-deletion command, and the other slots
  keep working.

Rejected user input is never echoed back: a value in the wrong place may be a pasted token, and
stderr ends up in logs.

## Self-healing

`list`, `run`, `ensure` and `release` sweep the claim directory first. A claim whose owner pid
has exited, or that has had no heartbeat for 2 minutes, is removed and reported; `.tmp`
leftovers go the same way (a same-inode hard link of the claim, or any temp older than the
stale window - a fresh temp may belong to a claim attempt that is running right now). A live
claim is never touched. A stale `.reap` mutex is **not** deleted automatically: without OS file
locks two processes cannot both safely judge it stale, so the slot reports the file and a
copy-paste command while the other slots keep working.

`run` forwards the ask's stdout (the model reply) unchanged. Redirect it to a file and keep it
out of shared logs. Claims store a random owner id, the pid, a start time and, when `run` was
given them, the three ownership fields described below - never reply text, ask stdin/stdout or
credentials.

## Who a slot serves

A claim only says "busy". Add ownership so another session can tell which task, session and
thread a busy slot is working on.

Starting a new chat - there is no thread yet, so leave `--thread-url` out:

```bash
node scripts/prodex-slots/cli.mjs run --slot auto --task 71 --session s1 \
  -- --new-chat --effort high
```

Continuing one thread - the ownership URL and the ask target must be the same URL, otherwise
the claim would describe a different conversation than the one being written to. Run it on the
slot that holds the thread (`--slot N`, where N is the slot the first `run` reported as
`using slot N` on stderr), not on `auto` - see *Multi-turn conversations and recovery*:

```bash
THREAD='https://chatgpt.com/c/6ad9e501-da24-83e9-81f9-8b5aae1f7013'
node scripts/prodex-slots/cli.mjs run --slot 2 --task 71 --session s1 --thread-url "$THREAD" \
  -- --target-url "$THREAD" --confirm-target --effort high
```

Quote the URL. `--thread-url https://chatgpt.com/c/<id>` without quotes is legal for this tool
but the shell reads `<id>` as a redirection, and the flag then receives something else.

| Flag | Accepted | Stored as |
|---|---|---|
| `--task` | `71` or `#71` | `#71` |
| `--session` | 1-64 chars of `A-Z a-z 0-9 . _ : -` | as given |
| `--thread-url` | exactly `https://chatgpt.com/c/<thread-id>` or `https://chatgpt.com/g/g-p-<project>/c/<thread-id>`, where `<thread-id>` is the UUID from the address bar; at most 300 chars | as given |

`list` appends them to the claim line, and `--json` puts them in `busyWith`:

```
slot 2  port 9334  ready  busy (pid 1234) #71 s1 https://chatgpt.com/c/6ad9e501-...
```

Five limits, and they are deliberate:

- Ownership comes only from these flags. It is never read out of the ask arguments, stdin or
  the page, so a typo cannot silently become "who this slot belongs to".
- Only these three fields are stored. Reply text, ask stdin/stdout, cookies and tokens are not
  written to a claim.
- A thread URL may not carry credentials (`user:pass@`), a port, or any query string or fragment
  (not even an empty `?` or `#`), and must point at a thread path. It also has to be written in
  its canonical form: `..` segments and percent-escaped segments are refused instead of being
  silently normalized, because the stored string is what other sessions read - normalizing after
  the check would keep whatever sat in front of the path.
- The thread id must be UUID-shaped (`8-4-4-4-12` hex), which is what ChatGPT puts in the address
  bar. That is a format constraint on command-line input, not a claim that the id exists: it is
  what stops an arbitrary string, such as a pasted token, from passing as a thread id.
- No refusal message repeats the rejected value, for any of the three fields. A rejected value is
  by definition text this tool did not expect, so it may be a token pasted in the wrong place,
  and stderr ends up in logs. The message names the flag and the rule instead.
- Values are re-validated when they are read back, not just the key names. A hand-edited claim
  with an over-long or malformed field has those fields dropped from `list` instead of printed,
  and cannot add keys that are not part of this set.
- They are refused on `list`, `add` and `ensure`. `run` puts them in the claim; `release` puts
  them in the closure record.

`--session` is this tool's own field. `prodex ... ask --session-key` is a different thing: it
selects the prodex thread, it goes **after** `--`, and it is never written into a claim. Putting
`--session-key` before `--` is a "Missing value" or unknown-option error rather than a silent
substitution, so a thread key cannot be swallowed by the ownership layer.

## Closing a thread

When a thread is done, close it explicitly so the next session does not tiptoe around a slot
that is actually free:

```bash
node scripts/prodex-slots/cli.mjs release --slot 2 --task 71 --session s1 \
  --note "本轮线程已闭合，槽位可复用"
```

`list` then shows the closure next to the slot (time, task, note), and `--json` carries it in
`lastClosed`. One record per slot, overwritten on every release - it never grows. `release`
works even when no claim is present (for example after a crash took the claim with it), so the
closure record is the one durable "this thread is done" marker. A slot with only a closure
record and no claim takes new work immediately.

Notes are free text up to 200 characters after newlines are flattened. The record never holds
reply text or credentials, and its fields are re-validated on read.

## Multi-turn conversations and recovery

- Continue the **same thread**: pass the thread URL to the ask itself,
  `--target-url "$THREAD" --confirm-target`, and mirror it in `--thread-url` so the ownership
  record names the thread that is actually being written to.
- Continue it **on the slot whose tab holds that thread** (`--slot N`, not `auto`). `auto` may
  pick another slot, whose tab is on a different conversation; the ask then stops with "No open
  ChatGPT tab matches the confirmed target URL" before sending anything, so retrying on the right
  slot is safe. Observed 2026-10-22.
- **Record the slot yourself.** `run` releases its claim as soon as the ask returns, and `list`
  only shows live claims and the last explicit `release` record, so it cannot tell which slot a
  past thread lives on. Note the `using slot N` line from stderr, the thread URL and the request
  id from the reply when you dispatch. A `ready` slot may still hold a thread someone means to
  continue: another `run --slot auto -- --new-chat` can land on it and move its tab to a new
  conversation. There is no reservation across turns; continue soon, and if the tab has moved,
  start a new chat that restates the earlier rounds (whether `--target-url` can reopen a thread
  whose tab was moved away is not verified). A slot's debug port lists its open tab
  (`http://127.0.0.1:<port>/json`).
- `--continue` / `--continue-task` are not reliable after a restart or across sessions; do not
  use them as the only way back to a thread.
- After a `request_mismatch` or "the browser tab was moved to a different conversation", stop.
  Take the answer back with
  `prodex pro browser recover --port <port> --target-url "$THREAD" --request-id <id>` and check
  `request_verified: yes` before doing anything else. Never resend blindly.
- `recover` is plain Prodex, not wrapped by `run`, so give it the slot's own environment:
  `PRODEX_CDP_PORT=<port>` and, for slot N ≥ 2,
  `PRODEX_SEND_LOCK_FILE=<slots home>/browser-send-slotN.lock` (slots home is `PRODEX_SLOTS_HOME`,
  default `~/.local/share/prodex`). For slot 1 leave `PRODEX_SEND_LOCK_FILE` unset (Prodex's own
  default lock). Without the lock file a slot N ≥ 2 recover
  waits on slot 1's lock ("another prodex send holds the browser") and times out even though
  slot N is idle. Observed 2026-10-22. If the thread is still generating, recover says so; run it
  again once the answer has settled.
- Every turn should leave its outcome as a short comment on the task issue (question, result,
  blockers) - that comment is the handoff that survives a closed session.
- Long prompts (tens of KB) have repeatedly triggered `request_mismatch` in the field even
  though the send went out. Pass bulk content as a file attachment or a link instead of inlining
  it, and recover with the request id when it happens.


## Concurrency model

- Claims are created complete and atomically (hard link of a finished temp file). A claim is
  dead if its owner pid is gone, or if it has had no heartbeat for 2 minutes (covers a recycled
  pid). Deciding that, removing a dead claim and releasing a claim all happen under the same
  short-lived mutex and re-read the file first, so a claim someone just took is never deleted
  and an owner check cannot be separated from its delete. A claim file that cannot be parsed
  counts as live until it is 2 minutes old.
- `add` reads and rewrites the slot count under a mutex, so concurrent adds get different ids.
- The mutex is a file created exclusively. If its holder stopped inside the few-millisecond
  section (crash, power loss), the file stays; once it is older than 10 s the command stops
  with an error naming the file, and the file is deleted by hand. It is never removed
  automatically: without OS file locks two processes cannot both judge it stale and remove it
  safely. Needs a file system with hard links (NTFS).
- On Windows only, `EPERM` from exclusive mutex creation is retried in at most 25 ms
  intervals and never past `timeoutMs`; persistent `EPERM` remains an error. `EACCES`
  and non-Windows `EPERM` retain their immediate-error behavior.
- Covered by tests that start real processes which rendezvous before every round (six
  processes, 20 rounds of claiming; four processes adding at once) plus deterministic tests for
  the release and stale-mutex paths. The two collision tests fail on the first version of this
  code; the release and stale-mutex tests fail on the second.
- A probe whose `check` prints no `chatgpt:` status line is an `error` (exit 1). A status word
  this tool does not know is `unknown`, which `run` and `ensure` hand to the user (exit 3).

## How an agent uses it

0. Run `list` first to see which slots exist and which are `ready`.
1. Estimate how many Prodex jobs will run at once. If that exceeds the ready slots from
   `list`, **ask the user** to approve N more slots; do not add them on your own.
2. After approval run `add --count N`. Exit `3` means the user has to sign in to ChatGPT (or
   finish a verification) in the opened window(s); tell them which slot numbers, then run
   `list` until they are `ready`. Exit `1` is a tool or Prodex failure, not a login problem.
3. Dispatch with `run --slot auto -- <ask args>`, always passing `--effort` explicitly, with the
   prompt on stdin and the output redirected to a file. Exit `3` again means ask the user; exit
   `4` means wait or ask for more slots.
4. A claim only steers jobs onto idle slots. Prodex's own per-slot lock remains the guard
   against two sends touching one tab.

## Limits and unverified points

- Each slot is a separate logged-in browser: one manual login per slot, kept in its profile
  (verified: killing the slot's browser processes and reopening it stayed logged in; a reboot
  is not verified). Memory and CPU grow with the slot count.
- Several simultaneous logged-in browsers on one ChatGPT account may meet rate limits or
  verification prompts; not observed so far, not guaranteed.
- Slot windows must be visible to send: a minimized window reads as `hidden`. Observed twice on
  2026-10-22 (the windows were minimized, as read from Windows); `ensure` and `run` now restore
  such a window automatically on Windows (checked on a real slot). A window that is merely
  covered by other windows was not found to block sending. Whether a tab that is not selected
  or a fully covered window reads as `hidden` is not verified. Prodex's own `--minimized`
  window modes were not tried here.
- Prodex spaces visible-browser sends at least 10 s apart (`send_pacing`, an anti-bot
  measure, `PRODEX_MIN_SEND_INTERVAL_MS`). It applies across slots too, so parallel jobs start
  seconds apart. Do not override it.
- Observed on 2026-10-22 (Prodex 0.40.40, instant level): two `run --slot auto` jobs started
  together went to slots 2 and 3, generated in overlapping time, both `request_verified: yes`,
  total 33 s; each answer held only its own marker text.
- ChatGPT's model slider may be remembered per profile or per account. Always pass `--effort`
  explicitly for real work, and restore the level after tests.
- Test runs create chats in the user's account; mark them as tests and let the user delete them.
- `list` only sees claims made through this tool, not sends started with plain `prodex`.

## Not implemented / not verified yet

Tracked in Issue #61. Policy: the tool is used as it is; each item below is handled only when
it blocks real work, with a targeted PR that ticks it off in #61. Do not treat these as working.

Not implemented:
- No command to remove or shrink slots (the count only grows; closing a slot's browser and
  deleting its profile is manual).
- Window restoring exists only on Windows; the tool was only tested on Windows.
- The model-level slider of a slot is not restored after tests; always pass `--effort`.
- No advice on how many slots to open: the dispatching agent decides and asks the user.
- `list` cannot see sends made with plain `prodex`; `run` wraps only `ask` (how `recover` and
  `--continue-task` should pick a slot is not designed).

Not verified:
- Whether the logins survive a reboot, and what `ensure` does after one.
- Whether many simultaneous logged-in browsers on one account are throttled or challenged.
- Whether Prodex's `--minimized` / virtual-display modes avoid taking screen space.
- A real-machine record of "all slots busy, wait, then start" (only unit tests cover it).
- What happens to generating and reading the reply if a slot window is minimized mid-run.
- `--continue-task` / `recover` from a browser other than the one that holds the conversation.
- The last reviewed version has local tests only (no CI, which is manual now) and its second
  review round's fixes were not independently re-reviewed.

Accepted trade-offs: a mutex file left by a crash must be deleted by hand; claims need a file
system with hard links (NTFS); a claim with no heartbeat for 2 minutes counts as dead, so after
a long machine sleep two jobs may share a slot (Prodex's per-slot lock still serializes them);
the 10 s send spacing is shared by all slots; slot windows are visible windows.

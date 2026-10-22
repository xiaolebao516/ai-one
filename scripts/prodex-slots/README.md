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

- `list`: state of each slot and any live claim (by pid). States: `ready`; `busy` (logged in,
  still generating a reply, so `run` waits for it); `down` (browser not running);
  `needs-login`; `hidden` (window minimized or the tab not visible, Prodex cannot send);
  `error` (the probe or the browser start itself failed); `unknown`. Only `ready` slots take
  new work. `list` only reads; it never restores a window.
- `add --count N`: registers N more slots, opens their windows and reports which need the user.
- `ensure`: reopens slots whose browser is not running; a profile that is still logged in
  becomes `ready` with no user action. On Windows a minimized slot window is restored without
  stealing focus; `run` does the same once before it gives up on a `hidden` slot.
- `run [--slot N|auto] [--wait-ms 600000] -- <ask args>`: claims a ready, idle slot, runs
  `prodex pro browser ask` with that slot's `PRODEX_CDP_PORT` / `PRODEX_SEND_LOCK_FILE`, then
  releases the claim. `--port` must not be passed. `--slot N` never falls back to another slot.
- `release --slot N`: removes a claim by hand.

Exit codes: `0` ok, `1` error, `3` the user must act (sign in or complete a ChatGPT
verification / add a slot), `4` every ready slot stayed busy past `--wait-ms`. A failing
`prodex ... ask` is always `1`, with its own code written to stderr, so its code can never
pass for `3` or `4`. A browser that cannot be started or probed is `1`, not `3`.

`run` forwards the ask's stdout (the model reply) unchanged. Redirect it to a file and keep it
out of shared logs. Claims store only a random owner id, the pid and a start time, never a
`--session-key` or any conversation text.

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

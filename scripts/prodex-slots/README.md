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

- `list`: state of each slot and any live claim. States: `ready`; `busy` (logged in, still
  generating a reply, so `run` waits for it); `down` (browser not running); `needs-login`;
  `hidden` (window minimized or behind another tab, Prodex cannot send until it is visible);
  `unknown`. Only `ready` slots take new work.
- `add --count N`: registers N more slots, opens their windows and reports which need a login.
- `ensure`: reopens slots whose browser is not running; a profile that is still logged in
  becomes `ready` with no user action.
- `run [--slot N|auto] [--wait-ms 600000] -- <ask args>`: claims a ready, idle slot, runs
  `prodex pro browser ask` with that slot's `PRODEX_CDP_PORT` / `PRODEX_SEND_LOCK_FILE`, then
  releases the claim. `--port` must not be passed. `--slot N` never falls back to another slot.
- `release --slot N`: removes a claim (only needed if a recycled pid keeps a dead claim alive).

Exit codes: `0` ok (or the ask's own code), `1` error, `3` the user must act (log in / add a
slot), `4` every ready slot stayed busy past `--wait-ms`.

## How an agent uses it

1. Estimate how many Prodex jobs will run at once. If that exceeds the ready slots from
   `list`, **ask the user** to approve N more slots; do not add them on your own.
2. After approval run `add --count N`. Exit `3` means the user has to sign in to ChatGPT in the
   opened window(s); tell them which slot numbers, then run `list` until they are `ready`.
3. Dispatch with `run --slot auto`. Exit `3` again means ask the user; exit `4` means wait or
   ask for more slots.
4. A claim only steers jobs onto idle slots. Prodex's own per-slot lock remains the guard
   against two sends touching one tab.

## Limits and unverified points

- Each slot is a separate logged-in browser: one manual login per slot, kept in its profile
  (verified: killing the slot's browser processes and reopening it stayed logged in; a reboot
  is not verified). Memory and CPU grow with the slot count.
- Several simultaneous logged-in browsers on one ChatGPT account may meet rate limits or
  verification prompts; not observed so far, not guaranteed.
- ChatGPT's model slider may be remembered per profile or per account. Always pass `--effort`
  explicitly for real work, and restore the level after tests.
- Test runs create chats in the user's account; mark them as tests and let the user delete them.
- `list` only sees claims made through this tool, not sends started with plain `prodex`.

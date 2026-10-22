# Prodex automatic ChatGPT archive (#94)

Archive is a finish-time action, NOT a callback after a single assistant reply. It
removes a finished task chat from ChatGPT's sidebar without deleting the history.
Do not archive conversations needing continuation, recovery, review, or scheduled-task results.

The tool only acts on threads explicitly owned by a Prodex task. It does not search
personal chats. It uses the already-open exact thread in an idle, visible Prodex tab,
never creates a browser or navigates a tab, and refuses uncertain UI.

## Finish procedure

1. Recover the exact Prodex request if necessary with its thread URL/request ID.
   Verify request_verified: yes, then finish reviews, delivery and the Issue Handoff.
2. Confirm the thread has no pending work. Post an Issue comment containing these
   seven separate literal lines with the actual values:

       Archive-ready: true
       Task: #94
       Thread-SHA256: <64 lowercase hex characters>
       Request-ID: <verified Prodex request ID>
       Reply-verified: true
       Artifacts-saved: true
       No-followups: true

   Make the SHA256 from the local canonical thread URL. Do not copy its raw URL to GitHub:

       node -e "const c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(process.argv[1]).digest('hex'))" "$THREAD"

   Replace 94 with the actual Issue. Copy the resulting GitHub comment URL ending
   with #issuecomment-ID.
3. Run finish, specifying the slot CURRENTLY displaying that exact thread:

       node scripts/prodex-archive/cli.mjs finish --task 94 --slot 2 --thread-url "$THREAD" --request-id "$REQUEST_ID" --handoff-url "$COMMENT_URL"

   The tool uses signed-in gh to fetch and validate the real Handoff comment, claims
   the slot, takes Prodex's per-slot send lock, verifies an idle thread and an empty
   composer, finds its specific sidebar menu, clicks only Archive/归档, then checks
   that the sidebar link disappears. It never clicks Delete.
4. If confirmation fails, check ChatGPT Settings > Data controls > Archived chats
   BEFORE retrying. The click may already have succeeded.

## Status, keep and retry

       node scripts/prodex-archive/cli.mjs status --thread-url "$THREAD"
       node scripts/prodex-archive/cli.mjs skip --task 94 --thread-url "$THREAD"
       node scripts/prodex-archive/cli.mjs retry --task 94 --slot 2 --thread-url "$THREAD" --request-id "$REQUEST_ID" --handoff-url "$COMMENT_URL"

The per-user journal is at ~/.local/share/prodex/archive/statuses.json, or under
PRODEX_SLOTS_HOME. It stores only a SHA256 of the URL, the task, slot, timestamp,
status and a sanitized failure reason; no raw thread URL or reply text. States:
pending, failed, skipped, archived. Archived is idempotent. Retry explicitly
overrides skipped.

The ordinary run command continues to release its short-lived slot claim when one
ask finishes. At FINAL THREAD closure, use finish instead of another manual release.
Archive status is separate from slot closure. A failed UI archive does not
intentionally hold the claim; a failed Handoff check never takes a claim.

## Safety and limitations

- The GitHub Handoff must explicitly attest readiness, exact thread hash and request
  ID. This checks the real comment, but no tool can infer whether the agent's assertion
  of "no more work" is true. The dispatcher is responsible.
- Active/unknown competing claims, held send lock, wrong/hidden tab, unsent draft,
  pending generation, missing thread row or ambiguous Archive menu block the action.
- Mouse input is generated using fresh DOM element positions, not fixed coordinates.
  No hidden ChatGPT APIs, cookies, credentials, prompts or responses are read/stored.
- The adapter recognizes visible Archive/归档 labels. Other languages and page updates
  may require adapting the UI selectors. A manually operated browser is not tracked.
- If a click result is uncertain, the status is FAILED until inspected; never
  blindly repeat the click after request_mismatch, crash or a browser navigation.
- Do not bypass login, CAPTCHA, rate limits or verification prompts.
- Real account/browser validation is still REQUIRED by #94 and cannot be performed
  through GitHub MCP. Until then the actual UI workflow is UNVERIFIED.

Archive unit tests: `pnpm archive:verify` (also included in `pnpm verify`).
Slot regression: `pnpm slots:verify`.

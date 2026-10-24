# Account usage ownership

`platform::accounts` reads accounts independently of transcript ingestion. Each
provider has one non-overlapping background job. Network and child-process waits
do not hold the Runtime mutex. A completed reading updates the shared cache and
wakes the application collector; every native window receives that projection.

The implementation follows the original Swift account readers:

| Provider     | Existing source                                     | Read operation                                                       |
| ------------ | --------------------------------------------------- | -------------------------------------------------------------------- |
| Claude       | Installed Claude Code and its current account       | SDK `get_usage`, hooks disabled, `skip_behaviors`, no prompt         |
| Codex        | Installed Codex and its current account home        | `initialize`, `account/rateLimits/read`, `account/read`, no turn     |
| Pi / ChatGPT | Existing, unexpired Pi OAuth home                   | Official ChatGPT usage endpoint; no OAuth flow or credential rewrite |
| Cursor       | Read-only Cursor account SQLite database            | Current usage-summary endpoint and billing-cycle reset               |
| DeepSeek     | Harness settings and versioned credential reference | Official API balance endpoint and response currency                  |
| Antigravity  | Already-running authenticated language server       | Loopback `GetUserStatus`; no application or service launch           |

The client retains only projected account identity/plan, percentages, reset
times, balances and fixed diagnostics. Authentication tokens, headers, raw responses and
credential documents are never sent to React or included in error messages.
HTTP redirects are disabled. Missing or expired authorization remains explicit;
installation detection does not imply an available quota reader.

The Antigravity loopback client bypasses system proxies and accepts the local
service's self-signed certificate only for a fixed `127.0.0.1` endpoint discovered
from that service's process. External account requests retain normal TLS checks.

The default native launch reads real accounts. Explicit `--demo` skips the real
runtime and all account jobs. Closing Settings or opening a second HUD does not
start another account reader.

Quota observations and complete per-call usage are persisted in Next's own
SQLite ledger. The five picker measures use separate facts: the current share
used, the current cycle's sampled burn, output tokens per active reply span,
observed cycle consumption, and the model list-price estimate. Reply spans never
bridge logs or idle gaps over 120 seconds. Currencies remain separate.

Source-reported counts take precedence over inferred token consumption. Unknown
cycle boundaries, model mappings or price entries stay explicitly unavailable.
An initial burn series reports its actual sampling progress rather than a rate.
The price catalog is a port of the original app's snapshot; this migration does
not assert that every vendor's current list price has been independently refreshed.

Existing original history is read without launching or modifying the original
app. Quota samples require exact provider/account/window identities. Transcript
facts require matching source paths, parser codecs, file signatures and completed
retained-history state; business event IDs stay stable for incremental updates.
The original retained history is not described as all-time coverage. Ineligible
files keep their bounded incremental replay and an explicit coverage state.

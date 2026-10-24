# Platform boundary

`NativePlatform` supplies local directories, client discovery, native process operations, file-change notifications and account-reader jobs. Core owns transcript parsing, session state, deduplication, SQLite accounting and derived metrics. Account adapters share one set of provider protocols, response parsers and scheduling rules across hosts.

`src/os/mod.rs` selects exactly one host implementation with compile-time `target_os`:

| Host module | Responsibilities | Verification |
| --- | --- | --- |
| `src/os/macos/` | Application Support and bundle paths, LaunchServices, original ledger locator, executable lookup, local process inspection, Finder reveal | Existing live Mac readers retained; this refactor is compile/fixture checked |
| `src/os/windows/` | USERPROFILE/AppData paths, native `.exe` lookup, hidden child-process flag, Explorer reveal | Runtime unverified; Antigravity service discovery unsupported |
| `src/os/linux/` | XDG paths, desktop files, executable lookup, `/proc` executable identity, local process inspection, directory reveal | Runtime unverified; `ps`/`lsof` must be available for Antigravity |

Each host explicitly chooses `source_roots`. The current native Claude/Codex on-disk layouts are shared by `portable_cli_roots`; WSL, Windows Store and other container-specific layouts need their own host adapter. A detected installation does not imply that its sessions or account format have been migrated.

`NativePlatform::capabilities()` reports `validation`, per-reader verification, Antigravity availability and legacy-Mac-history availability. Windows/Linux portable Claude, Codex, Cursor and DeepSeek adapters remain usable: real successful results can become ready, while the platform remains `unverified`. This status is separate from authentication and quota availability. Windows engine connections currently require a real executable; detection of a `.cmd`/`.ps1` installation alone does not turn it into an account protocol connection.

The account engine's JSON-lines protocol, bounded reader, deadlines, child ownership and cleanup stay in `accounts/engine.rs`. Provider identity, credentials, parsing and deduplication stay in `accounts/`; shell scripts do not make those decisions. Mac-specific dependencies such as `plist` are target-scoped in Cargo.toml. This crate contains no LAN/remote transport.

The editable command sources in `scripts/macos/` and `scripts/linux/` contain only fixed OS operations. They are embedded with `include_str!` at build time: edit the source and rebuild the corresponding host target. There is no runtime script-path setting or hot reload. Arguments such as paths, UIDs and PIDs are separate argv values; they are never interpolated into script source. Process inspection remains bounded and runs only at the existing account-job cadence, not on each HUD/input poll. Raw process output may contain a token and is never logged.

Explorer is invoked directly with one literal argv value. PowerShell `-Command` would reinterpret trailing text, so a shell wrapper is intentionally avoided for that operation.

Build/check the platform crate with the host toolchain and corresponding Rust target, for example from the repository root:

```sh
cargo check -p agent-hud-platform --target aarch64-apple-darwin
cargo check -p agent-hud-platform --target x86_64-pc-windows-msvc
cargo check -p agent-hud-platform --target x86_64-unknown-linux-gnu
```

These commands check this crate, not desktop packaging. A foreign target also needs its Rust standard library and native C toolchain for bundled SQLite/TLS dependencies. Only the Mac host was built during this refactor; Windows/Linux builds and runtime QA remain pending.


## Original Mac preference seed

`NativePlatform::legacy_preferences()` is a single read-only, Mac-only startup adapter. It reads the public `settings.v1`, `agents.v5` and `panelLayout.v2` JSON Data values from the original persistent defaults domain, and returns normalized `settings` plus `presentation`. Windows/Linux return no legacy seed. `Runtime::new_with_preferences(data_dir, read_accounts, initial_settings)` passes the app settings to Core's absent-file-only seed; the host seeds its own presentation owner only when its target is absent. Existing targets, including damaged ones, are not overwritten. Old defaults and credentials are never written.

The seed retains stable display UUIDs, saved current layouts, supported placement/glow values, public app preferences, original disabled live/reminder choices, provider order, quota row order and switches, and the hidden-account blacklist (including absent accounts). Third-party/unknown/private fields, credentials, previous layouts and drafts are discarded. The original four expanded-panel switches carry only their `false` values into every saved layout. Layout-specific order takes priority, then the original provider and row order. Hidden account identities remain a blacklist rather than becoming a list of today's visible accounts. Fully disabled API groups stay hidden without disabling collection; a mix of enabled/disabled model consumer rows inside an API balance still has no exact per-model balance representation. Alias identities not present in the acquired account facts cannot be guessed.

Pure isolated fixtures cover these conversions and preserve the main Runtime's immediate transcript reminder plus three 500ms signature followups. The reminder path uses Core's existing targeted reader/ledger and does not consume the ordinary watcher queue or list unrelated sources. No fixture touched real defaults or installed client configuration.

## Explicit hook ownership and native interaction

The canonical product host must explicitly delegate its fixed executable before hook installation. `set_enabled` changes only owned client entries using pure provider formatters and safe I/O; shutdown stops the channel and observers without uninstalling user configuration. Pi/OpenCode observers publish lifecycle facts to the same coordinator. Antigravity native permissions use only already-running, verified loopback services, revalidate the exact pending permission before a once-only response, and report uncertain delivery instead of claiming success. DeepSeek's native web question observer remains pending. No adapter starts a client or performs a new login.

Windows hooks/local tools share the current-user/SYSTEM-only named-pipe primitive with remote clients rejected. Direct Windows executable/argument installation formats exist for Claude and Copilot, and the documented Windows command override is used for Codex; unsupported client contracts return explicit errors. Actual Windows module API cross-checks passed, while a full Windows application build and native runtime behavior remain unverified. macOS Antigravity conversation navigation uses bounded local CDP on a running application and confirms the target before activating it; other hosts return a specific unsupported result.

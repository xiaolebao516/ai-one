# Platform build entry points

Build orchestration lives in `src/tooling/build.mjs`; root package scripts only reference it. Application parsing, deduplication, state, and metering do not belong in build scripts. The tool invokes the existing Cargo/Tauri workspaces and does not alter their configuration or install prerequisites.

Use Node.js 24+, the host Rust toolchain, and the dependencies installed by `pnpm install --frozen-lockfile`. Native desktop dependencies must be installed on the actual target operating system. These entry points deliberately build only for their matching host OS; they are not cross-compilation or release-qualification claims.

## Commands

Run from the Next repository root:

| Host | Desktop executable, release profile, no installer |
| --- | --- |
| macOS | `pnpm run build:macos` |
| Windows | `pnpm run build:windows` |
| Linux | `pnpm run build:linux` |

`pnpm run desktop:build` selects the current host and retains the same release/no-bundle default as before. All platform aliases accept the following flags after npm's `--`:

```sh
pnpm run build:macos -- --debug
pnpm run build:windows -- --component engine
pnpm run build:linux -- --bundle
pnpm run build:platform -- --platform macos --print-plan
```

Use the command matching the current host. For example, `build:windows` on macOS fails before starting pnpm, Cargo, or Tauri, with instructions to use a Windows host. An unsupported OS, component, or flag also fails explicitly. `--bundle` applies only to desktop builds and delegates host package generation to Tauri; prerequisites, signing configuration, or packaging failures remain real failures.

`--print-plan` prints the selected commands without running build tools or checking installed prerequisites. It still validates the requested platform against the current OS. It is an inspection feature, not evidence that the build would succeed.

`pnpm run engine:build` retains its debug default and output at `target/debug/agent-hud-engine` (`.exe` on Windows), which the development MCP client expects. Use `pnpm run engine:build -- --release` for the release engine. With no custom Cargo target directory, the release output is `target/release/agent-hud-engine`. `CARGO_TARGET_DIR` retains standard Cargo behavior; update `AGENTHUD_NEXT_ENGINE` when choosing a different installed/output path. This tool does not silently redirect an existing MCP client.

The runner checks the Rust compiler's host OS before compiling and rejects a differing `CARGO_BUILD_TARGET`. It does not add a cross target or pass `--target`, preserving the existing Cargo output layout. Cross-architecture/universal builds are not provided by these aliases; use an appropriate build host/toolchain and qualify that artifact separately.

`pnpm run build` still performs the existing React build and MCP type checks. It does not compile a native executable. The desktop build runs the existing Tauri frontend pre-build hook and embeds the shared Rust runtime. The separate engine is needed for the standalone MCP/development transport, rather than as a second desktop collector.

## Host prerequisites and limitations

| Platform | Native build requirements | Current qualification boundary |
| --- | --- | --- |
| macOS | Xcode command-line tools/Apple SDK and the native Rust toolchain. Tauri uses the system WebView. | macOS implementation is being checked on real hardware; building alone does not certify window, animation, signing, or updater parity. |
| Windows | Visual Studio C++ Build Tools with the Windows SDK, a supported Rust toolchain, and WebView2 runtime for execution. | Not validated on a Windows host in this migration. Do not treat a generated command plan as a working Windows build or installer. |
| Linux | The distribution's C/C++/linker tooling and Tauri 2 desktop dependencies, including WebKitGTK 4.1/GTK and required tray/SVG/packaging libraries. Package names vary by distribution. | Not validated on a Linux host. Wayland edge HUD and native Linux drag remain unsupported in the current capability report; a successful build does not remove those limitations. |

The installed Tauri CLI reports missing native dependencies. Current prerequisites are maintained in [Tauri's official platform instructions](https://v2.tauri.app/start/prerequisites/); use the instructions for the actual host rather than attempting to satisfy a Windows/Linux build from macOS.

## Type-checking another host's adapters

A type check is not a build and proves nothing about behavior, but it catches
an adapter that no longer matches the shared code. On macOS, the Windows
adapters type-check with the MinGW cross compiler:

```sh
brew install mingw-w64
rustup target add x86_64-pc-windows-gnu
cargo check --workspace --tests --target x86_64-pc-windows-gnu
```

The Linux adapters need GTK/WebKit development libraries and are checked in
CI on a Linux runner.

## Shared readers and OS-specific operations

Provider reader protocols and the parsing, usage attribution, deduplication, and metrics remain shared Rust implementation. Filesystem locations, credential access, installed-client discovery, process invocation, and native actions differ by OS and belong to the platform adapters. A shared reader is not proof that its Windows/Linux credential/path/process integration has been verified.

Platform helper scripts are editable source assets inside the platform crate and are compiled into its adapter. After editing a system helper, rebuild the component on that system; there is no runtime script override or hot reload. Build tooling itself contains only build/tool/OS orchestration and must not acquire provider parsing or accounting logic.

These commands do not launch the application, change client hooks, configure external MCP clients, copy files into `/Applications`, or publish a release.

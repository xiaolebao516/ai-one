# Notices

## ai-one

The application code in this repository is derived from [Multi-AI Chat Desktop](https://github.com/TED-H-com/multi-ai-chat-desktop) by Ted Huang, imported as a file snapshot of commit [`6bcf904dfce890f7ebe198cbfc329bf8d685ce62`](https://github.com/TED-H-com/multi-ai-chat-desktop/tree/6bcf904dfce890f7ebe198cbfc329bf8d685ce62) (tag `v1.9.7`), under the [MIT License](./LICENSE). The upstream copyright and permission notice is kept unchanged in `LICENSE`.

Every imported file was byte-identical to that commit at import time (ai-one commit "import Multi-AI Chat Desktop snapshot at 6bcf904"). Later ai-one changes are recorded in this repository's history.

Not imported from upstream:

- AI-Sister character artwork in `src/assets/themes/ai-sister/` and the upstream website `site/`. Upstream licenses this artwork to its own project only, not under MIT. The theme images in this repository are ai-one placeholders; see [`src/assets/themes/ai-sister/NOTICE.md`](./src/assets/themes/ai-sister/NOTICE.md).
- Upstream GitHub configuration that would act on this repository or point to the upstream project: `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/`, `.github/dependabot.yml`, `.github/workflows/pages.yml`, `.github/workflows/release.yml`, `SECURITY.md`.
- Upstream `README*.md`, replaced by the ai-one `README.md`.

## Agent HUD Open (quota HUD, `agent-hud/`)

The directory [`agent-hud/`](./agent-hud) contains source copied from [Agent HUD Open](https://github.com/jazzenchen/agent-hud-open) (`jazzenchen/agent-hud-open`), commit `5c1f93e9457cb0f5fd3d69042144ffa63e51851b`, under the [Apache License 2.0](./agent-hud/LICENSE). The upstream license text is kept unchanged in `agent-hud/LICENSE`. The upstream project's own third-party notices (shadcn/ui, Shaders, React Bits, provider artwork, Clawd sprites) are in `agent-hud/docs/third-party.md` and next to the files they cover, and still apply.

Per Apache-2.0 section 4(b), every file we changed is listed in [`agent-hud/UPSTREAM.md`](./agent-hud/UPSTREAM.md), and a change is marked with an "ai-one change" comment wherever the file's syntax allows comments (JSON cannot; the two lock files carry a header comment that a tool may drop when it rewrites them, so UPSTREAM.md is the record for those); files we added (for example `agent-hud/src/apps/desktop/src-tauri/src/export.rs`) say they are ai-one additions. The upstream `lan` crate (iPhone / Apple Watch remote) and `apps/mcp` (built-in MCP server) are not copied.

Provider logos under `agent-hud/src/packages/hud/src/assets` keep their own owners' branding and notices (LobeHub icons: MIT, see `LobeIcons-LICENSE.txt` there); they are not covered by this repository's license. Anthropic's Clawd sprite table (`clawd-sprites.json`) is copyrighted by Anthropic and is **not included** here: we have no permission to redistribute it.

## Multi-AI Chat Desktop (upstream notice)

Multi-AI Chat Desktop is distributed under the [MIT License](./LICENSE).

Portions of this project adapt MIT-licensed ideas or implementation patterns from:

- [`teddashh/multi-ai-chat`](https://github.com/TED-H-com/multi-ai-chat)
- [`tony1223/better-agent-terminal`](https://github.com/tony1223/better-agent-terminal)

The repository history and study notes retain more detailed provenance where applicable.

## Source Serif 4 (bundled font)

`src/assets/fonts/source-serif-4/source-serif-4-latin-wght-normal.woff2` is the Latin subset of Source Serif 4 (Copyright 2014–2023 Adobe, with Reserved Font Name ‘Source’; SIL Open Font License 1.1), taken unmodified from the npm package `@fontsource-variable/source-serif-4` 5.3.1. The licence text is in `src/assets/fonts/source-serif-4/OFL.txt`. It is used for display and reading text in the v2 workbench (#105).


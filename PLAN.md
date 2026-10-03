# PLAN — Muse Spark for VS Code (unofficial)

A VS Code extension that lets a developer sign in and use Meta's **Muse Spark**
model as a coding agent inside the IDE, with a chat experience at feature parity
with the official Claude Code VS Code extension (webview chat panel, slash
command palette, model/effort pill, permission modes, streaming markdown, diff
review, session history, rewind).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` deferred.

---

## 1. Assumptions

| #   | Assumption                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                | Reversal cost                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A1  | Stack: TypeScript, Node ≥ 22, npm 11, esbuild bundling, React 19 webview.                                                                        | The VS Code extension API is TypeScript-first; esbuild is Microsoft's documented bundler; React is the de-facto webview framework and what the Claude Code extension appears to use.                                                                                                                                                               | Medium (webview components are React-specific). |
| A2  | Package manager is npm with `package-lock.json`, exact version pins (`save-exact=true`).                                                         | npm 11.19 is installed; pnpm is not. Exact pins make "latest" impossible by accident.                                                                                                                                                                                                                                                              | Trivial.                                        |
| A3  | Extension is **unofficial** and must say so in its name, README and marketplace listing.                                                         | Meta Model API ToS / AUP forbid implying Meta endorsement; "Muse Code" and "Muse Spark" are Meta trademarks.                                                                                                                                                                                                                                       | None.                                           |
| A4  | Publisher id `RandyNorthrup` (confirmed 2026-09-22 on marketplace.visualstudio.com/manage: existing publisher, one extension already published). | The marketplace shows the publisher as RandyNorthrup; the URL form is lower-case.                                                                                                                                                                                                                                                                  | None.                                           |
| A5  | License: MIT.                                                                                                                                    | Standard for VS Code extensions; matches `@muse-code/sdk`.                                                                                                                                                                                                                                                                                         | Trivial before first release.                   |
| A6  | Settings/command namespace `museSpark.*`, view container id `museSpark`.                                                                         | Mirrors `claudeCode.*` structure users already know.                                                                                                                                                                                                                                                                                               | Low (rename before first release).              |
| A7  | CI provider: GitHub Actions.                                                                                                                     | `gh` CLI is installed; repo will live on GitHub.                                                                                                                                                                                                                                                                                                   | Low.                                            |
| A8  | Target VS Code `^1.99.0` (September 2026 stable is 1.138.0; `^1.134.0` until 0.1.1, `^1.125.0` until M62).                                       | Needs only long-stable APIs. M62's audit: the host typechecks against every `@types/vscode` from 1.85 on, and 1.99 is the first release on Node 20.18 and Chromium 132, which the host and webview bundles target. Tested in VSCodium 1.99.3 and code-server 4.99.4 (VS Code 1.99.3), which refused the 1.125 floor (`docs/certification/m62.md`). | Trivial.                                        |
| A9  | Pre-commit hooks via **husky + lint-staged**, not the Python `pre-commit` tool.                                                                  | `pre-commit` is not installed; a Node project should not require a Python toolchain to commit. gitleaks is invoked directly from the husky hook.                                                                                                                                                                                                   | Low.                                            |
| A10 | **Fully cross-platform (owner requirement 2026-09-22):** Windows, macOS and Linux are all first-class. Windows is the primary dev machine.       | CI matrix runs the full gate set on ubuntu, windows and macos; every OS-specific path (binary discovery, process spawning, paths, line endings) has a unit test per platform branch. Meta documents the `muse` CLI for macOS and Windows; Linux users fall back to the Model API backend if the CLI is unavailable there (Q6).                     | None.                                           |

## 2. Resolved decisions

### D1 — Two backends behind one internal agent protocol, Muse Code (MSP) first

Research (2026-09-21, see §5) established that Meta offers **no OAuth, device
code or "Login with Meta" flow for third-party applications**. The only two
sanctioned ways to reach Muse Spark are:

1. **Meta Model API** — bring-your-own API key, `https://api.meta.ai/v1`,
   OpenAI-compatible Responses / Chat Completions and Anthropic-compatible
   Messages endpoints. Pay-as-you-go.
2. **Muse Code CLI** — Meta's closed-source coding agent (`muse`). Its
   browser sign-in and **subscription** are "for use with Muse Code only". Meta
   publishes an official SDK, `@muse-code/sdk`, that spawns `muse serve` and
   speaks the Muse Session Protocol (MSP, NDJSON JSON-RPC over stdio). Driving
   the CLI this way inherits whatever credential the CLI holds.

The owner's request is to "log in and use Muse". Only path 2 has a login.
Path 2 is also exactly the architecture of the Claude Code VS Code extension
(extension host drives a bundled/installed CLI over a stdio JSON stream), and
MSP already exposes every primitive the parity checklist needs: model catalog,
reasoning effort, approval modes and approval requests, user-input dialogs,
todo lists, context/token usage, session list/resume/fork/rename/compact,
structured edit diffs, skills, background tasks and subagents.

Therefore:

- `MuseCodeBackend` (MSP via `@muse-code/sdk`) is the **primary** backend and
  the M2–M6 milestones are built on it.
- `ModelApiBackend` (direct HTTPS to `api.meta.ai/v1`, our own tool harness)
  is the **secondary** backend (M7) for users without the CLI, without a
  subscription, or on Linux if the CLI is unavailable there.
- Both implement one internal `AgentBackend` interface and emit one
  `AgentEvent` discriminated union that the webview renders. The webview never
  knows which backend is active.
- Rejected: reimplementing Muse Code's device-code login with Meta's client
  id, or scraping meta.ai sessions. Both contradict the Model API ToS
  ("circumvent access controls", "reverse engineer harnesses") and the
  subscription wording, and community forks report silent breakage.
- **Amended 2026-09-22 (M7, owner ruling): the two credentials never mix.**
  `muse login` stores a subscription-bound key in the CLI's own `auth.json`
  (`obtained_via: device_code`, `mechanism: oauth`; "the subscription applies
  to the Muse Code API key that is automatically connected in the Muse Code
  CLI onboarding process", dev.meta.ai/docs/muse-code/subscriptions) and the
  CLI "uses `META_API_KEY` if set, then a stored key, and only then a stored
  browser session". From M2 to M6 the extension injected the key pasted into
  the panel as `META_API_KEY` for `muse serve`, so with a pay-as-you-go key
  stored the CLI billed subscription work to the key. The child environment
  no longer carries the pasted key (`buildChildEnvironment` has no key
  input; a `META_API_KEY` in the user's own environment is inherited
  untouched, as the CLI documents). The pasted key drives only the Model
  API backend. `museSpark.backend` (`auto` / `museCode` / `modelApi`) picks
  the backend; `auto` takes the CLI when it has its own session, then the
  Model API when a key is stored (`src/core/backendSelection.ts`). Verified
  live with no key anywhere: `scratchpad/live-nokey.log`, in
  `docs/certification/m7.md`.

### D1a — Locating and spawning `muse` per platform (verified 2026-09-22, Muse Code 1.3.0)

| OS                    | Install dir (installer default)                                             | Entry                                                                                            | Beside it                                                                                       | Credential                                                                                   |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Windows               | `%LOCALAPPDATA%\Programs\muse` (added to the user PATH)                     | `muse.cmd` → `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .muse-launcher.ps1 <args>` | `muse-bin-<version>.exe` (~415 MB), `.muse-version`, `.muse-release-info.json`, `.muse-channel` | `%USERPROFILE%\.config\muse\auth.json`                                                       |
| Linux (Kubuntu 26.04) | `~/.local/bin` (`MUSE_INSTALL_DIR` overrides; PATH added to shell rc files) | `muse` bash launcher (33 KB; needs bash, not sh)                                                 | `muse-bin-<version>` (~314 MB), `.muse-version`, `.muse-release-info.json`                      | `$XDG_CONFIG_HOME/muse/auth.json` or `~/.config/muse/auth.json` (`MUSE_AUTH_PATH` overrides) |
| macOS 15.7 (Mac mini) | `~/.local/bin` (PATH added to `~/.zshrc`)                                   | same bash launcher                                                                               | same                                                                                            | as Linux, a token-free pointer; the token in the login Keychain (D26)                        |

Constraints and decisions:

1. Node 22 refuses to `spawn` a `.cmd`/`.bat` without `shell: true` (EINVAL,
   the CVE-2024-27980 hardening); `@muse-code/sdk`'s `spawnMspConnection` on
   `muse.cmd` fails exactly this way (verified). A shell string is banned here
   (D4). On Windows the extension spawns either `powershell.exe` with an
   explicit argument array replicating the shim, or `muse-bin-<version>.exe`
   directly (version read from `.muse-version`). Both were verified end to end
   (§5.4); the direct exe is the default (1.1 s handshake vs 2.0 s, no
   PowerShell in the stdio path) and the launcher path is the fallback that
   keeps Meta's hourly self-update logic.
2. On Linux/macOS the bash launcher is spawned directly (shebang, no shell).
3. The child `PSModulePath` must be sanitised on Windows (M2 hazard note).
4. `muse serve` accepts no provider flag: it always uses the Meta provider, so a
   signed-in CLI (or `META_API_KEY` in the child env) is required even for
   smoke tests. The credential-free `--provider echo` exists only for the TUI
   and `exec`.
5. MSP `initialize` rejects `clientInfo.name` outside `^[a-z0-9_]+$`; ours is
   `muse_spark_code`.
6. Discovery order everywhere: `museSpark.museBinaryPath` setting, then
   `PATH`, then the per-OS default install dir above.

### D2 — Thin, schema-validated HTTP client for the Model API instead of the `openai` npm SDK

The `openai` package (7.20.0) pulls seven optional peers, requires Node ≥ 22
and would ship an entire API surface of which the extension uses three
endpoints. A ~300-line client over global `fetch` with `zod` schemas for
every response boundary is smaller, keeps `no-unsafe-*` lint rules
meaningful, and lets us model Meta's documented deviations (`tool_choice`
only `"auto"`, `reasoning_effort` `none` → 400). Revisit if Meta ships a
first-party SDK. **Amended at M7:** the stream is plain WHATWG server-sent
events (`event:` / `data:` lines), so the planned `eventsource-parser`
dependency was not added; `src/core/backends/modelapi/sse.ts` (80 lines) is
tested on chunk splits inside frames and inside multi-byte characters.

### D3 — Quality toolchain versions (verified against the npm registry 2026-09-21)

| Package                                                                                              | Pinned                            | Why this version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`                                                                                         | **6.0.3**                         | Registry latest is 7.0.2, but `typescript-eslint@8.70.1` declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. TS 7 installs cleanly and silently disables every type-aware lint rule. 6.0.3 is the highest release inside the supported range.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `eslint`                                                                                             | 10.11.0                           | `typescript-eslint` accepts `^10.0.0`; `eslint-plugin-unicorn@76` requires `>=10.4`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `typescript-eslint`                                                                                  | 8.70.1                            | Latest; `strictTypeChecked` + `stylisticTypeChecked`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@eslint/js`                                                                                         | 10.0.1                            | Separate package from eslint; required by the flat config.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `eslint-plugin-unicorn`                                                                              | 76.0.0                            | Latest; needs eslint ≥ 10.4 (satisfied).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `eslint-plugin-react-hooks`                                                                          | 7.1.1                             | Declares eslint `^10.0.0`. `eslint-plugin-react` (7.37.5) and `eslint-plugin-jsx-a11y` (6.10.2) only declare up to eslint `^9`, so they are **not** installed; a11y is covered by manual checks in visual certification and revisited when the plugins add eslint 10 peers.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `dpdm`                                                                                               | 4.3.0                             | Circular-import gate (`--exit-code circular:1`). `madge` is incompatible with TS 6+. `eslint-plugin-import-x` was considered and dropped: its `no-cycle` rule is known not to fire, and unresolved imports are already a hard `tsc` error (TS2307) in every project here.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `knip`                                                                                               | 6.37.0                            | Unused files/exports/deps. Config is `knip.jsonc` (knip 6 rejects `"//"` pseudo-comments). Run without `--strict`: strict implies production mode, which needs `!`-suffixed entries and otherwise analyses nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `prettier`                                                                                           | 3.9.8                             | Formatter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `stylelint` + `stylelint-config-standard`                                                            | 17.15.0 / 40.0.0                  | Webview CSS gate (`--max-warnings=0`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `vitest` + `@vitest/coverage-v8`                                                                     | 5.0.1                             | Unit tests (node env for extension code, jsdom for webview). Peer `@types/node ^22                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |     | >=24` satisfied. |
| `jsdom`                                                                                              | 30.1.0                            | Webview component tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@testing-library/react` / `dom` / `jest-dom`                                                        | 16.3.3 / 10.4.2 / 7.0.1           | Component assertions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@vscode/test-cli` + `@vscode/test-electron` + `mocha` + `@types/mocha`                              | 0.0.15 / 3.1.0 / 12.0.2 / 10.0.10 | Integration tests inside the Extension Development Host. `@vscode/test-electron` is an unlisted peer of test-cli, so knip ignores it explicitly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `esbuild`                                                                                            | 0.28.2                            | Bundles extension (cjs, node platform) and webview (esm/iife, browser platform).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@types/vscode`                                                                                      | 1.99.0                            | Matches `engines.vscode` (test/unit/manifest.test.ts enforces the pairing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `@types/vscode-webview`                                                                              | 1.57.5                            | Types for `acquireVsCodeApi()` inside the webview.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@types/node`                                                                                        | 22.20.4                           | Extension host on VS Code 1.138 is Electron 42 (Node ≥ 22). Typing against 22 keeps code portable to older hosts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@vscode/vsce`                                                                                       | 4.0.0                             | Packaging. Needs Node ≥ 22.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `react` / `react-dom` / `@types/react` / `@types/react-dom`                                          | 19.3.0                            | Webview UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `zod`                                                                                                | 4.6.5                             | Runtime validation of every webview ⇄ extension message and every HTTP/MSP boundary.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@muse-code/sdk`                                                                                     | 1.3.0                             | Official MSP client. Developer Preview: "minor releases may alter APIs before 1.0" → exact pin, adapter isolated in one module, schema fingerprint checked at handshake. Installed with a one-off `--min-release-age=0` on 2026-09-22 (published 2026-09-18, inside the 7-day window); the lockfile pins it so `npm ci` is unaffected. Only its `Connection`/`spawnMspConnection` surface is used; `Connection.onNotification` holds a single handler, so the facade (`MuseClient`) is not composed.                                                                                                                                                                          |
| `husky` / `lint-staged`                                                                              | 9.1.7 / 17.5.1                    | Pre-commit gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `jscpd`                                                                                              | 5.3.1                             | Copy-paste detection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm-run-all2`                                                                                       | 9.0.3                             | Runs gate scripts in sequence/parallel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `rimraf`                                                                                             | 6.1.3                             | Cross-platform clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `axe-core`                                                                                           | 4.13.0                            | The accessibility gate (M37, D32): WCAG 2.0 to 2.2, levels A and AA, run inside the harness page. MPL-2.0; a dev dependency, never bundled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `parse5`                                                                                             | 8.0.1                             | M69 (D49): web fetch parses a page with the HTML standard's own parsing algorithm (the implementation jsdom uses), after four review rounds found a hand-written tokenizer short of it. MIT; one dependency, `entities` ^8 (BSD-2-Clause, 8.1.0 locked, formerly our direct dependency); no peers; published 2026-04-19; already in the lockfile through jsdom and @vscode/vsce; `npm audit` clean. Quadratic on hostile nesting (40,000 nested lists in 73 s), so it runs only in `dist/pageWorker.js`, a worker per page (at most two at once) stopped at 10 s or 512 MiB (D6). `entities` 8 says Node ≥ 20.19 for `require(esm)`; bundled, the worker ran on Node 20.18.3. |
| `html-encoding-sniffer`                                                                              | 7.0.0                             | PR #60: retain HTML BOM/header certainty and tentative meta/XML prescan when upgrading M69's decoder. MIT; no peers; one dependency, `@exodus/bytes` ^1.15.1 (existing 1.15.2 lock unchanged; its optional hash peer is not used by `encoding-lite`); canonical security:audit exits 0, with one later low advisory in existing dev-only serialize-javascript recorded separately. v7 declares Node ^22.13 or >=24; installed on supported tooling Node with no engine bypass, bundled only into `dist/pageWorker.js`. Proved bundled on VS Code 1.99.0 (Node 20.18.3), integration `minimum`. Ships no types: `src/core/web/html-encoding-sniffer.d.ts`.                     |
| `playwright-core`                                                                                    | 1.63.0                            | The host checks' browser driver (hosts.yml, M62): code-server, Theia and JupyterLab driven in Chrome. Apache-2.0; a dev dependency, never bundled; it uses the installed Chrome, never downloads one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `mdast-util-from-markdown` / `micromark-extension-gfm` / `mdast-util-gfm` / `mdast-util-to-markdown` | 2.0.3 / 3.0.0 / 3.1.0 / 2.1.2     | M79: the host reads a plan with the panel's own Markdown grammar (what react-markdown 10.1.0 and remark-gfm 4.0.1 resolve to; no peers; 0 advisories). Its own lazily loaded bundle, `dist/planMarkdown.js` (139.0 KiB with the brief writer, `character-entities` among it), so `dist/extension.js` carries none of it (464.8 KiB after merging `main`, D6).                                                                                                                                                                                                                                                                                                                 |

Deprecated and avoided: `@vscode/webview-ui-toolkit` (archived; npm marks it
deprecated). Webview controls are hand-built on VS Code CSS theme variables.

### D4 — Security posture

- API keys live only in `vscode.SecretStorage`; never in settings, logs, or
  telemetry. (The rest of this row is superseded by the D1 amendment, §9:
  since M7 the stored key is never passed to `muse serve` or any other child
  process; the CLI signs in on its own and the extension reads only the
  structure of its credential file, asking the CLI when that cannot say,
  D26 amendment.)
- Webview: strict CSP with per-load nonce, `localResourceRoots` limited to the
  bundled `dist/webview`, no remote scripts, no `eval`. Every inbound message is
  parsed with a zod schema; unknown shapes are logged and dropped.
- Child processes are spawned with explicit argument arrays, never a shell
  string. The `muse` binary path is user-configurable; when configured it must
  be an absolute path that exists and is a file.
- No telemetry. No network calls except to `api.meta.ai` (M7) and whatever the
  user's own `muse` CLI performs. Amended 2026-09-27 (D49, D50): the pages
  the model reads through web fetch, asked per host (M69); GitHub, through
  VS Code's authentication (M71); the local dev server (M81); and
  `api.typesafe.ai` (M85), experimental and off by default, and off while
  `museSpark.confidentialWorkspace` is on.
- Contributor-tier models are opt-in behind a dialog quoting Meta's training
  wording; off by default; blocked when the workspace setting
  `museSpark.confidentialWorkspace` is true.
- Secret scanning (gitleaks) in pre-commit and CI; `npm audit --audit-level=high`
  in `security:audit`; semgrep locally in `security:sast` (part of `npm run
quality`) and as a CI job.

### D5 — Testing strategy

- **Unit (vitest, node env)**: everything in `src/core/**` (protocol types,
  backends with fake transports, the host ⇄ webview protocol, settings
  mapping, path guards). The `vscode` module is aliased to
  `test/unit/mocks/vscode.ts`.
- **Unit (vitest, jsdom env)**: webview components with Testing Library.
- **Integration (@vscode/test-cli)**: activates the extension in a real VS Code
  (xvfb on CI), asserts commands/views register and the webview posts its
  ready message.
- **Coverage thresholds are gates**: 90 % statements/lines/functions, 85 %
  branches on `src/**` excluding `src/extension.ts` and `src/webview/main.tsx`
  (entry points exercised by integration tests). A threshold flagging an
  unreachable branch means the branch is dead — delete it, do not lower the bar.
- **Every test must be able to fail**: each new assertion is checked once
  against a deliberately broken implementation (recorded in the milestone
  certification checklist).

### D6 — Bundle budgets (Phase 6)

| Artifact                  | Budget (minified, uncompressed)                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dist/extension.js`       | ≤ 600 KiB (the M7 Model API client fit without raising it; the activation bundle since M57)                                                                  |
| `dist/modelApi.js`        | ≤ 400 KiB (M57: the Model API backend, loaded when it first starts; 295.6 KiB when split, see below)                                                         |
| `dist/searchWorker.js`    | ≤ 50 KiB                                                                                                                                                     |
| `dist/pageWorker.js`      | ≤ 300 KiB (M69: web fetch's page converter, parse5 and its parts, on a worker started for each page; 212.3 KiB when split)                                   |
| `dist/webview/main.js`    | ≤ 900 KiB including React, the markdown renderer and highlight.js (one bundle)                                                                               |
| `.vsix`                   | not gated; 0.8.0 is 905,941 bytes (the GitHub Release asset, §10)                                                                                            |
| `dist/acp.js`             | ≤ 850 KiB (the ACP agent, installed once, never loaded by VS Code; 713.2 KiB when set, see below)                                                            |
| `dist/planMarkdown.js`    | ≤ 150 KiB (M79: the plan reader, the panel's Markdown parser, loaded on the first plan action; 139.0 KiB with the brief writer)                              |
| `dist/checkpointStore.js` | ≤ 225 KiB (M72: synchronous checkpoint factory and legacy reader; measured 187.0 KiB plus 15%, rounded up to 25 KiB)                                         |
| `dist/uiText.js`          | ≤ 100 KiB (shared English fallback for Node bundles; 72.7 KiB on the build-only baseline; installed tables remain per bundle)                                |
| `dist/browserCheck.js`    | ≤ 50 KiB (M81: the browser check's pipe, run and processes, loaded on the first check; 37.8 KiB plus 15%, rounded up to 25 KiB; A1 holds it there: 49.8 KiB) |
| `dist/browserRuntime.js`  | ≤ 50 KiB (M81 A1: the browser check runtime's pin, download, ZIP reader and store, loaded only to prepare it; 37.2 KiB plus 15%, rounded up to 25 KiB)       |

`npm run build` prints sizes; `scripts/check-bundle-size.mjs` holds the numbers
and fails the build over budget or when a bundle is missing. This table mirrors
the script and changes with it, with a CHANGELOG entry.

**Amendment (2026-09-30): one English fallback for the Node bundles.**
The build emits `src/shared/l10n/en.ts` once as `dist/uiText.js`. Activation,
the Model API backend, the checkpoint store and the ACP agent require it
beside their bundles; each still owns its mutable installed-language state.
The browser and integration-test bundles retain their inline fallback. The
development build writes the table beside the extension, so the integration
host needs no additional `.vscode-test.mjs` launch option. The VSIX allowlist,
ACP packager and both CI member lists include it. Existing bundle caps stay
unchanged; the table has its own 100 KiB cap and split checks. Runtime proof
and every before/after size are in
[`docs/certification/shared-ui-text.md`](docs/certification/shared-ui-text.md).

**Amendment (M81, 2026-10-01): the browser check is a bundle of its own.**
On the release candidate `dist/extension.js` was 592.3 KiB of its 600 and
`dist/modelApi.js` 398.7 of its 400. The browser check's runner (the CDP
pipe, the run, its processes, 37.8 KiB with the zod/mini it parses with)
loads from `dist/browserCheck.js` on the first check, through the checkpoint
store's loader pattern; activation keeps the loader, the `ide` tool and the
modal, and the Model API bundle the tool's definition, placement and text.
It uses the shared English table like the other Node bundles, and the split
gate keeps the runner out of the other three. With the shared table and M81:
extension 529.6, Model API 335.6, checkpoint store 122.1, ACP agent 719.0,
English table 74.7 KiB ([`docs/certification/m81.md`](docs/certification/m81.md)).
After the RV81 fixes (the policy reads, the target watch, the bounds) the
browser bundle is 44.5 KiB of its unchanged 50, extension 531.2, Model API
336.8.

**Amendment (M81 A1, 2026-10-02): the runtime's acquisition is a second
lazy bundle.** Design spec v4 §9.1 holds `dist/browserCheck.js` at its 50
KiB with the owned proxy, the canaries and the two lifetimes (49.8 KiB),
and moves the runtime's acquisition (the pin's schema, the download, the
bounded ZIP reader, hashing, staging and publication) into
`dist/browserRuntime.js`, required by the activation bundle's adapter only
when a runtime is prepared or verified, for a check and for the Download
command alike. Measured 37.2 KiB minified; its cap is
25 × ceil(1.15 × 37.2 / 25) = 50 KiB. The split gate requires the
acquisition modules in that bundle and in no other, and neither browser
bundle may carry or load the English table (both return closed failures
only). To fit, the browser check's tunables that `constants.ts` declared
with initializers esbuild cannot drop moved to
`src/shared/browserCheckConstants.ts` (no imports), which `constants.ts`
re-exports: one source of truth still, imported directly by the browser
modules.

**Amendment (M57, 2026-09-27): the Model API backend is a bundle of its own.**
At 0.9.0 `dist/extension.js` was 596.8 KiB of its 600 KiB, and
`src/core/backends/modelapi/**` was 180.7 KiB of it (`ModelApiHost.ts` alone
83.5 KiB), loaded at every activation although only a conversation on that
backend uses it. PR #32 and the planned Model API work (web fetch, MCP OAuth,
workflow controls) could not fit. The budget stays 600 KiB; the backend moves
instead.

- **Two host bundles.** `src/host/backend/modelApiEntry.ts` builds to
  `dist/modelApi.js` with the activation bundle's format, platform, target,
  minification and source maps. `ModelApiBackendManager.build()`, the one
  lazy place the host was already built, `require`s it by the path activate
  passes (`dist/` beside `extension.js`, as the search worker's). Its one
  export, `createModelApiHost`, builds the client, the hooks loader, the MCP
  pool and the host from plain values and reads the stored sessions. The
  manager's API and behaviour (the generation fence, a failed build
  forgotten, dispose) are unchanged. A missing or unreadable file fails that
  build in the user's language (`modelApiBundleUnavailable`), and the log
  names the file and the cause.
- **What stays in the activation bundle** (16.2 KiB of the backend's 28
  files): the key client with its schemas and stream parser, and the image
  tools, which Muse Code's `ide` server uses to make images with the key (M44);
  the stored-session format and a session's goal record, which the window's
  session store reads (D14); the schedule store's next occurrence (M52).
  `isProtectedPath` (now `src/core/protectedPaths.ts`), the path confinement
  (now `src/core/workspacePath.ts`) and the goal record
  (`modelapi/goalRecord.ts`) moved out of the backend's modules so that the
  activation bundle takes only them.
- **Two copies of shared code.** Each bundle has its own copy of what both
  import (44 inputs, 129 KiB of `modelApi.js`: the English table, constants,
  zod, the key client…). What that could break was audited (M57): the three
  errors a host throws to the conversation controller are tested by name and
  field (`isGoalRefusedError` and its two siblings in `agentBackend.ts`), not
  `instanceof`, which a lint rule now refuses in `src/`; the display
  language's table and locale are module state, so the factory installs the
  activation bundle's before it builds anything. The rest of the audit is in
  `docs/certification/m57.md`.
- **Budget for `dist/modelApi.js`: 400 KiB**, 295.6 KiB measured plus about a
  third. The Model API work already planned lands here; M50's MCP client
  and M51's hooks are 43.5 KiB of the bundle together, so the margin holds
  two or three milestones of that size before the budget is revisited on
  purpose. The activation
  bundle, now 425.3 KiB, has about 175 KiB under its unchanged 600 KiB.
- **A gate keeps it split.** `scripts/check-bundle-split.mjs` (in
  `npm run build`) reads both metafiles and fails when a file that loads only
  with the backend (the host, its tools, hooks, goals, instructions,
  subagents, memory tools, permission engine, the MCP client: an explicit
  list of 20) or the entry is in `dist/extension.js`, when `dist/modelApi.js`
  stops carrying one of them, or when a file of the folder is on neither the
  lazy list nor the allowed list above.

**Amendment (M79, 2026-09-28): the plan reader is a bundle of its own.**
Reading a plan with the panel's own Markdown grammar (PR #53 review) takes
`mdast-util-from-markdown`, `micromark-extension-gfm` and `mdast-util-gfm`:
114.5 KiB, which would have taken `dist/extension.js` from 448.7 to
563.2 KiB with several milestones' host code still to land. So
`src/core/plans/planMarkdown.ts` is built from `src/host/planMarkdownEntry.ts`
into `dist/planMarkdown.js` (114.7 KiB, budget 150 KiB) and required by
`planMarkdownLoader` on the first Save plan, Implement or Plans…;
`dist/extension.js` is 449.7 KiB. The reader imports no value of
`shared/constants` (that would bring the English table, 58.7 KiB): it
lists, and `planDocument.ts` cuts and caps. There is no fallback without
it: a plan action that cannot load it is refused with
`planMarkdownUnavailable`, since it is what checks for hidden text. The
split gate fails when `dist/extension.js` carries the reader's module, its
entry or any file of the parser's packages (`micromark*`, `mdast-util-*`,
`character-entities`, `decode-named-character-reference`), or when
`dist/planMarkdown.js` stops carrying the reader. Since PR #53's third review
the reader also writes the brief (`mdast-util-to-markdown`, the version
remark-gfm's writer resolves to): 139.0 KiB.
**Amendment (PR #32 joined with M57, 2026-09-27): the ACP agent loads the
same `dist/modelApi.js`.** The agent's runtime (`src/runtime/backends.ts`,
D62) builds a `ModelApiBackendManager` per folder, which since M57 needs a
bundle to require. Two ways were open: the agent requires `dist/modelApi.js`
beside `dist/acp.js`, as the extension requires it beside `extension.js`, or
the entry module is bundled into `acp.js` and handed over with `loadBundle`.
The first was taken:

- **One build of the backend for both packages.** The file the `.vsix` ships
  is the file the agent's npm package ships (`scripts/package-acp.mjs` copies
  it with `acp.js` and the search worker); bundling the entry into `acp.js`
  would have been a second build of the same 20 files, 300 KiB of it.
- **The manager's real path in the agent.** `loadBundle` stays what M57 made
  it, a test's way to hand in the source module; the agent exercises the
  `require` by path, the missing-file message and the log line, which the
  extension otherwise reaches only on the Model API backend.
- **A Muse Code agent never loads the backend**, as a Muse Code user of the
  extension never does.
- **Held by the gates.** `check-bundle-split.mjs` reads the agent's metafile
  (`dist/meta-acp/acp.json`) too and fails when `dist/acp.js` carries a lazy
  file or the entry, so the agent cannot quietly grow a second copy;
  `check-host-api.mjs` lists `modelApiEntry.ts` as portable, so the bundle
  the agent loads never reaches `vscode`; the agent's third-party notices
  take `modelApi.js`'s packages; the stdio e2e suite (and hosts.yml, against
  the installed package on three platforms) runs a Model API turn through
  the package's own `dist/modelApi.js`. The identity audit of M57 applies to
  the agent as it does to the extension: `src/acp` recognises a settled
  prompt with `isPromptSettledError`, never `instanceof`.
- **Measured**: `dist/acp.js` went from 874.1 KiB (the joined tree before
  M57) to 713.2 KiB; `dist/extension.js` is 432.5 KiB and `dist/modelApi.js`
  299.5 KiB, each under its budget.

**Amendment (PR #32 joined with M57, 2026-09-27): the ACP agent's budget is
850 KiB.** Set at M63 to 800 KiB against 718 KiB, and outgrown when M48–M56
reached the agent through the shared managers (874.1 KiB, PLAN.md §7 then).
With the backend in `dist/modelApi.js` the agent is 713.2 KiB; the budget is
that plus about 15 %, rounded up to a multiple of 50 KiB (820 → 850). No
other budget changes.

- **What it holds** (the production metafile, `dist/meta-acp/acp.json`):
  zod 445.2 KiB (62 %), of which 257.6 KiB are its 64 error-message locales,
  exported by the classic API `@agentclientprotocol/sdk` imports and so kept
  by esbuild although the agent never switches locale; zod's core and
  classic API 185.0 KiB; the ACP SDK 53.7 KiB; the English table 58.6 KiB;
  the engine the agent runs (the Muse Code backend and its SDK, the tool
  harness, the conversation's shared code, `src/acp`, `src/runtime`) the
  rest, about 155 KiB. Three of the Model API backend's files, all on
  M57's allowed list, stay in it.
- **Why it is acceptable.** The agent is a process of its own that the user
  installs once with npm and an editor starts; VS Code never loads it, so
  its size adds nothing to the extension's activation, and it is parsed
  once per agent start. What it costs is the download: 175.1 KiB of
  `acp.js` gzipped, and a 597 KiB package (611,034 bytes, with
  `dist/modelApi.js`, the search worker, the 14 tables and the notices).
- **Not taken**: dropping zod's locales. They come with the SDK's own
  import of classic zod; removing them means aliasing or patching a
  dependency's module graph, for a download a user makes once.

### D7 — Permission modes map onto MSP approval modes; prompting modes wait for M4

`muse --help` (1.3.0) names the CLI's own modes `untrusted | on-request |
never` (default `on-request`, LLM approval judge on); `muse serve` selects
the mode on the wire (`session/start.approvalMode`, `session/setApprovalMode`),
closed vocabulary `allowAll | promptUnmatched | onRequest | denyUnmatched`.
The Claude Code vocabulary is mapped in `src/shared/permissionModes.ts`:

| UI mode            | MSP mode          | Note                                                                |
| ------------------ | ----------------- | ------------------------------------------------------------------- |
| Manual             | `promptUnmatched` | ask for everything no rule allows (`untrusted`)                     |
| Edit automatically | `promptUnmatched` | + the extension auto-answers file-edit approvals (M4)               |
| Plan               | `denyUnmatched`   | read and reason only                                                |
| Auto               | `onRequest`       | the CLI default: judge-reviewed, prompt only on need                |
| Bypass permissions | `allowAll`        | listed only while `museSpark.allowDangerouslySkipPermissions` is on |

`approval/requested` is a notification the host waits on; until M4 renders it,
any prompting mode would hang the turn, so `HAS_APPROVAL_UI = false` collapses
Manual / Edit automatically / Auto to `denyUnmatched` (M2 behaviour) and only
Plan and Bypass differ. Flipping the constant is an M4 change with its own
live verification of each mode.

The mode button opens a **Modes** menu (title, `⇧ + tab to switch` hint, one
row per mode with the Claude Code description adapted to Muse, a tick on the
current one, and an `Effort (level)` row with the dots in the footer); Shift+Tab
still cycles. Bypass permissions is gated the way the Claude Code extension
gates it: the `allowDangerouslySkipPermissions` setting adds it to the menu and
the cycle, and the host refuses `bypassPermissions` (with a notice) while the
setting is off, including as `initialPermissionMode`, which then starts in
Manual with a logged warning. The modal confirmation from the first M3 cut was
replaced by this setting on 2026-09-21 (owner request for parity).

### D10 — Effort tiers offered per model (verified live 2026-09-21)

`model/list` carries no per-model effort information and
`session/setReasoningEffort` only checks the closed vocabulary, so the tiers a
model serves can only be learned by running a turn per tier. The probe
(`scratchpad/live-effort.ts`, one "Reply with OK" turn per tier per Standard
model, contributor tiers skipped) is recorded in `docs/certification/m3.md`.
Outcome: `muse-spark-1.3` completes turns at every wire tier (`none` …
`ultra`); `muse-spark-1.2` completes `none` … `xhigh` and fails `max` and
`ultra` with the API's 400 `reasoning_effort 'max' is not supported for model
'muse-spark-1.2'. Supported values: [minimal, low, medium, high, xhigh]`. The
error for `ultra` names `max`, so the CLI forwards `ultra` as `max`. The UI
therefore offers `minimal` … `max` on 1.3 and `minimal` … `xhigh` on 1.2
(`EFFORT_LEVELS` and the per-family table `MODEL_EFFORT_LEVELS` in
`constants.ts`; unknown families get the full range); `none` is the Thinking
toggle and `ultra` is not listed because it is `max` on the wire. Switching to
a model that does not serve the current tier drops the tier to the highest
one it serves, so a stale `max` cannot fail every 1.2 turn. Every dot names
its tier in a tooltip and to assistive technology.

### D11 — Transcript wire facts (live captures 2026-09-21/22, Muse Code 1.3.0)

Everything the transcript renders was shaped by two raw MSP captures
(`scratchpad/live-capture.mjs`, `live-capture2.mjs`; notifications verbatim in
`docs/certification/m4.md`) rather than by the schema alone:

- Tool vocabulary on Windows: `write_file {content, path}`, `read_file
{path}`, `edit_file {find, path, replace}`, `powershell {command,
description}` (`bash` elsewhere), `request_user_input {questions}`. Args are
  verbatim JSON strings; `visibleOutput` carries the result text (`read_file`
  numbers lines, `edit_file` emits a headerless unified diff, `write_file`
  reports bytes). Edit-family calls add `patchSummary {files, added, removed}`
  and a `patchRef` whose body (`item/readOutput`, `application/json`) is
  `{files: [{path, hunks: [{oldStart, oldLines, newStart, newLines, lines}]}]}`.
- `reasoning` items never appeared at any effort tier for the M3/M4 capture
  prompts, so the row was built from the schema (`summary.N` deltas, `text`)
  and fake-tested. They **did** appear in the shell-tool turns of the
  2026-09-22 live check (`itemStarted reasoning` → `summary.0` / `summary.1`
  deltas such as "Executing a PowerShell command to read …" →
  `itemCompleted`), so the row is now live-exercised (m4.md).
- `promptUnmatched` does **not** prompt for in-workspace file tools; only
  shell commands (and anything else policy leaves unmatched) raise
  `approval/requested`. A write outside the workspace is refused outright
  (`path escapes workspace`), no approval involved.
- Approvals are **multi-stage**: `a; b` is two stages. Deciding stage 0
  returns `terminal: false` and the host sends `approval/updated` with the
  next `currentRequirementId` and choices; ignoring it hangs the turn (the
  first probe did). The card follows `approval/updated` and shows "step n of
  N" from `subject.stages`. Choices seen: `allow_once` (approved, once),
  `allow_local_prefix` (approvedPolicyAmendment, localPersistent, with
  `rulePreview` "Always allow in this workspace: <argv[0]> ..."), `abort`
  (Reject, accepts feedback).
- `userInput/request` and `approval/request` also arrive as JSON-RPC server
  requests; the SDK facade treats the notification as the enrolled surface.
  Refusing the server request and answering with `userInput/answer` /
  `approval/decide` settles the prompt (`userInput/settled: answered`), so the
  host declines those two quietly.
- Shell tools need Muse Code's OS sandbox. Until the owner ran the elevated
  `muse sandbox windows setup` (2026-09-22), `muse sandbox windows check`
  reported `setup_required` (`sandbox users are not ready`) and every
  `powershell` call failed with `environment failure: sandbox enforcement
unavailable: windows_elevated setup_required`. The extension now handles
  this itself (D12).
- The host can repeat `approval/updated` for a stage the user has already
  decided (seen live 2026-09-22: decide stage 0 → `approval/updated` stage 1 →
  decide stage 1 → `session/statusChanged` → `approval/updated` stage 1
  **again** → `approval/resolved`). A second `approval/decide` for that stage
  is rejected (`approval … is already resolved`), so the card locks the
  decided stage (`decidedSourceIndex`) until the requirement index changes or
  the approval resolves. Pipelines count as stages too: `a | b; c | d` asked
  four times (M5 live edit turn), with the last stage repeated.
- On Windows the stored patch document names files with the extended-length
  prefix (`"path":"\\?\C:\muse-live-ws\notes.md"`, M5 live edit turn), not
  the relative `notes.md` of the M4 fixture; anything resolving those paths
  strips `\\?\` / `\\?\UNC\` first (`EditReview`).
- The model also uses a `search {glob, output_mode, pattern}` tool (M5 live
  edit turn); MCP tool calls from a session server arrive as
  `toolCall` items named `mcp__<server>__<tool>` and are gated by
  `approval/requested` in prompting modes like any unmatched tool.

### D12 — The extension sets up Muse Code's Windows sandbox itself (2026-09-22)

`muse sandbox` has only `windows check` and `windows setup` (verified on
Windows and on the Linux VM; Linux and macOS need no setup). `check` prints
`key=value` lines (`backend`, `status`, `reason`, `runner_path`,
`sandbox_users_ready`, `capabilities_ready`, `wfp_ready`, `diagnostic=…`) and
exits 1 while `status=setup_required`. `setup` needs elevation: it creates
the `MuseSandboxUsers` local accounts, their capabilities and a Windows
Filtering Platform rule, with credentials under `C:\ProgramData\muse`; on the
owner's machine it ran non-interactively in about one second and the
re-check reported `status=ready`.

The owner's decision: future users must not hit the failure by hand, so the
extension owns the flow (`src/core/backends/musecode/sandbox.ts` pure,
`src/host/backend/sandboxSetup.ts` orchestration, wired in `extension.ts`):

- When a chat surface opens on Windows, run the check once per extension
  host; on `setup_required` show a warning notification with **Set up now** /
  **Not now** / **Don't ask again** (the last is remembered in the
  extension's own `globalState`, never in machine configuration).
- **Set up now** relaunches the same CLI the backend spawns through Windows
  PowerShell `Start-Process -Verb RunAs -Wait -PassThru` (the UAC prompt),
  then re-runs the check and reports "ready" or the remaining `reason`. A
  declined prompt surfaces as a non-zero exit with the PowerShell error line.
  Output cannot cross the elevation boundary, which is why the re-check is
  the source of truth.
- A shell tool failing with `sandbox enforcement unavailable` re-offers the
  setup even after "Not now" (the user is hitting it now); the transcript
  notice names the command palette entry.
- **Muse Spark: Set Up Shell Sandbox** runs the same flow on demand and says
  when nothing is needed (already ready, or not Windows).
- The extension never runs the setup silently: elevation always goes through
  the OS prompt, on the user's click.

**Known CLI limitation (1.3.0, verified live 2026-09-22, m4.md "Sandbox
working directory")**: for a workspace under `C:\Users\<user>` the sandboxed
shell cannot traverse the profile folder, so commands start in
`C:\Windows\System32\WindowsPowerShell\v1.0` after a ~34 s wait (about five
minutes on the sandbox account's first logon); `muse exec` shows the same, so
it is not the extension's spawn. Workspaces outside the profile (verified
`C:\muse-live-ws`) run in place in about a second. The controller posts a
one-time notice on Windows when the workspace is under `%USERPROFILE%` and the
server version is 1.3.0 or older; file tools are unaffected. Reported
upstream as meta-models/muse-code-sdk#26 (2026-09-22); the extension will
not touch profile ACLs (the owner ruled that out, and the auto-mode
classifier refused the experiment too).

**Resolution — `museSpark.shellSandbox` (2026-09-22).** The owner's ruling:
change how the sandbox is used, never the user's folder permissions. Muse
Code's own knobs, verified against the same profile workspace with the same
headless prompt: `muse exec --disable-sandbox` runs the command in the
workspace (`C:\Users\<user>\muse-live-ws`) in 14 s end to end;
`--enable-shell-tool` (the legacy shell) still lands in PowerShell's folder
after 65 s. `muse serve --disable-sandbox` exists as a host-lifetime
posture ("Sandbox posture (fixed for the host's lifetime)"), and approval
mode stays on the wire, so the approval cards keep gating every command —
which is exactly Claude Code's model (no OS sandbox, permission prompts).
The setting has three values: `auto` (default; the sandbox except for a
Windows workspace under the user profile, `resolveShellSandbox` →
`profileWorkspace`), `muse` (always), `off` (never). The manager passes
`serveArguments(posture)` into the launch, logs the posture at spawn, the
controller posts one notice per session explaining an `auto` switch-off
(or the wrong-folder warning when `muse` is forced), the sandbox setup
offer is skipped where the window will not sandbox, and a change of the
setting drops the host so the next message respawns it (a notice says so).
Caveat from the CLI docs, kept in the README: without the sandbox Muse
Code's file tools may write outside the workspace, so the approval modes
matter more.

### D8 — Attachments live in the host; images are validated by header parsing

Pasted or dropped images cross postMessage once (base64) into an
`AttachmentStore` owned by the conversation controller; the webview only
shows chips. Width, height and media type come from the file's own header
(`src/core/imageDimensions.ts`: PNG, GIF, JPEG SOF scan, WebP VP8/VP8L/VP8X),
which is what the MSP `image` part needs and what refuses non-images with a
reason. Limits: 10 MiB per image, 20 per message.

### D9 — Mention index from `git ls-files`, VS Code file search as fallback

`workspace.findFiles` honours `files.exclude` but not `.gitignore`, and the
`findFiles2` API that does is still proposed. With `museSpark.respectGitIgnore`
on, the index runs `git ls-files --cached --others --exclude-standard -z` in
the workspace root (git's own ignore semantics), falls back to `findFiles`
with a logged warning when git is missing or the folder is not a repository,
and is capped at 20 000 paths, cached for 15 s and invalidated by a
create/delete file watcher. Ranking is a deterministic fuzzy scorer
(`src/core/fuzzy.ts`), file-name matches winning over folder matches.

### D13 — Workspace context (rules, skills, memory) follows Muse Code's own conventions and VS Code's workspace trust (2026-09-22)

The owner asked whether the agent "will use the skills properly and
AGENTS.md and memory". The answer had to be established, not assumed, and
it came out in two halves.

**What Muse Code does (read from the CLI's help, its `skills` command and
the strings of `muse-bin-1.3.0-R3401.1.exe`; nothing here is guessed):**

- `muse serve --trust-workspace`: "Load each session workspace's skills and
  rules". Without the flag the host skips both: `muse skills list --source
project` without `--trust-workspace` returns no rows and the diagnostic
  `project-skills-untrusted: project skills skipped because workspace is
untrusted`; with the flag the same workspace lists `.agents/skills/shout`.
  The rules loader prints the matching warning ("rules file at … exists,
  but the workspace is untrusted, so it is skipped for this session").
- Rules: the workspace `AGENTS.md` is the project rules file; `CLAUDE.md`
  is read only when `AGENTS.md` is absent in that directory ("… is ignored
  this session because AGENTS.md takes precedence in that directory").
  Rules files may sit in subdirectories: the preamble the CLI gives the
  model reads, verbatim, "Muse Code loaded standing rules at session open.
  Follow higher-priority instructions first. If user and project rules
  conflict, project rules win. If project rules files conflict, the deeper
  file wins over the shallower one." Each file has a byte load limit
  (skipped over it, with a warning to trim or split it) and the whole rules
  context has a byte limit (truncated over it, with a warning). A user
  rules file exists in the config root (`/rules import` writes it) but its
  file name is not printed anywhere reachable (Q9).
- Skills: project skills live at `.agents/skills/<id>/SKILL.md` (front
  matter `name`, `description`; `user-invocable` is the one other key the
  bundled skills use), personal skills in the managed root
  `$XDG_CONFIG_HOME/muse/skills/<id>` (else `~/.config/muse/skills`),
  bundled skills in the CLI's plugin cache. `~/.claude/skills`,
  `~/.codex/skills` and `~/.agents/skills` are import sources for `muse
skills import`, not load roots (a "personal skills fallback" setting can
  admit compatible ones). `muse skills list --json` reports a per-skill
  `context_cost.startup_bytes` of about the description's size: the
  catalogue (name and description) is in the model's context from the
  start and the body is loaded on demand through the `read_skill` tool or
  a typed `/skill` invocation, which the host expands.
- Memory: project memory is `<repo>/.agents/memory` with `MEMORY.md` as
  the index ("one line per note, `- [Title](file.md) | hook`"), read at
  session start as the "startup memory snapshot", with line and byte
  limits on the index; personal memory is the CLI's own, private store.

**What the extension did:** `serveArguments` produced `serve` or `serve
--disable-sandbox` and never `--trust-workspace`, so **every CLI session
the extension started since M1 ran with the workspace's rules and project
skills skipped**; the `skill/list` rows the palette showed were the bundled
and personal ones only. The M6 live capture's `reminderChild` items were
the bundled plugins' reminders, not rules (the trace logs count
`reminders=6` from `plugin_capability_snapshot.compose`), which is why the
gap went unnoticed. The Model API backend had a fixed system prompt, no
skills (a `/skill` went to the model as typed text) and no memory, as M7
recorded.

**Decision.** VS Code's workspace trust is the one switch, on both
backends, because it is the contract VS Code already makes with the user
about what an extension may load and run from a folder:

1. **Trusted workspace**: the CLI is spawned with `--trust-workspace`; the
   Model API backend loads the same things itself: the rules files (root
   `AGENTS.md`, else `CLAUDE.md`; a subdirectory's file is loaded the
   first time a tool touches a path beneath it, and deeper files come later
   in the prompt so they win), the project skills and the personal Muse
   skills (catalogue in the instructions, body through a new `read_skill`
   tool or a `/name arguments` invocation expanded by the host), and the
   project memory index. The preamble sentence is Muse Code's own.
2. **Restricted Mode**: neither backend loads rules, skills or memory, and
   neither runs shell commands (the CLI gets `--disable-shell`; the Model
   API tool set omits the shell tool). VS Code's rule for Restricted Mode
   is that an extension must not execute code from the workspace, and a
   model that has read the workspace composing a command line is exactly
   that. The manifest declares `capabilities.untrustedWorkspaces.supported:
"limited"` with `restrictedConfigurations` for `museSpark.museBinaryPath`
   and `museSpark.environmentVariables` (a workspace's settings must not be
   able to point the extension at another executable), and
   `virtualWorkspaces: false` (the CLI and the tools need a real file
   system). Granting trust restarts the hosts (`onDidGrantWorkspaceTrust`),
   as a sandbox setting change already does.
3. **Not loaded on the Model API backend**, each for a reason: the bundled
   plugin skills (they are the CLI's and instruct the model to run `muse`
   subcommands and `read_skill` on `bundled:` ids), personal memory (the
   CLI's private store), the user rules file (Q9), and the foreign-harness
   skill fallback (Muse classifies each candidate against a compatibility
   profile and quarantines the rest; reproducing that classifier is out of
   scope). The README's backend table says so.

Muse Code owns all of this on the CLI backend; the extension only passes
the trust flag. On the Model API backend the extension is the host, so it
mirrors the conventions above and no others: no invented file names, no
`MUSE.md`.

**Plans (M79, 2026-09-27).** The saved-plan location is Muse Code's own,
not the extension's. It was read from `skills/plan/SKILL.md`, the `plan`
skill bundled in `muse-bin-1.4.0-R4302.1.exe`, under "Explicit File Output":

- "If saving and no stronger convention exists, save to
  `.agents/plans/YYYY-MM-DD-<slug>.md`";
- "When creating a new dated file and the chosen file exists, add a short
  numeric suffix";
- "If you save a plan file, its content must be exactly the canonical
  body".

The extension follows all three. It does not follow the skill's
precedence for a stronger convention (an active `specs/<feature>/plan.md`,
a `docs/plans/` folder), which is the model's judgement, not a fixed
name. The skill's delivery form is the other half:

- a plan reply starts with "This is a plan, not a special mode; I haven’t
  started implementation. Reply `go` to execute this plan, or tell me what
  to change.";
- it ends with the second sentence repeated;
- the user's next message ("go") is the approval.

A live capture of a Plan-mode turn on Muse Code 1.4.0 showed exactly that
reply as an ordinary `agentMessage`, with no plan item and no approval
request (docs/certification/m79.md). The extension saves the text between
those two lines; any other reply is saved whole.

### D14 — Production hardening set for 0.2.0 (2026-09-22)

The owner's brief after D13: "fully enterprise grade and production ready
… robust and have all of the needed features for a production ready app".
An audit of the tree against what a VS Code extension that spawns
processes and edits files needs, and against the repository conventions
of a maintained open-source project, produced this list; each item is
either done in M11 or recorded as deferred with its reason.

| Area               | Finding (2026-09-22)                                                                                                              | Action                                                                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace trust    | No `capabilities` block; the agent ran shell commands in Restricted Mode and loaded nothing differently.                          | D13: `untrustedWorkspaces: limited` + `restrictedConfigurations`, `virtualWorkspaces: false`; trust gates rules/skills/memory and the shell on both backends.                                                                                                                                                    |
| Remote hosts       | No `extensionKind`; VS Code defaults an extension with `main` to the workspace host, but the choice was implicit.                 | Declare `extensionKind: ["workspace"]`: the CLI, the tools and the workspace files are on the remote; the dictation helper then runs there too, which the README's voice section states as the remote limitation.                                                                                                |
| Webview crash      | A render error in React unmounts the whole panel and leaves it blank, with the cause only in the developer tools.                 | An error boundary around the app that shows the message and a **Reload** button (posts `hostAction: reload`; the host re-creates the webview's HTML).                                                                                                                                                            |
| Model API sessions | Live for the window only (M7/M8): a reload loses the conversation, the patches behind Open diff / Revert and the history list.    | A JSON session store under `context.storageUri` (per workspace): replay items, transcript, todos, name, model, effort, approval mode, patches; `session/list`, resume and fork read it; the store is a dependency of the host, so the core stays free of `vscode` and `fs`.                                      |
| Support tooling    | The log channel exists (secrets redacted) but there is no command to open it, and no way to collect the facts a bug report needs. | `Muse Spark: Show Logs` and `Muse Spark: Diagnostics` (writes to the log and opens it: versions, platform, backend, CLI path and version, sign-in and key presence as booleans, sandbox posture, dictation helper, workspace trust). Nothing secret is ever written.                                             |
| Release pipeline   | Publishing was by hand from a CI artifact with a PAT from the clipboard; no GitHub Release was created until the owner noticed.   | `release.yml` on `v*` tags: the shared build (`build.yml`, `workflow_call`, used by `ci.yml` too) produces the `.vsix`, the release job creates the GitHub Release with the `.vsix` and the CHANGELOG section as notes, and a publish job runs `vsce publish` only when the `VSCE_PAT` repository secret exists. |
| Repository hygiene | No `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue or pull request templates, `dependabot.yml` or `CODEOWNERS`.     | All added under M11; Dependabot for npm and GitHub Actions weekly, grouped, with the pinned-SHA actions kept pinned.                                                                                                                                                                                             |
| Telemetry          | None, by design (`docs/PRIVACY.md`).                                                                                              | Unchanged; the Diagnostics command is the support path instead.                                                                                                                                                                                                                                                  |
| Localisation       | English strings in `UI_TEXT`; no `package.nls.json`.                                                                              | Deferred: no second language is planned; the strings are already in one table.                                                                                                                                                                                                                                   |
| Multi-root         | The first workspace folder is the root (as the Claude Code extension does).                                                       | Unchanged; documented in the README requirements.                                                                                                                                                                                                                                                                |

### D15 — Harness parity: what the Claude Code extension preconfigures that we did not (2026-09-22)

The owner asked whether the files the Claude Code extension ships
preconfigured hold things this extension should have. The installed
extension (`anthropic.claude-code` 2.1.278: its manifest, walkthrough,
settings schema and README) and `muse init --dry-run` (the CLI's own
scaffold, no model call) were read against our manifest. Findings and the
decision for each; everything marked "M12" ships in 0.3.0.

| Area                       | Claude Code                                                                                                                                                                                                                                                                                                         | Muse Spark Code before M12                                                                                                                                                             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setting scopes             | `scope: machine` on `environmentVariables`, `allowDangerouslySkipPermissions`, `initialPermissionMode`, `claudeProcessWrapper`: a repository's `.vscode/settings.json` can never set them.                                                                                                                          | No scope on any setting; `restrictedConfigurations` only kept two keys out of Restricted Mode, so a trusted clone could enable Bypass or point `museBinaryPath` at its own executable. | M12: `scope: machine` on `museBinaryPath`, `environmentVariables`, `allowDangerouslySkipPermissions`, `initialPermissionMode`, `shellSandbox` and `backend` (a repository must not choose what runs or what is billed). `restrictedConfigurations` is dropped: a machine-scoped setting has no workspace value to restrict. `untrustedWorkspaces` stays `limited` (owner's call; Muse Code's own Restricted Mode model). |
| Editor tabs after a reload | `onWebviewPanel:` activation and a `WebviewPanelSerializer`; the tab comes back on its conversation.                                                                                                                                                                                                                | `activationEvents: []`, no serializer: every editor-tab conversation vanished on Reload Window; only the sidebar's ten-minute rule existed.                                            | M12: the webview stores its session id with `setState`; `onWebviewPanel:museSpark.chatPanel` plus a serializer rebuild the tab and resume that session once signed in. No new setting: Claude's `continueAfterReload` continues an interrupted step, which MSP cannot do for a host that is gone.                                                                                                                        |
| Walkthrough                | A four-step "Get started" walkthrough with images, opened by VS Code on install.                                                                                                                                                                                                                                    | None (the empty state's onboarding tips only).                                                                                                                                         | M12: `contributes.walkthroughs` with four steps (what it is, open the panel, sign in, chat and sessions) and `Muse Spark: Open Walkthrough`; the sign-in step completes on a `museSpark.signedIn` context key the auth service maintains.                                                                                                                                                                                |
| Commands                   | New Conversation (optional Ctrl+N), Reopen Closed Session, Logout, Open in Terminal, Open Walkthrough, Show Logs, Focus/Blur, Update.                                                                                                                                                                               | No New Conversation, Sign Out, Open in Terminal or walkthrough command; sign-out only in the panel's menu.                                                                             | M12: `museSpark.newConversation` (Ctrl+N behind `enableNewConversationShortcut`, off by default as in Claude Code), `museSpark.signOut`, `museSpark.openInTerminal` (the `muse` TUI in a VS Code terminal at the workspace root), `museSpark.openWalkthrough`, and `museSpark.createRulesFile` (below). Reopen Closed Session and Update have no counterpart (no closed-tab register; VS Code updates the extension).    |
| Keybinding hygiene         | Every chord carries a `when` clause (`editorTextFocus`, the panel id, a sidebar context key).                                                                                                                                                                                                                       | Four of five chords global; `Ctrl+Alt+F` fired in any editor.                                                                                                                          | M12: `Alt+K` only with `editorTextFocus`; `Ctrl+Alt+F` and `Ctrl+N` only while a Muse surface is active (`activeWebviewPanelId == 'museSpark.chatPanel'                                                                                                                                                                                                                                                                  |     | focusedView == 'museSpark.chatView'`, VS Code's own context keys, no custom one). `Ctrl+Esc`stays global (it toggles both ways) and`Ctrl+Shift+Esc` stays global as in Claude Code. |
| Rules file scaffold        | (Claude Code: `/init` writes CLAUDE.md through the model.)                                                                                                                                                                                                                                                          | Nothing; the README explains the files.                                                                                                                                                | M12: `Muse Spark: Create AGENTS.md`: opens the file when it exists; otherwise runs `muse init` (the CLI's own scaffold, no model call, in a trusted workspace with the CLI present) or writes the same template itself (Model API only, or Restricted Mode), then opens it.                                                                                                                                              |
| Model API system prompt    | (Claude's harness: an environment block with the date, cwd, platform and git state, and behaviour rules.)                                                                                                                                                                                                           | Tool descriptions, the D13 context; no date, no git state, no working rules.                                                                                                           | M12: a `# Environment` section (today's date, git branch, change count, recent commits, gathered once per session by the host with `git`, absent without a repository) and a `# How to work` section (read before editing, edits over rewrites, no commits or pushes unless asked, short answers with `path:line` references, stay within the ask). The CLI backend keeps Muse Code's own prompt.                        |
| Not adopted                | Proposed-diff accept/reject in the editor (Muse applies edits, review is after, D11), worktrees (no MSP method), plugin install, terminal mode, the settings-schema `jsonValidation` (Muse publishes no settings schema), `disableLoginPrompt`, `lockEditorGroups`, `scrollToBottomOnSend`, `usePythonEnvironment`. | —                                                                                                                                                                                      | Recorded here so the next audit does not repeat the reading.                                                                                                                                                                                                                                                                                                                                                             |

### D16 — Production-readiness verification and its findings (2026-09-22)

The owner asked for proof of "an enterprise production grade app fully
tested e2e including red drills, no legacy code or fallbacks, no dead or
orphaned code, no todos or fixmes or workarounds or monkey patches". The
tree was checked marker by marker; what held and what did not:

| Check                    | Finding                                                                                                                                                                                                                                                          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markers                  | No TODO, FIXME, HACK, workaround, monkey-patch or legacy markers in `src`, `test`, `scripts`, `native` or the workflows.                                                                                                                                         | Nothing to do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Fallbacks                | Every "fallback" in `src` is a logged, documented behaviour (invalid setting → default with a warning; no git → VS Code file search; a context file that fails → warning; Bypass disallowed → Manual). One type-only unreachable branch in `nextPermissionMode`. | M13: `availablePermissionModes` returns a non-empty tuple, so the wrap-around is a real branch and the type-only one is gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Escape hatches           | Exactly the four `nosemgrep` lines of §8; no `eslint-disable`, `ts-ignore`, `any` or non-null assertion in `src`. Two `as unknown as` casts in a test, building fakes of two classes.                                                                            | M13: the controller depends on `AuthPort` and `DictationHandle` (the member sets it uses), so the fakes need no cast.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Dead and orphaned code   | knip, dpdm and jscpd clean. `scripts/measure-markdown.mjs` (an M4 measurement) was wired to nothing and needed a gitignored scratch entry to run.                                                                                                                | M13: deleted; its numbers stay in `docs/certification/m4.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Dependencies and secrets | Every dependency pinned exactly; `npm audit` 0; gitleaks clean over the history; `temp/` ignored and untracked.                                                                                                                                                  | Nothing to do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Red drills               | Every milestone record carries break-on-purpose proofs; 113 failure-path unit tests (corrupt files, malformed messages, host death, 429/500/503, timeouts, declined UAC, oversized files, the webview crash boundary).                                           | Kept; M13 adds process-level drills (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Coverage holes           | `toolIo.ts` shell child error and stderr paths, `MentionMenu` mouse handlers, `StatusLine` timer, `EffortSlider` mouse-down were untested. `searchWorker.ts` reads 0 % only because it runs on a real worker thread in its test.                                 | M13: tests for each.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| End-to-end               | **The hard gap.** The integration tests ran the extension in a real VS Code but never a conversation: the CLI backend bills the subscription per run and the Model API key is gone. Live turns had been manual scratch runs, recorded, not repeatable.           | M13: a fake Muse Code CLI (`test/e2e/fake-muse`: an NDJSON MSP host over stdio; a Node shebang script on POSIX, a C# stub compiled by the .NET Framework's own compiler on Windows) driven through the real backend manager as a real child process, covering a turn, approvals, refusal by mode, bypass, cancel, history, usage, and the drills (host dies mid-turn, malformed frame, a binary that will not start, no binary). Plus one opt-in live turn (`MUSE_LIVE_E2E=1`, `npm run test:e2e:live`) on the real CLI with the model-attempt count read from the CLI's trace log for the session and a budget of 40 (measured 31: one attempt answers, thirty are the CLI's three bundled reminder agents, even in an empty workspace; the marker string used since the cost incident never matched a line, so earlier "attempt" counts measured nothing, see m12.md's correction). |
| Owner's screenshot       | Claude Code's user message carries one button that opens "Fork conversation from here / Rewind code to here / Fork conversation and rewind code"; ours showed an inline "Fork from here" button and had no rewind.                                               | M13: the same menu; "Rewind code to here" reverts every completed edit after the message, newest first, through the existing edit review, and reports the count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Still human              | Tab restore after Reload Window, walkthrough rendering, Ctrl+N, Restricted Mode banner, Diagnostics output, boundary Reload.                                                                                                                                     | Owner F5 checks; listed in `docs/certification/m12.md` and `m13.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**2026-09-27, the Model API end to end.** With a key again (0.9.0), the
Model API backend has a live sweep of its own: `npm run test:e2e:live:modelapi`
(`MUSE_LIVE_MODEL_API=1`), the production backend against Meta's real API,
one case per feature, contributor tier only, every request counted and a
$0.50 stop. Opt-in and never in CI, like the CLI drill. Its first run and
the defect it found are in `docs/certification/release-0.9.0.md`.

### D17 — Subagents, the Agent map, the Account & Usage modal, and the smaller parity gaps, in one milestone (2026-09-22)

The owner asked for four things in the same evening and then said "stop
splitting it into many different milestones, just do it all in one go":
a default that makes Muse ask choices through a picker, an Account & Usage
modal like Claude Code's (centred over the chat, dimmed behind), subagent
support with the "N agents" pill and the Agent map, and the smaller gaps
they noticed (the unsupported-file banner, the compact button, cache
facts). Findings and decisions:

| Area                    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Choices as pickers      | Muse answered a choice in prose where the panel could show a picker; the card appears only when the model calls its `request_user_input` tool.                                                                                                                                                                                                                                                                                                            | A standing note rides on every CLI turn as a hidden text part (the M5 mechanism, `displayText` keeps the typed text): ask through `request_user_input` when offering options. The Model API prompt says the same about `ask_user`. Steering, not forcing.                                                                                                                                                                                                                                   |
| Muse Code subagents     | Native subagents exist on the wire (`subagent` items: role, objective, child session id, control status, transitive usage, result; `subagent/*` commands; child approvals projected onto the parent) and the model has `subagent_spawn`, `subagent_wait`, … tools. **Off by default**: Muse Code 1.3.0 hides them unless `run.subagent_delegation_mode = "auto"` in its own settings file. The model decides when to delegate; nothing ties it to effort. | The extension renders subagent rows, the "N agents" pill and the Agent map (this conversation, its agents with role, objective, status, duration and tokens, the background tasks, an agent's own transcript through `session/read` of its child session). It reads the CLI's settings file to say when delegation is off and opens that file on request; it never writes it. The Model API backend spawns no agents.                                                                       |
| Background tasks        | A `toolCall` the CLI durably backgrounds arrives as `item/updated` with `background: true` and who backgrounded it.                                                                                                                                                                                                                                                                                                                                       | A "background" badge on the row and a list in the Agent map.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Account & Usage         | Ours hung from the header with the plan and two bars. Claude's is a centred modal: account facts, bars, and "what's contributing to your limits" from the machine's local sessions.                                                                                                                                                                                                                                                                       | A shared `Modal` (backdrop dims the chat; Escape, the button and the backdrop close it). Account: auth method, plan, backend, CLI version, model. Cost: on the Model API, dollars from Meta's published per-token prices (standard vs contributor tier, read 2026-09-22) as an estimate, plus the cache-hit rate. Insights: from the CLI's trace logs on this machine, day or week: the share of model attempts from Muse's reminder agents, from subagents, from sessions active 8+ hours. |
| Prompt caching          | The Model API backend already sends a per-session `prompt_cache_key`; the CLI caches on its own. Meta does not document the cache lifetime, so a "warm for N minutes" countdown would be a guess.                                                                                                                                                                                                                                                         | No warming. The cache-hit rate is shown; the rest is documented in the README.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Unsupported uploads     | A rejected upload was a transcript notice; Claude shows a composer banner naming the supported types and the path hint. Muse's turn input takes text, image and skill parts only.                                                                                                                                                                                                                                                                         | The banner, above the box, dismissible: images as uploads; other files as `@` mentions, or an absolute path for files outside the workspace.                                                                                                                                                                                                                                                                                                                                                |
| Compaction              | `/compact` existed; the context indicator was static. Muse reports usage, window and a pressure level, no auto-compact threshold.                                                                                                                                                                                                                                                                                                                         | The indicator is a button ("click to compact now"), its tooltip carries the pressure level.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Usage insight heuristic | A trace log is one `muse serve` process. The turn's own run is named by `runtime.run.lifecycle run_kind="turn"`; every other run in the file is a child the CLI started. A reminder agent registers one tool, a subagent the toolset (1 versus 30, measured).                                                                                                                                                                                             | `classifyRun`: turn, reminder (≤ 2 tools), subagent. Labelled approximate in the modal, as Claude labels its own.                                                                                                                                                                                                                                                                                                                                                                           |

### D18 — The owner's first F5 round on 0.4.0 (2026-09-22, night)

The owner drove 0.4.0 under F5 and reported, one screenshot at a time,
what differed from the Claude Code extension. Findings and decisions:

| Report                                                                                                                                   | Finding                                                                                                                                                                                                                                                                                | Decision                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The models don't load until you click the pill; it has been this way the entire time."                                                  | Only a send, a resume or the pill's skill listing started the host and listed the models, so the pill read "Starting Muse Code…" until the first click.                                                                                                                                | `surfaceReady` (and a completed sign-in) starts the host and lists the models when signed in; one `model/list` in flight at a time so the first send shares it. No model call is involved.                                                                      |
| "Ctrl+N just creates a new file."                                                                                                        | By D15 the shortcut is opt-in (`museSpark.enableNewConversationShortcut`, default off) because Ctrl+N is VS Code's New File.                                                                                                                                                           | Unchanged; the answer is the setting.                                                                                                                                                                                                                           |
| "There needs to be an indicator when there are new messages, with a button to jump to the newest; at the end the scroll should be auto." | The transcript never scrolled itself.                                                                                                                                                                                                                                                  | The transcript follows new entries while the reader is within 24 px of the end and after their own send or a fresh load; scrolled up, it holds still and shows a "New messages" button that jumps to the end.                                                   |
| A red "The decision was not accepted: approval decide settlement failed: approval ledger durability fence…" after an approval that ran.  | Muse Code 1.3.0 on Windows can fail the reply to `approval/decide` on its own ledger write after applying the decision; the tool ran on. The panel reported the CLI's error as a refusal.                                                                                              | A warning that says the CLI reported an error for the decision and the tool may have run anyway. The CLI-side fault joins the Windows `session/rename` and `session/fork` write failures already recorded. Upstream: meta-models/muse-code-sdk#29 (2026-09-23). |
| "There should be a chevron to notify when an item can be expanded."                                                                      | Tool and reasoning rows opened on click with nothing to say so.                                                                                                                                                                                                                        | A chevron at the right of every row that has a body; it turns when open. Rows with nothing to show are disabled.                                                                                                                                                |
| "We need the hover button to copy the contents of the response."                                                                         | Copy existed on code blocks only.                                                                                                                                                                                                                                                      | A Copy button at the foot of each finished reply, shown on hover or focus, copying the reply's markdown; a "Copied" tick for a moment, through the same hook the code-block Copy uses.                                                                          |
| "These responses in Claude are clickable and open the output in the editor."                                                             | Claude Code opens a tool's output as a read-only tab named "Bash tool output (3g790o)".                                                                                                                                                                                                | A shell OUT, read or generic output block opens in an editor on click, Enter or Space: a `muse-output:` document named "`<label>` tool output (`<id tail>`)"; a stored output is paged in full (up to 16 MiB), else the transcript's copy is shown.             |
| "And the coding ones you can expand inline in chat … it expands into an editor … not just read-only either, you can modify."             | Claude Code clips a long inline diff behind "Click to expand", which opens an embedded, editable editor. Embedding an editor in the webview would need Monaco, a third-party package the owner has not authorised, and the real file is already editable in VS Code's own diff editor. | Inline diffs past the preview length are clipped behind "Click to expand": for an edit with a stored patch it opens the same diff editor as **Open diff** (the file side is editable); an edit without one unfolds inline. No embedded editor.                  |

### D19 — The owner's second F5 round, on 0.4.1 (2026-09-22, night)

| Report                                                                                                                                                                                                                               | Finding                                                                                                                                                                                                                                                                                 | Decision                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The pill still does not show the loaded model until after clicked."                                                                                                                                                                 | M15 listed the models at panel open, but the pill reads `state.model`, which only a `sessionInfo` sets, and that was posted when a session started.                                                                                                                                     | The warm-up also posts `sessionInfo` with the model the first send will use (no session id), on every ready while no session exists.                                                                                                                                                                                                                                |
| "In Claude the thinking doesn't stay as expandable" (screenshots of "Thinking…" + summary, then "Thought for 14s")                                                                                                                   | Ours kept a button that expanded the summary parts after the fact.                                                                                                                                                                                                                      | While the model thinks: "Thinking…" with the summary parts streaming beneath. Done: a plain "Thought for Ns" line; nothing to expand.                                                                                                                                                                                                                               |
| "The file links in Claude open the file and highlight the change"; "you have these Open diff and Revert buttons, that's not how Claude handles that"                                                                                 | Ours had two text buttons under an edit row; the path was plain text.                                                                                                                                                                                                                   | The path of an edit or read row is a link: it opens the file and selects the changed lines (from the stored patch, else the visible diff; the first added run, else the first line shown). The buttons are gone; revert stays in the message's rewind menu (M13); the diff editor stays behind "Click to expand".                                                   |
| "We don't need the blue outline for the select-to-open responses."                                                                                                                                                                   | A hover/focus outline on the clickable output block.                                                                                                                                                                                                                                    | Removed; the pointer cursor and the tooltip remain.                                                                                                                                                                                                                                                                                                                 |
| "There is still no inline embed button that expands the code snippet into an editor."                                                                                                                                                | "Click to expand" appeared only past the preview length; Claude Code shows it on every inline diff (screenshot of a five-line diff with it).                                                                                                                                            | "Click to expand" on every edit diff with a stored patch (the diff editor, the file side editable); inline unfolding stays for a clipped diff without one. Shell and edit rows show their body from the start, as Claude Code's do; read and generic rows open on click, with the chevron.                                                                          |
| "The usage report should query when you open it, not need to wait for a chat call."                                                                                                                                                  | It does query (`usage/read`) on open; the CLI answers nothing until it has seen a reply. Re-probed 2026-09-22 with no model call: empty after a host start, after three seconds, after a session start, and five seconds later. There is no other source without using the CLI's token. | The dialog shows the last window the CLI ever reported, kept in extension global state and dated by its own "as of" time, until a fresh one arrives; a fresh one refreshes the cache. Documented as the CLI's limit.                                                                                                                                                |
| "Is this a bug? … approval ledger durability fence … (failed=0, pending=3)"                                                                                                                                                          | Yes, in Muse Code 1.3.0 on Windows: the decision applies, then the CLI's own approval-ledger flush fails and its reply to `approval/decide` carries the error. The panel relays it (M15 wording).                                                                                       | No change; recorded as a CLI fault beside `session/rename` and `session/fork`. Filed upstream on 2026-09-23 as meta-models/muse-code-sdk#29, beside #30 (rename) and #31 (fork).                                                                                                                                                                                    |
| "The question needs to be structured: stacked with checkboxes for multiple answers, radio buttons for single answer, tabbed for multiple questions, always an Other option, Submit and Cancel, Submit greyed out until a selection." | The card showed pill buttons in a row, no Other, no Cancel; Muse Code has `userInput/cancel` (the tool resolves with a cancelled result the model sees) and the answer shape carries `freeText`.                                                                                        | The card is rebuilt as described: native radio buttons or checkboxes stacked, an Other row with a text box on every question (typed text becomes `freeText`), one tab per question with a tick once answered, Submit disabled until every question has an answer, Cancel sends `userInput/cancel`; on the Model API the tool returns "the user declined to answer". |

### D20 — Replying to an output and quoting the chat (2026-09-22, night)

The owner asked for two things: a Reply action in the message actions menu
that "adds the proper context and makes the agent aware that the user is
replying to its output", and the ability to "highlight anything in the chat
and right-click on it to ask a question or make a comment about it with the
proper context payload provided to the agent". Findings and decisions:

| Question                                | Finding                                                                                                                                                                                      | Decision                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How the agent learns what is referenced | Neither MSP nor the Model API has a "reply to message" field; the M5 mechanism already carries hidden context as a text part (`<ide_selection>`) with the typed text kept as `displayText`.  | A `<chat_reference intent="reply\|question\|comment" from="assistant\|user\|tool">` part rides before the editor context: a lead sentence naming the intent and the author ("written by you, the assistant"), then the passage in a fenced block, clipped at 8,000 characters with a note. The transcript shows the typed text plus a chip.        |
| Where Reply lives                       | Claude Code's message menu is on user cards (fork / rewind); replies have a hover Copy. The owner wants a reply action on outputs.                                                           | Each finished reply gets a hover actions menu (⋯) beside Copy with "Reply to this output"; it sets the composer's reference chip ("Replying to: …") and focuses the box. The whole reply text is the payload.                                                                                                                                      |
| Highlight and right-click               | A webview's context menu is the browser's; a right-click can be intercepted only when there is something to offer. Menus positioned by coordinates would need inline styles the CSP forbids. | Right-click with a non-empty selection inside a transcript row (`data-entry-id` / `data-role` on user, assistant and tool rows) opens a small menu at that row's top-right: "Ask about this" / "Comment on this". Without a selection the browser menu is untouched. The selection text, the row's author and id go into the chip and the payload. |
| Several chips                           | The editor-context chip, attachments and a reference can all ride together.                                                                                                                  | One reference at a time (a new Reply or quote replaces it); it clears on send or with its ×, and the sent card keeps a "Replying to: …" / "Asking about: …" / "Commenting on: …" chip.                                                                                                                                                             |

### D21 — The verification round: every screen seen, the live drills run (2026-09-23)

The owner: "finish this project, verify everything with the exception of
the market deploy … and visually verify everything as well." What was done
and what it found:

| Check                                | How                                                                                                                                                                                                                                                                                                                                                                                                             | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every screen, M0–M17                 | The headless-Chrome harness (`npm run harness:shots`): the 30 existing scenarios re-rendered, 14 added for M13–M17 (the rewind menu, the agents pill and map, the map with delegation off, both usage modals, the banner, New messages, a thinking row, the question card on its second tab, the reply menu and chip, the quote menu and chip, a tool approval); each PNG viewed.                               | One wrong text: the usage modal said "the Model API has no local trace logs" on the CLI backend too when no logs were found; now "No Muse Code trace logs were found on this machine yet." Everything else rendered as designed.                                                                                                                                                                                                                                                  |
| Subagents live                       | The drill through the extension's own backend, delegation switched on through a temporary `XDG_CONFIG_HOME` (a settings file plus a copy of the CLI's credential file, deleted after; the owner's config untouched), first in `denyUnmatched`, then in `promptUnmatched` with the spawns allowed.                                                                                                               | **`subagent_spawn` is an approval-gated tool**: the CLI asks (`subject.kind = "tool"`, choices Allow once / Allow for this session / Reject) before spawning; `denyUnmatched` refuses it by policy and the model reports "denied by policy". In the panel's Manual mode the approval card appears and Allow once lets the agent spawn. The card now says "use `subagent_spawn`" and the row is labelled "Spawn agent". Results of the allowed run in `docs/certification/m18.md`. |
| The reply-only drill                 | `MUSE_LIVE_E2E=1 npm run test:e2e:live` on the 0.4.3 build.                                                                                                                                                                                                                                                                                                                                                     | The reply was "OK" in 79 s at 45 model attempts, over the 40 budget set from the single M13 measurement (31). Three measurements now (31, 45, 25 for a turn with two denied spawns): the CLI's three reminder agents loop a varying number of times per turn; the extension adds one hidden text part. Budget 60, the measurements in the drill's comment.                                                                                                                        |
| The integration tests                | `npm run test:integration` in a real VS Code 1.138.0.                                                                                                                                                                                                                                                                                                                                                           | 9 passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A child's items in the parent stream | The allowed drill, every item logged: a subagent's reply and tool calls reach the parent's stream as ordinary `agentMessage` / `toolCall` items whose `turnId` is the child session id (its own turn), so the panel showed the children's replies as replies of the conversation. `session/read` on a child session answers "not found" once the child is done, so the map's transcript read cannot serve them. | The reducer routes any item whose turn is a subagent's child session into that agent's transcript in the map (deltas included); the map shows the result envelope's full text as well. The trace classifier takes the CLI's own `native_subagent.child … child_run_id` marker (a child run is a `run_kind="turn"` too, so the turn flag alone misfiled it as the conversation's).                                                                                                 |
| Owner controls                       | MSP offers `subagent/interrupt`, `stop`, `resume`, `close`, `sendMessage` and `followupTask` (the SDK's `SubagentOwnerReasonParams`, `SubagentInputParams`, `SubagentTargetParams`).                                                                                                                                                                                                                            | `AgentSession.controlSubagent` / `messageSubagent` on both hosts (the Model API refuses: no subagents), the `subagentControl` / `subagentMessage` messages, and the map's controls by state: Interrupt and Stop with a note while running; Resume and Stop when paused; Close and a follow-up task once the result is ready; nothing once closed. The fake CLI answers them for the e2e.                                                                                          |
| The Marketplace                      | Published by hand on 2026-09-23 from the v0.5.0 release vsix (`npx vsce publish --packagePath`, the PAT from the clipboard, never stored); the `VSCE_PAT` repository secret was set the same day (the auto-mode classifier refused `gh secret set` and the browser route; the owner switched permission modes and the same command ran), so the release workflow publishes every later tag itself, 0.5.1 first. | 0.5.0 on the Marketplace; 0.2.0–0.4.3 were never published, each tag's GitHub Release carries its vsix. The three Windows CLI faults went upstream the same day: meta-models/muse-code-sdk#29 (approval ledger fence), #30 (`session/rename`), #31 (`session/fork`).                                                                                                                                                                                                              |

### D22 — Issue #4: the prompt box grows with wrapped lines (2026-09-23)

The first community issue, RandyNorthrup/muse-spark-code#4 (dhaw97160):
"The chat input box only displays a single line. When the input gets a bit
longer, only one line remains visible, which makes editing and reviewing
very awkward." Asked for: one row for short input, growth as lines wrap or
newlines are added, a sensible maximum, internal scrolling past it, the
behaviour of VS Code's own chat view.

| Report                                                                    | Finding                                                                                                                                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Only a single line … when the input gets a bit longer, only one remains" | The textarea's `rows` came from `rowsFor(draft)`, the newline count, so a long line that wrapped stayed one row (M1); newlines grew it, which is why the F5 rounds missed it. | `rowsFor(draft, metrics)` takes the content height in rows when the box can be measured (a browser: `scrollHeight` over the one-row `clientHeight`), else the newline count (jsdom reports 0 for both, which keeps the existing tests meaningful); `fitRows` sets one row, measures and sets the rows, from a layout effect on the draft (before paint) and from a `ResizeObserver` when the width changes (a resized sidebar rewraps). The cap stays `COMPOSER_MAX_ROWS` (ten); past it the textarea scrolls inside. |
| "Match the VS Code built-in chat view"                                    | VS Code's chat input grows to a maximum and scrolls; so does Claude Code's.                                                                                                   | Same shape: one row, growth, ten rows, internal scroll. Verified in the harness: `composer-grow` (a two-line wrapped draft) and `composer-max` (fourteen lines, ten shown).                                                                                                                                                                                                                                                                                                                                           |

### D23 — Rewind across subagents (2026-09-23)

A reader on Facebook asked how the rewind handles state when several
subagents touched overlapping files in one run: per-step diffs, or git
checkpoints rolling the tree back? The code answered the first half (per-edit
patches, unwound newest first, each hunk checked against the file, no git)
and exposed a gap in the second.

| Report                                                                     | Finding                                                                                                                                                                                                                                                                                                                                                                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Does it track diffs per subagent step or roll back the tree?"             | Per edit: every edit row carries the CLI's patch document; `editsAfter` collected the completed edit rows after the message from the conversation transcript and the host reverted them newest first, each hunk matched against the file first (`revertHunks`). Since M18 a subagent's rows live in `childTranscripts`, so `editsAfter` never saw them: a delegated run's edits survived a rewind, silently. | `UiState.sequence`, a monotonic arrival counter; user cards take it as `seq`, tool rows as `completedSeq` when they complete (live, in a child transcript, or replayed from history). `editsAfter(state, messageId)` gathers the completed edit rows of the conversation and of every child transcript whose `completedSeq` is past the message's `seq` and sorts them by it, newest first, so overlapping edits from any agent unwind in the reverse of the order they landed on disk. |
| "Stepping back one agent's change gets messy once later edits build on it" | True, and the design never offered it: the rewind undoes everything after a point (the per-edit Revert button went in M16), and `revertHunks` refuses a file that no longer matches, with a notice, instead of guessing.                                                                                                                                                                                     | No change; the README says so in as many words.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### D24 — The audit: security and confinement (2026-09-23)

The owner asked for a deep scan of the whole codebase and of other
harnesses' trackers for gotchas ("don't cite from memory, do the
research"), then: "fix it all so we have enterprise grade production ready,
no gaps or gotchas, no todos or workarounds or deferrals". Eight read-only
passes (five code sweeps, three research passes over the Claude Code,
Cline, Roo Code, Codex, Kilo Code and Continue trackers, the VS Code
documentation and issues, and the Muse SDK tracker) produced about 150
rows in six sections; the local catalogue is `temp/audit-2026-09-23.md`
(git-ignored until the fixes ship). The work is split by section: M21
(security, this decision), M22 (processes and lifecycle, D25), M23
(protocol, D26), M24 (editing correctness, D27), M25 (webview and UI state,
D28) and M26 (packaging, CI, platform and voice, D29). M25 and M26 were
built in parallel by two agents in their own worktrees under strict file
ownership; M21–M24 share their files and run in order. Section A's rows:

| Report                                                                                         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path confinement is textual only                                                               | `resolveWorkspacePath` compared strings; a symbolic link or junction inside the workspace let every file tool read or write outside it, and reads need no approval in any mode. No `realpath` anywhere in the code. `a.txt:stream` (NTFS alternate data stream) was accepted; `..env` was refused as an escape.                                                                                                                                                                                                                                                                    | `ToolIo.realPath` (`src/host/canonicalPath.ts`: the real path of the nearest existing ancestor plus the missing tail) and `confineWorkspacePath`: the textual check, then the same check on the canonical forms. The tools, the rules loader's `touch`, the search worker (per file) and `EditReview` (before a revert or rewind writes) use it. Windows segments with `:`, device names or a trailing dot or space are refused; `..` is matched as a whole segment.                                                                                                                    |
| git runs in Restricted Mode                                                                    | The mention index and the Model API prompt's environment facts ran `git ls-files`, `status` and `log` in an untrusted folder; `.git/config` can name programs git runs (`core.fsmonitor`, `core.hooksPath`). The manifest said the extension "runs no shell commands" there. Probed 2026-09-23 (Node 24.20, libuv 1.52.1, Windows 11): with `hostname.exe` copied to `git.exe` in a folder, `execFile('git', …, { cwd: folder })` ran the planted copy whenever the parent's environment lacked `NoDefaultCurrentDirectoryInExePath`, and ran it regardless with a `.` PATH entry. | No git while the workspace is untrusted (the index uses VS Code's file search, the prompt says "no git"); the index is rebuilt when trust is granted. `src/core/executables.ts` resolves a program on absolute PATH entries only (`.exe`/`.com` on Windows); `src/host/git.ts` runs git by that path with a 15 s timeout, `windowsHide`, `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0` (a background `git status` never takes the index lock). The shell tool's bash or PowerShell and the Muse Code CLI search are resolved the same way; a relative `museBinaryPath` is refused. |
| Auto writes git hooks without a card                                                           | `isProtectedWrite` was hard-coded `false` on the Model API backend; in Auto (`onRequest`) and after "always allow" every edit ran, including `.git/hooks/pre-commit` and `.vscode/tasks.json`. Roo Code 3.20.3 shipped the same fix ("prevent auto-approving edits of configuration files").                                                                                                                                                                                                                                                                                       | `isProtectedPath` over the canonical path, any depth, any case: `.git`, `.husky`, `.vscode`, `.idea`, `.devcontainer`, `.github/workflows`, `.agents`, `AGENTS.md`, `CLAUDE.md`, `.envrc`, `.gitmodules`. A protected write asks in every mode but Bypass (Plan refuses), session rules never cover it, and the card carries the flag.                                                                                                                                                                                                                                                  |
| A ReDoS in the glob                                                                            | The glob became a regular expression with nested `.*`; `**a` twelve times plus `b` (37 characters) held the extension host for 25 s. §8 had claimed "bounded pieces … short relative paths": that claim was wrong.                                                                                                                                                                                                                                                                                                                                                                 | `compileGlob`: brace expansion (nested, at most 256 alternatives), then a table match over pattern × path, linear in both; no regular expression, so the §8 row is gone. `[!x]` / `[^x]` negate, `]` first in a class is a member, `./` is dropped. Compiled once per call.                                                                                                                                                                                                                                                                                                             |
| "Allow for session" on a shell approves every later command; an unknown choice counts as a yes | Session rules were keyed on the tool name; `decideApproval` treated any choice id but `abort` as approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Shell rules are keyed on the exact command line (the card says which); only `allow_once` / `allow_session` approve, and an unknown id is rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Bypass survives the setting turned off; a dev container can switch it on                       | The setting was read only when a mode was chosen. `devcontainer.json` `customizations.vscode.settings` are written as machine settings on the remote side, where both Bypass settings are honoured.                                                                                                                                                                                                                                                                                                                                                                                | Turning `allowDangerouslySkipPermissions` off moves every controller out of Bypass (and drops a session whose host refuses the change). In a remote window a conversation never starts in Bypass (a notice says why) and entering it needs a modal yes once per conversation.                                                                                                                                                                                                                                                                                                           |
| Resume can adopt a contributor-tier model silently                                             | `adopt` took the catalogue's active model without `allowsModel`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | The same yes (or the confidential-workspace block) as choosing one; declined or blocked, the session moves to the default standard model with a notice; a refused switch drops the loaded session.                                                                                                                                                                                                                                                                                                                                                                                      |
| "Edit automatically" behaves like Manual                                                       | No code answered edit approvals, though `permissionModes.ts` said the extension would; the README promised it. And on Muse Code, Manual applies in-workspace edits without an approval (M4, live), so the Modes menu's "ask before each edit" was false there.                                                                                                                                                                                                                                                                                                                     | The controller answers a plain file-write approval (Model API `fileWrite`, Muse Code `fileAccess` with `access: write`) with the allow-once choice and labels the resolution "Edit automatically"; protected writes, judge escalations, staged commands and other modes show the card; a refused answer shows the card after all. The Modes menu's lines come per backend (`permissionModeDetail`).                                                                                                                                                                                     |
| The shell inherits the extension host's plumbing                                               | `ELECTRON_RUN_AS_NODE=1` turns a `code` command into plain Node; the `VSCODE_*` IPC handles reach the model's commands; a pwsh 7 `PSModulePath` breaks Windows PowerShell 5.1.                                                                                                                                                                                                                                                                                                                                                                                                     | `shellEnvironment`: the removal list of VS Code's own `sanitizeProcessEnvironment` (fetched from microsoft/vscode `src/vs/base/common/processes.ts`), the user's variables kept (a developer's tests may need their own `META_API_KEY`), and the 5.1 module path set case-insensitively (`setEnvironmentVariable`: an inherited `PSMODULEPATH` would otherwise win Node's sort).                                                                                                                                                                                                        |
| Logs and the report leak more than they should                                                 | Redaction missed JWTs, basic credentials, token fields and URL user-info; CLI stderr was logged whole; the diagnostics report, meant for public issues, held the user's home path.                                                                                                                                                                                                                                                                                                                                                                                                 | Seven patterns in `redactSecrets`; stderr chunks capped at 4,096 characters; `homeDir` written as `~`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The manifest said "no workspace can set them"                                                  | True of `.vscode/settings.json`, false of a dev container definition in a remote window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Reworded, with the remote-window behaviour above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The release workflow's secret scope                                                            | `VSCE_PAT` was a job-level variable while `npm ci` ran every devDependency's install script.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Owned by M26 (the workflows have one owner); D29 records it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### D25 — The audit: processes and lifecycle (2026-09-23)

Section B of the audit (D24), plus the lifecycle rows of section G.

| Report                                                                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A shell timeout or Stop hangs the turn                                              | `child.kill` ended bash or PowerShell only; the result waited for the pipes to close, so a background grandchild (`server &`) held the tool call open for its whole life; Stop never reached the command (Claude Code #90672 is the same bug).                                                                                                                                                                   | `runCommand`: POSIX commands lead their own process group and the group is killed; Windows uses `taskkill /T /F` (`processTree.ts`), never on a process that has exited. The result settles on exit plus a 250 ms drain; the turn's abort signal reaches the command; the result says "stopped by the user". Output is kept head and tail per stream (`BoundedText`, a `StringDecoder` per stream).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `taskkill /T` misses a child started during the kill (M27, found at the 0.6.0 gate) | `taskkill` kills the tree it enumerated: a child PowerShell started between that enumeration and its own end survived, orphaned. Under load it happened on every kill (the gate's `toolIo.test.ts` folder stayed held by the ping); one orphan was left suspended for good. A launcher that exits (`cmd /c start`, a nested shell) leaves its child with no parent link to follow at all (the review of PR #12). | Each Windows command joins a named job object first (`shellJob.ts`: a C# helper compiled once into the extension's storage by `Add-Type`, self-tested), so everything it starts belongs to the job from its creation; Stop and timeouts call `TerminateJobObject`, which ends them all at once. No kill-on-close, so a command that ends normally leaves its background processes running, as on POSIX. Where no job can be made (Constrained Language Mode forbids `Add-Type`; the log says so), the fallback is `taskkill /T` and then a sweep of the process table (`Get-CimInstance Win32_Process` by `ParentProcessId`, Windows PowerShell with one `PSModulePath` spelling), one generation per round, five at most: a child counts only if it was created after the shell started and before its parent died, and each is killed in the same PowerShell run that checks its creation time. A killed command's result waits for all of it. |
| A deliberate restart is treated as a crash                                          | Trust granted, a sandbox or backend change, a sign-in: the extension disposed every controller and the host's exit listeners called `markBackendError`, so every panel refused to send; one exit listener was added per message.                                                                                                                                                                                 | `MuseCodeHost.close()` marks its exit expected; `HostExit { description, isExpected, isPersistent }` goes to the listeners (one per host, a `WeakSet`). Before a restart each controller cancels its running turn, ends it in the webview and remembers its session; the next message resumes it (`resumeAfterRestart`), on the same backend kind only; a sign-out ends the conversations. A crash ends the running turn the same way and says the next message continues; only a persistent exit (configuration, usage, SDK surface) shows the sign-in gate's error. `museBinaryPath`, `environmentVariables` and VS Code's proxy settings now restart the host too.                                                                                                                                                                                                                                                                            |
| No handshake or command timeout                                                     | The SDK waits for ever (its INV-006).                                                                                                                                                                                                                                                                                                                                                                            | `withDeadline`: 30 s for the handshake (the process is closed when it misses it), 60 s per command, 180 s for resume, fork, read and compact. The fake CLI's `silent` mode proves the handshake case end to end.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A replaced host's late exit orphans the new one                                     | The exit handler cleared `hostPromise` whatever it held; a wrapper that failed to build left `muse serve` running.                                                                                                                                                                                                                                                                                               | A generation per spawn: an attempt clears only its own slot; a wrapper failure closes the process.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Mid-turn death, restart or sign-out leaves the UI running                           | No terminal event reached the webview; the next message started a new session with no context; Clear and Resume left the CLI's turn running.                                                                                                                                                                                                                                                                     | A synthetic `turnCompleted` (cancelled or failed, with the reason) ends the turn; the session is resumed; dropping a session cancels its running turn first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| An exception in the notification handler                                            | The SDK's single handler threw on a bad payload and the connection went deaf; a bad stored archive list threw on every read.                                                                                                                                                                                                                                                                                     | The handler catches and logs; a connection that closes while the process lives closes the host so the exit is reported; the archive list is `safeParse`d.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Races                                                                               | Two quick sends created two sessions; a panel closed during a start kept the session; two panels on one session shared a handle and closing one deafened (Model API: cancelled) the other.                                                                                                                                                                                                                       | A shared start (`openSessionOnce`); `isDisposed` checked after every await; handles are reference-counted on both backends.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The host closes the panel's own session                                             | `session/closed` was only heard by the History dialog; the next command failed `sessionNotLoaded`.                                                                                                                                                                                                                                                                                                               | The controller watches its own session; `sessionNotLoaded` becomes `SessionNotLoadedError`, answered by resuming and retrying the message once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The Model API host before its sessions are read                                     | Published before `load()` finished; a failed load was cached.                                                                                                                                                                                                                                                                                                                                                    | One build shared by every caller, forgotten on failure; a build that finishes after a dispose closes itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Sign-in accepts a stale credential file                                             | Success was "the file exists", so an expired sign-in counted at once; each click opened another terminal.                                                                                                                                                                                                                                                                                                        | Success is a credential file written after the login started (its modification time); a second click joins the first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Secret storage failing blocks the CLI backend                                       | On Linux without a keyring `SecretStorage.get` throws; the backend selection awaited it.                                                                                                                                                                                                                                                                                                                         | `getApiKey` reads a failure as "no key" and logs it once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| CLI resolution probes PATH on every message                                         | Synchronous `existsSync` over every PATH entry per send (a dead UNC share blocks the host).                                                                                                                                                                                                                                                                                                                      | Resolved once per inputs (setting, PATH, flags), re-checked with one probe, invalidated by the sign-in gate and the settings that change it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The Windows launcher fallback                                                       | Without `.muse-version` the CLI was started through its PowerShell launcher; Windows ends only the direct child, so closing it left `muse-bin` running.                                                                                                                                                                                                                                                          | The newest `muse-bin-*.exe` in the folder (version order); the launcher is never the command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| No `deactivate`; shutdown fire-and-forget                                           | Hosts were closed from a disposable nobody awaited.                                                                                                                                                                                                                                                                                                                                                              | `deactivate()` awaits the same stop, conversations ended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The IDE tool server                                                                 | No error listener after `listen`; a failed start was never retried; a rejected request handler was unhandled.                                                                                                                                                                                                                                                                                                    | A permanent error listener; a shared, retryable start; a failed request answers 500.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Model API retries                                                                   | The retry sleep ignored Stop; an HTTP-date `Retry-After` was ignored; the transcript never said a request was being retried; the model list had no deadline.                                                                                                                                                                                                                                                     | An abortable wait; both `Retry-After` forms; `turnRetry` events as Muse Code's; 30 s deadlines on the model list and the token count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| The CLI and VS Code's proxy                                                         | `muse serve` did not see `http.proxy`.                                                                                                                                                                                                                                                                                                                                                                           | `HTTPS_PROXY` / `HTTP_PROXY` (and `NO_PROXY` from `http.noProxy`) when the environment has none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The login terminal off Windows                                                      | `"path" login` in the user's default shell breaks under pwsh or nushell.                                                                                                                                                                                                                                                                                                                                         | The terminal runs `/bin/sh`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The CLI's config root drifts from the sign-in check (Claude Code #66499)            | An `XDG_CONFIG_HOME` in `museSpark.environmentVariables` moved the CLI's credentials and settings, but the extension looked under the host's own environment.                                                                                                                                                                                                                                                    | The credential file, `settings.json` and the personal skill root are read under the CLI's environment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The terminal environment (Cline #7793)                                              | The Model API shell ignored `terminal.integrated.env.*`.                                                                                                                                                                                                                                                                                                                                                         | Applied as VS Code's terminal applies it (`${env:…}`, `${workspaceFolder}`, `null` removes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `windowsHide` on every spawn                                                        | Every spawn the extension makes hides its window; the SDK's own `spawnMspConnection` has no such option and spawns without it (VS Code's extension host has a hidden console, which children inherit, so no window shows). Filed as meta-models/muse-code-sdk#34 (2026-09-23).                                                                                                                                   | Recorded; nothing the extension can pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A slow start is killed, and its failure shown by every waiter (0.10.1)              | On a CPU-starved machine (an activation that took 211 s) `muse serve` missed the 30 s handshake deadline and was killed though its process still ran; each caller waiting on that one start (six skill listings from the palette and slash menu, the warm-up) showed its own "That did not work" card for the same failure.                                                                                      | A process still running at 30 s gets one longer wait, 120 s in all (`withSlowDeadline`, `MSP_SLOW_HANDSHAKE_TIMEOUT_MS`); one that exits fails at once. The controller shows a failure once (`shownFailures`, by the error the shared start rejected every waiter with): a message on its own card, another action's card, else the warm-up's notice after every other waiter had its turn; skill listings only log. The next action starts afresh.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### D26 — The audit: protocol and backend semantics (2026-09-23)

Section C of the audit (D24), plus the two `send()` companions of D28 (the
images of a refused message, a late acceptance). The Muse Session Protocol
facts come from the SDK's `msp.d.ts` and `connection.js` (0.x, pinned in
`package-lock.json`) and the live 1.3.0 capture of 2026-09-21. "Edit
automatically" was M21's (D24) and the exit codes M22's (D25).

| Report                                                       | Finding                                                                                                                                                                                                                                                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A tool call left without an output (Model API)               | The call was saved before it ran; Stop on its card, or a tool that threw (`write_file` into a missing folder), left a `function_call` with no `function_call_output`, and every later request replayed an invalid conversation.                                                                            | `finishCall` records an output for every call: the tool's, its error, or "cancelled: the user stopped the turn" for the call Stop cut off and each one after it in the response. `write_file` creates the folders.                                                                                                                                                                                                                                                                                                                                                                                           |
| A message typed during the final answer is lost              | `turnAccepted`, then the loop ended without reading it.                                                                                                                                                                                                                                                    | The loop runs another round while anything is steered in; `steer` is refused once the turn has ended, so nothing falls between.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A resume parks the turn with no card                         | The CLI re-issues pending prompts as `approval/request` / `userInput/request` server requests right after the `session/resume` answer, and the extension refused them; the SDK hands every frame of one read to its handlers before the awaiting command resumes, so they arrive before the handle exists. | The request is answered with the presentation receipt `{}` (msp.d.ts `RequestReceipt`) and shown as the notification it mirrors. Events for a session a start, resume or fork has in flight wait for its handle; a handle holds its events until its first listener. `approval/listPending` pulls the prompts the resume's `pendingRequests` name. A `PromptLedger` per session shows one card per prompt and stage (the live notification and its server-request mirror, a re-issue), and gives a second surface the prompts still open. The resume's `activeTurnId` becomes the controller's running turn. |
| The handshake facts are dropped                              | `platformOs`, `schema`, `sessionDurability` were never read; rename and fork fail on Windows 1.3.0 (meta-models/muse-code-sdk#30, #31) after the user asks.                                                                                                                                                | Logged at start (a non-durable host is a warning). `HostInfo.canEditSessions` is false on Windows up to 1.3.0: the panel hides Rename and Fork (the rewind stays), and the host refuses a fork before sending it.                                                                                                                                                                                                                                                                                                                                                                                            |
| A late decision reads as an error; a failed one locks a card | `approval/decide` is admission only. A stale, resolved or missing prompt came back as a warning; any failure left the card locked.                                                                                                                                                                         | `approvalRequirementStale` / `…AlreadyResolved` / `…NotFound` and the `userInput` pair become `PromptSettledError`: an information notice, the card follows the host's own events, and a prompt the host no longer holds loses its card (`promptDropped`). Any other failure keeps the #29 warning and opens the card again (`approvalReopened`).                                                                                                                                                                                                                                                            |
| A stage re-prompted after a terminal decide                  | `change.kind` and the ack's `terminal` were dropped (the SDK facade's #37538 note).                                                                                                                                                                                                                        | A `terminal: true` ack and `change.kind: alreadyTerminal` close the approval in the ledger; later stage updates for it are dropped until it resolves.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Notifications dropped without a word                         | A malformed frame vanished; `view/gap`, `turn/unqueued`, `turn/retracted`, `session/modelRouteUnserved` were unhandled.                                                                                                                                                                                    | One log line per method (unshown: info; malformed: warning). A gap re-reads the session and replaces the transcript (again if another gap arrives meanwhile), the running turn and the usage kept (`historyLoaded.activeTurnId`). A withdrawn queued turn is a `turnWithdrawn` event: its message reads "Not sent" and the running turn runs on. A retract and an unserved model route are notices.                                                                                                                                                                                                          |
| Compaction is not a turn (Model API)                         | Sends during it were wiped; it could not be stopped.                                                                                                                                                                                                                                                       | It runs as a turn: sends queue behind it, Stop cancels it (the conversation stays as it was) and ends every queued message with "Not sent: Stop cleared the queued messages". A context size that cannot be counted is logged, not thrown.                                                                                                                                                                                                                                                                                                                                                                   |
| Token numbers mean different things per backend              | Muse Code sent one completion's raw counters, the Model API a session total.                                                                                                                                                                                                                               | Both report session totals: Muse Code's `cumulative.promptTokens` (counted once) and `outputTokens`. The cached rows show only where the backend can total them honestly (the Model API); Muse Code's raw cache counters do not sum across providers.                                                                                                                                                                                                                                                                                                                                                        |
| The 10 MiB frame cap                                         | The host drops an oversized frame without answering it; `onProtocolError` was not registered.                                                                                                                                                                                                              | A command over the cap is refused before sending, with the reason; protocol errors are logged by kind, never with the frame; the refused message's images stay for another try (`sendFailed.attachmentsKept`, the D28 companion).                                                                                                                                                                                                                                                                                                                                                                            |
| `session/list` over its maximum                              | 200 is the documented cap.                                                                                                                                                                                                                                                                                 | Clamped in the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| The SDK keeps every command for ever                         | `Connection.command` memoizes each command's canonical payload (an image turn's base64 included) for replays across reconnects the extension never makes. Filed as meta-models/muse-code-sdk#35 (2026-09-23).                                                                                              | `sendCommand` over the public `connection.request`: the same `commandId` contract (echo checked) and the same retry of `overloaded` / `backpressured` refusals (3 attempts, jittered, ≤2 s), nothing remembered.                                                                                                                                                                                                                                                                                                                                                                                             |
| SSE edge cases (Model API)                                   | `data: [DONE]` or an empty keep-alive would fail JSON parsing; a CRLF split across two chunks read as two line breaks.                                                                                                                                                                                     | Both skipped; a chunk ending in `\r` holds it for the next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Output pages                                                 | Model API pages were cut at byte offsets (U+FFFD mid-character in Revert patches); the CLI's `encoding: base64` was ignored.                                                                                                                                                                               | Pages start and end on character boundaries, as the CLI serves them; a base64 page is shown when it decodes as UTF-8 and refused as binary otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The Model API session store grows for ever                   | Every session was read whole into memory at start; a crash left `.tmp` files; Windows refuses a rename while a scanner holds the file (Codex #29812, Claude Code #89075).                                                                                                                                  | The window keeps headers and reads a session whole when it is opened (after the saves queued before it). Sessions idle past `museSpark.cleanupPeriodDays` (Claude Code's `cleanupPeriodDays`, default 30, 0 keeps them) are deleted when the list is read. A `.tmp` older than a minute is removed; `EPERM` / `EACCES` / `EBUSY` renames are tried five times, the wait doubling from 25 ms.                                                                                                                                                                                                                 |
| Stop and refusals (Model API)                                | Queued messages vanished on Stop; a refusal part rendered as an empty reply.                                                                                                                                                                                                                               | Each queued message ends with the reason above; a refusal's own words are the reply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A late acceptance makes a finished turn "running"            | `send()` set the active turn from the ack, which can land after its own `turn/completed` (the D28 companion), and from a queued turn.                                                                                                                                                                      | The controller remembers finished turns; neither a finished nor a queued turn becomes the running one, and a `turnCompleted` for another turn leaves the running one alone.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Amendment 2026-09-27 (0.9.1): Windows limits hold for every version.**
D26 hid rename and fork on Windows, and D12's profile-workspace warning
applied, only up to Muse Code 1.3.0 (`WINDOWS_SESSION_EDITS_LIMITED_MAX_VERSION`,
`SANDBOX_PROFILE_LIMITED_MAX_VERSION`), on the assumption that the next
release would fix them. 1.4.0, which Meta's launcher installs by itself,
fixed neither (#26, #30, #31 re-tested live on `1.4.0-R4302.1`), so 0.9.0
offered Rename, conversation rewind and Side chat there again, and each
failed; the sandbox warning disappeared too. Both limits now apply on
Windows to every version, with no version ceiling: a limit is lifted only
by a release after a Muse Code version is verified to fix it. Showing an
action that fails is worse than hiding one that would work.
`docs/certification/release-0.9.1.md`.

**Amendment 2026-09-27: the CLI's sign-in is read, not assumed**
(`fix/cli-sign-in-detection`; evidence in `docs/certification/sign-in-detection.md`).

- **The finding.** `muse logout` rewrites `auth.json` as
  `{"schema_version": 1, "providers": {}}` and never deletes it. This was
  seen on 1.3.0 Linux and on 1.4.0 Windows and Linux, in isolated homes.
- **What it broke.** "Signed in" had been "the file exists". So after any
  sign-out the auto backend stayed on Muse Code, and M55's logout hold
  waited for a deletion that never came.
- **macOS.** A sign-in is a login Keychain item (`ai.meta.dev.credentials`,
  account `meta`), and the file is a token-free pointer
  (`schema_version: 2`, `storage: "keychain"`).
- **The structural read (`src/core/backends/musecode/credentialFile.ts`).**
  Only four facts are kept: the schema version, which providers are
  named, each provider's `storage` lane, and whether `meta` carries
  `api_key` or `access_token` (the parse replaces a key's value with
  `true`). The parse drops every other field. Only `providers.meta` speaks
  for the sign-in: 1.4.0-R4302.1's bundled Slack connector reads its own
  `providers.slack_connector` from the same file (PR #49 review). It
  decides:
  - no file → signed out, with no process;
  - the empty version-1 file a sign-out leaves → signed out, on every OS;
  - off macOS, a `meta` entry in a captured inline shape (no `storage`,
    and `api_key` or `access_token`) → signed in;
  - a `meta` entry in any other shape (another `storage`, or no captured
    key), or other providers alone → asked of the CLI;
  - on macOS, a version-1 file holding the credential and an empty
    version-2 file → asked of the CLI: nobody captured whether 1.4.0 reads
    or migrates them there (review round 4);
  - off macOS, any version-2 file (the empty one included) or a `meta`
    whose storage is the Keychain → a named error. `muse serve` exits 3
    at startup with each of the three on Windows and on Linux
    ("unsupported auth schema version 2"; "keychain item for meta is
    unreadable"), captured 2026-09-27 on 1.4.0-R4302.1 (Windows 11 and the
    Kubuntu VM). With `META_API_KEY` set it starts with each of the three
    and answers `envKey` on both, so the key wins over those files; macOS
    was not probed with the key.
- **Asking the CLI.** A Keychain pointer on macOS, any other file on macOS
  but the sign-out's, or a file the read cannot place, is asked of the
  CLI: `account/read` on a short-lived `experimentalApi` host.
  - The answer is kept until the file's size or modification time changes,
    or until a sign-out, a device sign-in or Check again forgets it. Cancel
    only leaves an unanswered probe behind, so what it shows next asks
    nothing new; a sign-out that cancels a sign-in forgets the answer too,
    so it never skips `account/logout` on a stale `signedOut`. Presses of
    Check again while one runs join it: one host, one question.
  - On macOS the CLI is asked only on a user action (Check again, sign-in,
    sign-out, the Sign Out and Diagnostics commands), so a Keychain prompt
    follows a click.
  - `unknown` counts as signed in, as before; a turn's `authRequired`
    still corrects it.
- **Sign-out.** It uses MSP `account/logout` on a short-lived host (the
  chat host has no `experimentalApi`, and sign-out stops it first). The
  result is confirmed by `account/read`. When that does not confirm it
  (`META_API_KEY` makes it answer `envKey`), the sign-in is read afresh;
  only a sign-in still there opens the terminal `muse logout`, with
  `museSpark.environmentVariables`, confirmed later by the file or the CLI.
  A sign-out that keeps the hold is published as `error`, the state the
  panel offers Check again in. A refresh that answers after a sign-out
  ended leaves the hold as that sign-out left it.
- **M55's device flow signs in on:**
  - `account/read` turning `accountLogin` on the open host;
  - or a new file that `account/read` does not contradict.

  This supersedes M55's "accept only after a new credential-file
  modification". `account/changed` is not relied on: neither a terminal
  `muse logout` nor an expired code fired it.

- **How it ends otherwise (PR #49 review, live capture).** Every ending
  was captured on 1.4.0-R4302.1 in throwaway homes (`test/fixtures/msp/`):
  `expired`, 600 s after `loginStart`, with a message; `cancelled`;
  `granted`, `denied` and `failed`, from Approve and Deny clicked on the
  device page, and an approval whose file could not be written.
  - **`granted`.** It came 205 ms after the file was written and
    `account/read` said `accountLogin`; it never ends the flow or counts
    on its own, and `account/read` or the file decides.
  - **`denied` and `failed`.** Each ends the flow with its own message.
    No ending's message is logged: it is free text the CLI chose (`failed`'s
    names the credential file's path), so the log names each captured
    ending in fixed words (Codex on `886af682`).
  - **Every other word.** It ends the flow at once and is shown as Muse
    Code sent it (AGENTS.md rule 13); the log keeps the word only in the
    shape of a protocol word, never its message.
  - **With no first `account/read`,** a sign-in from before would pass for
    a new one, so `accountLogin` alone does not count: a file written
    since the flow began does, and so does the host's `granted` borne out
    by `account/read` saying `accountLogin` (a Keychain sign-in may leave
    the file as it was; review round 4). That captured success counts
    whatever came before, so a same-account re-sign-in on macOS, which may
    change only the Keychain while the logout hold keeps the old sign-in,
    is seen too (Codex on `328efb52`).
  - **Forced Model API.** With `museSpark.backend` set to `modelApi`, the
    choice asks the CLI nothing (`isCliSignInConsulted`), in the gate and
    in host admission.
  - **Cancel after approval.** When the file changed since the flow began,
    its structure decides, not the click. With the hold on or a Model API
    session, the code leaves the panel at once, before the refresh.
  - **A host that exits** fails the flow at once (`connection.closed`),
    unless the credential file changed since the flow began: then it
    signed in. A write that an answered `account/read` already called
    signed out (another Muse process's sign-out) stays refuted, for an
    exit and for a later `account/read` left unanswered alike.
- **The backstop.** The extension waits 11 minutes, past the code's
  lifetime, so Muse Code's `expired` ends an unapproved code. The old
  5 minutes cancelled codes that were still live.
- **A CLI that stops answering.** Cancel and the host's ending are noticed
  at once even while `account/read` is unanswered. `loginCancel` is
  bounded at 2 s before the host is closed anyway. A sign-out never waits
  on a question a finished or failed sign-in asks, and a refresh begun
  before a sign-out ended cannot publish after it. The window closing
  cancels the sign-in, waits for it, and closes every short-lived account
  host before the backends stop; a click still in its pre-flight questions
  then starts nothing (a flag `stopSignIn` sets, checked by `signIn` and
  the device flow's join).
- **Switching backends (Codex on `1ae3604f`).** Every state that could
  sign in on another backend than conversations run on is published
  through one helper, `AuthService.publishSelection`: every refresh (Check
  again, a Cancel that still landed a sign-in, a failed sign-in's refresh,
  a device sign-in's confirmation, CLI discovery after an install), a
  pasted key, and a failed install. It opens a new admission generation,
  shows `checking`, ends the running backend's conversations
  (`restartBackend(true)`) and only then publishes. `liveBackend` is the
  backend of the last signed-in state, cleared by any restart that ended
  the conversations (a sign-out included), so none is ended twice.
- **Stale answers (Codex on `886af682`).** A probe that Cancel, a sign-out
  or Check again left behind gives its late answer to no caller, the ones
  that joined it included: they look again and get the newer answer. Every
  refresh takes a ticket as it starts and publishes only if nothing newer
  has; while the browser sign-in waits, a refresh leaves its code on
  screen.
- **The log.** Text the CLI chose is never logged as sent, since the log
  channel's redactor catches only key-shaped strings (Codex on
  `886af682`):
  - the unsupported-file message names the credential file's full path, so
    the log says so in fixed words and the panel keeps the path;
  - a sign-in ending, an `account/read` state and an `authRequired` reason
    are logged only in the shape of a protocol word (`wireWordForLog`),
    captured endings in fixed words;
  - an MSP failure is logged by its kind and code (`failureForLog`), and
    `muse serve` or `muse skills` stderr by the lines 1.4.0-R4302.1 was
    captured writing (an unsupported schema version, an unreadable
    Keychain item, a failed model-catalog fetch), in fixed words; any other
    line by its length (`stderrForLog`,
    `src/core/backends/musecode/logText.ts`).
- **Where it is only as good as the schema.** `account/*` stays
  experimental.
- **Owner steps.** A real sign-in remains an owner step on:
  - macOS, for the pointer after a 1.4.0 login (and whether 1.4.0 reads a
    version-1 file there);
  - Linux, for the device-login file.

  The Windows success sequence, a declined code, a failed save and the
  logout of an OAuth slot were captured on 2026-09-27
  (`scratchpad/cred-capture/capture2.mjs`).

- **Not taken.** `TBH_CREDENTIAL_BACKEND=file` is not set. R4302.1 fixed
  #38/#53 and the launcher updates itself; the README names the switch
  only for someone stuck on R4161.1.

### D27 — The audit: editing correctness (2026-09-23)

Section D of the audit (D24): the Model API's file tools, Edit Review and
the context the agent reads. "Rules and skills", "diagnostics", "mentions"
and "multi-root" are the context rows; the rest are the editing rows.

| Report                                                                               | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An insertion reverts as "delete the file" (Cline #9555)                              | The Model API's hunks gave every insertion `oldStart: 0`, which Revert and Rewind read as a file the edit created: adding an import line and reverting it trashed the file.                                                                                                                                                                                                                                                                    | Hunks use unified numbering (an insertion's `oldStart` is the line it follows) and carry three lines of context each side; the patch file says `created` outright. A file counts as created only when nothing is left once the edit is taken out, so lines the user added since are written back, never trashed. Muse Code's documents (no `created`) keep the whole-file-add rule under the same check.                                                                                                                                                                            |
| Deleted lines put back at a line that moved                                          | A deletion-only hunk had nothing to match against.                                                                                                                                                                                                                                                                                                                                                                                             | The context lines are matched: a file that has moved on is refused with the reason, not guessed at. Refined in D31: intact lines that only moved are found where they moved to, if they occur once.                                                                                                                                                                                                                                                                                                                                                                                 |
| CRLF files (Roo #8020, Codex #25048, Claude Code #88114)                             | `read_file` showed LF lines, so a multi-line `find` never matched a CRLF file; a replacement wrote LF into it; `write_file` dropped the final line break.                                                                                                                                                                                                                                                                                      | The model sees LF text without the BOM; `edit_file` matches that text and writes the file back in its own line breaks and BOM; `write_file` keeps an existing file's BOM, line breaks and final line break. A file that mixes breaks is edited as it is.                                                                                                                                                                                                                                                                                                                            |
| Non-UTF-8 files (Claude Code #96263, #92328)                                         | Latin-1, Shift-JIS or UTF-16 files were decoded lossily and written back whole.                                                                                                                                                                                                                                                                                                                                                                | `readFile` is strict: invalid UTF-8 or a NUL refuses the file ("is not UTF-8 text …"), so nothing is rewritten; a UTF-8 BOM is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Edits under unsaved editors; stale overwrites                                        | The tools wrote files an editor held unsaved changes to (VS Code then asks which to keep); `write_file` could replace a file the model had not seen, or one the user changed since.                                                                                                                                                                                                                                                            | The tools refuse a file with unsaved changes; `write_file` replaces an existing file only as the model last read or wrote it (Claude Code's rule, a per-session fingerprint), and the prompt says so. Before each message the panel names the unsaved files (once per set) when autosave is off, since Muse edits the saved files.                                                                                                                                                                                                                                                  |
| A flood of shell output hides how the command ended (Cline #13346)                   | Output over 64k was clipped from the start: the exit line and stderr went.                                                                                                                                                                                                                                                                                                                                                                     | Each stream keeps its beginning and its end (half the budget each, split on code points), and the exit line is never clipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Search on a large workspace                                                          | A search that ran out of time returned nothing; there was no cap on the files read.                                                                                                                                                                                                                                                                                                                                                            | The worker posts each file's hits as found: a timed-out search returns them, marked partial. At most 50,000 files are read; the output says when the glob matched more.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Windows PowerShell's output (Continue #12315)                                        | PowerShell 5.1 writes a redirected stdout in the OEM code page: "héllo ✓" came back "h�llo ?" (probed 2026-09-23).                                                                                                                                                                                                                                                                                                                             | A preamble makes its output, and what it pipes to native commands, UTF-8 without a BOM. The per-chunk decoding was M22's (`StringDecoder`).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Revert strips a BOM (Cline #2463, Roo #1431)                                         | Edit Review read files through a decoder that dropped the BOM and wrote them back without it.                                                                                                                                                                                                                                                                                                                                                  | The BOM is read, set aside for the match and written back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Non-atomic writes; Edit Review without a folder                                      | A write interrupted mid-way left a half file; Edit Review with no folder resolved paths against the process's own directory.                                                                                                                                                                                                                                                                                                                   | `writeFileAtomically` (a uniquely named temporary file renamed over the target, busy renames retried, the temporary file removed on failure) for the tools and the session store. An existing file is replaced where it really is (through a symbolic link, the file it leads to) and keeps its permission bits; a read-only file is refused at once (the review of PR #11). A hard link's other names keep the old content, and the owner and Windows' hidden and system attributes are not carried, as a new file cannot carry them. Edit Review says to open the folder instead. |
| UTF-16 rules files; linked skills (Cline #12151)                                     | The loaders read files as lossy UTF-8, so a UTF-16 `AGENTS.md` (what Windows PowerShell 5.1's `>` writes) reached the model as NUL garbage; a symlinked or junctioned skill directory was dropped without a word; `AGENTS.md`, `CLAUDE.md`, `MEMORY.md` and `SKILL.md` were opened by their text path, so a committed link sent its target to the model.                                                                                       | `ContextIo` behind the loaders: `decodeContextText` reads UTF-16LE/BE by the byte-order mark and UTF-8 otherwise (its mark dropped), strictly, refusing NULs, each refusal logged with the file and the reason. Repository files are confined by canonical path (`confineWorkspacePath`); a link out of the workspace is skipped with a log line. Personal skill links are followed. One unreadable skill no longer hides the rest; a refused `AGENTS.md` does not fall back to `CLAUDE.md`.                                                                                        |
| `getDiagnostics` leaks and misses                                                    | Files outside every folder were reported by absolute path, a second folder's relative to that folder; no per-message cap; a request matched by suffix, lower-cased on every platform; a bad `%` escape made `decodeURIComponent` throw.                                                                                                                                                                                                        | Only the root's files, by root-relative path; messages clipped at `DIAGNOSTIC_MESSAGE_MAX_CHARS` (1,000) with a count, never inside a surrogate pair; the request resolved (`fileURLToPath`, or against the root) and matched exactly, case-insensitively on Windows only; a malformed or outside request is an MCP error result.                                                                                                                                                                                                                                                   |
| `@` mentions with spaces or `#`                                                      | `@path` ran to the first whitespace and `#` started the line range.                                                                                                                                                                                                                                                                                                                                                                            | `formatMention` quotes paths with whitespace, `#` or `"` (`@"my notes/a#1.md"#5-10`; `\"` and `\\` inside), used by Alt+K, the menu, the picker, uploads and drops; the composer reads mentions from the start of the draft, and the line range is no longer part of the menu's search. `[!x]` and nested braces (M21) confirmed.                                                                                                                                                                                                                                                   |
| Multi-root: the first folder is the root; remote drops (Claude Code #92403, audit G) | `asRelativePath` is relative to whichever folder holds the file, so folder 2's `src/a.ts` read as folder 1's in the chip, Alt+K, uploads, drops, the file search and diagnostics; a relative `openFile` with no folder resolved against the extension host's directory; a drop in a remote window never matched a folder, since the remote extension host sees its folders as `file:` URIs while the webview hands over `vscode-remote:` ones. | `rootRelativePath` over VS Code's folder attribution (a folder nested in the root counts as part of it); the file search limited to folder 0 (`RelativePattern`); `openFile` through `resolveAgainstRoot`; `hostSideUri` maps a dropped URI as VS Code's own URI transformer does (`vscode-remote` → `file`, a local `file` → `vscode-local`). Unit-tested; not tried in a real remote window.                                                                                                                                                                                      |
| A message typed during a card decides it (Roo #11211, audit G)                       | Checked, not affected: a message steers the running turn and never answers a card.                                                                                                                                                                                                                                                                                                                                                             | A test holds it (a regression that answers cards itself fails it); the Model API's "steers a running turn …" case decides the card after a steer, so the card was still pending.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Subagent results in the parent's context (Claude Code 2.1.277, audit G)              | Not the extension's to mark: Muse Code builds the parent's context from its own children, and the Model API backend runs no subagents (D17).                                                                                                                                                                                                                                                                                                   | Recorded; nothing to change here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### D28 — The audit: webview and UI state (2026-09-23)

Section E of the audit (D24): the webview's state and its rendering. Every
row held against the code at `7db2398`; M25 fixes them all in the webview,
plus two posts from the controller (`clear()`, `surfaceReady()`) and three
additive protocol messages. Two companion changes belong to `send()` in the
controller, which another milestone rewrites (the images a failed send took,
and the active turn a late acceptance brings back).

| Report                                                           | Finding                                                                                                                                                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replayed child rows pulled into every rewind (an M20 regression) | The `childTranscript` replay gave each row a fresh arrival number, so any agent edit read from its session counted as newer than every message, and a read replaced the numbers of rows already seen live. | `replayChild`: a row the panel never saw complete is numbered just after the last thing known to precede it (the agent row's new `seq`, or an earlier live row of the same transcript), strictly below the next whole number. Live rows keep their numbers; without an agent row the read rows join no rewind.                                                                                                                                                                    |
| A cancelled or failed turn leaves rows running                   | `turnCompleted` only cleared `activeTurnId`: the reply kept streaming, tools kept running, cards stayed clickable.                                                                                         | `completeTurn` settles the conversation's rows: streaming stops, a thought gets its duration, a running tool that is not backgrounded becomes `interrupted` ("Interrupted") and loses its card; a later item update still wins. A subagent's own turn settles only its transcript. It covers the host's synthetic `turnCompleted` for a CLI that dies mid-turn.                                                                                                                   |
| The crash screen's Reload comes back empty                       | The reducer lived in `App`; the error boundary unmounted it, and the host's messages under the crash screen were lost.                                                                                     | A store outside the boundary (`state/store.ts`), saved to VS Code's webview state at most once a second and at once before a reload, as a versioned snapshot validated with zod on the way back (`state/snapshot.ts`, the row schemas and types in `state/transcriptEntries.ts`). `surfaceReady()` posts `surfaceState` first; the snapshot is kept only when its session is live, with the host's running turn. A state that crashed the first render is saved without its rows. |
| Ctrl+N clears only the host; it may clear the wrong panel        | `clear()` never told the webview; the active surface was the last one whose composer had focus.                                                                                                            | `clear()` posts `conversationCleared`; the panel spends the echo of its own clear (a counter). `surfaceFocused` on window focus, a tab turning active and the sidebar being shown make a surface active.                                                                                                                                                                                                                                                                          |
| Enter during an IME composition sends                            | No `isComposing` check.                                                                                                                                                                                    | The composer's keys return first for `isComposing` or the "Process" key (keyCode 229).                                                                                                                                                                                                                                                                                                                                                                                            |
| Every keystroke or delta re-renders every row                    | No row was memoised; the callbacks closed over the state; a child delta scanned every child transcript.                                                                                                    | Memoised rows, callbacks that read the store when they run, a `childOwners` index, updates searched from the end, the patch parse memoised. The draft stays in the reducer (the insert, the Add-context spacing and the snapshot read it).                                                                                                                                                                                                                                        |
| Open fences re-highlighted per delta                             | The open block sat in the tail re-rendered on every delta.                                                                                                                                                 | `splitOpenFence` shows it as plain text until it closes; `highlight` memoised; one CommonMark fence scanner for the head/tail split too (tilde fences included).                                                                                                                                                                                                                                                                                                                  |
| Replayed thoughts read "Thinking…" for ever                      | No duration meant the streaming label.                                                                                                                                                                     | "Thought".                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Pin-to-end ignores height changes                                | The effect watched only the transcript.                                                                                                                                                                    | A layout effect and a `ResizeObserver` on the body and its children.                                                                                                                                                                                                                                                                                                                                                                                                              |
| A restored tab loses its session on a failed resume              | The app saved `{}` on mount; `takeRestoredSessionId` handed the id out once.                                                                                                                               | The webview keeps `restoredSessionId`, `webviewSetup` keeps the id, both until `historyLoaded`, a `sessionInfo` with a session, or `conversationCleared`.                                                                                                                                                                                                                                                                                                                         |
| A refused send's attachments linger on the host                  | The composer dropped the chips while the host still held the images; they counted against the limit and came back as chips after a reload.                                                                 | `sendFailed` carries `attachmentsKept`: when true the chips come back to the composer; otherwise the webview asks the host to drop any it still holds (`removeAttachment`), since the host may have consumed them. The controller's `send()` sets the flag with its rewrite.                                                                                                                                                                                                      |
| The question card's Submit posts twice                           | No lock.                                                                                                                                                                                                   | `questionSubmitted` locks the card until the host settles the question; an error notice (the host's report of a refused answer or cancel) opens it again.                                                                                                                                                                                                                                                                                                                         |
| Screen readers flooded                                           | A polite status verb every 4 s; alert roles on rows, cards and notices alongside the live region.                                                                                                          | One live region; a tool failure and a failed turn's reason read out once.                                                                                                                                                                                                                                                                                                                                                                                                         |
| No focus trap; menus stay open                                   | —                                                                                                                                                                                                          | Tab wraps inside a modal and the panel behind it is `inert`; the message menus and the quote menu close on a press outside or when the focus leaves (`useDismiss`).                                                                                                                                                                                                                                                                                                               |
| Right-click on a selection loses Copy                            | Our menu replaced the browser's.                                                                                                                                                                           | Copy first in the quote menu.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Show archived breaks the keys                                    | The switch took the search box's focus.                                                                                                                                                                    | It no longer takes it; a keyboard toggle gives it back; Escape and focus leaving handled on the dialog.                                                                                                                                                                                                                                                                                                                                                                           |
| `turnAccepted` after `turnCompleted`                             | A fast turn became active again.                                                                                                                                                                           | `lastCompletedTurnId`: a late acceptance marks the card sent and starts nothing.                                                                                                                                                                                                                                                                                                                                                                                                  |
| A child's items before its agent row are misrouted               | They landed in the conversation.                                                                                                                                                                           | `strayItems` by turn, moved to the agent's transcript once its row names that turn as its child session.                                                                                                                                                                                                                                                                                                                                                                          |
| A drop encodes before the size check                             | Every image was read and base64-encoded, then refused by the host.                                                                                                                                         | Size and count checked first; the banner says why, for the host's size and count refusals too.                                                                                                                                                                                                                                                                                                                                                                                    |
| Relative links refused                                           | They went to the host as URLs.                                                                                                                                                                             | `links.ts`: a workspace file at the named lines (`#L12`, `#L12-L20`, `:12`); a path climbing out or rooted is refused with a notice; react-markdown's filter lets a `name.ext:line` link through and still blanks `javascript:`.                                                                                                                                                                                                                                                  |
| Reduced motion partial                                           | Only the microphone.                                                                                                                                                                                       | Every animation and transition.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| No `dir="auto"`                                                  | —                                                                                                                                                                                                          | Every text block; `unicode-bidi: plaintext` on the user card and the composer.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Todo keys collide                                                | Keyed by text.                                                                                                                                                                                             | Keyed by position and text.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Approval feedback carries across stages                          | One card instance for every stage.                                                                                                                                                                         | The card is keyed by stage.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CRLF in the diff view                                            | Rows kept `\r`.                                                                                                                                                                                            | Split on `\r?\n`; a trailing `\r` dropped from patch lines.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Patches over 256 KB unnumbered                                   | Only the first page was fetched; a partial document fell back to the unnumbered diff.                                                                                                                      | Pages fetched to the end within `PATCH_DOCUMENT_MAX_PAGES`, chained by offset; a partial document is not parsed.                                                                                                                                                                                                                                                                                                                                                                  |

### D29 — The audit: packaging, CI, platform and voice (2026-09-23)

Section F of the audit (D24), row A5 (the release workflow's secret scope)
and the two voice rows of section B, plus section G's `windowsHide` rule for
the spawns M26 owns. Section F's git-facts row belongs to M21. Owner ruling
during the milestone: the macOS helper is not signed or notarised; it stays
ad-hoc signed, and the product explains what macOS does with it. Evidence
for each row: `docs/certification/m26.md`.

| Report                                     | Finding                                                                            | Change                                                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows-reserved shortcuts                 | Windows takes Ctrl+Esc and Ctrl+Shift+Esc; VS Code hit the same (#217861)          | Add `win` bindings with Alt; walkthrough updated; tests reject reserved chords                                                                                                    |
| No third-party notices                     | 75 bundled packages, no notices in the vsix                                        | Notices generated from metafiles, shipped, checked by the build                                                                                                                   |
| Dictation in remote windows                | Workspace extension runs remote; `remoteName` is set on both hosts                 | Refuse when the host is remote (remoteName plus extension kind)                                                                                                                   |
| macOS permission flow                      | TCC credits VS Code, which declares no speech recognition (#307364); no quarantine | Not signed (owner); honest per-permission text; early-exit hint; the helper disclaims VS Code's responsibility and asks under its own name (M28, the owner's go-ahead 2026-09-23) |
| Plist version by hand                      | Hand-bumped literal                                                                | Derived from package.json; checked in the binary                                                                                                                                  |
| Integration tests on one version, no cache | Stable only                                                                        | Stable plus the floor; downloads cached                                                                                                                                           |
| semgrep / PSScriptAnalyzer unpinned        | Unpinned                                                                           | 1.177.0 (Dependabot pip) and 1.25.0                                                                                                                                               |
| Audit blocks tags                          | No-fix advisories dead-end a release                                               | Stays blocking; reviewed exceptions expiring within 90 days                                                                                                                       |
| No job timeouts / token persisted          | All jobs affected                                                                  | Timeouts everywhere they're allowed; `persist-credentials: false`                                                                                                                 |
| Commands always in the palette             | No `commandPalette` entries                                                        | Four `when` clauses                                                                                                                                                               |
| Category                                   | "Programming Languages" is wrong                                                   | AI, Chat                                                                                                                                                                          |
| `navigator` in the host                    | Not affected                                                                       | Build check added                                                                                                                                                                 |
| `VSCE_PAT` scope                           | Job-level env beside install scripts                                               | `verify` job, flag only, one step after `--ignore-scripts`                                                                                                                        |
| PS 5.1 `PSModulePath`; stdin EPIPE         | Both true                                                                          | Shared reset helpers; error listener and no writes after exit                                                                                                                     |

### D30 — What we can build now, and Remote Control (2026-09-24)

The owner asked whether Muse's connectors could give Claude Code's Remote
Control (continue a local session from the web or a phone). Research,
recorded privately in `temp/roadmap-2026-09-24.md` and
`temp/meta-pipeline-report-2026-09-24.md`: Muse Code 1.3.0 has no remote
surface (`muse serve --listen` answers "the unix-socket and websocket
transports are deferred post-v1"), and Muse's connectors run on Meta's cloud
VM against a public HTTPS endpoint, driven by the Muse agent rather than the
user. **Owner rulings:** remote use must happen inside Meta's own apps, with
no phone or web app of ours, so Remote Control waits for Meta
(meta-models/muse-code-sdk#36, filed 2026-09-24 with the owner's go-ahead);
then "fix the bugs you found and implement the able to do now stuff". The
rows below are that list; each is a milestone in §6.

**Owner ruling on paid features (2026-09-24):** "for the api extrase we
could use the muse speach to text as well but any thing that costs needs to
be opt in and loud so the user never inadvertently uses token spend without
knowing". This supersedes the M9 rule of no API cost for speech-to-text, but
only for a paid engine the user turns on; the free OS recognisers stay the
default. The owner then answered two questions:

- **Where:** paid voice is offered on the Model API backend only, so the
  key is only ever spent on the key backend (D1 amendment, the billing
  ruling).
  - **The owner's reason:** "i dont think you can do api key and
    subscription at the same time on the same account".
  - **What Meta's Subscriptions page says (2026-09-24):** both can exist on
    one account, but the subscription "applies to the Muse Code API key
    that is automatically connected in the Muse Code CLI onboarding … for
    use with Muse Code only. Any additional API keys you create … will be
    billed through pay-as-you-go."
  - **So the ruling stands on either reading:** the subscription can never
    pay for Muse Voice, and any key the extension used would be
    pay-as-you-go.
  - **For later:** the subscription plans include voice mode and web search
    inside Muse Code itself, the free path for the Muse Code backend if
    Meta exposes them over MSP (watch item W4).
- **Bypass:** paid calls ask even in Bypass, which skips file and command
  prompts only, never a paid call.

Every paid feature (M33, M34, M35) must therefore be:

1. **Off by default**, with the price in its setting's description.
2. **Confirmed when turned on**: one modal naming the price, whether it is
   turned on from the panel or in settings (a declined confirmation turns
   the setting back off).
3. **Visibly on**: a badge in the composer footer names every paid feature
   that is on, with its price in the tooltip.
4. **Announced per use**: a paid call shows in the transcript as its own
   row marked paid. Image generation asks before each image, in every mode.
5. **Tallied**: the Account & usage dialog shows this window's count of each
   paid call and its estimated cost at the published prices.

| Item                                      | Finding                                                                                                                                                                                                                                                                                                                                       | Change                                                                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.muse/` unprotected (M29, security)      | The Model API backend's protected writes (D24) cover `.git`, `.vscode`, `.agents` and others but not `.muse`; `.muse/hooks.json` binds commands Muse Code runs outside its sandbox and approval, so an agent on the key could plant a hook without asking                                                                                     | `.muse` joins the protected segments; tested in every mode                                                                                                                                                                                                        |
| Skills on and off, imports (M30)          | `muse skills list --json` reports each skill's id, scope and activation; `enable` and `disable` take `--scope`; `muse skills import --from claude\|codex` has a `--dry-run --json` preview. MSP has none of these                                                                                                                             | "Manage skills…" (a checkbox list over the CLI) and "Import skills from Claude Code / Codex…" (preview, confirm, import), Muse Code backend                                                                                                                       |
| Continuing Claude Code / Codex work (M30) | Muse Code bundles `resume-claude` and `resume-codex`                                                                                                                                                                                                                                                                                          | Palette rows that insert them, shown only when the session lists them                                                                                                                                                                                             |
| Export (M30)                              | `muse export` writes the session's JSON trajectory, not a readable transcript; Claude Code's `/export` writes the conversation as text                                                                                                                                                                                                        | "Export conversation…" writes Markdown from the session's own history on both backends; on Muse Code, "Export session log (JSON)…" runs `muse export --session <id> --out <file>`                                                                                 |
| MCP servers and hooks (M31)               | MSP has no MCP or hooks methods; settings live in `~/.config/muse/settings.json` (docs: `mcp_servers` with `transport`; the 1.3.0 binary's migrate skill: `mcpServers` with `type`, `mcp_servers` legacy, both keys at once or `required` beside `mode` drop every server). Hooks: `.muse/hooks.json`, a settings block, `managed_hooks_path` | Read-only views, in keeping with D17 (the extension never writes the CLI's settings): servers listed from either key with Sign in / Sign out (`muse mcp login\|logout` in a terminal) and Open settings; hook sources listed and opened, with the sandbox warning |
| Worktrees (M32)                           | The CLI's `--worktree` is not on MSP                                                                                                                                                                                                                                                                                                          | "New worktree…" (`git worktree add` beside the repository, then open it in a new window) and "Remove worktree…"                                                                                                                                                   |
| Web search (M33)                          | The Model API's Responses endpoint, which the key backend already uses, takes a `web_search` tool: $2.50 per 1,000 searches on top of tokens                                                                                                                                                                                                  | Opt-in and loud (the five rules above); searches shown as paid tool rows, cited sources as links                                                                                                                                                                  |
| Image generation (M34)                    | `muse-image-1.0` at $0.01 per image through the Images API                                                                                                                                                                                                                                                                                    | A `generate_image` tool on the key backend, opt-in and loud, asking before each image in every mode (Bypass included) and writing the image into the workspace                                                                                                    |
| Paid dictation (M35)                      | Muse Voice Transcribe at $0.18 per audio hour, streaming or file; the panel's helpers capture audio on the host machine today                                                                                                                                                                                                                 | An opt-in "Muse Voice" dictation engine on the Model API backend only, loud like the rest: the microphone shows it is paid while it is the engine, and each recording is tallied                                                                                  |
| Session messaging (not built)             | `muse session-message list --json` answers `session_messaging_unavailable` on Windows; the docs exclude headless sessions, and every panel session is a `muse serve` session                                                                                                                                                                  | Not built: the panel's sessions can neither send nor receive. Revisit if Meta extends it to headless hosts                                                                                                                                                        |
| Remote Control (waits on Meta)            | See above                                                                                                                                                                                                                                                                                                                                     | #36 upstream; nothing built here                                                                                                                                                                                                                                  |

### D31 — Rewind finds a hunk that only moved (2026-09-24)

A reader of our Bluesky thread asked whether a hand edit in the same lines
trips the rewind's skip, or whether the patch gets a fuzzy apply first. The
code's answer was: the same skip, no fuzzy apply. `revertHunks` matched each
hunk's lines exactly, but only at the line the edit recorded. So lines the
user merely added _above_ an edit, which leave its text intact, made the
rewind skip it too. That case was stricter than it needed to be, and D27's
row "a file that has moved on is refused" had pinned it.

**Owner's go-ahead (2026-09-24):** "yes fix it". The change refines D27 and
keeps its rule that nothing is guessed:

- **First look:** the hunk's lines (context plus the edit's own) are looked
  for where the edit left them, shifted by however far the previous hunk
  moved.
- **Then a search:** if they are not there, they are looked for anywhere
  after the previous hunk. They are taken only where they occur exactly
  once, matched character for character. This is `git apply`'s offset
  rule without its fuzz factor.
- **Refused, with the reason:** no occurrence (the user changed those
  lines), or more than one (ambiguous).
- **Unchanged:** out-of-order hunks are refused as overlapping, as before,
  and a deletion with no context lines is placed only where recorded.

### D32 — An accessibility gate: WCAG 2.2 AA with axe-core, in VS Code's own themes (2026-09-24)

The owner asked whether Lighthouse and WCAG scans make sense for what is,
in effect, a web app. **Lighthouse: no.** Its Performance and SEO
categories measure a page loaded over a network, and Best Practices is
mostly about HTTPS and browser APIs; the webview is a local bundle inside
VS Code. Its Accessibility category is axe-core, so the gate runs axe-core
itself. **Owner's go-ahead (2026-09-24):** "sure", for axe-core 4.13.0
(MPL-2.0) as a dev dependency and a gate of its own.

- **What is checked:** every harness scenario (`test/harness/`, the
  webview behind a fake host, 52 today) in each of VS Code's four default
  themes, against axe's WCAG 2.0, 2.1 and 2.2 rules at levels A and AA
  (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`), colour
  contrast included. Any violation, or a page that reports no result,
  fails the gate.
- **Real colours, not a guess:** `scripts/capture-themes.mjs` starts the
  VS Code build the integration tests use (1.139.0) once per theme
  (Default Light Modern, Dark Modern, High Contrast, High Contrast Light)
  and reads the workbench's `--vscode-*` values over the DevTools
  Protocol. Only the variables the webview uses are kept, in
  `test/harness/themes/<kind>.json`. A colour a theme leaves unset is
  unset in the harness too, so the stylesheet's own fallback is what gets
  measured, as in a real webview. Rerun it when VS Code's themes change.
- **One exemption, said out loud:** a `target-size` finding whose related
  elements all sit in a menu, popover or dialog the user opened, which does
  not hold the target and overlaps it on screen. WCAG's Understanding
  document for 2.5.8 puts targets obscured by content the user displayed
  out of scope. Every run prints each exempt element and counts it (8
  today, all in the `rewind` scenario, where an open menu covers two
  chevrons). A target crowded by its own neighbours inside a menu is not
  exempt (the review of PR #18).
- **What axe cannot decide fails too** (the review of PR #18). axe files
  what it cannot settle under "incomplete"; the gate fails on it like a
  violation, with two exceptions. Contrast on text axe could not see where
  it looked (covered by an opened menu or dialog, or scrolled out of the
  transcript's view) and on glyph-only content is counted and printed, not
  failed: about 2,430 (a few either way between runs) and 60 elements today. The rows scrolled out of view in the
  long transcripts are the same kinds of row that other scenarios show and
  check.
- **How the violations were fixed:**
  - A control inside an ARIA option is not a control of its own (4.1.2).
    The effort dots in the palette row and the History row's archive mark
    are for the mouse only and hidden from assistive technology. The row
    carries the value and the keys: Left and Right step the effort, and
    Delete archives or restores the highlighted History row.
  - The palette and History lists are Tab stops, so they scroll from the
    keyboard (2.1.1). Focus moving into the list keeps the dialog open;
    leaving the dialog closes it, and Escape works from the list too.
  - Text below 4.5:1 takes the text colour: diff line numbers, a failed
    tool's reason (the error colour stays, as a bar beside it, which needs
    only 3:1), and the grey detail on a selected row.
  - Radio and checkbox answers in a question card get a 24 px row (2.5.8).
  - The Modes menu's effort dots are 24 px targets around the same 12 px
    dot (2.5.8; axe had left them undecided).
- **Limits:** automated rules find only part of what WCAG asks. Screen
  reader output, reflow at 400 % zoom and focus order inside the real VS
  Code window are not covered by this gate. Keyboard behaviour is covered
  by the component tests.
- **Cost:** about 2.5 minutes locally (six headless Chrome workers over
  208 pages).
- **Where it runs:** in `npm run quality` and `quality:ci`, after
  `quality:gates` has built the production bundle. In CI it is a step of
  its own on Linux (3 min 20 s) and Windows (4 min 33 s). It is not run on
  macOS: that runner's headless Chrome had not finished after 28 minutes,
  and the job timed out (PR #18's first run). This is an exception to A10's
  "full gate set on all three". The page it checks is the same web content
  on every platform.

### D33 — The panel in VS Code's display languages (2026-09-25)

The owner said "yes" (2026-09-24) to the fourteen languages VS Code itself
ships, with machine translations disclosed. What the survey of the code
found shaped the design: about 570 keys in `UI_TEXT`; 128 places that
splice a `UI_TEXT` fragment into a sentence (`"Thought for" + "3s"`,
`"step" 1 "of" 2`); singular and plural pairs chosen with `=== 1`; relative
times built by hand (`"min ago"`); labels outside the table
(`PERMISSION_MODE_LABELS`, `TOOL_LABELS`, `EFFORT_LABELS`, `'edit' :
'edits'`); and text that goes to the model mixed in with text the user
reads.

- **Two tables, one of them never translated.**
  - `MODEL_TEXT` holds what the model or Meta reads. It stays English
    whatever the display language, so the model's behaviour does not
    change with the user's locale. It covers the context leads, the
    compaction prompt and prefix, the steering and answer prefixes, the
    skill invocation, and the tool failures returned to the model.
  - `UI_TEXT` is what the user reads, and it is the one translated.
  - The log stays in whatever language the notice was shown in (M39 logs
    the shown line); that is accepted, since the log carries ids and
    error details, which are not translated.
- **Whole sentences with named slots.** A spliced sentence becomes one
  template, `'Thought for {duration}'`, filled by `fill(template, values)`,
  so a language can put the slots where its grammar needs them. The key
  names the slots; the gate checks every translation has the same ones.
- **Plurals by the language's own rules.** A count-dependent string is an
  entry of plural forms, `{ one: '{count} agent', other: '{count} agents' }`,
  and `plural(entry, count)` picks the form with
  `Intl.PluralRules(locale)`. Each translation carries exactly the
  categories its language uses: Russian, Polish and Czech have `few` and
  `many` as well.
- **Numbers and times from `Intl`.** Counts use `Intl.NumberFormat` and
  "5 min ago" uses `Intl.RelativeTimeFormat`, both in the display
  language, so those strings leave the table.
- **Where the tables live, and why not in the bundle.** English stays in
  TypeScript (`src/shared/l10n/en.ts`); it is the base and the type every
  translation must match. The fourteen others are JSON files in `l10n/`,
  shipped in the package and not bundled: fourteen copies of about 40 KB
  would push the webview bundle (654 KiB today) past its 900 KiB budget.
  - At activation the host maps `vscode.env.language` to a table, reads
    that one file and checks its shape with zod.
  - The host embeds that table in the webview's HTML, as a JSON
    `<script type="application/json">` (not executed, so the CSP is
    unchanged). It also sets `<html lang>` for screen readers. The webview
    installs the table before its first render.
  - A display language without a table (Arabic, say) gets English, and
    the log says so once. A table that fails its check also gets English,
    with a warning; the gate keeps such a file from shipping.
- **The manifest** (commands, settings, views, the walkthrough's titles)
  moves to `package.nls.json` and `package.nls.<language>.json`, which
  VS Code applies itself. The walkthrough's Markdown pages stay English;
  VS Code localizes the step titles and descriptions, not the pages.
- **The gate** (`scripts/check-l10n.mjs`, in `quality:gates`) checks
  every language against English:
  - every key present and no extra ones;
  - the same `{slots}` in each string;
  - the same number of code spans and bold markers;
  - exactly the plural categories `Intl.PluralRules` gives that language;
  - no value left equal to the English, except an allowlist of names and
    commands (Muse, MCP, `/export`, …);
  - the same checks for the manifest's strings.
- **Seen, not assumed:** the harness takes `?lang=` and renders any
  scenario in any table, so long German and CJK strings are checked for
  layout in screenshots, and the accessibility gate checks one full run
  in a translated table.
- **Two pull requests.** M40a is the machinery, the refactor, the English
  table and the gate. M40b is the fourteen translations, the README's
  disclosure and the screenshots.
- **Honesty:** the translations are machine-made; the README says so and
  asks for corrections through issues.

### D34 — The paid features, as built (2026-09-25)

The owner said "do it" (2026-09-25) to M33–M35 under D30's five rules. What
Meta's documentation says (read 2026-09-25, public pages, no key used or
spent; the Muse Code subscription never pays for any of this, D30):

- **Web search** is a Responses tool, `{"type": "web_search"}`, billed at
  $2.50 per 1,000 search queries on top of tokens. `include:
["web_search_call.results"]` adds the results (title, URL, snippet) to
  each `web_search_call` item. Replies carry `url_citation` annotations,
  complete only once the response is ("the cookbook"). Earlier
  `web_search_call` items may be replayed. The usage object has no search
  count, and Meta does not say how a call with several queries, or one that
  opened a page, is counted.
- **Images** are `POST /v1/images/generations` with `muse-image-1.0`: $0.01
  per image returned, whatever its size; failed and filtered ones are not
  billed. `size` sets only the aspect ratio. `b64_json` returns the image
  inline; `output_format` takes png, jpeg or webp.
- **Muse Voice Transcribe** is not OpenAI-shaped: `wss://api.meta.ai/v1/asr/realtime`,
  whose first text frame carries the key (Meta ignores the Authorization
  header there) and the audio format; binary frames of 16-bit mono PCM at
  16 or 24 kHz, paced at real time; `{"type":"endStream"}` at the end.
  Push-to-talk mode sends cumulative partials and marks the final one.
  $0.18 per hour of audio, rounded down to whole seconds.

The choices:

- **The gate.** A feature is on only when its setting is on _and_ the user
  accepted its price in a modal that names it; the acceptance lives in the
  extension's global state. A setting turned on anywhere (the palette, the
  Settings editor, settings.json, another window, while VS Code was closed)
  is confirmed by the focused window when it notices; a declined
  confirmation turns the setting back off; turning a setting off forgets the
  acceptance. The three settings are machine-scoped (D15), so a repository
  cannot turn one on.
- **Loud.** The composer's badge names every paid feature that is on, with
  the prices in its tooltip, on the Model API backend only (the one that
  uses them); the palette's toggles live there too. Each search and each
  image is its own transcript row marked "paid", with the price in its
  tooltip; the microphone is ringed and says "Muse Voice (paid)" while that
  is its engine. Account & usage shows this window's count of each and its
  estimated cost.
- **Search.** The tool is sent only while the feature is on, never in a
  compaction. Rows complete on `output_item.done`, or from the completed
  response when the stream never finished them. Each query is counted, and
  a call that opened a page counts once, so the estimate errs high; a failed
  search is not counted. A reply's sources are listed under it, taken again
  from the completed response. The search is replayed without its results.
- **Images.** `generate_image` (prompt, workspace path ending in `.png`,
  square, landscape or portrait) is offered only while the feature is on.
  Every call asks, in every mode, Bypass included, with "Allow once" and
  "Reject" only (superseded by D48: the paid-use popup, which adds "Allow
  always in this workspace"); Plan refuses it, since it writes a file. The card is not a
  file write, so Edit automatically never answers it, and it shows the
  prompt and the price. What cannot be saved is refused before the card (a
  taken path, a wrong extension, a path outside the workspace, a prompt
  over 4,000 characters), so nothing is billed for it. After the card the
  gate is checked again, and the file is reserved (created empty,
  exclusively) before the image is bought, so a feature turned off or a path
  taken while the card was open costs nothing. The request retries a 429
  only: a lost connection or a server error may have made and billed an
  image. The reply must start with the PNG signature, and the file is
  created, never overwritten (the review of PR #27).
- **Muse Voice.** The microphone's engine is Muse Voice while the feature is
  on and the window runs on the Model API key; otherwise the free recogniser
  as before. The audio comes from a capture helper speaking the helper
  protocol with one more line, `audio`: `native/windows/capture.ps1` (the
  waveIn API through a C# type Windows PowerShell compiles when the helper
  starts), the Swift helper's `--capture` mode (AVAudioEngine, microphone
  permission only), or on Linux the system's `arecord` or `parec`. Audio
  recorded before the stream is up is held, then sent; the final text lands
  at the caret; every whole second sent is counted. Turned off (or the
  backend changed) mid-recording, the recording stops at once and the
  transcript of what was already sent still lands (the review of PR #27).
  Linux gets a microphone for the first time, on the paid engine only.

### D35 — Replay as Meta validates it (2026-09-25)

A full read of Meta's Model API documentation for the parity audit
found the Model API backend breaking three of the documented rules for a
conversation replayed by the client (protocols/responses, "Conversation
structure", "Message phase", "Reasoning item ordering"; error-handling,
"Invalid conversation structure"). None had been seen live: the owner has
held no key since 2026-09-22, and the fake API followed our own assumptions.

- **Commentary.** Text the model writes before a tool call comes back with
  `phase: "commentary"`. Replayed as an ordinary answer before a
  `function_call`, it is a 400, so the next request of any turn where the
  model narrated before a tool failed. Now replayed with its phase; a final
  answer (no phase) stays without one.
- **Reasoning summary.** A replayed reasoning item must carry `summary`,
  `[]` when there was none; it went back as it came, possibly without one.
- **Reasoning alone.** A reasoning item must be followed by a message or a
  call before the next user message; a reply that was reasoning alone is now
  followed by a minimal assistant message ("(no reply text)", model text),
  as the docs say to do.

Two retry rules were missing too (error-handling): a 502 is retried like the
other server errors (a 504 still is not: every long request streams), and a
stream that ends with an `error` event of `server_shutting_down`,
`service_overloaded` or `backend_unavailable` is sent again whole, with the
turn's retry notice; what the cut-short stream showed stays in the
transcript (a search row cut short reads "interrupted" and is not counted),
and only the retried response is replayed.

### D36 — Everything Muse Code and the Model API offer, on both backends (2026-09-25)

The owner (2026-09-25): "we need to make sure we are covering all of the
provided functionality with feature rich robust enterprise grade production
ready access and not omitting or missing any", then "i want everything fixed
everything properly implemented and this app to be fully realized feature
rich and production ready", and "web search and images are pretty important
to be able to use on each i want the api and cli to be as close to feature
parity as we can get them". Live checks no longer need his go-ahead; they
use the contributor models and are counted and reported (2026-09-25).

Two read-only inventories (2026-09-25, no model or paid call; saved in the
session scratchpad as `inventory-muse-code.md` and `inventory-model-api.md`)
listed every capability: Muse Code 1.3.0 from `muse schema` (47 MSP methods,
33 notifications), every `--help`, the binary's tool list and settings keys,
all eleven Muse Code docs pages and ten cookbook recipes, the owner's trace
and session logs (tool names only), an isolated echo run and a live `muse
serve` probe (logged out, so no model call); the Model API from every page
of its documentation. What reaches the panel, what does not, and the
milestone that closes each gap (the rows updated on 2026-09-27 to what
0.9.0 ships):

| Capability                        | Muse Code (subscription)                                                                                                                                                                                  | Model API (key)                                                                                                                                    | Milestone           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Replay Meta accepts               | the CLI's own                                                                                                                                                                                             | fixed: commentary phase, reasoning summary, reasoning-only turns, stream retries                                                                   | M42 (merged)        |
| Tool rows for every tool          | a named row for every tool Muse Code runs: memory, goal, cron, workflow, web, work, input and reminder tools; tool-result images shown (M43)                                                              | the extension's own tools render                                                                                                                   | M43 (merged)        |
| Web search                        | Muse Code's own `web_search`, covered by the subscription (ran in `muse serve`, 2026-09-22); its results render as links (M43)                                                                            | paid, opt in (M33)                                                                                                                                 | M43 (rows, merged)  |
| Images                            | Muse Code's `image_generation` is gated off (no switch found); the extension's `ide` server offers image and image-edit tools billed to a stored key, a dialog per image (M44, D37)                       | paid, opt in (M34); image edits (M44)                                                                                                              | M44 (merged)        |
| Web fetch (read a page)           | Muse Code's `web_fetch` is gated off                                                                                                                                                                      | none                                                                                                                                               | M69 (D49; was M44b) |
| Goals                             | MSP `goal/*`, `session/goalChanged` and the resumed snapshot's goal: the goal strip and `/goal` (M45)                                                                                                     | Muse Code's four goal tools, stored, pinned; no loop turns of its own (M45, D38)                                                                   | M45 (merged)        |
| Background work, stop             | MSP `task/background`, `task/stop`, `task/stopAll` wired to rows, Agent map and Ctrl+B (M46)                                                                                                              | shell calls can move to the background and be stopped; output reaches the next request (M46)                                                       | M46 (merged)        |
| `!` user shell                    | MSP `session/userShell` with the `userShell` grant; `!` prompt and row (M46)                                                                                                                              | the shell runner, outside turns, with output in replay (M46)                                                                                       | M46 (merged)        |
| Workflows                         | captured run and agents render as a read-only card (M47, D40); owner controls wait for a live accepted-command capture                                                                                    | none (Muse Code's own engine)                                                                                                                      | M47 (merged)        |
| Subagents                         | map and controls (M14, M18); native `reopen` and `readResult` wait for live success captures                                                                                                              | opt-in paid child tasks with one-use consent and four-request cap (M48, D45)                                                                       | M48 (merged)        |
| Memory                            | Muse Code memory tools and the shared Memory view (M49, D41)                                                                                                                                              | memory tools and snapshot over the same notes; native writer-lock parity remains unproved                                                          | M49 (merged)        |
| MCP servers                       | loaded by Muse Code; read-only view (M31)                                                                                                                                                                 | extension MCP client and Windows job containment built; merged as PR #37 after local and hosted gates                                              | M50 (merged)        |
| Hooks                             | run by Muse Code; read-only view (M31)                                                                                                                                                                    | machine opt-in hooks from managed, user and project sources, only in a trusted workspace; 17 event names wired                                     | M51 (merged)        |
| Scheduled prompts (`/loop`, cron) | the agent's `cron_*` tools, shown as rows (M43); no list or cancel over MSP                                                                                                                               | `/loop` jobs kept per conversation and key; a due run only after the paid gate and a per-run confirmation (M52)                                    | M52 (merged)        |
| Rewind a conversation, side chat  | conversation rewind and Side chat through `session/fork` (refused by Muse Code 1.3.0 on Windows)                                                                                                          | conversation rewind and a Plan-mode Side chat (M53, D46)                                                                                           | M53 (merged)        |
| PDFs and files as input           | MSP takes text, images and skills only: picked UTF-8 text files travel as named text; a PDF names the Model API backend                                                                                   | PDFs and images attached or read by `read_file`; UTF-8 text files as named text (M54, D47)                                                         | M54 (merged)        |
| Questions: clarify                | `userInput/clarify` wired to Explain instead (M46)                                                                                                                                                        | `ask_user` accepts the explanation (M46)                                                                                                           | M46 (merged)        |
| Sign-in in the panel, install     | `account/*` device-code sign-in in the panel; **Install Muse Code** runs Meta's installer in a terminal (M55)                                                                                             | key pasted, or added from Account & usage while Muse Code is signed in                                                                             | M55 (M41; merged)   |
| Network posture, enterprise       | `--sandbox-network` from `museSpark.sandboxNetwork`; VS Code's proxy handed to Muse Code; `muse config status` in Diagnostics (M56); `--no-session-log` not offered (D43)                                 | fetch and the voice socket through VS Code's proxy and certificates; network failures named; a stable prompt-cache key and retention setting (M56) | M56 (merged)        |
| Voice                             | the OS recogniser (free); Muse Code's own voice is TUI-only and not on Windows                                                                                                                            | the OS recogniser, or Muse Voice (paid, M35)                                                                                                       | —                   |
| Everything else already at parity | sessions, history, fork, rename, compaction, export, steering, queue, approvals with stages and scopes, questions, todos, usage, model, effort, modes, skills, rules, worktrees, attachments, diagnostics | the same, through the extension's own harness                                                                                                      | —                   |

Rulings carried: the subscription never pays for a Model API call, and the
key is never handed to `muse serve` (D1); a paid call is opt in and loud
(D30). Images on the Muse Code backend therefore run through the extension's
own session MCP server (the `ide` server Muse Code already loads, M5) with
the key, billed and announced exactly as on the Model API backend (M44).
What Muse Code keeps to its TUI and cannot be reached over MSP (its theme,
keymap, vim mode, HUD, deep research, feedback upload, voice) is listed and
not imitated, except where the panel has its own equivalent.

### D37 — The key's paid features on the Muse Code backend (2026-09-25)

The owner (2026-09-25): "web search and images are pretty important to be
able to use on each". Web search already works on both: Muse Code searches
with its own tool on the subscription, the Model API backend with Meta's
paid search (M33). Images did not: Muse Code 1.3.0's `image_generation`
tool is switched off in `muse serve` with no setting that turns it on
(inventory, 2026-09-25).

- **Images come from the extension on Muse Code.** The `ide` session
  server every Muse Code session already loads (M5) offers `generateImage`
  and `editImage` while image generation is on (D30) and a Model API key
  is stored. The extension makes the image itself with the key, through the
  same pipeline as the Model API backend (`prepareImageCall`,
  `runImageCall`): every check before the question, the file reserved
  before the purchase, the PNG checked. The key never reaches `muse serve`
  (D1), and the subscription never pays for an image.
- **Asked in a dialog, every time.** Muse Code's own approval covers using
  the tool, in whatever mode it runs; the extension's modal covers buying
  the image: the path, the prompt, the sources and the price, billed to the
  key. Declining refuses the call and buys nothing.
- **Loud as on the Model API.** The rows (`mcp__ide__generateImage`,
  `mcp__ide__editImage`) are marked paid when the items are read, the
  tally counts the images, and the palette's toggles, the composer's badge
  and Account & usage show the key's features on Muse Code while a key is
  stored (`usablePaidFeatures`): images and Muse Voice, not web search.
- **Muse Voice** works the same way: the microphone's paid engine on Muse
  Code while a key is stored.
- **Image edits** (`edit_image`, Meta's `/images/edits` with the sources as
  data URLs) join generation under the same setting, gate and price, on
  both backends.
- **The tool list is read per request**, so a session started after image
  generation is turned on (or a key is stored) gets the tools; one already
  running gets them when it next starts.

### D38 — Session goals on both backends (M45, 2026-09-25)

What Muse Code 1.3.0 does, from msp.d.ts, its goal-tracking recipe and
interactive docs, the strings of its goal store, and a live capture
(2026-09-25, `C:\muse-live-m45` and `C:\muse-live-m45-stop`, three turns,
nine model attempts on the contributor model, `docs/certification/m45.md`):

- **The user's verbs** are MSP `goal/set`, `edit`, `pause`, `resume` and
  `clear`, each acknowledged at admission (`{ commandId, status, turnId? }`).
  A set, edit or resume that leaves the goal active while the session is
  idle wakes a goal-driving turn, which the ack names and which has no user
  message item; while a turn runs, the ack names that turn and nothing
  starts. Pause and clear never wake. An edit of a paused goal keeps it
  paused and wakes nothing.
- **Refusals** are `commandRejected` (-32030) with `data.reason`
  `missing_goal` (any verb but set, with no goal) or `invalid_goal_state`
  (pause, resume or edit of a finished goal). A blank objective, or an
  objective on a bare verb, is `invalidParams`.
- **The goal** arrives as `session/goalChanged`: `{ objective, status,
percentComplete, currentWork?, nextWork? }`, or `goal: null` when
  cleared. It is not repeated on a resume. Only a resume served as a
  snapshot carries it (`snapshot.state.goal`, `null` for none); inline
  history does not. The goal store's statuses are active, paused,
  complete, blocked, usage_limited and budget_limited.
- **Its loop** pins the goal for the agent, queues a turn of its own to
  continue after a turn that left the goal unfinished, reminds the agent to
  report progress after about ten model calls without any (the step
  probe), runs a completion audit (a reminder agent's model call) before
  `update_goal` may close the goal, and pauses an unfinished goal when its
  turn is stopped (Esc in the TUI; `turn/cancel`, the panel's Stop, too).

The choices:

- **Muse Code.** `session/goalChanged` and the resumed snapshot's goal
  reach the panel; a resume now asks for `history: "snapshot"` (the same
  items as inline, plus the name, the task list and the goal, so a resumed
  conversation's task list comes back too). A snapshot goal is read on its
  own: a shape that differs costs the strip, never the resume. A fork's
  history takes no preference, so a fork's goal shows once Muse Code
  reports it.
- **The Model API backend** gets Muse Code's four tools with its argument
  names, rules, failure messages and result shape (`{ goal: { session_id,
goal_id, … } }`), so the M43 rows render identically. The goal is stored
  with the session and pinned into the instructions while it is active, as
  the last section so the rest stays the same from call to call. Muse
  Code's step probe becomes a note in that section after ten model calls
  without progress, with no call of its own. Tokens used while the goal is
  active count against a budget the agent gave it, and a spent budget stops
  it. Stop pauses an active goal. The user's verbs follow MSP's rules and
  refusals; a set, edit or resume that leaves the goal active while nothing
  runs starts one visible turn whose cue is Muse Code's own ("Continue
  working toward the active session goal."), replayed for the model but
  not shown as a message, as Muse Code's goal turns have none.
- **Not on the Model API, on purpose:** no turn of its own after a turn,
  and no completion audit. Each would be a model call billed to the key
  that the user did not ask for. The audit's rule is in the pinned section
  instead. A fork carries the goal as it stands, having no history to cut.
- **The panel.** The goal strip sits above the task list while there is a
  goal: the objective, the status in words (one Muse Code adds later as it
  came), the percentage, a bar clamped to 0–100, now and next. Its buttons
  are the verbs the status allows (Pause or Resume, Edit in place, Clear).
  `/goal …` in the prompt reads the TUI's grammar and is a command, never a
  message; the palette's `/goal` leaves `/goal ` ready. A done command is a
  line in the transcript, a refusal a warning in words, and the live region
  reads each change of status.

The review of PR #31 found two Model API goal edges to close before M45
merges: when a streamed reply spends the goal's token budget, its returned
tools must get cancelled outputs and must not run or cause another automatic
model request; and a set, edit or resume accepted during a reply with no
tools must put an internal goal cue into the same turn's next request. The
second review found two more boundaries: a goal wake queued during
compaction must be withdrawn if compaction spends the goal's budget, and a
bare pause, resume, edit or clear on a fresh panel must refuse without
creating an empty session. Each needs a regression test and red drill before
the PR is certified.

The next review and a focused lifecycle audit found five more boundaries:
usage belongs to the goal active when each request attempt began, including
compaction and retries; Stop during compaction pauses an active goal; a
rejected `/goal` command keeps its draft while an accepted one clears only
the unchanged draft; the goal editor resets when the goal changes or clears;
and an incomplete compaction cannot replace history with a partial summary
or escape usage accounting. These are M45 corrections, not new quota or
model features; they require regression tests and red drills before merge.

The following PR review also requires inline goal edits to keep their
objective until the host accepts the edit, with rejection preserving the
field; and the new `session/goalChanged` notification must be parsed under
its literal method instead of adding an unregistered `as z.infer` cast.
The next review found a separate unchecked assertion in the Model API
goal-tool test; its assertion now checks the unknown response as a value
with matchers, without claiming a compiler-verified tool-array type.
The following review found that a response started before `/goal set` or
`/goal edit` could still complete the replacement goal with its old goal
tools. Each Model API request now retains the revision of user goal commands
at its start. A mutating goal tool from an older revision fails with a
replayable output, while the accepted command's wake gives the model the
current goal in its next request.
The next review found two recovery gaps: `session/read` serves inline items
without a goal, so reloading after a `view/gap` could leave a cleared or
completed goal stale in the panel; and a failed compaction recorded billed
tokens in memory but not always in the stored session. Gap reloads now use
the last durable `session/goalChanged` from backward `view/page` reads when
inline history cannot answer, and Model API usage is persisted after both
goal and cumulative counters update. The new view shape was captured live
without a model turn (M45 certification); the tests and red drills cover
clear, completion, paging and persisted failed compaction usage.
The following review found that saving each Model API usage update can
persist a function call before its pending approval or tool has produced an
output, making replay invalid after a crash. Normal turns now save at their
existing settled boundary, while compaction saves in its `finally` after
its usage and status settle. A captured-save regression test guards every
snapshot written during a pending `ask_user` call.
The independent M45 audit found that goal tools, goal commands and settings
changes could still save a pending normal-turn call, so the store now defers
any snapshot with an unanswered function call while preserving safe
turn-start saves and live session-list updates. It also found that a resume downgraded to inline
history needs the same durable goal read as a gap reload, and that a live
goal event arriving during a gap read must win over that older read. Focused
tests and red drills cover both paths.
The next PR review found that a goal accepted during the last Model API
tool round could remain idle: its pending wake was never drained before the
round cap failed the turn. The cap still ends that turn; when the goal is
active, its accepted wake is queued as a fresh bounded turn so the next
request receives the objective.
The subsequent audit found the same final-round loss for accepted steered
input, duplicate queued goal wakes when a goal is replaced during compaction,
and Stop after a compaction summary committed but before token counting
returned. Steered input now queues fresh user turns at the round cap; queued
goal wakes carry the user-command revision and withdraw when superseded;
late Stop keeps the committed summary but pauses further goal work. The
following PR review found a stale inline goal editor after gap recovery and
an old session's goal acknowledgement posted after the panel switched
History sessions. The editor reconciles with recovered goals under the same
own-edit/newer-draft rules as live events, and the controller routes goal
acknowledgements only to their operated session.
The follow-up audit found three more races: a late `sessionNotLoaded`
refusal from an old goal RPC could still replace a newer History session
inside the retry helper; Stop during post-summary counting could pause a
goal set after Stop; and steering accepted while a reply spent the goal's
budget could be silently dropped. The retry helper now checks the operated
session before resuming it, Stop pauses its goal at the time of the action,
and accepted steering gets a fresh ordinary turn when the goal budget
terminates the old turn.
The next PR review found that Model API objective validation exposed an
English model-facing error to translated users, and that a suppressed late
goal acknowledgement could leave the new session's composer stuck with the
old pending command. Objective validation now returns a reason code: model
tools keep Muse Code's English result, while user goal commands read a
localized message and format the limit with `Intl`. A History switch clears
the old pending command correlation. Both paths have focused red drills.
The final focused audit found JavaScript's UTF-16 `.length` counted a
supplementary character twice against the 4,000-character objective limit.
The Model API validator now counts grapheme clusters (so a joined emoji is
one visible character) and stops after 4,001; the 14 translated limit
messages still format the number with `Intl`.
The next PR review found that Stop on an ordinary Model API turn paused a
replacement goal if the old turn took time to unwind. Stop now pauses its
current goal synchronously, and a goal accepted while that aborted turn is
still attached queues a fresh wake. Steering after Stop is explicitly
refused instead of being accepted into a turn that cannot run it.
A follow-up cancellation audit found that a buffered completed reply could
return after Stop and take the budget-limit or round-cap branch before any
abort check, re-queuing steering that Stop had cancelled. The loop now checks
the abort before each round and immediately after each response; returned
calls receive cancelled outputs for replay validity, with no tool or
steering continuation.

### D40 — Workflows: captured read-only run card and setting (2026-09-25)

M47's live capture (one turn in an empty folder on the contributor model,
eight model attempts; `docs/certification/m47.md`) showed what a workflow
is on the wire. The `workflow` tool call carries the script the model
wrote (`{"script": …}`) and answers with a launch (`status: "launched"`,
`scriptPath`, `workflowRunId`); a separate `workflow` item follows, with
`workflowRunId`, `entryId` (`generated.model-chosen` for a script the model
wrote), `scriptId`, `triggerSource` (`guidanceAuto`), `fallbackText`, a
`children` list in each captured revision, and, on completion, a
`message` wrapping a JSON report in `<workflow-launch-reconciled>`. The
launching turn ended before the run did (8.0 s against 10.5 s); the run's
completion then started a turn of its own, the model's reply. The choices:

- **A card, not a generic row.** The item becomes its own row kind: the
  captured generated name ("Written for this task"), otherwise its raw
  `entryId` or fallback text without interpreting it as a saved name; status,
  agent count and tokens, what started it, its agents, and the report's
  `final_summary.summary` (or `latest_failure`); a message that is not the
  report is shown as it came. The card outlives its turn: it is never
  settled as interrupted when the turn ends, and its updates, which keep
  naming the launching turn, are never taken for a subagent's strays.
  A status Muse Code adds later keeps a plain dot alongside its verbatim
  text; only known failed or cancelled statuses get a failure mark.
- **Agents as Muse Code tells them.** A child is keyed by `childId`. Muse
  Code drops a field once the agent moves on (the label comes only with
  `scheduled`, the tokens only with `usage`), so the row keeps what it was
  told. The capture showed label carry within one attempt. As a conservative
  UI policy, a new attempt keeps the label and starts its own outcome,
  time and tokens; no multi-attempt frame was captured. Each supplied
  `children` list is treated as authoritative by the UI, so a child absent
  from it is removed; no omission frame was captured.
  A child whose shape differs costs that child, a field
  that differs costs that field, never the run (as `modelVisibleContent`
  since the review of PR #29).
- **Controls deferred.** Muse Code's MSP lists `workflow/cancel` and
  `workflow/childControl`, and M47 captured only rejected requests against
  a finished or missing run (`already_terminal`, `invalid_target`,
  `missing_run`). No accepted command ack, successful Skip/Retry, or running
  cancellation was captured. The panel therefore offers no workflow owner
  buttons or callable control path yet. Before a follow-up enables them,
  capture their live success shapes and outcome events, then validate the
  ack and enforce source-session ownership. Pause and resume have no MSP
  verb and remain outside the panel.
- **Resume-source evidence limit.** The live tool call captured for M47
  carried an inline `script` and its launch result carried `scriptPath`.
  No resumed-workflow tool arguments were captured, so the Workflow tool
  row does not interpret an input `scriptPath` or claim a resume-source
  file. That display waits for a live owner capture of a resumed run.
- **Child phase evidence limit.** The seven captured child revisions had no
  `phase` value. The card does not parse, carry forward or display one
  until a live frame establishes its meaning and lifetime.
- **No agent transcripts.** A workflow child has no `childSessionId`, none
  of its items reaches the parent's stream, `session/read` of its id
  answers `sessionNotFound`, and `subagent/readResult` with it is admitted
  and then sends nothing (free probes after the capture). The Agent map
  lists the runs with the same read-only view instead, and the header's
  pill counts their agents.
- **The trigger setting, read.** `run.workflow_trigger_mode` is read from
  Muse Code's settings file as `run.subagent_delegation_mode` is (D17),
  each member on its own; unset, it reads `auto`, as 1.3.0 ran (the owner's
  file has no `run` block, and the session's workflow guidance was the auto
  one). The Agent map says what the mode means and how to change it, with
  the file a click away, and Diagnostics names it. Opening the map now
  reads these account facts itself; before, the delegation note waited for
  Account & usage to have been opened.
- **Cost.** A workflow spends the subscription like any turn (each agent
  makes its own model calls, up to 1,000 over a run), so it is not a paid
  feature under D30; the auto mode's note says so. The card's token figure
  sums each child's latest reported attempt, not the subscription's billed
  total across retries (no retry run was captured).
- **Model API parity: none.** Workflows are Muse Code's own engine (its
  JavaScript script engine and child runs); the Model API backend has no
  workflow run to show.

### D44 — Versions stay below 1.0 until the owner calls it (2026-09-25)

The owner (2026-09-25): "i dont think a 1.0 would be right until the app
has been on the market and field tested for a while … stay under that 1.0
mark until im confident the app is worthy of being called the first full
version". He suggested a fourth number (0.8.0.1); the Marketplace and
`vsce` accept only a three-part semantic version, so:

- **Minor for a batch of features, patch for fixes.** The minor number keeps
  counting past nine: 0.9.0, 0.10.0, 0.11.0 and so on, each newer than the
  last, with no ceiling below 1.0.
- **1.0.0 only on the owner's word**, after the extension has been on the
  Marketplace and field tested; no release proposes it on its own.

### D39 — Background work, the user's own shell, explanations, on both backends (2026-09-25)

D36's rows "Background work, stop", "`!` user shell" and "Questions:
clarify" (M46). Two live captures on the contributor model (27 model
attempts, `docs/certification/m46.md`) gave the wire shapes:

- **`task/background`** on a running shell call answers
  `{commandId, status: "accepted", taskId}`, and an `item/updated` with
  `background: true, backgroundInitiator: "user"` arrives before the answer.
  The turn goes on; the model's tool result is Muse Code's background
  envelope (`execution_state`, `work_id`). **`task/stop`** ends it as
  `cancelled`, `failureReason: "cancelled by runtime client"`.
  **`task/stopAll`** is accepted over nothing too. A task that is not
  there is refused `commandRejected` with `data.reason: "invalid_target"`.
- **`session/userShell`** needs the `userShell` grant at the handshake
  (granted once asked). Its item is `userShell` with `turnId: null`,
  `commandText`, and at the end `exitCode`, `durationMs` and the output
  (no deltas): exit 0 completes, any other fails ("tool failed: exit code:
  3\nstdout: …"). With the Windows sandbox on and not set up it fails
  with "managed shell sandbox is unavailable". Its item id is not a
  UUIDv7, and `task/stop` refuses it as invalid params: a `!` command
  cannot be stopped on Muse Code. The model sees it with the next turn
  (asked, it named the word the command printed).
- **`userInput/clarify`** takes `clarification: {format: "text", content}`
  and settles the prompt `clarified`, no answers, the text beside them; the
  model answers from it.

The choices:

- **Ctrl+B** is a contributed command, **Muse Spark: Move Running Command
  to Background**, bound to `ctrl+b` on every platform (the TUI's key;
  `Cmd+B` stays VS Code's sidebar on a Mac) only while the conversation in
  view runs a shell call in the foreground: a context key the controllers
  keep, for the surface in view. It moves every such call. A running shell
  row has the same as a button. Only shell calls are offered: they are what
  the capture moved.
- **Stop** is on a background row and in the Agent map, with **Stop all**
  there and **Muse Spark: Stop Background Tasks** in the palette. A button
  waits for the host, as a decided approval card does (M25): the row's next
  update or a refusal (`taskRefused`) frees it. A stopped row reads
  "Stopped" with its reason, on both backends.
- **The Model API backend runs the same** (D36 parity, not too large to
  build): a shell call runs on its own stop, linked to the turn's until it
  moves. Moved, the call answers the model at once
  (`MODEL_TEXT.shellMovedToBackground`), the row is updated and kept in the
  history running, and the command's time limit is lifted (a
  `ShellTimeLimit` the runner binds, the job-object runner unchanged
  otherwise). When it ends, the row completes and what it printed is added
  to the replay as a user note: at once while nothing runs, else at the
  running turn's next request or its end, never inside a call and its
  output. Muse Code's runtime wakes its agent when background work ends;
  this backend makes no model call nobody asked for, so the note waits for
  the next request. The turn's Stop leaves a moved command running; its
  own Stop, Stop all and the session closing end it. A stored session
  brought back, or a fork, shows a command its original still runs as
  interrupted, and a stored one also tells the model the command ended
  with its window.
- **`!` commands** run as typed, outside any turn, with no approval card in
  any permission mode (the user typed them), and never in Restricted Mode
  (D13): the controller refuses before any session, and the Model API
  session refuses too. On Muse Code they run through the CLI's own shell
  and sandbox posture (D12), and its sandbox failure offers the setup as
  the shell tool's does. On the Model API backend they run through the
  shell tool's runner (job objects, M27) for at most ten minutes, and the
  row has a Stop; the model reads the command and its output with its next
  request, as above. A refused command comes back to an empty prompt with
  the reason.
- **Explain instead** on the question card sends up to 500 characters
  (MSP's limit, held by the box, the protocol schema and the Model API
  session); the Model API's `ask_user` returns the text to the model as
  Muse Code's clarify does, and the row reads "Explained: …".

### D41 — One memory for both backends (M49, 2026-09-25)

Muse Code has no MSP method for memory (`memory/list` is `methodNotFound`)
and no CLI subcommand (the saved `--help` output has none); its memory is
Markdown files its agent tools read and write. What was established, and
how:

- **Where the notes live.** Found on disk (names only) and confirmed by a
  live capture with the data home moved into a throwaway folder
  (`docs/certification/m49.md`): `project` is `<workspace>/.agents/memory`;
  `personal` is `$XDG_DATA_HOME/muse/memory/personal`; `personal_project` is
  `$XDG_DATA_HOME/muse/memory/projects/<slug>-<key>`, where the data home
  is `~/.local/share` when `XDG_DATA_HOME` is unset (Windows included). The
  key is the FNV-1a 64-bit hash of the UTF-8 workspace path as Rust's
  `canonicalize` spells it (`\\?\C:\…` on Windows, the operating system's
  own letter case, so VS Code's lower-case drive letter is not used), in
  16 hex digits; the slug keeps ASCII letters, digits and hyphens, turns
  anything else into a hyphen and trims the ends. Both rules were checked
  against the two folders Muse Code made (`C:\muse-live-m43` →
  `C--muse-live-m43-7bdb42d98a06c29b`; `C:\muse-live-m49\My Proj.v2_x+é` →
  `C--muse-live-m49-My-Proj-v2-x-0175e6b82ee81b32`). A folder that already
  ends in the key is used whatever its slug, so a slug rule the capture
  could not show (a POSIX leading slash, a UNC path, a very long path)
  costs nothing once Muse Code has made the folder. Each scope root holds
  Muse Code's `.muse-memory.lock` (`pid=<n>`), an operating-system lock.
- **What the tools do** (the capture and the binary's strings): arguments
  `{path, scope}` plus `content`, optional `type` (`user`, `feedback`,
  `project`, `reference`) and `description` for `add_memory`; `offset`
  (default 1) and `limit` (default 500) for `read_memory`; `old_str` and
  `new_str` for `edit_memory`. A new note with `type` or `description` gets
  them as front matter (`---\ntype: …\ndescription: …\n---\n\n` before the
  content); an append joins after a blank line and leaves the front matter
  as it was; no trailing line break is added. A read's `content` is the
  window's lines with their own breaks, `truncated` when lines follow.
  Results are JSON (`{success, scope, path, operation, message}`; a read
  `{success, scope, path, start_line_number, content, truncated}`); a
  failure is a failed item whose reason is in Muse Code's own words, such
  as "memory file not found" or "old_str not found". Muse Code does not
  write `MEMORY.md` itself: the model keeps it.
- **Approvals in Muse Code.** In `promptUnmatched` its memory writes ran
  without a card; only calls whose path it then refused asked first.

The decisions:

1. **One store, two users.** `src/core/memory/memoryStore.ts` places,
   validates, reads and writes notes by Muse Code's rules; the Model API
   backend's tools and the Memory view both use it, in the data home
   `muse serve` sees (`museSpark.environmentVariables` included). A note
   written on one backend is read on the other.
2. **The Model API tools are Muse Code's**: same names, arguments,
   descriptions (the binary's), refusals and JSON, so the M43 rows render
   them unchanged. They are offered in a trusted workspace only (D13); in
   Restricted Mode they are not offered and a call is refused. D13's point
   3 (personal memory not loaded) is superseded: its location is now known.
3. **Approval like an edit, not like Muse Code.** A write asks in Manual,
   runs in Auto and Edit automatically (its card is a `fileWrite` naming the
   note), and is refused in Plan; a read never asks. It is never a protected
   write although project notes sit under `.agents`: the tools can write
   only Markdown notes in the memory roots, while the file tools keep
   `.agents` protected. Muse Code writes without asking in Manual; asking
   is the safer default for notes that reach every later session (the
   personal scope, every project). A path Muse Code would refuse is refused
   before any card.
4. **The index kept true by the extension.** A note the Model API tool or
   the Memory view creates gets `- [name](path) | hook` in its scope's
   `MEMORY.md` (the description, else the note's first line) unless a line
   already links to it; a note the view deletes loses its lines. Muse
   Code's own tool leaves this to the model, which on the Model API backend
   is told the tool does it. A failed index write leaves the note written
   and is logged.
5. **The session-start snapshot**, as Muse Code's docs describe it: each
   scope's `MEMORY.md` (200 lines, 32 KB, Muse Code's marker) and the paths
   of up to 48 other notes, in the instructions, read once per session.
   Notes must be UTF-8 (Muse Code: "memory file must be valid UTF-8"); the
   M10 loader's UTF-16 index support is dropped with it.
6. **No link, no hidden file.** A path through any link below the workspace
   or data-home anchor, including the scope's root itself, is refused (Muse
   Code: "memory path contains a symlink"); the listing never enters a link
   or a hidden entry. Windows device names and streams are refused as the
   file tools refuse them.
7. **Muse Code's lock is not taken.** A read-only local audit found a
   persistent `.muse-memory.lock` containing `pid=<n>` even after that PID
   exited. Muse Code 1.3.0's binary places the lock name beside `memory
lock busy: a native write holds the view` and `memory lock failed:`, and
   imports `LockFileEx`/`UnlockFileEx` on Windows. A read-only disassembly
   of 1.3.0's generic locking helpers shows shared/exclusive try-locks over
   a zero-based `0xffffffffffffffff`-byte range. It does not prove which
   helper the memory writer calls, how long that guard is held, or the
   cross-platform protocol; Node 24.20 exposes no file-lock API. A lock
   file's presence or PID is not ownership. Without proven interoperation
   the extension does not take or imitate that lock (no new native
   dependency). Existing-note writes replace the file whole (temporary file,
   rename), so a note is never half written; two writers on one note in the
   same instant may lose one write (§9). A new note needs a separate
   no-clobber publication: write and sync a hidden stage in the same folder,
   then hard-link the complete file into the target name. A filesystem that
   cannot link refuses the create; it must not fall back to a visible partial
   `wx` write or an overwriting rename. Add the index line only after the
   target has been published successfully. This does not solve the native
   lock or concurrent updates to an existing note or index.
8. **The view** is a quick pick on both backends, as M31's views are:
   up to 500 notes per scope, nested up to eight folders, with their
   summaries; open in an editor, new note (scope,
   name checked by the store's rules, `.md` added, description), delete to
   the trash after a modal. Muse Code's own settings are never written.

### D42 — MCP servers on the Model API backend (2026-09-25)

M50 of D36: the key backend runs the MCP servers Muse Code would, with a
client of its own and no new dependency. What Muse Code does was read from
its public pages (extending: `mcp_servers`, `transport`, `mode`, `framing`,
`${VAR}`; the 1.2.1 changelog: read-only tools run without a prompt under
on-request approvals, `startup_timeout_sec`, `tool_timeout_sec`, `cwd`,
protocol 2025-06-18 on both transports) and from its 1.3.0 binary (the
settings types `McpTransportSetting` = `stdio` | `streamable_http` and
`McpStdioFramingSetting` = `auto` | `content_length` |
`line_delimited_json`, "Probe line-delimited JSON, then fall back to
Content-Length framing", the validation messages, the migrate skill's
settings contract and its environment allowlist). No model call was made:
the backend is tested against a fake stdio server and a fake HTTP server.

- **The same servers.** M31's reader, extended to hand each entry whole
  (`readMcpServerEntries`); the view it feeds stays secret-free. The two
  faults that make Muse Code load no user server (both keys in one file,
  `required` beside `mode`) load none here either, and say so.
- **One set per window.** The servers belong to the Model API host: they
  start with the first conversation (`session/start` or a resume, as Muse
  Code starts them with a session), the first turn waits for them, and they
  stop with the host (a restart, sign-out, the window closing). Muse Code
  gives each stdio server `MUSE_SESSION_ID`; these serve every session of
  the window, so none is given. Closing while servers start waits for the
  active batch to shut down and starts no later batch.
- **Trust.** Nothing starts in Restricted Mode, stdio or remote; the next
  message after the workspace is trusted starts them.
- **Required and optional.** A required server (the default; only `mode:
optional` is optional) that is not running fails the turn with the reason
  and the fix, as Muse Code aborts its run. Its state is checked after each
  model stream and tool call, and before more work in the turn; calls left
  unrun still get replay outputs. An optional one is a warning
  notice, once per session. The palette's **MCP servers…** row now shows
  on the Model API backend too, with each server's live state.
- **Transports.** stdio: the command started directly (absolute `PATH`
  entries only, D24); a `.cmd` or `.bat` (npx's launcher on Windows)
  through `cmd.exe /d /s /c` with every part quoted and `"`, `%` and line
  breaks refused; its stderr to the log; closing ends its input, waits
  1.5 s, then ends its process tree (D25). On Windows the hidden job helper
  inherits only three binary stdio handles from the extension, creates the
  server suspended, assigns it to a kill-on-close job, then resumes it. The
  helper holds a handle to the creating extension process and closes the job
  when the server or extension exits. A separate private pipe carries a
  nonce-bearing READY/GO exchange after the helper binds that process handle;
  a dead creator cannot authorize a server even if its PID is recycled
  before the bind. The pipe and nonce never enter MCP stdio or the server's
  environment. The M50 job executable is compiled once and started directly
  for each server. If it cannot be compiled or started, stdio fails closed
  instead of starting without containment;
  streamable HTTP remains available. `auto` framing writes lines and
  switches to Content-Length when the server's first bytes are that header;
  a server that never answers a line fails its start-up with the hint to set
  `content_length`. Streamable HTTP: POST with JSON or event-stream replies,
  the session id and protocol version sent back, a server request (`ping`)
  answered, a 404 on a known session starting a new one, DELETE on close, a
  redirect refused so no header follows it.
- **Environment.** A stdio server gets the allowlist Muse Code uses (HOME,
  PATH, USER, LOGNAME, TMPDIR, TEMP, TMP, SHELL, LANG, LC_ALL, TERM,
  COMSPEC, PATHEXT, SystemRoot, WINDIR) plus USERPROFILE, APPDATA and
  LOCALAPPDATA, which npm and Python look for on Windows, then its entry's
  `env`. `${VAR}` in any string is read from the extension host's
  environment; an unset one keeps the server from starting and is named,
  never its value. (The binary's migrate skill says Muse Code does not
  expand `${VAR}`; its public changelog says it does; the public statement
  was followed.)
- **Sign-in.** `muse mcp login` tokens are Muse Code's and never read here.
  A remote server that needs a credential takes it as a header in its
  entry; a 401 or 403 says so.
- **Names and schemas.** `mcp__<server>__<tool>`, Meta's characters only
  (every other one, and every dot, becomes `_`), the server's part never
  holding `__`, 64 characters at most with a hash where a name is cut or
  taken. A configured name that normalizes to the extension's reserved
  `ide` server name is refused, so no function can collide with its IDE tool.
  A schema is cut to Meta's documented limits (depth 10, 5,000
  properties, 120,000 characters of names and values, 1,000 enum values, a
  large string enum capped, 200,000 nodes after `$ref`s are written out);
  local `$ref`s are written out and a recursive one cut, since Meta refuses
  recursion; a schema still past the limits is offered as "an object" and
  the model is told so. The server checks the arguments either way.
- **Results.** Text, and pictures as `input_image` parts of the function's
  output (the Responses schema allows content parts there), each checked to
  be a PNG, JPEG, GIF or WebP within 10 MiB first, since a picture Meta
  cannot read would fail every later request of the conversation. Audio,
  links and binary resources are described in words; structured content
  stands in when there is no text; a tool error is a failed row.
- **Approvals.** An MCP tool is arbitrary code:

  | Mode                       | A tool  | A tool its server marks read-only |
  | -------------------------- | ------- | --------------------------------- |
  | Bypass                     | runs    | runs                              |
  | Auto                       | asks    | runs (Muse Code's on-request)     |
  | Manual, Edit automatically | asks    | asks                              |
  | Plan                       | refused | asks                              |

  "Always allow in this session" is kept per tool. The card is a tool's,
  never a file write's, whatever the arguments hold, so Edit automatically
  never answers it.

- **The IDE tool.** `getDiagnostics`, which Muse Code sessions reach as
  `mcp__ide__getDiagnostics` over loopback, runs in process here under the
  same name, as a read in every mode. A user's server named `ide` is refused.
- **Limits.** Start-up 30 s and a call 300 s unless the entry says (capped
  at an hour); a message 20 MiB either way; 128 tools a server and 20
  pages of them; a description 2,048 characters; a result 64,000.
- **Not done.** Resources, prompts, sampling, roots and elicitation (the
  client declares no capabilities and refuses such requests), OAuth, the
  servers' `instructions`, and the server-initiated event stream over HTTP
  (a tool list that changes between replies is seen at the next one).

### D43 — Enterprise network and posture (2026-09-25)

D36's last row: proxies and certificates for the extension's own traffic,
Muse Code's `--sandbox-network` and `--no-session-log`, `muse config
status`, and the Model API's prompt cache. What was read or captured first
(2026-09-25; the capture is `docs/certification/m56.md`):

- **VS Code already routes an extension's `fetch` and `WebSocket`.** VS
  Code 1.125.0's `src/vs/workbench/api/node/proxyResolver.ts` (tag 1.125.0,
  with `@vscode/proxy-agent` ^0.42.0) replaces the extension host's global
  `fetch` (`createFetchPatch`, on while `http.fetchAdditionalSupport` is, by
  default) and global `WebSocket` (`createWebSocketPatch`, proxy-agent
  0.39.0, on while `http.webSocketAdditionalSupport` is, by default). Each
  request gets the proxy for its URL (`http.proxy`, else the system's
  settings or PAC file through Electron; `http.noProxy`; `http.proxySupport`
  `override` by default), proxy authentication (Basic through VS Code,
  Kerberos), and the operating system's certificates (`http.systemCertificates`,
  by default). The shipped 1.139.0 extension host carries the same code. So
  the Model API client and the Muse Voice socket need no proxy client of
  their own and no dependency.
  **Amended 2026-09-27, with M62's 1.99 floor** (`docs/certification/m62.md`,
  "The floor after M48–M56"): read again at the tags from 1.99.0 to 1.125.0,
  `fetch` is patched at every one (1.99.0: `patchGlobalFetch`, proxy-agent
  ^0.32.0), but `WebSocket` only from **1.112.0** (proxy-agent ^0.39.1; the
  `http.webSocketAdditionalSupport` setting appears there). On 1.101 to
  1.111 Muse Voice's socket therefore goes to Meta without VS Code's proxy
  and certificate handling, and on 1.99 and 1.100 there is no WebSocket at
  all. Diagnostics says per global whether the editor routes it (the
  global VS Code sets beside each patch), and the README says what to use.
- **Node 24.20** reads `NODE_EXTRA_CA_CERTS` when the process starts, for
  every TLS connection; `--use-system-ca` and `NODE_USE_ENV_PROXY` are
  process switches an extension cannot set. Its `fetch` throws `TypeError:
fetch failed` with the reason in the causes: captured, `ECONNREFUSED`;
  `DEPTH_ZERO_SELF_SIGNED_CERT` from a self-signed server; and from a proxy
  answering the tunnel with 407 or 403, `Request was cancelled.` over
  `Proxy response (407) !== 200 when HTTP Tunneling` (`UND_ERR_ABORTED`).
- **Muse Code 1.3.0's network.** Its binary reads `HTTPS_PROXY`,
  `HTTP_PROXY`, `ALL_PROXY` and `NO_PROXY` in either case (and has its own
  `endpoint_transport.proxy` settings key); its changelog: "HTTP and HTTPS
  proxy environment variables are respected for all network traffic". Its
  TLS is rustls over the operating system's store (the binary enumerates
  the Windows store) and it reads `SSL_CERT_FILE` / `SSL_CERT_DIR`, which in
  rustls-native-certs replace that store ("certificates are only loaded
  from the locations specified via environment variables and not the
  platform-native certificate store"). With a recording proxy (no model
  call), its start-up `CONNECT api.meta.ai:443` went through the proxy, and
  so did `POST http://127.0.0.1:<port>/mcp` to a loopback MCP server, the
  extension's `ide` server's address, until `NO_PROXY` listed 127.0.0.1.
- **`muse serve --sandbox-network <restricted|enabled|proxy-only>`**,
  `proxy-only` by default (each new destination asks, as a network approval
  card); a wrong value exits 2 naming the three; with `--disable-sandbox`
  the flag is ignored with a stderr line. The managed policy has
  `execution.network_sandbox_modes` and `execution.approval_modes` keys.
- **`muse serve --no-session-log`** makes the host `sessionDurability:
"ephemeral"`, and Muse Code 1.3.0's memory-only host does not work over
  MSP. One turn on the contributor model: the turn ran to completion in
  the CLI's trace log, but the client received no `turn/*` or `item/*`
  notification (the view cursor is the placeholder
  `pending:seam-c-session-view-fold`); `view/subscribe`, `view/page`,
  `session/read`, `session/resume`, `session/fork` and `session/rename`
  answer `methodNotFound`; and `session/start` and `session/setApprovalMode`
  refuse `onRequest` and `allowAll` with `commandRejected` /
  `approval_mode_ceiling`.
- **`muse config status`** prints the managed planes' state, one line per
  plane and source (`plane=policy source_class=system_file state=absent`),
  and a generation digest; `--json` is refused; nothing reached a recording
  proxy while it ran.
- **Prompt caching** (dev.meta.ai/docs/prompt-caching, protocols/responses,
  pricing-rate-limits): the prefix is cached with no key; the key routes
  requests that share a prefix together: "Use one stable key per shared
  prefix … Don't over-partition: unique keys per user or per session lower
  hit rates." `prompt_cache_retention` is `in_memory` (the default) or
  `24h`, "a hint, not a guarantee", and "Set '24h' retention for bursty
  workloads … with idle gaps". The pricing page has one cached-input rate
  and no charge for retention. The extension sent the session id as its key.

The choices:

- **No proxy client of the extension's own.** VS Code's is complete and
  follows the user's VS Code settings; the extension takes `globalThis.fetch`
  at each request (not bound at activation) so whatever VS Code has
  installed carries it. A request that never reached Meta says why, from
  its causes: an untrusted certificate (the store to check), a proxy that
  wants credentials or refused the tunnel, no route; Node's detail follows.
  The detail must redact a quoted secret field in full, including spaces,
  before it reaches a panel notice or log.
- **Loopback bypasses Muse Code's environment proxy.** Wherever its environment
  names a proxy (VS Code's `http.proxy` handed over, or the user's own),
  `127.0.0.1`, `localhost` and `::1` are added to its `NO_PROXY`; the
  entries already there stay. Before, `http.proxy` without `http.noProxy`
  cut Muse Code off from the IDE tools.
- **Validate VS Code's proxy settings before building the CLI environment.**
  `WorkspaceConfiguration.get<T>` supplies a TypeScript type, not a runtime
  check. A malformed `http.proxy` or `http.noProxy` must fall back to an empty
  value instead of becoming a process environment variable; Diagnostics
  reads the same validated values for its set/count facts.
- **Certificates for Muse Code are left to the system store.** It already
  reads it; `SSL_CERT_FILE` would replace it, so the extension never sets
  one (a `NODE_EXTRA_CA_CERTS` file holds only the extra roots). The README
  says so, and Diagnostics says whether one is set.
- **`museSpark.sandboxNetwork`**, machine-scoped (a repository must not
  open the sandbox's network): `default` passes nothing, so Muse Code's
  default or a managed configuration's decides; the three modes pass the
  flag while the sandbox is on, never without it (the log says it has no
  effect then). Changing it restarts the host, like `shellSandbox`.
- **`--no-session-log` is not offered.** A setting that makes the panel
  silent would be a broken feature; the capture and an upstream report are
  the record, and the setting comes when a Muse Code release serves a
  memory-only host's view. The host's existing warning for a non-durable
  host stays.
- **A permission mode above the ceiling** (the captured
  `approval_mode_ceiling`, from a managed `execution.approval_modes` or a
  default permission profile) is refused with a sentence that says so and
  names a stricter mode, instead of MSP's text.
- **Diagnostics** adds the network posture (booleans and counts; never a
  proxy's address, which can hold a password) and known-safe source and
  generation fields from `muse config status`, run in `muse serve`'s
  environment. Unrecognized lines and failed-command output are withheld.
- **Prompt caching as documented**: `prompt_cache_key` is
  `muse-spark-code-` and 32 hex characters of a SHA-256 over the model, the
  instructions and the tools, the prefix a workspace's conversations share
  (a compaction, which sends no tools, gets its own); and
  `prompt_cache_retention` is `museSpark.modelApiPromptCacheRetention`,
  `in_memory` by default, with `24h` only when the user chooses it. Both
  have the same cached-input price; the longer value may improve cache hits
  after a pause but asks Meta to retain the cached prefix longer. The
  setting is machine-scoped, so a repository cannot raise the user's choice
  through `.vscode/settings.json`.

### D45 — Subagents on both backends (M48, 2026-09-25)

The Model API backend runs bounded child sessions with their own conversation
and the parent's workspace rules, tool permissions and model. The initial
prototype let Bypass spawn a child without a paid card. M48 now requires a
machine-scoped gate, price acceptance, one-use consent and a four-request
ceiling for every new child task, including retries. Merged as PR #35
(`a9dec5a`) after local and hosted gates. Each child
has a row and transcript in the Agent map, receives a note or follow-up, and
can be stopped. Child model calls use the stored Model API key and count in
the parent's token usage. The parent may continue while children work; a
limit bounds the number running and the number a conversation can create.
The child cannot spawn further children or ask the user directly. A closed
child's result remains readable. No child writes outside the existing tool
confinement and approval rules.

**Paid child admission (owner-cost rule, 2026-09-26).** The initial spawn-mode
prototype was not delivery consent for extra BYOK calls. Subagents are a
machine-scoped paid feature, off until its price is accepted. Every new
child task—spawn, follow-up, reopen or resume—requires a one-use approval
in every mode, Bypass included; Plan refuses it. The approval names the
objective, selected model and its Standard or Contributor input, cached
input and output prices, and a hard ceiling of four actual Model API
response POST attempts for that task. HTTP and whole-stream retries and
tool rounds spend the same ceiling. A note to a child already running uses
the remaining grant; it never renews it. No grant survives a process
restart. A queued task starts only while its gate, consent, key, model and
originating goal are still valid. After SecretStorage reads the key and
immediately before each child HTTP attempt, the client rechecks these and
consumes one attempt; a failed or unanswered attempt still counts, with
unknown cost if Meta supplies no usage. A spent cap, revoked gate, changed
key or model, switch to Plan, or exhausted originating goal ends the child
task with a localized visible refusal. Stop or disposal while a key read or
owner modal waits invalidates admission. A child request carrying paid web
search is refused if that gate turned off before the request is sent. A
removed key after approval receives the same localized changed-key refusal.
For a restored queued child, the new price decision names every retained
pending note in the exact task that the child will receive; changing that
task while the modal is open invalidates the decision. A
failed response with reported usage charges that usage once; a failed
attempt without usage keeps unknown cost. The output cap remains 32,768 tokens per
request; four attempts are a request ceiling, not a dollar or token-cost
maximum. Child tokens already appear in the parent's conversation total,
so their estimated cost is a subset, never added to it again. Other paid
tools keep their own separate gates and approvals.

An approval a child is awaiting is replayed to a newly attached panel as
pending, with the same no-auto-decision marker as a parent approval; a
late panel can answer it through the parent session. A child's token-usage
delta counts once in the parent's total and against the goal active when
that child turn began, while that same goal still exists. Replacing the
goal before the child answers never charges the replacement goal.

Muse Code's SDK lists `subagent/reopen` and `subagent/readResult`, but M48
captured neither an accepted command nor its resulting item update. The
Agent map keeps the captured M18 controls; those two verbs remain unavailable
until a bounded live owner-command capture establishes their success shapes.
The Model API backend's local read and reopen actions are separate from MSP.

### D46 — Conversation rewind and side chat (2026-09-25)

Muse Code 1.3.0 exposes neither `session/rewind` nor `session/sideChat` over
MSP. Conversation rewind uses the supported `session/fork` cut point just
before the selected user turn, then restores that turn's prompt as a draft.
The first turn rewinds to a fresh conversation. Code rewind remains a separate
choice; its existing edit review refuses changed files. The prior session
stays in History. A Model API fork rejects a cut before its latest compaction
summary, because that summary contains later context. Images return to the
composer when the backend retained their bytes; a missing image is reported.

Side chat opens a separate tab forked from completed turns, with Plan mode
forced and the inherited goal cleared so it cannot continue there. The Model
API backend denies write tools in that mode. Muse Code
applies its project and session allow rules, so its side fork is not claimed
strictly read only. The main tab
and any running turn remain attached. Closing the side tab returns focus to
the original tab; its fork stays in History. Muse Code 1.3.0 on Windows has a
known `session/fork` failure, so both conversation actions remain unavailable
there until the CLI fixes that method. A side chat is an ordinary Model API or
Muse Code model call on the selected backend, never a paid Model API feature
called through a Muse subscription.

The Model API Plan statement covers its tool-permission engine. With M51 and
M52 merged, a durable side session suppresses hooks and refuses external MCP
tools regardless of a server's read-only hint, and core refuses scheduled
create, cancel and run before storage, claim or paid use; certified with M53
(PR #41, run 36298748478).

PR #41 review narrows the rewind boundary: a steered user card shares its
turn with the original prompt, so its fork cut must use the preceding
distinct completed turn or a fresh conversation. Rewind of a selected turn
still running is hidden and refused until its steered image replay settles.
Restored Model API image bytes must match the selected user card's persisted
item identity, never the first user-role replay entry with the same turn ID.
Accepted compaction must record its actual summarized turn across save and
resume; a missing replay entry alone does not prove a compaction boundary.
A Muse Code side panel may resume only its own side fork, never another
ordinary session from History.
Live cards retain a webview-local ID until History reload, so Model API turn
acceptance must also return the backend-reserved replay item ID. Keep the
local ID for UI reconciliation and use that durable ID for image restoration,
including steering, queued turns and acknowledgements arriving after a turn
already completed; never treat a webview-supplied ID as a durable backend ID.

### D47 — File input follows each backend's proven wire (2026-09-25)

Meta's [file handling guide](https://dev.meta.ai/docs/file-handling) permits
`input_file` with inline `file_data` on Responses requests, and says PDF text
comes from the first 100 pages, with page images from the first 50 sharing a
50-image request budget. The pinned Muse Code SDK 1.3.0 defines only text,
image and skill input parts. Its [file input request](https://github.com/meta-models/muse-code-sdk/issues/48)
tracks the missing MSP feature. We do not send an invented part to Muse Code.
The Muse Code attachment store budgets serialized text and image parts together,
leaving 2 MiB of its 10 MiB MSP frame for the prompt, context and envelope;
an impossible file combination is refused before it becomes a chip. The
exact outbound frame check remains the final guard for unusually large
prompts or selections.
Muse Code also recomputes this attachment budget at both `turn/start` and
`turn/steer`: an image accepted under Model API can survive a backend switch,
so the active backend must refuse its now-incompatible chip before submitting
a command, with a remove-attachment reason.
Every known localized attachment refusal keeps its specific banner text in
the composer, including PDF size/backend, shared media, text context and
private-file reasons; only an unrecognized host refusal falls back to generic
unsupported-file guidance. The live announcement still says the actual reason.
Model API text attachments have a separate 768 KiB aggregate UTF-8 content
and named-wrapper allowance. This conservative byte bound stays below the
1,048,576-token context even for dense text and reserves roughly 256K tokens
for prompt, replay and output (32,768 maximum); a large single file can be
refused despite its 1 MiB per-file read cap. It does not account for an
already long replay, which the Model API may still refuse at its context
limit.
During an active turn, its initial named text files and every accepted steer
share that same 768 KiB allowance. A steer that would cross it is refused
before entering the next replay request. Draining steering into replay does
not reset the turn's admission count; a separately queued turn validates its
own parts before it starts.

- **Model API:** PDF bytes, checked by header, may be attached from the file
  picker, clipboard or drop, up to 32 MB each; the inline base64 stays below
  Meta's 50 MB limit. No persistent Files API upload or new dependency.
  Images still work. A bounded UTF-8 text file picked from the trusted workspace and
  visible in its file index becomes a named `input_text` part after its real
  path is checked against symlink escapes; read the same checked absolute
  target after the indexed/private check so a retargeted alias cannot swap in
  private bytes. Protected/private paths are
  refused. Binary file types are refused, never decoded as text. The
  Model API `read_file` tool reads UTF-8 text, PDFs and images from confined
  workspace paths. A PDF or image read by that tool travels as a user content
  part after its function-output round, so the model actually sees it. Its
  function `output` stays English for the model, while the transcript's
  `visibleOutput` uses the installed `UI_TEXT` language, with page counts,
  byte sizes and image dimensions formatted in that locale. A known PDF page
  count takes the language's plural form; an unknown count has its own label.
  Focused tests check a non-English table and grouped numbers without changing
  the model-facing text.
- **Muse Code:** images retain their MSP path. A PDF attachment gets a clear
  refusal naming the Model API backend, including when its extension is
  disguised. A bounded text attachment becomes an MSP text part with the
  file's name and content; no invented file part. Other unsupported types
  remain path mentions or explicit refusals. Native file parts wait for an
  MSP release and a captured wire shape.
- **Budget and history:** attached images and countable PDF page images share
  50 slots per new message. An uncountable PDF reserves all 50. The Model API
  page counter reads only the page-tree dictionary's direct `/Count`; a
  nested dictionary's unrelated `/Count` must not shrink that reservation.
  If the direct count cannot be established, the PDF is uncountable here.
  An escaped page-tree `/Pages` or `/Count` name can hide a real count behind
  an unlinked visible decoy; comments between `/Type` and `/Pages` or after
  `/Count` can do the same. Treat these ambiguous forms as uncountable and
  reserve all 50 slots. A visible page-tree candidate with a missing,
  non-positive or out-of-range direct count is ambiguous too: a separate
  one-page decoy must never lower the reservation. A `/Count` followed by an
  indirect-reference suffix (`5 0 R`) names an object, not five pages; treat
  that tree as uncountable rather than trusting the reference's object number.
  An indirect `/Type` may name the real `/Pages` tree while a visible direct
  `/Type /Pages` dictionary is unlinked; reserve all 50 until the real tree
  can be established without resolving arbitrary objects. Signed object
  numbers such as `/Type +5 0 R` are equally ambiguous and reserve all 50.
  The Model API
  extension also caps base64 media to 48 million characters per new message
  and replay request. This is a conservative aggregate memory/request bound,
  separate from Meta's 50 MB **per-file** inline limit. An over-cap new
  attachment is refused with a localized banner. The Model API replay,
  including compaction, keeps newest visible media within both budgets and
  replaces older media with a plain explanation; the panel announces that
  older media was left out. After a fitted request succeeds, its replacement
  text becomes the durable replay: omitted PDF/image base64 must not remain in
  `snapshot()` or a resumed session. Transcript history keeps attachment
  names, types and counts for the UI without retaining those omitted bytes.
  A request that has not completed must not prune pending tool-read media;
  its later Stop/failure still gets the path-only cleanup in this decision.
  Tool `read_file` batches reserve both encoded characters and the same 50
  image/page slots before a file reports success. An unknown-page PDF takes
  all 50 slots. A later file that cannot fit returns the media-budget error
  before its bytes enter queued replay, so a successful earlier file is not
  silently replaced during the next request's replay fit.
  Visual parts from any function-call output in the current tool batch share
  that admission budget with queued `read_file` media. Count them once until
  a completed model request carries the parts; a failed request or Stop must
  not mark them delivered. A later read that would displace an undelivered
  image fails explicitly before its tool result reports success.
  Accepted user steering media reserves that same first-delivery budget:
  a later tool result cannot displace it silently, and a steer that arrives
  after pending tool media is refused before it enters this turn. The panel
  can submit that prompt as a later turn after the pending media is delivered.
  A successful `read_file` stays reserved after its media moves from the
  current batch into replay, including while `PostToolBatch` runs. The
  reservation ends only after the first completed request carries or durably
  omits that media, or Stop/failure scrubs it. A steer arriving during that
  hook cannot displace the unread PDF or image.
  Red/green tests bind the fitted request, snapshot, resume and unchanged
  history chips to that boundary. The
  `read_file` tool also stops collecting media in one tool round at the same
  encoded-size cap, returning a failed tool result for the excess file before
  it is retained; a burst of reads must not fill host memory before replay
  fitting runs. The
  UI shows PDF names as file chips and restores them from Model API session
  history. This does not claim the older bytes remain visible to the model
  after either budget clips them.
  A send that awaits autosave, editor context or backend selection binds the
  session and conversation generation it started with. If the backend stops
  or the session changes during those waits, the send fails before submitting
  to its old backend and keeps attachment chips for a fresh attempt. A
  disposed Model API session independently rejects new sends and steering,
  so a stale caller cannot initiate a paid HTTP request after release.
  A late submit acknowledgement is checked again before chips are released
  or `turnAccepted` is shown. The controller distinguishes its own
  `sessionNotLoaded` recovery from an external backend stop: only the owned
  recovery may adopt a new attachment generation, while an external stop
  always invalidates the original send, even during recovery lookup.
  Conversation rewind keeps its image-only behavior. PDF and named text file
  cards hide that choice in the panel, and a forged request is refused before
  fork or clear: exact file bytes cannot be restored from every backend and
  older History record, so a filename chip must not imply they came back.
  If a tool round stops or fails before its media is delivered, replay keeps
  a path-only explanation. Stop also removes a read-file media message from
  future replay when it interrupts that message's delivery request. A later
  stop or failure in the same turn must preserve PDF/image media that reached
  an earlier successful model response: only still-pending media from a later
  tool round is replaced by path-only text. Multi-round red/green tests cover
  both a later Stop and a later failed model request.

### D48 — A popup before every paid use (M58, 2026-09-27)

The owner (2026-09-27): "anything requiring extra payment should promt you
with a popup that asks allow once allow always in this workspace or deny".
Until then the paid features asked in four different ways: an in-chat card
with Allow once and Reject for a Model API image or child task, a native
dialog for an image on Muse Code, a scheduled run and a child task started
from the Agent map, and nothing per use for web search and Muse Voice (D34:
the price accepted once, then only the row, the badge and the tally).

- **One popup, three answers.** `PaidUseConsent.allows`
  (`src/core/paid/paidConsent.ts`) asks through `askPaidUse`
  (`src/host/paid/paidHost.ts`), a native modal naming what is about to be
  billed and its price, with **Allow once**, **Allow always in this
  workspace** and **Deny**; closing it is Deny. It asks in every permission
  mode, Bypass included. A paid call never gets an approval card or a
  session rule any more: `paidChoices`, the `paidTool` subject and the
  card's price line are gone.
- **What asks, and when.** An image, before it is bought (after every check
  that can refuse it for free, as before). A child task, before its grant;
  Plan still refuses it. A scheduled run, before its turn. A Muse Voice
  recording, before the recorder starts; a stop pressed while the popup is
  open cancels the start. Web search, once per prompt before its first
  request: Meta runs the searches inside the response and the model decides
  whether to search, so no popup can come before each search; Deny sends
  that prompt without the `web_search` tool. A child task searches only
  when its parent's prompt was allowed to (its grant carries the answer), or,
  for a task the user starts from the Agent map, when web search is allowed
  always here. A child never asks for itself.
- **"Always" is per workspace, and revocable.** It is kept in the
  workspace's own state (feature names with a grant generation, no content),
  offered and honoured only in a trusted workspace with a folder open. Every
  change to a feature's price acceptance (turned off, or a new price
  accepted) counts its generation up in global state, which voids every
  workspace's "always" for it. **Ask again every time** in Account & usage
  clears them for this workspace.
- **Still loud when silent.** A use that no longer asks keeps its paid row,
  the badge (whose tooltip names the features allowed always), and the tally;
  Account & usage marks each such feature "on, allowed always in this
  workspace". A hook's `allow` never answers the popup; a hook that demands
  a question, and a paid image aimed at a protected path (D24), ask even when
  the feature is allowed always.
- **Not asked:** an ordinary Model API turn the user types. Choosing the
  Model API backend with a pay-as-you-go key is that consent (D1, D37); the
  popup covers what costs extra beyond it.

### D49 — Coding quality first: what to build next (2026-09-27)

The owner (2026-09-27):

- "research the claude code harness and any upcoming features … and also
  https://github.com/NVlabs/SoL-Pi and see if there are gaps between our
  product and theirs that we can fill to make our product compete with the
  claudes, and the codexes, and the open codes, and open claws, the t3
  codes …"
- "we are geared towards coding so thats where our focus should be the
  strongest, but anything that could help productivity and connectivity
  and compatibility thats fine, and maybe some of this helps on the cli
  side as well"
- Then: "put together the list of improvements you think will be the
  best for this project for our users to get the highest quality and
  value then add them to the plan".

The research is in `docs/research/competitive-landscape-2026-09.md`: public
sources, no sign-in, no spend. It found the extension at or near parity
with Claude Code on:

- subagents, hooks, MCP, skills, goals, scheduled prompts;
- rewind, side chat, worktrees, memory, compaction;
- permission modes and plan mode.

It is ahead of most of the field on paid-use consent, languages,
accessibility and machine-scoped settings. It is behind on the loop that
makes an agent's code correct, and on the workflow around a change.

**The ranking rule.** What most improves the code a user gets comes
first: the model seeing the effects of its edits, understanding the code
it changes, and reading the pages it needs. Next comes reviewing and
shipping that code, then spending fewer tokens on long tasks, then
running more agents safely, then connectivity. Within a wave, what serves
both backends comes before what serves one.

**The two backends.**

- **Model API:** the extension owns the loop, so every item below can be
  built in full.
- **Muse Code:** MSP bounds what the backend can do. Two routes still
  reach it:
  - the extension's `ide` MCP server, which every Muse Code session
    already loads (M5, M44), can offer the new tools (code intelligence,
    web fetch, the browser check);
  - everything that lives in the extension serves both backends: review,
    git, checkpoints, the session board, notifications.
- What neither route can reach is named in its milestone and, where it
  matters, asked of Meta upstream: tool-output projection, fused edit and
  verify, `web_fetch` enablement.

**Rules carried.**

- **Paid calls.** An item that makes model calls beyond the user's own
  turn is billed to the key. Such items are opt in, priced, and ask before
  each use (D30, D48). They are:
  - the Auto reviewer;
  - the second-opinion and reviewer agents, run on their own or as a
    child (D45);
  - the log reducer (M73);
  - best-of-N attempts, on the Model API only.
- **The user's own turn** is the model calls made while answering a message
  or command the user sent, in that conversation: a compaction or a
  follow-up the harness adds on the way is part of it, as is a
  `/review`, commit message or PR body the user asks for. Calls started
  without one (a schedule, a wake, an automatic review, a child or
  reviewer run on its own) are beyond it, as M52 set for scheduled
  prompts. Nothing generates text on its own.
- **Restricted Mode** runs no git and no shell (D13, D24). A milestone that
  needs them is unavailable there and says why.
- **Measured first.** A harness change that trades tokens against
  quality (M73, M74) ships only after M75's paired evaluation shows the
  capability floors held on muse-spark. M75 is therefore built first in
  wave 3, and M73 and M74 each land together with their own passing run:
  until that run passes, the mechanism has no setting and no code path a
  user can reach.
- **Tools on the `ide` server.** It is one endpoint for the whole
  window, with one token and no session identity, and it is attached even
  in Restricted Mode, so it cannot see a Muse Code session's permission
  mode. A tool served there that writes, runs a command or reaches the
  network therefore:
  - is not listed while the workspace is untrusted, and a network tool is
    not listed while `museSpark.sandboxNetwork` denies the network;
  - declares its MCP annotations (`readOnlyHint: false`, and
    `openWorldHint: true` for the network); a read-only tool declares
    `readOnlyHint: true`;
  - confirms each call in the extension's own modal, as the image tools
    do (M44).
- **Untrusted content.** Fetched pages, PR and review comments, imported
  files and tool output are data, never instructions. They are marked as
  untrusted where the model receives them, and nothing in them can raise
  a permission, pick a model or skip a question. A conversation built on
  such content (an imported session, a PR someone else wrote, a plan file
  picked from Plans… in M79) starts in a mode that asks, whatever
  `museSpark.initialPermissionMode` says, and only the user's own action
  relaxes it.
- **Automatic actions follow the mode.** Anything the extension runs on
  its own (checks after an edit, a memory flush, a review turn) takes the
  same path as the call it stands for: a shell command asks wherever the
  shell tool would, a memory write where a memory write would, and Plan
  and Restricted Mode refuse what they refuse today.
- **Captured wire.** Wire shapes come from live captures (AGENTS.md
  rule 13).
- **Ported code.** Code ported from SoL-Pi (MIT) keeps NVIDIA's notice in
  `THIRD_PARTY_NOTICES.txt` and the file headers. That file is generated
  from `node_modules` licences by `scripts/third-party-notices.mjs`, so
  the first milestone that ports code (M68 or M73) adds a list of ported
  sources to the generator, which its staleness check then covers (with a
  drill).

**The program**, in order. Size S is two days or less, M is three to five
days, L is one to two weeks. The milestone numbers were given before the
order was settled, so the table, not the numbers, is the order: M80 comes
after wave 5's others because it waits for PR #32, and D50's M85 comes
last, after M73, M75, M76 and M78 that it builds on, and after the
owner's TypeSafe key for its capture.

| Wave                       | Milestone | What                                                                                                                   | Backends                              | Who has it                              | Size |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- | ---- |
| 1 Correct code             | M68       | Verify loop: diagnostics after edits, format on edit, check commands, edit-then-run                                    | API full; MC diagnostics and guidance | OpenCode, Aider, Crush, SoL-Pi          | M    |
|                            | M67       | Code intelligence tools from VS Code's language services, and a repo map                                               | both (MC through `ide`)               | Aider, OpenCode, Zed, Claude Code (LSP) | M    |
|                            | M69       | Web fetch (folds in M44b)                                                                                              | API native; MC through `ide`          | Claude Code, Codex, OpenCode            | S    |
| 2 Review and ship          | M70       | Review: `/review` presets, a review pane with per-hunk accept/reject and line comments to the agent, a security preset | both                                  | Codex, Zed, Kilo, T3 Code, Claude Code  | L    |
|                            | M71       | Git and PRs: commit message, commit, push, open a PR, PR status per conversation, a conversation in a worktree         | both                                  | T3 Code, OpenCode, Codex, Claude Code   | M    |
|                            | M72       | Turn checkpoints with untracked files; restore files, conversation, or both; redo                                      | both                                  | T3 Code, Cline, Gemini CLI, OpenCode    | M    |
| 3 Long tasks, fewer tokens | M75       | Paired efficiency evaluation with capability floors and held-out tasks, built first                                    | API                                   | SoL-Pi, Claude Code plugin evals        | M    |
|                            | M73       | Observation packing with `recall_output`, and a savings ledger, once its M75 run passes                                | API                                   | SoL-Pi                                  | S    |
|                            | M74       | Automatic compaction when a todo item completes, a memory flush before compaction, `/handoff` to a new conversation    | API                                   | SoL-Pi, OpenClaw, Amp                   | M    |
| 4 More agents, safely      | M77       | Session board across conversations and worktrees; best-of-N with diff comparison                                       | both (best-of-N on API)               | Cursor, Kilo, T3 Code, Codex, Zed       | L    |
|                            | M79       | Plans as files: save the approved plan, implement it in a fresh context                                                | both                                  | Codex, Factory, Cline                   | S    |
|                            | M76       | Custom agents in Markdown; built-in Explore and Second-opinion agents, and M70's Reviewer in the same format           | API; MC reads its own                 | Claude Code, Codex, OpenCode, Amp       | M    |
|                            | M78       | Auto made safe: command rules with tests, permission profiles, an Auto reviewer                                        | API                                   | Codex, OpenCode, Gemini CLI             | M    |
| 5 Connect                  | M81       | Browser check: open the dev server, screenshot and console back to the model                                           | API; MC through `ide`                 | Cursor, Codex, Claude Code              | M    |
|                            | M82       | Notifications, usage per reply, a session budget cap, cache savings                                                    | both (cost and cache on API)          | Claude Code, OpenClaw, T3 Code, Codex   | S    |
|                            | M83       | Import from Claude Code, Codex and Cursor: MCP servers, hooks, agents, commands (extends M30)                          | both                                  | Codex `/import`, Junie                  | S    |
|                            | M84       | Session export and import as JSON, and a local share file                                                              | both (import resumes on API)          | OpenCode, Codex, Amp                    | S    |
|                            | M80       | Headless run and a GitHub Action for review and fix, through the ACP agent's package                                   | API; MC                               | Codex, Claude Code, OpenCode            | M    |
| 6 Experimental (D50)       | M85       | TypeSafe assist: skill and agent suggestion, an advisory Auto risk score, relevance and grading once measured          | API                                   | TypeSafe cookbook                       | M    |

**Not taken.**

- A hosted relay, mobile apps, and chat-app control (T3 Connect, OpenClaw
  channels). These are not coding-first, and Remote Control waits on Meta
  (sdk #36).
- Model routing across vendors (Crush, OpenCode). The extension is
  Meta-only by design (D1). D50's TypeSafe assist is not a coding model
  and never answers; it is the one non-Meta model call, experimental and
  off by default.
- GitLab and other forges. VS Code ships no built-in authentication for
  them, so M71 is GitHub only.
- A plugin marketplace of our own. M83 imports others' formats instead,
  and Muse Code's own plugins keep working.

### D50 — TypeSafe, experimental: an assist to the Muse model, never a replacement (2026-09-27)

The owner asked for research on TypeSafe (docs.typesafe.ai), "to see if there
is a way we can leverage this functionality somehow to improve stuff". Then:
"To be clear I would only want this as a tool to assist the muse model not
to replace", and "the typsafe stuff would be experimental opt in".

**What TypeSafe is.** Jev is a "System One" model, read 2026-09-27. It
takes text as `state` and typed questions, and returns calibrated answers
with probabilities and a confidence:

- a **Choice** among up to 255 options;
- a **Score** on up to 10 ordered levels;
- a **Noul**, the 0–1 probability that a statement is true.

It does not generate text or code. Its own docs say it is no replacement
for the model behind a coding agent, and name Muse Spark. The terms, from
docs.typesafe.ai/models, /api and /legal:

- `POST https://api.typesafe.ai/v1/systemone`, with a Bearer key;
- `jev-1.13.0`, $0.042 per million input tokens, output free;
- 64k tokens per request, 1,200 requests a minute, text only, English
  best;
- no training on customer data; zero retention on enterprise plans only;
- rate limits "can change without notice".

Its documented weak spots (docs.typesafe.ai/model-jaggedness/jev-1.13):

- literal reading;
- math, counting and dates;
- indirection;
- large irrelevant state;
- adversarial content.

**The ruling.** TypeSafe may only assist the Muse model. It never answers
the user, writes code, or decides an action alone:

- it only feeds hints, scores and relevance signals;
- the Muse model, or the extension's deterministic rules, act on them;
- where a signal is missing or unsure, behaviour is exactly what it is
  without TypeSafe.

**Constraints.**

- **Experimental and opt in.** Labelled Experimental wherever it shows
  (setting, palette, Account & usage). Off by default, with a
  machine-scoped setting under `museSpark.experimental.*`. It may change
  or be removed without notice, and nothing else depends on it.
- **Its own key.** The user's own TypeSafe key, kept in SecretStorage.
- **Disclosed.** PRIVACY names exactly what is sent and to whom.
- **Paid, with one named exception to AGENTS.md rule 12.** A TypeSafe
  call is billed to the user's own TypeSafe key, not the Model API key.
  Rule 12 names this exception; everything else in it and in D48 applies:
  - `typesafeAssist` joins the `PaidFeature` union and runs only while
    `PaidFeatureGate.isOn` says so: the setting on, machine-scoped and off
    by default, and its price accepted in the confirmation;
  - it is named in the composer's badge, shown as a row marked paid, and
    counted in `PaidUsage` for Account & usage;
  - every use asks in the paid-use popup, whose "Allow always in this
    workspace" makes per-turn assist bearable;
  - neither the Muse subscription nor the Model API key pays for it, and
    the TypeSafe key never reaches `muse serve` or any child process;
  - it is offered only where the extension itself makes the call, and
    only while a TypeSafe key is stored.
- **Timeouts.** Short. A failed call gives no assist for that decision
  and is logged; it never blocks the turn.

**Model API first.** Muse Code runs its own skill choice and approvals, so
only the extension-side uses reach it.

**The uses, ranked** (M85):

1. **Skill suggestion.** Before a turn, rank the skills against the user's
   message, then verify the top candidates. At most one "relevant skill"
   hint line goes into that turn's context; the model keeps its full index
   and its own judgement. TypeSafe's cookbook measured wrong skill loads
   falling from 16.8 % to 7.3 %, and loads when none fit from 9.8 % to
   4.0 %. The same pattern suggests a custom agent (M76).
2. **Auto risk score** (M78). A Score and Nouls on a command or write that
   the deterministic rules did not settle. The score is **advisory only**:

   - A risky score can add caution: ask where Auto would have allowed, or
     flag the call to the Muse-model Auto reviewer.
   - A "safe" score never skips a question and never becomes an allow on
     its own. Adversarial content is its documented weak spot.
   - It never overrides a rule's "forbid" or "ask".
   - It is compared against the Muse-model Auto reviewer in M85's own
     paired run, on M75's harness.

3. **Context relevance** (M73, M74, M67). Nouls on whether an old tool
   output or a file still matters to the current task, used to rank what
   is packed or kept. Adopted only if M75 shows no loss.
4. **Evaluation grading** (M75). Cheap semantic checks beside the
   deterministic verifiers, never in place of them.

**Not taken.**

- Screening untrusted content as a guarantee. It is adversarial content,
  a documented weak spot, so at most a warning signal.
- Any use as the coding model.

### D51 — Turn checkpoints live in a shadow repository (M72, 2026-09-28)

M72 captures the workspace's files at turn boundaries on both backends, in
a git repository or not. Destructive stored restoration currently requires
a connected Model API session and confirmed process safety; native captures
remain read-only until pre-edit/full shutdown exclusion is proved. The plan
review of PR #50 and the security review added three
constraints: nothing may land in the workspace's `.git` (a `push --mirror`
would carry an untracked or ignored secret such as `.env`); the git that
takes checkpoints runs with hooks and fsmonitor off and none of the user's
configuration or the workspace's filters; and ignored files are covered
only as far as the extension saw the change coming.

**Considered: hidden refs in the workspace repository.** Trees built with
`write-tree` on a temporary index (`GIT_INDEX_FILE`) and kept by refs under
`refs/muse-spark/checkpoints/…`. It shares the user's objects and stat
cache, but it writes objects and refs into the user's `.git`, where
`push --mirror`, `for-each-ref` and `log --all` see them, and it runs under
the user's repository config and attributes (autocrlf, LFS and other clean
and smudge filters). Refused on both counts.

**Taken: a shadow repository in the extension's own storage.** The resumed
M72 implementation uses `<global storage>/checkpoints/<canonical-root-key>/shadow.git`
for current-version windows, preserving prior workspace-specific stores as
read-only history. It is a bare repository whose work
tree is the workspace (or the repository top when the workspace is a folder
of one, so its `.gitignore` files apply, with every path kept to the
workspace's prefix).

- **Isolation.** Every command runs with an environment stripped of the
  host's `GIT_*` variables, `GIT_CONFIG_NOSYSTEM`, an empty
  `GIT_CONFIG_GLOBAL`, a `HOME` in storage, `GIT_ATTR_NOSYSTEM`,
  `GIT_OPTIONAL_LOCKS=0`, `core.hooksPath` at an empty folder,
  `core.fsmonitor=false` and `core.untrackedCache=false`. The shadow's
  `info/attributes`, which outranks every `.gitattributes`, unsets `text`,
  `eol`, `filter`, `ident` and `working-tree-encoding`, so no filter runs
  and bytes are copied as they are (CRLF files, LFS files, `text=auto`).
  git is found by absolute path (D24). Only the workspace's
  `info/exclude` and the user's global excludes file are read, as ignore
  patterns.
- **Objects.** No alternates: the shadow keeps its own copies, so the
  user's `gc` can never break a checkpoint and nothing of ours is written
  or freshened in `.git`. A private index keeps stat data, so a capture
  hashes only what changed since the last one; the first capture of a
  workspace hashes everything outside its ignore rules, within the caps.
- **Records.** Checkpoint and redo JSON is parsed with zod and stored in
  a tree with its captured trees and blobs under `refs/muse-spark/record/<id>`.
  Creation, updates and deletion use Git compare-and-swap. Each window has
  its own index and pending-capture refs. Trees, not commits: no author
  identity is needed.
- **Ignored files.** A bounded scan of sizes and times at each turn's start
  and end finds what the turn created, changed or deleted; the Model API's
  write tools, the image tools and the memory tools (with the Memory view's
  delete) copy a file just before they write it (`withCheckpointCopies`,
  `createCheckpointedMemory`). A restore deletes created ignored files,
  restores copied ones and lists the rest as not restorable; what it
  overwrites or deletes is copied for its Redo.
- **Links.** Git for Windows walks into junctions (checked with git
  2.52.0.windows.1), so git's own listing cannot be trusted there: a
  capture leaves out every path under a folder link or junction and names
  the link, and a restore refuses any path whose canonical form is not the
  canonical root plus the path.
- **Restricted Mode.** No checkpoints: the extension runs no git in an
  untrusted workspace (D24), and a copy store without git would still read
  and duplicate an untrusted tree's files for no gain the user asked for.
  The menu says so. Archiving there drops the conversation's records at
  once (no git); the next trusted window deletes their refs and copies.
- **Windows.** Independent records use CAS refs, with an index, pins,
  tool copies and presence per window. File restores reserve one shared
  CAS ref. Recent objects receive a prune grace period; an archive is
  durable before returning (M72 Built, "Windows sharing a store"). Git's
  path limits are met in the store itself: the repository is made in a short
  folder and published by one rename, a long path is named relative, and a
  path git cannot open is refused with a message (M72, "Long storage paths").

### D60 — Muse Spark Code beyond VS Code: the IDE compatibility program (2026-09-26)

The owner (2026-09-26) handed over a plan, "Muse Spark Code — IDE
Compatibility Plan" (prepared 2026-09-25 against 0.8.0, `bdaede4`), to be
worked beside M45–M56, which the owner is building in parallel. It is kept
whole in `docs/ide-compatibility.md`: the target matrix with its sources,
the architecture, the ACP plan, the release scenarios. Its links were
not re-read here (this environment's network policy blocks them,
2026-09-26); each target's claim is re-read from its source before its
milestone starts, as M41's installers are.

- **One product, four families.** The VS Code extension qualified in the
  editors built on VS Code (VSCodium, Cursor, Kiro, Positron, Theia,
  code-server, Codespaces, Che, Firebase Studio); one agent over the Agent
  Client Protocol for the editors that host agents in their own chat (Zed,
  JetBrains AI Assistant, Xcode 27, Qt Creator, Neovim, Emacs, Sublime,
  Devin Desktop); native plugins that embed the React panel (IntelliJ with
  Android Studio, Visual Studio, Eclipse, NetBeans, JupyterLab, Spyder,
  RStudio); and a terminal or adjacent interface where a host allows no
  more. The name stays "Muse Spark Code (Unofficial)" everywhere (rule
  11), and a port never proposes 1.0 (D44).
- **The engine and the UI are shared, the host is an adapter.** `AgentHost`
  and `AgentSession` stay the backend boundary; the webview reaches its
  host through one bridge; the host's services (workspace roots, documents
  and their versions, selection, edits, diffs, diagnostics, terminals,
  settings, secrets, persistence, notifications) become a contract with
  VS Code's implementation first. VS Code stays the reference client, and
  its behaviour does not change while boundaries move.
- **What already holds.** Only 11 source files import `vscode` (M60's
  record, after M61 took the logger's); the React app reaches its host
  only through `acquireVsCodeApi`, window messages, the text table
  embedded in its HTML and 57 `--vscode-*` theme variables; the protocol
  is zod-validated both ways. The work is extraction, not a
  rewrite.
- **Rulings carried into every adapter.** The key never reaches a child
  process, a launch argument, an environment variable, a webview message
  or a general IPC field (rule 8, D1): an ACP or native build signs in
  through the CLI's own login first, and its Model API backend waits for
  the credential-ownership decision (Q63). Paid features stay opt in and
  loud (rule 12): an adapter whose client cannot show the price and ask
  first offers none. Muse's approval policy is never loosened because a
  protocol allows it; a declined or cancelled request never runs by a
  translation default. Editing is claimed for a host only after its
  backend-specific tests (the plan's §6.1: dirty buffers, exactly-once
  changes, undo) pass there.
- **Support is measured, per host.** Integration type (full Muse
  interface, native agent interface, external) and release status
  (Planned, Prototype, Preview, Supported) are recorded per editor,
  version, backend and OS, with each feature tested, partial,
  unavailable or unverified. An install is the first step, not the claim.
- **Nothing is installed or billed unasked.** Another IDE is installed
  for a probe, and a dependency (the ACP SDK, a JetBrains or .NET
  toolchain) is added, only on the owner's go (Q61, Q62) and with rule 9's
  checks. Compatibility runs never use the subscription or a paid feature;
  a live check follows CLAUDE.md.
- **Numbered from 60**, so M45–M56 keep their numbers while both are built
  (M60–M66, Q60–Q64). Moves across files M45–M56 are changing (the
  stylesheet, the controller, the protocol) wait until M56 merges; the
  inventory and the narrow seams go first.

### D61 — The Model API key outside VS Code (2026-09-26)

The owner (2026-09-26): "you need to figure out the proper api key safe
storage". Inside VS Code the key stays in SecretStorage (rule 8). An agent
that another editor starts (D62), and later the native plugins (M64), run
with no VS Code, so the key needs a home of its own.

- **Rejected**: the operating system's command-line tools as child
  processes (`security`, `secret-tool`, PowerShell with DPAPI): the key
  would pass through another process, and `security
add-generic-password -w` takes it as an argument, visible to `ps`. A
  file encrypted with a key of our own: only as safe as the file's
  permissions, and crypto invented here. An environment variable, as many
  CLIs take: it invites the key into editor settings files (Zed's agent
  `env`, JetBrains' `acp.json`), which rule 8 forbids.
- **Chosen**: the operating system's credential store, reached in-process
  through `@napi-rs/keyring` 2.1.0 (MIT, the Node binding of the
  `keyring` Rust crate; prebuilt for Windows x64, arm64 and ia32, macOS
  x64 and arm64, Linux x64 and arm64 on glibc and musl, arm, riscv64,
  FreeBSD; published 2026-09-13, outside the 7-day window). Windows
  Credential Manager (DPAPI, per user), the macOS login Keychain, and on
  Linux the Secret Service (GNOME Keyring, KWallet, KeePassXC), pinned
  with `linux: { store: 'secret-service' }`: the kernel keyring the
  library would otherwise fall back to forgets the key at reboot. Without
  a Secret Service the Model API backend says how to get one; there is no
  plaintext fallback.
- **One entry per user**: service `Muse Spark Code (Unofficial)`, account
  `museSpark.modelApiKey` (the key's name in the extension's
  SecretStorage), shared by every editor that runs the agent. A missing
  entry reads as `null` from the binding, whatever its typings say (found
  against GNOME Keyring at M63); the store turns it into `undefined`.
- **Setting it**: `muse-spark-code-acp auth set` reads the key from the
  terminal with echo off (or one line from a pipe), checks its shape,
  stores it and prints only that it did; `auth status` says whether a key
  is stored, never any of it; `auth clear` removes it. Each ACP client is
  offered a terminal sign-in that runs exactly `auth set`, so the key goes
  from the keyboard to the store without passing through the editor.
- **Never**: an argument, an environment variable, a file, a log (the
  redactor stays), an ACP message, or a child process: not the environment
  of `muse serve` (D1), a tool or a check.
- **Credential variables** (the Codex review of `a209130`, 2026-09-28):
  a `META_API_KEY` in the agent's own environment is the user's for Muse
  Code, as the extension's `muse serve` inherits it (D1's amendment), and
  counts as Muse Code's credential there; the agent takes it and every
  other credential variable (`*_API_KEY`, the names hooks never get) out
  of its own environment at start (`src/runtime/credentialVariables.ts`)
  and hands them back to Muse Code's processes only, so a shell command,
  a hook, git or a helper never sees one.
- **AGENTS.md rule 8 (amended 2026-09-28)** names this store as
  SecretStorage's stand-in outside VS Code (it is the store SecretStorage
  itself rests on), filled only through `auth set`'s standard input and
  never passed to a child process. Its one named exception is M80's CI
  bootstrap: GitHub hands a secret to a step only through its environment
  or script, so the Action's step shell is the one environment the key is
  ever in; it pipes the key to `auth set` and unsets it before `exec`
  starts.
- **Later**: offering, in VS Code, to copy the key into the OS store for
  the other editors needs the native module in the `.vsix`, so
  per-platform packages (with M64).

### D62 — The ACP agent, and the order the editors come in (2026-09-26)

The owner (2026-09-26): "the top editors come first but i want them all or
as close to all as possible", and approved the ACP SDK. One agent over the
Agent Client Protocol reaches the most editors for the least code (Zed,
the JetBrains IDEs through AI Assistant, Xcode 27, Qt Creator, Neovim,
Emacs, Sublime Text, Devin Desktop), so it comes first.

- **One executable**, `muse-spark-code-acp` (an npm package of that name;
  its bin is `dist/acp.js`, Node 22 or later), speaking ACP v1 on stdio
  through `@agentclientprotocol/sdk`, which parses every inbound frame
  against the protocol's schema before a handler runs (rule 7). stdout is
  the protocol; the log goes to stderr, redacted.
- **The panel's engine, not a second one**: the backend managers of
  `src/host/backend` (portable since M61), the same `AgentHost`,
  `AgentSession` and `AgentEvent`s. The ACP code lives in `src/acp` and the
  process wiring in `src/runtime`, both under the M60 gate's portable
  roots.
- **The backend is chosen at launch**: `--backend museCode` (the default:
  the CLI signed in on its own, the subscription pays) or `--backend
modelApi` (the key of D61). There is no "auto", so the bill is never a
  surprise; a user who wants both configures two agents.
- **What maps to what**: messages to `agent_message_chunk`; reasoning to
  `agent_thought_chunk`; tool calls to `tool_call` and `tool_call_update`
  (kind, title, locations, arguments, output, diffs for edits); a subagent
  to a tool call; the todo list to a `plan`; approvals to
  `session/request_permission` with the backend's own choices (allow or
  deny, once or for the session: `allow_once`, `allow_always`,
  `reject_once`, `reject_always`); permission modes to session modes;
  model and effort to config options; skills to available commands; the
  session's name to `session_info_update`; context use to `usage_update`.
- **Nothing runs by a translation default**: a permission request the
  client cancels, or answers with an option it was not offered, is decided
  with the backend's deny choice. A question the agent asks goes to the
  client's elicitation form where it has one; otherwise the question is
  shown as text and declined, so the model carries on and the user answers
  in the next prompt.
- **Sessions**: new, load (the history replayed as updates), list, resume,
  and fork where the backend allows it (`canEditSessions`).
- **Prompts**: text, resource links (as @mentions), embedded text
  resources (as context), images (checked by their headers, as
  attachments are).
- **Sign-in**: `initialize` offers the chosen backend's sign-in, "Sign in
  to Muse Code" (the agent's `login`, which runs `muse login`) or "Store a
  Meta Model API key" (`auth set`, D61), as a terminal method to a client
  that runs them and as a command to run by hand to one that does not;
  `session/new` answers `auth_required` until the chosen backend has its
  credential. Muse Code's is read as the panel reads it (D26, PR #49): the
  credential file's structure, and `account/read` where only the CLI can
  say; `authenticate` asks afresh.
- **Load and resume run as advertised** (the Codex review of `a209130`):
  a loaded or resumed session gets the permission mode, a listed model and
  the effort the agent shows, or the load fails; the agent never shows a
  mode stricter than the one in force. What it shows comes from the
  backend's answer or an explicit set, never from a value the session's
  handle merely holds (Codex on `4eb0156c`: Muse Code's resumed handle
  holds the model asked for, the CLI the one last used): the model is
  the one `model/list` reports active for the session where the agent
  lists it, else the default, set. A session is held, and its id
  answered, only once it is set up; a new, loaded or resumed session
  whose setup fails is let go. A session loaded again lets the one held
  go first, and one still being set up by an earlier load, as both hosts
  hand the same session back; a close lets both go. A session let go
  changes nothing more on the backend, sends the editor nothing more,
  decides nothing on the editor's late answers (a paid use is denied),
  and its running prompt ends cancelled with its turn stopped on the
  backend once its start is answered (even a failed start, which past
  its deadline may still begin). A reload follows the session only once
  the held one's turn is stopped; the backend stopping lets go of loads
  being set up too. The client's answers to the
  agent's own requests (permission, elicitation) are parsed with zod, and
  a form answer must be one the form allowed (its options, how many), or
  the question is declined. The agent's log names a backend failure by
  its kind (`failureForLog`, PR #49), never by its message.
- **Trust**: a folder's rules, skills and memory load only with
  `--trust-workspace`, the flag Muse Code itself takes (D13); ACP carries
  no workspace trust of its own.
- **Paid features are off in the agent** (rule 12, D60) until a
  confirmation over `session/request_permission` that names the price is
  built and certified. **Built 2026-09-26 (M63c):** `--web-search` and
  `--image-generation` (Model API backend only) let the first prompt ask
  for each, with the panel's title and price; only "Turn on" turns it on,
  for the life of the process, and anything else leaves it off without
  asking again. Paid rows and approvals name their price; Muse Voice has
  no microphone in the agent.
- **Amended 2026-09-27 (M58 joined, D48): every paid use asks in the
  editor.** The owner's rule, "anything requiring extra payment should
  prompt … allow once, allow always in this workspace, or deny", holds in
  the agent too, through the core's `PaidUseConsent` and the panel's own
  words (`paidUseQuestion`, moved beside it so the modal and the agent say
  the same):
  - A feature is on only with its flag (`subagents`, scheduled prompts and
    Muse Voice have none, so they are always denied); each use then asks
    over `session/request_permission` in the conversation it is for: a row
    naming what is about to be billed and its price, and the options
    `allow_once`, `allow_always` and `reject_once`. Web search asks once per
    prompt, an image before it is bought, as in the panel. The first
    prompt's "Turn on" question is gone: the price is named every time
    instead, and asking twice before one prompt would say the same thing
    twice.
  - The Model API host serves every conversation of a folder, so its
    `allowsPaidUse` now names the conversation (`sessionId`, a child task's
    being its parent's); the agent asks in that ACP session and denies when
    it holds no such session or has no client to ask. A cancelled prompt,
    an option it did not offer, or a failed request is Deny.
  - "Allow always in this workspace" is offered and honoured only with
    `--trust-workspace`, as the panel offers it only in a trusted workspace.
    It is kept per folder in the agent's data folder (`acp/paid-uses.json.d`,
    per-feature generations and workspace-hash/generation grant records,
    `src/runtime/paidGrants.ts`), read at every question so other agent
    processes' changes count. Independent records and atomic generation
    revocation prevent cross-process stale writes from restoring a revoked
    grant or replacing a newer one; the earlier JSON map is ignored and asks
    again. A filesystem that cannot safely publish the generation remembers
    nothing and keeps the explicit use as Allow once. The grant
    lapses in every folder when the agent starts without that feature's
    flag, so turning the flag on again asks again (the panel's grant
    generation, D48, in the agent's terms).
- **Networks (Q66, 2026-09-27): loud, not re-routed.** VS Code's proxy and
  certificate settings do not reach the agent, and Node's `fetch` uses the
  environment's proxy only with `NODE_USE_ENV_PROXY=1` (Node 22.21+, 24+).
  The agent does not turn that on or add a proxy agent of its own; it logs
  one warning at start when `HTTPS_PROXY`, `HTTP_PROXY` (either case) is set
  for the Model API backend and the switch is off or this Node lacks it, and
  a request that never reaches Meta names the agent's environment
  (`NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`,
  `--use-system-ca`) rather than VS Code's `http.*` settings. Muse Code,
  started by the agent, reads the proxy variables itself.
- **Tools run in the agent**, as ACP allows. Routing the Model API
  backend's file reads and writes through the client (`fs/*`), so an
  unsaved buffer is seen and never overwritten, is a later step, with its
  own tests (the owner's plan, §6.1).
- **Where it is tested**: against the SDK's own client in-process and
  over a real stdio pipe to the built `dist/acp.js`, with the fake Muse
  Code CLI (`test/e2e`); in editors as each can be installed. This
  container reaches npm, PyPI, Maven Central, Gradle, NuGet, Ubuntu's
  archive and download.eclipse.org, and not JetBrains, Microsoft's
  VS Code downloads, Open VSX, Zed's site or neovim.io (2026-09-26).
- **The order**: the most-used editors first. VS Code's family (Cursor,
  Windsurf, VSCodium, Kiro, Positron, Theia, code-server, Codespaces)
  through the `.vsix` and Open VSX (M62); the JetBrains IDEs, Zed, Neovim,
  Emacs, Xcode 27, Qt Creator, Sublime and Devin through this agent (M63);
  then Visual Studio and the JetBrains full panel (M64); Eclipse,
  NetBeans, Jupyter, Spyder and RStudio (M65); and the constrained hosts
  (M66). `docs/ide-compatibility/hosts.md` tracks each editor's route and
  status.

### D63 — Turn checkpoints ship as a Preview, and the restore is rebuilt on the tools' own writes (2026-10-01)

- **What happened.** PR #55 went through seven Codex review rounds. From
  the third on, every round found new P1 races of one family: the restore
  undoes the difference between whole-workspace captures, so it must decide
  which changes were the turn's and which were the user's, another window's,
  a subagent's, a dead window's, or the clock's. Each fix closed one case and
  opened ground for the next (4, 6, 5 and 6 new findings in rounds 4 to 7).
  The owner's rule from 2026-09-28 (a third round means redesign, not
  patching) applied from round three and was not raised; the owner raised it.
- **Decision (owner, 2026-10-01).** 0.10.0 ships with `museSpark.turnCheckpoints`
  off by default and marked Preview: a user who turns it on gets M72 as
  certified, with its limits recorded in `docs/certification/m72.md`. The
  restore is rebuilt in M86 on the model's own tool writes, and the setting
  goes back on by default only with M86.
- **The new design (M86).** Each write a model tool makes records the file's
  bytes before and after (the tools already copy a file before writing it).
  A restore puts a file back only when it still holds exactly the bytes the
  tool left; any other content (a user's save in any window, another
  window's turn, a shell command, a later tool write it does not undo) is
  refused and named. Ownership is never inferred from captures, so the
  multi-window, overlap, tie and clock races cannot arise. A shell command's
  changes are listed, not undone, as Claude Code's own rewind does; this
  narrows D51, which promised to undo them.

## 3. Open questions (need the owner)

- **M72 native/process exclusion:** what upstream pre-edit fence and locally
  owned full-descendant shutdown proof can make native/command/hook snapshots
  destructively restorable? Current availability refuses unproved process
  state; no wire field, primary exit, pipe drain or dead window PID supplies
  that proof. Explicit confirmed removal of only a stale unsafe presence file
  preserves saved checkpoints. No paid/live capture is authorized by this
  implementation; investigate a bounded future proof separately.
- **M72 hooks:** should a hook get a final admission of its own? Today none:
  SessionEnd hooks run on purpose while the Host closes, hook settings are
  user-global and not trust gated, and Stop is honoured through the signal; the
  wrapper's activity mark still fences Restore. Default: unchanged.
- **M72 long storage paths:** should a checkpoint folder over 240 characters
  (Windows) be served by moving the repository? That would change the hashed
  namespace. Default: refuse with the `checkpointPathTooLong` message.
- **M72 dirty buffers in other windows:** a restore refuses a file with unsaved
  changes in the window that restores, but an idle peer window on the same folder
  publishes only that it is open, so its unsaved buffer of a file the restore
  overwrites or deletes is not known. VS Code keeps that buffer and reports the
  file changed on disk at its next save (it asks before overwriting), so nothing
  is silently lost. Should every window publish its unsaved paths in its
  presence file, so a restore refuses them too? Default: unchanged, recorded as
  a limit (Codex, `a424e526`).
- **M73/M75 live key (answered 2026-10-02):** the owner approved the spend
  and this handling for M73's run: the test key decrypted from its DPAPI
  file in memory and piped to `auth set`'s standard input only, the run, and
  `auth clear` in a `finally` (`docs/certification/m73.md`). The harness's
  key source is unchanged.
- **M73 Evidence-Preserving Reducer:** a paid model call (D48), but the M75
  evaluation fails any task on which a paid use happens. Should the
  evaluation gain a priced, counted paid arm for it, or should the reducer be
  judged by its own D48 consent without an M75 run? Default: not built.

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Default until answered                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Q1  | **Resolved 2026-09-22:** owner authorised installing anything needed; Muse Code CLI 1.3.0 installed via the official installer. The owner reported Muse Code CLI device sign-in and a pay-as-you-go Model API key; M7 keeps them apart (D1 amendment). A separate current Muse Code paid entitlement or tier is unverified; the personal Muse Power/Maximum screenshot is not CLI entitlement proof.                                                                                                                                                                                                                                                                                         | Closed.                                                                                 |
| Q2  | **Resolved 2026-09-22:** publisher `RandyNorthrup` read from the signed-in marketplace management page. Display name stays "Muse Spark Code (Unofficial)" unless the owner asks otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Closed.                                                                                 |
| Q3  | **Resolved 2026-09-22:** owner wants both the CLI (MSP) backend and the Model API backend in the first release. M7 is required for v0.1.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | M7 required; see §10.                                                                   |
| Q4  | **Resolved 2026-09-22 (M9, superseding the M8 answer):** voice dictation ships through the operating system's own recogniser, at no API cost and with no third-party code (owner's constraints): Windows PowerShell 5.1 + `System.Speech` on Windows, a Swift helper on Apple's Speech framework on macOS (owner chose this over an `osascript` bridge), and a dimmed button with the reason on Linux (no distribution ships a recogniser; the owner may revisit). The M8 finding stands for the webview itself: Electron's Web Speech recogniser is dead, so recognition runs in a helper process.                                                                                          | Closed; see M9.                                                                         |
| Q5  | **Resolved (M4):** `highlight.js` 11.12.0 core with a fixed language set, in the webview bundle; `shiki` was not taken (grammar weight).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Closed.                                                                                 |
| Q6  | **Partly answered (M55):** Meta's Muse Code overview (checked 2026-09-25) documents `curl -fsSL https://dev.meta.ai/install.sh \| sh` for macOS and Linux, and the panel offers it; `muse` itself has not been run on Linux.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Offer the installer; the Model API key remains the fallback if `muse` is absent.        |
| Q7  | **Resolved 2026-09-22:** owner pressed F5 and confirmed the Muse Spark chat shell renders in the Extension Development Host (verbal confirmation; no screenshot filed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Closed.                                                                                 |
| Q8  | **Resolved 2026-09-22:** owner signed in; publisher is `RandyNorthrup`. Publishing ran by hand from the CI artifact with a clipboard PAT for 0.1.0–0.5.0; since 2026-09-23 the `VSCE_PAT` repository secret lets `release.yml` publish every `v*` tag.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Closed.                                                                                 |
| Q9  | The Muse Code user rules file: `/rules import` writes one into the config root and the model is told "if user and project rules conflict, project rules win", but its file name is not printed by `muse --help`, `muse skills`, the settings skill or the binary's strings. The Model API backend cannot mirror what it cannot name.                                                                                                                                                                                                                                                                                                                                                         | Not loaded on the Model API backend; the CLI backend loads it itself.                   |
| Q10 | M67's repo map on Muse Code: the plan asks for it "as an opt-in section of the system prompt", but Muse Code's instructions are its own (D13: nothing installed into its folders). It could ride as a hidden note on the first turn of a conversation (as the question-card hint does), billed to the subscription as prompt tokens. Wanted?                                                                                                                                                                                                                                                                                                                                                 | The `repoMap` tool only; no note in Muse Code turns.                                    |
| Q11 | M67's prompt repo map setting: its name (`museSpark.modelApiRepoMap`), its default (off, since every request pays its tokens) and its fixed ~1,000-token budget, and whether the model should see the map by default once the M75 evaluation measures it.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Off by default, machine-scoped, 1,024 tokens, no budget setting.                        |
| Q60 | **Answered 2026-09-26:** the owner set up the Open VSX account: the Eclipse Publisher Agreement signed, the namespace `RandyNorthrup` created, the token in `OVSX_PAT`. The release workflow publishes there from the next tag (M62).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Q61 | **Resolved 2026-09-26:** the owner approved the ACP SDK. `@agentclientprotocol/sdk` 1.4.0 is pinned: 1.5.0 (2026-09-21) is inside `.npmrc`'s 7-day `min-release-age`, and 1.4.0 speaks the same ACP v1 (D62).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q62 | **Resolved 2026-09-26:** "you can install whatever you need". What this container's network lets in is recorded per editor (D62); the rest is qualified in CI or on the owner's machines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Q63 | **Resolved 2026-09-26:** the owner left the design to us: D61, the operating system's credential store, in-process.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Q64 | **Resolved 2026-09-26:** "the top editors come first but i want them all or as close to all as possible": the order is D62's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q65 | **Answered 2026-09-26:** after npm held the owner's account for suspicious activity, the owner set `NPM_TOKEN` in the `marketplace` environment. The name `muse-spark-code-acp` was free that day; the next tag publishes it, and each GitHub Release still carries the package.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Q66 | **Resolved 2026-09-27: loud, not re-routed.** The ACP agent's own requests (the Model API backend) use Node's `fetch`, which ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` (Node 22.21+ or 24+; measured on seven releases). The owner: the agent does not re-route by itself or add undici. It warns once at start, in its log, when a proxy variable is set for the Model API backend and Node's switch is off or missing (`src/runtime/proxyWarning.ts`), and a request that never reaches Meta gets advice naming the agent's environment variables instead of VS Code's `http.*` settings (M56's classifier, told by the runtime which host it serves: `networkAdvice: 'agent'`). | Closed; `docs/acp.md` "Networks and proxies", `docs/certification/pr32-integration.md`. |
| Q12 | Should a shell tool session rule ("Always allow in this session" for a shell command) lapse when the model edits a file the command names or that decides what it runs, as the verify loop's rules do since M68? Today the shell tool keeps its pre-M68 behaviour: its rules are keyed on the exact command line and answer whatever the model edited. The verify loop's grants are kept apart from it (PR #54).                                                                                                                                                                                                                                                                             | The shell tool's rules keep answering; only the verify loop's lapse.                    |

### Q-M74 — Remaining automatic work (2026-09-29)

The handoff repair does not complete automatic compaction, memory flush or
the hidden todo follow-up. The lead must choose the billable-call/consent
contract before implementing them. Until then they stay unimplemented and
off; no background or hidden paid call is authorised by a setting draft.

Minimal completion design, pending that choice:

1. Reuse the existing Model API tool-loop boundary after a completed todo
   transition and the existing context/usage and compaction primitives.
   Decide once at a settled boundary, using the supported model's existing
   cache prices and window limit; do not create a scheduler or a second
   compaction engine. No autonomous work after the user's turn ends.
2. Snapshot the exact open todos, goal and untrusted-content provenance.
   Preserve these separately from the generated summary, then restore the
   exact list before another request. A hidden model restatement must have
   an explicit cost/consent contract, run through the same M82 account/key,
   cap, Stop and final-send checks, and may not replace the authoritative
   list with a lossy model guess.
3. A memory flush uses the existing MemoryStore and permission engine:
   Manual asks, Plan and Restricted Mode refuse, and notes derived from
   tool/fetched/imported content retain an untrusted label. If generating
   those notes adds a model call beyond the user's turn, use the existing
   paid gate and paid-use popup with its own explicit feature/price and
   usage row; do not reuse another paid feature's grant or hide the cost.
4. Build one M75 arm on the current verified harness. Freeze long-context
   accept/held-out tasks before running it, exercise todo preservation,
   provenance, memory refusals and Stop, and require actual compaction
   evidence as well as both 0.75 capability floors. Only a passing current
   pair permits an off-by-default production setting. Record paid attempts,
   known/unknown usage, source hashes and the incomplete inventory honestly.

## 4. Architecture

```
VS Code extension host (Node)
  src/extension.ts             activate(): the view, the panel, the commands, the
                               output and file openers, the usage cache
  src/host/                    VS Code-facing adapters
    views/                     the WebviewView (sidebar) and WebviewPanel (editor
                               tab); the zod-validated postMessage bridge
    conversation/              ConversationController: one panel's session, turns,
                               approvals, questions, edits, rewind, usage, references
    backend/                   MuseCodeBackendManager (spawns `muse serve`), the
                               Model API tool harness (toolIo, searchWorker), the
                               file session store
    auth/                      SecretStorage for the key; `muse login` in a terminal
    editor/, mention/          open-file context, @mention search, diff documents
    commands/, settings.ts     the commands; museSpark.* readers with defaults
    voice/, usage/, ide/       the dictation helper host; trace-log insights; the
                               loopback MCP server that serves getDiagnostics
  src/core/                    backend-agnostic, no `vscode` import
    agent/agentBackend.ts      AgentHost / AgentSession: startSession, sendTurn,
                               cancel, setModel, setReasoningEffort, setApprovalMode,
                               listModels, listSessions, resumeSession, forkSession,
                               compact, decideApproval, answerQuestions,
                               cancelQuestions, controlSubagent, messageSubagent
    backends/musecode/         the MSP adapter over @muse-code/sdk (MuseCodeHost,
                               launch, notification mapping, session records)
    backends/modelapi/         fetch + SSE client, the tools, the permission engine
                               that reproduces the approval-mode semantics
    context/, usage/, voice/   rules, skills and memory loading; trace-log parsing;
                               the dictation driver
  src/shared/                  constants, the zod protocol, agentEvents (turnStarted,
                               textDelta, reasoningDelta, toolStarted, …), palette,
                               effort, permission modes, sessions, usage
                                 │ postMessage (zod-validated both ways)
Webview (browser, React 19)
  src/webview/main.tsx         mount, theme tokens from VS Code CSS variables
    App.tsx                    the panel: transcript scroll, menus, dialogs, wiring
    components/Composer        input, "+" attach, "/" palette, @mention, chips,
                               model/effort pill, permission-mode button, send/stop
    components/Transcript,     streaming markdown, code blocks (copy/insert/apply),
      ToolRow, ReasoningRow    tool rows with diffs and outputs, thinking rows
    components/ApprovalCard,   approval and question cards, the reply and quote
      QuestionCard, QuoteMenu  menus
    components/HistoryDialog,  history; account & usage; the Agent map with its
      UsageDialog, AgentMap    owner controls
    state/uiState.ts           reducer over the AgentEvent stream
```

Key parity mapping (Claude Code UI → MSP method) is recorded in §5.

## 5. Research and version-verification notes

Full notes with URLs were gathered on 2026-09-21 and are summarised here so the
rationale survives without the research transcript.

### 5.1 Muse Spark and the Meta Model API (official sources: dev.meta.ai, ai.meta.com, research.meta.ai)

- Model IDs: `muse-spark-1.3` (current), `muse-spark-1.3-contributor`,
  `muse-spark-1.2`, `muse-spark-1.2-contributor`, `muse-spark-1.1`.
  No Pro/Mini variants; `reasoning_effort` is the quality axis.
- Context 1,048,576 tokens; max output 131,072; images ≤ 50 per request;
  PDFs first 50 pages.
- Base URL `https://api.meta.ai/v1`; `POST /responses` (recommended, keeps
  reasoning across tool turns via `previous_response_id` or
  `include: ["reasoning.encrypted_content"]`), `POST /chat/completions`,
  `POST /messages` (Anthropic-compatible), `GET /models`, `GET /status`,
  `POST /responses/input_tokens`.
- Auth `Authorization: Bearer <key>`; keys look like `LLM_…` (older keys
  `LLM|<id>|<secret>`).
- `reasoning_effort` ∈ `minimal|low|medium|high|xhigh|max`; `none` is a 400;
  `max` only on Standard-tier 1.3. Reasoning summaries via `reasoning.summary`.
- Tools: function tools, parallel by default, **`tool_choice` only `"auto"`**.
- Prompt caching automatic; `prompt_cache_key`, `prompt_cache_retention: "24h"`.
- Pricing: Standard $1.25 / $0.15 cached / $4.25 per 1M tokens, 3,000 RPM,
  4M TPM. Contributor $0.10 / $0.002 / $0.20, 100 RPM, 3M TPM, **Meta trains on
  content**.
- ToS (2026-09-18): keys must not be shared or embedded; Integrated Products
  need a privacy policy and AI disclosure; users 18+; no reverse engineering
  of harnesses; do not imply Meta endorsement.
- There is **no official OAuth / device-code flow** for third parties.
  Muse Code subscription credentials are "for use with Muse Code only".

### 5.2 Muse Code CLI and `@muse-code/sdk` 1.3.0

- CLI: closed source; install `curl -fsSL https://dev.meta.ai/install.sh | sh`
  or `irm https://dev.meta.ai/install.ps1 | iex`; auth precedence
  `META_API_KEY` env → stored key → stored browser session; `muse login`,
  `muse auth set`, `muse logout`. `muse serve` hosts MSP over stdio.
- SDK exports used: `spawnMspConnection({command,args,cwd,env,onStderr})`,
  `MspHandshake.initialize({clientInfo, capabilities})`, `Connection.command`,
  `onNotification`, server-request handlers, `SessionFold`, error classes,
  `checkServedFingerprint`.
- Wire vocabulary (from the package's `msp.d.ts`, authoritative over the
  summarised docs): methods `session/start|resume|fork|list|read|compact|
setModel|rename|setReasoningEffort|setApprovalMode|userShell`,
  `turn/start|steer|interrupt|cancel`, `model/list`, `skill/list`,
  `approval/decide`, `userInput/answer`, `usage/read`, `item/readOutput`,
  `task/*`, `subagent/*`; notifications `turn/*`, `item/started|delta|updated|
completed`, `approval/*`, `userInput/*`, `session/*Changed`,
  `session/tokenUsage`, `session/contextUsage`, `usage/changed`; server
  requests `approval/request`, `userInput/request`.
- Enumerations: `ItemKind` = userMessage | agentMessage | reasoning | toolCall
  | userShell | subagent | workflow | reminderChild | compaction;
  `ApprovalMode` = allowAll | promptUnmatched | onRequest | denyUnmatched;
  `ReasoningEffort` = none | minimal | low | medium | high | xhigh | max |
  ultra; `TurnInputPart.type` = text | image (base64Data, mediaType, width,
  height) | skill (selector, arguments); `ApprovalChoice.scope` = once |
  session | localPersistent.

### 5.3 Claude Code VS Code extension parity inventory (code.claude.com/docs)

P0 for v1: sidebar + editor-tab panel; session history with search and
auto-titles; selection and open-file context chips; `@` fuzzy file mention;
attachments (files, images via paste/drag) with `name W×H` chips; `/` palette
with grouped sections (Context / Model / Customize / Account & usage / Skills /
Slash commands / Support) and "Filter actions…" search; model pill
"Model (ctx) Effort" with picker and effort slider; permission modes (Manual,
Edit automatically, Plan, Auto, Bypass); streaming markdown with highlighted
code and Copy / Insert / Apply; native diff viewer with Accept / Reject;
permission cards (Allow once / Always allow + scope / Deny); question cards;
keybindings Ctrl+Esc (focus), Ctrl+Shift+Esc (new tab), Alt+K (insert
`@file#lines`), Ctrl+Alt+F (focus view), Alt+T (toggle extended thinking, bound here as
Ctrl+Alt+T on Windows and Ctrl+Alt+O on Linux because Alt+T is a Windows
menu mnemonic;
Ctrl+O is the CLI's transcript toggle, not a VS Code binding);
browser-based sign-in; `claudeCode.*`-style settings incl. initial permission
mode. P1: tool rows, thinking blocks, plan approval, context %, usage panel,
/compact. P2: rewind/fork, voice, /btw, agent map, session groups.

Second docs pass (2026-09-21, every page under code.claude.com/docs that
touches the VS Code composer, plus the owner's screenshots of Claude Code,
kept outside the repository since the 2026-09-23 cleanup): the composer bar is `+` (menu: Upload from computer / Add
context / Browse the web), `/`, a prompt-cache clock ("59m"), an "N agents"
pill, the model pill `Model Effort` (no context window in the pill), the
open-file chip (`PLAN.md ×`), the mode button (`⚡ Auto`) that opens a Modes
menu (Manual / Edit automatically / Plan / Auto with one-line descriptions,
`⇧ + tab to switch`, an Effort row; Bypass only with
`allowDangerouslySkipPermissions`), a microphone, and Send / Stop; the
placeholder reads "Queue another message…" while a turn runs. Items with no
Muse counterpart, verified and left out: **Browse the web** (needs the Claude
in Chrome extension), the **prompt-cache clock** (no MSP cache-TTL signal;
`session/tokenUsage` reports cached tokens only), the `/` menu's Output
styles / Hooks / Permissions rules / Memory / Instructions / MCP / Remote
Control entries (no MSP methods; Muse Code manages these in its own config),
and the `!` shell prefix (not offered by the Claude Code extension either).
Deferred, not dropped: the "N agents" pill (`subagent/*`, M4/M6), the
open-file chip (M5), the microphone (M9, Q4; Claude's is "Tap or hold to
record Ctrl+D", recording in the CLI and transcribing on Anthropic's servers
at no charge to the user; ours recognises on the machine).

Parity mapping to MSP: model pill → `model/list` + `session/setModel`; effort
→ `session/setReasoningEffort`; permission mode → `session/setApprovalMode`;
Stop → `turn/cancel` then `turn/interrupt`; history → `session/list|read|
resume`; rename → `session/rename`; rewind/fork → `session/fork`; /compact →
`session/compact`; todo panel → `session/todoListChanged`; context % →
`session/contextUsage`; usage → `usage/read`; permission cards →
`approval/request`; questions → `userInput/request`; tool rows → `toolCall`
items + `item/readOutput`; skills → `skill/list` + `skill` input part;
"!" shell → `session/userShell`; agent map → `subagent/*`, `task/*`.

### 5.4 Live MSP smoke test (Windows, 2026-09-22, signed-in CLI)

Script: session scratchpad `sdk-probe/echo-smoke2.mjs` over `@muse-code/sdk` 1.3.0
against Muse Code 1.3.0-R3401.1, both spawn modes (D1a). Observed:

- `initialize` → `session/start` → `turn/start` → streamed `item/delta`
  (`{ itemId, field: "text", delta }`) → `turn/completed`
  (`terminal: "completed", durationMs: 11214, timeToFirstTokenMs: 5123`).
- **The host's default session model is `muse-spark-1.3-contributor`** (the
  training-consent tier). The extension must always pass `modelId` on
  `session/start` and default to `muse-spark-1.3`; contributor stays opt-in
  (D4).
- `model/list` returns `providerId: "meta"`, entries with `contextLimit:
1007997`, `outputLimit: 128000`, `cost: { input: "1.25", output: "4.25",
cached: "0.15", currency: "USD" }`, `isDefault`, `isActive`, `releaseDate`.
- Default `approvalMode.mode` is `onRequest`. Session files live under
  `~/.local/share/muse/sessions/YYYY/MM/DD/<sessionId>/session.jsonl` (also
  on Windows).
- Item kinds seen in one turn: `userMessage` (completed immediately),
  `reminderChild` (host-internal, in progress → completed), `agentMessage`
  (started → delta → completed). `session/tokenUsage` (inputTokens 20804,
  cachedTokens 10481, outputTokens 210) and `session/contextUsage`
  (`windowTokens: 1007997, usedTokens: 21014, pressure: "normal"`) arrive after
  the message completes.
- `usage/read` returned `{}` for this pay-as-you-go account (no subscription
  window); the Account & usage panel must render token totals in that case.
- On `close()`: `session/closed { reason: "hostShutdown" }`, then
  `session/statusChanged { status: "notLoaded" }`, child exit code 0.
- The SDK's `SpawnedMspConnection` did not expose `serverInfo`/`museHome`/
  `fingerprint` on the object returned by `initialize` in this build (all
  `undefined`); read them from the raw `initialize` result instead (verify at
  M2).
- A hung run left a `muse-bin` child alive after the Node parent exited; the
  extension must track the child PID and kill the tree on dispose.

## 6. Milestones

Every milestone carries the same certification checklist (§6.0) plus its own
acceptance criteria. **A milestone is not complete until its checklist passes.**

### 6.0 Standard certification checklist (applies to every milestone)

- [ ] `npm run quality` exits 0 on a clean checkout (format:check, lint incl. lint:ps,
      typecheck, check:l10n, deadcode, cycles, duplication, test:unit with coverage
      thresholds, build with bundle budget, host globals and notices, security:audit,
      test:a11y, security:secrets, security:sast).
- [ ] Each new gate or test was seen to **fail** on a deliberate break, then
      pass again (record the break in the milestone notes).
- [ ] No new `eslint-disable`, `@ts-expect-error`, `as unknown as`, or `any`
      without an inline reason **and** a row in §8.
- [ ] No magic literals outside `src/shared/constants.ts` (and tests).
- [ ] No placeholder / mock / fallback code outside `test/**`.
- [ ] `README.md` updated for any new command, setting, or script; every
      documented command was run.
- [ ] `CHANGELOG.md` entry under `[Unreleased]`.
- [ ] Security review of new surfaces (inputs validated, secrets never logged,
      CSP intact, spawn args explicit).
- [ ] Visual milestones: screenshot or manual-check record in
      `docs/certification/<milestone>.md`.
- [ ] Commit with a message describing what changed and why.

### M0 — Scaffold and gates (this session)

**Status 2026-09-22: complete.** Certification record: `docs/certification/m0.md`.
All gates pass on the scaffold and were each proven to fire; the visual F5 check
is the one open item (Q7).

- **Goal**: production-grade skeleton; every gate green on the empty scaffold.
- **Scope**: repo init, toolchain, configs, CI, hooks, docs, minimal extension
  that activates and shows an empty webview, minimal tests.
- **Files**: `package.json`, `package-lock.json`, `.npmrc`, `tsconfig*.json`,
  `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`,
  `.stylelintrc.json`, `knip.jsonc`, `.jscpd.json`, `vitest.config.ts`,
  `.vscode-test.mjs`, `scripts/build.mjs`, `scripts/check-bundle-size.mjs`,
  `.husky/pre-commit`, `.github/workflows/ci.yml`, `.gitignore`,
  `.gitattributes`, `.editorconfig`, `.vscodeignore`, `.env.example`,
  `.vscode/{launch,tasks,settings,extensions}.json`, `LICENSE`, `README.md`,
  `CHANGELOG.md`, `PLAN.md`, `AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`, `src/extension.ts`,
  `src/shared/{constants,protocol}.ts`, `src/host/views/ChatViewProvider.ts`,
  `src/host/html.ts`, `src/webview/{main.tsx,App.tsx,styles.css}`,
  `test/mocks/vscode.ts`, `test/unit/**`, `test/integration/**`.
- **Acceptance**: `npm run quality` green; F5 opens Extension Development Host
  with a "Muse Spark" activity-bar view rendering the empty state; each gate
  proven to fire (table in `docs/certification/m0.md`).
- **Tests**: protocol schema round-trip and rejection; HTML/CSP nonce builder;
  React `App` renders empty-state hint; integration: extension activates and
  view command exists.
- **Gates**: all of §6.0 plus first CI run green on ubuntu + windows.
- **Security**: `.env` ignored before first commit; gitleaks proven with a
  fake secret; CSP present in the webview HTML.
- **Performance**: bundle sizes printed and under budget.
- **Docs**: README (install, dev, scripts), CHANGELOG `[Unreleased]`.

### M1 — Panel shell, message bus, keybindings, settings

**Status 2026-09-22: complete.** Certification record: `docs/certification/m1.md`.
Delivered: sidebar + tab surfaces behind a `SurfaceRegistry`, typed message
bus with a settings snapshot, `museSpark.*` settings with validated reads and
live broadcast, keybindings Ctrl+Esc / Ctrl+Shift+Esc / Alt+K / Ctrl+Alt+F,
redacting logger, composer key semantics. Deferred to later milestones as
planned: mic button (P2), onboarding checklist (M8).

- **Goal**: the chrome of the Claude Code panel without a model behind it.
- **Scope**: sidebar `WebviewView` + editor `WebviewPanel` ("Open in new tab"),
  header (title, history icon, new-conversation icon), empty state
  ("Type /model to pick the right tool for the job."), composer skeleton with
  placeholder "ctrl esc to focus or unfocus Muse", "+" and "/" buttons,
  disabled model pill, send button; typed message bus; `museSpark.*` settings
  (`preferredLocation`, `initialPermissionMode`, `autosave`, `attachOpenFile`,
  `useCtrlEnterToSend`, `hideOnboarding`, `focusView`, `respectGitIgnore`,
  `museBinaryPath`, `environmentVariables`); keybindings `museSpark.focusInput`
  Ctrl+Esc, `museSpark.openInNewTab` Ctrl+Shift+Esc,
  `museSpark.insertMentionReference` Alt+K, `museSpark.toggleFocusView`
  Ctrl+Alt+F; output channel logger with secret redaction.
- **Acceptance**: keybindings work in the dev host; settings changes reach the
  webview live; a11y: composer reachable by keyboard, roles/labels set.
- **Tests**: reducer for UI state; settings mapper; keybinding contributions
  present in `package.json` (unit test reads the manifest); integration test
  toggles focus.
- **Docs**: settings table in README.

### M2 — Authentication and the Muse Code (MSP) backend

**Status 2026-09-22: complete.** Certification record: `docs/certification/m2.md`.
Delivered: per-OS launch resolver and child environment (pure, tested on all
three platform branches), `MuseCodeHost` over the SDK's raw `Connection`
with an in-memory fake MSP server for tests, `AuthService` (browser sign-in
via `muse login` in a terminal + credential-file watch, API-key sign-in into
SecretStorage, sign-out, host `authRequired` override), per-surface
`ConversationController`, sign-in gate / transcript / Send-Stop in the
webview. Approval mode is `denyUnmatched` until M4 ships the approval cards.
Live end-to-end run against the signed-in CLI recorded in the certification
file; the in-panel F5 check is the owner's.

- **Goal**: sign in and hold a streaming conversation with Muse Spark.
- **Scope**: `muse` binary discovery (setting → PATH → documented install
  dirs, per OS: Windows `%LOCALAPPDATA%\Programs\muse`, macOS/Linux per
  `install.sh`) with a spawn strategy per platform (D1a); install guidance when absent (opens dev.meta.ai/products/muse-code);
  sign-in screen with "Sign in with browser" (runs `muse login` in an
  integrated terminal, then re-probes) and "Use a Model API key" (input →
  SecretStorage → `META_API_KEY` in the child env); `MuseCodeBackend`:
  spawn `muse serve`, `initialize` with `clientInfo` and
  `capabilities.userInputDialogs = true`, fingerprint check, `session/start`
  with `workspaceRoot`, `turn/start` with text parts, fold `item/*` into
  `AgentEvent`s, `turn/cancel` / `turn/interrupt` for Stop, host-death
  recovery with a visible error, `/logout` → `muse logout`.
- **Acceptance**: with a signed-in CLI, a prompt streams back; Stop works;
  killing the child shows an error card and a "Restart" action; unauthenticated
  state shows the sign-in screen (detected from the turn error kind or a
  failing `usage/read` probe — verify which at implementation time).
- **Tests**: backend against a scripted fake `DuplexTransport` replaying
  recorded MSP transcripts (happy path, cancel, host death, auth failure);
  credential store never logs; env injection.
- **Security**: key redaction verified by a test that greps logger output.
- **Windows hazard (found 2026-09-22)**: the `muse.cmd` shim runs
  `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` and fails with
  `Get-FileHash` not recognised when the child inherits a `PSModulePath` that
  lists pwsh 7 module directories first. When spawning `muse` from the extension
  host on Windows, set `PSModulePath` in the child environment to
  `%ProgramFiles%\WindowsPowerShell\Modules;%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules`
  and cover it with a unit test.
- **Deferred if Q1 unanswered**: live certification.

### M3 — Composer and command palette parity

**Status 2026-09-21: complete.** Certification record: `docs/certification/m3.md`.
Delivered: the "/" palette (seven Claude Code groups from a pure registry in
`src/shared/palette.ts`, filter box, keyboard-only operation, model list as a
second view, skills from `skill/list`), "+" attach (native dialog; images
become host-held attachments with `W×H` chips, other files become `@path`
mentions; paste and drop of images; drop of editor resources), the `@`
mention menu over a `git ls-files` index (fuzzy-ranked, `.gitignore`
respected, VS Code file search as the fallback), model pill + picker
(`model/list`, `session/setModel`), effort slider and Thinking toggle
(`session/setReasoningEffort`, Ctrl+Alt+T / Option+T), the permission-mode button and
Shift+Tab cycle mapped per D7, Enter while a turn runs → `turn/steer` with a
fresh-turn fallback, `/clear` and `/compact`. Live checks recorded in the
certification file.

**Round two (2026-09-21, after the owner's second F5 check and the second docs
pass in §5.3):** the mode button opens the Modes menu and the `+` button
opens the attach menu (Upload from computer / Add context) instead of acting
directly; Bypass permissions sits behind `allowDangerouslySkipPermissions`
(D7); the pill reads `model effort` and hugs its text; the effort dots carry
tooltips and offer the tiers verified per model (D10, Minimal … Max); the
thinking toggle moved from Ctrl+O to Ctrl+Alt+T (Option+T on macOS,
Ctrl+Alt+O on Linux); the placeholder reads "Queue
another message…" while a turn runs; the brand mark is the Meta logo the
owner supplied (panel and activity bar). Harness scenarios `modes`,
`modes-bypass`, `attach`, `add-context` cover the new surfaces.

- **Scope**: "/" palette ("Filter actions…", groups Context / Model / Customize
  / Account & usage / Skills / Slash commands / Support) driven by a command
  registry + `skill/list`; "+" attach: files (QuickPick), images (paste, drag,
  file) as `image` parts with `W×H` chips; `@` mention autocomplete
  (`workspace.findFiles`, gitignore respected, `@path#L1-L9`, folders); model
  pill + picker (`model/list`, shows context limit as "1M"); effort slider
  (low / medium / high / extra high / max → `session/setReasoningEffort`);
  thinking toggle (maps to reasoning display + effort floor); permission mode
  button cycling Manual / Edit automatically / Plan / Auto / Bypass →
  `ApprovalMode` mapping (documented once verified against the CLI);
  Shift+Enter newline; Ctrl+Enter send option; queued message while running →
  `turn/steer`.
- **Acceptance**: every palette item routes; screenshots match the reference
  layout; keyboard-only operation of palette and mention menu.
- **Tests**: command registry; mention parser; image chip dimension reader;
  effort/mode mappers with negative cases.

### M4 — Transcript rendering

**Status 2026-09-22: complete.** Certification record: `docs/certification/m4.md`.
Delivered: GitHub-flavoured markdown for assistant text (react-markdown 10 +
remark-gfm 4, raw HTML never rendered, links through the host with an
http/https/mailto allow list, images reduced to alt text), fenced code as
highlighted blocks (highlight.js core, 18 grammars, Copy and Insert at
cursor), tool rows built on the live wire shapes (Read / Edit / Write /
PowerShell / Bash / Question labels, change line from `patchSummary`,
numbered diffs from the stored `tool_patch` document via `item/readOutput`
with the edit tool's unified `visibleOutput` as the interim view, `IN` /
`OUT` boxes for shell tools, generic rows for unknown tools and kinds),
reasoning rows ("Thought for Ns", summary parts), approval cards driven by
`approval/requested` → `approval/decide` including the multi-stage
`approval/updated` step, question cards for `request_user_input` →
`userInput/answer`, the pinned task list, retry notices, the session name in
the header, the context indicator in the composer, the status line with a
rotating verb, image chips inside user cards, and Focus view folding steps
behind one row. `HAS_APPROVAL_UI` is now true, so Manual / Edit
automatically / Auto run as their real MSP modes (D7). Code-block "Apply"
(diff into the editor) moved to M5 with the rest of the edit-review flow.

- **Scope**: streaming markdown (react-markdown + remark-gfm, sanitised),
  syntax highlighting (Q5), code block Copy / Insert into file / Apply; tool
  rows (collapsible, `item/readOutput` paging); reasoning blocks with Ctrl+O;
  approval cards from `approval/request` (choices rendered from
  `availableChoices` with scope labels, optional feedback); question cards from
  `userInput/request`; pinned todo list; context % and token usage footer;
  turn errors and retry notices; Focus view.
- **Reference (owner screenshots of the Claude Code transcript, 2026-09-21)**:
  tool rows are a bullet + bold tool name + monospace argument (`Edit
C:\…\App.test.tsx`, `Bash List the session images…`) with a one-line
  summary under it (`Added 82 lines`, `Removed 6 lines`, `Modified`) and a
  collapsible body: unified diffs with a line-number gutter and red/green
  rows for edits, `IN` / `OUT` boxes for shell commands (output clipped with
  a fade); reasoning collapses to `Thought for 14s`; assistant text that
  answered a mid-turn message carries a `· summarized` suffix; a spinner line
  with a rotating verb (`Calculating…`) sits under the last row while the
  turn runs; user messages show their image chips (`image.png 695×1032`)
  above the text in a horizontally scrollable strip; the mode button, pill and
  Stop stay live in the composer throughout.
- **Acceptance**: 10k-token response renders without jank (< 16 ms frames in
  the webview profiler); approvals resolve; questions answer; the transcript
  matches the reference above row for row.
- **Tests**: reducer folds for each `AgentEvent`; markdown sanitisation blocks
  script/HTML injection; approval decision payloads.
- **Security**: markdown rendered with `skipHtml`; links open via
  `env.openExternal` after confirmation for non-https schemes.

### M5 — Editor integration

**Status 2026-09-22: complete.** Certification record: `docs/certification/m5.md`.
Delivered: the open-file chip and its `<ide_selection>` /
`<ide_opened_file>` part with `displayText`, autosave before turns, Open
diff / Revert on finished edit rows through a `muse-edit:` content provider
and reverse-applied patch hunks, Apply on code blocks, and the IDE tool
server (MCP over loopback HTTP, `sessionMcp`) exposing `getDiagnostics`,
which `muse serve` catalogs as `mcp__ide__getDiagnostics`. All three flows
verified live through the controller (editor context answered without
tools, the model called the diagnostics tool, an edit was diffed and
reverted on disk); the live edit turn caught and fixed the extended-length
patch path (D11). Design fixed before code, from the Claude Code docs
(research notes) and the MSP facts below.

- **Facts that shape it**: in-workspace file edits are applied by the CLI at
  once and never prompt (D11), so a Claude-Code-style "review before write"
  is impossible on MSP — the review is _after the fact_ (open the diff,
  revert). `muse serve` grants `userShell`, `sessionMcp` and
  `sessionListStream` when asked at `initialize` (probe 2026-09-22), and
  `session/start.config.mcpServers` takes a per-session MCP server over
  `stdio` or `streamableHttp` (closed union), so an IDE tool server for
  diagnostics is possible without a child process: the extension host serves
  MCP over loopback HTTP with a per-host bearer token. `turn/start` has
  `displayText` ("presentation form … never model-visible"), which lets the
  durable transcript show what the user typed while the model also gets the
  editor context.
- **Editor context** (`attachOpenFile`, on by default): the host watches the
  active editor and its selection (debounced), broadcasts `editorContext` to
  every surface, and the composer shows a chip after the model pill (file
  icon, basename, `L5-10` while lines are selected, `×` to drop it until the
  file changes) as in the Claude Code bar. On send the webview says whether
  the chip was on; the host then appends a text part in the Claude Code
  wording — `<ide_selection>The user selected the lines 5 to 10 from
src/x.ts:\n…\n</ide_selection>` with the selected text (clipped), or
  `<ide_opened_file>The user opened the file src/x.ts in the IDE. This may
or may not be related to the current task.</ide_opened_file>` — and sets
  `displayText` to the typed text. The user card shows the same chip.
- **Autosave**: with `museSpark.autosave` on, every send first saves all
  dirty editors (`workspace.saveAll(false)`), so the CLI reads what the user
  sees.
- **Edit review**: Edit / Write rows gain **Open diff** and **Revert** once
  the item completes with a `patchRef`. Open diff fetches the stored patch
  document, rebuilds the pre-edit text by reverse-applying its hunks to the
  file as it is now, serves it through a `TextDocumentContentProvider`
  (`muse-edit:` scheme) and opens `vscode.diff(before, file)`. Revert writes
  the rebuilt text back through a `WorkspaceEdit` (a file the edit created is
  moved to the trash) and posts a notice. When the hunks no longer match the
  file (the user or a later edit changed it) both say so instead of guessing.
  The "Proposed changes" tab and Accept / Reject-before-write from the first
  cut are dropped: MSP offers no pre-write hook for in-workspace edits.
- **Code block Apply**: replaces the active editor's selection with the block
  (inserts at the caret when nothing is selected) and reveals the result;
  Insert at cursor and Copy stay as in M4.
- **Diagnostics**: `initialize` requests `sessionMcp`; `session/start`
  registers `ide` as a `streamableHttp` MCP server served by the extension
  host on `127.0.0.1:<ephemeral>` with an `Authorization: Bearer <token>`
  header (token minted per extension host, never logged, never on disk). The
  server implements `initialize`, `ping`, `tools/list` and `tools/call` for
  `getDiagnostics { uri? }` (errors and warnings from
  `languages.getDiagnostics`, capped), `mode: optional` so a server hiccup
  never blocks a session. Verified live: see `docs/certification/m5.md`.
- **Alt+K** (M3) is unchanged.
- **Tests**: patch reverse-apply (exact match, mismatch, created file, CRLF);
  `muse-edit` content provider and the diff / revert host module with fakes;
  editor-context text builder; the composer chip, dismissal and user-card
  chip; controller parts + `displayText` + autosave; the MCP HTTP server over
  a real loopback socket (auth, `tools/list`, `tools/call`, notifications
  → 202, GET → 405).
- **Security**: the MCP server binds loopback only, requires the bearer
  token, exposes one read-only tool and answers nothing else; reverts never
  touch files outside the workspace (paths come from the patch document and
  are resolved against the workspace root; anything escaping it is refused).

### M6 — Sessions, history, rewind

**Status 2026-09-22: complete.** Certification record: `docs/certification/m6.md`.
Delivered as designed below: the History dialog (paged `session/list`,
grouped and searchable, archive in `workspaceState`, live through the
`sessionListStream` events), resume with inline/snapshot history replayed
into the transcript, the sidebar's ten-minute restore, rename and fork
(offered; Muse Code 1.3.0 refuses both on Windows and the panel shows the
refusal), the unread badge / tab mark, and the tab title following the
session name. Deviations from the design, all deliberate: a `none` history
(host budget) is reported as a warning notice rather than paged through
`view/page` (no session here has come close to the budget; the fallback
stays on the M8 polish list); pending approvals / questions listed in a
resume's `pendingRequests` are not re-shown (the host re-issues them as
server requests, which this client declines by design; a resumed session
with a decision pending is an edge the live check could not produce);
resume applies the surface's effort and permission mode to the session
instead of reading the session's own, so the composer never lies. Wire
probe (`scratchpad/probe-sessions.ts`, no tokens) against the day's live
sessions:

- `session/list` rows carry `sessionId, path, status, activeTurnId,
createdAt, updatedAt, workspaceRoot, providerId, modelId, turnCount,
forkedFrom, title, firstUserPrompt` (no `name` until one is allocated, no
  `lastActivityAt` on rows — the resumed `Session` has it); `title` equals
  the first prompt for unnamed sessions. `firstUserPrompt` / `title` are
  built from the **whole** prompt, so the M5 `<ide_selection>` part shows up
  in them: the History dialog strips `<ide_…>…</ide_…>` blocks for display.
- `Session.modelId` is the metadata fold's model, which is the host default
  `muse-spark-1.3-contributor` even for sessions our `session/start` opened
  on `muse-spark-1.3` (the durable log shows every model request on
  `muse-spark-1.3` and `run.model.configured` naming it). Never seed the
  composer or label a row from `Session.modelId`; after a resume ask
  `model/list` (`isActive`) for the session's model.
- `session/resume` with `history: 'inline'` served `mode: inline` with the
  full item array for a one-turn session (11 items: `userMessage`,
  `reminderChild`s, `toolCall`s, `agentMessage`); `userMessage` items carry
  `turnId`, `commandId` and `text`.
- `session/rename` fails on Windows 1.3.0: "session name rename authority is
  unavailable: … UnsupportedPlatform". The title stays read-only on Windows
  (the error is surfaced as a notice if attempted); to re-check on Linux/macOS.
  Filed upstream as meta-models/muse-code-sdk#30 (2026-09-23).
- `session/fork` fails on Windows 1.3.0 too, with or without a `cutPoint`
  and on a session this connection never loaded: "invalid fork boundary for
  session …: WriteFailed" (`scratchpad/probe-fork.ts`). "Fork from here"
  therefore ships behind the same honest path: the action is offered, the
  CLI's refusal is shown as a notice, and the live check is deferred to
  Linux/macOS. Filed upstream as meta-models/muse-code-sdk#31 (2026-09-23).
- `session/read` (point-in-time, no lease) serves the same inline history as
  a resume (10 items for a one-turn session) and is what the fork cut-point
  lookup and the dialog's preview use.
- With `sessionListStream` granted, `session/listChanged` **does** arrive
  (a full `Session` row), alongside `session/closed {reason: hostShutdown}`
  and `session/statusChanged {status: notLoaded}` when the host shuts down;
  nothing arrived within 3 s of a `session/resume` of a `notLoaded` session
  in the same probe. The dialog therefore folds `session/listChanged` rows
  when they come and still refreshes with `session/list` when it opens and
  after its own actions. (A first run of this probe reported no
  notifications at all because its handler was written `(method, params)`
  while the SDK passes one `{method, params}` object — the same mistake
  that stalled the sandbox probe; both were re-run with the right shape.)

- **Wire facts (msp.d.ts, 1.3.0)**: `session/list {workspaceRoot?, limit ≤ 200,
cursor?, updatedAfter?}` → `Session {sessionId, name?, firstUserPrompt?,
createdAt, lastActivityAt?, modelId, branch?, status (notLoaded | idle |
running), attention? (approvalPending | inputPending), forkedFrom, path}`
  ordered by activity; `session/resume {sessionId, history: auto | inline |
snapshot | anchored, cursor?, excludeItems?}` → `{session, history {mode,
items | null, snapshot | null, noneReason?}, pendingRequests, viewCursor}`
  (the served `mode` is authoritative; `snapshot.state.items` carries every
  item at its latest revision plus name, todo list, context usage, effective
  model, pending approvals / user inputs); `session/read` is the same
  envelope without subscribing; `view/page {sessionId, limit 1–1000, cursor?,
direction?}` pages the raw view events when history came back `none`;
  `session/fork {sessionId, cutPoint?: {lastTurnId}}` → the resume envelope
  for the **new** session with `forkedFrom`; `session/rename {name}` → the
  canonical name (or `session/nameChanged` later); the `sessionListStream`
  capability (granted, M5 probe) adds `session/listChanged` rows next to
  `session/started` / `session/closed`. There is **no archive or delete
  method**: archiving is client-side. `Item` carries `turnId`, `commandId`,
  `displayText` and attachment metadata for `userMessage`, which is what a
  replayed transcript needs.
- **History dialog**: the header clock opens a History overlay above the
  composer (palette styling): a search box filtering on name and first
  prompt, rows grouped Today / Yesterday / Previous 7 days / Older by
  `lastActivityAt ?? createdAt`, each row showing the name (or the first
  prompt), the relative time and the branch, with hover actions Rename and
  Archive; `Enter` / click resumes; keyboard navigation as in the palette.
  Rows come from `session/list` for this workspace (paged to the cap) and
  stay live through `session/listChanged` / `session/started` /
  `session/closed`. Archived ids and the `museSpark.archiveInactiveSessions`
  days (default 14; 1 / 2 / 7 / 14 / never, as Claude Code) live in
  `workspaceState`; archived and stale rows are hidden, never deleted.
- **Resume**: `session/resume` with `history: 'inline'` preferred; the host
  posts one `historyLoaded {items, name, todos, context}` message and the
  reducer rebuilds the transcript from the item snapshots (user cards from
  `displayText ?? text` plus attachment metadata, the M4 rows for the rest)
  before live events continue from `viewCursor`; a `snapshot` answer feeds
  the same path from `snapshot.state`; `none` falls back to `view/page`
  forward from the start through the M4 notification mapper. Pending
  approvals / questions listed in `pendingRequests` are re-shown from the
  snapshot pointers. The resumed session's model, effort and approval mode
  seed the composer.
- **Persistence**: the last session id per surface kind is kept in
  `workspaceState`; a surface that opens within `SESSION_RESTORE_WINDOW_MS`
  (10 minutes, the Claude Code sidebar rule) of that session's last activity
  resumes it, otherwise it starts fresh and the dialog has it.
- **Titles**: `session/nameChanged` already drives the header; clicking the
  title edits it and sends `session/rename`, showing the canonical name the
  host settles on.
- **Fork ("Rewind")**: hovering a user card offers _Fork from here_:
  `session/fork` with `cutPoint.lastTurnId` = the turn before that message
  (the reducer maps `localId` → `turnId` from `turnAccepted` and keeps the
  wire `turnId` on replayed user items), then the surface switches to the new
  session from the fork's resume envelope. Claude Code's "Rewind code"
  (workspace checkpoints) has no MSP counterpart and is not offered; the
  M5 per-edit Revert is the closest tool.
- **Unread dot**: a turn that completes, or an approval / question that
  arrives, while the surface is hidden sets the view badge (`webviewView.badge`)
  or the tab's unread mark, cleared when the surface becomes visible.
- Already in place: new conversation (header button, `/clear`), `/compact`,
  independent sessions per editor tab.
- **Tests**: grouping, search and archive / restore policies (pure,
  deterministic clock); reducer replay of inline and snapshot history
  (M4 fixtures); fork cut-point mapping; rename round trip; badge policy;
  list-stream row folding. Live: `session/list` shape, `session/resume`
  served mode for a small session, `session/fork` envelope,
  `session/rename` normalisation, `session/listChanged` with the capability.

### M7 — Model API backend (bring-your-own key)

**Status 2026-09-22: complete against a fake server; live certification of
the Model API path pending the owner's go (each live turn is billed to the
owner's key).** Certification record: `docs/certification/m7.md`.

- **Scope**: `ModelApiBackend` on `POST /v1/responses` streaming; tool harness
  (read, write, edit, glob, grep, shell) with a permission engine implementing
  the same five UI modes; diffs through the M5 path; `GET /v1/models` key
  validation; contributor opt-in dialog; backoff on 429; usage from response
  `usage`; token pre-count via `/responses/input_tokens`.
- **Tests**: SSE parser on recorded streams; tool argument validation; permission
  engine truth table; contract tests against a local fake server.
- **Security**: shell tool disabled in Manual mode until approved per call;
  workspace-root path confinement for file tools.
- **As built** (`src/core/agent/agentBackend.ts` is the internal protocol both
  hosts implement; `src/core/backends/modelapi/`):
  - `client.ts`: `GET /models`, `POST /responses/input_tokens`, streamed
    `POST /responses`; the documented retry policy (429 / 500 / 503 with
    exponential backoff, jitter and `Retry-After`, four retries before any
    body is read; 400 / 401 / 403 / 404 / 413 / 504 never retried); the key
    is read per request and never logged.
  - `schemas.ts`: the Responses shapes read (message / function_call /
    reasoning output items, usage, the stream event union with unknown types
    skipped, the error envelope, the model list).
  - `ModelApiHost.ts`: one session = a replayed conversation (`store: false`,
    `include: ["reasoning.encrypted_content"]`, `prompt_cache_key` = session
    id, `reasoning.summary: auto`, the UI effort mapped one-to-one and the
    Thinking-off `none` sent as `minimal` because `none` is a 400). Each
    turn streams reasoning summaries (`summary.N` deltas), text deltas and
    function calls into the same AgentEvents as MSP; function calls run
    through the permission engine and the tool harness, their results go
    back as `function_call_output` items, up to 50 rounds per turn; steering
    appends the input before the next model call; a second send queues;
    cancel aborts the fetch and any pending card; `compact` summarises with
    one model call and replays only the summary, then reports the new
    context size from `/responses/input_tokens`; `session/list`, resume and
    fork are served from the sessions this window holds (not persisted:
    the M8 polish list carries a JSON session store); no skills; rename is
    local.
  - `tools.ts`: `read_file`, `edit_file` (exactly one match), `write_file`,
    `search` (regex, glob, three output modes), `list_files`, the platform
    shell (`powershell` on Windows, `bash` elsewhere, one command line
    spawned as an argument array, timeout and output caps), `ask_user`
    (question cards) and `todo_write` (the task list). Paths are confined to
    the workspace root on both path styles. Edits leave a Muse-shaped patch
    document (Open diff / Revert of M5 work unchanged).
  - `permissions.ts`: `allowAll` runs everything; `onRequest` (Auto) runs
    reads and edits and asks for shell — there is no LLM judge here, so Auto
    is Edit-automatically with a prompt for commands; `promptUnmatched`
    (Manual) asks for edits and shell; `denyUnmatched` (Plan) refuses both.
    Cards offer Allow once / Always allow in this session / Reject with
    feedback; a session rule never overrides a refusal.
  - Host side: `ModelApiBackendManager` (real `fetch`, the stored key, the
    workspace file lister, `toolIo.ts` over node:fs and child_process),
    `backendSelection.ts` (see D1), the sign-in gate offering the paths the
    selection allows, the palette's Backend row, and the contributor guard
    (one modal yes per conversation; `confidentialWorkspace` hides the tier
    and refuses it) applied to both backends.
- **Live**: the no-key CLI check (`live-nokey.log`) is in m7.md. The Model
  API path was certified against the in-process fake server only; a live
  turn costs the owner's key and waits for their go.

### M8 — Account & usage, polish, packaging

**Status 2026-09-22: complete.** Certification record:
`docs/certification/m8.md`.

- **Scope**: Account & usage dialog (`usage/read` subscription bars or token
  totals), `/usage`, `/cost`; onboarding checklist; voice dictation (Q4);
  screen-reader announcements; `vsce package`, marketplace README, privacy
  policy (`docs/PRIVACY.md`), icon; CHANGELOG 0.1.0.
- **As built**:
  - `AgentHost.readUsage()` / `onUsageChanged()` on both hosts: the MSP host
    calls `usage/read` (`{ usage? }`, absent until the CLI has observed a
    frame) and folds `usage/changed` (host-level, like the list stream);
    the key backend answers "none". The controller answers `readUsage` with
    a `usageReport` (backend + window) and re-posts on every change, one
    subscription per host (`HostWatch`, shared with the list stream).
  - `src/shared/usage.ts`: the SDK's `SubscriptionUsage` shape as a zod
    schema, bar clamping (over-quota keeps the real percent in the label),
    reset countdowns, window length, and the plan label (Meta's tier field
    is an opaque numeric id live, so the dialog says "Muse Code
    subscription" unless the tier reads as a name).
  - `UsageDialog` hangs from the header like History (Esc / close button):
    Backend row, Plan, current block and weekly bars (`<progress>`, since the
    CSP forbids inline styles), "as of", this conversation's tokens and
    context, "Open dev.meta.ai". Opened from the Account & usage row,
    `/usage` and `/cost`. A Model API window explains pay-as-you-go billing
    instead of bars.
  - Onboarding: `ONBOARDING_TIPS` under the empty-state hint until
    `museSpark.hideOnboarding`; "Hide these tips" is a host action that
    writes the global setting, and the settings broadcast hides them live.
  - Screen readers: a visually hidden polite, atomic live region in `App`
    fed by `UiState.announcement` (text + sequence so repeats are read):
    finished / failed / stopped turns, approval requests with the tool
    label, questions, `sendFailed`, resumes, warning and error notices.
  - Packaging: `icon` (128×128 PNG rendered by `scripts/render-icon.mjs`, since 0.1.1 `scripts/render-images.mjs` (`npm run images`, which also renders the README banner and the social preview)
    from `media/marketplace-icon.svg`, in 0.1.0 a spark on a dark tile (dropped in 0.1.1, the sparkle being Google's mark: the icon is now a plain "M" on the tile and the banner and social image carry no logo) rather than
    Meta's mark), `homepage`, `bugs`, `vscode:prepublish` (production
    build), `.vscodeignore` reduced to the two bundles, the stylesheet, the
    icons, `package.json`, README, CHANGELOG, LICENSE and PRIVACY.
  - Voice dictation (Q4): **not shipped in M8** (superseded by M9 the same
    day). VS Code webviews run in Electron, where the Web Speech API's
    `SpeechRecognition` fails with a `network` error because Chromium's
    cloud recognizer is not wired up (electron/electron#46143,
    WebAudio/web-speech-api#80), and there is no extension API for
    dictation into a webview. M9 moves recognition out of the webview into
    a helper process on the OS recogniser.
  - Model API sessions lived for the window only at 0.1.0; the JSON session
    store came in 0.2.0 (M10, `src/host/backend/fileSessionStore.ts`).
- **Live** (`scratchpad/live-m8.log`, `docs/certification/m8.md`): with the
  CLI on the owner's subscription, `usage/read` returned nothing before the
  first turn, one "pong" turn (4 model attempts in the CLI's trace, login
  credential) was followed by `usage/changed` carrying `tier`, a 300-minute
  window and the weekly block, and `usage/read` then returned the same.

### M9 — Voice dictation on the operating system's recogniser

**Status 2026-09-22: built; certified on Windows through the real
recogniser twice (a synthesised recording, then a real webcam microphone
hearing text-to-speech across the room, with text back), and on the
owner's Mac mini for the helper's permissions, engine, capture (levels
metered) and recognition lifecycle (three defects found and fixed there).
macOS recognised text arrived once the recognition mode was left to Apple
(forced on-device gives empty results on an Intel Mac without the model)
and the mini's speech daemons were restarted after Dictation was enabled.
Pending: a person speaking for the accuracy check on each platform.**
Certification record: `docs/certification/m9.md`.

- **Goal**: Claude Code's microphone ("Tap or hold to record Ctrl+D")
  under the owner's constraints of 2026-09-22: no API cost (Meta's Voice
  Transcribe at $0.18/hour was rejected), no third-party packages or
  engines (sherpa-onnx and friends rejected), no "random system shortcuts"
  (driving Win+H / Apple Dictation from the button was rejected): the
  button itself must produce text.
- **Scope**: composer microphone with tap-to-toggle and hold-to-talk, Ctrl+D
  (Cmd+D) in the composer, Space/Enter on the focused button; recognised
  phrases inserted at the caret; "Listening…" / "Starting the microphone…"
  placeholders, a pulsing red mic, live-region announcements; the button
  dimmed with a reason where no recogniser exists; the PSScriptAnalyzer
  gate; the macOS helper build and the CI package job.
- **Design** (decided with the owner: Windows API, macOS Apple Speech
  helper, Linux disabled for now):
  - A resident helper process per conversation speaks one line protocol:
    `start` / `stop` / `quit` in on stdin; `ready` (language, recogniser),
    `listening`, `text`, `stopped`, `error` out as JSON lines. It stays
    warm for `DICTATION_IDLE_EXIT_MS` (5 min) after a recording so the
    next press listens in milliseconds (the engine takes about a second to
    load), then quits; `dispose` kills it.
  - **Windows**: `native/windows/dictate.ps1` under Windows PowerShell 5.1
    (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`,
    `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File`), on the
    .NET Framework's `System.Speech` (`SpeechRecognitionEngine` +
    `DictationGrammar`, `SetInputToDefaultAudioDevice`,
    `RecognizeAsync(Multiple)`; `RecognizeAsyncStop` on "stop" keeps the
    phrase in flight). The recogniser is picked for the display language,
    then the locale, then the first installed. Events are polled from the
    PowerShell event queue (no `-Action` blocks: those cannot run while the
    pipeline is blocked in a .NET read), and stdin is read through
    `Stream.ReadAsync` so the loop never blocks. `-InputWav <file>` replays
    a recording instead of the microphone, for the certification run and
    for the user's own diagnosis.
  - **macOS**: `native/darwin/Dictation.swift` on `SFSpeechRecognizer` +
    `AVAudioEngine`; Apple chooses on-device recognition where its model is
    installed and its servers otherwise (no charge). Not forced on-device:
    on the owner's Intel Mac mini `supportsOnDeviceRecognition` is true
    while the on-device model is absent (asset purged), and a forced
    on-device request ends in an empty final result with no error;
    `--on-device` exists for whoever wants the refusal instead.
    Built by `native/darwin/build.sh` (universal binary, `Info.plist` with
    the two usage descriptions embedded in `__info_plist`, ad-hoc signed)
    in CI's `native-darwin` job; the `package` job ships it in the
    `.vsix`. A package built elsewhere lacks the binary and the panel says
    so. The binary is git-ignored. Found on the owner's Mac mini
    (2026-09-22, macOS 15.7.4, no microphone attached): AVFAudio reports
    some failures as Objective-C exceptions that Swift cannot catch, so the
    helper checks CoreAudio's default input device and the hardware input
    format before touching the engine (a Mac with no input device gets an
    error line, not a crash); the tap uses the hardware input format,
    since the input node's cached output format (44.1 kHz) no longer
    matches the device after a device change (48 kHz) and the mismatch is
    a fatal assertion; each start step writes a marker to stderr so an
    unexpected exit names the step; `--input-device <UID>` pins the capture
    device (the rig's Teams loopback driver cannot be a default input:
    `kAudioDevicePropertyDeviceCanBeDefaultDevice` is 0, and an aggregate
    over it inherits that); and Apple refuses recognition with "Siri and
    Dictation are disabled" until Dictation or Siri is on in System
    Settings, which the helper passes through verbatim.
  - **Linux**: `locateDictationHelper` answers "unavailable" with the
    reason; the button is dimmed with that as its title (not `disabled`,
    so the tooltip still shows).
  - **Host**: `Dictation` (`src/core/voice/dictation.ts`) is the pure
    driver over an injected spawn (`HelperChild`), with the stop grace
    (`DICTATION_STOP_GRACE_MS`, the helper is restarted if "stopped" never
    comes), the idle exit and the unexpected-exit report (last stderr
    line). `dictationHost.ts` adapts `child_process.spawn` (§8 row). The
    controller creates one driver on the first press, posts
    `dictationState` on `surfaceReady` and on every status change, inserts
    each phrase as `insertText` with a trailing space, and reports helper
    errors as a notice. The words never reach the log (character count
    only).
  - **Webview**: `dictationGesture.ts` holds the press/release maths
    (`DICTATION_HOLD_MS` = 300: shorter is a tap that toggles, longer is
    push-to-talk that stops on release); the composer applies it to
    pointer, Ctrl+D (with key repeat ignored and the modifier's release
    counting) and Space/Enter, listening for `pointerup` on the window so
    a hold released off the button still stops. The press is
    default-prevented so the caret stays in the textarea.
- **Acceptance**: the sandbox replay of a synthesised WAV through the real
  Windows recogniser yields `ready` in under a second, `listening`, a
  `text` line and `stopped`, exit 0 (done: 827 ms, "Although settings file
  in fix the bug" for "open the settings file and fix the bug", confidence
  0.46, the classic engine's accuracy as warned to the owner); the owner
  speaks into the dev host and the words land in the composer (done the same
  evening with a real microphone, §10); the macOS helper compiles in CI
  and, on a Mac, prompts for the microphone and speech recognition once
  and then transcribes (done on the Mac mini that evening with a real
  microphone, text back; m9.md).
- **Gates added**: `lint:ps` (PSScriptAnalyzer, `PSGallery` settings,
  exit = finding count; real on Windows, a reported skip elsewhere;
  installed on the CI Windows runner in a step).
- **Security**: the helper command line is fixed (§8 row); the script runs
  with `-ExecutionPolicy Bypass` scoped to its own process, as the VS Code
  PowerShell extension does; nothing about the audio or the text leaves
  the machine on Windows; on macOS Apple may process audio on its servers
  when on-device recognition is unavailable (`docs/PRIVACY.md`); the
  helper never sees the workspace, a credential or the model.

### M10 — Workspace context: rules, skills and memory on both backends

**Status 2026-09-22: built and certified** (`docs/certification/m10.md`):
the CLI path proved live before and after the trust flag (rule ignored,
skill `skillNotFound` → rule followed, skill ran), the Model API path
against the fake server, seven checks fired on purpose.

- **Goal**: what D13 decided. On the CLI backend, the workspace's rules and
  project skills are loaded whenever VS Code trusts the workspace (they
  never were). On the Model API backend, the model sees the same rules
  files, skills and project memory index that Muse Code would give it, by
  the same file conventions, and nothing else.
- **Scope**:
  - `serveArguments(posture, trust)`: `--trust-workspace` when trusted,
    `--disable-shell` when not; the host is restarted when trust is
    granted (`onDidGrantWorkspaceTrust`), with a notice.
  - `src/core/context/` (pure, no `vscode`, no `fs`; everything through
    `ToolIo`, which gains `listDirectory(absolutePath)` for the skill
    roots): `rules.ts` (root file, `CLAUDE.md` fallback per directory,
    nested files by first touch, `RULES_FILE_MAX_BYTES` per file and
    `RULES_CONTEXT_MAX_BYTES` overall with the two warnings Muse prints),
    `skills.ts` (front matter parse and validation, project root then the
    personal Muse root, project shadows personal on a duplicate id,
    `user-invocable: false` hides a skill from the palette but not from
    `read_skill`, `SKILL_FILE_MAX_BYTES`), `memory.ts` (the index with
    `MEMORY_INDEX_MAX_LINES` / `MEMORY_INDEX_MAX_BYTES`), and
    `instructions.ts` composing the system instructions: base text, the
    rules preamble (Muse's sentence) and files, the skills catalogue with
    the `read_skill` instruction, the memory index and the convention for
    writing notes with the file tools.
  - `ModelApiHost`: a `WorkspaceContext` per session, refreshed before each
    model call for newly touched directories; `read_skill` (class `read`,
    never prompts); a `skill` part expanded to the skill body plus the
    arguments (the transcript shows the typed `/name arguments`);
    `listSkills` from the catalogue; `refreshSkills()` on the host emits
    `skillsChanged` (the extension watches `.agents/skills/**` and the
    personal root); in Restricted Mode the tool definitions omit the shell
    and `executeTool` refuses it.
  - Manifest `capabilities` (D13) and the `extensionKind` of D14 (they are
    one edit).
  - README backend table and a "Rules, skills and memory" section;
    `docs/PRIVACY.md` (on the Model API path the rules, the skill bodies
    the model loads and the memory index travel to Meta with the prompt);
    CHANGELOG.
- **Acceptance**:
  - Live, CLI backend, workspace `C:\muse-live-ws` with an `AGENTS.md`
    rule ("end every reply with PINEAPPLE") and `.agents/skills/shout`:
    before the change the extension's own backend code lists no `shout`
    skill and the reply ignores the rule; after it, `skill/list` carries
    `shout` (source `project`), the reply ends with PINEAPPLE and a
    `skill` part `shout good morning` returns `GOOD MORNING!!!`. Two short
    turns each run, attempts counted from the CLI trace logs.
  - Model API backend against the fake server: the request body's
    `instructions` carries the root rules file, the catalogue and the
    memory index; a `read_file` of `src/a.ts` makes the next request carry
    `src/AGENTS.md` after the root one; a `read_skill` call returns the
    body without an approval card; a `skill` part sends the expanded text;
    an oversize rules file is skipped with the warning in the log; in Restricted Mode no rules, no skills, no memory
    and no shell tool are sent.
- **Tests**: `rules.test.ts`, `skills.test.ts`, `memory.test.ts`,
  `instructions.test.ts` (new), `sandbox.test.ts` (trust arguments),
  `modelApiHost.test.ts` (the acceptance list above), `fakeToolIo`
  (`listDirectory`), `modelApiTools.test.ts` (`read_skill` argument
  validation and the shell refusal).
- **Gates**: the existing set; `npm run quality` green; every new test
  broken once on purpose (certification record).
- **Security**: rules and skill files are workspace content and may carry
  prompt injection; they already reach the model on the CLI backend by
  Muse Code's design, and on the Model API backend only in a trusted
  workspace, under the same permission modes as before. Files are read
  with the size caps and never executed. `read_skill` resolves only ids
  from the catalogue (no paths from the model). The personal root is read,
  never written.

### M11 — Production hardening (D14)

**Status 2026-09-22: built and certified** (`docs/certification/m11.md`);
the release workflow is proved by the 0.2.0 tag itself (§10).

- **Goal**: the D14 table, every row either done or deferred with a reason.
- **Scope**: the webview error boundary and `hostAction: reload`; the Model
  API JSON session store (`src/host/backend/sessionStore.ts` behind a
  `SessionStore` interface in `ModelApiHostDeps`; one file per session
  under `context.storageUri`, written after each turn and on rename or
  archive, read at host start; a corrupt file is skipped with a log line,
  never fatal); `Muse Spark: Show Logs` and `Muse Spark: Diagnostics`;
  `.github/workflows/build.yml` (`workflow_call`: quality matrix, macOS
  helper, package) used by `ci.yml` and the new `release.yml` (tag `v*`:
  build, GitHub Release with the `.vsix` and the CHANGELOG section,
  Marketplace publish when `VSCE_PAT` is set); `SECURITY.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/`,
  `PULL_REQUEST_TEMPLATE.md`, `dependabot.yml`, `CODEOWNERS`; README and
  CHANGELOG; version 0.2.0.
- **Acceptance**: a thrown render error in the harness shows the boundary
  with the message and Reload restores the panel; a Model API conversation
  survives `Developer: Reload Window` with its transcript, patches and
  name, and appears in history; the Diagnostics output contains no secret
  (the logger's redaction test covers the key shape, and the command writes
  booleans for credentials); `release.yml` runs green on the `v0.2.0` tag
  and the GitHub Release carries the `.vsix`.
- **Tests**: `ErrorBoundary.test.tsx`, `sessionStore.test.ts` (round trip,
  corrupt file, missing directory), `modelApiHost.test.ts` (store calls),
  `diagnostics.test.ts` (the report's shape and redaction).
- **Gates**: unchanged; the workflows are validated by running them.
- **Security**: the session store holds conversation text and patches in
  the workspace storage directory VS Code already uses for extension state
  (per user, per workspace, outside the repository); the API key is never
  in it. `SECURITY.md` names the reporting path.

### M12 — Harness parity (D15)

**Status 2026-09-22: built and certified** (`docs/certification/m12.md`);
version 0.3.0.

- **Goal**: the D15 table, every "M12" row built and certified; version
  0.3.0.
- **Scope**: `package.json` (setting scopes, `activationEvents`, the
  walkthrough, five commands, the keybinding `when` clauses, the
  `enableNewConversationShortcut` setting); `resources/walkthrough/`
  (four Markdown steps and their images, packaged); the panel serializer
  (`chatPanel.ts` `restoreChatPanel`, the webview's `setState` with the
  session id, `ConversationController.restoreSession`); the commands in
  `src/host/commands/` (`createRulesFile.ts`, `openInTerminal.ts`) with
  the template in `src/core/context/rulesTemplate.ts`; the Model API
  prompt's environment and working-rules sections (`instructions.ts`, the
  host's `describeEnvironment` dependency); the `museSpark.signedIn`
  context key; README, CHANGELOG, this file.
- **Acceptance**: a repository's `.vscode/settings.json` cannot set the six
  machine-scoped settings (VS Code ignores them and says so in the Settings
  editor); an editor-tab conversation comes back on its session after
  Developer: Reload Window; the walkthrough opens from the command and
  from the Welcome page and its images render; New Conversation clears the
  active surface (or opens one), Sign Out signs out, Open in Terminal starts
  the `muse` TUI in the workspace root (or explains the missing CLI),
  Create AGENTS.md produces the `muse init` file and opens it; the Model
  API request carries the date, the git facts and the working rules.
- **Tests**: `manifest.test.ts` (scopes, activation, walkthrough files,
  keybinding clauses), `walkthrough.test.ts` (every image a step
  references exists and is packaged), `chatPanel.test.ts` (restore with a
  stored session id, with none, with garbage state),
  `conversationController.test.ts` (`restoreSession`: resumes, ignores
  when a session is live or signed out), `App.test.tsx` (the state the
  webview stores follows the session id), `createRulesFile.test.ts`,
  `openInTerminal.test.ts`, `rulesTemplate.test.ts`, `instructions.test.ts`
  and `modelApiHost.test.ts` (environment section, once per session, a
  failing describer), `settings.test.ts`.
- **Gates**: unchanged.
- **Security**: the six machine-scoped settings are the ones that choose
  what executes, what is billed and how much is approved; the walkthrough
  and the template contain no user data; `muse init` runs only in a
  trusted workspace and never with the pasted key; the environment section
  carries git metadata only (branch, counts, subjects), never file
  contents.

### M13 — Verification fixes, process-level e2e, the rewind menu (D16)

**Status 2026-09-22: built and certified** (`docs/certification/m13.md`);
version 0.3.1.

- **Goal**: every D16 row marked "M13".
- **Scope**: `test/e2e/` (the fake CLI `fake-muse/serve.mjs` and its
  Windows stub `fake-muse/stub.cs`, the installer `fakeMuse.ts`, the
  process-level suite `museCode.e2e.test.ts`, the opt-in live drill
  `live.e2e.test.ts`, its own `tsconfig.json`); vitest and knip
  configuration; the coverage tests (`toolIo`, `MentionMenu`,
  `StatusLine`, `EffortSlider`); `permissionModes.ts`; `AuthPort` and
  `DictationHandle`; the deletion of `scripts/measure-markdown.mjs`; the
  user card's fork/rewind menu (`Transcript.tsx`, `editsAfter` in
  `uiState.ts`, the `rewindCode` message and the controller's handler);
  README, CHANGELOG, this file.
- **Acceptance**: the e2e suite passes on Windows (compiled stub), macOS and
  Linux (shebang script) in CI without a Muse account; the live drill
  passes on the owner's machine within the attempt budget and the number
  is recorded; the menu forks, rewinds and does both; the lint, coverage
  and dead-code gates stay green with the manager no longer excluded from
  coverage.
- **Security**: the fake CLI runs only under the test runner's own Node,
  from a temporary directory, with the environment the test passes; the
  live drill uses the owner's CLI sign-in exactly as the panel does and
  never the pasted key; a rewind goes through the same review path as a
  single revert (a file changed since is reported, never overwritten).

### M14 — Subagents, the Agent map, the Account & Usage modal, choices as pickers, the banner, the compact button (D17)

**Status 2026-09-22: built and certified** (`docs/certification/m14.md`);
version 0.4.0.

- **Goal**: every D17 row.
- **Scope**: the wire schema (`subagent` fields, background flags), the
  `childTranscript` and `readChildSession` messages, `AgentHost.readSession`,
  `AccountFacts` and `UsageInsights` on `usageReport`, the
  `openMuseSettings` host action; `src/core/usage/insights.ts` (trace-log
  parsing, attribution, the cost estimate), `src/host/usage/traceLogs.ts`
  (reader with a TTL), `src/host/backend/museSettings.ts` (delegation
  mode, read only); the webview: `Modal`, `AgentMap`, the rebuilt
  `UsageDialog`, the agents pill in the header, subagent rows and the
  background badge, the composer banner and the compact button, `/agents`;
  the controller (the choice-steering note, the account facts and insights
  on the usage report, the child-session read); the fake CLI's `subagents`
  and `background:` scenarios; README, CHANGELOG, this file.
- **Acceptance**: the fake-CLI e2e drives two subagents to completion
  with readable child sessions and a backgrounded call; the unit gate
  covers the parser against the line shapes of the 2026-09-22 drill log;
  the modal and the map are Testing-Library-tested; the live subagent run
  came in D21/M18 (delegation switched on through a temporary config, the
  spawns allowed, two children reporting).
- **Security**: the settings file and the trace logs are read, never
  written; the insights carry counts and timestamps only; the steering
  note is fixed text; a child transcript is read through the same host
  command as History.

### M15 — The first F5 round: model warm-up, transcript scrolling, chevrons, response copy, outputs in the editor (D18)

**Status 2026-09-22: built and certified** (`docs/certification/m15.md`);
version 0.4.1.

- **Goal**: every D18 row that changed code.
- **Scope**: the controller (`warmModels`, the single in-flight model
  listing, `openOutput` over the paged store, the decision warning), the
  `openOutput` message and the `openDocument` dependency, the extension's
  `muse-output` content provider; the webview: the transcript scroll
  state and the jump button in `App`, `ExpandChevron` on tool and
  reasoning rows, the response Copy with the shared `useCopiedFlag`, the
  clickable output blocks and the clipped diff with "Click to expand" in
  `ToolRow`; styles; README, CHANGELOG, this file.
- **Acceptance**: the unit gate covers each row (proofs A–H in the
  record); the owner's F5 re-check of each report.
- **Security**: output documents are read-only virtual documents holding
  text the transcript already showed or the CLI's stored output; the
  provider keeps the last twenty; nothing is written to disk.

### M16 — The second F5 round: the pill's model, thinking rows, file links, Click to expand everywhere, the last usage window (D19)

**Status 2026-09-22: built and certified** (`docs/certification/m16.md`);
version 0.4.2.

- **Goal**: every D19 row that changed code.
- **Scope**: the controller (`sessionInfo` from the warm-up, the
  `openFile` message and dependency, the `usageCache` dependency in
  `postUsage`), the `openFile` message and `LineRange` (`revertEdit`
  removed), the extension's `openFile` (select and reveal) and the
  `museSpark.lastUsage` global-state cache; the webview: `ReasoningRow`
  (live summary, plain line after), `ToolRow` (header as toggle + path
  link + chevron, shell and edit rows open from the start, the stored
  patch fetched once, "Click to expand" on every stored-patch diff, no
  review buttons, `changedRange` from the diff rows), `QuestionCard`
  rebuilt (tabs, stacked native inputs, Other, Submit/Cancel) with
  `cancelQuestions` on both hosts and the `cancelQuestion` message, styles;
  README, CHANGELOG, this file.
- **Acceptance**: the unit gate covers each row (proofs in the record);
  the owner's F5 re-check.
- **Security**: `openFile` opens only the path the CLI reported for the
  tool call, resolved against the workspace when relative; the usage
  cache holds percentages and timestamps only.

### M17 — Reply to an output, ask about or comment on highlighted chat text (D20)

**Status 2026-09-22: built and certified** (`docs/certification/m17.md`);
version 0.4.3.

- **Goal**: every D20 row.
- **Scope**: `ChatReference` on `sendMessage` (`protocol.ts`),
  `src/core/chatReference.ts` (the tagged part), the controller's `send`
  (the part before the editor context); the webview: `reference` in the
  state with `referenceSet` / `referenceCleared` and `referenceLabel`,
  the composer chip, the reply actions menu on `AssistantRow`,
  `QuoteMenu` rendered by the row that owns the selection, the
  right-click handler on the transcript, the user card's reference chip,
  `data-entry-id` / `data-role` on rows; styles; README, CHANGELOG, this
  file.
- **Acceptance**: the unit gate covers the part text, the reducer, the
  menus, the right-click flow and the wire (proofs in the record); the
  owner's F5 check.
- **Security**: the payload is text the transcript already shows, clipped;
  nothing outside the conversation is read.

### M18 — The verification round (D21)

**Status 2026-09-23: built and certified** (`docs/certification/m18.md`);
version 0.5.0.

- **Goal**: every D21 row.
- **Scope**: 16 harness scenarios (`test/harness/index.html`,
  `scripts/harness-shots.mjs`), the usage modal's no-logs text, the
  subagent tool labels and the approval card's wording for a tool subject,
  the live drill's budget and comment; the child-item routing in the
  reducer (`childOwnerOf`, `applyChildItem`), `resultText`, the map's
  `controlsFor` and controls, `controlSubagent` / `messageSubagent` on both
  hosts, the two messages, the fake CLI's `subagent/*` handlers, the
  classifier's child marker; README, CHANGELOG, this file.
- **Acceptance**: every scenario rendered and viewed; the live drills'
  facts recorded; the gate green.
- **Security**: the live drills' temporary config copy is deleted on every
  exit path and never echoed; the harness runs against a fake host only.

### M19 — Issue #4: the prompt box auto-grows (D22)

**Status 2026-09-23: built and certified** (`docs/certification/m19.md`);
merged through pull request #5 from `fix/composer-autogrow`, shipped in
0.5.2.

- **Goal**: the D22 rows.
- **Scope**: `rowsFor(draft, metrics)` and `fitRows` with their layout and
  resize effects in `src/webview/components/Composer.tsx` (the `rows`
  attribute is set on the element, not through a prop, so no state changes
  in an effect); two tests in `test/unit/Composer.test.tsx` (the measured
  growth, shrink and cap with stubbed heights; the pure row count); the
  `composer-grow` and `composer-max` harness scenarios; CHANGELOG, this
  file.
- **Acceptance**: the measured test fails when the measurement is ignored
  (the pre-fix behaviour); both scenarios rendered and viewed; the gate
  green; the pull request's CI green before the merge.
- **Security**: none new; the box reads its own metrics only.

### M20 — Rewind across subagents (D23)

**Status 2026-09-23: built and certified** (`docs/certification/m20.md`);
shipped in 0.5.5.

- **Goal**: the D23 rows.
- **Scope**: `sequence` on the state, `seq` on user cards, `completedSeq` on
  tool rows, `stampCompletion`, `replayHistory` returning its counter,
  `editsAfter(state, id)` over the conversation and the child transcripts
  (`src/webview/state/uiState.ts`); the call in `App.tsx`; two reducer
  tests (interleaved parent and child edits unwound by completion, the
  stamp kept across snapshots); README, CHANGELOG, this file.
- **Acceptance**: the interleaving test fails when the child transcripts
  are left out (the pre-fix behaviour) and when the stamp is never applied;
  the gate green.
- **Security**: none new; the host still confines every reverted path to
  the workspace and matches every hunk before touching a file.

### M21 — The audit: security and confinement (D24)

**Status 2026-09-23: built and certified** (`docs/certification/m21.md`);
merged through pull request #6 from `hardening/m21-security`, shipped in
0.6.0.

- **Goal**: every section-A row of the audit (D24) except the release
  workflow's secret scope, which M26 owns.
- **Scope**: `src/core/executables.ts`, `src/host/canonicalPath.ts`,
  `src/host/git.ts` (new); `confineWorkspacePath`, the Windows segment
  checks and `ToolIo.realPath` (`tools.ts`, `toolIo.ts`, `searchWorker.ts`,
  `EditReview`); `compileGlob` (`glob.ts`, rewritten); `isProtectedPath`,
  per-command session rules and `isKnownChoice` (`permissions.ts`,
  `ModelApiHost.ts`); the trust gate on git (`environment.ts`,
  `workspaceFiles.ts`); absolute-path resolution (`launch.ts`,
  `toolIo.ts`); `shellEnvironment` and `setEnvironmentVariable`; the
  controller's Edit-automatically answer, `revokeBypass`, the remote-window
  Bypass confirmation and the contributor check on resume
  (`conversationController.ts`, `extension.ts`); `permissionModeDetail`;
  redaction, the report's `~`, the stderr cap; the manifest's trust text;
  README, SECURITY.md, docs/PRIVACY.md (the environment facts, previously
  undocumented), CHANGELOG, this file.
- **Acceptance**: a test per row, each fired against the unfixed code or a
  deliberate break (`docs/certification/m21.md`); the pathological glob
  under a second; a real junction refused by the search worker and by
  `canonicalPath`; the gate green; the pull request's CI green on all three
  platforms before the merge.
- **Security**: this milestone is the security work; §9 updated.

### M22 — The audit: processes and lifecycle (D25)

**Status 2026-09-23: built and certified** (`docs/certification/m22.md`);
merged through pull request #9 from `hardening/m22-lifecycle`, shipped in
0.6.0.

- **Goal**: the D25 rows.
- **Scope**: `src/host/processTree.ts`, `src/core/timeouts.ts` (new);
  `runCommand` and `BoundedText` (`toolIo.ts`); `HostExit`,
  `SessionNotLoadedError` (`agentBackend.ts`); deadlines, `describeExit`,
  the guarded handler, reference-counted handles (`MuseCodeHost.ts`,
  `ModelApiHost.ts`); the managers' generations, the handshake deadline,
  the launch cache, the proxy, the CLI's environment
  (`museCodeBackendManager.ts`, `modelApiBackendManager.ts`); the
  controller's `backendStopping`, `hostExited`, `resumeAfterRestart`,
  `submitResuming`, shared start and disposal guards; sign-in by
  modification time and one terminal (`browserSignIn.ts`,
  `authService.ts`); `CredentialStore`; the IDE tool server; the client's
  retries; `deactivate`, the login shell, the terminal environment
  (`extension.ts`); the exe scan (`launch.ts`); the fake CLI's `silent`
  mode; README, CHANGELOG, this file.
- **Acceptance**: a test per row, 22 breaks fired
  (`docs/certification/m22.md`), real processes for the tree kill and the
  background child, the handshake deadline against the fake CLI; the gate
  green; the pull request's CI green on all three platforms.
- **Security**: none new; no process is signalled after it has exited.

### M23 — The audit: protocol and backend semantics (D26)

**Status 2026-09-23: built and certified** (`docs/certification/m23.md`);
merged through pull request #10 from `hardening/m23-protocol`, shipped in
0.6.0.

- **Goal**: the D26 rows.
- **Scope**: `promptLedger.ts` (new); the receipts, early events, handshake
  facts, `sendCommand`, size check, `listPending` pull, settled errors and
  base64 pages (`MuseCodeHost.ts`); the new methods and `cumulative` usage
  (`mapNotification.ts`); `activeTurnId` and `pendingRequests`
  (`sessionRecords.ts`); `PromptSettledError`, `canEditSessions`,
  `LoadedSession.activeTurnId` (`agentBackend.ts`); the Model API's tool
  outputs, steering, compaction, character pages, headers and lazy loads
  (`ModelApiHost.ts`, `sessionStore.ts`); retention, leftovers and rename
  retries (`fileSessionStore.ts`, `museSpark.cleanupPeriodDays`); SSE
  (`sse.ts`, `client.ts`); refusals (`schemas.ts`); `write_file` folders
  (`toolIo.ts`); the controller's gap reload, notices, running-turn
  bookkeeping, rename/fork gate and kept images; `AttachmentStore.partsFor`
  / `release`; `approvalReopened`, `promptDropped` and
  `sessionInfo.canEditSessions` (`protocol.ts`, `uiState.ts`), the
  rewind-only menu (`Transcript.tsx`) and the cached rows
  (`UsageDialog.tsx`); the fake CLI's live usage shape; README, CHANGELOG,
  this file.
- **Acceptance**: a test per row, each fired against a deliberate break
  (`docs/certification/m23.md`, 38 breaks); the gate green; the pull
  request's CI green on all three platforms.
- **Security**: a protocol error is logged by kind, never with the frame's
  content; the retention deletes only sessions whose age is known; no new
  dependency.

### M24 — The audit: editing correctness (D27)

**Status 2026-09-23: built and certified** (`docs/certification/m24.md`,
the context rows in `docs/certification/m24-context.md`); merged through
pull request #11 from `hardening/m24-editing`, shipped in 0.6.0.

- **Goal**: the D27 rows.
- **Scope**: the Model API's hunks, text shapes, fingerprints, unsaved-file
  refusals, shell clipping and search limits (`tools.ts`, the prompt line in
  `instructions.ts`); `revertHunks`' created rule (`patchApply.ts`) and the
  `created` flag (`patchDocument.ts`); Edit Review's BOM and folder rules
  (`editReview.ts`, `readTextFile` in `extension.ts`); strict decoding,
  atomic writes, the PowerShell preamble and streamed search hits
  (`toolIo.ts`, `searchWorker.ts`, `fsAtomic.ts`, the session store); the
  controller's unsaved-files notice; `isSamePath`; the context rows:
  `ContextIo` and `decodeContextText` (`contextFiles.ts`, host side
  `contextIo.ts`) under the rules, skills and memory loaders, the
  diagnostics tool, `formatMention` (`src/shared/mentions.ts`) and the
  composer's mention reader, `rootRelativePath` / `resolveAgainstRoot` /
  `hostSideUri` (`workspaceRoot.ts`) and their callers in `extension.ts`
  and the controller; README, CHANGELOG, this file.
- **Acceptance**: a test per row, each fired against a deliberate break
  (`docs/certification/m24.md`); the gate green; the pull request's CI
  green on all three platforms.
- **Security**: no file is rewritten from a lossy decode; no write happens
  under an editor's unsaved changes or over a file the model has not seen;
  no rules, memory or project-skill file reaches the model through a link
  out of the workspace; no new dependency.

### M25 — The audit: webview and UI state (D28)

**Status 2026-09-23: built and certified** (`docs/certification/m25.md`);
merged through pull request #8 from `hardening/m25-webview`, shipped in
0.6.0.

- **Goal**: every section-E row of the audit (D28).
- **Scope**: `src/webview/state/store.ts`, `snapshot.ts`,
  `transcriptEntries.ts`, `src/webview/links.ts`, `src/webview/useDismiss.ts`
  (new); the reducer (`uiState.ts`), `App.tsx`, `main.tsx`; the rows and
  components (Transcript, ToolRow, ReasoningRow, CodeBlock, MarkdownView,
  QuestionCard, ApprovalCard, QuoteMenu, Modal, HistoryDialog, Composer,
  StatusLine, TodoPanel, Header, AgentMap); `streamSplit.ts`, `diff.ts`,
  `styles.css`; `webviewSetup.ts`, `chatPanel.ts`, `ChatViewProvider.ts`;
  `ConversationController.clear()` and `surfaceReady()` only; the
  `surfaceFocused`, `conversationCleared` and `surfaceState` messages and
  `sendFailed.attachmentsKept`; the M25 constants; six harness scenarios;
  README, CHANGELOG, this file.
- **Acceptance**: a test per row, each fired against a deliberate break
  (40 proofs); every harness scenario rendered and the new and changed ones
  viewed; the gate green; the pull request's CI green on all three
  platforms before the merge.
- **Security**: the saved webview state is untrusted input (zod, versioned)
  and restored only when the host confirms its session is live; relative
  links are confined to the workspace in the webview, every other href
  still passes react-markdown's filter and the host's scheme allow-list; no
  new dependency.

### M26 — The audit: packaging, CI, platform and voice (D29)

**Status 2026-09-23: built and certified** (`docs/certification/m26.md`);
merged through pull request #7 from `hardening/m26-platform`, shipped in
0.6.0.

- **Goal**: the D29 rows.
- **Scope**: the workflows, `.vscode-test.mjs`, the new scripts, the
  notices, the macOS helper files, the voice code, the manifest's
  keys/menus/categories, the walkthrough, and their tests.
- **Acceptance**: the gate green; integration tests on both versions; the
  Mac build checks its embedded version; the live Windows dictation check;
  25 test-fire proofs (A–Y); the PR's CI green.
- **Security**: the PAT is confined to one step; tags must be on `main`; no
  tokens persisted; the audit has no silent bypass; no new dependencies; no
  signing credentials created.

### M27 — The tree kill's orphans (D25)

**Status 2026-09-23: built and certified** (`docs/certification/m27.md`);
merged through pull request #12 from `hardening/m27-orphans`, shipped in
0.6.0.

Found at the 0.6.0 release gate: three full runs in a row failed in
`toolIo.test.ts`'s teardown (`EBUSY` on its folder, every test green). A
logged run showed `taskkill /T` killing the shell and its console host
while a ping PowerShell had started during the kill (160 ms before
taskkill returned) lived on in the folder; one orphan of an earlier run was
still there, suspended. The first fix, a sweep for the dead shell's
orphans, left a launcher's child unreachable (its parent gone too), which
the Codex review of PR #12 pointed out; job objects replace it as the
primary path, the sweep staying as the fallback.

- **Goal**: a timed-out or stopped command ends with every process it
  started, on Windows as on POSIX (the D25 row above).
- **Scope**: `shellJob.ts` (the helper's source, its compile, self-test and
  cache, the join statement); `processTree.ts` (the job termination, the
  fallback sweep with its identity check, `killTree` awaited, one
  `PSModulePath`); `runCommand` and `shellArguments` in `toolIo.ts`; the
  wiring in `extension.ts`; the constants; `processTree.test.ts`,
  `shellJob.test.ts`, `toolIo.test.ts`, the test folders' removal helper;
  README, CHANGELOG, this file.
- **Acceptance**: for real on Windows, a launcher's orphaned grandchild
  ended through the job, a background process surviving a normal end, and
  the fallback finding an escaped child; the helper's cache, self-test and
  failures, the job path and the fallback's rounds over scripted helpers;
  the command's result waiting; the test-fire proofs; full gate runs green;
  the PR's CI green.
- **Security**: the helper is compiled on the user's machine from source
  in the extension (no binary shipped), into the extension's own storage,
  named by the source's digest; it calls only `CreateJobObject`,
  `AssignProcessToJobObject`, `OpenJobObject` and `TerminateJobObject`,
  on jobs this extension named. The fallback kills only processes created
  while their parent was the command's, each after a same-run check of its
  creation time. Windows PowerShell by absolute path under `%SystemRoot%`;
  fixed scripts with numeric ids and quoted paths only; no new dependency.

### M28 — macOS dictation asks under its own name (D29)

**Status 2026-09-23: built and certified** (`docs/certification/m28.md`);
pull request #15 from `hardening/m28-release-hygiene`, shipped in 0.7.0.

The owner's go-ahead (2026-09-23) on the route M26 recorded: macOS charges
a helper's privacy requests to the app responsible for it, VS Code for the
panel, and VS Code declares no speech-recognition purpose
(microsoft/vscode#307364), so macOS refused dictation from the panel without
asking.

- **Goal**: macOS asks for the helper's own speech-recognition and
  microphone permissions, under its own name and usage descriptions.
- **Scope**: `native/darwin/Dictation.swift` (the disclaimed re-launch via
  `responsibility_spawnattrs_setdisclaim`, looked up at run time; the
  parent relaying SIGTERM, SIGINT and SIGHUP and the exit status; the
  refusal texts), `native/darwin/check-disclaim.sh` and its step in the
  macOS CI job, the comments on `--app-name`, the early-exit hint; README,
  PRIVACY, CHANGELOG, this file.
- **Acceptance**: on the owner's Mac mini, tccd attributing the request to
  the helper and prompting for it, where the same binary with the disclaim
  skipped is charged to its parent and refused; the check passing there
  and failing with the re-launch or the relay removed; the macOS CI job
  running the check; the gate green.
- **Security**: a private libsystem call, resolved with `dlsym` and
  skipped when absent (the helper then asks as before); no new entitlement,
  no signing change; the grants cover the helper alone, not VS Code or
  anything else it starts. The ad-hoc signature ties a grant to one build,
  so an update that changes the helper asks again.

### M29 — `.muse/` is a protected path (D30)

**Status 2026-09-24: built and certified** (`docs/certification/m29.md`);
pull request #16 from `features/m29-m30-skills-export`, shipped in 0.7.0.

- **Goal**: a write under `.muse/` on the Model API backend asks in every
  mode but Bypass, like the other paths that configure code outside the
  edit.
- **Scope**: `PROTECTED_PATH_SEGMENTS` in `src/shared/constants.ts`; the
  permissions tests; README (the protected list), CHANGELOG, this file.
- **Acceptance**: a write to `.muse/hooks.json` and to `.muse/settings.json`
  asks under Edit automatically and Auto, and a write to `muse/notes.md`
  (no dot) does not; the test fails with the entry removed (proof); the
  gate green. The Muse Code backend is the CLI's own policy: one short live
  turn checks whether it asks before writing `.muse/hooks.json`, and an
  upstream issue follows if it does not.
- **Security**: tightens only.

### M30 — Skills, imports and export (D30)

**Status 2026-09-24: built and certified** (`docs/certification/m30.md`);
pull request #16 from `features/m29-m30-skills-export`, shipped in 0.7.0.

- **Goal**: manage Muse Code's skills and import Claude Code's or Codex's
  from the panel, continue work from either agent, and export a
  conversation.
- **Scope**: a skills manager over `muse skills list|enable|disable --json`
  (QuickPick with checkboxes, per-skill scope); an importer over
  `muse skills import --from claude|codex` (dry run, confirmation with the
  candidates, import, report); palette rows for `resume-claude` and
  `resume-codex` when listed; a Markdown exporter from the session history
  (both backends) and the JSON session log through `muse export`; commands,
  palette rows, the protocol, constants, tests; README, CHANGELOG, this
  file.
- **Acceptance**: the CLI's JSON parsed with zod (an unexpected shape is an
  error the user sees, not an empty list); enable/disable issued only for
  changed rows, with the right scope; the import confirms before writing and
  reports installed, skipped and failed candidates; the exported Markdown
  holds every message, tool call and result in order; the Muse Code rows
  hidden on the Model API backend and when the CLI is missing; unit tests
  over fake CLI output; test-fire proofs; the gate green.
- **Security**: the CLI is run by absolute path with an argument array and
  no shell (D24), with `--workspace` and `--trust-workspace` only when VS
  Code trusts the folder. Imports copy skills into the user's own skills
  folder only after the user confirms the list. The export is written only
  where the user chose in a save dialog.

### M31 — MCP servers and hooks, read-only (D30)

**Status 2026-09-24: built and certified** (`docs/certification/m31.md`);
pull request #17 from `features/m31-m32-mcp-hooks-worktrees`, shipped in
0.7.0. Found on the way
and fixed with it: PowerShell reads the typographic quotes U+2018 to U+201B
as quote characters, which the job helper's quoting (M27) did not escape;
quoting moved to `src/core/shellQuote.ts`, which the terminals the
extension opens now use for the CLI's path and every argument.

- **Goal**: see which MCP servers and hooks Muse Code will load, sign in to
  an OAuth server, and open the files that define them, without the
  extension editing them (D17).
- **Scope**: a tolerant reader for the settings file (`mcpServers` and
  legacy `mcp_servers`, `type` or `transport`, url host or command name,
  `mode`, `enabled`; a note when both keys are present, since Muse then
  loads none); `muse mcp login|logout <name>` in a terminal; hook sources:
  `.muse/hooks.json`, the settings `hooks` block, `managed_hooks_path`;
  palette rows and commands; tests; README, CHANGELOG, this file.
- **Acceptance**: every documented and legacy shape read; unreadable or
  malformed files reported, never shown as "no servers"; the conflict note
  when both keys exist; login and logout run in a terminal with the server
  name quoted; unit tests; test-fire proofs; the gate green.
- **Security**: read-only; secrets in `env` and `headers` are never shown
  (names only), and URLs are reduced to scheme and host.

### M32 — Worktrees (D30)

**Status 2026-09-24: built and certified** (`docs/certification/m32.md`);
pull request #17 from `features/m31-m32-mcp-hooks-worktrees`, shipped in
0.7.0.

- **Goal**: start work on a separate branch without touching the current
  checkout, as the CLI's `--worktree` does.
- **Scope**: "New worktree…" (branch name, base ref, `git worktree add` into
  `<repository>.worktrees/<name>` beside the repository, open in a new
  window) and "Remove worktree…" (`git worktree list --porcelain`, the main
  checkout excluded, `git worktree remove`, `--force` only after a second
  confirmation naming the uncommitted changes); commands, palette rows,
  tests; README, CHANGELOG, this file.
- **Acceptance**: branch names validated with `git check-ref-format`; an
  existing folder refused; git's own error shown when it fails; unit tests
  over the git runner; an integration run against a real temporary
  repository; test-fire proofs; the gate green.
- **Security**: git by absolute path (D24), never in Restricted Mode;
  paths passed as arguments.

### M33 — Web search on the Model API backend (D30)

**Status 2026-09-25: built and certified** (`docs/certification/m33-m35.md`,
D34); merged as PR #27 (`f52312b`, run 36166385587, seven jobs green) with
M34 and M35; ships in 0.9.0.

- **Goal**: let the key backend search the web, as Claude Code's WebSearch
  tool does, at a cost the user has agreed to, loudly (D30's five rules).
- **Scope**:
  - `museSpark.modelApiWebSearch`, off by default, with the price in its
    description.
  - The shared paid-feature machinery M34 and M35 reuse: the confirmation
    when the feature is turned on, the composer's paid badge, the Account &
    usage tally, and a palette toggle.
  - The `web_search` tool in the Responses request, and
    `web_search_call.results` requested so the row can list its sources.
  - `web_search_call` output items as paid tool rows, and `url_citation`
    annotations as the reply's source links. The replayed text stays
    unchanged.
  - Tests; README, CHANGELOG, this file.
- **Acceptance**:
  - Off by default and absent from every request; on, exactly one tool
    entry, and only on the Model API backend.
  - Turning it on without the confirmation leaves it off.
  - The badge and the tally follow the setting and the searches made.
  - Rows and citations rendered from recorded SSE.
  - Unit tests, test-fire proofs, the gate green.
- **Security**: nothing new executes locally; the searches run at Meta.

### M34 — Image generation on the Model API backend (D30)

**Status 2026-09-25: built and certified** (`docs/certification/m33-m35.md`,
D34), merged with M33 in PR #27 (`f52312b`).

- **Goal**: let the key backend create an image file when asked (icons,
  mockups, diagrams), at $0.01 an image.
- **Scope**:
  - `museSpark.modelApiImageGeneration`, off by default, with the price in
    its description, loud through M33's machinery.
  - A `generate_image` tool (prompt, workspace path, size) calling
    `POST /v1/images/generations` with `muse-image-1.0` and
    `output_format: png`.
  - An approval card before each call that names the price, in every mode,
    Bypass included (owner ruling, D30).
  - The image written through the confined write path.
  - Tests; README, CHANGELOG, this file.
- **Acceptance**:
  - Off by default and absent from the tool list.
  - Asked before every image in every mode.
  - The path confined like any write, protected paths included.
  - The response parsed with zod.
  - The tally counts each image.
  - Unit tests over a fake Images API, test-fire proofs, the gate green.
- **Security**: the write goes through the same confinement as
  `write_file`, and the call is billed to the user's key only after an
  approval that names the cost.

### M35 — Muse Voice dictation, paid and opt-in (D30)

**Status 2026-09-25: built and certified** (`docs/certification/m33-m35.md`,
D34), merged with M33 in PR #27 (`f52312b`). As built, the Windows recorder is
compiled when its resident helper starts (no assembly in storage), the
stream is the realtime WebSocket with the key in its first frame, and the
end-to-end check with a real key and a real microphone waits for the owner
(it bills the key: one recording of a few seconds is well under one cent).

- **Goal**: an optional dictation engine with Meta's own recogniser (Muse
  Voice Transcribe, $0.18 per audio hour) on the Model API backend, loudly
  opt-in. The free OS recognisers stay the default everywhere, and are the
  only engine on the Muse Code backend (owner ruling, D30).
- **Scope**:
  - `museSpark.modelApiVoice`, off by default, with the price.
  - Audio capture on the host machine without third-party code:
    - **Windows:** the waveIn API through a compiled-once C# helper, as M27
      compiles its job helper.
    - **macOS:** AVAudioEngine in the existing Swift helper.
    - **Linux:** `arecord` or `parec` when the system has one.
  - Audio streamed to the realtime transcription endpoint with the key.
  - The microphone shows the paid engine (label and tooltip with the
    price), and each recording's length is tallied.
  - Tests; README, PRIVACY, CHANGELOG, this file.
- **Acceptance**:
  - Off by default.
  - Never used on the Muse Code backend.
  - The OS engine is used whenever the paid one is off.
  - Capture stops with the recording and the stream closes.
  - The tally matches the seconds sent.
  - Unit tests over a fake transcription endpoint; one short live check,
    with its cost stated first.
  - Test-fire proofs, the gate green.
- **Security**: audio leaves the machine only while the paid engine records,
  and only to Meta's endpoint with the user's key. PRIVACY.md says so.

### M36 — Rewind finds a hunk that only moved (D31)

**Status 2026-09-24: built and certified** (`docs/certification/m36.md`);
pull request #17 from `features/m31-m32-mcp-hooks-worktrees`, stacked with
M31 and M32 so the gate runs once; shipped in 0.7.0.

- **Goal**: an edit whose lines are intact is undone even when lines were
  added or removed above it; nothing is ever applied that does not match
  exactly and uniquely.
- **Scope**: `src/core/patchApply.ts` (`placeOf`, the carried shift);
  `patchApply.test.ts`, the D27 test in `modelApiTools.test.ts`; README,
  CHANGELOG, this file.
- **Acceptance**:
  - Moved down and moved up are both found.
  - Two hunks with the move carried, and lines added between them kept.
  - A repeated block placed by the carried move.
  - Refused when ambiguous, and refused when the lines themselves changed.
  - The overlap refusal unchanged.
  - Test-fire proofs, the gate green.
- **Security**: the one relaxation of D27 is bounded: a hunk is applied
  only where its whole text matches exactly and only once; a partial or
  repeated match is refused.

### M37 — The accessibility gate (D32)

**Status 2026-09-24: built and certified** (`docs/certification/m37.md`);
pull request #18 from `features/m37-accessibility`, shipped in 0.7.0.

- **Goal**: every screen the harness can show passes WCAG 2.2 AA's
  automated checks in all four default themes, and the gate keeps it so.
- **Scope**: `scripts/a11y.mjs`, `scripts/capture-themes.mjs`,
  `scripts/lib/harnessServer.mjs` (shared with `harness-shots.mjs`),
  `test/harness/index.html` (`?theme=`, `?axe=1`),
  `test/harness/themes/*.json`; `EffortSlider.tsx`, `Palette.tsx`,
  `HistoryDialog.tsx`, `ListBody.tsx`, `styles.css`; the component tests; `package.json`
  (`test:a11y`, in `quality` and `quality:ci`); `build.yml` (its CI
  step, Linux and Windows); README, CHANGELOG, this file.
- **Acceptance**:
  - 208 pages (52 scenarios × 4 themes), 0 violations, the exemptions
    printed.
  - Delete archives and restores from the History search box, only with
    the box empty.
  - Focus in the palette or History list keeps the dialog open; leaving it
    closes it; Escape works from the list.
  - Test-fire proofs for each rule fixed, for a page with no result and
    for a missing bundle; the gate green.
- **Security**: none new. axe-core is a dev dependency and never bundled.

### M38 — "/" in the prompt: the palette, then slash commands

**Status 2026-09-24: built and certified** (`docs/certification/m38.md`);
pull request #19 from `features/m38-slash-autocomplete`, shipped in 0.7.0.

The owner asked for this on 2026-09-24: "when the user types a slash to
begin a slash command it should be adaptive autocomplete, not the slash
opening the command menu". Then, with screenshots of Claude Code: "the
slash should still open the pallet but after you type a character it should
change to the slash commands menu".

- **Goal**: `/` behaves as in Claude Code. The `/` stays in the prompt and
  the palette shows above it. One character more and the palette gives way
  to a flat list of slash commands that narrows as the name is typed.
- **Behaviour**:
  - **The palette** shows while the prompt is exactly `/`, the caret is at
    its end, and the focus is in the composer.
    - It is attached above the box with no filter box of its own. The box
      keeps the focus and hands the palette its keys (Up, Down, Left,
      Right on the effort row, Enter, Escape), and its
      `aria-activedescendant` follows the palette's active row.
    - A row that changes a value in place (effort, thinking, Focus view,
      Ctrl+Enter) keeps the `/` and the palette. Any other row takes the
      `/` with it; a skill row leaves `/selector ` for its arguments.
  - **The list** shows while the prompt is one `/word` (`slashFilterOf`)
    with the caret at its end. A space closes it.
    - The entries are the palette's rows named `/…` (`/agents`,
      `/compact`, `/export`, `/clear`, `/logout`, `/usage`, `/cost`), rows
      given Claude Code's names (`/model`, `/resume`, `/permissions`,
      `/config`, and `/mcp` and `/hooks` on the CLI backend), and the
      session's skills. Each name appears once; a disabled row never.
    - Ranked: names that start with the text, then names with a word that
      does (`engineering:standup` for `st`), then names holding it, then
      descriptions holding it. Alphabetical within each.
    - Up and Down move. Enter runs a command and empties the prompt; on a
      skill it completes `/selector ` for the arguments. Tab completes the
      name. With nothing matching, Enter sends the text as it is.
  - **Both**:
    - Escape closes the menu and keeps the text. The dismissal holds for
      that draft only, so a later `/` opens the menu again.
    - Neither opens while another menu or dialog is open, or with the
      focus outside the composer.
    - Shift+Enter still breaks the line and Shift+Tab still cycles the
      mode.
  - The `/` button still opens the palette with its own filter box.
- **Scope**:
  - New: `src/shared/slashCommands.ts` (the list and its ranking),
    `SlashMenu.tsx`, and `MenuOption.tsx`, the row it shares with the `@`
    list.
  - `PaletteItem.slashName`.
  - `Palette.tsx`: the attached mode, `PaletteKeys` through `keys`, and
    `onActiveRowChange`.
  - `Composer.tsx`, `App.tsx`, `styles.css`.
  - The harness scenarios `slash-palette` and `slash-commands`, which the
    accessibility gate now covers, and `palette` (now the `/` button).
  - Tests, README (and its palette screenshot), CHANGELOG, this file.
- **Acceptance**: both menus in the harness in all four themes with no
  accessibility violation; the component and App tests; test-fire proofs;
  the gate green.

### M39 — Logging and performance you can see

**Status 2026-09-24: built and certified** (`docs/certification/m39.md`);
pull request #20 from `features/m39-logging-performance`, shipped in 0.7.0.
Owner (2026-09-24): "as far as o11y for errors etc we are good? … really i
mean logging and performance everywhere". An audit of the code that day answered: not yet. The CLI
process layer is well logged, and every line is redacted. The conversation
layer reports failures to the panel but not to the log, webview errors
never reach the host, and nothing measures time at runtime.

- **Goal**:
  - Every failure the user sees is also in the log, and no promise rejects
    unseen.
  - A webview error reaches the log.
  - The log tells a session's story, with ids, results and durations, and
    never its content.
  - Two unbounded resources get bounds.
- **Logging**:
  - `ConversationController.handle` catches, logs and shows a notice.
    Today a failed compact, skill list, copy, insert, file pick,
    sign-in, archive or usage post reaches only VS Code's Extension Host
    log (`extension.ts` calls it with `void`).
  - `notice()` at warning and error level writes the same line to the log;
    so do the worktree and skills commands' error popups.
  - A `webviewError` message carries the text and stack (redacted, rate
    limited, no user content) from:
    - the error boundary, which today only writes to the webview console;
    - `window` `error` and `unhandledrejection`;
    - a guarded reducer: a throw in the message listener is outside React's
      boundary and loses the host message silently;
    - a failed image read.
  - Lifecycle lines at info level, each with the session and turn id so
    they match the CLI's trace logs:
    - sign-in method and outcome, and the backend chosen;
    - session start, resume and fork;
    - turn start and end, with the result and duration;
    - approval decisions (the tool and the answer, not its input);
    - a restart and its reason, and a retried MSP command.
  - Less noise:
    - an invalid setting warns once per value, not on every read (about 7
      per send);
    - an ignored stream event type is logged once, not every frame.
  - No content in the log:
    - an unparsed dictation-helper line is logged by length, not verbatim;
    - the skills CLI's stderr is capped;
    - a malformed model frame's preview stays out of the failure reason.
  - Swallows that hide a cause say it: a permission error is not "file
    absent" or "CLI not found", and a git timeout is not "not a
    repository".
  - Trace level: MSP method names and latencies, and Model API request
    timings, at `trace`. Raising the Muse Spark output channel's level then
    shows more; the default stays quiet.
- **Performance**:
  - Measured and logged:
    - activation time;
    - CLI spawn to handshake;
    - time to first token and turn duration, on both backends;
    - the first Model API turn's git calls (up to three sequential 15 s
      calls today), which also run in parallel.
  - Bounds:
    - an idle timeout on the Model API stream, which today waits on Stop
      alone, ending the turn with a retryable error;
    - a size limit on `read_file` and `edit_file`, which today load a whole
      file of any size.
  - Webview:
    - streamed deltas batched per animation frame; today each is one post,
      one dispatch and a pass over every row;
    - the once-a-second snapshot save held while a reply streams.
  - Smaller:
    - the selection read after the debounce, not before;
    - opened output documents bounded in host memory;
    - output previews clipped by characters as well as lines;
    - the IDE tool server started on first use.
- **Built with these numbers**:
  - Webview errors: at most 10 a minute per panel reach the log, their
    text cut to 1,000 characters and their stack to 4,000.
  - Stream idle limit: 5 minutes, for the headers and between frames.
  - File tools: files up to 10 MiB.
  - Output documents: at most 20, and 32 million characters together.
  - Previews: 12 lines and 2,000 characters.
  - Deltas: batched every 16 ms.
  - An invalid setting warns once per value.
  - `Logger` and `CoreLogger` gain `trace`.
- **Tests**: each item has one, and a drill breaks it once (19 drills). The
  batching case lives in the controller's tests, where the posts are made.
- **Privacy**: the log gains ids, counts, results and durations only.
  Never prompt text, file contents, dictated words or model output.

### M40 — The panel in VS Code's display languages (built)

**Status 2026-09-25: built and certified** (`docs/certification/m40.md`):
M40a merged in pull request #23, M40b in its own pull request. Owner (2026-09-24): "yes" to the
languages VS Code itself ships. The design is D33.

**M40a, as built** (three agents on separate file sets, after the lead wrote
the shared table, helpers and checks):

- **The table:** `src/shared/l10n/en.ts`, about 620 keys: strings, `{slot}`
  templates, plural forms and label groups (the permission modes and their
  details, effort levels, tool labels, skill scopes, status verbs,
  onboarding tips, Muse Code's exit meanings). `MODEL_TEXT` in
  constants.ts holds the 25 texts the model reads, in English.
- **The helpers:** `src/shared/l10n/text.ts`: `fill`, `plural`,
  `templateParts` (a slot rendered as markup: the approval card's code, the
  usage insight's percentage, the Modes hint's key cap), and `Intl`
  formatting of numbers, percentages, US dollars, units, relative times and
  dates.
- **The checks:** `src/shared/l10n/check.ts` does both jobs. Run loosely,
  it is the shape check the host and the webview apply to a table they
  load; run strictly, it is the gate. `src/shared/l10n/locales.ts` holds
  the languages with a table (none yet) and maps VS Code's language id to
  one.
- **Host:** `src/host/l10n.ts` loads the table at activation. The webview
  HTML carries it as JSON with `<html lang>`, and
  `src/webview/installTable.ts` installs it before the first render.
- **What else changed:**
  - Sentences that ended in a value also became templates (a path last in
    English comes first in Japanese).
  - The exported Markdown's own words are in the table; the conversation in
    it is copied as it was.
  - Log lines no one sees in the panel stay English.
- **The manifest:** 76 strings in `package.nls.json`.
- **The gate** is `npm run check:l10n`, in `quality:gates`. It checks the
  tables, `l10n/untranslated.json` (the names left in English, one list for
  the table and one for the manifest), the manifest, and that nothing reads
  `UI_TEXT` at module load (a TypeScript scan).
- **The harness:** `--lang=<id>` for `harness:shots` and `test:a11y`, and a
  pseudo-locale (`npm run harness:pseudo`).

**M40b, as built:**

- **The translations:** seven agents translated in parallel, two related
  languages each, one pair of files per language. Each took VS Code's own
  terminology in that language (several read Microsoft's VS Code language
  packs), its form of address, and the key names VS Code shows there (Strg,
  Umschalt, Maj, MAIUSC, Mayús).
- **What they produced:** `TABLE_LOCALES` lists the fourteen languages, and
  the gate checks all 28 files strictly.
- **Words that are the same in a language** ("Backend" in German, "Model" in
  Czech, "Manual" in Spanish) are listed per language in
  `l10n/untranslated.json`. So are six values that are the same everywhere:
  the product name as a heading, and five key names.
- **The gate learned one thing:** a plural entry, or a single form of one,
  may be listed. Czech's and Polish's "1 agent" is the English, while their
  other forms are not; before, the agents had to write around it.
- **Seen:** screenshots in German and Japanese. The accessibility gate ran
  in both, 216 pages each, and found one contrast problem English had not
  reached (the Modes menu's highlighted detail line), now fixed.
- **Disclosed:** the README's Languages section says the translations are
  machine-made and how to correct one.

- **Goal**: the panel, the Command Palette entries and the settings read in
  the user's VS Code display language: Simplified and Traditional Chinese,
  Japanese, Korean, German, French, Spanish, Brazilian Portuguese, Russian,
  Italian, Turkish, Polish, Czech and Hungarian, with English as the base.
- **Approach**:
  - The manifest's strings move to `package.nls.json` and
    `package.nls.<language>.json`.
  - `UI_TEXT` becomes the English table; the host picks the table for
    `vscode.env.language` and hands it to the webview when it starts.
  - Counts use `Intl.PluralRules`, and dates and numbers use `Intl`
    formatting in that language.
- **Gate**: every language has every key; placeholders and Markdown match
  the English; nothing is left untranslated except an allowlist of names
  (Muse, MCP, …).
- **Honesty**: the translations are machine-made. The README says so and
  asks for corrections.
- **Order**: after M38 and M39, so their new text is translated with the
  rest.

### M42 — Replay as Meta validates it (D35)

**Status 2026-09-25: built and certified** (`docs/certification/m42.md`);
merged as PR #28 (`0e09b63`).

- **Goal**: every request the Model API backend sends is a conversation
  Meta accepts, and a stream the server ends early is retried as the docs
  say.
- **Scope**: `phase` on replayed assistant messages, the reasoning summary,
  the reply after a reasoning-only turn, 502 retried, retryable stream
  errors retried whole; the stored-session schema takes `phase`; tests,
  CHANGELOG, this file.
- **Acceptance**: each rule has a test from the documented shape and a red
  drill; the gate green.

### M43–M56 — Parity with everything Muse Code and the Model API offer (D36)

**Status 2026-09-27: M43–M56 merged (M56 as PR #44). All ship in
0.9.0.** The program the owner asked for (2026-09-25): one pull request per
milestone, each with its tests, red drills, documents and fourteen
translations. The order is D36's table:

| Milestone | What reaches the panel                                                                                                                | State                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| M43       | A row for every tool Muse Code runs (memory, goals, schedules, workflows, web, background work, reminders, input), tool-result images | merged, PR #29                                       |
| M44       | Images on the Muse Code backend through the `ide` session server with the key (paid, loud); image edits                               | merged, PR #30 (web fetch moved to M44b)             |
| M45       | Goals: set, see, pause, clear                                                                                                         | merged, PR #31                                       |
| M46       | Background work and stop; the `!` user shell; clarifying questions                                                                    | merged, PR #33                                       |
| M47       | Workflows: captured run and children as read-only cards; owner controls deferred until a live success capture                         | merged, PR #34                                       |
| M48       | Model API subagents with staged paid child admission; Muse Code read/reopen deferred until live success capture and certification     | merged, PR #35                                       |
| M49       | Memory: see and edit; memory tools on the Model API backend                                                                           | merged, PR #36                                       |
| M50       | MCP servers on the Model API backend                                                                                                  | merged, PR #37                                       |
| M51       | Hooks on the Model API backend                                                                                                        | merged, PR #39                                       |
| M52       | Scheduled prompts (`/loop`): list and cancel                                                                                          | merged, PR #40                                       |
| M53       | Rewind a conversation; a side chat                                                                                                    | merged, PR #41 (with the usage follow-up)            |
| M54       | PDFs and other files as input                                                                                                         | merged, PR #42                                       |
| M55       | Sign in and install Muse Code from the panel (M41 folded in)                                                                          | merged, PR #43 (with the sign-in reducer review fix) |
| M56       | Enterprise network: proxy and certificates, the sandbox network switch, no session log, the CLI's config status                       | merged, PR #44                                       |

### M43 — A row for every tool Muse Code runs (D36)

**Status 2026-09-25: built and certified** (`docs/certification/m43.md`);
merged as PR #29 (`03ca4da`).

- **Goal**: every tool Muse Code can run has a named row, and the ones that
  answer in JSON read as what they mean; nothing is dropped that the wire
  may add later.
- **Research first**: a live capture of six turns in an empty folder on the
  contributor model (38 model attempts, counted from the trace log) gave
  the exact arguments and results of the memory, goal, schedule, web search
  and background-work tools, and showed that a backgrounded shell call has
  no `background` flag and that an image read carries no
  `modelVisibleContent` on the live stream.
- **Scope**: labels for the CLI's whole tool list and MCP tools; row bodies
  for memory, goals, scheduled prompts and search results; background runs
  recognised from their result (they no longer read "Interrupted" when the
  turn ends); pictures a tool read or made, loaded by the host from the
  workspace under the D24 link check; the Model API's search rows in Muse
  Code's result shape; generic JSON indented; 52 strings in fourteen
  languages; AGENTS.md rule 13 (wire shapes come from a capture).
- **Acceptance**: tests from the captured shapes, drills T1–T12, harness
  scenarios `muse-tools` and `muse-web` seen and in the accessibility gate,
  the gate green.
- **Left for later milestones**: goal controls and `session/goalChanged`
  (M45); stopping background work from the panel (M46); workflow runs (M47).

### M44 — Images on both backends, and image edits (D37)

**Status 2026-09-25: built and certified** (`docs/certification/m44.md`);
merged as PR #30 (`bdaede4`).

- **Goal**: the owner's "images … on each": the model can make and edit
  images on the Muse Code backend too, billed to the key, opt in and loud.
- **Research**: Meta's `/images/edits` takes a JSON body with the sources
  as data URLs and answers like a generation, at the same price
  (dev.meta.ai/docs/api-reference/images/edit-image, read 2026-09-25).
- **Scope**: `edit_image` on the Model API backend; the shared image
  pipeline (`prepareImageCall` / `runImageCall`, `ToolIo.readBytes`);
  the `ide` server's image tools with the purchase dialog; the tool list
  read per request; key presence in the paid state (`isKeyStored`) for the
  toggles, the badge, Account & usage and Muse Voice on Muse Code; the
  approval card naming an edit's sources; 11 new strings and 4 changed in
  fourteen languages; the M43 gate's e2e timing flake fixed.
- **Acceptance**: tests for every refusal, the purchase, the dialog, the
  list, the marking and the gate; drills; the gate green.
- **Web fetch** (D36's M44 row) moves to its own milestone: it needs a
  network-safety design of its own (M44b, below).

### M44b — Web fetch on the Model API backend (D36)

**Status 2026-09-27: folded into M69 (D49), which also serves it to Muse
Code through the `ide` server; built there on 2026-09-28 with every rule
below (see M69's status).** Muse Code's own
`web_fetch` is gated off in 1.3.0, and the Model API backend has no fetch
tool. The D36 inventory named the network-safety design this needs before
the model may read a page:

- **Destinations:** refuse private, loopback and link-local addresses, and
  pin the DNS answer the check approved, so a second lookup cannot move
  the request inside the network.
- **Redirects:** a small fixed limit, each hop checked like the first.
- **Bounds:** a size cap and a time limit on every fetch.
- **Content:** an allowlist of content types; HTML reduced to text before
  the model sees it.
- **Approvals:** each fetch asks or runs by the permission mode, as a
  network tool.
- **Transport:** through `liveFetch`, so VS Code's proxy and certificate
  settings apply (D43).
- **Acceptance:** tests and red drills for each rule above, a harness
  scenario for its row, the gate green, and a certification record.

### M45 — Goals (D38)

**Status 2026-09-26: built, certified and merged** as PR #31 (`1908673`,
run 36219311056) (`docs/certification/m45.md`).

- **Goal**: a session goal the user can set, see, pause, resume, change
  and clear on both backends, with Muse Code's verbs, and the Model API
  backend as close to Muse Code's goal loop as it can be without spending
  what the user did not ask for.
- **Research first**: msp.d.ts's `goal/*`, `session/goalChanged` and
  `snapshot.goal`; Muse Code's goal-tracking recipe and interactive docs;
  the goal store's statuses, tool descriptions and failure messages in the
  1.3.0 binary; a live capture of the verbs, their refusals, a resumed
  snapshot and a stopped goal turn (three turns, nine model attempts).
- **Scope**: `goalChanged` in the agent events and the history; the
  resume's snapshot preference; `controlGoal` on both sessions with the
  captured refusals; the Model API's four goal tools, the stored goal, the
  pinned section, the step-probe note, the token budget, Stop pausing, the
  wake turn; the goal strip, `/goal …` in the prompt and the palette's
  `/goal`; 32 strings in fourteen languages; harness scenarios `goal` and
  `goal-edit`.
- **Acceptance**: tests from the captured shapes on both backends, the
  reducer, the controller, the strip and the prompt; drills G1–G54; both
  scenarios seen and in the accessibility gate; the gate green.
- **Left**: a fork's goal on Muse Code shows only once Muse Code reports it
  (fork is refused on Windows 1.3.0, so it could not be captured); the
  exported Markdown does not include the goal.

### M46 — Background work and stop; the `!` user shell; clarifying questions (D39)

**Status 2026-09-26: PR #33 merged into main at `e219d04` after local and hosted gates**
(`docs/certification/m46.md`). A full local gate passed on M45 base
`5581fe2` with the Windows accessibility runner capped at two workers;
M46 was then reconciled onto M45 candidates `502684c`, `ec5db58`,
`899b573`, `f5df625`, `4da43ac`, `f3390ec` and `ef84852`. The full local
quality gate passed on `ef84852`. M45 merged into main at `1908673`, whose
source tree is identical to `ef84852`; M46 now branches from that merge.
M46 was committed as `8a85d79` and opened as PR #33. Review found two
session-lifecycle gaps: final-surface disposal must stop CLI background
tasks, and resumed foreground shell history must restore the `Ctrl+B`
context. Both have focused failing-before/passing-after tests. The
corrected tree passed the full local gate. Its fresh review found one
more case: a Model API shell row starts before approval, so the running
shell shortcut stays off while the permission card waits. A real fake-API
and held-shell test failed before the change, passed after, and verifies
the shortcut works once approved. The second correction's local gate
passed. The next review found a running Model API `!` row missing from
another surface's history, and forks missing a background shell's terminal
context when the later note was cut. Both failed in focused tests before
the fixes; recording the running row and tagging terminal replay notes by
task fixed them. A cross-host restore test then caught that the started
`!` row needed a save at start; `touch()` persists it before completion.
The third correction passed the local full gate. The next review found
that a quiet foreground Model API shell was also absent from another
surface's live history. Started tool rows are now recorded once and
replaced by item ID when they move or finish; a focused test failed
before the change and passed after it. An unanswered function call is
deliberately not persisted to disk because its replay would lack an
output, so this guarantee is for surfaces sharing the live session. The
fourth correction passed the local full gate. A read-only review then
found that a second panel did not know about a shell approval already
pending in the shared Model API session, so its restored row could make
`Ctrl+B` intercept VS Code before the shell was runnable. The live
two-panel test failed before the change and passed after pending approval
requests were replayed to new listeners. The fifth correction passed the
local full gate. A second read-only review found that a joining panel in
Edit automatically could then approve a Manual panel's pending file edit.
Both Model API and Muse Code tests failed before the fix; replayed cards
now carry an internal marker that forbids automatic approval, including
Muse Code's `approval/listPending` path. The sixth correction passed the
local full gate. A further read-only review found the inverse live case:
an older Edit automatically surface could approve a new Manual surface's
edit. Both backends reproduced it; the Model API also exposed a pending
resolver registration race, fixed before the authorization drill. The
reverse order (Manual first, Auto joining) and two Auto panels proved a
single last-mode value cannot describe the shared session safely. Auto
approval now runs only while one controller holds it in Edit automatically;
detaching another panel restores it. The internal replay marker is removed
before postMessage. The seventh correction passed the local full gate.
Its review found one export gap: a Muse `userShell` ending by signal had
the signal in its row but not Markdown. The existing localized signal
label now appears in export too, with a failing-before/passing-after test.
The final export correction passed the local and current-head hosted
quality matrix, with no open review threads, before PR #33 merged.

- **Goal**: what Muse Code's TUI does with Ctrl+B, `/stop` and `!`, and its
  "let me explain" answer to a question, from the panel, on both backends.
- **Research first**: two live captures in empty folders on the contributor
  model, the Windows sandbox on (`C:\muse-live-m46`) and off
  (`C:\muse-live-m46b`): 27 model attempts, counted from the trace logs.
  They gave the shapes in D39, and showed that a `!` command cannot be
  stopped on Muse Code.
- **Scope**: `task/background`, `task/stop`, `task/stopAll`,
  `session/userShell` (the `userShell` grant asked for) and
  `userInput/clarify` on Muse Code; the same on the Model API backend
  (moved shell calls, the user's own commands, explanations); Move to
  background and Stop on the rows, Stop and Stop all in the Agent map, the
  header pill counting running background tasks, Ctrl+B and two commands;
  the `!` prompt (the Shell chip, Run command), the **You ran** row, its
  Markdown export; Explain instead on the question card; "Stopped" for a
  stopped row; two onboarding tips; the fake CLI's `long:` script and its
  task and user-shell methods; 34 strings and 2 command titles in fourteen
  languages.
- **Acceptance**: tests from the captured shapes on both backends, the
  controller, the reducer, the rows, the card, the manifest and the fake
  CLI end to end; drills; harness scenarios `muse-shell`, `background-map`
  and `question-explain` seen and in the accessibility gate; the gate
  green.
- **Runner**: Windows headless Chrome runs at most two harness pages at a
  time. Four concurrent `jump` pages timed out after M46's added UI work;
  one page at a time passed, and two workers passed twice with all four
  themes. This changes resource pressure only: every scenario, axe rule,
  exemption and the per-page timeout stay as they were. Other platforms
  retain six workers (`docs/certification/m46.md`).
- **Left out, on purpose**: the Model API backend makes no model call when
  a background command ends (D39: nobody asked for one); a model-side stop
  tool like Muse Code's `work_stop`, and moving tools other than the shell,
  wait until a capture shows Muse Code doing either.

### M47 — Workflows: captured run and agents (D40)

**Status 2026-09-26: captured read-only presentation merged; owner controls
deferred** (`docs/certification/m47.md`). PR #34 merged into main as
`34002ab` after exact-tree local quality, all seven hosted checks and review.
Live capture proved the run card and one child's updates plus rejected
owner commands; accepted control shapes remain uncaptured.

- **Goal**: a workflow Muse Code runs reads as what it is, a run of agents
  going on in the background, with its captured progress and result.
- **Research first**: a live capture of one turn asking for a workflow
  with one agent, in `C:\muse-live-m47` on the contributor model (eight
  model attempts, counted from the trace log, two of them a first run cut
  short by the capture script); free probes of the controls against the
  finished run for the refusals, and of `session/read` and
  `subagent/readResult` with the agent's id.
- **Scope**: the `workflow` item's fields through the MSP mapping; a
  `workflow` transcript row (name, status, agents, tokens, trigger source,
  result or failure) that outlives its turn; agents merged as Muse Code
  drops fields; the Workflow tool's row (captured inline script and
  launch); the agents pill counting workflow agents and the Agent map listing
  runs; `run.workflow_trigger_mode` read, noted in the map and in
  Diagnostics; localized strings in fourteen languages.
- **Narrow layout**: a workflow name that is visually shortened keeps its
  full display name in the title tooltip; a script ID is not a substitute
  for that name.
- **Agent map composition**: a map with a workflow or background task is not
  empty even if it has no subagent row. The empty hint appears only when all
  three are absent.
- **Sparse history replay**: a same-session history reload preserves a
  workflow child's earlier label and usage from the panel's validated live
  or saved webview snapshot when the final Muse Code item omits those fields.
  A different session never inherits them. With no prior snapshot, absent
  values remain unknown; the final wire item cannot reconstruct them.
- **Model API**: no parity is expected or built; workflows are Muse Code's
  own engine (D40).
- **Acceptance**: tests from the captured presentation frames,
  the applicable rendering drills (the old control drills remain historical
  in the certification record), harness
  scenarios `muse-workflow` and `muse-workflow-map` in the accessibility
  gate. The final candidate passed `npm run quality` on tree
  `7390e3b2fc080aef5fcaa1ad4226f688e0f5ed75`, all seven hosted
  checks and review; PR #34 merged. Claude's M47 source worktree
  passed `quality:gates` but its accessibility run had four Chrome pages
  without a result and exited 1; secrets and SAST did not run.
- **Left out, by Muse Code or evidence**: pausing and resuming a run (no MSP
  verb); a workflow agent's transcript (no session to read); listing or
  recovering saved workflows (`muse workflows list|recover` are CLI commands
  outside MSP); and a resumed workflow's source file in the tool row until
  its actual input arguments are captured. Cancel, Skip and Retry wait for
  a live accepted-command and outcome capture; the captured refusal probes
  alone do not certify usable controls. A child `phase` and saved workflow
  display name also wait for live evidence.

### M48 — Model API subagents and captured Muse Code controls (D45)

**Status 2026-09-26: merged as PR #35** (`docs/certification/m48.md`).
Child requests use a default-off paid gate, one-use task consent and a final
HTTP admission check with a four-attempt limit. The two P1 review threads (a
child's `turnStarted` stealing the parent's steering; the persist guard
missing nested child replays) were fixed with failing-before/passing-after
tests; local quality and all seven hosted checks passed on the final commit.
No real paid request or subscription turn was made. Native read/reopen have
no callable panel path until a bounded live success capture is available.

- **Goal**: the Model API backend can delegate bounded independent work to
  child sessions, with the Agent map and parent context showing the result.
  Muse Code's remaining `reopen` and `readResult` owner commands wait for
  a live success capture.
- **Research**: Muse Code's MSP `SubagentTargetParams` and the method schema
  say `readResult` consumes an already visible result and `reopen` starts a
  later attempt. The 2026-09-23 captured `subagent_spawn` and
  `subagent_wait` calls give their names and core arguments. A live capture
  of the two MSP owner commands is still required under rule 13; SDK types
  alone do not justify a callable panel control.
- **Scope**: six Model API subagent tools; child sessions with their own
  replay and transcript, capacity and idempotent spawn; owner controls;
  child results queued into the parent's next model request; persistence,
  usage and approval routing; Agent map controls and all translations;
  `agents-result` and `agents-closed` harness scenarios.
- **Cancellation boundary**: stopping a queued child discards messages it
  never saw. A later reopen starts the retained objective without replaying
  that cancelled queue; persisted child state carries no cancelled note.
- **Cross-surface and goal boundary**: a child approval pending when another
  panel attaches is replayed with the no-auto-decision marker, and the
  parent routes its decision back to that child. Child usage contributes to
  the parent total once and charges only the goal active at the child turn's
  start, never a later replacement goal.
- **Paid child acceptance**: default-off machine gate and price
  confirmation, one-use child-task cards in every mode, four-attempt
  admission budget checked at the final HTTP boundary on all child paths,
  paid row/badge/tally without double-counting conversation token cost,
  fake-key red drills and localization. No live billed request was needed
  for this acceptance; the Muse Code owner-command capture remains separate.
- **Acceptance for the delivered subset**: unit and protocol tests, each
  new check seen failing in a red drill, local quality gate green, hosted
  checks green, and the certification record under `docs/certification/m48.md`.
  Muse Code `readResult` and `reopen` remain removed and require a later
  bounded live success capture before they can be offered.

### M49 — Memory: see and edit; memory tools on the Model API backend (D36, D41)

**Status 2026-09-26: merged as PR #36 at `4694803`; native writer-lock
parity unproved** (`docs/certification/m49.md`). The isolated M49 worktree was based on M47's
main merge `34002ab` (pre-move index tree preserved at
`refs/codex-backups/m49-pre-m47-20260926`), then merged with M48 (`a9dec5a`).
The first full local quality gate
passed on staged M46-base tree `7c39e088` (1,736 unit tests, 272 browser
pages, zero security findings). The M47-base focused set passed 450 tests;
the later ordered-tree gate and review preceded its merge.
New-note atomic publication passed 69 focused memory tests and a two-process
local collision drill; the earlier quality receipt predates that change.
Muse Code's native `.muse-memory.lock` writer protocol remains unproven, so cross-process writes
to an existing note can lose an update (D41, §9). Claude's original M49
worktree had no commit or green `npm run quality` run; its three recorded
attempts stopped in unit tests.

- **Goal**: the notes Muse Code keeps are visible and editable from the
  panel on both backends, and the Model API backend saves and reads them
  with Muse Code's own tools, so both backends share one memory.
- **Research first**: the personal-project note the M43 capture wrote was
  found on disk (names only); a two-turn live capture (`C:\muse-live-m49`,
  contributor model, 25 model attempts, the data home redirected so the
  owner's personal memory was untouched) gave the personal scope's folder,
  the folder-name rule, the front matter, the append separator, the read
  window, the refusals and Muse Code's approvals; the binary's strings gave
  the tool schemas and messages. No MSP method or CLI command exists (D41).
- **Scope**: `src/core/memory/` (locations, index, store);
  `read_memory`/`add_memory`/`edit_memory` on the Model API backend with
  Muse Code's shapes, approvals as edits, the session-start snapshot in the
  instructions, not offered in Restricted Mode; the Memory view
  (`museSpark.memory`, palette "Memory…", `/memory`) with open, new and
  delete, keeping `MEMORY.md` true; 26 strings and one command title in
  fourteen languages; README, PRIVACY, CHANGELOG, this file.
- **Acceptance**: tests from the captured shapes and both captured folder
  names; the store on the real file system with a junction; drills M1–M21;
  the gate green.
- **New-note race**: `add_memory` and the Memory view must create a missing
  note exclusively. If another writer takes its path after the first read,
  report the collision and keep that writer's bytes; never replace them.
- **Index links**: a note with spaces, parentheses, brackets or percent signs
  must get a valid Markdown link in `MEMORY.md`; finding and removing that
  line must recover the note's actual path, without creating duplicates.
- **Left**: the snapshot is read once per session, as Muse Code's is; a
  note is not re-read into the instructions when it changes mid-session.
  The memory rows do not yet open their note (the view does).

### M50 — MCP servers on the Model API backend (D36, D42)

**Status 2026-09-26: merged as PR #37 at `fa370ee`; local and all seven
hosted checks passed**
(`docs/certification/m50.md`). The
isolated M50 branch passed `npm run quality` on exact M47-base staged tree
`9a2399aa4b15f401c5e0c73d5f21846af3fff06c`: 1,820 unit tests passed
(3 skipped), 280 accessibility pages had no violated or undecided rules,
and secret/SAST scans found zero findings. An independent Windows audit
found no leftover fixture processes. That receipt predates the merged M48
and M49 tree (`4694803`). The combined staged tree
`28eea6f74ef17c7a9c72bf00325ce3a6d5737f96` passed `npm run quality`:
1,967 unit tests passed (3 skipped), 304 accessibility pages had zero
violations/undecided rules, the production bundles met budgets, audit found
zero advisories, and secret/SAST scans found zero findings. At that
checkpoint, hosted review remained. Corrected staged tree
`8ce10a01a2aeb5f01d9bf33108d7ebaf9f8563dd` passed `npm run quality`
after review fixes: 1,970 unit tests passed (3 skipped), 304 accessibility
pages had zero violations or undecided rules, and audit, secret and SAST
scans found zero findings. PR #37's first hosted run passed Linux and macOS
quality but failed 13 Windows MCP stdio tests: overlapping real-process test
files delayed PowerShell job-helper launches beyond the existing 10 s MCP
initialize and 30 s pool startup deadlines. Windows Vitest files now run
serially while keeping every test, coverage threshold, and deadline. That
first hosted Windows recheck remained open at the time.

The next hosted Windows run (`36268614149`) still failed seven real MCP
process tests after file serialization; the same tree passed local Windows
and WIN-11-VM quality. The 2-core hosted runner can delay each new
PowerShell helper beyond the unchanged MCP deadlines even with one test file
at a time. M50 now compiles a separate C# console launcher once into the
extension storage and starts that executable directly for stdio servers.
Preparation runs a bounded executable self-test, including for a cached
file; a corrupt or blocked binary fails stdio closed with its reason logged.
Its private environment config and nonce-bearing GO still bind the live
creator before a server is created suspended, assigned to a kill-on-close job,
and resumed. The M27 shell-job DLL stays on its existing path. Real Windows
binary, batch, Stop, owner-death and withheld-GO drills passed; WIN-11-VM
passed full quality on staged tree `1c3217a94da0d3850f172d0335426041e8081c52`
with 304 accessibility pages and zero audit, secret or SAST findings. Local
staged tree `fcf1375157ce7f720fb2bb951d942481c9554720` then passed full
quality with 1,974 unit tests and 304 accessibility pages. PR #37 run
`36272726372` then passed all seven hosted jobs on direct-executable head
`d39e02a`, including Windows quality, accessibility, VS Code integration and
VSIX packaging. The final documentation receipt also passed its exact-tree
local gate and all seven hosted checks before PR #37 merged.

PR #37's Codex review found three valid faults: closing during a batch of
more than four servers could launch a later batch after shutdown; a required
server lost during a model reply or tool call did not stop the active turn;
and `_ide` normalized to the reserved `ide` function name. All three are
fixed locally. The new tests failed **3/3** on the reviewed code; removing
the new mid-call loss checks made its test fail **1/1** before restoration.
The affected suites passed **194/194** after the fixes. The corrected tree
later passed its exact-tree local and hosted gates before merge.

- **Goal**: the key backend runs the MCP servers Muse Code would, from the
  same settings, with Muse Code's names for their tools and its approvals,
  loudly when one does not run; and offers the extension's own diagnostics
  tool, which only Muse Code sessions had.
- **Research first**: Muse Code's public pages and changelog, and its 1.3.0
  binary's settings types, framings, validation messages and migrate skill
  (D42); Meta's function name rules, schema limits and the Responses
  schema's content parts for a function's output (the saved API docs). No
  live capture: nothing on the wire is Muse Code's, and there is no key.
- **Scope**: an MCP client of the extension's own (JSON-RPC 2.0, the
  handshake, paged `tools/list`, `tools/call` with deadlines and
  cancellation) over stdio (line-delimited or Content-Length, the process
  spawner with its environment allowlist and batch-file quoting, the tree
  kill) and streamable HTTP (JSON and event-stream replies, sessions,
  headers); the server set per host with its live states; tool names,
  schema fitting and result conversion; the approvals (D42's table); the
  in-process IDE tool; the MCP servers view and palette row on the Model
  API backend; 23 strings in fourteen
  languages; tests with a fake stdio server and a fake HTTP server.
- **Acceptance**: every rule of D42 has a test; drills M1–M24 fail a test
  in Claude's source worktree. The integrated branch's focused real stdio,
  pool and HTTP suites pass. The Windows job-assignment drill fails when
  assignment is disabled and passes when restored; a withheld-GO drill fails
  when owner confirmation is disabled and passes when restored. Real binary,
  batch, Stop, exited-parent and extension-parent death fixtures pass. The
  combined M48–M49 tree passed local quality before PR #37's review fixes;
  the corrected tree later passed exact-tree local and hosted checks.
- **Remote error boundary**: HTTP response bodies, malformed event payloads and authentication challenge parameters are untrusted. Errors and logs keep status and the authentication scheme, not raw server text that could echo a configured header or token.
- **Windows batch launch**: `cmd.exe /v:off` disables delayed `!` expansion even when the machine default enables it; `/d` continues to bypass AutoRun. The configured command and arguments remain quoted and percent signs refused.
- **Startup pressure**: connect at most four configured servers at once. Keep the settings order and start every enabled server, but avoid a simultaneous burst of child processes when a settings file has many entries.
- **Windows stdio containment**: the extension's three binary pipes are inherited unchanged by a configured MCP server. A C# console helper, compiled once into the extension's storage and spawned directly, binds a real handle to the creating Node process, then waits on a separate private pipe for a nonce-bearing GO from that still-live creator. Only then does it create the server suspended, assign a no-breakaway, kill-on-close Job Object and resume it, checking the bound parent handle once more immediately before resume. A dead creator cannot send GO even if its PID was recycled before the bind. Stop ends only the owned helper, closing its job; a server or extension that exits naturally also closes it. Missing job support fails stdio closed. Finite detached children, byte values `00` and `ff`, a `.cmd` launcher, withheld GO and both sides of parent death are covered by real local fixtures; disabling assignment and confirmation made their respective drills fail before restoration. No PID-only process kill is used on this path. M27's DLL remains separate for shell commands.
- **Final stdio response**: Node can report a server process's `exit` before its stdout has drained. M50 starts the job/orphan cleanup at `exit`, but tells the MCP transport the server ended only at Node's `close`. A deterministic exit → final JSON-RPC frame → close test failed when notification was moved back to `exit` and passed when restored; a real server writing its final reply synchronously before immediate exit also passed.
- **POSIX exited parent**: its detached MCP server leads a process group. If that server exits before `close()`, signal its group while descendants still retain the group ID. A finite-lifetime real child failed without this cleanup and passed with it under WSL Arch. A child that deliberately creates a new process group remains outside this guarantee; the POSIX Vitest run still needs a Linux/macOS native dependency install in CI.
- **PowerShell identity pairs**: the earlier Windows sweep drill found that `@(@(pid, ticks))` flattens the pair, so it fed a FILETIME timestamp to `Get-Process -Id` and missed a child. Its hashtable records remain for the M27 fallback and POSIX/legacy cases; M50's Windows stdio path no longer relies on the sweep or a PID at teardown.
- **Left for later**: resources, prompts, sampling, roots, elicitation and
  OAuth for remote servers; a server's own event stream over HTTP.

### M51 — Hooks on the Model API backend (D36)

**Status 2026-09-27: merged as PR #39 at `eb0ce56`; all seven hosted jobs
passed (run 36291432546)** (`docs/certification/m51.md`). Still open: live
hook parity beyond the captured PreLLMCall/PostLLMCall echo frames, and the
complete event-specific output contract. For 0.9.0 every hook source
(managed, user and project) loads only in a trusted workspace, so no hook
runs in Restricted Mode (on `release/0.9.0`; §10). The dated paragraphs in
this section are checkpoints from before the merge.

PR #39 review found a `PreToolUse` permission gap at the M49 join: the
memory-tool branch returned before forwarding the hook's `ask` decision,
so `add_memory` or `edit_memory` could write in Bypass without a card.
The forced-approval bit now reaches the memory permission judgment after
path placement and before execution. A forced card requires a human
decision even when `PermissionRequest` hooks allow or Edit automatically
would ordinarily answer a file write; Plan and Restricted Mode refusals
still take precedence. The Bypass/Edit memory-write red tests found no
card before this correction and now pass. Positive allow-once and
hook-forced read paths also pass locally. Exact staged tree `0fbe2c47`
passed full WIN-11-VM quality: 2,041 tests (3 skipped), 304 accessibility
pages with zero violations or missing results, zero audit/secret/SAST
findings, and zero checkout-owned processes. The next documented tree
`58bcb9c5` passed local Windows `npm run quality` with the same 2,041/3
unit result and 304-page accessibility result; all static, build, audit,
secret and SAST gates passed. Redacted staged-patch gitleaks and independent
process audit also found zero. This latest receipt changes the documented
tree again, so its exact local gate and hosted review remain before merge.

Independent final review found an unchecked cast in the Model API host test's
fake response-body helper. The review cleanup replaces it with a runtime
array/record check. A malformed fake input failed before the change and
passes after it; the cleanup receives its own exact-tree quality gate before
commit.
The first pre-PR branch run on `bb2bd61` failed only on Windows:
`toolIo.test.ts`'s real hook-process test hit Vitest's default five-second
test deadline while its real `runHook` operation still had a ten-second
deadline; test-folder cleanup then saw `EBUSY`. Align the test's outer
deadline with other bounded real-process tests so it can observe the hook
operation's success or explicit timeout and finish cleanup. Do not change
`runHook`'s deadline, assertions, Vitest's global threshold or the quality
gate. The exact staged tree `2856971` passed the focused real hook stdin
test on WIN-11-VM with zero fixture-owned processes; final documented-tree
local quality and a new pre-PR branch dispatch remain before a PR. The next
documented tree `0b990287` passed full local Windows quality (2,034 tests,
3 skipped; 304 a11y pages with zero violations/undecided/missing; audit,
gitleaks and SAST zero) and a process audit of zero. The verified pre-PR
workflow receipt below changes documentation again, so the final candidate
must receive its own exact-tree gate before commit and branch dispatch.
The second M51 branch dispatch on `d9602f9` passed all other jobs but Windows
again failed the real hook stdin fixture: with an adequate outer deadline,
`more` returned exit code 1 in hosted CI. The test must exercise the same
PowerShell-to-cmd hook runner using a deterministic Node stdin echo child,
not a terminal pager whose behavior depends on runner console state. Keep
the 10 second product deadline and the assertions that stdin is echoed,
exit is zero and no timeout occurred. The exact staged tree `e46ece3`
passed the focused real hook test on WIN-11-VM after `npm ci`, with zero
checkout-owned processes. Repeat exact documented-tree local quality and
branch dispatch before opening a PR.
The third M51 pre-PR run on `348ac4f` failed the same Windows hook case
after 10,962 ms even with the Node echo child. The next bounded diagnostic
must report the controlled fixture's exit code, timeout/cancel flags and
stdout/stderr on failure, without secrets. Do not infer a terminal-pager
cause or relax the 10 second product limit before that result is known;
the PowerShell-to-cmd stdin forwarding boundary may need a runtime fix.
Run `36282344418` then reported `isTimedOut: true`, `elapsedMs: 11027`,
empty stdout/stderr and no cancellation. Microsoft documents that
[stdin is not connected to PowerShell's pipeline for input](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection?view=powershell-5.1),
while [`Console.In` reads standard input](https://learn.microsoft.com/en-us/dotnet/api/system.console.in?view=netframework-4.8.1).
A diagnostic Windows wrapper explicitly read UTF-8 stdin and piped it to
cmd, with the existing 256 KiB hook-input cap enforced before spawn; the
job-object join, allowlisted environment and child command line stayed
intact. A local Unicode JSON echo drill passed;
removing the adapter cap made its oversized-input guard test fail before
restoration. Exact staged tree `c977c836` passed a real Unicode+EOF hook
drill and full WIN-11-VM `npm run quality`: 2,036 tests passed (3 skipped),
304 accessible pages returned with zero violations/undecided/missing, and
audit, gitleaks and SAST found zero. The remote tree matched before/after
and process audit found zero checkout-owned processes. This receipt changes
documentation, so final exact local Windows and hosted branch proof remain
before a PR.
Hosted run `36284566101` on `bf559d4` still timed out the controlled
Windows echo case at 12,232 ms with empty output, despite explicit stdin
forwarding. That does not prove stdin was the cause. The next diagnostic
uses a 30 second budget only for this real-process fixture (still far below
the product's 600 second default) and a 60 second Vitest envelope, while
keeping the exit/Unicode echo/no-timeout assertions and all separate
timeout gates. A late success would point to hosted startup pressure; a
30 second hang would call for deeper I/O work. If late success occurs,
compare the original wrapper under the same hosted budget before
retaining extra runtime forwarding code. Run `36285882702` then passed
all seven hosted jobs on `cadb565`; its Windows Unicode/EOF hook test took
28,779 ms, near the 30 second fixture cap. An isolated pre-forwarding
wrapper tree `9ebcdf21` passed that Unicode/EOF test locally and on
WIN-11-VM with no owned process left. The extra PowerShell read/pipe has
no demonstrated benefit, so revert only that line while keeping the
256 KiB adapter guard. Raise this fixture's bounded operation budget to
60 seconds and its Vitest envelope to 90 seconds, still below the 600
second product default; all separate timeout behavior tests remain. Exact
staged tree `b9667382` then passed a focused Unicode/EOF test and full
WIN-11-VM quality: 2,036 tests passed (3 skipped), all 304 a11y pages
returned with zero violations/undecided/missing, and audit, gitleaks and
SAST found zero. Remote tree and process audit were clean. This receipt
changes documentation; exact host-local and hosted proof on the simpler
wrapper remain required before a PR.
An M54 integration review found a separate hook-stdin privacy boundary:
`input_text`, developer instructions, tool descriptions and assistant output
can themselves contain pasted `data:` media URLs. The common model-call
preview now scrubs those URLs before clipping text, preserving ordinary
surrounding words and leaving the actual Model API request/replay unchanged.
A fake Zod-valid text URL failed the pre/post payload test before the fix;
the shared projection then passed 4/4 focused tests. No new provider wire
schema or live paid call is inferred. The prior documented-tree full gate
`42168ea7` passed locally with 2,034 unit tests (3 skipped), 304 accessible
pages and zero audit/leak/SAST findings, but predates this media fix; exact
quality and branch dispatch remain required on the new tree.

Checkpoint 2026-09-26 (superseded by the merge): M51 branch `4624552` includes merged main `fa370ee` and has exact-tree Windows `npm run quality` green on tree `6a70ef7` (2,033 tests passed, 3 skipped; 304 accessibility pages with zero violations, undecided or missing; audit, gitleaks and SAST zero). The small final-review test/doc cleanup then required its own exact-tree gate before commit. The
bounded runtime wires all 17 documented event names at the Model API backend's supported operations: `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`,
`PostToolBatch`, `PreCompact`, `PostCompact`, `Stop`, `StopFailure`, `SessionEnd`
and `Notification`, plus captured `PreLLMCall` and successful `PostLLMCall`
boundaries. `SubagentStart` and `SubagentStop` now run at the M48 child turn
boundary under the same paid task grant. The complete event-specific output
contract remains open. The pre-M48 stage is pinned at
`refs/codex-backups/m51-pre-m48-20260926`; M48 reconciliation passed 232/232
focused tests across six hook/host/settings/tool-I/O files, host and unit
typechecks, localization and targeted lint. At that checkpoint, the final
documented-tree gate remained open. An
initial duplication check failed on 11 clone pairs, then passed with zero
clones after shared hook and write-turn helpers; no gate was weakened. An
isolated Muse Code 1.3.0 echo-provider run
captured PreLLMCall/PostLLMCall success frames and a PreLLMCall block. A
subsequent isolated echo run captured a PostLLMCall block: its run failed
without another model request. Full Model API parity remains open; the
captured safe subset is staged in this isolated worktree.
The pre-PR workflow delta from merged main `10522223` is staged with the
review cleanup for one exact candidate gate; branch dispatch remains a
separate prerequisite to opening its PR.

The first full M48-base quality run reached `security:sast` after 1,814
passing unit tests and 304 accessible pages, then failed on unbounded
host-thread regex compilation in the hook parser. Compilation now runs
inside a bounded V8 context, and the focused hook/host tests and Semgrep
scan pass. The exact documented tree still needs a full quality rerun.
The first documented rerun found a separate 25 ms regex match timeout
false negative under 147 coverage workers because each match built a new
V8 context. Reusing fixed contexts kept the 25 ms match bound and restored
the full unit-coverage pass (1,814 tests, 3 skipped). The final exact-tree
quality gate remains pending.
Windows `npm run quality` then exited 0 on exact staged source tree
`b87fb92247a57e37b4a28a01a1ad2a3effbeef5c`: 1,814 unit tests passed
(3 skipped), all 304 accessibility pages returned with no violations or
undecided results, and audit, secret and SAST checks were clean. This
receipt is for the source tree before the documentation update; rerun the
full gate on the final documented tree before committing.
The documented tree `1ebbfc1eba20f41c09c57a6c4f113071e692c4af`
also passed local Windows `npm run quality`: 1,814 unit tests passed
(3 skipped), 304 accessibility pages returned with zero violations,
undecided results or missing pages, and audit, secret and SAST checks were
clean. Independent process audit found no M51-owned Node or Chrome process.
This added receipt changes the staged tree, so the commit candidate must
pass the full gate once more before commit.
It did: local Windows `npm run quality` exited 0 on final documented tree
`da39841b6919b76ba0e70ca17ba3fbf3e003b400`; 1,814 tests passed
(3 skipped), all 304 accessibility pages returned, and audit, secret,
SAST and duplication gates were clean. No M51-owned Node or Chrome process
remained. That tree was committed locally as `08a217b` without a push.

The reviewed M49 merge `4694803` was then joined on the M51 branch from a
fresh backup ref `refs/codex-backups/m51-pre-m49-20260926`. Four content
conflicts combined M51 hook loading and paid child approvals with M49's
memory store and tests. Eight focused hook, subagent and memory suites
passed 284/284; all five TypeScript projects, localization, targeted lint,
Prettier and duplication passed. A red mutation that sent the original
tool arguments past `PreToolUse` changed the memory approval from
`reviewed.md` back to `deploy.md`; restoring the effective call passed.
M50 external MCP/IDE hook integration and the Model API Hooks picker
were added in the later M50 join. Exact local quality then passed;
hosted M51 review remains open.
The first exact M49-combined staged tree
`da82047818238b6788070181406a7d9f76492d92` then passed local Windows
`npm run quality`: 1,894 tests passed (3 skipped), all 304 accessibility
pages returned with zero violations or undecided results, and audit,
secret, duplication and SAST gates were clean. Independent process audit
found no M51-owned Node or Chrome process. This receipt changes the staged
tree; the final documented candidate must pass the full gate before the
local M49 merge commit.

The captured M51 model-call increment wires `PreLLMCall` before a logical
Model API response stream (including compaction) and `PostLLMCall` after a
completed response. It uses the observed summary fields with bounded text
previews, not media bytes, full tool output or API keys. A captured pre-call
block vetoes the request before HTTPS. A post-call block stops before tools
run, pairs returned calls with failure outputs for replay and buys no
follow-up request, matching the isolated echo capture's failed terminal.
Internal HTTP retries share the logical attempt's hook boundary, and the exact retry/failed-response
hook sequence remains an explicit certification gap. The M48 child events
passed local fake boundary tests but have no live provider claim. M50's
external MCP dispatch and the Model API Hooks picker later passed focused
integration tests; live MCP or subagent hook parity is not claimed.

**Integration map, recorded 2026-09-26; M48 child path focused-green, M50 open.** M48 creates a child
in `ModelApiSession.spawnChild`, admits queued work in `startQueuedChildren`
only after its paid grant, and reports a completed turn in `childEvent`.
Pass M51's session hook snapshot into the child without re-reading settings.
Dispatch `SubagentStart` at the actual first child-session start, before its
first model request, and put its allowed context in the child replay. Do not
fire it for a declined spawn or a cancelled queued child. `childEvent` is
too late to implement `SubagentStop`: dispatch that event at the child's
natural stop boundary inside its turn, with the documented child ids and
last assistant message. A block may continue the same child task only within
both M51's stop-continuation bound and M48's existing four-request paid
grant; owner Stop, interrupt, disposal and queued cancellation must not be
converted into a hook-funded continuation. These are local Model API hook
events, not new Muse MSP notification parsers; the SDK's documented payload
is reference evidence, not a live subagent capture.

Before the reversible M50 join, its `ModelApiSession.externalTool` and
`performExternal` needed to join M51's
`runCall`/`decideAndRun` hook path: keep the external `mcp`/read-only IDE
permission and trust checks, route the effective `PreToolUse` input through
normal approval and the MCP/IDE validator, skip workspace `touchPath` for
external tools, preserve M50's structured `outputParts` for model replay,
and send bounded text to `PostToolUse` or `PostToolUseFailure`. Include
`mcp__<server>__<tool>` and `mcp__ide__<tool>` in matcher, post-tool and
batch coverage without exposing media bytes or provider credentials to hook
stdin. M50's palette had offered MCP but not Hooks on the Model API backend;
the join added the backend-aware Hooks picker. M51's earlier machine opt-in
check happened only when hooks loaded; dispatch now checks it again so an
open session stops running hooks as soon as the setting turns off. Source
files remain a session snapshot.

The reversible M50 join at `d39e02a` preserves the reviewed MCP/IDE
dispatch and M51 hook path. Hook stdin now receives a 4,096-character
argument preview with 512-character values, a 1,024-character result
preview, bounded nesting and omitted media/credential fields; the actual
MCP arguments and structured model replay are unchanged. A required-server
failure takes precedence over `PostToolUse` or `PostToolBatch` hook stops.
The backend-aware Hooks picker shows `museSpark.modelApiHooks` on/off state
and opens that setting, while source edits still require a new session.
Fake red drills observed the original media/credential leak and a completed
turn after required-server loss. Independent review found three more await
boundaries: PreLLMCall could send a request after required-server loss,
PostLLMCall could report its own block instead of that loss, and Stop or
SubagentStop could finish a turn after the loss. A separate key-read race
could still send a response POST after that loss. All now recheck the
required server before continuing; the final synchronous request guard
also covers every HTTP retry and preserves child paid admission. Local
fake red/green drills cover each boundary.
Mac `quality:gates` exited 0 on staged pre-review-fix tree `e930a362` with
161 test files passed (one skipped), 14 localization tables, zero duplicate
clones and zero audit advisories. It did not run the browser gate. The
post-review-fix tree `02c02fb314410cd20b02e2d789ac40bc888f1ab7`
also passed Mac `quality:gates` in 121 seconds with the same 161 passed
test files, one skipped, 14 tables, zero clones and audit advisories.
Independent readback confirmed its Git tree and zero checkout-owned Mac
processes. That receipt preceded the documentation join and excluded
browser a11y. The later final M50-main ancestry merge `4624552` has tree
`6a70ef7a87f1cdf8234e1991a74896633709ff6b`, identical to the exact
Windows full-quality candidate: 2,033 tests passed (3 skipped), 304 a11y
pages returned with zero violations, undecided or missing pages, and audit,
gitleaks and SAST reported zero. Independent CIM audit found zero M51-owned
Node or Chrome processes. The branch is clean and unpushed; hosted M51
review and the scoped review-cleanup gate remain open.

Focused M48 fake checks now cover no `SubagentStart` for decline/queued
cancel, one start context reaching only the child, natural `SubagentStop`
feedback under the four-request cap, explicit Stop that cannot be vetoed,
and live hook opt-out in an open session. The M50 fake tests now cover MCP
rewrite through normal approval, bounded hook payloads, post-tool/batch
delivery and required-server loss at hook await boundaries. Remaining
cross-feature IDE and denial checks, hosted review and live parity need
completion. The captured echo
frames are unchanged; no new live hook capture is claimed here.

- **Source contract:** Muse Code 1.3.0's [settings-level hook guide](https://meta-models.github.io/muse-code-sdk/next/guides/extend/hooks/) and [event/payload reference](https://meta-models.github.io/muse-code-sdk/next/guides/plugins/reference/hook-events/) document the project, user and managed sources, 17 events, matcher grammar, command fields, stdin and result shapes, and execution limits. The guide includes captured runs. The shorter user guide names 15 events; the SDK reference also documents `PostToolBatch` and `StopFailure`. These are reference shapes, not a claim that this extension has executed them.
- **Goal:** use those existing Muse hook files with Model API sessions, without handing the Model API key to a hook process. Every hook source (managed, user and project) requires VS Code workspace trust (decided for 0.9.0; M51 first gated only project hooks). Hook commands are outside the tool sandbox; the Model API backend must not execute them merely because the model chose a tool. Activation needs an explicit, machine-scoped opt-in and a visible review of commands/sources. A declined or unavailable activation runs no hook.
- **Runtime:** read and validate each source at session start, in managed/user/project order, and keep that snapshot for the session. Reject an invalid source without silently keeping partial guards. Run commands with a cleared, allowlisted environment, stdin JSON, a bounded timeout, independent stdout/stderr limits, process-tree cancellation and at most four concurrent hook commands across the extension host. Validate JSON output before use. Hook answers can block or alter only the event actions the reference allows; any rewritten tool input is revalidated and still passes normal approvals. A hook never approves a paid call, bypasses a protected write, or broadens a session rule. Show failures and hook messages without leaking command environment or credentials.
- **Context priority:** hook-added text is replayed as user-level context. A repository hook cannot create a developer instruction; its blocking decision is enforced by code before the relevant action.
- **Panel access:** expose **Hooks…** in Customize on both backends after M50's palette changes. The picker must say whether Model API hook execution is on, and link to its machine setting; source rows must not claim a trusted project runs while the opt-in is off. Keep Muse Code's read-only settings behavior.
- **Event mapping:** wire lifecycle, prompt, tool, permission, model, compaction, subagent and stop events at their real boundaries. Where a Model API session has no corresponding operation, the event cannot fire; do not fake it. Preserve event-specific payload fields and any hook feedback in the replay/transcript. Bound repeated `Stop` and post-model continuations so hooks cannot create an infinite paid loop.
- **Acceptance:** tests from the cited reference shapes cover source order, trust/opt-in, bad config, matcher selection, denial, updated input plus permission recheck, failure/timeout/output caps, cancellation, cleared credentials, each applicable event and persisted replay. Red drills show a disabled guard test fails, then restored green. `npm run quality` and the relevant UI/accessibility checks pass. Record local and live evidence in `docs/certification/m51.md`; do not mark complete on unit tests alone.

### M52 — Scheduled prompts (D36)

**Status 2026-09-27: merged as PR #40 at `93ea81c`; all seven hosted jobs
passed (run 36294862598)** (`docs/certification/m52.md`). No live model
attempt or paid call was made; the cron day-field rule is a standard-cron
inference, not captured Muse parity. The dated paragraphs below are
checkpoints from before the merge.

Checkpoint 2026-09-26: PR #40 expiry and tariff fixes staged. The
isolated M52 worktree is based on `34002ab`; its pre-M47 79-path staged tree
is pinned at `refs/backup/m52-before-m47`. Sixteen M47-base fake schedule,
paid guard, UI and workflow suites passed 622/622; all five TypeScript
projects and localization passed. On the exact later pre-integration tree
`a248d9c18b51818e5e95234ee13d7a1f4c02a4b3`, WIN-11-VM ran full
`npm run quality` with exit 0 (1,728 tests passed, three skipped; 288
accessibility pages with zero findings; audit, secret and SAST checks clean).
Kubuntu ran `npm run quality:gates` with exit 0 (1,724 passed, seven skipped;
build and audit clean). Linux browser accessibility was not certified.
The later native-proof tree `e4e5a8f24ce513e6eb24e0aa463ccefb2f7647c4`
also passed full Windows `npm run quality` with exit 0: 1,730 tests passed,
three skipped, 288 accessibility pages with zero findings, and clean build,
audit, secret and SAST gates. Its log and process audit are recorded in
`docs/certification/m52.md`. This receipt precedes the ordered join.
The following documentation-only tree
`9e293770599794a2a7b95ad8780b12fc6885577a` passed Mac mini
`npm run quality:gates` with exit 0: 1,726 tests passed, seven skipped,
and build, localization, lint, type, duplication and audit gates clean.
PSScriptAnalyzer is Windows-only; Mac browser accessibility, secret scan and
SAST were not part of that run. Its exact log and process audit are in the
same certification record.
The no-commit join with M51 (`bb2bd61`) now retains M48 paid-child admission,
M49 memory, M50 MCP and M51 hook boundaries alongside scheduled consent.
The client rechecks the key, model and paid gate after SecretStorage, before
each fetch and retry; a synchronous child-admission abort prevents the
scheduled paid row and request. Four red drills caught retry-key changes,
Stop-hook continuation, PreLLM veto and the final admission-abort race before
their fixes (`docs/certification/m52.md`). Focused suites, host/unit/webview
types, localization, lint and duplication pass on the staged join. The exact
combined full gate and final M51 ancestry remain open.
Independent review found that strict schedule persistence could save a parent
or child with an unanswered tool call, and that losing the Model API key left
the old account's schedule prompts visible. Two tests failed before the fixes
and all three focused cases passed after: creation now refuses and removes its
new job while replay is unsafe; listing without a key emits an empty schedule
view. A storage-error red test then showed that clearing after the disk read
could still leave stale prompts visible. The list now clears immediately on
missing identity, before storage I/O, and rechecks identity after the read.
A claim followed by account removal makes no HTTP request or paid tally.
The pre-fix combined tree `88cb798730d12517fc3075753d9aca77d4b403de`
passed Mac `quality:gates` (2,059 passed, 14 skipped); the post-fix tree still
needs the full local, platform and hosted gates. The later M51 hook media
preview correction must also join before final certification.
The cron matcher now follows standard crontab day-field semantics: when either
day field contains `*`, both fields' actual values must match; when neither
contains `*`, either may match. Red tests caught `*/1` wrongly firing on an
unlisted weekday and preserve the `*/2` step and full-range cases. Meta
documents local five-field cron but does not specify this combination rule,
so this is a standard-cron inference, not live Muse parity.
The first M51-joined full WIN-11-VM gate then found four missing results in
the `paid-subagent-usage` accessibility scenario. M48's harness paid tally
omitted M52's required `scheduledRuns` field; protocol validation dropped
that state before the paid badge rendered. A protocol test confirmed the
rejection. Adding `scheduledRuns: 0` to the shared fixture made the targeted
scenario pass all four themes with zero findings. This is pre-fix full-gate
evidence; the corrected exact tree still needs its full rerun.
The corrected staged tree `8ed1a123a584a9e5ac6dc6cef37efd342c92afc7`
then passed literal WIN-11-VM full quality: 2,075 unit tests passed, 312
accessibility pages had zero findings or missing results, and audit, secret,
SAST and PowerShell checks were clean. Its commit `bb9fd538` preserves that
tested tree. This receipt precedes the later M51 fixture and hook-stdin fix.
M55 review found one further display edge: sign-out left a prior schedule
list in webview state even though the core would refuse its key. A reducer
test failed with the old prompt still visible, then passed after auth-state
clearing. Backend switches also clear it; transient CLI sign-in on the still
active Model API backend preserves it until auth actually changes. The
webview suite passed 98/98 after the fix. This fix ships with M55 (PR #43).
A same-backend Model API key replacement then exposed one more boundary:
`backendStopping(false)` dropped the old session, but its schedule event stayed
visible and the next `signedIn` event retained it. A controller test failed
with the old account's prompt still shown. Dropping a Model API session now
emits an empty schedule list before the asynchronous restart, while a CLI
sign-in attempt that keeps the session live does not drop it. The focused
test passed after the fix; no real key or Model API call was used. This
change requires its own exact-tree full gate before a commit.
PR #40 review exposed two M52 boundaries. A seven-day interval first fires
exactly at the seven-day expiry, so normal polling after that instant prunes
the job without a runnable occurrence. Treat expiry as exclusive when
calculating fires; reject a cadence with no eligible fire before creating
storage. An eligible due occurrence remains pending until Run, Cancel or the
seven-day expiry, whichever comes first. Prune and refuse claims at expiry,
including old stored jobs whose first fire equals it. The scheduled
feature-enable price currently quotes
only standard token rates, and the per-run modal reuses those rates even for
a contributor model. Show both verified tariff tiers at feature enable and
the selected model's exact tier in each run modal; an unpriced model cannot
gain consent. Preserve all other paid gates and the zero-request decline.
Add red/green expiry, contributor, and unknown-model tests, update all
localized rate templates and docs, then rerun the exact-tree full gate before
updating PR #40.
Seven focused cases failed before the expiry/tariff fix and then passed;
one more test caught a receipt write crossing expiry and passed after the
post-write guard. Six affected suites pass 273/273, all TypeScript projects,
localization, targeted ESLint, Prettier and zero-clone duplication pass.
No live Model API attempt was used. Full exact-tree quality and hosted PR
checks remain open at this checkpoint.
The first frozen candidate `f215881a` passed static, type, localization and
duplication gates but its full unit gate failed one stale palette expectation
for the old standard-only price (2,089 other tests passed, three skipped).
The palette's new two-tier output is intended; update that explicit test,
prove it green, and rerun full quality on the next exact tree.
The native price-modal decline was observed with a fake Model API in an
ordinary VS Code development window; see the receipt below. Meta's [interactive
guide](https://dev.meta.ai/docs/muse-code/interactive) defines `/loop` as a
recurring prompt with an interval or local five-field cron expression. Its
[loop and cron recipe](https://dev.meta.ai/docs/cookbook/loop-and-cron) says
jobs are session-scoped, need a running process, skip a fire during an active
run, recover at most one missed recurring fire, and expire after seven days.
The captured Muse Code 1.3.0 `cron_create`, `cron_list`, and `cron_delete`
tool rows are in `docs/certification/m43.md`; MSP exposes no cron verb, and
the CLI exposes no `muse cron` command. A panel could ask the model to list or
cancel native jobs, but could not prove that its answer is authoritative.

- **Model API scope**: `/loop <interval> <prompt>` and `/loop "<five-field
cron>" <prompt>` create local, session-scoped schedules; `/loop list` opens
  the stored jobs, and `/loop cancel <id>` removes one. The panel lists prompt,
  cadence, next eligible time, run count, and pending state, with accessible
  run and cancel controls. A schedule belongs to the workspace and the stored
  Model API key identity that created it. It persists with its session and
  survives a window restart. Only a loaded session observes due work; no
  external or hidden process runs after VS Code closes.
- **Money boundary**: scheduling, listing, and cancelling make no Model API
  call. A due occurrence stays pending until Run, Cancel or seven-day expiry,
  whichever comes first. When the user chooses Run, they accept that
  occurrence's prompt and published Model API token prices in a
  modal, and the machine-scoped, off-by-default scheduled-prompts paid gate
  is on with its price accepted. Bypass cannot skip this. A declined or closed
  dialog leaves it pending until expiry and spends nothing. A paid transcript row and
  Account & usage count identify every admitted scheduled run; its tokens
  remain in the session's token-cost estimate, not added twice. A price
  confirmation names one model and session; if either changes while the
  dialog is open, that approval expires without a claim or request. A
  cancelled job is rechecked after the dialog too. Admission carries the
  confirmed model and account digest into the turn; the client compares the
  key it actually reads from SecretStorage with that digest before HTTP,
  and a changed model fails before each scheduled request. Stop during the
  key read refuses before the paid row, tally or HTTP request. No raw key is
  stored in a schedule, transcript or receipt. A local receipt alone does
  not count as paid use; the paid row and tally appear when the first HTTP
  attempt begins, after the final guard.
- **Account isolation during reads**: a list or poll reads the stored jobs
  before resolving the current key identity. An older, delayed read cannot
  publish a previous account's prompts after a key switch.
- **Delivery**: an occurrence is atomically claimed in the workspace store
  before its turn starts. A failed or interrupted turn is recorded as attempted
  and never silently replayed. A recurring job computes its next eligible
  time without a backlog; a one-time job ends after its attempt. An active
  turn leaves the occurrence pending. The run is refused if the API key has
  changed, the workspace differs, the paid gate is off, the session is no
  longer loaded, or the claim cannot be recorded. Resume restores the job
  list before any due notification. Cancel is idempotent and never cancels a
  turn already admitted. A receipt claimed just before a model, key or gate
  change is retained even if the client refuses before HTTP: the missed
  occurrence is skipped rather than risk a replay of a possibly billed one.
- **Muse Code boundary**: its native cron tools remain available through
  ordinary model turns, including the captured tool rows. The panel does not
  claim a native job list or issue a direct cancel until Meta exposes a
  schedulers API over MSP or the CLI; add that wire shape only from a live
  capture. The panel's `/loop` management applies only to the extension's
  Model API schedules, with backend/account/workspace scope shown in the UI.
- **Acceptance**: pure schedule parsing and local-time next-fire tests,
  restart/due/cancel/active-turn tests, atomic-claim and cross-window race
  tests, changed-key and workspace isolation, gate-off/decline/Bypass drills,
  paid row and tally, all translations, accessibility harness, and the full
  `npm run quality` gate. Record red drills and exact evidence in
  `docs/certification/m52.md` before certification.

**Native modal proof plan and result (2026-09-26).** Reuse the same VS Code
`showWarningMessage` helper in production and a disposable ordinary VS Code
development extension. `@vscode/test-cli` explicitly refuses modal dialogs
while it runs extension tests, as the session-1 test-mode attempt showed, so its test
mode cannot certify this gate. The probe uses an in-memory key identity, fake
Model API fetch, session and schedule stores, and an injected clock; it never
reads or stores the owner's key or calls Meta. For Manual and Bypass, make a
job due, open the native per-run price modal, dismiss it in the active WIN-11-VM
console session, and assert zero fake fetches, zero paid-run tally, no receipt
and unchanged fire count. First prove a disposable user-scope interactive task
actually runs in session 1 and can inspect VS Code's UI Automation tree.
Wait for other VM gates to finish before opening a window; remove only the
identified temporary task and helper afterward. If session-1 UI access is
unavailable, leave this acceptance gate open rather than treating a mocked
modal as proof. The disposable task ran in session 1 and UI Automation saw
the actual modal, including the prompt, standard token prices, and Cancel
control. Cancel declined Manual and Bypass runs. The fake host recorded zero
HTTP fetches, paid-run tallies, schedule claims and fire counts in both cases;
the owner key was never read. `@vscode/test-cli` refused the modal in test
mode, and injected Escape did not dismiss the ordinary VS Code modal, so
keyboard Escape is not certified. The temporary task, helper files, private
Code process, profile and extensions directory were removed after a process
audit. The capture and red drill are in `docs/certification/m52.md`; ordered
integration and full gates on the later tree remain open.

### M53 — Conversation rewind and side chat (D46)

**Status 2026-09-27: merged as PR #41 at `be34ee8` with the Account & usage
follow-up; all seven hosted jobs passed (run 36298748478)**
(`docs/certification/m53.md`, "Final PR #41 integration receipt"). Limits
stand: Muse Code 1.3.0 refuses forks on Windows, and the Plan-mode side fork
elsewhere is not certified strictly read only. The dated paragraphs below
are checkpoints from before the merge.

**PR #41 live-card image follow-up (focused proof):** the webview's local user-card
ID and Model API's replay user-message ID differ before any History reload.
`turnAccepted` must carry the backend's ID to the card without replacing its
local UI ID, including a late acceptance. A promoted steer may later receive
a new turn ID, so its ID-keyed correction must work on either event order.
Snapshot validation must preserve the replay ID. Five targeted cases failed
before the fix and seven passed after it. Three affected suites passed 273/273;
localization, changed-file lint, formatting and duplication reported zero
problems. The joined-tree gates remain required before this follow-up is
certified.

**PR #41 review follow-up (focused proof):** a steered user card can share its turn
ID with the previous card, so its fork cut must use an earlier distinct turn
or hide conversation rewind when none exists. Image restoration must identify
the selected card as well as its turn. A Muse Code side panel may resume only
its own side fork from History or after a window reload; a foreign session must
be refused before its Plan mode or goal can change. Five focused assertions
failed first; disabling the side guard made its History test fail too. Seven
targeted tests then passed after the source fix; four affected suites passed
433/433 with all five TypeScript projects, lint, localization and formatting
green. An active selected turn remained a further gap: menu and forged
controller request both failed red drills, then were blocked before a fork.
Model API replay now links
each primary or steered user message to its exact transcript card; accepted
compaction stores its real summarized turn through save and resume. Both core
regressions failed before the fix and passed afterward, including older
session files. Exact-tree gates and PR review remain required before this
follow-up is complete.

**Further PR #41 live-card correction (done before merge; see above):** an immediate Model API
image rewind before History reload still uses the webview-local card ID while
the durable replay uses a different generated ID. Red-test primary, steered,
queued and late-acceptance paths; carry the generated ID through acceptance
without replacing the local row ID, then rerun the exact combined gate.

**Checkpoint 2026-09-26 (superseded by the merge): M52 and M54 joins
staged** (`docs/certification/m53.md`). Focused tests and merge red drills
passed on the isolated trees: 628 focused tests on M47 main `34002ab` and
the combined-fork red drill on M46. The pre-move stage is pinned at
`refs/codex-backups/m53-pre-m47-20260926`. M48–M51 are present in staged
tree `01fe750c246b16a527ca51eeb989c672571e7eb8`; six focused suites
passed 561/561 with five TypeScript projects, lint, localization and format
green. The later M52/M54 join passed 614/614 focused tests, five-project
typecheck, localization, lint and formatting. Side-schedule create, cancel
and run first failed their red test, then were refused before storage, claim,
HTTP or paid tally; a PDF remains in side-fork replay. Corrected M51 ancestry
and exact combined quality and browser gates remain open.
The isolated M52/M53 join then passed eight focused suites 681/681 with
zero duplication; its key-replacement checkpoint also passed full Windows
quality (`docs/certification/m53.md`). M54's final ordered join still needs
its own exact-tree gate.

- **Goal**: rewind conversation context to a selected user turn, preserving
  its prompt as a new draft; ask a side question in a separate branch while
  the main conversation continues.
- **Research**: Muse Code 1.3.0 exposes `session/fork` with an optional
  completed-turn cut point, but no MSP rewind or side-chat verb. Its TUI has
  `/rewind` and `/side` (`/btw`). The Model API session already stores input
  replay and transcript items. D46 sets the implementation and limits.
- **Scope**: a user-card rewind choice, draft and available image restoration,
  a fork before the chosen turn (or fresh conversation before the first), a
  separate side-chat panel that keeps the source attached, a fixed Plan-mode
  policy and cleared goal on the side branch, compaction-aware Model API cuts, eight strings
  in all fourteen languages, and documentation.
- **Acceptance**: met at merge (PR #41, run 36298748478).
- **Mac gate checkpoint, M48–M52 joins still pending**: exact staged M53 tree
  `426a6f55f99f551e6ce85254977688964699a867` passed remote patch and
  Node archive verification and `npm ci`, then `quality:gates` stopped at
  `unicorn/prefer-simple-condition-first` in the side-chat `Shift+Tab`
  guard. Moving the existing callback check first passed focused ESLint and
  the keyboard regression test on the private Mac copy. The second run on
  corrected tree `eda1f4ce416ccd5c4cd5f402edc0e0eec01608f5` passed
  through cycles, then stopped at three `jscpd` clones. Shared fork-source
  guard and test setup helpers removed all three on the private Mac copy:
  duplication found zero, 267 focused tests passed, and changed-file ESLint
  plus host/unit type checks passed. A third run on exact staged tree
  `eaa5ee60f195d8eab9ce5ab237ca2c59db70bb0f` passed
  `quality:gates` on Mac: 1717 unit tests passed, localization, duplication
  and audit clean. The `rewind` and `signin` accessibility scenarios each
  passed all four themes; the full Mac accessibility matrix remains open
  after six-way Chrome page timeouts over SSH (`docs/certification/m53.md`).
- **WIN-11-VM full local gate**: literal `npm run quality` exited 0 on exact
  staged M53 tree `4273bd0f94bccfcffae471b5ad1a36cd38542964` on M47
  base. Unit tests: 1721 passed, three skipped. Accessibility: 280 pages,
  zero violated or undecided rules and zero pages without a result.
  PSScriptAnalyzer, localization, duplication, audit, gitleaks and Semgrep
  all reported zero findings. The private VM checkout had no unstaged or
  untracked files or remaining gate processes. This documentation receipt
  changes the staged tree; M48–M52 joins and their gates remain pending
  (`docs/certification/m53.md`).
- **Provisional M51 boundary review**: `ModelApiSession.copyInto` keeps the
  completed-turn/compaction cut alongside M46 background notes and M48 child
  records. A side fork is marked and put in Plan before any M51 `SessionStart`
  hook; all its hooks stay disabled through resume and close. M50 external MCP
  calls are refused before read-only hints or approval rules. Copied and
  resumed child records are held to Plan. A side surface cannot revive an
  ordinary Model API session: the core checks its stored marker before resume
  hooks. Red tests caught the previous hook, child-mode and resume leaks;
  normal forks remain unaffected (`docs/certification/m53.md`).
- **Durable side-session lifecycle**: the stored marker is optional for old
  sessions. The fork clears its inherited goal before a strict save; a failed
  save opens no panel or orphan record, and a slow save finishes before the
  source hold is released. History/restart keeps the side label and Plan lock.
  These focused checks passed on the provisional M51 join. The M52 join now
  refuses schedule create, cancel and run in core before any paid admission;
  red/green tests cover a resumed side fork and a Bypass source. Corrected
  M51 ancestry and exact combined quality still need verification.
- **Stale action boundary**: a rewind message names the session whose
  transcript supplied the selected prompt; a side-chat message names the
  session shown when its header button was clicked. If the surface switched
  sessions before or during host work, neither rewind nor side chat may
  clear, replace, or fork the unrelated current session.
- **Focus return**: closing a side-chat tab reveals its original surface if
  that surface is still registered. The registry's active fallback can be a
  different tab, so it is not used as proof that the original closed.
- **Limit**: Muse Code 1.3.0 on Windows refuses forks. On other Muse Code
  platforms the Plan-mode side fork may inherit allow rules; unlike Model
  API Plan mode, it is not certified as strictly read only.

### M53 follow-up — Account & usage reset accuracy

**Status 2026-09-26: integrated in M53 PR #41, merged as `be34ee8`
(tree `5757e29`).** Its seven hosted jobs passed in PR run
`36298748478`; the follow-up used that M53 gate, with no separate hosted
run. Certification record:
`docs/certification/m53-usage-timing.md`.

- Use Muse Code's `usage/read` and `usage/changed` account percentages and
  absolute reset timestamps as reported. Its SDK has one account-level usage
  payload, not model-specific quota or plan-name fields. Meta's public Muse
  Code subscription page publishes an Everyday five-hour allowance, with
  High 5× and Power 20× capacity, but no per-model conversion or weekly reset
  rule. The owner's personal Muse Power/Maximum Upgrade screen is separate
  from Muse Code CLI usage; its weekly token grants do not establish the CLI's
  `usage/read` entitlement. Do not derive countdowns or usage weights from
  either plan table, selected model or opaque MSP tier.
- Recompute visible countdowns while Account & usage stays open, at least
  once per minute. When a reported reset has passed without a newer frame,
  label that row as awaiting fresh usage and hide its old percentage and
  countdown. Retain the observation's age so the user can see why.
- Drop the global last-usage fallback and attempt to erase its legacy stored
  value on activation. Cleanup failure does not block activation because no
  code reads the old value. It has no account identity, so a new sign-in must not inherit
  another account's plan, percentages or reset time. Clear the webview's
  report on authentication changes. An empty `usage/read` also clears a
  same-host observation because the account may have changed. Within one
  live host, prefer the newest `observedAtMs`; an older or empty read begun
  before a newer `usage/changed` must not overwrite that event. Discard
  results from a host stopped or replaced.
- The timer, expired row, authentication boundary and out-of-order delivery
  red drills failed before correction and passed after. Exact integrated
  quality and hosted gates passed before PR #41 merged; the isolated
  checkpoint alone was never used as certification.

### M54 — PDFs and other files as input (D47)

**Status 2026-09-27: merged as PR #42 at `cf33cb2`; all seven hosted jobs
passed (run 36345148020)** (`docs/certification/m54.md`). Live paid PDF
delivery on the Model API is unverified (no key; fake-API tests only).
Conversation rewind of a PDF or named text-file card stays refused until
exact file-byte restoration exists. The paragraphs below are dated
checkpoints from before the merge.

**I/O review work:** Picker reads must share the bounded, single-handle file
reader used by Model API tools, returning the normal oversize refusal even if a
selected local/remote file grows after metadata is checked. Model API
`read_file` must read text, images and PDFs through the canonical path that
passed workspace confinement; a retargeted symlink must not switch the bytes
to a path outside the workspace after the check. Deterministic race tests and
focused quality gates precede the final ordered-tree certification.
The same checked-target rule extends to paid image edit sources (M44) before
the confirmation/API call and to tool-row images (M43). Tool-row image bytes
must share the bounded single-handle reader so growth after metadata cannot
cross the 10 MiB limit. Deterministic link-swap and stale-size red drills
cover these adjacent paths before final certification.
Paid image output reservation and Model API `write_file`/`edit_file` also keep
the canonical target selected at confinement: a link retarget must not create
or edit outside-workspace files between the check and the write. Text-file
cards keep the requested relative path, and unsaved-editor checks cover both
the requested and canonical paths. Link-swap tests must prove the outside
target is untouched and that an unavailable reservation sends no paid call.
The checked absolute path itself can change after confinement if a workspace
directory is renamed and replaced by a junction. Host reads therefore bind
an opened handle to a fresh canonical-path and file-identity check before
returning bytes. Atomic writes recheck the canonical target, parent and
temporary file at the actual write/rename boundaries, including retries;
changed paths fail closed under the approved target. A real junction-swap
drill must leave the outside sentinel untouched for read and write tools.
Paid image output reservations also check the opened file identity before
fill and before release cleanup, so a changed path cannot delete a different
file. The operation-time canonical check is applied only when the trusted
M54 confinement caller passes its checked canonical path; raw memory paths
retain their separate policy, including macOS `/var` to `/private/var`
aliases. Node cannot expose a final Windows path by handle or perform a
handle-relative rename here; adversarial rapid double-swaps remain outside
these observed-change checks and are not claimed as sandbox protection.
The indexed UTF-8 native picker forwards that proof through FileAccess to its
bounded read after the index check. Native PDF and image picks retain their
existing unrestricted local-path policy. The tool-row image preview adapter
forwards the same proof from workspace confinement to its bounded read.
Picker file-size admission follows bytes, not a misleading suffix: peek only
the first PDF-header window on the already-open handle, then read a detected
PDF up to the document limit or non-PDF bytes up to the selected image/text
limit; a `.pdf` name retains its document cap and invalid-PDF refusal.
An unindexed or outside-workspace text-named file gets only a header probe:
PDF bytes continue on that same handle, while ordinary text stays a mention
without reading beyond that header. Return the detected type even on oversize
refusal so Muse Code gives
its PDF-specific backend reason. Keep private-name, indexed-text, checked-path
and conversation-generation checks before any attachment is retained.
Browser paste/drop admission also peeks the bounded PDF header before applying
the image cap to a file whose MIME and name claim image content. A real PDF
named `.png` uses the 32 MB document limit and PDF media type; a non-PDF image
over 10 MiB is refused without full-file encoding. Preserve the existing
aggregate encoded-media and in-flight reservation checks before encoding, and
drop an asynchronous header result after the conversation changes.
For text-named files, a drop is similarly probed; a paste is probed only when
the clipboard has no plain text to insert. An ordinary text paste retains its
native text behavior, and an ordinary text file is not encoded as an image.
Private attachment names are refused before the header is read.

**Prior checkpoints, 2026-09-27: M51–M53 merged; M54 PR review follow-ups.** The
isolated M54 worktree is based on `34002ab`; its pre-M46 50-path staged tree
is pinned at `refs/codex-backups/m54-pre-m46-20260926`. Focused PDF and
replay checks passed; the M47-base reconciliation passed 724 focused
attachment, replay, workflow and backend tests, all five TypeScript projects,
localization and lint. M48–M53 are now merged on main. The combined M54 code
tree `307157a` passed full Windows VM and Mac gates. PR #42 review found
file-card identity and Muse History-resume gaps, so those gates are a
checkpoint only. Corrected code tree `6b18a3e` passed full WIN-11-VM and Mac
gates; a later review found aggregate browser-admission and localized
tool-row gaps, making those gates a checkpoint. Combined code tree `f4b3a3e`
passed full WIN-11-VM and Mac gates. The next review found a stale native
picker and English invalid-file rows, so those are checkpoint gates too;
combined code tree `57a2a96` passed full WIN-11-VM and Mac gates. Its
documentation receipt's local quality and hosted PR CI remain open. A compressed
or encrypted page tree with
unknown count still reserves all 50 image slots (D47).
The raw page-tree inspector also has a fixed candidate limit: excessive
`/Type /Pages` markers return an unknown count and reserve all 50 slots,
bounding host CPU work on a crafted document within the accepted byte cap.
PDF name `#HH` escapes can hide `/Type`, `/ObjStm`, `/Encrypt`, `/Pages` or
`/Count`; comment-separated type/count tokens are ambiguous too. Those page
trees reserve all 50 slots. Tool `read_file` and
the local attachment picker must bind size check and bytes to one open file
and stop after at most the permitted size plus one byte, even if a workspace
file grows or its path is replaced between asynchronous operations. The
picker keeps its existing over-limit refusal and workspace path policy;
text attachments read the canonical target that passed that policy.
Paste/drop admission uses each file's byte metadata and existing plus
in-flight media reservations to enforce the 48-million-character encoded
budget before `blobToBase64`; a refused second large PDF is never loaded or
expanded in the webview. Each admitted browser file carries a request ID
through the host's added/refused result, so only its own reservation is
released; same-name local refusals cannot release an earlier file. Clearing
or changing the conversation invalidates pending reads before they can post
to the new conversation. The host rechecks actual bytes as before.
The native picker captures that same conversation generation before opening
its dialog and checks it after path validation and bounded file reads, so an
old dialog or file read cannot add an attachment or mention after New
Conversation. Its final add remains bound to the captured generation across
the backend lookup. The separate mention QuickPick likewise ignores a choice
that returns after the conversation cleared.
Browser paste/drop encoding also belongs to the conversation in which it
started. Resume, fork and conversation rewind advance the browser attachment
epoch before asynchronous session replacement; the host binds that epoch
before awaiting the backend and refuses older upload messages. Accepted chips
and the draft remain available, while only unfinished encodes are invalidated.
Restored panels report their current epoch on readiness so a host-driven
session replacement can advance the same boundary before History loads.
A delayed or debounced webview snapshot may restore an epoch older than the
host's current session-change guard. `ready` must never lower that host epoch;
the host returns its current epoch in `surfaceState`, and the panel raises its
epoch before admitting fresh files. A held old upload followed by resume or
fork, stale `ready`, and release must be refused; a new upload after sync must
still be accepted.
Host-driven panel and recent-session restore follows the same browser epoch
boundary before its asynchronous resume. A file delivered after session drop
but before the restored History must be refused, while the panel receives the
new epoch in time to accept fresh uploads. Same-session host restart keeps
accepted chips and draft and does not advance this browser boundary.
An edit or paid image approval binds the canonical target it classified;
the executing tool must use that target and refuse if a workspace alias
resolves elsewhere after the card. Paid image sources use the bytes and
canonical paths approved before the card, with no new private-file read or
HTTP request after an alias changes.
File rewind refusal follows the user card's identity, not its turn: a file
steered into a running turn must not block rewind of an earlier text-only
card. Muse Code's durable `displayText` carries an extension-owned readable
text-file annotation; the MSP snapshot mapper keeps the readable line and
rebuilds a file chip on live events and History resume. A malformed
annotation is treated as a file card and cannot enable a lossy rewind.
Before a direct rewind clears or forks, the host checks the card ID, turn,
text and previous distinct-turn cut against served user items; missing or
mismatched evidence refuses the action.
Muse Code `turn/steer` has no captured `displayText` field, so a text-file
message sent while a turn runs is queued through `turn/start`, where MSP
persists this annotation. Text-only steering remains as before. Native Muse
clients and the extension may show the annotation because it is stored in
MSP's display text. This preserves a user-authored identical line; a false
file-chip match can only refuse rewind, never discard the prompt.
After the M54 Stop replay fix, nine focused suites passed 531/531 and all
five TypeScript projects passed on this tree. M54-on-M47 passed full Windows
`npm run quality` on staged tree `9b01560` (see receipt below); that result
does not certify the ordered combined tree. The M51 join passed 533 focused
tests, all five TypeScript projects, localization and duplication. M50 MCP
image output now shares the PDF page/encoded-media budget, and M51 hook stop
paths remove unsent PDF/image bytes from replay without copying those bytes
to hook stdin. The MCP budget and PostToolBatch Stop red drills failed before
their fixes and passed after restoration (`docs/certification/m54.md`).
When a completed Model API request omits older PDF or image parts to fit the
media budget, durable replay adopts that fitted request after delivery; the
saved session no longer retains bytes the model will never receive again.
History keeps attachment names and types. Failed or stopped requests retain
their prior replay state. Rewind of an image card checks the trusted History
attachment count and available replay bytes before clear or fork, including
after resume and when a webview request reports too few images. Model API
send and steer also check the aggregate UTF-8 size of named text file parts
against their separate context allowance before accepting a turn. This
closes the path where text chips admitted under Muse Code are later sent on
Model API without its admission check.
The M51-joined pre-review tree `2903468656a370d7d4c9a821a56421f03bacd287`
passed full WIN-11-VM quality: 2,070 tests, 304 accessibility pages with zero
findings, audit, Gitleaks and Semgrep clean. It precedes the M51 hook-preview
fix and later M54 review work, so it does not certify the final tree.
Independent review built a valid 50-page PDF with its real page tree in an
object stream and an unlinked visible one-page tree. The bounded raw scanner
had returned one page, underweighting the request. A red test reproduced it;
the parser now reserves all 50 slots when object streams or encryption could
hide the real tree. That review tree still needed a fresh gate.
The M52-joined staged tree `ad5d89dcd36ffdcf6ead66126bf328fdf3493e60`
passed full local Windows quality before its commit `5487149`: 2,113 unit
tests passed, build and audit clean, accessibility and security gates green.
The M53 join now preserves PDF media in side-fork replay and refuses its
scheduled paid controls in core; 614 focused tests passed. Earlier source
tree `2d2d0dc45b31b8b5dcddad9aeae4ca73b126fe2c` passed exact-tree
Windows VM `npm run quality` and Mac/Kubuntu `npm run quality:gates` after the
indexed text picker and tool-row preview forwarded their checked path proofs.
Review then found that a PDF with an image or text suffix could hit the wrong
read cap before its header was inspected. Corrected source tree
`cdf62eca10d02f089f3fbb4487e00ced496d42fc` passed exact-tree Mac and
Kubuntu `npm run quality:gates`; the Windows VM passed 260 focused native
picker, ToolIo and attachment tests on its runtime-equivalent tree `7f56829d`
(two platform-specific skips). The only 7f-to-cdf change is a test expectation
for macOS canonical `/private/var` paths. The final documentation receipt
was superseded by the browser paste/drop review finding. Final browser and
native picker source tree `2fbb593cd99b54fc786587e6847ee87b2dffd496`
passed exact-tree Mac/Kubuntu `npm run quality:gates`; the Windows VM passed
349 focused Composer, PDF, picker, ToolIo and attachment tests (two skips).
That documentation receipt was superseded by two further PR review fixes:
aggregate named-text steering plus undelivered `read_file` reservations, and
browser upload epochs across session replacement and reload. Corrected staged
source tree `91d0e2751ba0dd4d2dcd510919692a8a0fbebfc5` passed exact-tree
Mac and Kubuntu `npm run quality:gates` (2,344 tests on each); WIN-11-VM
passed 817 focused tests on the same tree. The root checkout passed 817
combined focused tests, all five TypeScript projects, lint, localization,
formatting and duplication. The exact receipts are in `docs/certification/m54.md`.
The documentation receipt tree
`b1d05e85830875a2a6cb5355a42f15cf1c3c7015` then passed full Windows
host `npm run quality`: 2,353 unit tests, 312 accessibility pages with zero
findings, dependency audit, Gitleaks and Semgrep all clean. Its exact log,
tree and process audit are in `docs/certification/m54.md`. The final gate note
is documentation-only; the updated PR head needs hosted CI and review. Live
paid PDF delivery remains unverified; no paid request ran.

- **Goal:** a user can send a PDF to the Model API backend from the picker,
  paste or drop, then see it in the sent card and restored history; the agent
  can read a workspace PDF or image through `read_file` and receive its bytes.
  A bounded UTF-8 file picked from a trusted, indexed workspace can be attached on
  both backends as a named text part; binary files remain path mentions or
  explicit refusals. Muse Code gives a direct refusal for a PDF while MSP
  1.3.0 has no file input part.
- **Research:** Meta's `input_file` example and page, size and image budgets
  in the file handling guide; SDK `TurnInputPartType`; SDK issue #48. No live
  Meta API key is present for a paid live call; test against the fake client.
- **Acceptance:** valid PDF byte signature and bounded page counting; size,
  count, aggregate bytes and backend refusal; composer and history chips;
  exact Responses payload, tool read and replay budget; translated text in fourteen languages;
  meaningful red drills and `npm run quality` green. Record evidence in
  `docs/certification/m54.md` before changing status to certified.
- **Stop edge:** a tool-read PDF or image from a stopped/failed turn is not
  sent again with the next user turn; replay says why its bytes are absent.
- **Remaining ordered checks (M48–M53):** check M48 child-session isolation and
  paid attempt accounting for PDF reads; M49 memory-path protections beside
  named text attachments; M50 MCP image parts in function outputs against
  the same page and encoded-media budgets; M51 hook stops after `read_file`
  and hook previews without media bytes; M52 confirmed paid runs with PDFs
  already in replay; M53 rewind of PDF/text chips and Plan-mode side chats
  with inherited PDF context. M52 confirmed paid replay and M53 side-fork PDF
  replay now have focused tests on the staged join. Conversation rewind of a
  PDF/text card is explicitly refused until exact file-byte restoration is
  available. The other cross-checks,
  exact-tree quality and browser gates still precede final certification.
- **Kubuntu exact-tree gate attempt:** the private `10.10.11.212` checkout of
  staged tree `7cd2d8d` passed `npm ci`, then `npm run quality:gates` stopped
  at its first step: Prettier flagged one formatting line in
  `test/unit/modelApiHost.test.ts`. Later gates did not run. The test line is
  formatted in the next staged tree; its remote gate rerun is pending.
- **Second Kubuntu attempt:** staged tree `8c4f36d` passed formatting, then
  stopped at JS lint: the new held-PDF test used the forbidden
  `Promise.withResolvers<void>()` type. Later gates did not run. The test now
  uses the existing `<undefined>` and `resolve(undefined)` convention; a new
  exact-tree gate rerun is pending.
- **Third Kubuntu attempt:** staged tree `ed1035b` passed formatting, lint,
  all five TypeScript projects, localization, dead-code and cycle checks.
  Duplication then found the repeated next-turn assertions in M54's two
  Stop/PDF tests. Their shared request step now lives in one test helper;
  the remaining gates and a new exact-tree rerun are pending.
- **Fourth Kubuntu attempt:** staged tree `a1731ff` passed
  `npm run quality:gates` (exit 0): 1,724 tests passed, 7 skipped, no
  duplication or localization issues, and no audit advisories. This is
  M54-on-M47 Linux gate evidence only. PowerShell analysis was skipped on
  Linux; browser/accessibility, secrets/SAST, live Model API and M48–M53
  ordered-integration gates remain open. The receipt in the docs was added
  after the tested tree, so it is not a claim about a later combined tree.
- **WIN-11-VM full gate:** staged tree `9b01560` passed literal
  `npm.cmd run quality` on `10.10.11.183` (Windows npm entrypoint, exit 0):
  1,728 tests passed, 3 skipped; 280 accessibility pages had zero rule
  violations; PSScriptAnalyzer, Gitleaks and Semgrep found zero issues.
  A first runner invocation of `npm` was blocked by PowerShell's
  `npm.ps1` execution policy and falsely appeared to exit 0; it ran no
  gate and is not counted. The real gate log, independent remote exit 0,
  unchanged tree and post-gate process audit 0 are in `m54.md`. The green
  receipt is a later docs-only edit, and M48–M53 integration plus live Model
  API verification remain open.

### M55 — Install and sign in from the panel (D36, M41)

**Status 2026-09-27: merged as PR #43 at `0cf5e7e`, with the review fix to
the sign-in reducer (`e489ed8`: a device sign-in started from a live Model
API session keeps that session until it succeeds). All seven hosted jobs
passed on head `d50ce40` (run 36346755802) and again on the review fix
(run 36348351793). A live Meta install and a completed device sign-in are
owner steps.** Ships in 0.9.0 (`docs/certification/m55.md`).

Earlier checkpoints (historical): the full gate passed on the then-final
tree (2,454 tests, 328 accessibility pages, the host bundle 593.5 KiB within
D6) before the PR review. The staged implementation was reconciled onto
merged M47 main `34002ab` with 449/449 focused tests passing across ten
files; the pre-move stage is pinned at
`refs/codex-backups/m55-pre-m47-20260926`. Full quality, visual and real
installer/sign-in gates remain open. A focused M55 audit on that M47 base
replaced the inline installer confirmation group with the existing accessible
modal, including an inert background. It also resolved the credential-write
versus Cancel/timeout race. Meta's current Muse Code overview documents
`irm https://dev.meta.ai/install.ps1 | iex` on Windows and
`curl -fsSL https://dev.meta.ai/install.sh | sh` on macOS/Linux. The panel
will display the exact platform command and ask for confirmation before opening
a visible terminal to run it. It will recheck the known CLI locations and offer
sign-in when the binary appears; a timed out install remains retriable.

**Follow-up acceptance, 2026-09-26:** A signed-out or signing-in panel with
a saved transcript keeps that transcript available and shows its sign-in and
device-code controls in a visible, accessible banner. Account & usage offers
CLI installation while a Model API key is stored, without changing the live
Model API backend during the installer watch, and offers adding or replacing
the stored Model API key while Muse Code is signed in, without restarting its
session or making a paid call. After an install, the same panel can start Muse
Code browser sign-in; the key stays only in SecretStorage. M52's stale
schedule/account display and M53's side-chat replay remain cross-milestone
join checks, not claims certified by this milestone.
The follow-up's red-first App/Auth cases failed 5/5 on the earlier staged
behavior; after implementation three focused suites passed 115/115, all three
affected TypeScript projects and localization passed, and 32 English/pseudo
targeted accessibility pages across four themes had zero violations. Full
quality and live installer/sign-in proof remain open (`docs/certification/m55.md`).
Final focused regression passed 458/458 tests across nine discovered suites,
with host/webview/unit typechecks, localization, scoped lint and the dev build
green; this remains scoped evidence, not the full quality gate.
The first isolated Mac Node 22 `quality:gates` run on staged tree `13b2f8c`
stopped at one duplicated App test setup; earlier gates passed, later gates
did not run. The shared `/usage` test helper made local `npm run duplication`
pass with zero clones. Mac `quality:gates` then exited 0 on the corrected
staged source tree `f2557f66`: 1715 tests passed, 7 skipped, 0 dependency
advisories and production bundles within budget. Full browser accessibility,
integration, Windows PowerShell lint and live installer/sign-in remain open.
M55 auth safety QA also covers an unsuccessful CLI device sign-in started from
a live Model API key session: Cancel, timeout, refusal or launch failure must
restore that session rather than leave a valid key marked signed out. No key
is passed to the temporary Muse Code host, and no paid request is implied by
the sign-in attempt. A cancelled flow must not publish a late device code.
If VS Code cannot open the installer terminal, the panel must report that
launch failure distinctly from a CLI-discovery timeout, while preserving an
active Model API session. An installer watch that finishes after sign-out must
derive the current credentials and must not restore the earlier signed-in
state. An installer timeout or terminal failure during sign-out or a retained
logout hold must not republish a signed-in status from raw credentials; a
watcher started before sign-out stops at the changed sign-out generation. A
browser sign-in click paused on a SecretStorage read before a newer sign-out
must not start its device flow afterward; a fresh click while held still may
recover a newly written CLI credential under the rules below.
An API-key prompt open in another panel when sign-out starts must not store a
late key. Sign-out waits for any SecretStorage write already underway before
clearing the key, and for any already-started key sign-in backend restart
before ending sessions; neither may publish a signed-in state afterward.
Sign-out must still end the extension host and clear its stored key if the
visible `muse logout` terminal cannot open. A CLI credential file may remain
until that terminal command finishes, and an inherited or configured
`META_API_KEY` cannot be revoked by `muse logout`. Keep the extension gated
and show that remaining-credential condition on refresh; never turn it back
to signed-in merely because the same credential is still present. Persist
only a boolean logout hold in VS Code's extension-private local global state
so a window reload cannot reassert sign-in. An ended extension session reports
signed-out with explicit remaining-credential detail; a later refresh stays
gated as an error until the CLI credential disappears or a new CLI sign-in
explicitly succeeds **without** `META_API_KEY` in the CLI environment. Meta's
[auth guide](https://dev.meta.ai/docs/muse-code/auth) says that environment
key overrides browser sign-in and `muse logout` cannot unset it; do not let a
browser approval silently re-enable key-billed CLI use. Do not remove a user
environment variable or log its value.
The host selector must refuse a held or otherwise unsigned auth state before
and after its asynchronous raw credential check; raw `META_API_KEY` or a file
alone must never create a host. If VS Code cannot persist the logout hold,
the extension must still close the host and show an error instead of claiming
sign-out finished; a new activation cannot safely infer consent from the
remaining raw credential.
After a held refresh sees credentials disappear, it must derive backend facts
again before publishing a signed-in state; the earlier snapshot may be stale.
If a host finishes opening after sign-out revokes admission, close that owned
host before refusing the request.
Backend kind alone cannot bind admission: sign-out followed by a fresh sign-in
to the same Model API kind must invalidate a host selection started before
sign-out. An in-flight session opening or send captures the auth and
conversation generation before its first await, then refuses and preserves
the draft and attachment chips if sign-out, account replacement or New
Conversation occurs before the host or session opens. Close a stale host;
never send the old prompt under the new key.
Recovery from a held old CLI credential file may start an explicit browser
device flow only when `META_API_KEY` is absent and the extension key was
cleared; accept it only after a new credential-file modification is observed.
(Amended 2026-09-27, D26: accept it only once the CLI confirms the new
sign-in; `muse logout` never removes the file, so "remains" means the CLI
still reports a sign-in.)
Sign-out must publish a gated state and start ending attached sessions before
awaiting global state or SecretStorage. Other panels must not send a paid
child follow-up or similar session action during that wait. A rejected
SecretStorage key deletion must still end the host, keep the hold, and report
an actionable error rather than leaving a signed-in turn running.
Two panels may request sign-out concurrently. Treat those requests as one
operation or keep admission blocked until the final sign-out settles; an
earlier caller's `finally` must not release the hold while another stop or
credential clear is pending.
Model and skill catalogues are scoped to the attached session and backend.
Dropping a session clears those cached choices; an asynchronous list begun
under the old session cannot publish after sign-out, New Conversation or a
backend/account switch. A fresh session must fetch its own catalogue even if
an older list is still in flight. An attach delayed in effort setup must
not start old-session skill loading after its generation was revoked.
The M52 account-switch fix clears visible schedules when the Model API key is
replaced; verify it on the ordered M55 join.
Model API conversations also belong to the key that created them. Persist a
nonreversible key digest with each session and expose, resume, read or fork it
only for that same digest. A stored session without ownership metadata stays
on disk but is not admitted: its owner cannot be proved. Replacing a key must
not resume the prior key's session or send its replay under the new key;
History must omit the prior key's sessions. Check the owner again after
asynchronous storage reads. Stop an active old-key turn before replacing its
SecretStorage value so a later tool round cannot pick up the new key. Clear
the panel's old History rows and reject a list reply arriving after the
host stopped. Prove key A to key B with fake keys and zero B requests
containing A's conversation.
On the Muse Code backend, replacing only the secondary Model API key keeps
the subscription conversation running. An extension-owned paid image tool
captures the key generation and digest before its confirmation; a changed
key refuses purchase and every retry before HTTP, without restarting the CLI.
Auth transitions also clear rendered private transcript, output pages and
child transcripts before a new account can see them, while a local unsent
draft remains available. Retained image/file chips and in-flight browser
reads from the prior account are discarded. Reads, History events and session adoption begun
under a stopped host cannot publish old-account content after sign-out.
An account-ending stop detaches this surface's session and closed-session
listeners before awaiting turn cancellation, and queued callbacks check the
session generation. A rename reply held across that stop cannot restore the
former account's title. Other surfaces keep their own listeners until their
own stop, and the stopped turn still receives its local cancelled end. A
`view/gap` history read begun before account stop checks that generation
after every await and cannot refill the cleared panel or post a stale notice.
A surface reloaded during the cancellation wait receives no prior session id,
model or skill catalogue; its saved old-account transcript is invalidated
even when same-kind Model API sign-in follows.
The saved webview snapshot is untrusted until both the live session and
signed-in account are confirmed. Its private title and transcript cannot
render in the connecting/checking shell. A signed-out result clears the
snapshot even when the prior local auth state was only `checking`; a
transient CLI sign-in while the Model API conversation remains live may keep
that already-confirmed conversation visible.
The explicit account-boundary clear is immediate even before the next auth
reply: gate the panel as checking and discard the old usage report, model and
skill catalogues, History archive ids, editor context, mention results and
pending announcement or insert. Keep the unsent local draft. Invalidate a
local quote selection when the conversation changes.
All new session actions use the auth service's admitted backend, not only its
visible signed-in label, and refuse while an account stop is in flight.
Actions already started carry the session and stop generation through their
awaits: stored output and edit review, rewind/side fork, goal and subagent
commands, compaction, and paid scheduled-run confirmation cannot act on the
prior account after that boundary. Paged output stays bound to one session.
Selecting a manager-cached host never closes that borrowed live host merely
because the secondary key changed. Installer discovery in auto mode must
retire the former backend's active session before a newly selected CLI host
is used, then start the next send on the selected backend.
The QA fixes passed 164/164 focused fake-host/fake-CLI tests across eight
suites, host/webview/unit typechecks, localization, scoped lint/format and
zero-duplicate checks. Mac `quality:gates` exited 0 on the pre-documentation
QA staged tree `ed5d2926`: 1723 tests passed, 7 skipped, zero clones and zero
advisories. This receipt was documented afterward; M48–M54 joins and the final
integrated tree need their own gate.

M55 provisional tree `eb30d625` passed Linux and Mac `quality:gates` and
WIN-11-VM full `quality` before later PR #42 review found two more source
issues in M54. These are pre-review checkpoints, not certification of the
final joined tree. Exact receipts are in `docs/certification/m55.md`; final
M54 ancestry, M55 gates and live installer/device approval remain open.

Frozen M54 follow-up tree `f4b3a3e` was layered onto the isolated M55
stage without changing M55 auth source or its earlier gate receipts. The
31-path join passed 633 focused tests across nine suites, five TypeScript
projects, localization across fourteen tables, scoped formatting and lint,
and duplication with zero clones. Those checks are provisional; new exact-tree
Linux, Mac and Windows gates remain required after final M54 ancestry.

Frozen M54 tree `57a2a963` was then layered onto this isolated M55 stage
with its native-picker generation guard and localized visual-read failures.
The 23-path join kept M55 auth source unchanged. Ten selected new
regressions, five TypeScript projects, fourteen localization tables, scoped
ESLint and duplication passed. The earlier `80af642a` WIN-11-VM quality run
was interrupted at accessibility after review found these issues; it has no
quality result. This new tree still needs exact cross-platform gates after
M54 final ancestry and live installer/device approval.

The `a09eac30` Windows host full quality gate completed exit 0 before a
stop request reached it, but a later PR #42 review found two more M54 source
issues; that run is a green checkpoint, not final M55 certification. The
24-path frozen M54 tree `b770bd6a` was then layered onto this isolated M55
stage without changing its auth source. Four affected suites passed 415/415,
all five TypeScript projects, fourteen localization tables, scoped ESLint
and duplication passed. Final exact-tree gates remain open.

PR #42 commit `5292d4a` records the corrected M54 `b770bd6a` Windows VM
and Mac code-tree gates in `m54.md`. The isolated M55 branch now follows
that commit; only receipt documentation changed from its prior staged tree.
Its source still needs M55-specific exact-tree quality after PR #42 review
and merge.

The fifth PR #42 review follow-up, frozen M54 tree `75b30e59`, is now
provisionally layered onto M55's backed-up `bdba7726` stage. Its 27 changed
paths add the Model API named-text context allowance, send/steer admission,
durable media pruning after a completed response, and a History-bound image
rewind guard. The M55 auth implementation remains in place; this combined
source checkpoint was `e0207e2a` before its documentation receipt. M54
VM/Mac gates certify M54 alone. M55 exact-tree quality, PR #42 final
review/merge, and live installer/device approval remain open.

PR #42 fifth-review receipt commit `a228787b` now anchors the isolated M55
branch. Its only change from frozen M54 code tree `75b30e59` is the M54
Windows VM/Mac gate record. M55's prior staged tree `589d5646` was backed
up, and the branch head moved to that commit without changing staged
source, tests, translations or scripts. The M54 certification file now
matches the commit. PR #42 hosted review/merge, M55 exact-tree quality and
live installer/device approval remain open.

The sixth PR #42 review delta from `a228787b` to frozen M54 tree
`639bf222` is provisionally layered onto the backed-up M55 `f531774e`
stage. The ten changed paths add Muse Code attachment admission after a
backend switch and stop stale sends before submission or after a late
acknowledgement, while retaining owned session recovery. M55 authentication
source/tests remain intact; the combined source checkpoint was `ac558296`
before its documentation receipt. M54 platform gates on this code tree,
PR #42 final review/merge, M55 exact-tree quality and live installer/device
approval remain open.

PR #42 sixth-review receipt commit `bd667e46` now anchors the isolated M55
branch. Its only difference from frozen M54 code tree `639bf222` is the
Windows VM/Mac gate record. The prior M55 stage `a54ccfaa` was backed up;
the soft anchor preserved its source, tests, translations and scripts.
The M54 certification file now matches the commit. PR #42 hosted
review/merge, M55 exact-tree quality and live installer/device approval
remain open.

The seventh PR #42 review delta from `bd667e46` to frozen M54 tree
`423ef6f5` is provisionally layered onto the backed-up M55 `8d08b889`
stage. Eight changed paths add page-slot admission for same-round visual
reads and preserve specific localized attachment refusal banners. M55 auth
source/tests remain intact; the combined source checkpoint was `220d9ee0`
before its documentation receipt. M54 platform gates on this code tree,
PR #42 review/merge, M55 exact-tree quality and live installer/device
approval remain open.

PR #42 seventh-review receipt commit `97a13326` now anchors the isolated
M55 branch. Its only difference from frozen M54 code tree `423ef6f5` is
the Windows VM/Mac gate record. The prior M55 stage `1b9e5981` was backed
up; the soft anchor preserved its source, tests, translations and scripts.
The M54 certification file now matches the commit. PR #42 hosted
review/merge, M55 exact-tree quality and live installer/device approval
remain open.

The eighth PR #42 review delta from `97a13326` to frozen M54 tree
`53237394` is provisionally layered onto the backed-up M55 `eeaf355a`
stage. Six changed paths reserve visual MCP tool output, queued `read_file`
media and accepted steering together until first delivery. Stop or failed
delivery removes undelivered output images from replay. M55 authentication
source/tests remain intact; the combined source checkpoint was `c4d4a50d`
before its documentation receipt. M54 platform gates on this code tree,
PR #42 review/merge, M55 exact-tree quality and live installer/device
approval remain open.

PR #42 eighth-review receipt commit `e8974ee3` now anchors the isolated
M55 branch. Its only difference from frozen M54 code tree `53237394` is
the Windows VM/Mac gate record. The prior M55 stage `43789177` was backed
up; the soft anchor preserved source, tests, translations and scripts.
The M54 certification file now matches the commit. PR #42 hosted
review/merge, M55 exact-tree quality and live installer/device approval
remain open.

For sign-in, the panel uses the experimental MSP `account/loginStart` device
flow, with code and browser link visible in the panel, Cancel, and credential
file observation. The isolated 1.3.0 capture `scratchpad/m55/capture-m55.jsonl`
showed `account/read` logged out, `loginStart {type:"deviceCode"}` returning
`verificationUrl` and `userCode`, `loginCancel` returning `cancelled`, and a
`loginCompleted` cancellation notification. It did not capture a successful
sign-in; success must be proved by a credential file change and the backend's
refresh, not a guessed notification shape. The Model API key continues through
SecretStorage and is never given to `muse serve`. (Amended 2026-09-27, D26:
`account/read`, whose shapes were captured on 2026-09-27, decides a
sign-in, with the file change as the second signal. The PR #49 captures
added `expired`, 600 s after `loginStart`, then `granted`, `denied` and
`failed` to the captured endings; `granted` came after both signals, so
it is not one of its own, except with no first `account/read`, where
`granted` borne out by `account/read` counts.)

**Acceptance:** no installer or login starts without its button; installer
command is fixed, shown before confirmation, and runs in a visible terminal;
duplicate clicks start one watcher; install detection leads to sign-in; device
code and URL are schema-checked before display; Cancel also works during
the temporary host handshake, closing that process without starting login;
cancel and timeout close the temporary MSP process; a file change yields a refreshed signed-in state; unit
tests, red drills, accessibility and `npm run quality` pass before certification.

**Host bundle budget (D6), 2026-09-27:** the C# the Windows job helpers
share ships as `native/windows/MuseSparkMcpJob.cs` and is read when a helper
is first built, instead of riding in the host bundle as a 12 KiB string;
`dist/extension.js` went from 605.5 KiB (over the 600 KiB budget) to
593.5 KiB. The budget is unchanged.

### M56 — Enterprise network and posture (D43)

**Status 2026-09-27: built, and joined onto M55 as branch
`codex/m56-enterprise-final`. Its commit `f7dc40f` sits on
`codex/m55-install` `b98c05b`. A merge then brings in M55's `d50ce40`, which
carries main's merged M54 (PR #42, `cf33cb2`). Both trees passed local
`npm run quality`, and the receipts are in their commit messages. M55's
review fix and main after PR #43 (`0cf5e7e`) are merged in, and that tree
passed `npm run quality` too (2,497 unit tests passed, 5 skipped; 328
accessibility pages; `dist/extension.js` 596.7 KiB). Merged as PR #44
(`890e37b`) after all seven hosted jobs passed (run 36350220096, the Windows
job on its second attempt); ships in 0.9.0. Still open: live proof behind a
real enterprise proxy with a private root, including Muse Code's IDE route**
(`docs/certification/m56.md`, "Final join onto M55").

That join keeps M54's and M55's records as they were. It restores
`docs/certification/m53.md` to M55's copy, and it corrects the certificate
advice to what the Kubuntu drill proved: `NODE_EXTRA_CA_CERTS` helps only
with `http.systemCertificates` off. It also brings `dist/extension.js` from
601.6 KiB to 596.7 KiB under the unchanged 600 KiB budget (D6). To do so,
the shell job type and the MCP launcher's C# ship as `.cs` files beside
M55's shared half, and the two helpers share one copy of their build steps
(`jobBuild.ts`). The paragraphs below record the provisional joins that led
here. Claude's original
worktree left two failed quality runs. The isolated M56 tree builds on merged
main `34002ab`; its pre-M47 stage is pinned at `refs/backup/m56-before-m47`.
The staged tree `0b83645791fc43608cda0f569505cb8bd560661f` passed
`npm run quality` on a separate Windows 11 VM checkout: 1,721 unit tests
passed (3 skipped), 280 accessibility pages returned results with zero
violations, and security scans found no leaks or SAST findings. The VM
process audit found no remaining M56 checkout or accessibility Chrome
process. This receipt covers that exact tree before the later documentation
and proxy-validation fix. The combined staged tree
`5619bd599df00b8a470a63582aec904056a2ae49` then passed full local
Windows quality with 2,209 unit tests, accessibility and security gates
green, and no owned test processes left; commit `90308c1` matches that tree.
The M51 PR #39 and M53 PR #41 review fixes are joined. M54 frozen code and
M55's sign-out, account-isolation and catalogue fixes are joined provisionally;
M55's current independent review fixes, final receipts and merged ancestry
must precede M56's exact-tree local and hosted checks. A live
enterprise proxy with a private-root certificate remains open.

An isolated Kubuntu drill on staged tree `8300ddaa` exercised production
`liveFetch` and `withLoopbackBypass` through Node's environment-proxy
support, a local authenticated CONNECT proxy and a temporary private CA.
The success, missing-CA, 407 and loopback outcomes are recorded in
`docs/certification/m56.md`. This is a local simulation, not VS Code
extension-host or Muse Code IDE-route proof; an actual corporate proxy and
private-root end-to-end check remains open. No model or paid call ran.

A second isolated Kubuntu drill on staged tree `8e1d9cc` ran the actual
extension in VS Code 1.130.0's Extension Development Host. Its production
`liveFetch` reached a loopback-only HTTPS origin through a local authenticated
CONNECT proxy and temporary private CA, with VS Code configured for that
proxy and `http.systemCertificates: false` plus process-local
`NODE_EXTRA_CA_CERTS`. Missing the CA failed TLS verification. With
`http.systemCertificates: true`, that same process-local CA did not make the
request pass in this setup. A network namespace had only loopback and no
routes; no real Meta, model or paid traffic was possible. This proves that
local extension-host path under the stated settings, not a real corporate
proxy/root or Muse Code's IDE MCP route; those checks and exact-tree full
quality remain open (`docs/certification/m56.md`).

The fifth PR #42 review delta from head `5292d4a` to frozen M54 tree
`75b30e59` was layered onto the backed-up M56 `f6a63e62` stage. The M54
certification conflict kept the complete newer M54 receipt; the constants
conflict kept both M56 prompt-cache controls and M54's Model API text limit.
The combined source checkpoint was `43d02269` before its documentation
receipt. M55 authentication and M56 enterprise implementation remain in
place. M54 platform gates on `75b30e59` certify only M54; M56 exact-tree
quality, final M54/M55 ancestry, and live enterprise proxy/private-root
proof remain open.

PR #42 receipt head `a228787` has the same source, tests and localization
tables as frozen M54 tree `75b30e59`; it adds the fifth-review platform
receipt to `docs/certification/m54.md`. The M56 staged source tree was
preserved exactly while moving its HEAD from `5292d4a` to `a228787`, then
the exact M54 receipt blob was adopted. M55 sign-in and M56 enterprise
changes remain staged. This anchor does not certify the combined M56 tree;
its final M55 ancestry, exact-tree gates and live enterprise proof remain open.

The sixth PR #42 review delta from head `a228787` to frozen M54 tree
`639bf222` was layered onto the backed-up M56 stage `b53293c3` without
conflicts. It adds the reverse Muse Code attachment-budget guard and the
Model API stale-send and late-ack fences. The ten-path patch can be reversed
against the combined staged tree, and all other source paths retain their
pre-join blobs. M55 authentication and M56 enterprise changes remain staged.
The M54 code-tree evidence applies only to M54; final PR #42/M55 ancestry,
M56 exact-tree quality and live enterprise proxy/private-root proof remain open.

PR #42 receipt head `bd667e4` has the same source, tests and localization
tables as frozen M54 tree `639bf222`; it adds only the sixth-review platform
receipt to `docs/certification/m54.md`. The M56 staged source tree was
preserved exactly while moving its HEAD from `a228787` to `bd667e4`, then
the exact M54 receipt blob was adopted. M55 sign-in and M56 enterprise
changes remain staged. This remains a provisional ancestry checkpoint;
combined M56 exact-tree gates and live enterprise proof are open.

The seventh PR #42 review delta from head `bd667e4` to frozen M54 tree
`423ef6f5` was layered onto the backed-up M56 stage `5fba42e1` without
conflicts. It adds the Model API tool-read PDF page-slot queue guard and
keeps known localized attachment refusals visible in the composer. The
eight-path patch passes a cached reverse check against the combined stage;
all other paths retain their pre-join blobs. M55 sign-in and M56 enterprise
implementation remain staged. This provisional source join still needs
final PR #42/M55 ancestry, M56 exact-tree gates and live enterprise proof.

PR #42 receipt head `97a1332` has the same source, tests and localization
tables as frozen M54 tree `423ef6f5`; it adds only the seventh-review
platform receipt to `docs/certification/m54.md`. The M56 staged source tree
was preserved exactly while moving its HEAD from `bd667e4` to `97a1332`,
then the exact M54 receipt blob was adopted. M55 sign-in and M56 enterprise
changes remain staged. This ancestry checkpoint still needs final PR #42/M55
joins, combined M56 gates and live enterprise proxy/private-root proof.

The eighth PR #42 review delta from head `97a1332` to frozen M54 tree
`53237394` was layered onto the backed-up M56 stage `0b6923d2` without
conflicts. It reserves current-batch tool output, queued file and accepted
steer media together until first delivery; Stop and failed requests scrub
undelivered output images. The six-path patch passes a cached three-way
reverse check. M55 sign-in and M56 enterprise code remain staged. This
provisional source join still needs final PR #42/M55 ancestry, M56 exact-tree
gates and live enterprise proxy/private-root proof.

PR #42 receipt head `e8974ee` has the same source, tests and localization
tables as frozen M54 tree `53237394`; it adds only the eighth-review
platform receipt to `docs/certification/m54.md`. The M56 staged source tree
was preserved exactly while moving its HEAD from `97a1332` to `e8974ee`,
then the exact M54 receipt blob was adopted. M55 sign-in and M56 enterprise
changes remain staged. This ancestry checkpoint still needs final PR #42/M55
joins, combined M56 gates and live enterprise proxy/private-root proof.

- **Goal**: route the panel through VS Code's proxy and certificate support
  and Muse Code through its documented environment, expose the posture
  switches `muse serve` has, and show managed-configuration status; key the
  Model API's prompt cache as Meta documents.
- **Research first**: VS Code 1.125.0's `proxyResolver.ts` and the shipped
  1.139.0 extension host (the extension's `fetch` and WebSocket already go
  through VS Code's proxy and certificate support); Node 24's failure
  shapes, captured; Muse Code's proxy and certificate variables from its
  binary and a recording proxy; `muse serve --help`, a wrong
  `--sandbox-network`, and four MSP probes of `--no-session-log` (one turn
  on the contributor model, 26 model attempts; the rest no model call);
  `muse config status`; Meta's prompt-caching guide and pricing.
- **Scope**: `liveFetch`; validated VS Code proxy settings at the Muse Code
  child-process boundary; network failures described with their fix;
  loopback in Muse Code's `NO_PROXY` whenever it has a proxy (a fix);
  `museSpark.sandboxNetwork` (machine-scoped, restart on change);
  Diagnostics' network lines and known-safe `muse config status` fields; the
  approval-ceiling refusal as a sentence; `prompt_cache_key` per prefix and
  `museSpark.modelApiPromptCacheRetention` (machine-scoped, in memory by
  default); five UI strings and eight
  manifest strings in fourteen languages; README (Settings, Proxies and
  certificates, Privacy and security, Troubleshooting), PRIVACY, CHANGELOG.
- **Acceptance**: tests from the captured shapes and drills N1–N20 passed;
  the join onto M55 added the job-source contract test and drills N21–N25,
  and its exact tree passed local full quality. Merged as PR #44
  (`890e37b`, run 36350220096, seven jobs green); live enterprise-network
  proof remains open.
- **Left**: `--no-session-log` until Muse Code serves a memory-only host's
  view over MSP (an upstream report, D43); Muse Code's own
  `endpoint_transport.proxy` is the user's to set in its settings file. No
  enterprise proxy with authentication and a private root has been exercised
  end to end; routing and failure messages have local capture evidence only.

### M58 — A popup before every paid use (D48)

- **Goal.** The owner's rule of 2026-09-27: every paid use asks in a popup
  with Allow once, Allow always in this workspace, or Deny.
- **Scope.** `PaidUseConsent` and its grants; `askPaidUse`; the Model API
  host's image, child-task and web search paths; the controller's Muse
  Voice start and scheduled run; the Muse Code `ide` image tools; Account &
  usage's "always" state and **Ask again every time**; the badge's tooltip;
  the removal of the paid approval card.
- **Files.** `src/core/paid/paidConsent.ts` (new), `src/host/paid/paidHost.ts`,
  `src/core/backends/modelapi/ModelApiHost.ts`, `permissions.ts`,
  `imageGeneration.ts`, `src/host/conversation/conversationController.ts`,
  `src/extension.ts`, `src/shared/{paid,protocol,agentEvents,constants}.ts`,
  `src/webview/{App.tsx,components/ApprovalCard.tsx,components/UsageDialog.tsx}`,
  the 14 UI and manifest tables, the harness (`paid-always` added; the three
  paid card scenarios now show the row while the popup asks).
- **Acceptance.** Each paid use asks once per use (web search once per
  prompt), in every mode; Deny bills nothing; "always" stops the asking in
  this trusted workspace only, lapses on a price-acceptance change, and is
  taken back by Ask again; a protected image target and a hook demanding a
  question ask anyway; no paid card remains.
- **Tests.** `paidConsent.test.ts` (new), `paidHost.test.ts` and
  `scheduledRunConfirmation.test.ts` (rewritten for the popup),
  `modelApiHost.test.ts` (image, child-task and web search paths),
  `conversationController.test.ts` (Muse Voice), `UsageDialog.test.tsx`.
- **Gates.** `npm run quality`; drills recorded in
  `docs/certification/m58.md`.
- **Docs.** README (Paid features, settings table), PRIVACY, SECURITY,
  AGENTS rule 12, CONTRIBUTING, CHANGELOG.
- **Security.** Grants hold feature names only; untrusted workspaces never
  offer or honour "always"; settings stay machine-scoped.
- **Status.** Built on `feature/m58-paid-consent` (2026-09-27).

### M67–M85 — Coding quality first (D49, D50)

The program D49 ranks, and D50's M85. Each milestone follows AGENTS.md:
tests first, red drills, docs landing with the change, strings in all 14
tables, and the full gate. A paid item follows D30/D48. New UI gets a
harness scenario, which is what the accessibility gate checks (D32).

### M67 — Code intelligence tools (D49)

**Integration review 2026-09-29:** PR #57's candidate is being joined with
PR #32 before final gates. A Stop during the last awaited check of the first
rename file could still write; the first-write boundary now rechecks cancellation.
The two held-check regression cases, independent review and final local rig
gates are tracked in `docs/certification/m67.md`; no merged status is claimed.

- **Goal.** The model finds definitions, references and symbols the way
  an IDE does, instead of grepping.
- **Scope.**
  - Tools backed by VS Code's language services:
    - `find_definition` and `find_references` (by symbol at a
      path/line/column, or by name);
    - `workspace_symbols`;
    - `document_symbols`;
    - `hover` (types and docs);
    - `rename_symbol`, which is an edit that asks like one: its edit is
      applied file by file through the extension's edit path, so
      confinement, D24's protected-write cards, Edit Review and rewind all
      apply. On Muse Code the `ide` tool does not write: it returns the
      edits, and Muse Code's own edit tool applies them under its
      approvals and rewind;
    - `call_hierarchy` where the language supports it.
  - A compact **repo map**: files ranked by how often their symbols are
    referenced, within a token budget. It is offered as a tool and as an
    opt-in section of the system prompt.
- **Backends.**
  - Model API: native tools.
  - Muse Code: the same tools on the `ide` MCP server as `mcp__ide__*`.
- **Acceptance.**
  - Input paths are confined like the file tools' (D24). Results outside
    the workspace (a library's `.d.ts`, another root) are left out and
    counted.
  - Results are workspace-relative, capped and deterministic.
  - Restricted Mode still allows the read-only tools; `rename_symbol` is
    an edit, so it follows the edit rules there (and on `ide` it only
    returns edits).
  - A language with no provider answers "no language service", not
    nothing.
- **Tests.** A fake language-service host in unit tests. An integration
  test in VS Code over a TypeScript fixture.
- **Size.** M.
- **As built (2026-09-28).** Decisions taken while building, each open to
  the owner's review:
  - **One core, two surfaces.** `src/core/codeIntel/` holds the tools
    (confinement, placing, capping, the repo map, the rename plan) over a
    `LanguageServiceHost` interface; `src/host/codeIntel/languageServices.ts`
    implements it with VS Code's `vscode.execute…Provider`,
    `vscode.prepareCallHierarchy`/`provide…Calls`, `vscode.prepareRename`
    and `vscode.executeDocumentRenameProvider` commands. The Model API
    offers `find_definition`, `find_references`, `workspace_symbols`,
    `document_symbols`, `hover`, `call_hierarchy`, `repo_map`,
    `rename_symbol`; the `ide` server offers the same as `findDefinition`,
    …, `renameSymbol` (the camel case of `getDiagnostics`). The core stays
    outside `src/core/backends/modelapi/**`, since the activation bundle
    carries it for the `ide` tools.
  - **Naming a symbol.** Path, line and column (1-based); path, line and
    name (its first whole-word use on the line); path and name (its first
    use in the file); or name alone, looked up among the workspace symbols
    (exact name, TypeScript's `greet()` read as `greet`; the first in place
    order is used and the others listed).
  - **"No language service".** VS Code exposes no way to ask whether a
    provider exists, and its commands answer an empty list either way. An
    empty answer is therefore checked against the file's document symbols:
    none means "no language service answered for <file> (language <id>)",
    worded to allow for a file that declares nothing; some means "No
    <kind> at <place>". Workspace symbols have no file to check, so an
    empty answer says that they come from the languages' services and that
    TypeScript's needs a project file open.
  - **Placing results.** A result is in the workspace when its path is
    (textual and canonical confinement, D24) or when its real path is under
    the root's real path (a workspace opened through a link, whose files a
    server reports by real path). Everything else, including virtual
    documents, is left out and counted. Lines come from the disk.
  - **Caps.** 100 locations, 200 symbols, 50 callers or callees with five
    call sites each, 4,000 characters of hover, three outline levels; a
    20-second deadline per language-service call.
  - **Rename.** Planned before the card from VS Code's rename edit: every
    file must be placed in the workspace (any outside refuses the whole
    rename), at most 200 files, no file operations, no unsaved changes, and
    the document's text equal to the disk's (BOM aside), so the edit lands
    where the service meant it. On the Model API the card is a `fileWrite`
    naming up to five files and counting the rest, protected when any file
    is (D24); after approval every file is confined and read again and
    nothing is written unless each is unchanged; files are written with the
    tools' atomic write, one patch across them (per-line hunks, which Edit
    Review's revert undoes), and the fingerprints `write_file` checks are
    updated. A failed write stops the rest and names what was written.
    Plan refuses a rename before the language service is asked. On `ide`
    the tool returns a unified diff and writes nothing (read-only). The
    file tools' one-hunk patch (D27's `hunkBetween`) moved beside the
    rename's hunks as `changeHunk` in `codeText.ts`, unchanged, so the two
    share one implementation (the duplication gate).
  - **Repo map.** Aider's idea over VS Code's services: names of three
    characters or more are counted in the text of up to 1,000 listed files
    (128 KiB each, read confined); the 300 names used by the most files are
    looked up as workspace symbols, eight at a time, within 10 seconds (5 for
    the prompt); each file scores the uses of its names by other files,
    shared among a name's definers. Document symbols per file were rejected:
    opening every file would make VS Code open each document for every
    extension (a linter lints them all). The prompt section is opt in
    (`museSpark.modelApiRepoMap`, machine-scoped since it bills prompt
    tokens), made on the first turn that has it on and kept for the session
    so the prompt's prefix stays cached (a Stop ends it at once, and a map
    cut short that way is not kept); Muse Code's instructions are its own,
    so there it is the `repoMap` tool only.
  - **Annotations.** `McpTool` gained `annotations` (as M69 adds it);
    `getDiagnostics` and every code intelligence tool declare
    `readOnlyHint: true`, and all are listed in Restricted Mode.
  - **Tests.** `codeIntelTools`, `codeText`, `renamePlan`, `repoMap`,
    `modelApiCodeIntel`, `ideCodeIntelTools`, `languageServices` (the
    adapter over the `vscode` mock) and `toolPresentation`;
    `test/integration/codeIntel.test.ts` over `test/fixtures/workspace/
code-intel` on VS Code stable and 1.125.0; live case19 of the Model
    API sweep; the `code-intel` harness scenario.
  - **Review round (after `c5c4045b`).** Three class reviews; every
    finding fixed in one commit on a merge of `origin/main` (PR #50):
    - A rename's edit ranges must each cover exactly the old name (the
      text the edit at the position replaces, read from the text the
      position came from), and that file must still be that text: an edit
      the service computed on an older version is refused, never applied.
    - File operations: VS Code's `WorkspaceEdit.entries()` lists only text
      edits and `size` counts them (read from the extension hosts of 1.99.0,
      1.125.0 and 1.139.0), so the old check never fired. The adapter reads the
      internal `_allEntries()` through zod (`_type` 2 is a text edit, 1 a
      file operation); a missing or changed list is `unknown`, refused
      (§8 records the undocumented member).
    - Writing: every file is checked again after the card, then each once
      more right before its own write; a change found partway stops with a
      revertable patch of what was written. Stop before the first write
      writes nothing; once writing starts the rest follow. A failed
      `rename_symbol` row with a patch keeps review and rewind
      (`PARTIAL_EDIT_TOOLS`, `hasLandedEdits`).
    - The prompt's repo map: trusted workspaces only; only a map with text
      is kept, a try that fails or comes out empty counts, three at most
      (`REPO_MAP_PROMPT_TRIES`), and a Stop does not count; child tasks and
      forks use the conversation's. `Limits` takes its Stop listener off,
      begins no work past the budget, and holds the file listing to it; the
      map says how many files it read.
    - Unsaved files: a line number in one is refused; lines shown are the
      editor's, and the answer says so.
    - Hover: held back when every definition is outside the workspace and
      outside the languages' libraries (VS Code's `appRoot` and each
      extension's folder, `LanguageServiceHost.libraryRoots`). Types that
      flow from outside files into workspace symbols remain (§9).
    - Hooks: `rename_symbol` matches `Edit`, and a matching `PreToolUse`
      hook gets the planned `files` (planned for it alone, only when one
      would run and the mode allows edits).
    - Wording: "no language service" allows a file that declares nothing;
      an empty answer says the language may lack that provider; the same
      name, a change after the plan, the header's file name. A rename named
      by symbol alone has no file button. The card names protected files
      first.
    - Captures: live case19 again with a stand-in that skips string
      literals (4 references, 4 edits, the import asserted); and Muse Code
      1.4.0-R4302.1 calling `mcp__ide__findReferences` in on-request mode
      (4 model attempts): it listed our tools with annotations, asked its
      own card for a `readOnlyHint` tool, and showed our text verbatim.
      The README's "reads in every mode" is the Model API's alone.
  - **Second review (Grok Build on `585af100`).** One P1, five P2; all
    held on inspection and are fixed in one commit:
    - Unsaved changes by real path: `ToolIo.unsavedFiles()` lists the
      editors' files, and `unsavedDocumentPath` matches one to a file by its
      own path, the service's, or its real path (a workspace opened through
      a link names files by the link in the editor and by the real path in
      the language service). The plan, the recheck before each write, the
      lines shown and the target all use it; a target is asked and read at
      the editor's own path.
    - Repo map: a batch the time or a Stop cuts off is dropped whole, so
      nothing it finds later reaches the map or its counts; "no language
      service" only when every lookup ran and none found anything, a cut
      map being partial.
    - A rename planned for its `PreToolUse` hooks is the plan written; a
      hook's new arguments plan afresh.
    - Call hierarchy: outgoing call sites name the file of the function
      asked about; of several items at a position the one declared there is
      asked, and the answer counts the others.
  - **Codex on PR #57.** Two P2s, both held and fixed in one commit:
    - The repo map counts every line it renders against its budget (the
      lead, the count of files left out, the notes, and the prompt
      section's heading); `repo_map` refuses a `max_tokens` too small for
      its own fixed text and names the size that would do.
    - `document_symbols` opens and outlines the file at the path of an
      editor holding unsaved changes to it (`openAsEdited`), as the other
      tools do; no other tool opened a named file directly.
- **Status.** Built on `feature/m67-code-intel` (2026-09-28); reviewed and
  fixed the same day. Drills and the live checks in
  `docs/certification/m67.md`.

### M68 — Verify loop (D49)

**Resume integration, 2026-09-29 (source preparation only).** Join M68 and
its reviewed workspace-edit repair onto main `f7db5715` (M79 and PR51 included), preserving
the M67/M69 tools, required MCP cancellation signals, unsaved-file access,
ACP key isolation and the VS Code 1.99/Node 20.18 floor. Move the existing
workspace-edit registry unchanged to a core structural-observer module;
the backend manager owns and injects it before a lazy host can start, so
pending writes reach new conversations and children without loading the
lazy verify ledger in activation or ACP. The ACP runtime shares registries
by an existing canonical directory's native bigint device/inode identity,
refusing unreadable, non-directory or unusable identities. Bind actual tool
and context paths to the immutable canonical root, keep the raw cwd only for
saved-session identity, and fence the raw and canonical roots' captured native
identity before mutations, commands and final publications after awaited
staging. Cached aliases never silently rebind after retargeting. Native alias,
retargeting, directory replacement and distinct-directory
controls remain unverified until the Windows, macOS and Linux rig slot.
Rename begins notices for every
planned canonical/alias path before rechecks, records only successful
writes in the originating session, and completes all notices in finally.
Keep the current first-write Stop guard. M79's plan publication brackets each
checked create attempt with shared notices, records only a true new-file result
in its captured live Model API owner, and always completes in finally. A changed
conversation never becomes the saved plan's invented owner. Preserve M79's
owned-stage cleanup with M68's conditional writer. M77's winner-apply binding
remains a later integration seam. No verifier or certification claim is made
during preparation. The frozen behavior tree `1c3dbea9` has current host,
unit, e2e and webview types, scoped lint and the normal duplication gate all
at exit 0. Fifty-two bounded acceptance tests passed before and after 16
deliberate production failures; every mutated source hash restored exactly.
Fifteen failures reached intended assertions, and the lazy-injection failure
reached its exact subscription-contract TypeError, labeled separately.
The host API inventory regenerated successfully. Full exact-tree quality,
independent staged review, installed ACP/VS Code and native rig controls
remain required; this evidence makes no live-model or full-rig claim.

- **Goal.** Every edit is checked, and the model sees the result without
  asking.
- **Scope.**
  - After a tool round that edited files, the next request carries the
    new diagnostics of those files: errors and warnings, capped, with
    changes against the previous round.
  - An optional **format on edit** runs VS Code's formatter on edited
    files.
  - **Check commands**: `museSpark.checkCommands` (lint, test,
    typecheck), machine-scoped, run as the shell tool runs commands (in a
    job object on Windows, M27; there is no sandbox on the Model API).
    - They run **automatically once after every tool round that edited
      files**, before the next request, and their results go into it.
    - The model can edit what a check runs (`package.json` scripts, a
      config), so an automatic check takes the shell tool's permission
      path: it asks in every mode that asks for a shell command, which is
      every mode but Bypass today, and "always allow in this session" works
      as it does for that command. Plan and Restricted Mode never run
      them.
    - Each can scope itself to the changed files: the paths go as separate
      arguments after `--`, and a path starting with `-` is refused. A
      time cap bounds the run.
    - The model can also call `run_checks` itself.
  - A `then_run` option on `write_file`/`edit_file` (SoL-Pi's Action
    Fusion). The command goes through the shell permission path. Format
    on edit runs first, then the hash is taken, and the guard skips the
    command only if the file changed after that.
  - A bounded fix loop: at most N rounds while checks fail, then it stops
    and says so.
- **Backends.**
  - Model API: all of it.
  - Muse Code: diagnostics through `mcp__ide__getDiagnostics`, which
    already exists. The guidance to verify is sent as model text in the
    turn (`MODEL_TEXT`); the template AGENTS.md stays `muse init`'s
    (M12), and no skill is installed into Muse Code's folders (D13).
  - Automatic checks after Muse Code's own edits would need an MSP event;
    that is asked upstream.
- **Acceptance.** Check commands and `then_run` never run in Plan or
  Restricted Mode, and never run unapproved where a shell command would
  ask. `then_run` shows in the row as one call with two results.
  - **Workspace edit review, 2026-09-29:** before an approved `write_file`
    or `edit_file` can write or format, notify every live Model API session
    in this workspace, including parents, children and siblings. Pending
    names must lapse the verify loop's grants even during a new message;
    checks over pending writes cannot count as current. Completion or
    failure releases the pending state and invalidates runs that started
    during the write. New sessions join active notices; disposed sessions
    leave them. Keep each session's successful-edit diagnostics and fix
    loop separate, and preserve the shell tool's rules (Q12). Reuse
    `ModelApiHost`'s session lifetime and `VerifyLedger`, with held writes
    and formatters in the existing fake API tests plus red drills.
    Project memory writes and an added note's `MEMORY.md` index also notify
    the ledger when confined inside this workspace; they still do not
    schedule automatic diagnostics or checks. Other writers (shell, image
    and external MCP tools) keep M68's existing scope.
- **Evidence.** OpenCode, Aider (`--lint-cmd`/`--test-cmd`), Crush,
  SoL-Pi.
- **Tests.** The fake Model API over a fixture with a failing check: the
  diagnostics and check results reach the next request, the fix loop stops
  at its limit, and a check asks where a shell command asks (a drill per
  mode).
- **Size.** M.
- **Status 2026-09-28: built and certified on `feature/m68-verify-loop`**
  (`docs/certification/m68.md`); not pushed. Decisions taken:
  - **Settings**, all machine-scoped (D15): `diagnosticsAfterEdits` (on),
    `checkCommands` (none; `{ name, command, changedFiles?,
timeoutSeconds? }`, at most 8, names unique, 300 s unless set, 600 s at
    most), `formatOnEdit` (off). The loop is Model API only, as scoped;
    `run_checks` and `then_run` are offered only with the shell.
  - **After a round that edited files** (the edit tools' writes; not the
    shell's, the memory tools' or images), before the next request: the
    edited files' diagnostics, then the checks, in a **Check edits** row
    (`verify_edits`) whose summary counts errors and warnings and names each
    check's outcome; the model reads it all as a user note that leads with
    "tool data, not a new instruction from the user". A diagnostic is
    matched across rounds by severity, source and message, never its line,
    for "N new, M fixed"; at most 50 are listed.
  - **The language servers report only on files an editor shows**
    (measured, VS Code 1.139.1 and 1.125.0: a hidden `.ts` and `.json` got
    nothing in 25 s, shown ones in 1.6 s and 0.1 s). So each edited file no
    editor shows opens beside the active editor in a tab of its own (not a
    preview, which `workbench.editor.enablePreview: false` would make
    permanent and which would replace the user's own preview), without
    taking focus (beside, so nothing the user types lands in it), and the
    tabs it opened close after the read unless the user changed them. After
    the M68 review the wait starts once the file shows: 4 s for a first
    report, then 1.5 s of quiet, 10 s at most, a Stop ending it for every
    file left; one queue serves every caller (panels, subagents, the
    `getDiagnostics` tool). A file with no report, unsaved, or past the
    round's first 8 (`VERIFY_SHOWN_FILES_MAX`) is "not checked" with the
    reason, never clean, and leaves the "N new" baseline alone; the baseline
    moves only once the note reached the conversation. The existing
    `getDiagnostics` tool does the same for a file it is asked about, on
    both backends, which is what makes the Muse Code guidance useful; it is
    confined by real path first, and its wait ends when the MCP caller goes
    away.
  - **Permission path** (`authorizeCommand`): Restricted Mode refuses; the
    mode's shell verdict decides (Plan refuses, Bypass allows, the others
    ask); the card is the shell's own (`shell` subject, so Edit
    automatically never answers it), with the PermissionRequest hook seeing
    it as a shell call; "always allow in this session" is keyed on the
    configured command without its paths, under the verify loop's own key
    (`VERIFY_COMMAND_RULE_KEY`) since PR #54's fourth Codex round: a
    check's or `then_run`'s grant never answers for the model's own shell
    call of the same command, nor the shell's for them. A check the
    user rejects is not asked again until their next message. In Restricted
    Mode the automatic checks are left out rather than refused one by one.
    Superseded by the M68 review: checks, `run_checks` and `then_run` go
    through the user's PreToolUse, PostToolUse and PostToolUseFailure hooks
    as calls of the shell tool (`runVerifyCommand`: a block is "a hook
    denied it" with the hook's words, `updatedInput.command` replaces the
    line and the rule key, a demanded question asks even in Bypass, a
    PostToolUse context or reason follows the output, and `continue: false`
    ends the turn); a PermissionRequest hook's denial is told apart from the
    user's Reject, whose feedback is kept. The session rule stays keyed on
    the configured command, which is safe because a path can no longer
    inject (below), but it does not answer after the conversation, since
    the user's message, edited a file that decides what the command runs
    (`canChangeWhatRuns`: `COMMAND_DEFINING_FILES`, code-loading files, a
    file whose path occurs in the command's text or a plain word of it
    names, or, since PR #54's fourth Codex round, any edited file when the
    command holds shell syntax that makes its words uncertain: quotes,
    escapes, variables, substitutions, globs, operators). The judgement is
    made on the command the rule is keyed on, a hook's rewrite included.
  - **Paths reaching a check** (the M68 review, P1): only edited files that
    exist, or `run_checks` paths that exist in the workspace; a leading `-`
    or `@`, or a control character, refuses the check, and on Windows so do
    `"`, `&`, `|`, `<`, `>`, `^`, `%` and `!` (`WINDOWS_ARGUMENT_SYNTAX`):
    measured, Windows PowerShell 5.1 passed `["a\"","b --inject"]` to
    node.exe as `a b`, `--inject`, and a `.cmd` ran `x&echo.INJECTED` as a
    second command, expanded `%OS%` and dropped `^`, while spaces, both
    quotes, `$`, `;`, `,`, `=`, parentheses, braces and non-ASCII passed
    intact through both.
  - **Code the editor runs** (the M68 review): a linter's or formatter's
    JavaScript config, `package.json`, `node_modules`
    (`CODE_LOADING_FILE_PATTERNS`) is never shown or formatted, and once the
    conversation writes one nothing more is shown or formatted until the
    user's next message ("not checked" with the reason).
  - **One budget**: the verify note, diagnostics and every check together,
    is at most `VERIFY_NOTE_MAX_CHARS` (64,000), shared equally; so is a
    `run_checks` result. A check the model ran since the round's last edit
    (`run_checks` over the edits, or a `then_run` of its own command) is not
    run again after the round, and nothing runs after the turn's last round.
  - **The fix loop**: `CHECK_FIX_MAX_ROUNDS` (3) failing verdicts in a row
    stop the checks until the user's next message. Since PR #54's third
    review the state is one `VerifyLedger` per session: every check that
    ran is recorded against the file state it ran on, a round is judged
    when a run since the previous verdict is current, and it passes only
    when no current run of any check failed. A user's message, once
    admitted, resets it all; a steered message resets the count, the
    rejections and the runs, but not what the conversation wrote; a goal's
    wake, and a parent model's message to a subagent, reset nothing.
    `run_checks` honours the stop and the rejections too. The model is told
    to stop fixing and say what still fails; the panel shows a warning. The
    diagnostics go on.
  - **`then_run`** (SoL-Pi's Action Fusion, reimplemented from its public
    description, no code ported, so the notices generator is unchanged and
    M73 stays the first milestone that may port): after the edit (and its
    format), the command takes the permission path above (a hook's forced
    question carries over), then runs only if the file's SHA-256 still
    equals the fingerprint the edit left; else "not run: the file changed".
    The row keeps the edit's diff and adds a **Then ran** block (command,
    output, exit or reason). A Stop at its card keeps the edit's result and
    diff. The shell's default 120 s cap applies.
  - **Format on edit**: `vscode.executeFormatDocumentProvider` over the
    document once it shows what the tool wrote (2 s to catch up, else
    skipped), within 5 s; edits applied to the written text (BOM kept, the
    file's CRLF kept), written back by the tool, the patch and fingerprint
    taken after. A formatter that fails or overlaps leaves the edit as
    written and is logged; so does a write-back that fails (the M68 review),
    and a formatter that does not answer in time is logged too.
  - **Muse Code**: a second `<harness_note>` with each message, from
    `MODEL_TEXT`: call `mcp__ide__getDiagnostics` on each edited file (only
    when the session got the `ide` server) and fix what the edit broke, and
    run the named check commands (named only in a trusted workspace). The template AGENTS.md is unchanged; no skill is
    installed. Automatic checks after Muse Code's own edits need an MSP
    event ("a turn's edits finished", or an edit completion hook), still to
    be asked of Meta upstream: the owner's to file.
  - **Evidence**: 27 unit tests over the fake Model API (a fixture whose
    lint fails), 11 over the editor adapter, an integration test inside VS
    Code 1.139.1 and 1.125.0 (TypeScript and JSON diagnostics, the JSON
    formatter), a harness scenario `verify`, 26 red drills, and a live case
    (case19: 3 requests a run, two runs, contributor model, `then_run` used
    and passed, the check note accepted by Meta). After the M68 review (one
    pass over three reviewers' 2 P1 and 18 P2 findings, 16 of them
    distinct): 47 loop tests, 18 editor tests, 12 check-command tests (two
    real round trips through Windows PowerShell 5.1, one into a `.cmd`), the
    harness scenario fixed and reshot, 40 red drills, and the integration
    test rerun on both versions. That run caught a regression the tab
    cleanup made: the JSON server clears a file's diagnostics when its tab
    closes, so `settleFile` now returns what it read while the file showed
    and the diagnostics tool answers with that. Codex's review of PR #54
    added four, fixed with drills R41 to R46: a hook's stop ends the
    remaining checks; a queued editor caller stops while it waits; an
    already shown file's report since the write, or a shown document that
    holds the disk text, counts; `run_checks` rounds without edits count for
    the fix loop. Its second round added three, closed as a class: every act on
    a file after an await uses the confined real path and canonical name
    and checks the file (its real path, and what the edit left) just
    before; a reused background tab keeps its preview state and the tab
    that was in front comes back (drills R47 to R56). Its third round
    (four findings) was answered by a redesign: one conditional write in
    `fsAtomic` for every verify-loop writer, and one `VerifyLedger` per
    session that records each check against the file state it ran on,
    judges a round only by runs on the latest state, and resets on any
    admitted user input, queued or steered (drills R57 to R68).
  - **Open for the owner**: the side editor group, the upstream MSP ask, and
    the `diagnosticsAfterEdits` default (on).

### M69 — Web fetch (D49; folds in M44b)

- **Goal.** The model reads a page it found or was given.
- **Scope.**
  - The `web_fetch` tool, with M44b's network-safety rules:
    - HTTPS only;
    - public addresses only: loopback, private, link-local, IPv6
      unique-local, carrier-grade NAT (100.64.0.0/10), IPv4-mapped and
      other reserved addresses are refused;
    - the name is resolved and checked locally, and the connection goes to
      that pinned address, also through a proxy (CONNECT to the address,
      with the host name for TLS); where the proxy cannot take a pinned
      address, the fetch stops with that reason;
    - a small redirect limit, each hop checked and pinned like the first;
    - a size cap, a time limit, a content-type allowlist, HTML converted
      to Markdown, and the text marked as untrusted content.
  - It asks per host in every mode but Bypass, since the URL itself can
    carry data out. It is off in Restricted Mode.
  - Through VS Code's proxy and certificates (M56).
  - No billing: the fetch is the extension's own. It is not Meta's paid
    search.
- **Backends.**
  - Model API: native.
  - Muse Code: `mcp__ide__webFetch`, since Muse Code's own `web_fetch`
    is switched off. It follows D49's rule for network tools on `ide`.
- **Acceptance** (M44b's): tests and a red drill for each rule above,
  including a name that resolves to a private address, a redirect into
  one, and a proxy that cannot take a pinned address; a harness scenario
  for its row; the gate green; a certification record.
- **Size.** S.
- **Status 2026-09-29: built on `feature/m69-web-fetch`, PR #52 open**
  (`docs/certification/m69.md`); the resumed picture repair passes focused
  tests and red drills; final review and integration gates are pending.
  Integration retains M67's separate language services, binds the existing
  web fetcher to the standalone ACP Model API runtime, and ships its converter
  worker/notices. Independent review found missing permission checks on later
  address attempts and the Node 24.0–24.4 HTTPS proxy warning gap; both have
  focused regressions and intended red/restored proofs. The standalone transport
  remains Node's, without automatic proxy rerouting or VS Code settings.
  Built to M44b's safeguards
  and the plan review's six rules:
  - **Destinations** (`src/core/web/publicAddress.ts`, `pageUrl.ts`):
    `https:` only, no credentials, 2,048 characters at most; local and
    reserved names (`localhost`, `local`, `internal`, `home.arpa`, `test`,
    `invalid`, `example`, `onion`, `alt`, and any single-label name) refused
    before any lookup. IPv4 is public outside IANA's special-purpose blocks
    and Azure's WireServer (so 169.254.169.254, 100.100.100.200 and
    192.0.0.192 are refused); IPv6 only inside 2000::/3 and outside
    2001::/23, 2001:db8::/32 and 3fff::/20, with IPv4-mapped, -compatible,
    NAT64 and 6to4 judged by the IPv4 inside. Every DNS answer is checked:
    one non-public answer refuses the name.
  - **Pinning** (`src/host/web/pinnedRequest.ts`): Node's `https` connects
    to the checked address, with `servername` and `Host` carrying the name,
    so TLS still verifies it. VS Code's patched `fetch` cannot pin (it
    replaces a caller's dispatcher with its own agent, keeping only CA and
    HTTP/2 options: @vscode/proxy-agent `createFetchPatch`, read
    2026-09-27); its patched `https` can, and does so through the proxy:
    the integration test shows a loopback proxy receiving
    `CONNECT 203.0.113.7:443` and a ClientHello naming the host, on VS Code
    1.139.1 and 1.125.0. Only an answer that arrived over TLS is read: a proxy's
    own refusal of the tunnel is reported as `Proxy response (N)`, M56's
    proxy failure, never read as the page. The checked addresses are raced
    in the resolver's order (ADDRCONFIG) as RFC 8305 says, never
    re-resolved.
  - **Redirects**: same host (host and port) followed, each hop checked,
    resolved and pinned again, at most `WEB_FETCH_MAX_REDIRECTS` (5); a
    redirect to another host is handed back to the model as a URL to fetch
    in a new call, so each host is approved on its own; into a refused URL
    it fails naming the redirect.
  - **Bounds**: 5 MiB after decompression (gzip, deflate, br; another
    coding refused), declared or streamed; 30 s for the whole fetch; an
    allow-list of text types; the header's charset, else HTML's `<meta>`,
    else UTF-8. HTML becomes Markdown in one linear pass
    (`htmlToMarkdown.ts`, with `entities` for character references, the
    one new dependency, D3); inline nesting, list and quote indents and
    table width are capped so a hostile page stays linear. The model reads
    the first 50,000 characters and is told the total.
  - **Approvals**: a new `network` tool class. Bypass allows, Plan
    (`denyUnmatched`) refuses (its rules allow workspace reads, not network
    reads), Manual, Edit automatically and Auto ask, per host: the card
    (`webFetch` subject) names the URL as it will be fetched, and "Always
    allow in this session" is keyed on the host. Restricted Mode: not
    offered, refused if called; a side chat (always Plan) is not offered
    it. A URL refused on its face (scheme, credentials, length, a reserved
    name, a non-public literal address) is refused before any card; a name
    is resolved only after approval, since the lookup itself carries the
    name out, so one that resolves to a private address is refused after
    the card and before any connection.
  - **Untrusted content**: the model's text is the header line, a notice
    that the page is untrusted data, and the content between markers with
    8 random bytes the page cannot know; the instructions say the same.
  - **Muse Code**: `webFetch` on the `ide` server, listed only while the
    workspace is trusted and `museSpark.sandboxNetwork` is not
    `restricted` (the list is read per request), with MCP annotations
    `readOnlyHint: false, openWorldHint: true`, and the extension's own
    modal (Allow once / Reject, naming host and URL) before every call,
    whatever Muse Code's mode. Live (4 model attempts, contributor model,
    empty folder): Muse Code listed and called it, asked its own approval in
    on-request mode, and passed our text through verbatim as the row's
    output, which the row's size line reads (AGENTS rule 13).
  - **Row**: the URL beside the label, "Fetched 48.2 kB (text/html)" under
    it, and what the model read in the body; harness scenario `web-fetch`.
  - **Review round** (three class reviewers over `c3d7702c`, all fixed in
    one commit): the `ide` call gets an `AbortSignal` aborted when Muse Code
    closes the request or sends `notifications/cancelled` (both captured
    from Muse Code 1.4.0 on a stopped turn, 2 model attempts), raced against
    the modal, with `isOffered` checked again after it and one modal per URL
    at a time; the checked addresses are raced as RFC 8305 says (250 ms);
    connection failures in web fetch's own words naming the host and the
    addresses (not M56's Meta advice), a proxy's refusal of the tunnel
    included, the detail only as error codes (a name mismatch's message
    lists the certificate's names); server text outside the markers only as short tokens, the
    final URL, the title and a moved target inside them; the converter
    bounded at 100,000 characters (prefix depth 4, rows unpadded); all
    trailing dots stripped and empty labels refused; RFC 7050 NAT64 prefix
    discovery; damaged compression is the coding's failure; the charset only
    from `<meta>`, an unknown label ignored; sentences name "this tool";
    Model API rows localized for a moved page and Restricted Mode;
    `sandboxNetwork` described in fifteen manifest tables. PAC and
    `http.noProxy` see the pinned address, not the name (@vscode/proxy-agent
    0.45.0 `agent.js` builds the proxy URL from `opts.host`): kept, since the
    name would let the proxy resolve it again; documented.
  - **PR #52 review** (Codex): NAT64 discovery fails closed (only a
    definite "no AAAA" from the page's own resolver means no DNS64; a
    timeout, SERVFAIL or an answer without a prefix leaves it unknown, and
    then no IPv6 answer is used, a name with only IPv6 answers refused as
    `nat64Unknown`); a `PermissionRequest` hook's allow no longer replaces
    the per-host card (it may still deny or ask). Swept: every other failed
    lookup or check already refuses.
  - **PR #52 second review** (Codex): what allowed a fetch is asked again
    after every await: after the card or hook (the turn, trust, a mode that
    now refuses), before each hop's lookup and connection (a caller's
    `isStillAllowed`, ending the fetch as `withdrawn`), and once the page is
    in, before the model gets it; on Muse Code the offer (trust,
    `sandboxNetwork`) is that check.
  - **PR #52 third review** (Codex): NAT64 absence is proven only by a DNS
    query's own NXDOMAIN or NODATA (c-ares), while the system resolver's
    answers still reveal a prefix; the converter hides an element a page
    left open (`<p hidden>`, `<li aria-hidden>`, cells, rows) up to where a
    browser ends it, tracking what is open inside and around it, and, from
    the sweep, a hidden image's alt text, a self-closed hidden element, an
    unopened dialog, ruby's `rp` and `datalist`.
  - **PR #52 fourth review** (Codex, a self-closed `<template/>` shown):
    the converter's hiding now follows the WHATWG parsing algorithm as a
    whole: one stack of open elements with the algorithm's scopes, special
    and formatting elements, implied ends, the adoption agency (a hidden
    formatting element reopens until its own end tag), `</form>`, foreign
    content (breakouts, integration points, CDATA), select, tables,
    headings and `<body>` attribute merging; the tokenizer ends comments
    (`<!-->`, `--!>`), bogus comments (`</ x>`), CDATA and script escapes as
    HTML does, honours a slash only right before `>` and only on void and
    foreign elements, and keeps attribute names that begin with `=`.
    parse5 8.0.1 (MIT, already in the tree through jsdom) was measured and
    not adopted: quadratic on hostile nesting (40,000 nested `<div>` in 25 s,
    40,000 nested lists in 73 s, where the converter takes 34 and 127 ms), so
    a 5 MiB page could hold the extension host for hours; no dependency
    changes.
  - **Redesign after the fifth review** (Codex: `<base href>` ignored, the
    charset sniff reading `<meta>` text in comments and other attributes,
    `display:/**/none` passing the hidden check; the fourth round on the
    hand-written path, so the owner's rule applied: redesign, not patch).
    The page is parsed by parse5, decoded by html-encoding-sniffer (the
    standard's sniffing) and Node's `TextDecoder`, and its inline styles
    read by @csstools/css-tokenizer (D3); the converter walks the tree,
    leaving out exactly what HTML hides, and resolves links against the
    first `<base href>`. parse5's time on hostile nesting is contained by
    running it on a worker of its own bundle, `dist/pageWorker.js` (D6), one
    per page (never at activation; the bundle-split gate checks it), at most
    two at once, stopped at 10 s or 512 MiB, which refuses the page with the
    reason.
  - **Redesign review** (two class reviewers): the sniffer's crash on a
    malformed `<meta>` content read past; `replacement` encodings read as one
    U+FFFD; XHTML sniffed as XML; a later `<meta>` changes a tentative
    encoding (the standard's reparse); the header's charset read as a MIME
    parameter; at most two conversion workers at once, the wait honouring
    the fetch's signal; a deadline passing during conversion named as the
    conversion's; failure details as short codes, crashes logged by name,
    code and frames; `popover`, closed `<details>` and declarative shadow
    roots read as they render; inline `display` by its real grammar, a
    bracket stack, and a `var()` on a hiding property counted as hiding;
    the `.vsix` check and an integration test for `dist/pageWorker.js`.
    Grok Build's review of the same diff added: the title only from the first
    `<title>` child of `<head>` (one the parser put inside a hidden element
    no longer reaches the model), and an encoding the runtime cannot decode
    refuses the page (`undecodable`) instead of reading it as UTF-8, with
    `x-user-defined` and `replacement` decoded by the Encoding standard's own
    definitions (Node 20.18 has no decoder for the first, no Node for the
    second).
  - **PR #52 review of `19f843f3`** (Codex): XHTML is refused
    (`application/xhtml+xml` read by an HTML parser misreads its XML syntax,
    `<script src="x"/>` swallowing what follows, and no XML parser is
    bundled; it is no longer in the Accept header either); `visibility` is
    inherited, so the walk carries it down instead of dropping the subtree:
    a descendant with `visibility: visible` shows, an invisible element keeps
    its tags (a shown item stays in its list) but writes no text or void
    element. Swept: `display: none`, `content-visibility: hidden`, `hidden`,
    `inert`, `aria-hidden`, `popover`, a closed dialog or `<details>` hide
    all they hold, which no descendant can undo; `visibility` was the only
    inherited one.
  - **PR #52 review of `83eedf26`** (Codex: a `<col>` styled
    `visibility: collapse` hides a column whose cells are not its
    descendants; the third round on the converter's hiding, so the owner's
    rule applied: redesign, not patch): the converter no longer emulates
    rendering. It cannot do so completely (a stylesheet, a class, a `<col>`,
    a script, a font or a colour can hide text), and the attempt protects
    nothing, since a page can put the same words in visible small print; the
    defence is the untrusted markers around everything a page returns. Left
    out now is only what is never page text by structure: the head (the
    title is read from it), scripts, styles, template content (a declarative
    shadow root's is written where it stands), `<noscript>`, embedded frames
    and media, form controls, SVG and MathML. `hidden`, `inert`,
    `aria-hidden`, `popover`, closed dialogs and `<details>`, `rp` and
    inline styles are no longer read, for one consistent rule. The result is
    the page's text as served, which can include text a browser would not
    show, all of it marked untrusted, and the tool description and the
    notice before the markers say so. `inlineStyle.ts` and
    @csstools/css-tokenizer (D3) are removed; the worker bundle is
    201.2 KiB. This supersedes the earlier bullets' hiding.
  - **PR #52 resume repair (2026-09-29, focused verification complete)**: traverse
    `<picture>` so its fallback `<img>` keeps the existing safe-source and
    nonempty-alt rules. `<source>` contributes no image or attributes;
    no `srcset`, media-query or browser rendering selection is emulated.
    Regression coverage must keep document order, relative fallback URLs
    and alt text, refuse unsafe or wordless images, and still exclude
    images inside inert templates and embedded media. Reuse the converter
    and its unit suite, with a red drill restoring `picture` to `OMITTED`
    in a disposable copy. Final reviewed-tree quality remains required.
  - **Left**: a machine-scoped switch to turn web fetch off entirely,
    whether Muse Code's "Always allow this MCP tool" should also silence the
    extension's own modal, and whether Plan should allow fetches as reads,
    are the owner's (§3 is untouched until asked).

### M70 — Review (D49)

- **Goal.** Review what the agent did before it lands.
- **Scope.**
  - `/review` with presets:
    - the uncommitted changes, the branch against its base, one commit, or
      custom instructions;
    - a security preset: injection, secrets, authentication, unsafe APIs.
  - The review runs as a reviewer.
    - On the Model API, M70 builds the built-in **Reviewer** agent itself:
      read-only tools, its own prompt, the security preset. A `/review`
      the user asks for runs as a turn of the conversation itself, with
      the Reviewer's prompt and tools, so it is part of their turn. Run as
      a child (D45) or on its own, it is a paid use (D48).
    - On Muse Code, the review prompt is sent as the turn's text
      (`MODEL_TEXT`); no skill is installed. The diff under review is
      untrusted content, so that turn runs in Plan mode and the previous
      mode comes back after it. Muse Code's Plan mode applies its own allow
      rules, so this review is not claimed strictly read-only (D46).
    - M76 later lets users define agents of their own on the same base.
  - In Restricted Mode, which runs no git, the presets that need git are
    unavailable and say so.
  - Findings become a list with file and line.
  - A **review pane** over the conversation's changes:
    - files and hunks, each hunk accepted or reverted;
    - a comment on a line is sent to the agent as a steer or the next
      message.
- **Backends.** Both. The pane is the extension's own.
- **Acceptance.** On the Model API the Reviewer has no write, shell or
  network tool; a finding opens its file and line; a reverted hunk leaves
  the file as it was; a line comment reaches the agent as a steer; the
  Muse Code review turn runs in Plan mode and the mode comes back.
- **Tests.** The fake Model API and the fake `muse serve`; the pane in the
  harness and the accessibility gate.
- **Size.** L.

### M71 — Git and pull requests (D49)

- **Goal.** From finished work to an open PR without leaving the panel.
- **Scope.**
  - A generated commit message for the conversation's changes.
  - Commit and push go through VS Code's built-in git extension API, so
    the user's credential helpers and sign-in prompts apply (the
    extension's own git runs with no prompt and could not push).
  - Open a PR through VS Code's GitHub authentication, with a generated
    title and body, as a draft or ready. The confirmation shows the exact
    remote, branch, title and body, editable, with credential-shaped
    strings masked.
  - The PR is linked to its conversation, with its status and checks
    shown.
  - **A conversation in a worktree.** Its backend host is confined to the
    worktree (the Model API's workspace root; `muse serve` started in that
    folder), and the worktree is added as a workspace folder or opened in
    its own window as M32 does, so trust and language services apply to
    it. M77 reuses it.
  - "Open PR in a conversation" checks out the PR's branch in a
    worktree. A PR the user did not author is adversarial content until
    the user says otherwise:
    - its worktree is created under the extension's own storage and opens
      in its own window;
    - VS Code may still trust that folder, through a trusted parent (the
      home folder, say) or with workspace trust switched off, and the
      extension cannot ask VS Code about a folder before it opens. So the
      extension never relies on it: in that window it holds the
      conversation in Plan mode, with project rules, skills, hooks and MCP
      servers off (Muse Code starts without `--trust-workspace`), until the
      user confirms trust for that worktree in the extension's own card,
      whatever VS Code's trust says. Where VS Code opened it in Restricted
      Mode, that applies as well;
    - other extensions follow VS Code's own trust, which this extension
      cannot lower, and the card says so.
- **Rules.** Never force-push. Pushing and creating a PR always ask.
  GitHub only (D49, not taken). Unavailable in Restricted Mode.
- **Backends.** Both.
- **Acceptance.** No path force-pushes; every push and PR creation asks
  and shows what goes out; a PR by someone else opens held in Plan mode
  with its project configuration off until the user confirms trust in the
  extension's card, even when VS Code already trusts the folder; the
  worktree conversation cannot touch the main checkout.
- **Tests.** A fake git extension API and a fake GitHub endpoint, with a
  drill for the force-push refusal and the project-configuration switch.
- **Size.** M.

### M72 — Turn checkpoints (D49)

**Correction batch before 0.10.0, 2026-09-30 (built and lane-verified; the
four-rig gate, hosted CI and the release are open).** Seven commits on the
verified `9c4ac7d3` (`docs/certification/m72.md`, "Correction batch before
0.10.0", holds every drill with its hash):

- **Memory** (`cfe57534`, `80b768f4`): the batch described next. The
  activation wiring test now pins the exact guard expressions (a no-op
  `captureGuard` fails it), which the independent verifier found missing. Its
  other finding, that `withCheckpointEditAt` decides containment lexically
  against the canonical root while the store also accepts the display root, was
  right for the export edit (a save dialog returns VS Code’s spelling) and is
  fixed in `e78a949d`: containment holds for either spelling. The project memory
  scope was never affected (its path is built from the root it is compared
  with).
- **The user's `!` and a shell that never started** (`e593ebe4`, `1fd98aaf`):
  see "Final admission for the user's `!` command" below.
- **git's path limits** (`62c856d8`): see "Long storage paths" below.
- **Test infrastructure** (`c5fec8dc`, `dd4daa8f`): on macOS and Linux the
  integration tests use a short user-data folder only when the default would
  not fit a Unix socket path (macOS caps it at 104 bytes), and the macOS worker
  cap is typed so that `typecheck:host` passes; it failed at the base and would
  have failed `npm run quality`.

Measured by `npm run build` on `62c856d8`: extension 591.7 of 600 KiB, Model
API 398.5 of 400 (1.5 KiB left: anything that lands in `ModelApiHost.ts` needs
its size re-checked), checkpoint store 188.5 of 225; no budget moved. **Open:**
the final four-rig gate (Windows host, Windows VM, Mac mini and Kubuntu, each a
literal `npm run quality` on the exact tree), hosted CI, the protected merge and
the release; the independent verifier of the git path lane had not reported.
**Owner decisions still open** (§3): native/process exclusion, whether hooks
should get a final admission of their own, and whether a storage path over 240
characters should ever be served by moving the repository (today it is refused
with a clear message).

**Actual memory composition and GUI admission batch, 2026-09-30 (built; aggregate
gates and platform runs open).** Activation built Muse Code's
memory over the raw tool I/O while the guarded owning fixture composed a
checkpointed one, so a replacement of an ignored project note or of its
`MEMORY.md` took no checkpoint copy, an exclusive creation (which has no
ToolIo call) took none either, and the Memory view's creation and trash held
no restore lease. One small composition, `createCheckpointedMemory`
(`host/backend/checkpointedMemory.ts`), is now the only place activation
builds the store, and the regression tests build it too:

- Replacements (an existing note, an edit, `MEMORY.md`) go through
  `withCheckpointCopies` with the original guard. An exclusive creation
  awaits the same `beforeToolWrite` copy, then publishes with no-clobber and
  the same guard. The accepted-first-write rule is kept: a note already
  published stays when a later index guard refuses, with the honest index
  warning.
- The view's creation, trash and index line run under the pure edit lease
  (`withCheckpointEditAt`) until their native promises settle, with one guard
  captured when the action starts (`backend.workspaceActionGuard`, the same as
  Create AGENTS.md and the review revert). The guard is handed through
  `Store.create` and `Store.forget` to the atomic publication callbacks. A
  note is copied before the trash (`beforeDelete`), and the guard speaks last
  right before VS Code's delete, which has no callback seam. A trashed note
  stays trashed when the index guard refuses, and the failure is reported.
- Whether a scope takes the lease is decided by its folder, not its name:
  only a scope under the workspace folder does (the project scope; Muse
  Code's personal folders when the window is opened on the home). The rest
  keep only the lifetime guard, so no project lease is taken for a path no
  restore writes. The view has no trust gate, as before, so it still works
  in Restricted Mode (the lease publishes its mark there too, with no git).
- A conversation export the user places is written through the same lease
  when its file lies in the workspace (`cliFeatures` `editFile`); the
  writer inventory found no other raw workspace writer: the Model API tools,
  the IDE image tools and memory copy first; plans, the review revert,
  Create AGENTS.md and exports hold the lease; hooks and shell commands mark
  activity; CLI commands, worktrees and terminals use the native startup
  fence; sessions, schedules and the job helpers write the extension's own
  storage; the ACP agent is an independent process outside the guarantee.
- `src/extension.ts` has no unit run (its coverage is the integration
  suite), so a wiring test holds it to the composition: no `new MemoryStore`
  or `createMemoryIo` in activation, the view gets the composition's lease
  and copy, and exports go through `withCheckpointEditAt`.

Held-GUI controls run real git, real native I/O, the real store and a second
window: a held creation or trash is refused a peer window's restore
(`turnElsewhere`) and lets it through after settlement; a personal path
outside the workspace takes no lease and a restore proceeds meanwhile; a
revoked window refuses before the delete or the publication; a failed copy
stops both; and a restore puts back the ignored note, its index and the
trashed note. Eighteen on-purpose breaks of these guards each failed their
intended tests and restored byte-exact (the certification record names the
hashes). No new transaction, policy, dependency or native resolver framework.

**Whole-suite correction batch, 2026-09-30 (verified).** Four controller
expectations predated the required checkpoint-state row. Their exact old
auth/composer/model/session/skills/attachment order is kept, with the
explicit `noFolder`, blocked Restore/Redo, empty legacy/current turn lists
and relevant session identity added at the actual emission point. The
side-session clearing test asserts the complete new message sequence rather
than a position from the end. The webview's `checkpointState` messages carry
`legacyTurnIds`. Nothing filters the new row and no assertion was weakened.
This is a fixture contract correction, not a product behavior change: the
five owning files (controller, conversation checkpoints, App, UI state,
protocol) pass 636 of 636, and removing the session id or the legacy turn
ids from the emitted row fails four and five controller tests on the exact
expectations.

**Release-blocking memory-owner repair, 2026-09-30 (bounded proof complete).** The
old memory-tool branch bypassed the captured call admission used by ordinary
file edits. After approval it awaits placement, note reads and checkpoint
preimages, but its existing/new note and index writes received no turn guard.
The repair threads the existing original-call Stop, mode, trust, session-disposal and
Host-closing predicate through `runMemoryCall`, `MemoryStore` and `MemoryIo`
to the existing atomic replacement/no-clobber publication callback. Recheck
after memory preparation; reads create no mutation notices or write grants.
Every new-note index publication carries the same admission. Keep an already
published note if a later index guard refuses, with the existing honest
index warning; do not roll back accepted bytes or invent index success.
Real checkpoint preimage and native publication fixtures cover held
Stop/mode/trust/disposal/Host-close refusal, unchanged-owner success and index
completion/refusal. Old `85cedad0` published actual late bytes after Stop,
mode and trust changes. Exact `e908e825` passed five types, 400 owning tests
in four files, owned lint, whole-repository duplication (605 files, zero
clones) and 14 localization tables. Four external guard-removal controls
showed green → red → restored green with exact hashes restored. Initial
fixture narrowing, startup interference, lint and clones were fixed without
changing assertions or gates. Lead full quality/final release proof remains
required; the per-milestone record carries the exact receipts. No policy,
dependency, native resolver or general transaction framework is added.

**Common Stop/lifetime join, 2026-09-30 (bounded proof passed; aggregate gates open).** Preserve
the reviewed `c19a4955` checkpoint implementation and apply only the proved
ordinary-write, formatter, rename and automatic-diagnostics owner guards.
Capture the actual active turn object, call, mode and initial trust before
awaits; recheck the same owner at native publication and result release.
Forward the optional ordinary-write guard through checkpoint preimage copies
and compose it with runtime directory ownership in the existing atomic path.
Conditional checkpoint callbacks, preimages, pure leases and captured Plan
recorders stay intact. A denied late formatter retains the successful initial
edit and its patch. Rename refuses before its first actual write after owner
changes, while preserving its established finish-after-first-write Stop rule.
Host closing fences publication before awaited SessionEnd work. Diagnostics
and configured checks with revoked ownership/trust are refused or withheld,
never reported clean; Restricted ordinary reads/edits retain their contract.
This branch has no M78 profiles or M82 budget feature: use its existing
permission engine and add no such settings or whole Host replacement.
Native held-checkpoint and atomic-stage controls plus the current M72 suites
passed the assigned Windows VM proof after the lead reassigned Kubuntu to
M75. Five type projects, scoped lint, all 14 locales and zero duplication
passed on behavior tree `f6e7e854d8b6a37738e82484b39c23b3dbe0ace2`.
The final seven-file rebind passed 504 tests; the earlier full 27-file owning
selection passed 757 with six explicit Windows skips on `8b272cb3`, before
only production naming/declaration placement and typed fixture deduplication
changed. Fourteen disposable mutations failed their intended assertions;
31 selected tests passed before and after exact restoration. Removing the
required Host closing callback also failed the constructor contract at
TS2345 and restored exactly. The certification record names hashes/receipts.
Initial factory, fixture, polling, parallel-timing, lint and clone failures
are retained; no threshold, deadline, ignore, dependency or rule was weakened.
The final evidence-doc reconciliation resumes from the user-paused checkpoint;
it changes no behavior and reuses those valid proofs. Final independent
review, verified latest-main join and aggregate/platform/installed gates
remain open; no partial unverified M75 snapshot is joined here.
The checkpoint shell wrapper adds another await before command entry; its
optional final command callback therefore runs after the pure activity mark
and again after the native adapter's awaited Windows assembly preparation.
A refusal before entry releases the mark without claiming an unknown process;
the native adapter reports proven cancellation with no workspace process.
Existing commands, hooks, permissions, signal and runtime identity checks
remain in their paths. Held-mark/assembly negatives and an actual unchanged
local command must prove that forwarding before merge certification.
The same callback reaches ordinary model shell calls through ToolContext.
Original call/batch admission is passed through explicit path preparation,
every sequential check and then_run rather than recaptured after a changed
mode or trust. Completed commands retain their actual exit status; unstarted
commands are refused and revoked results create no current ledger grant.
M46's explicit background move retains its existing separate controller:
only the exact still-owned controller may outlive the parent turn, while
captured mode/trust, command Stop, session disposal and Host close still hold.
Multi-check, explicit-path and held-background controls bind these seams.

**Independent no-entry classification follow-up (verification pending).**
The f6 review found a captured-owner refusal after checkpoint admission or
Windows assembly reported as a ran failed/cancelled check. Carry explicit
locally proven entry-refusal evidence through the existing ShellResult;
only the wrapper/native callback boundary may set it, never model/MSP data.
runCommand preserves it and runVerifyCommand reports notRun/refused from
that evidence. A null exit code or cancellation alone cannot imply no entry.
Already-started commands retain their actual exit outcome after revocation.
Extend held-mark/actual-assembly summaries and a launched/cancelled control;
prove only the new classification removals, preserving the valid 14 earlier
reds and original paused receipts. No new policy or ownership registry.
The common result interface and no-entry constructor live in the neutral
core/shellResult module, preserving the original tools type export. Eager
host adapters import only that tiny value; they cannot pull LAZY_ONLY tools
into the extension. Existing type consumers and outcome behavior are unchanged.

**Final admission for the user's `!` command and proof for a shell that never
started (2026-09-30).** The Model API session's explicit `!` command (M46) was
the one shell entry that reached the checkpoint wrapper and the native adapter
with no final admission: after its initial Restricted Mode check, the activity
mark and the adapter's Windows assembly wait could end with nothing asking the
current trust, the session or the Host closing. It now passes its own callback
as the sixth `runShell` argument and refuses on the user's own stop, session
disposal, Host closing and current trust. It does not take the model's rules:
the running turn, its Stop and the permission mode (Plan included) never
decide an explicit `!`, and a started command keeps its outcome. A refused
entry ran nothing: its row reads "The command did not run" and the model is told
nothing. Separately, a command that could not start at all carries
`isWorkspaceShutdownProven` through `unstartedShell()` in `core/shellResult`:
no interpreter on `PATH`, a missing PowerShell (a spawn that failed with no
pid), the hook shell, and `spawn` itself throwing (a NUL in the command, a
command line past the operating system's limit; `startProcess` in `toolIo.ts`).
The failure stays a failure. A launched command, an error event after launch
and a normal exit never carry the proof, so the wrapper still records native
uncertainty for any real launch. A failure before entry (the activity mark
cannot be made) is a `ShellEntryError`: the user shell path treats it as a
no-entry outcome and tells the model nothing, while a failure after the command
ran stays a plain `Error` and is still told. Out of scope by design: hooks (no
workspace-trust gate; SessionEnd runs while the Host is closing; Stop is
honoured through the signal) and Muse Code's `session/userShell`, which the CLI
runs in its own process, guarded only by the controller's Restricted Mode check
and the native startup fence. A throw from `assertWorkspaceCurrent` stays
unproven and conservative; only the ACP runtime composes it, and it has no
checkpoint wrapper, so no false sticky state is reachable (revisit if the two
are ever combined).

**Measured checkpoint bundle split (D6, verification pending).** Literal
`npm run build` on 0.10.0 `addc6870` produced extension 638.2 KiB, exceeding
the unchanged 600 KiB budget; Model API 397.9/400 KiB and every other existing
bundle were below their budgets. Preserve that real failure and move only
checkpoint implementation behind a dedicated shipped CommonJS entry using
the existing requireFile/checked-loader pattern. The extension keeps a thin
typed API and neutral turn key; the factory synchronously installs activation
UI_TEXT/uiLocale before constructing the real store. Constructor/getter,
maintain, namespace safety, process/startup admission and dispose remain
synchronous or awaited exactly as before. Loading occurs when activation
constructs a known-namespace store, including before its initial maintain;
this is a code-bundle split, not a claim of wholly lazy activation behavior.
The bundle must ship in the VSIX, source/metafile split gate, notices and size
inventory. Its new bounded budget will be set from measured implementation
bytes with documented headroom; no existing threshold is raised. Real built
factory, missing/malformed refusal and repaired-load controls plus literal
build/size/split and deliberate failures must prove the boundary.

The injected activation GitProcess keeps its original local error objects.
The new checkpoint bundle has separate copies of GitMissingError/GitExitError,
so checkpoint catch paths must use the error's checked name and exit fields,
not custom-class identity. Reuse host/git.ts for these structural guards,
preserving stderr/message and all CAS/error handling. Exercise actual built
factory capture with native Git and an exit-1 config control, plus the native
missing-Git error crossing the factory boundary; deliberate guard removal
must fail those semantics. No process-error wrapper or alternate store.

Actual scoped proof on `a8d25f02`: all five type projects and lint passed;
literal `npm run build` exited 0, including size, split, host globals and
81-package notices. Extension 590.5/600 KiB, Model API 398.1/400,
checkpoint store 186.8/225. Six real built-module controls passed. The
fixture-only `e908e825` rebind has identical production/native/script/package
inputs; all five types, lint, whole duplication (605 files, zero clones),
14 locales and 79 controls plus 447 owning tests passed. Three new no-entry
classification removals fired at intended assertions; new loader/Git and
packaging drills are completing in owned disposable copies. These are scoped
results, not full-quality, platform or release/channel certification; those
remain the lead's next gate. No product source awaits a new feature decision.

**Long storage paths (2026-09-30, measured with git 2.52.0.windows.1).**
`core.longpaths` is read only after git has opened the repository, so the
repository's own path must fit PATH_MAX as written: a `GIT_DIR` of PATH_MAX-40
(220) characters or fewer is taken absolute (`'$GIT_DIR' too big` beyond);
written relative, `<git dir>/objects` must still fit in 259 (repository 251 or
less, storage 240 or less); the work tree and a repository being made are
changed into, so 258 or less. No spelling, working directory, gitfile or option
reaches beyond, and the hashed namespace and identity hashes stay as they are.
The old initializer (`shadow-<uuid>.initializing`, 56 characters) also ran
`git init` without the scoped option, which fails from 235 characters; the
frozen 90ff host run hit that at 242 with a repository of only 195. ShadowGit
now makes the repository in a short unique folder in the storage folder itself
(`.i-` plus 12 digits of sha256 of the window's id: same folder, so same volume
through links and junctions, and one atomic rename), with scoped
`core.longpaths`; removes it in a `finally` whether init failed, was cancelled
or lost the publication race; and sweeps one a dead window left once it is
older than `CHECKPOINT_STALE_LOCK_MS`. While the repository path is PATH_MAX-40
or shorter every command keeps the absolute `GIT_DIR` and the work tree as its
directory; beyond that it is named `shadow.git` with the storage folder as
directory, `GIT_WORK_TREE` and `GIT_INDEX_FILE` stay absolute (a relative index
is invalid after git changes into the work tree), and `hash-object`'s file
argument is named in full because it opens files from where it started. A
repository over PATH_MAX-9 or a work tree over PATH_MAX-2 is refused before any
file is made or git is started, as capture refusal `pathTooLong` with UI text
`checkpointPathTooLong` (14 tables, machine-made). PATH_MAX is the platform's
(260, 1024, 4096) unless a test lowers it (`gitPathMax` dep), so both decisions
are by length. No store created by an earlier build is affected (storage of 177
characters or less). Tests: `checkpointLongPaths.test.ts` over real git; the
tests' independent reads use one helper that scopes `core.longpaths`. Sixteen
on-purpose breaks and an equivalence drill (the relative spelling forced across
20 suites) are in the certification record. Limits kept: `git worktree add` and
the workspace-cwd metadata runners cannot use a workspace over 258 characters,
and window presence files are written before the path check.

**Status 2026-09-30: built** on `feature/m72-checkpoints` (PR #55, first built
2026-09-28) and integrated on `integrate/m72-on-24ff` for 0.10.0 (D51,
`docs/certification/m72.md`); not yet merged: the final four-rig gate, hosted CI
and the release are open. The mechanism is a shadow repository in the
extension's own storage, never the workspace's `.git`.

- **Goal.** Undo is cheap, and complete wherever the extension saw the
  change coming; where it could not, it says exactly what it left.
- **Scope.**
  - A checkpoint at each turn boundary, kept in a shadow repository in
    the extension's own storage, never in the workspace's git objects or
    refs, where a push could carry an untracked or ignored secret
    (`.env`). It runs with hooks and fsmonitor off and none of the
    workspace's filters. It includes untracked files.
  - Ignored files the turn itself created or changed are handled too:
    - a file the agent's own edit and write tools change is copied before
      the write, so a restore brings it back;
    - a shell command's changes are found afterwards by a bounded scan of
      size and modification time, when the old content is already gone
      (and Muse Code cannot be paused before its commands). A restore
      deletes the ignored files the turn created and lists the ones it
      changed as not restorable. It never claims more than it did.
  - Other ignored content is left out. Everything is subject to the size
    limits, and the checkpoint names any file it skipped.
  - Restricted Mode, where the extension runs no git, has no checkpoints,
    and the panel says so.
  - Restore files, conversation, or both. A restore goes through Edit
    Review's checks (D27): a file the user changed after the turn, or one
    with unsaved changes, is refused with the reason and listed, never
    overwritten.
  - Redo after a restore.
  - Size limits, and cleanup with the conversation.
- **Backends.** Both. It lives in the extension. Conversation restore
  follows M53, and Muse Code on Windows still cannot fork (sdk #31), so
  there it restores files only and says so.
- **Relation to D46.** D46's rewind stays the conversation's own rewind of
  the edits it recorded; a checkpoint restore also covers what shell
  commands changed, and both use the same confirmation.
- **Acceptance.** Nothing lands in the workspace's `.git`; a restore puts
  back tracked, untracked and pre-copied ignored files, deletes ignored
  files the turn created, and lists what it could not restore; redo
  returns to the state before the restore.
- **Tests.** A temporary repository per test, with drills for the
  workspace `.git` guard and the not-restorable list.
- **Size.** M.
- **Built (2026-09-28).**
  - **Resume 2026-09-29 (`e73e8549`, safe-availability verification pending; integration open).** Finish the
    existing shadow-ref redesign rather than reintroduce `store.lock`:
    checkpoint and redo JSON live in their own CAS refs, each window owns
    its index/pins/staged copies and presence, archives are written before
    returning, and prune keeps recent objects while another window writes
    their refs. Port tests that still import the removed lock or read the
    removed `records.json`. Prove independent stores preserve each other's
    records and live captures, ignored preimages survive until their end
    record is durable, archives survive window close, folder preservation,
    stopped restores retain Redo, and localized failures reveal no storage
    paths. Recheck queued/scheduled turn admission and state the remote
    Muse Code event limit honestly. Evidence belongs in `m72.md`; the old
    lock receipts remain historical, not certification of this redesign.
    A restore/redo reserves a single shadow ref by CAS before file work,
    rechecks running windows after admission and lets the reservation go
    only if still its own. Model API turns await their running mark before
    hooks, shell commands or model calls, including queued and scheduled
    turns. Checkpoint identity is the session/turn pair so simultaneous
    windows cannot create two records for one turn.
    A known process that is still alive retains its presence and resources;
    heartbeat age alone cannot prove it gone. Native, unresolved activity and
    unreadable/old presence do not expire, even on owner PID death, without
    confirmed native shutdown. A reused process id can delay ordinary
    fenced-window cleanup; deleting unproved copies or reservations is refused.
    Cleanup defers record deletion and prune while a live restore owns its
    reservation. Admission reserves first, then rereads records/archives and
    pins that fresh source view before touching files, so cleanup cannot
    remove old source blobs during setup.
    A failed ref command is observed before it is called a conflict: if
    the ref already names the exact tree just written, the write succeeded.
    Model API admission awaits an existing turn record, or capture and
    record creation, before edits. The independent resume review also
    requires staging/index enumeration before a fresh presence read, and
    preserving a redo's applied report if trimming its original record fails.
    Failed end writes pin the complete pending record tree under the owning
    window until final persistence, protecting ignored preimages beyond the
    prune grace. Empty-folder cleanup errors after a committed file delete
    are logged without dropping that applied step or its Redo preimage.
    All Model API turns, including paid children and queued child follow-ups,
    await admission and keep their mark until completion. Child records use
    the top parent's session id for archive/retention and their own unique
    turn id, so a child outliving its parent still blocks a restore.
    Fresh host/unit types and nine checkpoint suites pass (111 tests,
    3 POSIX-only skips); the unchanged Model API source passes its full
    301-test owning suite. Independent read-only review closes the storage
    and child-admission findings. Full quality, cross-platform checks and
    the native Muse Code pre-event exclusion limit remain integration work;
    the certification record names the source-bound focused receipts.
    **Safe destructive availability correction (2026-09-29, before code).**
    Stored checkpoint Restore/Redo is offered only for the actual attached
    Model API session. The host and store recheck server-owned session/backend
    admission and trust before mutation; unknown/disconnected identities fail
    closed. Muse Code captures/listing remain read-only. Before any agent
    `muse serve` startup, its manager awaits a persistent native marker in
    existing window presence and checks the shared restore reservation without
    launching Git in Restricted Mode. This applies with checkpoints off and
    remains through native idle/queued/scheduled/child work. Current stores
    attest the startup fence through a fixed presence word; old/unknown peers
    cannot attest it and block destructive operations. Native/unknown presence
    is not discarded on age, extension PID death, host exit or store disposal:
    SDK exit/close proves the server exited, not every native descendant.
    No automatic full native shutdown proof exists here. Recovery requires
    explicit user confirmation that all native workspace work has stopped,
    closing its old window so it cannot republish or restart native work,
    then removing only that exact unsafe presence JSON under `checkpoints/windows`.
    Saved record refs, captures, Redo and history remain. Verify this narrow
    owned-fixture recovery procedure before documenting it. Preserve the
    prior focused receipts as historical,
    add real-storage mixed-window and held-reservation startup tests plus
    fake-host admission/barrier tests and red/restored proof. No new lock,
    dependency, wire field or paid capture.
    The existing atomic writer also receives a synchronous pre-commit check
    for checkpoint writes, after its awaited canonical-path checks and just
    before each rename attempt. Backend/trust revocation during temporary-file
    preparation cannot commit an old restore into a new session.
    The same native barrier also covers the account-only workspace-cwd
    `muse serve` process. No capture proves its autonomous scheduler inert.
    Initialize checkpoint admission before authentication can request that
    host; preserve required auth probes and their cwd. A probe therefore can
    conservatively close Model API restore availability too, as the UI/docs
    must state. Reuse the manager's single admission callback at both spawn
    sites, with no private SDK process handles.
    Locally owned shell/hook work also outlives Model API turn boundaries:
    background commands and `!` commands can run after the parent turn ends;
    SessionStart/SessionEnd hooks can run outside a turn. Extend only the
    existing `withCheckpointCopies` I/O wrapper to publish a unique activity
    mark before `runShell`/`runHook` and clear it after the real I/O promise
    settles. The shared wrapped I/O covers children and stays active with
    capture off. Real-store held-activity tests and red/restored proof must
    show Restore/Redo refusal, startup exclusion under CAS, and no mark
    released at the outer row acknowledgement.
    The existing runner's normal primary exit/drain is not proof that all
    descendants stopped. Without positive locally owned shutdown provenance
    on its internal ShellResult, shell/hook completion first publishes the
    same sticky unsafe presence and only then clears its transient activity
    mark. Current runners provide no such full-tree proof. Active activity
    markers also survive owner death/disposal; they cannot disappear into
    false safety after a crash. Pure file-tool Model API sessions remain
    eligible; commands/hooks/account probes can conservatively close that
    availability. Keep intentional background jobs intact. No automatic
    release, native wire field or new containment framework.
    Independent rereview found two remaining ownership bypasses. Fence the
    existing Model API local stdio MCP factory before actual spawn with the
    same persistent native barrier; adapt only the local spawn seam to await
    it, without protocol/schema changes. Externally managed HTTP MCP services,
    editors and independent processes remain outside this ownership guarantee.
    Also make the surface checkpoint tracker passive for Model API actual
    turns: core admission/end callbacks own their canonical mark and end
    capture. Latch ownership when tracking a session/turn so closing one
    retained surface cannot clear an actual turn still running elsewhere.
    Only pending panel captures remain surface-owned. Real retained-session
    and MCP startup/idle regressions must prove both bypasses closed.
    Current workspace-specific storage also splits fences when two VS Code
    workspace identities name one physical folder. Before store/auth/spawn,
    resolve the native canonical directory and use the existing memory
    workspace-key helper (Windows-normalized/case-folded) under the extension's
    global storage. All current-version windows sharing that canonical root,
    user/profile/global-storage namespace share the existing store/CAS/presence.
    Unknown/unreadable roots fail closed. Preserve old workspace-specific
    stores in place as read-only legacy; use existing record readers without
    prepare/cleanup/migration, show legacy IDs as read-only, never move active
    fences or delete history. Older versions, different profiles/users/machines,
    remote HTTP MCP, independent processes and editors are outside that fence
    guarantee. Real two-identity/native-alias/unknown-root tests are required.
    The factory closure audit also found short CLI skills/import/export and
    sandbox commands, plus extension-managed interactive/auth/MCP/installer terminals.
    Await the same persistent startup marker before execFile or terminal
    creation (a shell profile can run immediately), keeping absent-CLI return
    semantics. Existing callback contracts accept awaited void/boolean
    promises; check the application shutdown signal and manager generation
    after admission before invoking the actual factory. Terminal disposal,
    command exit and owner death do not clear uncertainty. Prove each CLI,
    sandbox and terminal family with held durable admission/real restore refs
    and no-launch after shutdown; no new process-tree framework or wire field.
    The bounded closure search found Create AGENTS.md's `muse init` callback
    too. Gate it through the same native startup path; refusal propagates and
    never becomes absent CLI/template fallback. The explicit pure template
    write uses existing active presence admission, checks shutdown and manager
    generation after the await, and releases only after its FS promise settles;
    it does not promote a process marker. Preserve its Restricted Mode action
    while running no Git there. Test held missing-file lookup, real restore
    reservation and late shutdown before either writer begins.
    The final bounded factory pass includes extension-managed Git worktree
    add/remove: normal repository configuration can run checkout hooks and
    leave workspace-capable descendants. Route only those exact mutation
    argument forms through the existing persistent startup admission; keep
    ordinary Git metadata reads and user hooks unchanged. After admission,
    resolve the owned workspace and Git cwd, verify the cwd contains that
    workspace, and recheck application lifetime/manager generation immediately
    before Git. Pass that checked canonical cwd to the actual runner; a
    retargeted caller alias must never select another repository after the
    check. Prove a real post-checkout canary, refusal under a real restore
    ref and no Git after late shutdown. Freeze this writer inventory before
    current-main integration and fresh affected verification.
    Current-main integration adds M79's explicit plan publication and stale
    stage cleanup, plus the existing file-review revert write/delete seam.
    These pure workspace mutations use the same actual-promise file-edit
    lease, including success/failure and held-restore/late-close cases. Keep
    M79's captured owner/trust/lifetime checks and no-clobber/inode cleanup
    intact; admission does not grant ownership of another writer's stage.
    Automatic prompt environment status/log can also execute configured Git
    fsmonitor, signature or clean/process helpers. Use M70/M77's scoped
    suppression: empty fsmonitor (legacy-compatible), signature/maintenance
    off, and bounded names-only filter discovery with per-command clean,
    process and required overrides. Keep ordinary user Git unchanged. Each
    actual metadata process holds existing checkpoint activity through its
    promise and rechecks trust, lifetime and owned cwd immediately before
    spawn; discovery failure refuses facts, never means no helpers. Harmless
    real helper canaries must execute under ordinary Git and remain absent
    under environment reads; held restore, late trust/lifetime and cwd cases
    prove admission. Keep shared suppression parsing in the existing Git
    module for the later M70/M77 joins, without a new process framework.
    The portable ACP process has no stored checkpoint restore surface or
    VS Code profile namespace. Its required startup policy explicitly records
    that independent-editor boundary; it does not claim shared VS Code
    admission or publish a fabricated fence. Keep the extension's managed
    startup callback required. ACP writes, like other independent editors,
    are outside the current VS Code checkpoint exclusion guarantee.
    The joined M68 conditional file writer keeps its fingerprint, unsaved
    text and captured-owner checks, with M72's preimage wrapper reaching
    `writeFileIfUnchanged` too. Atomic writes retain both live predicates
    after awaits and immediately before rename, and support snapshot bytes
    without changing conditional text/fingerprint semantics. Keep M68's
    shared edit registry, plan captured owner and verify settings/ports.
    Independent joined-main review found plan trust/lifetime withdrawal after
    awaited admission/staging could still publish. Capture the actual plan
    workspace/trust/lifetime predicate, pass it through the existing PlanIo
    edit callback and into native no-clobber mkdir/stage/publication checks,
    and check it immediately before stale-stage removal. Reuse the existing
    staged callback for real held-stage regressions. Restricted explicit
    Revert/template policy stays unchanged; plan saves keep their existing
    trusted-only policy. Preserve M68 captured owner and M79 stage identity.
    The joined restore review also found a saved/dirty file could change
    during atomic staging, after its initial expectation check. Reuse M68's
    conditional writer with a restore-specific current-file predicate, raw
    byte/absent/stat expectations, and fresh dirty/backend/cancel checks at
    publication. Recheck canonical/unlinked deletion destinations after the
    awaited file check, and cleanup folders before rmdir. Preserve executable
    bits and durable partial Redo. Real held-stage edits, dirty editors and
    parent link swaps must refuse writes; document the same narrow last
    comparison-to-syscall residual as the existing native conditional writer.
    The existing readonly menu note remains semantic and keyboard accessible;
    constrain that menu to the viewport and wrap long localized safety/legacy
    reasons. Register native, legacy and narrow read-only fixtures in the
    existing harness inventory so the accessibility gate reaches these states;
    verify actual narrow browser viewport bounds before integration. Reuse
    the existing component and harness.
  - **Where.** `src/host/checkpoints/` (the shadow repository, the store,
    the ignored scan, the records, the port and the tool-write wrapper),
    `src/core/checkpoints/` (git output parsers and the pure restore plan),
    `src/host/conversation/conversationCheckpoints.ts` (a conversation's
    captures, restore, redo and notices), the protocol's `restoreFiles`,
    `redoRestore` and `checkpointState`, and the user card's menu.
  - **When a capture is taken.** Before a message that starts a turn is
    sent, so the turn's first edit cannot precede it; the turn takes the
    oldest waiting capture, whichever of its start and its acknowledgement
    comes first. A turn no message of the panel started (a queued message,
    a scheduled run) is captured when it starts. Model API admission waits
    for that capture and record before edits; Muse Code events cannot wait.
    Each turn's end is captured too, including a turn the backend
    stopped (D25), a conversation that left the panel and a panel that
    closed. A steered message takes none.
  - **What a restore undoes.** The difference between the chosen turn's
    start capture and a capture taken now, less every path that changed
    between the conversation's turns or after the last (the user's work)
    and every path another conversation's turn changed while one of these
    ran (their times overlap), refused as "changed by something else in the
    meantime". Ignored files follow the turns' recorded changes, with the
    stat continuity check between turns. A path added since the checkpoint
    that the restored ignore rules name was an ignored file then and stays.
    A link, a folder link or junction (Git for Windows walks into one, so a
    capture drops every path under it), a file over 16 MiB and a nested
    repository are left out and named. Folders a restore empties are
    removed only if they were not there at the checkpoint: git trees hold no
    empty folder, so the capture before a turn also records the folders it
    holds no file of (`ls-files --others --directory`, an untracked folder
    listed whole standing for everything below it, plus the ignored and
    linked ones; up to 10,000, past which, or for a record without the
    list, a restore removes no folder). Limit: a folder the turns made
    inside a listed folder counts as there (the listing collapses an
    untracked folder), so it is left, empty. HEAD, the index, the stash and
    branches are never touched.
  - **Windows sharing a store (2026-09-29 redesign).** Each window owns
    its index, pins, staged copies and atomic presence file. Checkpoint and
    redo JSON live inside trees under `refs/muse-spark/record/<id>`; updates
    and deletions compare the previously read ref, and a checkpoint's id is
    derived from its session/turn pair. Independent windows cannot overwrite
    each other's records or create duplicate checkpoints for one turn. A
    restore/redo claims `refs/muse-spark/restore-active` by CAS, rechecks
    running windows, and releases only its own value; a crashed reservation
    is taken over only after its owner's presence is gone. Every store
    publishes presence before creating its refs. Shadow initialization uses
    a private completed directory then an atomic rename, so two first uses
    do not race Git's configuration or hook templates.
    - Panel submissions await a running mark. Model API turns additionally
      await admission before hooks, edits or requests, including queued and
      scheduled runs, and refuse a failed mark. Muse Code's remote events
      cannot delay its engine; exclusion before an autonomous start event
      arrives remains unverified, so its destructive checkpoint operations
      are unavailable. Locally owned shell/hook activity and account-only
      serve are fenced too; unproved shutdown keeps them unavailable until
      exact confirmed recovery, as stated in the README.
    - Tool preimages stay until the end record persists. A failed end write
      keeps its completed boundary and copies; the next store operation
      retries that metadata without capturing later user edits. Presence
      retains that unfinished end until it persists.
    - Archiving writes a separate atomic archive file before returning,
      including in Restricted Mode. Every window hides older captures at
      once; trusted cleanup deletes their record refs. Prune retains objects
      younger than `CHECKPOINT_PRUNE_GRACE_MS` (one hour), so another window's
      in-flight objects are protected.
    - Closing stops file work before the next mutation, finishes only Redo
      metadata and reservation release, then removes presence and staging.
      Presence remains live until in-flight work settles. Empty directories
      present at the original boundary are preserved as before.
  - **Each step** (review of 4ce27cb8): the redo record of every step is
    saved, with its keep ref, before the first file changes; `.gitignore`
    files are written first, then the ignore check (paths given as `./…`,
    never pathspec magic), then deletions, then writes, so a case-only
    rename and a file↔folder swap come back. Just before its step each file
    is re-checked: unsaved in an editor or notebook (asked again), its
    canonical path equal to the canonical root plus the path (no link or
    junction on the way), and its content the blob (SHA-1 computed in
    process), absence or size-and-time the plan expects. A step that fails
    or throws is reported as "could not be changed"; the record is then cut
    to what was done. Blobs are read in batches of at most 32 MiB. Writes
    keep the file's permissions and set only its execute bits.
  - **Redo** records what the restore replaced and what it left, and puts
    back only files still as the restore left them. A redo is recorded the
    same way, so it can be redone. What a redo could not do stays in its
    record (the button stays); a spent record is deleted. The button waits
    for the host's answer.
  - **Turns running.** A restore or redo waits for no turn: it is refused
    while any turn of the window runs (recorded or not, checked again after
    the confirmation). A turn whose end was never recorded makes its
    restored paths "unsure", named in the notice.
  - **Rewind conversation and restore files** is one action: one modal that
    names both, the conversation's checks (M53) before any file changes,
    the restore, and the rewind only when every file was restored; the
    report is posted after the fork so the new transcript carries it and
    its Redo (tied to the restore's id, not the conversation). **Fork
    conversation and rewind code** is one `rewindCode` message with `fork`:
    confirm, revert, fork.
  - **Cleanup.** Every window open (activation and trust granted) runs
    `maintain`: stale git locks older than five minutes (more than git's
    two-minute timeout) are cleared, keep refs no record names and the pins
    and tool copies of windows that are gone dropped and pruned, and
    retention applied with the setting on or off. Archiving in Restricted
    Mode drops the conversation's records at once with no git (under the
    store lock); its refs go at the next trusted `maintain`. Captures are
    pinned until recorded or let go; a capture older than its
    conversation's archive is not recorded. Closing the window ends every
    git still running and removes its presence. The folder is 0700 on POSIX.
  - **The menu.** A turn with a checkpoint (its first card) offers **Restore
    files to here** and **Rewind conversation and restore files** beside
    M6's fork, M53's rewind and M13's code rewind; a turn without one keeps
    M13's **Fork conversation and rewind code**. Disabled rows say why a
    choice is missing (Restricted Mode, the setting off, git not on `PATH`,
    Muse Code on Windows); a turn offers **Restore** only while checkpoints
    are on. **Rewind code to here** now asks in the same modal.
  - **Bounds.** 50,000 files outside the ignore rules and 512 MiB of changed
    files per capture (beyond them the turn has no checkpoint and the panel
    says why, once per conversation and reason); 16 MiB per file; the
    ignored scan at 5,000 files, and an ignored folder over 1,000 files left
    out whole; 500 ignored changes per turn. Retention: 100 checkpoints per
    conversation, 50 conversations, 20 redo records per conversation, and
    `museSpark.cleanupPeriodDays`. Archiving a conversation deletes its
    checkpoints and prunes at once; retention prunes at most every ten
    minutes.
  - **Setting.** `museSpark.turnCheckpoints`, machine-scoped, on by
    default.
  - **Limits (resumed candidate).** A Muse Code queued or scheduled turn's
    capture races its start (the remote backend does not wait), so stored
    destructive Restore/Redo is available only to an actual attached Model
    API session with confirmed process safety. Native/account and local stdio
    MCP startup, or shell/hook completion without full-tree proof, durably
    closes that availability. Unknown/crashed activity never expires into
    safety. Current-version windows sharing the canonical first folder and
    extension global-storage namespace coordinate across workspace identities;
    older versions, other profiles/users/machines, independently managed
    editors/processes and remote HTTP MCP services are outside that guarantee.
    Saved old workspace-specific history remains read-only. On Muse Code
    the extension cannot copy an ignored file before the CLI's own tools
    write it, so such a change is listed as not restorable. Failed end
    persistence freezes the original end boundary and staged preimages until
    retry is durable, keeping restores refused in the meantime. A file swapped between its
    re-check and its write is the same residual as the Model API tools'.
    Dirty notebooks are read from VS Code's notebook documents, which the
    unit tests do not reach (extension wiring). The first capture of a
    large workspace hashes all of it once.

### M75 — Paired efficiency evaluation (D49)

**PR63 second review round and the 0.10.0 merge (2026-10-01):** main
(`90ec399e`, 0.10.0 and the npm path fix) merged in; its [Unreleased]
`### Fixed` kept, M75's entry under `### Added`. Three threads closed:

- **No credential variable in the model's shell commands.** Both live
  harnesses build their tool access through `liveToolIo`
  (`test/e2e/evalLiveSupport.ts`), whose environment is
  `withoutCredentials(process.env)`, as for every process the ACP agent
  starts; the cards are allowed without a person reading them, so another
  provider's key in the owner's shell must not reach a tool's output.
- **Arms take turns going first.** The task at index i starts with arm
  i mod arms, so the prompt cache a task's first run warms (the same system
  prompt and message) is not credited to one arm; each v2 result records
  its `order` (1 = first), shown in the report, absent from v1.
- **The task selection is read inside the enabled test only**
  (`liveEvalSelection`, which refuses while live tests are off without
  reading anything), so a stale `MUSE_EVAL_TASKS` cannot fail the default
  run; the outer deadline allows the whole task set.

**PR63 final review, 2026-09-30 (repairs pending):** close the four reported
boundaries before merge. The opt-in live evaluator reads its credential from
the existing secure credential-store API inside the enabled test; it never
loads a key from its initial environment, arguments or a fixture. The same
arms list determines both execution and the outer task-by-arm deadline;
individual turn and verifier limits stay unchanged. Workspace-creation
failures retain cleanup but expose only bounded fixed error information,
including failures before a workspace object can be returned. Preserve the
authentic version-1 baseline byte-for-byte; version the expanded report as 2,
parse the legacy fields as genuinely unrecorded and render them truthfully.
Add ordinary mocked regression controls and deliberate failure proofs, then
repeat exact-tree local/platform/independent/hosted gates. No live or paid
evaluation is authorized by these repairs.

- **Main 327 update plan (2026-09-30; source only).** Preserve the f7
  candidate and original dirty source, then replay the approved continuation
  through a normal merge of `32709441`. Retain M68's actual-send guards,
  check registry, conditional tool I/O and canonical runtime. Reconcile
  the eval client-settings helper with M68's canonical fake key/account
  ports; keep the wire `3b81e698` and test `9cf294e0` bytes unchanged.
  No QA or model run is performed by this source preparation.
- **Current-main preparation (2026-09-30; verification held).** Join
  main `f7db5715` through a normal pending merge and retain the original
  ten-file approved continuation, including `wire.ts` source hash
  `3b81e698` and its `9cf294e0` regression tests. Reuse M76's already
  prepared current-host driver/test ports for code intelligence, repo-map
  and web fetch defaults; do not replace this harness with an older host.
  Preserve finite/safe-integer usage validation and the shared unknown
  liability flag that stops later model calls after ambiguous sent usage.
  The ten-task, 39-request historical report remains historical. New
  current-main compiler, behavior, red and aggregate/platform evidence is
  still required. No new model run is authorized by this preparation.
  **Resume review 2026-09-29:** the ten-task baseline exists at `f3e6bb35`
  (39 requests, recorded $0.0041); its JSON and Markdown remain unchanged.
  Later WIP changed the harness and does not inherit that live certification.
  Review found invalid negative/cached token counts could lower its budget, and
  sent requests with missing usage could leave later tasks free to keep sending.
  Reject invalid counts and close the shared run budget when sent usage is unknown;
  recheck after an awaited request body before sending. Fresh tests, deliberate
  red proofs, full rig gates and contemporary paired evidence remain required.
  Independent review also found the non-Request send reused mutable original
  arguments after validation; always send the validated `Request` snapshot.
  The final independent review found fractional and unsafe integer token counts
  still passed the eval bridge. Require nonnegative safe integer input, output
  and cached counts, retaining cached <= input. Raw nonfinite SSE usage must
  retain unknown liability and refuse the next shared-budget arm. The old-base
  Mac refresh passed all 91 eval tests before/after six assertion-failing
  mutations, host/unit types, scoped lint/format and duplication; receipt
  `m75-count-boundary-preliminary-fix/receipt.json` records exact restoration.
  The prior 81-test Mac receipt remains historical evidence for its exact source.
  Current-main integration and full rig gates remain required.

- **Goal.** A harness change is measured before it is trusted.
- **Scope.**
  - A task set: repository fixtures with verifiers, split into accept and
    held-out tasks.
  - Paired runs with and without a mechanism, on the contributor model,
    on the Model API (Muse Code's harness is not ours to vary).
    M75 is built first in wave 3: it lands with a baseline run, and M73
    and M74 then use it for their own paired runs before they ship.
  - Capability floors fixed in advance; tokens, cost and the pass rate
    recorded.
  - Attempts counted from the trace.
  - A report in `docs/certification/`.
- **Rules.** Runs follow the live-spend rules: an empty workspace, the
  contributor model, counted and reported.
- **Acceptance.** The baseline run is recorded with its attempts; a
  mechanism below a floor fails its run.
- **Tests.** The runner and its verifiers against the fake Model API; the
  live runs are the evidence.
- **Size.** M.
- **Status.** Built on `feature/m75-eval` (2026-09-28). A first draft
  (Muse Code, contributor model) drove a small tool loop of its own with
  three file tools and in-memory fixtures, judged by string matching, and
  committed a fake-API run as the baseline; the review replaced all
  three, since a mechanism M73 or M74 adds lives in the extension's
  harness and the draft's loop could not carry it. What landed:
  - `src/core/eval/`: the task set (`tasks.ts`), a task's folders and its
    verifier (`workspace.ts`), the trace (`wire.ts`), one turn on the
    harness (`driver.ts`), the paired runner (`runner.ts`) and the report
    (`report.ts`); the `EVAL_*` constants and `MODEL_TEXT.evalClarification`.
  - `test/unit/eval/` (60 tests on the fake Model API, the real
    `ModelApiHost`, the real tool I/O on disk and real verifier
    processes) and 15 red drills (docs/certification/m75.md).
  - `npm run test:e2e:live:eval` (`test/e2e/eval.live.e2e.test.ts`),
    opt-in like the Model API sweep. The baseline, all ten tasks on
    the contributor model, passed 10/10 in 39 model calls for $0.0041,
    verdict `pass` (`docs/certification/m75-baseline.json` and `.md`),
    after a first run of two accept tasks (6 calls, $0.0009).
- **Decisions.**
  - **The harness under test is the extension's own.** Each task runs a
    `ModelApiHost` (the system prompt, tools, permission engine and loop
    users run) with the task's prompt as the user's message. A mechanism
    is a change to the host's dependencies (`EvalHostChange`), so the two
    arms of a pair differ in that alone; M73 and M74 add their arm to the
    live file with their runs. Only the panel is replaced: a card is
    allowed once (Auto mode, so only shell commands and protected writes
    ask), a question is answered "proceed", and no paid feature is on or
    allowed (D48): a paid use that happens anyway fails the task.
  - **An empty workspace per task.** A fresh folder under the system's
    temporary folder per task and arm, holding the fixture files only
    (each fixture is an ES module package), removed afterwards. Nothing
    from the owner's profile (personal skills, memory, hooks) reaches the
    prompt.
  - **Verifiers judge behaviour.** Each is a Node module run after the
    turn beside the workspace (the model never sees it), in its own
    process with an empty environment and a time limit; it imports the
    fixed files and asserts what they do, so any correct fix passes.
    Every verifier is proved to fail its defect and to pass two
    spellings of the fix.
  - **Attempts from the trace.** Every request goes through the run's
    `fetch`, which records method, path, model, status and the usage
    Meta returned; attempts are the `POST /responses` sent, retries and
    any call a mechanism adds included. It refuses, without sending, a
    model call on any model but `muse-spark-1.3-contributor`, any other
    host, and everything once the run's estimate passes $0.50.
  - **Floors 0.75 / 0.75**, fixed in advance: 5 of 6 accept and 3 of 4
    held-out tasks must pass, on every arm, the baseline included (a
    task set the baseline cannot pass detects nothing). A split that did
    not run holds no floor: such a run is `incomplete`, never `pass`.
  - **Paired task by task**: each task runs on every arm before the next,
    so both arms of a pair share the conditions of the moment.
  - No new setting, command, panel string or paid feature: the
    evaluation is developer tooling. M73 and M74 add their own
    off-by-default settings with their passing runs.

### M73 — Observation packing (D49)

- **First review (RV73) repaired, 2026-10-02.** Four findings, each with a
  regression and red drills (`docs/certification/m73.md`):
  - A recalled page is framed as untrusted tool data (D49 "Untrusted
    content"): it names the tool its call named, carries the notice, and
    sits between fresh random markers outside the unchanged slice, so an
    interior page of a `web_fetch` result keeps its boundary.
  - The ledger survives resume: the stored session keeps an optional
    `packedTokensAvoided` (a non-negative whole number; older files resume
    at zero), restored into the store while the outputs and their send
    counts start fresh.
  - The live run records its packing acceptance in the report
    (`packingEngagement`, verdict `fail` when a long-output task never
    packed) before it prints or writes it.
  - The recall row's heading and refusals are `UI_TEXT` in all fifteen
    tables, counts through `Intl`; the recalled text is shown as it was
    and the model's text stays `MODEL_TEXT`.
- **Main integration, 2026-10-02 (M73m).** Merge `origin/main` at
  `44b76f24` into `feature/m73-packing`, preserving final M75 behavior and
  main's changelog entries. Kubuntu passed the owning M73/M75 suites
  (14 files, 627 tests), all five type projects and the code-intelligence
  fixture, scoped lint, formatting, dead code, duplication, localization,
  host API, cycles and production build. The build needed a private copy
  of the rig's linked dependencies for its path-based bundle-split check;
  no source or gate changed. Results are in `docs/certification/m73.md`;
  full quality and the live paired evaluation remain the lead's gates.
  No live or paid run is authorized.
- **Goal.** Long sessions stop resending large old tool outputs.
- **Scope.**
  - NVIDIA SoL-Pi's ObservationPack design, implemented for the Model API:
    a tool result over a threshold is
    sent whole for its first requests, then as a placeholder with an id,
    size, and first and last lines.
  - `recall_output(id, offset)` pages the original back. Originals are
    kept with the session.
  - The swap is sticky, so the cached prefix breaks once per output.
  - A savings ledger shows the tokens avoided in Account & usage.
  - SoL-Pi's Evidence-Preserving Reducer for long command logs: a
    separate model call that shortens a log while keeping its error
    evidence. It is a paid use (D48) and is under the same gate.
- **Backends.** Model API. Muse Code has no hook for this.
- **Gate.** Built after M75, and lands with its own M75 run. Until that
  run shows the capability floors held, there is no setting and no path
  that packs an observation; then the setting is added, still off by
  default. A failed run reworks the mechanism; it does not ship.
- **Acceptance.** `recall_output` returns the original bytes; the swap
  happens once per output; the ledger matches the tokens left out.
- **Tests.** The fake Model API with long outputs, and its M75 run.
- **Size.** S.
- **Status 2026-10-02: shipped off by default after its M75 run passed.**
  Built 2026-10-01 on
  `feature/m73-packing`, from M75's merged head. What is in it:
  - `src/core/backends/modelapi/observationPack.ts`: one session's store.
    An output over 8,000 characters rides whole for 2 requests, then as a
    placeholder (its call id, characters, lines, a token estimate, its
    first 4 and last 4 lines, bounded under the threshold); the swap is
    sticky, so the placeholder is the same text every request. A request
    counts once it is really sent, at the client's last step before
    `fetch` (`ResponseAttemptGuard.onRequestStarted`), and an HTTP retry of
    the same request counts once. `recall_output(id, offset)` pages the
    original back 4,000 characters at a time, never splitting a character;
    the replay keeps every original (placeholders never commit), so a
    restored session packs again from the whole outputs; a compaction
    forgets the store's originals and keeps the ledger.
  - The host builds the store only while its `observationPacking` dep is
    on and never for a subagent, which is also refused `recall_output`
    (a read-class tool: no card). The dep is read when a session is
    created or resumed: `museSpark.modelApiObservationPacking` (since its
    run passed, below) or the M75 arm.
  - The ledger rides on `tokenUsage` (`packedTokensAvoided`) to Account &
    usage's Tokens section, "Packing saved (estimate)", shown only while a
    session packs; the estimate is 4 characters a token, net of what the
    placeholder still costs.
  - The M75 side: the `packing` arm (`src/core/eval/mechanisms.ts`); two
    long-output tasks in the task set (`accept-long-middle-value`,
    `heldout-long-middle-rule`: a 512-record evidence file whose middle
    record is needed after two more requests), so the set is twelve tasks,
    seven accept and five held-out, under the same 0.75 floors (6 of 7, 4
    of 5); results record the ledger and successful recalls; the live run
    passes only if packing engaged on every long-output task it ran
    (`unengagedLongOutputTasks`).
  - **Not built: the Evidence-Preserving Reducer.** The evaluation refuses
    every paid use (D48), so it cannot measure a paid reducer, and the gate
    forbids shipping what is not measured (§3).
  - **The M75 run passed (2026-10-02, after the RV73 repairs):** both
    arms 7/7 accept and 5/5 held-out against the 0.75 floors, packing
    engaged on both long-output tasks, 111 model calls on the contributor
    model for $0.0156 (`docs/certification/m73-run.md`). On the long-output
    tasks packing sent 39% fewer input tokens at about the same cost: what
    it leaves out was mostly read from the cache. So, as the gate says,
    the setting was added, off by default and machine-scoped:
    `museSpark.modelApiObservationPacking` (VS Code only; the ACP agent
    does not pack).
  - The WIP of `integrate/m73-m75-join-20260930` (staged tree `d52b6a9a`)
    is archived as `_archive-2026-10-01/m73-m75-join-wip`; what was kept
    and dropped is in `docs/certification/m73.md`.

### M74 — Long tasks: automatic compaction and handoff (D49)

**Main merge, 2026-10-02 (M74m).** Merge `origin/main` at `2a03a79b`
(M84, M75 and 0.10.1) into the handoff branch at `aa37274e` (`91329eb8`),
then include PR #74's documentation audit at `2067d2f9`. Keep both
features and the released changelog unchanged. Share files join the
handoff's one-modal rule: a waiting or edited brief stays in state while
the share is open, then opens with focus when it closes. Both arrival
orders have regression coverage. Current merge evidence is recorded in
`docs/certification/m74.md`; the full four-machine gate remains the lead's.

**Status, 2026-10-02 (this tree, `feature/m74-handoff`).** Manual
`/handoff` is built: ported onto the release candidate (`41ed14bf` on
`8e9d3a1e`), fixed for the ten findings of the RV74 review (one commit
per finding), for RV74c's (a refusal at the sign-in guard answered, one
modal at a time, the withdrawn-distillation guard tested) and for
RV71x's (Cancel and Start while admission is held: the handoff as one
owned operation), and merged with `main` at `3614409e`, its shared-table
fixes kept as `main` has them (certification
`docs/certification/m74.md`). Automatic compaction, the hidden todo
follow-up and the memory flush are not built (see "Not built" below), so
M74 is not complete. On this tree the M74 test files (nine files, 791
tests with the M45 goal fixes below) pass on the kubuntu and Mac mini
rigs; every M74 guard was broken on purpose, seen red and restored byte
for byte (sha256), or is recorded as backed by another check (five are;
O17, the one that had neither, now has its test); and the typechecks (host, unit,
webview), `eslint` and Prettier on the changed files, `check:l10n`,
`check:host-api`, `deadcode` and `jscpd` pass on kubuntu, and so did
the `handoff`, `usage` and `agents` accessibility scenarios at RV74c (the
webview has not changed since). The handoff had pushed
`dist/extension.js` and `dist/modelApi.js` over their caps (601.3 and
401.3 KiB); the lead's fix, the shared English table
(`build/shared-ui-text`, merged at `f5f9006f`), brings every bundle
within its unchanged cap (on this tree, kubuntu: `dist/extension.js`
531.0 of 600 KiB, `dist/modelApi.js` 328.0 of 400, `dist/uiText.js` 74.3
of 100, `dist/webview/main.js` 782.7 of 900). Where `node_modules` is a
junction (the Windows host) or a link to another checkout (the kubuntu
rig's test worktree), the build's split check reports the page worker's
parser packages missing: esbuild names them by the link's target, outside
`node_modules/`; they are bundled (the certification has why), and the
checks the chain then skips (`check-host-globals`,
`third-party-notices`) pass run by hand. After the shared-table merge the
M74 test files and all 24 checkpoint test files passed on the kubuntu and
Mac mini rigs (the twelve M72 checkpoint failures and the
`checkpointModelApiStop.test.ts` hang seen before it, identical on
`8e9d3a1e`, were gone); the checkpoint files were not re-run for RV74c,
which changes no checkpoint code. Not run here: `harness:shots`, the
integration tests, a production build with a real `node_modules` and
`npm run quality` (the lead's four-machine gate).

- **Goal.** Hours-long tasks keep their thread without a manual
  `/compact`.
- **Scope.**
  - Compaction is considered when a todo item completes. It uses
    SoL-Pi's cache economics with Meta's cache-write to cache-read price
    ratio, and always compacts near the window.
  - A hidden follow-up asks the model to restate its todo list.
  - A memory flush before compaction (OpenClaw). It is a memory write,
    so it asks in Manual and is refused in Plan and Restricted Mode, and
    notes drawn from untrusted content stay labelled as untrusted.
    Compaction summaries keep that label too.
  - `/handoff` starts a new conversation from a distilled brief (Amp).
- **Backends.** Model API. Muse Code compacts itself.
- **Gate.** Automatic compaction and the hidden follow-up are as for
  M73: they land with a passing M75 run, and only then get their setting,
  off by default. `/handoff` is the user's own command, so it ships
  without that gate; M79 reuses its path.
- **Acceptance.** Compaction never drops the todo list or an untrusted
  label; `/handoff` shows the brief before the new conversation starts.
- **Tests.** The fake Model API across a compaction, and its M75 run.
- **Size.** M.
- **Built: `/handoff` only** (certification `docs/certification/m74.md`).
- **Not built: automatic compaction, the hidden todo follow-up and the
  memory flush** (RV74 finding 2). No code, setting or path for any of
  them exists. They are blocked, not put off: the Gate above lets
  compaction and the follow-up land only with a passing M75 run, and the
  flush runs before a compaction. M75 is now built with its baseline, but
  no paired M74 compaction run has passed; and Q-M74 (§3) is open: the
  owner has not chosen the billable-call and consent contract for a
  model call the extension would make outside the user's own turn. So
  the Acceptance ("compaction never drops the todo list or an untrusted
  label") and the Tests ("the fake Model API across a compaction, and its
  M75 run") are not met, and M74 is not complete. `/handoff` ships
  without the gate, as the Gate says.
- **Decisions taken for `/handoff`:**
  - One owned operation per handoff, reserved before any preparation
    await; its session and the conversation's generation stay current
    through preparation, and an ordinary turn that starts meanwhile
    refuses the handoff instead of the distillation steering into it.
    Cancel invalidates a Start until the shared brief path commits the
    new conversation. The reviewed brief's UTF-8 size (256 KB) is checked
    before anything is cleared or sent.
  - `/handoff` (optionally with a goal after it) is the user's own command
    and ships without the M75 gate: it asks the model, as the user's own
    turn in the current conversation, for the distilled brief (goal,
    decisions, files touched, open work, todo list), shows it in a dialog
    before anything starts, and starts the new conversation on confirm
    through M79's `startFromBrief` path (`ConversationBrief`, one path, no
    duplicate) — or cancels and nothing starts.
  - The brief is the reviewed text itself as the first message (no file
    travels); the goal and the open items travel in the model's note, and
    the open items (never completed or dropped ones) become the todo list
    before the first request. The request turn's own card stays in the
    transcript.
  - Untrusted content stays labelled: the request makes the model mark
    tool-output, fetched-page and imported-file content `[untrusted]` in
    the brief, and the seeded note tells the new conversation what the
    label means (D49).
  - **The start mode (RV74 finding 1; the lead's decision, 2026-10-01).**
    The model wrote the brief, so it counts as approved, and starts in the
    starting mode as an approved plan does (`briefMode`: Manual when that
    is Plan, never Bypass in a remote window), only when the dialog showed
    the user all of it before Start: the whole brief, and the open items
    it seeds, which the dialog lists under Tasks, with no character the
    dialog does not show (`hasUnshownCharacters`: a control or format
    character). Otherwise it is untrusted content and starts in the
    asking mode (`untrustedBriefMode`, as a plan picked from Plans…
    does), and the panel names the mode. A handoff from a conversation in
    Plan mode stays in Plan (`ConversationBrief.shouldKeepPlanMode`), whatever
    either rule says.
  - A brief waiting in its dialog comes back to a rebuilt panel
    (`surfaceReady` posts its `handoffReady` again, RV74 finding 3): the
    host keeps the handoff, so without its dialog every later `/handoff`
    would answer "already running".
  - The composer keeps `/handoff …` until the host answers
    (`handoffCommandResult`, RV74 finding 4), as for `/goal`: a refused
    handoff keeps its typed goal; an accepted one clears the draft unless
    it was edited meanwhile. Every refusal answers, the sign-in guard's
    too (RV74c N1): a request or a Start refused while the backend's
    admission is held (a key activation, with the panel still reading
    signed in) gets `accepted: false`, so the command and Start work
    again once admission returns. The same guard now answers M45's
    `goalCommand` too (released behaviour, the same defect; the lead's
    decision, 2026-10-02: its own commit and `[Unreleased] ### Fixed`
    entry; certification `docs/certification/m45.md`, drill G55), and
    so does every exit of the goal command before the host has it
    (admission closing, the account ending or a restart during its host
    lookup; drills G56–G58). One the backend already had when a key
    activation or a restart lands is answered refused too, with
    `goalOutcomeUnknown` (it may or may not have taken effect), and the
    goal is read back from the backend before the conversation's next
    action (drills G59–G61).
  - The handoff is one owned operation (RV71x N5, N6; the lead's rule,
    2026-10-02). Cancel is never auth-gated: releasing an operation the
    panel owns needs no admission. After every await of the request, the
    brief read and Start, one check (`isStillCurrent`: generation,
    session, ownership and admission) runs, and nothing is cleared or
    left before it passes; Start's lives in the shared `startFromBrief`,
    so M79's Implement gets it too. A refusal for admission leaves the
    operation waiting with its dialog intact: Start works again once
    admission returns, and a brief whose read admission put off is read
    on the next `/handoff` or a rebuilt panel.
  - One modal at a time (RV74c N2): a brief that arrives while Account &
    usage, the Agent map or the install confirmation is open waits,
    unmounted, until that dialog closes, then opens with the focus, so
    its Start is never reachable under a dialog that hides it. Closing
    the handoff dialog (Cancel, or the new conversation clearing it)
    hands the focus back to the prompt, as the other dialogs do.
  - Model API backend only: on Muse Code the command says it is
    unavailable there. Side chats are refused; one handoff runs at a time;
    a `/handoff` while a reply runs is refused ("Wait for the reply to
    finish, or stop it, first."; nothing waits or queues, RV74 finding 8);
    an oversized (over 256 KB) or empty brief is refused with the reason.
    No new setting: nothing automatic runs.
  - A built-in `/handoff` takes the name from a skill of the user's or the
    project's own called `handoff` (RV74 finding 10; no skill or command
    Muse Code 1.4.0 ships is named so). The lead's rule, 2026-10-01:
    built-in command names win over a user skill of the same name, as
    `/goal` does; no code change.
  - The port's history (the four conflicts, the merge fixes) is in the
    certification. No escape hatches (§8: nothing to record).

### M76 — Custom agents (D49)

- **Goal.** Specialised agents with their own prompt, tools, model or
  effort, and permissions.
- **Scope.**
  - Agent definitions in Markdown with front matter, in the project and
    the user folder. The folder follows Muse Code's own convention if its
    binary or docs name one (D13: no invented file names); otherwise the
    name chosen is recorded in D13 as the extension's own. Claude Code's
    and Codex's formats are imported (M83).
  - Built-in agents:
    - **Explore**: read-only, context-saving;
    - **Reviewer**: built in M70, and becomes the first definition in
      this format;
    - **Second opinion**: a high-effort consult on a hard question.
  - A run that makes model calls beyond the user's own turn is a paid
    subagent use (D45, D48).
  - A repository's agent files load only in a trusted workspace, and can
    only narrow the tools and permissions the session already has. A
    model one names passes the same checks as the user's own choice
    (`allowsModel`: contributor models, `museSpark.confidentialWorkspace`).
- **Backends.** Model API. Muse Code has its own agents, which the
  Agent map already shows.
- **Acceptance.** An untrusted workspace loads no project agent; a
  project agent that asks for more tools or permissions than the session
  has gets the session's; a model it names passes the user's checks.
- **Tests.** Front-matter parsing with zod, and drills for each narrowing
  rule.
- **Size.** M.

### M77 — Session board and best-of-N (D49)

- **Goal.** Run several agents at once and pick the best result.
- **Scope.**
  - A board of every conversation in the window and its worktrees: state,
    branch, changes, awaiting approval.
  - Best-of-N: the same prompt runs in N worktrees, with a side-by-side
    diff comparison and "take this one".
    - Each attempt is M71's conversation in a worktree, with its own
      host confined to it.
  - Best-of-N is on the Model API only: each attempt is billed to the
    key, and the subscription never pays for a paid use (AGENTS.md rule
    12). It asks once (D48) with the rates, N and a request ceiling per
    attempt, since the total cannot be known in advance (D45).
  - Worktrees need git, so best-of-N is unavailable in Restricted Mode.
- **Backends.** The board: both. Best-of-N: the Model API.
- **Acceptance.** Best-of-N asks once with the rates, N and the request
  ceiling per attempt; "take this one" merges only that worktree's
  changes; the board shows every conversation's state.
- **Tests.** The fake Model API with N attempts, and the board in the
  harness and the accessibility gate.
- **Size.** L.

### M78 — Auto, made safe (D49)

- **Goal.** Auto on the Model API earns its name.
- **Scope.**
  - **Command rules**: prefix rules for allow, ask or forbid, with tests
    kept beside the rules.
    - An allow rule matches only a command the shell's own parser reduces
      to simple commands (bash's, or PowerShell's AST), each judged
      alone. Anything else asks: substitutions (`$()`, backticks),
      redirections, background `&`, newlines, `iex`,
      `-EncodedCommand` and the call operator.
    - A forbid matches anywhere in the command.
    - D24's session rules stay keyed on the exact command line. These
      prefix rules are a new, user- or machine-level kind, and D24 is
      amended to name them when M78 lands.
  - **Permission profiles**: named sets of rules covering files (deny-read
    globs) and extra roots. They bind the file and fetch tools. The shell
    tool runs unsandboxed, so under a profile every shell command asks.
  - Rules and profiles live in user or machine settings. A repository's
    can only tighten them.
  - An opt-in **Auto reviewer**: a separate read-only model call judges a
    risky request. It has a circuit breaker, and it is a paid use (D48).
    It can turn an ask into an allow only for a request no rule settled;
    it can never allow a forbid, an ask rule, a protected write (D24) or a
    paid call. A failed call or a tripped breaker falls back to asking.
- **Backends.** Model API. Muse Code has its own policies.
- **Evidence.** Codex's auto-review and rules, OpenCode, Gemini CLI's
  policy engine.
- **Acceptance.** Each rule ships with its tests; a chained, substituted
  or redirected command asks; a repository's rules cannot loosen the
  user's; the reviewer never allows a forbid, an ask rule, a protected
  write or a paid call.
- **Tests.** A table of commands per shell with the expected verdicts, and
  drills for the parser fallback and the reviewer's limits.
- **Size.** M.

### M79 — Plans as files (D49)

**Continuation review, 2026-09-29 (verification held).** Recheck current
workspace trust and controller disposal after saved-plan lookup and the
save confirmation, before writing or starting a brief. A conversation
change alone still permits the already approved plan to be saved; it does
not permit implementation in the replaced conversation. Check the
no-clobber creator's canonical directory before recursive mkdir as well
as after creation and before publication, so a swapped ancestor cannot
create a folder outside confinement before being refused. Held lookup/
modal trust/disposal regressions and a real-disk pre-entry ancestor swap
must fail deliberately and pass restored before this source is certified.
The same no-clobber helper records its stage's dev/ino, checks ownership
before publication and every cleanup retry, and preserves a moved stage
or a replacement file. Stale-stage cleanup rechecks canonical confinement,
identity and captured modification/size metadata before removing a
candidate; a refreshed file is kept. Real-disk replacement, folder-swap
and refresh regressions cover these admitted cleanup repairs.
The 2026-09-29 local proof is preliminary on integrated base `4c35e73e`:
all five type projects, 341 focused tests (one platform skip), scoped lint
and zero duplication passed; six isolated mutants fired all ten new
cases and all three repaired suffix-boundary cases, with 50 filtered
tests restored green. Main has since advanced through M69, so its content
must be included and final gates repeated before merge. The later M68
join must wrap actual canonical plan publication in shared WorkspaceEdits
begin/finally-end for all ledgers and note the owning round only when
no-clobber creation returns true; that API is not copied into this base.

**Status 2026-09-29: built on `feature/m79-plans-as-files`, reviewed and
pushed as draft PR #53; certification and review fixes are in
`docs/certification/m79.md`. Hosted Windows quality failed when the
100-name exhaustion test exceeded its unchanged 5-second timeout. Resume
repair passed focused Windows tests: the complete suffix range is proved
with the existing in-memory file port, including the last free name,
exhaustion without replacement and
reuse at the last name; retain the real-file-system publication,
collision, cleanup, bounds and junction tests. Latest-main integration,
independent review and the full candidate gates remain required.**

- **Goal.** A plan the user approved survives and can drive a clean run.
- **Scope.**
  - A Plan-mode reply that holds a plan gets **Save plan** and **Implement
    in a fresh conversation**; pressing either is the approval.
  - The plan is saved as Markdown in the workspace: in Muse Code's plans
    folder if its binary or docs name one (D13), otherwise a folder
    recorded in D13 as the extension's own. On Muse Code, what marks a
    plan in a reply comes from a capture (AGENTS.md rule 13).
  - "Implement in a fresh conversation" starts one with the plan as its
    brief, through M74's `/handoff` path.
  - On the Model API the plan's steps become the todo list. On Muse Code
    the todo list is the agent's own, so the brief asks it to take the
    plan's steps as its list.
- **Backends.** Both.
- **Acceptance.** The saved file is the plan the user approved, byte for
  byte; the fresh conversation starts with it and nothing else from the
  old one.
- **Tests.** Both fakes.
- **Size.** S.
- **Research.**
  - **Muse Code 1.4.0**, one live Plan-mode turn (`denyUnmatched`, the
    contributor model, an empty folder, 19 model attempts). The model read
    its bundled `plan` skill and delivered the plan as an ordinary
    `agentMessage`, wrapped in the skill's handoff. There was no plan item,
    exit-plan request or approval event; the skill's own approval is the
    user's next message, "go".
  - **MSP 1.3.0** has `session/todoListChanged` but no command that sets a
    todo list.
  - **The Model API harness** has no plan tool.
- **Decisions.**
  - **The approval.** "Save plan" and "Implement in a fresh conversation"
    appear under the latest Plan-mode reply once no turn runs; pressing
    either is the approval. The host reads the reply back from the backend
    (`readSession`) on every press and takes it only while it is the latest
    finished reply, after the latest prompt, in Plan mode, from a turn this
    panel started in Plan mode that stayed in it (a message steered into a
    running turn does not make it one). The webview's ids only name it.
    - After a restart (a setting, trust granted, the host gone) the
      conversation is resumed first (`resumeTarget`); when the panel no
      longer holds it, the press says so. History mode `none` says the
      history was not served.
    - A second press finds the file already holding the same bytes and
      writes nothing; a plan over 256 KB is refused at save.
  - **The file (D13).** Muse Code's own convention:
    `.agents/plans/YYYY-MM-DD-<slug>.md`, a numeric suffix on a taken name,
    the plan byte for byte.
    - Between a Muse Code plan reply's two captured handoff lines;
      otherwise the whole reply.
    - The slug comes from the top-level heading, else the prompt.
    - No front matter, so the title lives in the file name, and the source
      conversation's session id in the log line that names the file.
    - It is published by a hard link from a hidden stage, so it never
      replaces a file (`createFileExclusively`, shared with memory). A file
      system without hard links refuses the save. A stage the OS holds is
      removed again; one left by a crash is swept after five minutes.
    - It is confined to the workspace's own `.agents/plans`; a link or
      junction there is refused, and the folder is checked again after it
      is made and before the link (memory too), so a swap after the check
      is refused. Node cannot link relative to a folder handle, so a swap
      between that last check and the link is outside the guarantee.
    - `.agents` is a protected path (D24), so the save asks in a modal.
    - Restricted Mode refuses it.
    - The log names the file by a short hash of its name, after its day
      only when the name verifiably starts with a real one (a file someone
      else put there may be named anything), never the slug (M39).
  - **The brief.** "Start a new conversation from a brief"
    (`ConversationBrief`, `startFromBrief`) is its own piece, for M74's
    `/handoff`.
    - The attachment is checked before the old conversation is left.
    - The conversation is then cleared (History keeps it), Plan mode gives
      way to the starting mode, and the brief goes as the first message.
      Its card is the host's `briefSubmitted`.
    - The plan file travels as named text on both backends (M54), after an
      English MODEL_TEXT request and before a MODEL_TEXT note; the card
      shows the localized text.
    - Nothing else from the old conversation comes along: no editor
      context, no reference, no goal.
    - **Two kinds of brief (D49 "Untrusted content").** A reply saved from
      a Plan-mode turn of the conversation on screen is the plan the user
      approved: its note says so, and it starts in the starting mode
      (Manual when that is Plan, never Bypass in a remote window). A file
      picked from Plans… may come from a cloned repository or a tool: it
      starts in Manual (Plan when that is the starting mode), whatever
      `initialPermissionMode` says, its note tells the model nobody
      confirmed who wrote it, and the panel names the mode.
    - **What the user saw is what the model gets, by construction** (PR
      #53's third review). A plan is parsed with the panel's own parser
      (`mdast-util-from-markdown` with `micromark-extension-gfm` and
      `mdast-util-gfm`, which react-markdown and remark-gfm use), then
      rewritten by `showPlanParts` (`shared/planView.ts`) so that every
      part is rendered text: a link's destination after its text
      (`details <https://…>`), a picture's alt text and source, titles,
      definitions, footnotes, a code fence's whole info string. The panel
      renders the reply the plan actions sit under through that transform
      (MarkdownView's `isPlan`), and the brief is the same tree written
      back with `mdast-util-to-markdown` (`briefText`), for a reply and
      for a file alike. The separate "hidden markup" predicate is gone; a
      jsdom test checks, for a corpus of tricky plans, that every character
      of the brief's text appears in order in the rendered DOM and that the
      brief holds no link, picture, definition or footnote a view could
      show only part of.
    - Raw HTML, which the panel never renders, stays the exception: a reply
      holding it is saved with a warning and not started; the user reads
      the file and starts it from Plans…, as untrusted content.
    - A control character other than a tab or a line break (DEL and C1
      included) or a format character (a direction override, a zero-width
      character) makes the panel paint the plan otherwise than the model
      reads it, which no DOM-text comparison sees: a reply or a plan file
      holding one is neither saved nor started (`hasUnshownCharacters`),
      emoji joined by U+200D and right-to-left marks included, for now.
    - A refused change out of Plan mode keeps the turns it left pending:
      Plan mode was never left on the backend.
    - Implementing a saved plan is refused in Restricted Mode.
    - A brief the backend refuses leaves nothing behind: its chip goes with
      the card, the todo list it set is taken back, and no "started" notice
      is said. A brief overtaken by another action says it was saved but not
      started.
  - **The todo list.** The top-level numbered items, else the top-level
    bullets, outside code; at most 50.
    - Model API: `AgentSession.setTodos`, before the first request, refused
      while a turn runs. The harness does not send the list to the model,
      so the note lists the steps it was set to (cut where long).
    - Muse Code: the note asks the model to take the steps as its list, and
      the panel says so.
  - **Plans…** in the palette lists `.agents/plans/*.md` newest date first
    (names start with the date), to open or implement. A plan file is read
    with the plan limit only, even when it starts like a PDF.
  - **One plan action at a time.** A second press is dropped, and said.
- **Acceptance.**
  - The captured reply saves byte for byte as its body.
  - Implement on the fake MSP host sends the file, the note and the
    display marker in a new `promptUnmatched` session.
  - On the fake Model API, the todo list lands before the brief's request,
    and nothing of the planning turn is in it.
  - Restricted Mode, a no, a stale reply, a side chat, a plan neither
    backend takes and a double press all start or write nothing.
  - A plan from Plans… starts in Manual (Plan when that is the starting
    mode) with the untrusted note, on the fake MSP host.
  - The live Model API case drove the panel's controller (10 requests):
    Plan mode, Save plan, Implement found the file saved and started a
    Manual conversation whose seeded list the model moved to completed.
    Muse Code Implement was not run live; its side rests on the capture and
    the fake MSP host.
  - The harness has `plan`, `plan-brief` (the Model API render: the seeded
    list, all pending) and `plan-narrow`.
- **Left.** None of the milestone. Not taken: the plan skill's precedence
  for a stronger plan location (`specs/…/plan.md`, `docs/plans/`), which is
  the model's judgement, not a fixed name (D13).

### M80 — Headless and CI (D49)

- **Goal.** The agent runs where the editor does not.
- **Scope.**
  - An `exec` mode in the ACP agent's package:
    - a prompt in, JSONL events or a final JSON out;
    - a schema for the output;
    - a budget, kept by reservation as in M82, and an attempt cap.
  - M80 builds on M63 and D61 (PR #32), and on PR #32's amendment of
    AGENTS.md rule 8, which names the OS credential store as the store
    outside VS Code (the one SecretStorage itself rests on) and this
    bootstrap as its one exception.
  - A GitHub Action for PR review and "fix this" comments, on the user's
    own runners and key.
    - It runs only for triggers from the repository's owners, members and
      collaborators, on branches of the same repository. The key is never
      present on a job that checks out a fork's code
      (`pull_request_target` included), and the Action refuses a
      self-hosted runner on a public repository.
    - `exec` denies every approval question, has no shell or check tools
      on PR content, and never uses `--trust-workspace`. A tool process
      it starts gets no `DBUS_SESSION_BUS_ADDRESS` or other route to the
      keyring session.
    - The OS credential store does not protect the key from processes of
      the same user, which is why nothing from the PR runs beside it.
  - **The key follows D61 and AGENTS.md rule 8.**
    - It lives in the operating system's credential store, the one the
      ACP agent already uses (`@napi-rs/keyring`, filled by
      `muse-spark-code-acp auth set` from standard input).
    - Its one way in is `auth set`'s standard input: from the user's
      terminal locally, from the Action's step shell in CI.
    - Inside the agent it is never passed as an environment variable, an
      argument or a file, and never to a process the agent starts (a
      tool, a check, `exec`'s commands).
    - A local headless run reads that entry, like the ACP agent.
    - In CI the Action sets, runs and clears inside one shell: on Linux,
      one `dbus-run-session` that starts and unlocks a throwaway keyring,
      pipes the repository secret into `auth set` through standard
      input, runs `exec`, and clears the entry on exit; on macOS and
      Windows, the runner's own store, cleared in an always-run step. The
      entry's account name is unique to the run, so concurrent jobs and a
      developer's own key on a self-hosted runner never collide.
    - GitHub hands a secret to a step only through the step's
      environment or its script, so in CI the Action's own step shell is
      the one environment the key is ever in. That shell writes it to
      `auth set`'s standard input and unsets it before `exec` starts; the
      shell and `auth set` are the only processes that hold it outside
      the store. PR #32's amendment to AGENTS.md rule 8 names this
      bootstrap as the exception, and nothing else.
    - `exec` cannot show D48's popup or M71's push confirmation, so it
      refuses paid features and never pushes. A "fix this" result leaves
      as a patch, or a commit pushed by a separate step the repository's
      owner wrote.
    - If no store is available, the run stops with that reason; there is
      no fallback.
- **Backends.** The Model API with the key from the store. Muse Code only
  where the CLI is already signed in on that machine; a device sign-in
  needs a person, so it is not offered in CI.
- **Acceptance.** A fork's PR or an outside commenter starts nothing;
  outside the Action's step shell, the key is in no environment, and it is
  in no argument, file or log; no process `exec` starts gets it or a route
  to the keyring; `exec` answers every approval question with a denial.
- **Tests.** `exec` against the fake Model API; the Action's steps in a
  workflow test on the owner's repository, with a drill for the trigger
  check.
- **Size.** M.

### M81 — Browser check (D49)

**Status 2026-10-02: lane A1 of design spec v4 built on
`feature/m81-browser`** (`docs/certification/m81.md`, "v4: lane A1"). The
owner reversed "no bundled browser": the check runs Google's Chrome for
Testing headless shell, pinned per release, behind an owned proxy (D-B1(b)).
Built: the closed failure union (lead ruling v4-M1, first commit); the
proxy boundary (plain HTTP to implicit loopback or explicit hosts, CONNECT
only to explicit hosts, auth stripping, bounds); the resolver map; the
canaries in three phases with the restart tripwire; the two lifetimes
(preparation 15 minutes, check 60 seconds); the runtime store in
`dist/browserRuntime.js` (pin, consent from the host, download, bounded ZIP,
hashes, receipt, publication, verified winner, per-check recheck); the
`browserCheckRuntime` setting and the Download command; release and weekly
pin checks. Captured on the Kubuntu, Mac mini (Intel) and Win11 rigs,
including the forced network-service restart; drilled guard by guard.
Open, the lead's: A2 (Linux namespace, a later lane); the disposable-CI
controls of spec §7 (planted policy, synthetic identities, mTLS, DoH, the
G2 N/N calibration, Windows ambient-auth calibration); a mac-arm64 run (the
Mac mini is Intel); the Download command's VS Code UI run; the aggregate
quality gate on the final tree. The record that follows is the superseded
system-browser design, kept as history.

**Status 2026-10-01 (superseded by A1): built and certified** (`docs/certification/m81.md`),
ported from the 2026-09-28 draft (`b51c5f4c`) and largely rebuilt on the
release candidate; the independent review RV81 (one P1, four P2) fixed the
same day, each with a test and a red drill. Decisions taken while building:

- **Two blocks beyond loopback, and a watch.** The Fetch domain is enabled
  on the browser target, not the page, so it pauses every request of every
  target (the page, frames in other processes, dedicated and service
  workers, each redirect leg; probed on Chrome 150, Edge 154 and the
  154 headless shell), and fails each one that is not http(s) to an
  allowed host. What Fetch cannot see (a WebSocket handshake, a
  preconnect, the browser's own traffic) goes to a proxy that does not
  exist (`--proxy-server=http://127.0.0.1:9`), bypassed only for
  loopback and the allowed hosts; `<-loopback>` removes Chrome's implicit
  bypass, which includes link-local 169.254.0.0/16. WebRTC may not send
  UDP outside the proxy. Every target is watched (RV81): the browser and
  each target it attaches auto-attach every target they start
  (`waitForDebuggerOnStart`, flattened), and each is held until its
  Network events (and Fetch, where it has the domain; a worker does not)
  are on; one whose watch cannot be set up, or one past
  `BROWSER_CHECK_MAX_TARGETS` (64), is never let run. A WebSocket or
  WebTransport beyond the allowed hosts from any of them, or any answer
  from beyond (a response, a redirect), stops the check and returns
  nothing from the page.
- **Refused under a managed proxy policy (RV81).** Mandatory policy
  outranks the command line, so before any browser starts the check reads
  where Chrome and Edge keep it (Windows: HKLM and HKCU
  `SOFTWARE\Policies\Google\Chrome` and `…\Microsoft\Edge`, both registry
  views, through `reg.exe`; Linux: every file in the Chrome, Chromium and
  Edge `managed` folders; macOS: the machine's and the user's forced
  preferences in `/Library/Managed Preferences`, through `plutil`), and
  refuses with a translated reason, starting nothing, if any policy named
  Proxy… or a cloud management enrollment token (also its token file on
  Linux and macOS) is there, or if a location that exists cannot be read.
  Recommended policy ranks below the command line and is not read. Every
  location is read for both browsers, whichever was found.
- **One modal, one scope (RV81).** On Muse Code an open modal is shared
  only by a call of the same URL and the same widening and allowed hosts,
  and the setting is read again after the answer: a call whose scope
  changed meanwhile opens nothing.
- **An ended check sends nothing more (RV81).** A deadline, a Stop, a leak
  or a dead pipe closes the CDP connection at once, rejecting every call
  still waiting, before the browser's kill is awaited; each step checks
  the connection first.
- **Bounds on what the page controls (RV81).** A CDP message's whole
  length is checked against 32 MiB before it is joined or parsed; the URLs
  of requests in flight are kept per session, cut to 500 characters,
  dropped when the request finishes or fails, and at most
  `BROWSER_CHECK_MAX_TRACKED_REQUESTS` (512) at once.
- **Names are never looked up.** Loopback is `localhost`, 127.0.0.0/8 or
  `[::1]` as the URL parser writes them; any other name, including one
  that resolves to loopback, is beyond loopback until the user widens it.
  The draft's DNS recheck is dropped: it sent page-chosen names to the
  resolver and raced the request.
- **Widening.** The machine-scoped `museSpark.browserCheckExtraHosts`
  takes plain host names or addresses only (no port, path, wildcard or
  list separator, since each also goes into the proxy bypass list). A
  card widens one call: on the Model API a host beyond loopback and the
  setting always gets a card, Bypass included, unless the user chose
  "Always allow" for that host on one in this session; on Muse Code the
  extension's modal names the host. Plan and Restricted Mode refuse the
  check; it is a `network` tool, judged per host like web fetch.
- **The screenshot** reaches the Model API model as `read_file`'s images
  do (D47: a user message after the round), not as function output.
  Muse Code gets text only until a capture shows otherwise (rule 13).
- **Lifetime.** A check that ends by itself asks the browser to close,
  then kills it; a deadline, a Stop, a leak or the window closing kills it
  at once with everything it started (`processTree.killTree`). When the
  window itself dies, the browser exits with its pipe (drilled on Linux
  and Windows).
- **Its own bundle**, `dist/browserCheck.js` (D6 amendment), and the shared
  English table (`dist/uiText.js`) taken in as its prerequisite.
- **Left out:** console errors of frames in other processes and of
  workers (their requests are gated, and their failed ones listed); a
  bundled browser.

- **Goal.** The model sees its web change working.
- **Scope.**
  - A tool that opens a local URL in a headless browser over CDP:
    amended 2026-10-02 (design spec v4, the owner's decision reversing "no
    bundled browser"), Google's Chrome for Testing headless shell pinned
    per release and downloaded after consent, not the system Chrome or
    Edge.
    - CDP over `--remote-debugging-pipe`, never an open port, and a
      fresh private profile, never the user's.
    - All traffic goes to the check's own proxy, which passes plain HTTP
      to loopback and widened hosts only, so a page cannot reach the
      intranet or a metadata address and hand back what it found;
      `https`/WebSocket tunnels only to a widened host (opaque: residual
      in §9).
  - It returns a screenshot (image input), the console errors and failed
    requests.
  - It can click or type through a small action list.
  - Local URLs only, unless the user widens that in a machine-scoped
    setting or a card; the model cannot.
- **Backends.** The Model API; Muse Code through `ide`, under D49's rule
  for tools there, once a capture shows that an MCP tool's image content
  reaches the Muse Code model (AGENTS.md rule 13). Until then Muse Code
  gets the console and failed requests as text.
- **Acceptance.** No debugging port is opened; a request beyond loopback
  is blocked unless the user widened it; the user's profile is never used.
  A1 (spec v4): the runtime is the pin's, verified; every canary phase
  holds or the check refuses; a network-service restart refuses; open
  until captured on disposable CI: spec §7's unsafe positive controls.
- **Tests.** A local fixture page with a console error and a failed
  request; drills for the loopback block and the pipe. A1: the proxy, the
  canaries, the lifetimes, the store and ZIP reader on real folders, the
  live suite on the pinned runtime, one red drill per guard
  (`docs/certification/m81.md`).
- **Size.** M (A1: L).

### M82 — Awareness and budgets (D49)

- **Goal.** The user knows what happened and what it cost.
- **Scope.**
  - An OS notification when a long turn ends or waits for approval while
    the window is unfocused.
  - Tokens and cost per reply (optional).
  - A session budget cap, machine-scoped, on the Model API, kept by
    reservation, since a request's cost is incurred once it is sent:
    - before each request, its input is estimated high (the previous
      request's reported input plus what was added since, counted
      conservatively), and `max_output_tokens` is set so that input plus
      output at list price fits what is left;
    - a request that cannot fit is not sent, and the turn stops and says
      so;
    - the only overrun possible is the error in that input estimate; the
      setting's description says so, and the turn's cost after the fact
      is shown against the cap.
  - Cache savings shown in Account & usage, on the Model API only (D26:
    Muse Code reports no honest cache totals).
- **Backends.** Both. Cost is for the Model API.
- **Acceptance.** A request that would not fit the budget left is never
  sent, and the turn says why; no notification shows while the window is
  focused.
- **Tests.** The fake Model API with priced usage, including a request
  whose reservation does not fit.
- **Size.** S.

### M83 — Import from other agents (D49)

- **Goal.** Switching to Muse Spark Code takes minutes.
- **Scope.**
  - Import from Claude Code, Codex and Cursor, beyond M30's skills and
    sessions:
    - MCP servers;
    - hooks, where their events map;
    - custom agents (M76);
    - custom slash commands, which become project skills
      (`.agents/skills/<id>/SKILL.md`);
    - rules files, which become sections of `AGENTS.md`, shown in the
      preview.
  - Preview first, nothing overwritten. The preview shows each hook's and
    server's full command, with secret values masked.
  - MCP servers and hooks live in Muse Code's `settings.json` and
    `.muse/hooks.json`, which the extension never writes (D17, D30). Their
    converted entries are shown, masked, for the user to copy into the
    file the preview opens.
  - Entries found in a repository's `.claude`, `.cursor` or `.codex`
    folder are offered only for that project's files, and only in a
    trusted workspace. Only the user's own folders are offered for user
    files.
- **Backends.** Both.
- **Acceptance.** Nothing is written before the preview is accepted; the
  CLI's settings and hooks files are never written; a project's entries are
  never offered for user files.
- **Tests.** Fixture folders for each tool, and a drill for the scope
  rule.
- **Size.** S.

### M84 — Session export, import and share (D49)

**Status 2026-10-02: the follow-up review RV84c and the Muse review fixed on
`feature/m84-export`; the four-machine gate remains the lead's.** The RV84
findings are fixed one commit each, with tests and red drills recorded from
this tree in `docs/certification/m84.md`, as are the drills of the
2026-09-29 repairs that had not run (R1 to R6). RV84 #10 and #14, open on
2026-10-01, are now fixed too (see "Follow-up reviews" below), as is #9's
single-string residual. The `m84-share.png` capture was taken on Kubuntu
on 2026-10-02 (the accessibility gate passed on its `share` scenario).
Not run on this tree: `npm run quality`, the whole accessibility gate, the
other harness shots and the integration tests. The port had put `extension.js` and `modelApi.js` over
their size budgets. They are back under after merging
`build/shared-ui-text`, the shared English table (`15f847a4`). The
redaction prefilter is proven a superset of every rule (`5df6d5c2`).
History: original `c2eb4da2` and the repair drafts are preserved; the port
to the release candidate is described below.

- **Goal.** A conversation can move between machines and people.
- **Scope.**
  - Export a conversation as JSON. Credentials of a known shape (the log
    redactor's list, `src/core/redact.ts`) and the key digest are always
    left out; account ids and paths are redacted by default. A preview
    shows the file first, since a secret in another shape is not
    recognised.
  - Import resumes on the Model API. It drops the permission mode, session
    rules, goals, schedules and patches, and marks the imported turns as
    untrusted. It starts in Manual, or in Plan when
    `museSpark.initialPermissionMode` is Plan, whatever else that setting
    says; only the user's own mode change relaxes it.
  - A local share file, rendered read-only in the panel.
  - No hosted sharing.
- **Backends.** The Model API resumes; Muse Code exports its own log (M30).
- **Acceptance.** An export never holds the key digest or a credential of
  a known shape (amended 2026-10-01 after RV84 #1: "never a credential" is
  not something a pattern list can promise, so the UI and docs say which
  shapes are removed and that the preview is the check for the rest);
  an import starts in Manual (or Plan) even when the initial mode is Auto,
  Edit automatically or Bypass, with no session rules, goals, schedules
  or patches.
  - **Completion review, 2026-09-29:** finish `transferInvalidField` in
    all fourteen translations. JSON syntax failures expose only an
    existing localized refusal; unknown/invalid field details scrub known
    secrets, paths and account ids before their bounded display. Scrub
    every exported string, including arbitrary item ids and error labels;
    legitimate UUIDs and enum words stay intact. The share view already
    keys items by position and id, and import already mints fresh ids, so
    no new identity format is needed. Extend the existing transfer/import
    tests and prove the four guards fail under mutations before relying
    on them; earlier certificates remain tied to their earlier trees.
    (Done 2026-10-01: drills R1 to R6 in `docs/certification/m84.md`.)
    PR #32 integration must honor `record.imported` in ACP load/resume/fork
    before `matchAdvertised` sets a backend mode; reuse `untrustedStartMode`
    instead of advertising configured Auto/Bypass for imported history.
    A source handoff against `muse-extension-m69-integrate`'s
    `src/acp/agent.ts` is prepared outside the checkout. It passes the
    loaded record's imported flag into adoption and uses the existing
    `untrustedStartMode` before mode matching or replay. Draft tests cover
    imported load/resume after explicit relaxation and ordinary configured
    modes. ACP has no fork endpoint: verify M84's real backend fork/restart
    marker preservation and then safe ACP load of the marked fork.
- **Tests.** Round trips with zod on both ends, and drills for each
  dropped field.
- **Size.** S.
- **Status 2026-09-28: built on `feature/m84-export`; `docs/certification/m84.md`.**
  A Muse Code instance drafted it (contributor model); Claude reviewed and
  reworked the draft. Decisions taken:
  - **One format** (`muse-spark-session-export`, version 1,
    `src/core/export/sessionTransfer.ts`) for export, import and share. It
    holds the history the Markdown export reads (`readSession`, both
    backends) with only the fields a reader needs. Live state (stored
    outputs and patches, child sessions, background and workflow handles,
    `modelVisibleContent`, `children`) and the Model API replay stay out.
  - **Scrubbing.** Every string in the document, ids included, goes
    through `redactSecrets` and a 64-hex digest pattern,
    always. By default paths and e-mail addresses are redacted too:
    `file://` URIs, then this machine's own roots (workspace folders and the
    home folder, matched in either separator and any case, to the path's
    end, so a user name with a space goes), then absolute POSIX, drive and
    UNC paths. Placeholders are English (`MODEL_TEXT`), since the model reads
    them after an import. The e-mail pattern is bounded (RFC 5321 lengths)
    and `redact.ts`'s URL user-info scheme is bounded, so a long run of
    word characters scans in linear time.
    Ordinary UUIDs and enum words remain unchanged. Share section keys
    include their position; import remints ids, and live-state references
    stay excluded, so redacting a sensitive id needs no identity mapping.
  - **Preview first.** The redacted file opens as a read-only in-memory
    document (the output-document scheme, never on disk), then a modal
    names what was redacted and offers **Save redacted…**, **Save without
    redaction…** or close. The suggested file name comes from the redacted
    title. A file over the import cap is not written (`tooLarge`).
  - **Every imported byte parsed.** The file is read only under 16 MiB
    (bounded through one checked descriptor) and as strict UTF-8; the header
    names another format or version by name; the schema caps the
    transcript at 20,000 items and wants an ISO 8601 date; and any field
    the schema does not keep, anywhere, refuses the whole file (the parse
    is compared with what was read, as zod strips unknown keys).
    - **Independent file-reader repair, 2026-09-29:** picker reads use the
      existing checked descriptor reader on local `file:` URIs. The JSON
      cap applies even when bytes resemble a PDF; other providers fail with
      an explicit localized refusal instead of whole-file allocation.
      Draft real-file cases cover growth after metadata, opened-path
      replacement, oversize input, strict UTF-8 and unchanged source bytes.
      Tests and red drills remain queued until verifier allocation.
      (Run 2026-10-01: drills R4a, R4b and R5 in
      `docs/certification/m84.md`; a file gone before the read is now
      reported as missing, RV84 #6, and one that is not UTF-8 gets the
      translated `textFileInvalid`, RV84 #7.)
  - **Import** (`ModelApiHost.importSession`, Model API only): fresh
    session, turn and item ids (turns start at each user message), the
    user's current model (the file's model id is informational; D49: nothing
    in it picks a model), the default effort, no goal, todos, outputs,
    children or usage; session rules are per session in memory, so none
    survive. The model is handed each imported turn as one user-role
    message: a lead marking it untrusted (the first also carries the full
    note) and the turn's items as JSON, never as assistant, developer,
    reasoning or tool-call items, so nothing in the file speaks with more
    authority than the user's data.
  - **Asking every time.** The stored session keeps `imported: true`, and a
    fork copies it. The controller's `adopt` opens such a session in
    `untrustedStartMode`: the current mode when it already asks (Manual or
    Plan), else Manual, or Plan when the initial mode is Plan. That covers
    the import itself and every later resume, restore after a reload and
    fork; the restart-recovery path keeps the panel's own mode, which the
    user chose. A notice says why.
    - **Plans from imported history (lead decision, 2026-10-01, RV84 #2).**
      A Plan-mode reply written in a conversation that holds imported
      history is untrusted content, as a plan picked from a file is:
      "Implement in a fresh conversation" builds its brief as not approved
      (`planBriefFromFile` for the model) and starts in
      `untrustedBriefMode()`, with its own notice (`planFromImportedMode`).
      The controller knows such sessions from `adopt`
      (`importedSessionIds`). M74's `/handoff` must take the same flag when
      it lands.
    - **Export scrub cost (RV84 #9).** The scrub ran synchronously on the
      extension host. Measured 2026-10-01 on the Mac mini, a 4 MiB
      conversation (paths under a local root) held the event loop 1.4 s in
      one go, 0.35 ms/KiB (Windows 11 VM: 2.5 s), so 16 MiB was seconds of a
      frozen window. Three changes: `foldText` stopped allocating an array
      per character (half the time); a literal prefilter in `redactSecrets`
      (`MAY_HOLD_SECRET`) lets text with no credential literal skip the 24
      patterns in one scan, the e-mail pattern runs only on text with an
      `@`, and the digest pattern starts only at a hex run's start; and
      `buildSessionExport` is async and yields (`setImmediate`, not a timer:
      Windows' ~15 ms tick) after each 64 KiB of text. The same 4 MiB now
      takes 0.37 s, holding the loop at most 11 ms (Windows VM: 0.42 s, at
      most 14 ms). A long string is cut too (2026-10-02,
      `redactableSlices`), but only just after a line break that no
      credential runs across, so each pattern sees whole what it would see
      in the whole string; a single line longer than a slice (a pasted
      16 MiB line) still holds the loop for its own scrub, about 0.5 s.
    - **No Insert or Apply on imported history (RV84 #11).** `historyLoaded`
      carries `imported: true` for such a session, and the panel offers Copy
      only on its code blocks, as the share view does. The mark is the
      session's, not a turn's: a reply after the import was written over the
      same untrusted history, so its code blocks are Copy only too.
  - **Share view.** The file's items render in a modal through the Markdown
    export's per-item sections (`transcriptItemMarkdown`); `MarkdownView`
    and `CodeBlock` take Insert and Apply as optional, and the share view
    passes neither. Links go through the host's http, https and mailto
    filter; relative links are refused.
  - No paid call is involved (local files only), so D48 needs no consent.
    No live model check was run: the import sends user-role `input_text`
    messages, a shape the backend already sends (`noteItem`).
  - **Port to the release candidate, 2026-10-01** (`feature/m84-export`,
    from `temp/port.patch` against main `32709441`): applied with
    `--exclude` for the six files `git apply --3way` cannot take (five new
    files plus `docs/certification/m84.md`, applied directly; the
    `m84-share.png` hunk is a content-less stub, so the capture is marked
    to-retake in `docs/certification/m84.md`). Four conflicts kept both
    sides: the candidate's 0.10.0/M72 entries and the patch's M84 entries in
    `CHANGELOG.md`; `editFile` (M72 checkpoint lease, kept: a workspace
    Markdown export still goes through `withCheckpointEditAt`; the JSON
    export did not until RV84 #5) beside `openPreview`
    (M84) in `CliFeatureDeps`, its tests and their setups. Decisions taken
    in the port: `Promise.withResolvers<void>` became `<undefined>` with
    `resolve(undefined)` (the gate's `no-invalid-void-type`); the
    remote-provider refusal test uses a literal remote URI (the shared mock's
    `Uri.parse` keeps `file`); the two new ACP load tests share a
    `loadOldSession` helper (the duplication gate); and the `vscode`
    dialogs moved to `src/host/conversation/transferDialogs.ts`, leaving
    `sessionImport.ts` portable for the host-API gate (its tests split the
    same way). `docs/ide-compatibility/host-api.md` regenerated: 26
    commands, 17 adapter files, 264 APIs. No new escape hatches (PLAN.md
    §8 needs no row). Checks that ran green: format, ESLint (incl. css),
    PSScriptAnalyzer, all five typechecks, knip, jscpd, dpdm, check:host-api,
    and the M84 unit suites. `check:l10n`'s own code reports 0 problems over
    14 tables, 104 manifest strings and 328 sources when its l10n modules are
    loaded via tsc instead of esbuild. Not runnable in this sandbox:
    `npm run check:l10n` (the esbuild binary's file reads are denied),
    `npm run build`/integration tests/`test:a11y`/harness shots (same cause,
    no browser), and seven unit tests that fail identically on pristine HEAD
    here: six real-git checkpoint captures plus the esbuild-bundled M57
    goal test (environmental, unrelated to M84). These checks ran on the
    port tree in that sandbox; the record for the tree after RV84 is
    `docs/certification/m84.md` (2026-10-01).
  - **Independent review RV84, 2026-10-01.** Fourteen findings; the fixes
    are one commit each on `feature/m84-export` (#1 credential shapes and
    honest claims, #2 lead decision on plan briefs, #4 changelog, #5 JSON
    export lease, #6 missing file, #7 UTF-8 refusal, #8 share-view claim,
    #9 scrub cost, #11 Insert and Apply on imported history, #12 dead CSS),
    #3 is the rewritten certification, and #13 needs no change: the D60
    gate (`check:host-api`) holds only `src/core`, `src/shared`,
    `src/webview`, `src/acp`, `src/runtime` and the `PORTABLE_HOST` files
    to the boundary, so an adapter file in `src/host/conversation/` is
    allowed and recorded (17 files, 0 problems). Sibling dialogs live in
    `src/host/*Features.ts`; moving `transferDialogs.ts` beside the export
    dialogs in `cliFeatures.ts` is a tidy-up for the lead to choose. #10
    and #14 were left open that day and fixed on 2026-10-02 (below).
  - **Follow-up reviews, 2026-10-02 (RV84c, Codex; the Muse review).**
    Fixed with a test and a red drill each (`docs/certification/m84.md`):
    - **C1, import after sign-out or close.** `importSession` loads the
      hooks, then checks the account and the host's closing again before
      the session exists, and the closing once more after its SessionStart
      hook, as `startSession` checks the account.
    - **C2, Unicode paths.** An absolute POSIX path's segments take any
      character outside ASCII that is not white space (`/srv/私密`,
      `/Users/José`, emoji folders); drive and UNC paths already did.
    - **C3, a share file that crashed the panel.** The fence's length is
      found in a loop (`Math.max(...runs)` threw a RangeError on 200,000
      runs), and each share section renders inside its own error boundary,
      which says so in its place and logs the error.
    - **Imported mode on a stale opening (Muse).** `adopt` applies the
      imported mode and mark only once the opening is still current, so an
      imported session overtaken by another opening leaves neither. The
      mark goes with its session when the panel drops it; a restart's resume
      reads it again from the record, and a plan reply carries the flag it
      was read with.
    - **RV84 #10, an import past the window.** Decision: refuse, not cut.
      The text an import hands the model is counted high, one token per
      UTF-8 byte, against `MODEL_API_IMPORT_MAX_REPLAY_BYTES` (the window
      less the reserve named text attachments keep, 786,432 bytes). A file
      over it is refused before the confirmation, naming both sizes
      (`importReplayTooLarge`, 14 tables), and `sanitizeImportedSession`
      refuses it too. Importing only the latest turns would show history
      the model never saw; the file can still be read as a share file.
    - **RV84 #14, the share view's single pass.** It renders
      `SHARE_VIEW_PAGE_ITEMS` (200) items at a time, with Show more.
    - **RV84 #9's residual.** Long strings are scrubbed in line-break
      slices (above).
    - **Lead decisions on the same class (released behaviour, one
      CHANGELOG Fixed entry).** `startSession`, `resumeSession` (its
      `revive`) and `forkSession` check the account and the closing after
      their hooks load and again after their SessionStart hook, as the
      import does; a SessionStart hook that fails in `revive` leaves no
      session. `adopt` switches a side chat to Plan only after its last
      currency check, beside the imported mode.
    - **0.10.1's JWT fix carried in.** The JWT rule is 0.10.1's linear
      dotted-words scan (`redactTokens`), so a token glued after `-` is
      redacted again; its tests (glued tokens, the differential against the
      old pattern, 128,000-character timing) are kept.

### M85 — TypeSafe assist, experimental and opt in (D50)

- **Goal.** Cheaper, better-calibrated small decisions around the Muse
  model: which skill fits, how risky a command is, what context still
  matters. The Muse model stays the one that answers and acts.
- **Scope.**
  - A thin client over TypeSafe's HTTP API, zod-validated like the Model
    API client (D2).
  - The key is kept in SecretStorage; a machine-scoped
    `museSpark.experimental.typesafeAssist` setting is off by default and
    labelled Experimental.
  - It is disclosed in PRIVACY: the user's message and skill or agent
    descriptions for suggestion; the command or path for a risk score;
    for context relevance and grading, the tool output or file text
    judged. TypeSafe keeps
    data except on enterprise plans, so credential-shaped strings are
    redacted before a call, and the assist is off while
    `museSpark.confidentialWorkspace` is on.
  - It is a paid feature under AGENTS.md rule 12 with D50's one
    exception, the TypeSafe key: `typesafeAssist` in the `PaidFeature`
    union, `PaidFeatureGate` with its price, the badge, a paid row,
    `PaidUsage`, and D48's paid-use popup.
  - Timeouts are short; on failure there is no assist, and the failure is
    logged.
  - Uses:
    - skill suggestion first, and the same for a custom agent (M76);
    - then the Auto risk score, as M78's optional advisory layer: it can
      only add caution, never allow;
    - context relevance and evaluation grading, gated like M73: no path
      reaches them until their own M75 run passes, whatever the setting.
- **Backends.** Model API. Muse Code only where the extension decides.
- **Acceptance.**
  - With the setting off, nothing changes and nothing is sent.
  - With it on, every call is visible in the log (question ids and timing,
    never the content) and tallied in Account & usage.
  - No path lets a TypeSafe answer skip a question, allow an action, skip a
    deterministic rule, or answer the user. A test proves that a "safe"
    score leaves the verdict unchanged.
- **Tests.** A fake TypeSafe endpoint with Choice, Score and Noul shapes
  taken from the live API (AGENTS.md rule 13), plus the paired runs in M75.
  The capture needs a TypeSafe key only the owner can create, so M85 waits
  for it.
- **Size.** M.

### M86 — Restore by the tools' own writes (D63)

- **Goal.** Restore files without guessing who changed them.
- **Scope.**
  - Every model tool write (`write_file`, `edit_file`, the image tools, the
    memory tools, `rename_symbol`) records, per turn, each file's bytes
    before (or absent) and after, keyed by the turn; the records live in the
    existing checkpoint storage (CAS refs) and survive a reload.
  - "Restore files to here" undoes, newest first, the recorded writes of the
    chosen turn onward: a file is written back only when its current bytes
    (and execute bit) equal the last recorded "after"; anything else is
    refused and named, as is every file a shell command changed (found by the
    existing captures, listed, never undone).
  - Redo keeps its current meaning on the same records.
  - The whole-tree attribution in `changedOutside` (gaps, stretches, peer
    windows, saves files, unseen ends) is removed; captures remain only to
    list what shell commands changed.
- **Acceptance.** No restore writes a file whose bytes differ from what a
  tool of the restored turns left there; every M72 Codex finding from rounds
  3 to 7 is covered by a test of the new design or is moot by construction.
- **Tests.** The M72 restore tests that still apply, rewritten on the new
  records; the round 3 to 7 scenarios (user saves in any window, peer turns,
  dead windows, ties, clock moves) each as a refusal test.
- **Release.** `museSpark.turnCheckpoints` defaults on again with M86.
- **Size.** L.

### M41 — Install Muse Code from the panel (folded into M55)

**Status 2026-09-25: folded into M55 (D36); built there (PR #43, merged
2026-09-27).** The owner
asked whether the install could be automated rather than linking to Meta's
site. Meta publishes one-line installers (`irm https://dev.meta.ai/install.ps1
| iex` on Windows, `curl -fsSL https://dev.meta.ai/install.sh | sh`
elsewhere; to be re-read before building). The proposal: the sign-in page's
"Install Muse Code" asks first, in a modal that shows the exact command,
then runs it in a visible VS Code terminal and watches the install folder
the extension already probes, moving on to sign-in when `muse` appears.
The CLI itself is not bundled: it is Meta's closed-source binary.

### M57 — The Model API backend out of the activation bundle (D6)

**Status 2026-09-27: built on `feature/m57-bundle-split` from main
`2f4f669` (0.9.0); local `npm run quality` recorded in
`docs/certification/m57.md`. Not pushed; no pull request yet.**

- **Goal**: `dist/extension.js` was 596.8 KiB of its 600 KiB budget, 180.7
  KiB of it the Model API backend, which only a conversation on that backend
  uses. Load the backend when it first starts instead, without raising the
  budget or changing what the backend does.
- **Scope**: the entry `src/host/backend/modelApiEntry.ts` built to
  `dist/modelApi.js` (production, dev and watch builds); the interface module
  `modelApiBundle.ts` (types only from the backend's folder); the manager
  requiring the bundle by the path activate passes, the load failure in the
  user's language (`modelApiBundleUnavailable`, fifteen tables) with the file
  and cause in the log; the MCP pool and the hooks loader built inside the
  bundle; `confineWorkspacePath` and `resolveWorkspacePath` to
  `src/core/workspacePath.ts`, `isProtectedPath` to
  `src/core/protectedPaths.ts`, the goal record to `modelapi/goalRecord.ts`;
  the identity audit's fixes (the `is…` error guards and a lint rule against
  `instanceof` on those classes, the table and locale handed to the bundle);
  the gates (`check-bundle-split.mjs`, the budget, host globals, notices,
  knip's entry, dpdm's entry, `.vscodeignore`, CI's `.vsix` check); the live
  sweep loading the built bundle; D6's amendment.
- **Acceptance**: `dist/extension.js` 425.3 KiB and `dist/modelApi.js` 295.6
  KiB, both under budget; of the backend's 28 files only the eight on the
  allowed list are in the activation bundle, the 20 lazy ones are all in
  `modelApi.js`; the manager requires a real built bundle and completes a
  turn against the fake Model API; a missing or damaged file rejects
  `ensureHost()` in the user's language, is logged with its path, and a
  retry after the file appears works; a German table reaches a sentence the
  bundle's host writes, number grouping included; a goal refusal thrown by
  the bundle is not `instanceof` the activation bundle's class, and the
  controller, over a host from the built bundle, still says a refused
  `/goal pause` as the warning in the user's words (with `instanceof` it was
  an error); the `.vsix` lists `dist/modelApi.js`; an integration test loads
  the dev build's `dist/modelApi.js` inside VS Code's extension host and
  runs a turn.
- **Gates**: the §7 rows (bundle split, budget, host globals, notices,
  cycles) and every test fired on a deliberate break
  (`docs/certification/m57.md`).
- **Left**: the extension's own manager path (activate's
  `ModelApiBackendManager`) runs only for a conversation on the Model API
  backend, which the integration harness cannot start (a key in the
  extension's SecretStorage and a message from its panel); its integration
  test builds a manager of its own over the same path. The live sweep now
  loads `dist/modelApi.js` and was not run for this milestone (no live calls).

### M60–M66 — Muse Spark Code beyond VS Code (D60)

**Status 2026-09-26: the program the owner handed over**
(`docs/ide-compatibility.md`), built beside M45–M56. The phases are the
plan's §8 (A–G); a phase that needs another editor installed waits for Q62.

| Milestone | Phase | What it delivers                                                                                                                                             |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M60       | A     | The host API inventory: every VS Code API, Node built-in, webview host call and theme variable the extension uses, recorded and gated; the `vscode` boundary |
| M61       | B     | Shared boundaries: the webview's host bridge, the surface and controller free of VS Code types, theme tokens, the editor-services contract, a Node runtime   |
| M62       | A, C  | The VS Code family: probes and qualification in VSCodium, Cursor, Kiro, Positron and Theia; code-server and Codespaces profiles; Open VSX (Q60)              |
| M63       | D     | The ACP agent: `muse-spark-code-acp` on ACP v1 (Q61); Zed, then one JetBrains IDE (Q64), then Xcode 27, Qt Creator, Neovim, Emacs, Sublime and Devin         |
| M64       | E     | Native full interfaces: the IntelliJ plugin on JCEF with Android Studio qualified separately; Visual Studio on VSSDK and WebView2                            |
| M65       | F     | Eclipse, NetBeans, JupyterLab 4 and Notebook 7, then Spyder and RStudio                                                                                      |
| M66       | G     | Conditional hosts: vscode.dev and github.dev, Xcode 26.3's external route, Vim, Kate, MATLAB, Replit, StackBlitz, CodeSandbox and Ona; the companion's media |

### M60 — The host API inventory and the `vscode` boundary (D60, phase A)

**Status 2026-09-26: built and certified** (`docs/certification/m60.md`).

- **Goal**: know exactly what the extension asks of its host, so each
  editor in D60's matrix can be checked against it (Theia's API
  comparator, a fork's VS Code version, a browser engine), and keep that
  knowledge true as the code changes.
- **Scope**: `scripts/check-host-api.mjs` (`npm run check:host-api`, in
  `quality:gates`; `--write` regenerates the record): with TypeScript's
  checker, every VS Code API the host uses at run time (functions,
  variables, classes, enums, members of VS Code objects) and the files
  that use it; the files that import `vscode`; the Node built-ins the host
  imports; the webview's host calls (`acquireVsCodeApi`) and the
  `--vscode-*` theme variables it reads; the manifest's facts (engines,
  `extensionKind`, entry points, capabilities, activation events,
  contribution points). The record is `docs/ide-compatibility/host-api.md`,
  formatted as Prettier would; the gate fails when it differs from the
  source. Whatever the record says, the portable code never reaches
  `vscode` through its imports, type-only ones included: everything under
  `src/core`, `src/shared` and `src/webview`, and the host modules the
  script lists (the conversation controller, both backend managers, the
  tool harness, the credential and session stores, the `ide` server). A
  VS Code object handed to portable code by shape (the log channel,
  `SecretStorage`) is still recorded, member by member, where it is handed
  over.
- **Acceptance**: a red drill for each failure; the gate green; the record
  read through.
- **Not here**: installing another editor (M62, Q62).

### M61 — Shared boundaries (D60, phase B)

**Status 2026-09-26: the first two steps built** (`docs/certification/m60.md`
records them with M60); the rest waits for M56 to merge. M56 merged
(PR #44) and was joined into this branch on 2026-09-27; steps 3, 4 and 6
are no longer blocked by it.

- **Goal**: the engine and the React UI can be driven by a host other than
  VS Code, while VS Code behaves exactly as before.
- **Scope, in order**:
  1. The webview's host bridge (`src/webview/hostBridge.ts`): posting to
     the host, the saved state and the host's messages go through one
     interface, and `main.tsx` no longer calls `acquireVsCodeApi` itself.
     **Built.**
  2. `ChatSurface` and `ConversationMessage` in a module with no `vscode`
     type (`src/host/views/chatSurface.ts`), the logger taking its channel
     by shape and `DictationSetup` in the core, so the conversation
     controller, both backend managers and the other modules the M60 gate
     lists are portable. **Built.**
  3. Theme tokens: the stylesheet reads `--muse-*` tokens mapped once from
     VS Code's variables (M60's record lists the 57), so another host maps
     its own; the harness screenshots identical before and after. After
     M56.
  4. The editor-services contract (D60's list), taken by the controller
     and the Model API tool harness, with VS Code's implementation. After
     M56.
  5. A standalone Node runtime entry that drives `AgentHost` without
     `vscode`, tested against the fake CLI and the protocol captures.
     **Built with M63a** (`src/runtime/`, on the M60 gate's portable
     list), driven over stdio against the fake CLI.
  6. Capability detection: what a host offers, and what the UI hides or
     explains when it does not.
- **Acceptance**: every gate and the integration tests unchanged; each
  moved module on the M60 gate's portable list.

### M62 — The VS Code family (D60, phases A and C)

**Status 2026-09-26: M62a built and certified**
(`docs/certification/m62.md`); the other forks and the first Open VSX
listing are M62b.

- **Goal**: every editor built on VS Code installs and runs the extension
  as it is, from a `.vsix` or Open VSX, as far back as the code allows.
- **M62a, the floor**: `engines.vscode` from `^1.125.0` to `^1.99.0`, on an
  audit and real-host tests, as the owner's plan asks
  (`docs/ide-compatibility.md` §3.1).
  - The VS Code API: the host, unit and integration projects typechecked
    against every published `@types/vscode` from 1.85 to 1.120. The host
    needs nothing newer than 1.85; the unit tests' panel fake needed 1.96
    (`IconPath`) and 1.108 (its shape) and is now typed from the interface.
  - Node: VS Code's own pins (`remote/.npmrc`, the Electron target) give
    Node 20.18.3 for 1.99, 20.19.0 for 1.100 and 22.15.1 from 1.101.
    Compiled against `@types/node` 20.19 and the ES2023 library, the host
    used one newer API, `Promise.withResolvers`, now replaced. The host
    project's library is ES2023 and its bundles target `node20.18`; the
    ACP agent keeps `node22`, run by the user's own Node.
  - Why 1.99: the first release on Node 20.18 and Chromium 132 (Electron
    34). Older releases run Node 20.9 to 20.16 and Chromium 122 to 130,
    which neither the host nor the webview (`chrome128`) was checked
    against; going lower waits for a named editor that needs it.
  - Muse Voice needs a global `WebSocket`, which Node 20 lacks; on 1.99
    and 1.100 it says so (M35's check) and dictation's other routes stay.
  - Tested: VSCodium 1.99.3 and 1.135 run the integration tests (9 each);
    code-server 4.99.4 (VS Code 1.99.3, Node 20.18.3) installs the VSIX,
    activates it and runs a conversation and an approval against the fake
    CLI in the browser, and refuses the same VSIX with the 1.125 floor.
    CI's `minimum` integration run now downloads 1.99.0.
  - **After M48–M56 joined (2026-09-27)** (`docs/certification/m62.md`,
    "The floor after M48–M56"): the host still typechecks at 1.99's
    `@types/vscode` and at `@types/node` 20.19 with ES2023, once M55's two
    `Promise.withResolvers` in the device sign-in became a plain promise;
    the host API record was regenerated (198 APIs, as before; 13 files
    import `vscode`). M56 relied on VS Code routing an extension's `fetch`
    and `WebSocket`: `fetch` is routed at every version from the floor,
    `WebSocket` only from 1.112.0, so on 1.101 to 1.111 Muse Voice's socket
    goes out without VS Code's proxy and certificate handling. Diagnostics
    now says per global whether the editor routes it, and the README says
    so. The ACP agent's backends took M48–M56's new inputs: Muse Code's
    default network sandbox, the in-memory prompt cache, M49's memory tools
    in a trusted folder, no subagents (paid, and the agent has no flag for
    them), and the shell job's C# shipped in its package.
- **M62b, the forks**: Cursor, Windsurf, Kiro, Positron, Theia (from npm),
  Firebase Studio, Che and Codespaces, each installed where it can be and
  its version recorded in `docs/ide-compatibility/hosts.md`; the Open VSX
  listing after the next tag.
  - **Theia 1.75, 2026-09-26** (`docs/certification/m62.md`): built from
    npm as a browser app; it claims VS Code API 1.134, so the floor is no
    obstacle. The panel in a tab and the sidebar run a conversation and an
    approval against the fake CLI. Found: Theia never fires `onView:` for a
    webview view (it fires only for a view with no child widget, and a
    webview view gets its widget at once), so the sidebar opened first
    stays blank until a command or the tab starts the extension. Not
    worked around with `onStartupFinished`, which would start the
    extension, and read SecretStorage, in every VS Code window; README's
    Troubleshooting gives the shortcut. The fix belongs in Theia.
  - **Forks in CI, 2026-09-26** (`.github/workflows/forks.yml`,
    `docs/certification/m62.md`): Cursor, Devin Desktop (Windsurf's new
    name), Kiro and Positron at their latest Linux builds, found through
    their own update feeds as nixpkgs and Homebrew find them; the VSIX
    installed with each fork's CLI and the integration tests run in it,
    weekly and by hand. Their feeds are refused in the container; the
    first run on GitHub's runners passed in all four: Cursor 3.22.7 (VS
    Code 1.128), Devin Desktop 3.10.35 (1.126), Kiro 1.1.70 (1.131) and
    Positron 2026.09.1 (1.130), 9 integration tests each.
- **Acceptance (M62a)**: every gate green with the floor's types; the
  integration tests on a 1.99 host; drills for the API and Node checks.

### M63 — The ACP agent (D62, phase D)

**Status 2026-09-28: M63a built and certified**
(`docs/certification/m63.md`); M63b run in Emacs, Neovim, Zed and
JupyterLab, and in CI (below); M63c's MCP servers and paid features built,
joined with M57, M58 and PR #49's sign-in
(`docs/certification/pr32-integration.md`).

- **Goal**: Muse Spark in every editor that hosts agents over ACP, on
  both backends, with the panel's approvals and none of its bills
  unannounced.
- **M63a, the agent**: `src/acp` (the translation of D62) and
  `src/runtime` (the process: arguments, the stderr log, the two backend
  managers, the OS key store of D61, the data folder for Model API
  sessions); `muse-spark-code-acp` with `auth set|status|clear` and
  `login`; the esbuild entry `dist/acp.js` and its budget; the npm package
  and its tarball on each GitHub Release; tests against the SDK's client
  in-process and over stdio to the built agent with the fake Muse Code
  CLI; README configuration for each client; drills.
- **M63b, the clients**: each ACP client installed and driven where it
  can be (Neovim with CodeCompanion, Emacs with agent-shell, Zed,
  a JetBrains IDE, Qt Creator, Xcode 27, Sublime, Devin Desktop), its
  version and results recorded in `docs/ide-compatibility/hosts.md`.
  - **Emacs, 2026-09-26** (`docs/certification/m63.md`): Emacs 29.3 from
    Ubuntu, acp.el 0.15.2, shell-maker 0.97.3 and agent-shell 0.79.2
    fetched file by file (GitHub's archives are refused here). acp.el
    alone, and agent-shell in batch, ran the agent against the fake CLI:
    the modes, the model and effort, a streamed reply, a tool call allowed
    (`y`) and one rejected (`C-c C-c`, which cancels the turn, so the
    permission answer is `cancelled` and the call is rejected). The
    agent-shell configuration is in `docs/acp.md`.
  - **Neovim, 2026-09-26**: Neovim 0.11.4 (its GitHub release),
    plenary.nvim and CodeCompanion v19.25.0 (cloned; the tag was ten days
    old), headless: a streamed reply, then CodeCompanion's approval prompt
    (Accept `g2`, Reject `g3`, Cancel `g4`) pressed in the chat buffer:
    accepted, the command ran; rejected, it was skipped. The adapter is in
    `docs/acp.md`.
  - **Zed, 2026-09-26**: Zed 1.20.2 from its GitHub release (zed.dev is
    refused here), run as an unprivileged user on Xvfb with Mesa's
    software Vulkan and driven with xdotool. Muse Spark appeared under
    External Agents; its thread showed the model and effort selectors,
    streamed the reply, and ran or skipped a command from Zed's permission
    card (Allow once, Reject). Zed now needs `"type": "custom"` in
    `agent_servers`, which `docs/acp.md` lacked; fixed.
  - **JupyterLab, 2026-09-26**: Jupyter AI 3.2.0 ships an ACP client
    (`jupyter-ai-acp-client` 0.3.0) that runs agents as chat personas, so
    JupyterLab 4 is reached through the agent now rather than waiting for
    M65's native extension. With JupyterLab 4.6.3 (4.6.4 was five days
    old) and a local persona file, the chat showed the agent's model, mode
    and effort pickers and its context gauge, and allowed and rejected a
    command from Allow once / Reject buttons. Found: Jupyter AI passes its
    notebook tools as MCP servers (HTTP ones only to an agent advertising
    `mcpCapabilities.http`) and prepends a note telling the model to use
    them; the agent passes no MCP servers on yet, so M63c's MCP item
    matters here first.
  - **In CI, 2026-09-26** (`.github/workflows/hosts.yml`, `test/hosts/`,
    `docs/certification/m63.md`): JupyterLab, Emacs (acp.el v0.15.1 and
    agent-shell v0.77.4, the newest tags seven days old) and Neovim run
    the packaged agent against the fake CLI on each pull request, with
    VSCodium, code-server and Theia for the extension, and the agent's
    package and key store on all three platforms. Zed stays manual.
- **M63c, the rest of the protocol**: file reads and writes through the
  client (`fs/*`) for the Model API backend; paid features with a
  confirmation that names the price; `session/close` and `delete`; the ACP
  Registry once Q65 is answered; the editor's MCP servers.
  - **MCP servers, 2026-09-26** (`docs/certification/m63.md`): the engine's
    per-session servers gain a stdio kind beside HTTP (MSP takes both), and
    the agent passes the editor's stdio and HTTP servers to Muse Code on
    `session/new`, `load` and `resume` when the host granted `sessionMcp`,
    each optional; it advertises `mcpCapabilities.http` on that backend.
    SSE and the unstable ACP transport are left out, the Model API backend
    runs none, and only server names are logged (headers and environments
    can hold secrets). JupyterLab's notebook tools now reach the agent.
  - **Paid features, 2026-09-26** (`docs/certification/m63.md`): web
    search and image generation behind `--web-search` and
    `--image-generation` on the Model API backend, each confirmed in the
    editor at the first prompt with its price (`src/acp/paid.ts`); a
    cancel while the price is asked ends the prompt without a turn.
    File access through the client (`fs/*`) waits for M46–M56, since it
    needs the session threaded through the Model API backend's tools.
  - **Joined with main's M57 and M58, 2026-09-27**
    (`docs/certification/pr32-integration.md`): the agent loads the
    Model API backend from the extension's own `dist/modelApi.js`, which its
    package ships (D6 amendment), and each paid use asks in the editor with
    Allow once, Allow always in this workspace (with `--trust-workspace`,
    kept in the agent's data folder) or Deny, replacing the first prompt's
    price question (D62 amendment).
- **Acceptance (M63a)**: a session created, prompted, streamed, cancelled,
  asked for permission (allowed, denied, cancelled), loaded and listed
  over stdio on the Muse Code backend (fake CLI), and on the Model API
  backend (fake server) in process through the same runtime backend,
  because the process reads the key only from the OS store; `auth set`,
  `status` and `clear` against a real Secret Service; `auth_required`
  before sign-in; the key never in a frame, an argument, the environment
  or the log; every gate green.

## 7. Gates

**PR #60 compatibility repair (2026-09-30; proven on the floor, release remains first).**
The owner explicitly included the Dependabot branches in the merge goal.
Prepare the exact `html-encoding-sniffer` 7.0.0 delta from original bot head
`f829f28f8ef81265722a9c862f8150e134fa3423` on main `32709441`; root retains
commit, push and normal-merge ownership. Preserve the original bot head.
Reuse `bomEncodingOf` and the sniffer's header-label normalization in the canonical HTML charset adapter:
only a BOM or valid transport header may make HTML decoding certain. The v7
XML-declaration/signature paths must not freeze an HTML page before its meta
declaration can take effect. Keep the bounded prescan and existing later-meta
reparse; write real byte-to-Markdown golden controls before accepting the delta.

Acceptance PR60-A covers BOM/header priority, invalid labels, XML prologues,
HTML meta priority and later tentative reparse. PR60-B covers UTF-16 signatures
and malformed/truncated meta through the real sniffer and converter. PR60-C
requires original-bot/source preservation, fresh peer/audit metadata, scoped
types/lint/format and assertion red/restored proofs, then the actual packaged
page worker on Node 20.18.3. Reuse existing worker-floor transport; no model,
paid call, dependency engine waiver, threshold change or full quality in this
source lane. Kubuntu bounded work yields to final M72/release gates. Merged
with main 2a30b1a0 (0.10.0, #66, #67) on 2026-10-02; the full quality gate
passed on the Mac mini at that head, and hosted CI is the merge gate. Result: sniffer 7 declares Node
22.13, but bundled into `dist/pageWorker.js` it loads and converts in VS Code
1.99.0's Node 20.18.3 (the floor), and the integration run's `minimum` label
now carries the goldens through the shipped bundle. The proof also found one
defect older than this PR: Node 20.18's `TextDecoder` reads windows-1252 as
ISO-8859-1 (the euro sign and curly quotes come out as controls), so
`textDecoding.ts` decodes that table itself on every Node. Receipts, red
drills and sizes are in `docs/certification/pr60-sniffer7.md`.

**M75 current-main ToolIO integration repair (2026-09-30).** Exact tree
`7d1ed818` passed host, webview and integration types plus scoped lint,
format and localization, but unit/e2e types rejected the removed
`ToolIoDeps.hasUnsavedChanges` port. Seven real-disk runner assertions failed
because the same stale fixture could not inspect unsaved editor files during
conditional writes. Replace both eval adapters with the current
`unsavedFiles: () => []` port: these isolated workspaces have no open editor.
Preserve the current M68 ToolIO implementation and all assertions, then rerun
the five types, all 91 eval controls and six isolated semantic red/restored
cycles. The first duplication invocation failed to locate jscpd's current
entry point; retain that runner failure and invoke the package's declared bin.
No model call, full quality or platform certification is implied.
Repaired tree `99d45301` passed all five type projects, 91/91 eval controls,
scoped lint/format, localization and duplication (zero clones). Six disposable
semantic mutations reached their exact named assertion failures and restored
to 91/91; all archive bytes and candidate source remained unchanged. External
`m75-host-99d4-20260930/receipt.json` and `red-receipt.json` bind the proof.
Installed M68 tools were reused only after lock/npmrc and installed package
metadata equality checks; fresh `npm ci`, full quality and rig gates remain
required. See `docs/certification/m75.md`. No packing or model run occurred.

**Merge goal progress (2026-09-29, America/Los_Angeles):** PR #32 merged at
17:31 (`fefb6068`), PR #57/M67 at 18:20 (`4c35e73e`), and PR #52/M69 at
19:46 (`c323dcc0`). Each passed independent review, four local full-quality
environments and exact-head hosted checks before merge. M69's tested tree
`42a65c7b` passed all four full gates, installed ACP stdio 9/9 on each rig,
actual installed page conversion and the same worker under Node 20.18.3;
all 19 triggered hosted checks passed. Its dated certification entries
describe their recording phase; the final PR body links completed CI and
Hosts runs. Other PRs and WIP branches remain under review and verification.

**PR #51 integration review (2026-09-29):** preserve the contributor's four
Android/Termux unit cases for launcher discovery, credential-path selection
and unavailable voice helpers. Integrate the two test files into current main;
prove these checks fail under deliberate behavior changes, then run exact-tree
quality and the local rig gates. No production change or physical Android
certification is implied. `docs/certification/pr51-termux-tests.md` tracks proof.

**PR #32 final review reopened (2026-09-29, head `46ba5406`):** independent
reviews found a pending-release/reload ownership race in the ACP session state,
cross-process whole-file paid-grant updates that can resurrect a revoked grant,
and an unquoted absolute staging argument in Windows npm packaging. Repair
session ownership across awaited release, replace shared grant read/modify/write
with authoritative independent records and revocation, and run npm packaging
from its staging working directory with fixed relative arguments. Add realistic
regressions and red/restored proofs; correct VSCodium/fork evidence wording to
distinguish development-extension integration from packaged installation.
`docs/certification/pr32-integration.md` records findings, fixes and fresh gates.
The same review also found an unobserved prompt-completion rejection when the
backend exits while a turn starts, and a late paid-use answer that can install
an always grant after its prompt was cancelled. Observe completion failures from
creation and bind permission answers to the owning active prompt, with SDK and
real MSP/session regressions for these lifecycle siblings.

**Merge-completion goal (owner authorization, 2026-09-29):** complete and
properly merge the existing cloud-work branches and open PRs into main by the
end of the owner's day (America/Los_Angeles). Start with PR #32's final review;
then choose integration order from dependencies and verified readiness. Parallel
agents may review and fix separate worktrees; one integrator owns merges and
aggregate gates. Preserve existing work and the D49 acceptance contracts. Fix
findings, perform the required red proofs, review and gate each final candidate,
and inspect hosted checks on its exact SHA before merging. The date target does
not waive a gate or make an unverified draft complete. Record remaining external
or implementation blockers with their next safe action if the target is missed.

**Local platform proof restored (owner correction, 2026-09-29):** use the
available Mac mini, Kubuntu VM and Windows 11 VM before pushing a candidate,
alongside the Windows host. Recover the existing rig workflow from the project's
Claude memories and verify its current access and toolchain. Bind every result
to the candidate tree and record process exits; hosted CI confirms that proof.
PR #32 candidate `22f62ed1` passed the full Windows-host gate, Hosts and Forks,
but hosted macOS and Windows both timed out in one new paid-grant race test.
An owned temporary-directory junction reproduced that same failure locally:
the fixture compared its lexical path with an atomic writer's canonical path.
Canonicalizing the fixture makes all 22 paid tests pass under that alias.
Timeouts, production behavior and quality thresholds are unchanged. Fresh full
gates, independent review and local rig proof remain required before repushing.

**Windows 8.3 follow-up (2026-09-29):** `74f3c2cf` passed all four local
full gates and hosted Linux/macOS, but hosted Windows still timed out in that
same fixture. The local junction proof did not cover actual short names.
`GetShortPathNameW` reproduced the runner's path form locally: JavaScript
`realpathSync` keeps 8.3 names, while `realpathSync.native` expands them as
the atomic writer's `fs.promises.realpath` does. The fixture now uses the native
method. The original short-path case exited 1 at 5,000 ms; all 22 paid tests
passed afterward under the same short path. Fresh Windows host/VM full gates
must run with actual short-name temporary paths before the next push; the Mac
and Kubuntu gates also rerun. No production or timeout change.

**Pre-PR delivery, historical (2026-09-26: trigger merged at `10522223`; first manual
branch dispatch run `36276240077` succeeded on head `ac9df5a` in all seven
jobs).** The owner
wants platform failures found and fixed before a pull request is opened.
`ci.yml` gained `workflow_dispatch`, calling the same `build.yml` as pushes and
pull requests. `CONTRIBUTING.md` gives the order: integrate milestones, run
local quality on the exact tree, collect platform evidence, get an independent
review, push, dispatch hosted CI and inspect its SHA and every job before
opening a pull request. No build job or threshold changed. GitHub requires a
manually dispatched workflow on the default branch, so the first pre-PR branch
run could happen only after this trigger landed on `main`. Its recorded
run and job evidence proved that process. The manual pre-PR dispatch policy
was superseded by the M52 cleanup below; pull-request CI and review still
gate merge.

**M52 CI trigger cleanup (done 2026-09-26, PR #40 `93ea81c`).** The owner
uses exact-tree local and VM gates as the pre-PR filter, then opens one pull
request whose event runs the seven hosted jobs. A separate routine manual
branch dispatch duplicated that run, and a protected merge of a reviewed PR
already has the same code tree, so the automatic `push` to `main` duplicated
the seven jobs too. The `ci.yml` main-push trigger was removed; `pull_request`
and optional `workflow_dispatch` remain for a deliberate branch check without
a PR. The release workflow is still tag-triggered and calls the shared
`build.yml`; no build jobs or thresholds changed. Contributor instructions, PR
proof fields, the README and workflow comments were updated to match, and the
trigger was verified locally with a red drill before the M52 merge.

**M75 platform fixture correction (2026-09-29, preliminary Mac proof).**
The verifier still starts with `env: {}`. MacOS/CoreFoundation nevertheless
generates `__CF_USER_TEXT_ENCODING`: an independent child with its parent
variable removed and an explicit empty environment observed only that key.
The environment-isolation test permits exactly this name only on Darwin,
keeps all other unexpected names forbidden, and checks an unusable credential
canary is absent. This corrects an observed OS assumption; no production
environment policy, gate level or threshold changed. The old assumption's
80/81 result and the earlier Request-unaware fake's 63/81 result are retained
as fixture findings, not successful red proofs or current-main certification.
The refreshed old-base Mac snapshot `85897211`/tree `d88477db` passed all
81 eval tests before and after five intended production mutation failures,
host/unit types, scoped lint/format, and the normal duplication gate. Its
receipt is `m75-mac-preliminary-final-scope/receipt.json` under the owned
external evidence directory. Exact source restoration was verified; model
attempts and paid calls were zero. This is preliminary proof only:
independent review, current-main integration and full rig gates remain open.

| Gate                  | Command                                                                                                                                                                                                                                                | Status                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format                | `prettier --check .`                                                                                                                                                                                                                                   | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Lint (type-aware)     | `eslint . --max-warnings=0`                                                                                                                                                                                                                            | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| CSS lint              | `stylelint "src/**/*.css" --max-warnings=0`                                                                                                                                                                                                            | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Types                 | `tsc --noEmit` over five projects: host, webview, unit, e2e, integration (`npm run typecheck`)                                                                                                                                                         | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Dead code             | `knip` (not `--strict`; see knip.jsonc)                                                                                                                                                                                                                | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Cycles                | `dpdm --no-warning --no-tree --exit-code circular:1 -T src/extension.ts src/host/backend/modelApiEntry.ts src/webview/main.tsx src/runtime/main.ts`                                                                                                    | M0 ✓; M57: the Model API bundle's entry added, without which its files left the check (227 files analysed instead of 203); PR #32: the ACP agent's entry                                                                                                                                                                                                          |
| Duplication           | `jscpd` (config `.jscpd.json`: threshold 0 over `src` and `test`)                                                                                                                                                                                      | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Unit tests + coverage | `vitest run --coverage`; thresholds 90 % statements, 85 % branches, 90 % functions and lines (D5); Windows runs test files serially (M50)                                                                                                              | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Integration tests     | `vscode-test` (two configurations: `stable` and `minimum`, the `engines.vscode` floor)                                                                                                                                                                 | M0 ✓ (9 passing locally since M18; CI: ubuntu xvfb + windows); M26 ✓ on 1.139.0 and 1.125.0, downloads cached in CI                                                                                                                                                                                                                                               |
| Build + bundle budget | `node scripts/build.mjs --production && node scripts/check-bundle-size.mjs`                                                                                                                                                                            | M0 ✓                                                                                                                                                                                                                                                                                                                                                              |
| Bundle split          | `node scripts/check-bundle-split.mjs` (part of `npm run build`): the Model API backend's lazy files stay out of `dist/extension.js` and in `dist/modelApi.js`, and every file of `src/core/backends/modelapi/` is on the lazy or the allowed list (D6) | M57 ✓ (drills in `docs/certification/m57.md`)                                                                                                                                                                                                                                                                                                                     |
| Host globals          | `node scripts/check-host-globals.mjs` (part of `npm run build`): no `navigator` in the host bundles (`extension.js`, `modelApi.js`, `searchWorker.js`)                                                                                                 | M26 ✓ (proof R); M57 ✓ for `modelApi.js` (drill in `docs/certification/m57.md`)                                                                                                                                                                                                                                                                                   |
| Third-party notices   | `node scripts/third-party-notices.mjs` (part of `npm run build`; `npm run notices` regenerates)                                                                                                                                                        | M26 ✓ (proofs P, Q; CI's package job requires the file in the .vsix)                                                                                                                                                                                                                                                                                              |
| Dependency audit      | `node scripts/audit.mjs` (`npm audit --json`, high and critical block; reviewed exceptions in `.github/audit-exceptions.json`, 90 days at most)                                                                                                        | M0 ✓; M26 ✓ (proofs S–W)                                                                                                                                                                                                                                                                                                                                          |
| Secrets               | `gitleaks git --redact` (history, `security:secrets`, also a CI job) and `gitleaks git --pre-commit --staged` (hook)                                                                                                                                   | M0 ✓ (staged-scan proof; the history scan runs locally and in CI)                                                                                                                                                                                                                                                                                                 |
| SAST                  | `node scripts/sast.mjs` (`npm run security:sast`): `semgrep scan --config auto --error`, with semgrep found on PATH or, failing that, in a Python's user Scripts folder                                                                                | M2 ✓ locally (pip-installed on Windows 2026-09-22, its Scripts folder added to the user PATH) and in the CI `sast` job. M26: CI pins semgrep 1.177.0 (`.github/semgrep/requirements.txt`, Dependabot pip).                                                                                                                                                        |
| PowerShell lint       | `node scripts/lint-ps.mjs` (PSScriptAnalyzer over `native/windows`, `npm run lint:ps`)                                                                                                                                                                 | M9 ✓ on Windows (exit = finding count; a reported skip on other platforms; installed on the CI Windows runner). M26: pinned to 1.25.0 (`-RequiredVersion`), the version CI installs. CI falls back to the Gallery's package endpoint, checked against the pinned SHA-512, when its search answers "No match" (2026-09-27; drill: a wrong hash stops the install). |
| Accessibility         | `node scripts/a11y.mjs` (`npm run test:a11y`, in `quality` after the build; in CI on Linux and Windows): axe-core over every harness scenario in the four default themes, WCAG 2.2 AA                                                                  | M37 ✓ (proofs A–G, J–M); Lighthouse itself is not run (D32)                                                                                                                                                                                                                                                                                                       |
| Localization          | `node scripts/check-l10n.mjs` (`npm run check:l10n`, in `quality:gates`): every table in `l10n/` against the English table, strictly; the manifest against `package.nls.json`; no `UI_TEXT` read at module load                                        | M40 ✓ (drills in `docs/certification/m40.md`)                                                                                                                                                                                                                                                                                                                     |
| Host API record       | `node scripts/check-host-api.mjs` (`npm run check:host-api`, in `quality:gates`; `--write` regenerates): `docs/ide-compatibility/host-api.md` against the source, and the portable code never reaching `vscode`                                        | M60 ✓ (drills in `docs/certification/m60.md`)                                                                                                                                                                                                                                                                                                                     |
| Hosts                 | `hosts.yml` (VSCodium, code-server, Theia, the agent package and key store, Jupyter, Emacs, Neovim) and `forks.yml` (Cursor, Devin Desktop, Kiro, Positron), CI only: each job runs one `test/hosts` script                                            | M62/M63 ✓ locally (drills H1–H5 in `m63.md`, F1–F2 in `m62.md`); the forks only on GitHub's runners                                                                                                                                                                                                                                                               |

**Resolved 2026-09-27: the bundle budget after M48–M56 joined M60–M63.**
The joined tree's build failed its size check (`dist/extension.js` 600.5
KiB against 600, `dist/acp.js` 874.1 KiB against 800) and no budget was
raised. Main's M57 took the Model API backend out of both: the extension is
432.5 KiB under its unchanged 600 KiB, and the agent, which loads the same
`dist/modelApi.js`, 713.2 KiB, whose budget is now 850 KiB (D6 amendments;
`docs/certification/pr32-integration.md`).

Aggregates: `quality:gates` = format:check, lint, typecheck, check:l10n, check:host-api, deadcode, cycles, duplication, test:unit, build, security:audit; `quality` = quality:gates + test:a11y + security:secrets + security:sast; `quality:ci` = quality:gates + test:a11y + test:integration (secrets and SAST are separate CI jobs). Integration tests run only in CI or via `npm run test:integration`.

The pre-commit hook runs `lint-staged` tasks serially, keeping the same lint
and format checks with fewer simultaneous children. On 2026-09-25 Windows
stalled and required a restart. A repeated local quality run exposed a burst
of `cmd.exe` processes launching ChromeControlMCP native messaging hosts;
they were children of the user's persistent Chrome process, not the
pre-commit hook. The earlier reboot has no bugcheck or dump, so its exact
cause is not proved. ChromeControlMCP's installed extension retries a
disconnected native host every two seconds. Disabling extensions in the
headless test browser and using Edge did not stop the burst from the
persistent Chrome profile; those attempted script changes were reverted.
Pause local browser gates while that extension is enabled. Hosted CI runs
remain available.

## 8. Escape hatches register

Every lint or scanner suppression (`eslint-disable`, `@ts-expect-error`, `nosemgrep`), every cast the compiler cannot verify, and every error swallowed inside generated shell, C# or Swift must be listed here with its reason. A TypeScript `catch {}` needs only an inline comment saying why the error is dropped.

M72's `src/host/checkpoints/checkpointStoreBundle.ts` uses the type predicate
`isCheckpointStoreBundle`: the required module is unknown; both exported
functions must exist. Their parameter/result types cannot be checked at
runtime and are trusted only because entry, loader and package come from one
source/build. `checkpointStoreBundle.test.ts` builds that actual entry, loads
it with Node require, exercises real activity/disposal and installed language,
and refuses missing/malformed modules before repairing them (2026-09-30).

| File                                            | Construct                        | Reason                                                                                                                                                  | Added      |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `src/host/checkpoints/checkpointStoreBundle.ts` | `value is CheckpointStoreBundle` | Checks both factory/reader functions from the same build and package; signatures are trusted as described above and the real built module is exercised. | 2026-09-30 |

| File                                     | Construct                                                                    | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Added      |
| ---------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `src/host/backend/toolIo.ts`             | `nosemgrep` on `spawn`, in `startProcess` (`detect-child-process`)           | The command line is the tool's payload by design: the user approved it on a card, and it runs through PowerShell / bash as an argument array, never a shell string. The comment moved with the call into `startProcess` (M72, 2026-09-30), which catches `spawn`'s synchronous throw and reports an unstarted shell; no suppression was added.                                                                                                                                                                                                                                         | 2026-09-22 |
| `src/host/backend/searchWorker.ts`       | `nosemgrep` on `new RegExp(pattern)` (`detect-non-literal-regexp`)           | The model's search pattern is evaluated on a worker thread that `toolIo.searchOnWorker` terminates at `SEARCH_TIMEOUT_MS`, and the pattern is capped at `SEARCH_PATTERN_MAX_LENGTH`; a runaway match cannot hang the host.                                                                                                                                                                                                                                                                                                                                                             | 2026-09-22 |
| `src/host/voice/dictationHost.ts`        | `nosemgrep` on two `spawn` calls (`detect-child-process`)                    | The dictation and capture helpers' command lines are fixed by `helperLocation.ts` (Windows PowerShell under `%SystemRoot%` with a bundled script, or the bundled macOS binary with VS Code's own app name (`--app-name`)); M35's Linux recorder is `arecord` or `parec` found by absolute path on PATH, with fixed arguments. Argument arrays; no user, model or workspace input reaches them.                                                                                                                                                                                         | 2026-09-25 |
| `native/darwin/Dictation.swift`          | `unsafeBitCast(symbol, to: SetDisclaim.self)`                                | `responsibility_spawnattrs_setdisclaim` is a private libsystem call with no header, so it is resolved with `dlsym` and cast to its C signature, `int (posix_spawnattr_t *, int)`, the one Chromium and Qt declare (M28). A missing symbol is handled before the cast (the helper then asks as before); the signature has been stable since macOS 10.14.                                                                                                                                                                                                                                | 2026-09-23 |
| `src/host/backend/shellJob.ts`           | `catch { }` in the join statement each Windows command starts with           | A command whose job cannot be joined (the assembly removed since the self-test, a policy change) must still run as it would without one; its kill then finds no job, logs that, and falls back to taskkill and the sweep (M27), so the failure is reported where it matters.                                                                                                                                                                                                                                                                                                           | 2026-09-23 |
| `test/unit/App.test.tsx`                 | `as unknown as Selection` (four stubs)                                       | jsdom offers no usable `Selection`; the quote-menu tests stub the two members the code reads (`toString`, `anchorNode`) and nothing else, so a structural cast is the honest shape. Test-only.                                                                                                                                                                                                                                                                                                                                                                                         | 2026-09-23 |
| `scripts/capture-themes.mjs`             | `nosemgrep` on `spawn` (`detect-child-process`)                              | A developer script (M37): it starts the VS Code build `@vscode/test-electron` downloaded, with its own fixed arguments, as an argument array with no shell. Nothing from a user, the model or a workspace reaches it, and it never ships.                                                                                                                                                                                                                                                                                                                                              | 2026-09-24 |
| `scripts/sast.mjs`                       | `nosemgrep` on two `spawnSync` calls (`detect-child-process`)                | The SAST gate's own launcher (M40): it runs `semgrep` or the semgrep executable found in a Python's user Scripts folder, and asks the interpreters in a fixed list (`python`, `python3`, `py`) where that folder is. Every command and argument is the script's own, passed as an argument array with no shell; nothing from a user, the model or a workspace reaches them, and the script never ships.                                                                                                                                                                                | 2026-09-25 |
| `src/host/backend/mcpProcess.ts`         | `nosemgrep` on `spawn` (`detect-child-process`)                              | A stdio MCP server the user configured in Muse Code's own settings file (M50, D42), started only in a trusted workspace: its command found by absolute path (D24), its arguments passed as an array. A `.cmd`/`.bat` launcher goes through `cmd.exe /d /v:off /s /c` with every part quoted and `"`, `%` and line breaks refused. Nothing the model writes reaches the command line.                                                                                                                                                                                                   | 2026-09-25 |
| `src/host/backend/mcpJobLaunch.ts`       | `nosemgrep` on `spawn` (`detect-child-process`)                              | On Windows M50 starts only its compiled C# executable in extension storage, with no arguments. The configured command, arguments and allowlisted environment are in a private encoded environment value; C# removes it and builds the server's exact environment before `CreateProcessW`. The server is assigned to its job before its first instruction. Since M56 the launcher's C# ships as `native/windows/MuseSparkMcpLauncher.cs` and the shared `MuseSparkMcpJob.cs`, is read by `jobSourceReader`, and compiles to an executable named by its source's digest (`jobBuild.ts`). | 2026-09-26 |
| `test/unit/helpers/fakeMcpOrphan.mjs`    | `nosemgrep` on `spawn` (`detect-child-process`)                              | The M50 Windows regression fixture starts only this Node with its own fixed file to test an MCP server whose child outlives it. The child self-exits after 12 seconds; no model or workspace input reaches its command line, and the fixture never ships.                                                                                                                                                                                                                                                                                                                              | 2026-09-25 |
| `src/host/backend/modelApiBundle.ts`     | `value is ModelApiBundle` (`isModelApiBundle`, a type predicate)             | `require` of `dist/modelApi.js` returns `unknown`; the guard checks that `createModelApiHost` is a function, but not its parameter and result types, which no run-time check can see. Both bundles come from one source tree in one `npm run build` and ship in one package, this module types the factory on both sides, and `modelApiBundle.test.ts` builds the real bundle and runs a turn through it (M57).                                                                                                                                                                        | 2026-09-27 |
| `src/host/codeIntel/languageServices.ts` | `Reflect.get(edit, '_allEntries')`, an undocumented member                   | VS Code's `WorkspaceEdit` API lists only text edits (`entries()`, and `size` counts them), so a rename that also moves or creates files looks plain. The internal `_allEntries()` (1.99.0 to 1.139.0) lists every entry with its `_type`; it is read as `unknown` and parsed with zod, and a missing member or a changed shape answers `unknown`, which refuses the rename rather than applying half of it (M67). `languageServices.test.ts` and the integration suite cover both.                                                                                                     | 2026-09-28 |
| `src/runtime/main.ts`                    | `nosemgrep` on `spawn` (`detect-child-process`)                              | The ACP agent's `login` (M63, D62) runs `muse login` in the user's terminal the way the agent starts `muse serve`: the command is the CLI `MuseCodeBackendManager.resolveLaunch` found (the install layout, `PATH`, or an absolute `--muse-binary` that must exist, D1a, D4), the arguments its launcher's fixed prefix and `MUSE_LOGIN_ARGS`, passed as an array with no shell. Nothing from an editor, the model or a workspace reaches it. Found by the first local SAST run on PR #32's code (2026-09-27).                                                                         | 2026-09-27 |
| `src/core/browser/canaries.ts`           | `nosemgrep` on a plain WebSocket URL (`detect-insecure-websocket`)           | Canary C2 (M81 A1, design spec v4 §7): the probe page opens a plain WebSocket to a reserved `.invalid` nonce name so that its CONNECT can be seen refused at the check's own proxy; it never connects and nothing is sent over it.                                                                                                                                                                                                                                                                                                                                                     | 2026-10-02 |
| `src/host/browser/browserProcess.ts`     | `nosemgrep` on `spawn` (`detect-child-process`)                              | The browser check (M81 A1, D49) starts only the pinned Chrome for Testing headless shell at the absolute path the runtime bundle verified against `browserRuntime.json` in the extension's own storage (never PATH, a system browser or a workspace file), its identity read again just before, as an argument array with no shell: the fixed flags of `BROWSER_LAUNCH_FLAGS`, the check's own proxy endpoint and profile, and a projected environment. The model's URL and steps go over the CDP pipe, never on the command line.                                                     | 2026-10-02 |
| `src/host/browser/browserProcess.ts`     | `nosemgrep` on `execFile` (`detect-child-process`)                           | The tree kill of the check's own browser on Windows: `taskkill.exe` by its absolute path under `SystemRoot` with `/PID <the browser's pid> /T /F`, an argument array, no shell. POSIX kills the browser's own process group instead.                                                                                                                                                                                                                                                                                                                                                   | 2026-10-02 |
| `src/host/browser/browserChecks.ts`      | `value is BrowserCheckBundle` (`isBrowserCheckBundle`, a type predicate)     | `require` of `dist/browserCheck.js` returns `unknown`; the guard checks that `runBrowserCheck` is a function, not its parameter and result types. Entry, loader and package come from one source tree and one `npm run build` (M81, the checkpoint store's pattern); the real runner is exercised against real browsers by `browserCheckLive.test.ts`, and a missing or malformed bundle refuses the check and is read again later.                                                                                                                                                    | 2026-10-01 |
| `src/host/browser/browserChecks.ts`      | `value is BrowserRuntimeBundle` (`isBrowserRuntimeBundle`, a type predicate) | `require` of `dist/browserRuntime.js` returns `unknown`; the guard checks that `prepareRuntime` is a function. The same build, pattern and refusal as the check's bundle (M81 A1); the real store is exercised end to end by `runtimeStore.test.ts` on real folders and by the rigs' runs of the built bundles.                                                                                                                                                                                                                                                                        | 2026-10-02 |
| -------------------------------------    | ------------------------------------------------------------------           | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `test/unit/verifyEditor.test.ts`         | `as unknown as` on five `vscode` stubs                                       | The `vscode` mock has no `TextDocument`, `TextEditor`, `Diagnostic`, `TextEdit` or `WorkspaceConfiguration` classes; the M68 verify editor's tests stub only the members it reads (a document's `uri`, `isDirty`, `eol`, `getText`, `offsetAt`; an editor's `document.uri`; a diagnostic's severity, range start, message and source; an edit's range and text; a configuration's `get`), so a structural cast is the honest shape. Test-only.                                                                                                                                         | 2026-09-28 |

## 9. Security assumptions and accepted residual risk

- Code intelligence (M67) shows what VS Code's language services say. A
  result located outside the workspace is left out and a hover defined only
  there is held back, but a language service also infers: a workspace
  symbol whose type comes from an imported file outside the workspace (a
  `../` import, a `tsconfig` path) carries that type, a literal type
  included, into its hover and into diagnostics, as the editor shows it.
  Accepted: it is the language's own view of the workspace the user opened,
  the same text the Problems panel (`getDiagnostics`) already sends.

- The `muse` CLI is closed source; we trust its stdio protocol as documented
  by Meta's SDK and validate every message shape at our boundary. Residual
  risk: a compromised or malicious CLI binary on the user's PATH; mitigated
  by honouring an explicit `museBinaryPath` and logging the resolved path.
- Muse Spark's tool execution semantics (which commands it runs, how approvals
  are enforced) are the CLI's responsibility in the MSP backend. Our UI never
  auto-approves outside the mode the user selected; the one automatic answer
  is "Edit automatically" allowing a plain file write once (D24), never a
  protected write, an escalation or a command.
- The Model API backend (M7) executes tools in-process. The controls (D24):
  path confinement by canonical path (links and junctions resolved, Windows
  reinterpreted names refused), protected writes that always ask, per-call
  approval in Manual, session rules keyed on the exact command, and
  "Bypass permissions" opt-in via a setting exactly as in Claude Code,
  confirmed once in a remote window. Residual risk: a file swapped for a link
  between the check and the write (a local attacker already inside the
  workspace); the check runs immediately before each operation.
- Programs are started by absolute path (D24): git, bash and PowerShell from
  absolute `PATH` entries, the CLI from its install layout or an absolute
  `museBinaryPath`; git never runs in Restricted Mode.
- The browser check (M81 A1, D49; design spec v4) runs the page's own code
  in Google's Chrome for Testing headless shell, the version this release
  pins, downloaded only after consent, verified by length and SHA-256 with a
  bounded ZIP reader and checked again before each check, over the
  debugging pipe, in a fresh private profile. Its traffic goes to the
  check's own proxy on 127.0.0.1 (the command line's, Chrome's implicit
  loopback bypass subtracted, and the private context's): plain HTTP only to
  loopback or a widened host, sign-in challenges and credentials stripped
  both ways, CONNECT only to a widened host. The browser's resolver rule
  fails every name but the loopback literals (traced on Linux: no query for
  a page's, an ICE server's or a `.local` name; the same names queried with
  the rule removed). The check's canaries, in default, page and audit
  phases, must show the route, the stripping, WebRTC and WebTransport held,
  and a network-service restart refuses the check. Residual risk: `https`
  and WebSocket tunnels to a widened host are opaque to the proxy, and the
  site there may use the machine's account (Windows integrated sign-in
  especially); this is the browser's own construction checked at runtime,
  not an OS or kernel boundary (A2, a Linux namespace, is a later lane);
  the network service runs with the pin's own sandbox settings. A window
  that dies mid-check leaves its check folder under the extension's
  storage, swept by a later check once its owner process is gone. The page
  runs as any page in a browser does; the check does not make the user's
  dev server safer.
- The `ide` server's browser check widens to a host beyond loopback only
  with the user's answer in the extension's modal; a Model API check only
  with a card for that host (Bypass included) or an "always" chosen on one.
- Ending a stopped command on Windows (M27): each command runs in a job
  object, so everything it starts ends with it. Residual risk where no job
  can be made (Constrained Language Mode, which forbids `Add-Type`; the log
  says so at the first command): the fallback cannot reach a process whose
  launcher started it during the kill and exited before the sweep (no
  parent link is left), and its identity check and kill are microseconds
  apart in one PowerShell run rather than one atomic call. A process that
  breaks away from a job on purpose (`CREATE_BREAKAWAY_FROM_JOB` is refused
  without a limit this job does not set) is not a residual.
- Memory (M49, D41): the Model API backend and the Memory view write Muse
  Code's notes without taking its native `.muse-memory.lock` (the memory
  writer's use of the observed Windows locking helper, hold lifetime and
  portable protocol have not been proved; a stale PID file remains
  after the owner exits). Each write replaces the
  file whole, so no note is ever half written; residual risk: Muse Code and
  the extension writing the same note in the same instant keep only one of
  the two writes. Notes reach every later session, the personal scope every
  project, so a model's write asks in Manual (Muse Code's does not). Under
  turn checkpoints (M72) the memory tools' and the view's writes keep a copy
  of an ignored project note first, and the view's create and trash hold the
  restore lease (personal notes outside the workspace take none).
- Turn checkpoints (M72, D51) copy the workspace's files into the
  extension's workspace storage, and an ignored file (a `.env`) only when
  the extension's own tools are about to write it or a restore overwrites
  or deletes it (for Redo). The copies never enter the workspace's `.git`,
  stay on the machine in a folder that is 0700 on POSIX, and go with the
  conversation, the retention bounds (applied at every window open) or the
  storage directory. Residual risk: whoever can read VS Code's storage
  directory as the user can read them, as they can the workspace itself. A
  restore refuses any path with a link or junction on the way and
  re-checks each file's content just before changing it; a file swapped
  for a link between that check and the write is the same residual as the
  Model API tools'.
- Opening files for their diagnostics (M68): VS Code's language servers
  report only on shown files, and showing a file can make an extension load
  its configuration as code. The verify loop never shows or formats a
  code-loading file (`CODE_LOADING_FILE_PATTERNS`, `node_modules`) and,
  once the Model API conversation wrote one, shows and formats nothing more
  until the user's next message. Residual risk: the extension does not see
  Muse Code's own writes, so after Muse Code writes, say, `eslint.config.js`
  (with its own approval), a later `getDiagnostics` request for an ordinary
  file still shows that file, and the ESLint extension may then load the new
  config. The pattern list is also a named list, not every tool's
  convention; a config an extension loads under another name is not
  covered. Check paths on Windows are refused by character, a deny list
  over PowerShell 5.1's and `cmd.exe`'s syntax as measured, with only
  existing workspace files passed.
  Every act the verify loop takes on a file after an await (format on
  edit's open and write-back, `then_run`, the diagnostics' show and read,
  `getDiagnostics`, a check's path arguments) uses the real path and
  canonical name confinement found and checks the file just before (the
  Codex review of PR #54; the sites are listed in the M68 certification).
  Residual risk: a moment remains between that check and the act (no
  compare-and-swap on the file system; an atomic rename cannot be
  conditional), and a folder on the real path swapped for a link in that
  moment is not caught. Format on edit's write-back goes through the one
  conditional write (`fsAtomic.writeFileIfUnchanged`, PR #54's third
  review), which compares the target's bytes first and again immediately
  before each rename attempt. No file system offers a conditional rename.
  On POSIX the rename replaces the name whoever has the file open: a change
  saved between the last comparison and the rename is replaced, and a
  program still writing through its open handle to the old file writes
  into a file that no longer has a name. On Windows the rename is refused
  while another program holds the file without sharing delete, and each
  retry compares again; a change saved and closed between the last
  comparison and the rename is still replaced. The verify ledger knows a
  file by its real path: two hard links to one file are two files there,
  so an edit through one does not make a run over the other stale.

- M50's Windows stdio server inherits the extension's three binary pipes
  unchanged. A hidden helper creates it suspended, assigns it to a fresh
  kill-on-close job and resumes it only after a nonce READY/GO exchange over
  a separate private pipe proves the creating Node process still lives after
  its real process handle was bound. The handle is checked again immediately
  before resume. Normal exit, Stop, batch launch, detached-child, parent-death
  and withheld-GO fixtures passed; assignment-off and confirmation-off red
  drills failed as intended.
  When the job executable cannot run, stdio fails closed rather than using the
  taskkill fallback. After the initial binding, all waits and cleanup use
  handles; a recycled PID cannot authorize a launch because it has no GO
  pipe. The private nonce and launch payload never reach the MCP server's
  environment or protocol streams. On POSIX, an exited parent causes its original process
  group to be signalled; descendants that form a new process group can
  escape it.
- The pasted Model API key is used only by the Model API backend and is
  never handed to the Muse Code CLI (D1 amendment): subscription work is
  never billed to the key, and the key never reaches another process.
- MCP servers on the Model API backend (M50, D42) are the user's own code,
  unsandboxed, as they are under Muse Code: the controls are that none runs
  in Restricted Mode, every call asks in Manual and Auto (a tool its server
  marks read-only runs in Auto, as Muse Code runs it) and Plan refuses all
  but read-only tools, a stdio server inherits only an allowlist of the
  extension host's environment (never the key, which is in SecretStorage,
  not the environment), and remote servers get only their entry's headers,
  never across a redirect. Residual risk: a server's own `readOnlyHint` is
  trusted, as Muse Code trusts it; a result's text reaches the model as
  data it may be steered by (prompt injection), as a web page's would.
- Web fetch (M69, D49) reaches the internet from the user's machine. The
  controls: `https:` only; every DNS answer checked against the non-public
  ranges and the connection pinned to a checked address (through a proxy,
  the tunnel is asked for that address, and only a TLS answer is read);
  same-host redirects checked and pinned again, another host's handed back;
  size, time and type bounds; per-host approval in every mode but Bypass,
  Plan and Restricted Mode refusing; on Muse Code the extension's modal
  before every call. Residual risks: (1) an intranet service on a public
  address, or a split-horizon name that answers public addresses here,
  looks like the internet; (2) the URL is model-written and reaches the
  host the user approved, so it can carry conversation text there (the
  card and the modal name it whole; a session rule covers one host); (3)
  the page's text steers the model like any tool output (the markers and
  the notice are a signal, not a guarantee); (4) on a network where only
  the proxy can resolve names, the local check refuses every fetch, which
  fails closed; (5) the proxy decision (`http.noProxy`, a PAC file) sees the
  pinned address, not the host name, so a rule written for a name does not
  apply; (6) NAT64 discovery takes the prefix from answers either the
  system resolver (as the page's name was looked up) or a DNS query of its
  own (c-ares) returns, and only the DNS query's NXDOMAIN or NODATA means no
  DNS64 (getaddrinfo's ENOTFOUND proves nothing); any other outcome uses no
  IPv6 answer, so what remains is a DNS server that answers NODATA while the
  system resolver's path synthesizes nothing for `ipv4only.arpa` but does
  for other names; (7) VS Code cannot close a modal, so the extension's
  question for a Muse Code call that was stopped stays open until answered,
  and its answer then fetches nothing; (8) the model reads a page's text as
  served, which can include text a browser would not show (hidden by a
  stylesheet, an attribute or a script), all of it marked untrusted: the
  converter emulates no rendering and leaves out only what is never page
  text by structure; (9) parse5 is quadratic on hostile
  nesting, so such a page costs up to 10 seconds of one worker thread before
  it is refused.
- Contributor-tier models send content Meta may train on; guarded by opt-in
  dialog and `confidentialWorkspace` setting.
- The Marketplace token (M28, 2026-09-23): the publish job runs in the
  `marketplace` environment, whose only deployment policy is the `v*` tag
  pattern, and the token is that environment's `VSCE_PAT` secret, not a
  repository secret: no branch run can reach it, and on a tag only the
  publish job, in its one step. It is a Marketplace-Manage PAT scoped to
  the `securecoast` organisation (Azure DevOps stops all-organisation PATs
  on 2026-12-01).
- Repository protection (GitHub rulesets, 2026-09-23): `main` cannot be
  deleted or force-pushed and takes changes through pull requests with the
  seven CI checks green (the three quality jobs, gitleaks, semgrep, the
  macOS helper, the package); `v*` tags cannot be deleted or moved. The
  repository admin bypasses both for direct pushes and releases, and every
  bypass is logged by GitHub. A moved tag, as with 0.5.2, is then a
  deliberate bypass rather than a habit.

## 10. Definition of done and release records

M0–M8 certified (owner decision 2026-09-22: both backends ship in v0.1.0);
all gates in §7 passing in CI on ubuntu and windows; `vsce package` produces a
`.vsix` under budget that installs and signs in on a clean VS Code 1.130+;
README, CHANGELOG, PRIVACY current; no rows in §8 without a reason.

**Status 2026-09-22:** M0–M8 certified (`docs/certification/m0.md` …
`m8.md`); CI green on ubuntu, windows and macos; `npm run package` builds
`muse-spark-code-0.1.0.vsix` and it installs into an isolated VS Code
1.138.0 (`docs/certification/m8.md`). M9 (voice dictation) added the same
day: certified on Windows against a synthesised recording
(`docs/certification/m9.md`); the owner's microphone check in the dev host
and the macOS helper's first run on a Mac were then done the same evening
(m9.md: real microphones on both, text back). **Published 2026-09-22:**
`RandyNorthrup.muse-spark-code` v0.1.0 went to the Marketplace from the CI
`package` artifact of `b7f4f12` (run 35798035328) through `npx vsce publish
--packagePath`, with a Marketplace (Manage) PAT the owner authorised,
minted in Azure DevOps (organisation `securecoast`, all accessible
organisations, 30 days) and taken from the clipboard into `VSCE_PAT`,
never written anywhere. Extension page:
https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code.
Still open: the Model API path's live turn (the owner deleted the
pay-as-you-go key on 2026-09-22; the fake-server contract tests stand).

**0.1.1 (2026-09-22, later):** the VS Code floor dropped to `^1.125.0`
after a clean VS Code 1.130.0 refused 0.1.0; the README was rewritten
around the panel with a banner, screenshots and a social preview image
(`npm run images`); Marketplace description, keywords and gallery banner
refreshed; the GitHub About and topics set. The CI package of `d44ec56`
installed and uninstalled cleanly on that 1.130 machine. On the owner's
go the repository went public, 0.1.1 was published from the CI artifact
of `d7274c7` (run 35802578451; the sparkle icon of 0.1.0, Google's mark,
replaced by a plain "M" tile, and the banner and social image made
typography only at the owner's direction), tagged `v0.1.1`.

**Towards 0.2.0 (2026-09-22, evening):** the owner asked whether the agent
uses skills, `AGENTS.md` and memory properly. D13 records the finding
(the CLI backend never received `--trust-workspace`, so rules and project
skills were skipped; the Model API backend had none of the three) and the
decision; D14 the production-hardening audit. M10 and M11 carry the work;
0.2.0 ships when both are certified, with `release.yml` making the tag,
the GitHub Release and (with the repository secret) the Marketplace
publish one operation.

**0.2.0 (2026-09-22, night):** M10 and M11 certified
(`docs/certification/m10.md`, `m11.md`); version bumped, `CHANGELOG.md`
section promoted, tagged `v0.2.0` and pushed so `release.yml` builds,
creates the GitHub Release with the `.vsix` and publishes to the
Marketplace if `VSCE_PAT` is set. Run 35808358781: every job green (quality on
three platforms, integration tests, the macOS helper, the `.vsix`, gitleaks,
semgrep), the GitHub Release created with `muse-spark-code-0.2.0.vsix`
(370,790 bytes); the Marketplace publish step skipped as designed because no
`VSCE_PAT` repository secret exists, so 0.2.0 reaches the Marketplace by the
clipboard-PAT flow or once the owner adds the secret and the publish job is
rerun.

**0.3.0 (2026-09-22, late):** the owner asked whether the Claude Code
extension's preconfigured files hold things this extension should have;
D15 records the reading and M12 the work (setting scopes, the panel
serializer, the walkthrough, five commands, keybinding `when` clauses, the
Model API prompt's environment and working rules). Certified
(`docs/certification/m12.md`), tagged `v0.3.0` (f54e620). Run 35811829058: every job green, the GitHub
Release created with `muse-spark-code-0.3.0.vsix` (528,235 bytes; the
walkthrough images account for the growth over 0.2.0), the Marketplace
publish step skipped again for want of a `VSCE_PAT` repository secret.

**0.3.1 (2026-09-22, late):** the owner asked for proof of production
readiness; D16 records the verification and M13 the fixes: the process-level
e2e suite against a fake CLI, the one live drill, the coverage holes, the
dead branch, the test casts, the orphaned script, and the fork/rewind menu
from the owner's screenshot. Certified (`docs/certification/m13.md`),
tagged `v0.3.1`. The tag's first release run failed on the Ubuntu and
macOS runners (the e2e harness race, `m13.md`); after the fix the tag was
moved to 038e759 and run 35817944139 went green: every job, the GitHub
Release with `muse-spark-code-0.3.1.vsix` (530,285 bytes), the Marketplace
publish step skipped without `VSCE_PAT`.

**0.4.0 (2026-09-22, night):** the owner asked for the picker default, the
Account & Usage modal, subagents with the Agent map, the banner and the
compact button, in one milestone; D17 records the reading and M14 the
work. Certified (`docs/certification/m14.md`), tagged `v0.4.0`; run
35820788011 went green on the first try: every job, the GitHub Release
with `muse-spark-code-0.4.0.vsix` (540,169 bytes), the Marketplace publish
step skipped without `VSCE_PAT`.

**0.4.1 (2026-09-22, later that night):** the owner's first F5 round on
0.4.0 (D18, M15): the pill that read "Starting Muse Code…" until clicked,
transcript scrolling with a jump to the newest, chevrons, the response Copy,
outputs and long diffs opening in the editor, the decision-error wording.
Certified (`docs/certification/m15.md`), tagged `v0.4.1`; run
35823628224 went green on the first try: every job, the GitHub Release
with `muse-spark-code-0.4.1.vsix` (542,559 bytes), the Marketplace publish
step skipped without `VSCE_PAT`.

**0.4.2 (2026-09-22, night):** the owner's second F5 round (D19, M16):
the pill's model at panel open, thinking rows as Claude Code shows them,
path links that open the file at the change, Click to expand on every
stored-patch diff, the last usage window "as of". Certified
(`docs/certification/m16.md`), tagged `v0.4.2`; run 35827249477 went green on
the first try: every job, the GitHub Release with
`muse-spark-code-0.4.2.vsix` (544,515 bytes), the Marketplace publish step
skipped without `VSCE_PAT`.

**0.4.3 (2026-09-22, night):** Reply to an output, and Ask about / Comment
on highlighted chat text, each carrying a `<chat_reference>` context part
(D20, M17). Certified (`docs/certification/m17.md`), tagged `v0.4.3`; run
35829514046 went green on the first try: every job, the GitHub Release with
`muse-spark-code-0.4.3.vsix` (547,147 bytes), the Marketplace publish step
skipped without `VSCE_PAT`.

**0.5.0 (2026-09-23):** the verification round and the orchestration it
called for (D21, M18): every screen rendered and viewed through the
harness, the subagent and reply-only drills run live, a child's items kept
in its agent's transcript, the map's owner controls (interrupt, stop,
resume, close, note, follow-up task), the usage classifier's child marker,
one usage-modal text fixed, subagent tool labels and the tool approval
wording, the drill budget set from three measurements. Certified
(`docs/certification/m18.md`), tagged `v0.5.0`; run 35832423906 went green on
the first try: every job, the GitHub Release with
`muse-spark-code-0.5.0.vsix` (549,724 bytes), the Marketplace publish step
skipped without `VSCE_PAT`. Published by hand later that day from that
release vsix (`npx vsce publish --packagePath`, the PAT from the clipboard;
`vsce show` lists 0.5.0 as the latest version), so 0.5.0 is the first
Marketplace release since 0.1.1. The three Windows CLI faults recorded in
D19 and the M8 wire notes went upstream the same day as
meta-models/muse-code-sdk#29 (`approval/decide` ledger fence), #30
(`session/rename`) and #31 (`session/fork`). The `VSCE_PAT` repository
secret was set the same day, after the auto-mode classifier had refused
`gh secret set` and the browser route and the owner switched permission
modes, so the release workflow publishes every later tag itself.

**0.5.1 (2026-09-23):** a docs-only patch to refresh the listing and prove
the workflow publish: the README's Marketplace version and installs badges
moved from shields.io (which retired its Visual Studio Marketplace
endpoints and rendered "retired badge" on the listing page) to badgen.net,
the install line names the new vsix, and the records above. Tagged
`v0.5.1`; run 35892611160 went green on the first try: every job, the
GitHub Release with `muse-spark-code-0.5.1.vsix` (549,903 bytes), and the
Marketplace publish job's own `vsce publish` ("Published
RandyNorthrup.muse-spark-code v0.5.1."), the first release the workflow
published itself. From here a release is a version bump, a CHANGELOG
section and a `v*` tag.

**0.5.2 (2026-09-23):** the first community fix, issue #4 (D22, M19),
merged from `fix/composer-autogrow` through pull request #5 with its CI
green, and the README brought up to date: the Open diff and Revert buttons
it still promised (gone since 0.4.2), subagents and the Agent map, reply
and quote, question cards, outputs in the editor and the usage insights in
the highlights, the workflow publish in place of the by-hand recipe, the
live drill's budget, the three upstream issues in Troubleshooting, and
eleven screenshots rendered from the shipped panel by the harness in place
of the 0.1.1 captures. The first `v0.5.2` tag (8d464e7) failed CI on
Windows alone: every test green, then the e2e suite's teardown could not
unlink the fake CLI's executable (`EPERM`) because the disposed process had
not yet let go of it; the same tree had passed on the pull request. A
first fix (Node's retries alone) still failed under a full local run, so
its tag's run was cancelled before it built anything; the teardown now
retries and then reports a folder it cannot remove and leaves it to the OS
temp cleanup, since housekeeping must not fail a green suite. The tag was
moved to the fixed commit each time before anything was released (neither
failed run built a package or a GitHub Release). The final tag (3e14768):
run 35896194634 went green on every job, the GitHub Release carries
`muse-spark-code-0.5.2.vsix` (551,810 bytes) and the workflow's own
publish reported "Published RandyNorthrup.muse-spark-code v0.5.2.". The tag
is the tip of `main` but for this record.

**0.5.3 (2026-09-23):** the owner's donate link, the same PayPal button
his other repositories carry: the manifest's `sponsor.url` (the Sponsor
link on the Marketplace listing), `.github/FUNDING.yml` (the repository's
Sponsor button) and a "Support this project" section plus a badge in the
README. `manifest.test.ts` ties the manifest's link to `FUNDING.yml`
(broken on purpose by changing the manifest's URL: the test failed, exit
1; restored). Tagged `v0.5.3` (c1e13cc); run 35897896612 went green on
every job, the GitHub Release carries `muse-spark-code-0.5.3.vsix`
(552,200 bytes) and the workflow published it ("Published
RandyNorthrup.muse-spark-code v0.5.3.").

**Still open since 0.1.0:** a live turn on the Model API backend. The owner
holds no pay-as-you-go key (deleted 2026-09-22); the fake-server contract
tests and the e2e suite stand in, and the path is marked as certified
against fakes only.

**0.5.4 (2026-09-23):** the documentation cleanup. A read-only audit of
every document against the code found 38 stale or false statements and
eight organisation points; all fixed (the CHANGELOG lists them by file), the
worst being three places that still said the pasted key reaches the CLI.
Released because the walkthrough, `docs/PRIVACY.md` and the `autosave`
description ship inside the package, so the listing carries them. The
Claude Code reference screenshots left the repository, the certification
folder has an index, the harness keeps its Chrome profile in a temporary
directory. Tagged `v0.5.4` (af9cac0); run 35899149702 went green on every
job, the GitHub Release carries `muse-spark-code-0.5.4.vsix` (552,723
bytes) and the workflow published it ("Published
RandyNorthrup.muse-spark-code v0.5.4."). The tag is the tip of `main` but
for this record.

**0.5.5 (2026-09-23):** rewind across subagents (D23, M20): every edit
takes an arrival number when it completes and the rewind unwinds the
conversation's and its agents' edits in the reverse of that order; before,
a delegated run's edits survived a rewind. Tagged `v0.5.5` (6b39fdc); run 35908838272 went green on every job, the
GitHub Release carries `muse-spark-code-0.5.5.vsix` (553,376 bytes) and the
workflow published it ("Published RandyNorthrup.muse-spark-code v0.5.5.").
The first push under the rulesets: GitHub logged the admin bypass for the
direct push and the tag, as designed. The tag is the tip of `main` but for
this record.

**0.6.0 (2026-09-23):** the hardening release. A deep-scan audit of the
code against other harnesses' bug trackers and the platform documentation
(D24) found rows in seven sections; all fixed, each with a test fired
against a deliberate break: security and confinement (D24, M21, pull
request #6), processes and lifecycle (D25, M22, #9), protocol and backend
semantics (D26, M23, #10), editing correctness (D27, M24, #11), webview and
UI state (D28, M25, #8), packaging, CI, platform and voice (D29, M26, #7),
and the cross-harness rows of section G within them. The release gate
itself found one more: on Windows `taskkill /T` missed a child started
during the kill, now closed with a job object per command (D25, M27, #12).
Every milestone went through a pull request with the CI checks green on the
three platforms and its Codex review threads answered. The release went
through pull request #13 from `release/0.6.0`. Its first Windows runs
failed twice before any product code was at fault: the PowerShell Gallery
answered the PSScriptAnalyzer install with "No match was found" (now tried
three times), and a test timed the tree kill's orphan sweep instead of the
pipes closing (now timed to the close, and fired). Tagged `v0.6.0`
(06e90a0) through the pull request, with no bypass; run 35944253997 went
green on every job, the GitHub Release carries
`muse-spark-code-0.6.0.vsix` (595,704 bytes) and the workflow published it
("Published RandyNorthrup.muse-spark-code v0.6.0."); the Marketplace listed
0.6.0 at 01:55:42 UTC, six minutes later (`vsce show`). The tag is the tip of
`main` but for this record, which follows through its own pull request.

**0.7.0 (2026-09-25):** what could be built without Meta (D30), and the
owner's asks that followed:

- macOS dictation asking for its permissions under its own name, and the
  release token moved into the `marketplace` environment (D29, M28, pull
  request #15, merged after 0.6.0);
- `.muse/` protected on the Model API backend (M29, pull request #16);
- skills managed and imported, Claude Code and Codex sessions continued,
  conversations exported (M30, #16);
- MCP servers and hooks shown read-only, with PowerShell's typographic
  quotes escaped (M31, #17);
- worktrees (M32, #17);
- a rewind that finds an edit that only moved (D31, M36, #17);
- the accessibility gate, WCAG 2.2 AA in VS Code's four themes, and the
  fixes it found (D32, M37, #18);
- `/` as in Claude Code: the palette, then the slash commands (M38, #19);
- logging and performance you can see (M39, #20).

Every milestone went through a pull request with the CI checks green on the
three platforms (the accessibility gate on Linux and Windows) and its Codex
review threads answered. The release went through pull request #21 from
`release/0.7.0`. Tagged `v0.7.0` (d6e7d34) through the pull request, with no
bypass; run 36081932348 went green on every job (01:25 to 01:35 UTC on
2026-09-25), the GitHub Release carries `muse-spark-code-0.7.0.vsix`
(646,542 bytes) and the workflow published it ("Published
RandyNorthrup.muse-spark-code v0.7.0." at 01:35:36 UTC); the Marketplace
listed 0.7.0 at 01:41:52 UTC (`vsce show`). The tag is the tip of `main` but
for this record, which follows through its own pull request with the README
rewritten for the release (the harness fixes it needed are recorded in
`docs/certification/m37.md`).

**0.7.1 (2026-09-25):** the new mark on the Marketplace listing. The owner
noticed the listing still showed the plain "M": the icon travels inside the
published `.vsix`, and the squiggled "m" had reached `main` only (pull
request #22, with the README rewritten for 0.7.0). This patch release
carries what #22 merged:

- the Marketplace icon, the README banner and the social preview's new
  mark;
- the README rewrite and the corrected setting descriptions and file-tool
  hint;
- the composer's refit moved to the next frame, so resizing the sidebar no
  longer logs a false panel failure;
- the harness fixes and the accessibility gate failing a scenario that
  throws.

M40a (pull request #23) waits for this release and goes out with the
translations. The release went through pull request #24 from
`release/0.7.1`. Its Codex review found the gate recorded with
`security:sast` failing on the Bash tool's PATH; the launcher from #23
(`scripts/sast.mjs`) came in, and `npm run quality` exited 0. Tagged
`v0.7.1` (9604cc6) through the pull request, with no bypass; run
36101852971 went green on every job (06:12 to 06:22 UTC on 2026-09-25), the
GitHub Release carries `muse-spark-code-0.7.1.vsix` (650,113 bytes) and the
workflow published it ("Published RandyNorthrup.muse-spark-code v0.7.1." at
06:22:20 UTC); the Marketplace listed 0.7.1 at 06:28:37 UTC (`vsce show`),
and its page showed the squiggled "m" as the icon.

**0.8.0 (2026-09-25):** the panel in VS Code's display languages (D33, M40).
The owner said "yes" to cut it once M40 had merged.

- **M40a** (pull request #23) built the machinery: the English table,
  `MODEL_TEXT`, templates and plural forms, `Intl` formatting, the table in
  each webview's HTML, `package.nls.json`, and the localization gate. It
  also carried the semgrep launcher and the fix for the flaky tree-kill test.
- **M40b** (#25) added the fourteen translations.
- **Found and fixed along the way:** three accessibility problems that only
  longer text exposed, the Agent map's raw status, and the "1000K" edge.

The release went through pull request #26 from `release/0.8.0`, its gate
recorded with `npm run quality` exiting 0. Tagged `v0.8.0` (3b6271b); run
36150261035 went green on every job (14:51 to 15:01 UTC on 2026-09-25), the
GitHub Release carries `muse-spark-code-0.8.0.vsix` (905,941 bytes) and the
workflow published it ("Published RandyNorthrup.muse-spark-code v0.8.0." at
15:01:22 UTC); the Marketplace listed 0.8.0 at 15:08:10 UTC (`vsce show`).

**0.9.0 (published 2026-09-27):** the paid features (D30, D34) and
parity with what Muse Code and the Model API offer (D36):

- web search, image generation and Muse Voice, opt in and loud (M33–M35,
  PR #27);
- replay as Meta validates it (D35, M42, #28);
- a row for every tool Muse Code runs (M43, #29);
- images on both backends and image edits (D37, M44, #30);
- goals (D38, M45, #31);
- background work, the `!` shell and clarifying questions (D39, M46, #33);
- workflows, read only (D40, M47, #34);
- Model API subagents (D45, M48, #35);
- memory (D41, M49, #36);
- MCP servers on the Model API backend (D42, M50, #37);
- hooks (M51, #39);
- scheduled prompts (M52, #40);
- rewind and side chat, with the usage-timing fix (D46, M53, #41);
- PDFs and files as input (D47, M54, #42);
- install and sign in from the panel, with the review fix to the sign-in
  reducer (M55, #43, merged);
- enterprise network and posture (D43, M56, #44, merged);
- CI on pull requests and on demand, no longer on every push to main (#38,
  #40).

Before the tag:

- M56 (#44) merged, with hosted CI green (done: `890e37b`);
- on `release/0.9.0` (`1d1b281`, `docs/certification/release-0.9.0.md`),
  the Model API key-format fix: Meta's current keys (`LLM_` and letters,
  digits and underscores, no `|`) are accepted and redacted, as are the
  older `LLM|<id>|<secret>` keys;
- on `release/0.9.0` (`1d1b281`), the hook trust gate: on the Model API
  backend no hook, managed, user or project, loads or runs while the
  workspace is untrusted;
- the version at 0.9.0 in `package.json` and `package-lock.json` (done on
  `release/0.9.0`);
- `CHANGELOG.md`'s `[Unreleased]` promoted to `[0.9.0]` (done on
  `release/0.9.0`);
- the README "What's new", the walkthrough images and the README screenshots
  re-rendered (done on `release/0.9.0`);
- `npm run quality` exit 0 on the release tree (done: `6a60a5d`, tree
  `fe862fc8`; 2,515 tests passed, 23 skipped; 332 accessibility pages;
  `dist/extension.js` 596.8 KiB);
- the release pull request from `release/0.9.0`, then tag `v0.9.0`.

Released: PR #45 merged as `2f4f669`; tag `v0.9.0`; release run
36356158602 passed every job (tag checks, the seven build jobs, GitHub
Release, Marketplace publish); the GitHub Release carries
`muse-spark-code-0.9.0.vsix` (1,162,374 bytes).

Checked live on 2026-09-27: every Model API feature, Muse Voice, paid web
search, images and edits, PDFs and subagents included, in 18 cases of the
live sweep on the owner's key (34 runs, about $0.095, contributor tier); and
one Muse Code turn on CLI 1.4.0 (26 attempts). Not checked live: the
installer and device sign-in, an authenticated enterprise proxy.

**0.9.1 (2026-09-27): Muse Code 1.4.0 on Windows.** A re-test of Meta's
new stable release (`1.4.0-R4302.1`, which the launcher installs by itself;
4 billed turns, 28 attempts) found 0.9.0's two Windows limits keyed to
"1.3.0 or older": on 1.4.0 the panel offered Rename, conversation rewind and
Side chat again, which fail (#30, #31), and dropped the profile-workspace
sandbox warning, which still applies (#26). Both now hold for every version
(D26 amendment). Known 1.4.0 schema fingerprints are logged at info instead
of as a mismatch warning. The full gate passed on `9c2cdce` (2,507 tests,
332 accessibility pages, no leaks, no Semgrep findings).
`docs/certification/release-0.9.1.md`. Published 2026-09-27: PR #46 merged as `645c2ae`, tag
`v0.9.1`; release run 36358973778 passed every job (tag checks, the seven
build jobs, GitHub Release, Marketplace publish), and the GitHub Release
carries `muse-spark-code-0.9.1.vsix` (1,162,362 bytes).

**0.10.0 preparation (2026-09-30, owner authorized).** Release is the
current priority. Finish and independently review M72's shared Stop/lifetime
fixes on current main, then publish 0.10.0. Prepare the manifest, lockfile,
changelog and release documentation in the same PR55 candidate before its
four-platform full gates, so the release tag can name the tested main tree.
PR63's evaluation work and the other unfinished branches follow this release;
they are not release prerequisites. The release includes the already merged
multi-IDE work with its documented Preview limits, code intelligence, web
fetch, verify loop and plan files, together with the verified M72 changes and
its 2026-09-30 correction batch (memory copies and leases, the `!` command's
final admission, git's path limits; `docs/certification/m72.md`).
No new paid calls are part of release verification. Do not tag or claim
publication until the candidate passes independent review, exact-tree local
platform checks and hosted checks and lands through its protected PR.
After tagging, verify actual GitHub VSIX and ACP downloads, Marketplace,
Open VSX and npm `muse-spark-code-acp`: published version, downloaded payload
and integrity, isolated installation and activation, with recorded Windows
host, Windows VM, Mac mini and Kubuntu smoke results. A skipped publish or
successful workflow alone does not close any distribution channel.

The first full gate on `05db3711` exposed a missing manual-entry registration:
plain knip reported `src/host/checkpoints/checkpointStoreEntry.ts` as unused.
Register that actual built entry alongside the existing Model API and plan
entries in knip and in dpdm's cycle command. These are graph entrypoints,
not ignores; existing rules and thresholds remain in force. The compiled
factory's native capture and no-git controls already passed before this run.

The owner's complete failure scan also covers CI package assertions: require
both the plan-reader and checkpoint-store bundles in the VSIX, and the Model
API/page-worker bundles plus the two Windows shell job sources in ACP. These
already ship; missing-member controls must prove the package checks reject
their omission. Keep Plans as files in the 0.10.0 README summary, rather than
the earlier 0.9.0 summary. Collect every remaining gate/runtime result before
the next combined correction candidate and full platform run.

The Mac's full coverage run timed out five CPU-heavy cases at the unchanged
five-second deadline. Each exact case and all 109 assertions in the three
owning suites passed with V8 coverage under that deadline when isolated.
Bound macOS file-worker concurrency to four in the existing Vitest config;
keep every file, assertion, isolation setting, coverage threshold and timeout.
The final full run must prove the complete suite with this resource bound.
No unrelated machine process is stopped to make a gate pass.

**Third Codex review of PR #55 (2026-10-01, owner: "fix all 7, then
release").** Seven P2 threads on `669e8301`, all real, each fixed with a test
that fails without it and a recorded drill (`docs/certification/m72.md`,
"Codex review of `669e8301`"). One record format change: a checkpoint record
gains optional `sequence` and `endSequence`, a per-conversation count that
orders turns instead of the clock. Records a 0.10.0 candidate wrote have
neither and are ordered first, by their clock; older builds ignore the
fields. Known limits kept and recorded there: ignored-file steps compare
size and time only (a chmod alone goes unseen), a repository deep in an
ignored folder past the folder scan limit is not found, two windows on one
conversation can take the same count, and the shadow `info/exclude` is
shared by the folder's windows (the next capture corrects a stale copy).

**Fourth Codex review of PR #55 (2026-10-01).** Four threads on `a5a4b1ac`
(one P1, one security P2, two P2), all real, all fixed with tests and drills
(`docs/certification/m72.md`, "Codex review of `a5a4b1ac`"). A checkpoint
record gains one more optional field, `userSaves`: the files the user saved
in the turn's window while it ran, which a restore refuses. Release rule set
by the lead after this round: a later Codex finding that is neither a P1 nor
a security finding is recorded as a known limit and fixed in 0.10.1, so the
release does not wait on review rounds that only find edge cases.

**0.10.0 released (2026-10-02, tag `v0.10.0` on main `bdfb651e`, release run 36947244221).**
PR #55 merged after seven Codex rounds; turn checkpoints ship as a Preview, off by
default (D63). The first run's Windows quality job hit a known intermittent
60 s hang in a real-shell hook test (root cause under investigation for 0.10.1)
and was rerun. Published: the GitHub Release (`muse-spark-code-0.10.0.vsix`,
1,619,488 bytes, SHA-256 `666f89b3ca93519a5272c21cb6a9ff1971202db7d452af96eff4a103d5e64a5b`;
`muse-spark-code-acp-0.10.0.tgz`, 805,211 bytes, `96c56cfa…f946`), the VS Code
Marketplace and Open VSX (its first publish; namespace `RandyNorthrup`
created, not yet verified), both serving the identical VSIX. npm failed: the
workflow passed `release/…tgz`, which npm read as a GitHub owner/repo (fixed
by PR #66; the owner chose to let `muse-spark-code-acp` reach npm first with
0.10.1). Install smoke: the released VSIX installs as 0.10.0 on the Windows
host, the Windows 11 VM, the Mac mini and Kubuntu (throwaway profiles); no
machine has code-server for a panel check, which CI's Hosts run on the tag
covered (run 36947211712).

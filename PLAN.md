# PLAN — Muse Spark for VS Code (unofficial)

A VS Code extension that lets a developer sign in and use Meta's **Muse Spark**
model as a coding agent inside the IDE, with a chat experience at feature parity
with the official Claude Code VS Code extension (webview chat panel, slash
command palette, model/effort pill, permission modes, streaming markdown, diff
review, session history, rewind).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` deferred.

---

## 1. Assumptions

| #   | Assumption                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                            | Reversal cost                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| A1  | Stack: TypeScript, Node ≥ 22, npm 11, esbuild bundling, React 19 webview.                                                                        | The VS Code extension API is TypeScript-first; esbuild is Microsoft's documented bundler; React is the de-facto webview framework and what the Claude Code extension appears to use.                                                                                                                                           | Medium (webview components are React-specific). |
| A2  | Package manager is npm with `package-lock.json`, exact version pins (`save-exact=true`).                                                         | npm 11.19 is installed; pnpm is not. Exact pins make "latest" impossible by accident.                                                                                                                                                                                                                                          | Trivial.                                        |
| A3  | Extension is **unofficial** and must say so in its name, README and marketplace listing.                                                         | Meta Model API ToS / AUP forbid implying Meta endorsement; "Muse Code" and "Muse Spark" are Meta trademarks.                                                                                                                                                                                                                   | None.                                           |
| A4  | Publisher id `RandyNorthrup` (confirmed 2026-09-22 on marketplace.visualstudio.com/manage: existing publisher, one extension already published). | The marketplace shows the publisher as RandyNorthrup; the URL form is lower-case.                                                                                                                                                                                                                                              | None.                                           |
| A5  | License: MIT.                                                                                                                                    | Standard for VS Code extensions; matches `@muse-code/sdk`.                                                                                                                                                                                                                                                                     | Trivial before first release.                   |
| A6  | Settings/command namespace `museSpark.*`, view container id `museSpark`.                                                                         | Mirrors `claudeCode.*` structure users already know.                                                                                                                                                                                                                                                                           | Low (rename before first release).              |
| A7  | CI provider: GitHub Actions.                                                                                                                     | `gh` CLI is installed; repo will live on GitHub.                                                                                                                                                                                                                                                                               | Low.                                            |
| A8  | Target VS Code `^1.134.0` (September 2026 stable is 1.138.0).                                                                                    | Needs only long-stable APIs (WebviewView, SecretStorage, `vscode.diff`, `env.openExternal`, `window.createTerminal`). `@types/vscode` publishes only some minors; 1.134.0 (2026-08-19) is the oldest recent one on the registry, giving four releases of slack.                                                                | Trivial.                                        |
| A9  | Pre-commit hooks via **husky + lint-staged**, not the Python `pre-commit` tool.                                                                  | `pre-commit` is not installed; a Node project should not require a Python toolchain to commit. gitleaks is invoked directly from the husky hook.                                                                                                                                                                               | Low.                                            |
| A10 | **Fully cross-platform (owner requirement 2026-09-22):** Windows, macOS and Linux are all first-class. Windows is the primary dev machine.       | CI matrix runs the full gate set on ubuntu, windows and macos; every OS-specific path (binary discovery, process spawning, paths, line endings) has a unit test per platform branch. Meta documents the `muse` CLI for macOS and Windows; Linux users fall back to the Model API backend if the CLI is unavailable there (Q6). | None.                                           |

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

### D1a — Locating and spawning `muse` per platform (verified 2026-09-22, Muse Code 1.3.0)

| OS                    | Install dir (installer default)                                             | Entry                                                                                            | Beside it                                                                                       | Credential                                                                                   |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Windows               | `%LOCALAPPDATA%\Programs\muse` (added to the user PATH)                     | `muse.cmd` → `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .muse-launcher.ps1 <args>` | `muse-bin-<version>.exe` (~415 MB), `.muse-version`, `.muse-release-info.json`, `.muse-channel` | `%USERPROFILE%\.config\muse\auth.json`                                                       |
| Linux (Kubuntu 26.04) | `~/.local/bin` (`MUSE_INSTALL_DIR` overrides; PATH added to shell rc files) | `muse` bash launcher (33 KB; needs bash, not sh)                                                 | `muse-bin-<version>` (~314 MB), `.muse-version`, `.muse-release-info.json`                      | `$XDG_CONFIG_HOME/muse/auth.json` or `~/.config/muse/auth.json` (`MUSE_AUTH_PATH` overrides) |
| macOS 15.7 (Mac mini) | `~/.local/bin` (PATH added to `~/.zshrc`)                                   | same bash launcher                                                                               | same                                                                                            | same as Linux                                                                                |

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
endpoints. A ~300-line client over global `fetch` with `eventsource-parser`
for SSE and `zod` schemas for every response boundary is smaller, keeps
`no-unsafe-*` lint rules meaningful, and lets us model Meta's documented
deviations (`tool_choice` only `"auto"`, `reasoning_effort` `none` → 400).
Revisit if Meta ships a first-party SDK.

### D3 — Quality toolchain versions (verified against the npm registry 2026-09-21)

| Package                                                                 | Pinned                            | Why this version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`                                                            | **6.0.3**                         | Registry latest is 7.0.2, but `typescript-eslint@8.70.1` declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. TS 7 installs cleanly and silently disables every type-aware lint rule. 6.0.3 is the highest release inside the supported range.                                                                                                                                                                                                                                                  |
| `eslint`                                                                | 10.11.0                           | `typescript-eslint` accepts `^10.0.0`; `eslint-plugin-unicorn@76` requires `>=10.4`.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `typescript-eslint`                                                     | 8.70.1                            | Latest; `strictTypeChecked` + `stylisticTypeChecked`.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `@eslint/js`                                                            | 10.0.1                            | Separate package from eslint; required by the flat config.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `eslint-plugin-unicorn`                                                 | 76.0.0                            | Latest; needs eslint ≥ 10.4 (satisfied).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `eslint-plugin-react-hooks`                                             | 7.1.1                             | Declares eslint `^10.0.0`. `eslint-plugin-react` (7.37.5) and `eslint-plugin-jsx-a11y` (6.10.2) only declare up to eslint `^9`, so they are **not** installed; a11y is covered by manual checks in visual certification and revisited when the plugins add eslint 10 peers.                                                                                                                                                                                                                          |
| `dpdm`                                                                  | 4.3.0                             | Circular-import gate (`--exit-code circular:1`). `madge` is incompatible with TS 6+. `eslint-plugin-import-x` was considered and dropped: its `no-cycle` rule is known not to fire, and unresolved imports are already a hard `tsc` error (TS2307) in every project here.                                                                                                                                                                                                                            |
| `knip`                                                                  | 6.37.0                            | Unused files/exports/deps. Config is `knip.jsonc` (knip 6 rejects `"//"` pseudo-comments). Run without `--strict`: strict implies production mode, which needs `!`-suffixed entries and otherwise analyses nothing.                                                                                                                                                                                                                                                                                  |
| `prettier`                                                              | 3.9.8                             | Formatter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `stylelint` + `stylelint-config-standard`                               | 17.15.0 / 40.0.0                  | Webview CSS gate (`--max-warnings=0`).                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `vitest` + `@vitest/coverage-v8`                                        | 5.0.1                             | Unit tests (node env for extension code, jsdom for webview). Peer `@types/node ^22                                                                                                                                                                                                                                                                                                                                                                                                                   |     | >=24` satisfied. |
| `jsdom`                                                                 | 30.1.0                            | Webview component tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@testing-library/react` / `dom` / `jest-dom`                           | 16.3.3 / 10.4.2 / 7.0.1           | Component assertions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `@vscode/test-cli` + `@vscode/test-electron` + `mocha` + `@types/mocha` | 0.0.15 / 3.1.0 / 12.0.2 / 10.0.10 | Integration tests inside the Extension Development Host. `@vscode/test-electron` is an unlisted peer of test-cli, so knip ignores it explicitly.                                                                                                                                                                                                                                                                                                                                                     |
| `esbuild`                                                               | 0.28.2                            | Bundles extension (cjs, node platform) and webview (esm/iife, browser platform).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `@types/vscode`                                                         | 1.134.0                           | Matches `engines.vscode` (test/unit/manifest.test.ts enforces the pairing).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@types/vscode-webview`                                                 | 1.57.5                            | Types for `acquireVsCodeApi()` inside the webview.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `@types/node`                                                           | 22.20.4                           | Extension host on VS Code 1.138 is Electron 42 (Node ≥ 22). Typing against 22 keeps code portable to older hosts.                                                                                                                                                                                                                                                                                                                                                                                    |
| `@vscode/vsce`                                                          | 4.0.0                             | Packaging. Needs Node ≥ 22.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `react` / `react-dom` / `@types/react` / `@types/react-dom`             | 19.3.0                            | Webview UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `zod`                                                                   | 4.6.5                             | Runtime validation of every webview ⇄ extension message and every HTTP/MSP boundary.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@muse-code/sdk`                                                        | 1.3.0                             | Official MSP client. Developer Preview: "minor releases may alter APIs before 1.0" → exact pin, adapter isolated in one module, schema fingerprint checked at handshake. Installed with a one-off `--min-release-age=0` on 2026-09-22 (published 2026-09-18, inside the 7-day window); the lockfile pins it so `npm ci` is unaffected. Only its `Connection`/`spawnMspConnection` surface is used; `Connection.onNotification` holds a single handler, so the facade (`MuseClient`) is not composed. |
| `eventsource-parser`                                                    | 4.1.1                             | SSE parsing for the Model API backend (M7).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `husky` / `lint-staged`                                                 | 9.1.7 / 17.5.1                    | Pre-commit gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `jscpd`                                                                 | 5.3.1                             | Copy-paste detection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm-run-all2`                                                          | 9.0.3                             | Runs gate scripts in sequence/parallel.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `rimraf`                                                                | 6.1.3                             | Cross-platform clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Deprecated and avoided: `@vscode/webview-ui-toolkit` (archived; npm marks it
deprecated). Webview controls are hand-built on VS Code CSS theme variables.

### D4 — Security posture

- API keys live only in `vscode.SecretStorage`; never in settings, logs, or
  telemetry. When the CLI backend is used with a stored key, the key is passed
  to `muse serve` as `META_API_KEY` in the child environment only.
- Webview: strict CSP with per-load nonce, `localResourceRoots` limited to the
  bundled `dist/webview`, no remote scripts, no `eval`. Every inbound message is
  parsed with a zod schema; unknown shapes are logged and dropped.
- Child processes are spawned with explicit argument arrays, never a shell
  string. The `muse` binary path is user-configurable; when configured it must
  be an absolute path that exists and is a file.
- No telemetry. No network calls except to `api.meta.ai` (M7) and whatever the
  user's own `muse` CLI performs.
- Contributor-tier models are opt-in behind a dialog quoting Meta's training
  wording; off by default; blocked when the workspace setting
  `museSpark.confidentialWorkspace` is true.
- Secret scanning (gitleaks) in pre-commit and CI; `npm audit --audit-level=high`
  in `security:audit`; semgrep in CI (deferred locally, see §7).

### D5 — Testing strategy

- **Unit (vitest, node env)**: everything in `src/core/**` (protocol types,
  backends with fake transports, message bus, settings mapping, path guards).
  The `vscode` module is aliased to `test/mocks/vscode.ts`.
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

| Artifact               | Budget (minified, uncompressed)                                                |
| ---------------------- | ------------------------------------------------------------------------------ |
| `dist/extension.js`    | ≤ 600 KB (M0–M6), ≤ 900 KB after M7                                            |
| `dist/webview/main.js` | ≤ 900 KB including React + markdown renderer; syntax highlighter loaded lazily |
| `.vsix`                | ≤ 3 MB                                                                         |

`npm run build` prints sizes; `scripts/check-bundle-size.mjs` fails the build
over budget. Budgets are recorded here and adjusted only with a CHANGELOG entry.

### D7 — Permission modes map onto MSP approval modes; prompting modes wait for M4

`muse --help` (1.3.0) names the CLI's own modes `untrusted | on-request |
never` (default `on-request`, LLM approval judge on); `muse serve` selects
the mode on the wire (`session/start.approvalMode`, `session/setApprovalMode`),
closed vocabulary `allowAll | promptUnmatched | onRequest | denyUnmatched`.
The Claude Code vocabulary is mapped in `src/shared/permissionModes.ts`:

| UI mode            | MSP mode          | Note                                                  |
| ------------------ | ----------------- | ----------------------------------------------------- |
| Manual             | `promptUnmatched` | ask for everything no rule allows (`untrusted`)       |
| Edit automatically | `promptUnmatched` | + the extension auto-answers file-edit approvals (M4) |
| Plan               | `denyUnmatched`   | read and reason only                                  |
| Auto               | `onRequest`       | the CLI default: judge-reviewed, prompt only on need  |
| Bypass permissions | `allowAll`        | confirmed with a modal warning before it is applied   |

`approval/requested` is a notification the host waits on; until M4 renders it,
any prompting mode would hang the turn, so `HAS_APPROVAL_UI = false` collapses
Manual / Edit automatically / Auto to `denyUnmatched` (M2 behaviour) and only
Plan and Bypass differ. Flipping the constant is an M4 change with its own
live verification of each mode.

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

## 3. Open questions (need the owner)

| #   | Question                                                                                                                                                                                                                                                        | Default until answered                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Q1  | **Resolved 2026-09-22:** owner authorised installing anything needed; Muse Code CLI 1.3.0 installed via the official installer. Still open: does the owner hold a Muse Code subscription and/or a Model API key? `muse login` (device code in browser) started. | CLI present; credential state pending login.                      |
| Q2  | **Resolved 2026-09-22:** publisher `RandyNorthrup` read from the signed-in marketplace management page. Display name stays "Muse Spark Code (Unofficial)" unless the owner asks otherwise.                                                                      | Closed.                                                           |
| Q3  | **Resolved 2026-09-22:** owner wants both the CLI (MSP) backend and the Model API backend in the first release. M7 is required for v0.1.0.                                                                                                                      | M7 required; see §10.                                             |
| Q4  | Voice dictation (Web Speech API in webview) — wanted for v1?                                                                                                                                                                                                    | Deferred to M8 as P2.                                             |
| Q5  | Syntax highlighter: `shiki` (accurate, ~1 MB+ grammars, lazy-loaded) vs `highlight.js` core (smaller, less accurate).                                                                                                                                           | Decide at M4 with measured bundle sizes.                          |
| Q6  | Linux support for the CLI backend: Meta's product page lists macOS + Windows only.                                                                                                                                                                              | Detect and show "use Model API key" on Linux if `muse` is absent. |
| Q7  | **Resolved 2026-09-22:** owner pressed F5 and confirmed the Muse Spark chat shell renders in the Extension Development Host (verbal confirmation; no screenshot filed).                                                                                         | Closed.                                                           |
| Q8  | **Resolved 2026-09-22:** owner signed in; publisher is `RandyNorthrup`. Remaining at packaging time (M8): `npx vsce login RandyNorthrup` with a Marketplace-manage PAT, which the owner mints.                                                                  | Closed; PAT step deferred to M8.                                  |

## 4. Architecture

```
┌────────────────────────── VS Code extension host (Node) ──────────────────────────┐
│ src/extension.ts            activate(): register views, commands, keybindings      │
│ src/host/                   VS Code-facing adapters                                │
│   views/ChatViewProvider    WebviewView (sidebar) + WebviewPanel (editor tab)      │
│   MessageBus                zod-validated postMessage bridge (HostToWebview/       │
│                             WebviewToHost unions in src/shared/protocol.ts)        │
│   auth/CredentialStore      SecretStorage wrapper (API key), never logs values     │
│   auth/SignIn               "muse login" in integrated terminal / key input        │
│   editor/                   selection + active-file context, @mention search,     │
│                             diff viewer (virtual docs), insert/apply code          │
│   settings/                 museSpark.* readers with defaults                      │
│ src/core/                   backend-agnostic, no `vscode` import                   │
│   agent/AgentBackend.ts     interface: startSession, sendTurn, cancel, setModel,   │
│                             setEffort, setApprovalMode, listModels, listSessions, │
│                             resume, fork, compact, decideApproval, answerQuestion  │
│   agent/AgentEvent.ts       union: turn.started/text.delta/reasoning.delta/        │
│                             tool.started/tool.output/tool.completed/edit.proposed/ │
│                             approval.requested/question.requested/todo.changed/    │
│                             usage.changed/context.changed/turn.completed/error     │
│   backends/musecode/        MSP adapter over @muse-code/sdk (spawn muse serve)     │
│   backends/modelapi/        (M7) fetch + SSE client, tool harness, permission      │
│                             engine that reproduces the approval-mode semantics    │
│   sessions/                 titles, history index, rewind/fork bookkeeping         │
│ src/shared/                 imported by both host and webview (types, constants)  │
└───────────────────────────────────────────────────────────────────────────────────┘
                                 │ postMessage (zod-validated both ways)
┌────────────────────────── Webview (browser, React 19) ────────────────────────────┐
│ src/webview/main.tsx        mount, theme tokens from VS Code CSS variables         │
│   components/Composer       input, "+" attach, "/" palette, @mention, chips,       │
│                             model/effort pill, permission-mode button, send/stop  │
│   components/Transcript     streaming markdown, code blocks (copy/insert/apply),  │
│                             tool rows, reasoning blocks, approval & question      │
│                             cards, todo panel, plan approval                       │
│   components/History        session list with search, rename, archive             │
│   components/Account        usage bars / token totals                              │
│   state/                    reducer over AgentEvent stream                         │
└───────────────────────────────────────────────────────────────────────────────────┘
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
- Auth `Authorization: Bearer <key>`; keys look like `LLM|<id>|<secret>`.
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
`@file#lines`), Ctrl+Alt+F (focus view), Ctrl+O (toggle thinking);
browser-based sign-in; `claudeCode.*`-style settings incl. initial permission
mode. P1: tool rows, thinking blocks, plan approval, context %, usage panel,
/compact. P2: rewind/fork, voice, /btw, agent map, session groups.

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

- [ ] `npm run quality` exits 0 on a clean checkout (format:check, lint,
      typecheck, deadcode, cycles, duplication, test with coverage thresholds,
      build with bundle budget, security:audit, secrets).
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
(`session/setReasoningEffort`, Ctrl+O), the permission-mode button and
Shift+Tab cycle mapped per D7, Enter while a turn runs → `turn/steer` with a
fresh-turn fallback, `/clear` and `/compact`. Live checks recorded in the
certification file.

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

- **Scope**: streaming markdown (react-markdown + remark-gfm, sanitised),
  syntax highlighting (Q5), code block Copy / Insert into file / Apply; tool
  rows (collapsible, `item/readOutput` paging); reasoning blocks with Ctrl+O;
  approval cards from `approval/request` (choices rendered from
  `availableChoices` with scope labels, optional feedback); question cards from
  `userInput/request`; pinned todo list; context % and token usage footer;
  turn errors and retry notices; Focus view.
- **Acceptance**: 10k-token response renders without jank (< 16 ms frames in
  the webview profiler); approvals resolve; questions answer.
- **Tests**: reducer folds for each `AgentEvent`; markdown sanitisation blocks
  script/HTML injection; approval decision payloads.
- **Security**: markdown rendered with `skipHtml`; links open via
  `env.openExternal` after confirmation for non-https schemes.

### M5 — Editor integration

- **Scope**: selection / active-file chips (`attachOpenFile`), Alt+K mention
  insertion, autosave before turns, edit diffs: read `patchRef` content and
  open `vscode.diff` on virtual documents, Accept / Reject wired to the
  approval flow, "Proposed changes" tab; insert/apply code into the active
  editor; diagnostics exposure via `sessionMcp` capability (local MCP server
  offering `getDiagnostics`) if the CLI honours it, otherwise as a
  user-invoked "Attach diagnostics" action.
- **Tests**: diff document provider; apply-at-cursor; selection formatter.

### M6 — Sessions, history, rewind

- **Scope**: history dialog (`session/list`, search, time groups), resume
  (`session/resume` with history mode inline/snapshot), titles
  (`session/nameChanged`, rename), new/clear, archive after N days (setting),
  rewind/fork on message hover (`session/fork`), `/compact`
  (`session/compact`), multiple editor tabs = independent sessions, unread dot.
- **Tests**: history index; fork cut-point mapping; archive policy.

### M7 — Model API backend (bring-your-own key)

- **Scope**: `ModelApiBackend` on `POST /v1/responses` streaming; tool harness
  (read, write, edit, glob, grep, shell) with a permission engine implementing
  the same five UI modes; diffs through the M5 path; `GET /v1/models` key
  validation; contributor opt-in dialog; backoff on 429; usage from response
  `usage`; token pre-count via `/responses/input_tokens`.
- **Tests**: SSE parser on recorded streams; tool argument validation; permission
  engine truth table; contract tests against a local fake server.
- **Security**: shell tool disabled in Manual mode until approved per call;
  workspace-root path confinement for file tools.

### M8 — Account & usage, polish, packaging

- **Scope**: Account & usage dialog (`usage/read` subscription bars or token
  totals), `/usage`, `/cost`; onboarding checklist; voice dictation (Q4);
  screen-reader announcements; `vsce package`, marketplace README, privacy
  policy (`docs/PRIVACY.md`), icon; CHANGELOG 0.1.0.

## 7. Gates

| Gate                  | Command                                                                                    | Status                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Format                | `prettier --check .`                                                                       | M0 ✓                                                                                                                    |
| Lint (type-aware)     | `eslint . --max-warnings=0`                                                                | M0 ✓                                                                                                                    |
| CSS lint              | `stylelint "src/**/*.css" --max-warnings=0`                                                | M0 ✓                                                                                                                    |
| Types                 | `tsc -p tsconfig.json --noEmit` (+ webview project)                                        | M0 ✓                                                                                                                    |
| Dead code             | `knip` (not `--strict`; see knip.jsonc)                                                    | M0 ✓                                                                                                                    |
| Cycles                | `dpdm --no-warning --no-tree --exit-code circular:1 src/extension.ts src/webview/main.tsx` | M0 ✓                                                                                                                    |
| Duplication           | `jscpd --threshold 1 src` (config `.jscpd.json`)                                           | M0 ✓                                                                                                                    |
| Unit tests + coverage | `vitest run --coverage`                                                                    | M0 ✓                                                                                                                    |
| Integration tests     | `vscode-test`                                                                              | M0 ✓ (3 passing locally; CI: ubuntu xvfb + windows)                                                                     |
| Build + bundle budget | `node scripts/build.mjs --production && node scripts/check-bundle-size.mjs`                | M0 ✓                                                                                                                    |
| Dependency audit      | `npm audit --audit-level=high`                                                             | M0 ✓                                                                                                                    |
| Secrets               | `gitleaks git --redact` (history) and `gitleaks protect --staged` (hook)                   | M0 ✓ (staged-scan proof; history scan after first commit)                                                               |
| SAST                  | `semgrep scan --config auto --error` (`npm run security:sast`)                             | M2 ✓ locally (pip-installed on Windows 2026-09-22, its Scripts folder added to the user PATH) and in the CI `sast` job. |
| Lighthouse            | n/a (webview, not a web page); replaced by webview profiler check in M4                    | —                                                                                                                       |

## 8. Escape hatches register

Every suppression, cast, or ignored error must be listed here with its reason.

| File   | Construct | Reason | Added |
| ------ | --------- | ------ | ----- |
| (none) |           |        |       |

## 9. Security assumptions and accepted residual risk

- The `muse` CLI is closed source; we trust its stdio protocol as documented
  by Meta's SDK and validate every message shape at our boundary. Residual
  risk: a compromised or malicious CLI binary on the user's PATH; mitigated
  by honouring an explicit `museBinaryPath` and logging the resolved path.
- Muse Spark's tool execution semantics (which commands it runs, how approvals
  are enforced) are the CLI's responsibility in the MSP backend. Our UI never
  auto-approves outside the mode the user selected.
- The Model API backend (M7) executes tools in-process. Path confinement to
  the workspace root and per-call approval in Manual mode are the controls;
  "Bypass permissions" is opt-in via a setting exactly as in Claude Code.
- Contributor-tier models send content Meta may train on; guarded by opt-in
  dialog and `confidentialWorkspace` setting.

## 10. Definition of done (v0.1.0)

M0–M8 certified (owner decision 2026-09-22: both backends ship in v0.1.0);
all gates in §7 passing in CI on ubuntu and windows; `vsce package` produces a
`.vsix` under budget that installs and signs in on a clean VS Code 1.130+;
README, CHANGELOG, PRIVACY current; no rows in §8 without a reason.

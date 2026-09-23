# PLAN — Muse Spark for VS Code (unofficial)

A VS Code extension that lets a developer sign in and use Meta's **Muse Spark**
model as a coding agent inside the IDE, with a chat experience at feature parity
with the official Claude Code VS Code extension (webview chat panel, slash
command palette, model/effort pill, permission modes, streaming markdown, diff
review, session history, rewind).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` deferred.

---

## 1. Assumptions

| #   | Assumption                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                           | Reversal cost                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A1  | Stack: TypeScript, Node ≥ 22, npm 11, esbuild bundling, React 19 webview.                                                                        | The VS Code extension API is TypeScript-first; esbuild is Microsoft's documented bundler; React is the de-facto webview framework and what the Claude Code extension appears to use.                                                                                                                                                                                                          | Medium (webview components are React-specific). |
| A2  | Package manager is npm with `package-lock.json`, exact version pins (`save-exact=true`).                                                         | npm 11.19 is installed; pnpm is not. Exact pins make "latest" impossible by accident.                                                                                                                                                                                                                                                                                                         | Trivial.                                        |
| A3  | Extension is **unofficial** and must say so in its name, README and marketplace listing.                                                         | Meta Model API ToS / AUP forbid implying Meta endorsement; "Muse Code" and "Muse Spark" are Meta trademarks.                                                                                                                                                                                                                                                                                  | None.                                           |
| A4  | Publisher id `RandyNorthrup` (confirmed 2026-09-22 on marketplace.visualstudio.com/manage: existing publisher, one extension already published). | The marketplace shows the publisher as RandyNorthrup; the URL form is lower-case.                                                                                                                                                                                                                                                                                                             | None.                                           |
| A5  | License: MIT.                                                                                                                                    | Standard for VS Code extensions; matches `@muse-code/sdk`.                                                                                                                                                                                                                                                                                                                                    | Trivial before first release.                   |
| A6  | Settings/command namespace `museSpark.*`, view container id `museSpark`.                                                                         | Mirrors `claudeCode.*` structure users already know.                                                                                                                                                                                                                                                                                                                                          | Low (rename before first release).              |
| A7  | CI provider: GitHub Actions.                                                                                                                     | `gh` CLI is installed; repo will live on GitHub.                                                                                                                                                                                                                                                                                                                                              | Low.                                            |
| A8  | Target VS Code `^1.125.0` (September 2026 stable is 1.138.0; was `^1.134.0` until 0.1.1).                                                        | Needs only long-stable APIs (WebviewView, SecretStorage, `vscode.diff`, `env.openExternal`, `window.createTerminal`). `@types/vscode` publishes only some minors; 1.134.0 was taken at first as the oldest recent one on the registry; on 2026-09-22 a clean VS Code 1.130.0 (the owner's Win11 VM) refused 0.1.0, and 1.125.0 typechecks the whole tree, so the floor is 1.125.0 from 0.1.1. | Trivial.                                        |
| A9  | Pre-commit hooks via **husky + lint-staged**, not the Python `pre-commit` tool.                                                                  | `pre-commit` is not installed; a Node project should not require a Python toolchain to commit. gitleaks is invoked directly from the husky hook.                                                                                                                                                                                                                                              | Low.                                            |
| A10 | **Fully cross-platform (owner requirement 2026-09-22):** Windows, macOS and Linux are all first-class. Windows is the primary dev machine.       | CI matrix runs the full gate set on ubuntu, windows and macos; every OS-specific path (binary discovery, process spawning, paths, line endings) has a unit test per platform branch. Meta documents the `muse` CLI for macOS and Windows; Linux users fall back to the Model API backend if the CLI is unavailable there (Q6).                                                                | None.                                           |

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
endpoints. A ~300-line client over global `fetch` with `zod` schemas for
every response boundary is smaller, keeps `no-unsafe-*` lint rules
meaningful, and lets us model Meta's documented deviations (`tool_choice`
only `"auto"`, `reasoning_effort` `none` → 400). Revisit if Meta ships a
first-party SDK. **Amended at M7:** the stream is plain WHATWG server-sent
events (`event:` / `data:` lines), so the planned `eventsource-parser`
dependency was not added; `src/core/backends/modelapi/sse.ts` (80 lines) is
tested on chunk splits inside frames and inside multi-byte characters.

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
| `@types/vscode`                                                         | 1.125.0                           | Matches `engines.vscode` (test/unit/manifest.test.ts enforces the pairing).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@types/vscode-webview`                                                 | 1.57.5                            | Types for `acquireVsCodeApi()` inside the webview.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `@types/node`                                                           | 22.20.4                           | Extension host on VS Code 1.138 is Electron 42 (Node ≥ 22). Typing against 22 keeps code portable to older hosts.                                                                                                                                                                                                                                                                                                                                                                                    |
| `@vscode/vsce`                                                          | 4.0.0                             | Packaging. Needs Node ≥ 22.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `react` / `react-dom` / `@types/react` / `@types/react-dom`             | 19.3.0                            | Webview UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `zod`                                                                   | 4.6.5                             | Runtime validation of every webview ⇄ extension message and every HTTP/MSP boundary.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@muse-code/sdk`                                                        | 1.3.0                             | Official MSP client. Developer Preview: "minor releases may alter APIs before 1.0" → exact pin, adapter isolated in one module, schema fingerprint checked at handshake. Installed with a one-off `--min-release-age=0` on 2026-09-22 (published 2026-09-18, inside the 7-day window); the lockfile pins it so `npm ci` is unaffected. Only its `Connection`/`spawnMspConnection` surface is used; `Connection.onNotification` holds a single handler, so the facade (`MuseClient`) is not composed. |
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

## 3. Open questions (need the owner)

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Default until answered                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Q1  | **Resolved 2026-09-22:** owner authorised installing anything needed; Muse Code CLI 1.3.0 installed via the official installer. The owner holds both a Muse Code subscription (CLI signed in by device code) and a pay-as-you-go Model API key; M7 keeps them apart (D1 amendment).                                                                                                                                                                                                                                                                                                                 | Closed.                                                           |
| Q2  | **Resolved 2026-09-22:** publisher `RandyNorthrup` read from the signed-in marketplace management page. Display name stays "Muse Spark Code (Unofficial)" unless the owner asks otherwise.                                                                                                                                                                                                                                                                                                                                                                                                          | Closed.                                                           |
| Q3  | **Resolved 2026-09-22:** owner wants both the CLI (MSP) backend and the Model API backend in the first release. M7 is required for v0.1.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | M7 required; see §10.                                             |
| Q4  | **Resolved 2026-09-22 (M9, superseding the M8 answer):** voice dictation ships through the operating system's own recogniser, at no API cost and with no third-party code (owner's constraints): Windows PowerShell 5.1 + `System.Speech` on Windows, a Swift helper on Apple's Speech framework on macOS (owner chose this over an `osascript` bridge), and a dimmed button with the reason on Linux (no distribution ships a recogniser; the owner may revisit). The M8 finding stands for the webview itself: Electron's Web Speech recogniser is dead, so recognition runs in a helper process. | Closed; see M9.                                                   |
| Q5  | Syntax highlighter: `shiki` (accurate, ~1 MB+ grammars, lazy-loaded) vs `highlight.js` core (smaller, less accurate).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Decide at M4 with measured bundle sizes.                          |
| Q6  | Linux support for the CLI backend: Meta's product page lists macOS + Windows only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Detect and show "use Model API key" on Linux if `muse` is absent. |
| Q7  | **Resolved 2026-09-22:** owner pressed F5 and confirmed the Muse Spark chat shell renders in the Extension Development Host (verbal confirmation; no screenshot filed).                                                                                                                                                                                                                                                                                                                                                                                                                             | Closed.                                                           |
| Q8  | **Resolved 2026-09-22:** owner signed in; publisher is `RandyNorthrup`. Remaining at packaging time (M8): `npx vsce login RandyNorthrup` with a Marketplace-manage PAT, which the owner mints.                                                                                                                                                                                                                                                                                                                                                                                                      | Closed; PAT step deferred to M8.                                  |

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
`@file#lines`), Ctrl+Alt+F (focus view), Alt+T (toggle extended thinking, bound here as
Ctrl+Alt+T on Windows and Ctrl+Alt+O on Linux because Alt+T is a Windows
menu mnemonic;
Ctrl+O is the CLI's transcript toggle, not a VS Code binding);
browser-based sign-in; `claudeCode.*`-style settings incl. initial permission
mode. P1: tool rows, thinking blocks, plan approval, context %, usage panel,
/compact. P2: rewind/fork, voice, /btw, agent map, session groups.

Second docs pass (2026-09-21, every page under code.claude.com/docs that
touches the VS Code composer, plus the owner's screenshots in
`docs/reference/`): the composer bar is `+` (menu: Upload from computer / Add
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
- `session/fork` fails on Windows 1.3.0 too, with or without a `cutPoint`
  and on a session this connection never loaded: "invalid fork boundary for
  session …: WriteFailed" (`scratchpad/probe-fork.ts`). "Fork from here"
  therefore ships behind the same honest path: the action is offered, the
  CLI's refusal is shown as a notice, and the live check is deferred to
  Linux/macOS.
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
    from `media/marketplace-icon.svg`, a spark on a dark tile rather than
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
  - Model API sessions still live for the window only (the "JSON session
    store" from the M7 polish note is deferred past 0.1.0: the owner runs
    the CLI backend, and the notice in the panel says so).
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
  speaks into the dev host and the words land in the composer (pending: no
  microphone on the PC at the moment); the macOS helper compiles in CI
  and, on a Mac, prompts for the microphone and speech recognition once
  and then transcribes (done on the Mac mini up to `listening` and a clean
  `stopped`; text from real speech pending an input device).
- **Gates added**: `lint:ps` (PSScriptAnalyzer, `PSGallery` settings,
  exit = finding count; real on Windows, a reported skip elsewhere;
  installed on the CI Windows runner in a step).
- **Security**: the helper command line is fixed (§8 row); the script runs
  with `-ExecutionPolicy Bypass` scoped to its own process, as the VS Code
  PowerShell extension does; nothing about the audio or the text leaves
  the machine on Windows; on macOS Apple may process audio on its servers
  when on-device recognition is unavailable (`docs/PRIVACY.md`); the
  helper never sees the workspace, a credential or the model.

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
| PowerShell lint       | `node scripts/lint-ps.mjs` (PSScriptAnalyzer over `native/windows`, `npm run lint:ps`)     | M9 ✓ on Windows (exit = finding count; a reported skip on other platforms; installed on the CI Windows runner).         |
| Lighthouse            | n/a (webview, not a web page); replaced by webview profiler check in M4                    | —                                                                                                                       |

## 8. Escape hatches register

Every suppression, cast, or ignored error must be listed here with its reason.

| File                                 | Construct                                                          | Reason                                                                                                                                                                                                                                            | Added      |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `src/host/backend/toolIo.ts`         | `nosemgrep` on `spawn` (`detect-child-process`)                    | The command line is the tool's payload by design: the user approved it on a card, and it runs through PowerShell / bash as an argument array, never a shell string.                                                                               | 2026-09-22 |
| `src/host/backend/searchWorker.ts`   | `nosemgrep` on `new RegExp(pattern)` (`detect-non-literal-regexp`) | The model's search pattern is evaluated on a worker thread that `toolIo.searchOnWorker` terminates at `SEARCH_TIMEOUT_MS`, and the pattern is capped at `SEARCH_PATTERN_MAX_LENGTH`; a runaway match cannot hang the host.                        | 2026-09-22 |
| `src/core/backends/modelapi/glob.ts` | `nosemgrep` on `new RegExp(source)` (`detect-non-literal-regexp`)  | The expression is assembled from bounded pieces (`[^/]*`, `(?:.*/)?`, escaped literals) out of a glob capped at `GLOB_MAX_LENGTH`, and only ever tested against short relative paths.                                                             | 2026-09-22 |
| `src/host/voice/dictationHost.ts`    | `nosemgrep` on `spawn` (`detect-child-process`)                    | The dictation helper's command line is fixed by `helperLocation.ts` (Windows PowerShell under `%SystemRoot%` with the bundled script, or the bundled macOS binary) and passed as an argument array; no user, model or workspace input reaches it. | 2026-09-22 |

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
- The pasted Model API key is used only by the Model API backend and is
  never handed to the Muse Code CLI (D1 amendment): subscription work is
  never billed to the key, and the key never reaches another process.
- Contributor-tier models send content Meta may train on; guarded by opt-in
  dialog and `confidentialWorkspace` setting.

## 10. Definition of done (v0.1.0)

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

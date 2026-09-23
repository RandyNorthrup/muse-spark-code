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
  telemetry. (The rest of this row is superseded by the D1 amendment, §9:
  since M7 the stored key is never passed to `muse serve` or any other child
  process; the CLI signs in on its own and the extension only checks that its
  credential file exists.)
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

| Artifact               | Budget (minified, uncompressed)                                                |
| ---------------------- | ------------------------------------------------------------------------------ |
| `dist/extension.js`    | ≤ 600 KiB (the M7 Model API client fit without raising it)                     |
| `dist/searchWorker.js` | ≤ 50 KiB                                                                       |
| `dist/webview/main.js` | ≤ 900 KiB including React, the markdown renderer and highlight.js (one bundle) |
| `.vsix`                | not gated; 0.5.3 is 552 KB (the GitHub Release asset)                          |

`npm run build` prints sizes; `scripts/check-bundle-size.mjs` holds the numbers
and fails the build over budget. This table mirrors the script and changes with
it, with a CHANGELOG entry.

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

| Report                                                                   | Finding                                                                                                                                                                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A shell timeout or Stop hangs the turn                                   | `child.kill` ended bash or PowerShell only; the result waited for the pipes to close, so a background grandchild (`server &`) held the tool call open for its whole life; Stop never reached the command (Claude Code #90672 is the same bug). | `runCommand`: POSIX commands lead their own process group and the group is killed; Windows uses `taskkill /T /F` (`processTree.ts`), never on a process that has exited. The result settles on exit plus a 250 ms drain; the turn's abort signal reaches the command; the result says "stopped by the user". Output is kept head and tail per stream (`BoundedText`, a `StringDecoder` per stream).                                                                                                                                                                                                                                                                   |
| A deliberate restart is treated as a crash                               | Trust granted, a sandbox or backend change, a sign-in: the extension disposed every controller and the host's exit listeners called `markBackendError`, so every panel refused to send; one exit listener was added per message.               | `MuseCodeHost.close()` marks its exit expected; `HostExit { description, isExpected, isPersistent }` goes to the listeners (one per host, a `WeakSet`). Before a restart each controller cancels its running turn, ends it in the webview and remembers its session; the next message resumes it (`resumeAfterRestart`), on the same backend kind only; a sign-out ends the conversations. A crash ends the running turn the same way and says the next message continues; only a persistent exit (configuration, usage, SDK surface) shows the sign-in gate's error. `museBinaryPath`, `environmentVariables` and VS Code's proxy settings now restart the host too. |
| No handshake or command timeout                                          | The SDK waits for ever (its INV-006).                                                                                                                                                                                                          | `withDeadline`: 30 s for the handshake (the process is closed when it misses it), 60 s per command, 180 s for resume, fork, read and compact. The fake CLI's `silent` mode proves the handshake case end to end.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A replaced host's late exit orphans the new one                          | The exit handler cleared `hostPromise` whatever it held; a wrapper that failed to build left `muse serve` running.                                                                                                                             | A generation per spawn: an attempt clears only its own slot; a wrapper failure closes the process.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Mid-turn death, restart or sign-out leaves the UI running                | No terminal event reached the webview; the next message started a new session with no context; Clear and Resume left the CLI's turn running.                                                                                                   | A synthetic `turnCompleted` (cancelled or failed, with the reason) ends the turn; the session is resumed; dropping a session cancels its running turn first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| An exception in the notification handler                                 | The SDK's single handler threw on a bad payload and the connection went deaf; a bad stored archive list threw on every read.                                                                                                                   | The handler catches and logs; a connection that closes while the process lives closes the host so the exit is reported; the archive list is `safeParse`d.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Races                                                                    | Two quick sends created two sessions; a panel closed during a start kept the session; two panels on one session shared a handle and closing one deafened (Model API: cancelled) the other.                                                     | A shared start (`openSessionOnce`); `isDisposed` checked after every await; handles are reference-counted on both backends.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The host closes the panel's own session                                  | `session/closed` was only heard by the History dialog; the next command failed `sessionNotLoaded`.                                                                                                                                             | The controller watches its own session; `sessionNotLoaded` becomes `SessionNotLoadedError`, answered by resuming and retrying the message once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The Model API host before its sessions are read                          | Published before `load()` finished; a failed load was cached.                                                                                                                                                                                  | One build shared by every caller, forgotten on failure; a build that finishes after a dispose closes itself.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sign-in accepts a stale credential file                                  | Success was "the file exists", so an expired sign-in counted at once; each click opened another terminal.                                                                                                                                      | Success is a credential file written after the login started (its modification time); a second click joins the first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Secret storage failing blocks the CLI backend                            | On Linux without a keyring `SecretStorage.get` throws; the backend selection awaited it.                                                                                                                                                       | `getApiKey` reads a failure as "no key" and logs it once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CLI resolution probes PATH on every message                              | Synchronous `existsSync` over every PATH entry per send (a dead UNC share blocks the host).                                                                                                                                                    | Resolved once per inputs (setting, PATH, flags), re-checked with one probe, invalidated by the sign-in gate and the settings that change it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The Windows launcher fallback                                            | Without `.muse-version` the CLI was started through its PowerShell launcher; Windows ends only the direct child, so closing it left `muse-bin` running.                                                                                        | The newest `muse-bin-*.exe` in the folder (version order); the launcher is never the command.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| No `deactivate`; shutdown fire-and-forget                                | Hosts were closed from a disposable nobody awaited.                                                                                                                                                                                            | `deactivate()` awaits the same stop, conversations ended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| The IDE tool server                                                      | No error listener after `listen`; a failed start was never retried; a rejected request handler was unhandled.                                                                                                                                  | A permanent error listener; a shared, retryable start; a failed request answers 500.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Model API retries                                                        | The retry sleep ignored Stop; an HTTP-date `Retry-After` was ignored; the transcript never said a request was being retried; the model list had no deadline.                                                                                   | An abortable wait; both `Retry-After` forms; `turnRetry` events as Muse Code's; 30 s deadlines on the model list and the token count.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The CLI and VS Code's proxy                                              | `muse serve` did not see `http.proxy`.                                                                                                                                                                                                         | `HTTPS_PROXY` / `HTTP_PROXY` (and `NO_PROXY` from `http.noProxy`) when the environment has none.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The login terminal off Windows                                           | `"path" login` in the user's default shell breaks under pwsh or nushell.                                                                                                                                                                       | The terminal runs `/bin/sh`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The CLI's config root drifts from the sign-in check (Claude Code #66499) | An `XDG_CONFIG_HOME` in `museSpark.environmentVariables` moved the CLI's credentials and settings, but the extension looked under the host's own environment.                                                                                  | The credential file, `settings.json` and the personal skill root are read under the CLI's environment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| The terminal environment (Cline #7793)                                   | The Model API shell ignored `terminal.integrated.env.*`.                                                                                                                                                                                       | Applied as VS Code's terminal applies it (`${env:…}`, `${workspaceFolder}`, `null` removes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `windowsHide` on every spawn                                             | Every spawn the extension makes hides its window; the SDK's own `spawnMspConnection` has no such option and spawns without it (VS Code's extension host has a hidden console, which children inherit, so no window shows).                     | Recorded; nothing the extension can pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

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
| The SDK keeps every command for ever                         | `Connection.command` memoizes each command's canonical payload (an image turn's base64 included) for replays across reconnects the extension never makes.                                                                                                                                                  | `sendCommand` over the public `connection.request`: the same `commandId` contract (echo checked) and the same retry of `overloaded` / `backpressured` refusals (3 attempts, jittered, ≤2 s), nothing remembered.                                                                                                                                                                                                                                                                                                                                                                                             |
| SSE edge cases (Model API)                                   | `data: [DONE]` or an empty keep-alive would fail JSON parsing; a CRLF split across two chunks read as two line breaks.                                                                                                                                                                                     | Both skipped; a chunk ending in `\r` holds it for the next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Output pages                                                 | Model API pages were cut at byte offsets (U+FFFD mid-character in Revert patches); the CLI's `encoding: base64` was ignored.                                                                                                                                                                               | Pages start and end on character boundaries, as the CLI serves them; a base64 page is shown when it decodes as UTF-8 and refused as binary otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The Model API session store grows for ever                   | Every session was read whole into memory at start; a crash left `.tmp` files; Windows refuses a rename while a scanner holds the file (Codex #29812, Claude Code #89075).                                                                                                                                  | The window keeps headers and reads a session whole when it is opened (after the saves queued before it). Sessions idle past `museSpark.cleanupPeriodDays` (Claude Code's `cleanupPeriodDays`, default 30, 0 keeps them) are deleted when the list is read. A `.tmp` older than a minute is removed; `EPERM` / `EACCES` / `EBUSY` renames are tried five times, the wait doubling from 25 ms.                                                                                                                                                                                                                 |
| Stop and refusals (Model API)                                | Queued messages vanished on Stop; a refusal part rendered as an empty reply.                                                                                                                                                                                                                               | Each queued message ends with the reason above; a refusal's own words are the reply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A late acceptance makes a finished turn "running"            | `send()` set the active turn from the ack, which can land after its own `turn/completed` (the D28 companion), and from a queued turn.                                                                                                                                                                      | The controller remembers finished turns; neither a finished nor a queued turn becomes the running one, and a `turnCompleted` for another turn leaves the running one alone.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### D27 — The audit: editing correctness (2026-09-23)

Section D of the audit (D24): the Model API's file tools, Edit Review and
the context the agent reads. "Rules and skills", "diagnostics", "mentions"
and "multi-root" are the context rows; the rest are the editing rows.

| Report                                                                               | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An insertion reverts as "delete the file" (Cline #9555)                              | The Model API's hunks gave every insertion `oldStart: 0`, which Revert and Rewind read as a file the edit created: adding an import line and reverting it trashed the file.                                                                                                                                                                                                                                                                    | Hunks use unified numbering (an insertion's `oldStart` is the line it follows) and carry three lines of context each side; the patch file says `created` outright. A file counts as created only when nothing is left once the edit is taken out, so lines the user added since are written back, never trashed. Muse Code's documents (no `created`) keep the whole-file-add rule under the same check.                                                                                     |
| Deleted lines put back at a line that moved                                          | A deletion-only hunk had nothing to match against.                                                                                                                                                                                                                                                                                                                                                                                             | The context lines are matched: a file that has moved on is refused with the reason, not guessed at.                                                                                                                                                                                                                                                                                                                                                                                          |
| CRLF files (Roo #8020, Codex #25048, Claude Code #88114)                             | `read_file` showed LF lines, so a multi-line `find` never matched a CRLF file; a replacement wrote LF into it; `write_file` dropped the final line break.                                                                                                                                                                                                                                                                                      | The model sees LF text without the BOM; `edit_file` matches that text and writes the file back in its own line breaks and BOM; `write_file` keeps an existing file's BOM, line breaks and final line break. A file that mixes breaks is edited as it is.                                                                                                                                                                                                                                     |
| Non-UTF-8 files (Claude Code #96263, #92328)                                         | Latin-1, Shift-JIS or UTF-16 files were decoded lossily and written back whole.                                                                                                                                                                                                                                                                                                                                                                | `readFile` is strict: invalid UTF-8 or a NUL refuses the file ("is not UTF-8 text …"), so nothing is rewritten; a UTF-8 BOM is kept.                                                                                                                                                                                                                                                                                                                                                         |
| Edits under unsaved editors; stale overwrites                                        | The tools wrote files an editor held unsaved changes to (VS Code then asks which to keep); `write_file` could replace a file the model had not seen, or one the user changed since.                                                                                                                                                                                                                                                            | The tools refuse a file with unsaved changes; `write_file` replaces an existing file only as the model last read or wrote it (Claude Code's rule, a per-session fingerprint), and the prompt says so. Before each message the panel names the unsaved files (once per set) when autosave is off, since Muse edits the saved files.                                                                                                                                                           |
| A flood of shell output hides how the command ended (Cline #13346)                   | Output over 64k was clipped from the start: the exit line and stderr went.                                                                                                                                                                                                                                                                                                                                                                     | Each stream keeps its beginning and its end (half the budget each, split on code points), and the exit line is never clipped.                                                                                                                                                                                                                                                                                                                                                                |
| Search on a large workspace                                                          | A search that ran out of time returned nothing; there was no cap on the files read.                                                                                                                                                                                                                                                                                                                                                            | The worker posts each file's hits as found: a timed-out search returns them, marked partial. At most 50,000 files are read; the output says when the glob matched more.                                                                                                                                                                                                                                                                                                                      |
| Windows PowerShell's output (Continue #12315)                                        | PowerShell 5.1 writes a redirected stdout in the OEM code page: "héllo ✓" came back "h�llo ?" (probed 2026-09-23).                                                                                                                                                                                                                                                                                                                             | A preamble makes its output, and what it pipes to native commands, UTF-8 without a BOM. The per-chunk decoding was M22's (`StringDecoder`).                                                                                                                                                                                                                                                                                                                                                  |
| Revert strips a BOM (Cline #2463, Roo #1431)                                         | Edit Review read files through a decoder that dropped the BOM and wrote them back without it.                                                                                                                                                                                                                                                                                                                                                  | The BOM is read, set aside for the match and written back.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Non-atomic writes; Edit Review without a folder                                      | A write interrupted mid-way left a half file; Edit Review with no folder resolved paths against the process's own directory.                                                                                                                                                                                                                                                                                                                   | `writeFileAtomically` (a uniquely named temporary file renamed over the target, busy renames retried, the temporary file removed on failure) for the tools and the session store; Edit Review says to open the folder instead.                                                                                                                                                                                                                                                               |
| UTF-16 rules files; linked skills (Cline #12151)                                     | The loaders read files as lossy UTF-8, so a UTF-16 `AGENTS.md` (what Windows PowerShell 5.1's `>` writes) reached the model as NUL garbage; a symlinked or junctioned skill directory was dropped without a word; `AGENTS.md`, `CLAUDE.md`, `MEMORY.md` and `SKILL.md` were opened by their text path, so a committed link sent its target to the model.                                                                                       | `ContextIo` behind the loaders: `decodeContextText` reads UTF-16LE/BE by the byte-order mark and UTF-8 otherwise (its mark dropped), strictly, refusing NULs, each refusal logged with the file and the reason. Repository files are confined by canonical path (`confineWorkspacePath`); a link out of the workspace is skipped with a log line. Personal skill links are followed. One unreadable skill no longer hides the rest; a refused `AGENTS.md` does not fall back to `CLAUDE.md`. |
| `getDiagnostics` leaks and misses                                                    | Files outside every folder were reported by absolute path, a second folder's relative to that folder; no per-message cap; a request matched by suffix, lower-cased on every platform; a bad `%` escape made `decodeURIComponent` throw.                                                                                                                                                                                                        | Only the root's files, by root-relative path; messages clipped at `DIAGNOSTIC_MESSAGE_MAX_CHARS` (1,000) with a count, never inside a surrogate pair; the request resolved (`fileURLToPath`, or against the root) and matched exactly, case-insensitively on Windows only; a malformed or outside request is an MCP error result.                                                                                                                                                            |
| `@` mentions with spaces or `#`                                                      | `@path` ran to the first whitespace and `#` started the line range.                                                                                                                                                                                                                                                                                                                                                                            | `formatMention` quotes paths with whitespace, `#` or `"` (`@"my notes/a#1.md"#5-10`; `\"` and `\\` inside), used by Alt+K, the menu, the picker, uploads and drops; the composer reads mentions from the start of the draft, and the line range is no longer part of the menu's search. `[!x]` and nested braces (M21) confirmed.                                                                                                                                                            |
| Multi-root: the first folder is the root; remote drops (Claude Code #92403, audit G) | `asRelativePath` is relative to whichever folder holds the file, so folder 2's `src/a.ts` read as folder 1's in the chip, Alt+K, uploads, drops, the file search and diagnostics; a relative `openFile` with no folder resolved against the extension host's directory; a drop in a remote window never matched a folder, since the remote extension host sees its folders as `file:` URIs while the webview hands over `vscode-remote:` ones. | `rootRelativePath` over VS Code's folder attribution (a folder nested in the root counts as part of it); the file search limited to folder 0 (`RelativePattern`); `openFile` through `resolveAgainstRoot`; `hostSideUri` maps a dropped URI as VS Code's own URI transformer does (`vscode-remote` → `file`, a local `file` → `vscode-local`). Unit-tested; not tried in a real remote window.                                                                                               |
| A message typed during a card decides it (Roo #11211, audit G)                       | Checked, not affected: a message steers the running turn and never answers a card.                                                                                                                                                                                                                                                                                                                                                             | A test holds it (a regression that answers cards itself fails it); the Model API's "steers a running turn …" case decides the card after a steer, so the card was still pending.                                                                                                                                                                                                                                                                                                             |
| Subagent results in the parent's context (Claude Code 2.1.277, audit G)              | Not the extension's to mark: Muse Code builds the parent's context from its own children, and the Model API backend runs no subagents (D17).                                                                                                                                                                                                                                                                                                   | Recorded; nothing to change here.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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

| Report                                     | Finding                                                                            | Change                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Windows-reserved shortcuts                 | Windows takes Ctrl+Esc and Ctrl+Shift+Esc; VS Code hit the same (#217861)          | Add `win` bindings with Alt; walkthrough updated; tests reject reserved chords           |
| No third-party notices                     | 75 bundled packages, no notices in the vsix                                        | Notices generated from metafiles, shipped, checked by the build                          |
| Dictation in remote windows                | Workspace extension runs remote; `remoteName` is set on both hosts                 | Refuse when the host is remote (remoteName plus extension kind)                          |
| macOS permission flow                      | TCC credits VS Code, which declares no speech recognition (#307364); no quarantine | Not signed (owner); honest per-permission text; early-exit hint; disclaim route recorded |
| Plist version by hand                      | Hand-bumped literal                                                                | Derived from package.json; checked in the binary                                         |
| Integration tests on one version, no cache | Stable only                                                                        | Stable plus the floor; downloads cached                                                  |
| semgrep / PSScriptAnalyzer unpinned        | Unpinned                                                                           | 1.177.0 (Dependabot pip) and 1.25.0                                                      |
| Audit blocks tags                          | No-fix advisories dead-end a release                                               | Stays blocking; reviewed exceptions expiring within 90 days                              |
| No job timeouts / token persisted          | All jobs affected                                                                  | Timeouts everywhere they're allowed; `persist-credentials: false`                        |
| Commands always in the palette             | No `commandPalette` entries                                                        | Four `when` clauses                                                                      |
| Category                                   | "Programming Languages" is wrong                                                   | AI, Chat                                                                                 |
| `navigator` in the host                    | Not affected                                                                       | Build check added                                                                        |
| `VSCE_PAT` scope                           | Job-level env beside install scripts                                               | `verify` job, flag only, one step after `--ignore-scripts`                               |
| PS 5.1 `PSModulePath`; stdin EPIPE         | Both true                                                                          | Shared reset helpers; error listener and no writes after exit                            |

## 3. Open questions (need the owner)

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Default until answered                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Q1  | **Resolved 2026-09-22:** owner authorised installing anything needed; Muse Code CLI 1.3.0 installed via the official installer. The owner holds both a Muse Code subscription (CLI signed in by device code) and a pay-as-you-go Model API key; M7 keeps them apart (D1 amendment).                                                                                                                                                                                                                                                                                                                 | Closed.                                                               |
| Q2  | **Resolved 2026-09-22:** publisher `RandyNorthrup` read from the signed-in marketplace management page. Display name stays "Muse Spark Code (Unofficial)" unless the owner asks otherwise.                                                                                                                                                                                                                                                                                                                                                                                                          | Closed.                                                               |
| Q3  | **Resolved 2026-09-22:** owner wants both the CLI (MSP) backend and the Model API backend in the first release. M7 is required for v0.1.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | M7 required; see §10.                                                 |
| Q4  | **Resolved 2026-09-22 (M9, superseding the M8 answer):** voice dictation ships through the operating system's own recogniser, at no API cost and with no third-party code (owner's constraints): Windows PowerShell 5.1 + `System.Speech` on Windows, a Swift helper on Apple's Speech framework on macOS (owner chose this over an `osascript` bridge), and a dimmed button with the reason on Linux (no distribution ships a recogniser; the owner may revisit). The M8 finding stands for the webview itself: Electron's Web Speech recogniser is dead, so recognition runs in a helper process. | Closed; see M9.                                                       |
| Q5  | **Resolved (M4):** `highlight.js` 11.12.0 core with a fixed language set, in the webview bundle; `shiki` was not taken (grammar weight).                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Closed.                                                               |
| Q6  | Linux support for the CLI backend: Meta's product page lists macOS + Windows only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Detect and show "use Model API key" on Linux if `muse` is absent.     |
| Q7  | **Resolved 2026-09-22:** owner pressed F5 and confirmed the Muse Spark chat shell renders in the Extension Development Host (verbal confirmation; no screenshot filed).                                                                                                                                                                                                                                                                                                                                                                                                                             | Closed.                                                               |
| Q8  | **Resolved 2026-09-22:** owner signed in; publisher is `RandyNorthrup`. Publishing ran by hand from the CI artifact with a clipboard PAT for 0.1.0–0.5.0; since 2026-09-23 the `VSCE_PAT` repository secret lets `release.yml` publish every `v*` tag.                                                                                                                                                                                                                                                                                                                                              | Closed.                                                               |
| Q9  | The Muse Code user rules file: `/rules import` writes one into the config root and the model is told "if user and project rules conflict, project rules win", but its file name is not printed by `muse --help`, `muse skills`, the settings skill or the binary's strings. The Model API backend cannot mirror what it cannot name.                                                                                                                                                                                                                                                                | Not loaded on the Model API backend; the CLI backend loads it itself. |

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
merged through its pull request from `hardening/m21-security`.

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
pull request from `hardening/m22-lifecycle`.

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
pull request from `hardening/m23-protocol`.

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
the context rows in `docs/certification/m24-context.md`); pull request from
`hardening/m24-editing`.

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
pull request #8 from `hardening/m25-webview`.

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
pull request #7 from `hardening/m26-platform`.

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

## 7. Gates

| Gate                  | Command                                                                                                                                         | Status                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format                | `prettier --check .`                                                                                                                            | M0 ✓                                                                                                                                                                                                       |
| Lint (type-aware)     | `eslint . --max-warnings=0`                                                                                                                     | M0 ✓                                                                                                                                                                                                       |
| CSS lint              | `stylelint "src/**/*.css" --max-warnings=0`                                                                                                     | M0 ✓                                                                                                                                                                                                       |
| Types                 | `tsc --noEmit` over five projects: host, webview, unit, e2e, integration (`npm run typecheck`)                                                  | M0 ✓                                                                                                                                                                                                       |
| Dead code             | `knip` (not `--strict`; see knip.jsonc)                                                                                                         | M0 ✓                                                                                                                                                                                                       |
| Cycles                | `dpdm --no-warning --no-tree --exit-code circular:1 -T src/extension.ts src/webview/main.tsx`                                                   | M0 ✓                                                                                                                                                                                                       |
| Duplication           | `jscpd` (config `.jscpd.json`: threshold 0 over `src` and `test`)                                                                               | M0 ✓                                                                                                                                                                                                       |
| Unit tests + coverage | `vitest run --coverage`                                                                                                                         | M0 ✓                                                                                                                                                                                                       |
| Integration tests     | `vscode-test` (two configurations: `stable` and `minimum`, the `engines.vscode` floor)                                                          | M0 ✓ (9 passing locally since M18; CI: ubuntu xvfb + windows); M26 ✓ on 1.139.0 and 1.125.0, downloads cached in CI                                                                                        |
| Build + bundle budget | `node scripts/build.mjs --production && node scripts/check-bundle-size.mjs`                                                                     | M0 ✓                                                                                                                                                                                                       |
| Host globals          | `node scripts/check-host-globals.mjs` (part of `npm run build`): no `navigator` in the host bundles                                             | M26 ✓ (proof R)                                                                                                                                                                                            |
| Third-party notices   | `node scripts/third-party-notices.mjs` (part of `npm run build`; `npm run notices` regenerates)                                                 | M26 ✓ (proofs P, Q; CI's package job requires the file in the .vsix)                                                                                                                                       |
| Dependency audit      | `node scripts/audit.mjs` (`npm audit --json`, high and critical block; reviewed exceptions in `.github/audit-exceptions.json`, 90 days at most) | M0 ✓; M26 ✓ (proofs S–W)                                                                                                                                                                                   |
| Secrets               | `gitleaks git --redact` (history, `security:secrets`, also a CI job) and `gitleaks git --pre-commit --staged` (hook)                            | M0 ✓ (staged-scan proof; the history scan runs locally and in CI)                                                                                                                                          |
| SAST                  | `semgrep scan --config auto --error` (`npm run security:sast`)                                                                                  | M2 ✓ locally (pip-installed on Windows 2026-09-22, its Scripts folder added to the user PATH) and in the CI `sast` job. M26: CI pins semgrep 1.177.0 (`.github/semgrep/requirements.txt`, Dependabot pip). |
| PowerShell lint       | `node scripts/lint-ps.mjs` (PSScriptAnalyzer over `native/windows`, `npm run lint:ps`)                                                          | M9 ✓ on Windows (exit = finding count; a reported skip on other platforms; installed on the CI Windows runner). M26: pinned to 1.25.0 (`-RequiredVersion`), the version CI installs.                       |
| Lighthouse            | n/a (a webview, not a web page); no profiler gate exists, the harness screenshots are the visual check                                          | —                                                                                                                                                                                                          |

## 8. Escape hatches register

Every suppression, cast, or ignored error must be listed here with its reason.

| File                               | Construct                                                          | Reason                                                                                                                                                                                                                                                                                       | Added      |
| ---------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `src/host/backend/toolIo.ts`       | `nosemgrep` on `spawn` (`detect-child-process`)                    | The command line is the tool's payload by design: the user approved it on a card, and it runs through PowerShell / bash as an argument array, never a shell string.                                                                                                                          | 2026-09-22 |
| `src/host/backend/searchWorker.ts` | `nosemgrep` on `new RegExp(pattern)` (`detect-non-literal-regexp`) | The model's search pattern is evaluated on a worker thread that `toolIo.searchOnWorker` terminates at `SEARCH_TIMEOUT_MS`, and the pattern is capped at `SEARCH_PATTERN_MAX_LENGTH`; a runaway match cannot hang the host.                                                                   | 2026-09-22 |
| `src/host/voice/dictationHost.ts`  | `nosemgrep` on `spawn` (`detect-child-process`)                    | The dictation helper's command line is fixed by `helperLocation.ts` (Windows PowerShell under `%SystemRoot%` with the bundled script, or the bundled macOS binary with VS Code's own app name (`--app-name`)) and passed as an argument array; no user, model or workspace input reaches it. | 2026-09-22 |
| `test/unit/App.test.tsx`           | `as unknown as Selection` (four stubs)                             | jsdom offers no usable `Selection`; the quote-menu tests stub the two members the code reads (`toString`, `anchorNode`) and nothing else, so a structural cast is the honest shape. Test-only.                                                                                               | 2026-09-23 |

## 9. Security assumptions and accepted residual risk

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
- The pasted Model API key is used only by the Model API backend and is
  never handed to the Muse Code CLI (D1 amendment): subscription work is
  never billed to the key, and the key never reaches another process.
- Contributor-tier models send content Meta may train on; guarded by opt-in
  dialog and `confidentialWorkspace` setting.
- Repository protection (GitHub rulesets, 2026-09-23): `main` cannot be
  deleted or force-pushed and takes changes through pull requests with the
  seven CI checks green (the three quality jobs, gitleaks, semgrep, the
  macOS helper, the package); `v*` tags cannot be deleted or moved. The
  repository admin bypasses both for direct pushes and releases, and every
  bypass is logged by GitHub. A moved tag, as with 0.5.2, is then a
  deliberate bypass rather than a habit.

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

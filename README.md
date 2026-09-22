# Muse Spark Code (Unofficial)

A VS Code extension that puts Meta's **Muse Spark** model in a chat panel
inside the editor, modelled on the Claude Code VS Code extension: sidebar or
editor-tab conversations, a slash-command palette, model and reasoning-effort
picker, permission modes, streaming markdown, diff review, and session history.

> **Status: milestone M2 (sign-in and first conversations).** You can sign in
> (Meta account through the Muse Code CLI, or a Model API key), send messages
> and watch Muse Spark's reply stream in. Replies render as plain text; the
> agent cannot yet edit files or run commands because approvals arrive in M4
> and unmatched approvals are denied until then. See [`PLAN.md`](PLAN.md) for
> the milestone plan and the research behind it.

This project is not affiliated with or endorsed by Meta. "Muse Spark" and
"Muse Code" are Meta trademarks. You bring your own credentials.

## How it will talk to Muse Spark

Meta offers no OAuth flow for third-party apps, so the extension supports the
two sanctioned paths (see `PLAN.md` §2 D1):

| Backend                                                                      | How you sign in                                                                                                       | Status         |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Muse Code CLI** (`muse serve`, Muse Session Protocol via `@muse-code/sdk`) | The CLI's own browser sign-in (`muse login`) or `META_API_KEY`; subscriptions work because the CLI makes the requests | Available (M2) |
| **Meta Model API** (`https://api.meta.ai/v1`, OpenAI-compatible)             | Paste a key from dev.meta.ai; stored in VS Code SecretStorage                                                         | Planned (M7)   |

## Signing in

The panel shows a sign-in gate until a credential exists:

- **Sign in with your Meta account** opens a terminal running `muse login`
  (Windows PowerShell on Windows, your default shell elsewhere). Approve the
  code in your browser; the extension watches for the CLI's credential file
  (`~/.config/muse/auth.json`, or under `XDG_CONFIG_HOME`) for up to five
  minutes and then starts the backend.
- **Use a Model API key** prompts for a key shaped like `LLM|<id>|<secret>`,
  stores it in VS Code secret storage, and passes it to the CLI as
  `META_API_KEY` for the child process only.
- If the CLI is not installed, the gate links to the install instructions;
  the extension looks for it via `museSpark.museBinaryPath`, then `PATH`,
  then the platform's default install folder (`%LOCALAPPDATA%\Programs\muse`
  on Windows, `~/.local/bin` elsewhere).

Each panel is its own Muse session, started on the first message with the
Standard `muse-spark-1.3` model (never the contributor tier by default). The
host process is shared and stopped when VS Code unloads the extension.

## Platforms

Windows, macOS and Linux are all first-class targets. CI runs the complete gate
set, including the VS Code integration tests, on all three.

## Stack

- TypeScript 6.0.3 (pinned: `typescript-eslint` does not yet support TS 7),
  Node ≥ 22, npm 11
- Extension host bundled with esbuild to CommonJS; webview is React 19 bundled
  to a single IIFE with its stylesheet
- Validation with `zod/mini` on every host ⇄ webview message
- Quality: ESLint 10 (`strictTypeChecked` + unicorn + react-hooks), Prettier,
  stylelint, knip, dpdm, jscpd, vitest (v8 coverage thresholds),
  `@vscode/test-cli` integration tests, gitleaks, npm audit, semgrep

## Requirements

- Node.js 22 or newer and npm 11 (`.npmrc` enforces `engine-strict`)
- VS Code 1.134.0 or newer
- [gitleaks](https://github.com/gitleaks/gitleaks) on `PATH` for the
  pre-commit hook and `npm run security:secrets`
- Later milestones: the [Muse Code CLI](https://dev.meta.ai/products/muse-code/)
  and/or a Meta Model API key

## Installation (development)

```bash
git clone https://github.com/RandyNorthrup/muse-spark-code.git
cd muse-spark-code
npm ci
```

`npm ci` also installs the husky pre-commit hook (lint-staged + gitleaks).

Press **F5** in VS Code to launch the Extension Development Host with a fresh
build. The "Muse Spark" icon appears in the activity bar; the command palette
offers the **Muse Spark:** commands listed below.

## Commands and keybindings

| Command                                    | Default keybinding                 | What it does                                                                       |
| ------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------- |
| Muse Spark: Open in Sidebar                | —                                  | Focus the chat view in the activity bar                                            |
| Muse Spark: Open in New Tab                | `Ctrl+Shift+Esc` (`Cmd+Shift+Esc`) | Open an independent conversation as an editor tab (also the `+` in the view title) |
| Muse Spark: Toggle Focus                   | `Ctrl+Esc` (`Cmd+Esc`)             | Move keyboard focus between the editor and the composer                            |
| Muse Spark: Insert @-Mention for Selection | `Alt+K`                            | Insert `@path#start-end` for the active editor selection into the composer         |
| Muse Spark: Toggle Focus View              | `Ctrl+Alt+F`                       | Flip the `museSpark.focusView` setting (hides tool calls and reasoning from M4 on) |

In the composer, `Enter` sends and `Shift+Enter` inserts a newline; set
`museSpark.useCtrlEnterToSend` to send with `Ctrl+Enter` / `Cmd+Enter` instead.
Sending is enabled once you are signed in; Stop cancels a running turn.

## Settings

All settings live under `museSpark.*`; changes apply to open panels immediately.

| Setting                 | Default  | Purpose                                                                                    |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `preferredLocation`     | `panel`  | Where new conversations open: `sidebar` or `panel` (editor tab)                            |
| `initialPermissionMode` | `manual` | `manual`, `acceptEdits`, `plan`, `auto` or `bypassPermissions` for new conversations       |
| `autosave`              | `true`   | Save dirty files before Muse reads or writes them                                          |
| `attachOpenFile`        | `true`   | Attach the active file to each message (off: selection only)                               |
| `useCtrlEnterToSend`    | `false`  | Send with Ctrl/Cmd+Enter instead of Enter                                                  |
| `hideOnboarding`        | `false`  | Hide the onboarding checklist                                                              |
| `focusView`             | `false`  | Show only prompts and responses                                                            |
| `respectGitIgnore`      | `true`   | Exclude `.gitignore` patterns from file searches and `@`-mentions                          |
| `confidentialWorkspace` | `false`  | Block contributor-tier models (Meta may train on their traffic) in this workspace          |
| `museBinaryPath`        | `""`     | Absolute path to the Muse Code executable; empty discovers it on `PATH` or the install dir |
| `environmentVariables`  | `[]`     | `{ name, value }` pairs for the Muse Code process. Never put API keys here; use Sign in    |

## Development commands

| Command                                   | What it does                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run build:dev`                       | Dev bundles for the extension, the webview and the integration tests, with source maps                    |
| `npm run watch`                           | Rebuild extension + webview on change                                                                     |
| `npm run build`                           | Minified production bundles, then enforces the size budgets in `scripts/check-bundle-size.mjs`            |
| `npm run format` / `npm run format:check` | Prettier write / check                                                                                    |
| `npm run lint`                            | `eslint --max-warnings=0` (type-aware) and `stylelint --max-warnings=0`                                   |
| `npm run typecheck`                       | `tsc --noEmit` for the host, webview, unit-test and integration-test projects                             |
| `npm run deadcode`                        | `knip`: unused files, exports, dependencies (no `--strict`; see `knip.jsonc`)                             |
| `npm run cycles`                          | `dpdm` circular-import check from both entry points                                                       |
| `npm run duplication`                     | `jscpd` copy-paste detection (threshold 0)                                                                |
| `npm run test:unit`                       | vitest with coverage thresholds (90 % statements/lines/functions, 85 % branches)                          |
| `npm run test:integration`                | Builds, downloads VS Code stable into `.vscode-test/`, runs `test/integration/**` inside it               |
| `npm run test`                            | Unit then integration                                                                                     |
| `npm run security:audit`                  | `npm audit --audit-level=high`                                                                            |
| `npm run security:sast`                   | `semgrep scan --config auto --error` (install: `pip install semgrep`; the Scripts folder must be on PATH) |
| `npm run security:secrets`                | `gitleaks git` over the repository history                                                                |
| `npm run quality`                         | Every gate above except integration tests, plus secrets and SAST; **exits non-zero on any finding**       |
| `npm run quality:ci`                      | What CI runs: all gates plus integration tests                                                            |
| `npm run package`                         | `vsce package --no-dependencies` → `.vsix`                                                                |
| `npm run clean`                           | Remove `dist/` and `coverage/`                                                                            |

## Build

`npm run build` writes `dist/extension.js` (CommonJS, `vscode` external) and
`dist/webview/main.js` + `main.css`. Budgets: 600 KiB and 900 KiB respectively;
after M1 the bundles measure about 27 KiB and 244 KiB.

## Test

- **Unit** (`test/unit/**`): vitest. Extension-host modules run under Node with
  `vscode` aliased to `test/unit/mocks/vscode.ts`; webview components run under
  jsdom via a `// @vitest-environment jsdom` docblock. Fakes in
  `test/unit/helpers/fakes.ts` implement the full VS Code interfaces so no casts
  are needed.
- **Integration** (`test/integration/**`): mocha (TDD interface) inside a real
  VS Code launched by `@vscode/test-cli`; configuration in `.vscode-test.mjs`.
  On Linux run under `xvfb-run -a`.

## Quality gates

Every gate is wired to fail the build, not just print. Each was verified to
fail on a deliberate break before being trusted; the records are in
[`docs/certification/`](docs/certification/) (one file per milestone). Escape hatches
(`eslint-disable`, `@ts-expect-error`, casts) require an inline reason and a
row in `PLAN.md` §8.

## Environment variables

The extension stores credentials in VS Code SecretStorage, never in files.
`.env.example` documents the single variable tooling may read:

| Variable       | Used by                      | Purpose                                                                                          |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `META_API_KEY` | Muse Code CLI (`muse serve`) | Optional API key the extension can inject into the CLI child process (M2). Never commit a value. |

## Project structure

```
src/extension.ts            activation: registers the view, panel, commands
src/host/                   VS Code-facing code (webview wiring, later: auth, editor)
src/core/                   backend-agnostic agent logic (from M2)
src/shared/                 constants + zod message protocol shared with the webview
src/webview/                React app (own tsconfig, browser libs)
test/unit/                  vitest tests, vscode mock, fakes
test/integration/           @vscode/test-cli suites
test/fixtures/workspace/    workspace opened by the integration run
scripts/                    esbuild build, bundle-size gate
docs/certification/         per-milestone gate-fire records
media/                      activity-bar icon
```

## Deployment

`npm run package` produces `muse-spark-code-<version>.vsix`. Publishing to the
Marketplace uses publisher `RandyNorthrup` (confirmed on the marketplace
management page); publishing needs `npx vsce login RandyNorthrup` with a
Marketplace-manage PAT. CI (`.github/workflows/ci.yml`) runs the
quality gates on Ubuntu and Windows, integration tests under xvfb on Ubuntu,
gitleaks over full history, and semgrep.

## Security

- Webview CSP: `default-src 'none'`, scripts only with a per-load nonce, no
  remote origins, no inline styles (see `src/host/html.ts`).
- Every message between host and webview is validated with a zod schema; bad
  messages are logged to the "Muse Spark" output channel and dropped.
- API keys will live only in SecretStorage and be passed to child processes via
  environment; they are never written to settings, logs or telemetry.
- No telemetry. Secret scanning in pre-commit and CI.
- Contributor-tier Muse Spark models (Meta trains on their traffic) will be
  opt-in only, behind a warning dialog.

## Troubleshooting

- **`npm ci` fails with an engine error** — Node 22+ is required
  (`node --version`).
- **Pre-commit hook says `gitleaks: command not found`** — install gitleaks
  (Windows: `winget install Gitleaks.Gitleaks`).
- **Type-aware lint rules stop reporting** — check `npm ls typescript`; it must
  be 6.0.x. TypeScript 7 is outside `typescript-eslint`'s peer range.
- **`npm run test:integration` cannot download VS Code** — the download goes to
  `.vscode-test/`; on a restricted network set `VSCODE_TEST_VERSION` or
  pre-populate the folder from another machine.
- **Webview is blank after a change** — run `npm run build:dev` (F5 does this
  via the pre-launch task) and reload the window.

# Muse Spark Code (Unofficial)

A VS Code extension that puts Meta's **Muse Spark** model in a chat panel
inside the editor, modelled on the Claude Code VS Code extension: sidebar or
editor-tab conversations, a slash-command palette, model and reasoning-effort
picker, permission modes, streaming markdown, diff review, and session history.

> **Status: milestone M5 (editor integration).** You can sign in (Meta
> account through the Muse Code CLI, or a Model API key), hold streaming
> conversations with markdown and highlighted code, use the "/" palette,
> attach images, `@`-mention files, pick the model, effort and permission
> mode, steer a running turn, and watch the agent read, edit and write files
> in tool rows with diffs, approve or reject gated commands from cards, and
> answer its questions. The open file or selection rides along as context,
> finished edits can be diffed and reverted, code blocks apply into the
> editor, and Muse can read the Problems panel through an IDE tool. On
> Windows the panel offers Muse Code's one-time shell-sandbox setup itself
> (one administrator prompt). See [`PLAN.md`](PLAN.md) for the milestone
> plan and the research behind it.

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
- The [Muse Code CLI](https://dev.meta.ai/products/muse-code/) signed in with
  a Meta account, or a Meta Model API key (M7 adds the direct API backend)
- `git` on `PATH` for `.gitignore`-aware `@` mentions (optional; VS Code's
  file search is used without it)

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

| Command                                    | Default keybinding                                                 | What it does                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muse Spark: Open in Sidebar                | —                                                                  | Focus the chat view in the activity bar                                                                                                                   |
| Muse Spark: Open in New Tab                | `Ctrl+Shift+Esc` (`Cmd+Shift+Esc`)                                 | Open an independent conversation as an editor tab (also the `+` in the view title); the panel header's own button starts a new conversation in place      |
| Muse Spark: Toggle Focus                   | `Ctrl+Esc` (`Cmd+Esc`)                                             | Move keyboard focus between the editor and the composer                                                                                                   |
| Muse Spark: Insert @-Mention for Selection | `Alt+K`                                                            | Insert `@path#start-end` for the active editor selection into the composer                                                                                |
| Muse Spark: Toggle Focus View              | `Ctrl+Alt+F`                                                       | Flip the `museSpark.focusView` setting (hides tool calls and reasoning from M4 on)                                                                        |
| Muse Spark: Toggle Thinking                | `Ctrl+Alt+T` (macOS `Option+T`, Linux `Ctrl+Alt+O`), composer only | Turn reasoning on or off for this conversation. Claude Code uses `Alt+T`; on Windows that opens the Terminal menu, on GNOME `Ctrl+Alt+T` opens a terminal |
| Muse Spark: Set Up Shell Sandbox           | —                                                                  | Windows: run Muse Code's one-time `muse sandbox windows setup` through a UAC prompt and report the result; elsewhere reports that no setup is needed      |

In the composer, `Enter` sends and `Shift+Enter` inserts a newline; set
`museSpark.useCtrlEnterToSend` to send with `Ctrl+Enter` / `Cmd+Enter` instead.
Sending is enabled once you are signed in. While a turn is running, Stop
cancels it and `Enter` steers it: the new text reaches the model at its next
step (`turn/steer`; if the turn has just ended it is sent as a fresh turn).

## The composer

- **"/" palette** — press `/` on an empty draft or click the slash button.
  Type to filter; `Up`/`Down` move, `Enter` activates, `Left`/`Right` step
  the effort slider, `Esc` closes (or goes back from the model list). Groups
  match the Claude Code panel: Context (attach file, mention file, clear
  conversation), Model (switch model, effort, thinking), Customize
  (permission mode, Focus view, Ctrl+Enter, settings, keyboard shortcuts),
  Account & usage (session tokens, sign out), Skills (the session's
  `skill/list`, inserted as `/selector` and sent as a skill part), Slash
  commands (`/compact`, `/clear`, `/logout`) and Support (output log, issues,
  docs).
- **"+" menu** — _Upload from computer_ opens a native file dialog: PNG, JPEG,
  GIF and WebP files become `name W×H` chips and are sent as image parts
  (10 MB each, 20 per message); any other file is inserted as an `@path`
  mention. _Add context_ starts an `@` mention at the caret. Images can also
  be pasted or dropped onto the composer, and files dragged from the Explorer
  become mentions. (Claude Code's third entry, _Browse the web_, needs its
  Chrome extension and has no Muse counterpart.)
- **`@` mentions** — type `@` and a few letters; the menu lists matching
  files and folders from the workspace index, ranked fuzzily. `Enter` or
  `Tab` inserts `@path `, `Esc` dismisses. With `museSpark.respectGitIgnore`
  on, the index comes from `git ls-files` (so `.gitignore` applies exactly);
  without git it falls back to VS Code's file search. `Alt+K` still inserts
  `@path#start-end` for the editor selection.
- **Open-file chip** — with `museSpark.attachOpenFile` on (the default) the
  active workspace file rides beside the model pill as `App.tsx`, or
  `App.tsx L5-10` while lines are selected, exactly as in the Claude Code
  bar. When you send, the host adds it to the prompt the way Claude Code's
  IDE reminders do: `<ide_selection>` with the selected text (clipped at
  64 KiB; a file the workspace index does not list, such as a gitignored one,
  shares its path only) or `<ide_opened_file>` naming the file. The transcript
  and the durable session keep only what you typed (`turn/start.displayText`),
  and the user card shows the same chip. The `×` leaves the file out until
  another file becomes active.
- **Autosave** — with `museSpark.autosave` on, every send first saves all
  dirty editors so the CLI reads what you see.
- **Model pill** — `model effort`, e.g. `muse-spark-1.3 High`. Click it for
  the model list (`model/list`, context window shown per row; the choice is
  applied with `session/setModel`). Effort is Minimal / Low / Medium / High /
  Extra high / Max, each dot naming its tier on hover, and is sent as the
  session's reasoning-effort default; the CLI's own default is High. Only the
  tiers verified for the current model are offered (`PLAN.md` D10). The
  Thinking toggle (`Ctrl+Alt+T`; `Option+T` on macOS) sends `none` while off.
- **Permission mode** — the mode button opens the Modes menu (Manual / Edit
  automatically / Plan / Auto, each with a one-line description, plus the
  Effort row); `Shift+Tab` cycles them. Bypass permissions appears only while
  `museSpark.allowDangerouslySkipPermissions` is on. The modes map onto the
  CLI's approval modes as recorded in `PLAN.md` D7: Manual and Edit
  automatically prompt for anything no rule allows, Plan denies it, Auto lets
  the CLI's safety check decide and prompts only when it must, Bypass allows
  everything. In practice Muse Code allows file reads and edits inside the
  workspace without asking and gates shell commands, network access and
  writes outside the workspace.
- **While a turn runs** the placeholder reads "Queue another message…": Enter
  steers the running turn, Stop cancels it.

## The transcript

- **Replies** render as GitHub-flavoured markdown (tables, task lists,
  strikethrough). Raw HTML is never rendered, images show their alt text, and
  links open in your browser through VS Code (http, https and mailto only).
  Fenced code is highlighted (TypeScript, JavaScript, JSON, Bash, PowerShell,
  Python, CSS, HTML, Markdown, diff, YAML, SQL, Go, Rust, Java, C, C++, C#)
  with **Copy**, **Insert at cursor** and **Apply** buttons; Apply replaces
  the active editor's selection with the block (or inserts it at the caret).
- **Tool rows** show what the agent did, one per call: `Read`, `Edit`,
  `Write`, `PowerShell` / `Bash`, `Question`, or the raw tool name. A green
  dot means completed, a pulsing one running, red failed or rejected. Under
  an edit the row says `Added N lines`, `Removed N lines` or `Modified`;
  click the row for the diff (line-numbered once the stored patch has been
  fetched), the shell command and its output (`IN` / `OUT`), or the file
  contents read. Long outputs clip to twelve lines with **Show more**.
- **Edit review** — Muse Code applies in-workspace edits as it goes (they
  never prompt, see `PLAN.md` D11), so review happens after the fact: a
  finished `Edit` or `Write` row offers **Open diff** (VS Code's diff editor,
  the file before the edit on the left and the file as it is now on the
  right, rebuilt from the stored patch) and **Revert** (writes the pre-edit
  text back; a file the edit created goes to the trash). If the file changed
  since the edit, both say so instead of guessing. Claude Code's
  review-before-write has no MSP counterpart.
- **Diagnostics** — Muse can ask VS Code for the errors and warnings in the
  Problems panel: the extension serves a `getDiagnostics` tool to each
  session over a loopback MCP server (`sessionMcp`), as Claude Code's IDE
  server does. Nothing else is exposed, the server binds `127.0.0.1` only and
  needs a per-window bearer token.
- **Reasoning** collapses to `Thought for Ns`; click to read the summary
  parts the model exposed.
- **Approval cards** appear under a gated tool call with the choices the CLI
  offers (`Allow once`, `Always allow in this workspace: …`, `Reject` with
  optional feedback to the model). A shell line with several commands is
  approved one step at a time (`step 1 of 2`).
- **Question cards** appear when the agent asks you something: pick an
  option (or several), or type an answer, then **Submit**.
- The **task list** the agent keeps is pinned above the composer; the
  session's name replaces "Untitled" once the CLI allocates one; the
  composer shows how much of the context window is used; a spinner line with
  a verb sits under the last row while a turn runs.
- **Focus view** (`Ctrl+Alt+F` or the setting) folds consecutive tool and
  reasoning rows behind one `Show N steps` row; a card waiting on you is
  never hidden.

## Settings

All settings live under `museSpark.*`; changes apply to open panels immediately.

| Setting                           | Default  | Purpose                                                                                                                                                                                                                                               |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preferredLocation`               | `panel`  | Where new conversations open: `sidebar` or `panel` (editor tab)                                                                                                                                                                                       |
| `initialPermissionMode`           | `manual` | `manual`, `acceptEdits`, `plan`, `auto` or `bypassPermissions` for new conversations                                                                                                                                                                  |
| `autosave`                        | `true`   | Save all dirty editors before every turn                                                                                                                                                                                                              |
| `attachOpenFile`                  | `true`   | Show the open-file chip and send the active file / selection with each message                                                                                                                                                                        |
| `useCtrlEnterToSend`              | `false`  | Send with Ctrl/Cmd+Enter instead of Enter                                                                                                                                                                                                             |
| `hideOnboarding`                  | `false`  | Hide the onboarding checklist                                                                                                                                                                                                                         |
| `focusView`                       | `false`  | Show only prompts and responses                                                                                                                                                                                                                       |
| `respectGitIgnore`                | `true`   | Exclude `.gitignore` patterns from file searches and `@`-mentions                                                                                                                                                                                     |
| `confidentialWorkspace`           | `false`  | Block contributor-tier models (Meta may train on their traffic) in this workspace                                                                                                                                                                     |
| `allowDangerouslySkipPermissions` | `false`  | List Bypass permissions in the Modes menu and the Shift+Tab cycle (sandboxes only)                                                                                                                                                                    |
| `shellSandbox`                    | `auto`   | `auto`: Muse Code's OS sandbox, except for Windows workspaces under your profile where it cannot run commands; `muse`: always the sandbox; `off`: commands run directly as you, gated by approvals (Claude Code style). Changing it restarts the host |
| `museBinaryPath`                  | `""`     | Absolute path to the Muse Code executable; empty discovers it on `PATH` or the install dir                                                                                                                                                            |
| `environmentVariables`            | `[]`     | `{ name, value }` pairs for the Muse Code process. Never put API keys here; use Sign in                                                                                                                                                               |

## Development commands

| Command                                   | What it does                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run build:dev`                       | Dev bundles for the extension, the webview and the integration tests, with source maps                           |
| `npm run watch`                           | Rebuild extension + webview on change                                                                            |
| `npm run harness:shots`                   | Screenshots of the webview in headless Chrome behind a fake host (`test/harness/`); needs `build:dev` and Chrome |
| `npm run build`                           | Minified production bundles, then enforces the size budgets in `scripts/check-bundle-size.mjs`                   |
| `npm run format` / `npm run format:check` | Prettier write / check                                                                                           |
| `npm run lint`                            | `eslint --max-warnings=0` (type-aware) and `stylelint --max-warnings=0`                                          |
| `npm run typecheck`                       | `tsc --noEmit` for the host, webview, unit-test and integration-test projects                                    |
| `npm run deadcode`                        | `knip`: unused files, exports, dependencies (no `--strict`; see `knip.jsonc`)                                    |
| `npm run cycles`                          | `dpdm` circular-import check from both entry points                                                              |
| `npm run duplication`                     | `jscpd` copy-paste detection (threshold 0)                                                                       |
| `npm run test:unit`                       | vitest with coverage thresholds (90 % statements/lines/functions, 85 % branches)                                 |
| `npm run test:integration`                | Builds, downloads VS Code stable into `.vscode-test/`, runs `test/integration/**` inside it                      |
| `npm run test`                            | Unit then integration                                                                                            |
| `npm run security:audit`                  | `npm audit --audit-level=high`                                                                                   |
| `npm run security:sast`                   | `semgrep scan --config auto --error` (install: `pip install semgrep`; the Scripts folder must be on PATH)        |
| `npm run security:secrets`                | `gitleaks git` over the repository history                                                                       |
| `npm run quality`                         | Every gate above except integration tests, plus secrets and SAST; **exits non-zero on any finding**              |
| `npm run quality:ci`                      | What CI runs: all gates plus integration tests                                                                   |
| `npm run package`                         | `vsce package --no-dependencies` → `.vsix`                                                                       |
| `npm run clean`                           | Remove `dist/` and `coverage/`                                                                                   |

## Build

`npm run build` writes `dist/extension.js` (CommonJS, `vscode` external) and
`dist/webview/main.js` + `main.css`. Budgets: 600 KiB and 900 KiB respectively;
after M3 the bundles measure about 80 KiB and 274 KiB.

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
src/host/                   VS Code-facing code (webview wiring, auth, conversation, mentions)
src/core/                   backend-agnostic logic (MSP host, launch, attachments, fuzzy index)
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
- **Every shell command fails with `sandbox enforcement unavailable`** — Muse
  Code runs commands inside an OS sandbox that needs a one-time administrator
  setup on Windows (it creates the local sandbox users, their capabilities and
  a network filter under `C:\ProgramData\muse`). The extension checks
  `muse sandbox windows check` when a chat opens and offers the setup in a
  notification ("Set up now" relaunches `muse sandbox windows setup` through
  the UAC prompt and re-checks; "Don't ask again" is remembered). The same
  flow is available any time as **Muse Spark: Set Up Shell Sandbox**, and the
  panel repeats the offer when a shell tool reports the failure. After the
  setup, start a new conversation. File reads and edits work without it;
  Linux and macOS need no setup (`muse sandbox` has only the `windows`
  subcommands).
- **Shell commands run in `C:\Windows\System32\WindowsPowerShell\v1.0`
  instead of the project, and the first one takes ages** — Muse Code 1.3.0's
  Windows sandbox account cannot enter folders under `C:\Users\<you>`, so for
  a workspace inside your profile it falls back to PowerShell's own folder
  (about 34 s per command; the very first command can take minutes while the
  sandbox account logs on). `muse exec` does the same, so it is a CLI
  limitation (reported as
  [meta-models/muse-code-sdk#26](https://github.com/meta-models/muse-code-sdk/issues/26)).
  With `museSpark.shellSandbox` at its default `auto`, the extension starts
  Muse Code with `--disable-sandbox` for such workspaces: commands then run
  directly as you, in the project, in about a second, and the approval cards
  still gate them exactly as before (this is how Claude Code runs commands
  too). The panel says so once per conversation. Set the setting to `muse`
  to keep the sandbox regardless (the panel then warns about the wrong
  folder) or `off` to never sandbox. Muse Code's own docs say that without
  the sandbox its file tools may also write outside the workspace; in our
  check over the extension's connection a `write_file` outside the
  workspace was still refused (`path must resolve within the Active
Workspace Root`). Keep Manual or Edit-automatically mode and read the
  approval cards regardless.

# Muse Spark Code (Unofficial)

A VS Code extension that puts Meta's **Muse Spark** model in a chat panel
inside the editor, modelled on the Claude Code VS Code extension: sidebar or
editor-tab conversations, a slash-command palette, model and reasoning-effort
picker, permission modes, streaming markdown, diff review, and session history.

> **Version 0.1.0.** Sign in with your Meta account through the Muse Code
> CLI (billed to your Muse subscription) or with a Model API key (pay as you
> go); the two are never mixed. Hold streaming conversations with markdown
> and highlighted code, use the "/" palette, attach images, `@`-mention
> files, pick the model, effort and permission mode, steer a running turn,
> and watch the agent read, edit and write files in tool rows with diffs,
> approve or reject gated commands from cards, and answer its questions. The
> open file or selection rides along as context, finished edits can be
> diffed and reverted, code blocks apply into the editor, and Muse can read
> the Problems panel through an IDE tool. Past conversations of the
> workspace are one click away in the History dialog (search, archive,
> resume with the full transcript), the sidebar picks its last conversation
> back up within ten minutes, and a hidden panel shows a dot when Muse needs
> you. **Account & usage** (`/usage`) shows your subscription's current and
> weekly windows and this conversation's tokens. The microphone (or
> `Ctrl+D`) dictates into the composer through the operating system's own
> recogniser on Windows and macOS, at no cost. On Windows the panel offers
> Muse Code's one-time shell-sandbox setup itself (one administrator
> prompt). See [`PLAN.md`](PLAN.md) for the milestone plan and the research
> behind it, and [`docs/PRIVACY.md`](docs/PRIVACY.md) for what leaves your
> machine.

This project is not affiliated with or endorsed by Meta. "Muse Spark" and
"Muse Code" are Meta trademarks. You bring your own credentials.

## How it talks to Muse Spark

Meta offers no OAuth flow for third-party apps, so the extension supports the
two sanctioned paths (see `PLAN.md` §2 D1):

| Backend                                                                      | How you sign in                                                                                                                      | Status         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| **Muse Code CLI** (`muse serve`, Muse Session Protocol via `@muse-code/sdk`) | The CLI's own browser sign-in (`muse login`); your Muse subscription pays because the CLI makes the requests with its own credential | Available (M2) |
| **Meta Model API** (`https://api.meta.ai/v1`, OpenAI-compatible)             | Paste a key from dev.meta.ai; stored in VS Code SecretStorage; pay as you go; the extension's own tools                              | Available (M7) |

The two are never mixed: the key you paste drives only the Model API
backend and is never handed to the CLI, so subscription work is never
billed to the key (until M7 the extension passed it to `muse serve` as
`META_API_KEY`, which the CLI prefers over its own sign-in). The
`museSpark.backend` setting picks: `auto` (default) uses the CLI when it is
installed and signed in, otherwise the Model API when a key is stored;
`museCode` and `modelApi` force one side. The `/` palette's **Backend** row
under Account & usage shows which one this window runs on.

## Signing in

The panel shows a sign-in gate until a credential exists:

- **Sign in with your Meta account** opens a terminal running `muse login`
  (Windows PowerShell on Windows, your default shell elsewhere). Approve the
  code in your browser; the extension watches for the CLI's credential file
  (`~/.config/muse/auth.json`, or under `XDG_CONFIG_HOME`) for up to five
  minutes and then starts the backend.
- **Use a Model API key** prompts for a key shaped like `LLM|<id>|<secret>`
  and stores it in VS Code secret storage. It works without the CLI and
  starts the Model API backend; it is never passed to the CLI.
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
  a Meta account (subscription), or a Meta Model API key (pay as you go)
- `git` on `PATH` for `.gitignore`-aware `@` mentions (optional; VS Code's
  file search is used without it)

## Installation

From the Marketplace once published, or from the `.vsix`:

```bash
npm run package                      # writes muse-spark-code-0.1.0.vsix
code --install-extension muse-spark-code-0.1.0.vsix
```

Then open the **Muse Spark** view from the activity bar and sign in
(see "Signing in" above). The getting-started tips under the empty state
list the keybindings; **Hide these tips** turns them off
(`museSpark.hideOnboarding`).

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
| (composer) Record voice                    | `Ctrl+D` (`Cmd+D`), composer only                                  | Tap to start or stop voice dictation, hold to record while held (see Voice dictation below)                                                               |

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

## The Model API backend

With a pasted key and no signed-in CLI (or `museSpark.backend: modelApi`)
the panel talks to `https://api.meta.ai/v1` itself: streamed
`POST /responses` with stateless reasoning replay (`store: false`, the
encrypted reasoning items are sent back each turn, so nothing is kept on
Meta's side), the same effort tiers, and the extension's own tools in place
of the CLI's: Read, Edit (exactly one match), Write, Search (regex + glob),
List, the platform shell (PowerShell on Windows, bash elsewhere), plus
questions to you and a task list. Every path is confined to the workspace;
edits show the same diff rows with **Open diff** / **Revert**. The
permission modes apply as in Claude Code: Manual asks before edits and
commands, Edit automatically asks only for commands, Plan refuses both, Auto
behaves like Edit automatically here (there is no safety classifier to
consult), Bypass runs everything. Approval cards offer Allow once, Always
allow in this session, and Reject with feedback. `/compact` summarises the
conversation with one model call. Sessions on this backend live for the
window: the History dialog lists them, but they are gone after a reload
(a stored session log is deferred past 0.1.0). Skills are not available. A
contributor-tier model asks once per conversation before it is used and is
hidden in a confidential workspace, on either backend.

## Sessions and history

Every conversation is a Muse Code session stored on disk by the CLI, so
nothing is lost when the panel closes.

- **History** (the clock in the header, or `/` → **Resume**) lists this
  workspace's stored sessions grouped Today / Yesterday / Previous 7 days /
  Older, newest first, each with its name (or first prompt), how long ago it
  was active, its turn count, git branch and whether it is a fork. Type to
  search names and branches; `↑` `↓` and `Enter` (or a click) resume one,
  `Esc` closes. Resuming rebuilds the transcript from the stored history
  (your messages as cards, the agent's replies, reasoning and tool rows at
  their final state) and continues the session live; the composer picks up
  the session's model and your current effort and permission mode.
- **Archive** (`×` on a row) hides a session from the list without deleting
  anything (Muse Code has no delete); **Show archived** brings it back and
  offers **Unarchive**. Sessions idle for longer than
  `museSpark.archiveInactiveSessions` days (default 14) are hidden the same
  way.
- **The sidebar remembers**: reopening it within ten minutes of the last
  message resumes that conversation, as in Claude Code; later it starts
  empty and the History dialog has the old one. Editor tabs always start a
  new conversation.
- **Rename** by clicking the title in the header (`Enter` saves, `Esc`
  cancels); the name the CLI settles on is shown. **Fork from here** on any
  of your messages (hover it) starts a new conversation that keeps the turns
  before that message, Claude Code's "rewind" without the file checkpoints
  (use **Revert** on the edit rows for those). Muse Code 1.3.0 refuses both
  on Windows (see Troubleshooting); the panel says so and nothing changes.
- **Unread**: when a turn finishes, or the agent asks for an approval or an
  answer, while the sidebar is hidden the Muse Spark view shows a badge, and
  a background editor tab gets a `●` in its title, until you look.

## Account & usage

`/usage`, `/cost`, or the **Account & usage…** row of the `/` palette open
a dialog under the header:

- **Backend**: which side this window runs on (Muse Code on your
  subscription, or the Model API on your key).
- **Plan** and two bars, the current block (Muse Code reports a 300-minute
  window) and the rolling week, each with "resets in" and the percent used
  as Meta reports it (over-quota values keep their real number). The
  numbers are what the CLI last observed ("as of …"); the CLI reports them
  after the first turn of a conversation (`usage/read`, then live through
  `usage/changed`), so a fresh window shows "No subscription usage reported
  yet" until then. Meta's tier field is an opaque id today, so the plan line
  reads "Muse Code subscription".
- **This conversation**: input, output and cached tokens and the context
  used out of the model's window, from `session/tokenUsage` /
  `session/contextUsage` (or the Model API's `usage` block).
- A window on the Model API key shows no bars: requests are billed to the
  key at pay-as-you-go rates and counted on the dev.meta.ai dashboard, which
  **Open dev.meta.ai** opens.

Screen readers hear the panel's state changes through a polite live region:
finished, failed and stopped turns, approval cards (with the tool),
questions, resumes, warnings and errors.

## Voice dictation

The microphone in the composer ("Tap or hold to record (Ctrl+D)") types what
you say at the caret. A tap starts listening and a second tap stops; holding
the button (or `Ctrl+D` / `Cmd+D` in the composer, or Space on the focused
button) records while held and stops on release. The placeholder reads
"Listening…" and the mic pulses red while recording; each recognised phrase
lands in the composer followed by a space. Nothing is billed and no
third-party engine is involved: recognition runs on the operating system's
own recogniser in a small helper process that the extension keeps warm for
five minutes after a recording.

| Platform | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `native/windows/dictate.ps1` under Windows PowerShell 5.1 on the .NET Framework's `System.Speech` (the desktop recogniser that ships with Windows; English is always installed, other languages come with Windows speech packs). Audio never leaves the machine. Accuracy is the classic engine's, below Windows 11's voice typing.                                                                                                                                                                                                               |
| macOS    | `native/darwin/muse-dictate`, a Swift helper on Apple's Speech framework, built by CI on a Mac and shipped in the Marketplace `.vsix`. **Dictation (System Settings > Keyboard) or Siri must be on**, or Apple answers "Siri and Dictation are disabled". macOS asks once for the microphone and for speech recognition. Recognition is on the device when Apple supports it for your language; otherwise Apple's servers transcribe under Apple's terms, at no charge. A `.vsix` built on Windows or Linux has no helper and the button says so. |
| Linux    | Not available: no distribution ships a speech recogniser and the extension adds none. The button is dimmed with that reason as its tooltip.                                                                                                                                                                                                                                                                                                                                                                                                       |

Troubleshooting on Windows: the helper can replay a WAV file instead of the
microphone, which separates a recogniser problem from a microphone one:

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File native\windows\dictate.ps1 -InputWav C:\path\to\speech.wav
```

Type `start` and press Enter; the phrases print as JSON lines, then `stopped`.

On macOS the helper takes `--input-device <CoreAudio UID>` to capture from
one specific device instead of the system default (the test rig feeds it a
loopback device; a Mac with several microphones can be pinned to one). Run
it by hand from Terminal the same way (`start`, `stop`, `quit` on stdin); a
Mac without any input device reports "no audio input device is available",
and the step markers on stderr name where a start failed.

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
| `archiveInactiveSessions`         | `14`     | Hide sessions idle for this many days from the History dialog (`1`, `2`, `7`, `14`, or `0` for never); they stay on disk and **Show archived** lists them                                                                                             |
| `backend`                         | `auto`   | `auto`: Muse Code when the CLI is signed in, else the Model API when a key is stored; `museCode` / `modelApi` force one. The pasted key never reaches the CLI                                                                                         |
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

| Variable       | Used by                      | Purpose                                                                                                                                                          |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `META_API_KEY` | Muse Code CLI (`muse serve`) | If you export it yourself the CLI inherits it untouched (and prefers it over its sign-in, as Meta documents). The extension never sets it. Never commit a value. |

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
scripts/                    esbuild build, bundle-size gate, PSScriptAnalyzer gate
native/windows/             dictate.ps1: the Windows dictation helper (System.Speech)
native/darwin/              Dictation.swift + build.sh: the macOS helper (built in CI)
docs/certification/         per-milestone gate-fire records
media/                      activity-bar icon
```

## Deployment

`npm run package` runs the production build (`vscode:prepublish`) and
produces `muse-spark-code-<version>.vsix` containing the two bundles, the
stylesheet, the icons, this README, the CHANGELOG, the LICENSE and
`docs/PRIVACY.md` (see `.vscodeignore`). The Marketplace icon is
`media/icon.png`, rendered from `media/marketplace-icon.svg` by
`npm run icon` (headless Chrome; the Marketplace rejects SVG icons).
Publishing uses publisher `RandyNorthrup` (confirmed on the marketplace
management page) and needs `npx vsce login RandyNorthrup` with a
Marketplace-manage PAT, then `npx vsce publish --no-dependencies`. CI
(`.github/workflows/ci.yml`) runs the quality gates on Ubuntu, Windows and
macOS, integration tests under xvfb on Ubuntu, gitleaks over full history,
semgrep, a `native-darwin` job that compiles the macOS dictation helper,
and a `package` job that downloads that helper and uploads the complete
`.vsix` as the `muse-spark-code-vsix` artifact. Publish from that artifact
(`npx vsce publish --packagePath <file>.vsix`), not from a Windows or Linux
`npm run package`, or Mac users get a panel without a microphone.

## Security

- Webview CSP: `default-src 'none'`, scripts only with a per-load nonce, no
  remote origins, no inline styles (see `src/host/html.ts`).
- Every message between host and webview is validated with a zod schema; bad
  messages are logged to the "Muse Spark" output channel and dropped.
- A pasted Model API key lives only in SecretStorage and is sent only to
  `api.meta.ai`; it is never passed to any child process (the Muse Code CLI
  runs on its own sign-in), never written to settings, logs or telemetry.
- No telemetry. Secret scanning in pre-commit and CI.
- Contributor-tier Muse Spark models (Meta trains on their traffic) are
  opt-in only: one modal confirmation per conversation, and refused outright
  with `museSpark.confidentialWorkspace`.
- What leaves your machine and where it goes: [`docs/PRIVACY.md`](docs/PRIVACY.md).

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
- **Model API charges while using the CLI** — up to M6 a key pasted into
  the panel was passed to `muse serve` as `META_API_KEY`, which the CLI
  prefers over its own sign-in, so CLI work was billed to the key. M7 stops
  that: the CLI runs on its own credential only (check the "muse serve
  credentials" line in the Muse Spark output log). If the CLI itself holds
  a pay-as-you-go key (`muse auth set`), or `META_API_KEY` is exported in
  your environment, the CLI still uses it, exactly as Meta documents.
- **"Could not rename the conversation: … UnsupportedPlatform" / "Could not
  fork the conversation: invalid fork boundary … WriteFailed"** — Muse Code
  1.3.0 refuses `session/rename` and `session/fork` on Windows (the same two
  commands work from the CLI's own TUI on Linux and macOS). The panel offers
  both, shows the CLI's refusal as a notice and leaves the conversation as
  it was. Names the CLI allocates itself still show in the header and the
  History dialog.
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

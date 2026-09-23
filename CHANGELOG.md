# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Entries record what actually
happened, not what was planned; superseded entries are kept.

## [Unreleased]

Nothing yet.

## [0.5.3] - 2026-09-23

### Added

- A way to support the project: the manifest's `sponsor` link puts a
  Sponsor button on the Marketplace listing, `.github/FUNDING.yml` puts one
  on the repository, and the README ends with the same PayPal link the
  author's other projects use.

## [0.5.2] - 2026-09-23

The first community fix, and the README brought up to date with the panel.

### Fixed

- The prompt box grows with wrapped lines as well as newlines, up to ten
  rows, and scrolls inside past that; a long single line no longer hides
  behind a one-row box (#4, reported by dhaw97160).
- The e2e suite's teardown on Windows no longer fails when the fake CLI's
  executable is still held for a moment after its process has exited: the
  temporary folders are removed with retries, and one that still cannot go
  is reported and left to the OS rather than failing a green suite.

### Changed

- The README describes the panel as it is at 0.5.x: the Open diff and
  Revert buttons it still promised are gone since 0.4.2 (the diff editor is
  behind Click to expand, revert is the rewind menu), subagents and the
  Agent map, reply and quote with context, question cards, outputs opening
  in the editor and the usage insights are in the highlights, the release
  workflow's own Marketplace publish replaces the by-hand recipe, the live
  drill's budget and measurements are current, and the three upstream Muse
  Code issues are linked from Troubleshooting. Its eleven screenshots are
  rendered from the shipped panel by the UI harness (`npm run
  harness:shots`) and say so; the 0.1.1 captures are gone.

## [0.5.1] - 2026-09-23

A docs-only patch, and the first release the workflow published to the
Marketplace itself (the `VSCE_PAT` repository secret exists since
2026-09-23).

### Fixed

- The README badges for the Marketplace version and installs rendered as
  "retired badge" on the listing: shields.io retired its Visual Studio
  Marketplace endpoints, so badgen.net serves both badges now.

## [0.5.0] - 2026-09-23

The verification round and the subagent orchestration it called for
(PLAN.md D21): every screen rendered and viewed, the live drills run.
Published to the Marketplace on 2026-09-23 from the release vsix, the first
Marketplace release since 0.1.1.

### Added

- Subagent tool rows are labelled (Spawn agent, Wait for agents, Agent
  status, Message agent, Agent result, Cancel agent), and an approval for a
  tool such as `subagent_spawn` reads "Muse wants to use …". Muse Code gates
  `subagent_spawn` behind an approval: in Manual mode the card appears and
  Allow once lets the agent spawn; Plan mode refuses it by policy.
- **Agent orchestration.** An agent's own replies and tool calls stay in
  its transcript in the Agent map instead of the conversation (they arrive
  with the child session's turn id, seen live). The map's details offer
  Muse Code's owner controls: Interrupt and Stop while an agent runs, a
  note to it, Resume, Close, and a follow-up task once its result is
  ready; its full result text is shown. Usage insights count a subagent's
  run by the CLI's own child marker, not by its tool count.
- 16 harness scenarios for the screens of 0.3.1–0.5.0.

### Fixed

- The usage modal's "what's contributing" section said the Model API has
  no trace logs even on the Muse Code backend; it now says no Muse Code
  trace logs were found on this machine.
- The live reply-only drill's attempt budget is 60 (three measurements:
  31, 45, 25); the CLI's reminder agents loop a varying number of times.

## [0.4.3] - 2026-09-22

Replying to an output and quoting the chat (PLAN.md D20).

### Added

- **Reply to this output**: a hover actions menu (⋯) on every finished
  reply, beside Copy. It puts a "Replying to: …" chip on the composer; the
  message then carries the whole output to the agent as a
  `<chat_reference intent="reply">` context part that says the user is
  replying to it.
- **Ask about this / Comment on this**: highlight any text in the chat (a
  reply, your own message or a tool output) and right-click it. The chip
  reads "Asking about: …" or "Commenting on: …"; the message carries the
  highlighted passage, who wrote it and the intent. Without a selection the
  browser's own menu is untouched.
- The sent message keeps the chip, and the chip's × drops the reference
  before sending.

## [0.4.2] - 2026-09-22

The owner's second F5 round, on 0.4.1 (PLAN.md D19).

### Added

- The path of an edit or read row is a link: it opens the file with the
  changed lines selected and revealed.
- **Click to expand** on every edit diff with a stored patch, opening the
  diff editor (the file side is editable). Shell and edit rows show their
  body from the start; read and generic rows open on click.
- Account & Usage shows the last window Muse Code reported, dated "as of",
  until the CLI reports a fresh one (it only does so after a reply).
- The question card is structured like Claude Code's: radio buttons or
  checkboxes stacked, an **Other** row with a text box, one tab per question,
  **Submit** disabled until every question is answered, and **Cancel**, which
  declines the prompt (Muse Code's `userInput/cancel`).

### Changed

- Thinking rows stream their summary while the model thinks and end as a
  plain "Thought for Ns" line, as in Claude Code; nothing to expand after.
- The **Open diff** and **Revert** buttons under edit rows are gone: the
  diff editor is behind Click to expand, revert is in the message's rewind
  menu.
- No outline on hover over a clickable output block.

### Fixed

- The model pill still read "Starting Muse Code…" until clicked: the pill
  reads the session's model, so the warm-up now posts the model the first
  send will use.

## [0.4.1] - 2026-09-22

The owner's first F5 round on 0.4.0 (PLAN.md D18).

### Added

- The transcript follows new entries while you are at the end (and after
  your own send); scrolled up, it holds still and a **New messages** button
  jumps to the newest.
- A chevron on every tool and reasoning row that opens; it turns when the
  row is open. Rows with nothing to show are disabled.
- **Copy** on each finished reply, shown on hover, copies the reply's
  markdown.
- A tool's output (a shell OUT, a read, a generic output) opens in a
  read-only editor tab on click or Enter, named like Claude Code's
  ("PowerShell tool output (a1b2c3)"); a stored output is paged in full.
- Long inline diffs are clipped behind **Click to expand**: with a stored
  patch it opens the diff editor (the file side is editable), otherwise the
  rows unfold inline.

### Fixed

- The model pill read "Starting Muse Code…" until the pill was clicked: the
  host now starts and lists its models as soon as the panel is open, and
  after a sign-in.
- An approval decision Muse Code failed to record (its "approval ledger
  durability fence" error on Windows) was reported as refused although the
  tool ran; it is now a warning that says the tool may have run anyway.

## [0.4.0] - 2026-09-22

Subagents, the Agent map, the Account & Usage modal, and the smaller
parity gaps the owner spotted (PLAN.md D17).

### Added

- **Subagents.** Muse Code's native subagents appear as rows (role,
  objective, status, duration), an "N agents" pill in the header opens the
  **Agent map**: this conversation, its agents with their tokens, the
  background tasks, and an agent's own transcript read from its child
  session. `/agents` opens it too. When Muse Code's delegation is off (its
  default, `run.subagent_delegation_mode`), the map says so and opens the
  CLI's settings file; the extension never edits it.
- **Background tasks.** A tool call the CLI put in the background carries a
  badge on its row and a line in the Agent map.
- **Account & Usage** is a centred modal with the chat dimmed behind it:
  auth method, plan, backend, Muse Code version and model; the
  subscription bars; this conversation's tokens with the cache-hit rate and,
  on the Model API, a dollar estimate from Meta's published prices; and
  "what's contributing to your usage" for the day or the week, read from
  the CLI's trace logs on this machine (reminder agents, subagents, long
  sessions).
- **Choices as pickers.** Every CLI turn carries a hidden note asking Muse
  to offer choices through `request_user_input` so the panel can show a
  picker; the Model API prompt says the same about `ask_user`.
- **Unsupported uploads** show a dismissible banner above the composer with
  the supported types and the @-mention / absolute-path hint, instead of a
  transcript notice.
- **Compact now**: the context indicator is a button; its tooltip carries
  the pressure level Muse reports.
- Diagnostics reports the CLI's subagent delegation mode.

### Changed

- The fake CLI of the e2e suite scripts subagents and backgrounded calls.

## [0.3.1] - 2026-09-22

The production-readiness verification (PLAN.md D16) and its fixes.

### Added

- A process-level end-to-end suite: a fake Muse Code CLI (an MSP host over
  stdio, a real executable on Windows) spawned by the real backend manager,
  covering a full turn, approvals allowed and rejected, refusal by mode,
  bypass, cancel, history, usage, and the drills (host death mid-turn, a
  malformed frame, a binary that will not start, no binary). Runs in the
  unit gate on every platform, no account needed.
- An opt-in live drill (`MUSE_LIVE_E2E=1 npm run test:e2e:live`): one
  reply-only turn on the real CLI in an empty workspace, with the model
  attempt count read from the CLI's trace log for the session and a
  budget of 40 (measured: 31, one for the answer and thirty for the CLI's
  bundled reminder agents).
- The user message's fork/rewind menu, as in Claude Code: one button
  opening **Fork conversation from here**, **Rewind code to here** (reverts
  every completed edit after that message, newest first, and reports the
  count) and **Fork conversation and rewind code**. Replaces the inline
  "Fork from here" button.
- Tests for the shell tool's error and stderr paths, the mention menu's
  mouse handling, the status line's timer and the effort dots.

### Changed

- The backend manager that spawns `muse serve` is covered by the e2e
  suite and no longer excluded from the coverage gate.
- The conversation controller depends on `AuthPort` and `DictationHandle`
  (the members it uses) instead of the classes; the two test casts are gone.
- `nextPermissionMode` wraps through a non-empty mode list; the type-only
  unreachable branch is gone.

### Removed

- `scripts/measure-markdown.mjs`, an M4 measurement wired to nothing (its
  numbers stay in `docs/certification/m4.md`).

## [0.3.0] - 2026-09-22

Harness parity with the Claude Code extension's preconfigured files
(PLAN.md D15).

### Added

- A four-step **Get started** walkthrough (what the agent is, open the
  panel, sign in, chat and sessions) that VS Code opens on install, and
  **Muse Spark: Open Walkthrough**.
- Commands: **New Conversation** (with an opt-in `Ctrl+N` / `Cmd+N`
  behind `museSpark.enableNewConversationShortcut`), **Sign Out**, **Open
  in Terminal** (the Muse Code CLI's own interface at the workspace root),
  **Create AGENTS.md** (`muse init` when the CLI is present and the
  workspace trusted, else the same template; an existing file is opened).
- Editor-tab conversations come back on their session after a window
  reload: the webview keeps its session id in VS Code's webview state and
  a panel serializer resumes it once signed in.
- Model API backend: the system prompt carries an environment section
  (today's date; git branch, changed-file count and latest commit subjects
  at session start) and working rules (read before editing, edits over
  rewrites, no commits or pushes unless asked, `path:line` references,
  short answers).

### Changed

- The settings that choose what runs and what is billed
  (`initialPermissionMode`, `backend`, `shellSandbox`,
  `allowDangerouslySkipPermissions`, `museBinaryPath`,
  `environmentVariables`) are machine-scoped: a repository's
  `.vscode/settings.json` can no longer set them. The Restricted Mode
  `restrictedConfigurations` list is gone with it (nothing left to
  restrict).
- Keybindings: `Alt+K` fires only with an editor focused, `Ctrl+Alt+F` only
  while a Muse panel or the chat view is focused.
- Starting a new conversation from the panel now tells the webview the
  session is gone (the model pill was already reset).

## [0.2.0] - 2026-09-22

### Fixed

- The Muse Code CLI is started with `--trust-workspace` when VS Code trusts
  the workspace, so the workspace's `AGENTS.md` rules and its
  `.agents/skills` project skills are loaded. They never were: `muse serve`
  skips both without the flag, and every session the extension had started
  since M1 ran without them (PLAN.md D13). Verified live on 2026-09-22 with
  an `AGENTS.md` rule and a project skill in a scratch workspace: before the
  fix the rule was ignored and the skill was `skillNotFound`; after it the
  reply ended with the rule's word and the skill ran.

### Added

- Model API backend: the workspace rules (`AGENTS.md`, `CLAUDE.md` where
  there is none, subdirectory files loaded when a tool first touches a path
  beneath them), the skills (project `.agents/skills` and the personal Muse
  root, a `read_skill` tool, `/id arguments` expanded with the skill's body,
  palette rows that follow the files) and the project memory index
  (`.agents/memory/MEMORY.md`) in the model's instructions, by Muse Code's
  conventions and size limits (`src/core/context/`).
- Workspace trust. The manifest declares `untrustedWorkspaces: limited`
  (in Restricted Mode no rules, skills or memory are loaded and no shell
  command runs on either backend; `museSpark.museBinaryPath` and
  `museSpark.environmentVariables` are not read from workspace settings
  there), `virtualWorkspaces: false` and `extensionKind: ["workspace"]`.
  Granting trust restarts the hosts, with a notice.
- Harness scenarios and screenshots for the sign-in gate (signed out, no
  CLI, waiting, error), recorded in `docs/certification/m7.md`.
- Model API conversations survive the window: each session is saved as a
  JSON file under VS Code's workspace storage for the extension after
  every change (turn, rename, model, effort, mode, fork), the History
  dialog lists stored sessions, and resume and fork bring them back with
  their transcript, replay and edit patches. A corrupt file is skipped
  with a log line; a failed save is logged and never fails a turn.
- The panel has an error boundary: a render error shows the message and a
  **Reload** button that rebuilds the webview document instead of a blank
  panel.
- `Muse Spark: Show Logs` opens the log channel; `Muse Spark: Diagnostics`
  writes a support report (versions, platform, remote, workspace trust,
  backend and sandbox settings, CLI location and version, credential
  presence as yes/no, dictation state) to the log and opens it.
- Repository governance: `SECURITY.md` (private vulnerability reporting
  is enabled on GitHub), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue
  and pull request templates, Dependabot (npm and Actions, weekly,
  grouped) and `CODEOWNERS`.
- `release.yml`: a `vX.Y.Z` tag runs the shared build, checks the tag
  against the manifest version, creates the GitHub Release with the
  `.vsix` and the CHANGELOG section as notes (`scripts/changelog-notes.mjs`),
  and publishes to the Marketplace when the `VSCE_PAT` repository secret
  is set (skipped and reported otherwise).

### Changed

- CI is the reusable `build.yml` (quality matrix, integration tests, the
  macOS helper, the `.vsix`, gitleaks, semgrep), called by `ci.yml` on
  pushes and pull requests and by `release.yml` on tags.

## [0.1.1] - 2026-09-22

### Changed

- The VS Code floor is `^1.125.0` (was `^1.134.0`, with `@types/vscode`
  pinned to match). A clean VS Code 1.130.0 (the owner's Windows 11 VM)
  refused to install 0.1.0 from the Marketplace as "not compatible"; the
  extension uses no API newer than 1.125, which the whole tree typechecks
  against, and the 1.134 floor had only come from the oldest typings on the
  registry at the time.
- README rewritten around the panel: banner, screenshots, highlights,
  quick start, then the reference sections; `media/readme/` holds the
  screenshots, `media/banner.svg` and `media/social-preview.svg` the brand
  art. `npm run images` (formerly `npm run icon`,
  `scripts/render-images.mjs`) renders the Marketplace icon, the banner and
  the GitHub social preview. Marketplace description, keywords and a dark
  gallery banner colour refreshed.
- No logo. The four-point sparkle of 0.1.0 is gone (it is Google's mark);
  the banner and the social image are typography only, and the Marketplace
  icon the listing requires is a plain "M" on the dark tile.

## [0.1.0] - 2026-09-22

The first release: milestones M0 to M9 of `PLAN.md`, both backends,
certified per milestone under `docs/certification/`.

### Added

- Milestone M9, voice dictation: a microphone in the composer ("Tap or
  hold to record (Ctrl+D)", the Claude Code gesture: tap toggles, hold
  records while held; `Ctrl+D` / `Cmd+D` in the composer and Space/Enter on
  the button do the same) that types recognised phrases at the caret, with
  "Starting the microphone…" / "Listening…" placeholders, a pulsing red
  mic, live-region announcements and a Getting-started tip. Recognition
  runs on the operating system's own engine in a helper process the
  extension keeps warm for five minutes: `native/windows/dictate.ps1`
  under Windows PowerShell 5.1 on `System.Speech` (verified 2026-09-22
  against a synthesised recording through the real Windows recogniser), and
  `native/darwin/muse-dictate`, a Swift helper on Apple's Speech framework
  compiled by CI's new `native-darwin` job and shipped by the new `package`
  job's `.vsix` artifact (run on the owner's Mac mini: a Mac without an
  input device gets an error line instead of an AVFAudio crash, the tap
  follows the hardware input format, start steps, levels and results are
  traced on stderr, `--input-device <UID>` pins the capture device, Apple
  chooses on-device or server recognition unless `--on-device` is given;
  Dictation or Siri must be on in System Settings). On Linux, and in a `.vsix` built without the
  macOS helper, the button is dimmed with the reason as its tooltip. No API
  cost, no third-party code, nothing sent to Meta. Gates: `lint:ps`
  (PSScriptAnalyzer over the helper script, real on Windows).
- Milestone M8, account & usage and packaging: an **Account & usage**
  dialog (palette row, `/usage`, `/cost`) showing the backend, the Muse Code
  subscription's current block and weekly window as bars with reset times
  and the observation age (MSP `usage/read`, live through `usage/changed`;
  verified live 2026-09-22 with the CLI on the owner's subscription), this
  conversation's input / output / cached tokens and context, and a link to
  the dev.meta.ai dashboard; a key-billed window says so instead of showing
  bars. Getting-started tips on the empty state with **Hide these tips**
  writing `museSpark.hideOnboarding`. A polite screen-reader live region
  announcing finished, failed and stopped turns, approval cards (with the
  tool), questions, resumes, warnings and errors. Packaging: a Marketplace
  icon (`media/icon.png`, rendered from `media/marketplace-icon.svg` by
  `npm run icon`; deliberately not Meta's logo), `vscode:prepublish`,
  `.vscodeignore` trimmed to the shipped files, `docs/PRIVACY.md`, and the
  Marketplace README. `npm run package` produces the `.vsix`; publishing
  (`vsce publish` with the owner's PAT) is a manual step.
- Milestone M7, the Meta Model API backend: with a pasted key the panel
  talks to `api.meta.ai/v1` itself (streamed `POST /responses`, stateless
  reasoning replay with `store: false`, the documented 429 / 500 / 503
  backoff with `Retry-After`) and runs its own tools (Read, Edit, Write,
  Search, List, PowerShell / bash, questions, task list) confined to the
  workspace, behind the same permission modes and approval cards; `/compact`
  summarises in one call; sessions, resume and fork for the window; the
  `museSpark.backend` setting (`auto` / `museCode` / `modelApi`), a Backend
  row in the palette, the sign-in gate offering the paths the selection
  allows (the key path works without the CLI), and a contributor-tier guard
  (one modal yes per conversation; hidden and refused in a confidential
  workspace) on both backends. The internal `AgentHost` / `AgentSession`
  protocol now sits between the controller and either backend.

- Milestone M6, sessions and history: a **History** dialog (header clock or
  `/` → Resume) over the workspace's stored Muse Code sessions
  (`session/list`, paged), grouped Today / Yesterday / Previous 7 days /
  Older with search on names and branches, relative times, turn counts and
  fork marks, live through `session/listChanged` / `session/closed`
  (`sessionListStream` capability); **Resume** rebuilds the transcript from
  the stored history (`session/resume` with `history: inline`, snapshot
  state when the host serves that; your messages as cards from their
  `displayText`, image chips from the attachment metadata) and continues the
  session live, seeding the model from the catalogue's active row and
  applying the surface's effort and permission mode; **Archive** /
  **Unarchive** per row and `museSpark.archiveInactiveSessions` (1 / 2 / 7 /
  14 days or never, default 14) kept in workspace state — hidden, never
  deleted; the sidebar resumes its last session when reopened within ten
  minutes of its last activity (Claude Code's rule), tabs always start
  fresh; **Rename** by clicking the header title (`session/rename`, the
  canonical name shown) and **Fork from here** on your messages
  (`session/fork` with the previous turn as the cut point; a fork before the
  first message is a new conversation) — both offered everywhere and
  refused by Muse Code 1.3.0 on Windows, which the panel reports as a
  notice; an unread badge on the hidden sidebar view and a `●` on a
  background tab when a turn completes or the agent waits for an approval
  or an answer; the tab and the view description follow the session name.

- `museSpark.shellSandbox` (`auto` / `muse` / `off`, default `auto`): how
  shell commands run. `auto` keeps Muse Code's OS sandbox except for a
  Windows workspace under the user profile, where the 1.3.0 sandbox cannot
  run commands in the project (meta-models/muse-code-sdk#26); there the host
  is started with `--disable-sandbox` and commands run directly as the user,
  in the project, still gated by the approval cards, as in Claude Code. The
  transcript explains the switch once per session; changing the setting
  restarts the host on the next message. Verified on the same workspace:
  `--disable-sandbox` runs `Get-Location` in the workspace in 14 s, the
  legacy shell tool does not help.

- Milestone M5, editor integration: the open-file chip beside the model pill
  (`App.tsx L5-10`, `×` to leave it out) sends the active file or selection
  with the message in Claude Code's own wording (`<ide_selection>` with the
  selected text, `<ide_opened_file>` for a bare file; excluded files share
  their path only) while `turn/start.displayText` keeps the transcript to
  what was typed; autosave of every dirty editor before a turn; **Open
  diff** and **Revert** on finished Edit / Write rows, rebuilt from the
  stored patch document through a `muse-edit:` content provider and
  `vscode.diff`, refusing when the file changed since; **Apply** on code
  blocks (replace the selection); a per-window IDE tool server (MCP over
  loopback HTTP with a bearer token, requested through the `sessionMcp`
  capability and registered with `session/start`) exposing `getDiagnostics`,
  the errors and warnings of the Problems panel. Harness scenario `editor`.
  Tool rows now label the CLI's `search` tool (`Search`, with its pattern)
  and the IDE tool (`Diagnostics`), both seen on the live M5 turns.

- Windows shell-sandbox setup from inside the extension (`PLAN.md` D12): when
  a chat opens, `muse sandbox windows check` runs once per extension host and
  a `setup_required` result raises a notification with _Set up now_ / _Not
  now_ / _Don't ask again_; _Set up now_ relaunches `muse sandbox windows
setup` through the UAC prompt, re-checks, and reports. The new command
  **Muse Spark: Set Up Shell Sandbox** runs the same flow on demand, and a
  shell tool failing with `sandbox enforcement unavailable` re-offers it. The
  transcript notice now names that command instead of a terminal recipe.
- Approval cards lock the decided stage until the host moves to the next
  stage or resolves the approval; the host was seen repeating
  `approval/updated` for an already-decided stage, and a second decision on
  it is rejected as `already resolved`.
- A one-time notice on Windows when the workspace is under the user profile
  and the CLI is 1.3.0 or older: that CLI's sandbox cannot enter
  `C:\Users\<you>`, so shell commands start in PowerShell's own folder (about
  34 s each) instead of the project; file tools are unaffected. Verified
  through the panel's controller and through `muse exec` alike.

### Verified

- Live shell approvals through the panel after the owner's sandbox setup:
  a two-stage `allow_once` line ran inside the sandbox and an `abort` with
  feedback was honoured (`docs/certification/m4.md`). `reasoning` items with
  `summary.N` deltas appeared on those turns, so the reasoning row is
  live-exercised.

- Milestone M4, transcript rendering: assistant replies as GitHub-flavoured
  markdown (react-markdown 10.1.0 + remark-gfm 4.0.1; raw HTML never
  rendered, images as alt text, links through the host with an
  http/https/mailto allow list) with highlighted fenced code (highlight.js
  11.12.0 core, 18 grammars, Copy and Insert at cursor); tool rows for every
  `toolCall` item (`Read` / `Edit` / `Write` / `PowerShell` / `Bash` /
  `Question`, status dot, `Added N lines` / `Removed N lines` / `Modified`
  from `patchSummary`, line-numbered diffs from the stored `tool_patch`
  document via `item/readOutput` with the edit tool's unified `visibleOutput`
  as the interim view, `IN` / `OUT` boxes for shell tools, clipped outputs
  with Show more, generic rows for unknown tools and item kinds); reasoning
  rows ("Thought for Ns", summary parts); approval cards from
  `approval/requested` → `approval/decide`, following multi-stage
  `approval/updated` (step n of N) with the CLI's own choices and optional
  feedback; question cards for `request_user_input` → `userInput/answer`
  (single, multiple, free text); the pinned task list
  (`session/todoListChanged`); retry notices (`turn/retryScheduled`); the
  session name in the header (`session/nameChanged`); the context-window
  indicator in the composer; a status line with a rotating verb while a turn
  runs; image chips inside user cards; Focus view folding steps behind one
  expandable row (a card waiting on the user is never hidden). The `initialize`
  handshake now declares `userInputDialogs`, `HAS_APPROVAL_UI` is on so
  Manual / Edit automatically / Auto run as their real MSP modes, and the
  `approval/request` / `userInput/request` server requests are declined
  quietly because the commands settle them. A one-time notice explains
  `muse sandbox windows setup` when the shell tool reports the sandbox is not
  set up. Harness scenarios `markdown`, `tools`, `approval`, `question`,
  `todo`, `focus`, `long`; `scripts/measure-markdown.mjs` for render cost.

- The permission-mode button opens a **Modes** menu (Manual / Edit
  automatically / Plan / Auto with one-line descriptions, `⇧ + tab to switch`,
  a tick on the current mode, and an `Effort (level)` row with the dots in
  the footer), matching the Claude Code popout; the palette's "Permission
  mode" row opens the same menu. Shift+Tab still cycles.
- `museSpark.allowDangerouslySkipPermissions` (default off): lists Bypass
  permissions in the Modes menu and the cycle, as the Claude Code setting of
  the same name does. While off, the host refuses `bypassPermissions` with a
  notice, and `initialPermissionMode: bypassPermissions` starts in Manual with
  a logged warning. Replaces the modal confirmation.
- The `+` button opens an attach menu: _Upload from computer_ (the native
  dialog) and _Add context_ (starts an `@` mention at the caret).
- Effort tiers verified live per model (one turn per tier through Muse Code
  1.3.0; `PLAN.md` D10): the slider offers Minimal / Low / Medium / High /
  Extra high / Max on `muse-spark-1.3` and stops at Extra high on
  `muse-spark-1.2`, which rejects `max` with a 400; every dot names its tier
  in a tooltip and to assistive technology, and switching to a model that
  does not serve the current tier drops to the highest tier it does.
- The composer placeholder reads "Queue another message…" while a turn runs.
- The Meta logo the owner supplied is the brand mark in the panel's empty
  state and the activity-bar icon (`media/icon.svg`, single-colour mask).
- Harness scenarios `modes`, `modes-bypass`, `attach`, `add-context`; the
  owner's Claude Code reference screenshots under `docs/reference/`.

- Milestone M3, composer and command palette parity: the "/" palette
  ("Filter actions…"; Context / Model / Customize / Account & usage / Skills /
  Slash commands / Support; keyboard-only operation; opens from the "/" key
  on an empty draft or the slash button), "+" attach (native file dialog;
  PNG/JPEG/GIF/WebP become `name W×H` chips sent as MSP image parts, other
  files become `@path` mentions), paste and drop of images, drop of editor
  resources as mentions, `@` mention autocomplete over a `git ls-files`
  index (`.gitignore` respected, VS Code file search as the fallback), the
  model pill + picker (`model/list`, `session/setModel`, context window shown
  as "1M"), the effort slider (Low … Max → `session/setReasoningEffort`,
  default High like the CLI) and Thinking toggle (Ctrl+O; off sends `none`),
  the permission-mode button and Shift+Tab cycle (Manual / Edit automatically
  / Plan / Auto / Bypass permissions; Bypass asks for confirmation), skills
  from `skill/list` typed as `/selector args` and sent as skill parts, Enter
  while a turn runs steering that turn (`turn/steer`) with a fresh-turn
  fallback, `/clear`, `/compact`, sign-out and host notices in the transcript.
  Until the approval cards land (M4) every permission mode except Bypass
  still runs as `denyUnmatched`; the mapping is recorded in PLAN.md D7.
- `npm run harness:shots` (`scripts/harness-shots.mjs` + `test/harness/`):
  renders the built webview in headless Chrome behind a scripted fake host and
  writes one screenshot per scenario (palette, model list, pill toggle,
  mentions, chips, transcript, Shift+Tab, effort filter). The visual check
  behind the certification records.
- The header's new-conversation button now starts a new conversation in the
  same panel (Claude Code behaviour); a new editor tab remains available via
  `Ctrl+Shift+Esc` and the view-title `+`. The `openNewTab` webview message
  was removed.
- Milestone M2, sign-in and the Muse Code backend: locating the CLI per
  platform (Windows `muse-bin-<version>.exe` from `.muse-version`, PowerShell
  launcher fallback, POSIX `~/.local/bin/muse`), a sanitised child environment
  (Windows `PSModulePath`, optional `META_API_KEY`), `muse serve` spawned
  through `@muse-code/sdk` with a host wrapper that multiplexes one MSP
  session per panel; sign-in gate with browser (`muse login` in a terminal +
  credential-file watch) and API-key (secret storage) paths, sign-out, and the
  host's `authRequired` verdict overriding the presence check; optimistic
  message echo with `turnAccepted` / `sendFailed`, streamed replies, Stop,
  session model in the pill, token and context usage tracking. Unmatched
  approvals are denied until the approval cards ship (M4).
- Milestone M1, panel shell: header with Focus-view badge, history (disabled
  until M6) and new-conversation buttons; empty state with the
  "Type /model…" hint; composer with Enter / Shift+Enter / optional
  Ctrl+Enter semantics, auto-growing textarea, attach and slash buttons
  (disabled until M3), model pill, permission-mode label and Send (disabled
  until M2).
- Keybindings mirroring Claude Code: `Ctrl+Esc` toggle focus, `Ctrl+Shift+Esc`
  new tab, `Alt+K` insert `@path#lines` for the selection, `Ctrl+Alt+F` toggle
  Focus view; `+` in the sidebar view title opens a new tab.
- `museSpark.*` settings (`preferredLocation`, `initialPermissionMode`,
  `autosave`, `attachOpenFile`, `useCtrlEnterToSend`, `hideOnboarding`,
  `focusView`, `respectGitIgnore`, `confidentialWorkspace`, `museBinaryPath`,
  `environmentVariables`) validated at read time and pushed live to open
  panels.
- Redacting logger (Meta API keys, bearer tokens, `META_API_KEY=` /
  `MODEL_API_KEY=` assignments) in front of the output channel; typed
  host ⇄ webview messages (`init`, `settingsChanged`, `focusInput`,
  `insertText`, `ready`, `inputFocusChanged`, `openNewTab`).

### Fixed

- **Billing**: the Model API key pasted into the panel is no longer handed
  to the Muse Code CLI. The CLI prefers `META_API_KEY` over its own sign-in,
  so subscription work was billed to the key whenever one was stored. The
  CLI now runs on its own credential only; the pasted key drives only the
  Model API backend. Verified live with no key anywhere
  (`docs/certification/m7.md`).
- The History button toggles the dialog closed as well as open (its click
  used to blur the search box shut and reopen it), and the dialog hangs
  from the header rather than rising from the composer.
- The composer toolbar fits a narrow sidebar: the model pill ellipsizes
  instead of clipping both ends (it was a centred flex row), the open-file
  chip shrinks, the right-hand group keeps the mode button and Send whole,
  and under 340 px the context percentage and the mode label give way to
  their icons.

### Changed

- The model pill reads `model effort` (the context window moved to the model
  list rows), and it hugs its text instead of the 26 px control height.
- Toggle Thinking is `Ctrl+Alt+T` on Windows, `Option+T` on macOS (the Claude
  Code binding) and `Ctrl+Alt+O` on Linux instead of `Ctrl+O`; the owner found
  `Alt+T` opens the Windows Terminal menu before the composer sees it.

### Fixed

- The model pill and the slash button now toggle: a second click closes the
  list or palette (a mousedown on either no longer blurs the palette shut).
- The extension version label in the panel's corner overlapped the Send
  button and carried no information the Extensions view does not; removed,
  along with the `extensionVersion` field of the `init` message.
- The "/" palette and the model list were positioned against the whole panel
  and rendered above the viewport, so `/`, the slash button and the model
  pill appeared to do nothing in the first M3 F5 check; both now anchor to a
  wrapper around the composer.

### Security

- GitHub Actions pinned to full commit SHAs and npm given a minimum release
  age of 7 days, both raised as blocking findings by the semgrep CI job.

### Added

- Project scaffold (milestone M0): TypeScript 6.0.3 extension host + React 19
  webview bundled with esbuild; strict type-checked ESLint 10 (typescript-eslint
  `strictTypeChecked`, unicorn, react-hooks), Prettier, stylelint, knip, dpdm,
  jscpd, vitest with coverage thresholds, `@vscode/test-cli` integration tests,
  gitleaks, npm audit, husky + lint-staged pre-commit, GitHub Actions CI
  (ubuntu + windows quality matrix, gitleaks, semgrep).
- Minimal extension: `Muse Spark` activity-bar container with a `Chat` webview
  view, `Muse Spark: Open in New Tab` and `Muse Spark: Open in Sidebar`
  commands, nonce-based CSP, zod-validated host/webview message contract, and
  an empty-state shell ("Type /model to pick the right tool for the job.").
- `docs/certification/m0.md`: every gate run on the scaffold and proven to fail
  on a deliberate break. Findings: `knip --strict` analysed nothing (strict
  implies production mode, which needs `!` entries) so the gate is plain `knip`;
  the integration tab test polls `tabGroups` instead of reading it synchronously;
  `npm audit` high in the dev-only mocha chain resolved with `overrides`.
- `PLAN.md` with research notes (Meta Model API, Muse Code SDK / MSP, Claude
  Code extension parity inventory), architecture, decisions, and milestones
  M0–M8.

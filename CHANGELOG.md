# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Entries record what actually
happened, not what was planned; superseded entries are kept.

## [Unreleased]

Three paid extras of Meta's Model API, off until you turn them on, and loud
while they are (PLAN.md D30, D34).

### Added

- **Image edits** (M44, PLAN.md D37). With image generation on, the model
  can also change one workspace image, or combine up to four, by a prompt,
  into a new PNG (`edit_image`, Meta's `/images/edits`, $0.01 per image).
  The card names the images it starts from; everything that could fail is
  checked before anything is asked or billed.
- **Images and Muse Voice on the Muse Code backend** (M44). While a Model
  API key is stored, the extension's own `ide` tool server offers Muse Code
  an image and an image-edit tool, and the microphone can use Muse Voice:
  billed to the key, never to the subscription, each image confirmed with
  its price first, the rows marked paid, and the tally in Account & usage.
  The key never reaches the Muse Code CLI.
- **A row for every tool Muse Code runs** (M43, PLAN.md D36). Memory rows
  show the note and where it lives, and an edit as the text replaced; goal
  rows show the objective, its status, a progress bar, what is being done
  now and next, and the tokens spent; scheduled prompts show their
  schedule, next run and how often they ran; web search shows its results
  as links with snippets, on both backends; a picture the agent read, or
  the Model API backend made, shows in its row. Every other tool in Muse
  Code's list has a name, an MCP tool reads "tool (server)", and any other
  result is indented JSON. All built from a live capture of Muse Code 1.3.0.
- **Web search** (M33). With `museSpark.modelApiWebSearch` on, the model can
  search the web on the Model API backend ($2.50 per 1,000 searches). Each
  search is a row marked paid with its query and results, and a reply lists
  the pages it cites under it (also in `/export`).
- **Image generation** (M34). With `museSpark.modelApiImageGeneration` on,
  the model can create a PNG in the workspace with `muse-image-1.0` ($0.01
  per image). Every image asks first, in every permission mode, Bypass
  included, showing the prompt and the price, with no "always allow"; Plan
  refuses it. A path that is taken, outside the workspace or not a `.png`
  is refused before anything is billed, and a new image never overwrites a
  file.
- **Muse Voice** (M35). With `museSpark.modelApiVoice` on, the microphone
  records for Meta's Muse Voice Transcribe instead of your computer's own
  recogniser ($0.18 per hour of audio), streamed as you speak; the
  transcript lands at the caret. The recorder is `native/windows/capture.ps1`
  on Windows, the macOS helper's new `--capture` mode, and `arecord` or
  `parec` on Linux, which gets a microphone for the first time.
- **Opt in and loud, for all three.** Off by default and machine-scoped; a
  confirmation names the price when one is turned on, from the palette's new
  toggles or in settings, and declining it turns the setting back off. The
  composer's badge names what is on, the microphone says when it is paid,
  and Account & usage tallies this window's searches, images and seconds of
  audio with their estimated cost.
- **A languages badge** in the README.
- **Groundwork for editors other than VS Code** (M60, M61, PLAN.md D60).
  The owner's IDE compatibility plan is filed in `docs/ide-compatibility.md`.
  A new gate, `npm run check:host-api`, keeps a record of what the
  extension asks of its host (`docs/ide-compatibility/host-api.md`): the
  198 VS Code APIs it uses and where, the 11 files that import `vscode`,
  the Node built-ins, and what the webview needs (`acquireVsCodeApi` and 57
  theme variables); it fails when the record goes stale, and when the
  engine, the protocol, the webview, the conversation controller, either
  backend or the credential store reaches `vscode`. The webview now talks
  to VS Code through one host bridge, and the chat surface, the log and the
  dictation setup carry no VS Code types. Nothing changes in VS Code.
- **Muse Spark for editors that speak ACP** (M63, PLAN.md D61, D62).
  `muse-spark-code-acp`, an npm package attached to each GitHub Release,
  runs Muse Code or the Model API as an Agent Client Protocol agent for
  Zed, JetBrains IDEs, Neovim, Emacs and the other ACP editors: the chat,
  tool calls with diffs, the plan, permission prompts (a cancelled or
  unknown answer rejects), questions as forms, the modes, the model and
  effort, skills as commands, and sessions listed, loaded and resumed. The
  backend is chosen when the editor starts it and never switches.
  `muse-spark-code-acp auth set` keeps a Model API key in the operating
  system's credential store (Windows Credential Manager, the macOS
  Keychain, the Secret Service on Linux, with no plaintext fallback); the
  key is never read from the environment or passed to Muse Code. Paid
  features stay off in the agent. See `docs/acp.md`; which editors have
  been tried is tracked in `docs/ide-compatibility/hosts.md` (none yet).
- **Open VSX and npm publishing** in the release workflow. A tag also
  publishes the VSIX to Open VSX, for VS Code forks that install from
  there, and the agent to npm, each only when its token is set in the
  `marketplace` environment.

### Fixed

- **A command Muse Code moved to the background read "Interrupted"** when
  its turn ended (M43). It now shows what it printed, says it is still
  running, and is listed among the background tasks.
- **Model API conversations that narrate before a tool** (M42, PLAN.md D35).
  Text the model writes before a tool call is replayed as commentary, as
  Meta requires; replayed as an answer, it made the next request fail with
  a 400. A reasoning item is replayed with its summary (empty when there was
  none), and a reply that was reasoning alone is followed by the minimal
  message the docs ask for.
- **A server that stops mid-reply** (M42). A stream that ends because the
  instance shut down or was overloaded is sent again, with the retry notice
  in the transcript; a 502 is retried like the other server errors.
- **PLAN.md's 0.8.0 record** now has the release's facts.

## [0.8.0] - 2026-09-25

The panel in VS Code's display languages: fourteen of them, machine-made
and checked by a gate of their own, with the model's side kept in English.

### Added

- **The panel in fourteen languages** (M40, PLAN.md D33). The panel, its
  notices, the Command Palette's commands and the settings follow VS Code's
  display language: Simplified and Traditional Chinese, Japanese, Korean,
  German, French, Spanish, Brazilian Portuguese, Russian, Italian, Turkish,
  Polish, Czech and Hungarian. Any other language gets English.
  - **Machine-made**, and checked by the localization gate rather than by
    native speakers; the README says how to report a wrong one.
  - **Still English:** text sent to the model, and what Muse and the tools
    write.

### Changed

- **The groundwork for the panel in VS Code's display languages** (M40,
  PLAN.md D33). The panel still reads in English until the translations
  land; what changed underneath:
  - **Whole sentences:** every text the user reads is in one table
    (`src/shared/l10n/en.ts`). A sentence built around a value is one
    template, so a language can put the value where its grammar needs it,
    and a count picks its form by the language's own plural rules.
  - **The manifest:** the Command Palette's commands, the settings and the
    walkthrough take their text from `package.nls.json`.
  - **Text for the model stays English:** what goes to the model is kept
    apart, so the model behaves the same in every display language.
  - **One file at a time:** the host loads the table for VS Code's display
    language and hands it to each panel. A missing or damaged table falls
    back to English, and the log says so.
  - **`<html lang>`:** the panel declares its language to screen readers.
- **Numbers, money and times follow the display language's conventions**
  (`Intl`). In English that changes a few:
  - History's times read "5 min. ago", "3 hr. ago", "yesterday".
  - The usage window's reset reads "2h 5m".
  - A failed Muse Code or sandbox run names its "exit code".

### Fixed

- The Modes menu's highlighted row showed its detail line below 4.5:1
  contrast in the Dark Modern theme (WCAG 1.4.3), as M37 had fixed for the
  palette; it takes the row's own text colour.
- A token count just under a million read "1000K"; it reads "1M".
- Accessibility, found by checking the panel in a pseudo-locale:
  - The palette's and History's search box kept pointing at a list that a
    search matching nothing had removed (`aria-controls`, WCAG 4.1.2). It
    now controls a list only while one is shown.
  - A code block's Copy, Insert and Apply buttons are 24 px targets; with
    longer labels, spacing alone no longer made up for their height (WCAG
    2.5.8).
- The Agent map showed a background task's raw status ("inProgress"); it
  reads "running", like the agents above it.
- The hooks view counted "3 in your settings"; it says "3 hooks in your
  settings".

## [0.7.1] - 2026-09-25

The new mark on the Marketplace listing, the README rewritten for 0.7.0,
and a false failure in the log fixed.

### Changed

- The Marketplace icon, the README banner and the social preview carry a
  squiggled, handwritten blue "m" in the manner of Muse's own mark, in place of
  the plain "M" (at the owner's direction). It is drawn from a curve, not
  traced from Meta's mark.
- The README is rewritten for 0.7.0: a contents list, what is new, the
  limits, accessibility, the protected writes, and the corrections below.
- A file the Model API tools refuse as too large now says to read part of it
  with a shell command; it no longer suggests the search tool, which skips
  files over 1 MiB.
- Setting descriptions: `attachOpenFile` says it also hides the open-file
  chip and sends neither the file nor the selection when off;
  `cleanupPeriodDays` deletes when a window lists the conversations, not
  when it opens them; `backend`'s `auto` falls back to Muse Code's sign-in
  when no key is stored.

### Fixed

- `npm run security:sast` finds a semgrep that pip installed into Python's
  user Scripts folder when that folder is not on the shell's PATH (an
  editor started before it was added), instead of failing with "semgrep is
  not recognized".
- Resizing the sidebar while the prompt held a draft of several lines could
  log a false panel failure ("ResizeObserver loop completed with undelivered
  notifications"): the prompt refitted its height inside the browser's own
  resize callback. It now refits on the next frame.
- The UI harness's `chips` scenario had clicked a button renamed before the
  first release, so it never picked a file; it now uses the Attach menu.
- Four scenarios of the UI harness (`filter`, `agents-off`, `usage-api`,
  `usage`) had failed since M38, when a typed `/` stopped showing the
  palette's filter box, and the accessibility gate checked whatever the
  broken step left on screen. They open the palette from its button again,
  and a scenario that throws now fails the gate.

## [0.7.0] - 2026-09-25

What can be built now without Meta: Muse Code's skills, MCP servers, hooks
and worktrees from the panel, conversations exported, a rewind that finds an
edit that moved, an accessibility gate on every screen, `/` as in Claude
Code, and a log that tells a session's story.

### Added

- **MCP servers…** and **Hooks…** (palette and Command Palette, CLI
  backend):
  - The MCP view lists what Muse Code will load from its settings: each
    server's transport, where it points, whether it is required, and the
    names (never the values) of its environment variables and headers.
  - A remote server can be signed in to or out of through `muse mcp login`
    or `logout` in a terminal.
  - It warns out loud about the two settings mistakes that make Muse Code
    load no server at all.
  - The hooks view shows the project's, your own and managed hooks and
    opens each file.
  - Both views are read-only; the extension never edits Muse Code's
    settings.
- **New worktree…** starts a branch in a folder beside the repository and
  opens it in a new window. **Remove a worktree…** deletes another
  worktree's folder (the branch stays), and asks a second time before
  discarding uncommitted changes.

- **Manage skills…** (palette and Command Palette, CLI backend): a
  checklist of every skill Muse Code knows, built-in, yours, the project's
  and plugins'; unchecking one turns it off through `muse skills disable`.
  Muse Code reads skill changes when it starts, so the change ends with an
  offer to restart it, and the conversation continues on the next message.
- **Import skills…**: shows what `muse skills import` would copy from
  Claude Code or Codex into your Muse skills folder, imports it once you
  confirm, and reports what was imported, skipped or failed.
- "Continue a Claude Code session" and "Continue a Codex session" in the
  palette's Context group, where the session offers Muse Code's
  `resume-claude` and `resume-codex` skills.
- `/export` and **Muse Spark: Export Conversation** save the conversation as
  Markdown (messages, thinking, tool calls with their arguments and visible
  output) where you choose, on both backends; on the CLI backend **Export
  session log…** saves Muse Code's own JSON record of the session through
  `muse export`. An export asked for while a reply runs is refused, with a
  note to export once it has finished (corrected after release: this entry
  said it waited), and a conversation too long for Muse Code to replay is
  pointed to the session log instead of being written as an empty file.

- **Delete** in the History dialog archives the highlighted conversation, or
  restores an archived one, while the search box is empty.
- An accessibility gate: every screen of the panel's test harness is checked
  with axe-core against WCAG 2.2 AA in VS Code's four default themes, with
  colours read from a real VS Code, and any violation fails the build.

### Security

- On the Model API backend a write under `.muse/` asks in every mode but
  Bypass, like `.git` and `.vscode`: `.muse/hooks.json` names commands Muse
  Code runs outside its sandbox and approvals, so an agent on the key could
  otherwise have planted one without asking. Muse Code itself already asks
  before writing it (checked live with 1.3.0).

### Fixed

- A Model API reply whose stream sends nothing for five minutes ends, saying
  so, instead of holding the turn until Stop.
- The file tools refuse a file over 10 MiB before loading it, rather than
  holding any file whole.
- Opened tool-output documents are limited to 32 million characters
  together, as well as 20.
- An image that cannot be read says so in the banner.
- A rewind whose file cannot be read (a permission problem) says why,
  instead of "no longer matches".
- A Muse Code install that cannot be read is named in the log, instead of
  looking like no install at all.
- Accessibility (WCAG 2.2 AA):
  - Diff line numbers, a failed tool's reason and the detail line of a
    selected menu row now meet 4.5:1 contrast in every default theme. A
    failure keeps its red as a bar beside the reason.
  - The palette's and History's lists can be scrolled from the keyboard:
    each is a Tab stop, the dialog stays open while the focus is in it,
    and Escape works from there.
  - Screen readers no longer meet buttons nested inside list rows. The
    effort row is set with Left and Right, and History rows archive with
    Delete; the dots and the × remain for the mouse.
  - Question answers have 24 px rows, so each radio or checkbox is easy to
    hit, and each effort dot in the Modes menu is a 24 px target.
- **Rewind code to here** no longer skips an edit just because you added or
  removed lines above it since. The edit's own lines, matched exactly, are
  found where they moved to when they appear in exactly one place. An edit
  whose lines you changed, or whose lines appear more than once, is still
  refused with the reason, never guessed at.
- A path with a typographic apostrophe, such as `C:\Users\O’Brien`, no
  longer breaks the Windows job helper's PowerShell scripts. PowerShell
  reads ‘ ’ ‚ ‛ as quote characters, and only the plain `'` was being
  escaped.
- The terminals the extension opens (sign-in, Open in Terminal, MCP
  sign-in) single-quote the CLI's path and every argument for the shell
  they run, so nothing in them is expanded.
- On macOS, dictation from the panel asks for speech recognition and the
  microphone as the helper itself (muse-dictate, with its own usage
  descriptions) instead of as Visual Studio Code, which declares no
  speech-recognition purpose and so was refused without being asked
  (microsoft/vscode#307364). The grants cover the helper alone; an update
  that changes the helper asks again.

### Changed

- **The log tells the whole story** (Muse Spark: Show Logs):
  - **Failures:** every failure the panel or a popup showed, and any that
    failed unseen, with a stack where there is one. That covers panel
    actions, commands, background restarts and errors inside the panel
    itself. The panel reports its errors at most ten a minute.
  - **Sessions and turns:** each session started, resumed or forked, with
    its id. Each turn with its result, duration and time to first output.
  - **Also:** approvals (the tool and the answer), sign-in changes, the
    backend in use, and why the backends restarted.
  - **At Trace level:** each Muse Code command's and Model API request's
    time.
  - **Never logged:** prompt text, file contents, dictated words and model
    output. An invalid setting now warns once, not on every read.
- **Faster when replies stream:** streamed text reaches the panel at most once
  a frame, and the panel stops saving its state every second while a reply
  streams (it saves when the turn ends).
- **Smaller:**
  - The Model API's git facts are gathered in parallel.
  - The editor selection is read once it settles, not on every arrow key.
  - Tool output previews are cut at 2,000 characters as well as 12 lines.
  - The diagnostics server starts when a session first needs it.
- **`/` in the prompt** works as in Claude Code. A `/` on an empty prompt
  stays in the box and shows the palette above it, and the box keeps the
  keyboard: Up and Down, `Enter` and `Esc` work the palette. Type a letter
  more and the palette gives way to a list of slash commands narrowed as you
  type, names that start with your letters first. `Enter` runs a command,
  or completes a skill so you can add its arguments; `Tab` completes the
  name. New names in that list: `/model`, `/resume`, `/permissions`,
  `/config`, and `/mcp` and `/hooks` on the CLI backend. The `/` button
  still opens the palette with its own filter box.
- The Agent map and the header's agents pill show running and finished
  agents in the panel's blue, as a running tool's dot is, instead of green.
- The Marketplace publish runs in a `marketplace` environment that only
  version tags can use, holding the publishing token; no other workflow
  run can read it.

## [0.6.0] - 2026-09-23

The hardening release: the findings of a full audit of the code against
other harnesses' bug trackers and the platform documentation, fixed.

### Security

- The Model API backend's file tools resolve every path through the file
  system before using it: a symbolic link or junction inside the workspace
  that leads outside it is refused, for reads as well as writes, and the
  search skips such files. Edit Review and the rewind check the same way
  before writing a file back. Windows alternate data streams (`a.txt:x`),
  device names (`NUL`, `COM1`) and names ending in a dot or a space are
  refused.
- On the Model API backend, a committed `AGENTS.md`, `CLAUDE.md`, memory
  index or project skill that is a link leading outside the workspace is
  skipped, with the reason in the log; its target used to reach the model.
- Protected writes: on the Model API backend, writing git's hooks and
  config, `.husky`, `.vscode`, `.idea`, `.devcontainer`, CI workflows,
  `.agents`, `AGENTS.md`, `CLAUDE.md`, `.envrc` or `.gitmodules` shows an
  approval card in every mode but Bypass, whatever the session's "always
  allow" rules say. Auto used to write them without asking.
- No `git` in Restricted Mode: a repository's own `.git/config` can name
  programs git runs, and the `@` mention index and the Model API prompt ran
  git status and log on the first message in an untrusted folder. git, bash
  and PowerShell are now started by absolute path from absolute `PATH`
  entries only (never a copy inside the workspace), and the Muse Code CLI
  search skips empty and relative `PATH` entries too; a relative
  `museBinaryPath` is refused. git runs with a 15-second timeout and without
  taking the index lock (`GIT_OPTIONAL_LOCKS=0`).
- "Always allow in this session" on a shell command now allows that exact
  command line, not every later command. An approval choice the card never
  offered is refused instead of counting as a yes.
- Bypass permissions ends in every open conversation as soon as
  `allowDangerouslySkipPermissions` is turned off. In a remote window (where
  a dev container definition can write machine settings) a conversation
  never starts in Bypass, and entering it asks once.
- Resuming a conversation that ran on a contributor-tier model asks as
  choosing one does, or, in a confidential workspace, moves it to a
  standard model.
- The shell tool's environment drops the editor's internal variables
  (`ELECTRON_RUN_AS_NODE`, `VSCODE_*` IPC handles) exactly as VS Code's own
  terminal does, and Windows PowerShell gets its own module path.
- The log redacts JWTs, basic credentials, token and password fields and
  credentials in URLs; a `muse serve` stderr chunk is capped in the log;
  the diagnostics report writes the home directory as `~`.
- The release workflow checks the tag (manifest version, on `main`) before
  building, hands the Marketplace token to one step after an install that
  runs no package scripts, and keeps no token in checkouts.
- `npm audit` still blocks releases, with a reviewed, expiring exception
  list for advisories that have no fix.

### Added

- `THIRD_PARTY_NOTICES.txt` ships in the package.
- `museSpark.cleanupPeriodDays` (default 30, as Claude Code's
  `cleanupPeriodDays`): Model API conversations idle longer are deleted
  when a window lists them; 0 keeps them.

### Fixed

- **Edit automatically** now does what it says: plain file-write approvals
  are answered for you (the row says "Edit automatically"); protected
  writes, escalations and commands still show the card. It behaved like
  Manual before.
- The `search` and `list_files` glob no longer builds a regular expression:
  a crafted 37-character pattern held the extension host for 25 seconds.
  Matching is linear, `[!x]` negates and braces nest.
- The Modes menu describes each mode truthfully per backend (Muse Code's
  Manual applies in-workspace edits without asking; the Model API's Auto
  has no safety-check model).
- On Windows the focus and new-tab shortcuts are `Ctrl+Alt+Esc` and
  `Ctrl+Shift+Alt+Esc`; Windows takes `Ctrl+Esc` and `Ctrl+Shift+Esc`
  itself. The walkthrough, the getting-started tips and the composer's
  placeholder name them.
- Dictation says why it is unavailable in a remote window; the Windows
  helper no longer inherits PowerShell 7's module path; a write to a dead
  helper no longer throws.
- On macOS, dictation names the app macOS asks, separates speech from
  microphone refusals, and explains an early exit.
- The crash screen's **Reload** brings the conversation back as it was: the
  transcript, a waiting approval or question and the running turn. A state
  that crashes the panel twice is dropped instead of looping.
- A stopped or failed turn no longer leaves the reply streaming, tools
  running or cards clickable; a tool it cut off reads "Interrupted".
- "Rewind code to here" no longer unwinds a subagent's earlier edits after
  the Agent map has read the agent's transcript.
- **New Conversation** from its keybinding clears the panel too, and acts on
  the panel you last used.
- With an input method (Chinese, Japanese, Korean), Enter commits the
  candidate instead of sending the message or picking a mention.
- Typing and streaming no longer re-render the whole transcript; a code
  block being written is highlighted once, when it is complete.
- A resumed conversation's thoughts read "Thought", not "Thinking…".
- The transcript stays at the end when its content grows without a new row.
- A tab restored after a window reload keeps its conversation until the
  resume succeeds.
- A refused message's images no longer linger unseen in the panel's host;
  they come back to the composer when the host still holds them.
- A question card posts one answer however often Submit is pressed, and
  opens again when the answer is refused.
- Screen readers get one announcement per event.
- Dialogs keep Tab inside and the chat behind them is inert; message menus
  close on a click outside; right-click on a selection offers **Copy**.
- The History dialog's keys keep working after **Show archived**.
- Images over 10 MB, or past 20, are refused before they are read, and the
  banner says why.
- Relative links in a reply open the workspace file at the lines they name.
- Right-to-left text reads right to left.
- Reduced motion stops every animation.
- Tasks with the same text no longer collide; approval feedback starts empty
  on each step; Windows line ends no longer show in diffs; diffs over 256 KB
  keep their line numbers.
- A shell command that times out or is stopped now ends with everything it
  started (a process group on macOS and Linux, `taskkill /T` on Windows),
  and a command that leaves a background process running (`server &`)
  returns when it exits instead of holding the turn open; Stop reaches a
  running command. A flood of output keeps its beginning and its end. On
  Windows each command runs in a job object of its own, so Stop and a
  timeout end everything it started at once, including a program it was
  starting at that moment and one a launcher left behind (`taskkill` missed
  those: they ran on, and one stayed suspended for good); a command that
  ends normally still leaves its background processes running. Where
  Windows policy forbids the job helper, the log says so and a sweep of the
  process table stands in.
- A restart the extension makes (trust granted, a setting changed, a
  sign-in) no longer looks like a crash that blocks every panel: the running
  turn is cancelled, and the next message continues the same conversation.
  After a real crash the turn ends with the reason and the next message
  restarts Muse Code and continues; only an exit that restarting cannot fix
  (a configuration Muse Code refuses, a build without the SDK surface) is
  shown as an error.
- Muse Code gets deadlines: 30 seconds to start, 60 per command (three
  minutes to load, copy or compact a session), so a wedged CLI no longer
  hangs sign-in, switching or sign-out.
- When Muse Code closes or evicts a session, the next message resumes it
  instead of failing; two quick messages start one session; two panels on
  the same session no longer silence (or, on the Model API backend, cancel)
  each other when one closes; a panel closed while its session starts keeps
  nothing running.
- Signing in with the browser waits for a new sign-in, not a stale
  credential file, and pressing the button twice opens one terminal; a
  broken OS keyring no longer blocks the Muse Code backend.
- Model API retries show in the transcript ("Attempt 2/5 failed …"), Stop
  cuts a retry wait short, and a `Retry-After` given as a date is honoured.
- The IDE tool server restarts if its first start failed, and the session
  that needed it waits for it; a failing request answers 500.
- **New Conversation** after a crash or a restart starts a new session
  instead of continuing the old one with its first message.
- Resuming a conversation that was waiting on an approval or a question
  shows its card again, and a turn that was running when you resumed can be
  stopped and steered. Each prompt shows one card, however often Muse Code
  announces it, and a second panel on the same conversation sees the cards
  still open.
- A decision or answer that arrives after the request moved on says so as
  information instead of an error; a refused decision opens the card again;
  a request Muse Code no longer holds loses its card. A step already closed
  by an "always" decision is no longer asked again.
- Updates Muse Code could not deliver are recovered by reloading the
  conversation; a queued message Muse Code withdrew reads "Not sent"; a
  model the account cannot serve, and a message another client withdrew,
  are notices. Unexpected notifications are logged once each.
- On the Model API backend, a tool that fails (a missing folder, a disk
  error) or a call Stop cuts off no longer breaks the rest of the
  conversation; `write_file` creates the folders it needs; a message typed
  while the final answer streams gets its own answer; a compaction runs as
  a turn, so messages sent meanwhile wait and Stop cancels it; Stop ends
  each queued message with a reason; a refusal shows its words.
- Account & usage shows the conversation's totals on both backends (Muse
  Code showed the last request only); the cached rows appear where they can
  be counted.
- A message too large for Muse Code (10 MiB, images included) is refused
  with the reason instead of hanging; its images stay in the composer.
- Output pages and Revert patches no longer break a character in two; a
  binary output says so instead of showing base64.
- The Model API stream tolerates `data: [DONE]`, empty keep-alives and a
  line break split across two reads.
- **Revert** and **Rewind code** no longer trash a file after an edit that
  only added lines to it (such as an import at the top); a created file you
  have added to since keeps your lines; lines an edit deleted are put back
  only where the file still matches, never at a line that moved; a file's
  BOM survives.
- On the Model API backend, edits keep a file's Windows line breaks, BOM and
  final line break, and a multi-line change matches a CRLF file; a file
  that is not UTF-8 text (binary, UTF-16, Latin-1) is refused instead of
  rewritten; a file with unsaved editor changes is left alone; `write_file`
  replaces an existing file only after reading it; writes are atomic, go
  through a symbolic link to the file it leads to, keep a script's
  permissions and refuse a read-only file.
- A shell command's flood of output keeps its end and its exit line; a
  search that runs out of time returns what it found; Windows PowerShell
  output is UTF-8, so accents and symbols no longer come back garbled.
- With autosave off, the panel names the files whose unsaved changes Muse
  will not see.
- Edit Review without an open folder says to open it, instead of resolving
  paths against the extension's own directory.
- On the Model API backend, rules files (`AGENTS.md`, `CLAUDE.md`), skill
  files and the memory index saved as UTF-16 (as Windows PowerShell's `>`
  writes them) load correctly; one that is not text is skipped with a line
  in the log, and no longer hides the other skills. Skill folders that are
  symbolic links or junctions load.
- The Problems-panel tool reports only the workspace's files, by relative
  path, shortens very long messages, and answers a malformed request with an
  error.
- `@` mentions of paths with spaces, `#` or quotes are written in quotes
  (`@"my notes/a b.md"#5-10`), and the mention menu searches names with
  spaces.
- Multi-root workspaces: the first folder is the root for the open-file
  chip, the mention list and search, drops, diagnostics and file links; a
  file in another folder is mentioned by its absolute path.
- Files dropped onto the panel in a remote window (SSH, WSL, containers)
  are mapped as VS Code's own URI transformer maps them, so they insert
  mentions; this is unit-tested, not yet tried in a real remote window.

### Changed

- Integration tests run on the latest VS Code and on the 1.125 floor;
  semgrep and PSScriptAnalyzer are pinned (its install from the PowerShell
  Gallery tried three times); every CI job has a timeout; four
  commands are hidden from the Command Palette where they cannot act; the
  categories are AI and Chat.
- `museSpark.museBinaryPath`, `museSpark.environmentVariables` and VS
  Code's `http.proxy` / `http.noProxy` restart Muse Code when changed; the
  proxy is handed to it when neither its environment nor
  `museSpark.environmentVariables` sets one, in any case.
- On Windows with Muse Code 1.3.0, which refuses both, the panel no longer
  offers Rename and Fork (meta-models/muse-code-sdk#30, #31); "Rewind code
  to here" stays.
- The Model API backend keeps only its conversations' list in memory and
  reads a conversation when it is opened; a file a crash left half-written
  is removed, and a save Windows briefly refuses is tried again.
- Muse Code commands no longer stay in memory after they are answered (the
  SDK kept every one, images included, for the life of the process).
- The Model API shell tool applies `terminal.integrated.env.*` as VS Code's
  terminal does.
- On Windows the CLI always starts as `muse-bin-<version>.exe` (the newest
  one when `.muse-version` is missing), never through its PowerShell
  launcher, which left the CLI running when closed.
- The sign-in and TUI terminals use `/bin/sh` off Windows, whatever the
  default shell.
- The CLI's credential file, settings file and personal skills are looked
  up where the CLI itself looks, including an `XDG_CONFIG_HOME` set in
  `museSpark.environmentVariables`.
- The extension stops Muse Code in `deactivate`, awaited by VS Code.

## [0.5.5] - 2026-09-23

Rewind across subagents, and the repository protected.

### Fixed

- **Rewind code to here** reverts a subagent's edits too. Since 0.5.0 an
  agent's rows live in its own transcript in the Agent map, and the rewind
  only looked at the conversation, so a delegated run's edits stayed on
  disk. Every edit now takes an arrival number when it completes, across
  the conversation and its agents, and the rewind unwinds all of them in
  the reverse of that order, so edits that overlap unwind cleanly. Found
  through a reader's question about overlapping subagent edits.

### Changed

- The repository is protected by GitHub rulesets: `main` cannot be deleted
  or force-pushed and takes changes through pull requests with the CI
  checks green; `v*` tags cannot be deleted or moved; the admin bypasses
  both for direct pushes and releases, logged.
- Dependabot no longer proposes a new major of `@types/node`: the typings
  follow the Node major the workflows and the manifest's `engines` run on
  (22); the 26.x proposal broke the type-aware lint's module resolution.
  The pinned-SHA actions took their weekly bumps (checkout 7.0.1,
  setup-node 7.0.0, setup-python 7.0.0, upload-artifact 7.0.1,
  download-artifact 8.0.1, gitleaks-action 3.0.0).

## [0.5.4] - 2026-09-23

The documentation cleanup; released because the walkthrough, PRIVACY.md and
a setting's description ship inside the package.

### Changed

- A documentation cleanup against the code: the walkthrough says dictation
  is a Windows and macOS feature; PRIVACY.md says the panel lists models
  when it opens while signed in, that the extension only checks whether
  the CLI's credential file exists, and that Sign out and `/logout` are
  one action; SECURITY.md describes the machine-scoped settings and the
  two backends' shell commands as they are; AGENTS.md, CONTRIBUTING.md,
  CLAUDE.md, `.env.example`, the knip comment and two script headers no
  longer describe the key injection removed in 0.1.0, a CI matrix that
  never existed or an interface that does not; the `autosave` setting's
  description matches what it does; PLAN.md's architecture diagram, gates
  table, open questions, budgets and milestone notes are brought up to
  date, with a register row for the test-only `Selection` casts. The
  certification folder gains an index, the harness keeps its Chrome
  profile in a temporary directory, and the Claude Code reference
  screenshots left the repository.

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

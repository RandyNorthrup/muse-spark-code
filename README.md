<p align="center">
  <img src="media/readme/banner.png" alt="Muse Spark Code: Meta's Muse Spark as a coding agent inside VS Code" width="100%">
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code"><img alt="Marketplace version" src="https://badgen.net/vs-marketplace/v/RandyNorthrup.muse-spark-code?label=Marketplace&color=3b6cf6"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code"><img alt="Marketplace installs" src="https://badgen.net/vs-marketplace/i/RandyNorthrup.muse-spark-code?color=3b6cf6"></a>
  <a href="https://github.com/RandyNorthrup/muse-spark-code/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/RandyNorthrup/muse-spark-code/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="VS Code 1.125 or newer" src="https://img.shields.io/badge/VS%20Code-%E2%89%A5%201.125-2b7de9">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-green"></a>
  <a href="https://www.paypal.com/donate/?hosted_button_id=Q9VC7B42R7K82"><img alt="Donate via PayPal" src="https://img.shields.io/badge/donate-PayPal-0070ba"></a>
</p>

**Muse Spark Code** puts Meta's Muse Spark model to work inside VS Code as a
coding agent: a chat panel that streams answers, reads and edits your files
with reviewable diffs, runs commands behind permission modes, delegates to
subagents you can watch and steer, remembers past conversations, and takes
dictation from your microphone. It runs on your Muse subscription through the
Muse Code CLI, or on a Meta Model API key, and never mixes the two.

> Unofficial. Not affiliated with or endorsed by Meta. "Muse Spark" and "Muse
> Code" are Meta trademarks. You bring your own credentials.

## Highlights

- **Streaming chat with tools you can see.** Every read, edit, write and shell
  command is a row in the transcript: green when done, pulsing while running,
  red when refused. Edit rows show the diff, the path opens the file with the
  changed lines selected, **Click to expand** opens VS Code's diff editor, and
  any output opens in an editor tab with a click.
- **Permission modes, like Claude Code.** Manual, Edit automatically, Plan and
  Auto (Bypass behind a setting), switched from the mode button or
  `Shift+Tab`. Gated commands arrive as approval cards with the CLI's own
  choices; questions from the agent arrive as question cards with radios,
  checkboxes, tabs and an "Other" answer. Writes to files that configure or
  run code (git's hooks and config, `.vscode`, CI workflows, dev container
  definitions, `AGENTS.md`, the agent's own skills and Muse Code's `.muse`
  folder with its hooks) always ask, in every mode but Bypass.
- **Subagents on a map.** When Muse Code delegates, each agent is a row and an
  **N agents** pill opens the Agent map: role, status, tokens, each agent's own
  transcript, and the owner controls Muse Code provides (interrupt, stop, a
  note, resume, close, a follow-up task).
- **Reply and quote with context.** A reply's ⋯ menu has **Reply to this
  output**; highlight anything in the chat and right-click for **Ask about
  this** or **Comment on this**. The passage, its author and your intent
  travel with the message, so the agent knows what you mean.
- **Voice dictation at no cost.** Tap or hold the microphone (`Ctrl+D`) and
  speak; the words land at the caret. Windows and macOS use the recogniser
  built into the operating system, so no audio ever goes to a paid service.
- **Two backends, never mixed.** Your Muse subscription through the Muse Code
  CLI, or a Meta Model API key (pay as you go) with the extension's own
  tools. The pasted key is never handed to the CLI.
- **Context the way you work.** `@` mentions with `.gitignore`-aware fuzzy
  search, the open file or selection as a chip, images pasted or dropped,
  `Alt+K` to mention the editor selection, and the Problems panel readable by
  the agent.
- **History that survives the window.** Every conversation in the workspace,
  searchable, resumable with its full transcript, archivable, with fork and
  rewind on every sent message; the sidebar picks its last conversation back
  up within ten minutes, and an editor-tab conversation comes back on its
  session after a window reload.
- **Account & usage.** Your subscription's current and weekly windows, this
  conversation's tokens and cache hits, and what has been eating your usage
  (reminder agents, subagents, long sessions), from `/usage`.
- **No telemetry, no server of its own.** What leaves your machine and where
  it goes is written down in [PRIVACY.md](docs/PRIVACY.md).

## Screenshots

Rendered from the shipped panel by its own UI harness (`npm run
harness:shots`) against a scripted session, so they match the build exactly.

<table>
  <tr>
    <td align="center" width="50%"><img src="media/readme/turn.png" alt="A turn: Thought for 1s, Read, an Edit row with its diff and Click to expand, a Write row, a PowerShell row with its input and output, the reply, and Working…"><br><sub>A turn: thinking, read, edit with its diff, write, shell, and the reply</sub></td>
    <td align="center" width="50%"><img src="media/readme/agents.png" alt="The Agent map over a transcript: the 2 agents pill, this conversation, two agents with their status, duration and tokens"><br><sub>Subagents: the <b>2 agents</b> pill and the Agent map</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="media/readme/approval.png" alt="An approval card: Muse wants to Set-Content, step 1 of 2, a feedback box, Allow once, Always allow in this workspace, Reject"><br><sub>An approval card with the CLI's own choices</sub></td>
    <td align="center"><img src="media/readme/question.png" alt="A question card with Colour and Toppings tabs, radio buttons, an Other answer, Submit greyed out and Cancel"><br><sub>A question card: tabs, radios or checkboxes, Other, Submit and Cancel</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="media/readme/quote.png" alt="A highlighted passage of a reply with the Copy / Ask about this / Comment on this menu"><br><sub>Highlight, right-click: <b>Copy</b>, <b>Ask about this</b> or <b>Comment on this</b></sub></td>
    <td align="center"><img src="media/readme/rewind.png" alt="A sent message's rewind menu: Fork conversation from here, Rewind code to here, Fork conversation and rewind code"><br><sub>Every sent message: fork, rewind the code, or both</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="media/readme/palette.png" alt="The slash palette: Context, Model and Customize groups with effort dots and a thinking toggle"><br><sub>The <code>/</code> palette: context, model, effort, thinking, modes</sub></td>
    <td align="center"><img src="media/readme/modes.png" alt="The Modes menu: Manual, Edit automatically, Plan, Auto, with the effort row"><br><sub>Permission modes, one line each, <code>Shift+Tab</code> to cycle</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="media/readme/history.png" alt="The History dialog: sessions grouped by day, search, Show archived"><br><sub>History: search, resume, archive</sub></td>
    <td align="center"><img src="media/readme/usage.png" alt="The Account & usage modal: auth method, plan, backend, the current window and week bars, this conversation's tokens and cache hits, what is contributing to usage"><br><sub>Account & usage: windows, tokens, cache hits, and what is eating the usage</sub></td>
  </tr>
</table>

<p align="center"><img src="media/readme/voice.png" alt="The composer listening: the red microphone and the Listening placeholder over a new conversation" width="60%"><br><sub>Voice dictation: tap or hold, <code>Ctrl+D</code>; a new conversation shows the keyboard tips until you hide them</sub></p>

## Get started

1. Install **Muse Spark Code** from the
   [Marketplace](https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code)
   (VS Code 1.125 or newer), or from a `.vsix` attached to a
   [GitHub Release](https://github.com/RandyNorthrup/muse-spark-code/releases):

   ```bash
   code --install-extension muse-spark-code-0.6.0.vsix
   ```

2. Open the **Muse Spark** view from the activity bar (or press
   `Ctrl+Shift+Alt+Esc` on Windows, `Cmd+Shift+Esc` on macOS,
   `Ctrl+Shift+Esc` on Linux for a conversation in an editor tab).
3. Sign in, one of two ways:
   - **Sign in with your Meta account** opens a terminal running `muse login`
     from the [Muse Code CLI](https://dev.meta.ai/products/muse-code/) and
     waits for the browser sign-in to finish. Work is billed to your Muse
     subscription.
   - **Use a Model API key** takes a key shaped like `LLM|<id>|<secret>` from
     dev.meta.ai, stores it in VS Code's secret storage and runs the Model API
     backend with the extension's own tools, pay as you go.
4. Type a message and press `Enter`. `/` opens the palette, `@` mentions a
   file, the microphone dictates.

VS Code opens the extension's four-step walkthrough on install; **Muse
Spark: Open Walkthrough** brings it back.

Each panel is its own conversation, started on the first message with the
standard `muse-spark-1.3` model (never a contributor-tier model by default).
The model pill shows the model as soon as the panel opens.

## Backends

| Backend                                                                      | Sign-in                                                          | Billing                | Tools                                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Muse Code CLI** (`muse serve`, Muse Session Protocol via `@muse-code/sdk`) | The CLI's own browser sign-in (`muse login`)                     | Your Muse subscription | The CLI's, inside its OS sandbox where that works (see `shellSandbox`); its bundled skills, your user rules, its own memory, subagents  |
| **Meta Model API** (`https://api.meta.ai/v1`)                                | A key from dev.meta.ai, kept in SecretStorage, sent only to Meta | Pay as you go          | The extension's own: read, edit, write, search, list, shell, `read_skill`, with approvals; the workspace rules, skills and memory below |

`museSpark.backend` picks: `auto` (default) uses the CLI when it is installed
and signed in, otherwise the Model API when a key is stored; `museCode` and
`modelApi` force one. The palette's **Backend** row shows which one this
window runs on. The CLI looks for `muse` through `museSpark.museBinaryPath`,
then `PATH`, then the platform's install folder (`%LOCALAPPDATA%\Programs\muse`
on Windows, `~/.local/bin` elsewhere).

Conversations on the Model API backend are saved as they go under VS
Code's workspace storage for the extension, so the History dialog lists
them after a reload and a resumed one continues with its transcript and its
edit patches; the CLI backend keeps its own session store. If the panel
itself ever fails to render, it shows the error and a **Reload** button
instead of going blank; Reload brings the conversation back as it was,
running turn and waiting cards included.

## Rules, skills and memory

In a trusted workspace the agent follows the same files Muse Code does:

- **Rules**: `AGENTS.md` at the workspace root (`CLAUDE.md` where there is no
  `AGENTS.md`), and the same files in subdirectories, which apply once the
  agent touches a path beneath them; the deeper file wins.
- **Skills**: `.agents/skills/<id>/SKILL.md` in the workspace (project scope)
  and Muse Code's personal root `~/.config/muse/skills`
  (`$XDG_CONFIG_HOME/muse/skills` when set). The palette's **Skills** group
  lists them, `/id arguments` invokes one, and the model loads one itself
  when a task matches its description. `user-invocable: false` in the
  front matter keeps a skill out of the palette. On the CLI backend the
  Skills group also has **Manage skills…**, a checklist of every skill Muse
  Code knows (built-in, yours, this project's, plugins) where unchecking one
  turns it off (`muse skills disable`), and **Import skills…**, which shows
  what `muse skills import` would copy from Claude Code or Codex into your
  Muse skills folder and imports it once you confirm. Muse Code reads skill
  changes when it starts, so both end by offering to restart it; the
  conversation continues on your next message.
- **Memory**: the project's `.agents/memory/MEMORY.md` index is read at the
  start of a conversation; the agent reads and updates the notes there with
  its file tools, under the permission mode.

**Muse Spark: Create AGENTS.md** starts the rules file for a workspace that
has none: `muse init` writes it when the CLI is installed and the workspace
is trusted (the CLI's own scaffold, no model call), otherwise the extension
writes the same layout; an existing file is opened, never overwritten.

On the CLI backend Muse Code loads all of this itself (the extension starts
it with `--trust-workspace`), plus its bundled skills and your user rules.
On the Model API backend the extension loads the files above and nothing
else; a file over 64 KB is skipped with a warning in the log. These files
may be UTF-8 or UTF-16 with a byte-order mark; one that is not text is
skipped with a line in the log. A skill folder may be a symbolic link or
junction: in the workspace it must lead to a place inside it or it is
skipped, while links in the personal root are followed wherever they lead.
Its system
prompt also carries the date, the git branch, the number of changed files
and the latest commit subjects at session start (metadata only), and a
short set of working rules (read before editing, no commits unless asked,
`path:line` references). In VS Code's
**Restricted Mode** (an untrusted folder) neither backend loads rules, skills
or memory, no shell command runs, and the extension runs no `git` (git reads
the repository's own config, which can name programs to run): `@` mentions
come from VS Code's file search and the prompt carries no git facts. Trust
the workspace to enable them.

**MCP servers and hooks (CLI backend).** Muse Code reads both from its own
settings file (`~/.config/muse/settings.json`, or under `XDG_CONFIG_HOME`),
and project hooks from `.muse/hooks.json`. The extension shows them and
never edits them:

- **MCP servers…** lists each server:
  - Its transport, where it points (a URL is cut to its scheme and host),
    and whether Muse Code stops when it fails ("required") or skips it.
  - The _names_ of its environment variables and headers. The values stay
    in the file.
  - A remote server can be signed in to or out of. That runs
    `muse mcp login` or `muse mcp logout` in a terminal, with the server's
    name quoted.
- **Loud warnings** for the two settings mistakes that make Muse Code load
  no server at all: both `mcpServers` and the older `mcp_servers` in one
  file, or `required` beside `mode` on a server.
- **Hooks…** lists the project's, yours and your administrator's hooks, and
  opens the file behind each. A hook runs through your shell outside Muse
  Code's sandbox and approvals, so read a repository's hooks before you
  trust its folder.
- **Restart Muse Code to load changes** is there because Muse Code reads
  these files when it starts.

**Worktrees.** **New worktree…** starts a branch in a folder of its own and
opens it in a new window, so a conversation there leaves your checkout
alone:

- **Where it goes:** `<repository>.worktrees/<branch>`, beside the
  repository, so the second copy never lands inside your workspace.
- **Naming:** git checks the branch name, and a branch that already exists
  is refused.
- **Base:** you pick the commit it starts from, the current one or any
  local branch.

**Remove a worktree…** lists the others (never the main checkout or the
window you are in) and deletes the chosen folder. Its branch stays. A
worktree with uncommitted changes is removed only after a second
confirmation that says the changes will be lost. Both commands need a
trusted workspace, since git does not run in Restricted Mode.

**Permission modes in detail.** On the Model API backend Manual asks before
every edit and every command; Edit automatically approves plain file edits
and asks before commands; Auto runs edits and asks before commands (there is
no safety-check model behind it on this backend); Plan refuses edits and
commands. "Always allow in this session" on a command allows that exact
command line again, nothing broader. On the Muse Code backend the CLI
decides what to gate: in Manual it applies edits inside the workspace
without an approval (verified with Muse Code 1.3.0), so Manual and Edit
automatically differ only for the file approvals it does raise; it asks
before commands and runs its own safety check in Auto. On both, a protected write (above) always shows a
card, and the file tools refuse any path that leaves the workspace,
including through a symbolic link or junction inside it.

## The panel

**Composer.** `Enter` sends, `Shift+Enter` breaks a line (or send with
`Ctrl+Enter` through a setting); the box grows with your draft up to ten
rows and scrolls inside past that. `/` on an empty draft opens the palette:
Context (attach, mention, clear, resume, new and remove worktree, and on
the CLI backend "Continue a Claude Code session" and "Continue a Codex
session", Muse Code's own `resume-claude` and `resume-codex` skills), Model
(switch model, effort, thinking), Customize (permission mode, Focus view,
MCP servers and hooks on the CLI backend, settings, keybindings),
Account & usage, Skills (the session's own, plus Manage and Import on the
CLI backend), slash commands (`/compact`, `/export`, `/clear`, `/logout`,
`/usage`, `/cost`, `/agents`) and Support. `/export` saves the
conversation as Markdown where you choose (messages, thinking, tool calls
with their arguments and visible output); on the CLI backend **Export
session log…** also saves Muse Code's own JSON record of the session
(`muse export`), which includes everything, stored outputs too. The `+`
button uploads images (PNG, JPEG, GIF, WebP; other files become `@`
mentions) or starts a mention; images also paste and drop. A path with a
space, `#` or `"` is written in quotes, `@"my notes/a b.md"#5-10`, and the
menu searches what you type after `@"`. The model pill
reads `model effort` (effort tiers Minimal to Max, each verified per model);
the mode button opens the Modes menu; the microphone dictates. While a turn
runs, `Enter` steers it and Stop cancels it. The context indicator is a
button: click it to compact now; its tooltip carries the pressure level Muse
reports. An upload the panel cannot take (only PNG, JPEG, GIF and WebP images
are uploads) shows a dismissible banner above the box: other files go in as
`@` mentions, or by absolute path for files outside the workspace.

**Transcript.** Replies render as GitHub-flavoured markdown with highlighted
code and **Copy**, **Insert at cursor** and **Apply** on every block; a
finished reply carries **Copy** on hover. Tool rows show the diff or the
command and its output from the start; read rows open on click, and a
chevron marks the rows that open. The path of an edit or read row opens the
file with the changed lines selected. Click a tool's output to open it in a
read-only editor tab (a stored output in full); **Click to expand** on an
edit diff opens VS Code's diff editor (the file side is editable). Thinking
rows stream their summary while the model thinks and end as "Thought for
Ns" (a resumed conversation's read "Thought"). A relative link in a reply
(`src/parser.ts#L12`) opens that workspace file at those lines. A reply's ⋯
menu has **Reply to this output**: the next message carries that output to
the agent as context, marked as what you are replying to. Highlight any text
in the chat and right-click it for **Copy**, **Ask about this** or
**Comment on this**; the passage, its author and your intent travel with
the message. The composer shows a chip for either; × drops it. The transcript
follows new entries while you are at the end; scrolled up, it holds still
and **New messages** jumps to the newest. Approval cards carry the CLI's own
choices (Allow once, Always allow in this workspace or Allow for this
session, Reject, with optional feedback); multi-step shell lines are
approved one step at a time. Question cards stack radio buttons for one
answer and checkboxes for several, put multiple questions on tabs, always
offer **Other** for your own words, and keep **Submit** greyed until every
question has an answer; **Cancel** declines the prompt. The agent's task
list pins above the composer, the session name replaces "Untitled" once
allocated, and the composer shows how much of the context window is used.
**Focus view** (`Ctrl+Alt+F`) folds tool and reasoning rows behind `Show N
steps`.

**Edits and rewind.** Muse applies in-workspace edits as it goes, so review
comes after: the edit row shows the diff, its path opens the file at the
change, and **Click to expand** opens the diff editor. To undo, use the
rewind button on any sent message (on hover): **Fork conversation from
here**, **Rewind code to here** (reverts every edit made after that message,
the conversation's and its subagents', in the reverse of the order they
landed; a file the edit created goes to the trash, unless you have added to
it since, in which case your lines stay) and **Fork conversation and rewind
code**. Each edit is undone only where its own lines (the changed lines and
the few around them) are still exactly as the edit left them. If you added
or removed lines above them since, they are found where they moved to, as
long as they appear in exactly one place. An edit whose lines you changed,
or that could match more than one place, is left alone and says why,
rather than guessed at; your other changes to the file are kept. A file's
BOM and line breaks survive both.

**Unsaved editors.** Muse reads and edits the files on disk. With
`museSpark.autosave` on (the default) every message saves your editors
first; with it off the panel names the files whose unsaved changes Muse will
not see. On the Model API backend the file tools also refuse a file an
editor holds unsaved changes to, keep a file's BOM, line breaks and final
line break, refuse files that are not UTF-8 text rather than rewrite them,
and replace an existing file with `write_file` only after reading it (as
Claude Code does).

**History.** The clock icon lists the workspace's conversations by day with
search, resume (full transcript), archive and **Show archived**. Sessions
idle for `archiveInactiveSessions` days are hidden, not deleted. A hidden
panel shows a dot when Muse finished or needs a decision.

**Diagnostics.** The agent can read the Problems panel through a
`getDiagnostics` tool the extension serves on a loopback MCP server, bound to
`127.0.0.1` with a per-window token. Nothing else is exposed. It reports the
workspace's files only (the first folder), by relative path, each message
cut at 1,000 characters.

**Subagents.** When Muse Code spawns native subagents they appear as rows
and an **N agents** pill in the header opens the **Agent map** (also
`/agents`): this conversation, its agents with role, objective, status,
duration and tokens, the background tasks, and each agent's own transcript.
Muse Code hides its subagent tools unless `run.subagent_delegation_mode` is
`"auto"` in its settings file (`~/.config/muse/settings.json`, or under
`$XDG_CONFIG_HOME`); the map says so and opens the file for you. The
extension never edits it. Muse Code also gates `subagent_spawn` behind an
approval: in Manual mode the card appears (Allow once / Allow for this
session); Plan mode refuses it. An agent's own replies and tool calls
stay in its transcript in the map (they reach the panel with the child
session's turn id), and the map's details offer the owner controls Muse
Code provides: Interrupt and Stop while it runs, a note to it, Resume,
Close, and a follow-up task once its result is ready. The Model API
backend spawns no agents.

**Account & usage** (`/usage`, `/cost`) is a modal over the transcript:
auth method, plan, backend, Muse Code version and model; the subscription's
current window and week (Muse Code reports them only after a reply; until
then the modal shows the last window it reported, dated "as of"); this
conversation's token totals (on Muse Code, prompt tokens as it counts them
once) and, on the Model API, the cached tokens, the cache-hit rate and a
dollar estimate from Meta's published per-token prices (standard versus
contributor tier, read 2026-09-22; the dev.meta.ai dashboard is the bill);
and what is contributing to your usage over the last day or week, read from
the Muse Code CLI's trace logs on this machine: the share of model attempts
from Muse's reminder agents (which run after every reply), from subagents,
and from sessions active for 8+ hours. Approximate, this machine only.

**Prompt caching.** The Model API backend sends a per-session cache key so
repeated prefixes are billed at the cached rate; the CLI caches on its own.
Meta does not publish the cache lifetime, so there is no "warm for N
minutes" countdown; on the Model API the modal shows the cache-hit rate
instead (Muse Code reports no cache total a conversation can add up).

## Voice dictation

Tap the microphone to start and again to stop; hold it (or `Ctrl+D` /
`Cmd+D` in the composer, or Space on the focused button) to record while
held. The placeholder reads "Listening…", the mic pulses red, and each phrase
lands at the caret followed by a space. Recognition runs in a small helper
on the operating system's own engine, kept warm for five minutes after a
recording. Nothing is billed and no third-party engine is involved.

Dictation is off in a remote window (SSH, WSL, containers, tunnels,
Codespaces): the extension runs on the remote machine, which cannot hear
your microphone.

| Platform | How                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `native/windows/dictate.ps1` under Windows PowerShell 5.1 on the .NET Framework's `System.Speech`, the desktop recogniser that ships with Windows (English always; other languages with Windows speech packs). Audio never leaves the machine. Accuracy is the classic engine's, below Windows 11's voice typing; Windows' Speech Recognition training improves it for your voice.                    |
| macOS    | `native/darwin/muse-dictate`, a Swift helper on Apple's Speech framework, built by CI on a Mac and shipped in the Marketplace package. **Dictation (System Settings > Keyboard) or Siri must be on.** Apple picks on-device recognition when its model is installed, otherwise its servers under Apple's terms at no charge (`--on-device` refuses the servers). See the macOS notes below the table. |
| Linux    | Not available: no distribution ships a speech recogniser and the extension adds none. The button is dimmed with that reason as its tooltip.                                                                                                                                                                                                                                                           |

On macOS, two things can stop the helper, and the panel's error says which:

- **A permission.** The first time you dictate, macOS asks for speech
  recognition and the microphone on behalf of the helper itself,
  **muse-dictate**, with its own usage descriptions, rather than for
  Visual Studio Code; the grants are managed under System Settings >
  Privacy & Security > Speech Recognition and > Microphone. The helper
  asks under its own name because Visual Studio Code, which starts it,
  declares no speech-recognition purpose
  ([microsoft/vscode#307364](https://github.com/microsoft/vscode/issues/307364)),
  and macOS would refuse VS Code without asking; to do so it disclaims VS
  Code's responsibility with a private macOS call (the one Chromium, Qt and
  Electron use), and where that call is missing it asks as VS Code and the
  panel's error explains the refusal. The helper is ad-hoc signed, so macOS
  ties the grant to the build: after an update that changes the helper,
  macOS asks again.
- **The helper itself.** The helper is ad-hoc signed, not notarised; VS
  Code's installer does not quarantine it, so Gatekeeper does not stop it.
  If the error names no permission step, macOS refused to run the helper:
  its file carries the quarantine flag, which a copy through a browser
  download or an archive tool can add. This clears it:

```bash
xattr -d com.apple.quarantine ~/.vscode/extensions/randynorthrup.muse-spark-code-*/native/darwin/muse-dictate
```

Diagnosing on Windows: the helper can replay a WAV file instead of the
microphone, which separates a recogniser problem from a microphone one.

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File native\windows\dictate.ps1 -InputWav C:\path\to\speech.wav
```

Type `start` and press Enter; phrases print as JSON lines, then `stopped`.
On macOS the helper takes `--input-device <CoreAudio UID>` to capture from
one specific device; a Mac without any input device reports "no audio input
device is available", and step markers on stderr name where a start failed.

## Commands and keybindings

| Command                                             | Default keybinding                                                                   | What it does                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muse Spark: Open in Sidebar                         | —                                                                                    | Focus the chat view in the activity bar                                                                                                                   |
| Muse Spark: New Conversation                        | `Ctrl+N` (`Cmd+N`) when `enableNewConversationShortcut` is on, Muse focused          | Clear the active panel to a new conversation, or open one where `preferredLocation` says                                                                  |
| Muse Spark: Sign Out                                | —                                                                                    | Forget the stored Model API key and run `muse logout` when the CLI is signed in                                                                           |
| Muse Spark: Open in Terminal                        | —                                                                                    | Run the Muse Code CLI's own interactive interface in a VS Code terminal at the workspace root                                                             |
| Muse Spark: Create AGENTS.md                        | —                                                                                    | Write the rules file with `muse init` (or the same template without the CLI) and open it; an existing file is opened                                      |
| Muse Spark: Open Walkthrough                        | —                                                                                    | Open the four-step Get Started walkthrough                                                                                                                |
| Muse Spark: Open in New Tab                         | `Ctrl+Shift+Alt+Esc` on Windows, `Cmd+Shift+Esc` on macOS, `Ctrl+Shift+Esc` on Linux | Open an independent conversation as an editor tab (also the `+` in the view title); the panel header's own button starts a new conversation in place      |
| Muse Spark: Toggle Focus                            | `Ctrl+Alt+Esc` on Windows, `Cmd+Esc` on macOS, `Ctrl+Esc` on Linux                   | Move keyboard focus between the editor and the composer                                                                                                   |
| Muse Spark: Insert @-Mention for Selection          | `Alt+K`, editor focused                                                              | Insert `@path#start-end` for the active editor selection into the composer                                                                                |
| Muse Spark: Toggle Focus View                       | `Ctrl+Alt+F`, Muse focused                                                           | Flip the `museSpark.focusView` setting (hides tool calls and reasoning)                                                                                   |
| Muse Spark: Toggle Thinking                         | `Ctrl+Alt+T` (macOS `Option+T`, Linux `Ctrl+Alt+O`), composer only                   | Turn reasoning on or off for this conversation. Claude Code uses `Alt+T`; on Windows that opens the Terminal menu, on GNOME `Ctrl+Alt+T` opens a terminal |
| Muse Spark: Set Up Shell Sandbox                    | —                                                                                    | Windows: run Muse Code's one-time `muse sandbox windows setup` through a UAC prompt and report the result; elsewhere reports that no setup is needed      |
| Muse Spark: Show Logs                               | —                                                                                    | Open the "Muse Spark" log channel (keys redacted)                                                                                                         |
| Muse Spark: Diagnostics                             | —                                                                                    | Write the versions, the backend and CLI facts, credential presence (as yes/no) and the dictation state to the log and open it: what a bug report needs    |
| Muse Spark: Manage Skills                           | —                                                                                    | Turn Muse Code's skills on or off (`muse skills enable`/`disable`), then offer to restart it so the change takes effect                                   |
| Muse Spark: Import Skills from Claude Code or Codex | —                                                                                    | Preview what `muse skills import` would copy, import it once you confirm, report what was imported, skipped or failed                                     |
| Muse Spark: Export Conversation                     | —                                                                                    | Save the conversation in front of you as Markdown where you choose, and open it                                                                           |
| Muse Spark: MCP Servers                             | —                                                                                    | Show the MCP servers Muse Code will load, sign in to or out of a remote one, open the settings file                                                       |
| Muse Spark: Hooks                                   | —                                                                                    | Show where Muse Code's hooks come from (project, yours, managed) and open each file                                                                       |
| Muse Spark: New Worktree…                           | —                                                                                    | Start a branch in its own folder beside the repository and open it in a new window                                                                        |
| Muse Spark: Remove Worktree…                        | —                                                                                    | Delete another worktree's folder (its branch stays), asking again before discarding uncommitted changes                                                   |
| (composer) Record voice                             | `Ctrl+D` (`Cmd+D`), composer only                                                    | Tap to start or stop voice dictation, hold to record while held                                                                                           |

Windows keeps `Ctrl+Esc` for Start and `Ctrl+Shift+Esc` for Task Manager,
which is why its two shortcuts add `Alt`. Seven commands appear in the
Command Palette only where they can act: Insert @-Mention with an editor
open, Toggle Thinking and Export Conversation with a Muse panel in view,
Set Up Shell Sandbox on Windows (or in a remote window), Create AGENTS.md
and the two worktree commands with a folder open.

## Settings

All settings live under `museSpark.*`; changes apply to open panels immediately.
The settings that choose what runs and what is billed (`initialPermissionMode`,
`backend`, `shellSandbox`, `allowDangerouslySkipPermissions`, `museBinaryPath`,
`environmentVariables`) are machine-scoped: they take effect from your user
settings only, never from a repository's `.vscode/settings.json`. In a
remote window (SSH, WSL, a dev container) machine settings live on the
remote side, where a dev container definition can set them; there the
extension never starts a conversation in Bypass permissions and asks you
once before entering it. Turning `allowDangerouslySkipPermissions` off
moves every open conversation out of Bypass at once.

| Setting                           | Default  | Purpose                                                                                                                                                                                                                                               |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preferredLocation`               | `panel`  | Where new conversations open: `sidebar` or `panel` (editor tab)                                                                                                                                                                                       |
| `initialPermissionMode`           | `manual` | `manual`, `acceptEdits`, `plan`, `auto` or `bypassPermissions` for new conversations                                                                                                                                                                  |
| `autosave`                        | `true`   | Save all dirty editors before every turn                                                                                                                                                                                                              |
| `attachOpenFile`                  | `true`   | Show the open-file chip and send the active file / selection with each message                                                                                                                                                                        |
| `useCtrlEnterToSend`              | `false`  | Send with Ctrl/Cmd+Enter instead of Enter                                                                                                                                                                                                             |
| `enableNewConversationShortcut`   | `false`  | `Ctrl+N` / `Cmd+N` starts a new conversation while a Muse panel is focused                                                                                                                                                                            |
| `hideOnboarding`                  | `false`  | Hide the getting-started tips                                                                                                                                                                                                                         |
| `focusView`                       | `false`  | Show only prompts and responses                                                                                                                                                                                                                       |
| `respectGitIgnore`                | `true`   | Exclude `.gitignore` patterns from file searches and `@`-mentions                                                                                                                                                                                     |
| `confidentialWorkspace`           | `false`  | Block contributor-tier models (Meta may train on their traffic) in this workspace                                                                                                                                                                     |
| `allowDangerouslySkipPermissions` | `false`  | List Bypass permissions in the Modes menu and the Shift+Tab cycle (sandboxes only)                                                                                                                                                                    |
| `archiveInactiveSessions`         | `14`     | Hide sessions idle for this many days from the History dialog (`1`, `2`, `7`, `14`, or `0` for never); they stay on disk and **Show archived** lists them                                                                                             |
| `cleanupPeriodDays`               | `30`     | Delete Model API conversations idle for more than this many days when a window lists them (`0` keeps them); Muse Code's own sessions are the CLI's to keep                                                                                            |
| `backend`                         | `auto`   | `auto`: Muse Code when the CLI is signed in, else the Model API when a key is stored; `museCode` / `modelApi` force one. The pasted key never reaches the CLI                                                                                         |
| `shellSandbox`                    | `auto`   | `auto`: Muse Code's OS sandbox, except for Windows workspaces under your profile where it cannot run commands; `muse`: always the sandbox; `off`: commands run directly as you, gated by approvals (Claude Code style). Changing it restarts the host |
| `museBinaryPath`                  | `""`     | Absolute path to the Muse Code executable (a relative one is refused); empty discovers it on `PATH` or the install dir. Changing it restarts the host                                                                                                 |
| `environmentVariables`            | `[]`     | `{ name, value }` pairs for the Muse Code process (an `XDG_CONFIG_HOME` here is where the extension looks for the CLI's sign-in and settings too). Never put API keys here; use Sign in. Changing it restarts the host                                |

Muse Code also gets VS Code's `http.proxy` (and `http.noProxy`) as
`HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` when neither its environment nor
`environmentVariables` sets one, in either case.
The Model API backend's shell tool applies `terminal.integrated.env.*` the
way VS Code's terminal does. A restart of Muse Code, for a setting, trust
granted, a sign-in or a crash, keeps the conversation: the running turn is
stopped and the next message resumes the same session.

## Requirements

- VS Code 1.125.0 or newer, on Windows, macOS or Linux.
- The [Muse Code CLI](https://dev.meta.ai/products/muse-code/) signed in with
  a Meta account (subscription), or a Meta Model API key (pay as you go).
- `git` on `PATH` for `.gitignore`-aware `@` mentions (optional; VS Code's
  file search is used without it). The extension runs git only in a trusted
  workspace and only from an absolute `PATH` entry, never a copy inside the
  workspace.
- Voice dictation: Windows, or macOS with Dictation or Siri enabled, in a
  local window.
- A trusted workspace for rules, skills, memory and shell commands; in
  Restricted Mode the panel chats and edits under approval, nothing more.
  The first workspace folder is the root: the open-file chip, `@` mentions,
  drops, the Problems panel the agent reads and relative file links all
  belong to it (a folder added inside it counts as part of it); a file in
  another folder is mentioned by its absolute path. Virtual workspaces are
  not supported.

## Privacy and security

- Your prompts, attachments, mentioned files and tool output go to Meta, and
  nowhere else, only when you press Send. The extension has no telemetry and
  no server of its own. Details: [PRIVACY.md](docs/PRIVACY.md).
- A pasted Model API key lives only in VS Code's SecretStorage, is sent only
  to `api.meta.ai`, is never passed to any child process, and never reaches
  settings, logs or the CLI.
- Contributor-tier models (Meta may train on their traffic) are opt-in with
  one confirmation per conversation, and refused outright with
  `museSpark.confidentialWorkspace`.
- Voice audio stays on the machine on Windows; on macOS Apple recognises on
  the device or on its servers under Apple's terms.
- Model API conversations are stored, per workspace, in VS Code's storage
  directory for the extension (not in the repository); ones idle longer
  than `museSpark.cleanupPeriodDays` (30 days by default) are deleted, and
  removing that directory deletes them all. The History dialog archives,
  it does not delete.
- The usage insights read the Muse Code CLI's trace logs on this machine and
  send nothing anywhere.
- Workspace rules, skill files and the memory index are read only in a
  trusted workspace; on the Model API backend their text is part of what
  goes to Meta with each request, on the CLI backend Muse Code sends them
  under its own terms.
- The Model API backend's file tools resolve every path through the file
  system before touching it: a path that leaves the workspace, directly or
  through a link, is refused, and Windows names that would be reinterpreted
  (alternate data streams, device names, trailing dots) are refused too.
  Its shell tool starts PowerShell or bash by absolute path with the
  environment VS Code's own terminal would give (the editor's internal
  variables removed). Stop and a timeout end everything a command started:
  its process group on macOS and Linux; on Windows the job object each
  command runs in, through a small helper the extension compiles once
  into its own storage with PowerShell's `Add-Type` (where policy forbids
  that, the log says so and a sweep of the process table stands in).
- The webview runs under a strict CSP (`default-src 'none'`, per-load script
  nonce, no remote origins, no inline styles); every message between host and
  webview is validated with a zod schema.

## Development

```bash
git clone https://github.com/RandyNorthrup/muse-spark-code.git
cd muse-spark-code
npm ci          # also installs the pre-commit hook (lint-staged + gitleaks)
```

Press **F5** to launch the Extension Development Host with a fresh build.
[CONTRIBUTING.md](CONTRIBUTING.md) has the rules for a pull request;
[SECURITY.md](SECURITY.md) the way to report a vulnerability.
Node 22 or newer (`.npmrc` enforces `engine-strict`);
[gitleaks](https://github.com/gitleaks/gitleaks) on `PATH` for the hook and
`npm run security:secrets`; `pip install semgrep` for `npm run security:sast`.

**Stack.** TypeScript 6.0.3 (pinned: `typescript-eslint` does not yet
support TS 7); the extension host bundled with esbuild to CommonJS; the
webview is React 19 bundled to one IIFE with its stylesheet; `zod/mini`
validates every host ⇄ webview message; the voice helpers are Windows
PowerShell and Swift with no dependencies.

| Command                                   | What it does                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:dev`                       | Dev bundles for the extension, the webview and the integration tests, with source maps                                                                                                                                                                                                                                                       |
| `npm run watch`                           | Rebuild extension + webview on change                                                                                                                                                                                                                                                                                                        |
| `npm run harness:shots`                   | Screenshots of the webview in headless Chrome behind a fake host (`test/harness/`), every scenario or the names you pass; needs `build:dev` and Chrome. The README's screenshots come from here                                                                                                                                              |
| `npm run images`                          | Render the Marketplace icon, the README banner and the social preview from their SVGs (headless Chrome)                                                                                                                                                                                                                                      |
| `npm run build`                           | Minified production bundles, then enforces the size budgets in `scripts/check-bundle-size.mjs`, fails if a host bundle reads `navigator`, and checks `THIRD_PARTY_NOTICES.txt` against the bundled packages                                                                                                                                  |
| `npm run notices`                         | Regenerates `THIRD_PARTY_NOTICES.txt` from the production bundles                                                                                                                                                                                                                                                                            |
| `npm run format` / `npm run format:check` | Prettier write / check                                                                                                                                                                                                                                                                                                                       |
| `npm run lint`                            | `eslint --max-warnings=0` (type-aware), `stylelint --max-warnings=0`, PSScriptAnalyzer over `native/windows`                                                                                                                                                                                                                                 |
| `npm run typecheck`                       | `tsc --noEmit` for the host, webview, unit-test, e2e-test and integration-test projects                                                                                                                                                                                                                                                      |
| `npm run deadcode`                        | `knip`: unused files, exports, dependencies (no `--strict`; see `knip.jsonc`)                                                                                                                                                                                                                                                                |
| `npm run cycles`                          | `dpdm` circular-import check from both entry points                                                                                                                                                                                                                                                                                          |
| `npm run duplication`                     | `jscpd` copy-paste detection (threshold 0)                                                                                                                                                                                                                                                                                                   |
| `npm run test:unit`                       | vitest with coverage thresholds (90 % statements/lines/functions, 85 % branches); includes `test/e2e/`, where a fake Muse Code CLI is spawned as a real child process (a compiled stub on Windows) and driven through the real backend manager                                                                                               |
| `npm run test:e2e:live`                   | One real turn on the installed Muse Code CLI, opt-in with `MUSE_LIVE_E2E=1`; bills the signed-in subscription (25 to 45 model attempts measured for a reply-only turn: one for the answer, the rest for Muse Code's bundled reminder agents, which loop a varying number of times; budget 60, counted from the CLI's trace log); never in CI |
| `npm run test:integration`                | Builds, downloads VS Code stable and the `engines.vscode` floor into `.vscode-test/`, runs `test/integration/**` in each; after `npm run build:dev`, `npm run test:integration:run -- --label stable` (or `minimum`) runs one                                                                                                                |
| `npm run test`                            | Unit then integration                                                                                                                                                                                                                                                                                                                        |
| `npm run security:audit`                  | `scripts/audit.mjs`: fails on a high or critical advisory without a dated, reviewed entry in `.github/audit-exceptions.json`                                                                                                                                                                                                                 |
| `npm run security:sast`                   | `semgrep scan --config auto --error`                                                                                                                                                                                                                                                                                                         |
| `npm run security:secrets`                | `gitleaks git` over the repository history                                                                                                                                                                                                                                                                                                   |
| `npm run quality`                         | Every gate above except integration tests, plus secrets and SAST; **exits non-zero on any finding**                                                                                                                                                                                                                                          |
| `npm run quality:ci`                      | What CI runs: all gates plus integration tests                                                                                                                                                                                                                                                                                               |
| `npm run package`                         | `vsce package --no-dependencies` → `.vsix` (without the macOS helper unless built on a Mac)                                                                                                                                                                                                                                                  |
| `npm run clean`                           | Remove `dist/` and `coverage/`                                                                                                                                                                                                                                                                                                               |

**Tests.** Unit tests (`test/unit/**`) run under vitest with `vscode` aliased
to `test/unit/mocks/vscode.ts` and webview components under jsdom; the fakes
in `test/unit/helpers/` implement the full VS Code interfaces. The e2e tests
(`test/e2e/**`) drive the real backend manager against a fake Muse Code CLI
that answers the Muse Session Protocol, including approvals, questions and
subagents. Integration tests (`test/integration/**`) run under mocha inside
a real VS Code launched by `@vscode/test-cli` (on Linux under `xvfb-run -a`).

**Quality gates.** Every gate fails the build rather than printing, and each
was seen to fail on a deliberate break before being trusted; the records are
in [`docs/certification/`](docs/certification/), one file per milestone.
Escape hatches (`eslint-disable`, `@ts-expect-error`, casts) need an inline
reason and a row in `PLAN.md` §8. Bundle budgets: 600 KiB for the extension,
900 KiB for the webview.

**Environment variables.** Credentials live in SecretStorage, never in
files. `.env.example` documents the single variable tooling may read:
`META_API_KEY`, which the Muse Code CLI inherits untouched if you export it
yourself (and prefers over its sign-in, as Meta documents). The extension
never sets it.

**Project structure.**

```
src/extension.ts            activation: registers the view, panel, commands, the output and file openers
src/host/                   VS Code-facing code (webview wiring, auth, conversation, mentions, voice, the diagnostics MCP server)
src/core/                   backend-agnostic logic (MSP host, Model API client, tools, usage insights, dictation driver)
src/shared/                 constants + zod message protocol shared with the webview
src/webview/                React app (own tsconfig, browser libs)
native/windows/             dictate.ps1: the Windows dictation helper (System.Speech)
native/darwin/              Dictation.swift + build.sh: the macOS helper (built in CI)
test/unit/                  vitest tests, vscode mock, fakes
test/e2e/                   the fake Muse Code CLI and the tests that drive the real backend through it; the opt-in live drill
test/integration/           @vscode/test-cli suites
test/harness/               the webview behind a fake host, for screenshots
scripts/                    esbuild build, bundle-size gate, PSScriptAnalyzer gate, harness screenshots, image rendering
docs/certification/         per-milestone gate-fire records
media/                      icons, banner, social preview, README screenshots
```

**Releases.** CI (`.github/workflows/ci.yml`) runs the quality gates on
Ubuntu, Windows and macOS, the integration tests, gitleaks over the full
history, semgrep, a `native-darwin` job that compiles the macOS dictation
helper, and a `package` job that uploads the complete `.vsix` as the
`muse-spark-code-vsix` artifact. A version tag (`v1.2.3`, matching the
manifest) runs `.github/workflows/release.yml`: the same build, a GitHub
Release with the `.vsix` and the CHANGELOG section as its notes, and the
Marketplace publish from that `.vsix` (publisher `RandyNorthrup`). The
package is never built on Windows or Linux for publishing, or Mac users
would get a panel without a microphone.

## Troubleshooting

- **Every shell command fails with `sandbox enforcement unavailable`** — Muse
  Code runs commands inside an OS sandbox that needs a one-time administrator
  setup on Windows. The panel offers it in a notification ("Set up now"
  relaunches `muse sandbox windows setup` through the UAC prompt); the same
  flow is **Muse Spark: Set Up Shell Sandbox**. Start a new conversation
  afterwards. Linux and macOS need no setup.
- **Shell commands run in `C:\Windows\System32\WindowsPowerShell\v1.0`
  instead of the project, and the first one takes ages** — Muse Code 1.3.0's
  Windows sandbox cannot enter folders under `C:\Users\<you>`
  ([meta-models/muse-code-sdk#26](https://github.com/meta-models/muse-code-sdk/issues/26)).
  With `museSpark.shellSandbox` at `auto` the extension starts Muse Code
  without the sandbox for such workspaces: commands run directly as you, in
  the project, still gated by the approval cards, and the panel says so once
  per conversation. `muse` keeps the sandbox regardless; `off` never sandboxes.
- **No Rename in the header, no Fork in a message's menu (Windows)** —
  Muse Code 1.3.0 refuses `session/rename` and `session/fork` on Windows
  ([#30](https://github.com/meta-models/muse-code-sdk/issues/30),
  [#31](https://github.com/meta-models/muse-code-sdk/issues/31)), so the
  panel does not offer them there; **Rewind code to here** still works. A
  newer Muse Code gets both back, and the Model API backend has both.
- **A warning that "Muse Code reported an error for the decision (the tool
  may have run anyway): … approval ledger durability fence …"** — Muse Code
  1.3.0 on Windows sometimes fails its own ledger write after applying your
  decision ([#29](https://github.com/meta-models/muse-code-sdk/issues/29)).
  The tool row shows what happened; nothing needs redoing.
- **Model API charges while using the CLI** — the extension never hands your
  pasted key to the CLI (the "muse serve credentials" line in the Muse Spark
  output log says which credential it started with). If the CLI itself holds
  a pay-as-you-go key (`muse auth set`) or `META_API_KEY` is exported in your
  environment, the CLI uses it, exactly as Meta documents.
- **The Agent map says delegation is off** — Muse Code hides its subagent
  tools until `run.subagent_delegation_mode` is `"auto"` in its own settings
  file; the map's button opens that file. The extension never edits it.
- **The microphone says "Voice dictation failed: No microphone is available"**
  — Windows sees no recording device from this session (Remote Desktop hides
  the host's devices unless the client redirects a microphone). On macOS,
  "Siri and Dictation are disabled" means Dictation must be switched on in
  System Settings > Keyboard.
- **`npm ci` fails with an engine error** — Node 22+ is required.
- **Pre-commit hook says `gitleaks: command not found`** — install gitleaks
  (Windows: `winget install Gitleaks.Gitleaks`).
- **Type-aware lint rules stop reporting** — `npm ls typescript` must show
  6.0.x; TypeScript 7 is outside `typescript-eslint`'s peer range.
- **`npm run test:integration` cannot download VS Code** — the download goes to
  `.vscode-test/`; on a restricted network set `VSCODE_TEST_VERSION` or
  pre-populate the folder from another machine.
- **Webview is blank after a change** — run `npm run build:dev` (F5 does this
  via the pre-launch task) and reload the window.

## Support this project

If Muse Spark Code saves you time, you can
[buy me a coffee](https://www.paypal.com/donate/?hosted_button_id=Q9VC7B42R7K82)
via PayPal. Thank you!

## More

- [CHANGELOG.md](CHANGELOG.md): what shipped, version by version.
- [PLAN.md](PLAN.md): decisions, research, milestones and their certification.
- [docs/PRIVACY.md](docs/PRIVACY.md): what leaves your machine.
- [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
- [Issues](https://github.com/RandyNorthrup/muse-spark-code/issues).

<p align="center">
  <img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/banner.png" alt="Muse Spark Code: Meta's Muse Spark as a coding agent in your editor" width="100%">
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code"><img alt="Marketplace version" src="https://badgen.net/vs-marketplace/v/RandyNorthrup.muse-spark-code?label=Marketplace&color=3b6cf6"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code"><img alt="Marketplace installs" src="https://badgen.net/vs-marketplace/i/RandyNorthrup.muse-spark-code?color=3b6cf6"></a>
  <a href="https://open-vsx.org/extension/RandyNorthrup/muse-spark-code"><img alt="Open VSX version" src="https://badgen.net/open-vsx/version/RandyNorthrup/muse-spark-code?label=Open%20VSX&color=3b6cf6"></a>
  <a href="https://open-vsx.org/extension/RandyNorthrup/muse-spark-code"><img alt="Open VSX downloads" src="https://badgen.net/open-vsx/d/RandyNorthrup/muse-spark-code?label=Open%20VSX%20downloads&color=3b6cf6"></a>
  <a href="https://github.com/RandyNorthrup/muse-spark-code/releases/latest"><img alt="ACP agent: GitHub Release" src="https://badgen.net/github/release/RandyNorthrup/muse-spark-code?label=ACP%20agent%20(GitHub)&color=3b6cf6"></a>
  <a href="https://github.com/RandyNorthrup/muse-spark-code/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/RandyNorthrup/muse-spark-code/actions/workflows/ci.yml/badge.svg"></a>
  <a href="#install-in-your-editor"><img alt="Editors: VS Code-based (engine 1.99 or newer) and ACP" src="https://img.shields.io/badge/editors-VS%20Code--based%20%C2%B7%20ACP-2b7de9"></a>
  <img alt="WCAG 2.2 AA checked" src="https://img.shields.io/badge/WCAG%202.2-AA%20checked-2b7de9">
  <a href="#languages"><img alt="15 languages" src="https://img.shields.io/badge/languages-15-2b7de9"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-green"></a>
  <a href="https://www.paypal.com/donate/?hosted_button_id=Q9VC7B42R7K82"><img alt="Donate via PayPal" src="https://img.shields.io/badge/donate-PayPal-0070ba"></a>
</p>

**Muse Spark Code** puts Meta's Muse Spark model to work in your editor as a
coding agent: as an extension in VS Code, Cursor, Windsurf, VSCodium and other
VS Code-based editors, and through its ACP agent in Zed, JetBrains IDEs,
Neovim, Emacs and more ([install](#install-in-your-editor)). A chat panel streams answers, reads and edits your files with
reviewable diffs, runs commands behind permission modes, and delegates to
subagents you can watch and steer. It also remembers past conversations and
takes dictation from your microphone. It runs on your Muse subscription
through the Muse Code CLI, or on a Meta Model API key, and never hands the
key to the CLI.

> Unofficial. Not affiliated with or endorsed by Meta. "Muse Spark" and "Muse
> Code" are Meta trademarks. You bring your own credentials.

[Enjoying Muse Spark Code? A star on GitHub helps other people find it.](https://github.com/RandyNorthrup/muse-spark-code)

**Contents:** [What's new](#whats-new-in-0150) ·
[Highlights](#highlights) · [Screenshots](#screenshots) ·
[Get started](#get-started) · [Backends](#backends) · [Subscriptions](#subscriptions) ·
[Permission modes](#permission-modes) ·
[Rules, skills and memory](#rules-skills-and-memory) ·
[Muse Code's own tools](#muse-codes-own-tools) · [Web fetch](#web-fetch) ·
[Browser check](#browser-check) · [The panel](#the-panel) ·
[Voice dictation](#voice-dictation) · [Paid features](#paid-features) ·
[Languages](#languages) ·
[Limits](#limits) ·
[Commands](#commands-and-keybindings) · [Settings](#settings) ·
[Requirements](#requirements) · [Privacy](#privacy-and-security) ·
[Troubleshooting](#troubleshooting) ·
[Reporting a problem](#reporting-a-problem) · [Development](#development)

## What's new in 0.15.0

- **Bring your own models.** Add OpenAI, Anthropic and Gemini keys or local
  models in **Models & Agents**. ChatGPT sign-in is a Subscription Sharing
  preview for eligible Plus/Pro accounts; Copilot uses a compatible VS Code
  host's models. Features follow each selected model's capabilities.
- **Agent roles and teams.** Configure role pools, task limits and worker
  review. Paid workers require consent and share the daily budget.
- **/legal.** Scan licensing, copyright and source evidence without a model
  call, export the report, and confirm supported header repairs. The report
  states its coverage limits; it is not a legal certificate.
- **Automatic compaction and Pi/SoL-Pi sync.** The shared engine preserves
  packed output, literal recall and cache-stable prompts. Automatic compaction
  is implemented and its setting defaults on, but production remains inactive
  pending the paired evaluation.
- **Usage & Cost.** Open the local page for provider and team totals, token
  counts, budgets and exports. Reported, estimated and unknown costs stay distinct.

### Earlier in 0.14.5

- **Prompt actions in one small menu.** Save, share and use saved prompts
  from the bookmark button on the composer toolbar or the right-click menu;
  the three full-width buttons that covered the chat box are gone.
- **ACP Registry sign-in.** Clients that announce terminal sign-in the older
  way now get the sign-in option too.

### Earlier in 0.14.4

- **Save your prompts.** Right-click one of your own messages and choose
  **Save**, or save from the composer or editor. Your personal prompt library
  is available in every workspace; workspace prompts stay with their project.
- **Reuse prepared text.** Search the library and fill its variables before
  inserting a prompt. **Use** prepares the text; it does not submit a model
  request.
- **Share prompts and chats.** Choose a conversation-only or full export,
  review the exact Markdown, HTML or JSON preview, then confirm copying,
  saving or opening it in your browser. Confidential or unknown content is
  refused with an explanation; detected secrets and private paths are scrubbed.
- **ACP and terminal.** Use local `/prompt` and `/share chat` commands in ACP
  editors, or `muse-spark-code-acp prompts` and `share chat` in the terminal.
  Help & Reference lists the commands and the opt-in prompt sync setting.

### Earlier in 0.14.3

- **Questions never block.** A question Muse asks you is pinned in the
  attention dock above the composer and kept in the transcript. After a minute
  (`museSpark.questions.deferAfterSeconds`), Muse carries on with work that
  does not need the answer.
- **Answer later.** An unanswered question becomes an **Open question** you can
  answer any time using **Answer** on its transcript marker or the open-question chip; **Dismiss** closes it
  without an answer. A late answer reaches Muse once, as your own message, and
  approves nothing.
- **Find open questions.** The view badge, tab title and History show how many
  are open; **Next open question** and **Previous open question**
  (Ctrl+Alt+J and Ctrl+Alt+Shift+J) cycle through them.
- **ACP editors.** Editors with forms get each question as a form, withdrawn at
  the deadline (`--questions-defer-after`); other editors get the text.
  `/questions` lists open questions and `/answer <n> <text>` answers one.

- **Faster startup.** Optional panels and menus load when first opened, keeping
  the chat panel quick to start.

**0.14.2**

- **Help & Reference.** Type `/help` or run **Muse Spark: Open Help & Reference**
  for every command, setting, slash command, keyboard shortcut, CLI/ACP option
  and paid feature.
- **Search and copy.** Find features by name or shortcut, copy details, and open
  related settings.
- **Accurate details.** Help is generated from the extension's own tables.
  Defaults, availability and paid costs are now described for each backend.
- **Editors and terminal.** Use `/help` in the chat panel and ACP editors, or
  `muse-spark-code-acp help --all` in the terminal.

**0.14.1**

- **Safer shell commands.** Commands the agent runs no longer see your
  credential variables (API keys, tokens, passwords). Name any you want passed
  through in `museSpark.shell.passEnvironmentVariables`; scheduled and other
  unattended commands never get them.
- **Exact store badges.** The Marketplace and Open VSX pages show the version
  you are installing, not a cached older one.
- **Faster start.** The chat panel loads about 100 KiB less at startup; syntax
  highlighting, dialogs and Tasks load when first needed.
- **Fix:** stopped or timed-out commands on macOS and Linux now wait until
  their processes have exited.

**0.14.0**

- **Tab completions** (see [Tab completions](#tab-completions)). Alt+\ invokes
  ghost text. First-use consent names the model price and the separate
  $1.00/day default hard budget; your stored Model API key pays on either backend.
- **Git and pull requests** (see [Git and pull requests](#git-and-pull-requests)).
  Draft a commit or PR in the conversation, commit and push with confirmation,
  and open a foreign PR in a held worktree until you confirm its trust card.
- **Hooks and plugins** (see [Hooks](#hooks)). Import popular agent hook formats,
  run Setup and Manual hooks on both backends, and use bounded Amp and OpenCode
  plugins on the Model API backend. Hooks keep their permission and paid-use limits.
- **Report a problem** (see [Reporting a problem](#reporting-a-problem)). Preview
  the exact scrubbed report, remove items, then copy, save or open an issue.
  The report is built locally and the extension sends nothing.
- **Muse Judge phase 1** (see [Muse Judge](#muse-judge)). The conversation model
  can add uncalibrated caution to an approval; it cannot grant permission.
  Model API Judge asks for paid-use consent and shares the durable daily budget.

Earlier releases are in the
[changelog](https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md).

## Highlights

- **Streaming chat with tools you can see.** Every read, edit, write and shell
  command is a row in the transcript: green when done, pulsing while running,
  red when refused, grey when a stopped turn cut it off. Edit rows show the
  diff, the path opens the file with the changed lines selected, **Click to
  expand** opens VS Code's diff editor, and any output opens in an editor tab
  with a click.
- **Code intelligence from your editor.** The agent finds definitions,
  references, symbols and callers, reads hovers, maps the repository and
  renames symbols through VS Code's own language services instead of
  searching text, on both backends ([more](#code-intelligence)).
- **Permission modes, like Claude Code.** Manual, Edit automatically, Plan and
  Auto (Bypass behind a setting), switched from the mode button or
  `Shift+Tab`. Gated commands arrive as approval cards with the CLI's own
  choices; questions from the agent arrive as question cards with radios,
  checkboxes, tabs and an "Other" answer.
- **`/` for everything.** The palette holds the actions, the model, effort
  and thinking, the permission mode and your skills; type a letter after the
  `/` and it narrows to the slash commands, as in Claude Code.
- **Subagents on a map.** When Muse Code delegates, or the Model API backend
  runs the paid subagents you turned on, each agent is a row and an
  **N agents** pill opens the Agent map: role, status, tokens, each agent's
  own transcript, and the controls the backend offers.
- **Workflows you can follow.** When Muse Code runs a multi-agent workflow,
  the run is a card that keeps updating after the reply: its agents with
  their state, time and tokens, and the result it returned. Owner controls
  wait for a live accepted-command capture.
- **Reply and quote with context.** A reply's ⋯ menu has **Reply to this
  output**; highlight anything in the chat and right-click for **Ask about
  this** or **Comment on this**. The passage, its author and your intent
  travel with the message.
- **Voice dictation at no cost.** Tap or hold the microphone (`Ctrl+D`) and
  speak; the words land at the caret. Windows and macOS use the recogniser
  built into the operating system, so no audio goes to a paid service unless
  you turn on Muse Voice.
- **Paid extras, only if you ask.** On a Model API key: web search with its
  sources, image files made on request, and Meta's Muse Voice for
  dictation. Each is available by default on Model API; spending requires paid-use consent, marked
  paid wherever it is used, and tallied in Account & usage.
- **Scheduled prompts under your control.** On the Model API backend,
  `/loop` saves a recurring prompt in this conversation. A due prompt waits
  for you to run and confirm it; your key is never spent unattended.
- **Two backends, one per conversation.** Your Muse subscription through the Muse Code
  CLI, or a Meta Model API key (pay as you go) with the extension's own
  tools. The pasted key is never handed to the CLI.
- **Set up from the panel.** No Muse Code yet? **Install Muse Code** shows
  Meta's command and runs it in a terminal; **Sign in with your Meta
  account** shows its approval code in the panel.
- **Context the way you work.** `@` mentions with `.gitignore`-aware fuzzy
  search, the open file or selection as a chip, images (and, on the Model API
  backend, PDFs) pasted or dropped, and `Alt+K` to mention the editor
  selection. On either backend the agent can also read the Problems panel.
- **History that survives the window.** Every conversation in the workspace,
  searchable, resumable with its full transcript, archivable, with fork and
  rewind on every sent message. The sidebar picks its last conversation back
  up within ten minutes, and an editor-tab conversation comes back after a
  window reload.
- **Account & usage.** On Muse Code, your subscription's current and weekly
  windows; this conversation's tokens (and cache hits, on the Model API); and
  what has been eating your usage (reminder agents, subagents, long
  sessions), from `/usage`.
- **In your language.** English and fourteen more of VS Code's display languages, with the
  model's side kept in English so it behaves the same everywhere.
- **Accessible and observable.** Checked against WCAG 2.2 AA in every default
  theme, and a log that records what happened without what you wrote.
- **No telemetry, no hosted server of its own.** What leaves your machine and where
  it goes is written down in [PRIVACY.md](docs/PRIVACY.md).

## Screenshots

Rendered from the shipped panel by its own UI harness (`npm run
readme:shots`, one harness scenario per image) against a scripted session,
so they match the build.

<table>
  <tr>
    <td align="center" width="50%"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/turn.png" alt="A turn whose summary row, Read a file, edited 2 files, and ran a command, is open: Thought for 1s, Read, an Edit row with its diff and Click to expand, a Write row, a PowerShell row with its input and output; then the reply, Working…, and the diff tally 2 files changed +3 −1 with Review"><br><sub>A turn: thinking, read, edit with its diff, write and shell under one summary row, the reply, and the diff tally</sub></td>
    <td align="center" width="50%"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/agents.png" alt="The Agent map over a transcript: the 2 agents pill, this conversation, two agents, one running and one with its result ready, with their duration and tokens"><br><sub>Subagents: the <b>2 agents</b> pill and the Agent map</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/palette.png" alt="A slash typed in the prompt and the palette above it: Context actions, Git and pull request actions, and the model and effort controls"><br><sub>Type <code>/</code>: context, Git and model actions above the prompt</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/slash-commands.png" alt="The prompt holding /co and the ranked Slash commands list above it: /commit, /compact, /config, /cost, /changes, /clear, /export, /handoff and /help, each with its description"><br><sub>A letter more: the slash commands, ranked as you type</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/approval.png" alt="An approval card docked above the message box: Muse wants to Set-Content, step 1 of 2, a feedback box, and Allow once, Always allow in this workspace and Reject, one line each at one height; above it the diff tally, 2 files changed +3 −1 with Review; in the conversation the earlier steps fold into Read a file and edited 2 files, and the PowerShell row says it waits for your approval"><br><sub>An approval card, docked above the message box, with the CLI's own choices</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/question.png" alt="A compact Open question marker with Answer in the transcript and one question card pinned above the composer, with Colour and Toppings tabs, choices, Other, Submit and Explain instead"><br><sub>One question card, pinned above the message box; Answer on its transcript marker brings it into focus</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/quote.png" alt="A reply right-clicked in its highlighted passage: three blue pills, Copy, Ask about this and Comment on this, fanned out from the pointer"><br><sub>Highlight, right-click: <b>Copy</b>, <b>Ask about this</b> or <b>Comment on this</b></sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/rewind.png" alt="A sent message's menu with three blue pills: Fork conversation from here, Fork conversation and rewind code, and Rewind"><br><sub>Every sent message's ⋯: fork, fork and rewind code, or open <b>Rewind</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/modes.png" alt="The Modes menu: Manual, Edit automatically, Plan and Auto, with descriptions and the effort row"><br><sub>Permission modes and effort; <code>Shift+Tab</code> cycles modes</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/history.png" alt="The History dialog: sessions grouped by day, search, Show archived"><br><sub>History: search, resume, archive</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/usage.png" alt="The Account & usage modal on Muse Code: auth method, plan, backend, the current window and week bars, this conversation's tokens and context, what is contributing to usage by day or week, and Add Model API key"><br><sub>Account & usage: windows, tokens, and what is eating the usage</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/voice.png" alt="The composer listening: the red microphone and the Listening placeholder over a new conversation with its keyboard tips"><br><sub>Voice dictation: tap or hold, <code>Ctrl+D</code></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/open-question.png" alt="An Open question in the attention dock: Colour, Blue, Green, Other, Submit and Explain instead; its folded transcript row and the 1 open question chip with Previous and Next controls remain visible"><br><sub>Answer an open question from the dock; its transcript row and navigation chip keep it easy to find</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/help.png" alt="Help and Reference searched for Next open question, showing question-handling details, the deferral setting, and links to Next and Previous open question"><br><sub>Type <code>/help</code>: search the reference for features, commands, settings and shortcuts</sub></td>
  </tr>
</table>

## What's on out of the box

| Enhancement                                               | Default                                 | First use                                                                      |
| --------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| Observation packing                                       | On, Model API                           | Long outputs shrink after two requests; originals remain recallable            |
| Hooks                                                     | On, Model API                           | Inert without configured hooks; trusted workspaces only                        |
| Reply tokens and cost                                     | On, Model API                           | Display only                                                                   |
| Images, Auto reviewer, child agents and scheduled prompts | Available, Model API                    | Price and shared daily budget in Allow once / Allow always / Deny popup        |
| Hosted search and Muse Voice                              | Available, Model API                    | Transport refused under the finite daily cap until billing bounds are verified |
| Best-of-N                                                 | Available as a separate explicit action | Ordinary turns still use one model; its dialog and consent name extra attempts |
| Dictation                                                 | Free OS recognizer                      | Paid engine choice is separate (`dictationEngine`)                             |
| Repo map in the prompt                                    | Off                                     | Q11 awaits its paired M75 arm; the repo-map tool remains available             |

Explicit `false` settings stay off. Interactive paid extras share
`museSpark.paidDailyBudgetUsd`: $5/day by default, $0.50–$500, machine-scoped,
across windows, workspaces and keys in this extension profile. The local
calendar day owns each durable reservation. Known usage settles its estimate;
unknown sent usage keeps its full reservation. Corrupt or incomplete storage
counts as budget reached and refuses paid requests. At the limit choose
**Raise for today** or **Stop until tomorrow**; both choices are shared on disk.
Stop remains in force even if another window's pending raise finishes later.
Cancelling admission refunds an unsent request; late budget-dialog answers
cannot change today's policy. Switching backends preserves accepted prices
and workspace **Allow always** grants; explicitly turning a feature off
withdraws them. While observation packing is on, Muse can recall packed output.
Tab's $1/day cap is separate and is never charged into this extras ledger.
The optional per-conversation cap still applies independently. ACP and
headless execution retain explicit flags and their hard budget policy.
Muse Code's subscription and its existing explicit key-paid opt-ins are unchanged.

## Get started

1. Install **Muse Spark Code** from the
   [Marketplace](https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code)
   (VS Code 1.99 or newer), or from a `.vsix` attached to a
   [GitHub Release](https://github.com/RandyNorthrup/muse-spark-code/releases):

   ```bash
   code --install-extension muse-spark-code-0.14.0.vsix
   ```

2. Open the **Muse Spark** view from the activity bar (or press
   `Ctrl+Shift+Alt+Esc` on Windows, `Cmd+Shift+Esc` on macOS,
   `Ctrl+Shift+Esc` on Linux for a conversation in an editor tab).
3. If Muse Code is missing, **Install Muse Code** opens a confirmation dialog
   showing Meta's exact command for this operating system. The same action is
   in **Account & usage** while you work with a Model API key. **Run installer**
   opens a visible VS Code terminal;
   the panel checks for the CLI and offers sign-in when it appears. You can also
   open [Meta's installation instructions](https://dev.meta.ai/products/muse-code/).
   If VS Code cannot open the installer terminal, the panel reports that
   directly and keeps the manual instructions available.
   Sign in, one of two ways:
   - **Sign in with your Meta account** shows an approval code in the panel.
     Open its sign-in page in your browser and approve the code within ten
     minutes, before it expires. **Cancel sign-in** stops the temporary CLI
     sign-in process; if the browser approved just before, the panel
     follows what Muse Code saved. If you deny the code, it expires, or Muse
     Code cannot save the sign-in, the panel says so; an ending Muse Code
     has not been seen to send is shown in its own word. Work is billed to
     your Muse subscription.
   - **Use a Model API key** takes a key from dev.meta.ai (Meta's current
     keys start with `LLM_`; older ones look like `LLM|<id>|<secret>`),
     stores it in VS Code's secret storage and runs the Model API backend
     with the extension's own tools, pay as you go. **Account & usage** lets
     you add or replace that key while Muse Code is signed in; there the key
     pays only for paid features you turn on. After a CLI install, **Account
     & usage** also offers **Sign in with your Meta account**.

   Signing out ends the old account's conversations and clears them from the
   panel; your unsent draft stays. If sign-out cannot finish, see
   [Troubleshooting](#troubleshooting).

4. Type a message and press `Enter`. `/` shows the palette, `@` mentions a
   file, the microphone dictates.

VS Code opens the extension's four-step walkthrough on install; **Muse
Spark: Open Walkthrough** brings it back.

### What's New after an update

When the extension updates, **What's New in Muse Spark Code** opens in an
editor tab (it works the same in VS Code's forks and remote windows): each
new release's Highlights, with a **Try it** button where there is a command
or setting to try, then its notes from the CHANGELOG. Full notes ship for
the newest two releases; when neither has Highlights, the page also carries
the newest earlier Highlights. Older upgrades can follow the page's full
changelog link for all intervening details. It shows once per
update and in one window only, waits until no turn is running and you have
stopped typing, and does not take the keyboard. After a fixes-only patch a
quiet notification offers it instead. A fresh install shows nothing. **Muse
Spark: What's New** (or **What's New** in the panel's palette) opens it any
time; `museSpark.showWhatsNewOnUpdate` or the page's **Don't show on
updates** box turns it off. The page's words follow your display language;
the release notes are in English.

Each panel is its own conversation, started on the first message with the
standard `muse-spark-1.3` model (never a contributor-tier model by default).
The model pill shows the model as soon as the panel opens.

## Tab completions

Tab is **on by default**. Press `Alt+\` in a code editor to request ghost
text, then **Tab** to accept or **Esc** to dismiss it. The status bar shows
Tab from startup; click it for **Tab Menu**, languages, multi-line mode,
snooze, Copilot choices and Account & usage. The Command Palette also has
**Muse Spark: Turn Tab On**, **Turn Tab Off**, **Snooze Tab**, **Tab Menu** and
**Tab Languages**.

Tab uses your stored **Model API key**, on either chat backend; your Muse
Code subscription never pays for it. With no key the status says **no key**
and sends nothing. Before the first charge in a window, it asks with the
model's rates and your budget: **Allow once** covers that window until it
closes, **Allow always in this workspace** remembers revocable consent, and
**Deny** snoozes Tab in that window. Closing the question denies it too.

The hard daily budget defaults to **$1.00 across every window on this
machine**, reserved before each request. The status shows today's spend;
Account & usage shows requests, tokens, cached tokens, today's cross-window
total, this window's reported cost and your configured budget. Requests
without reported usage retain their worst-case reservation. The next local
day, or a larger budget, permits requests again. At the probe's token counts,
Standard's projected average was $0.00242 per fast request and $0.00706 per
multi-line request; actual usage and cache hits change the cost.

Invoke is the default trigger because the contributor-model probe measured
**3.8 seconds median to first text** (p95 8.4 seconds); Standard latency is
assumed equal, not measured. `museSpark.tabTrigger: automatic` opts into
requests after a 350 ms typing pause. At most two requests are open and
20 start per minute. A sent request finishes for accounting even if you
type past it; its answer remains available to the typing-through cache.

All Tab settings are machine-scoped:

| Setting                       | Default                                      | Effect                                                                                                                                                             |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `museSpark.modelApiTab`       | `true`                                       | Offer Tab, with consent required before the first charge.                                                                                                          |
| `museSpark.tabModel`          | `muse-spark-1.3`                             | Standard: Meta does not train on your code. The cheaper `muse-spark-1.3-contributor` tier trains on the code sent.                                                 |
| `museSpark.tabDailyBudgetUsd` | `1`                                          | Hard local-day USD limit, from $0.05 to $50.                                                                                                                       |
| `museSpark.tabLanguages`      | All except plaintext, Markdown and SCM input | Per-language switches over a `"*"` default, like Copilot's enable setting.                                                                                         |
| `museSpark.tabMultiline`      | `auto`                                       | Automatic requests add context on a blank line or block opener; `onInvoke` and `never` keep automatic requests in fast mode. Explicit Invoke uses multi-line mode. |
| `museSpark.tabTrigger`        | `onInvoke`                                   | Alt+\ or **Inline Suggest: Trigger**; `automatic` enables typing triggers.                                                                                         |
| `museSpark.tabWithCopilot`    | `yield`                                      | Yield automatic requests in languages Copilot serves; Invoke works. **Run both** opts in; turning off Copilot's suggestions asks before changing its setting.      |

Fast mode uses the current file. Multi-line mode adds bounded excerpts of
recent edits and definitions on the cursor's line, ordered by path. Every
file passes the same privacy checks: trusted workspace, inside its folder
including resolved links, private/protected names, git ignores,
`.cursorignore`, `.continueignore`, `files.exclude` and the size limit.
Secrets are redacted before excerpts are cut. Related unsaved buffers use
a conservative UTF-8 size bound. Tab has its own cache and never reads or
changes a chat's history or memory.

**Inline Suggest: Accept Next Word** (**Ctrl+Right**, **Cmd+Right** on macOS)
and **Inline Suggest: Accept Next Line** (assign a key in Keyboard Shortcuts)
accept part of a suggestion; typing through serves its rest without another
request. Snooze offers 15 minutes, an hour or until this window restarts.
Copilot's sign-in state cannot be detected, so an installed active Copilot
can cause yielding even when signed out.

Cursor's `beforeTabFileRead` and `afterTabFileEdit` hooks remain planned for
lane K after M91; this build has their host bridge but does not run those
hook configurations yet. The probe receipts and current limits are in
[the M94 record](docs/certification/m94.md).

## Backends

| Backend                                                                      | Sign-in                                                          | Billing                | Tools                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Muse Code CLI** (`muse serve`, Muse Session Protocol via `@muse-code/sdk`) | The CLI's own device-code browser sign-in                        | Your Muse subscription | The CLI's, inside its OS sandbox where that works (see `shellSandbox`); its bundled skills, your user rules, its own memory, subagents, and the Problems panel through the extension                                                                                               |
| **Meta Model API** (`https://api.meta.ai/v1`)                                | A key from dev.meta.ai, kept in SecretStorage, sent only to Meta | Pay as you go          | The extension tools: read, edit, write, search, list, shell, skills, questions, todos, goals, memory and diagnostics; configured MCP servers; trusted configured hooks and bounded paid subagents; paid extras with consent and daily budget admission; workspace rules and skills |

`museSpark.backend` picks: `auto` (default) uses the CLI when it is installed
and signed in, otherwise the Model API when a key is stored; `museCode` and
`modelApi` force one. The palette's **Backend** row shows which one this
window runs on. The CLI looks for `muse` through `museSpark.museBinaryPath`,
then `PATH`, then the platform's install folder (`%LOCALAPPDATA%\Programs\muse`
on Windows, `~/.local/bin` elsewhere).

Conversations on the Model API backend are saved as they go under VS Code's
workspace storage for the extension, so the History dialog lists them after
a reload, and a resumed one continues with its transcript and its edit
patches while the same Model API key is stored. History, resume, reads and
forks are limited to that key's sessions. Replacing the key starts a fresh
conversation; older sessions remain on disk for their original key. Sessions
saved before ownership was recorded remain on disk but cannot be reopened
because their account cannot be proved. The CLI backend keeps its own session
store. Replacing its secondary Model API key keeps the Muse Code conversation
running. A paid image awaiting its popup or a retry stops if that key changes;
the old request cannot use the new key. If the panel itself
ever fails to render, it shows the error and a **Reload** button instead of
going blank; Reload brings the conversation back as it was, running turn and
waiting cards included.

Sign-out and account replacement clear the panel's transcript, loaded tool
output, agent transcripts and retained file chips before another account
signs in. Unsent draft text stays in the composer. When an installer makes a
signed-in Muse Code CLI available in `auto` mode, the current Model API
session ends before the next message starts a fresh CLI session.

## Other editors

The same two backends run outside VS Code as `muse-spark-code-acp`, an
agent for editors that speak the Agent Client Protocol (Zed, JetBrains IDEs,
Neovim, Emacs and others), attached to each GitHub Release since 0.10.0 and
published to npm since 0.11.0.
[docs/acp.md](docs/acp.md) covers installing it, where it keeps a Model API
key (the operating system's credential store), and the editor's settings.
VS Code forks built on VS Code 1.99 or later install the extension itself,
from Open VSX or a `.vsix`.

### Install in your editor

Get it from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code),
[Open VSX](https://open-vsx.org/extension/RandyNorthrup/muse-spark-code) or
[GitHub Releases](https://github.com/RandyNorthrup/muse-spark-code/releases)
(both the `.vsix` and the agent's `.tgz`).

| Editor                                                   | How                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VS Code**                                              | Search **Muse Spark Code** in the Extensions view, or run `code --install-extension RandyNorthrup.muse-spark-code`                                                                                                                                 |
| **Cursor**                                               | Search **Muse Spark Code** in the Extensions view (Open VSX), or download the `.vsix` from the [latest release](https://github.com/RandyNorthrup/muse-spark-code/releases/latest) and run `cursor --install-extension muse-spark-code-0.14.0.vsix` |
| **Windsurf (Devin Desktop), VSCodium, Kiro, Positron**   | Search **Muse Spark Code** in the Extensions view (Open VSX); in VSCodium also `codium --install-extension RandyNorthrup.muse-spark-code`. Any of them: **Extensions: Install from VSIX…** with the release's `.vsix`                              |
| **JetBrains IDEs** (IntelliJ IDEA, PyCharm, WebStorm, …) | Install the ACP agent (below), then add it to AI Assistant (below). Not yet tested here                                                                                                                                                            |
| **Zed**                                                  | Install the ACP agent (below), then add it to Zed's settings (below)                                                                                                                                                                               |
| **Neovim, Emacs, JupyterLab**                            | Install the ACP agent (below), then follow [docs/acp.md](docs/acp.md#configure-the-editor) (CodeCompanion, agent-shell, Jupyter AI)                                                                                                                |

**The ACP agent** needs Node.js 22 or later. Install it from the release:

```bash
npm install -g https://github.com/RandyNorthrup/muse-spark-code/releases/download/v0.14.0/muse-spark-code-acp-0.14.0.tgz
muse-spark-code-acp --version
```

**Zed** (tested with Zed 1.20.2): add this to `settings.json`, then pick
Muse Spark under External Agents in the Agent Panel's new-thread menu.

```json
{
  "agent_servers": {
    "Muse Spark": {
      "type": "custom",
      "command": "muse-spark-code-acp",
      "args": [],
      "env": {}
    }
  }
}
```

**JetBrains IDEs**: in the AI Chat tool window choose **Add Custom Agent**,
which opens `~/.jetbrains/acp.json`, and add the agent under
`agent_servers` ([JetBrains' ACP guide](https://www.jetbrains.com/help/ai-assistant/acp.html)).
This setup follows JetBrains' documentation and has not been tested here yet.

```json
{
  "default_mcp_settings": {},
  "agent_servers": {
    "Muse Spark": {
      "command": "muse-spark-code-acp",
      "args": []
    }
  }
}
```

Add `"--backend", "modelApi"` to `args` in either editor to use the Model
API backend instead of Muse Code.

**ChatGPT subscription sign-in (M95b preview):** terminal-capable ACP editors
offer Continue with ChatGPT, Remove and Check; other editors show the same
commands to run by hand:

```sh
muse-spark-code-acp providers add chatgpt
muse-spark-code-acp providers status chatgpt
muse-spark-code-acp providers remove chatgpt
```

Add requires Plus or Pro, prints the plan/credit notice and the browser URL,
and saves only eligible models from the account's own catalogue in the
user-level providers file. Tokens stay in the OS credential store. Status
reads local state without a network request; Remove attempts revocation and
clears local sign-in and configuration. If the store is unavailable, sign in
from an interactive desktop session with an unlocked store (Linux also needs
Secret Service). These commands certify sign-in management; combined M95b
model dispatch and editor acceptance still await integration certification.

**On Windows**, npm installs `muse-spark-code-acp` as a `.cmd` launcher,
which some editors cannot start. If the editor says it cannot find or start
the agent, use `node` as the command and the agent's script as the first
argument, before any others. `<npm root -g>` is the folder `npm root -g`
prints, usually `%APPDATA%\npm\node_modules`. This form works on every
platform ([docs/acp.md](docs/acp.md#install)).

```json
{
  "command": "node",
  "args": [
    "C:\\Users\\<you>\\AppData\\Roaming\\npm\\node_modules\\muse-spark-code-acp\\dist\\acp.js"
  ]
}
```

[docs/ide-compatibility/hosts.md](docs/ide-compatibility/hosts.md) records
which editors have been tried: so far VSCodium, code-server, Eclipse
Theia, Cursor, Devin Desktop (formerly Windsurf), Kiro and Positron with
the extension, and Zed, Emacs (agent-shell), Neovim (CodeCompanion) and
JupyterLab (Jupyter AI) with the agent.

## Subscriptions

Subscription sign-in is being integrated under M95b; installed-editor and live
success certification is still pending ([record](docs/certification/m95b.md)).
In **Models & Agents → Providers**, choose **Continue with ChatGPT** or
**Use my Copilot models**. The same actions are available in the command palette.
Connecting selects the shared in-process harness and the account's first
eligible model; the model picker can select another catalogue model.

**ChatGPT:** OpenAI's sanctioned Subscription Sharing preview accepts eligible
**Plus and Pro** accounts. Free and other ineligible accounts cannot use this
flow. The system browser signs in with OpenAI, with a local loopback callback;
remote VS Code windows currently require signing in from a local window.
Models come from your account's catalogue, rather than a fixed example model.
The conversation, tools and tool results spend your ChatGPT plan. **Manage
usage** opens the provider's limits page. A limit reached inside a successful
HTTP stream stops the turn and offers usage management. Remove revokes the
grant and deletes this product's secret record.
The plan notice is remembered for each verified account. Older grants without
that identity keep showing it until a verified sign-in or refresh supplies it.

**Copilot:** available only in VS Code hosts exposing `vscode.lm`, using the
host's Copilot consent. Select it again after reloading the window. It spends
your Copilot plan or AI credits under GitHub's terms. Models are marked
**reduced**: token counts are estimates, server reasoning/cache details are
unavailable, and images are refused unless the host adapter has a verified
image capability. Quota and consent errors are explained; confidential
workspaces hide and refuse Copilot. The AI-content note and report link remain
visible with its plan mark. Other editors use ChatGPT through the shared ACP
runtime's existing add/status/remove actions and authentication menu (configure
`--backend model-api`); Copilot
requires VS Code's Language Model API. JetBrains, Visual Studio, Eclipse,
Zed, Xcode, Neovim, Emacs and Sublime use their own Copilot plugin for
Copilot, and this product's shared ChatGPT/API-key routes where implemented.
The ACP agent has no Copilot token route and reads none of Copilot's credential
storage. A compatible extension host must actually expose `vscode.lm`;
a VS Code-like interface alone does not provide it.

Plan requests never consume the harness's USD cap or open its paid-use popup.
Account & usage counts each dispatched request, with reported ChatGPT tokens
and estimated Copilot tokens kept separately. Optional paid extras continue
to require their own supported credential and consent; a subscription does
not pay for them. The captured **Mistral plan** preset now uses the same
origin-bound key transport in VS Code and ACP, shows **plan** in the picker,
links its plan limits, and counts reported tokens and every dispatched
attempt. Its key is read from each host's credential store immediately
before sending. Configured API-key and local providers share the captured
Responses, Chat Completions, Anthropic, Gemini and Ollama codecs; redirects
are refused and each request pins checked DNS answers. ACP reads the same
user-level `providers.json`, using its own OS credential store. The terminal
offers `providers list`, `providers add`, `providers test`, `providers remove`
and `auth set|status|clear --provider <id>`. Free checks use the shared
transport; keys are entered through stdin and stored with their origin.
Headless `exec --provider` validates configuration, credentials and endpoints,
then refuses before dispatch until its provider-aware accounting runner exists;
installed-editor and live provider certification are still open. MiniMax
and Alibaba plan presets await captures, and Hugging Face OAuth awaits
application registration.

OpenRouter models accept pasted keys. Account connection and key-usage reads
are not available yet; Models & Agents hides those actions and says why.
Scan this computer probes each local preset's loopback port and model-list path.
Provider exports include subscription configuration without credentials. A
confirmed import requires credentials to be entered again, clears credentials
for imported and removed ids, and replaces providers and the validated default
model together. Cancelled or invalid imports leave configuration and keys intact.

## Questions

The integrated question paths, fake-only checks and the 2026-10-06 live checks
through the ACP agent on both backends are recorded in
[M112's certification](docs/certification/m112.md); installed-editor checks
remain with the release lead.
The integrated panel pins agent questions in the attention dock above the
composer, after approvals, and keeps only a compact marker in the transcript. After
one minute Muse continues work that does not depend on the answer. The card
becomes an **Open question**. Its compact transcript marker keeps the icon,
title and **Answer** button. Answer reopens the pinned card and focuses its first
control, even after deferral; the open-question chip also opens it. A card with
focus or a draft stays expanded. **Dismiss** closes an open
question without guessing an answer. Approvals still wait for your decision;
MCP forms keep their five-minute expiry and cannot be answered after expiry.

**Next open question** and **Previous open question** cycle through the open
cards. In a focused VS Code chat their keys are Ctrl+Alt+J and
Ctrl+Alt+Shift+J (Cmd+Option+J and Cmd+Option+Shift+J on macOS). The view badge,
tab title and History marker show the count. Native editors use their own
bindings: these keys conflict with defaults in JetBrains and Visual Studio.

`museSpark.questions.deferAfterSeconds` is machine-scoped: 60 by default,
0 to wait indefinitely, otherwise 10–3600 seconds (1–9 are read as 10).
A workspace setting cannot change it. Open questions survive a reload and
resume, with at most 20 open per session and two reminders per question.
A late answer is your own message in the current mode and approves nothing.
In the panel it steers a running turn or starts a new one, billed normally.

In ACP, a client with forms gets a form that the agent withdraws at the
deadline. A client without forms gets the text and immediate deferral,
including with a deadline of 0. `/questions` lists open questions;
`/answer <n> <text>` answers one by its displayed number. A late form answer
or `/answer` steers a running prompt, or is kept before your next message
when idle. It is announced as queued until the next prompt sends it. Stop
cancels the backend without waiting for question storage. The agent announces
these commands alongside skills. Configure
its deadline with `--questions-defer-after <seconds>`; the default and limits
match the setting. [The ACP guide](docs/acp.md#questions) explains the details.

Headless `exec` still declines questions immediately, reports
`question_declined`, and starts no question clock. Best-of-N, worktree
conversations and the evaluation keep their immediate cancellation or
clarification. Scheduled/unattended prompts defer at once and keep the
question open, even when interactive deferral is disabled.

## Permission modes

| Mode                   | Model API backend                                                                                                                                                                                       | Muse Code backend                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manual**             | Asks before every edit and every command that no allow rule, session allowance or hook settles                                                                                                          | The CLI decides: it applies file edits without asking (only `.git`, `.muse` and `.agents` ask) and asks before commands its own allow rules do not cover                   |
| **Edit automatically** | Approves plain file edits, asks before commands that no allow rule, session allowance or hook settles                                                                                                   | The same as Manual: under `muse serve` the CLI raises no file-edit approval to answer                                                                                      |
| **Plan**               | Refuses edits and commands                                                                                                                                                                              | The CLI refuses protected writes and the commands its own allow rules do not cover, but its file tools still edit without asking ([Plan on Muse Code](#plan-on-muse-code)) |
| **Auto**               | Runs edits (protected writes ask), asks before commands; the paid, off-by-default [Auto reviewer](#auto-rules-and-permission-profiles-model-api) may allow plain commands and MCP calls no rule settles | The CLI runs simple commands; [eligible approvals](#the-auto-reviewer-on-muse-code) are reviewed, with card fallbacks                                                      |
| **Bypass**             | Only with `allowDangerouslySkipPermissions`; nothing asks except paid uses and a hook that demands a card                                                                                               | The same, except paid uses and [web fetch](#web-fetch), which the extension asks about before every call                                                                   |

A paid use asks in the paid-use popup in every mode, Bypass included, unless
you allowed it always in this workspace; on the Model API backend, Plan
refuses paid images and child tasks.

Through 0.11.0 the Modes menu said Auto on Muse Code approves "actions that
pass a safety check". It did not: `muse serve` has no approval judge (the
CLI's LLM judge runs only in its interactive and `exec` commands), so Auto
skipped only the commands the CLI classifies as simple, and every script
asked (PLAN.md D69). The menu now says what each mode does on each backend.

### The Auto reviewer on Muse Code

In Auto on the Muse Code backend, an approval Muse Code raises for the
running turn that no rule settles may go to a reviewer before it reaches you. The reviewer is the
Model API backend's Auto reviewer (its instructions, its input and its
strict answer), run as one short turn of a hidden side session in the same
`muse serve`, on your Muse subscription: Plan mode, thinking off, the
conversation's model, in an empty folder of the extension's own, so it reads
none of your workspace files, rules or skills in the captured setup and is never listed in History. CLI-global context is not excluded. It answers ALLOW or ASK
with a reason:

- **ALLOW**: the approval is answered _Allow once_ (never an "always"
  choice), for each stage while its subject and user request stay the same. The tool row says
  "Decided: approved (Auto reviewer)" with the reviewer's reason.
- **ASK**, an answer it cannot read, no answer within 45 seconds, an error,
  or a side session still busy: the card asks you as before, with the
  reviewer's reason on it when there is one.

After three declines or failures in a row, or ten of the last fifty, it
stops until your next message. It is never asked about anything the
extension's own rules answer, a protected write, a paid call, a child
task, a question, an escalated or unknown subject, an approval without
an allow-once choice, or a request in Manual, Edit automatically, Plan or
Bypass, or one replayed to a second panel. Two panels sharing the session
also go straight to cards. One review runs at a time in a
window. The first review in a window says so in a notice. Each review is
one short Muse Code turn: the live check counted four model attempts
(the reply and three of Muse Code's own reminder agents) and about 33,000
input tokens, most of them Muse Code's own instructions. Turn it off with
`museSpark.museCodeAutoReviewer`.

Plan mode does not disable Muse Code's native tools: the SDK's
`SessionConfig` only configures `mcpServers`. Any item other than the
prompt's echo, Muse Code's reminder agents, reasoning or the reply cancels
the review turn, shows the card with the generic failure reason, and
recreates the side session. A command covered
by your always-allow rule could run in the empty folder before the cancel
lands. The verdict text itself is never executed. A changed subject or an
accepted new message or steer invalidates the old verdict. The side session
is also recreated after host exit/restart, closure, timeout or busy fallback,
a model change, and ten reviews. Only a completed reply in a successfully
completed turn can allow an action; the 45-second deadline includes setup.

A Manual approval still needs your answer if you open the conversation
in another panel set to Edit automatically. Joining a conversation never
approves a card that was already waiting. A Manual panel's new edit
approval also stays Manual when an older Edit automatically panel remains
open on that conversation. While two panels share a conversation, every
approval needs an explicit choice. Edit automatically resumes when it is
the only panel holding that session.

"Always allow in this session" on a command allows that exact command line
again, nothing broader; on an MCP tool, that tool; on a [web fetch](#web-fetch),
that host. On the Model API backend a web fetch asks in Manual, Edit
automatically and Auto, and Plan refuses it; on Muse Code the extension asks
before every fetch, whatever the mode. An MCP tool asks like a
command on the Model API backend; Auto runs one its server marks read-only
without asking, as Muse Code does, and Plan refuses all but those, which ask. The Model API backend's file tools refuse any path
that leaves the workspace, including through a symbolic link or junction
inside it (only `read_file` may read under a permission profile's
`extraRoots`). Muse Code refuses such a write while its sandbox runs
("absolute path is outside the workspace"). Without the sandbox
(`shellSandbox` set to `off`, or `auto` for a Windows workspace under your
profile) its file tools can write anywhere your account can, and Muse Code
asks before none of those writes, in any mode, Plan included: Meta's
[permissions page](https://dev.meta.ai/docs/muse-code/permissions) says
`--disable-sandbox` "also removes workspace confinement from the file
tools", and probes of 1.4.2 on 2026-10-04 confirmed it
([certification](docs/certification/musecode-write-asks.md)). The panel
warns once per window when Muse Code runs without its sandbox, and
**Muse Spark: Diagnostics** says where its file tools can write.

**Protected writes.** On the Model API backend, writes to files that
configure or run code always ask, whatever the mode: `.git`, `.husky`,
`.vscode`, `.idea`, `.devcontainer`, `.github/workflows`, `.agents` (the
agent's own skills and memory), `.muse` (Muse Code's hooks), other coding
agents' folders, whose hooks, MCP servers, plugins and settings those agents
run on their own (`.claude`, `.codex`, `.cursor`, `.gemini`,
`.github/hooks`, `.github/copilot`, `.devin`, `.windsurf`, `.kiro`,
`.clinerules`, `.amp`, `.opencode`, `.continue` and `.roo`), their MCP
server and instruction files (`.mcp.json`, `opencode.json`,
`opencode.jsonc`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`,
`.windsurfrules`, `.roomodes`, `.clinerules` and
`.github/copilot-instructions.md`), `.envrc` and `.gitmodules`. An
instruction file runs nothing, but it steers the next agent that reads it,
so a planted instruction would outlive the conversation. They match at any
depth and in any letter case, and a link or junction is judged by the
folder it leads to. Plan refuses them and Bypass skips the card.

On Muse Code the CLI decides which writes ask. When it asks about a file
write that is its own protected write or on the list above, the card says
"Protected write", "Edit automatically" and the Auto reviewer never answer
it, and the card offers no "Always allow" rule. That holds wherever the
file is, `~/.claude/settings.json` outside the workspace included. A write
Muse Code makes without asking never reaches the extension: in a live check
(Muse Code 1.4.2, sandbox off, as for a workspace under your user profile)
it wrote `.claude/settings.json` and a file outside the workspace without
asking, even in Manual. A note saved with the memory tools is
the one exception under `.agents`: those tools write only Markdown notes in
the memory folders, so they are treated as ordinary edits (see
[Memory](#memory)). Muse Code 1.4.2 itself asks only before writes to
`.git`, `.muse` and `.agents`; every other file, other coding agents'
folders such as `.claude` and `.cursor` included, it writes without a card
in every mode, so none of those writes reaches the panel.

### Plan on Muse Code

Plan selects Muse Code's `denyUnmatched` mode. It refuses the commands its
own allow rules do not cover and writes to `.git`, `.muse` and `.agents`, but Muse Code's file tools still
edit other files without asking: inside the workspace with the sandbox,
anywhere without it (probed on 1.4.2, 2026-10-04). The model is asked to
plan, and in practice it does, but nothing stops an edit it makes. A
read-only plan mode needs Muse Code's Read-only permission profile, which
`muse serve` cannot select yet
([meta-models/muse-code-sdk#43](https://github.com/meta-models/muse-code-sdk/issues/43)).

### Plans as files

In Plan mode, the latest reply gets two buttons once it has finished, when
the message it answers was sent in Plan mode; a press is refused unless the
turn stayed in Plan mode.
Pressing either one approves the plan; neither backend marks a plan or its
approval any other way. The extension reads the reply back from the backend
on every press, so after a restart it resumes the conversation first, and it
says why when it cannot.

- **Save plan** writes the plan to `.agents/plans/YYYY-MM-DD-<slug>.md`.
  This is where Muse Code's own `plan` skill keeps plans. The slug comes
  from the plan's top-level heading, or else from your request. When the
  name is taken, the file gets `-2`, `-3` and so on; an existing file is
  never replaced.
  - The file holds the plan byte for byte. On Muse Code, a plan reply opens
    with the skill's "This is a plan, not a special mode…" line and closes
    with its "Reply `go` to execute this plan…" line; those two lines are
    left out. Any other reply is saved whole.
  - Pressing again the same day finds the file already saved with the same
    content and writes nothing.
  - `.agents` is a protected folder, so the save asks first.
  - A plan may be up to 256 KB.
  - The file is published by a hard link; on a file system without hard
    links the save is refused rather than risk replacing a file.
  - The reply you approve is shown as the model will get it: a link's
    destination follows its text (`details <https://…>`), a picture is its
    alt text and source, and definitions, footnotes, titles and a code
    block's whole info string are shown as text. Raw HTML (a comment, a
    tag) is the one thing the panel never shows: a plan holding it is saved
    with a warning to read the file. A plan holding a control or format
    character (a direction override, a zero-width character), which the
    panel would paint otherwise than the model reads it, is neither saved
    nor started. That includes emoji joined with U+200D (👨‍👩‍👧) and the
    left-to-right and right-to-left marks some right-to-left text uses.
  - Restricted Mode saves nothing.
- **Implement in a fresh conversation** saves the plan (unless it is
  already saved), then starts a new conversation on the same backend:
  - the plan is attached as named text, the same way a picked text file
    is (both backends), written from what the panel showed of it, so
    every character the model gets is one you saw;
  - nothing else from the planning conversation comes along, and it stays
    in History;
  - Plan mode gives way to your starting mode (`museSpark.initialPermissionMode`,
    or Manual when that is Plan; never Bypass in a remote window), except
    that a plan replied over imported history starts in Manual (Plan when
    that is your starting mode);
  - a plan holding raw HTML is saved but not started: read the file, then
    implement it from Plans….
- **The todo list.** On the Model API backend, the plan's numbered steps
  (or its bullets, when nothing is numbered) become the todo list before
  the first request, and the brief tells the model what they are. Muse Code
  keeps its todo list to the model, and MSP has no command to set it, so
  there the brief asks Muse to put the plan's steps on its list.
- **Plans…** in the palette lists the saved plans, newest date first, to
  open one or implement it. A plan file may come from anywhere (a cloned
  repository, a tool), so implementing one from Plans… starts in Manual
  (Plan when that is your starting mode), whatever your starting mode is,
  and tells the model nobody confirmed who wrote it.

A side chat stays in Plan mode, so it offers only Save plan. Implementing a
saved plan is refused in Restricted Mode, because its content goes to the
model as workspace text. Implement and handoff Start share one operation
lock: either asks you to wait while the other is still starting.

### Handoff to a new conversation

`/handoff`, optionally with a goal after it, asks the model — as your own
turn in the current conversation — for a distilled brief of it: the goal,
the decisions, the files touched, the open work and the todo list. The
model is asked to mark anything drawn from tool output, fetched pages or
imported files `[untrusted]` in the brief (nothing checks that it did), and
the new conversation is told what that mark means. The brief opens in a dialog before anything starts, with the open
items the new todo list will hold under **Tasks**: review it, edit it if
you need to, then **Start new conversation**, or **Cancel** and nothing
starts. Starting leaves the old conversation in History and seeds the new
one with the brief alone — the goal and the open items travel in its note,
and on the Model API backend the open items become the todo list before
the first request. The generated or edited brief may be up to 256 KB in
UTF-8. Cancel closes a handoff before the new conversation commits. A
brief that is ready while Account & usage, the Agent map or a share file is open waits
until you close that dialog, then opens.

While the model distils the brief, a composer send is refused with the
busy reason. Its images come back, and its exact draft comes back if you
have not edited it meanwhile. A brief read held by sign-in or key activation says
why and retries when sign-in completes, including a read that failed
while admission was held. Cancel still releases the waiting handoff.

The model wrote the brief, so the new conversation starts in your
starting mode (`museSpark.initialPermissionMode`, as an implemented plan
does: Manual when that is Plan, never Bypass in a remote window) only
when the dialog showed you all of it. A brief or an open item holding a
character the dialog does not show (a direction override, a zero-width
character) starts in a mode that asks, Manual (Plan when that is your
starting mode), and the panel names the mode. A handoff from a
conversation in Plan mode stays in Plan.

Automatic compaction, its exact todo continuation and the memory flush are
implemented in the shared Model API engine, but **awaiting evaluation and
inactive**. `museSpark.modelApiAutoCompaction` defaults to `true`; set it to
`false` to turn the mechanism off. ACP and headless use the same core and
accept `--no-auto-compaction`. Muse Code continues to compact itself.

Once a current M75 pair passes and the shared paid gate/ledger is connected,
compaction is considered inside your turn after a settled tool batch. A
registered todo completion can trigger it when the expected token saving
repays the summary call, cache-write premium and carried debt. Cost decisions
require at least 50% context occupancy and two ordinary requests since the
last compaction. At 90% occupancy, protection bypasses those economic guards;
a classified overflow gets at most one automatic compact-and-retry per turn.
The first paid charge requires the shared price/daily-budget consent, and
every attempt is tallied. Stop and final account/key/budget checks still apply.

The memory flush writes a labelled, untrusted host snapshot through the
ordinary memory permission path: Manual asks; Plan and Restricted Mode refuse
the write while compaction can continue. The next request restores the exact
host todo list and goal as data, including completed items. It adds no separate
model call to guess the list. An unsuccessful summary keeps the existing
conversation; failed or refused automatic work clears economic debt. Production remains inactive until lane E records
both 0.75 capability floors and actual compaction evidence in its M75 pair.

When a Model API turn fills its context window, it reports **Context window
full: /compact or /handoff**. Ordinary requests are refused locally only when
their lower input estimate exceeds the full window; a high upper estimate
still lets the provider decide. Quota and billing failures keep their own errors.
Manual `/compact` remains available after that refusal. Context pressure
and text-file read budgets use the selected model's supplied window, with
each dispatched attempt retaining its admitted window and format. The documented
Muse window applies only to verified legacy Muse ids without a registry resolver;
an authoritative missing row stays unknown. Provider
registry wiring must supply each BYO model's window; Ollama needs its loaded
`num_ctx`, rather than its trained maximum. Automatic recovery remains inactive
until the evaluation and paid-admission requirements above are satisfied.

Handoff runs on the Model API backend only: on Muse Code the command says
so, where Muse Code compacts its own conversations. It starts from the
main conversation, never a side chat.

## Rules, skills and memory

In a trusted workspace the agent follows the same files Muse Code does:

- **Rules:** `AGENTS.md` at the workspace root (`CLAUDE.md` where there is no
  `AGENTS.md`), and the same files in subdirectories, which apply once the
  agent touches a path beneath them; the deeper file wins.
- **Skills:** `.agents/skills/<id>/SKILL.md` in the workspace (project scope)
  and Muse Code's personal root `~/.config/muse/skills`
  (`$XDG_CONFIG_HOME/muse/skills` when set). The palette's **Skills** group
  lists them, `/id arguments` invokes one, and the model loads one itself
  when a task matches its description. `user-invocable: false` in the front
  matter keeps a skill out of the palette. The extension also brings four
  skills of its own; see [Bundled skills](#bundled-skills).
- **Agents** (Model API backend only): `.agents/agents/<id>/AGENT.md` in the
  workspace (project scope) and the personal root `~/.config/muse/agents`
  (`$XDG_CONFIG_HOME/muse/agents` when set), plus the built-in `explore` and
  `second-opinion`. The folder is this extension's own: the Muse Code CLI
  names none. The model runs one through `subagent_spawn` with `agent` set to
  its id; see [Custom agents](#custom-agents).
- **Memory:** Markdown notes the agent keeps for later conversations, in
  Muse Code's three places, on both backends; see [Memory](#memory).

**Muse Spark: Create AGENTS.md** starts `AGENTS.md` where the workspace
root has none. `muse init` writes it when the CLI is installed and the workspace
is trusted (the CLI's own scaffold, no model call); otherwise the extension
writes the same layout. An existing `AGENTS.md` is opened, never
overwritten; a `CLAUDE.md` is not checked, and the new `AGENTS.md` is read
in its place.

On the CLI backend Muse Code loads the rules, skills and memory itself (the extension starts
it with `--trust-workspace`), plus its bundled skills and your user rules.
On the Model API backend the extension loads the files above and nothing
else:

- **Sizes:** a rules file, a `SKILL.md` or an `AGENT.md` over 64 KB is
  skipped with a warning in the log (a skill or agent file is read only up to
  that size, and only when it is a regular file); the rules together are cut
  at 256 KB, and each scope's `MEMORY.md` at 200 lines or 32 KB.
- **Encodings:** UTF-8, or UTF-16 with a byte-order mark; a file that is not
  text is skipped with a line in the log. Memory notes are UTF-8 only, as
  Muse Code reads them.
- **Links:** a skill or agent folder may be a symbolic link or junction. In
  the workspace it must lead to a place inside it or it is skipped; links in
  the personal root are followed wherever they lead.
- **The system prompt** also carries the date, the git branch, the number of
  changed files and the latest commit subjects at session start (metadata
  only), and a short set of working rules (read before editing, no commits
  unless asked, `path:line` references).

In VS Code's **Restricted Mode** (an untrusted folder), neither backend loads
the workspace's rules or skills (Muse Code starts without
`--trust-workspace`). The Model API backend loads no skills at all, no custom agents or memory,
offers no memory tools, starts no MCP servers and runs no hooks. No shell command or `git`
runs (git reads
the repository's own config, which can name programs to run): `@` mentions
come from VS Code's file search and the prompt carries no git facts. Trust
the workspace to enable them. Muse Code itself, by its documentation,
still reads a repository's committed project memory in an untrusted
workspace: treat a checkout's `.agents/memory/MEMORY.md` as text someone
else wrote.

### Bundled skills

The extension ships the three workflows of the
[high-quality-projects](https://github.com/RandyNorthrup/high-quality-projects-skill)
package (MIT, one pinned release, vendored into the extension at build time
and never downloaded while it runs), plus one skill of its own:

- **project_setup:** a new project from a product interview through strict
  quality gates.
- **feature_delivery:** a scoped feature or change in an existing project,
  with tests and red drills.
- **quality_retrofit:** an existing codebase brought up to strict standards.
- **muse_gadgets:** Meta's Muse Gadgets devices (ESP32 firmware and Linux
  services); see [Muse Gadgets](#muse-gadgets). It is a first-party skill the
  extension authors in its own folder, not part of the vendored package, so
  the Muse Code install below does not copy it: it is a Model API skill only.

They lean on the package's shared `scripts/`, `templates/` and `docs/`, so
each workflow is the whole package, never a lone `SKILL.md`. The delivery
helpers need **Python 3.12 or newer** on your `PATH`; they do not check
the version, so an older Python fails with an error, and the skill then
records that gate as deferred. The scripts run only through the shell tool, under the
conversation's permission mode, like any other command.

- **Model API backend:** they are a third skill source, after the project's
  and your own: a project or personal skill with the same id wins. They are
  listed in the palette, invoked with `/project_setup …`, and read by the
  model like the others. When the model reads one from the extension's
  package, the skill's text is preceded by one line naming the package
  folder inside the installed extension, which is the skill's `SKILL_ROOT`.
- **Muse Code:** the CLI reads only its own folders, so the skills are
  installed there on request. **Muse Spark: Install Bundled Skills for Muse
  Code** copies the package to
  `~/.config/muse/skill-sources/high-quality-projects-skill/`
  (`$XDG_CONFIG_HOME/muse/…` when set), marks the copy as the extension's
  (`.muse-spark-bundled.json`), and links each skill into Muse Code's
  personal skills folder, `~/.config/muse/skills/<id>`: a junction on
  Windows, a directory symlink on macOS and Linux. A skill of yours with the
  same name is left alone and named in the result. The first Muse Code
  conversation in each window offers the install, in the panel, with
  **Install** and **Not now** (Not now is remembered); when the extension's
  packaged release differs from the installed one, it offers **Update** the
  same way.
  **Muse Spark: Remove Bundled Skills from Muse Code** removes the links that
  lead into the marked copy, then the copy, and nothing else. A running Muse
  Code keeps the skills it started with, so both end by offering to restart
  it.

`museSpark.bundledSkills` (on by default, machine-scoped) turns them off: the
Model API backend stops listing them at once, and no install is offered. It
does not remove an install; the Remove command does. Until then the Model
API backend, which reads the same personal skills folder, lists an installed
copy as your own skills.

### Memory

Muse Code keeps memory in three scopes, and both backends read and write the
same notes, so a fact saved in one is known in the other:

| Scope                                          | Where the notes are                                                              | Who sees them          |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------- |
| **Your memory for this project** (the default) | `~/.local/share/muse/memory/projects/<path-slug>-<hash>`, outside the repository | You, in this workspace |
| **Project memory**                             | `.agents/memory` in the repository                                               | Everyone who clones it |
| **Your memory for every project**              | `~/.local/share/muse/memory/personal`                                            | You, everywhere        |

`$XDG_DATA_HOME` replaces `~/.local/share` when it is set (on Windows too, as
Muse Code does). Each scope may keep a `MEMORY.md` index, one line per note:
`- [Title](file.md) | hook`.
Model API memory tools retain their original Stop, permission-mode, trust and
conversation lifetime across reads, preimage copies and native publication.
A late refusal preserves the old note; a new note already published stays
written if its later index update is refused, with an index warning in the log.
Names with spaces or Markdown punctuation are encoded in the index link, so
the note can still be found and its line removed when the note is deleted.

- **Memory…** in the palette (`/memory`, or **Muse Spark: Memory** in the
  Command Palette) lists up to 500 Markdown notes per scope, nested up to
  eight folders, with each note's scope and what it is about.
  Pick one to open it in an editor, where you read and change it like any
  file, or to delete it (to the trash, after a confirmation). **New note…**
  asks for the scope, a name and a one-line description, creates the note
  and opens it. A note the view creates gets its line in the scope's
  `MEMORY.md`, and a note it deletes loses its lines, so the index the next
  conversation reads stays true.
- **On the Model API backend** the model has Muse Code's own memory tools,
  `read_memory`, `add_memory` and `edit_memory`, with the same arguments and
  results, so their rows look the same as on the CLI backend. At the start of
  a conversation it is given each scope's `MEMORY.md` and the names of the
  other notes (up to 48 per scope), as Muse Code gives them. A new note gets
  its line in its scope's index. A write asks in Manual, is made in Auto and
  Edit automatically, and is refused in Plan, like any edit; a read asks
  only when a hook demands it. A path Muse Code would refuse (outside the scope, hidden, not a
  `.md` file, or through a link) is refused before any card.
- **On the CLI backend** Muse Code runs its memory tools itself.

A new note is published only if its path is still free. The extension writes
and syncs it under a hidden temporary name, then hard-links the complete file
to the note's name in one step. Another writer's file is never replaced or
exposed half written; a filesystem without hard-link support refuses the
create rather than using a partial-write fallback. The index line is added
only after publication. Updates to an existing note replace it whole (a
temporary file renamed over it). The extension does not take Muse Code's own
lock, so two agents updating the same note or index in the same instant could
lose one of the writes.
The `.muse-memory.lock` file can remain after its owner exits; its presence
or stored PID alone does not show that a write is in progress.

### Custom agents

On the Model API backend the model can run specialised agents, each with its
own prompt, tools, model or effort, and permissions: the built-in `explore`
(read-only reconnaissance: it reads, searches and lists, and reports back with
`path:line` references) and `second-opinion` (a high-effort consult told to
advise rather than act; it keeps the session's tools), plus your own. A custom agent is an `AGENT.md` with
front matter above a Markdown prompt:

```md
---
name: reviewer
description: Reviews a change for risks
tools: read_file, edit_file
permission-mode: plan
---

You are a reviewer. Read the change, then report ...
```

Put it in `.agents/agents/<id>/AGENT.md` in the workspace (project scope) or
`~/.config/muse/agents/<id>/AGENT.md` (`$XDG_CONFIG_HOME/muse/agents` when
set), following the skill layout; the folder name is the agent's id, and a
file agent shadows a built-in or personal one with the same id. Agents load
once, when the conversation starts. Each folder loads on its own: one that
cannot be read is named in the log and the others still load. An agent that
folder might define, or that a file there defines but was skipped (unreadable,
too large, refused), is refused by name with the folder or file it names,
never replaced by a personal or built-in agent of the same id; fix or remove
it and start a new conversation.

- **Front matter.** `name` and `description` are required (at most 64 and 240
  characters). `tools` is a comma-separated allowlist of tool names,
  `model` a model id, `effort` one of `minimal`, `low`, `medium`, `high`,
  `xhigh` or `max`, and `permission-mode` one of `manual`, `acceptEdits`,
  `plan`, `auto` or `bypassPermissions`; all four are optional. Write each
  key on one line as `key: value`: a file whose front matter is a list, an
  indented value or a repeated key, whose `tools` line names no tool, or that
  holds a control or direction character in a name, description or model is
  skipped with a line in the log, never guessed at. At most 32 agent files
  load.
- **What an agent can do.** It can only narrow what the session already has.
  A tool outside its `tools` list is not offered and, if the model names it
  anyway, refused, memory tools included. A refused call's row, and the line
  under an edit whose `then_run` it refused, use the installed display
  language; the model is told in English, as is the body of a **Check edits**
  row, which shows the note the model read. Automatic check commands need
  `run_checks` or the platform shell in the list, and `then_run` (which
  runs any command line) needs the shell. A
  `permission-mode` wider than the session's gets the session's, and a mode
  switch later keeps the ceiling. A child's writes are answered under the
  less automatic of your mode and its own (Plan, Manual, Edit automatically,
  Auto, Bypass permissions, in that order): a child defined as `manual` still
  asks before ordinary writes when its parent uses Edit automatically, a
  child defined as `acceptEdits` cannot automate writes under a Manual
  parent, and keeps its automation under an Auto or Bypass parent. A
  protected, replayed or escalated write always asks, except under Bypass
  permissions.
  This policy survives saving, resuming and forking. Admission uses the tools
  the child can actually use: questions, todos/goals and subagent controls
  belong to the parent. A list with no usable child tool fails the spawn
  before the paid-use popup or the contributor question asks, so nothing is
  asked or billed for it.
- **What it costs.** The run is a paid child task like any subagent (off
  unless paid subagents are on, asking in the paid-use popup before each use
  unless subagents are allowed always in this workspace, Plan refuses it). An agent's `model` goes through the same checks as your
  own choice, and the popup names it: contributor models are blocked while
  `museSpark.confidentialWorkspace` is on and otherwise ask once for each
  spawn, and a model other than the session's asks in the popup even when
  subagents are allowed always here. Whatever a question's wait changes
  (trust, a confidential workspace, the key, the model, the agent's tools)
  is checked before the next question and again before the child starts, so
  no popup follows a spawn that can no longer run. A retry under the same
  `command_id` answers with its child before any of this.
- **Whose words.** The model sees each agent's source (`project`,
  `personal` or `built-in`) in the catalogue, and a child's role below the
  workspace rules, labelled with its source and id, as text that cannot add
  tools or permissions, explicitly marked as untrusted text. A repository's
  files load only in a trusted workspace: a session that loses trust offers
  no agent, including when trust is revoked during the paid-use popup, and a resumed child's
  project role is left out while the workspace is untrusted.
  Project files are read through their approved canonical path, so replacing
  the original link or junction after confinement does not redirect the read.
- **The model runs one** through `subagent_spawn` with `agent` set to its id;
  the catalogue appears in its instructions only while paid subagents are on.
  On the CLI backend Muse Code reads its own agents and this extension sends
  it none.

## Muse Gadgets

Meta's [Muse Gadgets](https://gadgets.muse.ai/) are devices with a Muse
assistant inside, built from the open
[muse-gadget-sdk](https://github.com/facebookincubator/muse-gadget-sdk)
(Apache 2.0): `esp32/` firmware (ESP-IDF 6.0.1) and a `linux/` assistant
service. The extension helps you build gadgets; it never becomes one:

- **Tokens stay secret.** Your per-user SDK token (`mgst_…`) is redacted
  from logs and transcripts like any other secret. Type it yourself, in your
  own terminal, into `idf.py menuconfig` or the Linux installer — never into
  chat, never into a command — and never commit a generated `sdkconfig`
  containing it (`sdkconfig.defaults` is tracked input and token-free). A
  prompt holding a detected secret is held before sending (Send anyway /
  Edit). On the Model API backend a shell command holding one asks in every
  mode, including Bypass. Every approval Muse Code emits has its card redacted
  and offers only one-time approval; Muse Code Bypass can execute without
  emitting an approval, so the extension cannot warn before those commands.
- **Device commands stay bounded.** A monitor never exits by itself, so the
  shell tool's `timeout_ms` ends it and returns what it captured: flash, then
  capture N seconds of serial output, in one call, with no process left
  behind.
- **The skill knows the drill.** `/muse_gadgets` (a bundled skill, off while
  `museSpark.bundledSkills` is off) covers the SDK layout, the Windows and
  POSIX setup, the bounded-monitor pattern and the token rules. In a clone of
  the SDK, the model reads the SDK's own `AGENTS.md` first.
- **Never a gadget.** The extension never installs, configures or recommends
  the Linux gadget service on a development machine: that service lets the
  cloud assistant run any command there. A Raspberry Pi or a spare box is
  fine. Pinging your phone after a turn (a hook running `musegadget
send-user-msg`) arrives with the hooks milestone.

## Muse Code's own tools

These use the Muse Code CLI, except worktrees, MCP servers and hooks, which
the Model API backend has too (each says how below); memory works on both
backends as [Memory](#memory) describes.

**What its tools show.** Every tool Muse Code runs has a named row, and
the ones that answer in JSON are shown as what they mean:

- **Memory** (Read memory, Save memory, Edit memory): the note saved or read
  back, where it lives (your memory for this project, the project's shared
  memory, or your memory for every project), and an edit as the text
  replaced beside its replacement.
- **Goals** (Set goal, Check goal, Update goal, Goal progress): the
  objective, its status, a progress bar, what the agent is doing now and
  next, and the tokens spent against any budget.
- **Scheduled prompts** (`/loop` and cron): each prompt with its schedule,
  whether it repeats, its next run and how often it has run.
  These rows report Muse Code's native cron tools, not the extension's Model
  API schedules described below.
- **Web search**: the results as links that open in your browser, with
  their snippets. Search rows on the Model API backend look the same.
- **Fetch page**: Muse Code's own `web_fetch` is switched off, so the
  extension offers it one of its own, `mcp__ide__webFetch`; see
  [Web fetch](#web-fetch).
- **Background work**: a command Muse Code moved to the background shows
  what it printed and that it is still running, and it stays running after
  the turn ends instead of reading "Interrupted". See **Background work**
  under The panel for moving one there yourself and stopping it.
- **Pictures**: when the agent reads an image or generates one (the Model
  API backend, or Muse Code through the extension's paid image tools), the
  row shows it; click it to open the file. Only images
  inside the workspace are shown. The preview reads the checked target with
  the same 10 MiB file cap if a workspace link or file changes meanwhile.
- **MCP tools** read "tool (server)", and any tool the panel has no special
  view for shows its arguments and result as indented JSON.

**Skills.** The palette's Skills group has two more rows on the CLI backend:

- **Manage skills…** is a checklist of every skill Muse Code knows
  (built-in, yours, this project's, plugins); unchecking one turns it off
  (`muse skills disable`).
- **Import skills…** shows what `muse skills import` would copy from Claude
  Code or Codex into your Muse skills folder, imports it once you confirm,
  and reports what was imported, skipped, failed or quarantined.

Muse Code reads skill changes when it starts, so both end by offering to
restart it; the conversation continues on your next message. Where the
session offers Muse Code's `resume-claude` and `resume-codex` skills, the
palette's Context group has **Continue a Claude Code session** and
**Continue a Codex session**.

**Import from other agents…** (Customize group, both backends) moves you
off Claude Code, Codex or Cursor: their MCP servers, Claude Code hooks,
custom agents, slash commands and rules files, found where each tool keeps
them and converted to the formats their destination loads.

| From                                                                              | Becomes                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slash commands (`.claude/commands`, `~/.codex/prompts`, `.cursor/commands`)       | Skills: the project's `.agents/skills/<id>/SKILL.md`, or your own `~/.config/muse/skills/<id>`                                                                          |
| Custom agents (`.claude/agents`, `.cursor/agents`)                                | Compatible M76 agents in `.agents/agents/<id>/AGENT.md`, or your own `~/.config/muse/agents/<id>/AGENT.md`; the directory id is the Model API `subagent_spawn` selector |
| A project's rules (`CLAUDE.md`, `.cursor/rules/*.mdc`, `.cursorrules`)            | Headed sections appended to the project's `AGENTS.md`                                                                                                                   |
| Your MCP servers (`~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`) | Unsaved editor edits in Muse Code's `settings.json`                                                                                                                     |
| Claude Code hooks (your `settings.json`, or the project's)                        | Unsaved editor edits in your `settings.json`, or the project's `.muse/hooks.json`                                                                                       |

Import copies an item only to a place no more exposed than where it was: personal stays personal, a git-ignored file is never copied into a tracked one. It does not look for credentials in what it copies.

The read-only preview lists kind, item name, source scope, target path and
refusals with their reasons. It never shows bodies, commands, arguments,
environment or header values, or URLs. Picker details show personal or
project scope, never source paths. Names remain visible as the source tool
shows them. Nothing is written until you choose Import; an existing file
is never replaced. Config entries open as unsaved edits in their target
editor for you to review and save; the importer never uses the clipboard
or saves Muse Code's settings or hooks files. Values stay unchanged.

Personal means under your home and outside every open workspace. Project
files are either git-ignored (project-local) or tracked/not ignored
(project-tracked). A non-repository folder counts as tracked. Project-local
may go to project-local or personal; project-tracked may go to any of the
three. Target exposure is checked again at publication or editor edit time.
An unreadable classification refuses the item. The native-path checks also
refuse links and junctions below the project root, including dangling ones.
An arbitrary native writer can still race the final filesystem operation;
Node has no handle-relative publication API to close that window.

Project reads and effects require workspace trust and release of any held
pull-request worktree. This includes Muse settings physically inside an open
project through `XDG_CONFIG_HOME` or a personal path linked into that project;
the importer classifies the resolved path before reading it. Losing trust
stops project reads and effects; closing activation stops pending prompts.
Personal imports remain available in Restricted Mode and held worktrees.
A repository's MCP servers are listed
but are not offered for personal settings; personal rules remain Muse Code's
`/rules import`. Hooks keep supported matchers and restrictions. Unsupported
events, non-command handlers, narrowing fields (`if`, `args`, `shell`),
disabled servers, SSE, WebSockets, OAuth and header helpers are listed and
not converted. MCP conversion copies only the active transport's fields;
inactive and unknown fields are listed as dropped by name, never by value.

Claude agents and commands retain namespaces up to three levels. Agents
are imported only when their front matter uses fields and values the Model
API backend's [custom agents](#custom-agents) support.
Commands keep supported descriptions and argument hints; unsupported
restrictions are refused. One import runs at a time. Project publications
hold the checkpoint lease and count as your own edits, so restoring a turn
preserves them. Rules appends stop on changed prior text or a result over
64 KiB. Skipped-file messages and logs contain counts and fixed reasons,
never item names, paths or content. Only successful publications and config
edits actually offered count as imported.

**MCP servers and hooks.** Muse Code reads both from its own settings file
(`~/.config/muse/settings.json`, or under `XDG_CONFIG_HOME`), and project
hooks from `.muse/hooks.json`. `MCP servers…` and `Hooks…` show configuration without editing it:

- **MCP servers…** lists each server:
  - Its transport, where it points (a URL is cut to its scheme and host),
    and whether Muse Code stops when it fails ("required") or skips it.
  - The _names_ of its environment variables and headers. The values stay in
    the file.
  - A remote server can be signed in to or out of. That runs
    `muse mcp login` or `muse mcp logout` in a terminal, with the server's
    name quoted.
  - **Restart Muse Code to load changes**, since Muse Code reads the file
    when it starts.
- **Loud warnings** for the two settings mistakes that make Muse Code load no
  server at all: both `mcpServers` and the older `mcp_servers` in one file,
  or `required` beside `mode` on a server.
- **On the Model API backend** the window runs the same servers itself, so
  their tools work with your key as they do in Muse Code:
  - **When:** they start with the first conversation, and the first message
    waits for them; they stop with the window, and **Restart the MCP
    servers** in the view restarts them with the settings as they are then.
    At most four start together, so a long server list can make the first
    message wait longer. None runs in Restricted Mode.
  - **The view** shows each one's state: connected with how many tools, still
    starting, turned off, or not running and why. A server's row opens the
    log, where its stderr goes. The extension's own diagnostics server is
    listed as `ide`, built in.
  - **Loud:** a server that is not running is a warning in the panel, once
    per conversation; a _required_ one (the default, unless its entry says
    `"mode": "optional"`) stops the message with the reason and how to fix
    it, as Muse Code refuses to start without it. Both keys in one file, or
    `required` beside `mode`, loads none, as in Muse Code, and says so.
  - **What an entry may hold:** `command`, `args`, `env`, `cwd` and
    `framing` (`auto`, `line_delimited_json`, `content_length`) for a
    local server; `url` and `headers` for a remote one (streamable HTTP);
    `enabled`, `mode`, `startup_timeout_sec`, `tool_timeout_sec`,
    `enabled_tools` and `disabled_tools` for either. `${VAR}` reads an
    environment variable of VS Code's; an unset one keeps the server from
    starting. A local server sees only a short list of VS Code's environment
    variables (`PATH`, `HOME`, `TEMP` and the like) plus its own `env`.
    On Windows a `.cmd` launcher such as `npx` runs through `cmd.exe`, and
    an argument with `"` or `%` is refused there. A hidden Windows job
    helper passes stdin, stdout and stderr as binary pipes, assigns the
    server to its job before it runs, after a private handshake confirms
    this extension process still owns the launch. It ends descendants on Stop,
    server exit or extension shutdown. If Windows cannot load the helper,
    local stdio servers do not start; the view gives the reason. Remote
    HTTP servers can still connect.
  - **Sign-in:** `muse mcp login` signs in Muse Code only. A remote server
    that needs a credential takes it in its entry's `headers`
    (`"Authorization": "Bearer ${MY_TOKEN}"`).
  - **Tools** are named `mcp__<server>__<tool>` and read "tool (server)" in
    the transcript. Their results reach the model as text and pictures;
    audio and files are described instead. MCP servers may request a form:
    review its fields and choose **Send**, **Decline** or **Cancel**, including
    in Bypass. Only flat primitive forms from MCP 2025-06-18 are supported;
    unsupported schemas and URL flows are refused. The panel closing, Stop,
    or a timeout cancels. Typed values go only to the requesting server,
    never as form answers in logs or saved transcripts. The server’s own
    tool output may repeat submitted values. ACP clients use their form UI;
    clients without forms receive a description and the request cancels.
    Elicitation and ElicitationResult hooks run through the host seam.
    Resources, prompts and sampling
    are not supported.
- **Hooks…** lists the project's, yours and your administrator's hooks, and
  opens the file behind each. A hook runs through your shell outside Muse
  Code's sandbox and approvals, so read a repository's hooks before you
  trust its folder.
  - Beside Muse Code's `.muse/hooks.json` and your settings' `hooks`, it
    lists the extension's own `spark-hooks.json`: the project's in
    `.muse/spark-hooks.json`, and yours beside Muse Code's `settings.json`.
    Muse Code never reads that file. It holds the events only this
    extension runs, and the hooks imported from other agents.
  - Each row says which backend runs the file, and a `spark-hooks.json`
    row names the formats of the hooks imported into it.

### Hooks

**Extension hooks (M91).** `.muse/spark-hooks.json` and the user
`spark-hooks.json` beside Muse Code's `settings.json` hold extension events;
Muse Code never reads these files. The same trust and `museSpark.modelApiHooks`
opt-in apply. **Muse Spark: Run Setup Hooks** runs `Setup` with matcher `init`;
**Muse Spark: Run Hook…** and `/hook run <name>` run one `Manual` hook by command
or description, showing bounded output. These operations work on both backends
without a model turn. The standalone agent also accepts
`muse-spark-code-acp --trust-workspace setup [--maintenance]`; headless `exec`
still refuses trust and never runs hooks.

File changes require a matcher and an indexed workspace path; protected,
ignored and escaped paths are excluded. Changes are debounced and capped.
Settings notifications send an empty path and reason `settings`, because
VS Code's settings event does not identify a file. Hook token additions appear
separately from packing savings. The integrated runtime also routes CwdChanged,
elicitation and MessageDisplay. Event and platform qualifications are recorded
in [M91 certification](docs/certification/m91.md).

On the **Model API backend**, `museSpark.modelApiHooks` is a machine-scoped
setting, on by default and inert without a hooks file. A new session in a trusted workspace
reads the same managed, user and project hook sources. No hook loads or runs
while the folder is in Restricted Mode.
The implementation currently fires `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`,
`PostToolBatch`, `PreLLMCall`, `PostLLMCall`, `PreCompact`, `PostCompact`,
`SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `SessionEnd` and
`Notification`;
unsupported events and handlers are reported and skipped. Hook commands run as your user,
unsandboxed, with a narrow environment that excludes the Model API key.
They get JSON on stdin, have a timeout and output cap, and may approve an
ordinary tool call that would otherwise ask. Paid calls, protected writes,
web fetches, asks your command rules or permission profile settle, and shell
commands too complex for the rules still need your confirmation. A `PreToolUse` hook that asks forces a human
card for memory reads or writes, including in Bypass and Edit automatically;
Plan still refuses memory writes. Review each source with
**Muse Spark: Hooks** in the Command Palette before enabling the setting.
On the Model API backend, that picker shows the machine setting's on/off state
and opens it. Turning the setting off stops hook dispatch in an open session;
source file changes are read at the next session start.

The Model API also accepts `http`, `mcp_tool`, `prompt` and `agent` handlers.
An `http` handler supplies `url` in a user hook file. It uses HTTPS, follows
no redirects and requires an entry in the machine setting
`museSpark.hookHttpAllowedHosts` (empty by default): an exact host or
`*.example.com`, which covers subdomains only. IP literals are refused except
explicitly allowlisted loopback addresses. Restricted network posture stops it.
An `mcp_tool` handler supplies `server` and `tool`, and uses that configured
tool's ordinary permission path. Both receive the bounded event payload.

`prompt` and `agent` supply `prompt`, on `PreToolUse`, `PermissionRequest`,
`UserPromptSubmit`, `Stop` or `SubagentStop`. These model hooks are available
by default when hooks are enabled; `museSpark.modelApiHookModels` switches
them off. Each run asks through the three-choice paid popup with its token
price, unless remembered for this workspace, and appears separately in
Account & usage. `agent` can use only read, search, list and read-only code
intelligence. Hidden model turns fire no hooks. Typed answers can refuse,
narrow or add context; they cannot approve another operation.
The existing session budget covers every request. Model API handlers also
reserve against the shared daily budget. Muse Code handler qualifications
remain in [handler certification](docs/certification/m91-h.md).
The fake-only guard drill script, `python3 docs/certification/m91-h-drills.py`,
runs on the Kubuntu test rig and refuses Windows.

Model-call hooks receive bounded summaries without inline image bytes or the
Model API key. A pre-call veto stops the request before it reaches Meta. A
post-call veto stops returned tools and follow-up requests. An isolated Muse
Code echo capture also ended the run as failed without another model request.
Pasted media data URLs inside ordinary text are removed before any model-call
hook preview is shortened; the original text still reaches the model.
Tool hooks receive bounded previews of arguments and output, with media data
URLs and credential-named fields omitted. MCP tools and the model still use
the original arguments and results. A required MCP server failure ends the
turn even if a post-tool hook asks to stop it.

**Hooks from other agents.** **Import from other agents…** copies hooks
written for Gemini CLI, Cursor, Copilot and VS Code, Windsurf, Kiro and Cline
into `spark-hooks.json`, each tagged with its format. On the Model API
backend each one runs in its own agent's shape:

- It gets the input its agent would send, and its answer is read by that
  agent's rules. A guard that blocks, fails or crashes there does the same
  here. No answer approves a call: a foreign "allow" still shows the card.
- Cursor's shell-command patterns and loop limits, and Kiro's file triggers,
  decide whether a hook runs, as they do in those tools. On Windows,
  Copilot, Windsurf and Cline hooks run in PowerShell, as their agents run
  them.
- A hook may replace what the model sees of a tool's output where its agent
  documents that. The row keeps the real output, and a notice says so.

Imported hooks never run on the Muse Code backend, and run under the same
trust gate, opt-in and limits as every other hook.

**Amp and OpenCode plugins.** The import also finds Amp's plugin files
(`.amp/plugins/`, and `$XDG_CONFIG_HOME/amp/plugins/` or
`~/.config/amp/plugins/`) and OpenCode's (`.opencode/plugins/` and
`~/.config/opencode/plugins/`). For each hook a plugin registers by name, it
writes one `spark-hooks.json` entry that points at the file. A plugin whose
hook names it cannot read gets every hook it could fire. The preview shows
file and hook names, never code. Directory plugins, OpenCode's npm plugins,
and a personal plugin that leads into the open folder are listed and not
imported.

- **Where they run.** Only on the Model API backend. Each call runs in a
  child process of its own, under your installed `node` (22.18 or later) for
  Amp and `bun` for OpenCode, with the narrow hook environment:
  - **Windows:** in a job object with a memory limit, which ends the plugin
    and everything it started.
  - **Linux:** in its own process group, with OpenCode's `bun` held to the
    same memory limit by `prlimit`.
  - **macOS:** OpenCode plugins are refused, because `bun`'s memory cannot be
    bounded there.
  - **The ACP agent:** plugin hooks are refused.
- **What they can do.** A plugin can refuse a call, narrow its input, add
  context or replace a tool's output, as its own agent allows. It has no
  shell, no client and no model. Amp's `shellCommandFromToolCall` helper is
  the one helper it can use.
- **Failures.**
  - An Amp `error` stops the call and ends the turn, as it does in Amp.
  - An OpenCode `tool.execute.before` that throws, crashes or times out
    blocks the call.
  - Any other failure is logged and the call goes on.
- **Tools and arguments.** A plugin sees our tools under its agent's names:
  Amp's `Bash`, `Read`, `edit_file`, `create_file`; OpenCode's `bash`,
  `read`, `edit`, `write`. Arguments are renamed only where a source shows
  them: OpenCode's `read` takes `filePath` and `bash` takes `command`.
  - Every other argument keeps our name. So an OpenCode guard that reads
    `output.args.filePath` on `edit` or `write` throws, and the call is
    blocked, never let through.
  - Five OpenCode hooks have no event to fire on yet, and are listed and not
    imported: `command.execute.before` and the bus's `todo.updated`,
    `permission.replied`, `file.watcher.updated` and `message.updated`.
- **Windows job failures.** If Windows cannot prepare the job that contains
  plugins, plugin hooks fail by their rule and say why. The job is tried
  again once after a few seconds. After a second failure, run **Muse Spark:
  Retry Plugin Hooks** to try again.

**Worktrees.** **New worktree…** asks for a new branch and its base (the
current commit or any local branch), creates it in a folder of its own, and
offers to open it in a new window, so a conversation there leaves your
checkout alone:

- **Where it goes:** `<repository>.worktrees/<branch>`, beside the
  repository, so the second copy never lands inside your workspace. A `/` in
  the branch name becomes `-` in the folder's.
- **Refused:** a name git rejects, a branch that already exists, and a folder
  that is already there.

**Remove a worktree…** lists the others (never the main checkout or the one
this window is in) and deletes the chosen folder. Its branch stays. A
worktree with uncommitted changes is removed only after a second
confirmation that says the changes will be lost. Both commands need a
trusted workspace, since git does not run in Restricted Mode.

## Git and pull requests

From finished work to an open pull request without leaving the panel, on
both backends. The **Git and pull requests** group of the `/` palette
(`/commit`, `/push`, `/pr`, `/checkout-pr`) opens each step above the
composer.

Open the repository or worktree root for these actions; an ancestor
repository returned for a workspace subfolder is refused. Git actions are
also unavailable while a pull request worktree is held.

- **Commit.** The form lists the staged and unstaged files and commits
  through VS Code's own Git, with **Include unstaged changes and new files**
  when you want everything. A final dialog shows the message, branch, file
  scope and Git execution consequences before committing. The form and
  consent are checked against the current branch, staged/unstaged diffs and
  new-file bytes; changed input requires reopening the form. No post-commit
  command runs.
- **A message written for you, only when you ask.** **Write with Muse** in
  the commit or pull request form sends your own message ("Write a commit
  message for my changes.") in the conversation, with the staged diff, or
  the branch's commits against its base, marked as data for the model. It
  is an ordinary turn of your conversation: nothing is written on its own
  and nothing is billed beyond your turn. The reply fills the form; you edit
  it and press the button.
  A pull request draft uses the base you edited in the form and the fetch
  remote for its destination repository. For a fork this is its parent,
  never the fork's older base. A missing base is fetched through checkpoint
  admission and verified; no matching remote or unresolved ref refuses
  generation. Cancelling, reopening or successfully committing retires the
  old form's generation, so its reply cannot fill a later form.
- **Push.** Always asks, in a dialog naming the remote, its address (any
  credential in it masked), the branch and how many commits go up. It goes
  through VS Code's Git, so your credential helpers and VS Code's sign-in
  prompts apply. It never force-pushes: a branch behind its upstream is
  refused (pull first), and so is a branch or remote whose name git would
  read as an option or a force.
- **Open a pull request** on github.com, with VS Code's GitHub sign-in
  (VS Code asks for it the first time). The form is the confirmation: the
  repository, the remote, the branch, the base, the title and the
  description are all shown and editable, and the pull request opens as a
  draft unless you untick it. A branch not yet pushed is pushed first,
  asking as above. From a fork it opens on the repository the fork came
  from. A credential-shaped string in the title, description or commit
  message is masked and sent back to the form, so nothing goes out that you
  have not seen. GitHub only: VS Code has no built-in sign-in for other
  forges.
  The destination is bound to the form you saw: a changed remote, fork
  parent or branch stops creation instead of sending its body elsewhere.
- **Cancellation and changes.** Busy forms freeze their editable fields;
  **Cancel** closes the form and stops later steps. Repository, conversation
  and trust changes are checked after dialogs and sign-in. Git may run
  repository hooks, signing programs or credential helpers, as the consent
  explains. A Git or GitHub call already started may finish; cancellation
  does not undo a completed commit, push or pull request.
  If GitHub completes a pull request while Cancel waits, the panel reports
  success with its URL and stops subsequent linking and status reads.
  Each operation captures the physical repository before lookup and rechecks
  its original and canonical directory identities before Git entry. A
  junction or symbolic link that changes during consent stops the operation,
  even with identical cached HEAD and remotes. Native checkout uses the
  captured canonical directory; an observed loss never revives old consent.
  An own-PR sibling folder keeps the selected workspace alias in its name
  and record; canonical execution does not rename that destination.
  Root checks also accept genuine Windows short names when the
  Git API spells the same directory with its long name.
  Commit, push, PR fetch and checkout also wait for the window's checkpoint
  process admission. A restore reservation refuses their start; once Git
  starts, file restore remains unavailable because its helpers may write
  files or leave a process running.
- **Linked to the conversation.** The pull request shows above the composer
  with its state and checks (passed, failed by name, running), refreshed
  when the conversation opens and when you press **Refresh**, and again
  whenever you resume that conversation.
- **A conversation in a worktree.** A worktree made with **New worktree…**
  or **Open a pull request in a conversation…** opens in its own window,
  where both backends run with the worktree as their root, so the
  conversation there cannot reach the main checkout. The panel says which
  branch or pull request the window is on.
- **Open a pull request in a conversation…** (a number, like `51`, or the
  pull request's address) fetches its head through VS Code's Git and checks
  it out, detached, in a worktree of its own, in a new window:
  - The fetched `FETCH_HEAD` must match the head GitHub showed; an old commit
    merely present locally does not qualify. Git checkout hooks are disabled
    while creating the worktree, so a relative hook path cannot execute code
    supplied by the untrusted pull request before its trust card.
  - **Yours:** beside the repository, as `<repository>.worktrees/pr-<n>`.
  - **Someone else's:** under the extension's own storage, and held. That
    window keeps the conversation in Plan mode with the worktree's project
    rules, skills, hooks and MCP servers off (Muse Code starts without
    `--trust-workspace`, the Model API backend reads none of them), and
    runs no `!` command, until you press **Trust this worktree…** in the
    card above the composer, whatever VS Code's own workspace trust says.
    Other extensions follow VS Code's trust, which this extension cannot
    lower, and the card says so.
    Git never checks it out. The worktree is added with `--no-checkout`, its
    index is filled from the commit with `git read-tree` (which touches no
    file and runs no filter), and the extension writes every file itself,
    byte for byte as the commit stores it, from one `git cat-file --batch`.
    So no clean, smudge or process filter, hook or conversion runs, wherever
    your Git configuration defines it (a conditional include that applies
    only inside the new worktree, an attributes file it names, or the pull
    request's own `.gitattributes`). The confirmation says what this means:
    LFS files stay pointers and line endings stay as committed; a symbolic
    link becomes a file holding its target (as Git writes one where links
    are off), and a submodule an empty folder. Trusting the worktree does
    not rewrite them. Every Git command of this checkout runs with hooks,
    fsmonitor, replacement objects and automatic maintenance off (Git 2.36
    or newer); none runs in the worktree once a byte of the pull request is
    in it, and nothing of the extension runs Git there while it is held.
    The pull request is refused whole, before anything is written, when a
    path would leave the worktree, name `.git` (in any case, or as `.git.`,
    `.git ` or `GIT~1`), use a name Windows cannot hold (on Windows), or
    collide with another path where letter case does not count (Windows and
    macOS); or when it has more than 20,000 files and folders or 250 MB.
    Each file is created without replacing anything, in a folder whose
    canonical path must be the worktree's: a link or junction on the way
    refuses the checkout, and the half-written worktree is removed.
- **Held PR ceiling.** Implementing an approved reply or a saved plan cannot lift a held PR
  worktree out of Plan mode. Worktree Git actions, Best-of-N, the session
  board's worktree reads, `/review` of Git's changes and IDE web fetch also
  honor this extension's hold until its trust card is accepted.
  The backend's first workspace folder decides project trust. A confirmed
  worktree in another folder never releases that first folder's hold, and
  a confirmed folder above a pull request's worktree never releases it:
  the deepest record decides.
  Worktree creation/removal rechecks trust and the owning activation after
  pickers, discard confirmations and native metadata waits.
- **Restricted Mode.** None of this runs there, and the panel says why:
  git can run programs a repository's configuration names.

## Code intelligence

The agent finds its way around code the way the editor does: from VS Code's
own language services (the ones behind Go to Definition, Find All
References, the outline and Rename Symbol), not by searching text. Whatever
language extensions you have installed answer; TypeScript and JavaScript
work out of the box.

| Tool                | What the agent gets                                                                     |
| ------------------- | --------------------------------------------------------------------------------------- |
| `find_definition`   | Where a symbol is defined, with the line                                                |
| `find_references`   | Every use of a symbol, its declaration included                                         |
| `workspace_symbols` | The workspace's classes, functions and variables matching a name                        |
| `document_symbols`  | A file's outline                                                                        |
| `hover`             | A symbol's type and documentation, as the editor's hover shows them                     |
| `call_hierarchy`    | Who calls a function, or what it calls, where the language supports it                  |
| `repo_map`          | The files other files use most, with their most used definitions, within a token budget |
| `rename_symbol`     | A rename everywhere the symbol is used                                                  |

- **Naming a symbol.** By path, line and column; by its name on a line or in
  a file; or by name alone, looked up among the workspace's symbols.
- **What comes back.** Workspace-relative `path:line:column` with the line's
  text, sorted, and capped with the rest counted. A result outside the
  workspace (a library's declarations, another folder) is left out and
  counted. A hover for a symbol defined only outside the workspace is held
  back, unless it is defined in a language's own library (TypeScript's
  `lib.*.d.ts` in VS Code, an extension's bundled stubs). A file whose
  language has no service in VS Code, or that declares no symbols, says
  **No language service**; a service that answers for a file but finds
  nothing at the place says so, and that not every language provides every
  kind of answer (JSON and YAML have outlines but no references), so an
  empty answer is not proof that nothing uses a symbol.
- **Unsaved files.** The language services read the editor's text, while
  `read_file` reads the disk. In a file with unsaved changes a line number
  is refused; a name is found in the editor's text, and the answer says its
  lines are the editor's. An editor is matched to a file by its real path,
  so a workspace opened through a link (whose files the language service
  names by their real paths) counts the same editor.
- **Reads in every mode (Model API).** On the Model API backend all but
  `rename_symbol` run without a card in every permission mode, Plan and
  Restricted Mode included.
- **Renames are edits (Model API).** `rename_symbol` asks like an edit: its
  card names the files, a protected one first (a protected write when one of
  them is). Every file is checked again after you approve, and each once more
  right before it is written, so nothing a formatter or you saved meanwhile
  is overwritten; Stop before the first atomic file write starts writes nothing,
  including while its final file check waits. The row keeps
  one patch across what was written, so Revert and rewind undo it, a rename
  stopped partway included. It refuses a rename that would touch a file
  outside the workspace, create, move or delete files (or one VS Code does
  not say that of), change a file with unsaved changes, or whose edits no
  longer match the file (the service answered from an older version). A hook
  that matches `Edit` runs for a rename too, and its `PreToolUse` input
  names the files it would write: the rename then writes that same plan.
- **On the Muse Code backend** the same tools reach Muse Code through the
  extension's tool server as `mcp__ide__findDefinition` and the rest, each
  marked read-only (`readOnlyHint`). Muse Code decides whether to ask: in
  its on-request mode it showed its own card for `findReferences` (Muse
  Code 1.4.0), as for any MCP tool. Its `renameSymbol` changes nothing: it
  hands Muse Code the diff, and Muse Code's own edit tool applies it under
  its approvals and rewind.
- **The repo map in the prompt** (`museSpark.modelApiRepoMap`, off by
  default, machine-scoped): in a trusted workspace the Model API backend
  puts the map in its instructions, within about 1,000 tokens, so the model
  starts out knowing the workspace's layout. It is made once per
  conversation; a try that finds nothing (TypeScript's service knows the
  workspace's symbols only once one of the project's files is open) is
  made again on the next turn, three times at most, and a child task and a
  fork use the conversation's map. It adds those tokens to every request.
  Muse Code's instructions are its own, so there the model asks for
  `repoMap` when it wants one.

## Tasks

The task list above the prompt can collapse to two lines: its title with
"3 of 7 done", and the task in progress. Its chevron expands the list again;
reloading starts expanded. **Open in a tab** on the list, or **Muse Spark:
Open Tasks in a Tab**, opens a read-only editor tab for the conversation in
view. It follows that conversation's task list and title live, rebuilds the
list whenever its webview reloads, and says when the conversation closes.
It has no prompt box, and nothing in it can send a message.

When the editor provides it, **Move into new window** focuses the tasks tab
and runs the editor's own window-move action. Its limits:

- The floating window is a VS Code window: it follows the editor's theme
  and closes with the editor; it is not an app of its own.
- A webview that moves reloads, so the tab rebuilds its list from the
  extension each time it loads.
- The tab is not restored after a full window reload, since its
  conversation may no longer exist.
- The window-move action uses VS Code's built-in
  `workbench.action.moveEditorToNewWindow` command. The host-API record
  lists the APIs that probe and execute it, not command IDs; editors
  without it get the plain tab, which
  their tab context menu may still move.
- Chat tabs opened with **Open in New Tab** move the same way.

## Session goals

Give a conversation a goal and Muse keeps working toward it across turns, on
both backends, as Muse Code's `/goal` does.

- **Set one** with `/goal <objective>` in the prompt, or choose `/goal` in
  the `/` menu, which leaves `/goal ` ready for the objective. When nothing
  is running, Muse starts on it at once; a reply that is running takes it up
  instead.
- **The goal strip** above the task list shows the objective, its status
  (Active, Paused, Complete, Blocked, or a limit reached), a progress bar,
  and what the agent says it is doing now and next.
- **Its controls**: Pause or Resume, Edit (the objective changes in place;
  a paused goal stays paused) and Clear. Typed, they are `/goal pause`,
  `/goal resume`, `/goal edit <objective>` and `/goal clear`. Stop pauses
  an active goal. A command that cannot apply (there is no goal, or the
  goal is finished) says why.
- **On Muse Code** these are Muse Code's own goal verbs. Its goal loop also
  continues unfinished work on its own and checks the work before the goal
  closes; each of those is a model turn on your subscription. A resumed
  conversation shows its goal.
- **On the Model API** the agent has the same four goal tools (Set goal,
  Check goal, Update goal, Goal progress, with Muse Code's rows), the goal is
  kept with the conversation, and it is pinned into every request while it
  is active. A turn starts only when you set, edit or resume a goal while
  nothing runs: the backend never continues on its own and runs no check of
  its own, so your key pays for nothing you did not ask for. A token budget
  the agent gives a goal stops it once spent.

## Review

Review what the agent did before it lands, on both backends.

- **`/review`** reviews the uncommitted changes (staged and unstaged,
  against the last commit). `/review branch [base]` reviews the branch
  against its base since they diverged, `/review commit [revision]` one
  commit, and `/review <what to look at>` anything you describe, with no
  git at all. Leave out the base or the commit and a picker asks, the
  repository's default branch first. A word after `branch` or `commit`
  that cannot be a revision (it starts with `-` or is longer than 256
  characters) makes the whole line text to review. Put `security` first
  (`/review security`, or **Security review** in the `/` menu) to look for
  injection, secrets, authentication and unsafe APIs.
- **What goes with it.** The extension reads the changes with git and sends
  them marked as untrusted data: text in a diff, a file name or a commit
  message that tries to give the reviewer orders is reported, not
  followed. Environment files, keys and credentials are left out and only
  named. A very long diff is cut, and the reviewer reads the rest of the
  files itself. In Restricted Mode git does not run, so the git presets say
  so; `/review <what to look at>` still works.
  Review runs git the way the prompt's git facts do (no fsmonitor hook, no
  signature program, and `--no-replace-objects`, so a replace ref in the
  repository cannot show you other commits than history holds); fsmonitor
  is disabled with an empty value, which also works with older Git that
  treats `false` as a hook pathname. Configured clean and process filters
  do not run during review: working-tree diffs compare saved file text
  directly with stored Git text, without those conversions. Ordinary Git
  operations keep their own filter configuration.
- **On the Model API** the review is the Reviewer's turn in your
  conversation: its own prompt, and tools that only read (read, search,
  list files, VS Code's Problems). It cannot edit, run commands or reach
  the network, in any permission mode. It is part of your own turn, so it
  asks nothing extra; the model can also start the Reviewer as a subagent
  (role `reviewer`, with no custom agent named), which is a paid child task
  like any other.
  The review turn uses no external MCP server and is not blocked by one
  being unavailable. Configured servers still start when the conversation
  opens; ordinary turns keep their required-server checks.
- **On Muse Code** the review turn runs in Plan mode and your permission
  mode comes back when it ends (pick another mode meanwhile and that one
  stays). Muse Code applies its own allow rules in Plan mode, so a review
  there is not strictly read-only. Choosing a mode while Plan mode is being
  set cancels that pending review; your latest choice takes effect after any
  outstanding review mode change finishes.
  Turning Bypass off invalidates an earlier pending confirmation, even if
  turned on again. If it is revoked while a review restores the mode, the
  backend is set to Manual before another turn starts. A refused safe
  fallback retires that conversation's session; it cannot retire a newer
  conversation that replaced it.
- **Findings** end the reply as a list: severity, what is wrong, and the
  file and line, which opens the file there.
- **The review pane** (`/changes`, or **Review this conversation’s
  changes**) lists every file this conversation changed, its agents'
  included, change by change. **Accept** marks a change; **Revert** takes
  that one change out of the file as it is now, or says why it cannot (the
  file changed since, or its editor has unsaved changes). Save or discard
  unsaved changes before trying Revert again. A Revert is one step under
  turn checkpoints' file-edit lease (another window on the folder refuses a
  file restore meanwhile): it reads the saved file, rebuilds it, checks the
  path and the editor again, and writes the file (or moves a file Muse
  created to the trash) only while it still holds what was read, at the
  same path with no link or junction on the way. A save, an editor turning
  dirty (a linked buffer included) or a swapped folder meanwhile makes it
  refuse rather than overwrite. If the backend restarts while a Revert or
  the pane's list waits, the pane says so, and a Revert that wrote nothing
  can be pressed again; one that wrote stays done, even when releasing the
  lease fails afterwards (the log says so). Overlapping reverts of the same
  file run in order and rebuild from its latest saved bytes. The pane lists
  at most 200 edits and 20,000 diff lines, counting
  omitted edits even when the first patch exceeds the limit. Unreadable stored
  patches count toward that omission notice. **Comment on a
  line** sends your comment to the agent with that line and the lines
  around it: into the running turn, or as your next message.
- **A review is a turn.** It is marked running and takes its turn
  checkpoint like a message, so another window refuses a file restore while
  it runs. A message you send while a review is starting waits for it and
  then goes into the review turn, and only one review starts at a time.
  Clearing the conversation while a review is starting lets the new
  conversation's review or message start at once.
  A pending permission-mode request settles before review admission; a refused
  request refuses that review instead of trusting the panel's optimistic label.
  A review reply arriving after you clear or switch conversations cannot mark
  the current conversation running or accept the old turn checkpoint.

## Scheduled prompts (Model API)

On the Model API backend, `/loop 10m Review the build` saves a prompt in the
current conversation to become due every ten minutes. Use `m`, `h`, or `d`
for minutes, hours, or days; `/loop "0 9 * * 1-5" Summarize new bugs` uses
a five-field cron expression in your machine's local time. `/loop <prompt>`
defaults to ten minutes. `/loop list` refreshes the panel's schedule list,
and `/loop cancel <id>` removes one. The list above the composer shows each
prompt, cadence, next run or due state, run count, and ID, with **Run now
(paid)** once a prompt is due (**Enable paid runs** while paid runs are
off) and **Cancel schedule** controls.

Each job belongs to this workspace, conversation, and stored Model API key.
Signing out or switching backends hides its prompts immediately; a temporary
CLI sign-in attempt leaves the still-active Model API list in place.
It expires after seven days; `/loop 7d ...` has no run before that deadline
and is refused. A due prompt stays pending until Run, Cancel or expiry.
Only a loaded conversation checks for due work;
closing VS Code stops checks. A missed recurring interval leaves one due
occurrence, without a backlog. A due prompt **never runs by itself**: turn
on **Scheduled prompts (paid)** and accept both published standard and
contributor token rates, then choose **Run now** and allow that
occurrence's prompt, model and exact tier rates in the paid-use popup
(Allow once, Allow always in this workspace, or Deny). An
unpriced model cannot be approved. Declining leaves it due until expiry and
makes no API call. Bypass
permissions does not skip either one; only **Allow always in this workspace**
skips the per-run popup, and Run now is still yours to press. A changed model, prompt,
conversation or paid setting refuses an old confirmation; the client checks
the key it actually reads before HTTP. A receipt claimed just before such a
change is never replayed, so that occurrence may be skipped without a charge.
A run that reaches its first Model API request has a paid row
in the transcript and a count in Account & usage; its token cost is already
in that conversation's token estimate. A run admitted just before a crash
is not replayed, even if its result was never seen. Cancel does not stop a
turn that already began.

Muse Code has its own subscription-backed `cron_create`, `cron_list` and
`cron_delete` tools. Ask it in chat to schedule, list or cancel its jobs;
those are not the Model API jobs shown by this panel. Muse Code 1.3.0 does
not expose scheduler controls over MSP or a `muse cron` CLI command, so the
panel cannot present an authoritative native job list or direct cancel.

## Observation packing (Model API)

In the panel, on by default (`museSpark.modelApiObservationPacking`, machine-scoped).
ACP and headless Model API conversations enable the same packing and literal
recall by default for tool-capable models. Every request of a Model API conversation carries the tool outputs before
it. With packing on, a tool output over 8,000 characters is sent whole for
its first two requests, then as a short placeholder: its id, its size, and
its first and last lines. The placeholder is the same text on every later
request, so the prompt cache breaks once per output. When the model needs
more, it calls `recall_output` with the id and a character offset and reads
the original back 4,000 characters at a time. It can also pass `search` to
find a case-sensitive literal string at or after the offset; each page starts
at the first match. The tool is declared throughout a packing conversation,
and packed outputs keep the same placeholders after resume, fork or rewind.
Each page names the tool that returned it and is marked as untrusted tool data between fresh markers, as
a fetched page is. The conversation keeps every output whole, and the
transcript shows it as it was. Goal progress travels at the end of each
request, outside the cached instructions. The prompt date is the local date
at session start and remains fixed when the conversation is reopened. Cache
miss diagnostics appear only in the log; they trigger no extra model call.

- **Measured first.** It got its setting after the paired evaluation (M75)
  held the capability floors with it on: all twelve tasks passed on both
  arms, and on the two long-output tasks packing sent 39% fewer input
  tokens for about the same cost, since the outputs it leaves out were
  mostly read from the cache at the lower rate
  (`docs/certification/m73.md`).
- **Account & usage** shows "Packing saved (estimate)" while a conversation
  packs: the tokens the placeholders left out, at about four characters a
  token, net of what each placeholder costs. It is an estimate, never a
  bill, and it stays with the conversation when you reopen it.
- **A recall is one more model call** in the turn, billed to your key like
  any other.
- A conversation reads the setting when it starts or is reopened, and
  keeps it for its life; a child task never packs. The Muse Code backend
  has no hook for this. The ACP agent and headless runtime share the same
  packing engine and `recall_output`, including literal search; they have no
  VS Code setting to read.

## Checking edits

The agent sees what its edits did without asking for it.

On the Model API backend, a symbol rename participates in the same edit
round: files it successfully writes are checked, including the written part
of a rename that fails later. Other live conversations hear about its planned
paths before the final rechecks, so their cached check approvals lapse while
the rename is pending.

**On the Model API backend**, after each round of tool calls that edited
files, and before the next request to Meta:

- **Diagnostics** (`diagnosticsAfterEdits`, on by default): the edited
  files' errors and warnings from VS Code's language servers, with what
  changed since each file's previous check (new, fixed). VS Code's servers
  report only on a file an editor shows, so each edited file no editor shows
  opens in a tab beside your editor, without taking focus, while its server
  reports (up to 10 seconds a file), and the tab closes again unless you changed
  it. A file no report arrived for, one with unsaved changes, or one past
  the first 8 of a round is **not checked**, and the model and the row say
  so; it is never reported clean. At most 50 problems are listed.
- **Code the editor runs is never opened or formatted.** Opening a file can
  make an extension load its configuration as code (`eslint.config.js`,
  `.prettierrc.cjs`, `package.json`, anything under `node_modules`), so the
  loop never shows or formats one, and after any live Model API conversation
  or subagent in this workspace starts writing one it shows
  and formats nothing more until your next message.
- **Check commands** (`checkCommands`, none by default): your lint, test or
  type-check commands, for example
  `[{ "name": "lint", "command": "npm run lint", "changedFiles": true }]`.
  Each runs as the shell tool runs a command, from the workspace root, in a
  job object on Windows, with no sandbox, and **your tool hooks see it as a
  shell call** (PreToolUse can deny it, rewrite it or make it ask;
  PostToolUse can add context or stop the turn). It **asks wherever a shell
  command would ask** (Manual, Edit automatically and Auto), and
  never runs in Plan mode or Restricted Mode. "Always allow in this session"
  allows that check for the conversation (never the agent's own shell call
  of the same command, which asks as it always did, nor does a shell grant
  answer for the check), but once any live conversation or subagent in
  this workspace starts editing a
  file that decides what the command runs (`package.json`, a `Makefile`, a
  config the tools load, or a file the command names; for a command with
  quotes, variables or other shell syntax, any file) it asks again until
  your next message. A write still in progress keeps that protection even
  across a new message or a newly opened conversation; a check that starts
  during the write cannot certify the completed state. Project memory
  writes, including a new note's index, also invalidate checks that name
  them, without scheduling automatic checks of memory.
  `changedFiles` adds the edited files that still exist
  after `--`, each quoted as one argument; a file name that starts with `-`
  or `@`, or on Windows one holding `"`, `&`, `|`, `<`, `>`, `^`, `%` or `!`
  (which Windows PowerShell 5.1 and `cmd.exe` would read as syntax), keeps
  the check from running. `timeoutSeconds` (300 unless set, 600 at most)
  caps each run. A check you reject is not asked again until your next
  message, and a check the model already ran since its last edit is not run
  again after the round. Nothing runs after the turn's last round.
- **One budget.** What the model reads after a round, diagnostics and every
  check's output together, is capped at 64,000 characters, shared out.
- **The fix loop is bounded.** After three rounds in a row whose checks
  failed, the checks stop until your next message (a goal's wake does not
  start them again); the model is told to stop fixing and say what still
  fails, and the panel says so too.
- **Format on edit** (`formatOnEdit`, off by default): each file `write_file`
  or `edit_file` writes goes through the formatter VS Code would use for it
  (`editor.defaultFormatter`) before anything checks it; the row's diff
  shows the formatted result, and the model is told to read the file again
  before editing the same lines. If the formatted text cannot be written,
  the edit stays as written and the log says why.

Ordinary file writes and format-on-edit publication recheck the captured
turn, mode, trust and unsaved-buffer admission after checkpoint preimage waits
and at the native atomic boundary. A refused late formatter keeps the edit
already written and its patch. Rename still finishes after its first actual
write if Stop arrives. Diagnostics returning under revoked ownership are
withheld as unchecked; configured checks recheck admission after checkpoint
activity marks and native launcher preparation. Restricted ordinary reads
and edits retain their existing behavior; formatting and commands require trust.
Every sequential check keeps the original batch admission, and explicit
checks keep it through path preparation. A completed check retains its actual
status; a later unstarted check is marked refused. An explicitly moved
background shell keeps its own controller after the parent turn ends, while
captured mode/trust and its own Stop, session disposal and Host close still hold.

A **Check edits** row shows what ran: the files, their errors and warnings,
how many were not checked, and how each check ended; open it for what the
model read. The model can also call **run_checks** itself (files it names,
which must exist in the workspace, or those edited since your message), with
the same rules, and give `write_file` or `edit_file` a **`then_run`**
command, such as the test of the code it changed: the command takes the
shell tool's hooks and permission path, runs only if the file still holds
what the edit wrote (after formatting), and its output is the call's second
result, under the diff in the same row. A command a hook denied says so,
with the hook's words, apart from one you rejected.

**On Muse Code**, which runs its own tools, each message tells the agent to
check the files it edits with `mcp__ide__getDiagnostics` (only while
`diagnosticsAfterEdits` is on and the session has the IDE tool server) and,
in a trusted workspace, to run your check commands through its own shell and
approvals. `getDiagnostics` opens only a file inside the
workspace by its real path, never one that is code the editor runs. Checks
that run automatically after Muse Code's own edits would need an event Muse
Code does not send (an ask for Meta, PLAN.md M68).

## Session board and best-of-N

The header's board button lists every conversation open in the window, on
either backend, and the saved conversations of the backend this window runs
on (the ones it can resume). Each row names its state (**Running** or **Idle**), branch, changed
files and waiting approvals, running conversations first. Type to filter,
press Enter (or click) to resume a conversation. Ephemeral Best-of-N rows
open their owned worktree instead: they have no saved conversation to resume.
**Best of N…** opens the best-of-N dialog.

Best-of-N runs the same prompt in 2 to 5 worktrees at once on the Model API
backend, then you take one. It needs a trusted workspace with a folder open
(worktrees run git, which Restricted Mode forbids).
Best-of-N (Model API, paid, available by default) is controlled by
`museSpark.modelApiBestOfN` ([Paid](#paid-features)); set it to false to hide
it. Each run asks once in the
paid-use popup, naming the prompt, the
published rates, the attempt count and the per-attempt request ceiling, in
every permission mode, Bypass included, unless you allow best-of-N always in
this workspace; the subscription never pays.
Automatic worktree creation, capture and apply require Git 2.36 or newer.
They suppress repository hooks, fsmonitor, replacement refs and automatic
maintenance, and refuse configured filter or hook programs. File tools list
the attempt's actual worktree, including its new and uncommitted files.
Attempts run no shell command and no configured check, in any mode: a
command's working folder confines nothing, so one could change your own
checkout.

Each attempt works on its own `best-of-n/<run>/<index>` branch in a folder
beside the repository, like a worktree of your own. An attempt that would ask
you anything (an approval or a question) is declined instead and counted, and
each actual Model API request attempt, including retries, counts before its
HTTP request is sent. A changed key, account, conversation, trust or paid
gate stops further requests. Attempt hosts share one captured, account-owned
originating session budget. A finite cap refuses a run when no owned parent
scope exists; separate attempt transcripts never create fresh allowances.
When successful attempts finish, the
dialog compares two at a time (**Left** and **Right**): their changed files
and the diff, clipped past the cap with a note. The comparison captures an
immutable Git tree of tracked edits and unignored new files, including
uncommitted edits. Ignored files are excluded. **Apply and stage** applies
the exact selected snapshot to your checkout and stages it; it creates no
commit. Later edits in an attempt never silently replace the captured
preview. The base HEAD, clean index and working files, unsaved editors and
protected or linked targets are checked before application; a changed target
refuses the action. Failed, cancelled or unreadable attempts cannot be taken.
An apply failure is reported without claiming success; inspect your checkout
before retrying. **Open in New Window** opens an attempt's owned worktree,
its uncommitted work included. Account & usage lists reported attempt tokens and their
estimated cost separately; requests without usage reports remain unknown,
even if they failed. They are not claimed as included in the parent estimate.
**Cancel run** stops unfinished attempts, including
setup waiting on consent, without deleting their work.

## Auto rules and permission profiles (Model API)

`museSpark.modelApiCommandRules` holds user or machine prefix rules with
`pattern`, `decision` (`allow`, `ask`, `forbid`), `match` examples and optional
`notMatch`, `shell` and `justification`. Examples are checked when the rules
are read. Standing allow rules cover one plain command only. Chains,
pipelines, substitutions, redirections, evaluators and unrecognized syntax
require a user decision; an automated hook or reviewer cannot approve them.
Forbid matches anywhere and refuses even in Bypass. Bypass skips ordinary
nonpaid questions; Plan stays read-only. An existing user-granted exact-line
session rule still covers only that exact line.

`museSpark.modelApiPermissionProfiles` names file policies with `denyRead`
globs and optional absolute `extraRoots`; only `read_file` can use those
extra roots, with canonical confinement. Select one with
`museSpark.modelApiPermissionProfile`. Denied paths are neither read, listed,
searched nor written by the file tools. A missing or malformed selected
profile refuses every file until resolved. The shell is not confined by
these profiles: while a profile is active, each shell command asks in
Manual, Edit automatically and Auto (Plan and forbid rules refuse it;
Bypass runs it). External MCP tools also ask then, including tools a server
marks read-only, which ask in Plan too: that hint cannot enforce these file
rules.
Project `add_memory` must be permitted to write both its note and `MEMORY.md`
index; `edit_memory` checks only its note. An add is refused if the index is
denied even when appending might not update it, preventing an existence race.
Code intelligence uses these same denials for primary documents, native
reads, returned paths, repo-map inputs and every rename file. Allowed
results remain available; withheld paths are counted. A hover that may
include a denied declaration is refused. Changed rules also discard a
cached prompt map. VS Code's language providers maintain their own indexes;
these rules govern the extension's reads and returned information.
`museSpark.modelApiRepositoryRules` can add only ask/forbid command
rules and file denials; it cannot add an allow, choose a wider profile or
grant an extra root. A project skill is a workspace file: `read_skill`
refuses one these rules deny. A change to these settings, the mode or the
workspace's trust also reaches calls already in flight. Whatever any tool
brings back, an MCP or IDE tool's included, is judged again just before it
reaches the model, and a call the new settings no longer allow is refused,
with nothing from it sent; a change it had already written stays, and its
row says so. Output that may quote files it cannot list (a shell command's,
an MCP or IDE tool's, a check's, a subagent's) is refused if any of these
settings or the trust changed at all while the call ran, and a subagent's
result is withheld if they changed since it started, after a restart too.
A shell command is judged again at its process's entry, a memory note at its
write, and an image edit's sources right before the request leaves the
machine. These controls apply to the Model API; Muse Code uses its own
captured native policy contract.

`museSpark.modelApiAutoReviewer` is an off-by-default paid opt-in. Reviews
run only in Auto. Every eligible review uses the paid-use popup at the
current model's token rates, with only the popup's workspace permission able
to remember consent. The reviewer has no tools and returns ALLOW or ASK with a nonempty
reason. It can answer only an unsettled plain-command or MCP ask in Auto;
forbids, ask rules, profiles, complex commands, protected edits, paid tools
and child tasks are never delegated to it. Its key, model, turn, mode, trust
and current policy are captured before consent and checked again before
HTTP. A changed context, failed or unreadable answer, or tripped circuit
breaker falls back to the user's card. Reviewer usage is reported separately
and shares the originating M82 journal by owned reservation, final key/cap
checks and actual response settlement. Missing usage retains an unknown
conservative liability. A finite-cap direct review refuses without that
owned scope. The review owns its own claim after the ordinary request
settles. Invalid token counts refuse ALLOW and retain unknown liability;
host close stops admission before its end hooks finish. No guessed native fields or new
shell parser are involved.

## Muse Judge

Muse Judge adds risk advice to approvals already held for an Auto reviewer
or shown as a card. A ready caution turns a reviewer's ALLOW into the normal
question, or adds a fixed note to the card. It never allows an action. Cards
and reviewers continue immediately if Judge is pending, unavailable or
unsure; native and immediate Auto allows start no Judge.

Phase 1 uses the conversation's own model, with stated confidence labelled
**uncalibrated**. A single-model setup keeps the main Model API request bytes
and Muse Code's main-session MSP frames unchanged. There is no separate
model, local engine, Judge CLI or extra hint in the chat request.

On Muse Code, Judge uses your subscription and counts against its limits.
Its first use explains this, without a Model API price prompt. Each batch
runs in a fresh hidden Plan session, with no MCP servers, in an empty
temporary folder removed afterward. Standing user-level allow rules or
unreadable settings disable it. The tool-item guard reacts to notifications;
this isolation does not prove that no native tool ran.

On the Model API, Judge asks for paid-use consent with the model's rates and
`museSpark.paidDailyBudgetUsd` before spending. Each dispatch reserves against
the same durable daily budget as interactive extras across windows. A known
non-send refunds; complete usage settles the claim; missing receipts retain
liability. The subscription never pays for a Model API call. These paths are
verified with the real local journal and fake transport; no paid/live Judge
call or production calibration is claimed.

`museSpark.judge.engine` is machine-scoped: `auto` (default) uses the same
model, `same` keeps that selection explicit, and `off` disables Judge. Set
it to `off` in Settings to stop future judgments. A measured ready rate below
the floor disables `auto` on that backend; no production ready-rate or
precision measurement is claimed here. Status and separate dispatch rows
show what ran, with missing usage left unknown. See [Judge](docs/judge.md)
for the phase-1 contract and remaining certification.

## Web fetch

The model can read one public web page it found or you
named: `web_fetch` on the Model API backend, `mcp__ide__webFetch` on Muse
Code (whose own `web_fetch` is off). The extension fetches the page itself,
from your machine, and hands the model its text. It costs nothing: it is not
Meta's paid web search.

- **What it reads.** `https://` pages only. HTML is parsed as a browser
  parses it (parse5, the HTML standard's algorithm), in the encoding the
  page declares (one this computer has no decoder for refuses the page,
  never read as UTF-8), and comes back as Markdown, titled only from its
  `<head>`. Only a byte-order mark or valid HTTP charset makes the encoding
  definite; HTML meta declarations outrank an XML declaration fallback and
  can replace a tentative encoding found earlier. Links resolve against
  its `<base href>`. A `<picture>` keeps its fallback `<img>` when it has
  alt text and an HTTP(S) source, as any image does; `<source>` and
  `srcset` alternatives are not selected or fetched. Left out is only what
  is never page text by its structure: scripts, styles, a template's content (a declarative shadow
  root's is kept, where it stands), `<noscript>`, embedded frames and media,
  forms' controls, SVG and MathML. Nothing is judged by how it would render:
  the model gets the page's text as served, which can include text a
  browser would not show (hidden by a stylesheet, by an attribute such as
  `hidden` or `aria-hidden`, or by a script), and all of it reaches the
  model inside the markers that call the page untrusted. Hiding cannot be
  worked out completely without running the page, and a page can put the
  same words in visible small print, so the markers are the defence. Each page is converted on a worker thread of its own,
  at most two at once, stopped at 10 seconds or 512 MiB (for example, a
  page nested to be slow to parse), and then refused with the reason. Plain text, Markdown, JSON,
  XML, CSV, YAML, TOML, CSS and JavaScript come back as they are; XHTML
  (`application/xhtml+xml`) is refused, since read as HTML its XML syntax
  would be misread; anything else is refused with the reason. At most 5 MiB (after decompression) within 30
  seconds; the model reads the first 50,000 characters, and is told when
  there was more. A page built to expand stops converting at 100,000.
- **Where it may go.** Public internet addresses only. A URL that names a
  local or reserved name (`localhost`, `*.local`, `*.internal`, single-label
  intranet names) or a non-public address is refused before anything else
  happens. A name is looked up only after the fetch is approved (the lookup
  itself carries the name out), on your machine, and refused when any answer
  is loopback, private, link-local, carrier-grade NAT, a cloud metadata
  address or otherwise reserved; on an IPv6-only network, an answer under
  the network's NAT64 prefix is judged by the IPv4 address it carries, and
  while that prefix cannot be learned no IPv6 answer is used (a name with
  only IPv6 answers is then refused with the reason). The
  request then goes to an address that was checked, never to a second
  lookup, and TLS still verifies the page's name; when one address does not
  connect within a quarter of a second, the next is tried too. A redirect on
  the same host is checked and pinned the same way, at most five times; a
  redirect to another host is handed back to the model, which asks again.
- **Asking.** Each host is approved on its own: the Model API backend's card
  names the URL, and "Always allow in this session" covers that host only.
  A `PermissionRequest` hook may refuse a fetch or ask, but its "allow"
  does not replace the card. Bypass runs it without asking, Plan refuses it, a side chat does not offer
  it, and Restricted Mode turns it off. On Muse Code the extension asks in
  its own dialog before every fetch, whatever mode Muse Code runs in, and
  offers the tool only in a trusted workspace whose
  `museSpark.sandboxNetwork` is not `restricted`. When Muse Code stops
  waiting (you press Stop, or its own limit passes), the fetch stops, and an
  answer given in the dialog after that fetches nothing. On both backends,
  losing the workspace's trust (or, on the Model API backend, moving to a
  mode that refuses fetches) while the question is open or the page is
  loading stops the fetch before its next request, and a page already in
  does not reach the model.
- **Untrusted content.** The model receives the page between two markers
  with a random value the page cannot know, and a note that the page is
  data from the web, not instructions; a redirect's target and the page's
  title stay inside the markers, and a server's type or compression is named
  only when it is a short token. The row shows the URL, the size and type,
  and exactly what the model read. On the Model API backend a refusal, or a
  redirect handed back, is said in your language instead; on Muse Code the
  row shows the tool's own result, which is the model's English text.
- **Proxies.** The request takes VS Code's proxy and certificate settings,
  as the extension's other requests do. Through a proxy the extension still
  checks the address itself and asks the proxy for a tunnel to that
  address, so the proxy decision (`http.noProxy`, a PAC file) sees the
  address, not the host name: a rule written for a name does not match it.
  A proxy that refuses a tunnel to an address is reported as the proxy's
  refusal, and a network where only the proxy can look names up cannot use
  web fetch.

## Browser check

After changing a web page, the model can open it from your local dev server
in a headless browser and see it working: `browser_check` on the Model API
backend, `mcp__ide__browserCheck` on Muse Code. It costs nothing.

- **What comes back.** The console errors (and uncaught exceptions) and the
  failed requests (a network error, or an HTTP status of 400 or more), up to
  20 of each; on the Model API backend also a screenshot, which the model
  sees as it sees an image `read_file` read. Muse Code gets text only until
  a capture shows that an `ide` tool's image reaches its model. Before the
  page is read, the model may run up to eight click or type steps, each
  naming a CSS selector. A check ends after 60 seconds; a page still loading
  after 15 is read as it stands.
- **The browser.** Google's Chrome for Testing headless shell, one exact
  version pinned by each extension release (now 154.0.8037.92), on Windows
  x64, Linux x64 and macOS (Intel and Apple silicon; the Apple silicon build
  has not yet been run by this project's own checks). The first check asks
  before downloading it, about 100 to 120 MB from Google's
  `storage.googleapis.com`, into the extension's own storage; with
  `museSpark.browserCheckRuntime` (machine-scoped) set to `download` it
  downloads without asking, now and for every version a later release
  pins, and `off` turns the check off and downloads nothing. The download,
  and each file of it, is checked against the pinned length and SHA-256
  before anything runs, and the browser's own file again before each check.
  Getting it ready has its own 15 minutes; the check's 60 seconds start
  after. A pinned version serves for 45 days after Google published it;
  after that the check refuses until an extension update pins a newer one.
  Each version stays in that storage until you remove it. The browser runs
  headless, talks to the extension over its debugging pipe and never opens
  a network port (the page sees `navigator.webdriver` set), uses a fresh
  private profile under the extension's storage that is deleted afterwards,
  never yours, and ends with the check, when you press Stop, when trust or a
  setting withdraws the check, and when the window closes.
- **Where a page may go.** Everything the browser sends goes to the
  extension's own proxy, started for that check on 127.0.0.1: the browser's
  proxy with its usual loopback exception removed, and the same proxy on
  the page's private browser context. The proxy passes only plain `http` to
  this computer (`localhost`, `127.x.x.x` and `[::1]`) and to hosts you
  widened, with sign-in challenges and credentials taken out both ways, so
  a page cannot sign in as you over plain `http`; anything else gets a fixed
  refusal. The browser looks up no host names itself; the proxy looks up
  only a name you widened, once. `https` and WebSockets reach only a host you
  widened, this computer included (a page on `https://localhost` needs
  `localhost` in the setting). That traffic is encrypted, so the proxy passes
  it unread, and a site there may sign in as you with this computer's
  account (on Windows in particular). Before, between and after the page the
  check runs its own tests in the same browser (requests that must arrive
  refused at the proxy, a sign-in challenge that must be taken out, WebRTC
  and WebTransport that must stay inside the proxy); one that fails stops
  the check and nothing from the page comes back, and so does a restart of
  the browser's network service during the check. Every frame and worker
  the page starts is watched from its first line: a WebSocket beyond the
  allowed hosts, or an answer that did not come back through the proxy,
  stops the check too. To let checks reach other hosts, name them in
  `museSpark.browserCheckExtraHosts` (machine-scoped: plain host names or IP
  addresses, no ports, paths or wildcards). The model can never widen it.
- **The download.** What comes from Google is one archive per platform,
  the version this release pins (154.0.8037.92), checked before use against
  the length and SHA-256 recorded in the extension
  (`src/host/browser/runtime/browserRuntime.json`):

  | Platform    | Archive bytes | Archive SHA-256                                                    |
  | ----------- | ------------- | ------------------------------------------------------------------ |
  | Linux x64   | 120,477,194   | `636aa5c79f2693632e9921b8bbb050038ba11672e02346c06c20f991aed096f9` |
  | macOS arm64 | 99,221,129    | `77da14e75d7f2568e6f7898d3df7cdc6faac74b15e903b2c9d486ebb6ca9b929` |
  | macOS x64   | 104,748,425   | `a54292aaacbb77f76f6ef47558e7c51ab884044e0adacca315567f83c060bcc4` |
  | Windows x64 | 120,822,223   | `3ac2561f02d9d87aadc0399d00b9002d718a4c365624fa67db9e7bfaf6b1a568` |

  Unpacked it takes about 205 to 285 MB. The consent dialog names the
  version, the size, `storage.googleapis.com` and the folder; Download
  fetches it, Not now (or closing the dialog) downloads nothing and the
  check does not run. **Muse Spark: Download Browser Check Runtime** asks
  the same question and prepares it ahead of a check, with progress you can
  cancel. It is kept in VS Code's global storage for this extension
  (`globalStorage/randynorthrup.muse-spark-code/` under VS Code's user data
  folder: `%APPDATA%\Code\User` on Windows,
  `~/Library/Application Support/Code/User` on macOS, `~/.config/Code/User`
  on Linux; another VS Code edition has its own), in
  `browser-runtime/<version>/<platform>/`, with each check's temporary
  folder under `bc/` beside it. To remove it, set
  `museSpark.browserCheckRuntime` to `off` and delete that
  `browser-runtime` folder; nothing else is installed or registered on the
  machine. With the setting back on `ask`, the next check asks again.

- **What the check cannot promise.** `https` and WebSocket traffic to a
  host you widened goes through the proxy as an opaque tunnel: the proxy
  sees only the host and port, cannot strip a sign-in challenge from it,
  and a site there may sign in as you with this computer's account (on
  Windows in particular). That the browser looks up no host names itself
  was traced on Linux only; on Windows and macOS it rests on the same
  resolver rule, which the check holds the browser's command line to, not
  on a trace. The check's own tests need an IPv4 address of this computer
  that is not loopback (a network adapter with an address): on a computer
  with none they cannot run, and every check ends with "the browser check
  could not run one of its own confinement tests"
  (`unverifiable`). This is the browser's construction checked at runtime,
  not an operating-system sandbox.
- **Asking.** On the Model API backend the check is judged per host like web
  fetch: Manual and Auto ask on a card naming the URL, "Always allow in
  this session" covers that host, Bypass runs it, Plan refuses it and
  Restricted Mode turns it off. A host beyond this computer and the setting
  always gets a card, Bypass included; allowing it lets that check (or,
  with "Always allow", that host for the session) be reached. On Muse Code
  the extension asks in its own dialog before every check, naming a host
  beyond this computer, and offers the tool only in a trusted workspace
  whose `museSpark.sandboxNetwork` is not `restricted`.
- **Untrusted content.** What the page produced (where it ended up, its
  console, its requests) reaches the model between markers the page cannot
  know, as untrusted data. The row shows the counts and the entries in your
  language; on Muse Code the row shows the tool's English text.

## The panel

**Composer.**

- `Enter` sends and `Shift+Enter` breaks a line (or send with `Ctrl+Enter`
  through a setting). The box grows with your draft up to ten rows, then
  scrolls inside.
- While a turn runs, `Enter` steers it and Stop cancels it; Stop also drops
  messages still queued, which read "Not sent". A picked text file on Muse
  Code queues a new turn so its file annotation survives History resume.
- **Edit a queued message.** A message the model has not read yet reads
  **Queued**. Its ⋯ menu (or a right-click on it, Shift+F10 or the Menu key)
  offers **Edit**: the message leaves the queue and its text and images come
  back to the prompt box, alone in an empty box or above your draft with a
  blank line between, so no draft is lost. If it reached the model in the
  meantime, the card stays and a notice says it can no longer be edited. On
  the Model API a message steered into the running turn can be edited until
  the next request reads it. On Muse Code a steered message joins the
  running turn at once, so its menu says it was delivered; Edit is offered
  for the messages Muse Code queued (a handoff, a message with a text file,
  a refused steer).
- The `+` button attaches images (PNG, JPEG, GIF, WebP), PDFs on the Model
  API backend, and UTF-8 text files up to 1 MiB from trusted, indexed workspace
  paths (`.txt`, `.md`, `.markdown`, `.csv`, `.tsv`, `.json`, `.jsonl`,
  `.yaml`, `.yml`, `.xml`, `.log`, `.html`, `.css`, `.js`, `.jsx`, `.ts`,
  `.tsx`, `.py`, `.ps1` and `.sh`; another text file becomes an `@`
  mention). Text files travel with their names as text on both backends. Files
  attached to Muse Code share its 10 MiB message limit; the composer counts
  their serialized content, including escaping, and refuses combinations
  that leave too little room for the prompt. Remove an attachment or shorten
  the message if that happens. Switching backends keeps visible chips; Muse
  Code checks them again before a send or steer and may require removal of an
  image attached under Model API. Model API text attachments share a separate
  768 KiB allowance for their UTF-8 content and file-name wrappers. A large
  single file can be refused despite the 1 MiB per-file read cap; attach a
  shorter excerpt or remove another text attachment. A long conversation may
  still exceed the Model API context limit. Files outside that set
  become `@` path mentions; known binary types and private
  files are refused. A PDF picked under a `.png` or `.txt` name follows its
  detected PDF header and 32 MB limit; Muse Code gives its PDF refusal.
  Ordinary unindexed text remains a path mention, and private filenames are
  refused before any PDF check.
  Images and PDFs also paste and drop. A dismissible banner gives the specific
  size, media, backend, text or private-file refusal; unknown file reasons
  keep generic unsupported-type guidance. Muse Code's MSP 1.3.0 cannot take a PDF part, so a PDF attachment
  there names the Model API backend instead. The Model API agent can read a
  workspace PDF or image through `read_file`; other workspace files use its
  existing UTF-8 text reader. Excluded text files share only a path mention,
  and the Model API reader confines paths to the workspace. Picker reads stop
  at the file's size cap even if it grows during the read. A native picker
  still open after New Conversation or sign-out cannot add an old file or
  mention to the new draft. Model API text,
  image and PDF reads use the checked canonical workspace target if a link
  changes after confinement. Host file I/O also rejects an observed change
  to that checked path when a parent directory becomes a junction after the
  first check; paid image output reservations recheck before fill and cleanup.
  Combined image
  and PDF data URLs are capped at 48 million encoded characters per message;
  an excess pasted or dropped attachment is refused before the browser reads
  and encodes it. Replayed requests use the same cap and
  keep newer media, announcing when older media is omitted from the request.
  Paste/drop checks the first 1 KiB of image-labelled files: a PDF named
  `.png` or `.txt` uses the 32 MB PDF limit and PDF media type, while a real image over
  10 MiB is refused without encoding its full bytes. The check is discarded
  if the conversation changes before it finishes. Plain text clipboard content
  keeps its normal paste behavior; text-named files without clipboard text are
  probed and ignored when they are not PDFs. Private names are refused first.
  A PDF whose page tree cannot be counted without ambiguity reserves all 50
  image slots, including when comments, escaped names or indirect `/Count` or
  `/Type` references obscure the real tree beside a visible decoy.
  The original attachments remain in local history. A batch of Model API
  `read_file` tool calls uses the same media cap; a file over that batch cap
  gets a failed tool result before its bytes are retained. PDF and image
  tool rows use the installed panel language and number format; the model
  receives its English result.
- A path with a space, `#` or `"` is written in quotes,
  `@"my notes/a b.md"#5-10`, and the menu searches what you type after `@"`.
- The model pill reads `model effort` (effort tiers Minimal to Max, each
  verified per model); the mode button opens the Modes menu; the microphone
  dictates.
- The **context meter** is a ring beside the mode button that fills
  clockwise with the share of the context window used, the whole percent
  inside it: rounded down, "<1" under one percent, "100" once the window is
  full or exceeded. From 70 % the ring takes the warning colour and from
  90 % the error colour; the number always carries the value. Its name and
  tooltip give the tokens used and the window, the pressure word the
  backend reports, and say when the window is exceeded. Click it to compact
  now. A backend that has not reported a window shows no meter.
  On the Model API backend, `/compact` builds a structured summary with the
  exact open tasks and file paths, and keeps recent whole turns verbatim
  (up to roughly 20,000 tokens, scaled down for smaller model windows).
  Repeated compaction without new work makes no model call. Empty or
  incomplete summaries leave the conversation as it was; transient stream
  failures use the same bounded retries as a reply. Where the model supports
  keeping tools with history, compaction retains the last request's cached
  prefix. A requested tool is discarded and retried without tools; no
  compaction tool executes. Paid hosted-search requests use that tool-less
  path directly. Input is rebuilt from the current replay, so Stop's removed
  media stays removed. File lists include only successful operations and the
  arguments actually used after hooks. Model changes during hooks resolve the
  new window and capabilities before dispatch. ACP editors and the headless
  runtime recognize an exact `/compact` prompt through this same session core;
  an empty headless session returns a no-op without a model call (exec reports
  `incomplete`, exit 8, with `no_compactable_history` because there is no model
  response to certify).
- **Stop** turns red on hover and keyboard focus; in the high-contrast
  themes its icon and border take the error colour instead.
- Every row of the palette and the `/` list has a one-sentence tip, as its
  tooltip and its accessible description. A skill's tip is its own
  description, or "Run the _name_ skill." when it has none.

**`/`: the palette and the slash commands.** A `/` on an empty prompt stays
in the box and shows the palette above it; the `/` button opens the same
palette with a filter box of its own. Its groups:

- **Context:** attach, mention, clear, resume, new and remove worktree, and
  Continue a Claude Code or Codex session (CLI backend).
- **Git and pull requests:** commit, push, open a pull request, and open a
  pull request in a conversation.
- **Model:** switch model, effort (Left and Right step it), thinking.
- **Customize:** permission mode, Focus view, Send with Ctrl+Enter, MCP
  servers, hooks, memory, settings, keybindings.
- **Account & usage** (with the paid features' toggles where the backend can
  use them), **Skills** (the session's own, plus Manage and Import on the CLI
  backend), **Slash commands**, **Review** (the review presets and the review
  pane) and **Support**.

Type a letter after the `/` and the palette gives way to a flat list of slash
commands narrowed as you type: `/agents`, `/changes`, `/clear`, `/compact`,
`/config`, `/cost`, `/export`, `/goal`, `/handoff`, `/hooks`, `/logout`, `/mcp`,
`/legal`, `/memory`, `/model`, `/permissions`, `/resume`, `/review`,
`/security-review`, `/usage`, `/loop` (Model API backend),
and the session's skills. Names that start with your letters come first. Up
and Down move, `Enter` runs a command (a skill, `/goal`, `/review` or `/handoff`
is completed so you can add what follows it), `Tab` completes the name and
`Esc` closes the list. With nothing matching, `Enter` sends the text as it is.

**Transcript.**

- Replies render as GitHub-flavoured markdown with highlighted code and
  **Copy**, **Insert at cursor** and **Apply** on every block (an imported
  conversation's blocks carry **Copy** only); a finished
  reply's ⋯ menu has **Copy response** (the ⋯ shows a check for a moment
  after) and **Reply to this output**. A relative link in a reply
  (`src/parser.ts#L12`) opens that workspace file at those lines.
- Tool rows show the diff or the command and its output from the start;
  read rows open on click, and a chevron marks the rows that open. A shell
  row's IN and OUT are one bordered block split by a rule, each part showing
  five lines (and at most 2,000 characters) with its own **Show more**; your
  own `!` commands look the same. Other outputs show 12 lines or 2,000
  characters, with **Show more**. A backgrounded call carries a
  "background" badge.
- **Steps fold under what they did.** A run of two or more finished steps
  (tool and reasoning rows with nothing between them) folds into one
  summary row, such as "Edited 2 files, ran a command, and read 3 files",
  which opens in place. Files count once however often they were touched.
  A failure is named in the summary, with its red dot; a step waiting on
  you never folds, and a running one stays below the summary until it
  finishes. **Focus view** (`Ctrl+Alt+F`) folds every step that is not
  waiting, under the same summary.
- While Muse works, the status line shows a small looping circle-pattern
  mark, the verb, and a heartbeat trace centred in the chat (hidden below
  260 px). With reduced motion both stand still.
- **Message times.** Hover a message or move the keyboard into it to see
  when it was sent or received, at the card's corner: the time alone for
  today, otherwise the date and time, in the display language; its tooltip
  gives the full date and time. "Today" is judged when the card is shown,
  so a card left open past midnight keeps its time and its tooltip names
  the day. Tab reaches every card's time: through the card's ⋯, or, on a
  card with no ⋯ (an imported message, a reply still streaming), through
  the time itself. Muse Code's times are its own recorded ones (live and
  in History). The Model API stores a time with each message and reply from
  this release on, so a conversation saved before shows none; a time is
  never guessed. A card you just sent shows the moment you sent it until
  the backend's time arrives.
  During a turn, edit rows keep their visible diff or written content;
  their stored patch loads when you reopen the row or the turn ends.
  Turn end also retries an open row whose patch read failed.
- The path of an edit or read row opens the file with the changed lines
  selected. Click a tool's output to open it in a read-only editor tab (a
  stored output in full, up to 16 MiB); **Click to expand** on an edit diff
  opens VS Code's diff editor (the file side is editable).
- Thinking rows stream their summary while the model thinks and end as
  "Thought for Ns" (a resumed conversation's read "Thought").
- Each actionable message, reply, tool output or restore notice has one **More
  actions** (⋯) button, revealed on hover or keyboard focus and always visible
  on touch screens. Right-click its row, or press Shift+F10 / the Menu key,
  to open the same radial menu: each action is one crisp blue pill, its icon
  then its name, every pill the same size, in a fan beside the pointer or
  the ⋯ and inside the panel. Arrow keys move, Home/End go to the first and last,
  Enter or Space picks. A message's menu has **Fork conversation from here**
  and a **Rewind** pill that opens a second burst of the rewind and restore
  choices; Escape returns from that burst first, then closes the menu and
  returns focus to ⋯. An edit row's menu has **Open output**, **Review** (the
  diff editor) and **Revert**: it asks first, then puts back that one edit's
  lines, leaving (and naming) a file whose lines changed since; it is not
  offered while a turn runs. A reply has no Retry (a resent prompt would run
  its tools a second time): **Rewind conversation to here** on the prompt's
  card puts the prompt back to send again. With text selected in a row,
  right-clicking that row opens the highlighted-text menu instead.
- A reply's ⋯ menu has **Reply to this output**: the next message carries
  that output (up to 8,000 characters) to the agent as context. Highlight any text in the chat and
  right-click it for **Copy**, **Ask about this** or **Comment on this**; the
  passage, its author and your intent travel with the message. The composer
  shows a chip for either; × drops it.
  The highlighted-text menu fans into the same labelled pills, fitting panels
  as narrow as 320 px. Every pill is the same size; a label longer than its
  pill ends in an ellipsis, with the whole label in its tooltip. Arrow keys
  move between actions, Home/End select the first/last, Enter/Space choose,
  and Escape closes and returns focus. Reduced motion shows the pills in
  place, without their scale-in; forced colors uses bordered pills.
- Approval cards carry the backend's choices: on Muse Code the CLI's own
  (Allow once, Always allow in this workspace or Allow for this session,
  Reject), on the Model API Allow once, Always allow in this session and
  Reject; Reject takes optional feedback;
  multi-step shell lines are approved one step at a time.
  - **The card is docked** just above the message box while it waits, in
    view wherever you have scrolled. Its row in the conversation says it is
    waiting, then shows the decision.
  - **Several approvals** are taken in the order Muse asked: the oldest is
    docked, with a count of how many wait.
  - **Focus** moves to an arriving card unless you are typing; it is
    announced either way.
  - **Each step takes one decision.** The card locks at your first click and
    stays locked until Muse Code answers. A step that moved on before your
    choice arrived shows the step Muse Code now waits on, and says so on the
    card.
- If Stop follows a choice immediately, it waits for that decision and
  rejects the next waiting step before stopping the turn. Panels showing
  the same session share the decision's result.
- A Muse Code replay fault offers **Restart now**, which restarts Muse
  Code and preserves running Model API conversations. A fault notice's
  recovery buttons can be used once, including after the panel is restored;
  **New conversation** in the header remains available.
- Question cards stack radio buttons for one answer and checkboxes for
  several, put multiple questions on tabs, offer **Other** beside the options
  (a question without options is a text box), and keep
  **Submit** greyed until every question has an answer; **Cancel** declines
  the prompt, and **Explain instead** answers in your own words (up to 500
  characters) rather than choosing, so the agent reads it and decides again.
- The transcript follows new entries while you are at the end; scrolled up,
  it holds still and **New messages** jumps to the newest. The agent's task
  list pins above the composer, and the composer shows how much of the
  context window is used.
- **The diff tally.** Once the conversation has edited a file, a row above
  the goal, schedule and task panes reads, for example, "8 files changed
  +313 −96": the edit rows' own line counts added up, each file counted
  once. It is a sum of this conversation's edits, not `git diff`: changes
  made by shell commands or by you are not counted, as its tooltip says.
  The added and removed numbers use the editor's git-decoration colours.
  Its **Review** button opens the review pane on the same edits, as
  **Review this conversation’s changes** (`/changes`) does.

**Edits and rewind.** Muse applies in-workspace edits as it goes, so review
comes after: the edit row shows the diff, its path opens the file at the
change, and **Click to expand** opens the diff editor. One edit can be
undone from its row's ⋯ menu (**Revert**). To undo more, use the ⋯ menu on
any sent message (or right-click it):

- **Fork conversation from here**.
- **Restore files to here** (a message whose turn has a checkpoint, in a
  connected Model API session) undoes the model's own file-tool edits from
  that turn on, while each file still holds exactly what the model left;
  commands, hooks, MCP tools, your edits and other windows' writes are never
  undone. It asks first, then says what it
  restored and names every file it left as it is. See **Turn checkpoints**
  below.
- **Rewind conversation and restore files** does both, after one
  confirmation that names both: it checks the conversation can be rewound,
  restores the files, then rewinds the conversation below. When a file was
  left short (unsaved, changed since, could not be changed) the conversation
  stays as it is, and the panel says so.
- **Rewind conversation to here** starts a branch before that message and
  puts its prompt back in the composer. The original conversation stays in
  History. Images return when the backend still has their bytes; the panel
  warns if it cannot restore one. A Model API conversation cannot be rewound
  before its latest compaction. A rewind queued for a session the tab has since
  left is ignored. Messages steered into one turn use the last earlier turn as
  their branch point; if none exists, the conversation rewind choice is hidden.
  Wait for the selected turn to finish before rewinding its conversation.
  A just-sent Model API image can be restored before History is reopened.
  Conversation rewind is hidden for each PDF or named text file card because
  its bytes cannot be restored reliably on every backend and History path;
  an earlier text-only card in the same turn keeps its rewind choice. A
  request made outside the menu is checked against the served card and cut
  before the conversation changes.
- **Rewind code to here** reverts every edit made after that message, the
  conversation's and its subagents', in the reverse of the order they
  landed. A file the edit created goes to the trash, unless you have added
  to it since, in which case your lines stay.
- **Fork conversation and rewind code** (offered where the turn has no
  checkpoint) is one action: the confirmation, the reverts, then the fork.
  Declining the confirmation does neither.

Both **Rewind code to here** and **Restore files to here** ask first, each in
its own confirmation.

**Turn checkpoints.** On by default (`museSpark.turnCheckpoints`). **Restore
files to here** undoes the model's own file-tool edits from that message
onward, while each file still holds exactly what the model left. Stored
file restore and **Redo** require a connected Model API session, git on
`PATH`, a trusted workspace and confirmed workspace-process safety. Muse
Code has no stored file restore; its native rewind is separate.

- **What is recorded.** Each write by the Model API's file tools, image
  tools, workspace memory tools and `rename_symbol` records the file's
  bytes before and after. Format on edit is recorded too. This includes
  files ignored by git when those tools write them. No workspace captures
  or ignored-file scans are taken.
- **What a restore does.** The recorded writes from the chosen message
  onward must form an unbroken chain for each file, ending in exactly what
  is on disk now. A restore returns that file to its state before the first
  write, deleting a file the tools created. Files already in that state
  are counted separately and left alone. A file changed between tool
  writes or since the last write is left as it is and named, as is a file
  with unsaved changes or a path reached through a link or junction. Empty
  folders created by the recorded writes are removed when their files are
  removed. Existing files keep their current permission bits; a recreated
  file gets its recorded earlier mode. Restore leaves HEAD, the index,
  branches and the stash alone.
- **What is never undone.** Changes by commands, hooks, MCP tools, your own
  edits and other windows' writes. When commands, hooks or MCP tools ran,
  or background work was alive during those turns, the result says so;
  it does not list or undo their file changes. Check your version control.
  Personal memory outside the workspace is never restored. Edits you make
  in the Memory view, exports, plan saves and other writes made for you by
  the extension are not recorded as model edits.
- **Formatters.** A formatter run by a `PostToolUse` hook or `then_run`
  changes files outside the recorded tool writes and makes those files
  not restorable. **Format on edit** (`museSpark.formatOnEdit`) writes
  through the recorded file-tool path and is restorable.
- **Conversation rewind.** **Rewind conversation and restore files**
  restores first, then branches before the message and returns its prompt
  to the composer. A refused file blocks the conversation rewind; a
  commands note by itself does not. Files already in the earlier state
  do not block it. The original conversation stays in History.
- **Redo.** The result offers **Redo**, which puts back the writes of that
  restore in the same conversation. A later recorded write to a file blocks
  its Redo; other changes are checked against the recorded bytes too. A
  file already at Redo's target is counted as unchanged. Refused files
  stay available for another try. Once all files are restored or unchanged,
  that Redo is spent.
- **Storage and windows.** Records and file bytes stay under this extension
  profile's global storage, `checkpoints/<canonical-root-key>`; windows
  sharing that storage and physical workspace root share the store. The
  shadow git repository holds objects and compare-and-swap records, and
  each window has a durable write journal. Nothing is written into the
  workspace's `.git`, and copies are not sent anywhere. Only one restore
  or Redo runs at a time; while any turn runs, file restoration is refused.
  Native processes and windows whose safety cannot be proved also block
  it. If another window runs an older Muse Spark version, reload that
  window before restoring. M72 records remain read-only; a range containing
  an older record cannot be restored, and M72 restores cannot be redone.
- **Incomplete records and caps.** A range with missing turn records or
  incomplete edits is refused; this can follow a reload or crash during an
  edit, a recording failure or a turn run with checkpoints off. A file over
  16 MiB or whose earlier bytes exceeded the per-turn copy budget is not
  restorable and is named. Exceeding the per-turn write-record budget makes
  the range incomplete. A journal write that fails, including on a full
  disk, refuses the tool's write before it changes the file. Oldest whole
  records, their journal data and copies are removed by conversation
  sequence; archiving hides the conversation's records from other windows.
  Small identity records keep retired owners and sequence numbers distinct
  from unexplained missing records. Shared journals keep their metadata until
  their instance's units are all retired. Cleanup sweeps unreferenced copies,
  including failed writes with no journal intent, after a one-hour grace period
  while no writer is live. Each pass is bounded and resumes on the next pass.
  Ordinary sends and trusted startup recover abandoned cleanup reservations;
  live or uncertain owners remain protected.
- **Off.** No new turns are recorded with `museSpark.turnCheckpoints` off
  or in Restricted Mode. A turn that started recording keeps recording
  until it ends, even if the setting is switched off. A restore range
  containing a turn that ran without recording is refused.
  A child keeps its spawning turn's decision across reloads. A historical
  child whose decision is unknown does not run. Redo checks later transcript
  turns too; missing history or a historical batch without a recorded
  transcript boundary refuses the range.
- **Limits.** If someone else writes exactly the bytes the model left,
  restore cannot tell (the ABA limit). Foreign writes in other windows are
  judged by bytes, not their order. The filesystem writer checks again
  immediately before replacing a file, but a change between that final
  comparison and the rename can still be overwritten; the filesystem has
  no conditional rename. See SPEC v3.1, sections 3, 4 and 12, in
  [the M86 design](docs/design/m86-restore-by-tool-writes.md).

**Side chat.** Use **Side chat** in the header to open a separate Plan-mode
conversation with the completed turns as reference. Its inherited goal is
cleared; the original tab keeps its session, goal and running turn. A delayed
side-chat request is ignored if the original tab has since changed sessions.
On the Model API backend, the side branch keeps Plan mode after reopen,
suppresses local hooks and refuses external MCP tools, including ones their
server labels read only. It also refuses scheduled prompt creation, cancellation
and paid runs before any job claim or Model API request. Muse Code applies its
own project and session rules in Plan mode;
review those rules before treating that branch as read only. Close the side
tab to return to the main one; its branch stays in History. It uses the
selected backend's normal model allowance or key billing; it does not route
Model API calls through a Muse subscription. In a side chat, `Shift+Tab`
moves keyboard focus normally because its permission mode is fixed. A side
panel's History shows only its own side branches; the same boundary applies
when the window reloads.

Each edit is undone only where its own lines (the changed lines and the few
around them) are still exactly as the edit left them. If you added or
removed lines above them since, they are found where they moved to, as long
as they appear in exactly one place. An edit whose lines you changed, or that
could match more than one place, is left alone and says why, rather than
guessed at; your other changes to the file are kept. A file's BOM and line
breaks survive both.

**Unsaved editors.** Muse reads and edits the files on disk. With
`museSpark.autosave` on (the default) every message saves your editors
first; with it off the panel names the files whose unsaved changes Muse will
not see. On the Model API backend the file tools also refuse a file an
editor holds unsaved changes to, keep a file's BOM, line breaks and final
line break, refuse files that are not UTF-8 text rather than rewrite them,
and replace an existing file with `write_file` only after reading it (as
Claude Code does). A linked path checks both its requested and canonical
editor locations for unsaved changes.

**History.** The clock icon lists the workspace's conversations by day with
search, resume (full transcript), archive and **Show archived**. Archive with
the row's × or, while the search box is empty, `Delete` on the highlighted
row, which also restores an archived one. Sessions idle for
`archiveInactiveSessions` days are hidden, not deleted. Click the header's
title to rename the conversation. A hidden panel shows a dot when Muse
finished or needs a decision.

**Export.** `/export` (or **Muse Spark: Export Conversation**) saves the
conversation as Markdown where you choose: messages, thinking, and tool calls
with their arguments and visible output. Your `!` commands include an exit
code or termination signal when Muse Code reports one. On the CLI backend **Export session
log…** also saves Muse Code's own JSON record of the session (`muse
export`), which includes everything, stored outputs too, as a raw backend
record. Accepted prompts can therefore retain secrets in that native log;
Markdown and portable JSON exports remove recognized credentials. The native
log needs a folder on this machine. An export asked for while a reply runs is refused until it
finishes, and a conversation too long for Muse Code to replay is pointed to
the session log.

**Export, import and share a session.** **Export session as JSON…** (on
either backend) writes the conversation as a portable file: the same history
the Markdown export holds, without stored outputs, patches or anything that
belongs to the running session. Credentials of a known shape and the key
digest are removed from every string, item ids and error labels included:
API keys and tokens of common services (Meta, GitHub, GitLab, npm, Google,
AWS, Slack, Stripe-style keys, Muse Gadgets SDK tokens), bearer and basic credentials, JSON Web
Tokens, private keys, credentials in a URL, and secrets named by their key
(`PASSWORD=`, `"api_key": …`, `~/.aws/credentials` lines, an Azure
`AccountKey=`). A secret in any other shape is not recognised and stays, so
read the preview before you share the file. Ordinary UUIDs and protocol
words stay unchanged. Paths (your workspace and home folders wherever they
appear, spaces and all, and any other absolute path or `file://` link, in
any script, to its first space) and account ids
(e-mail addresses) are redacted by default. The redacted file opens read-only in the editor first,
with how much was redacted; nothing is written until you choose **Save
redacted…** or **Save without redaction…**. **Muse Spark: Import Session**
resumes such a file as a new conversation on the Model API backend, on your
own model: the file never picks one. It starts in a mode that asks: the
panel's current mode when that is Manual or Plan, otherwise Manual (or Plan
when that is your initial mode, `museSpark.initialPermissionMode`), and
does so every time the conversation is opened again, forked or restored;
only your own mode change relaxes it. A plan written in such a conversation
is untrusted as a plan file is: **Implement in a fresh conversation** starts
it in Manual (or Plan) too. It drops session rules, goals,
schedules, todos and patches, and the model reads each imported turn as
untrusted data in a message of yours, never as its own replies or tool calls.
A file whose turns are more text than a conversation can start with (counted
high, one token per UTF-8 byte: 786.4 kB, the allowance named text
attachments have) is refused before the import is confirmed, with both sizes
named; it can still be opened as a share file.
The panel offers Copy only on such a conversation's code blocks, never
Insert or Apply, as in a share file.
The ACP agent also applies this safe start to stored sessions marked imported
before advertising their mode or replaying history.
**Muse Spark: Open Share File** reads such a file read-only in the panel:
links and Copy work, code blocks have no Insert or Apply, and nothing in it
reaches a session. It shows 200 items at a time, with **Show more** for the
next, and an item that cannot be rendered says so in its place while the
rest of the file still shows. A file is refused whole if it is over 16 MiB, is another
format or a newer version, or holds any field this version does not know.
At 320 px too, Tab reaches Close, Copy, scrollable code and Show more,
with the theme's focus border; Escape closes the view and focuses the composer.
For a local visual check, `node scripts/harness-shots.mjs share share-narrow`
captures both widths; `share-narrow` also runs in all four accessibility themes.
The picker reads a local `file:` URI on the extension host through one
checked descriptor, stopping at the size cap even if the file grows.
Other file providers are explicitly refused because this reader cannot
bound their allocations; a PDF header never raises the JSON cap.
Validation notices use localized refusals: JSON parser snippets are never
shown, and reported field names are scrubbed before their bounded display.
Nothing is ever uploaded: sharing is a file on your disk.

**Your own shell commands.** Start a message with `!` to run it as a shell
command in the workspace instead of sending it to the agent, as Muse Code's
`!` does: `!git status`. The prompt switches to the editor's font and says
**Shell**; the command runs at once, outside any turn (also while a reply
runs), and gets its own row: **You ran** with the command, its exit code
and run time, and what it printed, which opens whole in an editor tab. The
agent sees the command and its output with your next message. No approval
card asks first, since you typed it, whatever the permission mode; nothing
runs while the workspace is in Restricted Mode, and a command that could not
run comes back to the prompt with the reason. On Muse Code it runs through
the CLI's own shell and sandbox (a missing Windows sandbox offers the setup,
as the shell tool does); on the Model API backend it runs through the shell
tool's runner, for ten minutes at most, and its row has a **Stop**. There it
is checked once more at its real start (your Stop, the workspace's trust, the
conversation and the window still standing); a command refused at that point
says **The command did not run**, and the agent is told nothing about it.
While a Model API command is still running, another surface sharing that
session shows its row and can stop it. A session loaded in another VS Code
window shows the saved row as interrupted, since that window cannot
control the original runner.

**Background work.** A shell command the agent is waiting on can go on in the
background while the agent carries on: **Move to background** on its row, or
`Ctrl+B` (also on a Mac) while the Muse panel has focus and its conversation
runs one; VS Code's
own `Ctrl+B` (the sidebar) works as usual otherwise, including while a shell
permission card waits for your answer. A background command
keeps running after its turn ends, marked "background", with **Stop** on its
row; the header pill counts the ones still running, and the Agent map lists
every background task with its own **Stop** and a **Stop all** (also
**Muse Spark: Stop Background Tasks**). On Muse Code these are the CLI's own
`task/background`, `task/stop` and `task/stopAll`, and Muse Code tells the
agent what the command printed when it ends. On the Model API backend the
agent is answered at once that the command moved; it then runs without its
time limit until it ends or you stop it, and what it printed reaches the
agent with its next request (no model call is made for it on its own).
When the last surface leaves a conversation, its remaining background
commands are stopped; another open surface keeps them running. A resumed
conversation restores `Ctrl+B` for a shell command still in the foreground.
A second surface sharing a live Model API session also shows its running
foreground command and can move it with `Ctrl+B`.
If that shell is still awaiting permission, the second surface shows the
same card and leaves `Ctrl+B` to VS Code until approval resolves.
A fork has no running commands from its source; it carries the ending or
lost-output context into the agent's next request for any inherited task.

**Subagents.** When either backend spawns subagents they appear as rows and
an **N agents** pill in the header opens the **Agent map** (also `/agents`):
this conversation, its agents with role, objective, status, duration and
tokens, the background tasks, and each agent's own transcript.

When a team is active, its tree has one Tab stop. Use arrows, Home, End,
or type ahead to move between items; F2 focuses an item's actions, Left
and Right choose an action, and Escape returns to the item. Finished
workers produce one polite summary. Merge cards list affected files,
protected paths, conflicts and the supplied review details, with an
overflow count for long lists. A card without file details cannot approve
a merge. Tree and card code loads on its first use.

The unreleased scheduler and runner adapters ship in separate bundles for
team use. Their tool schemas come from the same validators used by the
board. Maintainers regenerate them with `node scripts/team-tool-schemas.mjs
--write`; the production build checks them for drift. The Traffic and
Runners views remain internal while the Models & Agents panel and the
window-owned team runtime are integrated. They are not available as
commands in this release. ACP and other editors need those same runtime
bindings; packaging these adapters does not enable team dispatch.

- Muse Code hides its subagent tools unless `run.subagent_delegation_mode` is
  `"auto"` in its settings file (`~/.config/muse/settings.json`, or under
  `$XDG_CONFIG_HOME`). The map says so and opens the file for you; the
  extension never edits it.
- Muse Code gates `subagent_spawn` behind an approval: in Manual mode the
  card appears (Allow once / Allow for this session); Plan mode refuses it.
- An agent's own replies and tool calls stay in its transcript in the map,
  and the map's details offer the controls Muse Code provides: Interrupt and
  Stop while it runs, a note to it, Resume, Close, and a follow-up task once
  its result is ready. A ready result can be marked read; a closed agent can
  be reopened on the Model API backend. Muse Code's Reopen and Mark result
  read controls wait for a live capture of their accepted MSP commands;
  its captured Interrupt, Stop, Resume and Close controls remain available.
- On the Model API backend, the agent can spawn up to eight child sessions at
  once; more wait in order, up to 64 per conversation. A child has its own
  conversation and the same workspace tools and approvals, but cannot spawn
  again or ask you a question. Children share the workspace and use your
  Model API key; their tokens count in the conversation's usage. Paid
  subagents are available by default. Each new child task asks with the published
  rates and shared daily budget before it starts, including in
  Bypass mode, unless you allowed subagents always in this workspace (a child on another model still asks). Plan refuses the task. A spawn that would start no child asks
  nothing: one past the 64, one asking for worktree isolation, or one reusing
  an earlier spawn's command id for a different task is refused first, and a
  retry of the same spawn under its command id answers with that child.
  One approval allows at most four actual
  response requests, including retries and tool rounds. A running note uses
  that same allowance; a follow-up or reopen needs a new grant, asked for
  unless subagents are allowed always in this workspace. This is
  a request limit, not a dollar limit. Failed requests without a usage report
  appear as unknown cost in Account & usage. A resumed child whose queued
  notes survived a window restart shows those notes in its fresh approval
  before they run. Stopping a
  queued child drops its unsent notes; reopening it starts from its retained
  objective without those canceled notes. A second panel joining during a
  child's pending tool approval sees the same card. Child tokens spent on an
  active goal count against that goal's budget; a replacement goal does not
  inherit an earlier child's cost.

**Workflows.** Muse Code can run a multi-agent workflow: a short script,
written by the model for the task or saved in Muse Code beforehand, that
starts child agents, up to 1,000 over a run, each making its own model
calls on your subscription. The **Workflow** row shows the inline script
when the model wrote one and says whether the run was launched. It does
not infer a source file for a resumed run; that input shape has not been
captured from Muse Code. The run itself is a card below it that keeps changing after
the reply ends, as the run goes on in the background:

- its captured generated label ("Written for this task"), or the entry ID or
  fallback text Muse Code sent for another run, plus its status,
  how many agents, their tokens, and what started it;
- each agent with its label, state (queued, running, completed, failed…),
  attempt, time and tokens;
- a status Muse Code adds later shown in its own words with a neutral mark;
- the result the run returned, or the failure it reported;
- The run and its agents are read-only in this version. Cancel, Skip and
  Retry will need a live capture of accepted Muse Code commands before the
  panel can offer them.

The token figure is the panel's sum of the latest usage reported for each
agent row. It is not a billed total for a run with retries; use Muse Code's
subscription usage for that. A reload of the same session keeps child labels
and usage the panel saved earlier; without that saved state, Muse Code's final
history item may omit those details.

The header's **N agents** pill counts workflow agents too, and the Agent
map lists the runs with the same read-only cards. The map also says how Muse Code
is set to start workflows, from `run.workflow_trigger_mode` in its settings
file (`auto`, its default: the model may start one for large work, and
starts one when you ask; `explicit`: only when you ask; `off`: no workflow
tool), with the file a click away; the extension never edits it. Pausing
and resuming a run are Muse Code's terminal UI's alone (`/workflows`), and a
workflow agent keeps no transcript of its own to open. The Model API
backend runs no workflows.

**Account & usage** (`/usage`, `/cost`) is a modal over the transcript:

- **Account:** auth method, plan, backend, Muse Code version and model.
- **Usage (Muse Code):** the subscription's current window and week. Muse
  Code reports them only after a reply. The modal reads the latest report
  from the signed-in CLI when opened; it does not use an account-agnostic
  snapshot after a host restart or sign-out. Countdowns update each minute
  while the modal is open. Once a reported reset has passed, that row waits
  for a fresh Muse Code report instead of showing an expired percentage or
  reset countdown. Each observation is dated "as of". The numbers are the
  CLI's account-level percentages and reset times: changing the selected
  model does not create a separate local quota or reset calculation, and an
  opaque plan ID is shown as "Muse Code subscription". Personal Muse
  Power/Maximum plan grants are separate from this CLI usage report.
- **This conversation:** token totals (on Muse Code, prompt tokens as it
  counts them once). On the Model API also the cached tokens, the cache-hit
  rate, what the cache saved in dollars, and a dollar estimate from Meta's
  published per-token prices (standard versus contributor tier, read
  2026-09-26; the dev.meta.ai dashboard is the bill).
- **What's contributing to your usage**, over the last day or week, read from
  the Muse Code CLI's trace logs on this machine: the share of model attempts
  from Muse's reminder agents (which run after every reply), from subagents,
  and from sessions active for 8+ hours. Approximate, this machine only.

**Prompt caching.** The Model API backend sends a stable key for requests
that share a model, instructions and tools, so repeated prefixes can be
billed at the cached rate; the CLI caches on its own. The retention setting
asks Meta for its shorter in-memory default, or up to 24 hours when you
choose that machine-scoped setting. Either is a hint rather than a guaranteed
lifetime. The modal shows the cache-hit
rate instead of a "warm for N minutes" countdown.

**Awareness and budgets.**

- **Notifications.** While the VS Code window is unfocused, a VS Code
  notification tells you when a turn of a minute or more ends, or when a
  turn waits for your approval or answer; **Show conversation** brings it
  into view. Nothing shows while the window is focused, and a notice two
  panels on one conversation both see shows once. Turn them off with
  `museSpark.notifyOnBackgroundTurn`. VS Code gives extensions no
  operating-system notification, so the notice waits in VS Code's corner
  until you come back.
- **Tokens and cost per reply** (Model API, on by default):
  `museSpark.modelApiReplyUsage` prints the input and output tokens and the
  dollar estimate under each reply. A line covers every request since the
  previous line in that turn, tool steps included, so a turn's lines add up
  to the turn's estimated cost. The line labels dollars estimated; it is
  not a provider billing receipt. An unfamiliar model uses a fallback
  estimate with an unverified price and cannot use a spend cap. Muse Code reports no per-reply totals on its protocol,
  so its replies never carry one.
- **A session budget** (Model API): `museSpark.modelApiSessionBudgetUsd`
  caps what each conversation may spend, in dollars at Meta's list prices
  (`0`, the default, is no cap). Before each request the input is estimated
  high: the last request's input as Meta counted it, plus everything added
  since at one token per byte (so an attached image or file counts at its
  encoded size, far above its real cost). `max_output_tokens` is then
  lowered so input plus output fits what is left. A request that cannot fit
  is not sent, and the turn stops and says so; a reply that used all the
  output the budget left is marked as possibly cut short, and the
  transcript shows what each turn cost against the cap. Each request is
  priced at the model it was sent to, and what the conversation spent is
  saved as it is spent, even while a call waits for your approval, so a
  reload cannot forget it. A shared spend journal covers hosts opening the
  same account-owned conversation from the same storage directory. Each
  request publishes its own durable liability before HTTP; stale session
  saves cannot erase another host's charge. A capped request needs working
  session storage. If a stop, model, goal,
  key, budget, workspace trust or paid permission changes while the reservation
  is saved, final admission refuses the request and releases its nonsent
  reservation. A sent request whose usage is unknown keeps its whole
  reservation, including after a crash or a response timeout. This is
  reserved possible spending, not a claim that Meta billed that amount.
  Explicit 400 or 429 refusals before any response began release it.
  Capped responses do not automatically retry an ambiguous transport or
  server failure under the same allowance; send a new prompt for a fresh
  admission. Explicit rate-limit refusals may retry. With the cap off,
  the normal response retry policy still applies.
  A request begun with no cap still marks its possible spending before
  sending when shared session storage is available. Another window with a
  cap waits for that request's verified usage; a known settlement clears
  this temporary uncertainty. An earlier ambiguous retry or unknown model
  price cannot be certified by the final successful reply, so that history
  needs a new conversation before it can use a cap. Uncapped requests without
  session storage keep their normal behavior and cannot share persisted
  spending. A provided spend journal that cannot be read or saved blocks
  new requests; repair the storage and reopen the conversation.
  Paid subagent requests have their own consent and request ceiling. Their
  reported cost counts toward the conversation, but they are not reserved
  against the parent's cap and can take it past that cap. Each task keeps its
  own paid confirmation, unless subagents are allowed always in this
  workspace. Image generation reserves its published flat
  fee before buying the image and settles it even if saving the image fails.
  Web search is unavailable while a cap is active: no hard bound on its
  billed query count has been captured. With the cap off, its normal paid
  consent applies and reported search fees count in saved spending.
  Paid Muse Voice is also unavailable on a Model API conversation while a
  cap is active: the microphone is unavailable until you turn the cap off,
  or turn Muse Voice off (`museSpark.modelApiVoice`) to use system
  dictation; voice on the CLI backend is unchanged. An uncapped recording publishes pending uncertainty
  before authentication or audio. Local sent PCM duration is an estimate,
  not a Meta billed-duration receipt, so even a successful recording keeps
  its history's spend unverified. Start a new conversation to use a cap
  after such history. A change of owner or context stops further sends;
  cancellation before authentication refunds only the known nonsent row.
  With no folder or session journal and the cap off, paid voice keeps its
  per-use confirmation and window usage estimate. Its recording retains
  the consent's account and context; replacing them or enabling a cap
  stops further sends. This path has no shared conversation spend ledger
  and makes no verified audio-billing claim.
  The cap depends on conservative input estimates and the published prices;
  actual token billing can differ from the estimate. Unknown historical
  token spending or paid fees cannot be invented as zero: start a new conversation to use a
  cap on such history. A model without a published price here cannot be
  capped, so its requests are refused while a cap is set. The budget is
  machine-scoped, so a repository cannot set it.
- **Cache savings** (Model API): Account & usage shows what the prompt
  cache saved in dollars, and its share of the uncached price.

**Diagnostics.** The agent can read the Problems panel through a
`getDiagnostics` tool. On the CLI backend the extension serves it on a
loopback MCP server, bound to `127.0.0.1` with a per-window token and
started when a session first needs it; the same server also carries the
code-intelligence tools, web fetch (in a trusted workspace) and, while paid
images are on, the image tools. On the
Model API backend it runs inside the extension under the same name
(`mcp__ide__getDiagnostics`), as a read in every mode. It reports the workspace's files only (the
first folder), by relative path, each message cut at 1,000 characters, and
past 200 problems a count instead of the rest. VS Code's language servers
report only on files an editor shows, so when the agent asks about one file
that no editor shows, the extension opens it beside your editor as a tab of
its own, without taking focus, waits up to 4 seconds for a first report (10
seconds at most while reports keep arriving), then closes that tab.

**Accessibility.** Every screen the panel shows is checked against WCAG 2.2
AA's automated rules in Light Modern, Dark Modern and both High Contrast
themes on every change.

- Menus and lists work from the keyboard: the palette and History lists are
  Tab stops, the effort row moves with Left and Right, History rows archive
  with `Delete`, and `Esc` closes whatever is open.
- Screen readers hear when Muse finishes, fails or is stopped, when an
  approval or a question arrives, when a tool fails, and when dictation
  starts and stops.
- The operating system's "reduce motion" setting stops every animation.
- Text in right-to-left scripts reads right to left, and with an input
  method `Enter` commits the candidate instead of sending.

## Voice dictation

Tap the microphone to start and again to stop; hold it (or `Ctrl+D` /
`Cmd+D` in the composer, or Space on the focused button) to record while
held. The placeholder reads "Listening…", the mic pulses red, and each phrase
lands at the caret followed by a space. Recognition runs in a small helper
on the operating system's own engine, kept warm for five minutes after a
recording. Nothing is billed and no third-party engine is involved, unless
you turn on [Muse Voice](#paid-features), the paid engine on a Model API
key.

Dictation is off in a remote window (SSH, WSL, containers, tunnels,
Codespaces): the extension runs on the remote machine, which cannot hear
your microphone.

| Platform | How                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | `native/windows/dictate.ps1` under Windows PowerShell 5.1 on the .NET Framework's `System.Speech`, the desktop recogniser that ships with Windows (English always; other languages with Windows speech packs). Audio never leaves the machine. Accuracy is the classic engine's, below Windows 11's voice typing; Windows' Speech Recognition training improves it for your voice.                                                                      |
| macOS    | `native/darwin/muse-dictate`, a Swift helper on Apple's Speech framework, built by CI on a Mac and shipped in the Marketplace package. **Dictation (System Settings > Keyboard) or Siri must be on.** Apple picks on-device recognition when its model is installed, otherwise its servers under Apple's terms at no charge (the helper's `--on-device` flag refuses the servers; the extension does not pass it). See the macOS notes below the table. |
| Linux    | Not available for free: no distribution ships a speech recogniser and the extension adds none. The button is dimmed with that reason as its tooltip. With [Muse Voice](#paid-features) on, the system's `arecord` or `parec` records and Meta transcribes.                                                                                                                                                                                              |

On macOS, two things can stop the helper, and the panel's error says which:

- **A permission.** The first time you dictate, macOS asks for speech
  recognition and the microphone on behalf of the helper itself,
  **muse-dictate**, with its own usage descriptions, rather than for Visual
  Studio Code; the grants are managed under System Settings > Privacy &
  Security > Speech Recognition and > Microphone. The helper asks under its
  own name because Visual Studio Code, which starts it, declares no
  speech-recognition purpose
  ([microsoft/vscode#307364](https://github.com/microsoft/vscode/issues/307364)),
  and macOS would refuse VS Code without asking; to do so it disclaims VS
  Code's responsibility with a private macOS call (the one Chromium, Qt and
  Electron use), and where that call is missing it asks as VS Code and the
  panel's error explains the refusal. The helper is ad-hoc signed, so macOS
  ties the grant to the build: after an update that changes the helper,
  macOS asks again.
- **The helper itself.** The helper is ad-hoc signed, not notarised; VS Code's
  installer does not quarantine it, so Gatekeeper does not stop it. If the
  error names no permission step, macOS refused to run the helper: its file
  carries the quarantine flag, which a copy through a browser download or an
  archive tool can add. This clears it:

```bash
xattr -d com.apple.quarantine ~/.vscode/extensions/randynorthrup.muse-spark-code-*/native/darwin/muse-dictate
```

Diagnosing on Windows: the helper can replay a WAV file instead of the
microphone, which separates a recogniser problem from a microphone one.

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File native\windows\dictate.ps1 -InputWav C:\path\to\speech.wav
```

Type `start` and press Enter; phrases print as JSON lines, then `stopped`.
Muse Voice's recorder takes the same `-InputWav` (a 16 kHz, 16-bit mono
file) and prints the audio as `audio` lines instead:
`native\windows\capture.ps1 -InputWav …`.
On macOS the helper takes `--input-device <CoreAudio UID>` to capture from
one specific device; a Mac without any input device reports "no audio input
device is available", and step markers on stderr name where a start failed.

## Paid features

Seven settings gate what costs money on your Model API key beyond an ordinary
chat turn. They are always billed to your Model API key, never to your Muse
Code subscription, and all seven are **available by default on Model API**. All seven
work on the Model API backend; images and Muse Voice also work on the Muse
Code backend while a key is stored (web search is Muse Code's own there, on
the subscription):

| Feature           | Price (Meta, read 2026-09-24; token rates 2026-09-26)                         | What it does                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web search        | $2.50 per 1,000 searches                                                      | The model may search the web while it answers; the reply lists the pages it cites                                                                        |
| Image generation  | $0.01 per image                                                               | The model may create a PNG file in the workspace with `muse-image-1.0`, or edit workspace images into a new one, asking you each time                    |
| Muse Voice        | $0.18 per hour of audio                                                       | The microphone uses Meta's Muse Voice Transcribe instead of your computer's own recogniser                                                               |
| Subagents         | Selected model's published input, cached input and output token rates         | Child tasks on the Model API backend; every new task asks (unless allowed always) and admits at most four response requests                              |
| Best-of-N         | Selected model's published input, cached input and output token rates         | The same prompt runs in 2 to 5 worktrees at once on the Model API backend; you take one                                                                  |
| Scheduled prompts | Selected model's published input, cached input and output token rates         | A due `/loop` prompt runs only after you choose **Run now** and allow that run's model and rates                                                         |
| Auto reviewer     | The conversation model's published input, cached input and output token rates | In Auto on the Model API backend, a separate model call judges a plain command or MCP call that would ask and that no rule or permission profile settles |

Scheduled prompts use ordinary Model API tokens, rather than an extra
per-run service fee. The paid-use popup names both standard
($1.25/$0.15/$4.25) and contributor ($0.10/$0.002/$0.20) rates per million
input/cached/output tokens. Each due run names only its selected model's
exact tier before any model call; an unpriced model cannot be approved.
Other paid tools you have enabled may
add their own charges during that confirmed turn.

Manage availability in the palette (**Account & usage** group, where the backend
can use it) or with its setting (`museSpark.modelApiWebSearch`,
`modelApiImageGeneration`, `modelApiVoice`, `modelApiSubagents`,
`modelApiBestOfN`, `modelApiTeamWorkers`, `modelApiScheduledPrompts`, `modelApiAutoReviewer`). Default-on
availability causes no startup price dialog. Explicitly turning a feature OFF
and ON again confirms its price; the first paid use still asks separately. The settings are
machine-scoped, so a repository cannot turn one on.

Team workers default on for a runnable team of distinct models. They ask in
this paid-use popup before the first charge, with the models, task ceilings
and daily budget. Each task identifies its provider and tariff. Meta rates
are quoted only for a matching verified Meta tariff; other providers or
unverified tariffs state that the price is unknown and name the task and
daily token ceilings. Billing uses each task provider's API key.
Always is scoped to the provider, model and price tier that was approved;
a different model asks again. Single-model activation asks no team question.
The M96 team feature remains unavailable until its integration is complete.

**Every paid use then asks first, in a popup**, in every permission mode,
Bypass included. The popup names what is about to be billed, its price and the shared daily budget,
and offers three answers:

- **Allow once**: this use only.
- **Allow always in this workspace**: this use, and every later use of the
  same feature in this workspace, without asking. Offered only in a trusted
  workspace with a folder open. It lapses in every workspace when you turn
  the feature off (or accept a new price), and **Ask again every time** in
  Account & usage takes it back.
- **Deny** (or closing the popup): nothing is billed.

What asks, and when:

- **Web search**: once per prompt, before its first request, because Meta
  runs the searches inside the response and the model decides whether to
  search at all. Deny sends that prompt without web search. A child task
  searches only if its parent's prompt was allowed to.
- **Images**: before every image, with its path, prompt, the images an edit
  starts from, and the price. Plan refuses it (it writes a file), and a
  path that is taken, outside the workspace, or not a `.png`, or a source
  that is missing, outside the workspace, not a PNG, JPEG or WebP image, or
  over 10 MiB, is refused before anything is asked or billed. Edit sources
  are read from their checked canonical workspace targets, even if a link
  changes after the check. An image written to a protected path (D24) asks
  even when images are allowed always.
- **Muse Voice**: before each recording.
- **Subagents**: before every new child task, with its objective, model,
  published rates and four-request ceiling; Plan refuses it. Retries count;
  a running note spends the same grant.
- **Best-of-N**: once per run, with its prompt, published rates, attempt
  count and per-attempt request ceiling. Retries count against the ceiling;
  a run is refused before anything is asked while the feature is off, the
  backend is not the Model API, the workspace is untrusted or closed, or a
  run is already going.
- **Scheduled prompts**: before each run, with its prompt, model and rates.
- **Auto reviewer**: before each review, with the tool, its command line or
  arguments, the model and its rates; Deny shows you the approval card
  instead.

While one is on, you can always tell, even when it no longer asks:

- **The composer's badge** names every paid feature that is on ("Paid: Web
  search, Images"), with the prices in its tooltip and the features allowed
  always in this workspace; it opens Account & usage.
- **Every use is its own row** marked _paid_: each search, with its query
  and results; each image, with its path; each child task; and each admitted
  scheduled run. The child estimate in Account & usage is part of the
  conversation's total, not an extra charge added to it.
- **On the Muse Code backend**, images come from the extension itself: its
  `ide` tool server, which every Muse Code session loads, offers Muse Code
  an image and an image-edit tool while image generation is on and a key is
  stored. Muse Code's own permission mode decides whether it may use the
  tool; then the same popup asks before the image is bought, billed to your
  key and not to the subscription. The key never leaves the extension, and
  the row is marked paid as on the Model API.
- **The microphone says so**: ringed, and named "Record voice with Muse
  Voice (paid)" with the price in its tooltip.
- **Account & usage keeps the tally** and names each feature allowed always
  in this workspace: this window's searches, images,
  seconds of audio, child request attempts, best-of-N attempts, scheduled
  runs and Auto reviews, with estimated cost when usage was reported. An attempt with no usage
  report has unknown cost. Scheduled-run tokens are included in their
  conversation's estimate. Best-of-N's separate worktree hosts report their
  tokens and cost in their own paid row and extra-feature total; unreported
  HTTP tries remain unknown.
  The dev.meta.ai dashboard is the bill.

Web search's count errs high: Meta does not say how it bills a search with
several queries, so each query counts. Muse Voice counts the whole seconds
sent, as Meta bills them.

<table>
  <tr>
    <td align="center" width="50%"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/paid.png" alt="A paid Web search row with its query, the reply with its Sources list, and the composer's badge: Paid: Web search, Images"><br><sub>A search marked paid, the reply's sources, and the badge</sub></td>
    <td align="center" width="50%"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/paid-always.png" alt="Account and usage on the Model API: paid feature tallies, Web search allowed always in this workspace, Images, Tab completions with a $1 daily budget, Model hooks and Judge"><br><sub>Paid feature tallies, workspace consent and the Tab daily budget</sub></td>
  </tr>
</table>

Muse Voice records the same way as free dictation (tap or hold), and the
transcript lands at the caret when you stop. The recording is made by a
helper that only records: `native/windows/capture.ps1` on Windows (the
waveIn API that ships with Windows), the macOS helper's capture mode (which
asks for the microphone only), and on Linux the system's `arecord` or
`parec`, so Linux gets a microphone on this engine. Audio leaves the machine
only while it records, and only to Meta.

## Usage and cost

Open **Muse Spark: Open usage page** from the command palette, the graph item in
VS Code's status bar, the panel menu, or **Open usage page** in Account & usage.
The same page is available through ACP's `/usage page` companion link; ACP
`/usage` and the terminal summary use the same formatter and journal.
ACP loads the summary renderer and journal aggregation on the first usage
action. Headless execution loads its separate bundle on the first `exec`.

The local history counts model calls, input/output/cache tokens, durations,
retries, reported limits and paid feature units across editors. Known costs show
their price source; unknown prices stay unpriced, unresolved calls stay uncertain,
and subscription API-equivalent dollars stay separate from money charged.
Model ids and editor names are technical labels. Prompts, tool arguments, file
paths, workspace names, account identifiers, keys and key digests are excluded.

The shared journal is in `usage/` under `%LOCALAPPDATA%\Muse Spark Code`
on Windows, `~/Library/Application Support/Muse Spark Code` on macOS, or
`$XDG_DATA_HOME/muse-spark-code` (default `~/.local/share/muse-spark-code`)
on Linux. The history is specific to this machine; no history is uploaded or
synchronized. Raw calls are retained for 30 days, then replaced by daily rollups.
The default rollup retention is 365 days.

`museSpark.usageHistory` is machine-scoped and defaults to `true`;
`museSpark.usageHistoryDays` defaults to `365` and accepts 30–1825 days.
Turning history off stops recording and retains live subscription and budget
sources. The standalone ACP process also accepts `--usage-history=off`.
The companion page stores its history preference locally. Deleting history asks
for confirmation with the record count and removes only the usage journal;
spend ledgers, budgets, conversation history and paid grants are retained.

The installed agent's terminal commands are:

```sh
muse-spark-code-acp usage
muse-spark-code-acp usage --json
muse-spark-code-acp usage --csv
muse-spark-code-acp --usage
muse-spark-code-acp usage export --json --out usage.json
muse-spark-code-acp usage open
muse-spark-code-acp usage serve --stdio
```

JSON includes the checked page state and versioned journal records. Per-call CSV
is available inside the raw 30-day window; summary CSV and JSON also cover
rollups. Export uses the editor's save dialog, a browser download, or the explicit
CLI output path. CSV escapes spreadsheet formulas.

Browser exports allow at most 8 MiB of encoded file data, including JSON
escaping. An oversized export reports the limit and keeps the page usable;
select a smaller date range or use the CLI output path. The bound is displayed
on the page. The terminal's `daily`, `models` and `limits` subcommands select
their respective sections.

History-off pages retain validated live Muse Code windows, captured provider
headers and OpenRouter account observations. Budget views read the existing
shared paid ledger, VS Code's Tab ledger and active parent conversation ledgers,
including retained reservations; viewing them creates no admission or model call.
Unreported provider limits stay unknown. A projection requires an observed start
time and enough elapsed usage; unavailable observations remain unavailable.

The companion page supports filters, charts and accessible tables, model detail,
downloads, counted deletion and the history switch in every editor. It states
that editor settings, folder reveal and the editor's Models panel need a native
adapter, and disables those buttons. Provider console links still open directly.
ACP and terminal summaries state that their text surface is read-only and direct
interactive actions to the companion page. A native stdio adapter advertises
only the actions it actually supplies.

The browser companion listens only on `127.0.0.1`. Its one-use fragment launch
code is exchanged for a separate in-memory bearer in each window. The code is
removed from the address bar; authenticated fetch streams carry replies. There
are no cookies or remote assets. Usage reads and charts make no model request
and send nothing off this machine. Native JCEF, WebView2 and SWT bridges expose
the same page protocol; their editor installations are tracked separately in
[the certification record](docs/certification/m102.md).

The fake-data browser check `node test/harness/usage-companion.mjs` exercises the
shipped authenticated companion for all nine editor routes, including shared
module loading, filtering, the capability notice and downloads.

## Languages

The panel, its notices, the Command Palette's commands and the settings
follow VS Code's display language:

- Simplified and Traditional Chinese
- Japanese and Korean
- German, French, Spanish, Italian and Brazilian Portuguese
- Russian, Polish, Czech, Hungarian and Turkish

Any other display language gets English. Change it with **Configure Display
Language** in the Command Palette and reload the window.

<p align="center">
  <img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/languages.png" alt="The Account and usage modal in German: Konto und Nutzung, Anmeldemethode, Tarif, the current window at 42 % verbraucht, this conversation's Eingabe 20,8K, and what is contributing to the usage" width="60%"><br>
  <sub>Account &amp; usage in German, with its numbers written the German way</sub>
</p>

**The translations are machine-made**, by the same AI that wrote the code,
and checked by a gate rather than by native speakers. That gate checks that
every string is present, every value and code span is kept, and every count
uses the language's own plural forms. If a translation reads wrong,
[open an issue](https://github.com/RandyNorthrup/muse-spark-code/issues)
naming the language and the text; a correction is one line in
`l10n/ui.<language>.json` or `package.nls.<language>.json`.

What stays in English:

- **Text sent to the model**: the context notes, the compaction prompt and
  the tool errors. The model behaves the same in every language.
- **What Muse and the tools write**: replies, tool output, and Muse Code's own
  approval choices.
- **The walkthrough's pages**: VS Code translates the step titles and
  descriptions, not the pages.
- **Log lines no one sees in the panel**, and the names of commands, files
  and settings.

ACP and headless Model API/BYO requests share a hard local-day budget in the agent data folder. Its `settings.json` accepts `{"paidDailyBudgetUsd":5}` (USD; default $5, range $0.50–$500), corresponding to the extension’s `museSpark.paidDailyBudgetUsd`. Reservations use an exclusive cross-process lock before dispatch and settle from verified usage; an interrupted request or one without verified usage retains its liability. Headless also requires `--max-budget-usd`, and BYO attempts use the same usage journal as interactive turns. Image generation still requires its flag and consent (or the headless flag plus hard run budget). Hosted search is unavailable in this runtime while the hard daily budget is active because its returned fees have no dispatch bound.

## Limits

The table below describes Meta Muse. M95's provider core resolves capabilities
per configured provider and native model, with user overrides taking precedence
over captures, model lists, the catalogue and presets. Unknown support does not
permit tools or media. Images and PDFs have separate support and limits.
Native image evidence retains the existing 10 MiB application byte bound;
Anthropic uses its documented, smaller 10 MB bound. Enabled budgeted thinking
uses a positive default even when the catalogue permits zero. Effort is sent
only when the record explicitly lists the selected native level; otherwise
supported thinking uses its native default. Effort-only metadata establishes
its reasoning mode, and sparse model rows retain their original native JSON.
Media omitted from replay explains unsupported capability, MIME refusal or
individual model limits separately from limits consumed by newer media.
Final provider dispatch remains an integration milestone; this core change is
not a claim that every listed vendor is supported in the installed extension.

Custom models can declare `modelCapabilities` in their user-level
`providers.json` entry, keyed by native model id. For example:

```json
{
  "modelCapabilities": {
    "my-model": {
      "tools": { "calling": { "state": "yes", "value": true } },
      "reasoning": {
        "modes": { "state": "yes", "value": ["manual"] },
        "effortLevels": { "state": "no" }
      },
      "modalities": {
        "image": {
          "state": "yes",
          "value": { "mimes": ["image/png"], "maxBytes": 1048576, "maxCount": 2 }
        },
        "pdf": { "state": "no" }
      }
    }
  }
}
```

This is a fragment of a provider entry; its existing custom-model limits are
still required. Other record families cover cache, output formats and limits,
context limits, sampling, logprobs, completion and hosted services. Yes carries
a value, no explicitly refuses support, and unknown supplies no evidence.
User-file parsing stamps known overrides with `source.kind: "user"`; a supplied
source cannot elevate their priority. See [M95 N's record contract](docs/certification/m95-n.md).

| What                             | Limit                                                                                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images and PDFs                  | 20 attachments per message together; images 10 MiB each (PDFs: next row)                                                                                                                                                                                        |
| PDFs on the Model API backend    | 32 MB each locally (Meta allows 50 MB per inline file); images and PDF page images together: 50 per message. Meta reads text from the first 100 pages and page images from the first 50 (Meta's [file-handling guide](https://dev.meta.ai/docs/file-handling)). |
| Model API encoded media          | 48 million data URL characters total per new message and replay request; older replayed media is named but omitted when over the cap.                                                                                                                           |
| Picked UTF-8 text attachments    | 1 MiB per-file read cap from trusted and indexed workspace paths; Model API also caps combined text and file-name wrappers at 768 KiB to leave context room.                                                                                                    |
| A message to Muse Code           | 10 MiB. Attachment admission reserves 2 MiB for the prompt, context and frame; serialized text and base64 images count toward the rest. The exact outbound frame is checked at send.                                                                            |
| Model API: tool rounds           | 50 per turn                                                                                                                                                                                                                                                     |
| Model API: shell commands        | 2 minutes by default, 10 at most                                                                                                                                                                                                                                |
| Model API: retries               | Up to 5 attempts on 429, 500, 502 and 503, and when a reply stream ends because the server shut down or was overloaded, honouring `Retry-After`, shown in the transcript; Stop cuts the wait short                                                              |
| Model API: a silent reply stream | Ended after 5 minutes with nothing from the server; send again to retry                                                                                                                                                                                         |
| Model API: file tools            | Text and images up to 10 MiB, PDFs up to 32 MB; the search tool skips files over 1 MiB                                                                                                                                                                          |
| Opened tool outputs              | 16 MiB each; the latest 20, and 33,554,432 characters together                                                                                                                                                                                                  |

## Legal scan (M97)

`/legal` runs a deterministic, local licensing and copyright/header scan in
an open, trusted workspace. The slash palette offers the same action.
`/legal src/index.ts` limits per-file header checks; project licenses,
dependencies and distribution remain workspace-wide facts. The workspace
setting `museSpark.legalHeaderPolicy` accepts `required`, `optional` (the
default) and `off`; it does not invent ownership or update old years.

The scanner reads existing manifests, locks, installed metadata, licenses,
notices, bundle inventories and provenance across npm/pnpm/Yarn, Python,
Cargo, Go, Maven/Gradle, NuGet, Composer and Ruby gems. It runs no model,
package manager, build, shell command, hook, formatter or installation and
uses local evidence before optional registry enrichment. The scan costs nothing and requires no account. A live
conversation temporarily holds Plan mode only while the scan owns that hold.
The same scanner serves the Model API's `legal_scan` and Muse Code's
`mcp__ide__legalScan`; tool results requested during a normal model turn can
travel to Meta with that turn and use its ordinary billing.

The report groups evidence by severity and retains exclusions, uncertainty,
recommendations and fixability. A recognized SPDX identifier or a low finding
count does not establish legal compliance. Missing locks or license data,
dynamic metadata, binary files, links, stale artifacts and bounded-out input
remain incomplete. Identifier matching is pinned; license-text recognition is
heuristic. **Not legal advice; for distribution decisions consult a lawyer.**

Select findings or choose **Fix all safe ones** to review exact patches before
applying them. Supported fixes add missing SPDX/copyright headers from the
project's existing license and copyright evidence. They preserve old years,
existing headers, BOMs, shebangs, Python encoding cookies and line endings.
Ownership and applicable terms require a separate confirmation. Plan and
Restricted Mode refuse writes; every selected write uses the existing
checkpoint admission and conditional edit path, rechecking saved bytes and
live state. Failures are listed, and a fresh scan follows the apply attempt.
Unknown ownership, conflicting terms, unsupported file syntax, dependency
files and project-license changes remain recommendations.

**Export Markdown…** asks for a local destination and saves the report's
scrubbed evidence, limitations and disclaimer only after that request.
Scanner findings and controls have real translations in all 14 supported
languages; identifiers and SPDX license IDs stay unchanged. Public npm/PyPI
metadata lookup is offered by default after a one-time workspace notice naming
the hosts and disclosing package names and versions. The
`museSpark.legalRegistryLookups` setting disables enrichment. Requests use HTTPS
and refuse redirects; private registry configuration is never contacted.

**Explain with model (paid)** is available by default on interactive Model API
under the machine setting `museSpark.legalExplanation`; Muse Code requires an
explicit opt-in, and existing explicit false settings remain off. It requires a stored Model API key,
asks permission with the price and shared daily budget, and reserves/settles
against the same D78 ledger used by other paid callers. The machine setting
`museSpark.paidDailyBudgetUsd` defaults to USD 5 (range USD 0.50–500). Only
technical finding categories and recognized license IDs are sent; source,
paths, excerpts and package names are excluded. One request has no tools or
retries and at most 512 output tokens. A sent request without verified usage
retains its reserved cost as unknown liability. The subscription pays none of
it; deterministic scanning needs no model call.

ACP editors can send `/legal` on either backend without starting a model turn;
`/legal --offline` disables registry lookup. The shared runtime command also
serves companion and native editor adapters. Native adapter certification
belongs to each editor's existing compatibility milestone.

The headless accessibility check runs keyboard, accessibility-tree, narrow
layout and 100%/200% browser-metric zoom checks in four themes and English/pseudo
locales, followed by WCAG checks. Run `npm run test:legal-a11y`; the Windows rig
runs `npm run test:legal-a11y -- --platform=win32 --out=temp/m97-windows-a11y`.
A mismatched platform fails before launching a browser. The input branch has
macOS and Windows/NVDA receipts; the merged package needs fresh platform
certification from the lead. See the [certification
record](docs/certification/m97.md) for receipts and platform scope.

The ACP package also provides the reserved offline command
`muse-spark-code-acp exec legal-scan --json`, with the older top-level `legal`
command retained as an alias; see [its guide](docs/acp.md#deterministic-legal-scan-m97).
The reserved command never becomes a model prompt and never performs automatic fixes.

## Help and reference

Type `/help` in the panel, or run **Muse Spark: Open Help & Reference**, for a
searchable reference of features, slash commands, commands, settings, keyboard
actions and ACP/CLI flags. It shows exact host/backend pairs, paid admission
rules, current/default values, nested setting schemas, command prerequisites
and CLI limits. Environment-variable values stay hidden. Load failures show a
retry action. Auto help names both backend reviewers and their admission rules;
ordinary model questions and MCP server form replies have separate privacy
entries. Search matches the displayed JSON text, Markdown retains argument
placeholders, and modal focus lists both Tab and Shift+Tab. The page follows
the editor’s theme and display language.

ACP editors can send `/help` for the current installed-skill list and the
[generated reference](docs/reference.md). ACP locally handles `/help`, `/compact`, `/legal`, `/usage`, `/questions`, `/answer` and
installed skills; the linked panel slash commands and settings are extension
workflows. In a terminal, `muse-spark-code-acp help --all` prints the full
reference in the installed language without a model call. `exec --help`,
`report --help` and `scan-secrets --help` also print it; `--help` prints concise
ACP usage. Terminal help states that VS Code current values are unavailable.

Maintainers run `npm run reference:generate` after changes. The reference reads
the complete contributed setting schema and palette conditions. The CLI parser,
webview keyboard handlers, slash registry, paid tally and paid-use popup share
typed tables with the generator. Enum defaults retain their value and meaning.
`npm run check:reference` checks source coverage, reviewed host capabilities and
admission wiring, option contracts, catalogue descriptions and generated-file
freshness. Conditional descriptions use typed `conditions` with technical
selectors; generic state wording in plain descriptions fails the gate. The
generator renders these conditions on the page, in Markdown and in terminal
help, including enum meanings and paid-default facts. The guard walks the
complete emitted model and rejects the closed state-predicate vocabulary on
every description surface, including shortcuts. A Best-of-N truth regression
exercises the production manager: a finite session cap requires an owned
parent budget scope shared by candidates. Independent tests exercise parser
acceptance and keyboard actions.
Search includes displayed descriptions and keeps related command links reachable.
Installed skills are dynamic and are refreshed
when ACP answers help. Native shared-webview and phone companion integrations
remain planned; this reference does not claim those hosts implement the page.

## Commands and keybindings

| Command                                             | Default keybinding                                                                               | What it does                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Muse Spark: Open in Sidebar                         | —                                                                                                | Focus the chat view in the activity bar                                                                                                                                                                                       |
| Muse Spark: New Conversation                        | `Ctrl+N` (`Cmd+N`) when `enableNewConversationShortcut` is on, Muse focused                      | Clear the active panel to a new conversation, or open one where `preferredLocation` says                                                                                                                                      |
| Muse Spark: Sign Out                                | —                                                                                                | Forget the stored Model API key and sign the CLI out when it is signed in (its `account/logout`, else `muse logout`)                                                                                                          |
| Muse Spark: Open in Terminal                        | —                                                                                                | Run the Muse Code CLI's own interactive interface in a VS Code terminal at the workspace root                                                                                                                                 |
| Muse Spark: Create AGENTS.md                        | —                                                                                                | Write the rules file with `muse init` (or the same template without the CLI) and open it; an existing file is opened                                                                                                          |
| Muse Spark: Open Walkthrough                        | —                                                                                                | Open the four-step Get Started walkthrough                                                                                                                                                                                    |
| Muse Spark: Open in New Tab                         | `Ctrl+Shift+Alt+Esc` on Windows, `Cmd+Shift+Esc` on macOS, `Ctrl+Shift+Esc` on Linux             | Open an independent conversation as an editor tab (also the `+` in the view title); the panel header's own button starts a new conversation in place                                                                          |
| Muse Spark: Toggle Focus                            | `Ctrl+Alt+Esc` on Windows, `Cmd+Esc` on macOS, `Ctrl+Esc` on Linux                               | Move keyboard focus between the editor and the composer                                                                                                                                                                       |
| Muse Spark: Insert @-Mention for Selection          | `Alt+K`, editor focused                                                                          | Insert `@path#start-end` for the active editor selection into the composer                                                                                                                                                    |
| Muse Spark: Toggle Focus View                       | `Ctrl+Alt+F`, Muse focused                                                                       | Flip the `museSpark.focusView` setting (hides tool calls and reasoning)                                                                                                                                                       |
| Muse Spark: Toggle Thinking                         | `Ctrl+Alt+T` (macOS `Option+T`, Linux `Ctrl+Alt+O`), composer only                               | Turn reasoning on or off for this conversation. Claude Code uses `Alt+T`; on Windows that opens the Terminal menu, on GNOME `Ctrl+Alt+T` opens a terminal                                                                     |
| Muse Spark: Set Up Shell Sandbox                    | —                                                                                                | Windows: run Muse Code's one-time `muse sandbox windows setup` through a UAC prompt and report the result; elsewhere reports that no setup is needed                                                                          |
| Muse Spark: Show Logs                               | —                                                                                                | Open the "Muse Spark" log channel (keys redacted)                                                                                                                                                                             |
| Muse Spark: Diagnostics                             | —                                                                                                | Write the versions, the backend and CLI facts, credential facts, never a value, the dictation state, the network posture and `muse config status` to the log and open it: what a bug report needs                             |
| Muse Spark: Manage Skills                           | —                                                                                                | Turn Muse Code's skills on or off (`muse skills enable`/`disable`), then offer to restart it so the change takes effect                                                                                                       |
| Muse Spark: Import Skills from Claude Code or Codex | —                                                                                                | Preview what `muse skills import` would copy, import it once you confirm, report what was imported, skipped or failed                                                                                                         |
| Muse Spark: Import from Other Agents                | —                                                                                                | Preview MCP servers, hooks, agents, commands and rules from Claude Code, Codex or Cursor, import the files once you confirm, offer unsaved target edits, preserve source exposure                                             |
| Muse Spark: Install Bundled Skills for Muse Code    | —                                                                                                | Copy the [bundled skills](#bundled-skills)' package into Muse Code's config folder and link each skill into its skills folder (or update that copy); a skill of yours with the same name is kept                              |
| Muse Spark: Remove Bundled Skills from Muse Code    | —                                                                                                | Remove the links into the extension's marked copy, then the copy; nothing else is touched                                                                                                                                     |
| Muse Spark: Export Conversation                     | —                                                                                                | Save the conversation in front of you as Markdown where you choose, and open it                                                                                                                                               |
| Muse Spark: Import Session                          | —                                                                                                | Resume a session-export JSON file as a new conversation on the Model API backend, on your model, starting in Manual (or Plan) every time it is opened                                                                         |
| Muse Spark: Open Share File                         | —                                                                                                | Read a session-export JSON file read-only in the panel: Copy and links only                                                                                                                                                   |
| Muse Spark: MCP Servers                             | —                                                                                                | Show the MCP servers Muse Code will load (on the Model API backend, how each is running), sign in to or out of a remote one, open the settings file                                                                           |
| Muse Spark: Hooks                                   | —                                                                                                | Show where Muse Code's hooks come from (project, yours, managed) and open each file; on the Model API backend also whether `modelApiHooks` is on, with a link to it                                                           |
| Muse Spark: Memory                                  | —                                                                                                | List Muse Code's memory notes for this workspace, open one to edit, create one, or delete one to the trash, keeping each `MEMORY.md` index in step                                                                            |
| Muse Spark: New Worktree…                           | —                                                                                                | Ask for a new branch and its base, create it in its own folder beside the repository, then offer to open it in a new window                                                                                                   |
| Muse Spark: Remove Worktree…                        | —                                                                                                | Delete another worktree's folder (its branch stays), asking again before discarding uncommitted changes                                                                                                                       |
| Muse Spark: Move Running Command to Background      | `Ctrl+B` (also on macOS), while the conversation in view runs a shell command                    | Let the running shell commands go on in the background while the agent carries on; VS Code keeps `Ctrl+B` otherwise                                                                                                           |
| Muse Spark: Stop Background Tasks                   | —                                                                                                | Stop every background task of the conversation in view                                                                                                                                                                        |
| Muse Spark: Restart Muse Code                       | —                                                                                                | Stop `muse serve` and start a fresh one without reloading the window; a running turn is stopped, and each conversation continues with its next message                                                                        |
| (composer) Record voice                             | `Ctrl+D` (`Cmd+D`), composer only                                                                | Tap to start or stop voice dictation, hold to record while held                                                                                                                                                               |
| (composer) Run a shell command                      | Start the message with `!`                                                                       | Run it in the workspace as you, outside any turn; the agent sees it with your next message                                                                                                                                    |
| Muse Spark: Start with Your Own Model               | —                                                                                                | Open the setup wizard at "Pick a provider"; keys stay in the host draft until Save, failures restore prior provider/default/secret state, and setup confirmation requires the composer's model receipt. Cancel writes nothing |
| Muse Spark: Models & Agents                         | —                                                                                                | Open the Models & Agents panel: providers with key state, model scans with diffs, removal with Undo, import and export                                                                                                        |
| Muse Spark: Add Model Provider…                     | —                                                                                                | The quick-pick fast path without the panel: pick a provider, enter or connect the key, test it, pick models and confirm                                                                                                       |
| Command                                             | Default keybinding                                                                               | What it does                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------                    |
| Muse Spark: Continue with ChatGPT                   | —                                                                                                | Connect an eligible Plus/Pro plan in the system browser and select its catalogue model                                                                                                                                        |
| Muse Spark: Use my Copilot models                   | —                                                                                                | Select VS Code’s Copilot models using host consent and the user’s plan or AI credits                                                                                                                                          |
| Muse Spark: Open in Sidebar                         | —                                                                                                | Focus the chat view in the activity bar                                                                                                                                                                                       |
| Muse Spark: New Conversation                        | `Ctrl+N` (`Cmd+N`) when `enableNewConversationShortcut` is on, Muse focused                      | Clear the active panel to a new conversation, or open one where `preferredLocation` says                                                                                                                                      |
| Muse Spark: Sign Out                                | —                                                                                                | Forget the stored Model API key and sign the CLI out when it is signed in (its `account/logout`, else `muse logout`)                                                                                                          |
| Muse Spark: Open in Terminal                        | —                                                                                                | Run the Muse Code CLI's own interactive interface in a VS Code terminal at the workspace root                                                                                                                                 |
| Muse Spark: Create AGENTS.md                        | —                                                                                                | Write the rules file with `muse init` (or the same template without the CLI) and open it; an existing file is opened                                                                                                          |
| Muse Spark: Open Walkthrough                        | —                                                                                                | Open the four-step Get Started walkthrough                                                                                                                                                                                    |
| Muse Spark: Open in New Tab                         | `Ctrl+Shift+Alt+Esc` on Windows, `Cmd+Shift+Esc` on macOS, `Ctrl+Shift+Esc` on Linux             | Open an independent conversation as an editor tab (also the `+` in the view title); the panel header's own button starts a new conversation in place                                                                          |
| Muse Spark: Toggle Focus                            | `Ctrl+Alt+Esc` on Windows, `Cmd+Esc` on macOS, `Ctrl+Esc` on Linux                               | Move keyboard focus between the editor and the composer                                                                                                                                                                       |
| Muse Spark: Insert @-Mention for Selection          | `Alt+K`, editor focused                                                                          | Insert `@path#start-end` for the active editor selection into the composer                                                                                                                                                    |
| Muse Spark: Toggle Focus View                       | `Ctrl+Alt+F`, Muse focused                                                                       | Flip the `museSpark.focusView` setting (hides tool calls and reasoning)                                                                                                                                                       |
| Muse Spark: Toggle Thinking                         | `Ctrl+Alt+T` (macOS `Option+T`, Linux `Ctrl+Alt+O`), composer only                               | Turn reasoning on or off for this conversation. Claude Code uses `Alt+T`; on Windows that opens the Terminal menu, on GNOME `Ctrl+Alt+T` opens a terminal                                                                     |
| Muse Spark: Set Up Shell Sandbox                    | —                                                                                                | Windows: run Muse Code's one-time `muse sandbox windows setup` through a UAC prompt and report the result; elsewhere reports that no setup is needed                                                                          |
| Muse Spark: Show Logs                               | —                                                                                                | Open the "Muse Spark" log channel (keys redacted)                                                                                                                                                                             |
| Muse Spark: Diagnostics                             | —                                                                                                | Write the versions, the backend and CLI facts, credential facts, never a value, the dictation state, the network posture and `muse config status` to the log and open it: what a bug report needs                             |
| Muse Spark: Report a Problem                        | —                                                                                                | Open the report dialog, in a new conversation if none is open: preview the scrubbed draft, then copy it, open a GitHub issue page or save it ([more](#reporting-a-problem))                                                   |
| Muse Spark: Manage Skills                           | —                                                                                                | Turn Muse Code's skills on or off (`muse skills enable`/`disable`), then offer to restart it so the change takes effect                                                                                                       |
| Muse Spark: Import Skills from Claude Code or Codex | —                                                                                                | Preview what `muse skills import` would copy, import it once you confirm, report what was imported, skipped or failed                                                                                                         |
| Muse Spark: Import from Other Agents                | —                                                                                                | Preview MCP servers, hooks, agents, commands and rules from Claude Code, Codex or Cursor, import the files once you confirm, offer unsaved target edits, preserve source exposure                                             |
| Muse Spark: Install Bundled Skills for Muse Code    | —                                                                                                | Copy the [bundled skills](#bundled-skills)' package into Muse Code's config folder and link each skill into its skills folder (or update that copy); a skill of yours with the same name is kept                              |
| Muse Spark: Remove Bundled Skills from Muse Code    | —                                                                                                | Remove the links into the extension's marked copy, then the copy; nothing else is touched                                                                                                                                     |
| Muse Spark: Export Conversation                     | —                                                                                                | Save the conversation in front of you as Markdown where you choose, and open it                                                                                                                                               |
| Muse Spark: Import Session                          | —                                                                                                | Resume a session-export JSON file as a new conversation on the Model API backend, on your model, starting in Manual (or Plan) every time it is opened                                                                         |
| Muse Spark: Open Share File                         | —                                                                                                | Read a session-export JSON file read-only in the panel: Copy and links only                                                                                                                                                   |
| Muse Spark: MCP Servers                             | —                                                                                                | Show the MCP servers Muse Code will load (on the Model API backend, how each is running), sign in to or out of a remote one, open the settings file                                                                           |
| Muse Spark: Hooks                                   | —                                                                                                | Show where Muse Code's hooks come from (project, yours, managed) and open each file; on the Model API backend also whether `modelApiHooks` is on, with a link to it                                                           |
| Muse Spark: Memory                                  | —                                                                                                | List Muse Code's memory notes for this workspace, open one to edit, create one, or delete one to the trash, keeping each `MEMORY.md` index in step                                                                            |
| Muse Spark: New Worktree…                           | —                                                                                                | Ask for a new branch and its base, create it in its own folder beside the repository, then offer to open it in a new window                                                                                                   |
| Muse Spark: Remove Worktree…                        | —                                                                                                | Delete another worktree's folder (its branch stays), asking again before discarding uncommitted changes                                                                                                                       |
| Muse Spark: Move Running Commands to Background     | `Ctrl+B` (also on macOS), while a Muse panel has focus and its conversation runs a shell command | Let the running shell commands go on in the background while the agent carries on; VS Code keeps `Ctrl+B` otherwise                                                                                                           |
| Muse Spark: Stop Background Tasks                   | —                                                                                                | Stop every background task of the conversation in view                                                                                                                                                                        |
| Muse Spark: Restart Muse Code                       | —                                                                                                | Stop `muse serve` and start a fresh one without reloading the window; a running turn is stopped, and each conversation continues with its next message                                                                        |
| (composer) Record voice                             | `Ctrl+D` (`Cmd+D`), composer only                                                                | Tap to start or stop voice dictation, hold to record while held                                                                                                                                                               |
| (composer) Run a shell command                      | Start the message with `!`                                                                       | Run it in the workspace as you, outside any turn; the agent sees it with your next message                                                                                                                                    |
| Muse Spark: Download Browser Check Runtime          | —                                                                                                | Get the [browser check](#browser-check)'s pinned browser ready ahead of a check: the same consent, download and verification a check would do, with cancellable progress; says when it is ready or why not                    |
| Muse Spark: What's New                              | —                                                                                                | Open the release notes of this version (back to the newest release with Highlights) in an editor tab; see [What's New after an update](#whats-new-after-an-update)                                                            |
| Muse Spark: Open a Pull Request in a Conversation…  | —                                                                                                | Check a GitHub pull request out in a worktree of its own and open it in a new window; someone else's is held in Plan mode, its project configuration off, until you trust it there                                            |
| Muse Spark: Move Running Command to Background      | `Ctrl+B` (also on macOS), while the conversation in view runs a shell command                    | Let the running shell commands go on in the background while the agent carries on; VS Code keeps `Ctrl+B` otherwise                                                                                                           |
| Muse Spark: Start with Your Own Model               | —                                                                                                | Open the setup wizard at "Pick a provider"; keys stay in the host draft until Save, failures restore prior provider/default/secret state, and setup confirmation requires the composer's model receipt. Cancel writes nothing |
| Muse Spark: Models & Agents                         | —                                                                                                | Open the Models & Agents panel: providers with key state, model scans with diffs, removal with Undo, import and export                                                                                                        |
| Muse Spark: Add Model Provider…                     | —                                                                                                | The quick-pick fast path without the panel: pick a provider, enter or connect the key, test it, pick models and confirm                                                                                                       |

Windows keeps `Ctrl+Esc` for Start and `Ctrl+Shift+Esc` for Task Manager,
which is why its two shortcuts add `Alt`. Twelve commands appear in the
Command Palette only where they can act: Insert @-Mention with an editor
open, Toggle Thinking, Export Conversation, Import Session, Open Share File
and Stop Background Tasks with a Muse panel in view, Move Running Commands
to Background while one runs, Set Up Shell Sandbox on Windows (or in a
remote window), Create AGENTS.md, the two worktree commands and Open a Pull
Request in a Conversation with a folder open.

## Settings

All settings live under `museSpark.*`; most changes apply to open panels
immediately, and the table names the exceptions (a host restart, or read
when a conversation starts). The settings that choose what runs and what is billed
(`initialPermissionMode`, `backend`, `shellSandbox`, `sandboxNetwork`,
`allowDangerouslySkipPermissions`, `museBinaryPath`, `environmentVariables`,
`modelApiHooks`, `modelApiRepoMap`, `modelApiObservationPacking`, `modelApiAutoCompaction`,
`modelApiPromptCacheRetention`, `turnCheckpoints`, `bundledSkills`, `browserCheckExtraHosts`,
`browserCheckRuntime`, `showWhatsNewOnUpdate`,
the verify loop's `checkCommands`, `formatOnEdit` and `diagnosticsAfterEdits`,
`modelApiSessionBudgetUsd`, `modelApiCommandRules`,
`modelApiPermissionProfiles`, `modelApiPermissionProfile`,
`museCodeAutoReviewer` and the eight paid features, `modelApiWebSearch`,
`modelApiImageGeneration`, `modelApiVoice`, `modelApiSubagents`,
`modelApiBestOfN`, `modelApiTeamWorkers`, `modelApiScheduledPrompts` and `modelApiAutoReviewer`) are machine-scoped: they
take effect from your user settings only, never from a repository's
`.vscode/settings.json`. In a remote window (SSH, WSL, a dev
container) machine settings live on the remote side, where a dev container
definition can set them; there the extension never starts a conversation in
Bypass permissions and asks you once before entering it. Turning
`allowDangerouslySkipPermissions` off moves every open conversation out of
Bypass at once.

| Setting                           | Default     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preferredLocation`               | `panel`     | Where **Muse Spark: New Conversation** opens one when no Muse conversation is active: `sidebar` or `panel` (editor tab)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `initialPermissionMode`           | `manual`    | `manual`, `acceptEdits`, `plan`, `auto` or `bypassPermissions` for new conversations; `bypassPermissions` applies only while `allowDangerouslySkipPermissions` is on, otherwise the conversation starts in `manual`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `autosave`                        | `true`      | Save all dirty editors before every turn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `attachOpenFile`                  | `true`      | Show the open-file chip and send the active file / selection with each message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `useCtrlEnterToSend`              | `false`     | Send with Ctrl/Cmd+Enter instead of Enter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `enableNewConversationShortcut`   | `false`     | `Ctrl+N` / `Cmd+N` starts a new conversation while a Muse panel is focused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `hideOnboarding`                  | `false`     | Hide the getting-started tips                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `focusView`                       | `false`     | Show only prompts and responses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `respectGitIgnore`                | `true`      | Exclude `.gitignore` patterns from file searches and `@`-mentions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `confidentialWorkspace`           | `false`     | Block contributor-tier models (Meta may train on their traffic) in this workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `allowDangerouslySkipPermissions` | `false`     | List Bypass permissions in the Modes menu and the Shift+Tab cycle (sandboxes only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `archiveInactiveSessions`         | `14`        | Hide sessions idle for this many days from the History dialog (`1`, `2`, `7`, `14`, or `0` for never); they stay on disk and **Show archived** lists them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `cleanupPeriodDays`               | `30`        | Delete Model API conversations idle for more than this many days when a window lists them (`0` keeps them); Muse Code's own sessions are the CLI's to keep                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `backend`                         | `auto`      | `auto`: Muse Code when the CLI is signed in, else the Model API when a key is stored; `museCode` / `modelApi` force one. The pasted key never reaches the CLI. Changing it restarts the host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `shellSandbox`                    | `auto`      | `auto`: Muse Code's OS sandbox, except for Windows workspaces under your profile, where it cannot reliably run commands; `muse`: always the sandbox; `off`: commands run directly as you, gated by approvals (Claude Code style). Without the sandbox Muse Code's file tools can also write anywhere outside the workspace without asking, in every mode, and the panel warns once per window. Changing it restarts the host                                                                                                                                                                                                                                                                                   |
| `sandboxNetwork`                  | `default`   | The network Muse Code's shell sandbox gives commands: `proxy-only` asks before each new destination, `restricted` allows none, `enabled` allows all; `default` passes nothing, leaving Muse Code's own default (`proxy-only`) or your administrator's managed configuration. For commands it applies while the sandbox is on. Changing it restarts the host. At `restricted`, Muse Code is also not offered [web fetch](#web-fetch), sandbox or not; the Model API backend's web fetch follows its permission modes                                                                                                                                                                                            |
| `museBinaryPath`                  | `""`        | Absolute path to the Muse Code executable (a relative one is refused); empty discovers it on `PATH` or the install dir. Changing it restarts the host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `modelApiWebSearch`               | `true`      | Hosted web search ($2.50 per 1,000 searches); unavailable under a finite budget because no hard query bound is verified. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `modelApiImageGeneration`         | `true`      | Image generation and editing ($0.01 per image). Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `modelApiVoice`                   | `true`      | Offers Muse Voice ($0.18 per audio hour); free OS dictation remains the default. Muse Voice is unavailable under a finite budget. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.                                                                                                                                                                                                                                                                                                                                                                                              |
| `modelApiPromptCacheRetention`    | `in_memory` | How long Meta is asked to keep the cached start of Model API requests: `in_memory` by default, or up to `24h` when you choose it. Both have the same cached-input price; longer retention may improve cache hits after a pause. Meta may evict sooner. Machine-scoped, so a repository cannot extend it                                                                                                                                                                                                                                                                                                                                                                                                        |
| `modelApiSubagents`               | `true`      | Bounded paid child agents, with up to four requests per task including retries. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `modelApiScheduledPrompts`        | `true`      | Explicit scheduled Model API runs at the selected model’s token prices. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `modelApiHooks`                   | `true`      | On by default; inert without a hooks file. Runs your configured commands outside the agent sandbox, only in trusted workspaces. Review them in Muse Spark: Hooks. Provider credentials are withheld.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `shell.passEnvironmentVariables`  | `[]`        | Names permitted in interactive top-level Model API shell and `!` commands. Can expose credentials to the conversation and model provider. Verification/`then_run`, schedules, child/team workers and hooks never honor this machine-scoped exception. See Privacy and security                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `environmentVariables`            | `[]`        | `{ name, value }` pairs for the Muse Code process and the terminals that run the CLI (Open in Terminal, MCP sign-in, `muse logout`); an `XDG_CONFIG_HOME` here is where the extension looks for the CLI's sign-in and settings too. Never put API keys here; use Sign in. Changing it restarts the host                                                                                                                                                                                                                                                                                                                                                                                                        |
| `modelApiRepoMap`                 | `false`     | Put a [repo map](#code-intelligence) in the Model API backend's instructions in a trusted workspace: the workspace's most used files and definitions, made once per conversation in about 1,000 tokens, which every request then carries (billed to your key). Machine-scoped                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `modelApiObservationPacking`      | `true`      | On by default. Packs old long tool outputs after two requests; recall_output reads the originals. The M75 evaluation passed. Read when a conversation starts or resumes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `turnCheckpoints`                 | `true`      | Records the model’s own file-tool writes for **Restore files to here** and Redo while each file still holds exactly what the model left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Requires a connected Model API session, git and confirmed process safety; copies stay in extension storage, outside the workspace’s `.git`. Off in Restricted Mode. Machine-scoped                                                                                                                                                                                                                                                                                                 |
| `bundledSkills`                   | `true`      | The [bundled skills](#bundled-skills) (`project_setup`, `feature_delivery`, `quality_retrofit`): a skill source on the Model API backend, after the project's and your own, and the install offer for Muse Code (once per window until you choose Install or Not now). Off removes them from the Model API catalogue at once; an install for Muse Code stays until **Remove Bundled Skills from Muse Code**. Machine-scoped                                                                                                                                                                                                                                                                                    |
| `diagnosticsAfterEdits`           | `true`      | [Checking edits](#checking-edits): after each round of edits the Model API model gets the errors and warnings of up to 8 edited files from VS Code's language servers; Muse Code is told to read them itself. Machine-scoped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `checkCommands`                   | `[]`        | [Checking edits](#checking-edits): `{ name, command, changedFiles?, timeoutSeconds? }` lint, test or type-check commands the Model API backend runs after each round of edits, each asking wherever a shell command asks; Muse Code is told to run them. Machine-scoped                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `formatOnEdit`                    | `false`     | [Checking edits](#checking-edits): run the file's formatter on each file `write_file` or `edit_file` writes on the Model API backend, in a trusted workspace; never on a file the editor runs as code. Machine-scoped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `modelApiBestOfN`                 | `true`      | Offers best-of-N as a separate explicit action. Ordinary turns use one model unless you choose more attempts. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `modelApiCommandRules`            | `[]`        | Machine-scoped standing allow/ask/forbid prefix rules, each with matching examples and optional nonmatching ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `modelApiPermissionProfiles`      | `{}`        | Machine-scoped named file-denial globs and explicit additional read roots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `modelApiPermissionProfile`       | `""`        | Machine-scoped selected profile; unknown or malformed selections deny file access.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `modelApiRepositoryRules`         | `{}`        | Repository rules may add ask/forbid commands and file denials, never standing allows or extra roots.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `modelApiAutoReviewer`            | `true`      | In Auto, a paid review judges unresolved risky actions; it cannot override forbidden commands, protected writes or required questions. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.                                                                                                                                                                                                                                                                                                                                                                                         |
| `museCodeAutoReviewer`            | `true`      | Machine-scoped. In Auto on the Muse Code backend, eligible approvals Muse Code raises for the running turn go to [the reviewer](#the-auto-reviewer-on-muse-code) first: one short Muse Code turn per review on your subscription; it allows once or leaves the card to you.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `notifyOnBackgroundTurn`          | `true`      | A VS Code notification when a turn of a minute or more ends, or a turn waits for your approval or answer, while the VS Code window is unfocused; never while it is focused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `modelApiReplyUsage`              | `true`      | On by default. Shows tokens and estimated cost under each Model API reply; display only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `modelApiSessionBudgetUsd`        | `0`         | Spend cap in dollars for each Model API conversation (`0`: no cap). Shared durable reservations cover the conversation's own token requests and image fees; working storage is required. Paid subagent requests keep their own consent and request ceiling: their reported cost is counted, but it is not reserved against this cap and can take the conversation past it. Unknown sent usage retains its full liability and cannot retry an ambiguous failure under the same allowance. Capped web search is unavailable until its billed query bound is verified, and paid Muse Voice is unavailable while a cap is set. Input estimates and published prices may differ from actual billing. Machine-scoped |
| `browserCheckExtraHosts`          | `[]`        | [Browser check](#browser-check): hosts beyond this computer a checked page may open and reach, as plain host names or IP addresses (no ports, paths or wildcards; one that is not refuses the list); listing a loopback name also lets a local page use `https` and WebSockets. Empty means plain `http` to this computer only, unless you allow a host on a card or in the dialog for one check. `https` and WebSocket traffic to a listed host is encrypted and not inspected, and a site there may sign in as you with this computer's account (on Windows in particular). Only you widen it, never the model. Machine-scoped                                                                               |
| `browserCheckRuntime`             | `'ask'`     | [Browser check](#browser-check): how the check gets its browser, Google's Chrome for Testing headless shell pinned to this extension version (about 100 to 120 MB per version, from `storage.googleapis.com` into the extension's storage): `ask` asks before downloading it, `download` downloads it when a check needs it without asking (for every later pinned version too), `off` offers no browser check and downloads nothing. Machine-scoped                                                                                                                                                                                                                                                           |
| `showWhatsNewOnUpdate`            | `true`      | Open What's New after the extension updates: the page after a release with Highlights, a quiet notification after a fixes-only patch; off shows nothing on updates ([What's New after an update](#whats-new-after-an-update))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `paidDailyBudgetUsd`              | `5`         | Shared interactive extras budget in USD, $0.50–$500; machine-scoped. Daily reservations persist across windows; Tab uses its own separate ledger.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `dictationEngine`                 | `"system"`  | Model API dictation engine: `system` (free default) or `museVoice` (paid, currently refused under the finite cap). Muse Code retains its explicit voice opt-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `modelApiAutoCompaction`          | `true`      | Automatic Model API compaction; awaiting evaluation and inactive until the M75 pair and shared paid admission are certified. Set false to opt out. Machine-scoped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

| `modelApiTeamWorkers` | `true` | [Paid](#paid-features): team tasks billed to your Model API key (M96 agent roles, lane A): on with one price question before the first charge; the first delegate call that starts key tasks asks once with each model's prices, each task's ceiling and the shared daily budget. Machine-scoped |

The Model API backend's shell tool applies `terminal.integrated.env.*` the
way VS Code's terminal does. A restart of Muse Code, for a setting, trust
granted, a sign-in or a crash, keeps the conversation: the running turn is
stopped and the next message resumes the same session.

### Proxies and certificates

- **The extension's own requests** (the Model API, the paid features, Muse
  Voice's socket) go through VS Code's network support, as every
  extension's `fetch` does on every VS Code this extension supports, and
  its WebSocket from VS Code 1.112: `http.proxy`, or
  the system's proxy settings or PAC file; proxy authentication as VS Code
  handles it (Basic and Kerberos); `http.noProxy`; and the
  operating system's certificate store while `http.systemCertificates` is
  on. `http.proxySupport`, `http.fetchAdditionalSupport` and
  `http.webSocketAdditionalSupport` must stay on (their defaults) for that.
  A network that inspects HTTPS needs its root in the system store. Naming
  the root's file in `NODE_EXTRA_CA_CERTS` before VS Code starts works only
  with `http.systemCertificates` off: in the M56 drill the variable did not
  help while that setting was on (its default).
- **Muse Voice on VS Code 1.101 to 1.111**: those versions do not route an
  extension's WebSocket, so Muse Voice's socket goes to Meta directly,
  without VS Code's proxy, proxy authentication, `http.noProxy` or the
  certificates VS Code adds. Behind a proxy or a network that inspects
  HTTPS, use VS Code 1.112 or later for Muse Voice; the Model API's requests
  are routed on every supported version. On 1.99 and 1.100 Muse Voice is
  unavailable (their Node has no WebSocket). An editor built on VS Code may
  route neither; **Muse Spark: Diagnostics** says which of the two this one
  routes.
- **Muse Code** reads proxy variables from its environment (`HTTPS_PROXY`,
  `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`). The extension hands it VS Code's
  `http.proxy` (and `http.noProxy`) when neither its environment nor
  `environmentVariables` sets one, in either case; a proxy VS Code finds in
  the system settings or a PAC file does not reach it, so set `http.proxy`
  or `HTTPS_PROXY` in `environmentVariables`; keep proxy credentials out of
  shared workspace settings. If `http.proxy` or `http.noProxy` has the wrong
  type, the extension ignores that value for Muse Code instead of passing it
  into the CLI's environment; correct the VS Code setting to restore it.
  Loopback bypasses an environment proxy, so Muse Code reaches the extension's
  `ide` tools. Muse Code also has its own `endpoint_transport.proxy` setting,
  which this extension does not manage. Muse Code 1.3.0 trusts the operating system's certificate
  store; `SSL_CERT_FILE` or `SSL_CERT_DIR` replace that store for it
  entirely, so a file named there must hold every root it needs.
- **Muse Spark: Diagnostics** reports which of these are set (never a
  proxy's address), whether this editor routes the extension's `fetch` and
  WebSocket at all, and known-safe source and generation fields from
  Muse Code's managed configuration (`muse config status`). Unrecognized
  lines and failed-command output stay out of the public-issue report.

## Requirements

- VS Code 1.99.0 or newer, on Windows, macOS or Linux, or an editor built
  on it: VSCodium 1.99.3 and 1.135, code-server 4.99.4 and Theia 1.75 were
  tested (see [hosts.md](docs/ide-compatibility/hosts.md)). On 1.99 and 1.100, whose
  extension host is Node 20, Muse Voice is unavailable; on 1.101 to 1.111 its
  socket does not use VS Code's proxy support (see
  [Proxies and certificates](#proxies-and-certificates)).
- The [Muse Code CLI](https://dev.meta.ai/products/muse-code/) signed in with
  a Meta account (subscription), or a Meta Model API key (pay as you go).
- `git` on `PATH` for `.gitignore`-aware `@` mentions, worktrees, turn
  checkpoints (**Restore files to here**), best-of-N (git 2.36 or newer) and
  the Model API prompt's git facts (optional; VS Code's file search is used
  without it). Commit and push use VS Code’s built-in Git extension, and pull
  requests use VS Code’s GitHub sign-in. The extension runs git only in a trusted workspace and only
  from an absolute `PATH` entry, never a copy inside the workspace.
- Python 3.12 or newer on `PATH`, only for the
  [bundled skills](#bundled-skills)' delivery helpers.
- Voice dictation: Windows, or macOS with Dictation or Siri enabled, in a
  local window.
- A trusted workspace for rules, skills, memory, MCP servers, hooks and
  shell commands; in
  Restricted Mode the panel chats and edits under the chosen permission
  mode, and paid features you turned on still work, but nothing more.
  The first workspace folder is the root: the open-file chip, `@` mentions,
  drops, the Problems panel the agent reads and relative file links all
  belong to it (a folder added inside it counts as part of it); a file in
  another folder is mentioned by its absolute path. Virtual workspaces are
  not supported.

## Privacy and security

- Model-run shell commands and native helpers do not inherit credential
  variables (`*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_PASSPHRASE`, `*_API_KEY`,
  `*_ACCESS_KEY`, `*_PRIVATE_KEY`, `*_SECRET_KEY`, `*_CREDENTIALS`, `*_AUTH`,
  `*_PAT` and known cloud credentials), including Azure DevOps PATs,
  `SYSTEM_ACCESSTOKEN`, Terraform's `TF_TOKEN_*` and credentials set by terminal
  environment overrides. Harmless names such as `TOKENIZERS_PARALLELISM` and
  `KEY_PATH` remain available.
  The machine-scoped `museSpark.shell.passEnvironmentVariables` setting is
  an array of names, default `[]`, never values. Naming a credential permits
  an interactive top-level shell or `!` command to receive it: the command
  can expose its value in tool output to the conversation and model provider.
  Verification/`then_run`, schedules, child/team workers and hooks never honor
  this exception. An interactive command moved to the background retains its
  starting environment. The command's origin is captured when it is created
  and its admission is rechecked at spawn: a delayed scheduled command stays
  fenced after its turn ends or another interactive turn starts.
  MCP servers receive only their narrow host environment
  and explicitly configured `env`; browser checks use a private environment.
  Muse Code's own credential inheritance stays unchanged. ACP/headless tools
  remain credential-free and offer no pass-through option.
- Your prompts, attachments, mentioned files and tool output go to Meta
  only when you press Send. The exceptions are ones you set up: on the
  Model API backend an MCP server you configured receives its tool calls'
  arguments, and with `museSpark.modelApiHooks` on your hook commands
  receive your prompt and bounded previews of tool and model calls. With
  `museSpark.modelApiRepoMap` on, every request also carries the repo map
  (file paths and definition names, no file contents). By
  default each message also carries the open file's path and any selected
  text (`attachOpenFile`); on the CLI backend each turn carries a short
  hidden note asking the model to offer choices through the question card.
  In Auto on Muse Code, [the reviewer](#the-auto-reviewer-on-muse-code)
  sends your latest message, the turn's earlier calls and the request it
  judges to Meta as one more Muse Code turn on your subscription
  (`museSpark.museCodeAutoReviewer`). [Muse Judge](#muse-judge) can also send
  a redacted risk question about an already held approval, using that same
  model on your subscription (`museSpark.judge.engine`, `auto` by default).
  The extension has no telemetry
  and no hosted server of its own. Details: [PRIVACY.md](docs/PRIVACY.md).
- A pasted Model API key lives only in VS Code's SecretStorage, is sent only
  to `api.meta.ai`, is never passed to any child process, and never reaches
  settings, logs or the CLI.
- Contributor-tier models (Meta may train on their traffic) are opt-in with
  one confirmation per model in each panel, and refused with
  `museSpark.confidentialWorkspace` at model selection and every message
  dispatch, including steering, queued/timed preparations and review. Checks
  repeat after pending confirmations and setup before a model switch or
  resume. Turning the setting on cancels and retires existing contributor
  sessions; select a standard model before sending again. A resumed session
  discovered on a contributor model moves to a standard model when blocked
  or when its confirmation is declined. Requests already dispatched cannot
  be recalled.
- Voice audio stays on the machine on Windows; on macOS Apple recognises on
  the device or on its servers under Apple's terms. With Muse Voice selected (paid; free OS dictation is the default), the recording goes to Meta's Muse Voice Transcribe while
  you record, and nowhere else.
- The paid features (web search, image generation, Muse Voice, Model API
  subagents, Auto reviewer, best-of-N and scheduled prompts) are available by
  default on Model API; nothing is billed before paid-use consent and budget
  admission. A repository cannot change their machine-scoped settings.
- Turn checkpoints keep the model's own file-tool bytes, including ignored
  files its tools change, under this extension profile's global storage,
  `checkpoints/<canonical-root-key>`, as described in the Panel section.
  The shadow repository and per-instance journals stay outside the
  workspace's `.git`; that folder is readable by your user only (on macOS
  and Linux). Copies stay on the machine and are removed by conversation
  retention or by removing that directory. Unreferenced file copies are swept
  after a one-hour grace period when no writer is live. Shared journal metadata remains
  until all its instance's units are retired. See **Turn
  checkpoints** in [The panel](#the-panel).
- Model API conversations are stored, per workspace, in VS Code's storage
  directory for the extension (not in the repository); ones idle longer than
  `museSpark.cleanupPeriodDays` (30 days by default) are deleted, and
  removing that directory deletes them all. The History dialog archives, it
  does not delete.
- A `/review` of git's changes sends their diff, the changed files' names
  and, for one commit, its message with the review turn, as a message would
  send them; environment files, keys and credentials are left out of the
  diff and only named. Reviewer system instructions omit git metadata; the
  review turn carries that material inside its untrusted markers. Date and
  workspace rules remain in the system prompt. The review pane and its Revert
  stay on this machine.
- The log records what happened (sessions, turns and their times, approvals,
  failures) and never your prompts, files, dictated words or the model's
  output; keys are redacted. A Model API MCP server's own stderr is logged
  line by line as the server writes it.
- For [Reporting a problem](#reporting-a-problem), each window keeps a
  small journal of failures in the extension's global storage: fixed event
  kinds, error codes, versions and frames inside the extension's own
  bundles, for 7 days and at most 256 KiB. It never holds prompts, code,
  model output, messages, absolute paths or credentials, and a report
  leaves the machine only through an export you choose. Details:
  [PRIVACY.md](docs/PRIVACY.md#reporting-a-problem).
- The usage insights read the Muse Code CLI's trace logs on this machine and
  send nothing anywhere.
- On the Model API backend Meta caches the start of each request to answer
  the next one faster and cheaper; the extension asks for the shorter
  `in_memory` retention by default. Only your machine-scoped
  `museSpark.modelApiPromptCacheRetention` setting can request up to 24 hours;
  a repository cannot extend your choice. The cache key is a digest of the
  model, instructions and tools it starts with, not a session or user id.
- Behind a corporate network the extension's requests use VS Code's proxy
  and certificate settings, and Muse Code gets the proxy and certificate
  variables described under [Proxies and certificates](#proxies-and-certificates).
- [Web fetch](#web-fetch) downloads the pages the model names from your
  machine and sends their text to the model like any other tool output. It
  asks first for each host on the Model API backend, except in Bypass, which
  asks nothing, and Plan refuses it; on Muse Code the extension asks before
  every fetch, whatever the mode. The full address goes to that site, so a URL the model
  writes can carry what the conversation holds; the approval names it whole.
  Only public `https://` addresses are fetched, the address checked is the
  address used, and the log names the host only.
- The [browser check](#browser-check) runs your page in Google's Chrome
  for Testing headless shell, downloaded from `storage.googleapis.com` after
  you agree (or by `museSpark.browserCheckRuntime`) and checked against the
  version this release pins, with a fresh private profile, never yours, over
  the browser's debugging pipe, never a network port. What the page shows,
  logs and requests goes to the model as tool output; on the Model API
  backend that includes a screenshot of the page, sent to Meta with the next
  request. All its traffic goes through the extension's own proxy, which
  passes plain `http` to this computer only, unless you widen a host; `https`
  and WebSockets to a widened host pass encrypted and unread, and a site
  there may sign in as you with this computer's account.
- Workspace rules, skill files and the memory snapshot are read only in a
  trusted workspace; on the Model API backend their text is part of what
  goes to Meta with each request, on the CLI backend Muse Code sends them
  under its own terms. The memory snapshot is each scope's `MEMORY.md` and
  its notes' names, your personal scopes included; a note's text goes only
  when the model reads it.
- The [bundled skills](#bundled-skills) are files of one pinned release,
  checked against its published SHA-256 when it is vendored, with each
  file's hash pinned by the tests; nothing is downloaded while it runs. Installing them for Muse Code writes
  only under Muse Code's config folder (`muse/skill-sources/` and links in
  `muse/skills/`), only when you click Install or Update or run the command,
  and Remove deletes only what carries the install's mark.
- The Model API backend's file tools resolve every path through the file
  system before touching it: a path that leaves the workspace, directly or
  through a link, is refused, and Windows names that would be reinterpreted
  (alternate data streams, device names, trailing dots) are refused too.
  Text reads and writes use the checked canonical target if a workspace
  link changes between the check and the operation. Paid image output is
  reserved at that same checked target before the API request.
  Its shell tool starts PowerShell or bash by absolute path with the
  environment VS Code's own terminal would give (the editor's internal
  variables removed). Stop and a timeout end everything a command started:
  its process group on macOS and Linux; on Windows the job object each
  command runs in, through a small helper the extension compiles once into
  its own storage with PowerShell's `Add-Type` (where policy forbids that,
  the log says so and a sweep of the process table stands in).
- Git and pull requests: commits and pushes go through VS Code's own Git;
  a push always asks and never forces. A pull request goes to
  `api.github.com` with the token of VS Code's GitHub sign-in, read for
  each call and never stored or logged; it carries only the title,
  description and branch names the form showed you, credential-shaped text
  masked. Someone else's pull request opens held: Plan mode, no project
  configuration, until you trust that worktree in the panel's card.
- The webview runs under a strict CSP (`default-src 'none'`, per-load script
  nonce, no remote origins, no inline styles); every message between host and
  webview is validated with a zod schema.

## Troubleshooting

- **What happened, in order** — **Muse Spark: Show Logs** opens the log.
  - **What it records:** every failure the panel or a popup showed, and
    anything that failed unseen, including an error inside the panel itself.
  - **With ids and times:** each session as it started, resumed or forked;
    each turn with its result, its duration and when its first output came;
    approvals; sign-in changes; and why the backend restarted.
  - **Kept out:** your prompts, files, dictated words and the model's output.
    Keys are redacted. A Model API MCP server's own stderr is logged as it
    writes it.
  - **More detail:** set the channel's level to **Trace** (the gear in the
    Output view) to see how long each Muse Code command and Model API
    request took.
- **A Model API request fails with "The server's certificate is not
  trusted"** — the network inspects HTTPS and re-signs it with its own
  root. Install that root in the operating system's certificate store and
  keep `http.systemCertificates` on, or turn `http.systemCertificates` off
  and name the root's file in `NODE_EXTRA_CA_CERTS` before starting VS
  Code; the variable does not help while that setting is on. Muse Code
  reads the system store too.
- **"The proxy asked for credentials"** or **"The proxy refused the
  connection (HTTP 403)"** — the proxy wants a sign-in VS Code did not give
  it, or does not allow `api.meta.ai`. Check `http.proxy` and
  `http.proxyAuthorization`, or ask for the host to be allowed.
- **Muse Code cannot reach Meta behind a proxy the browser uses** — the
  proxy comes from the system settings or a PAC file, which only VS Code
  reads. Set `http.proxy`, or `HTTPS_PROXY` in
  `museSpark.environmentVariables`, and the next message restarts Muse Code
  with it. **Muse Spark: Diagnostics** says where Muse Code's proxy comes
  from.
- **A permission mode is refused with "Muse Code's configuration … does not
  allow this permission mode"** — its default permission profile or a
  policy your administrator manages caps the modes; choose a stricter one.
  **Muse Spark: Diagnostics** prints `muse config status`.
- **A Model API reply ends with "sent nothing for 300 s"** — the stream
  stalled, so the turn was ended rather than left running until **Stop**.
  Send the message again to retry.
- **The agent says a file is too large (Model API backend)** — the file tools
  read and edit text and images up to 10 MiB and read PDFs up to 32 MB; the
  search tool skips files over 1 MiB. The agent can read part of a larger
  file with a shell command.
- **Sign-out does not finish, or the panel stays gated** — sign-out asks
  Muse Code to sign itself out (`account/logout`). Only when Muse Code
  still reads signed in afterwards does it open `muse logout` in a
  terminal, with `museSpark.environmentVariables`, so it signs out the
  same config home. With `META_API_KEY` set, Muse Code cannot confirm the
  logout itself; the extension then reads the sign-in again and opens no
  terminal once it shows none.
  - **Waiting for the terminal:** the panel stays gated, with **Check
    again**, until `muse logout` has run. That command leaves
    `~/.config/muse/auth.json` behind with no sign-in in it, and the
    extension reads that as signed out. Choose **Check again** once the
    terminal is done. If the terminal could not open, run `muse logout`
    yourself.
  - **An inherited `META_API_KEY`:** it stays outside the extension. Remove
    it from your environment or VS Code's configured environment variables,
    then choose **Check again**. Browser approval cannot override that key's
    billing priority.
  - **Sign-out protection could not be saved:** finish `muse logout` and
    remove `META_API_KEY` before reopening VS Code.
  - **The old CLI sign-in remains:** a fresh browser approval can replace
    it. The panel uses that sign-in only after Muse Code confirms it.
  - **The stored Model API key cannot be deleted:** sign-out stops this
    window's backend and keeps it gated until the key can be cleared.
- **The panel says Muse Code cannot start because its sign-in file is in
  the macOS format** — the `auth.json` it names came from a Mac: a
  version-2 file, or one whose sign-in lives in the Keychain. Muse Code
  1.4.0 on Windows and on Linux exits at startup with such a file, even an
  empty one. Move or rename the file, then sign in again. With
  `META_API_KEY` set, Muse Code starts anyway and uses the key.
- **The panel shows signed in on macOS, but the first message asks you to
  sign in** — on a Mac the token is in the login Keychain, and the
  extension asks Muse Code about it only when you act: a click in the
  panel (sign-in, sign-out, **Check again**), or the **Sign Out** or
  **Diagnostics** command. That goes for any `auth.json` on a Mac but the
  empty one a sign-out leaves, since what Muse Code 1.4.0 does there with
  another file has not been seen. A Keychain prompt never appears just
  because VS Code opened. Choose **Check again** to have Muse Code asked
  afresh now. **Muse Spark: Diagnostics** says whether the Keychain item exists,
  looked up without reading the secret; it also asks Muse Code for its
  sign-in, and Muse Code may read the Keychain to answer, which can show
  the Keychain's prompt.
- **Browser sign-in fails with "keychain write failed (internal error
  -2147483648)" on Windows or Linux** — Muse Code 1.4.0-R4161.1 could not
  save a sign-in there
  ([#38](https://github.com/meta-models/muse-code-sdk/issues/38),
  [#53](https://github.com/meta-models/muse-code-sdk/issues/53)). R4302.1
  fixed it, and Muse Code's launcher updates itself; 1.4.0-R4302.1 or later
  needs nothing more (**Muse Spark: Diagnostics** shows the version). Only
  if you are stuck on R4161.1: add `TBH_CREDENTIAL_BACKEND` with the value `file` to
  `museSpark.environmentVariables` and to the terminal you sign in from.
  That undocumented switch, which Meta's own SDK tests use, keeps the
  sign-in in `auth.json`. Remove it after updating, and never set it on
  macOS, where it hides a Keychain sign-in.
- **Every shell command fails with `sandbox enforcement unavailable`** — Muse
  Code runs commands inside an OS sandbox that needs a one-time administrator
  setup on Windows. The panel offers it in a notification ("Set up now"
  relaunches `muse sandbox windows setup` through the UAC prompt); the same
  flow is **Muse Spark: Set Up Shell Sandbox**. Start a new conversation
  afterwards. Linux and macOS need no setup.
- **"Muse Code's Windows sandbox is still being prepared"** (the command
  failed with `ACL publication lock … timed out`) — after the setup, Muse
  Code 1.4.2 gives its sandbox read access to your files once, in a
  background worker, and a command that needs that worker's lock gives up
  after two minutes. On a large user profile the worker can take a long
  time (over an hour on a test machine with many repository copies in the
  profile). Try again later; the setup is not needed again.
- **Shell commands run in `C:\Windows\System32\WindowsPowerShell\v1.0`
  instead of the project, or never finish** — Muse Code's Windows sandbox
  does not reliably run commands in folders under `C:\Users\<you>`
  ([meta-models/muse-code-sdk#26](https://github.com/meta-models/muse-code-sdk/issues/26)).
  1.3.0 and 1.4.0 started them in PowerShell's folder. 1.4.2 ran them in
  the project on one machine, but on a freshly set-up machine a sandboxed
  command there never finished, even after the worker above had run
  (2026-10-04). With `museSpark.shellSandbox` at `auto` the extension
  starts Muse Code without the sandbox for such workspaces: commands run
  directly as you, in the project, still gated by the approval cards, but
  Muse Code's file tools can then write anywhere without asking, and the
  panel warns once per window. A workspace outside your user profile (such
  as `C:\code`) keeps the sandbox. `muse` keeps the sandbox regardless
  (worth trying on 1.4.2 if commands run for you); `off` never sandboxes.
- **No Rename, conversation rewind or Side chat with Muse Code on Windows** —
  Muse Code refuses `session/rename` and `session/fork` on Windows (1.3.0,
  1.4.0 and 1.4.2-R4684.1, retested October 2;
  [#30](https://github.com/meta-models/muse-code-sdk/issues/30),
  [#31](https://github.com/meta-models/muse-code-sdk/issues/31)), so the
  panel does not offer fork-based actions there, whatever the version, until
  a release is verified to fix them; **Rewind code to here** still works
  (**Restore files to here** needs a Model API session on every platform),
  and the Model API backend offers all of them.
- **"Muse Code applies your approvals in this conversation but reports an
  error for each one"** — Muse Code on Windows can fail its own approval
  ledger after applying a decision ("approval ledger durability fence",
  [#29](https://github.com/meta-models/muse-code-sdk/issues/29)). Since
  1.4.2 it does this for every decision of a conversation that went through
  the fault below. The panel says so once. The card follows what Muse Code
  does next and is never offered again, because the decision applied. **New
  conversation** avoids the fault.
- **"Muse Code refuses every message in this conversation"** — Muse Code 1.4
  ("approval replay failed: decision stage evidence contains an unrecorded
  human resolution") fails every message of a conversation whose turn
  stopped while a multi-step command was partly approved. **Restart now**
  stops Muse Code, and your next message starts it again and continues the
  conversation. **New conversation** starts afresh. The panel now rejects
  the waiting step before a Stop, which keeps the conversation usable.
- **"Could not load the output: Muse Code did not answer item/readOutput
  within 180 s"** — a busy Muse Code answers stored-output reads one after
  another. The panel says it once per conversation; the row keeps the diff it
  already has, and collapsing and expanding the row asks again. An open row
  without a page also retries once when the turn ends. Automatic edit-row
  reads wait until then. At most four reads per panel go to Muse Code at a time, using
  the longer 180 s deadline so late replies can still supply the patch.
- **Muse Code is stuck, or slow and you want a fresh one** — run **Muse
  Spark: Restart Muse Code**. It stops `muse serve` and starts it again
  without reloading the window; a running turn is stopped, and each
  conversation continues with your next message.
- **"Muse Code is not answering. Restart it with "Muse Spark: Restart Muse
  Code"."** — three commands in a row went unanswered and nothing at all
  came from Muse Code for 90 s, so the panel stopped waiting 60 s for each
  one. When no turn was running, Muse Code was restarted already ("Muse Code
  stopped answering and was restarted."); while a turn runs, its notice
  offers **Restart now**, which stops the turn. If Muse Code answers again
  on its own, commands go through again.
- **"Muse Code did not confirm your message reached the running turn"** —
  the message was for the running turn, and Muse Code did not answer in
  time. It may still reach the turn, so it is not sent again; the composer
  keeps it. Look at the conversation before you send it again.
- **"This conversation's Muse Code log is damaged"** — Muse Code 1.4.2
  failed the session's event log ("event log failed: …"), after which it
  fails every message of that session. The panel refuses new messages to it
  instead and offers **New conversation**; the conversation stays in History
  to read, and is not resumed by itself after a restart.
- **Model API charges while using the CLI** — the extension never hands your
  pasted key to the CLI (the "muse serve credentials" line in the Muse Spark
  log says which credential it started with). If the CLI itself holds a
  pay-as-you-go key (`muse auth set`) or `META_API_KEY` is exported in your
  environment, the CLI uses it, exactly as Meta documents.
  The standalone ACP agent strips credential variables and gives Muse Code
  only allowlisted process, profile, configuration-home, proxy and
  certificate-path variables. Its provider keys stay in the OS credential
  store and are read when used.
- **The Agent map says delegation is off** — Muse Code hides its subagent
  tools until `run.subagent_delegation_mode` is `"auto"` in its own settings
  file; the map's button opens that file. The extension never edits it.
- **Muse never starts a workflow** — Muse Code's `run.workflow_trigger_mode`
  may be `off` (no workflow tool) or `explicit` (only when you ask); the
  Agent map says which and opens the settings file.
- **A workflow has no Cancel, Skip or Retry button** — this increment
  follows its progress read-only. Owner controls wait for a captured
  accepted-command and outcome shape from Muse Code.
- **The Muse Spark sidebar is blank in Eclipse Theia** — Theia 1.75 does not
  start an extension when its webview view opens, so the view waits until
  something else starts it. Press **Ctrl+Esc** or run any Muse Spark command
  (**Open in New Tab**, **Show Logs**) and the sidebar fills in; it works
  from then on in that window.
- **The microphone says "Voice dictation failed: No microphone is available"**
  — Windows sees no recording device from this session (Remote Desktop hides
  the host's devices unless the client redirects a microphone). On macOS,
  "Siri and Dictation are disabled" means Dictation must be switched on in
  System Settings > Keyboard.

## Reporting a problem

**Muse Spark: Report a Problem** builds a bug report for this repository
without recording your conversation. The panel opens the same dialog from
the palette's **Support** item **Report an issue…**, from **Report this** on
a recorded error notice or failed turn, and from **Report a problem** on the
panel's crash screen. With no conversation open, the command opens one and
shows the dialog there.

- **What goes in:** your description, support facts (versions, platform,
  backend and sandbox settings, whether the CLI was found and is signed in,
  whether a key is stored or `META_API_KEY` is set, the names of Muse Spark
  settings you changed) and up to the last 50 recorded failures with their
  ages. Each item has **Remove**. The preview shows the exact, scrubbed text
  every export uses.
- **Where it goes:** **Copy report**, **Open issue page** (this repository's
  new-issue form in your browser, filled in), **Save to a file**, or, where
  VS Code has it, **Use the VS Code issue reporter**. The extension posts
  nothing itself, makes no network or model call and has no GitHub access.
- **After a crash:** at its next start the extension offers once, "Muse
  Spark Code stopped unexpectedly last time — report it?". It cannot tell a
  crash from a killed process or a power loss, and it cannot see a crash in
  the moment after the extension starts, before its recorder has loaded.
- **Other editors:** `muse-spark-code-acp report` prints the same kind of
  report in a terminal ([docs/acp.md](docs/acp.md#report-a-problem-m93)).

What the recorder keeps, where, for how long, and what each export does:
[PRIVACY.md](docs/PRIVACY.md#reporting-a-problem).

## Headless and CI (M80)

The ACP package (`muse-spark-code-acp`) gains one-turn `exec`, a counts-only
`scan-secrets` command and versioned JSON/JSONL schemas. `action/` is a
same-repository GitHub review and fix Action, with an `action/apply`
sub-action. Their fake-only tests pass on Linux, macOS and Windows, and the
fake-only Action check passes on hosted runners (`action-check.yml`);
the first live receipt with a real key (LA, on a candidate package) passed on
2026-10-05, but L, and LR after a release, are still pending, so this is
**not certified yet**. The Action installs the agent from npm and checks its
provenance (0.12.0 is the first npm release with `exec`), or a candidate
tarball you pin (`agent-package` with `agent-package-sha256`).
[The CI guide](docs/ci.md) lists every option, exit code, bound and recipe.

```text
muse-spark-code-acp exec [options] <prompt>
muse-spark-code-acp exec [options] --prompt-file <path>
muse-spark-code-acp exec [options] -
muse-spark-code-acp scan-secrets <file> [--key-stdin]
```

One turn runs through the existing ACP engine. Plan is the default and
Accept edits the only other mode; trust, bypass and hosted search are refused.
Every ordinary approval is denied and questions are declined. A Model API run
stays untrusted, so it starts no shell, check, hook, MCP, Git or web-fetch tool
process. Muse Code exec uses the existing sign-in, never starts a login and
takes no USD budget.

`exec` takes one literal prompt, `--prompt-file <path>` or `-` for stdin, plus
up to eight `--untrusted-file <path>` resources. `--output` is `text`, `json`
or `jsonl`; `--timeout` is the process deadline. Model API requires
`--max-budget-usd` and accepts `--max-requests`, `--ephemeral` and
`--key-stdin`; without `--key-stdin` it reads the local OS store. The stdin key
stays in memory and conflicts with a stdin prompt. CI never runs `auth set` or
gives the agent a key environment variable.

Budgets are positive ASCII decimals up to $20 with at most six fractional
digits, parsed straight into integer micro-USD. At 32,768 output tokens the
minimum reservation is $0.108135 for the contributor model ($0.118135 with
images) and $1.409024 for standard ($1.419024). The contributor model needs
`--allow-contributor-models`; its content may be used for training under
Meta's contributor terms. `--image-generation` also needs
`--permission-mode acceptEdits`; images are off by default and tallied per
use. Each liability rounds upward. Missing receipts, transport loss,
cancellation and HTTP errors keep the full reservation. Only the latest
verified completed response plus ACP `end_turn` exits 0; unverified accounting
exits 9. Tool output text never leaves exec, and a cut-short agent message is
withheld whole.

`scan-secrets <file> [--key-stdin]` scans one bounded UTF-8 file locally,
prints only a count and exits 0 when clean, 10 on matches or 2 on refusal or
error. Its 30-second lifetime includes reading the key and flushing output.
Only known literals and patterns are covered.

On Windows a forced stop (an output pipe closed, or output still queued when
the cleanup grace runs out, or a distinct second signal's 300 ms grace ends)
terminates the process itself: process exit 1,
and buffered stdout/stderr may be lost. A result that was delivered keeps its
first-stop status, signal and logical exit code. Drained Windows exits and
POSIX keep the normal table. Standalone POSIX signal tests are skipped on
Windows.

The Action accepts triggers from OWNER, MEMBER and COLLABORATOR on
same-repository pull requests. Forks, bots, `pull_request_target`, public
self-hosted runners and a changed API head are refused before anything is
installed. It installs the agent before checkout and runs every Git child
through one sanitized runner. Only its launcher holds the key, and it passes
the key over stdin to exec and to the scanner. Only a completed run with exit 0
posts the sticky review comment or publishes a scanned text patch. Any binary
change (a generated image included) or detected secret withholds the whole
patch. Preparing and testing a patch and the maintainer-approved push are
separate jobs: read the proposal before you approve it. A candidate tarball is
unsigned and pinned by digest; a registry install checks npm 11.19.0's verified
bundles and the signer identity.

`npm run schema:exec` regenerates the
[result](docs/schemas/exec-result-v1.schema.json) and
[event](docs/schemas/exec-event-v1.schema.json) schemas, and `-- --check`
compares the committed bytes; both ship in the package's `schemas/`.
After the production build, `node scripts/package-acp.mjs` packs the ACP
tarball and `node scripts/package-acp-test.mjs` packs the private fake-only
test variant (`muse-spark-code-acp-test-<version>.tgz`, whose bin is
`dist/exec-test-launcher.js`). The test variant is never released.
`.github/workflows/action-check.yml` runs the Action against it with a
scripted fake Meta API: no key and no spend.
`.github/workflows/action-live.yml` is the one live check (receipt LA): the
repository owner starts it by hand to run the real Action, on the product
package from the same commit, against one pull request, with the real key,
the contributor model and a hard $0.25 budget.

See the [ACP guide](docs/acp.md), the [CI guide](docs/ci.md) and the
[M80 record](docs/certification/m80.md) for tests, deliberate breaks, platform
results and what is still open.

## Sharing

### Saved prompts

Right-click your own message, a history entry, the composer, or an editor's
selected text and choose **Save prompt**. History lets you choose the exact
user message first. **Prompt library** offers search, tags, edit, delete,
duplicate, import, share, and insertion. Scope labels distinguish **My prompts**
from workspace prompts; **Copy to my prompts** makes a personal copy.

The composer's compact **Prompt library** toolbar menu offers **Save prompt**,
**Share prompt** and **Use saved prompt…**. Right-click the input for the same
actions: VS Code uses its native menu; other shared-panel hosts open the compact
menu at the pointer. Save and Share appear only with nonblank text. Escape closes
the compact menu and returns focus to the input. Outside VS Code,
**Shift-right-click** retains the host's own clipboard menu; clipboard keyboard
shortcuts also remain available. Native/companion panel mounting still awaits M104.

Personal prompts live in the agent data folder, shared across workspaces and
editors on this machine. Workspace prompts live in `.muse/prompts/` and may
be committed to git. A saved personal prompt can be loaded in a fresh empty
workspace. **Use saved prompt…**, **Insert** and **Run with variables** review
variables and imported content, then fill the composer; they never send a
message. Save no secrets. Settings Sync mirrors personal prompts only when
`museSpark.syncPromptsAndBookmarks` is explicitly enabled globally. Turning it
on registers and merges the mirror immediately, even before opening the library.
Named variables accept whitespace inside `{{ name }}`; inserted values stay
literal, including text that looks like another variable. Prompt action failures
appear as error notices in the conversation.

Copy exports scrubbed text or Markdown. File export uses `.muse-prompt.md`
with versioned JSON front matter. Closing the prompt sharing UI cancels a pending
export, including one waiting on the Save dialog. Import from a file or a pasted public HTTPS
raw-file link (including a raw gist link) is capped at 128 KiB, shows the
whole prompt, declared variables and destination scope, and marks the result
untrusted. A gist web page is HTML, so use its raw-file URL. Publishing secret
gists is phase 2; node links, team libraries and email are phase 3.

### Sharing a chat

Use **Share** in the header or **Muse Spark: Share chat…**. Choose the whole
chat or inclusive message endpoints, then **Conversation only** or **Full
transcript**. Conversation only keeps user and assistant text; full includes
portable activity, commands, outcomes, shown decisions and reasoning. Code
blocks and attachment names start on; diffs and attachment contents start
off. Metadata-only history cannot recover attachment bytes or unseen patches;
unavailable selected content refuses instead of silently including it.

Choose Markdown, static self-contained HTML or versioned share JSON, then
copy, save or open locally in a browser. Review the exact scrubbed bytes and
highlighted redactions before **Confirm sharing**. Preview creates no file,
clipboard write or browser window. Files stay within the workspace or the
host's private sharing folder. This share JSON is distinct from a resumable
session export.

Sharing always removes recognized credential shapes, currently registered
secret values, account identifiers and private path prefixes. Workspace paths
become relative, home/user identities become markers, and other absolute paths
are redacted. Full mode keeps the same scrub. Unknown secret formats can
survive: inspect the preview. A confidential workspace refuses every share;
unavailable confidentiality policy also refuses.

The [ACP guide](docs/acp.md#local-prompts-and-sharing) covers the installed
CLI and ACP commands. VS Code-family editors use the shared React surfaces.
ACP saves/lists prompts and returns prepared text or exact share previews;
its final share button and composer insertion, native menus in JetBrains,
Visual Studio, Eclipse, Zed, Xcode, Neovim/Emacs/Sublime, and the companion
page wait for M104's bridge. The TUI waits for M110a0 lane T. The
[certification](docs/certification/m118.md) names each pending binding; shared
logic and fake adapter tests do not establish installed-editor parity.

## Development

`npm run schema:exec -- --check` checks the exec and sharing JSON schemas
against their production zod boundaries. `npm run schema:exec` regenerates
them. `npm run check:reference` checks the sharing command reference;
`node scripts/gen-reference.mjs` regenerates it from the same catalog `/help`
reads.

`node scripts/build.mjs --production --webview-only` builds the chat, Help and
What's New browser pages and their metafiles with production options and
stale-chunk cleanup; it omits the Node
bundles so browser tests stay within their default setup deadline.

After a production build, `node test/e2e/webviewDiet.mjs` checks optional UI
surfaces in Chrome against a fake host: no startup requests, first-use loading
under the shared CSP, and recovery from actual failed entry/static-dependency
fetches. Retry reloads the panel with its saved conversation and draft. Cold
menus remain dismissible and cannot take focus after dismissal.
The legal report and review comment form use the same loading and retry path.
Optional surfaces also load their shared English text on first use; startup
keeps first-paint text and the complete translated-table validation contract.
Surface and keyboard budgets follow the emitted production graph.

After every complete four-channel release, the workflow runs
`scripts/refresh-badges.mjs` to refresh these README badges and purge GitHub's
image-proxy copies. It needs no secret; stale caches or network failures warn
without failing publication. See [release CI](docs/ci.md#release-publication-and-readme-badges)
for propagation bounds and verification limits.

Marketplace/Open VSX and npm package READMEs receive static version badges from
`package.json` during packaging; this GitHub README keeps dynamic versions.
`npm run check:badges` checks all three pages' HTTPS image targets, the pinned
vsce SVG trust policy, exact package versions and public SVG responses (including
error badges). Screenshots remain PNG images. Both packagers also check the
exact staged README. Repository screenshots must exist in the checkout, and
PNG bytes must decode. The check reads public main's file inventory: newly added
screenshots are verified locally until main contains them; existing images still
require successful public HTTPS responses. CI always performs network checks; an offline local run
can set `BADGE_CHECK_SKIP_NETWORK` to a nonempty reason, which is printed and
skips only requests, for example:

```sh
BADGE_CHECK_SKIP_NETWORK='offline local verification' npm run check:badges
```

```bash
git clone https://github.com/RandyNorthrup/muse-spark-code.git
cd muse-spark-code
npm ci          # also installs the pre-commit hook (lint-staged + gitleaks)
```

Press **F5** to launch the Extension Development Host with a fresh build.
[CONTRIBUTING.md](CONTRIBUTING.md) has the rules for a pull request;
[SECURITY.md](SECURITY.md) the way to report a vulnerability.

**Bundled workflow package (M89).** `vendor/high-quality-projects-skill/`
contains the pinned v0.7.0 workflow assets and their MIT licence. To refresh
the pin, run `node scripts/sync-bundled-skills.mjs --tag v0.7.0` (substitute
the reviewed release tag), then `npm run notices`. The sync checks the
release's SHA-256 before replacing the package, rejects unsafe archive paths
and links, rejects case and trailing-dot/space filename collisions, and
records each file's path and SHA-256 in `VENDOR.json`. The vendor tests
check every recorded file hash. Vendored bytes
are excluded from formatting and linting; builds use them offline.
The delivery helpers require Python 3.12 or newer. See the
[vendor lane record](docs/certification/m89-vendor.md) for packaging checks.

**Prerequisites.**

- Node 22 or newer (`.npmrc` enforces `engine-strict`).
- [gitleaks](https://github.com/gitleaks/gitleaks) on `PATH` for the hook and
  `npm run security:secrets`.
- semgrep for `npm run security:sast`, at CI's version:
  `pip install -r .github/semgrep/requirements.txt`.
- Google Chrome (or `CHROME_PATH`) for `test:a11y`, `harness:shots` and
  `images`.
- On Windows, PSScriptAnalyzer 1.25.0 for `npm run lint`
  (`Install-Module PSScriptAnalyzer -RequiredVersion 1.25.0 -Scope CurrentUser`).

**Stack.** TypeScript 6.0.3 (pinned: `typescript-eslint` does not yet
support TS 7); the extension host bundled with esbuild to CommonJS, with the
Model API backend as a second bundle (`dist/modelApi.js`) that loads when
that backend first starts, the plan reader (the panel's Markdown
parser) as a third (`dist/planMarkdown.js`) that loads on the first plan
action. The review (git's material for `/review`, its turn text, the
Plan-mode hold and edit review) loads from `dist/review.js` on first use.
The conversation's Git adapter and the window's git and pull request
features (VS Code's git extension adapter, the GitHub client and sign-in,
the checkout) load from `dist/conversationGit.js` with the first
conversation or "Open a pull request in a conversation…" command.
The importer loads its UI adapter only on the first import. Node bundles
require the shared English fallback (`dist/uiText.js`), and each keeps
its own installed-language state. The webview is React 19 bundled to one IIFE with
its stylesheet; `zod/mini` validates every host ⇄ webview message; the voice
helpers are Windows PowerShell and Swift with no dependencies.

The session board and best-of-N implementation loads on its first action
from `dist/sessionBoard.js`. Paid Auto reviewer execution loads only after
consent from `dist/reviewer.js`, also shipped with the ACP agent. Ordinary
activation and an ordinary Model API turn load neither implementation.
Both receive the current display language. These bundles each have a 75 KiB
cap; the activation and Model API caps are 600/475 KiB. Code intelligence's

answers for Muse Code's `ide` tools load on the first call from
`dist/codeIntel.js` (100 KiB cap), both voice engines' drivers on the
first recording from `dist/voice.js` (50 KiB cap), and the window's web
fetch (each hop's checks and pins, the transport, the decoders) on the
first fetch from `dist/webFetch.js` (75 KiB cap); the tool lists and the
microphone's availability stay at activation. The Auto reviewer on Muse
Code (its side session, what follows a review, and the Model API reviewer's
core it reuses) loads on the first review from `dist/museCodeReviewer.js`
(75 KiB cap). After the M78b split the Model API bundle measured 402.8 KiB
and its cap was revisited to 475 KiB; the measurements and decision are
recorded in [the M78 certification](docs/certification/m78.md).

| Command                                   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build:dev`                       | Dev bundles for the extension, the Model API backend, the review, the search worker, web fetch's page converter worker, the webview and the integration tests, with source maps                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run watch`                           | Rebuild the extension, the Model API backend, the search worker, the page converter worker and the webview on change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run harness:shots`                   | Screenshots of the webview in headless Chrome behind a fake host (`test/harness/`), every scenario or the names you pass; needs `build:dev`. `--theme=dark`, `light`, `hc-dark` or `hc-light` uses a captured theme; `chat-menu-narrow` uses a true 320 px viewport. The README's screenshots refresh with `npm run readme:shots` (the mapping in `scripts/readme-shots.json`), captured at the mapped viewport size after the harness readiness scan into `media/readme/`: `tools-open` (as `turn.png`), `agents`, `slash-palette` (as `palette.png`), `slash-commands`, `approval`, `question`, `quote-menu` (as `quote.png`), `rewind`, `modes`, `history`, `usage`, `dictation` (as `voice.png`), `paid` and `paid-always`, the Languages section's is `usage --lang=de` (as `languages.png`), `readme-open-question` (as `open-question.png`) and `readme-help` (as `help.png`); the walkthrough's are `empty`, `tools`, `slash-palette` and `signin` (as `open.png`, `welcome.png`, `chat.png` and `sign-in.png` in `resources/walkthrough/`); `--lang=<id>` renders them in a table from `l10n/` (`--lang=pseudo` in the pseudo-locale)                                                                                 |
| `npm run harness:pseudo`                  | Write the pseudo-locale (`test/harness/l10n/ui.pseudo.json`): every string accented, bracketed and lengthened by about a third, with its slots kept, so English left outside the table and text that overflows stand out in `harness:shots --lang=pseudo`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run test:a11y`                       | The accessibility gate: axe-core checks every harness scenario in VS Code's four default themes against WCAG 2.2 AA and fails on any violation, on anything axe leaves undecided (except the contrast of text it could not see and of glyph-only content, which it counts), and on a page without a result or whose scenario threw; needs a build. `node scripts/capture-themes.mjs` refreshes the theme colours from a real VS Code; `--lang=<id>` checks the scenarios in a table from `l10n/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run images`                          | Render the Marketplace icon, the README banner and the social preview from their SVGs (headless Chrome)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run build`                           | Minified production bundles with chat, Models and What’s New sharing one browser splitting build, then enforces the size budgets in `scripts/check-bundle-size.mjs`, fails if the Model API backend's files, the review's, or web fetch's page converter (parse5 and its parts), are in the activation bundle, or an English fallback is in any Node bundle except its shared `dist/uiText.js` (`scripts/check-bundle-split.mjs`), or a host bundle reads `navigator`, and checks `THIRD_PARTY_NOTICES.txt` against the bundled packages. The provider catalogue keeps its exact JSON values in a CommonJS data module, staged through the existing verified Brotli runtime loader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run notices`                         | Regenerates `THIRD_PARTY_NOTICES.txt` from the production bundles                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run format` / `npm run format:check` | Prettier write / check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run lint`                            | `eslint --max-warnings=0` (type-aware), `stylelint --max-warnings=0`, and PSScriptAnalyzer 1.25.0 over `native/windows` (Windows only; a reported skip elsewhere)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run typecheck`                       | `tsc --noEmit` for the host, webview, unit-test, e2e-test and integration-test projects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run deadcode`                        | `knip`: unused files, exports (including namespace values and types), dependencies (no `--strict`; see `knip.jsonc`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run cycles`                          | `dpdm` circular-import check from the extension's, the Model API backend's, the webview's and the ACP agent's entry points                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run duplication`                     | `jscpd` copy-paste detection (threshold 0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run test:unit`                       | vitest with coverage thresholds (90 % statements/lines/functions, 85 % branches); includes `test/e2e/`, where a fake Muse Code CLI is spawned as a real child process (a compiled stub on Windows) and driven through the real backend manager                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run test:e2e:live`                   | Two real turns on the installed Muse Code CLI (a reply-only turn and M70's review turn held in Plan mode), opt-in with `MUSE_LIVE_E2E=1`; bills the signed-in subscription (25 to 45 model attempts measured for a reply-only turn: one for the answer, the rest for Muse Code's bundled reminder agents, which loop a varying number of times; budget 60 per turn, counted from the CLI's trace log); never in CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run test:e2e:live:modelapi`          | The Model API sweep: the production backend against Meta's real API in empty temporary workspaces, one case per feature (`-- -t case07` runs one); opt-in with `MUSE_LIVE_MODEL_API=1` and a key already stored by `muse-spark-code-acp auth set` in the OS credential store; key environment variables are rejected, contributor tier only; bills the key (about $0.03 a full run, $0.02 of it two images; it stops sending past $0.50); never in CI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run test:e2e:live:eval`              | The M75 paired efficiency evaluation: the twelve fixture tasks (seven accept, five held-out; two with a tool output long enough to pack) on the baseline and the observation packing arm (M73), on the extension's own Model API harness against Meta's real API, each in an empty temporary workspace, judged by a verifier that runs the fixed code; attempts counted from the requests sent, tokens, cost and pass rate per task, and the capability floors (0.75 per split); a packing run also fails unless it packed on every long-output task, and its report says so. Opt-in with `MUSE_LIVE_MODEL_API=1` and a key already stored by `muse-spark-code-acp auth set` in the OS credential store; key environment variables are rejected, the model's shell commands get no credential variable, the arms take turns going first, contributor model only; `MUSE_EVAL_TASKS` picks tasks, `MUSE_EVAL_REPORT=<path>` writes `<path>.json` and `.md`; run `npm run build:dev` first. Bills the key (the ten-task baseline measured 39 model calls and $0.0041; both arms on all twelve tasks measured 111 model calls and $0.0156 for M73; it stops sending past $0.50 or when a sent call has unknown usage); never in CI |
| `npm run test:integration`                | Builds, downloads VS Code stable and the `engines.vscode` floor into `.vscode-test/`, runs `test/integration/**` in each; after `npm run build:dev`, `npm run test:integration:run -- --label stable` (or `minimum`) runs one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run test`                            | Unit then integration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run security:audit`                  | `scripts/audit.mjs`: fails on a high or critical advisory without a dated, reviewed entry in `.github/audit-exceptions.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run security:sast`                   | `semgrep scan --config auto --error` through `scripts/sast.mjs`, which also finds a semgrep that pip put in Python's user Scripts folder when that folder is not on the shell's PATH                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run security:secrets`                | `gitleaks git` over the repository history                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:l10n`                      | The localization gate: every table in `l10n/` has every key of the English one (`src/shared/l10n/en.ts`) with the same `{slots}`, code spans and bold markers, exactly the plural forms its language uses, and nothing left in English but the names `l10n/untranslated.json` allows; every string `package.json` shows is a `%key%` of `package.nls.json`; and nothing reads `UI_TEXT` while its module loads. After packaging, `npm run check:l10n -- --packaged dist/vsix-package` applies the same strict checks to the shipped bytes and requires values identical to source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run check:host-api`                  | The host API gate (PLAN.md D60): checks `docs/ide-compatibility/host-api.md`, the record of every VS Code API the extension uses and where, the files that import `vscode`, the Node built-ins and what the webview needs from its host, against the source; fails when it is stale (`-- --write` regenerates it) and when the engine, the protocol, the webview or a portable host module reaches `vscode`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run quality:gates`                   | `format:check`, `lint`, `typecheck`, `check:l10n`, `check:host-api`, `deadcode`, `cycles`, `duplication`, `test:unit`, `build`, `security:audit`: what CI runs on all three platforms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run quality`                         | `quality:gates`, then `test:a11y`, `security:secrets` and `security:sast`; **exits non-zero on any finding**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run quality:ci`                      | `quality:gates`, `test:a11y`, then `test:integration` (no secrets or SAST); CI itself runs these as separate steps, see Releases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run package`                         | Build, stage only allowlisted files, validate compact JSON values, and package a short landing guide and recent notes → `.vsix`; it carries the macOS helper only if `bash native/darwin/build.sh` built it first, on a Mac                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run package:acp`                     | Production build, the committed exec schemas checked against `execProtocol.ts` (`scripts/exec-schema.mjs --check`), then `scripts/package-acp.mjs` → `dist/muse-spark-code-acp-<version>.tgz`, the ACP agent's npm package (`docs/acp.md`), with its own third-party notices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run package`                         | `npm run build`, then `scripts/package-vsix.mjs` stages allowlisted files, minifies JSON, solid-compresses runtime tables and lazy Node bundles with checksum verification, checks the shipped translations and native import/require exports against the unpacked build, and packs `.vsix` with a concise marketplace README and the newest two releases plus Unreleased (complete documentation stays linked). The unchanged compressed-size gate runs on the result; it carries the macOS helper only if `bash native/darwin/build.sh` built it first, on a Mac                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run package:acp`                     | Production build, the committed exec schemas checked against `execProtocol.ts` (`scripts/exec-schema.mjs --check`), then `scripts/package-acp.mjs` → `dist/muse-spark-code-acp-<version>.tgz`, the ACP agent's npm package (landing page: `docs/npm-readme.md`; guide: `docs/acp.md`), with the same bounded runtime archive, checked translations, native import/require checks of every Node module in the actual tarball, and its own third-party notices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run clean`                           | Remove `dist/` and `coverage/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The package localization check also runs directly as
`node scripts/check-l10n.mjs --packaged-acp dist/acp-package`; it compares every
decoded ACP language against the source JSON with the strict localization rules.
Manifest translations remain ordinary JSON for VS Code.
The VSIX package step uses Python's standard-library `zipfile` to apply maximum
DEFLATE compression after `vsce` creates the archive. Python 3 (`python3`,
`python` or `py`) is required, as for the semgrep toolchain. Unavailable launchers
are skipped, including Windows' Microsoft Store aliases. The step preserves
entry paths, metadata, every UI JSON value and all other uncompressed bytes.
Only packaged translation JSON whitespace is compacted; source tables stay
unchanged and malformed JSON refuses publication. The 2775 KiB universal VSIX budget covers the 0.15.0 feature set; individual bundle caps stay fixed.
The legal scanner's pinned data is embedded in its lazy bundle, with separate
notice/provenance files in both packages.

**Tests.** Unit tests (`test/unit/**`) run under vitest with `vscode` aliased
to `test/unit/mocks/vscode.ts` and webview components under jsdom; the fakes
in `test/unit/helpers/` implement the full VS Code interfaces. The e2e tests
(`test/e2e/**`) drive the real backend manager against a fake Muse Code CLI
that answers the Muse Session Protocol, including approvals, questions and
subagents. Integration tests (`test/integration/**`) run under mocha inside a
real VS Code launched by `@vscode/test-cli` (on Linux under `xvfb-run -a`),
against `test/fixtures/workspace/`. The host checks (`test/hosts/`, CI's
Hosts workflow) run development-extension integration tests in VSCodium,
packaged-extension browser checks in code-server and Eclipse Theia, and
the packaged ACP agent in JupyterLab, Emacs and Neovim, each against the
fake CLI. The Forks workflow installs the VSIX in the latest Cursor,
Devin Desktop, Kiro and Positron, then runs development-extension
integration tests there. `sh test/hosts/run-<host>.sh` runs one locally,
with the arguments its header gives.

**Quality gates.** Every gate fails the build rather than printing, and each
was seen to fail on a deliberate break before being trusted; the records are
in [`docs/certification/`](docs/certification/), one file per milestone.
Accessibility is a gate too: every screen the harness shows passes axe-core's
WCAG 2.2 AA rules in Light Modern, Dark Modern and both High Contrast themes
(PLAN.md D32); CI's full tier runs it once, on Linux. So is localization
(PLAN.md D33): text the user reads goes in the English table
`src/shared/l10n/en.ts`, read as `UI_TEXT.key` when the code runs. A
sentence around a value is a `{slot}` template filled with `fill`, and a
count is `forms({ one, other })` read with `plural`. Numbers and times go
through the `Intl` helpers beside them. Text for the model is `MODEL_TEXT`
and stays English. Escape hatches
(`eslint-disable`, `@ts-expect-error`, casts) need an inline reason and a row
in `PLAN.md` §8. Bundle budgets: 600 KiB for the extension, 475 KiB for the
Model API backend's own bundle, 225 KiB for the checkpoint store, 150 KiB for
the conversation's Git bundle, 125 KiB for
the shared English fallback (`dist/uiText.js`, also in the ACP package), 50 KiB for
the search worker, 300 KiB for
web fetch's page converter worker, 900 KiB for the webview's entry and all
static JavaScript imports, and 850 KiB for
the ACP agent (`dist/acp.js`).

The webview's Git panel loads when it has state to show; Account & usage
loads when opened. Both share React and the installed display language
with the main panel. Every generated browser chunk ships in the extension
and loads under its existing nonce-only script policy.

After a production build and an offline install of the ACP tarball,
`node scripts/check-ui-text.mjs <installed-package-root>` checks runtime
loading in the extension, Model API bundle and installed agent without
starting an editor or making a model call. It validates the complete installed
table and compares compact ACP help exactly in English and every shipped
translation. See the
[build record](docs/certification/shared-ui-text.md).

**Environment variables.** Credentials live in SecretStorage, never in
files. `.env.example` documents `META_API_KEY`, which the Muse Code CLI
inherits untouched if you export it yourself (and prefers over its sign-in,
as Meta documents); the extension never sets it. The tooling also reads
`MUSE_LIVE_E2E`, `MUSE_LIVE_MODEL_API`, `MUSE_EVAL_TASKS`,
`MUSE_EVAL_REPORT` and `CHROME_PATH`, as described above.

**Deferred-bundle drills.** `test/unit/deferredBundles.test.ts` builds its
checked Node entries once in memory. It shares the production plugins,
bundle declarations and callable split guard in
`scripts/lib/deferredBundles.mjs`; every injected split violation must be
rejected, then restored byte-exact and accepted. See the
[timing and gate-fire record](docs/certification/deflake4.md).

**Project structure.**

```
src/extension.ts            activation: the view, the panel, the commands, the output and file openers
src/host/                   VS Code-facing code: views and webview wiring, conversation, backend managers, the Model API bundle's entry, the search worker and web fetch's page converter worker (started for each page), commands, auth, settings, mentions, editor tracking, usage trace logs, voice, the diagnostics MCP server, the MCP servers' spawner, the network posture, the paid features' host side and the ide image tools, the bundled skills' Muse Code installer (its own bundle, loaded on first use), git and pull requests through VS Code's Git extension and GitHub sign-in
src/core/                   backend-agnostic logic, no `vscode` import: MSP host, Model API client and tools, the MCP client, rules/skills/memory, export, worktrees and held pull request worktrees, git and GitHub, usage insights, dictation driver, PDF and text attachments, the paid gate, Muse Voice, network failures
src/shared/                 constants + zod message protocol shared with the webview
src/shared/l10n/            the English table (en.ts), the fill, plural and Intl helpers, and the table checks
l10n/                       the translated tables (ui.<language>.json) and the gate's list of names left in English
package.nls.json            the manifest's text: commands, settings, the walkthrough
src/webview/                React app (own tsconfig, browser libs)
native/windows/             dictate.ps1 (dictation, System.Speech) and capture.ps1 (Muse Voice's recorder); MuseSparkJob.cs, MuseSparkMcpLauncher.cs, MuseSparkMcpJob.cs: the Windows job helpers' C#, compiled on first use
native/darwin/              Dictation.swift, Info.plist, build.sh, check-disclaim.sh: the macOS helper (built and checked in CI)
resources/walkthrough/      the Get Started walkthrough
test/unit/                  vitest tests, vscode mock, fakes
test/e2e/                   the fake Muse Code CLI and the tests that drive the real backend through it; the opt-in live suites
test/integration/           @vscode/test-cli suites
test/fixtures/workspace/    the workspace the integration tests open
test/harness/               the webview behind a fake host, for screenshots and the accessibility gate; themes/ holds VS Code's four default themes
test/hosts/                 the extension and the ACP agent in other editors (VSCodium, code-server, Theia, JupyterLab, Emacs, Neovim), one script per host
scripts/                    esbuild build; bundle-size, bundle-split, host-globals, notices, audit, PSScriptAnalyzer, accessibility, localization and host API gates; the pseudo-locale; theme capture, harness screenshots, image rendering; CHANGELOG notes and VS Code versions for the workflows; the ACP agent's package
docs/                       PRIVACY.md, and certification/: per-milestone gate-fire records
media/                      icons, banner, social preview, README screenshots
.github/                    workflows (ci, build, release, hosts, forks, action-check), issue and pull-request templates, audit exceptions, pinned semgrep, CODEOWNERS, Dependabot, FUNDING
```

**Releases.** CI (`ci.yml`: pull requests, merge-queue groups and optional
manual branch dispatches) calls `build.yml`. Once the merge queue is on, a
pull request runs its fast tier: the static gates of `quality:gates`, the
production build and every unit/e2e test on Ubuntu, with gitleaks and
semgrep. Everything else (the merge queue, manual runs, the release build,
and every pull request until the queue is on) runs the full tier:

- the static gates of `quality:gates` on Ubuntu, Windows and macOS;
- the unit/e2e tests in four shards per platform, merged before the coverage
  thresholds apply;
- the accessibility gate once on Ubuntu, and the integration tests (VS Code
  stable and the `engines.vscode` floor) on Ubuntu and Windows;
- gitleaks and semgrep, as jobs of their own;
- a job that compiles the macOS helper and checks its disclaim;
- a packaging job (Ubuntu) that packs the `.vsix` with both helpers as the
  `muse-spark-code-vsix` artifact, checks its compressed size budget, and
  packages the ACP agent with every locale table, and writes both CycloneDX
  inventories (the `muse-spark-code-sboms` artifact).

The seven required checks keep their names on both tiers (CONTRIBUTING.md,
"CI tiers and required checks").

A tag `v1.2.3` runs `release.yml`. It checks that the tag matches the
manifest and is on `main`, reuses successful own-repository CI artifacts only
when their recorded checkout tree equals the tag tree and all package versions
and SHA-256 hashes match, or runs the same full build on any miss. CI retains
the packages, inventories and source-tree receipt for 30 days;
`scripts/release-reuse.mjs` records, finds and verifies these release inputs.
The owner can force a rebuild with Actions variable `RELEASE_FORCE_REBUILD=true`.
Successful pull-request, merge-queue (`merge_group`) and main-push CI runs qualify
by their recorded checkout tree. Manual recovery on a version tag keeps
`artifacts_run_id`: the earlier Release build is validated, and its original
bytes pass through the same verification/staging job. Invalid recovery stops;
cancelled runs cannot publish. Older builds without a receipt retain inventory,
manifest and download-integrity checks; see the recovery guide for that limit.
An M80 `v0` tag update blocked by the release-tags ruleset is reported separately
as **admin move required**, preserving the release channels' outcomes. The
[release guide](docs/RELEASING.md#signing-and-the-prepared-m80-hooks) documents
the administrator's fast-forward recovery; the ruleset stays in place.
The workflow creates a GitHub Release with
that `.vsix`, the ACP tarball, both inventories, the exec schemas from `docs/schemas/` and `SHA256SUMS`, with the
CHANGELOG section as its notes and package provenance attestations. The same
VSIX goes to the Marketplace (publisher `RandyNorthrup`) and Open VSX; the same
ACP tarball goes to npm with provenance by npm trusted publishing: npm
trusts `release.yml` in the tag-only `marketplace` environment, so the npm
job reads no npm token. Marketplace and Open VSX use their tokens from that
environment (`VSCE_PAT`, `OVSX_PAT`); a missing token is reported as a
skip. Network errors get bounded retries;
already-published versions require matching artifact hashes/integrity. A final
summary reports every channel and fails if any channel failed. A `.vsix` packed
locally has no macOS helper, so only CI's universal artifact is published.
See [the release and recovery guide](docs/RELEASING.md) for half-published
states, npm EOTP, signing decisions and the M80 hooks (the schemas as
release assets and the Action's `v0` tag). A manual run of `release.yml` on
the tag with an earlier run's id publishes that run's tested packages
without rebuilding.

**Build troubleshooting.**

- **`npm ci` fails with an engine error** — Node 22+ is required.
- **Pre-commit hook says `gitleaks: command not found`** — install gitleaks
  (Windows: `winget install Gitleaks.Gitleaks`).
- **Type-aware lint rules stop reporting** — `npm ls typescript` must show
  6.0.x; TypeScript 7 is outside `typescript-eslint`'s peer range.
- **`npm run test:integration` cannot download VS Code** — the download goes
  to `.vscode-test/`; on a restricted network pre-populate the folder from
  another machine.
- **Webview is blank after a change** — run `npm run build:dev` (F5 does this
  via the pre-launch task) and reload the window.

#### M101 integration validation

`node scripts/m101-e.mjs --plan` prints lane E's live capture plan and call
estimate. `node scripts/m101-e.mjs --fake` runs request goldens, the fake
M75 pair and automatic-compaction/overflow checks in bounded batches. Lane E
owns the live receipt; production automatic compaction stays inactive until
its evaluated latch and paid admission are certified. The launcher's live
M75 mode uses the existing OS-stored key and bills that key.

PNG/JPEG images are resized before entering Model API replay when the selected
model record supplies vision support and documented pixel limits. The portable
worker preserves aspect ratio, never upscales, and bounds bytes, pixels, memory,
queue depth and runtime. Records without documented limits retain existing
image handling. Strict tool schemas follow the selected model record; named
Meta models use the owner's confirmed strict capability. Unknown or explicitly
false records keep strict mode off.

## How this extension is built

The conversation implementation loads when the first chat surface needs it. The
first opening includes that local load; commands and backend restart handling
remain registered at activation.
Node bundles share a core English fallback and generated runtime, hooks/import
and optional-surface regions. English regions load when a value is read; full
translation validation or webview table serialization reads every region.
The ACP agent loads the shared recorder before session initialization or reading
a report, retaining the same journal policy without embedding another copy.
Report and share dialogs load when opened, using the panel's loading/cancel
controls; the report returns focus to its opener even after its first load.

The package includes a short landing guide and recent release notes with links
to the complete docs. Translations and manifests are compacted in an isolated
build stage and checked against the original values before packaging.

Node bundles share the mini-validation runtime; each message keeps its original
schema. Account & usage loads its dialog when opened. Its loading modal can be
closed before the local script finishes loading.

The M95 integration build emits provider codecs and core as `dist/providers.js`,
the Models panel host as `dist/modelsPanel.js`, and its browser script and
stylesheet as `dist/webview/models.js` and `dist/webview/models.css`. The
production build checks their measured budgets and keeps provider code outside
activation and the Meta backend. Provider transport and final panel wiring
remain pending until the remaining M95 lanes are integrated. The host now
has an injected provider-registry seam: verified model output and effort limits,
priced/local/plan/unpriced accounting, provider-aware hooks and reasoning
replay filtering. Unverified model prices remain unknown; a dollar cap refuses
them. Auto review quotes the selected provider's card. These offline host
checks do not certify the pending production provider transport.
The accessibility gate uses Playwright to read real Chrome's axe results
across all four themes, with explicit standard and narrow viewports.
The conversation implementation loads when the first chat surface needs it. The
first opening includes that local load; commands and backend restart handling
remain registered at activation.
Node bundles share a core English fallback and generated runtime, hooks/import
and optional-surface regions. English regions load when a value is read; full
translation validation or webview table serialization reads every region.
The ACP agent loads the shared recorder before session initialization or reading
a report, retaining the same journal policy without embedding another copy.
Report and share dialogs load when opened, using the panel's loading/cancel
controls; the report returns focus to its opener even after its first load.

The extension is developed by a small team of AI agents under one human
owner. The process below has been in use since 2026-09-28. Each milestone's
record in `docs/certification/` says what was actually run for it; the
records of milestones before that date describe their own checks, which
sometimes differed (for example, M7 was certified against a fake server and
M44 took a response shape from Meta's documentation).

- **The owner** sets the plan (`PLAN.md`), makes the product decisions, and
  approves anything that spends money, signs in or publishes.
- **Claude Code** is the lead engineer: it turns the plan into briefs,
  builds the harder milestones itself (security-sensitive and stateful
  work), verifies every review finding in the code, and merges.
- **Muse Code, the product's own backend, builds too.** Up to four
  headless `muse exec` instances draft well-scoped milestones in their own
  git worktrees, on the Muse Spark contributor model; a Claude Code agent
  checks and finishes each draft, and it goes through the same review and
  gates.
- **Reviewers.** A change is reviewed before it is pushed, one defect class
  at a time (concurrency and lifecycle; wire evidence, validation and
  security; failure paths, honesty and docs), by **Grok Build** on a test
  machine (reading files and inspecting git only) or by Claude Code review
  agents. On the pull request, **Codex** reviews again. A finding is fixed
  with every sibling of its class in one commit, and a change that reaches
  a third review round is redesigned instead of patched.
- **Gates.** AGENTS.md requires `npm run quality` to exit 0 before a
  commit is proposed. Every commit is gated before it is pushed: one
  complete `npm run quality` run (formatting, lint, types, tests with
  coverage, the accessibility suite, the secret scan and semgrep) on one of
  three dedicated test machines (a Windows 11 virtual machine, a Kubuntu
  virtual machine and a Mac mini), so it never competes with the owner's
  workstation. The PowerShell lint runs only on Windows, so a change to a
  PowerShell script gets its run there. CI then runs `quality:gates` on
  Ubuntu, Windows and macOS, and the other gates as the jobs listed above.
  A milestone's new guards get red drills: each guard is broken on purpose,
  its test must fail, and the file is restored byte for byte; the record
  lists the drills and anything not drilled.
- **Evidence.** Under AGENTS.md rule 13, a shape parsed from Muse Code or
  the Model API is written from a live capture, and the record names it or
  says it did not have one. Live checks run on the contributor model in
  throwaway workspaces and record their model-call counts.

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

Production packages store UI translation tables with Brotli compression and
read them with a bounded decoder; source tables remain readable JSON. The
packaged localization check compares every decoded value with its source.
The shared production Node English fallback uses the same built-in compression.

The conversation implementation loads when the first chat surface needs it. The
first opening includes that local load; commands and backend restart handling
remain registered at activation.
Legal scanner limits: 20,000 files/directory entries, 1,000,000 UTF-8 bytes per
file, 10,000,000 bytes per scan, 100 findings per rule (500 total), and 120
seconds. Reaching a limit is reported as incomplete. License title and clause
matching remains heuristic; review the original terms before distribution.

Editor legal scans offer public npm/PyPI metadata lookup by default, after a
one-time notice naming each registry and explaining that only package names
and versions leave over HTTPS. Disable `museSpark.legalRegistryLookups` for
local-only scans; missing dependency licences remain unknown. Private registry
configuration is never contacted. CLI lookup still requires `--registry`.

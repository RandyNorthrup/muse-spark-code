# Muse Spark Code (Unofficial)

<p align="center">
  <img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/banner.png" alt="Muse Spark Code: Meta's Muse Spark as a coding agent in your editor" width="100%">
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code"><img alt="Marketplace version" src="https://img.shields.io/badge/Marketplace-v{version}-2b7de9"></a>
  <a href="https://open-vsx.org/extension/RandyNorthrup/muse-spark-code"><img alt="Open VSX version" src="https://img.shields.io/badge/Open%20VSX-v{version}-3b6"></a>
  <img alt="WCAG 2.2 AA checked" src="https://img.shields.io/badge/WCAG%202.2-AA%20checked-2b7de9">
  <img alt="15 languages" src="https://img.shields.io/badge/languages-15-2b7de9">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-green">
</p>

Meta's Muse Spark as a coding agent in VS Code and compatible editors: a chat
panel that streams answers, reads and edits files with reviewable diffs, runs
commands behind permission modes, and lets you watch and steer subagents.
Available on Windows, macOS and Linux, with English and 14 translated languages.

Unofficial. Not affiliated with or endorsed by Meta. “Muse Spark” and “Muse
Code” are Meta trademarks. You bring your own credentials.

[Enjoying Muse Spark Code? A star on GitHub helps other people find it.](https://github.com/RandyNorthrup/muse-spark-code)

**Contents:** [What's new](#whats-new-in-0160) · [Get started](#get-started) ·
[Work in the panel](#work-in-the-panel)

## What's new in 0.16.0

- **Loop guarantees.** Strict tool contracts, bounded hosted search and streamed
  argument previews help you follow Model API tool calls. Independent reads can
  run concurrently while their results keep call order. The loop bounds
  continuations, refuses cut-short tool execution and stops repeated unchanged
  calls. Structured side calls validate answers; headless runs can require a
  bounded final-answer schema. See [Agent loop guarantees](#agent-loop-guarantees)
  for capability gates and remaining native-reader qualifications.
- **CPU and memory thresholds.** Set machine-scoped limits to throttle new
  background work. Eligible queued tasks and checks can relocate through an
  existing approved device or runner route; other work stays local.
- **Disk floors.** Disk-heavy launches wait below the free-space floor and
  critical-volume writes refuse with a reason. Temporary cleanup requires
  recorded ownership and proved tree exit. See
  [Keeping your machine responsive](#keeping-your-machine-responsive) for the
  settings, available routes and remaining integration qualifications.

### Earlier in 0.15.0

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
  answer any time from its card or the open-question chip; **Dismiss** closes it
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

- **Tab completions** (see [Tab completions](https://github.com/RandyNorthrup/muse-spark-code#tab-completions)). Alt+\ invokes
  ghost text. First-use consent names the model price and the separate
  $1.00/day default hard budget; your stored Model API key pays on either backend.
- **Git and pull requests** (see [Git and pull requests](https://github.com/RandyNorthrup/muse-spark-code#git-and-pull-requests)).
  Draft a commit or PR in the conversation, commit and push with confirmation,
  and open a foreign PR in a held worktree until you confirm its trust card.
- **Hooks and plugins** (see [Hooks](https://github.com/RandyNorthrup/muse-spark-code#hooks)). Import popular agent hook formats,
  run Setup and Manual hooks on both backends, and use bounded Amp and OpenCode
  plugins on the Model API backend. Hooks keep their permission and paid-use limits.
- **Report a problem** (see [Reporting a problem](https://github.com/RandyNorthrup/muse-spark-code#reporting-a-problem)). Preview
  the exact scrubbed report, remove items, then copy, save or open an issue.
  The report is built locally and the extension sends nothing.
- **Muse Judge phase 1** (see [Muse Judge](https://github.com/RandyNorthrup/muse-spark-code#muse-judge)). The conversation model
  can add uncalibrated caution to an approval; it cannot grant permission.
  Model API Judge asks for paid-use consent and shares the durable daily budget.

Earlier releases are in the
[changelog](https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md).

## Get started

1. Open **Muse Spark** from the activity bar in a trusted workspace.
2. Sign in through the Muse Code CLI to use its subscription, or choose
   **Use an API key** for your own Meta Model API key and pay-as-you-go billing.
   The panel offers CLI installation when it is missing.
3. Ask for a change, review the edits, and approve commands when prompted.
   **Plan** asks the agent to plan before edits; Muse Code's own allow rules
   still apply. **Default**, **Auto**, **Accept edits** and
   **Bypass** offer the documented permission policies. Bypass removes ordinary
   approval prompts, so choose it only when you intend that behavior.

Requires VS Code engine 1.99 or newer. Muse Code signs in independently; a key
pasted into this extension is stored in VS Code SecretStorage and never given
to the CLI. Linux users can use the Model API if the CLI is unavailable.

## Work in the panel

- Open Usage & cost for journal totals, provider limits and budgets; ACP and CLI
  use the same local records and read-only companion page.

- Stream Markdown, code, reasoning and tool output; attach images or supported
  files, mention workspace context, and use slash commands and saved prompts.
- Resume, archive, rename, fork and export conversations; rewind conversation
  context or restore supported Model API file checkpoints.
- Review a branch, commit or uncommitted changes; accept, revert or comment on
  individual edits in the review pane.
- Follow goals, tasks, background commands, schedules, workflow runs, subagents
  and the session board. Compare best-of-N attempts in separate worktrees.
- Use project rules, custom agents, memory and bundled skills; fetch public web
  pages and check local web changes with a consented, isolated browser runtime.
- Dictate with the platform's speech service or opt into paid Muse Voice.
  Account & usage shows available account facts, request estimates and paid use.
- See What's New after an update and open its command or settings tips.

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
    <td align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/question.png" alt="A question pinned above the composer and also shown in the transcript: Colour and Toppings tabs, radio buttons, Other, disabled Submit, Explain instead and Cancel"><br><sub>Questions stay in the dock and transcript, with choices, Other and Explain instead</sub></td>
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

Backend capabilities and limits differ. The
[complete guide](https://github.com/RandyNorthrup/muse-spark-code/blob/main/README.md)
contains screenshots, every command and setting, editor setup, requirements,
permission details and troubleshooting. The
[ACP guide](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/acp.md)
covers other editors. Headless execution and the CI Action still have pending
live acceptance; their fake-only checks do not certify those live lanes.

## Billing and privacy

Muse Code uses its own credential and subscription. Ordinary Model API turns
are billed to your own key. Interactive Model API enhancements are available
by default, with explicit false settings respected; their paid calls still
need consent naming the price and shared daily budget. Paid use asks before
each call unless you choose **Allow always in this workspace**. The
subscription pays none of those extension-side paid features. ACP and
headless paid defaults remain off.

File/tool permissions and workspace trust still apply. The browser check
requires its own runtime consent and isolated browser; its privacy boundaries
are described in the guide. The extension has no analytics or tracking.
Read the [privacy policy](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/PRIVACY.md)
for storage, network and voice details.

[Release history](https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md) ·
[Report an issue](https://github.com/RandyNorthrup/muse-spark-code/issues) ·
[Source and license](https://github.com/RandyNorthrup/muse-spark-code)

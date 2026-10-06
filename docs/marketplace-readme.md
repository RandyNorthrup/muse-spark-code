# Muse Spark Code (Unofficial)

Meta's Muse Spark as a coding agent in VS Code and compatible editors, with
streamed chat, file edits, commands and reviewable diffs. Available on Windows,
macOS and Linux, in English and fourteen translated languages.

Unofficial. Not affiliated with or endorsed by Meta. “Muse Spark” and “Muse
Code” are Meta trademarks. You bring your own credentials.

[Enjoying Muse Spark Code? A star on GitHub helps other people find it.](https://github.com/RandyNorthrup/muse-spark-code)

## What's new in 0.14.0

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
3. Ask for a change, review edits, and approve commands when prompted.
   Permission modes control the agent's file and command access.

Requires VS Code engine 1.99 or newer. Muse Code signs in independently.
The extension stores your pasted Model API key in VS Code SecretStorage.
It never passes that stored key to the CLI.

## Work in the panel

- Stream Markdown, code, reasoning and tool output; attach supported files
  and images, mention workspace context, and use slash commands and prompts.
- Resume, archive, rename, fork and export conversations; rewind conversation
  context or restore supported Model API file checkpoints.
- Review branches, commits and uncommitted changes, and review individual edits.
- Follow goals, tasks, background commands, workflows, subagents and the session
  board; compare best-of-N attempts in separate worktrees.
- Use project rules, custom agents, memory, bundled skills and public web fetch.
- Dictate with the platform's speech service or opt into paid Muse Voice.
  Account & usage shows available account facts, estimates and paid use.

Backend capabilities differ. The
[complete guide](https://github.com/RandyNorthrup/muse-spark-code/blob/main/README.md)
contains screenshots, every command and setting, editor setup, requirements,
permission details and troubleshooting. The
[ACP guide](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/acp.md)
covers other editors. Headless execution and the CI Action have pending live
acceptance; fake-only checks do not certify those live lanes.

## Billing and privacy

Muse Code uses its own credential and subscription. Model API turns are billed
to your own key. Extension-side paid features are opt in, name their price, and
ask before use unless you choose **Allow always in this workspace**. The
subscription pays none of those paid features. File/tool permissions and
workspace trust still apply. The extension has no analytics or tracking.

Read the [privacy policy](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/PRIVACY.md)
for storage, network and voice details.

[Release history](https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md) ·
[Report an issue](https://github.com/RandyNorthrup/muse-spark-code/issues) ·
[Source and license](https://github.com/RandyNorthrup/muse-spark-code)

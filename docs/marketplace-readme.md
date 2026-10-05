# Muse Spark Code (Unofficial)

Meta's Muse Spark as a coding agent in VS Code and compatible editors: a chat
panel that streams answers, reads and edits files with reviewable diffs, runs
commands behind permission modes, and lets you watch and steer subagents.
Available on Windows, macOS and Linux, with English and 14 translated languages.

Unofficial. Not affiliated with or endorsed by Meta. “Muse Spark” and “Muse
Code” are Meta trademarks. You bring your own credentials.

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

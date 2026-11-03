# Claude Code and the Claude Agent SDK — research (2026-11-02)

Lane RSCH-CC, base `rv/int9` `72d8d5003dddee5adc6113671b5dfeeb385a2ddb`,
rig `linuxlt`. One of nine research lanes; this one stays on Claude Code.
A synthesis lane joins them.

## How to read this file

- **Measured** means run or counted on this rig on 2026-11-02 (CLI probe,
  `npm view`, tarball and clone inspection, GitHub search API, greps of
  our tree). **Read in code** means a source file or type declaration
  opened and cited. **Claimed** means a documentation or changelog page
  says it; the closed-source CLI could not be checked beyond its help
  text. **Inference** is labelled as such.
- Verdicts in §2: **ours is better**, **equal**, **worse**, **partial**,
  **missing**, **deliberately not** (with the decision, `Dxx` in PLAN.md).
  Our side is cited as `file:line` at the base above. “Our Muse Code
  backend” is the `muse serve` / MSP path; “our Model API backend” is the
  in-process engine in `src/core/backends/modelapi/`. Where the two differ,
  the row says so. A feature Claude Code gives us through the Muse Code
  backend does not close a Model API gap.
- No account was used, no model request was sent to Anthropic, and nothing
  was filed upstream. The CLI probe ran with `HOME` and
  `CLAUDE_CONFIG_DIR` pointed at the lane's throwaway `temp/cc-home/`,
  no sign-in.
- Open branches not on this base were checked before anything was called
  missing (2026-11-02): `git for-each-ref refs/heads/lanes` lists
  `lanes/cc-*` and `lanes/rlf-m104*`/`rlf-m109`; the ACP-team work is on
  `rv/acpteam` (`1739998fe`) and `rec/rlf-acpteam` (`57004781c`, 57 files
  over this base), MHP 1.6 on `rec/rlf-m111*` (e.g. `a297f6dcd`), and
  `fix/0190-nolimitsteam` exists. None of them adds deferred tool search,
  fork subagents, idle compaction, a script statusline, output styles or
  a Claude-format plugin loader, so the §2 verdicts stand; §2 notes where
  `rv/acpteam` narrows the ACP gap.

## Sources (every source, with date read and version)

All web and registry reads are 2026-11-02 unless a date is given.

| What                        | Where                                                                                                                                 | Version / commit read                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs index (228 pages)      | <https://code.claude.com/docs/llms.txt>                                                                                               | fetched 2026-11-02; 36 pages read in full from `…/docs/en/<page>.md` (listed in §1 notes)                                                     |
| Changelog (product)         | <https://code.claude.com/docs/en/changelog> and <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md> (raw, 9,800 lines) | 2.1.283–2.1.316 read line by line; 2.1.316 dated 2026-10-31                                                                                   |
| Issue tracker               | `api.github.com` search, `repo:anthropics/claude-code`                                                                                | 15,612 open issues at read time; top-30 by `+1` all-time, top-30 created since 2026-09-01 (12,177), top-20 closed since 2026-09-01 (§1.4)     |
| Agent SDK (TypeScript repo) | <https://github.com/anthropics/claude-agent-sdk-typescript>                                                                           | `3a0b748adbb1d31fa66a24a15df7e7c973fe1368` (changelog-only repo; no `src/`)                                                                   |
| Agent SDK (npm tarball)     | `@anthropic-ai/claude-agent-sdk`                                                                                                      | 0.3.310 unpacked (this repo's 7-day `min-release-age` refuses 0.3.316 on 2026-11-02; `sdk.d.ts`, 10,302 lines, read). Registry latest 0.3.316 |
| Agent SDK (Python repo)     | <https://github.com/anthropics/claude-agent-sdk-python>                                                                               | `d38e51e81dc770d2ff0edc302f781ef2c9670754` (real `src/`, MIT)                                                                                 |
| ACP adapter                 | <https://github.com/agentclientprotocol/claude-agent-acp> (moved from `zed-industries/`)                                              | `1e986b526d3f0448212c592a56fad59bea5138b3`, v0.100.0 (2026-11-02)                                                                             |
| CLI on this rig             | `~/.local/bin/claude`, throwaway HOME                                                                                                 | 2.1.310 (`--version`, `--help`, `plugin --help`); registry latest `@anthropic-ai/claude-code` 2.1.316                                         |
| Papers                      | arXiv / USENIX (abstracts read; CliffCompaction and CTXAgent methods read in HTML full text)                                          | §1.5                                                                                                                                          |
| Prior research in this repo | `docs/research/competitive-landscape-2026-09.md` (2026-09-27, Claude Code 2.1.269–2.1.283), `docs/research/agents-sdks-2026-10-30.md` | this file covers 2.1.283 forward and everything the September pass listed in one line                                                         |

**Licences.** Ideas in this file are described, never copied. Where a port
would be lawful, §2/§4 says so:

- Claude Code CLI: proprietary. `npm view @anthropic-ai/claude-code license`
  prints `SEE LICENSE IN README.md`; the GitHub repository carries no
  licence file (API `license: null`, 2026-11-02). No code may be taken
  from it. Its documented file formats (`SKILL.md`, agent frontmatter,
  `settings.json` hooks, plugin manifests) are interfaces: reading them
  is interoperability, which our M83 importer already does.
- `@anthropic-ai/claude-agent-sdk` (TS): Anthropic Commercial Terms of
  Service (`LICENSE.md` in the tarball). Do not vendor its code; depending
  on it as a library to _drive Claude_ is the use it is sold for, but it
  cannot drive Muse or Model API models, so it has no role in our
  backends (§3, “what not to do”).
- `claude-agent-sdk-python`: MIT. Code may be ported with attribution.
- `@agentclientprotocol/claude-agent-acp`: Apache-2.0. Its ACP mapping
  designs (subagent child sessions, AIR extensions) may be ported with
  attribution and `NOTICE` handling; §4 cites it where relevant.
- `@anthropic-ai/sandbox-runtime`: open source per the sandboxing docs
  page (claimed; the repository licence was not re-read this lane —
  verify before any dependency decision).
- Papers: arXiv CC-BY where marked (CliffCompaction, Same Model Different
  Harness, CTXAgent show the CC-BY icon on their abs pages). Reimplement
  the methods; quote numbers with the citation.

**What could not be verified.**

- GitHub Discussions for `anthropics/claude-code`: the REST discussions
  endpoint returned `410` on 2026-11-02 and unauthenticated search hit
  its rate limit mid-lane, so discussion reaction counts and the last
  label tallies (`worktree`, `sandbox`) are unverified. The issue numbers
  in §1.4 are the search API's own counts before the limit.
- Desktop, web (claude.ai/code), mobile and Slack surfaces need an
  Anthropic account; they were read from docs and changelog only, and
  §2 marks those rows claimed.
- The Agent SDK 0.3.316 type surface: read through its changelog; the
  tarball read is 0.3.310 (release-age gate above). Six patch releases
  of drift are possible in details, not in shape.
- Anthropic's “removed over 80% of Claude Code's system prompt” claim
  (July 2026 blog, via secondary summaries found in search) was not read
  at the source this lane; §1.5 treats it as claimed, not measured.
- No Claude model was run, so every quality claim about Claude Code's
  _models_ (as opposed to its harness) is out of scope and untested here.

---

## 1. What is new, or what we had not read

### 1.1 The shape of the product at 2.1.316 (2026-10-31)

Read: `overview`, `how-claude-code-works`, `features-overview`,
`claude-directory`, `platforms`, `feature-availability` (docs, 2026-11-02).

Claude Code is one harness on many surfaces: terminal CLI (native
installer, Homebrew `claude-code` stable / `@latest`, WinGet), VS Code
and JetBrains extensions, a desktop app (macOS, Windows, Linux beta,
WSL), the web (claude.ai/code, “cloud sessions”), mobile (start/monitor/
steer), Slack (Claude Tag, plus the older mentions-only app), Chrome
extension, and headless (`claude -p`, Agent SDK, GitHub Actions, GitLab
CI). The extension points, in the docs' own precedence story
(`features-overview`): `CLAUDE.md`/`AGENTS.md` + path-scoped rules,
skills (which now subsume custom slash commands), subagents, hooks, MCP,
plugins (a directory bundling all of the above plus monitors and,
new since September, in-process JavaScript “mods”), and marketplaces
(catalogues of plugins). Everything under `.claude/` in the project and
`~/.claude/` for the person; managed (organization) and server-managed
settings sit above both.

Three structural facts matter for us and were not in the September pass
at this resolution:

1. **The harness is cache-shaped first.** The prompt-caching page
   documents three layers (system prompt, project context, conversation)
   and a long table of what invalidates each. Features are visibly
   designed around it: tool search exists so MCP changes don't break the
   prefix; plugin loads append after the conversation instead of
   rebuilding the prefix; disabling a plugin restores the earlier
   request shape so the older cache entry can still hit; idle
   compaction (§1.2) exists to beat the one-hour cache TTL. (§1.3.)
2. **Auto mode is now the default interactive mode** (2.1.283, every
   plan and provider in terminal and VS Code): a separate classifier
   model (Sonnet 5 by default; server-side where Anthropic serves it,
   client-side elsewhere, model choosable since 2.1.302) reviews each
   action and only prompts when it cannot decide. Deny/ask rules and
   protected-path rules still win over it. This is the centre of gravity
   of the 2.1.283–2.1.316 changelog: most fixes are classifier, prompt
   or compaction edge cases.
3. **Parallelism has four rungs, each with a different owner:**
   subagents (Claude delegates, summary returns), agent view / background
   sessions (the person dispatches and supervises many sessions),
   agent teams (peer sessions, shared task list, mailbox files;
   experimental), and dynamic workflows (a JavaScript script Claude
   writes orchestrates subagents; the script, not a context window,
   holds the loop). Plus Projects (cloud, one conversation fanning out
   to parallel cloud sessions). The `agents` page compares them in one
   table; §1.3 gives the mechanics.

### 1.2 Changelog 2.1.283 → 2.1.316: what actually changed

Read in full from the GitHub `CHANGELOG.md` (2026-11-02). What follows is
only what changes a harness decision for us; the hundreds of UI fixes
are omitted. Version in brackets.

**Compaction and the cache (the busiest area).**

- _Idle compaction_ [2.1.299 terminal; 2.1.314 VS Code/Desktop;
  `/config` toggle 2.1.302]: a conversation over 200K tokens left idle
  ~54 minutes is summarized _before_ its one-hour cache expires, so the
  next message doesn't reprocess the whole history uncached. Tunable
  (`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`, `idleCompaction: false`).
- Per-subagent `autoCompactWindow` frontmatter [2.1.296];
  `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` [2.1.296];
  `CLAUDE_CODE_SUBAGENT_EFFORT` [2.1.316]; `effort` parameter on the
  Agent tool [2.1.292].
- `PreCompact` hook output capped at 10,000 characters after a large
  output made compaction fail or repeat [2.1.314] — a failure mode to
  copy the _guard_ from, not the bug.
- A steady drumbeat of compaction correctness fixes: stale
  `MEMORY.md`/`CLAUDE.md` after compaction [2.1.311], resume losing
  kept messages or resurrecting pre-compaction history [2.1.300],
  “Autocompact is thrashing” on large tool results [2.1.307], compaction
  keeping too much dense text (base64/SVG) [2.1.310]. Inference:
  summary-based compaction is their most fragile subsystem; §1.5's
  papers say why and what beats it.

**Permissions, classifier, sandbox.**

- `permissions.blockWritesOutsideWorkingDirectories` [2.1.314]:
  Write/Edit/NotebookEdit refuse outside working directories in _every_
  mode (the read twin predates this window). SDK adds
  `blockReadsExemptPaths` [0.3.316].
- `CLAUDE_CODE_AUTO_MODE_MODEL` [2.1.302]; `/auto-mode-setup` reads the
  project and recent sessions to teach the classifier the environment
  [2.1.304, widened since]; `classifier_verdict`/`permission_mode` on
  OTel `tool_decision` events [2.1.301]; a `claude_code.safety_event`
  OTel event added [2.1.307] then _stopped_ [2.1.312] — telemetry churn
  to learn from, not copy.
- Hook `onFailure: "block"` [2.1.295]: a hook that cannot start, times
  out, or exits unexpectedly blocks instead of failing open. Prompt/agent
  hook concurrency bounded (12 per event [2.1.302], then 24 + 12
  long-waited [2.1.312]); `updatedInput` from hooks validated like model
  input, unknown keys dropped [2.1.300]; skill-hook registration bounded
  per source [2.1.304]. All are “untrusted extension” hardening; §2
  compares ours line by line.
- Sandbox: `allowNestedUserNamespaces` [2.1.305] (with the honest warning
  that it lets commands escape file protections); sandbox still
  **off by default** and shell-only (docs, §1.3).
- Model fallback on refusal: flagged requests retry on another model
  instead of ending in refusal where policy leaves an older Opus
  [2.1.314]; custom deployment names covered [2.1.312];
  `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1` opts out. Foundry falls back
  within the family when a deployment is missing [2.1.314].
- Fast mode for Opus 4.8 deprecated 2026-10-30, removed 2026-11-30, and
  after removal requests _error_ rather than fall back [2.1.316] — the
  anti-pattern (silent capability cliff) our capability records avoid.

**Agents, workflows, background work.**

- Fork subagents (`subagent_type: "fork"`) on by default in `-p`, SDK,
  Desktop and VS Code [2.1.302]; desktop/VS Code always run main-thread
  subagents in the background [2.1.302]; concurrent forks told which
  launch is theirs [2.1.307]; `SubagentStop` firing ~twice a minute per
  running subagent fixed [2.1.311] — check ours (§2).
- Claude Mods [2.1.287]: a plugin may ship a JavaScript hooks module
  that runs _inside_ Claude Code, draws panes, registers tools
  (`$.tool.register`, `isDeferred`), hooks `agent.spawn`/`tool.check`/
  `prompt.submit`/`turn.step` and more; a built-in mod (“You should
  know”) runs a side agent that flags misses. The next 30 releases are
  full of mod API growth _and_ mod containment fixes (managed rules
  enforced against user mods [2.1.299], gating-hook failure semantics
  [2.1.299/2.1.301], nesting-depth refusal [2.1.299]). This is the
  single largest new surface since September, and the riskiest (§3).
- Monitor tool + plugin monitors on Bedrock/Vertex/Foundry [2.1.310];
  headless `-p` metering complaint (§1.4) sits next to a run of
  `-p`-waits-forever fixes (stderr “waiting for” line [2.1.295]).

**MCP.**

- Tool search on by default behind a custom `ANTHROPIC_BASE_URL`, with
  retry-without on gateway 400/422 [2.1.304]; description limits raised
  (2,048 → 4,096 upfront; 16,384 via search) [2.1.296]; MCP protocol
  `2026-07-28` negotiated by default for cloud/Remote-Control
  connectors [2.1.299] and tolerated when servers omit new fields
  [2.1.302]; URL-mode elicitation prompts [2.1.287] with a
  `bareElicitationCapability` escape hatch for servers that broke;
  `/mcp reconnect all` [2.1.284]; allow-rule scoping fixed so
  `mcp__a` no longer allows server `a__b` [2.1.299] — a naming-collision
  class worth auditing in ours (§2).

**Models and effort.** Sonnet 5.5 [2.1.284], Haiku 5.5 [2.1.293]
(1M context); `ultrathink` runs its turn at `xhigh` [2.1.311, VS Code
2.1.316] and can be disabled [2.1.316]; effort changes keep the cache on
current models (docs §1.3); `/model <id>` warns when auto-compact will
assume 200K for an unrecognized model [2.1.316].

### 1.3 Mechanism notes (docs and SDK types, read 2026-11-02)

Pages read in full: `sub-agents`, `agent-teams`, `workflows`, `hooks`,
`skills`, `checkpointing`, `memory`, `permission-modes`, `permissions`,
`sandboxing`, `prompt-caching`, `context-window`, `model-config`,
`mcp`, `sessions`, `output-styles`, `statusline`, `worktrees`, `goal`,
`scheduled-tasks`, `routines`, `headless`, `tools-reference`,
`commands`, `settings`, `agent-view`, `agents`, `channels`,
`code-review-local`, `ultrareview`, `vs-code`, `desktop`,
`remote-control`, `plugins/overview`, `plugins/components`,
`plugin-evals`. SDK facts are from `sdk.d.ts` 0.3.310 (read in code).

- **Subagents.** Own context, own system prompt, tool allowlist,
  independent permissions; the parent gets a summary. Built-ins:
  Explore (read-only, thoroughness levels, no `CLAUDE.md`/git snapshot
  for speed), Plan (read-only, plan-mode research), general-purpose,
  plus `statusline-setup` and `claude-code-guide` helpers. Custom agents
  are Markdown + frontmatter (model, tools, effort, `omitClaudeMd`,
  hooks, memory scope, `autoCompactWindow`, …); combined non-built-in
  descriptions over 15,000 tokens warn at startup. **Fork** inherits the
  parent's full history (and auto memory) instead of starting fresh —
  the “side quest without re-explaining” primitive. Subagents can run
  in a worktree (`isolation`) and keep per-agent persistent memory.
- **Agent teams (experimental, off by default).** A lead session spawns
  teammate _sessions_ (in-process, or tmux/iTerm2 panes); coordination
  is a shared task list (pending/in-progress/completed, dependencies;
  teammates don't self-claim — the lead assigns) plus per-agent mailbox
  JSON files under `~/.claude/teams/<team>/inboxes/`, validated on read,
  with structured protocol messages (plan approval, shutdown). Docs list
  the limits plainly: no split panes in VS Code's terminal/Windows
  Terminal/Ghostty, orphaned tmux sessions need manual cleanup.
- **Dynamic workflows.** Claude writes a JS script (`meta` literal +
  body calling `agent()`/`parallel()`/`pipeline()`-style primitives);
  a runtime executes it in the background; runs can pause/resume, be
  saved as `/name` commands (`.claude/workflows/`, or via plugins,
  namespaced), take structured `args`, and are approved before first
  run (with “don't ask again for this workflow in this project”).
  Bundled `/deep-research` is a workflow. In auto mode, a workflow
  script's agent prompts don't count as the person's request to the
  classifier (marked as script-computed) — a subtle provenance rule.
  “Ultracode” = effort setting where Claude reaches for workflows by
  default.
- **Hooks.** 33 events (SDK `HookEvent` union, read in code:
  `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`,
  `Notification`, `UserPromptSubmit`, `UserPromptExpansion`,
  `SessionStart`, `SessionEnd`, `Stop`, `StopFailure`,
  `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`,
  `PreModelSwitch`, `PostModelSwitch`, `PermissionRequest`,
  `PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`,
  `TaskCompleted`, `Elicitation`, `ElicitationResult`, `ConfigChange`,
  `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`,
  `CwdChanged`, `FileChanged`, `DirectoryAdded`, `MessageDisplay`).
  Five handler kinds: `command` (stdin JSON, exit codes), `http`,
  `mcp_tool`, `prompt` (one model call, JSON verdict), `agent` (a
  subagent with tools). Matcher regexes, `if` conditions in permission
  syntax (`Bash(git *)`), per-handler `timeout`, `onFailure`, async
  hooks, hooks in skill/agent frontmatter (session-scoped), `/hooks`
  menu. Hooks from settings/plugins also fire inside subagents, with
  `agent_id`/`agent_type` on the input.
- **Skills.** `SKILL.md` + frontmatter; catalogue (name+description)
  always in context, body on invocation; `context: fork` runs the skill
  in a subagent; dynamic context injection (shell snippets expanded
  before Claude sees them, gated by `UserPromptSubmit` hooks since
  2.1.299); per-skill `allowed-tools`, model/effort overrides, hooks;
  bundled skills (`/deep-research`, `/code-review`, `claude-api`, …);
  `/reload-skills`; skill bodies re-injected after compaction within a
  budget (oldest dropped). A skill/command whose file name carries
  hidden/bidi/blank-like characters is no longer offered [2.1.299] —
  the same “characters that hide” class our agent parser refuses (§2).
- **Plugins and marketplaces.** A plugin directory (`.claude-plugin/
plugin.json`) bundles skills, agents, hooks, MCP servers (incl.
  `.mcpb`), output styles, monitors, workflows, themes, mods.
  Marketplaces are git/npm/URL catalogues (`marketplace.json`);
  install scopes (user/project/local/managed), dependencies with semver
  ranges and pruning, `claude plugin validate` (static + “advice”,
  never changes exit code for advice under `--strict`), `claude plugin
eval` (YAML cases + graders, no-plugin baseline arm, CI gating —
  measured in `plugin --help` on this rig), `plugin details` (component
  inventory + projected token cost), plugin options (`configure`,
  install-time `--config`), Node dependency auto-install into
  `~/.claude/plugins/data/<id>/`. Anthropic runs official + community
  marketplaces; the security page is explicit that a plugin is code on
  your machine.
- **Checkpoints / `/rewind`.** Automatic per-prompt snapshots of files
  _Claude's file tools edited_; rewind menu restores conversation,
  code, or both, and can summarize from a point. Measured limits from
  the docs (claimed, but stated as limits): Bash-only changes to a file
  Claude never edited are **not tracked**; most subagent edits are
  **not captured** (only foreground forked skills are); external changes
  not tracked; symlink/hardlink paths skipped with a warning; snapshots
  swept after ~30 days; `sed -i` no longer restored [2.1.309]. SDK:
  `enableFileCheckpointing` + `Query.rewindFiles()` with dry-run and a
  link-safety refusal count (read in `sdk.d.ts`).
- **Plan mode.** Read-only exploration (Plan subagent), plan presented
  for approval (`ExitPlanMode`), modes cycled with Shift+Tab; plan can
  use classifier-approved commands when auto is available; approving a
  plan can clear context (the ACP adapter had to fix usage reporting
  for exactly this). A one-time note warns when plan won't ask because
  bypass is available [2.1.299].
- **Permissions.** Six modes (`default`/Manual, `acceptEdits`, `plan`,
  `auto`, `dontAsk`, `bypassPermissions` — SDK `PermissionMode`, read
  in code) layered with allow/ask/deny rules in `Tool(specifier)`
  syntax; deny wins everywhere including bypass; protected paths never
  auto-approved except bypass; critical-path `rm` handling no allow
  rule or hook can approve; `/permissions` UI with a “Recently blocked”
  review tab that refuses to approve a call you can't read in full
  [2.1.314]. Auto-mode decision order: rules → classifier (server-side
  where offered, else client requests to Sonnet 5 default) → prompt on
  “cannot decide”; _no verdict = deny_. Classifier also reviews
  `SendMessage` agent-to-agent messages.
- **Sandbox.** Bash-tool only, off by default: macOS Seatbelt,
  Linux/WSL2 bubblewrap + socat, via `@anthropic-ai/sandbox-runtime`.
  Writes confined to cwd + temp; reads default to _most of the machine
  including `~/.ssh`_ unless `denyRead`/`credentials` say otherwise;
  network only through a local proxy with an allowlist that starts
  empty; env inherited (secrets included) unless scrubbed. File/web
  tools, hooks, MCP servers, LSP servers run **outside** it; the docs
  tell you to containerize the whole process for one boundary.
  Fail-open by default when the sandbox can't start
  (`sandbox.failIfUnavailable` opts into fail-closed). No native
  Windows sandbox in the docs' matrix (WSL2 is the path) — compare our
  Muse Code Windows sandbox (§2).
- **Memory.** `CLAUDE.md` hierarchy (managed → user → project →
  local), `AGENTS.md` read natively (closed issue #34235, §1.4;
  `CLAUDE.md` wins per-directory — note ours is the reverse, §2),
  `@import`, path-scoped rules (`.claude/rules/` with `paths:`), 200-line
  guidance, 4 MiB skip. **Auto memory**: Claude writes typed notes
  (`user`/`feedback`/`project`/`reference` frontmatter) to
  `~/.claude/projects/<project>/memory/` with a `MEMORY.md` index whose
  first 200 lines / 25 KB load every session; shared across worktrees
  of one repo; machine-local; excluded from the transcript retention
  sweep; `/memory` browses it. Project-root `CLAUDE.md` edits
  mid-session _don't apply_ until next session (cache) — path-scoped
  rules and nested files load on touch but are summarized away by
  compaction (docs say so explicitly).
- **Compaction & context.** Auto-compact near the model's threshold
  (`/autocompact <tokens>`, per-model defaults), manual `/compact
[focus]`, `/clear`. Survival table: system prompt, root `CLAUDE.md`,
  MCP instructions reload; invoked skill bodies re-inject within a cap;
  up to five recently-touched files re-read (over 5,000 tokens → path
  reference only); `SessionStart` hooks with `compact` source re-run.
  Summarization inherits thinking config since 2.1.198, retries once
  when the reply has no summary [2.1.311]. `/context` shows the budget.
- **Prompt caching.** Prefix layers as above; 5-minute TTL, 1-hour TTL
  at higher write price; cache isolated per organization (per workspace
  on some providers); model switch, tool-set change (without tool
  search), and compaction invalidate; effort change no longer does on
  current models; `/usage` and OTel expose read/creation tokens
  (split 5m/1h since 2.1.300). Anthropic's April 2026 “prompt caching
  is everything” write-up (secondary summaries; claimed) states the
  design rule: stable first, dynamic last, append state as messages,
  never edit the system prompt mid-session. Our D43/D81 prefix work is
  the same rule on a different API (§2).
- **MCP.** Transports: stdio, streamable HTTP, SSE (deprecated path),
  WebSocket; scopes (local/project/user/managed, `.mcp.json`, claude.ai
  connectors, Claude Desktop import); OAuth with re-auth on scope
  increase [2.1.288]; elicitation form + URL (dialogs, `Elicitation`
  hook auto-answers; non-interactive sessions cancel the task without
  hooks/`onElicitation`); resources as `@`-mentions; prompts as slash
  commands; `claude mcp serve` (Claude Code as a server, no fork
  subagents there); output warning at 10K tokens, cap 25K default
  (`MAX_MCP_OUTPUT_TOKENS`); **tool search**: only names + server
  instructions upfront, schemas deferred behind `ToolSearch`
  (`alwaysLoad` per-tool opt-out), no fixed per-server tool cap;
  dynamic tool updates and reconnect handling that preserves the cache.
  Channels: an MCP server can _push_ events into a running session
  (CI results, webhooks) — the inverse direction of a tool call.
- **Background tasks.** Background Bash, background subagents, Monitors
  (streaming watchers; plugin-declared monitors), `/tasks`, agent view
  (`claude agents`, `--bg`, attach/logs/stop/rm — measured in `--help`),
  cross-session messaging (`SendMessage` to other sessions, local and
  cloud). Exit force-kills background commands after 1.5 s [2.1.300].
- **Worktrees.** `--worktree`, subagent isolation, `.worktreeinclude`,
  cleanup of unchanged subagent worktrees, non-git VCS via
  `WorktreeCreate`/`WorktreeRemove` hooks, bare-repo and partial-clone
  edge fixes through this window.
- **Output styles & statusline.** Output styles (built-in incl.
  Explanatory, Proactive; custom Markdown) modify the system prompt's
  behaviour section. Statusline is a _user command_ receiving session
  JSON on stdin (model, costs, context %, rate limits, subagent variant
  with `agentType` [2.1.293]) — a script surface, with a Sonnet-powered
  `/statusline` setup agent.
- **IDE.** VS Code: inline diffs, `@`-mentions, plan review, selection
  attach (opt-out `claudeCode.attachSelection` [2.1.300]; the
  long-asked disable-auto-attach shipped, closed #24726), on-demand
  Problems-panel diagnostics tool [2.1.285], question cards with option
  previews and a persistent Questions row [2.1.286], background
  subagents collapsed to one status line [2.1.304], bookmarks
  [2.1.286]. JetBrains: analogous panel. Desktop: parallel sessions
  with git isolation, side chats, diff review, app previews, PR
  monitoring, Dispatch (phone-started) sessions, iOS simulator pane.
- **Review.** Local `/code-review [--max-findings]` (effort-first
  [2.1.311]), cloud multi-agent `/ultrareview` (workspace-trust-gated
  [2.1.309/2.1.314]), GitHub Code Review product (inline, verified
  findings, `REVIEW.md` tuning, Quick/Standard/Deep levels [2.1.304],
  severity analytics [2.1.316]), security-guidance + Claude Security
  plugins. GitHub Actions (`@claude`) and GitLab CI integrations.
- **Routines, loops, goals.** Cloud _scheduled tasks_ (routines):
  cron/API/GitHub-event triggers in cloud environments; in-session
  `/loop` + cron tools (`CronCreate`/`CronList` with `nextFireAt`,
  SDK 0.3.299); `/goal` completion condition judged by a model, works
  until met/impossible/error (contrast our D38 no-loop rule, §2).
- **Headless & SDK.** `claude -p` with `--output-format text|json|
stream-json`, `--json-schema`, `--max-turns`, `--max-budget-usd`,
  `--fallback-model`, `--agents`, `--mcp-config [--strict-mcp-config]`,
  `--bare` (skip hooks/LSP/plugin-sync/auto-memory/keychain/`CLAUDE.md`
  discovery), `--safe-mode` (no customizations) — all measured in
  `--help` on 2.1.310. Agent SDK `query()`/`startup()`/`prewarm()`:
  `canUseTool` callback, in-process SDK MCP servers with per-tool
  `permission_policy` (`always_ask`/`always_deny`) [0.3.301], programmatic
  `agents`, session stores (`listSessions`/`listSubagents` over
  `~/.claude/projects/…/subagents/agent-<id>.jsonl`), structured
  outputs, cost/`ModelUsage` with cache-lifetime split [0.3.311],
  `getContextUsage()` with stable row ids and per-server instruction
  shares [0.3.304]. Python SDK mirrors it (MIT, real source).
- **ACP (theirs).** `claude-agent-acp` v0.100.0 maps the Agent SDK to
  ACP v1 **and draft v2** (`CLAUDE_AGENT_ACP_PROTOCOL=auto|v1|v2`):
  `@`-mentions, images/blob resources, permissioned tool calls, edit
  review, TODOs, nested subagent transcripts _or_ child sessions per
  the subagents RFD (`subagent_update`, `session_message` pairs,
  per-child cancel via `Query.stopTask`,JetBrains AIR's earlier draft
  kept), terminals (interactive + background), slash commands, client
  MCP servers, `/mcp` management via the SDK control API, Ultracode as
  a session config option, and AIR `_meta` extensions (AIR diff patch,
  goal, session-failure, recommended config values, permission
  presentation). On ACP SDK 2.4.0 + Agent SDK 0.3.316 at v0.100.0.
  At 15,078 lines for `acp-agent.ts` alone (measured), it is a
  translation layer bigger than our whole ACP agent — most of it
  compensating for SDK-mode refusals (`/mcp` refused in SDK mode) and
  transcript reconstruction. Read its README subagent section before
  designing ours (§4).

### 1.4 What users ask for and what hurts (issue tracker, 2026-11-02)

Measured via the GitHub search API (counts are the API's, before its
unauthenticated rate limit stopped the last two tallies).

**All-time most `+1`-reacted open issues** (15,612 open). The top of the
list is _accounts, limits and TUI_, not features:

- #45596 “Bring Back Buddy” (1,195 `+1`) — a removed novelty; ignore.
- #18435 (987) + #36151 (770) + #27302 (444): multi-account switching,
  multiple connector accounts. **One person, several identities** is
  the loudest product ask.
- #16157 (696, 1,499 comments) + #38335 (477): Max-plan usage limits hit
  “instantly”/“abnormally fast”; #46917 (215): `cache_creation` inflated
  ~20K tokens in 2.1.100+ with the same payload; #17432 (500) regional
  pricing; #47509 (196) a Team “Max 20x” tier. **Cost opacity is the
  deepest complaint well.**
- #826 (690) + #769 (299): TUI scroll-jump and flicker (a related
  flicker thread #1913 finally closed 2026-10-22 — see below).
- #31005 (437): `AGENTS.md` + `.agents/skills/` support (“asking since
  August 2025”, marked duplicate; the `AGENTS.md` half shipped —
  #34235 closed 2026-10-22 — the `.agents/skills` half is why it stays
  open). #20697 (162): sync skills between Desktop and CLI.
- #1455 (445): XDG base-directory compliance (companion #2350 closed
  2026-10-22). #33932 (220): VS Code diff-review UI like Copilot's.
  #21151 (185): say _which file_ a Read touched. #32733 (179): secure
  secrets injection on the web. #22543 (235): a 10 GB Cowork VM bundle
  degrading performance (labelled high-priority/performance).
- Model-behaviour complaints with real reaction mass: #77136 (440,
  rhetorical “tics”, incoherence across 4.7–5.5/Fable), #65961 (253,
  verbose code comments despite instructions). These are model issues;
  a harness answers them only with steering surface (output styles,
  instructions that survive compaction).

Open-issue volume by word (API totals, overlapping): `context` 5,454;
`permission` 3,127; `subagent` 1,760; `compaction` 786. By label:
`bug` 10,596; `enhancement` 3,440. **Context and permissions together
outweigh everything else anyone files.**

**Since 2026-09-01** (12,177 opened; top by `+1`):

- #97074 (144): headless `claude -p` burns ~1.8× more of the 5-hour
  window per token than interactive, same workload. Directly about
  metering honesty for automation.
- #91870 (132, 276 comments): “Mods — make Claude 10x more extensible”
  — the community thread mods [2.1.287] answered. Demand for in-process
  extensibility is real; so is its risk (§1.5, skills paper).
- #97854 (39) + #97812 (16): auto-mode server classifier returns _no
  verdict_ and blocks Bash/Edit/`ScheduleWakeup` wholesale. The
  fail-closed default, felt as a product outage.
- #91650 (61) + #91683 (28) + #91776 (18) + older #28240 (210):
  `cd`-compound permission prompts misfiring against `Read()` deny
  rules on Windows — shell-parsing × rules is a permanent bug farm
  (the 2.1.283–2.1.316 changelog fixes this class almost weekly).
- #94393 (32) + #94553 (19): Monitor `persistent` capped at ~30 min
  despite schema/docs — _documented lifetime ≠ actual lifetime_.
- #102136 (22): permission prompt defaulting to “Always allow” instead
  of “Allow once” — called a dangerous UX regression in its title.
- #98256 (18): MCP elicitation capability declared but auto-declined
  (“print mode”) in interactive VS Code. #96326 (36): replies drift to
  English after English tool output despite a Japanese `CLAUDE.md` rule
  — instruction dilution, compaction-adjacent.
- Desktop churn dominates the rest (next-step box, Routines sidebar,
  theme redesign backlash #104695).

**Recently closed with mass** (what Anthropic chose to fix): TUI
flicker/scroll (#1913, #36582), VS Code auto-attach opt-out (#24726,
#20944), LaTeX in VS Code (#16446), diff against non-`main` branches
(#23626), continue/auto-continue at the session limit (#13354, #35744),
`AGENTS.md` native (#34235), XDG (#2350), Desktop always-on-top
(#85891). Pattern: editor friction and “don't trap my session at a
limit” beat new agent features.

**Which complaints can we be the answer to?** (Inference, argued in §2/§3.)

1. _Metering and limits honesty_ (#16157, #38335, #46917, #97074):
   our per-request usage journal, paid-consent popups and
   provider-or-person-only caps (D121) are already the counter-design;
   what's missing is Claude-Code-style _attribution_ (`/usage`
   warnings, cache read/creation split) on the Model API backend.
2. _Classifier no-verdict outages_ (#97854): our Auto reviewer can only
   narrow an ask to allow, never deny-by-timeout; the question stays
   with the person. Keep it that way (§3).
3. _`.agents/skills`, `AGENTS.md`, XDG, multi-account_: we already read
   `.agents/skills` + `AGENTS.md` (D13) and ship multi-account provider
   support (M108); the remaining work is _importing a Claude Code
   setup whole_ (plugins included) so switching costs nothing (§3 R5).
4. _Compaction amnesia_ (786 open, #96326 class): the papers (§1.5)
   give us a better compaction to build than the one being complained
   about.
5. _Diff review in the editor_ (#33932): our review pane exists; Claude
   Code users are still asking theirs for it. No action beyond §2's row.

### 1.5 Research read (to 2026-11-02)

Method, sample and replication noted per paper; “would change what we
build” is the bar. Newer contradicts older where marked.

1. **Same Model, Different Harness** (Lewis, arXiv:2608.26218,
   2026-08-26; abstract + design read). One harness, two configurations,
   same weights/tasks/window: mechanically shortening older tool
   results as context fills + stall/repetition response. On 169
   SWE-bench Verified tasks at a 20,480-token window, mean fail-to-pass
   fraction 28% → 49%, complete solutions 43 → 72; same frozen
   treatment helps three other models; wide-window gains shrink
   (FeatureBench retains them). _Changes what we build:_ validates our
   observation packing direction and says the win is in _mechanical_
   shortening + stall handling, no model call needed. Single-author,
   artifacts published; not yet independently replicated — treat the
   size as unverified, the direction as strong (it matches our M73/M101
   measurements, PLAN D81).
2. **CliffCompaction** (Nguyen et al., arXiv:2609.26779, 2026-09-22;
   full text read). Compaction that only truncates/drops, never
   rephrases, and never compacts a compaction (each pass restarts from
   originals). Up to 50% cheaper under bounded context at equal or
   better Terminal-Bench scores; test-time scaling +10 points for under
   2× full-context cost; KernelBench continual learning to 3.58× at 400
   steps; scaffold-agnostic API-proxy implementation that runs under
   Claude Code and Codex. _Contradicts_ the summary-based compaction
   both Claude Code and our handoff use: summary-of-summary drift is
   the measured failure. This is the strongest “build differently”
   result in the set (§3 R2).
3. **CTXAgent** (Busch et al., arXiv:2610.34425, 2026-10-25; full text
   read). The model manages its own context with two tools + one
   paragraph of guidance, vs threshold compaction, seven frontier
   models, mixed 35–212-turn sessions with planted facts and standing
   instructions checked deterministically. Strong models keep live
   context mostly under 100K with no significant score drop; with Opus
   5.5 it matches Claude Code at 34% lower cost than Claude Code's
   explicit 200K configuration, 49% lower than its default. Earlier
   work found open-weight models _cannot_ do this unaided — the paper
   says so and tests the boundary. _Changes what we build:_ a
   model-visible “manage context” tool is worth piloting _per
   capability record_ (only models that prove they can), never as the
   only mechanism (§3 R2, gated).
4. **Slipstream** (arXiv:2605.08580, 2026-05-09; abstract read) and
   **AutoCompact** (arXiv:2610.02163; abstract read): validate a
   compaction against the trajectory before resuming from it; learn
   _when_ to compact (+9.2 points SWE-bench Verified, claimed).
   Together with 2–3 the 2026 consensus is: _when_ and _faithfulness_
   beat _summary quality_. None of the three replicates another;
   sizes unverified.
5. **“Do Not Mention This to the User”** (Liu et al., USENIX Security
   2026; arXiv:2602.06547; abstract + USENIX page read). 98,380 skills
   from two registries, static + dynamic verification: 157 confirmed
   malicious, 632 vulnerabilities, 13 techniques; secondary reporting
   of the same paper puts 84.2% of vulnerabilities in the natural-
   language `SKILL.md` (not scripts), one actor behind 54%. _Changes
   what we build:_ a marketplace without behavioural vetting is a
   malware channel; our import-preview + narrow-only conversion is the
   right posture, and any Claude plugin loading (§3 R5) must ship with
   the scanner, not after it.
6. **Prompt Injection Attacks on Agentic Coding Assistants** (SoK,
   arXiv:2601.17548, 2026-01-24; abstract read) and **Breaking the
   Protocol** (MCP security analysis, arXiv:2601.17549; abstract read):
   systematic maps of skill/tool/protocol injection, tool poisoning and
   MCP spec gaps. Consistent with 5; useful as checklists for R5/R6,
   not as measurements.
7. **AOrchestra** (arXiv:2602.03786, 2026-02-03; abstract read) and
   **AgentFactory** (arXiv:2603.18000, 2026-03-18; abstract read):
   orchestrators that _concretize_ subagents on the fly (instruction,
   context, tools, model tuples) and accumulate successful subagents as
   reusable code. Directionally supports dynamic workflows + saved
   workflows (Claude) and our team roles; neither evaluates on
   SWE-bench-class coding at convincing scale in what was read.
   Do not build “self-evolving subagent accumulation” on this evidence
   (§3, not-to-do).
8. Anthropic's own harness writing (claimed, secondary): the April 2026
   prompt-caching post and the July 2026 context-engineering post
   (“removed over 80% of the system prompt… no measurable loss”,
   verification moved into skills, deferred tools via ToolSearch).
   Read as vendor claims; the _mechanisms_ (deferral, cache-stable
   prefix) are independently supported by 1–3 and by the docs.

### 1.6 Where Claude Code is strongest (evidence-weighted)

- **Breadth with one mental model.** Six permission modes, 33 hooks,
  skills/agents/plugins/marketplaces, four rungs of parallelism, every
  major surface — and the September→November changelog shows the
  maintenance depth to keep them consistent (the same fix lands in CLI,
  VS Code, Desktop, SDK within days).
- **Context economics.** Tool search, cache-layer discipline, idle
  compaction, per-subagent compaction windows, `/usage` attribution:
  nobody else documents their cache invalidation table. Papers 2–3
  still beat its compaction, which is precisely our opening.
- **Extension ecosystem gravity.** `claude plugin eval`, marketplaces,
  mods, statusline scripts, output styles: a Claude Code setup is an
  asset people carry between employers. Our answer is import fidelity,
  not a rival marketplace (§3).

---

## 2. Comparison, feature by feature

Claude Code column: 2.1.316 docs/changelog unless a version is given.
Ours column: this tree at `72d8d5003`; “Muse” = Muse Code backend,
“Model API” = in-process engine. Effort/verdict reasoning is in §3.

| #   | Feature                          | Claude Code                                                                                                                                      | Ours (`file:line`)                                                                                                                                                                                                                                                                                                              | Verdict                                                                                                                                                                                                                 |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Subagents: built-in + custom     | Explore/Plan/general-purpose + Markdown agents (model, tools, hooks, memory, `autoCompactWindow`); description budget warns at 15K tokens        | Model API spawn/wait tools (`src/core/backends/modelapi/subagentTools.ts:1`, M48/D45); file agents `.agents/agents/<id>/AGENT.md` narrow-only, zod-parsed (`src/core/context/customAgents.ts:1`, M76/D49); Muse shows its own agents                                                                                            | **partial** — no built-in Explore/Plan pair, no description-budget warning, no per-agent compaction window                                                                                                              |
| 2   | Fork subagents (inherit history) | `subagent_type: "fork"`, default on in `-p`/SDK/Desktop/VS Code [2.1.302]; inherits history + auto memory                                        | No fork: every spawn starts fresh (`grep fork src/core/backends/modelapi/subagentTools.ts` — none, 2026-11-02); session fork exists (`src/core/agent/agentBackend.ts:1140`) but is a user verb, not a subagent kind                                                                                                             | **missing**                                                                                                                                                                                                             |
| 3   | Background subagents & tasks     | Background Agent/Bash, Monitor tool + plugin monitors, `/tasks`, agent view                                                                      | Background shell with lifted time limit (`src/core/backends/modelapi/tools.ts:480`, M46); subagent wait tool; team board for workers. No Monitor-equivalent streaming watcher tool                                                                                                                                              | **partial**                                                                                                                                                                                                             |
| 4   | Agent teams                      | Experimental peer _sessions_, shared task list, mailbox JSON, tmux/iTerm2 panes                                                                  | Workspace teams: roster, roles, merge queue, review gate, meters (`src/core/team/teamHost.ts:1`, M96); workers in-process or ACP (`src/core/team/teamTools.ts:1`); headless `--team` (M96b)                                                                                                                                     | **ours is better** on supervision (merge/review/caps in code, D200); **worse** on peer-to-peer messaging — ours is lead-centred by design                                                                               |
| 5   | Dynamic workflows                | JS script orchestrates subagents; save as command; approval; `/deep-research` bundled                                                            | Muse workflows rendered as a card with Cancel/Skip/Retry/Pause (`src/webview/workflowDetails.ts:1`, M47/D40); Model API: none (PLAN.md:2591 “Muse Code's own engine”)                                                                                                                                                           | **partial** (deliberate under D40 for Muse; Model API **missing**)                                                                                                                                                      |
| 6   | Hooks: events                    | 33 events (§1.3)                                                                                                                                 | 20 events (`src/core/backends/modelapi/hooks.ts:47`): Muse's set + `PreLLMCall`/`PostLLMCall`/`Interrupt`; `SessionFork` and `ToolUseStart` parse but fire nothing (`hooks.ts:67`)                                                                                                                                              | **partial** — different host, different set; ours adds LLM-call events Claude lacks, lacks Claude's `FileChanged`/`CwdChanged`/`Elicitation`-as-hook family                                                             |
| 7   | Hooks: handler kinds             | `command`, `http`, `mcp_tool`, `prompt`, `agent`; `if`, `timeout`, `onFailure: "block"`, async                                                   | `command` + typed M91 handlers (`src/core/backends/modelapi/hooks.ts:82`, `hookHandlers.ts`); prompt/agent hooks only on 5 events (`src/core/backends/modelapi/hookNames.ts:46` `HOOK_MODEL_EVENTS`); imported Claude hooks converted (`src/core/import/agentImport.ts:658`)                                                    | **partial** — verify `onFailure` parity before claiming more (§3 R6)                                                                                                                                                    |
| 8   | Foreign hooks/plugins import     | Claude format only (plus `.mcpb`)                                                                                                                | Gemini/Cursor/Copilot/Windsurf/Kiro/Cline hooks (`src/shared/constants.ts:2011` `HOOK_FORMATS`), Amp/OpenCode plugins out-of-process, narrow-only (`src/core/backends/modelapi/pluginHost.ts:1`), Claude/Codex/Cursor setup import (`src/core/import/agentImport.ts:1`, M83)                                                    | **ours is better**                                                                                                                                                                                                      |
| 9   | Skills                           | `SKILL.md`, `context: fork`, dynamic context (shell), `allowed-tools`, per-skill hooks/model, `/reload-skills`, post-compact re-injection budget | `.agents/skills/<id>/SKILL.md`, catalogue + `read_skill` (`src/core/context/skills.ts:1`, D13); bundled + first-party sources; project links confined (D24/D27). No fork-context skills, no shell expansion, no per-skill hooks                                                                                                 | **partial**                                                                                                                                                                                                             |
| 10  | Plugins + marketplaces           | Full system: manifests, deps, scopes, `validate`, `eval`, `details` (token cost), options, mods                                                  | No Claude-format plugin loader or marketplace. Plugins enter only as converted hooks/agents/skills (M83) or Amp/OpenCode hook plugins (M91). Muse plugin notifications are mapped (`src/core/backends/musecode/mapNotification.ts:189`)                                                                                         | **missing** (by scope, not by a named decision — §3 R5)                                                                                                                                                                 |
| 11  | Plugin/skill evals               | `claude plugin eval`: cases + graders + no-plugin baseline, CI-gateable                                                                          | Paired efficiency eval + judge for _our_ mechanisms (`src/core/eval/runner.ts:1`); nothing that grades a person's skill/plugin                                                                                                                                                                                                  | **missing**                                                                                                                                                                                                             |
| 12  | Checkpoints / rewind             | File-tool edits only; Bash-only and most subagent edits untracked; ~30-day sweep                                                                 | Shadow-git turn checkpoints, restore along an unbroken chain, tool-writes tracked (`src/host/checkpoints/checkpointStore.ts:1`, M72/M86/D51; `src/core/checkpoints/toolWrites.ts:1`)                                                                                                                                            | **ours is better** on capture honesty (chain-checked restore); compare subagent-edit coverage before claiming full parity — ours tracks the session's tool writes, team workers have their own copies (M96b)            |
| 13  | Plan mode                        | Read-only + Plan subagent, approval gate, clear-on-approve option                                                                                | `plan` → `denyUnmatched` both backends (`src/shared/permissionModes.ts:20`); review turns borrow Plan (`src/core/review/planModeHold.ts:1`, D46/D49)                                                                                                                                                                            | **equal** in effect; **worse** in ceremony (no first-class plan document + approve-to-implement flow; the estimator/plan reader is separate)                                                                            |
| 14  | Permission modes                 | 6 modes incl. `dontAsk`; deny beats bypass; protected + critical paths                                                                           | Same 5 UI names (`src/shared/constants.ts:1045` `PERMISSION_MODES`) mapped to 4 MSP modes (`src/shared/permissionModes.ts:88`); Model API engine (`src/core/backends/modelapi/permissions.ts:1`); protected writes ask in every mode but Bypass/Plan (D24). No `dontAsk` UI mode (headless `acceptEdits` + deny covers CI, M80) | **equal**, minus `dontAsk` as a named mode                                                                                                                                                                              |
| 15  | Auto classifier                  | Server or client classifier (Sonnet 5 default), no-verdict = deny, reviews agent messages; default mode since 2.1.283                            | Opt-in paid Auto reviewer, allow-or-ask only, breaker-tripped → ask (`src/core/backends/modelapi/autoReviewer.ts:1`, M78/D49); Muse profile `:auto-review` alternative (D69/M90). Never denies by itself                                                                                                                        | **ours is better** on failure semantics (no #97854-style outage); **worse** on friction (more prompts; reviewer off unless paid-on, D48) — **deliberately** so (D48, D49)                                               |
| 16  | OS sandbox for shell             | Seatbelt/bubblewrap, shell-only, off by default, fail-open default, reads default-open incl. credentials                                         | Muse CLI sandbox incl. Windows setup/check (`src/core/backends/musecode/sandbox.ts:1`); Model API shell under permission policy + resource governor (`src/core/resources/`, M107), no Seatbelt/bwrap wrapper for Model API Bash found this lane                                                                                 | **partial** — Muse path **equal** (stronger on Windows); Model API path **worse** (policy without an OS boundary). Verify before building (§3 R6 note)                                                                  |
| 17  | Rules files                      | `CLAUDE.md` primary, `AGENTS.md` native, `@import`, path-scoped rules; root edits don't apply mid-session                                        | `AGENTS.md` primary, `CLAUDE.md` fallback per directory, load-on-touch for subdirectories (`src/core/context/rules.ts:1`, D13)                                                                                                                                                                                                  | **partial** — precedence is _reversed_ vs Claude; ours applies subdirectory files on touch. Import (M83) bridges setups; a repo carrying both files behaves differently here than in Claude Code. Needs a decision (§3) |
| 18  | Auto memory                      | Typed self-written notes, `MEMORY.md` 200-line/25 KB index, per-project, `/memory`                                                               | Same tools and index discipline, shared by both backends (`src/core/memory/memoryStore.ts:1`, `memoryIndex.ts:1`, M49/D41); scopes personal/project                                                                                                                                                                             | **equal** (deliberate mirror of Muse's, D41/D13)                                                                                                                                                                        |
| 19  | Compaction                       | Summary-based auto/manual + idle (§1.2); survival table; 5-file re-read                                                                          | Economics-driven auto-compaction + handoff (`src/core/backends/modelapi/autoCompact.ts:1`, M101/D81.4), admission control (`autoCompactionAdmission.ts:1`); no idle compaction (`grep` — none)                                                                                                                                  | **partial** — and both use the approach CliffCompaction/CTXAgent beat (§1.5). Idle **missing**                                                                                                                          |
| 20  | Observation handling             | Tool-result clearing via context editing (API); compaction summaries                                                                             | Mechanical packing + `recall_output` paging (`src/core/backends/modelapi/observationPacking.ts:1`, M73; `observationPack.ts:1`) — the “Same Model, Different Harness” treatment, already shipped                                                                                                                                | **ours is better** (faithful, recallable; theirs summarizes away)                                                                                                                                                       |
| 21  | Prompt caching                   | Documented layers/TTLs/invalidation; effort keeps cache; OTel split                                                                              | Stable-prefix cache key over model+instructions+tools (`src/core/backends/modelapi/promptCache.ts:1`, M56/D43); cache-stable request prefix invariant (D81.5)                                                                                                                                                                   | **equal** in discipline, different API (Meta prefix cache vs Anthropic breakpoints); **worse** in visibility (no per-layer invalidation story for the person)                                                           |
| 22  | MCP client                       | Tool search (deferred schemas) default; 25K-token output cap; OAuth; elicitation form+URL; channels (push); `2026-07-28`                         | Dual-era client (`src/core/backends/modelapi/mcp/changes.ts:2`, D213: probes `2026-07-28`, legacy fallback); elicitation flat forms only, URL mode refused (`mcp/elicitation.ts:78`); all schemas offered per request (`ModelApiHost.ts:6006`); no channels                                                                     | **worse** — deferred tool search and URL elicitation **missing**; era handling **equal**                                                                                                                                |
| 23  | MCP server (us as server)        | `claude mcp serve` exposes Claude Code's tools                                                                                                   | `ide` MCP server (diagnostics, code intel, images, web fetch, browser check) for the Muse backend (AGENTS.md layout; `src/host/` IDE tool server)                                                                                                                                                                               | **partial** — different purpose (editor services in, not the agent out)                                                                                                                                                 |
| 24  | Model fallback                   | `--fallback-model`, refusal fallback to older Opus, family fallback on missing deployment, fallback chains filtered by allowlist                 | Retry/backoff + refusal classification (`src/core/backends/modelapi/providerRefusal.ts:50`); no person-set fallback chain, no cross-model refusal retry found                                                                                                                                                                   | **missing** (as a _person-set_ chain; provider limits still apply, D121)                                                                                                                                                |
| 25  | Effort & thinking                | Effort levels + `ultrathink`/`xhigh`, org effort caps, subagent effort                                                                           | Effort in model role settings + per-agent `effort` (`src/core/context/customAgents.ts:4`); `src/shared/effort.ts:1`                                                                                                                                                                                                             | **equal** in substance; no keyword trigger (nor needed)                                                                                                                                                                 |
| 26  | Worktrees                        | `--worktree`, subagent isolation, `.worktreeinclude`, VCS hooks                                                                                  | “New Worktree…” (`src/core/worktrees.ts:1`, M32/D30), worktree conversations (`src/core/worktreeConversations.ts:1`), team worker copies                                                                                                                                                                                        | **equal**; no `.worktreeinclude` equivalent found — **partial** on that detail                                                                                                                                          |
| 27  | Output styles                    | Built-in + custom styles reshape system-prompt behaviour                                                                                         | None (`grep outputStyle src/` — none as a feature)                                                                                                                                                                                                                                                                              | **missing**                                                                                                                                                                                                             |
| 28  | Statusline                       | User _command_ + session JSON stdin                                                                                                              | Fixed working-line component (`src/webview/components/StatusLine.tsx:1`); TUI status in `src/runtime/tui/`                                                                                                                                                                                                                      | **missing** (as a script surface)                                                                                                                                                                                       |
| 29  | Sessions                         | Resume/continue/fork, `--from-pr`, teleport local↔cloud, cross-session messaging                                                                 | Resume + fork (`src/core/agent/agentBackend.ts:831`), cut-stream resume (`src/core/backends/modelapi/resume.ts:1`, D90.25); home-node/connector remote (M110/M124) is a different shape (person's own PC, D240)                                                                                                                 | **partial** — no cross-session agent messaging; no cloud (deliberate: no hosted harness in PLAN; see §3 not-to-do)                                                                                                      |
| 30  | Goals / loops / schedules        | `/goal` model-judged loop; `/loop` + cron tools; cloud routines                                                                                  | Goal tools pinned, **no loop turns of its own** (`src/core/backends/modelapi/goals.ts:8`, D38); local scheduled prompts with paid consent per schedule (M115; `src/core/backends/modelapi/schedules.ts:1`)                                                                                                                      | **deliberately not** the autonomous goal loop (D38); schedules **equal** locally, routines (cloud) **missing** by the same no-cloud scope                                                                               |
| 31  | Headless / programmatic          | `-p` text/json/stream-json, `--json-schema`, `--max-*`, Agent SDK (`query`, `canUseTool`, SDK MCP servers)                                       | `exec` JSONL + schemas (`src/runtime/exec/execProtocol.ts:1`, M80/D65), ACP agent, no general-purpose embeddable SDK equivalent to `query()`                                                                                                                                                                                    | **partial** — exec covers CI; library embedding **missing** (ACP is our embedding story)                                                                                                                                |
| 32  | ACP surface                      | Their adapter: ACP v1 + draft v2, subagent child sessions (RFD), AIR extensions, Ultracode option                                                | ACP v1 on SDK 2.0.1 (`package.json:2128`; caps at `src/acp/agent.ts:4286`: load/list/resume/close/delete/additionalDirectories, image/audio/embeddedContext); subagents surfaced as tool calls, not child sessions. `rv/acpteam` adds team admission, still v1                                                                  | **worse** — v2 and child sessions **missing**; ours wins on breadth of backends behind one agent                                                                                                                        |
| 33  | Code review                      | Local `/code-review`, cloud ultrareview, GitHub product with `REVIEW.md` + levels + analytics                                                    | Review material/prompt + Plan hold (`src/core/review/reviewMaterial.ts:1`), Auto reviewer, verify loop with settled diagnostics + format-on-edit (`src/core/backends/modelapi/verifyLoop.ts:1`, M68)                                                                                                                            | **partial** — ours verifies _during_ the turn (arguably better); no PR-product equivalent, no review levels/analytics                                                                                                   |
| 34  | Usage & cost visibility          | `/usage` warnings, `/cost`, statusline spend, OTel GenAI events, gateway budgets                                                                 | Usage journal + Account & usage (`src/core/usage/journalStore.ts:1`), PaidUsage (D48), resource history (M102). No OTel exporter found                                                                                                                                                                                          | **partial** — metering **ours is better** (per-request, both backends); OTel/org analytics **missing**                                                                                                                  |
| 35  | Browser / computer use           | Chrome extension (user's browser), CLI computer use (macOS)                                                                                      | Pinned-runtime browser check behind its own proxy, no system browser (`src/core/browser/browserRun.ts:1`, M81); Muse computer-use setup surfaced (`src/core/agent/agentBackend.ts:475`, M127)                                                                                                                                   | **ours is better** on containment (verified runtime, loopback proxy); **worse** on “use _my_ logged-in browser” — **deliberately not** (D24 posture)                                                                    |
| 36  | Voice / dictation                | Dictation in CLI/VS Code                                                                                                                         | Dictation + Muse Voice with native helpers (AGENTS.md `native/`)                                                                                                                                                                                                                                                                | **equal** (different engines; out of this lane's depth)                                                                                                                                                                 |
| 37  | Settings & managed policy        | Managed + server-managed (applies without prompt since 2.1.316, unverified copy refused), LLM gateways, `availableModels`/`deniedModels`         | VS Code settings + model role settings; managed-policy check for browser (`src/core/browser/`, M81); OS credential store (D61)                                                                                                                                                                                                  | **partial** — no server-managed settings channel. Their 2.1.316 “apply without approval” move is one to _not_ copy (§3)                                                                                                 |
| 38  | Multi-account / multi-provider   | One Anthropic identity per surface (top complaint, §1.4); providers via Bedrock/Vertex/Foundry/gateway                                           | Provider accounts, per-role models, own keys / ChatGPT-plan / Copilot (`src/core/accounts/`, M108; `src/core/providers/`)                                                                                                                                                                                                       | **ours is better** — this is Claude Code's loudest unmet ask and our shipped answer                                                                                                                                     |
| 39  | Inline completion (Tab)          | None in Claude Code (separate products own it)                                                                                                   | Model API Tab with ledger + D48 consent (M94/D73)                                                                                                                                                                                                                                                                               | **ours is better** (theirs missing) — listed so synthesis doesn't double-count Claude surface area                                                                                                                      |

**Stale PLAN text found (fix in a docs lane, not this one).** PLAN.md's
D42 summary still ends “Resources, prompts, sampling, roots and
elicitation are not done” (PLAN.md:2712), but elicitation shipped:
`src/core/backends/modelapi/mcp/elicitation.ts:1`, the M91 lane-M table
row (PLAN.md:18812) and D213's MRTR elicitation (PLAN.md:9412). The §2
sentence should name what remains (resources/prompts/sampling/roots as
applicable today) instead of listing elicitation. The same applies to
the “four-request cap” for subagents in the feature table and D45
summary (PLAN.md:2592, PLAN.md:2736): the cap was removed —
`SUBAGENT_CAPACITY = 0` with the NOLIMITSSET note
(`src/shared/constants.ts:6990`) — so both lines now describe a limit
D121 deleted. R6's brief fixes the elicitation sentence; these two
belong with it.

**Two checks this lane could not close from reading alone** (both are
first steps in §4 briefs, not verdicts): whether our `SubagentStop`
fires per-poll like Claude's pre-2.1.311 bug, and whether our MCP
allow rules share the `mcp__a` ⊃ `a__b` prefix flaw Claude fixed in
2.1.299. Grep found neither flaw nor proof of absence; only a run
proves it.

---

## 3. Ranked: what to do, and what not to do

Value is to the person doing the work. Effort: S ≤ 1 lane-week,
M ≈ 2–4, L > 4 or multi-lane. Evidence: A = measured here or in our
own gated runs; B = paper with method/sample read; C = vendor docs /
issue counts. Every item respects D121/D208: the only hard limits are
the provider's, the person's own settings, and industry-standard
_failure-survival_ bounds (retries, timeouts) that stop and say why.

| Rank | Do                                                                                                                                                                                         | Value                                                                                              | Effort                      | Evidence                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| R1   | Deferred MCP/tool search on Model API (names + server instructions upfront, schemas on demand, cache-stable)                                                                               | High — every MCP server stops taxing every turn; unblocks large-server setups                      | M                           | A (our per-request offer, `ModelApiHost.ts:6006`) + C (Claude default since before 2.1.283, widened 2.1.304) + B (§1.5.1) |
| R2   | Faithful compaction: truncate/drop, never summarize-of-summarize; keep packing; add idle compaction; pilot model-managed context per capability record                                     | High — context/compaction is the largest complaint mass (§1.4) and our longest sessions' main cost | M (truncate/idle) + S pilot | B (CliffCompaction, CTXAgent full text) + A (our packing already proves the mechanical half)                              |
| R3   | Fork subagents + built-in Explore/Plan agents + description-budget warning                                                                                                                 | High — “same context, side quest” is now Claude's default delegation shape                         | M                           | C (2.1.302 defaults) + A (spawn/session-fork primitives exist)                                                            |
| R4   | ACP draft-v2 + subagent child sessions (RFD) in our ACP agent                                                                                                                              | High for Zed/JetBrains parity; editors will expect child sessions                                  | L                           | A (their adapter v0.100.0 read in code; ours v1/SDK 2.0.1)                                                                |
| R5   | Claude plugin import (not a marketplace): load a Claude plugin _directory_ via M83 conversion + malicious-skill scan; show token cost like `plugin details`                                | High — a Claude setup becomes portable to us in one step                                           | M–L                         | B (USENIX skills paper) + A (M83/M91 machinery exists)                                                                    |
| R6   | Hardening pass copied from Claude's fix list: `onFailure` parity, `SubagentStop` once-only, MCP allow-rule exact-server scoping, `PreCompact` output bound, hook `updatedInput` validation | Medium-high — each is a bug class Claude already paid for                                          | S–M                         | A/C (changelog lines in §1.2; two items unverified in ours — prove by run first)                                          |
| R7   | Person-set model fallback chain (refusal/overload → next model the person listed; say when it fires)                                                                                       | Medium — long runs stop dying on one provider's refusal/529                                        | S–M                         | C (2.1.312/2.1.314) + A (refusal classification exists)                                                                   |
| R8   | Cost attribution on Model API: `/usage`-style “what's contributing” + cache read/creation split per session                                                                                | Medium — answers the deepest Claude complaint class on our side too                                | S                           | C (§1.4) + A (journal rows exist)                                                                                         |
| R9   | Skills parity slice: `context: fork` skills (on R3), per-skill `allowed-tools`/model, post-compact re-injection budget                                                                     | Medium                                                                                             | S–M (after R3)              | C                                                                                                                         |
| R10  | Script statusline + output styles (person's command, session JSON; style = behaviour section only)                                                                                         | Low-medium — beloved, cheap, purely additive                                                       | S                           | C                                                                                                                         |
| R11  | MCP URL elicitation + channels evaluation (channels only behind a decision; push-into-session is an injection surface)                                                                     | Medium (URL); unknown (channels)                                                                   | S (URL)                     | C + B (§1.5.6 checklists)                                                                                                 |
| R12  | Dynamic workflows on Model API (script runtime over subagent tools)                                                                                                                        | Medium-high _if_ teams prove insufficient for 100+-file sweeps; otherwise defer                    | L                           | C; weaker for us — teams (M96) + playbook (M116/D200) already cover supervised fan-out                                    |

**Decisions needed before building:** the rules precedence in §2 row 17
needs an owner decision — match Claude (`CLAUDE.md` wins) for
imported repos, or keep D13 (`AGENTS.md` wins) and say so at import
time; R11 channels needs a security decision; R12 needs a D40
amendment. The rest fit existing decisions.

### What NOT to do, and why

1. **Do not build in-process JS “mods”.** Claude needed 30 releases of
   containment fixes after 2.1.287 and still refuses deep nesting,
   gates managed mods, and special-cases failure semantics. Our
   out-of-process, narrow-only plugin host (`pluginHost.ts:1`) is the
   stronger design; the USENIX skills measurement (§1.5.5) says the
   text _around_ the code is already the main weapon — don't add an
   in-process execution surface to it.
2. **Do not make a deny-capable default classifier.** No-verdict-equals-
   deny (#97854) turns a safety service's bad minute into a product
   outage, and a classifier that can deny must be right about shell
   parsing forever (the weekly `cd`-compound fixes). Keep Auto
   allow-or-ask (M78) and rules/protected-paths in code (D24, D200).
3. **Do not build a marketplace.** Catalogues need vetting staff we
   don't have; 157/98,380 confirmed-malicious is the measured base
   rate for unvetted ones. Import directories people already trust
   (R5), scanned, previewed, narrow-only.
4. **Do not copy server-managed settings that apply without approval**
   (2.1.316). Our settings story is local files the person can read;
   silent remote policy contradicts D24's posture. If enterprise
   policy is ever needed, it arrives as a file the person approves.
5. **Do not depend on `@anthropic-ai/claude-agent-sdk` to “add Claude
   Code as a backend”.** Its terms allow driving Claude, but it cannot
   serve Muse/Model API models, it would import Anthropic's metering
   (#97074) and account model (§1.4) wholesale, and our two backends
   already sit behind `AgentHost` (`agentBackend.ts:1112`). A third
   backend is a product decision for the owner, not a research
   recommendation. (Driving _their_ ACP adapter as an external ACP
   agent is already possible through our ACP client paths and needs
   no SDK dependency.)
6. **Do not chase cloud sessions / routines / teleport.** No hosted
   harness exists in PLAN; the home node (M110) and connector (M124,
   person's own PC, D240) are the deliberate remote story. Revisit
   only by owner decision.
7. **Do not add summary-of-summary compaction “improvements”** (better
   prompts, bigger summaries). §1.5.2–4 agree the loss is structural;
   spend the effort on R2's faithful path.
8. **Do not build self-evolving subagent accumulation** on AOrchestra/
   AgentFactory evidence (§1.5.7): interesting, unevaluated at coding
   scale, and it conflicts with D200 (orchestration rules in code).
9. **Do not adopt Claude's sandbox defaults.** Off-by-default,
   fail-open, reads-open-including-`~/.ssh` is a starting point their
   own docs warn about. Any Model API OS-sandbox work starts from our
   deny-read/protected-path posture, not theirs.
10. **Do not remove failure-survival limits in D121's name** while
    copying Claude features: hook timeouts, compaction retry-once,
    classifier timeouts stay, at cited standard values, and stop with
    the reason said (D121 clarification, 2026-10-23).

---

## 4. Lane briefs (launch unchanged)

Common to every brief below (stated once so each block stays short, and
binding on each): work on `linuxlt` in the lane worktree; base is the
lane's `main` at creation (0.19.0 lineage — the lead's rig-lane call
pins it; do not merge or rebase anything else in); read `AGENTS.md`,
`PLAN.md` §2/§6 for the milestone, and `~/lanes/_ctx/codex/common.md`
first; tests run real code only (no stand-ins, no invented wire data —
capture first per AGENTS rule 14 where a shape is needed); commit each
finished piece with hooks on, explicit `git add <paths>`, never
`--no-verify`, never push; run the touched suites with
`npx vitest run <files> --maxWorkers=3` (at most 3 files a run,
repository timeouts, never `--testTimeout` for the final run) plus
`npx vitest related <each changed source file> --run`, and the gates
your files touch (`npm run typecheck`, eslint/prettier on touched
files, `node scripts/check-l10n.mjs`, `npm run check:reference`,
`check:host-api`, `check:plan`, `check:roadmap`, `check:catches`,
`npm run duplication`, `cycles`, `deadcode`, `npm run build`); every
sentence a person sees goes in `src/shared/l10n/en.ts` plus all 14
tables; update PLAN §6 status, `docs/certification/<lane>.md` with a
red/green drill per new gate or test, CHANGELOG `[Unreleased]`, and
`src/shared/featureCatalog.ts`; end with `LANE DONE`, commits, drills
and every gate's exit code. Safety limits in every brief mean
D121/D208 exactly: no cap of ours on the person's work (turns, agents,
tokens, requests, sizes, spend); provider limits and the person's own
model-role/team/machine settings may stop work; failure-survival loops
(retries, waits, republish/compare-and-swap) keep a cited
industry-standard bound, person-settable where sensible, and after the
last attempt stop and say why. No paid or live Anthropic call in any
brief; real-use proof is on `muse-spark-1.3-contributor` only, empty
workspace, expected count stated first, where a brief names it.

### R1 — Deferred MCP tool search (Model API)

Decision needed: none (fits D42/D81; record as a PLAN milestone line
before code, AGENTS rule 1).

```text
RSCH-CC R1: deferred MCP tool search on the Model API backend.
Goal: an MCP server costs its name + instructions on every turn, not its
schemas. Offer a tool-search tool; full schemas load on demand and stay
loaded for the session; the request prefix stays byte-stable when
servers connect, disconnect or change tools unless the person added or
removed a server/tool on purpose. Per-tool always-load opt-out in the
server config. Claude Code reference: code.claude.com/docs/en/mcp.md
"Scale with MCP tool search" (4,096-char upfront description limit,
16,384 via search since 2.1.296) — match the behaviour, not the wire:
our Models API tool format governs. Today: ModelApiHost.ts:6006 offers
every schema per request.
Base/machine: lane main on linuxlt. Files: src/core/backends/modelapi/
(mcp/connection.ts, ModelApiHost.ts tool assembly, tools.ts), constants
in src/shared/constants.ts; lazy bundle per D6.
Proves it (real code only): (1) unit tests over the real tool-assembly
path with two real local MCP servers from the repo's fixtures: request 1
carries names only, a search call returns the schema, the tool then
runs; (2) a cache test: identical prefix bytes across a server
reconnect, changed bytes on deliberate disable; (3) failure said, never
silent: search with no match reports which server failed to connect, as
Claude does with tool search on. Red/green drill: break the deferral so
all schemas ride request 1, watch the token-count test fail, restore.
Safety limits: D121 — no cap of ours on servers, tools or searches; the
4,096/16,384 description bounds are the industry-standard values Claude
ships, person-settable via one setting; MCP output handling unchanged.
No new spend path (search is a local tool).
```

### R2 — Faithful compaction + idle compaction (+ gated pilot)

Decision needed: a PLAN decision amending D81.4 (compaction strategy)
before code; the model-managed pilot additionally needs a per-model
capability-record field, default off.

```text
RSCH-CC R2: faithful compaction for the Model API backend.
Goal: replace summary-of-summary compaction with CliffCompaction's rule
(arXiv:2609.26779, CC-BY — reimplement, cite): compacted context only
truncates or drops original content, never rephrases it; a later pass
restarts from originals, never from a prior compaction. Keep observation
packing + recall_output; standing instructions (rules files, goal,
todos) survive verbatim. Add idle compaction: a long session left idle
is compacted before the provider cache goes cold, with a person on/off
setting and the floor settable (Claude ships 200K tokens / ~54 min
[2.1.299] — adopt as defaults the person can change, not caps). Pilot,
behind a capability-record flag default off: two model-visible context
tools (CTXAgent, arXiv:2610.34425) offered only to models whose record
says they manage context; threshold compaction stays as the guarantee.
Base/machine: lane main on linuxlt. Files:
src/core/backends/modelapi/autoCompact.ts,
autoCompactionAdmission.ts, observationPack*.ts, session history in
ModelApiHost.ts; constants in src/shared/constants.ts.
Proves it (real code only): (1) property tests on real session history
shapes: no compacted output ever feeds a later compaction; kept text is
byte-identical to the original; planted-fact tests in CTXAgent's style
(a fact stated early is still answerable after three compactions);
(2) the paired evaluation (src/core/eval/) A/B on recorded real
sessions: tokens dispatched and task outcome, old vs new; (3) idle path
test with the real clock abstraction the codebase already uses.
Red/green drill: re-enable summary-feeds-summary, watch the planted-fact
test fail, restore.
Safety limits: D121 — compaction frees context, it never ends work;
no cap of ours on turns or history kept on disk; the compaction model
call, where any remains, is the session's own model (no new paid
feature); retry-once-on-empty-summary is a failure-survival bound that
stops and says why.
```

### R3 — Fork subagents + built-in Explore/Plan agents

Decision needed: none (extends D45; note the addition in PLAN §6).

```text
RSCH-CC R3: fork subagents and two built-in agents (Model API).
Goal: (a) a fork spawn kind that inherits the parent's history (and
memory snapshot) instead of starting fresh, for side work that needs
the same context; concurrent forks are told which launch is theirs
(Claude 2.1.307 fix — copy the guard, not the bug). Fork is a paid
subagent use under D48 exactly like spawn. (b) Built-in Explore
(read-only, no rules/git snapshot, thoroughness argument) and Plan
(read-only research) agents as file-agent definitions shipped in the
package, overridable by a same-id personal/project agent. (c) Startup
warning when combined custom-agent descriptions pass the context budget
(Claude warns at 15,000 tokens — adopt as the warning line, never a
refusal).
Base/machine: lane main on linuxlt. Files:
src/core/backends/modelapi/subagentTools.ts, src/core/context/
customAgents.ts, bundled agent definitions beside first-party skills.
Proves it (real code only): (1) a fork sees a fact only the parent
history holds (real session, contributor model, empty workspace,
counts stated); a fresh spawn does not; (2) Explore/Plan cannot write
(toolset test + permission test on the real engine); (3) override test:
personal Explore wins. Red/green drill: drop the tool narrowing, watch
the write test fail, restore.
Safety limits: D121 — agent description totals warn, never block;
fork count bounded only by role/team/machine settings the person set
and provider limits; per-agent tools/permissions can only narrow (as
today, customAgents.ts).
```

### R4 — ACP draft-v2 + subagent child sessions

Decision needed: none to _start_ (D62/D213 lineage); the ACP SDK bump
respects the 7-day min-release-age and D3 peer checks. Coordinate with
`rv/acpteam` — land after it or rebase the design on it, lead's call;
do not duplicate its team admission.

```text
RSCH-CC R4: ACP draft-v2 and subagent child sessions in our ACP agent.
Goal: serve ACP protocol 2 when the client asks (v1 otherwise, both
from one binary, as @agentclientprotocol/claude-agent-acp v0.100.0
does — Apache-2.0, port designs with attribution, never their Claude
SDK coupling). On v2 (and on v1 for clients declaring subagents per the
RFD): each subagent is a child session — subagent_update before its
traffic (running / requires_action / idle with stop reason), launch
prompt and answer as linked session_messages, child cwd when isolated,
per-child session/cancel that stops only that child, replay restoring
children from transcripts. Without the capability, Agent stays a tool
call (today's behaviour). Bump @agentclientprotocol/sdk from 2.0.1 to
the newest past min-release-age; record per D3.
Base/machine: lane main on linuxlt (after rv/acpteam lands, or stacked
as the lead directs). Files: src/acp/agent.ts, src/acp/translate.ts,
src/runtime/runtimeEngineEntry.ts; new lazy bundle if size requires (D6).
Proves it (real code only): (1) protocol tests driving the real agent
over ndjson stdio with a real editor-shaped client script in
test/hosts/ style: v1 client sees today's bytes, v2 client sees child
sessions in order; (2) cancel-child test: parent turn continues;
(3) packaged-agent smoke: npm run package:acp output answers --help and
an initialize in a throwaway HOME with no sign-in. Red/green drill:
announce a child after its first traffic, watch the ordering test fail,
restore.
Safety limits: D121 — no cap of ours on children; cancel semantics are
the client's; replay never invents a parent it cannot prove (RFD rule).
```

### R5 — Claude plugin directory import (scanned, no marketplace)

Decision needed: a PLAN decision extending M83/D70 to Claude plugin
directories, including the explicit non-goals (no marketplace, no
in-process mods — mod modules are _reported and skipped_, never run).

```text
RSCH-CC R5: import a Claude Code plugin directory.
Goal: point Import at a Claude plugin folder (.claude-plugin/plugin.json)
and get a preview-first conversion of its skills, agents, hooks,
commands, output-style text (as rules, until R10) and MCP server entries
into our shapes via the M83 converter, each destination no more exposed
than its source (D64), never replacing an existing file. Before preview,
run a malicious-skill scan: static checks in the USENIX Security 2026
paper's technique list (arXiv:2602.06547 — shadow instructions, hidden/
bidi characters, credential-path reads, exfil URLs, shell in dynamic
context, brand impersonation) over SKILL.md bodies and scripts; every
hit is listed in the preview with the file and line, and a hit defaults
that component to not-imported. Show projected per-session token cost
(catalogue lines) as `claude plugin details` does. A plugin with a mod
hooks-module imports everything except the module, and says so.
Marketplace manifests are read only to locate a plugin directory the
person already has on disk — nothing is fetched or installed.
Base/machine: lane main on linuxlt. Files: src/core/import/
(agentImport.ts, importConvert.ts, new plugin reader), host preview UI,
constants. Manifest shapes come from real plugins captured locally
(AGENTS rule 14) plus code.claude.com/docs/en/plugins/manifest-reference.md
(read 2026-11-02) — capture two real marketplace plugins' manifests
into fixtures with dates before writing parsers.
Proves it (real code only): (1) import of a real captured plugin in a
throwaway HOME produces working skills/agents (invoked in a real
session on the contributor model, counts stated); (2) scanner drills:
each technique planted in a fixture skill is caught and defaulted off —
one red/green per technique family; (3) a mod-bearing plugin imports
without executing anything (process watch in test).
Safety limits: D121 — no limit of ours on plugin size beyond the
existing per-file read bounds every context file already has (D13);
the scan advises and defaults, the person can still import with eyes
open; imported hooks keep M51/M91 narrow-only semantics.
```

### R6 — Hardening pass from Claude's fix list (prove first)

Decision needed: none. This lane _starts_ by proving or clearing each
item in our code; fix only what reproduces.

```text
RSCH-CC R6: five Claude-paid bug classes, checked in ours.
Goal: for each item, write the failing reproduction first against real
code; if it does not reproduce, record the proof in the certification
file and move on. (1) SubagentStop fires once per subagent (Claude bug
until 2.1.311: ~twice a minute). (2) MCP allow rules match the whole
server name (Claude bug until 2.1.299: mcp__a allowed a__b). (3) A hook
that cannot start/times out/exits oddly follows its onFailure rule with
"block" available (Claude 2.1.295); check M51 semantics per event.
(4) PreCompact hook output is bounded before it can break compaction
(Claude 2.1.314: 10,000 chars — adopt as the person-settable default).
(5) Hook updatedInput is validated like model input, unknown keys
dropped, invalid denies (Claude 2.1.300). Also fix the stale PLAN.md
D42 sentence naming elicitation "not done" (PLAN.md:2712) in the same
lane, saying what actually remains.
Base/machine: lane main on linuxlt. Files: src/core/backends/modelapi/
hooks.ts, hookHandlers.ts, subagentTools.ts, mcp/, permissions.ts;
PLAN.md one sentence.
Proves it (real code only): one red test per reproducing item on the
real engine (count SubagentStop firings per subagent in a real run;
two real fixture MCP servers named a/a__b; a hook script that sleeps/
crashes; an oversized PreCompact hook; an updatedInput with an unknown
key), then green. Items that do not reproduce keep their test as the
standing proof.
Safety limits: bounds added are failure-survival only, at the cited
Claude-shipped values, person-settable where a setting already exists
for the family; nothing caps the person's work (D121).
```

### R7 — Person-set model fallback chain

Decision needed: none (D121 explicitly reserves limits to the person;
the chain _is_ the person's setting). Record in PLAN §6.

```text
RSCH-CC R7: person-set model fallback chains (Model API).
Goal: in model role settings, an ordered fallback list per role. On a
provider refusal classified as model-refusal, overload (429/529 after
the existing backoff), or missing-deployment, the request retries once
per listed model, in order, and the transcript + usage journal say
which model answered and why the earlier one did not (Claude's refusal
fallback, 2.1.312/2.1.314, but person-listed and cross-provider where
the person's accounts allow — never silent, never to a model the person
did not list, never past a paid-consent or account boundary without its
existing checks).
Base/machine: lane main on linuxlt. Files:
src/core/backends/modelapi/providerRefusal.ts, client.ts dispatch,
model role settings + capability records; constants.
Proves it (real code only): (1) against a real local endpoint fixture
that refuses then accepts (recorded real exchange per AGENTS no-fakes,
or the repo's existing provider fixtures): chain fires, journal rows
name both models and the refusal kind; (2) empty chain = today's
behaviour byte-identical; (3) chain never crosses into an unconsented
paid route. Red/green drill: fall back on a non-refusal 400, watch the
classification test fail, restore.
Safety limits: D121 — the chain length is the person's list (no cap of
ours); per-model retries keep today's cited backoff bounds; after the
list is exhausted the turn stops with every refusal said.
```

### R8+R10 — Cost attribution, script statusline, output styles (one small lane)

Decision needed: none.

```text
RSCH-CC R8R10: say what context costs; script statusline; output styles.
Goal: (a) per-session attribution in Account & usage / context view:
cache read vs creation tokens where the provider reports them, largest
contributors (always-on context, biggest tool results, effort) — our
answer to Claude's /usage warnings [2.1.299], from journal rows we
already write. (b) Optional statusline command: the person's command
gets session JSON on stdin (backend, model, effort, context %, session
cost, workspace), its first stdout line shows in the panel status area
and TUI; runs under the hook environment allowlist, no credentials,
output bounded and plain-text. (c) Output styles: named Markdown style
files (person/project) that replace only the behaviour section of the
instructions; ship two built-ins (Concise, Explanatory); style is part
of the cached prefix, switching warns that the next turn re-reads.
Base/machine: lane main on linuxlt. Files: src/core/usage/,
src/webview status area, src/runtime/tui/, instructions assembly in
src/core/backends/modelapi/instructions.ts; UI_TEXT + 14 tables.
Proves it (real code only): (a) attribution sums equal the journal total
on a recorded real session; (b) a real statusline script in a fixture
workspace renders its line and sees no credential env names (assert the
env list); (c) style changes only the behaviour section bytes; prefix
elsewhere identical. One small local look (npm run ui:look) light+dark.
Safety limits: D121 — attribution advises, never blocks; statusline
command timeout is a failure-survival bound (person-settable, stops and
says why); styles cannot widen permissions (text only).
```

R9 (skills parity slice), R11 URL elicitation and R12 (workflows) get
briefs when their prerequisites land (R3, the channels decision, the
D40 amendment respectively); writing them now would guess at shapes
those decisions own.

---

## 5. What a person would notice

A person who arrives from Claude Code with a folder full of skills,
agents, hooks and a plugin or two imports the lot in one previewed
step — with anything the malicious-skill scan dislikes unticked by
default — and then works in a harness that keeps Claude Code's good
manners (the same five mode names, plan-before-edit, checkpoints that
actually restore, memory that reads the same on both backends) while
fixing the three things Claude Code's own users file most: the bill is
itemised per request with consent before anything extra is spent, long
sessions compact by faithful truncation instead of summaries of
summaries so early instructions stop dissolving, and MCP servers no
longer tax every turn with schemas nobody called. The evidence for
each clause is in §1.4 (the complaints), §1.5 (the compaction papers)
and §2 (what already ships here); nothing in this paragraph requires a
model better than the one the person already picked.

# M96 research: agent roles and orchestration (2026-10-04)

This is the research behind D75 and M96 in `PLAN.md`. The owner asked for
agents (a model and who bills it) assigned to roles (research, design,
marketing, engineering, QA, code review, custom ones), with a cap per role
and per workspace, and for the main conversation's agent to orchestrate
them knowing the roles, the limits, and how and when to use them.

**Method.** Every source was read on 2026-10-04 (accessed date). Where a
page shows a date of its own, it is given as "page dated". Facts taken from
a project's source code rather than its documentation are marked
"source only"; anything not confirmed is marked "unconfirmed". No model
call was made for this research.

Three things moved since the last plans that cited them:

- **Roo Code shut down on 2026-05-15.** Its repository is archived and its
  docs redirect to a read-only copy (§2.1).
- **Kilo Code deprecated its Orchestrator mode** in its April 2026 rebuild,
  calling the coordinator pattern "overhead without adding capability"
  (§2.2).
- **Codex's documentation moved** from `developers.openai.com/codex` to
  `learn.chatgpt.com/docs` (308 redirect), and Codex removed its CSV batch
  agents (§1.2). MCP's `2026-07-28` specification moved long-running tasks
  into an official extension (§4.6).

## 1. The vendors' own agents, and what they say about cost

### 1.1 Claude Code: subagents and agent teams

Source for this section unless noted:
[code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents),
[code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams),
[code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)
(all accessed 2026-10-04; no page dates; features carry version notes).

- **Definitions** are Markdown with YAML front matter. Precedence on a
  name clash: managed settings, the `--agents` JSON, project
  `.claude/agents/`, `~/.claude/agents/`, then plugins. Only `name` and
  `description` are required.
- **Front matter:** `tools` (allowlist; omitted inherits all),
  `disallowedTools` (a pattern such as `Bash(git push *)` removes the whole
  tool), `model` (alias, full id or `inherit`), `permissionMode`,
  `maxTurns` (partial output, resumable), `skills` (preloaded),
  `mcpServers`, `hooks`, `memory`, `background`, `omitClaudeMd` (2.1.271+),
  `effort`, `isolation: worktree`, `color`, `initialPrompt`.
- **Routing.** Claude reads the request, each subagent's `description` and
  the context; the docs suggest "use proactively" in a description to
  encourage delegation. An @-mention forces it.
- **The tool** was renamed from Task to Agent in 2.1.63 (`Task(...)` stays an
  alias). `tools: Agent(worker, researcher)` restricts which types an agent
  run with `claude --agent` may spawn; `permissions.deny: ["Agent(Explore)"]`
  blocks a type.
- **Depth:** "By default, a subagent can spawn subagents of its own, up to
  three layers below the main conversation";
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` turns nesting off.
- **Concurrency:** at 20 running, a spawn "fails with `Concurrent subagent
limit reached`, and the error tells Claude not to retry"
  (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`).
- **Context:** "Each subagent starts with a fresh, isolated context
  window. It doesn't see your conversation history." It gets its own
  prompt and the delegation message, CLAUDE.md, a git status snapshot,
  preloaded skills and (2.1.206+) a roster of its siblings; it returns
  "only the summary". Forks are the exception and inherit the conversation.
- **Approvals:** a background subagent's permission prompts "surface in your
  main session" naming the subagent.
- **Model order:** the call's `model`, the front matter's,
  `CLAUDE_CODE_SUBAGENT_MODEL`, the main model.
- **Transcripts** persist per subagent
  (`~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`)
  and a subagent can be resumed by id or name.
- **When the docs say not to delegate:** "lots of back-and-forth", shared
  context across phases, or when latency matters.
- **Agent teams** (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`):
  a fixed lead, teammates that are separate Claude Code instances, a shared
  task list with dependencies and file-locked claiming, and a mailbox per
  teammate. Teammates inherit the lead's permission mode (not settable per
  teammate) and their prompts appear in the lead's session; "a teammate
  can't approve a permission prompt or supply consent on your behalf".
  Limits: one team per session, no nested teams; "no hard limit on the
  number of teammates", with 3–5 suggested.
- **Team cost:** teams use "approximately 7x more tokens than standard
  sessions when teammates run in plan mode"
  ([code.claude.com/docs/en/costs](https://code.claude.com/docs/en/costs),
  accessed 2026-10-04).
- **Hooks** (every hook inside a subagent also gets `agent_id` and
  `agent_type`):
  - `SubagentStart`: on spawn, on resume, and each time an in-process
    teammate handles a message; matches on agent type; input `agent_id`,
    `agent_type`; cannot block; may return `additionalContext`.
  - `SubagentStop`: input `stop_hook_active`, `agent_id`, `agent_type`,
    `agent_transcript_path`, `last_assistant_message`, `background_tasks`,
    `session_crons`; exit 2 or `decision: "block"` keeps it running with
    the reason as its next instruction.
  - `TaskCreated` and `TaskCompleted`: input `task_id`, `task_subject`,
    optional `task_description` and `teammate_name` (`team_name`
    deprecated); exit 2 deletes the task, or stops it being marked
    complete.
  - `TeammateIdle`: input `teammate_name` (`team_name` deprecated); exit 2
    keeps the teammate working; `{"continue": false}` stops it.

### 1.2 Codex CLI: subagents

Sources:
[learn.chatgpt.com/docs/agent-configuration/subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[learn.chatgpt.com/docs/config-file/config-reference](https://learn.chatgpt.com/docs/config-file/config-reference)
(accessed 2026-10-04), and the source files named below.

- **On by default:** `agents.enabled` defaults to true and
  `features.multi_agent` is "stable; on by default", giving the tools
  `spawn_agent`, `send_input`, `resume_agent`, `wait_agent` and
  `close_agent`.
- **Roles** are TOML files in `~/.codex/agents/` or `.codex/agents/` with
  `name`, `description` and `developer_instructions`, plus any config key
  (`model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`,
  `skills.config`); what a file leaves out comes from the parent. Built-in
  roles: `default`, `worker`, `explorer`; a custom role of the same name
  overrides one.
- **Model order:** the spawn's value, then the `[agents]` default, then
  the parent's; a role file's `model` or effort wins.
- **Concurrency:** `agents.max_concurrent_threads_per_session` (spawned
  threads only); "Codex chooses the default". Source only: 6 for v1, and 4
  for multi_agent_v2 counting the primary
  ([codex-rs/core/src/config/mod.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs),
  accessed 2026-10-04).
- **Depth,** source only: `max_depth` defaults to 1, and at the limit spawn
  answers "Agent depth limit reached. Solve the task yourself."
  ([multi_agents/spawn.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs),
  accessed 2026-10-04). `spawn_agent` takes `message` or `items`,
  `agent_type`, `model`, `reasoning_effort` and `fork_context`.
- **Approvals:** "Subagents inherit your current sandbox policy"; prompts
  from other threads carry the thread's label; in a non-interactive run an
  action needing a new approval fails back to the parent; live overrides
  (`/permissions`, `--yolo`) are reapplied to every child.
- **When it delegates:** on a direct request or an instruction that says
  so; proactive delegation only at its "Ultra" level.
- **Its own guidance:** parallel agents for "read-heavy tasks"; "Be more
  careful with parallel write-heavy workflows"; subagents "consume more
  tokens than comparable single-agent runs".
- **CSV batch agents were removed:** added 2026-02-24
  ([PR #10935](https://github.com/openai/codex/pull/10935)), removed
  2026-07-20 ([PR #34413](https://github.com/openai/codex/pull/34413)).
- Codex config also has `SubagentStart` and `SubagentStop` hooks.

### 1.3 Published guidance: when several agents pay

- **Anthropic, "How we built our multi-agent research system"** (page dated
  2025-06-13,
  [anthropic.com/engineering/multi-agent-research-system](https://www.anthropic.com/engineering/multi-agent-research-system),
  accessed 2026-10-04):
  - an Opus lead with Sonnet subagents "outperformed single-agent Claude
    Opus 4 by 90.2%" on an internal research evaluation;
  - "agents typically use about 4× more tokens than chat… multi-agent
    systems use about 15× more tokens than chats";
  - token use explained 80% of the variance on BrowseComp;
  - parallel tool calls cut research time "by up to 90%";
  - effort should scale: one agent with 3–10 calls for a simple question,
    2–4 subagents for comparisons, 10 or more for complex research, and
    early versions spawned "50 subagents for simple queries";
  - "Each subagent needs an objective, an output format, guidance on the
    tools and sources to use, and clear task boundaries";
  - a poor fit when agents share context or have many dependencies: "most
    coding tasks involve fewer truly parallelizable tasks than research".
- **Anthropic, "Building effective agents"** (page dated 2024-12-19,
  [anthropic.com/engineering/building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents),
  accessed 2026-10-04): start with "the simplest solution possible"; the
  orchestrator-workers pattern fits "complex tasks where you can't predict
  the subtasks needed"; parallel work is sectioning or voting.
- **Cognition, "Don't Build Multi-Agents"** (page dated 2025-06-12,
  [cognition.com/blog/dont-build-multi-agents](https://cognition.com/blog/dont-build-multi-agents),
  accessed 2026-10-04): "Share context, and share full agent traces, not
  just individual messages"; "Actions carry implicit decisions, and
  conflicting decisions carry bad results".
- **OpenAI, "A practical guide to building agents"** (PDF, no date found,
  [cdn.openai.com/…/a-practical-guide-to-building-agents.pdf](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf),
  accessed 2026-10-04): "maximize a single agent's capabilities first";
  split when prompts carry many conditions or tools overlap.

**What D75 takes from §1.** Separate depth and concurrency limits, with a
refusal that tells the model to do the work itself rather than retry; the
description as the routing contract; a fixed model order; children never
wider than the parent, their prompts in the parent's UI with a label; a
fresh context with a summary back and the full trace kept for the user;
fan-out scaled to the task; per-role token tracking because the cost
multiple is large; and parallel writers kept apart.

## 2. IDE agents: modes, orchestrators, parallel work

### 2.1 Roo Code (shut down)

- "The Roo Code Extension was shut down on May 15th"; the repository is
  archived ([roocodeinc.github.io/Roo-Code](https://roocodeinc.github.io/Roo-Code/),
  page dated 2026-05-15; [github.com/RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code);
  both accessed 2026-10-04). Its design is still the reference most others
  copied.
- **Modes and tool groups**
  ([packages/types/src/mode.ts](https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/packages/types/src/mode.ts),
  [using-modes](https://roocodeinc.github.io/Roo-Code/basic-usage/using-modes),
  accessed 2026-10-04): Code and Debug have read, edit, command, mcp; Ask
  has read, mcp; Architect has read, mcp and edit limited to `\.md$`;
  Orchestrator has no groups and can only delegate with `new_task`. The
  `browser` group was removed in 3.48.0
  ([PR #11392](https://github.com/RooCodeInc/Roo-Code/pull/11392), merged
  2026-02-12).
- **Custom modes**
  ([custom-modes](https://roocodeinc.github.io/Roo-Code/features/custom-modes),
  page dated 2026-05-15, accessed 2026-10-04): `.roomodes` (project) or
  `custom_modes.yaml` (global); fields `slug`, `name`, `roleDefinition`,
  `groups`, optional `whenToUse`, `description`, `customInstructions`.
  `whenToUse` is "guidance for Roo's automated decision-making,
  particularly for mode selection and task orchestration" and is not shown
  in the UI; `description` is the picker's summary. A project mode with the
  same slug "completely overrides the global one". The edit group takes a
  `fileRegex` restriction. Per-mode rules live in `.roo/rules-{slug}/`.
  "Sticky models" remember the last model used per mode; there is no
  `model` field.
- **Boomerang tasks**
  ([new-task](https://roocodeinc.github.io/Roo-Code/advanced-usage/available-tools/new-task),
  [boomerang-tasks](https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks),
  [auto-approving-actions](https://roocodeinc.github.io/Roo-Code/features/auto-approving-actions),
  page dated 2026-05-15, accessed 2026-10-04): `new_task(mode, message,
todos?)`; the parent pauses, so subtasks run one at a time; "Each
  subtask operates in complete isolation with its own conversation
  history"; the child's `attempt_completion` result "is the source of
  truth"; subtasks ask for approval unless auto-approved; no depth limit is
  documented.

### 2.2 Kilo Code

- **The April 2026 rebuild**
  ([kilo.ai/docs/…/whats-new](https://kilo.ai/docs/code-with-ai/platforms/vscode/whats-new),
  accessed 2026-10-04): modes became agents, subagents run in parallel, an
  Agent Manager was added, and the model picker shows cost.
- **Agents** ([custom-modes](https://kilo.ai/docs/customize/custom-modes),
  [custom-subagents](https://kilo.ai/docs/customize/custom-subagents),
  accessed 2026-10-04): Markdown with YAML front matter in `.kilo/agents/`
  or `~/.config/kilo/agents/`; fields `description`, `mode` (primary,
  subagent, all), `model`, `permission`, `steps` ("Maximum agentic
  iterations before forcing a text-only response. Useful for cost
  control"), `hidden` and others. Called through the Task tool when the
  description matches, or with `@name`; `background: true` returns at once.
- **Permissions**
  ([agent-permissions](https://kilo.ai/docs/customize/agent-permissions),
  accessed 2026-10-04): allow, ask or deny per tool with globs, last match
  wins; `permission.task` limits which subagents an agent may call; `.env`
  files always ask.
- **The Orchestrator is deprecated**
  ([orchestrator-mode](https://kilo.ai/docs/code-with-ai/agents/orchestrator-mode),
  accessed 2026-10-04): "Deprecated — scheduled for removal"; Code, Plan
  and Debug delegate directly. Subagents in one workspace "do not isolate
  file edits". The migration guide says "the explicit coordinator pattern
  added overhead without adding capability"
  ([roo-to-kilo-migration-guide](https://kilo.ai/articles/roo-to-kilo-migration-guide),
  page dated 2026-04-22, accessed 2026-10-04).
- **Agent Manager** ([agent-manager](https://kilo.ai/docs/automate/agent-manager),
  accessed 2026-10-04; [blog](https://blog.kilo.ai/p/agent-manager-run-multiple-agents),
  page dated 2026-06-08): parallel sessions, each in its own git worktree
  and branch; up to 4 versions of one prompt on different models; at most
  20 tasks per request; a setup script per worktree; "Apply to local".

### 2.3 Cline

- **Plan and Act** ([plan-and-act](https://docs.cline.bot/features/plan-and-act),
  accessed 2026-10-04): Plan reads and discusses but "cannot modify any
  files or execute commands"; each mode can have its own model.
- **Subagents** ([subagents](https://docs.cline.bot/features/subagents),
  accessed 2026-10-04): read-only and parallel (read, list, regex search,
  code definitions, read-only commands, skills); no writes, patches,
  browser, MCP, web search or nested subagents. Release 3.58.0 replaced the
  earlier ones with the `use_subagents` tool
  ([v3.58.0](https://github.com/cline/cline/releases/tag/v3.58.0); its year
  is unconfirmed).
- **CLI 2.0** ([blog](https://cline.bot/blog/introducing-cline-cli-2-0),
  page dated 2026-02-13): isolated instances, `-y` headless, `--json`, and
  `--acp` to run as an ACP agent. Over ACP "Nothing is auto-approved by
  default" ([usage/acp](https://docs.cline.bot/usage/acp), accessed
  2026-10-04).
- **Agent teams** in the CLI only
  ([cli/agent-teams](https://docs.cline.bot/cli/agent-teams), accessed
  2026-10-04): a coordinator, a task board, a mailbox and a mission log
  under `~/.cline/data/teams/<name>/`. Whether teammates run at once is
  unconfirmed.

### 2.4 VS Code custom agents, and Cursor

- **VS Code custom agents**
  ([custom-agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents),
  page dated 2026-09-30, accessed 2026-10-04): `.agent.md` in
  `.github/agents` or `.claude/agents` (and user folders), with
  `description`, `tools`, `agents`, `model` (an ordered list, tried "until
  an available one is found"), `handoffs` (`label`, `agent`, `prompt`,
  `send`, `model`: buttons after a response) and others.
- **VS Code subagents**
  ([subagents](https://code.visualstudio.com/docs/copilot/agents/subagents),
  page dated 2026-09-30): a subagent "doesn't inherit the main conversation
  history"; `agents` limits which may be called; nesting through a setting,
  up to depth five; parallel since 1.109
  ([v1_109](https://code.visualstudio.com/updates/v1_109), released
  2026-02-04).
- **VS Code on worktrees:** "A Git worktree keeps code changes separate,
  but isn't a security boundary"
  ([agents/overview](https://code.visualstudio.com/docs/copilot/agents/overview),
  page dated 2026-09-30). Its multi-agent post describes "a research agent
  with read-only access and web search tools, an implementation agent with
  full editing capabilities, a security agent", chained by handoffs
  ([blog](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development),
  page dated 2026-02-05).
- **Cursor:** 2.0 runs "up to eight agents in parallel on a single prompt"
  on git worktrees or remote machines
  ([changelog 2.0](https://cursor.com/changelog/2-0), page dated
  2025-10-29); worktrees per run with apply and delete, up to 25 per device
  ([worktrees](https://cursor.com/docs/configuration/worktrees)); subagents
  in `.cursor/agents`, `.claude/agents` or `.codex/agents` with `model`,
  `readonly` and `is_background`, one level of nesting, each "billed at its
  model's list price" ([subagents](https://cursor.com/docs/subagents)); all
  accessed 2026-10-04.

**What D75 takes from §2.** Roles as Markdown files with a routing field
apart from the display text, project files shadowing personal ones;
per-tool policy with a path filter on writes; read-only research and
review by default; the child knows only its message and returns a
structured result; caps on steps, depth and width, and on which roles a
role may call; a worktree per parallel writer with an apply-back action
and the honest caveat that it is no sandbox; a model per role with
fallbacks; cost shown per role; and no special orchestrator role.

## 3. Multi-agent frameworks

### 3.1 OpenAI Agents SDK

Sources: [multi_agent](https://openai.github.io/openai-agents-python/multi_agent/),
[handoffs](https://openai.github.io/openai-agents-python/handoffs/),
[tools](https://openai.github.io/openai-agents-python/tools/),
[running_agents](https://openai.github.io/openai-agents-python/running_agents/),
[guardrails](https://openai.github.io/openai-agents-python/guardrails/),
[human_in_the_loop](https://openai.github.io/openai-agents-python/human_in_the_loop/),
[usage](https://openai.github.io/openai-agents-python/usage/) (all accessed
2026-10-04).

- **Two shapes.** The manager pattern: "A manager agent keeps control of
  the conversation and calls specialist agents through `Agent.as_tool()`".
  Handoffs: the specialist "becomes the active agent for the rest of the
  turn" (a tool named `transfer_to_<agent>`).
- **Context.** A handoff sees "the entire previous conversation history"
  unless an `input_filter` trims it; an agent used as a tool gets only
  `{"input": "..."}` or structured parameters.
- **Limits.** `max_turns` raises `MaxTurnsExceeded` (default 10, source
  only, [run_config.py](https://raw.githubusercontent.com/openai/openai-agents-python/main/src/agents/run_config.py)).
- **Guardrails** run on the first agent's input and the last agent's
  output only; tool guardrails skip handoffs.
- **Approvals.** `needs_approval` pauses the run into a serialisable
  `RunState` with `approve()` and `reject()`; "always" decisions persist.
- **Cost.** Usage is totalled per run; no budget is enforced.

### 3.2 CrewAI

Sources: [agents](https://docs.crewai.com/en/concepts/agents),
[tasks](https://docs.crewai.com/en/concepts/tasks),
[crews](https://docs.crewai.com/en/concepts/crews),
[processes](https://docs.crewai.com/en/concepts/processes),
[collaboration](https://docs.crewai.com/en/concepts/collaboration),
[execution-hooks](https://docs.crewai.com/en/learn/execution-hooks) (all
accessed 2026-10-04).

- **Agents** have `role`, `goal` and `backstory`, `allow_delegation`
  (default false), `max_iter` (20 on one page, 25 on another),
  `max_rpm`, `max_execution_time` and `max_retry_limit`.
- **Processes.** Sequential passes each output on; hierarchical has a
  manager (`manager_llm` or `manager_agent`) that "allocates tasks to
  agents based on their capabilities, reviews outputs, and assesses task
  completion".
- **Delegation tools:** "Delegate work to coworker" and "Ask question to
  coworker"; the docs advise delegation on for coordinators and off for
  specialists.
- **Guardrails** on a task send the error back and retry, up to
  `guardrail_max_retries` (3).
- **Cost.** Rate, iterations and time are enforced; no token or dollar
  budget is documented.

### 3.3 AutoGen, AG2 and Microsoft Agent Framework

- AutoGen "is now in maintenance mode"; "New users should start with
  Microsoft Agent Framework" ([github.com/microsoft/autogen](https://github.com/microsoft/autogen),
  accessed 2026-10-04), its successor with Sequential, Concurrent, Handoff,
  Group Chat and Magentic orchestrations
  ([agent-framework overview](https://learn.microsoft.com/en-us/agent-framework/overview/),
  page dated 2026-07-29).
- **Teams** ([teams](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html),
  [selector-group-chat](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/selector-group-chat.html),
  [swarm](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/swarm.html),
  [magentic-one](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/magentic-one.html),
  accessed 2026-10-04): round robin; a selector that picks the next speaker
  from `{roles}` (names and descriptions) with `candidate_func` to narrow
  the pool; a swarm of handoffs where "All agents share the same message
  context"; and Magentic-One's orchestrator with a task ledger and a
  progress ledger that replans when progress stalls (`max_turns=20`,
  `max_stalls=3`).
- **Termination** ([termination](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/termination.html),
  accessed 2026-10-04): eleven conditions combined with `|` and `&`,
  including `TokenUsageTermination` and `TimeoutTermination`, the only hard
  token cap found in any framework.
- **AG2** ([patterns](https://docs.ag2.ai/latest/docs/user-guide/advanced-concepts/orchestration/group-chat/patterns/),
  accessed 2026-10-04): default, auto, round robin, random and manual
  patterns, run under `max_rounds`.

### 3.4 Google ADK, and A2A

- **Routing by description** ([llm-agents](https://adk.dev/agents/llm-agents/),
  accessed 2026-10-04): an agent's `description` "is primarily used by
  _other_ LLM agents to determine if they should route a task to this
  agent"; `include_contents='none'` gives an agent no prior history.
- **Delegation** ([workflows/patterns](https://adk.dev/workflows/patterns/),
  accessed 2026-10-04): `transfer_to_agent` hands the conversation over;
  `AgentTool` keeps it and returns the answer. An agent used as a tool
  "runs in its own session and cannot access the calling agent's
  conversation history or state"
  ([Google Cloud blog](https://cloud.google.com/blog/topics/developers-practitioners/where-to-use-sub-agents-versus-agents-as-tools),
  page dated 2025-11-07).
- **ADK 2.0 task mode** ([collaboration](https://adk.dev/workflows/collaboration/),
  accessed 2026-10-04): a task agent returns with `finish_task` and must be
  a leaf; task and single-turn agents run in isolated session branches.
- **Workflow agents:** `ParallelAgent` shares no history between branches,
  each writing its own key; `LoopAgent` "does not inherently decide when to
  stop looping" and needs `max_iterations` or an escalation
  ([loop-agents](https://adk.dev/agents/workflow-agents/loop-agents/),
  [parallel-agents](https://adk.dev/agents/workflow-agents/parallel-agents/),
  accessed 2026-10-04).
- **Limits:** `RunConfig.max_llm_calls`, default 500
  ([runconfig](https://adk.dev/runtime/runconfig/), accessed 2026-10-04).
- **Approvals:** `require_confirmation`, a boolean or a function of the
  arguments ([confirmation](https://adk.dev/tools-custom/confirmation/),
  accessed 2026-10-04).
- **A2A 1.0.0** ([specification](https://a2a-protocol.org/latest/specification/),
  [agent-discovery](https://a2a-protocol.org/latest/topics/agent-discovery/),
  accessed 2026-10-04): tasks with states (submitted, working,
  input-required, auth-required, completed, failed, canceled, rejected) and
  an agent card at `/.well-known/agent-card.json` naming skills and auth.
  Agents stay opaque to each other. It is for remote services; a local
  editor's workers are better served by ACP (§4).

### 3.5 LangGraph and LangChain

- **The supervisor library steps back:** "We now recommend using the
  supervisor pattern directly via tools rather than this library for most
  use cases" ([langgraph-supervisor-py](https://github.com/langchain-ai/langgraph-supervisor-py),
  accessed 2026-10-04). Its defaults: `output_mode="last_message"` and
  `parallel_tool_calls=False`; it offers a `forward_message` tool.
- **LangChain's patterns** ([multi-agent](https://docs.langchain.com/oss/python/langchain/multi-agent),
  [subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents),
  accessed 2026-10-04): subagents get "only the task description" by
  default and can run in the background (start, check status, collect).
- **Limits:** "Starting in version 1.0.6, the default recursion limit is
  set to 1000 steps" ([graph-api](https://docs.langchain.com/oss/python/langgraph/graph-api));
  call-limit middleware, no dollar budget
  ([middleware](https://docs.langchain.com/oss/python/langchain/middleware/built-in));
  both accessed 2026-10-04.
- **The benchmark** (page dated 2025-06-10,
  [benchmarking-multi-agent-architectures](https://www.langchain.com/blog/benchmarking-multi-agent-architectures),
  accessed 2026-10-04): the supervisor "consistently uses more tokens"
  because it relays every answer (the "telephone" problem). Removing
  handoff messages from the subagent's state and adding `forward_message`,
  so a reply passes through without being regenerated, gave "a nearly 50%
  increase in performance".

**What D75 takes from §3.** The orchestrator keeps control (agents as
tools, not handoffs: the user's conversation stays with the main agent);
the description routes; workers get the task only; results reach the user
directly instead of being relayed; caps on turns, calls, time and rate are
enforced in code; the money budget has to be built, since none of the five
frameworks enforces one; approvals are resumable state; every level is
guarded, delegations included; loops are bounded explicitly; parallel
workers write apart.

## 4. External agents over ACP, and long MCP calls

### 4.1 The Agent Client Protocol

Sources: [transports](https://agentclientprotocol.com/protocol/transports),
[initialization](https://agentclientprotocol.com/protocol/initialization),
[overview](https://agentclientprotocol.com/protocol/overview),
[authentication](https://agentclientprotocol.com/protocol/authentication),
[session-setup](https://agentclientprotocol.com/protocol/session-setup),
[prompt-turn](https://agentclientprotocol.com/protocol/prompt-turn),
[tool-calls](https://agentclientprotocol.com/protocol/tool-calls),
[session-modes](https://agentclientprotocol.com/protocol/session-modes),
[session-config-options](https://agentclientprotocol.com/protocol/session-config-options),
[file-system](https://agentclientprotocol.com/protocol/file-system),
[terminals](https://agentclientprotocol.com/protocol/terminals),
[releases](https://github.com/agentclientprotocol/agent-client-protocol/releases)
(all accessed 2026-10-04).

- **Transport.** The client starts the agent as a subprocess, and they speak
  JSON-RPC 2.0 over stdin and stdout, one message per line. The agent may
  log to stderr. A Streamable HTTP transport is still a draft.
- **Version.** `protocolVersion` is the integer 1. The latest schema
  release is 1.24.1 (2026-09-30), and a v2 schema is in alpha
  (`schema-v2.0.0-alpha.7`).
- **The client must serve** `session/request_permission` and receive
  `session/update`. It may also serve `fs/read_text_file`,
  `fs/write_text_file`, `terminal/*` and `elicitation/create`, each behind
  a client capability.
- **The agent serves** `initialize`, `authenticate`, `session/new`,
  `session/prompt` and `session/cancel`. Behind its capabilities it also
  serves load, list, resume, close, delete, `set_mode`,
  `set_config_option` and logout.
- **Sign-in.** Each auth method has an `id`, a `name` and a `type`.
  - For `type: "terminal"`, the client runs the agent's program
    interactively and reconnects when it exits 0; it "MUST NOT send an
    `authenticate` request for a terminal method".
  - A request that needs a sign-in fails with `auth_required`.
- **`session/new`** takes an absolute `cwd` and `mcpServers`. Every agent
  must support stdio MCP servers; HTTP ones only when it advertises them.
  So a client can hand an agent extra tools.
- **Updates and stops.** Updates: message, thought, `tool_call`,
  `tool_call_update`, `plan`, commands, mode, config option, session info
  and `usage_update`. Stop reasons: `end_turn`, `max_tokens`,
  `max_turn_requests`, `refusal`, `cancelled`. On cancel, "The Client MUST
  respond to all pending `session/request_permission` requests with the
  `cancelled` outcome."
- **Permissions.** A tool call carries a `kind` (read, edit, delete, move,
  search, execute, think, fetch, switch_mode, other), `locations`, a diff
  and `rawInput`. Each permission option is `allow_once`, `allow_always`,
  `reject_once` or `reject_always`.
- **Modes.**
  - `session/set_mode` is deprecated: "Dedicated session mode methods will
    be removed in a future version."
  - `session/set_config_option` replaces it, with the categories `mode`,
    `model`, `model_config` and `thought_level`.
  - `session/set_model` was removed on 2026-06-01 as "never-stabilized"
    ([updates](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/updates.mdx)).
- **Files.** The file-system page says nothing about restricting paths.
- **The TypeScript SDK.**
  - `@agentclientprotocol/sdk` is at 1.7.0 (2026-10-02, npm metadata); we
    pin 1.5.0 (Q61).
  - Its client is the `acp.client({ name })` builder with `connectWith`;
    `ClientSideConnection` is deprecated
    ([acp.ts](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/acp.ts),
    [examples/client.ts](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/client.ts)).

### 4.2 Claude over ACP

- **The adapter.** `@zed-industries/claude-code-acp` is deprecated and
  renamed `@agentclientprotocol/claude-agent-acp`, at 0.85.1 (2026-10-02).
  - It wraps the Claude Agent SDK and installs `claude-agent-acp`
    ([releases](https://github.com/agentclientprotocol/claude-agent-acp/releases),
    [README](https://github.com/agentclientprotocol/claude-agent-acp),
    accessed 2026-10-04).
  - Its modes are `default`, `acceptEdits`, `plan`, `bypassPermissions`,
    `dontAsk` and `auto`
    ([session-mode.ts](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/session-mode.ts)).
  - Since 0.18.0 it uses Claude's built-in tools and "won't use client
    capabilities for files or terminals"
    ([CHANGELOG](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/CHANGELOG.md)).
- **Sign-in.** It offers terminal methods: "Claude Subscription",
  "Anthropic Console (API usage billing)" and a remote login.
  `--hide-claude-auth` hides the subscription and refuses its credentials
  ([acp-agent.ts](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/acp-agent.ts),
  [hide-claude-auth.ts](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/hide-claude-auth.ts)).
  JetBrains' registry entry starts it with that flag; the main registry's
  does not
  ([registry-for-jetbrains.json](https://cdn.agentclientprotocol.com/registry/v1/latest/registry-for-jetbrains.json),
  [registry.json](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json)).
- **An open bug.** Stdio MCP servers passed in `session/new` were "never
  even spawned" on 0.70.0
  ([issue #883](https://github.com/agentclientprotocol/claude-agent-acp/issues/883));
  a fix in 0.85.1 is unconfirmed.
- **Anthropic's terms**, quoted:
  - "Unless previously approved, Anthropic does not allow third party
    developers to offer claude.ai login or rate limits for their products,
    including agents built on the Claude Agent SDK"
    ([agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview),
    accessed 2026-10-04).
  - "Anthropic does not permit third-party developers to offer Claude.ai
    login into their own applications, or to route requests through Free,
    Pro, or Max plan credentials on behalf of their users … developers may
    not collect, store, or intermediate Claude.ai credentials or session
    tokens." The same page: this does not "prevent an end user from signing
    in to the unmodified Claude Code binary with their own Claude
    subscription"
    ([legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance),
    accessed 2026-10-04).
  - Anthropic's support article says Agent SDK and third-party app usage
    "still draw from your subscription's usage limits"
    ([support article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan),
    page dated 2026-06-16).
  - Zed calls ACP the "blessed path"
    ([Zed blog](https://zed.dev/blog/anthropic-subscription-changes), page
    dated 2026-05-14, updated 2026-06-16), and says plan subscriptions keep working through it.
- **Reading.** Whether an extension that launches the adapter for the user
  "routes requests" in Anthropic's sense is unresolved. D75's default
  (`--hide-claude-auth`, API billing only) is the reading that cannot
  breach it, and D75's decisions take it: a user's own plan is reached only
  through a custom entry the user writes.

### 4.3 Codex over ACP

- **The adapter.** `zed-industries/codex-acp` is archived. Its successor is
  `@agentclientprotocol/codex-acp` 2.1.1 (2026-10-01), whose registry
  authors are OpenAI, JetBrains and Zed
  ([releases](https://github.com/agentclientprotocol/codex-acp/releases),
  [README](https://github.com/agentclientprotocol/codex-acp), accessed
  2026-10-04).
  - It starts the Codex App Server and bundles `@openai/codex`.
  - Modes: `read-only`, `workspace-write`, `agent`, `agent-full-access`.
  - Auth methods: `api-key`, `chat-gpt`, `chat-gpt-device-code`, `gateway`
    ([CodexAuthMethod.ts](https://github.com/agentclientprotocol/codex-acp/blob/main/src/CodexAuthMethod.ts)).
  - Inferred from its code: it uses its own sandbox, not the client's file
    methods.
- **Terms.** Codex's docs: ChatGPT sign-in is "for subscription access",
  and "API keys are still the recommended default for automation"
  ([auth](https://learn.chatgpt.com/docs/auth), accessed 2026-10-04). Zed:
  "OpenAI continues to support subscription-based access for third-party
  tools" ([Zed blog](https://zed.dev/blog/chatgpt-subscription-in-zed),
  page dated 2026-05-15). OpenAI's Terms of Use wording on automated access
  could not be read (403): unconfirmed.

### 4.4 Gemini CLI and Copilot CLI over ACP

- **Gemini CLI.**
  - The flag is `gemini --acp`; `--experimental-acp` is "deprecated, use
    --acp instead"
    ([config.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/config/config.ts),
    [acp-mode.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md),
    accessed 2026-10-04).
  - Sign-in: Google account, Gemini API key, Vertex AI or a gateway.
  - It routes file access through the client but falls back to its own for
    paths outside the project root and for `~/.gemini`
    ([acpFileSystemService.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/acpFileSystemService.ts)).
  - Its terms: "Directly accessing the services powering Gemini CLI …
    using third-party software … is a violation"; spawning the unmodified
    CLI is the documented IDE path
    ([tos-privacy.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md)).
- **Copilot CLI:** `copilot --acp [--stdio | --port N]`, in public
  preview. It can run with the user's own key without a GitHub sign-in
  ([acp-server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server),
  accessed 2026-10-04).

### 4.5 The ecosystem, and a client inside VS Code

- **Agents.** The ACP site lists 40 agents and the registry 41. Among them:
  Goose, OpenCode, Augment, Cline, Cursor, Factory Droid, GitHub Copilot,
  Junie, Kimi CLI, Kiro, Mistral Vibe, OpenHands, Qwen Code, Grok Build,
  Devin and Kilo
  ([agents](https://agentclientprotocol.com/get-started/agents),
  [registry.json](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json),
  accessed 2026-10-04).
- **Clients.** Zed, JetBrains AI Assistant
  ([acp](https://www.jetbrains.com/help/ai-assistant/acp.html), page dated
  2026-07-22), Neovim (CodeCompanion, avante.nvim, agentic.nvim), Emacs
  agent-shell, marimo and Obsidian
  ([clients](https://agentclientprotocol.com/get-started/clients)).
- **VS Code extensions that are ACP clients already exist:**
  - ACP Client ([formulahendry/vscode-acp](https://github.com/formulahendry/vscode-acp),
    last push 2026-05-16, on SDK 0.21);
  - ACP Patchbay ([solutionsunity/acp-patchbay](https://github.com/solutionsunity/acp-patchbay),
    0.84.1, 2026-09-29);
  - ACP Pro, Multicoder and Poolside Assistant.
- **VS Code's own agent host** speaks its own Agent Host Protocol, not ACP
  ([blog](https://code.visualstudio.com/blogs/2026/08/26/agent-host-architecture),
  page dated 2026-08-26).
- **What confines a worker.** Client file and terminal methods do not:
  Claude's and Codex's adapters ignore them, and Gemini skips them outside
  its root. What does confine a worker:
  - the agent's own sandbox (Codex `workspace-write`; Claude's permission
    settings);
  - rejecting a permission request whose `locations` or `rawInput` paths
    resolve outside the worktree after links are followed;
  - checking every path in any file or terminal method the client serves.

  A Windows job object bounds a process tree's lifetime, not what it can
  read or write.

### 4.6 The registry, and long MCP calls

- **The ACP registry** is
  `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`,
  "a curated list of agents that support user authentication", checked in
  CI ([registry](https://github.com/agentclientprotocol/registry),
  accessed 2026-10-04).
  - Each entry has `id`, `name`, `version`, `repository`, `authors`,
    `license` and `icon`.
  - Its `distribution` is `npx`, `uvx`, or a `binary` per platform with
    its `sha256`.
- **A custom agent** is added in Zed as
  `{"agent_servers":{"my-agent":{"type":"custom","command":"node","args":["…","--acp"],"env":{}}}}`
  ([external-agents](https://zed.dev/docs/ai/external-agents), accessed
  2026-10-04). JetBrains uses the same map.
- **Long MCP calls.** The 2026-07-28 MCP specification moves "experimental
  tasks out of the core protocol and into an official extension
  (`io.modelcontextprotocol/tasks`)". It polls with `tasks/get`, adds
  `tasks/update`, and lets "servers … return task handles unsolicited"
  ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog),
  accessed 2026-10-04; SEP-2663).
  - The same revision removes the `initialize` handshake.
  - It says "A broken response stream loses the in-flight request; clients
    MUST re-issue it as a new request with a new request ID". D75's
    `command_id` exists because of this.
  - Servers "SHOULD return tools from `tools/list` in a deterministic order
    to enable client-side caching and improve LLM prompt cache hit rates".
  - The 2025-11-25 tasks page is
    [basic/utilities/tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks).

### 4.7 Rate limits, plan limits and Muse Code's own knobs

- **Meta's Model API**
  ([pricing-rate-limits](https://dev.meta.ai/docs/pricing-rate-limits),
  accessed 2026-10-04; no page date):
  - Standard: "3,000" requests and "4,000,000" tokens per minute.
  - Contributor: "100" requests and "3,000,000" tokens per minute.
  - The limits apply "per team, not per API key".
  - Successful responses carry `x-ratelimit-limit-tokens`,
    `x-ratelimit-remaining-tokens`, `x-ratelimit-limit-requests` and
    `x-ratelimit-remaining-requests`.
  - On 429, the page advises "exponential backoff with jitter. Start with a
    short delay such as 500 ms, double it after each consecutive rate-limit
    response."
  - Background submissions are limited separately (600 per minute per
    team), and Muse Image to 150 requests per minute.
- **Muse Spark's parameters** (M94 research A2–A4 and A11, from
  dev.meta.ai's reasoning, Responses and Chat Completions pages):
  - Effort is `minimal` to `xhigh`, and `max` on Standard 1.3 only; `none`
    is a 400.
  - `max_output_tokens` has a minimum of 16 and bounds reasoning plus
    output.
  - `verbosity`, `stop` and `n` > 1 are refused on Chat Completions.
  - Temperature and top-p are tuned at 1.0, and Meta advises leaving them
    unset.
- **Muse Code subscriptions**
  ([subscriptions](https://dev.meta.ai/docs/muse-code/subscriptions),
  accessed 2026-10-04; no page date):
  - Three plans: Everyday Usage, High Usage and Power Usage.
  - A limit is stated only for Everyday: "Send 10-50 prompts every 5 hours,
    including image and video uploads".
  - At the limit, "you can upgrade to the next plan, or wait until your
    limit refreshes".
  - No concurrency limit is stated.
  - Third-party guides claim two simultaneous subagents on the Everyday
    plan. That is unconfirmed, and not from Meta.
- **The Muse Code 1.4.2 binary.** `muse-bin-1.4.2-R4684.1.exe --help`,
  `serve --help` and `model-profile` were run on the host on 2026-10-04,
  with no model call.
  - **Host-level flags of `muse serve`:** `--disable-write` ("Disable
    non-shell workspace filesystem writes"), `--disable-shell` ("Disable
    workspace shell execution"), `--sandbox-network` and
    `--trust-workspace`. Each is "fixed for the host's lifetime". The
    approval mode "is selected on the wire, so there is no approval flag
    here".
  - **Top-level options:**
    - `--reasoning-effort none|minimal|low|medium|high|xhigh|max|ultra`
      (default `high`);
    - `--parallel-tool-calls` and `--no-parallel-tool-calls`;
    - `--agents <JSON>` ("Supply one ephemeral agent-definition overlay");
    - `--subagent-worktree-isolation` ("Only an affirmative per-child
      request asks for isolation");
    - `--approval-judge <off|on>`;
    - `--disable-write` and `--disable-shell` for a run.
  - **Subcommands:** `session-message` ("List or send cross-session
    messages") and `model-profile show <model> [--effort <tier>]`. The
    latter prints per-knob resolution, for example
    `default_reasoning_effort high`, and `base_instructions_variant`
    `full` on Standard and `trimmed` on contributor.
  - **Strings in the binary.**
    - The workflow tool's arguments include `maxParallelAgents` and
      `tokenBudget`, and workflow records carry `child_limit`.
    - A bundled fixture sets `"child_limit": 4`.
    - A bundled skill's `max_parallel` defaults to 4.
    - No limit on sessions per `muse serve` was found.

- **A singleton tool, observed on 2026-10-04.** On the owner's machine,
  each Muse worker loaded the user's Chrome Control MCP server from its own
  configuration. The browser extension accepts one connection, so six
  workers' servers took it from the orchestrator, and browser control
  failed for everyone. The lead reported this on 2026-10-04; it was not a
  capture.
  - MSP's `config.mcpServers` adds servers per session (the `ide` server).
    Whether it can switch off a user-configured server of the same name is
    not known; M96 step 1 captures it.
  - ACP's `session/new` `mcpServers` also adds to what an agent loads from
    its own configuration (§4.1).

**What D75 takes from §4.7.**

- **Concurrency on the Model API** is computed from the team's RPM and TPM,
  with 20% left for the orchestrator, and refined from the headers.
- **On a 429** the entry's cap halves, and recovers one step a minute.
- **Muse Code's ceiling** is 4 sessions per host, the binary's own child
  limit, adapted when a usage limit is refused.
- **Muse Spark's hidden settings:** temperature, top-p and verbosity are
  hidden, and `none` effort is never offered.
- **A read-only Muse Code worker** runs on a host started with
  `--disable-write` and `--disable-shell`.
- **One MCP bridge, run by the extension, with leases for exclusive
  resources.** Workers start with only their role's servers, because
  neither MSP nor ACP lets a client replace an agent's own servers
  (upstream U7, U8).

**What D75 takes from §4.**

- **An ACP client is feasible without a new dependency.** The SDK is
  pinned, and headless `exec` already uses its client builder. The new
  work is the stdio transport to a spawned process, terminal sign-in, the
  permission mapping and the mode table.
- **Policy on an external agent is the agent's own sandbox plus our
  permission answers, never our file methods.** So a role takes an
  external agent only through a captured mode that meets it.
- **Who pays is the vendor's question.** Codex and Gemini document a path
  that spawns their own CLI. Claude's terms make subscription use through
  a third-party app the risky case, so the preset hides it (D75's decisions).
- **Muse Code needs long calls split in two** (`delegate`, then `collect`)
  until `muse serve` supports MCP's tasks extension. That is upstream U1.

## 5. What this repository already has

Read from the tree at `1e93c67c` (paths relative to the repository).

- **M48 subagents.**
  - Six tools in `src/core/backends/modelapi/subagentTools.ts`.
    `subagent_spawn` takes `role`, `objective`, `agent`,
    `worktree_isolation` (always refused) and `command_id` (an idempotent
    retry).
  - Limits in `src/shared/constants.ts`: `SUBAGENT_CAPACITY` 8,
    `SUBAGENT_MAX_PER_CONVERSATION` 64, `SUBAGENT_DEPTH` 1, waits up to
    600 s, `SUBAGENT_TASK_MAX_REQUESTS` 4.
  - Admission is one ordered pipeline: `decideAndRunSpawn` in
    `ModelApiHost.ts`, then `admitNewSpawn` and `consentToChildTask` with
    `recheckAdmission` after each wait.
  - A child shares the parent's dependencies, hooks and workspace edits. It
    gets no ObservationPack, no agent catalogue and no budget cap of its
    own, and is charged through the parent.
  - Results reach the parent's replay as a user message
    (`drainChildResults`).
  - No recursion, enforced at declaration, at call admission and in
    `runSubagentTool`.
- **Muse Code's subagents** are its own, off unless
  `run.subagent_delegation_mode` is `auto` in its settings file, which the
  extension reads and never writes (`src/host/backend/museSettings.ts`).
- **M76 custom agents** (`src/core/context/customAgents.ts`).
  - Files are `.agents/agents/<id>/AGENT.md` and
    `<config>/muse/agents/<id>/AGENT.md`.
  - Front matter: `name`, `description`, `tools`, `model`, `effort`,
    `permission-mode`. A line reader refuses lists, indented values and
    repeated keys.
  - Precedence is project, personal, built-in, with holes that fail closed.
  - The narrowing helpers are `narrowApprovalMode`, `narrowTools` and
    `childPermissionMode` (`approvalRules.ts`, a 30-pair table).
- **M77 best-of-N and the board.**
  - Branches are `best-of-n/<run>/<i>` in `<parent>/<repo>.worktrees/`.
  - The runner (`src/core/bestOfN/bestOfNRunner.ts`) asks one paid popup,
    adds the worktrees, captures an immutable tree with `add` and
    `write-tree`, and applies the chosen one with `git apply --index
--binary`.
  - Attempt hosts (`buildAttemptHost`) have no store, MCP, hooks, memory,
    paid tools or shell.
  - The board is `src/core/sessionBoard.ts` and `SessionBoardDialog.tsx`,
    lazy in `dist/sessionBoard.js`.
- **The `ide` MCP server** (`src/host/ide/ideMcpServer.ts`).
  - Streamable HTTP on `127.0.0.1`, an ephemeral port, path `/mcp`.
  - A per-extension-host bearer token, compared in constant time.
  - It is passed to Muse Code in `session/start` and `session/resume`
    `config.mcpServers` with `mode: 'optional'`, when the CLI grants
    `sessionMcp`.
  - Its tool list is read on every request.
- **ACP.**
  - `@agentclientprotocol/sdk` 1.5.0 is a devDependency, bundled into
    `dist/acp.js`.
  - The agent is `src/acp/agent.ts`.
  - The only client is headless `exec` (`src/runtime/exec/execClient.ts`),
    driving our own agent in-process through `acp.client`. It removes the
    SDK's built-in session router, an escape hatch already in §8.
- **Hooks** (`src/core/backends/modelapi/hooks.ts`).
  - 17 events. `SubagentStart` carries `subagent_id` and
    `child_session_id`, and `SubagentStop` adds `stop_hook_active` and
    `last_assistant_message`.
  - The base payload names `model_provider: 'meta'`.
  - `TeammateIdle` exists only as an import fixture until M91.
- **Paid and budgets.**
  - `PaidFeatureGate` and `PaidUsage` (`src/core/paid/paidFeatures.ts`),
    and `PaidUseConsent` (`paidConsent.ts`); the features include
    `subagents` and `bestOfN`.
  - M82's journal is `src/host/backend/sessionBudgetJournal.ts`, and the
    arithmetic is `sessionBudget.ts`.
  - Children skip `budgeted`.
- **Reviewers.** M70, M78 and M90 all run on the conversation's model.
  Nothing reviews with a second model today.
- **SoL-Pi pieces.**
  - ObservationPack is `observationPack.ts` (`recall_output`).
  - `then_run` is offered only with the shell.
  - The tool list is built in `toolDefinitions` and
    `ModelApiSession.tools()`, and narrowed at call admission.
  - **No golden request test exists**; the nearest pins the tool names'
    order (`modelApiTools.test.ts`). M96 adds one first.
- **Bundles.** Budgets are in `scripts/check-bundle-size.mjs`, entries in
  `scripts/build.mjs`, and the split gate in
  `scripts/check-bundle-split.mjs`. A new file under
  `src/core/backends/modelapi/` must sit on exactly one of the split
  gate's lists.

## 6. Across the sources, and what D75 adds

| Concern                 | What the sources do                                                                                              | D75                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who leads               | Main agent delegates (Claude, Codex, VS Code, Cursor); coordinator modes fading (Kilo deprecated, Roo shut down) | The main conversation's agent, on either backend; no orchestrator role                                                                            |
| Routing                 | The description (all of them); Roo's separate `whenToUse`                                                        | `when-to-use` beside `description`                                                                                                                |
| Worker context          | The task only, by default, everywhere; forks optional                                                            | Brief, named files, role, rules; never the conversation                                                                                           |
| Results                 | A summary (Claude, Roo); last message (LangGraph); pass-through beats relaying (LangChain)                       | A typed report, shown to the user directly, packed for the orchestrator                                                                           |
| Depth                   | Claude 3, Codex 1, VS Code 5, Cursor 1, Cline 0                                                                  | 1, or 2 by `delegates`                                                                                                                            |
| Concurrency             | Claude 20, Codex 6 or 3, Cursor 8, Kilo 4 versions                                                               | Per entry, per agent, per role per turn, global and process caps                                                                                  |
| Budgets                 | Counts, turns, time and rate; tokens only in AutoGen; dollars nowhere                                            | Tokens, input, output, dollars and tasks per entry, by task, day or lifetime, reserved before sending                                             |
| Preference and fallback | VS Code's ordered `model` list; Claude's model order                                                             | Ordered pools; first with headroom; recorded and hooked switches; never mid-task                                                                  |
| Tool policy             | Roo's groups and `fileRegex`; Kilo's allow, ask, deny globs; Claude's allow and deny lists                       | One tool-set definition per role, `write-paths`, workspace modes, and per-kind enforcement said plainly                                           |
| Parallel writers        | Worktrees (Kilo, Cursor, VS Code), "not a security boundary"                                                     | An `agents/<role>/<task-id>` worktree per writer in the extension's storage; the orchestrator merges with `git merge-file` and resolves conflicts |
| Approvals               | Child prompts in the parent's UI, labelled (Claude, Codex); serialisable pauses (OpenAI, LangGraph)              | The panel's labelled cards; the D48 popup per `delegate` call for key tasks                                                                       |
| Hooks                   | Claude: SubagentStart, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle                                    | M51's pair with Claude's fields added, M91's `TeammateIdle`, and a new `TeamAgentSwitch`                                                          |
| External agents         | ACP adapters for Claude, Codex, Gemini, Copilot and some 40 more                                                 | An ACP client with presets found on the PATH, terms-aware defaults, nothing installed                                                             |

**What the owner asked for, and where D75 has it.** Roles with charters and
workspace modes; ordered pools with caps per entry and window, switching and
the exhausted policy; the orchestrator's rubric, its tools and its ownership
of integration; the Agent map's tree; complete tool sets; the Models & Agents
panel's Roles section with templates, autofill, the preview and import and
export.

**Beyond what he asked, D75 adds:**

- **Accounting and caps:**
  - reservation before every engine request, against every cap of its
    entry, through M82's journal;
  - rate-limit and usage-limit marks per agent, not per entry, because a
    plan or key is shared;
  - overshoot accounting for workers whose requests the extension cannot
    hold back;
  - token caps required for an unpriced key model, where M95 would refuse
    it outright;
  - global and process caps from the machine's CPUs and memory;
  - recursion limits.
- **Enforcement:**
  - an honest enforcement level per agent kind;
  - a scratch worktree for read-only roles on Muse Code and external
    agents, so a write is caught;
  - the merge-time `write-paths` check, because Muse Code under `muse serve`
    does not ask before edits;
  - the ref fence: git commands that move refs are refused, and moved refs
    are detected;
  - `in-place` limited to engine agents.
- **Integration:**
  - the different-model reviewer, required before merge when one has
    headroom;
  - a three-way merge with `git merge-file`, which runs no repository
    drivers;
  - **Undo merge**, guarded by M86's byte check;
  - pipelines that never merge by themselves, bounded by his third-round
    rule.
- **Safety in the tools:**
  - `command_id` for retry safety under MCP's re-sent requests;
  - a required `reason` on every delegation, and a plan for the work kept.
- **Trust:**
  - the repository's lower-only `team.json`, which never sets `in-place`;
  - an import that never carries a credential, an endpoint or a command;
  - the confidential-workspace rule;
  - terms-aware external presets, with nothing installed.
- **Seeing it first:**
  - a free, deterministic preview beside the paid **Try with the
    orchestrator**;
  - a telemetry-free local record that informs the user and the
    orchestrator but never reorders a pool.
- **Team intensity:**
  - a Max level computed from documented limits, headers and the machine;
  - halving on 429, with recovery;
  - shell-command slots, so builds never swamp the host.
- **A read-only Muse Code host**, with writes and the shell off by Muse
  Code's own flags.
- **Shared resources:**
  - a registry of exclusive, shared and free resources, with leases after
    M86's lease-and-fence pattern;
  - one MCP bridge that runs each server once for everyone;
  - commands declared to need a resource.
- **The team ledger:**
  - one durable record, whose meters, history and Account & usage rows agree
    by construction;
  - interrupted tasks after a crash, which can be resumed.
- **Templates**, including the owner's own Muse-codes-Codex-reviews pair.
- **Evaluation:**
  - an M75-style evaluation of the rubric on dry runs, so that it costs
    only orchestrator requests;
  - a golden request test before any change, which the SoL-Pi rule needs
    and the tree lacks.

## 7. Unconfirmed, and to capture

- **Codex.** Its `max_depth` and thread defaults come from source only. Its
  Terms of Use on automated access could not be read.
- **Cline.** The year of 3.58.0, the release date of 4.1.20, its focus
  chain's details, and whether its CLI teammates run at once.
- **Claude's adapter.** Whether 0.85.1 fixes stdio MCP passthrough (#883),
  and how its built-in tools treat paths outside `cwd`.
- **Muse Code (step 1 of M96):**
  - the MCP call timeout under `muse serve`;
  - whether server `instructions` reach the model;
  - how its modes treat `readOnlyHint`;
  - whether `session/resume` changes the server set;
  - whether `--trust-workspace` covers a worktree folder;
  - its usage-limit error, from M88's pending capture.
- **Each external preset:** its exact modes, config options and limit
  errors, through `initialize` and `session/new` without a prompt.
- **Muse Code's concurrency and plan limits.** Meta states none beyond the
  Everyday plan's prompt range. The 4-session ceiling comes from the
  binary's fixture and is adapted at run time.
- **MCP servers per session.** Whether a Muse Code session's
  `config.mcpServers` can switch off a user-configured server, and each
  external preset's switch for leaving out the user's own servers, are to
  capture (M96 step 1).
- **Meta's TPM accounting.** Whether cached input counts toward TPM is not
  stated.
- **`vscode.lm`.** Usage reporting and the consent prompt for Copilot's
  models are M95's to capture; D75 assumes none is reported, so counts
  there are estimated.

## 8. Scheduler and traffic: the lead's fleet practice, and the facts it rests on

This section backs D75's "Scheduler and traffic" part and M96c (added
2026-10-04 for the owner's "we need to make sure that the orchestration and
traffic and workflows are dialed for multi agent and multi workspace/branch
work to avoid collisions and maximize the available lanes for the agents
including queueing agents and reassigning agents and minimizing conflict but
maximizing productivity").

Most of it is prior experience, not a published source: how the lead
(Claude Code) runs this repository's own fleet of Claude, Codex and Muse
agents by hand. Each entry is dated from the lead's working notes (its
session memory and state records). None is a capture.

### 8.1 How the fleet runs today

- **Lanes.** One worktree and branch per lane, which the lead creates
  before the agent starts. Shared files (constants, the stylesheet, the
  harness, the l10n tables) are region-owned under M87's lane rules (PLAN.md,
  M87, 2026-10-03): a lane edits only its region, beside the related block,
  never at the file's end.
- **Roles on different models.** Muse implements, Codex reviews read-only,
  and the lead integrates with the final say (owner, 2026-10-04 and
  2026-09-30).
- **Caps per engine.**
  - Codex: at most 5 (owner, 2026-09-30).
  - Muse: at most 4, started a few seconds apart. The owner allowed 6, but
    six at once overloaded Muse's backend, which answered 503 (2026-10-01).
  - Claude: 4 or more on the Max 20x account (owner, 2026-10-04: "2 for
    claude is not full").
- **Watchers.** Background watchers poll each lane's log and each CI run.
  They pick up finished work, and the lead refills the free slot (state
  records, 2026-10-01 to 2026-10-04).
- **Reassignment.** A Muse lane that ran out of steps was finished by
  Codex (the lead's note, 2026-10-04).
- **Short leashes.** Codex lanes are time-boxed at 60 minutes and checked
  every 15 minutes with real diffs. The reason is the owner's (2026-10-03):
  "codex will over engineer and code forever without stopping".
- **Claims checked.** Muse drafts claimed checks that never ran, so the
  lead re-runs every drill and gate itself (2026-09-30).
- **Review in one pass.** Before a push, parallel reviewers each take one
  class: concurrency and stale state; wire evidence; failure paths, cleanup,
  secrets and docs. Every finding is fixed in one commit (owner,
  2026-09-27).
- **The third round.** When a third review round still finds problems,
  patching stops and the module is redesigned (owner, 2026-09-28).
- **A serial merge queue.**
  - Pull requests merge one at a time, in a deliberate order by dependency
    and blast radius, and each re-merges main first.
  - `changelog-rebase.py` resolves the CHANGELOG: it starts from main's
    file and re-applies only the branch's own bullet changes since the merge
    base.
  - `json-merge3.py` resolves the 14 l10n tables by key, because every
    branch adds keys at the same spots and they conflicted on every main
    merge.
  - `changelog-kept.py` then checks that every sentence of main's CHANGELOG
    is still there, and `changelog-fix-released.py` moves a branch's entry
    out of a section that was released after its base (all 2026-10-03).
  - The earlier union script was retired after three strikes of dropped or
    lost notes (#70, #84, #96, 2026-10-03).
- **Test once.** Small changes are batched, and the gate runs once at the
  end (owner, 2026-09-22). GitHub's merge queue needs an
  organisation-owned repository, so the serial order stays the lead's job
  (owner, 2026-10-04).
- **Rigs for heavy tests.** Every vitest run and build goes to a rig over
  SSH (`rig-test.sh`; owner, 2026-10-01, made strict 2026-10-04). A run:
  - builds a snapshot commit through a temporary index (uncommitted and
    untracked files, the real index untouched);
  - pushes it to the rig's bare repository and checks it out in a slot
    folder;
  - gives it `node_modules` from a per-lockfile cache, made once per
    distinct lockfile under a creation lock.

  Codex goes to the Mac mini first, Claude to Kubuntu, and Windows-only
  tests to the Windows VM. Rig scripts are replaced by writing a new file and
  renaming it, never edited while lanes run them.

### 8.2 Incidents the design answers

- **Duplicate MCP servers took a singleton tool** (2026-10-04). Each
  `muse exec` lane loaded Chrome Control from the owner's Muse settings. The
  browser extension takes one connection, so the lanes' copies took it from
  the lead ("extension not attached"). The entry was removed from Muse's
  settings for the lanes.
- **A lane given the primary checkout** (2026-10-04). Two Codex planning
  lanes were handed the primary checkout. They committed on new branches
  there and left it on another branch. Since then the lead creates every
  lane's worktree before launch.
- **Host CPU saturation** (2026-10-01, about 22:50).
  - About fifteen agents, five Codex runs and six Muse runs gated locally,
    one of them running the full quality gate. They pinned 20 cores at 100%.
  - The owner's installed extension took 211 seconds to activate, and
    `muse serve` missed its 30-second start.
  - Since then every agent process runs at below-normal priority, which its
    children inherit; heavy suites run on rigs; and the host runs about two
    vitest runs at once at most.
- **A process storm** (2026-09-28). Chrome relaunching Chrome Control's
  native host left about 1,200 `cmd.exe` wrappers holding 13.6 GB. Since
  then one full gate runs at a time across worktrees.
- **Deleting through a junction** (2026-10-02). A forced worktree removal
  followed a `node_modules` junction and emptied another checkout's
  `node_modules`. Agent worktrees also failed to delete with "Filename too
  long". Since then reparse points are removed with `rmdir` before a
  worktree is removed.
- **Background merges outlive their stop** (2026-10-02). Stopping a
  background merge script on Windows did not stop its children, and one
  merged a pull request anyway.
- **PowerShell over Windows OpenSSH** (2026-09-22). On the Windows VM,
  `powershell -Command …` over sshd blocked forever reading the open
  standard-input pipe, and even `ssh -n` with `-InputFormat None` and input
  from `nul` did not cure it there. Plain `cmd` commands worked. The VM
  now runs tests through a scheduled task in the user's session.

### 8.3 Technical facts

All read on 2026-10-04.

- **`git merge-file`**
  ([git-scm.com/docs/git-merge-file](https://git-scm.com/docs/git-merge-file)):
  - "The exit value of this program is negative on error, and the number of
    conflicts otherwise (truncated to 127 if there are more than that many
    conflicts). If the merge was clean, the exit value is 0."
  - `-p`: "Send results to standard output instead of overwriting
    <current>."
  - So a trial merge in memory predicts the real merge's outcome exactly.
- **`git patch-id`**
  ([git-scm.com/docs/git-patch-id](https://git-scm.com/docs/git-patch-id)):
  - "A 'patch ID' is nothing but a sum of SHA-1 of the file diffs associated
    with a patch, with line numbers ignored."
  - With `--stable`, "Reordering file diffs that make up a patch does not
    affect the ID", and "All whitespace within the patch is ignored".
  - So a branch refreshed onto a moved base keeps its patch ID when its own
    change is unchanged.
- **Copy-on-write copies in Node**
  ([nodejs/node doc/api/fs.md](https://raw.githubusercontent.com/nodejs/node/main/doc/api/fs.md)):
  - `fs.constants.COPYFILE_FICLONE`: "The copy operation will attempt to
    create a copy-on-write reflink. If the platform does not support
    copy-on-write, then a fallback copy mechanism is used."
  - `COPYFILE_FICLONE_FORCE` fails instead.
- **Process priority and load in Node**
  ([nodejs.org/api/os.html](https://nodejs.org/api/os.html)):
  - `os.setPriority([pid, ]priority)` maps the value to "one of six priority
    constants in `os.constants.priority`".
  - `PRIORITY_BELOW_NORMAL` "corresponds to `BELOW_NORMAL_PRIORITY_CLASS` on
    Windows, and a nice value of `10` on all other platforms".
  - `os.loadavg()`: "On Windows, the return value is always `[0, 0, 0]`".
    So the load guard samples `os.cpus()` times instead.
  - `os.availableParallelism()` "Returns an estimate of the default amount
    of parallelism a program should use."
- **OpenSSH client options**
  ([man.openbsd.org/ssh_config](https://man.openbsd.org/ssh_config)):
  - `BatchMode`: "If set to `yes`, user interaction such as password prompts
    and host key confirmation requests will be disabled."
  - `StrictHostKeyChecking yes`: "ssh will never automatically add host keys
    to the ~/.ssh/known_hosts file."
  - `ForwardAgent`: "Specifies whether the connection to the authentication
    agent (if any) will be forwarded to the remote machine."
  - `ConnectTimeout`: "the timeout (in seconds) used when connecting to the
    SSH server".
- **Changelog fragments**
  ([towncrier tutorial](https://towncrier.readthedocs.io/en/stable/tutorial.html)):
  - "the filename consists of the issue/ticket ID (or some other unique
    identifier) as well as the 'type'".
  - `towncrier build` combines the fragments into the news file. The
    changesets tool keeps the same one-file-per-change shape in
    `.changeset/`.
- **VS Code's global storage.** `ExtensionContext.globalStorageUri` is "a
  directory in which the extension can store global state" (`@types/vscode`
  1.125.0, `index.d.ts`). It lives in each editor's own user-data folder, so
  Stable, Insiders, VSCodium and Cursor each have their own. The ACP agent
  outside VS Code has none.

### 8.4 What D75 takes from §8

- **The lead's lanes become the scheduler.** It brings the board of
  dependent tasks, the lanes kept full by an event-driven watcher, caps per
  engine, staggered starts, reassignment of a stalled lane with a handoff,
  divergence stopped and handed back, review by class in one pass, and the
  third-round redesign.
- **The lead's region ownership becomes write-set leases.** Tasks lease
  files and regions. Overlaps are predicted with real trial merges. The
  structured merges cover the regions, the l10n tables (by key) and the
  CHANGELOG (changelog-rebase, the kept check and the released-section
  guard; never a union).
- **The lead's serial queue becomes the merge queue.** It is ordered by
  dependency, priority, conflicts and blast radius. It tests the merged
  result, batches small changes, bisects to the culprit and retries a
  flaky check once.
- **The lead's rigs become runners.** Snapshots go through a temporary
  index, dependency caches are keyed by lockfile, routing follows labels
  and affinity, and helpers are replaced by rename. Windows runners get a
  self-test for the standard-input hang.
- **The incidents become machine-wide rules.**
  - One coordinator for every window, with leases on singleton servers and
    a single running instance of each.
  - The working copy checked never to be the user's checkout.
  - Below-normal priority, heavy-command slots and a load guard.
  - Cleanup that never follows a link.
  - Process trees ended on cancel.

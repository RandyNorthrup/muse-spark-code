# Hooks parity: the popular coding agents and Muse Spark Code

Checked 2026-10-04 against origin/main bd1aafd8 (0.12.0) and each vendor's current docs. This was read-only research. The raw page copies stayed with the report in the lead's scratchpad (`hooks-parity/`: raw-*.md, raw/, *.out, src/); they are not in the repository.

This is the report as the research agent wrote it. Where PLAN.md D70 differs, D70 rules:

- The owner's direction of 2026-10-04 adopts every concept that the matrix below marks "not adopted" or "refuse".
- The step 1 captures (`m91.md`) changed the Interrupt and SessionFork plans.

Three Muse Code echo-provider runs were made (`--provider echo --no-session-log`, empty folders echo-ws-a/b/c): 0 model calls, nothing billed.

## Key findings

1. **Muse Code 1.4.2 has 19 hook events; our Model API runtime runs 17.**
   - `Interrupt` was added in 1.4.0 (changelog).
   - `SessionFork` is in the 1.4.2 binary and the bundled example plugin, but undocumented.
   - The CLI accepts both from `.muse/hooks.json`. Our parser skips both (`src/core/backends/modelapi/hooks.ts:452-455`).
2. **Muse 1.4.0 lets a PostToolUseFailure hook return `updatedInput`, a corrected call.** That call re-runs through hooks, policy and approval, bounded by the onFailure depth. We refuse `updatedInput` outside PreToolUse (`hooks.ts:921-923`).
3. **The CLI warns and skips an unknown event name, then loads the rest of the file.**
   - Run A printed "Hooks: 5 runnable · 2 warnings" and `UnsupportedEvent: unsupported hook event FileChanged`.
   - A namespaced name such as `museSpark.FileChanged` also warns.
   - An extra top-level key is ignored silently (run B; undocumented).
4. **M83's note is out of date.** It says "Codex hooks do not share Muse Code's names". Codex rust-v0.160.0 uses Claude Code's PascalCase names, matcher grammar and JSON format: 11 of its 12 events match Muse Code's names, and the 12th is Muse's `Interrupt`.
5. **SECURITY: other agents' hook folders are not protected writes.** `PROTECTED_PATH_SEGMENTS` (`src/shared/constants.ts:1889-1898`) covers `.muse`, `.vscode`, `.github/workflows` and others, but not:
   - `.claude/`, `.codex/`, `.cursor/`, `.gemini/`
   - `.github/hooks/`, `.devin/`, `.windsurf/`, `.kiro/`, `.clinerules/hooks/`

   A Model API session can write a hook into any of these without a protected-write card. Another agent may later run that hook outside our sandbox.

6. **Unverified:** the 1.4.2 trace schema says "StopFailure and PostToolBatch are staged schema values and remain production-dark until their downstream runtime acceptance lands". If that covers the hook events, those two may not fire yet on the Muse Code backend. Capture to confirm.

## Event counts per agent (official docs, 2026-10-04)

| Agent                    | Events            | Notes                                                                   |
| ------------------------ | ----------------- | ----------------------------------------------------------------------- |
| Claude Code              | 33                | code.claude.com/docs/en/hooks                                           |
| Codex                    | 12                | learn.chatgpt.com/docs/hooks; openai/codex rust-v0.160.0                |
| Gemini CLI               | 11                | geminicli.com/docs/hooks; v0.62.0                                       |
| Cursor                   | 21                | cursor.com/docs/hooks; reads Claude settings, mapping 8 events          |
| Copilot CLI/cloud        | 14                | docs.github.com/en/copilot/reference/hooks-configuration; cloud runs 12 |
| VS Code agent hooks      | 8                 | code.visualstudio.com/docs/copilot/customization/hooks; Preview         |
| Cline                    | 8                 | docs page is a stub; full text at cline/cline 901d1b5c97                |
| Windsurf / Devin Desktop | 12                | docs.devin.ai/desktop/cascade/hooks; exit codes only                    |
| Kiro                     | 12 v1 triggers    | IDE runs 10; kiro.dev/docs/hooks                                        |
| Amp                      | 6                 | in-process plugins only                                                 |
| OpenCode                 | 21 typed + 29 bus | in-process plugins only                                                 |
| Continue                 | none documented   | Its source has a module that never fires                                |

### Claude Code's 33 events

SessionStart, Setup, InstructionsLoaded, UserPromptSubmit, UserPromptExpansion, MessageDisplay, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, ConfigChange, Elicitation, ElicitationResult, SessionEnd.

- Exit codes: 0 means stdout is parsed as JSON; 2 is a blocking error; any other code is a non-blocking error.
- Output fields: continue, stopReason, suppressOutput, systemMessage, terminalSequence, decision/reason, hookSpecificOutput.
- Handlers: command, http, mcp_tool, prompt, agent.
- An unknown event name is skipped; the rest of the file stays in effect.

### Codex's 12 events

SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SubagentStart, SubagentStop, Stop, Interrupt.

- Exit codes: 0 succeeds, 2 blocks.
- Handler timeout: 600 s default.
- Config files: `~/.codex/hooks.json`, `config.toml [hooks]`, `<repo>/.codex/...`
- Hooks are trusted by hash once reviewed in /hooks.
- The legacy `notify` passes JSON as the last command-line argument.

### Gemini CLI's 11 events

SessionStart, SessionEnd, BeforeAgent, AfterAgent, BeforeModel, AfterModel (per chunk), BeforeToolSelection, BeforeTool, AfterTool, PreCompress, Notification.

- Timeouts are in milliseconds, default 60000.
- Config: the `.gemini/settings.json` hooks block.
- Its migrate tool drops SubagentStop (misspelled as SubAgentStop) and copies seconds as milliseconds (issue #29122).

### Cursor's 21 events

sessionStart, sessionEnd, preToolUse, postToolUse, postToolUseFailure, subagentStart, subagentStop, beforeShellExecution, afterShellExecution, beforeMCPExecution, afterMCPExecution, beforeReadFile, afterFileEdit, beforeSubmitPrompt, preCompact, stop, afterAgentResponse, afterAgentThought, beforeTabFileRead, afterTabFileEdit, workspaceOpen.

- File shape: `{"version":1,"hooks":{…}}`
- Invalid JSON from a permission hook blocks; exit 2 means deny; `failClosed` is available.

### Copilot's 14 events

sessionStart, sessionEnd, userPromptSubmitted, userPromptTransformed, preToolUse, permissionRequest (CLI only), postToolUse, postToolUseFailure, preCompact, agentStop, subagentStart, subagentStop, errorOccurred, notification (CLI only).

- PascalCase aliases exist.
- Output is flat; preToolUse errors fail closed; `timeoutSec` defaults to 30.
- Config: `.github/hooks/*.json`, `~/.copilot/hooks/*.json`, inline settings.

### VS Code's 8 events

SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SubagentStart, SubagentStop, Stop.

### The rest

- **Cline (8):** TaskStart, TaskResume, TaskCancel, TaskComplete, PreToolUse, PostToolUse, UserPromptSubmit, PreCompact. One script per event, no matchers.
- **Windsurf (12):** pre/post_read_code, pre/post_write_code, pre/post_run_command, pre/post_mcp_tool_use, pre_user_prompt, post_cascade_response, post_cascade_response_with_transcript, post_setup_worktree. Exit codes only.
- **Kiro (12):** SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd, PreTaskExec, PostTaskExec, PostFileCreate, PostFileSave, PostFileDelete, Manual. Config in `.kiro/hooks/*.json` v1.

## Muse Code now (1.4.2-R4684.1)

- **Documented:** the SDK docs (still labelled 1.3.0) list 17 events.
- **Changelog 1.4.0:** Interrupt (observation only, async); onFailure fallback; the PostToolUseFailure `updatedInput` correction; plugin hook review and foreign-hook trust.
- **Binary:** 19 names (adds Interrupt and SessionFork); the example plugin has `hooks/session_fork.py` and `hooks/interrupt.py`.
- **Setup:** refused ("recognized but is not run by Muse").

| Echo run | What it showed                                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | Unknown names warn and are skipped; the 5 known events loaded.                                                                                                                                            |
| B        | An extra top-level key is ignored silently.                                                                                                                                                               |
| C        | Interrupt must be `async:true`. SessionFork must be `async:false` (the fork waits on its verdict). skills.v1 `outputCapabilities` works only on foreground UserPromptSubmit or PostToolUse command hooks. |

## Gap matrix (39 concepts)

Column legend:

- **(a)** Muse Code has the event.
- **(b)** Our runtime has the operation (file:line on origin/main).
- **(c)** Import today → after M91. CC Claude Code, CX Codex, GM Gemini, CU Cursor, GH Copilot, VS VS Code, WS Windsurf, KR Kiro.

| #   | Concept                          | (a)                               | (b)                                                  | (c)                                                                |
| --- | -------------------------------- | --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Session start                    | yes                               | wired                                                | CC → +CX GM CU GH VS KR                                            |
| 2   | Session end                      | yes                               | yes (ModelApiHost.ts:9615)                           | CC → +CX GM CU GH KR                                               |
| 3   | Session fork                     | yes (undocumented)                | forkSession (10564)                                  | **add SessionFork**                                                |
| 4   | Setup/maintenance                | no                                | no mode                                              | refuse                                                             |
| 5   | Folder added                     | no                                | one root per session                                 | refuse                                                             |
| 6   | Instructions loaded              | no                                | instructionsFor (2519), touchPath rules (4562)       | **add**; CC                                                        |
| 7   | Config change                    | no                                | partial (extension.ts:2256-2257, 2310)               | **add** (observation only); CC refused, because Claude's can block |
| 8   | Cwd changed                      | no                                | each shell call starts at root (1926)                | refuse                                                             |
| 9   | File changed outside the agent   | no                                | noteExternalEdit (9064), watcher (extension.ts:2252) | **add**; CC, matcher required                                      |
| 10  | Prompt submitted                 | yes                               | wired                                                | CC → +CX GM CU GH VS WS KR                                         |
| 11  | Prompt expansion (slash/skill)   | no                                | skill invocation (1380, 1445)                        | **add**; CC; GH refused                                            |
| 12  | Before model request             | yes (PreLLMCall)                  | wired                                                | GM refused                                                         |
| 13  | After model response             | yes (PostLLMCall)                 | wired                                                | CU and WS as async observation; GM refused                         |
| 14  | Tool selection                   | no                                | yes                                                  | not adopted                                                        |
| 15  | Reasoning block finished         | no                                | yes                                                  | not adopted                                                        |
| 16  | Display-only rewrite             | no                                | streaming                                            | not adopted (spoofing)                                             |
| 17  | Model switch (pre/post)          | no                                | setModel (9203)                                      | **add both**; CC                                                   |
| 18  | Before tool                      | yes                               | wired                                                | CC → +all, with matcher mapping                                    |
| 19  | Permission prompt                | yes                               | wired                                                | CC → +CX GH                                                        |
| 20  | Permission denied                | no                                | autoReview (3889), refused/refusedByMode (6474/6480) | **add** (observation only); CC, without `retry`                    |
| 21  | After tool                       | yes                               | wired                                                | CC → +all                                                          |
| 22  | Tool failed                      | yes, with the 1.4.0 correction    | wired; correction refused (hooks.ts:921)             | CC → +CU GH; **add the correction**                                |
| 23  | Tool batch                       | yes                               | wired                                                | CC                                                                 |
| 24  | MCP elicitation                  | no                                | our MCP client offers none (mcp/connection.ts:171)   | refuse                                                             |
| 25  | Subagent start                   | yes                               | wired                                                | CC → +CX GH VS; CU refused (Cursor's can block)                    |
| 26  | Subagent stop                    | yes                               | wired                                                | CC → +CX CU GH VS                                                  |
| 27  | Turn end (Stop)                  | yes                               | wired                                                | CC → +CX GM CU GH VS KR                                            |
| 28  | Turn failed                      | yes (maybe dark on the CLI)       | wired                                                | CC → +GH                                                           |
| 29  | User interrupt                   | yes (1.4.0)                       | cancel() (9183), **not wired**                       | **add**; CX                                                        |
| 30  | Notification                     | yes                               | permission_prompt only (3730)                        | CC → +GM GH                                                        |
| 31  | Task/todo created or completed   | no                                | todo_write (4111)                                    | **add both**; CC; KR refused                                       |
| 32  | Teammate idle                    | no                                | no teams                                             | refuse                                                             |
| 33  | Before compaction                | yes                               | wired                                                | CC → +CX GM CU GH VS                                               |
| 34  | After compaction                 | yes                               | wired                                                | CC → +CX                                                           |
| 35  | Worktree created                 | no                                | Best-of-N (bestOfNRunner.ts:29, worktrees.ts)        | **add** (after creation); WS; CC refused                           |
| 36  | Worktree removed                 | no                                | Best-of-N cleanup                                    | **add**; CC                                                        |
| 37  | Tab completion                   | no                                | none                                                 | refuse                                                             |
| 38  | Agent wrote a file (path filter) | partial (PostToolUse Edit\|Write) | yes                                                  | CU and WS → PostToolUse Edit\|Write; KR refused                    |
| 39  | Manual trigger                   | no                                | none                                                 | refuse                                                             |

**Summary of the matrix:**

- Muse Code covers 19 concepts, and #38 partially.
- Of the 19 concepts it lacks, our runtime has the operation for 12 and not for 7.
- We are also missing two of Muse's own events (#3, #29) and the #22 correction.
- **Proposed:** 13 events (2 Muse-native, 11 extension-only).
- **Not adopted:** 10 concepts (7 have no operation here; #14, #15 and #16 are refused).

## Recommendation

### Events

**Muse-native, into HOOK_EVENTS:**

- Interrupt: async only, fired from cancel() on a user abort of a turn or compaction, never on dispose.
- SessionFork: synchronous, and its verdict can veto the fork. Side chats still skip hooks.
- PostToolUseFailure `updatedInput`: a corrected call to the **same tool** only, run as a new call through PreToolUse, policy, path confinement and approval, bounded by HOOK_ON_FAILURE_MAX_DEPTH.

**Extension-only, under Claude Code's names:**

| Behaviour                                              | Events                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Observation only                                       | InstructionsLoaded, PermissionDenied, PostModelSwitch, FileChanged, ConfigChange |
| Can refuse, with the reason shown                      | UserPromptExpansion, PreModelSwitch, TaskCreated, TaskCompleted                  |
| Fires after creation; non-zero exit fails that attempt | WorktreeCreate                                                                   |
| Fires before removal                                   | WorktreeRemove                                                                   |

No hook chooses a path, a model or a tool.

### Naming

Extension events go in a separate file that Muse Code never reads. It uses Muse Code's shape and is parsed by the same parseHookConfig with the extension's event list:

- project: `.muse/spark-hooks.json` (already under the protected `.muse`);
- user: `<config>/muse/spark-hooks.json`.

Event names are Claude's, unprefixed; the file is the namespace.

- A Muse Code event name in spark-hooks.json is refused with "configure it in `.muse/hooks.json`".
- If Muse later adopts a name, it moves to HOOK_EVENTS in the verifying release.
- The file has the same gates as M51: trust, the `museSpark.modelApiHooks` opt-in, and a per-session snapshot.

### Importer

**Same format as Muse Code** (convert into Muse Code's files; runs on both backends):

- **Codex:** `~/.codex/hooks.json`, `config.toml [hooks]` (smol-toml) and `<repo>/.codex/...`.
  - All 12 events, matchers kept; `apply_patch` → `Edit|Write`; commandWindows kept; Interrupt only with `async:true`.
  - Refused: mcp_tool, prompt and agent handlers, and additionalContextLimit.
  - `notify` is listed, not converted.
- **Claude Code (extended):** the 11 extension events go into spark-hooks.json; WorktreeCreate and ConfigChange are refused; FileChanged needs a matcher.

**Other formats** go into spark-hooks.json with a `format` tag. The Model API runtime translates their stdin and stdout; the Muse Code backend doesn't run them.

| Source                                  | Events kept                                                                                                                                                                                                                                                                               | Mapping notes                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Gemini (8 of 11)                        | BeforeTool→PreToolUse, AfterTool→PostToolUse, BeforeAgent→UserPromptSubmit, AfterAgent→Stop, SessionStart, SessionEnd, PreCompress→PreCompact (async), Notification. Refused: BeforeModel, AfterModel, BeforeToolSelection.                                                               | ms → s, rounded up, max 600. Tools: run_shell_command→Bash, read_file→Read, write_file→Write, replace→Edit, `mcp_<s>_<t>`→`mcp__<s>__<t>`. |
| Cursor (16 of 21)                       | session*, pre/postToolUse, postToolUseFailure, subagentStop; shell/MCP/readFile → Pre/PostToolUse with matchers; beforeSubmitPrompt→UserPromptSubmit; preCompact; stop; afterAgentResponse→PostLLMCall (async). Refused: subagentStart, afterAgentThought, both Tab hooks, workspaceOpen. | `permission` → decision; `ask` forces a card; failClosed rules kept; followup_message → Stop block.                                        |
| Copilot (13 of 14) and VS Code (8 of 8) | camelCase and PascalCase names (agentStop→Stop, errorOccurred→StopFailure). Refused: userPromptTransformed.                                                                                                                                                                               | bash/powershell → command/commandWindows; cwd and env refused; preToolUse errors fail closed.                                              |
| Windsurf (11 of 12)                     | pre_* → PreToolUse and post_* → PostToolUse, with a matcher per kind; pre_user_prompt→UserPromptSubmit; post_cascade_response→Stop (async); post_setup_worktree→WorktreeCreate. Refused: _with_transcript.                                                                                | Exit codes only.                                                                                                                           |
| Kiro (6 of 12)                          | command actions on SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, Stop. Refused: file, task and Manual triggers, and agent actions.                                                                                                                                 | fs_read→Read, fs_write→Write\|Edit, execute_bash→Bash; only exit 2 blocks.                                                                 |
| Not converted                           | Cline (three incompatible formats, empty docs), Amp and OpenCode (in-process plugins), Continue (hooks never fire).                                                                                                                                                                       | —                                                                                                                                          |

**Why translation is needed:** renaming the event alone fails open. A foreign guard's output doesn't validate against Muse's strict schema, and a failed PreToolUse hook doesn't block.

## Draft milestone M91

The full draft was given in the research agent's final message (lead's transcript, 2026-10-04). In summary:

- Lanes 0 (strings, constants, protected paths), R (Muse parity), E (extension events, spark-hooks.json), I (import), P (format adapters), W (wiring, docs, gate).
- Step 1 runs echo captures first: the SessionFork payload, Interrupt, and whether StopFailure and PostToolBatch fire on 1.4.2.
- Acceptance items 1–8.
- Every guard is red-drilled.
- One live check on the contributor model: a Codex deny guard and a Cursor deny guard each stop one bash call.
- Security is as in M51/M54, plus: no new power; an adapter keeps its source's fail-closed rules; other agents' hook folders become protected writes.

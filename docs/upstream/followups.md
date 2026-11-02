# Comments for open `muse-code-sdk` issues

Read 2026-11-02 from the public issue pages and from
<https://dev.meta.ai/docs/muse-code/changelog>. The newest published
changelog section is 1.4.13. There is no 1.4.14 section. The schema checks
are Muse Code 1.4.14 (1.4.14-R7309.1), offline, macOS 15.7.4 (24G517).

This file is for the lead. Paste a comment only where a block is given.
Anything else stays as it is. No maintainer question on these threads was
left unanswered. The acknowledgements say the report is logged and that the
version will be posted when a fix ships. They do not ask a question.

The 1.4.14 method list used below is the stable schema from
`muse schema generate-json-schema`. It has no `session/delete`, no
`session/rewind`, no `hook/started`, no `hook/completed`, no `mcp/list`, no
memory method, no schedule method, no voice method and no completion method.
It does have `usage/read`, `hook/list`, `plugin/list`, `session/sideChat`,
`session/leave`, `feedback/submit` and `computerUseSettings/read` plus
`computerUseSettings/update`.

## Post these two

### #80 — approval judge for `muse serve`

Fixed in 1.4.6. #80 asked for `--approval-judge` on `muse serve`, or a
session field / the built-in auto-review profile on `session/start` and
`session/setApprovalMode`. The 1.4.6 changelog says `muse serve` runs its
own reviewer, honors `permissions.default_profile: ":auto-review"`, and
`session/start` accepts `permissionProfile`. 1.4.8 accepts it on
`session/resume`. The counterexample on the thread is `@muse-code/sdk` 1.4.4,
which is before 1.4.6. This pass did not start a live serve to watch the
reviewer. The comment reports the changelog, not a new capture.

No local substitute reviewer to delete. Scheduled runs already set the
upstream `:auto-review` profile (`src/core/backends/musecode/MuseCodeHost.ts`
lines 1717–1723). The quarantine path that throws
`permissionReviewerMissing` (lines 1709, 2635 and 2689) stays. It is not a
stand-in for the missing serve judge.

The question on the thread about resuming a saved `:auto-review` session is
from another client, not from a maintainer, and not ours to answer.

```text
Fixed in 1.4.6: `muse serve` runs its own reviewer, honors
`permissions.default_profile` `:auto-review`, and `session/start` accepts
`permissionProfile`. 1.4.8 also accepts it on `session/resume`. The 1.4.2
gap (judge disabled, no profile field) is closed.
```

Target: <https://github.com/meta-models/muse-code-sdk/issues/80>

### #48 — file input parts

Not fixed. New information, so a status note is worth posting. It does not
add a request. `TurnInputPartType` on the 1.4.14 stable schema is `text`,
`image`, `skill`, `video`. The schema says a structured mention part is
reserved and rejected, and that a mention is `@path` in a text part. Audio
and document parts are absent. The maintainer already logged the original
request.

The comment at `src/core/agent/agentBackend.ts` line 609 still says 1.3.0
has no video part. That comment is stale. This lane is docs only and did
not change it. Do not treat the schema as a capture of a video part on the
wire.

```text
1.4.14 `TurnInputPartType` is `text`, `image`, `skill`, `video`. Audio and
document parts are still absent. Structured mentions are still rejected
(the schema says to write `@path` in a text part). This is a status note,
not a new request.
```

Target: <https://github.com/meta-models/muse-code-sdk/issues/48>

## Already posted — do not repeat

### #51 — `session/delete`

The comment in `muse-code-session-delete.md` is already on the issue
(2026-11-02). `session/delete` is still method-not-found on 1.4.14. The
1.4.3 changelog removed it. 1.4.11 added `session/leave`, which is present.
Archive, search and export are not in the schema.

Workaround stays. Do not remove it.

- `src/core/backends/musecode/lifecycle.ts` lines 43–50
- `src/core/backends/musecode/MuseCodeHost.ts` line 332 and line 4078
- `src/acp/agent.ts` line 4572
- `src/host/conversation/conversationController.ts` line 7613

### #26, #30, #31 — the 1.4.3 retests

`docs/research/muse-1.4.3-upstream.md` drafted those retests. They are
already on the issues (the #26 update through 1.4.3, and the 1.4.3 notes on
#30 and #31). Do not draft them again.

SDK #29 (approval-ledger fault) is not in the open list. 1.4.3 fixed that
fault. The same research note says not to certify recovery of a session
that was already damaged. Do not re-open #29.

## Not fixed — no comment

Windows was not retested here. macOS cannot stand in for it.

### #26 — sandbox cwd `System32`

Open. Maintainer acknowledgement only. The latest note on the thread: on a
prepared 1.4.3 host the cwd is the workspace, and a sandboxed write is
still Access Denied. A fresh machine was not retested. No changelog line
through 1.4.13 says the profile-workspace cwd or the write ACL is fixed.

Workaround stays: `src/core/backends/musecode/sandbox.ts` `resolveShellSandbox`
(lines 344–357) turns the sandbox off for a Windows profile workspace when
the setting is `auto`, and `serveArguments` (line 389) passes
`--disable-sandbox`.

### #30 — Windows `session/rename`

Open. Our 1.4.3 note is already there. 1.4.8 answers with
`session/rename is not supported on this platform` and the grantable
capability `sessionRename`. Rename still does not succeed. No comment: a
note that the error is now honest would re-open the feature request.

Workaround stays: `src/core/backends/musecode/MuseCodeHost.ts` line 3356,
`canEditSessions: parsed.platformOs !== WINDOWS_OS`, comment at lines
3349–3356. The client requests `sessionRename` and does not hide rename
from that grant. The OS check is the gate. It also hides fork, which is
#31.

### #31 — Windows `session/fork` `WriteFailed`

Open. Our 1.4.3 note is already there. Later changelog lines about fork are
load, cut and full disk. None is this Windows `WriteFailed`. Same
`canEditSessions` gate as #30. No comment.

### #36 — Remote Control

Acknowledgement only. No method. No comment.

### #39 — settings over the session protocol

Acknowledgement only. `computerUseSettings/read` and
`computerUseSettings/update` are not a general settings API. No comment.

### #40 — tool set over the session protocol

Acknowledgement only. No `tool/list`. No comment.

### #41 — live view fidelity

Acknowledgement only. Some view fields have landed since the report
(`agentMessage` `messagePhase`, a background flag in later notes). The
named request is not confirmed complete. No close comment.

### #42 — rewind and side chats

Partial. `session/sideChat` is in the 1.4.14 schema. `session/rewind` is
not. The issue asked for `session/side/start` and for rewind-to-a-turn.
No comment that asks for rewind again.

### #43 — permission profiles

Partial. 1.4.6 adds `permissionProfile` on `session/start` and the serve
reviewer (see #80). 1.4.8 adds it on `session/resume`. 1.4.13 adds deny
rules on macOS and Linux. Plan, read-only, the judge's full surface, trust
and worktrees are not all confirmed. No close comment.

### #44 — account and usage

`usage/read` is in the 1.4.14 schema. The 1.4.13 changelog says the
`muse usage` command shows the subscription allowance without a turn. That
is the CLI. It is not confirmed to be the session-protocol ask (a stable
`account/*`, the billing lane, subscription usage with no prior turn). No
close comment.

### #45 — MCP management

Acknowledgement only. No `mcp/list`. `sessionMcp` is a grantable capability,
not this API. No comment.

### #46 — memory

Acknowledgement only. No memory method. No comment.

### #47 — scheduled prompts

Acknowledgement only. The CLI has `/loop`. No session-protocol schedule
method. No comment.

### #49 — hook visibility

We already replied on 2026-10-04. `hook/list` and `plugin/list` are in the
1.4.14 schema, and the changelog describes hook runs as `hookRun` items.
There is no `hook/started` or `hook/completed` method. Load warnings and
trust visibility are not confirmed. Partial. No new comment.

### #50 — bundled commands

Acknowledgement only. `feedback/submit` already existed. No `command/list`.
No comment.

### #52 — voice

Acknowledgement only. No voice method. No comment.

### #79 — checkpoint-suffix

Not fixed. The 1.4.9 line is narrower than the report: it covers the next
model step after a compaction whose history clean-up was refused. A
2026-10-29 comment on the thread reports the same error on Linux with Muse
Code 1.4.14 installed, on two subagents. No comment from us. The third-party
reports already say it recurred.

### #81 — `item/readOutput` and `approval/decide` queue

Not shown to be fixed. The report measured 60–80 second queues on 1.4.2
Windows. 1.4.10 says `muse serve` keeps answering other requests while
history loads and while reading tool output. That sentence is not this
measurement. This pass did not time a long turn. The issue body says reads
are avoided while a turn runs. No such gate was found in the current
client (`item/readOutput` is still handled). No comment, and no workaround
line to delete.

### #83 — inline completion

No comments. No completion method. `meta-model-cookbook` #56 is the model
API sibling (a low-latency completion path). Different tracker. No comment
here.

### #84 — hook docs

Not fixed. The user manual
(<https://dev.meta.ai/docs/muse-code/extending>, read 2026-11-02) lists
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `PostToolBatch`, `PreLLMCall`, `PostLLMCall`,
`PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`,
`Notification`, `Stop`, `StopFailure` and `SessionEnd`. It does not list
`Interrupt` or `SessionFork`. `PostToolUseFailure` is now on that list, so
that one gap in the original report is partly closed. The 1.4.0 changelog
added an observation-only `Interrupt` hook. The questions in the issue body
are ours, to the maintainer. There is no maintainer reply to answer. The
SDK site's "checked against Muse Code 1.3.0" sentence was not re-read this
pass. No comment.

### #85 — reminder-agent hooks

No comments. Not in the changelog through 1.4.13. No comment.

### #86 — file-tool writes outside the workspace

Partial. 1.4.13 adds macOS and Linux filesystem deny globs. 1.4.10 stops
sandboxed commands from reading or changing `~/.config/muse` and
`~/.config/tbh`. The report's gap is writes with the sandbox disabled, and
`denyUnmatched` not stopping in-workspace file writes, and no read-only
profile over the session protocol. Not confirmed on Windows. No comment.

### #89 — `function_call_arguments.done` name mismatch

No comments. Not in the changelog through 1.4.13. No comment.

### #90 — spawn contract

This is `muse-code-spawn-contract.md`. Open, no comments. The 1.4.14 schema
has no pre-exec method. Not re-measured live. No new comment.

### #96 — Windows sandbox ACL lock

No comments. Shell calls time out at 120 seconds and
`muse exec --disable-approval` keeps a turn that cannot run (reported on
1.4.3). No ACL or 120-second line in the changelog through 1.4.13. Not
retested here. No comment. A pre-exec search also returns #96. It is not
the spawn contract.

### #134 — reserved MCP server name

Filed 2026-11-02 from `muse-code-mcp-reserved-name.md`. Open, no comments.
Do not file it again and do not comment.

## Other drafts from this tree

- `session/listChanged` (`docs/research/m106-s1-upstream.md`, request 3).
  The method is in the 1.4.14 schema. The gap is a capture we do not have.
  Do not file.
- `feedback/submit` receipt docs (`docs/research/m106-s1-upstream.md`,
  request 2). The schema now documents the receipt. See
  `muse-code-feedback-receipt.md`. Do not file. The refusal in
  `feedback.ts` stays until a capture.
- Model API drafts for the count route, `input_audio`, QuickTime and
  compaction are already `meta-model-cookbook` #58, #59 and #60. The
  soundtrack draft is not filed. Each needs the live check in its report.
  This pass also saw cookbook #56, #57 and #61 from the same author. They
  are not these drafts and were not re-reviewed.
- No report for the ACP SDK, the MCP SDK, Electron, VS Code APIs, Hyprland,
  Zed, JetBrains or Neovim. The notes in `docs/research/` and
  `docs/certification/` that name those projects are design surveys or
  platform limits. None is an unfiled defect that current users hit, with a
  workaround in this tree, beyond the Codex and Copilot reports already in
  this folder.

# Certification — other coding agents' folders are protected writes (D24)

## 2026-10-04

### The change

`PROTECTED_PATH_SEGMENTS` (`src/shared/constants.ts`) gains `['.claude']`,
`['.codex']`, `['.cursor']`, `['.gemini']`, `['.github', 'hooks']`,
`['.github', 'copilot']`, `['.devin']`, `['.windsurf']`, `['.kiro']`,
`['.clinerules']`, `['.amp']` and `['.opencode']`. They match as the existing
entries do (`src/core/protectedPaths.ts`): whole path segments, anywhere in
the path, the last segment included (so a `.clinerules` file counts), with
letter case ignored, over the workspace-relative path after links and
junctions are resolved.

The reason (hook-parity research, 2026-10-04): those folders hold hooks, MCP
servers, plugins and settings that the other agent runs outside this
extension's sandbox and approvals. Before the change, a Model API session in
Edit automatically (or Auto) could write a hook into `.claude/settings.json`
without a protected-write card, and it would run the next time the user
started Claude Code in that workspace.

The approval card's reason is the single phrase "Protected write"; it names
no kind of path, so no new text and no translations were needed.

### Tests

`test/unit/permissions.test.ts`, `isProtectedPath: other coding agents’
folders` (16 tests):

- One test per folder (12): its hook, MCP or settings files are protected,
  at the root and nested in upper case (`packages/app/.CLAUDE/SETTINGS.JSON`).
- Mixed case and nesting: `.Claude/settings.json`,
  `apps/web/.Cursor/mcp.json`, `.GitHub/Hooks/hooks.json`,
  `tools/.github/COPILOT/settings.json`.
- Windows separators as the tools resolve them: `.Claude\settings.json`
  resolved for `win32` is `.Claude/settings.json` and protected; resolved
  for `linux` it is one file name at the root (the backslash is part of
  the name) and not protected.
- A junction: `cfg\settings.json`, where `cfg` leads to `.claude`, is
  judged by its canonical path `.claude/settings.json` and protected, while
  the name as written is not.
- Look-alikes stay ordinary: `notclaude/.claudex/file`,
  `.claude-backup.txt`, `claude/settings.json`, `docs/.claude.md`,
  `my.cursor/mcp.json`, `.cursorignore`, `.codex.bak/hooks.json`,
  `.geminiignore`, `.github/hooksmith/x.json`, `hooks/.github`,
  `copilot/.github`, `.kirox/hooks/a`, `.clinerules.md`,
  `amp/plugins/run.ts`, `opencode/plugin/run.ts`.

`test/unit/modelApiHost.test.ts`, `ModelApiSession: turns` (13 tests):

- One test per folder (12), through the real Model API host and its fake
  file system: a `write_file` into the folder under Edit automatically
  (`mspApprovalMode('acceptEdits')`) raises an approval with
  `isProtectedWrite: true`, `editAutomaticallyChoice` leaves it to the
  card, and declining it writes nothing; the same write under Bypass
  (`mspApprovalMode('bypassPermissions')`) is written with no approval.
- Nested, case and junction, end to end: in one Edit automatically turn,
  `packages/app/.Cursor/mcp.json` and `cfg/settings.json` (`cfg` a junction
  to `.claude`) keep their cards and are not written, and
  `.claude-backup.txt` is answered by Edit automatically and written.

Run (targeted, `--maxWorkers=2`):

```
npx vitest run test/unit/permissions.test.ts --maxWorkers=2
      Tests  48 passed (48)
npx vitest run test/unit/permissions.test.ts test/unit/modelApiHost.test.ts --maxWorkers=2 \
  -t "agent folder|in Edit automatically, and Bypass writes it|other coding agents|asks for a protected write even in Auto"
      Tests  30 passed | 584 skipped (614)
```

### Test-fire proof (red drill)

With `['.cursor']` removed from the list, the targeted run fails (exit 1):

```
     × asks before a write to .cursor in Edit automatically, and Bypass writes it
     × protects an agent folder nested, in any case, and through a junction; not a look-alike
     × protects .cursor, at any depth and in any case
     × protects mixed case and nesting
 FAIL  test/unit/permissions.test.ts > isProtectedPath: other coding agents’ folders > protects .cursor, at any depth and in any case
AssertionError: .cursor/hooks.json: expected false to be true // Object.is equality
 FAIL  test/unit/modelApiHost.test.ts > ModelApiSession: turns > asks before a write to .cursor in Edit automatically, and Bypass writes it
AssertionError: expected { type: 'approvalRequested', …(9) } to match object { subject: { …(2) }, …(1) }
 Test Files  2 failed (2)
      Tests  4 failed | 26 passed | 584 skipped (614)
```

The entry was restored and the same run passes again (30 passed).

### Where the protection reaches

| Write path                          | How it is covered                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model API `write_file`, `edit_file` | `ModelApiHost` judges `isProtectedPath(target.canonical)`: asks in every mode but Bypass (Plan refuses), no session rule or hook answers it, the card carries `isProtectedWrite`, and Edit automatically (`editAutomaticallyChoice`) and the M78 Auto reviewer never answer it.          |
| Model API `rename_symbol`           | `isProtectedRename`: protected when any file it changes is.                                                                                                                                                                                                                              |
| Model API image generation          | Protected target: the paid-use popup asks even when the feature is allowed always.                                                                                                                                                                                                       |
| Model API subagents                 | Children run their tools through the same host path; their approvals carry the flag, answered under `childPermissionMode`.                                                                                                                                                               |
| ACP agent and headless `exec`       | Same host and `editAutomaticallyChoice`; a protected write reaches the editor's permission prompt, and headless runs deny it.                                                                                                                                                            |
| Best-of-N                           | An attempt writes only in its own worktree; applying the chosen snapshot refuses any protected path (`validatePaths`, `bestOfNWorkspaceEdits`).                                                                                                                                          |
| Shell commands, MCP tools           | Not path-checked: no command parsing exists. A command asks in every mode but Bypass unless a command rule, a session rule or the Auto reviewer allows it.                                                                                                                               |
| Muse Code backend, M90 reviewer     | The CLI's own `protectedWrite` flag, and since the third pass below the extension's list over every `fileAccess` write approval's path: Edit automatically and the M90 reviewer never answer one, and its card offers no standing rule. A write Muse Code makes unasked is out of reach. |
| Checkpoint restore and Redo         | Not path-checked: they put back only bytes the model's own file tools wrote (already through the cards above), on the user's own action.                                                                                                                                                 |
| Picked text attachments (M54)       | Refused as private, as for the other protected paths.                                                                                                                                                                                                                                    |

## 2026-10-04, second pass: the agents' own files

Approved by the owner after the first pass named these as not protected.

### The change

- `PROTECTED_FILE_NAMES` gains `gemini.md`, `.cursorrules`,
  `.windsurfrules`, `.roomodes`, `.mcp.json`, `opencode.json` and
  `opencode.jsonc`, matched by the last path segment in any folder, letter
  case ignored.
- `PROTECTED_PATH_SEGMENTS` gains `['.continue']`, `['.roo']` and
  `['.github', 'copilot-instructions.md']`. A run may end at the file name,
  so the last one protects that file only directly under `.github`.
- Already covered, now tested as files: `AGENTS.md` and `CLAUDE.md` (file
  names since D24) and `.clinerules` as a file (the segment rule matches the
  last segment).
- Some of these run nothing: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
  `.cursorrules`, `.windsurfrules`, `.roomodes`, `.clinerules` and
  `.github/copilot-instructions.md` are instructions. They are protected
  anyway because they steer the next agent that reads them, so an
  instruction a prompt injection plants there persists after the
  conversation (PLAN.md §9).

Roo Code and Continue, from their documentation (2026-10-04):

- Roo Code (`roocodeinc.github.io/Roo-Code`): custom modes in `.roomodes`,
  "a file in your project root" (YAML or JSON); rules in `.roo/rules/` and
  `.roo/rules-{mode-slug}/`, with a `.roorules-{mode-slug}` file fallback;
  project MCP servers in `.roo/mcp.json`, whose stdio servers run "as a
  child process on your machine".
- Continue (`docs.continue.dev`): rules in `.continue/rules` and workspace
  MCP servers in `.continue/mcpServers` (YAML or JSON), stdio servers
  started as local commands.

### Tests

- `test/unit/permissions.test.ts`, `isProtectedPath: other coding agents’
files` (13 tests): one per file or folder (12), each at the root, under
  `packages/app/` in upper case and under `src/` in lower case, and one for
  look-alikes that stay ordinary: `.mcp.json.bak`, `mcp.json`,
  `docs/GEMINI-notes.md`, `gemini.md.txt`, `.cursorrules.md`,
  `windsurfrules`, `copilot-instructions.md` at the root,
  `.github/docs/copilot-instructions.md`, `my-opencode.json`,
  `opencode.json5`, `.roomodes.bak`, `.continuex/rules/a.md`,
  `continue/rules/a.md`, `.roo-backup/mcp.json`, `roo/mcp.json`.
- `test/unit/modelApiHost.test.ts` (13 more rows of the same per-path
  test): each file asks under Edit automatically, Edit automatically leaves
  it to the card, declining writes nothing, and Bypass writes it with no
  approval.

Run on the Kubuntu rig (`scratchpad/rig-gate/rig-test.sh kubuntu`, slot
`protect-a`, the owner's rule from 2026-10-04 that vitest runs on a rig):

```
test/unit/permissions.test.ts --maxWorkers=2
      Tests  61 passed (61)
test/unit/modelApiHost.test.ts --maxWorkers=2 -t "agent folder|in Edit automatically, and Bypass writes it|protected write"
      Tests  29 passed | 550 skipped (579)
```

### Test-fire proof (red drill)

With `'.mcp.json'` removed from the file names and `['.roo']` from the
segments, the targeted run fails (exit 1):

```
     × protects .mcp.json, at any depth and in any case
     × protects .roo, at any depth and in any case
     × asks before a write to .mcp.json in Edit automatically, and Bypass writes it
     × asks before a write to .roo in Edit automatically, and Bypass writes it
 FAIL  test/unit/permissions.test.ts > isProtectedPath: other coding agents’ files > protects .mcp.json, at any depth and in any case
AssertionError: .mcp.json: expected false to be true // Object.is equality
 FAIL  test/unit/permissions.test.ts > isProtectedPath: other coding agents’ files > protects .roo, at any depth and in any case
AssertionError: .roo/mcp.json: expected false to be true // Object.is equality
 Test Files  2 failed (2)
      Tests  4 failed | 50 passed | 586 skipped (640)
```

Both entries were restored and the same run passes again (54 passed).

## 2026-10-04, third pass: Muse Code's file-write approvals

Approved by the owner after the first pass found that, on Muse Code, Edit
automatically and the M90 reviewer went only by the CLI's `protectedWrite`
flag.

### The capture (AGENTS.md rule 13)

`scratchpad/protect-live/probe-write.mjs` and `probe-write2.mjs`: the SDK's
`spawnMspConnection` over `muse-bin-1.4.2-R4684.1.exe serve
--disable-sandbox --trust-workspace`. Those are the extension's arguments
for a workspace under the user's profile (`shellSandbox: auto` turns the
sandbox off there). Each turn ran in a fresh empty folder under the
scratchpad, in `promptUnmatched` (the extension's Manual and Edit
automatically), on `muse-spark-1.3-contributor`. Every notification and
server request was logged raw. The probe answered a file approval "Allow
once" (the files land in throwaway folders) and would abort anything else.
Below, `<scratchpad>` is that folder (under `<home>\AppData\Local\Temp`)
and `<home>` the owner's profile.

**Turn 1.** The prompt asked for `notes.txt` and `.claude/settings.json`.
Expected about 5 to 8 model attempts.

- No `approval/requested` came at all. Muse Code wrote both files:

  ```json
  {"tool":"write_file","status":"completed","args":"{\"content\":\"ordinary\",\"path\":\"notes.txt\"}","visibleOutput":"wrote 8 bytes to \\\\?\\<scratchpad>\\protect-live\\ws\\notes.txt"}
  {"tool":"write_file","status":"completed","args":"{\"content\":\"{}\",\"path\":\".claude/settings.json\"}","visibleOutput":"wrote 2 bytes to \\\\?\\<scratchpad>\\protect-live\\ws\\.claude\\settings.json"}
  ```

- So Muse Code does **not** protect `.claude/`: it neither asked nor
  flagged the write.
- The trace log (`cli-ea53e860-8db0-4433-b9bc-5709bcdab355.log`) counted
  **7 model attempts**: 3 main-loop steps (two `write_file` calls and the
  reply) and 4 reminder children (`skill-reminder` twice, `goal-reminder`,
  `verify-reminder`).

**Turn 2.** No file-write approval frame had arrived, so one more turn
asked for `.muse/hooks.json` (which Muse Code protects, M29) and for a file
outside the workspace, in a sibling throwaway folder. Expected about 7
model attempts, at most about 10.

- `.muse/hooks.json` raised this `approval/requested`, sent both as the
  notification and as the mirrored `approval/request` server request (the
  stream fields `sourceRange` and `viewCursor` are left out):

  ```json
  {
    "sessionId": "01a1088e-b200-7210-8d90-371d3494de54",
    "approvalId": "01a1088f-3849-78c0-a0bb-b691f57c1f27",
    "turnId": "01a1088e-ca4a-7000-bebe-0697eb540868",
    "taskId": "01a1088f-3849-78c0-a0bb-b691f57c1f27",
    "itemId": "01a1088f-3849-78c0-a0bb-b691f57c1f27",
    "toolCallId": "call_01a1088f38e571a7a1a1c07a3774a9d6",
    "toolName": "write_file",
    "rawArgs": "{\"content\":\"{}\",\"path\":\".muse/hooks.json\"}",
    "subject": {
      "kind": "fileAccess",
      "toolName": "write_file",
      "path": "\\\\?\\<scratchpad>\\protect-live\\ws2\\.muse\\hooks.json",
      "access": "write"
    },
    "currentRequirementId": {
      "approvalId": "01a1088f-3849-78c0-a0bb-b691f57c1f27",
      "sourceIndex": 0
    },
    "availableChoices": [
      { "choiceId": "allow_once", "label": "Allow once", "decision": "approved", "scope": "once" },
      {
        "choiceId": "abort",
        "label": "Reject",
        "decision": "abort",
        "scope": "once",
        "acceptsFeedback": true
      }
    ],
    "protectedWrite": true,
    "judgeEscalated": false
  }
  ```

  Then `approval/resolved` came with `decision: approved`,
  `policyResult: allow`, `resolvedBy: user` and `stageEvidence: []`.

- The shape: `subject.kind` is `fileAccess` and `access` is `write`. The
  `path` is **absolute**, with the Windows verbatim prefix `\\?\` and
  backslashes, not the relative path the model wrote (`rawArgs`). The
  subject carries no `workspaceRoot`. A protected write offers no standing
  choice, only Allow once and Reject.
- The file outside the workspace was written with **no approval**:

  ```json
  {
    "tool": "write_file",
    "status": "completed",
    "args": "{\"content\":\"outside\",\"path\":\"<scratchpad>\\\\protect-live\\\\outside\\\\notes.txt\"}",
    "visibleOutput": "wrote 7 bytes to <scratchpad>\\protect-live\\outside\\notes.txt"
  }
  ```

- The trace log (`cli-19e45740-70b5-4f66-9cb4-93e4f1be8c6b.log`) counted
  **21 model attempts**, over the estimate: 7 main-loop steps (the model
  read each file back after writing it) and 14 reminder children.
- **Spend for the capture: 28 model attempts in all.**

### The change

- `isProtectedFileAccess` (`src/core/protectedPaths.ts`) is true for a
  `fileAccess` subject with any access but `read` (an access it does not
  name counts as a write). Both separators are turned into `/` and the
  path is judged by `isProtectedPath`, every segment counting. So the
  absolute path Muse Code names is judged, and so is a file outside the
  workspace (`~/.claude/settings.json`). A workspace that itself sits
  inside a protected folder makes every such write ask, which only asks
  more. The Model API's `fileWrite` subjects are not judged here: its host
  already judges the canonical path, and a memory note under
  `.agents/memory` is deliberately an ordinary edit (D41).
- `approvalRules.ts`: `editAutomaticallyChoice` and `isReviewableApproval`
  (the M90 reviewer's gate) refuse such an approval whatever its
  `isProtectedWrite` says.
- `mapNotification.ts` (every Muse Code approval, the server request
  included, maps here): `isProtectedWrite` is Muse Code's flag or the
  path's verdict, so the card says "Protected write". For such a subject,
  in `approval/requested` and in `approval/updated`, every approving
  choice whose scope is not `once` is dropped. "Always allow" would be a
  rule Muse Code answers later writes by without a card. Allow once and
  every refusal stay, as Muse Code itself offers for a write it protects.
  This choice-scope filter does not depend on the exact wording of Muse
  Code's choices.

### Tests

`test/unit/museCodeProtectedWrites.test.ts` (25 tests) uses
`test/unit/helpers/protectedWriteCapture.ts`, the captured frame with only
the workspace folder replaced. The "Always allow" choice added to it is the
one captured on a shell approval (`helpers/stageRaceCapture.ts`), because
the file-write capture offered none.

- The captured frame maps as Muse Code flagged it, and neither Edit
  automatically nor the reviewer answers it.
- Nine paths in a frame Muse Code does not flag. Each maps to
  `isProtectedWrite: true` with the standing rule dropped, and is answered
  by neither Edit automatically nor the reviewer. The paths:
  - absolute as captured (`\\?\…\ws2\.claude\settings.json`)
  - absolute with forward slashes
  - absolute POSIX (`/home/dev/ws2/.claude/settings.json`)
  - relative with `/` and relative with `\`
  - mixed case (`.Claude\Settings.JSON`)
  - outside the workspace from home (`~/.claude/settings.json`)
  - outside the workspace absolute (`\\?\C:\Users\dev\.claude\settings.json`)
  - a nested agent file (`…\packages\app\.mcp.json`)
- The same nine paths on an event with `isProtectedWrite: false` (the rules
  on their own, without the mapping): both rules still refuse.
- Four look-alikes stay as Muse Code asked them, with the "Always allow"
  choice kept, Edit automatically answering "Allow once" and the reviewer
  eligible: `.claude-backup.txt`, `notclaude\.claudex\file`,
  `/home/dev/ws2/claude/settings.json` and `docs\.mcp.json.bak`.
- A read stays a read; an unnamed or unknown access counts as a write; a
  subject with no path, or the Model API's `fileWrite`, is not judged here.
- `approval/updated` drops the standing choice for a protected path and
  keeps it for an ordinary one.

Run on the Kubuntu rig (slot `protect-a`):

```
museCodeProtectedWrites, approvalRules, mapNotification, MuseCodeHost,
museCodeReviewer, acpAgent, conversationController, permissions --maxWorkers=2
 Test Files  8 passed (8)
      Tests  905 passed (905)
```

`npm run cycles`, `npm run deadcode`, `npm run build` (bundle budgets) and
`npx jscpd` passed on the rig too.

### Test-fire proof (red drills)

Each drill was run on the rig against `museCodeProtectedWrites.test.ts`
(25 tests), then restored:

- A by undoing its one-line edit;
- B and C from backups whose SHA-256 the restored file matched
  (`approvalRules.ts` `3cc4a9d1…`, `mapNotification.ts` `0bf64d30…`).

| Drill | Broken                                                                                                   | Result                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A     | `isProtectedFileAccess` without turning `\` into `/`                                                     | 11 failed, 14 passed, exit 1: every backslash path, in both the mapping and the rules tests, and the access test             |
| B     | `isProtectedFileAccess(event.subject)` removed from `editAutomaticallyChoice` and `isReviewableApproval` | 9 failed, 16 passed, exit 1: "refuses to answer it by its path alone" for all nine paths                                     |
| C     | the mapping back to Muse Code's flag only, with no choice filter                                         | 10 failed, 15 passed, exit 1: "protects a write Muse Code does not flag" for all nine paths, and the `approval/updated` test |

After the restores, `museCodeProtectedWrites`, `approvalRules` and
`mapNotification` pass on the rig (140 passed).

### What remains Muse Code's

The extension can judge only what Muse Code asks about. With the sandbox
off (the extension's posture for a workspace under the user's profile) and
even in Manual, Muse Code 1.4.2 wrote `.claude/settings.json` and a file
outside the workspace without asking, so neither reached a card. That is
Muse Code's policy and belongs upstream: it should protect other agents'
configuration folders, as it does its own `.muse`, and ask before writing
outside the workspace when its sandbox is off.

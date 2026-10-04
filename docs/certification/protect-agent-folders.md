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

| Write path                          | How it is covered                                                                                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model API `write_file`, `edit_file` | `ModelApiHost` judges `isProtectedPath(target.canonical)`: asks in every mode but Bypass (Plan refuses), no session rule or hook answers it, the card carries `isProtectedWrite`, and Edit automatically (`editAutomaticallyChoice`) and the M78 Auto reviewer never answer it. |
| Model API `rename_symbol`           | `isProtectedRename`: protected when any file it changes is.                                                                                                                                                                                                                     |
| Model API image generation          | Protected target: the paid-use popup asks even when the feature is allowed always.                                                                                                                                                                                              |
| Model API subagents                 | Children run their tools through the same host path; their approvals carry the flag, answered under `childPermissionMode`.                                                                                                                                                      |
| ACP agent and headless `exec`       | Same host and `editAutomaticallyChoice`; a protected write reaches the editor's permission prompt, and headless runs deny it.                                                                                                                                                   |
| Best-of-N                           | An attempt writes only in its own worktree; applying the chosen snapshot refuses any protected path (`validatePaths`, `bestOfNWorkspaceEdits`).                                                                                                                                 |
| Shell commands, MCP tools           | Not path-checked: no command parsing exists. A command asks in every mode but Bypass unless a command rule, a session rule or the Auto reviewer allows it.                                                                                                                      |
| Muse Code backend, M90 reviewer     | The CLI's own `protectedWrite` flag; Edit automatically and the M90 reviewer never answer a flagged write. The extension's list is not applied to Muse Code's approvals.                                                                                                        |
| Checkpoint restore and Redo         | Not path-checked: they put back only bytes the model's own file tools wrote (already through the cards above), on the user's own action.                                                                                                                                        |
| Picked text attachments (M54)       | Refused as private, as for the other protected paths.                                                                                                                                                                                                                           |

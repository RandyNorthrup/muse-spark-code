# PATHGUARD spawn inventory — every program start and its guard (2026-10-18, lane PR249FIX2)

Guarded builder = `buildChildEnvironment` with `workspaceRoot` + `realpath`
(PATH entries inside the workspace dropped, empty/relative dropped,
`NoDefaultCurrentDirectoryInExePath=1` on Windows). "Guarded env" below
means exactly that. Command resolution = `resolveExecutable` /
`absolutePathEntries` / launch `absoluteEntries`: absolute entries only
(Windows drive-relative excluded) but workspace entries NOT excluded —
a planted program on an absolute workspace PATH entry still resolves
(Grok re-review of PR #249, verdict: not mergeable).

## Through the guarded builder

- `muse serve` main host (`src/host/backend/museCodeBackendManager.ts:279`):
  guarded env, `cwd` = workspaceRoot. GUARDED.
- VS Code account host (`src/host/auth/accountHost.ts:219`,
  `src/extension.ts` passes workspaceRoot): guarded env, `cwd` = workspaceRoot.
  GUARDED.
- `muse init`, `muse config status` (`src/extension.ts:4511,4592`):
  `workspaceRoot` + `backend.childEnvironment()`. GUARDED.
- `muse skills list` (`src/host/commands/skillsCommands.ts:150`): resolved
  launch command; check env at fix time.
- Per-folder runtime `muse serve` (`src/runtime/backends.ts:724`
  `museCodeManager(deps, cwd)`): guarded env. GUARDED.
- Report-time CLI presence probe (`src/runtime/reportCommand.ts:83`):
  `resolveMuseLaunch` only, no spawn.

## Now through the guarded builder (fixed this lane)

- `muse login` (`src/runtime/main.ts:1347` via the shared manager, now
  scoped to the launch directory; spawn names that directory as cwd):
  guarded env + cwd. GUARDED.
- Runtime account host (shared manager scoped to the launch directory;
  `connectAccountSession` passes it as `workspaceRoot`, spawn sets cwd):
  guarded env + cwd. GUARDED.
- Windows sandbox check/setup (`src/extension.ts:1781` now passes
  `workspaceRoot` and `backend.childEnvironment()`): guarded env + cwd.
  GUARDED.
- `muse` lookup (`MuseCodeBackendManager.resolveLaunch` passes the
  workspace): planted `muse` on an absolute workspace PATH entry never
  resolves. GUARDED.
- `git` lookup (both runners pass each run's working directory):
  planted `git` there never resolves. GUARDED.

## Resolution holes (fixed this lane)

- `isFullyQualifiedWindowsPath` (`src/core/executables.ts:32`): `//server/share`
  and `//?/C:/…` not recognised (only `\\`), so `//localhost/C$/…` is rewritten
  to `C:\localhost\C$\…` before realpath and kept. FIX: normalise separators
  before classifying, treat `//server/share` as UNC, realpath the original entry.
- Verbatim `\\?\C:\…`: dropped only when realpath returns the normal path;
  lexically it never matches the workspace. FIX: strip the verbatim prefix
  (and map loopback admin shares `//localhost/C$/…` → `C:/…`) before comparing.
- `resolveMuseLaunch` / `resolveExecutable` probe absolute workspace entries:
  planted `muse`/`git` on an absolute workspace PATH entry resolves. FIX:
  workspace-aware exclusion at the resolvers, wired where the workspace is known
  (serve/login/account/sandbox managers first).

## Unguarded by design so far (command absolute-resolved, env PATH passes through)

- Plugin host (`src/core/backends/modelapi/pluginHost.ts:139,615`), MCP servers
  (`src/core/backends/modelapi/mcp/pool.ts:289` via `src/host/backend/mcpProcess.ts`),
  git (`src/host/git.ts:299,503`), browser (`src/core/browser/browserRun.ts:555`),
  voice/media (`src/core/voice/helperLocation.ts`, `src/core/media/record/macos.ts:136,276`,
  `src/host/voice/voiceProcesses.ts:69`), governed runners
  (`src/core/resources/process.ts:133,219,254,409`, `src/core/resources/trees/run.ts:26`,
  `src/core/resources/trees/linuxLaunch.ts:81,104`, `src/core/team/workers/engineWorker.ts:204`,
  `src/core/team/workers/workerFence.ts:51`, `src/core/eval/workspace.ts:122`,
  `src/core/locks/processOwner.ts:67`, `src/core/reporting/history.ts:119`,
  `src/core/resources/sampler/system.ts:99`).
- macOS keychain lookup (`src/extension.ts:4606`): absolute `/usr/bin/security`
  command, raw env (command itself not PATH-resolved).
- Terminal launches (`runCliInTerminal`): the user's interactive terminal, intentional.

# PATHGUARD — no workspace program runs from PATH when Muse Code starts

Lane: PATHGUARD (2026-10-18, release night). Branch: `fix/muse-serve-path-guard`.

## Finding (real use, healthy Linux host)

WSL Arch, release candidate 0.19.0, 2026-10-18: Muse Code 1.4.9 runs the
first `bwrap` on the PATH it inherits when `muse serve` starts, before any
prompt or approval. A planted `<workspace>/bin/bwrap` ran twice:
`--unshare-user --unshare-net --ro-bind / / /bin/true` and `--help`.

## Cause in our product

We pass the person's PATH to `muse serve` unchanged. The CLI then resolves
its own helpers (notably `bwrap`) against that PATH, so a program committed
to, linked into, or otherwise placed in the workspace runs with the person's
privileges at serve start.

## Every site that starts an external program with an inherited PATH

Child environment builders (these shape what the child resolves):

1. `src/host/backend/museCodeBackendManager.ts:279` — VS Code editor
   backend: `resourceEnvironment(this.childEnvironment(), resource)` for
   `muse serve`; `childEnvironment()` (`:446`) copies `process.env`
   via `buildChildEnvironment` with `baseEnv: process.env` (`:450`). Used by
   `src/extension.ts`.
2. `src/runtime/backends.ts:164` — ACP host / CLI exec path
   (`muse-spark-code-acp exec`, standalone agent): overrides
   `childEnvironment()` with `baseEnv: env` (the runtime's own environment);
   consumed at `:581` and `src/runtime/main.ts:1347`.
3. `src/core/backends/musecode/accountHomes.ts:183` — capture-gated
   account login terminal: `buildChildEnvironment({ ...environment,
accountHome: home })`; the `environment: ChildEnvironmentInput` it
   spreads comes from the two builders above.
4. `src/core/backends/musecode/launch.ts:296` — `buildChildEnvironment`
   itself: copies `baseEnv` unchanged (PATH included); only PSModulePath,
   extra variables and account-home scrubbing touch it.

`muse serve` spawn points (all take the env above):

5. `src/core/backends/musecode/MuseCodeHost.ts:2773`
   (`spawnResourceMuseConnection`) and the account variant below it —
   the actual `spawn()` of `muse serve`.
6. `src/host/backend/sandboxSetup.ts:151` — `muse sandbox windows
check/setup` via `museCliInvocation` on the resolved launch.
7. `src/host/commands/skillsCommands.ts:150` — `muse skills list`
   on the resolved launch command.
8. `src/runtime/reportCommand.ts:83` — report-time CLI presence probe
   (`resolveMuseLaunch`, no spawn with workspace env).

Other external programs started in a workspace (guarded only as
stated — the `buildChildEnvironment` guard above does NOT apply to them;
correction of the earlier "same guard applies" claim, Grok review of PR
#249):

9. `src/core/backends/modelapi/pluginHost.ts:139,615` — plugin host
   processes (`resourceEnvironment(env, resource)` over
   `withoutCredentials(deps.env)`): the runtime (`node`/`bun`) is resolved
   by `resolveExecutable` on absolute PATH entries only (drive-relative
   Windows entries excluded), and the spawn command is that absolute path;
   the inherited PATH value itself is passed through unsanitized, and no
   `NoDefaultCurrentDirectoryInExePath` is set.
10. `src/core/backends/modelapi/mcp/pool.ts:289` (via
    `src/host/backend/mcpProcess.ts`) — MCP server processes: the server
    command is resolved by `resolveServerCommand` on the absolute entries
    of PATH only (drive-relative Windows entries excluded), and the spawn
    uses that absolute file; the inherited PATH value itself is passed
    through unsanitized.
11. `src/host/git.ts:299,503` — git via absolute resolution
    (`src/core/executables.ts`) plus a spawned fallback.
12. `src/core/browser/browserRun.ts:555` — browser check process.
13. `src/core/voice/helperLocation.ts` (`helperEnvironment`),
    `src/core/media/record/macos.ts:136,276`,
    `src/host/voice/voiceProcesses.ts:69` — voice/media helpers
    (absolute-path located, env inherited).
14. `src/core/resources/process.ts:133,219,254,409`,
    `src/core/resources/trees/run.ts:26`,
    `src/core/resources/trees/linuxLaunch.ts:81,104`,
    `src/core/team/workers/engineWorker.ts:204`,
    `src/core/team/workers/workerFence.ts:51`,
    `src/core/eval/workspace.ts:122`,
    `src/core/locks/processOwner.ts:67`,
    `src/core/reporting/history.ts:119`,
    `src/core/resources/sampler/system.ts:99` — governed runners and
    one-shot probes; executable lookup already skips relative/empty
    entries (`src/core/executables.ts`, `launch.ts:79`), but the child
    PATH variable itself is still passed through.

Already safe (no change needed):

- `resolveMuseLaunch` (`launch.ts:196`) and `resolveExecutable`
  (`executables.ts:42`) only probe fully qualified PATH entries
  (drive-relative Windows entries excluded), so _our_ lookup of
  `muse`/`git` never resolves a workspace planting. The hole that remains
  for other spawns is only the PATH value the child itself inherits.
- Windows current-directory semantics (`executables.ts:1-9`): our own
  bare-name lookups are guarded by fully qualified resolution. Sanitizing
  PATH does NOT close the OS lookup — Windows tries the working directory
  before PATH regardless — so every guarded `muse serve` child also sets
  `NoDefaultCurrentDirectoryInExePath` (probed on Windows 11, Node 24.20:
  `docs/certification/m21.md`), and `muse serve` itself is spawned by
  absolute path. `cwd` stays the workspace (PLAN.md D24) — that is the
  documented working directory, not a lookup path we add.

## Fix (landed, commit `42b84f88d6`)

- `src/core/executables.ts`: new `sanitizePathForWorkspace` — drops PATH
  entries that are empty, relative, or inside the workspace root (resolved
  through an injected `realpath`, falling back to lexical compare;
  separators normalised to `/` before comparing, case-insensitive on
  Windows). Kept entries stay byte-identical and in order.
- `src/core/backends/musecode/launch.ts`: `ChildEnvironmentInput` gains
  `workspaceRoot` and `realpath`; `buildChildEnvironment` guards every PATH
  spelling (all case variants on Windows) and never adds a PATH key.
- `src/host/backend/museCodeBackendManager.ts` (`childEnvironment`) and
  `src/runtime/backends.ts` (ACP/CLI override) pass the workspace root and
  `realpathSync`. The account login terminal (`accountHomes.ts:183`)
  inherits the guard through the environment it spreads; `muse login`
  (`runtime/main.ts:1347`) uses the guarded `childEnvironment()`.
- Grok review fixes (PR #249): `guardWorkspacePath` runs after the
  `museSpark.environmentVariables` loop so a person-set PATH is sanitized
  instead of replacing the guard; a PATH with nothing left is deleted, never
  stored as `""` (POSIX `execvp` searches the working directory for `""`
  but not for a missing key); guarded Windows children set
  `NoDefaultCurrentDirectoryInExePath` (sanitizing PATH alone does not stop
  CreateProcess trying the working directory first); Windows `\foo`/`/foo`
  entries are drive-relative and are compared with the workspace root's
  drive applied (dropped when the root names no drive); the "same guard
  applies" list above is corrected to what is actually guarded.
- Windows current-directory semantics: our own lookups already resolve
  fully qualified paths only; the `muse serve` spawn is by absolute path
  with `NoDefaultCurrentDirectoryInExePath` in its environment.
  `cwd` stays the workspace (PLAN.md D24).

## Fix (round 3, lane PR249FIX2, Grok re-review of PR #249)

- UNC with either slash (`src/core/executables.ts`): separators are
  normalised before classifying, so `//server/share` and `//?/C:/…` count
  as the UNC and verbatim paths they are instead of being rewritten onto
  the workspace's drive; verbatim `\\?\` (`//?/`, `\\?\UNC\`) prefixes are
  stripped and loopback admin shares (`//localhost/C$/…`,
  `//127.0.0.1/C$/…`) map to their drive path before comparing, so every
  local spelling of the workspace compares as the workspace, lexically,
  with no resolver to hide behind. A remote UNC name that cannot be proven
  local stays as it is.
- The original entry is resolved (`sanitizePathForWorkspace`): realpath
  runs on the entry as written, and the drive-applied spelling of a
  drive-relative entry is only a second comparison, never a rewrite.
- The lookups exclude the workspace (`LaunchProbe`/`ExecutableProbe` gain
  `workspaceRoot` + `realpath`; one shared `isWorkspacePath`): directories
  inside it are never probed. Wired where the workspace is known —
  `MuseCodeBackendManager.resolveLaunch` (serve, login, account host,
  skills list, init/config-status) and both git runners (each run's own
  working directory, cache keyed per PATH value and directory).
- Login and the runtime account host (`src/runtime/backends.ts`,
  `src/runtime/main.ts:1347`, `src/runtime/authCommands.ts`): the shared
  runtime manager is scoped to the launch directory, the account host
  spawns with that directory as its working directory, and `muse login`
  names it on its spawn outright.
- Windows sandbox check/setup (`src/extension.ts:1781`): runs with
  `workspaceRoot` and `backend.childEnvironment()` instead of no cwd and
  the raw environment.
- Still unguarded by design (recorded in
  `docs/certification/pathguard-spawns.md`): plugin host, MCP servers,
  browser, voice/media and the governed runners resolve their command by
  absolute path but pass the inherited PATH value through; MCP/plugin
  commands are person-configured rather than workspace-resolved.
  `processGitPath` (the M123 native route's one-shot lookup) takes no
  working directory and stays lexical.

## Fix (round 4, lane PR249FIX3, Grok re-review of PR #249)

- One comparison (`src/core/executables.ts`): `isSameOrInsideDirectory`
  now strips device (`\\.\`, `//./`) as well as verbatim prefixes, maps
  `\\.\UNC\` like `\\?\UNC\`, strips trailing spaces and dots the way
  `GetFullPathName` does (every trailing space and dot off the final
  segment; one trailing dot off a non-final segment, a longer run kept)
  and collapses `.`/`..` lexically (`..` above the root clamps),
  case-insensitive on Windows, then realpath where the path exists.
  `\\.\C:\…`, `//./C:/…`, `\\.\UNC\localhost\C$\…`, `C:\…\repo.`,
  `C:\…\repo .`, `C:\…\repo.\bin` and `C:\no-such\..\…` spellings of the
  workspace all compare as the workspace with a throwing resolver (while
  `C:\…\repo...\bin` stays a distinct name); POSIX collapses `.`/`..`
  too. Sanitize and every lookup share it.
- One lookup: `workspaceRoot` + `realpath` threaded into `gitLocator`
  (both runners, per-run cwd, `realpathSync` by default), `processGitPath`
  (its caller passes `deps.workspaceRoot`), `fixedGitLocator` (refuses a
  git inside the bound repository), `reportGitIo`, the plugin runtimes
  (`node`/`bun`/`prlimit`, via `PluginRunDeps.workspaceRoot` from the
  foreign-hooks entry), MCP bare names (`resolveServerCommand`, defaulting
  to the server directory; a command with a directory stays the file the
  config names), the shell/hook interpreters (`ToolIoDeps.workspaceRoot`
  from the window), the usage opener (governed `resolveCommand` for the
  run's workspace) and the Linux recorders (`CaptureProbe.workspaceRoot`
  from the window).
- One child environment (`workspaceChildEnvironment`): the git runners
  (lookup and `ssh`/`git-remote-helpers` alike), the plugin child, MCP
  servers, shell commands, hooks, team launches and every governed spawn
  run with the sanitised PATH for the workspace plus
  `NoDefaultCurrentDirectoryInExePath=1` on Windows.
- One gate (`test/unit/pathGuardSpawns.test.ts`): every direct
  child-process start and every raw governed launch in `src/` enumerated
  from the source itself (TypeScript AST over value imports from
  `node:child_process` and the governed launcher) and classified
  guarded-or-reviewed; an unguarded `spawn` added on purpose fails it
  (`src/core/pathguardProbe.ts`, since removed), and every anchor is
  rechecked. Delegated starts (injected runners, the governed
  `execResourceFile` boundary) are listed in
  `docs/certification/pathguard-spawns.md` with the callee that guards them.

## Proof

`test/unit/pathGuard.test.ts` (17 tests), `test/unit/executables.test.ts`
(8 tests), `test/unit/pathGuardRound4.test.ts` (16 tests) and
`test/unit/pathGuardSpawns.test.ts` (3 tests), all passing on the rig
(round 3 adds 6, round 4 adds 19):

- Pure cases: empty/relative dropped, workspace and its children dropped,
  same-prefix sibling kept, Windows case-insensitive spellings; rooted
  `\foo`/`/foo` entries resolved on the workspace drive (inside dropped,
  outside kept byte-identical), dropped when the root names no drive.
- `buildChildEnvironment` without a workspace root leaves PATH untouched,
  never adds a PATH key, and sets no `NoDefaultCurrentDirectoryInExePath`;
  with a workspace root it deletes PATH when nothing remains (never `""`),
  sanitizes a PATH arriving via `environmentVariables`, and sets
  `NoDefaultCurrentDirectoryInExePath=1` on Windows.
- `absolutePathEntries` drops drive-relative Windows entries.
- Real filesystem: a temporary workspace with `bin/<planted>` plus a
  junction resolving inside it. On the raw PATH the planted program
  resolves (the threat is real); the real `buildChildEnvironment` with
  `realpathSync` returns a child PATH of exactly the two outside entries,
  the planted program no longer resolves, and the real `node` beside the
  running process still does.
- Real processes (POSIX): the planted program runs from the raw PATH with
  the workspace as the working directory and fails with ENOENT from the
  guarded child environment; with the PATH key deleted there is no
  working-directory fallback. Windows CreateProcess behaviour is proven by
  the recorded probe (`docs/certification/m21.md`) plus the
  `NoDefaultCurrentDirectoryInExePath` assertion.
- Round 3: forward-slash UNC, verbatim and loopback admin-share spellings
  of the workspace drop lexically with a throwing resolver; the old code
  kept `//localhost/C$/…` (reproduced from the committed pre-fix file
  before landing). A real planted `git` in the workspace answers through
  the real `processGitRunner` from another directory but never with the
  workspace as the working directory, where the real git answers instead.
- Round 4: device, trailing-dot and dot-dot spellings of the workspace
  drop with a throwing resolver (unit-driven with the Windows platform
  injected); a planted `git` behind a workspace symlink never resolves
  through the real runners; planted `node`/`bash`/`arecord`/`xdg-open`
  refuse at the real plugin, MCP, shell, recorder and governed lookups.
  The inventory gate fails on a deliberately added unguarded `spawn`
  (reverted after the failure) and passes on the tree.
- Round 5: the inventory also enumerates wrapper starts and embedded
  supervisor scripts, and its anchor check fails on the playbook's bare
  `git` variable and the team probes' bare names before the fix (shown on
  the lane) and passes after. `repo .` drops and `repo...\bin` stays with
  a throwing resolver; the admitted playbook command is the real git
  outside a workspace whose `bin` holds a planted `git` first on PATH
  (nothing spawns: the admission refuses); an in-workspace `SHELL` is
  ignored while an outside one still answers (lookup verdicts, real
  filesystem, no spawns). `docs/certification/pathguard-spawns.md` lists
  every product-chosen name the grep hunt found and its guard.

Gates on the lane branch (final tree, repository's own timeout throughout,
never `--testTimeout`):

- eslint zero warnings on all changed files (exit 0); prettier clean.
- `test/unit/pathGuard.test.ts` + `test/unit/executables.test.ts`: 19/19 pass.
- `npx vitest related --run` over the changed src files: 10 files
  passed, 7 skipped (pre-existing suite skips); 131 tests passed,
  55 skipped.
- `npm run typecheck` (all five projects): exit 0.
- `node scripts/check-l10n.mjs`: 0 problems (no new user-visible strings).
- `node scripts/check-plan.mjs`: 0 drift.
- `npm run build`: exit 0 (bundle-size and split gates included).

Round-4 gates (lane PR249FIX3, same timeout rule):

- `test/unit/pathGuard.test.ts` + `test/unit/executables.test.ts` +
  `test/unit/pathGuardRound4.test.ts`: 41/41 pass.
- `test/unit/pathGuardSpawns.test.ts`: 3/3 pass; fails on a deliberately
  added unguarded `spawn` (reverted), passes on the tree.
- Related suites: `helperLocation`, `nativeGitCore`, `mcpServers` (47
  pass); `foreignHooks`, `pluginDispatch`, `heldCheckoutCore` (56 pass,
  3 pre-existing skips).
- `npm run typecheck` (all five projects): exit 0.
- eslint zero errors on all changed files; prettier clean.
- `node scripts/check-l10n.mjs`: 0 problems; `node scripts/check-plan.mjs`:
  0 drift; `knip`: exit 0; `node scripts/cycles.mjs`: no cycles;
  `jscpd`: 0 clones (two introduced mid-lane fixed at the cause);
  `npm run build`: exit 0 with budgets unchanged.

## Fix (round 6, lane PR249FIX5, Grok re-review of PR #249)

Forgetting the guard is a type error, so the next forgotten call site is
found by the compiler, not the reviewer:

- `src/core/executables.ts`: `ExecutableProbe` takes a required
  `scope: ExecutableScope` — a workspace root with its link resolver, or
  the explicit `NO_WORKSPACE` sentinel (absolute entries only, links
  followed) for a capability probe before any folder is known. No
  optional `workspaceRoot`, no default resolver. `WorkspaceChild`
  requires `realpath`; `workspaceChildEnvironment` and the new
  `noWorkspaceChildEnvironment` return the branded `GuardedChildEnv`
  only they can produce. `RunProgram`, `runTreeSync` (which also
  requires `cwd`) and the plugin spawn take it, so a raw `process.env`
  does not type-check there. `withoutCredentials` and
  `resourceEnvironment` preserve the brand.
- Every wrapper follows: `gitLocator`/`processGitPath`, the shell/hook
  interpreters and environments (the explicit no-workspace scope where
  no folder is open), `resolveServerCommand`, the `muse` launch probe
  and child environment, the plugin `PluginRunDeps`, the capture probe,
  and the report/schedule/sharing callers of the governed boundary.
- Cause fixes through those types: the team probe never searches PATH
  (fixed `/usr/bin/setpriv` + `/usr/bin/systemd-run` with an absolute
  `/bin/true` under the no-workspace env; the launch still re-resolves
  outside its own directory, links followed); the report's `gh` probe
  carries the report workspace and `resolveCommand` refuses an absolute
  path inside it like a bare name there (the schedule git reader and
  the sharing adapters thread their workspace the same way);
  `foreignHooksEntry.ts` passes `realpathSync` into the production
  `PluginSession`; playbook effects sanitize the effect's cwd (a linked
  worktree outside the main checkout) as well as the main workspace;
  the Linux recorder child gets the guarded environment and cwd.
- `test/unit/pathGuardRound6.test.ts` drives each cause fix against
  real plantings on a temporary workspace (absolute refusal at the
  governed boundary — seen to fail with the check broken — `gh`
  resolved outside the workspace with the root threaded to the exec,
  the linked-worktree double sanitize through the real
  `PlaybookOutcomes`, and a real team driver start that never executes
  a planted `setpriv`/`true`; the recorder lookup refusal stays proven
  by round 4's `arecord` test). The inventory scans
  `execResourceFile`/`handoffResourceFile` and one-level aliases and
  pins the branded signatures.

## Proof (round 6)

`test/unit/pathGuardRound6.test.ts` (4 tests), the updated
`test/unit/pathGuard.test.ts` (17), `test/unit/executables.test.ts`
(9), `test/unit/pathGuardRound4.test.ts` (19) and the extended
`test/unit/pathGuardSpawns.test.ts` (6 tests: inventory, aliases,
governed calls, type pins), all passing on the rig (round 6 adds 4 +
the inventory pins):

- The no-workspace scope drops relative/empty entries and still sets
  `NoDefaultCurrentDirectoryInExePath` on Windows; `absolutePathEntries`
  follows links for the workspace comparison.
- A planted absolute `gh` is refused before any spawn; a real outside
  `gh` answers with the workspace threaded through.
- The linked worktree's child PATH excludes both checkouts; the team
  probe runs fixed tools only and leaves planted markers untouched.
- The refusal test fails with the check broken (reverted) and passes
  with it; the inventory fails on an unlisted governed call and on a
  loosened branded signature.

Round-6 gates (lane PR249FIX5, repository's own timeout throughout,
never `--testTimeout`):

- `test/unit/pathGuardRound6.test.ts`: 4/4 pass.
- Guard + inventory suites: `pathGuard` + `executables` +
  `pathGuardRound4` (45 pass); `pathGuardSpawns` (6 pass);
  `helperLocation` + `nativeGitCore` (41 pass).
- Related suites of every touched file: `foreignHooks`,
  `pluginDispatch` (with real children), `sandbox`, `playbookSurface`,
  `schedules`, `mcpServers`, `reportProblem`, `supportReport`,
  `diagnosticsReport`, `hookFormats`, `shellSyntax`, `teamResources`,
  `gitState`, `gitText`, `nativeProcessDefaults`,
  `credentialFile`, `sharingArtifacts`, `runnerHelperNative`,
  `scheduleRegistration`, `resourcesContracts`, `githubRemote`: all
  pass.
- `npm run typecheck` (all five projects): exit 0.
- eslint zero warnings; prettier clean; `node scripts/check-l10n.mjs`:
  0 problems; `node scripts/check-plan.mjs`: 0 drift;
  `node scripts/check-host-api.mjs`: exit 0; `knip`: exit 0;
  `node scripts/cycles.mjs`: no cycles; `jscpd`: 0 clones;
  `npm run build`: exit 0 with budgets unchanged.

## Fix (round 7, lane PR249FIX6, Grok re-review of PR #249)

Round 6 branded `runProgram` / `runTreeSync` / plugin spawn, but the
Windows team payload environment is a `string[]` the compiler does not
see: `windowsTeamDriver` sanitized only the PowerShell helper while
`CreateProcessW` received the raw `request.env`, so a team worker whose
cwd is the workspace searched the workspace first for a bare
`request.command` and kept absolute workspace `PATH` entries for the
helpers it starts by bare name. The spawn inventory stayed green
because the guard name still appeared in the file (on the helper).

- `src/host/team/processLifetime.ts`: `windowsTeamPayloadEnvironment`
  builds the `RunTeam` block from
  `workspaceChildEnvironment('win32', request.env, ...)` — the same
  object the POSIX launch uses — dropping workspace/`PATH` entries and
  setting `NoDefaultCurrentDirectoryInExePath=1` on the payload. That
  block is what helpers the payload starts by bare name search; the
  `RunTeam` executable itself is resolved outside the workspace first
  (`resolveWindowsTeamCommand`: a bare name on the absolute `PATH`
  entries, PATHEXT included, a `.cmd`/`.bat` hit through the absolute
  `cmd.exe`, fail closed inside the workspace), because `CreateProcessW`
  completes a partial `lpApplicationName` from the helper's working
  directory without a PATH search.
- The class, not the instance: direct `child_process` calls move behind
  one guarded wrapper (`src/core/guardedChildProcess.ts`:
  `spawnGuarded`/`execFileGuarded` take only the branded
  `GuardedChildEnv`), and a native helper payload serializes only from
  the brand (`guardedEnvironmentBlock`, `McpJobLaunch.env`). The
  serve/login builder (`buildChildEnvironment`) returns the brand
  through the same producers; `ResourceProcessOptions`,
  `ResourceTreeRun`, the git/checkout/macos ports and the login and
  schedule launch options all require it — the compiler lists every
  site (29 errors across 14 files on the first typecheck, each fixed
  at its cause).
- Two spelling games closed in the producers themselves: on Windows
  every `PATH` casing is guarded (a second raw spelling no longer
  survives the first sanitizing empty), and a preset
  `NoDefaultCurrentDirectoryInExePath=0` is dropped before the
  canonical `1` is set.
- `test/unit/pathGuardRound7.test.ts` drives the real payload builder
  against a workspace planting (seen to fail with the builder
  reverted: the planting and the missing guard variable fail, the
  pass-through assertions still pass). The inventory now lists only
  the two sanctioned direct starters (the wrapper and the tree
  helpers), fails on any direct starter anywhere else (proven with a
  planted raw `spawn`), and fails on any second cast to the brand
  (proven with a planted `as GuardedChildEnv`).

## Proof (round 7)

`test/unit/pathGuardRound7.test.ts` (6 tests) and the extended
`test/unit/pathGuardSpawns.test.ts` (7 tests), plus the guard suites
`pathGuard` (17), `pathGuardRound4` (19), `pathGuardRound6` (4) and
`executables` (9), all passing on the rig with the repository's own
timeout (never `--testTimeout`):

- The payload block keeps the system directory, drops the workspace
  planting with every casing, empty and relative entries, sets
  `NoDefaultCurrentDirectoryInExePath=1`, and passes other variables
  through while dropping `undefined` ones.
- The planted-`spawn` break fails the inventory with the file and
  line; the planted-cast break fails the brand pin; both probes
  removed after.
- Related suites of every touched file pass: `treesLifecycleNative`,
  `fileLease`, `nativeProcessDefaults`, `teamGitClassifier`,
  `teamRefFence`, `sandbox`, `nativeGitCore`, `browserLaunch`,
  `runtimePullRequestRecords`, `evalTasks`, `pluginDispatch`,
  `heldTree`, `scheduleRegistration`, `mcpServers`, `handoff`,
  `heldCheckoutCore`, `reservationLock`, `foreignHooks`, `worktrees`,
  `supportReport`, `checkCommands`, `bestOfN`, `schedules`,
  `importConvert`, `mediaContracts`. `inspectNative` fails 18
  identically on the untouched base (the native confine helper
  refuses on the rig) — measured, not assumed.
- `npm run typecheck` (all five projects): exit 0. eslint zero
  warnings (full `lint:js`); prettier clean; `check:l10n`:
  0 problems; `check:plan`: 0 drift; `check:host-api`: refreshed
  (`node:child_process` 29→22, `node:fs` 88→97, `node:util` 10→9)
  then exit 0; `knip`: only pre-existing hints; `cycles.mjs`:
  no cycles; `jscpd`: 0 clones (a shared producer-entries helper
  plus the recorder test on the guarded starter; measured 2 clones
  against 0 at base first); `npm run build`: exit 0 with budgets
  unchanged; `security:sast` and `security:audit` as recorded on the
  lane. (`check:reference` crashes identically on the untouched
  base — pre-existing, unrelated: no command, setting or feature
  changes in this lane.)

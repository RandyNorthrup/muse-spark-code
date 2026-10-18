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

## Proof

`test/unit/pathGuard.test.ts` (14 tests) and `test/unit/executables.test.ts`
(5 tests), all passing on the rig:

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

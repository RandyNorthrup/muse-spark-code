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

Other external programs started in a workspace (same guard applies):

9. `src/core/backends/modelapi/pluginHost.ts:139,615` — plugin host
   processes (`resourceEnvironment(env, resource)`).
10. `src/core/backends/modelapi/mcp/pool.ts:289` — MCP server processes.
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
  (`executables.ts:42`) only probe absolute PATH entries, so _our_
  lookup of `muse`/`git` never resolves a workspace planting. The hole
  is only the PATH value the child itself inherits.
- Windows current-directory semantics (`executables.ts:1-9`): our own
  bare-name lookups are guarded by absolute resolution; the CLI's own
  lookups are guarded by sanitizing its PATH (below). `cwd` stays the
  workspace (PLAN.md D24) — that is the documented working directory,
  not a lookup path we add.

## Fix (to land below)

Every child environment built for `muse serve` — and for any other
external program started in a workspace — drops PATH entries that are
relative, empty, or inside the workspace (resolved through links, as
`src/core/legal/workspace.ts` does with `realpathSync`), on Windows,
macOS and Linux alike. Nothing else in PATH changes. Proven by driving
the real environment builder with a real temporary workspace and a real
planted program: the planted program is not reachable from the child's
PATH; a real system program still is.

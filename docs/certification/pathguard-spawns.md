# PATHGUARD spawn inventory — every program start and its guard (2026-10-18, lane PR249FIX3)

One comparison (`isSameOrInsideDirectory` in `src/core/executables.ts`:
device/verbatim prefixes stripped, `.\UNC\` mapped like `?\UNC\`,
loopback admin shares mapped to their drive, trailing dots stripped per
segment, `.`/`..` collapsed, case-insensitive on Windows, then realpath
where the path exists), one lookup (every product name resolved outside
the workspace, links followed), one child environment
(`workspaceChildEnvironment`: PATH sanitised, empty/relative/
drive-relative/workspace entries dropped, `NoDefaultCurrentDirectoryInExePath=1`
on Windows). `test/unit/pathGuardSpawns.test.ts` enumerates every direct
child-process start in `src/` from the source itself (TypeScript AST: bare
calls and references of names value-imported from `node:child_process`,
including `require`) and fails on any file outside the lists below, on any
listed file that loses its anchor, and on any `exec`/`execSync` import
(shell strings stay banned, D4).

## Guarded in the file (lookup + child env)

- Plugin host (`src/core/backends/modelapi/pluginHost.ts`): `node`/`bun`/
  `prlimit` resolved outside `deps.workspaceRoot` (from
  `foreignHooksEntry.ts`, which passes its own workspace root); the child
  runs the absolute runtime with the guarded child env for the workspace.
- Git (`src/host/git.ts`, both runners): each run's working directory is
  the workspace, resolved through `realpathSync`; the child env is the
  guarded child env, so git's own helpers (`ssh`, `git-remote-https`) never
  run a planting. M123 native route (`fixedGitLocator` in
  `src/runtime/panel/git/service.ts`): refuses a git inside the bound
  repository; `createGitProcess` carries `realpathSync`. Report source
  (`reportGitIo` in `src/runtime/reporting/sources.ts`): lookup + env
  guarded for the report root.
- MCP (`src/host/backend/mcpProcess.ts`): bare names resolved outside the
  server's working directory (links followed); a command with a directory
  stays the file the person's config names. The child env is the guarded
  child env for that directory.
- Shell and hooks (`src/host/backend/toolIo.ts`): `bash`/`sh`/`cmd`/
  PowerShell resolved outside the workspace (`ToolIoDeps.workspaceRoot`,
  from the window's workspace); `shellEnvironment` and `hookEnvironment`
  carry the guarded child env for the run's directory, and `hookEnvironment`
  additionally drops Windows drive-relative entries.
- Team launches (`src/host/team/processLifetime.ts`): the person's
  configured command keeps running, with the guarded child env for its cwd
  (bare launchers and helpers can no longer shadow from the workspace);
  Windows runs absolute PowerShell with the same guarded env.
- Governed commands (`src/core/resources/commands.ts`, serving
  `handoffResourceFile`/`execResourceFile`): bare names (`xdg-open`,
  `open`, `rundll32.exe`, probes) resolved outside the run's workspace with
  the guarded child env. This covers the usage opener (`src/runtime/main.ts`
  passes its cwd), schedules, reporting and vault callers.
- `muse serve` family (`MuseCodeHost.ts` via
  `museCodeBackendManager.ts:279`): absolute launch command from
  `resolveLaunch` (workspace excluded) + guarded builder env.
- Voice recorder lookup (`locateCaptureHelper` in
  `src/core/voice/helperLocation.ts`, wired in `dictationHost.ts` and
  `src/extension.ts`): `arecord`/`parec` resolved outside the workspace.

## Reviewed: fixed path or the person's own terminal (no PATH search)

- `src/host/processTree.ts`: fixed `/bin/ps`, `process.execPath`
  supervisor; `runProgram` callers pass absolute system paths (the
  `systemctl` probes run with the host cwd, never a workspace cwd).
- `src/core/resources/trees/linuxLaunch.ts`: fixed `/usr/bin/systemd-run`,
  `/bin/sh`.
- `src/core/resources/trees/run.ts`: callers pass absolute OS/native-helper
  paths (governor entry, macOS/Windows actuators).
- `src/core/resources/process.ts`: the one governed launch; file + env come
  only from `commands.ts` above.
- `src/host/backend/mcpJobLaunch.ts`: the digest-named packaged job
  launcher only, never PATH-resolved.
- `src/host/browser/browserProcess.ts`: the pinned runtime verified against
  `browserRuntime.json` + SystemRoot `taskkill`.
- `src/host/resources/resourceJobHolder.ts`: absolute SystemRoot
  PowerShell + packaged job assembly.
- `src/core/locks/processOwner.ts`: fixed `/bin/ps`, SystemRoot
  PowerShell; darwin inherits env but runs an absolute command with no shell.
- `src/core/resources/sampler/system.ts`: absolute paths only, near-empty env.
- `src/core/eval/workspace.ts`: fixed `process.execPath`, empty env.
- `src/core/team/workers/workerFence.ts`: fixed `/usr/sbin/lsof`, scrubbed env.
- `src/host/voice/voiceProcesses.ts`: absolute helper/recorder command from
  the guarded lookup, no shell.
- `src/core/media/record/macos.ts`: absolute `/usr/bin/codesign` and helper
  paths only.
- `src/runtime/panel/pullRequests/checkout.ts`: thin wrapper, the caller
  hands the absolute git only.
- macOS keychain lookup (`src/extension.ts:4617`, via the governed runner):
  absolute `MACOS_SECURITY_TOOL` (`/usr/bin/security`), lookup args only.
- Terminal launches (`runCliInTerminal`, `openInTerminal`): the person's
  interactive terminal, intentional.

## Delegated (no direct start; the guard lives in the callee)

- `src/host/git/untrustedGit.ts`, `src/runtime/panel/git/service.ts`
  (runner wiring), `src/host/backend/mcpServers.ts` /
  `src/host/backend/mcpVault.ts`, `src/core/team/workers/engineWorker.ts`,
  `src/host/team/acpProcess.ts`, `src/core/voice/dictation.ts`,
  `src/core/schedules/events/git.ts`, `src/core/reporting/history.ts`,
  `src/core/reporting/sources/github.ts`: injected runners, the guarded
  spawners above, or the governed `execResourceFile` boundary.

# PATHGUARD spawn inventory — every program start and its guard (2026-10-18, lane PR249FIX4)

One comparison (`isSameOrInsideDirectory` in `src/core/executables.ts`:
device/verbatim prefixes stripped, `.\UNC\` mapped like `?\UNC\`,
loopback admin shares mapped to their drive, trailing spaces and dots
stripped the way `GetFullPathName` strips them (every trailing space and
dot off the final segment, so `repo .` is `repo`; one trailing dot off a
non-final segment, so `repo.\bin` is `repo\bin` while `repo...\bin` stays
a distinct name), `.`/`..` collapsed, case-insensitive on Windows, then
realpath where the path exists), one lookup (every product name resolved
outside the workspace, links followed), one child environment
(`workspaceChildEnvironment`: PATH sanitised, empty/relative/
drive-relative/workspace entries dropped, `NoDefaultCurrentDirectoryInExePath=1`
on Windows). `test/unit/pathGuardSpawns.test.ts` enumerates every direct
child-process start in `src/` from the source itself (TypeScript AST: bare
calls and references of names value-imported from `node:child_process`,
including `require`), every wrapper that ends in one (`runProgram`,
`runTreeSync`, `runResourceCommand`, literal or variable command alike),
every embedded supervisor script (a backtick literal spawning a process,
where the playbook's `git` variable used to hide), and every raw governed
launch, and fails on any file outside the lists below, on any listed file
that loses its anchor, and on any `exec`/`execSync` import (shell strings
stay banned, D4).

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
  from the window's workspace, the ACP agent's workspace, and the setup
  hooks' working directory); an absolute `SHELL` inside the workspace is
  ignored and `sh` resolves outside instead; `shellEnvironment` and
  `hookEnvironment` carry the guarded child env for the run's directory,
  and `hookEnvironment` additionally drops Windows drive-relative entries.
- Team launches and probes (`src/host/team/processLifetime.ts`): the
  person's configured command keeps running, with the guarded child env
  for its cwd; `setpriv`/`systemd-run`/`systemctl` probe on the absolute
  PATH entries only and resolve outside each launch's own working directory
  (links followed), with the guarded child env for the scope queries — a
  tool the probe saw but the launch directory shadows fails the launch
  closed. Windows runs absolute PowerShell with the same guarded env.
- Playbook git (`src/core/orchestration/playbook/outcomes.ts`,
  `modules.ts`): every effect's command is `processGitPath(workspace)`
  (links followed), admitted and spawned absolute, with the guarded child
  env for the workspace, so the POSIX supervisor's `spec.command` is never
  a bare name either.
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
  supervisor; the supervisor template itself is parsed by the
  embedded-script check and spawns only its caller's `spec.command`
  (every `runTreeSync` caller resolves that command outside the
  workspace); `runProgram` callers pass absolute or launch-resolved
  system paths.
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
- `src/core/media/record/macos.ts`: an injected `spawn` port; the commands
  are fixed `/usr/bin/codesign` and a helper path that must be absolute and
  trust-verified before it runs.
- `src/runtime/panel/pullRequests/checkout.ts`: injected `spawn`/`execFile`
  ports; the caller hands the absolute git only.

## Round-5 hunt: every product-chosen name (lane PR249FIX4)

Grep over every command position in `src/` (direct starts, wrapper first
arguments literal or variable, injected-port arguments, `Worker` paths):
no name below is looked up on a workspace-searchable PATH, and no child
with a workspace working directory inherits a raw PATH.

- Fixed OS paths, never PATH-resolved: `/bin/ps` (locks, `trees/mac`,
  the supervisor's table), `/bin/sh` (Linux launcher, team launch
  leader), `/usr/bin/systemd-run` + `/bin/sh` (`trees/linuxLaunch`),
  `/usr/bin/python3` (team signal helper, darwin orphan observer),
  `/usr/bin/security` (macOS keychain, governed), `/usr/bin/codesign`
  (macOS recording probe), `/usr/sbin/lsof` (worker fence), `/bin/ls`
  (token ACL receipt), `process.execPath` (eval verifier, supervisor
  host), `nvidia-smi`/`powershell` at fixed absolute candidates only
  (the sampler refuses a non-absolute file with a near-empty env).
- SystemRoot-joined, never PATH-resolved: PowerShell/`cmd.exe`/`taskkill`
  (sampler, lock owner, Windows team driver, token ACLs, browser kills,
  resource holders and sweepers).
- Packaged natives by absolute path: the created-registry helpers
  (`__dirname`-joined per platform), the dictate helper, the digest-named
  job launcher (`mcpJobLaunch`), the search/page/image workers (bundled
  `dist/` paths — threads, not PATH lookups).
- Guarded-resolved outside the run directory, guarded child env: `git`
  (both runners, the M123 native route, the report source, the playbook),
  `node`/`bun`/`prlimit` (plugin host), MCP server commands (bare names
  outside the server directory), `bash`/`sh`/`cmd` (shell and hook
  interpreters on every backend), `arecord`/`parec` (voice), `xdg-open`/
  `open`/`rundll32.exe` (governed commands), `setpriv`/`systemd-run`/
  `systemctl` (team launch, per launch directory).
- The person's own, intentionally: the team worker's configured command
  (guarded env for its cwd), interactive terminal launches, a `SHELL`
  outside the workspace (hooks), an absolute `COMSPEC` (hook env).
- No `shell: true` in `src/`; no `exec`/`execSync` import (gate-enforced);
  `openExternal` takes URIs, never programs.
- Stated boundary: the team capability probes run at driver creation,
  before any launch directory is known, so they resolve on the absolute
  PATH entries only; every later use (launch chain, scope queries)
  additionally excludes the launch's own working directory, and a tool
  the probe saw but that directory shadows fails the launch closed.

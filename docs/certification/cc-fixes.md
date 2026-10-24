# cc/fixes — three defects on int/recovery (2026-10-24)

Worktree `mx-cc-fixes`, branch `cc/fixes`. The worktree was made at
int/recovery `fcbd0e3f1f`; int had moved on to `de0c671a28` (cc/gates'
`spawnResourceFile`, cc/rlm116's playbook landing, cc/rlm104), which items
2 and 3 need, so `cc/fixes` was fast-forwarded to `de0c671a28` before the
first commit (no rebase, no merge commit). Model attempts: **0**. Provider
calls: **0**. Every run below is on this PC (Windows 11 Pro 10.0.26200,
Windows PowerShell 5.1.26100.9711, PowerShell 7.6.6, Git Bash 5.2.37, WSL
Arch bash 5.3.20), vitest with `TMP`/`TEMP` in the worktree's `temp/`.

## Item 1 — the shell trailer reported every PowerShell failure as exit 0

The Model API shell tool wraps the model's command with
`shellDirectoryTrailer` (`src/core/backends/modelapi/tools.ts`, M91 lane S,
D70) so the session keeps its directory. On Windows the trailer began
`; $__m91code=$LASTEXITCODE; $__m91ok=$?; …`: the assignment before it set
`$?` to true, so `$__m91ok` was always true and the trailer always ran
`exit 0`. A failing native command and a failing cmdlet both reached the
model as `exit code 0`.

Root cause, probed in both PowerShells (`-NoProfile -NonInteractive
-Command`): `cmd /c exit 3; $c=$LASTEXITCODE; "$?"` prints `True`;
`cmd /c exit 3; "$?"` prints `False`, in Windows PowerShell 5.1.26100.9711
and in PowerShell 7.6.6 alike.

Fix: the trailer's first statement reads `$?` (`$__m91ok=$?`), then
`$LASTEXITCODE`, which no assignment changes. The rest is unchanged: a
success stays 0, a native failure keeps its code, anything else fails as
1, and the side file still gets the sequence and directory.

bash (and zsh): the POSIX trailer already reads `$?` first
(`; __m91status=$?; …`). Probed through the trailer's text with
`--noprofile --norc -c` in Git Bash 5.2.37 and in WSL Arch's bash 5.3.20:
`sh -c 'exit 3'` exits 3, `false` exits 1, `echo ok` exits 0, and the
report carries sequence and directory; `false; x=1; echo $?` prints `0`,
so the order matters there too and is right. The product's tool shell is
bash on every POSIX host (`shellInterpreter` resolves `bash`); zsh is not
installed on this PC or in its WSL distribution, so zsh was not probed.
Its `$?` rule for assignments is the same as bash's, and the trailer's
first statement reads it before any assignment.

Proof `test/unit/shellDirectoryTrailer.test.ts` (8 tests on Windows): the
real trailer behind a real command, through the product's own shell (the
shell tool's real `ToolIo.runShell`: Windows PowerShell 5.1 on Windows,
bash elsewhere) and, on Windows, through PowerShell 7 with the product's
own `shellArguments`. Cases: `cmd /c exit 3` exits 3; `Get-Item` on a
missing path exits 1; `cmd /c exit 3; Write-Output ok` exits 0; a success
exits 0; each also reads the side file back through
`parseShellDirectoryReport` (sequence and directory). On POSIX the same
suite runs `sh -c 'exit 3'` (3), `false` (1) and `echo ok` (0) through
bash.

Red and green (this PC):

- Before the fix (base `fcbd0e3f1f`): 4 failed, 4 passed, exit 1. Both
  PowerShells: `a failing native command keeps its own code` expected 3,
  received 0; `a failing cmdlet fails as 1` expected 1, received 0.
- After the fix: 8 passed, exit 0 (on `fcbd0e3f1f` and again on
  `de0c671a28`).
- Drill on `de0c671a28`: the two statements swapped back → the same 4
  failed (`expected +0 to be 3`, `expected +0 to be 1`), exit 1; restored
  → 8 passed, exit 0, the source line byte-identical to the fix.

## Item 2 — seven process starts routed through the governed launch

`pathGuardSpawns` (`every direct process start is guarded or reviewed`)
listed seven direct `node:child_process` starts from RLM110A0/RLM110B on
`de0c671a28`, failing 1 of 7 cases:
`src/runtime/node/gitRunner.ts` (execFile:106),
`src/runtime/node/tls/certificate.ts` (execFile:177),
`src/runtime/node/toolHost.ts` (spawn:264),
`src/runtime/node/workspaces/devcontainer.ts` (execFile:347, 483),
`src/runtime/node/workspaces/git.ts` (execFile:372),
`src/runtime/node/workspaces/snapshots.ts` (execFile:191),
`src/runtime/tui/design/capabilities.ts` (execFile:97).

Each now starts through the governed command boundary
(`src/core/resources/commands.ts`, through the lazy `launcher.ts`), as
cc/gates routed RLM125's two starts (`d5cc1f71ac`): the command resolves
outside the folder the child runs in (a program inside it is refused),
the child gets the guarded environment, admitted and contained. A read
is a `probe`; anything that writes runs `contained`.

- `gitRunner.ts`: `execResourceFile` with the service's own env,
  deadline and output bound; `workspaceRoot` is the repository's work
  tree (git runs in the private snapshot). Branch listings, diffs and
  `rev-parse` are probes; status, stage, commit, branch, push, fetch
  and merge are contained. Every failure stays `unavailable`, now with
  its cause.
- `tls/certificate.ts`: OpenSSL `contained`, `env: {}`, same deadline
  and bound. `scripts/lib/buildNodeAuth.mjs` gains the
  `sharedResourceAdmission` plugin, so `dist/nodeAuth.js` uses the
  process's one admission (`./resourceAdmission.js`) instead of an
  inlined copy. Drill: without the plugin the build refuses
  `dist/nodeAuth.js exceeds 500 KiB: 690.5 KiB` (the governed launcher
  inlined, with its own unconfigured admission); with it, 498.8 KiB, the
  same as base.
- `toolHost.ts`: `spawnResourceFile('contained', …)`, guarded against
  the workspace volume; stdin ends at once (it was `ignore`). A cancel
  while admission waits ends the run as cancelled; once started, the
  run's own SIGTERM-then-SIGKILL group stop is unchanged.
- `workspaces/spawn.ts`: `runWorkspaceProcess`, the git and devcontainer
  runners' one call into `execResourceFile`; exits still resolve with
  their code and output, a run that never exited rejects with the
  caller's typed error and its cause. `git.ts` (log, diff, show,
  rev-parse, ls-files probes; the rest contained) and `devcontainer.ts`
  (`--version` and `read-configuration` probes, `up` and `exec`
  contained) use it.
- `snapshots.ts`: tar, btrfs and zfs (listings and the subvolume check
  probes, writes contained); a tool the boundary refuses rejects coded
  `unavailable`, so the btrfs/zfs paths still fall back to the bundle on
  a coded failure.
- `tui/design/capabilities.ts`: tput and `defaults` as governed probes;
  a missing tool, its failure or deadline, or the governor's refusal is
  still "no answer".
- `launch.ts` names the boundary's two failure words
  (`GOVERNED_COMMAND_UNAVAILABLE`, `GOVERNED_COMMAND_FAILED`, now used by
  commands.ts) with guards (`isGovernedCommandUnavailable`,
  `isGovernedCommandFailure`, `isGovernedCommandExit`), so callers read
  them by guard, not text.
- `pathGuardSpawns` records the eight guarded callers with anchors, and
  tracks `runWorkspaceProcess` as a wrapper so its callers are
  inventoried too.

What changed beyond the start itself, by design of the governed launch:
admission and containment (a contained root's exit stops the rest of
its tree; a contained run's TMPDIR/TEMP/TMP point at its governed
temporary root); a caller's deadline now also covers admission; the
default output bound is the boundary's (1 MiB, execFile's default size)
counted over both streams together; and a program named by a path
inside the workspace is refused instead of run. These callers run
inside the runtime process (`main.ts` configures admission before the
`node` command), or are not yet wired (the workspace runners, the TUI
probe).

Tests: the suites that start these processes are admitted by the real
governor, configured as the runtime configures it
(`test/unit/helpers/resources/runtimeGovernor.ts`, extracted from
`execTeamSweep.test.ts`, which now uses it): `nodeGitRunner`,
`nodeToolHost`, `nodeCertificate`, `tuiDesign`,
`nodeWorkspaceDevcontainer`'s red paths, the new governed cases in
`nodeWorkspaceGit`, and the opt-in live drill. New cases:

- `nodeWorkspaceGit` (every OS): the real git through the governed
  launch keeps its exit codes (rev-parse 0, `diff --quiet` 1 accepted,
  a missing ref 128 as `GitFailedError`); a program planted in the
  workspace as git (a copy of `whoami.exe` / `/bin/echo`) is refused by
  path, and a bare `git` with the workspace first on PATH and as the
  working folder resolves past it to the real git.
- `nodeToolHost` (POSIX): a program planted inside a workspace is
  refused, never run.
- `tuiDesign` (POSIX): `TERM=vt100` reads `plain`, which only the real
  tput's answer (-1) gives; a silent probe falls back to `sixteen`.

Red and green (this PC):

- Base `de0c671a28`: `pathGuardSpawns` 1 failed (the seven sites),
  exit 1. Final tree: 7 passed, exit 0.
- Drill: `capabilities.ts` back to its direct `execFile` → 3 failed
  (`capabilities.ts: execFile:97` unguarded; its wrapper entry with no
  start left; its anchor gone), exit 1; restored → 7 passed, exit 0.
- Drill: `workspaces/git.ts` and `spawn.ts` back to base → the planted
  program case failed ("git rev-parse exited 1": the plant ran, a
  `GitFailedError`), exit 1, while the exit-code case passed on base
  too (identical results). With only the bare-name half kept, base
  failed the same way (the plant ran from the working folder). Restored
  → both pass, exit 0.
- `nodeWorkspaceDevcontainer` red paths (node as a wrong CLI: version
  skew, no JSON, a failing exec exit) pass through the governed launch.
  The same file's 4 path-semantics cases and `nodeTerminalPage`'s 6
  cases fail on this Windows PC on base and on the final tree alike
  (10 failed, 24 passed both times).
- The live drill (`MUSE_NODE_DRILL=1`, git and snapshots) cannot pass on
  this PC on base or after: Git for Windows' GNU `tar` reads `C:` as a
  remote host, and `core.autocrlf` adds `\r`. Both runs stop at the same
  `tar -czf` step with the same message; the clone, bundle, diff and
  status before it ran through the governed launch.

Not run on this PC: the POSIX and Linux receipts (`nodeGitRunner`'s
Linux cases, `nodeToolHost`'s and `nodeCertificate`'s native cases,
the vt100 probe). They need a POSIX filesystem with owner-only modes;
this worktree is on NTFS, and WSL's `/mnt/c` (9p, no metadata) cannot
hold them, while temp files stay in the worktree. Hosted CI's Linux and
macOS jobs run them.

## Item 3 — `playbookConversation.test.ts` (MSM116): fakes found, not rewritten here

`test/unit/playbookConversation.test.ts` (1,239 lines, 43 cases, from
MSM116 `9244225a4e` through cc/rlm116) drives
`createPlaybookConversation` (`src/host/playbook/playbookConversation.ts`)
over hand-built ports. Each one stands in for our own code or the editor
API; none is an outside boundary that is not ours:

- `window: PlaybookWindow`: an object literal with `keepCalls` stubs for
  `standing`, `openReview`, `dispatch`, `answer`, `recordDesign`,
  `subscribe` and the review ticket. It stands in for
  `createPlaybookWindow` (`playbookWindow.ts`), its worker
  (`playbookWorker.ts`), the policy and the journal. The cases assert
  the calls the stub saw, not what the real window did.
- `ui: PlaybookUi`: scripted `showQuickPick`/`showInputBox`. In
  production this is `vscode.window` (`playbookEntry.ts` passes
  `deps.ui`): a stand-in for the editor API.
- `host.backend()`: scripted `readSession`/`readSessionOutput`. These
  stand in for our `AgentHost` (the Model API or Muse Code backend), with
  hand-written child items and patch pages.
- The review request's `submit`/`listen` and `host.notice` are the
  conversation controller's own.

Roughly 17 cases touch only the window (dispatch admission and refusal,
round ends, best-of-N, Muse Code rows, conversation end). Those can be
rewritten on the real window, worker, journal and git repository, as
`teamPlaybookRounds.test.ts` and `playbookWindow.test.ts` do (the
`thread()` boundary, `panelRepository`, the compiled job assembly on
Windows). About 16 need a child session's own items and stored patch
from a real backend. Only a real model turn makes a real child session,
so in a unit test a stand-in is the only way to feed them. About 10 run
the notice's button through VS Code's pickers, which exist only in a
real VS Code (no suite here answers a picker programmatically). By the
2026-10-17 rule, those two groups leave the unit suite. Their behaviours
go to `docs/real-life/unproven.md`, and are proved by the packed
product's real-life run, or by an integration suite that can drive the
quick-input UI.

Not done in this lane, for one reason: a correct rewrite means deleting
about 26 of the 43 cases (the backend and picker groups). Coverage and
the unproven record are the lead's decision, so this lane does not make
it. Each remaining case is also a governed round on the real worker
(`GOVERNED_ROUND_TIMEOUT_MS` notes up to 15 s a round on Windows), which
needs a lane of its own. The suite is unchanged.

## Gates (final tree `900fabd867`, Windows 11)

`prettier --check .` 0 · `npm run lint:js` 0 · `npm run typecheck` (all
six projects) 0 · `pathGuardSpawns` 7 passed, exit 0 (base: 1 failed) ·
`check:catches` 0 (base 0: no SWALLOW or GENERIC rise) · `deadcode` 0 ·
duplication 0 (0 clones) · cycles 0 · `npm run build` 0 (`dist/node.js`
71.3 of 75 KiB; no budget raised) · `build-node-auth` 0
(`dist/nodeAuth.js` 498.8 KiB, as on base).

Not claimed: no README, CHANGELOG or Help line. Neither fix has been
used through the packed product yet; that run is the lead's.

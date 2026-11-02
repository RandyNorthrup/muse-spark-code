# CC-WINTEAM — M96c's pause-before-rename, killed-lander and crash-recovery legs on Windows (2026-11-02)

Claude Code lane `CC-WINTEAM`, worktree `C:/Users/Randy/Coding/mx-cc-winteam`,
branch `cc/winteam`, cut from `cc/winpath` `d696cd1284`, on the owner's Windows 11
PC (Windows 11 Pro 10.0.26200, Intel i9-12900HK, 20 logical CPUs, Node 24.20.0). An
earlier agent of this lane was stopped by the owner's pause on 2026-10-31 with five
files uncommitted and its evidence in `temp/`; this record finishes that work. (The
older `winteam.md` is another lane's record, of hosted Windows work on 2026-10-07.)
Model attempts: **0**. Provider calls: **0**. Muse requests: **0**. Nothing was
pushed, rebased, reset, stashed by hand or tagged (the pre-commit hook's own
lint-staged backup is the only stash a commit touched). The vault suites and the
real credential-store suites (`test/unit/vault/**`, `keyringParts`, `keystoreOwner`,
`credentialLease`, `providerHeadersStore`) were never run on this PC. Scratch files
lived in the worktree's ignored `temp/` (`TMP` and `TEMP` at `temp/tmp`,
`LOCALAPPDATA` at `temp/localappdata`, so the birth reader builds there); at most
four vitest workers; one heavy command at a time, but once: the last typecheck and
duplication gates overlapped the final three-spelling run for a few minutes, because
a stale done marker was read as that run's end. Both finished clean.

## 1. What was open

M96c's certification checklist asks for the pause-before-rename, killed-lander and
crash-recovery tests on all three platforms, and none had a green Windows or macOS
hosted run: hosted run 41214393586 failed `teamLandingKilled` and `teamLandingPause`
on both (`docs/certification/rlf-teamcore.md` had them green on a macOS rig). On the
owner's PC, with `TEMP` under a long name, both
passed before any change (`temp/logs/before-3.log`: 5 of 5), so a green local run said
nothing about the hosted red.

## 2. What was wrong, and the fix for each

**2.1 The folders came by another spelling (the hosted red; commit `e5967e09f0`).**
The hosted log reads `TeamMergeError: The team merge has a linked root file.txt` from
`confinedRelative`, then `the lander child never reached the kill point`. The hosted
`TEMP` is `C:\Users\RUNNER~1\...` (an 8.3 short name), macOS's is under `/var` (a
symbolic link to `/private/var`). `landTeamTask` made its staging copy under the
storage as handed, and the merge applier refuses any root whose real path differs
from its spelling. Measured here on the base code, with `TEMP` spelled three ways:

| `TEMP`                  | Base code                                                                  | Log                                                 |
| ----------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| as created              | 5 of 5 pass                                                                | `before-3.log`                                      |
| lower-cased             | 5 of 5 pass (case alone is not the cause)                                  | `before-3-lower.log`                                |
| 8.3 short name          | 2 fail, with the hosted run's exact error and stack                        | `before-3-short.log`                                |
| through a junction      | `teamLandingPause` fails with the same error                               | `before-pause-junction.log`                         |
| short, storage resolved | `the checkpoint failed` from `landingJournal.targetOf`: the root must also | `step1-short.log`; both resolved: `step2-short.log` |

It is not only a test's problem. With a canonical storage (the engine ports
canonicalize theirs) and a workspace opened through a junction or an 8.3 name, the
base code wedged the person's repository, and this run through the product's own
functions shows it (`temp/measure/winteam-link-before.txt`, the same for `shortName`):

```
land threw: the checkpoint failed
after land: lock=true open=1 file="before\n" gitAdd=exit 128: fatal: Unable to create ... index.lock: File exists.
recover (lock standing): 0
person removed the lock
recover threw: the checkpoint failed
after recover: lock=true open=1 gitAdd=exit 128: ...
```

Every recovery failed the same way and took the lock again. After the fix
(`winteam-link-after.txt`, `winteam-shortName-after.txt`):
`land: merged`, `lock=false open=0 file="after\n" gitAdd=exit 0`.

The fix: `canonicalLandingFolders` resolves the workspace and the storage once, as the
file system does (PLAN.md D24), before `landTeamTask` or `recoverOpenLandings` uses
either. The test helper `LANDING_SPELLINGS` runs each landing proof with the folders
handed as created, through a directory link (a junction on Windows, a symbolic link
elsewhere), and on Windows by their short names, so a runner with no alias in its
`TEMP` still proves it.

**2.2 The killed-lander suite never killed anything (`e5967e09f0`).** The child
stopped on `await new Promise(() => undefined)` at the top level. Nothing keeps a Node
process alive for a promise, so it ended by itself as soon as it reached the stop
point, and `child.kill('SIGKILL')` hit a process already gone or going. The suite
passed because the lock and the record stay behind either way. Drill L4 restores that
wait: the kill's result is `{ isAliveAtKill: false, signal: null }`. The child now
stands alive on a timer, and the suite asserts that the kill landed on a live process
and that the process died of it (`signal: 'SIGKILL'`).

**2.3 A killed write left its stage in the person's tree, for good (`e5967e09f0`).**
`writeFileIfUnchanged` stages the new bytes beside the target as
`<name>.<uuid>.tmp` and renames at the last check. Kill the lander between the two
(the plan's "A is killed during the pause") and the stage stays. Recovery rolled the
files back, closed the record and never looked at it, so the file stayed in the tree
as an untracked file that `git add -A` commits and every later snapshot carries. The
new batch case found it at once (`temp/logs/cc-first-landing.log`:
`"c.txt.0be0856e-…-7b9fd7b39f8f.tmp"`, on all three spellings). Recovery now calls
`removeStages` for each file of the record, first: a file named exactly as the write
names a stage of that file, in its folder, that holds all or the start of the record's
before or after bytes. A file of the person's under the same kind of name, with other
bytes, stays (proved below). A tree that stops being this landing's (`canWrite`) names
that file as a conflict.

**2.4 Nothing in the product could take a dead window's board (`b78c9bbb9f`).**
`createWindowTeamScheduler` takes a process lease (`ownerBirth`) and a probe that
proves a foreign owner gone (`probeOwner`); "absent means only same-window and released
claims move; anything else fails closed and never takes over". No product code passed
either (they went through `teamHost.ts`'s two forwarding lines, and nobody filled
them), and `windowInstanceId` is a new UUID in every window. So a window that crashed
left a claim no later window could ever take: `takeoverBoard` refused, Traffic's Take
over threw `changedSinceOpened`, and the board stayed interrupted for good. The crash
test passed because it answered the probe itself (`probeOwner: () =>
Promise.resolve(false)`). `boardOwner.ts` now builds both from `core/locks/processOwner`
(the same birth and proof-of-death the lock notes use: another host or an unreadable
birth is never gone, a reused pid is), `createTeamWindowRuntime` binds them for every
scheduler the window makes, and the two forwarding fields are gone. Measured cost: the
first `createTeamWindowRuntime` in a process took 150 ms on this PC (§7).

**2.5 A reassign never reached the board (`b78c9bbb9f`, the earlier agent's finding).**
`StallRecovery`'s `retire` port returned a proved retirement without finishing the
attempt on the board, so `board.prepareNext` (which opens a next attempt only from a
retired one) refused, and the task blocked as `exhausted` with its worker proved dead
(`temp/logs/recovery-debug.log`: `DEBUGR blocked {"childExited":true,"descendants":
"proved"}` over an attempt still `running`). The port now does what `retireAttempt`
does: `finishAttempt`, then `scheduler.retired`.

**2.6 The lock's wait named another constant (`e5967e09f0`).** `takeIndexLock` waited
`TEAM_RETIRE_WAIT_MS`; `TEAM_LANDING_LOCK_WAIT_MS`, the plan's name for that wait, had
no reader. Both are 30 s, so nothing changes but the reader.

## 3. The three legs, as proved

All three on real processes, real git and a real journal on disk; the only ports the
suites supply are the host's own adapters (admission, launch, evidence), as before.
Each row runs on every spelling of the folders unless it says otherwise.

| Leg                                | Suite and case                                                                                 | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause before the rename            | `teamLandingPause`: "renames nothing into the user tree while the check is still running"      | While the check runs in the staging copy the tree keeps its old bytes; on release it lands                                                                                                                                                                                                                                                                                                                                                                             |
| Pause before the rename            | `teamLandingPause`: "a lander paused before its rename holds everyone off…" (new)              | A real lander process stands at the last check before its rename: lock held, record `open`, stage beside a target still at `before`. `git add` exits 128. Another window's `landTeamTask` returns `rework` with `refusal: { kind: 'busy', action: 'recheck' }`, writes nothing. Released, the lander exits 0 with `merged`: `after`, no lock, record `landed`, no stage, `git add` exits 0. The other window's Retry lands from a new snapshot holding both changes    |
| Lock itself                        | `teamLandingPause`: "is never taken or touched while another holds it…" (new; one spelling)    | A real lock file is reported `busy` after the bounded wait, its bytes untouched; once gone it is taken by exclusive create, names its owner, and `release` removes it. This closes the `wx` probe `rlf-teamcore.md` disclosed as not firing (drill L9)                                                                                                                                                                                                                 |
| Killed lander                      | `teamLandingKilled`: "a SIGKILLed lander blocks, then confirmed takeover recovers its record"  | The kill lands on a live process. Recovery returns 0 while the lock stands. Once the person removes it and edits the file, takeover recovers 1, keeps the edit, names it in the record (`conflicts: ['file.txt']`), releases the lock; landing works again                                                                                                                                                                                                             |
| Killed lander, half a batch        | `teamLandingKilled`: "a batch killed before its third rename…" (new)                           | Four files, killed with two written and the third staged. Record stays `open`, `git add` exits 128, the next landing stops with Retry, recovery waits for the lock and for the person's Take over. Then: the written file goes back, the file the person edited is named and kept, what it never reached stays, its stage goes, a file of the person's under a stage's name stays; `git status` shows only the person's two; the whole batch lands from a new snapshot |
| Killed recovery                    | `teamLandingKilled`: "a recovery killed in its turn…" (new)                                    | A recovery is killed at the rename that would restore its first file. Record still `open`, its lock left, its own stage (before bytes) beside the file. Once the person removes that lock, the next window finishes the same record: all four at `before`, no stage, `git status` empty                                                                                                                                                                                |
| A held file (Windows)              | `teamLandingKilled`: "leaves the batch open and recoverable, never finished" (new; as created) | A real program (PowerShell's `FileShare.ReadWrite`, no delete sharing) holds the third of four files. The rename fails after its retries; `landTeamTask` rejects with the system's code. Two written, no stage left, record `open`, lock standing. The program closes it; recovery still waits for the lock; once removed, this window rolls its own landing back                                                                                                      |
| Crash recovery                     | `teamSchedulerRecovery`: "a window killed mid-task: the next proves it gone…" (rewritten)      | A real window process runs the product's scheduler through `createTeamWindowRuntime`. A second window's `takeoverBoard` is refused while it lives (the real probe). Killed, its journal stands with its claim and a `running` attempt. The next window restores the attempt `interrupted`, takes the board on the real proof, reopens and relaunches it                                                                                                                |
| Crash recovery in a job (Windows)  | `teamSchedulerRecovery`: "a window killed mid-task takes its worker tree with it…" (new)       | The same, with the worker and a detached grandchild in the real job helper's `run-team`: both end when the window is killed, and the next window relaunches in a new job                                                                                                                                                                                                                                                                                               |
| Worker killed in its job (Windows) | `teamSchedulerRecovery`: "a worker killed mid-task retires proved by its job…" (new)           | TerminateProcess on the worker mid-task: the job ends the grandchild and reports `END proved`, the attempt retires `{ kind: 'proved', method: 'windowsJob' }`, nothing waits on the person, the replacement starts in a job of its own                                                                                                                                                                                                                                 |
| Unprovable attempt                 | `teamSchedulerRecovery`: "an unprovable attempt stays uncertain until Hand off anyway"         | A plain child proves no containment: uncertain through both bounded waits, until the person's recorded decision                                                                                                                                                                                                                                                                                                                                                        |

A real lander and a real window start through two bundled children
(`teamLandingChild.entry.ts`, `teamWindowChild.entry.ts`); `helpers/teamLander.ts` and
`helpers/teamWindowRig.ts` hold what the suites share with them.

## 4. Measurements kept from the earlier agent's run

A program holding the target while a landing renames it, on NTFS
(`temp/measure/held.measure.test.ts`, not committed):

- **A brief hold** (200 ms): `land: merged after 2503 ms`, `lock=false open=0`. It
  does not show the retry fired, so it is a measurement, not a proof; the rename's own
  retries are `fsAtomic`'s.
- **A hold until told**: `land threw code=EPERM after 3102 ms`, `lock=true open=1
file="before\n"`, git refused; own recovery 0 with the lock standing, 0 again with the
  program gone; once the person removed the lock, 1; `lock=false open=0
file="before\n" gitAdd=exit 0`. This is now the held-file case in §3.

## 5. Red/green drills (final code, `--maxWorkers=4`, each restored byte-exact)

Each ran on the committed code through `temp/scripts/drills.mjs` (not committed): an
exact edit, the suite, the exit code, then the file written back and checked by its
digest and `git diff --quiet HEAD`. Every drill was restored. The earlier agent's five
red logs (`temp/logs/drill1-killed-red.log` to `drill5-recovery-red.log`) showed the same
causes on the first form of these suites; these runs supersede them.

| #   | Broken on purpose                                                                        | Suite and case                     | Exit  | Red                                                                                                     |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| L1  | `teamLandingEntry.ts` as on the base: no canonical folders                               | Pause and Killed, whole            | 1     | 10 of 17: every link and short-name case, `the lander never reached its stop point`, `linked root`      |
| L2  | recovery alone keeps the workspace's handed spelling                                     | Killed, SIGKILLed                  | 1     | link and short name: `the checkpoint failed`; as created green                                          |
| L3  | landing alone keeps the workspace's handed spelling                                      | Killed, SIGKILLed                  | 1     | link and short name: `the lander never reached its stop point`                                          |
| L4  | the child as it was: `await new Promise(() => undefined)` at its stop point              | Killed, SIGKILLed                  | 1     | all three: `{ isAliveAtKill: false, signal: null }` (or alive for an instant, `signal: null`): no kill  |
| L5  | recovery does not call `removeStages`                                                    | Killed, batch                      | 1     | all three: the lander's stage still there beside the person's file                                      |
| L6  | `removeStages` by name alone, whatever the bytes                                         | Killed, batch                      | 1     | all three: the person's file gone (`expected [] to deeply equal [ Array(1) ]`)                          |
| L7  | recovery closes the record without rolling back                                          | Killed, batch                      | 1     | all three: `expected 'after\n' to be 'before\n'`                                                        |
| L8  | recovery removes a stale `index.lock` itself (M96c's own drill)                          | Killed, batch                      | 1     | all three: `expected 1 to be +0`: it recovered with the lock standing                                   |
| L9  | the lock opened with `w`, not `wx` (the probe `rlf-teamcore.md` reported as not firing)  | Pause, the lock itself             | 1     | `expected { kind: 'taken' … } to match { kind: 'busy' … }`                                              |
| L10 | a landing ignores another window's open record                                           | Pause, paused lander               | 1     | all three: the other window was sent to a landing branch (`branched`), not Retry                        |
| L11 | no intent written before the first file                                                  | Pause, paused lander               | 1     | all three: `expected [] to deeply equal [ 'open' ]`                                                     |
| L12 | a finished landing keeps its lock                                                        | Pause, paused lander               | 1     | all three: `expected true to be false` at the lock's check                                              |
| L13 | a rename refused mid-batch closes the journal as landed                                  | Killed, held file                  | 1     | `expected Error: That team task is not open… to match object { code: … }`                               |
| L14 | recovery knows only the landing's new bytes, not its own stage's                         | Killed, recovery killed            | 1     | all three: the dead recovery's stage stays                                                              |
| R1  | `window.ts`'s retire port as on the base                                                 | Recovery, worker killed in its job | 1     | `expected 'blocked' to be 'reassigned'`                                                                 |
| R2  | the Windows driver records `descendants: 'uncertain'` on `END proved`                    | Recovery, worker killed in its job | 1     | `expected 'blocked' to be 'reassigned'`, after both bounded waits                                       |
| R3  | `createTeamWindowRuntime` binds no lease and no probe (the base's behaviour)             | Recovery, window killed            | 1     | `expected false to be true`: the next window cannot take a dead window's board                          |
| R4  | the probe calls every owner gone                                                         | Recovery, window killed            | 1     | `expected true to be false`: a live window's board taken                                                |
| R5  | the job helper stops watching its window (`WaitForMultipleObjects` on the payload alone) | Recovery, window killed in a job   | **0** | **green: this break alone does not fire.** See below                                                    |
| R5b | the helper started `detached`, outside libuv's job for this process's children           | Recovery, window killed in a job   | **0** | **green: this break alone does not fire.** See below                                                    |
| R5c | both of those together                                                                   | Recovery, window killed in a job   | 1     | `expected true to be false`: the worker outlives its window; the drill runner ended what it left behind |
| R6  | a restored attempt stays `running`                                                       | Recovery, window killed            | 1     | `expected [ 'running' ] to deeply equal [ 'interrupted' ]`                                              |

**R5 and R5b are not a gap in the test, they are two walls.** A window's workers end with
it on Windows for two independent reasons: `RunCore` waits on the parent's handle and
returns when the window dies, and libuv puts every non-detached child of a Node process
in a kill-on-close job of its own. Either one alone still ends the tree, which is why
the suite stays green with one down and goes red with both (R5c). The same libuv job is
why a plain worker dies with its window on Windows and survives it elsewhere, so the
plain crash case accepts `ESRCH` when it ends the worker.

`TEAM_LANDING_LOCK_WAIT_MS` has no drill: its value equals what it replaced, and
`teamConstants.test.ts` pins it. In two reds (R4, R5c) `rmdir`'s `EBUSY` in the suite's
teardown printed first because a process was still running; the assertion above is the
case's own.

## 6. Suites on the final code

`teamLandingPause`, `teamLandingKilled` and `teamSchedulerRecovery` on the committed
code, `--maxWorkers=4`, the repository's own timeouts. This closes what the pause left
open: the earlier agent's junction run (`temp/logs/after-3-junction.log`) had only its
header when the owner paused the project.

| `TEMP`                                                         | Log                  | Exit | Result            |
| -------------------------------------------------------------- | -------------------- | ---- | ----------------- |
| as created, `temp\tmp`                                         | `final-long.log`     | 0    | 3 files, 22 of 22 |
| by 8.3 short names, `MX8C86~1\temp\tmp\LONGFO~1` (as hosted's) | `final-short.log`    | 0    | 3 files, 22 of 22 |
| through a junction, `temp\tmplink`                             | `final-junction.log` | 0    | 3 files, 22 of 22 |

Beside those, on the long `TEMP`:

- Every team suite (`vitest run test/unit/team`, `final-team.log`): **exit 1**, 1,312
  passed, 3 skipped, **1 failed**: `teamWorkspaceRefs`, "throws a broken repository
  instead of reporting it absent", which needs a temporary folder outside any
  repository and got this worktree's `temp/`. With `GIT_CEILING_DIRECTORIES` at that
  boundary the same suite exits 0, 2 of 2 (`final-refs-ceiling.log`): this lane's
  environment, no product change, and no bearing on a runner's `TEMP`.
- `vitest related` over the changed sources, with the vault and credential-store suites
  excluded (`final-related.log`): exit 0, 7 files passed, 1 skipped, 76 tests passed,
  2 skipped.

## 7. The built bundles in real processes

`npm run build`'s own `dist/teamWindow.js` and `dist/teamLanding.js`, required from
disk and driven by `temp/scripts/packed-window.cjs` (not committed), real processes
over real git; no team run, no model, no provider. Its output
(`temp/measure/packed-window.txt`):

```
first runtime in this process: 150 ms
live window: next window takes the board: false
window killed: {"code":null,"signal":"SIGKILL"}
restored: task blocked, attempt interrupted
dead window: next window takes the board: true
reopened: true
```

and for each of `long`, `junction` and `short`, the same five lines (here `short`):

```
short: lander alive at kill true, {"code":null,"signal":"SIGKILL"}: a=after b=before stages=1 lock=true
short: recover, lock standing: 0
short: recover, lock removed: 1
short: a=before b=before stages=0 lock=false status=""
short: land again: merged: a=after b=after
```

The product's own surfaces do not reach the landing yet (§9, decision 1), so this is
the bundles on disk, not a packed team run.

## 8. Gates

Every command ran from the worktree on the committed code, with `TMP` and `TEMP` in
`temp/tmp` and the owner using the PC.

| Gate                                                                                                                                                             | Exit          | Result                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on the changed files                                                                                                                          | 0             | all use Prettier code style                                                                                                                                                                                                                                                        |
| `eslint --max-warnings 0` on the changed files                                                                                                                   | 0             | the first run found 19 problems in the new code; fixed, none disabled                                                                                                                                                                                                              |
| `npm run typecheck` (host, webview, unit, e2e, integration, faults)                                                                                              | 0             | no `error TS` line                                                                                                                                                                                                                                                                 |
| `npm run check:catches`                                                                                                                                          | 0             | all catch sites and counts match the baseline (the two new catches are NARROW)                                                                                                                                                                                                     |
| `npm run duplication`                                                                                                                                            | 0             | 0 clones (the first run found two; the shared setup moved into `landingDeps`, `landingFixturesIn`)                                                                                                                                                                                 |
| `npm run cycles`                                                                                                                                                 | 0             | no circular dependency                                                                                                                                                                                                                                                             |
| `npm run deadcode`                                                                                                                                               | 0             | knip clean (the same 5 tag hints as the base), with the new child entry declared                                                                                                                                                                                                   |
| `node scripts/check-l10n.mjs`, `check:host-api`, `check:reference`                                                                                               | 0, 0, 0       | no text, editor API or reference row changed                                                                                                                                                                                                                                       |
| `check:plan`, `check:roadmap`                                                                                                                                    | 0, 0          | with this lane's M96c paragraph                                                                                                                                                                                                                                                    |
| **`npm run build`**                                                                                                                                              | **1**         | **the four known rows and nothing else:** `dist/teamRunners.js` 78.4 of 75, `dist/teamHost.js` 140.1 of 130 (140.2 before), `dist/teamScheduler.js` 76.5 of 75, `dist/uiText.js` 125.3 of 125. No budget raised. `dist/teamWindow.js` 46.8 of 75, `dist/teamLanding.js` 51.4 of 75 |
| the rest of the build chain by hand: `check-bundle-split`, `gen-lazy-registry --check`, `check-host-globals`, `third-party-notices`, `check-legal-build-records` | 0, 0, 0, 0, 0 | the split gate passes with `processOwner` in `dist/teamWindow.js`                                                                                                                                                                                                                  |
| **`npm run check:mhp`**                                                                                                                                          | **1**         | known on int, not re-frozen: `MHP_VERSION_LOCK: v1.1 frozen wire contract changed`, the line CC-WINPATH recorded on the base; no MHP file changed here                                                                                                                             |
| `npm run package:acp -- --target win32-x64`                                                                                                                      | 0             | **141 of 141** packaged-bundle checks, `dist/teamWindow.js` and `dist/teamLanding.js` among them                                                                                                                                                                                   |

## 9. Decisions for the lead, and what remains

1. **`landTeamTask` and `recoverOpenLandings` have no product caller.** The engine's
   merges port (`teamEnginePorts.ts`) calls `applyTeamMerge` on the repository itself,
   with no journal, no index lock and no staging copy, and nothing runs recovery at a
   window's start; the same is true on `cc/int9`, `rlf-teamworkers3` and `rlf-m96crec`.
   So everything §3 proves about landing proves the checked landing the product does not
   run yet. `teamHostEntry.ts` said the engine entry binds them; its comment now says
   they do not. **Recommendation: bind `merges.merge` to `landTeamTask` and run
   `recoverOpenLandings` at team start, as M96c's design asks, before any claim.** The
   board's proof of death (§2.4) does run: `createTeamHost` loads it.
2. **A file changed mid-batch, in a live window, passes as landed and reports the wrong
   thing.** Measured (`temp/measure/changed.measure.test.ts`, not committed): the person
   saves `c.txt` while its replacement stands staged, third of four:
   `land threw: That team task is not open in this window.`, `a.txt` and `b.txt` at
   `after`, `c.txt` the person's, `d.txt` at `before`, no lock, the record
   `{"status":"landed","conflicts":["c.txt","d.txt"]}`, recovery 0. `TeamLanding` does
   detect it (`status: 'changed'`, the plan's "changed during landing"), but
   `landTeamTask` maps that to its `default` throw, `TeamMergeRefusal` has no such kind,
   and the plan's Undo merge has no path: the landing and its intent are gone when the
   call returns. Not Windows's, and no caller reaches it yet, so I left it: it needs a
   refusal kind, its text and the Undo card. **Recommendation: settle it with decision
   1, and do not close a stopped batch as `landed`.**
3. **The engine merges port has the spelling defect on the workspace.** Hosted run
   41214393586's `teamMergePlan` (Windows) fails on the same `linked root`, through
   `Object.plan` in `teamEnginePorts.ts`: its `storage()` is canonical, but `repository()`
   hands the workspace as spelled to `planTeamMerge` and `applyTeamMerge`. So a workspace
   a person opens through a junction or a symbolic link gets that refusal at the merge
   card in the product today. (`teamEnginePorts` on macOS and Windows fails first on
   `validateTeamFolder`, over its own suite's aliased storage.) Those suites are on
   CC-CIFIXW's and RLF-CIFIXA's lists, so they are not touched here. **Recommendation:
   resolve the workspace once in `repository()`, as `canonicalLandingFolders` does.**
4. **Window B's stop is at once, not after 30 seconds.** The plan's list says B "waits
   on the lock, then stops with Retry after `TEAM_LANDING_LOCK_WAIT_MS`". In the code an
   open record refuses first (`busy`, at once), a lock with no record is a known holder
   and goes to a landing branch (acceptance 22), and only a lock made between the holder
   check and the take waits the 30 seconds. Nothing is written in any of them, and the
   suite follows the code. **Recommendation: correct the list's sentence.**
5. **A held file leaves a live window's own lock for the person to remove** (§3). This is
   the code's stated rule ("a partial write or failed journal close leaves the lock and
   open intent for Recover") and nothing half-landed passes as finished, so I kept it and
   proved it. Windows makes it common (Office, a scanner, a running program). The window
   holds the lease and could roll back at once. **Recommendation: consider that when
   decision 1 is bound.**
6. **macOS, Linux and hosted Windows are CI's.** The suites are written for all three
   (only the job, held-file and short-name cases are Windows-only) and ran only here.
   The checklist's "on all three platforms" box stays open until a hosted run on the
   joined build is green; nothing else is ticked. **No CHANGELOG entry:** nothing here has
   been used through a packed product (the standing rule beats rule 10), as CC-WINRUNTEAM
   decided for the team launch.

## 10. Commits

`d696cd1284` → `e5967e09f0` (landing, the lock's constant, the pause and killed suites,
their children and helpers) → `b78c9bbb9f` (the board's proof of death, the retirement
on the board, the recovery suite and its child and rig) → `21f7942a4d` (the held-file
case's cleanup, found by drill L13) → the commit carrying this record, the PLAN M96c
paragraph and the certification index line.

# CC-WINLAND — the product lands through the checked landing (2026-11-03)

Claude Code lane `CC-WINLAND`, worktree `C:/Users/Randy/Coding/mx-cc-winfix3`, branch
`cc/winland`, cut from `cc/int11fix6` `f572397f23` on the owner's Windows 11 PC (Windows
11 Pro 10.0.26200, Node 22.23.4). The lead's decision of 2026-11-02: a team's landing in
the real product had none of the protection M96c built and proved. Model attempts: **0**.
Provider calls: **0**. Muse requests: **0**. Nothing was pushed, rebased, reset, stashed
by hand or tagged. No vault or credential-store test file was imported, `MUSE_TEST_REAL_CLI`
was unset, the real `muse` CLI could not be found, at most four vitest workers, one heavy
command at a time. Scratch stayed in the worktree's ignored `temp/`.

## 1. What a landing guarantees, and what the product ran

M96c's acceptance 19 and 22 and `cc-winteam.md`: a landing is merged and checked in a copy
of the whole tree, bound to that snapshot, written under git's `index.lock` with a durable
journal first, and a window that dies halfway leaves a record the next window shows,
with the lock named; nothing proceeds until the person removes the lock and Recover rolls
it back, and a file the person changed since is named and kept.

The product ran none of it. The faults, plainly:

| #   | Fault in the product                                                                                                                                                                                     | Found by        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | `landTeamTask` and `recoverOpenLandings` had no caller. The engine's merges port merged in place with no journal, no lock and no copy, and nothing ran recovery at start.                                | CC-WINTEAM §9.1 |
| 2   | A file changed mid-batch passed as landed: the record closed `landed`, the caller got an unrelated error, and Undo Merge had no path.                                                                    | CC-WINTEAM §9.2 |
| 3   | The engine port handed the workspace as spelled: a workspace opened through a junction or link was refused as a linked root at the merge card.                                                           | CC-WINTEAM §9.3 |
| 4   | A held file left a live window's own lock for the person to remove, though that window held the lease and knew what it wrote.                                                                            | CC-WINTEAM §9.5 |
| 5   | **Every team merge on a checkout with CRLF line endings came back as a conflict, on every file a worker changed.** That is Git for Windows' default (`core.autocrlf=true`, this PC's own system config). | this lane, §4   |
| 6   | The person's check commands never ran before a landing: nothing passed `checks` or `runChecks` to it.                                                                                                    | this lane       |
| 7   | An ACP session's recovery at start could ask nobody: its team host binds before session/new has answered, with no handler attached and no session the editor could answer for.                           | this lane, §3.1 |

Fault 5 predates this lane. The merge routine compared raw bytes on disk with what the
repository keeps, in place before and in the staging copy now; drill W18 restores that
comparison and the direct in-place `applyTeamMerge` case goes red with it. No earlier suite
could see it: `fixtureGit` and `landingRunGit` pin `core.autocrlf=false`, and the fixtures
write LF. It showed only when a landing ran over a tree as `git checkout` really leaves one.

## 2. The five items

**1. Every landing is the checked one.** The engine's `merges.merge` plans first (the same
refusals as before) and then calls `landTeamTask` through `createEngineLanding`
(`teamLandingEntry.ts`), keeping TEAMWORKERS' ports and M96c's landing. There is no other
writer: `applyTeamMerge` now runs only on the staging copy. `createTeamHost` recovers
before its service exists; every landing settles what it can first, or it would refuse as
busy; `exec --team` recovers at start, with its journal beside the person's data
(`<data>/EXEC_TEAM_LANDING_FOLDER/<sha256(realpath(cwd))>`, mode 0700) because a run's
folder goes with the run. Another window's record shows in Traffic with the lock it left,
and Recover is the person's. In the ACP agent it is a permission (§3.1); exec has nobody
to ask and settles a record once its lock has gone. The person's unsaved file stops a
landing whole, before the first write, in the words `landingUnsaved`.

**2. A file changed mid-batch does not pass as landed.** The record closes `changed`, never
`landed`. Refusal kind `changed`, with the paths and the landing's id; words in all 15
languages (`teamChangedDuringLanding`, `teamUndoMerge`, `teamTrafficNotices.changedDuringLanding`,
`undoKept`, `teamLandingUndone`). The merge card names the files and offers **Undo Merge**;
Traffic offers the same through `undoBatch`. Undo puts back what still holds the landed
bytes, skips a file the batch never reached, and keeps the person's file. MHP 1.6.0, not
shipped, is re-frozen for `decideTeamMerge`'s `undo` and the card's `changedDuringLanding`.

**3. The workspace's spelling.** `canonicalRepository` reads the workspace with
`canonicalPath`, the real path, the same reading as `confine.ts`'s short-name case, before
anything compares it. Drill W8 shows the link case is the guard: with the break, `link` goes
red and `shortName` stays green, because a short name is no link at the root check and both
sides of that check read real paths. The landing's own folders were `canonicalLandingFolders`'
work in CC-WINTEAM. The short-name case stays as a regression case; it could go red only
if a later compare reads the spelling.

**4. PLAN's "window B waits 30 s".** Corrected to the code: with A's record open B stops at
once with Retry; a lock with no record is a known holder and goes to a landing branch; only
a lock made between the holder check and the take waits, up to `TEAM_LANDING_LOCK_WAIT_MS`.

**5. A held file.** `TeamLanding.land` rolls back at once when a replace throws, and
releases the lock: status `held`, refusal kind `held` with the words `fileHeld` when the
error is EPERM, EBUSY or EACCES; any other failure keeps its own words with the tree already
back. A roll-back that is refused too keeps the record and lock for Recover.

## 3. Found on the way

**3.1 ACP asks at the first turn (fault 7).** `AcpTeamSession.settleLandings`, called at
the top of `prompt()`: session/new has answered by then. Asked once in an agent run; Keep
leaves the record open, and a landing that needs the answer asks again. A lock still
standing asks nothing, so a later turn can settle it. It asks the first attached session,
which need not be the one prompting.

**3.2 The check commands (fault 6).** `ProcessTeamPorts.runLandingChecks` runs each over the
staging copy; the first non-zero exit refuses with kind `checks`, naming the check. On Windows it
goes through the governed check slots, on the job's proof. On Linux and macOS it takes a folder of
the landing's own under the same governor (§10): as this section first stood, every landing with check
commands refused there. `teamWorkerChecks` is POSIX-only, so `teamLandingChecks.test.ts` is the
first proof of those slots on Windows: the real governor window, the real job, a real snapshot of
the merged copy, and a script that logs where it ran and what it read.

**3.3 The governed git.** `teamLandingSurfaces.test.ts` lands through `processTeamGit` under the
governor as the runtime process configures it (`configureRuntimeGovernor`). That closes what the
earlier suites left open (they inject plain git). This section first said it was `configureResources`
with the Windows job, "as the agent process configures it". That was wrong: the runtime also passes
the created-path helper, and without it no governed launch starts on POSIX (§10).

**3.4 One red I could not explain.** On one run of `teamLandingSurfaces`, the CRLF case failed
with `TeamGitError: git --no-replace-objects exited with code 1:` and empty stderr, from
`ls-tree` in `land`'s snapshot after the writes (`temp/out/w8.log` of that run). It did not
come back: not on that case alone, not on the whole file with the runner's catch logged to
a file (it logged nothing), and not on any run since, the drills' included. **Cause not
settled.** `processTeamGit` turns any failure without a numeric code into exit 1, so a real
exit, a child killed with a null code and a fork stop or launch refusal all read the same
(inferred from the code; the logs do not show which). A landing that meets it stops safely,
per M96c: the record stays open under its lock for Recover. If hosted CI shows it, that runner's
catch is the place to look. CC-WINLAND2 narrowed that catch (§10) for a cause it could show, so if
this comes back it comes back in its real type and words. It has not come back in any run since.

## 4. A real crash, on Windows

`teamLandingProduct.test.ts`, a real lander process through the engine's port, killed with
SIGKILL (`TerminateProcess`) with the journal durable, git's lock held and a replacement
staged, third of four. In all three spellings (as created, junction, 8.3 short name):

```
alive at kill, signal SIGKILL
a,b after; c,d before; a stage on disk; `git add` refused by the lock
next window: lock standing, recover 0, open row names the lock
person removes the lock: not confirmed 0; the person's Recover 1
all four before, no lock, no stage, record recovered; land again: merged, all after
```

The built bundles in real processes (`temp/packed-land.cjs`, `dist/teamEngine.js` reaching
`dist/teamLanding.js`, `temp/out/packed-land.txt`, plain git, no model and no provider):

```
lander alive at kill true, {"code":null,"signal":"SIGKILL"}
after the kill: a=after b=after c=before d=before lock=true
recover, lock standing: 0
open: [{"paths":["a.txt","b.txt","c.txt","d.txt"],"lock":true}]
recover, lock gone, not confirmed: 0
recover, the person's Recover: 1
after recovery: a=before b=before c=before d=before lock=false open=0
land again: merged: a=after b=after c=after d=after
crlf checkout: a.txt "before\r\n" status ""
crlf land: merged written 4: a.txt "after\r\n" status " M a.txt\n M b.txt\n M c.txt\n M d.txt\n"
```

`teamLandingSurfaces.test.ts`: a headless run leaves a dead run's record alone under its lock
and settles it at start once the lock is gone, in its own folder; a real ACP client, through
the real agent, is asked nothing until session/prompt, then once, Keep leaves it, Recover
settles it, and the next run asks nothing.

**The CRLF fix.** A file is a CRLF checkout when every line on disk ends in CRLF and neither
the base nor the worker's version holds a CR. The merge reads it as that text, three-way as
usual, and writes the result back in CRLF, so the person's edits merge and git sees exactly
the batch. Mixed endings, or a worker that wrote CRLF itself, are left as they are and refuse:
an untouched line is never rewritten. Binary files never convert.

## 5. Decisions for the lead, and limits

1. **"Land without checks asks in every mode" (acceptance 19) has no prompt of its own.** With
   no check commands, `confirmWithoutChecks` is true: the merge card is the ask, and ACP Bypass
   and exec land unasked as before. The `landWithoutChecks` action stays unimplemented. To make
   it a prompt, the port needs a question on each surface.
2. **ACP has no check commands**, and no Undo button: the model gets the refusal JSON.
3. **`createWindowHints` is wired by no window**, so `hints` is empty and the known holders are
   the lock and git operations in progress. A live window between its own git calls is not one.
4. **Undo is offered only in the window that landed:** the refusal is in memory. After a reload
   the record stays `changed`, closed, and nothing offers it.
5. **Closed landing records accumulate**, unpruned, in the journal folder.
6. **`describeMergeRefusal`'s stale, busy, denied and branched** still read in technical words on
   the card. `changed`, `held` and `checks` read in the person's.
7. **The dirty-document check in `src/extension.ts`** runs only in an editor: its port's behaviour
   is proved (W11), the VS Code wiring is not, here. The packed product's run is the proof.
8. **A window killed mid-landing with no lock left**, as in exec, relies on the person having
   removed it. The extension never removes an `index.lock` it did not take.
9. **Where no container proves a command's end, a check's setup command runs every time.** Its
   folder is used once, so it has no install cache. Windows' job and a Linux scope keep the shared
   slots' cache.
10. **A one-use folder's check permit goes back once the command's process group is gone,** and
    only then (§11). A process that left the group with `setsid` goes uncounted: nothing on such a
    system can see it. This item first said the permit went back "with no proof", and that holding
    it would stall the next landing for good. That is no longer how it stands.
11. **Worker `run_checks` now works on all three systems** (§11). This item first said it stayed
    refused on Linux and macOS, and left the lead three options. The lead chose, and the measures it
    quoted are in §11 on far more samples.
12. **Where no container proves an end, each check leaves its launches `uncertain` in the team
    journal,** about a dozen a check. They are unpruned, and the next window scans them at start in
    one pass.
13. **`mergeSpec` still reads any real git exit on the ref as absent,** as its comment says, so a
    repository git cannot read (exit 128 for another reason) says "moved ref". A launch that never ran
    no longer does.

## 6. What hosted CI must prove

Windows, macOS and Linux on the joined build: `teamLandingProduct`, `teamLandingSurfaces`,
`teamLandingChecks`, `teamLandingKilled`, `teamLandingPause`, `teamHostRealParts`,
`acpTeamSession`. Only the held-file and short-name cases are Windows-only. The real crash
and the CRLF landing were run only here. M96c's three-platform box stays open until a hosted run
on the joined build is green.

**A correction.** This section first said that on a POSIX runner these cases are "the same code over
the same bytes". For the CRLF merge that holds: the fixture sets its own `core.autocrlf`, and the copy
never converts. For the rest it was wrong, and hosted run 41794406176 showed it: a governed launch
needs the created-path helper there and not on Windows, and a landing's checks take another path. A
Windows pass says nothing about either. §10 says what each system has proved.

## 7. Red/green drills (`temp/drillsw.mjs`, narrowed to the guarding cases, `--maxWorkers=4`)

Each: an exact edit, the named file with a name filter, the exit code, the file written back and
its digest compared. All 19 exit 1, all restored.

| #   | Broken on purpose                                               | Red in                                             | What it said                                          |
| --- | --------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| W1  | `teamEnginePorts.ts` whole, as at `f572397f23`: merges in place | product, plans and lands                           | `expected [] to deeply equal [ 'landed' ]`: no record |
| W2  | a team host starts without settling                             | product, a team host settles                       | `expected 'after\n' to be 'before\n'`                 |
| W3  | a landing does not settle first                                 | product, settles first                             | `status: 'rework'` for `merged`                       |
| W4  | a stopped batch closes `landed`                                 | product, does not pass as landed                   | the record's status                                   |
| W5  | `changed` mapped to merged                                      | product, does not pass as landed                   | `expected 'merged' to be 'rework'`                    |
| W6  | Undo tries the file the batch never reached                     | product, does not pass as landed                   | `kept` holds `d.txt`                                  |
| W7  | a held file does not roll back at once                          | killed, a held file                                | `EPERM ... rename` reaches the caller                 |
| W8  | the port reads the workspace as spelled                         | product, `link` red, `shortName` green (§2 item 3) | linked root                                           |
| W9  | the card has no Undo Merge                                      | card, names what changed                           | no such button                                        |
| W10 | Traffic has no `undoBatch`                                      | real parts, the card names it                      | `expected [ 'landNow' ] to include 'undoBatch'`       |
| W11 | no look at unsaved files before the first write                 | product, stops a landing whole                     | `expected 'after\n' to be 'before\n'`                 |
| W12 | a failed check treated as passed                                | product, a check that fails                        | `status: 'merged'`                                    |
| W13 | the port ignores a check's exit                                 | checks, a check that fails                         | `status: 'merged'`                                    |
| W14 | a headless run does not settle                                  | surfaces, a headless run                           | `[ 'open' ]` for `[ 'recovered' ]`                    |
| W15 | a headless run journals in its run's folder                     | surfaces, a headless run                           | `[ 'open' ]` for `[ 'recovered' ]`                    |
| W16 | an ACP session never asks at its turn                           | surfaces, an ACP session                           | `[]` for `[ [ 'Recover', 'Keep' ] ]`                  |
| W17 | an ACP session asks every turn                                  | surfaces, an ACP session                           | asked twice                                           |
| W18 | the raw-byte comparison back: `isCrlf` false                    | surfaces, 4 line-ending cases, governed CRLF       | `Conflicts need the task copy`; `status: 'rework'`    |
| W19 | mixed line endings read as a CRLF checkout                      | surfaces, refuses rather than rewrites             | `promise resolved ... instead of rejecting`           |

## 8. Suites and gates

Named files only, `temp/vt2.ps1`, `--maxWorkers=4`, on `f24f37bfd0`, each exit 0:

- `teamLandingProduct`, `teamLandingSurfaces`, `teamLandingChecks`, `teamLandingKilled`,
  `teamLandingPause`, `teamMergeCardLanding`, `teamHostRealParts`, `teamEnginePorts`,
  `teamMergePlan`: 9 files, 76 tests passed.
- `teamMcpWiring`, `acpTeamSession`, `acpTeamServe`, `acpTeamContracts`, `acpTeamPackage`,
  `acpPermissionAsk`, `acpTurnFailure`, `acpSubagentAdmission`, `acpStableMethods`,
  `acpResources`, `acpShutdown`, `acpSessionRegistry`, `teamProcessWorkers`,
  `teamAvailability`, `mhpContract`, `mhpPanelContract`, `teamMoveTask`, `execTeamFlags`,
  `execTeamLedger`, `execTeamSweep`, `teamTrafficSuggestions`, `teamConstants`, `manifest`,
  `pathGuardSpawns`, `l10n`: 24 files passed and 1 skipped, 369 tests passed, 16 skipped (the
  skips this PC's are: `MUSE_TEST_REAL_CLI` unset, so no real `muse`, and POSIX-only cases).
- `teamChunkPackaging`: 5 passed.

The card's one small local look (`npm run ui:look -- team-cards`, dark and light, with a new
stopped-landing card in that scene): the files named, **Undo Merge** beside them. The look
also showed `Protected PathsNone` on any card with no protected path, an older fault: fixed in
`TeamCards.tsx` with one space. `node scripts/a11y.mjs team-cards team-traffic-recovery`: 8
pages, 4 themes, 0 rules violated.

The static job's gates, one pass on `9bd9ea8165`, Node 22.23.4, exit codes: `format:check` 0, `lint` 0, `typecheck` 0, `check:badges` 0, `check:tokens` 0, `check:art` 0, `check:l10n` 0, `check:reference` 0, `check:host-api` 0, `check:mhp` 0, `check:plan` 0, `check:roadmap` 0, `check:editor-matrix` 0, `check:catches` 0, `check:usable-reply` 0, `check:wrap-up-request` 0, `check:no-output-cap` 0, `check:no-round-cap` 0, `check:workflow-scripts` 0, `deadcode` 0, `cycles` 0, `duplication` 0, `build` 0, `security:audit` 0. Semgrep,
pinned, on the 25 changed source files: 0 findings, exit 0. An earlier pass on `ef3ffadfba` refused
`duplication` (a clone between `teamAvailability` and the new surfaces suite) and `typecheck` (a
check identity without its `timeoutSeconds` in the new checks suite); both were the new suites', and
`f24f37bfd0` answered them. Only this record's gate lines follow the pass: Prettier and
`check:plan` ran on that commit, exit 0.

Budgets, none raised (`npm run build`, the bundle check inside it, exit 0): `dist/extension.js`
527.9 of 600 KiB, `dist/resourceGovernor.js` 124.8 of 125 KiB, `dist/teamHost.js` 125.9 of 130 KiB,
`dist/teamEngine.js` 93.8 of 100 KiB, `dist/teamLanding.js` 56.1 of 75 KiB, `dist/teamProcess.js`
367.4 of 375 KiB, `dist/teamTraffic.js` 48.4 of 75 KiB, `dist/uiText.js` 119.5 of 125 KiB,
`dist/execTeam.js` 47.6 of 53 KiB, `dist/acp.js` 434.2 of 850 KiB. The landing added nothing to
`dist/resourceGovernor.js`, and `dist/teamEngine.js` shrank from 98.1 KiB: the applier moved out of it.

## 9. Commits

CC-WINLAND's first round, as below; CC-WINLAND2's are in §10.

`f572397f23` → `3b19d8bb9c` (the checked landing, recovery at start, the refusal kinds, Undo Merge,
the held file, the spelling, the check commands, PLAN's sentence, words) → `10c579c724` (settles
first, stops before writing, the check commands in a real slot) → `ef3ffadfba` (the CRLF checkout,
the ACP turn, the surfaces suite) → `f24f37bfd0` (what typecheck and duplication asked of the
suites) → the commit carrying this record, the card's harness scene and the index line.

## 10. CC-WINLAND2: hosted Linux and macOS (2026-11-04)

Hosted run 41794406176 on `45edc0c346` (`cc/winland` merged with `cc/small3`) was red on Linux and
macOS and green on Windows for these two suites. **The merge plays no part:** all six reproduced on
real Linux at `8942620fe5`, this branch alone, exit 1, the same words. How: a throwaway shallow
checkout in WSL's own disk (Arch, Linux 6.18, Node 22.23.4 as CI's, `npm ci`, its own build, removed
after), run two ways: with the distro's systemd user scope, and with `XDG_RUNTIME_DIR` and the bus
unset, so no scope, as a hosted runner has it (`container: processGroup` in the journal; measured).

| Hosted failure                                                   | Cause                                                                                                                                                                                                                                                                                                                                                          | Whose                                            | Evidence                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `teamLandingChecks`, both: `The earlier attempt has not stopped` | The shared slots give a folder back only on a container's proof. A process group proves nothing, and `checkProcessOver` says so for every git call of a slot's preparation. **Every landing with check commands refused, on macOS and on Linux, in those words, whatever the check would have said.**                                                          | **Product, from this lane's wiring**             | L1, L2; `rlf-teamworkers3.md` §7.1 had measured it for `run_checks` on macOS                                           |
| `the governed git`, both: `refused a moved ref ... to (absent)`  | Under it, the test's governor had no created-path helper, so the launch threw `NativeHelperError`: "The native helper muse-created is missing...". Then `processTeamGit` turned that into `TeamGitError` exit 1 with empty stderr, and `mergeSpec` reads a TeamGitError on the ref as absent. **A swallowed read failure, not a view of `.git` that differs.** | **Test** (the rig) **and product** (the swallow) | Printed on Linux: raw launch `NativeHelperError`, through `processTeamGit` `git rev-parse exited with code 1:`; L4, L5 |
| `a headless run`: `[ 'open' ]` for `[ 'recovered' ]`             | The same launch failure, in recovery's first git call, logged and survived by design. The folder and repository key are computed and read alike: green once the governor is right.                                                                                                                                                                             | **Test**                                         | L5                                                                                                                     |
| `an ACP session`: `[]` for `[ [ 'Recover', 'Keep' ] ]`           | The same. ACP passes no `runGit`, so it uses the governed git. Recovery found the record's folder; it never got as far as asking.                                                                                                                                                                                                                              | **Test**                                         | L5                                                                                                                     |

The product passes the helper: `src/runtime/resources/load.ts` and `src/extension.ts` configure it, and
`execTeamSweep` has always used `configureRuntimeGovernor`. My hand-made `configureResources` was the
fault, and `processTeamGit` is why it read as something else. Exec and ACP recovery in a broken
installation now log the helper's sentence instead of "git exited with code 1".

**The fixes.**

1. `teamProcessWorkers.ts`: on POSIX a landing's checks take `landing-checks/<uuid>`, one folder, used
   for this landing and removed. Nothing is reused, so nothing needs proving, and the verdict is the exit
   code. It still waits for the governor's check capacity, runs through the team's lifetime, snapshots the
   merged copy into a clone, and runs setup first. Windows keeps the shared slots. Selected by platform then, because a Linux
   scope's answer changed from one command to the next. §11 has since fixed that reading, moved this
   folder to `one-use-checks/`, and made it the one path for a worker's check too.
2. `workerOps.ts`: only git's own exit is a `TeamGitError`. A helper that is missing, a launch refused, a
   child stopped before it exited keep their own type and words. Callers read a TeamGitError as an answer:
   `teamWorkspaces.ts` reads exit 1 as "it differs", so a launch that never ran could read as that too.
   Guard: `teamGitLauncher.test.ts`, on every system, with no skip.
3. `teamLandingSurfaces.test.ts` uses `configureRuntimeGovernor`. `teamLandingChecks.test.ts` no longer
   reads a landing's folder after its removal. No case is skipped on POSIX.

**Also found: a landing cost four git processes per file in the tree.** Not in the hosted red, and not
POSIX's. `StagingCopy.snapshot` hashed each file in its own process, four snapshots a landing, two of
them under git's lock. It never showed because the suites' trees hold a few files. Measured on one file's
landing (`temp/wsl/zzcost.test.ts`, not committed, plain git, so no containment cost in these):

| Tree        | Before: processes | Before: Windows | Before: Linux | Now: processes | Now: Windows | Now: Linux |
| ----------- | ----------------- | --------------- | ------------- | -------------- | ------------ | ---------- |
| 50 files    | 289               | 11.6 s          | 0.8 s         | 93             | 2.0 s        | 0.3 s      |
| 500 files   | 2,089             | 71.3 s          | 4.2 s         | 93             | 9.4 s        | 0.5 s      |
| 2,000 files | 8,089             | not run         | 17.2 s        | 93             | 16.8 s       | 1.1 s      |

This lane's wiring would have brought that to every real landing, so it is fixed:
`hash-object --no-filters --stdin-paths`, raw bytes as before, with one-at-a-time as the fallback for a file
that goes away or a name the list cannot carry. Guard: `teamLandingSnapshot.test.ts`, which counts
processes and reads no clock.

**In the same run, not in this brief, and for whoever holds them.** Both are in `acpTeamSession`:

- `says a card that failed for real...`, on all three systems, is `cc/small3`'s case meeting this lane. It
  makes a landing fail by writing `.git/index.lock`. In the checked landing a lock with no record is a known
  holder and goes to a landing branch (acceptance 22), which is a refusal, not a failure, so that sentence
  never comes. The product is right and the case needs another way to fail for real. (Read from the code;
  I did not run it on the merge.)
- `lands the change on the editor's approval`, hosted Windows only, polls for at most 3 s over a real
  landing. Here that case took 3.4 s in all before the snapshot fix. After it, on this PC under the suites' load, 5.5 s in all, so the snapshot was not its main cost. I did not raise the
  bound. An event-driven wait would make it independent of scheduling, if it is still red on the next run.

**What each system has proved.**

- **Linux, real, not hosted.** WSL's Arch as above, at `1aeb8ac571`, exit 0 with a scope and exit 0 with
  none: `teamGitLauncher`, `teamLandingSnapshot`, `teamLandingChecks`, `teamLandingSurfaces`,
  `teamLandingProduct`, `teamLandingKilled`, `teamLandingPause`, `teamHostRealParts`, `teamEnginePorts`,
  `teamMergePlan`, `teamProcessWorkers`, `teamWorkerChecks`, `teamProcessLifetime`, `execTeamSweep`,
  `execTeamLedger`, `execTeamFlags`, `teamAvailability`, `acpTeamSession`, `teamCheckSlotsGoverned`: 19 files,
  156 passed, 9 skipped each way (the skips: the held-file cases, Windows-only, and worker cases that need
  a `muse` this rig does not have). That includes a real SIGKILL through the engine's port in two spellings,
  and the built bundles' run with a real kill and the CRLF landing, the same ten lines as §4. Its own
  production build at `1aeb8ac571`: exit 0, budgets as on Windows. WSL is not a hosted runner, and the distro's
  systemd scope is not what a runner has; the no-scope run is the nearer of the two.
- **macOS: nothing run by me.** It takes the same paths as Linux with no scope (a process group, and the
  created-path helper from `native/darwin/build.sh`, which the hosted test job builds), and the hosted logs
  show the same failures, which is why I expect the same cure. That is a reading, not a proof. To run it on
  the Mac mini, on this branch: `bash native/darwin/build.sh`, then
  `node node_modules/vitest/vitest.mjs run --maxWorkers=4 test/unit/teamGitLauncher.test.ts test/unit/teamLandingSnapshot.test.ts test/unit/teamLandingChecks.test.ts test/unit/teamLandingSurfaces.test.ts test/unit/teamLandingProduct.test.ts`.
- **Windows.** This PC, on the final code: below. The job proves, so landing checks stay in the shared slots.
- **Hosted, any system: nothing yet.** The next run on the joined build is the proof for all three.

**Drills, each restored byte-exact (sha256 compared), each exit 1.** Linux, no scope, `temp/wsl/drills.mjs`:

| #   | Broken on purpose                                       | Red in                                 | What it said                                               |
| --- | ------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| L1  | a landing takes the shared slots on POSIX               | checks, both                           | `The earlier attempt has not stopped`, the hosted sentence |
| L2  | a landing's own folder still asks for the proof         | checks, both                           | the same                                                   |
| L3  | a landing's own folder is left behind                   | checks, checks that pass               | `expected [ Array(1) ] to deeply equal []`                 |
| L4  | `workerOps.ts` whole, as at `8942620fe5`                | launcher, both                         | `isTeamGitError` true; not a launcher failure              |
| L5  | `teamLandingSurfaces.test.ts` whole, as at `8942620fe5` | surfaces: headless, ACP, both governed | the hosted failures, `[ 'open' ]` and `[]`                 |
| L6  | git's own exit no longer a TeamGitError                 | surfaces, still reads git's own answer | `Governed command failed` for `exitCode: 128`              |
| L7  | a failed check in a landing's own folder is ignored     | checks, a check that fails             | `status: 'merged'`                                         |

Windows, `temp/drillsw.mjs`:

| #   | Broken on purpose                                              | Red in                                        | What it said                                                                          |
| --- | -------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| W20 | `workerOps.ts` whole, as at `8942620fe5`                       | launcher, both                                | `isTeamGitError` true; not a launcher failure                                         |
| W21 | a one-use folder on Windows too                                | checks, checks that pass                      | no `check-slots` folder                                                               |
| W22 | the port ignores a check's exit, at its new place              | checks, a check that fails                    | `status: 'merged'`                                                                    |
| W23 | git's own exit no longer a TeamGitError                        | surfaces, still reads git's own answer        | `Governed command failed` for `exitCode: 128`                                         |
| W24 | `stagingCopy.ts` whole, as at `c6e1a64ef8`: a process per file | snapshot: one process, goes away, larger tree | `expected 43 to be 1`; `{ calls: 284, hashes: 174 }` for `{ calls: 124, hashes: 14 }` |
| W25 | a file that goes away stops the whole snapshot                 | snapshot, leaves out a file                   | the rejection                                                                         |
| W26 | the list hashes through the repository's filters               | snapshot, one process                         | the blob differs from git's raw one                                                   |

**Suites and gates on the final code.**

Windows, this PC, named files, `--maxWorkers=4`, each exit 0: at `794d3cd`, `teamGitLauncher`,
`teamLandingSnapshot`, `teamLandingChecks`, `teamLandingSurfaces`, `teamLandingProduct`, `teamLandingKilled`,
`teamLandingPause`, `teamHostRealParts`, `teamEnginePorts`, `teamMergePlan`, `teamMergeCardLanding`,
`acpTeamSession`: 12 files, 96 passed, 1 skipped. `teamProcessWorkers`, `teamCheckSlotsGoverned`, `execTeamSweep`,
`execTeamLedger`, `execTeamFlags`, `teamAvailability`, `acpTeamContracts`, `acpTeamServe`, `teamChunkPackaging`,
`mhpContract`, `manifest`, `pathGuardSpawns`: 12 files, 199 passed, 12 skipped. The last code commit only moved two
catches behind named guards; at `1aeb8ac571` the four suites over them ran again, exit 0, 19 passed, 1 skipped, and
W20, W23, W25, L4 and L6 went red again.

The static job's gates, one pass on `1aeb8ac571`, Node 22.23.4, exit codes: `format:check` 0, `lint` 0, `typecheck` 0, `check:badges` 0, `check:tokens` 0, `check:art` 0, `check:l10n` 0, `check:reference` 0, `check:host-api` 0, `check:mhp` 0, `check:plan` 0, `check:roadmap` 0, `check:editor-matrix` 0, `check:catches` 0, `check:usable-reply` 0, `check:wrap-up-request` 0, `check:no-output-cap` 0, `check:no-round-cap` 0, `check:workflow-scripts` 0, `deadcode` 0, `cycles` 0, `duplication` 0, `build` 0, `security:audit` 0. Semgrep, pinned, on the three
changed source files: 0 findings, exit 0. An earlier pass on `c91983d273` refused `check:catches` (the two new catches
read as generic) and `check:host-api` (the new fs import in the table); `1aeb8ac571` answered both, and the catch
baseline falls by one, the old `processTeamGit` site. The Linux build, not the Windows gates, first found the lazy
registry naming a function I had moved. After this pass only this section changed: Prettier and `check:plan`
ran on that commit, exit 0.

Budgets, none raised, none near but the one that was: `dist/resourceGovernor.js` 124.8 of 125 KiB, unchanged.
`dist/teamProcess.js` 367.9 of 375, `dist/teamLanding.js` 56.7 of 75, `dist/teamWorkerOps.js` 14.4 of 17,
`dist/teamEngine.js` 93.8 of 100, `dist/extension.js` 527.9 of 600.

The throwaway checkout, its Node and what the runs left in WSL's `/tmp` were removed afterwards.

**Commits.** `8942620fe5` → `c6e1a64ef8` (landing checks on POSIX, the swallow, the rig) → `50fd5c644b` (the
snapshot) → `794d3cd` (the lazy registry) → `c91983d273` (these corrections) → `1aeb8ac571` (what
`check:catches` and `check:host-api` asked) → the commit carrying these last lines. Not pushed.

## 11. CC-CHECKPROOF: a worker's `run_checks` on Linux and macOS (2026-11-04)

The lead's call: a worker refused its checks on two of three systems, with a false sentence, is a product
fault. M96c's rule stays: **a folder whose processes are not proved ended is never reused.** What changed is
how proof is read, and what happens where there is none. Real Linux in a fresh WSL checkout as in §10
(Arch, Linux 6.18, systemd 262, Node 22.23.4), removed after. No model call, no real `muse`.

**Reading a scope that is gone.** `--collect` removes a scope as its last process ends, and the code read the
missing file as no proof. So the longer a command ran, the surer it was to lose its proof. Now a scope counts
as seen only when the launch has read the held child's own `/proc/<pid>/cgroup` and found it inside, and read
its `cgroup.events`. A scope seen and then gone is empty, because the kernel will not remove a cgroup with a
process in it. A missing `cgroup.events` in a folder still there says nothing, nor does a hierarchy not mounted,
nor a scope never seen. One more thing showed itself: a read while the cgroup is being removed answers
`ENODEV`, which reached callers as a crash until it was read as going.

`checkProcessOver` on real processes, one after another, all on the same code path as a worker's check:

| Command                      | Samples | With a scope, before: proved | With a scope, now: proved | No scope, now: proved | No scope, now: group gone |
| ---------------------------- | ------- | ---------------------------- | ------------------------- | --------------------- | ------------------------- |
| `git --version`              | 300     | 297                          | **300**                   | 0                     | 300                       |
| `sh -c true`                 | 300     | 281                          | **300**                   | 0                     | 300                       |
| `sh -c 'sleep 0.05'`         | 200     | 2                            | **200**                   | 0                     | 200                       |
| `sh -c 'sleep 0.3'`          | 100     | 0                            | **100**                   | 0                     | 100                       |
| `sh -c 'sleep 1; echo done'` | 30      | 0                            | **30**                    | 0                     | 30                        |
| All                          | 930     | 580                          | **930**                   | 0                     | 930                       |

Every exit code was right in every run. `container` in the journal: `linuxScope` with a scope, `processGroup`
without.

**The escapee, against real processes.** A real `setsid sleep 300` left behind in the scope, 20 runs:

| What was looked at                                           | Result                                      |
| ------------------------------------------------------------ | ------------------------------------------- |
| Proof when the leader ended, escapee alive                   | false, 20 of 20                             |
| `cgroup.events` while it lived, 10 samples a run over 200 ms | `populated 1`, 200 of 200                   |
| Ended by a hand outside, then retirement                     | proved, 10 of 10                            |
| Retirement left to end it                                    | proved 10 of 10, and dead after it 10 of 10 |

So the kernel holds the scope for as long as the escapee is in it, and the lead's reasoning holds. Retirement now
reaches it: once the leader has exited there is no membership to read, so the unit, named for this launch, and the
kernel's path, the one this launch saw, are what authorize the signal. **What it cannot see:** a process that moves
itself out of the scope. `systemd-run --user --scope sleep 300` inside a check put it in `run-p<pid>-….scope`,
by `/proc`, and the launch read `proved`. No reading of this scope can know. A `setsid` does not do that, and neither
does a test server a check forgets; a program has to ask systemd to.

**Where no proof exists** (macOS, Linux with no usable user systemd). A worker's check and a landing's now share
`checkFolder()`: asked of the lifetime, the shared slots where a container proves ends, otherwise
`one-use-checks/<uuid>`, used once and removed. **The cost: setup runs every time,** with no install cache.
The verdict is the exit code. Before the permit goes back, the launch's process group is signalled (TERM, the grace,
KILL) and confirmed gone by the kernel (`kill(-pgid, 0)`, with the table for zombies nothing reaps). The leader's
identity is no longer there to check, so each member must be in this group and carry this launch's marker. Anything
else is a stranger, a reused number or a program that cleared its environment: nothing is signalled, the group is not
gone, the permit stays counted and the sentence stands. **The known limit: a process that left the group with
`setsid` goes uncounted,** and is alive after the verdict. Nothing on such a system can see it, and the suite pins
it (`cannot see a setsid escapee: the named limit`). macOS's marker read could not be tried here: if macOS will not
show a member's environment, that member reads as a stranger, which errs toward the sentence, not toward a signal.

**The sentence, caller by caller in `checkSlots.ts`.**

| Caller                         | Before                                                                           | Now                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `captureCheckSnapshot`'s `run` | every git call on two systems                                                    | only if a launch was not proved ended                                               |
| `git()`                        | the same                                                                         | the same                                                                            |
| `command()`                    | the same                                                                         | the same                                                                            |
| `copyGuard`                    | **false: nothing had run.** It guards a check pointed at the person's repository | `teamRunners.testFailed`, the class's word for a misuse, and the folder is not held |

In the shared slots "not proved" means the container says a process is still there, or, the one place the sentence
can overstate, that a launch's scope could not be seen or its file read. Neither was seen in 930 samples. In a
one-use folder it means the group is still there after SIGKILL, or holds a stranger. `routing.ts` and `sshRunner.ts`
use it for remote answers, not on this route.

**Also found: a reply named its checks by their place in the person's whole list.** `run_checks` with
`names: ['fails']` answered `passes: exit code 3`. Fixed: the bridge hands over the names it ran. No earlier suite
looked at the second check's name.

**Also found: a retirement could not reach a command that exec'd after it was recorded.** While the suites ran
together with no scope, `stops every live child on dispose` (`teamProcessLifetime`) failed once, a child alive past
its 4 s poll. The identity a signal must match is recorded 10 ms after the gate opens. Under load the shell had not
exec'd yet, and `sh -c 'a; exec b'` does so later, and from then on no signal was authorized and the child kept
running. Measured with no scope: at eight at once, 3 launches in 200 recorded the shell and all 3 were alive after
their retirement. In the first 600 launches it did not happen at all, which is why it had looked like nothing. A
retirement now reads the program the child runs now: the same pid, start, group, owner and marker are the same
process. Guard: `reaches a command that exec'd after its identity was recorded`, which needs no race to fail.

**Not fixed, for the lead: a landing costs 27 git processes per changed file.** Measured: 93 for one file, 174 for four,
390 for twelve. Each file's guard reads the repository's modes three times, whole, at five processes a read. A governed
launch is about 0.5 s on Windows, so four files take 87 to 100 s here, part of it under git's lock, and thirty files would
take about 7 minutes. **`the governed git`'s two cases hit their 180 s bound once,** when 24 files ran together on this
PC and a 1 s neighbour took 27 s; by themselves they pass at 87 and 100 s, and I did not raise the bound. So the margin
on a slow hosted Windows runner is thin. The fix is to keep the modes for one landing's guards, which touches M96c's
raw-byte check, so I left it for a decision rather than folding it in here.

**Not fixed, older than this lane: many launches at once with a scope time out.** Launches at once on real Linux with a
scope, 8 rounds each, on this code and as at `a1f27facbb`: 4 and 8 at once, all confirmed; 16 at once, 96 and 90 of 128
failed `TEAM_CONFIRMATION_TIMEOUT` at its 5 s; 24 at once, 143 and 97 of 192. Why at that number I did not find. A shared
slot's git calls run one after another, so it takes as many checks at once to reach it, and the governor's capacity sits
in front. The same table shows what this lane's retirement saved: a round of 4 went from 1,175 ms to 108 ms, because a
retirement no longer waits out the grace for a scope already empty.

**macOS is hosted CI's to prove.** These cover its path, and none of them skips there:

- `teamCheckProof.test.ts`: `reading a scope that is gone` (2), `a retirement` (1), `a bare process group` (5), `a worker's run_checks` (4),
  `the slots' refusals` (1). Only `a real Linux scope` (3) skips, because macOS has no such container.
- `teamLandingChecks.test.ts` (2) and `teamProcessLifetime.test.ts` (7).

Hosted Linux has no user scope as far as its logs show, so it takes macOS's path too, and this PC's Linux with no scope
ran the same cases. A real Linux scope has been proved only in WSL; no hosted runner has one.

**What each system has proved.**

- **Linux with a user scope, real, not hosted.** WSL's Arch at `38a160edf9`: `teamCheckProof`, `teamGitLauncher`,
  `teamLandingSnapshot`, `teamLandingChecks`, `teamLandingSurfaces`, `teamLandingProduct`, `teamLandingKilled`,
  `teamLandingPause`, `teamHostRealParts`, `teamEnginePorts`, `teamMergePlan`, `teamProcessWorkers`, `teamWorkerChecks`,
  `teamProcessLifetime`, `teamCheckSlotsGoverned`, `execTeamSweep`, `execTeamLedger`, `execTeamFlags`,
  `teamAvailability`, `acpTeamSession`: 20 files, 166 passed, 15 skipped, exit 0. The skips: `a bare process group` and
  the stranger's sentence (6, not this path), the held-file cases (2, Windows only), worker cases needing a `muse` (7).
  The table above was taken again on this code, with the same numbers. The distro's user manager had gone away between
  two runs (`/run/user/1000` removed, no session), and the product took the no-scope path without complaint; for these
  runs I started it with `systemctl start user@1000` and stopped it after, changing no setting.
- **Linux with no scope, real, not hosted.** The same files: 169 passed, 12 skipped, exit 0. The skips: `a real Linux
scope` (3, no such container), the same 2 and 7. The build and the built bundles' crash run: exit 0.
- **macOS: nothing run by me; hosted CI's.** Its path is the no-scope path above, except `scan` and the marker read,
  which go through its own Python helper there. That part has not run anywhere yet with this code.
- **Windows.** This PC. A job proves, so nothing here changed its path but the sentence and the names: `teamCheckProof`
  (6 passed, 10 skipped, the POSIX cases), `teamLandingChecks`, `teamLaunchWindows` and the team suites below.
- **Hosted, any system: nothing yet.** It runs when both lanes merge.

**Drills, each restored byte-exact (sha256 compared), each exit 1.** Linux, `temp/wsl/drillsp.mjs`:

| #        | Broken on purpose                                                           | Mode        | Red in                                                  | What it said                        |
| -------- | --------------------------------------------------------------------------- | ----------- | ------------------------------------------------------- | ----------------------------------- |
| P1       | a scope that is gone reads as no proof, as before                           | scope       | proves a command that ended by itself                   | `descendantsEnded` false            |
| P2       | a removed cgroup's `ENODEV` not read as going                               | scope       | the same                                                | `ENODEV: no such device, read`      |
| P3       | the leader's exit reads as the scope being empty                            | scope       | keeps the proof false while a setsid escapee            | `descendants` proved, escapee alive |
| P4       | retirement cannot reach the scope once the leader has exited                | scope       | ends what is in the scope at retirement                 | the child alive                     |
| P6       | a missing `cgroup.events` alone reads as ended                              | none        | reads gone only from the folder gone                    | `expected true to be false`         |
| P7       | gone is read with no hierarchy mounted                                      | none        | the same                                                | `expected true to be false`         |
| P8       | a scope counts as seen without the child in it                              | none        | counts a scope as seen                                  | a path for `undefined`              |
| P9       | a check takes the shared slots with no proof possible: **the fault itself** | none        | `run_checks` and landing checks, 6 in all               | the hosted sentence                 |
| P10      | the permit goes back with no look at the group                              | none        | says the sentence when something really has not stopped | no sentence                         |
| P11      | a folder used once stays                                                    | none        | reuses a folder only where its end is proved            | two folders left                    |
| P12      | the group looked at but never signalled                                     | none        | signals a member, signals a stubborn                    | the child alive                     |
| P13      | a stranger in the group is signalled                                        | none        | signals no stranger                                     | the stranger dead                   |
| P14      | the group reads gone on the leader's exit alone                             | none        | signals a member, signals a stubborn                    | the child alive                     |
| P15      | a reply names its checks by their place in the whole list                   | none        | answers a check that passes                             | `passes: exit code 3`               |
| P16      | `copyGuard` says the sentence, as before                                    | none        | do not say an attempt has not stopped                   | the sentence                        |
| P17      | a process group is taken to prove ends                                      | none        | `run_checks`, 3                                         | the hosted sentence                 |
| P18, P19 | a retirement trusts the program recorded at the gate                        | none, scope | reaches a command that exec'd                           | the child alive                     |

They supersede L1 to L3 and W21, which broke the same choice when it was made by platform. Windows, `temp/drillsw.mjs`:

| #   | Broken on purpose                                         | Red in                                | What it said                |
| --- | --------------------------------------------------------- | ------------------------------------- | --------------------------- |
| W27 | Windows' job taken to prove nothing                       | `run_checks`, 3                       | the sentence                |
| W28 | a reply names its checks by their place in the whole list | answers a check that passes           | the wrong name              |
| W29 | `copyGuard` says the sentence, as before                  | do not say an attempt has not stopped | the sentence                |
| W30 | a missing `cgroup.events` alone reads as ended            | reads gone only from the folder gone  | `expected true to be false` |

**Suites and gates on the final code.**

Windows, this PC, named files, `--maxWorkers=4`. At `3d700480f0`: `teamCheckProof`, `teamLandingChecks`,
`teamLandingSurfaces`, `teamLandingSnapshot`, `teamGitLauncher`, `teamLandingProduct`, `teamLandingKilled`,
`teamLandingPause`, `teamHostRealParts`, `teamEnginePorts`, `teamMergePlan`, `teamLaunchWindows`, `teamProcessWorkers`,
`teamCheckSlotsGoverned`, `teamWorkerChecks`, `teamProcessLifetime`, `teamSchedulerRecovery`, `jobHostHijack`,
`acpTeamSession`, `execTeamSweep`, `teamAvailability`, `pathGuardSpawns`, `teamChunkPackaging`, `mhpContract`: 200 passed, 35
skipped, **2 failed, exit 1**: `the governed git`'s two cases past their 180 s, named above. Those two with `teamCheckProof`,
by themselves at `65a32666d2`: exit 0, 18 passed, 9 skipped. At `38a160edf9`: `teamCheckProof` and `teamLandingChecks`, exit 0,
8 passed, 10 skipped. The commits between touch only the POSIX branch of the lifetime and a test.

The static job's gates, one pass on `145d627f56`, Node 22.23.4, exit codes: `format:check` 0, `lint` 0, `typecheck` 0, `check:badges` 0, `check:tokens` 0, `check:art` 0, `check:l10n` 0, `check:reference` 0, `check:host-api` 1, `check:mhp` 0, `check:plan` 0, `check:roadmap` 0, `check:editor-matrix` 0, `check:catches` 0, `check:usable-reply` 0, `check:wrap-up-request` 0, `check:no-output-cap` 0, `check:no-round-cap` 0, `check:workflow-scripts` 0, `deadcode` 0, `cycles` 0, `duplication` 0, `build` 0, `security:audit` 0. `check:host-api` wanted one count in its
table (`node:path`, 412 to 413, the new import); `npm run check:host-api -- --write` wrote it, and the gate re-run on the next commit
exits 0. Nothing else follows that pass but this record. Semgrep, pinned, on the seven changed source files: 0 findings,
exit 0. Budgets, none raised, none crossed: `dist/resourceGovernor.js` 124.8 of 125 KiB, unchanged, as nothing here went in
it; `dist/teamProcess.js` 370.3 of 375, from 367.9; `dist/teamRunners.js` 34.5 of 75; `dist/teamWorkerOps.js` 14.4 of 17;
`dist/teamLanding.js` 56.7 of 75; `dist/extension.js` 527.9 of 600. The checkout, its Node, what the runs left in
WSL's `/tmp` and the user manager I started are gone.

**Commits.** `a1f27facbb` → `a598ca5df4` (reading a gone scope, one-use folders for workers, the sentence, the names) → `3d700480f0`
(a catch) → `65a32666d2` (what dispose keeps) → `66b62456ca` (the retirement over an exec) → `38a160edf9` (its guard) →
`145d627f56` (the records) → the commit carrying these lines. Not pushed.

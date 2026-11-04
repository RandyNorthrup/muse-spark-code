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

**3.2 The check commands (fault 6).** `ProcessTeamPorts.runLandingChecks` runs each through
the governed check slots over the staging copy; the first non-zero exit refuses with kind
`checks`, naming the check. `teamWorkerChecks` is POSIX-only, so `teamLandingChecks.test.ts`
is the first proof of those slots on Windows: the real governor window, the real job, a real
snapshot of the merged copy, and a script that logs where it ran and what it read.

**3.3 The governed git.** `teamLandingSurfaces.test.ts` lands through `processTeamGit` under
`configureResources` with the real Windows job, as the agent process configures it. That
closes what the earlier suites left open (they inject plain git).

**3.4 One red I could not explain.** On one run of `teamLandingSurfaces`, the CRLF case failed
with `TeamGitError: git --no-replace-objects exited with code 1:` and empty stderr, from
`ls-tree` in `land`'s snapshot after the writes (`temp/out/w8.log` of that run). It did not
come back: not on that case alone, not on the whole file with the runner's catch logged to
a file (it logged nothing), and not on any run since, the drills' included. **Cause not
settled.** `processTeamGit` turns any failure without a numeric code into exit 1, so a real
exit, a child killed with a null code and a fork stop or launch refusal all read the same
(inferred from the code; the logs do not show which). A landing that meets it stops safely,
per M96c: the record stays open under its lock for Recover. If hosted CI shows it, that runner's
catch is the place to look. `isGovernedRefusal` exists and the runner still checks a narrower
list; I left that alone, since nothing here shows it was the cause.

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

## 6. What hosted CI must prove

Windows, macOS and Linux on the joined build: `teamLandingProduct`, `teamLandingSurfaces`,
`teamLandingChecks`, `teamLandingKilled`, `teamLandingPause`, `teamHostRealParts`,
`acpTeamSession`. Only the held-file and short-name cases are Windows-only. The real crash
and the CRLF landing were run only here. M96c's three-platform box stays open until a hosted run
on the joined build is green. On a POSIX runner the CRLF cases are the same code over the same
bytes, set by the fixture's own `core.autocrlf`; the staging clone there does not inherit it, and
needs not to, since the copy never converts.

## 7. Red/green drills (`temp/drillsw.mjs`, narrowed to the guarding cases, `--maxWorkers=4`)

Each: an exact edit, the named file with a name filter, the exit code, the file written back and
its digest compared. All 19 exit 1, all restored.

| #   | Broken on purpose                                               | Red in                                             | What it said                                              |
| --- | --------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| W1  | `teamEnginePorts.ts` whole, as at `f572397f23`: merges in place | product, plans and lands                           | `expected [] to deeply equal [ 'landed' ]`: no record     |
| W2  | a team host starts without settling                             | product, a team host settles                       | `expected 'after\n' to be 'before\n'`                     |
| W3  | a landing does not settle first                                 | product, settles first                             | `status: 'rework'` for `merged`                           |
| W4  | a stopped batch closes `landed`                                 | product, does not pass as landed                   | the record's status                                       |
| W5  | `changed` mapped to merged                                      | product, does not pass as landed                   | `expected 'merged' to be 'rework'`                        |
| W6  | Undo tries the file the batch never reached                     | product, does not pass as landed                   | `kept` holds `d.txt`                                      |
| W7  | a held file does not roll back at once                          | killed, a held file                                | `EPERM ... rename` reaches the caller, with the lock left |
| W8  | the port reads the workspace as spelled                         | product, `link` red, `shortName` green (§2 item 3) | linked root                                               |
| W9  | the card has no Undo Merge                                      | card, names what changed                           | no such button                                            |
| W10 | Traffic has no `undoBatch`                                      | real parts, the card names it                      | `expected [ 'landNow' ] to include 'undoBatch'`           |
| W11 | no look at unsaved files before the first write                 | product, stops a landing whole                     | `expected 'after\n' to be 'before\n'`                     |
| W12 | a failed check treated as passed                                | product, a check that fails                        | `status: 'merged'`                                        |
| W13 | the port ignores a check's exit                                 | checks, a check that fails                         | `status: 'merged'`                                        |
| W14 | a headless run does not settle                                  | surfaces, a headless run                           | `[ 'open' ]` for `[ 'recovered' ]`                        |
| W15 | a headless run journals in its run's folder                     | surfaces, a headless run                           | `[ 'open' ]` for `[ 'recovered' ]`                        |
| W16 | an ACP session never asks at its turn                           | surfaces, an ACP session                           | `[]` for `[ [ 'Recover', 'Keep' ] ]`                      |
| W17 | an ACP session asks every turn                                  | surfaces, an ACP session                           | asked twice                                               |
| W18 | the raw-byte comparison back: `isCrlf` false                    | surfaces, line endings (7 cases), governed CRLF    | `Conflicts need the task copy`; `status: 'rework'`        |
| W19 | mixed line endings read as a CRLF checkout                      | surfaces, refuses rather than rewrites             | `promise resolved ... instead of rejecting`               |

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

@@GATES@@

## 9. Commits

`f572397f23` → `3b19d8bb9c` (the checked landing, recovery at start, the refusal kinds, Undo Merge,
the held file, the spelling, the check commands, PLAN's sentence, words) → `10c579c724` (settles
first, stops before writing, the check commands in a real slot) → `ef3ffadfba` (the CRLF checkout,
the ACP turn, the surfaces suite) → `f24f37bfd0` (what typecheck and duplication asked of the
suites) → the commit carrying this record, the card's harness scene and the index line.

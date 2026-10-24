# cc/rlm116 — RLM116's own work re-landed on int/recovery's team core

Branch `cc/rlm116`, worktree `mx-cc-rlm116`, base int/recovery
`9fc689af83`. Source: lane RLM116 (`refs/rigs/linuxlt/rec/rlm116`, head
`4fbee53705`), whose own merge of RLM96 (`1abea8ad7c`, 196 files) collided
with int's RLM96/RLM96B/RLM120 team core. The lead's answers to its three
questions (`muse-fleet/lead/codex/RLM116-answers.md`) bind this port.

## What was ported, and how

RLM116's first-parent history: `9244225a4e` (its merge of MSM116, the
VS Code panel playbook end to end), `1abea8ad7c` (its RLM96 merge), two
commits reconciling that merge (`f78d4d9f20`, `2df009f3a3`), then its own
lane commits.

| RLM116 commit(s)                                                     | Here                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `9244225a4e` (MSM116 landing)                                        | merged as `bf0015ba21`: int never had it, and every lane commit builds on it (panelLanes, the window bundle, `SubagentAdmission`)                            |
| `1abea8ad7c`, `f78d4d9f20`/`2df009f3a3` team parts                   | not brought in: int holds the team core; only their playbook fallout (lint, metafile name, lazy registry, usable-reply allowance) is in the merge commit     |
| `4c129bc0b0`, `eed2c5bd62` (D212)                                    | `ccd92e4897` (D218), redesigned: see below                                                                                                                   |
| `4acb0f9305` (D213)                                                  | `ffa792231e` (D219), plus `e1d4feb6a5` (the composer answer RLM116's change broke)                                                                           |
| `0dc76b0de8`                                                         | `7eb74613d9`, playbook parts only (its team-host harness drove the service through hand-written ports, which int removed as fakes)                           |
| `0e1f188a6e`, `c2082f9c1c`, `7ebb245605`, `710a440bd9`, `9ce3affd97` | `cac8ad6a02` (D220)                                                                                                                                          |
| `30f1c1f239`, `9d0c172b74` playbook/ACP parts                        | `33f3e2c796` (D221)                                                                                                                                          |
| `f5fd0d4135`, `4fbee53705`, `2b28cd723b`, `33bb9825ca` (records)     | this record and PLAN.md §2 D218-D221; its `rlm116.md` is not carried (it describes the RLM96 merge)                                                          |
| (follow-ups on this branch)                                          | `858875c31d` (the plan archive), `d1fd3f1097` (reporting-panel bytes, NARROW/REPORTED catches), `9dc2a1e37a` (stale `@unwired` tag), and this records commit |

Decisions renumbered: RLM116's D212, D213, D214, D215 are D218, D219,
D220, D221 (int uses D212-D217; D218-D221 were free everywhere in the
tree). Every reference on lines this branch adds was renumbered by
a one-off script over `git diff -U0` (added lines only, so int's own D212-D215 stay).

### D218: the team runner's board and rounds

RLM116 built the team integration on the extension host and called the
synchronous policy there. Two things could not stand on int:

- **Windows refused every governed team task.** The policy spawns git, and
  on Windows every git child needs `PlaybookHookAdmission.runContained`
  (§9 FIXM116P3); the extension host has no contained job, so
  `renamedFiles` threw "unavailable" (seen here first, on this Windows PC,
  in `teamPlaybookIntegration`: 2 failed). On POSIX it blocked the host
  for every git call of a start.
- **Fix:** the rounds run on the window's playbook worker, beside the panel
  governor: `teamStart`/`teamRelease` in the validated worker protocol, the
  worker's own hook admission and contained job, the team host's facts
  sent with each start, CI and the latest governor reading added by the
  window (`teamPlaybookRounds`). The team host keeps only the call sites.
- The dispatch-base read moved beside the service (the engine lends its
  governed git; `dispatchHeadReader`), so `dist/teamEngine.js` stays inside
  its budget (it went 102,262 to 103,222 bytes, over 100 KiB, before).
- The two refusal sentences are `TEAM_PLAYBOOK_MODEL_TEXT`, read by
  `dist/teamHost.js` alone and guarded in `check-bundle-split.mjs`; the
  brief is checked on the worker beside the policy that records it.
- `pick`/`merge` stay with the merge planner binding (RLF-TEAMWIRE), as in
  RLM116.

### D219: host capacity admission and `playbook run`

- The headless run and the ACP resume read the process's own governor
  facade (`processResources.status()` / `resources.status()`), int's one
  governor per process, instead of `loadResourceWindow()`.
- **Windows exit codes.** The packed run of `fails` (a check that exits 3)
  exited 1 here: Windows PowerShell reports 1 for any failed native
  command. A trailer reads `$?` first, then `$LASTEXITCODE`. Probed on
  Windows PowerShell 5.1 (this PC, 2026-10-23):
  `node -e "process.exit(3)"; $c=$LASTEXITCODE; $ok=$?` gives `ok=True code=3`
  (an assignment resets `$?`), while `$ok=$?; $c=$LASTEXITCODE` gives
  `ok=False code=3`.
- `stripJsonc` moved to `src/core/jsonc.ts` (RLM116's move); int's
  keybindings report input reads it there.
- RLM116's guard change made `isPlaybookBundle` require
  `runPlaybookCheckCli`, so the VS Code composer's `/playbook` answer (served
  by the window's bundle, which has no headless run) always answered
  "unavailable"; RLM116 left `playbookWindowBundle`'s two failures. The
  answer now checks `isPlaybookAnswerSlice` (`e1d4feb6a5`).

### D220: one report ordering

- The ordering is a thunk on the reporting context, asked for only when
  the playbook, milestone or fleet kind orders (RLM116 loaded the inputs
  bundle with every engine); the engine logs the note through its context
  log.
- The merged residual section is rebuilt by the one section builder
  (canonical order, dedupe, the row limit, prior omitted rows counted);
  RLM116 appended rows past it. Within a bucket rows keep the canonical key
  order the finalizer imposes (`render/canonical.ts` sorts rows by key), so
  the collector suite's expectation follows the finalizer.
- int's row-source coverage gate (`collect.rowSources`) binds the new
  residual row: its case runs the probe with the real journal orderer over
  a real journal.

### D221: ACP child resumes

Ported as written, reading the serve process's governor facade; the
refusal sentence is `playbookResumePaused` (the playbook English region).

## Bundles (production build on this PC, against the base built the same way)

The base already has 12 bundles over budget. Byte deltas against the base
build for every over-budget bundle this branch touches:

| Bundle                                     | Base    | Final   | Delta | Note                                                                                                                              |
| ------------------------------------------ | ------- | ------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| `dist/uiText.js`                           | 131,681 | 130,771 | -910  | the playbook's English joined the optional surfaces region (`uiTextRegions.mjs`)                                                  |
| `dist/reportingPanel.js`                   | 52,619  | 52,597  | -22   | the CI observer rides the deps spread; one reader thunk orders and reads                                                          |
| `dist/modelApiBoundaries.js`               | 56,625  | 56,625  | 0     | `pathIdentity.isMissing` stays unexported                                                                                         |
| `dist/estimateContracts.js` and seven more | —       | —       | 0     | the two job constants are droppable plain strings (a module-level `String.raw` kept 72 bytes in every bundle importing constants) |
| `dist/wire.js`                             | 81,096  | 81,194  | +98   | MSM116's `openPlaybook` actions and the playbook envelope (one shared schema)                                                     |
| `dist/modelApi.js`                         | 588,827 | 589,250 | +423  | MSM116's Model API admission (`throughPlaybook`)                                                                                  |

`dist/wire.js` and `dist/modelApi.js` grow by MSM116's own feature code
(left, recorded as a justified deferral in PLAN.md §7). Every other bundle stays inside its budget:
`dist/playbook.js` 148,231 of 153,600, `dist/acpPlaybook.js`
91,367 of 102,400, `dist/teamHost.js` 113,277 of 133,120,
`dist/teamEngine.js` 102,274 of 102,400, `dist/uiTextSurfaces.js`
15,618 of 25,600.

## Red/green drills

Each break applied by a one-off drill script, the suite run red, the file
restored byte-exact (checked) and the suite run green:

| Drill  | Break                                                        | Red (exit: result)                       | Restored byte-exact          | Green (exit: result)                      |
| ------ | ------------------------------------------------------------ | ---------------------------------------- | ---------------------------- | ----------------------------------------- |
| D218-1 | board workers ignore admission (available = idle only)       | 1: files 1 failed (1); tests 1 failed    | 8 passed (9                  | true                                      | 0: files 1 passed (1); tests 9 passed (9)     |
| D218-2 | worker answers started without starting the round            | 1: files 1 failed (1); tests 1 failed (1 | true                         | 0: files 1 passed (1); tests 1 passed (1) |
| D218-3 | team adapter rethrows the policy refusal                     | 1: files 1 failed (1); tests 1 failed (1 | true                         | 0: files 1 passed (1); tests 1 passed (1) |
| D218-4 | dispatch-base port reads a missing repository as the cwd     | 1: files 1 failed (1); tests 1 failed    | 4 passed (5                  | true                                      | 0: files 1 passed (1); tests 5 passed (5)     |
| D219-1 | capacity admission pauses local checks on an unknown reading | 1: files 1 failed (1); tests 1 failed    | 9 passed (10                 | true                                      | 0: files 1 passed (1); tests 10 passed (10)   |
| D218-5 | engine reports CI for a generation that never read github    | 1: files 1 failed (1); tests 1 failed    | 2 passed (3                  | true                                      | 0: files 1 passed (1); tests 3 passed (3)     |
| D219-2 | headless run spawns the check after a refusal                | 1: files 1 failed (1); tests 1 failed    | 13 passed (14                | true                                      | 0: files 1 passed (1); tests 14 passed (14)   |
| D219-3 | Windows check loses its own exit code (no trailer)           | 1: files 1 failed (1); tests 1 failed    | 4 passed (5                  | true                                      | 0: files 1 passed (1); tests 5 passed (5)     |
| D219-4 | bundle loader accepts an entry without runPlaybookCheckCli   | 1: files 1 failed (1); tests 1 failed (1 | true                         | 0: files 1 passed (1); tests 1 passed (1) |
| D220-1 | shared comparator ranks failures above the person's items    | 1: files 1 failed (1); tests 3 failed    | 10 passed (13                | true                                      | 0: files 1 passed (1); tests 13 passed (13)   |
| D220-2 | journal orderer sorts with loudFailures turned off           | 1: files 1 failed                        | 1 passed (2); tests 1 failed | 25 passed (26                             | true                                          | 0: files 2 passed (2); tests 26 passed (26) |
| D220-3 | merged residual rows bypass the one section builder          | 1: files 1 failed (1); tests 1 failed    | 153 passed (154              | true                                      | 0: files 1 passed (1); tests 154 passed (154) |
| D220-4 | collector leaves milestone rows in their own order           | 1: files 1 failed (1); tests 2 failed    | 11 passed (13                | true                                      | 0: files 1 passed (1); tests 13 passed (13)   |
| D219-5 | composer answer demands the CLI-only headless run export     | 1: files 1 failed (1); tests 2 failed    | 8 passed                     | 1 skipped (11                             | true                                          | 0: files 1 passed (1); tests 10 passed      | 1 skipped (11) |
| D221-1 | ACP resume admission pauses on an unknown reading            | 1: files 1 failed (1); tests 2 failed    | 6 passed (8                  | true                                      | 0: files 1 passed (1); tests 8 passed (8)     |
| D221-2 | ACP resume admission decides on a stale reading (no refresh) | 1: files 1 failed (1); tests 2 failed    | 6 passed (8                  | true                                      | 0: files 1 passed (1); tests 8 passed (8)     |

## Packed product, used for real (this PC, Windows 11, 2026-10-24)

`node dist/acp.js` from the production build, in an empty workspace
(`temp/packed/ws`) whose `.vscode/settings.json` (JSONC, with comments and
trailing commas) names two checks, with `LOCALAPPDATA`/`USERPROFILE`/`HOME`
pointed at empty folders under `temp/packed`. No model and no network.

```text
$ muse-spark-code-acp playbook run wins
check ran
wins passed
Playbook: no worker is offered; run locally under the resource governor. · Oct 24, 2026, 12:16 AM
[exit 0]

$ muse-spark-code-acp playbook run fails
fails failed
Playbook: no worker is offered; run locally under the resource governor. · Oct 24, 2026, 12:16 AM

Playbook: no worker is offered; run locally under the resource governor. · Oct 24, 2026, 12:16 AM
[exit 3]

$ muse-spark-code-acp playbook run nope
Unknown check nope (known checks: wins, fails).
[exit 2]

$ muse-spark-code-acp playbook run
Use `playbook status|record|settings|run <name> [--heavy] [--full-gate]`.
[exit 2]

$ muse-spark-code-acp report playbook --format text
Engineering Playbook

Scope:
Generated as of 2026-10-24T07:16:23.626Z
Version: 0.19.0
SHA-256: 7788c6eb769adbca8df99ea54b93914df588c3a23e822c3f9dd35c73e23273a0

Needs You


Decisions


Disabled Rules


Hook verification


Refusals


Totals
(the source rows follow; exit 0)
```

`fails` exits with its check's own 3; the same run before the trailer
exited 1 (PowerShell's). `report playbook` orders its sections through the
journal reader (D220); this journal holds only the two runs' notes.

## Unproven by a unit suite, with the reason

- The team host's call sites (`startPlaybookWork`/`releasePlaybookWork` in
  `teamHost.ts`): reaching them needs a delegate with staffed entries,
  which only hand-written worker ports or a model worker can drive; int
  removed the hand-ported team service suites as fakes (RLINTFIX item 5).
  The rounds they call are proven end to end in `teamPlaybookRounds` (the
  real window over its real worker code, journal and git) and the
  integration in `teamPlaybookIntegration`.
- The ACP agent's `/agents continue|retry` call site: RLM116's suite drove
  `createAcpAgent` over a scripted `AgentHost`/`AgentSession`; int's ACP
  suites replay recorded captures, and none records a subagent control.
  The admission itself is proven in `acpSubagentAdmission`. A live session
  with a child needs a paid model run (the owner's).
- MSM116's README and roadmap claims for the VS Code panel came with its
  landing; its real-life steps for the lead stand in `msm116.md`.

## Catch sites

`check:catches` reports exactly what the base reports (its failures are
other lanes' sites). The dispatch-base port's catch is NARROW (fixed
refusal words, no git error text to the model). The ACP agent's `/agents`
control handler, accepted as GENERIC at the base, changed identity when
the admission wrapped its `try`; it now records the failure's kind through
`failureForLog` and is REPORTED, and `scripts/catch-baseline.json` is
lowered for exactly that site (acp GENERIC 18 to 17).

## Found outside this lane's areas (not changed here)

`shellDirectoryTrailer` (`src/core/backends/modelapi/tools.ts`) reads
`$LASTEXITCODE` and then `$?` on Windows; by the probe above `$?` is then
always true, so the trailer exits 0 after a failed native command. Reading
`$?` first (the same bytes, reordered) is the fix; it belongs to the Model
API shell tool's owners.

## Gates on the final tree

Run on Windows 11 (this PC) with `TMP`/`TEMP` and `GIT_CEILING_DIRECTORIES`
under the worktree's `temp/`. "The base" is int/recovery `9fc689af83`
extracted under `temp/base` and run the same way.

| Gate                                                                                     | Exit      | Note                                                                                                                              |
| ---------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check` (prettier)                                                        | 0         |                                                                                                                                   |
| `npm run lint:js:main` / `lint:js:unit` / `lint:js:tests` (eslint)                       | 0 / 0 / 0 |                                                                                                                                   |
| `npm run typecheck` (six projects)                                                       | 0         |                                                                                                                                   |
| `npm run check:plan`                                                                     | 0         | PLAN.md 3,562,633 bytes, under the 3,565,158 gate                                                                                 |
| `npm run check:catches`                                                                  | 1         | the base exits 1 with the same report, line for line (other lanes' sites)                                                         |
| `npm run duplication`                                                                    | 1         | the base exits 1 with the same 41 clones; none new                                                                                |
| `npm run deadcode` (knip)                                                                | 0         |                                                                                                                                   |
| `npm run cycles`                                                                         | 0         |                                                                                                                                   |
| `check:l10n`, `check:reference`, `check:host-api`, `check:roadmap`, `check:usable-reply` | 0 each    |                                                                                                                                   |
| `npm run build` (size)                                                                   | 1         | the base exits 1 on the same 12 over-budget bundles; see Bundles                                                                  |
| bundle split / lazy registry                                                             | 1 / 1     | the base's own 3 split problems and 7 registry problems, unchanged                                                                |
| team, playbook and touched suites (104 files)                                            | 1         | 1,849 passed, 9 skipped, 1 failed: `teamModelsFirstPaint` surface English 25,840 of 25,600 bytes, failing identically on the base |

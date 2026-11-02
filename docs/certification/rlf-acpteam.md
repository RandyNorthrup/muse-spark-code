# RLF-ACPTEAM — The team in the ACP agent's own sessions (M96b)

Branch `rec/rlf-acpteam`, worktree on `linuxlt`, base `0a5ebd7189`
(int/recovery). Built 2026-10-30, resumed and finished 2026-11-01/02
after the weekly allowance stopped the first run. The brief: build
M96b's ACP rows on int's team core — `teamSessionAdmission` gets its
production caller, the stored team is offered in ACP sessions behind
`serve --team`, a Muse Code orchestrator gets the `team` MCP endpoint
in its session start, workers' progress, waiting and merge cards ride
ACP updates and permission requests, and cancel/close stop the team.

Live model calls made by this lane: **0 generation requests** (the
real run stopped before any prompt; §4 counts the records).

## 1. What landed

- **Core additions (`3d0bc7e8f`).** One stored-team reader
  (`src/runtime/teamSnapshotFile.ts`) shared by headless `exec --team`
  and the ACP agent (the exec entry's private copy is gone);
  `taskDiffFiles`, the whole-file diff read the merge card carries;
  `stopSessionTasks(sessionId)`, the per-session stop on
  `TeamHostBinding`/`TeamHostService` (written for RLF-ORCHEXT's
  external orchestrators to share).
- **The ACP team (`f54db1df5`, `8f4913c06`).** `serve --team` loads
  `dist/acpTeam.js` (55.6 KiB measured, budget 75 KiB = measured +15%
  to the next 25 KiB, D6) and nothing when the flag is absent.
  `session/new` runs `teamSessionAdmission` over the stored team
  (D227): no stored team, or only the session's own model, refuses in
  words instead of running on single-model. One `WorkspaceTeam` per
  folder holds one `TeamHostBinding` over the same snapshot file
  headless runs read, repository lowering included. A Model API
  orchestrator takes the binding's seams per folder
  (`RuntimeBackendDeps.teamFor`); a Muse Code orchestrator's session
  start carries `TeamHostBinding.teamMcp`'s endpoint, per conversation
  token as in the panel. Workers are engine conversations in their own
  copies either way (`canRunKind` is engine-only here; §5). The tree
  rides the `plan`, each task is one tool call (report as content,
  whole-file diffs as `diff` content), waiting and merge cards are the
  editor's permission requests (Bypass shows the merge as a completed
  call), the paid question is D62's per `delegate`, the team state is
  a fixed-at-start **Team** config option, and `session/cancel` and
  close call `stopSessionTasks`. New sentences are in English and all
  14 tables; `docs/acp.md` gained "Teams in ACP sessions".
- **Suites (`9fb2f14f7`, `f0b1fb7fe`, plus the resume's
  `a709caf5d`, `aa582b9af`, `47d26d592`).**
  `test/unit/acpTeamSession.test.ts` drives the real ACP agent, the
  real Model API host, the real team host and real git;
  `test/unit/acpTeamServe.test.ts` drives the staged agent process
  over real stdio. No stand-ins: worker starts a suite must hold are
  held by the test's own deferred at the team's `startWorker` port,
  and a start that cannot complete is the worker's real failure. The
  resume deduplicated the two suites' rigs into
  `createLocalAcpAgent`/`admissionCase` (the duplication gate's one
  clone), moved the first admitted session's cold start into a
  `beforeAll`, and gave the serve suite named timeouts for its real
  process spawns (`STAGE_BUNDLES_TIMEOUT_MS`,
  `SERVED_SESSION_TIMEOUT_MS`, measured ≈7.3 s a case on this rig at
  load 11–17; the exploratory raised-timeout measurement is the only
  raised-timeout run, and the final runs below use the repository's
  own timeouts plus those named in-file ones).

## 2. Red/green drills (2026-11-02, this rig)

Each break was made, the suite run, the file restored from a copy,
and `git status` verified clean. Greens are the full-file runs at the
end (8 passed, exit 0, twice).

| #   | Guard                       | Break                                                          | Red (exit 1)                                                                                        |
| --- | --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | No team without two models  | `prepareNew`: both refusal throws became `void`                | Session opened; refusal `undefined` (assertion)                                                     |
| 2   | Endpoint refused to others  | `teamMcpServer.bindingOf`: any non-empty token accepted        | Forged token answered 200, expected 401                                                             |
| 3   | Cancel reaches every worker | `WorkspaceTeam.cancel` became a no-op                          | `timed out waiting for the emptied plan` (only that case of 8 failed)                               |
| 4   | No merge without approval   | Merge answer comparison inverted (`!== MERGE_OPTION`)          | Refusal landed the change (`'const value = 2'` for `'const value = 1'`); approval case inverted too |
| 5   | No mid-session team switch  | `agent.setConfigOption`: fixed-for-session throw became `void` | Switch accepted; refusal `undefined` (assertion)                                                    |

A single-case (`-t`) green for drill 2 timed out cold at 5,354 ms
under load 13–17; the same case passes in every full-file run
(371–434 ms warm). Recorded as rig load, not hidden.

## 3. Gates (exit codes, 2026-11-01/02)

| Gate                                                                                    | Exit     |
| --------------------------------------------------------------------------------------- | -------- |
| `prettier --check` on all 56 touched files                                              | 0        |
| `eslint --max-warnings 0` on the 33 touched code files                                  | 0        |
| `npm run typecheck`                                                                     | 0        |
| `node scripts/check-l10n.mjs` (14 + 14 tables, 0 problems)                              | 0        |
| `npm run check:reference`                                                               | 0        |
| `npm run check:host-api` (0 problems)                                                   | 0        |
| `npm run check:plan` (244 milestones, 0 drift)                                          | 0        |
| `npm run check:roadmap` (after `37af3397b`, §3.1)                                       | 0        |
| `npm run check:catches` (baseline unchanged)                                            | 0        |
| `npm run duplication` (0 clones, after `aa582b9af`)                                     | 0        |
| `npm run cycles`                                                                        | 0        |
| `npm run deadcode`                                                                      | 0        |
| `npm run build`                                                                         | 1 (§3.2) |
| Lane suites, final: `acpTeamSession` + `acpTeamServe` + `acpSessionRegistry` (12 tests) | 0        |
| `npx vitest related …` (§3.1)                                                           | 1        |

### 3.1 Related run and classification

`npx vitest related <21 changed src files> --run --maxWorkers=3`,
excluding `src/shared/constants.ts` and `src/shared/l10n/en.ts` per
CC-INT5 §5's scoping (their closure is the whole battery; an unscoped
run was started first and stopped at 114 files in ~50 minutes). Result:
65 files, 892 tests — 7 files failed, 6 tests failed, 864 passed,
1,455 s at load 13–20.

- `cx1r2Truth` — **this lane, fixed.** The M96b roadmap summary's
  "is still in progress" missed the dormant-work form the suite
  requires; `37af3397b` says "is in progress" and the suite passes.
- `teamMcpWiring`, `judgeHookCliProcess` — 5 s timeouts in the sweep;
  pass alone here (exit 0). Rig load.
- `acpTeamServe` — hook/test timeouts in the sweep; it is this lane's
  suite, so it got the named in-file timeouts of §1 and passes alone
  and in the final three-file run (exit 0).
- `judgeCliDispatch`, `runtimePanelGit` — one 5 s timeout each, in
  the sweep and alone. The untouched-base comparison worktree's own
  global setup died first (`spawnSync … scripts/build.mjs
ETIMEDOUT`), so the base verdict is unmeasured beyond "the same
  load breaks untouched setup"; neither suite's failure kind is an
  assertion. Recorded, not classified away.
- `packagedBundles` — its 210 s hook timed out alone under the same
  load (CC-INT5 ran it green alone in 116 s on a quieter rig).

### 3.2 Build budgets: red at the base, unchanged in kind

`npm run build` exits 1 on four OVER lines. The untouched base
`0a5ebd7189`, built the same way in a scratch worktree, prints the
same four: `teamRunners` 78.4/75 KiB (identical), `teamHost`
140.2/130 (this lane 140.5, +0.3 for `stopSessionTasks`),
`teamScheduler` 76.5/75 (identical), `uiText` 125.3/125 (this lane
125.5, +0.2 for the new sentences). No budget was raised; the lane's
own bundle is inside its budget (`dist/acpTeam.js` 55.6/75). Shrinking
`teamHost` is RLF-TEAMFIT's brief.

## 4. The real run: stopped before any model call

Recipe as briefed: the packed `dist/acp.js --team` in an empty git
workspace (`temp/real-run/ws`, one empty base commit) with a fresh
data home, driven over stdio by a real ACP client
(`temp/real-run/drive.mjs`), the stored team naming one worker on
`muse-wonder-full-1.0-contributor`, the orchestrator to be set to
`muse-spark-1.3-contributor` before any prompt. **Expected requests,
stated first: at most 12.**

Three shapes were tried; each stopped at `session/new`, before a
prompt existed:

1. `--backend museCode`, worker as an **engine** entry:
   `RUN FAILED: Invalid request: Agent teams need a second model: set
up another model to turn them on.` The agent also printed
   `the operating system's credential store could not be read, so no
Model API key is available (StoreUnavailableError)` — engine
   workers run on the Model API host beside the orchestrator, and
   this sandbox has no credential store and no stored key, so the
   entry probes as not runnable (inferred from
   `listTeamWorkerModels` → `modelApiHostFor`; the refusal sentence
   itself is observed).
2. `--backend museCode`, worker as a **museCode** entry: the same
   refusal, by the documented design — only engine entries count
   (`candidates()`; `docs/acp.md` says so). §5 records the plan gap.
3. `--backend modelApi --subscription` (no `--team`, probe only):
   `RUN FAILED: That did not work (the Muse Spark log has the
details)` with `ACP session/new failed: ModelApiError` — the
   subscription driver has no sign-in token in the fresh Muse home
   this sandbox gives it, so even a teamless session cannot start.

Counted afterwards: the Muse home (`temp/real-run/data/muse`) holds
exactly one session record — the no-team probe's `session/new` +
`session/close`, 12 lines, no prompt — and the workspace still holds
only `.git`. **Generation requests: 0 of the stated ≤12.** No prompt
was ever sent, so no unknown-tier model was ever called (the default
`muse-wonder-1.0` a new session starts on was observed in the probe's
config options only).

**Outside-sandbox recipe (the lead's run).** On a machine whose OS
credential store works: store the Model API key (`muse-spark-code-acp
auth set`), or sign in to Muse Code in the same Muse home the agent
uses and pass `--backend modelApi --subscription`. Keep the stored
team's worker as an engine entry on `muse-wonder-full-1.0-contributor`
with `--allow-contributor-models`, run
`node temp/real-run/drive.mjs` (it writes `team.json`, spawns
`dist/acp.js --team --backend museCode --allow-contributor-models
--trust-workspace`, sets the session model to
`muse-spark-1.3-contributor` before prompting, and answers Merge),
then count attempts in the Muse session records under the run's
Muse home. Expected: at most 12 requests; `hello.txt` and
`world.txt` landed on `main` by two merges.

## 5. What remains

- **Muse Code and external workers in ACP sessions.** PLAN M96b says
  they "run as in the panel"; this lane ships engine workers only
  (`canRunKind: kind === 'engine'`, candidates likewise) and
  `docs/acp.md` says exactly that. Dispatching museCode/external
  entries needs their worker starters in the runtime (today
  `startTeamWorker` opens engine sessions only) — a follow-up lane,
  not a silent claim here.
- **The live contributor run** is unproven for the sandbox reason in
  §4; the recipe is recorded there. Until it passes, the CHANGELOG and
  README claims stay at what the suites prove.
- **Build budgets** (§3.2) were red at the base and stay red;
  RLF-TEAMFIT owns the shrink.
- Headless `exec --team` keeps its M80 state (its live receipts are
  that lane's); this lane changed only its stored-team reader, now
  the shared one.

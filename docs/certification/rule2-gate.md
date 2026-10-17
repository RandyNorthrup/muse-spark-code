# Rule 2 gate: nothing is started again on the same commit

AGENTS.md rule 2: hosted CI is the gate for a release, every job green on the
commit that merges, and a red job is read and its cause measured, never rerun
into green. Until this change nothing mechanical held it. GitHub shows a job's
latest attempt, so a pull request whose CI run was red on attempt 1 and green on
attempt 2 looked green and could merge. Also, the 0.18.2 tag was published
while the Hosts run on the released commit was red
(`docs/certification/release-0182.md`).

`scripts/rule2-gate.mjs` holds the rule at its two doors:

- **Merge** (`build.yml`, job "first attempt, every run green (rule 2)"). The
  job needs every other job, so starting any of them again starts it again. It
  refuses an attempt after the run's first execution and names the jobs and
  steps of the earlier attempt that were not green. It also refuses unless
  every other run of this repository's workflows on the same head is complete
  and green on its own first execution. A run still in progress is waited for,
  and after that wait the gate reads the head once more immediately before
  passing: a run started after the judged set was read refuses, and is
  answered by a new commit like any other start after the first.
  The five required names fail unless that job succeeded and judged this very
  attempt. A job re-run on its own reuses the earlier attempt's result of the
  gate job, and that result names the earlier attempt.
- **Release** (`release.yml`, first job). It reads every run on the tagged
  commit and on the head of the pull request that merged as it. It stops the
  release unless each is complete and green on its first execution, and each
  expected commit needs runs of its own: one with no run left refuses even
  when the others have runs.

## What happened before the gate

These pull requests merged on a head whose CI run was green only on a later
attempt, after a red job in attempt 1. The source is a read of all 885 workflow
runs of this repository on 2026-10-12.

| PR  | what                        | head      | CI run      | red in attempt 1                                                         |
| --- | --------------------------- | --------- | ----------- | ------------------------------------------------------------------------ |
| 153 | Release 0.18.2              | d243e0771 | 38311021688 | tests (macos-latest, shard 6)                                            |
| 149 | Release 0.18.0              | c4397d603 | 38202980645 | tests (ubuntu-latest, shard 1)                                           |
| 147 | Release 0.17.1              | 741bc3393 | 38175569846 | tests (windows-latest, shard 3); tests (macos-latest, shard 1) cancelled |
| 140 | Release 0.16.0              | c2e0932aa | 37732929826 | tests (windows-latest, shard 4)                                          |
| 137 | docs, gotchas G30-G46       | 0e937811c | 37687889200 | tests (windows-latest, shard 4)                                          |
| 130 | docs, gotchas register      | 5fcb5e060 | 37550864380 | tests (windows-latest, shard 3)                                          |
| 122 | Release 0.14.0              | 6baacdb77 | 37388689074 | tests (macos-latest, shard 2)                                            |
| 115 | accessibility gate          | d6823cfc8 | 37257904865 | tests (windows-latest, shard 4)                                          |
| 110 | CI: sharded gate            | badcb8f50 | 37232319487 | tests (ubuntu-latest, shard 2)                                           |
| 105 | Dependabot, production deps | fce298cfb | 37241136040 | tests (macos-latest, shard 2)                                            |
| 99  | record of 0.11.0            | e616ff38f | 37183337020 | quality (macos-latest), `npm run quality:gates`                          |
| 84  | M74 follow-ups              | 7eb2ef68c | 37145436781 | quality (macos-latest), same step                                        |
| 83  | audit exception (braces)    | 110d84a3c | 37089032539 | quality (macos-latest), same step                                        |
| 81  | M73 follow-ups              | 92d987e79 | 37103214701 | quality (macos-latest), same step                                        |
| 66  | npm publish path            | 93554066d | 36952688827 | quality (macos-latest), same step; three attempts                        |
| 64  | html-encoding-sniffer 7     | 1d32b0828 | 37057226651 | quality (ubuntu-latest), same step                                       |
| 44  | M56 enterprise network      | d8dd7b473 | 36350220096 | quality (windows-latest), same step                                      |
| 43  | M55 install and sign-in     | e489ed88f | 36348351793 | quality (windows-latest), same step                                      |

Two more runs had a later attempt and no red test:

- PR 51 (an outside contributor): attempt 1 was the wait for a maintainer's
  approval and ran no job.
- PR 93: one job was cancelled before any step ran, and its CI run was green on
  attempt 1.

## One thing that is not an attempt

Measured 2026-10-14 with GitHub's API: run 36670394002 (PR 51, from
Piangpi1997's fork) is on attempt 2. Its attempt 1 ended `action_required` and
has 0 jobs, created and updated at the same second. The maintainer's approval
ran the workflow as attempt 2. An outside contributor's first run therefore
always executes as attempt 2. The gate treats an earlier attempt that ended
`action_required` with no job as no attempt; any other earlier attempt refuses.

## Proof that both doors fire

On 2026-10-14 at 9:20 AM PT, `scripts/rule2-gate.mjs` of this branch was run
against real runs of this repository, with read-only API calls and
`RULE2_WAIT_MINUTES=0`:

| drill | input                                                             | expected | exit |
| ----- | ----------------------------------------------------------------- | -------- | ---- |
| A     | `run`: run 36670394002, attempt 2 after the approval wait (PR 51) | pass     | 0    |
| B     | `run`: run 38311021688, attempt 2 after a red attempt 1 (PR 153)  | refuse   | 1    |
| C     | `run`: run 38337283005, attempt 1 green, head of PR 155           | pass     | 0    |
| D     | `release --sha 898a26c5e` (the 0.18.2 commit)                     | refuse   | 1    |

What each drill printed:

- **B** named `build / tests (macos-latest, shard 6)`, step 5 "unit and process
  e2e tests" (failure), from attempt 1.
- **D** refused three runs:
  - Hosts run 38340629307 (workflow_dispatch, cancelled).
  - Hosts run 38329749606 (push, failure: "VSCodium latest", step 6).
  - CI run 38311021688 (on attempt 2 after a red attempt 1).

  It passed Release 38329786779, Hosts 38311021363 and Action check 38311021286.

The 0.18.2 tag would have stopped at this door.

Break on purpose: removing `JUDGED_ATTEMPT` from the required aggregate in
`build.yml` turned `test/unit/manifest.test.ts` red ("passes a required name
only when its whole tier succeeded", exit 1). Restoring it turned it green
(exit 0).

Main deleted `test/unit/manifest.test.ts` on 2026-10-17 with every test
that only checked text in a workflow (the owner: "there can be no more fakes
at all"). Merging main into this pull request kept that deletion, so the
drill above is history. The aggregate's wiring is proven by its hosted runs
(below), and the claims this pull request had added to the deleted file are
listed under it in `docs/real-life/unproven.md`.

## First hosted execution (pull request 158, head fb8d0ff84)

CI run 38597656750, attempt 1:

- The gate job "first attempt, every run green (rule 2)" (job 115984548670)
  ended success after 9 seconds. It was attempt 1, and the only other run on
  the head (Hosts 38597656120) was complete and green.
- The run was red for one reason: `build / tests (windows-latest, shard 8)`,
  step "unit and process e2e tests". Five cases of
  `test/unit/reportHistory.test.ts` failed:
  - "retries a transient own-process identity failure within the probe bound"
  - "allows later writes after exhausted own-process probes"
  - "recovers the writer lock after killing its owner process"
  - "recovers a reused PID only with a complete mismatched birth identity
    lease"
  - "waits for a live writer held longer than the old 100 ms contention
    budget"

  Each failed with its PowerShell child process killed (`signal: 'SIGTERM'`)
  or with "Test timed out in 15000ms". This pull request changes no product
  code and no test, so the red belongs to that file on the hosted Windows
  runner. Which step of the PowerShell launch overran is not measured. The
  five required aggregates failed because of that shard, as they must.

Rule 2 applies to this record too: the run was not started again. This commit
starts the next one.

## PRTH158 review-fix receipts (2026-10-15, Windows)

Main `ac21f1d24` merged with hooks as `c7b3af609`. Both rule-2 enforcement
and the real-code test overhaul remain; the removed coverage job is not a
`first-attempt` dependency. No stand-in GitHub, model call or new process
test is used. Tests import the real pure policy module.

### T1 — release verification is never executed twice

Hosted release verification checks `GITHUB_RUN_ATTEMPT` before excluding
its own run. Only attempt 1 passes. Local read-only preflight has no run id;
a fresh artifact-only recovery run still starts at attempt 1. The release
guide now distinguishes that recovery from rerunning a failed job.

Command: `npx --no-install vitest run test/unit/rule2Gate.test.mjs --maxWorkers=2`.
Baseline: 24 passed, exit 0. Deliberately changed the real
`assertReleaseAttempt` comparison from `!== 1` to `< 1`:

```text
refuses re-executed or unreadable verification: 2
refuses re-executed or unreadable verification: 3
AssertionError: expected [Function] to throw an error
Tests 4 failed | 20 passed (24)
RED_EXIT=1
```

Restored the exact bytes; before/after SHA-256:
`12ca289fd6be85e8feec13a280c6a485c618c886317d55c86ad839bfb2807673`.
Restored: 24 passed, exit 0. Logs: `.lane/PRTH158.T1.{green,red,restored}.log`.
The lead's hosted check is to read the same release verify command with a
run id and attempt 2: it must refuse before any API access or publisher.

### T2 — final release reread

After settling, release reads all tagged/PR-head runs again through the same
finder. Missing evidence or a pending run refuses immediately without a new
wait; completed runs pass through the existing attempt/conclusion verdict.
This narrows the observation window; no API read can lock out a future
GitHub dispatch after the read.

Same Vitest command as T1: baseline 27 passed, exit 0. Inverted the real
`releaseRecheck` pending-run predicate (`!== 'completed'` to `===`):

```text
refuses a late pending run on either commit without waiting again
AssertionError: expected [ …(2) ] to deeply equal [ StringContaining{…} ]
- StringContaining "still queued at the final release recheck"
Tests 3 failed | 24 passed (27)
RED_EXIT=1
```

Restored bytes, SHA-256 before/after:
`6ff87303666ed3da6e46d0c25fc36b8f406be328b3d4b90c135da2bd0dc1bd4d`.
Restored: 27 passed, exit 0. Logs: `.lane/PRTH158.T2.{green,red,restored}.log`.
Lead: on a disposable hosted commit with a successful result, start the
read-only release preflight while another existing workflow is pending;
expect a refusal naming the pending run. Never rerun a workflow for this
check on the same commit.

### T3 — a skipped workflow is not green evidence

Both run verdicts and per-commit release evidence require completed success.
`skipped` and `neutral` no longer pass; neither can stand in for a tested
commit. The existing successful fixtures now include the actual status and
conclusion used by that decision.

Same Vitest command: baseline 34 passed, exit 0. Removed the conclusion
check from real `isSuccessfulRun`, admitting every completed run:

```text
never treats skipped as green or hosted evidence
never treats neutral as green or hosted evidence
AssertionError: expected true to be false
Tests 6 failed | 28 passed (34)
RED_EXIT=1
```

Restored bytes, SHA-256 before/after:
`6040fe15942d0ddb008761ea3bbea1deb7399bc2e6369d835ccc1645ddbafa5e`.
Restored: 34 passed, exit 0. Logs: `.lane/PRTH158.T3.{green,red,restored}.log`.
Lead: use read-only release preflight on a disposable tagged commit with
only an existing skipped workflow result; observe the named skipped-run
refusal and no successful hosted evidence. Do not invoke a paid workflow.

### T4 — a new run id is still another execution

The real duplicate policy groups by head SHA and workflow path, refusing
more than one distinct run id irrespective of attempt or completion. It
runs during settling and the final reread at both doors. Merge includes
its own identity before excluding the in-progress current run, so a second
CI run cannot hide behind the old newer-twin exception (now removed).
Different workflows, different commits, and duplicate list entries for one
run remain distinct from repeated execution. Release recovery exclusions
remain unchanged; T5 normalizes their paths.

Same Vitest command: baseline 40 passed, exit 0. Inverted the real distinct
id comparison from `!==` to `===`:

```text
refuses a second run id even on its first attempt, status completed
AssertionError: expected [] to deeply equal [ StringContaining{…} ]
- StringContaining "distinct runs 38597656750 and 38597656751"
Tests 5 failed | 35 passed (40)
RED_EXIT=1
```

Restored bytes, SHA-256 before/after:
`7f19e8775d15bc62499f387abd1d05e71783dd6dcaf61a6a106a5c4fb8bd13c7`.
Restored: 40 passed, exit 0. Logs: `.lane/PRTH158.T4.{green,red,restored}.log`.
Lead: inspect existing historical duplicate workflow runs through read-only
preflight and observe both run ids in the refusal. Do not close/reopen this
PR or dispatch another run merely to manufacture the case.

### T5 — workflow paths have one identity

`runOf` normalizes REST paths with the same pure `workflowPath` used for
`GITHUB_WORKFLOW_REF`. `.github/workflows/release.yml@main` and the hosted
repository-prefixed reference now identify the same workflow; exclusion
still removes only the release workflow, not CI/Hosts evidence. Duplicate
execution checks also cannot be evaded by a different ref suffix.

Same Vitest command: baseline 42 passed, exit 0. Removed `@ref` stripping
from the real normalizer:

```text
matches REST ref-suffixed release paths to the hosted workflow reference
Expected: ".github/workflows/release.yml"
Received: ".github/workflows/release.yml@main"
Tests 2 failed | 40 passed (42)
RED_EXIT=1
```

Restored bytes, SHA-256 before/after:
`533dc8e8b10f0e57bd25f1855edddc7ae2afe26be3533a2cab4dcbad53dbc4a9`.
Restored: 42 passed, exit 0. Logs: `.lane/PRTH158.T5.{green,red,restored}.log`.
Lead: read the existing release-recovery run's verification output; prior
Release runs must be excluded even when their REST path has a ref suffix,
while CI/Hosts results and their failures remain in the judged set.

### T6 — parser and per-commit evidence guards deliberately broken

All three drills ran the complete real-module file with the T1 command,
Windows, Node 24.20.0, Vitest 5.0.3, `--maxWorkers=2`, repository timeouts.
Baseline 42 passed, exit 0. Each mutation was applied separately, the
intended assertion failed (not a startup/syntax failure), and the exact
source bytes were restored before the next drill. Every restored run:
42 passed, exit 0. Every before/after SHA-256:
`0794b17d13be089576daf795be1769f253497d5849ecf557923ba42678525c11`.

| Real guard        | Deliberate defect                                           | Observed failure                                                                                                                                                            | Red exit |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `runOf`           | Allow a string run id                                       | `refuses a run it cannot read` for id `"38597656750"`; `expected [Function] to throw an error`; 1 failed, 41 passed                                                         | 1        |
| `pullOf`          | Allow a numeric head SHA                                    | `refuses a pull request it cannot read` for `head.sha: 42`; `expected [Function] to throw an error`; 1 failed, 41 passed                                                    | 1        |
| `missingEvidence` | Check only an empty global list/tag instead of every commit | `names the pull request head that has no run`, `names the tagged commit when only the head has runs`, and missing/deleted/success evidence assertions; 10 failed, 32 passed | 1        |

Raw intended failures:

```text
runOf: AssertionError: expected [Function] to throw an error
pullOf: AssertionError: expected [Function] to throw an error
missingEvidence: AssertionError: expected [] to deeply equal [ StringContaining{…} ]
- StringContaining "pull request 158 head fb8d0ff84"
```

Logs: `.lane/PRTH158.T6.green.log` and
`.lane/PRTH158.T6.{runOf,pullOf,missingEvidence}.{red,restored}.log`.
No test was removed or replaced with a stand-in. The original pure parser
suite survives main's deletion of fake-driven tests, so no lost proof was
reintroduced. These are deliberate broken-code drills, not merely negative
input examples. No GitHub dispatch or model provider is needed for them.

### Final integration observations

The rest of the release guide's recovery table now uses the same fresh
artifact-only dispatch as T1, instead of contradicting it with rerun-job
instructions. This is documentation of the existing recovery path, not a
new publication bypass.

Local Windows production build: exit 0, extension 550.8 KiB, Model API
507.2 KiB, checkpoint store 84.6 KiB; unchanged budgets. Built agent
`node dist/acp.js --help`: exit 0, no backend or credential operation.
Actual `node scripts/package-acp.mjs`: exit 1, exactly:

```text
Error: Required Darwin created-path helper is missing: native\darwin\muse-dictate
```

No fake helper was supplied. Therefore no packed-agent run is claimed.
The CI gate is a source command, not part of the packed runtime; its hosted
composition remains for the lead's read-only historical-run checks above.
Surviving dependent suites `manifest`, `cyclesRoots`, `lazyBundleFiles`,
`rule2Gate`, `packagedBundles`, `actionManifest`: 117 passed, exit 0.
Final static-gate exit receipts and exclusions are in the lane report.

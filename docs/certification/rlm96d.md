# M96d machine coordinator build — RLM96D

2026-10-22, macbook rig, branch `rec/rlm96d`, base `f3941b8548`
(0.19.0). This lane lands the certified spike
(`src/RLM96D/01-c-m96d-1w`) and builds the production coordinator
with all eight scheduler optimisations. No new command, setting, UI
surface, dependency or paid/live call ships: the coordinator is
library code behind the team scheduler, and machine mode stays
unsurfaced.

## What landed

- The spike merge (`d201fc66`), kept as authored.
- The coordinator core (`7e23b06a5`): the pure grant engine
  (`src/core/team/coordinator/grants.ts`), the durable custody shell
  (`ledger.ts`), exact process references (`references.ts`), mode
  selection (`mode.ts`) and the discovery endpoint (`endpoint.ts`).
- The eight optimisations: schema + stacked dependencies
  (`4ed7e688b`), review carry-over (`93c286a45`), tested-tree cache
  (`ee9c36cbc`), waiting-branch refresh (`77d211745`), cross-branch
  advisories (`f0fd1c847`), Traffic suggestions (`ad30acf27`),
  cross-role stealing (`b8401ff9f`) and source-file regions
  (`f51eeacc5`).
- Drill and gate repairs: the tombstone acknowledgement test
  (`e74d648cf`), the duplication refactor, the regenerated host-API
  record, catch baseline and team tool schemas (this change).

## RVM96C2 findings 1–4

The spike's four adversarial schedules run against the production
grant engine in `test/unit/m96dCoordinatorSpike.test.ts` (66 tests),
the F1 native discovery drills against the production endpoint in
`test/unit/m96dCoordinatorEndpoint.test.ts`, durable custody in
`test/unit/m96dCoordinatorStore.test.ts` and native identity in
`test/unit/m96dCoordinatorIdentity.test.ts`.

Build-level red drills, each broken on purpose, observed red,
restored byte-exact and green again:

| Drill   | Break                                            | Red                                                                                          | Restored                                                                           |
| ------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| C1 (F4) | `ledger.ts` claims custody with unreadable birth | store degraded test fails (1 failed / 1)                                                     | green                                                                              |
| C2 (F1) | `endpoint.ts` accepts any beacon as validated    | foreign-speaker test fails (1 failed, 5 passed, 2 skipped)                                   | green                                                                              |
| C3 (F3) | `grants.ts` collects unacknowledged tombstones   | first run: **no fire, 65/65 green** — the spike suite never covered the acknowledgement gate | new tombstone test added: green 66, break fires (1 failed / 66), restored green 66 |

C3's first run found a real coverage gap: only the
birth-gated store suite covered collection, so no rig without
readable process birth proved the gate fires. The new test pins the
pure rule (unacknowledged tombstones stand with their outcomes,
acknowledgement flips once, collection drops exactly once).

Optimisation red drills, all fired then restored: the tested-tree
exact-key drill, the waiting-refresh gate drill, the advisory gate
drill (identical bytes hit the routine's equality shortcut, so the
windows carry distinct versions), the Traffic headroom and dismissal
drills, the steal listing and coverage drills, and the region-split
drill (3 failed / 5; the disjoint-lease test passes for the wrong
reason when splitting breaks — distinct literals still lease —
while the whole-file overlap, grow and declaration tests fire).

## Region merges: the rescue that could not fire

Regions were first built with a per-region text rescue in the
landing routine. A real `git merge-file` run then proved the
premise false: edits in different regions came back clean
(`conflicts: false`), because region bodies are always separated by
their marker lines and never share a merge hunk. Per-region rescue
cannot fire on real inputs, so it was removed again
(`src/core/team/merge/regions.ts` deleted, the routine restored
byte-exact to M96c); regions ship as ownership only — region-level
leases — with the merge untouched, which is what PLAN M96d asks
(region-level leases; prediction keeps the landing's own routine).

## Suite results (repository timeouts, `--maxWorkers=3`)

| Run                                   | Files                  | Result                              |
| ------------------------------------- | ---------------------- | ----------------------------------- |
| Coordinator                           | spike, endpoint, store | 73 passed, 2 skipped (Windows-only) |
| Identity, stacked, carry-over         | 3 files                | 19 passed                           |
| Cache, refresh, advisories            | 3 files                | 20 passed                           |
| Traffic, steal, regions               | 3 files                | 22 passed                           |
| Predictor, collisions, merge failures | 3 files                | 20 passed                           |
| Tab blind, session board              | 2 files                | 12 passed                           |

`vitest related` over the 21 changed team sources: 95 files, 1372+
passed. The stable failures are all environmental, each proved:
`crashMarker` fails identically on the unmodified base worktree
(this sandbox denies macOS `ps`); `nativeCheckout`,
`nativeGitAdapter`, `nativeGitPullRequestReads`, `nativeGitService`,
`nativeProcessDefaults` and `reportProductionTransport` fail on the
rig's broken `/usr/bin/git` shim (missing Xcode.app);
`vault/credentialMigrationStore` fails acquiring a writer without
readable birth. `uploadLedgerTwoProcess` and `pathGuardRound4`
flaked once each under pack load and pass alone here and on base.
The `related` run pulled one vault suite, which recovery forbids on
this machine: it failed safe at writer acquisition, before any
store write, and was not re-run.

On 2026-10-22 the shared rig sat at load 17–19, and the advisories
flagship test (real branches, ~50 serial git spawns) timed out past
the 5 s default twice in this worktree. The committed HEAD fails
identically on a clean worktree under the same load, so the
refactor is exonerated; the test passed at lower load earlier the
same day. No timeout was raised anywhere.

## Gate exits

`typecheck` 0. `check-l10n` 0. `check:reference` 0. `check:host-api`
0 after `--write` (new Node built-in rows for the coordinator).
`check:catches` 0 after `--write-baseline` (the accepted
read-exact-evidence site moved under the refactor; no count rose).
`duplication` 0 after extracting the 22 clones this lane added.
`cycles` 0. `deadcode` 0 after deleting the unused
`CoordinatorGrantPhase` export. `build` 0 after regenerating the
team tool schemas (`on: stacked`, `alt_roles`). `check:plan` 1 and
`check:roadmap` 1, both from the plan size, with a recorded §7
deferral (see below).

`check:plan` fails on size: PLAN.md is 3,568,230 bytes against a
3,565,158-byte budget, and the base arrived at 3,563,591 — 1,567
bytes under. This lane's spike-certification text, §8 escape row
and status line tripped it. The archive procedure (CONTRIBUTING.md)
is program surgery across every open lane (enumerate each
unmerged branch's PLAN diff, trial-merge each onto the old and new
file); running it per recovery lane would churn the shared plan a
dozen times, so it is deferred to the lead at integration, with no
threshold or ignore weakened.

## Proof status by platform

- macOS: the sandbox denies `ps` while `sysctl` answers, so this
  rig proves the degraded contracts (custody refuses
  `ownerUncertain` with no owner claim; birth reads unknown while
  boot answers) and every pure guard. Native macOS proofs (live
  foreign PID custody, provable death, `proc_pidinfo` precision)
  need an unsandboxed run.
- Linux and Windows: not run from here. The spike's Win11
  service-mediated launch, Job/WMI, restricted-token and tracing
  receipts stand; the build's native receipts on all three OSes,
  hosted CI, the lead ruling and independent acceptance remain the
  lead's integration gate (Q-C-M96d-1).

# RLF-M115T certification (C-M115-8: role/team targets)

Recovery lane on int/recovery `0a5ebd7189` (CC-INT5; branch `rec/rlf-m115t`),
run on the Mac mini rig in `/Users/randy/lanes/RLF-M115T`, 2026-10-31 to
2026-11-01. No live model call and no paid call was made; no browser,
Electron or GUI started. `SCHEDULE_EDITOR_DELIVERY_CERTIFICATION` stays off:
it flips only on the lead's complete receipts.

RLSCHED left role and team targets refusing `targetUnavailable` while they
waited on M96. The team core and the start port (RLF-TEAMWIRE, RLF-TEAMCORE)
are now on int, so this lane binds those targets to them, never a parallel
path. C-M115-9 (the native editors' rows) waits for the native-hosts
re-land and is named waiting here, not built.

## What landed

- `src/core/schedules/boardDelivery.ts` (new): `ScheduleBoardDelivery`
  owns role/team targets. A role fire becomes one task under the role's
  charter; a team fire becomes one task under the stored team's first
  role; worker/node and foreign-team targets refuse `targetUnavailable`.
  Last-at-dispatch currency (edited, retargeted, paused, deleted), the
  event fenced wholly inside the brief, board key and parent derived from
  the run id and schedule id, and a fixed failure sentence whose kind
  reaches the record through the log, never the words.
- `src/core/team/teamHost.ts`: `TeamHostService.delegateScheduled`
  admits one scheduled fire through the same record/persist/submit path
  as the other delegates. A resubmitted fire adopts its task by board
  key; a finished key's duplicate returns admitted without a new task.
- `src/core/team/teamPaid.ts`: `quoteKeyTasksUsd` quotes key-billed
  ceilings at the dearest rate from the same prices the popup quotes.
- `src/core/schedules/deliveryRequest.ts` (new): the delivery-call
  preamble the report and board runners share (extracted for the
  zero-clone gate; the report runner's behaviour is unchanged, and the
  board runner gains the report's occurrence-finiteness check).
- Wiring: the engine's `boards` option, `ScheduleBoardDelivery`'s log,
  `deliveryBinding`'s `teamBoards` port, `scheduleTeamBoards.ts` (new),
  `TeamHostBinding.admitScheduledBoardTask`, and the extension wiring.
- Two person-seen sentences in English plus all 14 tables:
  `scheduleTeamUnquotable` and `scheduleTeamFailed`.
- Tests run real code only: the real schedule engine, team host service
  and window scheduler; no worker ever starts (zero caps queue, and the
  start-port test's real port refuses a repository-less workspace before
  any model session).

## Suites

| Suite                                                                                        | Result                                                                                 |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `test/unit/scheduleBoardDelivery.test.ts` (23 tests)                                         | 23 passed, repeated green                                                              |
| `test/unit/scheduleBoardClaim.test.ts` (two real processes race one due fire)                | passed, repeated green                                                                 |
| `test/unit/teamMoveTask.test.ts` (shares the rig helper)                                     | passed                                                                                 |
| `test/unit/teamLandingKilled.test.ts` (shares the child-plan helper)                         | passed                                                                                 |
| `test/unit/scheduleReportBinding.test.ts`, `scheduleReportSecrecy.test.ts` (shared preamble) | passed                                                                                 |
| `vitest related` for every changed source file                                               | 209 files: each red file measured identical on the untouched base or load-only (below) |

`vitest related` over the lane's changed sources (repository timeouts,
`--maxWorkers=3`): exit 1, 209 files, 3553 tests. Two runs: 7 failed
files / 18 failed tests, then 6 / 17 (the seventh file of the first run
is unidentified: only its tail was kept). Each failing file below was
then run alone here and, where the base classification needed it, on an
extracted copy of the untouched base (`git archive 0a5ebd718` under
`$TMPDIR`, `node_modules` linked, built with
`node scripts/build.mjs --production`):

| File (tests)                                | Lane tree alone                                                            | Untouched base alone | Class                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `scheduleFireFailures` (6, 5 s timeouts)    | the same 6                                                                 | the same 6           | Base (`docs/certification/cc-int5.md` §5 row 3)                                      |
| `connectorStorageGuard` (3)                 | the same 3                                                                 | the same 3           | Base (cc-int5.md §5 row 4)                                                           |
| `crashMarker` (1, PID reuse)                | the same 1                                                                 | the same 1           | Base, measured here                                                                  |
| `providerHeadersStore` (3 + file)           | the same, `StoreUnavailableError`: no default keychain on the headless rig | the same words       | Base/environmental, measured here                                                    |
| `playbookSchedulesInputs` (2 under load)    | 1 (the contention case, 5 s)                                               | the same 1           | Base (cc-int5.md §5 row 3); the second (`scheduleFireIdentityMismatch`) is load-only |
| `schedulePauseAfterFailures` (2 under load) | 5 passed                                                                   | passed               | Load-only: fails only beside other files                                             |

No red file is this lane's regression; none was touched.

Load flakes during verification, each green on the serial re-run on the
same tree: `scheduleBoardDelivery` T1 once under a 7-file parallel run
beside the full typecheck (prior run), and the two rows above marked
load-only (this run).

## Red drills (byte-exact)

Each drill: hash the file, break it, run the delivery suite (red,
non-zero exit), restore from the backup copy, verify the hash matches,
run the suite (green, exit 0). The drills ran on the lane tree at
`b94c445eb` (the final code tree).

```json
{
  "D1": {
    "file": "src/core/schedules/boardDelivery.ts",
    "break": "every target refuses targetUnavailable",
    "before": "64b53c7342d711d77305533173aeb0a74c9abd9c64db6bf8345420bcc28c53e3",
    "broken": "69e6328ac98c8e6fa40c2f80ba6172304c5dff02b654bc7c5a2d706c8ccdc073",
    "red": "16 failed, 7 passed (exit 1)",
    "restored": "64b53c7342d711d77305533173aeb0a74c9abd9c64db6bf8345420bcc28c53e3",
    "green": "23 passed (exit 0)"
  },
  "D2": {
    "file": "src/core/team/teamPaid.ts",
    "break": "every ceiling quotes $0, so over-cap spend admits",
    "before": "ea27328e2e44711e885c6ffd36d74a39c94c5efbe1ea1d0c80e650a8cdee0920",
    "broken": "5e6c439f99944df0f31cdf03ae916da26f32b224a99765786fc5b54c69d3ad92",
    "red": "exit 1: refuses key spend above the schedule cap; refuses key entries it cannot quote; quotes ceilings at the dearest rate",
    "restored": "ea27328e2e44711e885c6ffd36d74a39c94c5efbe1ea1d0c80e650a8cdee0920",
    "green": "23 passed (exit 0)"
  },
  "D3": {
    "file": "src/core/team/teamHost.ts",
    "break": "no adoption and no finished-key admission; a resubmitted fire fails",
    "before": "10c9b5643dc7b0a4a95959ddff3af56dfa062d98853d30a864991e7d5b13fbe9",
    "broken": "a24c09330350ff0c3f261cf3fc40f4206c21842f616c925aba4004d51f07299a",
    "red": "exit 1: adopts a resubmitted fire instead of duplicating it",
    "restored": "10c9b5643dc7b0a4a95959ddff3af56dfa062d98853d30a864991e7d5b13fbe9",
    "green": "23 passed (exit 0)"
  }
}
```

## Gates

| Gate                                                                       | Exit                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| prettier --check, eslint --max-warnings 0 (touched files)                  | 0 (one `unicorn/no-await-expression-member` in new code, fixed by hoisting the await) |
| `npm run typecheck`                                                        | 0                                                                                     |
| `node scripts/check-l10n.mjs`                                              | 0                                                                                     |
| `npm run check:reference`                                                  | 0                                                                                     |
| `npm run check:host-api` (record regenerated for the two new Node imports) | 0                                                                                     |
| `npm run check:plan`, `npm run check:roadmap`                              | 0                                                                                     |
| `npm run check:catches`                                                    | 0                                                                                     |
| `npm run duplication` (0 clones)                                           | 0                                                                                     |
| `npm run cycles`, `npm run deadcode`                                       | 0                                                                                     |
| `npm run build`                                                            | 1: the same 4 budgets CC-INT5 left over, no budget raised (below)                     |
| suites above + `vitest related` per changed source file                    | exit 1 with only base/load red (above)                                                |

Build overruns, base (`docs/certification/cc-int5.md` §8 item 1) to this
tree: `dist/teamHost.js` 140.2 → **142.9** of 130 KiB (+2.7 from
`delegateScheduled`, its quote and the kind-logging catch),
`dist/teamRunners.js` 78.4 of 75 (unchanged), `dist/teamScheduler.js`
76.5 of 75 (unchanged), `dist/uiText.js` 125.3 → **125.4** KiB
(128,429 B of 128,000: the two new sentences). This lane's own bundles
hold: `dist/schedules.js` 234.8 of 250 KiB, `dist/scheduleDelivery.js`
30.8 of 50 KiB. The rest of the build chain was run by hand, all exit 0:
tokens, bundle split (schedule model text in its readers only),
`gen-lazy-registry --check`, host globals, third-party notices, legal
build records. Fitting the four over-budget bundles is the lead's
already-recommended lane (CC-INT5 §8 item 1, options a–c); this lane
raises no budget.

## Waiting

- C-M115-9 (native editors' rows): waits for the native-hosts re-land.
- The lead's complete receipts before the certification switch flips.
- The four over-budget bundles (lead's fit-the-bundles lane).
- Base failure findings (not this lane): the six `related` rows above;
  the pre-existing `engine.runtime.close()` AbortError, tolerated
  narrowly in the suite.

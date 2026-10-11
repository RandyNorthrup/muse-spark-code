# M113 C-M113-4 part B certification — estimate report kind (CM1134B)

2026-10-11, MacBook rig, branch `c/m113-4b`. Base `a0b69a03b` (c/m113-2)
then merges `7659369cc` (snap/5369f3df7, accepted report ordering fix;
session.ts conflict resolved by meaning: c/m113-2's limits-field stripping
kept with the accepted total-order tie-break sorts) and `44eb2680a`
(snap/7d0410526, the estimator plan reader, c/m117-1 round 4). The estimator
is read only through its public run result (`EstimatorRun.estimate` /
`EstimateRunPort`); no estimator file is edited by this lane.
No new dependency, string, command, setting, cap, hook, gate relaxation,
paid/live call or credential. Shared core/runtime logic serves VS Code, ACP
and the terminal; no webview paint changed.

## What works end to end

`/report estimate <goal>` (D93.4) runs M117's engine for the D97.2 goal in
the report scope, `--by <date>` as deadline, `--fleet
current|minimum|optimum` as fleet, and collects P50/P90 (`estimate/totals`),
the critical path, the limiting resource, the setups with marginal values,
the inputs and the calibration sample sizes. Every editor forecasts cost,
so the numbers match. Offset stamps (`--by` always builds `+00:00`; `--as-of`
may too) are normalized to the same UTC instant the estimator requires —
without this, no `--by` report could ever reach the engine, whose instants
end in Z. A refused estimate stays a failed source naming the estimator's
own typed reason, the same sentence `/estimate` prints for the goal.
Unparseable scopes are invalid; other kinds are notApplicable; unwired
hosts stay unavailable.

## Finding → fix → regression → deliberate failure

Tests use the exact `E<number>` prefix in `test/unit/estimateReportSource.test.ts`.
The whole file ran at repository timeouts with `--maxWorkers=3`, no filter.

| #       | Fix                                                                                                                                                                           | Regression | Red drill                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| E1–E3   | Unbound/disabled/invalid-goal guards with their codes                                                                                                                         | E1, E2, E3 | —                                           |
| E4      | Six D93.4 facets projected from the validated run                                                                                                                             | E4         | echo drill below (E4, E5, E5b, E6, E9 fail) |
| E5/E5b  | `--by`/`--fleet` cross into the request; offset stamps normalized                                                                                                             | E5, E5b    | —                                           |
| E6      | Request-echo check refuses a stale run instead of inventing rows                                                                                                              | E6         | echo drill below                            |
| E7/E8   | Null run fails with the estimator fallback; refused run names it                                                                                                              | E7, E8     | drills R1, R2 below                         |
| E9      | Partial reason scrubbed                                                                                                                                                       | E9         | —                                           |
| E10     | Content-addressed rows order by key                                                                                                                                           | E10        | —                                           |
| E11/E12 | Inputs bundle stamps the request instant, forwards request+signal; failures propagate                                                                                         | E11, E12   | drill R3 below                              |
| E13     | Full collect through the production finalizer; all four formats render                                                                                                        | E13        | —                                           |
| E14     | Lane lists over ten rows cap with omittedRows                                                                                                                                 | E14        | —                                           |
| E15     | Table over every refusal the estimator can return (typed diagnostics, engine/schedule/capacity/not-found sentences, scrubbed secret; forged and unshaped errors stay generic) | E15        | drills R1, R2 below                         |
| E16     | Run stamped at the request instant reads fresh with age zero                                                                                                                  | E16        | drill R3 below                              |

## Red-drill receipt

Guard: the request-echo comparison in `src/core/reporting/sources/estimate.ts`
(`!==` inverted to `===`). Run: `npx vitest run
test/unit/estimateReportSource.test.ts --maxWorkers=3` — 5 failed (E4, E5,
E5b, E6, E9), 10 passed. Restored byte-exact, verified with `sha256sum -c`:

- `src/core/reporting/sources/estimate.ts`: `16cfef399a153da697d51af533d57978feee70fb109f78b32d9f56964860b69d`
- `src/core/reporting/collect/estimate.ts`: `41d7eb2462de305f00ec7c637b6464c11e46f3148b23aaee5e4430d3b91307ec`
- `src/runtime/reporting/reportInputs.ts`: `b5e10bbf12566d02cef131e62eb7509e8d297b02e42956f3c53e5b5417bce520`

No red mutation is retained. Post-restore run: 15/15 pass.

RVCM1134B repairs (2026-10-11, same rig/branch): failure-path honesty of the
estimate report kind, one class over five named paths. `estimate.ts` catches
the reader's throw and rethrows `LocalSourceError('failed')` with the
estimator's own typed reason (`estimateRefusalDetail`: validated
`estimateDiagnostic`, the engine's installed-language failure sentence, the
capacity and not-found sentences; forged and unshaped errors stay generic);
a null run fails with `Estimate failed: estimate-unavailable`, the same
sentence `/estimate` prints. `local.ts` carries a branded pre-scrubbed
detail on the unavailable record, falling back to the table sentence.
`reportInputs.ts` stamps `observedAt` from the validated request instead of
the wall clock, so a generation seals identical bytes and reads fresh.
`reportsArgs.ts` builds `--by <date>` through the estimator's own
`estimateDeadline` (midnight UTC, usage error when unusable) instead of
`T23:59:59+00:00`; `reportRequest.ts` accepts the same date-only form in the
editor instead of rejecting it at the schema. No new string, command,
setting, dependency or guard widened.

Red drills (each restored byte-exact, verified with `sha256sum -c` over all
five source files):

- R1: drop the extracted detail in `estimate.ts` (plain `LocalSourceError('failed')`). E8 and E15 fail, 15 pass.
- R2: force `localDetailOf` in `local.ts` to undefined. E7, E8 and E15 fail, 14 pass.
- R3: stamp `new Date().toISOString()` in `reportInputs.ts`. E11 fails, 16 pass (E16's double supplies its own stamp, so E11 is the reader-stamp guard).
- R4: restore `${by}T23:59:59+00:00` in `reportsArgs.ts`. `reportsCommand.test.ts` "accepts every kind, format and named scope" fails.
- R5: store the raw `--by` token in `reportRequest.ts`. `reportingRequest.test.ts` "parses the picker, problem report, history and scoped deterministic kinds" fails.

Post-restore run: `estimateReportSource.test.ts` 17/17 pass.

## Suites run (MacBook, repository timeouts, `--maxWorkers=3`)

- `test/unit/estimateReportSource.test.ts`: 17/17 pass (E1–E16 with the new E15 table and E16 freshness lock).
- `test/unit/reportsCommand.test.ts`, `test/unit/reportingRequest.test.ts`, `test/unit/sessionReportSource.test.ts`: pass (32/32 across the three files).
- `test/unit/reportInputs.test.ts`, `test/unit/reportsEntry.test.ts`: pass.
- `test/unit/sessionReportSource.test.ts` (14/14),
  `test/unit/agentUsageSource.test.ts`, `test/unit/m113cLaneClosure.test.ts`:
  pass. The session suite's `provides explicit availability for all local
sources in every host` now expects the `estimate` id (one-line update in
  the existing contract test, no weakening): the unwired estimate source
  reports `notApplicable`/a reason with null data like its siblings.
- `test/unit/reportEngine.test.ts`: 1 failure (`generates, scrubs, renders
and retrieves the same report through the real local pipeline`:
  `reports/run` returns `failed`) — proved pre-existing and environmental,
  not this lane: neither file was touched by this lane (last touches
  `ac9a3460e`, `67860397d`, `bd2d617c8`). Bisected with a scratch probe
  (since removed): `services.generate` succeeds AND `verifyReport` passes,
  so the earlier tmpdir-scrub hypothesis in this file is withdrawn. The
  failure is `history.save` → `ownStart` → `/bin/ps -o lstart= -p <pid>`:
  this rig's sandbox blocks process spawn (`/bin/ps: Operation not
permitted`, exit 126), and the macOS save path needs that probe for the
  writer-lock birth identity. No shim or workaround was built (rig rule);
  the lead re-runs this file outside the sandbox, where the reviewer saw
  4/4 pass.
- `npm run typecheck` (all five projects, foreground, final tree): green.
- eslint `--max-warnings=0` and `prettier --check` on all touched files: clean.
- `npx knip`: clean (two pre-existing config hints only).
- `npm run build`: my bundles pass — `dist/reporting.js` 162.7 KiB
  (budget 175), `dist/reportInputs.js` 68.9 KiB (budget 100),
  `dist/estimator.js` and `dist/planSnapshot.js` within budget;
  `node scripts/check-bundle-split.mjs` green;
  `node scripts/check-host-globals.mjs` green. The full build still exits
  nonzero on two OVERs outside this lane's import graph (neither bundle
  imports any file this lane added or changed): `dist/usagePanel.js` 75.2
  KiB (budget 75) and `dist/webview` estimator panel 25.3 KiB (budget 25).
  Caps are owner-hard, so both stay for the lead: the usage-panel overage
  predates this lane (c/m113-2's budget rows are the likely source) and the
  estimator-panel overage arrived with the c/m117-1 merge.
- `node scripts/check-l10n.mjs`: 0 problems. `npm run check:reference`,
  `npm run check:roadmap`, `npm run check:host-api`: green after
  regenerating the merge-stale generated files from merged sources
  (no catalog/content change by this lane).

## Review classes, one pass

- Validation/security: engine output validated against the owned
  `estimateSectionSchema` after scrubbing; goal parsed by the owned D97.2
  grammar; request echo-checked; no secrets enter rows (lane/file/machine
  tokens only; catalog prices omitted); partials scrubbed.
- Failure paths and honesty: unbound/disabled/invalid/failed codes with
  their table reasons; refusals keep the failed code and point at
  `/estimate` for the named detail; `--full` with capped rows throws
  `report/incompleteFullSource` through the shared forward path; row keys
  digest-hashed with an index disambiguator so duplicate engine rows cannot
  fail the section.
- Concurrency/lifecycle: reads share the generation stamp and honor the
  source timeout/cancellation through `localSource`; the VS Code reader is
  built per read behind the lazy inputs bundle; headless estimators are
  cached per workspace root and never read `process.cwd()` per read.
- Docs: README already promises `/report estimate M113` with no caveat, so
  no README change was needed; CHANGELOG `[Unreleased]` entry added; PLAN
  M113 status entry added; no new strings (all labels pre-exist in every
  table); no featureCatalog change (no new command, setting or feature).

## Goldens

Renderer goldens for the estimate kind (`test/fixtures/reports/estimate.*`)
are renderer fixtures independent of source data; no renderer changed, so
they stand. E13 renders the collected estimate document in all four formats
against the production finalizer.

## Restoration note for the lead (0.17.1 truth pass)

Nothing was withdrawn for estimate in code this lane could find — README's
Estimate row already presents `/report estimate M113` as working, and this
lane makes that true. If the truth pass hid the kind anywhere else (picker
copy, help text, entries), no restore was needed from this lane: the kind
flows through the existing kind table, args (`--by`, `--fleet`) and picker
untouched.

## Open / not in this lane

- Playbook and schedules kinds: part A, another lane (this lane touches
  only the estimate line of the kind table).
- Re-estimate on lane finish and the estimate TUI: C-M117-8.
- `reportEngine.test.ts` pipeline failure above (pre-existing, environmental
  suspect) — needs the lead's ruling.
- Codex review: lead-arranged, pending at lane close.

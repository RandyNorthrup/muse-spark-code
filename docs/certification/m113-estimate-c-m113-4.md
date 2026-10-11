# M113 C-M113-4 part B certification — estimate report kind (CM1134B)

2026-10-11, MacBook rig, branch `c/m113-4b`. Base `a0b69a03b` (c/m113-2)
then merges `7659369cc` (snap/5369f3df7, accepted report ordering fix;
session.ts conflict resolved by meaning: c/m113-2's limits-field stripping
kept with the accepted total-order tie-break sorts), `44eb2680a`
(snap/7d0410526, the estimator plan reader, c/m117-1 round 4) and
`59290bbd1` (snap/f56fff679, the estimator forecasts branch round 7;
CHANGELOG kept both sides, ROADMAP and the reference generated files
regenerated, both sides kept elsewhere). The estimator
is read only through its public run result (`EstimatorRun.estimate` /
`EstimateRunPort`) and its shared typed diagnostic
(`src/shared/estimateDiagnostic.ts`); no estimator file is edited by this
lane.
No new dependency, string, command, setting, cap, hook, gate relaxation,
paid/live call or credential. Shared core/runtime logic serves VS Code, ACP
and the terminal; no webview paint changed.

## What works end to end

`/report estimate <goal>` (D93.4) runs M117's engine for the D97.2 goal in
the report scope, `--by <date>` as deadline, `--fleet
current|minimum|optimum` as fleet, and collects P50/P90 (`estimate/totals`),
the critical path, the limiting resource, the setups with marginal values,
the inputs and the calibration sample sizes. Every editor forecasts cost,
so the numbers match. Date-only `--by` builds midnight UTC (`2026-11-01`
becomes `2026-11-01T00:00:00.000Z`) on every surface; an offset `--by`
instant is accepted in the editor report request and rejected as a usage
error by the terminal/ACP `--by` and by `/estimate` (the shared
`estimateDeadline` requires Z instants, verified against `z.iso.datetime`
with and without `offset: true`). `--as-of` offsets are accepted wherever
the report schema reads them. Stamps that reach the source are normalized
with `toISOString()` to the same UTC instant the estimator requires —
without this, no offset report could ever reach the engine, whose instants
end in Z. A refused estimate stays a failed source carrying the estimator's
own typed diagnostic — the same refusal code and parameters `/estimate`
names — rendered in the report's language: `no-capacity` keeps the
capacity sentence, `unknown-goal` keeps the goal sentence with the
diagnostic's reference (or the request goal when bare), any other valid
code fails with its detail, and a `missing-estimate` lane list with its
omitted count is re-rendered from that data in the report's language
(English seals the producer's bytes; German renders `und 2 weitere`).
Byte parity with `/estimate` holds wherever the producer carries no prose;
where it does (`and <n> more`), each surface renders its own words around
the same data. A refusal without a valid typed diagnostic stays generic on
both surfaces (`/estimate` prints `Estimate failed: estimate-unavailable`,
the report records the failed code with its table sentence). Unparseable
scopes are invalid; other kinds are notApplicable; unwired hosts stay
unavailable.

## Finding → fix → regression → deliberate failure

Tests use the exact `E<number>` prefix in `test/unit/estimateReportSource.test.ts`.
The whole file ran at repository timeouts with `--maxWorkers=3`, no filter.

| #       | Fix                                                                                                                                                                                                                                                                                   | Regression | Red drill                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| E1–E3   | Unbound/disabled/invalid-goal guards with their codes                                                                                                                                                                                                                                 | E1, E2, E3 | —                                           |
| E4      | Six D93.4 facets projected from the validated run                                                                                                                                                                                                                                     | E4         | echo drill below (E4, E5, E5b, E6, E9 fail) |
| E5/E5b  | `--by`/`--fleet` cross into the request; offset stamps normalized                                                                                                                                                                                                                     | E5, E5b    | —                                           |
| E6      | Request-echo check refuses a stale run instead of inventing rows                                                                                                                                                                                                                      | E6         | echo drill below                            |
| E7/E8   | Null run fails with the estimator fallback; refused run names it                                                                                                                                                                                                                      | E7, E8     | drills R1, R2 below                         |
| E9      | Partial reason scrubbed                                                                                                                                                                                                                                                               | E9         | —                                           |
| E10     | Content-addressed rows order by key                                                                                                                                                                                                                                                   | E10        | —                                           |
| E11/E12 | Inputs bundle stamps the request instant, forwards request+signal; failures propagate                                                                                                                                                                                                 | E11, E12   | drill R3 below                              |
| E13     | Full collect through the production finalizer; all four formats render                                                                                                                                                                                                                | E13        | —                                           |
| E14     | Lane lists over ten rows cap with omittedRows                                                                                                                                                                                                                                         | E14        | —                                           |
| E15     | Table over every refusal the estimator can return (valid typed diagnostics named — capacity, goal with reference or request goal, engine codes with detail; bare sentences, the retired `goal-not-found` seam, attached guesses and forged diagnostics stay generic; scrubbed secret) | E15        | drills R1, R2, D1 below                     |
| E16     | Run stamped at the request instant reads fresh with age zero                                                                                                                                                                                                                          | E16        | drill R3 below                              |
| E17     | Every refusal named in the report language with estimator sentences in any language ignored (German and English reports over English, German and garbage messages)                                                                                                                    | E17        | drill R6 below                              |
| E18     | Forged failure sentences (`Estimate failed: ../../etc/passwd`) stay generic in every language, as do forged diagnostics — including an invalid diagnostic with a matching capacity sentence                                                                                           | E18        | drills R7, D1 below                         |
| E19     | Collected sections cross as codes only: German-installed collect seals identical bytes, and bottleneck/setup/state cells hold codes                                                                                                                                                   | E19        | drill R8 below                              |
| E20     | Malformed diagnostics never guess a named refusal (garbage goal JSON, attached goal/capacity guesses, path traversal with a capacity-shaped message, invented code), in German and English                                                                                            | E20        | drill D1 below                              |
| E21     | Overlapping German and English generations keep their own refusal language when the estimator calls resolve in the opposite order (production reader factory, process table flipped mid-flight)                                                                                       | E21        | drill D2 below                              |
| E22     | A real twelve-lane `buildPlanSnapshot` refusal renders from data in the report language (German `und 2 weitere`, no English `and 2 more`; English seals the producer's bytes)                                                                                                         | E22        | drill D3 below                              |

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
setting, dependency or guard widened. (Superseded in one point by the
RVCM1134G round below: one new string, `estimateMissingMore`, in every
table for the re-rendered omitted-lane count.)

Red drills (each restored byte-exact, verified with `sha256sum -c` over all
five source files):

- R1: drop the extracted detail in `estimate.ts` (plain `LocalSourceError('failed')`). E8 and E15 fail, 15 pass.
- R2: force `localDetailOf` in `local.ts` to undefined. E7, E8 and E15 fail, 14 pass.
- R3: stamp `new Date().toISOString()` in `reportInputs.ts`. E11 fails, 16 pass (E16's double supplies its own stamp, so E11 is the reader-stamp guard).
- R4: restore `${by}T23:59:59+00:00` in `reportsArgs.ts`. `reportsCommand.test.ts` "accepts every kind, format and named scope" fails.
- R5: store the raw `--by` token in `reportRequest.ts`. `reportingRequest.test.ts` "parses the picker, problem report, history and scoped deterministic kinds" fails.

Post-restore run: `estimateReportSource.test.ts` 17/17 pass.

RVCM1134E repairs (2026-10-11, same rig/branch): the P2 refusal-language
class and the P3 doc wording, no new dependency, no guard widened. The P2
is a class fix: a refusal sentence is written in the report's language,
never in whatever language the estimator bundle happened to render. The
source no longer compares the thrown message against its own installed
table. `estimate.ts` decodes every refusal to a code plus parameters
(`EstimateRefusal`) and renders the sentence from the report's installed
table at the point of writing: the typed `estimateDiagnostic` channel
first (grammar diagnostics as before, plus the seam c/m117-1 fills —
`no-capacity`, `goal-not-found: <goal-json>`, bare engine codes — consumed,
never re-rendered from the bundle message), then an attached
`estimateRefusal`, then the estimator bundle's refusal templates carried on
the reader (`ReportEstimateReader.refusalTemplates`, snapshotted by the
terminal wiring in `src/runtime/main.ts` from the process table the
estimator installs, and by the editor wiring in
`src/host/reporting/reportPanelEntry.ts` from the display table), else the
installed table for the same-language estimator. A failure-prefix detail
outside the diagnostic grammar and the enumerated engine-code shape
(`Estimate failed: ../../etc/passwd`) stays generic in every language, as
before for forged diagnostics. The estimate collector needed no change:
`estimateReportSections` projects codes, counts, timestamps and booleans
only (E19 locks it), so labels, units, bottleneck names and assumptions
already cross unrendered. `createEstimateReportReader` is untouched — the
wired readers already wrap only `read`, and the templates ride the reader
object the engine passes through to `estimateSource`.

Red drills (each restored byte-exact, verified with `sha256sum -c` over
all five touched files):

- R6: ignore the reader templates in `estimate.ts`
  (`estimateRefusalDetail(error, undefined)`). E17 fails (German report over
  English bundle goes generic), 19 pass.
- R7: accept any failure-prefix detail (`ESTIMATE_ENGINE_DETAIL` relaxed to
  `/^[\s\S]*$/`). E15 (forged-diagnostic row) and E18 fail with the raw
  `Estimate failed: ../../etc/passwd` kept, 18 pass.
- R8: leak a rendered word into the collected rows
  (`limitingResource` kind cell suffixed with `UI_TEXT.estimateTitle`). E19
  fails, 19 pass.

Post-restore run: `estimateReportSource.test.ts` 20/20 pass.

RVCM1134G repairs (2026-10-11, same rig/branch): all four findings, one
class each, no new dependency, no guard widened. First merged
`snap/f56fff679` (the estimator's forecasts branch, round 7: one failure
value, a shared view state, one renderer) with `git merge --no-ff`,
resolving CHANGELOG (both sides' entries), ROADMAP and the reference
generated files (regenerated from merged sources) and keeping both sides
elsewhere. Then the report consumes the estimator's typed diagnostic
directly:

- P1 (validation/failure honesty): `estimate.ts` deletes its own decoding
  of sentences and JSON guesses (diagnostic grammar, engine-detail regex,
  attached-`estimateRefusal` reading, template decode, `refusalTemplates`
  on the reader and in both wirings). The shared `estimateDiagnostic`
  validates code plus parameters; a refusal without a valid typed
  diagnostic renders the honest generic refusal and is never guessed into
  a named one. Sibling sweep: no other sentence/JSON decoding remains in
  this kind's files (`grep` for the removed identifiers finds only the new
  tests).
- P2 (concurrency/lifecycle): the report's text table is captured once
  when the report request starts — the reader factory snapshots its own
  `table`/`locale` arguments onto the reader; readers built without the
  factory snapshot the installed table synchronously before the first
  await — and nothing in this kind's files reads the process-wide table
  after an await. Counts use fresh `Intl` instances over the captured
  locale, never the installed formatters. Sibling sweep: `collect` is pure
  (no `UI_TEXT`); the E7 fallback detail also renders from captured text.
- P3 (localization/failure honesty): no pre-rendered words cross from the
  estimator — the `missing-estimate` lane list and omitted count arrive as
  data and the report re-renders them (`estimateMissingMore` in every
  table, `node scripts/check-l10n.mjs` 0 problems). Sibling sweep over
  every estimator `refuse`/`DiagnosticError` site: the only other
  producer-side prose is the `Error` message argument (never read by the
  report) — all diagnostic payloads are identifiers, references or counts.
- P3 docs: CHANGELOG and this record now state only the verified seam —
  same validated code and parameters as `/estimate`, each surface
  rendering its own words around them — instead of the premature parity
  and completion claims.

Red drills (each restored byte-exact, verified with `sha256sum -c`; hashes
below are the restored tree):

- D1: name the generic code (`estimate-unavailable` renders
  `Estimate failed: estimate-unavailable` instead of returning undefined).
  E15, E18 and E20 fail, 20 pass.
- D2: render from the installed table after the await
  (`installedReportText()` in the catch instead of the captured `text`).
  E21 alone fails, 22 pass.
- D3: reuse the raw `missing-estimate` detail instead of parsing it. E22
  alone fails (German keeps `and 2 more`), 22 pass.

Restored hashes (`sha256sum -c` clean over all three drill files):

- `src/core/reporting/sources/estimate.ts`: `0e9d3d9b8f6cbcfe3a0b1897554acecbf0c851f3e6388de283ada15d296726f0` (drill tree `d0e13cb1…`, then the pre-commit hook's two renames: `??` for the text fallback, `isStrict` for the shape flag — behavior identical, drills re-verified by the post-restore run below)
- `src/runtime/reporting/reportInputs.ts`: `b70b76a6dbf1ebfdade69e2b4f736e17694e9260a2f3f3a5f952abb39e3e8d97`
- `src/shared/l10n/en.ts`: `a3dc1ab525ac9289d1af0984246f83906e42dd32a37f2e73f8f1436f3d6e236c`

Post-restore run: `estimateReportSource.test.ts` 23/23 pass.

## Suites run (MacBook, repository timeouts, `--maxWorkers=3`)

RVCM1134G round (final tree, after the `snap/f56fff679` merge and the
typed-diagnostic rewrite):

- `test/unit/estimateReportSource.test.ts`: 23/23 pass (E1–E19 rewritten
  for the typed contract, plus new E20 malformed-diagnostic honesty, E21
  overlapping-generation language capture and E22 twelve-lane producer
  rendering).
- `test/unit/reportInputs.test.ts`, `test/unit/reportsEntry.test.ts`,
  `test/unit/sessionReportSource.test.ts`: 45/45 pass.
- `test/unit/agentUsageSource.test.ts`, `test/unit/gitSource.test.ts`,
  `test/unit/changelogSource.test.ts`: 40/40 pass.
- `test/unit/reportsHost.test.ts`: pass;
  `test/unit/reportNetworkBinding.test.ts`: 1 failure (`shares one
serialized cache…`: `history.save` → `ownStart` → child spawn `EPERM`
  in this sandbox — same writer-lock probe as `reportEngine.test.ts`
  below, not this lane); `test/unit/paidMoneyStructure.test.ts`: the same
  five pre-existing leaves the review recorded
  (`journalStore.ts:apiEquivalentUsd`/`usd`,
  `reportingAmount.ts:capUsd`/`spentUsd`/`uncertainUsd`), none in this
  lane's files.
- `test/unit/spawnBoundaries.test.ts`,
  `test/unit/reportingPanel.test.ts`, `test/unit/reportsCommand.test.ts`:
  51/51 pass.
- `test/unit/reportingRequest.test.ts`,
  `test/unit/m113cLaneClosure.test.ts`: pass;
  `test/unit/estimateCommand.test.ts`: 1 failure (`dispatches estimate
help…`): the test spawns node with an env of only `PATH`+`LANG`, and
  node 24 fails at startup (`uv_os_homedir` ENOENT) with no `HOME` in this
  sandbox. Replicated outside vitest: the current tree's bundled entry
  prints help (exit 0) with `HOME` set and fails identically without it —
  environmental, not this lane.
- `test/unit/runtimeAccountsBundle.test.ts`,
  `test/unit/teamActivationGraph.test.ts`: pass (9/9).
- `test/unit/acpReports.test.ts`,
  `test/unit/estimatorDiagnostics.test.ts`,
  `test/unit/localSource.test.ts`: 323/323 pass.
- `test/unit/cliUsageProcess.test.ts`, `test/unit/execRun.test.ts`:
  99/99 pass.
- `test/unit/runtimeChatGpt.test.ts`: 29 fail / 6 pass — every failure
  goes through the `runMain` harness (fake process env without `HOME`,
  synthetic keyring, localhost callbacks), all sandbox-blocked. Reran the
  file on a pristine scratch clone of the merge commit without this
  round's edits: identical 29/6. Not this lane.
- `test/e2e/reports.e2e.test.ts`: 21 fail / 1 pass — CLI-child spawns,
  identical 21/1 on the pristine merge-commit clone. Not this lane.
- `test/unit/reportEngine.test.ts`: NOT RUN HERE (the writer-lock probe;
  the brief's standing rule). The lead runs it outside the sandbox, where
  the reviewer saw 4/4 pass.
- All five typechecks (`typecheck:host`, `:webview`, `:unit`, `:e2e`,
  `:integration`): green on the final tree.
- eslint `--max-warnings=0` and `prettier --check` on all touched files:
  clean (three test-file findings fixed: hoisted helper,
  `Promise.withResolvers`, definite-assignment declaration).
- `npx knip`: clean (two pre-existing config hints only). `npx jscpd`:
  0 clones (the four per-test `reasonFor` helpers folded into one).
- `npm run build`: `dist/reporting.js` 168.0 KiB (budget 175),
  `dist/reportInputs.js` 69.1 KiB (budget 100), `dist/estimator.js` 70.8
  KiB (budget 75), `dist/extension.js` 555.5 KiB (budget 600). Still OVER:
  `dist/usagePanel.js` 75.2 KiB (budget 75) — pre-existing, outside this
  lane's import graph, recorded in the previous round.
- `node scripts/check-bundle-split.mjs`: green.
  `node scripts/cycles.mjs`: 1 cycle
  (`src/shared/estimateDiagnostic.ts` ↔ `src/shared/estimate.ts`) —
  inherited from the merged `snap/f56fff679` round 7 (verified identical
  on the pristine merge commit); fixing it means editing the estimator's
  files, outside this lane, so it stays for the lead.
- `node scripts/check-l10n.mjs`: 0 problems (14 UI + 14 usage tables; new
  `estimateMissingMore` in every table). `npm run check:reference`, `npm
run check:roadmap`, `npm run check:host-api`: green.

Earlier rounds (kept for the record):

- `test/unit/estimateReportSource.test.ts`: 20/20 pass (E1–E16 with the new E15 table and E16 freshness lock, plus E17 cross-language refusals, E18 forged-sentence honesty and E19 codes-only collect).
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
  their table reasons; refusals keep the failed code and carry the
  estimator's validated typed diagnostic (code plus structured parameters,
  never a rendered sentence or a guess), rendered in the report language
  captured when the request starts; refusals without a valid diagnostic
  stay generic (report: failed table sentence; `/estimate`:
  `estimate-unavailable`) and forged failure sentences stay generic in
  every language; `--full` with capped rows throws
  `report/incompleteFullSource` through the shared forward path; row keys
  digest-hashed with an index disambiguator so duplicate engine rows
  cannot fail the section.
- Concurrency/lifecycle: reads share the generation stamp and honor the
  source timeout/cancellation through `localSource`; the VS Code reader is
  built per read behind the lazy inputs bundle; headless estimators are
  cached per workspace root and never read `process.cwd()` per read.
- Docs: README already promises `/report estimate M113` with no caveat, so
  no README change was needed; CHANGELOG `[Unreleased]` entry added and
  reworded to the verified seam in the RVCM1134G round; PLAN M113 status
  entry added; one new string (`estimateMissingMore`, in every table) for
  the re-rendered omitted-lane count; no featureCatalog change (no new
  command, setting or feature).

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

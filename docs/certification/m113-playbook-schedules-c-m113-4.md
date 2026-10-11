# M113 C-M113-4 certification — playbook and schedules kinds

2026-10-11, kubuntu rig, branch `c/m113-4a`, base `a0b69a03b` plus the
accepted c/m113-1 ordering fix (`snap/5369f3df7`, merged as `2db90b300`;
session.ts conflict kept both sides: c/m113-2's limits unit mapping with
c/m113-1's total-order tie-breaks).
No new dependency, paid/live call, credential, push, merge (beyond the
listed snap merge), gate relaxation or hook change. Shared core/runtime
logic serves VS Code, ACP and the terminal. No webview paint changed.

## What shipped

D93.4's playbook and schedules rows, end to end, in every supported host:

- `src/core/reporting/collect/playbook.ts` (new): pure journal view to
  the five sections (totals, decisions, drills, disabledRules,
  refusals). Strike counts come from the owner's `moduleStates` replay,
  projected by `sources/playbook.ts`, so the report matches enforcement.
  `--module <glob>` (`*`/`?` inside a segment, `**` across, `\` normalized
  to `/`) and `--milestone <id>` (case-insensitive, `M` optional, matched
  against module keys/ids, redesign lanes and lane ids) filter
  module-scoped rows; workspace-wide rows (settings, unscoped notes) stay
  under filters, never silently dropped. Out-of-range stamps render as
  their number, never a guessed date.
- `src/core/reporting/collect/schedules.ts` (new): pure store/fire view
  to the five sections (timeline, schedules, fires, refusals, cost).
  Collisions list the other schedules sharing a fire time; cost carries
  per-fire USD with certainty plus a summed total whose certainty is the
  weakest summed (no total over zero observed fires); exact settlement
  certainty reads as reported.
- `src/core/reporting/sources/playbook.ts`, `sources/schedules.ts`
  (new): kind-gated ports (`disabled` elsewhere, `unbound` without a
  reader), scrub-then-validate, journal inconsistency and corrupt
  store rows as `invalid`, IO/loss failures as `failed`.
- `src/runtime/reporting/playbookSchedulesInputs.ts` (+ entry/loader):
  lazy-chunk readers over the real `FilePlaybookJournal` and the
  production `createScheduleStore(createNodeScheduleFs(...))`; the
  schedules key is the delivery engine's own
  `workspaceKey(path.resolve(cwd))`, not the report storage key (they
  differ on Windows). The replay and store machinery measures ~37 KiB
  minified and would overflow the session/usage chunk (68.7 KiB of 100),
  so it rides its own `dist/playbookSchedulesInputs.js` (51.2 KiB
  measured, 59 KiB budget: measured +15%, rounded up to the next whole KiB,
  per the repair section below); no existing budget moves. The second chunk reuses the session/usage loader pattern
  through a shared `namedBundleLoader` guard in `src/host/lazyBundle.ts`.
- `src/runtime/reporting/engine.ts`: only the playbook and schedules
  kind-table lines flip to `local?.<kind> ?? unavailable(<kind>)`;
  estimate, fleet, security, accounts, issues and keybindings stay
  unavailable as before.
- VS Code (`reportPanelEntry.ts`), ACP and CLI (`main.ts`) construct
  both readers from the shared agent data folder.

Report labels and schedule-cell templates ship in English and all 14
translated tables, including the repaired `ended` label. This repair reuses
existing settlement-outcome and busy translations. No new command, setting,
dependency or activation import.
One new lazy chunk with its own budget (above); no existing budget
moves. Renderers, goldens, needs-you, the plan reader and the
session/usage inputs are untouched. Test shapes that three suites share
live in `test/unit/helpers/reporting/reportKindFixtures.ts`, so the
zero-tolerance duplication gate stays at 0 clones.

## Validation / security pass

- Secrets: journal/store strings pass the source scrub before validation
  and replay; regression asserts a canary in a decision and a schedule
  name never reaches a cell. Digests use the `_`-split form so M84's
  scrub preserves row keys without leaking identities.
- Failure paths: lost journal (marker without lines) and store IO fail
  as `failed`; malformed lines, schema-invalid rows and
  replay-inconsistent journals fail as `invalid`; other kinds read
  `notApplicable`; no reader reads `unbound`. Empty journals/stores are
  `ok` with empty sections; the cost total is absent with no fires.
- Concurrency/lifecycle: readers construct per read (no shared mutable
  state); the store's own lease guards its reads; sources share the
  request stamp and timeout through `localSource` like every other kind.
- Docs: README kinds table + prose, CHANGELOG `[Unreleased]`, PLAN M113
  C-M113-4 record, this file.

## Tests (all at the repository default timeout, `--maxWorkers=3`)

- `test/unit/collect.playbook.test.ts` (13): five sections/columns,
  glob matrices incl. `\` normalization, milestone filtering with
  workspace rows kept, out-of-range stamps, forward status columns and
  missing-heading placeholders.
- `test/unit/collect.schedules.test.ts` (6): five sections, collision
  flags, trigger/target/grant/creator/paused rows, refusals + summed
  cost, empty-fire honesty, forward columns.
- `test/unit/playbookReportSource.test.ts` (4): replayed strikes (1
  strike, aggregate round 1), scrubbed decisions, empty-ok,
  invalid/unavailable paths, notApplicable/unbound paths.
- `test/unit/schedulesReportSource.test.ts` (4): five sections,
  scrubbed names, empty-ok, invalid corrupt rows, notApplicable/unbound.
- `test/unit/reportPlaybookSchedules.test.ts` (5): real-directory
  readers (fresh/valid/lost/malformed journal; store create+list) and
  end-to-end generation of both kinds through the kind table.
- `test/e2e/reports.e2e.test.ts` (+3, 25/25 green): the real CLI binary
  reports playbook strikes/decisions, `--module` filtering, and
  schedules with triggers — through the production `main.ts` wiring
  and the real `reportInputs.js` bundle build.

## Red-drill receipts

Each drill mutated one guard, ran the owning file at the repository
default timeout, required the named red, and restored byte-exact
(SHA-256 before and after identical). No red mutation is retained.

- D1 (kind table): `playbook: local?.playbook ?? unavailable('playbook')`
  → `playbook: unavailable('playbook')` in
  `src/runtime/reporting/engine.ts`.
  `reportPlaybookSchedules.test.ts`: 1 failed (generates playbook and
  schedules reports end to end), 4 passed. Restored
  `src/runtime/reporting/engine.ts`:
  `fd75127489bd922a309e963e9bd1c0307da860976909fc28efae42b7e404671e`.
- D2 (refusals): `return rule === PLAYBOOK_SAFETY_RULE` →
  `return rule === PLAYBOOK_SAFETY_RULE && false` in
  `src/core/reporting/collect/playbook.ts`.
  `playbookReportSource.test.ts`: 1 failed (builds the five sections
  from journal records with replayed strikes), 3 passed. Restored
  `src/core/reporting/collect/playbook.ts`:
  `66a0ba7857a0768b69e38bec19ecc31caff5054146715e6c9160d31f6cdd075e`
  (a later intentional edit — the decisions `failure` column — moved it
  to `7981a16a9fd41fb827fa4f15f15113cfe13d2afc07418f5e6861efce86365567`,
  re-tested green in the runs above).

## RVCM1134A repairs (2026-10-11, same worktree, branch `c/m113-4a`)

Every P1/P2/P3 finding fixed as a class with a regression test drilled
red and restored byte-exact. No guard widened, no new dependency, diff
inside this lane's files. Pre-drill / post-restore SHA-256 identical for
every drilled file (hashes below are the fixed state).

| Finding                          | Fix                                                                                                                                                                                                                                                                                                                                                                                    | Regression test                                                                                                                                                               | Red drill                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P2 refusals list allowed notes   | `isRouteAroundRefusal(rule, code)` true only for a refusal: `checksPassed` (admitted command/hook check) and `fallbackReviewer` (applied fallback) never listed (`collect/playbook.ts`, caller `sources/playbook.ts:115`)                                                                                                                                                              | `collect.playbook.test.ts` "counts only true refusals"; `playbookReportSource.test.ts` "lists only true refusals" (admitted + fallback notes absent, `hookTampering` present) | guard → rule-only: named test fails (`expected true to be false`); restored `428271be…ddfb65d1f`                 |
| P2 `--milestone` substring match | whole-token match: token delimiters on both sides, one leading `M` allowed only as a delimited lane marker (`C-M113-4` names M113, `M13` never matches inside `M113`); empty filter matches nothing                                                                                                                                                                                    | `collect.playbook.test.ts` "matches milestones by whole token" (M113/M110/M110a0 keep own lanes; M13/M11/M1 keep none)                                                        | matcher → `includes`: named test fails; restored `428271be…ddfb65d1f`                                            |
| P2 paused schedule on timeline   | timeline and collision lists exclude `paused` schedules; they stay in the schedules table with paused status                                                                                                                                                                                                                                                                           | `collect.schedules.test.ts` "keeps a paused schedule out" + timeline count 3→2 in the two tests that encoded the bug                                                          | filter dropped: named test fails; restored `2aa65ae2…c90b99199`                                                  |
| P3 corrupt store reads `failed`  | reader maps `scheduleStoredJsonInvalid`, `scheduleWorkspaceMismatch`, `scheduleOutcomeIdentityMissing`, `scheduleFireIdentityMismatch`, `scheduleIndexRevisionMismatch`, `scheduleIndexDeltaInvalid`, `scheduleJournalLimitExceeded` and any `$ZodError` to `invalid`; I/O failures stay `failed` (`playbookSchedulesInputs.ts`)                                                       | new `playbookSchedulesInputs.test.ts`: corrupt fires JSON → `invalid`, file-as-root → `failed`, fresh store → empty ok                                                        | mapping → always `failed`: named test fails; restored `da1b3ec4…0852979439`                                      |
| P3 75 KiB budget bucket          | budget set by precedent: measured 52090 bytes (50.9 KiB, production build on the rig) +15% = 58.5 KiB, rounded up to **59 KiB** (`check-bundle-size.mjs`, CHANGELOG)                                                                                                                                                                                                                   | size gate itself: cap 50 → `OVER dist/playbookSchedulesInputs.js: 50.9 KiB`                                                                                                   | restored `6356aba8…f2b54a9f99`                                                                                   |
| P3 English literals in cells     | new labels `paused/active/all/total/once/user/hookVerification` (`REPORT_LABEL_KEYS`, en + 14 tables) and `reportScheduleCells` templates (interval/daily/weekdays/weekly/grant) read with `fill` at use time; `agent:id`/`conversation:id`/cron stay spliced/as-they-came per the technical-detail rule; `fr/es/pt-br` `reportLabels.total` cognate registered in `untranslated.json` | `collect.schedules/playbook`, `schedulesReportSource`, `reportStrings` (German runtime reads incl. `alle 3600000 ms`) updated                                                 | de `triggerInterval` slot dropped: unit test and `check-l10n` (0→1 problems) fail; restored `e6aef871…4cf4e3380` |
| P3 disabled-rule copies          | `pushDisabledRule` dedupes by (rule, actor, reason, at) across snapshots and `ruleDisabled` notes (`sources/playbook.ts`)                                                                                                                                                                                                                                                              | `playbookReportSource.test.ts` "dedupes one switched-off rule" (2 snapshots + note → 1 row)                                                                                   | dedupe dropped: named test fails; restored `6315cadf…74dba1bcda9`                                                |
| P3 drills heading                | section `playbook/drills` labelled `hookVerification` (new label + 14 tables; `forwardedKinds`, render fixtures, README/CHANGELOG/PLAN D93.4 row reworded to hook-verification receipts); the board's D96.7 break-on-purpose records are not journaled and no production board reader exists in scope, so the heading states what the journal holds                                    | `playbookReportSource.test.ts` "heads the receipts section"; `collect.playbook.test.ts` label list                                                                            | label → `drills`: named test fails; restored `428271be…ddfb65d1f`                                                |

Measurement: `dist/playbookSchedulesInputs.js` 52090 bytes after the
repairs (F4's mapping included); `dist/reporting.js` 172.2 of 175 KiB.
`node scripts/check-l10n.mjs`: 14 UI tables, 14 usage tables, 252
manifest strings, 1523 source files, 0 problems. `npx tsc --noEmit` clean.
Unit batches (repo timeout, `--maxWorkers=3`, kubuntu rig): collect.playbook

- collect.schedules + playbookReportSource 29 passed; schedulesReportSource
- playbookSchedulesInputs + reportStrings 24 passed (3 locale-cognate
  failures fixed via `untranslated.json`, then green); reportPlaybookSchedules
  5 passed. e2e `reports.e2e.test.ts` 25/25 passed at the repository
  timeout with the `Active` wording.
  `dist/usagePanel.js` 75.1-vs-75 OVER is pre-existing on this base (recorded
  above; untouched by this lane: the bundle contains none of the new strings).

## Open items (for the lead, not this lane)

- Independent reviews RVCM1134C and RVCM1134F ran; their findings are
  addressed in the repair records below. Final lead review is pending.
- The full production build currently fails only on `usagePanel.js`,
  76,938 bytes (75.1 KiB) against 75 KiB. Its 41 local metafile inputs are
  byte-identical to `ed0cd5000`, with no changed lane source in that bundle.
  The previous RVCM1134C "build green" receipt above does not reproduce on
  this rig. No cap or unrelated usage source is changed; this is reported
  to the lead alongside the known base test failures. The current readers
  and reporting engine pass their own unchanged budgets (receipts below).
- The estimate kind belongs to part B (lane CM1134B); issues to M115w;
  fleet/security/accounts/keybindings to their lanes. The `--milestone`
  matcher is whole-token (a wanted id matches only a whole token, with one
  leading `M` allowed as a lane marker), not the substring match the
  pre-repair prose below describes; tighten it if M116 ever records
  milestone ids directly.
- Restore checklist for these two kinds (0.17.1 truth pass): the
  kind-table rows (done here), no Help row was ever added for report
  kinds (session/usage have none either), no command completions gate
  kinds (they flow from `REPORT_KINDS`), README text (done here).

## RVCM1134C repairs (2026-10-11, same worktree, branch `c/m113-4a`)

Every P2/P3 finding fixed as a class with a regression test drilled red
and restored byte-exact. No guard widened, no new dependency, diff inside
this lane's files (the four report files below plus `en.ts`, `constants.ts`,
the 14 `l10n/ui.*.json` tables, five test files and this record).
Pre-drill / post-restore SHA-256 identical for every drilled file (hashes
below are the fixed state).

| Finding                                                         | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Regression test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Red drill                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 disabled-rule copies (one row per later `ruleDisabled` note) | `pushDisabledRule` keys rows by rule identity and keeps the earliest record (the switch-off, which precedes its acknowledgements in the journal), so 12 later notes are still one row and a second rule still fits past the 10-row cap (`sources/playbook.ts`)                                                                                                                                                                                                                                                                                                                     | `playbookReportSource.test.ts` "lists one switched-off rule once however many later notes repeat it" (settings + 12 distinctly-stamped notes → 1 row keeping the switch-off stamp)                                                                                                                                                                                                                                                                                                                                                                                                                               | identity → `[rule, actor, reason, at]`: named test fails; restored `18700ddb54df…`                                                                                                                                                    |
| P2 ended schedule on the upcoming timeline, labelled active     | `scheduleStatus(schedule, nowMs)` from the report's own `asOf` stamp (never the clock): `paused` wins, then `ended` (`fireCount` meets `afterRuns`, or `now` meets `end.atMs`), then `complete` (one-shot with no next fire: the store drops it on admission), else `active`; the timeline and collision lists keep only `active` time triggers, so ended, paused, fired one-shot and event/after-event entries are honest omissions while every schedule keeps its table row (`collect/schedules.ts`); new `reportLabels.ended` in `en.ts`, `REPORT_LABEL_KEYS` and all 14 tables | `collect.schedules.test.ts` "gives every scheduler and store status its honest row or omission" (9 schedules: live, paused-past-end, spent-runs, past-end-date, one-shot fired/armed, event armed/stored-time, after-event stored-time → statuses paused/ended/ended/complete/active/active/active/active and timeline `['Live interval', 'One-shot armed']`); `playbookSchedulesInputs.test.ts` "omits a removed schedule instead of listing it as deleted" (real store create + remove → empty read: deleted is an omission, and there is no disabled flag on `ScheduleV2` — paused is the switched-off state) | filter → `!== 'paused'`: named test fails (ended/event rows return); restored byte-exact to the pre-drill bytes, then a lint fix dropped a redundant `export` on the in-file helper (fixed state `c1f550254989…`, tests re-run green) |
| P3 English trigger/target/delivery/creator cells                | the source pre-renders `targetText` (`scheduleV2.targets.*` word + spliced technical id), `deliveryText` (`scheduleV2.delivery.*`), `creatorText` (`scheduleV2.labels.creator` + spliced agent id, `undefined` for a user) and event/afterEvent triggers (`scheduleV2.triggers.event/afterEvent` + spliced `source:event`); the pure collector reads only the view, never the text table (`sources/schedules.ts`, `collect/schedules.ts`); cron expressions and ids stay as-they-came per the technical-detail rule                                                                | `schedulesReportSource.test.ts` "renders event triggers, targets, delivery and agent creators in German" (`Bei einem Ereignis: github:pullRequestOpened`, `Arbeitsagent: worker-1`, `Laufenden Durchgang lenken`, `Ersteller: agent-1`, event trigger absent from the timeline); `collect.schedules.test.ts` agent-creator pass-through; `reportStrings.test.ts` asserts `ended` → `Beendet`                                                                                                                                                                                                                     | `deliveryText` → raw enum: German test fails; restored `caee45b38a76…`                                                                                                                                                                |
| P3 fencing-token regression reads `failed`                      | `scheduleJournalOwnershipLost` joins `SCHEDULE_CONTENT_FAILURES`, so a superseded writer's stale delta reads `invalid` (corrupt data) while genuine I/O failures stay `failed` (`playbookSchedulesInputs.ts`); `scheduleIndexMissing` (a delta vanishing mid-read) stays `failed` as an I/O race, not content                                                                                                                                                                                                                                                                      | `playbookSchedulesInputs.test.ts` "reads a fencing-token regression as invalid, never a generic failure" (real store, two schedules, second delta's token lowered below the first's → `invalid`)                                                                                                                                                                                                                                                                                                                                                                                                                 | mapping dropped: named test fails with `expected 'failed' to be 'invalid'`; restored `6692c2ddb62b…`                                                                                                                                  |
| P3 certification prose contradicts the repair                   | "What shipped" now reads 50.9 KiB measured with the 59 KiB cap, and the open items name the whole-token milestone matcher and point at the repair section instead of the superseded 50.5-of-75 / substring sentences (this file)                                                                                                                                                                                                                                                                                                                                                   | no code guard watches prose: verified by re-reading the repaired lines against `scripts/check-bundle-size.mjs:31` (59 KiB) and `collect/playbook.ts:76` (whole-token)                                                                                                                                                                                                                                                                                                                                                                                                                                            | not applicable (prose, no guard to break)                                                                                                                                                                                             |

Gates on the kubuntu rig, repository default timeout, `--maxWorkers=3`:
`npx tsc` clean; `eslint --max-warnings=0` clean on all changed files;
`prettier --check` clean; `node scripts/check-l10n.mjs` 0 problems;
`npm run deadcode` (knip) clean; `npm run duplication` (jscpd) 0 clones
(the two new reader tests first tripped the zero-clone gate against the
older reader tests, so all five tests in `playbookSchedulesInputs.test.ts`
now share one temp-root/reader helper); `npm run check:host-api`
0 problems; `npm run build` green with `dist/playbookSchedulesInputs.js`
still 50.9 KiB of 59. Unit batches: playbookReportSource 8, collect.schedules
9, schedulesReportSource 6, playbookSchedulesInputs 5, reportStrings 17,
reportPlaybookSchedules 5, collect.playbook 15 — all passed; e2e
`reports.e2e.test.ts` 25/25 passed including the three playbook and
schedules CLI cases.

## RVCM1134F repairs (2026-10-11, CM1134AR4)

Base `ed0cd50002030cf3d15d673b8bf7de173fa79491`, Kubuntu, branch `c/m113-4a`.
All seven findings are repaired by class. New regression matrices were
written and observed red before the code repair; deliberate reversions below
then proved each guard still fires. The earlier repair tables are historical;
this section supersedes their earliest-disabled-record and ownership-loss
classification claims. No dependency, gate, hook, paid/live call, push or merge
changed. Shared core/runtime logic remains the path for editor, ACP and CLI.

| Finding                                      | Fix                                                                                                                                                                                                                                                                                                      | Regression coverage                                                                                                                                                                                                                                                                                                                                                                                           | Red drill                                                                                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 P2 obsolete disabled state                | Replay the latest complete settings snapshot per team, exactly as policy does; disabled rows retain that snapshot's actor, reason and time, with team in the row identity and scope column. Acknowledgement notes never resurrect old settings.                                                          | `playbookReportSource.test.ts`: all eight configurable rules × re-enable, re-disable, changed details, identical disables in two teams, independent team re-enable and note-only/default-on history. Existing repeated-note/row-cap checks remain.                                                                                                                                                            | `F1-current-settings`: keep first snapshot → all eight rule tests fail.                                                                                                                                                                         |
| F2 P2 fired one-shot / inconsistent timeline | Counts/cursor facts exhaust admitted one-shots even when manual admission keeps the cache. All timed occurrences obey the exclusive end bound. Reader compares ordered schedule id/revision sets before and after the locked fire-history read, retrying a changed generation within the existing cap.   | `collect.schedules.test.ts`: manual admission, fired cursor, before/end/beyond-end occurrences for every trigger kind, plus existing paused/ended/event/deleted matrix. `playbookSchedulesInputs.test.ts`: real store manual admission + settlement between the initial schedule read and history read, preserving the cached time; production time plan agrees and no upcoming row survives.                 | `F2-manual-once`, `F2-end-cutoff`, `F2-snapshot`: each guard removal fails its named matrix/interleaving test.                                                                                                                                  |
| F3 P2 shipped schema drift                   | Regenerate the complete report-v1 JSON Schema from the runtime contract, including all previously missing labels.                                                                                                                                                                                        | `reportSchema.test.ts`: generate both kinds with every lifecycle/certainty branch and every schema outcome, collect all emitted section/column/cell labels, validate whole documents and each label cell using the shipped schema; generated-schema equality remains.                                                                                                                                         | `F3-shipped-label`: remove `ended` from shipped enums → document/label validation and freshness fail.                                                                                                                                           |
| F4 P2 cross-request languages                | Capture a table at generation start and carry it through sources; every schedule translator uses that table, and the local-source wrapper uses it for delayed failure reasons. Pure collectors consume pre-rendered prose/label keys.                                                                    | `reportPlaybookSchedules.test.ts`: overlapping German/English engine generations resolve English first, including a mutable process-table alias, and retain request-owned trigger/target/delivery/creator/grant/outcome/source-reason text. `schedulesReportSource.test.ts`: full schema-derived trigger/target/delivery/creator matrix compared with sequential locale baselines, plus delayed busy failure. | `F4-engine-snapshot`: retain the process-table alias → engine overlap fails. `F4-request-table`: read global after await → both overlap tests fail. `F4-failure-table`: ignore captured table for failure reason → delayed-language test fails. |
| F5 P3 writer contention called corruption    | A regressing stored token has the distinct internal word `scheduleJournalFencingRegression` (the only schedule-journal change). `scheduleJournalOwnershipLost` and `scheduleQueueOwnershipLost` are bounded retries; exhausted retries are unavailable with the existing translated `Host busy` wording. | `playbookSchedulesInputs.test.ts`: actual immutable fencing-CAS interleaving with a winning valid writer, persistent contention for both error words with exact retry count, corrupt real-directory token regression, damaged JSON, I/O failure and fresh/removed stores.                                                                                                                                     | `F5-contention`: classify lost publication as invalid → valid-writer/persistent-busy tests fail. `F5-fencing-regression`: restore ambiguous corruption word → corrupt-token classification fails.                                               |
| F6 P3 English recent-fire outcomes           | The source pre-renders the closed outcome enum through the request table's existing `scheduleSettlement.outcomes`; the collector never emits raw enum words.                                                                                                                                             | `schedulesReportSource.test.ts`: all five schema outcomes in every one of the 14 installed language tables (70 cells), plus English and overlapping German/English engine checks.                                                                                                                                                                                                                             | `F6-local-outcomes`: emit enum → all 14 locale tests fail.                                                                                                                                                                                      |
| F7 P3 stale budget/string documentation      | PLAN and current certification describe the existing 59 KiB cap and translated labels/templates; README/CHANGELOG describe current rows, snapshots, outcomes and request languages. The M113 roadmap entry includes the two kinds and regenerated roadmap tracks this repair.                            | `reportPlaybookSchedules.test.ts`: plan budget compared with the actual size gate and translated-string sentence checked against the lane record; roadmap/schema/localization freshness checks.                                                                                                                                                                                                               | `F7-plan-prose`: restore 75 KiB/no-new-string claims → named documentation regression fails.                                                                                                                                                    |

The shared parameter for integration is **`SourceReadContext.reportText?: UiText`**.
`generate()` copies `context.l10n.table` once before awaiting; `localSource()`
passes it to the reader and source callback, capturing a fallback at read start
for direct source callers. Schedule text helpers require `reportText: UiText`;
no helper reads the process table after awaiting. Other kinds' composed-text
repairs remain on their own branches; their owners can reuse this named field.
The new internal local failure code is `busy`, using an existing translated key.
The test-only JSON Schema type cast is explained inline and in PLAN §8.

### Byte-exact drill receipts

Every drill ran its complete owning file(s), at repository defaults with
`--maxWorkers=3`, without test-name filters or timeout overrides. Each exited 1
for the named regression, then restored its pre-mutation bytes and SHA-256.

| Drill                   | File                                               | Pre-drill = restored SHA-256                                       |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `F1-current-settings`   | `src/core/reporting/sources/playbook.ts`           | `d5f225823c3829f5bab9b54c794c8be7323e21ccfe2778f56365e4a1d0d5c047` |
| `F2-manual-once`        | `src/core/reporting/collect/schedules.ts`          | `59ec8c0c5ed16f41c2dff8178484c8d05c8130741eac7e78c18a25d621dd7f32` |
| `F2-end-cutoff`         | `src/core/reporting/collect/schedules.ts`          | `59ec8c0c5ed16f41c2dff8178484c8d05c8130741eac7e78c18a25d621dd7f32` |
| `F2-snapshot`           | `src/runtime/reporting/playbookSchedulesInputs.ts` | `4ba8dbcde7b388a07fa95abc75dabbb3478c9928a59f47430faadf8a879e4bf2` |
| `F3-shipped-label`      | `docs/schemas/report-v1.schema.json`               | `7f0bb113443217d683493e75d2ec02622f634be968f4e98c993782f4f0870707` |
| `F4-request-table`      | `src/core/reporting/sources/schedules.ts`          | `49f8ee39b73ee9911f86cb7bdce2360124527052973b4db23d8104928600e02d` |
| `F4-engine-snapshot`    | `src/runtime/reporting/engine.ts`                  | `476577df16aa81ca95e9d7d3522a63d5afb25e3df3c0bad906ecf062e49404c3` |
| `F4-failure-table`      | `src/core/reporting/sources/local.ts`              | `6b6fc81bb5c2f0786f6d26911b500d7a96d9fe627e847628d22dad796e3ee2d8` |
| `F5-contention`         | `src/runtime/reporting/playbookSchedulesInputs.ts` | `4ba8dbcde7b388a07fa95abc75dabbb3478c9928a59f47430faadf8a879e4bf2` |
| `F5-fencing-regression` | `src/core/schedules/journal.ts`                    | `57854bf3494afaeb81cf5a8fd947626546cd8e18bc383df503ab0c6161bb36f4` |
| `F6-local-outcomes`     | `src/core/reporting/sources/schedules.ts`          | `49f8ee39b73ee9911f86cb7bdce2360124527052973b4db23d8104928600e02d` |
| `F7-plan-prose`         | `PLAN.md`                                          | `907a055dbd4badc5a6708c195a067d11cab653a62fdb44b6c51911f6510047c0` |

### Final qualification and dependent inventory

All commands ran directly on Kubuntu, one Vitest/typecheck/lint/build at a
time. Final Vitest runs use the repository's own timeouts and
`--maxWorkers=3`; every invocation contains at most three complete files.
No test-name filter, skip, raised timeout or gate exemption was added.

`npm run typecheck` passed all five projects (host, webview, unit, e2e and
integration). `npm run typecheck:unit` also passed after strengthening the
mutable-alias test. Scoped ESLint (`--max-warnings=0`, all 16 changed TypeScript
files) and Prettier (all 23 changed files) passed. Plain `npm run deadcode`,
`npm run duplication` (zero clones), `npm run check:l10n` (14 UI tables,
14 usage tables, 252 manifest strings, 1,523 source files, zero problems),
`npm run check:host-api`, `npm run check:reference`, report schema freshness,
and generated roadmap/freshness passed. The first duplication run caught
repeated trigger fixtures; sharing the existing test helper removed the clone
without changing the zero-clone gate. The first roadmap generation caught an
oversized summary; the summary was shortened without changing its bound.

The official production build completed bundling and failed the size gate
only on the inherited usage-panel overage. Because `npm run build` stops there,
its remaining commands were run separately: `check-bundle-split.mjs`,
`check-host-globals.mjs` and `third-party-notices.mjs` all passed.

| Production bundle                 |   Bytes |         Unchanged cap | Result                     |
| --------------------------------- | ------: | --------------------: | -------------------------- |
| `dist/reporting.js`               | 177,352 |               175 KiB | 173.2 KiB, pass            |
| `dist/playbookSchedulesInputs.js` |  52,431 |                59 KiB | 51.2 KiB, pass             |
| `dist/usagePanel.js`              |  76,938 | 75 KiB (76,800 bytes) | inherited 138-byte overage |

The usage-panel proof uses the official host plugins, node20.18 target,
production minification and `write: false`. All 41 local metafile inputs match
base `ed0cd5000`; rebuilding those unchanged inputs gives exactly the current
bundle bytes, SHA-256
`07ebc4eacee58f5c22d8533bef469651b3e726541a45587c2c0d4e156b27dc9f`.
No lane source is in that bundle. The extension (550.7/600 KiB) and Model API
(515.8/525 KiB) also pass. No cap was moved.

Vitest's related-specification inventory for all nine changed source paths
contains **35 files**, all attempted. Each of twelve shards ran the actual
`npx vitest related --run <changed-source-paths> --maxWorkers=3
--shard=N/12` command; the result-file union was checked against the inventory.
No dependent file is omitted. Total: **1,223 passed, two failed, zero skipped**.
Files below are under `test/unit/` unless prefixed `test/e2e/`.

| Related shard | Complete files                                                                                     | Passed | Failed |
| ------------- | -------------------------------------------------------------------------------------------------- | -----: | -----: |
| related-01    | `reportContracts.test.ts`, `reportsEntry.test.ts`, `schedulesReportSource.test.ts`                 |     65 |      0 |
| related-02    | `agentUsageSource.test.ts`, `scheduleOutbox.test.ts`, `sessionReportSource.test.ts`                |     65 |      1 |
| related-03    | `collect.playbook.test.ts`, `gitSource.test.ts`, `reportSchema.test.ts`                            |     31 |      0 |
| related-04    | `reportPosting.test.ts`, `scheduleJournal.test.ts`, `scheduler.test.ts`                            |     86 |      0 |
| related-05    | `collect.schedules.test.ts`, `reportEngine.test.ts`, `reportSelections.test.ts`                    |     35 |      0 |
| related-06    | `githubReportSource.test.ts`, `playbookSchedulesInputs.test.ts`, `scheduleRestartRecovery.test.ts` |     48 |      0 |
| related-07    | `playbookReportSource.test.ts`, `reportNetworkBinding.test.ts`, `scheduleFs.test.ts`               |     32 |      0 |
| related-08    | `conversationController.test.ts`, `localSource.test.ts`, `reportInputs.test.ts`                    |    708 |      0 |
| related-09    | `changelogSource.test.ts`, `paidPortBoundaries.test.ts`, `scheduleMigrate.test.ts`                 |     47 |      0 |
| related-10    | `test/e2e/reports.e2e.test.ts`, `paidMoneyStructure.test.ts`, `reportUsage.test.ts`                |     49 |      1 |
| related-11    | `reportsHost.test.ts`, `scheduleRuntimeEntry.test.ts`, `scheduleStore.test.ts`                     |     40 |      0 |
| related-12    | `reportPlaybookSchedules.test.ts`, `spawnBoundaries.test.ts`                                       |     17 |      0 |

The two dependent failures match the review's base receipts. Their tests and
relevant source files are unchanged from `ed0cd5000`:

- `sessionReportSource.test.ts:398` expects eight source ids but receives ten,
  including the existing playbook/schedules bindings.
- `paidMoneyStructure.test.ts:1143` names five pre-existing numeric money leaves:
  `src/core/usage/journalStore.ts` (`apiEquivalentUsd`, `usd`) and
  `src/core/usage/reportingAmount.ts` (`capUsd`, `spentUsd`, `uncertainUsd`).
  This assertion alone does not establish an accounting defect.

Additional host/lazy-entry suites were run explicitly, **nine more files**:

| Host batch | Complete files                                                                       | Passed | Failed | Skipped |
| ---------- | ------------------------------------------------------------------------------------ | -----: | -----: | ------: |
| hosts-01   | `acpReports.test.ts`, `acpRuntime.test.ts`, `test/e2e/acpStdio.e2e.test.ts`          |     63 |      0 |       0 |
| hosts-02   | `test/e2e/execStdio.e2e.test.ts`, `reportingPanel.test.ts`, `reportsCommand.test.ts` |     44 |     29 |      12 |
| hosts-03   | `reportingRequest.test.ts`, `reportInvariants.test.ts`, `reportStrings.test.ts`      |     22 |      0 |       0 |

All eight non-exec additional suites pass (**126 tests**), including all 44 ACP
runtime tests at the unchanged default timeout. Exec stdio has **3 passed,
29 failed, 12 skipped**, plus one built-exec setup failure. Its package-guard
fixtures report all 14 packaged UI tables differing from source; the
built-exec `beforeAll` also exits 1 at
`scripts/check-l10n.mjs --packaged-acp dist/acp-package`
(`test/e2e/execStdio.e2e.test.ts:794`). The base review saw a package-guard hook
hit its existing 60-second limit and the same built-exec checker fail, leaving
all 44 skipped. That hook timeout did not recur here; the inherited packaged
localization failure is now visible. The fixture was not changed or chased,
as this repair brief directs. Exec behavior remains unverified.

After the extra engine-copy red drill, the final unmutated three-file batch
(`reportPlaybookSchedules`, `reportSchema`, `schedulesReportSource`) passed
**32/32**, including the mutable process-table alias and all language matrices.
There are **12 red drills**, each with observed named failure and byte-exact
restoration above. No finding from RVCM1134F remains open.

Changed scope: six core reporting files (`collect/playbook`,
`collect/schedules`, `sources/local`, `sources/playbook`, `sources/schedules`,
`sources/types`), the single journal error word in `core/schedules/journal`,
and the two runtime files `reporting/engine` and
`reporting/playbookSchedulesInputs`; six owning test files plus the existing
`helpers/reporting/reportKindFixtures` helper; README, CHANGELOG, PLAN,
ROADMAP/entries, shipped schema and this record (23 files total).
Aggregate quality/full-suite, Windows/macOS, installed editors and production
packaging remain lead-owned and were not run. No sandbox restriction occurred;
no install, credential read, paid/live model call, push, merge or rebase occurred.
PLAN §7 records the inherited gate deferrals. All installed commit hooks remain
unchanged and enabled; post-hook committed diff is re-read before handoff.

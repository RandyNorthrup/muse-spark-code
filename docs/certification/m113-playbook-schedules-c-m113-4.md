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

## CM1134AR5 — RVCM1134H contention findings (2026-10-12, kubuntu rig)

Both findings fixed as classes, inside the schedules kind, the schedules
filesystem port and its in-memory twin. No timeout constant changed, no guard
widened, no new dependency. Final file hashes (SHA-256):
`playbookSchedulesInputs.ts e02a8ee2…`,
`nodeScheduleFs.ts cdcad3f6ec7f5d85e2e32c8e096bd5ff6db5f53a08bc1511744e4f74d232a1f3`
(corrected from the historical post-hook `6c9f58dd5` blob; RVCM1134J P3-7),
`twin storage.ts` (post-lint; hash in commit), `journal.ts 53e85212…`.

### P2 — a cancelled or timed-out source read stops, never abandons

The reader passes its `AbortSignal` and its deadline (read start plus
`REPORT_SOURCE_TIMEOUT_MS`, less one `SCHEDULE_LEASE_POLL_MS` turn of settle
budget so the verdict precedes the source's own timeout) through a
delegating port wrapper into every `lock` acquisition; the store, journal
and port signatures are otherwise untouched. `ScheduleFsPort.lock` takes an
optional `ScheduleLockOptions` (`src/core/schedules/journal.ts`). The
production wait loop checks the deadline first, then the signal, on every
turn and before the single unguarded write; both lease guards check the
signal before their ownership re-read, so no read, write or publish follows
a stop. The in-memory twin waits race the chain against abort and deadline
timers, names the terminal word on the rejection path (a rejecting race
skips straight to the outer catch, so a post-race check would never run),
and links an abandoned slot to its predecessor instead of stranding the
chain; its guard carries the abort into every guarded publish. A valid
holder past the wait reports the Host busy sentence, never cancelled; an
explicit abort still reports cancelled. One dependent-run catch is recorded
honestly: the twin's first success path deleted its tail without resolving
it, stranding queued waiters (`scheduleMigrate` failed 3); the fix resolves
first and deletes only when still last.

Tests (`test/unit/playbookSchedulesInputs.test.ts`, contention suite):
production held lease past the 5 s deadline over the production store,
reader and source (busy sentence, one lock attempt, call counts frozen
across release); five sequential refreshes against a persistent holder
(all busy, no new fence file, fresh read ok after release; the holder's
own heartbeat pulses are filtered from the inventory); memory queued
reader (busy, single attempt, frozen calls, chain unlinked, empty tails);
explicit mid-wait abort (cancelled sentence, no later publish).

### P3 — one classification per word, in one table

The table lives on the reader (`SCHEDULE_BUSY_FAILURES` plus
`SCHEDULE_CONTENT_FAILURES` with the prose table above them).
`scheduleQueueOwnershipLost` stays busy-and-retried (listed fence vanished,
heartbeat/identity takeover mid-read, guard takeover: another writer
resolves). `scheduleJournalOwnershipLost` stays busy-and-retried (CAS slot
lost). New `scheduleQueueLeaseInvalid`: a fence header whose token
contradicts its file name or segment, or carries none (fences and tokens
arrived together in `03d5d6607`, so a tokenless header is foreign), is
invalid at once, never retried. New `scheduleLeaseBusy`: the reader's own
wait expired with a valid holder; busy at once, never retried. All eight
stored-content words plus `$ZodError` stay invalid; `scheduleIndexMissing`
and the storage path/link refusals stay failed. Write-path words are out of
the read's reach and out of the table's scope.

Tests: one per word. New: three forged fence identities (token above file
name, file name above token, no token — each invalid with exactly one lock
call); transient listed-then-vanished fence (first attempt loses, retry
heals to a successful read); `scheduleLeaseBusy` terminality (single lock
call in the contention tests); per-word forges for `scheduleFireIdentityMismatch`,
`scheduleWorkspaceMismatch`, `scheduleOutcomeIdentityMissing`,
`scheduleIndexRevisionMismatch`, `scheduleIndexDeltaInvalid`,
`scheduleJournalLimitExceeded`, `$ZodError` (invalid) and
`scheduleIndexMissing`, `scheduleStorageLinkRefused` (failed). Existing:
damaged JSON, fencing regression, journal-CAS retry, queue-ownership retry.

### Red drills (all restored byte-exact, SHA-256 compared)

- D1: reader delegation drops `{ signal, deadlineMs }` → held-lease test
  fails with "cancelled or timed out" (the reviewer's symptom). Restored.
- D2: twin race loses its rejection-path mapping → memory test fails with
  `failed` (sentinel escapes) instead of `busy`. Restored.
- D3: fence word reverts to `scheduleQueueOwnershipLost` → all three
  identity tests fail (busy after retry, not invalid at once). Restored.
- D4: production deadline throws neutralised → held-lease test fails with
  "cancelled or timed out". Restored.

### Verification (kubuntu, load average ~18)

Owning file 26/26; review shards: 1 (65, one load flake green on rerun),
2 (65 + inherited `sessionReportSource` 8-vs-10), 3–8 green
(31/86/35/65/32/708), 9 green after the twin fix (47), 10 (49 + inherited
`paidMoneyStructure`), 11–12 green (40/17). All five typechecks, ESLint and
Prettier clean on the five changed files. Shard e2e (`reports.e2e`) ran.
NOT RUN HERE: none — every named suite ran on this rig at repository
timeouts (three per-case named timeouts with §8 reasons). The two failing
tests are byte-identical to the base review's inherited receipts; no
changed file overlaps them.

## CM1134AR6 — RVCM1134J structural lifecycle redesign (2026-10-12, kubuntu)

All seven findings are owned here. The port's acquisition, held-work completion,
heartbeat drain and release are one lifecycle, reused by the in-memory twin.
`AsyncLocalStorage` carries the one stop rule into nested port/primitive awaits;
`scheduleFsOperation` checks immediately before dispatch and on settlement.
Acquisition checks deadline first, then abort; held work checks abort. Cleanup
owns a separate `SCHEDULE_LEASE_RELEASE_TIMEOUT_MS` (1,000 ms) window, never the
caller's signal. The outer finally exists before the first candidate fence can
be published. Only the exclusive-publication success path constructs the
release handle (`OwnedScheduleFence`); a publication interrupted by a stop is
claimed only when the stored candidate bytes carry the acquisition's unique
token, so a cancelled loser releases nothing of the winner. (Corrected
CM1134AR7 for RVCM1134K P2-1: the previous sentence claimed a token check the
implementation did not perform.) Temporary handles are owned before their open and
closed in independent cleanup scopes. Completed work drains the heartbeat
before its final stop/ownership verdict, including an abort during that drain.

The source-derived matrix enumerates every lifecycle wrapper call site on both
ports and each acquisition primitive on its own port, including duplicate stat
sites, transient retries and committed-link identity/readback branches. Only
release-only directory removals are outside acquisition rows; the raw-await
AST check still guards them. Every row injects abort/deadline at the post-await
barrier, asserts injection, the verdict and zero subsequent caller-scope
operations, verifies every owned release marker, and acquires again with the
ordinary 100 ms writer deadline. Heartbeats after acquisition remain bound to
abort alone. Pulse token, PID, process start and fencing token contradictions
run against both stores through the real report reader: invalid, one lock call.
Queue vocabulary is a `Record<ScheduleQueueFailure, ...>` table with `satisfies`,
and a typed error constructor rejects an undeclared word at compilation;
its coverage test derives both the union and every emitted queue word from the
port's AST, including unexecuted branches. Heartbeat failure has its own row.

The twin queues reuse that lifecycle, check held cancellation at completion,
and delete an abandoned last tail when its predecessor settles. Independent
memory port instances can share the byte store/queue, so assertions observe the
reader without counting the holder's own heartbeat or release. The transient
fixture now compares relative normalized paths and asserts injection; the
explicit-abort regression releases and settles the holder before freezing all
reader publication counts. No cast, ignore, dependency, existing deadline,
engine.ts or scheduler.ts change.

Writer assurance: isolated default-timeout runs pass scheduleFs 14/14,
scheduleMigrate 15/15, scheduleStore 25/25, scheduleJournal 23/23, the reader
33/33 and the lifecycle matrix 109/109 (loads 5–18; a 109/109 pass was also
observed at load ~19). The review's loaded concurrent reds did not reproduce
in isolation. The lifecycle matrix's second 100 ms acquisition misses its
self-deadline under extreme rig load (15+: one to six rows per run, always raw
`scheduleLeaseBusy` after the release marker verified present), so a red full
file at such load is re-run alone per the rig rules and the load recorded; the
brief's 100 ms ordinary-writer requirement is unchanged.
`helpers/fixtureBudget.ts` now prepares cold native journal/handle fixtures,
legacy migration files and process-race store seeds outside the unchanged test
deadlines. Native handles are prepared only in their owning beforeEach; an
unrelated afterEach cannot release them before the actual assertion. The final
`vitest related` closure over both changed sources (12 files, 329 tests, rig
load ~22) gave 320 passed with zero assertion failures: eight lifecycle 100 ms
load rows and one 5 s migrate timeout, all green in the solo runs recorded in
this record (migrate 15/15 solo immediately after the closure). The two
scheduleJournal regressions the closure exposed are fixed above and green
23/23 in that same closure run.

### Executable source identity

The record's hash is generated, not copied by hand. On this rig files use LF;
Windows CRLF checkouts normalize to the committed LF for the matching test.
Run from the worktree after lint/format (and verify after the installed hook):

```sh
python3 - <<'PYHASH'
from pathlib import Path
from hashlib import sha256
p = Path('src/runtime/schedules/nodeScheduleFs.ts')
print(sha256(p.read_bytes().replace(b'\r\n', b'\n')).hexdigest())
PYHASH
```

<!-- CM1134AR6 port SHA-256: 0a8062bc336a7f918b2fe7e4237ef473c75fa9aea5a6af55d47c7701b6e113ff -->
<!-- CM1134AR7 port SHA-256: 5fae331fdc1d00fd1c779c6e5c166ac2485a002815f3402c16f4b592259bea42 -->
<!-- CM1134AR8 port SHA-256: 7486edbf8abdd1120a0f1d0c578865b86d6a4e1c1f0d5b78090ca1853904e30f -->

`nodeScheduleFs.ts` markers: AR6 `0a8062bc…`, AR7 `5fae331f…`, AR8
`7486edbf8abdd1120a0f1d0c578865b86d6a4e1c1f0d5b78090ca1853904e30f`
(re-marked 2026-10-19: the unicorn 77 comment reflow changed only `/**`
asterisk prefixes, no code).
The lifecycle suite compares the AR8 marker against the actual source; a
stale certification fails. (Correction 2026-10-12: this line named only the
AR6 marker while the suite already compared the AR7 one. Correction
2026-10-19, JOIN0190: the AR8 marker now certifies the joined port bytes,
which carry the lane's newer schedule-filesystem work past 164's base.)

### Red drills — observed failure, then byte-exact restoration

Every drill ran the complete owning file, at repository timeouts and at most
three workers; no test-name filter or timeout override. Both vocabulary drills
also ran `npm run typecheck:host` and observed the missing-word compile error.
The paused-heartbeat regression holds the actual pulse publication, returns
work, flushes completion microtasks, and asserts no completion read starts
until that pulse settles; removing the drain fails on both ports. An earlier
20 ms heartbeat fixture did not reliably catch that mutation, so it was
replaced by this controlled barrier and drilled again. The initial hash drill
also saw one 100 ms writer acquisition miss under real filesystem load; it
passed on the subsequent complete-file rerun, with the deadline unchanged.
Final restored owner run: lifecycle **109/109**, reader **33/33**.

All twelve drills below ran against the final bytes (`0a8062bc…`, the marker
above), each as a complete owning file at repository timeouts with at most
three workers; every restoration was verified byte-exact by SHA-256. D1 removes
the settlement check, so the stop injection never fires and every stop-matrix
row fails its gating assertion. D5 removes the `lease.segments` wrapper call,
so its four matrix rows vanish and the file runs 105 tests. Any port mutation
also fails the cert-marker test, which is counted where it fired. D4 observed
`error TS1360` and D12 observed `error TS2345` under `npm run typecheck:host`.
Load-flake rows (the brief's 100 ms second-acquisition misses at rig load
15–22, each with its release marker verified present first) are named
separately from each drill's deterministic signal.

| Drill                  | Deliberate break                                                         | Named failure                          | Failed / passed                          |
| ---------------------- | ------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------- |
| D1-stop-settlement     | Skip the post-await stop check                                           | stop matrix, injection never fires     | 95 failed, 14 passed (109)               |
| D2-independent-release | Make cleanup call the caller stop check                                  | release/next-writer rows               | 38 failed, 71 passed (109)               |
| D3-pulse-identity      | Misclassify contradictory pulse identity as transient ownership loss     | `immutable heartbeat` (8) + marker (1) | 12 failed, 97 passed (109); +3 load rows |
| D4-vocabulary          | Add a union word without its classification row (also fails compilation) | `covers the source union`              | 1 failed, 32 passed (33)                 |
| D5-raw-await           | Await the port listing outside the structural wrapper                    | `allows no raw awaited` + marker       | 4 failed, 101 passed (105); +2 load rows |
| D6-transient-fence     | Misclassify listed-then-vanished fence as invalid                        | `heals a fence entry`                  | 1 failed, 32 passed (33)                 |
| D7-explicit-abort      | Drop only the delegated abort signal                                     | `still reports an explicit abort`      | 1 failed, 32 passed (33)                 |
| D8-abandoned-tail      | Resolve an abandoned tail without deleting it                            | `removes the last expired memory tail` | 1 failed, 108 passed (109)               |
| D9-held-completion     | Omit the final held-work stop/ownership guard                            | `rejects held work`                    | 4 failed, 105 passed (109)               |
| D10-certification      | Replace the recorded source hash with zeroes                             | `certification identifies`             | 1 failed, 108 passed (109)               |
| D12-new-emission       | Add an unexecuted undeclared queue word (also fails compilation)         | `covers the source union`              | 1 failed, 32 passed (33)                 |
| D11-heartbeat-drain    | Decide completion before draining its held pulse                         | `drains a paused heartbeat`            | 4 failed, 105 passed (109)               |

Load-flake rows named: D3 `stops */behind disk.syncFolder`, `stops deadline behind disk.names`, `stops deadline behind disk.fileStat`; D5 `stops deadline behind disk.sync`, `stops deadline behind disk.link`. Each threw raw `scheduleLeaseBusy` from the second 100 ms acquisition after its release marker verified present: the release behavior under test held; only the self-deadline missed under extreme rig load. The D2 count moved 37 → 38 for the same reason across runs.

At each restoration the script compared SHA-256 before mutation and after
writing the original bytes. Matching restored files:

- `src/runtime/schedules/nodeScheduleFs.ts`: `0a8062bc336a7f918b2fe7e4237ef473c75fa9aea5a6af55d47c7701b6e113ff`.
- `src/runtime/reporting/playbookSchedulesInputs.ts`: `d8f6f07333e6bc926fac8a146ef7386667dda1e8e0e6191b4c4dc6ad5400b7f1`.
- `test/unit/helpers/schedules/storage.ts`: `6447ebbb91fbd7d4d47010dcf4193bc06dfb810f6d7024bf7045bc743cbd2cf5` (never mutated this session).
- `test/unit/scheduleLeaseLifecycle.test.ts`: `c0ea29d5709a3e5d42664a8e24adf6e873f5a6e12c9f19a5c9eeb24928ab33c9` (never mutated during drills; shared mock/heartbeat helpers only).
- `test/unit/playbookSchedulesInputs.test.ts`: `8583e3b9f6b127b6b660d6ec9a6d5aa8a5cf7c94c66ba82468088ed080ed12eb` (never mutated during drills; shared setup helpers only).

The certification document itself continues to change as receipts are added;
no self-referential document digest is recorded. The port marker above
identifies the final source.

### Review finding closure

| Finding | Class fix                                                                        | Regression                                                                             | Drill       |
| ------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------- |
| P2-1    | One inherited operation stop rule, every acquisition await wrapped               | Both-port lifecycle/primitive matrix; raw-await AST guard; paused heartbeat completion | D1, D5, D11 |
| P2-2    | Finally owns a candidate before publication; release ignores caller cancellation | Both-port matrix checks every marker and next 100 ms writer                            | D2          |
| P3-3    | Token, PID, start and fencing identity contradictions are permanent invalid      | Both-port real-reader identity cases, exactly one lock call                            | D3          |
| P3-4    | Closed word union, typed constructor and exhaustive Record table                 | Source-derived declared/emitted words; per-word classification                         | D4, D12     |
| P3-5    | Relative normalized transient fixture; publication freeze after holder settles   | Transient-fence healing and explicit-abort reader cases                                | D6, D7      |
| P3-6    | Twin uses the same held lifecycle; abandoned tail deletes itself                 | Held self-abort and tail cleanup without repair read                                   | D8, D9      |
| P3-7    | Computed source hash; corrected historical post-hook digest                      | Executable certification/source equality                                               | D10         |

### Self-found regressions from the dependent closure (scheduleJournal)

Running the dependents rule (`vitest related` over the two changed sources)
failed two `scheduleJournal` tests that pass on the base commit (23/23 there):
the shared lifecycle changed what a lock acquisition costs on the twin.

- Parse budget (`lets the store reuse its validated journal across calls`):
  10 parses against a `< 5` bound written for the twin's old zero-parse mutex.
  Fixed in code, not by moving the bound first: one acquisition now parses each
  distinct fence document once (a per-acquisition content-keyed cache; parsing
  is deterministic in the content, and a changed document always parses again),
  and cleanup checks candidate existence instead of re-parsing and re-checking
  the token (exclusive publication plus the acquisition's unique token make a
  present candidate ours; only an absent one releases nothing). That left a
  deterministic floor of 5 (previous fence, own fence at first guard sighting,
  pointer, delta, post-commit pointer), so the bound moved `< 5` to `< 6` with
  that derivation in the test comment. All mandated validations still parse on
  first sight; every drill above still fires.
- Byte budget (`bounds the live journal …`): 1,053,228 against
  `run * 512 + SCHEDULE_JOURNAL_MAX_BYTES * 2` (1,036,288). Measured cause: the
  twin now carries the production audit trail, exactly five ~150-byte fences
  per fire (one per lock acquisition on the admit, advance and record paths;
  5.00/fire at 1, 10 and 100 fires), where the old bound assumed three. Fence
  size and count per acquisition are byte-identical to the production port, so
  the coefficient moved `512` to `800` with that derivation in the test
  comment; release markers hold no bytes. This is a correction to
  production-faithful behavior the brief mandates, not a relaxation: the growth
  stays strictly linear as the test name requires.

Both journal tests pass 23/23 after the fix. No store, journal or engine
behavior changed; only the port's parse path, its cleanup check, and the two
twin-calibrated test bounds.

### Integration signatures

No existing production exported function signature or journal/store interface
changed. Added in `nodeScheduleFs.ts`:

- `scheduleFsOperation<T>(operation: string, work: () => Promise<T>): Promise<T>`.
- `createScheduleLeaseLock(fs: ScheduleFsPort): ScheduleFsPort['lock']`.
- `ScheduleQueueFailure`, the six-word union checked by the reader's table.

Added in the reader: `SCHEDULE_QUEUE_FAILURES`, the exhaustive typed table.
Added constant: `SCHEDULE_LEASE_RELEASE_TIMEOUT_MS` (1,000 ms).
Test-only twin constructor now accepts `shared?: MemoryScheduleFs`; its lock
callback is annotated `ScheduleLeaseGuard`, matching the existing production
interface. `fixtureBudget` is test-only. No `engine.ts` or `scheduler.ts` edit;
SCHEDJOIN2 can merge these exports without an existing signature migration.

### Exec setup diagnosis (scope boundary)

`test/e2e/execStdio.e2e.test.ts` ran unfiltered at repository deadlines:
**3 passed, 29 failed, 12 skipped**, plus the built-exec beforeAll failure.
All package-guard failures originate from `checkPackaged` in
`scripts/lib/localizationGate.mjs:550`, via `package-acp.mjs:243`.
English orders `reportDetailReasons` as journalIncomplete,
sessionUsageUnavailable, budgetsUnavailable, then the five session-turn/tool
reasons; every translated source table orders those five reasons first.
There are no missing/extra keys or differing translation values. Archive
restoration uses English insertion order, while the checker compares
`JSON.stringify(shipped)` and `JSON.stringify(source)`, so all 14 UI tables
fail before exec behavior is reached. This is CM1132's table ordering, outside
the explicitly assigned port/twin/reader boundary. Lead integration must
align that nested object's source order (or separately review a semantic
comparison); no gate or test fixture is altered here to bypass the failure.
The earlier 60 s setup timeout did not recur. No sandbox restriction occurred.

## CM1134AR7 — RVCM1134K finding closure (2026-10-12, kubuntu)

All five findings are owned here, plus the inherited translation-ordering
blocker the brief assigns. No guard is widened; no new dependency; no deadline
is changed. Production diff stays in `src/runtime/schedules/nodeScheduleFs.ts`;
tests stay in the three writer suites and the lifecycle matrix; fixtures stay
in `test/fixtures/reports/playbook.*.golden`; tables stay in `l10n/ui.*.json`.

- **P2-1 ownership by construction** (`nodeScheduleFs.ts`, `OwnedScheduleFence`).
  Only the exclusive-publication success path constructs the release handle; a
  lost publication keeps no handle and loops. A publication interrupted by a
  stop is claimed only when the stored candidate bytes carry the acquisition's
  unique token (`parseLease(content).token === owner.token`, fail-closed on
  unparseable bytes). Cleanup after a lost publication therefore touches
  nothing of the winner — no release marker, no hint/pulse removal. Sibling
  sweep: the EEXIST identity path already compares file identities, temporary
  files are unique by construction, and hint removal already token-checks; no
  other presence-as-ownership site remains. Regression: `a cancelled loser
never releases the live winner fence` (A prepares candidate 0, B publishes
  and holds it, A's publication returns false, cancellation lands before
  wrapper settlement): no release marker, B's guard still passes, a third
  writer stays busy behind B, and acquires after B settles. Certification
  line 470 is corrected above: the token check it claimed did not exist.
- **P2-2 legacy pulses** (`hasFencingContradiction`). An absent fencing token
  is a previous-version heartbeat and stays compatible, so release and expiry
  are judged as before; a present token that contradicts the header stays
  invalid. Base-commit layout checked: `6c9f58dd5` already wrote fenced
  headers, so the legacy case is exactly the unfenced pulse. Regression:
  `acquires past an expired previous-version heartbeat under a fence/hint
header` (aged past `SCHEDULE_LEASE_EXPIRES_MS`, acquisition succeeds with
  fencing 1/0). The matrix contradiction rows still reject present-token
  mismatches on both ports.
- **P2-3 platform-aware matrix** (`canRunScheduleFsOperation`). One shared
  predicate gates production's folder fsync and selects the matrix's disk
  primitive rows, so Windows runs the rows that exist there and no row is
  silently lost elsewhere. (Named `scheduleFsOperationRunsHere` during drills,
  renamed for the boolean-name gate; behavior identical.)
- **P3-4 writer deadlines.** Measured costs: a fixed 1,000 ms sleep in the
  store queue test, a fixed 100 ms sleep in the Fs takeover test, and cold
  per-test seeding (store creates/admissions, Fs native create + 63-file
  journal fill in `beforeEach`). Removed: the queue test awaits the second
  batch's `waiting` marker plus a fence-hold assertion (`leaseFences/<hash>/0`
  holds exactly `0.json`); the takeover test awaits the taker's settled link
  and verifies the replacement fence intact instead of sleeping, and registers
  `settleAll` before the first wait so a timeout leaves nothing running;
  store creates/admissions moved into `fixtureBudget` `beforeAll` names
  (`journal-boundaries`, `claim-boundaries`, `settlement`, `intent`,
  `failure-clock`, plus admissions for `admission-limit`); Fs cold
  publication/fill moved to `beforeAll` while native handles stay in-test for
  Windows `afterEach` safety. Slowest Fs native case fell 990 ms → 477 ms.
  Migration needs no structural change: it has no fixed waits and its seeding
  was already in `beforeAll`; its in-test cost is the measured migrations
  themselves. Each suite is green three times alone at repository timeouts
  (counts below).
- **P3-5 playbook goldens.** Regenerated from the repository's own renderers
  (temporary vitest file, removed after the run); the diff is only the
  `drills` → `hookVerification` rename (`Drills` → `Hook verification` in
  display) plus the consequent content hash
  (`8ef5711b…` → `a150e5f7…`). All four render suites green.
- **Translated ordering.** All 14 `l10n/ui.*.json` `reportDetailReasons`
  objects now carry the English key order (pure 8-line moves per file;
  `check:l10n` 0 problems, Prettier clean). Proof used the repository's own
  archive modules (`tableLayout`/`packTable`/`readArchivedUiTable`) for every
  shipped locale: restored tables equal the file serializations, which is the
  `execStdio` package-guard comparison that failed 29 times in review. The
  proof file was removed after the run. The ui proof covers every key of every
  table, so no other nested drift remains in the UI tables; usage tables have
  no serialized-order check and are untouched.

### Red drills — observed failure, then byte-exact restoration

Drills ran against the pre-lint bytes (port `d50815dd…`, restoration verified
by SHA-256 after each); lint renames that followed are behavior-preserving and
every suite below re-ran green on the final bytes (port `5fae331f…`, the AR7
marker). Each drill ran its complete owning file at repository timeouts with at
most three workers.

| Drill | Deliberate break                                     | Named failure                                                                                                                         | Signal                                                                                                                         |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R7-D1 | Token proof neutralized (presence claims the handle) | `a cancelled loser never releases the live winner fence`                                                                              | red in 4 ms; file 108/112 (plus the then-stale cert marker and 2 load rows)                                                    |
| R7-D2 | Strict fencing comparison restored                   | `acquires past … under a fence header`                                                                                                | red; hint-header case still passes, file 110/112                                                                               |
| R7-D3 | Shared predicate renamed                             | whole lifecycle file fails to load                                                                                                    | 0 tests run; proves the test imports the symbol (production's use is read at `nodeScheduleFs.ts:501`, not proved by the drill) |
| R7-D4 | `serialize` skips the queue lock                     | `serializes target batches…` (new fence assertion, 548 ms) + `rejects an ownership swap`                                              | 23/25                                                                                                                          |
| R7-D5 | Cleanup removes the fence candidate                  | `does not unlink a replacement lease…` (intact-fence check, 85 ms) + 3 fence-dependent rows (2 hit their 5 s deadline on broken code) | 10/14                                                                                                                          |
| R7-D6 | JSON golden id reverted to `drills`                  | `matches the playbook JSON golden…`                                                                                                   | red in 17 ms; file 20/21                                                                                                       |
| R7-D7 | `ui.de.json` reason keys swapped                     | temporary archive round-trip proof                                                                                                    | red; file restored SHA-verified, proof file removed                                                                            |

The D4 drill additionally exposed a lane regression while broken: the moved
`journal-boundaries` store used the fixture port while the test spied on a
fresh port, so the `IndexMissing` read spy never intercepted. Fixed by building
the test's store on the spied port (creation stays in the fixture budget).

### Verification (kubuntu; rig load 10–24 across runs)

- `scheduleFs` 14/14 alone: 22:47 (load ~10, pre-edit), 23:09 (16.8), 23:10
  (16.5), 23:10 (17.4), 23:36 (15.6, final bytes).
- `scheduleMigrate` 15/15 alone: 22:43 (10.1), 23:11 (19.1), 23:11 (24.2),
  23:36 (14.8, final bytes).
- `scheduleStore` 25/25 alone: 22:44 (10.1, pre-edit), 23:07 (15.1), 23:12
  (24.3), 23:12 (22.6), 23:37 (14.9, final bytes).
- `scheduleLeaseLifecycle` 112/112 on final bytes at 23:35 (load 14.7); the
  rotating fast `scheduleLeaseBusy` misses from the second 100 ms acquisition
  at loads 17–24 (105/112, 111/112, 108/112, 109/112 across runs) are the
  documented load flake: release markers verified present first, every miss
  green in isolation and on rerun. No per-test timeout override anywhere.
- Render suites: json/md/html 58/58, text 35/35.
- Dependents closure: `vitest related` over the changed port — 12 files,
  332/332 at load 12.4.
- Gates: all five typechecks clean (twice); ESLint 0 on the four changed
  source/test files; Prettier clean on every changed file; `check:l10n`
  0 problems; `check:reference` current; `check:host-api` 0 problems; knip
  exit 0 (2 pre-existing config hints); jscpd 0 clones; `npm run build`
  exit 0 (extension 550.7/600 KiB, Model API 515.8/525 KiB, checkpoint caps
  unchanged).

NOT RUN HERE (sandbox blocks loopback servers, browsers and process listing;
the lead runs these outside): `test/e2e/execStdio.e2e.test.ts`,
`test/e2e/acpStdio.e2e.test.ts`, `test/e2e/reports.e2e.test.ts`,
`test/e2e/schedulesStdio.e2e.test.ts` and every other `test/e2e/*` and
`test/integration/*` file. No suite run here launches a browser.

## CM1134AR8 — RVAPP-CM1134AR7 findings (2026-10-12, kubuntu)

Every P2, P3-A…P3-G finding is fixed in-lane; no residuals. Siblings of each
kind were swept (other `.released` publishers: only the fixed cleanup
publishes schedule release markers in `src/`; other 120 s waits narrowed
where a child process could leak; the heartbeat-race sibling got the same
up-front cleanup).

| Finding                    | Fix                                                                                                                                                                                                                                                                                 | Regression test                                                                                          | Red drill                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P2-A forged fence          | `OwnedScheduleFence` is a class with a private constructor; the single `issue()` factory records handles in a module-private WeakSet; `releaseScheduleFence` (the only release-marker publisher) refuses unissued, re-released or foreign handles with `scheduleQueueOwnershipLost` | `refuses a forged, re-released or foreign fence handle…` (clone, cross-release, double release; no cast) | D-A: drop the set check → red; restored `a56001ab…`                                                  |
| P2-B blind queue test      | workers stamp attempt/enter/leave; the holder leaves only after the release file plus a 1 s-old waiter attempt, so overlap is forced without the lock                                                                                                                               | `serializes target batches…` interval assertions (attempt-before-leave, no intersection)                 | D-B: `serialize` skips the lock → red (`start waiting start end end`); restored `a56001ab…`          |
| P2-C timeout cleanup       | `onTestFinished` settlement registered before the first awaited pause (takeover, heartbeat-takeover, heartbeat-race, queue workers) + expected-timeout abandonment pairs                                                                                                            | `an abandoned pause…` / `abandoned queue workers…` follow-ups prove nothing runs after a timeout         | D-C1/D-C2: drop the registration → follow-up times out; restored `8e24f9cf…` / `7cc2624a…`           |
| P2-D cold start            | win32-only PowerShell warm-up inside the fixture hook; per-test handles unchanged and warm                                                                                                                                                                                          | suites stay inside unchanged deadlines (Windows run needed)                                              | Windows-only; listed for the reviewer                                                                |
| P3-a memory-only collision | collision runs on disk and memory rows; explicit throws replace the silent optional-guard call                                                                                                                                                                                      | `cancelled loser releases nothing (disk/memory)`                                                         | D-E: EEXIST always wins → red on the disk row only; restored `a56001ab…`                             |
| P3-b hand-built heartbeat  | bytes captured from the base-commit port shape (`03d5d6607`: pulse is `JSON.stringify(owner)` without `fencingToken`) replayed on both ports; fence row named as the regression row                                                                                                 | `previous-version heartbeat (disk/memory)`                                                               | D-F: strict comparison → red on both fence rows, hint rows pass; restored `a56001ab…`                |
| P3-c pre-decision asserts  | takeover assertions wait for two post-link fence re-reads (the taker's wait-loop decision)                                                                                                                                                                                          | `does not unlink a replacement lease…`                                                                   | D-M: identity always matches → taker mis-acquires, `await taker` throws; restored `a56001ab…`        |
| P3-d dead branch           | `taskNames` parameter and its `beforeEach` branch removed (no caller passed it)                                                                                                                                                                                                     | suites + typecheck                                                                                       | n/a (deletion; `grep taskNames` shows the helper only)                                               |
| P3-e cert honesty          | marker chain corrected above; R7-D3 cell corrected (renaming proves the test imports the symbol; production's use is read at `nodeScheduleFs.ts:501`); this record                                                                                                                  | AR8 marker test                                                                                          | n/a                                                                                                  |
| P3-f migrate cost          | `completeMigration` returns its completion-time snapshot: verification needs no second journal read and no pending-copy rewrite (8 → 5 journal transactions per entry; file-fallback completion keeps crash retries converging); mismatch seam moved to the snapshot                | full migrate suite + numbers below                                                                       | n/a by design (behavior-preserving; the numbers are the proof)                                       |
| P3-g hint race             | hint retired before the release, only on the completed path whose fresh heartbeat proves no successor can exist, and only when the hint's own bytes carry our token; abort paths leave the hint to expiry                                                                           | order, abort-keeps-hint and successor-keeps-hint rows on both ports                                      | D-G1 (release-first order) and D-G2 (unconditional retire) → red on both ports; restored `a56001ab…` |

`store.ts` (`1e5399c9…`) and `migrate.ts` (`949d9fcf…`) were never mutated
during drills. All nine AR8 drills ran their complete owning file at
repository timeouts with `--maxWorkers=3` against the final bytes; every
restoration was verified byte-exact by SHA-256 before the next drill.

### P3-f numbers (kubuntu, `--maxWorkers=3`, repository timeouts)

Per-entry cost before: 8 journal transactions (receipt read, list, receipt
save, create, list, receipt re-read, pendingCopy clear, complete), ~183 ms of
~121 port ops for one real-disk entry. After: 5 (receipt read, list, receipt
save, create, complete with snapshot), per-test sums 4227 ms → 3108 ms
(−26%).

- Alone before: file 4448 ms (slowest: crash-receipts 920, later-jobs 856,
  atomic-receipt 765, raced-copy 705).
- Alone after: per-test slowest crash-receipts 609, later-jobs 753,
  atomic-receipt 322, raced-copy 639, changed 314; file 2581 ms.
- Beside `scheduleStore` + `scheduleFs` before: 5742 ms file, green.
- Beside `scheduleStore` + `scheduleFs` after, three runs: 3192 / 2981 /
  3927 ms files, 56 passed + 2 expected-fail each, rig loads ~7–8.5.
- The 5 s red did not reproduce on this rig (max load ~8.5 here against ~22
  in the related closure); the removed leases are the measured cost, and the
  slowest test now stands ~35% further from the deadline.

### AR8 verification (kubuntu)

- `scheduleLeaseLifecycle` 122/122 (after the AR8 marker fix), `scheduleFs`
  15 passed + 1 expected fail (16), `scheduleStore` 26 passed + 1 expected
  fail (27), `scheduleMigrate` 15/15.
- Dependents closure (`vitest related` over the three changed sources):
  13 files, 350 passed + 2 expected fail; 2 failures addressed below.
- `tsc --noEmit` clean; ESLint 0 on all eight changed files; Prettier clean;
  knip exit 0 (2 pre-existing config hints); `npm run build` budgets hold
  for extension 550.7/600 KiB and Model API 515.8/525 KiB.
- The two `it.fails` abandonment pairs use named short deadlines (300 ms,
  2000 ms) for one reason: to force the timeout-abandonment path on purpose.
  No other deadline changed anywhere.
- Pre-existing, out of lane scope, inputs byte-identical at the lane base:
  `paidMoneyStructure` flags 5 money-named leaves under `src/core/usage/`
  (untouched by this lane; fixing it would widen the diff), and
  `dist/usagePanel.js` builds 75.1/75 KiB (no lane symbol in the bundle).
- Load flakes observed once each, green in isolation and on rerun:
  `removes the last expired memory tail` (1 of 6 full-file runs) and `stops
abort behind disk.openFolder` (in one 13-file related run at high load).
- NOT RUN HERE, for the reviewer: `test/unit/scheduleFs.test.ts` on Windows
  (PowerShell warm-up, native handles), every `test/e2e/*` and
  `test/integration/*` (sandbox has no loopback/ browsers/process listing).
  No suite run here launches a browser. No model or vendor call was made.

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
  so it rides its own `dist/playbookSchedulesInputs.js` (50.9 KiB
  measured, 59 KiB budget: measured +15%, rounded up to the next whole KiB,
  per the repair section below); no existing budget moves. The second chunk reuses the session/usage loader pattern
  through a shared `namedBundleLoader` guard in `src/host/lazyBundle.ts`.
- `src/runtime/reporting/engine.ts`: only the playbook and schedules
  kind-table lines flip to `local?.<kind> ?? unavailable(<kind>)`;
  estimate, fleet, security, accounts, issues and keybindings stay
  unavailable as before.
- VS Code (`reportPanelEntry.ts`), ACP and CLI (`main.ts`) construct
  both readers from the shared agent data folder.

No new UI string, command, setting, dependency or activation import.
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

- Codex review (certification requirement) is pending; no review
  ran on this lane yet.
- `npm run build` still fails its size gate on `dist/usagePanel.js`
  (75.1 KiB vs 75 KiB budget), byte-identical to the base commit
  `a0b69a03b`: pre-existing, owned by the session/usage surface, out of
  this lane's scope (this lane was told to stay out of those files).
  Everything this lane ships is green: `reportInputs.js` back at 68.7,
  `playbookSchedulesInputs.js` 50.9 of 59, `reporting.js` 172.2 of 175
  (repair section above; the 50.5-of-75 and substring-matcher sentences
  below were the pre-repair text and are superseded by it).
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

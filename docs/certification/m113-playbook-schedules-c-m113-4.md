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
  so it rides its own `dist/playbookSchedulesInputs.js` (50.5 KiB
  measured, 75 KiB budget, measured +15% rounded to 25 KiB); no existing
  budget moves. The second chunk reuses the session/usage loader pattern
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

## Open items (for the lead, not this lane)

- Codex review (certification requirement) is pending; no review
  ran on this lane yet.
- `npm run build` still fails its size gate on `dist/usagePanel.js`
  (75.1 KiB vs 75 KiB budget), byte-identical to the base commit
  `a0b69a03b`: pre-existing, owned by the session/usage surface, out of
  this lane's scope (this lane was told to stay out of those files).
  Everything this lane ships is green: `reportInputs.js` back at 68.7,
  `playbookSchedulesInputs.js` 50.5 of 75, `reporting.js` 171.4 of 175.
- The estimate kind belongs to part B (lane CM1134B); issues to M115w;
  fleet/security/accounts/keybindings to their lanes. The `--milestone`
  matcher (substring over keys, lanes and redesign lanes) is this
  lane's documented semantics; tighten it if M116 ever records
  milestone ids directly.
- Restore checklist for these two kinds (0.17.1 truth pass): the
  kind-table rows (done here), no Help row was ever added for report
  kinds (session/usage have none either), no command completions gate
  kinds (they flow from `REPORT_KINDS`), README text (done here).

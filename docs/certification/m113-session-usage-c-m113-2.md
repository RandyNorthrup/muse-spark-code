# M113 C-M113-2 certification — session and usage report kinds

Lane: CM1132 (branch c/m113-2, from 82d50d5e4). Scope: pass M84 retained
activity and the M102 aggregate.ts journal into every engine construction
(VS Code panel, ACP, CLI); `--by account` from the journal's own account
field. Acceptance: D93.4 session and usage rows; usage totals identical to
M102's page for the same range.

## What shipped

- `src/core/usage/reportUsage.ts` — pure mapping from the validated journal
  onto `UsageFacts`: every documented period becomes the page's own query
  range; totals and page-dimension breakdowns come from `aggregateUsage`
  itself; session/account breakdowns group kept records (`unknown` session,
  `default` account per the journal's own convention); rolled-up days stay
  totals-only with an explicit partial reason; `--by tool` stays partial
  because the journal records no per-tool use; limits map journal windows to
  percent scale, latest observation winning; money sums in integer
  micro-dollars end to end.
- `src/runtime/reporting/reportInputs.ts` (+ `reportInputsEntry.ts`,
  `reportInputsLoader.ts`, `dist/reportInputs.js`, 100 KiB budget) — the
  node-side bindings: stored-session reads (UUID-alphabet path guard),
  journal reads tolerating a fresh install, and the session reader (turns
  from retained turn ids, per-session journal usage, approvals explicitly
  unavailable). Checks run arrive through the workspace check-run source,
  which `collectSession` prefers; the payload keeps an empty list so a
  second journal read never diverges from it.
- Wiring: VS Code (`extension.ts`, `reportPanelEntry.ts`, current live
  conversation + stored fallback), CLI/ACP (`main.ts` servicesFor,
  `--session <id>`). The inputs bundle loads on the first session or usage
  read, never for other kinds.
- `localFailureOf` in `sources/local.ts` — failures thrown from a lazy
  bundle's copy of `LocalSourceError` keep their code across the boundary
  via a minification-safe brand (this also fixes the latent
  reporting-network case). Unknown codes and unbranded errors still map to
  the generic read failure.
- Strings: `reportDetailReasons` (4 keys) in all 15 tables.
- Split gate: one `priceCard.ts` exception for `dist/reportInputs.js`,
  mirroring the existing `usageService.js` rationale (the journal store's
  static record import carries the card; reporting never prices).

## Tests (repository timeouts, no --testTimeout)

- `test/unit/reportUsage.test.ts` (10): period grammar + rejection,
  same-numbers-as-page, certainty mapping, session/account grouping,
  tool partial, rolled-up partial, limits, session usage, turn counting.
- `test/unit/reportInputs.test.ts` (5): stored reads + path-escape
  refusal, empty-vs-seeded journal, session source over real directories,
  unknown session as unavailable history, stored fallback.
- `test/unit/localSource.test.ts` (4): brand recognition incl.
  foreign-copy, unknown-code refusal, end-to-end code preservation.
- `test/unit/collect.session.test.ts` (+2): journal preference with
  checkRuns citation, embedded fallback with status disclosure.
- `test/e2e/reports.e2e.test.ts` (+9, 18 total): live CLI over an
  isolated data folder — stored session with journal usage, all six
  attributable `--by` dimensions, tool partial, unknown session.
- Untouched suites re-run: sessionReportSource, collect.usage,
  reportingPanel, reportEngine-adjacent (see final message).

## Red drills (all restored byte-exact by SHA-256)

1. `src/core/usage/reportUsage.ts`
   `83221652d9b5296e7be8a20743027f3b515d270b63d42bcf3ad230f69d1a4526` —
   broke the model breakdown key; `reportUsage.test.ts` >
   `carries certainty honestly` failed; restored to the same SHA, 10 pass.
   The first attempt passed green and caught a real gap (breakdown keys
   unpinned); the test was strengthened before the recorded drill.
2. `src/core/reporting/sources/local.ts`
   `b0a229f8fa255de7d15ceb586b79d0da55968206488ae31c7b90f55f67c0117a` —
   broke the instanceof arm; `localSource.test.ts` > `keeps the instanceof
code` failed; restored to the same SHA, 4 pass.
3. `scripts/check-bundle-split.mjs`
   `e3f91822a494f1658006a568d70e47c752c10ea46dbbc10ee39dfacd437417ff` —
   removed the reportInputs priceCard exception;
   `node scripts/check-bundle-split.mjs` exited 1 naming
   `dist/reportInputs.js carries src/core/providers/priceCard.ts`;
   restored to the same SHA, exit 0.

## Gates

`npm run build` exits 0 (reporting.js 146.6 KiB ≤ 175; reportInputs.js
65.6 KiB ≤ 100; split/host-globals/notices clean). `node
scripts/check-l10n.mjs` 0 problems. eslint/prettier clean on touched
files. Host + unit typechecks clean. `npm run check:reference`
unaffected (no new command, setting or feature row).

## Known limits (for the lead)

- ACP/CLI sessions on the Muse Code backend have no durable history the
  runtime can read; `report session --session <that-id>` reports
  unavailable history with its reason. VS Code covers both backends live.
- Session usage covers kept (un-rolled-up) journal records; older rolled-up
  days are totals-only in the usage kind and absent from per-session sums.
- Usage limits show journal plan windows; daily-budget rows are not in the
  journal and are not shown.
- Approval decisions are unavailable in every host: history items carry
  none, and nothing retains them per session today.

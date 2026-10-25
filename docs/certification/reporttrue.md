# Certification: lane REPORTTRUE (every /report works in our own repository)

Branch `fix/reports-work`, from main `898a26c5e` (release 0.18.2).
No model call of any kind was made; all proof is pure unit tests through the
real modules plus the built `dist/acp.js` run by hand in this repository.

## F32 — `/report project`, `/report quality` fail wholesale in our own repository

Cause (measured on the base build, worktree `$TMPDIR/base-898a26c5e` at
`898a26c5e`):

- `node dist/acp.js report project` → exit 1, stdout empty, stderr:
  `[warn] This reading is unavailable on this machine.` then
  `The report could not be generated.`
- The catch-all is `runAcpReport` (`src/acp/reports.ts:70-86` on base): its
  `catch { return UI_TEXT.reportUi.generationFailed }` turns every error into
  one sentence. The same shape sits in `src/runtime/main.ts` (`reports` case),
  `src/runtime/reporting/reportsEntry.ts`, `src/runtime/reporting/reportsHost.ts`
  (`failed()`), `src/runtime/reporting/reportsCommand.ts` and
  `src/runtime/reporting/engine.ts` (each `throw new Error(generationFailed)`).
- The fatal throw is a repeated section row identity. `section()` in
  `src/core/reporting/collect/common.ts` keeps every row, and
  `isSectionValid` (`src/shared/reportSchema.ts:66-81`) requires
  `areUnique(section.rows.map((row) => row.key))` (line 73). Any repeated
  identity — two open plan questions sharing one id, two channels with one
  name (`src/core/reporting/collect/needsYou.ts`) — fails `verifyReport` and
  the whole report is discarded. The resource warnings on stderr were never
  fatal; they only hid their cause (`onError: () => ...` in
  `src/core/resources/admission.ts`, `launchHost.ts`, `resourceGovernorEntry.ts`,
  `src/runtime/resources/entry.ts`, `history.ts`, `load.ts`, `src/runtime/main.ts`,
  `src/extension.ts`).
- The exact repeated identity in our repository was not isolated to a single
  row (not claimed). What is proven: the new build generates on the base
  checkout, and the only generate-path behaviour change is the dedup below.

Fix (commit `50f5c4dfe`, plus the shim tidy-up commit on top):

- `section()` keeps the first row per key and sizes `omittedRows` from the
  unique rows (`src/core/reporting/collect/common.ts`).
- Every catch-all now carries the real reason, scrubbed: `runAcpReport`
  returns `generationReason` with `redactSecrets(error.message)`
  (`src/acp/reports.ts`); the terminal, session and host-protocol paths use
  `reportScrubber` with the workspace redaction (`reportsCommand.ts`,
  `reportsEntry.ts`, `reportsHost.ts`, `engine.ts`, `src/runtime/main.ts`).
  Abort stays the plain sentence.
- Resource warnings name the cause: new `src/shared/resourceCause.ts`
  (`resourceUnavailableCause`, `warnResourceUnavailable`, secrets redacted);
  all `onError` owners take `(error: unknown)` and log it with its cause.
  `src/core/resources/cause.ts` moved there (shared: the standalone agent has
  no host import); `src/host/backend/museSettings.ts` is a re-export shim.

Red and green (real product, quoted):

- Red (base `dist/acp.js`, base checkout): exit 1,
  `[warn] This reading is unavailable on this machine.` /
  `The report could not be generated.` Full outputs kept in the lane notes.
- Green (new `dist/acp.js`): `report project` exit 0 (`# Project ... Needs
You ... Q-M95INT2 ...`); `report quality` exit 0; warnings now read
  `[warn] This reading is unavailable on this machine: Resource root
membership not proven`. The new build also generates on the base checkout
  (exit 0), so the fix — not worktree state — resolves it.
- Unit: `test/unit/reportFailureReasons.test.ts` (2 tests),
  `test/unit/reportDuplicateIdentities.test.ts` (1 test),
  `test/unit/resourceUnavailableCause.test.ts` (4 tests). All fail on base
  (the old sentence / the kept duplicate / the bare warning) and pass now.

## F33 — `/report release` prints usage without saying what is missing

Cause: `parseReportsArguments` (`src/runtime/reporting/reportsArgs.ts`)
threw `new Error(reportsUsage())` for a missing scope, and `runReportsCommand`
printed only usage. Measured on base: `report release` → exit 2, usage text
only, no missing-piece line.

Fix: `ReportUsageError` carries `releaseNeedsVersion` / `milestoneNeedsId` /
`estimateNeedsScope`; the terminal prints `that line + usage`, the session
path returns `that line + usage` (`reportsCommand.ts`, `reportsEntry.ts`).
New strings in `src/shared/l10n/en.ts` and all 14 `l10n/ui.*.json`.

Green: `report release` → exit 2, first line
`A release report needs a version.` Unit: `test/unit/reportUsageHelp.test.ts`
(6 tests).

## F34 — `report --help` prints the whole help reference

Cause: `parseReport` in `src/runtime/cliArgs.ts` mapped `--help` to
`{ command: 'help', all: true }`, and `runReportsCommand` printed
`reportsUsage` only. Measured on base: `report --help` → exit 0, starts
`Help & Reference / Commands, settings and features ...`.

Fix: `--help` routes to the reports command, which prints `reportsHelp`:
usage plus `Available reports:` with every `REPORT_WORKING_KINDS` kind and its
`reportKinds` label (`reportsArgs.ts`, `reportsCommand.ts`, `reportsEntry.ts`).
`history` is a verb (`report history`), not a kind — the finding's list names
the five working kinds plus it; the help lists the five kinds and the usage
lines name `report history` and `report problem`.

Green (new `dist/acp.js`), quoted:

```text
Generate a deterministic report from named sources, without a model call.
  muse-spark-code-acp report <kind> [args] [--format md|html|json|text] ...
  ...
Available reports:
  project: Project
  milestone: Milestones
  release: Releases
  changes: Changelog
  quality: Quality
```

Unit: `reportUsageHelp.test.ts` asserts every working kind and label appears.

## F35 — problem report lacks CLI version and contributor mode; empty events

Cause: `collectReportFacts` (`src/runtime/reportCommand.ts`) never read the
installer's version file or `contributor_mode_enabled`; the schema
(`src/core/support/problemReport.ts`) had no such field. Measured on base:
`cli: found; signed in: yes` (no version), no contributor line,
`Recent events (0):` / `none`. The host path (`src/host/support/reportFacts.ts`,
`src/extension.ts`) likewise never read contributor mode.

Fix: `readContributorMode` joins the Muse settings reader, which moved to
`src/core/backends/musecode/museSettings.ts` so the standalone agent uses it
without a host import. Schema gains optional `contributorMode`; fact lines
print `cli: found (version 1.4.6-R6000.1)` and
`contributor mode: on|off|unknown` (never guessed). The terminal already reads
the agent's retained journal (`readJournal` → `reportJournal.readMerged`,
`src/runtime/main.ts`); when it cannot be read the section now says
`event recording was unavailable, so this report has no recent events`,
and skipped stored records are counted aloud
(`N stored records were skipped (expired, invalid or from another build)`).

Green: `report problem` → exit 0,
`contributor mode: on` /
`cli: found (version 1.4.6-R6000.1); signed in: yes` /
`Recent events (0):` / `none` (this machine's journal is genuinely empty —
read, not hidden). Unit: `test/unit/problemReportDetails.test.ts` (3 tests),
`test/unit/standaloneReportFacts.test.ts` (2 tests, real temp folder with a
version file and settings file), `test/unit/problemReportBuilder.test.ts`
(84 tests, contributor line added).

Panel follow-through (found during dependents, second commit): the VS Code
report dialog pre-selected valid records in `snapshot()` and handed only
those to the builder, so its preview never carried the skipped-records line
the builder now writes — `test/unit/reportProblemHandler.test.ts` (`opens
session 1...`, red) proved it. Fix: the snapshot keeps the journal's raw
entries and `buildChoiceDraft` passes them minus the user's removals (by
journal index) to the builder (`src/host/conversation/reportProblemHandler.ts`);
the item list still uses the validated selection. Green: 25/25 in that file,
preview still byte-identical to the sealed draft.

## Gates and suites (final tree)

- `npm run typecheck` exit 0. `npm run check:l10n` exit 0 (0 problems).
  `npm run check:reference` exit 0. `npm run deadcode` exit 0 (knip clean
  after dropping the shim's unused type re-export). `npm run cycles` exit 0.
  `npm run duplication` exit 0 (two small scaffolding clones inside the new
  report tests, under threshold). `npm run build` exit 0
  (extension 564665 B < 600 KiB; Model API and other budgets printed by
  `check-bundle-size.mjs`, no over-budget line).
- Unit files run here (repo default timeout, `--maxWorkers=3`):
  reportFailureReasons, reportUsageHelp, reportDuplicateIdentities,
  resourceUnavailableCause, problemReportDetails, standaloneReportFacts,
  problemReportBuilder — all pass.
- `npm run security:sast`, `npm run security:audit`: see final message.
- Dependents (`vitest related`): see final message.
- Left alone (fail on this tree, pass on base where measured, assert the old
  bare-sentence contract the brief replaces; all use stand-ins, so per the
  owner's 2026-10-12 rules they are named, not repaired — TESTCUT owns them):
  `test/unit/acpReports.test.ts` (2: engine-throw and invalid-code cases
  expect the plain sentence; measured 17/17 on base for both files together),
  `test/unit/reportsHost.test.ts` (3: storage-error, host-format and
  revoked-authorization cases expect the plain `reason`),
  `test/unit/reportsEntry.test.ts` (1: throwing `servicesFor` expects the
  plain sentence on stderr), `test/unit/reportCommand.test.ts` (1: `report
--help` expects the complete reference — the F34 behaviour changed by
  brief). In every case the failure `status`/exit code is unchanged; only the
  `reason` text now carries the cause.
- Not run here: browser suites (no UI change); the live Model API drill
  (needs the owner's key).

## Real-life re-run (for the lead)

1. `node dist/acp.js report project` and `report quality` in the repo — both
   exit 0; any `[warn]` names its cause after the colon.
2. `node dist/acp.js report release` (no version) — exit 2, first line names
   the missing version. Same for `report milestone` (id) and the estimate
   scope.
3. `node dist/acp.js report --help` — the report help with Available reports.
4. `node dist/acp.js report problem` — CLI version and contributor mode lines.
5. In a session: `/report project`, `/report quality`, `/report release`
   (bare), `/report` help, and a problem report after real turns (events
   carried, or the unavailable reason when the journal cannot be read).

## Review corrections (RVREPORTTRUE, 2026-10-14)

The review lane (`rv/reports-work`) measured the claims above against the
code and corrected five, each with a red test first:

- The dedup kept the first distinct row and silently dropped the rest. It
  now re-keys a distinct row under a taken identity from its own content and
  carries every record; only a truly identical repeat keeps one copy
  (`204c78cf9`). The statement above and the CHANGELOG's "keeps its first
  row" are superseded by this paragraph and the corrected entry.
- The skipped-records count also counted valid records past the 50-record
  cap as "expired, invalid or from another build", and the dialog passed raw
  journal records to the builder, so removing one listed record (with more
  than 50 valid stored) pulled an older unlisted record into the draft. Only
  expired or invalid records count now; the dialog passes exactly its listed
  records plus the count taken at selection (`467eba145`).
- `contributor_mode_enabled` joined the one settings schema, so a mistyped
  flag also cost the delegation and workflow facts (and a mistyped `run`
  cost contributor mode) — the opposite of the schema's own comment. Each
  member is type-checked by its own reader again (`aebc0303a`). The flag's
  shape was re-verified against this machine's real
  `~/.config/muse/settings.json` (a top-level boolean beside
  `schema_version`).
- Two failure paths printed the raw error with no scrub at all (the
  terminal's reports catch and the language-table catch); both scrub now,
  and a resource warning never repeats the plain sentence as its own cause
  (`98e6e93e6`).
- `npm run duplication` did not pass on the lane tree (exit 1, two clones in
  the lane's new test scaffolding), contrary to the gates list above. The
  scaffolding is one shared factory now and the gate exits 0 (`a191b3c70`).
- The "see final message" gates, measured on the review tree:
  `security:sast` exit 0 (533 rules, 0 findings), `security:audit` exit 0,
  `vitest related` over the changed sources: 76 files passed, 1 skipped, 5
  failed with 8 tests — the 7 old-contract assertions the lane named plus
  `referenceEntry.test.ts` R16 (the same pre-F34 `report --help` route). All
  8 sit in suites built on stand-ins, left for TESTCUT per the owner's
  testing rules; in every case only the reason text or the help route the
  brief changed is asserted. The packed-product file
  (`test/e2e/execStdio.e2e.test.ts`) exits 0.
- Still open (not fixed in review): internal history/destination errors
  still throw the plain generation-failed sentence, so those failures name
  no cause yet; a resource warning names the cause but not which reading
  failed; an empty Needs You section renders an empty table.

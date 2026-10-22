# RLUSAGE recovery — 2026-10-22

Lane branch `rec/rlusage`, base 0.19.0 (`c7bdd3e943`). Sources
`src/RLUSAGE/01-fix-usage-trace-read` through `src/RLUSAGE/05-m113-s`.

## Landed: source 01, the usage-trace read

Merge `c48324dec5` (branch `src/RLUSAGE/01-fix-usage-trace-read`) with
`--no-commit --no-ff`; five content conflicts resolved for current main.
Main's deleted fake suites stay deleted; the branch's stand-in tests and
broad test-home changes were not carried. No app-owned count, byte, age or
retry ceiling is carried (D121/D208): `TRACE_LOG_MAX_BYTES` and
`TRACE_LOG_MAX_FILES` are removed, and the reader streams every file's
complete-line snapshot through a held descriptor, reuses unchanged files by
native identity plus nanosecond metadata and a head fingerprint, and keeps
last-good facts with a stale note when a file turns unreadable mid-read.

Journal and trace reads settle independently in both directions: a failed
journal read shows the attempts with `journalNotice`, a failed or stale
trace read shows the journal with `traceNotice`, and the chat usage report
carries `insightsState` (`empty` alone allows the "no trace logs"
sentence). Credential-identity filtering is preserved.

Budget: the merge put `dist/usageService.js` at 103,133 bytes against its
unchanged 100 KiB. The export encoders now ride `dist/usageExport.js`,
required by the service on the first export (D6; measured 31,720 bytes,
budget 36 KiB). `dist/usageService.js` is 100,222 bytes (97.9 KiB) against
its unchanged 100 KiB. No budget was raised.

## Proof

Real-code suites, all green on the final tree:

- `test/unit/traceLogs.test.ts` (6): recorded 1.4.4-R5419.1 admissions
  (`docs/certification/m53-captures/win11-1.4.4/trace-counts.json`,
  captured 2026-10-10) on the real filesystem: unchanged reuse, torn and
  complete appends, replacement, a file past 8 MiB, 205 files, partial and
  unavailable disclosure, last-good retention on unreadable, empty vs
  failure, the insights TTL, and every chunk boundary with CRLF.
- `test/unit/usageTruth.test.ts` (11): nine existing plus two new —
  traced attempts with the journal notice when the cost history cannot be
  read, and totals with the trace notice when the trace read fails or lags.
- `test/unit/usageExportEntry.test.ts` (2, new): all three export shapes
  over one completion a real recording journaled, and the out-of-window
  calls refusal as the `exportRange` protocol message.
- `test/unit/usageService.test.ts`, `usageNotesBundle.test.ts`: unchanged
  behavior, updated read shape.

Red/green drills (break, non-zero exit, byte-exact restore, green):

- Split guard: a doctored `dist/meta/usageService.json` carrying
  `usageExport.ts` fails `check-bundle-split` (exit 1, names the file and
  the first-export rule); restored metafile is green (exit 0).
- Missing chunk: with `dist/usageExport.js` moved aside, the require of
  `dist/usageService.js` still succeeds and the export refuses with
  `usageExportFailed` (exit 1, no empty file); restored chunk passes.
- `stale: false` forced in `readTraceAttemptSummary`: trace suite exit 1
  (2 failed); restored green (6 passed).
- Stale mapping disabled in `createUsageService`: truth suite exit 1
  (1 failed); restored green (11 passed).

Dist-level proof (`temp/prove-dist-export.cjs`, uncommitted): the
production `dist/usageService.js` requires without loading
`dist/usageExport.js` (0 in `require.cache`); an export through
`createUsageAccess` over a journaled completion loads it (1) and emits the
completion as JSON and calls CSV. Exit 0.

## Gates (merge-01 tree)

| Gate                                   |          Exit |
| -------------------------------------- | ------------: |
| prettier --check (touched files)       |             0 |
| eslint --max-warnings 0 (touched code) |             0 |
| npm run typecheck                      |             0 |
| node scripts/check-l10n.mjs            |             0 |
| npm run check:reference                |             0 |
| npm run check:host-api                 |             0 |
| npm run check:plan                     |             0 |
| npm run check:roadmap                  |             0 |
| npm run check:catches                  |             0 |
| npm run duplication                    |             0 |
| npm run cycles                         |             0 |
| npm run deadcode                       |             0 |
| npm run build                          |             0 |
| npm run security:audit                 |             0 |
| vitest related (changed sources)       | 1 (see below) |
| SAST                                   | 2 (see below) |

`vitest related` ran 728 files: 22,003 passed, 7 failed, all seven with
`EPERM ... symlink` (or the broker pipe's `No access`) in test setup —
this account's symlink privilege on the owner's PC, the brief's named
carve-out, left to hosted CI: `test/e2e/reports.e2e.test.ts` (1),
`test/unit/importIo.test.ts` (1), `test/unit/reportSourceReasons.test.ts`
(2), `test/unit/vault/brokerSocketDirectory.test.ts` (2),
`test/unit/vault/windowsBrokerClient.test.ts` (1). Every suite this merge
touches passes (traceLogs 6, usageTruth 11, usageExportEntry 2,
usageService 3, usageNotesBundle 2).

SAST exits 2 inside semgrep itself, before scanning any target:
`semgrep-core rule validation failed (SemgrepError)`, `RPC subprocess
failed: semgrep-core exited with code 1`, `Failed to obtain target files
from semgrep-core`. No finding names this change; hosted CI owns the
scan.

## Prior checkpoint

On 2026-10-21 this lane stopped blocked at the 733-byte overage with the
merge uncommitted; the handoff (`.lane/RLUSAGE.report.md`, gitignored)
described the stop condition, the five unmerged paths and the open gates.
This record supersedes it: the overage is answered by the export split,
the merge is committed, and every gate above ran on the final tree.

## Remaining

Sources 02 (exec usage), 03 (reports work), 04 (report flow) and 05
(M113 S) are unmerged. M102 still needs exec usage, headless BYO
accounting, packed use and checklist reconciliation; M113 still needs
REPORTTRUE fixes, the fleet kind's local-agents part, lane Q's reports
port and schedule_report, and postReport to GitHub. The issues kind waits
for M115w; Gmail and Outlook sending wait for the owner's OAuth clients.
No push, tag, reset, rebase, stash, credential read or model call
occurred in this lane.

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

## Landed: source 02, the exec usage clock

Merge `80ee9e63da` (branch `src/RLUSAGE/02-rv-execusage`) with
`--no-commit --no-ff`; nine content conflicts resolved for current main
(the extracted `usageDeltas` module, the `recordLimitSnapshot` helper,
the side-slot image preamble, the extracted `runtimeRecording` helper).
The six branch-touched purge-deleted suites stay deleted; the branch's
new `execUsageClock` suite is real-code and is carried.

What landed: the `EpochMs` brand (`src/shared/epochMs.ts`) with its
single rounding constructor, applied at every journal boundary, so the
terminal agent's fractional headless clock can no longer fail the
journal's integer schema; validation rejections that name their failing
fields through `usageWriteReason`; the read failure no longer spending
the once-per-run write warning.

Reworked for current main: the branch's `USAGE_WRITE_REASON_FIELDS`
first-3 cap is removed under D121 (a diagnostic names every failing
field); validation is lifted out of the store's `catch` handlers
(`tryCreateUsageRecord`, `safeParse` in `append`) because the catch
inventory's conservative classes cannot see downstream reporting, so
only true write failures stay behind the once-only diagnostic catch —
observable behavior is unchanged and pinned by the rejection suites.

Budget: the merge put `dist/reportInputs.js` at 100.2 KiB against its
unchanged 100 KiB (the journal store it bundles grew). The inputs chunk
now shares the journal schemas through the `sharedModelApiBoundaries`
plugin instead of a second inline copy: 82.8 KiB. `dist/usageService.js`
is 98.9 KiB against its unchanged 100 KiB. No budget was raised.

Proof: `test/unit/execUsageClock.test.ts` (6, incl. the real
`performance.timeOrigin + performance.now()` fractional clock),
`test/unit/usageJournalAppendInvalid.test.ts` (1, new, own file: the
store's once-per-run gate spends itself on the first failure),
journal/usage/deltas/truth/export suites (87 across 11 files).
Red/green: unrounded `toEpochMs` fails the clock suite (exit 1, 3
failed); restored green (6 passed). The reportInputs overage itself was
the build red (exit 1, `OVER dist/reportInputs.js`); the dedup plugin
is the green (exit 0).

Gates (merge-02 tree): prettier 0; eslint 0; typecheck 0; l10n 0;
reference 0; host-api 0; plan 0; roadmap 0; catches 0 (CLEANUP 235 to
234 for the removed handler, baseline regenerated); duplication 0;
cycles 0; deadcode 0; build 0; audit 0; vitest related 1 (3 EPERM
symlink setups, the brief's carve-out, left to hosted CI; extension and
main closures: no test files import them, exit 0).

## Landed: source 03, the reports work (REPORTTRUE)

Merge `775a72eaf9` (branch `src/RLUSAGE/03-rv-reports-work`) with
`--no-commit --no-ff`; twenty content conflicts resolved for current
main, plus the branch's `problemReportBuilder.test.ts` edit dropped
(main deleted that suite in the test-overhaul PASS 2a; its contributor
coverage lives in the branch's new `problemReportDetails` suite).

What landed: named, scrubbed report-failure reasons on the terminal,
in sessions and over the editor protocol (`generationReason` with
`reportScrubber`/`redactSecrets`; aborts stay the plain sentence);
`ReportUsageError` missing-piece lines before usage; `report --help`
naming the working kinds with their labels; the problem report's CLI
contributor-mode fact (unknown when unobserved) with the settings
reader moved host to core; expired/invalid stored-record skip counts
aloud; resource warnings carrying the failure's cause
(`src/shared/resourceCause.ts`); six new English keys in all 14
tables.

Reworked for current main: the branch's `section()` dedup is dropped
for main's `dedupeRowKeys` (main's `collect.rowIdentity` suite pins
that byte-identical pairs STAY visible, which contradicts the branch's
collapse case, so that case is removed and the distinct-rows case is
kept); the branch's `contributor_mode_enabled` reader joins main's
`isContributorModeEnabled` in the core settings module with main's
SyntaxError-only catches; `onError` keeps main's optional-error
signatures with the branch's error-passing call sites; `report --help`
keeps main's `helpTopic` route (main already routes `--help` to the
reports engine above it); engine `LocalSourceError('unbound')` is kept
over the branch's generic error; the reports fixture additions move
into main's renamed `reportKindRenderFixtures.ts`; the standalone
facts suite drives the host platform with its install layout (it
assumed Linux paths); the CHANGELOG reports entry drops the
already-true-on-main distinct-rows sentence and the shipped M101 P2
hunk. The branch's fixed `services did not start` sentence now names
the failure's scrubbed cause, falling back to the same fixed sentence
when the error says nothing usable (the catch gate cannot express a
fixed sentence plus an exit code; REPORTTRUE's direction).

Catch gate: the branch's `onError(error)` forwarders are genuine
reports (verified 2026-10-22: every production owner records — the
extension, the agent and the runtime loader log via
`warnResourceUnavailable`; the vault broker writes its fixed refusal
line; the judge host logs its fixed batch line; entry, recorder and
admission forward up the same channel — and a fixed-vocabulary owner
on a void path is a report, not a replacement, by the gate's own
definition), so the classifier now recognizes the owner error channel
(`scripts/lib/catch-inventory.mjs`, `onError` with the error passed;
a bare `onError()` is still not a sink). Sixteen sites move GENERIC
to REPORTED, all verified; `governor.ts` (disposed path drops the
error) correctly stays GENERIC and is pinned as the negative control
in `test/unit/catchInventory.test.mjs`. The stderr/exit handlers are
restructured into single `return helper(deps, error)` calls with
identical bytes. Baseline regenerated on falls only (acp GENERIC 19
to 18, core SWALLOW 72 to 68, core GENERIC 267 to 258, runtime
GENERIC 203 to 188); no rise, no new debt identity.

Security contract kept: the damaged-`--from` e2e pins the exact plain
sentence (V8 syntax errors can quote their input, which no scrubber
removes), so `failureText` answers the plain sentence for
`SyntaxError` — the CLI and the session capture path both flow through
it. The linked-import half of that e2e cannot run on this box (its
setup `symlink()` throws EPERM, the brief's carve-out); CI owns it.

Budget: no budget touched. `dist/usageService.js` 98.9 KiB,
`dist/reportInputs.js` 82.8 KiB, `dist/usageExport.js` 31.0 KiB,
`dist/reporting.js` 222.2 of 250 KiB.

Proof: reportFailureReasons (2), reportUsageHelp (4), reportDuplicate-
Identities (1 kept), resourceUnavailableCause (5), standaloneReportFacts
(2), problemReportDetails, museSettings (incl. both contributor
readers), collect.rowIdentity, catchInventory (15); reports e2e 26 of
27 (1 EPERM setup). Red/green: classifier without the rule fails
`check:catches` (exit 1, sixteen new GENERIC sites); restored green.
`failureExit` printing the plain sentence fails reportFailureReasons
(1 failed); restored green (exit 0). The `--from` e2e failed on the
pre-fix tree (V8 message in stderr); the SyntaxError guard makes the
exact-match pass. Real CLI on the built `dist/acp.js`: `report
release` exits 2 with `A release report needs a version.` first;
`report --help` exits 0 with usage plus `Available reports` labels.

Gates (merge-03 tree): prettier 0; eslint 0; typecheck 0 (5 projects);
l10n 0; reference 0; host-api 0; plan 0; roadmap 0; catches 0;
duplication 0; cycles 0; deadcode 0; build 0; audit 0 (4 advisories,
2 exceptions); SAST 1 (sandbox `semgrep-core rule validation
failed`, same as merges 01-02, hosted CI owns the scan); vitest
related exit 1 with 22021 passed and 7 failed — 4 EPERM symlink
setups (importIo, reportSourceReasons x2, reports e2e linked half),
the brief's carve-out, and 3 vault-broker suites pulled in by the
related closure, not re-run per the vault prohibition; all left to
hosted CI.

## Landed: source 04, the report flow (rig: MacBook, 2026-10-24)

`src/RLUSAGE/04-feat-report-flow` (REPORTFLOW round 1 and 2) was merged on
the owner's PC and left uncommitted when Muse's quota ran out; this rig's
tree carried the resolved result without the branch's ref, so it is
committed as a plain commit of that resolution (no second parent).
Everything the branch does is recorded in `docs/certification/report-flow.md`,
which is the lane's record for it. What this rig reworked for current main:

- the nineteen catch sites the catch gate could not classify, and the one
  import cycle the merge closed (record: "Gate rework in this merge");
- the four report bounds are documented as error-survival waits with cited
  standard values (D121 and D208, owner 2026-10-23), and the surface-timeout
  fallback now says why in its pick's title (`reportFallbackTitle`, all 14
  tables);
- the terminal command keeps the vault scrub port (`buildVaultProblemReportDraft`)
  that the PC resolution had dropped there, pinned by a new `reportCommand` case;
- `/report problem` in ACP names the reason like `/report` does, with a new
  suite (`acpProblemReport`, 5);
- two test-only seams in `ConversationReports` with no remaining test were
  removed; scripted rejections in the new suites became real ENOENT
  failures; the three suites share `test/unit/helpers/reportFixtures.ts`;
- `lazyBundles.generated.ts` regenerated for `dist/reportFallback.js`
  (`dist/reportFallback.js` 24.4 KiB of 50 KiB; `dist/report.js` 32.1 KiB of
  75 KiB; `dist/extension.js` 429.0 KiB of 600 KiB; `dist/acp.js` 336.6 KiB of
  850 KiB; no budget touched).

Real use of the packed product (no Muse or model request; the agent's own
`report` subcommand, run from the built `dist/acp.js` with a throwaway
`HOME` under `temp/` so the owner's keychain was not read): `report
--description "…"` printed the scrubbed draft with `Built:`, the four new
fact lines and `Recent events (0)` and exited 0; `--out temp/real-report.md`
wrote the same draft and exited 0; `--out /no/such/dir/report.md` printed
`The report could not be saved.` and exited 1, with the fixed-reason line
`the report could not be written (Error)` in the log channel. Not run here:
the VS Code dialog and `/report problem` through an editor (no GUI, and no
nested ACP session while Muse's allowance is used up until 2026-10-25
17:00 Pacific).

Report determinism across processes, time zones and languages
(`test/e2e/reports.e2e.test.ts`, 4 new cases, real built CLI, a fresh
process per case): a saved report prints the same bytes as its golden in
UTC, Asia/Kolkata, Pacific/Kiritimati and America/Los_Angeles, and the
German rendering is identical across the four zones. Red/green: a
`reportTimestamp` that follows the machine's zone (`getTimezoneOffset`)
fails the three non-UTC cases and the existing golden cases on this
Pacific-time Mac (exit 1); restored byte-exact (`57743634ec85` before and
after), exit 0 (31 passed).

Gates (merge-04 tree, rig MacBook, 2026-10-24): prettier 0; eslint 0;
typecheck 0 (5 projects); l10n 0; reference 0; host-api 0; plan 0
(PLAN.md is within 146 bytes of its 85% gate, so the M93 status is one
line; archiving closed history to `docs/plan-archive/` is the next
change's first job); roadmap 0 (regenerated); catches 0; duplication 0;
cycles 0; deadcode 0; build 0 with every budget holding.
`vitest related` over the 31 changed source files, excluding the vault
suites and the four OS credential-store suites the MacBook rule forbids:
21,855 passed, 10 failed, 101 skipped (695 files). One failure was this
change's (`reportRecorderUnavailable`: the report now says why recording
was unavailable; its expectation was updated, passes). The other nine,
measured on the untouched base (`96cdfb921`, extracted to `temp/base`) and
on this tree with the same files: `outputSchema` (1), `resourceCreatedSweep`
(4) and `vsixCompression` (2) fail identically on both; `resourceProbesDarwin`
(1) reads the live Mac's headroom and failed 2 of 3 runs on the base and 3 of
3 on this tree (a value taken from the running machine, not from this
change); `scheduleFireFailures` (1) hit its 5 s deadline once inside the
3-worker run and passes alone on both trees (cause UNMEASURED, load).
`security:audit` exit 1: 13 advisories (high: `@azure/msal-node`,
`undici`, `zod`) on a `package.json` and lockfile unchanged since 0.19.0,
where the PC's run of 2026-10-22 saw 4; the advisory feed moved, and a bump
or a reviewed dated exception (PLAN.md D29) is the lead's call. SAST exit 1:
`semgrep is not installed` here (installing it is a global install the rules
forbid); hosted CI owns the scan.

## Prior checkpoint

On 2026-10-21 this lane stopped blocked at the 733-byte overage with the
merge uncommitted; the handoff (`.lane/RLUSAGE.report.md`, gitignored)
described the stop condition, the five unmerged paths and the open gates.
This record supersedes it: the overage is answered by the export split,
the merge is committed, and every gate above ran on the final tree.

## Remaining

- **Source 05 (`src/RLUSAGE/05-m113-s`, from `rigs/win11/m113/s`) is not
  in this repository.** `git ls-remote ~/gates/muse.git
'refs/heads/src/RLUSAGE/*'` lists nothing, and no other bare repository,
  worktree or `packed-refs` on this rig names it. Lane S's own work
  (`docs/certification/m113-s-local-sources.md`, `src/core/reporting/sources/`
  git, changelog, certification, session, usage and agent-usage sources) is
  already on main through the C-M113-1 port, so what the branch would still
  add is unknown and nothing was merged or invented. The lead supplies the
  ref (`git fetch ~/gates/muse.git 'refs/heads/src/RLUSAGE/*:refs/remotes/src/*'`)
  and the lane resumes with that one merge.
- **M102 headless BYO accounting** (the ACP and `exec` provider runs
  recorded in the usage journal under the paid-budget admission) is not
  built: proving it needs a request to a configured provider, and no paid
  provider call or Muse request may be made here. Source 02 already makes
  the terminal agent's turns journal (whole-millisecond clock).
- **M102 checklist reconciliation:** the items that need a browser (axe on
  every usage state), another host (Kubuntu, Mac mini, Win11, VS Code forks,
  Zed) or both VSIX builds are the lead's; none was ticked without its
  evidence. Packed `usage` and `usage --json` ran on this rig's built
  `dist/acp.js` over an empty journal (exit 0).
- **M113:** the fleet kind's local-agents part, the issues kind (after
  M115w) and Gmail and Outlook sending (the owner's OAuth clients) stay
  open. Lane Q's reports port, `schedule_report` and `postReport` are
  already in the code; their packed use needs the network or a model and was
  not run.
- **PLAN.md** is 111 bytes under its 85% gate (`check:plan`), so the next
  change that adds plan text first archives closed history
  (`npm run plan:archive`, CONTRIBUTING.md): that needs the list of what open
  branches touch, which only the lead has.
- Not run on this rig: browser suites (`test:a11y`, `ui:look`), the VS Code
  integration tests, the OS credential-store and vault suites (the MacBook
  rule), SAST (`semgrep is not installed`), and the Windows-only parts, which
  hosted CI's Windows job proves: the report suites normalise nothing path-wise
  beyond `path.join` and use no POSIX-only calls.

No push, tag, reset, rebase, stash, credential read or model call occurred
in this lane.

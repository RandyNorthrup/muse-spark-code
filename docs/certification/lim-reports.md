# LIM-REPORTS: no timeout of ours ends a report source read (D121/D208)

Lane LIM-REPORTS, branch `lim/reports`, base `87753d1877`, Windows 11
workstation, 2026-10-21. `REPORT_SOURCE_TIMEOUT_MS` (5,000) abandoned report
source reads after five seconds: GitHub, the Marketplace, Open VSX and npm
store reads, the local git reads, the schedules store's lease wait and a
saved report's read. On slow Windows CI runners a real store read ran past
it and came back `unavailable`, so `storeProject.test.ts` and
`reportProductionTransport.test.ts` failed intermittently. The owner's rule
(D121, D208, 2026-10-16: "no limit in the codebase that is not about a
model") leaves only a provider's documented limit, a value the person set,
or the person's own cancel to stop a read.

## What changed, site by site

| Site                                                       | Before                                                                        | After                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cache.ts` `ReportNetworkReader.read`                      | `setTimeout` aborted the read's controller with `source-timeout` after 5 s    | No timer. The caller's signal ends the read; the controller only stops pages still in flight once the read settled                                                       |
| `cache.ts` `rateLimit`                                     | A limited answer naming no future instant held the origin for an invented 5 s | Only the server's own Retry-After, or GitHub's reset at the floor, holds the origin; otherwise the next read asks the server again                                       |
| `cache.ts` dispatch, `admission.ts`                        | A `source-timeout` abort stepped `timedOut`; refusals read `source-deadline`  | The `timedOut` event is gone (nothing could raise it); an abort refuses with `source-cancelled`                                                                          |
| `github.ts` `ghReportTransport`                            | `gh api` ran with `timeout: 5000`                                             | `timeout: Infinity`: gh's own exit or the caller's signal ends it                                                                                                        |
| `github.ts` `postReport`                                   | A 5 s timer abandoned the post (`post-deadline`)                              | No timer; only the caller's signal ends it (`post-cancelled`); a dispatched post still stays uncertain                                                                   |
| `local.ts` `localSource`                                   | `context.deadline ?? startedAt + 5000` armed a timeout on every read          | No default: a deadline binds only when the caller hands one in (none does in production now); non-finite values name none. The race and settle grace moved into a helper |
| `local.ts` `sourceFreshness`, `checkRuns.ts`               | Labelled `fresh`/`stale` against the timeout constant                         | Same labels against `REPORT_SOURCE_FRESH_MS` (5,000), which stops nothing                                                                                                |
| `engine.ts` generate                                       | `deadline: Date.now() + 5000` on every source context                         | No deadline; one caller signal for the generation                                                                                                                        |
| `engine.ts` check journal `commit`                         | `rev-parse HEAD` under `AbortSignal.timeout(5000)`                            | `commit(signal)` takes the turn's signal (`verifyLoop.ts`, `reportCheckBundle.ts`, `ModelApiHost.ts`), so Stop ends it                                                   |
| `main.ts` `readSaved`                                      | A saved report read under `AbortSignal.timeout(5000)`                         | Reads to end of file; the person's interrupt of the command stops it                                                                                                     |
| `selections.ts`                                            | `AbortSignal.any([outer, AbortSignal.timeout(5000)])`                         | The caller's signal alone                                                                                                                                                |
| `playbookSchedulesInputs.ts`                               | The lease wait ended `busy` at `now + 5000 - SCHEDULE_LEASE_POLL_MS`          | No deadline: the read waits for the holder's release or the lease's expiry, or the caller's cancel                                                                       |
| `runtime/reporting/sources.ts` `reportGitIo`               | git probe and reads with `timeout: 5000`                                      | `timeout: Infinity`                                                                                                                                                      |
| `core/resources/commands.ts` `execResourceFile`            | Any absent or finite `timeout` armed `AbortSignal.timeout` (absent: 20 s)     | `timeout: Infinity` names no deadline (as `src/host/git.ts` reads it); absent and finite values are unchanged                                                            |
| `constants.ts`                                             | `REPORT_SOURCE_TIMEOUT_MS = 5000`                                             | Deleted; `REPORT_SOURCE_FRESH_MS = 5000` labels only                                                                                                                     |
| `en.ts` and the 14 tables, `reportSourceReasons.cancelled` | "The source read was cancelled or timed out."                                 | "The source read was cancelled." (no default timeout remains to name)                                                                                                    |
| PLAN.md D93                                                | "**Timeouts** per source (`REPORT_SOURCE_TIMEOUT_MS`)"                        | "**No timeout of ours**", with the label constant and the server-only rate-limit hold                                                                                    |

## Tests changed

- `playbookSchedulesInputs.test.ts`: "reports a held production lease as
  busy" and "stops a queued reader on its deadline" asserted the 5 s
  deadline. They are replaced by one case that holds a real production
  lease for 6 s (past the former deadline), checks the read is still
  waiting, releases the holder and gets an `ok` record, with the tree frozen
  after it settled. "ends every refresh busy" waited out five deadlines; it
  now cancels five refreshes through their own signals, checks each is
  `cancelled` and that none acquired the lease, then reads fresh.
- `reportEngineCancellation.test.ts`: the handed-deadline case is renamed
  (there is no default timeout to beat); the admission queue case retires
  its owner with `aborted`, since `timedOut` is gone.

## Red drills

| Drill                                                                   | Command                                                                                     | Red                                                                                                                                  | Green  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `AbortSignal.timeout(1)` added to `ReportNetworkReader.read`'s signal   | `npx vitest run test/unit/storeProject.test.ts test/unit/reportProductionTransport.test.ts` | exit 1, 7 failed: `AssertionError: stores: The report could not be generated. (source-cancelled): expected 'unavailable' to be 'ok'` | exit 0 |
| `deadlineMs: Date.now() + 4750` restored on the schedules reader's lock | `npx vitest run test/unit/playbookSchedulesInputs.test.ts -t contention`                    | exit 1: "waits for a held production lease past the former deadline" `expected true to be false` (the read settled busy before 6 s)  | exit 0 |

Both stores suites serve the committed 2026-10-11 captures through the
injected public fetch (AGENTS.md rule 14); no network is reached.

## Local gates (Windows 11 workstation)

`npx prettier --check` and `npx eslint --max-warnings 0` on the touched
files, `npm run typecheck`, `node scripts/check-l10n.mjs`,
`npm run check:catches`, `npm run duplication`, `npm run deadcode`,
`npm run cycles`, `npm run check:plan`, `npm run check:roadmap` and
`npm run build` (budgets held) all exit 0. `check:catches` first named
eight changed sites: the same handlers with their bodies unchanged, whose
identity hash moved because code around them changed (per-file class counts
are equal before and after). They were audited and the baseline regenerated
with `--write-baseline`; no count rose or fell.

`npx vitest related <the 17 changed src files> --run` exits 1: 11 files and
8 tests failed of 22,176. Six tests call `fs.symlink` in their own setup and
get Windows `EPERM` (no symlink privilege on this account):
`reportSourceReasons` (2), `reports.e2e` (1), `importIo` (1),
`vault/brokerSocketDirectory` (2). Five Windows vault suites failed their
setup on `%TEMP%` (bootstrap code 23), `mediaConvert` on its media root and
`Palette` on one price text; those seven files rerun with
`TEMP=C:/Users/Randy/mx-vtmp` pass (46 tests, exit 0). The symlink cases
stay failing here; hosted CI decides them.

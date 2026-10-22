# RLWINFIX — Windows defects found by using 0.19.0 for real (2026-10-22)

Each item: the symptom on the owner PC (VS Code 1.142.0/1.138.0, Windows
11), the measured root cause, the fix, and the red/green drill. Every
drill runs real code only; exit codes are pasted, not described.

## Item 1 — Show Resources drops a host message

Symptom: `Muse Spark: Show Resources` logged `[error] Webview error
(hostMessage): Dropped malformed host message: ✖ Invalid input → at
value` every time, so the view never got its state.

Root cause: the host answers `sharingResult` with `value: undefined` on
the failure path and for valueless actions, while the schema required
`value`; the JSON transport drops the key, so validation failed `→ at
value`, the sharing call hung, and the failure notice never showed.

Fix: `src/shared/protocol.ts:962` makes `value` optional, and
`src/webview/state/store.ts:63` names every future drop
(`Dropped malformed host message (<type|keys>): <err>`).

Drills:

- `npx vitest run test/unit/sharingResultDelivery.test.ts` — 4 tests.
  Red on the unmodified schema (missing-`value` delivery fails), green
  after (exit 0).
- `test/integration/resourcesShow.test.ts` runs real Show Resources in a
  dev host and scans the logs for new drop lines: green (exit 0). A
  planted `resourceStatus` violation fails red with `(type resourceStatus)`
  naming it, then reverts to green.
- `npm run ui:look -- resources-throttle` renders the scene (the harness
  warns about a pre-existing stale `composerState` missing
  `isFastEnabled`, out of scope for this lane).

## Item 2 — Windows CPU sampler and process-tree reading

Symptom: `muse-spark-code-acp resources status` printed `CPU Use:
Unknown`, and the extension logged `Resource tree or sampler reading is
unavailable` hourly.

Root cause, three parts: (a) queue admission held work while registry
occupancy was unknown; (b) the one-shot `status` command read the CPU
sampler before its first sample settled; (c) retention alarms carried no
cause.

Fix: `src/core/resources/queue.ts:221` admits on unknown occupancy
(`Math.max(count ?? 0, reservations)`); `src/runtime/resources/host.ts:149`
settles one sample on the referenced timer in `command()` only, never on
the admission path; `src/core/usage/resourceJournal.ts` threads
`onRetentionError(error)` through to the log.

Drills:

- `test/unit/resourceQueueUnknownOccupancy.test.ts`,
  `test/unit/resourceStatusCpu.test.ts`,
  `test/unit/windowsTreeReader.test.ts`,
  `test/unit/resourceRetentionCause.test.ts` — red before (status shows
  `Unknown`, unknown occupancy holds work, retention drops the cause),
  green after (exit 0).
- Live CLI: `node dist/acp.js resources status` printed `CPU Use:
Unknown` before, `CPU Use: 13%` after. An early version settled in
  `status()` on an unref'd timer and the CLI printed nothing; bisected by
  temp-revert, fixed by settling in `command()` on a referenced timer.
- Neighbours green: resourceNoLimits, contracts, teamResources,
  acpResources, museServeAdmission, journalCorrupt, treeFailures,
  diskDelta, delivery, teamQueueNoCap, journal retry/truth/invalidLines/
  deltas/noDefaultLimits/reportBoundaries.

## Item 3 — Usage journal record/restore failures and the torn line

Symptom: activation logged `Usage history could not be recorded` and
`Paid usage history could not be restored` with no cause, and Usage &
Cost showed `1 incomplete line skipped`.

Root cause: `UsageJournalStore.read()` took the rollup lock with a
single acquire, so a second window's snapshot or retention made the read
fail `usageLocked` behind both warnings. The torn line is an interrupted
append, not interleaved writers: writer files are per-process UUIDs,
appends are queued whole lines, and the owner's fossil is a complete
line plus 911 zero bytes (2026-10-16,
`c7d4fa59-…jsonl`); it is skipped and counted as designed and cleared by
retention.

Fix: `src/core/usage/journalLock.ts` shares `acquireJournalLock`
across read/retain/reset (both journals; a leaf, so the resource
journal's bundle stays clear of pricing); `src/core/usage/failures.ts:34`
names every warning's cause through `recording.ts`, `usageServiceEntry.ts`
and `paidHost.ts`.

Drills:

- `test/unit/usageLockWait.test.ts` (2 tests): a peer holding the lock
  200 ms reads through; an instant clock on a never-freed lock still
  names `usageLocked`. Green (exit 0).
- `test/unit/usageWarningCause.test.ts`: the record warning reads
  `Usage history could not be recorded (usageLocked)` and the restore
  rejection unwraps to it. Red on the base bare warning (1 failed, exit
  1), green after (exit 0).
- Neighbours green (29 tests): usageTruth, usageTornLock, usageService,
  usageContracts, resourceJournalCorrupt, usageJournalRetry,
  usageJournalInvalidLines.

## Item 4 — Judge folder removal and batch race

Symptom: `The Muse Code judge could not remove its folder: Error` after
each judged approval (`EBUSY … rmdir … approvals/…`), and `The Muse Code
judge batch failed: the approval stopped waiting` when an approval was
answered quickly.

Root cause: the batch folder went with one `rm` attempt, so a file
Windows held a moment longer failed every time, and `failureForLog`
named only `Error`. The batch signal aborts on answer, so an answer
landing before the batch started reported a failure.

Fix: `src/host/judge/tempRoot.ts` retries held-file failures bounded
(`JUDGE_TEMP_REMOVE_ATTEMPTS`, `JUDGE_TEMP_REMOVE_RETRY_MS`) and names
the real code; `src/host/judge/museCodeSameJudge.ts:237` stands answered
batches down at info (pre-start, no-reply, and abort-throw sites), while
a timed-out batch still fails loud.

Drills:

- `test/unit/judgeTempRoot.test.ts` (3 tests): removes a real tree, waits
  out a CWD pin, names a real held failure by its code. Green (exit 0);
  red with single-attempt removal (1 failed, exit 1).
- `test/unit/judgeBatchStandDown.test.ts` (3 tests): answered approval
  stands down quietly and settled, timeout still fails loud, removal
  failure names its code through the real adapter. Green (exit 0); red
  with the base pre-start branch (2 failed, exit 1) and with base
  `failureForLog` (1 failed, exit 1).
- Neighbours green (52 tests across 6 files): judgeSameSession,
  judgeSameSideRequest, judgeEntries, judgeStandingAllowed.

## Item 5 — MCP job executable retire-on-exit

Symptom: `an earlier MCP job executable could not be removed yet (EPERM
…shellJobMuseSparkMcpJob-*.exe)` on every activation.

Root cause: `removeStaleJobs` warned on every attempt while the file was
loaded, and nothing ever retried it except the next compile.

Fix: `src/host/backend/staleJobs.ts` sends held builds pending
silently (`removeStaleJobs`) and retires them on every job-helper child
exit (`retireStaleJobs`; `mcpJobLaunch.ts` hooks in `spawnMcpJob` and
`spawnAttestedJob`); the sweep runs on every preparation, and a build
whose bytes are current again is never removed. Naming and retirement
live in the leaf module so the launch path stays cycle-free.

Drills:

- `test/unit/mcpJobRetire.test.ts` (4 tests, win32): a running copy goes
  pending silently and retires once freed; an unheld stale build goes at
  once; a downgraded build is kept; a real `spawnMcpJob` child exit (real
  compiled launcher, real payload) sweeps the freed build. Green
  (exit 0).
- Red with warn-on-held restored: 1 failed (exit 1), logging the exact
  owner line `an earlier MCP job executable could not be removed yet
(EPERM: operation not permitted, unlink …`.
- Red with the exit hook removed: 1 failed (exit 1), `the retired file
is still there`.
- Neighbour green: windowsTreeReader (2 tests).

## Gates

Full battery on the final tree (exit codes in the lane report,
`.lane/rlwinfix-report.md`). Vault suites never ran on this PC per the
lane rules; hosted CI owns them.

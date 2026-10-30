# RLF-SAFELIMITS — Safety limits restored (2026-10-23)

Rig `macmini`, branch `rec/rlf-safelimits`, base `f53ef168fe` (main at
0.19.0 plus 40 merged lanes). The owner clarified D121 on 2026-10-23,
verbatim: "no limits mean the limits we set it does not mean dont put
any limits obviously there needs to be limits for things like fail
retries". Recorded under D121 in PLAN.md §2 (D208, spend checks, says
nothing of the same and is unchanged).

Verdict: arbitrary caps of ours on the person's work stay removed; ten
safety limits are restored at cited industry-standard values, each
stopping with words after the last attempt. None is person-settable:
each is an internal resilience default no person would tune, and the
one caller-facing seam (hand-off deadlines) already takes the caller's
own value. The 2026-10-21 time-limit removals are not reverted; their
hang-forever risks are reported with proposals in §6.

## 1. Classification

Every limit removed between main (`f3941b8548`) and the base (`HEAD`
at lane start) was found via `git log` for messages saying "remove",
"no limit", "bound", "D121" or "D208", a full-diff scan of removed
lines matching `RETRY|ATTEMPT|ROUNDS|TIMEOUT|DEADLINE|MAX_|LIMIT|CAP|
BOUND`, and the removed-constants diff of `src/shared/constants.ts`.

| #   | Removed                                                         | By                                | Verdict                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `SCHEDULE_FS_RETRY_ATTEMPTS` (5)                                | cb8e0b3e6 RLF-NOLIMITS            | Safety: restored R1                                                                                                                                                                                                                                                                     |
| 2   | Snapshot-loop attempt count (schedules report reader)           | efed6eb83 RLTESTDRIVE 9           | Safety: restored on the same count R1                                                                                                                                                                                                                                                   |
| 3   | `ORPHAN_SWEEP_ROUNDS` (5)                                       | 9314cdb38 RLF-NOLIMITS            | Safety: restored R2                                                                                                                                                                                                                                                                     |
| 4   | `VISIBILITY_TIMEOUT_MS` (30 min)                                | 6e2b9684b RLF-NOLIMITS            | Safety: restored R3                                                                                                                                                                                                                                                                     |
| 5   | `GIT_WORKTREE_TIMEOUT_MS` (5 min) + batch deadline              | 9c17af0cd, 1ad81b49a RLF-NOLIMITS | Safety: restored R4                                                                                                                                                                                                                                                                     |
| 6   | CreatedRegistry CAS republish, unbounded (`for(;;)`, new loop)  | a46301c88 RLWINFIX2               | Safety: bounded R5                                                                                                                                                                                                                                                                      |
| 7   | `SCREEN_RECORDING_REMOVE_ATTEMPTS` (3)                          | efed6eb83 RLTESTDRIVE 9           | Safety: restored R6                                                                                                                                                                                                                                                                     |
| 8   | `RESOURCE_HANDOFF_TIMEOUT_MS` (10 s)                            | efed6eb83 RLTESTDRIVE 9           | Safety: restored as default R7                                                                                                                                                                                                                                                          |
| 9   | `TAB_REQUEST_TIMEOUT_MS` (67 s)                                 | aa427d2a RLF-TAB                  | Safety: restored at 600 s R8                                                                                                                                                                                                                                                            |
| 10  | `LOOKUP_TIMEOUT_MS` (120 s)                                     | efed6eb83 RLTESTDRIVE 9           | Safety: restored R9                                                                                                                                                                                                                                                                     |
| 11  | `LOOKUP_PAGES` (3)                                              | efed6eb83                         | Arbitrary: the walk is bounded by GitHub's own short-page end; stays removed                                                                                                                                                                                                            |
| 12  | `TAB_MAX_IN_FLIGHT`, `TAB_MAX_REQUESTS_PER_MINUTE`              | c35398af5 RLF-TAB                 | Arbitrary pacing counts; provider pacing stays; stays removed                                                                                                                                                                                                                           |
| 13  | Tab output token caps                                           | eeef77245 RLF-TAB                 | Arbitrary: person's setting or provider record max; stays removed                                                                                                                                                                                                                       |
| 14  | `DAMAGED_SESSIONS_KEPT` (50)                                    | c5dfb150 RLLIMITS                 | Arbitrary retention of the person's data; stays removed                                                                                                                                                                                                                                 |
| 15  | `REPORT_SOURCE_SETTLE_MS`                                       | 067d3777 RLTESTDRIVE 9            | Not a limit: a grace delaying cancellation; removal cannot hang; stays removed                                                                                                                                                                                                          |
| 16  | Editor-chat daily cap, ledger, budget setting                   | 70c68970d                         | Arbitrary spend cap of ours; stays removed                                                                                                                                                                                                                                              |
| 17  | Turn-call 200 default (D109)                                    | RLSCHEMA                          | Arbitrary; stays removed                                                                                                                                                                                                                                                                |
| 18  | `DEVICE_LIMITS` (26 numbers)                                    | cff16f063 RLM100                  | Not from main: new source-branch code triaged at landing; all capacity/retention caps; wire byte caps stayed; no action                                                                                                                                                                 |
| 19  | `RECAP_SETTLE_TIMEOUT_MS`                                       | b9a89b4b                          | Not removed: replaced by shared `MSP_SETTLE_TIMEOUT_MS`; no action                                                                                                                                                                                                                      |
| 20  | `OAUTH_CODE_TTL_MS`, `PROVIDER_PROBE_TIMEOUT_MS` uses           | 43756d01, 7cd92fd0                | Not removed: moved/refactored, still live; no action                                                                                                                                                                                                                                    |
| 21  | RLUSAGE trace file count/byte/age ceilings                      | unmerged branch                   | No `rec/rlusage` branch in this repo and no `lanes/*usage*`, `*rlusage*` or `src/RLUSAGE/*` in the bare repo; nothing merged, nothing to review. Provisional: retention caps on the person's data read arbitrary (machine-resource limits are person-set); the lead's lane will confirm |
| 22  | Transport model-request retries (person → provider → unbounded) | D121 design, kept                 | Person's work, provider-governed waits (Retry-After/backoff) plus the person's stop; stays                                                                                                                                                                                              |
| 23  | `migrate.ts` reconcile loop (`for(;;)`)                         | pre-existing                      | Unbounded at main too; not a removal; out of scope, noted for the lead                                                                                                                                                                                                                  |

## 2. Restores

### R1 — `SCHEDULE_FS_RETRY_ATTEMPTS` (5) + snapshot bound

A transient-coded schedule storage failure retries five times over
200 ms of backoff, then the last error surfaces with its kind; the
RLF-NOLIMITS stop threading still ends the wait early. The schedules
report reader's snapshot loop is bounded by the same count and reports
`busy` instead of spinning on churn that never settles. Citation:
bounded transient retries are the industry shape — the OpenAI and
Anthropic SDKs retry twice by default
(openai/openai-node and anthropics/anthropic-sdk-typescript READMEs),
AWS SDKs attempt three times in standard mode (AWS SDKs reference,
"Retry behavior"); five attempts ride out a Windows scanner lock
without waiting on a never-clearing denial. Not person-settable:
internal resilience no person would tune. Words: the raw failure keeps
its kind through the existing failure paths (callers match on codes).

Drill (test `scheduleFsRetryStop.test.ts`, kernel-denied directory):
red (bound disabled) — the bound test runs 5005 ms into the suite's
own timeout, exit 1, never settling; green — 3 passed, exit 0, the
persistent denial rejecting with its transient kind after five
attempts. The snapshot `busy` path is not deterministically reachable
with real parts (no pre-removal test either; RLTESTDRIVE measured it
un-fireable), so it shares this drill's bound mechanics; the churn
agreement test still passes (see §4).

### R2 — `ORPHAN_SWEEP_ROUNDS` (5)

The MCP exit-cleanup sweep reaps at most five generations, then logs
`children of <pid> kept appearing for 5 rounds after its tree kill`.
The stop threading still ends the sweep early with words. Citation:
`taskkill /T` itself makes a single enumeration pass (Microsoft Learn,
"taskkill"); five identity-checked generations exceed the platform
tool and every spawn chain the 0.6.0 gate observed. Not
person-settable. Windows-only path: hosted CI's Windows leg is the
real-run proof, as for RLF-NOLIMITS.

Drill (`temp/rlf-safelimits/drill-r2-sweep.mts`, real `sweepExitedTree`,
scripted PowerShell answers): red (loop unbound) — 12,789 rounds in
10 s, killed mid-loop (SIGTERM), no final words; green — exactly 5
rounds plus the kept-appearing line, exit 0.

### R3 — `VISIBILITY_TIMEOUT_MS` (30 min, shared)

The registry-visibility poll ends at visibility, an integrity
mismatch, the release's own stop, or the shared 30-minute bound with
the waited-ms backstop; a still-pending artifact warns (`published,
not yet visible after the 30-minute registry check`) and the release
stays published. The shared poll, per-round pending words and stop
threading stay. Citation: no registry publishes a visibility SLA (npm
documents none), npm took 19 minutes for 0.16.0, and the publish jobs'
own timeout-minutes (60/60/40) enclose the wait; 30 minutes restores
the pre-removal production value. Not person-settable: release
tooling whose operator surface is the jobs' timeout-minutes.

Drill (`temp/rlf-safelimits/drill-r3-visibility.mjs`, real
`pollAllVisible`, never-visible registry, virtual clock): red
(deadline checks disabled) — killed by the 10 s process timeout with
zero output, never returning; green — pends after the budget (1,890 s
slept over 17 rounds, every round naming the pending labels), exit 0.
Tests: a never-visible registry pends after the budget; a 19-minute
registry (npm 0.16.0) still resolves visible; 7 passed.

### R4 — `GIT_WORKTREE_TIMEOUT_MS` (5 min)

Bounds the session board's metadata reads, the forced worktree remove,
the held checkout's listing, and the native checkout's git runs,
listing and batch child (whose own deadline option is restored: a
root that ignores its signal still ends the checkout with the
unreadable words). Citation: five minutes is npm's own fetch-timeout
default, verified on this rig (`npm config get fetch-timeout` →
300000, npm 11.19.0) — the standard wait for an answer that may
legitimately take a while. Not person-settable. Words: the git
runners' `timed out after X ms`, the listing/batch unreadable words.

Drill (test `nativeCheckout.test.ts`, real 30 s child, 500 ms
deadline): red (batch deadline disabled) — the deadline test runs
5006 ms into the suite's own timeout, exit 1; green — 15 passed, exit
0, the slow child ending with the unreadable words while a 300 ms
child inside its deadline runs free. Suites: nativeCheckout (15),
governedCheckoutGit, sessionBoard, worktreeCommands, heldCheckoutCore
— all green; the named-timeout mechanics stay covered by
`gitNoKill.test.ts`.

### R5 — Created-registry republish bound (5) + `contended`

A save that loses its compare-and-swap republishes at most five
times, then throws the new `contended` reason: "The created-resources
registry could not be saved (another running copy kept saving first;
try again)." (English plus all 14 tables, `startText` mapping; the
log names `CreatedRegistrySaveError contended`.) Citation: Kubernetes
client-go `DefaultRetry` — "the recommended retry for a conflict
where multiple clients are making changes to the same resource",
Steps 5 (k8s.io/client-go/util/retry/util.go, verified); concurrent
instances are exactly such clients, and each attempt already spaces
itself on disk I/O and the helper spawn, so no extra backoff was
added. Not person-settable.

Drill (`temp/rlf-safelimits/drill-r5-cas.mts`, two real registry
instances plus a second contender through the real macOS helper
built by `native/darwin/build.sh`, publish calls counted around the
real commands): red (bound disabled) — a save publishes 8 times with
zero `contended`; green — max exactly 5 publishes per save across 30
victim saves, 2–5 `contended` with the person's words, every save
settling (landed, contended or a named safety outcome). The
two-process race suite stays green (8/8 created, nothing lost); it
needs the macOS helper, which this rig built locally as CI does.
`contended` is not deterministically forcible with real parts (same
rationale as `refused`), so no committed test forces it; the bound
mechanics are this drill's, the words are `startText.test.ts`'s.

### R6 — `SCREEN_RECORDING_REMOVE_ATTEMPTS` (3)

A held-file failure while removing the preview directory retries
three times over 200 ms waits, then the real error surfaces with its
kind; the person's cancel still ends the wait early. Citation:
bounded held-file retries are rimraf's shape (npm's standard remover,
rimraf 6.1.3 in this repo's tree: `MAXRETRIES = 10` for
EBUSY/EMFILE/ENFILE); three attempts match the repo's own
`JUDGE_TEMP_REMOVE_ATTEMPTS` for the identical failure class. Not
person-settable.

Drill (test `windowsRecording.test.ts`, permanent EPERM): red (bound
disabled) — the bound test runs 5006 ms into the suite's own timeout,
exit 1; green — 11 passed, exit 0, the lock error surfacing after
exactly 3 attempts while a brief lock still clears inside the budget.

### R7 — Hand-off safety default (10 s)

A hand-off with no caller deadline stops waiting after ten seconds
and counts the adapter as launched — detached, never killed. The
caller's own deadline wins when passed (the usage-page opener keeps
its own), and the adapter's exit, start or cancel ends the wait
sooner. Citation: OS behavior — hand-off adapters return promptly
once started, and Windows PowerShell's cold start for Set-Clipboard
(seconds) sets the bound; the deadline covers admission plus the run.
Caller-settable (every call site may pass its own `timeoutMs`); the
constant is only the default, which no person would tune.

Drill (`temp/rlf-safelimits/drill-r7-handoff.mts`, real
`handoffResourceFile`, 15 s adapter, no caller stop): red (default
disabled) — still pending at 13 s, exit 1; green — resolves at
10005 ms counted as launched with no marker yet, the marker landing
at 15258 ms (detached, never killed), exit 0. The hand-off suite's 3
tests stay green (the 3 s adapter finishes inside the default).

### R8 — `TAB_REQUEST_TIMEOUT_MS` (10 min)

A sent Tab request the provider neither answers nor fails ends at
ten minutes: the trigger fails with "The Tab request timed out
waiting for the provider" and its reservation stands. The editor
still never aborts a sent request; only a true hang fires this.
Citation: the OpenAI and Anthropic SDKs' default request timeout,
600000 (both READMEs, verified) — far past any healthy answer (the
probe: usage at 15 s). Not person-settable. The failure collapses to
the existing fixed `request` kind for the log, as other Tab failures
do; no new UI text.

Drill (test `tabEngine.test.ts`, hung abort-honoring stream, 200 ms
injected backstop): red (timer disabled) — the backstop test runs
5006 ms into the suite's own timeout, exit 1; green — 6 passed, exit 0. The mid-flight-cancellation test still proves the editor never
aborts.

### R9 — `LOOKUP_TIMEOUT_MS` (120 s, whole lookup)

The CI reuse lookup shares one 120-second bound across its page walk
and artifact checks (new `createLookupRequest` factory; the page walk
still runs to GitHub's own short-page end). A hung API aborts into
the existing catch, which falls back to a full rebuild with words
(`Full rebuild: CI lookup unavailable or malformed.`) instead of
failing the job at its own timeout. Citation: sized so the lookup
fails fast enough for the fallback to fit the reuse job's own
10-minute timeout (release.yml), restoring the pre-removal production
value. Not person-settable: release tooling whose operator surface
is the job's timeout-minutes.

Drill (test `releaseReuseTimeout.test.mjs`, never-settling
signal-honoring fetch, 200 ms injected bound): red (signal removed)
— the test runs 5005 ms into the suite's own timeout, exit 1; green
— rejects with `TimeoutError` at ~200 ms, exit 0. The recorded
paging test still walks four pages to GitHub's short-page end.

## 3. Suites

All with the repository's own timeout (no `--testTimeout`), direct
on the rig, `npx vitest run <files> --maxWorkers=3`:

| Suite                                              | Result                                                      |
| -------------------------------------------------- | ----------------------------------------------------------- |
| scheduleFsRetryStop (3)                            | pass                                                        |
| playbookSchedulesInputs (22)                       | 20 pass; 2 load flakes, identical on clean HEAD (see below) |
| processTreeSweep (4)                               | pass                                                        |
| publishRegistry (7)                                | pass                                                        |
| nativeCheckout (15) + governedCheckoutGit          | pass (18 total)                                             |
| sessionBoard + worktreeCommands + heldCheckoutCore | pass (23 total)                                             |
| gitNoKill (named-timeout mechanics)                | pass (existing coverage, re-run green in finals)            |
| createdRegistryRace (2 processes)                  | pass (8/8, needs the macOS helper built, as CI does)        |
| createdRegistrySaveErrors + startText              | pass (9 total)                                              |
| windowsRecording (11)                              | pass                                                        |
| resourceHandoffDeadline (3)                        | pass                                                        |
| tabEngine (6)                                      | pass                                                        |
| releaseReuseTimeout + releaseReusePaging           | pass                                                        |

Two flakes, measured, not assumed. `playbookSchedulesInputs.test.ts`
twice showed 2 tests hitting the 5 s timeout (the churn agreement
test and one stored-word test, each ~3 s alone on this loaded rig);
the same file on a clean-HEAD worktree failed the same way (2, then
1 of the same tests), and the file contains no denial/transient
trigger, so the retry bound cannot engage there — rig load, not this
lane. `createdRegistryRace.test.ts` failed before the macOS helper
was built (workers cannot run; identical ENOENT on clean HEAD);
after `sh native/darwin/build.sh` (what CI runs before the unit
step) it passes with the bound.

## 4. Gates

Run directly on the rig; exit codes verbatim.

| Gate                                                 | Exit  | Note                                                                                                                                                              |
| ---------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier `--check` (all touched files)               | 0     |                                                                                                                                                                   |
| eslint `--max-warnings 0` (all touched code files)   | 0     |                                                                                                                                                                   |
| `npm run typecheck`                                  | 0     | all projects                                                                                                                                                      |
| `node scripts/check-l10n.mjs`                        | 0     | 0 problems                                                                                                                                                        |
| `npm run check:reference`                            | 0     |                                                                                                                                                                   |
| `npm run check:host-api`                             | 0     | 0 problems                                                                                                                                                        |
| `npm run check:roadmap`                              | 0     | regenerated after CHANGELOG/PLAN                                                                                                                                  |
| `npm run check:catches`                              | 1     | Pre-existing: counts match clean HEAD exactly (core GENERIC 280, etc.); one GENERIC of ours (Tab catch) fixed to REPORTED in-lane                                 |
| `npm run duplication`                                | 1     | Pre-existing: 7 clones in untouched files; one clone of ours (recording tests) removed in-lane                                                                    |
| `npm run cycles`                                     | 0     | no circular dependencies                                                                                                                                          |
| `npm run deadcode`                                   | 1     | Pre-existing: all findings in untouched files                                                                                                                     |
| `npm run build`                                      | 1     | Pre-existing: same 10 bundles over budget on clean HEAD (ours adds 0.1 KiB to one already-over bundle); budgets not raised                                        |
| `npm run check:plan`                                 | 1     | Pre-existing: PLAN.md over 85% at base (3,769,703 > 3,565,158); the archive procedure is lead-level                                                               |
| touched suites + `vitest related` per changed source | mixed | All touched suites green; related runs show only rig-load timeouts, sandbox denials and other lanes' drift, each verified identical on clean HEAD (details below) |

Related-test attribution (every failure below reproduced on the
clean-HEAD worktree or sits in a file this lane never touched):

- `scheduleFireFailures` (6), `schedulePauseAfterFailures` (3):
  5 s timeouts; base fails the same 9.
- `playbookSchedulesInputs` (2): 5 s timeouts; base fails the same
  (plus the file has no transient trigger, so the retry bound cannot
  engage there).
- `scheduleLeaseLifecycle` AR8 hash: ours — re-marked per the
  RLF-NOLIMITS precedent with reason and proof; suite green (24).
- `acpServeHandshake`, `connectorStorageGuard` (3),
  `resourceStatusCpu`, `treeSyncNoDeadline` (2, sandbox-denied
  `/bin/ps`), `treesLifecycleNative`, `vaultStoreScope`,
  `vault/writerCrashPosix` (17): base fails identically (5/4/18 per
  batch).
- `windowsPowerShellModules`: flags an unruled start in
  `deviceWorkerHost.ts`, a file this lane never touched.
- `resourceNoLimits`, `resourceQueueUnknownOccupancy` (governor
  `pause` vs `throttle` on live rig readings): base fails the same 2.

## 5. Earlier removals (2026-10-21 order): report-only

Not reverted, per the brief. Hang-forever risks found:

1. `REPORT_SOURCE_TIMEOUT_MS` (report sources run till settle or
   cancel): a source reader that wedges without settling holds its
   report until the person's cancel. Proposal for the lead: a
   report-level watchdog that fails a source with words after a
   bound the lead sets — no industry standard exists for report
   readers, so the value would be ours either way; alternatively
   leave cancel as the stop and document it.
2. `PROCESS_TABLE_TIMEOUT_MS` (the sweep's per-round PowerShell and
   process-table runs have no deadline): a hung `powershell.exe`
   hangs the sweep mid-round; the restored round bound covers
   respawning children, not a wedged helper inside one round.
   Proposal: a per-helper-run bound sized from current cold-start
   measurements — the old 20 s killed legitimate slow first starts
   (see the constant's comment), so the value needs re-measuring,
   not restoring blind.
3. Removed test timeouts: hang CI jobs, not the product; CI time is
   already bounded by job timeout-minutes. No proposal.

## 6. Notes

- `rec/rlusage` does not exist in this repo, and the bare repo holds
  no `lanes/*usage*`, `*rlusage*` or `src/RLUSAGE/*` ref: the RLUSAGE
  trace ceilings were unavailable to review and are unmerged.
- `src/core/schedules/migrate.ts`'s reconcile loop is unbounded at
  main too — pre-existing, not a removal, left for the lead.
- Drill scripts live under `temp/rlf-safelimits/` (gitignored); the
  macOS helper `.app` bundles built for the race suite are gitignored
  build outputs, as in CI.
- Model-request transport retries (person setting → provider maximum
  → unbounded) stay: each wait is provider-governed (Retry-After,
  backoff) and the person's stop ends it — the person's work, not a
  failure loop.

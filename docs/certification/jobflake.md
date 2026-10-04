# JOBFLAKE — Windows job helper recovery

Recorded 2026-10-03 in `mx-jobflake`, branch `fix/job-helper-flake`, from
`175d945d9ca840a12a94abf0b27f2107541b571a`. Scope: M27 helper preparation
and M51's real Windows command assertion. No model calls or dependencies.

## Findings and paths to an unavailable helper

`shellJob.ts:100-105` has one catch that logs
`Windows job objects are unavailable (<error>); a stopped command is ended with taskkill and a sweep for its orphans`
and returns `undefined`. These operations can reach it:

| Operation                            | Failure and logging                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readJobSource('shellJob')`          | Missing/unreadable shipped C# rejects; the catch logs the error. `jobSourceReader` caches each source read, including its rejection; this lane does not change source loading.                                                                                                                                                       |
| `compileJob`                         | Directory creation, source writing, PowerShell spawn/compile, publication or temporary-file cleanup can reject; the catch logs the error. `Add-Type` runs through `runProgram`, whose existing process timeout is `PROCESS_TABLE_TIMEOUT_MS` (20,000 ms). Cleanup in `finally` can replace an earlier error if cleanup itself fails. |
| Assembly load and job join self-test | PowerShell spawn, its timeout/nonzero exit, a forbidden assembly load or a failed Win32 job join rejects; the catch logs the error. The script wraps load/join in `try`, exiting 1 on failure.                                                                                                                                       |
| Self-test's returned text            | Anything other than trimmed `joined` throws `the self-test answered <JSON text>`; the catch logs it.                                                                                                                                                                                                                                 |
| Existing failed preparation promise  | Before this fix, every later call returned the same `undefined` without another attempt or log.                                                                                                                                                                                                                                      |

`isPresent` catches an access failure and returns `false`, causing a build;
it does not itself return an unavailable helper. `removeStaleJobs` catches
its own failure and logs `an earlier shell job assembly could not be removed yet (<error>)`;
cleanup of old versions does not disable a successfully published helper.
Publication uses UUID temporary names and accepts another window's existing
target after a rename failure. There is no build lock or shared temporary
name to explain the observed failure.

**Confirmed defect:** `shellJobAssembly` memoized a failed preparation for
the entire session. Confidence high: both fake-runner recovery controls
fail with the original cache. A cold hosted runner exceeding the existing
20-second compile timeout is plausible, but the specific first failure in
PRs #96/#89 remains unconfirmed because the test discarded the log. No
timeout is changed without that evidence.

## Change

The promise remains shared while preparation runs and after success. Only
an `undefined` result clears it, allowing the next caller one fresh
attempt. A failed caller still receives `undefined` and uses the existing
fallback. Recovery after a self-test failure reuses the published assembly.
There is no internal retry loop.

`toolIo.test.ts` now collects the helper's log and includes every collected
line in `job helper missing`, so future hosted failures expose the cause.
The changelog describes recovery on later commands; no new command,
setting, script or UI requires a README change.

## Test-fire proof

- Local Windows host: `npx vitest run test/unit/shellJob.test.ts` passed
  all 8 tests, including two fake-runner recovery controls.
- Deliberately restored `return () => (ready ??= prepare(deps))` while
  keeping the new tests. The same complete file exited 1: exactly the two
  recovery controls failed (expected assembly, received `undefined`),
  with 6 other tests passing.
- Restored the production file byte-for-byte. Original and restored
  SHA-256 both
  `23845AEA1293F42F68D798CA2CDA06999E3DAD76725DE9D0DE525DF5F86BC13B`.
- Restored Win11 rig run, slot `jobflake`, snapshot
  `d3650766cf3ab7a90f739f9247a3999074b13147`: both complete owned files
  passed, **53 passed / 2 existing platform skips / 55 discovered**;
  exit 0, 21.49 seconds. `toolIo.test.ts`: 45 passed, 2 skipped;
  `shellJob.test.ts`: 8 passed. This includes the real Windows job/UTF-8
  assertion and both recovery controls. This initial run preceded the
  lint-required switch from `.then()` to an equivalent local `await` wrapper.
- Final `await` wrapper: local Windows file passed 8/8. Restoring the old
  cache again failed exactly the two recovery controls, with 6 other tests
  passing. Final source restored byte-for-byte; both SHA-256 values were
  `FD4CA6424690AF84D7D9D7E9B1B41BA6572B846850D9D0AAD852A2E85A62F4EE`.
  Final restored Win11 run, snapshot
  `cd339284eeee590cbfe9e582c0e9ea33dc1ff4c1`, passed both complete owned
  suites: **53 passed / 2 existing platform skips / 55 discovered**,
  exit 0, 15.55 seconds. Production source and tests are unchanged after
  this run; later documentation receipts do not alter the tested behavior.
- Logs and the restoration copy are retained locally under the ignored
  `temp/jobflake/` folder (`red.log`, `win11.log`, `await-green.log`,
  `await-red.log`, `await-win11.log`).

## Static checks

Initial all five type projects passed locally: host, unit, webview, e2e
and integration, each through `npx --no-install tsc -p <project> --noEmit`.
Format, host API (271 VS Code APIs, 23 Node built-ins; 0 problems),
duplication (0 clones), dead code and localization (14 tables; 0 problems)
passed. ESLint required replacing `.then()` with `await`; final receipts
now pass: all five type projects, scoped ESLint with zero warnings,
Prettier, host API, duplication, dead code and localization. Full command
outputs, including the initial failures, are retained in
`temp/jobflake/static-receipts.json`.

Initial production sizes fit every cap (extension 573.1 KiB, Model API
370.5 KiB, checkpoint store 137.5 KiB), but the split gate found five
missing package prefixes. The worktree's `node_modules` was a junction;
its generated metafile named `../mx-cli-live/node_modules/@exodus/bytes/...`
instead of the expected local package prefix. Removed only the verified
local junction, nonrecursively, and ran `npm ci --ignore-scripts` with its
cache inside this worktree. The shared target was untouched. No tracked
dependency or gate change. Final `npm run build` exited 0: all size caps,
bundle splits, host globals and the 82-package notices record passed.
Final sizes: extension 573.1 KiB, Model API 370.5 KiB, checkpoint store
137.5 KiB, plan reader 139.0 KiB, agent import 117.4 KiB, English text
84.7 KiB, search worker 15.2 KiB, page worker 203.2 KiB, webview JavaScript
804.7 KiB/CSS 39.6 KiB and ACP 738.2 KiB.

`npm ci` installed 900 packages and audited 901; it reported 10
vulnerabilities (1 low, 9 high) in the unchanged pins. Full audit/triage
belongs to the lead; this source lane made no dependency changes and ran
no separate network audit, as `common.md` permits network only for
`npm ci` and the explicitly required rig run.

## Lane boundary and remaining verification

The task brief and `common.md` prohibit full quality/full unit runs in the
shared lane; the lead owns aggregate coverage, accessibility, hosted CI
and release certification. `origin/main` already equals this branch's
base; `git merge --no-edit origin/main` reported `Already up to date.`
The older `integrate/m72-on-24ff` branch is absent locally. No push is part
of this task. Required Win11 and scoped gate receipts are recorded above;
the commit uses normal hooks. No lane gate remains open. Aggregate
certification and the pinned-dependency audit triage remain with the lead.

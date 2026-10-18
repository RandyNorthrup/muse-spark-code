# BCSTART — the browser check's start on Windows (2026-10-18)

## The measured cause

The Windows "Browser check" job fails at random because `holdToContract`
(`src/core/browser/browserRun.ts`, the contract read before any canary) asks
`SystemInfo.getProcessInfo` exactly once, right after the browser first
answers on the pipe (`Browser.getVersion`, `Browser.getBrowserCommandLine`,
`Target.getTargets`), and ends the check `unrecognized` when that one answer
lists no `network.mojom.NetworkService` process (`networkServiceId`, then the
`serviceId === undefined` test). Chrome launches the network service as a
utility process asynchronously after its browser process is already serving
the pipe, and on Windows that launch is sometimes not done yet. Run
39083561745 (job 117545337596, PR #169's head) shows it: the capture's report
says `"result": "unrecognized"` immediately after the fact `Browser check:
command line held, 6 other switches`, so the command line passed and the
targets/service test failed; the browser was then killed, so every later
expectation of `scripts/browser-check-restart.mjs` (the service as the
browser's child, the resolver rule before and after, a new service, the same
browser, resumed requests) failed with it. Measured on this Windows 11 PC
with the product's own `runBrowserCheck` and host deps, unchanged and tapped
passively on the pipe, on Playwright's already-installed
`chrome-headless-shell` 153.0.8010.12 (the pinned 154.0.8037.92 is not
installed here, and installing it waits for the owner): 3 of 80 sequential
checks and 5 of 120 checks under three-way contention ended `unrecognized`,
and in each of those `SystemInfo.getProcessInfo` answered
`[{"type":"browser",…}]` alone, 380–580 ms after the spawn, where a passing
check's same call lists the browser, a renderer, the GPU process and the
network service. A replay of the live suite's own sequence on that build
ended `unrecognized` 4 times in 8 valid rounds (its first round is void: the
session's scratch folder was deleted under it), once in "talks over the pipe"
with no browser process ever seen, which is the Win11 rig's unexplained
"`ok: false` 0.4 s in, before any browser process appeared" in
`docs/certification/m81.md`. No change in the train or in #169 is involved:
the browser-check code, its tests, the workflow's steps, the runner image
(`windows-2025-vs2026` 20261007.264.1), Node 22.23.3 and the pin are the same
in the passing and failing runs. The `routeUnconfirmed` of run 39069570760
(train 2026-10-17-2) is a different end: it did not reproduce in more than
250 local checks, and this record does not claim it.

## The fix

`holdToContract` now takes the service's id through `startedNetworkServiceId`
(`src/core/browser/browserRun.ts`): it asks `SystemInfo.getProcessInfo` again
every `BROWSER_NETWORK_SERVICE_POLL_MS` (50 ms) until the service is listed,
for at most `BROWSER_NETWORK_SERVICE_START_MS` (5 s), and its wait ends early
only when the browser's pipe closes. The contract is unchanged: an
out-of-process network service must exist, its id is still read before any
request and is still the restart tripwire the check compares at its end, and
a service still missing at the bound still ends the check `unrecognized`.
The bound comes from a measurement: over 90 launches of the production
command line under three-way contention, the service was listed within 25 ms
of the browser's first answer in all but one, which took 1,217 ms.

## Proof, on real Chrome through the real check

Each line is 120 checks of the product's `runBrowserCheck` with its host
deps, three batches of 40 at once on this Windows 11 PC, on Playwright's
`chrome-headless-shell` 153.0.8010.12, the pipe and the proxy tapped
passively (scripts and logs in the worktree's ignored `temp/bc169/`):

| Source                                                 | ok  | `unrecognized` | service read more than once  |
| ------------------------------------------------------ | --- | -------------- | ---------------------------- |
| before the fix (origin/main 296c63f20c)                | 115 | 5              | never (one read)             |
| deliberate break: `BROWSER_NETWORK_SERVICE_START_MS=0` | 116 | 4              | never (one read)             |
| the fix                                                | 120 | 0              | not counted in this run      |
| the fix, with the read counter                         | 120 | 0              | 3 checks (2, 2 and 11 reads) |

The break restores exactly the old single read; it was built from a
temporary edit, measured, and reverted before the fix was committed
(`1107cb834c`). Each of its four failures read the process list once and
saw only the browser. In the last run, three checks found no service at the
first read and passed after waiting for it: each of them was an
`unrecognized` end before the fix.

The hosted proof is the "Browser check" workflow on `windows-latest` (the
restart capture and the live suite on the pinned 154.0.8037.92); the pin is
not installed on this PC, so the live suite and R51 skip here, and nothing
local stands in for that run.

## Gates (2026-10-18, branch `fix/browser-check-route`)

| Gate                                                                                          | Exit                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `npm run format:check` (whole tree), pre-commit `prettier --write`                            | 0                                                |
| `eslint --max-warnings 0` (changed source), pre-commit `eslint --fix`                         | 0                                                |
| `npm run typecheck` (five projects)                                                           | 0                                                |
| `vitest run` runtimeManifest, browserLaunch, browserPolicy, browserCheckLive, browserCheckR51 | 0: 25 passed, 8 skipped (no pinned runtime here) |
| `npm run build` (sizes, split, host globals, notices)                                         | 0                                                |
| `npm run check:roadmap`, `npm run check:plan`                                                 | 0, 0                                             |

## Review round 1 (PR #222, two Codex threads): planned fixes

- **P1, `browserCheckConstants.ts:209`, a hard-coded 5 s startup cap.** The
  cap goes: no limit of ours but the providers' is hard-coded (AGENTS.md,
  "Limits"). The wait rests on the bound the check already has, its own
  lifetime (`createLifetime(timings.checkMs, [request.signal,
admissionSignal])`: the check's life from spec §4, the person's Stop, and
  admission), which closes the pipe when it ends; so a service that never
  starts ends the check `timedOut` or `cancelled`, never with a request made.
  `BROWSER_NETWORK_SERVICE_START_MS` is deleted; only the 50 ms re-ask
  interval stays, which stops nothing.
- **P2, `browserRun.ts:608`, targets read before the wait.** `Target.getTargets`
  moves after `startedNetworkServiceId`, so the exactly-one-`about:blank`
  test reads the browser as it stands when the contract is judged; a target
  that appears during the wait is then seen and refused `unrecognized`.
- **Proof.** The same 120 contended checks on real Chrome through the real
  `runBrowserCheck`, and the deliberate break (the single read restored),
  re-measured on the new head.

## Review round 1: built (`0b1782b067`)

Both planned fixes are in. How the lifetime ends the wait, in code that
already existed: when the check's lifetime ends before its own end, its
abort listener closes the pipe (`browserRun.ts:780`); a closed pipe wakes
`waitUntil` at once (`pageCheck.ts:610`) and rejects the next
`SystemInfo.getProcessInfo` (`cdpPipe.ts:189`); `runBrowserCheck` then
reports the lifetime's own end: `timedOut` at the deadline, `cancelled` on
Stop, `notOffered` or `scopeChanged` when admission ends. No request has
been made at that point: the gate, the proxy's first use and every canary
come after the contract read.

Re-measured on the round-1 source, same setup as above (120 checks, three
batches of 40 at once, the typecheck, the touched suites and the production
build running beside the fixed batch):

| Source                                              | ok  | `unrecognized` | service read more than once  |
| --------------------------------------------------- | --- | -------------- | ---------------------------- |
| round 1 (`0b1782b067`)                              | 120 | 0              | 4 checks, 2 reads each       |
| deliberate break on round 1: one read, then refusal | 117 | 3              | never (each failure: 1 read) |

The break replaced the re-ask with `return fail('unrecognized')`, which is
the old single read exactly; it was built from a temporary edit, measured,
and reverted before the commit. The four recovered checks also read their
targets after the wait and passed the exactly-one-`about:blank` test, so
the later read refuses nothing a passing start shows. A target that
appears during the wait was not provoked here: the wait lasts one 50 ms
re-ask in these runs, and the P2 fix is that the test now reads the browser
after the wait instead of before it.

| Gate (round 1)                                                                                | Exit                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `prettier --check` (changed files), pre-commit `prettier --write`                             | 0                                                |
| `eslint --max-warnings 0` (changed source), pre-commit `eslint --fix`                         | 0                                                |
| `npm run typecheck` (five projects)                                                           | 0                                                |
| `vitest run` runtimeManifest, browserLaunch, browserPolicy, browserCheckLive, browserCheckR51 | 0: 25 passed, 8 skipped (no pinned runtime here) |
| `npm run build` (sizes, split, host globals, notices)                                         | 0                                                |
| `npm run check:roadmap`, `npm run check:plan`                                                 | 0, 0                                             |

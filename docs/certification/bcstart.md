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

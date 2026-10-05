# TEST-DEFLAKE — three load-sensitive test families

Recorded 2026-10-04 in `mx-deflake`, branch `fix/test-deflake`, from
`e68326cc` (main). Scope: tests and their fixtures only. No product code,
timeout, retry, skip or sleep changed. No model calls, no dependencies. The
Model API host families follow the read-only INVHOST investigation
(scratchpad `codex/INVHOST.report.md`, evidence in `codex/invhost/`).

## Failures on hosted CI today

| Test                                | Run, job                                                        | Message                                                                       |
| ----------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| execRun D9                          | 37206923323, `build / quality (windows-latest)`                 | `expected { settled: 0, uncertain: 0, … }` to match `{ uncertain: 0.108135 }` |
| execRun D9                          | 37232319487 attempt 1, `build / tests (ubuntu-latest, shard 2)` | the same                                                                      |
| actionRunExec G18 escalates (POSIX) | 37218655233, `build / quality (macos-latest)`                   | `expected 130 to be 137`                                                      |
| actionRunExec G18 escalates (POSIX) | 37241136040 attempt 1, `build / tests (macos-latest, shard 2)`  | the same                                                                      |

The four Model API host families were reported by the RVDIET and RVM81F
reviews; INVHOST reproduced all six cases under controlled delay.

## 1. Model API host (`test/unit/modelApiHost.test.ts`)

Four families, six cases: the controlled fork (side chat false and true),
the finite-cap Auto reviewer, the held later capped host (first caps 0.1
and 0) and the two-host publication barrier.

- **Fork helper, a race in the test.** `completePaidChild` waited for any
  `turnCompleted`. `ModelApiHost.ts:4802` forwards a child's terminal event
  (`this.emit(event)`) as designed, so the helper could resume on the
  child's event while the parent still ran its own turn and durable
  settlement. `waitForChildReady` then gave that remaining work only
  `vi.waitFor`'s one second, and failed with `expected 'running' to be
'idle'`. The helper now awaits `session.settled()` (`ModelApiHost.ts:9269`:
  the session's tracked turns, then every child's) and asserts that the
  parent's own `turnCompleted`, by its submission's `turnId`, was emitted.
  All 19 callers of the helper get the same barrier.
- **Reviewer.** The test polled `reviewerBodies` and `commandsRun` under the
  one-second default before it awaited its existing `finished` promise,
  while admission, the review and settlement all write the real journal
  first. It now awaits `finished`, then asserts the same things.
- **Held later capped host.** The test polled for the first host's POST. It
  now awaits the fake's `onRequest` (fired once the request is recorded,
  before its hold), raced with that host's turn end, so a turn refused
  before sending fails the next assertion at once instead of at the test
  timeout.
- **Publication barrier.** The test polled `barrier.state()`. It now awaits
  `holdBothBudgetClaims`' `published` promise (resolved only once both real
  reservations return), raced with both turn ends, and asserts the same
  state.

## 2. G18 signals (`test/unit/actionRunExec.test.ts`)

**Root cause.** `test/action/fake-agent.mjs` reported its key line
(`report({ keyLine })`) before `hang()` installed its SIGINT and SIGTERM
handlers. The tests waited for any report line, then signalled. A signal
landing between the two met Node's default action: the child died by
SIGINT, and the wrapper correctly reported 128 + 2 = 130. The same race was
in "G18 forwards the exact signal" and in `hungScan` ("G18 a signal while
the scanner hangs").

**Fix.** `hang()` appends `{ ready: true }` to its report after the
handlers are installed. `isSignalReady(run, command)` reads it, and the
escalation test, the forwarding test and `hungScan` send their first signal
only after it. Every assertion is kept, including 137. The report file is
the fixture's channel to the test: exec's stdout is the JSONL protocol the
wrapper parses, and the review test asserts its stderr verbatim, so a
printed `READY` would change what is under test.

## 3. execRun D9 (`test/unit/execRun.test.ts`)

**Root cause.** The harness starts the lifecycle's 100 ms process-deadline
timer when the harness is created (`execLimits.ts:123`). On a loaded runner,
setup (backend load, readiness, ACP initialize, `session/new`) outlasted
100 ms, so the deadline latched before the request was reserved. Nothing was
in flight, the uncertain charge was 0, and the assertion failed with
exactly the CI message.

**Fix.** The test keeps the harness's default deadline. A new optional
`onEofHeld` on the fake's `ScriptedReply`
(`test/unit/helpers/fakeModelApi.ts`) fires once the body has handed out
every frame and `holdEof` starts holding its end. The test races it with
the run, then latches `{ kind: 'timeout' }` on the lifecycle: the call the
deadline timer itself makes (`execLimits.ts:123-125`), whose timer is covered
in `execLimits.test.ts`. The assertions are unchanged: exit 6, uncertain
0.108135 as an upper bound, the withheld final message. A new hook was
needed because the fake exposed no event for a held end of body;
`onRequest` fires before any frame, an earlier state than the one D9 tests.

## Rig runs

Each run used
`rig-test.sh <rig> <worktree> <slot> test/unit/modelApiHost.test.ts test/unit/actionRunExec.test.ts test/unit/execRun.test.ts --testTimeout=120000 --maxWorkers=1`,
all 642 tests of the three files, one Vitest process per run. The rigs were
shared with other lanes' runs (Kubuntu had an M87 drill running), so these
runs are not uncontended.

| Rig      | Slots                         | Result                           |
| -------- | ----------------------------- | -------------------------------- |
| Mac mini | `deflake-macmini-01` to `-07` | 7 passed, 0 failed, 642/642 each |
| Kubuntu  | `deflake-kubuntu-01` to `-07` | 7 passed, 0 failed, 642/642 each |

Runs 01 and 02 on each rig used `actionRunExec.test.ts` before Prettier
re-wrapped one line (blob `596efa1d`). Runs 03 to 07 used the committed
blobs, snapshot tree `602c95a4`: five passing runs per rig on the exact
test files committed.

Static checks on Kubuntu (`rig-run.sh`, slot `deflake-static`): `tsc` for
the unit and integration projects (the fake is shared with the integration
tests) and ESLint passed; Prettier flagged that one line, fixed before
run 03.

## Red drills

Two detached scratch worktrees: `drill-old` at `e68326cc`, `drill-new` at
`e68326cc` plus this change. One script applied the same delays to both;
their added lines were checked identical. The lane's worktree never held a
delay.

- **Model API host** (INVHOST's two probes, on disk): the native rename of
  the barrier's open claims, the held test's first open claim and the
  reviewer's seed delayed 1200 ms; the actual parent's first turn
  completion delayed 1200 ms through `afterTurnRuns`.
- **G18**: the fake installs its handlers 500 ms after its key line (exec
  and the scanner's hang mode).
- **D9**: `hostFor` (the host behind `session/new`) delayed 300 ms.

Each drill ran the families' tests with
`-t 'starts a controlled fork|admits a finite-cap reviewer|blocks a later capped host|admits no two-host overspend|G18|D9 held'`.

| Rig      | Old tests under the delays                                   | New tests under the same delays                   |
| -------- | ------------------------------------------------------------ | ------------------------------------------------- |
| Mac mini | exit 1: 10 failed, 14 passed (`deflake-drill-a-old-macmini`) | exit 0: 24 passed (`deflake-drill-a-new-macmini`) |
| Kubuntu  | exit 1: 10 failed, 14 passed (`deflake-drill-b-old-kubuntu`) | exit 0: 24 passed (`deflake-drill-b-new-kubuntu`) |

The ten old failures, on both rigs:

- both forks: `expected 'running' to be 'idle'`;
- the reviewer and both held-host cases: `expected [] to have a length of 1`;
- the barrier: `expected { plans: 2, claims: 0, … }`;
- G18 forwards: `expected [] to deeply equal [ 'SIGINT' ]`;
- G18 scanner: no SIGTERM report;
- G18 escalates: `timed out waiting` for its first SIGTERM report;
- D9: `expected { settled: 0, uncertain: 0, … }`, the CI message.

The first G18 escalation step signals SIGTERM, so the drill stops it there;
its CI form (130 from the second, SIGINT step) is the same default action
the forwarding test shows.

**Restoration.** `drill-old` was checked out clean and `drill-new` given
back the lane's files: SHA-256 identical to the lane's. Both were removed
with `git worktree remove`. The committed files' SHA-256:

```text
e31f1d5f66fc11331a480b215483fe7fde69df815e41a7d68f10633dc4f69c83  test/action/fake-agent.mjs
c321d14ae23651dcd45a11f44f47d81a56141dddea54c601ba5603bb26cd8b37  test/unit/actionRunExec.test.ts
a68fc23c28d8ffe808ea0d6b2e14fb5ddc71c27e21b277e6eb145b35876dd959  test/unit/execRun.test.ts
f50095212a80f92ec8c7d690934877e3d04b87a7e46bd84b356e0e73c02dae0a  test/unit/helpers/fakeModelApi.ts
8747b095a41c949baf6487c1ba999a3cec0806be2b3058f056cec3e2cfdf42c1  test/unit/modelApiHost.test.ts
```

## Product races

None found. The forwarded child terminal before `updateChild`
(`ModelApiHost.ts:4802-4803`) is the designed forwarding order; it is why
a test watcher must tell a child's terminal event from its parent's. The
G18 130 and the D9 zero were correct reports of what the tests made happen.

## Not covered here

The Windows rig did not run these files (G18's tests are POSIX-only). The
hosted CI on all three platforms remains the merge gate.

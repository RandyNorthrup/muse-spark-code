# Windows checkpoint-copy traversal test (DEFLAKE3)

Worktree: `C:/lanes/DEFLAKE3`, branch `fix/checkpoint-copies-flake`, from
`a95f24cf`. All commands run directly on the Win11 rig. No live/model calls,
network requests, dependencies, timeout changes, retries or skips are added.

## Reproduction and diagnosis

The brief identifies PR #116's failing count/cursor test but supplies no
assertion, timeout, stack or CI log. The original complete file passed
100/100 independent invocations. A second 100-invocation series passed with
a parallel loop of `htmlToMarkdown.test.ts`, `restoreChain.test.ts` and
`repoMap.test.ts`, using three workers and explicit file parallelism for
the load process (101 load invocations, 90 tests each, all passed). Both
checkpoint series use:

```powershell
npx.cmd vitest run test/unit/checkpointCopies.test.ts --maxWorkers=3 --testTimeout=120000
```

The CI workflow invokes Vitest without a timeout override. The installed
Vitest resolver defaults to 5,000 ms. The rig brief requires the
120,000 ms override above; its passes alone cannot exclude a CI timeout.
No exact hosted error is available, so this record does not claim that a
particular assertion, antivirus lock or directory-enumeration race was
observed.

Observed failure rate: **0/100 normal, 0/100 loaded**. No failing assertion
or error occurred in either series. The loaded count test took **348–1,561 ms**,
mean **507.4 ms**. The first normal series took **5m36.91s** and the loaded
series **5m40.89s**. A filesystem-latency timeout remains a plausible hosted
trigger, not an established diagnosis of the unavailable CI failure.

The count test creates 258 copies at the product's 256-entry budget: each
creation writes and backdates a file; deletion takes two identity samples
and a remove. It therefore couples a traversal property to more than
1,000 asynchronous filesystem operations. Its assertions only require
some progress, then eventual deletion over up to 258 extra passes. A
sweeper that closes and reopens its cursor between passes can satisfy
those assertions, so they do not establish the promised cursor reuse.

The product retains open `Dir` objects, counts awaited reads serially,
checks exact BigInt identity/mtime/size and revisits locked copies on a
later traversal. Its cursor does not depend on sorting, timestamp
continuity between passes or a reused temporary pathname. Fixture names
come from `mkdtemp`. No product change is justified by the observed runs.

## Test change and guard drills

The fixture uses a four-entry test budget, following the existing
retention suite's constant-mocking pattern. Six real copies still cross
the count bound with the clock frozen. Exact read counts, three remaining
copies after the first pass, the identity of every second-pass `Dir`,
completion in that second pass and `isScanning` establish the intended
contract directly. All other cases continue to use real filesystem
operations. The product's 256-entry and 50 ms limits remain unchanged.

Both deliberate production mutations fail the complete six-test file,
exit 1 with **1 failed / 5 passed**, at the named count/cursor test:

| Drill  | Break                                                           | Observed failure                                                                        |
| ------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Count  | Replace `visited < CHECKPOINT_COPY_SWEEP_MAX_FILES` with `true` | `expected "read" to be called 4 times, but got 9 times`                                 |
| Cursor | Call `await this.close()` at the start of every sweep           | `expected Dir{} to be Dir{} // Object.is equality`, at the second-pass cursor assertion |

Each mutation was restored in `finally`; original and restored production
SHA-256 both equal
`B472A9493C2F296738A004FE397B391F1BC746C8F6C9E1524E824375FF6C9859`.
The restored complete file passed **6/6**, exit 0.

As a comparison control, the original test file with the same deliberately
broken cursor restart passed **6/6**, exit 0. This deterministically proves
the original assertion gap. Both files were restored byte-exact: the
production hash above and the final test hash
`47F12CCDE8534CA0263D772618B225BAFFFEAD70AB0AC4B5F92502E31C0A194B`.
The final count case took **24–26 ms** in the initial green runs.

## Verification

All five TypeScript projects and scoped ESLint passed, exit 0, with no
suppression. Dead-code, duplication, localization, host API and production
build checks also passed, exit 0. All bundle caps, splits, host-global and
notice checks passed: extension **562.9/600 KiB**, Model API **428.0/475 KiB**,
checkpoint store **109.3/225 KiB**. No host API record changed.
The committed file (`417f57b3`, unchanged test hash above) passed **300/300
consecutive independent invocations**, **1,800/1,800 tests**, zero failures,
retries or skips, in **14m33.21s**. All 300 logs independently contain the
six-test pass summary. The first 100 invocations ran under the same parallel
CPU load; its 89 invocations also passed, 90 tests each. The final count
case took **25–80 ms**, mean **28.987 ms**, across all 300 runs, compared with
the original loaded **348–1,561 ms**, mean **507.4 ms**.

Before/after observed failure rates are **0/200 original-file runs** and
**0/300 strengthened-file runs**; this is improved fixture cost and proven
guard coverage, not statistical proof that the unobserved hosted flake is
eliminated. The complete `test/unit` inventory is the remaining lane
verification: 357 files, in 119 invocations of at most three files, with the
same rig worker/timeout flags and JSON reports. No new test filtering is
introduced.
Local raw logs are in ignored `scratchpad/deflake3/before-*.log` and
`temp/deflake3/`.

## Commit hooks and scope

The implementation and initial drill receipt are committed as `417f57b3`
with the normal Husky pre-commit hook enabled. The first attempt failed
before lint-staged because the rig's installed `npx` shell shim requires
Bash, which is absent. An ignored worktree-local POSIX `sh` launcher invokes
that same installed npm `npx-cli.js`, with unchanged arguments. Only the
commit process's PATH changes; no installed package, Git setting, user
setting or tracked hook changes. ESLint, Prettier and staged gitleaks all
passed through the unchanged hook on the successful attempt.

This lane changes `test/unit/checkpointCopies.test.ts`, `PLAN.md`,
`CHANGELOG.md` and this receipt. There is no new command, setting,
dependency, wire shape, translation or escape hatch. The rig forbids push,
merge and rebase. The brief requires full quality only for product changes;
aggregate coverage/full quality and the hosted Windows recheck remain the
lead's gates. The original hosted failure's exact trigger remains open.

## PR description draft

**Title:** Harden the Windows checkpoint-copy count and cursor test

The count/cursor test used 258 real copies and more than 1,000 asynchronous
filesystem operations, while its eventual-deletion loop could pass even
when the sweep discarded its cursor between passes. Use a four-entry
test-only budget and six real copies; assert the exact read count,
remaining-copy count and reuse of the same open `Dir` on the second pass.
Production sweep limits and safety checks remain unchanged.

The original file passed 100 normal and 100 CPU-loaded Windows runs.
Both count-bound and cursor-restart mutations fail the strengthened named
test and are restored byte-exact; the original test accepts the broken
cursor control. All 300 consecutive final-file runs and static/build checks
pass; the complete-unit receipt remains in progress. PR #116's exact hosted failure was
not supplied and has not reproduced, so its trigger is not claimed proved.

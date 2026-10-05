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

## Verification in progress

All five TypeScript projects and scoped ESLint passed, exit 0, with no
suppression. Dead-code, duplication, localization, host API and production
build checks also passed, exit 0. All bundle caps, splits, host-global and
notice checks passed: extension **562.9/600 KiB**, Model API **428.0/475 KiB**,
checkpoint store **109.3/225 KiB**. No host API record changed.
The 300 final-file invocations and complete unit inventory are the remaining
lane verification.
Local raw logs are in ignored `scratchpad/deflake3/before-*.log` and
`temp/deflake3/`.

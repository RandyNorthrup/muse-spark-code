# WINPUB — concurrent task publication on Windows

Windows 11 rig, C:/lanes/WINPUB, m96/ifix-win4, base 829ba9b3, 2026-10-05
local date. **Loaded performance remains blocked.** The change removes
incidental Git work and passes four complete native runs, but the latest
six-worker load proof passes only 18/30. This is a partial improvement and
handoff, not completion of WINPUB's performance requirement.

## Product change and scope

publishTaskRef has no application polling lock, fixed sleep/backoff, rename
retry or explicit fsync. The writers publish distinct refs. Adding a
repository lock would serialize them unnecessarily. Import still precedes
Git's atomic expected-old ref transaction.

The fetch now excludes automatic maintenance, commit-graph writing and
submodule recursion. Live-ref reads, isolated worker-head lookup, imported
object validation/durability and final CAS remain. Per writer, publication
has four direct Git calls; fetch descendants decrease five to four. The
commit/publication trace has 22 direct starts, descendants 10 to 8.

The real two-writer test preserves its staging barrier, concurrent commits
and imports, clone/ref/user-branch assertions, and additionally reads both
changed blobs from the destination store and checks import dispatch policy.
No dependency, setting, command, UI string, suppression or gate changes.
Shared core serves every editor; POSIX semantics remain, with Mac/Linux
execution delegated to the M96 integration lane. Existing I-path-race stays.

## Publication phases for both writers

Milliseconds, writer 1 / writer 2. Individual captures, not averages or a
causal speedup ratio. Idle means no scratch busy workers; unrelated host
activity is uncontrolled. Loaded captures use six workers on ten logical
cores. The old loaded case crosses its deadline while committing; pending
calls continue afterward. Descendant rows overlap parent calls.

| Phase                                               |     Before idle |      After idle | Before six workers | After six workers |
| --------------------------------------------------- | --------------: | --------------: | -----------------: | ----------------: |
| Destination live-ref Git read                       |     93.1 / 95.1 |   101.0 / 249.1 |    1415.3 / 1147.7 |     134.2 / 137.1 |
| Isolated worker-head Git read                       |     93.7 / 94.2 |   104.1 / 197.1 |     1234.4 / 599.4 |     144.9 / 144.4 |
| Complete fetch                                      | 1812.5 / 1810.7 |  1239.0 / 993.4 |    9576.1 / 9335.6 |     673.1 / 699.7 |
| Transfer region                                     | 1559.0 / 1550.6 |   575.5 / 568.4 |    8718.1 / 8695.5 |     405.4 / 420.1 |
| Packing child                                       |     93.5 / 93.4 |   164.0 / 138.5 |      220.2 / 218.4 |     121.0 / 157.1 |
| Unpacking child, including writes/flushes           | 1305.0 / 1304.9 |   227.0 / 242.8 |    7811.3 / 7791.1 |     122.8 / 108.8 |
| Connectivity-check region                           |     87.3 / 83.7 |    320.4 / 81.1 |      222.6 / 205.4 |     115.5 / 124.2 |
| Automatic-maintenance child                         |     71.1 / 76.8 | absent / absent |      236.4 / 220.6 |   absent / absent |
| Submodule region                                    |       1.0 / 0.9 | absent / absent |          1.1 / 1.0 |   absent / absent |
| Complete atomic update-ref                          |    96.0 / 104.5 |   402.9 / 227.6 |      322.0 / 276.9 |     149.3 / 149.1 |
| Ref-store/iterator boundary to prepared transaction |       3.1 / 2.6 |     308.2 / 4.1 |          4.1 / 4.1 |         3.6 / 4.7 |
| Prepared transaction to finished transaction        |       2.6 / 0.0 |       2.1 / 0.0 |          0.0 / 4.1 |         0.0 / 0.0 |
| Imported-object hardware-flush count                |           3 / 3 |           3 / 3 |              3 / 3 |             3 / 3 |

Lock acquisition is enclosed by preparation; replacement by preparation-to-
finish. Zero timestamp deltas are not zero syscall time. Git exposes neither
individual lock waits/sharing retries nor rename/fsync durations. Unpacking
time bounds its three flushes; it does not isolate them. No sharing-error
failure is observed, which does not prove Git never retried internally.
Application polling/backoff phases are absent. No native syscall timing claim.

Trace2/reference tracing targets only the two-writer path, with environment/
config-value capture disabled. The installed WPR FileIO profile also captures
machine-wide process/thread, loader and antimalware activity; Xperf's PID
options are documented for heap tracing. No broad native capture is started.
A publication-only native collector remains unfinished.

Receipts under ignored, rig-local temp/winpub: phase-summary.json,
paired-{before,after}-{idle,six}-spans.jsonl / trace.jsonl / trace.jsonl.refs,
paired-restore.json and case JSON. Complete diagnostic results are retained:
before idle 48/49; before six workers 45 passed / 3 failed / 1 hook-cascade
skipped (two writers 5.012 s); after idle 47/49; after six workers 49/49
(two writers 2.614 s). Diagnostic failures are not acceptance passes.

## Loaded executions and retained failure

The scratch runner expands the existing suite into 30 independent suites,
each with fresh real repositories, and runs every other original workspace
case once: 78 total. Six continuously busy threads, at most ten cores.
No test retries, name filters, timeout overrides or authored skips.
Expansion restores the test bytes SHA-256-exact.

The first run is 78/78, two writers 30/30: min 1.293 s, median 1.630 s,
max 2.680 s; command wall 88.447 s (loaded-six-_).
After verified Git selection, the repeat is **66 passed / 10 failed /
2 hook-cascade skipped**, two writers **18 passed / 10 timed out / 2 skipped**;
command wall 244.732 s, timeout durations 5.001–19.102 s, including delayed
timeout delivery (verified-loaded-six-_). **The loaded criterion is open.**
The earlier green and normal passes do not replace this later failure.

Full saturation also fails: after-heavy is 45/49, two writers 5.034 s;
configuration, staging and commit calls stall before publication. Completed
fetches are 3.252/3.250 s. Before-heavy is 49/49, two writers 3.933 s.
Before-load (eight workers) is 48/49, publication refusal 5.762 s, two writers
3.305 s. These captures establish neither a stable ratio nor a loaded bound.

## Deliberate drills and rejected trial

Remove each new import option separately: each complete 49-case file gives
48 passed / 1 failed at the dispatch assertion. Maintenance 1.088 s, graph
0.940 s, submodules 0.879 s. Every product restoration matches SHA-256 below.
Receipts: red-no-{auto-maintenance,write-commit-graph,recurse-submodules}.*,
guard-drills.json and guards-restore.json.

Restore the original fetch statement; omit only the new dispatch assertion
for this deliberate performance drill, retaining all original assertions and
the destination-blob check. Thirty independent cases with ten workers give
73/78 overall, two writers 25/30. Five timeouts: 5.084, 5.156, 5.017, 5.400,
5.081 s; command wall 179.103 s. Product/test restore byte-exact with hashes
(performance-restore.json, old-path-loaded-*). Load levels differ from the
six-worker green, so this is not matched-load improvement proof.

A saved-byte --keep trial switches unpack-objects to index-pack but retains
three hardware flushes per writer. Index-pack children 181.3/185.7 ms versus
the preceding loose-object capture's 122.8/108.8 ms. The fewer-flush criterion
fails; the option is restored, not shipped (pack-trial-six-*,
pack-trial-restore.json). No fsync setting or second object-store writer.
A broader transfer/durability strategy needs further interface/filesystem
contracts; none is guessed to hide the failed load proof.

## Complete native proof and executable selection

The first sequence passes 214/214, then stops with 119 passed / 29 failed /
50 hook-cascade skipped. Git resolution changed from the verified portable
install to C:/Program Files/Git/cmd. Failures include "BUG (fork bomb)"
against that tree's bin/git.exe and clone exit 3221225477. Portable Git still
reports 2.55.0.windows.5 and its expected exec-path. Scratch runners prepend
C:/Users/randy/gates/tools/git/cmd to their own process PATH only. No machine/
user setting, installation or Git config change. The invalid sequence remains
(final-proof-_); a fresh sequence passes 214/214 four times (verified-proof-_).

Lint rejects the new temporary iterator spread. Iterator helpers are not
declared by the existing library target; typed Array.from(iterator, mapper)
preserves order without suppressions/casts/library changes. Unit typecheck
and ESLint pass. The following fresh sequence uses these final test bytes.

Each iteration runs npx.cmd --no-install vitest run with teamWorkspaces,
teamMerge and teamRefFence, then teamReviewGate separately, --maxWorkers=3
and JSON receipt reporting. At most three files/command, default deadlines,
every original case once/iteration, no profiling or expansion.

| Final iteration | Main + review         | Main wall (s) | Two writers (s) |
| --------------- | --------------------- | ------------: | --------------: |
| 1               | 198 + 16 = 214 passed |        41.580 |           1.104 |
| 2               | 198 + 16 = 214 passed |        39.179 |           1.027 |
| 3               | 198 + 16 = 214 passed |        40.474 |           1.056 |
| 4               | 198 + 16 = 214 passed |        37.769 |           1.005 |

**856/856**, no failures/skips (final-source-proof-receipt.json and
final-source-proof-{1,2,3,4}{,-review}.json).
Product SHA-256: 3ffa868dd9b5f2843fb0d6c14429d1206e9f3cd71e8496a1741299becb0282c2.
Final test SHA-256: 641217aed5a1e911d2d42488e85e781e9670c06e80662f7c54af022d69a0cf45.
Earlier profile/drill/load test snapshot:
4e9437a0e16d2d3bddd675d81406e64ce899185c1552d8a4c61d26f5ac913a5e.

## Scoped gates and handoff

All five typechecks plus final unit recheck, changed-file ESLint/Prettier,
plain knip (two existing non-failing hints), duplication (944 files, zero
clones), localization (14 tables, zero problems), host API (296 APIs, zero
problems), production build/size/split/globals/notices (83 packages) pass.
Initial lint/type failures above are retained; no gate is weakened.
Receipts: gates.json, gate-*.log, final recheck tool results.

Sizes/budgets (KiB): extension 582.1/600, Model API 429.3/475, checkpoint
89.0/225, eager webview 877.3/900, ACP 804.2/850, What's New JSON 37.4/40.
README/help reference still applies: no command, setting or UI surface added.
Full quality/coverage, hosted checks and Mac/Linux remain the lead's gates
under common.md; full quality is not run here. Existing I-path-race stays.

No paid/live model call, external network request, push, merge, rebase,
direct stash, global install, Git config or machine/user setting change.
Commit uses existing hooks. The loaded blocker and isolated syscall timings
remain open; this partial improvement is not merge certification.

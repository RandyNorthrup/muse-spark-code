# M106 W — wiring, docs and gates (macmini, 2026-10-06)

The [integration record](m106.md) names merges, bindings and open evidence.
The inherited `node_modules` was immutable and still had SDK 1.3.0, with missing
main raster dependencies. An ignored isolated source snapshot at
`temp/m106-w/install` received `npm ci` from the exact merged lock: SDK 1.4.2,
902 packages, 11 existing advisories (2 low, 9 high). No dependency was added.
Tests without dependency-sensitive builds ran directly in the worktree; exact-lock
build/type checks and production-bundle suites used that private snapshot.
It has no hook override, dependency alias or preload shim. All final vitest runs
use the repository timeout and `--maxWorkers=3`, at most three files per run.

## Scoped evidence

Initial restored groups: wiring/client/notify **76 passed**;
exec run/arguments/schema **163 passed**; real build/reference/size/split
**75 passed**. History and controller behavior passed in the UI group; six App
assertions exposed newly asynchronous loading and now await the actual control.
The first compression round-trip failed because the generated text-key enum had
been omitted; retaining that enum fixed the real Node artifact.

Final verification and deliberate guard-fire receipts are appended below as
completed. Aggregate `npm run quality` / full tests are expressly delegated;
no whole-milestone green claim is made here.

## Integration findings from the first full scoped groups

The atomic `edit_file` declaration had lost T's optional top-level find/replace;
its existing named regression and the immutable golden fixtures caught this.
Restoring `required: ['path']` restores both the atomic API and prefix bytes.
Golden requests now pass without regenerating any golden fixture. The summary
fork's durable spend assertion now compares canonical USD; the existing partial
M95 panel/suggestion/codec money ports also move to `UsdAmount`, with historical
numeric panel records normalized once by the existing legacy boundary schema.

The generator's extra conditional clauses were accidentally supplied as unused
`Array.map` arguments. Emit an array containing the mapped status clauses and
those extra clauses; the deterministic shipped-schema check exposed the omission.
The optional tool bodies now load asynchronously; their row suite exercises its
first real body in shared `beforeAll` and awaits that body before cleanup.

**Original stopped path, as required by common.md's two-fix rule (resolved in
the continuation below):**
`modelApiHost.test.ts`, “a cut-short reply never runs any calls … refuses completed
and uncompleted calls and reports a failed turn”, still reports `completed` while
expecting `failed`. First tried passing an explicit false continuation setting in
the fixture; then corrected that fixture option and its forwarding through
`setup`. The second restored group (`retry-host-golden2.log`) still failed this
one test (728 passed, 1 failed). No skip, timeout or assertion weakening was
introduced. The lead must resolve the remaining host/session setting binding.
The separately owned loop-guarantee suite and all unchanged golden fixtures pass.

A second stopped test path is the first lazy Goal body assertion in
`toolRows.test.tsx`, “shows the goal, its status, progress, current and next work,
and the tokens”. Shared first-body setup reduced the original sixteen failures
to four; explicit awaits for the four first-use factories reduced these to one.
That remaining assertion reads “Say hello in one word” before the new await
(`retry-rows-reference.log`: 94 passed, 1 failed). The common two-fix stop applies;
the lead's first action is to await that first body control before asserting it.
The reference parser/reference-generation group passes, including the paired
`--output-schema-outside` flag and its required `--output-schema` path.

## Deliberate failures and exact restoration

Each mutation ran the full named test file with the default timeout in the
private copy; every restored guard matches the tracked file byte-for-byte.
The log filenames are `temp/m106-w/red-<drill>.log`. These are scoped proof,
not live-model receipts. The destination-presence/parent-exclusion mutation
removes all four new rows; the artifact-cap mutation removes all four new caps.

| Drill                                   | Guard file                                        | Named failing test                                                        | Restored SHA-256                                                   |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| strict-snapshot                         | `src/core/backends/modelapi/ModelApiHost.ts`      | snapshots strict off                                                      | `d28518bac345b06aeed63d286cc9d9497c46ae6270f1efb0f3bf84f9e67e4a55` |
| schema-model-ownership                  | `src/core/backends/modelapi/ModelApiHost.ts`      | refuses a changed model or repeated binding                               | `d28518bac345b06aeed63d286cc9d9497c46ae6270f1efb0f3bf84f9e67e4a55` |
| schema-single-binding                   | `src/core/backends/modelapi/ModelApiHost.ts`      | refuses a changed model or repeated binding                               | `d28518bac345b06aeed63d286cc9d9497c46ae6270f1efb0f3bf84f9e67e4a55` |
| unknown-schema-capability               | `src/core/backends/modelapi/modelCapabilities.ts` | leaves unknown models on the local validator                              | `7791e66610650408b1d40bf6ce25aa9276669dc99818c6839b354576a8e396c3` |
| output-digest-pair                      | `src/runtime/exec/execProtocol.ts`                | canonical result/event readers enforce output/digest                      | `1a6cef221efe3eb99847e0aace1a33a975f38040b2abda45f7767c6769618879` |
| schema-exit-ten                         | `src/runtime/exec/execProtocol.ts`                | canonical result/event readers enforce output/digest                      | `1a6cef221efe3eb99847e0aace1a33a975f38040b2abda45f7767c6769618879` |
| shared-pacing                           | `src/core/backends/modelapi/client.ts`            | shares admission across clients                                           | `deff7879fa5f0429873aef0022a3d29a32da86f9c247ce4c71e1fca091b10691` |
| service-observer-isolation              | `src/core/backends/modelapi/client.ts`            | retains the original final HTTP failure                                   | `deff7879fa5f0429873aef0022a3d29a32da86f9c247ce4c71e1fca091b10691` |
| new-artifact-caps                       | `scripts/check-bundle-size.mjs`                   | bounds the new dist/exec.js artifact                                      | `67dd48a840e0511c7f90c7c1a4bbda9279f3bd3d93506568a35a729af6fc3a3e` |
| new-chunk-presence-and-parent-exclusion | `scripts/lib/deferredBundles.mjs`                 | fires the modelApiCodeIntel split guard                                   | `8962394134e2b6e5a03c9292ac1d886dd9ea9cf1de9cc11d966f202f57619582` |
| reference-schema-marker                 | `scripts/lib/compressedReference.mjs`             | refuses a generated reference whose validation schema marker disappeared  | `ab4ba594019f207cb5fb99a7b2fd3f31d7c3111266012c02b8c12bbff2f854b7` |
| future-phase-persistence                | `src/core/backends/modelapi/sessionStore.ts`      | preserves captured message phase values and future words                  | `e88ba32e51c4705233dfa517a089776d2ee000a96bf67f731770c9d743066824` |
| hosted-search-bound                     | `src/host/settings.ts`                            | bounds hosted search to integral counts                                   | `26119941d53871a76018ac8e744808a27907590f70b1a80c76c4de720fa81573` |
| meta-notice-backend                     | `src/host/conversation/conversationController.ts` | shows a fixed Meta service-failure notice                                 | `2574a2b2c44ba74d29d50699032a1afb25f4c70db86ba8f78b5a033db233dd3f` |
| logger-observer-isolation               | `src/core/events/notify.ts`                       | delivers later observers and the safe diagnostic even if logging throws   | `f80d3ffb407c843738518407a0756aa339bc7680db83fccd681724df945817a7` |
| atomic-edit-declaration                 | `src/core/backends/modelapi/tools.ts`             | advertises schema-valid atomic edits                                      | `dd41ebe34f2dbb383d4f7b9fdfd03cee9ee7c64bfee421eef32620426b586f91` |
| shipped-schema-conditions               | `scripts/exec-schema.mjs`                         | A15 matches deterministic committed schemas                               | `553fc5537dbc863b1360dcac0c0a0cedf1aef3eb823633dce5952822658f7d97` |
| schema-replay-lifecycle                 | `src/core/backends/modelapi/ModelApiHost.ts`      | refuses schema binding while a turn is active and after its replay exists | `d28518bac345b06aeed63d286cc9d9497c46ae6270f1efb0f3bf84f9e67e4a55` |
| hosted-selected-model-capability        | `src/core/backends/modelapi/modelCapabilities.ts` | leaves unknown models on the local validator                              | `7791e66610650408b1d40bf6ce25aa9276669dc99818c6839b354576a8e396c3` |
| node-sdk-browser-probe                  | `scripts/build.mjs`                               | keeps standalone Node dist/exec.js free of browser navigator probes       | `c0a2522563d834c8a97bd6781b48259c29f27831097851fd360ba594c6d428f4` |

All **20** deliberate failures were observed; all restoration hashes matched.
Post-restoration groups (no filtering, at most three files, default timeout)
passed **1,003 tests**: 35 build/wiring/notify, 82 build/size/split, 61
settings/storage/schema, 731 tools/client/controller, 94 golden/loop/prefix.
The two stopped tests above remain; these counts do not include either as green.

## Production sizes and final gates

`npm run build` passes its complete size, split, host-globals and notice chain
on the exact-lock private copy (`build-final2.log`). Existing caps stay fixed.

| Artifact                    |   KiB | Cap / retained baseline, KiB |
| --------------------------- | ----: | ---------------------------: |
| extension                   | 474.8 |                          600 |
| Model API                   | 468.0 |                          475 |
| ACP                         | 822.3 |                          850 |
| browser startup closure     | 732.5 |   900; review baseline 733.8 |
| original deferred group     |  31.6 |     50; review baseline 32.1 |
| exec (standalone only)      | 820.9 |                          950 |
| Model API code intelligence |  69.7 |                          100 |
| MCP pool                    |  58.6 |                           75 |
| shared schema conversion    |  22.3 |                           50 |
| History row                 |   3.1 |                           25 |

New artifact caps use the first measured size plus 15%, rounded up to 25 KiB.
The restored Node build explicitly makes navigator unavailable for ACP/exec;
the first full build and the new named production-artifact test both caught
the SDK's browser probes before that fix. No globals-gate exception was added.

All five TypeScript projects pass (`typecheck-final.log`). Plain `knip` passes
with only existing informational configuration hints; the first private-copy
run found a stale, already deleted HistoryDeleteAction left by copy-only rsync.
Mirroring source trees with deletion removed that stale copy. jscpd reports
zero clones after sharing the schema-session test setup, with its threshold
unchanged. Localization reports 14 languages and 0 problems. The regenerated
host record reports 334 VS Code APIs, 35 VS Code-importing files, 25 Node
built-ins, 61 theme variables and 0 problems. Generated reference and exec
schemas match. Hooks retain their ordinary lint/format/gitleaks checks.

Offline ACP packaging succeeds (43 files), as does the separate unsigned,
fake-only package (44 files). No package was published or installed globally.
`node dist/acp.js exec --help` succeeds and includes the schema flags in its
reference. Paid/live commands were exercised only through existing fake unit
ports; no live call or credential-store access occurred. Aggregate quality,
coverage, accessibility, the hosted matrix and live qualification were not run
and remain the lead's gates.

After sharing the duplicated fixture setup, the final wiring/reference/notify
group passes 64 tests (`tests-commit-final.log`). Final guard hashes still match
all 20 restoration receipts. Scope covers W's integration repairs; the ordinary
full milestone suites remain with the lead. The two original stopped paths
are resolved in the continuation below.

## Lead-authorized stopped-path continuation

The continuation brief lifts the two-fix stop for exactly these two tests.
No extra branch was merged, and the original host expectation remains intact.

**Cut-short turn.** Merge `829469d4a` (`m106/l2`) replaced `streamAttempt`'s
M101 incomplete-tool `ModelApiError` with an `incompleteReason` return so the
new loop could continue. Its continuation-off path returned normally, leaving
the outer turn's terminal value at `completed`. The manager already forwards
`outputContinuation`, and the session already snapshots it; no public setting
binding was missing. Restoring the failure guard under that captured off arm
preserves the existing enabled continuation and refuses every call as before.
Two new regressions exercise the manager's normal and attempt factories,
toggle the source flag after session creation, and require a failed terminal,
one request, a failed tool row and no tool read.

**Goal row.** Its first objective assertion used `getByText` before the lazy
Goal body resolved. Awaiting that objective with `findByText` makes the remaining
assertions inspect the loaded body. The body renders the correct captured
content; no production UI change or fixed delay is needed.

Before the fixes, the full wiring/row files produced **34 passed, 3 failed**:
both new factory regressions reported `completed`, and the Goal objective was
missing. After the fixes, the full host/wiring/row group passed **700 tests**
with the repository timeout and `--maxWorkers=3` directly on macmini.

The inherited immutable install still has SDK 1.3.0 and lacks raster packages.
An isolated exact-lock install in `temp/m106-w/continuation-install` uses SDK
1.4.2 (902 packages; 11 existing advisories: 2 low, 9 high). No dependency,
lockfile, hook, cap or timeout changed. Final dependency-sensitive checks run
in that ignored source snapshot inside this worktree.

All four continuation red drills failed as expected with default timeouts,
and each mutated file was restored byte-exact (SHA-256 below). Logs are
`temp/m106-w/continuation-red-<drill>.log`.

| Drill              | File                                         | Failing cases                              | Restored SHA-256                                                   |
| ------------------ | -------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| off-terminal       | `src/core/backends/modelapi/ModelApiHost.ts` | Both normal/attempt continuation-off cases | `4d3d766e1187421f01b625dea5e802219527b244f5cd529b8076f022dd29c2cb` |
| manager-forwarding | `src/host/backend/modelApiBackendManager.ts` | Both normal/attempt continuation-off cases | `f95787907252f5aa56e4f5f43c1a871a5cafdf58c060bf1d5d6821c61e3497ae` |
| session-snapshot   | `src/core/backends/modelapi/ModelApiHost.ts` | Both normal/attempt continuation-off cases | `4d3d766e1187421f01b625dea5e802219527b244f5cd529b8076f022dd29c2cb` |
| goal-first-body    | `test/unit/toolRows.test.tsx`                | Goal first-body assertion                  | `e10901d4549fd67cbe81380413b56c5c398175db8ff322b896966c9707514bf4` |

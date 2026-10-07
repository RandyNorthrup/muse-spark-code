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

The explicitly required Transcript run exposed two more instances of the same
first-use timing problem: the Focus-view waiting question and the locked
answered/cancelled question both queried the radio synchronously. Their first
radio now uses `findByRole`; every folding/disabled assertion is unchanged.
The production lazy question card is unchanged. Initial App/Transcript/toolRows
verification had **247 passed, 2 failed**; after the awaits it has **249 passed**.
Reverting both awaits deliberately reproduces exactly those two failures
(**61 passed, 2 failed**), followed by byte-exact restoration:

| Drill                     | File                            | Failing cases                                  | Restored SHA-256                                                   |
| ------------------------- | ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| transcript-first-controls | `test/unit/Transcript.test.tsx` | Focus-view question and locked question radios | `fb82c058d485f4f0a320104c3aba057c1a0727ab30458ea04675158109c193c6` |

This brings the continuation to **five** observed failing drills, with all
restoration hashes still matching after the fix commit
`79908628b` and the final checks.

### Final scoped test matrix

Each command is `npx vitest run <files> --maxWorkers=3`, at most three files,
with the repository default timeout (no `--testTimeout` in any run). This is
the union of the prior scoped/final/restored M106 groups plus Transcript.
The final evidence for the UI row replaces the initial failed group; no failed
case is counted as passed until its complete file passed. No golden fixture was
regenerated or changed, and snapshot fixture bytes match the worktree.

| Full files (`test/unit/` prefix omitted)                                                   | Passed | Log                         |
| ------------------------------------------------------------------------------------------ | -----: | --------------------------- |
| `modelApiHost.test.ts`, `m106Wiring.test.ts`, `modelApiLoopGuarantees.test.ts`             |    711 | `continuation-final-01.log` |
| `modelApiGoldenRequests.test.ts`, `modelApiPrefix.test.ts`, `modelApiAutoCompact.test.ts`  |     93 | `continuation-final-02.log` |
| `App.test.tsx`, `Transcript.test.tsx`, `toolRows.test.tsx`                                 |    249 | `continuation-ui-final.log` |
| `HistoryDialog.test.tsx`, `bundleSize.test.mjs`, `conversationController.test.ts`          |    630 | `continuation-final-04.log` |
| `credentialEnvironment.test.ts`, `deferredBundles.test.ts`, `execOutput.test.ts`           |    161 | `continuation-final-05.log` |
| `execRun.test.ts`, `execSchema.test.ts`, `gitText.test.ts`                                 |    115 | `continuation-final-06.log` |
| `judgeSameModelApi.test.ts`, `m106Build.test.mjs`, `modelApiBackendManager.test.ts`        |     34 | `continuation-final-07.log` |
| `modelApiBundle.test.ts`, `modelApiClient.test.ts`, `modelApiCodeIntel.test.ts`            |    108 | `continuation-final-08.log` |
| `modelApiMcpServers.test.ts`, `modelApiSchemas.test.ts`, `modelApiTools.test.ts`           |     80 | `continuation-final-09.log` |
| `modelapiChatCodec.test.ts`, `modelsApp.test.tsx`, `modelsComponents.test.tsx`             |    108 | `continuation-final-10.log` |
| `modelsPanelSchemas.test.ts`, `modelsPanelSections.test.tsx`, `notify.test.ts`             |     33 | `continuation-final-11.log` |
| `paidAuthority.test.ts`, `paidHost.test.ts`, `paidMoneyPorts.test.ts`                      |     65 | `continuation-final-12.log` |
| `providersFlow.test.ts`, `providersL10n.test.ts`, `providersThreats.test.ts`               |    109 | `continuation-final-13.log` |
| `readFileBudget.test.ts`, `referenceGenerator.test.mjs`, `referenceKeyboardTruth.test.tsx` |     59 | `continuation-final-14.log` |
| `responsesCodec.test.ts`, `sessionBudget.test.ts`, `sessionStore.test.ts`                  |     97 | `continuation-final-15.log` |
| `settings.test.ts`, `structuredOutput.test.ts`, `supportReport.test.ts`                    |     43 | `continuation-final-16.log` |
| `webviewBundle.test.mjs`, `webviewBundles.test.mjs`                                        |     30 | `continuation-final-17.log` |

**Final total: 2,725 passed across 50 complete files; zero failures.**
All logs are under `temp/m106-w/`; checks ran directly on macmini in this
worktree or its exact-lock ignored snapshot. Source, tests and scripts were
verified byte-identical before the production build and full matrix.

### Continuation build and static gates

`npm run build` exits 0 through size, split, host-globals and bundled notices
(`continuation-build.log`, repeated as `continuation-build-final.log` after the
changelog update); no existing cap changed. The only production change is the
continuation-off guard; subsequent changes are test awaits and records.

| Artifact                    |   KiB | Cap, KiB |
| --------------------------- | ----: | -------: |
| extension                   | 474.8 |      600 |
| Model API                   | 468.1 |      475 |
| ACP                         | 822.3 |      850 |
| browser startup closure     | 732.5 |      900 |
| original deferred group     |  31.6 |       50 |
| exec                        | 820.9 |      950 |
| Model API code intelligence |  69.7 |      100 |
| MCP pool                    |  58.6 |       75 |
| shared schema conversion    |  22.3 |       50 |
| History row                 |   3.1 |       25 |

All five projects pass `npm run typecheck`; `typecheck:unit` was rerun after the
Transcript awaits and passes. Changed-file ESLint has zero warnings and Prettier
checks pass. Plain `knip` passes with the same two informational configuration
hints. jscpd analyzes **1,351 files, 457,568 lines** with **zero clones** and the
unchanged zero threshold. Localization reports **14 tables, 0 problems**;
reference generation is current; host API reports **334 APIs, 35 importing
files, 25 Node built-ins, 61 theme variables, 0 problems**. These logs all use
the `continuation-` prefix in `temp/m106-w/`.

Commits use explicit paths and the ordinary lint-staged/format/gitleaks hooks.
No push, rebase, merge, paid/live request or credential-store access occurred.
No rule, ignore, cap, dependency or timeout changed. The two stopped tests and
the two newly exposed Transcript awaits are closed. The inherited absent
capture/provider handoffs, aggregate quality/coverage/accessibility, hosted
matrix and live/M75/release receipts remain the lead's recorded qualification
work, as the brief requires.

## FIXM106W — RVM106W repairs (2026-10-06, macmini)

All four P2 and both P3 findings are fixed, with no accepted review residual.
No branch was merged, no dependency installed or changed, and no live/paid
model attempt was made. U10's existing captured contributor model supplies the
structured-format evidence; this repair adds no inferred provider wire shape.

| Finding                                | Root fix                                                                                                                                                                                                                                                                                                      | Regression                                                                                                                                                                          | Red drill                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| P2-1 compaction inherits `exec_answer` | Remove the session answer format before applying the summary's own contract, including its text fallback; keep the answer format for later ordinary turns.                                                                                                                                                    | `m106Wiring`: compaction after two HTTP 400 refusals, followed by another schema-bound answer                                                                                       | `compaction-exec-format`                                                                               |
| P2-2 search Once asks twice            | Keep memory-only window consent bound to provider, model/revision, exact tariff, revocation and price generation; still approve each fresh quote through the paid authority. Share the first popup; required asks and revocations retain their fences.                                                        | `paidHost`: distinct/concurrent quotes, new window, model, tariff, forced ask and revoked pending answer                                                                            | `search-window-once`, `search-popup-coalescing`                                                        |
| P2-3 Git draft handoff unbound         | Bind the conversation surface to its session's core draft port after session creation. Snapshot the contract for its user turn; repair/fallback through existing hooks, account/budget admission and Stop. Read the original reply before asynchronous MessageDisplay hooks can let its terminal overtake it. | `conversationController`: production factory/session valid, repair and fallback; one user turn and ordinary next-turn format; `m106Wiring`: changed model and cancelled preparation | `git-controller-port`, `git-original-event-before-display`, `git-model-fence`, `git-cancelled-prepare` |
| P2-4 Judge never receives formats      | Forward the selected session's captured format and codec in the connection and production Judge constructor. The normal metered transport still owns each reservation and settlement.                                                                                                                         | `judgeSharedBudget`: real session/client, consenting production factory and daily journal; contributor dispatch must name strict `judge_answer`                                     | `judge-connection-formats`, `judge-window-formats`                                                     |
| P3-5 hosted-search suite red           | Assert the returned fee plus known token cost after the throwing observer, rather than retained reservation. Update only H's stale atomic-edit declaration and its derived cache key; fix the fake clock at local midnight. Existing strict/off golden fixtures are unchanged.                                | Complete `modelApiHostedSearch` file: exact settlement and byte-exact bound-only request comparison                                                                                 | `hosted-settlement-expectation`, `hosted-atomic-fixture`                                               |
| P3-6 guides reject local references    | Document bounded local `$defs`/`$ref`, recursive object definitions and bounded answers; distinguish external references and reference-only cycles.                                                                                                                                                           | `m106Wiring`: positive compiler reference case and both guide assertions; existing complete `outputSchema` suite                                                                    | `output-schema-reference-docs`                                                                         |

The prior R4 race deliberately requests its Always popup with `requiresAsking`:
its three prior Once answers now cover this window, so an ordinary request
would correctly skip that popup. Its stale-save and cheaper-ceiling assertions
remain unchanged. No test is skipped, filtered or given a larger timeout.

The Git model/turn contract and its repair collector live in the portable core;
the existing shared conversation/webview bridge supplies the Git form binding.
Muse Code retains its existing text drafts. ACP/headless sessions use the same
core compaction isolation; the native editor's existing surface contract is
unchanged. Uncaptured provider formats and forced-tool codecs remain unavailable
until their existing M95 capture/binding work is completed.

### Observed red drills and exact restores

Each drill ran the complete named test file in the existing exact-lock private
snapshot at `temp/m106-w/continuation-install`, inside this worktree. The immutable
shared install still lacks `pngjs`/`jpeg-js`; the initial root typecheck reported
those missing modules. All five projects pass against the exact-lock snapshot.
No install or hook override was needed. Every final test uses repository timeouts,
`--maxWorkers=3`, and at most three files per command.

Logs are `temp/fixm106w/red-<drill>.log`. Each mutation caused the named regression
to fail; all twelve drills failed as intended and all files were restored to
the first-commit SHA-256 values below (`77ab6244c`). The final follow-up
restoration table below supersedes changed guard files:

| Drill                               | Mutated file                                      | Restored SHA-256                                                   |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `compaction-exec-format`            | `src/core/backends/modelapi/ModelApiHost.ts`      | `1393f2a694edfb2852b6e5e8d7a67b3ced53d705f06e1042c33533d2faff19ba` |
| `search-window-once`                | `src/core/paid/paidConsent.ts`                    | `2dbb6c5b20d93e1e23e3a22e08bdeaad15f8660a18b6c4f671210e20b39c4fa3` |
| `search-popup-coalescing`           | `src/core/paid/paidConsent.ts`                    | `2dbb6c5b20d93e1e23e3a22e08bdeaad15f8660a18b6c4f671210e20b39c4fa3` |
| `git-controller-port`               | `src/host/conversation/conversationController.ts` | `7d78ca4956db9cfb32db92f812dcaec35d192fd0978a3f0c7929f9b19fa8e60e` |
| `git-original-event-before-display` | `src/host/conversation/conversationController.ts` | `7d78ca4956db9cfb32db92f812dcaec35d192fd0978a3f0c7929f9b19fa8e60e` |
| `git-model-fence`                   | `src/core/backends/modelapi/ModelApiHost.ts`      | `1393f2a694edfb2852b6e5e8d7a67b3ced53d705f06e1042c33533d2faff19ba` |
| `git-cancelled-prepare`             | `src/core/backends/modelapi/ModelApiHost.ts`      | `1393f2a694edfb2852b6e5e8d7a67b3ced53d705f06e1042c33533d2faff19ba` |
| `judge-connection-formats`          | `src/core/backends/modelapi/ModelApiHost.ts`      | `1393f2a694edfb2852b6e5e8d7a67b3ced53d705f06e1042c33533d2faff19ba` |
| `judge-window-formats`              | `src/host/judge/judgeEntry.ts`                    | `24cef7f6cd7a3b747e6ebe1059b1487203fe3a27568eec412bc8822fed554876` |
| `hosted-settlement-expectation`     | `test/unit/modelApiHostedSearch.test.ts`          | `f8e9493810dcf4d3afd5e3c46c0a510457b16df8e9575642d72723fb8b0e32e5` |
| `hosted-atomic-fixture`             | `test/fixtures/m106/h-search-requests.json`       | `49c1f32a3a36d14741b5b38039f4910b372434269dc1738495596eb6e460abbd` |
| `output-schema-reference-docs`      | `docs/acp.md`                                     | `7f534d0e4040fb1378bae89590231f3ad7dd4f05922633246be27ec1ad3296dd` |
| `output-schema-reference-docs`      | `docs/ci.md`                                      | `3c84a8ec9b533523b3ce2c9f77e8d454325df1d7aef85f2d664c4ffc7b5a0638` |

Restored focused runs pass **55** wiring/consent/Judge tests and **732**
controller/Git/hosted-search tests. Typechecks, changed-file lint and formatting,
plain knip, zero-clone jscpd, localization, reference, host API, exec-schema
freshness, cycles and the production build are checked individually. The lane
brief forbids aggregate `npm run quality`; the lead retains that release gate,
coverage, accessibility, hosted matrices and live qualification.

The complete M106 and repository batch receipts appear below; the focused
counts above are separate runs, not an aggregate release claim.

### Own-submission and fallback follow-up

A prepared Git contract now travels through its own port submission rather
than a session-global pending slot. Another message may overtake autosave
without acquiring that contract. The port refuses an unprepared or repeated
submission; queued preparations also refuse a changed model or cancellation
before HTTP. Repairs retain their existing session/model/turn and Stop fences.
Judge removes a main turn's format before applying its own verdict contract,
so its text fallback cannot inherit `commit_draft`. Both schema guides now
state typed-array and validation-work limits accurately.

The full controller/wiring/Judge focused group passed **615 tests**. The
expanded wiring file then passed **14 tests**, including unprepared/repeated
submission and queued cancellation. The final complete M106 run below includes
all of those cases. All **18** distinct red drills fired named regressions;
each mutation was restored byte-exact and the hashes below match the final
unmodified guard files. Every drill ran a complete file with default timeouts,
three workers and no test-name filter. Logs are `temp/fixm106w/red-<drill>.log`.

| Drill                               | Restored file                                     | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `search-window-once`                | `src/core/paid/paidConsent.ts`                    | `2dbb6c5b20d93e1e23e3a22e08bdeaad15f8660a18b6c4f671210e20b39c4fa3` |
| `search-popup-coalescing`           | `src/core/paid/paidConsent.ts`                    | `2dbb6c5b20d93e1e23e3a22e08bdeaad15f8660a18b6c4f671210e20b39c4fa3` |
| `git-controller-port`               | `src/host/conversation/conversationController.ts` | `657c49315cf53fc5320be281a2b1759366cf56f36777b73855bda8ec353d445b` |
| `git-original-event-before-display` | `src/host/conversation/conversationController.ts` | `657c49315cf53fc5320be281a2b1759366cf56f36777b73855bda8ec353d445b` |
| `judge-own-fallback-schema`         | `src/host/judge/modelApiSameJudge.ts`             | `0107e37c020aafed233acb08da114dc305ffadcb74b718058e9c6caef612c93a` |
| `judge-window-formats`              | `src/host/judge/judgeEntry.ts`                    | `24cef7f6cd7a3b747e6ebe1059b1487203fe3a27568eec412bc8822fed554876` |
| `hosted-settlement-expectation`     | `test/unit/modelApiHostedSearch.test.ts`          | `f8e9493810dcf4d3afd5e3c46c0a510457b16df8e9575642d72723fb8b0e32e5` |
| `hosted-atomic-fixture`             | `test/fixtures/m106/h-search-requests.json`       | `49c1f32a3a36d14741b5b38039f4910b372434269dc1738495596eb6e460abbd` |
| `output-schema-reference-docs`      | `docs/acp.md`                                     | `ac4c271437d0ea16ac717018ee992836d58da11e4f4b3d48cc8ea12c37f76342` |
| `output-schema-reference-docs`      | `docs/ci.md`                                      | `3a4ea6ed2ea8c5f5b913491e315b5f6548e636d4b976f3de99ab017df79083bd` |
| `compaction-exec-format`            | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |
| `git-model-fence`                   | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |
| `git-cancelled-prepare`             | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |
| `git-one-turn-contract`             | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |
| `git-queued-model-fence`            | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |
| `git-queued-abort`                  | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |
| `git-preparation-required`          | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |
| `git-single-submission`             | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |
| `judge-connection-formats`          | `src/core/backends/modelapi/ModelApiHost.ts`      | `856f2a0f17d495cd0227212372f672cd4fc97a27867d4d45d3c2fcaa681fb18e` |

### Full-suite findings outside RVM106W

The first complete 590-file audit passed **12,987 tests**, failed **48 tests**,
and naturally skipped **88 tests**; one package suite also failed its setup.
Its original M106 priority set passed **2,951 tests** across **57 files**.
That audit froze the first repair plus the guide wording; the final own-turn
correction is verified separately in the final run below. Logs are
`temp/fixm106w/full-001.log` through `full-197.log`, with the exact named failures
in `full-results.json`. No timeout, skip, assertion or gate was weakened.

One failure was environmental: the nested exact-lock snapshot made
`git ls-tree ad916bbc src` return no baseline paths. The isolated complete
`modelsActivationBudget` rerun gives only its read-only Git comparison the
real `GIT_DIR` and snapshot `GIT_WORK_TREE`; no Git config, hook or source
changes. It passes **605,188 baseline bytes / 576,652 current bytes**
(**-28,536 bytes**, unchanged 3 KiB limit). The final batch run applies that
context only to this one complete file; all other tests retain their environment.

The remaining named findings are release blockers, not accepted release
qualification. They are outside the six reviewed repairs and this lane's
file scope. The evidence below limits the present safety claim; the lead must
complete each follow-up before calling the full gate green.

| Residual                           | Complete files                             | Observed failure and present safety                                                                                                                                                            | Follow-up                                                                                                                                      |
| ---------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIXM106W-FULL-PACKAGE-FIXTURES`   | execStdio.e2e / execTestLauncher.e2e       | Fake package stages omit newly required mcpPool/modelApiCodeIntel/structuredSchema chunks. Packaging fails closed before producing an incomplete package.                                      | Update the fake artifact inventories and rerun both complete files; retain all package rejection assertions.                                   |
| `FIXM106W-FULL-MUSE-NOTIFICATIONS` | MuseCodeHost / museCodeSdk142              | Observer assertions expect the old diagnostic or omit added lifecycle events. The observed remaining listeners and private completion paths still receive their events.                        | Assert the fixed safe notification labels and complete captured lifecycle sequence without reducing observer checks.                           |
| `FIXM106W-FULL-PALETTE-FAVOURITES` | Palette                                    | The provider grouping case cannot find its expected pinned-favourites group. This is a presentation failure; the run makes no paid dispatch.                                                   | Resolve the pinned group/view contract in the models lane and rerun the whole file.                                                            |
| `FIXM106W-FULL-LAZY-CARDS`         | WorkflowRun / store                        | Workflow body and crash-screen question assertions query before lazy bodies load. Shared App/Transcript/tool-row lazy tests pass; these additional files are not repaired in this scoped lane. | Await each actual first-use control, retain the existing content/reload assertions, and rerun both files.                                      |
| `FIXM106W-FULL-ACP-CAPABILITIES`   | acpAgent / acpModelApi                     | The SDK compaction availability expectation and three hosted-search fixtures lack the integrated capability/bound evidence. Search refuses the unverified finite spend cap before dispatch.    | Bind captured capabilities in the fake runtime, confirm compact advertising, and rerun both full ACP files without enabling unknown providers. |
| `FIXM106W-FULL-REPORT-FRAMES`      | flightRecorder                             | The production support frame vocabulary lacks the three new shipped chunk paths. Report diagnostics are incomplete; the scrubbers and shipped-package guard remain intact.                     | Add the exact packaged chunk paths to the existing frame table and prove its package-equality guard fires.                                     |
| `FIXM106W-FULL-CUT-SHORT-CODECS`   | modelApiCutShort                           | Five codec cases observe completed where they expect failed. Their preceding assertions confirm zero file writes; W's explicitly continuation-off normal/attempt tests pass.                   | Resolve the fixtures' captured continuation setting and terminal contract across all five codecs; retain no-write and replay checks.           |
| `FIXM106W-FULL-HOOK-SEARCH`        | modelApiExtensionHooks                     | The narrowed hosted-search case sends ordinary chat rather than refusing before HTTP. The observed request has no hosted search tool, so this case incurs no paid search.                      | Supply verified hosted capability/bound evidence in the fixture, then prove narrowing refuses before its hosted dispatch.                      |
| `FIXM106W-FULL-PRICE-DISPLAY`      | paletteRegistry / scheduledRunConfirmation | Exact-money formatting shows the same cached price as $0.0020 rather than the fixtures' $0.002. Price, consent and billing gates are unchanged.                                                | Align the asserted Intl/exact-money rendering while preserving selected-model rates and paid labels.                                           |
| `FIXM106W-FULL-RETRY-POLICY`       | providerRetry                              | Meta retry classification now admits a status that the older table expects to refuse. Existing request admission, retry limits and Stop still bound the transport.                             | Reconcile the documented/captured retry table and its complete status assertions in the pacing lane; do not broaden limits.                    |

# FIXCYCLES — Dependency-cycle root coverage

2026-10-08, Kubuntu; branch `fix/cycle-gate-coverage`, base `67099ce1b`.
Node 24.18.0, npm 12.0.1. No live or paid model calls; zero model attempts.

The fresh verification clone was `/var/tmp/l-FIXCYCLES/verify`, made from
this lane with `git clone --no-hardlinks`. It received the exact lane patch
and new guard, then `CI=true npm ci --no-audit` exited 0 (901 packages).
All checks ran sequentially with `CI=true`; all Vitest invocations used
`--maxWorkers=3`, at most three complete files, and repository timeouts.
The clone had its own dependencies and generated output and was removed
at completion. Receipts remain in `/var/tmp/l-FIXCYCLES/receipts/`.

## Root audit

The original 57 arguments remain. Append 95 missing root arguments:
68 source modules and 27 development entry arguments (including quoted
globs). There are now 152 arguments, expanding to 1,143 unique files.
Double quotes work under both POSIX shells and Windows npm's `cmd.exe`;
path comparisons in the guard normalize Windows separators to `/`.

| Audited source                                                                            | Unique entries |
| ----------------------------------------------------------------------------------------- | -------------: |
| Actual `entryPoints` declarations in `scripts/build.mjs`, including dev integration tests |             78 |
| Repository runtime lazy import targets                                                    |             73 |
| `*Entry.ts` and lowercase `entry.ts` source files                                         |             58 |
| Expanded knip entry list, including tests, scripts and Action files                       |          1,084 |
| Expanded dpdm root union                                                                  |          1,143 |

`test/unit/cyclesRoots.test.ts` reads the build's TypeScript AST without
executing the build, resolves entry arrays/object maps/constant references,
finds actual lazy import calls rather than type imports or generated-script
strings, and compares named modules and expanded knip entries against the
cycle roots. Unknown build-entry expressions fail explicitly. All four
checks failed with the base root list, before passing with the additions.

The appended root arguments, in the order in `package.json`:

```text
.vscode-test.mjs
action/apply/lib/*.mjs
action/lib/*.mjs
scripts/**/*.mjs
src/core/agent/agentReceiptFiles.ts
src/core/backends/modelapi/codeIntelEntry.ts
src/core/backends/modelapi/hookModelEntry.ts
src/core/backends/modelapi/mcpPoolEntry.ts
src/core/backends/modelapi/sse.ts
src/core/imageResizeWorker.ts
src/core/questions/deferralEntry.ts
src/core/resources/sampler/optionalProbes.ts
src/host/backend/searchWorker.ts
src/host/extensionHooksEntry.ts
src/host/support/recorderEntry.ts
src/host/support/reportEntry.ts
src/host/web/pageWorker.ts
src/runtime/chatGptProviderCommands.ts
src/runtime/exec/execEntry.ts
src/runtime/exec/providerExec.ts
src/runtime/providersCommands.ts
src/runtime/resources/entry.ts
src/runtime/usage/usageAcp.ts
src/shared/featureCatalog.ts
src/shared/l10n/en.ts
src/shared/legalScanEntry.ts
src/shared/reference/referenceEntry.ts
src/shared/reference/referenceSource.ts
src/shared/structuredSchemaEntry.ts
src/webview/TasksApp.tsx
src/webview/components/AgentMap.tsx
src/webview/components/AgentMapContent.tsx
src/webview/components/BestOfNDialog.tsx
src/webview/components/EffortSlider.tsx
src/webview/components/GitPanel.tsx
src/webview/components/GoalPanel.tsx
src/webview/components/GooeyMenuContent.tsx
src/webview/components/HandoffDialog.tsx
src/webview/components/HighlightedCode.tsx
src/webview/components/HistoryDialog.tsx
src/webview/components/HistoryPromptRow.tsx
src/webview/components/LegalReport.tsx
src/webview/components/PaidUsageSection.tsx
src/webview/components/Palette.tsx
src/webview/components/PlanUi.tsx
src/webview/components/PopoverMenu.tsx
src/webview/components/ProviderUsageSection.tsx
src/webview/components/QuestionUi.tsx
src/webview/components/ReferencePage.tsx
src/webview/components/ReportDialog.tsx
src/webview/components/ReviewCommentForm.tsx
src/webview/components/ReviewFindings.tsx
src/webview/components/ReviewPane.tsx
src/webview/components/SchedulePanel.tsx
src/webview/components/SecretPromptDialog.tsx
src/webview/components/ServiceStatusRow.tsx
src/webview/components/SessionBoardDialog.tsx
src/webview/components/SetupBanner.tsx
src/webview/components/ShareView.tsx
src/webview/components/SignIn.tsx
src/webview/components/TeamUi.tsx
src/webview/components/ToolArgumentPreview.tsx
src/webview/components/ToolBodies.tsx
src/webview/components/UsageDialog.tsx
src/webview/components/UsageDialogContent.tsx
src/webview/components/UsageProviderSections.tsx
src/webview/components/WorkflowRun.tsx
src/webview/models/panel.tsx
src/webview/prompts/PromptLibrary.tsx
src/webview/prompts/PromptLibraryBridge.tsx
src/webview/sharing/ChatShareBridge.tsx
src/webview/usage/UsageApp.tsx
test/action/*.mjs
test/action/exec-test-launcher.ts
test/e2e/**/*.test.ts
test/e2e/fake-muse/serve.mjs
test/e2e/webviewDiet.mjs
test/fixtures/never-ending-monitor.mjs
test/fixtures/workspace/code-intel/main.ts
test/harness/usage-accounts.mjs
test/harness/usage-check.mjs
test/harness/usage-companion.mjs
test/harness/usage-contrast.mjs
test/harness/usageHost.mjs
test/hosts/*.mjs
test/integration/**/*.test.ts
test/packaging/moduleExports.test.mjs
test/unit/**/*.test.{ts,tsx,mjs}
test/unit/helpers/fakeMcpBinary.mjs
test/unit/helpers/fakeMcpLauncherParent.mjs
test/unit/helpers/fakeMcpOrphan.mjs
test/unit/helpers/fakeMcpPrebindParent.mjs
test/unit/helpers/fakeMcpServer.mjs
test/unit/helpers/fakeMcpStartMarker.mjs
test/unit/helpers/fakeTeamAcpAgent.mjs
```

## Cycle and behaviour

One distinct cycle was found. The direct base probe
`npx dpdm --no-warning --no-tree --exit-code circular:1 -T src/core/team/workers/workerFence.ts`
exited 1 and reported
`workerFence → workerEnv → refFence → workerFence` (duplicate reports of
that same cycle came from the import/re-export edges). The full-root audit
of the unchanged worker code reported the same cycle, with exit 1.

Move the allowlist, blocked-name expression and `workerEnvironment` body
unchanged from `refFence.ts` into `workers/workerEnv.ts:14`, which now has
no imports. `refFence.ts:14` re-exports the same function for existing
callers; `scrubWorkerEnv` calls it locally. `workerFence` still imports
`scrubWorkerEnv`; its ref-fence verdict dependency is type-only. The public
API, credential scrub and Git admission behaviour remain unchanged.
No lazy-import workaround, dpdm ignore, dependency or escape hatch was added.
The full gate analyzes 2,182 modules and exits 0.

## Failure drills and restoration

| Drill                                                                          | Red result                                                                    | Restored result                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| Replace only `scripts.cycles` with the base's 57-root command                  | Four guard tests fail; Vitest exit 1                                          | Four pass in each of three final rounds; exit 0 |
| Add a runtime `workerFence` import to `workerEnv`, retaining a reference to it | Full `npm run cycles` exit 1; reports `workerFence → workerEnv → workerFence` | Full gate exit 0 after byte-exact restoration   |

SHA-256 before and after restoring `package.json`:
`f5399dbe283302cdde9538b0ef9337b125035710660d262883e828fbc8baf1f6`.
SHA-256 before and after restoring `workerEnv.ts`:
`756752065a5a50ac566dcfbf72592143154c1fa10a69be036210c959db14c854`.
The final formatted guard was also red-drilled in the fresh clone.

G65 was already taken. All local branch plans and gotchas registers were
checked for G66/G67: G66 is claimed on `rt-teamflake`, while G67 was free.
G67 now records root-list drift and its source-reading guard.

## Fresh-clone checks

| Check                                                                | Final exit |
| -------------------------------------------------------------------- | ---------: |
| `npm ci --no-audit`                                                  |          0 |
| `npm run cycles`                                                     |          0 |
| `npm run typecheck:host`                                             |          0 |
| `npm run typecheck:webview`                                          |          0 |
| `npm run typecheck:unit`                                             |          0 |
| `npm run typecheck:e2e`                                              |          0 |
| `npm run typecheck:integration`                                      |          0 |
| `npx eslint --max-warnings=0` on the three changed TypeScript files  |          0 |
| `npx prettier --check` on changed files                              |          0 |
| Plain `npx knip`                                                     |          0 |
| `npx jscpd` (zero clones)                                            |          0 |
| `npm run check:l10n` (zero problems)                                 |          0 |
| `npm run check:reference`                                            |          0 |
| `npm run check:host-api`                                             |          0 |
| `npm run build` including size, split, host-global and notices gates |          0 |

The first lint run rejected four guard-test style issues: callback references,
a shorthand void callback and the missing sort comparator. Fix those under
the existing rules; rerun unit typecheck, lint, formatting, knip, duplication,
the base-root drill and the full cycle gate on the final guard. Production
source and bundle inputs stayed unchanged during that test-only correction.

Measured production sizes: extension 509.5/600 KiB, Model API 488.7/525 KiB,
checkpoint store 78.5/225 KiB, browser deferred aggregate 32.1/50 KiB.
Every other existing size/split cap passed too; no cap changed.

Each batch below ran three times, unchanged, using
`CI=true npx vitest run <files> --maxWorkers=3` at repository deadlines.
The ten existing suites are unchanged; the coverage guard is the only new
suite. Every round passed 395 tests across 11 complete files: 1,185 passes
in total, with no failures or skips.

| Batch (all under `test/unit/`)                                                    | Tests per round | Round exits |
| --------------------------------------------------------------------------------- | --------------: | ----------- |
| `teamWorkerEnv.test.ts`, `teamRefFence.test.ts`, `teamWorkerFence.test.ts`        |             158 | 0 / 0 / 0   |
| `teamEngineWorker.test.ts`, `teamAcpWorker.test.ts`, `teamMuseCodeWorker.test.ts` |             128 | 0 / 0 / 0   |
| `teamAcpProcess.test.ts`, `teamWorkspaces.test.ts`, `teamGitClassifier.test.ts`   |             104 | 0 / 0 / 0   |
| `cyclesRoots.test.ts`, `teamWorkerCertification.test.ts`                          |               5 | 0 / 0 / 0   |

The rig/shared brief reserves aggregate `npm run quality` and hosted
cross-platform qualification for the lead (PLAN §7). This record certifies
the requested local checks; no merge, rebase or push was performed.

Commit policy: configured lint-staged and gitleaks hooks, followed by
post-hook staged/committed-diff review and comparison to the verified source
bytes (AGENTS rule 15).

## FIXCYCLES2 — RVFIXCYC P3 repair

2026-10-08, Kubuntu; branch `fix/cycle-gate-coverage2`, base `558a7abb7`.
Node 24.18.0, npm 12.0.1. Checks run directly in this worktree, sequentially;
no live or paid calls, zero model attempts. Receipts are in
`/var/tmp/l-FIXCYCLES2/receipts/`.

Move the build's `INTEGRATION_TEST_DIR` and unchanged `listIntegrationTests`
implementation into `scripts/lib/integrationTests.mjs`. The dev build imports
that function and the root guard calls the same function, without importing
the side-effecting build or maintaining another directory/filter/glob. Its
`.d.mts` declaration keeps the unit-test import typed without an escape hatch.

The new regression injects the shared function's returned list with
`test\integration-next\additional.spec.ts`. The guard must require the
normalized `test/integration-next/additional.spec.ts` root, report it missing
from today's cycle list, and drop the former integration entries. This proves
both changed directory/filter coverage and Windows separator normalization.
The spy is restored in `finally`.

Red drill: replace only the shared discovery call in the guard with the old
`expand(['test/integration/**/*.test.ts'])`. The complete five-test suite
exits 1: the new regression receives `[]` instead of the missing replacement
root; the four original checks still pass. Restore the guard byte-exact.
Before/restored SHA-256:
`42d92f40606d1578180107dd0047fbb5bd4dfbdf7d641fd2cf367bee2c44130f`.
Repeat the drill after the lint correction to certify the final source bytes.

The first lint run rejects the escaped Windows-path fixture under
`unicorn/prefer-string-raw`; use `String.raw` under the existing rule and rerun
lint successfully. No rule, timeout, ignore, cap or assertion changes.
On the final source, `npx vitest run test/unit/cyclesRoots.test.ts --maxWorkers=3`
passes all five tests in three separate runs at repository default timeouts:
15 passes, no failures or skips, exits 0 / 0 / 0.

| FIXCYCLES2 check                                                      | Final exit |
| --------------------------------------------------------------------- | ---------: |
| `npm run cycles` (2,182 modules, no cycles)                           |          0 |
| `npm run typecheck:unit`                                              |          0 |
| `npm run typecheck:host`                                              |          0 |
| `npm run typecheck:webview`                                           |          0 |
| `npm run typecheck:e2e`                                               |          0 |
| `npm run typecheck:integration`                                       |          0 |
| `npx eslint --max-warnings=0` on all changed code/declarations        |          0 |
| `npx prettier --check` on all changed files                           |          0 |
| Plain `npx knip`                                                      |          0 |
| `npx jscpd` (zero clones)                                             |          0 |
| `npm run check:l10n` (zero problems)                                  |          0 |
| `npm run check:host-api` (zero problems)                              |          0 |
| `npm run build` including size, split, host-global and notices checks |          0 |
| Complete `cyclesRoots.test.ts`, three runs, default timeouts          |  0 / 0 / 0 |

Production sizes remain extension 509.5/600 KiB, Model API 488.7/525 KiB,
checkpoint store 78.5/225 KiB and deferred webview JavaScript 32.1/50 KiB.

Aggregate quality, full coverage and hosted qualification remain with the
lead under the lane/shared rules. No merge, rebase, push, dependency install,
new user-facing feature or wire shape. Existing hooks run unchanged, followed
by staged/committed-diff review and comparison to the verified source bytes.

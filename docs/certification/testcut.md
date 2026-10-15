# TESTCUTFIN2 certification (lane TESTCUTFIN2, 2026-10-14)

## The owner's ruling (2026-10-14 ~4:05 PM PT)

"Why are build features being removed rather than wired properly?" Built
features are NEVER deleted to make a gate pass. The lead's earlier
instruction ("unused exports dropped/deleted") was wrong, and it is
withdrawn. This lane restores every deleted line of product code and makes
the dead-code gate pass honestly by declaring unfinished work, not by
deleting it.

## What was restored

Twelve commits reverted newest-first, one revert commit per commit, each
with hooks on and the lane trailer:

| Revert    | Reverts                                    | Effect (files, +/−)                                                   |
| --------- | ------------------------------------------ | --------------------------------------------------------------------- |
| 6b1bb182a | 3701da3f5 host-api record refresh          | 1 file, +8/−8                                                         |
| 2a6f33005 | 06123e95b lazy-registry regen              | 1 file, +1                                                            |
| ae3de3324 | b68f6e8b6 partial live-export restore      | 2 files, −18                                                          |
| a0c201749 | 7fbeceaf1 dead-export drops                | 16 files, +462/−12                                                    |
| 8069f5d40 | 800acf257 final orphan-export drops        | 2 files restored (playbookIntegration.ts, isolatedGitConfig.ts), +281 |
| 443d56210 | d91ae9ac4 accounts/backends/git/media cuts | 14 files, +576/−15                                                    |
| bd565e1a6 | ed418628b host/runtime PR/team/vault cuts  | 13 files, +3434/−9                                                    |
| 0f1e4f7b3 | 2671a7c0f reporting/vault/scheduler cuts   | 11 files, +1243/−4                                                    |
| c13006660 | 1df7960b8 estimator/paid/playbook cuts     | 9 files, +867/−7                                                      |
| d82817d60 | a8c378f1f team pool/workspace/slot cuts    | 4 files, +1474/−9                                                     |
| e0e5d1c6c | b3818ceb6 team-worker runtime cuts         | 6 files, +1411/−8 (museCodeWorker.ts back)                            |
| 4d04eb4af | 119b0cf1f scheduler/roles/merge cuts       | 6 files, +1843/−7                                                     |

Kept, not reverted: the overhaul's test deletions, knip entry declaration
c23a7d9b7, the rv/testcut-flake merge 6afd4ba35, and everything before them.

Restore proof (measured): `git diff --stat 6afd4ba35 HEAD -- src` is
empty — no product-code deletions remain. Endpoint diff 3701da3f5→HEAD:
71 files, +11388/−72 (src subset: 67 files, +11247/−53; the minus side is
lines the twelve commits had added themselves, removed by their reverts).

## Declaration per feature (knip `entry`, commit 6048c8e93)

Each group carries its milestone and "not wired yet". No product line was
deleted for the gate.

| Feature                                | Files                                                                                                                                                                                                                                                                                                   | Milestone      | Wiring still needed          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------- |
| Team host, workers, scheduler, traffic | core/team/{conflictPredict,roles,teamMerge,teamPool,teamWorkspaces}.ts, scheduler/{pick,retire}.ts, workers/{acpWorker,engineWorker,museCodeWorker,workerFence}.ts, modelapi/{subagentTools,tools (classifiedToolNames only)}.ts, runners/routing.ts, host/team/{checkSlots,mcpBridge,teamMcpServer}.ts | M96/M96c (D75) | team host spawn path         |
| Vault and broker                       | core/vault/{broker/channel,broker/peer,migrate/ambient}.ts, host/vault/{brokerClient,vaultPanelBundle}.ts, runtime/vault/execVault.ts                                                                                                                                                                   | M109 (D89)     | vault/broker service landing |
| Schedules v2 remainder                 | core/schedules/{migrate,reportAction}.ts, core/context/recordingReader.ts, host/backend/fileScheduleStore.ts, runtime/dataFolder.ts, webview/schedules/{ScheduleSurface,prompt}.tsx/ts                                                                                                                  | M115 (D95)     | schedules bundle entry       |
| Models panel + exec accounts           | shared/modelsPanel.ts, runtime/exec/execAccounts.ts                                                                                                                                                                                                                                                     | M95            | models panel mount           |
| Media remainder                        | core/media/{mediaCost,record/macos}.ts                                                                                                                                                                                                                                                                  | M105 (D85)     | media entries                |
| Resources remainder                    | core/resources/{disk,launch}.ts                                                                                                                                                                                                                                                                         | M107 (D87)     | governor wiring              |
| Estimator remainder                    | core/estimator/{baseRisk,calibration/fit,goal}.ts                                                                                                                                                                                                                                                       | M117 (D97)     | first-estimate load          |
| Eval task set                          | core/eval/tasks.ts                                                                                                                                                                                                                                                                                      | M75 (D49)      | evaluation runner            |
| Report sources                         | core/reporting/sources/{cache,github}.ts                                                                                                                                                                                                                                                                | M113 (D93)     | /report wiring               |
| Playbook remainder                     | core/orchestration/{panelPlaybook,playbook/modules,playbookReports}.ts, shared/playbook.ts                                                                                                                                                                                                              | M116           | VS Code panel integration    |
| Git sign-in + PR checkout/panel        | core/git/tokenSource.ts, host/git/gitExtension.ts, runtime/panel/pullRequests/{checkout,pullRequests}.ts                                                                                                                                                                                                | M71/M123       | editor wiring                |
| Paid consent                           | core/paid/paidConsent.ts                                                                                                                                                                                                                                                                                | M58            | consent wiring               |
| Accounts remainder                     | core/accounts/{policyGate,pool}.ts, core/providers/accounts.ts, musecode/accountHomes.ts                                                                                                                                                                                                                | M108 (D88)     | panel mount                  |
| Hooks + plugin host                    | modelapi/{extensionHooks,pluginHost}.ts                                                                                                                                                                                                                                                                 | M91/M91b       | bundle reads                 |
| Flight record                          | core/support/flightRecorder.ts                                                                                                                                                                                                                                                                          | M93 (D72)      | problem dialog               |
| Legal envelope                         | runtime/legal/runLegal.ts                                                                                                                                                                                                                                                                               | M97 (D76)      | /legal export                |
| Share preview                          | host/conversation/exportConversation.ts                                                                                                                                                                                                                                                                 | M84 (D49)      | panel wiring                 |

Earlier F6 block (vault 48, team 11, schedules 11, resources 7,
multi-account 10, media 10, estimator 4, theme 3, reports 2, devices 1,
cline 1, judge 2) stands unchanged.

## Removals (commit 2c8630095) — genuinely-dead class only

Every item below had zero remaining importers (knip project-wide plus
`grep -rn` over test/ src/ scripts/ action/); each was used only by a fake
suite the overhaul deleted (PASS 2a commit f2b00c094), verified by
`git grep <symbol> f2b00c094^ -- test/` naming the deleted consumers.

- `test/unit/helpers/isolatedGitConfig.ts` (whole file): consumers
  conversationController.test.ts, reviewMaterial.test.ts,
  helpers/reviewRoots.ts — all deleted.
- `memoryTree` (fakeContextIo.ts): consumers customAgents.test.ts,
  workspaceContext.test.ts — deleted. `memoryContextIo` stays (LIST suites).
- `fakeModelApiClientSettings` + `FAKE_MODEL_API_BASE_URL`
  (fakeModelApi.ts): consumers evalRunner, evalWorkspacePrivacy,
  judgeSharedBudget, legalExplanation, mediaClient, metaRequestGoldens,
  teamHostHarness tests — deleted. `fakeModelApi`/`FAKE_MODEL_API_KEY`
  stay (test/action/execTestTransport.ts).
- `memoryToolIo` + its `keyOf`, `fingerprint`/`SearchHit` imports and the
  `MemoryToolIo` interface (fakeToolIo.ts): consumers incl.
  conversationController, bestOfNAttempts, codeIntel suites — deleted.
  `refusedAtEntry`/`enteringShell`/`noopToolIo` stay.
- `RISK_QUESTION` (judgeUseRig.ts): consumer judgeUse.test.ts — deleted.
  `JUDGE_CARD_CHOICES` stays (judgeUi.test.tsx).
- `audit()` + `VaultAuditRecord` import (vault/fixtures.ts): consumers
  vault/audit.test.ts and sibling deleted vault suites.
  requester/metadata/use/ticket/grant stay (sshAgent/policy/useDigest).
- `WORKFLOW_STARTED/SCHEDULED/RUNNING/USAGE/CHILD_DONE/CHILD_ENDED/COMPLETED`
  - private `RUN`/`RESULT_REF`/`ENDED` (workflowFixtures.ts): consumer
    uiState.test.ts — deleted. IDs/SCRIPT/TOOL_ITEM/MESSAGE stay
    (WorkflowRun/workflowDetails tests).

No duplicate re-export or leftover alias needed removal: the
acpWorker/museCodeWorker/workerFence circular re-exports are the live
M96 runtime (per-file evidence in the F6 table), kept and declared.

## Red drill for the dead-code gate

Broke one declaration on purpose: replaced the
`src/core/paid/paidConsent.ts` entry with
`src/core/paid/RED-DRILL-BREAK.ts`. `npm run deadcode` exited 1:

```text
Unused exports (4)
askSchedulePaidConsent   function  src/core/paid/paidConsent.ts:107:23
createSchedulePaidScope  function  src/core/paid/paidConsent.ts:165:17
paidAccountQuestion      function  src/core/paid/paidConsent.ts:861:17
AccountPaidUseConsent    class     src/core/paid/paidConsent.ts:907:14
Configuration hints (4)
...
src/core/paid/RED-DRILL-BREAK.ts    knip.jsonc  Refine entry pattern (no matches)
```

Restored the line; sha256 of knip.jsonc identical before and after
(3284ecca59ec0670a02c1f37265872d477233f81a45934296f69a989ca883048),
worktree clean, `npm run deadcode` exits 0 (only the 3 standing
configuration hints: vendor/**, axe-core, mkfifo).

## Gates (final tree, exit codes)

- deadcode: 0 (hints only, above)
- typecheck (all 5 projects): 0
- eslint changed files: 0
- prettier changed files: 0
- check:l10n: 0 (0 problems)
- check:reference: 0
- check:plan: 0 (0 drift)
- check:host-api: 0 (0 problems)
- cycles: 0 (no circular deps, 2146 files)
- duplication: 0 (no duplicates)
- build --production: 0
- packaging: packagedBundles+teamRuntimePackage+vsixPackaging 104/104,
  acpPackageFixtures+integrationPackaging+runtimeChatGptPackage 7/7,
  usagePackaging 12/12 — all exit 0
- security:audit: 0 (2 advisories, 1 exception file)
- security:sast: scan clean — 533 rules over 3224 files, 0 findings
  (0 blocking), measured twice; the command itself exits 2 because
  semgrep's post-scan version banner writes /home/randy/.cache and the
  lane sandbox mounts home read-only (same traceback with
  XDG_CACHE_HOME redirected; scripts/sast.mjs offers no version-check
  flag). Environmental, not a finding.
- dependents of the trimmed helpers: judgeUi + WorkflowRun +
  workflowDetails 21/21, vault sshAgent + policy + useDigest 46/46 —
  all exit 0 (repo default timeouts); test/integration/extension.test.ts
  needs a real editor so it is covered by typecheck:integration (exit 0)
  instead; repo-wide grep confirms zero dangling references to any
  removed symbol

## One more restore: b74a496be (continuation run, 2026-10-14 ~5 PM PT)

`git revert --no-edit b74a496be` committed cleanly as bdf3751d6
(14 files, +101/−4). Each export the commit had removed was then judged
from `main`'s source (local `main` stands in for origin/main; this rig
has no remote). Reference point: `main` = 898a26c5e (release 0.18.2).

### True duplicates: re-removed (commit 23580f0c3)

Same name and same body live in a defining file the product imports
directly; no src or test file on this branch uses the re-export path.

| Export                                   | Removed from                                    | Live copy (file:line on main)                   | Product use of the live copy                                                                      |
| ---------------------------------------- | ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| AccountSwitchRefusedError                | src/acp/accounts.ts                             | src/acp/accountText.ts:11                       | src/runtime/providers/runtimeServices.ts:14                                                       |
| QuestionDeferralPort                     | src/core/agent/agentBackend.ts                  | src/shared/questions.ts:193                     | src/shared/questions.ts:198 (QuestionRegistryPort extends it)                                     |
| rateLimitHeaders                         | src/core/backends/modelapi/client.ts            | src/core/backends/modelapi/transport.ts:438     | transport.ts:1057, src/host/backend/modelApiEntry.ts:34                                           |
| BestOfNError                             | src/core/bestOfN/bestOfNRunner.ts               | src/core/bestOfN/bestOfNError.ts:23             | src/host/conversation/conversationController.ts:91, src/host/backend/modelApiBackendManager.ts:43 |
| storedMediaPartSchema (value; type kept) | src/core/media/replayMedia.ts                   | src/shared/media.ts:113                         | src/core/media/replayMedia.ts:245,264,282,312,407,499 via direct import                           |
| turnKey                                  | src/host/checkpoints/checkpointStore.ts         | src/core/checkpoints/turnKey.ts:4               | src/host/checkpoints/checkpointHost.ts:34, writeRecorder.ts, conversationCheckpoints.ts           |
| restartConversationBackends              | src/host/conversation/conversationController.ts | src/host/conversation/conversationBackends.ts:7 | src/extension.ts:216,1591                                                                         |
| parseProcessTable                        | src/host/processTree.ts                         | src/core/resources/trees/processTable.ts:16     | src/host/processTree.ts:217 via direct import                                                     |
| paidTallySchema                          | src/shared/paid.ts                              | src/shared/paidBoundary.ts:20                   | src/shared/paidBoundary.ts:144                                                                    |

### Planned, not yet called: kept with `@unwired <milestone>`

knip honours the tag through its `tags` option (`"-unwired"` in
knip.jsonc), so the dead-code gate still reports any untagged unused
export.

| Export                    | File                              | Evidence (no other copy on main)                                                                                   | Milestone                                   |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| AccountsPanelPort         | src/acp/accounts.ts               | only accounts.ts:42 (+ deleted test)                                                                               | M104 companion bridge for accounts          |
| companionAccountsPanel    | src/acp/accounts.ts               | only accounts.ts:46 (+ deleted test)                                                                               | M104 companion bridge for accounts          |
| buildProblemReportDraft   | src/core/support/problemReport.ts | only problemReport.ts:542; sole src mention is a comment (reportCommand.ts:29)                                     | M93 report-a-problem draft without vault    |
| TeamOrchestratorSlot      | src/core/team/teamPool.ts         | teamConfig.ts:62 is the same name with a different body (agent/settings vs resolve()); lead verified no other copy | M96 lane T orchestrator slot                |
| htmlToMarkdown            | src/core/web/htmlToMarkdown.ts    | unique; product uses convertHtmlJob (pageWorker.ts:10)                                                             | M69 web-fetch page conversion               |
| isWithinFolder            | src/host/checkpoints/shadowGit.ts | same name in core/paths.ts:14 but a different 3-arg body; no in-file use                                           | M72 shadow-repository storage guard         |
| runtimeGitUserEnvironment | src/runtime/gitUserEnvironment.ts | unique; sole src mention is a comment (runtimeGit.ts:76)                                                           | M71 confirmed-push and PR-fetch environment |

### Red drill (deadcode gate fires)

Removed the `@unwired` line from runtimeGitUserEnvironment.ts, ran
`npm run deadcode`: exit 1, `Unused exports (1)` naming
`runtimeGitUserEnvironment function
src/runtime/gitUserEnvironment.ts:36:17`. Restored the file byte-exact
(diff against backup empty); `npm run deadcode` exits 0 with zero
"Unused".

### Gates (final tree, exit codes)

- deadcode: 0 (3 standing configuration hints: vendor/**, axe-core, mkfifo)
- typecheck (all 5 projects): 0
- eslint changed files: 0
- prettier changed files + knip.jsonc: 0
- check:host-api: 0 (0 problems)
- check:reference: 0
- cycles: 0 (no circular deps, 2146 files)
- duplication: 0 (0 clones)
- build --production (`node scripts/build.mjs --production`): 0
- related suites (repo default timeout): runtimeAccountsService 11/11 + runtimeServices 17/17, exit 0

---

# PR 172 hosted-run repair (lane TESTCUTFIN2, 2026-10-15)

PR 172's first hosted run (CI 38658777663, Hosts 38658777612, Action
check 38658777764, Browser check 38658777580) failed 19 checks with
three causes. Base for every comparison below is local `main`
(898a26c5e, release 0.18.2); this rig has no remote, so `origin/main`
in the brief reads as `main`. Reference: the overhaul's per-file
verdicts (`chore/test-overhaul:docs/testing/test-overhaul-2026-10-12.json`,
TypeScript-parser + transitive-import classifier with a recorded
80-file hand check), cross-checked by this lane's own marker script
(`temp/classify.mjs`, kept uncommitted in `temp/`) and by reading
every file this record calls RESTORE plus samples of every DELETE
group. Method note: the overhaul's `vi.stubEnv(...) = GO` blanket
rule was over-broad (five of its stubEnv files stub test data, not a
platform), and its rule 4 ("no process test against a stand-in")
deleted real-product suites whose only stand-ins are the outside
world; both are corrected below. Its fake-code verdicts were confirmed
by sampling and stand.

Counts: the overhaul deleted 992 files under `test/`; this lane
restores 29 and keeps 963 deleted. No product (`src/`, `action/`,
`scripts/`) line changes except the stale `@unwired` tag (below).

## 1a. Workflow-referenced restores (19 files, commit b2f35827e)

Every `vitest run <path>` token in `.github/workflows/*.yml` plus the
live script references, verified by `temp/workflow-paths.mjs`
("all workflow vitest paths exist", 10 tokens across hosts.yml,
build.yml, action-check.yml, browser-check.yml):

| File                                   | Why it stays                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| test/e2e/acpStdio.e2e.test.ts          | Real installed agent as a child process, driven by the ACP SDK's own client; only the Muse Code CLI is faked (outside world)   |
| test/e2e/execStdio.e2e.test.ts         | Real built engine; fake fetch/keyring only through a test preload (outside world)                                              |
| test/e2e/execTestLauncher.e2e.test.ts  | Action check workflow runs it; real run-exec entry over the test package                                                       |
| test/unit/actionGate.test.ts           | Real gate over captured GitHub payloads with a stub API (GitHub is the outside world)                                          |
| test/unit/actionApply.test.ts          | Real apply/prepare/push against local bare origins with the fake agent binary (installed agent = outside world for the Action) |
| test/unit/actionGit.test.ts            | Real safeGit against armed fixture programs                                                                                    |
| test/unit/browserCheckLive.test.ts     | Real pinned browser runtime (browser-check workflow)                                                                           |
| test/unit/browserCheckR51.test.ts      | R51 control for the above                                                                                                      |
| test/unit/helpers/browserProcesses.ts  | Referenced by browser-check.yml; starts the real pinned runtime                                                                |
| test/unit/helpers/actionFixtures.ts    | Real fixture repos/owners used by the kept Action suites                                                                       |
| test/unit/helpers/actionModules.d.ts   | Type declarations the kept Action suites typecheck against                                                                     |
| test/unit/helpers/liveBrowser.ts       | Browser-check helper (loopback servers + real browser driver)                                                                  |
| test/unit/helpers/modelApiBundle.ts    | Builds the real Model API bundle for the stdio suites                                                                          |
| test/unit/helpers/github/deviceFlow.ts | REVERTED again (commit d95183034): only the deleted fake-infra e2e used it                                                     |
| test/e2e/acpFixture.ts                 | Shared fixture of the stdio suites (fake CLI install, credential file)                                                         |
| test/e2e/createdHelperFixture.ts       | Builds the real created helper for execStdio                                                                                   |
| test/e2e/fakeMuse.ts                   | The fake Muse Code CLI the stdio suites drive (outside world)                                                                  |
| test/e2e/fakeGitHub.ts                 | REVERTED again (commit d95183034): only the deleted fake-infra e2e used it                                                     |
| test/e2e/reportsEntry.ts               | Reporting entry the restored reports e2e bundles by path                                                                       |
| test/harness/reporting/verify.mjs      | Spawned by path in scripts/readme-shots.mjs while `scripts/readme-shots.json` still lists the deterministic-report shot        |

Two helpers the restores needed back: `memorySecrets` (in-memory
SecretStore, a stand-in for the OS credential store — the outside
world) re-added to `test/unit/helpers/fakes.ts`, and
`test/action/fake-agent.mjs` (imitates the installed agent's frozen
exec/scan-secrets protocol over a real child process; commit
c72ba3862). Proof it matters: actionApply was 1/6 without it
(`patchPublished` false — `preparedRun` could not start its agent
child), 6/6 with it; untouched main measured 6/6 in the same
conditions, so the product was never broken. `test/action/fake-npm.mjs`
stays deleted: only deleted install tests referenced it.

## 1b. Triage of the remaining deleted files

RESTORE — read in full on main, exercising real code with stand-ins
only for the outside world (commit 329e1bcd3):

| File                                                                                                                                                                | Evidence read                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| test/e2e/reports.e2e.test.ts                                                                                                                                        | Builds real `src/runtime/main.ts` + reporting entry, runs the binary as a child (imports only a timeout const)                                                                                       |
| test/e2e/schedulesStdio.e2e.test.ts                                                                                                                                 | Builds real runtime, spawns schedule CLI boundary cases as a child                                                                                                                                   |
| test/unit/actionInputs.test.ts                                                                                                                                      | Real `action/lib/{inputs,lifecycle,run-exec,tools}.mjs` + real `parseExec` over real temp dirs/repos; its `preparedRun` use is the outside-world fake agent                                          |
| test/unit/actionManifest.test.ts                                                                                                                                    | Strict-reads the real composite manifests, asserts pins/steps/conditions                                                                                                                             |
| test/unit/eval/evalTasks.test.ts (+ evalFixes.ts)                                                                                                                   | Real eval verifiers over fixture task dirs; `stubEnv` sets only test-data env                                                                                                                        |
| test/unit/hostL10n.test.ts                                                                                                                                          | Real `loadUiTable` on real temp tables; the local `fakeLog` is observer `vi.fn` sinks (allowed), D33 behavior a person depends on                                                                    |
| test/unit/reviewMaterial.test.ts (+ `helpers/isolatedGitConfig.ts`, `helpers/gitFilterNames.ts`, `aliasedReviewRepositories` back in kept `helpers/reviewRoots.ts`) | Real review collector over real git repos with hostile listings; `vi.fn` wraps the real runner as observer. Its 10 failures were the trimmed helper export, not the product: 47/47 after the restore |

DELETE — kept deleted, grouped by deciding evidence (overhaul
verdict + lane sample reads; one sample per group was opened and the
marker confirmed):

| Group (overhaul decider, files)                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Faked own-code module named                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vi.mock(...)` (146) — sampled `accountHost.test.ts` mocks `@muse-code/sdk`                                                                                                                                                                                                                                                                                                                                                                                                              | Banned by the owner rule with no exceptions (`vi.mock`, any target); e.g. the SDK driver, `src/` modules                                              |
| `helpers/fakes` + transitive (115+8+6)                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Editor surfaces, secret stores, budget config, providers (our host layer)                                                                             |
| `vi.useFakeTimers` (58) — sampled `acpVault.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                     | Fakes our async/clock boundaries                                                                                                                      |
| `vi.stubGlobal` (20) — sampled `browserCapture.test.ts` stubs `navigator/MediaStream/MediaRecorder`                                                                                                                                                                                                                                                                                                                                                                                      | Browser/editor globals                                                                                                                                |
| stand-in `mock*` without `spyOn` (~60) — sampled `companionLifecycle.test.ts` (`panel.handler.post.mockImplementation`)                                                                                                                                                                                                                                                                                                                                                                  | Our handlers/services given replacement behavior                                                                                                      |
| `vi.spyOn` with `mock*` (~40)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Same class, observed-then-replaced                                                                                                                    |
| `vscode` / `mocks/vscode` import (32) — e.g. `languageServices`, `chatSharingHost`, `providerKeyPrompt`, `runtimeConsent`, `webFetchConfirm`                                                                                                                                                                                                                                                                                                                                             | The editor API (explicitly banned)                                                                                                                    |
| `fakeToolIo` (30), `fakeContextIo` (10), `fakeMemoryIo` (4), `fakeSessionStore` (4), `fakePlanFiles`, `fakeFolders`, `fakeLanguageService`                                                                                                                                                                                                                                                                                                                                               | Our tool/context/session/store layer                                                                                                                  |
| `reporting/snapshot` via `fakeSourcePort` (28+) — collect._, render._, report* suites                                                                                                                                                                                                                                                                                                                                                                                                    | Our reporting source ports                                                                                                                            |
| `schedules/*` fakes (~30: `fakeSchedule`, `FakeScheduleClock`, `FakeScheduleApprovalStream`, `fakeRuntimeScheduleControl`, `MemoryScheduleFs`)                                                                                                                                                                                                                                                                                                                                           | Our schedule store/clock/approvals                                                                                                                    |
| `vault/*` fakes (~25: `FakeVaultClock`, `fakeScrub`)                                                                                                                                                                                                                                                                                                                                                                                                                                     | Our vault clock/exec scrubbing                                                                                                                        |
| `estimator/*` fakes (~20: `fakeDisclosures`, estimator `fakes.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                       | Our estimator disclosures/runs                                                                                                                        |
| `accounts/*`, `teamFakes`, `playbook/fakes`, `resources/fakes`, `usageAdapters`, `workerIdentity`, `mcpFixtures` (`FAKE_MCP_SERVER`), `fakeMsp`, `fakeGit` (VS Code git extension API), `github/fakes` (`fakeTokenSource`, `fakeRuntimeGitDeps`), `fakeModelApi`, `questions/*` (`FakeQuestionClock`, `FakeQuestionStore`, …)                                                                                                                                                            | Our accounts/team/playbook/resources/usage/MCP/MSP/git/GitHub/model-client/question services                                                          |
| `createServer`/`localhost` hand-answering servers (6), `chromium.launch`/`playwright-core` suites (8) — e.g. `estimator.e2e`, `fontsPack`, `panelMarkBrowser`                                                                                                                                                                                                                                                                                                                            | Hand-answering provider/local servers; new process/browser tests (owner rules)                                                                        |
| `accounts.e2e` ("Fake-only composition" header), `providersXFix` (hand-built `ProvidersDeps` with hand-answering fetch), `playbookOutcomes` (`FAKE_PLAYBOOK_MODULE`), `nativeGitService` (`fakeRuntimeGitDeps`), `questionFakes` (tests the dependency fakes themselves), `githubTokenSource` (`fakeTokenSource`), `m123Unreleased` (`fakeGit`), `pluginContainment` (`FAKE_MCP_SERVER`), `acpSchedules` (`fakeRuntimeScheduleControl`), `estimator.e2e` (browser + `FakeEstimateStart`) | Read in full on main; each fakes our own ports or tests the fakes                                                                                     |
| 8 PASS-4 gate mirrors (`genRoadmap`, `playbookBundles`, `reportingBundles`, `resourceHistoryBundle`, `teamActivationGraph`, `vsixBudget`, `webviewBundle`, `webviewBundles`) + `visualMatrix` (capture hash pins)                                                                                                                                                                                                                                                                        | Deleted by reviewed PASS 4 (`c3ddc0bab`): a pipeline gate enforces the same on real inputs; owner rule 3 (pins/mirrors go). Not relitigated here      |
| 102 STAY-but-orphaned support files + harness scenes/fixtures + `test/action/fake-npm.mjs`                                                                                                                                                                                                                                                                                                                                                                                               | No kept or restored test references them (import-resolution check over every restored file, transitive); `fake-npm` served only deleted install tests |

## 1c. Restored-suite results (repo default timeouts, no `--testTimeout`)

actionGate 17/17, actionGit 51/51, actionApply 6/6, actionInputs +
actionManifest + hostL10n 45/45, evalTasks + reviewMaterial 119/119
(47 reviewMaterial after the helper fix), execTestLauncher 6/6,
execStdio 46/46, acpStdio 13/13, reports + schedulesStdio 13/13,
checkCommands 10/10 + 2 Windows-only skipped (Linux rig),
cyclesRoots 4/4. execStdio's first attempt failed its packaging
`beforeAll` (14 pass / 32 skipped) and passed 46/46 on rerun ~7 min
later with no code change; rig load was 10.2 at the time — recorded
UNMEASURED, cause not isolated. browserCheckLive/R51 self-skip here
(`MUSE_TEST_BROWSER_STORAGE` names no installed runtime; the
browser-check workflow installs it) — NOT RUN here, for the hosted
workflow, not green by skip.

## 2. Cycle roots

`cyclesRoots > covers every knip entry` failed on all three systems:
164 knip entries (the TESTCUTFIN unwired-feature declaration) had no
cycle root. Commit 9d08238dc appends the exact 164 `src/` files;
commit af5b10357 adds the two string-loaded knip entries from this
lane (`test/e2e/reportsEntry.ts`, `test/harness/reporting/verify.mjs`).
`npm run cycles`: 2285 files, no circular dependency.

## 3. Windows 161 s (UNMEASURED — no code change)

`checkCommands > hands a native program each path as one argument`
took 161,603 ms on windows-latest shard 5 (job 116174782905).
Measured: the test file, `src/core/verify/checkCommands.ts` and the
quoting (`src/core/shellQuote.ts`, incl. the U+2018–U+201B doubling)
are byte-identical to main (`git diff main HEAD` empty), so main
behaves the same by construction. Whether main's CI shows it could
not be checked: `gh` has no auth on this rig (`gh auth login`
required) and the API refuses job logs without admin rights
(`403 "Must have admin rights to Repository"`, pasted). No Windows
runner exists on this rig to reproduce. Static analysis: every
hostile path is refused before execution, the win32 quoting is
balanced (covered by the passing quoting cases), stdin is ignored,
and `checkCommandLine` is pure string building — no deterministic
wait found in product or test code. The 161 s sits inside the test's
own unbounded `execFileSync(powershell …)`, which a sync-blocked
worker cannot interrupt (vitest's 15 s Windows timeout cannot fire
there). Shard durations from the public jobs API (measured,
unauthenticated): windows shards 1/2/3/4/6/7/8 took
187/236/232/203/195/189/203 s; shard 5 took 513 s — 2.2x the slowest
healthy sibling. The 161 s test explains only ~160 s of the ~280 s
excess, so the whole runner was degraded, not one test slow by
itself. Combined with byte-identical code, this points at a
runner-level stall — but that remains UNMEASURED, not a finding: no
timeout or retry was added (per the brief), no skip was added, and no
product wait exists to fix. For the lead: the CI log around job
116174782905 will show whether the sibling `.cmd` case (second
launch, warm) was fast, which decides cold-start stall vs. something
in the native launch.

## Gates (final tree, exit codes, measured without pipes)

- deadcode: 1 before the repair (restored suites orphaned 4 files +
  6 helper exports), 0 after (commits d95183034, ede3cf56f;
  hints-only: the 3 standing configuration hints)
- red drill for the repair: removing any restored consumer's helper
  re-lists it (observed live: `memorySecrets` removal failed eslint
  on the restored acpStdio; `aliasedReviewRepositories` removal
  failed 10 reviewMaterial cases; both restored byte-exact)
- typecheck (all 5 projects): 0
- eslint (all 71 changed lintable files): 0
- prettier (changed files + knip.jsonc + cycles.json): 0
- check:host-api: 0
- cycles: 0 (2285 files, no circular deps); cyclesRoots 4/4: 0
- duplication: 0
- build (`npm run build`): 0
- security:audit: 0
- dependents: `vitest related` over changed `src/` (shadowGit.ts,
  comment-only tag removal) selects only browserCheckLive (skipped
  here, above)
- NOT RUN here: browserCheckLive/R51 (no installed runtime; hosted
  workflow owns them), Windows-only checkCommands cases (Linux rig),
  `npm run security:sast` (semgrep not installed on this rig)

## Commits (this lane run, hooks on, trailer exact)

b2f35827e (workflow restores), c72ba3862 (fake-agent.mjs + apply
proof), 329e1bcd3 (real-code restores), d95183034 + ede3cf56f
(deadcode honesty), 9d08238dc + af5b10357 (cycle roots).
## RVTESTCUT2 — retain real calendar regressions (2026-10-14, Windows)

P2: deleting the mixed `test/unit/scheduleTime.test.ts` also deleted real
calendar behavior checks. Its fake clock supplied plain timestamps to
`nextTimeFire`; the time engine and Intl zone rules were real. The deleted
half-hour/whole-date case (old lines 242–258) had no fake at all. No surviving
unit test referenced `nextTimeFire`, `nextScheduleTime` or
`previewScheduleTimes` (`git grep` returned no matches). The legacy
`schedules.test.ts` covers M52, not the M115 stored-zone engine.

Restore a small pure-data suite at that path: nine cases over the real
modules, no clock, store, transport, spy replacement or helper stand-in.
Daily/weekly/cron gaps and folds cover Los Angeles, Berlin and Sydney;
Lord Howe and Apia cover half-hour changes and a skipped date; sparse cron,
preview/admission agreement, exclusive end times and run limits remain.
No product implementation, timeout, retry or skip changes.

Proof: `vitest run test/unit/scheduleTime.test.ts --maxWorkers=2` passed
9/9 at the repository defaults. Deliberately changing
`ZonedScheduleCalendar.resolve` from `Math.min(...exact)` to
`Math.max(...exact)` failed 4/9 (exit 1): all three ordinary fold cases and
the Lord Howe fold case; Los Angeles expected 1793521800000, received 1793525400000. Restored the product file byte-for-byte against HEAD,
SHA-256 `ffd7b0edfc5c7026e15aaf67e1dd6cd9110e002049d0611061a6030b0e18e70d`.
The restored run and scoped static checks are recorded in the review report.

## RVTESTCUT2 — retain real attention-dock regressions

P2: `attentionDock.test.tsx` was deleted because one case used fake timers
(old lines 287–321). Its other cases rendered the real `AttentionDock`,
`QuestionCard` and `QuestionSurface`, with observer callbacks and data.
The surviving `ApprovalDock` and `QuestionCard` suites do not exercise a
question group's shared draft across deferral or a session change.

Restore three small real-component cases at the deleted path: focused
late-answer draft retention, no focus theft on another question's arrival,
and clearing the draft at a session boundary while remaining modal-inert.
Only real imports and observer callbacks; no fake timer or host. No UI or
product change, so no new screenshot or browser run.

Proof: 3/3 pass at default deadlines. Deliberately retaining `drafts`
instead of clearing them in `QuestionSurface`'s session-change branch
fails the session-boundary case (exit 1): expected an empty field, received
`Old draft`. Restore byte-exact against HEAD; SHA-256
`8b45c83d225305bbf4b98539ed071b012105c7d0b67b4e8a87a0d783d04253b3`.
The final duplication gate caught eight repeated setup lines in these new
cases (exit 1); share that setup locally, preserve every assertion, and
re-run duplication: zero clones, exit 0.

## RVTESTCUT2 — retain real file-session persistence regressions

P2: the deleted `fileSessionStore.test.ts` mixed fake upload ledgers and
question stores with real filesystem cases (old lines 441–537). The
round-trip, header-only corrupt-replay listing, path confinement and
retention cases used the real file store and real files; replacing their
log sink and sleep seam with observers and the real timer removes the
unnecessary fake dependency. No surviving test imported
`createFileSessionStore` before this repair.

Restore four focused cases at the same path, with temporary directories,
real atomic writes, observer-only logs and no replacement filesystem,
provider, ledger or question store. Prove the retention boundary by
changing `idleMs <= days * MILLISECONDS_PER_DAY` to `<`: exit 1, 1/4
failed, expected the `recent` history header but received an empty list
(the session was deleted one boundary too early). Restore the product
file byte-for-byte against HEAD; SHA-256
`5b603a2f6baaade17441b220ba2f4b1a87e9b414167326619b295ebf0004d733`.
Initial real-code run: 4/4 passed at repository defaults.

## RVTESTCUT2 — remove the surviving account-command stand-in

P2: the trimmed `helpers/runtimeAccounts.ts` still exported
`commandAccountsRig`: `metadata.read/writeAccounts` used one local object,
and `openEntry` read/wrote a Map instead of the OS credential store. Its
only consumer, `accountsCommand.test.ts`, therefore still violated D108.

Rewrite that suite through the real parser and file metadata adapter:
23 cases retain argument/secret-route refusal, malformed-file rejection,
byte preservation and metadata round-trip. No credential store is opened,
no provider call runs. The former credential-operation composition cases
are removed rather than replaced with another fake; the lead's real-life
run must exercise add/order/threshold/remove and stdin credential flows.
Remove the now-orphan helper export and imports; keep no placeholder API.

Red drill: make the real metadata adapter silently return undefined for a
malformed stored row. The suite fails 1/23 (exit 1): expected rejection,
promise resolved undefined. Restore the adapter byte-exact; SHA-256
`964b0b4cd228d3e416cac86f5ad9f8176a3ad9b468433c6aec0e33290cc094fe`.
Initial and restored real-code runs are recorded in the review report.

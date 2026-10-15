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

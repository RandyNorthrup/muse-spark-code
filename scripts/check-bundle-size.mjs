#!/usr/bin/env node
// Bundle-size gate. The budgets below are the record (PLAN.md section 2, D6,
// mirrors them) and change only with a CHANGELOG entry. Exits 1 when any production artifact exceeds
// its budget or is missing.

import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  modelsDeferredBudgetGroups,
  webviewDeferredBudgetGroups,
  webviewPacingOutputs,
  webviewStartupOutputs,
  webviewPanelOutputs,
  webviewTeamPanelOutputs,
} from './lib/webviewBundles.mjs'

const BYTES_PER_KIB = 1024
// M99: bound the generated notes independently of their ZIP compression.
const WHATS_NEW_CONTENT_BUDGET_KIB = 40
// FIXM112U: independently measured question closure +15%, rounded to 25 KiB.
const QUESTION_UI_BUDGET_KIB = 25

/**
@type {ReadonlyArray<{ path: string; budgetKiB: number }>}
*/
const BUDGETS = [
  // M113 W: new entries, each measured +15%, rounded to 25 KiB.
  // MSM113 (estimate kind wired end to end): 220.4 KiB measured +15% =
  // 253.5 KiB, rounded to 250 KiB. The kind's source, collector, typed
  // refusal diagnostics and validated section schemas ride the reporting
  // bundle because the engine reads every source eagerly; no lighter
  // placement exists without engine surgery.
  { path: 'dist/reporting.js', budgetKiB: 250 },
  // MSM113 (estimate kind): 88.2 KiB measured +15% = 101.4 KiB, rounded
  // to 100 KiB. Same cause: the runtime sources barrel constructs every
  // local source, estimate included.
  { path: 'dist/reportingNetwork.js', budgetKiB: 100 },
  // C-M113-2: session and usage inputs, 84.1 KiB measured +15%, rounded up.
  // CC-GATES: back to the 100 KiB it had on f3941b8548 (RLM95 had raised
  // it to 116 KiB); it fits by weight now that constants.ts's unused
  // constants fold out of every bundle (scripts/lib/foldedConstants.mjs).
  { path: 'dist/reportInputs.js', budgetKiB: 100 },
  // C-M113-4: playbook and schedules inputs, 52090 bytes (50.9 KiB)
  // measured +15% = 58.5 KiB, rounded up to the next whole KiB.
  { path: 'dist/playbookSchedulesInputs.js', budgetKiB: 59 },
  { path: 'dist/reportingDestinations.js', budgetKiB: 75 },
  { path: 'dist/reportingPanel.js', budgetKiB: 50 },
  // M112 A: question forms, commands and late-answer admission, loaded on first use.
  { path: 'dist/acpQuestions.js', budgetKiB: 25 },
  // FIXM116I: /playbook's journal-backed surface (70.9 KiB when split out;
  // +15% rounded up to 100 KiB), loaded by the agent and the CLI on first use.
  { path: 'dist/acpPlaybook.js', budgetKiB: 100 },
  // M116 lane C-M116-6: the VS Code window's playbook (the window's client
  // and, as its worker thread, the governor: policy, journal, outcomes and
  // the Windows job runner), loaded on the first playbook request: 111.5 KiB
  // measured, +15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/playbook.js', budgetKiB: 150 },
  // RLSCHED: /watchdog's issue surface (63.8 KiB when split out; +15%
  // rounded up to 75 KiB), loaded by the agent and the CLI on first use.
  { path: 'dist/acpWatchdog.js', budgetKiB: 75 },
  // Exact media money no longer enters the registry through locale helpers.
  // Keep M112's original cap; M105's inherited temporary increase is removed.
  { path: 'dist/runtimeQuestions.js', budgetKiB: 25 },
  { path: 'dist/questionNotes.js', budgetKiB: 25 },
  // PR251FIX3B: the Muse Code approval-mode effect and reviewer-profile sync,
  // off activation; measured 22.88 KiB when split out, +15% rounded up to 27 KiB (PLAN.md D6).
  { path: 'dist/approvalModes.js', budgetKiB: 27 },
  // M103R: 107.0 KiB + 15%, rounded to 25 KiB. RLM103: 125.4 KiB measured
  // on 0.19.0; capped at measured.
  { path: 'dist/runtimeMaker.js', budgetKiB: 126 },
  // PORTM103: shared first-use maker schemas; 12.6 KiB plus 15%, rounded to 25 KiB.
  { path: 'dist/makerContracts.js', budgetKiB: 25 },
  { path: 'dist/extension.js', budgetKiB: 600 },
  // M100: measured 74.8 KiB + 15%, rounded to the next 25 KiB (D6). Re-measured
  // with the Windows storage binding (P-I-WINDOWS-STORAGE, its C# shipped
  // outside the bundle): 100.4 KiB x 1.15 = 115.4, rounded up to 125 (D6).
  { path: 'dist/devices.js', budgetKiB: 125 },
  // RLF-DEVICES: the maker executors and their simulators, out of
  // dist/devices.js on the first maker execution; measured 34.0 KiB
  // (34,851 bytes), +15%, rounded to the next 25 KiB (D6).
  { path: 'dist/maker.js', budgetKiB: 50 },
  // M107: 89.5 / 1.8 KiB measured; +15%, rounded up to 25 KiB.
  { path: 'dist/resourceGovernor.js', budgetKiB: 125 },
  // RLF-BUDGETS: the Windows job-object tree reader, off the governor.
  // 11,007 bytes (10.7 KiB) measured +15% = 12.4 KiB, rounded up to 13 KiB.
  { path: 'dist/resourceGovernorWindows.js', budgetKiB: 13 },
  // POSTSPAWN: the governed launcher, split from the governor; 35.6 KiB
  // measured, +15%, rounded up to 25 KiB. The governor's cap is unchanged.
  { path: 'dist/resourceProcess.js', budgetKiB: 50 },
  // POSTSPAWN: the vault MCP launch, off activation; 13.4 KiB measured,
  // +15%, rounded up to 25 KiB.
  { path: 'dist/mcpVault.js', budgetKiB: 25 },
  // POSTSPAWN (C-M106-3R2): the 1.4.4 effort catalogue reader, off
  // activation; ~1 KiB measured, rounded up to 25 KiB like its neighbours.
  { path: 'dist/modelEfforts.js', budgetKiB: 25 },
  // M108 lane P: another account's paid consent and its store, off activation
  // and the ACP engine; 41.6 KiB measured, +15%, rounded up to 25 KiB.
  { path: 'dist/accountPaid.js', budgetKiB: 50 },
  { path: 'dist/resourceAdmission.js', budgetKiB: 25 },
  // INT0170: M107 W2's journal, shared by the governor and the usage service;
  // 41.1 KiB measured, +15%, rounded up to 25 KiB.
  { path: 'dist/resourceJournal.js', budgetKiB: 50 },
  // Resource controls/history closures (including their deferred parser and CSS) have 50 KiB caps below.
  { path: 'dist/webview/resourceSurface.js', budgetKiB: 25 },
  { path: 'dist/webview/resourceHistory.js', budgetKiB: 25 },
  { path: 'dist/webview/resourceHistory.css', budgetKiB: 25 },
  // Versioned exec event schema: 37.5 KiB +15%, rounded to 25 KiB.
  { path: 'docs/schemas/exec-event-v2.schema.json', budgetKiB: 50 },
  // ACTDIET: first chat surface; 216.0 KiB + 15%, rounded to 25 KiB.
  // JOIN0190 features merge: 258.2 KiB measured (estimate diagnostics,
  // conversation controller), +15%, rounded up to 25 KiB.
  { path: 'dist/conversation.js', budgetKiB: 300 },
  // CONVBUDGET: the conversation's session-transfer flows (export, import
  // and the share-file preview), required on the first of those flows.
  // 23,804 B when split out (23.2 KiB); plus 15%, rounded up to 25 KiB
  // (PLAN.md D6).
  { path: 'dist/conversationTransfer.js', budgetKiB: 50 },
  // M94: provider, engine and ledger on first Tab use (PLAN.md D6).
  { path: 'dist/tab.js', budgetKiB: 75 },
  // M103A3: editor verification and JSON fallback, deferred until first use.
  { path: 'dist/verifyEditor.js', budgetKiB: 25 },
  // M103 V: native maker host UI and wrappers, loaded only on first use.
  { path: 'dist/makerHost.js', budgetKiB: 25 },
  { path: 'dist/makerPreviewHost.js', budgetKiB: 25 },
  { path: 'dist/webview/makerPreview.js', budgetKiB: 25 },
  // M118: portable stores, native/panel adapters and chat renderer: 163.4 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/prompts.js', budgetKiB: 200 },
  // M118: local CLI/ACP stores, renderer and destinations: 152.1 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/sharingRuntime.js', budgetKiB: 175 },
  // M124 (D106): the MCP connector, loaded only by `mcp`: 85.8 KiB measured + 15%, rounded to 25 KiB.
  // TRAINFIX: train growth (M124 merge + main PROVERRORS) measures 100.0 KiB; +15%, rounded to 25 KiB.
  { path: 'dist/connector.js', budgetKiB: 125 },
  // RLM124 (finding 15): the connector's storage guard, 15565 bytes
  // (15.2 KiB) measured +15% = 17.5 KiB, rounded up to the next whole KiB.
  { path: 'dist/connectorStoreGuard.js', budgetKiB: 18 },
  // REL0160B combined Model API: 479.2 KiB measured +5%, rounded to 25 KiB;
  // authorized rebuild brief and measurement recorded in PLAN.md (2026-10-07).
  { path: 'dist/modelApi.js', budgetKiB: 525 },
  // PR206: the Muse Code backend's own bundle (the host, its notification
  // mapping and the SDK), loaded on the first backend start: 97.6 KiB when
  // split out, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/museCode.js', budgetKiB: 125 },
  { path: 'dist/exec.js', budgetKiB: 950 },
  // RLTESTDRIVE item 5: the live list read for headless refresh on use:
  // 13.4 KiB measured +15%, rounded up to 25 KiB.
  { path: 'dist/providerList.js', budgetKiB: 25 },
  { path: 'dist/modelApiCodeIntel.js', budgetKiB: 100 },
  { path: 'dist/mcpPool.js', budgetKiB: 75 },
  { path: 'dist/structuredSchema.js', budgetKiB: 50 },
  // M95 integration: measured 93.0, 50.1 and 404.7 KiB respectively.
  // TRAIN15E new lazy entries: 28.3, 49.0 and 26.0 KiB measured; +15%,
  // rounded up to 25 KiB. Existing Model API cap stays fixed.
  { path: 'dist/modelApiHooks.js', budgetKiB: 50 },
  { path: 'dist/modelApiMcp.js', budgetKiB: 75 },
  // M105 W production media (replay, estimator, seeds, codec, upload ledger,
  // session uploads): 66.2 KiB measured +15%, rounded up to 25 KiB. It
  // returned dist/modelApi.js under its unchanged 525 KiB cap.
  { path: 'dist/productionMedia.js', budgetKiB: 100 },
  // M105 lane V seam 3B: transcription and the trusted converter, loaded on
  // the first turn that carries attached sound: 58.4 KiB measured +15%,
  // rounded up to 25 KiB.
  { path: 'dist/productionAudio.js', budgetKiB: 75 },
  // M105 lane V seam 5: the runtime's ACP and exec media port, loaded on the
  // first media prompt: 52.5 KiB measured +15%, rounded up to 25 KiB.
  { path: 'dist/runtimeMedia.js', budgetKiB: 75 },
  // ACPDOG round 4: the settled-cost tally, translated refusal wording and
  // alias-glob fallback, loaded with the Model API backend; 19.7 KiB
  // measured + 15%, rounded up to 25 KiB (D6).
  { path: 'dist/modelApiAcp.js', budgetKiB: 25 },
  // RLM103 join (CC-INT6): the shell reader and command rules the permission
  // engine judges every shell line with, split out of dist/modelApi.js to hold
  // its unchanged 525 KiB cap; 10.7 KiB measured + 15%, rounded up to 25 KiB (D6).
  { path: 'dist/modelApiShell.js', budgetKiB: 25 },
  { path: 'dist/runtimeAccounting.js', budgetKiB: 50 },
  // TRAIN15E: credentials/model references only; 7.7 KiB +15%, rounded to 25 KiB.
  { path: 'dist/providerPolicy.js', budgetKiB: 25 },
  // Standalone ACP engine: 754.8 KiB +15%, rounded up to 25 KiB.
  { path: 'dist/runtimeEngine.js', budgetKiB: 875 },
  // REL0160B captured validators, team admission and exact USD: 26.0 KiB
  // measured +5%, rounded to 25 KiB (authorized brief, PLAN.md, 2026-10-07).
  { path: 'dist/modelApiBoundaries.js', budgetKiB: 50 },
  // TRAIN15E joined M95: providers 128.4, subscriptions 29.3, configured
  // providers 24.9 and Models panel 90.3 KiB measured.
  // JOIN0190 features merge, measured + 15%, rounded up to 25 KiB (D6/D74):
  // providers 158.6 (OpenRouter, OAuth loopback, key shapes), configured
  // providers 55.6 (key shapes, retry pacing) and Models panel 129.6 KiB
  // (loopback fetch, quick pick rows).
  // New bundles use measured + 15%, rounded up to 25 KiB (D6/D74).
  { path: 'dist/providers.js', budgetKiB: 200 },
  { path: 'dist/subscriptions.js', budgetKiB: 50 },
  { path: 'dist/configuredProviders.js', budgetKiB: 75 },
  { path: 'dist/modelsPanel.js', budgetKiB: 150 },
  // PANELBUDGET: the subscriptions half (sign-in flows), split out of the
  // panel bundle; 22,917 B measured +15%, rounded up to the next 25 KiB
  // multiple (PLAN.md D6).
  { path: 'dist/modelsSubscriptions.js', budgetKiB: 50 },
  // RLGROKAUTH: subscription dispatch and terminal commands (the registry
  // beside the sign-in flows), split out of dist/subscriptions.js;
  // 47,827 B measured +15%, rounded up to the next 25 KiB multiple (D6/D74).
  { path: 'dist/subscriptionCommands.js', budgetKiB: 75 },
  // M95c: editor chat's lazy provider bundle; 28.2 KiB measured on the
  // branch, budget re-measured on this tree (RLM95B).
  { path: 'dist/editorChat.js', budgetKiB: 30 },
  // M102: independent lazy entries; measured + 15%, rounded up to 25 KiB.
  { path: 'dist/usageService.js', budgetKiB: 100 },
  // RLUSAGE: the service's export encoders, required on the first export;
  // 31,720 B measured +15%, rounded up to the next whole KiB (PLAN.md D6).
  { path: 'dist/usageExport.js', budgetKiB: 36 },
  { path: 'dist/usageCompanion.js', budgetKiB: 50 },
  // CMICCOMP: independent first-use voice page, no chat startup imports.
  { path: 'dist/voiceCompanion.js', budgetKiB: 125 },
  { path: 'dist/webview/voiceCompanion.js', budgetKiB: 100 },
  { path: 'dist/webview/voiceCompanion.css', budgetKiB: 25 },
  { path: 'dist/usagePanel.js', budgetKiB: 75 },
  { path: 'dist/webview/usage.js', budgetKiB: 500 },
  { path: 'dist/webview/usage.css', budgetKiB: 25 },
  // M114 C: the companion page's static theme sheets (the consumer
  // closure CSS half): 22.1 KiB measured under its specified 25 KiB cap.
  { path: 'dist/webview/theme.css', budgetKiB: 25 },
  // TRAIN15E: Models page and its shared static imports: 424.9 KiB +15%.
  { path: 'dist/webview/models.js', budgetKiB: 500 },
  // RLM125 lane W: the setup wizard page and its shared static imports:
  // 346.0 KiB measured, plus 15%, rounded up to 25 KiB.
  { path: 'dist/webview/judgeSetup.js', budgetKiB: 400 },
  { path: 'dist/webview/judgeSetup.css', budgetKiB: 25 },
  // M115W: v1's Model API schedules beside the v2 runtime binding (store,
  // scheduler, delivery, time, events, registry, control and engine), loaded
  // on first schedule use: 167.8 KiB measured, plus 15%, rounded up to 25 KiB.
  // JOIN0190/66 merges the refusal/close settlement branches: 203.4 KiB
  // measured, plus 15%, rounded up to 25 KiB.
  { path: 'dist/schedules.js', budgetKiB: 250 },
  // SCHEDULEDELIVERY: the schedules' editor-delivery binding (workspace
  // targets, run dispatch, grant checks), loaded on the first delivery:
  // 36.2 KiB when split out (2026-10-18); 36.2 x 1.15 = 41.7 KiB, rounded
  // up to the next 25 KiB multiple (PLAN.md D6).
  { path: 'dist/scheduleDelivery.js', budgetKiB: 50 },
  // SCHEDULESURFACES: the conversation's schedule surfaces (delivery target
  // readout, scheduled-question settlement, schedules panel commands), loaded
  // on the first schedule delivery, panel command or scheduled question:
  // 9.1 KiB when split out (2026-10-18); 9.1 x 1.15 = 10.5 KiB, rounded up
  // to the next 25 KiB multiple (PLAN.md D6).
  { path: 'dist/scheduleSurfaces.js', budgetKiB: 25 },
  // The review (M70): git's material, the review turn's text, the Plan-mode
  // hold and edit review, loaded the first time one is used: 40.6 KiB when
  // split out, plus room (PLAN.md D6).
  { path: 'dist/review.js', budgetKiB: 50 },
  // M78b: first board/best-of-N action, 61.0 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/sessionBoard.js', budgetKiB: 75 },
  // M78b: paid Auto review after consent, 55.2 KiB with the same rule.
  { path: 'dist/reviewer.js', budgetKiB: 75 },
  // M96INT: tools and roster, loaded only for a team conversation. 44.6 KiB
  // measured; plus 15%, rounded up to 25 KiB (the approved D6 rule).
  // U1: new standalone editor, 74.9 KiB measured +15%, rounded to 100 KiB.
  { path: 'dist/teamPanel.js', budgetKiB: 100 },
  { path: 'dist/team.js', budgetKiB: 75 },
  // M96c X2: runner adapters 44.6 KiB; D6's 15%, rounded to 25 KiB.
  // RLF-BUDGETS: the runners read the shared team schemas from the
  // already-loaded dist/team.js instead of carrying second copies; 64.1 KiB
  // measured, back under the original 75 KiB cap.
  { path: 'dist/teamRunners.js', budgetKiB: 75 },
  // C-M96-3: the team host service with its engine worker and merge ports,
  // loaded only for a workspace that stores a team. Measured 114,909 bytes
  // (112.2 KiB, production build on Kubuntu, 2026-10-10) x 1.15 = 132,145
  // bytes (129.05 KiB), rounded up to the KiB (lead, 2026-10-10). With M96b's
  // headless team merged, the engine ports stay in dist/teamEngine.js: 103,406
  // bytes (101.0 KiB, Windows 11, int/recovery 2026-10-22).
  { path: 'dist/teamHost.js', budgetKiB: 130 },
  { path: 'dist/teamEngine.js', budgetKiB: 100 },
  // R4: first-use file adapter, 8.5 KiB measured +15%, rounded up.
  { path: 'dist/teamFileIo.js', budgetKiB: 10 },
  // CM963NF: native creation is its own first-use file-operation chunk.
  // Measured 9,299 bytes (9.1 KiB, production build on Kubuntu, 2026-10-11)
  // x 1.15 = 10,694 bytes (10.5 KiB), rounded up to the KiB (lead,
  // 2026-10-10); the 13 KiB cap predates the sweep/cleanup split below and
  // still covers it with room for the create path to grow.
  { path: 'dist/teamCreate.js', budgetKiB: 13 },
  // RVCM963NF P3-9: the reservation sweep, creation cleanup, typed create
  // refusals and governed worktree git runner beside the create chunk, so
  // dist/teamHost.js keeps its budget. Measured 14,438 bytes (14.1 KiB,
  // production build on Kubuntu, 2026-10-11) x 1.15 = 16,604 bytes
  // (16.3 KiB), rounded up to the KiB (lead, 2026-10-10).
  { path: 'dist/teamWorkerOps.js', budgetKiB: 17 },
  // R4 follow-up: first-merge flow, 9.6 KiB measured +15%, rounded up.
  { path: 'dist/teamMerge.js', budgetKiB: 12 },
  // M96c X2: board/scheduler/tools 57.8 KiB; D6's 15%, rounded to 25 KiB.
  // M120CAP (2026-10-10): scheduler 65,533 B after sharing team tools;
  // retain M96c X2's original cap. Receipt: docs/certification/m120-s.md.
  { path: 'dist/teamScheduler.js', budgetKiB: 75 },
  // RLF-TEAMCORE (M96c): the window-owned scheduler binding split out of
  // dist/teamScheduler.js, first window-scheduler action. Measured 49,841
  // bytes (48.7 KiB, production build on macmini, 2026-10-30) x 1.15 =
  // 56.0 KiB, rounded up to the next 25 KiB multiple (PLAN.md D6).
  { path: 'dist/teamWindow.js', budgetKiB: 75 },
  // RLF-TEAMCORE (M96c): checked, journalled landing and owner-store
  // recovery split out of dist/teamHost.js, first landing action. Measured
  // 61,885 bytes (60.4 KiB, production build on macmini, 2026-10-30) x 1.15
  // = 69.5 KiB, rounded up to the next 25 KiB multiple (PLAN.md D6).
  { path: 'dist/teamLanding.js', budgetKiB: 75 },
  // M91 lane W: the imported hooks' adapters (lane P's contracts and engine),
  // loaded the first time a session holding one runs a hook: 64.9 KiB when
  // split out (2026-10-04). 85.7 KiB once the imported records' reader moved
  // in from dist/modelApi.js (2026-10-05), 65.4 KiB with main's shared
  // dist/validation.js; plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/foreignHooks.js', budgetKiB: 100 },
  // M91: the hook and MCP-form runtime (lane E's spark-hooks.json reader and
  // dispatcher, lane H's typed handlers, lane M's form checks), moved out of
  // dist/modelApi.js and loaded on first use: 67.1 KiB when split out
  // (2026-10-05), 41.7 KiB once main's shared dist/validation.js carried its
  // zod/mini, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/hookRuntime.js', budgetKiB: 50 },
  // M91b: the Amp and OpenCode plugin host (its child's source, the host and
  // the event mapping), loaded on the first plugin hook: 51.6 KiB when split
  // out (2026-10-05), 33.8 KiB on 0.13.0's shared dist/validation.js; plus
  // 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/pluginHooks.js', budgetKiB: 50 },
  // MODELAPIDIET: the Model API backend's deferred per-call helpers (hook
  // call fields, argument previews, fetch URL checks), loaded on first use:
  // 23,433 B measured (2026-10-11); D6: 23,433 × 1.15 = 26,947.95 B,
  // rounded up to the next 25 KiB multiple = 51,200 B (50 KiB).
  { path: 'dist/modelApiTools.js', budgetKiB: 50 },
  // The byte-range file execution (reads and edits of one byte window),
  // loaded on the first range addressed call, off the per-call helpers'
  // budget: 32,040 B measured; D6: 32,040 × 1.15 = 36,846 B, rounded up
  // to the next 25 KiB multiple = 51,200 B (50 KiB).
  { path: 'dist/modelApiFileRange.js', budgetKiB: 50 },
  // The verify loop's session side (M68: the loop, its ledger and the
  // diagnostics history), loaded on the first turn that verifies tool
  // edits: 51,213 B measured (2026-10-18); D6: 51,213 × 1.15 = 58,894.95 B,
  // rounded up to the next 25 KiB multiple = 76,800 B (75 KiB).
  { path: 'dist/modelApiVerify.js', budgetKiB: 75 },
  // The image run-path (M34, M44: the call checks, the purchase and the
  // paid-use naming), loaded on the first image call: 18,708 B measured;
  // D6: 18,708 × 1.15 = 21,514.2 B, rounded up to the next 25 KiB
  // multiple = 25,600 B (25 KiB).
  { path: 'dist/modelApiImage.js', budgetKiB: 25 },
  // The B1 hold (M125, D107 §9.3: the confined runner, the floor, the veto
  // race and the skip's audit), loaded on the first shell ask that reaches
  // the hold with a packaged helper: 18,761 B measured (2026-10-23); D6:
  // 18,761 × 1.15 = 21,575.15 B, rounded up to the next 25 KiB multiple =
  // 25,600 B (25 KiB).
  { path: 'dist/modelApiB1.js', budgetKiB: 25 },
  // What a tool call or goal command runs (the file and shell tools'
  // execution with their edit helpers, the memory tool, the browser check's
  // placement and report, the goal rules), loaded on the first of them:
  // 70,934 B measured (2026-10-23); D6: 70,934 × 1.15 = 81,574.1 B, rounded
  // up to the next 25 KiB multiple = 102,400 B (100 KiB).
  { path: 'dist/modelApiToolRun.js', budgetKiB: 100 },
  // The fast judge's session side (M125 lane M, D107: the loop detector,
  // the first-send triage, the effort and keep-list verdicts, the turn
  // boundary), loaded when each turn or compaction starts: 13,019 B
  // measured (2026-10-23); D6: 13,019 × 1.15 = 14,971.85 B, rounded up to
  // the next 25 KiB multiple = 25,600 B (25 KiB).
  { path: 'dist/modelApiFast.js', budgetKiB: 25 },
  // The plan reader, the panel's Markdown parser, loaded on the first plan
  // action (M79): 114.7 KiB when split out, 139.0 KiB with the brief's writer.
  { path: 'dist/planMarkdown.js', budgetKiB: 150 },
  // M72: real checkpoint store/legacy reader, 187.0 KiB when split out.
  // Measured size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/checkpointStore.js', budgetKiB: 225 },
  { path: 'dist/hardwareGuard.js', budgetKiB: 25 },
  { path: 'dist/hardwareShell.js', budgetKiB: 20 },
  // M105 lane W: the attachment path (attach port with the portable
  // sniffers, limits and modality gate), loaded on first attach: 21.0 KiB
  // after the USD split. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/media.js', budgetKiB: 25 },
  // RVMEDIAV 8: the window's attached-media registry, the attach port's open
  // hook and contributor consent, loaded on the first attach beside
  // dist/media.js: 18.1 KiB measured. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/mediaHost.js', budgetKiB: 25 },
  // M105 lane W: the screen-recording command with the latest-file
  // discovery, loaded on the first recording command: 17.5 KiB after the
  // drivers split out (was 30.2 KiB with the R1-R3 drivers in). Budget 50
  // KiB stands.
  { path: 'dist/screenRecord.js', budgetKiB: 50 },
  // M105 RLF-RECORDING: the platform drivers (Windows, macOS, the Linux
  // portal) with their trust and helper chains, loaded on the first
  // recording start: 51.7 KiB measured. Measured size plus 15%, rounded
  // up to 60 KiB.
  { path: 'dist/screenRecordDrivers.js', budgetKiB: 60 },
  // The host side of byte-range file reads and edits, loaded on the first
  // range addressed call. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/toolRange.js', budgetKiB: 25 },
  // M83: the import from other agents (the scan, the converters, the file
  // access, the flow and smol-toml), loaded on the first import: 100.0 KiB
  // when split out. Measured size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  // M91 lane I's readers for every agent's hooks: 108.1 KiB with main's shared
  // dist/validation.js (2026-10-05). REL0160B union: 126.9 KiB +5%,
  // rounded to 25 KiB (authorized brief, PLAN.md, 2026-10-07).
  { path: 'dist/agentImport.js', budgetKiB: 150 },
  // M81: the browser check's pipe, run and processes, required on the first
  // check: 37.8 KiB when split out (zod/mini 14.8 of it). Measured size
  // plus 15%, rounded up to 25 KiB (PLAN.md D6). 44.5 KiB after the RV81
  // fixes; 49.8 KiB with A1's proxy, canaries and lifetimes (design spec v4
  // §9.1 held it at 50; the runtime store went to its own bundle below).
  // 50.5 KiB after A1's first review round (per-phase canary fixtures, the
  // upstream head bound), with no module off the check's path to split out:
  // 25 × ceil(1.15 × 50.5 / 25) = 75 KiB.
  { path: 'dist/browserCheck.js', budgetKiB: 75 },
  // M81 A1: the browser check's runtime acquisition (pin, download, bounded
  // ZIP extraction, hashing, publication), loaded only to prepare a runtime:
  // 37.2 KiB when split out. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/browserRuntime.js', budgetKiB: 50 },
  // M71: the conversations' Git adapter and, since 2026-10-03, the window's
  // git and pull request features moved out of activation: 127.4 KiB
  // measured; plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/conversationGit.js', budgetKiB: 150 },
  // AUDITDOCS: the conversation's export/import/share flows moved out of
  // dist/conversation.js: 23.2 KiB measured; plus 15%, rounded up to
  // 25 KiB steps is 50 KiB (PLAN.md D6).
  { path: 'dist/conversationTransfer.js', budgetKiB: 50 },
  // ACTBUD017: the Model API backend's session store (its budget journal,
  // atomic writes and stored-session schemas) moved out of activation,
  // required when that backend's host is first built: 37.1 KiB measured;
  // plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/modelApiSessions.js', budgetKiB: 50 },
  // ACTROOM: the Create AGENTS.md command (the command, the rules template
  // and their redaction) moved out of activation, required when that command
  // runs: 6.6 KiB measured; plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/rulesFile.js', budgetKiB: 25 },
  // M123: the native Git route (D104 §1: the runtime Git adapter, its service
  // and repository lease, the runtime's pull requests), required only where
  // vscode.git is missing, split out of dist/conversationGit.js at 87.8 KiB
  // measured; plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/nativeGit.js', budgetKiB: 125 },
  // The guarded process-start layer (PLAN.md D24) beside activation, required
  // by every Node bundle that starts a program or builds a child
  // environment: 16.0 KiB measured; plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/execGuard.js', budgetKiB: 25 },
  // M89: the bundled skills installer for Muse Code (the copy, the links and
  // zod's parser for the vendor record and the mark), loaded on first use:
  // 22.6 KiB when split out. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/bundledSkills.js', budgetKiB: 50 },
  // Code intelligence's `ide` answers (M67), loaded on the first call, and
  // voice's drivers (M9, M35), loaded on the first recording: split out on
  // 2026-10-03 at 80.3 and 34.5 KiB. Measured size plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  // M97: local legal scanner, 128.8 KiB measured; plus 15%, rounded to 25 KiB.
  // JOIN0190: the selected-fix previews ride the fix chunk; the scan
  // measures 143.6 KiB against the unchanged 150 KiB.
  { path: 'dist/legalScan.js', budgetKiB: 150 },
  // The header-fix planner (the fixer, the code-aware text helpers and the
  // patch document), loaded on the first scan with a fixable finding or the
  // first fix request. JOIN0190: it also carries the selected-fix previews:
  // 70.6 KiB measured against the unchanged 75 KiB (PLAN.md D6).
  { path: 'dist/legalFix.js', budgetKiB: 75 },
  { path: 'dist/codeIntel.js', budgetKiB: 100 },
  { path: 'dist/voice.js', budgetKiB: 50 },
  // Linux's offline voice driver (M9, D140), split out of dist/voice.js on
  // the first Linux recording: 35,907 B measured, plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  { path: 'dist/voiceLinux.js', budgetKiB: 50 },
  // Voice dictation's setups (M9, M35), required at their existing
  // construction points: 13,032 B measured, plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  { path: 'dist/dictation.js', budgetKiB: 25 },
  // The window's web fetch (M69), loaded on the first fetch: each hop's
  // checks and pins, the pinned transport, the decoders and the failures'
  // words. 46.7 KiB when split out on 2026-10-04, plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  { path: 'dist/webFetch.js', budgetKiB: 75 },
  // The Auto reviewer on Muse Code (M90), loaded on the first review: its
  // side session, queue and approvals with M78's reviewer core. 45.4 KiB when
  // split out, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/museCodeReviewer.js', budgetKiB: 75 },
  // M91 E: both-backend hooks, 45.4 KiB + 15%, rounded up to 25 KiB.
  { path: 'dist/extensionHooks.js', budgetKiB: 75 },
  // M109 lane W: the vault's window (the panel host and the broker client),
  // loaded on the first vault command: 32.4 KiB when split out. Measured
  // size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/vault.js', budgetKiB: 50 },
  // RVAPP-CM1091D5 BYTES: the vault's explicit-action code; measured below,
  // plus D6 headroom.
  { path: 'dist/vaultActions.js', budgetKiB: 25 },
  // The key-store migration's own chunk (D89.14 lane M); 36.75 KiB measured
  // in the harness build, plus headroom (production splitting only shrinks
  // it); a new cap, no existing cap moves.
  { path: 'dist/vaultMigration.js', budgetKiB: 45 },
  // INT0180: shared vault boundary closure; measured plus D6 headroom.
  { path: 'dist/vaultBoundaries.js', budgetKiB: 50 },
  // MSM109: 120,644 bytes measured on linuxlt after the joined lease/store
  // reviews (owner-death-only takeover, staged publication, confirmed
  // recovery); exactly 15% headroom, rounded to one byte.
  // VAULTPARITY: 168,477 bytes measured on linuxlt with the Windows broker
  // channel, host and file anchor wired in; exactly 15% headroom.
  { path: 'dist/vaultBroker.js', budgetKiB: 193_749 / 1024 },
  // VAULTPARITY: 33,159 bytes measured on linuxlt with the OS-store/file
  // anchor choice; exactly 15% headroom.
  { path: 'dist/vaultBrokerBindings.js', budgetKiB: 38_133 / 1024 },
  // MSM109: 58,130 bytes measured on linuxlt after the joined lease/store
  // reviews; exactly 15% headroom, rounded to one byte.
  { path: 'dist/vaultStore.js', budgetKiB: 66_850 / 1024 },
  { path: 'dist/vaultPosix.js', budgetKiB: 25 },
  // PR247FIX: 40,706 bytes measured on maclt with the Windows vault
  // platform (helper builds, pipe discovery and dial); exactly 15%
  // headroom.
  { path: 'dist/vaultWindows.js', budgetKiB: 46_812 / 1024 },
  // The report dialog (M93): the builder, its second scrub, the export paths
  // and the handler, loaded on the first open. 63.6 KiB when split out (its
  // own zod), plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/report.js', budgetKiB: 75 },
  // ACTIVATIONROOM: the CLI-backed and workspace command flows (the MCP
  // servers and hooks pickers, the skills, worktree, memory and plan flows),
  // required on the first of those commands. 29,962 B when split out
  // (29.3 KiB); plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/commands.js', budgetKiB: 50 },
  // The report fallback (lane REPORTFLOW R2): the same sealed draft behind
  // the editor's own quick pick, when the dialog cannot open. Measured at
  // merge time; budget holds measured plus headroom (PLAN.md D6).
  { path: 'dist/reportFallback.js', budgetKiB: 50 },
  // The capacity estimator's engine (M117, PLAN.md D6, D97), loaded on the
  // first estimate: goal and DAG, calibration, schedule and simulation,
  // recommendations, dated prices and the first-wave starter with their
  // shared contracts. RLF-BUDGETS: composer parsing and the wave start
  // moved to dist/estimateActions.js; 72.8 KiB measured, back under the
  // original 75 KiB cap.
  { path: 'dist/estimator.js', budgetKiB: 75 },
  // RLF-BUDGETS: the estimator run's composer parsing and first-wave
  // start, loaded on the first parse or wave start. 45,549 bytes
  // (44.5 KiB) measured +15% = 51.2 KiB, rounded up to the KiB.
  { path: 'dist/estimateActions.js', budgetKiB: 52 },
  // CIFIX161B: the sign-in gate (AuthService and the three-valued
  // credential read), loaded on the first credential, money or consent
  // read. 64.8 KiB when split out, plus 15%, rounded up to 25 KiB
  // (PLAN.md D6).
  { path: 'dist/auth.js', budgetKiB: 75 },
  // CIFIX161B: the paid gate, consent, usage and quote authority, loaded
  // on the first paid consent, gate or usage read. 62.7 KiB when split
  // out, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/paid.js', budgetKiB: 75 },
  // INT0180: estimator application contracts, measured with D6 headroom.
  { path: 'dist/estimateContracts.js', budgetKiB: 25 },
  // The estimator's plan snapshot (M117 C-M117-1, PLAN.md D6, D97), loaded
  // on the first estimate needing a plan snapshot: the shared core adapter
  // over M113's plan reader with the host's git and `gh` reads. 61.5 KiB
  // when split out, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/planSnapshot.js', budgetKiB: 75 },
  // The estimator's price port (M117 C-M117-4, PLAN.md D6), loaded on the
  // first price lookup: the report reader and cache over the pinned catalogs.
  // 58.0 KiB when split out, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/estimatePrices.js', budgetKiB: 75 },
  // The estimator history's journal (M117 C-M117-2, PLAN.md D6), loaded on
  // an estimate's first history read: the journal, its record rules and the
  // history contracts. 21.7 KiB when split out, plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  { path: 'dist/estimateHistory.js', budgetKiB: 25 },
  // The flight recorder's journal (M93), loaded just after activation or at
  // the first failure: 51.3 KiB when split out (the journal, its policy and
  // the shared protocol it validates against), plus 15%, rounded up to 25 KiB
  // (PLAN.md D6).
  { path: 'dist/recorder.js', budgetKiB: 75 },
  // The credential lease (M95 D74), loaded on the first guarded credential
  // write or Connect recovery. 8.6 KiB when split out (the lease, its
  // journal and the entry), plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/credentialLease.js', budgetKiB: 25 },
  // What's New (M99, PLAN.md D79), loaded on the first page or notice: the
  // page's renderer, its content schema (zod's mini parser) and its tab.
  // 34.8 KiB when split out, plus 15%, rounded up to 25 KiB.
  { path: 'dist/whatsNew.js', budgetKiB: 50 },
  { path: 'dist/whatsNew.json', budgetKiB: WHATS_NEW_CONTENT_BUDGET_KIB },
  // Shared English fallback; TRAIN14 restores the original cap after the
  // lossless packed fallback and ACTDIET region split (PLAN.md D6).
  // M98: first eligible approval, measured 77.7 KiB + 15%, rounded to 25 KiB.
  // Every existing budget is unchanged (PLAN.md D6).
  { path: 'dist/judge.js', budgetKiB: 100 },
  // Shared English fallback; existing host budgets stay unchanged. Measured
  // 104.9 KiB (2026-10-04); plus 15%, rounded up to 25 KiB.
  { path: 'dist/uiText.js', budgetKiB: 125 },
  // M98 B/D/CS/G: offline calibration, bounded CLI/MCP and authenticated
  // boundary, required on an explicit judge action. 59.6 KiB + 15%, rounded
  // up to 25 KiB; no pre-existing cap changes (PLAN.md D6).
  { path: 'dist/judgeP2.js', budgetKiB: 75 },
  { path: 'dist/judgeSources.js', budgetKiB: 75 },
  { path: 'dist/judgeLint.js', budgetKiB: 50 },
  { path: 'dist/judgeHook.js', budgetKiB: 100 },
  { path: 'dist/judgeLocal.js', budgetKiB: 75 },
  { path: 'dist/judgeUses.js', budgetKiB: 25 },
  // M98P2F: the authenticated serve factory loads only on an explicit
  // serve action. RLF-BUDGETS: the POSIX supervisor script moved into
  // runTreeSync, so bundles that never call it stop carrying it; 21.1 KiB
  // measured, back under the original 25 KiB cap.
  { path: 'dist/judgeServe.js', budgetKiB: 25 },
  // M125 lane W: the scan/setup/remove text steps: 39.7 KiB measured
  // +15%, rounded up to 25 KiB.
  { path: 'dist/judgeSetup.js', budgetKiB: 50 },
  // RLM125 lane W: the wizard driver (controller, ports, flows):
  // 42.2 KiB measured +15%, rounded up to 25 KiB.
  { path: 'dist/judgeSetupDriver.js', budgetKiB: 50 },
  // M98 integration: JSON Schema conversion loads only on explicit tool listing.
  { path: 'dist/validationSchema.js', budgetKiB: 50 },
  { path: 'dist/uiTextRuntime.js', budgetKiB: 25 },
  { path: 'dist/uiTextHooks.js', budgetKiB: 25 },
  { path: 'dist/uiTextSurfaces.js', budgetKiB: 25 },
  // M105: media English on first use; measured region +15%, rounded to 25 KiB.
  { path: 'dist/uiTextMedia.js', budgetKiB: 25 },
  // TRAIN13B: used Node mini-parser API, 39.5 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/validation.js', budgetKiB: 50 },
  // Shared existing Node boundary schemas: 41.3 KB plus 15%, rounded to 25
  // KiB. M115W: the main protocol carries the v2 surface's validated draft
  // and targets, 55.5 KiB measured, plus 15%, rounded up to 25 KiB.
  { path: 'dist/wire.js', budgetKiB: 75 },
  { path: 'dist/searchWorker.js', budgetKiB: 50 },
  // M101: pure raster worker, 58.7 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/imageResizeWorker.js', budgetKiB: 75 },
  // Web fetch's page converter (M69), on a worker started for each page:
  // 201.2 KiB when split out (parse5 122.7 of it), plus room.
  { path: 'dist/pageWorker.js', budgetKiB: 300 },
  { path: 'dist/webview/main.js', budgetKiB: 900 },
  // What's New's page script (M99): it only passes clicks back to the host.
  // 0.7 KiB when made, plus 15%, rounded up to 25 KiB.
  { path: 'dist/webview/whatsNew.js', budgetKiB: 25 },
  // HELPREF: an independent lazy page, sharing the caller's React and text.
  { path: 'dist/webview/referencePage.js', budgetKiB: 50 },
  // M115W: M115's schedule CLI row and report-action rows: 100.5 KiB
  // measured, plus 15%, rounded up to 25 KiB. Lead to confirm.
  { path: 'dist/reference.js', budgetKiB: 125 },
  // The ACP agent (M63, PLAN.md D62), a process of its own installed once,
  // never loaded by VS Code: the engine without the webview or the Model API
  // backend (dist/modelApi.js, M57), plus the ACP SDK and the classic zod it
  // imports (445.2 of 713.2 KiB when set, 257.6 of them zod's locales). The
  // measured size plus about 15 %, rounded up to 50 KiB (D6 amendment).
  // M105's trusted media inspector stays in its first-use media bundle.
  { path: 'dist/acp.js', budgetKiB: 850 },
  // TRAIN15E: headless preflight before the lazy engine; 77.9 KiB +15%.
  // TRAINFIX: train growth + plan-model preflight measures 100.2 KiB; +15%, rounded to 25 KiB.
  { path: 'dist/headless.js', budgetKiB: 125 },
  // M104 lane H (cc-m104h): the language server, loaded only by `lsp`:
  // 86.1 KiB measured +15% = 99.0 KiB, rounded up to 25 KiB.
  { path: 'dist/lsp.js', budgetKiB: 100 },
  // M104 lane H: `supervise`, `stop` and the server's `muse.stop`: 30.6 KiB
  // measured +15% = 35.2 KiB, rounded up to 25 KiB.
  { path: 'dist/supervise.js', budgetKiB: 50 },
  // M104 lane B (cc-m104b): the runtime panel, loaded only by `panel`:
  // 67,782 bytes (66.2 KiB) measured +15% = 76.1 KiB, rounded up to 25 KiB.
  { path: 'dist/runtimePanel.js', budgetKiB: 100 },
  // M104 lane B: the panel's conversations, loaded by runtimePanel.js after
  // the handshake: 75.0 KiB measured (2026-10-24, production build on the
  // Mac mini) +15% = 86.3 KiB; the editor ports of the lane's next slices
  // (git, review, checkpoints, paid use) land in this bundle, so the row is
  // set once at 120 KiB and not raised.
  { path: 'dist/runtimePanelSession.js', budgetKiB: 120 },
  // M104 lane B: the panel's heavier ports (saved plans today; the checkpoint
  // store joins), loaded on first use: 22.6 KiB measured (2026-10-24,
  // production build on the Mac mini) +15% = 26.0 KiB, rounded up to 30 KiB.
  { path: 'dist/runtimePanelPorts.js', budgetKiB: 30 },
  // M96b: run-owned team policy with its cleanup ledger, stale-run sweep,
  // denied-merge holds and marker gate, loaded only for --team. Measured
  // 46,823 bytes (45.73 KiB, production build on macbook, 2026-10-22)
  // x 1.15 = 53,846 bytes (52.58 KiB), rounded up to the KiB.
  // Re-measured on the 0.19.0 merge: HEAD's shared tables grew since the
  // branch's base (RVCM96B2 P3-8 rule kept). Headless retains its original
  // 125 KiB cap.
  { path: 'dist/execTeam.js', budgetKiB: 53 },
  // The cleanup ledger's cross-process lease (M96b), loaded on the first
  // ledger turn: 13,301 bytes (12.99 KiB, production build on macbook,
  // 2026-10-23) x 1.15 = 14.94 KiB, rounded up to the KiB.
  { path: 'dist/execLedgerLease.js', budgetKiB: 15 },
  // M114 F: runtime-only installer, measured with the shared validation API.
  { path: 'dist/fontsInstall.js', budgetKiB: 25 },
  { path: 'dist/scheduleBackground.js', budgetKiB: 50 },
  // The runtime account services (M108/W, PLAN.md D6): the store, the policy,
  // the developer owner and the headless ports, with the backend closure they
  // serve through. Loads only on the first accounts, developer or keyed
  // headless command. Measured 246.5 KiB; plus 15%, rounded up to 25 KiB.
  { path: 'dist/runtimeAccounts.js', budgetKiB: 300 },
  // C-M109-1 (lead decision 5): the vault for the CLI, the ACP agent and
  // headless runs, loaded on the first vault need. Measured 19.8 KiB;
  // plus 15%, rounded up to 25 KiB.
  { path: 'dist/vaultRuntime.js', budgetKiB: 25 },
  // M110-N: explicit node commands only; measured +15%, rounded to 25 KiB.
  { path: 'dist/node.js', budgetKiB: 75 },
  // M110t TP2: the pack index verifier (Sigstore's verification packages,
  // cc-sigstore), loaded on the first pack fetch. Measured 207.8 KiB; plus
  // 15%, rounded up to 25 KiB.
  { path: 'dist/packsVerify.js', budgetKiB: 250 },
]

// DIET1: independently emitted optional surfaces, measured on main, each plus
// 15%, rounded up to 25 KiB. Closure caps also charge their shared imports.
const WEBVIEW_SURFACE_BUDGETS = [
  // TRAIN15H: legal report's full non-startup closure, measured +15%, rounded to 25 KiB.
  { entry: 'LegalReport', budgetKiB: 25 },
  // TRAIN15H: review comment form, measured +15%, rounded to 25 KiB.
  { entry: 'ReviewCommentForm', budgetKiB: 25 },
  // Sign-in: 3.9 KiB + 15%, rounded to 25 KiB.
  { entry: 'SignIn', budgetKiB: 25 },
  // Goal panel: 3.2 KiB by the same rule.
  { entry: 'GoalPanel', budgetKiB: 25 },
  // Schedule panel: 1.6 KiB by the same rule.
  { entry: 'SchedulePanel', budgetKiB: 25 },
  // Palette: 5.4 KiB (7.5 KiB closure) by the same rule.
  { entry: 'Palette', budgetKiB: 25 },
  // Popover menu: 2.0 KiB by the same rule.
  { entry: 'PopoverMenu', budgetKiB: 25 },
  // Radial menu body: 4.9 KiB by the same rule.
  { entry: 'GooeyMenuContent', budgetKiB: 25 },
  // Account & usage body: 12.7 KiB by the same rule.
  // JOIN0190 features merge: 25.2 KiB measured (accounts surfaces), +15%,
  // rounded up to 25 KiB.
  { entry: 'UsageDialogContent', budgetKiB: 50 },
  // Agent map body: 8.0 KiB by the same rule.
  { entry: 'AgentMapContent', budgetKiB: 25 },
]

let hasFailure = false
for (const { path, budgetKiB } of BUDGETS) {
  if (!existsSync(path)) {
    hasFailure = true
    console.log(`MISS ${path}: not built (budget ${budgetKiB} KiB)`)
    continue
  }
  const pageMetafile = {
    'dist/webview/main.js': 'dist/meta/webview.json',
    'dist/webview/models.js': 'dist/meta/modelsWebview.json',
    'dist/webview/usage.js': 'dist/meta/usageWebview.json',
    'dist/webview/whatsNew.js': 'dist/meta/whatsNewPage.json',
    'dist/webview/judgeSetup.js': 'dist/meta/judgeSetupWebview.json',
  }[path]
  const files = pageMetafile
    ? webviewStartupOutputs(JSON.parse(readFileSync(pageMetafile, 'utf8')), path)
    : [path]
  const sizeKiB = files.reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
  const status = sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'
  if (sizeKiB > budgetKiB) {
    hasFailure = true
  }
  const label = pageMetafile ? `${path} + static imports` : path
  console.log(`${status} ${label}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`)
}

// TRAIN15C: provider usage loads only for a nonempty provider report; its
// new closure is 1,683 bytes + 15%, rounded up to 25 KiB (PLAN.md D6);
// scripts/lib/webviewBundles.mjs records and enforces that independent cap.
// Each new lazy closure has its own cap; old surfaces and unclassified
// deferred helpers stay under TRAIN13B's unchanged aggregate 50 KiB cap.
// TRAIN15H: optional surfaces' English has its own measured closure cap in
// webviewBundles.mjs, following measured +15%, rounded up to 25 KiB.
const webview = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8'))
for (const { name, page, source, budgetKiB, label = name } of [
  // TRAIN15G: full lazy closure 56.3 KiB +15%, rounded up to 25 KiB.
  { name: 'models', page: 'models', source: 'src/webview/models/panel.tsx', budgetKiB: 75 },
  // CM954R4: first-use table closure, measured +15%, rounded up to 25 KiB.
  {
    name: 'local model table',
    page: 'models',
    source: 'src/webview/models/ModelsSection.tsx',
    budgetKiB: 25,
  },
  // TRAIN15G: full lazy closure 35.4 KiB +15%, rounded up to 25 KiB.
  { name: 'usage', page: 'usage', source: 'src/webview/usage/UsageApp.tsx', budgetKiB: 50 },
  // C-M108-2: 134,934 B measured closure +15%, rounded to 25 KiB.
  // The original Models body and every startup/deferred cap stay unchanged.
  {
    name: 'models',
    label: 'model accounts',
    page: 'models',
    source: [
      'src/webview/models/ModelAccounts.tsx',
      'src/webview/models/sections/accounts/AccountsSurface.tsx',
    ],
    budgetKiB: 175,
  },
]) {
  const meta = JSON.parse(readFileSync(`dist/meta/${page}Webview.json`, 'utf8'))
  const files = [
    ...new Set(
      (Array.isArray(source) ? source : [source]).flatMap((entry) =>
        webviewPanelOutputs(meta, `dist/webview/${page}.js`, entry),
      ),
    ),
  ]
  const sizeKiB = files.reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
  if (sizeKiB > budgetKiB) hasFailure = true
  console.log(
    `${sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'} dist/webview ${label} body: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`,
  )
}
// MODELSPLIT: the Models panel's deferred sections have their own measured
// caps from the page's own metafile (see MODELS_DEFERRED_BUDGETS in
// scripts/lib/webviewBundles.mjs for the measurements). New rows, first set
// on the release train on 2026-10-11 at the merge of b92fab054 onto
// acf388a14: providers section 37 KiB (32,197 bytes measured, plus 15
// percent, rounded up), models section 13 KiB (12,074 bytes measured).
// M95 (CM954 R4): the saved-model editor's validated per-model window field
// grew the chunk to 13,448 bytes, so the row is 14 KiB (PLAN.md §7).
const modelsMeta = JSON.parse(readFileSync('dist/meta/modelsWebview.json', 'utf8'))
const modelsSectionGroups = modelsDeferredBudgetGroups(modelsMeta)
for (const { name, budgetKiB, outputs } of modelsSectionGroups) {
  // An empty group is a MISS, never an `ok` 0 KiB line: it means the
  // section chunk is gone, or its bytes moved back into the panel body
  // (where the body's own cap has room to hide them).
  if (outputs.length === 0) {
    hasFailure = true
    console.log(
      `MISS dist/webview ${name}: deferred section chunk missing (budget ${budgetKiB} KiB)`,
    )
    continue
  }
  const sizeKiB = outputs.reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
  if (sizeKiB > budgetKiB) hasFailure = true
  console.log(
    `${sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'} dist/webview ${name}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`,
  )
}
// M95c: the optional row control has its own first-use chunk and budget.
const editorChatMeta = JSON.parse(readFileSync('dist/meta/modelsWebview.json', 'utf8'))
const editorChatControls = Object.entries(editorChatMeta.outputs).filter(
  ([, output]) =>
    output.entryPoint?.replaceAll('\\', '/') === 'src/webview/models/EditorChatToggle.tsx',
)
if (editorChatControls.length === 1) {
  const EDITOR_CHAT_CONTROL_BUDGET_KIB = 2
  const sizeKiB = statSync(editorChatControls[0][0]).size / BYTES_PER_KIB
  if (sizeKiB > EDITOR_CHAT_CONTROL_BUDGET_KIB) hasFailure = true
  console.log(
    `${sizeKiB <= EDITOR_CHAT_CONTROL_BUDGET_KIB ? 'ok  ' : 'OVER'} editor chat controls: ${sizeKiB.toFixed(1)} KiB (budget ${EDITOR_CHAT_CONTROL_BUDGET_KIB} KiB)`,
  )
} else {
  console.error('Missing or duplicated editor chat control chunk')
  hasFailure = true
}
for (const { entry, budgetKiB } of WEBVIEW_SURFACE_BUDGETS) {
  for (const [file, output] of Object.entries(webview.outputs)) {
    if (output.entryPoint?.replaceAll('\\', '/') !== `src/webview/components/${entry}.tsx`) continue
    const sizeKiB = statSync(file).size / BYTES_PER_KIB
    if (sizeKiB > budgetKiB) hasFailure = true
    console.log(
      `${sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'} ${file} (${entry}): ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`,
    )
  }
}
for (const [name, source] of [
  ['Roles section', 'src/webview/models/sections/roles/RolesSection.tsx'],
  ['Role editor', 'src/webview/models/sections/roles/RoleEditor.tsx'],
  ['Agents section', 'src/webview/models/sections/agents/AgentsSection.tsx'],
  ['team validators', 'src/shared/teamPanelDefinition.ts'],
]) {
  const meta = JSON.parse(readFileSync('dist/meta/modelsWebview.json', 'utf8'))
  const files = webviewTeamPanelOutputs(meta, source)
  const sizeKiB = files.reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
  // U1: 17.4 / 35.5 / 3.4 KiB, +15%, rounded to the 25 KiB scale.
  const budgetKiB = name === 'Agents section' ? 50 : 25
  if (sizeKiB > budgetKiB) hasFailure = true
  console.log(
    `${sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'} dist/webview ${name}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`,
  )
}
for (const { name, budgetKiB, outputs } of webviewDeferredBudgetGroups(
  webview,
  QUESTION_UI_BUDGET_KIB,
)) {
  const sizeKiB = outputs.reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
  if (sizeKiB > budgetKiB) hasFailure = true
  console.log(
    `${sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'} dist/webview ${name}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`,
  )
}

// M106R: optional pacing/status UI, measured +15%, rounded up to 25 KiB (PLAN D6).
const WEBVIEW_PACING_BUDGET_KIB = 25
const pacing = new Set(webviewPacingOutputs(webview))
const pacingKiB = [...pacing].reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
if (pacingKiB > WEBVIEW_PACING_BUDGET_KIB) hasFailure = true
console.log(
  `${pacingKiB <= WEBVIEW_PACING_BUDGET_KIB ? 'ok  ' : 'OVER'} dist/webview pacing JS: ${pacingKiB.toFixed(1)} KiB (budget ${WEBVIEW_PACING_BUDGET_KIB} KiB)`,
)

if (hasFailure) {
  console.error('bundle size budget exceeded or a bundle is missing; see PLAN.md section 2 (D6)')
  process.exit(1)
}

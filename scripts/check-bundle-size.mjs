#!/usr/bin/env node
// Bundle-size gate. The budgets below are the record (PLAN.md section 2, D6,
// mirrors them) and change only with a CHANGELOG entry. Exits 1 when any production artifact exceeds
// its budget or is missing.

import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  webviewDeferredBudgetGroups,
  webviewPacingOutputs,
  webviewStartupOutputs,
  webviewPanelOutputs,
} from './lib/webviewBundles.mjs'

const BYTES_PER_KIB = 1024
// M99: bound the generated notes independently of their ZIP compression.
const WHATS_NEW_CONTENT_BUDGET_KIB = 40
// FIXM112U: independently measured question closure +15%, rounded to 25 KiB.
const QUESTION_UI_BUDGET_KIB = 25

/**
 * @type {ReadonlyArray<{ path: string; budgetKiB: number }>}
 */
const BUDGETS = [
  // M113 W: new entries, each measured +15%, rounded to 25 KiB.
  { path: 'dist/reporting.js', budgetKiB: 175 },
  { path: 'dist/reportingNetwork.js', budgetKiB: 75 },
  { path: 'dist/reportingDestinations.js', budgetKiB: 75 },
  { path: 'dist/reportingPanel.js', budgetKiB: 50 },
  // M112 A: question forms, commands and late-answer admission, loaded on first use.
  { path: 'dist/acpQuestions.js', budgetKiB: 25 },
  // FIXM116I: /playbook's journal-backed surface (70.9 KiB when split out;
  // +15% rounded up to 100 KiB), loaded by the agent and the CLI on first use.
  { path: 'dist/acpPlaybook.js', budgetKiB: 100 },
  // Exact media money no longer enters the registry through locale helpers.
  // Keep M112's original cap; M105's inherited temporary increase is removed.
  { path: 'dist/runtimeQuestions.js', budgetKiB: 25 },
  { path: 'dist/questionNotes.js', budgetKiB: 25 },
  { path: 'dist/extension.js', budgetKiB: 600 },
  // M107: 89.5 / 1.8 KiB measured; +15%, rounded up to 25 KiB.
  { path: 'dist/resourceGovernor.js', budgetKiB: 125 },
  // POSTSPAWN: the governed launcher, split from the governor; 35.6 KiB
  // measured, +15%, rounded up to 25 KiB. The governor's cap is unchanged.
  { path: 'dist/resourceProcess.js', budgetKiB: 50 },
  // POSTSPAWN: the vault MCP launch, off activation; 13.4 KiB measured,
  // +15%, rounded up to 25 KiB.
  { path: 'dist/mcpVault.js', budgetKiB: 25 },
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
  { path: 'dist/conversation.js', budgetKiB: 250 },
  // M94: provider, engine and ledger on first Tab use (PLAN.md D6).
  { path: 'dist/tab.js', budgetKiB: 75 },
  // M118: portable stores, native/panel adapters and chat renderer: 163.4 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/prompts.js', budgetKiB: 200 },
  // M118: local CLI/ACP stores, renderer and destinations: 152.1 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/sharingRuntime.js', budgetKiB: 175 },
  // REL0160B combined Model API: 479.2 KiB measured +5%, rounded to 25 KiB;
  // authorized rebuild brief and measurement recorded in PLAN.md (2026-10-07).
  { path: 'dist/modelApi.js', budgetKiB: 525 },
  { path: 'dist/exec.js', budgetKiB: 950 },
  { path: 'dist/modelApiCodeIntel.js', budgetKiB: 100 },
  { path: 'dist/mcpPool.js', budgetKiB: 75 },
  { path: 'dist/structuredSchema.js', budgetKiB: 50 },
  // M95 integration: measured 93.0, 50.1 and 404.7 KiB respectively.
  // TRAIN15E new lazy entries: 28.3, 49.0 and 26.0 KiB measured; +15%,
  // rounded up to 25 KiB. Existing Model API cap stays fixed.
  { path: 'dist/modelApiHooks.js', budgetKiB: 50 },
  { path: 'dist/modelApiMcp.js', budgetKiB: 75 },
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
  // New bundles use measured + 15%, rounded up to 25 KiB (D6/D74).
  { path: 'dist/providers.js', budgetKiB: 150 },
  { path: 'dist/subscriptions.js', budgetKiB: 50 },
  { path: 'dist/configuredProviders.js', budgetKiB: 50 },
  { path: 'dist/modelsPanel.js', budgetKiB: 125 },
  // M102: independent lazy entries; measured + 15%, rounded up to 25 KiB.
  { path: 'dist/usageService.js', budgetKiB: 100 },
  { path: 'dist/usageCompanion.js', budgetKiB: 50 },
  { path: 'dist/usagePanel.js', budgetKiB: 75 },
  { path: 'dist/webview/usage.js', budgetKiB: 500 },
  { path: 'dist/webview/usage.css', budgetKiB: 25 },
  // TRAIN15E: Models page and its shared static imports: 424.9 KiB +15%.
  { path: 'dist/webview/models.js', budgetKiB: 500 },
  // M115W: v1's Model API schedules beside the v2 runtime binding (store,
  // scheduler, delivery, time, events, registry, control and engine), loaded
  // on first schedule use: 167.8 KiB measured, plus 15%, rounded up to 25 KiB.
  { path: 'dist/schedules.js', budgetKiB: 200 },
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
  { path: 'dist/team.js', budgetKiB: 75 },
  // M96c X2: runner adapters 44.6 KiB; D6's 15%, rounded to 25 KiB.
  { path: 'dist/teamRunners.js', budgetKiB: 75 },
  // M96c X2: board/scheduler/tools 57.8 KiB; D6's 15%, rounded to 25 KiB.
  { path: 'dist/teamScheduler.js', budgetKiB: 75 },
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
  // The plan reader, the panel's Markdown parser, loaded on the first plan
  // action (M79): 114.7 KiB when split out, 139.0 KiB with the brief's writer.
  { path: 'dist/planMarkdown.js', budgetKiB: 150 },
  // M72: real checkpoint store/legacy reader, 187.0 KiB when split out.
  // Measured size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/checkpointStore.js', budgetKiB: 225 },
  // M105 lane W: the attachment path (attach port with the portable
  // sniffers, limits and modality gate), loaded on first attach: 21.0 KiB
  // after the USD split. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/media.js', budgetKiB: 25 },
  // M105 lane W: the screen-recording command with the R1-R3 platform
  // drivers, loaded on the first recording command: 30.2 KiB when split
  // out. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/screenRecord.js', budgetKiB: 50 },
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
  // ACTBUD017: the Model API backend's session store (its budget journal,
  // atomic writes and stored-session schemas) moved out of activation,
  // required when that backend's host is first built: 37.1 KiB measured;
  // plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/modelApiSessions.js', budgetKiB: 50 },
  // M89: the bundled skills installer for Muse Code (the copy, the links and
  // zod's parser for the vendor record and the mark), loaded on first use:
  // 22.6 KiB when split out. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/bundledSkills.js', budgetKiB: 50 },
  // Code intelligence's `ide` answers (M67), loaded on the first call, and
  // voice's drivers (M9, M35), loaded on the first recording: split out on
  // 2026-10-03 at 80.3 and 34.5 KiB. Measured size plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  // M97: local legal scanner, 128.8 KiB measured; plus 15%, rounded to 25 KiB.
  { path: 'dist/legalScan.js', budgetKiB: 150 },
  { path: 'dist/codeIntel.js', budgetKiB: 100 },
  { path: 'dist/voice.js', budgetKiB: 50 },
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
  // M109 lane W: the vault's window (the panel host and the native editor),
  // loaded on the first vault command: 32.4 KiB when split out. Measured
  // size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/vault.js', budgetKiB: 50 },
  // INT0180: shared vault boundary closure; measured plus D6 headroom.
  { path: 'dist/vaultBoundaries.js', budgetKiB: 50 },
  // The report dialog (M93): the builder, its second scrub, the export paths
  // and the handler, loaded on the first open. 63.6 KiB when split out (its
  // own zod), plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/report.js', budgetKiB: 75 },
  // The capacity estimator's engine (M117, PLAN.md D6, D97), loaded on the
  // first estimate: goal and DAG, calibration, schedule and simulation,
  // recommendations, dated prices and the first-wave starter with their
  // shared contracts. 60.7 KiB when split out, plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  { path: 'dist/estimator.js', budgetKiB: 75 },
  // INT0180: estimator application contracts, measured with D6 headroom.
  { path: 'dist/estimateContracts.js', budgetKiB: 25 },
  // The flight recorder's journal (M93), loaded just after activation or at
  // the first failure: 51.3 KiB when split out (the journal, its policy and
  // the shared protocol it validates against), plus 15%, rounded up to 25 KiB
  // (PLAN.md D6).
  { path: 'dist/recorder.js', budgetKiB: 75 },
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
  // Used Node mini-parser API: 39.5 KiB + 15%, rounded up to 25 KiB.
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
  { path: 'dist/headless.js', budgetKiB: 100 },
  // M114 F: runtime-only installer, measured with the shared validation API.
  { path: 'dist/fontsInstall.js', budgetKiB: 25 },
  { path: 'dist/scheduleBackground.js', budgetKiB: 50 },
  // The runtime account services (M108/W, PLAN.md D6): the store, the policy,
  // the developer owner and the headless ports, with the backend closure they
  // serve through. Loads only on the first accounts, developer or keyed
  // headless command. Measured 246.5 KiB; plus 15%, rounded up to 25 KiB.
  { path: 'dist/runtimeAccounts.js', budgetKiB: 300 },
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
  { entry: 'UsageDialogContent', budgetKiB: 25 },
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
for (const { name, source, budgetKiB } of [
  // TRAIN15G: full lazy closure 56.3 KiB +15%, rounded up to 25 KiB.
  { name: 'models', source: 'src/webview/models/panel.tsx', budgetKiB: 75 },
  // TRAIN15G: full lazy closure 35.4 KiB +15%, rounded up to 25 KiB.
  { name: 'usage', source: 'src/webview/usage/UsageApp.tsx', budgetKiB: 50 },
]) {
  const meta = JSON.parse(readFileSync(`dist/meta/${name}Webview.json`, 'utf8'))
  const files = webviewPanelOutputs(meta, `dist/webview/${name}.js`, source)
  const sizeKiB = files.reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
  if (sizeKiB > budgetKiB) hasFailure = true
  console.log(
    `${sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'} dist/webview ${name} body: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`,
  )
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

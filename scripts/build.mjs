#!/usr/bin/env node
import { buildLinuxHelper } from './build-linux-helper.mjs'
import { buildPortalRecord } from './build-portal-record.mjs'
import { buildVaultPeer } from './build-vault-peer.mjs'
import {
  COMPANION_THEME_CSS_FILE,
  companionThemeCssPlugin,
  resourceBrowserValidation,
  teamPanelBrowserValidation,
  webviewEntryMetafile,
} from './lib/webviewBundles.mjs'
import { listIntegrationTests } from './lib/integrationTests.mjs'
// Bundles the extension host entry, the Model API backend, the review, the search worker,
// web fetch's page converter worker (M69: parse5 and the HTML converter,
// loaded on a worker thread started for each page, never at activation), the
// browser check (M81, loaded on the first check), its runtime acquisition
// (M81 A1, loaded when a runtime is prepared or verified),
// import from other agents (M83: the scan, the converters, the file access and
// smol-toml, loaded on the first import), the bundled skills installer (M89:
// the copy and links for Muse Code, loaded on the first install, removal or
// offer), code intelligence's `ide` answers (M67, loaded on the first call),
// voice's drivers (M9/M35, loaded on the first recording), the window's web
// fetch (M69, loaded on the first fetch) and the Auto reviewer on Muse Code
// (M90, loaded on the first review), What's New (M99: the page's renderer,
// content schema and tab, loaded on the first page or notice), the report
// dialog (M93: the builder, its second scrub, the export paths and the
// handler, loaded on the first dialog open or Diagnostics command;
// dist/report.js) and its flight recorder
// (the journal, loaded just after activation; dist/recorder.js), the webview,
// What's New's page script, and (in dev mode) the integration tests with
// esbuild. It first writes What's New's content, dist/whatsNew.json, from
// CHANGELOG.md (scripts/lib/whatsNewContent.mjs); a Try it naming a command
// or setting the manifest does not contribute fails the build.
//
//   node scripts/build.mjs               dev build + integration test bundles
//   node scripts/build.mjs --watch       rebuild on change (extension + webview)
//   node scripts/build.mjs --production  minified, no sourcemaps, no test bundles
//
// The extension host bundle is CommonJS because VS Code loads `main` with
// require(). `vscode` is provided by the host and must stay external.
//
// The Model API backend is a second host bundle, dist/modelApi.js (M57,
// PLAN.md D6), with the same format, platform and target: the activation
// bundle requires it the first time that backend starts. Nothing it bundles
// may import `vscode` (src/core must not), so `vscode` is not external there
// and a stray import fails this build.
//
// The review (M70) is a third, dist/review.js: git's material for `/review`,
// its turn text and the Plan-mode hold, required the first time a review
// starts. Its factory installs the activation bundle's display language before use.
//
// A production build also writes each shipped bundle's esbuild metafile to
// dist/meta/ (M26, PLAN.md D29): the list of every source file that went in,
// from which scripts/third-party-notices.mjs derives the packages whose
// licences travel with the .vsix. The folder is not packaged.
//
// The ACP agent (`dist/acp.js`, PLAN.md D62) is built beside them for its own
// npm package, not the .vsix; its metafile goes to dist/meta-acp/ so the
// extension's notices never list what only the agent ships. Its keyring
// binding is a native module, installed with the package, never bundled. The
// agent loads the Model API backend from dist/modelApi.js, as the extension
// does, and its package ships that file (scripts/package-acp.mjs), so the
// backend is built once for both.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  UI_TEXT_REGIONS,
  regionalUiText,
  compressedEnglish,
  compactBrowserUiText,
} from './lib/uiTextRegions.mjs'
import { isolateMakerValidation } from './lib/makerValidation.mjs'
import { buildProfile } from './lib/arduinoBuild.mjs'

import { lazyBrowserKeybindings } from './lib/browserKeybindings.mjs'
import { compressedModelText } from './lib/compressedModelText.mjs'
import { withFoldedConstants } from './lib/foldedConstants.mjs'
import {
  compiledRecordFor,
  newBuildRecord,
  readCompiledSource,
  withCompiledRecording,
} from './lib/compiledSources.mjs'
import { loadL10n } from './lib/l10nSource.mjs'
import * as esbuild from 'esbuild'
import { copyCatalogToDist } from './sync-provider-catalog.mjs'
import { sharedHighlightGrammar } from './lib/highlightGrammar.mjs'
import { deferredTeamView } from './lib/deferredTeamView.mjs'
import { HOST_PLUGINS } from './lib/hostPlugins.mjs'
import { runBuildPool } from './lib/buildPool.mjs'
import {
  sharedUiText,
  sharedValidation,
  sharedMakerContracts,
  nodeReferenceData,
  deferredCohort,
  sharedWire,
  sharedResourceAdmission,
  sharedStructuredSchema,
  sharedModelApiBoundaries,
  sharedExecGuard,
  englishZodLocales,
  sharedRedaction,
  sharedVaultStore,
  sharedVaultPosix,
  sharedVaultWindows,
} from './lib/deferredBundles.mjs'
import {
  hardwareGuardSplit,
  hardwareShellSplit,
  hardwareConstantTables,
  browserConstantTables,
} from './lib/hardwareGuardSplit.mjs'
import {
  CONTENT_FILE as WHATS_NEW_CONTENT_OUTFILE,
  writeWhatsNewContent,
} from './lib/whatsNewContent.mjs'

execFileSync(process.execPath, ['scripts/team-tool-schemas.mjs'], { stdio: 'inherit' })

// M125 lane W: the judged-models table ships beside the setup bundles,
// byte-identical; the setup flow validates it before use.
cpSync('src/shared/judgeModels.json', 'dist/judgeModels.json', { force: true })
mkdirSync('dist/legal-data', { recursive: true })
// Dataset attribution and provenance accompany both packaged scanner bundles.
cpSync('src/core/legal/data/NOTICE.md', 'dist/legal-data/NOTICE.md', { force: true })
cpSync('src/core/legal/data/provenance.json', 'dist/legal-data/provenance.json', { force: true })
// M97 CM971-R3: the pinned SPDX templates ship beside dist/legalScan.js,
// byte-identical, and the scanner verifies each SHA-256 before use.
cpSync('src/core/legal/legal-data', 'dist/legal-data', { recursive: true, force: true })
{
  const { datasets } = JSON.parse(readFileSync('src/core/legal/data/provenance.json', 'utf8'))
  const pinned = datasets.find((dataset) => dataset.name === 'spdx-license-templates')
  if (pinned === undefined) throw new Error('provenance.json lost the SPDX template dataset')
  const slots = datasets.find((dataset) => dataset.name === 'holder-slot-words')
  if (slots === undefined) throw new Error('provenance.json lost the holder-slot dataset')
  for (const file of [...pinned.files, ...slots.files]) {
    const digest = createHash('sha256')
      .update(readFileSync(path.join('dist/legal-data', file.path)))
      .digest('hex')
    if (digest !== file.sha256)
      throw new Error(`dist/legal-data/${file.path} does not match its pinned SHA-256`)
  }
}

const args = new Set(process.argv.slice(2))
buildLinuxHelper()
buildVaultPeer()
buildPortalRecord()

const isProduction = args.has('--production')
const isWatch = args.has('--watch')
// The Arduino IDE job runs the integration suite inside a production
// Arduino build (hosts.yml), so it asks for the test bundles explicitly.
const isWithIntegrationTests = args.has('--integration-tests')
const profile = buildProfile(args.has('--arduino'))
const BUILD_PROFILE_FILE = 'dist/build-profile.json'

const HOST_ENTRY = 'src/extension.ts'
const HOST_OUTFILE = 'dist/extension.js'
const DEVICES_ENTRY = 'src/host/devices/deviceEntry.ts'
const DEVICES_OUTFILE = 'dist/devices.js'
// RLF-DEVICES: the maker executors and their simulators, beside
// dist/devices.js, required on the first maker execution.
const MAKER_ENTRY = 'src/host/devices/makerEntry.ts'
const MAKER_OUTFILE = 'dist/maker.js'
const CONVERSATION_ENTRY = 'src/host/conversation/conversationEntry.ts'
// SCHEDULESURFACES: the conversation's schedule surfaces (delivery target
// readout, scheduled-question settlement, schedules panel commands), loaded
// on the first schedule delivery, panel command or scheduled question.
const SCHEDULE_SURFACES_ENTRY = 'src/host/conversation/scheduleSurfacesEntry.ts'
const SCHEDULE_SURFACES_OUTFILE = 'dist/scheduleSurfaces.js'
const CONVERSATION_OUTFILE = 'dist/conversation.js'
// CONVBUDGET: the conversation's session-transfer flows (export, import and
// the share-file preview), required on the first of those flows.
const CONVERSATION_TRANSFER_ENTRY = 'src/host/conversation/conversationTransferEntry.ts'
const CONVERSATION_TRANSFER_OUTFILE = 'dist/conversationTransfer.js'
const VERIFY_EDITOR_ENTRY = 'src/host/vscode/editor/verifyEditor.ts'
const VERIFY_EDITOR_OUTFILE = 'dist/verifyEditor.js'
const MAKER_HOST_ENTRY = 'src/host/maker/makerEntry.ts'
const MAKER_HOST_OUTFILE = 'dist/makerHost.js'
// One immutable English fallback shared by Node bundles; each keeps its own
// mutable installed-language state. The browser keeps its fallback bundled.
const SHARING_RUNTIME_ENTRY = 'src/runtime/sharing/sharingEntry.ts'
const SHARING_RUNTIME_OUTFILE = 'dist/sharingRuntime.js'
// M124 (D106): the MCP connector, loaded only by `muse-spark-code-acp mcp`.
const CONNECTOR_ENTRY = 'src/runtime/connector/entry.ts'
const CONNECTOR_OUTFILE = 'dist/connector.js'
// M124 (D106, RVM124 finding 15): the connector's storage guard, loaded by
// the `mcp` command beside the connector bundle.
const CONNECTOR_STORE_GUARD_ENTRY = 'src/runtime/connector/storageGuard.ts'
const CONNECTOR_STORE_GUARD_OUTFILE = 'dist/connectorStoreGuard.js'
const PROMPTS_ENTRY = 'src/host/vscode/prompts/promptEntry.ts'
const PROMPTS_OUTFILE = 'dist/prompts.js'
const TAB_ENTRY = 'src/host/tab/tabEntry.ts'
const TAB_OUTFILE = 'dist/tab.js'
const UI_TEXT_ENTRY = 'src/shared/l10n/en.ts'
const UI_TEXT_OUTFILE = 'dist/uiText.js'
const VALIDATION_ENTRY = 'src/host/validationEntry.ts'
const VALIDATION_OUTFILE = 'dist/validation.js'
const MODEL_API_ENTRY = 'src/host/backend/modelApiEntry.ts'
const MODEL_API_OUTFILE = 'dist/modelApi.js'
// The Muse Code backend's own bundle (PR206, PLAN.md D6): the host, its
// notification mapping and the SDK, required the first time that backend
// starts. Nothing it bundles may import `vscode` (src/core must not), so
// `vscode` is not external there and a stray import fails this build.
const MUSE_CODE_ENTRY = 'src/host/backend/museCodeEntry.ts'
const MUSE_CODE_OUTFILE = 'dist/museCode.js'
const RESOURCE_ENTRY = 'src/core/resources/resourceGovernorEntry.ts'
const RESOURCE_OUTFILE = 'dist/resourceGovernor.js'
// RLF-BUDGETS: the Windows job-object tree reader, beside (never inside)
// the governor; it reads no `vscode`, so a stray import fails this build.
const RESOURCE_WINDOWS_ENTRY = 'src/core/resources/trees/windowsEntry.ts'
const RESOURCE_WINDOWS_OUTFILE = 'dist/resourceGovernorWindows.js'
// POSTSPAWN: the governed launcher, beside (never inside) the governor.
const RESOURCE_PROCESS_ENTRY = 'src/core/resources/resourceProcessEntry.ts'
const RESOURCE_PROCESS_OUTFILE = 'dist/resourceProcess.js'
// POSTSPAWN: the vault MCP launch (scrubber, leases), on the first vault-backed server.
const MCP_VAULT_ENTRY = 'src/host/backend/mcpVaultEntry.ts'
const MCP_VAULT_OUTFILE = 'dist/mcpVault.js'
// POSTSPAWN (C-M106-3R2): the 1.4.4 effort catalogue reader, on the first
// model catalogue read (the manager preloads it; lane K budget).
const MODEL_EFFORTS_ENTRY = 'src/core/backends/musecode/modelEffortsEntry.ts'
const MODEL_EFFORTS_OUTFILE = 'dist/modelEfforts.js'
// M108 lane P: account-bound paid consent, on the first use billed to another account.
const ACCOUNT_PAID_ENTRY = 'src/host/paid/accountPaidEntry.ts'
const ACCOUNT_PAID_OUTFILE = 'dist/accountPaid.js'
const RESOURCE_ADMISSION_ENTRY = 'src/core/resources/admissionEntry.ts'
const RESOURCE_ADMISSION_OUTFILE = 'dist/resourceAdmission.js'
const PROVIDERS_ENTRY = 'src/host/backend/providersEntry.ts'
const PROVIDERS_OUTFILE = 'dist/providers.js'
const SUBSCRIPTIONS_ENTRY = 'src/host/backend/subscriptionsEntry.ts'
const SUBSCRIPTIONS_OUTFILE = 'dist/subscriptions.js'
const SUBSCRIPTION_COMMANDS_ENTRY = 'src/host/backend/subscriptionCommandsEntry.ts'
const SUBSCRIPTION_COMMANDS_OUTFILE = 'dist/subscriptionCommands.js'
const CONFIGURED_ENTRY = 'src/host/backend/configuredProvidersEntry.ts'
const CONFIGURED_OUTFILE = 'dist/configuredProviders.js'
const SESSION_BOARD_ENTRY = 'src/host/sessionBoardEntry.ts'
const SESSION_BOARD_OUTFILE = 'dist/sessionBoard.js'
const TEAM_PANEL_ENTRY = 'src/core/team/teamPanelEntry.ts'
const TEAM_PANEL_OUTFILE = 'dist/teamPanel.js'
const TEAM_ENTRY = 'src/core/team/teamEntry.ts'
const TEAM_OUTFILE = 'dist/team.js'
const TEAM_SCHEDULER_ENTRY = 'src/core/team/teamSchedulerEntry.ts'
const TEAM_SCHEDULER_OUTFILE = 'dist/teamScheduler.js'
const TEAM_RUNNERS_ENTRY = 'src/host/runners/teamRunnersEntry.ts'
const TEAM_RUNNERS_OUTFILE = 'dist/teamRunners.js'
const TEAM_HOST_ENTRY = 'src/host/team/teamHostEntry.ts'
const TEAM_HOST_OUTFILE = 'dist/teamHost.js'
const TEAM_FILE_IO_ENTRY = 'src/core/team/workers/workerToolIoEntry.ts'
const TEAM_FILE_IO_OUTFILE = 'dist/teamFileIo.js'
const TEAM_WORKER_OPS_ENTRY = 'src/core/team/workers/workerOpsEntry.ts'
const TEAM_WORKER_OPS_OUTFILE = 'dist/teamWorkerOps.js'
const TEAM_MERGE_ENTRY = 'src/core/team/teamMergeFlow.ts'
const TEAM_MERGE_OUTFILE = 'dist/teamMerge.js'
// RLF-TEAMCORE (M96c): the window-owned scheduler binding and the checked
// landing load on their first team action, out of the scheduler-tools and
// team-host bundles whose budgets they broke.
const TEAM_WINDOW_ENTRY = 'src/core/team/scheduler/teamWindowEntry.ts'
const TEAM_WINDOW_OUTFILE = 'dist/teamWindow.js'
const TEAM_LANDING_ENTRY = 'src/host/team/teamLandingEntry.ts'
const TEAM_LANDING_OUTFILE = 'dist/teamLanding.js'
// M115 W: v1's Model API schedules re-exported beside the v2 runtime binding.
const SCHEDULES_ENTRY = 'src/runtime/schedules/schedulesBundle.ts'
const SCHEDULES_OUTFILE = 'dist/schedules.js'
// SCHEDULEDELIVERY: the schedules' editor-delivery binding (workspace
// targets, run dispatch, grant checks), loaded on the first delivery.
const SCHEDULE_DELIVERY_ENTRY = 'src/host/schedules/scheduleDeliveryEntry.ts'
const SCHEDULE_DELIVERY_OUTFILE = 'dist/scheduleDelivery.js'
const REVIEWER_ENTRY = 'src/core/backends/modelapi/reviewerEntry.ts'
const REVIEWER_OUTFILE = 'dist/reviewer.js'
// M91 lane W: the adapters for hooks imported in another agent's format,
// loaded the first time a session holding one runs a hook.
const FOREIGN_HOOKS_ENTRY = 'src/core/backends/modelapi/foreignHooksEntry.ts'
const FOREIGN_HOOKS_OUTFILE = 'dist/foreignHooks.js'
// M91: the hook and MCP-form runtime (lane E's spark-hooks.json reader and
// dispatcher, lane H's typed handlers, lane M's form checks), loaded the first
// time a session with hooks on, or a server's form, needs it.
const HOOK_RUNTIME_ENTRY = 'src/core/backends/modelapi/hookRuntimeEntry.ts'
const HOOK_RUNTIME_OUTFILE = 'dist/hookRuntime.js'
// M91b: the Amp and OpenCode plugin host, which the adapters require the
// first time a session dispatches a plugin hook.
const PLUGIN_HOOKS_ENTRY = 'src/core/backends/modelapi/pluginHooksEntry.ts'
const PLUGIN_HOOKS_OUTFILE = 'dist/pluginHooks.js'
const PLAN_MARKDOWN_ENTRY = 'src/host/planMarkdownEntry.ts'
const PLAN_MARKDOWN_OUTFILE = 'dist/planMarkdown.js'
const LEGAL_SCAN_ENTRY = 'src/core/legal/entry.ts'
const LEGAL_SCAN_OUTFILE = 'dist/legalScan.js'
// The header-fix planner (the fixer, the code-aware text helpers and the
// patch document), loaded on the first scan with a fixable finding or the
// first fix request.
const LEGAL_FIX_ENTRY = 'src/core/legal/legalFixEntry.ts'
const LEGAL_FIX_OUTFILE = 'dist/legalFix.js'
const REVIEW_ENTRY = 'src/host/review/reviewEntry.ts'
const REVIEW_OUTFILE = 'dist/review.js'
const AGENT_IMPORT_ENTRY = 'src/host/agentImportEntry.ts'
const AGENT_IMPORT_OUTFILE = 'dist/agentImport.js'
const CONVERSATION_GIT_ENTRY = 'src/host/git/conversationGitEntry.ts'
const CONVERSATION_GIT_OUTFILE = 'dist/conversationGit.js'
const MODEL_API_SESSIONS_ENTRY = 'src/host/backend/fileSessionStoreEntry.ts'
const MODEL_API_SESSIONS_OUTFILE = 'dist/modelApiSessions.js'
const RULES_FILE_ENTRY = 'src/host/commands/rulesFileEntry.ts'
const RULES_FILE_OUTFILE = 'dist/rulesFile.js'
const NATIVE_GIT_ENTRY = 'src/runtime/panel/git/nativeGitEntry.ts'
const NATIVE_GIT_OUTFILE = 'dist/nativeGit.js'
// The guarded process-start layer (PLAN.md D24), required beside activation
// by every Node bundle that starts a program or builds a child environment.
const EXEC_GUARD_ENTRY = 'src/core/execGuardEntry.ts'
const EXEC_GUARD_OUTFILE = 'dist/execGuard.js'
const BUNDLED_SKILLS_ENTRY = 'src/host/skills/bundledSkillsEntry.ts'
const BUNDLED_SKILLS_OUTFILE = 'dist/bundledSkills.js'
const CHECKPOINT_STORE_ENTRY = 'src/host/checkpoints/checkpointStoreEntry.ts'
const CHECKPOINT_STORE_OUTFILE = 'dist/checkpointStore.js'
const HARDWARE_GUARD_ENTRY = 'src/core/maker/guardEntry.ts'
const HARDWARE_GUARD_OUTFILE = 'dist/hardwareGuard.js'
// M105 lane W: the attachment path (attach port with the portable sniffers,
// limits and modality gate), loaded on first use.
const MEDIA_ENTRY = 'src/host/media/mediaEntry.ts'
const MEDIA_OUTFILE = 'dist/media.js'
// M105 lane W: the screen-recording command with the R1-R3 platform drivers,
// loaded the first time a recording command runs.
// RVMEDIAV 8: the window's attached-media registry, contributor consent and
// attach binding, required on the first attach beside dist/media.js.
const MEDIA_HOST_ENTRY = 'src/host/vscode/media/mediaHostEntry.ts'
const MEDIA_HOST_OUTFILE = 'dist/mediaHost.js'
// The host side of byte-range file reads and edits, loaded on the first
// range addressed call.
const TOOL_RANGE_ENTRY = 'src/host/backend/toolRangeEntry.ts'
const TOOL_RANGE_OUTFILE = 'dist/toolRange.js'
const SCREEN_RECORD_ENTRY = 'src/host/media/screenRecordEntry.ts'
const SCREEN_RECORD_OUTFILE = 'dist/screenRecord.js'
const SCREEN_RECORD_DRIVERS_ENTRY = 'src/host/media/recordingDriverEntry.ts'
const SCREEN_RECORD_DRIVERS_OUTFILE = 'dist/screenRecordDrivers.js'
// The browser check's own bundle (M81): the pipe, the run, the browser's processes.
const BROWSER_CHECK_ENTRY = 'src/host/browser/browserCheckEntry.ts'
const BROWSER_CHECK_OUTFILE = 'dist/browserCheck.js'
// The runtime's acquisition (M81 A1): the pin, the download, the ZIP reader, the store.
const BROWSER_RUNTIME_ENTRY = 'src/host/browser/browserRuntimeEntry.ts'
const BROWSER_RUNTIME_OUTFILE = 'dist/browserRuntime.js'
const CODE_INTEL_ENTRY = 'src/host/ide/codeIntelEntry.ts'
const CODE_INTEL_OUTFILE = 'dist/codeIntel.js'
const VOICE_ENTRY = 'src/host/voice/voiceEntry.ts'
const VOICE_OUTFILE = 'dist/voice.js'
const VOICE_LINUX_ENTRY = 'src/host/voice/voiceLinuxEntry.ts'
const VOICE_LINUX_OUTFILE = 'dist/voiceLinux.js'
const DICTATION_ENTRY = 'src/host/voice/dictationEntry.ts'
const DICTATION_OUTFILE = 'dist/dictation.js'
const WEB_FETCH_ENTRY = 'src/host/web/webFetchEntry.ts'
const WEB_FETCH_OUTFILE = 'dist/webFetch.js'
const MUSE_CODE_REVIEWER_ENTRY = 'src/host/review/museCodeReviewerEntry.ts'
const MUSE_CODE_REVIEWER_OUTFILE = 'dist/museCodeReviewer.js'
const EDITOR_CHAT_ENTRY = 'src/host/models/lmProviderEntry.ts'
const EDITOR_CHAT_OUTFILE = 'dist/editorChat.js'
const MODELS_PANEL_ENTRY = 'src/host/vscode/models/modelsPanelEntry.ts'
const MODELS_PANEL_OUTFILE = 'dist/modelsPanel.js'
// CIFIX161B: the sign-in gate and the three-valued credential read, loaded
// the first time a credential, money or consent path needs them.
const AUTH_ENTRY = 'src/host/auth/authEntry.ts'
const AUTH_OUTFILE = 'dist/auth.js'
// CIFIX161B: the paid gate, consent, usage and quote authority, loaded the
// first time a paid path needs them.
const PAID_ENTRY = 'src/host/paid/paidEntry.ts'
const PAID_OUTFILE = 'dist/paid.js'
const MODELS_SUBSCRIPTIONS_ENTRY = 'src/host/models/modelsSubscriptionsEntry.ts'
const MODELS_SUBSCRIPTIONS_OUTFILE = 'dist/modelsSubscriptions.js'
// ACTIVATIONROOM: the CLI-backed and workspace command flows, required on
// the first of those commands.
const COMMANDS_ENTRY = 'src/host/commands/commandsEntry.ts'
const COMMANDS_OUTFILE = 'dist/commands.js'
const USAGE_SERVICE_ENTRY = 'src/runtime/usage/usageServiceEntry.ts'
const USAGE_EXPORT_ENTRY = 'src/core/usage/usageExportEntry.ts'
const USAGE_COMPANION_ENTRY = 'src/runtime/usage/usageCompanionEntry.ts'
const USAGE_PANEL_ENTRY = 'src/host/vscode/usage/usagePanelEntry.ts'
const EXTENSION_HOOKS_ENTRY = 'src/host/extensionHooksEntry.ts'
const EXTENSION_HOOKS_OUTFILE = 'dist/extensionHooks.js'
// M109 lane W: the vault's window (the panel host and the broker client),
// loaded on the first vault command. `vscode` stays external, provided by
// the host, as for the import. The broker client joins it once the
// broker-backed service lands (docs/certification/m109.md). The native
// editor, the write-only crypto and the action dialogs load later from
// dist/vaultActions.js (RVAPP-CM1091D5 BYTES).
const VAULT_ENTRY = 'src/host/vscode/vault/vaultPanelEntry.ts'
const VAULT_OUTFILE = 'dist/vault.js'
// RVAPP-CM1091D5 BYTES: the vault's explicit-action code (dist/vaultActions.js),
// loaded on the first action that needs it instead of when the panel opens.
const VAULT_ACTIONS_ENTRY = 'src/host/vault/vaultActionsEntry.ts'
const VAULT_ACTIONS_OUTFILE = 'dist/vaultActions.js'
// The key-store migration's own chunk (D89.14 lane M, dist/vaultMigration.js),
// loaded on the first unlock edge instead of with the panel or at activation.
const VAULT_MIGRATION_ENTRY = 'src/host/vault/vaultMigrationEntry.ts'
const VAULT_MIGRATION_OUTFILE = 'dist/vaultMigration.js'
const WHATS_NEW_ENTRY = 'src/host/whatsNew/whatsNewEntry.ts'
const WHATS_NEW_OUTFILE = 'dist/whatsNew.js'
const JUDGE_ENTRY = 'src/host/judge/judgeEntry.ts'
const JUDGE_OUTFILE = 'dist/judge.js'
const IMAGE_RESIZE_WORKER_ENTRY = 'src/core/imageResizeWorker.ts'
const IMAGE_RESIZE_WORKER_OUTFILE = 'dist/imageResizeWorker.js'
const SEARCH_WORKER_ENTRY = 'src/host/backend/searchWorker.ts'
const SEARCH_WORKER_OUTFILE = 'dist/searchWorker.js'
const REPORT_ENTRY = 'src/host/support/reportEntry.ts'
const REPORT_OUTFILE = 'dist/report.js'
// Lane REPORTFLOW R2: the editor-native fallback (the sealed draft behind a
// quick pick), loaded when the report entry cannot be loaded or no
// conversation surface becomes ready.
const REPORT_FALLBACK_ENTRY = 'src/host/support/reportFallbackEntry.ts'
const REPORT_FALLBACK_OUTFILE = 'dist/reportFallback.js'
const ESTIMATOR_ENTRY = 'src/host/estimator/estimatorEntry.ts'
const ESTIMATOR_OUTFILE = 'dist/estimator.js'
// M117 C-M117-1: the shared core adapter over M113's plan reader with the
// host's git and `gh` reads, loaded the first time an estimate needs a plan
// snapshot.
const PLAN_SNAPSHOT_ENTRY = 'src/host/estimator/planSnapshotEntry.ts'
const PLAN_SNAPSHOT_OUTFILE = 'dist/planSnapshot.js'
// M117 C-M117-4: the estimator's price port over the report reader and
// cache, loaded the first time an estimate looks prices up; it reads no
// `vscode`, so a stray import fails this build.
const ESTIMATE_PRICES_ENTRY = 'src/host/estimator/priceCatalogEntry.ts'
const ESTIMATE_PRICES_OUTFILE = 'dist/estimatePrices.js'
// M117 C-M117-2: the estimator history's journal, loaded the first time an
// estimate reads its history; it reads no `vscode`, so a stray import fails
// this build.
const ESTIMATE_HISTORY_ENTRY = 'src/host/estimator/historyEntry.ts'
const ESTIMATE_HISTORY_OUTFILE = 'dist/estimateHistory.js'
// The estimator run's composer parsing and first-wave start, loaded the
// first time an estimate parses a composer command or starts its first
// wave; it reads no `vscode`, so a stray import fails this build.
const ESTIMATE_ACTIONS_ENTRY = 'src/host/estimator/estimateActionsEntry.ts'
const ESTIMATE_ACTIONS_OUTFILE = 'dist/estimateActions.js'
const RECORDER_ENTRY = 'src/host/support/recorderEntry.ts'
const RECORDER_OUTFILE = 'dist/recorder.js'
const CREDENTIAL_LEASE_ENTRY = 'src/core/credentialLeaseEntry.ts'
const CREDENTIAL_LEASE_OUTFILE = 'dist/credentialLease.js'
const PAGE_WORKER_ENTRY = 'src/host/web/pageWorker.ts'
const PAGE_WORKER_OUTFILE = 'dist/pageWorker.js'
const PLAYBOOK_WINDOW_ENTRY = 'src/host/playbook/playbookEntry.ts'
const PLAYBOOK_WINDOW_OUTFILE = 'dist/playbook.js'
const WEBVIEW_ENTRY = 'src/webview/main.tsx'
// The Models & Agents panel's own app (M95 lane M), beside the chat.
const MODELS_WEBVIEW_ENTRY = 'src/webview/models/models.tsx'
const USAGE_WEBVIEW_ENTRY = 'src/webview/usage/usage.tsx'
const WEBVIEW_OUTDIR = 'dist/webview'
const JUDGE_P2_ENTRY = 'src/runtime/judge/judgeEntry.ts'
const JUDGE_P2_OUTFILE = 'dist/judgeP2.js'
const JUDGE_SOURCES_ENTRY = 'src/runtime/judge/judgeSourcesEntry.ts'
const JUDGE_SOURCES_OUTFILE = 'dist/judgeSources.js'
const JUDGE_LINT_ENTRY = 'src/runtime/judge/judgeLintEntry.ts'
const JUDGE_LINT_OUTFILE = 'dist/judgeLint.js'
const JUDGE_HOOK_ENTRY = 'src/runtime/judge/judgeHookEntry.ts'
const JUDGE_HOOK_OUTFILE = 'dist/judgeHook.js'
const JUDGE_LOCAL_ENTRY = 'src/runtime/judge/judgeLocalEntry.ts'
const JUDGE_LOCAL_OUTFILE = 'dist/judgeLocal.js'
const JUDGE_USES_ENTRY = 'src/runtime/judge/judgeUsesEntry.ts'
const JUDGE_USES_OUTFILE = 'dist/judgeUses.js'
const JUDGE_SERVE_ENTRY = 'src/runtime/judge/judgeServeEntry.ts'
const JUDGE_SERVE_OUTFILE = 'dist/judgeServe.js'
const JUDGE_SETUP_ENTRY = 'src/runtime/judge/judgeSetupEntry.ts'
const JUDGE_SETUP_OUTFILE = 'dist/judgeSetup.js'
const JUDGE_SETUP_DRIVER_ENTRY = 'src/host/judgeSetup/judgeSetupDriver.ts'
const JUDGE_SETUP_DRIVER_OUTFILE = 'dist/judgeSetupDriver.js'
const WHATS_NEW_PAGE_ENTRY = 'src/webview/whatsNew/main.ts'
const WHATS_NEW_PAGE_NAME = 'whatsNew'
const FONT_INSTALL_ENTRY = 'src/runtime/fonts/fontsEntry.ts'
const FONT_INSTALL_OUTFILE = 'dist/fontsInstall.js'
const ACP_ENTRY = 'src/runtime/main.ts'
const ACP_OUTFILE = 'dist/acp.js'
// M110-N: isolated runtime mode, loaded only for explicit node commands.
const NODE_ENTRY = 'src/runtime/node/main.ts'
const NODE_OUTFILE = 'dist/node.js'
// M110os RLF-MUSESETUP: the first-boot setup server, loaded only when the
// first boot runs it, so dist/node.js never carries the seed reader's YAML.
const NODE_SETUP_ENTRY = 'src/runtime/node/firstBoot/setupEntry.ts'
const NODE_SETUP_OUTFILE = 'dist/nodeSetup.js'
// RLF-NODESERVE: `serve` loads these two beside node.js when it starts.
const NODE_SERVE_ENTRY = 'src/runtime/node/serveEntry.ts'
const NODE_SERVE_OUTFILE = 'dist/nodeServe.js'
const NODE_AUTH_ENTRY = 'src/runtime/node/auth/entry.ts'
const NODE_AUTH_OUTFILE = 'dist/nodeAuth.js'
const SCHEDULE_BACKGROUND_ENTRY = 'src/runtime/schedules/backgroundEntry.ts'
const SCHEDULE_BACKGROUND_OUTFILE = 'dist/scheduleBackground.js'
const ACP_QUESTIONS_ENTRY = 'src/acp/questionDeferralEntry.ts'
const ACP_QUESTIONS_OUTFILE = 'dist/acpQuestions.js'
const RUNTIME_QUESTIONS_ENTRY = 'src/runtime/questions/questionRegistryEntry.ts'
const RUNTIME_QUESTIONS_OUTFILE = 'dist/runtimeQuestions.js'
const APPROVAL_MODES_ENTRY = 'src/core/backends/musecode/approvalModesEntry.ts'
const APPROVAL_MODES_OUTFILE = 'dist/approvalModes.js'
const PLAYBOOK_ENTRY = 'src/runtime/playbook/playbookEntry.ts'
const PLAYBOOK_OUTFILE = 'dist/acpPlaybook.js'
const WATCHDOG_ENTRY = 'src/runtime/watchdog/watchdogEntry.ts'
const WATCHDOG_OUTFILE = 'dist/acpWatchdog.js'
const RUNTIME_ACCOUNTS_ENTRY = 'src/runtime/providers/accountsEntry.ts'
const RUNTIME_ACCOUNTS_OUTFILE = 'dist/runtimeAccounts.js'
// M110t TP2: the pack index verifier (Sigstore's verification packages),
// loaded on the first pack fetch.
const PACKS_VERIFY_ENTRY = 'src/runtime/node/packs/verifyEntry.ts'
const PACKS_VERIFY_OUTFILE = 'dist/packsVerify.js'
// C-M109-1 (lead decision 5): the vault for the CLI, the ACP agent and
// headless runs, loaded on the first vault need; no `vscode` import.
const VAULT_RUNTIME_ENTRY = 'src/runtime/vault/vaultRuntimeEntry.ts'
const VAULT_RUNTIME_OUTFILE = 'dist/vaultRuntime.js'
const INTEGRATION_TEST_OUTDIR = 'dist/test/integration'
// M95 (PLAN.md D74): exact catalogue values, with no provider runtime logic.
// The data module uses the same verified solid archive loader as lazy bundles.
const PROVIDER_CATALOG_OUTFILE = 'dist/providerCatalog.json'
const PROVIDER_CATALOG_MODULE = 'dist/providerCatalog.js'
// The extension host of the oldest VS Code the manifest accepts: 1.99 runs
// Node 20.18 (PLAN.md M62). The ACP agent runs on the user's own Node 22.
// Recorded normal-build floor (check-host-api); the profile selects the variant.
const HOST_NODE_TARGET = 'node20.18'
const AGENT_NODE_TARGET = 'node22'
const BROWSER_TARGET = 'chrome128'
const hostNodeTarget = args.has('--arduino') ? profile.host : HOST_NODE_TARGET
const browserTarget = args.has('--arduino') ? profile.browser : BROWSER_TARGET
const BYTES_PER_KIB = 1024
const METAFILE_DIR = 'dist/meta'
// Hashed browser chunks from an earlier build must not enter the package.
rmSync(path.join(WEBVIEW_OUTDIR, 'chunks'), { recursive: true, force: true })

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction && 'linked',
  metafile: isProduction,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development') },
}

/** @type {import('esbuild').BuildOptions} */
const hostOptions = {
  ...common,
  plugins: [...HOST_PLUGINS],
  entryPoints: [HOST_ENTRY],
  outfile: HOST_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
  external: ['vscode'],
}

/** @type {import('esbuild').BuildOptions} */
const conversationOptions = {
  ...hostOptions,
  entryPoints: [CONVERSATION_ENTRY],
  outfile: CONVERSATION_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const scheduleSurfacesOptions = {
  ...conversationOptions,
  entryPoints: [SCHEDULE_SURFACES_ENTRY],
  outfile: SCHEDULE_SURFACES_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const verifyEditorOptions = {
  ...hostOptions,
  entryPoints: [VERIFY_EDITOR_ENTRY],
  outfile: VERIFY_EDITOR_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const makerHostOptions = {
  ...hostOptions,
  entryPoints: [MAKER_HOST_ENTRY],
  outfile: MAKER_HOST_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const makerPreviewHostOptions = {
  ...hostOptions,
  entryPoints: ['src/host/maker/makerPreviewEntry.ts'],
  outfile: 'dist/makerPreviewHost.js',
}
const sharingRuntimeOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    sharedWire,
    sharedResourceAdmission,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [SHARING_RUNTIME_ENTRY],
  outfile: SHARING_RUNTIME_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: AGENT_NODE_TARGET,
}
/** @type {import('esbuild').BuildOptions} */
const connectorOptions = {
  ...sharingRuntimeOptions,
  entryPoints: [CONNECTOR_ENTRY],
  outfile: CONNECTOR_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const connectorStoreGuardOptions = {
  ...sharingRuntimeOptions,
  entryPoints: [CONNECTOR_STORE_GUARD_ENTRY],
  outfile: CONNECTOR_STORE_GUARD_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const promptsOptions = { ...hostOptions, entryPoints: [PROMPTS_ENTRY], outfile: PROMPTS_OUTFILE }

/** @type {import('esbuild').BuildOptions} */
const modelApiOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    hardwareGuardSplit,
    sharedMakerContracts,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
    deferredTeamView,
    compressedModelText(isProduction),
  ],
  entryPoints: [MODEL_API_ENTRY],
  outfile: MODEL_API_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

const referenceOptions = {
  ...modelApiOptions,
  plugins: [...modelApiOptions.plugins, nodeReferenceData],
  entryPoints: ['src/shared/reference/referenceEntry.ts'],
  outfile: 'dist/reference.js',
}

const reportingOptions = {
  ...modelApiOptions,
  // Report Git/gh reads launch through the window's one admission
  // configuration (dist/resourceAdmission.js); an inline copy would be
  // unconfigured and carry the whole governor.
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedResourceAdmission, sharedRedaction],
  entryPoints: ['src/runtime/reporting/reportsEntry.ts'],
  outfile: 'dist/reporting.js',
}
const reportingNetworkOptions = {
  ...reportingOptions,
  entryPoints: ['src/runtime/reporting/network.ts'],
  outfile: 'dist/reportingNetwork.js',
}
const reportingDestinationsOptions = {
  ...reportingOptions,
  entryPoints: ['src/runtime/reporting/destinationsEntry.ts'],
  outfile: 'dist/reportingDestinations.js',
}
// C-M113-2: the session and usage inputs (usage journal machinery) load on
// the first session or usage report, off the reporting engine's budget.
// RLUSAGE: the journal schemas ride the shared boundaries chunk instead of
// a second inline copy, off this chunk's unchanged 100 KiB budget.
const reportInputsOptions = {
  ...reportingOptions,
  plugins: [
    sharedUiText,
    sharedValidation,
    sharedWire,
    sharedResourceAdmission,
    sharedRedaction,
    sharedModelApiBoundaries,
  ],
  entryPoints: ['src/runtime/reporting/reportInputsEntry.ts'],
  outfile: 'dist/reportInputs.js',
}
// C-M113-4: the playbook and schedules inputs (journal replay, schedule
// store) load on the first playbook, schedules or issues report. They ride their
// own chunk because the replay and store machinery would overflow the
// session/usage chunk's budget, which stays unchanged.
const playbookSchedulesInputsOptions = {
  ...reportingOptions,
  entryPoints: ['src/runtime/reporting/playbookSchedulesInputsEntry.ts'],
  outfile: 'dist/playbookSchedulesInputs.js',
}
const reportingPanelOptions = {
  ...hostOptions,
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedRedaction],
  entryPoints: ['src/host/vscode/reporting/reportPanelEntry.ts'],
  outfile: 'dist/reportingPanel.js',
}

/** @type {import('esbuild').BuildOptions} */
const modelApiBoundariesOptions = {
  ...modelApiOptions,
  entryPoints: ['src/core/nodeBoundariesEntry.ts'],
  outfile: 'dist/modelApiBoundaries.js',
  plugins: [sharedUiText, sharedValidation, compressedModelText(isProduction)],
}

/** @type {import('esbuild').BuildOptions} */
const resourceGovernorOptions = {
  ...modelApiOptions,
  entryPoints: [RESOURCE_ENTRY],
  outfile: RESOURCE_OUTFILE,
}
// RLF-BUDGETS: the Windows job-object tree reader, required the first
// time a Windows job launch binds its tree; it reads no `vscode`, so a
// stray import fails this build.
/** @type {import('esbuild').BuildOptions} */
const resourceGovernorWindowsOptions = {
  ...modelApiOptions,
  entryPoints: [RESOURCE_WINDOWS_ENTRY],
  outfile: RESOURCE_WINDOWS_OUTFILE,
}
const resourceProcessOptions = {
  ...modelApiOptions,
  entryPoints: [RESOURCE_PROCESS_ENTRY],
  outfile: RESOURCE_PROCESS_OUTFILE,
}
// INT0170: M107 W2's resource journal, shared by the governor and the usage service.
const resourceJournalOptions = {
  ...modelApiOptions,
  entryPoints: ['src/runtime/resources/resourceJournalEntry.ts'],
  outfile: 'dist/resourceJournal.js',
}
const resourceAdmissionOptions = {
  ...modelApiOptions,
  entryPoints: [RESOURCE_ADMISSION_ENTRY],
  outfile: RESOURCE_ADMISSION_OUTFILE,
}
const providersOptions = {
  ...modelApiOptions,
  entryPoints: [PROVIDERS_ENTRY],
  outfile: PROVIDERS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const configuredOptions = {
  ...modelApiOptions,
  entryPoints: [CONFIGURED_ENTRY],
  outfile: CONFIGURED_OUTFILE,
}

const subscriptionsOptions = {
  ...modelApiOptions,
  entryPoints: [SUBSCRIPTIONS_ENTRY],
  outfile: SUBSCRIPTIONS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const devicesOptions = {
  ...modelApiOptions,
  entryPoints: [DEVICES_ENTRY],
  outfile: DEVICES_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const subscriptionCommandsOptions = {
  ...modelApiOptions,
  entryPoints: [SUBSCRIPTION_COMMANDS_ENTRY],
  outfile: SUBSCRIPTION_COMMANDS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const makerOptions = {
  ...modelApiOptions,
  entryPoints: [MAKER_ENTRY],
  outfile: MAKER_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const sessionBoardOptions = {
  ...modelApiOptions,
  entryPoints: [SESSION_BOARD_ENTRY],
  outfile: SESSION_BOARD_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const approvalModesOptions = {
  ...modelApiOptions,
  entryPoints: [APPROVAL_MODES_ENTRY],
  outfile: APPROVAL_MODES_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const teamOptions = {
  ...modelApiOptions,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedModelApiBoundaries,
  ],
  entryPoints: [TEAM_ENTRY],
  outfile: TEAM_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const teamPanelOptions = {
  ...teamOptions,
  entryPoints: [TEAM_PANEL_ENTRY],
  outfile: TEAM_PANEL_OUTFILE,
}

const teamSchedulerOptions = {
  ...teamOptions,
  entryPoints: [TEAM_SCHEDULER_ENTRY],
  outfile: TEAM_SCHEDULER_OUTFILE,
}

const teamWindowOptions = {
  ...teamOptions,
  entryPoints: [TEAM_WINDOW_ENTRY],
  outfile: TEAM_WINDOW_OUTFILE,
}

const teamLandingOptions = {
  ...teamOptions,
  entryPoints: [TEAM_LANDING_ENTRY],
  outfile: TEAM_LANDING_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const teamRunnersOptions = {
  ...teamOptions,
  plugins: [...teamOptions.plugins, sharedResourceAdmission],
  entryPoints: [TEAM_RUNNERS_ENTRY],
  outfile: TEAM_RUNNERS_OUTFILE,
}

// The Muse Code backend's own bundle (PR206, PLAN.md D6): the same plugins
// as the team bundles, which already carry the host today, so what the entry
// pulls in splits the same way. RLM103: the host also carries the maker
// session guard, so it takes the guard split and shared maker contracts the
// Model API bundle uses; without them the protocol inlines here.
const museCodeOptions = {
  ...teamOptions,
  plugins: [...teamOptions.plugins, hardwareGuardSplit, sharedMakerContracts],
  entryPoints: [MUSE_CODE_ENTRY],
  outfile: MUSE_CODE_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const teamHostOptions = {
  ...teamOptions,
  entryPoints: [TEAM_HOST_ENTRY],
  outfile: TEAM_HOST_OUTFILE,
}

const teamEngineOptions = {
  ...teamOptions,
  entryPoints: ['src/host/team/teamEngineEntry.ts'],
  outfile: 'dist/teamEngine.js',
}

const execTeamOptions = {
  ...teamOptions,
  entryPoints: ['src/runtime/exec/execTeamEntry.ts'],
  outfile: 'dist/execTeam.js',
}

const execLedgerLeaseOptions = {
  ...teamOptions,
  entryPoints: ['src/runtime/exec/execLedgerLeaseEntry.ts'],
  outfile: 'dist/execLedgerLease.js',
}

const teamFileIoOptions = {
  ...teamOptions,
  entryPoints: [TEAM_FILE_IO_ENTRY],
  outfile: TEAM_FILE_IO_OUTFILE,
}

const teamCreateOptions = {
  ...modelApiOptions,
  entryPoints: ['src/core/team/workers/workerCreateEntry.ts'],
  outfile: 'dist/teamCreate.js',
}

const teamWorkerOpsOptions = {
  ...teamOptions,
  entryPoints: [TEAM_WORKER_OPS_ENTRY],
  outfile: TEAM_WORKER_OPS_OUTFILE,
}

const teamMergeOptions = {
  ...teamOptions,
  entryPoints: [TEAM_MERGE_ENTRY],
  outfile: TEAM_MERGE_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const schedulesOptions = {
  ...modelApiOptions,
  entryPoints: [SCHEDULES_ENTRY],
  outfile: SCHEDULES_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const scheduleDeliveryOptions = {
  ...schedulesOptions,
  entryPoints: [SCHEDULE_DELIVERY_ENTRY],
  outfile: SCHEDULE_DELIVERY_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const reviewerOptions = {
  ...modelApiOptions,
  entryPoints: [REVIEWER_ENTRY],
  outfile: REVIEWER_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const foreignHooksOptions = {
  ...modelApiOptions,
  entryPoints: [FOREIGN_HOOKS_ENTRY],
  outfile: FOREIGN_HOOKS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const hookRuntimeOptions = {
  ...modelApiOptions,
  entryPoints: [HOOK_RUNTIME_ENTRY],
  outfile: HOOK_RUNTIME_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const pluginHooksOptions = {
  ...modelApiOptions,
  entryPoints: [PLUGIN_HOOKS_ENTRY],
  outfile: PLUGIN_HOOKS_OUTFILE,
}

// MODELAPIDIET: the Model API backend's deferred per-call helpers (the hook
// call fields, argument previews, fetch URL checks), loaded on first use.
const MODEL_API_TOOLS_ENTRY = 'src/core/backends/modelapi/modelApiToolsEntry.ts'
const MODEL_API_TOOLS_OUTFILE = 'dist/modelApiTools.js'

/** @type {import('esbuild').BuildOptions} */
const modelApiToolsOptions = {
  ...modelApiOptions,
  entryPoints: [MODEL_API_TOOLS_ENTRY],
  outfile: MODEL_API_TOOLS_OUTFILE,
}

// The byte-range file execution (reads and edits of one byte window at any
// file size), loaded on the first range addressed call, off the per-call
// helpers' budget.
const MODEL_API_FILE_RANGE_ENTRY = 'src/core/backends/modelapi/modelApiFileRangeEntry.ts'
const MODEL_API_FILE_RANGE_OUTFILE = 'dist/modelApiFileRange.js'

/** @type {import('esbuild').BuildOptions} */
const modelApiFileRangeOptions = {
  ...modelApiOptions,
  entryPoints: [MODEL_API_FILE_RANGE_ENTRY],
  outfile: MODEL_API_FILE_RANGE_OUTFILE,
}

// The verify loop's session side (M68: the loop, its ledger and the
// diagnostics history), loaded on the first turn that verifies tool edits.
const MODEL_API_VERIFY_ENTRY = 'src/core/backends/modelapi/modelApiVerifyEntry.ts'
const MODEL_API_VERIFY_OUTFILE = 'dist/modelApiVerify.js'

/** @type {import('esbuild').BuildOptions} */
const modelApiVerifyOptions = {
  ...modelApiOptions,
  entryPoints: [MODEL_API_VERIFY_ENTRY],
  outfile: MODEL_API_VERIFY_OUTFILE,
}

// The image run-path (M34, M44: the call checks, the purchase and the
// paid-use naming), loaded on the first image call, with an attached
// image's resize to the model's bounds.
const MODEL_API_IMAGE_ENTRY = 'src/core/backends/modelapi/modelApiImageEntry.ts'
const MODEL_API_IMAGE_OUTFILE = 'dist/modelApiImage.js'

/** @type {import('esbuild').BuildOptions} */
const modelApiImageOptions = {
  ...modelApiOptions,
  entryPoints: [MODEL_API_IMAGE_ENTRY],
  outfile: MODEL_API_IMAGE_OUTFILE,
}

// The B1 hold (M125, D107 §9.3: the confined runner, the floor, the veto
// race and the skip's audit), loaded on the first shell ask that reaches
// the hold with a packaged helper.
const MODEL_API_B1_ENTRY = 'src/core/backends/modelapi/modelApiB1Entry.ts'
const MODEL_API_B1_OUTFILE = 'dist/modelApiB1.js'

/** @type {import('esbuild').BuildOptions} */
const modelApiB1Options = {
  ...modelApiOptions,
  entryPoints: [MODEL_API_B1_ENTRY],
  outfile: MODEL_API_B1_OUTFILE,
}

// What a tool call or goal command runs (the file and shell tools'
// execution with their edit helpers, the memory tool, the browser check's
// placement and report, the goal rules), loaded on the first of them.
const MODEL_API_TOOL_RUN_ENTRY = 'src/core/backends/modelapi/modelApiToolRunEntry.ts'
const MODEL_API_TOOL_RUN_OUTFILE = 'dist/modelApiToolRun.js'

/** @type {import('esbuild').BuildOptions} */
const modelApiToolRunOptions = {
  ...modelApiOptions,
  entryPoints: [MODEL_API_TOOL_RUN_ENTRY],
  outfile: MODEL_API_TOOL_RUN_OUTFILE,
}

// The fast judge's session side (M125 lane M, D107: the loop detector, the
// first-send triage, the effort and keep-list verdicts, the turn boundary),
// loaded when each turn or compaction starts.
const MODEL_API_FAST_ENTRY = 'src/core/backends/modelapi/modelApiFastEntry.ts'
const MODEL_API_FAST_OUTFILE = 'dist/modelApiFast.js'

/** @type {import('esbuild').BuildOptions} */
const modelApiFastOptions = {
  ...modelApiOptions,
  entryPoints: [MODEL_API_FAST_ENTRY],
  outfile: MODEL_API_FAST_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const reviewOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [REVIEW_ENTRY],
  outfile: REVIEW_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

// The report dialog's bundle (M93) takes the editor's clipboard, browser and
// save picker as a parameter: it imports no `vscode`, which is not external
// there, so a stray import fails this build.
/** @type {import('esbuild').BuildOptions} */
const reportOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [REPORT_ENTRY],
  outfile: REPORT_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

// Lane REPORTFLOW R2: the editor-native fallback. It reads `vscode` (kept
// external, provided by the host, as for the other host bundles), so a stray
// import of anything activation-only fails the split gate instead.
/** @type {import('esbuild').BuildOptions} */
const reportFallbackOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
  ],
  entryPoints: [REPORT_FALLBACK_ENTRY],
  outfile: REPORT_FALLBACK_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
  external: ['vscode'],
}

// The capacity estimator's engine (M117, PLAN.md D97), loaded the first
// time an estimate runs; it reads no `vscode` and no backend, so a stray
// import fails this build.
/** @type {import('esbuild').BuildOptions} */
const estimatorOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire],
  entryPoints: [ESTIMATOR_ENTRY],
  outfile: ESTIMATOR_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

// The estimator run's composer parsing and first-wave start, loaded the
// first time one is used; it reads no `vscode`, so a stray import fails
// this build.
/** @type {import('esbuild').BuildOptions} */
const estimateActionsOptions = {
  ...estimatorOptions,
  entryPoints: [ESTIMATE_ACTIONS_ENTRY],
  outfile: ESTIMATE_ACTIONS_OUTFILE,
}

// The estimator's plan snapshot (M117 C-M117-1, PLAN.md D6, D97), loaded the
// first time an estimate needs a plan snapshot; it reads no `vscode`, so a
// stray import fails this build.
/** @type {import('esbuild').BuildOptions} */
const planSnapshotOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire],
  entryPoints: [PLAN_SNAPSHOT_ENTRY],
  outfile: PLAN_SNAPSHOT_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

// The estimator's price port (M117 C-M117-4, PLAN.md D6), loaded the first
// time an estimate looks prices up; it reads no `vscode`, so a stray import
// fails this build. The report redaction it scrubs with is shared with the
// reporting bundles rather than copied in.
/** @type {import('esbuild').BuildOptions} */
const estimateHistoryOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation],
  entryPoints: [ESTIMATE_HISTORY_ENTRY],
  outfile: ESTIMATE_HISTORY_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const estimatePricesOptions = {
  ...common,
  // Like the reporting bundles: governed launches go through the window's one
  // admission configuration (dist/resourceAdmission.js); an inline copy would
  // be unconfigured and carry the whole governor. Redaction stays shared too.
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedResourceAdmission, sharedRedaction],
  entryPoints: [ESTIMATE_PRICES_ENTRY],
  outfile: ESTIMATE_PRICES_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

// The flight recorder's journal (M93), loaded just after activation or at
// the first failure; it reads no `vscode`, so a stray import fails here.
/** @type {import('esbuild').BuildOptions} */
const recorderOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [RECORDER_ENTRY],
  outfile: RECORDER_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

// The credential lease (M95 D74), required on the first guarded credential
// write or Connect recovery; it reads no `vscode`, so a stray import fails
// here.
/** @type {import('esbuild').BuildOptions} */
const credentialLeaseOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
  ],
  entryPoints: [CREDENTIAL_LEASE_ENTRY],
  outfile: CREDENTIAL_LEASE_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const planMarkdownOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [PLAN_MARKDOWN_ENTRY],
  outfile: PLAN_MARKDOWN_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

// Neither imports `vscode`, so it is not external there and a stray import
// fails this build, as for the Model API backend.
/** @type {import('esbuild').BuildOptions} */
const legalScanOptions = {
  ...planMarkdownOptions,
  entryPoints: [LEGAL_SCAN_ENTRY],
  outfile: LEGAL_SCAN_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const legalFixOptions = {
  ...legalScanOptions,
  entryPoints: [LEGAL_FIX_ENTRY],
  outfile: LEGAL_FIX_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const codeIntelOptions = {
  ...planMarkdownOptions,
  entryPoints: [CODE_INTEL_ENTRY],
  outfile: CODE_INTEL_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const voiceOptions = {
  ...planMarkdownOptions,
  entryPoints: [VOICE_ENTRY],
  outfile: VOICE_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const voiceLinuxOptions = {
  ...planMarkdownOptions,
  entryPoints: [VOICE_LINUX_ENTRY],
  outfile: VOICE_LINUX_OUTFILE,
}

// Voice dictation's setups (M9, M35): the window's dictation and Muse Voice
// setups with the helper probes, required at their existing construction
// points. It reads no `vscode`, so a stray import fails this build.
/** @type {import('esbuild').BuildOptions} */
const dictationOptions = {
  ...planMarkdownOptions,
  entryPoints: [DICTATION_ENTRY],
  outfile: DICTATION_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const webFetchOptions = {
  ...planMarkdownOptions,
  entryPoints: [WEB_FETCH_ENTRY],
  outfile: WEB_FETCH_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const mcpVaultOptions = {
  ...planMarkdownOptions,
  entryPoints: [MCP_VAULT_ENTRY],
  outfile: MCP_VAULT_OUTFILE,
}

// No `vscode`: the extension and the ACP agent load the same account consent.
/** @type {import('esbuild').BuildOptions} */
const accountPaidOptions = {
  ...planMarkdownOptions,
  entryPoints: [ACCOUNT_PAID_ENTRY],
  outfile: ACCOUNT_PAID_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const modelEffortsOptions = {
  ...planMarkdownOptions,
  entryPoints: [MODEL_EFFORTS_ENTRY],
  outfile: MODEL_EFFORTS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const museCodeReviewerOptions = {
  ...planMarkdownOptions,
  entryPoints: [MUSE_CODE_REVIEWER_ENTRY],
  outfile: MUSE_CODE_REVIEWER_OUTFILE,
}

// What's New's tab uses `vscode` (the webview panel, openExternal, the
// commands), which the host provides, as for the import.
/** @type {import('esbuild').BuildOptions} */
const whatsNewOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [WHATS_NEW_ENTRY],
  outfile: WHATS_NEW_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: hostNodeTarget,
}

const usageServiceOptions = {
  ...modelApiOptions,
  entryPoints: [USAGE_SERVICE_ENTRY],
  outfile: 'dist/usageService.js',
}
// RLUSAGE: the usage export encoders (CSV, JSON), required by the service
// on the first export, off its 100 KiB budget (PLAN.md D6).
const usageExportOptions = {
  ...modelApiOptions,
  entryPoints: [USAGE_EXPORT_ENTRY],
  outfile: 'dist/usageExport.js',
}
const usageCompanionOptions = {
  ...modelApiOptions,
  entryPoints: [USAGE_COMPANION_ENTRY],
  outfile: 'dist/usageCompanion.js',
}
const voiceCompanionOptions = {
  ...modelApiOptions,
  entryPoints: ['src/runtime/companion/voiceEntry.ts'],
  outfile: 'dist/voiceCompanion.js',
}
const voiceCompanionWebviewOptions = {
  ...common,
  plugins: isProduction ? [compactBrowserUiText] : [],
  entryPoints: ['src/webview/voice/companion.ts'],
  outfile: 'dist/webview/voiceCompanion.js',
  platform: 'browser',
  format: 'esm',
  target: BROWSER_TARGET,
}
const usagePanelOptions = {
  ...hostOptions,
  entryPoints: [USAGE_PANEL_ENTRY],
  outfile: 'dist/usagePanel.js',
}

const extensionHooksOptions = {
  ...modelApiOptions,
  entryPoints: [EXTENSION_HOOKS_ENTRY],
  outfile: EXTENSION_HOOKS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const judgeP2Options = {
  ...planMarkdownOptions,
  entryPoints: [JUDGE_P2_ENTRY],
  outfile: JUDGE_P2_OUTFILE,
}

const judgeSourcesOptions = {
  ...judgeP2Options,
  plugins: [...judgeP2Options.plugins, deferredCohort],
  entryPoints: [JUDGE_SOURCES_ENTRY],
  outfile: JUDGE_SOURCES_OUTFILE,
}

const judgeLintOptions = {
  ...judgeP2Options,
  entryPoints: [JUDGE_LINT_ENTRY],
  outfile: JUDGE_LINT_OUTFILE,
}
const judgeLocalOptions = {
  ...judgeP2Options,
  entryPoints: [JUDGE_LOCAL_ENTRY],
  outfile: JUDGE_LOCAL_OUTFILE,
}
const judgeUsesOptions = {
  ...judgeP2Options,
  entryPoints: [JUDGE_USES_ENTRY],
  outfile: JUDGE_USES_OUTFILE,
}
const judgeHookOptions = {
  ...judgeP2Options,
  entryPoints: [JUDGE_HOOK_ENTRY],
  outfile: JUDGE_HOOK_OUTFILE,
}
const judgeServeOptions = {
  ...judgeP2Options,
  entryPoints: [JUDGE_SERVE_ENTRY],
  outfile: JUDGE_SERVE_OUTFILE,
}
const judgeSetupOptions = {
  ...judgeP2Options,
  entryPoints: [JUDGE_SETUP_ENTRY],
  outfile: JUDGE_SETUP_OUTFILE,
}
const judgeSetupDriverOptions = {
  ...judgeP2Options,
  entryPoints: [JUDGE_SETUP_DRIVER_ENTRY],
  outfile: JUDGE_SETUP_DRIVER_OUTFILE,
}

const judgeOptions = {
  ...planMarkdownOptions,
  entryPoints: [JUDGE_ENTRY],
  outfile: JUDGE_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const modelsPanelOptions = {
  ...common,
  // The redaction, vault and money modules come from the shared boundary
  // chunks every other Node consumer reads, not a copy of their own.
  plugins: [sharedUiText, sharedValidation, deferredCohort, sharedModelApiBoundaries],
  entryPoints: [MODELS_PANEL_ENTRY],
  outfile: MODELS_PANEL_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const authOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire],
  entryPoints: [AUTH_ENTRY],
  outfile: AUTH_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const paidOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire],
  entryPoints: [PAID_ENTRY],
  outfile: PAID_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}
const modelsSubscriptionsOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, deferredCohort],
  entryPoints: [MODELS_SUBSCRIPTIONS_ENTRY],
  outfile: MODELS_SUBSCRIPTIONS_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const editorChatOptions = {
  ...modelsPanelOptions,
  entryPoints: [EDITOR_CHAT_ENTRY],
  outfile: EDITOR_CHAT_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const agentImportOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [AGENT_IMPORT_ENTRY],
  outfile: AGENT_IMPORT_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: hostNodeTarget,
}

/** @type {import('esbuild').BuildOptions} */
const vaultOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    sharedWire,
    sharedModelApiBoundaries,
    deferredCohort,
    sharedResourceAdmission,
    sharedVaultStore,
    sharedVaultPosix,
    sharedVaultWindows,
  ],
  entryPoints: [VAULT_ENTRY],
  outfile: VAULT_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
// RVAPP-CM1091D5 BYTES: the vault's explicit-action code, loaded on the first
// action that needs it. Same shape as the opening bundle above.
const vaultActionsOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedModelApiBoundaries],
  entryPoints: [VAULT_ACTIONS_ENTRY],
  outfile: VAULT_ACTIONS_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
// The key-store migration's own chunk, loaded on the first unlock edge.
// Same shape as the explicit-action bundle above.
const vaultMigrationOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedModelApiBoundaries],
  entryPoints: [VAULT_MIGRATION_ENTRY],
  outfile: VAULT_MIGRATION_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const tabOptions = {
  ...agentImportOptions,
  entryPoints: [TAB_ENTRY],
  outfile: TAB_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const bundledSkillsOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [BUNDLED_SKILLS_ENTRY],
  outfile: BUNDLED_SKILLS_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

/** @type {import('esbuild').BuildOptions} */
const searchWorkerOptions = {
  ...common,
  plugins: [sharedValidation],
  entryPoints: [SEARCH_WORKER_ENTRY],
  outfile: SEARCH_WORKER_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

/** @type {import('esbuild').BuildOptions} */
const imageResizeWorkerOptions = {
  ...searchWorkerOptions,
  plugins: [sharedUiText, sharedValidation],
  entryPoints: [IMAGE_RESIZE_WORKER_ENTRY],
  outfile: IMAGE_RESIZE_WORKER_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const conversationGitOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [CONVERSATION_GIT_ENTRY],
  outfile: CONVERSATION_GIT_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: hostNodeTarget,
}

// The Model API backend's session store (D14), required when its host is
// first built: the store, its budget journal and the stored-session schemas.
/** @type {import('esbuild').BuildOptions} */
const modelApiSessionsOptions = {
  ...conversationGitOptions,
  entryPoints: [MODEL_API_SESSIONS_ENTRY],
  outfile: MODEL_API_SESSIONS_OUTFILE,
}

// CONVBUDGET: the conversation's session-transfer flows, required on the
// first export, import or share-file preview. They read no `vscode`: the
// dialogs stay injected by the controller.
/** @type {import('esbuild').BuildOptions} */
const conversationTransferOptions = {
  ...conversationGitOptions,
  entryPoints: [CONVERSATION_TRANSFER_ENTRY],
  outfile: CONVERSATION_TRANSFER_OUTFILE,
}

// The Create AGENTS.md command (D15), required when that command runs: the
// command, the rules template and their redaction.
/** @type {import('esbuild').BuildOptions} */
const rulesFileOptions = {
  ...conversationGitOptions,
  entryPoints: [RULES_FILE_ENTRY],
  outfile: RULES_FILE_OUTFILE,
}
// M123's native Git route (D104), required by the conversation Git bundle the
// first time a conversation opens in a host without `vscode.git`: the
// runtime Git adapter, its service, the repository lease and the runtime's
// pull requests.
/** @type {import('esbuild').BuildOptions} */
const nativeGitOptions = {
  ...conversationGitOptions,
  entryPoints: [NATIVE_GIT_ENTRY],
  outfile: NATIVE_GIT_OUTFILE,
}

// ACTIVATIONROOM: the CLI-backed and workspace command flows, required on
// the first of those commands. They import no `vscode`, which is not
// external there, so a stray import fails this build.
/** @type {import('esbuild').BuildOptions} */
const commandsOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
  ],
  entryPoints: [COMMANDS_ENTRY],
  outfile: COMMANDS_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

// The guarded process-start layer (PLAN.md D24), required beside activation
// by every Node bundle that starts a program or builds a child environment:
// its own build carries it (the shared plugin stands down for this outfile).
/** @type {import('esbuild').BuildOptions} */
const execGuardOptions = {
  ...conversationGitOptions,
  entryPoints: [EXEC_GUARD_ENTRY],
  outfile: EXEC_GUARD_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const checkpointStoreOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [CHECKPOINT_STORE_ENTRY],
  outfile: CHECKPOINT_STORE_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

const hardwareGuardOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    sharedModelApiBoundaries,
    hardwareShellSplit,
    sharedMakerContracts,
    hardwareConstantTables,
  ],
  entryPoints: [HARDWARE_GUARD_ENTRY],
  outfile: HARDWARE_GUARD_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

const hardwareShellOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, hardwareConstantTables],
  entryPoints: ['src/core/maker/shellEntry.ts'],
  outfile: 'dist/hardwareShell.js',
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const mediaOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire],
  entryPoints: [MEDIA_ENTRY],
  outfile: MEDIA_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const mediaHostOptions = {
  ...common,
  // The latest-recording preview starts Windows PowerShell through the
  // guarded layer, which every Node bundle requires instead of carrying.
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedExecGuard],
  entryPoints: [MEDIA_HOST_ENTRY],
  outfile: MEDIA_HOST_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const toolRangeOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire],
  entryPoints: [TOOL_RANGE_ENTRY],
  outfile: TOOL_RANGE_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const screenRecordOptions = {
  ...common,
  // M105 RLF-RECORDING: the bound drivers reach the process launcher, the
  // child-environment guard, the secret scrubber and the media sniffer;
  // all four ship once in their lazy owners, never copied here.
  plugins: [
    sharedUiText,
    sharedValidation,
    sharedWire,
    deferredCohort,
    sharedResourceAdmission,
    sharedExecGuard,
    sharedRedaction,
  ],
  entryPoints: [SCREEN_RECORD_ENTRY],
  outfile: SCREEN_RECORD_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
// M105 RLF-RECORDING: the drivers' own bundle (see screenRecordOptions).
const screenRecordDriversOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    sharedWire,
    deferredCohort,
    sharedResourceAdmission,
    sharedExecGuard,
    sharedRedaction,
  ],
  entryPoints: [SCREEN_RECORD_DRIVERS_ENTRY],
  outfile: SCREEN_RECORD_DRIVERS_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const browserCheckOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [BROWSER_CHECK_ENTRY],
  outfile: BROWSER_CHECK_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

/** @type {import('esbuild').BuildOptions} */
const browserRuntimeOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    sharedExecGuard,
  ],
  entryPoints: [BROWSER_RUNTIME_ENTRY],
  outfile: BROWSER_RUNTIME_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

/** @type {import('esbuild').BuildOptions} */
const acpOptions = {
  ...common,
  // These artifacts run only in Node; the SDK's browser sniff must not touch its navigator getter.
  define: { ...common.define, navigator: 'undefined' },
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    hardwareGuardSplit,
    sharedResourceAdmission,
    sharedStructuredSchema,
    deferredTeamView,
    sharedModelApiBoundaries,
    sharedExecGuard,
    englishZodLocales,
  ],
  entryPoints: [ACP_ENTRY],
  outfile: ACP_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: AGENT_NODE_TARGET,
  external: ['@napi-rs/keyring'],
  banner: { js: '#!/usr/bin/env node' },
}

const headlessOptions = {
  ...acpOptions,
  entryPoints: ['src/runtime/exec/runExec.ts'],
  outfile: 'dist/headless.js',
  banner: undefined,
}

/** @type {import('esbuild').BuildOptions} */
const acpQuestionsOptions = {
  ...acpOptions,
  entryPoints: [ACP_QUESTIONS_ENTRY],
  outfile: ACP_QUESTIONS_OUTFILE,
  banner: {},
}
const runtimeQuestionsOptions = {
  ...acpQuestionsOptions,
  entryPoints: [RUNTIME_QUESTIONS_ENTRY],
  outfile: RUNTIME_QUESTIONS_OUTFILE,
}
// M103 R: native/runtime maker work is absent from ACP and activation startup.
const runtimeMakerOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    sharedWire,
    sharedResourceAdmission,
    sharedModelApiBoundaries,
    hardwareShellSplit,
    deferredCohort,
    sharedMakerContracts,
  ],
  entryPoints: ['src/runtime/maker/entry.ts'],
  outfile: 'dist/runtimeMaker.js',
  platform: 'node',
  format: 'cjs',
  target: AGENT_NODE_TARGET,
}
const mcpPoolOptions = {
  ...modelApiOptions,
  entryPoints: ['src/core/backends/modelapi/mcpPoolEntry.ts'],
  outfile: 'dist/mcpPool.js',
}
const execOptions = {
  ...acpOptions,
  entryPoints: ['src/runtime/exec/execEntry.ts'],
  outfile: 'dist/exec.js',
  banner: {},
}
// RLTESTDRIVE item 5: the provider's live model list for headless runs,
// beside dist/headless.js so the runner's budget holds.
const providerListOptions = {
  ...acpOptions,
  entryPoints: ['src/runtime/exec/providerListEntry.ts'],
  outfile: 'dist/providerList.js',
  banner: {},
}
const modelApiCodeIntelOptions = {
  ...modelApiOptions,
  entryPoints: ['src/core/backends/modelapi/codeIntelEntry.ts'],
  outfile: 'dist/modelApiCodeIntel.js',
}
const structuredSchemaOptions = {
  ...modelApiOptions,
  plugins: [sharedValidation],
  entryPoints: ['src/shared/structuredSchemaEntry.ts'],
  outfile: 'dist/structuredSchema.js',
}
const fontInstallOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation],
  entryPoints: [FONT_INSTALL_ENTRY],
  outfile: FONT_INSTALL_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: AGENT_NODE_TARGET,
}
const scheduleBackgroundOptions = {
  ...modelApiOptions,
  entryPoints: [SCHEDULE_BACKGROUND_ENTRY],
  outfile: SCHEDULE_BACKGROUND_OUTFILE,
  target: AGENT_NODE_TARGET,
}
const playbookOptions = {
  ...acpQuestionsOptions,
  entryPoints: [PLAYBOOK_ENTRY],
  outfile: PLAYBOOK_OUTFILE,
}
const watchdogOptions = {
  ...acpQuestionsOptions,
  entryPoints: [WATCHDOG_ENTRY],
  outfile: WATCHDOG_OUTFILE,
}
const runtimeAccountsOptions = {
  ...acpQuestionsOptions,
  entryPoints: [RUNTIME_ACCOUNTS_ENTRY],
  outfile: RUNTIME_ACCOUNTS_OUTFILE,
}
const packsVerifyOptions = {
  ...acpQuestionsOptions,
  entryPoints: [PACKS_VERIFY_ENTRY],
  outfile: PACKS_VERIFY_OUTFILE,
}
const vaultRuntimeOptions = {
  ...acpQuestionsOptions,
  plugins: [...acpQuestionsOptions.plugins, sharedVaultStore, sharedVaultPosix, sharedVaultWindows],
  entryPoints: [VAULT_RUNTIME_ENTRY],
  outfile: VAULT_RUNTIME_OUTFILE,
}
const nodeOptions = {
  ...acpOptions,
  entryPoints: [NODE_ENTRY],
  outfile: NODE_OUTFILE,
  banner: {},
}
const nodeServeOptions = {
  ...acpOptions,
  entryPoints: [NODE_SERVE_ENTRY],
  outfile: NODE_SERVE_OUTFILE,
  banner: {},
}
const nodeAuthOptions = {
  ...acpOptions,
  entryPoints: [NODE_AUTH_ENTRY],
  outfile: NODE_AUTH_OUTFILE,
  banner: {},
}

const nodeSetupOptions = {
  ...acpOptions,
  entryPoints: [NODE_SETUP_ENTRY],
  outfile: NODE_SETUP_OUTFILE,
  banner: {},
}

// M104 lane H: the language server (`lsp`), and the supervised runs
// (`supervise`, `stop`, the server's `muse.stop`), each loaded only by its
// own commands; dist/acp.js keeps their loaders alone.
const LSP_OUTFILE = 'dist/lsp.js'
const lspOptions = {
  ...acpOptions,
  entryPoints: ['src/runtime/lsp/lspEntry.ts'],
  outfile: LSP_OUTFILE,
  banner: {},
}
const SUPERVISE_OUTFILE = 'dist/supervise.js'
const superviseOptions = {
  ...acpOptions,
  entryPoints: ['src/runtime/supervise/superviseEntry.ts'],
  outfile: SUPERVISE_OUTFILE,
  banner: {},
}
// M104 lane B: the runtime panel (`panel`), loaded only by that command;
// dist/acp.js keeps its loader alone.
const RUNTIME_PANEL_OUTFILE = 'dist/runtimePanel.js'
const runtimePanelOptions = {
  ...acpOptions,
  entryPoints: ['src/runtime/panel/panelEntry.ts'],
  outfile: RUNTIME_PANEL_OUTFILE,
  banner: {},
}
// Its conversations, loaded by `runtimePanel.js` once the handshake is done.
const RUNTIME_PANEL_SESSION_OUTFILE = 'dist/runtimePanelSession.js'
const runtimePanelSessionOptions = {
  ...acpOptions,
  entryPoints: ['src/runtime/panel/sessionEntry.ts'],
  outfile: RUNTIME_PANEL_SESSION_OUTFILE,
  banner: {},
}
// Its heavier ports (saved plans), required the first time one is used.
const RUNTIME_PANEL_PORTS_OUTFILE = 'dist/runtimePanelPorts.js'
const runtimePanelPortsOptions = {
  ...acpOptions,
  entryPoints: ['src/runtime/panel/portsEntry.ts'],
  outfile: RUNTIME_PANEL_PORTS_OUTFILE,
  banner: {},
}

// Keep the production Node fallback under its existing cap; runtime values
// are the same table. Browser and development outputs retain their inline text.
const { L10N_COMPRESSION_QUALITY } = await loadL10n(process.cwd())
/** @type {import('esbuild').BuildOptions} */
const uiTextOptions = {
  ...common,
  plugins: [
    regionalUiText(),
    compressedEnglish(UI_TEXT_OUTFILE, isProduction, L10N_COMPRESSION_QUALITY),
  ],
  entryPoints: [UI_TEXT_ENTRY],
  outfile: UI_TEXT_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

const uiTextRegionOptions = UI_TEXT_REGIONS.map((region) => ({
  ...uiTextOptions,
  plugins: [
    regionalUiText(region.name),
    compressedEnglish(region.output, isProduction, L10N_COMPRESSION_QUALITY),
  ],
  outfile: region.output,
}))

const validationOptions = {
  ...uiTextOptions,
  plugins: [],
  entryPoints: [VALIDATION_ENTRY],
  outfile: VALIDATION_OUTFILE,
}

const vaultBrokerOptions = {
  ...modelApiOptions,
  plugins: [...modelApiOptions.plugins, sharedVaultStore],
  entryPoints: ['src/runtime/vault/vaultBrokerEntry.ts'],
  outfile: 'dist/vaultBroker.js',
  external: ['@napi-rs/keyring'],
}

const vaultPosixOptions = {
  ...modelApiOptions,
  plugins: [...modelApiOptions.plugins, sharedVaultStore],
  entryPoints: ['src/runtime/vault/posixEntry.ts'],
  outfile: 'dist/vaultPosix.js',
}

const vaultWindowsOptions = {
  ...modelApiOptions,
  plugins: [...modelApiOptions.plugins, sharedVaultStore],
  entryPoints: ['src/runtime/vault/windowsEntry.ts'],
  outfile: 'dist/vaultWindows.js',
}

const vaultStoreOptions = {
  ...modelApiOptions,
  entryPoints: ['src/runtime/vault/storeEntry.ts'],
  outfile: 'dist/vaultStore.js',
}

const vaultBrokerBindingsOptions = {
  ...vaultBrokerOptions,
  entryPoints: ['src/runtime/vault/brokerBindings.ts'],
  outfile: 'dist/vaultBrokerBindings.js',
}

const vaultBoundariesOptions = {
  ...modelApiOptions,
  plugins: [sharedUiText, sharedValidation],
  entryPoints: ['src/shared/vaultBoundariesEntry.ts'],
  outfile: 'dist/vaultBoundaries.js',
}

const estimateContractsOptions = {
  ...modelApiOptions,
  // Typed refusals reuse the shipped scrubber instead of copying it into contracts.
  plugins: [sharedUiText, sharedValidation, sharedRedaction],
  entryPoints: ['src/shared/estimateContractsEntry.ts'],
  outfile: 'dist/estimateContracts.js',
}

const validationSchemaOptions = {
  ...validationOptions,
  entryPoints: ['src/host/validationSchemaEntry.ts'],
  outfile: 'dist/validationSchema.js',
}

const wireOptions = {
  ...modelApiOptions,
  plugins: [sharedUiText, sharedValidation, deferredTeamView, sharedModelApiBoundaries],
  entryPoints: ['src/shared/wireEntry.ts'],
  outfile: 'dist/wire.js',
}

/** @type {import('esbuild').BuildOptions} */
const pageWorkerOptions = {
  ...common,
  plugins: [sharedValidation],
  entryPoints: [PAGE_WORKER_ENTRY],
  outfile: PAGE_WORKER_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
}

// The VS Code window's playbook (M116 lane C-M116-6, PLAN.md D6, D96): the
// window's client when required on first use, and the governor when that
// client starts the same file as a worker thread. The policy, its journal and
// the Windows job runner ship once, here, and never at activation. Git and
// hook calls launch through the shared admission and redaction bundles.
/** @type {import('esbuild').BuildOptions} */
const playbookWindowOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedResourceAdmission, sharedRedaction],
  entryPoints: [PLAYBOOK_WINDOW_ENTRY],
  outfile: PLAYBOOK_WINDOW_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

// The canonical comment template must stay with ReviewCommentForm when other pages
// share constants. Build a reader-only module from its exact source declaration.
const browserReviewComment = {
  name: 'browser-review-comment',
  setup(build) {
    const name = 'browser-review-comment'
    build.onResolve({ filter: /^browser-review-comment$/ }, () => ({ path: name, namespace: name }))
    build.onLoad({ filter: /.*/, namespace: name }, () => {
      const source = readFileSync('src/shared/constants.ts', 'utf8')
      const declaration = /export const REVIEW_COMMENT_MODEL_TEXT = \{[\s\S]*?\} as const/.exec(
        source,
      )?.[0]
      if (!declaration) throw new Error('Missing canonical review comment text')
      return { contents: declaration, loader: 'ts', watchFiles: ['src/shared/constants.ts'] }
    })
    build.onLoad({ filter: /[/\\]components[/\\]ReviewCommentForm\.tsx$/ }, (args) => ({
      contents: `import { REVIEW_COMMENT_MODEL_TEXT } from '${name}';\n${readCompiledSource(args.path).replace('  REVIEW_COMMENT_MODEL_TEXT,\n', '')}`,
      loader: 'tsx',
      resolveDir: path.dirname(args.path),
      watchFiles: [args.path],
    }))
  },
}

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  ...common,
  // Complete licences ship in the gated THIRD_PARTY_NOTICES, not repeated banners.
  legalComments: isProduction ? 'none' : 'eof',
  plugins: [
    sharedHighlightGrammar,
    ...(isProduction ? [compactBrowserUiText] : []),
    ...(isProduction ? [browserConstantTables] : []),
    ...(isProduction ? [lazyBrowserKeybindings] : []),
    browserReviewComment,
    resourceBrowserValidation,
    teamPanelBrowserValidation,
    // M114 C-M114-1: the companion page's static theme sheets beside the
    // webview entries, rebuilt with every webview build including watch.
    companionThemeCssPlugin,
    isolateMakerValidation,
    {
      name: 'reference-caller-react',
      setup(build) {
        build.onLoad({ filter: /[/\\]ReferencePage\.tsx$/ }, async (args) => {
          const result = await esbuild.transform(readCompiledSource(args.path), {
            loader: 'tsx',
            jsx: 'transform',
            jsxFactory: 'React.createElement',
            jsxFragment: 'React.Fragment',
          })
          return { contents: result.code, loader: 'js', resolveDir: path.dirname(args.path) }
        })
      },
    },
  ],
  charset: 'utf8',
  entryPoints: {
    main: WEBVIEW_ENTRY,
    resourceSurface: 'src/webview/resources/ResourceSurface.tsx',
    resourceHistory: 'src/webview/usage/ResourcesSection.tsx',
    models: MODELS_WEBVIEW_ENTRY,
    usage: USAGE_WEBVIEW_ENTRY,
    judgeSetup: 'src/webview/judgeSetup/main.tsx',
    referencePage: 'src/webview/components/ReferencePage.tsx',
    [WHATS_NEW_PAGE_NAME]: WHATS_NEW_PAGE_ENTRY,
    reportingPage: 'src/webview/reporting/main.tsx',
    reportingDestinations: 'src/webview/reporting/destinations/DestinationPicker.tsx',
  },
  outdir: WEBVIEW_OUTDIR,
  platform: 'browser',
  format: 'esm',
  splitting: true,
  // STARTDIET: content hashes identify chunks; repeated names inflate every import.
  chunkNames: 'chunks/[hash]',
  target: browserTarget,
  jsx: 'automatic',
}

const makerPreviewOptions = {
  ...webviewOptions,
  splitting: false,
  entryPoints: { makerPreview: 'src/webview/maker/previewMain.ts' },
}

// M97 CM971-R3: SHA-256 hashes beside each bundle metafile (record
// version 2), so the legal scanner proves artifact freshness from bytes,
// never from file names. Every hash comes from the build itself: the
// exact source bytes esbuild or a plugin compiled (raw bytes, text or
// binary, as the scanner hashes them), and under `generated` the contents
// a plugin handed esbuild for a generated module or a transformed file.
// Anything the build could not attribute stays unrecorded and is named by
// the scanner. Output hashes cover the files esbuild just wrote, and an
// output whose size disagrees with the metafile stays unrecorded. A
// separate folder keeps third-party-notices (which reads every file in
// dist/meta/) untouched; like dist/meta/, it is not packaged.
const META_HASHES_DIR = 'dist/meta-hashes'
function writeMetafileHashes(name, metafile, buildRecord) {
  const { inputs, generated } = compiledRecordFor(Object.keys(metafile.inputs ?? {}), buildRecord)
  const outputs = {}
  const listedOutputs = Object.entries(metafile.outputs ?? {})
  for (const [output, meta] of listedOutputs) {
    let bytes
    try {
      bytes = readFileSync(output)
    } catch {
      continue
    }
    if (bytes.byteLength !== meta.bytes) continue
    outputs[output.replaceAll('\\', '/')] = createHash('sha256').update(bytes).digest('hex')
  }
  writeFileSync(
    path.join(META_HASHES_DIR, `${name}.json`),
    JSON.stringify({ version: 2, inputs, outputs, generated }),
  )
}

function writeWebviewMetafiles(metafile, buildRecord) {
  const pages = {
    webview: 'dist/webview/main.js',
    modelsWebview: 'dist/webview/models.js',
    whatsNewPage: 'dist/webview/whatsNew.js',
    usageWebview: 'dist/webview/usage.js',
    judgeSetupWebview: 'dist/webview/judgeSetup.js',
    referencePage: 'dist/webview/referencePage.js',
    resourceSurface: 'dist/webview/resourceSurface.js',
    resourceHistory: 'dist/webview/resourceHistory.js',
    reportingPageWebview: 'dist/webview/reportingPage.js',
    reportingDestinationsWebview: 'dist/webview/reportingDestinations.js',
  }
  for (const [page, entry] of Object.entries(pages)) {
    const pageMetafile = webviewEntryMetafile(
      metafile,
      entry,
      page === 'webview'
        ? [
            'dist/webview/reportingPage.js',
            'dist/webview/reportingDestinations.js',
            'dist/webview/resourceSurface.js',
            'dist/webview/resourceHistory.js',
          ]
        : [],
    )
    writeFileSync(path.join(METAFILE_DIR, `${page}.json`), JSON.stringify(pageMetafile))
    writeMetafileHashes(page, pageMetafile, buildRecord)
  }
}

/** @type {import('esbuild').BuildOptions} */
const integrationTestOptions = {
  ...common,
  entryPoints: listIntegrationTests(),
  outdir: INTEGRATION_TEST_OUTDIR,
  platform: 'node',
  format: 'cjs',
  target: hostNodeTarget,
  external: ['vscode', 'mocha'],
}

function reportSize(path) {
  const kib = (statSync(path).size / BYTES_PER_KIB).toFixed(1)
  console.log(`  ${path}  ${kib} KiB`)
}

// A failed or watch build cannot certify a package from earlier output.
rmSync(BUILD_PROFILE_FILE, { force: true })

copyCatalogToDist()
writeFileSync(
  PROVIDER_CATALOG_MODULE,
  `module.exports=JSON.parse(${JSON.stringify(readFileSync(PROVIDER_CATALOG_OUTFILE, 'utf8'))});\n`,
)
// Content-hashed chunks from an earlier build must never enter a package.
const whatsNewContent = writeWhatsNewContent()
console.log(
  `What's New: ${String(whatsNewContent.releases)} releases from CHANGELOG.md into ${WHATS_NEW_CONTENT_OUTFILE}`,
)

// The browser fixture exercises the real webview build without recompiling
// every unrelated Node bundle inside Vitest's default setup deadline.
if (process.argv.includes('--webview-only')) {
  if (!isProduction || isWatch) throw new Error('--webview-only requires --production')
  mkdirSync(METAFILE_DIR, { recursive: true })
  const buildRecord = newBuildRecord()
  const { metafile } = await esbuild.build(
    withCompiledRecording(withFoldedConstants(webviewOptions), buildRecord),
  )
  writeWebviewMetafiles(metafile, buildRecord)
  process.exit(0)
}

if (isWatch) {
  const contexts = await Promise.all([
    esbuild.context(mcpPoolOptions),
    esbuild.context(execOptions),
    esbuild.context(modelApiCodeIntelOptions),
    esbuild.context(structuredSchemaOptions),
    esbuild.context(reportingOptions),
    esbuild.context(reportingNetworkOptions),
    esbuild.context(reportingDestinationsOptions),
    esbuild.context(reportInputsOptions),
    esbuild.context(playbookSchedulesInputsOptions),
    esbuild.context(reportingPanelOptions),
    esbuild.context(hostOptions),
    esbuild.context(conversationOptions),
    esbuild.context(conversationTransferOptions),
    esbuild.context(scheduleSurfacesOptions),
    esbuild.context(devicesOptions),
    esbuild.context(makerOptions),
    esbuild.context(tabOptions),
    esbuild.context(verifyEditorOptions),
    esbuild.context(makerHostOptions),
    esbuild.context(makerPreviewHostOptions),
    esbuild.context(promptsOptions),
    esbuild.context(sharingRuntimeOptions),
    esbuild.context(connectorOptions),
    esbuild.context(connectorStoreGuardOptions),
    esbuild.context(modelApiOptions),
    esbuild.context(resourceGovernorOptions),
    esbuild.context(resourceGovernorWindowsOptions),
    esbuild.context(resourceProcessOptions),
    esbuild.context(resourceJournalOptions),
    esbuild.context(resourceAdmissionOptions),
    esbuild.context(providersOptions),
    esbuild.context(subscriptionsOptions),
    esbuild.context(subscriptionCommandsOptions),
    esbuild.context(configuredOptions),
    esbuild.context(reviewOptions),
    esbuild.context(sessionBoardOptions),
    esbuild.context(approvalModesOptions),
    esbuild.context(referenceOptions),
    esbuild.context(schedulesOptions),
    esbuild.context(scheduleDeliveryOptions),
    esbuild.context(reviewerOptions),
    esbuild.context(teamOptions),
    esbuild.context(teamPanelOptions),
    esbuild.context(teamRunnersOptions),
    esbuild.context(teamHostOptions),
    esbuild.context(teamEngineOptions),
    esbuild.context(execTeamOptions),
    esbuild.context(execLedgerLeaseOptions),
    esbuild.context(teamFileIoOptions),
    esbuild.context(teamCreateOptions),
    esbuild.context(teamWorkerOpsOptions),
    esbuild.context(teamMergeOptions),
    esbuild.context(teamSchedulerOptions),
    esbuild.context(teamWindowOptions),
    esbuild.context(teamLandingOptions),
    esbuild.context(museCodeOptions),
    esbuild.context(foreignHooksOptions),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/core/backends/modelapi/modelApiHooksEntry.ts'],
      outfile: 'dist/modelApiHooks.js',
    }),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/core/backends/modelapi/modelApiMcpEntry.ts'],
      outfile: 'dist/modelApiMcp.js',
    }),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/host/backend/productionMediaEntry.ts'],
      outfile: 'dist/productionMedia.js',
    }),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/host/backend/productionAudioEntry.ts'],
      outfile: 'dist/productionAudio.js',
    }),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/runtime/runtimeMediaEntry.ts'],
      outfile: 'dist/runtimeMedia.js',
    }),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/core/backends/modelapi/modelApiAcpEntry.ts'],
      outfile: 'dist/modelApiAcp.js',
    }),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/core/backends/modelapi/modelApiShellEntry.ts'],
      outfile: 'dist/modelApiShell.js',
    }),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/runtime/runtimeAccountingEntry.ts'],
      outfile: 'dist/runtimeAccounting.js',
    }),
    esbuild.context(hookRuntimeOptions),
    esbuild.context(modelApiToolsOptions),
    esbuild.context(modelApiFileRangeOptions),
    esbuild.context(modelApiVerifyOptions),
    esbuild.context(modelApiImageOptions),
    esbuild.context(modelApiB1Options),
    esbuild.context(modelApiToolRunOptions),
    esbuild.context(modelApiFastOptions),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/host/backend/providerPolicyEntry.ts'],
      outfile: 'dist/providerPolicy.js',
    }),
    esbuild.context({
      ...acpOptions,
      entryPoints: ['src/runtime/runtimeEngineEntry.ts'],
      outfile: 'dist/runtimeEngine.js',
    }),
    esbuild.context(pluginHooksOptions),
    esbuild.context(planMarkdownOptions),
    esbuild.context(checkpointStoreOptions),
    esbuild.context(hardwareGuardOptions),
    esbuild.context(hardwareShellOptions),
    esbuild.context(mediaOptions),
    esbuild.context(mediaHostOptions),
    esbuild.context(toolRangeOptions),
    esbuild.context(screenRecordOptions),
    esbuild.context(screenRecordDriversOptions),
    esbuild.context(agentImportOptions),
    esbuild.context(conversationGitOptions),
    esbuild.context(modelApiSessionsOptions),
    esbuild.context(rulesFileOptions),
    esbuild.context(nativeGitOptions),
    esbuild.context(execGuardOptions),
    esbuild.context(bundledSkillsOptions),
    esbuild.context(legalScanOptions),
    esbuild.context(legalFixOptions),
    esbuild.context(codeIntelOptions),
    esbuild.context(voiceOptions),
    esbuild.context(voiceLinuxOptions),
    esbuild.context(dictationOptions),
    esbuild.context(webFetchOptions),
    esbuild.context(mcpVaultOptions),
    esbuild.context(modelEffortsOptions),
    esbuild.context(accountPaidOptions),
    esbuild.context(museCodeReviewerOptions),
    esbuild.context(modelsPanelOptions),
    esbuild.context(authOptions),
    esbuild.context(paidOptions),
    esbuild.context(modelsSubscriptionsOptions),
    esbuild.context(commandsOptions),
    esbuild.context(editorChatOptions),
    esbuild.context(usageServiceOptions),
    esbuild.context(usageExportOptions),
    esbuild.context(headlessOptions),
    esbuild.context(usageCompanionOptions),
    esbuild.context(voiceCompanionOptions),
    esbuild.context(voiceCompanionWebviewOptions),
    esbuild.context(usagePanelOptions),
    esbuild.context(extensionHooksOptions),
    esbuild.context(vaultOptions),
    esbuild.context(vaultBrokerOptions),
    esbuild.context(vaultStoreOptions),
    esbuild.context(vaultPosixOptions),
    esbuild.context(vaultWindowsOptions),
    esbuild.context(vaultBrokerBindingsOptions),
    esbuild.context(vaultActionsOptions),
    esbuild.context(vaultMigrationOptions),
    esbuild.context(reportOptions),
    esbuild.context(reportFallbackOptions),
    esbuild.context(estimatorOptions),
    esbuild.context(estimateActionsOptions),
    esbuild.context(planSnapshotOptions),
    esbuild.context(estimatePricesOptions),
    esbuild.context(estimateHistoryOptions),
    esbuild.context(recorderOptions),
    esbuild.context(credentialLeaseOptions),
    esbuild.context(whatsNewOptions),
    esbuild.context(judgeOptions),
    esbuild.context(runtimeMakerOptions),
    esbuild.context(scheduleBackgroundOptions),
    esbuild.context(judgeP2Options),
    esbuild.context(judgeSourcesOptions),
    esbuild.context(judgeLintOptions),
    esbuild.context(judgeHookOptions),
    esbuild.context(judgeLocalOptions),
    esbuild.context(judgeUsesOptions),
    esbuild.context(judgeServeOptions),
    esbuild.context(judgeSetupOptions),
    esbuild.context(judgeSetupDriverOptions),
    esbuild.context(validationSchemaOptions),
    esbuild.context(uiTextOptions),
    ...uiTextRegionOptions.map((options) => esbuild.context(options)),
    esbuild.context(validationOptions),
    esbuild.context(wireOptions),
    esbuild.context(estimateContractsOptions),
    esbuild.context(vaultBoundariesOptions),
    esbuild.context(modelApiBoundariesOptions),
    esbuild.context(acpQuestionsOptions),
    esbuild.context({
      ...modelApiOptions,
      entryPoints: ['src/core/questions/deferralEntry.ts'],
      outfile: 'dist/questionNotes.js',
    }),
    esbuild.context(runtimeQuestionsOptions),
    esbuild.context(browserCheckOptions),
    esbuild.context(browserRuntimeOptions),
    esbuild.context(searchWorkerOptions),
    esbuild.context(pageWorkerOptions),
    esbuild.context(playbookWindowOptions),
    esbuild.context(imageResizeWorkerOptions),
    esbuild.context(webviewOptions),
    esbuild.context(fontInstallOptions),
    esbuild.context(nodeOptions),
    esbuild.context(lspOptions),
    esbuild.context(superviseOptions),
    esbuild.context(runtimePanelOptions),
    esbuild.context(runtimePanelSessionOptions),
    esbuild.context(runtimePanelPortsOptions),
    esbuild.context(nodeServeOptions),
    esbuild.context(nodeAuthOptions),
  ])
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  console.log('watching for changes…')
} else {
  // F6 (2026-10-17, msm112 cert): starting every bundle at once (~90
  // concurrent builds through one esbuild service) failed under machine load
  // with an error that named no file, then left the service wedged. Hold each
  // bundle's options as a thunk and start a bounded pool instead; a failure
  // names its bundle, and the pool's caller stops the service so the process
  // exits with the true error instead of hanging on in-flight builds.
  // M97 CM971-R3: production bundles record the exact bytes they compile.
  const BUILD_POOL_SIZE = 8
  const buildRecords = new Map()
  const recorded = (name, options) => () => {
    const buildRecord = newBuildRecord()
    buildRecords.set(name, buildRecord)
    return esbuild.build(
      isProduction ? withCompiledRecording(withFoldedConstants(options), buildRecord) : options,
    )
  }
  const shippedSpecs = {
    makerContracts: recorded('makerContracts', {
      ...common,
      plugins: [sharedUiText, sharedValidation],
      entryPoints: ['src/shared/makerProtocol.ts'],
      outfile: 'dist/makerContracts.js',
      platform: 'node',
      format: 'cjs',
      target: HOST_NODE_TARGET,
    }),
    verifyEditor: recorded('verifyEditor', verifyEditorOptions),
    makerHost: recorded('makerHost', makerHostOptions),
    makerPreviewHost: recorded('makerPreviewHost', makerPreviewHostOptions),
    hardwareGuard: recorded('hardwareGuard', hardwareGuardOptions),
    hardwareShell: recorded('hardwareShell', hardwareShellOptions),
    runtimeMaker: recorded('runtimeMaker', runtimeMakerOptions),
    makerPreview: recorded('makerPreview', makerPreviewOptions),
    questionNotes: recorded('questionNotes', {
      ...modelApiOptions,
      entryPoints: ['src/core/questions/deferralEntry.ts'],
      outfile: 'dist/questionNotes.js',
    }),
    mcpPool: recorded('mcpPool', mcpPoolOptions),
    modelApiCodeIntel: recorded('modelApiCodeIntel', modelApiCodeIntelOptions),
    structuredSchema: recorded('structuredSchema', structuredSchemaOptions),
    extension: recorded('extension', hostOptions),
    conversation: recorded('conversation', conversationOptions),
    scheduleSurfaces: recorded('scheduleSurfaces', scheduleSurfacesOptions),
    devices: recorded('devices', devicesOptions),
    maker: recorded('maker', makerOptions),
    tab: recorded('tab', tabOptions),
    prompts: recorded('prompts', promptsOptions),
    sharingRuntime: recorded('sharingRuntime', sharingRuntimeOptions),
    connector: recorded('connector', connectorOptions),
    connectorStoreGuard: recorded('connectorStoreGuard', connectorStoreGuardOptions),
    modelApi: recorded('modelApi', modelApiOptions),
    resourceGovernor: recorded('resourceGovernor', resourceGovernorOptions),
    resourceGovernorWindows: recorded('resourceGovernorWindows', resourceGovernorWindowsOptions),
    resourceProcess: recorded('resourceProcess', resourceProcessOptions),
    resourceJournal: recorded('resourceJournal', resourceJournalOptions),
    resourceAdmission: recorded('resourceAdmission', resourceAdmissionOptions),
    providers: recorded('providers', providersOptions),
    subscriptions: recorded('subscriptions', subscriptionsOptions),
    subscriptionCommands: recorded('subscriptionCommands', subscriptionCommandsOptions),
    configuredProviders: recorded('configuredProviders', configuredOptions),
    review: recorded('review', reviewOptions),
    sessionBoard: recorded('sessionBoard', sessionBoardOptions),
    approvalModes: recorded('approvalModes', approvalModesOptions),
    reporting: recorded('reporting', reportingOptions),
    reportingNetwork: recorded('reportingNetwork', reportingNetworkOptions),
    reportingDestinations: recorded('reportingDestinations', reportingDestinationsOptions),
    reportingPanel: recorded('reportingPanel', reportingPanelOptions),
    reportInputs: recorded('reportInputs', reportInputsOptions),
    playbookSchedulesInputs: recorded('playbookSchedulesInputs', playbookSchedulesInputsOptions),
    reference: recorded('reference', referenceOptions),
    schedules: recorded('schedules', schedulesOptions),
    scheduleDelivery: recorded('scheduleDelivery', scheduleDeliveryOptions),
    reviewer: recorded('reviewer', reviewerOptions),
    team: recorded('team', teamOptions),
    teamPanel: recorded('teamPanel', teamPanelOptions),
    teamRunners: recorded('teamRunners', teamRunnersOptions),
    teamHost: recorded('teamHost', teamHostOptions),
    teamEngine: recorded('teamEngine', teamEngineOptions),
    teamFileIo: recorded('teamFileIo', teamFileIoOptions),
    teamCreate: recorded('teamCreate', teamCreateOptions),
    teamWorkerOps: recorded('teamWorkerOps', teamWorkerOpsOptions),
    execTeam: recorded('execTeam', execTeamOptions),
    execLedgerLease: recorded('execLedgerLease', execLedgerLeaseOptions),
    teamMerge: recorded('teamMerge', teamMergeOptions),
    teamScheduler: recorded('teamScheduler', teamSchedulerOptions),
    teamWindow: recorded('teamWindow', teamWindowOptions),
    teamLanding: recorded('teamLanding', teamLandingOptions),
    foreignHooks: recorded('foreignHooks', foreignHooksOptions),
    modelApiHooks: recorded('modelApiHooks', {
      ...modelApiOptions,
      entryPoints: ['src/core/backends/modelapi/modelApiHooksEntry.ts'],
      outfile: 'dist/modelApiHooks.js',
    }),
    modelApiMcp: recorded('modelApiMcp', {
      ...modelApiOptions,
      entryPoints: ['src/core/backends/modelapi/modelApiMcpEntry.ts'],
      outfile: 'dist/modelApiMcp.js',
    }),
    modelApiAcp: recorded('modelApiAcp', {
      ...modelApiOptions,
      entryPoints: ['src/core/backends/modelapi/modelApiAcpEntry.ts'],
      outfile: 'dist/modelApiAcp.js',
    }),
    modelApiShell: recorded('modelApiShell', {
      ...modelApiOptions,
      entryPoints: ['src/core/backends/modelapi/modelApiShellEntry.ts'],
      outfile: 'dist/modelApiShell.js',
    }),
    runtimeAccounting: recorded('runtimeAccounting', {
      ...modelApiOptions,
      entryPoints: ['src/runtime/runtimeAccountingEntry.ts'],
      outfile: 'dist/runtimeAccounting.js',
    }),
    providerPolicy: recorded('providerPolicy', {
      ...modelApiOptions,
      entryPoints: ['src/host/backend/providerPolicyEntry.ts'],
      outfile: 'dist/providerPolicy.js',
    }),
    runtimeEngine: recorded('runtimeEngine', {
      ...acpOptions,
      entryPoints: ['src/runtime/runtimeEngineEntry.ts'],
      outfile: 'dist/runtimeEngine.js',
    }),
    hookRuntime: recorded('hookRuntime', hookRuntimeOptions),
    pluginHooks: recorded('pluginHooks', pluginHooksOptions),
    modelApiTools: recorded('modelApiTools', modelApiToolsOptions),
    modelApiFileRange: recorded('modelApiFileRange', modelApiFileRangeOptions),
    modelApiVerify: recorded('modelApiVerify', modelApiVerifyOptions),
    modelApiImage: recorded('modelApiImage', modelApiImageOptions),
    modelApiB1: recorded('modelApiB1', modelApiB1Options),
    modelApiToolRun: recorded('modelApiToolRun', modelApiToolRunOptions),
    modelApiFast: recorded('modelApiFast', modelApiFastOptions),
    planMarkdown: recorded('planMarkdown', planMarkdownOptions),
    checkpointStore: recorded('checkpointStore', checkpointStoreOptions),
    media: recorded('media', mediaOptions),
    toolRange: recorded('toolRange', toolRangeOptions),
    screenRecord: recorded('screenRecord', screenRecordOptions),
    screenRecordDrivers: recorded('screenRecordDrivers', screenRecordDriversOptions),
    agentImport: recorded('agentImport', agentImportOptions),
    conversationGit: recorded('conversationGit', conversationGitOptions),
    conversationTransfer: recorded('conversationTransfer', conversationTransferOptions),
    modelApiSessions: recorded('modelApiSessions', modelApiSessionsOptions),
    rulesFile: recorded('rulesFile', rulesFileOptions),
    nativeGit: recorded('nativeGit', nativeGitOptions),
    execGuard: recorded('execGuard', execGuardOptions),
    bundledSkills: recorded('bundledSkills', bundledSkillsOptions),
    legalScan: recorded('legalScan', legalScanOptions),
    legalFix: recorded('legalFix', legalFixOptions),
    codeIntel: recorded('codeIntel', codeIntelOptions),
    voice: recorded('voice', voiceOptions),
    webFetch: recorded('webFetch', webFetchOptions),
    mcpVault: recorded('mcpVault', mcpVaultOptions),
    accountPaid: recorded('accountPaid', accountPaidOptions),
    modelEfforts: recorded('modelEfforts', modelEffortsOptions),
    museCodeReviewer: recorded('museCodeReviewer', museCodeReviewerOptions),
    modelsPanel: recorded('modelsPanel', modelsPanelOptions),
    editorChat: recorded('editorChat', editorChatOptions),
    auth: recorded('auth', authOptions),
    paid: recorded('paid', paidOptions),
    modelsSubscriptions: recorded('modelsSubscriptions', modelsSubscriptionsOptions),
    commands: recorded('commands', commandsOptions),
    usageService: recorded('usageService', usageServiceOptions),
    usageExport: recorded('usageExport', usageExportOptions),
    usageCompanion: recorded('usageCompanion', usageCompanionOptions),
    usagePanel: recorded('usagePanel', usagePanelOptions),
    extensionHooks: recorded('extensionHooks', extensionHooksOptions),
    vault: recorded('vault', vaultOptions),
    vaultBroker: recorded('vaultBroker', vaultBrokerOptions),
    vaultStore: recorded('vaultStore', vaultStoreOptions),
    vaultPosix: recorded('vaultPosix', vaultPosixOptions),
    vaultWindows: recorded('vaultWindows', vaultWindowsOptions),
    vaultBrokerBindings: recorded('vaultBrokerBindings', vaultBrokerBindingsOptions),
    vaultActions: recorded('vaultActions', vaultActionsOptions),
    vaultMigration: recorded('vaultMigration', vaultMigrationOptions),
    report: recorded('report', reportOptions),
    reportFallback: recorded('reportFallback', reportFallbackOptions),
    estimator: recorded('estimator', estimatorOptions),
    recorder: recorded('recorder', recorderOptions),
    whatsNew: recorded('whatsNew', whatsNewOptions),
    judge: recorded('judge', judgeOptions),
    judgeP2: recorded('judgeP2', judgeP2Options),
    judgeSources: recorded('judgeSources', judgeSourcesOptions),
    judgeLint: recorded('judgeLint', judgeLintOptions),
    judgeHook: recorded('judgeHook', judgeHookOptions),
    judgeLocal: recorded('judgeLocal', judgeLocalOptions),
    judgeUses: recorded('judgeUses', judgeUsesOptions),
    judgeServe: recorded('judgeServe', judgeServeOptions),
    judgeSetup: recorded('judgeSetup', judgeSetupOptions),
    judgeSetupDriver: recorded('judgeSetupDriver', judgeSetupDriverOptions),
    validationSchema: recorded('validationSchema', validationSchemaOptions),
    scheduleBackground: recorded('scheduleBackground', scheduleBackgroundOptions),
    uiText: recorded('uiText', uiTextOptions),
    museCode: recorded('museCode', museCodeOptions),
    productionMedia: recorded('productionMedia', {
      ...modelApiOptions,
      entryPoints: ['src/host/backend/productionMediaEntry.ts'],
      outfile: 'dist/productionMedia.js',
    }),
    productionAudio: recorded('productionAudio', {
      ...modelApiOptions,
      entryPoints: ['src/host/backend/productionAudioEntry.ts'],
      outfile: 'dist/productionAudio.js',
    }),
    runtimeMedia: recorded('runtimeMedia', {
      ...modelApiOptions,
      entryPoints: ['src/runtime/runtimeMediaEntry.ts'],
      outfile: 'dist/runtimeMedia.js',
    }),
    mediaHost: recorded('mediaHost', mediaHostOptions),
    voiceLinux: recorded('voiceLinux', voiceLinuxOptions),
    dictation: recorded('dictation', dictationOptions),
    voiceCompanion: recorded('voiceCompanion', voiceCompanionOptions),
    voiceCompanionWebview: recorded('voiceCompanionWebview', voiceCompanionWebviewOptions),
    planSnapshot: recorded('planSnapshot', planSnapshotOptions),
    estimatePrices: recorded('estimatePrices', estimatePricesOptions),
    estimateHistory: recorded('estimateHistory', estimateHistoryOptions),
    estimateActions: recorded('estimateActions', estimateActionsOptions),
    credentialLease: recorded('credentialLease', credentialLeaseOptions),
    ...Object.fromEntries(
      UI_TEXT_REGIONS.map((region, index) => [
        path.basename(region.output, '.js'),
        recorded(path.basename(region.output, '.js'), uiTextRegionOptions[index]),
      ]),
    ),
    validation: recorded('validation', validationOptions),
    wire: recorded('wire', wireOptions),
    estimateContracts: recorded('estimateContracts', estimateContractsOptions),
    vaultBoundaries: recorded('vaultBoundaries', vaultBoundariesOptions),
    modelApiBoundaries: recorded('modelApiBoundaries', modelApiBoundariesOptions),
    browserCheck: recorded('browserCheck', browserCheckOptions),
    browserRuntime: recorded('browserRuntime', browserRuntimeOptions),
    searchWorker: recorded('searchWorker', searchWorkerOptions),
    pageWorker: recorded('pageWorker', pageWorkerOptions),
    playbook: recorded('playbook', playbookWindowOptions),
    imageResizeWorker: recorded('imageResizeWorker', imageResizeWorkerOptions),
    webview: recorded('webview', webviewOptions),
  }
  const extraSpecs = [
    ['acp', () => esbuild.build(acpOptions)],
    ['exec', () => esbuild.build(execOptions)],
    ['providerList', () => esbuild.build(providerListOptions)],
    ['headless', () => esbuild.build(headlessOptions)],
    ['acpQuestions', () => esbuild.build(acpQuestionsOptions)],
    ['runtimeQuestions', () => esbuild.build(runtimeQuestionsOptions)],
    ['fontInstall', () => esbuild.build(fontInstallOptions)],
    ['playbook', () => esbuild.build(playbookOptions)],
    ['watchdog', () => esbuild.build(watchdogOptions)],
    ['runtimeAccounts', () => esbuild.build(runtimeAccountsOptions)],
    ['packsVerify', () => esbuild.build(packsVerifyOptions)],
    ['vaultRuntime', () => esbuild.build(vaultRuntimeOptions)],
    ['node', () => esbuild.build(nodeOptions)],
    ['nodeSetup', () => esbuild.build(nodeSetupOptions)],
    ['lsp', () => esbuild.build(lspOptions)],
    ['supervise', () => esbuild.build(superviseOptions)],
    ['runtimePanel', () => esbuild.build(runtimePanelOptions)],
    ['runtimePanelSession', () => esbuild.build(runtimePanelSessionOptions)],
    ['runtimePanelPorts', () => esbuild.build(runtimePanelPortsOptions)],
    ['nodeServe', () => esbuild.build(nodeServeOptions)],
    ['nodeAuth', () => esbuild.build(nodeAuthOptions)],
  ]
  if (!isProduction || isWithIntegrationTests) {
    extraSpecs.push(['integrationTests', () => esbuild.build(integrationTestOptions)])
  }
  let shipped
  let acp
  let exec
  let providerList
  let headless
  let acpQuestions
  let runtimeQuestions
  let fontInstall
  let playbook
  let watchdog
  let runtimeAccounts
  let packsVerify
  let vaultRuntime
  let node
  let nodeSetup
  let lsp
  let supervise
  let runtimePanel
  let runtimePanelSession
  let runtimePanelPorts
  let nodeServe
  let nodeAuth
  try {
    shipped = await runBuildPool(Object.entries(shippedSpecs), BUILD_POOL_SIZE)
    ;({
      acp,
      exec,
      providerList,
      headless,
      acpQuestions,
      runtimeQuestions,
      fontInstall,
      playbook,
      watchdog,
      runtimeAccounts,
      packsVerify,
      vaultRuntime,
      node,
      nodeSetup,
      lsp,
      supervise,
      runtimePanel,
      runtimePanelSession,
      runtimePanelPorts,
      nodeServe,
      nodeAuth,
    } = await runBuildPool(extraSpecs, BUILD_POOL_SIZE))
  } catch (error) {
    await esbuild.stop()
    throw error
  }
  if (isProduction) {
    rmSync(METAFILE_DIR, { recursive: true, force: true })
    rmSync(META_HASHES_DIR, { recursive: true, force: true })
    const ACP_METAFILE_DIR = 'dist/meta-acp'
    rmSync(ACP_METAFILE_DIR, { recursive: true, force: true })
    mkdirSync(METAFILE_DIR, { recursive: true })
    mkdirSync(META_HASHES_DIR, { recursive: true })
    for (const [name, build] of Object.entries(shipped)) {
      const { metafile } = await build
      const buildRecord = buildRecords.get(name)
      if (name === 'webview') {
        writeWebviewMetafiles(metafile, buildRecord)
      } else {
        writeFileSync(path.join(METAFILE_DIR, `${name}.json`), JSON.stringify(metafile))
        writeMetafileHashes(name, metafile, buildRecord)
      }
    }
    mkdirSync(ACP_METAFILE_DIR, { recursive: true })
    const { metafile: fontsMetafile } = await fontInstall
    writeFileSync(path.join(ACP_METAFILE_DIR, 'fontsInstall.json'), JSON.stringify(fontsMetafile))
    const { metafile } = await acp
    const { metafile: headlessMetafile } = await headless
    writeFileSync(path.join(ACP_METAFILE_DIR, 'acp.json'), JSON.stringify(metafile))
    writeFileSync(path.join(ACP_METAFILE_DIR, 'headless.json'), JSON.stringify(headlessMetafile))
    const { metafile: questionsMetafile } = await acpQuestions
    const { metafile: runtimeQuestionsMetafile } = await runtimeQuestions
    const { metafile: playbookMetafile } = await playbook
    const { metafile: watchdogMetafile } = await watchdog
    const { metafile: runtimeAccountsMetafile } = await runtimeAccounts
    const { metafile: packsVerifyMetafile } = await packsVerify
    const { metafile: vaultRuntimeMetafile } = await vaultRuntime
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'vaultRuntime.json'),
      JSON.stringify(vaultRuntimeMetafile, null, 2),
    )
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'runtimeQuestions.json'),
      JSON.stringify(runtimeQuestionsMetafile, null, 2),
    )
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'runtimeAccounts.json'),
      JSON.stringify(runtimeAccountsMetafile, null, 2),
    )
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'packsVerify.json'),
      JSON.stringify(packsVerifyMetafile, null, 2),
    )
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'acpQuestions.json'),
      JSON.stringify(questionsMetafile),
    )
    const execBuild = await exec
    writeFileSync(path.join(ACP_METAFILE_DIR, 'exec.json'), JSON.stringify(execBuild.metafile))
    const providerListBuild = await providerList
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'providerList.json'),
      JSON.stringify(providerListBuild.metafile),
    )
    writeFileSync(path.join(ACP_METAFILE_DIR, 'acpPlaybook.json'), JSON.stringify(playbookMetafile))
    const { metafile: nodeMetafile } = await node
    writeFileSync(path.join(ACP_METAFILE_DIR, 'node.json'), JSON.stringify(nodeMetafile))
    const { metafile: nodeSetupMetafile } = await nodeSetup
    writeFileSync(path.join(ACP_METAFILE_DIR, 'nodeSetup.json'), JSON.stringify(nodeSetupMetafile))
    const { metafile: lspMetafile } = await lsp
    writeFileSync(path.join(ACP_METAFILE_DIR, 'lsp.json'), JSON.stringify(lspMetafile))
    const { metafile: superviseMetafile } = await supervise
    writeFileSync(path.join(ACP_METAFILE_DIR, 'supervise.json'), JSON.stringify(superviseMetafile))
    writeFileSync(path.join(ACP_METAFILE_DIR, 'acpWatchdog.json'), JSON.stringify(watchdogMetafile))
    const { metafile: runtimePanelMetafile } = await runtimePanel
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'runtimePanel.json'),
      JSON.stringify(runtimePanelMetafile),
    )
    const { metafile: runtimePanelSessionMetafile } = await runtimePanelSession
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'runtimePanelSession.json'),
      JSON.stringify(runtimePanelSessionMetafile),
    )
    const { metafile: runtimePanelPortsMetafile } = await runtimePanelPorts
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'runtimePanelPorts.json'),
      JSON.stringify(runtimePanelPortsMetafile),
    )
    const { metafile: nodeServeMetafile } = await nodeServe
    writeFileSync(path.join(ACP_METAFILE_DIR, 'nodeServe.json'), JSON.stringify(nodeServeMetafile))
    const { metafile: nodeAuthMetafile } = await nodeAuth
    writeFileSync(path.join(ACP_METAFILE_DIR, 'nodeAuth.json'), JSON.stringify(nodeAuthMetafile))
  }
  writeFileSync(BUILD_PROFILE_FILE, JSON.stringify({ ...profile, production: isProduction }))
  console.log('bundle sizes:')
  reportSize(ACP_QUESTIONS_OUTFILE)
  reportSize(PLAYBOOK_OUTFILE)
  reportSize(WATCHDOG_OUTFILE)
  reportSize(HOST_OUTFILE)
  reportSize(CONVERSATION_OUTFILE)
  reportSize(CONVERSATION_TRANSFER_OUTFILE)
  reportSize(DEVICES_OUTFILE)
  reportSize(MAKER_OUTFILE)
  reportSize(TAB_OUTFILE)
  reportSize(MAKER_HOST_OUTFILE)
  reportSize('dist/makerPreviewHost.js')
  reportSize(PROMPTS_OUTFILE)
  reportSize(SHARING_RUNTIME_OUTFILE)
  reportSize(CONNECTOR_OUTFILE)
  reportSize(CONNECTOR_STORE_GUARD_OUTFILE)
  reportSize(MODEL_API_OUTFILE)
  reportSize(RESOURCE_OUTFILE)
  reportSize(RESOURCE_WINDOWS_OUTFILE)
  reportSize(RESOURCE_ADMISSION_OUTFILE)
  reportSize(PROVIDERS_OUTFILE)
  reportSize(SUBSCRIPTIONS_OUTFILE)
  reportSize(SUBSCRIPTION_COMMANDS_OUTFILE)
  reportSize(CONFIGURED_OUTFILE)
  reportSize(REVIEW_OUTFILE)
  reportSize(SESSION_BOARD_OUTFILE)
  reportSize('dist/reference.js')
  reportSize(REVIEWER_OUTFILE)
  reportSize(TEAM_OUTFILE)
  reportSize(TEAM_RUNNERS_OUTFILE)
  reportSize(TEAM_HOST_OUTFILE)
  reportSize(TEAM_SCHEDULER_OUTFILE)
  reportSize(FOREIGN_HOOKS_OUTFILE)
  reportSize(HOOK_RUNTIME_OUTFILE)
  reportSize(PLAN_MARKDOWN_OUTFILE)
  reportSize(CHECKPOINT_STORE_OUTFILE)
  reportSize(MEDIA_OUTFILE)
  reportSize(MEDIA_HOST_OUTFILE)
  reportSize(SCREEN_RECORD_OUTFILE)
  reportSize(SCREEN_RECORD_DRIVERS_OUTFILE)
  reportSize(AGENT_IMPORT_OUTFILE)
  reportSize(CONVERSATION_GIT_OUTFILE)
  reportSize(MODEL_API_SESSIONS_OUTFILE)
  reportSize(RULES_FILE_OUTFILE)
  reportSize(NATIVE_GIT_OUTFILE)
  reportSize(EXEC_GUARD_OUTFILE)
  reportSize(BUNDLED_SKILLS_OUTFILE)
  reportSize(LEGAL_SCAN_OUTFILE)
  reportSize(LEGAL_FIX_OUTFILE)
  reportSize(CODE_INTEL_OUTFILE)
  reportSize(VOICE_OUTFILE)
  reportSize(VOICE_LINUX_OUTFILE)
  reportSize(DICTATION_OUTFILE)
  reportSize(WEB_FETCH_OUTFILE)
  reportSize(MUSE_CODE_REVIEWER_OUTFILE)
  reportSize(MODELS_PANEL_OUTFILE)
  reportSize(MODELS_SUBSCRIPTIONS_OUTFILE)
  reportSize(COMMANDS_OUTFILE)
  reportSize(AUTH_OUTFILE)
  reportSize(PAID_OUTFILE)
  reportSize('dist/usageService.js')
  reportSize('dist/usageExport.js')
  reportSize('dist/usageCompanion.js')
  reportSize('dist/usagePanel.js')
  reportSize(EXTENSION_HOOKS_OUTFILE)
  reportSize(VAULT_OUTFILE)
  reportSize('dist/vaultBroker.js')
  reportSize('dist/vaultBrokerBindings.js')
  reportSize(VAULT_ACTIONS_OUTFILE)
  reportSize(REPORT_OUTFILE)
  reportSize(REPORT_FALLBACK_OUTFILE)
  reportSize(ESTIMATOR_OUTFILE)
  reportSize(ESTIMATE_ACTIONS_OUTFILE)
  reportSize(ESTIMATE_PRICES_OUTFILE)
  reportSize(ESTIMATE_HISTORY_OUTFILE)
  reportSize(RECORDER_OUTFILE)
  reportSize(CREDENTIAL_LEASE_OUTFILE)
  reportSize(WHATS_NEW_OUTFILE)
  reportSize(WHATS_NEW_CONTENT_OUTFILE)
  reportSize(JUDGE_OUTFILE)
  reportSize(JUDGE_P2_OUTFILE)
  reportSize(JUDGE_SOURCES_OUTFILE)
  reportSize(JUDGE_LINT_OUTFILE)
  reportSize(JUDGE_HOOK_OUTFILE)
  reportSize(JUDGE_LOCAL_OUTFILE)
  reportSize(JUDGE_USES_OUTFILE)
  reportSize('dist/validationSchema.js')
  reportSize(UI_TEXT_OUTFILE)
  for (const region of UI_TEXT_REGIONS) reportSize(region.output)
  reportSize(VALIDATION_OUTFILE)
  reportSize(WHATS_NEW_OUTFILE)
  reportSize(WHATS_NEW_CONTENT_OUTFILE)
  reportSize(BROWSER_CHECK_OUTFILE)
  reportSize(BROWSER_RUNTIME_OUTFILE)
  reportSize(MODELS_PANEL_OUTFILE)
  reportSize(MODELS_SUBSCRIPTIONS_OUTFILE)
  reportSize(SEARCH_WORKER_OUTFILE)
  reportSize(PAGE_WORKER_OUTFILE)
  reportSize(PLAYBOOK_WINDOW_OUTFILE)
  reportSize(IMAGE_RESIZE_WORKER_OUTFILE)
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.css'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'models.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'models.css'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'usage.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'usage.css'))
  reportSize(path.join(WEBVIEW_OUTDIR, COMPANION_THEME_CSS_FILE))
  reportSize(PROVIDER_CATALOG_OUTFILE)
  reportSize(path.join(WEBVIEW_OUTDIR, `${WHATS_NEW_PAGE_NAME}.js`))
  reportSize(path.join(WEBVIEW_OUTDIR, `${WHATS_NEW_PAGE_NAME}.css`))
  reportSize(ACP_OUTFILE)
  reportSize('dist/runtimeMaker.js')
  reportSize('dist/headless.js')
  reportSize(SCHEDULE_BACKGROUND_OUTFILE)
  reportSize(NODE_OUTFILE)
  reportSize(NODE_SETUP_OUTFILE)
  reportSize(LSP_OUTFILE)
  reportSize(SUPERVISE_OUTFILE)
  reportSize(RUNTIME_PANEL_OUTFILE)
  reportSize(RUNTIME_PANEL_SESSION_OUTFILE)
  reportSize(RUNTIME_PANEL_PORTS_OUTFILE)
  reportSize(NODE_SERVE_OUTFILE)
  reportSize(NODE_AUTH_OUTFILE)
  reportSize(PACKS_VERIFY_OUTFILE)
}

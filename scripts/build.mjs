#!/usr/bin/env node
import { buildLinuxHelper } from './build-linux-helper.mjs'
import { resourceBrowserValidation, webviewEntryMetafile } from './lib/webviewBundles.mjs'
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
// handler, loaded on the first open; dist/report.js) and its flight recorder
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

import { lazyBrowserKeybindings } from './lib/browserKeybindings.mjs'
import { compressedModelText } from './lib/compressedModelText.mjs'
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
  nodeReferenceData,
  deferredCohort,
  sharedWire,
  sharedResourceAdmission,
  sharedStructuredSchema,
  sharedModelApiBoundaries,
  englishZodLocales,
  sharedRedaction,
} from './lib/deferredBundles.mjs'
import {
  CONTENT_FILE as WHATS_NEW_CONTENT_OUTFILE,
  writeWhatsNewContent,
} from './lib/whatsNewContent.mjs'

execFileSync(process.execPath, ['scripts/team-tool-schemas.mjs'], { stdio: 'inherit' })

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

const isProduction = args.has('--production')
const isWatch = args.has('--watch')

const HOST_ENTRY = 'src/extension.ts'
const HOST_OUTFILE = 'dist/extension.js'
const CONVERSATION_ENTRY = 'src/host/conversation/conversationEntry.ts'
const CONVERSATION_OUTFILE = 'dist/conversation.js'
// One immutable English fallback shared by Node bundles; each keeps its own
// mutable installed-language state. The browser keeps its fallback bundled.
const SHARING_RUNTIME_ENTRY = 'src/runtime/sharing/sharingEntry.ts'
const SHARING_RUNTIME_OUTFILE = 'dist/sharingRuntime.js'
// M124 (D106): the MCP connector, loaded only by `muse-spark-code-acp mcp`.
const CONNECTOR_ENTRY = 'src/runtime/connector/entry.ts'
const CONNECTOR_OUTFILE = 'dist/connector.js'
const PROMPTS_ENTRY = 'src/host/prompts/promptEntry.ts'
const PROMPTS_OUTFILE = 'dist/prompts.js'
const TAB_ENTRY = 'src/host/tab/tabEntry.ts'
const TAB_OUTFILE = 'dist/tab.js'
const UI_TEXT_ENTRY = 'src/shared/l10n/en.ts'
const UI_TEXT_OUTFILE = 'dist/uiText.js'
const VALIDATION_ENTRY = 'src/shared/validationEntry.ts'
const VALIDATION_OUTFILE = 'dist/validation.js'
const MODEL_API_ENTRY = 'src/host/backend/modelApiEntry.ts'
const MODEL_API_OUTFILE = 'dist/modelApi.js'
const RESOURCE_ENTRY = 'src/core/resources/resourceGovernorEntry.ts'
const RESOURCE_OUTFILE = 'dist/resourceGovernor.js'
// POSTSPAWN: the governed launcher, beside (never inside) the governor.
const RESOURCE_PROCESS_ENTRY = 'src/core/resources/resourceProcessEntry.ts'
const RESOURCE_PROCESS_OUTFILE = 'dist/resourceProcess.js'
// POSTSPAWN: the vault MCP launch (scrubber, leases), on the first vault-backed server.
const MCP_VAULT_ENTRY = 'src/host/backend/mcpVaultEntry.ts'
const MCP_VAULT_OUTFILE = 'dist/mcpVault.js'
const RESOURCE_ADMISSION_ENTRY = 'src/core/resources/admissionEntry.ts'
const RESOURCE_ADMISSION_OUTFILE = 'dist/resourceAdmission.js'
const PROVIDERS_ENTRY = 'src/host/backend/providersEntry.ts'
const PROVIDERS_OUTFILE = 'dist/providers.js'
const SUBSCRIPTIONS_ENTRY = 'src/host/backend/subscriptionsEntry.ts'
const SUBSCRIPTIONS_OUTFILE = 'dist/subscriptions.js'
const CONFIGURED_ENTRY = 'src/host/backend/configuredProvidersEntry.ts'
const CONFIGURED_OUTFILE = 'dist/configuredProviders.js'
const SESSION_BOARD_ENTRY = 'src/host/sessionBoardEntry.ts'
const SESSION_BOARD_OUTFILE = 'dist/sessionBoard.js'
const TEAM_ENTRY = 'src/core/team/teamEntry.ts'
const TEAM_OUTFILE = 'dist/team.js'
const TEAM_SCHEDULER_ENTRY = 'src/core/team/teamSchedulerEntry.ts'
const TEAM_SCHEDULER_OUTFILE = 'dist/teamScheduler.js'
const TEAM_RUNNERS_ENTRY = 'src/host/runners/teamRunnersEntry.ts'
const TEAM_RUNNERS_OUTFILE = 'dist/teamRunners.js'
// M115 W: v1's Model API schedules re-exported beside the v2 runtime binding.
const SCHEDULES_ENTRY = 'src/runtime/schedules/schedulesBundle.ts'
const SCHEDULES_OUTFILE = 'dist/schedules.js'
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
const BUNDLED_SKILLS_ENTRY = 'src/host/skills/bundledSkillsEntry.ts'
const BUNDLED_SKILLS_OUTFILE = 'dist/bundledSkills.js'
const CHECKPOINT_STORE_ENTRY = 'src/host/checkpoints/checkpointStoreEntry.ts'
const CHECKPOINT_STORE_OUTFILE = 'dist/checkpointStore.js'
// M105 lane W: the attachment path (attach port with the portable sniffers,
// limits and modality gate), loaded on first use.
const MEDIA_ENTRY = 'src/host/media/mediaEntry.ts'
const MEDIA_OUTFILE = 'dist/media.js'
// M105 lane W: the screen-recording command with the R1-R3 platform drivers,
// loaded the first time a recording command runs.
const SCREEN_RECORD_ENTRY = 'src/host/media/screenRecordEntry.ts'
const SCREEN_RECORD_OUTFILE = 'dist/screenRecord.js'
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
const WEB_FETCH_ENTRY = 'src/host/web/webFetchEntry.ts'
const WEB_FETCH_OUTFILE = 'dist/webFetch.js'
const MUSE_CODE_REVIEWER_ENTRY = 'src/host/review/museCodeReviewerEntry.ts'
const MUSE_CODE_REVIEWER_OUTFILE = 'dist/museCodeReviewer.js'
const MODELS_PANEL_ENTRY = 'src/host/models/modelsPanelEntry.ts'
const MODELS_PANEL_OUTFILE = 'dist/modelsPanel.js'
const MODELS_SUBSCRIPTIONS_ENTRY = 'src/host/models/modelsSubscriptionsEntry.ts'
const MODELS_SUBSCRIPTIONS_OUTFILE = 'dist/modelsSubscriptions.js'
const USAGE_SERVICE_ENTRY = 'src/runtime/usage/usageServiceEntry.ts'
const USAGE_COMPANION_ENTRY = 'src/runtime/usage/usageCompanionEntry.ts'
const USAGE_PANEL_ENTRY = 'src/host/usage/usagePanelEntry.ts'
const EXTENSION_HOOKS_ENTRY = 'src/host/extensionHooksEntry.ts'
const EXTENSION_HOOKS_OUTFILE = 'dist/extensionHooks.js'
// M109 lane W: the vault's window (the panel host and the native editor),
// loaded on the first vault command. `vscode` stays external, provided by
// the host, as for the import. The broker client joins it once the
// broker-backed service lands (docs/certification/m109.md).
const VAULT_ENTRY = 'src/host/vault/vaultPanelEntry.ts'
const VAULT_OUTFILE = 'dist/vault.js'
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
const ESTIMATOR_ENTRY = 'src/host/estimator/estimatorEntry.ts'
const ESTIMATOR_OUTFILE = 'dist/estimator.js'
const RECORDER_ENTRY = 'src/host/support/recorderEntry.ts'
const RECORDER_OUTFILE = 'dist/recorder.js'
const PAGE_WORKER_ENTRY = 'src/host/web/pageWorker.ts'
const PAGE_WORKER_OUTFILE = 'dist/pageWorker.js'
const WEBVIEW_ENTRY = 'src/webview/main.tsx'
// The Models & Agents panel's own app (M95 lane M), beside the chat.
const MODELS_WEBVIEW_ENTRY = 'src/webview/models/models.tsx'
const USAGE_WEBVIEW_ENTRY = 'src/webview/usage/usage.tsx'
const WEBVIEW_OUTDIR = 'dist/webview'
const WHATS_NEW_PAGE_ENTRY = 'src/webview/whatsNew/main.ts'
const WHATS_NEW_PAGE_NAME = 'whatsNew'
const FONT_INSTALL_ENTRY = 'src/runtime/fonts/fontsEntry.ts'
const FONT_INSTALL_OUTFILE = 'dist/fontsInstall.js'
const ACP_ENTRY = 'src/runtime/main.ts'
const ACP_OUTFILE = 'dist/acp.js'
const SCHEDULE_BACKGROUND_ENTRY = 'src/runtime/schedules/backgroundEntry.ts'
const SCHEDULE_BACKGROUND_OUTFILE = 'dist/scheduleBackground.js'
const ACP_QUESTIONS_ENTRY = 'src/acp/questionDeferralEntry.ts'
const ACP_QUESTIONS_OUTFILE = 'dist/acpQuestions.js'
const RUNTIME_QUESTIONS_ENTRY = 'src/runtime/questions/questionRegistryEntry.ts'
const RUNTIME_QUESTIONS_OUTFILE = 'dist/runtimeQuestions.js'
const PLAYBOOK_ENTRY = 'src/runtime/playbook/playbookEntry.ts'
const PLAYBOOK_OUTFILE = 'dist/acpPlaybook.js'
const RUNTIME_ACCOUNTS_ENTRY = 'src/runtime/providers/accountsEntry.ts'
const RUNTIME_ACCOUNTS_OUTFILE = 'dist/runtimeAccounts.js'
const INTEGRATION_TEST_OUTDIR = 'dist/test/integration'
// M95 (PLAN.md D74): exact catalogue values, with no provider runtime logic.
// The data module uses the same verified solid archive loader as lazy bundles.
const PROVIDER_CATALOG_OUTFILE = 'dist/providerCatalog.json'
const PROVIDER_CATALOG_MODULE = 'dist/providerCatalog.js'
// The extension host of the oldest VS Code the manifest accepts: 1.99 runs
// Node 20.18 (PLAN.md M62). The ACP agent runs on the user's own Node 22.
const HOST_NODE_TARGET = 'node20.18'
const AGENT_NODE_TARGET = 'node22'
const BROWSER_TARGET = 'chrome128'
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
  target: HOST_NODE_TARGET,
  external: ['vscode'],
}

/** @type {import('esbuild').BuildOptions} */
const conversationOptions = {
  ...hostOptions,
  entryPoints: [CONVERSATION_ENTRY],
  outfile: CONVERSATION_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const sharingRuntimeOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    sharedWire,
    sharedResourceAdmission,
    sharedModelApiBoundaries,
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
const promptsOptions = { ...hostOptions, entryPoints: [PROMPTS_ENTRY], outfile: PROMPTS_OUTFILE }

/** @type {import('esbuild').BuildOptions} */
const modelApiOptions = {
  ...common,
  plugins: [
    sharedUiText,
    sharedValidation,
    deferredCohort,
    sharedWire,
    sharedResourceAdmission,
    sharedStructuredSchema,
    sharedModelApiBoundaries,
    deferredTeamView,
    compressedModelText(isProduction),
  ],
  entryPoints: [MODEL_API_ENTRY],
  outfile: MODEL_API_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
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
const reportingPanelOptions = {
  ...hostOptions,
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedRedaction],
  entryPoints: ['src/host/reporting/reportPanelEntry.ts'],
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

const sessionBoardOptions = {
  ...modelApiOptions,
  entryPoints: [SESSION_BOARD_ENTRY],
  outfile: SESSION_BOARD_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const teamOptions = {
  ...modelApiOptions,
  plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire, sharedModelApiBoundaries],
  entryPoints: [TEAM_ENTRY],
  outfile: TEAM_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const teamSchedulerOptions = {
  ...teamOptions,
  entryPoints: [TEAM_SCHEDULER_ENTRY],
  outfile: TEAM_SCHEDULER_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const teamRunnersOptions = {
  ...teamOptions,
  entryPoints: [TEAM_RUNNERS_ENTRY],
  outfile: TEAM_RUNNERS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const schedulesOptions = {
  ...modelApiOptions,
  entryPoints: [SCHEDULES_ENTRY],
  outfile: SCHEDULES_OUTFILE,
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
  ],
  entryPoints: [REVIEW_ENTRY],
  outfile: REVIEW_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
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
  ],
  entryPoints: [REPORT_ENTRY],
  outfile: REPORT_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

// The capacity estimator's engine (M117, PLAN.md D97), loaded the first
// time an estimate runs; it reads no `vscode` and no backend, so a stray
// import fails this build.
/** @type {import('esbuild').BuildOptions} */
const estimatorOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire],
  entryPoints: [ESTIMATOR_ENTRY],
  outfile: ESTIMATOR_OUTFILE,
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
  ],
  entryPoints: [RECORDER_ENTRY],
  outfile: RECORDER_OUTFILE,
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
  ],
  entryPoints: [PLAN_MARKDOWN_ENTRY],
  outfile: PLAN_MARKDOWN_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
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
  ],
  entryPoints: [WHATS_NEW_ENTRY],
  outfile: WHATS_NEW_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

const usageServiceOptions = {
  ...modelApiOptions,
  entryPoints: [USAGE_SERVICE_ENTRY],
  outfile: 'dist/usageService.js',
}
const usageCompanionOptions = {
  ...modelApiOptions,
  entryPoints: [USAGE_COMPANION_ENTRY],
  outfile: 'dist/usageCompanion.js',
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
const judgeOptions = {
  ...planMarkdownOptions,
  entryPoints: [JUDGE_ENTRY],
  outfile: JUDGE_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const modelsPanelOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, deferredCohort],
  entryPoints: [MODELS_PANEL_ENTRY],
  outfile: MODELS_PANEL_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
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
  ],
  entryPoints: [AGENT_IMPORT_ENTRY],
  outfile: AGENT_IMPORT_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const vaultOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire, sharedModelApiBoundaries],
  entryPoints: [VAULT_ENTRY],
  outfile: VAULT_OUTFILE,
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
  ],
  entryPoints: [BUNDLED_SKILLS_ENTRY],
  outfile: BUNDLED_SKILLS_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const searchWorkerOptions = {
  ...common,
  plugins: [sharedValidation],
  entryPoints: [SEARCH_WORKER_ENTRY],
  outfile: SEARCH_WORKER_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
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
  ],
  entryPoints: [CONVERSATION_GIT_ENTRY],
  outfile: CONVERSATION_GIT_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

// The Model API backend's session store (D14), required when its host is
// first built: the store, its budget journal and the stored-session schemas.
/** @type {import('esbuild').BuildOptions} */
const modelApiSessionsOptions = {
  ...conversationGitOptions,
  entryPoints: [MODEL_API_SESSIONS_ENTRY],
  outfile: MODEL_API_SESSIONS_OUTFILE,
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
  ],
  entryPoints: [CHECKPOINT_STORE_ENTRY],
  outfile: CHECKPOINT_STORE_OUTFILE,
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
const screenRecordOptions = {
  ...common,
  plugins: [sharedUiText, sharedValidation, sharedWire],
  entryPoints: [SCREEN_RECORD_ENTRY],
  outfile: SCREEN_RECORD_OUTFILE,
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
  ],
  entryPoints: [BROWSER_CHECK_ENTRY],
  outfile: BROWSER_CHECK_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
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
  ],
  entryPoints: [BROWSER_RUNTIME_ENTRY],
  outfile: BROWSER_RUNTIME_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
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
    sharedResourceAdmission,
    sharedStructuredSchema,
    deferredTeamView,
    sharedModelApiBoundaries,
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
const runtimeAccountsOptions = {
  ...acpQuestionsOptions,
  entryPoints: [RUNTIME_ACCOUNTS_ENTRY],
  outfile: RUNTIME_ACCOUNTS_OUTFILE,
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
  target: HOST_NODE_TARGET,
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

const vaultBoundariesOptions = {
  ...modelApiOptions,
  plugins: [sharedUiText, sharedValidation],
  entryPoints: ['src/shared/vaultBoundariesEntry.ts'],
  outfile: 'dist/vaultBoundaries.js',
}

const estimateContractsOptions = {
  ...modelApiOptions,
  plugins: [sharedUiText, sharedValidation],
  entryPoints: ['src/shared/estimateContractsEntry.ts'],
  outfile: 'dist/estimateContracts.js',
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
    ...(isProduction ? [lazyBrowserKeybindings] : []),
    browserReviewComment,
    resourceBrowserValidation,
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
  target: BROWSER_TARGET,
  jsx: 'automatic',
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
  target: HOST_NODE_TARGET,
  external: ['vscode', 'mocha'],
}

function reportSize(path) {
  const kib = (statSync(path).size / BYTES_PER_KIB).toFixed(1)
  console.log(`  ${path}  ${kib} KiB`)
}

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
  const { metafile } = await esbuild.build(withCompiledRecording(webviewOptions, buildRecord))
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
    esbuild.context(reportingPanelOptions),
    esbuild.context(hostOptions),
    esbuild.context(conversationOptions),
    esbuild.context(tabOptions),
    esbuild.context(promptsOptions),
    esbuild.context(sharingRuntimeOptions),
    esbuild.context(connectorOptions),
    esbuild.context(modelApiOptions),
    esbuild.context(resourceGovernorOptions),
    esbuild.context(resourceProcessOptions),
    esbuild.context(resourceJournalOptions),
    esbuild.context(resourceAdmissionOptions),
    esbuild.context(providersOptions),
    esbuild.context(subscriptionsOptions),
    esbuild.context(configuredOptions),
    esbuild.context(reviewOptions),
    esbuild.context(sessionBoardOptions),
    esbuild.context(referenceOptions),
    esbuild.context(schedulesOptions),
    esbuild.context(reviewerOptions),
    esbuild.context(teamOptions),
    esbuild.context(teamRunnersOptions),
    esbuild.context(teamSchedulerOptions),
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
      entryPoints: ['src/runtime/runtimeAccountingEntry.ts'],
      outfile: 'dist/runtimeAccounting.js',
    }),
    esbuild.context(hookRuntimeOptions),
    esbuild.context(modelApiToolsOptions),
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
    esbuild.context(mediaOptions),
    esbuild.context(screenRecordOptions),
    esbuild.context(agentImportOptions),
    esbuild.context(conversationGitOptions),
    esbuild.context(modelApiSessionsOptions),
    esbuild.context(rulesFileOptions),
    esbuild.context(nativeGitOptions),
    esbuild.context(bundledSkillsOptions),
    esbuild.context(legalScanOptions),
    esbuild.context(codeIntelOptions),
    esbuild.context(voiceOptions),
    esbuild.context(webFetchOptions),
    esbuild.context(mcpVaultOptions),
    esbuild.context(museCodeReviewerOptions),
    esbuild.context(modelsPanelOptions),
    esbuild.context(modelsSubscriptionsOptions),
    esbuild.context(usageServiceOptions),
    esbuild.context(headlessOptions),
    esbuild.context(usageCompanionOptions),
    esbuild.context(usagePanelOptions),
    esbuild.context(extensionHooksOptions),
    esbuild.context(vaultOptions),
    esbuild.context(reportOptions),
    esbuild.context(estimatorOptions),
    esbuild.context(recorderOptions),
    esbuild.context(whatsNewOptions),
    esbuild.context(judgeOptions),
    esbuild.context(scheduleBackgroundOptions),
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
    esbuild.context(imageResizeWorkerOptions),
    esbuild.context(webviewOptions),
    esbuild.context(fontInstallOptions),
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
    return esbuild.build(isProduction ? withCompiledRecording(options, buildRecord) : options)
  }
  const shippedSpecs = {
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
    tab: recorded('tab', tabOptions),
    prompts: recorded('prompts', promptsOptions),
    sharingRuntime: recorded('sharingRuntime', sharingRuntimeOptions),
    connector: recorded('connector', connectorOptions),
    modelApi: recorded('modelApi', modelApiOptions),
    resourceGovernor: recorded('resourceGovernor', resourceGovernorOptions),
    resourceProcess: recorded('resourceProcess', resourceProcessOptions),
    resourceJournal: recorded('resourceJournal', resourceJournalOptions),
    resourceAdmission: recorded('resourceAdmission', resourceAdmissionOptions),
    providers: recorded('providers', providersOptions),
    subscriptions: recorded('subscriptions', subscriptionsOptions),
    configuredProviders: recorded('configuredProviders', configuredOptions),
    review: recorded('review', reviewOptions),
    sessionBoard: recorded('sessionBoard', sessionBoardOptions),
    reporting: recorded('reporting', reportingOptions),
    reportingNetwork: recorded('reportingNetwork', reportingNetworkOptions),
    reportingDestinations: recorded('reportingDestinations', reportingDestinationsOptions),
    reportingPanel: recorded('reportingPanel', reportingPanelOptions),
    reference: recorded('reference', referenceOptions),
    schedules: recorded('schedules', schedulesOptions),
    reviewer: recorded('reviewer', reviewerOptions),
    team: recorded('team', teamOptions),
    teamRunners: recorded('teamRunners', teamRunnersOptions),
    teamScheduler: recorded('teamScheduler', teamSchedulerOptions),
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
    planMarkdown: recorded('planMarkdown', planMarkdownOptions),
    checkpointStore: recorded('checkpointStore', checkpointStoreOptions),
    media: recorded('media', mediaOptions),
    screenRecord: recorded('screenRecord', screenRecordOptions),
    agentImport: recorded('agentImport', agentImportOptions),
    conversationGit: recorded('conversationGit', conversationGitOptions),
    modelApiSessions: recorded('modelApiSessions', modelApiSessionsOptions),
    rulesFile: recorded('rulesFile', rulesFileOptions),
    nativeGit: recorded('nativeGit', nativeGitOptions),
    bundledSkills: recorded('bundledSkills', bundledSkillsOptions),
    legalScan: recorded('legalScan', legalScanOptions),
    codeIntel: recorded('codeIntel', codeIntelOptions),
    voice: recorded('voice', voiceOptions),
    webFetch: recorded('webFetch', webFetchOptions),
    mcpVault: recorded('mcpVault', mcpVaultOptions),
    museCodeReviewer: recorded('museCodeReviewer', museCodeReviewerOptions),
    modelsPanel: recorded('modelsPanel', modelsPanelOptions),
    modelsSubscriptions: recorded('modelsSubscriptions', modelsSubscriptionsOptions),
    usageService: recorded('usageService', usageServiceOptions),
    usageCompanion: recorded('usageCompanion', usageCompanionOptions),
    usagePanel: recorded('usagePanel', usagePanelOptions),
    extensionHooks: recorded('extensionHooks', extensionHooksOptions),
    vault: recorded('vault', vaultOptions),
    report: recorded('report', reportOptions),
    estimator: recorded('estimator', estimatorOptions),
    recorder: recorded('recorder', recorderOptions),
    whatsNew: recorded('whatsNew', whatsNewOptions),
    judge: recorded('judge', judgeOptions),
    scheduleBackground: recorded('scheduleBackground', scheduleBackgroundOptions),
    uiText: recorded('uiText', uiTextOptions),
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
    imageResizeWorker: recorded('imageResizeWorker', imageResizeWorkerOptions),
    webview: recorded('webview', webviewOptions),
  }
  const extraSpecs = [
    ['acp', () => esbuild.build(acpOptions)],
    ['exec', () => esbuild.build(execOptions)],
    ['headless', () => esbuild.build(headlessOptions)],
    ['acpQuestions', () => esbuild.build(acpQuestionsOptions)],
    ['runtimeQuestions', () => esbuild.build(runtimeQuestionsOptions)],
    ['fontInstall', () => esbuild.build(fontInstallOptions)],
    ['playbook', () => esbuild.build(playbookOptions)],
    ['runtimeAccounts', () => esbuild.build(runtimeAccountsOptions)],
  ]
  if (!isProduction) {
    extraSpecs.push(['integrationTests', () => esbuild.build(integrationTestOptions)])
  }
  let shipped
  let acp
  let exec
  let headless
  let acpQuestions
  let runtimeQuestions
  let fontInstall
  let playbook
  let runtimeAccounts
  try {
    shipped = await runBuildPool(Object.entries(shippedSpecs), BUILD_POOL_SIZE)
    ;({
      acp,
      exec,
      headless,
      acpQuestions,
      runtimeQuestions,
      fontInstall,
      playbook,
      runtimeAccounts,
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
    const { metafile: runtimeAccountsMetafile } = await runtimeAccounts
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'runtimeQuestions.json'),
      JSON.stringify(runtimeQuestionsMetafile, null, 2),
    )
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'runtimeAccounts.json'),
      JSON.stringify(runtimeAccountsMetafile, null, 2),
    )
    writeFileSync(
      path.join(ACP_METAFILE_DIR, 'acpQuestions.json'),
      JSON.stringify(questionsMetafile),
    )
    const execBuild = await exec
    writeFileSync(path.join(ACP_METAFILE_DIR, 'exec.json'), JSON.stringify(execBuild.metafile))
    writeFileSync(path.join(ACP_METAFILE_DIR, 'acpPlaybook.json'), JSON.stringify(playbookMetafile))
  }
  console.log('bundle sizes:')
  reportSize(ACP_QUESTIONS_OUTFILE)
  reportSize(PLAYBOOK_OUTFILE)
  reportSize(HOST_OUTFILE)
  reportSize(CONVERSATION_OUTFILE)
  reportSize(TAB_OUTFILE)
  reportSize(PROMPTS_OUTFILE)
  reportSize(SHARING_RUNTIME_OUTFILE)
  reportSize(CONNECTOR_OUTFILE)
  reportSize(MODEL_API_OUTFILE)
  reportSize(RESOURCE_OUTFILE)
  reportSize(RESOURCE_ADMISSION_OUTFILE)
  reportSize(PROVIDERS_OUTFILE)
  reportSize(SUBSCRIPTIONS_OUTFILE)
  reportSize(CONFIGURED_OUTFILE)
  reportSize(REVIEW_OUTFILE)
  reportSize(SESSION_BOARD_OUTFILE)
  reportSize('dist/reference.js')
  reportSize(REVIEWER_OUTFILE)
  reportSize(TEAM_OUTFILE)
  reportSize(TEAM_RUNNERS_OUTFILE)
  reportSize(TEAM_SCHEDULER_OUTFILE)
  reportSize(FOREIGN_HOOKS_OUTFILE)
  reportSize(HOOK_RUNTIME_OUTFILE)
  reportSize(PLAN_MARKDOWN_OUTFILE)
  reportSize(CHECKPOINT_STORE_OUTFILE)
  reportSize(MEDIA_OUTFILE)
  reportSize(SCREEN_RECORD_OUTFILE)
  reportSize(AGENT_IMPORT_OUTFILE)
  reportSize(CONVERSATION_GIT_OUTFILE)
  reportSize(MODEL_API_SESSIONS_OUTFILE)
  reportSize(RULES_FILE_OUTFILE)
  reportSize(NATIVE_GIT_OUTFILE)
  reportSize(BUNDLED_SKILLS_OUTFILE)
  reportSize(LEGAL_SCAN_OUTFILE)
  reportSize(CODE_INTEL_OUTFILE)
  reportSize(VOICE_OUTFILE)
  reportSize(WEB_FETCH_OUTFILE)
  reportSize(MUSE_CODE_REVIEWER_OUTFILE)
  reportSize(MODELS_PANEL_OUTFILE)
  reportSize(MODELS_SUBSCRIPTIONS_OUTFILE)
  reportSize('dist/usageService.js')
  reportSize('dist/usageCompanion.js')
  reportSize('dist/usagePanel.js')
  reportSize(EXTENSION_HOOKS_OUTFILE)
  reportSize(VAULT_OUTFILE)
  reportSize(REPORT_OUTFILE)
  reportSize(ESTIMATOR_OUTFILE)
  reportSize(RECORDER_OUTFILE)
  reportSize(WHATS_NEW_OUTFILE)
  reportSize(WHATS_NEW_CONTENT_OUTFILE)
  reportSize(JUDGE_OUTFILE)
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
  reportSize(IMAGE_RESIZE_WORKER_OUTFILE)
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.css'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'models.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'models.css'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'usage.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'usage.css'))
  reportSize(PROVIDER_CATALOG_OUTFILE)
  reportSize(path.join(WEBVIEW_OUTDIR, `${WHATS_NEW_PAGE_NAME}.js`))
  reportSize(path.join(WEBVIEW_OUTDIR, `${WHATS_NEW_PAGE_NAME}.css`))
  reportSize(ACP_OUTFILE)
  reportSize('dist/headless.js')
  reportSize(SCHEDULE_BACKGROUND_OUTFILE)
}

// Shared by the production split gate and its real-build red drills.
// Callers supply built inputs; file ownership resolves their real locations.
import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export const BUNDLES = {
  providers: { output: 'dist/providers.js', metafile: 'dist/meta/providers.json' },
  subscriptions: { output: 'dist/subscriptions.js', metafile: 'dist/meta/subscriptions.json' },
  configured: {
    output: 'dist/configuredProviders.js',
    metafile: 'dist/meta/configuredProviders.json',
  },
  activation: { output: 'dist/extension.js', metafile: 'dist/meta/extension.json' },
  modelApi: { output: 'dist/modelApi.js', metafile: 'dist/meta/modelApi.json' },
  acp: { output: 'dist/acp.js', metafile: 'dist/meta-acp/acp.json' },
}
export const SUBSCRIPTION_ONLY = [
  'src/core/providers/subscriptions/chatgpt.ts',
  // RLM109 increment 2: the installed record's schema leaf, which the
  // sign-in core imports and re-exports; the migration chunks carry it
  // beside their codecs through their own declared exceptions.
  'src/core/providers/subscriptions/chatgptRecord.ts',
  'src/core/providers/subscriptions/chatgptHostId.ts',
  // RLM109: the stored ChatGPT record schema, re-exported by chatgpt.ts
  // beside it so one copy serves the subscription dispatch.
  'src/core/providers/subscriptions/chatgptRecord.ts',
  // D207 (2026-10-17): the Copilot adapter's failure rides with the
  // subscription dispatch, like ChatGptSignInError rides in chatgpt.ts. The
  // host adapter reads it through subscriptionsEntry so both bundles share
  // the subscriptions bundle's copy (one `instanceof` across the boundary).
  'src/core/providers/subscriptions/copilotFailure.ts',
  // RLGROKAUTH: the Grok sign-in core, read through subscriptionsEntry like chatgpt.ts.
  'src/core/providers/subscriptions/grok.ts',
  // RLGROKAUTH: the OIDC mechanics both subscription sign-ins share.
  'src/core/providers/subscriptions/oidc.ts',
  // RLM109: the ChatGPT grant's record schema, a leaf chatgpt.ts re-exports.
  'src/core/providers/subscriptions/chatgptRecord.ts',
]
// RLGROKAUTH: subscription dispatch and terminal commands, split out of
// dist/subscriptions.js beside the registry (only files owned by the
// commands bundle are pinned; shared utilities it also carries stay
// unlisted, and every bundle reads the sign-in cores through
// subscriptionsEntry).
export const SUBSCRIPTION_COMMANDS_ONLY = [
  'src/core/providers/subscriptions/registry.ts',
  'src/core/providers/subscriptions/chatgptPlanFacts.ts',
  'src/runtime/subscriptionProviderCommands.ts',
  'src/runtime/chatGptProviderCommands.ts',
  'src/runtime/grokProviderCommands.ts',
  'src/runtime/chatGptHost.ts',
  'src/runtime/grokHost.ts',
  'src/runtime/subscriptionCallback.ts',
  'src/runtime/subscriptionRefreshLock.ts',
]
export const CONFIGURED_TRANSPORT_ONLY = ['authSource.ts', 'providerClient.ts']
export const SHARED_TRANSPORT_ONLY = ['transport.ts', 'sse.ts', 'ndjson.ts']
const MODEL_API_DIR = 'src/core/backends/modelapi'
// M120CAP: shared source modules live here; their existing readers may inline
// them. All other source ownership comes from entry reachability, not names.
const TEAM_SHARED_ROOT = 'src/shared/'
const normalizeTeamLocation = (file) => file.replaceAll('\\', '/').toLowerCase()
const isOutsideRepository = (file) =>
  file === '..' || file.startsWith('../') || path.isAbsolute(file)
export const MODEL_API_OPTIONAL_ONLY = [
  'acpAssist.ts',
  'codeIntelEntry.ts',
  'codeIntelCalls.ts',
  'mcpPoolEntry.ts',
  // D213: a modern server's tool changes, mirrored headers and era
  // verdicts load with the connection that reads them (cc/mcp2).
  'mcp/changes.ts',
  'mcp/connection.ts',
  'mcp/era.ts',
  'mcp/headers.ts',
  'mcp/http.ts',
  'mcp/pool.ts',
  'mcp/servers.ts',
  'mcp/stdio.ts',
  'mcp/verdicts.ts',
]
export const SCHEDULES_ONLY = ['schedulesEntry.ts', 'schedules.ts']
const RUNTIME_SCHEDULES_DIR = 'src/runtime/schedules'
const CORE_SCHEDULES_DIR = 'src/core/schedules'
// M115 W: the v2 runtime binding beside v1 in dist/schedules.js. Only files
// owned by the schedules feature are pinned here; shared utilities the
// bundle also carries (export text, the wire schemas) stay unlisted.
export const SCHEDULES_RUNTIME = [
  'schedulesBundle.ts',
  'runtimeEntry.ts',
  'engine.ts',
  'control.ts',
  'authorityStore.ts',
  'consent.ts',
  'registry.ts',
  'timePlan.ts',
  'wake.ts',
  'runtime.ts',
  'surface.ts',
  'host.ts',
  'command.ts',
  'background.ts',
  'nativeBackground.ts',
  'nodeBackgroundIo.ts',
  'nodeScheduleFs.ts',
  'effectiveDefinition.ts',
  'registration.ts',
  'reportCli.ts',
]
export const SCHEDULES_CORE = [
  'store.ts',
  'scheduler.ts',
  'fireRecord.ts',
  'journal.ts',
  'migrate.ts',
  'delivery.ts',
  'grantAudit.ts',
  'time/cron.ts',
  'time/scheduleTime.ts',
  'time/zonedCalendar.ts',
  'events/conditions.ts',
  'events/ports.ts',
  'events/privacy.ts',
  'events/registry.ts',
  'events/signals.ts',
]
export const DEFERRED_ONLY = ['reviewerEntry.ts', 'hookModelEntry.ts', 'repairAttempt.ts']

export const FOREIGN_HOOKS_ONLY = [
  'foreignHooksEntry.ts',
  'hookFormats.ts',
  'hookFormats/core.ts',
  'hookFormats/engine.ts',
  'hookFormats/transforms.ts',
  'hookFormats/contracts/cline.ts',
  'hookFormats/contracts/copilot.ts',
  'hookFormats/contracts/cursor.ts',
  'hookFormats/contracts/gemini.ts',
  'hookFormats/contracts/kiro.ts',
  'hookFormats/contracts/vscode.ts',
  'hookFormats/contracts/windsurf.ts',
]
export const HOOK_RUNTIME_ONLY = ['hookRuntimeEntry.ts', 'hookHandlers.ts']

export const PLUGIN_HOOKS_ONLY = [
  'pluginHooksEntry.ts',
  'pluginHost.ts',
  'pluginChild.ts',
  'pluginFormats.ts',
]
// MODELAPIDIET: the Model API backend's deferred per-call helpers (the hook
// call fields, argument previews, fetch URL checks), loaded on first use.
// The fetch URL checks live outside the backend's folder, so the DEFERRED
// entry below adds their full paths beside these backend-relative names.
export const MODEL_API_TOOLS_ONLY = [
  'modelApiToolsEntry.ts',
  'modelCallHooks.ts',
  'argumentPreview.ts',
  'observationPacking.ts',
  'searchPaging.ts',
]
// The byte-range file execution (reads and edits of one byte window),
// loaded on the first range addressed call, off the per-call helpers'
// budget.
export const MODEL_API_FILE_RANGE_ONLY = ['modelApiFileRangeEntry.ts', 'fileRangeTools.ts']
// publicAddress.ts stays in dist/modelApi.js: the pinned HTTPS transport
// reads addressFamily for every request's SNI.
export const MODEL_API_TOOLS_WEB = ['src/core/web/pageUrl.ts', 'src/core/web/fetchFailure.ts']
// The verify loop's session side (M68): the loop, its ledger and the
// diagnostics history, loaded on the first turn that verifies tool edits.
// checkCommands.ts, codeFiles.ts and workspaceEdits.ts stay in
// dist/modelApi.js: activation reads them too, and the synchronous tool
// definitions need runChecksDefinition from verifyTools.ts.
export const MODEL_API_VERIFY_ONLY = ['modelApiVerifyEntry.ts', 'verifyLedger.ts', 'verifyLoop.ts']
export const MODEL_API_VERIFY_CORE = ['src/core/verify/diagnosticsReport.ts']
// The image run-path (M34, M44): the call checks, the purchase and the
// paid-use naming, loaded on the first image call, with an attached image's
// resize to the model's bounds (outside the backend's folder, so the record
// below adds its path). imageToolDefinitions.ts stays with the backend: the
// tool list names the tools on every turn.
export const MODEL_API_IMAGE_ONLY = ['modelApiImageEntry.ts', 'imageGeneration.ts']
const MODEL_API_IMAGE_RESIZE = 'src/core/imageResize.ts'
// The B1 hold's session side (M125, D107 §9.3): the confined runner, the
// floor, the veto race and the skip's audit, loaded on the first shell ask
// that reaches the hold with a packaged helper. The judge modules it runs
// live outside the backend's folder, so its record below adds their paths.
export const MODEL_API_B1_ONLY = ['modelApiB1Entry.ts', 'b1Hold.ts']
const MODEL_API_B1_JUDGE = [
  'src/core/judge/fast/approval.ts',
  'src/core/judge/fast/inspectExec.ts',
  'src/core/judge/fast/inspectGrammar.ts',
  'src/shared/fastPathAudit.ts',
]
// What a tool call or goal command runs: the file and shell tools'
// execution, the memory tool's placing and running, the browser check's
// placement and report, and the goal rules, loaded on the first of them.
// tools.ts, memoryTools.ts and goals.ts stay with the backend too: the tool
// list, the permission classes and the goal's prompt section read them on
// every turn, so only the entry is pinned to this bundle.
export const MODEL_API_TOOL_RUN_ONLY = ['modelApiToolRunEntry.ts']
// The fast judge's session side (M125 lane M, D107): the loop detector, the
// first-send triage, the effort and keep-list verdicts and the turn
// boundary, loaded when each turn or compaction starts. The reflex and
// application modules live outside the backend's folder; reflex/loop.ts
// stays with the backend too (the repeat guard reads its call key).
export const MODEL_API_FAST_ONLY = ['modelApiFastEntry.ts', 'fastJudge.ts']
/** The permission engine's shell reader and command rules (dist/modelApiShell.js). */
export const MODEL_API_SHELL_ONLY = ['modelApiShellEntry.ts', 'shellSyntax.ts', 'commandRules.ts']
const MODEL_API_FAST_JUDGE = [
  'src/core/judge/fast/apply.ts',
  'src/core/judge/fast/engines.ts',
  'src/core/judge/fast/turnEnd.ts',
  'src/core/judge/fast/turnRecord.ts',
  'src/core/judge/fast/reflex/done.ts',
  'src/core/judge/fast/reflex/effort.ts',
  'src/core/judge/fast/reflex/failures.ts',
  'src/core/judge/fast/reflex/relevance.ts',
  'src/core/judge/fast/reflex/triage.ts',
]
// INT0170: M107 W2's machine resource journal is shared through its own bundle;
// the governor (recorder) and usage service (reader) load it instead of copies.
const RESOURCE_JOURNAL_SOURCE = 'src/runtime/resources/history.ts'
const RESOURCE_JOURNAL_BUNDLE = {
  output: 'dist/resourceJournal.js',
  metafile: 'dist/meta/resourceJournal.json',
  use: 'the shared resource journal (dist/resourceJournal.js)',
  parents: [
    BUNDLES.activation,
    BUNDLES.modelApi,
    BUNDLES.acp,
    { output: 'dist/resourceGovernor.js', metafile: 'dist/meta/resourceGovernor.json' },
    { output: 'dist/usageService.js', metafile: 'dist/meta/usageService.json' },
  ],
  files: [
    'src/runtime/resources/resourceJournalEntry.ts',
    RESOURCE_JOURNAL_SOURCE,
    'src/core/usage/resourceJournal.ts',
    'src/core/usage/resourceRecords.ts',
    'src/runtime/usage/resourceResetFile.ts',
  ],
}
export const DEFERRED = [
  RESOURCE_JOURNAL_BUNDLE,
  {
    output: 'dist/mcpPool.js',
    metafile: 'dist/meta/mcpPool.json',
    files: ['src/core/backends/modelapi/mcpPoolEntry.ts', 'src/core/backends/modelapi/mcp/pool.ts'],
  },
  {
    output: 'dist/exec.js',
    metafile: 'dist/meta-acp/exec.json',
    files: ['src/runtime/exec/execEntry.ts'],
  },
  {
    // RLTESTDRIVE item 5: the live list read for headless refresh on use.
    // The read itself (providerList.ts) is shared with the terminal
    // commands in dist/acp.js; only the entry loads on first use.
    output: 'dist/providerList.js',
    metafile: 'dist/meta-acp/providerList.json',
    files: ['src/runtime/exec/providerListEntry.ts'],
  },
  {
    output: 'dist/modelApiCodeIntel.js',
    metafile: 'dist/meta/modelApiCodeIntel.json',
    files: [
      'src/core/backends/modelapi/codeIntelEntry.ts',
      'src/core/backends/modelapi/codeIntelCalls.ts',
    ],
  },
  {
    output: 'dist/structuredSchema.js',
    metafile: 'dist/meta/structuredSchema.json',
    files: ['src/shared/structuredSchemaEntry.ts'],
  },

  {
    output: 'dist/runtimeEngine.js',
    metafile: 'dist/meta/runtimeEngine.json',
    files: ['src/runtime/runtimeEngineEntry.ts'],
  },
  {
    output: 'dist/providerPolicy.js',
    metafile: 'dist/meta/providerPolicy.json',
    files: ['src/host/backend/providerPolicyEntry.ts'],
  },
  {
    output: 'dist/runtimeAccounting.js',
    metafile: 'dist/meta/runtimeAccounting.json',
    files: ['src/runtime/runtimeAccountingEntry.ts'],
  },
  {
    output: 'dist/modelApiHooks.js',
    metafile: 'dist/meta/modelApiHooks.json',
    files: ['src/core/backends/modelapi/modelApiHooksEntry.ts'],
  },
  {
    // M105 W: one production media service per session (D85.13). Neither
    // activation, the Model API bundle nor ACP carries its closure.
    output: 'dist/productionMedia.js',
    metafile: 'dist/meta/productionMedia.json',
    files: [
      'src/host/backend/productionMediaEntry.ts',
      'src/host/backend/sessionUploads.ts',
      'src/core/media/productionMedia.ts',
      'src/core/media/replayMedia.ts',
      'src/core/media/mediaCost.ts',
      'src/core/media/mediaCalibration.ts',
      'src/core/media/metaMediaCapabilities.ts',
      'src/core/media/responsesMediaCodec.ts',
      'src/core/media/uploadLedger.ts',
      'src/core/media/uploadLedgerStorage.ts',
      // RVMEDIAV3 3: the conversion root's lease and crash reclaim.
      'src/runtime/privateRootLease.ts',
    ],
  },
  {
    // M105 lane V seam 3B: Muse Voice's batch transcription, its paid seams
    // and the trusted converter, loaded on the first turn with attached sound.
    output: 'dist/productionAudio.js',
    metafile: 'dist/meta/productionAudio.json',
    files: [
      'src/host/backend/productionAudioEntry.ts',
      'src/core/voice/productionAudio.ts',
      'src/core/voice/voiceBatchSeams.ts',
      'src/core/voice/transcribeBatchHttp.ts',
      'src/core/voice/audioMessagePreparation.ts',
      'src/runtime/converterTrust.ts',
    ],
  },
  {
    // M105 lane V seam 5: the runtime's ACP and exec media port and its
    // attached-media registry, loaded on the first media prompt.
    output: 'dist/runtimeMedia.js',
    metafile: 'dist/meta/runtimeMedia.json',
    files: [
      'src/runtime/runtimeMediaEntry.ts',
      'src/acp/mediaPort.ts',
      'src/runtime/exec/filesTransport.ts',
    ],
  },
  {
    output: 'dist/modelApiMcp.js',
    metafile: 'dist/meta/modelApiMcp.json',
    files: [
      'src/core/backends/modelapi/modelApiMcpEntry.ts',
      'src/core/backends/modelapi/mcp/pool.ts',
      'src/core/backends/modelapi/mcp/connection.ts',
      'src/core/backends/modelapi/mcp/era.ts',
      'src/core/backends/modelapi/mcp/http.ts',
      'src/core/backends/modelapi/mcp/stdio.ts',
      'src/core/backends/modelapi/mcp/servers.ts',
      'src/core/backends/modelapi/mcp/changes.ts',
      'src/core/backends/modelapi/mcp/headers.ts',
      'src/core/backends/modelapi/mcp/verdicts.ts',
    ],
  },
  {
    output: 'dist/modelApiAcp.js',
    metafile: 'dist/meta/modelApiAcp.json',
    files: [
      'src/core/backends/modelapi/modelApiAcpEntry.ts',
      'src/core/backends/modelapi/acpAssist.ts',
    ],
  },
  {
    output: 'dist/modelApiShell.js',
    metafile: 'dist/meta/modelApiShell.json',
    // The runtime engine and the schedule delivery bundle keep their own
    // copies of the two modules, so only the backend is a parent.
    parents: [BUNDLES.modelApi],
    files: MODEL_API_SHELL_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
  },
  {
    output: 'dist/vaultBoundaries.js',
    metafile: 'dist/meta/vaultBoundaries.json',
    files: [
      'src/shared/vaultBoundariesEntry.ts',
      'src/shared/redact.ts',
      'src/shared/vault.ts',
      'src/shared/vaultProtocol.ts',
      'src/shared/vaultStatus.ts',
      'src/shared/vaultPanel.ts',
      'src/core/vault/taint.ts',
      'src/core/vault/exec/schema.ts',
      'src/core/vault/exec/toolSchema.ts',
      'src/core/vault/ssh/wire.ts',
      'src/core/vault/ssh/openSshFile.ts',
    ],
  },
  {
    output: 'dist/estimateContracts.js',
    metafile: 'dist/meta/estimateContracts.json',
    files: ['src/shared/estimate.ts', 'src/shared/estimatorProtocol.ts'],
  },
  {
    output: 'dist/modelApiBoundaries.js',
    metafile: 'dist/meta/modelApiBoundaries.json',
    files: [
      'src/shared/modelApiBoundariesEntry.ts',
      'src/core/nodeBoundariesEntry.ts',
      'src/core/pathIdentity.ts',
      'src/core/backends/modelapi/schemas.ts',
      'src/shared/teamConversation.ts',
      'src/shared/paidBoundary.ts',
      'src/shared/usd.ts',
      'src/shared/legal.ts',
      'src/core/backends/modelapi/legalScanTool.ts',
      'src/core/workspacePath.ts',
    ],
  },
  {
    output: 'dist/teamScheduler.js',
    metafile: 'dist/meta/teamScheduler.json',
    entry: 'src/core/team/teamSchedulerEntry.ts',
    files: [
      'src/core/team/teamSchedulerEntry.ts',
      'src/core/team/scheduler/board.ts',
      'src/core/team/scheduler/slots.ts',
      'src/core/team/teamPool.ts',
    ],
  },
  {
    output: 'dist/teamRunners.js',
    metafile: 'dist/meta/teamRunners.json',
    entry: 'src/host/runners/teamRunnersEntry.ts',
    files: [
      'src/host/runners/teamRunnersEntry.ts',
      'src/host/runners/sshRunner.ts',
      'src/host/team/checkSlots.ts',
    ],
  },
  {
    // RLF-TEAMFIT: the Traffic read and dispatch, split out of the runners
    // bundle so its transports fit their budget; first Traffic use.
    output: 'dist/teamTraffic.js',
    metafile: 'dist/meta/teamTraffic.json',
    entry: 'src/host/team/teamTrafficEntry.ts',
    files: [
      'src/host/team/teamTrafficEntry.ts',
      'src/host/modelsPanelTraffic.ts',
      'src/host/team/teamTrafficDispatch.ts',
      'src/host/team/teamTrafficProjection.ts',
    ],
  },
  {
    output: 'dist/teamFileIo.js',
    metafile: 'dist/meta/teamFileIo.json',
    files: ['src/core/team/workers/workerToolIoEntry.ts', 'src/core/team/workers/workerToolIo.ts'],
  },
  {
    output: 'dist/teamCreate.js',
    metafile: 'dist/meta/teamCreate.json',
    files: ['src/core/team/workers/workerCreateEntry.ts'],
  },
  {
    output: 'dist/teamWorkerOps.js',
    metafile: 'dist/meta/teamWorkerOps.json',
    files: ['src/core/team/workers/workerOpsEntry.ts', 'src/core/team/workers/workerOps.ts'],
  },
  {
    output: 'dist/teamMerge.js',
    metafile: 'dist/meta/teamMerge.json',
    files: ['src/core/team/teamMergeFlow.ts'],
  },
  {
    output: 'dist/teamHost.js',
    metafile: 'dist/meta/teamHost.json',
    files: ['src/host/team/teamHostEntry.ts', 'src/core/team/teamHost.ts'],
  },
  {
    // RLF-TEAMFIT: the `team` MCP server, split out of the team host bundle
    // so the host service fits its budget; first team endpoint request.
    output: 'dist/teamMcp.js',
    metafile: 'dist/meta/teamMcp.json',
    entry: 'src/host/team/teamMcpEntry.ts',
    files: ['src/host/team/teamMcpEntry.ts', 'src/host/team/teamMcpServer.ts'],
  },
  {
    output: 'dist/teamEngine.js',
    metafile: 'dist/meta/teamEngine.json',
    files: ['src/host/team/teamEngineEntry.ts', 'src/host/team/teamEnginePorts.ts'],
  },
  {
    output: 'dist/teamPanel.js',
    metafile: 'dist/meta/teamPanel.json',
    files: [
      'src/core/team/teamPanelEntry.ts',
      'src/core/team/teamPanel.ts',
      'src/core/team/teamPanelViews.ts',
    ],
  },
  {
    output: 'dist/team.js',
    metafile: 'dist/meta/team.json',
    entry: 'src/core/team/teamEntry.ts',
    files: ['src/core/team/teamEntry.ts', 'src/core/team/teamTools.ts', 'src/core/team/roster.ts'],
  },

  {
    output: 'dist/execTeam.js',
    metafile: 'dist/meta/execTeam.json',
    files: ['src/runtime/exec/execTeamEntry.ts'],
  },
  {
    output: 'dist/execLedgerLease.js',
    metafile: 'dist/meta/execLedgerLease.json',
    files: ['src/runtime/exec/execLedgerLeaseEntry.ts'],
  },
  {
    output: 'dist/headless.js',
    metafile: 'dist/meta-acp/headless.json',
    files: ['src/runtime/exec/runExec.ts'],
  },
  {
    output: 'dist/usageService.js',
    metafile: 'dist/meta/usageService.json',
    files: [
      'src/runtime/usage/usageServiceEntry.ts',
      'src/runtime/usage/usageAcp.ts',
      'src/core/usage/usageService.ts',
      'src/core/usage/journalStore.ts',
      'src/core/usage/aggregate.ts',
      'src/core/usage/usageText.ts',
      'src/core/backends/musecode/usageDeltas.ts',
    ],
  },
  {
    // RLUSAGE: the usage export encoders, required by dist/usageService.js
    // on the first export (D6). The service must not carry them statically.
    output: 'dist/usageExport.js',
    metafile: 'dist/meta/usageExport.json',
    use: 'the first usage export',
    parents: [
      BUNDLES.activation,
      BUNDLES.modelApi,
      BUNDLES.acp,
      { output: 'dist/usageService.js', metafile: 'dist/meta/usageService.json' },
    ],
    files: ['src/core/usage/usageExportEntry.ts', 'src/core/usage/usageExport.ts'],
  },
  {
    output: 'dist/usageCompanion.js',
    metafile: 'dist/meta/usageCompanion.json',
    files: ['src/runtime/usage/usageCompanionEntry.ts', 'src/runtime/companion/server.ts'],
  },
  {
    output: 'dist/voiceCompanion.js',
    metafile: 'dist/meta/voiceCompanion.json',
    files: [
      'src/runtime/companion/voiceEntry.ts',
      'src/runtime/companion/voiceHandler.ts',
      'src/runtime/companion/voicePaid.ts',
      'src/runtime/companion/voiceSystem.ts',
    ],
  },
  {
    output: 'dist/usagePanel.js',
    metafile: 'dist/meta/usagePanel.json',
    files: [
      'src/host/vscode/usage/usagePanelEntry.ts',
      'src/host/vscode/usage/usagePanel.ts',
      'src/host/vscode/paid/paidDailyBudget.ts',
    ],
  },
  {
    output: 'dist/reference.js',
    metafile: 'dist/meta/reference.json',
    files: [
      'src/shared/reference/referenceEntry.ts',
      'src/runtime/reference.node.generated.ts',
      'src/shared/reference/text.ts',
    ],
  },
  {
    output: 'dist/runtimeMaker.js',
    metafile: 'dist/meta/runtimeMaker.json',
    files: [
      'src/runtime/maker/entry.ts',
      'src/runtime/maker/service.ts',
      'src/runtime/maker/nativeSerial.ts',
      'src/runtime/maker/runtimeMakerHost.ts',
      'src/runtime/maker/companionServer.ts',
      'src/runtime/maker/thonnyServer.ts',
    ],
  },
  {
    output: 'dist/schedules.js',
    metafile: 'dist/meta/schedules.json',
    files: [
      ...SCHEDULES_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
      ...SCHEDULES_RUNTIME.map((name) => `${RUNTIME_SCHEDULES_DIR}/${name}`),
      ...SCHEDULES_CORE.map((name) => `${CORE_SCHEDULES_DIR}/${name}`),
    ],
  },
  {
    // SCHEDULEDELIVERY: the schedules' editor-delivery binding, loaded by
    // dist/schedules.js on the first delivery. Only the entry and the
    // host-owned binding are pinned here; the shared grant, unattended-run
    // and shell-syntax machinery it also carries stays unlisted (only files
    // owned by the schedules feature are pinned above, and modelApi.js
    // carries those shared sources itself).
    output: 'dist/scheduleDelivery.js',
    metafile: 'dist/meta/scheduleDelivery.json',
    use: 'the first schedule delivery',
    files: [
      'src/host/schedules/scheduleDeliveryEntry.ts',
      'src/host/schedules/deliveryBinding.ts',
      'src/host/schedules/backgroundTarget.ts',
    ],
  },
  {
    output: 'dist/scheduleBackground.js',
    metafile: 'dist/meta/scheduleBackground.json',
    use: 'the first native schedule wake or maintenance',
    files: [
      'src/runtime/schedules/backgroundEntry.ts',
      'src/runtime/schedules/nativeBackground.ts',
      'src/runtime/schedules/nodeBackgroundIo.ts',
      'src/runtime/schedules/effectiveDefinition.ts',
      'src/runtime/windowsTrustedPath.ts',
    ],
  },
  {
    output: 'dist/sessionBoard.js',
    metafile: 'dist/meta/sessionBoard.json',
    files: [
      'src/host/sessionBoardEntry.ts',
      'src/host/sessionBoard.ts',
      'src/host/bestOfN/bestOfNManager.ts',
      'src/core/bestOfN/bestOfNRunner.ts',
      'src/core/bestOfN/worktreeConversationHost.ts',
      'src/core/bestOfN/bestOfN.ts',
    ],
  },
  {
    output: 'dist/reviewer.js',
    metafile: 'dist/meta/reviewer.json',
    files: DEFERRED_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
  },
  {
    output: 'dist/foreignHooks.js',
    metafile: 'dist/meta/foreignHooks.json',
    files: FOREIGN_HOOKS_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
  },
  {
    output: 'dist/hookRuntime.js',
    metafile: 'dist/meta/hookRuntime.json',
    files: HOOK_RUNTIME_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
  },
  {
    output: 'dist/pluginHooks.js',
    metafile: 'dist/meta/pluginHooks.json',
    files: PLUGIN_HOOKS_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
  },
  {
    output: 'dist/modelApiTools.js',
    metafile: 'dist/meta/modelApiTools.json',
    files: [
      ...MODEL_API_TOOLS_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
      ...MODEL_API_TOOLS_WEB,
    ],
  },
  {
    output: 'dist/modelApiFileRange.js',
    metafile: 'dist/meta/modelApiFileRange.json',
    files: [...MODEL_API_FILE_RANGE_ONLY.map((name) => `${MODEL_API_DIR}/${name}`)],
  },
  {
    output: 'dist/modelApiVerify.js',
    metafile: 'dist/meta/modelApiVerify.json',
    files: [
      ...MODEL_API_VERIFY_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
      ...MODEL_API_VERIFY_CORE,
    ],
  },
  {
    output: 'dist/legalFix.js',
    metafile: 'dist/meta/legalFix.json',
    files: ['src/core/legal/legalFixEntry.ts', 'src/core/legal/headerFix.ts'],
  },
]

// POSTSPAWN: the governed launcher's own modules, required by the admission
// facade on the first governed launch; no other shipped bundle carries them.
export const RESOURCE_PROCESS_ONLY = [
  'src/core/resources/resourceProcessEntry.ts',
  'src/core/resources/process.ts',
  'src/core/resources/commands.ts',
  'src/host/backend/mediaJobRun.ts',
]
// The MCP job launch, which the launcher shares with the window's activation.
export const RESOURCE_PROCESS_SHARED = ['src/host/backend/mcpJobLaunch.ts']
// RLF-BUDGETS: the Windows tree reader rides its own bundle beside the
// governor's; run.ts and actions.ts ride along because the reader calls
// them and no shared governor library carries them. The governor keeps
// its copies; no other shipped bundle carries these.
export const RESOURCE_WINDOWS_FILES = [
  'src/core/resources/trees/windowsEntry.ts',
  'src/core/resources/trees/windows.ts',
  'src/core/resources/trees/run.ts',
  'src/core/resources/trees/actions.ts',
]
// POSTSPAWN: launch and helper-preparation code the window's activation also
// uses for its own helpers and MCP servers; the governor carries none of it,
// so its 125 KiB cap measures policy alone. The helper preparation launches
// through the lazy launcher (bootstrap compiles), so it ships with its callers
// (activation, the runtime's dist/acp.js), never inside the launcher it loads.
export const RESOURCE_LAUNCH_SHARED = [
  ...RESOURCE_PROCESS_SHARED,
  'src/runtime/resources/jobs.ts',
  'src/host/processTree.ts',
  'src/host/backend/jobBuild.ts',
  'src/host/backend/shellJob.ts',
  'src/host/backend/mcpJobExecutable.ts',
  'src/host/backend/helperIntegrity.ts',
  'src/host/backend/jobSource.ts',
  'src/core/bootstrapCommand.ts',
]
const RESOURCE_GOVERNOR_BUNDLE = {
  output: 'dist/resourceGovernor.js',
  metafile: 'dist/meta/resourceGovernor.json',
}
export const RESOURCE_PROCESS_BUNDLE = {
  output: 'dist/resourceProcess.js',
  metafile: 'dist/meta/resourceProcess.json',
  use: 'the first governed process launch',
  parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp, RESOURCE_GOVERNOR_BUNDLE],
  files: RESOURCE_PROCESS_ONLY,
}

// Split out of activation on 2026-10-03 (D6): each loads on its first use.
// The Model API backend keeps its own copy of code intelligence.
export const ON_FIRST_USE = [
  {
    output: 'dist/editorChat.js',
    metafile: 'dist/meta/editorChat.json',
    use: 'the first editor-chat opt-in action or model call',
    files: ['src/host/vscode/models/lmProvider.ts', 'src/host/models/lmProviderEntry.ts'],
  },
  {
    output: 'dist/resourceGovernor.js',
    metafile: 'dist/meta/resourceGovernor.json',
    use: 'the first governed spawn',
    files: [
      'src/core/resources/resourceGovernorEntry.ts',
      'src/core/resources/launchHost.ts',
      'src/core/resources/governor.ts',
      'src/core/resources/queue.ts',
      'src/core/resources/events.ts',
      'src/core/resources/disk.ts',
      'src/core/resources/createdRegistry.ts',
      'src/core/resources/sampler/system.ts',
      'src/core/resources/trees/registry.ts',
      'src/runtime/resources/entry.ts',
      'src/runtime/resources/host.ts',
      'src/runtime/resources/settings.ts',
      // U–C1: the window's status item and pause notice, never at activation.
      'src/host/resources/resourceStatus.ts',
    ],
  },
  // RLF-BUDGETS: the Windows job-object tree reader, required the first
  // time a Windows job launch binds its tree; the governor keeps its cap.
  {
    output: 'dist/resourceGovernorWindows.js',
    metafile: 'dist/meta/resourceGovernorWindows.json',
    use: "a Windows job launch's first tree bind",
    files: ['src/core/resources/trees/windowsEntry.ts', 'src/core/resources/trees/windows.ts'],
  },
  RESOURCE_PROCESS_BUNDLE,
  // POSTSPAWN: the vault MCP launch (scrubber, leases, governed start); the
  // route checks (mcpSecrets.ts) stay with the pool, whose fetchFor is synchronous.
  {
    output: 'dist/mcpVault.js',
    metafile: 'dist/meta/mcpVault.json',
    use: 'the first vault-backed MCP server',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/host/backend/mcpVaultEntry.ts',
      'src/host/backend/mcpVault.ts',
      'src/core/vault/scrub.ts',
    ],
  },
  // PR206: the Muse Code backend's own bundle, required the first time that
  // backend starts. Only the loader (museCodeBundle.ts) stays at activation;
  // the Model API backend, the ACP agent and the team bundles keep whatever
  // copies of these they carry today, so the parent is activation alone.
  {
    output: 'dist/museCode.js',
    metafile: 'dist/meta/museCode.json',
    use: 'the first Muse Code backend start',
    files: [
      'src/host/backend/museCodeEntry.ts',
      'src/core/backends/musecode/MuseCodeHost.ts',
      'src/core/backends/musecode/mapNotification.ts',
      'src/core/backends/musecode/sessionRecords.ts',
      'src/core/backends/musecode/promptLedger.ts',
      'src/core/backends/musecode/feedback.ts',
    ],
  },
  // POSTSPAWN: the 1.4.4 `model/list` effort catalogue reader (C-M106-3R2);
  // the manager's preload keeps it out of the activation bundle (lane K
  // budget) while every spawn reads the same captured catalogue.
  {
    output: 'dist/modelEfforts.js',
    metafile: 'dist/meta/modelEfforts.json',
    use: 'the first model catalogue read',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    // Pure validation: no English of its own, so no shared-table import.
    uiText: false,
    files: [
      'src/core/backends/musecode/modelEffortsEntry.ts',
      'src/core/backends/musecode/modelEfforts.ts',
    ],
  },
  // M108 lane P: another account's paid consent, its store and its tariff;
  // activation and the ACP engine carry only the tiny route (accountPaidRoute.ts).
  {
    output: 'dist/accountPaid.js',
    metafile: 'dist/meta/accountPaid.json',
    use: 'the first paid use billed to another account',
    parents: [
      BUNDLES.activation,
      BUNDLES.modelApi,
      BUNDLES.acp,
      { output: 'dist/runtimeEngine.js', metafile: 'dist/meta/runtimeEngine.json' },
    ],
    files: [
      'src/host/paid/accountPaidEntry.ts',
      'src/host/paid/accountPaidFiles.ts',
      'src/core/paid/accountPaidConsent.ts',
    ],
  },
  {
    output: 'dist/legalScan.js',
    metafile: 'dist/meta/legalScan.json',
    use: 'the first legal scan',
    files: [
      'src/core/legal/compat.ts',
      'src/core/legal/data.ts',
      'src/core/legal/depLicenses.ts',
      'src/core/legal/dependencies.ts',
      'src/core/legal/distribution.ts',
      'src/core/legal/ecosystems/cargo.ts',
      'src/core/legal/ecosystems/composer.ts',
      'src/core/legal/ecosystems/gems.ts',
      'src/core/legal/ecosystems/go.ts',
      'src/core/legal/ecosystems/jvm.ts',
      'src/core/legal/ecosystems/npm.ts',
      'src/core/legal/ecosystems/nuget.ts',
      'src/core/legal/ecosystems/python.ts',
      'src/core/legal/ecosystems/toml.ts',
      'src/core/legal/entry.ts',
      'src/core/legal/files.ts',
      'src/core/legal/headers.ts',
      'src/core/legal/markdown.ts',
      'src/core/legal/projectLicense.ts',
      'src/core/legal/scan.ts',
      'src/core/legal/spdx.ts',
      'src/core/legal/workspace.ts',
    ],
  },
  {
    output: 'dist/devices.js',
    metafile: 'dist/meta/devices.json',
    use: 'an explicit Devices method',
    files: [
      'src/host/devices/deviceEntry.ts',
      'src/shared/devicesPanel.ts',
      'src/host/devices/devicePairing.ts',
      'src/host/devices/deviceStore.ts',
      'src/host/devices/deviceDiscovery.ts',
      'src/host/devices/deviceSecrets.ts',
      'src/host/devices/deviceReceiver.ts',
      'src/host/devices/deviceTransport.ts',
      'src/host/devices/deviceChannel.ts',
      'src/host/devices/deviceMessageHandler.ts',
      'src/core/devices/pairing.ts',
      'src/core/devices/grants.ts',
      'src/core/devices/attemptJournal.ts',
      'src/core/devices/devicePanel.ts',
      'src/core/devices/deviceAddress.ts',
      'src/core/devices/deviceFraming.ts',
      'src/host/devices/deviceProduction.ts',
      // RLF-DEVICES: the panel prompt queue and the maker executors'
      // loader; the executors stay out of this bundle's cap (dist/maker.js).
      'src/host/devices/makerSurface.ts',
      'src/host/devices/makerBundle.ts',
      // The panel state embeds the prompt schema, so this bundle carries
      // the protocol; the maker bundle carries its own copy beside it.
      'src/shared/maker.ts',
    ],
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
  },
  {
    // RLF-DEVICES: the maker executors and their simulators. The panel
    // surface stays in dist/devices.js; only executions load this.
    output: 'dist/maker.js',
    metafile: 'dist/meta/maker.json',
    use: 'the first maker execution',
    parents: [{ output: 'dist/devices.js', metafile: 'dist/meta/devices.json' }],
    // No English of its own (prompts render in the panel and ACP), so no
    // shared-table import.
    uiText: false,
    // The protocol (src/shared/maker.ts) stays listed with dist/devices.js,
    // whose panel state embeds its schema; this bundle carries its copy
    // unlisted, like the shared utilities other bundles carry.
    files: [
      'src/host/devices/makerEntry.ts',
      'src/host/devices/makerService.ts',
      'src/core/maker/classify.ts',
      'src/core/maker/analysis.ts',
      'src/core/maker/approval.ts',
      'src/core/maker/executors.ts',
      'src/core/maker/simulators.ts',
    ],
  },
  {
    output: 'dist/reportingNetwork.js',
    metafile: 'dist/meta/reportingNetwork.json',
    use: 'the first permitted report network read',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/runtime/reporting/network.ts',
      'src/core/reporting/sources/cache.ts',
      'src/core/reporting/sources/admission.ts',
      'src/core/reporting/sources/github.ts',
    ],
  },
  {
    output: 'dist/reportingDestinations.js',
    metafile: 'dist/meta/reportingDestinations.json',
    use: 'the first scheduled report action',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/runtime/reporting/destinationsEntry.ts',
      'src/core/reporting/destinations/runner.ts',
      'src/core/reporting/destinations/email.ts',
      'src/core/reporting/destinations/post.ts',
    ],
  },
  {
    output: 'dist/reporting.js',
    metafile: 'dist/meta/reporting.json',
    use: 'the first deterministic report',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/runtime/reporting/reportsEntry.ts',
      'src/runtime/reporting/engine.ts',
      'src/core/reporting/collect/index.ts',
      'src/core/reporting/render/index.ts',
      'src/core/reporting/history.ts',
      'src/core/reporting/plan/reader.ts',
    ],
  },
  {
    output: 'dist/reportingPanel.js',
    metafile: 'dist/meta/reportingPanel.json',
    use: 'the first report tab',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/host/vscode/reporting/reportPanelEntry.ts',
      'src/host/vscode/reporting/reportPanel.ts',
    ],
  },
  {
    output: 'dist/reportInputs.js',
    metafile: 'dist/meta/reportInputs.json',
    use: 'the first report input read',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: ['src/runtime/reporting/reportInputsEntry.ts', 'src/runtime/reporting/reportInputs.ts'],
  },
  {
    output: 'dist/playbookSchedulesInputs.js',
    metafile: 'dist/meta/playbookSchedulesInputs.json',
    use: 'the first playbook, schedules or issues report read',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/runtime/reporting/playbookSchedulesInputsEntry.ts',
      'src/runtime/reporting/playbookSchedulesInputs.ts',
    ],
  },
  {
    output: 'dist/media.js',
    metafile: 'dist/meta/media.json',
    use: 'the first media attachment or trusted media read',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/core/media/inspectEntry.ts',
      'src/core/media/limits.ts',
      'src/core/media/sniff/isoBmff.ts',
      'src/core/media/sniff/ebml.ts',
      'src/core/media/sniff/riff.ts',
      'src/core/media/sniff/mp3.ts',
    ],
  },
  // M105 RLF-RECORDING: the screen-recording drivers (Windows, macOS,
  // the Linux portal). The recording command's own bundle carries the
  // preview and the latest-file discovery; neither it nor activation may
  // carry a driver file.
  {
    output: 'dist/screenRecordDrivers.js',
    metafile: 'dist/meta/screenRecordDrivers.json',
    use: 'the first screen recording start',
    parents: [
      BUNDLES.activation,
      { output: 'dist/screenRecord.js', metafile: 'dist/meta/screenRecord.json' },
    ],
    files: [
      'src/host/media/recordingDriverEntry.ts',
      'src/host/media/recordingDriver.ts',
      'src/host/media/recordingHelperProcess.ts',
      'src/host/media/recordingLineFramer.ts',
      'src/host/media/recordingInspect.ts',
      'src/host/media/linuxRecorderPort.ts',
      'src/host/media/macosRecorderDeps.ts',
      'src/host/media/windowsRecorderDeps.ts',
      'src/core/media/record/linux.ts',
      'src/core/media/record/macos.ts',
      'src/core/media/record/windows.ts',
    ],
  },
  {
    output: 'dist/questionNotes.js',
    metafile: 'dist/meta/questionNotes.json',
    use: 'the first backend question deferral',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: ['src/core/questions/deferralEntry.ts'],
  },
  {
    output: 'dist/toolRange.js',
    metafile: 'dist/meta/toolRange.json',
    use: 'the first byte-range file read or edit',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: ['src/host/backend/toolRangeEntry.ts', 'src/host/backend/toolRangeIo.ts'],
  },
  {
    output: 'dist/approvalModes.js',
    metafile: 'dist/meta/approvalModes.json',
    use: 'the first approval-mode change, schedule admission or restore',
    parents: [BUNDLES.activation, BUNDLES.acp],
    files: ['src/core/backends/musecode/approvalModesEntry.ts'],
  },
  {
    output: 'dist/runtimeQuestions.js',
    metafile: 'dist/meta-acp/runtimeQuestions.json',
    use: 'the first interactive ACP session with durable questions',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/runtime/questions/questionRegistryEntry.ts',
      'src/runtime/questions/acpRegistry.ts',
    ],
  },
  {
    output: 'dist/acpQuestions.js',
    metafile: 'dist/meta-acp/acpQuestions.json',
    use: 'the first ACP question, elicitation or question command',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: ['src/acp/questionDeferralEntry.ts', 'src/acp/questionDeferral.ts'],
  },
  {
    output: 'dist/makerContracts.js',
    metafile: 'dist/meta/makerContracts.json',
    use: 'the first maker message or hardware approval',
    files: ['src/shared/makerProtocol.ts', 'src/shared/makerProtocolPreview.ts'],
  },
  {
    output: 'dist/makerHost.js',
    metafile: 'dist/meta/makerHost.json',
    use: 'the first maker UI or device tool',
    files: [
      'src/host/maker/makerEntry.ts',
      'src/host/vscode/maker/vscodeMakerHost.ts',
      'src/host/vscode/maker/makerCommands.ts',
      'src/host/ide/makerTools.ts',
    ],
  },
  {
    output: 'dist/makerPreviewHost.js',
    metafile: 'dist/meta/makerPreviewHost.json',
    use: 'the first maker preview',
    files: ['src/host/maker/makerPreviewEntry.ts', 'src/host/vscode/maker/makerPreviewPanel.ts'],
  },
  {
    output: 'dist/verifyEditor.js',
    metafile: 'dist/meta/verifyEditor.json',
    use: 'the first diagnostics or formatting request',
    files: ['src/host/vscode/editor/verifyEditor.ts', 'src/core/verify/jsonDiagnostics.ts'],
  },
  {
    output: 'dist/runtimeAccounts.js',
    metafile: 'dist/meta-acp/runtimeAccounts.json',
    use: 'the first accounts, developer or keyed headless ACP command',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/runtime/providers/accountsEntry.ts',
      'src/runtime/providers/runtimeServices.ts',
      'src/runtime/providers/providersFileStore.ts',
      'src/runtime/developer/developerCommand.ts',
      'src/runtime/developer/localFiles.ts',
      'src/core/developer/developerOptions.ts',
      'src/core/developer/surfaces.ts',
      'src/core/providers/accounts.ts',
      'src/core/providers/accountPolicy.ts',
      'src/core/providers/accountCredentialRecord.ts',
      'src/host/providers/accountSecrets.ts',
    ],
  },
  {
    output: 'dist/conversation.js',
    metafile: 'dist/meta/conversation.json',
    use: 'the first chat surface',
    files: [
      'src/host/conversation/conversationEntry.ts',
      'src/host/conversation/conversationController.ts',
    ],
  },
  // CONVBUDGET: the conversation's session-transfer flows (the export, the
  // transfer parse, the import refusal and the message count), required on
  // the first export, import or share-file preview; the first chat surface
  // keeps no transfer implementation.
  {
    output: 'dist/conversationTransfer.js',
    metafile: 'dist/meta/conversationTransfer.json',
    use: 'the first session export, import or share-file preview',
    parents: [
      BUNDLES.activation,
      { output: 'dist/conversation.js', metafile: 'dist/meta/conversation.json' },
    ],
    files: [
      'src/host/conversation/conversationTransferEntry.ts',
      'src/host/conversation/exportConversation.ts',
      'src/host/conversation/sessionImport.ts',
      'src/core/export/sessionTransfer.ts',
      'src/core/export/transcriptMarkdown.ts',
    ],
  },
  {
    // SCHEDULESURFACES: the conversation's schedule surfaces, loaded by
    // dist/conversation.js and dist/extension.js on the first schedule
    // delivery, panel command or scheduled question.
    output: 'dist/scheduleSurfaces.js',
    metafile: 'dist/meta/scheduleSurfaces.json',
    use: 'the first schedule surface',
    files: [
      'src/host/conversation/scheduleSurfacesEntry.ts',
      'src/host/conversation/scheduleSurfaces.ts',
    ],
  },
  {
    output: 'dist/judge.js',
    metafile: 'dist/meta/judge.json',
    use: 'the first eligible Judge approval',
    files: [
      'src/host/judge/judgeEntry.ts',
      'src/host/judge/judgeTransport.ts',
      'src/host/judge/judgeUse.ts',
      'src/host/judge/judgeUsage.ts',
      'src/host/judge/museCodeSameJudge.ts',
      'src/host/judge/modelApiSameJudge.ts',
      'src/core/judge/admission.ts',
      'src/core/judge/entries.ts',
      'src/core/judge/judge.ts',
      'src/core/judge/math.ts',
      'src/core/judge/techniques.ts',
      'src/core/judge/prompt.ts',
      'src/core/judge/resolve.ts',
      'src/core/judge/same/allowRules.ts',
      'src/core/judge/same/answers.ts',
      'src/core/judge/same/batches.ts',
      'src/core/judge/same/resultCache.ts',
      'src/core/judge/same/scheduler.ts',
      'src/core/judge/same/sessionSpec.ts',
      'src/core/judge/same/sideRequest.ts',
      'src/core/judge/same/wording.ts',
    ],
  },
  {
    output: 'dist/tab.js',
    metafile: 'dist/meta/tab.json',
    use: 'the first Tab request or menu',
    files: [
      'src/host/tab/tabEntry.ts',
      'src/host/vscode/tab/tabProvider.ts',
      'src/host/tab/tabConsent.ts',
      'src/host/tab/tabEligibility.ts',
      'src/host/vscode/tab/tabStatus.ts',
      'src/host/tab/tabLedger.ts',
      'src/host/tab/tabSpendGate.ts',
      'src/core/tab/tabCache.ts',
      'src/core/tab/tabContext.ts',
      'src/core/tab/tabEngine.ts',
      'src/core/tab/tabHooks.ts',
      'src/core/tab/tabReply.ts',
      'src/core/tab/tabRequest.ts',
      'src/core/tab/tabScheduler.ts',
      'src/core/tab/tabSpend.ts',
    ],
  },
  {
    output: 'dist/codeIntel.js',
    metafile: 'dist/meta/codeIntel.json',
    use: 'the first code intelligence call',
    files: [
      'src/host/ide/codeIntelEntry.ts',
      'src/core/codeIntel/codeIntelQuery.ts',
      'src/core/codeIntel/codeIntelTools.ts',
      'src/core/codeIntel/codeText.ts',
      'src/core/codeIntel/rename.ts',
      'src/core/codeIntel/repoMap.ts',
    ],
  },
  {
    output: 'dist/voice.js',
    metafile: 'dist/meta/voice.json',
    use: 'the first recording',
    files: [
      'src/host/voice/voiceEntry.ts',
      'src/host/voice/voiceProcesses.ts',
      'src/core/voice/dictation.ts',
      'src/core/voice/museVoice.ts',
      'src/core/voice/recorderHelper.ts',
    ],
  },
  // Linux's offline voice driver (M9, D140), split out of dist/voice.js:
  // the driver glue and its helper/model acquisition load only on the first
  // Linux recording, keeping voice.js inside its cap.
  {
    output: 'dist/voiceLinux.js',
    metafile: 'dist/meta/voiceLinux.json',
    use: 'the first Linux recording',
    files: [
      'src/host/voice/voiceLinuxEntry.ts',
      'src/core/voice/linuxDictation.ts',
      'src/core/voice/linuxHelper.ts',
      'src/core/voice/linuxModel.ts',
    ],
  },
  // Voice dictation's setups (M9, M35): the window's dictation and Muse
  // Voice setups with the helper probes, required at their existing
  // construction points, keeping activation's lane-K growth inside its cap.
  {
    output: 'dist/dictation.js',
    metafile: 'dist/meta/dictation.json',
    use: 'the window dictation setup construction',
    files: [
      'src/host/voice/dictationEntry.ts',
      'src/host/voice/dictationHost.ts',
      'src/host/voice/voiceBundle.ts',
      'src/core/voice/helperLocation.ts',
    ],
  },
  // The window's web fetch (M69), split out on 2026-10-04: the Model API
  // backend keeps its own URL checks, the ACP agent its own fetch.
  {
    output: 'dist/webFetch.js',
    metafile: 'dist/meta/webFetch.json',
    use: 'the first web fetch',
    files: [
      'src/host/web/webFetchEntry.ts',
      'src/host/web/webFetcher.ts',
      'src/host/web/pinnedRequest.ts',
      'src/core/web/webFetch.ts',
      'src/core/web/fetchFailure.ts',
      'src/core/web/pageUrl.ts',
      'src/core/web/publicAddress.ts',
      'src/core/web/mimeType.ts',
      'src/core/web/textDecoding.ts',
    ],
  },
  {
    output: 'dist/museCodeReviewer.js',
    metafile: 'dist/meta/museCodeReviewer.json',
    use: 'the first review',
    files: [
      'src/host/review/museCodeReviewerEntry.ts',
      'src/host/review/museCodeReviewer.ts',
      'src/core/backends/modelapi/autoReviewer.ts',
    ],
  },
  // PANELBUDGET: the subscriptions half of the Models & Agents panel's host
  // side (the sign-in flows), split out of dist/modelsPanel.js; activation
  // requires it on the first subscription action, the panel never does.
  {
    output: 'dist/modelsSubscriptions.js',
    metafile: 'dist/meta/modelsSubscriptions.json',
    use: 'the first subscription action',
    parents: [
      BUNDLES.activation,
      { output: 'dist/modelsPanel.js', metafile: 'dist/meta/modelsPanel.json' },
    ],
    files: [
      'src/host/models/modelsSubscriptionsEntry.ts',
      'src/host/vscode/providers/subscriptionFeatures.ts',
      'src/host/vscode/providers/chatgptSignIn.ts',
      'src/host/vscode/providers/copilotClient.ts',
    ],
  },
  // RLGROKAUTH: subscription dispatch and terminal commands (the registry
  // beside the sign-in flows), split out of dist/subscriptions.js; every
  // bundle reads the sign-in cores through subscriptionsEntry.
  {
    output: 'dist/subscriptionCommands.js',
    metafile: 'dist/meta/subscriptionCommands.json',
    use: 'the first subscription action',
    files: ['src/host/backend/subscriptionCommandsEntry.ts', ...SUBSCRIPTION_COMMANDS_ONLY],
  },
  // ACTIVATIONROOM: the CLI-backed and workspace command flows (the MCP
  // servers and hooks pickers, the skills flows, the worktree flows, the
  // memory flow and the Plans picker), required on the first of those
  // commands; activation keeps no command implementation.
  {
    output: 'dist/commands.js',
    metafile: 'dist/meta/commands.json',
    use: 'the first CLI-backed or workspace command',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: [
      'src/host/commands/commandsEntry.ts',
      'src/host/commands/museConfigCommands.ts',
      'src/host/commands/skillsCommands.ts',
      'src/host/commands/worktreeCommands.ts',
      'src/host/commands/memoryCommands.ts',
      'src/host/commands/planCommands.ts',
    ],
  },
  // The report dialog (M93, PLAN.md D72), split out from the start, and the
  // Diagnostics command's report text (D14), loaded on that command's first run.
  {
    output: 'dist/report.js',
    metafile: 'dist/meta/report.json',
    use: 'the first report dialog or Diagnostics command',
    files: [
      'src/host/support/reportEntry.ts',
      'src/host/conversation/reportProblemHandler.ts',
      'src/host/support/reportProblem.ts',
      'src/core/support/problemReport.ts',
      'src/core/support/report.ts',
    ],
  },
  // The report fallback (lane REPORTFLOW R2): the same sealed draft behind
  // the editor's own quick pick, when the dialog cannot open. Split out
  // beside the dialog bundle it replaces, never into activation.
  {
    output: 'dist/reportFallback.js',
    metafile: 'dist/meta/reportFallback.json',
    use: 'the report fallback',
    files: [
      'src/host/support/reportFallbackEntry.ts',
      'src/host/support/reportFallback.ts',
      'src/host/support/reportProblem.ts',
      'src/core/support/problemReport.ts',
    ],
  },
  // The capacity estimator's engine (M117, PLAN.md D6, D97): the host, the
  // CLI and the ACP agent require it the first time an estimate runs.
  {
    output: 'dist/estimator.js',
    metafile: 'dist/meta/estimator.json',
    use: 'the first estimate',
    files: [
      'src/host/estimator/estimatorEntry.ts',
      'src/core/estimator/goal.ts',
      'src/core/estimator/baseRisk.ts',
      'src/core/estimator/calibration/fit.ts',
      'src/core/estimator/calibration/records.ts',
      'src/core/estimator/schedule.ts',
      'src/core/estimator/simulate.ts',
      'src/core/estimator/bottleneck.ts',
      'src/core/estimator/recommend.ts',
      'src/core/estimator/prices.ts',
    ],
  },
  // The estimator run's composer parsing and first-wave start (PLAN.md D6):
  // the host, the CLI and the ACP agent require it the first time an
  // estimate parses a composer command or starts its first wave.
  {
    output: 'dist/estimateActions.js',
    metafile: 'dist/meta/estimateActions.json',
    use: "an estimate's first composer parse or first-wave start",
    files: [
      'src/host/estimator/estimateActionsEntry.ts',
      'src/runtime/estimator/command.ts',
      'src/core/estimator/provision/owner.ts',
      'src/core/estimator/provision/start.ts',
    ],
  },
  // The estimator's plan snapshot (M117 C-M117-1, PLAN.md D6, D97): the
  // host, the CLI and the ACP agent require it the first time an estimate
  // needs a plan snapshot. It carries M113's plan reader beside the shared
  // core adapter; the reader stays listed under the reporting bundle too.
  {
    output: 'dist/planSnapshot.js',
    metafile: 'dist/meta/planSnapshot.json',
    use: 'the first estimate needing a plan snapshot',
    files: [
      'src/host/estimator/planSnapshotEntry.ts',
      'src/host/estimator/planSnapshotSource.ts',
      'src/core/estimator/planSnapshot.ts',
    ],
  },
  // The estimator history's journal (M117 C-M117-2, PLAN.md D6): the
  // window requires it the first time an estimate reads its history, so the
  // journal and its record rules never ride in activation.
  {
    output: 'dist/estimateHistory.js',
    metafile: 'dist/meta/estimateHistory.json',
    use: "an estimate's first history read",
    files: [
      'src/host/estimator/historyEntry.ts',
      'src/host/estimator/historyStore.ts',
      'src/core/estimator/calibration/journal.ts',
    ],
  },
  // The VS Code window's playbook (M116 lane C-M116-6, PLAN.md D6, D96): the
  // window requires it on the first playbook request and starts the same
  // file as its worker thread; the policy never loads at activation.
  {
    output: 'dist/playbook.js',
    metafile: 'dist/meta/playbook.json',
    use: 'the first playbook request',
    files: [
      'src/host/playbook/playbookEntry.ts',
      'src/host/playbook/playbookWindow.ts',
      'src/host/playbook/playbookPanel.ts',
      'src/host/playbook/playbookWorker.ts',
      'src/host/playbook/workerProtocol.ts',
      'src/host/playbook/containedJob.ts',
      'src/host/playbook/teamPlaybook.ts',
      'src/runtime/playbook/governor.ts',
      'src/runtime/playbook/surface.ts',
      'src/core/orchestration/panelLanes.ts',
      'src/core/orchestration/panelPlaybook.ts',
      'src/core/orchestration/playbookIntegration.ts',
      'src/core/orchestration/playbook/policy.ts',
      'src/core/orchestration/playbook/journal.ts',
      'src/core/orchestration/playbook/outcomes.ts',
    ],
  },
  // The flight recorder's journal (M93, PLAN.md D6, D72): activation keeps
  // only the front that answers and queues; the journal, its policy and the
  // frame mapping load just after activation or at the first failure.
  {
    output: 'dist/recorder.js',
    metafile: 'dist/meta/recorder.json',
    use: 'the journal, just after activation',
    files: [
      'src/host/support/recorderEntry.ts',
      'src/host/support/reportJournal.ts',
      'src/host/support/hostFrames.ts',
      'src/core/support/flightRecorder.ts',
      'src/core/support/journalEvents.ts',
    ],
  },
  // The credential lease (M95 D74, PLAN.md D6): activation and the CLIs
  // keep only the callers; the lease and its journal load on the first
  // guarded credential write or Connect recovery.
  {
    output: 'dist/credentialLease.js',
    metafile: 'dist/meta/credentialLease.json',
    use: 'the first guarded credential write or Connect recovery',
    parents: [BUNDLES.activation, BUNDLES.acp],
    files: ['src/core/credentialLeaseEntry.ts', 'src/core/credentialLease.ts'],
  },
  // What's New (M99, D79): activation keeps the update check, the claim and
  // the loader; the page is required on the first page or notice.
  {
    output: 'dist/whatsNew.js',
    metafile: 'dist/meta/whatsNew.json',
    use: 'the first What’s New page or notice',
    files: [
      'src/host/whatsNew/whatsNewEntry.ts',
      'src/host/vscode/whatsNew/whatsNewPanel.ts',
      'src/host/whatsNew/whatsNewHtml.ts',
      'src/core/whatsNew/whatsNewContent.ts',
      'src/shared/whatsNewMessages.ts',
    ],
  },
  // The sign-in gate (CIFIX161B, PLAN.md D6): activation keeps only the
  // bundle loader; AuthService and the three-valued credential
  // read load the first time a credential, money or consent path needs
  // them.
  {
    output: 'dist/auth.js',
    metafile: 'dist/meta/auth.json',
    use: 'the first credential, money or consent read',
    files: [
      'src/host/auth/authEntry.ts',
      'src/host/auth/authService.ts',
      'src/host/auth/credentialRead.ts',
    ],
  },
  // The paid features (CIFIX161B, PLAN.md D6): activation keeps only the
  // bundle loader; the gate, consent, usage and quote authority
  // load the first time a paid path needs them.
  {
    output: 'dist/paid.js',
    metafile: 'dist/meta/paid.json',
    use: 'the first paid consent, gate or usage read',
    files: [
      'src/host/paid/paidEntry.ts',
      'src/host/vscode/paid/paidHost.ts',
      'src/core/paid/paidConsent.ts',
      'src/core/paid/paidFeatures.ts',
      'src/core/paid/paidAuthority.ts',
    ],
  },
  // The image run-path (M34, M44, PLAN.md D6): the call checks, the
  // purchase and the paid-use naming, loaded on the first image call, and
  // an attached image's resize, loaded on the first one that needs it. The
  // backend entry keeps the tool list and requires this entry for the run
  // itself; activation keeps its own copy for the `ide` image tools (M44),
  // whose MODEL_TEXT keys it reads, so only the backend entry is its parent.
  {
    output: 'dist/modelApiImage.js',
    metafile: 'dist/meta/modelApiImage.json',
    use: 'the first image call or attached image resize',
    parents: [BUNDLES.modelApi],
    files: [
      ...MODEL_API_IMAGE_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
      MODEL_API_IMAGE_RESIZE,
    ],
  },
  // The B1 hold (M125, PLAN.md D107 §9.3, D6): the confined runner, the
  // floor, the veto race and the skip's audit, loaded on the first shell ask
  // that reaches the hold with a packaged helper. The backend keeps the ask,
  // the card and the skip's delivery; the agent events and the flight
  // recorder keep their own copy of the audit schema, so only the backend
  // entry is its parent.
  {
    output: 'dist/modelApiB1.js',
    metafile: 'dist/meta/modelApiB1.json',
    use: 'the first shell ask through the B1 hold',
    parents: [BUNDLES.modelApi],
    files: [...MODEL_API_B1_ONLY.map((name) => `${MODEL_API_DIR}/${name}`), ...MODEL_API_B1_JUDGE],
  },
  // What a tool call or goal command runs (PLAN.md D6): the file and shell
  // tools' execution, the memory tool's placing and running, the browser
  // check's placement and report, and the goal rules, loaded on the first
  // of them. The backend keeps the tool list, the permission classes and
  // every check before a card.
  {
    output: 'dist/modelApiToolRun.js',
    metafile: 'dist/meta/modelApiToolRun.json',
    use: 'the first tool call or goal command it runs',
    parents: [BUNDLES.modelApi],
    files: MODEL_API_TOOL_RUN_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
  },
  // The fast judge's session side (M125 lane M, PLAN.md D107, D6), loaded
  // when each turn or compaction starts. The Muse Code backend and the
  // runtime engine keep their own copies of the shared reflex modules, so
  // only the backend entry is its parent.
  {
    output: 'dist/modelApiFast.js',
    metafile: 'dist/meta/modelApiFast.json',
    use: 'the first turn or compaction',
    parents: [BUNDLES.modelApi],
    files: [
      ...MODEL_API_FAST_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
      ...MODEL_API_FAST_JUDGE,
    ],
  },
]
/** The same parent exclusions and destination requirements used by the CLI. */
export function checkDeferredBundles(inputsOf, metafileOf) {
  const problems = []
  const makerHost = inputsOf(ON_FIRST_USE.find((bundle) => bundle.output === 'dist/makerHost.js'))
  for (const file of [
    'src/host/maker/makerPreviewEntry.ts',
    'src/host/vscode/maker/makerPreviewPanel.ts',
  ]) {
    if (makerHost.has(file))
      problems.push(
        `dist/makerHost.js carries ${file}, which loads only on the first maker preview`,
      )
  }
  for (const [names, owner] of [
    [CONFIGURED_TRANSPORT_ONLY, BUNDLES.configured],
    [SHARED_TRANSPORT_ONLY, BUNDLES.modelApi],
  ]) {
    for (const name of names) {
      const source = `${MODEL_API_DIR}/${name}`
      if (!inputsOf(owner).has(source)) problems.push(`${owner.output} no longer carries ${source}`)
      for (const parent of Object.values(BUNDLES)) {
        if (parent === owner) continue
        if (inputsOf(parent).has(source))
          problems.push(`${parent.output} carries ${source}, which loads only in ${owner.output}`)
      }
    }
  }
  if (!inputsOf(BUNDLES.configured).has('src/core/providers/configured.ts'))
    problems.push('dist/configuredProviders.js no longer carries src/core/providers/configured.ts')
  for (const source of SUBSCRIPTION_ONLY) {
    if (!inputsOf(BUNDLES.subscriptions).has(source))
      problems.push(`dist/subscriptions.js no longer carries ${source}`)
    if (inputsOf(BUNDLES.providers).has(source))
      problems.push(`dist/providers.js carries ${source}, which loads only on subscription use`)
  }
  for (const bundle of [...DEFERRED, ...ON_FIRST_USE]) {
    const inputs = inputsOf(bundle)
    const parents =
      bundle.parents ??
      (DEFERRED.includes(bundle) || bundle.output === 'dist/resourceGovernor.js'
        ? [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp]
        : [BUNDLES.activation])
    for (const file of bundle.files) {
      for (const parent of parents) {
        if (inputsOf(parent).has(file)) {
          problems.push(
            `${parent.output} carries ${file}, which loads only on ${bundle.use ?? 'its first action'}`,
          )
        }
      }
      if (!inputs.has(file)) problems.push(`${bundle.output} no longer carries ${file}`)
    }
  }
  const teamBundles = DEFERRED.filter((bundle) => bundle.entry !== undefined)
  const repository = realpathSync(process.cwd())
  const locations = new Map()
  const nonFileInputs = new Map()
  const classify = (raw) => {
    // esbuild omits the file namespace, prefixes plugin IDs with namespace:,
    // and wraps builtin virtual IDs (including data URLs) in angle brackets.
    // Production file IDs are relative. A drive prefix is ambiguous with a
    // single-letter plugin namespace, so it cannot establish file ownership.
    if (raw.startsWith('<') || raw.includes(':')) {
      const id = `virtual:${raw}`
      nonFileInputs.set(id, raw)
      return {
        id,
        namespace: 'virtual',
        dependency: false,
        shared: TEAM_SHARED_VIRTUAL_INPUTS.has(raw),
        error:
          /^[a-z]:[/\\]/i.test(raw) && !TEAM_SHARED_VIRTUAL_INPUTS.has(raw)
            ? 'ambiguous drive-prefixed metafile ID'
            : undefined,
      }
    }
    const resolved = path.resolve(raw.replaceAll('\\', '/'))
    const key = normalizeTeamLocation(resolved)
    const cached = locations.get(key)
    if (cached !== undefined) return cached
    const lexical = normalizeTeamLocation(path.relative(repository, resolved))
    let canonical = lexical
    let error
    if (isOutsideRepository(lexical)) error = 'resolves outside the repository'
    else {
      try {
        canonical = normalizeTeamLocation(path.relative(repository, realpathSync(resolved)))
        if (isOutsideRepository(canonical)) error = 'resolves outside the repository'
        else if (canonical !== lexical && canonical.startsWith(TEAM_SHARED_ROOT))
          error = `symlink alias into ${TEAM_SHARED_ROOT}`
        else if (!statSync(resolved).isFile()) error = 'does not resolve to a real repository file'
      } catch {
        error = 'does not resolve to a real repository file'
      }
    }
    const location = {
      id: `file:${canonical}`,
      namespace: 'file',
      dependency: error === undefined && canonical.startsWith('node_modules/'),
      shared: error === undefined && canonical.startsWith(TEAM_SHARED_ROOT),
      error,
    }
    locations.set(key, location)
    return location
  }
  const owners = new Map()
  for (const bundle of teamBundles) {
    const graph = new Map()
    for (const [raw, details] of Object.entries(metafileOf(bundle).inputs)) {
      const location = classify(raw)
      if (location.error !== undefined)
        problems.push(`${bundle.output} has invalid file input ${raw}: ${location.error}`)
      graph.set(location.id, details.imports)
    }
    const reached = new Set()
    const visit = (raw) => {
      const location = classify(raw)
      if (reached.has(location.id)) return
      reached.add(location.id)
      const imports = graph.get(location.id)
      if (imports === undefined) {
        problems.push(`${bundle.output} is missing graph input ${raw}`)
        return
      }
      const readers = owners.get(location.id) ?? new Set()
      readers.add(bundle.output)
      owners.set(location.id, readers)
      for (const imported of imports) if (!imported.external) visit(imported.path)
    }
    visit(bundle.entry)
  }
  // Namespace ownership follows the full graph, including tree-shaken inputs
  // and non-file modules imported by real installed dependencies.
  for (const [id, raw] of nonFileInputs) {
    const readers = owners.get(id)
    if (readers === undefined || readers.size <= 1 || TEAM_SHARED_VIRTUAL_INPUTS.has(raw)) continue
    for (const output of readers)
      problems.push(
        `${output} carries shared non-file module ${raw}; only explicitly allowlisted plugin IDs may be shared`,
      )
  }
  for (const bundle of teamBundles) {
    for (const raw of inputsOf(bundle).keys()) {
      const location = classify(raw)
      const file = location.namespace === 'file' ? raw.replaceAll('\\', '/') : raw
      if (location.error !== undefined)
        problems.push(`${bundle.output} has invalid file input ${file}: ${location.error}`)
      if (location.dependency) continue
      const readers = owners.get(location.id)
      if (readers === undefined || !readers.has(bundle.output)) {
        problems.push(
          `${bundle.output} carries ${file}, which belongs in ${readers === undefined ? 'no reachable team entry' : [...readers].join(', ')}`,
        )
      } else if (readers.size > 1 && location.namespace === 'file' && !location.shared) {
        problems.push(
          `${bundle.output} carries shared implementation ${file}; shared source modules belong under ${TEAM_SHARED_ROOT}`,
        )
      }
    }
  }
  // POSTSPAWN: the governor never carries the launcher's machinery again.
  for (const file of RESOURCE_LAUNCH_SHARED) {
    if (inputsOf(RESOURCE_GOVERNOR_BUNDLE).has(file))
      problems.push(
        `${RESOURCE_GOVERNOR_BUNDLE.output} carries ${file}, which loads only with the governed launcher (${RESOURCE_PROCESS_BUNDLE.output})`,
      )
  }
  for (const file of RESOURCE_PROCESS_SHARED)
    if (!inputsOf(RESOURCE_PROCESS_BUNDLE).has(file))
      problems.push(`${RESOURCE_PROCESS_BUNDLE.output} no longer carries ${file}`)
  // CAPS017: account services take the engine's backend factory through their
  // port; the backend closure stays in dist/runtimeEngine.js.
  const runtimeAccounts = ON_FIRST_USE.find((bundle) => bundle.output === 'dist/runtimeAccounts.js')
  for (const file of [
    'src/runtime/backends.ts',
    'src/core/backends/musecode/MuseCodeHost.ts',
    'src/host/backend/toolIo.ts',
  ]) {
    if (inputsOf(runtimeAccounts).has(file))
      problems.push(
        `${runtimeAccounts.output} carries ${file}, which the engine supplies through the accounts port`,
      )
  }
  // CAPS017: classic zod's unused locales stay out of the ACP engine.
  const runtimeEngine = DEFERRED.find((bundle) => bundle.output === 'dist/runtimeEngine.js')
  for (const file of inputsOf(runtimeEngine).keys()) {
    if (/^node_modules\/zod\/v4\/locales\/(?!(?:en|index)\.js$)/.test(file))
      problems.push(`${runtimeEngine.output} carries ${file}; only zod's English locale ships`)
  }
  // Session export remains available to the conversation and ACP front ends;
  // the backend loads its import sanitizer only from the existing lazy runtime.
  const transfer = 'src/core/export/sessionTransfer.ts'
  if (inputsOf(BUNDLES.modelApi).has(transfer))
    problems.push(`${BUNDLES.modelApi.output} carries ${transfer}, which loads only on import`)
  const importRuntime = DEFERRED.find((bundle) => bundle.output === 'dist/foreignHooks.js')
  if (!inputsOf(importRuntime).has(transfer))
    problems.push(`${importRuntime.output} no longer carries ${transfer}`)
  // The plugin host loads only on the first plugin hook: the adapters' bundle
  // requires it rather than carry it (M91b).
  {
    const adapters = inputsOf(DEFERRED.find((bundle) => bundle.output === 'dist/foreignHooks.js'))
    for (const name of PLUGIN_HOOKS_ONLY) {
      const file = `${MODEL_API_DIR}/${name}`
      if (adapters.has(file)) {
        problems.push(
          `dist/foreignHooks.js carries ${file}, which loads only on the first plugin hook`,
        )
      }
    }
  }
  const acp = inputsOf(BUNDLES.acp)
  for (const file of ['src/host/support/recorderEntry.ts', 'src/host/support/reportJournal.ts']) {
    if (acp.has(file))
      problems.push(
        `${BUNDLES.acp.output} carries ${file}, which loads only from the recorder bundle`,
      )
  }
  const providerSources = ['anthropic', 'chat', 'gemini', 'ollama', 'responses'].map(
    (name) => `${MODEL_API_DIR}/codecs/${name}.ts`,
  )
  for (const source of providerSources) {
    if (!inputsOf(BUNDLES.providers).has(source))
      problems.push(`dist/providers.js no longer carries ${source}`)
  }
  for (const bundle of [
    ...Object.values(BUNDLES),
    ...DEFERRED,
    ...ON_FIRST_USE,
    { output: 'dist/modelsPanel.js', metafile: 'dist/meta/modelsPanel.json' },
    { output: 'dist/pageWorker.js', metafile: 'dist/meta/pageWorker.json' },
  ]) {
    if (bundle === BUNDLES.providers) continue
    for (const source of inputsOf(bundle).keys()) {
      if (
        (source.startsWith(`${MODEL_API_DIR}/codecs/`) ||
          source.startsWith('src/core/providers/')) &&
        !(bundle === BUNDLES.subscriptions && SUBSCRIPTION_ONLY.includes(source)) &&
        !(
          bundle.output === 'dist/subscriptionCommands.js' &&
          SUBSCRIPTION_COMMANDS_ONLY.includes(source)
        ) &&
        !(source === 'src/core/providers/configured.ts' && bundle === BUNDLES.configured) &&
        !(
          bundle.output === 'dist/providerPolicy.js' &&
          ['credentialRecord.ts', 'endpointPolicy.ts'].some(
            (file) => source === `src/core/providers/${file}`,
          )
        ) &&
        // RLM95B (2026-10-22): the editor-chat provider validates the
        // editor's model ref with the shared parse, like providerPolicy.
        // The ref must not fork validation, and the bundle must not wait
        // on the providers bundle: the tiny module rides along.
        !(source === 'src/core/providers/modelRef.ts' && bundle.output === 'dist/editorChat.js') &&
        // RLF-M95B2 (2026-10-23): the provider's pure conversion moved
        // beside the ref parse so unit tests drive the real code. It
        // rides only in the editor-chat bundle, like the parse.
        !(
          source === 'src/core/providers/editorChat.ts' && bundle.output === 'dist/editorChat.js'
        ) &&
        !(
          source === 'src/core/providers/priceCard.ts' && bundle.output === 'dist/usageService.js'
        ) &&
        // C-M113-2: the session and usage inputs read M102's journal
        // through its store, whose static record import carries the card.
        // Reporting never prices; the bytes ride the journal machinery.
        !(
          source === 'src/core/providers/priceCard.ts' && bundle.output === 'dist/reportInputs.js'
        ) &&
        // RLUSAGE: the usage export encoders read the same journal store
        // schemas; the export never prices either.
        !(
          source === 'src/core/providers/priceCard.ts' && bundle.output === 'dist/usageExport.js'
        ) &&
        !(
          source === 'src/core/providers/keyInspection.ts' &&
          (bundle.output === 'dist/modelsPanel.js' || bundle.output === 'dist/runtimeAccounts.js')
        ) &&
        !(
          bundle.output === 'dist/runtimeAccounts.js' &&
          ['accounts.ts', 'accountPolicy.ts', 'accountCredentialRecord.ts'].some(
            (file) => source === `src/core/providers/${file}`,
          )
        )
      )
        problems.push(`${bundle.output} carries ${source}, which loads only in dist/providers.js`)
    }
  }
  const wire = { output: 'dist/wire.js', metafile: 'dist/meta/wire.json' }
  for (const file of WIRE_FILES) {
    if (!inputsOf(wire).has(file)) problems.push(`${wire.output} no longer carries ${file}`)
    for (const bundle of [...Object.values(BUNDLES), ...DEFERRED, ...ON_FIRST_USE]) {
      if (inputsOf(bundle).has(file))
        problems.push(`${bundle.output} duplicates shared wire schemas in ${file}`)
    }
  }
  const imageWorker = {
    output: 'dist/imageResizeWorker.js',
    metafile: 'dist/meta/imageResizeWorker.json',
  }
  const rasterOnly = [
    'src/core/imageResizeWorker.ts',
    'node_modules/jpeg-js/',
    'node_modules/pngjs/',
  ]
  for (const prefix of rasterOnly) {
    if (
      inputsOf(imageWorker)
        .keys()
        .every((file) => !file.startsWith(prefix))
    )
      problems.push(`${imageWorker.output} no longer carries ${prefix}`)
    for (const bundle of [
      ...Object.values(BUNDLES),
      ...DEFERRED,
      ...ON_FIRST_USE,
      { output: 'dist/modelsPanel.js', metafile: 'dist/meta/modelsPanel.json' },
      { output: 'dist/pageWorker.js', metafile: 'dist/meta/pageWorker.json' },
    ]) {
      if (
        inputsOf(bundle)
          .keys()
          .some((file) => file.startsWith(prefix))
      )
        problems.push(
          `${bundle.output} carries ${prefix}, which runs only on the image resize worker`,
        )
    }
  }
  for (const output of [
    'dist/reporting.js',
    'dist/reportingPanel.js',
    'dist/reportingNetwork.js',
    'dist/reportingDestinations.js',
  ]) {
    const bundle = ON_FIRST_USE.find((entry) => entry.output === output)
    for (const input of inputsOf(bundle).keys()) {
      const normalized = input.replaceAll('\\', '/')
      if (normalized.startsWith('src/core/backends/') || normalized.startsWith('src/host/backend/'))
        problems.push(`${output} carries a backend: ${normalized}`)
      if (normalized.startsWith('src/core/paid/'))
        problems.push(`${output} carries the paid gate: ${normalized}`)
    }
  }
  return problems
}

/** Resource policy is shared through one lazy governor and one admission shim. */
export function checkResourceBundles(inputsOf, bundles) {
  const problems = []
  for (const bundle of bundles) {
    const output = bundle.output.replaceAll('\\', '/')
    for (const raw of inputsOf(bundle).keys()) {
      const file = raw.replaceAll('\\', '/')
      if (!file.startsWith('src/core/resources/')) continue
      if (
        [
          'src/core/resources/admission.ts',
          'src/core/resources/launcher.ts',
          'src/core/resources/admissionEntry.ts',
        ].includes(file)
      ) {
        if (output !== 'dist/resourceAdmission.js')
          problems.push(`${output} duplicates resource admission`)
      } else if (
        output !== 'dist/resourceGovernor.js' &&
        !(output === RESOURCE_PROCESS_BUNDLE.output && RESOURCE_PROCESS_ONLY.includes(file)) &&
        !(output === 'dist/resourceGovernorWindows.js' && RESOURCE_WINDOWS_FILES.includes(file)) &&
        !['src/core/resources/launch.ts', 'src/core/resources/trees/processTable.ts'].includes(file)
      ) {
        problems.push(`${output} carries resource policy ${file} outside the lazy governor`)
      }
    }
  }
  return problems
}

/** @type {import('esbuild').Plugin} */
export const sharedUiText = {
  name: 'shared-ui-text',
  setup(build) {
    // esbuild sends this filter to Go RE2, which rejects JavaScript's u flag.
    // `en`, `en.js` and `en.ts` all name the table's TypeScript source.
    build.onResolve({ filter: /\/en(?:\.[jt]s)?$/ }, (args) =>
      path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts')) ===
      path.resolve('src/shared/l10n/en.ts')
        ? { path: './uiText.js', external: true }
        : undefined,
    )
  },
}

// Share the used mini-parser API across Node bundles; browsers and integration
// test bundles still inline it. The split gate checks every runtime member.
/** @type {import('esbuild').Plugin} */
export const sharedValidation = {
  name: 'shared-validation',
  setup(build) {
    build.onResolve({ filter: /^zod\/mini$/ }, () => ({
      path: './validation.js',
      external: true,
    }))
  },
}

// Maker schemas remain outside startup and are shared by the lazy guard,
// maker host and standalone runtime instead of being copied into each one.
export const sharedMakerContracts = {
  name: 'shared-maker-contracts',
  setup(build) {
    build.onResolve({ filter: /\/makerProtocol(?:\.[jt]s)?$/ }, (args) => {
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      return source === path.resolve('src/shared/makerProtocol.ts') &&
        path.resolve(build.initialOptions.outfile ?? '') !== path.resolve('dist/makerContracts.js')
        ? { path: './makerContracts.js', external: true }
        : undefined
    })
  },
}

// Keep dynamic imports dynamic: these entries run only on their first action.
// Exported for the generated lazy registry (scripts/gen-lazy-registry.mjs):
// the source entry each filename-loaded bundle resolves from.
/** @type {import('esbuild').Plugin} */
export const DEFERRED_OUTFILES = new Map([
  [path.resolve('src/core/resources/resourceGovernorEntry.ts'), 'dist/resourceGovernor.js'],
  [path.resolve('src/core/resources/trees/windowsEntry.ts'), 'dist/resourceGovernorWindows.js'],
  [path.resolve('src/core/resources/resourceProcessEntry.ts'), 'dist/resourceProcess.js'],
  [path.resolve('src/host/backend/mcpVaultEntry.ts'), 'dist/mcpVault.js'],
  [path.resolve('src/core/backends/musecode/modelEffortsEntry.ts'), 'dist/modelEfforts.js'],
  [path.resolve('src/host/paid/accountPaidEntry.ts'), 'dist/accountPaid.js'],
  [path.resolve('src/runtime/runtimeEngineEntry.ts'), 'dist/runtimeEngine.js'],
  [path.resolve('src/host/backend/providerPolicyEntry.ts'), 'dist/providerPolicy.js'],
  [path.resolve('src/runtime/runtimeAccountingEntry.ts'), 'dist/runtimeAccounting.js'],
  [path.resolve('src/core/backends/modelapi/modelApiHooksEntry.ts'), 'dist/modelApiHooks.js'],
  [path.resolve('src/core/backends/modelapi/modelApiMcpEntry.ts'), 'dist/modelApiMcp.js'],
  [path.resolve('src/core/backends/modelapi/modelApiAcpEntry.ts'), 'dist/modelApiAcp.js'],
  [path.resolve('src/core/backends/modelapi/modelApiShellEntry.ts'), 'dist/modelApiShell.js'],
  [path.resolve('src/runtime/exec/runExec.ts'), 'dist/headless.js'],
  [path.resolve('src/runtime/exec/execTeamEntry.ts'), 'dist/execTeam.js'],
  [path.resolve('src/runtime/exec/execLedgerLeaseEntry.ts'), 'dist/execLedgerLease.js'],
  [path.resolve('src/runtime/usage/usageAcp.ts'), 'dist/usageService.js'],
  [path.resolve('src/core/usage/usageExportEntry.ts'), 'dist/usageExport.js'],
  [path.resolve('src/host/backend/providersEntry.ts'), 'dist/providers.js'],
  [path.resolve('src/host/backend/subscriptionsEntry.ts'), 'dist/subscriptions.js'],
  [path.resolve('src/host/backend/subscriptionCommandsEntry.ts'), 'dist/subscriptionCommands.js'],
  [path.resolve('src/host/backend/configuredProvidersEntry.ts'), 'dist/configuredProviders.js'],
  [path.resolve('src/runtime/chatGptProviderCommands.ts'), 'dist/subscriptionCommands.js'],
  [path.resolve('src/runtime/grokProviderCommands.ts'), 'dist/subscriptionCommands.js'],
  [path.resolve('src/host/devices/deviceEntry.ts'), 'dist/devices.js'],
  [path.resolve('src/core/media/inspectEntry.ts'), 'dist/media.js'],
  [path.resolve('src/host/media/recordingDriverEntry.ts'), 'dist/screenRecordDrivers.js'],
  [path.resolve('src/core/questions/deferralEntry.ts'), 'dist/questionNotes.js'],
  [path.resolve('src/host/backend/toolRangeEntry.ts'), 'dist/toolRange.js'],
  [path.resolve('src/core/backends/musecode/approvalModesEntry.ts'), 'dist/approvalModes.js'],
  [path.resolve('src/host/maker/makerEntry.ts'), 'dist/makerHost.js'],
  [path.resolve('src/host/maker/makerPreviewEntry.ts'), 'dist/makerPreviewHost.js'],
  [path.resolve('src/core/backends/modelapi/mcpPoolEntry.ts'), 'dist/mcpPool.js'],
  [path.resolve('src/runtime/exec/execEntry.ts'), 'dist/exec.js'],
  [path.resolve('src/runtime/exec/providerListEntry.ts'), 'dist/providerList.js'],
  [path.resolve('src/core/backends/modelapi/codeIntelEntry.ts'), 'dist/modelApiCodeIntel.js'],
  [path.resolve('src/runtime/schedules/backgroundEntry.ts'), 'dist/scheduleBackground.js'],
  [path.resolve('src/host/support/reportEntry.ts'), 'dist/report.js'],
  [
    path.resolve('src/host/conversation/conversationTransferEntry.ts'),
    'dist/conversationTransfer.js',
  ],
  [path.resolve('src/host/support/reportFallbackEntry.ts'), 'dist/reportFallback.js'],
  [path.resolve('src/host/support/recorderEntry.ts'), 'dist/recorder.js'],
  [path.resolve('src/core/credentialLeaseEntry.ts'), 'dist/credentialLease.js'],
  [path.resolve('src/host/sessionBoardEntry.ts'), 'dist/sessionBoard.js'],
  [path.resolve('src/core/team/teamPanelEntry.ts'), 'dist/teamPanel.js'],
  [path.resolve('src/core/team/teamEntry.ts'), 'dist/team.js'],
  [path.resolve('src/core/team/teamSchedulerEntry.ts'), 'dist/teamScheduler.js'],
  [path.resolve('src/host/estimator/estimateActionsEntry.ts'), 'dist/estimateActions.js'],
  [path.resolve('src/core/team/scheduler/teamWindowEntry.ts'), 'dist/teamWindow.js'],
  [path.resolve('src/host/team/teamLandingEntry.ts'), 'dist/teamLanding.js'],
  [path.resolve('src/host/runners/teamRunnersEntry.ts'), 'dist/teamRunners.js'],
  [path.resolve('src/host/team/teamTrafficEntry.ts'), 'dist/teamTraffic.js'],
  [path.resolve('src/host/team/teamHostEntry.ts'), 'dist/teamHost.js'],
  [path.resolve('src/host/team/teamMcpEntry.ts'), 'dist/teamMcp.js'],
  [path.resolve('src/host/team/teamEngineEntry.ts'), 'dist/teamEngine.js'],
  [path.resolve('src/core/team/workers/workerToolIoEntry.ts'), 'dist/teamFileIo.js'],
  [path.resolve('src/core/team/workers/workerCreateEntry.ts'), 'dist/teamCreate.js'],
  [path.resolve('src/core/team/workers/workerOpsEntry.ts'), 'dist/teamWorkerOps.js'],
  [path.resolve('src/core/team/teamMergeFlow.ts'), 'dist/teamMerge.js'],
  [path.resolve('src/core/backends/modelapi/schedulesEntry.ts'), 'dist/schedules.js'],
  [path.resolve('src/host/schedules/scheduleDeliveryEntry.ts'), 'dist/scheduleDelivery.js'],
  [path.resolve('src/host/conversation/scheduleSurfacesEntry.ts'), 'dist/scheduleSurfaces.js'],
  [path.resolve('src/core/backends/modelapi/reviewerEntry.ts'), 'dist/reviewer.js'],
  [path.resolve('src/core/backends/modelapi/foreignHooksEntry.ts'), 'dist/foreignHooks.js'],
  [path.resolve('src/core/backends/modelapi/hookRuntimeEntry.ts'), 'dist/hookRuntime.js'],
  [path.resolve('src/host/web/webFetchEntry.ts'), 'dist/webFetch.js'],
  [path.resolve('src/core/backends/modelapi/pluginHooksEntry.ts'), 'dist/pluginHooks.js'],
  [path.resolve('src/host/backend/productionMediaEntry.ts'), 'dist/productionMedia.js'],
  [path.resolve('src/host/backend/productionAudioEntry.ts'), 'dist/productionAudio.js'],
  [path.resolve('src/runtime/runtimeMediaEntry.ts'), 'dist/runtimeMedia.js'],
  [path.resolve('src/core/backends/modelapi/modelApiToolsEntry.ts'), 'dist/modelApiTools.js'],
  [
    path.resolve('src/core/backends/modelapi/modelApiFileRangeEntry.ts'),
    'dist/modelApiFileRange.js',
  ],
  [path.resolve('src/core/backends/modelapi/modelApiVerifyEntry.ts'), 'dist/modelApiVerify.js'],
  [path.resolve('src/core/backends/modelapi/modelApiImageEntry.ts'), 'dist/modelApiImage.js'],
  [path.resolve('src/core/backends/modelapi/modelApiB1Entry.ts'), 'dist/modelApiB1.js'],
  [path.resolve('src/core/backends/modelapi/modelApiToolRunEntry.ts'), 'dist/modelApiToolRun.js'],
  [path.resolve('src/core/backends/modelapi/modelApiFastEntry.ts'), 'dist/modelApiFast.js'],
  [path.resolve('src/core/legal/legalFixEntry.ts'), 'dist/legalFix.js'],
  [path.resolve('src/host/commands/commandsEntry.ts'), 'dist/commands.js'],
  [path.resolve('src/host/auth/authEntry.ts'), 'dist/auth.js'],
  [path.resolve('src/host/paid/paidEntry.ts'), 'dist/paid.js'],
  [path.resolve('src/runtime/reporting/reportInputsEntry.ts'), 'dist/reportInputs.js'],
  [
    path.resolve('src/runtime/reporting/playbookSchedulesInputsEntry.ts'),
    'dist/playbookSchedulesInputs.js',
  ],
])
// Exact metafile ID -> generating plugin. These team plugins currently create
// no shared virtual modules, so no non-file input receives an exception.
const TEAM_SHARED_VIRTUAL_INPUTS = new Map()
/** @type {import('esbuild').Plugin} */
export const deferredCohort = {
  name: 'deferred-cohort',
  setup(build) {
    // The file adapter must reuse the host's retained-grant WeakMap.
    build.onResolve({ filter: /\/workerFence(?:\.ts)?$/ }, (args) => {
      if (
        path.resolve(args.importer) === path.resolve('src/core/team/workers/workerToolIo.ts') ||
        path.resolve(build.initialOptions.outfile ?? '') === path.resolve('dist/teamEngine.js')
      )
        return { path: './teamHost.js', external: true }
    })
    // M120CAP: team.js is already loaded before its scheduler. Its stateless
    // tool factory shares declarations/model text without another startup chunk.
    build.onResolve({ filter: /\/teamTools(?:\.[jt]s)?$/ }, (args) =>
      path.resolve(args.importer) === path.resolve('src/core/team/teamSchedulerEntry.ts') &&
      path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts')) ===
        path.resolve('src/core/team/teamTools.ts')
        ? { path: './team.js', external: true }
        : undefined,
    )
    // RLF-TEAMFIT: the MCP server and the team host service read the same
    // tool definitions, argument parsers and roster text from team.js,
    // which already carries them for the Model API team's tools; the MCP
    // server reads the pure JSON-RPC handler there too. The team entry
    // re-exports exactly the members they import.
    build.onResolve({ filter: /\/(?:teamTools|roster|mcp)(?:\.[jt]s)?$/ }, (args) => {
      const outfile = path.resolve(build.initialOptions.outfile ?? '')
      if (
        outfile !== path.resolve('dist/teamMcp.js') &&
        outfile !== path.resolve('dist/teamHost.js')
      )
        return
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      const shared =
        outfile === path.resolve('dist/teamMcp.js')
          ? ['src/core/team/teamTools.ts', 'src/core/team/roster.ts', 'src/core/mcp.ts']
          : ['src/core/team/teamTools.ts', 'src/core/team/roster.ts']
      return shared.some((file) => source === path.resolve(file))
        ? { path: './team.js', external: true }
        : undefined
    })
    // The runners and the scheduler load only through their team runtime,
    // so those builds read the shared team schemas from the already-loaded
    // team.js instead of carrying second copies. Only those builds rewrite:
    // every other bundle keeps bundling these modules locally.
    build.onResolve({ filter: /\/(?:team|teamView)(?:\.[jt]s)?$/ }, (args) => {
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      const outfile = path.resolve(build.initialOptions.outfile ?? '')
      return (outfile === path.resolve('dist/teamRunners.js') ||
        outfile === path.resolve('dist/teamScheduler.js') ||
        outfile === path.resolve('dist/teamTraffic.js')) &&
        (source === path.resolve('src/shared/team.ts') ||
          source === path.resolve('src/shared/teamView.ts'))
        ? { path: './team.js', external: true }
        : undefined
    })
    // RLF-TEAMCORE (M96c): the window scheduler bundle rides the scheduler
    // bundle's board, slots, pool and write-set code (the M120CAP pattern):
    // teamHost loads dist/teamWindow.js only for a team workspace, and the
    // scheduler entry re-exports exactly the members the window binding
    // imports from those modules.
    build.onResolve({ filter: /\/(?:board|slots|teamPool)(?:\.[jt]s)?$/ }, (args) => {
      if (path.resolve(build.initialOptions.outfile ?? '') !== path.resolve('dist/teamWindow.js'))
        return
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      const shared = [
        'src/core/team/scheduler/board.ts',
        'src/core/team/scheduler/slots.ts',
        'src/core/team/teamPool.ts',
      ]
      return shared.some((file) => source === path.resolve(file))
        ? { path: './teamScheduler.js', external: true }
        : undefined
    })
    // RLF-TEAMCORE (M96c): the Traffic projection rides the window bundle's
    // shared-file and write-set matching (pure functions, no shared state),
    // which the window entry re-exports for it. The projection loads with
    // the Traffic bundle (RLF-TEAMFIT; it rode the runners bundle before).
    build.onResolve({ filter: /\/(?:writeSets|sharedFiles)(?:\.[jt]s)?$/ }, (args) => {
      if (path.resolve(build.initialOptions.outfile ?? '') !== path.resolve('dist/teamTraffic.js'))
        return
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      const shared = ['src/core/team/writeSets.ts', 'src/core/team/sharedFiles.ts']
      return shared.some((file) => source === path.resolve(file))
        ? { path: './teamWindow.js', external: true }
        : undefined
    })
    // The shared request/framing implementations stay in the existing backend
    // bundle; providers and ACP require its exported API only when used.
    // The refusal classifier rides the lazy provider bundle: the Model API
    // bundle reads it across the boundary only on an error, keeping its pin.
    // Static imports keep bundling it locally everywhere else.
    build.onResolve({ filter: /\/refusal(?:\.ts)?$/ }, (args) => {
      const source = path.resolve(args.resolveDir, `${args.path.replace(/\.ts$/, '')}.ts`)
      if (
        args.kind !== 'dynamic-import' ||
        source !== path.resolve('src/core/refusal.ts') ||
        path.resolve(build.initialOptions.outfile ?? '') !== path.resolve('dist/modelApi.js')
      )
        return
      return { path: './configuredProviders.js', external: true }
    })
    // Lane PROVERR's typed refusal rides the same way: one copy in the
    // backend bundle, required from it by providers, configured and report.
    build.onResolve(
      { filter: /\/(?:transport|sse|ndjson|modelApiEntry|providerRefusal)(?:\.ts)?$/ },
      (args) => {
        if (args.kind === 'entry-point') return
        const source = path.resolve(args.resolveDir, `${args.path.replace(/\.ts$/, '')}.ts`)
        if (
          (['transport.ts', 'sse.ts', 'ndjson.ts', 'providerRefusal.ts'].every(
            (name) => source !== path.resolve(`src/core/backends/modelapi/${name}`),
          ) &&
            source !== path.resolve('src/host/backend/modelApiEntry.ts')) ||
          path.resolve(build.initialOptions.outfile ?? '') === path.resolve('dist/modelApi.js')
        )
          return
        return { path: './modelApi.js', external: true }
      },
    )
    build.onResolve(
      {
        filter:
          /\/(?:makerEntry|makerPreviewEntry|mcpPoolEntry|execEntry|providerListEntry|codeIntelEntry|resourceGovernorEntry|resourceProcessEntry|mcpVaultEntry|accountPaidEntry|modelEffortsEntry|sessionBoardEntry|reviewerEntry|foreignHooksEntry|hookRuntimeEntry|pluginHooksEntry|modelApiToolsEntry|modelApiFileRangeEntry|modelApiVerifyEntry|modelApiImageEntry|modelApiB1Entry|modelApiToolRunEntry|modelApiFastEntry|legalFixEntry|approvalModesEntry|scheduleDeliveryEntry|scheduleSurfacesEntry|webFetchEntry|commandsEntry|conversationTransferEntry|reportEntry|reportFallbackEntry|recorderEntry|credentialLeaseEntry|deferralEntry|runtimeEngineEntry|runtimeAccountingEntry|modelApiHooksEntry|modelApiMcpEntry|modelApiAcpEntry|modelApiShellEntry|teamEntry|teamSchedulerEntry|teamWindowEntry|teamLandingEntry|teamRunnersEntry|teamTrafficEntry|teamPanelEntry|teamHostEntry|teamMcpEntry|teamEngineEntry|teamMergeFlow|workerToolIoEntry|execTeamEntry|execLedgerLeaseEntry|workerCreateEntry|workerOpsEntry|usageAcp|usageExportEntry|runExec|providerPolicyEntry|providersEntry|subscriptionsEntry|subscriptionCommandsEntry|configuredProvidersEntry|chatGptProviderCommands|grokProviderCommands|schedulesEntry|backgroundEntry|inspectEntry|recordingDriverEntry|authEntry|paidEntry|productionMediaEntry|productionAudioEntry|runtimeMediaEntry|toolRangeEntry|estimateActionsEntry|windowsEntry)(?:\.[jt]s)?$/,
      },
      (args) => {
        const source = path.resolve(args.resolveDir, `${args.path.replace(/\.[jt]s$/, '')}.ts`)
        // The backend's own modules import the assist entry statically, so
        // the moved paths stay plain calls; the build externalises those
        // imports to a require of the sibling bundle. Only the backend may
        // do this, and the tool-run chunk it alone loads (the backend has
        // required the assist bundle by then): any other bundle keeps the
        // entry's sources to itself and the split gate fails it loudly.
        if (
          [
            path.resolve('src/core/backends/modelapi/modelApiAcpEntry.ts'),
            path.resolve('src/core/backends/modelapi/modelApiShellEntry.ts'),
          ].includes(source) &&
          args.kind !== 'entry-point'
        ) {
          const output = DEFERRED_OUTFILES.get(source)
          return output !== undefined &&
            ['dist/modelApi.js', 'dist/modelApiToolRun.js'].some(
              (outfile) =>
                path.resolve(build.initialOptions.outfile ?? '') === path.resolve(outfile),
            )
            ? { path: `./${path.basename(output)}`, external: true }
            : undefined
        }
        if (
          args.kind !== 'dynamic-import' &&
          !/(?:providerPolicyEntry|providersEntry|subscriptionsEntry|subscriptionCommandsEntry|runExec)$/.test(
            args.path,
          )
        )
          return
        const output = DEFERRED_OUTFILES.get(source)
        return output === undefined
          ? undefined
          : { path: `./${path.basename(output)}`, external: true }
      },
    )
  },
}

// The schema modules dist/wire.js carries; CAPS017 added the five schemas
// the protocol already pulled in, so lazy bundles stop duplicating them.
const WIRE_FILES = [
  'src/shared/protocol.ts',
  'src/shared/agentEvents.ts',
  'src/shared/scheduleProtocol.ts',
  'src/shared/scheduleV2.ts',
  'src/shared/scheduleEvents.ts',
  'src/shared/schedule.ts',
  'src/shared/media.ts',
  'src/shared/questions.ts',
]
const WIRE_SOURCES = new Set(WIRE_FILES.map((file) => path.resolve(file)))
/** @type {import('esbuild').Plugin} */
export const sharedWire = {
  name: 'shared-wire',
  setup(build) {
    build.onResolve(
      {
        filter:
          /(?:^|\/)(?:protocol|agentEvents|scheduleProtocol|scheduleV2|scheduleEvents|schedule|media|questions)(?:\.ts)?$/,
      },
      (args) => {
        const source = path.resolve(args.resolveDir, `${args.path.replace(/\.ts$/, '')}.ts`)
        return WIRE_SOURCES.has(source) ? { path: './wire.js', external: true } : undefined
      },
    )
  },
}

// One process-wide admission configuration, shared by every lazy Node bundle.
// Admission's state and the lazy launch shims (launcher.ts) ship once, in
// dist/resourceAdmission.js (admissionEntry.ts re-exports both).
const RESOURCE_ADMISSION_SOURCES = new Set(
  [
    'src/core/resources/admission.ts',
    'src/core/resources/launcher.ts',
    'src/core/locks/processOwner.ts',
  ].map((file) => path.resolve(file)),
)
export const sharedResourceAdmission = {
  name: 'shared-resource-admission',
  setup(build) {
    build.onResolve(
      { filter: /(?:^|\/)(?:admission|launcher|processOwner)(?:\.[jt]s)?$/ },
      (args) => {
        if (
          args.kind === 'entry-point' ||
          path.resolve(build.initialOptions.outfile ?? '') ===
            path.resolve('dist/resourceAdmission.js')
        )
          return
        const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
        return RESOURCE_ADMISSION_SOURCES.has(source)
          ? { path: './resourceAdmission.js', external: true }
          : undefined
      },
    )
  },
}

// CAPS017: the ACP SDK imports classic zod as a namespace, so esbuild keeps
// zod's `export * as locales` namespaces whole: 63 locale modules, 258 KiB
// of dist/runtimeEngine.js. Nothing selects a zod locale (classic zod
// installs English itself and no code calls `z.config`), so the locale
// index keeps only `en`. The file keeps its own path, so the notices still
// attribute it to zod's package.
const ZOD_LOCALE_INDEX = /[/\\]node_modules[/\\]zod[/\\]v4[/\\]locales[/\\]index\.js$/
/** @type {import('esbuild').Plugin} */
export const englishZodLocales = {
  name: 'english-zod-locales',
  setup(build) {
    build.onLoad({ filter: ZOD_LOCALE_INDEX }, () => ({
      contents: "export { default as en } from './en.js'",
      loader: 'js',
    }))
  },
}

// CAPS017: the four report bundles each carried their own 7.8-8.8 KiB copy
// of the secret scrubber. They take the shared one dist/vaultBoundaries.js
// already exports to every other Node bundle; no other vault code comes.
/** @type {import('esbuild').Plugin} */
export const sharedRedaction = {
  name: 'shared-redaction',
  setup(build) {
    build.onResolve({ filter: /\/redact(?:\.[jt]s)?$/ }, (args) =>
      path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts')) ===
      path.resolve('src/shared/redact.ts')
        ? { path: './vaultBoundaries.js', external: true }
        : undefined,
    )
  },
}

/** Keep schema conversion out of each feature's request code. */
export const sharedStructuredSchema = {
  name: 'shared-structured-schema',
  setup(build) {
    build.onResolve({ filter: /^zod\/v4\/core$/ }, () => ({
      path: './structuredSchema.js',
      external: true,
    }))
  },
}

// The sources every Node bundle built with sharedModelApiBoundaries reads from
// dist/modelApiBoundaries.js; the split check fails a bundle that loads it and
// still carries one of them (INT0170).
export const MODEL_API_BOUNDARY_SOURCES = [
  'src/core/pathIdentity.ts',
  // INT0170: the Windows path rules and their words, once per process.
  'src/core/windowsPathSpelling.ts',
  'src/core/backends/modelapi/schemas.ts',
  'src/shared/usageJournal.ts',
  'src/shared/teamConversation.ts',
  'src/shared/paidBoundary.ts',
  'src/shared/usd.ts',
  // INT0170: PORTS017's boundary schemas, which usd.ts re-exports.
  'src/shared/usdSchema.ts',
  'src/core/paid/paidAuthority.ts',
  'src/shared/legal.ts',
  'src/core/backends/modelapi/legalScanTool.ts',
  // A path confined to the workspace (D24), once per process: activation,
  // the backend and its chunks, the ACP agent and every other Node reader
  // share it beside the Windows path rules and path identity it reads.
  'src/core/workspacePath.ts',
]

// The file tools' edit helpers (RLINTFIX) ride the chunk that runs the file
// tools, dist/modelApiToolRun.js, never the boundary activation loads; the
// byte-range execution, loaded only from that chunk, reads them there.
export const TOOL_EDIT_SOURCE = 'src/core/toolEdit.ts'
export const TOOL_EDIT_OWNER = 'dist/modelApiToolRun.js'
export const TOOL_EDIT_READERS = ['dist/modelApiFileRange.js']

// The guarded process-start layer (PLAN.md D24), once per process: every
// Node bundle that starts a program or builds a child environment reads it
// from dist/execGuard.js; the split check fails a bundle that loads it and
// still carries it.
export const EXEC_GUARD_SOURCE = 'src/core/execGuard.ts'
export const EXEC_GUARD_BUNDLE = {
  output: 'dist/execGuard.js',
  metafile: 'dist/meta/execGuard.json',
}
/** @type {import('esbuild').Plugin} */
export const sharedExecGuard = {
  name: 'shared-exec-guard',
  setup(build) {
    build.onResolve({ filter: /\/execGuard(?:\.[jt]s)?$/ }, (args) => {
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      if (
        source !== path.resolve(EXEC_GUARD_SOURCE) ||
        path.resolve(build.initialOptions.outfile ?? '') === path.resolve(EXEC_GUARD_BUNDLE.output)
      )
        return
      return { path: './execGuard.js', external: true }
    })
  },
}

// Share captured Model API validators, native path identity and team admission across Node
// consumers; browser validators retain their original inline implementation.
/** @type {import('esbuild').Plugin} */
export const sharedModelApiBoundaries = {
  name: 'shared-model-api-boundaries',
  setup(build) {
    build.onResolve(
      {
        filter:
          /\/(?:schemas|sessionStore|usageJournal|teamConversation|paidAuthority|paidBoundary|usd|legal|legalScanTool|toolEdit|workspacePath|pathIdentity|windowsPathSpelling|usdSchema|vault|vaultProtocol|vaultStatus|vaultPanel|taint|schema|toolSchema|redact|estimate|estimatorProtocol|history|wire|openSshFile)(?:\.[jt]s)?$/,
      },
      (args) => {
        const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
        // The file tools' edit helpers: the byte-range execution reads the
        // tool-run chunk's; every other bundle carries the few it reads.
        if (source === path.resolve(TOOL_EDIT_SOURCE))
          return TOOL_EDIT_READERS.some(
            (reader) => path.resolve(build.initialOptions.outfile ?? '') === path.resolve(reader),
          )
            ? { path: `./${path.basename(TOOL_EDIT_OWNER)}`, external: true }
            : undefined
        // The store owner depends on wire; keep it outside the boundary wire loads.
        if (source === path.resolve('src/core/backends/modelapi/sessionStore.ts'))
          return path.resolve(build.initialOptions.outfile ?? '') ===
            path.resolve('dist/modelApiSessions.js')
            ? undefined
            : { path: './modelApiSessions.js', external: true }
        // INT0170: the resource journal, once for the window governor and the usage service.
        if (source === path.resolve(RESOURCE_JOURNAL_SOURCE))
          return path.resolve(build.initialOptions.outfile ?? '') ===
            path.resolve(RESOURCE_JOURNAL_BUNDLE.output)
            ? undefined
            : { path: './resourceJournal.js', external: true }
        if (
          ['src/shared/estimate.ts', 'src/shared/estimatorProtocol.ts'].some(
            (file) => source === path.resolve(file),
          )
        )
          return path.resolve(build.initialOptions.outfile ?? '') ===
            path.resolve('dist/estimateContracts.js')
            ? undefined
            : { path: './estimateContracts.js', external: true }
        if (
          [
            'src/shared/redact.ts',
            'src/shared/vault.ts',
            'src/shared/vaultProtocol.ts',
            'src/shared/vaultStatus.ts',
            'src/shared/vaultPanel.ts',
            'src/core/vault/taint.ts',
            'src/core/vault/exec/schema.ts',
            'src/core/vault/exec/toolSchema.ts',
            // RLINTFIX: the SSH wire format, once per process (see the
            // vault boundary entry); key operations stay local.
            'src/core/vault/ssh/wire.ts',
            'src/core/vault/ssh/openSshFile.ts',
          ].some((file) => source === path.resolve(file))
        ) {
          return path.resolve(build.initialOptions.outfile ?? '') ===
            path.resolve('dist/vaultBoundaries.js')
            ? undefined
            : { path: './vaultBoundaries.js', external: true }
        }
        return path.resolve(build.initialOptions.outfile ?? '') !==
          path.resolve('dist/modelApiBoundaries.js') &&
          MODEL_API_BOUNDARY_SOURCES.some((file) => source === path.resolve(file))
          ? { path: './modelApiBoundaries.js', external: true }
          : undefined
      },
    )
  },
}

/** Node-only compressed reference data; the browser keeps its portable schema. */
export const nodeReferenceData = {
  name: 'node-reference-data',
  setup(build) {
    build.onResolve({ filter: /\/reference\.generated$/ }, () => ({
      path: path.resolve('src/runtime/reference.node.generated.ts'),
    }))
  },
}

/** @type {import('esbuild').Plugin} */
// Keep the immutable core store in one lazy sibling, including its error identity.
export const sharedVaultStore = {
  name: 'shared-vault-store',
  setup(build) {
    build.onResolve({ filter: /\/(?:store|crypto|ports)(?:\.[jt]s)?$/ }, (args) => {
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      return [
        'src/core/vault/store.ts',
        'src/core/vault/crypto.ts',
        'src/core/vault/broker/ports.ts',
      ].some((file) => source === path.resolve(file))
        ? { path: './vaultStore.js', external: true }
        : undefined
    })
  },
}

/** @type {import('esbuild').Plugin} */
export const sharedVaultPosix = {
  name: 'shared-vault-posix',
  setup(build) {
    build.onResolve({ filter: /\/posixClientPlatform(?:\.[jt]s)?$/ }, (args) =>
      path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts')) ===
      path.resolve('src/runtime/vault/posixClientPlatform.ts')
        ? { path: './vaultPosix.js', external: true }
        : undefined,
    )
  },
}

/** @type {import('esbuild').Plugin} */
export const sharedVaultWindows = {
  name: 'shared-vault-windows',
  setup(build) {
    build.onResolve({ filter: /\/windowsClientPlatform(?:\.[jt]s)?$/ }, (args) =>
      path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts')) ===
      path.resolve('src/runtime/vault/windowsClientPlatform.ts')
        ? { path: './vaultWindows.js', external: true }
        : undefined,
    )
  },
}

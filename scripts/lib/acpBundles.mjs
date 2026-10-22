// The ACP agent's npm package ships exactly these dist files (PLAN.md D62):
// the agent, its headless and exec entries, the Model API backend it loads
// when that backend first starts, and every lazily loaded chunk those entries
// can reach. scripts/package-acp.mjs copies this list into the package; the
// packaged-chunks gate fails a reachable chunk missing here, so a new
// on-demand chunk cannot ship unpackaged again.
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
The usage page's transitive browser assets (usage.js, usage.css and the
chunks they import), which the agent serves from its own dist/webview when
a usage page opens on that backend (src/runtime/usage/usageAcp.ts). Shared
with scripts/package-acp.mjs so the staged package and the lazy-registry
gate carry the same closure. Run from the repository root after the
production build (it reads the usage browser metafile).
*/
export function acpUsageAssets(packageRoot = process.cwd()) {
  const root = path.resolve(packageRoot, 'dist', 'webview')
  const meta = JSON.parse(
    readFileSync(path.join(packageRoot, 'dist', 'meta', 'usageWebview.json'), 'utf8'),
  )
  const pending = ['dist/webview/usage.js', 'dist/webview/usage.css']
  const files = new Set()
  while (pending.length > 0) {
    const file = pending.pop()
    if (files.has(file)) continue
    const relative = path.relative(root, path.resolve(packageRoot, file))
    if (
      relative === '' ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !['.js', '.css'].includes(path.extname(file))
    ) {
      throw new Error('Usage asset is outside the browser bundle')
    }
    const output = meta.outputs?.[file]
    if (output === undefined || !statSync(path.join(packageRoot, file)).isFile()) {
      throw new Error(`${file} is missing from the usage browser build`)
    }
    files.add(file)
    if (output.cssBundle !== undefined) pending.push(output.cssBundle)
    const imports = output.imports ?? []
    for (const imported of imports) {
      if (imported.external) throw new Error('Usage assets must be bundled locally')
      pending.push(imported.path)
    }
  }
  return [...files]
}

export const ACP_BUNDLES = [
  'acp.js',
  'estimator.js',
  'headless.js',
  'sharingRuntime.js',
  // M124 (D106): the MCP connector ships in the ACP package; `mcp` loads it on use.
  'connector.js',
  // M124 (D106, RVM124 finding 15): the connector's storage guard, loaded by `mcp` beside it.
  'connectorStoreGuard.js',
  'acpQuestions.js',
  'acpPlaybook.js',
  'runtimeQuestions.js',
  'runtimeAccounts.js',
  'vaultRuntime.js',
  'planSnapshot.js',
  'questionNotes.js',
  'approvalModes.js',
  'mcpPool.js',
  'exec.js',
  // RLTESTDRIVE item 5: the live list read headless refresh on use loads.
  'providerList.js',
  'execGuard.js',
  'modelApiCodeIntel.js',
  'structuredSchema.js',
  'fontsInstall.js',
  'scheduleBackground.js',
  'modelApi.js',
  'modelApiSessions.js',
  'museCode.js',
  'resourceAdmission.js',
  'resourceGovernor.js',
  'resourceProcess.js',
  'resourceJournal.js',
  'modelApiHooks.js',
  'modelApiMcp.js',
  'productionMedia.js',
  'productionAudio.js',
  'runtimeMedia.js',
  'runtimeAccounting.js',
  'providerPolicy.js',
  'runtimeEngine.js',
  'modelApiBoundaries.js',
  'vault.js',
  'vaultBoundaries.js',
  'vaultStore.js',
  'vaultPosix.js',
  'vaultWindows.js',
  'vaultRuntime.js',
  'vaultActions.js',
  'vaultBroker.js',
  'vaultBrokerBindings.js',
  'estimateContracts.js',
  'legalScan.js',
  'legalFix.js',
  'providers.js',
  'auth.js',
  'subscriptions.js',
  'configuredProviders.js',
  'credentialLease.js',
  'providerCatalog.json',
  'providerCatalog.js',
  // What's New's release notes for /whatsnew in ACP editors (M99): data the
  // agent reads beside its bundle, never code, so no lazy-registry row.
  'whatsNew.json',
  'media.js',
  'reviewer.js',
  'team.js',
  'teamRunners.js',
  'teamScheduler.js',
  'schedules.js',
  'scheduleDelivery.js',
  'foreignHooks.js',
  'hookRuntime.js',
  'modelApiTools.js',
  'modelApiVerify.js',
  'modelApiImage.js',
  'recorder.js',
  'reporting.js',
  'reportingNetwork.js',
  'reportInputs.js',
  'playbookSchedulesInputs.js',
  'reportingDestinations.js',
  'reference.js',
  'uiText.js',
  'uiTextRuntime.js',
  'uiTextHooks.js',
  'uiTextSurfaces.js',
  'uiTextMedia.js',
  'extensionHooks.js',
  'validation.js',
  'wire.js',
  'searchWorker.js',
  'pageWorker.js',
  'imageResizeWorker.js',
  'usageService.js',
  'usageCompanion.js',
  'voiceCompanion.js',
  'webFetch.js',
  'pluginHooks.js',
]

#!/usr/bin/env node
// The extension host runs on Node 22, where `navigator` is a global; VS Code
// replaces it with a getter that reports a PendingMigrationError and answers
// undefined ("navigator is now a global in nodejs",
// src/vs/workbench/api/node/extensionHostProcess.ts, since 1.101), and a
// bundled library that sniffs `typeof navigator` to detect a browser has
// broken other extensions that way (zod's Cloudflare check, openai/codex
// #43476). Our host bundles never touch it (zod/mini leaves that check out);
// this gate keeps it so (M26, PLAN.md D29), in the Model API backend's own
// bundle too (M57). Exits 1 on any reference, or when a bundle is missing.

import { existsSync, readFileSync } from 'node:fs'

const HOST_BUNDLES = [
  'dist/validation.js',
  'dist/wire.js',
  'dist/uiText.js',
  'dist/uiTextRuntime.js',
  'dist/uiTextHooks.js',
  'dist/uiTextSurfaces.js',
  'dist/uiTextMedia.js',
  'dist/extension.js',
  'dist/resourceAdmission.js',
  'dist/resourceGovernor.js',
  'dist/resourceProcess.js',
  'dist/resourceJournal.js',
  'dist/mcpVault.js',
  'dist/vaultBroker.js',
  'dist/conversation.js',
  'dist/tab.js',
  'dist/usageService.js',
  'dist/usageCompanion.js',
  'dist/usagePanel.js',
  'dist/modelApi.js',
  'dist/museCode.js',
  'dist/mcpPool.js',
  'dist/modelApiCodeIntel.js',
  'dist/structuredSchema.js',
  'dist/exec.js',
  'dist/modelApiHooks.js',
  'dist/modelApiMcp.js',
  'dist/productionMedia.js',
  'dist/productionAudio.js',
  'dist/runtimeMedia.js',
  'dist/runtimeAccounting.js',
  'dist/providerPolicy.js',
  'dist/modelApiBoundaries.js',
  'dist/providers.js',
  'dist/subscriptions.js',
  'dist/configuredProviders.js',
  'dist/validation.js',
  'dist/modelsPanel.js',
  'dist/auth.js',
  'dist/paid.js',
  'dist/modelsSubscriptions.js',
  'dist/review.js',
  'dist/sessionBoard.js',
  'dist/reviewer.js',
  'dist/team.js',
  'dist/teamRunners.js',
  'dist/teamScheduler.js',
  'dist/schedules.js',
  // M91: the imported hooks' adapters, the hook and MCP-form runtime, and
  // the window's extension hook runner.
  'dist/foreignHooks.js',
  'dist/hookRuntime.js',
  'dist/extensionHooks.js',
  'dist/pluginHooks.js',
  'dist/modelApiTools.js',
  'dist/modelApiVerify.js',
  'dist/planMarkdown.js',
  'dist/checkpointStore.js',
  'dist/browserCheck.js',
  'dist/browserRuntime.js',
  'dist/agentImport.js',
  'dist/conversationGit.js',
  'dist/conversationTransfer.js',
  'dist/modelApiSessions.js',
  'dist/rulesFile.js',
  'dist/nativeGit.js',
  'dist/execGuard.js',
  'dist/bundledSkills.js',
  'dist/legalScan.js',
  'dist/legalFix.js',
  'dist/codeIntel.js',
  'dist/voice.js',
  'dist/voiceLinux.js',
  'dist/dictation.js',
  'dist/media.js',
  'dist/mediaHost.js',
  'dist/screenRecord.js',
  'dist/webFetch.js',
  'dist/museCodeReviewer.js',
  'dist/report.js',
  'dist/commands.js',
  'dist/recorder.js',
  'dist/whatsNew.js',
  'dist/judge.js',
  'dist/searchWorker.js',
  'dist/pageWorker.js',
  'dist/imageResizeWorker.js',
  'dist/scheduleBackground.js',
  'dist/scheduleDelivery.js',
  'dist/scheduleSurfaces.js',
]
const NAVIGATOR = /\bnavigator\b/g

let hasFailure = false
for (const bundle of HOST_BUNDLES) {
  if (!existsSync(bundle)) {
    hasFailure = true
    console.log(`MISS ${bundle}: not built`)
    continue
  }
  const count = readFileSync(bundle, 'utf8').match(NAVIGATOR)?.length ?? 0
  if (count > 0) {
    hasFailure = true
  }
  console.log(
    `${count === 0 ? 'ok  ' : 'FAIL'} ${bundle}: ${String(count)} reference(s) to navigator`,
  )
}

if (hasFailure) {
  console.error(
    'the extension host bundle reads `navigator`; guard with `typeof process === "object" && process.versions.node` first (PLAN.md D29)',
  )
  process.exit(1)
}

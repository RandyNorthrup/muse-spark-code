// Shared by the production split gate and its real-build red drills.
// No filesystem reads or child processes: callers supply the built inputs.
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
  'src/core/providers/subscriptions/registry.ts',
]
export const CONFIGURED_TRANSPORT_ONLY = ['authSource.ts', 'providerClient.ts']
export const SHARED_TRANSPORT_ONLY = ['transport.ts', 'sse.ts', 'ndjson.ts']
const MODEL_API_DIR = 'src/core/backends/modelapi'
export const DEFERRED_ONLY = ['reviewerEntry.ts', 'hookModelEntry.ts']

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
export const HOOK_RUNTIME_ONLY = ['hookRuntimeEntry.ts']

export const PLUGIN_HOOKS_ONLY = [
  'pluginHooksEntry.ts',
  'pluginHost.ts',
  'pluginChild.ts',
  'pluginFormats.ts',
]
export const DEFERRED = [
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
    files: [
      'src/core/backends/modelapi/modelApiHooksEntry.ts',
      'src/core/backends/modelapi/hookHandlers.ts',
    ],
  },
  {
    output: 'dist/modelApiMcp.js',
    metafile: 'dist/meta/modelApiMcp.json',
    files: [
      'src/core/backends/modelapi/modelApiMcpEntry.ts',
      'src/core/backends/modelapi/mcp/pool.ts',
      'src/core/backends/modelapi/mcp/connection.ts',
      'src/core/backends/modelapi/mcp/http.ts',
      'src/core/backends/modelapi/mcp/stdio.ts',
      'src/core/backends/modelapi/mcp/servers.ts',
    ],
  },
  {
    output: 'dist/modelApiBoundaries.js',
    metafile: 'dist/meta/modelApiBoundaries.json',
    files: [
      'src/shared/modelApiBoundariesEntry.ts',
      'src/core/backends/modelapi/schemas.ts',
      'src/shared/teamConversation.ts',
      'src/shared/paidBoundary.ts',
      'src/shared/legal.ts',
      'src/core/backends/modelapi/legalScanTool.ts',
    ],
  },
  {
    output: 'dist/teamScheduler.js',
    metafile: 'dist/meta/teamScheduler.json',
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
    files: [
      'src/host/runners/teamRunnersEntry.ts',
      'src/host/runners/sshRunner.ts',
      'src/host/team/checkSlots.ts',
      'src/host/modelsPanelTraffic.ts',
    ],
  },
  {
    output: 'dist/team.js',
    metafile: 'dist/meta/team.json',
    files: ['src/core/team/teamEntry.ts', 'src/core/team/teamTools.ts', 'src/core/team/roster.ts'],
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
    ],
  },
  {
    output: 'dist/usageCompanion.js',
    metafile: 'dist/meta/usageCompanion.json',
    files: ['src/runtime/usage/usageCompanionEntry.ts', 'src/runtime/companion/server.ts'],
  },
  {
    output: 'dist/usagePanel.js',
    metafile: 'dist/meta/usagePanel.json',
    files: [
      'src/host/usage/usagePanelEntry.ts',
      'src/host/usage/usagePanel.ts',
      'src/host/paid/paidDailyBudget.ts',
    ],
  },
  {
    output: 'dist/reference.js',
    metafile: 'dist/meta/reference.json',
    files: [
      'src/shared/reference/referenceEntry.ts',
      'src/shared/reference/reference.generated.ts',
      'src/shared/reference/text.ts',
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
]

// Split out of activation on 2026-10-03 (D6): each loads on its first use.
// The Model API backend keeps its own copy of code intelligence.
export const ON_FIRST_USE = [
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
      'src/core/legal/headerFix.ts',
      'src/core/legal/headers.ts',
      'src/core/legal/markdown.ts',
      'src/core/legal/projectLicense.ts',
      'src/core/legal/scan.ts',
      'src/core/legal/spdx.ts',
      'src/core/legal/workspace.ts',
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
  {
    output: 'dist/questionNotes.js',
    metafile: 'dist/meta/questionNotes.json',
    use: 'the first backend question deferral',
    parents: [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp],
    files: ['src/core/questions/deferralEntry.ts'],
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
      'src/host/conversation/sessionImport.ts',
      'src/core/export/transcriptMarkdown.ts',
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
      'src/host/tab/tabProvider.ts',
      'src/host/tab/tabStatus.ts',
      'src/host/tab/tabLedger.ts',
      'src/host/tab/tabSpendGate.ts',
      'src/core/tab/tabCache.ts',
      'src/core/tab/tabContext.ts',
      'src/core/tab/tabEngine.ts',
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
  // The report dialog (M93, PLAN.md D72), split out from the start.
  {
    output: 'dist/report.js',
    metafile: 'dist/meta/report.json',
    use: 'the first report dialog',
    files: [
      'src/host/support/reportEntry.ts',
      'src/host/conversation/reportProblemHandler.ts',
      'src/host/support/reportProblem.ts',
      'src/core/support/problemReport.ts',
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
  // What's New (M99, D79): activation keeps the update check, the claim and
  // the loader; the page is required on the first page or notice.
  {
    output: 'dist/whatsNew.js',
    metafile: 'dist/meta/whatsNew.json',
    use: 'the first What’s New page or notice',
    files: [
      'src/host/whatsNew/whatsNewEntry.ts',
      'src/host/whatsNew/whatsNewPanel.ts',
      'src/host/whatsNew/whatsNewHtml.ts',
      'src/core/whatsNew/whatsNewContent.ts',
      'src/shared/whatsNewMessages.ts',
    ],
  },
]
/** The same parent exclusions and destination requirements used by the CLI. */
export function checkDeferredBundles(inputsOf) {
  const problems = []
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
      (DEFERRED.includes(bundle)
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
        !(source === 'src/core/providers/configured.ts' && bundle === BUNDLES.configured) &&
        !(
          bundle.output === 'dist/providerPolicy.js' &&
          ['credentialRecord.ts', 'modelRef.ts', 'endpointPolicy.ts'].some(
            (file) => source === `src/core/providers/${file}`,
          )
        ) &&
        !(
          source === 'src/core/providers/priceCard.ts' && bundle.output === 'dist/usageService.js'
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
  for (const file of ['src/shared/protocol.ts', 'src/shared/agentEvents.ts']) {
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

// Keep dynamic imports dynamic: these entries run only on their first action.
/** @type {import('esbuild').Plugin} */
const DEFERRED_OUTFILES = new Map([
  [path.resolve('src/runtime/runtimeEngineEntry.ts'), 'dist/runtimeEngine.js'],
  [path.resolve('src/host/backend/providerPolicyEntry.ts'), 'dist/providerPolicy.js'],
  [path.resolve('src/runtime/runtimeAccountingEntry.ts'), 'dist/runtimeAccounting.js'],
  [path.resolve('src/core/backends/modelapi/modelApiHooksEntry.ts'), 'dist/modelApiHooks.js'],
  [path.resolve('src/core/backends/modelapi/modelApiMcpEntry.ts'), 'dist/modelApiMcp.js'],
  [path.resolve('src/runtime/exec/runExec.ts'), 'dist/headless.js'],
  [path.resolve('src/runtime/usage/usageAcp.ts'), 'dist/usageService.js'],
  [path.resolve('src/host/backend/providersEntry.ts'), 'dist/providers.js'],
  [path.resolve('src/host/backend/subscriptionsEntry.ts'), 'dist/subscriptions.js'],
  [path.resolve('src/host/backend/configuredProvidersEntry.ts'), 'dist/configuredProviders.js'],
  [path.resolve('src/runtime/chatGptProviderCommands.ts'), 'dist/subscriptions.js'],
  [path.resolve('src/core/media/inspectEntry.ts'), 'dist/media.js'],
  [path.resolve('src/core/questions/deferralEntry.ts'), 'dist/questionNotes.js'],
  [path.resolve('src/host/support/reportEntry.ts'), 'dist/report.js'],
  [path.resolve('src/host/support/recorderEntry.ts'), 'dist/recorder.js'],
  [path.resolve('src/host/sessionBoardEntry.ts'), 'dist/sessionBoard.js'],
  [path.resolve('src/core/team/teamEntry.ts'), 'dist/team.js'],
  [path.resolve('src/core/team/teamSchedulerEntry.ts'), 'dist/teamScheduler.js'],
  [path.resolve('src/host/runners/teamRunnersEntry.ts'), 'dist/teamRunners.js'],
  [path.resolve('src/core/backends/modelapi/reviewerEntry.ts'), 'dist/reviewer.js'],
  [path.resolve('src/core/backends/modelapi/foreignHooksEntry.ts'), 'dist/foreignHooks.js'],
  [path.resolve('src/core/backends/modelapi/hookRuntimeEntry.ts'), 'dist/hookRuntime.js'],
  [path.resolve('src/host/web/webFetchEntry.ts'), 'dist/webFetch.js'],
  [path.resolve('src/core/backends/modelapi/pluginHooksEntry.ts'), 'dist/pluginHooks.js'],
])
/** @type {import('esbuild').Plugin} */
export const deferredCohort = {
  name: 'deferred-cohort',
  setup(build) {
    // The shared request/framing implementations stay in the existing backend
    // bundle; providers and ACP require its exported API only when used.
    build.onResolve({ filter: /\/(?:transport|sse|ndjson|modelApiEntry)(?:\.ts)?$/ }, (args) => {
      if (args.kind === 'entry-point') return
      const source = path.resolve(args.resolveDir, `${args.path.replace(/\.ts$/, '')}.ts`)
      if (
        (['transport.ts', 'sse.ts', 'ndjson.ts'].every(
          (name) => source !== path.resolve(`src/core/backends/modelapi/${name}`),
        ) &&
          source !== path.resolve('src/host/backend/modelApiEntry.ts')) ||
        path.resolve(build.initialOptions.outfile ?? '') === path.resolve('dist/modelApi.js')
      )
        return
      return { path: './modelApi.js', external: true }
    })
    build.onResolve(
      {
        filter:
          /\/(?:runtimeEngineEntry|runtimeAccountingEntry|modelApiHooksEntry|modelApiMcpEntry|teamEntry|teamSchedulerEntry|teamRunnersEntry|usageAcp|runExec|providerPolicyEntry|providersEntry|subscriptionsEntry|configuredProvidersEntry|chatGptProviderCommands|sessionBoardEntry|reviewerEntry|foreignHooksEntry|hookRuntimeEntry|pluginHooksEntry|webFetchEntry|reportEntry|recorderEntry|deferralEntry|inspectEntry)(?:\.[jt]s)?$/,
      },
      (args) => {
        if (
          args.kind !== 'dynamic-import' &&
          !/(?:providerPolicyEntry|providersEntry|subscriptionsEntry)$/.test(args.path)
        )
          return
        const source = path.resolve(args.resolveDir, `${args.path.replace(/\.[jt]s$/, '')}.ts`)
        const output = DEFERRED_OUTFILES.get(source)
        return output === undefined
          ? undefined
          : { path: `./${path.basename(output)}`, external: true }
      },
    )
  },
}

const WIRE_SOURCES = new Set(
  ['src/shared/protocol.ts', 'src/shared/agentEvents.ts'].map((file) => path.resolve(file)),
)
/** @type {import('esbuild').Plugin} */
export const sharedWire = {
  name: 'shared-wire',
  setup(build) {
    build.onResolve({ filter: /(?:^|\/)(?:protocol|agentEvents)(?:\.ts)?$/ }, (args) => {
      const source = path.resolve(args.resolveDir, `${args.path.replace(/\.ts$/, '')}.ts`)
      return WIRE_SOURCES.has(source) ? { path: './wire.js', external: true } : undefined
    })
  },
}

// Share captured Model API validators and pure team admission across Node
// consumers; browser validators retain their original inline implementation.
/** @type {import('esbuild').Plugin} */
export const sharedModelApiBoundaries = {
  name: 'shared-model-api-boundaries',
  setup(build) {
    build.onResolve(
      { filter: /\/(?:schemas|teamConversation|paidBoundary|legal|legalScanTool)(?:\.[jt]s)?$/ },
      (args) => {
        const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
        return [
          'src/core/backends/modelapi/schemas.ts',
          'src/shared/teamConversation.ts',
          'src/shared/paidBoundary.ts',
          'src/shared/legal.ts',
          'src/core/backends/modelapi/legalScanTool.ts',
        ].some((file) => source === path.resolve(file))
          ? { path: './modelApiBoundaries.js', external: true }
          : undefined
      },
    )
  },
}

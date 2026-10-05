// Shared by the production split gate and its real-build red drills.
// No filesystem reads or child processes: callers supply the built inputs.
import path from 'node:path'

export const BUNDLES = {
  activation: { output: 'dist/extension.js', metafile: 'dist/meta/extension.json' },
  modelApi: { output: 'dist/modelApi.js', metafile: 'dist/meta/modelApi.json' },
  acp: { output: 'dist/acp.js', metafile: 'dist/meta-acp/acp.json' },
}
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
  for (const bundle of [...DEFERRED, ...ON_FIRST_USE]) {
    const inputs = inputsOf(bundle)
    const parents = DEFERRED.includes(bundle)
      ? [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp]
      : [BUNDLES.activation]
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
  [path.resolve('src/host/support/reportEntry.ts'), 'dist/report.js'],
  [path.resolve('src/host/support/recorderEntry.ts'), 'dist/recorder.js'],
  [path.resolve('src/host/sessionBoardEntry.ts'), 'dist/sessionBoard.js'],
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
    build.onResolve(
      {
        filter:
          /\/(?:sessionBoardEntry|reviewerEntry|foreignHooksEntry|hookRuntimeEntry|pluginHooksEntry|webFetchEntry|reportEntry|recorderEntry)(?:\.[jt]s)?$/,
      },
      (args) => {
        if (args.kind !== 'dynamic-import') return
        const source = path.resolve(args.resolveDir, `${args.path.replace(/\.[jt]s$/, '')}.ts`)
        const output = DEFERRED_OUTFILES.get(source)
        return output === undefined
          ? undefined
          : { path: `./${path.basename(output)}`, external: true }
      },
    )
  },
}

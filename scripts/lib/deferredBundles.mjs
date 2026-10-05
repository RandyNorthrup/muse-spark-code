// Shared by the production split gate and its real-build red drills.
// No filesystem reads or child processes: callers supply the built inputs.
import path from 'node:path'

export const BUNDLES = {
  activation: { output: 'dist/extension.js', metafile: 'dist/meta/extension.json' },
  modelApi: { output: 'dist/modelApi.js', metafile: 'dist/meta/modelApi.json' },
  acp: { output: 'dist/acp.js', metafile: 'dist/meta-acp/acp.json' },
}
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
    files: ['src/core/backends/modelapi/reviewerEntry.ts'],
  },
]

// Split out of activation on 2026-10-03 (D6): each loads on its first use.
// The Model API backend keeps its own copy of code intelligence.
export const ON_FIRST_USE = [
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
export const deferredCohort = {
  name: 'deferred-cohort',
  setup(build) {
    build.onResolve({ filter: /\/(?:sessionBoardEntry|reviewerEntry)(?:\.[jt]s)?$/ }, (args) => {
      if (args.kind !== 'dynamic-import') return
      const source = path.resolve(args.resolveDir, `${args.path.replace(/\.[jt]s$/, '')}.ts`)
      let output
      if (source === path.resolve('src/host/sessionBoardEntry.ts')) output = 'dist/sessionBoard.js'
      else if (source === path.resolve('src/core/backends/modelapi/reviewerEntry.ts'))
        output = 'dist/reviewer.js'
      return output === undefined
        ? undefined
        : { path: `./${path.basename(output)}`, external: true }
    })
  },
}

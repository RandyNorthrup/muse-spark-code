// dist/modelApi.js as the production build makes it (M57, PLAN.md D6): the
// entry bundled by esbuild into a folder the test owns, in the build's
// format, platform and target, for tests that load the Model API backend the
// way the extension does, with Node's own `require`.

import path from 'node:path'
import { build, type Plugin } from 'esbuild'
import { MODEL_API_BUNDLE_FILE, PAGE_WORKER_FILE } from '../../../src/shared/constants'

// Mirror the approved shared fallback in scripts/build.mjs; installed tables
// remain local to the backend, and the fallback is a real adjacent module.
export const sharedUiText: Plugin = {
  name: 'shared-ui-text',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\/en$/ }, (args) =>
      path.resolve(args.resolveDir, `${args.path}.ts`) === path.resolve('src/shared/l10n/en.ts')
        ? { path: './uiText.js', external: true }
        : undefined,
    )
  },
}

/**
 * Host bundles (`{ name: entry }`) built into `folder` as scripts/build.mjs
 * builds them, beside the shared English table they load (`uiText.js`).
 */
export async function buildHostBundles(
  folder: string,
  entries: Readonly<Record<string, string>>,
  external: readonly string[] = [],
): Promise<void> {
  await build({
    entryPoints: { ...entries, uiText: path.resolve('src/shared/l10n/en.ts') },
    outdir: folder,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // The extension host of the floor, VS Code 1.99 (scripts/build.mjs, PLAN.md M62).
    target: 'node20.18',
    plugins: [sharedUiText],
    logLevel: 'silent',
    external: [
      './reviewerEntry.js',
      './hookRuntimeEntry.js',
      './foreignHooksEntry.js',
      './codeIntelEntry.js',
      './mcpPoolEntry.js',
      ...external,
    ],
  })
}

/**
 * Builds the backend, its page worker and the Auto reviewer it loads on first
 * use into `folder`; returns the backend's path.
 */
export async function buildModelApiBundle(folder: string): Promise<string> {
  const file = path.join(folder, MODEL_API_BUNDLE_FILE)
  await buildHostBundles(folder, {
    [path.parse(MODEL_API_BUNDLE_FILE).name]: path.resolve('src/host/backend/modelApiEntry.ts'),
    [path.parse(PAGE_WORKER_FILE).name]: path.resolve('src/host/web/pageWorker.ts'),
    reviewerEntry: path.resolve('src/core/backends/modelapi/reviewerEntry.ts'),
    hookRuntimeEntry: path.resolve('src/core/backends/modelapi/hookRuntimeEntry.ts'),
    foreignHooksEntry: path.resolve('src/core/backends/modelapi/foreignHooksEntry.ts'),
    codeIntelEntry: path.resolve('src/core/backends/modelapi/codeIntelEntry.ts'),
    mcpPoolEntry: path.resolve('src/core/backends/modelapi/mcpPoolEntry.ts'),
  })
  return file
}

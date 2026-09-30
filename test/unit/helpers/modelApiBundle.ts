// dist/modelApi.js as the production build makes it (M57, PLAN.md D6): the
// entry bundled by esbuild into a folder the test owns, in the build's
// format, platform and target, for tests that load the Model API backend the
// way the extension does, with Node's own `require`.

import path from 'node:path'
import { build, type Plugin } from 'esbuild'
import { MODEL_API_BUNDLE_FILE, PAGE_WORKER_FILE } from '../../../src/shared/constants'

/**
 * The production build leaves the English table out of this bundle, whose
 * entry installs the activation bundle's (`installedTable` in
 * scripts/build.mjs, PLAN.md D6, M76): the same stub here, so the tests run
 * the bundle that ships.
 */
const installedTable: Plugin = {
  name: 'installed-table',
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /src[\\/]shared[\\/]l10n[\\/]en\.ts$/ }, () => ({
      contents: 'export const EN = {}',
      loader: 'ts',
    }))
  },
}

/** Builds the backend and its page worker into `folder`; returns the backend's path. */
export async function buildModelApiBundle(folder: string): Promise<string> {
  const file = path.join(folder, MODEL_API_BUNDLE_FILE)
  await build({
    entryPoints: {
      [path.parse(MODEL_API_BUNDLE_FILE).name]: path.resolve('src/host/backend/modelApiEntry.ts'),
      [path.parse(PAGE_WORKER_FILE).name]: path.resolve('src/host/web/pageWorker.ts'),
    },
    outdir: folder,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // The extension host of the floor, VS Code 1.99 (scripts/build.mjs, PLAN.md M62).
    target: 'node20.18',
    plugins: [installedTable],
    logLevel: 'silent',
  })
  return file
}

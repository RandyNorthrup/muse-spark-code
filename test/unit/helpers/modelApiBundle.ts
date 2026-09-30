// dist/modelApi.js as the production build makes it (M57, PLAN.md D6): the
// entry bundled by esbuild into a folder the test owns, in the build's
// format, platform and target, for tests that load the Model API backend the
// way the extension does, with Node's own `require`. Like the build it
// carries no English table of its own: the factory installs the caller's
// (scripts/lib/withoutEnglishTable.mjs). Async, because esbuild's synchronous
// build takes no plugins.

import path from 'node:path'
import { build } from 'esbuild'
import { withoutEnglishTable } from '../../../scripts/lib/withoutEnglishTable.mjs'
import { MODEL_API_BUNDLE_FILE, PAGE_WORKER_FILE } from '../../../src/shared/constants'

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
    plugins: [withoutEnglishTable],
    logLevel: 'silent',
  })
  return file
}

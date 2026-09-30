// dist/modelApi.js as the production build makes it (M57, PLAN.md D6): the
// entry bundled by esbuild into a folder the test owns, in the build's
// format, platform and target, for tests that load the Model API backend the
// way the extension does, with Node's own `require`.

import path from 'node:path'
import { buildSync } from 'esbuild'
import { MODEL_API_BUNDLE_FILE, PAGE_WORKER_FILE } from '../../../src/shared/constants'

/** Builds the backend and its page worker into `folder`; returns the backend's path. */
export function buildModelApiBundle(folder: string): string {
  const file = path.join(folder, MODEL_API_BUNDLE_FILE)
  buildSync({
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
    logLevel: 'silent',
  })
  return file
}

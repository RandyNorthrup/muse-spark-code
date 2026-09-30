// dist/modelApi.js as the production build makes it (M57, PLAN.md D6): the
// entry bundled by esbuild into a folder the test owns, in the build's
// format, platform and target and without the English table the activation
// bundle hands over, for tests that load the Model API backend the way the
// extension does, with Node's own `require`. The build is
// scripts/lib/buildModelApiBundle.mjs, which takes esbuild's asynchronous
// API (its plugin needs it); this stays synchronous for the callers.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { MODEL_API_BUNDLE_FILE } from '../../../src/shared/constants'

const BUILD_SCRIPT = path.resolve('scripts', 'lib', 'buildModelApiBundle.mjs')

/** Builds the backend and its page worker into `folder`; returns the backend's path. */
export function buildModelApiBundle(folder: string): string {
  execFileSync(process.execPath, [BUILD_SCRIPT, folder], { stdio: 'pipe' })
  return path.join(folder, MODEL_API_BUNDLE_FILE)
}

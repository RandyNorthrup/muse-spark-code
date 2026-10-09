// Shared, once-per-run builds for suites whose own hooks would otherwise
// bundle the webview under a loaded run (browserEnglish, uiTextRegions hit
// their 10 s hook deadline on hosted Linux and macOS). This runs before any
// worker starts; suites read the result through inject(), unchanged
// assertions and deadlines.

import { mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import {
  BROWSER_ENGLISH,
  L10N_BUILDS_KEY,
  REGIONAL_ENGLISH,
  buildBrowserEnglish,
  buildRegionalEnglish,
} from './helpers/l10nBuilds.mjs'
import { removeFolder } from './helpers/temporaryFolders'

export default async function setup(project) {
  // Under the repository, as uiTextRegions always built: its vault probe
  // imports source by a relative path, which another drive's TEMP would break.
  mkdirSync('temp', { recursive: true })
  const root = mkdtempSync(path.resolve('temp', 'l10n-builds-'))
  await Promise.all([
    buildBrowserEnglish(path.join(root, BROWSER_ENGLISH)),
    buildRegionalEnglish(path.join(root, REGIONAL_ENGLISH)),
  ])
  project.provide(L10N_BUILDS_KEY, root)
  return async () => {
    await removeFolder(root)
  }
}

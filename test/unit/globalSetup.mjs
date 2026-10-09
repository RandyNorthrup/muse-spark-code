// Shared, once-per-run builds for suites whose own hooks would otherwise
// bundle the webview under a loaded run (browserEnglish, uiTextRegions hit
// their 10 s hook deadline on hosted Linux and macOS). This runs before any
// worker starts; suites read the result through inject(), unchanged
// assertions and deadlines.

import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import {
  BROWSER_ENGLISH,
  L10N_BUILDS_KEY,
  REGIONAL_ENGLISH,
  buildBrowserEnglish,
  buildRegionalEnglish,
} from './helpers/l10nBuilds.mjs'
import { removeFolder } from './helpers/temporaryFolders'
import {
  PRODUCTION_BUILD_KEY,
  PRODUCTION_BUILD_SUITES,
  buildProductionPackage,
} from './helpers/productionPackage'

export default async function setup(project) {
  // Under the repository, as uiTextRegions always built: its vault probe
  // imports source by a relative path, which another drive's TEMP would break.
  mkdirSync('temp', { recursive: true })
  const root = mkdtempSync(path.resolve('temp', 'l10n-builds-'))
  // Vitest registers this run's selected paths before global setup. A fresh
  // glob would include unselected suites and compile for every native test.
  const testFiles = project.vitest.state.getPaths()
  if (
    testFiles.some((file) =>
      PRODUCTION_BUILD_SUITES.some((suite) => file.replaceAll('\\', '/').endsWith(suite)),
    )
  ) {
    const production = path.join(root, 'production')
    try {
      buildProductionPackage(process.cwd(), production)
    } catch (error) {
      const sourceLog = path.join(production, 'build.log')
      const log = `${root}.build.log`
      if (existsSync(sourceLog)) cpSync(sourceLog, log)
      if (path.dirname(root) !== path.resolve('temp'))
        throw new Error('Invalid shared build root', { cause: error })
      await removeFolder(root)
      throw new Error(`Shared production build failed; diagnostics: ${log}`, { cause: error })
    }
    project.provide(PRODUCTION_BUILD_KEY, production)
  }
  await Promise.all([
    buildBrowserEnglish(path.join(root, BROWSER_ENGLISH)),
    buildRegionalEnglish(path.join(root, REGIONAL_ENGLISH)),
  ])
  project.provide(L10N_BUILDS_KEY, root)
  return async () => {
    await removeFolder(root)
  }
}

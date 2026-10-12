// Shared, once-per-run builds for suites whose own hooks would otherwise
// bundle the webview under a loaded run (browserEnglish, uiTextRegions hit
// their 10 s hook deadline on hosted Linux and macOS). This runs before any
// worker starts; suites read the result through inject(), unchanged
// assertions and deadlines.

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'
import {
  BROWSER_ENGLISH,
  L10N_BUILDS_KEY,
  REGIONAL_ENGLISH,
  buildBrowserEnglish,
  buildRegionalEnglish,
} from './helpers/l10nBuilds.mjs'
import { removeFolder } from './helpers/temporaryFolders'
import { startReviewBrowser } from './helpers/reviewBrowser.mjs'
import {
  PRODUCTION_BUILD_KEY,
  PRODUCTION_BUILD_SUITES,
  VISUAL_BUILD_KEY,
  buildProductionPackage,
} from './helpers/productionPackage'

export default async function setup(project) {
  // Under the repository, as uiTextRegions always built: its vault probe
  // imports source by a relative path, which another drive's TEMP would break.
  mkdirSync('temp', { recursive: true })
  const root = mkdtempSync(path.resolve('temp', 'l10n-builds-'))
  // Worker temp homes (test/unit/setup.ts) report here; the teardown below
  // removes exactly this run's, so concurrent runs never touch each other.
  const homeRegistry = path.join(root, 'unit-homes.txt')
  appendFileSync(homeRegistry, '')
  process.env['MUSE_UNIT_HOME_REGISTRY'] = homeRegistry
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
    if (
      testFiles.some((file) =>
        ['/visualStability.test.mjs', '/visualCapture.test.mjs'].some((suite) =>
          file.replaceAll('\\', '/').endsWith(suite),
        ),
      )
    ) {
      // Staging a complete capture root copies fixture inputs too; keep that
      // disk work before workers, outside each scene's ten-second hook.
      const visual = path.join(root, 'visual')
      buildProductionPackage(process.cwd(), visual, production)
      project.provide(VISUAL_BUILD_KEY, visual)
    }
  }
  await Promise.all([
    buildBrowserEnglish(path.join(root, BROWSER_ENGLISH)),
    buildRegionalEnglish(path.join(root, REGIONAL_ENGLISH)),
  ])
  project.provide(L10N_BUILDS_KEY, root)
  let browser
  try {
    browser = await startReviewBrowser(project, testFiles)
  } catch (error) {
    await removeFolder(root)
    throw error
  }
  return async () => {
    try {
      await browser?.close()
    } finally {
      // Workers are terminated, never exited: their exit handlers do not
      // run, so the registry (one line per worker home, reported at setup
      // time) is the removal list. A crashing worker still reports before
      // its tests; anything older than a day falls to the setup sweep.
      try {
        for (const home of readFileSync(homeRegistry, 'utf8').split('\n')) {
          if (home !== '') rmSync(home, { recursive: true, force: true })
        }
      } catch {
        // A missing registry (interrupted setup) leaves the day sweep.
      }
      await removeFolder(root)
    }
  }
}

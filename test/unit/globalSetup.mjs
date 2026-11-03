// Shared, once-per-run builds for suites whose own hooks would otherwise
// bundle the webview under a loaded run (browserEnglish, uiTextRegions hit
// their 10 s hook deadline on hosted Linux and macOS). This runs before any
// worker starts; suites read the result through inject(), unchanged
// assertions and deadlines.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import {
  BROWSER_ENGLISH,
  L10N_BUILDS_KEY,
  REGIONAL_ENGLISH,
  buildBrowserEnglish,
  buildRegionalEnglish,
} from './helpers/l10nBuilds.mjs'
import { WINDOWS_POWERSHELL_RELATIVE_PATH } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { startReviewBrowser } from './helpers/reviewBrowser.mjs'
import {
  PRODUCTION_BUILD_KEY,
  PRODUCTION_BUILD_SUITES,
  VISUAL_BUILD_KEY,
  buildProductionPackage,
} from './helpers/productionPackage'

/**
Windows PowerShell's first start on a fresh hosted runner belongs to the disk, not
to a suite: it has passed a case's 15 s (PR 165; runs 41516831678 and 41561620943,
shards 5 and 15), in whichever suite a shard happens to reach first, and each start
after takes under two seconds. So it happens here, before any worker, with the
modules the suites read and its time printed. A start that never answers is ended
and said, and the suites that need one report for themselves.
*/
const COLD_START_HUNG_MS = 180_000
function warmWindowsPowerShell() {
  if (process.platform !== 'win32') return
  const started = Date.now()
  const result = spawnSync(
    path.win32.join(process.env['SystemRoot'] ?? '', WINDOWS_POWERSHELL_RELATIVE_PATH),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$null = Get-Acl -LiteralPath $env:SystemRoot; $null = '{}' | ConvertFrom-Json",
    ],
    { stdio: 'ignore', timeout: COLD_START_HUNG_MS, windowsHide: true },
  )
  const ended = result.error === undefined ? `exit ${String(result.status)}` : result.error.message
  process.stdout.write(
    `Windows PowerShell cold start: ${String(Date.now() - started)} ms (${ended})\n`,
  )
}

export default async function setup(project) {
  warmWindowsPowerShell()
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
      await removeFolder(root)
    }
  }
}

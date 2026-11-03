// Shared, once-per-run builds for suites whose own hooks would otherwise
// bundle the webview under a loaded run (browserEnglish, uiTextRegions hit
// their 10 s hook deadline on hosted Linux and macOS). This runs before any
// worker starts; suites read the result through inject(), unchanged
// assertions and deadlines.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  BROWSER_ENGLISH,
  L10N_BUILDS_KEY,
  REGIONAL_ENGLISH,
  buildBrowserEnglish,
  buildRegionalEnglish,
} from './helpers/l10nBuilds.mjs'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import {
  WINDOWS_FRAMEWORK_RELATIVE_PATH,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { MODELS_FIRST_PAINT_KEY, buildModelsFirstPaint } from './helpers/modelsFirstPaintBuild.mjs'
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
function coldStart(label, file, args) {
  const started = Date.now()
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- each file is Windows' own under SystemRoot or the Chrome findChrome located
  const result = spawnSync(file, args, {
    stdio: 'ignore',
    timeout: COLD_START_HUNG_MS,
    windowsHide: true,
  })
  const ended = result.error === undefined ? `exit ${String(result.status)}` : result.error.message
  process.stdout.write(`${label} cold start: ${String(Date.now() - started)} ms (${ended})\n`)
}
// CimCmdlets is a module of its own, and WMI's first query is a cost of its own: the port
// list and the process table read them (makerWindowEngine and m96dCoordinatorEndpoint passed
// 15 s on run 41677635406, with the PowerShell start above already paid).
function warmWindowsPowerShell() {
  if (process.platform !== 'win32') return
  coldStart(
    'Windows PowerShell',
    path.win32.join(process.env['SystemRoot'] ?? '', WINDOWS_POWERSHELL_RELATIVE_PATH),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$null = Get-Acl -LiteralPath $env:SystemRoot; $null = '{}' | ConvertFrom-Json; $null = Get-CimInstance Win32_Process -Filter 'ProcessId=0'",
    ],
  )
}
/**
The compiler each process builds its birth reader with (processOwner.ts), and Chrome: the same
first start, in whichever suite reaches it first (runtimePullRequestRecords' first lease passed
15 s and feedbackBrowser's launch passed its 30 s hook on run 41677635406). Chrome runs on a
profile of this run's own, so a person's Chrome is never asked.
*/
function warmWindowsFirstStarts(root) {
  if (process.platform !== 'win32') return
  const source = path.join(root, 'cold-start.cs')
  writeFileSync(source, 'static class ColdStart { static void Main() {} }\n')
  coldStart(
    'Windows C# compiler',
    path.win32.join(process.env['SystemRoot'] ?? '', WINDOWS_FRAMEWORK_RELATIVE_PATH, 'csc.exe'),
    ['/nologo', `/out:${path.join(root, 'cold-start.exe')}`, source],
  )
  const chrome = findChrome()
  if (chrome === undefined) return
  coldStart('Chrome', chrome, [
    '--headless=new',
    '--disable-gpu',
    `--user-data-dir=${path.join(root, 'cold-start-chrome')}`,
    '--dump-dom',
    'about:blank',
  ])
}

export default async function setup(project) {
  warmWindowsPowerShell()
  // Under the repository, as uiTextRegions always built: its vault probe
  // imports source by a relative path, which another drive's TEMP would break.
  mkdirSync('temp', { recursive: true })
  const root = mkdtempSync(path.resolve('temp', 'l10n-builds-'))
  warmWindowsFirstStarts(root)
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
  // The Models first-paint bundle: its cold build plus a Chrome launch
  // overran the suite's hook on hosted runners, so it builds here, outside
  // every hook's deadline, and only when the suite is selected.
  if (
    testFiles.some((file) => file.replaceAll('\\', '/').endsWith('/teamModelsFirstPaint.test.mjs'))
  ) {
    const models = path.join(root, 'models-first-paint')
    await buildModelsFirstPaint(models)
    project.provide(MODELS_FIRST_PAINT_KEY, models)
  }
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

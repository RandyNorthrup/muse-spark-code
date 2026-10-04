#!/usr/bin/env node
// Renders the webview bundle in headless Chrome behind the scripted fake host
// in test/harness/index.html and writes one screenshot per scenario. This is
// the visual check behind the certification records, not a gate: it needs a
// Chrome install and a dev bundle (`npm run build:dev`).
//
//   node scripts/harness-shots.mjs            all scenarios → harness-shots/
//   node scripts/harness-shots.mjs palette    one scenario
//   node scripts/harness-shots.mjs chat-menu --theme=dark  captured theme
//   node scripts/harness-shots.mjs chat-menu-narrow --theme=light  320 px
//   node scripts/harness-shots.mjs --lang=de  in l10n/ui.de.json → harness-shots/de/
//   node scripts/harness-shots.mjs --lang=pseudo   in the pseudo-locale table
//   CHROME_PATH=/path/to/chrome node scripts/harness-shots.mjs

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { findChrome } from './lib/chrome.mjs'
import { harnessArgs, langQuery, prepareLang } from './lib/harnessLang.mjs'
import {
  HARNESS_PATH,
  LOOPBACK,
  SCENARIOS,
  serveRepo,
  withNarrowPage,
} from './lib/harnessServer.mjs'

const OUT_DIR = 'harness-shots'
const BUNDLE_PATH = 'dist/webview/main.js'
const WINDOW_SIZE = '690,760'
const VIRTUAL_TIME_BUDGET_MS = 6000
const execFileAsync = promisify(execFile)
const repoRoot = process.cwd()
const THEMES = new Set(['light', 'dark', 'hc-dark', 'hc-light'])

async function shoot(chrome, port, scenario, lang, theme, outDir, profileDir) {
  const file = path.join(outDir, `${scenario}.png`)
  const url = `http://${LOOPBACK}:${String(port)}/${HARNESS_PATH}?scenario=${scenario}${langQuery(lang)}${theme === undefined ? '' : `&theme=${theme}`}`
  if (scenario === 'share-narrow' || scenario === 'chat-menu-narrow') {
    await withNarrowPage(chrome, profileDir, url, async (page) => {
      await page.getByRole(scenario === 'share-narrow' ? 'dialog' : 'menu').waitFor()
      await page.screenshot({ path: file, animations: 'disabled' })
    })
    return file
  }
  await execFileAsync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${profileDir}`,
    `--window-size=${WINDOW_SIZE}`,
    `--virtual-time-budget=${String(VIRTUAL_TIME_BUDGET_MS)}`,
    `--screenshot=${file}`,
    url,
  ])
  return file
}

async function main() {
  if (!existsSync(path.join(repoRoot, BUNDLE_PATH))) {
    throw new Error(`${BUNDLE_PATH} is missing; run \`npm run build:dev\` first`)
  }
  const chrome = findChrome()
  if (chrome === undefined) {
    throw new Error('No Chrome install found; set CHROME_PATH to the browser executable')
  }
  const args = process.argv.slice(2)
  const theme = args.find((arg) => arg.startsWith('--theme='))?.slice('--theme='.length)
  if (theme !== undefined && !THEMES.has(theme)) {
    throw new Error(`Unknown theme: ${theme}`)
  }
  const { lang, scenarios: requested } = harnessArgs(
    args.filter((arg) => !arg.startsWith('--theme=')),
  )
  const unknown = requested.filter((name) => !SCENARIOS.includes(name))
  if (unknown.length > 0) {
    throw new Error(`Unknown scenario(s): ${unknown.join(', ')}. Known: ${SCENARIOS.join(', ')}`)
  }
  await prepareLang(repoRoot, lang)
  const scenarios = requested.length > 0 ? requested : SCENARIOS
  const outDir = path.join(repoRoot, OUT_DIR, lang ?? '', theme ?? '')
  await mkdir(outDir, { recursive: true })
  // Chrome's profile lives in a temporary directory for the run, not beside
  // the screenshots, and goes when the run ends.
  const profileDir = await mkdtemp(path.join(tmpdir(), 'muse-harness-'))
  const { server, port } = await serveRepo(repoRoot)
  try {
    for (const scenario of scenarios) {
      const file = await shoot(chrome, port, scenario, lang, theme, outDir, profileDir)
      console.log(`${scenario}: ${path.relative(repoRoot, file)}`)
    }
  } finally {
    server.close()
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

await main()

#!/usr/bin/env node
// Renders one webview scene from the built bundle in headless Chrome behind
// the scripted host in test/harness/index.html, for a person to LOOK at
// after a UI change. No baseline, no comparison, no CI: the pictures land in
// temp/ui-look/ (gitignored) and are never uploaded anywhere. It needs a
// Chrome install and a dev bundle (`npm run build:dev`).
//
//   npm run ui:look -- palette                    one scene, light and dark
//   npm run ui:look -- chat-menu --theme=dark     one scene, one theme
//   npm run ui:look -- chat-menu-narrow --theme=light  320 px scene
//   npm run ui:look -- palette --lang=de          in l10n/ui.de.json
//   CHROME_PATH=/path/to/chrome npm run ui:look -- palette

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { findChrome } from './lib/chrome.mjs'
import { screenshotUrl, waitForHarness } from './lib/harnessCapture.mjs'
import { harnessArgs, langQuery, prepareLang } from './lib/harnessLang.mjs'
import {
  HARNESS_PATH,
  LOOPBACK,
  SCENARIOS,
  bundleFor,
  SIZED_SCENARIOS,
  serveRepo,
  withSizedPage,
} from './lib/harnessServer.mjs'

const OUT_DIR = path.join('temp', 'ui-look')
const BUNDLE_PATH = 'dist/webview/main.js'
const MODELS_BUNDLE_PATH = 'dist/webview/models.js'
const SHOT_WIDTH = 690
const SHOT_HEIGHT = 760
const repoRoot = process.cwd()
// A look covers the two editor themes; --theme picks one of them.
const THEMES = new Set(['light', 'dark'])

async function shoot(chrome, port, scenario, lang, theme, outDir, profileDir) {
  const file = path.join(outDir, `${scenario}.${theme}.png`)
  const url = `http://${LOOPBACK}:${String(port)}/${HARNESS_PATH}?scenario=${scenario}&bundle=${bundleFor(scenario)}${langQuery(lang)}&theme=${theme}`
  const sized = SIZED_SCENARIOS[scenario]
  if (sized !== undefined) {
    await withSizedPage(chrome, profileDir, url, sized, async (page) => {
      await waitForHarness(page)
      await page.locator(sized.ready).first().waitFor()
      await page.screenshot({ path: file, animations: 'disabled' })
    })
    return file
  }
  await screenshotUrl(chrome, url, file, {
    width: SHOT_WIDTH,
    height: SHOT_HEIGHT,
    profileDir,
  })
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
    throw new Error(`Unknown theme: ${theme}. Known: ${[...THEMES].join(', ')}`)
  }
  const { lang, scenarios: requested } = harnessArgs(
    args.filter((arg) => !arg.startsWith('--theme=')),
  )
  if (requested.length !== 1 || requested[0] === undefined) {
    throw new Error(
      `Name exactly one scene: npm run ui:look -- <scene> [--theme light|dark]. Known: ${SCENARIOS.join(', ')}`,
    )
  }
  const scenario = requested[0]
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`Unknown scenario: ${scenario}. Known: ${SCENARIOS.join(', ')}`)
  }
  if (bundleFor(scenario) === 'models' && !existsSync(path.join(repoRoot, MODELS_BUNDLE_PATH))) {
    throw new Error(`${MODELS_BUNDLE_PATH} is missing; run npm run build:dev first`)
  }
  await prepareLang(repoRoot, lang)
  const themes = theme === undefined ? [...THEMES] : [theme]
  const outDir = path.join(repoRoot, OUT_DIR, lang ?? '')
  await mkdir(outDir, { recursive: true })
  // Chrome's profile lives in a temporary directory for the run, not beside
  // the screenshots, and goes when the run ends.
  const profileDir = await mkdtemp(path.join(tmpdir(), 'muse-ui-look-'))
  const { server, port } = await serveRepo(repoRoot)
  try {
    for (const each of themes) {
      const file = await shoot(chrome, port, scenario, lang, each, outDir, profileDir)
      console.log(`${scenario} ${each}: ${path.relative(repoRoot, file)}`)
    }
  } finally {
    server.close()
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

await main()

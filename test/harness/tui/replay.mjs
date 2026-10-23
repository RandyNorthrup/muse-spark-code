#!/usr/bin/env node
// Replays TUI goldens through a real xterm.js terminal in headless Chrome
// and screenshots the result, for a person to LOOK at. No baseline, no
// comparison, no CI: the pictures land in temp/ui-look/ (gitignored).
//   node test/harness/tui/replay.mjs
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { LOOPBACK, PAGE_TIMEOUT_MS, serveRepo } from '../../../scripts/lib/harnessServer.mjs'

const SHOTS = [
  { golden: 'splash/truecolor-80x24.ans', theme: 'dark', cols: 80, rows: 24 },
  { golden: 'splash/truecolor-80x24-light.ans', theme: 'light', cols: 80, rows: 24 },
  { golden: 'panel/sixteen-80x24.ans', theme: 'dark', cols: 80, rows: 24 },
  { golden: 'bottom/truecolor-80x24.ans', theme: 'dark', cols: 80, rows: 24 },
  { golden: 'panel-reader/reader-80x24.ans', theme: 'dark', cols: 80, rows: 24 },
]

async function main() {
  const chrome = findChrome()
  if (chrome === undefined) {
    throw new Error('No Chrome install found; set CHROME_PATH to the browser executable')
  }
  await build({
    entryPoints: ['test/harness/tui/replay-entry.ts'],
    outfile: 'dist/tui-replay/replay.js',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome128',
    logLevel: 'silent',
  })
  const { server, port } = await serveRepo(process.cwd())
  const profileDir = await mkdtemp(path.join(tmpdir(), 'muse-tui-replay-'))
  const outDir = path.join('temp', 'ui-look')
  mkdirSync(outDir, { recursive: true })
  try {
    const browser = await chromium.launchPersistentContext(profileDir, {
      ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
      viewport: { width: 900, height: 640 },
      args: ['--hide-scrollbars'],
      timeout: PAGE_TIMEOUT_MS,
    })
    try {
      for (const shot of SHOTS) {
        const name = `tui-${shot.golden.replaceAll('/', '-').replace(/\.ans$/, '')}.${shot.theme}.png`
        const url =
          `http://${LOOPBACK}:${String(port)}/test/harness/tui/replay.html` +
          `?golden=${shot.golden}&theme=${shot.theme}&cols=${String(shot.cols)}&rows=${String(shot.rows)}`
        const page = await browser.newPage()
        await page.goto(url)
        await page.locator('#replay-ready').waitFor({ state: 'attached', timeout: PAGE_TIMEOUT_MS })
        await page.screenshot({ path: path.join(outDir, name), animations: 'disabled' })
        await page.close()
        console.log(name)
      }
    } finally {
      await browser.close()
    }
  } finally {
    server.close()
    await rm(profileDir, { recursive: true, force: true })
  }
}

await main()

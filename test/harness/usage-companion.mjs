// Real shipped companion, shared ESM chunks, CSP and authenticated browser download.
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { assertUsageContent } from './usageReadiness.mjs'

const requireFile = createRequire(import.meta.url)
const { createUsageAccess } = requireFile(path.resolve('dist/usageService.js'))
const { openUsageCompanion } = requireFile(path.resolve('dist/usageCompanion.js'))
const { EN } = requireFile(path.resolve('dist/uiText.js'))
const executablePath = findChrome()
assert.ok(executablePath, 'Chrome is required')
const dataFolder = await mkdtemp(path.resolve('temp/usage-browser-'))
const errors = []
const log = {
  debug() {
    /* This browser check records failures only. */
  },
  info() {
    /* This browser check records failures only. */
  },
  warn(message) {
    errors.push(message)
  },
  error(message) {
    errors.push(message)
  },
}
const browser = await chromium.launch({ executablePath, headless: true })
try {
  for (const host of [
    'JetBrains',
    'Eclipse',
    'Visual Studio',
    'Neovim',
    'Emacs',
    'Sublime',
    'Qt Creator',
    'Zed',
    'Xcode',
  ]) {
    const usage = createUsageAccess({
      dataFolder,
      packageRoot: process.cwd(),
      host,
      locale: 'en',
      uiText: EN,
      log,
    })
    const companion = await openUsageCompanion({
      usage,
      assetsFolder: path.resolve('dist/webview'),
      locale: 'en',
      uiText: EN,
      log,
    })
    const page = await browser.newPage()
    page.on('pageerror', (error) => {
      errors.push(error.message)
    })
    try {
      await page.goto(companion.launchUrl())
      // RVCM1141D P3: only rendered content with no alert certifies the
      // page; the real companion serves the same Usage view, so its empty
      // journal renders the marker, the host line and the empty heading.
      // A post-load `usage/error` keeps the marker under the alert, so a
      // bare marker wait must not certify either load. The host line names
      // this companion's editor (state.history.host is deps.host), not the
      // fixture machine of USAGE_HOST_LINE.
      await assertUsageContent(page, {
        title: `companion/${host}`,
        scenario: 'empty',
        hostLine: `History is stored on ${host}.`,
      })
      assert.ok(await page.getByText(/This page cannot open editor settings/).isVisible())
      assert.ok(
        await page.getByRole('button', { name: 'Usage settings', exact: true }).isDisabled(),
      )
      await page.getByRole('radio', { name: '7 days', exact: true }).check()
      await assertUsageContent(page, {
        title: `companion/${host}`,
        scenario: 'empty',
        hostLine: `History is stored on ${host}.`,
      })
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      const downloading = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Versioned JSON', exact: true }).click()
      const download = await downloading
      assert.equal(await download.failure(), null)
      assert.equal(download.suggestedFilename(), 'usage.json')
      console.log(`ok ${host}: authenticated shared-module page, filters, disclosure and download`)
    } finally {
      await page.close()
      await companion.close()
    }
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
  await rm(dataFolder, { recursive: true, force: true })
}

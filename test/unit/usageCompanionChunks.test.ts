import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openUsageCompanion } from '../../src/runtime/usage/usageCompanionEntry'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { EN } from '../../src/shared/l10n/en'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { WEBVIEW_L10N_ELEMENT_ID } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

// Real cold production bundling and browser launch are shared outside 5-second assertions.
const COLD_SETUP_TIMEOUT_MS = 120_000

describe('shared usage companion chunks', () => {
  let browser: Browser | undefined
  let dataFolder = ''
  beforeAll(async () => {
    execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    await mkdir('temp', { recursive: true })
    dataFolder = await mkdtemp(path.resolve('temp/train15g-usage-chunks-'))
  }, COLD_SETUP_TIMEOUT_MS)
  afterAll(async () => {
    await browser?.close()
    if (dataFolder !== '') await removeFolder(dataFolder)
  })

  it('loads the real shared vendor and lazy Usage body under its authenticated nonce CSP', async () => {
    if (browser === undefined) throw new Error('browser startup failed')
    const log = new FakeLogOutputChannel()
    const usage = createUsageAccess({
      dataFolder,
      packageRoot: process.cwd(),
      host: 'ACP',
      locale: 'en',
      uiText: EN,
      log,
    })
    const panel = await openUsageCompanion({
      usage,
      assetsFolder: path.resolve('dist/webview'),
      locale: 'en',
      uiText: EN,
      log,
    })
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
    })
    try {
      const response = await page.goto(panel.launchUrl())
      expect(response?.headers()['content-security-policy']).toContain("script-src 'nonce-")
      await page.getByRole('heading', { name: USAGE_EN.title, exact: true }).waitFor()
      expect(await page.getByRole('alert').count()).toBe(0)
      expect(await page.locator(`#${WEBVIEW_L10N_ELEMENT_ID}`).textContent()).toBe(
        JSON.stringify({ locale: 'en', table: EN }).replaceAll('<', String.raw`\u003c`),
      )
      expect(
        await page.getByRole('button', { name: USAGE_EN.refresh, exact: true }).isVisible(),
      ).toBe(true)
      expect(errors).toEqual([])
      expect(log.warn).not.toHaveBeenCalled()
    } finally {
      await page.close()
      await panel.close()
    }
  })
})

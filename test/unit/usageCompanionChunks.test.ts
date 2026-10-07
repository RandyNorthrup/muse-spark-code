import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { openUsageCompanion } from '../../src/runtime/usage/usageCompanionEntry'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { EN } from '../../src/shared/l10n/en'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { WEBVIEW_L10N_ELEMENT_ID } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'

await mkdir('temp', { recursive: true })
const dataFolder = await mkdtemp(path.resolve('temp/train15g-usage-chunks-'))
const assetsFolder = path.join(dataFolder, 'dist/webview')
// Only the two page entries sharing vendor code are needed for this CSP test.
// Keep production's browser table transform, module splitting and lazy body.
await build({
  entryPoints: {
    models: 'src/webview/models/models.tsx',
    usage: 'src/webview/usage/usage.tsx',
  },
  outdir: assetsFolder,
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  splitting: true,
  chunkNames: 'chunks/[hash]',
  target: 'chrome128',
  jsx: 'automatic',
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [compactBrowserUiText],
  logLevel: 'silent',
})
const browser: Browser = await chromium.launch({ channel: 'chrome', headless: true })

describe('shared usage companion chunks', () => {
  afterAll(async () => {
    await browser.close()
    await removeFolder(dataFolder)
  })

  it('loads the real shared vendor and lazy Usage body under its authenticated nonce CSP', async () => {
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
      assetsFolder,
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

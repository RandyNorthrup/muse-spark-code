import { readFileSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { waitForHarness } from '../../scripts/lib/harnessCapture.mjs'
import { prepareLang } from '../../scripts/lib/harnessLang.mjs'
import { HARNESS_PATH, LOOPBACK, serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { PRODUCTION_BUILD_KEY } from './helpers/productionPackage'
import { warmBrowser } from './helpers/warmBrowser'

const runtime = {}
const themes = JSON.parse(readFileSync('test/harness/visual-matrix.json', 'utf8')).themes
const scenes = ['feedback-narrow', 'feedback-preview-narrow', 'feedback-sent-narrow']

beforeAll(async () => {
  runtime.root = inject(PRODUCTION_BUILD_KEY)
  await prepareLang(runtime.root, 'pseudo')
  const chrome = findChrome()
  if (!chrome) throw new Error('Chrome is required for feedback verification')
  runtime.browser = await chromium.launch({ executablePath: path.resolve(chrome) })
  const served = await serveRepo(runtime.root)
  runtime.server = served.server
  runtime.port = served.port
})
beforeAll(async () => {
  await warmBrowser(runtime.browser)
})
afterAll(async () => {
  await runtime.browser?.close()
  await new Promise((resolve) => runtime.server?.close(resolve) ?? resolve())
})

async function open(scene, theme, lang = '') {
  const page = await runtime.browser.newPage({ viewport: { width: 320, height: 760 } })
  try {
    await page.goto(
      `http://${LOOPBACK}:${runtime.port}/${HARNESS_PATH}?scenario=${scene}&theme=${theme}${lang}`,
    )
    await waitForHarness(page)
    await page.getByRole('dialog').waitFor()
    return page
  } catch (error) {
    await page.close()
    throw error
  }
}

describe('native feedback in production Chrome', () => {
  for (const theme of themes) {
    for (const scene of scenes) {
      it(`${theme}/${scene}: usable modal, trapped Tab and focus return`, async () => {
        const page = await open(scene, theme)
        try {
          const dialog = page.getByRole('dialog')
          expect(await dialog.evaluate((node) => node.closest('[inert]') === null)).toBe(true)
          expect(
            await dialog.evaluate((node) => node.contains(globalThis.document.activeElement)),
          ).toBe(true)
          expect(await page.locator('.header-area').evaluate((node) => node.inert)).toBe(true)
          expect(await page.locator('.composer-area').evaluate((node) => node.inert)).toBe(true)
          await dialog.locator('#feedback-note').click()
          expect(
            await dialog
              .locator('#feedback-note')
              .evaluate((node) => node === globalThis.document.activeElement),
          ).toBe(true)
          if (scene === 'feedback-narrow') {
            await dialog.locator('#feedback-note').fill('Keyboard and pointer feedback')
            await dialog.locator('button[type="submit"]').click()
            await dialog.getByRole('button', { name: 'Edit', exact: true }).waitFor()
            await dialog.locator('button[type="submit"]').click()
            await page.waitForFunction(
              () =>
                globalThis.document.querySelector('[role="dialog"] [role="status"]')
                  ?.textContent === 'Feedback uploaded.',
            )
          }
          const close = dialog.getByRole('button', { name: 'Close', exact: true })
          await close.focus()
          await page.keyboard.press('Shift+Tab')
          expect(
            await dialog
              .locator('button[type="submit"]')
              .evaluate((node) => node === globalThis.document.activeElement),
          ).toBe(true)
          await page.keyboard.press('Tab')
          expect(await close.evaluate((node) => node === globalThis.document.activeElement)).toBe(
            true,
          )
          await page.keyboard.press('Escape')
          await dialog.waitFor({ state: 'detached' })
          expect(
            await page
              .locator('[data-role="assistant"] .row-actions-button')
              .evaluate((node) => node === globalThis.document.activeElement),
          ).toBe(true)
          expect(await page.locator('.header-area').evaluate((node) => node.inert)).toBe(false)
        } finally {
          await page.close()
        }
      })
    }
    it(`${theme}: pseudo receipt uses installed language`, async () => {
      const page = await open('feedback-sent-narrow', theme, '&lang=pseudo')
      try {
        const receipt = await page.getByRole('dialog').getByRole('status').textContent()
        const expected = JSON.parse(
          readFileSync(path.join(runtime.root, 'test/harness/l10n/ui.pseudo.json'), 'utf8'),
        ).feedbackUploaded
        expect(receipt).toBe(expected)
        expect(receipt).not.toBe('Feedback uploaded.')
      } finally {
        await page.close()
      }
    })
  }
})

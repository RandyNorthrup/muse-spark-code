// U-owned standalone scenes. The lead can add them to the main harness after
// I binds the panel port. Uses the repository's pinned esbuild/Playwright/axe.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

await mkdir('temp', { recursive: true })
await build({
  entryPoints: ['test/harness/playbook.mjs'],
  outfile: 'temp/playbook-harness.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome132',
  jsx: 'automatic',
})
const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome is unavailable')
const { server, port } = await serveRepo(process.cwd())
const browser = await chromium.launch(
  path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
)
const themes = ['light', 'dark', 'hc-light', 'hc-dark']
const locales = [
  'en',
  'zh-cn',
  'zh-tw',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'pt-br',
  'ru',
  'it',
  'tr',
  'pl',
  'cs',
  'hu',
]
const results = []
try {
  for (const locale of locales)
    for (const theme of themes)
      for (const width of [320, 690]) {
        const page = await browser.newPage({ viewport: { width, height: 760 } })
        page.setDefaultTimeout(10_000)
        const errors = []
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        for (const scene of ['status', 'record', 'settings', 'notes']) {
          await page.goto(
            `http://127.0.0.1:${String(port)}/test/harness/playbook.html?lang=${locale}&theme=${theme}&scene=${scene}`,
          )
          if (scene === 'notes') await page.locator('.playbook-badge').first().waitFor()
          else {
            await page.locator('.playbook-record').waitFor()
            if (scene !== 'status')
              await page
                .locator('.playbook-views button')
                .nth(scene === 'record' ? 1 : 2)
                .click()
            if (scene === 'settings') await page.locator('.playbook-switch').first().waitFor()
          }
          await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
          const violations = await page.evaluate(async () => {
            const result = await globalThis.axe.run(globalThis.document, {
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
              },
            })
            return result.violations.map((item) => ({
              id: item.id,
              nodes: item.nodes.map((node) => node.target),
            }))
          })
          const geometry = await page.evaluate(() => {
            const buttons = [...globalThis.document.querySelectorAll('.playbook-views button')].map(
              (button) => button.getBoundingClientRect(),
            )
            return {
              overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
              equalButtons: buttons.every(
                (rect) =>
                  Math.abs(rect.width - buttons[0].width) < 1 &&
                  Math.abs(rect.top - buttons[0].top) < 1,
              ),
            }
          })
          const result = { locale, theme, width, scene, violations, geometry, errors: [...errors] }
          results.push(result)
          if (
            violations.length > 0 ||
            geometry.overflow ||
            !geometry.equalButtons ||
            errors.length > 0
          ) {
            throw new Error(JSON.stringify(result))
          }
          if (locale !== 'en' || theme !== 'dark' || width !== 320) continue
          await mkdir('docs/certification/m116-u', { recursive: true })
          await page.screenshot({
            path: `docs/certification/m116-u/${scene}-dark-320.png`,
            fullPage: true,
          })
        }
        await page.close()
        process.stdout.write(`${locale} ${theme} ${String(width)}: four scenes passed\n`)
      }
} finally {
  await writeFile('temp/m116-u-axe.json', JSON.stringify(results, null, 2))
  await browser.close()
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
process.stdout.write(
  `${String(results.length)} scans: zero WCAG 2.2 AA violations; no horizontal overflow; equal view buttons on one row.\n`,
)

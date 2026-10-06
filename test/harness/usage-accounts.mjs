// Reported account meter/warning through every host, palette and width.
import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

await build({
  entryPoints: ['test/harness/usageHost.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'temp/m102-usage-host.js',
})
const engine = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
const browser = await chromium.launch({ executablePath: findChrome(), headless: true })
const { server, port } = await serveRepo(process.cwd())
const failures = []
let cases = 0
try {
  for (const bridge of ['vscode', 'http', 'jcef', 'webView2', 'swt']) {
    for (const theme of ['light', 'dark', 'hc-dark', 'hc-light']) {
      for (const width of [690, 320]) {
        const page = await browser.newPage({ viewport: { width, height: 760 } })
        try {
          await page.goto(
            `http://127.0.0.1:${String(port)}/test/harness/usage.html?bridge=${bridge}&theme=${theme}`,
          )
          await page.locator('.usage-page[aria-busy="false"]').waitFor()
          await page.evaluate(() => {
            globalThis.usageHarness.addAccount()
          })
          await page.getByRole('button', { name: 'Refresh', exact: true }).click()
          const card = page
            .getByRole('heading', { name: 'Provider account budget: openrouter' })
            .locator('..')
          await card.getByText('At least 90% of the limit is used.').waitFor()
          await card.scrollIntoViewIfNeeded()
          const value = await card.getByRole('progressbar').getAttribute('aria-valuetext')
          if (value !== '$9.00 of $10.00') throw new Error('Incorrect account meter description')
          await card.evaluate((element) => {
            element.id = 'usage-account-check'
          })
          await page.addScriptTag({ content: engine })
          const result = await page.evaluate(async () => {
            const scanned = await globalThis.axe.run('#usage-account-check', {
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
              },
              resultTypes: ['violations', 'incomplete'],
            })
            return {
              violations: scanned.violations,
              incomplete: scanned.incomplete,
              errors: globalThis.usageHarness.errors,
              overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
            }
          })
          if (
            result.violations.length > 0 ||
            result.incomplete.length > 0 ||
            result.errors.length > 0 ||
            result.overflow
          )
            failures.push({ bridge, theme, width, ...result })
          cases++
        } catch (error) {
          failures.push({ bridge, theme, width, error: String(error) })
        } finally {
          await page.close()
        }
      }
    }
  }
} finally {
  await browser.close()
  server.close()
}
await writeFile('temp/usage-accounts.json', JSON.stringify({ cases, failures }, null, 2))
console.log(`${String(cases)} account cases; ${String(failures.length)} failures`)
if (failures.length > 0) process.exitCode = 1

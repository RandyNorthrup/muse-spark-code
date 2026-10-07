// Lane U's isolated browser harness, all states through all five host bridges.
// Run: node test/harness/usage-check.mjs after npm run build.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

const root = process.cwd()
const bridges = ['vscode', 'http', 'jcef', 'webView2', 'swt']
const themes = ['light', 'dark', 'hc-dark', 'hc-light']
const scenarios = [
  'empty',
  'history-off',
  'one-provider',
  'nine-providers',
  'plan-only',
  'local-only',
  'stale',
  'over-limit',
  'newer-version',
  'long-german',
  'long-russian',
]
await mkdir(path.join(root, 'temp/usage-shots'), { recursive: true })
await build({
  entryPoints: ['test/harness/usageHost.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'temp/m102-usage-host.js',
})
const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome is required for usage accessibility')
const browser = await chromium.launch({ executablePath: chrome, headless: true })
const { server, port } = await serveRepo(root)
const axe = await readFile(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8')
const failures = []
let pages = 0
try {
  for (const bridge of bridges) {
    for (const theme of themes) {
      for (const width of [690, 320]) {
        for (const scenario of scenarios) {
          const page = await browser.newPage({
            viewport: { width, height: 760 },
            reducedMotion: 'reduce',
          })
          const title = `${bridge}/${theme}/${String(width)}/${scenario}`
          try {
            await page.goto(
              `http://127.0.0.1:${String(port)}/test/harness/usage.html?bridge=${bridge}&scenario=${scenario}&theme=${theme}`,
            )
            await page.locator('.usage-page[aria-busy="false"]').waitFor()
            if (scenario === 'history-off') {
              await page.getByRole('button', { name: 'Turn on usage history' }).click()
              await page
                .getByRole('heading', { name: 'Usage history is off' })
                .waitFor({ state: 'detached' })
            } else if (scenario === 'nine-providers') {
              for (const range of ['7 days', '30 days', '90 days', 'Today'])
                await page.getByRole('radio', { name: range }).check()
              for (const group of ['model', 'kind', 'client', 'provider'])
                await page.getByLabel('Group by').selectOption(group)
              for (const metric of ['tokens', 'requests', 'time', 'cost'])
                await page.getByLabel('Metric').selectOption(metric)
              await page.locator('.usage-page[aria-busy="false"]').waitFor()
              await page.getByRole('radio', { name: 'Custom range' }).check()
              await page.getByLabel('From', { exact: true }).fill('2026-10-01')
              await page.getByLabel('To', { exact: true }).fill('2026-10-05')
              for (const [label, dates] of [
                ['From', ['2026-10-02', '2026-10-03']],
                ['To', ['2026-10-06', '2026-10-07']],
              ]) {
                const input = await page.getByLabel(label, { exact: true }).elementHandle()
                if (input === null) throw new Error('Missing custom date input')
                await input.focus()
                for (const date of dates) {
                  await input.fill(date)
                  await page.locator('.usage-page[aria-busy="false"]').waitFor()
                  if (
                    !(await input.evaluate(
                      (element) => globalThis.document.activeElement === element,
                    ))
                  )
                    throw new Error('Custom date edit lost input identity or keyboard focus')
                }
                await input.dispose()
              }
              await page.getByRole('radio', { name: 'Today' }).check()
              await page.locator('.usage-page[aria-busy="false"]').waitFor()
              if (['jcef', 'webView2', 'swt'].includes(bridge)) {
                await page.evaluate(() => {
                  globalThis.usageHarness.failNextSend()
                })
                await page.getByRole('button', { name: 'Refresh', exact: true }).click()
                await page.getByRole('alert').waitFor()
                const alert = await page.getByRole('alert').textContent()
                if (alert?.includes('Private native'))
                  throw new Error('Native transport detail leaked')
                if (!alert?.includes('Usage history could not be read.'))
                  throw new Error('Native transport failure has no localized error')
                if (!(await page.getByRole('button', { name: 'Refresh', exact: true }).isEnabled()))
                  throw new Error('Native transport failure left Refresh disabled')
                await page.locator('.usage-page[aria-busy="false"]').waitFor()
                await page.getByRole('button', { name: 'Try again', exact: true }).click()
                await page.getByRole('alert').waitFor({ state: 'detached' })
              }
              await page.getByRole('button', { name: 'Refresh', exact: true }).click()
              await page.locator('.usage-page[aria-busy="false"]').waitFor()
              for (const format of [
                'Per-call CSV (last 30 days)',
                'Summary CSV',
                'Versioned JSON',
              ]) {
                await page.getByRole('button', { name: 'Export', exact: true }).click()
                await page.getByRole('button', { name: format, exact: true }).click()
              }
              await page.getByRole('button', { name: 'Delete usage history…' }).click()
              await page.getByRole('button', { name: 'Usage settings' }).click()
              await page.getByRole('button', { name: 'Open history folder' }).click()
              await page.getByRole('button', { name: 'Open provider console' }).click()
              await page
                .getByRole('table', { name: 'Breakdown' })
                .getByRole('button', { name: 'openai', exact: true })
                .click()
              await page.getByRole('button', { name: 'Set price' }).click()
              await page.getByRole('button', { name: 'Close', exact: true }).click()
              const posted = await page.evaluate(() =>
                globalThis.usageHarness.posted.map((message) => message.type),
              )
              for (const request of [
                'usage/ready',
                'usage/query',
                'usage/refresh',
                'usage/export',
                'usage/deleteHistory',
                'usage/openSettings',
                'usage/revealFolder',
                'usage/openExternal',
                'usage/modelDetail',
                'usage/openModels',
              ]) {
                if (!posted.includes(request)) throw new Error(`Bridge did not carry ${request}`)
              }
              await page.locator('details').evaluateAll((elements) => {
                for (const element of elements) element.open = true
              })
            }
            await page.evaluate(async () => {
              await globalThis.document.fonts.ready
            })
            const overflow = await page.evaluate(
              () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
            )
            if (overflow) failures.push({ title, error: 'Page overflows horizontally' })
            await page.addScriptTag({ content: axe })
            const result = await page.evaluate(async () => {
              const scanned = await globalThis.axe.run(globalThis.document, {
                runOnly: {
                  type: 'tag',
                  values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
                },
                resultTypes: ['violations', 'incomplete'],
              })
              // A horizontally clipped cell cannot have its contrast measured.
              // Check every unresolved node after bringing it fully into view;
              // no finding is exempted or discarded without a passing recheck.
              const unresolved = []
              for (const finding of scanned.incomplete) {
                for (const node of finding.nodes) {
                  const element = globalThis.document.querySelector(node.target.join(' '))
                  if (element === null) {
                    unresolved.push(finding)
                    continue
                  }
                  element.scrollIntoView({ block: 'center', inline: 'center' })
                  const checked = await globalThis.axe.run(element, {
                    runOnly: { type: 'rule', values: [finding.id] },
                    resultTypes: ['violations', 'incomplete'],
                  })
                  scanned.violations.push(...checked.violations)
                  unresolved.push(...checked.incomplete)
                }
              }
              return {
                violations: scanned.violations,
                incomplete: unresolved,
                errors: globalThis.usageHarness.errors,
              }
            })
            if (
              result.violations.length > 0 ||
              result.incomplete.length > 0 ||
              result.errors.length > 0
            )
              failures.push({ title, ...result })
            if (
              bridge === 'vscode' &&
              theme === 'light' &&
              ['nine-providers', 'long-german', 'long-russian', 'over-limit'].includes(scenario)
            ) {
              await page.locator('.usage-table-scroll').evaluateAll((elements) => {
                for (const element of elements) element.scrollLeft = 0
              })
              await page.evaluate(() => {
                globalThis.scrollTo(0, 0)
              })
              await page.screenshot({
                path: path.join(root, `temp/usage-shots/${scenario}-${String(width)}.png`),
                fullPage: true,
              })
              if (scenario === 'nine-providers') {
                await page
                  .locator('figure')
                  .first()
                  .screenshot({
                    path: path.join(root, `temp/usage-shots/cost-chart-${String(width)}.png`),
                  })
                await page
                  .locator('figure')
                  .nth(1)
                  .screenshot({
                    path: path.join(root, `temp/usage-shots/share-chart-${String(width)}.png`),
                  })
              }
            }
            pages++
          } catch (error) {
            failures.push({ title, error: String(error) })
          } finally {
            await page.close()
          }
        }
        console.log(
          `${bridge}/${theme}/${String(width)}: ${String(scenarios.length)} usage states checked`,
        )
      }
    }
  }
} finally {
  await browser.close()
  server.close()
}
await writeFile(
  path.join(root, 'temp/usage-a11y.json'),
  JSON.stringify({ pages, failures }, null, 2),
)
console.log(`${String(pages)} pages; ${String(failures.length)} failures (temp/usage-a11y.json)`)
if (failures.length > 0) process.exitCode = 1

// Direct Mac-mini fake-only browser/axe run; all artifacts stay under temp/m107-u.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

const root = process.cwd()
const scenes = ['normal', 'throttle', 'relocate', 'pause', 'companion', 'traffic']
const requested = process.argv.slice(2)
if (requested.some((scene) => !scenes.includes(scene))) throw new Error('Unknown resource scene')
const selected = requested.length === 0 ? scenes : requested
const html = await readFile(path.join(root, 'test/harness/resources.html'), 'utf8')
const output = path.join(root, 'temp/m107-u/harness')
await mkdir(output, { recursive: true })
const built = await build({
  entryPoints: ['test/harness/resources-entry.mjs'],
  outdir: output,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  metafile: true,
})
await writeFile(path.join(output, 'meta.json'), JSON.stringify(built.metafile, null, 2))
const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome is required for the resource surfaces acceptance')
const browser = await chromium.launch({ executablePath: chrome, headless: true })
const { server, port } = await serveRepo(root)
const results = []
try {
  for (const theme of ['light', 'dark', 'hc-dark', 'hc-light']) {
    const captured = JSON.parse(
      await readFile(path.join(root, 'test/harness/themes', `${theme}.json`), 'utf8'),
    )
    for (const width of [690, 320]) {
      for (const scene of selected) {
        const page = await browser.newPage({
          viewport: { width, height: 760 },
          reducedMotion: 'reduce',
        })
        const errors = []
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning')
            errors.push(message.text())
        })
        const url = `http://127.0.0.1:${String(port)}/test/harness/resources.html?level=${scene === 'companion' || scene === 'traffic' ? 'pause' : scene}&surface=${scene === 'companion' || scene === 'traffic' ? scene : 'panel'}`
        try {
          const themed = html
            .replace(
              '<head>',
              () =>
                `<head><style>:root { ${Object.entries(captured.variables)
                  .map(([key, value]) => `${key}: ${value};`)
                  .join('\n')} }</style>`,
            )
            .replace('<body>', () => `<body class="${captured.bodyClass}">`)
          await page.route('**/resources.html*', async (route) => {
            await route.fulfill({ contentType: 'text/html', body: themed })
          })
          await page.goto(url)
          await page
            .locator(scene === 'traffic' ? '.resource-task-row' : '.resource-chip')
            .waitFor()
          if (scene !== 'traffic') await page.locator('.resource-chip').click()
          await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') })
          const axe = await page.evaluate(
            async () =>
              await globalThis.window.axe.run(globalThis.document, {
                runOnly: {
                  type: 'tag',
                  values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
                },
                resultTypes: ['violations', 'incomplete'],
              }),
          )
          const overflow = await page.evaluate(() => {
            const viewport = globalThis.window.innerWidth
            return (
              globalThis.document.documentElement.scrollWidth > viewport ||
              [
                ...globalThis.document.querySelectorAll(
                  '.resource-chip, .resource-popover, .resource-task-row',
                ),
              ].some((element) => {
                const bounds = element.getBoundingClientRect()
                return bounds.left < -1 || bounds.right > viewport + 1
              })
            )
          })
          const result = {
            theme,
            width,
            scene,
            errors,
            overflow,
            violations: axe.violations,
            incomplete: axe.incomplete,
          }
          results.push(result)
          await page.screenshot({
            path: path.join(output, `${theme}-${String(width)}-${scene}.png`),
            animations: 'disabled',
          })
          if (scene === 'traffic') {
            for (const index of [0, 1, 2])
              await page.locator('.resource-task-row button').nth(index).click()
            const actions = await page.evaluate(() => globalThis.window.resourceHarness.actions)
            if (['runNow', 'move', 'keepHere'].some((action) => !actions.includes(action)))
              throw new Error('Task control failed to reach admission port')
          } else {
            if (
              scene !== 'companion' &&
              (await page.locator('.status-line .resource-chip').count()) !== 1
            )
              throw new Error('Chip is missing beside heartbeat')
            await page.keyboard.press('Escape')
            if ((await page.locator('[role="dialog"]').count()) !== 0)
              throw new Error('Escape did not close the popover')
            if (
              !(await page
                .locator('.resource-chip')
                .evaluate((chip) => chip === globalThis.document.activeElement))
            )
              throw new Error('Escape did not restore chip focus')
            for (const index of [0, 1, 2]) {
              await page.locator('.resource-chip').click()
              await page.locator('.resource-popover footer button').nth(index).click()
            }
            const actions = await page.evaluate(() => globalThis.window.resourceHarness.actions)
            if (['resume', 'settings', 'show'].some((action) => !actions.includes(action)))
              throw new Error('Resource control failed to reach host port')
          }
          console.log(
            `${theme} ${String(width)} ${scene}: ${String(errors.length)} errors, ${String(axe.violations.length)} violations, ${String(axe.incomplete.length)} incomplete, overflow=${String(overflow)}`,
          )
        } finally {
          await page.close()
        }
      }
    }
  }
} finally {
  server.close()
  await browser.close()
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
}
if (
  results.some(
    (result) =>
      result.errors.length > 0 ||
      result.overflow ||
      result.violations.length > 0 ||
      result.incomplete.length > 0,
  )
) {
  throw new Error(
    'Resource surface browser acceptance failed; see temp/m107-u/harness/results.json',
  )
}

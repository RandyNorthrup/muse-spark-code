// M107 W-history: the production usage page's Resources section in every
// theme at 320 and 690 px, with history, an unreadable journal and an empty
// one. Run after npm run build: node test/harness/usage-resource-scenes.mjs
// Element shots go to docs/certification/m107-w-history/; results to JSON.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

const root = process.cwd()
const output = path.join(root, 'docs/certification/m107-w-history')
const themes = ['light', 'dark', 'hc-dark', 'hc-light']
const states = ['history', 'unavailable', 'empty']
await mkdir(output, { recursive: true })
await build({
  entryPoints: ['test/harness/usageHost.mjs'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'temp/m102-usage-host.js',
})
const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome is required for the resource scenes')
const browser = await chromium.launch({ executablePath: chrome, headless: true })
const { server, port } = await serveRepo(root)
const axe = await readFile(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8')
const results = []
try {
  for (const theme of themes) {
    for (const width of [320, 690]) {
      for (const state of states) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: 'reduce',
        })
        const title = `${theme}/${String(width)}/${state}`
        try {
          await page.goto(
            `http://127.0.0.1:${String(port)}/test/harness/usage.html?bridge=vscode&scenario=one-provider&theme=${theme}&resources=${state}`,
          )
          const section = page.locator('section.usage-resources')
          await section.waitFor()
          if (state === 'history') await section.getByRole('region').first().waitFor()
          await page.addScriptTag({ content: axe })
          const scan = await page.evaluate(async () => {
            const scanned = await globalThis.axe.run('section.usage-resources', {
              resultTypes: ['violations'],
            })
            const element = globalThis.document.documentElement
            return {
              violations: scanned.violations.map((violation) => violation.id),
              overflow: element.scrollWidth > element.clientWidth,
              errors: globalThis.usageHarness.errors,
              text: globalThis.document.querySelector('section.usage-resources')?.textContent ?? '',
            }
          })
          const shot = `${theme}-${String(width)}-${state}.png`
          await section.screenshot({ path: path.join(output, shot) })
          results.push({
            title,
            shot,
            violations: scan.violations,
            overflow: scan.overflow,
            errors: scan.errors,
            currentMinute: scan.text.includes('This minute so far'),
            earlierDays: scan.text.includes('Earlier days'),
            unavailable: scan.text.includes('Resource history could not be read.'),
            empty: scan.text.includes('No resource history recorded yet.'),
          })
        } catch (error) {
          results.push({ title, error: String(error) })
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
await writeFile(path.join(output, 'scene-results.json'), `${JSON.stringify(results, null, 2)}\n`)
const failures = results.filter(
  (result) =>
    result.error !== undefined ||
    result.violations.length > 0 ||
    result.overflow ||
    result.errors.length > 0,
)
console.log(`${String(results.length)} resource scenes, ${String(failures.length)} failures`)
if (failures.length > 0) {
  console.error(JSON.stringify(failures, null, 2))
  process.exitCode = 1
}

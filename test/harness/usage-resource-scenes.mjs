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
const bodyClasses = new Map()
for (const theme of themes) {
  const capture = JSON.parse(
    await readFile(path.join(root, 'test/harness/themes', `${theme}.json`), 'utf8'),
  )
  bodyClasses.set(theme, capture.bodyClass)
}
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
              // Class-dependent theme styles need the captured body class.
              bodyClass: globalThis.document.body.className,
              violations: scanned.violations.map((violation) => violation.id),
              overflow: element.scrollWidth > element.clientWidth,
              // Visual review F1: nothing in the section is cut off, and no table
              // region needs a sideways scroll at 320 or 690 px.
              clipped: (() => {
                const section = globalThis.document.querySelector('section.usage-resources')
                if (section === null) return ['no section']
                const box = section.getBoundingClientRect()
                const cut = [...section.querySelectorAll('*')]
                  .filter((node) => {
                    const rect = node.getBoundingClientRect()
                    return (
                      rect.width > 0 && (rect.right > box.right + 0.5 || rect.left < box.left - 0.5)
                    )
                  })
                  .map((node) => node.className || node.tagName)
                const scrollers = [...section.querySelectorAll('.usage-resource-table')]
                  .filter((node) => node.scrollWidth > node.clientWidth)
                  .map((node) => node.getAttribute('aria-label'))
                return [...cut, ...scrollers]
              })(),
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
            clipped: scan.clipped,
            bodyClass: scan.bodyClass,
            identityProblems:
              scan.bodyClass === bodyClasses.get(theme)
                ? []
                : [`body class "${scan.bodyClass}", expected "${String(bodyClasses.get(theme))}"`],
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
    result.clipped.length > 0 ||
    result.identityProblems.length > 0 ||
    result.errors.length > 0,
)
console.log(`${String(results.length)} resource scenes, ${String(failures.length)} failures`)
if (failures.length > 0) {
  console.error(JSON.stringify(failures, null, 2))
  process.exitCode = 1
}

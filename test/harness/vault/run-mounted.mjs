// The mounted-vault scenes (C-M109-1 P1): the Models & Agents panel with
// the vault section offered, across themes and widths, with axe on every
// frame and screenshots for the record. Lane U's runner, axe record and
// shots stay untouched; this writes its own.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { buildVaultSurfaces } from './build.mjs'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../../scripts/lib/harnessServer.mjs'

const isDrill = process.argv.includes('--drill')
const workdir = path.join(process.cwd(), 'temp', 'm109-cm1091d', 'surfaces')
const profile = path.join(process.cwd(), 'temp', 'm109-cm1091d', 'chrome-profile')
await mkdir(workdir, { recursive: true })
const meta = await buildVaultSurfaces(workdir, true)
await writeFile(path.join(workdir, 'meta.json'), JSON.stringify(meta))
const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome unavailable')
const server = await serveRepo(process.cwd())
let browser
const require = createRequire(import.meta.url)
const reports = []
// RVCM1091D P3: every scenario in scenarios.ts (kept in sync by
// vaultHarnessScenarios.test.ts), across all six theme files under
// test/harness/themes/.
const scenarios = [
  'mounted',
  'mounted-locked',
  'mounted-connecting',
  'mounted-uncreated',
  'mounted-setup-pending',
  'mounted-unavailable',
  'mounted-unreachable',
  'mounted-busy',
  'mounted-transient-timeout',
  'mounted-watch-lost',
  'mounted-first-party-only',
]
const themes = isDrill
  ? ['light']
  : ['light', 'dark', 'hc-light', 'hc-dark', 'dracula', 'one-dark-pro']
const widths = isDrill ? [320] : [690, 320]
const scenes = isDrill ? ['mounted'] : scenarios
try {
  browser = await chromium.launchPersistentContext(profile, {
    executablePath: chrome,
    viewport: { width: 690, height: 760 },
  })
  const page = await browser.newPage()
  for (const theme of themes) {
    const table = JSON.parse(await readFile(`test/harness/themes/${theme}.json`, 'utf8'))
    for (const width of widths) {
      await page.setViewportSize({ width, height: 760 })
      for (const scenario of scenes) {
        await page.goto(
          `http://127.0.0.1:${server.port}/test/harness/vault/mounted.html?scenario=${scenario}`,
        )
        await page
          .locator(scenario === 'mounted-connecting' ? '.models-panel' : '.vault-section')
          .waitFor()
        // The lazy surface settles before the frame is read.
        await page.locator('.models-nav').waitFor()
        await page.evaluate((variables) => {
          for (const [key, value] of Object.entries(variables))
            globalThis.document.documentElement.style.setProperty(key, value)
        }, table.variables)
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
        const result = await page.evaluate(
          async () =>
            await globalThis.axe.run(globalThis.document, {
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
              },
            }),
        )
        const overflow = await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
        )
        reports.push({
          theme,
          width,
          scenario,
          overflow,
          violations: result.violations.map((violation) => ({
            id: violation.id,
            nodes: violation.nodes.map((node) => node.target),
          })),
        })
        if (isDrill) continue
        await mkdir('docs/certification/m109-cm1091d-shots', { recursive: true })
        await page.screenshot({
          path: `docs/certification/m109-cm1091d-shots/${theme}-${width}-${scenario}.png`,
          fullPage: true,
        })
      }
      console.log(`Mounted vault axe ${theme} ${width}: ${scenes.length} scenes`)
    }
  }
} finally {
  try {
    await browser?.close()
  } finally {
    try {
      await new Promise((resolve, reject) => {
        server.server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  }
}
await writeFile(
  isDrill ? path.join(workdir, 'axe-drill.json') : 'docs/certification/m109-cm1091d-axe.json',
  JSON.stringify(reports, null, 2) + '\n',
)
const failures = reports.filter((report) => report.overflow || report.violations.length > 0)
console.log(`Mounted vault axe: ${reports.length} scans, ${failures.length} failures`)
if (failures.length > 0) {
  console.error(JSON.stringify(failures))
  process.exitCode = 1
}

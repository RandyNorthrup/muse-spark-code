import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { buildVaultSurfaces } from './build.mjs'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../../scripts/lib/harnessServer.mjs'

const isDrill = process.argv.includes('--drill')
const workdir = path.join(process.cwd(), 'temp', 'm109-u', 'surfaces')
const profile = path.join(process.cwd(), 'temp', 'm109-u', 'chrome-profile')
await mkdir(workdir, { recursive: true })
const meta = await buildVaultSurfaces(workdir, true)
await writeFile(path.join(workdir, 'meta.json'), JSON.stringify(meta))
const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome unavailable')
const server = await serveRepo(process.cwd())
let browser
const require = createRequire(import.meta.url)
const reports = []
const scenarios = [
  'panel',
  'empty',
  'locked',
  'grant',
  'ssh',
  'sshSign',
  'sudo',
  'askpass',
  'git',
  'environment',
  'stdin',
  'totp',
  'mcp',
  'header',
  'oauth',
  'fill',
  'session',
  'disclosure',
  'allow-session',
  'platform-notices',
]
const themes = isDrill ? ['light'] : ['light', 'dark', 'hc-light', 'hc-dark']
const widths = isDrill ? [320] : [690, 320]
const scenes = isDrill ? ['panel'] : scenarios
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
          `http://127.0.0.1:${server.port}/test/harness/vault/index.html?scenario=${scenario}`,
        )
        await page
          .locator(
            ['panel', 'empty', 'locked', 'grant', 'platform-notices'].includes(scenario)
              ? '.vault-section'
              : '.vault-card',
          )
          .waitFor()
        await page.evaluate((variables) => {
          for (const [key, value] of Object.entries(variables))
            globalThis.document.documentElement.style.setProperty(key, value)
        }, table.variables)
        if (scenario === 'grant')
          await page.getByRole('button', { name: 'Create grant', exact: true }).click()
        else if (scenario === 'panel')
          await page.locator('details').evaluateAll((details) => {
            for (const element of details) element.open = true
          })
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
        if (isDrill || !['panel', 'grant', 'sudo'].includes(scenario)) continue
        await mkdir('docs/certification/m109-u-shots', { recursive: true })
        await page.screenshot({
          path: `docs/certification/m109-u-shots/${theme}-${width}-${scenario}.png`,
          fullPage: true,
        })
      }
      console.log(`axe ${theme} ${width}: ${scenes.length} scenes`)
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
  isDrill ? path.join(workdir, 'axe-drill.json') : 'docs/certification/m109-u-axe.json',
  JSON.stringify(reports, null, 2) + '\n',
)
const failures = reports.filter((report) => report.overflow || report.violations.length > 0)
console.log(`Vault axe: ${reports.length} scans, ${failures.length} failures`)
if (failures.length > 0) {
  console.error(JSON.stringify(failures))
  process.exitCode = 1
}
const hostStats = await stat(path.join(workdir, 'vault.js'))
console.log(`Host bundle: ${(hostStats.size / 1024).toFixed(1)} KiB`)

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Metafile } from 'esbuild'
import { chromium, type Browser, type LaunchOptions } from 'playwright-core'
import { z } from 'zod/mini'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'
import { parseEstimateGoal } from '../../src/shared/estimate'
import { resolveEstimateGoal } from '../../src/core/estimator/goal'
import { prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { EstimateWaveStarter } from '../../src/core/estimator/provision/start'
import { FakeEstimateStart } from '../unit/helpers/estimator/fakes'
import { chainSnapshot } from '../unit/helpers/estimator/fixtures'
import { scheduleFleet, simulationInputs } from '../unit/helpers/estimatorScheduleFixtures'

const THEMES = ['light', 'dark', 'hc-dark', 'hc-light']
const ORIGIN = 'https://estimator.invalid'
const axeSchema = z.object({
  violations: z.array(z.object({ id: z.string(), nodes: z.array(z.object({ html: z.string() })) })),
})
const themeSchema = z.object({ variables: z.record(z.string(), z.string()) })
const files = new Map<string, Buffer>()
const state: { directory: string; browser?: Browser; metafile?: Metafile } = { directory: '' }

beforeAll(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'm117-u-harness-'))
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../harness/estimator/scene.tsx', import.meta.url))],
    outdir: state.directory,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome128',
    jsx: 'automatic',
    minify: true,
    metafile: true,
    // Match independent production pages: cold navigation must not parse the raw English table.
    plugins: [compactBrowserEnglish],
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  state.metafile = result.metafile
  for (const file of Object.keys(result.metafile.outputs)) {
    // Metafiles use either separator on different host toolchains.
    const name = path.posix.basename(file.replaceAll('\\', '/'))
    files.set(`/${name}`, await readFile(file))
  }
  const chrome = process.env['CHROME_PATH']
  let launch: LaunchOptions = { channel: 'chrome' }
  if (chrome !== undefined) launch = { executablePath: chrome }
  else if (process.platform === 'darwin')
    launch = { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
  state.browser = await chromium.launch(launch)
})
afterAll(async () => {
  await state.browser?.close()
  if (state.directory !== '') await rm(state.directory, { recursive: true, force: true })
})

describe('M117 shared estimator browser harness', () => {
  it('keeps the Estimator panel in its own lazy chunk', () => {
    if (state.metafile === undefined) throw new Error('missing harness metafile')
    const outputs = Object.values(state.metafile.outputs)
    const containing = (suffix: string) =>
      outputs.find((output) =>
        Object.keys(output.inputs).some((name) => name.replaceAll('\\', '/').endsWith(suffix)),
      )
    const scene = containing('/harness/estimator/scene.tsx')
    const panel = containing('/estimator/EstimatorPanel.tsx')
    expect(panel).toBeDefined()
    expect(scene).toBeDefined()
    expect(scene).not.toBe(panel)
    expect(scene?.imports.some((item) => item.kind === 'dynamic-import')).toBe(true)
  })

  for (const theme of THEMES)
    for (const width of [690, 320]) {
      it(`passes axe and keyboard Gantt/setup flows in ${theme} at ${String(width)} px`, async () => {
        if (state.browser === undefined) throw new Error('browser did not start')
        const raw: unknown = JSON.parse(await readFile(`test/harness/themes/${theme}.json`, 'utf8'))
        const variables = themeSchema.parse(raw)
        const colors = Object.entries(variables.variables)
          .map(([key, value]) => `${key}:${value}`)
          .join(';')
        const page = await state.browser.newPage({ viewport: { width, height: 760 } })
        page.setDefaultTimeout(2000)
        const errors: string[] = []
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          if (url.origin !== ORIGIN) {
            await route.abort()
            return
          }
          const file = files.get(url.pathname)
          if (file !== undefined) {
            await route.fulfill({
              body: file,
              contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
            })
            return
          }
          if (url.pathname === '/') {
            await route.fulfill({
              contentType: 'text/html',
              body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Estimator harness</title><style>:root{${colors};--vscode-font-family:sans-serif}body{margin:0}</style><link rel="stylesheet" href="/scene.css"></head><body><div id="root"></div><script type="module" src="/scene.js"></script></body></html>`,
            })
            return
          }
          await route.abort()
        })
        try {
          await page.goto(ORIGIN)
          await page.locator('[data-estimator-ready="true"]').waitFor()
          const lane = page.getByRole('button', { name: /^A · Critical path/ })
          await lane.focus()
          await page.keyboard.press('Enter')
          expect(await lane.getAttribute('aria-expanded')).toBe('true')
          await page.getByRole('radio', { name: /^Current fleet/ }).focus()
          await page.keyboard.press('ArrowDown')
          expect(await page.getByRole('radio', { name: /^Minimum setup · P50/ }).isChecked()).toBe(
            true,
          )
          await page.locator('summary').first().focus()
          await page.keyboard.press('Enter')
          expect(await page.locator('details').first().getAttribute('open')).not.toBeNull()
          const size = await page.evaluate(() => ({
            actual: globalThis.document.documentElement.scrollWidth,
            viewport: globalThis.innerWidth,
          }))
          expect(size.actual).toBeLessThanOrEqual(size.viewport)
          await page.addScriptTag({ path: path.resolve('node_modules/axe-core/axe.min.js') })
          const scan: unknown = await page.evaluate(
            "axe.run(document, {runOnly: {type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})",
          )
          expect(axeSchema.parse(scan).violations).toEqual([])
          await page.evaluate("window.dispatchEvent(new Event('fixture-lane-finished'))")
          await page.getByText(/Drift since the previous estimate/).waitFor()
          expect(await page.getByRole('button', { name: 'Spin it up' }).isDisabled()).toBe(true)
          expect(errors).toEqual([])
        } finally {
          await page.close()
        }
      })
    }
})

/** Fake-only application source: the M113 parser/board bindings are absent.
 * No external process, model, provider or paid resource is used.
 */
function chainInputs() {
  const plan = chainSnapshot()
  const fleet = scheduleFleet(1)
  for (const machine of fleet.machines) machine.capacityByKind.push({ kind: 'contracts', slots: 1 })
  return { plan, fleet }
}

describe('M117 fixture plan to schedule to audited first-wave submission', () => {
  it('resolves the milestone, schedules the chain and submits contracts before later waves', async () => {
    const { plan, fleet } = chainInputs()
    const lanes = await resolveEstimateGoal(parseEstimateGoal('M117'), plan.asOf, {
      snapshot: () => Promise.resolve(plan),
    })
    const forecast = prepareEstimateSchedule(lanes, fleet).run()
    expect(forecast.schedule.map((entry) => entry.laneId)).toEqual(['M117:A', 'M117:B', 'M117:C'])
    expect(forecast.criticalPath).toEqual(['M117:A', 'M117:B', 'M117:C'])
    const board = new FakeEstimateStart()
    const starter = new EstimateWaveStarter(board)
    const input = simulationInputs(lanes, fleet)
    expect(await starter.start(input)).toEqual(['M117:A'])
    expect(board.audits).toEqual([['M117:A']])
    for (const lane of input.lanes) if (lane.id === 'M117:A') lane.state = 'merged'
    expect(await starter.start(input)).toEqual(['M117:B'])
    expect(board.starts).toEqual([['M117:A'], ['M117:B']])
  })

  it('does not submit a fixture lane when the prerequisite audit has no merge receipt', async () => {
    const { plan, fleet } = chainInputs()
    const lanes = await resolveEstimateGoal(parseEstimateGoal('M117'), plan.asOf, {
      snapshot: () => Promise.resolve(plan),
    })
    const board = new FakeEstimateStart(['M113:0'])
    await expect(
      new EstimateWaveStarter(board).start(simulationInputs(lanes, fleet)),
    ).rejects.toThrow('Contracts must be reviewed')
    expect(board.starts).toEqual([])
  })
})

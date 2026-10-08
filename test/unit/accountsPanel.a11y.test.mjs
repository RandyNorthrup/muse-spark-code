// Real Chrome and axe over the shared lazy accounts entry, with test-only ports.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { lazyBrowserKeybindings } from '../../scripts/lib/browserKeybindings.mjs'
import { accountsHarnessEntry } from '../harness/accounts.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const output = path.join(root, 'temp/m108-u-harness')
const themes = ['light', 'dark', 'hc-dark', 'hc-light']
const scenes = ['section', 'thresholds', 'dialog', 'swap']
// INT0180B: universal browser closure measured at 27,338 B after structural
// shrinking; +5%, rounded up to 25 KiB = 50 KiB (PLAN.md D6; rig brief).
const ACCOUNT_UI_BUDGET_KIB = 50
const state = {}

beforeAll(async () => {
  await mkdir(output, { recursive: true })
  const result = await build({
    absWorkingDir: root,
    entryPoints: [accountsHarnessEntry],
    outdir: output,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    jsx: 'automatic',
    minify: true,
    metafile: true,
    plugins: [compactBrowserUiText, lazyBrowserKeybindings],
  })
  state.meta = result.metafile
  await mkdir(path.join(root, 'temp/m108-u-shots'), { recursive: true })
  await writeFile(path.join(root, 'temp/m108-u-shots/meta.json'), JSON.stringify(state.meta))
  const served = await serveRepo(root)
  state.server = served.server
  state.port = served.port
  const chrome = findChrome()
  if (chrome === undefined)
    throw new Error('Chrome is required for the accounts accessibility gate')
  state.browser = await chromium.launch(
    path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
  )
})

afterAll(async () => {
  await state.browser?.close()
  state.server?.close()
  await rm(output, { recursive: true, force: true })
})

describe('M108 accounts accessibility and lazy budget', () => {
  it('loads all account UI in a dedicated chunk within its measured 50 KiB budget', () => {
    const outputs = Object.entries(state.meta.outputs)
    const entry = outputs.find(
      ([, value]) => value.entryPoint?.replaceAll('\\', '/') === 'test/harness/accounts.mjs',
    )
    expect(entry).toBeDefined()
    const eager = new Set()
    const visit = (file) => {
      if (eager.has(file)) return
      eager.add(file)
      const imports = state.meta.outputs[file].imports
      for (const imported of imports) {
        if (imported.kind === 'import-statement') visit(imported.path.replaceAll('\\', '/'))
      }
    }
    visit(entry[0])
    const uiOutputs = outputs.filter(([, value]) =>
      Object.keys(value.inputs).some(
        (file) =>
          file.replaceAll('\\', '/').includes('/sections/accounts/') ||
          file.replaceAll('\\', '/').endsWith('/AccountChip.tsx'),
      ),
    )
    expect(uiOutputs.length).toBeGreaterThan(0)
    const uiScripts = uiOutputs.filter(([file]) => file.endsWith('.js'))
    for (const [file] of uiScripts) expect(eager.has(file)).toBe(false)
    const deferredBytes = outputs
      .filter(([file]) => file.endsWith('.js') && !eager.has(file))
      .reduce((total, [, value]) => total + value.bytes, 0)
    expect(deferredBytes / 1024).toBeLessThanOrEqual(ACCOUNT_UI_BUDGET_KIB)
  })

  for (const theme of themes) {
    for (const width of [320, 690]) {
      for (const scene of scenes) {
        it(`${theme} ${scene} at ${width}px passes axe and fits the panel`, async () => {
          const page = await state.browser.newPage({ viewport: { width, height: 760 } })
          const errors = []
          page.on('pageerror', (error) => {
            errors.push(error.message)
          })
          try {
            await page.goto(
              `http://127.0.0.1:${String(state.port)}/test/harness/accounts.html?theme=${theme}&scene=${scene}`,
            )
            if (scene === 'thresholds')
              await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
            let ready = page.getByRole('region', { name: 'Accounts', exact: true })
            if (scene === 'dialog') ready = page.getByRole('dialog')
            else if (scene === 'swap') ready = page.getByRole('log')
            await ready.waitFor()
            // Measure the entire scroll document at the required panel width.
            // axe cannot determine contrast on a line clipped by the viewport.
            if (scene !== 'dialog') {
              const height = await page.locator('#root').evaluate((element) => element.scrollHeight)
              await page.setViewportSize({ width, height: Math.max(760, height) })
            }
            await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') })
            const result = await page.evaluate(
              async () =>
                await globalThis.axe.run(globalThis.document, {
                  runOnly: {
                    type: 'tag',
                    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
                  },
                }),
            )
            expect(errors).toEqual([])
            expect(
              result.violations.map(({ id, nodes }) => ({
                id,
                targets: nodes.map((node) => node.target),
              })),
            ).toEqual([])
            // No axe exclusions: incomplete findings are retained for diagnosis.
            expect(
              result.incomplete.map((finding) => ({
                id: finding.id,
                nodes: finding.nodes.map((node) => ({
                  target: node.target,
                  summary: node.failureSummary,
                })),
              })),
            ).toEqual([])
            expect(
              await page.evaluate(
                () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
              ),
            ).toBe(true)
            if (theme === 'dark' && width === 320) {
              await mkdir(path.join(root, 'temp/m108-u-shots'), { recursive: true })
              await page.screenshot({
                path: path.join(root, `temp/m108-u-shots/${scene}.png`),
                fullPage: true,
              })
            }
          } finally {
            await page.close()
          }
        })
      }
    }
  }

  it('renders the installed German account labels in the same lazy surface', async () => {
    const page = await state.browser.newPage()
    try {
      const table = JSON.parse(await readFile(path.join(root, 'l10n/ui.de.json'), 'utf8'))
      await page.goto(
        `http://127.0.0.1:${String(state.port)}/test/harness/accounts.html?theme=dark&lang=de`,
      )
      await page.getByRole('button', { name: table.accounts.add }).waitFor()
      expect(await page.locator('h2').textContent()).toContain(table.accounts.title)
    } finally {
      await page.close()
    }
  })
})

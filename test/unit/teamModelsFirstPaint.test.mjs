// Real production-plugin entry: ordinary Models first paint stays independent
// of team English; validated enabled-team navigation waits for that loader.
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { teamPanelBrowserValidation } from '../../scripts/lib/webviewBundles.mjs'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { BROWSER_ENGLISH, L10N_BUILDS_KEY } from './helpers/l10nBuilds.mjs'
import { makeState } from './modelsPanelFixtures'
import { panelRig } from './helpers/teamPanelRig'
import { EN } from '../../src/shared/l10n/en'

const runtime = { files: [], browser: undefined, server: undefined, url: '', state: undefined }
beforeAll(async () => {
  const result = await build({
    entryPoints: [path.resolve('src/webview/models/models.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome128',
    splitting: true,
    outdir: 'out',
    write: false,
    metafile: true,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [compactBrowserUiText, teamPanelBrowserValidation],
  })
  runtime.files = result.outputFiles ?? []
  const rig = panelRig()
  await rig.read()
  await rig.controller.handle({ type: 'roles/template', template: 'pair' })
  runtime.state = makeState({ roles: await rig.read(), agents: {} })
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome unavailable')
  runtime.browser = await chromium.launch(
    path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
  )
  runtime.server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html')
      res.end('<div id="root"></div><script type="module" src="/models.js"></script>')
      return
    }
    const file = runtime.files.find((item) => `/${path.basename(item.path)}` === req.url)
    if (file === undefined) {
      res.writeHead(404).end()
      return
    }
    res.setHeader('content-type', 'text/javascript')
    res.end(file.contents)
  })
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve))
  const address = runtime.server.address()
  if (address === null || typeof address === 'string') throw new Error('No server address')
  runtime.url = `http://127.0.0.1:${String(address.port)}`
})
afterAll(async () => {
  await runtime.browser?.close()
  await new Promise((resolve) => runtime.server?.close(resolve))
})

async function openPanel(table) {
  const page = await runtime.browser.newPage()
  page.setDefaultTimeout(2000)
  await page.addInitScript(
    ({ state, table }) => {
      const panelMessages = []
      Object.assign(globalThis, { panelMessages })
      let savedState
      Object.assign(globalThis, {
        acquireVsCodeApi: () => ({
          postMessage: (message) => {
            panelMessages.push(message)
            if (message.type === 'modelsPanel/ready')
              globalThis.setTimeout(
                () =>
                  globalThis.dispatchEvent(
                    new globalThis.MessageEvent('message', {
                      data: { type: 'modelsPanel/state', state },
                    }),
                  ),
                0,
              )
          },
          getState: () => savedState,
          setState: (next) => {
            savedState = next
          },
        }),
      })
      if (table === undefined) return
      const element = globalThis.document.createElement('script')
      element.type = 'application/json'
      element.id = 'muse-l10n'
      element.textContent = JSON.stringify(table)
      const observer = new globalThis.MutationObserver(() => {
        if (globalThis.document.head === null) return
        globalThis.document.head.append(element)
        observer.disconnect()
      })
      observer.observe(globalThis.document, { childList: true, subtree: true })
    },
    { state: runtime.state, table },
  )
  return page
}

describe('M96 models first paint', () => {
  it('paints without the hidden team English while team readers keep it', () => {
    const bootstrap = runtime.files.find((file) => path.basename(file.path) === 'models.js')
    if (bootstrap === undefined) throw new Error('Missing models bootstrap')
    expect(bootstrap.text).not.toContain('browser-team-english')
    expect(bootstrap.text).toContain('browser-surface-english')
    expect(bootstrap.text).toContain('browser-account-english')
    const teamReaders = runtime.files.filter(
      (file) =>
        file.text.includes('browser-team-english') && path.basename(file.path) !== 'models.js',
    )
    expect(teamReaders.length).toBeGreaterThan(0)
  })
  it.each(['absent', 'invalid', 'german'])(
    'loads enabled-team navigation and sections with an %s embedded table',
    async (kind) => {
      const table =
        kind === 'absent'
          ? undefined
          : {
              locale: 'de',
              table: kind === 'invalid' ? {} : JSON.parse(readFileSync('l10n/ui.de.json', 'utf8')),
            }
      const page = await openPanel(table)
      const errors = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
      })
      try {
        await page.goto(runtime.url)
        const labels = kind === 'german' ? table.table : EN
        await page.getByRole('button', { name: labels.teamEditor.agents, exact: true }).waitFor()
        await page.getByRole('button', { name: labels.teamRolesTitle, exact: true }).click()
        await page.getByRole('button', { name: labels.teamEditor.save, exact: true }).waitFor()
        await page.getByRole('button', { name: labels.teamEditor.agents, exact: true }).click()
        await page.getByText(labels.teamEditor.empty, { exact: true }).waitFor()
        expect(await page.getByText(labels.modelsPanelUnavailable, { exact: true }).count()).toBe(0)
        expect(errors).toEqual([])
      } finally {
        await page.close()
      }
    },
  )
  it('reports an enabled-team English load failure with Retry before navigation', async () => {
    const page = await openPanel()
    await page.route('**/*', async (route) => {
      const file = runtime.files.find((item) =>
        route
          .request()
          .url()
          .endsWith(`/${path.basename(item.path)}`),
      )
      if (file?.text.includes('browser-team-english:browser-team-english')) await route.abort()
      else await route.continue()
    })
    try {
      await page.goto(runtime.url)
      await page.getByRole('button', { name: EN.surfaceLoadRetry, exact: true }).waitFor()
      expect(await page.getByRole('alert').textContent()).toContain(EN.surfaceLoadFailed)
      expect(
        await page.getByRole('button', { name: EN.teamEditor.agents, exact: true }).count(),
      ).toBe(0)
    } finally {
      await page.close()
    }
  })
  it.each(['models-filter-max-input', 'models-filter-max-output', 'models-filter-max-cached'])(
    'submits Save Team in Chrome with a fractional %s filter',
    async (id) => {
      const page = await openPanel()
      try {
        await page.goto(runtime.url)
        await page.getByRole('button', { name: EN.teamRolesTitle, exact: true }).click()
        await page.locator(`#${id}`).fill('0.5')
        expect(await page.locator('form').evaluate((form) => form.checkValidity())).toBe(true)
        await page.getByRole('button', { name: EN.teamEditor.save, exact: true }).click()
        expect(await page.evaluate(() => globalThis.panelMessages)).toContainEqual({
          type: 'roles/save',
        })
      } finally {
        await page.close()
      }
    },
  )
  it('keeps U1-only English in the team chunk under the surface budget', async () => {
    const folder = path.join(inject(L10N_BUILDS_KEY), BROWSER_ENGLISH)
    const meta = JSON.parse(readFileSync(path.join(folder, 'meta.json'), 'utf8'))
    const surface = Object.entries(meta.outputs).find(([, output]) =>
      Object.hasOwn(output.inputs, 'browser-surface-english:browser-surface-english'),
    )
    expect(surface).toBeDefined()
    expect(surface[1].bytes).toBeLessThanOrEqual(25 * 1024)
    const probe = await import(pathToFileURL(path.join(folder, 'probe.mjs')).href)
    await import(pathToFileURL(path.resolve(surface[0])).href)
    for (const key of [
      'teamSetupSteps',
      'teamToolChecklist',
      'teamAddEntry',
      'teamDefaultResolves',
      'teamResetToDefault',
    ])
      expect(() => probe.UI_TEXT[key]).toThrow(`English surface is not loaded: ${key}`)
    await probe.loadDeferredEnglish()
    for (const key of [
      'teamSetupSteps',
      'teamToolChecklist',
      'teamAddEntry',
      'teamDefaultResolves',
      'teamResetToDefault',
    ])
      expect(probe.UI_TEXT[key]).toEqual(EN[key])
  })
})

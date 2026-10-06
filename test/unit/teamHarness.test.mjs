// Real production chunks in Chrome: team loading, nonce CSP, target sizes
// in every theme, and the document width of the 320 px harness (RVM96B).
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo, TRAFFIC_SCENARIOS } from '../../scripts/lib/harnessServer.mjs'
import { testSettings } from './helpers/fakes'
import { buildWebviewHtml } from '../../src/host/html'
import { EN } from '../../src/shared/l10n/en'

const rig = { browser: undefined, server: undefined, origin: '' }
beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
  execFileSync(process.execPath, ['scripts/pseudo-l10n.mjs'], { stdio: 'pipe' })
  const serving = await serveRepo(process.cwd())
  rig.server = serving.server
  rig.origin = `http://127.0.0.1:${String(serving.port)}`
  rig.browser = await chromium.launch({ executablePath: findChrome(), headless: true })
})
afterAll(async () => {
  await rig.browser?.close()
  if (rig.server !== undefined) await new Promise((resolve) => rig.server.close(resolve))
})

async function harness(scenario, theme, lang, run) {
  const page = await rig.browser.newPage({
    viewport: { width: scenario === 'team-tree-320' ? 320 : 690, height: 760 },
  })
  try {
    await page.goto(
      `${rig.origin}/test/harness/index.html?scenario=${scenario}&theme=${theme}${lang === undefined ? '' : `&lang=${lang}`}`,
    )
    await page.locator(scenario === 'team-cards' ? '.activity-team-merge' : '.team-tree').waitFor()
    await run(page)
  } finally {
    await page.close()
  }
}

describe('RVM96B browser regressions', () => {
  it.each(
    ['light', 'dark', 'hc-dark', 'hc-light'].flatMap((theme) =>
      ['team-tree', 'team-tree-320', 'team-cards'].map((scenario) => [theme, scenario]),
    ),
  )('19 team buttons meet target size in %s / %s', async (theme, scenario) => {
    await harness(scenario, theme, undefined, async (page) => {
      const sizes = await page
        .locator('.team-node-actions button, .team-card-actions button')
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const box = button.getBoundingClientRect()
            return { label: button.textContent, width: box.width, height: box.height }
          }),
        )
      expect(sizes.length).toBeGreaterThan(0)
      for (const size of sizes) {
        expect(size.width, size.label).toBeGreaterThanOrEqual(24)
        expect(size.height, size.label).toBeGreaterThanOrEqual(24)
      }
    })
  })

  it.each(TRAFFIC_SCENARIOS)(
    'keeps the Traffic harness separate from the ordinary App: %s',
    async (scenario) => {
      const page = await rig.browser.newPage({
        viewport: { width: scenario === 'team-traffic-320' ? 320 : 690, height: 760 },
      })
      const loaded = []
      page.on('request', (request) => {
        loaded.push(new URL(request.url()).pathname)
      })
      try {
        await page.goto(`${rig.origin}/test/harness/index.html?scenario=${scenario}&theme=light`)
        expect(loaded).not.toContain('/dist/webview/main.js')
        await page.waitForFunction(
          (name) => globalThis.document.body.dataset.trafficReady === name,
          scenario,
        )
        expect(await page.locator('.traffic-view').count()).toBe(1)
        expect(await page.locator('.composer').count()).toBe(0)
      } finally {
        await page.close()
      }
    },
  )

  it('20 keeps viewport and document at 320 px with the complete team shell', async () => {
    await harness('team-tree-320', 'light', undefined, async (page) => {
      const size = await page.evaluate(() => ({
        viewport: globalThis.innerWidth,
        document: globalThis.document.documentElement.scrollWidth,
      }))
      expect(size).toEqual({ viewport: 320, document: 320 })
    })
  })

  it('19 preserves targets on waiting and merge cards at 320 px in the pseudo-locale', async () => {
    await harness('team-cards', 'light', 'pseudo', async (page) => {
      await page.setViewportSize({ width: 320, height: 760 })
      await page.addStyleTag({ content: 'html, body { width: 320px; }' })
      const sizes = await page.locator('.team-card-actions button').evaluateAll((buttons) =>
        buttons.map((button) => ({
          width: button.getBoundingClientRect().width,
          height: button.getBoundingClientRect().height,
        })),
      )
      expect(sizes.length).toBeGreaterThan(0)
      for (const size of sizes) {
        expect(size.width).toBeGreaterThanOrEqual(24)
        expect(size.height).toBeGreaterThanOrEqual(24)
      }
    })
  })

  it('23 packages every emitted webview JavaScript chunk', () => {
    const files = execFileSync(
      process.execPath,
      ['node_modules/@vscode/vsce/vsce', 'ls', '--no-dependencies'],
      { encoding: 'utf8' },
    ).split('\n')
    const meta = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8'))
    for (const output of Object.keys(meta.outputs)) {
      if (output.endsWith('.js')) expect(files).toContain(output)
    }
  })

  it('23 counts lazy bytes in the deferred size gate and restores its chunk byte-exact', () => {
    const meta = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8'))
    const [chunk] =
      Object.entries(meta.outputs).find(
        ([, output]) => output.entryPoint === 'src/webview/components/TeamUi.tsx',
      ) ?? []
    expect(chunk).toBeDefined()
    const original = readFileSync(chunk)
    const sha = createHash('sha256').update(original).digest('hex')
    try {
      writeFileSync(chunk, Buffer.concat([original, Buffer.alloc(900 * 1024, ' ')]))
      const red = spawnSync(process.execPath, ['scripts/check-bundle-size.mjs'], {
        encoding: 'utf8',
      })
      expect(red.status).toBe(1)
      expect(red.stdout).toContain('OVER dist/webview team UI')
    } finally {
      writeFileSync(chunk, original)
    }
    expect(createHash('sha256').update(readFileSync(chunk)).digest('hex')).toBe(sha)
    const green = spawnSync(process.execPath, ['scripts/check-bundle-size.mjs'], {
      encoding: 'utf8',
    })
    expect(green.status, green.stderr).toBe(0)
  })

  it('23 loads neither team UI module for a single-model page, then imports tree and cards under the unchanged nonce CSP', async () => {
    const meta = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8'))
    const initial = new Set()
    const visit = (file) => {
      if (initial.has(file)) return
      initial.add(file)
      const imports = meta.outputs[file].imports
      for (const edge of imports) {
        if (!edge.external && edge.kind === 'import-statement') visit(edge.path)
      }
    }
    visit('dist/webview/main.js')
    const teamOutputs = Object.entries(meta.outputs)
      .filter(([, output]) =>
        ['src/webview/components/TeamTree.tsx', 'src/webview/components/TeamCards.tsx'].some(
          (source) => (output.inputs[source]?.bytesInOutput ?? 0) > 0,
        ),
      )
      .map(([file]) => file)
    expect(teamOutputs.length).toBeGreaterThan(0)
    for (const file of teamOutputs) expect(initial.has(file), file).toBe(false)
    const page = await rig.browser.newPage()
    const loaded = []
    const errors = []
    page.on('request', (request) => {
      loaded.push(request.url())
    })
    page.on('pageerror', (error) => {
      errors.push(error.message)
    })
    try {
      await page.addInitScript(() => {
        Object.defineProperty(globalThis, 'acquireVsCodeApi', {
          value: () => ({ postMessage: () => null, getState: () => null, setState: () => null }),
        })
      })
      const html = buildWebviewHtml({
        scriptUri: `${rig.origin}/dist/webview/main.js`,
        styleUri: `${rig.origin}/dist/webview/main.css`,
        cspSource: rig.origin,
        nonce: 'TEAM_NONCE',
        l10n: { locale: 'en', table: EN },
      })
      await page.route(`${rig.origin}/nonce.html`, (route) =>
        route.fulfill({ contentType: 'text/html', body: html }),
      )
      await page.goto(`${rig.origin}/nonce.html`)
      await page.waitForFunction(
        () => globalThis.document.querySelector('#root')?.childElementCount > 0,
      )
      await page.evaluate((settings) => {
        globalThis.dispatchEvent(
          new globalThis.MessageEvent('message', {
            data: { type: 'init', settings, emptyStateHint: '', composerPlaceholder: '' },
          }),
        )
        globalThis.dispatchEvent(
          new globalThis.MessageEvent('message', {
            data: { type: 'authState', status: 'signedIn', backend: 'modelApi' },
          }),
        )
      }, testSettings)
      await page.getByRole('textbox').waitFor()
      for (const file of teamOutputs) expect(loaded).not.toContain(`${rig.origin}/${file}`)
      await page.evaluate(() => {
        globalThis.dispatchEvent(
          new globalThis.MessageEvent('message', {
            data: {
              type: 'teamTree',
              tree: {
                orchestrator: { model: 'muse', backend: 'modelApi', slot: 'default' },
                roles: [],
              },
            },
          }),
        )
        globalThis.dispatchEvent(
          new globalThis.MessageEvent('message', {
            data: {
              type: 'agentEvent',
              event: {
                type: 'itemStarted',
                item: {
                  itemId: 'plan',
                  kind: 'teamPlan',
                  status: 'completed',
                  teamPlan: { dryRun: true, items: [] },
                },
              },
            },
          }),
        )
      })
      await page.getByText('Delegation plan', { exact: true }).waitFor()
      // No task pill for an empty roster; open the map through its command.
      await page.getByRole('button', { name: 'Commands' }).click()
      await page.locator('.palette-filter').fill('/agents')
      await page.locator('.palette-filter').press('Enter')
      await page.getByRole('tree', { name: 'Team' }).waitFor()
      for (const file of teamOutputs) expect(loaded).toContain(`${rig.origin}/${file}`)
      expect(errors).toEqual([])
      // An untrusted inline script still cannot execute.
      const blocked = await page.evaluate(() => {
        const script = globalThis.document.createElement('script')
        script.textContent = 'globalThis.document.documentElement.dataset.untrusted = "ran"'
        globalThis.document.body.append(script)
        return globalThis.document.documentElement.dataset.untrusted
      })
      expect(blocked).toBeUndefined()
    } finally {
      await page.close()
    }
  })
})

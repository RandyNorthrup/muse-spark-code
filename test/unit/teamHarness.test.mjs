// Real production chunks in Chrome: team loading, nonce CSP, target sizes
// in every theme, and the document width of the 320 px harness (RVM96B).
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo, TRAFFIC_SCENARIOS } from '../../scripts/lib/harnessServer.mjs'
import { testSettings } from './helpers/fakes'
import { buildWebviewHtml } from '../../src/host/html'
import { EN } from '../../src/shared/l10n/en'

// Preparation builds production chunks and inventories the complete real VSIX.
const REAL_HARNESS_PREPARE_TIMEOUT_MS = 60_000
// Each case opens a fresh page and loads the full production webview bundle;
// a loaded hosted Windows shard with coverage needs longer than the unit
// default. PLAN.md §8 (2026-10-07).
const REAL_HARNESS_CASE_TIMEOUT_MS = 20_000
// Navigation plus readiness must fail with evidence before the case deadline.
const REAL_HARNESS_WAIT_TIMEOUT_MS = 8000
const HARNESS_DIAGNOSTIC_LIMIT = 8192
const HARNESS_BODY_DIAGNOSTIC_LIMIT = 4096
const HARNESS_ERROR_DIAGNOSTIC_LIMIT = 1024
const rig = {
  browser: undefined,
  server: undefined,
  origin: '',
  packagedFiles: [],
  inventory: undefined,
}
beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
  execFileSync(process.execPath, ['scripts/pseudo-l10n.mjs'], { stdio: 'pipe' })
  mkdirSync('temp', { recursive: true })
  rig.inventory = mkdtempSync(path.resolve('temp/team-inventory-'))
  // VSCE traverses before filtering. Keep its unchanged policy over real
  // publication roots, without walking other workers' changing fixture trees.
  const roots = new Set(
    readFileSync('.vscodeignore', 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('!'))
      .map((line) => line.slice(1).split('/', 1)[0]),
  )
  for (const entry of readdirSync('.')) {
    if (
      [...roots].some(
        (root) => entry === root || (root.includes('*') && entry.startsWith(root.split('*', 1)[0])),
      )
    )
      cpSync(entry, path.join(rig.inventory, entry), { recursive: true })
  }
  cpSync('.vscodeignore', path.join(rig.inventory, '.vscodeignore'))
  rig.packagedFiles = execFileSync(
    process.execPath,
    [path.resolve('node_modules/@vscode/vsce/vsce'), 'ls', '--no-dependencies'],
    { cwd: rig.inventory, encoding: 'utf8' },
  ).split('\n')
  const serving = await serveRepo(process.cwd())
  rig.server = serving.server
  rig.origin = `http://127.0.0.1:${String(serving.port)}`
  const executablePath = existsSync(chromium.executablePath())
    ? chromium.executablePath()
    : findChrome()
  rig.browser = await chromium.launch({
    executablePath,
    headless: true,
  })
  // Warm the browser, server and bundle once, inside the setup deadline, so the
  // first case's bounded wait measures the scene and not a cold start.
  const warm = await rig.browser.newPage()
  try {
    await warm.goto(`${rig.origin}/test/harness/index.html?scenario=team-tree&theme=light`)
    await warm.locator('.team-tree').waitFor({ timeout: REAL_HARNESS_PREPARE_TIMEOUT_MS })
  } finally {
    await warm.close()
  }
}, REAL_HARNESS_PREPARE_TIMEOUT_MS)
afterAll(async () => {
  await rig.browser?.close()
  if (rig.server !== undefined) await new Promise((resolve) => rig.server.close(resolve))
  if (rig.inventory !== undefined) rmSync(rig.inventory, { recursive: true, force: true })
})

async function harness(scenario, theme, lang, run, prepare) {
  const page = await rig.browser.newPage({
    viewport: { width: scenario === 'team-tree-320' ? 320 : 690, height: 760 },
  })
  let diagnostics = ''
  const record = (message) => {
    diagnostics = `${diagnostics}\n${message.slice(0, HARNESS_DIAGNOSTIC_LIMIT)}`.slice(
      -HARNESS_DIAGNOSTIC_LIMIT,
    )
  }
  page.on('console', (message) => record(`console ${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => record(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) =>
    record(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`),
  )
  page.on('response', (response) => {
    if (response.status() >= 400) record(`HTTP ${response.status()}: ${response.url()}`)
  })
  try {
    if (prepare !== undefined) await prepare(page)
    await page.goto(
      `${rig.origin}/test/harness/index.html?scenario=${scenario}&theme=${theme}${lang === undefined ? '' : `&lang=${lang}`}`,
      { timeout: REAL_HARNESS_WAIT_TIMEOUT_MS },
    )
    await page
      .locator(scenario === 'team-cards' ? '.activity-team-merge' : '.team-tree')
      .waitFor({ timeout: REAL_HARNESS_WAIT_TIMEOUT_MS })
    await run(page)
  } catch (error) {
    let body
    try {
      body = (await page.locator('#root').textContent({ timeout: 1000 })) ?? ''
    } catch (error_) {
      body = `root unavailable: ${error_.message}`
    }
    record(`root: ${body.slice(0, HARNESS_BODY_DIAGNOSTIC_LIMIT)}`)
    throw new Error(
      `Harness ${scenario}/${theme}/${lang ?? 'en'} failed: ${String(error).slice(0, HARNESS_ERROR_DIAGNOSTIC_LIMIT)}${diagnostics}`,
      { cause: error },
    )
  } finally {
    await page.close()
  }
}

describe('RVM96B browser regressions', { timeout: REAL_HARNESS_CASE_TIMEOUT_MS }, () => {
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

  it('waits for the webview bundle before starting the team scenario DOM deadline', async () => {
    const errors = []
    await harness(
      'team-tree-320',
      'light',
      undefined,
      async (page) => {
        expect(errors).toEqual([])
        expect(await page.locator('.team-tree').count()).toBe(1)
      },
      async (page) => {
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        await page.clock.install()
        await page.route('**/dist/webview/main.js', async (route) => {
          // Hold the real bundle until parsing finishes, then advance beyond
          // the unchanged 3 s DOM deadline without spending real test time.
          await page.waitForFunction(
            () => globalThis.document.readyState !== 'loading',
            undefined,
            { timeout: REAL_HARNESS_WAIT_TIMEOUT_MS },
          )
          try {
            await page.clock.runFor(4000)
          } catch (error) {
            errors.push(error.message)
          }
          await route.continue()
        })
      },
    )
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
    const files = rig.packagedFiles
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
    const fixture = mkdtempSync(path.join(tmpdir(), 'team-budget-'))
    cpSync('dist', path.join(fixture, 'dist'), { recursive: true })
    cpSync('docs/schemas', path.join(fixture, 'docs/schemas'), { recursive: true })
    mkdirSync(path.join(fixture, 'scripts'), { recursive: true })
    cpSync('scripts/check-bundle-size.mjs', path.join(fixture, 'scripts/check-bundle-size.mjs'))
    cpSync('scripts/lib', path.join(fixture, 'scripts/lib'), { recursive: true })
    const target = path.join(fixture, chunk)
    const original = readFileSync(target)
    const sha = createHash('sha256').update(original).digest('hex')
    try {
      writeFileSync(target, Buffer.concat([original, Buffer.alloc(900 * 1024, ' ')]))
      const red = spawnSync(process.execPath, ['scripts/check-bundle-size.mjs'], {
        encoding: 'utf8',
        cwd: fixture,
      })
      expect(red.status).toBe(1)
      expect(red.stdout).toContain('OVER dist/webview team UI')
    } finally {
      writeFileSync(target, original)
    }
    expect(createHash('sha256').update(readFileSync(target)).digest('hex')).toBe(sha)
    const green = spawnSync(process.execPath, ['scripts/check-bundle-size.mjs'], {
      encoding: 'utf8',
      cwd: fixture,
    })
    rmSync(fixture, { recursive: true, force: true })
    expect(green.status, `${green.stderr}\n${green.stdout}`).toBe(0)
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

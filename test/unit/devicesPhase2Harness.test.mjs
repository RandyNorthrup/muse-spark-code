// Public synthetic facts only; production QR code rendered in the real harness.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { parseDeviceHostMessage } from '../../src/shared/devicesPanel'

const SCENES = [
  'devices-qr',
  'devices-discovery',
  'devices-owners',
  'devices-prompts-narrow',
  'devices-power',
  'devices-blocked',
]
const html = readFileSync('test/harness/index.html', 'utf8')
const fixtures = html.slice(
  html.indexOf('const deviceId ='),
  html.indexOf('// M25: the conversation'),
)
const sceneSteps = html.slice(
  html.indexOf('const deviceScenes ='),
  html.indexOf(
    "for (const name of [\n        'questions-waiting'",
    html.indexOf('const deviceScenes ='),
  ),
)

it.each(SCENES)(
  '%s initial state omits action facts; reply is correlated and valid',
  (scenarioName) => {
    const sent = []
    runInNewContext(
      `${fixtures}
send(deviceFixture(scenarioName));
deviceReply({ viewId: '1'.repeat(32), requestId: '2'.repeat(32), action: { kind: 'pauseOffers' } });`,
      {
        scenarioName,
        send: (message) => {
          sent.push(message)
        },
      },
    )
    expect(sent[0].setup).toBeUndefined()
    expect(parseDeviceHostMessage(sent[0]).ok).toBe(true)
    expect(parseDeviceHostMessage(sent[1]).ok).toBe(true)
    expect(sent[1].setup.viewId).toBe('1'.repeat(32))
    expect(sent[1].setup.requestId).toBe('2'.repeat(32))
  },
)

it.each(['devices-owners', 'devices-prompts-narrow'])(
  '%s starts with a peer-bound action',
  (name) => {
    const clicked = []
    const steps = {}
    runInNewContext(`${fixtures}\n${sceneSteps}\nsteps[name]();`, {
      name,
      steps,
      scenarioName: name,
      send: vi.fn(),
      whenFound: (selector, run) => {
        if (selector === '.device-card') run()
      },
      document: {
        querySelector: (selector) => ({
          click: () => {
            clicked.push(selector)
          },
        }),
      },
    })
    expect(clicked).toEqual(['.device-actions button:first-child'])
  },
)

const rig = { browser: undefined, server: undefined, origin: '', qrScript: '' }
// Production build and browser startup are shared once; neither is a test operation.
const HARNESS_PREPARE_TIMEOUT_MS = 60_000
const READY_TIMEOUT_MS = 2000
beforeAll(async () => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
  const serving = await serveRepo(process.cwd())
  rig.server = serving.server
  rig.origin = `http://127.0.0.1:${serving.port}`
  rig.browser = await chromium.launch({ executablePath: findChrome(), headless: true })
  const qr = await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import QrFigure from './src/webview/models/sections/devices/qr/QrFigure';
      const holder = document.createElement('div');
      holder.style.width = '100%'; document.querySelector('.device-public-text').append(holder);
      createRoot(holder).render(React.createElement(QrFigure, { text: 'public', encode: () => ({
        size: 177, modules: Array.from({ length: 177 }, () => Array.from({ length: 177 }, () => true))
      }) }));`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  rig.qrScript = qr.outputFiles[0].text
}, HARNESS_PREPARE_TIMEOUT_MS)
afterAll(async () => {
  await rig.browser?.close()
  if (rig.server !== undefined) await new Promise((resolve) => rig.server.close(resolve))
})

describe('RVM100P2U real Chrome harness readiness', () => {
  it.each(SCENES)('%s becomes ready at 320 px', async (scenario) => {
    const page = await rig.browser.newPage({ viewport: { width: 320, height: 760 } })
    try {
      await page.goto(`${rig.origin}/test/harness/index.html?scenario=${scenario}&theme=dark`)
      await page.locator('[data-devices-ready]').waitFor({ timeout: READY_TIMEOUT_MS })
      expect(await page.locator('.device-card').count()).toBe(1)
      expect(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
    } finally {
      await page.close()
    }
  })

  it('fits a 177-module QR in a real 320 px panel and preserves its square quiet zone', async () => {
    const page = await rig.browser.newPage({ viewport: { width: 320, height: 760 } })
    try {
      await page.goto(`${rig.origin}/test/harness/index.html?scenario=devices-qr&theme=hc-dark`)
      await page.locator('[data-devices-ready]').waitFor({ timeout: READY_TIMEOUT_MS })
      await page.addScriptTag({ content: rig.qrScript })
      const svg = page.locator('svg[role="img"]')
      await svg.waitFor({ timeout: READY_TIMEOUT_MS })
      const box = await svg.boundingBox()
      const container = await page.locator('.device-public-text').boundingBox()
      expect(box.width).toBeLessThanOrEqual(container.width)
      expect(box.width).toBeLessThanOrEqual(320)
      expect(box.height).toBeCloseTo(box.width, 0)
      expect(await svg.getAttribute('viewBox')).toBe('0 0 185 185')
      expect(
        await page.evaluate(() => globalThis.document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(320)
    } finally {
      await page.close()
    }
  })
})

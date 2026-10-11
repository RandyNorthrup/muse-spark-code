// Public synthetic facts only; production QR code rendered in the real harness.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { assertCurrentProductionBuild } from './productionBuild'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { parseDeviceHostMessage } from '../../src/shared/devicesPanel'
import { EN } from '../../src/shared/l10n/en'

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

it('owners reply has no alert before revoke and a revoke-specific refusal afterwards', () => {
  const sent = []
  runInNewContext(
    `${fixtures}
    deviceReply({ viewId: '1'.repeat(32), requestId: '2'.repeat(32), action: { kind: 'pauseOffers' } });
    deviceReply({ viewId: '1'.repeat(32), requestId: '3'.repeat(32), action: { kind: 'revokeGrant', ownerId: 'a'.repeat(32) } });`,
    {
      scenarioName: 'devices-owners',
      send: (message) => {
        sent.push(message)
      },
    },
  )
  expect(sent[0].setup.owners).toHaveLength(1)
  expect(sent[0].setup.grantRefusal).toBeUndefined()
  expect(sent[1].setup.grantRefusal.reason).toBe('grant-revoked')
  expect(parseDeviceHostMessage(sent[1]).ok).toBe(true)
})

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
// Server and browser startup are shared once; neither is a test operation.
const HARNESS_PREPARE_TIMEOUT_MS = 60_000
const READY_TIMEOUT_MS = 2000
beforeAll(async () => {
  // The run's one production build (test/unit/productionBuild.ts) is already in dist/.
  assertCurrentProductionBuild(inject('deviceProductionBuild'), process.cwd())
  const serving = await serveRepo(process.cwd())
  rig.server = serving.server
  rig.origin = `http://127.0.0.1:${serving.port}`
  rig.browser = await chromium.launch({ executablePath: findChrome(), headless: true })
  const qr = await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import QrFigure from './src/webview/models/sections/devices/qr/QrFigure';
      const holder = document.createElement('div'); holder.dataset.qrProbe = 'true';
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
      expect(await page.evaluate(() => globalThis.harnessOutbox[0])).toEqual({
        type: 'devicesReady',
      })
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
      // The production encoder already draws the invitation's own QR; measure the probe's.
      const svg = page.locator('[data-qr-probe] svg[role="img"]')
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

// RVM100W 7 and 11, RVM100W2 3 and 4: the production main entry in real
// Chrome, on a bare Devices document whose host stub answers nothing by
// itself and keeps its webview state across a reload, as VS Code does. The
// QR chunks (the approved encoder, the figure) are held or refused at the
// network.
const DEVICES_PAGE = `<!doctype html><html><head><meta charset="utf-8"><script>
window.devicesOutbox = []
window.acquireVsCodeApi = () => ({
  postMessage: (message) => { window.devicesOutbox.push(message) },
  getState: () => JSON.parse(sessionStorage.getItem('w2-webview-state') ?? 'null') ?? undefined,
  setState: (state) => { sessionStorage.setItem('w2-webview-state', JSON.stringify(state)) },
})
</script></head><body data-surface="devices"><div id="root"></div>
<script type="module" src="/dist/webview/main.js"></script></body></html>`
// Strings only each QR module carries, so its chunk is found by content.
const QR_MARKERS = { encoder: 'qr-matrix-invalid', figure: 'qrCodeName' }
const harnessInvitation = () => {
  const found = {}
  runInNewContext(`${fixtures}\nfound.invitation = deviceInvitation`, {
    found,
    scenarioName: 'devices-qr',
    // The fixtures only define values here; nothing is sent.
    send: vi.fn(),
  })
  return found.invitation
}

async function answerReady(page) {
  await page.waitForFunction(() =>
    globalThis.devicesOutbox.some((message) => message.type === 'devicesReady'),
  )
  await page.evaluate(() => {
    globalThis.postMessage({ type: 'deviceState', revision: 1, state: { enabled: false } }, '*')
  })
}
/** Opens the document; `onChunk(route, response, body)` serves the chosen QR chunk. */
async function openDevicesDocument(page, onChunk, chunk = 'encoder') {
  await page.route(`${rig.origin}/w2-devices.html`, (route) =>
    route.fulfill({ contentType: 'text/html', body: DEVICES_PAGE }),
  )
  await page.route(`${rig.origin}/dist/webview/**/*.js`, async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    if (body.includes(QR_MARKERS[chunk]) && !route.request().url().endsWith('/main.js'))
      await onChunk(route, response, body)
    else await route.fulfill({ response, body })
  })
  await page.goto(`${rig.origin}/w2-devices.html`)
  await answerReady(page)
}
/** Refuses the chosen QR chunk once, then serves it. */
function refusedOnce() {
  const counts = { refused: 0 }
  const onChunk = async (route, response, body) => {
    if (counts.refused === 0) {
      counts.refused += 1
      await route.abort('failed')
      return
    }
    await route.fulfill({ response, body })
  }
  return { counts, onChunk }
}
const deviceRequests = (page) =>
  page.evaluate(() =>
    globalThis.devicesOutbox.filter((message) => message.type === 'deviceRequest'),
  )
async function startPair(page) {
  const requests = await deviceRequests(page)
  const before = requests.length
  await page.locator('.device-pairing > button').first().click()
  await page.waitForFunction(
    (count) =>
      globalThis.devicesOutbox.filter((message) => message.type === 'deviceRequest').length > count,
    before,
  )
  const sent = await deviceRequests(page)
  return sent.at(-1)
}
async function replyToPair(page, request, revision = 2) {
  await page.evaluate(
    ({ request, invitation, revision }) => {
      globalThis.postMessage(
        {
          type: 'deviceState',
          revision,
          state: { enabled: false },
          setup: { viewId: request.viewId, requestId: request.requestId, invitation },
        },
        '*',
      )
    },
    { request, invitation: harnessInvitation(), revision },
  )
}
const readyCount = (page) =>
  page.evaluate(
    () => globalThis.devicesOutbox.filter((message) => message.type === 'devicesReady').length,
  )
const qrImage = (page) => page.locator('.device-public-text svg[role="img"]')

describe('RVM100W Devices bridge and QR chunks in real Chrome', () => {
  it('keeps an in-flight Pair while the encoder chunk resolves', async () => {
    const page = await rig.browser.newPage({ viewport: { width: 320, height: 760 } })
    try {
      const gate = Promise.withResolvers()
      const loaded = Promise.withResolvers()
      await openDevicesDocument(page, async (route, response, body) => {
        await gate.promise
        await route.fulfill({ response, body })
        loaded.resolve()
      })
      const request = await startPair(page)
      expect(request.action).toEqual({ kind: 'pair' })
      gate.resolve()
      await loaded.promise
      // Let the module evaluate and React commit the render that adds the encoder.
      await page.waitForTimeout(READY_TIMEOUT_MS / 4)
      expect(await readyCount(page)).toBe(1)
      expect(await page.locator('[role="alert"]').count()).toBe(0)
      await replyToPair(page, request)
      await page.locator('.device-public-text textarea').waitFor({ timeout: READY_TIMEOUT_MS })
      await qrImage(page).waitFor({ timeout: READY_TIMEOUT_MS })
      expect(await page.locator('[role="alert"]').count()).toBe(0)
      expect(await readyCount(page)).toBe(1)
    } finally {
      await page.close()
    }
  })

  it.each(['encoder', 'figure'])(
    'recovers a refused %s chunk by reloading, never over a waiting reply, keeping the draft',
    async (chunk) => {
      const page = await rig.browser.newPage({ viewport: { width: 320, height: 760 } })
      try {
        const refusal = refusedOnce()
        await openDevicesDocument(page, refusal.onChunk, chunk)
        await replyToPair(page, await startPair(page))
        await page.locator('.device-public-text textarea').waitFor({ timeout: READY_TIMEOUT_MS })
        const failure = page.locator('.device-public-text [role="alert"]')
        await failure.waitFor({ timeout: READY_TIMEOUT_MS })
        // The alert says Retry reloads the panel; the text invitation stays complete.
        expect(await failure.textContent()).toContain(EN.devices.qrReload)
        expect(await page.locator('.device-public-text textarea').inputValue()).toContain(
          harnessInvitation().invitationId,
        )
        expect(refusal.counts.refused).toBe(1)
        const retry = failure.getByRole('button', { name: EN.surfaceLoadRetry })
        await page.locator('.device-pairing form textarea').fill('peer invitation draft')
        // A second Pair waits for its reply: no reload may drop it.
        const waiting = await startPair(page)
        expect(await retry.isDisabled()).toBe(true)
        await replyToPair(page, waiting, 3)
        await page.waitForFunction(
          () =>
            !globalThis.document
              .querySelector('.device-public-text [role="alert"] button')
              ?.hasAttribute('disabled'),
        )
        await Promise.all([page.waitForEvent('load'), retry.click()])
        await answerReady(page)
        // The unsent draft came back with the reloaded document.
        expect(await page.locator('.device-pairing form textarea').inputValue()).toBe(
          'peer invitation draft',
        )
        await replyToPair(page, await startPair(page))
        await qrImage(page).waitFor({ timeout: READY_TIMEOUT_MS })
        expect(await page.locator('.device-public-text [role="alert"]').count()).toBe(0)
        expect(await readyCount(page)).toBe(1)
      } finally {
        await page.close()
      }
    },
  )
})

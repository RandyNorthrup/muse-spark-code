import { beforeAll, afterAll, afterEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { chromium } from 'playwright-core'

import { findChrome } from '../../scripts/lib/chrome.mjs'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'
import { isolateMakerValidation } from '../../scripts/lib/makerValidation.mjs'
import { loadL10n } from '../../scripts/lib/l10nSource.mjs'
import { MakerApproval } from '../../src/core/maker/ports.ts'

// Select the fixture engine, never a subset of tests. The rig may supply a
// cached WebKit client matching its native runtime without changing pins.
const ENGINE = process.env['MUSE_MAKER_BROWSER'] ?? 'Chrome'
if (!['Chrome', 'WebKit'].includes(ENGINE)) throw new Error('Unknown maker fixture browser')

const ID = '2b4a9acb-2dc5-4f46-aeb8-40aee71bb875'
const machine = {
  registrationId: ID,
  id: 'printer',
  name: 'Simulator printer',
  kind: 'moonraker',
  category: 'printer',
  endpoint: 'http://127.0.0.1',
  limits: { extruder: 200, travel: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 100 } } },
}
const state = (count = 1) => ({
  v: 1,
  type: 'makerState',
  isTrusted: true,
  hardwareEnabled: true,
  isInteractive: true,
  machines: Array.from({ length: count }, (_, index) => ({
    ...machine,
    id: `printer-${index}`,
    name: `Simulator ${index}`,
    registrationId: `${ID.slice(0, -4)}${String(index).padStart(4, '0')}`,
  })),
  ports: [],
})
const approval = (payload) => ({
  v: 1,
  type: 'makerApproval',
  request: {
    id: ID,
    kind: 'machine',
    digest: createHash('sha256').update(payload).digest('hex'),
    expiresAt: Date.now() + 60_000,
    action: 'actuate',
    target: { kind: 'machine', ...machine, identity: 'Simulator' },
    payload,
    analysis: {
      classes: ['actuate'],
      maxFeedMmMin: 100,
      temperatures: {},
      unknown: [],
      refused: [],
      hasMotion: true,
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    },
  },
})
// The target has exactly the frozen protocol fields, without registration-only metadata.
const requestFor = (payload) => {
  const frame = approval(payload)
  delete frame.request.target.category
  delete frame.request.target.kind
  delete frame.request.target.limits
  frame.request.target.kind = 'machine'
  return frame
}
const fixture = (isPreview = false) => `
import { ${isPreview ? 'wireMakerPreview' : 'listenForMaker'} } from './${isPreview ? 'maker/previewPage' : 'makerEntry'}';
${isPreview ? "import './maker/preview.css';" : ''}
const host = { post(message) { window.sent.push(message); if (message.type === 'makerReady') fetch('/maker-ready').then(response => response.json()).then(frames => frames.forEach(window.emit)); }, savedState() {}, saveState() {}, messages: window };
window.sent = []; window.metrics = {};
window.emit = data => window.dispatchEvent(new MessageEvent('message', { data }));
window.addEventListener('muse-panel-reload', () => globalThis.sessionStorage.setItem('chat-receipt', 'saved before reload'));
${isPreview ? 'wireMakerPreview(globalThis.document, host);' : 'listenForMaker(host);'}
`
const rig = {
  browser: undefined,
  hostDelay: 0,
  server: undefined,
  page: undefined,
  port: 0,
  failed: undefined,
  requests: new Map(),
  results: [],
  table: undefined,
  hostFrames: [],
  hostApprovals: [],
}

beforeAll(async () => {
  const { EN } = await loadL10n(process.cwd())
  rig.english = EN
  rig.german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
  const files = new Map()
  for (const [name, isPreview] of [
    ['main', false],
    ['preview', true],
  ]) {
    const result = await build({
      stdin: {
        contents: fixture(isPreview),
        loader: 'js',
        resolveDir: path.resolve('src/webview'),
      },
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      minify: true,
      write: false,
      metafile: true,
      outdir: path.resolve(`temp/browser-${name}`),
      chunkNames: 'chunks/[hash]',
      jsx: 'automatic',
      plugins: [compactBrowserEnglish, isolateMakerValidation],
    })
    for (const file of result.outputFiles)
      files.set('/' + path.relative(process.cwd(), file.path).replaceAll('\\', '/'), file.contents)
    if (isPreview) {
      continue
    }

    rig.presentation = Object.entries(result.metafile.outputs).find(([, output]) =>
      Object.keys(output.inputs).some((input) =>
        input.replaceAll('\\', '/').endsWith('maker/presentation.ts'),
      ),
    )?.[0]
    if (rig.presentation === undefined) throw new Error('Missing shared static dependency')
    rig.presentation = '/' + rig.presentation.replaceAll('\\', '/')
  }
  const css = readFileSync('src/webview/styles.css', 'utf8')
  rig.server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    rig.requests.set(pathname, (rig.requests.get(pathname) ?? 0) + 1)
    if (pathname === rig.failed) {
      response.writeHead(404).end()
      return
    }
    if (pathname === '/maker-ready') {
      const reply = () =>
        response
          .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          .end(
            JSON.stringify([
              ...rig.hostFrames,
              ...rig.hostApprovals
                .map((pending) => pending.reopen({ v: 1, type: 'makerReady' }))
                .filter((frame) => frame !== undefined),
            ]),
          )
      if (rig.hostDelay > 0) globalThis.setTimeout(reply, rig.hostDelay)
      else reply()
      return
    }
    if (pathname === '/' || pathname === '/preview') {
      const isPreview = pathname === '/preview'
      const stopHtml = Array.from(
        { length: 10 },
        (_, index) => `<button data-maker-stop="printer-${index}">Stop ${index}</button>`,
      ).join('')
      const embedded =
        rig.table === undefined
          ? ''
          : `<script id="muse-l10n" type="application/json">${JSON.stringify(rig.table)}</script>`
      const html = `<html><head><style nonce="simulator">${isPreview ? '' : css}</style>${isPreview ? '<link rel="stylesheet" href="/temp/browser-preview/stdin.css">' : '<link rel="stylesheet" href="/temp/browser-main/stdin.css">'}</head><body data-artifact-id="${ID}" style="--vscode-font-family:Arial;--vscode-font-size:13px">${embedded}${isPreview ? '' : `<div id="maker-stop-shell" class="maker-static-stop"><button type="button">${rig.table?.table?.makerStopAll ?? rig.english.makerStopAll}</button></div>`}<main id="root"><button>Chat</button></main>${isPreview ? `<canvas id="maker-canvas"></canvas><p id="maker-preview-unavailable" hidden>Unavailable</p><button data-maker-stop="">Stop all machines</button>${stopHtml}` : ''}<script type="module" nonce="simulator" src="/temp/browser-${isPreview ? 'preview' : 'main'}/stdin.js"></script></body></html>`
      response
        .writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...(!isPreview && {
            'Content-Security-Policy':
              "default-src 'none'; script-src 'nonce-simulator'; worker-src blob:; style-src 'self' 'nonce-simulator'; connect-src 'self'",
          }),
        })
        .end(html)
      return
    }
    const contents = files.get(pathname)
    response
      .writeHead(contents === undefined ? 404 : 200, {
        'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        'Cache-Control': 'no-store',
      })
      .end(contents)
  })
  await new Promise((resolve) => rig.server.listen(0, '127.0.0.1', resolve))
  rig.port = rig.server.address().port
  if (ENGINE === 'WebKit') {
    const { webkit } = await import(process.env['MUSE_MAKER_WEBKIT_CLIENT'] ?? 'playwright-core')
    rig.browser = await webkit.launch()
  } else {
    rig.browser = await chromium.launch({ executablePath: findChrome() })
  }
})
afterEach(async () => {
  await rig.page?.close()
  rig.failed = undefined
  rig.hostDelay = 0
  rig.table = undefined
  rig.hostFrames = []
  rig.hostApprovals = []
})
afterAll(async () => {
  writeFileSync('temp/redm103u-browser-receipt.json', JSON.stringify(rig.results, null, 2) + '\n')
  rig.server?.closeAllConnections()
  await rig.browser?.close()
  if (rig.server !== undefined) await new Promise((resolve) => rig.server.close(resolve))
})
async function page(width = 320, height = 760, isPreview = false, isStorageDenied = false) {
  rig.page = await rig.browser.newPage({
    viewport: { width, height },
  })
  rig.page.setDefaultTimeout(3000)
  if (isStorageDenied)
    await rig.page.addInitScript(() => {
      Object.defineProperty(globalThis, 'sessionStorage', {
        get() {
          throw new Error('Denied')
        },
      })
    })
  await rig.page.addInitScript(() => {
    const NativeWorker = globalThis.Worker
    Object.assign(globalThis, { workerFacts: { created: 0, terminated: 0 } })
    Object.defineProperty(globalThis, 'Worker', {
      value: class extends NativeWorker {
        constructor(...args) {
          super(...args)
          globalThis.workerFacts.created += 1
        }
        terminate() {
          globalThis.workerFacts.terminated += 1
          return super.terminate()
        }
      },
    })
  })
  await rig.page.goto(`http://127.0.0.1:${rig.port}/${isPreview ? 'preview' : ''}`)
  await rig.page.waitForFunction(() => globalThis.emit !== undefined)
  return rig.page
}
const emit = (p, data) => p.evaluate((frame) => globalThis.emit(frame), data)
async function openApproval(p, content) {
  const frame = requestFor(content)
  await emit(p, { ...state(), machines: [machine] })
  await emit(p, frame)
  await p.getByRole('dialog', { name: 'Approve hardware action' }).waitFor()
  await p.locator('.maker-digest').waitFor()
  return frame.request
}
async function end(p) {
  await p.locator('.maker-payload').evaluate((node) => {
    node.scrollIntoView({ block: 'center' })
    node.scrollTop = node.scrollHeight
    node.dispatchEvent(new globalThis.Event('scroll'))
  })
}
const stopFacts = (p, selector) =>
  p.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const hit = globalThis.document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    )
    return {
      visible: rect.top >= 0 && rect.bottom <= globalThis.innerHeight && node.contains(hit),
      top: rect.top,
      bottom: rect.bottom,
    }
  })

it(`${ENGINE}: CR is visible and a clipped initial view completes on outer scrolling alone`, async () => {
  const p = await page()
  const request = await openApproval(p, 'G1 X1\r')
  expect(await p.locator('.maker-payload').textContent()).toContain('␍')
  expect(await p.locator('.maker-digest').textContent()).toBe(request.digest)
  const send = p.getByRole('button', { name: 'Send once', exact: true })
  expect(await send.isDisabled()).toBe(true)
  await end(p)
  await p.waitForFunction(
    () =>
      ![...globalThis.document.querySelectorAll('button')].find(
        (node) => node.textContent === 'Send once',
      ).disabled,
  )
  await send.click()
  expect(await p.evaluate(() => globalThis.sent.at(-1).answer)).toMatchObject({
    decision: 'allow_once',
    digest: request.digest,
  })
})
it(`${ENGINE}: BOMs at the start and middle remain visible in the exact approved payload`, async () => {
  const p = await page()
  const request = await openApproval(p, '\u{FEFF}M105\u{FEFF}\r\n')
  expect(await p.locator('.maker-payload').textContent()).toContain(
    String.raw`\xef\xbb\xbfM105\xef\xbb\xbf␍␊`,
  )
  expect(await p.locator('.maker-digest').textContent()).toBe(request.digest)
})
it(`${ENGINE}: a long unbroken token fits every measured row in a 161 px pane`, async () => {
  const p = await page(161)
  await openApproval(p, 'W'.repeat(1000))
  const facts = await p.locator('.maker-payload').evaluate((node) => ({
    client: node.clientWidth,
    scroll: node.scrollWidth,
    fits: [...node.querySelectorAll('span')].every((span) => {
      const range = globalThis.document.createRange()
      range.selectNodeContents(span)
      return range.getBoundingClientRect().width <= node.clientWidth + 1
    }),
  }))
  expect(facts.scroll).toBeLessThanOrEqual(facts.client)
  expect(facts.fits).toBe(true)
  rig.results.push({ probe: 'long-token', ...facts })
})
it.each([5, 10])(
  `${ENGINE}: %s machines retain bounded shared Stop at short and ordinary pane sizes`,
  async (count) => {
    const p = await page(320, 120)
    await emit(p, state(count))
    await p.locator('.maker-surface').waitFor({ state: 'attached' })
    const toolbarFacts = await stopFacts(p, '.maker-toolbar .maker-stop > button')
    expect(toolbarFacts.visible).toBe(true)
    await p.getByRole('button', { name: 'Devices and machines', exact: true }).click()
    const dialog = p.getByRole('dialog', { name: 'Devices and machines', exact: true })
    await dialog.waitFor()
    for (const height of [120, 160, 400, 760]) {
      await p.setViewportSize({ width: 320, height })
      const facts = await stopFacts(p, '.modal .maker-stop > button')
      expect(facts.visible).toBe(true)
      rig.results.push({ probe: 'shared-stop', count, height, ...facts })
      const list = dialog.locator('.maker-stop-list')
      const listFacts = await list.evaluate((node) => ({
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        buttons: node.querySelectorAll('button').length,
      }))
      expect(listFacts.buttons).toBe(count)
      expect(listFacts.scrollHeight).toBeGreaterThan(listFacts.clientHeight)
      rig.results.push({ probe: 'shared-stop-list', count, height, ...listFacts })
      await list.evaluate((node) => {
        node.scrollTop = node.scrollHeight
      })
      const afterScroll = await stopFacts(p, '.modal .maker-stop > button')
      expect(afterScroll.visible).toBe(true)
      await p.locator('.modal .maker-stop > button').click()
      expect(await p.evaluate(() => globalThis.sent.at(-1))).toEqual({ v: 1, type: 'makerStop' })
    }
  },
)
it(`${ENGINE}: ten standalone machines retain Stop all and an internally scrolling list`, async () => {
  const p = await page(320, 120, true)
  for (const height of [120, 400]) {
    await p.setViewportSize({ width: 320, height })
    const facts = await stopFacts(p, '.maker-stop-stack > button')
    expect(facts.visible).toBe(true)
    rig.results.push({ probe: 'standalone-stop', count: 10, height, ...facts })
    expect(
      await p.locator('.maker-stop-list').evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true)
    await p.locator('.maker-stop-stack > button').click()
    expect(await p.evaluate(() => globalThis.sent.at(-1))).toEqual({ v: 1, type: 'makerStop' })
  }
})
it(`${ENGINE}: 100,000 lines remain virtual and queued Stop input responds below 100 ms`, async () => {
  const p = await page()
  await emit(p, state())
  await p.locator('.maker-surface').waitFor({ state: 'attached' })
  await emit(p, {
    v: 1,
    type: 'makerPreview',
    preview: { kind: 'payload', title: 'Warm simulator', content: 'hello' },
  })
  await p.locator('.maker-digest').waitFor()
  await p.evaluate(() => {
    globalThis.metrics.maxStopDelay = 0
    let previous = globalThis.performance.now()
    globalThis.metrics.stopInterval = globalThis.setInterval(() => {
      const now = globalThis.performance.now()
      globalThis.metrics.maxStopDelay = Math.max(globalThis.metrics.maxStopDelay, now - previous)
      previous = now
      globalThis.document.querySelector('.modal .maker-stop > button')?.click()
    }, 5)
    globalThis.emit({
      v: 1,
      type: 'makerPreview',
      preview: { kind: 'payload', title: 'Large simulator', content: 'G1 X1\n'.repeat(100_000) },
    })
  })
  await p.getByLabel('I confirm the summary and this exact payload digest.').waitFor()
  const facts = await p.evaluate(() => {
    globalThis.clearInterval(globalThis.metrics.stopInterval)
    return {
      latency: globalThis.metrics.maxStopDelay,
      rows: globalThis.document.querySelectorAll('.maker-payload-rows > span').length,
      height: Number(
        globalThis.document.querySelector('.maker-payload-rows').style.height.replace('px', ''),
      ),
      stops: globalThis.sent.filter((frame) => frame.type === 'makerStop').length,
    }
  })
  expect(facts.latency).toBeLessThan(100)
  expect(facts.rows).toBeLessThan(30)
  expect(facts.height).toBe(2_000_000)
  expect(facts.stops).toBeGreaterThan(0)
  rig.results.push({ probe: 'large-payload', ...facts })
})
it.each([10_000, 20_000])(
  `${ENGINE}: worst-case search with %s repeated rows keeps Stop below 100 ms`,
  async (count) => {
    const p = await page()
    await emit(p, state())
    await emit(p, {
      v: 1,
      type: 'makerPreview',
      preview: { kind: 'payload', title: 'Search simulator', content: 'G1 X1\n'.repeat(100_000) },
    })
    await p.getByLabel('I confirm the summary and this exact payload digest.').waitFor()
    await p.getByLabel('Search canonical payload').fill('G1 X1␊'.repeat(count) + 'Z')
    const facts = await p.evaluate(async () => {
      let previous = globalThis.performance.now()
      let latency = 0
      let stops = 0
      const interval = globalThis.setInterval(() => {
        const now = globalThis.performance.now()
        latency = Math.max(latency, now - previous)
        previous = now
        globalThis.document.querySelector('.modal .maker-stop > button').click()
        stops += 1
      }, 5)
      const search = [...globalThis.document.querySelectorAll('button')].find(
        (node) => node.textContent === 'Find next',
      )
      const searchStarted = globalThis.performance.now()
      search.click()
      const dispatchMs = globalThis.performance.now() - searchStarted
      await new Promise((resolve) => globalThis.setTimeout(resolve, 200))
      globalThis.clearInterval(interval)
      return {
        latency,
        stops,
        sent: globalThis.sent.filter((frame) => frame.type === 'makerStop').length,
        workers: globalThis.workerFacts,
        dispatchMs,
      }
    })
    rig.results.push({
      probe: 'worst-case-search',
      engine: ENGINE,
      queryLength: count * 6 + 1,
      ...facts,
    })
    expect(facts.latency).toBeLessThan(100)
    expect(facts.stops).toBeGreaterThan(0)
    expect(facts.sent).toBe(facts.stops)
    expect(facts.workers.created).toBe(1)
    expect(facts.workers.terminated).toBe(1)
  },
)
it(`${ENGINE}: retry reloads and refetches a failed static dependency, preserving panel state`, async () => {
  rig.failed = rig.presentation
  const p = await page()
  const before = rig.requests.get(rig.presentation) ?? 0
  await emit(p, state(10))
  rig.hostFrames = [state(10)]
  await p.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  await p.getByRole('button', { name: 'Stop all machines', exact: true }).click()
  expect(await p.evaluate(() => globalThis.sent.at(-1))).toEqual({ v: 1, type: 'makerStop' })
  rig.failed = undefined
  await p.getByRole('button', { name: 'Retry', exact: true }).click()
  await p.locator('.maker-surface').waitFor({ state: 'attached' })
  expect((rig.requests.get(rig.presentation) ?? 0) - before).toBe(2)
  expect(await p.evaluate(() => globalThis.sessionStorage.getItem('chat-receipt'))).toBe(
    'saved before reload',
  )
  expect(await p.locator('.maker-toolbar .maker-stop-list button').count()).toBe(10)
  rig.results.push({ probe: 'static-dependency-reload', refetches: 2, restoredMachines: 10 })
})
it.each([false, true])(
  `${ENGINE}: reload re-fetches large host payloads (JSON expansion %s) and retains Stop`,
  async (escaped) => {
    rig.failed = rig.presentation
    const p = await page()
    const content = escaped ? '\0'.repeat(400_000) : 'M105\n'.repeat(200_000).padEnd(1_048_576, ' ')
    const frame = requestFor(content)
    rig.hostFrames = [
      state(10),
      { v: 1, type: 'makerPreview', preview: { kind: 'payload', title: 'Large', content } },
    ]
    rig.hostApprovals = [new MakerApproval(frame.request, () => true)]
    for (const message of [...rig.hostFrames, frame]) await emit(p, message)
    await p.getByRole('button', { name: 'Retry', exact: true }).waitFor()
    const before = rig.requests.get('/maker-ready') ?? 0
    rig.failed = undefined
    await p.getByRole('button', { name: 'Retry', exact: true }).click()
    await p.locator('.maker-surface').waitFor({ state: 'attached' })
    await p.locator('.maker-digest').waitFor()
    expect((rig.requests.get('/maker-ready') ?? 0) - before).toBeGreaterThan(0)
    expect(await p.locator('.maker-digest').textContent()).toBe(frame.request.digest)
    expect(await p.getByRole('button', { name: 'Send once', exact: true }).isDisabled()).toBe(true)
    await p.locator('.modal .maker-stop > button').click()
    expect(await p.evaluate(() => globalThis.sent.at(-1))).toEqual({ v: 1, type: 'makerStop' })
    expect(
      await p.evaluate(() => globalThis.sessionStorage.getItem('maker-panel-reload')),
    ).toBeNull()
    rig.results.push({
      probe: 'large-host-reload',
      escaped,
      chars: content.length,
      readyRefetch: true,
      stop: true,
    })
  },
)
it(`${ENGINE}: the lazy English projection preserves the installed German table`, async () => {
  rig.table = { locale: 'de', table: rig.german }
  const p = await page()
  await emit(p, state())
  await p.getByRole('button', { name: rig.german.makerStopAll, exact: true }).waitFor()
  await emit(p, requestFor('G1 X1\r'))
  await p.getByRole('dialog', { name: rig.german.makerApprovalTitle }).waitFor()
  await p.locator('.maker-payload').waitFor({ state: 'attached' })
  await p.getByText(rig.german.makerCanonicalLegend).waitFor()
})
it(`${ENGINE}: an invalid deferred maker key refuses the installed table and uses English`, async () => {
  const table = { ...rig.english, makerCanonicalLegend: 1 }
  rig.table = { locale: 'de', table }
  const p = await page()
  await emit(p, state())
  await p.getByRole('button', { name: 'Stop all machines', exact: true }).waitFor()
  await emit(p, requestFor('G1 X1\r'))
  await p.getByRole('dialog', { name: 'Approve hardware action' }).waitFor()
  expect(await p.getByText(rig.english.makerCanonicalLegend).count()).toBe(1)
})

it(`${ENGINE}: storage-denied reload retains static Stop before delayed replay`, async () => {
  rig.failed = rig.presentation
  const p = await page(320, 760, false, true)
  const content = '\0'.repeat(400_000)
  const frame = requestFor(content)
  await emit(p, state())
  await emit(p, frame)
  await p.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  rig.hostFrames = [state()]
  rig.hostApprovals = [new MakerApproval(frame.request, () => true)]
  rig.hostDelay = 1000
  rig.failed = undefined
  await Promise.all([
    p.waitForEvent('load'),
    p.getByRole('button', { name: 'Retry', exact: true }).click(),
  ])
  const facts = await p.evaluate(() => {
    const stop = globalThis.document.querySelector('#maker-stop-shell button')
    stop?.click()
    return {
      stop: stop !== null,
      surfaces: globalThis.document.querySelectorAll('.maker-surface').length,
      ready: globalThis.sent.some((message) => message.type === 'makerReady'),
      sent: globalThis.sent.at(-1),
    }
  })
  expect(facts).toEqual({
    stop: true,
    surfaces: 0,
    ready: true,
    sent: { v: 1, type: 'makerStop' },
  })
  await p.locator('.maker-digest').waitFor()
  expect(await p.locator('.maker-digest').textContent()).toBe(frame.request.digest)
  expect(await p.getByRole('button', { name: 'Send once', exact: true }).isDisabled()).toBe(true)
  rig.results.push({ probe: 'storage-denied-reload', engine: ENGINE, ...facts })
})

it(`${ENGINE}: worker finds an unmounted row under the nonce and blob-only CSP`, async () => {
  const p = await page()
  await openApproval(p, 'M104 S190\n'.repeat(250) + 'needle')
  await p.getByLabel('Search canonical payload').fill('needle')
  await p.getByRole('button', { name: 'Find next', exact: true }).click()
  await p.waitForFunction(() =>
    globalThis.document.querySelector('.maker-payload').textContent.includes('needle'),
  )
  expect(await p.evaluate(() => globalThis.workerFacts)).toEqual({ created: 1, terminated: 1 })
})

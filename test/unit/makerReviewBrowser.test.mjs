import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest'
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
import { buildWebviewHtml } from '../../src/host/html.ts'

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
const host = { post(message) { window.sent.push(message); if (message.type === 'makerReady') fetch('/maker-ready').then(response => response.json()).then(frames => { frames.forEach(window.emit); window.readyAnswered = true; }); }, savedState() {}, saveState() {}, messages: window };
window.sent = []; window.metrics = {};
window.emit = data => window.dispatchEvent(new MessageEvent('message', { data }));
window.addEventListener('muse-panel-reload', () => globalThis.sessionStorage.setItem('chat-receipt', 'saved before reload'));
${isPreview ? 'wireMakerPreview(globalThis.document, host);' : 'listenForMaker(host);'}
`
const rig = {
  browser: undefined,
  hostHold: undefined,
  server: undefined,
  page: undefined,
  port: 0,
  failed: undefined,
  requests: new Map(),
  results: [],
  table: undefined,
  hostFrames: [],
  hostApprovals: [],
  moduleHold: undefined,
}

/** The static Stop exactly as the host's document paints it. */
const staticStop = (table) =>
  /<div id="maker-stop-shell".*?<\/div>/u.exec(
    buildWebviewHtml({
      scriptUri: '',
      styleUri: '',
      cspSource: '',
      nonce: '',
      hasMakerStop: true,
      l10n: { locale: 'en', table },
    }),
  )[0]

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
      if (rig.hostHold === undefined) reply()
      else {
        rig.hostHold.asked.resolve(true)
        void rig.hostHold.release.promise.then(reply)
      }
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
      const html = `<html><head><style nonce="simulator">${isPreview ? '' : css}</style>${isPreview ? '<link rel="stylesheet" href="/temp/browser-preview/stdin.css">' : '<link rel="stylesheet" href="/temp/browser-main/stdin.css">'}</head><body data-artifact-id="${ID}" style="--vscode-font-family:Arial;--vscode-font-size:13px">${embedded}${isPreview ? '' : staticStop(rig.table?.table ?? rig.english)}<main id="root"><button>Chat</button></main>${isPreview ? `<canvas id="maker-canvas"></canvas><p id="maker-preview-unavailable" hidden>Unavailable</p><button data-maker-stop="">Stop all machines</button>${stopHtml}` : ''}<script type="module" nonce="simulator" src="/temp/browser-${isPreview ? 'preview' : 'main'}/stdin.js"></script></body></html>`
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
    const serve = () =>
      response
        .writeHead(contents === undefined ? 404 : 200, {
          'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
          'Cache-Control': 'no-store',
        })
        .end(contents)
    if (pathname === '/temp/browser-main/stdin.js' && rig.moduleHold !== undefined)
      void rig.moduleHold.then(serve)
    else serve()
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
// A fresh Chrome's first page pays its renderer's start and the first paint once:
// run 41516831678's Windows shard 4 took 5.4 s to reach this file's first approval,
// then spent that case's 3 s on its first scroll, while each later case took about
// 1.3 s. So the first page opens here, and every case keeps its 3 s.
beforeAll(async () => {
  const first = await rig.browser.newPage({ viewport: { width: 320, height: 760 } })
  try {
    await first.goto(`http://127.0.0.1:${rig.port}/`)
    await first.waitForFunction(() => globalThis.emit !== undefined)
    await openApproval(first, 'G1 X1\r')
  } finally {
    await first.close()
  }
})
afterEach(async () => {
  await rig.page?.close()
  rig.failed = undefined
  rig.hostHold?.release.resolve(true)
  rig.hostHold = undefined
  rig.moduleHold = undefined
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
/**
One sample: the longest gap a queued Stop click meets while 100,000 lines are prepared. The lines
differ by sample because the surface prepares again only when the content changes, and a row of
this sample's own line is what says this sample's payload is on the page.
*/
async function stopGapOverLargePayload(p, sample) {
  const line = `G1 X${sample}`
  await p.evaluate((text) => {
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
      preview: { kind: 'payload', title: 'Large simulator', content: `${text}\n`.repeat(100_000) },
    })
  }, line)
  await p.locator('.maker-payload-rows > span', { hasText: line }).first().waitFor()
  await p.getByLabel('I confirm the summary and this exact payload digest.').waitFor()
  return await p.evaluate(() => {
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
}
// The machine alone: the same 5 ms interval and the same longest gap on the same page, with nothing
// rendering. It clicks nothing: a slow Stop handler is what the real samples are there to catch, and
// clicking here would subtract it away. Its length does not move the number on Linux at any load
// (cc-int12fix.md), and an as-long-as-the-sample control would take this hook past its limit.
const STOP_CONTROL_MS = 250
const machineGap = (p) =>
  p.evaluate(
    (length) =>
      new Promise((resolve) => {
        const started = globalThis.performance.now()
        let previous = started
        let longest = 0
        const interval = globalThis.setInterval(() => {
          const now = globalThis.performance.now()
          longest = Math.max(longest, now - previous)
          previous = now
          if (now - started < length) return
          globalThis.clearInterval(interval)
          resolve(longest)
        }, 5)
      }),
    STOP_CONTROL_MS,
  )
const medianOf = (values) => values.toSorted((a, b) => a - b)[2]
const inMs = (values) => values.map((value) => value.toFixed(1)).join(', ')
// The bound is the product's promise; a single sample also reads whatever else a shared runner was
// doing (run 41794406176, Linux, 277 ms; this machine 20 to 25 ms before and after the same code).
// The median of five still fails anything that repeats, and ignores one hiccup. Five samples can pass
// a POSIX case's 5 s on a loaded machine (cc-int12fix.md), so they are taken under the hook's limit.
// Run 41848189260, macOS: 73.9, 231.8, 136.7, 169.5, 55.7, with no way to tell a poor instrument from a
// slow surface. So five controls are taken between them, the median of the controls is credited, and
// both sets go to the output on every run. A machine that misses the bound alone measures nothing:
// that is red in its own words, because crediting it would hide a real stall. So a real median of
// 200 ms or more never passes.
describe(`${ENGINE}: queued Stop, five samples over 100,000 lines`, () => {
  const taken = { samples: [], controls: [], stops: 0, reached: 0, ms: 0 }
  beforeAll(async () => {
    const started = Date.now()
    const p = await page()
    try {
      await emit(p, state())
      await p.locator('.maker-surface').waitFor({ state: 'attached' })
      await emit(p, {
        v: 1,
        type: 'makerPreview',
        preview: { kind: 'payload', title: 'Warm simulator', content: 'hello' },
      })
      await p.locator('.maker-digest').waitFor()
      for (const sample of [1, 2, 3, 4, 5]) {
        taken.reached = sample
        const facts = await stopGapOverLargePayload(p, sample)
        expect(facts.rows, `sample ${sample}: rows on the page`).toBeLessThan(30)
        expect(facts.height, `sample ${sample}: height of the rows`).toBe(2_000_000)
        expect(facts.stops, `sample ${sample}: Stop clicks landed`).toBeGreaterThan(taken.stops)
        taken.stops = facts.stops
        taken.samples.push(facts.latency)
        taken.controls.push(await machineGap(p))
      }
      taken.ms = Date.now() - started
    } finally {
      await p.close()
      rig.page = undefined
    }
  })
  // Every run says both sets, for the next hosted run to read. A wait that ran out, or the hook's
  // own limit, names only itself: the same line says how far it got.
  afterAll(() => {
    const both = `real ${inMs(taken.samples)}; controls ${inMs(taken.controls)}`
    process.stdout.write(`Stop samples, in ms, ${ENGINE}: ${both}; hook ${taken.ms} ms\n`)
    if (taken.samples.length < 5)
      throw new Error(`the Stop samples stopped in sample ${taken.reached}, after: ${both}`)
  })
  it(`${ENGINE}: 100,000 lines remain virtual and queued Stop input responds below 100 ms`, () => {
    const { samples, controls, stops, ms: hookMs } = taken
    const both = `real ${inMs(samples)}; controls ${inMs(controls)}`
    const real = medianOf(samples)
    const control = medianOf(controls)
    expect(
      control,
      `the machine alone misses the bound, so nothing was measured: ${both}`,
    ).toBeLessThan(100)
    expect(real - control, `real median less control median, in ms: ${both}`).toBeLessThan(100)
    rig.results.push({
      probe: 'large-payload',
      latency: real,
      control,
      samples,
      controls,
      stops,
      hookMs,
    })
  })
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
      await new Promise((resolve) => setTimeout(resolve, 200))
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

// The bundle is what wires the Stop, and on a slow machine it comes long after first paint. Between
// the two the Stop must read as what it is. The module is held here, so "before it is live" is a fact
// and not a race; nothing in this case waits on a clock.
it(`${ENGINE}: the static Stop is disabled until its handler is live, then answers`, async () => {
  const held = Promise.withResolvers()
  rig.moduleHold = held.promise
  rig.page = await rig.browser.newPage({ viewport: { width: 320, height: 760 } })
  rig.page.setDefaultTimeout(3000)
  // A real `load` waits for the module this case is holding back.
  await rig.page.goto(`http://127.0.0.1:${rig.port}/`, { waitUntil: 'commit' })
  const stop = rig.page.locator('#maker-stop-shell button')
  await stop.waitFor()
  expect(await stop.isDisabled()).toBe(true)
  await stop.click({ force: true })
  expect(await rig.page.evaluate(() => globalThis.sent)).toBeUndefined()
  held.resolve(true)
  await rig.page.waitForFunction(() => globalThis.emit !== undefined)
  expect(await stop.isDisabled()).toBe(false)
  await stop.click()
  expect(await rig.page.evaluate(() => globalThis.sent.at(-1))).toEqual({ v: 1, type: 'makerStop' })
})

it(`${ENGINE}: storage-denied reload retains static Stop before delayed replay`, async () => {
  rig.failed = rig.presentation
  const p = await page(320, 760, false, true)
  const content = '\0'.repeat(400_000)
  const frame = requestFor(content)
  await emit(p, state())
  await emit(p, frame)
  await p.getByRole('button', { name: 'Retry', exact: true }).waitFor()
  // The first document's own ask is answered, so the next one the host sees is the reloaded
  // document's, sent the moment it is listening. That ask is this case's clock. It used to read the
  // page when `load` returned, and found no module run yet on two hosted runs (41578891657,
  // 41761798108), with 1,000 ms before a reply it wanted not to have come.
  await p.waitForFunction(() => globalThis.readyAnswered === true)
  rig.hostFrames = [state()]
  rig.hostApprovals = [new MakerApproval(frame.request, () => true)]
  const hold = { asked: Promise.withResolvers(), release: Promise.withResolvers() }
  rig.hostHold = hold
  rig.failed = undefined
  await Promise.all([
    hold.asked.promise,
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
  hold.release.resolve(true)
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

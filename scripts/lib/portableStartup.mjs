import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { findChrome } from './chrome.mjs'
import { portableManifest } from './portableModules.mjs'
import { portableBridgeSetup } from '../../test/harness/portableBridgeSetup.mjs'

const ROOT = 'dist/webview/portable/'
const ORIGIN = 'http://127.0.0.1'
const ASSETS = '/assets/portable/'
const CHAT_MOUNTED = 'muse:chat-mounted'
const BOOT_TIMEOUT_MS = 5000
const CONTENT_TYPES = {
  js: 'text/javascript',
  css: 'text/css',
  html: 'text/html',
  woff2: 'font/woff2',
  woff: 'font/woff',
  json: 'application/json',
  svg: 'image/svg+xml',
}

/** Boot emitted production bytes; source syntax is never an accounting input. */
export async function measurePortableStartup(
  meta,
  readBuilt = (file) => readFileSync(file),
  browser,
) {
  const files = new Map(
    Object.keys(meta.outputs).map((file) => [
      file.replaceAll('\\', '/'),
      readBuilt(file.replaceAll('\\', '/')),
    ]),
  )
  const resourcePaths = new Map(
    files.keys().map((file) => [
      ASSETS +
        file
          .slice(ROOT.length)
          .split('/')
          .map((part) => encodeURIComponent(part))
          .join('/'),
      file,
    ]),
  )
  const graph = {
    ...meta,
    outputs: Object.fromEntries(
      Object.entries(meta.outputs)
        .filter(([file]) => !file.replaceAll('\\', '/').endsWith('/loader.js'))
        .map(([file, output]) => [file.replaceAll('\\', '/'), output]),
    ),
  }
  const manifest = portableManifest(graph, ROOT, (file) => {
    const bytes = files.get(file.replaceAll('\\', '/'))
    if (bytes === undefined) throw new Error(`Missing portable module: ${file}`)
    return Buffer.from(bytes).toString('utf8')
  })
  const isOwnedBrowser = browser === undefined
  browser ??= await chromium.launch({
    executablePath: findChrome(),
    channel: 'chrome',
    headless: true,
  })
  try {
    const variants = []
    for (const variant of ['native', 'companion']) {
      const context = await browser.newContext({ serviceWorkers: 'block' })
      try {
        const page = await context.newPage()
        const requests = []
        const errors = []
        let failBoot
        const failed = new Promise((resolve) => {
          failBoot = (message) => {
            errors.push(message)
            resolve(new Error(`Portable ${variant} boot failed: ${message}`))
          }
        })
        // Chromium routes dedicated workers and frames at context scope, but
        // shared-worker targets and service-worker script loads are not covered.
        // Refuse their creation explicitly instead of admitting an incomplete boot.
        await context.exposeBinding('refusePortableStartupTarget', (_, kind) => {
          failBoot(`PORTABLE_STARTUP_UNROUTABLE_TARGET: ${kind}`)
        })
        await context.addInitScript(() => {
          const refuse = (kind) => {
            const message = `PORTABLE_STARTUP_UNROUTABLE_TARGET: ${kind}`
            void globalThis.refusePortableStartupTarget(kind)
            throw new Error(message)
          }
          Object.assign(globalThis, {
            SharedWorker: function () {
              refuse('shared_worker')
            },
          })
          if (globalThis.navigator.serviceWorker)
            globalThis.navigator.serviceWorker.register = function () {
              refuse('service_worker')
            }
        })
        page.on('pageerror', (error) => {
          failBoot(error.message)
        })
        await context.route('**/*', async (route) => {
          const request = route.request()
          const url = new URL(request.url())
          if (
            url.origin === ORIGIN &&
            url.pathname === '/' &&
            request.isNavigationRequest() &&
            request.frame() === page.mainFrame()
          ) {
            await route.fulfill({
              contentType: 'text/html',
              body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="${ASSETS}main.css"></head><body data-bridge="${variant}" data-surface="chat"><div id="root"></div><script type="application/json" id="muse-panel">{"surface":"startup","sessionId":"test","surfaceKind":"chat"}</script><script type="application/json" id="muse-modules">${JSON.stringify(manifest).replaceAll('<', String.raw`\u003c`)}</script><script>${portableBridgeSetup(variant, '1.4')}</script><script type="module" data-muse-entry="${ASSETS}main.js"></script><script src="${ASSETS}loader.js"></script></body></html>`,
            })
            return
          }
          const file = url.origin === ORIGIN ? resourcePaths.get(url.pathname) : undefined
          const bytes = files.get(file)
          if (bytes === undefined) {
            failBoot(`PORTABLE_STARTUP_UNBUILT_REQUEST: ${url.origin}${url.pathname}`)
            await route.abort('blockedbyclient')
            return
          }
          // Ownership, not URL suffix or target type, defines the accounting.
          // This immutable file snapshot has one path/length/hash identity per output.
          requests.push({ file, request })
          await route.fulfill({
            contentType: CONTENT_TYPES[file.split('.').at(-1)] ?? 'application/octet-stream',
            body: Buffer.from(bytes),
          })
        })
        await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: BOOT_TIMEOUT_MS })
        await Promise.race([
          page.waitForFunction(
            (mark) =>
              globalThis.performance.getEntriesByName(mark).length > 0 ||
              globalThis.document.documentElement.dataset.launch === 'failed',
            CHAT_MOUNTED,
            { timeout: BOOT_TIMEOUT_MS },
          ),
          (async () => {
            throw await failed
          })(),
        ])
        if (errors.length > 0)
          throw new Error(`Portable ${variant} boot failed: ${errors.join('; ')}`)
        const boundary = await page.evaluate((mark) => {
          const entry = globalThis.performance.getEntriesByName(mark)[0]
          if (entry === undefined) throw new Error('Portable chat did not mount')
          return globalThis.performance.timeOrigin + entry.startTime
        }, CHAT_MOUNTED)
        // Drain routed frame/worker traffic so late delivery cannot truncate the
        // receipt. The recorded render mark, not network-idle time, bounds startup.
        await page.waitForLoadState('networkidle', { timeout: BOOT_TIMEOUT_MS })
        // Timing becomes available on response, and retains Chromium's actual
        // request-start wall time. Await it even for requests pending at the mark;
        // source delivery is immediate and neither completion nor type sets the boundary.
        const started = await Promise.all(
          requests.map(async ({ file, request }) => {
            const response = await request.response()
            const startedAt = request.timing().startTime
            if (response === null || startedAt <= 0)
              throw new Error(`PORTABLE_STARTUP_UNTIMED_REQUEST: ${file}`)
            return { file, startedAt }
          }),
        )
        if (errors.length > 0)
          throw new Error(`Portable ${variant} boot failed: ${errors.join('; ')}`)
        const outputs = [
          ...new Set(
            started
              .filter((request) => request.startedAt < boundary)
              .map((request) => request.file),
          ),
        ].toSorted((a, b) => a.localeCompare(b, 'en'))
        if (
          !outputs.includes(`${ROOT}main.js`) ||
          !outputs.includes(`${ROOT}loader.js`) ||
          !outputs.includes(`${ROOT}main.css`)
        )
          throw new Error(`Incomplete portable ${variant} boot measurement`)
        variants.push({
          variant,
          outputs,
          resources: outputs.map((file) => ({
            file,
            bytes: files.get(file).byteLength,
            sha256: createHash('sha256').update(files.get(file)).digest('hex'),
          })),
        })
      } finally {
        await context.close()
      }
    }
    return variants
  } finally {
    if (isOwnedBrowser) await browser.close()
  }
}

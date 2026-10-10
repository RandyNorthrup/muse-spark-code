import { Buffer } from 'node:buffer'
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
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        const requests = []
        const errors = []
        // Playwright's request.timing().startTime is -1 until a response arrives.
        // CDP records the start immediately, including still-pending lazy requests.
        const network = await context.newCDPSession(page)
        await network.send('Network.enable')
        network.on('Network.requestWillBeSent', ({ request, wallTime }) => {
          const url = new URL(request.url)
          if (url.origin === ORIGIN && /\.(?:js|css)$/u.test(url.pathname))
            requests.push({
              file: ROOT + url.pathname.slice(ASSETS.length),
              startedAt: wallTime * 1000,
            })
        })
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          if (url.origin !== ORIGIN)
            throw new Error(`Unexpected portable boot request: ${url.href}`)
          if (url.pathname === '/') {
            await route.fulfill({
              contentType: 'text/html',
              body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="${ASSETS}main.css"></head><body data-bridge="${variant}" data-surface="chat"><div id="root"></div><script type="application/json" id="muse-panel">{"surface":"startup","sessionId":"test","surfaceKind":"chat"}</script><script type="application/json" id="muse-modules">${JSON.stringify(manifest).replaceAll('<', String.raw`\u003c`)}</script><script>${portableBridgeSetup(variant, '1.4')}</script><script type="module" data-muse-entry="${ASSETS}main.js"></script><script src="${ASSETS}loader.js"></script></body></html>`,
            })
            return
          }
          const file = url.pathname.startsWith(ASSETS)
            ? ROOT + url.pathname.slice(ASSETS.length)
            : ''
          const bytes = files.get(file)
          if (bytes === undefined)
            throw new Error(`Missing requested portable output: ${url.pathname}`)
          await route.fulfill({
            contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript',
            body: Buffer.from(bytes),
          })
        })
        await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: BOOT_TIMEOUT_MS })
        await page.waitForFunction(
          (mark) =>
            globalThis.performance.getEntriesByName(mark).length > 0 ||
            globalThis.document.documentElement.dataset.launch === 'failed',
          CHAT_MOUNTED,
          { timeout: BOOT_TIMEOUT_MS },
        )
        const boundary = await page.evaluate((mark) => {
          const entry = globalThis.performance.getEntriesByName(mark)[0]
          if (entry === undefined) throw new Error('Portable chat did not mount')
          return globalThis.performance.timeOrigin + entry.startTime
        }, CHAT_MOUNTED)
        if (errors.length > 0)
          throw new Error(`Portable ${variant} boot failed: ${errors.join('; ')}`)
        const outputs = [
          ...new Set(
            requests
              .filter((request) => request.startedAt <= boundary)
              .map((request) => request.file),
          ),
        ].toSorted((a, b) => a.localeCompare(b, 'en'))
        if (
          !outputs.includes(`${ROOT}main.js`) ||
          !outputs.includes(`${ROOT}loader.js`) ||
          !outputs.includes(`${ROOT}main.css`)
        )
          throw new Error(`Incomplete portable ${variant} boot measurement`)
        variants.push({ variant, outputs })
      } finally {
        await context.close()
      }
    }
    return variants
  } finally {
    if (isOwnedBrowser) await browser.close()
  }
}

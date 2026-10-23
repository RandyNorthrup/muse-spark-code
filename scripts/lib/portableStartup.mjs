import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { z } from 'zod'
import { findChrome } from './chrome.mjs'
import { portableManifest } from './portableModules.mjs'
import { portableBridgeSetup } from '../../test/harness/portableBridgeSetup.mjs'

const ROOT = 'dist/webview/portable/'
const ORIGIN = 'http://127.0.0.1'
const ASSETS = '/assets/portable/'
const CHAT_MOUNTED = 'muse:chat-mounted'
const BOOT_TIMEOUT_MS = 5000
const CSP_REPORT = '/portable-startup-csp-report'
const BUILT_SOURCE = `${ORIGIN}${ASSETS}`
const CSP = `default-src 'none'; script-src 'unsafe-inline' ${BUILT_SOURCE} blob:; style-src 'unsafe-inline' ${BUILT_SOURCE}; font-src ${BUILT_SOURCE}; img-src ${BUILT_SOURCE}; connect-src ${BUILT_SOURCE} blob:; worker-src ${BUILT_SOURCE}; frame-src ${BUILT_SOURCE}; report-uri ${CSP_REPORT}`
const WORKER_CSP = `default-src 'none'; script-src ${BUILT_SOURCE}; connect-src ${BUILT_SOURCE}; worker-src ${BUILT_SOURCE}; report-uri ${CSP_REPORT}`
const workerRefusalSchema = z
  .object({
    museStartupRefusal: z.enum([
      'Worker',
      'WebSocket',
      'EventSource',
      'WebTransport',
      'worker CSP violation',
      'worker nonbuilt request',
    ]),
  })
  .strict()
// Measurement threat model: this helper measures ACCIDENTAL startup activity by
// our own built code and its dependencies, including ordinary wrappers that
// application code installs (a postMessage protocol wrapper, a reassigned
// reporting global or prototype method). The page init scripts below and this
// prepended worker probe run before any application script, so the
// instrumentation captures the native senders first and delivers every refusal
// and the flush acknowledgement over that captured path; no later application
// wrapper can hide or rewrite them. Code that deliberately tampers with the
// browser before the instrumentation runs is out of scope, because the
// instrumentation runs first. The receipt still identifies/counts the immutable
// shipped output, not this probe. A sweep on 2026-10-10 confirmed the helper's
// only cross-context probe/ack senders are the postMessage family and the four
// Playwright reporting bindings; no MessageChannel-based probe exists.
export const WORKER_GUARD = `if (typeof globalThis.document === 'undefined' && !globalThis.museStartupGuard) {
  globalThis.museStartupGuard = true;
  const nativePostMessage = globalThis.postMessage.bind(globalThis);
  const nativeStop = globalThis.Event.prototype.stopImmediatePropagation;
  globalThis.addEventListener('securitypolicyviolation', () => {
    nativePostMessage({ museStartupRefusal: 'worker CSP violation' });
  });
  globalThis.addEventListener('message', event => {
    if (event.data?.museStartupFlush === true) {
      nativePostMessage({ museStartupFlushed: true });
      nativeStop.call(event);
    }
  });
  for (const kind of ['Worker', 'WebSocket', 'EventSource', 'WebTransport']) {
    globalThis[kind] = function () {
      nativePostMessage({ museStartupRefusal: kind });
      throw new Error(kind === 'Worker' ? 'PORTABLE_STARTUP_UNROUTABLE_TARGET: nested_worker' : 'PORTABLE_STARTUP_UNBUILT_REQUEST: ' + kind);
    };
  }
  const refuse = () => {
    nativePostMessage({ museStartupRefusal: 'worker nonbuilt request' });
    throw new Error('PORTABLE_STARTUP_UNBUILT_REQUEST: worker nonbuilt request');
  };
  const nativeRequestUrl = Object.getOwnPropertyDescriptor(globalThis.Request.prototype, 'url').get;
  const fetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    let address = input;
    try { address = nativeRequestUrl.call(input); } catch { /* Other fetch inputs use native string conversion. */ }
    const url = new URL(address, location.href);
    if (!['http:', 'https:'].includes(url.protocol)) refuse();
    return fetch(input, init);
  };
  const importScripts = globalThis.importScripts.bind(globalThis);
  globalThis.importScripts = (...urls) => {
    for (const url of urls) if (!['http:', 'https:'].includes(new URL(url, location.href).protocol)) refuse();
    return importScripts(...urls);
  };
  URL.createObjectURL = refuse;
}\n`
/** Blob request identity ignores a fragment annotation: same bytes, same identity. */
export function portableUrlIdentity(url) {
  return url.split('#', 1)[0]
}
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
  let manifest
  try {
    manifest = portableManifest(graph, ROOT, (file) => {
      const bytes = files.get(file.replaceAll('\\', '/'))
      if (bytes === undefined) throw new Error(`Missing portable module: ${file}`)
      return Buffer.from(bytes).toString('utf8')
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'MHP_MODULE_IMPORT_UNLISTED')
      throw new Error('PORTABLE_STARTUP_UNBUILT_REQUEST: unlisted module import', { cause: error })
    throw error
  }
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
        const moduleBlobs = new Map()
        const blobRequests = []
        let failBoot
        const failed = new Promise((resolve) => {
          failBoot = (message) => {
            errors.push(message)
            resolve(new Error(`Portable ${variant} boot failed: ${message}`))
          }
        })
        const refuseRequest = (detail) => {
          failBoot(`PORTABLE_STARTUP_UNBUILT_REQUEST: ${detail}`)
        }
        // Routing covers page/frame sockets. Worker sockets are denied by the
        // worker response's CSP; its report is routed even if the worker catches.
        await context.routeWebSocket('**/*', async (socket) => {
          refuseRequest('websocket')
          await socket.close()
        })
        await context.exposeBinding('refusePortableStartupRequest', (_, detail) => {
          refuseRequest(detail)
        })
        await context.exposeBinding('refusePortableStartupWorker', (_, message) => {
          const parsed = workerRefusalSchema.safeParse(message)
          if (parsed.success && parsed.data.museStartupRefusal === 'Worker')
            failBoot('PORTABLE_STARTUP_UNROUTABLE_TARGET: nested_worker')
          else
            refuseRequest(parsed.success ? parsed.data.museStartupRefusal : 'invalid worker probe')
        })
        await context.exposeBinding('registerPortableStartupBlob', (_, { url, path }) => {
          const file = resourcePaths.get(path)
          if (requests.some((request) => request.file === file)) moduleBlobs.set(url, file)
          else refuseRequest(`uncounted module blob: ${path} (${file})`)
        })
        context.on('request', (request) => {
          if (request.url().startsWith('blob:')) blobRequests.push(request)
          if (request.resourceType() === 'eventsource') refuseRequest('eventsource')
        })
        await context.addInitScript(
          ({ loaderUrl, mark, builtPaths }) => {
            const blobs = new WeakMap()
            const materialized = new Map()
            const admitted = new Set()
            const sources = new Map()
            const builtOrigin = new URL(loaderUrl).origin
            const builtResources = new Set(builtPaths)
            let modules
            // Captured before any application script runs: the reporting
            // bindings are installed by exposeBinding init scripts, which were
            // registered before this one, so these consts hold the native
            // functions even when application code later reassigns the globals.
            const nativeRefuse = globalThis.refusePortableStartupRequest
            const nativeRegister = globalThis.registerPortableStartupBlob
            const isBooting = () => globalThis.performance.getEntriesByName(mark).length === 0
            const isFromLoader = () => {
              const stack = new Error('loader provenance').stack
              return stack?.includes(`at ${loaderUrl}:`) || stack?.includes(`(${loaderUrl}:`)
            }
            const refuse = (kind) => {
              void nativeRefuse(kind)
              throw new Error(`PORTABLE_STARTUP_UNBUILT_REQUEST: ${kind}`)
            }
            // Only the loader's exact rewrite of an emitted module is admitted.
            // Source equality plus dependency URL identities prevents a forged
            // loader stack/sourceURL from authenticating arbitrary blob bytes.
            Object.assign(globalThis, {
              Blob: class extends globalThis.Blob {
                constructor(parts, options) {
                  super(parts, options)
                  if (parts?.length === 1 && typeof parts[0] === 'string') blobs.set(this, parts[0])
                }
              },
            })
            const createObjectURL = URL.createObjectURL.bind(URL)
            URL.createObjectURL = (blob) => {
              if (!isBooting()) return createObjectURL(blob)
              const source = blobs.get(blob)
              if (typeof source !== 'string' || blob.type !== 'text/javascript' || !isFromLoader())
                return refuse('non-loader blob')
              modules ??= JSON.parse(
                globalThis.document.querySelector('#muse-modules').textContent,
              ).modules
              const candidates = modules.filter((module) => {
                const expected = sources.get(module.path)
                if (expected === undefined) return false
                const imports = module.imports.toSorted((a, b) => a.start - b.start)
                let cursor = 0
                let original = 0
                for (const imported of imports) {
                  const literal = expected.slice(original, imported.start)
                  if (!source.startsWith(literal, cursor)) return false
                  cursor += literal.length
                  const end = source.indexOf('"', cursor + 1)
                  const target = source.slice(cursor + 1, end)
                  const replacement = imported.dynamic
                    ? `window.museModules.import(${JSON.stringify(imported.target)})`
                    : JSON.stringify(target)
                  if (!source.startsWith(replacement, cursor)) return false
                  if (!imported.dynamic && !materialized.get(imported.target)?.has(target))
                    return false
                  cursor += replacement.length
                  original = imported.end
                }
                return source.slice(cursor) === expected.slice(original)
              })
              if (candidates.length === 0) return refuse('non-loader blob')
              const url = createObjectURL(blob)
              // Identical module contents can finish in either order. Retain
              // every counted identity compatible with these exact bytes.
              for (const module of candidates) {
                const urls = materialized.get(module.path) ?? new Set()
                urls.add(url)
                materialized.set(module.path, urls)
              }
              admitted.add(url)
              void nativeRegister({ url, path: candidates[0].path })
              return url
            }
            // The native getter checks the Request brand across realms. Capture
            // it before constructor/prototype wrappers, and let other fetch
            // inputs retain the browser's URL/string conversion.
            const nativeRequestUrl = Object.getOwnPropertyDescriptor(
              globalThis.Request.prototype,
              'url',
            ).get
            const fetch = globalThis.fetch.bind(globalThis)
            Object.assign(globalThis, {
              fetch: async (input, init) => {
                let address = input
                try {
                  address = nativeRequestUrl.call(input)
                } catch {
                  // Other fetch inputs use native string conversion.
                }
                const url = new URL(address, globalThis.location.href)
                // A fragment annotates the same bytes, so blob identity ignores
                // it: a fetch of `import.meta.url + '#...'` still matches the
                // admitted module URL. Unrelated blob URLs stay refused.
                const identity = url.href.split('#', 1)[0]
                // CSP can reject HTTP before its route or report arrives.
                // Refuse from the immutable inventory before native dispatch.
                if (
                  isBooting() &&
                  (['http:', 'https:'].includes(url.protocol)
                    ? url.origin !== builtOrigin || !builtResources.has(url.pathname)
                    : !admitted.has(identity))
                )
                  refuse(url.protocol)
                const isLoaderFetch = isFromLoader()
                const response = await fetch(input, init)
                if (isLoaderFetch && url.protocol === 'http:')
                  sources.set(url.pathname, await response.clone().text())
                return response
              },
            })
            for (const kind of [
              'EventSource',
              'WebTransport',
              'RTCPeerConnection',
              'webkitRTCPeerConnection',
            ])
              Object.assign(globalThis, {
                [kind]: function () {
                  refuse(kind)
                },
              })
            const Worker = globalThis.Worker
            // The owner listens and flushes through these captured prototype
            // methods, so an application wrapper around postMessage,
            // addEventListener or terminate cannot hide or rewrite probe
            // traffic on workers it creates after this script runs.
            const nativeWorkerListen = Worker.prototype.addEventListener
            const nativeWorkerPost = Worker.prototype.postMessage
            const nativeWorkerTerminate = Worker.prototype.terminate
            const nativeStop = globalThis.Event.prototype.stopImmediatePropagation
            const nativeWorkerRefusal = globalThis.refusePortableStartupWorker
            Object.assign(globalThis, {
              Worker: class extends Worker {
                constructor(...args) {
                  super(...args)
                  nativeWorkerListen.call(this, 'message', (event) => {
                    if (event.data?.museStartupRefusal) {
                      void nativeWorkerRefusal(event.data)
                      nativeStop.call(event)
                    } else if (event.data?.museStartupFlushed === true) {
                      nativeWorkerTerminate.call(this)
                      nativeStop.call(event)
                    }
                  })
                }
                // Flush queued CSP violations before an application can erase
                // them by terminating the worker immediately after its reply.
                terminate() {
                  nativeWorkerPost.call(this, { museStartupFlush: true })
                }
              },
            })
            globalThis.document.addEventListener('securitypolicyviolation', (event) => {
              if (isBooting()) void nativeRefuse(event.violatedDirective)
            })
          },
          {
            loaderUrl: `${BUILT_SOURCE}loader.js`,
            mark: CHAT_MOUNTED,
            builtPaths: resourcePaths.keys().toArray(),
          },
        )
        // Chromium routes dedicated workers and frames at context scope, but
        // shared-worker targets and service-worker script loads are not covered.
        // Refuse their creation explicitly instead of admitting an incomplete boot.
        await context.exposeBinding('refusePortableStartupTarget', (_, kind) => {
          failBoot(`PORTABLE_STARTUP_UNROUTABLE_TARGET: ${kind}`)
        })
        await context.addInitScript(() => {
          // Captured before any application script runs; see the note above.
          const nativeTarget = globalThis.refusePortableStartupTarget
          const refuse = (kind) => {
            const message = `PORTABLE_STARTUP_UNROUTABLE_TARGET: ${kind}`
            void nativeTarget(kind)
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
              headers: { 'Content-Security-Policy': CSP },
              body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="${ASSETS}main.css"></head><body data-bridge="${variant}" data-surface="chat"><div id="root"></div><script type="application/json" id="muse-panel">{"surface":"startup","sessionId":"test","surfaceKind":"chat"}</script><script type="application/json" id="muse-modules">${JSON.stringify(manifest).replaceAll('<', String.raw`\u003c`)}</script><script>${portableBridgeSetup(variant, '1.4')}</script><script type="module" data-muse-entry="${ASSETS}main.js"></script><script src="${ASSETS}loader.js"></script></body></html>`,
            })
            return
          }
          if (url.pathname === CSP_REPORT || request.resourceType() === 'eventsource') {
            refuseRequest('unsupported transport/CSP violation')
            await route.abort('blockedbyclient')
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
            headers: { 'Content-Security-Policy': file.endsWith('.html') ? CSP : WORKER_CSP },
            body:
              request.resourceType() === 'script' && file.endsWith('.js')
                ? Buffer.concat([Buffer.from(WORKER_GUARD), Buffer.from(bytes)])
                : Buffer.from(bytes),
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
        for (const request of blobRequests) {
          await request.response()
          if (
            request.timing().startTime < boundary &&
            !moduleBlobs.has(portableUrlIdentity(request.url()))
          )
            refuseRequest('unregistered blob')
        }
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

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { measurePortableStartup } from '../../scripts/lib/portableStartup.mjs'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'

const ROOT = 'dist/webview/portable/'
const MARK = `performance.mark('muse:chat-mounted');`
const TRANSPORTS = [
  [
    'websocket',
    `await new Promise(resolve => { const socket = new WebSocket('ws://127.0.0.1:1/unbuilt'); socket.onerror = resolve; socket.onclose = resolve; });`,
  ],
  ['data-fetch', `await fetch('data:text/plain,unbuilt');`],
  ['blob-fetch', `await fetch(URL.createObjectURL(new Blob(['unbuilt'])));`],
  [
    'data-import',
    `const url = 'data:text/javascript,' + 'export const unbuilt = 1'; await import(url);`,
  ],
  [
    'blob-import',
    `const url = URL.createObjectURL(new Blob(['export const unbuilt = 1'], {type:'text/javascript'})); await import(url);`,
  ],
  ['eventsource', `new EventSource('/assets/portable/main.js');`],
  [
    'webtransport',
    `const transport = new WebTransport('https://127.0.0.1:1/unbuilt'); void transport.ready.catch(() => {}); void transport.closed.catch(() => {});`,
  ],
  [
    'webrtc',
    `const peer = new RTCPeerConnection(); try { peer.createDataChannel('unbuilt'); } finally { peer.close(); }`,
  ],
  ['webrtc-peer', `new RTCPeerConnection();`],
]
const CASES = ['native', 'companion', 'worker', 'frame'].flatMap((target) =>
  TRANSPORTS.filter(([kind]) => target !== 'worker' || !kind.startsWith('webrtc')).map(
    ([kind, source]) => [target, kind, source],
  ),
)
CASES.push(
  ['worker', 'data-importscripts', `importScripts('data:text/javascript,self.unbuilt = 1');`],
  [
    'worker',
    'blob-importscripts',
    `importScripts(URL.createObjectURL(new Blob(['self.unbuilt = 1'], {type:'text/javascript'})));`,
  ],
)
const fixture = { files: new Map(), browser: undefined }
// Build the real production authenticated loader once; body deadlines stay at repository defaults.
const FIXTURE_SETUP_MS = 120_000
beforeAll(async () => {
  const loader = await build({
    entryPoints: ['src/webview/bridges/moduleLoader.ts'],
    outfile: `${ROOT}loader.js`,
    bundle: true,
    minify: true,
    metafile: true,
    charset: 'utf8',
    platform: 'browser',
    format: 'iife',
    target: 'chrome128',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [compactBrowserEnglish],
    write: false,
    logLevel: 'silent',
  })
  fixture.files.set(`${ROOT}loader.js`, loader.outputFiles[0].contents)
  fixture.files.set(`${ROOT}main.css`, Buffer.alloc(0))
  fixture.browser = await chromium.launch({
    executablePath: findChrome(),
    channel: 'chrome',
    headless: true,
  })
}, FIXTURE_SETUP_MS)
afterAll(async () => {
  await fixture.browser?.close()
})

function boot(source) {
  const files = new Map(fixture.files)
  files.set(`${ROOT}main.js`, Buffer.from(source))
  return {
    files,
    meta: { outputs: Object.fromEntries(files.keys().map((file) => [file, { imports: [] }])) },
  }
}
function addResource(graph, name, source) {
  const file = ROOT + name
  graph.files.set(file, Buffer.from(source))
  graph.meta.outputs[file] = { imports: [] }
  return `/assets/portable/${name}`
}

it.each(CASES)(
  'refuses caught %s %s boot activity with the measurement diagnostic',
  async (target, kind, source) => {
    const caught = `try { ${source} } catch {}`
    const graph = boot('')
    let prefix = `if (document.body.dataset.bridge === ${JSON.stringify(target)}) { ${caught} }`
    if (target === 'worker') {
      const url = addResource(
        graph,
        'caught-worker.js',
        `(async () => { ${caught} postMessage('ready'); })();`,
      )
      prefix = `await new Promise(resolve => { const worker = new Worker(${JSON.stringify(url)}); worker.onmessage = () => { worker.terminate(); resolve(); }; });`
    } else if (target === 'frame') {
      const url = addResource(
        graph,
        'caught-frame.html',
        `<!doctype html><script>(async () => { ${caught} parent.postMessage('ready', '*'); })();</script>`,
      )
      prefix = `await new Promise(resolve => { const frame = document.createElement('iframe'); addEventListener('message', event => { if (event.source === frame.contentWindow) { frame.remove(); resolve(); } }); frame.src = ${JSON.stringify(url)}; document.body.append(frame); });`
    }
    graph.files.set(`${ROOT}main.js`, Buffer.from(prefix + MARK))
    await expect(
      measurePortableStartup(graph.meta, (file) => graph.files.get(file), fixture.browser),
    ).rejects.toThrow('PORTABLE_STARTUP_UNBUILT_REQUEST')
  },
)

it('admits exact authenticated loader module blobs from counted bytes once', async () => {
  const graph = boot(
    `import { value } from './shared.js'; if(value !== 1) throw new Error('dependency'); await fetch(import.meta.url).then(r => r.text()); ${MARK}`,
  )
  addResource(graph, 'shared.js', 'export const value = 1;')
  const variants = await measurePortableStartup(
    graph.meta,
    (file) => graph.files.get(file),
    fixture.browser,
  )
  for (const { outputs, resources } of variants) {
    expect(outputs).toEqual(
      graph.files
        .keys()
        .toArray()
        .toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    expect(resources).toEqual(
      outputs.map((file) => ({
        file,
        bytes: graph.files.get(file).byteLength,
        sha256: createHash('sha256').update(graph.files.get(file)).digest('hex'),
      })),
    )
  }
})

it('keeps post-marker module blobs deferred', async () => {
  const graph = boot(`${MARK} await import('./lazy.js');`)
  addResource(graph, 'lazy.js', 'export const value = 1;')
  const variants = await measurePortableStartup(
    graph.meta,
    (file) => graph.files.get(file),
    fixture.browser,
  )
  for (const { outputs } of variants) expect(outputs).not.toContain(ROOT + 'lazy.js')
})

it('refuses non-built literal module imports with the measurement diagnostic', async () => {
  const graph = boot(
    `try { await import('data:text/javascript,export const unbuilt = 1'); } catch {} ${MARK}`,
  )
  await expect(
    measurePortableStartup(graph.meta, (file) => graph.files.get(file), fixture.browser),
  ).rejects.toThrow('PORTABLE_STARTUP_UNBUILT_REQUEST')
})

it.each(['nested', 'module'])(
  'refuses caught unsupported activity in %s worker dependencies',
  async (kind) => {
    const graph = boot('')
    const transport = TRANSPORTS.find(([name]) => name === 'webtransport')[1]
    const child = addResource(
      graph,
      'worker-child.js',
      `try { ${transport} } catch {} postMessage('ready');`,
    )
    const source =
      kind === 'module'
        ? `import './worker-child.js';`
        : `try { new Worker(${JSON.stringify(child)}); } catch {} postMessage('ready');`
    const url = addResource(graph, 'worker-parent.js', source)
    graph.files.set(
      ROOT + 'main.js',
      Buffer.from(`await new Promise(resolve => {
    const worker = new Worker(${JSON.stringify(url)}, {type: ${JSON.stringify(kind === 'module' ? 'module' : 'classic')}});
    worker.onmessage = () => { worker.terminate(); resolve(); };
  }); ${MARK}`),
    )
    await expect(
      measurePortableStartup(graph.meta, (file) => graph.files.get(file), fixture.browser),
    ).rejects.toThrow(
      kind === 'nested'
        ? 'PORTABLE_STARTUP_UNROUTABLE_TARGET: nested_worker'
        : 'PORTABLE_STARTUP_UNBUILT_REQUEST',
    )
  },
)

it('admits identical concurrently materialized modules without guessing their path', async () => {
  const graph = boot(`
    const originalFetch = window.fetch; let arrived = 0, release, pendingB;
    const both = new Promise(resolve => { release = resolve; });
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (input.endsWith('/a.js') || input.endsWith('/b.js')) {
        if (++arrived === 2) release(); await both;
        if (input.endsWith('/a.js')) await pendingB;
      }
      return response;
    };
    pendingB = window.museModules.import('/assets/portable/b.js');
    await Promise.all([pendingB, window.museModules.import('/assets/portable/a.js')]);
    await window.museModules.import('/assets/portable/parent.js'); ${MARK}
  `)
  addResource(graph, 'a.js', 'export const value = 1;')
  addResource(graph, 'b.js', 'export const value = 1;')
  addResource(
    graph,
    'parent.js',
    `import {value as a} from './a.js'; import {value as b} from './b.js'; export const value = a + b;`,
  )
  const variants = await measurePortableStartup(
    graph.meta,
    (file) => graph.files.get(file),
    fixture.browser,
  )
  for (const { outputs } of variants)
    expect(outputs).toEqual(
      graph.files
        .keys()
        .toArray()
        .toSorted((a, b) => a.localeCompare(b, 'en')),
    )
})

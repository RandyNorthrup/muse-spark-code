#!/usr/bin/env node
// Muse Desktop (M111, D91.13) lane BP: the real-Electron panel proof.
// Starts the packaged app on a real folder under Xvfb, drives the real
// bottom panel through CDP, and proves the person's real shell runs
// behind it: the startup chunk carries no terminal engine, New terminal
// loads it (script and stylesheet), typed keys reach bash and its
// output streams back through the bridge, `exit` lands the exited tab
// and the exit sentence, and Problems and Output show their honest
// empty states. Chunk loading is read off the Network domain (resource
// timing stays empty in this window). Run after `npm run package:desktop`:
//   TMPDIR=$PWD/temp ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node test/desktop/electron-panel.mjs
// ELECTRON_DISABLE_SANDBOX is a rig need only (the setuid helper cannot
// be root-owned in a lane checkout); the renderer's sandbox stays on.
// The proof reads the English table (no language is set in its scratch
// config), and keeps its screenshots in temp/ (ui:look copies the kept
// pair beside the certification record). Every phase has its own bound
// (a shared rig answers slowly); past any of them the proof stops and
// says which phase and what the page showed.

import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const electron = path.join(rootDir, 'dist', 'desktop-app', 'electron')
const scratch = path.join(rootDir, 'temp', 'desktop-panel')
const workspace = path.join(scratch, 'ws')
const configHome = path.join(scratch, 'config')
const cacheHome = path.join(scratch, 'cache')

for (const required of [electron]) {
  if (!existsSync(required)) throw new Error(`panel-proof: ${required} missing; package first`)
}
if (!existsSync(path.join(rootDir, 'dist', 'desktop-app', 'resources', 'app', 'index.html'))) {
  throw new Error('panel-proof: dist/desktop-app has no app; run npm run package:desktop first')
}

rmSync(scratch, { recursive: true, force: true })
mkdirSync(path.join(workspace, 'src'), { recursive: true })
mkdirSync(configHome, { recursive: true })
mkdirSync(cacheHome, { recursive: true })
writeFileSync(path.join(workspace, 'src', 'hello.ts'), 'export const hello = 1\n')

const child = spawn(
  electron,
  [
    '--workspace',
    workspace,
    '--remote-debugging-port=0',
    // The rig's Xvfb has no GPU and this Chromium blocklists software
    // WebGL unless asked: the flag lets the proof exercise the same
    // WebGL addon path real hardware takes (without it the product
    // honestly falls back to the canvas renderer).
    '--enable-unsafe-swiftshader',
  ],
  {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configHome,
      XDG_CACHE_HOME: cacheHome,
      TMPDIR: path.join(rootDir, 'temp'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
const childLog = { text: '' }
child.stdout.on('data', (chunk) => {
  childLog.text += chunk
})
child.stderr.on('data', (chunk) => {
  childLog.text += chunk
})

function stop(signal) {
  child.kill(signal)
}

process.on('exit', () => {
  if (child.exitCode === null) child.kill('SIGKILL')
})

async function devtoolsTarget(deadline) {
  while (Date.now() < deadline) {
    const found = childLog.text.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (found !== null) return found[1]
    if (child.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  stop('SIGKILL')
  throw new Error(`panel-proof: no DevTools endpoint\n${childLog.text.slice(-2000)}`)
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => resolve(socket), { once: true })
    socket.addEventListener('error', (event) => reject(event), { once: true })
  })
}

function cdp(socket) {
  let nextId = 1
  const waiting = new Map()
  const requested = new Set()
  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data))
    if (frame.id === undefined) {
      if (frame.method === 'Network.requestWillBeSent') requested.add(frame.params.request.url)
      return
    }
    const waiter = waiting.get(frame.id)
    if (waiter === undefined) return
    waiting.delete(frame.id)
    waiter(frame)
  })
  async function send(method, params = {}) {
    const id = nextId
    nextId += 1
    const reply = new Promise((resolve) => {
      waiting.set(id, resolve)
    })
    socket.send(JSON.stringify({ id, method, params }))
    const frame = await reply
    if (frame.error !== undefined) {
      throw new Error(`panel-proof: ${method} refused: ${frame.error.message}`)
    }
    return frame.result
  }
  return { send, requested }
}

const scriptStart = Date.now()
const browserUrl = await devtoolsTarget(scriptStart + 120_000)
// The browser endpoint lists its targets over HTTP; the page target
// carries the workbench.
const httpRoot = browserUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/.*$/, '')
const listed = await fetch(`${httpRoot}/json/list`)
const targets = await listed.json()
const page = targets.find(
  (entry) => entry.type === 'page' && String(entry.url).startsWith('muse-desktop://app/'),
)
if (page === undefined) {
  stop('SIGKILL')
  throw new Error(`panel-proof: no app page target: ${JSON.stringify(targets)}`)
}
const socket = await connect(page.webSocketDebuggerUrl)
const { send, requested } = cdp(socket)
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (result.exceptionDetails !== undefined) {
    throw new Error(
      `panel-proof: page threw: ${result.exceptionDetails.text} (${expression.slice(0, 120)})`,
    )
  }
  return result.result.value
}

async function describePage() {
  return await evaluate(
    `(() => {
      const text = (selector) => document.querySelector(selector)?.textContent ?? null;
      return JSON.stringify({
        tabs: document.querySelectorAll('[role="tab"]').length,
        notice: text('.muse-panel-notice'),
        chunkFailed: text('.muse-panel-chunk-failed'),
        loading: document.querySelectorAll('.muse-panel-terminal-loading').length,
        hosts: document.querySelectorAll('.muse-panel-terminal-host').length,
        emulators: document.querySelectorAll('.muse-panel-terminal-host .xterm').length,
      });
    })()`,
  )
}

async function poll(expression, what, budgetMs) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const value = await evaluate(expression)
    if (value !== null && value !== undefined && value !== false && value !== '') return value
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  let state = 'the page stopped answering'
  try {
    state = await describePage()
  } catch {
    // The failure below already says what never arrived.
  }
  stop('SIGKILL')
  throw new Error(
    `panel-proof: ${what} never arrived within ${String(budgetMs / 1000)}s; page: ${state}\n${childLog.text.slice(-2000)}`,
  )
}

const seenUrl = await evaluate('globalThis.location.href')
if (!seenUrl.startsWith('muse-desktop://app/')) {
  stop('SIGKILL')
  throw new Error(`panel-proof: the window is not on the app scheme: ${seenUrl}`)
}
await poll("document.querySelector('.muse-desktop') !== null", 'the workbench', 120_000)
console.log('panel-proof: the window renders on the app scheme')

const startupFetches = [...requested].join('\n')
if (startupFetches.includes('terminalEngine')) {
  stop('SIGKILL')
  throw new Error(`panel-proof: the startup chunk fetched the engine:\n${startupFetches}`)
}
console.log('panel-proof: startup fetched no terminal engine')

// Collect the bridge's own frames from inside the page: what the panel
// saw is what the PTY sent.
await evaluate(
  `(() => {
    globalThis.__bpData = [];
    globalThis.__bpExits = [];
    window.museDesktop.onTerminalData((frame) => globalThis.__bpData.push(frame.data));
    window.museDesktop.onTerminalExit((frame) => globalThis.__bpExits.push(frame.code));
  })()`,
)
await evaluate(
  `document.querySelector('.muse-panel-toolbar button[aria-label="New terminal"]').click()`,
)
await poll(
  "document.querySelector('.muse-panel-terminal-host .xterm') !== null",
  'the emulator',
  180_000,
)
const engineFetches = [...requested].join('\n')
if (!engineFetches.includes('renderer.terminalEngine.js')) {
  stop('SIGKILL')
  throw new Error(`panel-proof: New terminal fetched no engine chunk:\n${engineFetches}`)
}
const cssState = await evaluate(
  `(() => {
    const link = document.querySelector('link[data-muse-terminal-css]');
    return link === null ? 'missing' : link.sheet === null ? 'unloaded' : 'loaded';
  })()`,
)
if (cssState !== 'loaded') {
  stop('SIGKILL')
  throw new Error(`panel-proof: the engine stylesheet is ${cssState}`)
}
const screenReader = await evaluate(
  "document.querySelector('.muse-panel-terminal-host .xterm-accessibility') !== null",
)
if (!screenReader) {
  stop('SIGKILL')
  throw new Error('panel-proof: the screen-reader tree is missing')
}
const rendererKind = await evaluate(
  `(() => {
    const host = document.querySelector('.muse-panel-terminal-host');
    if (host.querySelector('.xterm canvas') !== null) return 'webgl';
    if (host.querySelector('.xterm-rows') !== null) return 'canvas';
    return 'neither';
  })()`,
)
if (rendererKind !== 'webgl') {
  stop('SIGKILL')
  throw new Error(`panel-proof: the WebGL renderer is not live (${rendererKind})`)
}
const viewportPaint = await evaluate(
  `(() => {
    const token = getComputedStyle(document.documentElement)
      .getPropertyValue('--ms-code-surface')
      .trim();
    const probe = document.createElement('div');
    probe.style.color = token;
    document.documentElement.append(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    const got = getComputedStyle(
      document.querySelector('.muse-panel-terminal-host .xterm-viewport'),
    ).backgroundColor;
    return want === got ? 'themed' : 'want ' + want + ' got ' + got;
  })()`,
)
if (viewportPaint !== 'themed') {
  stop('SIGKILL')
  throw new Error(`panel-proof: the viewport is not the code surface (${viewportPaint})`)
}
console.log('panel-proof: New terminal loaded the engine, its stylesheet and the reader tree')
console.log('panel-proof: the WebGL renderer is live and the viewport carries the theme')

// Through the real key path: the helper textarea keeps the keys, the
// shell runs them. printf's format keeps the input echo from containing
// the asserted output.
async function typeText(text) {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch, unmodifiedText: ch })
  }
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    windowsVirtualKeyCode: 13,
    code: 'Enter',
    key: 'Enter',
    text: '\r',
    unmodifiedText: '\r',
  })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13 })
}

const focusState = await evaluate(
  `(() => {
    const area = document.querySelector('.muse-panel-terminal-host .xterm-helper-textarea');
    if (area === null) return 'missing';
    area.focus();
    return document.activeElement === area ? 'focused' : 'unfocused';
  })()`,
)
if (focusState !== 'focused') {
  stop('SIGKILL')
  throw new Error(`panel-proof: the terminal never took focus (${focusState})`)
}
await typeText(String.raw`printf 'bp-proof-%s\n' 7147`)
await poll("globalThis.__bpData.join('').includes('bp-proof-7147')", 'the shell output', 120_000)
console.log('panel-proof: typed keys reached bash and its output streamed back')

await typeText('exit')
await poll(
  "globalThis.__bpExits.length > 0 && document.querySelector('.muse-panel-tab-exited') !== null",
  'the exit and its tab',
  120_000,
)
const exitCode = await evaluate('globalThis.__bpExits[0]')
if (exitCode !== 0) {
  stop('SIGKILL')
  throw new Error(`panel-proof: the shell exited ${String(exitCode)}, not 0`)
}
await poll(
  "document.querySelector('.muse-panel-terminal-host').textContent.includes('Terminal exited with code 0.')",
  'the exit sentence',
  120_000,
)
console.log('panel-proof: exit landed the exited tab and its sentence')

await evaluate(`document.querySelector('button[data-tab-id="problems"]').click()`)
const problemsEmpty = await poll(
  "document.querySelector('.muse-panel-empty')?.textContent ?? null",
  'the Problems empty state',
  60_000,
)
if (problemsEmpty !== 'No problems have been found.') {
  stop('SIGKILL')
  throw new Error(`panel-proof: Problems says ${JSON.stringify(problemsEmpty)}`)
}
await evaluate(`document.querySelector('button[data-tab-id="output"]').click()`)
const outputEmpty = await poll(
  `(() => {
    const empty = document.querySelector('.muse-panel-empty');
    return empty === null ? null : empty.textContent;
  })()`,
  'the Output empty state',
  60_000,
)
if (outputEmpty !== 'Nothing has written output yet.') {
  stop('SIGKILL')
  throw new Error(`panel-proof: Output says ${JSON.stringify(outputEmpty)}`)
}
console.log('panel-proof: Problems and Output show their honest empty states')

function findStatusSnapshot() {
  const found = []
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.json') && full.includes(`${path.sep}status${path.sep}`)) {
        found.push(full)
      }
    }
  }
  walk(configHome)
  return found
}
const snapshots = findStatusSnapshot()
if (snapshots.length === 0) {
  stop('SIGKILL')
  throw new Error('panel-proof: the renderer published no status snapshot')
}
const itemIds = JSON.parse(readFileSync(snapshots[0], 'utf8')).items.map((item) => item.id)
if (!itemIds.includes('workbench.workspace') || !itemIds.includes('workbench.terminals')) {
  stop('SIGKILL')
  throw new Error(`panel-proof: snapshot missing workbench items: ${itemIds.join(', ')}`)
}
console.log(`panel-proof: status snapshot carries ${itemIds.join(', ')}`)

// Back to the terminal for the kept pictures, then light and dark.
await evaluate(`document.querySelector('button[data-tab-id="terminal"]').click()`)
await poll(
  "document.querySelector('.muse-panel-terminal-host .xterm') !== null",
  'the terminal view back',
  60_000,
)
const schemes = ['light', 'dark']
for (const scheme of schemes) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  })
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(scratch, `panel-${scheme}.png`), Buffer.from(shot.data, 'base64'))
  console.log(`panel-proof: shot temp/desktop-panel/panel-${scheme}.png`)
}

socket.close()
stop('SIGTERM')
await new Promise((resolve) => child.on('exit', resolve))
console.log('panel-proof: PASS')

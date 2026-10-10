// M114 C-M114-1: the themed companion page in real Chromium.
//
// Serves the production usage entry, the static theme sheets and an
// installed font pack through Playwright routes (no listening socket), then
// checks the mounted theme, the applied appearance and axe with contrast.
// The launch/browser handshake is out of scope: /events and /post abort, so
// only theme facts, axe and captures are asserted, never backend behaviour.
//
// Sandbox note: needs an unsandboxed Chrome launch; the lane rig runs this.
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderCompanionPage } from '../../src/runtime/companion/page'
import { EN } from '../../src/shared/l10n/en'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { COMPANION_APPEARANCE_STORAGE_KEY } from '../../src/shared/constants'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { companionThemeCss } from '../../scripts/lib/webviewBundles.mjs'
import { warmBrowser } from './helpers/warmBrowser'
import { removeFolder } from './helpers/temporaryFolders'

// Real Chromium page work under load; PLAN.md §8 (2026-10-07).
const COMPANION_THEME_TIMEOUT_MS = 30_000

const folders = []
async function folder(prefix) {
  await mkdir('temp', { recursive: true })
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  folders.push(root)
  return root
}

// Mirrors usageCompanionEntry's loadModule: every reachable chunk rides a
// data: URL because the page policy admits no script source but its nonce.
async function buildImportMap(assetsFolder) {
  const imports = {}
  const modules = new Map()
  const loadModule = async (name) => {
    const specifier = `muse-usage/${name}`
    if (modules.has(name)) return specifier
    let content = await readFile(path.join(assetsFolder, name), 'utf8')
    for (const match of content.matchAll(
      /\b(from\s*|import\s*(?:\(\s*)?)["'](\.[^"']+\.js)["']/gu,
    )) {
      const target = await loadModule(
        path.posix.normalize(path.posix.join(path.posix.dirname(name), match[2] ?? '')),
      )
      content = content.replace(match[0], () => `${match[1]}${JSON.stringify(target)}`)
    }
    modules.set(name, content)
    imports[specifier] = `data:text/javascript;charset=utf-8,${encodeURIComponent(content)}`
    return specifier
  }
  await loadModule('usage.js')
  return { imports, entry: modules.get('usage.js') ?? '' }
}

const runtime = {}

beforeAll(async () => {
  const dataFolder = await folder('c-m114-1-theme-')
  const assetsFolder = path.join(dataFolder, 'dist', 'webview')
  await mkdir(assetsFolder, { recursive: true })
  await build({
    entryPoints: { usage: 'src/webview/usage/usage.tsx' },
    outdir: assetsFolder,
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    splitting: true,
    chunkNames: 'chunks/[hash]',
    target: 'chrome128',
    jsx: 'automatic',
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [compactBrowserUiText],
    logLevel: 'silent',
  })
  await writeFile(path.join(assetsFolder, 'theme.css'), companionThemeCss())
  // An installed pack: the real Inter file with a matching stylesheet.
  const fontsRoot = path.join(dataFolder, 'fonts')
  const version = path.join(fontsRoot, `test-pack-${'a'.repeat(64)}`)
  await mkdir(version, { recursive: true })
  await writeFile(
    path.join(version, 'inter.woff2'),
    await readFile(path.join('design', 'fonts', 'pack', 'inter.woff2')),
  )
  await writeFile(
    path.join(version, 'fonts.css'),
    '@font-face{font-family:"Muse UI";src:url("inter.woff2") format("woff2");font-style:normal;font-weight:400 700;font-display:swap;}',
  )
  const { imports, entry } = await buildImportMap(assetsFolder)
  runtime.assetsFolder = assetsFolder
  runtime.fontsRoot = fontsRoot
  runtime.imports = imports
  runtime.entry = entry
  runtime.axe = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
  runtime.browser = await chromium.launch({ channel: 'chrome', headless: true })
  await warmBrowser(runtime.browser)
}, COMPANION_THEME_TIMEOUT_MS)

afterAll(async () => {
  await runtime.browser?.close()
  for (const root of folders.splice(0)) await removeFolder(root)
})

/** The product page policy from runtime/companion/guard.ts secureHeaders. */
function policy(nonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

async function open(mode) {
  const browser = runtime.browser
  if (browser === undefined || runtime.entry === undefined || runtime.imports === undefined)
    throw new Error('theme fixture did not build')
  const nonce = randomBytes(32).toString('hex')
  const html = renderCompanionPage(nonce, {
    locale: 'en',
    title: USAGE_EN.title,
    stylesheets: ['/usage.css', '/theme.css', '/fonts/fonts.css'],
    modules: ['/usage.js'],
    imports: runtime.imports,
    uiTable: { locale: 'en', table: EN },
    usageTable: { type: 'usage/table', locale: 'en', table: USAGE_EN },
  })
  const context = await browser.newContext({
    viewport: { width: mode.width, height: 760 },
    colorScheme: mode.dark ? 'dark' : 'light',
  })
  // axe-core rides the automation channel, which the page policy exempts.
  await context.addInitScript({ content: runtime.axe })
  if (mode.dark) {
    await context.addInitScript((key) => {
      globalThis.localStorage.setItem(
        key,
        JSON.stringify({ mode: 'dark', ui: 'Inter', code: 'JetBrains Mono', ligatures: false }),
      )
    }, COMPANION_APPEARANCE_STORAGE_KEY)
  }
  const page = await context.newPage()
  const sheets = new Map()
  for (const sheet of ['/usage.css', '/theme.css'])
    sheets.set(sheet, await readFile(path.join(runtime.assetsFolder ?? '', sheet)))
  const fonts = new Map()
  for (const file of ['fonts.css', 'inter.woff2'])
    fonts.set(
      file,
      await readFile(path.join(runtime.fontsRoot ?? '', `test-pack-${'a'.repeat(64)}`, file)),
    )
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1') return route.abort()
    const headers = { 'content-security-policy': policy(nonce) }
    if (url.pathname === '/')
      return route.fulfill({ body: html, contentType: 'text/html', headers })
    if (url.pathname === '/usage.js')
      return route.fulfill({ body: runtime.entry, contentType: 'text/javascript', headers })
    if (sheets.has(url.pathname))
      return route.fulfill({ body: sheets.get(url.pathname), contentType: 'text/css', headers })
    if (url.pathname.startsWith('/fonts/')) {
      const file = fonts.get(url.pathname.slice('/fonts/'.length))
      if (file === undefined) return route.abort()
      return route.fulfill({
        body: file,
        contentType: url.pathname.endsWith('.css') ? 'text/css' : 'font/woff2',
        headers,
      })
    }
    // No backend in this fixture: the app's transport stays quiet.
    return route.abort()
  })
  await page.goto('http://127.0.0.1/')
  await page.waitForFunction(
    () => globalThis.document.documentElement.dataset['msTheme'] !== undefined,
  )
  return { context, page }
}

async function themeFacts(page) {
  return page.evaluate(() => ({
    mode: globalThis.document.documentElement.dataset['msTheme'],
    scheme: globalThis.getComputedStyle(globalThis.document.documentElement).colorScheme,
    font: globalThis.getComputedStyle(globalThis.document.documentElement).fontFamily,
    text: globalThis
      .getComputedStyle(globalThis.document.documentElement)
      .getPropertyValue('--ms-text')
      .trim(),
  }))
}

async function axeViolations(page) {
  return page.evaluate(async () => {
    const result = await globalThis.axe.run(globalThis.document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
    })
    return result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    }))
  })
}

describe('companion themed page in Chromium', () => {
  it(
    'mounts the dark Muse palette with the installed UI font at 320 px',
    async () => {
      const { context, page } = await open({ dark: true, width: 320 })
      try {
        const theme = await themeFacts(page)
        expect(theme.mode).toBe('dark')
        expect(theme.scheme).toBe('dark')
        // The dark Muse palette through the mounted bridge.
        expect(theme.text).toBe('#e4e7ed')
        expect(theme.font).toContain('Inter')
        await page.screenshot({ path: path.join('temp', 'c-m114-1-companion-dark-320.png') })
        expect(await axeViolations(page)).toEqual([])
      } finally {
        await context.close()
      }
    },
    COMPANION_THEME_TIMEOUT_MS,
  )
  it(
    'follows the operating system to the light palette at 690 px',
    async () => {
      const { context, page } = await open({ dark: false, width: 690 })
      try {
        const theme = await themeFacts(page)
        expect(theme.mode).toBe('light')
        expect(theme.scheme).toBe('light')
        expect(theme.text).not.toBe('')
        expect(theme.text).not.toBe('#e4e7ed')
        expect(theme.font).toContain('Inter')
        await page.screenshot({ path: path.join('temp', 'c-m114-1-companion-light-690.png') })
      } finally {
        await context.close()
      }
    },
    COMPANION_THEME_TIMEOUT_MS,
  )
})

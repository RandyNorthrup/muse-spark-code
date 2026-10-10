// M114 C-M114-1 R2: the companion page over the real launch path in Chromium.
//
// Builds the production usage entry, writes the static theme sheets and an
// installed font pack, starts the real companion server, then drives headless
// Chrome from the launch URL through /session and the authenticated bootstrap
// in all four appearance modes. Every mode waits for the Usage body to mount
// (not just the theme), asserts the mounted theme, the installed UI font and
// the rendered Usage content, and runs axe. A permanently pending Usage body
// fails the wait instead of passing an empty page (finding 3).
//
// Sandbox note: needs an unsandboxed Chrome launch; the lane rig runs this.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { EN } from '../../src/shared/l10n/en'
import { COMPANION_APPEARANCE_STORAGE_KEY } from '../../src/shared/constants'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { companionThemeCss } from '../../scripts/lib/webviewBundles.mjs'
import { openUsageCompanion } from '../../src/runtime/usage/usageCompanionEntry'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { warmBrowser } from './helpers/warmBrowser'
import { removeFolder } from './helpers/temporaryFolders'
import { FakeLogOutputChannel } from './helpers/fakes'

// Real Chromium page work under load; PLAN.md §8 (2026-10-07).
const COMPANION_THEME_TIMEOUT_MS = 30_000

const folders = []
async function folder(prefix) {
  await mkdir('temp', { recursive: true })
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  folders.push(root)
  return root
}

const runtime = {}

beforeAll(async () => {
  const dataFolder = await folder('c-m114-1-launch-')
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
  // An installed pack: the real Inter file with an installer-shaped sheet.
  const fontsRoot = path.join(dataFolder, 'fonts')
  const version = path.join(fontsRoot, `test-pack-${'a'.repeat(64)}`)
  await mkdir(version, { recursive: true })
  await writeFile(
    path.join(version, 'inter.woff2'),
    await readFile(path.join('design', 'fonts', 'pack', 'inter.woff2')),
  )
  await writeFile(
    path.join(version, 'fonts.css'),
    '@font-face{font-family:"Muse UI";src:url("inter.woff2") format("woff2");font-style:normal;font-weight:400 700;font-display:swap;unicode-range:U+0000-00FF;}',
  )
  const log = new FakeLogOutputChannel()
  const usage = createUsageAccess({
    dataFolder,
    packageRoot: process.cwd(),
    host: 'ACP',
    locale: 'en',
    uiText: EN,
    log,
  })
  runtime.server = await openUsageCompanion({
    usage,
    assetsFolder,
    locale: 'en',
    uiText: EN,
    log,
    fontsRoot,
  })
  runtime.axe = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
  runtime.browser = await chromium.launch({ channel: 'chrome', headless: true })
  await warmBrowser(runtime.browser)
}, COMPANION_THEME_TIMEOUT_MS)

afterAll(async () => {
  await runtime.server?.close()
  await runtime.browser?.close()
  for (const root of folders.splice(0)) await removeFolder(root)
})

async function open(mode) {
  const browser = runtime.browser
  const server = runtime.server
  if (browser === undefined || server === undefined) throw new Error('launch fixture did not start')
  const context = await browser.newContext({
    viewport: { width: mode.width, height: 760 },
    colorScheme: mode.dark ? 'dark' : 'light',
  })
  // axe-core rides the automation channel, which the page policy exempts.
  await context.addInitScript({ content: runtime.axe })
  if (mode.stored !== undefined) {
    await context.addInitScript(
      ({ key, appearance }) => {
        globalThis.localStorage.setItem(key, JSON.stringify(appearance))
      },
      {
        key: COMPANION_APPEARANCE_STORAGE_KEY,
        appearance: {
          mode: mode.stored,
          ui: 'Inter',
          code: 'JetBrains Mono',
          ligatures: false,
        },
      },
    )
  }
  const page = await context.newPage()
  // The real launch path: the served launch page reads its code from the
  // hash, exchanges it at /session, and installs the renderer under the
  // launch document's nonce and policy.
  await page.goto(server.launchUrl())
  await page.waitForFunction(
    () => globalThis.document.documentElement.dataset['msTheme'] !== undefined,
  )
  // The settled Usage body, never the loading fallback: the header's title
  // and subtitle render only after the lazy app mounts with its table.
  await page.waitForFunction(
    ({ title, subtitle }) => {
      const main = globalThis.document.querySelector('main.usage-page')
      const text = main?.textContent ?? ''
      return text.includes(title) && text.includes(subtitle)
    },
    { title: USAGE_EN.title, subtitle: USAGE_EN.subtitle },
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
    body: globalThis.document.querySelector('main.usage-page')?.textContent ?? '',
  }))
}

async function loadedUiFont(page) {
  return page.evaluate(async () => {
    const faces = await globalThis.document.fonts.load('14px "Muse UI"')
    return faces.length
  })
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

describe('companion page over the launch handshake in Chromium', () => {
  it(
    'mounts the dark Muse palette with the installed UI font at 320 px',
    async () => {
      const { context, page } = await open({ dark: true, stored: 'dark', width: 320 })
      try {
        const theme = await themeFacts(page)
        expect(theme.mode).toBe('dark')
        expect(theme.scheme).toBe('dark')
        // The dark Muse palette through the mounted bridge.
        expect(theme.text).toBe('#e4e7ed')
        expect(theme.font).toContain('Inter')
        expect(theme.body).toContain(USAGE_EN.title)
        expect(theme.body).toContain(USAGE_EN.subtitle)
        expect(await loadedUiFont(page)).toBeGreaterThan(0)
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
      const { context, page } = await open({ dark: false, stored: undefined, width: 690 })
      try {
        const theme = await themeFacts(page)
        expect(theme.mode).toBe('light')
        expect(theme.scheme).toBe('light')
        expect(theme.text).toBe('#252932')
        expect(theme.font).toContain('Inter')
        expect(theme.body).toContain(USAGE_EN.title)
        expect(theme.body).toContain(USAGE_EN.subtitle)
        expect(await loadedUiFont(page)).toBeGreaterThan(0)
        await page.screenshot({ path: path.join('temp', 'c-m114-1-companion-light-690.png') })
        expect(await axeViolations(page)).toEqual([])
      } finally {
        await context.close()
      }
    },
    COMPANION_THEME_TIMEOUT_MS,
  )
  it(
    'mounts the high-contrast dark palette with its Usage body',
    async () => {
      const { context, page } = await open({ dark: true, stored: 'hc-dark', width: 690 })
      try {
        const theme = await themeFacts(page)
        expect(theme.mode).toBe('hc-dark')
        expect(theme.text).toBe('#fff')
        expect(theme.body).toContain(USAGE_EN.title)
        expect(theme.body).toContain(USAGE_EN.subtitle)
        expect(await loadedUiFont(page)).toBeGreaterThan(0)
        await page.screenshot({ path: path.join('temp', 'c-m114-1-companion-hc-dark-690.png') })
        expect(await axeViolations(page)).toEqual([])
      } finally {
        await context.close()
      }
    },
    COMPANION_THEME_TIMEOUT_MS,
  )
  it(
    'mounts the high-contrast light palette with its Usage body',
    async () => {
      const { context, page } = await open({ dark: false, stored: 'hc-light', width: 690 })
      try {
        const theme = await themeFacts(page)
        expect(theme.mode).toBe('hc-light')
        expect(theme.text).toBe('#000')
        expect(theme.body).toContain(USAGE_EN.title)
        expect(theme.body).toContain(USAGE_EN.subtitle)
        expect(await loadedUiFont(page)).toBeGreaterThan(0)
        await page.screenshot({ path: path.join('temp', 'c-m114-1-companion-hc-light-690.png') })
        expect(await axeViolations(page)).toEqual([])
      } finally {
        await context.close()
      }
    },
    COMPANION_THEME_TIMEOUT_MS,
  )
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'

const consumer = JSON.parse(readFileSync('design/tokens/generated/consumers.json', 'utf8'))
const modes = ['light', 'dark', 'hc-light', 'hc-dark']
const runtime = {}
const fixture = `
import './src/webview/styles.css';
import {loadThemeBridge} from './src/webview/bridges/theme/loadThemeBridge';
let snapshot = {mode:'dark', roles:{}};
let receive;
const controller = new AbortController();
globalThis.theme = {
  change(value) { snapshot = value; receive(value); },
  stop() { controller.abort(); },
  invalid: 0, unsubscribed: 0,
};
const port = {current: () => snapshot, subscribe(fn) {
  receive = fn;
  return () => { globalThis.theme.unsubscribed++; };
}};
await loadThemeBridge(globalThis.document.querySelector('main'), port,
  () => { globalThis.theme.invalid++; }, controller.signal);
globalThis.theme.ready = true;
`
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'none'">
<title>Theme fixture</title><link rel="stylesheet" href="/fixture.css"></head><body>
<main><section class="composer"><label for="draft">Prompt</label><textarea id="draft" class="composer-input"></textarea>
<button class="button-primary">Send</button><button class="button-secondary" disabled>Disabled</button>
<pre><code>code</code></pre></section></main><aside>Sibling</aside>
<script type="module" src="/fixture.js"></script></body></html>`

beforeAll(async () => {
  const result = await build({
    stdin: { contents: fixture, resolveDir: process.cwd(), sourcefile: 'fixture.js' },
    outdir: path.resolve('temp/m114-c-browser'),
    entryNames: 'fixture',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome128',
    minify: true,
    metafile: true,
    write: false,
  })
  runtime.meta = result.metafile
  runtime.assets = new Map(
    result.outputFiles.map((file) => [
      `/${path.relative(path.resolve('temp/m114-c-browser'), file.path).replaceAll('\\', '/')}`,
      file.text,
    ]),
  )
  const chrome = findChrome()
  if (!chrome) throw new Error('Chrome is required for theme consumer verification')
  runtime.browser = await chromium.launch(
    path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
  )
})
afterAll(async () => {
  await runtime.browser?.close()
})

async function open(preferences = {}) {
  const page = await runtime.browser.newPage({
    viewport: { width: 320, height: 760 },
    ...preferences,
  })
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    const content = url.pathname === '/' ? html : runtime.assets.get(url.pathname)
    if (content === undefined || url.hostname !== '127.0.0.1') return route.abort()
    let contentType = 'text/javascript'
    if (url.pathname === '/') contentType = 'text/html'
    else if (url.pathname.endsWith('.css')) contentType = 'text/css'
    return route.fulfill({ body: content, contentType })
  })
  await page.goto('http://127.0.0.1/')
  await page.waitForFunction(() => globalThis.theme?.ready)
  return page
}

async function change(page, mode, roles = {}) {
  await page.evaluate((snapshot) => globalThis.theme.change(snapshot), { mode, roles })
}

async function facts(page) {
  return page.evaluate(() => {
    const root = globalThis.document.querySelector('main')
    const computed = globalThis.getComputedStyle(root)
    const tokens = Object.fromEntries(
      [...computed]
        .filter((key) => key.startsWith('--ms-'))
        .map((key) => [key, computed.getPropertyValue(key).trim()]),
    )
    const button = globalThis.getComputedStyle(globalThis.document.querySelector('button'))
    return {
      tokens,
      colour: computed.color,
      surface: computed.backgroundColor,
      font: computed.fontFamily,
      size: computed.fontSize,
      button: button.backgroundColor,
      shadow: button.boxShadow,
      blur: button.backdropFilter,
      scheme: computed.colorScheme,
      invalid: globalThis.theme.invalid,
      overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    }
  })
}

describe('M114 companion/native theme CSS in Chromium (internal port fakes)', () => {
  it('isolates the lazy JavaScript closure and CSS, with separate unchanged measured caps', () => {
    const outputs = Object.entries(runtime.meta.outputs)
    const startup = outputs.find(([name]) => name.replaceAll('\\', '/').endsWith('/fixture.js'))[1]
    expect(startup.imports.some((entry) => entry.kind === 'dynamic-import')).toBe(true)
    expect(
      Object.keys(startup.inputs).some((name) =>
        /themeBridge\.ts|consumers\.json|zod/.test(name.replaceAll('\\', '/')),
      ),
    ).toBe(false)
    const lazyJs = outputs.filter(
      ([name]) => name.endsWith('.js') && !name.replaceAll('\\', '/').endsWith('/fixture.js'),
    )
    const lazyCss = outputs.filter(
      ([name]) => name.endsWith('.css') && !name.replaceAll('\\', '/').endsWith('/fixture.css'),
    )
    expect(lazyJs.length).toBeGreaterThan(0)
    expect(lazyCss.length).toBeGreaterThan(0)
    const jsBytes = lazyJs.reduce((sum, [, output]) => sum + output.bytes, 0)
    const cssBytes = lazyCss.reduce((sum, [, output]) => sum + output.bytes, 0)
    expect(jsBytes).toBeLessThanOrEqual(25 * 1024)
    expect(cssBytes).toBeLessThanOrEqual(25 * 1024)
    expect(lazyJs.flatMap(([, output]) => Object.keys(output.inputs))).toContain(
      'design/tokens/generated/consumers.json',
    )
    const js = lazyJs
      .map(([name]) =>
        runtime.assets.get(
          `/${path.relative(path.resolve('temp/m114-c-browser'), path.resolve(name)).replaceAll('\\', '/')}`,
        ),
      )
      .join('\n')
    expect(js).not.toMatch(/colorSpace|contrastPairs|#181818|@font-face|https?:/)
    console.info(
      `M114 C lazy closure: ${jsBytes} JavaScript bytes; ${cssBytes} CSS bytes (25 KiB each)`,
    )
  })

  it.each(modes)(
    'companion %s uses the generated palette and installed-font stack at 320 px',
    async (mode) => {
      const page = await open()
      try {
        await change(page, mode)
        const measured = await facts(page)
        // Production CSS shortens hex, durations and whitespace. Compare the
        // actual CSS values through the browser's parser, never raw spellings.
        const pairs = await page.evaluate(
          ({ hostRoles, palette, tokens }) => {
            const probe = globalThis.document.createElement('span').style
            return Object.entries(hostRoles).map(([key, { variable }]) => {
              let property = 'color'
              if (key.startsWith('typography.')) {
                property = key.endsWith('size') ? 'font-size' : 'font-family'
              }
              const normalize = (value) => {
                probe.removeProperty(property)
                probe.setProperty(property, value)
                const parsed = probe.getPropertyValue(property)
                // CSS font-family matching is case-insensitive; esbuild lowers
                // unquoted family identifiers such as Inter in production.
                return property === 'font-family' ? parsed.toLowerCase() : parsed
              }
              const expected = palette[key].css.replaceAll(
                /var\((--ms-[a-z-]+)\)/g,
                (_, name) => tokens[name],
              )
              return { key, actual: normalize(tokens[variable]), expected: normalize(expected) }
            })
          },
          { hostRoles: consumer.hostRoles, palette: consumer.modes[mode], tokens: measured.tokens },
        )
        for (const { key, actual, expected } of pairs) {
          expect(expected, key).not.toBe('')
          expect(actual, key).toBe(expected)
        }
        expect(measured.font.toLowerCase()).toContain('inter')
        expect(measured.tokens['--ms-font-code'].toLowerCase()).toContain('jetbrains mono')
        expect(measured.scheme).toBe(mode.endsWith('light') ? 'light' : 'dark')
        expect(measured.invalid).toBe(0)
        expect(measured.overflow).toBe(false)
      } finally {
        await page.close()
      }
    },
  )

  it.each(['JCEF', 'WebView2', 'SWT'])(
    '%s port renders captured host colours and editor fonts in all four modes',
    async () => {
      const page = await open()
      try {
        for (const mode of modes) {
          const captured = JSON.parse(readFileSync(`test/harness/themes/${mode}.json`, 'utf8'))
          const roles = Object.fromEntries(
            Object.entries(consumer.hostRoles).flatMap(([key, { vscode }]) => {
              const value = vscode
                .map((variable) => captured.variables[variable])
                .find((value) => value !== undefined)
              return value === undefined ? [] : [[key, value]]
            }),
          )
          Object.assign(roles, {
            'typography.font-ui': 'Arial, sans-serif',
            'typography.font-code': 'Consolas, monospace',
            'typography.font-size': '15px',
            'typography.code-size': '14px',
          })
          await change(page, mode, roles)
          const measured = await facts(page)
          for (const [key, value] of Object.entries(roles))
            expect(measured.tokens[consumer.hostRoles[key].variable], key).toBe(value)
          expect(measured.font).toBe('Arial, sans-serif')
          expect(measured.size).toBe('15px')
          expect(measured.blur).toBe('none')
          expect(measured.invalid).toBe(0)
          expect(measured.overflow).toBe(false)
        }
      } finally {
        await page.close()
      }
    },
  )

  it.each([
    { reducedMotion: 'reduce' },
    { reducedMotion: 'no-preference' },
    { contrast: 'more' },
    { forcedColors: 'active' },
  ])(
    'preserves generated accessibility preferences %j across theme changes',
    async (preferences) => {
      const page = await open(preferences)
      try {
        for (const mode of modes) {
          await change(page, mode, { 'colour.shadow': '#12345680' })
          const { tokens, blur } = await facts(page)
          const flat =
            mode.startsWith('hc-') ||
            preferences.contrast === 'more' ||
            preferences.forcedColors === 'active'
          if (flat) {
            for (const level of ['raised', 'popover', 'overlay'])
              expect(tokens[`--ms-elevation-${level}`]).toBe('none')
            expect(tokens['--ms-overlay-alpha']).toBe('1')
            expect(Number(tokens['--ms-backdrop-blur'].replaceAll('px', ''))).toBe(0)
          }
          const duration = tokens['--ms-motion-base']
          const milliseconds =
            Number(duration.replace(/m?s$/, '')) * (duration.endsWith('ms') ? 1 : 1000)
          expect(milliseconds).toBe(preferences.reducedMotion === 'reduce' ? 0 : 180)
          expect(blur).toBe('none')
        }
      } finally {
        await page.close()
      }
    },
  )

  it('preserves reduced transparency through the real preference media query', async () => {
    const page = await open()
    try {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
      })
      for (const mode of modes) {
        await change(page, mode)
        const { tokens } = await facts(page)
        expect(tokens['--ms-overlay-alpha']).toBe('1')
        expect(tokens['--ms-backdrop-blur']).toBe('0')
      }
    } finally {
      await page.close()
    }
  })

  it('theme changes preserve keyboard focus, IME events and the typed draft', async () => {
    const page = await open()
    try {
      const draft = page.locator('textarea')
      await draft.focus()
      await draft.fill('draft')
      await draft.dispatchEvent('compositionstart', { data: '字' })
      await change(page, 'hc-light', { 'colour.text': '#112233' })
      await draft.dispatchEvent('compositionend', { data: '字' })
      expect(await draft.inputValue()).toBe('draft')
      expect(await draft.evaluate((element) => element === globalThis.document.activeElement)).toBe(
        true,
      )
      await page.keyboard.press('Tab')
      expect(
        await page
          .locator('button')
          .first()
          .evaluate((element) => element === globalThis.document.activeElement),
      ).toBe(true)
      await page.evaluate(() => globalThis.theme.stop())
      expect(await page.evaluate(() => globalThis.theme.unsubscribed)).toBe(1)
    } finally {
      await page.close()
    }
  })
})

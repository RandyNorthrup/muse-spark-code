import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import {
  assertFontBundleSplit,
  assertNoVsixFonts,
  fontNotices,
} from '../../scripts/notices-fonts.mjs'
import { sharedUiText, sharedValidation } from '../../scripts/lib/deferredBundles.mjs'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { warmBrowser } from './helpers/warmBrowser'

const state = {}
beforeAll(async () => {
  state.root = await mkdtemp(path.join(tmpdir(), 'm114-font-pack-'))
  state.manifest = JSON.parse(await readFile('design/fonts/manifest.json', 'utf8'))
  const out = path.join(state.root, 'fontsInstall.cjs')
  const fontsBuild = await build({
    metafile: true,
    entryPoints: ['src/runtime/fonts/fontsEntry.ts'],
    outfile: out,
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    plugins: [sharedUiText, sharedValidation],
    logLevel: 'silent',
  })
  state.metafile = fontsBuild.metafile
  // Build the real shared API/fallback once; CI's unit gate runs before production build.
  await build({
    entryPoints: ['src/shared/validationEntry.ts'],
    outfile: path.join(state.root, 'validation.js'),
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  await build({
    entryPoints: ['src/shared/l10n/en.ts'],
    outfile: path.join(state.root, 'uiText.js'),
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
  state.bundle = createRequire(out)(out)
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome required for WOFF2 decode verification')
  state.browser = await chromium.launch({
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    headless: true,
    args: ['--no-sandbox'],
  })
})
// Browser-wide first-page work once, under this hook's own limit (CIFIX017).
beforeAll(async () => {
  await warmBrowser(state.browser)
})
afterAll(async () => {
  await state.browser?.close()
  if (state.root !== undefined) await rm(state.root, { recursive: true, force: true })
})

describe('D94 font pack, notices and runtime-only packaging', () => {
  it('lists all four OFL fonts and verifies every pinned WOFF2/licence byte', async () => {
    const notices = await fontNotices()
    expect(notices.map((font) => font.name)).toEqual(
      state.manifest.fonts.map((font) => `${font.family} (optional subset font pack)`),
    )
    for (const font of notices) {
      expect(font.licence).toBe('OFL-1.1')
      expect(font.text).toContain('SIL OPEN FONT LICENSE Version 1.1')
      expect(font.url).toContain('/releases/download/')
    }
    const sources = JSON.parse(await readFile('design/fonts/sources.json', 'utf8'))
    expect(sources.fonts.map((font) => font.cssFamily)).toEqual(
      state.manifest.fonts.map((font) => font.cssFamily),
    )
    for (const font of state.manifest.fonts) {
      for (const asset of [font.font, font.notice]) {
        const bytes = await readFile(path.join('design/fonts/pack', asset.file))
        expect(bytes.length).toBe(asset.bytes)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
        expect(asset.url).toMatch(/\/52af8cef94b221a3dc5ec1319d32b4c3e5f8ff30\//)
      }
    }
  })

  it('rejects altered font and licence assets in the notices gate', async () => {
    for (const asset of [state.manifest.fonts[0].font, state.manifest.fonts[0].notice]) {
      const root = path.join(state.root, asset.file)
      await cp('design/fonts', path.join(root, 'design/fonts'), { recursive: true })
      const file = path.join(root, 'design/fonts/pack', asset.file)
      const data = await readFile(file)
      data[data.length - 1] ^= 1
      await writeFile(file, data)
      await expect(fontNotices(root)).rejects.toThrow('verification')
    }
  })

  it('rejects a font or its runtime installer anywhere in a VSIX listing, including Windows paths', () => {
    expect(() =>
      assertNoVsixFonts(['dist/webview/main.js', 'THIRD_PARTY_NOTICES.txt']),
    ).not.toThrow()
    for (const file of [
      'design/fonts/pack/inter.woff2',
      'media/font.WOFF',
      'dist/font.ttf',
      'dist/font.otf',
      'dist/font.eot',
      String.raw`dist\fontsInstall.js`,
      String.raw`design\fonts\manifest.json`,
    ])
      expect(() => assertNoVsixFonts(['dist/webview/main.js', file])).toThrow(
        'must not enter the VSIX',
      )
  })

  it('guards the font implementation split from ACP startup, normalizing Windows inputs', () => {
    const startup = { inputs: { 'src/runtime/main.ts': {} } }
    expect(() => assertFontBundleSplit(startup, state.metafile)).not.toThrow()
    const lazyWindows = {
      inputs: Object.fromEntries(
        Object.entries(state.metafile.inputs).map(([file, info]) => [
          file.replaceAll('/', '\\'),
          info,
        ]),
      ),
    }
    expect(() => assertFontBundleSplit(startup, lazyWindows)).not.toThrow()
    expect(() =>
      assertFontBundleSplit(
        { inputs: { ...startup.inputs, 'src\\runtime\\fonts\\install.ts': {} } },
        state.metafile,
      ),
    ).toThrow('entered ACP startup')
    expect(() => assertFontBundleSplit(startup, { inputs: {} })).toThrow('lost its implementation')
  })

  it('loads the compiled lazy installer with shared validation and installs the real offline pack', async () => {
    const { EN } = createRequire(path.join(state.root, 'uiText.js'))('./uiText.js')
    const result = await state.bundle.installFonts(
      {
        manifest: state.manifest,
        directory: path.join(state.root, 'installed'),
        sourceDirectory: path.resolve('design/fonts/pack'),
        fetch: () => {
          throw new Error('Offline install made a network request')
        },
      },
      EN,
      'en',
    )
    const css = await readFile(path.join(result, 'fonts.css'), 'utf8')
    for (const font of state.manifest.fonts) {
      expect(css).toContain(`font-family:"${font.cssFamily}"`)
      expect(css).toContain(`font-weight:${font.weight}`)
      expect(css).toContain(`url("${font.font.file}")`)
    }
    expect(css).not.toContain('http')
    expect(JSON.parse(await readFile(path.join(result, 'manifest.json'), 'utf8'))).toEqual(
      state.manifest,
    )
  })

  it('binds every selected family to its installed alias while keeping original/system stacks first', () => {
    for (const font of state.manifest.fonts) {
      const values = new Map()
      state.bundle.applyFontPreferences(
        {
          ui: 'Inter',
          code: font.family === 'Inter' ? 'JetBrains Mono' : font.family,
          ligatures: false,
        },
        'standalone',
        {
          uiFallback: 'sans-serif',
          codeFallback: 'monospace',
          setProperty: (key, value) => values.set(key, value),
        },
      )
      const role = font.family === 'Inter' ? '--ms-font-ui' : '--ms-font-code'
      expect(values.get(role)).toBe(
        `"${font.family}", "${font.cssFamily}", ${font.family === 'Inter' ? 'sans-serif' : 'monospace'}`,
      )
    }
  })

  it('decodes all four real WOFF2 subsets in Chromium at normal and bold weights', async () => {
    const page = await state.browser.newPage()
    try {
      const fonts = await Promise.all(
        state.manifest.fonts.map(async (font) => {
          const data = await readFile(path.join('design/fonts/pack', font.font.file))
          return { ...font, base64: data.toString('base64') }
        }),
      )
      const loaded = await page.evaluate(async (fonts) => {
        const results = []
        for (const font of fonts) {
          const face = new globalThis.FontFace(
            font.cssFamily,
            `url(data:font/woff2;base64,${font.base64})`,
            {
              weight: font.weight,
              unicodeRange: font.unicodeRange,
            },
          )
          await face.load()
          globalThis.document.fonts.add(face)
          const normal = await globalThis.document.fonts.load(
            `400 16px "${font.cssFamily}"`,
            'Code -> != α Ж',
          )
          const bold = await globalThis.document.fonts.load(
            `700 16px "${font.cssFamily}"`,
            'Code -> != α Ж',
          )
          results.push({
            family: face.family.replaceAll(/^"|"$/g, ''),
            status: face.status,
            normal: normal.length,
            bold: bold.length,
          })
        }
        return results
      }, fonts)
      expect(loaded).toEqual(
        state.manifest.fonts.map((font) => ({
          family: font.cssFamily,
          status: 'loaded',
          normal: 1,
          bold: 1,
        })),
      )
    } finally {
      await page.close()
    }
  })

  it('keeps the panel mapped to its editor fonts without remote faces', async () => {
    const css = await readFile('src/webview/tokens.css', 'utf8')
    expect(css).toContain('--ms-font-ui: var(--vscode-font-family')
    expect(css).toMatch(/--ms-font-code:\s*var\(\s*--vscode-editor-font-family/)
    const styles = await readFile('src/webview/styles.css', 'utf8')
    expect(css + styles).not.toContain('@font-face')
  })
})

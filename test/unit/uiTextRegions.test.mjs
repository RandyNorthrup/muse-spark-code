import { Buffer } from 'node:buffer'
// Exercise the real generated Node fallback and localization state.
import { readFileSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import {
  UI_TEXT_REGIONS,
  regionalUiText,
  uiTextProperties,
  compactBrowserEnglish,
  compressedReference,
} from '../../scripts/lib/uiTextRegions.mjs'

import { removeFolder } from './helpers/temporaryFolders'

const built = { textSource: '', folder: '', browserSource: '' }
beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-regional-english-'))
  // One parallel batch: these builds are independent, and running them one
  // after another made the suite slow enough to time out under a loaded
  // full run. The browser build feeds the inline round-trip test below.
  const regions = [{ name: undefined, output: 'dist/uiText.js' }, ...UI_TEXT_REGIONS]
  const [browser] = await Promise.all([
    build({
      entryPoints: ['src/shared/l10n/en.ts'],
      bundle: true,
      write: false,
      minify: true,
      platform: 'browser',
      format: 'esm',
      plugins: [compactBrowserEnglish],
    }),
    ...regions.map((region) =>
      build({
        entryPoints: ['src/shared/l10n/en.ts'],
        bundle: true,
        minify: true,
        outfile: path.join(built.folder, path.basename(region.output)),
        platform: 'node',
        format: 'cjs',
        target: 'node20.18',
        plugins: [regionalUiText(region.name)],
      }),
    ),
  ])
  built.browserSource = browser.outputFiles[0].text
  const result = await build({
    entryPoints: ['src/shared/l10n/text.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    plugins: [
      {
        name: 'test-shared-english',
        setup(builder) {
          builder.onResolve({ filter: /^\.\/en$/ }, () => ({ path: './uiText.js', external: true }))
        },
      },
    ],
  })
  built.textSource = result.outputFiles[0].text
})

afterAll(() => removeFolder(built.folder))

it('selects the canonical English input on POSIX and Windows paths', () => {
  let filter
  regionalUiText().setup({
    onResolve: vi.fn(),
    onLoad(options) {
      filter = options.filter
    },
  })
  expect(filter.test('/project/src/shared/l10n/en.ts')).toBe(true)
  expect(filter.test(path.win32.join('C:', 'project', 'src', 'shared', 'l10n', 'en.ts'))).toBe(true)
  expect(filter.test('/project/l10n/ui.de.json')).toBe(false)
})

function evaluate(source, file, require) {
  const module = { exports: {} }
  const run = vm.compileFunction(
    source,
    ['require', 'module', 'exports', '__dirname', '__filename'],
    { filename: file },
  )
  run(require, module, module.exports, path.dirname(file), file)
  return module.exports
}

function fallback() {
  const file = path.join(built.folder, 'uiText.js')
  const require = createRequire(file)
  const loaded = []
  const bundle = evaluate(readFileSync(file, 'utf8'), file, (name) => {
    loaded.push(name)
    return require(name)
  })
  const text = evaluate(built.textSource, path.join(built.folder, 'text-test.js'), (name) => {
    expect(name).toBe('./uiText.js')
    return bundle
  })
  return { bundle, text, loaded }
}

describe('regional Node English fallback', () => {
  it('loads media English only on first media use and installs the caller language', () => {
    const { text, loaded } = fallback()
    expect(loaded).toEqual([])
    expect(text.UI_TEXT.media.recordingFailed).toBe(EN.media.recordingFailed)
    expect(loaded).toEqual(['./uiTextMedia.js'])
    const german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
    text.setUiText(german, 'de')
    expect(text.UI_TEXT.media.recordingFailed).toBe(german.media.recordingFailed)
    expect(loaded).toEqual(['./uiTextMedia.js'])
  })

  it('enumerates every key and creates localization state without loading a region', () => {
    const { bundle, text, loaded } = fallback()
    expect(Object.keys(bundle.EN).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
      Object.keys(EN).toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    expect(Object.keys(text.UI_TEXT).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
      Object.keys(EN).toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    expect(loaded).toEqual([])
    expect(text.UI_TEXT.actionFailed).toBe(EN.actionFailed)
    expect(loaded).toEqual([])
    expect(text.UI_TEXT.execBudgetRequired).toBe(EN.execBudgetRequired)
    expect(loaded).toEqual(['./uiTextRuntime.js'])
  })

  it('serializes exactly the canonical table, including plurals and nested labels', () => {
    const { bundle, text, loaded } = fallback()
    const serializedEnglish = JSON.stringify(bundle.EN)
    expect(JSON.parse(serializedEnglish)).toEqual(EN)
    const serializedState = JSON.stringify(text.UI_TEXT)
    expect(JSON.parse(serializedState)).toEqual(EN)
    expect(new Set(loaded)).toEqual(
      new Set(UI_TEXT_REGIONS.map((region) => `./${path.basename(region.output)}`)),
    )
    const properties = uiTextProperties()
    expect(properties).toHaveLength(Object.keys(EN).length)
    const require = createRequire(path.join(built.folder, 'uiText.js'))
    for (const region of UI_TEXT_REGIONS) {
      const regional = require(path.join(built.folder, path.basename(region.output))).EN
      expect(Object.keys(regional).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
        properties
          .filter((property) => property.region === region.name)
          .map((property) => property.key)
          .toSorted((a, b) => a.localeCompare(b, 'en')),
      )
    }
  })

  it('installs and resets a full translated table with independent language state', () => {
    const a = fallback()
    const b = fallback()
    const german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
    a.text.setUiText(german, 'de')
    expect(a.text.UI_TEXT).toEqual(german)
    expect(a.text.formatNumber(1234)).toBe('1.234')
    expect(a.text.uiLocale()).toBe('de')
    expect(a.loaded).toEqual([])
    expect(b.text.uiLocale()).toBe('en')
    expect(b.text.UI_TEXT.execBudgetRequired).toBe(EN.execBudgetRequired)
    a.text.setUiText(a.bundle.EN, 'en')
    expect(a.text.uiLocale()).toBe('en')
    const serializedState = JSON.stringify(a.text.UI_TEXT)
    expect(JSON.parse(serializedState)).toEqual(EN)
  })
})

it('round-trips every browser English key, value and plural form inline', async () => {
  const bundle = await import(
    `data:text/javascript;base64,${Buffer.from(built.browserSource).toString('base64')}`
  )
  expect(bundle.EN).toEqual(EN)
  expect(JSON.stringify(bundle.EN)).toBe(JSON.stringify(EN))
  expect(built.browserSource).toContain('DecompressionStream')
  expect(built.browserSource).not.toContain('import(')
})

it('round-trips every production Node reference field through the native codec', async () => {
  const result = await build({
    entryPoints: ['src/shared/reference/reference.generated.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    minify: true,
    plugins: [compressedReference(true)],
  })
  const module = { exports: {} }
  const actual = vm.runInNewContext(
    `${result.outputFiles[0].text}\nmodule.exports.referenceModel()`,
    {
      module,
      exports: module.exports,
      require: createRequire(import.meta.url),
    },
  )
  expect(actual).toEqual(
    JSON.parse(readFileSync('src/shared/reference/reference.generated.json', 'utf8')),
  )
  expect(result.outputFiles[0].text).toContain('brotliDecompressSync')
})

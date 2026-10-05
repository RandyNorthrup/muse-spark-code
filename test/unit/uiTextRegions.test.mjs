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
} from '../../scripts/lib/uiTextRegions.mjs'

import { removeFolder } from './helpers/temporaryFolders'

const built = { textSource: '', folder: '' }
beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-regional-english-'))
  for (const region of [{ name: undefined, output: 'dist/uiText.js' }, ...UI_TEXT_REGIONS]) {
    await build({
      entryPoints: ['src/shared/l10n/en.ts'],
      bundle: true,
      minify: true,
      outfile: path.join(built.folder, path.basename(region.output)),
      platform: 'node',
      format: 'cjs',
      target: 'node20.18',
      plugins: [regionalUiText(region.name)],
    })
  }
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

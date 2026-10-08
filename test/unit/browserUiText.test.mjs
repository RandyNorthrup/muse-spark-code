import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadL10n } from '../../scripts/lib/l10nSource.mjs'
import { browserTextKeys, compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { removeFolder } from './helpers/temporaryFolders'

const entries = {
  main: 'src/webview/main.tsx',
  models: 'src/webview/models/models.tsx',
  usage: 'src/webview/usage/usage.tsx',
  referencePage: 'src/webview/components/ReferencePage.tsx',
  whatsNew: 'src/webview/whatsNew/main.ts',
  resourceSurface: 'src/webview/resources/ResourceSurface.tsx',
  resourceHistory: 'src/webview/usage/ResourcesSection.tsx',
}
const fixture = { folder: '', canonical: undefined, browser: undefined, keys: undefined }
const byText = (left, right) => left.localeCompare(right)

beforeAll(async () => {
  fixture.folder = mkdtempSync(path.resolve('temp/train15h-english-'))
  writeFileSync(path.join(fixture.folder, 'package.json'), '{"type":"module"}')
  const english = path.resolve('src/shared/l10n/en.ts').replaceAll('\\', '/')
  const text = path.resolve('src/shared/l10n/text.ts').replaceAll('\\', '/')
  const installer = path.resolve('src/webview/installTable.ts').replaceAll('\\', '/')
  const probe = path.join(fixture.folder, 'probe.ts')
  writeFileSync(
    probe,
    `
export { EN, EN_SHAPE } from '${english}';
export { UI_TEXT, setUiText, uiLocale } from '${text}';
export { installEmbeddedTable } from '${installer}';
export async function loadPalette() { return await import('../../src/shared/paletteRegistry') }
export async function loadHelp() { await Promise.all([import('browser-surface-english'), import('browser-reference-english'), import('browser-account-english')]) }
export async function loadResources() { await import('browser-resource-english') }
export async function loadAccounts() { await import('../../src/webview/models/sections/accounts/accountsEntry') }
export async function loadDeveloper() { await import('../../src/webview/developer/DeveloperOptionsPage') }
`,
  )
  fixture.canonical = await loadL10n(process.cwd())
  fixture.keys = browserTextKeys([...Object.values(entries), probe], fixture.canonical.EN).keys
  await build({
    entryPoints: { ...entries, probe },
    outdir: path.join(fixture.folder, 'dist'),
    bundle: true,
    splitting: true,
    minify: true,
    platform: 'browser',
    format: 'esm',
    target: 'esnext',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [compactBrowserUiText],
    logLevel: 'silent',
  })
  fixture.browser = await import(pathToFileURL(path.join(fixture.folder, 'dist/probe.js')).href)
  // Real shared ESM construction and native DEFLATE decoding belong to setup.
}, 120_000)

afterAll(async () => {
  if (fixture.folder !== '') await removeFolder(fixture.folder)
})

describe('the production browser English and full-table contract', () => {
  it('keeps unreachable Help prose outside a standalone account graph', () => {
    const source = path.join(fixture.folder, 'accounts-only.ts')
    writeFileSync(source, 'const label = UI_TEXT.accounts;')
    const { keys } = browserTextKeys([source], fixture.canonical.EN)
    expect([...keys]).toEqual(['accounts'])
  })

  it('loads surface English on demand, retaining every browser value and installed language', async () => {
    const accountKeys = browserTextKeys(
      [
        'src/webview/models/sections/accounts/accountsEntry.ts',
        'src/webview/developer/DeveloperOptionsPage.tsx',
      ],
      fixture.canonical.EN,
    ).keys
    for (const key of accountKeys) expect(fixture.keys.has(key), key).toBe(true)
    const { EN: canonical } = fixture.canonical
    const { EN, UI_TEXT, setUiText, uiLocale, loadHelp, loadPalette, loadResources } =
      fixture.browser
    expect(Object.keys(EN).toSorted(byText)).toEqual([...fixture.keys].toSorted(byText))
    expect(Object.hasOwn(EN, 'execBudgetRequired')).toBe(false)
    expect(EN.composerLabel).toBe(canonical.composerLabel)
    expect(() => EN.referenceSearch).toThrow('English surface is not loaded')
    expect(() => EN.accounts).toThrow('English surface is not loaded')
    const german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
    const palette = await loadPalette()
    const paletteContext = {
      currentModel: undefined,
      models: [],
      effort: 'high',
      isThinkingEnabled: true,
      permissionMode: 'manual',
      isFocusView: false,
      useCtrlEnterToSend: false,
      usage: undefined,
      skills: [],
      backend: 'modelApi',
      paidFeatures: [],
      isKeyStored: false,
    }
    const groups = palette.buildPalette(paletteContext)
    expect(groups.flatMap((group) => group.items).find((item) => item.id === 'compact').label).toBe(
      canonical.compactItem,
    )
    setUiText(german, 'de')
    expect(
      palette
        .buildPalette(paletteContext)
        .flatMap((group) => group.items)
        .find((item) => item.id === 'compact').label,
    ).toBe(german.compactItem)
    await loadHelp()
    expect(EN.referenceSearch).toEqual(canonical.referenceSearch)
    expect(() => EN.resourceShow).toThrow('English surface is not loaded')
    await loadResources()
    const resourceKeys = browserTextKeys(
      [entries.resourceSurface, entries.resourceHistory],
      canonical,
    ).keys
    for (const key of resourceKeys) expect(EN[key], key).toEqual(canonical[key])
    expect(UI_TEXT.resourceTitle).toBe(german.resourceTitle)
    for (const key of fixture.keys) expect(EN[key], key).toEqual(canonical[key])
    expect(UI_TEXT.referenceSearch).toBe(german.referenceSearch)
    expect(uiLocale()).toBe('de')
    setUiText(EN, 'en')
    expect(UI_TEXT.referenceCliOptions).toEqual(canonical.referenceCliOptions)
  })

  it('checks every installed language against the same complete canonical shape and slots', () => {
    const { EN, TABLE_LOCALES, tableFileName, tableProblems } = fixture.canonical
    const { EN_SHAPE, installEmbeddedTable } = fixture.browser
    const options = { locale: 'en', isStrict: false }
    const broken = [
      { ...EN, execBudgetRequired: undefined },
      { ...EN, extra: 'unexpected' },
      { ...EN, execBudgetRequired: '{unknown}' },
      { ...EN, toolLabels: { ...EN.toolLabels, shell: undefined } },
      { ...EN, todoProgress: '{unknown}' },
      { ...EN, stepSummary: { ...EN.stepSummary, other: undefined } },
      { ...EN, composerLabel: 1 },
    ]
    for (const table of broken) {
      const expected = tableProblems(EN, table, options)
      expect(expected.length).toBeGreaterThan(0)
      expect(tableProblems(EN_SHAPE, table, options)).toEqual(expected)
    }
    for (const locale of TABLE_LOCALES) {
      const table = JSON.parse(readFileSync(path.join('l10n', tableFileName(locale)), 'utf8'))
      expect(tableProblems(EN_SHAPE, table, { locale, isStrict: false }), locale).toEqual(
        tableProblems(EN, table, { locale, isStrict: false }),
      )
      expect(
        installEmbeddedTable({
          querySelector: () => ({ textContent: JSON.stringify({ locale, table }) }),
        }),
        locale,
      ).toBeUndefined()
    }
    expect(
      installEmbeddedTable({
        querySelector: () => ({ textContent: JSON.stringify({ locale: 'en', table: broken[0] }) }),
      })?.message,
    ).toContain('execBudgetRequired: missing')
  })

  it('does not eagerly load an English group for a technical command word', () => {
    const source = path.join(fixture.folder, 'technical-group.ts')
    writeFileSync(source, "export const command = 'vault'")
    expect(
      browserTextKeys([source], fixture.canonical.EN, new Set([source])).eagerKeys.has('vault'),
    ).toBe(false)
    writeFileSync(source, 'export function label(){ return UI_TEXT.vault.title }')
    expect(
      browserTextKeys([source], fixture.canonical.EN, new Set([source])).eagerKeys.has('vault'),
    ).toBe(true)
  })

  it('refuses an unregistered computed text reader before emitting a fallback', () => {
    const source = path.join(fixture.folder, 'computed.ts')
    writeFileSync(source, 'const key="composerLabel"; const value=UI_TEXT[key]')
    expect(() => browserTextKeys([source], fixture.canonical.EN)).toThrow(
      'Unregistered dynamic browser text reader',
    )
  })
})

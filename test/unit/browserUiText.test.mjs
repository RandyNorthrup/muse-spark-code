import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadL10n } from '../../scripts/lib/l10nSource.mjs'
import { browserTextKeys, compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { removeFolder } from './helpers/temporaryFolders'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { DEVICE_LIMITS } from '../../src/shared/constants'

const entries = {
  main: 'src/webview/main.tsx',
  models: 'src/webview/models/models.tsx',
  usage: 'src/webview/usage/usage.tsx',
  referencePage: 'src/webview/components/ReferencePage.tsx',
  whatsNew: 'src/webview/whatsNew/main.ts',
  resourceSurface: 'src/webview/resources/ResourceSurface.tsx',
  resourceHistory: 'src/webview/usage/ResourcesSection.tsx',
}
const fixture = {
  folder: '',
  canonical: undefined,
  browser: undefined,
  keys: undefined,
  installed: undefined,
  accountKeys: undefined,
  resourceKeys: undefined,
}
const byText = (left, right) => left.localeCompare(right)

beforeAll(async () => {
  mkdirSync(path.resolve('temp'), { recursive: true })
  fixture.folder = mkdtempSync(path.resolve('temp/train15h-english-'))
  writeFileSync(path.join(fixture.folder, 'package.json'), '{"type":"module"}')
  const english = path.resolve('src/shared/l10n/en.ts').replaceAll('\\', '/')
  const text = path.resolve('src/shared/l10n/text.ts').replaceAll('\\', '/')
  const installer = path.resolve('src/webview/installTable.ts').replaceAll('\\', '/')
  const vault = path.resolve('src/shared/l10n/vaultEnglish.ts').replaceAll('\\', '/')
  const probe = path.join(fixture.folder, 'probe.ts')
  writeFileSync(
    probe,
    `
import { DEVICE_LIMITS } from '../../src/shared/constants';
export const bounds = () => ({idChars: DEVICE_LIMITS.idChars, portMax: DEVICE_LIMITS.portMax});
export { EN, EN_SHAPE } from '${english}';
export { UI_TEXT, setUiText, uiLocale } from '${text}';
export { installEmbeddedTable } from '${installer}';
export { installVaultEnglish } from '${vault}';
export async function loadPalette() { return await import('../../src/shared/paletteRegistry') }
export async function loadHelp() { await Promise.all([import('browser-surface-english'), import('browser-reference-english'), import('browser-account-english'), import('browser-schedule-english')]) }
export async function loadResources() { await import('browser-resource-english') }
export async function loadAccounts() { await import('../../src/webview/models/sections/accounts/accountsEntry') }
export async function loadVault() { await import('../../src/webview/models/sections/vault/VaultSurface') }
export async function loadDeveloper() { await import('../../src/webview/developer/DeveloperOptionsPage') }
export async function loadDevices() { await import('browser-devices-english') }
`,
  )
  fixture.canonical = await loadL10n(process.cwd())
  fixture.keys = browserTextKeys([...Object.values(entries), probe], fixture.canonical.EN).keys
  // Every walk of the source graph is setup, like the build below: the case
  // that parsed the whole browser graph a second time missed its deadline
  // on a slow runner.
  fixture.installed = browserTextKeys(Object.values(entries), fixture.canonical.EN).keys
  fixture.accountKeys = browserTextKeys(
    [
      'src/webview/models/sections/accounts/accountsEntry.ts',
      'src/webview/developer/DeveloperOptionsPage.tsx',
    ],
    fixture.canonical.EN,
  ).keys
  fixture.resourceKeys = browserTextKeys(
    [entries.resourceSurface, entries.resourceHistory],
    fixture.canonical.EN,
  ).keys
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
  it('retains exact canonical values in the lazy browser Devices limits', () => {
    expect(fixture.browser.bounds()).toEqual({
      idChars: DEVICE_LIMITS.idChars,
      portMax: DEVICE_LIMITS.portMax,
    })
  })

  it.each([
    ['DEVICE_LIMITS[key]', 'Nonliteral browser Devices limit reader'],
    ['DEVICE_LIMITS.notARealLimit', 'Unknown browser Devices limit reader'],
    ['Object.keys(DEVICE_LIMITS)', 'Unsupported browser Devices limits binding'],
  ])('refuses unsupported Devices limit reader %s before emission', async (reader, message) => {
    const source = path.join(fixture.folder, 'bad-limit-' + message.split(' ', 1)[0] + '.ts')
    writeFileSync(
      source,
      `import { DEVICE_LIMITS } from '../../src/shared/constants'; const key = 'idChars'; export const value = ${reader};`,
    )
    await expect(
      build({
        entryPoints: [source],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        plugins: [compactBrowserUiText],
        logLevel: 'silent',
      }),
    ).rejects.toThrow(message)
  })

  it('keeps unreachable Help prose outside a standalone account graph', () => {
    const source = path.join(fixture.folder, 'accounts-only.ts')
    writeFileSync(source, 'const label = UI_TEXT.accounts;')
    const { keys } = browserTextKeys([source], fixture.canonical.EN)
    expect([...keys]).toEqual(['accounts'])
  })

  it('loads surface English on demand, retaining every browser value and installed language', async () => {
    const { accountKeys, installed, resourceKeys } = fixture
    for (const key of accountKeys) expect(fixture.keys.has(key), key).toBe(true)
    const { EN: canonical } = fixture.canonical
    const {
      EN,
      UI_TEXT,
      setUiText,
      uiLocale,
      loadHelp,
      loadDevices,
      loadPalette,
      loadResources,
      installVaultEnglish,
    } = fixture.browser
    expect(Object.keys(EN).toSorted(byText)).toEqual([...fixture.keys].toSorted(byText))
    // C-X-1: Help does not name the vault, and the installed entries mount
    // neither the vault nor the accounts surface. CM108ACC: Help lists accounts
    // again, so production carries that group, out of startup and on demand.
    // The probe mounts both (loadAccounts, loadVault) to keep their loading pinned.
    expect(installed.has('accounts')).toBe(true)
    expect(installed.has('vault')).toBe(false)
    expect(Object.hasOwn(EN, 'execBudgetRequired')).toBe(false)
    // MINOUT: the provider file's English is Node-only. Team settings take
    // their output-minimum message from its own leaf, never providerRouting.ts.
    expect(installed.has('providerText')).toBe(false)
    expect(Object.hasOwn(EN, 'providerText')).toBe(false)
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
    expect(() => EN.devices).toThrow('English surface is not loaded')
    await loadDevices()
    expect(EN.referenceSearch).toEqual(canonical.referenceSearch)
    expect(() => EN.resourceShow).toThrow('English surface is not loaded')
    await loadResources()
    for (const key of resourceKeys) expect(EN[key], key).toEqual(canonical[key])
    // The vault group's English is installed by the vault surface alone; the
    // shared surface English never carries it a second time.
    expect(() => EN.vault).toThrow('English surface is not loaded: vault')
    installVaultEnglish()
    expect(EN.vault).toEqual(canonical.vault)
    expect(UI_TEXT.vault).toEqual(german.vault)
    expect(UI_TEXT.resourceTitle).toBe(german.resourceTitle)
    for (const key of fixture.keys) expect(EN[key], key).toEqual(canonical[key])
    expect(UI_TEXT.referenceSearch).toBe(german.referenceSearch)
    expect(UI_TEXT.devices).toEqual(german.devices)
    expect(uiLocale()).toBe('de')
    setUiText(EN, 'en')
    expect(UI_TEXT.referenceCliOptions).toEqual(canonical.referenceCliOptions)
  })

  it('rejects malformed tables against the same complete canonical shape and slots', () => {
    const { EN, tableProblems } = fixture.canonical
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
    expect(
      installEmbeddedTable({
        querySelector: () => ({ textContent: JSON.stringify({ locale: 'en', table: broken[0] }) }),
      })?.message,
    ).toContain('execBudgetRequired: missing')
  })

  // Each language keeps the repository's five-second case deadline; the
  // full-table checks are independent and every language is still verified.
  it.each(TABLE_LOCALES)('checks %s against the complete canonical shape and slots', (locale) => {
    const { EN, tableFileName, tableProblems } = fixture.canonical
    const { EN_SHAPE, installEmbeddedTable } = fixture.browser
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

  it('keeps group literals out of eager English while retaining scalar key readers', () => {
    const selector = path.join(fixture.folder, 'selector.ts')
    const reader = path.join(fixture.folder, 'reader.ts')
    writeFileSync(selector, "const devices = document.body.dataset['surface'] === 'devices'")
    const selected = browserTextKeys([selector], fixture.canonical.EN, new Set([selector]))
    expect(selected.eagerKeys.has('devices')).toBe(false)
    // Scalar keys can be read indirectly; group names need an actual UI_TEXT reader.
    writeFileSync(reader, "const key = 'composerLabel'; readText(key)")
    const indirect = browserTextKeys([reader], fixture.canonical.EN, new Set([reader]))
    expect(indirect.eagerKeys.has('composerLabel')).toBe(true)
    writeFileSync(reader, "const key = 'devices'; readText(key)")
    expect(
      browserTextKeys([reader], fixture.canonical.EN, new Set([reader])).eagerKeys.has('devices'),
    ).toBe(false)
  })

  it.each(['browser-surface-english', 'browser-devices-english'])(
    'keeps a %s chunk failure inside the lazy surface loader catch',
    async (namespace) => {
      const surface = path.join(fixture.folder, 'webview')
      const agents = path.join(surface, 'models/sections/agents')
      mkdirSync(agents, { recursive: true })
      const body = path.join(agents, 'DevicesApp.tsx')
      const loader = path.join(surface, 'failure-loader.tsx')
      const text = path.resolve('src/shared/l10n/text.ts').replaceAll('\\', '/')
      writeFileSync(
        body,
        `import { UI_TEXT } from '${text}'; export default () => UI_TEXT.devices.title`,
      )
      // The adapter exposes the same loader promise without mounting React.
      writeFileSync(
        loader,
        `
function lazy(factory) { return factory }
export const load = lazy(async () => {
  try { return await import('./models/sections/agents/DevicesApp') }
  catch { return { default: () => 'load-failed' } }
})`,
      )
      const output = path.join(fixture.folder, 'failure-' + namespace)
      const { metafile } = await build({
        entryPoints: { loader },
        outdir: output,
        bundle: true,
        splitting: true,
        minify: true,
        platform: 'browser',
        format: 'esm',
        target: 'esnext',
        metafile: true,
        plugins: [compactBrowserUiText],
        logLevel: 'silent',
      })
      const english = Object.entries(metafile.outputs).find(([, entry]) =>
        Object.hasOwn(entry.inputs, namespace + ':' + namespace),
      )
      if (english === undefined) throw new Error('Missing test English chunk')
      rmSync(english[0])
      const module = await import(pathToFileURL(path.join(output, 'loader.js')).href)
      const loaded = await module.load()
      expect(loaded.default()).toBe('load-failed')
    },
  )
})

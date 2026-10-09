import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { compactBrowserUiText } from '../../scripts/lib/uiTextRegions.mjs'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', bundle: undefined, meta: undefined }
beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-browser-english-'))
  const probe = path.join(built.folder, 'probe.ts')
  writeFileSync(
    probe,
    `export { EN } from '${path.resolve('src/shared/l10n/en.ts').replaceAll('\\', '/')}';
export { UI_TEXT, setUiText } from '${path.resolve('src/shared/l10n/text.ts').replaceAll('\\', '/')}';
export { loadDeferredEnglish } from '${path.resolve('src/shared/l10n/deferredEnglish.ts').replaceAll('\\', '/')}';
export { installEmbeddedTable } from '${path.resolve('src/webview/installTable.ts').replaceAll('\\', '/')}';
export { installVaultEnglish } from '${path.resolve('src/shared/l10n/vaultEnglish.ts').replaceAll('\\', '/')}';
export const loadResourceEnglish = () => import('browser-resource-english');`,
  )
  const result = await build({
    entryPoints: {
      main: 'src/webview/main.tsx',
      models: 'src/webview/models/models.tsx',
      usage: 'src/webview/usage/usage.tsx',
      probe,
    },
    outdir: built.folder,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    minify: true,
    metafile: true,
    splitting: true,
    platform: 'browser',
    format: 'esm',
    plugins: [compactBrowserUiText],
    loader: { '.css': 'empty' },
    jsx: 'automatic',
  })
  built.meta = result.metafile
  built.bundle = await import(pathToFileURL(path.join(built.folder, 'probe.mjs')).href)
})
afterAll(() => removeFolder(built.folder))

const embedded = (table) => ({
  querySelector: () => ({ textContent: JSON.stringify({ locale: 'de', table }) }),
})
it('keeps account, developer and help values out of startup and loads them exactly on demand', async () => {
  expect(built.bundle.UI_TEXT.sendTitle).toBe(EN.sendTitle)
  expect(() => built.bundle.UI_TEXT.referenceIntro).toThrow('English surface is not loaded')
  expect(() => built.bundle.UI_TEXT.accounts).toThrow('English surface is not loaded')
  // STARTUP017: a restored settlement row's words paint with startup; the
  // rest of the schedule English loads only with the schedule surfaces.
  expect(built.bundle.UI_TEXT.scheduleSettlement).toEqual(EN.scheduleSettlement)
  expect(() => built.bundle.UI_TEXT.scheduleV2).toThrow('English surface is not loaded: scheduleV2')
  const chunk = Object.entries(built.meta.outputs).find(([, output]) =>
    Object.hasOwn(output.inputs, 'browser-surface-english:browser-surface-english'),
  )
  expect(chunk).toBeDefined()
  const scheduleChunk = Object.entries(built.meta.outputs).find(([, output]) =>
    Object.hasOwn(output.inputs, 'browser-schedule-english:browser-schedule-english'),
  )
  expect(scheduleChunk?.[0]).not.toBe(chunk[0])
  const main = Object.entries(built.meta.outputs).find(([file]) => file.endsWith('probe.mjs'))
  const seen = new Set()
  const reachesLoader = (file) => {
    if (seen.has(file)) return false
    seen.add(file)
    const output = built.meta.outputs[file]
    return (
      output?.imports.some(
        (edge) =>
          (edge.kind === 'dynamic-import' && edge.path === chunk[0]) ||
          (edge.kind === 'import-statement' && reachesLoader(edge.path)),
      ) ?? false
    )
  }
  expect(reachesLoader(main[0])).toBe(true)
  const german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
  expect(built.bundle.installEmbeddedTable(embedded(german))).toBeUndefined()
  await Promise.all([built.bundle.loadDeferredEnglish(), built.bundle.loadDeferredEnglish()])
  expect(built.bundle.UI_TEXT).toEqual(german)
  // The vault group's English loads with the vault surface alone (CAPS017).
  expect(() => built.bundle.EN.vault).toThrow('English surface is not loaded: vault')
  built.bundle.installVaultEnglish()
  // M107 U-C1: English read only by the resource chip and pages loads with
  // those surfaces (their modules import it), never with the other deferred groups.
  const resourceOnly = Object.keys(built.bundle.EN).filter((key) => {
    try {
      return built.bundle.EN[key] === undefined
    } catch (error) {
      return String(error).includes('English surface is not loaded')
    }
  })
  expect(resourceOnly.length).toBeGreaterThan(0)
  await built.bundle.loadResourceEnglish()
  for (const [key, value] of Object.entries(built.bundle.EN)) expect(value).toEqual(EN[key])
  built.bundle.setUiText(built.bundle.EN, 'en')
  for (const [key, value] of Object.entries(built.bundle.EN))
    expect(built.bundle.UI_TEXT[key]).toEqual(value)
})
it('validates deferred slots, keys and plurals before installing a translated table', async () => {
  await built.bundle.loadDeferredEnglish()
  built.bundle.installVaultEnglish()
  await built.bundle.loadResourceEnglish()
  const german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
  for (const mutate of [
    (table) => {
      table.accounts.keyPrompt = 'missing slots'
    },
    (table) => {
      delete table.accounts.title
    },
    (table) => {
      table.accounts.requestCount = 'not plural'
    },
    (table) => {
      table.developer.expires = '{wrong}'
    },
  ]) {
    const table = globalThis.structuredClone(german)
    mutate(table)
    expect(built.bundle.installEmbeddedTable(embedded(table))).toBeInstanceOf(Error)
    for (const [key, value] of Object.entries(built.bundle.EN))
      expect(built.bundle.UI_TEXT[key]).toEqual(value)
  }
})

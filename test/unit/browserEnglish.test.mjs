import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { deferredBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', bundle: undefined, meta: undefined }
beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-browser-english-'))
  const result = await build({
    stdin: {
      contents: `export { EN } from './src/shared/l10n/en';
export { UI_TEXT, setUiText } from './src/shared/l10n/text';
export { loadDeferredEnglish } from './src/shared/l10n/deferredEnglish';
export { installEmbeddedTable } from './src/webview/installTable';`,
      resolveDir: process.cwd(),
    },
    outdir: built.folder,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    minify: true,
    metafile: true,
    splitting: true,
    platform: 'browser',
    format: 'esm',
    plugins: [deferredBrowserEnglish],
  })
  built.meta = result.metafile
  built.bundle = await import(pathToFileURL(path.join(built.folder, 'stdin.mjs')).href)
})
afterAll(() => removeFolder(built.folder))

const embedded = (table) => ({
  querySelector: () => ({ textContent: JSON.stringify({ locale: 'de', table }) }),
})
it('keeps account, developer and help values out of startup and loads them exactly on demand', async () => {
  expect(built.bundle.UI_TEXT.sendTitle).toBe(EN.sendTitle)
  expect(() => built.bundle.UI_TEXT.accounts).toThrow('Deferred English')
  const chunk = Object.entries(built.meta.outputs).find(([, output]) =>
    Object.hasOwn(output.inputs, 'browser-english-deferred:table'),
  )
  expect(chunk).toBeDefined()
  const main = Object.entries(built.meta.outputs).find(([file]) => file.endsWith('stdin.mjs'))
  expect(main[1].imports).toContainEqual(
    expect.objectContaining({ path: chunk[0], kind: 'dynamic-import' }),
  )
  const german = JSON.parse(readFileSync('l10n/ui.de.json', 'utf8'))
  expect(built.bundle.installEmbeddedTable(embedded(german))).toBeUndefined()
  await Promise.all([built.bundle.loadDeferredEnglish(), built.bundle.loadDeferredEnglish()])
  expect(built.bundle.UI_TEXT).toEqual(german)
  expect(built.bundle.EN).toEqual(EN)
  built.bundle.setUiText(built.bundle.EN, 'en')
  expect(built.bundle.UI_TEXT).toEqual(EN)
})
it('validates deferred slots, keys and plurals before installing a translated table', () => {
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
    expect(built.bundle.UI_TEXT).toEqual(EN)
  }
})

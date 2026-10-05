import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import {
  UI_TEXT_REGIONS,
  regionalUiText,
  uiTextProperties,
} from '../../scripts/lib/uiTextRegions.mjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { stageVsix, packagedChangelog } from '../../scripts/package-vsix.mjs'
import { packRuntimeArchive } from '../../scripts/lib/packageArchive.mjs'
import { readArchivedUiTable } from '../../src/shared/l10n/tableArchive'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { loadUiTable, readUiTableFile } from '../../src/host/l10n'
import { listFiles } from '@vscode/vsce/out/package.js'

const ROOT = process.cwd()
const hash = (text) => createHash('sha256').update(text).digest('hex')
const fixture = { root: '', stage: '', files: [] }
const excluded = [
  'PLAN.md',
  'AGENTS.md',
  'docs/certification/train-0.13.0.md',
  'test/unit/private.test.ts',
  'test/fixtures/private.json',
  'src/extension.ts',
  'dist/meta/webview.json',
  'dist/webview/main.js.map',
  'dist/webview/chunks/dialog.js.map',
  'media/readme/banner.png',
  'docs/marketplace-readme.md',
  'l10n/untranslated.json',
]

beforeAll(async () => {
  mkdirSync(path.join(ROOT, 'temp'), { recursive: true })
  fixture.root = mkdtempSync(path.join(ROOT, 'temp', 'train13b-package-'))
  fixture.stage = path.join(fixture.root, 'dist', 'vsix-package')
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const file of [
    '.vscodeignore',
    'README.md',
    'CHANGELOG.md',
    'docs/marketplace-readme.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
    'docs/PRIVACY.md',
  ]) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    cpSync(path.join(ROOT, file), path.join(fixture.root, file))
  }
  writeFileSync(path.join(fixture.root, 'package.json'), JSON.stringify(manifest, null, 2))
  const markers = excluded.filter(
    (file) => !['PLAN.md', 'docs/marketplace-readme.md'].includes(file),
  )
  for (const file of markers) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    writeFileSync(path.join(fixture.root, file), 'must not ship')
  }
  writeFileSync(path.join(fixture.root, 'PLAN.md'), 'must not ship')
  for (const file of [
    'dist/extension.js',
    'dist/validation.js',
    'dist/webview/main.js',
    'dist/webview/main.css',
    'dist/webview/chunks/UsageDialog-test.js',
    'native/darwin/muse-dictate',
    'l10n/ui.de.json.br',
  ]) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    writeFileSync(path.join(fixture.root, file), 'runtime')
  }
  cpSync(path.join(ROOT, 'l10n'), path.join(fixture.root, 'l10n'), { recursive: true })
  // Unit CI runs before the production build; generate these artifacts from source.
  const properties = uiTextProperties()
  const regions = [{ name: undefined, output: 'dist/uiText.js' }, ...UI_TEXT_REGIONS]
  const sources = await Promise.all(
    regions.map((region) =>
      build({
        entryPoints: ['src/shared/l10n/en.ts'],
        bundle: true,
        write: false,
        minify: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20.18',
        plugins: [regionalUiText(region.name)],
      }),
    ),
  )
  for (const [index, region] of regions.entries()) {
    const module = { exports: {} }
    runInNewContext(sources[index].outputFiles[0].text, { module, exports: module.exports })
    const data = Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(module.exports.EN))
        .filter(([, property]) => Object.hasOwn(property, 'value'))
        .map(([key, property]) => [key, property.value]),
    )
    const getters =
      region.name === undefined
        ? UI_TEXT_REGIONS.map((part) => {
            const keys = properties
              .filter((property) => property.region === part.name)
              .map((property) => property.key)
            return `for(const key of ${JSON.stringify(keys)})Object.defineProperty(exports.EN,key,{enumerable:true,configurable:true,get(){return require('./${path.basename(part.output)}').EN[key]}});`
          }).join('\n')
        : ''
    writeFileSync(
      path.join(fixture.root, region.output),
      `exports.EN=${JSON.stringify(data)};\n${getters}\n`,
    )
  }
  writeFileSync(
    path.join(fixture.root, 'dist/tab.js'),
    'exports.file=__filename;exports.relative=require("./wire.js").value;exports.fail=()=>{throw new Error("original stack")};',
  )
  writeFileSync(path.join(fixture.root, 'dist/wire.js'), 'exports.value="sibling";')
  cpSync(path.join(ROOT, 'package.nls.json'), path.join(fixture.root, 'package.nls.json'))
  writeFileSync(
    path.join(fixture.root, 'dist/meta/webview.json'),
    JSON.stringify({
      outputs: { 'dist/webview/main.js': {}, 'dist/webview/chunks/UsageDialog-test.js': {} },
    }),
  )
  fixture.files = await stageVsix(fixture.root, fixture.stage)
})
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))

describe('VSIX packaging', () => {
  it.each(excluded)('excludes %s from actual VSCE collection', (file) => {
    expect(fixture.files).not.toContain(file)
  })
  it('ships the helper, shared runtime and deferred chunks', async () => {
    const packaged = await listFiles({ cwd: fixture.stage, dependencies: false })
    expect(packaged).toEqual(
      expect.arrayContaining([
        'dist/validation.js',
        'dist/webview/chunks/UsageDialog-test.js',
        'native/darwin/muse-dictate',
        'l10n/ui.tables.json.br',
        'dist/runtime.bundles.json.br',
      ]),
    )
    expect(packaged).not.toContain('docs/marketplace-readme.md')
  })
  it.each(TABLE_LOCALES)('round-trips %s byte-exact and leaves source unchanged', (locale) => {
    const file = `l10n/ui.${locale}.json`
    const source = path.join(fixture.root, file)
    const before = readFileSync(path.join(ROOT, file))
    const shipped = brotliDecompressSync(
      readFileSync(path.join(fixture.stage, 'l10n/ui.tables.json.br')),
    ).toString('utf8')
    const table = readArchivedUiTable(shipped, locale)
    expect(JSON.parse(table)).toEqual(JSON.parse(before))
    expect(table).toBe(JSON.stringify(JSON.parse(before)))
    expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(
      createHash('sha256').update(before).digest('hex'),
    )
  })
  it('loads exact archived CommonJS with original relative requires and stack filename', () => {
    const file = path.join(fixture.stage, 'dist/tab.js')
    const loaded = createRequire(file)(file)
    expect(loaded.file).toBe(file)
    expect(loaded.relative).toBe('sibling')
    expect(loaded.fail).toThrow('original stack')
    try {
      loaded.fail()
    } catch (error) {
      expect(error.stack).toContain(`${file}:1:`)
    }
    const archive = JSON.parse(
      brotliDecompressSync(readFileSync(path.join(fixture.stage, 'dist/runtime.bundles.json.br'))),
    )
    expect(archive.bundles['tab.js']).toBe(
      readFileSync(path.join(fixture.root, 'dist/tab.js'), 'utf8'),
    )
    expect(readFileSync(path.join(fixture.stage, 'dist/extension.js'))).toEqual(
      readFileSync(path.join(fixture.root, 'dist/extension.js')),
    )
  })
  it('retains direct CommonJS named exports through native import and require', () => {
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const baselineFile=${JSON.stringify(path.join(fixture.root, 'dist/tab.js'))};
      const packagedFile=${JSON.stringify(path.join(fixture.stage, 'dist/tab.js'))};
      const baseline=await import(pathToFileURL(baselineFile).href);
      const packaged=await import(pathToFileURL(packagedFile).href);
      assert.deepEqual(Object.keys(packaged),Object.keys(baseline));
      assert.equal(packaged.relative,baseline.relative);
      assert.throws(packaged.fail,/original stack/);
      const require=createRequire(packagedFile);
      assert.deepEqual(Object.keys(require(packagedFile)),Object.keys(require(baselineFile)));
    `,
      ],
      { env: {} },
    )
  })
  it('keeps the eager fallback smaller and enumerates keys without loading regions', () => {
    const file = path.join(fixture.stage, 'dist/uiText.js')
    const require = createRequire(file)
    const core = require(file)
    expect(Object.keys(core.EN)).toHaveLength(Object.keys(EN).length)
    expect(core.EN.actionFailed).toBe(EN.actionFailed)
    for (const name of ['uiTextRuntime', 'uiTextHooks', 'uiTextSurfaces']) {
      expect(require.cache[path.join(fixture.stage, 'dist', `${name}.js`)]).toBeUndefined()
    }
    expect(readFileSync(file).byteLength).toBeLessThan(
      readFileSync(path.join(fixture.root, 'dist/uiText.js')).byteLength,
    )
  })
  it('refuses packaging a runtime archive over the existing decoded bound', async () => {
    const root = mkdtempSync(path.join(ROOT, 'temp', 'oversized-package-'))
    try {
      cpSync(fixture.root, root, { recursive: true })
      writeFileSync(path.join(root, 'dist/tab.js'), ' '.repeat(15 * 1024 * 1024))
      await expect(stageVsix(root, path.join(root, 'dist/vsix-package'))).rejects.toThrow(
        'Runtime archive exceeds decoded bound',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('produces identical archive bytes with reversed input order', async () => {
    const stage = path.join(fixture.root, 'reordered')
    cpSync(fixture.stage, stage, { recursive: true })
    cpSync(path.join(fixture.root, 'dist/uiText.js'), path.join(stage, 'dist/uiText.js'))
    const tables = TABLE_LOCALES.map((locale) => [
      locale,
      JSON.parse(readFileSync(path.join(fixture.root, `l10n/ui.${locale}.json`))),
    ])
    await packRuntimeArchive(fixture.root, stage, fixture.files.toReversed(), tables.toReversed())
    expect(
      readFileSync(path.join(stage, 'l10n/ui.tables.json.br')).equals(
        readFileSync(path.join(fixture.stage, 'l10n/ui.tables.json.br')),
      ),
    ).toBe(true)
    expect(
      readFileSync(path.join(stage, 'dist/runtime.bundles.json.br')).equals(
        readFileSync(path.join(fixture.stage, 'dist/runtime.bundles.json.br')),
      ),
    ).toBe(true)
  })
  it('discards a cached archive after a failed member so a repair can retry', () => {
    const stage = path.join(fixture.root, 'repair')
    cpSync(fixture.stage, stage, { recursive: true })
    const file = path.join(stage, 'dist/uiText.js')
    const require = createRequire(file)
    require(file)
    const { readPackedRuntime } = require.cache[file]
    const archiveFile = path.join(stage, 'dist/runtime.bundles.json.br')
    const archive = JSON.parse(brotliDecompressSync(readFileSync(archiveFile)))
    readPackedRuntime('bundles', 'tab.js', hash(archive.bundles['tab.js']))
    const repaired = 'exports.later=true;'
    expect(() => readPackedRuntime('bundles', 'later.js', hash(repaired))).toThrow()
    archive.bundles['later.js'] = repaired
    writeFileSync(archiveFile, brotliCompressSync(JSON.stringify(archive)))
    expect(readPackedRuntime('bundles', 'later.js', hash(repaired))).toBe(repaired)
  })
  it.each([
    'missing',
    'corrupt',
    'version',
    'english',
    'oversized',
    'code-missing',
    'code-corrupt',
    'code-version',
    'code-bundle',
    'code-oversized',
  ])('preserves English fallback and refuses damaged executable content: %s', async (kind) => {
    const stage = path.join(fixture.root, kind)
    cpSync(fixture.stage, stage, { recursive: true })
    const isCode = kind.startsWith('code-')
    const fault = isCode ? kind.slice('code-'.length) : kind
    const archiveFile = path.join(
      stage,
      isCode ? 'dist/runtime.bundles.json.br' : 'l10n/ui.tables.json.br',
    )
    const originalBytes = readFileSync(archiveFile)
    let oversizedDigest
    if (fault === 'missing') rmSync(archiveFile)
    else if (fault === 'corrupt') writeFileSync(archiveFile, 'Invalid Brotli')
    else {
      const archive = JSON.parse(brotliDecompressSync(readFileSync(archiveFile)))
      switch (fault) {
        case 'version': {
          archive.version = 2
          break
        }
        case 'english': {
          archive.english.runtime = '{}'
          break
        }
        case 'bundle': {
          archive.bundles['tab.js'] = 'exports.relative="tampered";'
          break
        }
        case 'oversized': {
          const text = ' '.repeat(15 * 1024 * 1024)
          if (isCode) archive.bundles['tab.js'] = text
          else archive.english.runtime = text
          oversizedDigest = createHash('sha256').update(text).digest('hex')
          break
        }
        default: {
          throw new Error('Unknown archive fault')
        }
      }
      writeFileSync(archiveFile, brotliCompressSync(JSON.stringify(archive)))
    }
    const coreFile = path.join(stage, 'dist/uiText.js')
    const require = createRequire(coreFile)
    const original = createRequire(path.join(fixture.root, 'dist/uiText.js'))(
      path.join(fixture.root, 'dist/uiText.js'),
    ).EN
    expect(JSON.stringify(require(coreFile).EN)).toBe(JSON.stringify(original))
    expect(require(coreFile).EN).toEqual(EN)
    if (fault === 'oversized') {
      expect(() =>
        require.cache[coreFile].readPackedRuntime(
          isCode ? 'bundles' : 'english',
          isCode ? 'tab.js' : 'runtime',
          oversizedDigest,
        ),
      ).toThrow()
    }
    const tab = path.join(stage, 'dist/tab.js')
    if (isCode) {
      expect(() => require(tab)).toThrow()
      writeFileSync(archiveFile, originalBytes)
      expect(require(tab).relative).toBe('sibling')
    } else expect(require(tab).relative).toBe('sibling')
    if (!['missing', 'corrupt', 'version', 'oversized'].includes(kind)) return
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }
    const table = await loadUiTable({
      language: 'de',
      log,
      readExtensionFile: (segments) => readUiTableFile(stage, segments),
    })
    expect(table.locale).toBe('en')
    expect(JSON.stringify(table.table)).toBe(JSON.stringify(EN))
  })
  it('keeps a compact guide and recent notes with links to complete documentation', () => {
    expect(readFileSync(path.join(fixture.stage, 'README.md'), 'utf8')).toBe(
      readFileSync('docs/marketplace-readme.md', 'utf8'),
    )
    const source = readFileSync('CHANGELOG.md', 'utf8')
    const sections = source.matchAll(/^## \[\d+\.\d+\.\d+\].*$/gm).toArray()
    const shipped = readFileSync(path.join(fixture.stage, 'CHANGELOG.md'), 'utf8')
    expect(shipped).toContain(source.slice(0, sections[2].index).trimEnd())
    expect(shipped).not.toContain(sections[2][0])
    expect(shipped).toContain('[Complete release history]')
    expect(packagedChangelog('## [0.1.0] - 2026-01-01\n\nNotes')).toContain('Notes')
    expect(() => packagedChangelog('No releases')).toThrow('No released')
  })
  it('keeps the quiet GitHub star link in the README Marketplace and Open VSX render', () => {
    expect(readFileSync(path.join(fixture.stage, 'README.md'), 'utf8')).toContain(
      '[Enjoying Muse Spark Code? A star on GitHub helps other people find it.](https://github.com/RandyNorthrup/muse-spark-code)',
    )
  })
  it('refuses a stage outside its owned build directory', async () => {
    await expect(stageVsix(fixture.root, path.join(fixture.root, 'other'))).rejects.toThrow(
      'Invalid VSIX stage',
    )
  })
})

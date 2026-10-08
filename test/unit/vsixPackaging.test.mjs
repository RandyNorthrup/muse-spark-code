import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
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
import { renderPackageReadme } from '../../scripts/check-badges.mjs'
import { compactVsix } from '../../scripts/lib/compactVsix.mjs'
import { readZip } from '@vscode/vsce/out/zip.js'
import { packRuntimeArchive } from '../../scripts/lib/packageArchive.mjs'
import { readArchivedUiTable } from '../../src/shared/l10n/tableArchive'
import { readUsageTableFile } from '../../src/runtime/usage/usageTableFile'
import { EN } from '../../src/shared/l10n/en'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { L10N_COMPRESSION_QUALITY } from '../../src/shared/constants'
import { loadUiTable, readUiTableFile } from '../../src/host/l10n'
import { listFiles, pack } from '@vscode/vsce/out/package.js'

// The staged-bytes check starts three Node children, each loading vsce and
// jsdom; hosted runners take about five seconds for the three.
const CHILD_PROCESS_TIMEOUT_MS = 60_000
// Real maximum-compression archives are prepared once, outside 5-second assertions.
const ARCHIVE_SETUP_TIMEOUT_MS = 60_000
// Fault fixtures test decoded content/digests, not production compression effort.
const FAULT_COMPRESSION = { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 } }
// Staging copies the l10n tree and runs vsce's own file collection. On a loaded
// macOS runner shard that exceeded vitest's 10 s hook default (PR #128, twice).
const STAGE_TIMEOUT_MS = 60_000

const ARCHIVE_PATHS = [
  'l10n/ui.tables.json.br',
  'dist/runtime.bundles.json.br',
  'l10n/usage.tables.json.br',
]

const ROOT = process.cwd()
const hash = (text) => createHash('sha256').update(text).digest('hex')
const fixture = {
  root: '',
  stage: '',
  files: [],
  packagedFiles: [],
  before: undefined,
  after: undefined,
  brotliBaseline: new Map(),
}
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
  'docs/reference.md',
  'l10n/untranslated.json',
  'vendor/models-dev/VENDOR.json',
  'vendor/high-quality-projects-skill/fonts/development.woff2',
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
    'media/icon.png',
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
    'dist/resourceGovernor.js',
    'dist/resourceAdmission.js',
    'dist/webview/resourceSurface.js',
    'dist/webview/resourceHistory.js',
    'dist/webview/resourceHistory.css',
    'dist/validation.js',
    'dist/webview/main.js',
    'dist/webview/main.css',
    'dist/webview/models.js',
    'dist/webview/models.css',
    'dist/webview/whatsNew.js',
    'dist/webview/whatsNew.css',
    'dist/webview/usage.js',
    'dist/webview/usage.css',
    'dist/webview/referencePage.js',
    'dist/webview/referencePage.css',
    'dist/webview/chunks/UsageDialog-test.js',
    'native/linux/x64/muse-created',
    'native/linux/arm64/muse-created',
    'native/darwin/muse-dictate',
    'l10n/ui.de.json.br',
  ]) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    writeFileSync(
      path.join(fixture.root, file),
      file === 'dist/extension.js'
        ? 'exports.activate=()=>"activation";exports.deactivate=()=>{};'
        : 'runtime',
    )
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
  const catalog = readFileSync(path.join(ROOT, 'vendor/models-dev/snapshot.json'), 'utf8')
  writeFileSync(path.join(fixture.root, 'dist/providerCatalog.json'), catalog)
  writeFileSync(path.join(fixture.root, 'dist/providerCatalog.js'), `module.exports=${catalog};\n`)
  cpSync(path.join(ROOT, 'package.nls.json'), path.join(fixture.root, 'package.nls.json'))
  writeFileSync(
    path.join(fixture.root, 'dist/meta/webview.json'),
    JSON.stringify({
      outputs: { 'dist/webview/main.js': {}, 'dist/webview/chunks/UsageDialog-test.js': {} },
    }),
  )
  for (const [page, file] of [
    ['modelsWebview', 'dist/webview/models.js'],
    ['whatsNewPage', 'dist/webview/whatsNew.js'],
    ['usageWebview', 'dist/webview/usage.js'],
    ['referencePage', 'dist/webview/referencePage.js'],
  ]) {
    writeFileSync(
      path.join(fixture.root, `dist/meta/${page}.json`),
      JSON.stringify({ outputs: { [file]: {} } }),
    )
  }
})

beforeAll(async () => {
  fixture.files = await stageVsix(fixture.root, fixture.stage)
  fixture.packagedFiles = await listFiles({ cwd: fixture.stage, dependencies: false })
}, STAGE_TIMEOUT_MS)

beforeAll(async () => {
  const archive = path.join(fixture.root, 'compact.vsix')
  writeFileSync(path.join(fixture.stage, 'dist/webview/chunks/crc.js'), '123456789')
  const result = await pack({ cwd: fixture.stage, dependencies: false, packagePath: archive })
  fixture.before = await readZip(archive, () => true)
  await compactVsix(archive, result.files)
  fixture.after = await readZip(archive, () => true)
  const stage = path.join(fixture.root, 'reordered')
  cpSync(fixture.stage, stage, { recursive: true })
  cpSync(path.join(fixture.root, 'dist/uiText.js'), path.join(stage, 'dist/uiText.js'))
  const tables = TABLE_LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(path.join(fixture.root, `l10n/ui.${locale}.json`))),
  ])
  await packRuntimeArchive(fixture.root, stage, fixture.files.toReversed(), tables.toReversed())
  for (const file of ARCHIVE_PATHS) {
    const packed = readFileSync(path.join(fixture.stage, file))
    fixture.brotliBaseline.set(
      file,
      brotliCompressSync(brotliDecompressSync(packed), {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: L10N_COMPRESSION_QUALITY },
      }),
    )
  }
}, ARCHIVE_SETUP_TIMEOUT_MS)
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))

// The oversized-archive case packages a real runtime archive past its decoded
// bound; a hosted runner with coverage took 4.0 s, near the default deadline.
// PLAN.md §8 (2026-10-07).
const REAL_OVERSIZED_PACKAGE_TIMEOUT_MS = 30_000

describe('VSIX packaging', () => {
  it('recompresses real VSCE output with unchanged members and the standard CRC', async () => {
    const archive = path.join(fixture.root, 'compact.vsix')
    expect(
      fixture.after
        .keys()
        .toArray()
        .toSorted((a, b) => a.localeCompare(b, 'en')),
    ).toEqual(
      fixture.before
        .keys()
        .toArray()
        .toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    for (const [name, content] of fixture.before) {
      expect(content.equals(fixture.after.get(name)), name).toBe(true)
    }
    const bytes = readFileSync(archive)
    let offset = 0
    let crc
    while (bytes.readUInt32LE(offset) === 0x04_03_4b_50) {
      const nameBytes = bytes.readUInt16LE(offset + 26)
      const extraBytes = bytes.readUInt16LE(offset + 28)
      const name = bytes.subarray(offset + 30, offset + 30 + nameBytes).toString('utf8')
      if (name.endsWith('/crc.js')) crc = bytes.readUInt32LE(offset + 14)
      offset += 30 + nameBytes + extraBytes + bytes.readUInt32LE(offset + 18)
    }
    expect(crc).toBe(0xcb_f4_39_26)
    let helperMode
    while (bytes.readUInt32LE(offset) === 0x02_01_4b_50) {
      const nameBytes = bytes.readUInt16LE(offset + 28)
      const extraBytes = bytes.readUInt16LE(offset + 30)
      const commentBytes = bytes.readUInt16LE(offset + 32)
      const name = bytes.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8')
      if (name === 'extension/native/darwin/muse-dictate')
        helperMode = bytes.readUInt32LE(offset + 38) >>> 16
      offset += 46 + nameBytes + extraBytes + commentBytes
    }
    expect(helperMode).toBe(0o10_0755)
    const original = readFileSync(archive)
    await expect(compactVsix(archive, [])).rejects.toThrow('Invalid VSIX member set')
    expect(readFileSync(archive).equals(original)).toBe(true)
  })
  it.each(['invalid', 'missing', 'oversized'])(
    'refuses a damaged usage archive member: %s',
    async (kind) => {
      const stage = path.join(fixture.root, `usage-${kind}`)
      cpSync(fixture.stage, stage, { recursive: true })
      const file = path.join(stage, 'l10n/usage.tables.json.br')
      const archive = JSON.parse(brotliDecompressSync(readFileSync(file)))
      if (kind === 'missing') delete archive.de
      else if (kind === 'invalid') archive.de = {}
      else archive.de.title = 'x'.repeat(2 * 1024 * 1024)
      writeFileSync(file, brotliCompressSync(JSON.stringify(archive), FAULT_COMPRESSION))
      await expect(readUsageTableFile(stage, ['l10n', 'usage.de.json'])).rejects.toThrow()
    },
  )
  it.each(TABLE_LOCALES)(
    'loads archived usage %s byte-exact without a plain table',
    async (locale) => {
      const file = `usage.${locale}.json`
      expect(await readUsageTableFile(fixture.stage, ['l10n', file])).toBe(
        JSON.stringify(JSON.parse(readFileSync(path.join(fixture.root, 'l10n', file), 'utf8'))),
      )
      expect(fixture.packagedFiles).not.toContain(`l10n/${file}`)
    },
  )
  it.each(excluded)('excludes %s from actual VSCE collection', (file) => {
    expect(fixture.files).not.toContain(file)
  })
  it('ships the helper, shared runtime and deferred chunks', async () => {
    const packaged = fixture.packagedFiles
    expect(packaged).toEqual(
      expect.arrayContaining([
        'dist/validation.js',
        'dist/resourceGovernor.js',
        'dist/resourceAdmission.js',
        'dist/webview/resourceSurface.js',
        'dist/webview/resourceHistory.js',
        'dist/webview/resourceHistory.css',
        'dist/webview/chunks/UsageDialog-test.js',
        'native/linux/x64/muse-created',
        'native/linux/arm64/muse-created',
        'native/darwin/muse-dictate',
        'l10n/ui.tables.json.br',
        'dist/runtime.bundles.json.br',
      ]),
    )
    expect(packaged).not.toContain('docs/marketplace-readme.md')
  })
  it.each(['x64', 'arm64'])(
    'P1 refuses a VSIX with the Linux helper %s absent before replacing its stage',
    async (arch) => {
      const file = path.join(fixture.root, 'native', 'linux', arch, 'muse-created')
      const original = readFileSync(file)
      try {
        rmSync(file)
        await expect(stageVsix(fixture.root, fixture.stage)).rejects.toThrow(
          'Required Linux created-path helper',
        )
      } finally {
        writeFileSync(file, original)
      }
    },
  )
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
    expect(archive.bundles['extension.js']).toBe(
      readFileSync(path.join(fixture.root, 'dist/extension.js'), 'utf8'),
    )
    const activation = path.join(fixture.stage, 'dist/extension.js')
    expect(createRequire(activation)(activation).activate()).toBe('activation')
  })
  it.each(['models', 'whatsNew'])('refuses an excluded %s page script', async (page) => {
    const root = mkdtempSync(path.join(ROOT, 'temp', 'excluded-page-'))
    try {
      cpSync(fixture.root, root, { recursive: true })
      const ignore = path.join(root, '.vscodeignore')
      writeFileSync(ignore, readFileSync(ignore, 'utf8').replace(`!dist/webview/${page}.js`, ''))
      await expect(stageVsix(root, path.join(root, 'dist/vsix-package'))).rejects.toThrow(
        `Webview output excluded from VSIX: dist/webview/${page}.js`,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('loads the exact provider catalogue through the verified runtime archive', async () => {
    const file = path.join(fixture.stage, 'dist/providerCatalog.js')
    const require = createRequire(file)
    expect(require(file)).toEqual(
      JSON.parse(readFileSync(path.join(fixture.root, 'dist/providerCatalog.json'), 'utf8')),
    )
    const archive = JSON.parse(
      brotliDecompressSync(readFileSync(path.join(fixture.stage, 'dist/runtime.bundles.json.br'))),
    )
    expect(archive.bundles['providerCatalog.js']).toBe(
      readFileSync(path.join(fixture.root, 'dist/providerCatalog.js'), 'utf8'),
    )
    const packaged = fixture.packagedFiles
    expect(packaged).not.toContain('dist/providerCatalog.json')
    const stage = path.join(fixture.root, 'catalog-tampered')
    cpSync(fixture.stage, stage, { recursive: true })
    archive.bundles['providerCatalog.js'] = 'module.exports={};'
    writeFileSync(
      path.join(stage, 'dist/runtime.bundles.json.br'),
      brotliCompressSync(JSON.stringify(archive)),
    )
    const damaged = path.join(stage, 'dist/providerCatalog.js')
    expect(() => createRequire(damaged)(damaged)).toThrow('Invalid runtime archive member')
  })

  it.each([false, true])(
    'retains direct CommonJS named exports through native import and require, loader hooks: %s',
    (withHooks) => {
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
      import assert from 'node:assert/strict';
      import { createRequire, registerHooks } from 'node:module';
      if (${withHooks}) registerHooks({load(url,context,nextLoad){return nextLoad(url,context);}});
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
    },
  )
  it('keeps the eager fallback smaller and enumerates keys without loading regions', () => {
    const file = path.join(fixture.stage, 'dist/uiText.js')
    const require = createRequire(file)
    const core = require(file)
    expect(Object.keys(core.EN)).toHaveLength(Object.keys(EN).length)
    expect(core.EN.actionFailed).toBe(EN.actionFailed)
    expect(readFileSync(path.join(fixture.stage, 'dist/uiTextRuntime.js'))).toEqual(
      readFileSync(path.join(fixture.root, 'dist/uiTextRuntime.js')),
    )
    for (const name of ['uiTextRuntime', 'uiTextHooks', 'uiTextSurfaces']) {
      expect(require.cache[path.join(fixture.stage, 'dist', `${name}.js`)]).toBeUndefined()
    }
    expect(readFileSync(file).byteLength).toBeLessThan(
      readFileSync(path.join(fixture.root, 'dist/uiText.js')).byteLength,
    )
  })
  it(
    'refuses packaging a runtime archive over the existing decoded bound',
    async () => {
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
    },
    REAL_OVERSIZED_PACKAGE_TIMEOUT_MS,
  )
  it.each(ARCHIVE_PATHS)('retains the synchronous production Brotli bytes: %s', (file) => {
    const packed = readFileSync(path.join(fixture.stage, file))
    expect(packed.equals(fixture.brotliBaseline.get(file))).toBe(true)
  })
  it('produces identical archive bytes with reversed input order', () => {
    const stage = path.join(fixture.root, 'reordered')
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
    writeFileSync(archiveFile, brotliCompressSync(JSON.stringify(archive), FAULT_COMPRESSION))
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
      writeFileSync(archiveFile, brotliCompressSync(JSON.stringify(archive), FAULT_COMPRESSION))
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
      renderPackageReadme(
        readFileSync('docs/marketplace-readme.md', 'utf8'),
        JSON.parse(readFileSync(path.join(fixture.root, 'package.json'), 'utf8')).version,
      ),
    )
    const source = readFileSync('CHANGELOG.md', 'utf8')
    const sections = source.matchAll(/^## \[\d+\.\d+\.\d+\].*$/gm).toArray()
    const shipped = readFileSync(path.join(fixture.stage, 'CHANGELOG.md'), 'utf8')
    expect(shipped).toContain(source.slice(sections[0].index, sections[2].index).trimEnd())
    expect(shipped).toContain('[Complete Unreleased notes]')
    expect(shipped).not.toContain(sections[2][0])
    expect(shipped).toContain('[Complete release history]')
    expect(packagedChangelog('## [0.1.0] - 2026-01-01\n\nNotes')).toContain('Notes')
    expect(() => packagedChangelog('No releases')).toThrow('No released')
  })
  it('generates both static badges from the manifest, with no unresolved token', () => {
    const version = JSON.parse(
      readFileSync(path.join(fixture.root, 'package.json'), 'utf8'),
    ).version
    const shipped = readFileSync(path.join(fixture.stage, 'README.md'), 'utf8')
    expect(shipped).toContain(`/badge/Marketplace-v${version}-`)
    expect(shipped).toContain(`/badge/Open%20VSX-v${version}-`)
    expect(shipped).not.toContain('{version}')
    expect(shipped).not.toContain('badgen.net/vs-marketplace/v/')
  })
  it(
    'checks exact staged bytes and rejects a staged README or manifest version mismatch',
    () => {
      const readme = path.join(fixture.stage, 'README.md')
      const manifest = path.join(fixture.stage, 'package.json')
      const originalReadme = readFileSync(readme)
      const originalManifest = readFileSync(manifest)
      const version = JSON.parse(originalManifest).version
      const check = () =>
        execFileSync(
          process.execPath,
          ['scripts/check-badges.mjs', '--packaged-vsix', fixture.stage],
          {
            cwd: ROOT,
            env: { ...process.env, CI: '', BADGE_CHECK_SKIP_NETWORK: 'fake-only staged fixture' },
            encoding: 'utf8',
            stdio: 'pipe',
          },
        )
      expect(check()).toContain('network skipped: fake-only staged fixture')
      try {
        writeFileSync(
          readme,
          originalReadme.toString().replace(`Marketplace-v${version}`, 'Marketplace-v0.0.0'),
        )
        expect(check).toThrow('version mismatch')
        writeFileSync(readme, originalReadme)
        writeFileSync(manifest, JSON.stringify({ version: '0.0.0' }))
        expect(check).toThrow('Staged manifest version mismatch')
      } finally {
        writeFileSync(readme, originalReadme)
        writeFileSync(manifest, originalManifest)
      }
    },
    CHILD_PROCESS_TIMEOUT_MS,
  )
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

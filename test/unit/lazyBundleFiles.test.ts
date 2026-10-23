// The lazy-bundle registry (src/shared/lazyBundles.generated.ts) is written
// by scripts/gen-lazy-registry.mjs from the production build. This suite
// reads the committed rows back (well-formed, sides consistent) and holds the
// scanner to every form of load on small source trees: a literal in either
// quote or a plain template, a name wrapped onto its own line, a constant
// loaded in the file that defines it, and loads whose file name is worked
// out at run time, which are recorded and fail unless listed with a reason.
//
// The command itself (written, current, stale, a planted loader, no
// metafiles, reached through a linked folder) runs as a child process over a
// real production build in test/unit/packagedBundles.test.mjs, and over the
// repository in `npm run build`. The whole-tree scan this suite used to make
// in process is that command's job: it took 5,543 ms of a 5,000 ms limit on
// the hosted Ubuntu runner (docs/certification/hotfix-0181-bundle-exports.md).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { LAZY_BUNDLES } from '../../src/shared/lazyBundles.generated'
import { DEFERRED, DEFERRED_OUTFILES } from '../../scripts/lib/deferredBundles.mjs'
import {
  COMPUTED_SOURCE_LOADS,
  computedLoadFailures,
  hasIdentifier,
  knownBundleOutputs,
  readMetafiles,
  resolveRequest,
  scanRequests,
} from '../../scripts/lib/lazyRegistry.mjs'
import { removeFolder } from './helpers/temporaryFolders'

const GENERATED = 'src/skip.generated.ts'
const folders: string[] = []
afterEach(async () => {
  while (folders.length > 0) await removeFolder(folders.pop()!)
})

it('holds one well-formed entry per bundle, each loader by file and symbol', () => {
  const files = LAZY_BUNDLES.map((entry) => entry.file)
  expect(new Set(files).size).toBe(files.length)
  for (const entry of LAZY_BUNDLES) {
    expect(entry.file).toMatch(/^([A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.js$/u)
    expect(['vscode', 'acp', 'both', 'unreached'].includes(entry.side)).toBe(true)
    const loaders = entry.requestedBy.map((asked) => `${asked.importer} ${asked.symbol}`)
    expect(new Set(loaders).size).toBe(loaders.length)
    for (const asked of entry.requestedBy) {
      // No line number: an unrelated edit of a source must not stale a row.
      expect(Object.keys(asked).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
        'importer',
        'side',
        'symbol',
      ])
      expect(asked.importer).toMatch(/^src\//u)
      expect(asked.symbol).toMatch(/^[\w$.()]+$/u)
      expect(asked.side.length).toBeGreaterThan(0)
      for (const side of asked.side) expect(['vscode', 'acp']).toContain(side)
    }
  }
})

it('covers every requested side in the row side', () => {
  for (const entry of LAZY_BUNDLES) {
    for (const asked of entry.requestedBy) {
      for (const side of asked.side) {
        expect(['both', side, 'unreached'].includes(entry.side)).toBe(true)
      }
    }
  }
})

it('names the five lazily loaded engine bundles the old copy missed', () => {
  for (const file of [
    'runtimeEngine.js',
    'runtimeAccounting.js',
    'headless.js',
    'exec.js',
    'scheduleBackground.js',
  ]) {
    const row = LAZY_BUNDLES.find((entry) => entry.file === file)
    expect(row).toBeDefined()
    expect(row?.side).toBe('acp')
  }
  // Four are filename-requested; headless.js loads only through exec.js's
  // module require (an import edge, no filename literal), so its row carries
  // the derived side with no filename requester.
  for (const file of [
    'runtimeEngine.js',
    'runtimeAccounting.js',
    'exec.js',
    'scheduleBackground.js',
  ]) {
    const row = LAZY_BUNDLES.find((entry) => entry.file === file)
    expect(row?.requestedBy.length).toBeGreaterThan(0)
  }
  expect(LAZY_BUNDLES.find((entry) => entry.file === 'headless.js')?.requestedBy).toEqual([])
})

it('keeps the production media entry in its bundle and its outfile row', () => {
  // REVPAIR C1: the #226 pair-join resolution dropped the media entry from
  // both the split gate's file closure and the entry-to-bundle map, so the
  // gate no longer proved the entry stays out of activation. Both rows name
  // the real entry source, which exists.
  const entry = 'src/host/backend/productionMediaEntry.ts'
  expect(DEFERRED_OUTFILES.get(path.resolve(entry))).toBe('dist/productionMedia.js')
  const media = DEFERRED.find((bundle) => bundle.output === 'dist/productionMedia.js')
  expect(media?.files).toContain(entry)
})

it('names the helpers bundle by the methods that load it', () => {
  const row = LAZY_BUNDLES.find((entry) => entry.file === 'modelApiTools.js')
  expect(row?.side).toBe('both')
  // Every loader, with its sides: the turn's tool assist and RLLIMITS'
  // paged search and listing calls.
  expect(
    row?.requestedBy.map(({ importer, symbol, side }) => [importer, symbol, side.join(' ')]),
  ).toEqual([
    ['src/core/backends/modelapi/ModelApiHost.ts', 'ModelApiSession.toolAssist', 'acp vscode'],
    ['src/core/backends/modelapi/tools.ts', 'loadSearchCalls', 'acp vscode'],
  ])
})

it('names the effort catalogue bundle by the spawn that preloads it', () => {
  expect(LAZY_BUNDLES.find((entry) => entry.file === 'modelEfforts.js')).toEqual({
    file: 'modelEfforts.js',
    side: 'both',
    requestedBy: [
      {
        importer: 'src/host/backend/museCodeBackendManager.ts',
        symbol: 'MuseCodeBackendManager.spawn',
        side: ['acp', 'vscode'],
      },
    ],
  })
})

function fixtureTree(files: Record<string, string>): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-lazy-stray-'))
  folders.push(folder)
  mkdirSync(path.join(folder, 'src'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(folder, 'src', name), content)
  }
  return folder
}

const scanOf = (files: Record<string, string>) => scanRequests(fixtureTree(files), GENERATED)
const valuesOf = (files: Record<string, string>) =>
  scanOf(files)
    .requests.map((request) => request.value)
    .toSorted((a, b) => a.localeCompare(b, 'en'))

it('rows only what the build emits: stale records and dist leftovers never count', () => {
  // RLF-HYGIENE: a leftover another run left in dist/ (dev test bundles,
  // the traffic harness) and a metafile left by another build (a removed
  // bundle) broke `npm run build` on three rigs with phantom registry
  // rows. Rows come from metafile outputs on disk plus the named
  // non-esbuild files; nothing is discovered by walking dist/.
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-lazy-known-'))
  folders.push(folder)
  const metaDir = path.join(folder, 'dist', 'meta')
  mkdirSync(metaDir, { recursive: true })
  mkdirSync(path.join(folder, 'dist', 'test', 'integration'), { recursive: true })
  mkdirSync(path.join(folder, 'dist', 'traffic-harness'), { recursive: true })
  mkdirSync(path.join(folder, 'dist', 'chunks'), { recursive: true })
  writeFileSync(
    path.join(metaDir, 'current.json'),
    JSON.stringify({
      inputs: { 'src/current.ts': { bytes: 10, imports: [] } },
      outputs: {
        'dist/current.js': {
          bytes: 20,
          inputs: { 'src/current.ts': { bytesInOutput: 10 } },
          imports: [{ path: './chunks/hashed.js', kind: 'dynamic-import' }],
        },
        'dist/chunks/hashed.js': {
          bytes: 5,
          inputs: { 'src/chunk.ts': { bytesInOutput: 5 } },
          imports: [],
        },
        'dist/current.js.map': { bytes: 3, inputs: {}, imports: [] },
      },
    }),
  )
  writeFileSync(
    path.join(metaDir, 'stale.json'),
    JSON.stringify({
      inputs: { 'src/removed.ts': { bytes: 10, imports: [] } },
      outputs: {
        'dist/stale.js': {
          bytes: 20,
          inputs: { 'src/removed.ts': { bytesInOutput: 10 } },
          imports: [],
        },
      },
    }),
  )
  writeFileSync(path.join(folder, 'dist', 'current.js'), 'current\n')
  writeFileSync(path.join(folder, 'dist', 'chunks', 'hashed.js'), 'chunk\n')
  writeFileSync(path.join(folder, 'dist', 'providerCatalog.js'), 'catalog\n')
  writeFileSync(path.join(folder, 'dist', 'test', 'integration', 'leftover.test.js'), 'test\n')
  writeFileSync(path.join(folder, 'dist', 'traffic-harness', 'main.js'), 'harness\n')
  const emitted = new Set<string>()
  const inputChunks = new Map<string, Set<string>>()
  const importEdges = new Map<string, Set<string>>()
  readMetafiles(metaDir, folder, emitted, inputChunks, importEdges)
  expect([...emitted].toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
    'dist/chunks/hashed.js',
    'dist/current.js',
  ])
  expect(importEdges.get('dist/current.js')).toEqual(new Set(['dist/chunks/hashed.js']))
  expect(inputChunks.get('src/current.ts')).toEqual(
    new Set(['dist/chunks/hashed.js', 'dist/current.js']),
  )
  expect([...knownBundleOutputs(emitted)].toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
    'dist/current.js',
    'dist/providerCatalog.js',
  ])
})

it('fails a real stray: a lazy import of a file no row covers (R2 drill)', () => {
  const folder = fixtureTree({
    'loader.ts': `export async function load() {\n  return import('./rogueEntry.js')\n}\n`,
  })
  const { requests } = scanRequests(folder, GENERATED)
  expect(requests).toEqual([
    { importer: 'src/loader.ts', line: 2, symbol: 'load', value: './rogueEntry.js' },
  ])
  const known = new Set(LAZY_BUNDLES.map((entry) => entry.file))
  const outside = requests.filter((request) => {
    const outcome = resolveRequest(folder, DEFERRED_OUTFILES, request)
    if (outcome.bundled === true) return false
    const distFile = outcome.mapped ?? outcome.file ?? request.value
    return [...known].every((file) => file !== distFile && !file.endsWith(`/${distFile}`))
  })
  expect(outside.map((request) => request.value)).toEqual(['./rogueEntry.js'])
})

it('catches the shapes the old scan skipped (P2-2 a, b, c)', () => {
  expect(
    valuesOf({
      // (a) relative names: createRequire with a relative chunk.
      'relative.ts': `import { createRequire } from 'node:module'\nconst need = createRequire(__filename)\nexport const bundle: unknown = need('./rogue.js')\n`,
      // (b) a constant on a line with no loader hint.
      'consts.ts': `export const FOO_SCRIPT_FILE = 'foo.js'\n`,
      // (c) concatenation: a path stem plus the .js fragment.
      'concat.ts': `export async function load() {\n  return import('./rogue3' + '.js')\n}\n`,
    }),
  ).toEqual(['./rogue.js', './rogue3.js', 'foo.js'])
})

// Review RVDIET0181: the line scan took only ' and " for a string, so a
// template named nothing, and a computed name left no trace at all.
it('reads a template with no substitution as the literal it is', () => {
  const scan = scanOf({
    'plain.ts': 'export const load = () => import(`./rogueEntry.js`)\n',
    'held.ts': 'export const ROGUE_SCRIPT_FILE = `rogue.js`\n',
  })
  expect(scan.requests).toEqual([
    {
      importer: 'src/held.ts',
      line: 1,
      symbol: 'ROGUE_SCRIPT_FILE',
      value: 'rogue.js',
      identifier: 'ROGUE_SCRIPT_FILE',
    },
    { importer: 'src/plain.ts', line: 1, symbol: 'load', value: './rogueEntry.js' },
  ])
  expect(scan.computed).toEqual([])
})

it('records a load whose file name is worked out at run time, in every form', () => {
  const { requests, computed } = scanOf({
    'template.ts': 'export const load = (name: string) => import(`./${name}.js`)\n',
    'variable.ts': 'export const load = (name: string) => import(name)\n',
    'required.ts':
      "import { createRequire } from 'node:module'\nconst need = createRequire(__filename)\nexport const viaName = (file: string): unknown => need(file)\nexport const direct = (file: string): unknown => createRequire(file)(file)\n",
    'worker.ts':
      "import { Worker } from 'node:worker_threads'\nexport const start = (workerPath: string) =>\n  new Worker(workerPath, { workerData: 1 })\n",
  })
  expect(requests).toEqual([])
  expect(computed).toEqual([
    { importer: 'src/required.ts', line: 3, call: 'need(file)' },
    { importer: 'src/required.ts', line: 4, call: 'createRequire(file)(file)' },
    { importer: 'src/template.ts', line: 1, call: 'import(`./${name}.js`)' },
    { importer: 'src/variable.ts', line: 1, call: 'import(name)' },
    { importer: 'src/worker.ts', line: 3, call: 'new Worker(workerPath)' },
  ])
})

it('follows a load whose argument holds the name, and leaves text in a string alone', () => {
  const { requests, computed } = scanOf({
    // The reviewed form the old scan skipped by its shape (path.dirname with
    // path.join on one line): followed like any other.
    'beside.ts':
      "import path from 'node:path'\nexport const agentBeside = (bundleFile: string) =>\n  require(path.join(path.dirname(bundleFile), 'sibling.js'))\n",
    'byConstant.ts':
      "const ROGUE_ENTRY = './rogueEntry.js'\nexport const load = () => import(ROGUE_ENTRY)\n",
    'workerLiteral.ts':
      "import path from 'node:path'\nimport { Worker } from 'node:worker_threads'\nexport const start = () => new Worker(path.join(__dirname, 'rogueWorker.js'))\n",
    // Script text handed to a child process is a string, not a load.
    'script.ts': "export const SCRIPT = 'return import(pathToFileURL(plugin).href);'\n",
  })
  expect(
    requests.map((request) => `${request.importer} ${request.symbol} ${request.value}`),
  ).toEqual([
    'src/beside.ts agentBeside sibling.js',
    'src/byConstant.ts ROGUE_ENTRY ./rogueEntry.js',
    'src/workerLiteral.ts start rogueWorker.js',
  ])
  expect(computed).toEqual([])
})

it('reads a name wrapped onto a line of its own', () => {
  expect(
    valuesOf({
      'wrapped.ts':
        "declare const loadBundle: (...parts: string[]) => unknown\ndeclare const distDir: string\nexport const bundle = loadBundle(\n  distDir,\n  'wrapped.js',\n)\n",
      // A bare name beside nothing that loads is data.
      'listed.ts': "export const NAMES = [\n  'listed.js',\n]\n",
    }),
  ).toEqual(['wrapped.js'])
})

it('counts a constant loaded in the file that defines it', () => {
  const { uses, usesLoad } = scanOf({
    'same.ts':
      "import path from 'node:path'\ndeclare const loadBundle: (file: string) => unknown\nconst ROGUE_FILE = 'rogue.js'\nexport const load = () => loadBundle(path.join(__dirname, ROGUE_FILE))\n",
    'idle.ts': "export const IDLE_FILE = 'idle.js'\n",
  })
  expect(uses.get('ROGUE_FILE')).toEqual([])
  expect(usesLoad.get('ROGUE_FILE')).toEqual(['src/same.ts'])
  // Defined and never read: no loader, so the generator makes no request of it.
  expect(usesLoad.get('IDLE_FILE')).toEqual([])
})

it('fails a computed load that is not listed, and a listed one that is gone', () => {
  const computed = [{ importer: 'src/loader.ts', line: 7, call: 'import(name)' }]
  const listed = [{ importer: 'src/loader.ts', call: 'import(name)', reason: 'a test' }]
  expect(computedLoadFailures(computed, listed)).toEqual([])
  expect(computedLoadFailures(computed, [])).toEqual([
    'src/loader.ts:7 loads a file whose name is worked out at run time (import(name)): name the file in a literal, or list the load with its reason in COMPUTED_SOURCE_LOADS (scripts/lib/lazyRegistry.mjs)',
  ])
  expect(computedLoadFailures([], listed)).toEqual([
    'COMPUTED_SOURCE_LOADS lists import(name) in src/loader.ts, which the source no longer holds: remove the entry',
  ])
  // A listed load in another file is another load.
  expect(
    computedLoadFailures([{ importer: 'src/other.ts', line: 1, call: 'import(name)' }], listed),
  ).toHaveLength(2)
  for (const entry of COMPUTED_SOURCE_LOADS) {
    expect(entry.importer).toMatch(/^src\//u)
    expect(entry.reason.length).toBeGreaterThan(0)
  }
})

// The 0.18.1 candidate's static-analysis red: the scan built an expression
// from each scanned constant's name. It now searches for the name as text.
it('reads a bundle-name constant only as a whole name, a dollar sign included', () => {
  expect(hasIdentifier('FOO_FILE', 'FOO_FILE')).toBe(true)
  expect(hasIdentifier('load(distDir, FOO_FILE)', 'FOO_FILE')).toBe(true)
  expect(hasIdentifier('load(FOO_FILES, FOO_FILE)', 'FOO_FILE')).toBe(true)
  expect(hasIdentifier('load(MY_FOO_FILE)', 'FOO_FILE')).toBe(false)
  expect(hasIdentifier('load(FOO_FILES)', 'FOO_FILE')).toBe(false)
  expect(hasIdentifier('load($FOO_FILE)', 'FOO_FILE')).toBe(false)
  expect(hasIdentifier('load(FOO_FILE$)', 'FOO_FILE')).toBe(false)
  expect(hasIdentifier('load(FOO_FILE)', '')).toBe(false)
  const { uses, usesLoad, computed } = scanOf({
    'names.ts': "export const $ROGUE_FILE = 'rogue.js'\n",
    'loader.ts':
      "import { $ROGUE_FILE } from './names'\nexport const load = () => import(path.join(__dirname, $ROGUE_FILE))\n",
    'label.ts':
      "import { $ROGUE_FILE } from './names'\nexport const label = () => 'bundle ' + $ROGUE_FILE\n",
    'other.ts': "export const $ROGUE_FILES = ['a']\nexport const count = $ROGUE_FILES.length\n",
  })
  expect(new Set(uses.get('$ROGUE_FILE'))).toEqual(new Set(['src/label.ts', 'src/loader.ts']))
  expect(usesLoad.get('$ROGUE_FILE')).toEqual(['src/loader.ts'])
  expect(computed).toEqual([])
})

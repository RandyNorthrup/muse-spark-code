// RVMODELAPIDIETB P2, closed structurally in MODELAPIDIETR4
// (RVAPP-MODELAPIDIET3 P2-1/P2-2/P2-3): the lazy-bundle registry is GENERATED
// by scripts/gen-lazy-registry.mjs from the production build (its metafiles)
// and the deferred redirect map, not copied by hand. This suite reads that
// one artifact back: rows are well-formed, every dist name the sources load
// by file name resolves to a row (a planted stray fails here AND fails
// `gen-lazy-registry.mjs --check` with a non-zero exit, drill in
// docs/certification/modelapi-diet.md), and every row's side covers the
// sides its loaders need, so a package missing a loadable bundle fails.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { LAZY_BUNDLES } from '../../src/shared/lazyBundles.generated'
import { DEFERRED_OUTFILES } from '../../scripts/lib/deferredBundles.mjs'
import { resolveRequest, scanRequests } from '../../scripts/lib/lazyRegistry.mjs'
import { removeFolder } from './helpers/temporaryFolders'

const root = process.cwd()
const GENERATED = 'src/shared/lazyBundles.generated.ts'
const folders: string[] = []
afterEach(async () => {
  while (folders.length > 0) await removeFolder(folders.pop()!)
})

it('holds one well-formed entry per bundle', () => {
  const files = LAZY_BUNDLES.map((entry) => entry.file)
  expect(new Set(files).size).toBe(files.length)
  for (const entry of LAZY_BUNDLES) {
    expect(entry.file).toMatch(/^([a-z]+\/)?[A-Za-z0-9_.-]+\.js$/u)
    expect(['vscode', 'acp', 'both', 'unreached'].includes(entry.side)).toBe(true)
    for (const asked of entry.requestedBy) {
      expect(asked.importer).toMatch(/^src\//u)
      expect(asked.line).toBeGreaterThan(0)
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

it('resolves every dist name the sources load to a registry row', () => {
  const known = new Set(LAZY_BUNDLES.map((entry) => `dist/${entry.file}`))
  const { requests, dynamics } = scanRequests(root, GENERATED)
  expect(dynamics).toEqual([])
  const outside: string[] = []
  for (const request of requests) {
    const outcome = resolveRequest(root, DEFERRED_OUTFILES, request)
    if (outcome.bundled === true) continue
    const distFile = outcome.mapped ?? outcome.file ?? request.value
    const isKnown = [...known].some(
      (file) => file === `dist/${distFile}` || file.endsWith(`/${distFile}`),
    )
    if (!isKnown) outside.push(`${request.importer}:${String(request.line)} names ${request.value}`)
  }
  expect(outside).toEqual([])
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

it('fails a real stray: a lazy import of a file no row covers (R2 drill)', () => {
  const folder = fixtureTree({
    'loader.ts': `export async function load() {\n  return import('./rogueEntry.js')\n}\n`,
  })
  const { requests } = scanRequests(folder, 'src/skip.generated.ts')
  expect(requests.map((request) => request.value)).toEqual(['./rogueEntry.js'])
  const known = new Set(LAZY_BUNDLES.map((entry) => entry.file))
  const outside = requests.filter((request) => {
    const outcome = resolveRequest(folder, DEFERRED_OUTFILES, request)
    if (outcome.bundled === true) return false
    const distFile = outcome.mapped ?? outcome.file ?? request.value
    return [...known].every((file) => file !== `dist/${distFile}` && !file.endsWith(`/${distFile}`))
  })
  expect(outside.map((request) => request.value)).toEqual(['./rogueEntry.js'])
})

it('catches the shapes the old scan skipped (P2-2 a, b, c)', () => {
  const folder = fixtureTree({
    // (a) relative names: createRequire with a relative chunk.
    'relative.ts': `import { createRequire } from 'node:module'\nconst need = createRequire(__filename)\nexport const bundle: unknown = need('./rogue.js')\n`,
    // (b) a constant on a line with no loader hint.
    'consts.ts': `export const FOO_SCRIPT_FILE = 'foo.js'\n`,
    // (c) concatenation: a path stem plus the .js fragment.
    'concat.ts': `export async function load() {\n  return import('./rogue3' + '.js')\n}\n`,
  })
  const { requests } = scanRequests(folder, 'src/skip.generated.ts')
  const values = requests
    .map((request) => request.value)
    .toSorted((a, b) => a.localeCompare(b, 'en'))
  expect(values).toEqual(['./rogue.js', './rogue3.js', 'foo.js'])
})

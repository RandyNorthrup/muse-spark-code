import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, inject, it } from 'vitest'
import { listFiles } from '@vscode/vsce/out/package.js'
import { ACP_BUNDLES, acpUsageAssets } from '../../scripts/lib/acpBundles.mjs'
import { LAZY_BUNDLES } from '../../src/shared/lazyBundles.generated'
import { PRODUCTION_BUILD_KEY, buildProductionPackage } from './helpers/productionPackage'
import { removeFolder } from './helpers/temporaryFolders'

// This suite owns a complete copy of the once-per-run shared production
// build (test/unit/globalSetup.mjs): building the product inside this hook
// timed out at 60 s on Windows (PR 163), while sibling runs passed in
// 27–42 s. The copy still stands on the real packed product; only the
// build moved out of the hook's deadline.
const PRODUCTION_SETUP_TIMEOUT_MS = 60_000
// Six runs of the registry command over that build, four of them complete:
// each reads every source that can load a file and inventories the VSIX
// (3.2 s a run on the Kubuntu rig).
const REGISTRY_COMMAND_RUNS_TIMEOUT_MS = 180_000
// Removing the complete build copy after the run deletes thousands of
// files; on a loaded machine that alone passes the 10 s hook default
// with every case green, so the removal carries its own named budget.
const FIXTURE_REMOVAL_TIMEOUT_MS = 60_000
const REGISTRY = 'src/shared/lazyBundles.generated.ts'
const root = process.cwd()
const fixture = { folder: '', missing: undefined }
const command = {}

const normalized = (file) => file.replaceAll('\\', '/')
const isChunk = (file) => /^dist\/[^/]+\.js$/u.test(file)

// Traverse the production build's own imports, including dependencies of a
// missing chunk. No bundle names are maintained by this test.
function reachableChunks(outputs, roots) {
  const reached = new Set(roots)
  const pending = [...roots]
  while (pending.length > 0) {
    const referrer = pending.pop()
    const imports = outputs.get(referrer)?.imports ?? []
    for (const imported of imports) {
      const file = normalized(imported.path)
      const target = file.startsWith('.')
        ? path.posix.join(path.posix.dirname(referrer), file)
        : file
      if (!isChunk(target) || reached.has(target)) continue
      reached.add(target)
      pending.push(target)
    }
  }
  return reached
}

function absent(reached, packaged) {
  return [...reached.difference(packaged)].toSorted((left, right) =>
    left.localeCompare(right, 'en'),
  )
}

beforeAll(async () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-packaged-bundles-'))
  fixture.folder = folder
  // The production schema generator reads this formatter config too.
  cpSync(path.join(root, '.prettierrc.json'), path.join(folder, '.prettierrc.json'))
  // A copy of the shared production build, never a rebuild here: a build
  // failure is reported by the global setup with its own diagnostics.
  buildProductionPackage(root, folder, inject(PRODUCTION_BUILD_KEY))
  const outputs = new Map()
  const vscodeOutputs = new Set()
  const acpEntries = new Set()
  // Every emitted dist script: the metafiles, plus files the build writes
  // without esbuild (dist/providerCatalog.js is a JSON wrapper written by
  // scripts/build.mjs itself). Webview files below dist/ are included, even
  // though the import traversal above does not follow them.
  const builtOutputs = new Set()
  const collectEmitted = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const name of entries) {
      const file = path.join(directory, name.name)
      if (name.isDirectory()) collectEmitted(file)
      else if (name.name.endsWith('.js')) builtOutputs.add(normalized(path.relative(folder, file)))
    }
  }
  for (const side of ['meta', 'meta-acp']) {
    const directory = path.join(folder, 'dist', side)
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.json')) continue
      const meta = JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
      for (const [output, details] of Object.entries(meta.outputs)) {
        const file = normalized(output)
        if (file.startsWith('dist/') && file.endsWith('.js')) builtOutputs.add(file)
        if (!isChunk(file)) continue
        outputs.set(file, details)
        if (side === 'meta') vscodeOutputs.add(file)
        else acpEntries.add(file)
      }
    }
  }
  // VSCE scans before exclusions. Inventory the actual production outputs in
  // an owned publication tree so source/test fixtures do not slow its scan.
  const inventory = path.join(folder, 'inventory')
  mkdirSync(inventory)
  for (const file of ['package.json', '.vscodeignore'])
    cpSync(path.join(root, file), path.join(inventory, file))
  cpSync(path.join(folder, 'dist'), path.join(inventory, 'dist'), { recursive: true })
  const listed = await listFiles({ cwd: inventory, dependencies: false })
  const vsix = new Set(listed.map((file) => normalized(file)))
  // The agent carries the bundle list plus the usage page's asset closure,
  // exactly what scripts/package-acp.mjs stages.
  const acp = new Set(
    [...ACP_BUNDLES, ...acpUsageAssets(folder).map((file) => file.replace(/^dist\//, ''))].map(
      (file) => `dist/${file}`,
    ),
  )
  collectEmitted(path.join(folder, 'dist'))
  // VS Code also loads command/worker entries by path. The registry names
  // every filename-loaded chunk independently of either package inventory,
  // so an entry dropped from an allowlist stays a root and is reported.
  // Start from those roots plus every production entry the allowlist ships,
  // then follow static/dynamic imports. ACP likewise roots its packager's
  // shared list.
  // The generated registry's sides are derived, not hand-set: a row the VS
  // Code process loads must ship in the VSIX, one the agent loads in its
  // package. `unreached` rows ship per the inventories below without a side.
  const registry = LAZY_BUNDLES
  const registryVsix = new Set(
    registry
      .filter((entry) => entry.side === 'vscode' || entry.side === 'both')
      .map((entry) => `dist/${entry.file}`),
  )
  const registryAcp = new Set(
    registry
      .filter((entry) => entry.side === 'acp' || entry.side === 'both')
      .map((entry) => `dist/${entry.file}`),
  )
  const vscodeRoots = vscodeOutputs.intersection(vsix).union(registryVsix)
  const acpRoots = new Set([
    ...acpEntries,
    ...[...acp].filter((file) => isChunk(file)),
    ...registryAcp,
  ])
  fixture.missing = {
    VSIX: absent(reachableChunks(outputs, vscodeRoots), vsix),
    ACP: absent(reachableChunks(outputs, acpRoots), acp),
    registryVsix: absent(registryVsix, vsix),
    registryAcp: absent(registryAcp, acp),
    unbuilt: absent(new Set(registry.map((entry) => `dist/${entry.file}`)), builtOutputs),
  }
}, PRODUCTION_SETUP_TIMEOUT_MS)

// scripts/gen-lazy-registry.mjs is a command: it is run as one, the way
// `npm run build` runs it, over this suite's own copy of the repository and
// its real production build. Importing its logic and calling it would pass
// while the command did nothing, which is how its gate shipped empty
// (docs/certification/hotfix-0181-bundle-exports.md).
function registryCommand(script, ...argv) {
  const run = spawnSync(process.execPath, [script, ...argv], {
    cwd: fixture.folder,
    encoding: 'utf8',
  })
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` }
}

beforeAll(() => {
  const folder = fixture.folder
  const script = path.join(folder, 'scripts', 'gen-lazy-registry.mjs')
  const registry = path.join(folder, REGISTRY)
  cpSync(path.join(root, '.vscodeignore'), path.join(folder, '.vscodeignore'))
  const committed = readFileSync(registry, 'utf8')
  command.committed = committed.replaceAll('\r\n', '\n')
  command.current = registryCommand(script, '--check')
  // A row edited by hand: the file no longer says what the build gives.
  writeFileSync(
    registry,
    committed.replace(
      "symbol: 'ModelApiSession.toolAssist'",
      "symbol: 'ModelApiSession.elsewhere'",
    ),
  )
  command.stale = registryCommand(script, '--check')
  command.generate = registryCommand(script)
  command.generated = readFileSync(registry, 'utf8')
  // A loader of a file no build emits and a load by a computed name, with
  // the command reached through a linked folder (a junction on Windows):
  // a script that asks "am I the main module" by comparing paths runs
  // nothing there and exits 0.
  const planted = path.join(folder, 'src', 'rogueLoader.ts')
  writeFileSync(
    planted,
    "export const load = (): Promise<unknown> => import('./rogueEntry.js')\nexport const named = (name: string): Promise<unknown> => import(name)\n",
  )
  const linked = path.join(folder, 'linked-scripts')
  symlinkSync(path.join(folder, 'scripts'), linked, 'junction')
  command.planted = registryCommand(path.join(linked, 'gen-lazy-registry.mjs'), '--check')
  rmSync(planted)
  // No input, no pass: the agent build's metafiles empty, then absent.
  const metafiles = path.join(folder, 'dist', 'meta-acp')
  renameSync(metafiles, `${metafiles}.kept`)
  mkdirSync(metafiles)
  command.empty = registryCommand(script, '--check')
  rmSync(metafiles, { recursive: true })
  command.absent = registryCommand(script, '--check')
  renameSync(`${metafiles}.kept`, metafiles)
}, REGISTRY_COMMAND_RUNS_TIMEOUT_MS)

afterAll(async () => {
  if (fixture.folder !== '') await removeFolder(fixture.folder)
}, FIXTURE_REMOVAL_TIMEOUT_MS)

it('ships every reachable production chunk in the VSIX and ACP package', () => {
  expect(fixture.missing).toMatchObject({ VSIX: [], ACP: [] })
})

it('ships every registry bundle in the packages that load it (RVMODELAPIDIETB P2)', () => {
  expect(fixture.missing).toMatchObject({ registryVsix: [], registryAcp: [] })
})

it('builds every registry bundle (RVMODELAPIDIETB P2)', () => {
  expect(fixture.missing).toMatchObject({ unbuilt: [] })
})

it('passes the registry command on this build and says what it compared', () => {
  expect(command.current.status, command.current.output).toBe(0)
  expect(command.current.output).toMatch(
    /ok {3}lazy registry: \d+ bundles, \d+ loads by file name resolved, \d+ listed load\(s\) by a computed name, \d+ listed name\(s\) that are not a load; src\/shared\/lazyBundles\.generated\.ts is current/u,
  )
})

it('fails the registry command on a stale file and names the row', () => {
  expect(command.stale.status, command.stale.output).toBe(1)
  expect(command.stale.output).toContain(`lazy registry: ${REGISTRY} row modelApiTools.js says`)
  expect(command.stale.output).toContain("symbol: 'ModelApiSession.elsewhere'")
  expect(command.stale.output).toContain("symbol: 'ModelApiSession.toolAssist'")
})

it('writes the registry the repository commits', () => {
  expect(command.generate.status, command.generate.output).toBe(0)
  expect(command.generate.output).toContain(`${REGISTRY} written`)
  expect(command.generated).toBe(command.committed)
})

it('fails on a planted loader and on a computed load, reached through a linked folder', () => {
  expect(command.planted.status, command.planted.output).toBe(1)
  expect(command.planted.output).toContain(
    'lazy registry: src/rogueLoader.ts:1 (load) loads ./rogueEntry.js, which the build does not emit',
  )
  expect(command.planted.output).toContain(
    'lazy registry: src/rogueLoader.ts:2 loads a file whose name is worked out at run time (import(name))',
  )
})

it('fails without the build metafiles, empty or absent, and never passes on no input', () => {
  expect(command.empty.status, command.empty.output).toBe(1)
  expect(command.empty.output).toContain('lazy registry: dist/meta-acp holds no metafile')
  expect(command.absent.status, command.absent.output).toBe(1)
  expect(command.absent.output).toContain('lazy registry: dist/meta-acp cannot be read')
})

import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { listFiles } from '@vscode/vsce/out/package.js'
import { ACP_BUNDLES } from '../../scripts/lib/acpBundles.mjs'
import { buildProductionPackage } from './helpers/productionPackage'
import { removeFolder } from './helpers/temporaryFolders'

// A real production build and VSCE's inventory run once before assertions;
// cold builds on hosted runners exceed the ordinary ten-second hook deadline.
const PRODUCTION_SETUP_TIMEOUT_MS = 60_000
const root = process.cwd()
const fixture = { folder: '', missing: undefined }

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
  try {
    buildProductionPackage(root, folder)
  } catch (error) {
    throw new Error(readFileSync(path.join(folder, 'build.log'), 'utf8'), { cause: error })
  }
  const outputs = new Map()
  const vscodeOutputs = new Set()
  const acpEntries = new Set()
  for (const side of ['meta', 'meta-acp']) {
    const directory = path.join(folder, 'dist', side)
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.json')) continue
      const meta = JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
      for (const [output, details] of Object.entries(meta.outputs)) {
        const file = normalized(output)
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
  const acp = new Set(ACP_BUNDLES.map((file) => `dist/${file}`))
  // VS Code also loads command/worker entries by path. Start from every
  // production entry its real allowlist ships, then follow static/dynamic
  // imports. ACP starts from its build entries and its packager's shared list.
  const vscodeRoots = vscodeOutputs.intersection(vsix)
  const acpRoots = new Set([...acpEntries, ...[...acp].filter((file) => isChunk(file))])
  fixture.missing = {
    VSIX: absent(reachableChunks(outputs, vscodeRoots), vsix),
    ACP: absent(reachableChunks(outputs, acpRoots), acp),
  }
}, PRODUCTION_SETUP_TIMEOUT_MS)

afterAll(async () => {
  if (fixture.folder !== '') await removeFolder(fixture.folder)
})

it('ships every reachable production chunk in the VSIX and ACP package', () => {
  expect(fixture.missing).toEqual({ VSIX: [], ACP: [] })
})

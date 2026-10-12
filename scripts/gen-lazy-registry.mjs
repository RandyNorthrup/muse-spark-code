// Build the lazy-bundle registry FROM the build itself (MODELAPIDIETR4,
// review RVAPP-MODELAPIDIET3 P2-1/P2-3): the bundles (the production
// metafiles' emitted chunks plus files the build writes without esbuild),
// which process loads each (propagated from the products' own entries along
// the import graph and the filename requests), which bundle each lazy import
// resolves to (the deferred redirect map), and which package must carry it
// (the loading side's own inventory: vsce over the real .vscodeignore for
// the VSIX, scripts/lib/acpBundles.mjs for the agent). Writes
// src/shared/lazyBundles.generated.ts; --check fails the build when a
// loader names a bundle the registry does not know, when a package lacks a
// bundle its loaders can ask for, or when the committed file is stale.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listFiles } from '@vscode/vsce/out/package.js'
import { ACP_BUNDLES, acpUsageAssets } from './lib/acpBundles.mjs'
import { DEFERRED_OUTFILES } from './lib/deferredBundles.mjs'
import { resolveRequest, scanRequests, hasIdentifier } from './lib/lazyRegistry.mjs'

const root = process.cwd()
const GENERATED = 'src/shared/lazyBundles.generated.ts'
const WEBVIEW_HINTS = ['asWebviewUri', 'bundleRoot']
const DIST_PREFIX_LENGTH = 'dist/'.length

const byName = (a, b) => a.localeCompare(b, 'en')

function forwardSlashes(file) {
  return file.replaceAll('\\', '/')
}

function readMetafiles(directory, emitted, inputChunks, importEdges) {
  const names = readdirSync(directory)
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const meta = JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
    const outputs = Object.entries(meta.outputs)
    const chunks = []
    for (const [output] of outputs) {
      const file = forwardSlashes(output)
      if (file.startsWith('dist/') && file.endsWith('.js')) chunks.push(file)
    }
    for (const file of chunks) emitted.add(file)
    for (const [output, details] of outputs) {
      const file = forwardSlashes(output)
      if (!chunks.includes(file)) continue
      const imports = details.imports ?? []
      for (const imported of imports) {
        const joined = imported.path.startsWith('.')
          ? path.posix.join(path.posix.dirname(file), imported.path)
          : imported.path
        const target = forwardSlashes(joined)
        if (!target.startsWith('dist/') || !target.endsWith('.js')) continue
        const edges = importEdges.get(file) ?? new Set()
        edges.add(target)
        importEdges.set(file, edges)
      }
    }
    const inputs = Object.keys(meta.inputs ?? {})
    for (const input of inputs) {
      const file = forwardSlashes(input)
      const containing = inputChunks.get(file) ?? new Set()
      for (const chunk of chunks) containing.add(chunk)
      inputChunks.set(file, containing)
    }
  }
}

function onDiskDist(distDir) {
  const found = []
  const walk = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name.endsWith('.js')) found.push(forwardSlashes(path.relative(distDir, file)))
    }
  }
  walk(distDir)
  return found
}

async function vsixInventory() {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-lazy-registry-'))
  const inventory = path.join(folder, 'inventory')
  mkdirSync(inventory)
  const manifestFiles = ['package.json', '.vscodeignore']
  for (const file of manifestFiles) {
    cpSync(path.join(root, file), path.join(inventory, file))
  }
  cpSync(path.join(root, 'dist'), path.join(inventory, 'dist'), { recursive: true })
  const { rm } = await import('node:fs/promises')
  try {
    const listed = await listFiles({ cwd: inventory, dependencies: false })
    return new Set(listed.map((file) => forwardSlashes(file)))
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

function useLines(file, identifier) {
  if (identifier === undefined) return []
  const text = readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n')
  return text.split('\n').filter((line) => hasIdentifier(line, identifier))
}

function sideName(sides) {
  if (sides.has('vscode') && sides.has('acp')) return 'both'
  const [only] = sides
  return only ?? 'unreached'
}

export async function buildRegistry() {
  const emitted = new Set()
  const inputChunks = new Map()
  const importEdges = new Map()
  readMetafiles(path.join(root, 'dist', 'meta'), emitted, inputChunks, importEdges)
  readMetafiles(path.join(root, 'dist', 'meta-acp'), emitted, inputChunks, importEdges)
  const distDir = path.join(root, 'dist')
  const onDisk = existsSync(distDir) ? onDiskDist(distDir) : []
  // Bundler-internal webview chunks (content-hashed, never filename-loaded)
  // are not rows: the registry names stable bundles. They still carry import
  // edges and input attribution below.
  const known = new Set()
  for (const file of emitted) known.add(file)
  for (const file of onDisk) {
    if (!file.includes('/chunks/')) known.add(`dist/${file}`)
  }
  const scan = scanRequests(root, GENERATED)
  const skipped = []
  // Resolve every request: a redirect target, a dist file, or a bundled
  // import the build inlines (never a runtime load).
  const resolved = []
  const unknown = []
  const requests = scan.requests
  for (const request of requests) {
    const outcome = resolveRequest(root, DEFERRED_OUTFILES, request)
    if (outcome.bundled === true) continue
    const distFile = outcome.mapped ?? outcome.file ?? request.value
    const candidates = []
    for (const file of known) {
      if (file === `dist/${distFile}` || file.endsWith(`/${distFile}`)) candidates.push(file)
    }
    if (candidates.length === 0) {
      const want =
        typeof outcome.mapped === 'string' ? ` (redirect target dist/${outcome.mapped})` : ''
      unknown.push(`${request.importer}:${String(request.line)} names ${request.value}${want}`)
      continue
    }
    // The load happens where the name is used, never where a shared constant
    // defines it: attribute the request to the files using it where a bundle
    // loads. A name nothing loads by (unused, or only framed/listed) is data,
    // never a request.
    let files = [request.importer]
    if (request.identifier !== undefined) {
      const used = scan.usesLoad.get(request.identifier) ?? []
      if (used.length === 0) {
        skipped.push(
          `${request.importer}:${String(request.line)} defines ${request.identifier}, which no loader reads`,
        )
        continue
      }
      files = used
    }
    const pick = (candidate) => {
      if (candidates.length === 1) return true
      const lines = []
      for (const file of files) {
        for (const line of useLines(file, request.identifier)) lines.push(line)
      }
      const isWebview = lines.some((line) => WEBVIEW_HINTS.some((hint) => line.includes(hint)))
      return candidate.startsWith('dist/webview/') === isWebview
    }
    const targets = candidates.filter((candidate) => pick(candidate))
    resolved.push({ request, files, targets })
  }
  // Sides propagate from the products' own entries: the manifest's main for
  // the VS Code extension host, the agent package's first bundle (its bin,
  // per scripts/lib/acpBundles.mjs) for the agent. Import edges and filename
  // requests carry each side to the chunks they can load.
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const sides = new Map([
    [forwardSlashes(manifest.main.replace(/^\.\//u, '')), new Set(['vscode'])],
    [`dist/${ACP_BUNDLES[0]}`, new Set(['acp'])],
  ])
  const requestEdges = new Map()
  for (const item of resolved) {
    const from = new Set()
    for (const file of item.files) {
      const containing = inputChunks.get(file)
      if (containing === undefined) continue
      for (const chunk of containing) from.add(chunk)
    }
    for (const target of item.targets) {
      const sources = requestEdges.get(target) ?? new Set()
      for (const chunk of from) sources.add(chunk)
      requestEdges.set(target, sources)
    }
  }
  const pending = sides.keys().toArray()
  while (pending.length > 0) {
    const chunk = pending.pop()
    if (chunk === undefined) continue
    const out = new Set()
    const direct = importEdges.get(chunk)
    if (direct !== undefined) {
      for (const target of direct) out.add(target)
    }
    for (const [target, sources] of requestEdges) {
      if (sources.has(chunk)) out.add(target)
    }
    for (const target of out) {
      if (!known.has(target)) continue
      const reached = sides.get(target) ?? new Set()
      sides.set(target, reached)
      const before = reached.size
      const incoming = sides.get(chunk) ?? new Set()
      for (const side of incoming) reached.add(side)
      if (reached.size > before) pending.push(target)
    }
  }
  const vsix = await vsixInventory()
  // The agent carries the bundle list plus the usage page's asset closure,
  // exactly what scripts/package-acp.mjs stages.
  const agentFiles = [...ACP_BUNDLES]
  for (const file of acpUsageAssets()) agentFiles.push(file.replace(/^dist\//u, ''))
  const acp = new Set(agentFiles.map((file) => `dist/${file}`))
  const rows = new Map()
  const getRow = (file) => {
    const row = rows.get(file) ?? { file, requestedBy: [] }
    rows.set(file, row)
    return row
  }
  for (const file of known) getRow(file.slice(DIST_PREFIX_LENGTH))
  // Chunks no process provably loads (no import edge, no filename request)
  // keep the side of the packages carrying them: removing a package could
  // break an invisible loader (the computed catalog adapter, an OS launcher).
  // requestedBy stays empty so the fallback is visible.
  const rowFiles = rows.keys().toArray()
  for (const file of rowFiles) {
    const reached = sides.get(`dist/${file}`) ?? new Set()
    if (reached.size > 0) continue
    const carrying = new Set()
    if (vsix.has(`dist/${file}`)) carrying.add('vscode')
    if (acp.has(`dist/${file}`)) carrying.add('acp')
    sides.set(`dist/${file}`, carrying)
  }
  // A request's loading sides: the fixpoint sides of the chunks containing
  // its files. A request from a file no chunk contains names a bundle no
  // process provably loads: both packages must carry it (fail closed).
  const requestSides = new Map()
  for (const item of resolved) {
    const at = new Set()
    for (const file of item.files) {
      const containing = inputChunks.get(file)
      if (containing === undefined) continue
      for (const chunk of containing) {
        const chunkSides = sides.get(chunk)
        if (chunkSides === undefined) continue
        for (const side of chunkSides) at.add(side)
      }
    }
    const both = new Set(['vscode', 'acp'])
    requestSides.set(item.request, at.size > 0 ? at : both)
    for (const target of item.targets) {
      const row = getRow(target.slice(DIST_PREFIX_LENGTH))
      const sidesNow = requestSides.get(item.request) ?? both
      row.requestedBy.push({
        importer: item.request.importer,
        line: item.request.line,
        side: sidesNow.values().toArray().toSorted(byName),
      })
    }
  }
  const gaps = []
  for (const row of rows.values()) {
    for (const asked of row.requestedBy) {
      if (asked.side.includes('vscode') && !vsix.has(`dist/${row.file}`)) {
        gaps.push(
          `${asked.importer}:${String(asked.line)} loads ${row.file} in VS Code, missing from the VSIX`,
        )
      }
      if (asked.side.includes('acp') && !acp.has(`dist/${row.file}`)) {
        gaps.push(
          `${asked.importer}:${String(asked.line)} loads ${row.file} in the agent, missing from its package`,
        )
      }
    }
  }
  const sideEntries = sides.entries().toArray()
  const requestDebug = resolved.map((item) => {
    const chunkSet = new Set()
    for (const file of item.files) {
      const containing = inputChunks.get(file)
      if (containing === undefined) continue
      for (const chunk of containing) chunkSet.add(chunk)
    }
    return {
      at: `${item.request.importer}:${String(item.request.line)}`,
      value: item.request.value,
      identifier: item.request.identifier ?? null,
      files: item.files,
      chunks: chunkSet.values().toArray().toSorted(byName),
      targets: item.targets,
    }
  })
  const unreached = []
  for (const chunk of known) {
    if (!sides.has(chunk)) unreached.push(chunk)
  }
  const debug = {
    sides: sideEntries
      .map(([chunk, set]) => [chunk, set.values().toArray()])
      .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]), 'en')),
    requests: requestDebug,
    unreached: unreached.toSorted(byName),
    skipped: skipped.toSorted(byName),
  }
  const list = rows
    .values()
    .map((row) => ({
      file: row.file,
      side: sideName(sides.get(`dist/${row.file}`) ?? new Set()),
      requestedBy: row.requestedBy
        .toSorted((a, b) => a.line - b.line)
        .toSorted((a, b) => a.importer.localeCompare(b.importer, 'en')),
    }))
    .toArray()
    .toSorted((a, b) => a.file.localeCompare(b.file, 'en'))
  return {
    rows: list,
    unknown: unknown.toSorted(byName),
    dynamics: scan.dynamics,
    gaps: gaps.toSorted(byName),
    debug,
  }
}

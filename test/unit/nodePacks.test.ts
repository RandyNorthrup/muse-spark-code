// The pack index and manager (M110t TP1/TP2): locked indexes verify
// before use, artifacts resume and digest-check, conflicts refuse in
// words, and experiences share packs by count. The fake server speaks
// the same HTTP the real one does (200, 206, digests).
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import type { PackArtifact, PackDefinition } from '../../src/runtime/node/packs/definition'
import { PACK_INDEX_VERSION, verifyIndex, type PackIndex } from '../../src/runtime/node/packs/index'
import { PackManager, type PackFetch } from '../../src/runtime/node/packs/manager'
import { toolchainsSchema } from '../../src/shared/toolchains'

const NOW = new Date('2026-06-01T00:00:00.000Z')
const FUTURE = '2027-01-01T00:00:00.000Z'
const PAST = '2026-01-01T00:00:00.000Z'

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeArtifact(
  name: string,
  version: string,
  content: string,
): { artifact: PackArtifact; bytes: Uint8Array } {
  const bytes = new TextEncoder().encode(content)
  return {
    bytes,
    artifact: {
      name,
      version,
      url: `https://packs.example/${name}-${version}.tar.gz`,
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.byteLength,
    },
  }
}

function makePack(
  name: string,
  artifacts: PackArtifact[],
  options: { requires?: string[]; constraints?: PackDefinition['constraints'] } = {},
): PackDefinition {
  return {
    name,
    version: '1.0.0',
    description: `the ${name} pack`,
    license: 'MIT',
    languages: name === 'base' ? [] : [name],
    requires: options.requires ?? (name === 'base' ? [] : ['base']),
    artifacts,
    checks: [{ name: `${name}-check`, command: [name, 'check'] }],
    constraints: options.constraints ?? [],
    clickThrough: false,
    checkedAt: '2026-05-01T00:00:00.000Z',
  }
}

function makeIndex(
  packs: PackDefinition[],
  options: { revision?: number; expiresAt?: string } = {},
): PackIndex {
  return {
    version: PACK_INDEX_VERSION,
    builtAt: '2026-06-01T00:00:00.000Z',
    expiresAt: options.expiresAt ?? FUTURE,
    builtBy: 'pack-ci-test',
    revision: options.revision ?? 1,
    packs,
  }
}

/** The fake pack server: index bytes with their digest, artifacts by URL. */
class FakeServer implements PackFetch {
  index: PackIndex
  readonly artifacts = new Map<string, Uint8Array>()
  failIndex: Error | undefined = undefined
  failArtifact: Error | undefined = undefined
  sendDigest = true
  rangeSupport = true
  signatureOk = true

  constructor(packs: PackDefinition[], options: { revision?: number; expiresAt?: string } = {}) {
    this.index = makeIndex(packs, options)
  }

  serve(artifact: PackArtifact, bytes: Uint8Array): void {
    this.artifacts.set(artifact.url, bytes)
  }

  indexBytes(): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(this.index))
  }

  fetchIndex(): Promise<{ index: PackIndex; bytes: Uint8Array; digest: string | undefined }> {
    if (this.failIndex !== undefined) throw this.failIndex
    const bytes = this.indexBytes()
    return Promise.resolve({
      index: this.index,
      bytes,
      digest: this.sendDigest ? sha256Hex(bytes) : undefined,
    })
  }

  fetchArtifact(url: string, fromByte: number): Promise<Response> {
    if (this.failArtifact !== undefined) throw this.failArtifact
    const bytes = this.artifacts.get(url)
    if (bytes === undefined)
      return Promise.resolve(new Response('no such artifact', { status: 404 }))
    return Promise.resolve(
      fromByte > 0 && this.rangeSupport
        ? new Response(bytes.slice(fromByte), { status: 206 })
        : new Response(bytes, { status: 200 }),
    )
  }
}

/** A missing layer reads as absent; anything else fails the test loudly. */
async function isLayerPresent(file: string): Promise<boolean> {
  try {
    await readFile(file)
    return true
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function testPacks(): {
  base: PackDefinition
  node: PackDefinition
  python: PackDefinition
  server: FakeServer
} {
  const baseTool = makeArtifact('base-tool', '1.0.0', 'base-bytes')
  const nodeTool = makeArtifact('node-toolchain', '24.0.0', 'node-bytes')
  const pythonTool = makeArtifact('python-toolchain', '3.14.0', 'python-bytes')
  const base = makePack('base', [baseTool.artifact])
  const node = makePack('node', [nodeTool.artifact])
  const python = makePack('python', [pythonTool.artifact])
  const server = new FakeServer([base, node, python])
  server.serve(baseTool.artifact, baseTool.bytes)
  server.serve(nodeTool.artifact, nodeTool.bytes)
  server.serve(pythonTool.artifact, pythonTool.bytes)
  return { base, node, python, server }
}

describe('verifyIndex', () => {
  it('accepts a signed, checksummed, fresh, locked index', async () => {
    const { server } = testPacks()
    const bytes = server.indexBytes()
    const verdict = await verifyIndex({
      indexBytes: bytes,
      expectedSha256: sha256Hex(bytes),
      actualSha256: sha256Hex(bytes),
      index: server.index,
      installedRevision: undefined,
      now: NOW.getTime(),
      verifySignature: () => Promise.resolve(true),
    })
    expect(verdict).toEqual({ ok: true })
  })

  it('refuses a bad signature before anything else', async () => {
    const { server } = testPacks()
    const bytes = server.indexBytes()
    const verdict = await verifyIndex({
      indexBytes: bytes,
      expectedSha256: sha256Hex(bytes),
      actualSha256: sha256Hex(bytes),
      index: server.index,
      installedRevision: undefined,
      now: NOW.getTime(),
      verifySignature: () => Promise.resolve(false),
    })
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('refuses a checksum mismatch', async () => {
    const { server } = testPacks()
    const verdict = await verifyIndex({
      indexBytes: server.indexBytes(),
      expectedSha256: '0'.repeat(64),
      actualSha256: '1'.repeat(64),
      index: server.index,
      installedRevision: undefined,
      now: NOW.getTime(),
      verifySignature: () => Promise.resolve(true),
    })
    expect(verdict).toEqual({ ok: false, reason: 'checksum-mismatch' })
  })

  it('refuses a revision below the installed one, and accepts above', async () => {
    const { server } = testPacks()
    const bytes = server.indexBytes()
    const options = {
      indexBytes: bytes,
      expectedSha256: sha256Hex(bytes),
      actualSha256: sha256Hex(bytes),
      index: server.index,
      now: NOW.getTime(),
      verifySignature: () => Promise.resolve(true),
    }
    expect(await verifyIndex({ ...options, installedRevision: 2 })).toEqual({
      ok: false,
      reason: 'downgrade',
    })
    expect(await verifyIndex({ ...options, installedRevision: 1 })).toEqual({ ok: true })
  })

  it('refuses an expired or dateless index', async () => {
    const { base } = testPacks()
    for (const expiresAt of [PAST, 'not-a-date']) {
      const index = makeIndex([base], { expiresAt })
      const bytes = new TextEncoder().encode(JSON.stringify(index))
      const verdict = await verifyIndex({
        indexBytes: bytes,
        expectedSha256: sha256Hex(bytes),
        actualSha256: sha256Hex(bytes),
        index,
        installedRevision: undefined,
        now: NOW.getTime(),
        verifySignature: () => Promise.resolve(true),
      })
      expect(verdict).toEqual({ ok: false, reason: 'expired' })
    }
  })

  it('refuses an index with an unlocked artifact', async () => {
    const { base } = testPacks()
    const unlocked: PackDefinition = {
      ...base,
      name: 'unlocked',
      artifacts: [{ name: 'tool', version: '1.0.0', url: 'https://packs.example/tool.tar.gz' }],
    }
    const index = makeIndex([unlocked])
    const bytes = new TextEncoder().encode(JSON.stringify(index))
    const verdict = await verifyIndex({
      indexBytes: bytes,
      expectedSha256: sha256Hex(bytes),
      actualSha256: sha256Hex(bytes),
      index,
      installedRevision: undefined,
      now: NOW.getTime(),
      verifySignature: () => Promise.resolve(true),
    })
    expect(verdict).toEqual({ ok: false, reason: 'unlocked-artifact' })
  })
})

describe('PackManager', () => {
  let root = ''
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'node-packs-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function managerFor(server: FakeServer): PackManager {
    return new PackManager({
      root,
      fetch: server,
      now: () => NOW,
      verifySignature: () => Promise.resolve(server.signatureOk),
      governed: (work) => work(),
    })
  }

  const auditLineSchema = z.object({ action: z.string(), reason: z.optional(z.string()) })

  async function auditLines(): Promise<{ action: string; reason?: string }[]> {
    const raw = await readFile(path.join(root, 'audit.jsonl'), 'utf8')
    return raw
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => auditLineSchema.parse(JSON.parse(line)))
  }

  it('installs an experience: packs, layers, capabilities, audit', async () => {
    const { server, node } = testPacks()
    const manager = managerFor(server)
    const verdict = await manager.installExperience('node')
    expect(verdict).toEqual({ ok: true, notice: undefined })
    expect(await manager.experiences()).toEqual([
      { name: 'node', packs: ['base', 'node'], installedAt: NOW.toISOString() },
    ])
    const installed = await manager.installedPacks()
    expect(new Set(installed.keys())).toEqual(new Set(['base', 'node']))
    const digest = node.artifacts[0]?.sha256 ?? ''
    const layer = await readFile(path.join(root, 'layers', digest.slice(0, 2), digest))
    expect(layer.toString()).toBe('node-bytes')
    const toolchains = toolchainsSchema.parse(
      JSON.parse(await readFile(path.join(root, 'toolchains.json'), 'utf8')),
    )
    expect(toolchains.version).toBe(1)
    expect(new Set(toolchains.packs.map((pack) => pack.name))).toEqual(new Set(['base', 'node']))
    const lines = await auditLines()
    expect(lines.filter((line) => line.action === 'install').length).toBeGreaterThanOrEqual(2)
  })

  it('installing twice verifies the layers and repairs damage', async () => {
    const { server, node } = testPacks()
    const manager = managerFor(server)
    expect(await manager.installExperience('node')).toEqual({ ok: true, notice: undefined })
    const digest = node.artifacts[0]?.sha256 ?? ''
    await writeFile(path.join(root, 'layers', digest.slice(0, 2), digest), 'tampered!!')
    expect(await manager.installExperience('node')).toEqual({ ok: true, notice: undefined })
    const layer = await readFile(path.join(root, 'layers', digest.slice(0, 2), digest))
    expect(layer.toString()).toBe('node-bytes')
  })

  it('resumes a partial download where the server answers ranges', async () => {
    const { server, node } = testPacks()
    const manager = managerFor(server)
    const digest = node.artifacts[0]?.sha256 ?? ''
    const full = new TextEncoder().encode('node-bytes')
    await manager.installExperience('python')
    await rm(path.join(root, 'layers', digest.slice(0, 2), digest), { force: true })
    await mkdir(path.join(root, 'layers', digest.slice(0, 2)), { recursive: true })
    await writeFile(
      path.join(root, 'layers', digest.slice(0, 2), `${digest}.part`),
      full.slice(0, 4),
    )
    const verdict = await manager.installExperience('node')
    expect(verdict).toEqual({ ok: true, notice: undefined })
    const layer = await readFile(path.join(root, 'layers', digest.slice(0, 2), digest))
    expect(layer.toString()).toBe('node-bytes')
  })

  it('restarts the download where the server ignores ranges', async () => {
    const { server } = testPacks()
    server.rangeSupport = false
    const manager = managerFor(server)
    const verdict = await manager.installExperience('node')
    expect(verdict).toEqual({ ok: true, notice: undefined })
  })

  it('refuses wrong bytes by digest and drops the partial file', async () => {
    const { server, node } = testPacks()
    const artifact = node.artifacts[0]
    if (artifact === undefined) throw new Error('missing node artifact')
    server.serve(artifact, new TextEncoder().encode('WRONG-byte'))
    const manager = managerFor(server)
    const verdict = await manager.installExperience('node')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed tampered bytes')
    expect(verdict.reason).toBe('checksum')
    const lines = await auditLines()
    expect(lines.some((line) => line.action === 'refuse' && line.reason === 'checksum')).toBe(true)
  })

  it('refuses short bytes by size and keeps the partial file', async () => {
    const { server, node } = testPacks()
    const artifact = node.artifacts[0]
    if (artifact === undefined) throw new Error('missing node artifact')
    server.serve(artifact, new TextEncoder().encode('short'))
    const manager = managerFor(server)
    const verdict = await manager.installExperience('node')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed short bytes')
    expect(verdict.reason).toBe('size')
    const digest = artifact.sha256 ?? ''
    const partial = await readFile(path.join(root, 'layers', digest.slice(0, 2), `${digest}.part`))
    expect(partial.toString()).toBe('short')
  })

  it('refuses a pack whose constraints break the installed set, naming both sides', async () => {
    const { server, base } = testPacks()
    const tool = makeArtifact('node-toolchain', '24.0.0', 'node-bytes')
    const strict = makePack('node', [tool.artifact], {
      constraints: [{ package: 'base-tool', range: '>=2', reason: 'needs the newer base' }],
    })
    server.index = makeIndex([base, strict])
    server.serve(tool.artifact, tool.bytes)
    const manager = managerFor(server)
    const verdict = await manager.installExperience('node')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed past the conflict')
    expect(verdict.reason).toBe('conflict')
    expect(verdict.detail).toContain('base-tool')
    expect(verdict.detail).toContain('1.0.0')
    expect(verdict.detail).toContain('>=2')
  })

  it('offline with a cache stands on the cache and says so', async () => {
    const { server } = testPacks()
    const manager = managerFor(server)
    expect(await manager.installExperience('node')).toEqual({ ok: true, notice: undefined })
    server.failIndex = new TypeError('network down')
    const verdict = await manager.installExperience('python')
    expect(verdict).toEqual({ ok: true, notice: 'cached-index' })
  })

  it('offline without a cache refuses', async () => {
    const { server } = testPacks()
    server.failIndex = new TypeError('network down')
    const manager = managerFor(server)
    const verdict = await manager.installExperience('node')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed with no index at all')
    expect(verdict.reason).toBe('offline')
  })

  it('refuses an index without its digest header', async () => {
    const { server } = testPacks()
    server.sendDigest = false
    const manager = managerFor(server)
    const verdict = await manager.installExperience('node')
    expect(verdict).toEqual({ ok: false, reason: 'unverified', detail: 'index digest header' })
  })

  it('refuses a bad signature, a downgrade, and an expired index', async () => {
    const { server } = testPacks()
    const unsigned = managerFor(server)
    server.signatureOk = false
    expect(await unsigned.installExperience('node')).toEqual({
      ok: false,
      reason: 'unverified',
      detail: 'bad-signature',
    })
    server.signatureOk = true
    const manager = managerFor(server)
    expect(await manager.installExperience('node')).toEqual({ ok: true, notice: undefined })
    server.index = makeIndex(server.index.packs, { revision: 0 })
    expect(await manager.installExperience('python')).toEqual({
      ok: false,
      reason: 'downgrade',
      detail: 'downgrade',
    })
    server.index = makeIndex(server.index.packs, { revision: 2, expiresAt: PAST })
    expect(await manager.installExperience('python')).toEqual({
      ok: false,
      reason: 'expired',
      detail: 'expired',
    })
  })

  it('removes experiences by count: shared packs stay until last use', async () => {
    const { server, base } = testPacks()
    const manager = managerFor(server)
    expect(await manager.installExperience('node')).toEqual({ ok: true, notice: undefined })
    expect(await manager.installExperience('python')).toEqual({ ok: true, notice: undefined })
    expect(await manager.removeExperience('node')).toEqual({ ok: true })
    const installed = await manager.installedPacks()
    expect(new Set(installed.keys())).toEqual(new Set(['base', 'python']))
    const baseDigest = base.artifacts[0]?.sha256 ?? ''
    const layerPath = path.join(root, 'layers', baseDigest.slice(0, 2), baseDigest)
    expect(await isLayerPresent(layerPath)).toBe(true)
    expect(await manager.removeExperience('python')).toEqual({ ok: true })
    const remaining = await manager.installedPacks()
    expect(remaining.size).toBe(0)
    expect(await isLayerPresent(layerPath)).toBe(false)
    expect(await manager.experiences()).toEqual([])
  })

  it('a dropped download reads as offline, and a broken fetch is loud', async () => {
    const { server } = testPacks()
    const offline = managerFor(server)
    server.failArtifact = new TypeError('network down')
    expect(await offline.installExperience('node')).toEqual({
      ok: false,
      reason: 'offline',
      detail: 'https://packs.example/base-tool-1.0.0.tar.gz',
    })
    const lines = await auditLines()
    expect(
      lines.some((line) => line.action === 'refuse' && line.reason === 'download-offline'),
    ).toBe(true)
    server.failArtifact = new Error('broken fetch')
    await expect(offline.installExperience('node')).rejects.toThrow('broken fetch')
  })

  it('a broken index fetch is loud', async () => {
    const { server } = testPacks()
    server.failIndex = new Error('broken fetch')
    const manager = managerFor(server)
    await expect(manager.installExperience('node')).rejects.toThrow('broken fetch')
  })

  it('refuses to remove an experience that was never installed', async () => {
    const { server } = testPacks()
    const manager = managerFor(server)
    expect(await manager.removeExperience('rust')).toEqual({
      ok: false,
      reason: 'not-found',
      detail: 'rust',
    })
  })

  it('treats a corrupt experience store as none, and says so in the audit', async () => {
    const { server } = testPacks()
    const manager = managerFor(server)
    await writeFile(path.join(root, 'experiences.json'), 'not json')
    expect(await manager.installExperience('node')).toEqual({ ok: true, notice: undefined })
    const lines = await auditLines()
    expect(lines.some((line) => line.action === 'refuse' && line.reason === 'corrupt-store')).toBe(
      true,
    )
  })
})

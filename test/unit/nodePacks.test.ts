// The pack index and manager (M110t TP1/TP2, D90.27): locked indexes
// verify before use, artifacts resume and digest-check per machine,
// conflicts and click-through refuse in words, and persona experiences
// converge their pack sets with shared packs counted. The fake server
// speaks the same HTTP the real one does (200, 206, digests).
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import type {
  PackArtifact,
  PackDefinition,
  PackPlatform,
} from '../../src/runtime/node/packs/definition'
import { PACK_INDEX_VERSION, verifyIndex, type PackIndex } from '../../src/runtime/node/packs/index'
import {
  PackManager,
  type PackFetch,
  type PackManagerDeps,
} from '../../src/runtime/node/packs/manager'
import type { Persona } from '../../src/shared/profile'
import { toolchainsSchema } from '../../src/shared/toolchains'

const NOW = new Date('2026-06-01T00:00:00.000Z')
const FUTURE = '2027-01-01T00:00:00.000Z'
const PAST = '2026-01-01T00:00:00.000Z'
const LINUX_X64 = { os: 'linux', arch: 'x64' }

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeArtifact(
  name: string,
  version: string,
  content: string,
  platforms?: PackPlatform[],
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
      platforms,
    },
  }
}

function makePack(
  name: PackName,
  artifacts: PackArtifact[],
  options: {
    requires?: string[]
    constraints?: PackDefinition['constraints']
    clickThrough?: boolean
    version?: string
  } = {},
): PackDefinition {
  const label: string = name
  return {
    name,
    version: options.version ?? '1.0.0',
    description: `the ${label} pack`,
    license: 'MIT',
    languages: name === 'shell' || name === 'crosscutting' ? [] : [name],
    requires: options.requires ?? [],
    artifacts,
    checks: [{ name: `${label}-check`, command: [name, 'check'] }],
    constraints: options.constraints ?? [],
    clickThrough: options.clickThrough ?? false,
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

interface TestWorld {
  server: FakeServer
  typescript: PackDefinition
  python: PackDefinition
  shell: PackDefinition
  crosscutting: PackDefinition
  mobile: PackDefinition
}

function testWorld(): TestWorld {
  const tsTool = makeArtifact('node-toolchain', '24.0.0', 'typescript-bytes')
  const pyTool = makeArtifact('python-toolchain', '3.14.0', 'python-bytes')
  const shTool = makeArtifact('shell-tools', '1.0.0', 'shell-bytes')
  const ccTool = makeArtifact('cross-tools', '1.0.0', 'crosscutting-bytes')
  const sdkTool = makeArtifact('android-sdk', '19.0.0', 'sdk-bytes')
  const typescript = makePack('typescript', [tsTool.artifact])
  const python = makePack('python', [pyTool.artifact])
  const shell = makePack('shell', [shTool.artifact])
  const crosscutting = makePack('crosscutting', [ccTool.artifact])
  const mobile = makePack('mobile', [sdkTool.artifact], { clickThrough: true })
  const server = new FakeServer([typescript, python, shell, crosscutting, mobile])
  server.serve(tsTool.artifact, tsTool.bytes)
  server.serve(pyTool.artifact, pyTool.bytes)
  server.serve(shTool.artifact, shTool.bytes)
  server.serve(ccTool.artifact, ccTool.bytes)
  server.serve(sdkTool.artifact, sdkTool.bytes)
  return { server, typescript, python, shell, crosscutting, mobile }
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

describe('verifyIndex', () => {
  it('accepts a signed, checksummed, fresh, locked index', async () => {
    const { server } = testWorld()
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
    const { server } = testWorld()
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
    const { server } = testWorld()
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
    const { server } = testWorld()
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
    const { shell } = testWorld()
    for (const expiresAt of [PAST, 'not-a-date']) {
      const index = makeIndex([shell], { expiresAt })
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
    const unlocked: PackDefinition = {
      ...makePack('shell', []),
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

  function managerFor(
    server: FakeServer,
    deps: Partial<Pick<PackManagerDeps, 'host' | 'acceptedClickThrough'>> = {},
  ): PackManager {
    return new PackManager({
      root,
      fetch: server,
      now: () => NOW,
      verifySignature: () => Promise.resolve(server.signatureOk),
      governed: (work) => work(),
      host: deps.host ?? LINUX_X64,
      acceptedClickThrough: deps.acceptedClickThrough ?? [],
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

  function layerPath(digest: string): string {
    return path.join(root, 'layers', digest.slice(0, 2), digest)
  }

  it('installs an experience: packs, layers, capabilities, audit', async () => {
    const { server, typescript } = testWorld()
    const manager = managerFor(server)
    const verdict = await manager.installExperience('web')
    expect(verdict).toEqual({ ok: true, notice: undefined })
    expect(await manager.experiences()).toEqual([
      {
        name: 'web',
        packs: ['typescript', 'shell', 'crosscutting'],
        installedAt: NOW.toISOString(),
      },
    ])
    const installed = await manager.installedPacks()
    expect(new Set(installed.keys())).toEqual(new Set(['typescript', 'shell', 'crosscutting']))
    const digest = typescript.artifacts[0]?.sha256 ?? ''
    const layer = await readFile(layerPath(digest))
    expect(layer.toString()).toBe('typescript-bytes')
    const toolchains = toolchainsSchema.parse(
      JSON.parse(await readFile(path.join(root, 'toolchains.json'), 'utf8')),
    )
    expect(toolchains.version).toBe(1)
    expect(new Set(toolchains.packs.map((pack) => pack.name))).toEqual(
      new Set(['typescript', 'shell', 'crosscutting']),
    )
    const lines = await auditLines()
    expect(lines.filter((line) => line.action === 'install').length).toBeGreaterThanOrEqual(2)
  })

  it('installs a ticked pack list instead of the persona default', async () => {
    const { server } = testWorld()
    const manager = managerFor(server)
    expect(await manager.installExperience('web', ['typescript'])).toEqual({
      ok: true,
      notice: undefined,
    })
    expect(await manager.experiences()).toEqual([
      { name: 'web', packs: ['typescript'], installedAt: NOW.toISOString() },
    ])
    const installed = await manager.installedPacks()
    expect(new Set(installed.keys())).toEqual(new Set(['typescript']))
  })

  it('re-running converges: dropped packs leave when nothing references them', async () => {
    const { server } = testWorld()
    const manager = managerFor(server)
    expect(await manager.installExperience('web')).toEqual({ ok: true, notice: undefined })
    expect(await manager.installExperience('web', ['typescript'])).toEqual({
      ok: true,
      notice: undefined,
    })
    const installed = await manager.installedPacks()
    expect(new Set(installed.keys())).toEqual(new Set(['typescript']))
    expect(await manager.experiences()).toEqual([
      { name: 'web', packs: ['typescript'], installedAt: NOW.toISOString() },
    ])
  })

  it('installing twice verifies the layers and repairs damage', async () => {
    const { server, typescript } = testWorld()
    const manager = managerFor(server)
    expect(await manager.installExperience('web')).toEqual({ ok: true, notice: undefined })
    const digest = typescript.artifacts[0]?.sha256 ?? ''
    await writeFile(layerPath(digest), 'tampered!!')
    expect(await manager.installExperience('web')).toEqual({ ok: true, notice: undefined })
    const layer = await readFile(layerPath(digest))
    expect(layer.toString()).toBe('typescript-bytes')
  })

  it('resumes a partial download where the server answers ranges', async () => {
    const { server, typescript } = testWorld()
    const manager = managerFor(server)
    const digest = typescript.artifacts[0]?.sha256 ?? ''
    const full = new TextEncoder().encode('typescript-bytes')
    await manager.installExperience('data-and-ml')
    await rm(layerPath(digest), { force: true })
    await mkdir(path.join(root, 'layers', digest.slice(0, 2)), { recursive: true })
    await writeFile(`${layerPath(digest)}.part`, full.slice(0, 4))
    const verdict = await manager.installExperience('web', ['typescript'])
    expect(verdict).toEqual({ ok: true, notice: undefined })
    const layer = await readFile(layerPath(digest))
    expect(layer.toString()).toBe('typescript-bytes')
  })

  it('restarts the download where the server ignores ranges', async () => {
    const { server } = testWorld()
    server.rangeSupport = false
    const manager = managerFor(server)
    const verdict = await manager.installExperience('web', ['typescript'])
    expect(verdict).toEqual({ ok: true, notice: undefined })
  })

  it('refuses wrong bytes by digest and drops the partial file', async () => {
    const { server, typescript } = testWorld()
    const artifact = typescript.artifacts[0]
    if (artifact === undefined) throw new Error('missing typescript artifact')
    server.serve(artifact, new TextEncoder().encode('WRONG-bytes-fine'))
    const manager = managerFor(server)
    const verdict = await manager.installExperience('web', ['typescript'])
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed tampered bytes')
    expect(verdict.reason).toBe('checksum')
    const lines = await auditLines()
    expect(lines.some((line) => line.action === 'refuse' && line.reason === 'checksum')).toBe(true)
  })

  it('refuses short bytes by size and keeps the partial file', async () => {
    const { server, typescript } = testWorld()
    const artifact = typescript.artifacts[0]
    if (artifact === undefined) throw new Error('missing typescript artifact')
    server.serve(artifact, new TextEncoder().encode('short'))
    const manager = managerFor(server)
    const verdict = await manager.installExperience('web', ['typescript'])
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed short bytes')
    expect(verdict.reason).toBe('size')
    const digest = artifact.sha256 ?? ''
    const partial = await readFile(`${layerPath(digest)}.part`)
    expect(partial.toString()).toBe('short')
  })

  it('refuses a pack whose constraints break the installed set, naming both sides', async () => {
    const { server, shell } = testWorld()
    const tool = makeArtifact('python-toolchain', '3.14.0', 'python-bytes')
    const strict = makePack('python', [tool.artifact], {
      constraints: [{ package: 'shell-tools', range: '>=2', reason: 'needs the newer shell' }],
    })
    server.index = makeIndex([shell, strict])
    server.serve(tool.artifact, tool.bytes)
    const manager = managerFor(server)
    const verdict = await manager.installExperience('data-and-ml', ['shell', 'python'])
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed past the conflict')
    expect(verdict.reason).toBe('conflict')
    expect(verdict.detail).toContain('shell-tools')
    expect(verdict.detail).toContain('1.0.0')
    expect(verdict.detail).toContain('>=2')
  })

  it('refuses a require cycle, naming the loop', async () => {
    const { server } = testWorld()
    const tsTool = makeArtifact('node-toolchain', '24.0.0', 'typescript-bytes')
    const pyTool = makeArtifact('python-toolchain', '3.14.0', 'python-bytes')
    const typescript = makePack('typescript', [tsTool.artifact], { requires: ['python'] })
    const python = makePack('python', [pyTool.artifact], { requires: ['typescript'] })
    server.index = makeIndex([typescript, python])
    server.serve(tsTool.artifact, tsTool.bytes)
    server.serve(pyTool.artifact, pyTool.bytes)
    const manager = managerFor(server)
    const verdict = await manager.installExperience('web', ['typescript'])
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed past the cycle')
    expect(verdict.reason).toBe('conflict')
    expect(verdict.detail).toContain('typescript -> python -> typescript')
  })

  it('refuses a click-through pack until the person accepts its licence', async () => {
    const { server } = testWorld()
    const manager = managerFor(server)
    expect(await manager.installExperience('mobile', ['mobile'])).toEqual({
      ok: false,
      reason: 'click-through',
      detail: 'mobile',
    })
    const accepted = managerFor(server, { acceptedClickThrough: ['mobile'] })
    expect(await accepted.installExperience('mobile', ['mobile'])).toEqual({
      ok: true,
      notice: undefined,
    })
  })

  it('installs only the artifacts for this machine', async () => {
    const { server } = testWorld()
    const linuxTool = makeArtifact('node-toolchain-linux-x64', '24.0.0', 'linux-bytes', [
      { os: 'linux', arch: 'x64' },
    ])
    const macTool = makeArtifact('node-toolchain-darwin-arm64', '24.0.0', 'mac-bytes', [
      { os: 'darwin', arch: 'arm64' },
    ])
    const typescript = makePack('typescript', [linuxTool.artifact, macTool.artifact])
    server.index = makeIndex([typescript])
    server.serve(linuxTool.artifact, linuxTool.bytes)
    server.serve(macTool.artifact, macTool.bytes)
    const linux = managerFor(server, { host: { os: 'linux', arch: 'x64' } })
    expect(await linux.installExperience('web', ['typescript'])).toEqual({
      ok: true,
      notice: undefined,
    })
    const linuxDigest = linuxTool.artifact.sha256 ?? ''
    const macDigest = macTool.artifact.sha256 ?? ''
    expect(await isLayerPresent(layerPath(linuxDigest))).toBe(true)
    expect(await isLayerPresent(layerPath(macDigest))).toBe(false)
  })

  it('refuses a pack with nothing for this machine, and an unknown machine', async () => {
    const { server } = testWorld()
    const macTool = makeArtifact('node-toolchain', '24.0.0', 'mac-bytes', [
      { os: 'darwin', arch: 'arm64' },
    ])
    server.index = makeIndex([makePack('typescript', [macTool.artifact])])
    server.serve(macTool.artifact, macTool.bytes)
    const linux = managerFor(server, { host: { os: 'linux', arch: 'x64' } })
    expect(await linux.installExperience('web', ['typescript'])).toEqual({
      ok: false,
      reason: 'unsupported-platform',
      detail: 'typescript',
    })
    const exotic = managerFor(server, { host: { os: 'freebsd', arch: 'x64' } })
    expect(await exotic.installExperience('web', ['typescript'])).toEqual({
      ok: false,
      reason: 'unsupported-platform',
      detail: 'freebsd/x64',
    })
    expect(await exotic.checkUpdates()).toEqual({
      refusal: 'unsupported-platform',
      detail: 'freebsd/x64',
    })
  })

  it('offers updates with versions and bytes, from the cache when offline', async () => {
    const { server } = testWorld()
    const manager = managerFor(server)
    expect(await manager.installExperience('web', ['typescript'])).toEqual({
      ok: true,
      notice: undefined,
    })
    expect(await manager.checkUpdates()).toEqual({ updates: [], cached: false })
    const tool = makeArtifact('node-toolchain', '24.1.0', 'typescript-v2-bytes!')
    const newer = makePack('typescript', [tool.artifact], { version: '2.0.0' })
    server.index = makeIndex(
      [newer, ...server.index.packs.filter((pack) => pack.name !== 'typescript')],
      {
        revision: 2,
      },
    )
    server.serve(tool.artifact, tool.bytes)
    const offered = await manager.checkUpdates()
    if ('refusal' in offered) throw new Error('refused the update check')
    expect(offered.cached).toBe(false)
    expect(offered.updates).toEqual([
      {
        pack: 'typescript',
        installed: '1.0.0',
        available: '2.0.0',
        bytes: tool.bytes.byteLength,
      },
    ])
    server.failIndex = new TypeError('network down')
    const cached = await manager.checkUpdates()
    if ('refusal' in cached) throw new Error('refused the cached update check')
    expect(cached.cached).toBe(true)
    expect(cached.updates).toEqual(offered.updates)
  })

  it('offline with a cache stands on the cache and says so', async () => {
    const { server } = testWorld()
    const manager = managerFor(server)
    expect(await manager.installExperience('web', ['typescript'])).toEqual({
      ok: true,
      notice: undefined,
    })
    server.failIndex = new TypeError('network down')
    const verdict = await manager.installExperience('data-and-ml', ['python'])
    expect(verdict).toEqual({ ok: true, notice: 'cached-index' })
  })

  it('offline without a cache refuses', async () => {
    const { server } = testWorld()
    server.failIndex = new TypeError('network down')
    const manager = managerFor(server)
    const verdict = await manager.installExperience('web', ['typescript'])
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('installed with no index at all')
    expect(verdict.reason).toBe('offline')
  })

  it('refuses an index without its digest header', async () => {
    const { server } = testWorld()
    server.sendDigest = false
    const manager = managerFor(server)
    const verdict = await manager.installExperience('web', ['typescript'])
    expect(verdict).toEqual({ ok: false, reason: 'unverified', detail: 'index digest header' })
  })

  it('refuses a bad signature, a downgrade, and an expired index', async () => {
    const { server } = testWorld()
    const unsigned = managerFor(server)
    server.signatureOk = false
    expect(await unsigned.installExperience('web', ['typescript'])).toEqual({
      ok: false,
      reason: 'unverified',
      detail: 'bad-signature',
    })
    server.signatureOk = true
    const manager = managerFor(server)
    expect(await manager.installExperience('web', ['typescript'])).toEqual({
      ok: true,
      notice: undefined,
    })
    server.index = makeIndex(server.index.packs, { revision: 0 })
    expect(await manager.installExperience('data-and-ml', ['python'])).toEqual({
      ok: false,
      reason: 'downgrade',
      detail: 'downgrade',
    })
    server.index = makeIndex(server.index.packs, { revision: 2, expiresAt: PAST })
    expect(await manager.installExperience('data-and-ml', ['python'])).toEqual({
      ok: false,
      reason: 'expired',
      detail: 'expired',
    })
  })

  it('a dropped download reads as offline, and a broken fetch is loud', async () => {
    const { server } = testWorld()
    const offline = managerFor(server)
    server.failArtifact = new TypeError('network down')
    expect(await offline.installExperience('web', ['typescript'])).toEqual({
      ok: false,
      reason: 'offline',
      detail: 'https://packs.example/node-toolchain-24.0.0.tar.gz',
    })
    const lines = await auditLines()
    expect(
      lines.some((line) => line.action === 'refuse' && line.reason === 'download-offline'),
    ).toBe(true)
    server.failArtifact = new Error('broken fetch')
    await expect(offline.installExperience('web', ['typescript'])).rejects.toThrow('broken fetch')
  })

  it('a broken index fetch is loud', async () => {
    const { server } = testWorld()
    server.failIndex = new Error('broken fetch')
    const manager = managerFor(server)
    await expect(manager.installExperience('web', ['typescript'])).rejects.toThrow('broken fetch')
  })

  it('removes experiences by count: shared packs stay until last use', async () => {
    const { server, shell } = testWorld()
    const manager = managerFor(server)
    expect(await manager.installExperience('web')).toEqual({ ok: true, notice: undefined })
    expect(await manager.installExperience('data-and-ml')).toEqual({
      ok: true,
      notice: undefined,
    })
    expect(await manager.removeExperience('web')).toEqual({ ok: true })
    const installed = await manager.installedPacks()
    expect(new Set(installed.keys())).toEqual(new Set(['python', 'shell', 'crosscutting']))
    const shellDigest = shell.artifacts[0]?.sha256 ?? ''
    expect(await isLayerPresent(layerPath(shellDigest))).toBe(true)
    expect(await manager.removeExperience('data-and-ml')).toEqual({ ok: true })
    const remaining = await manager.installedPacks()
    expect(remaining.size).toBe(0)
    expect(await isLayerPresent(layerPath(shellDigest))).toBe(false)
    expect(await manager.experiences()).toEqual([])
  })

  it('refuses to remove an experience that was never installed', async () => {
    const { server } = testWorld()
    const manager = managerFor(server)
    const missing: Persona = 'systems'
    expect(await manager.removeExperience(missing)).toEqual({
      ok: false,
      reason: 'not-found',
      detail: 'systems',
    })
  })

  it('treats a corrupt experience store as none, and says so in the audit', async () => {
    const { server } = testWorld()
    const manager = managerFor(server)
    await writeFile(path.join(root, 'experiences.json'), 'not json')
    expect(await manager.installExperience('web', ['typescript'])).toEqual({
      ok: true,
      notice: undefined,
    })
    const lines = await auditLines()
    expect(lines.some((line) => line.action === 'refuse' && line.reason === 'corrupt-store')).toBe(
      true,
    )
  })
})

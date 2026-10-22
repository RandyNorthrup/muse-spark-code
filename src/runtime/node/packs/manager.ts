// Install, update and remove toolchain packs on a node (M110t TP2,
// PLAN.md D90.27): from the verified index only, compatibility-checked,
// digest-checked with resume, reference-counted across experiences, and
// every install, update, removal and refusal an audited user action.
// Nothing installs before the person's explicit install; simulators and
// click-through licences install only on their click. Offline, the node
// keeps its cached verified index and refuses new fetches, saying so.
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { TOOLCHAINS_FILE, toolchainsSchema, type ToolchainPack } from '../../../shared/toolchains'
import { personaPacks, type PackName, type Persona } from '../../../shared/profile'
import {
  checkConstraints,
  compareVersions,
  packDefinitionSchema,
  type PackArtifact,
  type PackDefinition,
  type PackPlatform,
} from './definition'
import {
  installedToolchainVersions,
  packIndexSchema,
  verifyIndex,
  type IndexRefusal,
  type PackIndex,
} from './index'

/** One installed experience: its packs, counted across experiences. */
export const experienceRecordSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  packs: z.array(z.string().check(z.minLength(1))),
  installedAt: z.string(),
})
export type ExperienceRecord = z.infer<typeof experienceRecordSchema>

const experiencesFileSchema = z.strictObject({ experiences: z.array(experienceRecordSchema) })

/** One installed pack: its locked definition and install time. */
export const installedPackSchema = z.strictObject({
  installedAt: z.string(),
  definition: packDefinitionSchema,
})
export type InstalledPack = z.infer<typeof installedPackSchema>

/** One audit line: who did what to which pack, and why not. */
export const packAuditSchema = z.strictObject({
  at: z.string(),
  actor: z.literal('person'),
  action: z.enum(['install', 'update', 'remove', 'refuse']),
  pack: z.optional(z.string()),
  experience: z.optional(z.string()),
  version: z.optional(z.string()),
  digest: z.optional(z.string()),
  reason: z.optional(z.string()),
})
export type PackAuditLine = z.infer<typeof packAuditSchema>

/** Why an install or removal refused, in machine words. */
export type PackRefusal =
  | 'not-found'
  | 'conflict'
  | 'checksum'
  | 'size'
  | 'unverified'
  | 'offline'
  | 'click-through'
  | 'in-use'
  | 'downgrade'
  | 'expired'
  | 'unsupported-platform'

export type PackVerdict =
  | { readonly ok: true; readonly notice?: 'cached-index' | undefined }
  | { readonly ok: false; readonly reason: PackRefusal; readonly detail: string }

/** One offered update: the pack, its versions, and the download bytes. */
export interface PackUpdate {
  readonly pack: string
  readonly installed: string
  readonly available: string
  readonly bytes: number
}

export interface PackFetch {
  readonly fetchIndex: () => Promise<{
    index: PackIndex
    bytes: Uint8Array
    digest: string | undefined
  }>
  readonly fetchArtifact: (url: string, fromByte: number) => Promise<Response>
}

export interface PackManagerDeps {
  readonly root: string
  readonly fetch: PackFetch
  readonly now: () => Date
  readonly verifySignature: (bytes: Uint8Array) => Promise<boolean>
  readonly governed: (work: () => Promise<void>) => Promise<void>
  /** This machine, as `process.platform` and `process.arch` name it. */
  readonly host: { readonly os: string; readonly arch: string }
  /** Packs whose click-through licence the person accepted on the device. */
  readonly acceptedClickThrough: readonly string[]
}

const INDEX_FILE = 'index.json'
const EXPERIENCES_FILE = 'experiences.json'
const AUDIT_FILE = 'audit.jsonl'
const LAYERS_DIR = 'layers'
const PACKS_DIR = 'packs'
/** The range answer that continues a partial download instead of restarting it. */
const HTTP_PARTIAL_CONTENT = 206
/** `process.platform` names the packs know. */
const HOST_OS: ReadonlyMap<string, PackPlatform['os']> = new Map([
  ['linux', 'linux'],
  ['darwin', 'darwin'],
  ['win32', 'windows'],
])
/** `process.arch` names the packs know. */
const HOST_ARCH: ReadonlyMap<string, PackPlatform['arch']> = new Map([
  ['x64', 'x64'],
  ['arm64', 'arm64'],
])

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A missing file is the store's normal first-run state, never damage. */
function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** What a stored JSON file reads as: absent, damaged, or its value. */
type StoredJson =
  | { readonly status: 'missing' }
  | { readonly status: 'corrupt' }
  | { readonly status: 'ok'; readonly value: unknown }

/**
Read a stored JSON file: missing reads as missing, malformed text as
corrupt, anything else parsed. Other failures are loud.
*/
async function readStoredJson(file: string): Promise<StoredJson> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (isMissingFile(error)) return { status: 'missing' }
    throw error
  }
  try {
    return { status: 'ok', value: JSON.parse(raw) }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return { status: 'corrupt' }
    throw error
  }
}

function refusalFor(reason: IndexRefusal): PackRefusal {
  switch (reason) {
    case 'bad-signature':
    case 'unlocked-artifact': {
      return 'unverified'
    }
    case 'checksum-mismatch': {
      return 'checksum'
    }
    case 'downgrade': {
      return 'downgrade'
    }
    case 'expired': {
      return 'expired'
    }
  }
}

export class PackManager {
  constructor(private readonly deps: PackManagerDeps) {}

  private get root(): string {
    return this.deps.root
  }

  private async audit(line: Omit<PackAuditLine, 'at' | 'actor'>): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const entry: PackAuditLine = { at: this.deps.now().toISOString(), actor: 'person', ...line }
    await appendFile(path.join(this.root, AUDIT_FILE), `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private async writeExperiences(experiences: readonly ExperienceRecord[]): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(
      path.join(this.root, EXPERIENCES_FILE),
      JSON.stringify({ experiences }, null, 2),
      'utf8',
    )
  }

  private layerPath(digest: string): string {
    return path.join(this.root, LAYERS_DIR, digest.slice(0, 2), digest)
  }

  private partPath(digest: string): string {
    return `${this.layerPath(digest)}.part`
  }

  /** This machine as the packs name it, or nothing when they do not. */
  private hostPlatform(): PackPlatform | undefined {
    const os = HOST_OS.get(this.deps.host.os)
    const arch = HOST_ARCH.get(this.deps.host.arch)
    return os === undefined || arch === undefined ? undefined : { os, arch }
  }

  /** The artifacts that run on this machine. */
  private artifactsForHost(artifacts: readonly PackArtifact[], host: PackPlatform): PackArtifact[] {
    return artifacts.filter(
      (artifact) =>
        artifact.platforms === undefined ||
        artifact.platforms.some(
          (platform) => platform.os === host.os && platform.arch === host.arch,
        ),
    )
  }

  /** Download and verify each artifact; anything else refuses. */
  private async fetchArtifacts(
    pack: string,
    version: string,
    artifacts: readonly PackArtifact[],
  ): Promise<PackVerdict> {
    for (const artifact of artifacts) {
      if (artifact.sha256 === undefined || artifact.sizeBytes === undefined) {
        await this.audit({ action: 'refuse', pack, version, reason: 'unlocked-artifact' })
        return { ok: false, reason: 'unverified', detail: `${pack}/${artifact.name}` }
      }
      const verdict = await this.downloadArtifact(artifact.url, {
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      })
      if (!verdict.ok) {
        await this.audit({ action: 'refuse', pack, version, reason: verdict.reason })
        return verdict
      }
    }
    return { ok: true }
  }

  /**
  Download one artifact with resume: a partial file continues where it
  stopped when the server answers ranges, else starts over. The bytes
  verify by size and digest before they land; anything else refuses.
  */
  private async downloadArtifact(
    url: string,
    expected: { sha256: string; sizeBytes: number },
  ): Promise<PackVerdict> {
    const final = this.layerPath(expected.sha256)
    try {
      const present = await readFile(final)
      if (present.byteLength === expected.sizeBytes && sha256Hex(present) === expected.sha256) {
        return { ok: true }
      }
      await rm(final, { force: true })
    } catch (error: unknown) {
      // A missing layer downloads below; other failures are loud.
      if (!isMissingFile(error)) throw error
    }
    let partial = Buffer.alloc(0)
    try {
      partial = await readFile(this.partPath(expected.sha256))
    } catch (error: unknown) {
      // No partial file downloads from the start; other failures are loud.
      if (!isMissingFile(error)) throw error
    }
    let bytes: Uint8Array = partial
    try {
      await this.deps.governed(async () => {
        const response = await this.deps.fetch.fetchArtifact(url, partial.byteLength)
        const chunks: Uint8Array[] = response.status === HTTP_PARTIAL_CONTENT ? [partial] : []
        if (response.body !== null) {
          const reader = response.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
          }
        }
        bytes = Buffer.concat(chunks)
      })
    } catch (error: unknown) {
      // The fetch fails with a TypeError when the network drops; anything
      // else (a broken fetch, a broken governor) is loud.
      if (!(error instanceof TypeError)) throw error
      await this.audit({ action: 'refuse', reason: 'download-offline' })
      return { ok: false, reason: 'offline', detail: url }
    }
    if (bytes.byteLength !== expected.sizeBytes) {
      await mkdir(path.join(this.root, LAYERS_DIR, expected.sha256.slice(0, 2)), {
        recursive: true,
      })
      await writeFile(this.partPath(expected.sha256), Buffer.from(bytes))
      return {
        ok: false,
        reason: 'size',
        detail: `${String(bytes.byteLength)} of ${String(expected.sizeBytes)}`,
      }
    }
    if (sha256Hex(bytes) !== expected.sha256) {
      await rm(this.partPath(expected.sha256), { force: true })
      return { ok: false, reason: 'checksum', detail: url }
    }
    await mkdir(path.join(this.root, LAYERS_DIR, expected.sha256.slice(0, 2)), { recursive: true })
    await writeFile(final, Buffer.from(bytes))
    await rm(this.partPath(expected.sha256), { force: true })
    return { ok: true }
  }

  /**
  Install one pack from the index: its licence accepted, its platform
  known, its requirements first, compatibility against the installed
  set, every artifact for this machine downloaded and verified, then
  the record lands. A pack already installed at the same version
  verifies its layers and stands.
  */
  private async installPack(
    name: string,
    index: PackIndex,
    installing: readonly string[],
  ): Promise<PackVerdict> {
    const definition = index.packs.find((pack) => pack.name === name)
    if (definition === undefined) {
      await this.audit({ action: 'refuse', pack: name, reason: 'not-found' })
      return { ok: false, reason: 'not-found', detail: name }
    }
    if (definition.clickThrough && !this.deps.acceptedClickThrough.includes(name)) {
      await this.audit({
        action: 'refuse',
        pack: name,
        version: definition.version,
        reason: 'click-through',
      })
      return { ok: false, reason: 'click-through', detail: name }
    }
    const host = this.hostPlatform()
    if (host === undefined) {
      await this.audit({ action: 'refuse', pack: name, reason: 'unsupported-platform' })
      return {
        ok: false,
        reason: 'unsupported-platform',
        detail: `${this.deps.host.os}/${this.deps.host.arch}`,
      }
    }
    const artifacts = this.artifactsForHost(definition.artifacts, host)
    if (artifacts.length === 0) {
      await this.audit({ action: 'refuse', pack: name, reason: 'unsupported-platform' })
      return { ok: false, reason: 'unsupported-platform', detail: name }
    }
    if (installing.includes(name)) {
      return {
        ok: false,
        reason: 'conflict',
        detail: `require cycle: ${[...installing, name].join(' -> ')}`,
      }
    }
    for (const required of definition.requires) {
      const installed = await this.installedPacks()
      if (installed.has(required)) continue
      const verdict = await this.installPack(required, index, [...installing, name])
      if (!verdict.ok) return verdict
    }
    const installed = await this.installedPacks()
    const same = installed.get(name)
    if (same?.version === definition.version) {
      return await this.fetchArtifacts(name, definition.version, artifacts)
    }
    const conflicts = checkConstraints(definition, installedToolchainVersions(installed.values()))
    if (conflicts.length > 0) {
      const first = conflicts[0]
      const detail =
        first === undefined
          ? name
          : `${first.constraint.package} ${first.installed} vs ${first.constraint.range} (${first.constraint.reason})`
      await this.audit({
        action: 'refuse',
        pack: name,
        version: definition.version,
        reason: 'conflict',
      })
      return { ok: false, reason: 'conflict', detail }
    }
    const fetched = await this.fetchArtifacts(name, definition.version, artifacts)
    if (!fetched.ok) return fetched
    await mkdir(path.join(this.root, PACKS_DIR), { recursive: true })
    const record: InstalledPack = { installedAt: this.deps.now().toISOString(), definition }
    await writeFile(
      path.join(this.root, PACKS_DIR, `${name}.json`),
      JSON.stringify(record, null, 2),
      'utf8',
    )
    await this.audit({
      action: same === undefined ? 'install' : 'update',
      pack: name,
      version: definition.version,
    })
    return { ok: true }
  }

  /** Drop the packs (and their unshared layers) no experience references. */
  private async collectUnreferenced(referenced: ReadonlySet<string>): Promise<void> {
    const installed = await this.installedPacks()
    // Layers stay while any referenced pack references their digest.
    const keptDigests = new Set<string>()
    for (const [name, definition] of installed) {
      if (referenced.has(name)) {
        for (const artifact of definition.artifacts) {
          if (artifact.sha256 !== undefined) keptDigests.add(artifact.sha256)
        }
      }
    }
    for (const [name, definition] of installed) {
      if (referenced.has(name)) continue
      await rm(path.join(this.root, PACKS_DIR, `${name}.json`), { force: true })
      for (const artifact of definition.artifacts) {
        if (artifact.sha256 === undefined || keptDigests.has(artifact.sha256)) continue
        await rm(this.layerPath(artifact.sha256), { force: true })
        await rm(this.partPath(artifact.sha256), { force: true })
      }
      await this.audit({ action: 'remove', pack: name })
    }
  }

  /** Rewrite the capability file from the installed packs. */
  private async writeToolchains(packs: ReadonlyMap<string, PackDefinition>): Promise<void> {
    const toolchainPacks: ToolchainPack[] = Array.from(packs.values(), (pack) => ({
      name: pack.name,
      version: pack.version,
      languages: pack.languages,
      checks: pack.checks,
    }))
    const file = { version: 1, packs: toolchainPacks, updatedAt: this.deps.now().toISOString() }
    toolchainsSchema.parse(file)
    await writeFile(path.join(this.root, TOOLCHAINS_FILE), JSON.stringify(file, null, 2), 'utf8')
  }

  /** The installed experiences, validated; missing means none. */
  async experiences(): Promise<ExperienceRecord[]> {
    const stored = await readStoredJson(path.join(this.root, EXPERIENCES_FILE))
    if (stored.status === 'missing') return []
    const parsed =
      stored.status === 'ok' ? experiencesFileSchema.safeParse(stored.value) : undefined
    if (parsed?.success !== true) {
      await this.audit({ action: 'refuse', reason: 'corrupt-store' })
      return []
    }
    return parsed.data.experiences
  }

  /** The installed packs' locked definitions, by name. */
  async installedPacks(): Promise<Map<string, PackDefinition>> {
    const packs = new Map<string, PackDefinition>()
    let files: string[]
    try {
      files = await readdir(path.join(this.root, PACKS_DIR))
    } catch (error: unknown) {
      if (isMissingFile(error)) return packs
      throw error
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const stored = await readStoredJson(path.join(this.root, PACKS_DIR, file))
      if (stored.status === 'missing') continue
      const parsed =
        stored.status === 'ok' ? installedPackSchema.safeParse(stored.value) : undefined
      if (parsed?.success !== true) {
        // A pack whose record is corrupt installs again on next use.
        await this.audit({ action: 'refuse', pack: file, reason: 'corrupt-record' })
        continue
      }
      packs.set(parsed.data.definition.name, parsed.data.definition)
    }
    return packs
  }

  /** The cached verified index, when one was kept. */
  async cachedIndex(): Promise<PackIndex | undefined> {
    const stored = await readStoredJson(path.join(this.root, INDEX_FILE))
    if (stored.status === 'missing') return undefined
    const parsed = stored.status === 'ok' ? packIndexSchema.safeParse(stored.value) : undefined
    if (parsed?.success !== true) {
      await this.audit({ action: 'refuse', reason: 'corrupt-index' })
      return undefined
    }
    return parsed.data
  }

  /**
  Fetch and verify the index: signature over the exact bytes, checksum,
  no-downgrade against the cached revision, expiry, locked artifacts.
  Offline with a cache, the cache stands and says so; offline without
  one refuses.
  */
  async refreshIndex(): Promise<
    | { readonly index: PackIndex; readonly cached: boolean }
    | { readonly refusal: PackRefusal; readonly detail: string }
  > {
    const cached = await this.cachedIndex()
    let fetched: { index: PackIndex; bytes: Uint8Array; digest: string | undefined }
    try {
      fetched = await this.deps.fetch.fetchIndex()
    } catch (error: unknown) {
      // The fetch fails with a TypeError when the network drops; anything
      // else (a broken fetch) is loud.
      if (!(error instanceof TypeError)) throw error
      return cached === undefined
        ? { refusal: 'offline', detail: 'no cached index' }
        : { index: cached, cached: true }
    }
    if (fetched.digest === undefined) {
      await this.audit({ action: 'refuse', reason: 'missing-digest' })
      return { refusal: 'unverified', detail: 'index digest header' }
    }
    const verdict = await verifyIndex({
      indexBytes: fetched.bytes,
      expectedSha256: fetched.digest,
      actualSha256: sha256Hex(fetched.bytes),
      index: fetched.index,
      installedRevision: cached?.revision,
      now: this.deps.now().getTime(),
      verifySignature: this.deps.verifySignature,
    })
    if (!verdict.ok) {
      await this.audit({ action: 'refuse', reason: verdict.reason })
      return { refusal: refusalFor(verdict.reason), detail: verdict.reason }
    }
    await mkdir(this.root, { recursive: true })
    await writeFile(path.join(this.root, INDEX_FILE), Buffer.from(fetched.bytes))
    return { index: fetched.index, cached: false }
  }

  /**
  Install an experience: refresh the index (or stand on the cache
  offline), converge its pack set (the persona's packs, or the person's
  ticked list), drop what no experience references anymore, and rewrite
  the capability file. Re-running converges again.
  */
  async installExperience(experience: Persona, packs?: readonly PackName[]): Promise<PackVerdict> {
    const refreshed = await this.refreshIndex()
    if ('refusal' in refreshed) {
      return { ok: false, reason: refreshed.refusal, detail: refreshed.detail }
    }
    const names = packs ?? personaPacks(experience)
    for (const name of names) {
      const verdict = await this.installPack(name, refreshed.index, [])
      if (!verdict.ok) return verdict
    }
    const record = {
      name: experience,
      packs: [...names],
      installedAt: this.deps.now().toISOString(),
    }
    const experiences = await this.experiences()
    const next = experiences.some((entry) => entry.name === experience)
      ? experiences.map((entry) => (entry.name === experience ? record : entry))
      : [...experiences, record]
    await this.writeExperiences(next)
    await this.collectUnreferenced(new Set(next.flatMap((entry) => entry.packs)))
    await this.writeToolchains(await this.installedPacks())
    await this.audit({ action: 'install', experience })
    const notice: 'cached-index' | undefined = refreshed.cached ? 'cached-index' : undefined
    return { ok: true, notice }
  }

  /**
  Remove an experience: drop its count, and remove the packs no other
  experience references (their records and unshared layers), then
  rewrite the capability file.
  */
  async removeExperience(experience: string): Promise<PackVerdict> {
    const experiences = await this.experiences()
    if (experiences.every((record) => record.name !== experience)) {
      await this.audit({ action: 'refuse', experience, reason: 'not-found' })
      return { ok: false, reason: 'not-found', detail: experience }
    }
    const remaining = experiences.filter((record) => record.name !== experience)
    await this.writeExperiences(remaining)
    await this.collectUnreferenced(new Set(remaining.flatMap((record) => record.packs)))
    await this.writeToolchains(await this.installedPacks())
    await this.audit({ action: 'remove', experience })
    return { ok: true }
  }

  /**
  Offer updates: the installed packs the index has newer than the
  installed versions, with their versions and download bytes for this
  machine. Offline with a cache, the offer stands on the cache.
  */
  async checkUpdates(): Promise<
    | { readonly updates: readonly PackUpdate[]; readonly cached: boolean }
    | { readonly refusal: PackRefusal; readonly detail: string }
  > {
    const host = this.hostPlatform()
    if (host === undefined) {
      return {
        refusal: 'unsupported-platform',
        detail: `${this.deps.host.os}/${this.deps.host.arch}`,
      }
    }
    const refreshed = await this.refreshIndex()
    if ('refusal' in refreshed) {
      return { refusal: refreshed.refusal, detail: refreshed.detail }
    }
    const installed = await this.installedPacks()
    const updates: PackUpdate[] = []
    for (const definition of refreshed.index.packs) {
      const same = installed.get(definition.name)
      if (same === undefined || compareVersions(definition.version, same.version) <= 0) continue
      let bytes = 0
      for (const artifact of this.artifactsForHost(definition.artifacts, host)) {
        bytes += artifact.sizeBytes ?? 0
      }
      updates.push({
        pack: definition.name,
        installed: same.version,
        available: definition.version,
        bytes,
      })
    }
    return { updates, cached: refreshed.cached }
  }
}

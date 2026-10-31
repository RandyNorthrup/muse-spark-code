import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, mkdir, open, readdir, readFile, realpath, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  CREATED_REGISTRY_SAVE_ATTEMPTS,
  RESOURCE_BIGINT_ZERO,
  RESOURCE_PRIVATE_DIR_MODE,
  RESOURCE_PRIVATE_FILE_MODE,
  RESOURCE_RETIRED_SWEEP_WIDTH,
  RESOURCE_UNSAFE_WRITE_MODE,
  RESOURCE_TEMP_KEEP_MS,
  RESOURCE_TEMP_PREFIX,
  RESOURCE_TEMP_MARKER,
  RESOURCE_TEMP_TOKEN_BYTES,
} from '../../shared/constants'
import { fileIdentityKey, lstatIdentity } from '../fs/fileIdentity'
import { CreatedRegistrySaveError } from '../../shared/createdRegistrySaveError'

/**
The process that created an entry, as the system recorded it: its host,
its id and its birth (clock ticks since boot on Linux, with `bootId`;
epoch milliseconds elsewhere). A later start proves the creator exited
from this alone, so a tree whose host was killed, crashed or lost power
is reclaimable instead of leaking forever (RLF-TEMPLEAK). Entries a
build before this field wrote carry none and are never ended by a sweep:
their exit cannot be proven.
*/
const creatorSchema = z.strictObject({
  host: z.string().check(z.minLength(1)),
  pid: z.number().check(z.int(), z.gt(0)),
  processStart: z.number().check(z.gte(0)),
  bootId: z.optional(z.string().check(z.minLength(1))),
})
export type CreatedCreator = z.infer<typeof creatorSchema>
const entrySchema = z.strictObject({
  id: z.string().check(z.regex(/^[\da-f-]+$/u)),
  owner: z.string().check(z.minLength(1)),
  creator: z.optional(creatorSchema),
  path: z.string().check(z.minLength(1)),
  identity: z.optional(z.nullable(z.string().check(z.minLength(1)))),
  tokenHash: z.optional(z.nullable(z.string().check(z.regex(/^[\da-f]{64}$/u)))),
  state: z.enum(['pending', 'created']),
  kind: z.enum(['temp', 'osClone', 'worktree', 'dependencies']),
  endedAtMs: z.nullable(z.number().check(z.gte(0))),
  failed: z.boolean(),
})
type CreatedPath = z.infer<typeof entrySchema>
const manifestSchema = z.array(entrySchema)
/** Quarantine names for retired stages/displaced manifests; fresh and unguessable. */
const RETIRED_PREFIX = '.muse-retired-'
function isUuidText(text: string | undefined): boolean {
  return (
    text !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(text)
  )
}
export interface CreatedPathProof {
  /** Exact birth-bound whole-tree completion; absence of a PID is never proof. */
  exited(owner: string): Promise<boolean>
  /** This process as entries it creates will name it; undefined when the system cannot say. */
  creator(): Promise<CreatedCreator | undefined>
  /**
  Whether a recorded creator is provably gone on this host: no process
  has its id, or the process that has it was born at another time.
  Anything unreadable is never proof.
  */
  creatorExited(creator: CreatedCreator): Promise<boolean>
  createdByTree?: ((file: string, owner: string) => Promise<boolean>) | undefined
  archivedAndClean(file: string): Promise<boolean>
  freeBytes(file: string): Promise<number | null>
  /** Trusted native helper; args are the create/remove protocol, stdout is strict JSON. */
  directories?: ((args: readonly string[]) => Promise<string>) | undefined
  /** Trusted native no-replace rename, mkdir identity and manifest publication protocol. */
  files?: ((args: readonly string[]) => Promise<string>) | undefined
}
export interface CreatedCleanup {
  removed: number
  freedBytes: number | null
  /** Refusals remain protected and are reported without stopping unrelated cleanup. */
  refused?: readonly string[]
}
function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
Whether the native file helper ran and refused (a nonzero exit): the tree
runner wraps the child failure with the child's error as its cause, whose
numeric code is the exit status. Anything else (a spawn failure, a refusal
shaped any other way) is not a refusal the save can judge a race by.
*/
function isHelperRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return false
  const cause: unknown = error.cause
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false
  const code: unknown = cause.code
  return typeof code === 'number' && Number.isSafeInteger(code)
}

/** One entry per id, serialized for exact sync comparison. */
function snapshotEntries(entries: ReadonlyMap<string, CreatedPath>): Map<string, string> {
  const snapshot = new Map<string, string>()
  for (const [id, entry] of entries) snapshot.set(id, JSON.stringify(entry))
  return snapshot
}

function areSnapshotsEqual(
  left: ReadonlyMap<string, CreatedPath>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) return false
  for (const [id, entry] of left) {
    if (right.get(id) !== JSON.stringify(entry)) return false
  }
  return true
}

/** The live manifest behind one save attempt, with the publish's expected identity. */
interface LiveManifest {
  readonly contents: string
  readonly previous: string
  readonly isFresh: boolean
  readonly parent: string
  readonly parentIdentity: string
}

/** A publish attempt: landed, or the helper's refusal to judge a race by. */
type PublishAttempt = { readonly output: string } | { readonly refusal: unknown }

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Confinement and an ownership marker grant authority; a manifest alone never does. */
export class CreatedRegistry {
  static async open(
    file: string,
    now: () => number,
    proof: CreatedPathProof,
    base = path.join(path.dirname(file), 'trees'),
  ): Promise<CreatedRegistry> {
    if (!path.isAbsolute(file) || !path.isAbsolute(base))
      throw new Error('Creation registry must be absolute')
    await mkdir(path.dirname(base), { recursive: true, mode: RESOURCE_PRIVATE_DIR_MODE })
    try {
      await mkdir(base, { mode: RESOURCE_PRIVATE_DIR_MODE })
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error
    }
    // Initial OS aliases (macOS /var, Windows spelling) resolve once; later checks
    // bind only the verified canonical base, never the supplied ancestor alias.
    const registry = new CreatedRegistry(file, await realpath(base), now, proof)
    const sample = await lstatIdentity(base)
    registry.checkPrivate(sample, true)
    registry.baseIdentity = fileIdentityKey(sample)
    if (registry.baseIdentity === undefined) throw new Error('Unsafe creation base')
    await registry.verifyBase()
    try {
      const loaded = registry.parseManifest(await registry.checkManifest())
      for (const [id, entry] of loaded) registry.entries.set(id, entry)
      registry.synced = snapshotEntries(registry.entries)
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
    // Names an earlier run retained are retired by the same proof, in the
    // background through the registry's own queue, so a folder holding
    // thousands of them never holds back the first governed launch.
    await registry.queueLeftovers()
    return registry
  }

  private readonly entries = new Map<string, CreatedPath>()
  /** This process's entries as of its last sync with the live manifest (open or save). */
  private synced = new Map<string, string>()
  /** The background retirement of names earlier runs left; clean() reports its failure. */
  private leftovers: Promise<readonly PromiseSettledResult<void>[]> = Promise.resolve([])
  /** Entry ids and retained manifest names that failed proof and were left alone. */
  private readonly refused = new Set<string>()
  private readonly finished = new Set<string>()
  private readonly made = new Set<string>()
  private pending: Promise<unknown> = Promise.resolve()
  private baseIdentity: string | undefined
  private manifestIdentity: string | undefined

  private constructor(
    private readonly file: string,
    readonly base: string,
    private readonly now: () => number,
    private readonly proof: CreatedPathProof,
  ) {}

  private isUnsafe(
    sample: Awaited<ReturnType<typeof lstatIdentity>>,
    isDirectory: boolean,
  ): boolean {
    return (
      sample.isSymbolicLink() ||
      (isDirectory ? !sample.isDirectory() : !sample.isFile()) ||
      (process.platform !== 'win32' &&
        (process.getuid === undefined ||
          sample.uid !== BigInt(process.getuid()) ||
          (sample.mode & BigInt(RESOURCE_UNSAFE_WRITE_MODE)) !== RESOURCE_BIGINT_ZERO))
    )
  }

  private checkPrivate(
    sample: Awaited<ReturnType<typeof lstatIdentity>>,
    isDirectory: boolean,
  ): void {
    if (this.isUnsafe(sample, isDirectory))
      throw new Error('Unsafe creation registry ownership or permissions')
  }

  private checkPath(file: string): void {
    const name = path.basename(file)
    if (
      !path.isAbsolute(file) ||
      path.dirname(file) !== this.base ||
      file !== path.join(this.base, name) ||
      !/^muse-tree-[\da-f-]+$/u.test(name)
    )
      throw new Error('Invalid created path: outside creation base')
  }

  /** The manifest's bytes as entries, validated exactly as open() always validated them. */
  private parseManifest(contents: string): Map<string, CreatedPath> {
    const parsed = z.array(entrySchema).parse(JSON.parse(contents))
    const entries = new Map<string, CreatedPath>()
    for (const entry of parsed) {
      this.checkPath(entry.path)
      if (
        entries.has(entry.id) ||
        Array.from(entries.values(), (stored) => stored.path).includes(entry.path)
      )
        throw new Error('Invalid creation registry')
      entries.set(entry.id, entry)
    }
    return entries
  }

  private async checkManifest(): Promise<string> {
    const sample = await lstatIdentity(this.file)
    this.checkPrivate(sample, false)
    const handle = await open(
      this.file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    )
    try {
      const current = await handle.stat({ bigint: true })
      this.checkPrivate(current, false)
      if (fileIdentityKey(current) !== fileIdentityKey(sample))
        throw new Error('Creation manifest identity changed')
      const contents = await handle.readFile('utf8')
      this.manifestIdentity = fileIdentityKey(current)
      if (this.manifestIdentity === undefined) throw new Error('Unsafe manifest identity')
      return contents
    } finally {
      await handle.close()
    }
  }

  private async verifyBase(): Promise<void> {
    const sample = await lstatIdentity(this.base)
    this.checkPrivate(sample, true)
    if (fileIdentityKey(sample) !== this.baseIdentity || (await realpath(this.base)) !== this.base)
      throw new Error('Creation base identity changed')
    const after = await lstatIdentity(this.base)
    this.checkPrivate(after, true)
    if (fileIdentityKey(after) !== this.baseIdentity)
      throw new Error('Creation base identity changed')
  }

  private async withBase<T>(action: (base: string) => Promise<T>): Promise<T> {
    if (process.platform !== 'linux')
      throw new Error('Native creation directory helper is required')
    await this.verifyBase()
    const handle = await open(
      this.base,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      const sample = await handle.stat({ bigint: true })
      this.checkPrivate(sample, true)
      if (fileIdentityKey(sample) !== this.baseIdentity)
        throw new Error('Creation base identity changed')
      return await action(`/proc/self/fd/${String(handle.fd)}`)
    } finally {
      await handle.close()
    }
  }

  private async serial<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.pending
    const next = (async () => {
      try {
        await previous
      } catch {
        /* The previous caller observed its error. */
      }
      return await action()
    })()
    this.pending = next
    return await next
  }

  private async verifiedParent(): Promise<{ parent: string; identity: string }> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: RESOURCE_PRIVATE_DIR_MODE })
    const parent = await realpath(path.dirname(this.file))
    const parentSample = await lstatIdentity(parent)
    this.checkPrivate(parentSample, true)
    const identity = fileIdentityKey(parentSample)
    if (identity === undefined) throw new Error('Unsafe creation registry parent identity')
    return { parent, identity }
  }

  private isRetainedName(name: string): boolean {
    if (name.startsWith(RETIRED_PREFIX) && isUuidText(name.slice(RETIRED_PREFIX.length)))
      return true
    const legacy = /^([\da-f-]{36})\.json\.([\da-f-]{36})(\.(?:publish|previous))?$/u.exec(name)
    if (legacy !== null && isUuidText(legacy[1]) && isUuidText(legacy[2])) return true
    const live = path.basename(this.file)
    if (!name.startsWith(`${live}.`)) return false
    const rest = name.slice(live.length + 1)
    const stage =
      rest.endsWith('.publish') || rest.endsWith('.previous')
        ? rest.slice(0, rest.lastIndexOf('.'))
        : rest
    return isUuidText(stage)
  }

  /**
  Retire one retained stage or displaced manifest. Proof is content plus
  identity, never age or count: the bytes must parse as this registry's
  manifest, and the name must still be that file when it is unlinked. A name
  exchanged for anything else is left alone and reported, never removed.
  */
  private async retireRetained(parent: string, name: string): Promise<boolean> {
    const candidate = path.join(parent, name)
    let sample
    try {
      sample = await lstatIdentity(candidate)
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
      return true
    }
    const identity = fileIdentityKey(sample)
    if (identity === undefined || this.isUnsafe(sample, false)) {
      this.refused.add(candidate)
      return false
    }
    let text: string
    try {
      const handle = await open(
        candidate,
        constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
      )
      try {
        text = await handle.readFile('utf8')
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
      return true
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error
      this.refused.add(candidate)
      return false
    }
    if (!manifestSchema.safeParse(parsed).success) {
      this.refused.add(candidate)
      return false
    }
    // No-replace quarantine capture: success proves the trash name is this
    // file, whatever happens to the guessable name afterwards.
    const trash = path.join(parent, `${RETIRED_PREFIX}${randomUUID()}`)
    await link(candidate, trash)
    const captured = fileIdentityKey(await lstatIdentity(trash))
    let current: string | undefined
    try {
      current = fileIdentityKey(await lstatIdentity(candidate))
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
      current = undefined
    }
    if (captured !== identity || (current !== undefined && current !== identity)) {
      // An exchange raced the capture: drop only our own fresh trash name.
      await this.dropTrash(trash, captured)
      this.refused.add(candidate)
      return false
    }
    // Re-prove the content through the captured name, closing the gap between
    // the first read and the capture.
    let reproof: unknown
    try {
      reproof = JSON.parse(await readFile(trash, 'utf8'))
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error
      await this.dropTrash(trash, captured)
      this.refused.add(candidate)
      return false
    }
    if (!manifestSchema.safeParse(reproof).success) {
      await this.dropTrash(trash, captured)
      this.refused.add(candidate)
      return false
    }
    await unlink(candidate)
    if (!(await this.isGone(candidate))) throw new Error('Retained manifest name was not retired')
    await unlink(trash)
    if (!(await this.isGone(trash))) throw new Error('Retained manifest name was not retired')
    return true
  }

  private async dropTrash(trash: string, captured: string | undefined): Promise<void> {
    if (captured === undefined) return
    try {
      if (fileIdentityKey(await lstatIdentity(trash)) === captured) await unlink(trash)
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
  }

  private async isGone(file: string): Promise<boolean> {
    try {
      await lstatIdentity(file)
      return false
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
      return true
    }
  }

  /** Retire one batch of retained names in the verified registry folder. */
  private async retireBatch(names: readonly string[]): Promise<void> {
    const { parent } = await this.verifiedParent()
    await Promise.all(names.map((name) => this.retireRetained(parent, name)))
  }

  /**
  Start retiring every retained name an earlier run left, in the
  background. Each batch joins the registry's queue only after the one
  before it finished, so a save or cleanup asked for meanwhile goes first
  and a stage is never looked at while its save is publishing it. A failure
  is kept for clean(), which reports it with its cause.
  */
  private async queueLeftovers(): Promise<void> {
    const { parent } = await this.verifiedParent()
    const listed = await readdir(parent)
    const names = listed.filter((name) => this.isRetainedName(name))
    this.leftovers = this.retireLeftovers(names)
  }

  private async retireLeftovers(
    names: readonly string[],
  ): Promise<readonly PromiseSettledResult<void>[]> {
    const settled: PromiseSettledResult<void>[] = []
    for (let i = 0; i < names.length; i += RESOURCE_RETIRED_SWEEP_WIDTH) {
      const batch = names.slice(i, i + RESOURCE_RETIRED_SWEEP_WIDTH)
      settled.push(...(await Promise.allSettled([this.serial(() => this.retireBatch(batch))])))
    }
    return settled
  }

  private async save(): Promise<void> {
    // Safety limit (D121 clarification, RLF-SAFELIMITS): a lost
    // compare-and-swap re-reads the live manifest, merges this process's
    // entries into it, and publishes again, at most
    // CREATED_REGISTRY_SAVE_ATTEMPTS times — then the save throws
    // `contended` with words instead of republishing forever. Concurrent
    // instances (VS Code windows, ACP agents, the CLI) share the registry:
    // a save never drops another process's entries. Only a genuine failure
    // throws otherwise, typed for the caller's words.
    for (let attempt = 1; ; attempt += 1) {
      const live = await this.readLiveForSave()
      const merged = this.mergeLiveChecked(live)
      if (areSnapshotsEqual(merged, this.synced)) return
      const stage = await this.writeStageChecked(merged)
      const published = await this.tryPublishChecked(live, stage)
      if (!('refusal' in published)) {
        this.entries.clear()
        for (const [id, entry] of merged) this.entries.set(id, entry)
        this.synced = snapshotEntries(merged)
        // The publish keeps the stage and the displaced manifest under
        // guessable names; retire this save's own now that the live manifest
        // is proven, by content and identity. A failed proof leaves the name
        // alone and reports it. Names earlier runs left are the background
        // queue's (open()).
        await this.retireBatch([
          stage.stageName,
          `${stage.stageName}.previous`,
          `${stage.stageName}.publish`,
        ])
        return
      }
      // A lost swap and a genuine refusal look the same (the helper exits 1
      // either way). The live manifest tells them apart: unchanged means the
      // helper refused this save; changed means another process published
      // first, so merge again and publish again.
      const current = await this.readLiveForSave()
      if (current.previous === live.previous)
        throw new CreatedRegistrySaveError('refused', { cause: published.refusal })
      if (attempt >= CREATED_REGISTRY_SAVE_ATTEMPTS)
        throw new CreatedRegistrySaveError('contended', { cause: published.refusal })
    }
  }

  /** The live manifest behind one save attempt; a safety fault throws unsafe. */
  private async readLiveForSave(): Promise<LiveManifest> {
    try {
      await this.verifyBase()
      const { parent, identity: parentIdentity } = await this.verifiedParent()
      let previous = ''
      let contents = ''
      let isFresh = true
      try {
        contents = await this.checkManifest()
        previous = this.manifestIdentity ?? ''
        isFresh = false
      } catch (error: unknown) {
        if (!isMissing(error)) throw error
      }
      return { contents, previous, isFresh, parent, parentIdentity }
    } catch (error: unknown) {
      throw new CreatedRegistrySaveError('unsafe', { cause: error })
    }
  }

  /**
  The live manifest with this process's entries merged into it: entries this
  process added, changed or removed since its last sync win by id; anything
  else the live manifest holds is kept. A path this process recorded that
  the live manifest already holds under another id is genuinely ambiguous
  and throws invalid, never silently dropping either side.
  */
  private mergeLive(live: ReadonlyMap<string, CreatedPath>): Map<string, CreatedPath> {
    const merged = new Map(live)
    const livePaths = new Map<string, string>()
    for (const [id, entry] of live) livePaths.set(entry.path, id)
    for (const [id, entry] of this.entries) {
      if (this.synced.get(id) === JSON.stringify(entry)) continue
      const clash = livePaths.get(entry.path)
      if (clash !== undefined && clash !== id) throw new Error('Invalid creation registry')
      merged.set(id, entry)
      livePaths.set(entry.path, id)
    }
    for (const id of this.synced.keys()) {
      if (!this.entries.has(id)) merged.delete(id)
    }
    return merged
  }

  /** The merged live manifest; a validation fault throws invalid. */
  private mergeLiveChecked(live: LiveManifest): Map<string, CreatedPath> {
    try {
      return this.mergeLive(live.isFresh ? new Map() : this.parseManifest(live.contents))
    } catch (error: unknown) {
      throw new CreatedRegistrySaveError('invalid', { cause: error })
    }
  }

  /** The merged manifest staged for publication; a write fault throws io. */
  private async writeStageChecked(
    merged: ReadonlyMap<string, CreatedPath>,
  ): Promise<{ stageName: string; identity: string }> {
    const stage = `${this.file}.${randomUUID()}`
    try {
      const handle = await open(stage, 'wx', RESOURCE_PRIVATE_FILE_MODE)
      try {
        await handle.writeFile(JSON.stringify(Array.from(merged.values(), (entry) => entry)))
        await handle.sync()
        const identity = fileIdentityKey(await handle.stat({ bigint: true }))
        if (identity === undefined) throw new Error('Unsafe manifest stage identity')
        return { stageName: path.basename(stage), identity }
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      throw new CreatedRegistrySaveError('io', { cause: error })
    }
  }

  /**
  One publish: landed, or the helper's refusal to judge a race by. Anything
  but a refusal (a spawn failure, a malformed acknowledgement) is not a race
  signal and throws, typed when the helper answered.
  */
  private async tryPublishChecked(
    live: LiveManifest,
    stage: { stageName: string; identity: string },
  ): Promise<PublishAttempt> {
    let output: string
    try {
      output = await this.nativeFiles([
        'publish',
        live.parent,
        live.parentIdentity,
        stage.stageName,
        path.basename(this.file),
        live.previous,
        stage.identity,
      ])
    } catch (error: unknown) {
      if (!isHelperRefusal(error)) throw error
      return { refusal: error }
    }
    try {
      z.strictObject({ published: z.literal(true) }).parse(JSON.parse(output))
    } catch (error: unknown) {
      throw new CreatedRegistrySaveError('refused', { cause: error })
    }
    return { output }
  }

  private async nativeFiles(args: readonly string[]): Promise<string> {
    const helper = this.proof.files ?? this.proof.directories
    if (helper === undefined) throw new Error('Native creation file helper is required')
    return await helper(args)
  }

  private async renameEntry(source: string, target: string, identity: string): Promise<void> {
    z.strictObject({ renamed: z.literal(true) }).parse(
      JSON.parse(
        await this.nativeFiles([
          'rename',
          this.base,
          this.baseIdentity ?? '',
          path.basename(source),
          path.basename(target),
          '',
          identity,
        ]),
      ),
    )
  }

  private async removeDirectory(file: string, identity: string): Promise<void> {
    if (fileIdentityKey(await lstatIdentity(file)) !== identity)
      throw new Error('Created directory identity changed before removal')
    await rmdir(file)
  }

  private async directory<T>(
    file: string,
    identity: string,
    action: (directory: string, identity: string, mountId: string) => Promise<T>,
  ): Promise<T> {
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      const sample = await handle.stat({ bigint: true })
      const current = fileIdentityKey(sample)
      if (current === undefined || current !== identity)
        throw new Error('Created path identity changed during quarantine')
      this.checkPrivate(sample, true)
      const info = await readFile(`/proc/self/fdinfo/${String(handle.fd)}`, 'utf8')
      const mountId = z
        .string()
        .check(z.regex(/^[1-9][\d]*$/u))
        .parse(/^mnt_id:\s+([\d]+)$/mu.exec(info)?.[1])
      return await action(`/proc/self/fd/${String(handle.fd)}`, current, mountId)
    } finally {
      await handle.close()
    }
  }

  private async markerMatches(file: string, entry: CreatedPath): Promise<boolean> {
    try {
      const handle = await open(
        path.join(file, RESOURCE_TEMP_MARKER),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      )
      try {
        this.checkPrivate(await handle.stat({ bigint: true }), false)
        const readMarker = handle.readFile.bind(handle)
        const contents = await readMarker('utf8')
        const value = z
          .strictObject({ id: z.string(), token: z.string().check(z.regex(/^[\da-f]{32}$/u)) })
          .parse(JSON.parse(contents))
        return value.id === entry.id && digest(value.token) === entry.tokenHash
      } finally {
        await handle.close()
      }
    } catch {
      return false
    }
  }

  private async emptyDirectory(
    directory: string,
    rootIdentity: string,
    rootMountId: string,
  ): Promise<void> {
    const names = await readdir(directory)
    for (const name of names) {
      const child = path.join(directory, name)
      const sample = await lstatIdentity(child)
      if (sample.isDirectory() && !sample.isSymbolicLink()) {
        const identity = fileIdentityKey(sample)
        if (identity === undefined || identity.split(':', 1)[0] !== rootIdentity.split(':', 1)[0])
          throw new Error('Creation cleanup refuses a filesystem boundary')
        await this.directory(child, identity, async (pinned, _identity, mountId) => {
          if (mountId !== rootMountId) throw new Error('Creation cleanup refuses a mount boundary')
          await this.emptyDirectory(pinned, rootIdentity, rootMountId)
          await this.removeDirectory(child, identity)
        })
      } else {
        await unlink(child)
      }
    }
  }

  /**
  A refused quarantine restores its entry only onto a missing name, never
  over a replacement. Probe failures stay quarantined; the quarantine's own
  cause is refused and rethrown by the caller.
  */
  private async restoreQuarantined(
    source: string,
    trash: string,
    storedIdentity: string,
  ): Promise<void> {
    // Never overwrite a replacement when restoring a refused quarantine.
    try {
      await lstatIdentity(source)
    } catch (error: unknown) {
      if (isMissing(error)) {
        try {
          await this.renameEntry(trash, source, storedIdentity)
        } catch {
          /* A raced or replaced restore name remains quarantined and reported. */
        }
      }
    }
  }

  private async removeEntry(entry: CreatedPath): Promise<boolean> {
    if (this.refused.has(entry.id)) return false
    await this.checkManifest()
    if (entry.identity == null || entry.tokenHash == null)
      throw new Error('Created path has no stored identity or marker hash: report only')
    const storedIdentity = entry.identity
    // Loaded timestamps are retention hints, never evidence that a previous tree exited.
    const isGone =
      this.finished.has(entry.owner) ||
      (await this.proof.exited(entry.owner)) ||
      (entry.creator !== undefined && (await this.proof.creatorExited(entry.creator)))
    if (!isGone) return false
    if (entry.endedAtMs === null && entry.state !== 'pending') {
      // Nobody reported an end: the creator was killed, crashed or lost
      // power before finish() could land. This proof ends the entry now,
      // as failed, so a temp tree is still kept RESOURCE_TEMP_KEEP_MS for
      // diagnosis from here and then removed (RLF-TEMPLEAK).
      entry.endedAtMs = this.now()
      entry.failed = true
      await this.save()
    }
    if (
      entry.kind === 'temp' &&
      entry.failed &&
      entry.endedAtMs !== null &&
      this.now() - entry.endedAtMs < RESOURCE_TEMP_KEEP_MS
    )
      return false
    if (
      (entry.kind === 'worktree' || entry.kind === 'dependencies') &&
      !(await this.proof.archivedAndClean(entry.path))
    )
      return false
    this.checkPath(entry.path)
    if (this.proof.directories === undefined) {
      await this.withBase(async (base) => {
        const source = path.join(base, path.basename(entry.path))
        const trash = path.join(base, `.muse-trash-${entry.id}`)
        let isQuarantined = false
        try {
          const current = await lstatIdentity(source)
          if (
            !current.isDirectory() ||
            current.isSymbolicLink() ||
            fileIdentityKey(current) === undefined ||
            fileIdentityKey(current) !== entry.identity ||
            !(await this.markerMatches(source, entry))
          )
            throw new Error('Created path identity changed')
          try {
            await lstatIdentity(trash)
            throw new Error('Creation quarantine already exists')
          } catch (error: unknown) {
            if (!isMissing(error)) throw error
          }
          // Rename captures the entry atomically. No earlier checked pathname is recursively removed.
          await this.renameEntry(source, trash, storedIdentity)
          isQuarantined = true
          await this.directory(trash, storedIdentity, async (pinned, identity, mountId) => {
            if (!(await this.markerMatches(pinned, entry)))
              throw new Error('Created path identity changed during quarantine')
            await this.verifyBase()
            await this.emptyDirectory(pinned, identity, mountId)
            await this.removeDirectory(trash, identity)
          })
        } catch (error: unknown) {
          if (isQuarantined) await this.restoreQuarantined(source, trash, storedIdentity)
          if (isQuarantined || !isMissing(error)) {
            this.refused.add(entry.id)
            throw error
          }
        }
      })
    } else {
      try {
        z.strictObject({ removed: z.literal(true) }).parse(
          JSON.parse(
            await this.proof.directories([
              'remove',
              this.base,
              this.baseIdentity ?? '',
              path.basename(entry.path),
              entry.id,
              entry.tokenHash,
              storedIdentity,
            ]),
          ),
        )
      } catch (error: unknown) {
        this.refused.add(entry.id)
        throw error
      }
    }
    this.entries.delete(entry.id)
    this.made.delete(entry.id)
    await this.save()
    return true
  }

  /** Durable intent precedes mkdir, so ENOSPC cannot create an unregistered root. */
  createTemp(owner: string): Promise<{ id: string; root: string }> {
    return this.serial(async () => {
      const token = randomBytes(RESOURCE_TEMP_TOKEN_BYTES).toString('hex')
      const creator = await this.proof.creator()
      const entry = entrySchema.parse({
        id: randomUUID(),
        owner,
        ...(creator !== undefined && { creator }),
        kind: 'temp',
        path: path.join(this.base, `${RESOURCE_TEMP_PREFIX}${randomUUID()}`),
        identity: null,
        tokenHash: digest(token),
        state: 'pending',
        endedAtMs: null,
        failed: false,
      })
      this.entries.set(entry.id, entry)
      try {
        await this.save()
      } catch (error: unknown) {
        this.entries.delete(entry.id)
        throw error
      }
      if (this.proof.directories === undefined) {
        await this.withBase(async (base) => {
          const root = path.join(base, path.basename(entry.path))
          const made = z
            .strictObject({ identity: z.string().check(z.regex(/^[\d]+:[1-9][\d]*$/u)) })
            .parse(
              JSON.parse(
                await this.nativeFiles([
                  'mkdir',
                  this.base,
                  this.baseIdentity ?? '',
                  path.basename(root),
                  entry.id,
                  token,
                  '',
                ]),
              ),
            )
          await this.directory(root, made.identity, async (pinned, identity) => {
            const children = await readdir(pinned)
            if (children.length > 0) throw new Error('Created directory is not empty at open')
            const marker = await open(
              path.join(pinned, RESOURCE_TEMP_MARKER),
              'wx',
              RESOURCE_PRIVATE_FILE_MODE,
            )
            try {
              await marker.writeFile(JSON.stringify({ id: entry.id, token }))
              await marker.sync()
            } finally {
              await marker.close()
            }
            entry.identity = identity
            entry.state = 'created'
            await mkdir(path.join(pinned, 'browser-profile'), { mode: RESOURCE_PRIVATE_DIR_MODE })
            await mkdir(path.join(pinned, 'browser-cache'), { mode: RESOURCE_PRIVATE_DIR_MODE })
          })
        })
      } else {
        const answer = z
          .strictObject({ identity: z.string().check(z.regex(/^[\d]+:[1-9][\d]*$/u)) })
          .parse(
            JSON.parse(
              await this.proof.directories([
                'create',
                this.base,
                this.baseIdentity ?? '',
                path.basename(entry.path),
                entry.id,
                token,
                '',
              ]),
            ),
          )
        entry.identity = answer.identity
        entry.state = 'created'
      }
      await this.save()
      this.made.add(entry.id)
      return { id: entry.id, root: entry.path }
    })
  }

  /** Only this instance's own creation may be reclassified; never adopt an existing path. */
  recordCreated(file: string, owner: string, kind: CreatedPath['kind']): Promise<string> {
    return this.serial(async () => {
      this.checkPath(file)
      const entry = Array.from(this.entries.values(), (candidate) => candidate).find(
        (candidate) => candidate.path === file,
      )
      if (
        entry === undefined ||
        !this.made.has(entry.id) ||
        entry.owner !== owner ||
        entry.kind === kind
      )
        throw new Error('Created path cannot be registered: not this registry creation')
      if (kind === 'osClone' && (await this.proof.createdByTree?.(file, owner)) !== true)
        throw new Error('OS leftover creator unproved')
      entry.kind = kind
      await this.save()
      return entry.id
    })
  }

  finish(owner: string, isFailed: boolean): Promise<void> {
    return this.serial(async () => {
      if (!(await this.proof.exited(owner))) throw new Error('Created path owner is not retired')
      this.finished.add(owner)
      for (const entry of this.entries.values()) {
        if (entry.owner !== owner || entry.endedAtMs !== null) continue
        entry.endedAtMs = this.now()
        entry.failed = isFailed
      }
      await this.save()
    })
  }

  remove(file: string): Promise<boolean> {
    return this.serial(async () => {
      const entry = Array.from(this.entries.values(), (candidate) => candidate).find(
        (candidate) => candidate.path === file,
      )
      if (entry === undefined) throw new Error('Unregistered path: cleanup refused')
      return await this.removeEntry(entry)
    })
  }

  release(id: string): Promise<boolean> {
    return this.serial(async () => {
      const entry = this.entries.get(id)
      return entry !== undefined && (await this.removeEntry(entry))
    })
  }

  async clean(): Promise<CreatedCleanup> {
    // The background retirement of earlier runs' names finishes first (it
    // needs the queue, so it is awaited outside it); a failed batch is
    // reported once, with its cause.
    const settled = await this.leftovers
    this.leftovers = Promise.resolve([])
    const failure = settled.find((step) => step.status === 'rejected')
    if (failure !== undefined)
      throw new Error('Retained creation registry names could not be retired', {
        cause: failure.reason,
      })
    return await this.serial(async () => {
      // The sweep visits every entry the live manifest holds, including
      // ones other processes recorded after this instance opened: within
      // the queue every local change is already saved, so reloading can
      // only add what they wrote. A manifest that is not there yet (no
      // save ever landed) leaves this instance's view as it is.
      try {
        const loaded = this.parseManifest(await this.checkManifest())
        for (const [id, entry] of loaded) {
          if (this.entries.has(id)) continue
          this.entries.set(id, entry)
          this.synced.set(id, JSON.stringify(entry))
        }
      } catch (error: unknown) {
        if (!isMissing(error)) throw error
      }
      let removed = 0
      let freedBytes: number | null = 0
      for (const entry of this.entries.values()) {
        try {
          const before = await this.proof.freeBytes(entry.path)
          if (!(await this.removeEntry(entry))) continue
          removed++
          const after = await this.proof.freeBytes(this.base)
          if (before === null || after === null || freedBytes === null) freedBytes = null
          else freedBytes += Math.max(0, after - before)
        } catch {
          this.refused.add(entry.id)
        }
      }
      return { removed, freedBytes, ...(this.refused.size > 0 && { refused: [...this.refused] }) }
    })
  }
}

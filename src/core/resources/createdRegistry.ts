import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  RESOURCE_BIGINT_ZERO,
  RESOURCE_PRIVATE_DIR_MODE,
  RESOURCE_PRIVATE_FILE_MODE,
  RESOURCE_UNSAFE_WRITE_MODE,
  RESOURCE_TEMP_KEEP_MS,
  RESOURCE_TEMP_PREFIX,
  RESOURCE_TEMP_MARKER,
  RESOURCE_TEMP_TOKEN_BYTES,
} from '../../shared/constants'
import { fileIdentityKey, lstatIdentity } from '../fs/fileIdentity'

const entrySchema = z.strictObject({
  id: z.string().check(z.regex(/^[\da-f-]+$/u)),
  owner: z.string().check(z.minLength(1)),
  path: z.string().check(z.minLength(1)),
  identity: z.nullable(z.string().check(z.minLength(1))),
  tokenHash: z.string().check(z.regex(/^[\da-f]{64}$/u)),
  state: z.enum(['pending', 'created']),
  kind: z.enum(['temp', 'osClone', 'worktree', 'dependencies']),
  endedAtMs: z.nullable(z.number().check(z.gte(0))),
  failed: z.boolean(),
})
type CreatedPath = z.infer<typeof entrySchema>
export interface CreatedPathProof {
  /** Exact birth-bound whole-tree completion; absence of a PID is never proof. */
  exited(owner: string): Promise<boolean>
  createdByTree?: ((file: string, owner: string) => Promise<boolean>) | undefined
  archivedAndClean(file: string): Promise<boolean>
  freeBytes(file: string): Promise<number | null>
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
      const entries = z.array(entrySchema).parse(JSON.parse(await registry.checkManifest()))
      for (const entry of entries) {
        registry.checkPath(entry.path)
        if (
          registry.entries.has(entry.id) ||
          Array.from(registry.entries.values(), (stored) => stored.path).includes(entry.path)
        )
          throw new Error('Invalid creation registry')
        registry.entries.set(entry.id, entry)
      }
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
    return registry
  }

  private readonly entries = new Map<string, CreatedPath>()
  private readonly refused = new Set<string>()
  private readonly finished = new Set<string>()
  private pending: Promise<unknown> = Promise.resolve()
  private baseIdentity: string | undefined

  private constructor(
    private readonly file: string,
    readonly base: string,
    private readonly now: () => number,
    private readonly proof: CreatedPathProof,
  ) {}

  private checkPrivate(
    sample: Awaited<ReturnType<typeof lstatIdentity>>,
    isDirectory: boolean,
  ): void {
    if (
      sample.isSymbolicLink() ||
      (isDirectory ? !sample.isDirectory() : !sample.isFile()) ||
      (process.platform !== 'win32' &&
        (process.getuid === undefined ||
          sample.uid !== BigInt(process.getuid()) ||
          (sample.mode & BigInt(RESOURCE_UNSAFE_WRITE_MODE)) !== RESOURCE_BIGINT_ZERO))
    )
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
      return await handle.readFile('utf8')
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
    await this.verifyBase()
    let handle: FileHandle | undefined
    try {
      if (process.platform === 'linux') {
        handle = await open(
          this.base,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
        if (fileIdentityKey(await handle.stat({ bigint: true })) !== this.baseIdentity)
          throw new Error('Creation base identity changed')
      }
      return await action(handle === undefined ? this.base : `/proc/self/fd/${String(handle.fd)}`)
    } finally {
      await handle?.close()
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

  private async save(): Promise<void> {
    await this.verifyBase()
    await mkdir(path.dirname(this.file), { recursive: true, mode: RESOURCE_PRIVATE_DIR_MODE })
    try {
      await this.checkManifest()
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
    const stage = `${this.file}.${randomUUID()}`
    const handle = await open(stage, 'wx', RESOURCE_PRIVATE_FILE_MODE)
    try {
      await handle.writeFile(JSON.stringify(Array.from(this.entries.values(), (entry) => entry)))
      await handle.sync()
      await handle.close()
      await rename(stage, this.file)
    } finally {
      await handle.close()
      await rm(stage, { force: true })
    }
  }

  private async markerMatches(file: string, entry: CreatedPath): Promise<boolean> {
    try {
      const marker = path.join(file, RESOURCE_TEMP_MARKER)
      this.checkPrivate(await lstatIdentity(marker), false)
      const value = z
        .strictObject({ id: z.string(), token: z.string().check(z.regex(/^[\da-f]{32}$/u)) })
        .parse(JSON.parse(await readFile(marker, 'utf8')))
      return value.id === entry.id && digest(value.token) === entry.tokenHash
    } catch {
      return false
    }
  }

  private async removeEntry(entry: CreatedPath): Promise<boolean> {
    if (this.refused.has(entry.id)) return false
    await this.checkManifest()
    // Loaded timestamps are retention hints, never evidence that a previous tree exited.
    if (!this.finished.has(entry.owner) && !(await this.proof.exited(entry.owner))) return false
    if (entry.endedAtMs === null && entry.state !== 'pending') return false
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
          (entry.identity !== null && fileIdentityKey(current) !== entry.identity) ||
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
        await rename(source, trash)
        isQuarantined = true
        const moved = await lstatIdentity(trash)
        if (
          !moved.isDirectory() ||
          moved.isSymbolicLink() ||
          fileIdentityKey(moved) !== fileIdentityKey(current) ||
          !(await this.markerMatches(trash, entry))
        )
          throw new Error('Created path identity changed during quarantine')
        await this.verifyBase()
        await rm(trash, { recursive: true, force: false })
      } catch (error: unknown) {
        if (isQuarantined) {
          // Never overwrite a replacement when restoring a refused quarantine.
          try {
            await lstatIdentity(source)
          } catch (error_: unknown) {
            if (isMissing(error_)) await rename(trash, source)
          }
        }
        if (isQuarantined || !isMissing(error)) {
          this.refused.add(entry.id)
          throw error
        }
      }
    })
    this.entries.delete(entry.id)
    await this.save()
    return true
  }

  /** Durable intent precedes mkdir, so ENOSPC cannot create an unregistered root. */
  createTemp(owner: string): Promise<{ id: string; root: string }> {
    return this.serial(async () => {
      const token = randomBytes(RESOURCE_TEMP_TOKEN_BYTES).toString('hex')
      const entry = entrySchema.parse({
        id: randomUUID(),
        owner,
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
      await this.withBase(async (base) => {
        const root = path.join(base, path.basename(entry.path))
        await mkdir(root, { mode: RESOURCE_PRIVATE_DIR_MODE })
        await writeFile(
          path.join(root, RESOURCE_TEMP_MARKER),
          JSON.stringify({ id: entry.id, token }),
          { flag: 'wx', mode: RESOURCE_PRIVATE_FILE_MODE },
        )
        entry.identity = fileIdentityKey(await lstatIdentity(root)) ?? null
        if (entry.identity === null) throw new Error('Created path identity unavailable')
        entry.state = 'created'
        await mkdir(path.join(root, 'browser-profile'), { mode: RESOURCE_PRIVATE_DIR_MODE })
        await mkdir(path.join(root, 'browser-cache'), { mode: RESOURCE_PRIVATE_DIR_MODE })
      })
      await this.save()
      return { id: entry.id, root: entry.path }
    })
  }

  /** Additional harness-created kinds must use the same confinement and marker. */
  recordCreated(file: string, owner: string, kind: CreatedPath['kind']): Promise<string> {
    return this.serial(async () => {
      this.checkPath(file)
      if (kind === 'osClone' && (await this.proof.createdByTree?.(file, owner)) !== true)
        throw new Error('OS leftover creator unproved')
      const sample = await lstatIdentity(file)
      const identity = fileIdentityKey(sample)
      if (
        identity === undefined ||
        (await realpath(file)) !== file ||
        !sample.isDirectory() ||
        sample.isSymbolicLink() ||
        Array.from(this.entries.values(), (entry) => entry.path).includes(file)
      )
        throw new Error('Created path cannot be registered')
      const token = randomBytes(RESOURCE_TEMP_TOKEN_BYTES).toString('hex')
      const entry = entrySchema.parse({
        id: randomUUID(),
        owner,
        kind,
        path: file,
        identity,
        tokenHash: digest(token),
        state: 'created',
        endedAtMs: null,
        failed: false,
      })
      await writeFile(
        path.join(file, RESOURCE_TEMP_MARKER),
        JSON.stringify({ id: entry.id, token }),
        { flag: 'wx', mode: RESOURCE_PRIVATE_FILE_MODE },
      )
      this.entries.set(entry.id, entry)
      try {
        await this.save()
      } catch (error: unknown) {
        this.entries.delete(entry.id)
        throw error
      }
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

  clean(): Promise<CreatedCleanup> {
    return this.serial(async () => {
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

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readdir, readFile, realpath, rmdir, unlink } from 'node:fs/promises'
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
  identity: z.optional(z.nullable(z.string().check(z.minLength(1)))),
  tokenHash: z.optional(z.nullable(z.string().check(z.regex(/^[\da-f]{64}$/u)))),
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

  private async save(): Promise<void> {
    await this.verifyBase()
    await mkdir(path.dirname(this.file), { recursive: true, mode: RESOURCE_PRIVATE_DIR_MODE })
    let previous = ''
    try {
      await this.checkManifest()
      previous = this.manifestIdentity ?? ''
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
    const stage = `${this.file}.${randomUUID()}`
    const handle = await open(stage, 'wx', RESOURCE_PRIVATE_FILE_MODE)
    try {
      await handle.writeFile(JSON.stringify(Array.from(this.entries.values(), (entry) => entry)))
      await handle.sync()
      const identity = fileIdentityKey(await handle.stat({ bigint: true }))
      if (identity === undefined) throw new Error('Unsafe manifest stage identity')
      const parent = await realpath(path.dirname(this.file))
      const parentSample = await lstatIdentity(parent)
      this.checkPrivate(parentSample, true)
      z.strictObject({ published: z.literal(true) }).parse(
        JSON.parse(
          await this.nativeFiles([
            'publish',
            parent,
            fileIdentityKey(parentSample) ?? '',
            path.basename(stage),
            path.basename(this.file),
            previous,
            identity,
          ]),
        ),
      )
    } finally {
      await handle.close()
      // Retain stages/displaced manifests: an external name can be exchanged before unlink.
    }
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

  private async removeEntry(entry: CreatedPath): Promise<boolean> {
    if (this.refused.has(entry.id)) return false
    await this.checkManifest()
    if (entry.identity == null || entry.tokenHash == null)
      throw new Error('Created path has no stored identity or marker hash: report only')
    const storedIdentity = entry.identity
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
          if (isQuarantined) {
            // Never overwrite a replacement when restoring a refused quarantine.
            try {
              await lstatIdentity(source)
            } catch (error_: unknown) {
              if (isMissing(error_)) {
                try {
                  await this.renameEntry(trash, source, storedIdentity)
                } catch {
                  /* A raced or replaced restore name remains quarantined and reported. */
                }
              }
            }
          }
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

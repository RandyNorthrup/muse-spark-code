import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  RESOURCE_PRIVATE_DIR_MODE,
  RESOURCE_PRIVATE_FILE_MODE,
  RESOURCE_TEMP_KEEP_MS,
} from '../../shared/constants'
import { fileIdentityKey, lstatIdentity } from '../fs/fileIdentity'

const entrySchema = z.strictObject({
  id: z.string().check(z.minLength(1)),
  owner: z.string().check(z.minLength(1)),
  path: z.string().check(z.minLength(1)),
  identity: z.string().check(z.minLength(1)),
  kind: z.enum(['temp', 'osClone', 'worktree', 'dependencies']),
  endedAtMs: z.nullable(z.number().check(z.gte(0))),
  failed: z.boolean(),
})
type CreatedPath = z.infer<typeof entrySchema>
export interface CreatedPathProof {
  /** T supplies exact registered whole-tree completion; unknown must be false. */
  exited(owner: string): Promise<boolean>
  /** Lane 0/T records the exact creating tree for OS-owned external leftovers. */
  createdByTree?: ((file: string, owner: string) => Promise<boolean>) | undefined
  /** M96c/M109 supplies both archived/merged and clean; unknown must be false. */
  archivedAndClean(file: string): Promise<boolean>
  /** Observed free-space change; concurrent volume writers can affect it. */
  freeBytes(file: string): Promise<number | null>
}
export interface CreatedCleanup {
  removed: number
  freedBytes: number | null
}

/** Private, persisted creation records. No directory scanning grants deletion authority. */
export class CreatedRegistry {
  static async open(
    file: string,
    now: () => number,
    proof: CreatedPathProof,
  ): Promise<CreatedRegistry> {
    if (!path.isAbsolute(file)) throw new Error('Creation registry must be absolute')
    const registry = new CreatedRegistry(file, now, proof)
    try {
      const entries = z.array(entrySchema).parse(JSON.parse(await readFile(file, 'utf8')))
      for (const entry of entries) {
        if (
          !path.isAbsolute(entry.path) ||
          registry.entries.has(entry.id) ||
          Array.from(registry.entries.values(), (stored) => stored.path).includes(entry.path)
        )
          throw new Error('Invalid creation registry')
        registry.entries.set(entry.id, entry)
      }
    } catch (error: unknown) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error
    }
    return registry
  }

  private readonly entries = new Map<string, CreatedPath>()
  private pending: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly file: string,
    private readonly now: () => number,
    private readonly proof: CreatedPathProof,
  ) {}

  private async serial<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.pending
    const next = (async () => {
      try {
        await previous
      } catch {
        /* A prior caller observed its error; later operations can retry. */
      }
      return await action()
    })()
    this.pending = next
    return await next
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: RESOURCE_PRIVATE_DIR_MODE })
    const stage = `${this.file}.${randomUUID()}`
    try {
      await writeFile(stage, JSON.stringify(Array.from(this.entries.values(), (entry) => entry)), {
        flag: 'wx',
        mode: RESOURCE_PRIVATE_FILE_MODE,
      })
      await rename(stage, this.file)
    } finally {
      await rm(stage, { force: true })
    }
  }

  private async removeEntry(entry: CreatedPath): Promise<boolean> {
    // endedAtMs is persisted only after exact whole-tree proof, so a later
    // harness can honor retention without treating an absent PID as proof.
    if (entry.endedAtMs === null) return false
    if (
      entry.kind === 'temp' &&
      entry.failed &&
      this.now() - entry.endedAtMs < RESOURCE_TEMP_KEEP_MS
    )
      return false
    if (
      (entry.kind === 'worktree' || entry.kind === 'dependencies') &&
      !(await this.proof.archivedAndClean(entry.path))
    )
      return false
    try {
      const current = await lstatIdentity(entry.path)
      if (
        current.isSymbolicLink() ||
        fileIdentityKey(current) !== entry.identity ||
        (await realpath(entry.path)) !== entry.path
      )
        throw new Error('Created path identity changed')
      // Node removes nested symlinks rather than following them. Recheck the root
      // directly before removal; same-user concurrent directory mutation is a residual.
      await rm(entry.path, { recursive: true, force: false })
    } catch (error: unknown) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error
    }
    this.entries.delete(entry.id)
    await this.save()
    return true
  }

  /** Called only after the harness creates a path; OS clones also require T's creator proof. */
  recordCreated(file: string, owner: string, kind: CreatedPath['kind']): Promise<string> {
    return this.serial(async () => {
      const relative = path.relative(file, this.file)
      const isContainsRegistry =
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      if (
        isContainsRegistry ||
        !path.isAbsolute(file) ||
        file === path.parse(file).root ||
        file === this.file ||
        file === path.dirname(this.file)
      )
        throw new Error('Invalid created path')
      if (kind === 'osClone' && (await this.proof.createdByTree?.(file, owner)) !== true)
        throw new Error('OS leftover creator unproved')
      const sample = await lstatIdentity(file)
      const identity = fileIdentityKey(sample)
      const canonical = await realpath(file)
      if (
        canonical !== file ||
        identity === undefined ||
        sample.isSymbolicLink() ||
        Array.from(this.entries.values(), (entry) => entry.path).includes(file)
      )
        throw new Error('Created path cannot be registered')
      const entry = entrySchema.parse({
        id: randomUUID(),
        owner,
        kind,
        path: file,
        identity,
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
      return entry.id
    })
  }

  finish(owner: string, isFailed: boolean): Promise<void> {
    return this.serial(async () => {
      if (!(await this.proof.exited(owner))) throw new Error('Created path owner is not retired')
      const entries = Array.from(this.entries.values(), (entry) => entry)
      for (const entry of entries) {
        if (!(entry.owner === owner && entry.endedAtMs === null)) {
          continue
        }

        this.entries.set(
          entry.id,
          entrySchema.parse({ ...entry, endedAtMs: this.now(), failed: isFailed }),
        )
      }
      await this.save()
    })
  }

  /** Exact registered path required even for manual cleanup: never infer ownership from names. */
  remove(file: string): Promise<boolean> {
    return this.serial(async () => {
      const entry = Array.from(this.entries.values(), (candidate) => candidate).find(
        (candidate) => candidate.path === file,
      )
      if (entry === undefined) throw new Error('Unregistered path: cleanup refused')
      return await this.removeEntry(entry)
    })
  }

  /** A captured creation ID may already have been retired by the pressure cleaner. */
  release(id: string): Promise<boolean> {
    return this.serial(async () => {
      const entry = this.entries.get(id)
      return entry !== undefined && (await this.removeEntry(entry))
    })
  }

  clean(): Promise<CreatedCleanup> {
    return this.serial(async () => {
      const paths = Array.from(this.entries.values(), (entry) => entry)
      let removed = 0
      let freedBytes: number | null = 0
      for (const entry of paths) {
        const before = await this.proof.freeBytes(entry.path)
        if (!(await this.removeEntry(entry))) continue
        removed++
        const after = await this.proof.freeBytes(path.dirname(entry.path))
        if (before === null || after === null || freedBytes === null) freedBytes = null
        else freedBytes += Math.max(0, after - before)
      }
      return { removed, freedBytes }
    })
  }
}

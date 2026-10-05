import { lstat, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import type { LandingIntent } from '../../core/team/teamMerge'
import { lstatIdentity } from '../../core/fs/fileIdentity'
import { isSamePath } from '../../core/paths'
import { TEAM_SCHED_ID_MAX_CHARS, TEAM_WRITE_SET_MAX } from '../../shared/constants'
import { UI_TEXT } from '../../shared/constants'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { isOwnedFile, writeFileIfUnchanged } from '../fsAtomic'
import type { StagingCopy } from './stagingCopy'

const blobSchema = z.strictObject({
  oid: z.string().check(z.regex(/^[a-f0-9]+$/u)),
  mode: z.enum(['100644', '100755', '120000']),
})
const landingIdSchema = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(TEAM_SCHED_ID_MAX_CHARS),
    z.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u),
  )
const fileSchema = z.strictObject({
  path: z.string().check(
    z.minLength(1),
    z.refine(
      (name) =>
        !name.includes('\0') &&
        !name.includes(':') &&
        !name.includes('\\') &&
        !name.startsWith('/') &&
        name.split('/').every((part) => !['.', '..', '.git', ''].includes(part.toLowerCase())),
    ),
  ),
  before: z.nullable(blobSchema),
  after: z.nullable(blobSchema),
  tasks: z.array(landingIdSchema).check(z.minLength(1), z.maxLength(TEAM_WRITE_SET_MAX)),
})
const recordSchema = z
  .strictObject({
    id: landingIdSchema,
    windowInstanceId: landingIdSchema,
    root: z.string(),
    head: z.string(),
    snapshotTree: z.string(),
    checkIdentity: z.string(),
    status: z.enum(['open', 'landed', 'recovered']),
    files: z.array(fileSchema).check(z.maxLength(TEAM_WRITE_SET_MAX)),
    conflicts: z.array(z.string()).check(z.maxLength(TEAM_WRITE_SET_MAX)),
  })
  .check(
    z.refine(
      (record) => new Set(record.files.map((file) => file.path)).size === record.files.length,
    ),
  )

export type LandingRecord = z.infer<typeof recordSchema>
export type LandingFile = z.infer<typeof fileSchema>

/**
 * Lane K supplies the window's atomic, flushed journal. Its adapter retains the
 * referenced before/after blobs for the record's Recover/Undo lifetime.
 */
export interface LandingJournalStore {
  readonly read: (id: string) => Promise<unknown>
  readonly write: (record: LandingRecord) => Promise<void>
}

export interface LandingFileAccess {
  readonly read: (file: string) => Promise<LandingFile['before']>
  /** Must compare expected bytes/mode immediately before each rename/removal. */
  readonly replace: (
    file: string,
    expected: LandingFile['before'],
    replacement: LandingFile['before'],
  ) => Promise<boolean>
}

function isSameBlob(left: LandingFile['before'], right: LandingFile['before']): boolean {
  return left === null || right === null
    ? left === right
    : left.oid === right.oid && left.mode === right.mode
}

export class LandingJournal {
  public constructor(private readonly store: LandingJournalStore) {}

  public async read(id: string): Promise<LandingRecord> {
    return recordSchema.parse(await this.store.read(landingIdSchema.parse(id)))
  }

  /** All intents are durable before the first file; no completed-file inference. */
  public async prepare(record: LandingIntent): Promise<void> {
    const parsed = recordSchema.parse(record)
    if (parsed.status !== 'open') throw new Error('landing intent must be open')
    await this.store.write(parsed)
  }

  public async close(
    record: LandingIntent,
    status: 'landed' | 'recovered',
    conflicts: readonly string[],
  ): Promise<void> {
    await this.store.write(recordSchema.parse({ ...record, status, conflicts }))
  }

  /** Caller holds its own index.lock and has authorized recovery of this owner. */
  public async recover(
    record: LandingIntent,
    access: LandingFileAccess,
  ): Promise<readonly string[]> {
    const parsed = recordSchema.parse(record)
    const conflicts: string[] = []
    for (const file of parsed.files.toReversed()) {
      const current = await access.read(file.path)
      if (isSameBlob(current, file.before)) continue
      if (
        !isSameBlob(current, file.after) ||
        !(await access.replace(file.path, file.after, file.before))
      )
        conflicts.push(file.path)
    }
    await this.close(parsed, 'recovered', conflicts)
    return conflicts
  }

  /** A shared file needs Undo batch; an individual task cannot undo another's contribution. */
  public async undo(
    record: LandingIntent,
    taskId: string | null,
    access: LandingFileAccess,
  ): Promise<readonly string[]> {
    const parsed = recordSchema.parse(record)
    const conflicts: string[] = []
    for (const file of parsed.files.toReversed()) {
      if (taskId !== null && !file.tasks.includes(taskId)) continue
      if (
        (taskId !== null && file.tasks.length > 1) ||
        !(await access.replace(file.path, file.after, file.before))
      )
        conflicts.push(file.path)
    }
    return conflicts
  }
}

const EXECUTABLE_BITS = 0o111

/** The same raw-byte conditional mutations serve landing, Recover and Undo. */
export function landingFileAccess(
  root: string,
  staging: StagingCopy,
  options: {
    /** M96 lane I supplies canonical/protected/ref and unsaved-buffer admission. */
    readonly validateTarget: (file: string) => Promise<void>
    readonly rename?: (from: string, to: string) => Promise<void>
  },
): LandingFileAccess {
  const targetOf = async (file: string): Promise<string> => {
    fileSchema.shape.path.parse(file)
    const target = path.resolve(root, file)
    const canonicalRoot = await canonicalPath(root)
    const relative = path.relative(canonicalRoot, target)
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !isSamePath(await canonicalPath(target), target, process.platform)
    )
      throw new Error(UI_TEXT.checkpointFailed)
    await options.validateTarget(target)
    return target
  }
  const read = async (file: string): Promise<LandingFile['before']> => {
    const target = await targetOf(file)
    try {
      const info = await lstat(target)
      if (!info.isFile()) throw new Error(UI_TEXT.checkpointFailed)
      return {
        oid: await staging.blob(root, await readFile(target)),
        mode: (info.mode & EXECUTABLE_BITS) === 0 ? '100644' : '100755',
      }
    } catch (error: unknown) {
      if (isMissingPath(error)) return null
      throw error
    }
  }
  return {
    read,
    replace: async (file, expected, replacement) => {
      const target = await targetOf(file)
      if (!isSameBlob(await read(file), expected)) return false
      if (replacement === null) {
        if (expected === null) return true
        const held = await lstatIdentity(target)
        await targetOf(file)
        if (!isSameBlob(await read(file), expected) || !(await isOwnedFile(target, held)))
          return false
        await unlink(target)
        return true
      }
      if (replacement.mode === '120000') throw new Error(UI_TEXT.checkpointFailed)
      const bytes = await staging.readBlob(root, replacement.oid)
      return (
        (await writeFileIfUnchanged(
          target,
          async () => {
            await targetOf(file)
            return isSameBlob(await read(file), expected)
          },
          bytes,
          {
            sleep: delay,
            expectedCanonicalPath: target,
            executable: replacement.mode === '100755',
            ...(options.rename !== undefined && { rename: options.rename }),
          },
        )) === 'written'
      )
    },
  }
}

import { lstat, readdir, readFile, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import type { LandingIntent } from '../../core/team/teamMerge'
import { lstatIdentity } from '../../core/fs/fileIdentity'
import { isSamePath } from '../../core/paths'
import {
  ATOMIC_RENAME_ATTEMPTS,
  ATOMIC_RENAME_DELAY_MS,
  ATOMIC_TEMPORARY_SUFFIX,
  TEAM_SCHED_ID_MAX_CHARS,
  TEAM_WRITE_SET_MAX,
} from '../../shared/constants'
import { UI_TEXT } from '../../shared/constants'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { isOwnedFile, writeFileIfUnchanged } from '../fsAtomic'
import type { StagingCopy } from './stagingCopy'
import type { JournalRead, TeamJournal } from './teamJournal'

const blobSchema = z.strictObject({
  oid: z.string().check(z.regex(/^[a-f0-9]+$/u)),
  mode: z.enum(['100644', '100755', '120000']),
})
const stageIdSchema = z.uuid()
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
    status: z.enum(['open', 'landed', 'recovered', 'changed']),
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

/** One landing-* entry read across the window's and foreign journal stores. */
export interface LandingScanEntry {
  readonly name: string
  readonly raw: JournalRead<unknown>
  /** The store that owns the entry: recovery authority is its owner's. */
  readonly owner: TeamJournal['owner']
}

export interface LandingScan {
  /** True when a foreign journal is unreadable: the caller blocks landing. */
  readonly blocked: boolean
  readonly entries: readonly LandingScanEntry[]
}

/** Reads every landing-* entry across the window's and foreign journal stores. */
export async function scanLandingEntries(journalStore: TeamJournal): Promise<LandingScan> {
  const foreign = await journalStore.otherWindows()
  if (foreign.unreadable.length > 0) return { blocked: true, entries: [] }
  const entries: LandingScanEntry[] = []
  const stores = [journalStore, ...foreign.journals]
  for (const store of stores) {
    const names = await store.names()
    for (const name of names) {
      if (!name.startsWith('landing-')) continue
      entries.push({ name, raw: await store.read(name, z.unknown()), owner: store.owner })
    }
  }
  return { blocked: false, entries }
}

/** Parses one scanned value as the record its name claims; malformed input throws. */
export function parseLandingEntry(name: string, value: unknown): LandingRecord {
  landingIdSchema.parse(name.slice('landing-'.length))
  return recordSchema.parse(value)
}

/*
True when an open landing for this root exists, or when the scan cannot
prove otherwise: an unreadable store or a non-record entry blocks landing.
*/
export async function hasOpenLanding(
  journalStore: TeamJournal,
  canonical: string,
): Promise<boolean> {
  const scanned = await scanLandingEntries(journalStore)
  if (scanned.blocked) return true
  for (const entry of scanned.entries) {
    if (entry.raw.kind !== 'record') return true
    const record = parseLandingEntry(entry.name, entry.raw.value)
    if (record.status === 'open' && (await canonicalPath(record.root)) === canonical) return true
  }
  return false
}

/**
Lane K supplies the window's atomic, flushed journal. Its adapter retains the
referenced before/after blobs for the record's Recover/Undo lifetime.
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
    canWrite: () => Promise<boolean>,
  ) => Promise<boolean>
  /** Removes what a killed write staged beside `file`; false when the tree stopped being ours. */
  readonly removeStages: (
    file: string,
    blobs: readonly LandingFile['before'][],
    canWrite: () => Promise<boolean>,
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
    status: 'landed' | 'recovered' | 'changed',
    conflicts: readonly string[],
  ): Promise<void> {
    await this.store.write(recordSchema.parse({ ...record, status, conflicts }))
  }

  /** Caller holds its own index.lock and has authorized recovery of this owner. */
  public async recover(
    record: LandingIntent,
    access: LandingFileAccess,
    canWrite: () => Promise<boolean>,
  ): Promise<readonly string[]> {
    const conflicts: string[] = []
    const parsed = recordSchema.parse(record)
    for (const file of parsed.files.toReversed()) {
      const isClear = await access.removeStages(file.path, [file.before, file.after], canWrite)
      const current = await access.read(file.path)
      if (
        !isClear ||
        (!isSameBlob(current, file.before) &&
          (!isSameBlob(current, file.after) ||
            !(await access.replace(file.path, file.after, file.before, canWrite))))
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
    canWrite: () => Promise<boolean>,
  ): Promise<readonly string[]> {
    const parsed = recordSchema.parse(record)
    const conflicts: string[] = []
    let isWhole = true
    for (const file of parsed.files.toReversed()) {
      if (taskId !== null && (file.tasks.length > 1 || !file.tasks.includes(taskId)))
        isWhole = false
      if (taskId !== null && !file.tasks.includes(taskId)) continue
      // A file a stopped batch never reached holds its old bytes: there is nothing to put back.
      if (isSameBlob(await access.read(file.path), file.before)) continue
      if (
        (taskId !== null && file.tasks.length > 1) ||
        !(await access.replace(file.path, file.after, file.before, canWrite))
      )
        conflicts.push(file.path)
    }
    // Only a whole landing undone is over: another task's share of a batch stays to be undone.
    if (isWhole) await this.close(parsed, 'recovered', conflicts)
    return conflicts
  }
}

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
    const canonicalTarget = await canonicalPath(target)
    const relative = path.relative(canonicalRoot, canonicalTarget)
    // The canonical target must be the spelled one carried into canonical
    // space: a link at or below the root makes them differ. A system link
    // above the root (macOS spells temporary folders under `/var`, a link
    // to `/private/var`) is in both sides alike and cancels out.
    const spelled = path.join(canonicalRoot, path.relative(path.resolve(root), target))
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !isSamePath(canonicalTarget, spelled, process.platform)
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
        mode: staging.regularFileMode(
          file,
          info.mode,
          await staging.fileModes(root, await staging.head(root)),
        ),
      }
    } catch (error: unknown) {
      if (isMissingPath(error)) return null
      throw error
    }
  }
  /** The whole of one of `blobs`, or its start: a write killed while filling its stage. */
  const isLandingBytes = async (
    stage: string,
    blobs: readonly LandingFile['before'][],
  ): Promise<boolean> => {
    const bytes = await readFile(stage)
    for (const blob of blobs) {
      if (blob === null) continue
      const landed = await staging.readBlob(root, blob.oid)
      if (bytes.length <= landed.length && landed.subarray(0, bytes.length).equals(bytes))
        return true
    }
    return false
  }
  return {
    read,
    removeStages: async (file, blobs, canWrite) => {
      const target = await targetOf(file)
      const folder = path.dirname(target)
      // The name `writeFileIfUnchanged` gives a stage, in the target's folder:
      // no process ever finishes a dead lander's stage, and an untracked file
      // would ride every later snapshot. Only this landing's bytes go.
      const prefix = `${path.basename(target)}.`.toLowerCase()
      let names: readonly string[]
      try {
        names = await readdir(folder)
      } catch (error: unknown) {
        if (isMissingPath(error)) return true
        throw error
      }
      for (const name of names) {
        const lower = name.toLowerCase()
        if (
          !lower.startsWith(prefix) ||
          !lower.endsWith(ATOMIC_TEMPORARY_SUFFIX) ||
          !stageIdSchema.safeParse(lower.slice(prefix.length, -ATOMIC_TEMPORARY_SUFFIX.length))
            .success
        )
          continue
        const stage = path.join(folder, name)
        const held = await lstatIdentity(stage)
        if (!held.isFile() || !(await isLandingBytes(stage, blobs))) continue
        if (!(await isOwnedFile(stage, held)) || !(await canWrite())) return false
        await rm(stage, {
          force: true,
          maxRetries: ATOMIC_RENAME_ATTEMPTS,
          retryDelay: ATOMIC_RENAME_DELAY_MS,
        })
      }
      return true
    },
    replace: async (file, expected, replacement, canWrite) => {
      const target = await targetOf(file)
      if (!isSameBlob(await read(file), expected)) return false
      if (replacement === null) {
        if (expected === null) return true
        const held = await lstatIdentity(target)
        await targetOf(file)
        if (
          !isSameBlob(await read(file), expected) ||
          !(await isOwnedFile(target, held)) ||
          !(await canWrite())
        )
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
            return isSameBlob(await read(file), expected) && (await canWrite())
          },
          bytes,
          {
            sleep: delay,
            // The bound path is canonical, as every writer passes it: the
            // spelled target may sit under a system link (macOS `/var`).
            expectedCanonicalPath: await canonicalPath(target),
            executable: replacement.mode === '100755',
            ...(options.rename !== undefined && { rename: options.rename }),
          },
        )) === 'written'
      )
    },
  }
}

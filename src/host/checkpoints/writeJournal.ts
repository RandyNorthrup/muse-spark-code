// Restore by the tools' own writes (M86, PLAN.md D63): one extension-host
// instance's journal of the writes its owners make, and the bytes a restore
// or a Redo needs of them (spec section 6).
//
// `<storage>/m86/<instance>/journal.jsonl` holds one JSON line per entry,
// appended and flushed to the disk (fsync) before the append resolves: a
// write's intent is durable before the write is published, its outcome after.
// The before copies and the kept after bytes are content-addressed files
// beside it, `blobs/<oid>` (the git blob id, computed in this process: no git
// runs per write), each written and flushed under a temporary name and then
// renamed, so a blob that exists is whole. No git, no lock: only this
// instance appends to its journal; any window reads every instance's (a dead
// instance's journal is folded by whoever finds it, spec 6.4).
//
// An append that fails is cut off again (the file truncated to its last
// durable line and flushed), so the journal never shows an entry that may not
// be on the disk. When even that fails, the journal is broken: every later
// append is refused, so nothing is ever appended after a torn line, and the
// tools' writes that need one are refused before they change anything.
//
// POSIX flushes each folder a new name went into (the journal's, the blobs');
// Windows cannot open a folder to flush it, and NTFS journals its names itself.

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { gitBlobOid } from '../../core/checkpoints/gitListings'
import type { JournalEntry, Owner, WriteRecord } from '../../core/checkpoints/toolWrites'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  CHECKPOINT_BLOBS_DIR,
  CHECKPOINT_JOURNAL_FILE,
  CHECKPOINT_JOURNAL_FILE_MODE,
  CHECKPOINT_STORAGE_MODE,
  CHECKPOINT_WRITES_DIR,
  GIT_MODE_EXECUTABLE,
  GIT_MODE_FILE,
  GIT_SHA1_HEX_LENGTH,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'

/** What the journal asks of an open file: node's `FileHandle` is one. */
export interface JournalHandle {
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesWritten: number }>
  sync(): Promise<void>
  truncate(length: number): Promise<void>
  stat(): Promise<{ readonly size: number }>
  close(): Promise<void>
}

/** The file system the journal works on: node's own, or a test's that fails a step on purpose. */
export interface JournalFs {
  open(file: string, flags: string | number, mode?: number): Promise<JournalHandle>
  mkdir(folder: string, options: { recursive: true; mode: number }): Promise<string | undefined>
  rename(from: string, to: string): Promise<void>
  rm(file: string, options: { force: true }): Promise<void>
  stat(file: string): Promise<{ readonly size: number }>
  readFile(file: string): Promise<Uint8Array>
  readdir(folder: string): Promise<string[]>
}

const NODE_JOURNAL_FS: JournalFs = { open, mkdir, rename, rm, stat, readFile, readdir }

export interface WriteJournalDeps {
  /** The namespace's checkpoint storage folder. */
  readonly storageDir: string
  /** This extension-host lifetime's id: the journal's folder name. */
  readonly instance: string
  readonly fs?: JournalFs | undefined
  /** Whose folders cannot be flushed (Windows); the running one by default. */
  readonly platform?: NodeJS.Platform | undefined
}

/** One instance's journal as read back: its entries in order, and how its last line ended. */
export interface InstanceJournal {
  readonly entries: JournalEntry[]
  /**
   * `none`: every line whole. `intent`: the last line was cut short but
   * parses as an intent, which is its last entry (an unsettled write).
   * `unparsed`: a line that does not parse, skipped (its unit is unknown).
   * A cut-short last line that parses as any other entry is left out: it
   * was never durable, and what it would have settled stays unsettled.
   */
  readonly tornTail: 'none' | 'unparsed' | 'intent'
}

const LINE_FEED = '\n'
// Instance ids are UUIDs; any one path segment of these characters is taken.
const SAFE_SEGMENT = /^[\w-]+$/u
const OID_PATTERN = new RegExp(`^[0-9a-f]{${String(GIT_SHA1_HEX_LENGTH)}}$`, 'u')
// The journal is opened to read and write at a place, never to append: a
// line written at the durable length can be cut off again (Windows refuses
// to truncate a file opened for appending).
const JOURNAL_FLAGS = constants.O_RDWR | constants.O_CREAT

const ownerSchema = z.object({
  instance: z.string(),
  sessionId: z.string(),
  unitKind: z.enum(['turn', 'batch']),
  unitId: z.string(),
})
const contentSchema = z.object({
  present: z.boolean(),
  oid: z.optional(z.string().check(z.regex(OID_PATTERN))),
  mode: z.optional(z.enum([GIT_MODE_FILE, GIT_MODE_EXECUTABLE])),
})
const writeSchema = z.object({
  id: z.string(),
  instance: z.string(),
  seq: z.int(),
  owner: ownerSchema,
  path: z.string(),
  before: contentSchema,
  after: contentSchema,
  createdFolders: z.array(z.string()),
  isKept: z.boolean(),
})
const entrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('intent'), write: writeSchema }),
  z.object({ kind: z.literal('done'), id: z.string() }),
  z.object({ kind: z.literal('aborted'), id: z.string() }),
  z.object({ kind: z.literal('incomplete'), owner: ownerSchema }),
  z.object({ kind: z.literal('seal'), owner: ownerSchema }),
])

function instanceFolder(storageDir: string, instance: string): string {
  if (!SAFE_SEGMENT.test(instance)) {
    throw new Error(`not an instance id: ${instance}`)
  }
  return path.join(storageDir, CHECKPOINT_WRITES_DIR, instance)
}

/** The entry a line holds, or undefined when it holds none of this instance's. */
function parsedEntry(line: string, instance: string): JournalEntry | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  const parsed = entrySchema.safeParse(value)
  if (!parsed.success) {
    return undefined
  }
  const entry = parsed.data
  switch (entry.kind) {
    case 'intent': {
      const { write } = entry
      return write.instance === instance && write.owner.instance === instance ? entry : undefined
    }
    case 'incomplete':
    case 'seal': {
      return entry.owner.instance === instance ? entry : undefined
    }
    default: {
      return entry
    }
  }
}

/** The journal's text as entries, its last line judged by how it ended. */
function journalOf(text: string, instance: string): InstanceJournal {
  const lines = text.split(LINE_FEED)
  // After the last line feed: '' when the file ends whole, else a cut-short line.
  const tail = lines.pop() ?? ''
  const entries: JournalEntry[] = []
  let tornTail: InstanceJournal['tornTail'] = 'none'
  for (const line of lines) {
    const entry = parsedEntry(line, instance)
    if (entry === undefined) {
      tornTail = 'unparsed'
      continue
    }
    entries.push(entry)
  }
  if (tail === '') {
    return { entries, tornTail }
  }
  const last = parsedEntry(tail, instance)
  if (last === undefined) {
    return { entries, tornTail: 'unparsed' }
  }
  if (last.kind === 'intent') {
    entries.push(last)
    return { entries, tornTail: tornTail === 'none' ? 'intent' : tornTail }
  }
  return { entries, tornTail }
}

export class WriteJournal {
  /** Where a blob of an instance is kept. */
  public static blobPath(storageDir: string, instance: string, oid: string): string {
    if (!OID_PATTERN.test(oid)) {
      throw new Error(`not a blob id: ${oid}`)
    }
    return path.join(instanceFolder(storageDir, instance), CHECKPOINT_BLOBS_DIR, oid)
  }

  /** One journal, including a torn tail; absence means its first intent never came. */
  public static async readInstance(
    storageDir: string,
    instance: string,
    fs: JournalFs = NODE_JOURNAL_FS,
  ): Promise<InstanceJournal | undefined> {
    try {
      const bytes = await fs.readFile(
        path.join(instanceFolder(storageDir, instance), CHECKPOINT_JOURNAL_FILE),
      )
      return journalOf(Buffer.from(bytes).toString('utf8'), instance)
    } catch (error: unknown) {
      if (isMissingPath(error)) return undefined
      throw error
    }
  }

  /** Every instance's journal under the storage folder, by instance id. */
  public static async readAll(
    storageDir: string,
    fs: JournalFs = NODE_JOURNAL_FS,
  ): Promise<ReadonlyMap<string, InstanceJournal>> {
    const root = path.join(storageDir, CHECKPOINT_WRITES_DIR)
    let names: readonly string[]
    try {
      names = await fs.readdir(root)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return new Map()
      }
      throw error
    }
    const journals = new Map<string, InstanceJournal>()
    const instances = names
      .filter((name) => SAFE_SEGMENT.test(name))
      .toSorted((a, b) => a.localeCompare(b))
    for (const instance of instances) {
      const journal = await this.readInstance(storageDir, instance, fs)
      if (journal !== undefined) journals.set(instance, journal)
    }
    return journals
  }

  private readonly fs: JournalFs
  private readonly folder: string
  private readonly isFolderSyncable: boolean
  /** The open journal, opened by the first append. */
  private handle: JournalHandle | undefined
  /** How long the journal is with only durable lines in it. */
  private durableLength = 0
  /** Settles, never rejecting, when the last step queued has: appends run one after another. */
  private tail: Promise<void> = Promise.resolve()
  /** An append failed and could not be cut off: nothing more is appended. */
  private brokenBy: unknown
  /** Names whose directory barrier failed; retried even when mkdir finds them present. */
  private readonly pendingFolders = new Set<string>()

  public constructor(private readonly deps: WriteJournalDeps) {
    this.fs = deps.fs ?? NODE_JOURNAL_FS
    this.folder = instanceFolder(deps.storageDir, deps.instance)
    this.isFolderSyncable = (deps.platform ?? process.platform) !== 'win32'
  }

  /** A blob already there with the bytes' length: it was renamed into place whole. */
  private async isWhole(file: string, length: number): Promise<boolean> {
    let stats: { readonly size: number }
    try {
      stats = await this.fs.stat(file)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return false
      }
      throw error
    }
    return stats.size === length
  }

  /** `work` once every step queued before it has settled. */
  private async queued<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail
    const run = (async () => {
      await previous
      return await work()
    })()
    this.tail = settled(run)
    return await run
  }

  private async append(entry: JournalEntry): Promise<void> {
    await this.queued(async () => {
      await this.appendNow(entry)
    })
  }

  private async appendNow(entry: JournalEntry): Promise<void> {
    if (this.brokenBy !== undefined) {
      throw new Error('the write journal is broken', { cause: this.brokenBy })
    }
    this.handle ??= await this.openJournal()
    const { handle } = this
    const line = Buffer.from(`${JSON.stringify(entry)}${LINE_FEED}`, 'utf8')
    try {
      await writeWhole(handle, line, this.durableLength)
      await handle.sync()
    } catch (error: unknown) {
      await this.cutBack(handle, error)
      throw error
    }
    this.durableLength += line.length
  }

  /** The journal back to its durable lines, flushed; broken for good when that fails. */
  private async cutBack(handle: JournalHandle, cause: unknown): Promise<void> {
    try {
      await handle.truncate(this.durableLength)
      await handle.sync()
    } catch {
      this.brokenBy = cause
    }
  }

  private async openJournal(): Promise<JournalHandle> {
    await this.makeFolder(this.folder)
    const handle = await this.fs.open(
      path.join(this.folder, CHECKPOINT_JOURNAL_FILE),
      JOURNAL_FLAGS,
      CHECKPOINT_JOURNAL_FILE_MODE,
    )
    try {
      const { size } = await handle.stat()
      this.durableLength = size
      // The journal's own name, durable before its first line is.
      await this.syncFolder(this.folder)
    } catch (error: unknown) {
      await handle.close()
      throw error
    }
    return handle
  }

  /** The folder made, each new name in it flushed (POSIX). */
  private async makeFolder(folder: string): Promise<void> {
    const first = await this.fs.mkdir(folder, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    if (first !== undefined) {
      for (
        let made = folder;
        made.length >= first.length && path.dirname(made) !== made;
        made = path.dirname(made)
      ) {
        this.pendingFolders.add(path.dirname(made))
      }
    }
    for (const parent of this.pendingFolders) {
      await this.syncFolder(parent)
      this.pendingFolders.delete(parent)
    }
  }

  private async syncFolder(folder: string): Promise<void> {
    if (!this.isFolderSyncable) {
      return
    }
    const handle = await this.fs.open(folder, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  /** Keeps the bytes, flushed, under their blob id; resolves to the id. */
  public async writeBlob(bytes: Uint8Array): Promise<string> {
    const oid = gitBlobOid(bytes)
    const file = WriteJournal.blobPath(this.deps.storageDir, this.deps.instance, oid)
    const folder = path.dirname(file)
    await this.makeFolder(folder)
    if (await this.isWhole(file, bytes.length)) {
      await this.syncFolder(folder)
      return oid
    }
    const stage = `${file}.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`
    try {
      const handle = await this.fs.open(stage, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
      try {
        await writeWhole(handle, bytes, 0)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await this.fs.rename(stage, file)
    } catch (error: unknown) {
      try {
        await this.fs.rm(stage, { force: true })
      } catch {
        // The failure that stopped the blob is the one reported; a stage left is never read.
      }
      throw error
    }
    await this.syncFolder(folder)
    return oid
  }

  /** Own-instance snapshot taken inside the append queue, never through a live partial line. */
  public async snapshot(): Promise<InstanceJournal | undefined> {
    return await this.queued(async () => {
      try {
        const bytes = await this.fs.readFile(path.join(this.folder, CHECKPOINT_JOURNAL_FILE))
        return journalOf(Buffer.from(bytes).toString('utf8'), this.deps.instance)
      } catch (error: unknown) {
        if (isMissingPath(error)) {
          return
        }
        throw error
      }
    })
  }

  public async appendIntent(write: WriteRecord): Promise<void> {
    await this.append({ kind: 'intent', write })
  }

  public async appendDone(id: string): Promise<void> {
    await this.append({ kind: 'done', id })
  }

  public async appendAborted(id: string): Promise<void> {
    await this.append({ kind: 'aborted', id })
  }

  public async appendIncomplete(owner: Owner): Promise<void> {
    await this.append({ kind: 'incomplete', owner })
  }

  public async appendSeal(owner: Owner): Promise<void> {
    await this.append({ kind: 'seal', owner })
  }

  /** Closes the journal file once the appends queued have run; a later append opens it again. */
  public async close(): Promise<void> {
    await this.queued(async () => {
      const handle = this.handle
      this.handle = undefined
      await handle?.close()
    })
  }
}

/** Settles when the promise does, never rejecting: its caller has the failure. */
async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch {
    // Reported to the one who awaited it.
  }
}

/** Every byte written from `position` on, however many tries the file system takes. */
async function writeWhole(
  handle: JournalHandle,
  bytes: Uint8Array,
  position: number,
): Promise<void> {
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      position + offset,
    )
    offset += bytesWritten
  }
}

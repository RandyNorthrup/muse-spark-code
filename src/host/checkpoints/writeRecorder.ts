// Restore by the tools' own writes (M86, PLAN.md D63): the io one unit's
// tools write through, recording each write in the instance's journal
// (spec section 5).
//
// Each owner (a turn, a child turn, a restore or Redo batch) gets its own io,
// made when its unit's record is and drained at its end: no write is
// admitted after that, and those under way settle first. A write to a file
// below the workspace folder runs under a lock on its canonical path that
// every owner of the instance shares (`WriteLanes`), so the journal's order
// is the order the writes were published in:
// 1. the file is copied, from the handle it was opened by, while its path
//    still leads where it did (confined: no bytes from outside are kept);
// 2. the blobs it needs are kept and its intent journaled, durable, with
//    the before and the after: the oid of the exact bytes to be published;
// 3. it is published only while the file is still as copied (the
//    conditional writer; a new file only while there is none);
// 4. it is settled: `done` once published, `aborted` only with proof that
//    nothing changed, and nothing (unsettled) when that cannot be known.
// A write outside the folder (personal memory) is never recorded. A
// destination that is not a regular file is refused before anything,
// without being opened. Shell commands, hooks and MCP tools are never
// recorded: a restore says when they ran.

import { Buffer } from 'node:buffer'
import type { Stats } from 'node:fs'
import { constants } from 'node:fs'
import { lstat, open, rmdir } from 'node:fs/promises'
import path from 'node:path'
import type {
  ConditionalWrite,
  FileReservation,
  StagedFile,
  ToolIo,
  TurnWrites,
} from '../../core/backends/modelapi/tools'
import { gitBlobHash, gitBlobOid } from '../../core/checkpoints/gitListings'
import type { ContentState, Owner, WriteRecord } from '../../core/checkpoints/toolWrites'
import { turnKey } from '../../core/checkpoints/turnKey'
import type { MemoryWrites } from '../../core/memory/memoryStore'
import { isSamePath } from '../../core/paths'
import { bytesFingerprint } from '../../core/verify/fingerprint'
import { isBelow } from '../../core/workspacePath'
import { pathModule } from '../../core/workspaceRoot'
import {
  BOUNDED_FILE_READ_CHUNK_BYTES,
  CHECKPOINT_FILE_MAX_BYTES,
  CHECKPOINT_UNIT_BLOB_BYTES_MAX,
  CHECKPOINT_UNIT_INTENTS_MAX,
  GIT_MODE_EXECUTABLE,
  GIT_MODE_FILE,
  MODEL_TEXT,
} from '../../shared/constants'
import { isMissingPath } from '../canonicalPath'
import type { Logger } from '../logger'
import { WriteJournal } from './writeJournal'

const SEPARATOR = '/'
const CURRENT_FOLDER = '.'
// Git records a file as executable (100755) when its owner may execute it.
const OWNER_EXECUTE_BIT = 0o100
// Platforms whose usual file systems ignore letter case in names: one lock
// serves every spelling of a path there.
const CASE_FOLDING_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['win32', 'darwin'])
const ABSENT: ContentState = { present: false }
const EMPTY = Buffer.alloc(0)
const EMPTY_OID = gitBlobOid(EMPTY)

/**
 * One instance's order and locks, shared by every owner it records for
 * (turns, child turns, restore batches): a write's place in the order, and
 * one write at a time to a path.
 */
export class WriteLanes {
  private seq = 0
  private readonly tails = new Map<string, Promise<void>>()

  public constructor(private readonly platform: NodeJS.Platform) {}

  /** The next write's place in the instance's order, taken with its intent. */
  public nextSeq(): number {
    this.seq += 1
    return this.seq
  }

  /** `work` alone on the path: after every earlier write to it settles, and before any later one. */
  public async exclusive<T>(relative: string, work: () => Promise<T>): Promise<T> {
    const key = CASE_FOLDING_PLATFORMS.has(this.platform) ? relative.toLowerCase() : relative
    const before = this.tails.get(key)
    const running = (async () => {
      await before
      return await work()
    })()
    const tail = settled(running)
    this.tails.set(key, tail)
    try {
      return await running
    } finally {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key)
      }
    }
  }
}

export interface OwnerIoDeps {
  readonly journal: WriteJournal
  readonly lanes: WriteLanes
  readonly owner: Owner
  /** The workspace folder's canonical path: the writes below it are recorded. */
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** Links, junctions and short names resolved (`host/canonicalPath`). */
  readonly canonicalPath: (absolutePath: string) => Promise<string>
  readonly newId: () => string
  readonly log: Pick<Logger, 'warn'>
}

/** A unit's own io: every write recorded, until it is drained. */
export interface OwnerIo extends ToolIo {
  /** Admits no new write, and resolves once the writes under way have settled. */
  drain(): Promise<void>
  /**
   * A new file `publish` creates only where there is none (a memory note,
   * `createFileExclusively`), recorded: its intent journaled before
   * `publish` runs, its outcome after.
   */
  recordNew(
    absolutePath: string,
    content: string,
    expectedCanonicalPath: string | undefined,
    publish: () => Promise<void>,
  ): Promise<void>
}

/** A write's file: canonical, below the workspace folder. */
interface Target {
  readonly absolute: string
  /** Workspace-relative, `/`-separated: the write's recorded path. */
  readonly path: string
}

/** The file as it was before a write. */
interface Copy {
  readonly state: ContentState
  /** Its bytes, when at most CHECKPOINT_FILE_MAX_BYTES (the most a restore keeps). */
  readonly bytes: Buffer | undefined
}

/** Bytes a write needs kept: undefined when too large to keep. */
interface KeptBytes {
  readonly oid: string
  readonly bytes: Uint8Array | undefined
}

type WriteFields = Pick<WriteRecord, 'before' | 'after' | 'createdFolders' | 'isKept'>

async function lstatOrMissing(absolutePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(absolutePath)
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

function isSameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

/** Whether a restore would call the two the same: presence and bytes (spec 3.7). */
function isSameContent(left: ContentState, right: ContentState): boolean {
  return left.present === right.present && (!left.present || left.oid === right.oid)
}

function isNameTaken(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

/** Whether nothing is at the path; false when that cannot be told. */
async function isGone(target: Target): Promise<boolean> {
  try {
    return (await lstatOrMissing(target.absolute)) === undefined
  } catch {
    return false
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

function notRecorded(target: Target, cause: unknown): Error {
  return new Error(`${target.path} ${MODEL_TEXT.writeNotRecorded}`, { cause })
}

/** The copy's blob, and the bytes about to be published. */
function blobsOf(copy: Copy, published: Uint8Array): readonly KeptBytes[] {
  return [
    ...(copy.state.oid === undefined ? [] : [{ oid: copy.state.oid, bytes: copy.bytes }]),
    {
      oid: gitBlobOid(published),
      bytes: published.length <= CHECKPOINT_FILE_MAX_BYTES ? published : undefined,
    },
  ]
}

function changedPath(): Error {
  return new Error(MODEL_TEXT.pathChangedAfterApproval)
}

/** The last `count` folders on the way to the file, its own included, outermost first. */
function innermostFolders(relative: string, count: number): readonly string[] {
  const folders: string[] = []
  for (
    let folder = path.posix.dirname(relative);
    folder !== CURRENT_FOLDER && folders.length < count;
    folder = path.posix.dirname(folder)
  ) {
    folders.unshift(folder)
  }
  return folders
}

export function createOwnerIo(io: ToolIo, deps: OwnerIoDeps): OwnerIo {
  const p = pathModule(deps.platform)
  const inFlight = new Set<Promise<void>>()
  let isDrained = false
  let intents = 0
  let incompleteMarked: Promise<void> | undefined
  let keptBytes = 0
  const keptOids = new Set<string>()
  // Opened for reading without following a final link or waiting on a pipe.
  const readFlags =
    deps.platform === 'win32'
      ? constants.O_RDONLY
      : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

  const assertOpen = (name: string): void => {
    if (isDrained) {
      throw new Error(`${name} ${MODEL_TEXT.turnWritesEnded}`)
    }
  }

  /** The canonical file below the workspace folder; undefined outside it, which is never recorded. */
  const targetOf = async (
    absolutePath: string,
    expectedCanonicalPath: string | undefined,
  ): Promise<Target | undefined> => {
    assertOpen(absolutePath)
    const canonical = await deps.canonicalPath(absolutePath)
    if (
      expectedCanonicalPath !== undefined &&
      !isSamePath(canonical, expectedCanonicalPath, deps.platform)
    ) {
      throw changedPath()
    }
    const relative = p.relative(deps.workspaceRoot, canonical)
    return isBelow(relative, p)
      ? { absolute: canonical, path: relative.split(p.sep).join(SEPARATOR) }
      : undefined
  }

  /** A write of this owner: admitted until the drain, which waits for it; alone on its path. */
  const admitted = async <T>(target: Target, work: () => Promise<T>): Promise<T> => {
    assertOpen(target.path)
    const running = deps.lanes.exclusive(target.path, work)
    const settling = settled(running)
    inFlight.add(settling)
    try {
      return await running
    } finally {
      inFlight.delete(settling)
    }
  }

  /** Refuses, unopened, a destination that is not a regular file (spec 5.3, O2). */
  const assertWritable = async (target: Target): Promise<Stats | undefined> => {
    const stats = await lstatOrMissing(target.absolute)
    if (stats !== undefined && !stats.isFile()) {
      throw new Error(`${target.path} ${MODEL_TEXT.fileNotRegular}`)
    }
    return stats
  }

  /** Whether the write is recorded: past the unit's intents, its `incomplete` is durable first. */
  const isRecorded = async (target: Target): Promise<boolean> => {
    if (intents < CHECKPOINT_UNIT_INTENTS_MAX) {
      intents += 1
      return true
    }
    incompleteMarked ??= deps.journal.appendIncomplete(deps.owner)
    try {
      await incompleteMarked
    } catch (error: unknown) {
      // Not durable: the next write past the budget tries again, and none goes unrecorded first.
      incompleteMarked = undefined
      throw notRecorded(target, error)
    }
    return false
  }

  /** The path still leads, links resolved, where it did, and still names the opened file. */
  const assertStillNamed = async (target: Target, held: Stats): Promise<void> => {
    if (!isSamePath(await deps.canonicalPath(target.absolute), target.absolute, deps.platform)) {
      throw changedPath()
    }
    const current = await lstatOrMissing(target.absolute)
    if (current?.isFile() !== true || !isSameFile(current, held)) {
      throw changedPath()
    }
  }

  const gitMode = (mode: number): string | undefined => {
    // Windows keeps no execute bit: the mode is not known there.
    if (deps.platform === 'win32') {
      return undefined
    }
    return (mode & OWNER_EXECUTE_BIT) === 0 ? GIT_MODE_FILE : GIT_MODE_EXECUTABLE
  }

  /**
   * The file now, read from the handle it was opened by, and only while the
   * path names that file inside the folder before and after the read: a
   * folder swapped for a link meanwhile keeps nothing of where it led.
   */
  const copyOf = async (target: Target): Promise<Copy> => {
    const seen = await assertWritable(target)
    if (seen === undefined) {
      return { state: ABSENT, bytes: undefined }
    }
    const handle = await open(target.absolute, readFlags)
    try {
      const held = await handle.stat()
      if (!held.isFile() || !isSameFile(held, seen)) {
        throw changedPath()
      }
      await assertStillNamed(target, held)
      const isKept = held.size <= CHECKPOINT_FILE_MAX_BYTES
      const hash = gitBlobHash(held.size)
      const parts: Buffer[] = []
      let total = 0
      for (;;) {
        const part = Buffer.allocUnsafe(BOUNDED_FILE_READ_CHUNK_BYTES)
        const { bytesRead } = await handle.read(part, 0, part.length, total)
        if (bytesRead === 0) {
          break
        }
        total += bytesRead
        if (total > held.size) {
          throw changedPath()
        }
        hash.update(part.subarray(0, bytesRead))
        if (isKept) {
          parts.push(part.subarray(0, bytesRead))
        }
      }
      if (total !== held.size) {
        throw changedPath()
      }
      await assertStillNamed(target, held)
      return {
        state: { present: true, oid: hash.digest('hex'), mode: gitMode(held.mode) },
        bytes: isKept ? Buffer.concat(parts, total) : undefined,
      }
    } finally {
      await handle.close()
    }
  }

  /** The conditional writer's question: is the file still as copied? Unknown is no. */
  const isAsCopied = async (target: Target, before: ContentState): Promise<boolean> => {
    let now: Copy
    try {
      now = await copyOf(target)
    } catch {
      return false
    }
    return isSameContent(now.state, before)
  }

  /**
   * Keeps what a write needs within the unit's budget (spec 9): every blob,
   * or none, and the write is then recorded with its oids only (not kept).
   */
  const hasKept = async (target: Target, blobs: readonly KeptBytes[]): Promise<boolean> => {
    const fresh = new Map<string, Uint8Array>()
    for (const blob of blobs) {
      if (blob.bytes === undefined) {
        return false
      }
      if (!keptOids.has(blob.oid)) {
        fresh.set(blob.oid, blob.bytes)
      }
    }
    let size = 0
    for (const bytes of fresh.values()) {
      size += bytes.length
    }
    if (keptBytes + size > CHECKPOINT_UNIT_BLOB_BYTES_MAX) {
      return false
    }
    keptBytes += size
    try {
      for (const [oid, bytes] of fresh) {
        await deps.journal.writeBlob(bytes)
        keptOids.add(oid)
      }
    } catch (error: unknown) {
      throw notRecorded(target, error)
    }
    return true
  }

  /** The write's intent, durable, before its publication; its place in the order taken now. */
  const journalIntent = async (target: Target, id: string, fields: WriteFields): Promise<void> => {
    const write: WriteRecord = {
      id,
      instance: deps.owner.instance,
      seq: deps.lanes.nextSeq(),
      owner: deps.owner,
      path: target.path,
      ...fields,
    }
    try {
      await deps.journal.appendIntent(write)
    } catch (error: unknown) {
      throw notRecorded(target, error)
    }
  }

  /**
   * The write's outcome. One that cannot be journaled leaves it unsettled
   * (the journal keeps no line that may not be durable), which a restore
   * resolves by the file's bytes or refuses: never a wrong restore.
   */
  const settle = async (target: Target, id: string, outcome: 'done' | 'aborted'): Promise<void> => {
    try {
      await (outcome === 'done' ? deps.journal.appendDone(id) : deps.journal.appendAborted(id))
    } catch (error: unknown) {
      deps.log.warn(
        `A write to ${target.path} stays unsettled: its outcome could not be journaled (${error instanceof Error ? error.name : 'unknown failure'})`,
      )
    }
  }

  /** The folders a refused write created for its file, removed again while empty. */
  const removeCreated = async (folders: readonly string[]): Promise<void> => {
    for (const folder of folders.toReversed()) {
      try {
        await rmdir(p.join(deps.workspaceRoot, ...folder.split(SEPARATOR)))
      } catch {
        // Not empty (another write put something there) or gone: it stays.
        return
      }
    }
  }

  /** Every folder the file's creation will make: the missing ones on its way, outermost first. */
  const missingFolders = async (target: Target): Promise<readonly string[]> => {
    const missing: string[] = []
    for (
      let folder = path.posix.dirname(target.path);
      folder !== CURRENT_FOLDER;
      folder = path.posix.dirname(folder)
    ) {
      if (
        (await lstatOrMissing(p.join(deps.workspaceRoot, ...folder.split(SEPARATOR)))) !== undefined
      ) {
        break
      }
      missing.unshift(folder)
    }
    return missing
  }

  /**
   * `content` published over the file only while it is still as copied (and
   * as `isExpected` says), its intent journaled once the content is staged
   * beside it: the staged file's mode and the folders the write made are
   * known by then, and nothing is replaced yet.
   */
  const publishRecorded = async (
    target: Target,
    copy: Copy,
    content: string,
    isExpected: () => Promise<boolean>,
    options: Pick<Parameters<ToolIo['writeFileIfUnchanged']>[3], 'unsavedAt' | 'assertCanWrite'>,
  ): Promise<ConditionalWrite> => {
    const published = Buffer.from(content, 'utf8')
    const isKept = await hasKept(target, blobsOf(copy, published))
    const id = deps.newId()
    // Set by the writer's `staged` step, read once it returns or throws.
    const intent: { isJournaled: boolean; unrecordedFolders: readonly string[] } = {
      isJournaled: false,
      unrecordedFolders: [],
    }
    const staged = async (file: StagedFile): Promise<void> => {
      const createdFolders = innermostFolders(target.path, file.createdFolders)
      try {
        await journalIntent(target, id, {
          before: copy.state,
          after: { present: true, oid: gitBlobOid(published), mode: gitMode(file.mode) },
          createdFolders,
          isKept,
        })
      } catch (error: unknown) {
        // Removed once the writer has taken its staged file away again.
        intent.unrecordedFolders = createdFolders
        throw error
      }
      intent.isJournaled = true
    }
    let result: ConditionalWrite
    try {
      result = await io.writeFileIfUnchanged(target.absolute, isExpected, content, {
        expectedCanonicalPath: target.absolute,
        unsavedAt: options.unsavedAt,
        ...(options.assertCanWrite !== undefined && { assertCanWrite: options.assertCanWrite }),
        staged,
      })
    } catch (error: unknown) {
      // The writer fails only before its rename, which publishes or not at all.
      if (intent.isJournaled) {
        await settle(target, id, 'aborted')
      }
      // Refused before any change: not even the folders made for the file stay.
      await removeCreated(intent.unrecordedFolders)
      throw error
    }
    if (intent.isJournaled) {
      await settle(target, id, result === 'written' ? 'done' : 'aborted')
    }
    return result
  }

  /** A reservation's steps, each recorded as the write it is (spec 5.2). */
  const recordedReservation = (target: Target, inner: FileReservation): FileReservation => {
    const step = async (
      blobs: readonly KeptBytes[],
      fields: Omit<WriteFields, 'isKept'>,
      run: () => Promise<'done' | 'changed'>,
    ) =>
      await admitted(target, async () => {
        if (!(await isRecorded(target))) {
          return await run()
        }
        const isKept = await hasKept(target, blobs)
        const id = deps.newId()
        await journalIntent(target, id, { ...fields, isKept })
        // A failure part way (a partial fill, a failed close) leaves the write unsettled.
        const result = await run()
        await settle(target, id, result === 'done' ? 'done' : 'aborted')
        return result
      })
    const empty: ContentState = { present: true, oid: EMPTY_OID }
    return {
      fill: async (bytes) =>
        await step(
          blobsOf({ state: empty, bytes: EMPTY }, bytes),
          { before: empty, after: { present: true, oid: gitBlobOid(bytes) }, createdFolders: [] },
          async () => await inner.fill(bytes),
        ),
      release: async () =>
        await step(
          [{ oid: EMPTY_OID, bytes: EMPTY }],
          { before: empty, after: ABSENT, createdFolders: [] },
          async () => await inner.release(),
        ),
    }
  }

  return {
    ...io,
    writeFile: async (absolutePath, content, expectedCanonicalPath, assertCanWrite) => {
      const target = await targetOf(absolutePath, expectedCanonicalPath)
      if (target === undefined) {
        await io.writeFile(absolutePath, content, expectedCanonicalPath, assertCanWrite)
        return
      }
      await admitted(target, async () => {
        await assertWritable(target)
        if (!(await isRecorded(target))) {
          await io.writeFile(target.absolute, content, target.absolute, assertCanWrite)
          return
        }
        const copy = await copyOf(target)
        const result = await publishRecorded(
          target,
          copy,
          content,
          async () => await isAsCopied(target, copy.state),
          { unsavedAt: [], ...(assertCanWrite !== undefined && { assertCanWrite }) },
        )
        if (result === 'changed') {
          throw new Error(`${target.path} ${MODEL_TEXT.fileChangedWhileWriting}`)
        }
      })
    },
    writeFileIfUnchanged: async (absolutePath, expected, content, options) => {
      const target = await targetOf(absolutePath, options.expectedCanonicalPath)
      if (target === undefined) {
        return await io.writeFileIfUnchanged(absolutePath, expected, content, options)
      }
      return await admitted(target, async () => {
        await assertWritable(target)
        if (!(await isRecorded(target))) {
          return await io.writeFileIfUnchanged(target.absolute, expected, content, options)
        }
        const copy = await copyOf(target)
        // A fingerprint names text the edit wrote (never more than a kept
        // copy holds): a copy that is not that text would not be replaced.
        if (
          typeof expected === 'string' &&
          (copy.bytes === undefined || bytesFingerprint(copy.bytes) !== expected)
        ) {
          return 'changed'
        }
        const isExpected = async () =>
          (await isAsCopied(target, copy.state)) &&
          (typeof expected === 'string' || (await expected()))
        return await publishRecorded(target, copy, content, isExpected, options)
      })
    },
    reserveFile: async (absolutePath, expectedCanonicalPath) => {
      const target = await targetOf(absolutePath, expectedCanonicalPath)
      if (target === undefined) {
        return await io.reserveFile(absolutePath, expectedCanonicalPath)
      }
      return await admitted(target, async () => {
        // Something there: the exclusive create refuses it and makes nothing.
        if ((await lstatOrMissing(target.absolute)) !== undefined || !(await isRecorded(target))) {
          return await io.reserveFile(target.absolute, target.absolute)
        }
        const createdFolders = await missingFolders(target)
        const isKept = await hasKept(target, [{ oid: EMPTY_OID, bytes: EMPTY }])
        const id = deps.newId()
        await journalIntent(target, id, {
          before: ABSENT,
          after: { present: true, oid: EMPTY_OID },
          createdFolders,
          isKept,
        })
        let reservation: FileReservation
        try {
          reservation = await io.reserveFile(target.absolute, target.absolute)
        } catch (error: unknown) {
          // Refused as taken, or nothing there now: proof nothing was made.
          // Anything else leaves the write unsettled.
          if (isNameTaken(error) || (await isGone(target))) {
            await settle(target, id, 'aborted')
          }
          throw error
        }
        await settle(target, id, 'done')
        return recordedReservation(target, reservation)
      })
    },
    recordNew: async (absolutePath, content, expectedCanonicalPath, publish) => {
      const target = await targetOf(absolutePath, expectedCanonicalPath)
      if (target === undefined) {
        await publish()
        return
      }
      await admitted(target, async () => {
        // Something there: the exclusive publication refuses it and makes nothing.
        if ((await assertWritable(target)) !== undefined || !(await isRecorded(target))) {
          await publish()
          return
        }
        const createdFolders = await missingFolders(target)
        const bytes = Buffer.from(content, 'utf8')
        const isKept = await hasKept(target, blobsOf({ state: ABSENT, bytes: undefined }, bytes))
        const id = deps.newId()
        await journalIntent(target, id, {
          before: ABSENT,
          after: { present: true, oid: gitBlobOid(bytes) },
          createdFolders,
          isKept,
        })
        try {
          await publish()
        } catch (error: unknown) {
          // It throws only before its no-clobber link publishes anything.
          await settle(target, id, 'aborted')
          throw error
        }
        await settle(target, id, 'done')
      })
    },
    drain: async () => {
      isDrained = true
      while (inFlight.size > 0) {
        await Promise.all(inFlight)
      }
    },
  }
}

export interface TurnRecorderDeps extends Omit<OwnerIoDeps, 'owner'> {
  /** The instance's id: every owner it records for is of it. */
  readonly instance: string
  /** The window's tool io, which a turn's own io records over. */
  readonly io: ToolIo
  /** A turn's memory writes through its own io. */
  readonly memory: (io: OwnerIo) => MemoryWrites
}

/**
 * The window's turns' own writes (spec 5.1): one owner io for each turn
 * (child turns included) from its start until its end, which drains it.
 */
export class TurnRecorder {
  private readonly running = new Map<string, OwnerIo>()

  public constructor(private readonly deps: TurnRecorderDeps) {}

  /** The turn's own writes, recorded under it until `end`. */
  public start(sessionId: string, turnId: string): TurnWrites {
    const { instance, io: windowIo, memory, ...recording } = this.deps
    const io = createOwnerIo(windowIo, {
      ...recording,
      owner: { instance, sessionId, unitKind: 'turn', unitId: turnId },
    })
    this.running.set(turnKey(sessionId, turnId), io)
    return { io, memory: memory(io) }
  }

  /** No new write of the turn is admitted; resolves once those under way have settled. */
  public async end(sessionId: string, turnId: string): Promise<void> {
    const key = turnKey(sessionId, turnId)
    const io = this.running.get(key)
    this.running.delete(key)
    await io?.drain()
  }
}

export interface TurnRecordingDeps extends Omit<TurnRecorderDeps, 'journal' | 'lanes'> {
  /** The namespace's checkpoint storage: the instance's journal goes below it. */
  readonly storageDir: string
}

/**
 * The window's recording (spec 5.1): its journal, the order and locks every
 * owner of the instance shares, and the recorder of its turns. Built by the
 * checkpoint bundle, which loads with the store (PLAN.md D6).
 */
export function createTurnRecording(deps: TurnRecordingDeps): {
  readonly journal: WriteJournal
  readonly lanes: WriteLanes
  readonly recorder: TurnRecorder
} {
  const { storageDir, ...recording } = deps
  const journal = new WriteJournal({ storageDir, instance: deps.instance, platform: deps.platform })
  const lanes = new WriteLanes(deps.platform)
  return { journal, lanes, recorder: new TurnRecorder({ ...recording, journal, lanes }) }
}

// The worktree records as numbered generations (M123, PLAN.md M123's lock
// protocol): `<generation>.json` files in one folder, each immutable once
// it exists, the highest one the current state. A write is the exclusive
// creation of the next number (the content staged and flushed, then
// published by a hard link, which fails while the name is taken), so the
// generation is the fencing token: a writer whose number someone else
// already took — a delayed owner after a takeover — lands nothing, and
// reads and applies again. Hard links fail closed where a file system has
// none, as the held checkout's own writer does.
//
// Every generation names its parent's write id, so a publish into a
// number the sweep had freed (a writer delayed past the kept generations)
// is recognized as never in effect.
//
// Every generation also carries the fence of the lease (core/locks/
// fileLease.ts) its writer held. A publish is a compare-and-swap on it: it
// goes ahead only while the head's fence is below the writer's own and the
// writer's lease is still current (checked synchronously just before the
// link), so a writer whose lease another took over never publishes.

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import { wireWordForLog, type CoreLogger } from '../../../core/logging'
import { isStoreErrorCode } from '../../../host/backend/storeErrors'
import { parseWorktreeRegistry, type WorktreeRecord } from '../../../core/worktreeConversations'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  WORKTREE_RECORD_GENERATIONS_KEPT,
  WORKTREE_RECORD_SAVE_ATTEMPTS,
  WORKTREE_RECORD_SWEEP_AGE_MS,
} from '../../../shared/constants'
import { errorCode, RETIRED_LOCK_SUFFIX, type RecordStoreFs } from './recordStoreFs'

const GENERATION_NAME = /^(\d+)\.json$/u
const GENERATION_DIGITS = 12
const STAGE_PREFIX = '.stage-'

const generationSchema = z.object({
  generation: z.number(),
  writeId: z.string(),
  parent: z.nullable(z.string()),
  /** The writer's lease fence. */
  fence: z.optional(z.number()),
  records: z.unknown(),
})

/** The current state: the highest generation and what it holds. */
export interface RecordHead {
  /** 0 before the first write. */
  readonly generation: number
  /** The head's write id; undefined before the first write or for an unreadable head. */
  readonly writeId: string | undefined
  /** The fence of the lease the head was written under; undefined before the first write. */
  readonly fence: number | undefined
  readonly records: readonly WorktreeRecord[]
}

function generationName(generation: number): string {
  return `${String(generation).padStart(GENERATION_DIGITS, '0')}.json`
}

function generationOf(name: string): number | undefined {
  const digits = GENERATION_NAME.exec(name)?.[1]
  const generation = Number(digits)
  return digits !== undefined && Number.isSafeInteger(generation) && generation > 0
    ? generation
    : undefined
}

async function names(fs: RecordStoreFs, folder: string): Promise<readonly string[]> {
  try {
    return await fs.readdir(folder)
  } catch (error: unknown) {
    // A missing folder holds no generations; any other listing failure is
    // not this listing's answer to give.
    if (!isStoreErrorCode(error, 'ENOENT')) throw error
    return []
  }
}

function latestOf(listed: readonly string[]): number {
  let latest = 0
  for (const name of listed) {
    latest = Math.max(latest, generationOf(name) ?? 0)
  }
  return latest
}

async function latestGeneration(fs: RecordStoreFs, folder: string): Promise<number> {
  return latestOf(await names(fs, folder))
}

interface ParsedGeneration {
  readonly writeId: string
  readonly parent: string | null
  readonly fence: number | undefined
  readonly raw: unknown
}

function parseGeneration(generation: number, bytes: Buffer): ParsedGeneration | undefined {
  try {
    const parsed = generationSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    return parsed.success && parsed.data.generation === generation
      ? {
          writeId: parsed.data.writeId,
          parent: parsed.data.parent,
          fence: parsed.data.fence,
          raw: parsed.data.records,
        }
      : undefined
  } catch (error: unknown) {
    // Only malformed text fails here; anything else is not this parse's answer.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

function headOf(generation: number, parsed: ParsedGeneration | undefined): RecordHead {
  return parsed === undefined
    ? { generation, writeId: undefined, fence: undefined, records: [] }
    : {
        generation,
        writeId: parsed.writeId,
        fence: parsed.fence,
        records: parseWorktreeRegistry(parsed.raw),
      }
}

/**
The head, synchronously, for a gate with no await before it acts.
Undefined when it cannot be read whole (the caller refuses).
*/
export function readRecordHeadSync(fs: RecordStoreFs, folder: string): RecordHead | undefined {
  try {
    const generation = latestOf(fs.readdirSync(folder))
    if (generation === 0) {
      return headOf(generation, undefined)
    }
    const parsed = parseGeneration(
      generation,
      fs.readFileSync(path.join(folder, generationName(generation))),
    )
    return parsed === undefined ? undefined : headOf(generation, parsed)
  } catch {
    return undefined
  }
}

/**
The head, read without a lock: reads never write. An unreadable head
reads as no records (the hold is by location anyway), and is warned.
*/
export async function readRecordHead(
  fs: RecordStoreFs,
  folder: string,
  log: CoreLogger,
): Promise<RecordHead> {
  for (let attempt = 1; ; attempt += 1) {
    const generation = await latestGeneration(fs, folder)
    if (generation === 0) {
      return headOf(generation, undefined)
    }
    let bytes: Buffer
    try {
      bytes = await fs.readFile(path.join(folder, generationName(generation)))
    } catch (error: unknown) {
      // Swept between the listing and the read: newer ones exist.
      if (errorCode(error) === 'ENOENT' && attempt < WORKTREE_RECORD_SAVE_ATTEMPTS) {
        continue
      }
      throw error
    }
    const parsed = parseGeneration(generation, bytes)
    if (parsed === undefined) {
      log.warn('The worktree records could not be read; starting with none')
    }
    return headOf(generation, parsed)
  }
}

/** Whether the generation written as `writeId` is the head, or the parent of the next one. */
async function isInEffect(
  fs: RecordStoreFs,
  folder: string,
  generation: number,
  writeId: string,
): Promise<boolean> {
  const latest = await latestGeneration(fs, folder)
  if (latest === generation) {
    return true
  }
  if (latest < generation) {
    return false
  }
  try {
    const next = parseGeneration(
      generation + 1,
      await fs.readFile(path.join(folder, generationName(generation + 1))),
    )
    return next?.parent === writeId
  } catch (error: unknown) {
    // Swept between the listing and the read: the proof is gone. Any other
    // read failure is not this proof's answer to give (the write lands
    // unverified through its own catch either way).
    if (!isStoreErrorCode(error, 'ENOENT')) throw error
    return false
  }
}

/**
What a write came to: `written` when it took the next number and is in
effect; `lost` when it published nothing (another writer took the
number, `canPublish` said the lock is no longer this writer's, or its
stage was swept): read again and apply again; `unverified` when it took
the number but its place in history can no longer be proven (its
successor was swept meanwhile, it took a number the sweep had freed, or
the proof could not be read): the caller reconciles against the head
before applying again.
*/
export type GenerationWrite = 'written' | 'lost' | 'unverified'

/**
Writes `records` as the generation after `head`, under the lease whose
fence is `fence`: refused (`lost`) while the head was written under an
equal or later fence, or when `isLeaseCurrent` (a synchronous check, made
just before the link) says the lease is no longer current.
*/
export async function writeNextGeneration(
  fs: RecordStoreFs,
  folder: string,
  head: RecordHead,
  records: readonly WorktreeRecord[],
  fence: number,
  isLeaseCurrent: () => boolean,
): Promise<GenerationWrite> {
  if (head.fence !== undefined && head.fence >= fence) {
    return 'lost'
  }
  const generation = head.generation + 1
  const writeId = randomUUID()
  const stage = path.join(folder, `${STAGE_PREFIX}${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`)
  await fs.createExclusive(
    stage,
    JSON.stringify({ generation, writeId, parent: head.writeId ?? null, fence, records }),
    'flushed',
  )
  try {
    if (!isLeaseCurrent()) {
      return 'lost'
    }
    try {
      await fs.link(stage, path.join(folder, generationName(generation)))
    } catch (error: unknown) {
      // EEXIST: the number is taken. ENOENT: the stage was swept under a
      // delayed writer. Either way nothing was published.
      if (isStoreErrorCode(error, 'EEXIST')) return 'lost'
      if (isStoreErrorCode(error, 'ENOENT')) return 'lost'
      throw error
    }
  } finally {
    try {
      await fs.unlink(stage)
    } catch {
      // Swept later.
    }
  }
  // Landed: from here on nothing reports it failed. A proof that cannot
  // be read leaves it unverified, for the caller to reconcile.
  try {
    return (await isInEffect(fs, folder, generation, writeId)) ? 'written' : 'unverified'
  } catch {
    return 'unverified'
  }
}

/**
Removes generations older than the kept ones and a crash's leftovers
(stages, retired locks) older than the sweep age. Best effort, after a
write has landed: it never throws (a failure is retried by the next
write), so a landed write is never reported as failed.
*/
export async function sweepGenerations(
  fs: RecordStoreFs,
  folder: string,
  head: number,
  now: number,
  log: CoreLogger,
): Promise<void> {
  let listed: readonly string[]
  try {
    listed = await names(fs, folder)
  } catch (error: unknown) {
    log.warn(
      `The worktree records sweep listing failed (${wireWordForLog(errorCode(error) ?? 'unknown')}); the next write tries again`,
    )
    return
  }
  for (const name of listed) {
    const file = path.join(folder, name)
    try {
      const generation = generationOf(name)
      if (generation !== undefined) {
        if (generation <= head - WORKTREE_RECORD_GENERATIONS_KEPT) {
          await fs.unlink(file)
        }
        continue
      }
      const isLeftover =
        (name.startsWith(STAGE_PREFIX) && name.endsWith(ATOMIC_TEMPORARY_SUFFIX)) ||
        name.endsWith(RETIRED_LOCK_SUFFIX)
      if (!isLeftover) {
        continue
      }
      const seen = await fs.lstat(file)
      if (now - Number(seen.mtimeMs) > WORKTREE_RECORD_SWEEP_AGE_MS) {
        await fs.unlink(file)
      }
    } catch {
      // Gone already, or held: the next sweep tries again.
    }
  }
}

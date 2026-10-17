import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { ESTIMATE_LABEL_MAX_CHARS, ESTIMATE_MAX_ITEMS } from '../../../shared/constants'
import {
  historyRecordSchema,
  type EstimateHistoryPort,
  type HistoryRecord,
} from '../../../shared/estimate'
import {
  calibrationFailure,
  canonicalHistory,
  canonicalRecord,
  compareIds,
  recordKey,
} from './records'

/** Existing contract bounds give a per-record decode bound; no history is silently pruned. */
const RECORD_MAX_BYTES = ESTIMATE_MAX_ITEMS * ESTIMATE_LABEL_MAX_CHARS
const PRIVATE_FILE_MODE = constants.S_IRUSR | constants.S_IWUSR
const PRIVATE_DIR_MODE = PRIVATE_FILE_MODE | constants.S_IXUSR
const basisTagSchema = z.object({ durationBasis: z.string() })
const envelopeSchema = z.strictObject({
  version: z.number().int(),
  durationBasis: z.string(),
  record: z.unknown(),
})

function fileOf(record: HistoryRecord): string {
  return `${createHash('sha256').update(recordKey(record)).digest('hex')}.json`
}

function identityFileOf(record: HistoryRecord): string {
  return `${createHash('sha256').update(record.laneId).digest('hex')}.identity`
}

function hasSameIdentity(left: HistoryRecord, right: HistoryRecord): boolean {
  return left.kind === right.kind && left.machineClassId === right.machineClassId
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code
}

/** Durable immutable files, one per lane/basis. Readers never observe a partial publication.
 * A no-clobber hard link makes independent windows/processes safe without a clock or stale lock.
 * The caller supplies private application storage, never a workspace or a credential directory.
 */
export class EstimateHistoryJournal implements EstimateHistoryPort {
  private skipped: { recordId: string; code: string }[] = []

  constructor(private readonly directory: string) {}

  private async read(file: string): Promise<HistoryRecord> {
    const fileStat = await lstat(file)
    if (fileStat.isSymbolicLink()) throw calibrationFailure('invalidHistoryFile')
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > RECORD_MAX_BYTES)
        throw calibrationFailure('invalidHistoryFile')
      // Bounded even if a damaged file grows between stat and read.
      const bytes = Buffer.alloc(RECORD_MAX_BYTES + 1)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead > RECORD_MAX_BYTES) throw calibrationFailure('historyRecordTooLarge')
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)),
      )
      const envelope = envelopeSchema.safeParse(value)
      if (envelope.success && envelope.data.version !== 1)
        throw calibrationFailure('unknownHistoryVersion')
      const metadata = envelope.success ? envelope.data.record : value
      const basis = basisTagSchema.safeParse(metadata)
      if (
        (basis.success &&
          !historyRecordSchema.shape.durationBasis.safeParse(basis.data.durationBasis).success) ||
        (envelope.success &&
          !historyRecordSchema.shape.durationBasis.safeParse(envelope.data.durationBasis).success)
      )
        throw calibrationFailure('unknownHistoryBasis')
      const record = canonicalRecord(metadata)
      if (envelope.success && envelope.data.durationBasis !== record.durationBasis)
        throw calibrationFailure('mixedHistoryBasis')
      if (
        path.basename(file) !==
        (file.endsWith('.identity') ? identityFileOf(record) : fileOf(record))
      )
        throw calibrationFailure('historyIdentityMismatch')
      return record
    } finally {
      await handle.close()
    }
  }

  /** Per-list diagnostics, with opaque IDs and fixed codes only; retained bytes are never echoed. */
  get skippedRecords(): readonly { recordId: string; code: string }[] {
    return this.skipped
  }

  async list(): Promise<readonly HistoryRecord[]> {
    const skipped: { recordId: string; code: string }[] = []
    let files: string[]
    try {
      files = await readdir(this.directory)
    } catch (error) {
      if (hasCode(error, 'ENOENT')) {
        this.skipped = skipped
        return []
      }
      throw calibrationFailure('historyReadFailed')
    }
    try {
      const records: HistoryRecord[] = []
      const identities = new Map<string, HistoryRecord>()
      for (const file of files.toSorted(compareIds)) {
        // Interrupted private staging files are unpublished. Every published JSON is validated.
        if (!file.endsWith('.json')) continue
        try {
          const record = await this.read(path.join(this.directory, file))
          const previous = identities.get(record.laneId)
          if (previous && !hasSameIdentity(previous, record))
            throw calibrationFailure('conflictingLaneIdentity')
          identities.set(record.laneId, record)
          records.push(record)
        } catch (error) {
          const code = [
            'unknownHistoryVersion',
            'unknownHistoryBasis',
            'mixedHistoryBasis',
            'conflictingLaneIdentity',
          ].find((candidate) => hasCode(error, candidate))
          if (!code) throw error
          skipped.push({ recordId: createHash('sha256').update(file).digest('hex'), code })
        }
      }
      this.skipped = skipped
      return canonicalHistory(records)
    } catch {
      throw calibrationFailure('historyReadFailed')
    }
  }

  async append(value: HistoryRecord): Promise<void> {
    const record = canonicalRecord(value)
    const bytes = Buffer.from(
      JSON.stringify({ version: 1, durationBasis: record.durationBasis, record }) + '\n',
      'utf8',
    )
    if (bytes.length > RECORD_MAX_BYTES) throw calibrationFailure('historyRecordTooLarge')
    const target = path.join(this.directory, fileOf(record))
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`)
    let hasStagingFile = false
    let failure: Error | undefined
    try {
      // Before the first claim, existing legacy observations must agree too.
      for (const durationBasis of [
        'agentTime',
        'gitElapsed',
      ] satisfies HistoryRecord['durationBasis'][]) {
        try {
          const previous = await this.read(
            path.join(this.directory, fileOf({ ...record, durationBasis })),
          )
          if (!hasSameIdentity(previous, record)) throw calibrationFailure('conflictingHistory')
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error
        }
      }
      await mkdir(this.directory, { recursive: true, mode: PRIVATE_DIR_MODE })
      const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE)
      hasStagingFile = true
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      // The same staged complete file claims the lane's immutable identity across both bases.
      const identity = path.join(this.directory, identityFileOf(record))
      try {
        await link(temporary, identity)
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
        if (!hasSameIdentity(await this.read(identity), record))
          throw calibrationFailure('conflictingHistory')
      }
      try {
        await link(temporary, target)
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error
        if (JSON.stringify(await this.read(target)) !== JSON.stringify(record))
          throw calibrationFailure('conflictingHistory')
      }
      // POSIX flushes the name too; Windows doesn't support opening directories this way.
      if (process.platform !== 'win32') {
        const folder = await open(this.directory, constants.O_RDONLY)
        try {
          await folder.sync()
        } finally {
          await folder.close()
        }
      }
    } catch (error) {
      failure = calibrationFailure(
        hasCode(error, 'conflictingHistory') ? 'conflictingHistory' : 'historyWriteFailed',
      )
    } finally {
      if (hasStagingFile) {
        try {
          await rm(temporary, { force: true })
        } catch {
          failure ??= calibrationFailure('historyCleanupFailed')
        }
      }
    }
    if (failure) throw failure
  }
}

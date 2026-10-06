import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { ESTIMATE_LABEL_MAX_CHARS, ESTIMATE_MAX_ITEMS } from '../../../shared/constants'
import { type EstimateHistoryPort, type HistoryRecord } from '../../../shared/estimate'
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

function fileOf(record: HistoryRecord): string {
  return `${createHash('sha256').update(recordKey(record)).digest('hex')}.json`
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code
}

/** Durable immutable files, one per lane/basis. Readers never observe a partial publication.
 * A no-clobber hard link makes independent windows/processes safe without a clock or stale lock.
 * The caller supplies private application storage, never a workspace or a credential directory.
 */
export class EstimateHistoryJournal implements EstimateHistoryPort {
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
      const record = canonicalRecord(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))),
      )
      if (path.basename(file) !== fileOf(record))
        throw calibrationFailure('historyIdentityMismatch')
      return record
    } finally {
      await handle.close()
    }
  }

  async list(): Promise<readonly HistoryRecord[]> {
    let files: string[]
    try {
      files = await readdir(this.directory)
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return []
      throw calibrationFailure('historyReadFailed')
    }
    try {
      const records: HistoryRecord[] = []
      for (const file of files.toSorted(compareIds)) {
        // Interrupted private staging files are unpublished. Every published JSON is validated.
        if (!file.endsWith('.json')) continue
        records.push(await this.read(path.join(this.directory, file)))
      }
      return canonicalHistory(records)
    } catch {
      throw calibrationFailure('historyReadFailed')
    }
  }

  async append(value: HistoryRecord): Promise<void> {
    const record = canonicalRecord(value)
    const bytes = Buffer.from(JSON.stringify(record) + '\n', 'utf8')
    if (bytes.length > RECORD_MAX_BYTES) throw calibrationFailure('historyRecordTooLarge')
    const target = path.join(this.directory, fileOf(record))
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`)
    let hasStagingFile = false
    let failure: Error | undefined
    try {
      await mkdir(this.directory, { recursive: true, mode: PRIVATE_DIR_MODE })
      const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE)
      hasStagingFile = true
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
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

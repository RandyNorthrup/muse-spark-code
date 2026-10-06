// Account-scoped durable upload ownership. The storage port must lock across
// windows/processes; provider deletion follows the last durable session release.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  HTTP_STATUS,
  MEDIA_SHA256_PATTERN,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { uploadedMediaRefSchema, type UploadedMediaRef } from '../../shared/media'
import { isModelApiError } from '../backends/modelapi/client'
import type { UploadSource } from '../backends/modelapi/files'

const accountFileSchema = z.strictObject({
  fileId: z.string(),
  name: z.string(),
  bytes: z.int().check(z.gte(0)),
  expiresAt: z.optional(z.int().check(z.gt(0))),
})
export const uploadedFilesReportSchema = z.strictObject({
  provider: z.string(),
  isReadOnly: z.boolean(),
  poolBytes: z.int().check(z.gt(0)),
  usedBytes: z.int().check(z.gte(0)),
  files: z.array(
    z.strictObject({
      ...accountFileSchema.shape,
      ours: z.boolean(),
      sessions: z.array(z.string()),
    }),
  ),
})
export type UploadedFilesReport = z.infer<typeof uploadedFilesReportSchema>
const ledgerSchema = z.strictObject({
  version: z.literal(1),
  accountId: z.string().check(z.regex(MEDIA_SHA256_PATTERN)),
  entries: z.array(z.strictObject({ file: uploadedMediaRefSchema, sessions: z.array(z.string()) })),
  cachedFiles: z.array(accountFileSchema),
})
export type UploadLedgerState = z.infer<typeof ledgerSchema>

/** Atomic writes under a cross-process lock; a read boundary is always validated. */
export interface UploadLedgerStorage {
  read(): Promise<unknown>
  write(state: UploadLedgerState): Promise<void>
  withLock<T>(operation: () => Promise<T>): Promise<T>
}
/** Captured provider adapters normalize metadata; this ledger has no vendor wire. */
interface FilesForLedger {
  forAccount(accountId: string): FilesForLedger
  upload(
    source: UploadSource,
    signal: AbortSignal,
    onProgress?: (uploaded: number, total: number) => void,
    expectedSha256?: string,
  ): Promise<UploadedMediaRef>
  retrieve(fileId: string, signal?: AbortSignal): Promise<unknown>
  accountFiles(): Promise<readonly z.infer<typeof accountFileSchema>[]>
  delete(fileId: string): Promise<void>
}
export interface UploadLedgerDeps {
  readonly storage: UploadLedgerStorage
  readonly files: FilesForLedger
  readonly accountId: string
  readonly provider: string
  readonly poolBytes: number
  readonly currentAccountId: () => Promise<string | undefined>
  readonly now: () => number
}

/** Bind to FileSessionStoreDeps.uploads; M2 also uses it for fork/rewind snapshots. */
export interface SessionUploadLifecycle {
  syncSession(sessionId: string, refs: readonly UploadedMediaRef[]): Promise<void>
  releaseSession(sessionId: string): Promise<void>
}

export class UploadLedger implements SessionUploadLifecycle {
  private readonly files: FilesForLedger
  public constructor(private readonly deps: UploadLedgerDeps) {
    this.files = deps.files.forAccount(deps.accountId)
  }

  private async read(): Promise<UploadLedgerState> {
    const raw = await this.deps.storage.read()
    const state =
      raw === undefined
        ? { version: 1, accountId: this.deps.accountId, entries: [], cachedFiles: [] }
        : ledgerSchema.parse(raw)
    if (state.accountId !== this.deps.accountId) throw new Error('Upload ledger account mismatch')
    if (state.entries.some(({ file }) => file.provider !== this.deps.provider))
      throw new Error('Upload ledger provider mismatch')
    return ledgerSchema.parse(state)
  }

  private async isCurrentAccount(): Promise<boolean> {
    return (await this.deps.currentAccountId()) === this.deps.accountId
  }

  private async requireAccount(): Promise<void> {
    if (!(await this.isCurrentAccount())) throw new Error(UI_TEXT.media.filesReadOnly)
  }

  /** Delete only durable zero-reference entries. Failed deletions remain retryable. */
  private async cleanup(state: UploadLedgerState): Promise<void> {
    if (!(await this.isCurrentAccount())) return
    for (const entry of state.entries) {
      if (entry.sessions.length > 0) continue
      await this.requireAccount()
      try {
        await this.files.delete(entry.file.fileId)
      } catch (error: unknown) {
        if (!isModelApiError(error) || error.status !== HTTP_STATUS.notFound) throw error
      }
      state.entries = state.entries.filter((value) => value !== entry)
      state.cachedFiles = state.cachedFiles.filter((file) => file.fileId !== entry.file.fileId)
      await this.deps.storage.write(state)
    }
  }

  /** Same digest shares one upload. A missing/expired ID is replaced once, after hash verification. */
  public async ensure(
    sessionId: string,
    sha256: string,
    source: UploadSource,
    signal: AbortSignal,
    onProgress?: (uploaded: number, total: number) => void,
  ): Promise<UploadedMediaRef> {
    return await this.deps.storage.withLock(async () => {
      const state = await this.read()
      await this.requireAccount()
      if (!MEDIA_SHA256_PATTERN.test(sha256)) throw new Error('Invalid source digest')
      const existing = state.entries.find(({ file }) => file.sha256 === sha256)
      let isMissing =
        existing === undefined ||
        existing.file.expiresAt <= this.deps.now() / MILLISECONDS_PER_SECOND
      if (existing !== undefined && !isMissing) {
        try {
          await this.files.retrieve(existing.file.fileId, signal)
        } catch (error: unknown) {
          if (!isModelApiError(error) || error.status !== HTTP_STATUS.notFound) throw error
          isMissing = true
        }
      }
      if (!isMissing && existing !== undefined) {
        if (!existing.sessions.includes(sessionId)) existing.sessions.push(sessionId)
        await this.deps.storage.write(state)
        return existing.file
      }
      if (existing !== undefined) {
        const hash = createHash('sha256')
        let bytes = 0
        try {
          for await (const chunk of source.open(signal)) {
            signal.throwIfAborted()
            bytes += chunk.byteLength
            if (bytes > source.bytes) throw new Error('Source grew')
            hash.update(chunk)
          }
        } catch (error: unknown) {
          throw new Error(fill(UI_TEXT.media.uploadExpired, { name: source.name }), {
            cause: error,
          })
        }
        if (bytes !== source.bytes || hash.digest('hex') !== sha256)
          throw new Error(fill(UI_TEXT.media.sourceChanged, { name: source.name }))
      }
      await this.requireAccount()
      const file = await this.files.upload(source, signal, onProgress, sha256)
      const sessions = [...(existing?.sessions ?? [])]
      if (!sessions.includes(sessionId)) sessions.push(sessionId)
      state.entries = state.entries.filter((entry) => entry !== existing)
      state.entries.push({ file, sessions })
      try {
        await this.deps.storage.write(state)
      } catch (error: unknown) {
        // A crash before this write is bounded by expiry; a caught write failure cleans up.
        await this.files.delete(file.fileId)
        throw error
      }
      return file
    })
  }

  public async syncSession(sessionId: string, refs: readonly UploadedMediaRef[]): Promise<void> {
    await this.deps.storage.withLock(async () => {
      const state = await this.read()
      const wanted = refs.map((ref) => uploadedMediaRefSchema.parse(ref))
      // Never claim ownership of an arbitrary imported or foreign provider ID.
      for (const ref of wanted) {
        if (
          state.entries.every(
            ({ file }) => !(file.sha256 === ref.sha256 && file.provider === ref.provider),
          )
        )
          throw new Error(fill(UI_TEXT.media.uploadExpired, { name: ref.name }))
      }
      for (const entry of state.entries) {
        entry.sessions = entry.sessions.filter((id) => id !== sessionId)
        if (wanted.some((ref) => ref.sha256 === entry.file.sha256)) entry.sessions.push(sessionId)
      }
      await this.deps.storage.write(state)
      await this.cleanup(state)
    })
  }

  public async releaseSession(sessionId: string): Promise<void> {
    await this.syncSession(sessionId, [])
  }

  public async accountReport(): Promise<UploadedFilesReport> {
    return await this.deps.storage.withLock(async () => {
      const state = await this.read()
      const isReadOnly = !(await this.isCurrentAccount())
      if (!isReadOnly) {
        await this.cleanup(state)
        const listed = await this.files.accountFiles()
        state.cachedFiles = listed.map((file) => accountFileSchema.parse(file))
        await this.deps.storage.write(state)
      }
      const files = [...state.cachedFiles]
      if (isReadOnly) {
        for (const { file } of state.entries) {
          if (files.every((item) => item.fileId !== file.fileId))
            files.push({
              fileId: file.fileId,
              name: file.name,
              bytes: file.bytes,
              expiresAt: file.expiresAt,
            })
        }
      }
      return uploadedFilesReportSchema.parse({
        provider: this.deps.provider,
        isReadOnly,
        poolBytes: this.deps.poolBytes,
        usedBytes: files.reduce((total, file) => total + file.bytes, 0),
        files: files.map((file) => {
          const ours = state.entries.find((entry) => entry.file.fileId === file.fileId)
          return { ...file, ours: ours !== undefined, sessions: ours?.sessions ?? [] }
        }),
      })
    })
  }

  /** Account cleanup never deletes a file still shared by a session. */
  public async deleteFile(
    fileId: string,
    isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
  ): Promise<void> {
    await this.deps.storage.withLock(async () => {
      const state = await this.read()
      await this.requireAccount()
      const ours = state.entries.find((entry) => entry.file.fileId === fileId)
      if (ours !== undefined && ours.sessions.length > 0) throw new Error(UI_TEXT.media.filesInUse)
      const file = state.cachedFiles.find((entry) => entry.fileId === fileId)
      if (
        ours === undefined &&
        (file === undefined || !(await isForeignDeletionConfirmed(file.name)))
      )
        return
      await this.requireAccount()
      await this.files.delete(fileId)
      state.entries = state.entries.filter((entry) => entry.file.fileId !== fileId)
      state.cachedFiles = state.cachedFiles.filter((entry) => entry.fileId !== fileId)
      await this.deps.storage.write(state)
    })
  }

  public async deleteAllOurs(): Promise<void> {
    await this.deps.storage.withLock(async () => {
      const state = await this.read()
      await this.requireAccount()
      await this.cleanup(state)
    })
  }
}

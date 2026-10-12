// Account-scoped durable upload ownership. The storage port must lock across
// windows/processes; provider deletion follows the last durable session release.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  HTTP_STATUS,
  MEDIA_CANCEL_INTENT_WRITE_ATTEMPTS,
  MEDIA_CANCEL_INTENT_WRITE_DELAY_MS,
  MEDIA_SHA256_PATTERN,
  MEDIA_UPLOAD_DELETE_FAILURE,
  MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS,
  MEDIA_UPLOAD_DELETE_RETRY_BASE_DELAY_MS,
  MEDIA_UPLOAD_DELETE_RETRY_MAX_DELAY_MS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  uploadedAccountFileSchema as accountFileSchema,
  uploadedFilesReportSchema,
  uploadedMediaRefSchema,
  type UploadedFilesReport,
  type UploadedMediaRef,
} from '../../shared/media'
import { isModelApiError } from '../backends/modelapi/client'
import {
  UploadCleanupPendingError,
  type UploadSource,
  type FilesApi,
} from '../backends/modelapi/files'

const orphanSchema = z.string().check(z.regex(/^file-[A-Za-z0-9_-]+$/u))
const fileDeleteFailureSchema = z.strictObject({
  fileId: orphanSchema,
  attempts: z.number(),
  nextAttemptAt: z.number(),
  notified: z.optional(z.boolean()),
  reason: z.literal(MEDIA_UPLOAD_DELETE_FAILURE),
})
const ledgerSchema = z.strictObject({
  version: z.literal(1),
  accountId: z.string().check(z.regex(MEDIA_SHA256_PATTERN)),
  entries: z.array(z.strictObject({ file: uploadedMediaRefSchema, sessions: z.array(z.string()) })),
  cachedFiles: z.array(accountFileSchema),
  // RVM105 1: provider receipts the failed upload could not delete. Stored
  // states written before this lane predate the field and read as no intent.
  orphans: z.optional(z.array(orphanSchema)),
  // RVAPP-PORTM105R4 P2-B: provider deletions that failed, with their attempt
  // count, next attempt time and fixed reason code. States written before
  // this lane predate the field and read as no recorded failure.
  deleteFailures: z.optional(z.array(fileDeleteFailureSchema)),
})
export type UploadLedgerState = z.infer<typeof ledgerSchema>

/**
 * An explicit provider deletion failed without deleting. Carries the file's
 * display name (never its id); the notice text uses the fixed
 * `uploadDeleteProviderRefused` reason, never the provider's message.
 */
export class UploadDeleteFailedError extends Error {
  public readonly fileName: string
  public constructor(fileName: string) {
    super('Upload deletion failed')
    this.name = 'UploadDeleteFailedError'
    this.fileName = fileName
  }
}

/** Atomic writes under a cross-process lock; a read boundary is always validated. */
export interface UploadLedgerStorage {
  read(): Promise<unknown>
  write(state: UploadLedgerState): Promise<void>
  withLock<T>(operation: () => Promise<T>): Promise<T>
}
/** Captured provider adapters normalize metadata; this ledger has no vendor wire. */
interface FilesForLedger {
  forAccount(accountId: string): FilesForLedger
  /** Shares the awaited receipt-ownership callback with the provider adapter. */
  upload: FilesApi['upload']
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
  /** Epoch milliseconds; times the recorded deletion-failure backoff. */
  readonly now: () => number
  /** Pause between cancel-intent write retries; honours the signal. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** The default pause between cancel-intent write retries, honouring cancel. */
function defaultLedgerSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      try {
        signal?.throwIfAborted()
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('Aborted'))
        return
      }
      reject(new Error('Aborted'))
    }
    if (signal?.aborted === true) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Bind to FileSessionStoreDeps.uploads; M2 also uses it for fork/rewind snapshots. */
export interface SessionUploadOwnership {
  syncSession(
    sessionId: string,
    refs: readonly UploadedMediaRef[],
    isCurrent?: () => boolean,
  ): Promise<void>
  releaseSession(sessionId: string): Promise<void>
}
export interface SessionUploadLifecycle extends SessionUploadOwnership {
  /** Holds the storage lock across session publication and ownership changes. */
  withLock<T>(operation: (ownership: SessionUploadOwnership) => Promise<T>): Promise<T>
}

export class UploadLedger implements SessionUploadLifecycle {
  private readonly files: FilesForLedger
  public constructor(private readonly deps: UploadLedgerDeps) {
    this.files = deps.files.forAccount(deps.accountId)
  }

  private async read(): Promise<UploadLedgerState> {
    const raw = await this.deps.storage.read()
    const parsed =
      raw === undefined
        ? {
            version: 1,
            accountId: this.deps.accountId,
            entries: [],
            cachedFiles: [],
            orphans: [],
          }
        : ledgerSchema.parse(raw)
    if (parsed.accountId !== this.deps.accountId) throw new Error('Upload ledger account mismatch')
    if (parsed.entries.some(({ file }) => file.provider !== this.deps.provider))
      throw new Error('Upload ledger provider mismatch')
    const state = ledgerSchema.parse(parsed)
    // States stored before the intent fields read as no intent and no
    // recorded failure, and every write below persists the normalized shape.
    return { ...state, orphans: state.orphans ?? [], deleteFailures: state.deleteFailures ?? [] }
  }

  private async isCurrentAccount(): Promise<boolean> {
    return (await this.deps.currentAccountId()) === this.deps.accountId
  }

  private async requireAccount(): Promise<void> {
    if (!(await this.isCurrentAccount())) throw new Error(UI_TEXT.media.filesReadOnly)
  }

  /** Record a failed provider deletion: attempt count, next attempt time with backoff, fixed reason. */
  private recordDeleteFailure(state: UploadLedgerState, fileId: string): void {
    const failures = (state.deleteFailures ??= [])
    const previous = failures.find((failure) => failure.fileId === fileId)
    const attempts = (previous?.attempts ?? 0) + 1
    const delay = Math.min(
      MEDIA_UPLOAD_DELETE_RETRY_BASE_DELAY_MS * 2 ** (attempts - 1),
      MEDIA_UPLOAD_DELETE_RETRY_MAX_DELAY_MS,
    )
    if (previous === undefined) {
      failures.push({
        fileId,
        attempts,
        nextAttemptAt: this.deps.now() + delay,
        notified: false,
        reason: MEDIA_UPLOAD_DELETE_FAILURE,
      })
    } else {
      previous.attempts = attempts
      previous.nextAttemptAt = this.deps.now() + delay
    }
  }

  /** Forget a provider-confirmed deletion, including its failure record. */
  private forgetDeleted(state: UploadLedgerState, fileId: string): void {
    state.orphans = (state.orphans ?? []).filter((id) => id !== fileId)
    state.deleteFailures = (state.deleteFailures ?? []).filter(
      (failure) => failure.fileId !== fileId,
    )
  }

  /**
   * Delete only durable zero-reference entries, then recorded clean-up
   * intents (RVM105 1). A failed deletion is recorded on the entry and never
   * rejects: the entry stays until the provider confirms, the sweep retries
   * it after its backoff, and saving a session never fails because of
   * another entry's delete (RVAPP-PORTM105R4 P2-B). A missing file deletes as
   * found. Entries not yet due are skipped without waiting.
   */
  private async cleanup(
    state: UploadLedgerState,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!(await this.isCurrentAccount())) return
    const now = this.deps.now()
    const orphans = state.orphans ?? []
    for (const fileId of orphans) {
      await this.requireAccount()
      if (!isCurrent()) return
      const failure = (state.deleteFailures ?? []).find((record) => record.fileId === fileId)
      if (failure !== undefined && now < failure.nextAttemptAt) continue
      try {
        await this.files.delete(fileId)
      } catch (error: unknown) {
        if (isModelApiError(error) && error.status === HTTP_STATUS.notFound) {
          this.forgetDeleted(state, fileId)
          await this.deps.storage.write(state)
          continue
        }
        this.recordDeleteFailure(state, fileId)
        await this.deps.storage.write(state)
        continue
      }
      this.forgetDeleted(state, fileId)
      await this.deps.storage.write(state)
    }
    for (const entry of state.entries) {
      if (entry.sessions.length > 0) continue
      await this.requireAccount()
      if (!isCurrent()) return
      const fileId = entry.file.fileId
      const failure = (state.deleteFailures ?? []).find((record) => record.fileId === fileId)
      if (failure !== undefined && now < failure.nextAttemptAt) continue
      try {
        await this.files.delete(fileId)
      } catch (error: unknown) {
        if (isModelApiError(error) && error.status === HTTP_STATUS.notFound) {
          state.entries = state.entries.filter((value) => value !== entry)
          state.cachedFiles = state.cachedFiles.filter((file) => file.fileId !== fileId)
          this.forgetDeleted(state, fileId)
          await this.deps.storage.write(state)
          continue
        }
        // The entry stays until the provider confirms; a later sweep retries.
        this.recordDeleteFailure(state, fileId)
        await this.deps.storage.write(state)
        continue
      }
      state.entries = state.entries.filter((value) => value !== entry)
      state.cachedFiles = state.cachedFiles.filter((file) => file.fileId !== fileId)
      this.forgetDeleted(state, fileId)
      await this.deps.storage.write(state)
    }
  }

  /**
   * Land the cancellation intent while the lock is held (RVM105B P2-2): a
   * transient write failure is retried with backoff so "owned, cancel
   * requested, intent unwritten" never reaches durable state. Every attempt
   * runs even under an aborted caller; only the pauses between attempts
   * honour cancellation, skipping the wait but not the bounded remaining
   * attempts. Only a persistently failing store gives up, and the caller
   * then deletes best-effort instead.
   */
  private async writeCancelIntent(state: UploadLedgerState, signal: AbortSignal): Promise<void> {
    const sleep = this.deps.sleep ?? defaultLedgerSleep
    let failure: unknown
    for (let attempt = 0; attempt < MEDIA_CANCEL_INTENT_WRITE_ATTEMPTS; attempt += 1) {
      try {
        await this.deps.storage.write(state)
        return
      } catch (error: unknown) {
        failure = error
      }
      if (attempt + 1 < MEDIA_CANCEL_INTENT_WRITE_ATTEMPTS) {
        try {
          await sleep(MEDIA_CANCEL_INTENT_WRITE_DELAY_MS * 2 ** attempt, signal)
        } catch {
          // Cancelled while waiting: skip the pause. The remaining attempts
          // are bounded, local and fast, and the intent must still land.
        }
      }
    }
    throw failure
  }

  /**
   * Same digest shares one upload. A missing/expired ID is re-uploaded once,
   * after hash verification, on a new pending entry: the old entry is
   * replaced only by the committed publication, and a cancelled or failed
   * re-upload restores it, removing only the pending one
   * (RVAPP-PORTM105R4 P2-A).
   */
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
      let isMissing = existing === undefined
      // Provider clocks can lag ours; successful retrieval proves availability.
      if (existing !== undefined) {
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
      let file: UploadedMediaRef
      try {
        file = await this.files.upload(source, signal, onProgress, sha256, async (fileId) => {
          state.orphans = [...(state.orphans ?? []), fileId]
          await this.deps.storage.write(state)
        })
      } catch (error: unknown) {
        if (!(error instanceof UploadCleanupPendingError)) throw error
        // The upload failed after the provider answered with an id, and the
        // bounded clean-up DELETE could not remove it: the id is recorded
        // durably under this same lock before anything reaches the caller,
        // so the next sweep deletes it instead of orphaning it (RVM105 1).
        // The caller still sees the original upload failure.
        if (!(state.orphans ?? []).includes(error.fileId))
          state.orphans = [...(state.orphans ?? []), error.fileId]
        await this.deps.storage.write(state)
        // The original failure keeps its identity (an abort stays an abort);
        // only its provider receipt stays behind as the intent.
        if (error.cause instanceof Error) throw error.cause
        throw error
      }
      const sessions = [...(existing?.sessions ?? [])]
      if (!sessions.includes(sessionId)) sessions.push(sessionId)
      state.entries = state.entries.filter((entry) => entry !== existing)
      state.entries.push({ file, sessions })
      try {
        signal.throwIfAborted()
        state.orphans = (state.orphans ?? []).filter((id) => id !== file.fileId)
        await this.deps.storage.write(state)
        signal.throwIfAborted()
      } catch (error: unknown) {
        // The provider holds bytes this call will not own: cancellation (or a
        // failed publication write) before or just after the publication
        // commit. Replace the uncommitted or just-committed ownership with a
        // retryable deletion intent BEFORE the remote DELETE, so a failed
        // DELETE can never strand the file without an intent (RVM105B P2-2).
        // A re-upload restores the entry it tried to replace, so the other
        // sessions that use it can still save (RVAPP-PORTM105R4 P2-A); only
        // the pending upload is forgotten here.
        // The caller keeps the original failure, never a cleanup write error.
        state.entries = state.entries.filter((entry) => entry.file.fileId !== file.fileId)
        if (existing !== undefined && !state.entries.includes(existing))
          state.entries.push(existing)
        if (!(state.orphans ?? []).includes(file.fileId))
          state.orphans = [...(state.orphans ?? []), file.fileId]
        try {
          await this.writeCancelIntent(state, signal)
        } catch {
          // The intent would not land: delete best-effort so nothing remote is
          // left without trying, then report the original failure.
          try {
            await this.files.delete(file.fileId)
          } catch {
            // A persistently failing store strands the ownership; a later
            // ownership release or provider expiry still resolves it.
          }
          throw error
        }
        try {
          await this.files.delete(file.fileId)
        } catch {
          throw error
        }
        state.orphans = (state.orphans ?? []).filter((id) => id !== file.fileId)
        try {
          await this.deps.storage.write(state)
        } catch {
          // The remote copy is gone; the retained intent makes the next sweep
          // forget it (a missing file deletes as found). Keep the original.
        }
        throw error
      }
      return file
    })
  }

  public async withLock<T>(
    operation: (ownership: SessionUploadOwnership) => Promise<T>,
  ): Promise<T> {
    return await this.deps.storage.withLock(async () => {
      const syncSession = async (
        sessionId: string,
        refs: readonly UploadedMediaRef[],
        isCurrent: () => boolean = () => true,
      ): Promise<void> => {
        const state = await this.read()
        if (!isCurrent()) return
        const previousSessions = new Map(
          state.entries.map((entry) => [entry.file.fileId, entry.sessions]),
        )
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
        await this.cleanup(state, isCurrent)
        if (isCurrent()) return
        // A newer save may arrive during the write or account checks. Restore
        // still-existing owners before another account operation can clean them.
        for (const entry of state.entries) {
          const sessions = previousSessions.get(entry.file.fileId)
          if (sessions !== undefined) entry.sessions = sessions
        }
        await this.deps.storage.write(state)
      }
      return await operation({
        syncSession,
        releaseSession: async (sessionId) => {
          await syncSession(sessionId, [])
        },
      })
    })
  }

  public async syncSession(
    sessionId: string,
    refs: readonly UploadedMediaRef[],
    isCurrent?: () => boolean,
  ): Promise<void> {
    await this.withLock(async (ownership) => {
      await ownership.syncSession(sessionId, refs, isCurrent)
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

  /**
   * Account cleanup never deletes a file still shared by a session. A file
   * the provider reports as missing deletes as found. Any other provider
   * failure is recorded for a later sweep and reported with the file's
   * display name and a fixed reason, never the provider's message
   * (RVAPP-PORTM105R4 P3-4).
   */
  public async deleteFile(
    fileId: string,
    isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
  ): Promise<void> {
    await this.deps.storage.withLock(async () => {
      const state = await this.read()
      await this.requireAccount()
      const ours = state.entries.find((entry) => entry.file.fileId === fileId)
      if (ours !== undefined && ours.sessions.length > 0) throw new Error(UI_TEXT.media.filesInUse)
      const file = state.cachedFiles.find((entry) => entry.fileId === fileId) ?? ours?.file
      if (
        ours === undefined &&
        (file === undefined || !(await isForeignDeletionConfirmed(file.name)))
      )
        return
      const name = file?.name ?? UI_TEXT.media.uploadedFiles
      await this.requireAccount()
      try {
        await this.files.delete(fileId)
      } catch (error: unknown) {
        if (!isModelApiError(error) || error.status !== HTTP_STATUS.notFound) {
          this.recordDeleteFailure(state, fileId)
          await this.deps.storage.write(state)
          throw new UploadDeleteFailedError(name)
        }
      }
      state.entries = state.entries.filter((entry) => entry.file.fileId !== fileId)
      state.cachedFiles = state.cachedFiles.filter((entry) => entry.fileId !== fileId)
      this.forgetDeleted(state, fileId)
      await this.deps.storage.write(state)
    })
  }

  /**
   * The once-only notice for provider deletions that keep failing
   * (RVAPP-PORTM105R4 P2-B): when at least one recorded failure reached the
   * named attempt count without being told, mark those told and report which
   * provider still holds files as a count only, never a name or an id.
   */
  public async consumeDeleteNotice(): Promise<{ provider: string; count: number } | undefined> {
    return await this.deps.storage.withLock(async () => {
      const state = await this.read()
      const pending = state.deleteFailures ?? []
      if (
        pending.every(
          (failure) =>
            failure.notified === true || failure.attempts < MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS,
        )
      )
        return
      for (const failure of pending)
        if (failure.attempts >= MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS) failure.notified = true
      await this.deps.storage.write(state)
      return { provider: this.deps.provider, count: pending.length }
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

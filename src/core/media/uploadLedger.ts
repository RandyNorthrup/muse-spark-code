// Account-scoped durable upload ownership. The storage port must lock across
// windows/processes; provider deletion follows the last durable session release.
import { createHash, randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
  HTTP_STATUS,
  MEDIA_CANCEL_INTENT_WRITE_ATTEMPTS,
  MEDIA_CANCEL_INTENT_WRITE_DELAY_MS,
  MEDIA_PENDING_DELETE_RETRY_BASE_MS,
  MEDIA_PENDING_DELETE_RETRY_MAX_MS,
  MEDIA_PENDING_DELETE_RETRY_MAX_SHIFT,
  MEDIA_SHA256_PATTERN,
  MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS,
  MILLISECONDS_PER_SECOND,
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
import { UploadCleanupPendingError, type UploadSource } from '../backends/modelapi/files'

// USE BEATS INTENT (round 4, P1-1): every ledger entry carries a use
// generation that rises on each session (re)use. A delete intent records
// the generation it saw; the delete runs only when the generation is
// unchanged under the lock at the moment of the remote call, otherwise the
// intent is dropped and the reused file stays.
const pendingDeleteIntentSchema = z.strictObject({ fileId: z.string(), useGen: z.number() })
// PINS ARE COUNTED REFERENCES WITH AN OWNER (round 4, P2-1/P2-2): each
// request that carries a file holds one reference (owner = process birth
// plus request id). The file is unpinned only when the count reaches zero.
const pinRefSchema = z.strictObject({ fileId: z.string(), owner: z.string() })
const pendingDeleteAttemptSchema = z.strictObject({
  fails: z.number(),
  nextRetry: z.number(),
  // The once-only backlog notice went out for this entry (ported
  // RVAPP-PORTM105R4 P2-B): set by consumeDeleteNotice, cleared with the row.
  notified: z.optional(z.boolean()),
})
const ledgerSchema = z.strictObject({
  version: z.literal(1),
  accountId: z.string().check(z.regex(MEDIA_SHA256_PATTERN)),
  entries: z.array(
    z.strictObject({
      file: uploadedMediaRefSchema,
      sessions: z.array(z.string()),
      useGen: z.optional(z.number()),
    }),
  ),
  cachedFiles: z.array(accountFileSchema),
  // Durable delete intents (RULE 2): recorded before the provider dispatch,
  // retried by the next account read, cleared once the rows are gone or the
  // file was used again (USE BEATS INTENT). Legacy rows were bare ids and
  // read as generation zero.
  pendingDeletes: z.optional(z.array(z.union([z.string(), pendingDeleteIntentSchema]))),
  // Durable in-use pins (RULE 1): one row per carrying request. Legacy rows
  // were bare ids and read under the legacy owner below.
  pinned: z.optional(z.array(z.union([z.string(), pinRefSchema]))),
  // ISOLATED RETRIES (round 4, P2-6): one entry whose delete keeps failing
  // carries its own attempt count and backoff, so it never breaks a listing.
  pendingAttempts: z.optional(z.record(z.string(), pendingDeleteAttemptSchema)),
})
export type UploadLedgerState = z.infer<typeof ledgerSchema>

export interface DeleteIntent {
  readonly fileId: string
  readonly useGen: number
}
export interface PinRef {
  readonly fileId: string
  readonly owner: string
}

/**
 * An explicit provider deletion failed without deleting (ported
 * RVAPP-PORTM105R4 P3-4). Carries the file's display name (never its id);
 * the dialog text uses the fixed `uploadDeleteProviderRefused` reason,
 * never the provider's message (which echoes the id).
 */
export class UploadDeleteFailedError extends Error {
  public readonly fileName: string
  public constructor(fileName: string) {
    super('Upload deletion failed')
    // Fixed cross-bundle identity: surfaces read this name instead of
    // instanceof, since each bundle carries its own copy of this class.
    this.name = 'UploadDeleteFailedError'
    this.fileName = fileName
  }
}

/** Owner of rows written before counted references existed: released by any plain unpin. */
const LEGACY_PIN_OWNER = 'legacy'
/** This process's birth: one owner root for every reference it takes. */
const PROCESS_BOOT_ID = randomUUID()
/** The default owner for direct (non-request) pin callers. */
function processOwnerId(): string {
  return `${String(process.pid)}:${PROCESS_BOOT_ID}`
}
/** A request's reference owner: the process birth plus the bracket's request id. */
export function pinOwnerForRequest(requestId: string): string {
  return `${String(process.pid)}:${PROCESS_BOOT_ID}:${requestId}`
}

function pidOfOwner(owner: string): number | undefined {
  const head = owner.split(':', 2)[0]
  if (head === undefined || head.trim() === '') return undefined
  const pid = Number(head)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

/** True only when the owning process is proven gone (ESRCH on signal 0);
 * any doubt keeps the reference: a live request's file is never deleted. */
function isOwnerGone(owner: string): boolean {
  if (owner === LEGACY_PIN_OWNER) return false
  const pid = pidOfOwner(owner)
  if (pid === undefined || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'ESRCH'
    )
  }
}

function intentsOf(state: UploadLedgerState): DeleteIntent[] {
  return (state.pendingDeletes ?? []).map((intent) =>
    typeof intent === 'string' ? { fileId: intent, useGen: 0 } : intent,
  )
}

function pinsOf(state: UploadLedgerState): PinRef[] {
  return (state.pinned ?? []).map((pin) =>
    typeof pin === 'string' ? { fileId: pin, owner: LEGACY_PIN_OWNER } : pin,
  )
}

function pinCountOf(state: UploadLedgerState, fileId: string): number {
  return pinsOf(state).filter((pin) => pin.fileId === fileId).length
}

/** The two refusals an explicit delete keeps unwrapped (sessions, pins). */
function isInUseRefusal(error: Error): boolean {
  return (
    error.message === UI_TEXT.media.filesInUse || error.message === UI_TEXT.media.filesInUseRequest
  )
}

/** Atomic writes under a cross-process lock; a read boundary is always validated. */
export interface UploadLedgerStorage {
  read(): Promise<unknown>
  write(state: UploadLedgerState): Promise<void>
  withLock<T>(operation: () => Promise<T>): Promise<T>
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
/** Captured provider adapters normalize metadata; this ledger has no vendor wire. */
interface FilesForLedger {
  forAccount(accountId: string): FilesForLedger
  upload(
    source: UploadSource,
    signal: AbortSignal,
    onProgress?: (uploaded: number, total: number) => void,
    expectedSha256?: string,
    onReceipt?: (fileId: string) => Promise<void>,
  ): Promise<UploadedMediaRef>
  retrieve(fileId: string, signal?: AbortSignal): Promise<unknown>
  accountFiles(): Promise<readonly z.infer<typeof accountFileSchema>[]>
  delete(fileId: string, signal?: AbortSignal): Promise<void>
}
export interface UploadLedgerDeps {
  readonly storage: UploadLedgerStorage
  readonly files: FilesForLedger
  readonly accountId: string
  readonly provider: string
  readonly poolBytes: number
  readonly currentAccountId: () => Promise<string | undefined>
  readonly now: () => number
  /** Pause between cancel-intent write retries; honours the signal. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
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

  /** Drops the references of processes proven gone (round 4, P2-1): a crash,
   * a reload or a dead host never pins a file forever. Any doubt keeps the row. */
  private reapDeadOwners(state: UploadLedgerState): boolean {
    const pins = pinsOf(state)
    const live = pins.filter((pin) => !isOwnerGone(pin.owner))
    if (live.length === pins.length) return false
    state.pinned = live
    return true
  }

  private retryAfterMs(fails: number): number {
    const shift = Math.min(Math.max(fails - 1, 0), MEDIA_PENDING_DELETE_RETRY_MAX_SHIFT)
    return Math.min(
      MEDIA_PENDING_DELETE_RETRY_MAX_MS,
      MEDIA_PENDING_DELETE_RETRY_BASE_MS * 2 ** shift,
    )
  }

  /**
   * Delete one file through the provider. The durable intent is recorded
   * first (RULE 2), then the signal is checked immediately before the
   * dispatch; a file the provider already removed (a 404) is recorded as
   * gone, never as an error. USE BEATS INTENT: the delete runs only when
   * the entry's use generation still matches the intent's under the lock;
   * a reused file drops the intent instead. A cancel before the dispatch
   * voids an intent this call recorded; once the remote call is sent the
   * intent stays for the next read. Any other failure keeps the row, its
   * intent and its own backoff durable, and throws to the direct caller;
   * listings isolate it instead (P2-6). Every delete consumer — release,
   * sweep, single-file and Delete all ours — normalizes here.
   */
  private async removeEntry(
    state: UploadLedgerState,
    fileId: string,
    options?: {
      readonly expectedUseGen?: number | undefined
      readonly signal?: AbortSignal | undefined
    },
  ): Promise<'deleted' | 'dropped'> {
    const signal = options?.signal
    signal?.throwIfAborted()
    let intent = intentsOf(state).find((pending) => pending.fileId === fileId)
    let wasRecordedHere = false
    if (intent === undefined) {
      const seen = state.entries.find((entry) => entry.file.fileId === fileId)
      intent = {
        fileId,
        useGen: options?.expectedUseGen ?? seen?.useGen ?? 0,
      }
      state.pendingDeletes = [...intentsOf(state), intent]
      await this.deps.storage.write(state)
      wasRecordedHere = true
    }
    try {
      signal?.throwIfAborted()
    } catch (error: unknown) {
      // THE CANCEL SIGNAL REACHES EVERY CLEANUP (round 4, P2-5): a cancel
      // before the remote call was sent removes the intent this call wrote,
      // so no later listing executes the cancelled delete.
      if (wasRecordedHere) {
        state.pendingDeletes = intentsOf(state).filter((pending) => pending.fileId !== fileId)
        await this.deps.storage.write(state)
      }
      throw error
    }
    // The lock is held throughout, so no use can land between the intent
    // and the dispatch without its generation showing here.
    const entry = state.entries.find((candidate) => candidate.file.fileId === fileId)
    if (entry !== undefined && (entry.useGen ?? 0) !== intent.useGen) {
      state.pendingDeletes = intentsOf(state).filter((pending) => pending.fileId !== fileId)
      await this.deps.storage.write(state)
      return 'dropped'
    }
    if (pinCountOf(state, fileId) > 0) throw new Error(UI_TEXT.media.filesInUseRequest)
    try {
      await this.files.delete(fileId, signal)
    } catch (error: unknown) {
      if (!isModelApiError(error) || error.status !== HTTP_STATUS.notFound) {
        const fails = (state.pendingAttempts?.[fileId]?.fails ?? 0) + 1
        state.pendingAttempts = {
          ...state.pendingAttempts,
          [fileId]: { fails, nextRetry: this.deps.now() + this.retryAfterMs(fails) },
        }
        await this.deps.storage.write(state)
        throw error
      }
    }
    state.entries = state.entries.filter((candidate) => candidate.file.fileId !== fileId)
    state.cachedFiles = state.cachedFiles.filter((file) => file.fileId !== fileId)
    state.pendingDeletes = intentsOf(state).filter((pending) => pending.fileId !== fileId)
    if (state.pendingAttempts?.[fileId] !== undefined) {
      const remaining: Record<string, { fails: number; nextRetry: number }> = {}
      const attempts = Object.entries(state.pendingAttempts ?? {})
      for (const [key, value] of attempts) {
        if (key !== fileId) remaining[key] = value
      }
      state.pendingAttempts = remaining
    }
    await this.deps.storage.write(state)
    return 'deleted'
  }

  /**
   * Offer unreferenced uploads for automatic clean-up (PLAN D85.2). The
   * release path (`'release'`) deletes the files this sync left without a
   * session, however young — never an orphan it never saw. The account
   * read (`'sweep'`) is the only thing that deletes those orphans (a
   * crash, another install), once the provider's own expiry has passed
   * (`museSpark.mediaUploadExpiryDays` set it at upload). Provider
   * `expiresAt` is seconds while the clock is milliseconds: one unit
   * everywhere. One entry whose delete keeps failing is isolated with its
   * own backoff and never breaks the listing (P2-6); a cancel aborts it.
   */
  private async cleanup(
    state: UploadLedgerState,
    isCurrent: () => boolean = () => true,
    scope: 'release' | 'sweep' = 'sweep',
    signal?: AbortSignal,
    releaseIds?: ReadonlySet<string>,
  ): Promise<void> {
    signal?.throwIfAborted()
    if (!(await this.isCurrentAccount())) return
    for (const entry of state.entries) {
      if (entry.sessions.length > 0) continue
      // RULE 1: a file in use is never deleted, in either scope.
      if (pinCountOf(state, entry.file.fileId) > 0) continue
      if (scope === 'release' && releaseIds !== undefined && !releaseIds.has(entry.file.fileId))
        continue
      if (
        scope === 'sweep' &&
        Math.floor(this.deps.now() / MILLISECONDS_PER_SECOND) < entry.file.expiresAt
      )
        continue
      await this.requireAccount()
      if (!isCurrent()) return
      try {
        await this.removeEntry(state, entry.file.fileId, { signal })
      } catch (error: unknown) {
        // The release scope reports the failing delete honestly to its own
        // caller (the session is retained and the intent stays durable);
        // a listing isolates it instead (P2-6) and a cancel aborts it.
        if (scope === 'release') throw error
        signal?.throwIfAborted()
      }
    }
  }

  /** Retry the durable delete intents the previous read left behind. A file
   * used again since (generation moved) drops its intent instead of being
   * deleted; a failing entry keeps its backoff and never breaks the read. */
  private async retryPending(state: UploadLedgerState, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (!(await this.isCurrentAccount())) return
    for (const intent of intentsOf(state)) {
      // A cancel aborts the listing before the next delete; anything else
      // isolates to this entry.
      signal?.throwIfAborted()
      // A file a request carries since waits for its request to settle instead.
      if (pinCountOf(state, intent.fileId) > 0) continue
      const attempt = state.pendingAttempts?.[intent.fileId]
      if (attempt !== undefined && attempt.nextRetry > this.deps.now()) continue
      await this.requireAccount()
      try {
        await this.removeEntry(state, intent.fileId, {
          expectedUseGen: intent.useGen,
          signal,
        })
      } catch {
        signal?.throwIfAborted()
      }
    }
  }

  /**
   * The shared upload body: dedups by digest, verifies a replaced id by
   * hash, uploads under the caller's lock and mutates its state. Returns
   * the reference and, for a fresh upload, the file id the caller must
   * remove from the provider when its write fails. Every reuse bumps the
   * entry's use generation, voiding older delete intents (P1-1).
   */
  private async ensureLocked(
    state: UploadLedgerState,
    sessionId: string,
    sha256: string,
    source: UploadSource,
    signal: AbortSignal,
    onProgress?: (uploaded: number, total: number) => void,
  ): Promise<{
    readonly ref: UploadedMediaRef
    readonly uploadedFileId?: string
    /** The entry the fresh upload displaced (a re-upload): restored when publication fails. */
    readonly replaced?: UploadLedgerState['entries'][number]
  }> {
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
      existing.useGen = (existing.useGen ?? 0) + 1
      return { ref: existing.file }
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
    // The provider's receipt is recorded durably before the upload returns
    // (ported RVM105 1): a crash between the provider's answer and the
    // publication write still leaves a delete intent for the next read,
    // instead of an orphan the expiry sweep alone would own.
    let file: UploadedMediaRef
    try {
      file = await this.files.upload(source, signal, onProgress, sha256, async (fileId) => {
        this.recordIntentLocked(state, fileId)
        await this.deps.storage.write(state)
      })
    } catch (error: unknown) {
      if (!(error instanceof UploadCleanupPendingError)) throw error
      // The upload failed after the provider answered with an id, and the
      // bounded clean-up DELETE could not remove it: the id is recorded
      // durably under this same lock before anything reaches the caller, so
      // the next read deletes it instead of orphaning it. The caller still
      // sees the original upload failure.
      this.recordIntentLocked(state, error.fileId)
      await this.deps.storage.write(state)
      // The original failure keeps its identity (an abort stays an abort);
      // only its provider receipt stays behind as the intent.
      if (error.cause instanceof Error) throw error.cause
      throw error
    }
    const sessions = [...(existing?.sessions ?? [])]
    if (!sessions.includes(sessionId)) sessions.push(sessionId)
    state.entries = state.entries.filter((entry) => entry !== existing)
    state.entries.push({ file, sessions, useGen: (existing?.useGen ?? 0) + 1 })
    this.clearIntentLocked(state, file.fileId)
    return {
      ref: file,
      uploadedFileId: file.fileId,
      ...(existing !== undefined && { replaced: existing }),
    }
  }

  /** Records a delete intent this lock owns (idempotent): the next account read retries it. */
  private recordIntentLocked(state: UploadLedgerState, fileId: string): void {
    if (intentsOf(state).some((intent) => intent.fileId === fileId)) return
    state.pendingDeletes = [...intentsOf(state), { fileId, useGen: 0 }]
  }

  /** Drops the intent for a file the ledger now owns (uploaded and entered). */
  private clearIntentLocked(state: UploadLedgerState, fileId: string): void {
    if (intentsOf(state).every((intent) => intent.fileId !== fileId)) return
    state.pendingDeletes = intentsOf(state).filter((intent) => intent.fileId !== fileId)
  }

  private pinLocked(state: UploadLedgerState, fileIds: readonly string[], owner: string): boolean {
    const pins = pinsOf(state)
    let hasChanged = false
    for (const fileId of fileIds) {
      if (pins.some((pin) => pin.fileId === fileId && pin.owner === owner)) continue
      pins.push({ fileId, owner })
      hasChanged = true
    }
    if (hasChanged) state.pinned = pins
    return hasChanged
  }

  /**
   * The one upload write: runs the shared body under the caller's lock and
   * persists once. With an owner the pin lands in the same write (P2-3), so
   * no stale save lands between upload and pin. A receipt-time intent bounds
   * a crash before the write; a failed or cancelled publication removes the
   * fresh upload through the intent-first path below.
   */
  private async writeEnsuredUpload(
    sessionId: string,
    sha256: string,
    source: UploadSource,
    signal: AbortSignal,
    owner: string | undefined,
    onProgress?: (uploaded: number, total: number) => void,
  ): Promise<UploadedMediaRef> {
    return await this.deps.storage.withLock(async () => {
      const state = await this.read()
      const { ref, uploadedFileId, replaced } = await this.ensureLocked(
        state,
        sessionId,
        sha256,
        source,
        signal,
        onProgress,
      )
      if (owner !== undefined) this.pinLocked(state, [ref.fileId], owner)
      try {
        signal.throwIfAborted()
        await this.deps.storage.write(state)
        // A cancel that landed during the commit still rolls the fresh
        // upload back (ported RVM105B P2-2): the committed row is filtered
        // below exactly like an uncommitted one, so a cancelled upload is
        // never left referenced.
        signal.throwIfAborted()
      } catch (error: unknown) {
        // A cancel that landed before the publication commit deletes the
        // fresh upload instead of owning it (ported RVM105B P2-2). The pin
        // this call just took is released first, or the intent below could
        // never fire while the pin row outlives the failed request.
        if (owner !== undefined && uploadedFileId !== undefined)
          this.unpinLocked(state, [uploadedFileId], owner)
        if (uploadedFileId !== undefined)
          await this.deleteUnpublished(state, uploadedFileId, signal, replaced)
        throw error
      }
      return ref
    })
  }

  /** Releases this lock's rows for one owner: the publication path's own rollback. */
  private unpinLocked(state: UploadLedgerState, fileIds: readonly string[], owner: string): void {
    if (pinsOf(state).every((pin) => !(pin.owner === owner && fileIds.includes(pin.fileId)))) return
    state.pinned = pinsOf(state).filter(
      (pin) => !(pin.owner === owner && fileIds.includes(pin.fileId)),
    )
  }

  /**
   * Persists a cancel/delete intent with bounded backoff waits (ported
   * RVM105B P2-2): the wait doubles from the named delay and only the waits
   * honour cancellation — a cancel while waiting skips the pause, and the
   * remaining attempts (bounded, local, fast) still land the intent. Only
   * a persistently failing store gives up, and the caller then deletes
   * best-effort instead.
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
   * Removes a fresh upload whose publication write failed or was cancelled
   * (ported RVM105B P2-2, RVAPP-PORTM105R4 P2-A). The delete intent lands
   * BEFORE the remote DELETE, so a failed DELETE can never strand the file
   * without an intent the next read retries; a re-upload's replaced entry
   * is restored, so the other sessions that use it can still save and only
   * the pending upload is forgotten. The caller keeps the original failure,
   * never a cleanup write error. The rollback runs on the ledger's own
   * authority, not the caller's signal: the failed or cancelled publication
   * left provider bytes no session owns, and this delete is the cancel's
   * own cleanup, so it is attempted however the caller ended.
   */
  private async deleteUnpublished(
    state: UploadLedgerState,
    fileId: string,
    signal: AbortSignal,
    replaced?: UploadLedgerState['entries'][number],
  ): Promise<void> {
    // The fresh row goes, committed or not, and the entry it tried to
    // replace is restored when one was displaced — the other sessions that
    // use it can still save, and only the pending upload is forgotten
    // (ported RVAPP-PORTM105R4 P2-A).
    state.entries = state.entries.filter((entry) => entry.file.fileId !== fileId)
    if (
      replaced !== undefined &&
      state.entries.every((entry) => entry.file.fileId !== replaced.file.fileId)
    )
      state.entries.push(replaced)
    this.recordIntentLocked(state, fileId)
    try {
      await this.writeCancelIntent(state, signal)
    } catch {
      // The intent would not land: delete best-effort so nothing remote is
      // left without trying, then report the original failure.
      try {
        await this.files.delete(fileId)
      } catch {
        // A persistently failing store strands the ownership; a later
        // ownership release or provider expiry still resolves it.
      }
      return
    }
    try {
      await this.files.delete(fileId)
    } catch {
      // The intent stays durable for the next read; the caller keeps the
      // original publication failure.
      return
    }
    this.clearIntentLocked(state, fileId)
    try {
      await this.deps.storage.write(state)
    } catch {
      // The remote copy is gone; the retained intent makes the next read
      // forget it (a missing file deletes as found). Keep the original.
    }
  }

  /**
   * Pin the files an active request carries (RULE 1): one counted row per
   * (file, owner) under the cross-process lock, so a stale window's save
   * cannot delete them. References of a process proven gone are released
   * first, so a crash never pins forever. No account check: unpinning must
   * succeed even after the key is gone, or the pin would leak.
   */
  public async pinFiles(
    fileIds: readonly string[],
    owner: string = processOwnerId(),
  ): Promise<void> {
    if (fileIds.length === 0) return
    await this.deps.storage.withLock(async () => {
      const state = await this.read()
      let hasChanged = this.reapDeadOwners(state)
      const pins = pinsOf(state)
      for (const fileId of fileIds) {
        if (pins.some((pin) => pin.fileId === fileId && pin.owner === owner)) continue
        pins.push({ fileId, owner })
        hasChanged = true
      }
      if (!hasChanged) return
      state.pinned = pins
      await this.deps.storage.write(state)
    })
  }

  /**
   * Release a request's pins once it settles, however it settled. Only the
   * caller's own references are released: the file is unpinned when the
   * count reaches zero. A caller without an owner releases the legacy rows
   * and this process's direct rows, never another live request's.
   */
  public async unpinFiles(fileIds: readonly string[], owner?: string): Promise<void> {
    if (fileIds.length === 0) return
    await this.deps.storage.withLock(async () => {
      const state = await this.read()
      const pins = pinsOf(state)
      const kept = pins.filter(
        (pin) =>
          !fileIds.includes(pin.fileId) ||
          (owner === undefined
            ? pin.owner !== LEGACY_PIN_OWNER && pin.owner !== processOwnerId()
            : pin.owner !== owner),
      )
      if (kept.length === pins.length) return
      state.pinned = kept
      await this.deps.storage.write(state)
    })
  }

  /** Same digest shares one upload. A missing/expired ID is replaced once, after hash verification. */
  public async ensure(
    sessionId: string,
    sha256: string,
    source: UploadSource,
    signal: AbortSignal,
    onProgress?: (uploaded: number, total: number) => void,
  ): Promise<UploadedMediaRef> {
    return await this.writeEnsuredUpload(sessionId, sha256, source, signal, undefined, onProgress)
  }

  /**
   * Upload and pin in ONE lock scope (round 4, P2-3): no stale save can
   * land between the upload and its pin. The pin joins the caller's
   * request bracket, drained at the turn's end.
   */
  public async ensureAndPin(
    sessionId: string,
    sha256: string,
    source: UploadSource,
    signal: AbortSignal,
    owner: string,
    onProgress?: (uploaded: number, total: number) => void,
  ): Promise<UploadedMediaRef> {
    return await this.writeEnsuredUpload(sessionId, sha256, source, signal, owner, onProgress)
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
          if (wanted.every((ref) => ref.sha256 !== entry.file.sha256)) continue
          entry.sessions.push(sessionId)
          // A session that uses the file again voids older delete intents.
          entry.useGen = (entry.useGen ?? 0) + 1
        }
        await this.deps.storage.write(state)
        // RULE 3: the release deletes only the files this sync left
        // without a session. An orphan it never saw waits for the sweep.
        const released = new Set(
          state.entries
            .filter(
              (entry) =>
                entry.sessions.length === 0 &&
                (previousSessions.get(entry.file.fileId) ?? []).length > 0,
            )
            .map((entry) => entry.file.fileId),
        )
        await this.cleanup(state, isCurrent, 'release', undefined, released)
        // Due durable delete intents retry on every ownership write, not
        // only on account reads (ported RVAPP-PORTM105R4 P2-B): a failed
        // remove's intent cleans on the next save or listing once its
        // backoff is due. Only under the current account, as in the read
        // path; the cleanup above already reported this sync's own failure
        // honestly, so a throw there still skips this retry.
        if (await this.isCurrentAccount()) await this.retryPending(state)
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

  public async accountReport(signal?: AbortSignal): Promise<UploadedFilesReport> {
    return await this.deps.storage.withLock(async () => {
      const state = await this.read()
      signal?.throwIfAborted()
      const isReadOnly = !(await this.isCurrentAccount())
      if (!isReadOnly) {
        // References of a process proven gone release before the listing's
        // own cleanup runs, so a crash never hides a file forever.
        if (this.reapDeadOwners(state)) await this.deps.storage.write(state)
        // A cancel that landed during the reads above deletes nothing:
        // every destructive step below checks the signal first, and one
        // failing entry never breaks the listing.
        await this.retryPending(state, signal)
        await this.cleanup(state, () => true, 'sweep', signal)
        signal?.throwIfAborted()
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
   * Account cleanup never deletes a file still shared by a session. A
   * provider 404 means gone here too, through the one normalising path. A
   * provider refusal reaches the direct caller as the typed error carrying
   * the file's display name (never its id), so the dialog names the file
   * with a fixed reason instead of the provider's id-echoing message
   * (ported RVAPP-PORTM105R4 P3-4).
   */
  public async deleteFile(
    fileId: string,
    isForeignDeletionConfirmed: (name: string) => Promise<boolean>,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    await this.deps.storage.withLock(async () => {
      const state = await this.read()
      signal?.throwIfAborted()
      await this.requireAccount()
      const ours = state.entries.find((entry) => entry.file.fileId === fileId)
      if (ours !== undefined && ours.sessions.length > 0) throw new Error(UI_TEXT.media.filesInUse)
      // RULE 1: an explicit delete never takes a file an active request
      // carries, even after its session reference went stale.
      if (pinCountOf(state, fileId) > 0) throw new Error(UI_TEXT.media.filesInUseRequest)
      const known =
        ours?.file ?? state.cachedFiles.find((entry) => entry.fileId === fileId) ?? undefined
      if (
        ours === undefined &&
        (known === undefined || !(await isForeignDeletionConfirmed(known.name)))
      )
        return
      await this.requireAccount()
      try {
        await this.removeEntry(state, fileId, { signal })
      } catch (error: unknown) {
        // A cancel and the two in-use refusals keep their identity; a
        // provider refusal becomes the typed display-name error instead.
        if (signal?.aborted === true) throw error
        if (error instanceof Error && isInUseRefusal(error)) throw error
        throw new UploadDeleteFailedError(known?.name ?? UI_TEXT.media.uploadedFiles)
      }
    })
  }

  /**
   * The account surface's once-only backlog notice (ported
   * RVAPP-PORTM105R4 P2-B): entries whose delete keeps failing past the
   * named attempts are told once, as a count only — no file name and no
   * file id ever reaches this notice. A recovered entry's row is gone, so
   * nothing is told for it.
   */
  public async consumeDeleteNotice(): Promise<{ provider: string; count: number } | undefined> {
    return await this.deps.storage.withLock(async () => {
      const state = await this.read()
      const due = Object.entries(state.pendingAttempts ?? {}).filter(
        ([, attempt]) =>
          attempt.fails >= MEDIA_UPLOAD_DELETE_NOTICE_ATTEMPTS && attempt.notified !== true,
      )
      if (due.length === 0) return
      state.pendingAttempts = {
        ...state.pendingAttempts,
        ...Object.fromEntries(
          due.map(([fileId, attempt]) => [fileId, { ...attempt, notified: true }]),
        ),
      }
      await this.deps.storage.write(state)
      return { provider: this.deps.provider, count: due.length }
    })
  }

  /**
   * Explicit early removal (Delete uploaded files): every unreferenced own
   * upload goes now, however young. An upload another session still
   * references is never deleted.
   */
  public async deleteAllOurs(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await this.deps.storage.withLock(async () => {
      const state = await this.read()
      signal?.throwIfAborted()
      await this.requireAccount()
      for (const entry of state.entries) {
        if (entry.sessions.length > 0 || pinCountOf(state, entry.file.fileId) > 0) continue
        await this.requireAccount()
        await this.removeEntry(state, entry.file.fileId, { signal })
      }
    })
  }
}

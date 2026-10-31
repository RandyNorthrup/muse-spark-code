import {
  type VaultPanelState,
  type VaultRetiredEntry,
  vaultPanelChangeSchema,
} from '../../shared/vaultPanel'
import {
  vaultClientMessageSchema,
  vaultHostMessageSchema,
} from '../../shared/hostApi/vaultMessages'
import {
  type VaultApprovalAnswer,
  type VaultGrant,
  type VaultItem,
  type VaultItemMetadata,
  vaultItemSchema,
  vaultItemMetadataSchema,
} from '../../shared/vault'
import { UI_TEXT, VAULT_VIEW_RETRY_BUDGET, VAULT_VIEW_RETRY_MS } from '../../shared/constants'
import { failureForLog } from '../../core/backends/musecode/logText'
import { vaultRefusalSentences } from '../../shared/vaultRefusals'
import type { Logger } from '../logger'
import type { VaultImportReport } from '../../core/vault/broker/ports'
import { VaultChannelError } from '../../core/vault/broker/client'
import {
  applyVaultViewEvent,
  vaultViewFrame,
  type VaultUnavailableReason,
  type VaultViewEvent,
  type VaultViewState,
} from './vaultViewMachine'
import type { VaultResetChallenge } from '../../shared/vaultProtocol'
import { vaultWriterRecoveryMessage } from '../../core/vault/broker/manageClient'

/** D241: the key-store migration's retired-slot surface, bound on the first unlock edge. */
export interface VaultRetiredUndoPort {
  listRetired(): Promise<readonly VaultRetiredEntry[]>
  undoRetired(key: string): Promise<void>
}

/** C/B/P/M bind these operations to the real broker and single writer. No values cross the panel. */
export interface VaultPanelService {
  snapshot(): Promise<unknown>
  /** D241: undo one retired migration slot; the service owns the migration binding. */
  undoRetired(key: string): Promise<void>
  /** `failed` reports a watch that cannot be (re)opened, once per outage. */
  subscribe(changed: (event: unknown) => void, failed: () => void): () => void
  unlock(authorize: () => void): Promise<void>
  lock(): Promise<void>
  /** Invoke authorize after all awaits, immediately before the physical commit. */
  write(item: VaultItem, authorize: () => void): Promise<void>
  updateMetadata(item: VaultItemMetadata, authorize: () => void): Promise<void>
  remove(itemId: string, authorize: () => void): Promise<void>
  grant(grant: VaultGrant, authorize: () => void): Promise<void>
  revoke(grantId: string): Promise<void>
  /** B consumes the answer and delivers any ticket privately to the waiting use route. */
  answer(answer: VaultApprovalAnswer, authorize: () => void): Promise<void>
  /** M imports only the selected path; never another application's private store. */
  importFile(path: string, authorize: () => void, signal: AbortSignal): Promise<VaultImportReport>
  keepImport(receipt: string): Promise<void>
  deleteImport(receipt: string, authorize: () => void, signal: AbortSignal): Promise<void>
  /** Reset Vault: only for a lost vault (lead decision). */
  resetBegin(): Promise<VaultResetChallenge>
  resetConfirm(resetId: string, word: string, authorize: () => void): Promise<void>
  /** Set Up Vault: the one-time code as owned bytes; nothing is written before confirmSetup. */
  setup(): Promise<{ setupId: string; code: Buffer }>
  confirmSetup(setupId: string, authorize: () => void): Promise<void>
  cancelSetup(setupId: string): Promise<void>
}
export interface VaultPanelHostDeps {
  readonly service: VaultPanelService
  /** The record keeps each failure's kind in fixed words; the person hears fixed sentences. */
  readonly log: Logger
  readonly now: () => number
  /** VS Code's native password box, or an IDE terminal; never a webview form. */
  readonly editItem: (
    current: VaultItemMetadata | undefined,
    signal: AbortSignal,
  ) => Promise<VaultItem | VaultItemMetadata | null>
  readonly confirmRemove: (item: VaultItemMetadata) => Promise<boolean>
  readonly copyPublicKey: (key: string) => Promise<void>
  readonly publish: (message: ReturnType<typeof vaultHostMessageSchema.parse>) => void
  readonly status: (isUnlocked: boolean) => void
  /**
  Fires on lock-state edges only (not every frame), for the key-store
  migration's unlock trigger. Absent in tests and lock-only hosts.
  */
  readonly onVaultLockStateChange?: (isUnlocked: boolean) => void
  readonly showError: (message: string) => void
  /** The per-item report (names only) and the person's Keep or Delete of the source. */
  readonly importDone: (names: readonly string[]) => Promise<'keep' | 'delete'>
  /**
  The host's own two steps: the warning with Continue, then the typed word.
  Resolves the typed text, or null when the person stops.
  */
  readonly confirmReset: (
    word: string,
    signal: AbortSignal,
    warning?: string,
  ) => Promise<string | null>
  /** The host's own modal with Copy and I Saved It; true only for I Saved It. */
  readonly showRecoveryCode: (code: string, signal: AbortSignal) => Promise<boolean>
}

function wipe(item: VaultItem): void {
  for (const value of Object.values(item.material)) {
    if (value instanceof Uint8Array) value.fill(0)
  }
}

/**
A refusal the broker or a guard below named with a fixed localized
sentence keeps that sentence; anything else (native text, connection
errors) stays the generic failure (RVCM1091B 4: never native text).
Exact match only: no foreign text can quote a full sentence.
*/
function refusalMessage(error: unknown): string {
  // Every named sentence, shared with the terminal (RVAPP-CM1091D5 P2-3),
  // plus the broker-shape fallback only the panel names.
  const named: readonly string[] = [
    ...vaultRefusalSentences(),
    UI_TEXT.vault.noAccess, // an unexpected broker shape
  ]
  return error instanceof Error && named.includes(error.message)
    ? error.message
    : UI_TEXT.vault.operationFailed
}

/** A guard veto (a retired or superseded view), never a failure to show. */
function isVeto(error: unknown): boolean {
  return error instanceof Error && error.message === UI_TEXT.vault.useChanged
}

/**
Map a snapshot failure to the machine's typed reason. Anything without a
known cause is `unreachable`: the section says the operation failed and
offers Retry, never the repair message (RVCM1091F P2). Only the broker's
own `brokerBlocked` snapshot verdict reaches `brokerCannotStart`. A dead
or corrupted channel is `unreachable` too: it never claims the vault is
locked beside a recovered unlocked section (RVCM1091G P3).
*/
function classifySnapshotError(error: unknown): VaultUnavailableReason {
  if (error instanceof VaultChannelError) return 'unreachable'
  if (error instanceof Error) {
    switch (error.message) {
      case UI_TEXT.vault.busy: {
        return 'busy'
      }
      case UI_TEXT.vault.rollback: {
        return 'rollback'
      }
      case UI_TEXT.vault.storeUnavailable: {
        return 'storeUnavailable'
      }
      case UI_TEXT.vault.approvalExpired: {
        return 'timeout'
      }
      default: {
        break
      }
    }
  }
  return 'unreachable'
}

/**
One serialized owner. The person's own barrier (their Lock or Revoke
click, disposal) synchronously invalidates every older effect; broker
events never do (see absorbExternalChange).
*/
export class VaultPanelHost {
  private generation = 0
  /** Every reload request's own sequence inside the machine (RVCM1091G P2). */
  private reloadSeq = 0
  private disposed = false
  // RVCM1091F REDESIGN: the whole visible view is this machine — no flag.
  // Every event below ends in a publish (a frame now, or a reload whose
  // settle always publishes): there is no silent path.
  private view: VaultViewState = { kind: 'loading', generation: 0 }
  /** Last published lock state; the edge callback fires only on change. */
  private lastLockState: boolean | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly answered = new Set<string>()
  /**
  The draft guard: every broker state change and every barrier moves it,
  and add/edit commit only the draft their own load read (RLVAULTCI).
  */
  private draftGeneration = 0
  /** The confirm dialogs' own signal: only a barrier aborts them, never a mere change. */
  private confirmCancellation = new AbortController()
  /** The editor dialog's own signal: a broker change aborts it, while confirm dialogs stand. */
  private editCancellation = new AbortController()
  // A receipt is bound to imported items, so ordinary metadata notifications
  // cannot withdraw Keep/Delete. Lock, revocation and disposal still do.
  private importAbort = new AbortController()
  private importsInFlight = 0
  private queue = Promise.resolve()
  private readonly unsubscribe: () => void

  constructor(private readonly deps: VaultPanelHostDeps) {
    this.unsubscribe = deps.service.subscribe(
      (raw) => {
        const parsed = vaultPanelChangeSchema.safeParse(raw)
        if (!parsed.success || this.disposed) return
        const event = parsed.data
        // Approval cards never wait behind native editors: a held password
        // box must not starve another requester's expiring card.
        if (event.kind === 'approval') {
          this.apply({ kind: 'brokerApproval' })
          this.refreshNow()
          return
        }
        // A broker event never retires the person's in-flight operation
        // (RLVAULTCI): a lock, revocation or change the broker emitted
        // before the operation was sent used to drop it without a word —
        // the panel sat on Locked after Unlock with no toast and no log.
        // Only the person's own barrier retires (their Lock or Revoke
        // click, disposal); the broker validates every commit, so a
        // change an operation genuinely conflicts with comes back as a
        // refusal and is shown. The event still aborts open dialogs
        // (their base view is stale), drops a scheduled retry (it
        // reloads fresh instead) and marks drafts stale. A `locked`
        // event from anywhere (idle auto-lock, screen lock, another
        // window, the CLI) locks THIS window at once and reloads —
        // later events are never gated on it (RVCM1091F P2).
        switch (event.kind) {
          case 'locked': {
            this.absorbExternalChange(false)
            this.applyAndReload({ kind: 'brokerLocked', lockEpoch: event.lockEpoch })
            return
          }
          case 'revoked': {
            this.absorbExternalChange(false)
            this.applyAndReload({ kind: 'brokerRevoked' })
            return
          }
          case 'changed': {
            this.absorbExternalChange(true)
            // The importing owner reloads after Keep/Delete. Starting another
            // snapshot now would compete with its writer transaction — but the
            // event is still published, never ignored.
            const effects = this.apply({ kind: 'brokerChanged' })
            if (this.importsInFlight === 0 && effects.reload) void this.refresh()
            return
          }
          default: {
            break
          }
        }
        void this.refresh()
      },
      () => {
        // The broker's event stream is down: say so and reload to confirm
        // what is true, never stay silent (F7).
        this.applyAndReload({ kind: 'watchLost' })
      },
    )
  }

  /** Run one machine event: publish its frame, toast, schedule its retry. */
  private apply(event: VaultViewEvent): { reload: boolean; toast: string | null } {
    const { state, effects } = applyVaultViewEvent(
      this.view,
      event,
      this.generation,
      VAULT_VIEW_RETRY_BUDGET,
      VAULT_VIEW_RETRY_MS,
    )
    this.view = state
    if (state.kind === 'locked') this.answered.clear()
    if (effects.frame !== null) this.publishFrame(effects.frame, effects.retryInMs !== null)
    if (effects.toast !== null && !this.disposed) this.deps.showError(effects.toast)
    if (effects.retryInMs !== null) this.scheduleRetry(effects.retryInMs)
    return { reload: effects.reload, toast: effects.toast }
  }

  /** Apply, then reload when the transition asks for a fresh snapshot. */
  private applyAndReload(event: VaultViewEvent): void {
    if (this.apply(event).reload) void this.refresh()
  }

  /**
  Record a reload request inside the machine and return its sequence. A
  reply is applied only if it answers the newest request, so overlapping
  reloads (two approval cards) settle newest-wins in both landing orders
  (RVCM1091G P2).
  */
  private beginReload(): number {
    const seq = (this.reloadSeq += 1)
    this.apply({ kind: 'reloadRequested', seq })
    return seq
  }

  private publishFrame(frame: VaultPanelState, hasScheduledRetry: boolean): void {
    if (this.disposed) return
    // A kept view with a retry scheduled or in flight says so (the section
    // shows retry text with aria-busy): it never poses as a fresh view
    // (RVCM1091G P3).
    const isRetrying = hasScheduledRetry || this.retryTimer !== null || this.isRetryLoop()
    const state = isRetrying && frame.retrying !== true ? { ...frame, retrying: true } : frame
    const message = vaultHostMessageSchema.parse({ type: 'vaultState', state })
    this.deps.publish(structuredClone(message))
    const isUnlocked = message.state.status.state === 'unlocked'
    this.deps.status(isUnlocked)
    if (isUnlocked === this.lastLockState) return
    this.lastLockState = isUnlocked
    this.deps.onVaultLockStateChange?.(isUnlocked)
  }

  /** True while a bounded auto-retry loop owns the view. */
  private isRetryLoop(): boolean {
    return this.view.kind === 'loading' && this.view.retriesLeft !== undefined
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.disposed) this.applyAndReload({ kind: 'autoRetry' })
    }, delayMs)
  }

  /** Late completions after disposal report nothing: there is no window left. */
  private reportError(generation: number, error?: unknown): void {
    if (!this.disposed && generation === this.generation)
      this.deps.showError(
        error === undefined ? UI_TEXT.vault.operationFailed : refusalMessage(error),
      )
  }

  /**
  The one place every failed operation goes through (RVCM1091E CLASS 1,
  RVCM1091F REDESIGN): a fresh snapshot is published first, so a change
  that arrived while the operation was failing is applied, not dropped;
  when no snapshot can be had, the machine publishes the explicit
  unavailable state (no item labels) instead. Then the failure is
  reported — unless a barrier already put its view on screen, which stays
  silent. A failure that arrives while a reload is running is kept and
  shown, never dropped (RVCM1091F P3).
  */
  private async settleFailure(error: unknown, generation: number): Promise<void> {
    if (this.disposed || this.isRetiredByBarrier(error, generation)) return
    // A `useChanged` word is only a silent retirement when an older
    // generation carries it (a barrier already put its view on screen). With
    // the current generation it is a genuine guard refusal — reset on a
    // vault that is not lost, an edit/grant/answer/import guard — and it is
    // still shown below.
    const isRetiredSilent = isVeto(error) && generation !== this.generation
    const seq = this.beginReload()
    try {
      await this.load(this.generation, seq)
    } catch (reloadError: unknown) {
      // The record keeps the reload failure's kind; the view below says fixed words.
      this.deps.log.warn(`Vault reload failed: ${failureForLog(reloadError)}`)
      if (isVeto(reloadError)) {
        // The change landed; the current view republishes and the real
        // failure is still shown.
        const frame = vaultViewFrame(this.view)
        if (frame !== null) this.publishFrame(frame, false)
        if (!isRetiredSilent) this.reportError(this.generation, error)
        return
      }
      // The reload itself failed: publish what happened (kept view plus a
      // bounded retry, or Unavailable with its true reason), then still
      // report the operation's own failure — unless it names the same
      // sentence the reload already showed.
      const effects = this.apply({
        kind: 'snapshotFailed',
        generation: this.generation,
        seq,
        reason: classifySnapshotError(reloadError),
      })
      if (effects.reload) void this.refresh()
      if (!isRetiredSilent && refusalMessage(error) !== effects.toast)
        this.reportError(this.generation, error)
      return
    }
    if (!isRetiredSilent) this.reportError(this.generation, error)
  }

  /**
  A retirement a barrier already put on screen: silent, and not a failure —
  including a `locked` report our own barrier caused by closing its
  connection (RVCM1091F P3) and a channel error from a connection our own
  barrier aborted mid-Import or mid-Delete (RVAPP-CM1091D5 P2-1). The
  barrier owns the view and reloads it, so the log names no failure either
  (a first open, overtaken by the person's own Lock, once logged one each
  time). Decided from the recorded retirement (the generation) and the
  typed error, never from a sentence.
  */
  private isRetiredByBarrier(error: unknown, generation: number): boolean {
    return (
      generation !== this.generation &&
      (isVeto(error) ||
        (error instanceof Error && error.message === UI_TEXT.vault.locked) ||
        error instanceof VaultChannelError)
    )
  }

  /** Prompt publish outside the queue; the queued editor keeps its own generation. */
  private refreshNow(): void {
    const generation = this.generation
    const seq = this.beginReload()
    void this.load(generation, seq).catch((error: unknown) => {
      if (!this.isRetiredByBarrier(error, generation))
        this.deps.log.warn(`Vault refresh failed: ${failureForLog(error)}`)
      void this.settleFailure(error, generation)
    })
  }

  private authorize(generation: number): void {
    if (this.disposed || generation !== this.generation) throw new Error(UI_TEXT.vault.useChanged)
  }

  /**
  Finish the person's Delete of an imported source (RVAPP-CM1091D5 P2-2):
  shared by the one-time prompt after an import and by a kept or orphaned
  receipt's own Delete action. The source already gone finishes the Delete
  by clearing the leftover record instead of dropping it, so no orphan
  receipt waits for another Delete carrying it. A record already cleared
  (or still stuck) leaves the refusal below exactly as it stands.
  */
  private async finishDelete(
    receipt: string,
    authorize: () => void,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.deps.service.deleteImport(receipt, authorize, signal)
    } catch (error: unknown) {
      this.deps.log.warn(`Vault delete of an import failed: ${failureForLog(error)}`)
      if (error instanceof Error && error.message === UI_TEXT.vault.sourceGone) {
        try {
          await this.deps.service.keepImport(receipt)
        } catch {
          /* The refusal below still holds: the file is gone. */
        }
      }
      throw error
    }
  }

  /**
  One retirement path for the person's own barriers: their Lock or Revoke
  click, disposal. Nothing else retires: a broker event that arrives while
  an operation is in flight is absorbed, never a veto (see
  absorbExternalChange), so the operation is sent and its answer shown.
  */
  private retire(): void {
    this.generation += 1
    this.draftGeneration += 1
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.confirmCancellation.abort()
    this.confirmCancellation = new AbortController()
    this.editCancellation.abort()
    this.editCancellation = new AbortController()
    this.importAbort.abort()
    this.importAbort = new AbortController()
    this.queue = Promise.resolve()
  }

  /**
  A broker state change lands without retiring the person's work: open
  dialogs are aborted (their base view is stale), a scheduled retry is
  dropped (the event's own reload follows instead) and drafts are marked
  stale, but in-flight operations run on — the broker validates every
  commit. A mere change leaves confirm dialogs standing (their pending
  setup or reset is this window's own); a lock or revocation aborts them
  too, as the pending state they confirm may be gone.
  */
  private absorbExternalChange(isEditorsOnly: boolean): void {
    this.draftGeneration += 1
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.editCancellation.abort()
    this.editCancellation = new AbortController()
    if (isEditorsOnly) return
    this.confirmCancellation.abort()
    this.confirmCancellation = new AbortController()
  }

  private enqueue(task: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.generation
    const previous = this.queue
    this.queue = (async () => {
      try {
        await previous
        this.authorize(generation)
        await task(generation)
      } catch (error: unknown) {
        if (!this.isRetiredByBarrier(error, generation))
          this.deps.log.warn(`Vault operation failed: ${failureForLog(error)}`)
        await this.settleFailure(error, generation)
      }
    })()
    return this.queue
  }

  private async load(generation: number, seq: number): Promise<VaultPanelState> {
    const message = vaultHostMessageSchema.parse({
      type: 'vaultState',
      state: await this.deps.service.snapshot(),
    })
    const snapshot = message.state
    this.authorize(generation)
    // A fresh snapshot is always trusted (RVCM1091F P2): the machine keeps a
    // stale one (older generation, older broker epoch or older reload
    // request) off the screen and republishes the current view instead —
    // never silently.
    const effects = this.apply({ kind: 'snapshotOk', generation, seq, snapshot })
    if (effects.reload) void this.refresh()
    if (snapshot.status.state !== 'locked') {
      const pendingIds = new Set(snapshot.pending.map((request) => request.id))
      for (const id of this.answered) if (!pendingIds.has(id)) this.answered.delete(id)
    }
    return snapshot
  }

  refresh(): Promise<void> {
    return this.enqueue(async (generation) => {
      await this.load(generation, this.beginReload())
    })
  }

  /** Break glass bypasses the queue; no password box or stalled snapshot may delay it. */
  async lock(): Promise<void> {
    if (this.disposed) return
    this.retire()
    // Optimistic Locked (labels stripped); the lock-then-load below settles
    // the truth, and a failed Lock publishes the real snapshot instead.
    this.apply({ kind: 'userLock' })
    try {
      await this.deps.service.lock()
      // The Lock call returned, so the optimistic Locked view is broker
      // truth: a snapshot that fails below keeps Locked instead of claiming
      // the state is unknown. A Lock that FAILED never confirms — its settle
      // says Unavailable when no snapshot can be had (RVCM1091F).
      this.apply({ kind: 'userLockConfirmed' })
      await this.refresh()
    } catch (error: unknown) {
      // A failed Lock never stays on screen as Locked: settle through the
      // one failure path, so the real snapshot (with any change that
      // arrived meanwhile) is published and the real failure is reported
      // even after an intervening retire (RVCM1091E P2/P3).
      this.deps.log.warn(`Vault lock failed: ${failureForLog(error)}`)
      await this.settleFailure(error, this.generation)
    }
  }

  handle(raw: unknown): Promise<void> {
    const parsed = vaultClientMessageSchema.safeParse(raw)
    if (!parsed.success || this.disposed) return Promise.resolve()
    const message = parsed.data
    if (message.type === 'vaultLock') return this.lock()
    // Revocation is also a barrier; pending edits cannot commit with older authority.
    if (message.type === 'vaultRevoke') {
      this.retire()
      this.apply({ kind: 'userRevoke' })
      return this.enqueue(async (generation) => {
        await this.deps.service.revoke(message.grantId)
        await this.load(generation, this.beginReload())
      })
    }
    return this.enqueue(async (generation) => {
      if (message.type === 'vaultReady') {
        // Republished while the task's own load follows (no double reload).
        this.apply({ kind: 'vaultReady' })
        await this.load(generation, this.beginReload())
        return
      }
      if (message.type === 'vaultRetry') {
        // The person's own Retry: a restored budget and a fresh snapshot.
        this.apply({ kind: 'userRetry' })
        await this.load(generation, this.beginReload())
        return
      }
      const authorize = () => {
        this.authorize(generation)
      }
      if (message.type === 'vaultReset') {
        const current = await this.load(generation, this.beginReload())
        if (current.status.reason !== 'vaultLost') throw new Error(UI_TEXT.vault.useChanged)
        const challenge = await this.deps.service.resetBegin()
        const typed = await this.deps.confirmReset(
          challenge.word,
          this.confirmCancellation.signal,
          vaultWriterRecoveryMessage(challenge.writer),
        )
        if (typed !== null)
          await this.deps.service.resetConfirm(challenge.resetId, typed, authorize)
        await this.load(this.generation, this.beginReload())
        return
      }
      if (message.type === 'vaultSetup') {
        const current = await this.load(generation, this.beginReload())
        if (current.status.state !== 'uncreated') throw new Error(UI_TEXT.vault.setupExists)
        const shown = await this.deps.service.setup()
        try {
          const isSaved = await this.deps.showRecoveryCode(
            shown.code.toString('ascii'),
            this.confirmCancellation.signal,
          )
          if (isSaved) {
            try {
              authorize()
              await this.deps.service.confirmSetup(shown.setupId, authorize)
            } catch (error: unknown) {
              // A refused confirmation never leaves this setup waiting out its
              // window: it is withdrawn, so Set Up Vault can start again.
              // The record keeps the confirmation failure's kind.
              this.deps.log.warn(`Vault setup confirmation failed: ${failureForLog(error)}`)
              try {
                await this.deps.service.cancelSetup(shown.setupId)
              } catch {
                /* Already created, expired or withdrawn: nothing is left to cancel. */
              }
              throw error
            }
          } else {
            await this.deps.service.cancelSetup(shown.setupId)
          }
        } finally {
          shown.code.fill(0)
        }
        // Retired while the code dialog stood open: no doomed snapshot that
        // could steal the writer from the barrier's own work (RVCM1091E).
        this.authorize(generation)
        await this.load(generation, this.beginReload())
        return
      }
      if (message.type === 'vaultUnlock') {
        this.apply({ kind: 'userUnlock' })
        await this.deps.service.unlock(authorize)
        authorize()
        await this.load(generation, this.beginReload())
        return
      }
      const state = await this.load(generation, this.beginReload())
      if (state.status.state !== 'unlocked') throw new Error(UI_TEXT.vault.locked)
      // The draft guard's base: the broker state this operation read. A
      // change that lands after it marks the draft stale below.
      const draftAtLoad = this.draftGeneration
      switch (message.type) {
        case 'vaultAdd':
        case 'vaultEdit': {
          const current =
            message.type === 'vaultEdit'
              ? state.items.find((item) => item.id === message.itemId)
              : undefined
          if (current === undefined && message.type === 'vaultEdit')
            throw new Error(UI_TEXT.vault.useChanged)
          const entered = await this.deps.editItem(current, this.editCancellation.signal)
          if (entered === null) return
          // A draft finished after another window's change must not
          // restore the older policy — but the refusal is said, never
          // silent (RLVAULTCI). Checked again after the connection is
          // acquired (the composed closure the service runs after every
          // await), so a change during the commit's own round trip is
          // caught too.
          const authorizeDraft = (): void => {
            authorize()
            if (draftAtLoad !== this.draftGeneration) throw new Error(UI_TEXT.vault.editConflict)
          }
          try {
            authorizeDraft()
            if ('material' in entered) {
              const item = vaultItemSchema.parse(entered)
              if (message.type === 'vaultEdit' && item.metadata.id !== current?.id)
                throw new Error(UI_TEXT.vault.useChanged)
              await this.deps.service.write(item, authorizeDraft)
            } else {
              const item = vaultItemMetadataSchema.parse(entered)
              if (item.id !== current?.id) throw new Error(UI_TEXT.vault.useChanged)
              await this.deps.service.updateMetadata(item, authorizeDraft)
            }
          } finally {
            if ('material' in entered) wipe(entered)
          }
          break
        }
        case 'vaultRemove': {
          const item = state.items.find((entry) => entry.id === message.itemId)
          if (item === undefined || !(await this.deps.confirmRemove(item))) return
          authorize()
          await this.deps.service.remove(item.id, authorize)
          break
        }
        case 'vaultUndoRetired': {
          // D241: only a key the fresh snapshot lists as retired undoes; a
          // stale or foreign key is the guard refusal, said, never silent.
          const entry = state.retired?.find((candidate) => candidate.key === message.key)
          if (entry === undefined) throw new Error(UI_TEXT.vault.useChanged)
          authorize()
          await this.deps.service.undoRetired(entry.key)
          break
        }
        case 'vaultGrant': {
          if (
            message.grant.createdBy !== 'vaultPanel' ||
            message.grant.uses !== 0 ||
            state.items.every(
              (item) => item.id !== message.grant.itemId || item.firstParty || item.hidden,
            )
          ) {
            throw new Error(UI_TEXT.vault.useChanged)
          }
          await this.deps.service.grant(message.grant, authorize)
          break
        }
        case 'vaultAnswer': {
          const request = state.pending.find((entry) => entry.id === message.answer.requestId)
          if (
            this.answered.has(message.answer.requestId) ||
            request?.digest !== message.answer.digest ||
            request.lockEpoch !== state.status.lockEpoch
          ) {
            throw new Error(UI_TEXT.vault.useChanged)
          }
          // Remote uses need approval on the owning device every time (D89.13):
          // a session grant here cannot cover later remote uses.
          if (
            message.answer.decision === 'allowSession' &&
            (request.item.policy.mode !== 'askOncePerSession' ||
              request.requester.sessionId === null ||
              request.requester.deviceId !== null ||
              request.taint.tainted ||
              request.use.kind === 'disclosure')
          )
            throw new Error(UI_TEXT.vault.useChanged)
          authorize()
          this.answered.add(message.answer.requestId)
          await this.deps.service.answer(message.answer, authorize)
          break
        }
        case 'vaultPublicKey': {
          const item = state.items.find((entry) => entry.id === message.itemId)
          if (item?.kind !== 'sshKey' || item.publicKey === null)
            throw new Error(UI_TEXT.vault.useChanged)
          await this.deps.copyPublicKey(item.publicKey)
          break
        }
        // A kept or orphaned receipt's two real actions: finish the delete,
        // or keep the file (RVAPP-CM1091D5 P2-2). A barrier aborts the
        // in-flight call, which settles silent like Import's own.
        case 'vaultKeepReceipt': {
          await this.deps.service.keepImport(message.receipt)
          break
        }
        case 'vaultDeleteReceipt': {
          await this.finishDelete(message.receipt, authorize, this.importAbort.signal)
          break
        }
        case 'vaultImport': {
          if (
            state.ambientFiles.every(
              (file) => file.path.replaceAll('\\', '/') !== message.path.replaceAll('\\', '/'),
            )
          ) {
            throw new Error(UI_TEXT.vault.useChanged)
          }
          const signal = this.importAbort.signal
          const authorizeImport = () => {
            // A barrier (Lock, revocation, disposal) — or a locked view —
            // retires the import: its failure settles silent, the barrier
            // owns the view.
            if (this.disposed || signal.aborted || this.view.kind === 'locked')
              throw new Error(UI_TEXT.vault.useChanged)
          }
          this.importsInFlight += 1
          try {
            const report = await this.deps.service.importFile(message.path, authorizeImport, signal)
            authorizeImport()
            const choice = await this.deps.importDone(
              report.items.map((item) => `${item.name} (${item.kind})`),
            )
            authorizeImport()
            if (choice === 'delete') {
              await this.finishDelete(report.receipt, authorizeImport, signal)
            } else await this.deps.service.keepImport(report.receipt)
            authorizeImport()
            await this.load(this.generation, this.beginReload())
          } finally {
            // Failures settle through the queue's settleFailure below: a
            // failed Delete still reloads, so the imported items left behind
            // are shown.
            this.importsInFlight -= 1
          }
          return
        }
      }
      // Retired mid-operation: the barrier owns the view, so no doomed
      // snapshot that could steal the writer from its work (RVCM1091E).
      this.authorize(generation)
      await this.load(generation, this.beginReload())
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.retire()
    this.view = { kind: 'loading', generation: this.generation }
    this.answered.clear()
    this.unsubscribe()
    this.deps.status(false)
  }
}

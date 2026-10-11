import { type VaultPanelState, vaultPanelChangeSchema } from '../../shared/vaultPanel'
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
import { UI_TEXT } from '../../shared/constants'
import type { VaultImportReport } from '../../core/vault/broker/ports'

/** C/B/P/M bind these operations to the real broker and single writer. No values cross the panel. */
export interface VaultPanelService {
  snapshot(): Promise<unknown>
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
  resetBegin(): Promise<{ resetId: string; word: string }>
  resetConfirm(resetId: string, word: string, authorize: () => void): Promise<void>
  /** Set Up Vault: the one-time code as owned bytes; nothing is written before confirmSetup. */
  setup(): Promise<{ setupId: string; code: Buffer }>
  confirmSetup(setupId: string, authorize: () => void): Promise<void>
  cancelSetup(setupId: string): Promise<void>
}
export interface VaultPanelHostDeps {
  readonly service: VaultPanelService
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
  readonly showError: (message: string) => void
  /** The per-item report (names only) and the person's Keep or Delete of the source. */
  readonly importDone: (names: readonly string[]) => Promise<'keep' | 'delete'>
  /**
   * The host's own two steps: the warning with Continue, then the typed word.
   * Resolves the typed text, or null when the person stops.
   */
  readonly confirmReset: (word: string, signal: AbortSignal) => Promise<string | null>
  /** The host's own modal with Copy and I Saved It; true only for I Saved It. */
  readonly showRecoveryCode: (code: string, signal: AbortSignal) => Promise<boolean>
}

function wipe(item: VaultItem): void {
  for (const value of Object.values(item.material)) {
    if (value instanceof Uint8Array) value.fill(0)
  }
}

/** One serialized owner. Lock and disposal synchronously invalidate every older effect. */
export class VaultPanelHost {
  private generation = 0
  private disposed = false
  private lockRequested = false
  private readonly answered = new Set<string>()
  private cancellation = new AbortController()
  // A receipt is bound to imported items, so ordinary metadata notifications
  // cannot withdraw Keep/Delete. Lock, revocation and disposal still do.
  private importAbort = new AbortController()
  private importsInFlight = 0
  private state: VaultPanelState | undefined
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
          this.refreshNow()
          return
        }
        // Metadata changes retire older native editors too: a draft finished
        // after another window's change must not restore the older policy.
        if (['locked', 'revoked', 'changed'].includes(event.kind)) {
          if (
            event.kind === 'locked' &&
            this.state !== undefined &&
            event.lockEpoch < this.state.status.lockEpoch
          )
            return
          this.retire(event.kind !== 'changed')
          if (event.kind === 'locked') this.showLocked(event.lockEpoch)
        }
        // The importing owner reloads after Keep/Delete. Starting another
        // snapshot now would compete with its writer transaction.
        if (event.kind === 'changed' && this.importsInFlight > 0) return
        void this.refresh()
      },
      () => {
        // The broker's event stream is down: say so once, never stay silent (F7).
        this.reportError(this.generation)
      },
    )
  }

  /** Late completions after disposal report nothing: there is no window left. */
  private reportError(generation: number): void {
    if (!this.disposed && generation === this.generation)
      this.deps.showError(UI_TEXT.vault.operationFailed)
  }

  private showLocked(lockEpoch?: number): void {
    this.lockRequested = true
    this.answered.clear()
    if (this.state !== undefined) {
      this.state = {
        ...this.state,
        status: {
          ...this.state.status,
          state: 'locked',
          reason: 'locked',
          lockEpoch: lockEpoch ?? this.state.status.lockEpoch,
        },
        pending: [],
      }
      this.deps.publish(vaultHostMessageSchema.parse({ type: 'vaultState', state: this.state }))
    }
    this.deps.status(false)
  }

  /** Prompt publish outside the queue; the queued editor keeps its own generation. */
  private refreshNow(): void {
    const generation = this.generation
    void this.load(generation).catch(() => {
      this.reportError(generation)
    })
  }

  private authorize(generation: number): void {
    if (this.disposed || generation !== this.generation) throw new Error(UI_TEXT.vault.useChanged)
  }

  /** One retirement path keeps Lock, revocation and disposal equivalent. */
  private retire(isBarrier: boolean): void {
    this.generation += 1
    this.cancellation.abort()
    this.cancellation = new AbortController()
    if (isBarrier) {
      this.importAbort.abort()
      this.importAbort = new AbortController()
    }
    if (isBarrier || this.importsInFlight === 0) this.queue = Promise.resolve()
  }

  private enqueue(task: (generation: number) => Promise<void>): Promise<void> {
    const generation = this.generation
    const previous = this.queue
    this.queue = (async () => {
      try {
        await previous
        this.authorize(generation)
        await task(generation)
      } catch {
        this.reportError(generation)
      }
    })()
    return this.queue
  }

  private async load(generation: number): Promise<VaultPanelState> {
    const message = vaultHostMessageSchema.parse({
      type: 'vaultState',
      state: await this.deps.service.snapshot(),
    })
    const state = message.state
    this.authorize(generation)
    if (this.lockRequested && state.status.state === 'unlocked')
      throw new Error(UI_TEXT.vault.locked)
    // An older broker epoch cannot resurrect a locked panel.
    if (this.state !== undefined && state.status.lockEpoch < this.state.status.lockEpoch) {
      throw new Error(UI_TEXT.vault.useChanged)
    }
    if (state.status.state === 'locked') this.lockRequested = false
    const pendingIds = new Set(state.pending.map((request) => request.id))
    for (const id of this.answered) if (!pendingIds.has(id)) this.answered.delete(id)
    this.state = state
    this.deps.publish(structuredClone(message))
    this.deps.status(state.status.state === 'unlocked')
    return state
  }

  refresh(): Promise<void> {
    return this.enqueue(async (generation) => {
      await this.load(generation)
    })
  }

  /** Break glass bypasses the queue; no password box or stalled snapshot may delay it. */
  async lock(): Promise<void> {
    if (this.disposed) return
    this.retire(true)
    const generation = this.generation
    this.showLocked()
    try {
      await this.deps.service.lock()
      await this.refresh()
    } catch {
      this.reportError(generation)
    }
  }

  handle(raw: unknown): Promise<void> {
    const parsed = vaultClientMessageSchema.safeParse(raw)
    if (!parsed.success || this.disposed) return Promise.resolve()
    const message = parsed.data
    if (message.type === 'vaultLock') return this.lock()
    // Revocation is also a barrier; pending edits cannot commit with older authority.
    if (message.type === 'vaultRevoke') {
      this.retire(true)
      return this.enqueue(async (generation) => {
        await this.deps.service.revoke(message.grantId)
        await this.load(generation)
      })
    }
    return this.enqueue(async (generation) => {
      if (message.type === 'vaultReady') {
        await this.load(generation)
        return
      }
      if (message.type === 'vaultReset') {
        const current = await this.load(generation)
        if (current.status.reason !== 'vaultLost') throw new Error(UI_TEXT.vault.useChanged)
        const challenge = await this.deps.service.resetBegin()
        const typed = await this.deps.confirmReset(challenge.word, this.cancellation.signal)
        if (typed !== null)
          await this.deps.service.resetConfirm(challenge.resetId, typed, () => {
            this.authorize(generation)
          })
        await this.load(this.generation)
        return
      }
      if (message.type === 'vaultSetup') {
        const current = await this.load(generation)
        if (current.status.state !== 'uncreated') throw new Error(UI_TEXT.vault.setupExists)
        const shown = await this.deps.service.setup()
        try {
          const isSaved = await this.deps.showRecoveryCode(
            shown.code.toString('ascii'),
            this.cancellation.signal,
          )
          if (isSaved) {
            try {
              this.authorize(generation)
              await this.deps.service.confirmSetup(shown.setupId, () => {
                this.authorize(generation)
              })
            } catch (error: unknown) {
              // A refused confirmation never leaves this setup waiting out its
              // window: it is withdrawn, so Set Up Vault can start again.
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
        await this.load(generation)
        return
      }
      if (message.type === 'vaultUnlock') {
        await this.deps.service.unlock(() => {
          this.authorize(generation)
        })
        this.authorize(generation)
        this.lockRequested = false
        await this.load(generation)
        return
      }
      const state = await this.load(generation)
      if (state.status.state !== 'unlocked') throw new Error(UI_TEXT.vault.locked)
      const authorize = () => {
        this.authorize(generation)
      }
      switch (message.type) {
        case 'vaultAdd':
        case 'vaultEdit': {
          const current =
            message.type === 'vaultEdit'
              ? state.items.find((item) => item.id === message.itemId)
              : undefined
          if (current === undefined && message.type === 'vaultEdit')
            throw new Error(UI_TEXT.vault.useChanged)
          const entered = await this.deps.editItem(current, this.cancellation.signal)
          if (entered === null) return
          try {
            authorize()
            if ('material' in entered) {
              const item = vaultItemSchema.parse(entered)
              if (message.type === 'vaultEdit' && item.metadata.id !== current?.id)
                throw new Error(UI_TEXT.vault.useChanged)
              await this.deps.service.write(item, authorize)
            } else {
              const item = vaultItemMetadataSchema.parse(entered)
              if (item.id !== current?.id) throw new Error(UI_TEXT.vault.useChanged)
              await this.deps.service.updateMetadata(item, authorize)
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
            request.expiresAt <= this.deps.now() ||
            request.lockEpoch !== state.status.lockEpoch
          ) {
            throw new Error(UI_TEXT.vault.approvalExpired)
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
            if (this.disposed || signal.aborted || this.lockRequested)
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
            if (choice === 'delete')
              await this.deps.service.deleteImport(report.receipt, authorizeImport, signal)
            else await this.deps.service.keepImport(report.receipt)
            authorizeImport()
            await this.load(this.generation)
          } catch (error: unknown) {
            if (generation !== this.generation && !signal.aborted) this.reportError(this.generation)
            throw error
          } finally {
            this.importsInFlight -= 1
          }
          return
        }
      }
      await this.load(generation)
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.retire(true)
    this.state = undefined
    this.answered.clear()
    this.unsubscribe()
    this.deps.status(false)
  }
}

import { type VaultPanelState, vaultPanelChangeSchema } from '../../shared/modelsPanel'
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

/** C/B/P/M bind these operations to the real broker and single writer. No values cross the panel. */
export interface VaultPanelService {
  snapshot(): Promise<unknown>
  subscribe(changed: (event: unknown) => void): () => void
  unlock(authorize: () => void): Promise<void>
  lock(): Promise<void>
  /** Invoke authorize after all awaits, immediately before the physical commit. */
  write(item: VaultItem, authorize: () => void): Promise<void>
  updateMetadata(item: VaultItemMetadata, authorize: () => void): Promise<void>
  remove(itemId: string, authorize: () => void): Promise<void>
  grant(grant: VaultGrant, authorize: () => void): Promise<void>
  revoke(grantId: string): Promise<void>
  /** B consumes the answer and delivers any ticket privately to the waiting use route. */
  answer(answer: VaultApprovalAnswer): Promise<void>
  /** M imports only the selected path; never another application's private store. */
  importFile(path: string, authorize: () => void): Promise<void>
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
  private state: VaultPanelState | undefined
  private queue = Promise.resolve()
  private readonly unsubscribe: () => void

  constructor(private readonly deps: VaultPanelHostDeps) {
    this.unsubscribe = deps.service.subscribe((raw) => {
      const parsed = vaultPanelChangeSchema.safeParse(raw)
      if (!parsed.success || this.disposed) return
      const event = parsed.data
      if (event.kind === 'locked' || event.kind === 'revoked') {
        if (
          event.kind === 'locked' &&
          this.state !== undefined &&
          event.lockEpoch < this.state.status.lockEpoch
        )
          return
        this.generation += 1
        this.cancellation.abort()
        this.cancellation = new AbortController()
        this.queue = Promise.resolve()
        if (event.kind === 'locked') {
          this.lockRequested = true
          this.answered.clear()
          if (this.state !== undefined) {
            this.state = {
              ...this.state,
              status: {
                ...this.state.status,
                state: 'locked',
                reason: 'locked',
                lockEpoch: event.lockEpoch,
              },
              pending: [],
            }
            this.deps.publish(
              vaultHostMessageSchema.parse({ type: 'vaultState', state: this.state }),
            )
          }
          this.deps.status(false)
        }
      }
      void this.refresh()
    })
  }

  private authorize(generation: number): void {
    if (this.disposed || generation !== this.generation) throw new Error(UI_TEXT.vault.useChanged)
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
        if (generation === this.generation) this.deps.showError(UI_TEXT.vault.operationFailed)
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
    this.generation += 1
    this.cancellation.abort()
    this.cancellation = new AbortController()
    this.lockRequested = true
    this.answered.clear()
    const generation = this.generation
    this.queue = Promise.resolve()
    if (this.state !== undefined) {
      this.state = {
        ...this.state,
        status: { ...this.state.status, state: 'locked', reason: 'locked' },
        pending: [],
      }
      this.deps.publish(vaultHostMessageSchema.parse({ type: 'vaultState', state: this.state }))
    }
    this.deps.status(false)
    try {
      await this.deps.service.lock()
      await this.refresh()
    } catch {
      if (generation === this.generation) this.deps.showError(UI_TEXT.vault.operationFailed)
    }
  }

  handle(raw: unknown): Promise<void> {
    const parsed = vaultClientMessageSchema.safeParse(raw)
    if (!parsed.success || this.disposed) return Promise.resolve()
    const message = parsed.data
    if (message.type === 'vaultLock') return this.lock()
    // Revocation is also a barrier; pending edits cannot commit with older authority.
    if (message.type === 'vaultRevoke') {
      this.generation += 1
      this.cancellation.abort()
      this.cancellation = new AbortController()
      this.queue = Promise.resolve()
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
          if (
            message.answer.decision === 'allowSession' &&
            (request.item.policy.mode !== 'askOncePerSession' ||
              request.requester.sessionId === null ||
              request.taint.tainted ||
              request.use.kind === 'disclosure')
          )
            throw new Error(UI_TEXT.vault.useChanged)
          authorize()
          this.answered.add(message.answer.requestId)
          await this.deps.service.answer(message.answer)
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
          await this.deps.service.importFile(message.path, authorize)
          break
        }
      }
      await this.load(generation)
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.cancellation.abort()
    this.state = undefined
    this.answered.clear()
    this.unsubscribe()
    this.deps.status(false)
  }
}

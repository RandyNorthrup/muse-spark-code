import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  VAULT_APPROVAL_TTL_MS,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../../shared/constants'
import {
  vaultApprovalAnswerSchema,
  vaultApprovalRequestSchema,
  vaultGrantSchema,
  vaultItemMetadataSchema,
  vaultItemSchema,
  vaultRequesterSchema,
  vaultTaintSchema,
  vaultTicketSchema,
  vaultUseSchema,
  type VaultApprovalAnswer,
  type VaultApprovalRequest,
  type VaultGrant,
  type VaultItemMetadata,
  type VaultRequester,
  type VaultStorePort,
  type VaultTaint,
  type VaultTicket,
  type VaultUse,
} from '../../../shared/vault'
import {
  vaultPrivateReadSchema,
  type VaultAuthenticatedPeer,
  type VaultApprovalResult,
  type VaultAuthorizationResult,
  type VaultBrokerPort,
  type VaultStatus,
} from '../../../shared/vaultProtocol'
import { vaultUseDigest } from '../useDigest'
import { isCeilingCovered, evaluateVaultPolicy, type VaultCeiling } from './policy'
import {
  type VaultBrokerDeps,
  type VaultRequesterRegistration,
  type VaultUseLifetime,
} from './ports'

type Denial = Extract<VaultApprovalResult, { kind: 'denied' }>
type Authorized = Extract<VaultApprovalResult, { kind: 'ticket' }>
interface Operation {
  request: VaultApprovalRequest
  authority: Authorized['authority']
}
function deny(reason: Denial['reason']): Denial {
  return { kind: 'denied', reason }
}
function id(): string {
  return randomBytes(VAULT_LIMITS.idBytes).toString('hex')
}
function sessionKey(requester: VaultRequester, itemId: string): string {
  return JSON.stringify([
    requester.hostId,
    requester.sessionId,
    requester.role,
    requester.workspaceId,
    requester.taskId,
    itemId,
  ])
}
function eraseMaterial(item: ReturnType<typeof vaultItemSchema.parse>): void {
  for (const value of Object.values(item.material)) if (value instanceof Uint8Array) value.fill(0)
}

/** Process-independent engine; no editor API, transport identity claims, or model approval path. */
export class VaultBroker implements VaultBrokerPort {
  private store: VaultStorePort | null = null
  private key: Buffer | null = null
  private slot: Awaited<ReturnType<VaultBrokerDeps['unlock']['unlock']>>['slot'] | null = null
  private epoch = 0
  private lastUse = 0
  private disposed = false
  private locking = false
  private readonly timer: ReturnType<typeof setInterval>
  private readonly registrations = new Map<string, VaultRequesterRegistration>()
  private readonly pending = new Map<string, VaultApprovalRequest>()
  private readonly tickets = new Map<string, Operation & { ticket: VaultTicket }>()
  private readonly sessions = new Map<string, Set<string>>()
  private readonly active = new Map<string, { operation: Operation; lifetime: VaultUseLifetime }>()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly unsubscribers: (() => void)[] = []
  readonly clock

  constructor(private readonly deps: VaultBrokerDeps) {
    this.clock = deps.clock
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.erase()
      })
    }, MILLISECONDS_PER_SECOND)
    this.timer.unref()
    this.unsubscribers.push(
      deps.epoch.subscribe((epoch) => {
        if (epoch > this.epoch)
          void this.lockTo(epoch).catch(() => {
            this.erase()
          })
      }),
    )
    if (deps.lockOnScreenLock)
      this.unsubscribers.push(
        deps.unlock.onScreenLock(() => {
          void this.lock().catch(() => {
            this.erase()
          })
        }),
      )
  }
  private async serial<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.tail
    const next = (async () => {
      try {
        await previous
      } catch {
        /* Its caller received the failure; keep the next operation live. */
      }
      return await run()
    })()
    this.tail = next
    return await next
  }
  private erase(): void {
    this.key?.fill(0)
    this.key = null
    this.store?.lock()
    this.store = null
    this.slot = null
    this.pending.clear()
    this.tickets.clear()
    this.sessions.clear()
    this.deps.audit.close()
  }
  private isStopped(): boolean {
    return this.disposed || this.locking
  }
  private async current(): Promise<boolean> {
    const epoch = await this.deps.epoch.current()
    if (epoch !== this.epoch) await this.lockTo(epoch)
    if (this.key && this.clock.now() - this.lastUse >= this.deps.idleMs) await this.lock()
    return this.key !== null && !this.disposed && !this.locking
  }
  private registered(input: VaultRequester): VaultRequesterRegistration | undefined {
    const entry = this.registrations.get(input.id)
    return entry &&
      JSON.stringify(entry.requester) === JSON.stringify(vaultRequesterSchema.parse(input))
      ? entry
      : undefined
  }
  private async record(
    request: VaultApprovalRequest,
    decision: 'allow' | 'deny' | 'ask',
    authority: 'mode' | 'grant' | 'user' | 'taint' | 'failClosed' | 'presence',
    grantId: string | null,
    outcome:
      | 'pending'
      | 'succeeded'
      | 'failed'
      | 'denied'
      | 'revoked'
      | 'locked'
      | 'expired'
      | 'unrecallable',
  ): Promise<void> {
    // Never persist raw argv, names, labels, taint text or a released value.
    await this.deps.audit.append({
      time: this.clock.now(),
      requester: vaultRequesterSchema.parse(
        JSON.parse(await this.deps.scrub(JSON.stringify(request.requester))),
      ),
      handle: await this.deps.scrub(request.item.handle),
      kind: request.use.kind,
      target: await this.deps.scrub(`${request.use.kind}:${request.digest}`),
      digest: request.digest,
      decision,
      authority,
      grantId,
      outcome,
    })
  }
  private mint(
    requester: VaultRequester,
    item: VaultItemMetadata,
    use: VaultUse,
    taint: VaultTaint,
  ): VaultApprovalRequest {
    const createdAt = this.clock.now()
    return vaultApprovalRequestSchema.parse({
      id: id(),
      requester,
      item,
      use,
      digest: vaultUseDigest(use),
      nonce: id(),
      createdAt,
      expiresAt: createdAt + VAULT_APPROVAL_TTL_MS,
      lockEpoch: this.epoch,
      taint,
    })
  }
  private async ticket(
    request: VaultApprovalRequest,
    authority: Authorized['authority'],
  ): Promise<VaultApprovalResult> {
    if (!(await this.current()) || request.lockEpoch !== this.epoch) return deny('locked')
    if (this.clock.now() >= request.expiresAt) return deny('expired')
    if (this.tickets.size >= VAULT_LIMITS.items) return deny('policy')
    if (
      authority.kind === 'grant' &&
      !(await this.deps.repository.consumeGrant(authority.grantId, this.clock.now()))
    )
      return deny('scope')
    await this.record(
      request,
      'allow',
      authority.kind,
      authority.kind === 'grant' ? authority.grantId : null,
      'pending',
    )
    if (!(await this.current())) return deny('locked')
    const ticket = vaultTicketSchema.parse({
      id: id(),
      requestId: request.id,
      requesterId: request.requester.id,
      itemId: request.item.id,
      digest: request.digest,
      nonce: request.nonce,
      issuedAt: this.clock.now(),
      expiresAt: request.expiresAt,
      lockEpoch: this.epoch,
      maxUses: 1,
    })
    this.tickets.set(ticket.id, { ticket, request, authority })
    this.lastUse = this.clock.now()
    return { kind: 'ticket', ticket: structuredClone(ticket), authority }
  }
  /** Avoid nested queue acquisition during a first agent use. */
  private async unlockOutsideQueue(slotId: string | null = null): Promise<void> {
    // Unlock runs before the queued request resumes; this uses the same single-writer helper.
    if (this.isStopped()) throw new Error(UI_TEXT.vault.locked)
    const before = await this.deps.epoch.current()
    const unlocked = await this.deps.unlock.unlock(slotId)
    const key = Buffer.alloc(VAULT_KEY_BYTES)
    try {
      if (unlocked.key.byteLength !== VAULT_KEY_BYTES) throw new Error(UI_TEXT.vault.noAccess)
      key.set(unlocked.key)
      if (before !== (await this.deps.epoch.current()) || this.isStopped())
        throw new Error(UI_TEXT.vault.locked)
      const store = await this.deps.repository.open(key)
      try {
        await this.deps.audit.open(key)
      } catch (error: unknown) {
        store.lock()
        throw error
      }
      if (before !== (await this.deps.epoch.current()) || this.isStopped()) {
        store.lock()
        throw new Error(UI_TEXT.vault.locked)
      }
      this.store = store
      this.key = key
      this.slot = unlocked.slot
      this.epoch = before
      this.lastUse = this.clock.now()
    } catch (error: unknown) {
      key.fill(0)
      this.deps.audit.close()
      throw error
    } finally {
      unlocked.key.fill(0)
    }
  }
  private async lockTo(epoch: number): Promise<void> {
    if (this.locking) return
    this.locking = true
    this.epoch = Math.max(this.epoch, epoch)
    const entries = Array.from(this.active.values(), (entry) => ({ ...entry }))
    this.active.clear()
    // Close immediately, before asynchronous process termination or audit I/O.
    for (const entry of entries) entry.lifetime.close()
    this.pending.clear()
    this.tickets.clear()
    this.sessions.clear()
    const isHadKey = this.key !== null
    this.key?.fill(0)
    this.key = null
    this.store?.lock()
    this.store = null
    this.slot = null
    try {
      for (const entry of entries) {
        const isEnded = await entry.lifetime.terminate()
        if (isHadKey)
          await this.record(
            entry.operation.request,
            'deny',
            'failClosed',
            null,
            isEnded ? 'locked' : 'unrecallable',
          )
      }
    } finally {
      this.erase()
      this.locking = false
      this.deps.onLocked(this.epoch)
    }
  }
  async unlock(slotId: string | null = null): Promise<void> {
    await this.serial(async () => {
      if (await this.current()) return
      await this.unlockOutsideQueue(slotId)
    })
  }
  async tick(): Promise<void> {
    if (!(await this.current())) return
    for (const [id, request] of this.pending)
      if (this.clock.now() >= request.expiresAt) {
        this.pending.delete(id)
        await this.record(request, 'deny', 'failClosed', null, 'expired')
      }
    for (const [id, operation] of this.tickets)
      if (this.clock.now() >= operation.ticket.expiresAt) {
        this.tickets.delete(id)
        await this.record(operation.request, 'deny', 'failClosed', null, 'expired')
      }
  }

  async status(): Promise<VaultStatus> {
    await this.current()
    const count = this.store ? await this.store.list() : []
    const state = this.key ? 'unlocked' : 'locked'
    const reason = this.key ? null : 'locked'
    return {
      state: this.deps.firstPartyOnly ? 'firstPartyOnly' : state,
      lockEpoch: this.epoch,
      tier: this.slot?.tier ?? null,
      provider: this.slot?.provider ?? null,
      silentUnlock: this.slot !== null && !['presence', 'passphrase'].includes(this.slot.tier),
      itemCount: count.length,
      reason: this.deps.firstPartyOnly ? 'brokerBlocked' : reason,
    }
  }
  async register(
    peer: VaultAuthenticatedPeer,
    input: VaultRequester,
    ceiling: VaultCeiling,
  ): Promise<void> {
    const registration = {
      requester: vaultRequesterSchema.parse(input),
      ceiling: structuredClone(ceiling),
    }
    if (
      !peer.ui ||
      peer.hostId !== registration.requester.hostId ||
      !(await this.deps.identity.verifyHost(peer)) ||
      !(await this.deps.identity.verifyLaunched(peer, registration)) ||
      this.registrations.has(input.id) ||
      this.registrations.size >= VAULT_LIMITS.items
    )
      throw new Error(UI_TEXT.vault.noAccess)
    this.registrations.set(registration.requester.id, registration)
  }
  async list(requester: VaultRequester): Promise<readonly VaultItemMetadata[]> {
    const registration = this.registered(requester)
    if (!registration || !(await this.current()) || this.deps.firstPartyOnly || !this.store)
      return []
    const items = await this.store.list()
    return items
      .map((item) => vaultItemMetadataSchema.parse(item))
      .filter(
        (item) =>
          !item.hidden &&
          !item.firstParty &&
          !['internal', 'devicePair'].includes(item.kind) &&
          isCeilingCovered(registration.ceiling, item.handle),
      )
  }
  async request(
    requester: VaultRequester,
    handle: string,
    input: VaultUse,
    inputTaint: VaultTaint,
  ): Promise<VaultAuthorizationResult> {
    const use = vaultUseSchema.parse(input)
    const taint = vaultTaintSchema.parse(inputTaint)
    const identity = vaultRequesterSchema.parse(requester)
    return await this.serial(async () => {
      if (this.deps.firstPartyOnly) return deny('firstPartyOnly')
      const registration = this.registered(identity)
      if (!registration) return deny('peer')
      if (!(await this.current())) await this.unlockOutsideQueue()
      if (!this.store) return deny('locked')
      const metadata = await this.store.list()
      const item = metadata
        .map((item) => vaultItemMetadataSchema.parse(item))
        .find((item) => item.handle === handle)
      if (!item) return deny('scope')
      const request = this.mint(identity, item, use, taint)
      const heldGrants = await this.deps.repository.grants()
      const grants = heldGrants.map((grant) => vaultGrantSchema.parse(grant))
      const decision = evaluateVaultPolicy(
        item,
        identity,
        use,
        taint,
        grants,
        registration.ceiling,
        this.clock.now(),
        this.sessions.get(sessionKey(identity, item.id)) ?? new Set(),
      )
      if (decision.kind === 'denied') {
        await this.record(request, 'deny', 'failClosed', null, 'denied')
        return decision
      }
      if (decision.kind === 'allow')
        return await this.ticket(
          request,
          decision.grant ? { kind: 'grant', grantId: decision.grant.id } : { kind: 'mode' },
        )
      if (this.pending.size >= VAULT_LIMITS.items) return deny('policy')
      await this.record(request, 'ask', taint.tainted ? 'taint' : 'user', null, 'pending')
      this.pending.set(request.id, request)
      this.deps.onApproval(structuredClone(request))
      return { kind: 'approval', request: structuredClone(request) }
    })
  }
  async answer(
    peer: VaultAuthenticatedPeer,
    input: VaultApprovalAnswer,
  ): Promise<VaultApprovalResult> {
    const answer = vaultApprovalAnswerSchema.parse(input)
    return await this.serial(async () => {
      const request = this.pending.get(answer.requestId)
      if (!request) return deny('replay')
      if (
        !peer.ui ||
        peer.hostId !== request.requester.hostId ||
        !(await this.deps.identity.verifyHost(peer))
      ) {
        await this.record(request, 'deny', 'failClosed', null, 'denied')
        return deny('peer')
      }
      if (!(await this.current()) || request.lockEpoch !== this.epoch) return deny('locked')
      if (answer.digest !== request.digest) {
        await this.record(request, 'deny', 'failClosed', null, 'denied')
        return deny('digest')
      }
      this.pending.delete(request.id)
      if (this.clock.now() >= request.expiresAt) {
        await this.record(request, 'deny', 'failClosed', null, 'expired')
        return deny('expired')
      }
      if (answer.decision === 'deny') {
        await this.record(request, 'deny', 'user', null, 'denied')
        return deny('policy')
      }
      const registration = this.registrations.get(request.requester.id)
      const metadata = await this.store?.list()
      const item = metadata?.find((item) => item.id === request.item.id)
      if (!registration || !item || JSON.stringify(item) !== JSON.stringify(request.item))
        return deny('policy')
      if (answer.decision === 'allowSession') {
        if (
          item.policy.mode !== 'askOncePerSession' ||
          request.requester.sessionId === null ||
          request.taint.tainted ||
          request.use.kind === 'disclosure'
        )
          return deny('policy')
        const key = sessionKey(request.requester, item.id)
        const digests = this.sessions.get(key) ?? new Set<string>()
        digests.add(request.digest)
        this.sessions.set(key, digests)
      }
      return await this.ticket(request, { kind: 'user' })
    })
  }
  async redeem(
    requesterId: string,
    input: VaultTicket,
    actualInput: VaultUse,
    lifetime: VaultUseLifetime,
  ): Promise<VaultApprovalResult> {
    const ticket = vaultTicketSchema.parse(input)
    const actual = vaultUseSchema.parse(actualInput)
    return await this.serial(async () => {
      const operation = this.tickets.get(ticket.id)
      if (!operation) return deny('replay')
      if (
        requesterId !== operation.ticket.requesterId ||
        JSON.stringify(ticket) !== JSON.stringify(operation.ticket)
      )
        return deny('peer')
      this.tickets.delete(ticket.id)
      if (!(await this.current()) || ticket.lockEpoch !== this.epoch) return deny('locked')
      if (this.clock.now() >= ticket.expiresAt) {
        await this.record(operation.request, 'deny', 'failClosed', null, 'expired')
        return deny('expired')
      }
      if (vaultUseDigest(actual) !== ticket.digest) {
        await this.record(operation.request, 'deny', 'failClosed', null, 'denied')
        return deny('digest')
      }
      const metadata = await this.store?.list()
      const current = metadata?.find((item) => item.id === ticket.itemId)
      if (
        !current ||
        JSON.stringify(current) !== JSON.stringify(operation.request.item) ||
        !this.registrations.has(requesterId)
      )
        return deny('policy')
      this.active.set(ticket.id, { operation, lifetime })
      if (current.requirePresence && !(await this.deps.unlock.presence(current.id, id(), actual))) {
        await this.record(operation.request, 'deny', 'presence', null, 'denied')
        this.active.delete(ticket.id)
        return deny('presence')
      }
      if (
        !(await this.current()) ||
        ticket.lockEpoch !== this.epoch ||
        !this.registrations.has(requesterId) ||
        !this.active.has(ticket.id)
      ) {
        this.active.delete(ticket.id)
        return deny('locked')
      }
      await this.record(
        operation.request,
        'allow',
        operation.authority.kind,
        operation.authority.kind === 'grant' ? operation.authority.grantId : null,
        'succeeded',
      )
      if (!(await this.current())) return deny('locked')
      this.lastUse = this.clock.now()
      return { kind: 'ticket', ticket: structuredClone(ticket), authority: operation.authority }
    })
  }
  async finish(ticketId: string, hasSucceeded: boolean): Promise<void> {
    const entry = this.active.get(ticketId)
    if (!entry) return
    this.active.delete(ticketId)
    await this.record(
      entry.operation.request,
      'allow',
      entry.operation.authority.kind,
      entry.operation.authority.kind === 'grant' ? entry.operation.authority.grantId : null,
      hasSucceeded ? 'succeeded' : 'failed',
    )
  }
  async grant(peer: VaultAuthenticatedPeer, input: VaultGrant): Promise<void> {
    if (!peer.ui || !(await this.deps.identity.verifyHost(peer)) || !(await this.current()))
      throw new Error(UI_TEXT.vault.noAccess)
    const grant = vaultGrantSchema.parse(input)
    const existingGrants = await this.deps.repository.grants()
    if (
      grant.uses !== 0 ||
      grant.sessionId !== null ||
      existingGrants.some((existing) => existing.id === grant.id)
    )
      throw new Error(UI_TEXT.vault.noAccess)
    await this.deps.repository.saveGrant(grant)
  }
  async revoke(peer: VaultAuthenticatedPeer, grantId: string): Promise<void> {
    if (!peer.ui || !(await this.deps.identity.verifyHost(peer)) || !(await this.current()))
      throw new Error(UI_TEXT.vault.noAccess)
    await this.deps.repository.removeGrant(grantId)
    const requesters = new Set<string>()
    for (const operation of [
      ...this.tickets.values(),
      ...Array.from(this.active.values(), (entry) => entry.operation),
    ])
      if (operation.authority.kind === 'grant' && operation.authority.grantId === grantId)
        requesters.add(operation.request.requester.id)
    // Pending approvals for the same item must also be invalidated.
    for (const request of this.pending.values()) requesters.add(request.requester.id)
    for (const requesterId of requesters) await this.endRequester(requesterId, grantId)
  }
  async endRequester(requesterId: string, grantId: string | null = null): Promise<void> {
    const requester = this.registrations.get(requesterId)?.requester
    this.registrations.delete(requesterId)
    for (const [id, request] of this.pending)
      if (request.requester.id === requesterId) this.pending.delete(id)
    for (const [id, operation] of this.tickets)
      if (operation.request.requester.id === requesterId) this.tickets.delete(id)
    if (requester)
      for (const key of this.sessions.keys())
        if (key.startsWith(JSON.stringify([requester.hostId, requester.sessionId]).slice(0, -1)))
          this.sessions.delete(key)
    for (const [id, entry] of this.active)
      if (entry.operation.request.requester.id === requesterId) {
        this.active.delete(id)
        entry.lifetime.close()
        const isEnded = await entry.lifetime.terminate()
        await this.record(
          entry.operation.request,
          'deny',
          'failClosed',
          grantId,
          isEnded ? 'revoked' : 'unrecallable',
        )
      }
    this.deps.onRevoked(requesterId, grantId)
  }
  async policyChanged(itemId: string): Promise<void> {
    const affected = new Set<string>()
    for (const entry of [
      ...this.pending.values(),
      ...Array.from(this.tickets.values(), (entry) => entry.request),
      ...Array.from(this.active.values(), (entry) => entry.operation.request),
    ])
      if (entry.item.id === itemId) affected.add(entry.requester.id)
    this.sessions.clear()
    for (const requesterId of affected) await this.endRequester(requesterId)
  }
  async lock(): Promise<void> {
    await this.lockTo(await this.deps.epoch.bump())
  }
  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.timer)
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    await this.lock()
  }
  async firstPartyRead(peer: VaultAuthenticatedPeer, input: unknown): Promise<Buffer> {
    if (!peer.ui || !(await this.deps.identity.verifyHost(peer)))
      throw new Error(UI_TEXT.vault.noAccess)
    const request = vaultPrivateReadSchema.parse(input)
    if (!(await this.current())) await this.unlock()
    const item = vaultItemSchema.parse(await this.store?.read(request.itemId))
    try {
      if (
        !item.metadata.firstParty ||
        !item.metadata.hidden ||
        item.material.kind !== 'apiKey' ||
        item.material.origin !== request.origin ||
        item.metadata.bindings.every(
          (binding) => !(binding.kind === 'origin' && binding.origin === request.origin),
        )
      )
        throw new Error(UI_TEXT.vault.noAccess)
      const owned = Buffer.alloc(item.material.value.byteLength)
      owned.set(item.material.value)
      this.lastUse = this.clock.now()
      return owned
    } finally {
      eraseMaterial(item)
    }
  }
}

export function isVaultBootTokenMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'hex'),
    b = Buffer.from(actual, 'hex')
  return a.length === VAULT_LIMITS.idBytes && b.length === a.length && timingSafeEqual(a, b)
}

import { VaultBrokerQueue } from './queue'
import * as z from 'zod/mini'
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
  vaultSlotRecordSchema,
  type VaultItem,
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
import { isCeilingCovered, evaluateVaultPolicy, isGrantCovered, type VaultCeiling } from './policy'
import {
  type VaultBrokerDeps,
  type VaultRequesterRegistration,
  type VaultUseLifetime,
} from './ports'

type Denial = Extract<VaultApprovalResult, { kind: 'denied' }>
type Authorized = Extract<VaultApprovalResult, { kind: 'ticket' }>
const changeSchema = z.strictObject({
  kind: z.enum(['item', 'grant']),
  id: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
})
interface Operation {
  ticket: VaultTicket
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
  private lockTask: Promise<void> | null = null
  private opening: { source: Uint8Array; key: Buffer; store: VaultStorePort | null } | null = null
  private readonly grantItems = new Map<string, string>()
  private readonly revokedGrants = new Set<string>()
  private readonly timer: ReturnType<typeof setInterval>
  private readonly registrations = new Map<string, VaultRequesterRegistration>()
  private readonly invalidations = new Set<(requesterId: string | null) => void>()
  private readonly pending = new Map<string, VaultApprovalRequest>()
  private readonly tickets = new Map<string, Operation>()
  private readonly sessions = new Map<string, Set<string>>()
  private readonly privateReads = new Set<VaultItem>()
  private readonly active = new Map<
    string,
    {
      operation: Operation
      lifetime: VaultUseLifetime
      material: VaultItem | null
      released: boolean
    }
  >()
  private readonly queue = new VaultBrokerQueue()
  private readonly unsubscribers: (() => void)[] = []
  readonly clock

  constructor(private readonly deps: VaultBrokerDeps) {
    this.clock = deps.clock
    this.unsubscribers.push(
      deps.repository.subscribe((input) => {
        void (async () => {
          try {
            const change = changeSchema.parse(input)
            if (change.kind === 'item') await this.policyChanged(change.id)
            else await this.invalidateGrant(change.id)
          } catch {
            this.erase() /* Invalid repository events fail closed without forwarding their text. */
          }
        })()
      }),
    )
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
  private get generation(): number {
    return this.queue.generation
  }
  private eraseOpening(): void {
    this.opening?.source.fill(0)
    this.opening?.key.fill(0)
    this.opening?.store?.lock()
  }
  private erase(): void {
    this.queue.invalidate(() => {
      this.eraseOpening()
      for (const item of this.privateReads) eraseMaterial(item)
      this.privateReads.clear()
      for (const entry of this.active.values()) {
        if (entry.material) eraseMaterial(entry.material)
        entry.lifetime.close()
        void entry.lifetime.terminate().catch(() => {
          /* The closed feeder channel is authoritative; unavailable process termination cannot restore access. */
        })
      }
      this.active.clear()
      this.key?.fill(0)
      this.key = null
      this.store?.lock()
      this.store = null
      this.slot = null
      this.pending.clear()
      this.tickets.clear()
      this.sessions.clear()
      this.deps.audit.close()
      for (const listener of this.invalidations) listener(null)
    }, true)
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
    request: Pick<VaultApprovalRequest, 'requester' | 'use' | 'digest'> & {
      item: Pick<VaultItemMetadata, 'handle'>
    },
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
  /** Return the check itself: callers revalidate in their continuation's own turn,
   * with no promise gap between checking authority and committing/releasing it. */
  private async validate(
    generation: number,
    request?: VaultApprovalRequest,
    authority?: Authorized['authority'],
    isConsumed = false,
    item?: VaultItemMetadata,
    openingEpoch?: number | null,
  ): Promise<() => Denial['reason'] | null> {
    const held: { grant?: VaultGrant; isLoaded: boolean } = { isLoaded: false }
    const check = (): Denial['reason'] | null => {
      if (
        generation !== this.generation ||
        this.isStopped() ||
        (openingEpoch === undefined && !this.key) ||
        (request && request.lockEpoch !== this.epoch)
      )
        return 'locked'
      if (
        item?.dates.expiresAt !== null &&
        item?.dates.expiresAt !== undefined &&
        this.clock.now() >= item.dates.expiresAt
      )
        return 'expired'
      if (!request) return null
      if (!this.registered(request.requester)) return 'peer'
      if (
        this.clock.now() >= request.expiresAt ||
        (request.item.dates.expiresAt !== null && this.clock.now() >= request.item.dates.expiresAt)
      )
        return 'expired'
      if (item && JSON.stringify(item) !== JSON.stringify(request.item)) return 'policy'
      if (authority?.kind === 'grant') {
        if (this.revokedGrants.has(authority.grantId)) return 'scope'
        if (
          held.isLoaded &&
          (!held.grant ||
            !isGrantCovered(
              isConsumed ? { ...held.grant, uses: Math.max(0, held.grant.uses - 1) } : held.grant,
              request.item,
              request.requester,
              request.use,
              this.clock.now(),
            ))
        )
          return 'scope'
      }
      return null
    }
    if (check()) return check
    if (openingEpoch !== undefined) {
      const epoch = await this.deps.epoch.current()
      return openingEpoch !== null && epoch !== openingEpoch ? () => 'locked' : check
    }
    if (!(await this.current())) return () => 'locked'
    if (!request || authority?.kind !== 'grant' || check()) return check
    const grants = await this.deps.repository.grants()
    if (check()) return check
    const parsed = grants.map((entry) => vaultGrantSchema.parse(entry))
    for (const entry of parsed) this.grantItems.set(entry.id, entry.itemId)
    const grant = parsed.find((entry) => entry.id === authority.grantId)
    if (grant) held.grant = grant
    held.isLoaded = true
    return check
  }
  private async denied(
    request: VaultApprovalRequest,
    reason: Denial['reason'],
    grantId: string | null = null,
  ): Promise<Denial> {
    const outcome = reason === 'expired' || reason === 'locked' ? reason : 'denied'
    if (this.key && !this.locking)
      await this.record(request, 'deny', 'failClosed', grantId, outcome)
    return deny(reason)
  }
  private async ticket(
    request: VaultApprovalRequest,
    authority: Authorized['authority'],
    generation: number,
  ): Promise<VaultApprovalResult> {
    let reason = (await this.validate(generation, request, authority))()
    if (reason) return await this.denied(request, reason)
    if (this.tickets.size >= VAULT_LIMITS.items) return await this.denied(request, 'policy')
    if (authority.kind === 'grant') {
      const isConsumed = await this.deps.repository.consumeGrant(
        authority.grantId,
        this.clock.now(),
      )
      reason = (await this.validate(generation, request, authority, isConsumed))()
      if (!isConsumed || reason)
        return await this.denied(request, reason ?? 'scope', authority.grantId)
    }
    await this.record(
      request,
      'allow',
      authority.kind,
      authority.kind === 'grant' ? authority.grantId : null,
      'pending',
    )
    reason = (await this.validate(generation, request, authority, true))()
    if (reason) return await this.denied(request, reason)
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
  private async unlockOutsideQueue(
    slotId: string | null = null,
    generation = this.generation,
  ): Promise<void> {
    const validate = async (epoch: number | null): Promise<() => void> => {
      const check = await this.validate(generation, undefined, undefined, false, undefined, epoch)
      return () => {
        if (check()) throw new Error(UI_TEXT.vault.locked)
      }
    }
    let check = await validate(null)
    check()
    const before = await this.deps.epoch.current()
    check = await validate(before)
    check()
    const unlocked = await this.deps.unlock.unlock(slotId)
    const opening: NonNullable<VaultBroker['opening']> = {
      source: unlocked.key,
      key: Buffer.alloc(VAULT_KEY_BYTES),
      store: null,
    }
    this.opening = opening
    try {
      check = await validate(before)
      check()
      if (unlocked.key.byteLength !== VAULT_KEY_BYTES) throw new Error(UI_TEXT.vault.noAccess)
      opening.key.set(unlocked.key)
      unlocked.key.fill(0)
      const slot = vaultSlotRecordSchema.parse(unlocked.slot)
      opening.store = await this.deps.repository.open(opening.key)
      check = await validate(before)
      check()
      await this.deps.audit.open(opening.key)
      check = await validate(before)
      check()
      this.store = opening.store
      this.key = opening.key
      this.slot = slot
      this.epoch = before
      this.lastUse = this.clock.now()
    } catch (error: unknown) {
      opening.key.fill(0)
      opening.store?.lock()
      this.deps.audit.close()
      throw error
    } finally {
      unlocked.key.fill(0)
      if (this.opening === opening) this.opening = null
    }
  }
  private lockTo(epoch: number, shouldBump = false): Promise<void> {
    if (this.lockTask) return this.lockTask
    const snapshot = this.queue.invalidate(() => {
      this.locking = true
      this.epoch = Math.max(this.epoch, epoch)
      const active = Array.from(this.active.values(), (entry) => ({ ...entry }))
      const pending = [
        ...this.pending.values(),
        ...Array.from(this.tickets.values(), (entry) => entry.request),
      ]
      const hasKey = this.key !== null
      this.active.clear()
      this.pending.clear()
      this.tickets.clear()
      this.sessions.clear()
      this.eraseOpening()
      for (const item of this.privateReads) eraseMaterial(item)
      this.privateReads.clear()
      for (const entry of active) {
        entry.lifetime.close()
        if (entry.material) eraseMaterial(entry.material)
      }
      this.key?.fill(0)
      this.key = null
      this.store?.lock()
      this.store = null
      this.slot = null
      for (const listener of this.invalidations) listener(null)
      return { active, pending, hasKey }
    }, true)
    const task = (async () => {
      try {
        const settled = await Promise.allSettled([
          ...snapshot.active.map(async (entry) => {
            let isEnded = false
            try {
              isEnded = await entry.lifetime.terminate()
            } catch {
              /* Audit retained liability. */
            }
            if (snapshot.hasKey)
              await this.record(
                entry.operation.request,
                'deny',
                'failClosed',
                null,
                isEnded ? 'locked' : 'unrecallable',
              )
          }),
          ...snapshot.pending.map((request) =>
            this.record(request, 'deny', 'failClosed', null, 'locked'),
          ),
          ...(shouldBump
            ? [
                (async () => {
                  const value = await this.deps.epoch.bump()
                  this.epoch = Math.max(this.epoch, value)
                })(),
              ]
            : []),
        ])
        const failed = settled.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      } finally {
        this.deps.audit.close()
        this.locking = false
        this.lockTask = null
        this.deps.onLocked(this.epoch)
      }
    })()
    this.lockTask = task
    return task
  }
  private requestersForItem(itemId: string | undefined): Set<string> {
    const affected = new Set<string>()
    for (const request of [
      ...this.pending.values(),
      ...Array.from(this.tickets.values(), (entry) => entry.request),
      ...Array.from(this.active.values(), (entry) => entry.operation.request),
    ])
      if (request.item.id === itemId) affected.add(request.requester.id)
    return affected
  }
  private async invalidateGrant(grantId: string): Promise<void> {
    this.queue.invalidate(() => {
      this.revokedGrants.add(grantId)
    })
    const affected = this.requestersForItem(this.grantItems.get(grantId))
    await Promise.all(
      Array.from(affected, (requesterId) => this.endRequester(requesterId, grantId)),
    )
  }
  async unlock(slotId: string | null = null): Promise<void> {
    const generation = this.generation
    await this.queue.run(async () => {
      if (await this.current()) return
      await this.unlockOutsideQueue(slotId, generation)
    })
  }
  /** The local channel closes worker sockets immediately; hosts still receive their UI callbacks. */
  subscribeInvalidation(listener: (requesterId: string | null) => void): () => void {
    this.invalidations.add(listener)
    return () => {
      this.invalidations.delete(listener)
    }
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
    const generation = this.generation
    const use = vaultUseSchema.parse(input)
    const taint = vaultTaintSchema.parse(inputTaint)
    const identity = vaultRequesterSchema.parse(requester)
    return await this.queue.run(async () => {
      const denial = async (reason: Denial['reason']): Promise<Denial> => {
        if (this.key)
          await this.record(
            { requester: identity, item: { handle }, use, digest: vaultUseDigest(use) },
            'deny',
            'failClosed',
            null,
            'denied',
          )
        return deny(reason)
      }
      if (this.deps.firstPartyOnly) return await denial('firstPartyOnly')
      const registration = this.registered(identity)
      if (!registration) return await denial('peer')
      if (!(await this.current())) {
        try {
          await this.unlockOutsideQueue(null, generation)
        } catch {
          return await denial('locked')
        }
      }
      if (!this.store || (await this.validate(generation))()) return deny('locked')
      const metadata = await this.store.list()
      if ((await this.validate(generation))()) return deny('locked')
      if (!this.registered(identity)) return deny('peer')
      const item = metadata
        .map((item) => vaultItemMetadataSchema.parse(item))
        .find((item) => item.handle === handle)
      if (!item) return await denial('scope')
      const request = this.mint(identity, item, use, taint)
      const heldGrants = await this.deps.repository.grants()
      const invalid = (await this.validate(generation, request))()
      if (invalid) return await this.denied(request, invalid)
      const grants = heldGrants.map((grant) => vaultGrantSchema.parse(grant))
      for (const grant of grants) this.grantItems.set(grant.id, grant.itemId)
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
          generation,
        )
      if (this.pending.size >= VAULT_LIMITS.items) {
        await this.record(request, 'deny', 'failClosed', null, 'denied')
        return deny('policy')
      }
      await this.record(request, 'ask', taint.tainted ? 'taint' : 'user', null, 'pending')
      const reason = (await this.validate(generation, request))()
      if (reason) return await this.denied(request, reason)
      this.pending.set(request.id, request)
      this.deps.onApproval(structuredClone(request))
      return { kind: 'approval', request: structuredClone(request) }
    })
  }
  async answer(
    peer: VaultAuthenticatedPeer,
    input: VaultApprovalAnswer,
  ): Promise<VaultApprovalResult> {
    const generation = this.generation
    const answer = vaultApprovalAnswerSchema.parse(input)
    return await this.queue.run(async () => {
      const request = this.pending.get(answer.requestId)
      if (!request) return deny('replay')
      if (
        !peer.ui ||
        peer.hostId !== request.requester.hostId ||
        !(await this.deps.identity.verifyHost(peer))
      )
        return await this.denied(request, 'peer')
      let reason = (await this.validate(generation, request))()
      if (reason) {
        this.pending.delete(request.id)
        return await this.denied(request, reason)
      }
      if (answer.digest !== request.digest) return await this.denied(request, 'digest')
      if (answer.decision === 'deny') {
        this.pending.delete(request.id)
        await this.record(request, 'deny', 'user', null, 'denied')
        return deny('policy')
      }
      const metadata = await this.store?.list()
      const item = metadata?.find((item) => item.id === request.item.id)
      reason = (await this.validate(generation, request, undefined, false, item))()
      if (!item || this.pending.get(request.id) !== request) reason ??= 'policy'
      if (reason) {
        this.pending.delete(request.id)
        return await this.denied(request, reason)
      }
      if (
        answer.decision === 'allowSession' &&
        (request.item.policy.mode !== 'askOncePerSession' ||
          request.requester.sessionId === null ||
          request.taint.tainted ||
          request.use.kind === 'disclosure')
      ) {
        this.pending.delete(request.id)
        return await this.denied(request, 'policy')
      }
      const result = await this.ticket(request, { kind: 'user' }, generation)
      this.pending.delete(request.id)
      if (result.kind === 'ticket') {
        const invalid = (await this.validate(generation, request))()
        if (invalid || !this.tickets.has(result.ticket.id)) {
          this.tickets.delete(result.ticket.id)
          return await this.denied(request, invalid ?? 'policy')
        }
      }
      if (result.kind === 'ticket' && answer.decision === 'allowSession') {
        const key = sessionKey(request.requester, request.item.id)
        const digests = this.sessions.get(key) ?? new Set<string>()
        digests.add(request.digest)
        this.sessions.set(key, digests)
      }
      return result
    })
  }
  async redeem(
    requesterId: string,
    input: VaultTicket,
    actualInput: VaultUse,
    lifetime: VaultUseLifetime,
  ): Promise<VaultApprovalResult> {
    const generation = this.generation
    const ticket = vaultTicketSchema.parse(input),
      actual = vaultUseSchema.parse(actualInput)
    return await this.queue.run(async () => {
      const operation = this.tickets.get(ticket.id)
      if (!operation) return deny('replay')
      if (
        requesterId !== operation.ticket.requesterId ||
        JSON.stringify(ticket) !== JSON.stringify(operation.ticket)
      )
        return deny('peer')
      let isAdmitted = false
      try {
        let reason = (
          await this.validate(generation, operation.request, operation.authority, true)
        )()
        if (reason) return await this.denied(operation.request, reason)
        if (vaultUseDigest(actual) !== ticket.digest)
          return await this.denied(operation.request, 'digest')
        const metadata = await this.store?.list(),
          item = metadata?.find((item) => item.id === ticket.itemId)
        reason = (
          await this.validate(generation, operation.request, operation.authority, true, item)
        )()
        if (reason || !item || this.tickets.get(ticket.id) !== operation)
          return await this.denied(operation.request, reason ?? 'policy')
        this.active.set(ticket.id, { operation, lifetime, material: null, released: false })
        if (item.requirePresence || actual.kind === 'disclosure') {
          const isPresent = await this.deps.unlock.presence(item.id, id(), actual)
          reason = (await this.validate(generation, operation.request, operation.authority, true))()
          if (reason || !isPresent)
            return await this.denied(operation.request, reason ?? 'presence')
        }
        if (!this.active.has(ticket.id)) return await this.denied(operation.request, 'policy')
        await this.record(
          operation.request,
          'allow',
          operation.authority.kind,
          operation.authority.kind === 'grant' ? operation.authority.grantId : null,
          'pending',
        )
        reason = (await this.validate(generation, operation.request, operation.authority, true))()
        if (reason || !this.active.has(ticket.id))
          return await this.denied(operation.request, reason ?? 'policy')
        this.lastUse = this.clock.now()
        isAdmitted = true
        return { kind: 'ticket', ticket: structuredClone(ticket), authority: operation.authority }
      } finally {
        this.tickets.delete(ticket.id)
        if (!isAdmitted) this.active.delete(ticket.id)
      }
    })
  }
  /** S/X/L/O execute inside the broker; only their approved destination may receive selected bytes. */
  async withApprovedMaterial(
    ticketId: string,
    requesterId: string,
    actualInput: VaultUse,
    run: (item: VaultItem) => Promise<void>,
  ): Promise<void> {
    const actual = vaultUseSchema.parse(actualInput),
      entry = this.active.get(ticketId)
    if (
      entry?.operation.request.requester.id !== requesterId ||
      vaultUseDigest(actual) !== entry.operation.request.digest ||
      entry.released
    )
      throw new Error(UI_TEXT.vault.noAccess)
    const generation = this.generation
    entry.released = true
    const validate = async (metadata?: VaultItemMetadata): Promise<() => void> => {
      const check = await this.validate(
        generation,
        entry.operation.request,
        entry.operation.authority,
        true,
        metadata,
      )
      return () => {
        if (check() || this.active.get(ticketId) !== entry) throw new Error(UI_TEXT.vault.noAccess)
      }
    }
    let check = await validate()
    check()
    const item = vaultItemSchema.parse(await this.store?.read(entry.operation.request.item.id))
    entry.material = item
    try {
      check = await validate(item.metadata)
      check()
      await run(item)
      check = await validate()
      check()
    } finally {
      eraseMaterial(item)
      entry.material = null
    }
  }
  async finish(ticketId: string, hasSucceeded: boolean): Promise<void> {
    const entry = this.active.get(ticketId)
    if (!entry) return
    this.active.delete(ticketId)
    if (entry.material) eraseMaterial(entry.material)
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
    if (grant.uses !== 0 || existingGrants.some((existing) => existing.id === grant.id))
      throw new Error(UI_TEXT.vault.noAccess)
    await this.deps.repository.saveGrant(grant)
  }
  async revoke(peer: VaultAuthenticatedPeer, grantId: string): Promise<void> {
    const generation = this.generation
    if (
      !peer.ui ||
      !(await this.deps.identity.verifyHost(peer)) ||
      (await this.validate(generation))()
    )
      throw new Error(UI_TEXT.vault.noAccess)
    this.queue.invalidate(() => {
      this.revokedGrants.add(grantId)
    })
    let itemId = this.grantItems.get(grantId)
    if (!itemId) {
      const grants = await this.deps.repository.grants()
      if ((await this.validate(generation))()) throw new Error(UI_TEXT.vault.locked)
      itemId = grants.find((entry) => entry.id === grantId)?.itemId
    }
    const affected = this.requestersForItem(itemId)
    const cleanup = Array.from(affected, (requesterId) => this.endRequester(requesterId, grantId))
    const settled = await Promise.allSettled([
      ...cleanup,
      this.deps.repository.removeGrant(grantId),
    ])
    const failed = settled.find((entry) => entry.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
  async endRequester(requesterId: string, grantId: string | null = null): Promise<void> {
    const snapshot = this.queue.invalidate(() => {
      const requester = this.registrations.get(requesterId)?.requester
      this.registrations.delete(requesterId)
      const pending: VaultApprovalRequest[] = []
      for (const [id, request] of this.pending)
        if (request.requester.id === requesterId) {
          pending.push(request)
          this.pending.delete(id)
        }
      for (const [id, operation] of this.tickets)
        if (operation.request.requester.id === requesterId) {
          pending.push(operation.request)
          this.tickets.delete(id)
        }
      if (requester)
        for (const key of this.sessions.keys())
          if (key.startsWith(JSON.stringify([requester.hostId, requester.sessionId]).slice(0, -1)))
            this.sessions.delete(key)
      const active = []
      for (const [id, entry] of this.active)
        if (entry.operation.request.requester.id === requesterId) {
          this.active.delete(id)
          entry.lifetime.close()
          if (entry.material) eraseMaterial(entry.material)
          active.push(entry)
        }
      for (const listener of this.invalidations) listener(requesterId)
      this.deps.onRevoked(requesterId, grantId)
      return { active, pending }
    })
    const settled = await Promise.allSettled([
      ...snapshot.pending.map((request) =>
        this.record(request, 'deny', 'failClosed', grantId, 'revoked'),
      ),
      ...snapshot.active.map(async (entry) => {
        let isEnded = false
        try {
          isEnded = await entry.lifetime.terminate()
        } catch {
          /* Audit retained liability and continue every entry. */
        }
        await this.record(
          entry.operation.request,
          'deny',
          'failClosed',
          grantId,
          isEnded ? 'revoked' : 'unrecallable',
        )
      }),
    ])
    const failed = settled.find((entry) => entry.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
  async policyChanged(itemId: string): Promise<void> {
    for (const item of this.privateReads)
      if (item.metadata.id === itemId) {
        eraseMaterial(item)
        this.privateReads.delete(item)
      }
    const affected = this.requestersForItem(itemId)
    this.sessions.clear()
    await Promise.all(Array.from(affected, (requesterId) => this.endRequester(requesterId)))
  }
  async lock(): Promise<void> {
    await this.lockTo(this.epoch, true)
  }
  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.timer)
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    await this.lock()
    this.invalidations.clear()
  }
  async firstPartyRead(
    peer: VaultAuthenticatedPeer,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const generation = this.generation
    let item: VaultItem | null = null
    let stopWaiting: (() => void) | null = null
    const wait = async <T>(operation: Promise<T>): Promise<T> => {
      if (!signal) return await operation
      const cancelled = new Promise<never>((_resolve, reject) => {
        stopWaiting = () => {
          reject(new Error(UI_TEXT.vault.noAccess))
        }
      })
      if (signal.aborted) stopWaiting?.()
      try {
        return await Promise.race([operation, cancelled])
      } finally {
        stopWaiting = null
      }
    }
    const cancel = (): void => {
      stopWaiting?.()
      if (!item) {
        return
      }

      eraseMaterial(item)
      this.privateReads.delete(item)
    }
    const validate = async (): Promise<() => void> => {
      const check = await this.validate(generation, undefined, undefined, false, item?.metadata)
      return () => {
        if (check() || signal?.aborted || (item && !this.privateReads.has(item)))
          throw new Error(UI_TEXT.vault.locked)
      }
    }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      if (
        !peer.ui ||
        !(await wait(this.deps.identity.verifyHost(peer))) ||
        signal?.aborted ||
        generation !== this.generation
      )
        throw new Error(UI_TEXT.vault.noAccess)
      const request = vaultPrivateReadSchema.parse(input)
      if (!(await wait(this.current()))) {
        if (signal?.aborted || generation !== this.generation) throw new Error(UI_TEXT.vault.locked)
        await wait(this.unlock())
      }
      let check = await wait(validate())
      check()
      const store = this.store
      if (!store) throw new Error(UI_TEXT.vault.locked)
      item = await wait(
        (async () => {
          const result = vaultItemSchema.parse(await store.read(request.itemId))
          item = result
          this.privateReads.add(result)
          if (signal?.aborted) {
            cancel()
            throw new Error(UI_TEXT.vault.noAccess)
          }
          return result
        })(),
      )
      check = await wait(validate())
      check()
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
      if (item.metadata.requirePresence) {
        const isPresent = await wait(this.deps.unlock.presence(item.metadata.id, id(), request))
        check = await wait(validate())
        check()
        if (!isPresent) throw new Error(UI_TEXT.vault.noAccess)
      }
      const metadata = await wait(store.list())
      check = await wait(validate())
      check()
      const itemId = item.metadata.id
      if (
        JSON.stringify(metadata.find((candidate) => candidate.id === itemId)) !==
        JSON.stringify(item.metadata)
      )
        throw new Error(UI_TEXT.vault.noAccess)
      const owned = Buffer.alloc(item.material.value.byteLength)
      owned.set(item.material.value)
      this.lastUse = this.clock.now()
      return owned
    } finally {
      signal?.removeEventListener('abort', cancel)
      cancel()
    }
  }
}

export function isVaultBootTokenMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'hex'),
    b = Buffer.from(actual, 'hex')
  return a.length === VAULT_LIMITS.idBytes && b.length === a.length && timingSafeEqual(a, b)
}

import { randomBytes, timingSafeEqual } from 'node:crypto'
import * as z from 'zod/mini'
import {
  UI_TEXT,
  VAULT_LIMITS,
  VAULT_LOCK_DRAIN_MS,
  MILLISECONDS_PER_SECOND,
} from '../../../shared/constants'
import {
  vaultRequesterSchema,
  vaultUseSchema,
  vaultTaintSchema,
  vaultApprovalAnswerSchema,
  vaultGrantSchema,
  vaultTicketSchema,
  vaultItemMetadataSchema,
  vaultAuditRecordSchema,
  type VaultRequester,
  type VaultUse,
  type VaultTaint,
  type VaultItem,
  type VaultGrant,
  type VaultTicket,
  type VaultApprovalAnswer,
  type VaultAuditRecord,
} from '../../../shared/vault'
import {
  vaultPrivateReadSchema,
  vaultApprovalResultSchema,
  vaultAuthorizationResultSchema,
  vaultStatusSchema,
  type VaultAuthenticatedPeer,
  type VaultApprovalResult,
  type VaultAuthorizationResult,
  type VaultBrokerPort,
  type VaultStatus,
} from '../../../shared/vaultProtocol'
import { type VaultBrokerDeps, type VaultUseLifetime, type VaultConnectionIdentity } from './ports'
import { type VaultCeiling } from './policy'
import {
  initialBrokerState,
  step,
  isEffectCurrent,
  canReleaseMaterial,
  type Command,
  type Event,
  type Effect,
  type Result,
  type RegistrationToken,
  type ConnectionToken,
} from './state'

type EventInput<T> = T extends Event ? Omit<T, 'now' | 'id' | 'nonce'> : never
const changeSchema = z.strictObject({
  kind: z.enum(['item', 'grant']),
  id: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
})
interface Waiter {
  resolve(value: unknown): void
  reject(error: unknown): void
}
const id = (): string => randomBytes(VAULT_LIMITS.idBytes).toString('hex')
function erase(resources: Result): void {
  resources.source?.fill(0)
  resources.key?.fill(0)
  resources.buffer?.fill(0)
  if (resources.item)
    for (const value of Object.values(resources.item.material))
      if (value instanceof Uint8Array) value.fill(0)
  resources.store?.lock()
  resources.writer?.close()
}
/** The last release boundary is a single tick: generation check, destination invocation, private wipe. */
export function runVaultRelease(
  state: ReturnType<typeof initialBrokerState>,
  effect: Extract<Effect, { kind: 'release' }>,
  now: number,
): void | Promise<void> {
  if (!canReleaseMaterial(state, effect.tags, now)) {
    erase({ item: effect.item, buffer: effect.buffer })
    throw new Error(UI_TEXT.vault.locked)
  }
  if (effect.run) return effect.run(effect.item)
  if (effect.send && effect.buffer) {
    try {
      effect.send(effect.buffer)
    } finally {
      erase({ item: effect.item, buffer: effect.buffer })
    }
  }
}
/** The reducer owns authority and resources. This adapter only runs effects and settles callers. */
export class VaultBroker implements VaultBrokerPort {
  private state = initialBrokerState()
  private readonly waiters = new Map<string, Waiter>()
  private readonly deadlines = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly invalidations = new Set<
    (requesterId: string | null, token?: RegistrationToken) => void
  >()
  private readonly unsubscribers: (() => void)[] = []
  private readonly timer: ReturnType<typeof setInterval>
  readonly clock
  constructor(private readonly deps: VaultBrokerDeps) {
    this.clock = deps.clock
    this.unsubscribers.push(
      deps.repository.subscribe((input) => {
        try {
          const change = changeSchema.parse(input)
          if (change.kind === 'item')
            void this.policyChanged(change.id).catch(() => {
              this.emergency()
            })
          else
            void this.call({ kind: 'revoked', grantId: change.id }).catch(() => {
              this.emergency()
            })
        } catch {
          this.emergency()
        }
      }),
      deps.epoch.subscribe((epoch) => {
        if (epoch > this.state.epoch)
          void this.call({ kind: 'lock', bump: false, epoch }).catch(() => {
            deps.onAuditFailure()
          })
      }),
    )
    if (deps.lockOnScreenLock)
      this.unsubscribers.push(
        deps.unlock.onScreenLock(() => {
          void this.lock().catch(() => {
            deps.onAuditFailure()
          })
        }),
      )
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.emergency()
      })
    }, MILLISECONDS_PER_SECOND)
    this.timer.unref()
  }
  private emergency(): void {
    void this.call({ kind: 'lock', bump: false }).catch(() => {
      this.deps.onAuditFailure()
    })
  }
  private dispatch(input: EventInput<Event>, eventId = id()): void {
    this.transition({ ...input, id: eventId, nonce: id(), now: this.clock.now() })
  }
  private transition(event: Event): void {
    const result = step(this.state, event)
    this.state = result.state
    // Wipes and close barriers run before callbacks or any I/O can re-enter the broker.
    for (const effect of result.effects)
      if (effect.kind === 'cleanup') erase(effect.resources)
      else if (effect.kind === 'closeLifetime') effect.lifetime.close()
    for (const effect of result.effects)
      if (effect.kind !== 'cleanup' && effect.kind !== 'closeLifetime') this.run(effect)
  }
  private run(effect: Exclude<Effect, { kind: 'cleanup' | 'closeLifetime' }>): void {
    switch (effect.kind) {
      case 'settle': {
        const waiter = this.waiters.get(effect.id)
        this.waiters.delete(effect.id)
        if (effect.error === undefined) {
          waiter?.resolve(effect.value)
        } else {
          waiter?.reject(effect.error)
        }
        return
      }
      case 'authenticated': {
        effect.receive(effect.identity, effect.token)
        return
      }
      case 'registered': {
        effect.receive(effect.token)
        return
      }
      case 'approval': {
        this.deps.onApproval(effect.request)
        return
      }
      case 'invalidate': {
        for (const listener of this.invalidations) listener(effect.requesterId, effect.token)
        if (effect.requesterId !== null) this.deps.onRevoked(effect.requesterId, effect.grantId)
        return
      }
      case 'locked': {
        this.deps.onLocked(effect.epoch)
        return
      }
      case 'failure': {
        this.deps.onAuditFailure()
        return
      }
      case 'cancelDeadline': {
        clearTimeout(this.deadlines.get(effect.id))
        this.deadlines.delete(effect.id)
        return
      }
      case 'deadline': {
        this.deadlines.set(
          effect.id,
          setTimeout(() => {
            this.dispatch({ kind: 'deadline', operationId: effect.id })
          }, VAULT_LOCK_DRAIN_MS),
        )
        return
      }
      case 'audit': {
        const canCommit = (): boolean => {
          const row = this.state.audits.get(effect.operationId)
          return row?.writer === effect.writer && row.version === effect.version
        }
        void (async () => {
          let error: unknown
          try {
            // Capture writer and version before scrubbing; no lookup of the current writer after await.
            const requester = vaultRequesterSchema.parse(
              JSON.parse(await this.deps.scrub(JSON.stringify(effect.row.requester))),
            )
            const handle = await this.deps.scrub(effect.row.handle),
              target = await this.deps.scrub(effect.row.target)
            await effect.writer.append({ ...effect.row, requester, handle, target }, canCommit)
          } catch (error_: unknown) {
            if (canCommit()) error = error_
          }
          this.dispatch({
            kind: 'audited',
            operationId: effect.operationId,
            version: effect.version,
            writer: effect.writer,
            ...(error !== undefined && { error }),
          })
        })()
        return
      }
      case 'io': {
        void (async () => {
          let result: Result = {},
            error: unknown
          try {
            if (isEffectCurrent(this.state, effect.tags))
              result = await effect.run(this.deps, () => isEffectCurrent(this.state, effect.tags))
          } catch (error_: unknown) {
            error = error_
          }
          this.dispatch({
            kind: 'completed',
            tags: effect.tags,
            result,
            ...(error !== undefined && { error }),
          })
        })()
        return
      }
      case 'release': {
        try {
          const result = runVaultRelease(this.state, effect, this.clock.now())
          if (result instanceof Promise)
            void (async () => {
              try {
                await result
                this.dispatch({ kind: 'completed', tags: effect.tags, result: {} })
              } catch (error: unknown) {
                this.dispatch({ kind: 'completed', tags: effect.tags, result: {}, error })
              }
            })()
          else this.dispatch({ kind: 'completed', tags: effect.tags, result: {} })
        } catch (error: unknown) {
          this.dispatch({ kind: 'completed', tags: effect.tags, result: {}, error })
        }
      }
    }
  }
  private async call(command: Command, signal?: AbortSignal): Promise<unknown> {
    const operationId = id()
    const cancel = (): void => {
      void this.call({ kind: 'abort', operationId }).catch(() => {
        this.emergency()
      })
    }
    signal?.addEventListener('abort', cancel, { once: true })
    const pending = new Promise<unknown>((resolve, reject) => {
      this.waiters.set(operationId, { resolve, reject })
      this.dispatch({ kind: 'command', command }, operationId)
      if (signal?.aborted) cancel()
    })
    try {
      return await pending
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }
  subscribeInvalidation(
    listener: (requesterId: string | null, token?: RegistrationToken) => void,
  ): () => void {
    this.invalidations.add(listener)
    return () => {
      this.invalidations.delete(listener)
    }
  }
  beginConnection(): ConnectionToken {
    const connection: ConnectionToken = Object.freeze({ kind: 'connection', id: id() })
    void this.call({ kind: 'connect', connection }).catch(() => {
      this.emergency()
    })
    return connection
  }
  async authenticate(
    connection: ConnectionToken,
    identify: () => Promise<VaultConnectionIdentity>,
  ): Promise<{ identity: VaultConnectionIdentity; token?: RegistrationToken }> {
    let result: { identity: VaultConnectionIdentity; token?: RegistrationToken } | undefined
    await this.call({
      kind: 'authenticate',
      connection,
      identify,
      receive: (identity, token) => {
        result = { identity, ...(token && { token }) }
      },
    })
    if (!result) throw new Error(UI_TEXT.vault.noAccess)
    return result
  }
  async registerOnConnection(
    peer: VaultAuthenticatedPeer,
    requester: VaultRequester,
    ceiling: VaultCeiling,
    connection: ConnectionToken,
  ): Promise<RegistrationToken> {
    let token: RegistrationToken | undefined
    await this.call({
      kind: 'register',
      peer,
      registration: {
        requester: vaultRequesterSchema.parse(requester),
        ceiling: structuredClone(ceiling),
      },
      connection,
      receive: (received) => {
        token = received
      },
    })
    if (!token) throw new Error(UI_TEXT.vault.noAccess)
    return token
  }
  async closeConnection(connection: ConnectionToken): Promise<void> {
    await this.call({ kind: 'disconnect', connection })
  }
  async register(
    peer: VaultAuthenticatedPeer,
    requester: VaultRequester,
    ceiling: VaultCeiling,
  ): Promise<void> {
    await this.call({
      kind: 'register',
      peer,
      registration: {
        requester: vaultRequesterSchema.parse(requester),
        ceiling: structuredClone(ceiling),
      },
    })
  }
  async unlock(slotId: string | null = null): Promise<void> {
    await this.call({ kind: 'unlock', slotId })
  }
  async lock(): Promise<void> {
    await this.call({ kind: 'lock', bump: true })
  }
  async tick(): Promise<void> {
    if (this.state.key && this.clock.now() - this.state.lastUse >= this.deps.idleMs) {
      await this.lock()
      return
    }
    await this.call({ kind: 'tick' })
  }
  async status(): Promise<VaultStatus> {
    const result = vaultStatusSchema.parse(await this.call({ kind: 'status' }))
    return this.deps.firstPartyOnly
      ? { ...result, state: 'firstPartyOnly', reason: 'brokerBlocked' }
      : result
  }
  async list(
    requester: VaultRequester,
    token?: RegistrationToken,
  ): Promise<readonly ReturnType<typeof vaultItemMetadataSchema.parse>[]> {
    return this.deps.firstPartyOnly
      ? []
      : z.array(vaultItemMetadataSchema).parse(
          await this.call({
            kind: 'list',
            requester: vaultRequesterSchema.parse(requester),
            ...(token && { token }),
          }),
        )
  }
  async request(
    requester: VaultRequester,
    handle: string,
    use: VaultUse,
    taint: VaultTaint,
    token?: RegistrationToken,
  ): Promise<VaultAuthorizationResult> {
    return this.deps.firstPartyOnly
      ? { kind: 'denied', reason: 'firstPartyOnly' }
      : vaultAuthorizationResultSchema.parse(
          await this.call({
            kind: 'request',
            requester: vaultRequesterSchema.parse(requester),
            handle,
            use: vaultUseSchema.parse(use),
            taint: vaultTaintSchema.parse(taint),
            ...(token && { token }),
          }),
        )
  }
  async answer(
    peer: VaultAuthenticatedPeer,
    answer: VaultApprovalAnswer,
  ): Promise<VaultApprovalResult> {
    return vaultApprovalResultSchema.parse(
      await this.call({ kind: 'answer', peer, answer: vaultApprovalAnswerSchema.parse(answer) }),
    )
  }
  async redeem(
    requesterId: string,
    ticket: VaultTicket,
    use: VaultUse,
    lifetime: VaultUseLifetime,
    token?: RegistrationToken,
  ): Promise<VaultApprovalResult> {
    return vaultApprovalResultSchema.parse(
      await this.call({
        kind: 'redeem',
        requesterId,
        ticket: vaultTicketSchema.parse(ticket),
        use: vaultUseSchema.parse(use),
        lifetime,
        ...(token && { token }),
      }),
    )
  }
  async withApprovedMaterial(
    ticketId: string,
    requesterId: string,
    use: VaultUse,
    run: (item: VaultItem) => Promise<void>,
  ): Promise<void> {
    await this.call({
      kind: 'material',
      ticketId,
      requesterId,
      use: vaultUseSchema.parse(use),
      run,
    })
  }
  async finish(ticketId: string, hasSucceeded: boolean): Promise<void> {
    await this.call({ kind: 'finish', ticketId, succeeded: hasSucceeded })
  }
  async readAudit(
    peer: VaultAuthenticatedPeer,
    connection?: ConnectionToken,
  ): Promise<readonly VaultAuditRecord[]> {
    return z
      .array(vaultAuditRecordSchema)
      .parse(await this.call({ kind: 'audit', peer, ...(connection && { connection }) }))
  }
  async grant(peer: VaultAuthenticatedPeer, grant: VaultGrant): Promise<void> {
    await this.call({ kind: 'grant', peer, grant: vaultGrantSchema.parse(grant) })
  }
  async revoke(peer: VaultAuthenticatedPeer, grantId: string): Promise<void> {
    await this.call({ kind: 'revoke', peer, grantId })
  }
  async endRequester(
    requesterId: string,
    grantId: string | null = null,
    token?: RegistrationToken,
  ): Promise<void> {
    await this.call({ kind: 'cancel', requesterId, grantId, ...(token && { token }) })
  }
  async policyChanged(itemId: string): Promise<void> {
    await this.call({ kind: 'policy', itemId })
  }
  async firstPartyRead(
    peer: VaultAuthenticatedPeer,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return z
      .instanceof(Buffer)
      .parse(
        await this.call(
          { kind: 'private', peer, request: vaultPrivateReadSchema.parse(input) },
          signal,
        ),
      )
  }
  async sendFirstParty(
    peer: VaultAuthenticatedPeer,
    input: unknown,
    send: (bytes: Buffer) => void,
    signal: AbortSignal,
    connection: ConnectionToken,
  ): Promise<void> {
    await this.call(
      { kind: 'private', peer, request: vaultPrivateReadSchema.parse(input), send, connection },
      signal,
    )
  }
  async dispose(): Promise<void> {
    clearInterval(this.timer)
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    await this.call({ kind: 'dispose' })
    this.invalidations.clear()
  }
}
export function isVaultBootTokenMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'hex'),
    b = Buffer.from(actual, 'hex')
  return a.length === VAULT_LIMITS.idBytes && b.length === a.length && timingSafeEqual(a, b)
}

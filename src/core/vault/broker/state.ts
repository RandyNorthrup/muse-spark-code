import {
  VAULT_APPROVAL_TTL_MS,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
  UI_TEXT,
} from '../../../shared/constants'
import {
  vaultItemMetadataSchema,
  vaultItemSchema,
  vaultSlotRecordSchema,
  vaultGrantSchema,
  type VaultItem,
  type VaultItemMetadata,
  type VaultRequester,
  type VaultUse,
  type VaultTaint,
  type VaultGrant,
  type VaultApprovalRequest,
  type VaultTicket,
  type VaultStorePort,
  type VaultSlotRecord,
  type VaultApprovalAnswer,
} from '../../../shared/vault'
import {
  type VaultAuthenticatedPeer,
  type VaultApprovalResult,
  type VaultStatus,
  type vaultPrivateReadSchema,
} from '../../../shared/vaultProtocol'
import {
  type VaultBrokerDeps,
  type VaultAuditWriter,
  type VaultUseLifetime,
  type VaultRequesterRegistration,
  type VaultConnectionIdentity,
} from './ports'
import { evaluateVaultPolicy, isCeilingCovered, isGrantCovered } from './policy'
import { vaultUseDigest } from '../useDigest'

type Reason = Extract<VaultApprovalResult, { kind: 'denied' }>['reason']
type Authority = Extract<VaultApprovalResult, { kind: 'ticket' }>['authority']
type Row = Parameters<VaultAuditWriter['append']>[0]
/** Object identity is the capability: wire fields cannot recreate one. */
export interface RegistrationToken {
  readonly kind: 'registration'
  readonly id: string
  readonly incarnation: string
}
export interface ConnectionToken {
  readonly kind: 'connection'
  readonly id: string
}
interface Registration extends VaultRequesterRegistration {
  token: RegistrationToken
  ready: boolean
}
interface Connection {
  token: ConnectionToken
  snapshot: Map<string, RegistrationToken>
  registration?: RegistrationToken
}
export type Command =
  | { kind: 'unlock'; slotId: string | null }
  | {
      kind: 'register'
      peer: VaultAuthenticatedPeer
      registration: VaultRequesterRegistration
      connection?: ConnectionToken
      receive?: (token: RegistrationToken) => void
    }
  | {
      kind: 'authenticate'
      connection: ConnectionToken
      identify: () => Promise<VaultConnectionIdentity>
      receive: (identity: VaultConnectionIdentity, token: RegistrationToken | undefined) => void
    }
  | { kind: 'status' | 'tick' }
  | { kind: 'list'; requester: VaultRequester; token?: RegistrationToken }
  | {
      kind: 'request'
      requester: VaultRequester
      handle: string
      use: VaultUse
      taint: VaultTaint
      token?: RegistrationToken
    }
  | { kind: 'answer'; peer: VaultAuthenticatedPeer; answer: VaultApprovalAnswer }
  | {
      kind: 'redeem'
      requesterId: string
      ticket: VaultTicket
      use: VaultUse
      lifetime: VaultUseLifetime
      token?: RegistrationToken
    }
  | {
      kind: 'material'
      ticketId: string
      requesterId: string
      use: VaultUse
      run: (item: VaultItem) => Promise<void>
    }
  | {
      kind: 'private'
      peer: VaultAuthenticatedPeer
      request: ReturnType<typeof vaultPrivateReadSchema.parse>
      send?: (bytes: Buffer) => void
      connection?: ConnectionToken
    }
  | { kind: 'audit'; peer: VaultAuthenticatedPeer; connection?: ConnectionToken }
  | { kind: 'grant'; peer: VaultAuthenticatedPeer; grant: VaultGrant }
  | { kind: 'revoke'; peer: VaultAuthenticatedPeer; grantId: string }
  | { kind: 'lock'; bump: boolean; epoch?: number }
  | {
      kind: 'cancel'
      requesterId: string
      token?: RegistrationToken | undefined
      grantId: string | null
    }
  | { kind: 'policy'; itemId: string }
  | { kind: 'revoked'; grantId: string }
  | { kind: 'finish'; ticketId: string; succeeded: boolean }
  | { kind: 'abort'; operationId: string }
  | { kind: 'connect'; connection: ConnectionToken }
  | { kind: 'disconnect'; connection: ConnectionToken }
  | { kind: 'dispose' }
interface Resources {
  key?: Buffer | undefined
  source?: Uint8Array | undefined
  store?: VaultStorePort | undefined
  writer?: VaultAuditWriter | undefined
  item?: VaultItem | undefined
  buffer?: Buffer | undefined
}
type AuditSubject = Pick<VaultApprovalRequest, 'requester' | 'use' | 'digest'> & {
  item: Pick<VaultItemMetadata, 'handle'>
}
interface Operation {
  id: string
  generation: number
  command: Command
  phase: string
  token?: RegistrationToken | undefined
  connection?: ConnectionToken | undefined
  resources: Resources
  before?: number | undefined
  slot?: VaultSlotRecord | undefined
  subject?: AuditSubject | undefined
  request?: VaultApprovalRequest | undefined
  authority?: Authority | undefined
  ticket?: VaultTicket | undefined
  session?: boolean | undefined
  terminalOutcome?: Row['outcome']
  result?: unknown
  reason?: Reason
  parent?: string | undefined
}
interface Admission {
  request: VaultApprovalRequest
  ticket?: VaultTicket | undefined
  authority?: Authority | undefined
  token: RegistrationToken
  generation: number
  lifetime?: VaultUseLifetime
  redeemed?: boolean
  released?: boolean | undefined
}
interface AuditEntry {
  subject: AuditSubject
  writer: VaultAuditWriter
  version: number
  terminal: boolean
  outcome: Row['outcome']
  waiting: Set<string>
}
export interface BrokerState {
  unlockOwner?: string | undefined
  generation: number
  epoch: number
  disposed: boolean
  lastUse: number
  key?: Buffer | undefined
  store?: VaultStorePort | undefined
  writer?: VaultAuditWriter | undefined
  slot?: VaultSlotRecord | undefined
  operations: Map<string, Operation>
  registrations: Map<string, Registration>
  connections: Map<string, Connection>
  pending: Map<string, Admission>
  tickets: Map<string, Admission>
  active: Map<string, Admission>
  buffers: Map<string, { generation: number; resources: Resources }>
  sessions: Map<string, Set<string>>
  grants: Map<string, VaultGrant>
  revoked: Set<string>
  retiringWriters: Set<VaultAuditWriter>
  audits: Map<string, AuditEntry>
  serial: string[]
  draining: Map<string, Set<string>>
}
export interface Tags {
  operationId: string
  generation: number
  phase: string
  token?: RegistrationToken | undefined
  connection?: ConnectionToken
}
export interface Result extends Resources {
  value?: unknown
  slot?: VaultSlotRecord | undefined
  identity?: VaultConnectionIdentity
}
export type Effect =
  | {
      kind: 'io'
      tags: Tags
      run: (deps: VaultBrokerDeps, canCommit: () => boolean) => Promise<Result>
    }
  | {
      kind: 'release'
      tags: Tags
      item: VaultItem
      run?: (item: VaultItem) => Promise<void>
      send?: (bytes: Buffer) => void
      buffer?: Buffer | undefined
    }
  | { kind: 'audit'; operationId: string; version: number; writer: VaultAuditWriter; row: Row }
  | { kind: 'cleanup'; owner: string; resources: Pick<Resources, 'store' | 'writer'> }
  | { kind: 'settle'; id: string; value?: unknown; error?: unknown }
  | {
      kind: 'authenticated'
      identity: VaultConnectionIdentity
      token: RegistrationToken | undefined
      receive: (identity: VaultConnectionIdentity, token: RegistrationToken | undefined) => void
    }
  | { kind: 'registered'; token: RegistrationToken; receive: (token: RegistrationToken) => void }
  | { kind: 'approval'; request: VaultApprovalRequest }
  | {
      kind: 'invalidate'
      requesterId: string | null
      token?: RegistrationToken | undefined
      grantId: string | null
    }
  | { kind: 'locked'; epoch: number }
  | { kind: 'failure' }
  | { kind: 'deadline'; id: string }
  | { kind: 'cancelDeadline'; id: string }
  | { kind: 'closeLifetime'; lifetime: VaultUseLifetime }
export type Event = { now: number; id: string; nonce: string } & (
  | { kind: 'command'; command: Command }
  | { kind: 'completed'; tags: Tags; result: Result; error?: unknown }
  | {
      kind: 'audited'
      operationId: string
      version: number
      writer: VaultAuditWriter
      error?: unknown
    }
  | { kind: 'deadline'; operationId: string }
)
export function initialBrokerState(): BrokerState {
  return {
    generation: 0,
    epoch: 0,
    disposed: false,
    lastUse: 0,
    operations: new Map(),
    registrations: new Map(),
    connections: new Map(),
    pending: new Map(),
    tickets: new Map(),
    active: new Map(),
    buffers: new Map(),
    sessions: new Map(),
    grants: new Map(),
    revoked: new Set(),
    retiringWriters: new Set(),
    audits: new Map(),
    serial: [],
    draining: new Map(),
  }
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
function denied(reason: Reason): VaultApprovalResult {
  return { kind: 'denied', reason }
}
function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error(UI_TEXT.vault.noAccess)
  return value
}
function registered(
  state: BrokerState,
  requester: VaultRequester,
  token?: RegistrationToken,
): Registration | undefined {
  const registration = state.registrations.get(requester.id)
  return registration?.ready &&
    (!token || token === registration.token) &&
    JSON.stringify(registration.requester) === JSON.stringify(requester)
    ? registration
    : undefined
}
export function isEffectCurrent(state: BrokerState, tags: Tags): boolean {
  const op = state.operations.get(tags.operationId)
  return (
    op?.phase === tags.phase &&
    op.generation === tags.generation &&
    state.generation === tags.generation &&
    (!tags.token || state.registrations.get(tags.token.id)?.token === tags.token) &&
    (!tags.connection || state.connections.get(tags.connection.id)?.token === tags.connection)
  )
}
function operationReason(state: BrokerState, op: Operation, now: number): Reason | null {
  if (
    op.generation !== state.generation ||
    (state.disposed && !['status', 'tick'].includes(op.command.kind))
  )
    return 'locked'
  if (op.token && state.registrations.get(op.token.id)?.token !== op.token) return 'peer'
  if (op.connection && state.connections.get(op.connection.id)?.token !== op.connection)
    return 'peer'
  if (op.request) {
    if (!state.key) return 'locked'
    if (
      now >= op.request.expiresAt ||
      (op.request.item.dates.expiresAt !== null && now >= op.request.item.dates.expiresAt)
    )
      return 'expired'
    if (op.authority?.kind === 'grant') {
      const grant = state.grants.get(op.authority.grantId)
      if (
        !grant ||
        state.revoked.has(op.authority.grantId) ||
        !isGrantCovered(
          { ...grant, uses: Math.max(0, grant.uses - 1) },
          op.request.item,
          op.request.requester,
          op.request.use,
          now,
        )
      )
        return 'scope'
    }
  }
  const item = op.resources.item
  return item?.metadata.dates.expiresAt !== null &&
    item?.metadata.dates.expiresAt !== undefined &&
    now >= item.metadata.dates.expiresAt
    ? 'expired'
    : null
}
export function canReleaseMaterial(state: BrokerState, tags: Tags, now: number): boolean {
  const op = state.operations.get(tags.operationId)
  const admission = op?.ticket && state.active.get(op.ticket.id)
  return (
    state.key !== undefined &&
    isEffectCurrent(state, tags) &&
    op !== undefined &&
    (op.command.kind !== 'material' ||
      (admission?.redeemed === true &&
        admission.ticket === op.ticket &&
        admission.token === op.token &&
        admission.generation === tags.generation)) &&
    operationReason(state, op, now) === null
  )
}
const operationTags = (op: Operation): Tags => ({
  operationId: op.id,
  generation: op.generation,
  phase: op.phase,
  ...(op.token && { token: op.token }),
  ...(op.connection && { connection: op.connection }),
})
/** Synchronous transition: erase plaintext before returning any removal of its ownership. */
export function step(
  previous: BrokerState,
  event: Event,
): { state: BrokerState; effects: Effect[] } {
  const state: BrokerState = {
    ...previous,
    operations: new Map(
      Array.from(previous.operations, ([key, op]) => [
        key,
        { ...op, resources: { ...op.resources } },
      ]),
    ),
    registrations: new Map(previous.registrations),
    connections: new Map(previous.connections),
    pending: new Map(previous.pending),
    tickets: new Map(previous.tickets),
    active: new Map(previous.active),
    buffers: new Map(previous.buffers),
    sessions: new Map(previous.sessions),
    grants: new Map(previous.grants),
    revoked: new Set(previous.revoked),
    retiringWriters: new Set(previous.retiringWriters),
    audits: new Map(
      Array.from(previous.audits, ([key, row]) => [key, { ...row, waiting: new Set(row.waiting) }]),
    ),
    serial: [...previous.serial],
    draining: new Map(Array.from(previous.draining, ([key, ids]) => [key, new Set(ids)])),
  }
  const effects: Effect[] = []

  const io = (op: Operation, phase: string, run: Extract<Effect, { kind: 'io' }>['run']): void => {
    op.phase = phase
    effects.push({ kind: 'io', tags: operationTags(op), run })
  }
  const cleanup = (owner: string, resources: Resources): void => {
    resources.source?.fill(0)
    resources.key?.fill(0)
    resources.buffer?.fill(0)
    if (resources.item)
      for (const value of Object.values(resources.item.material))
        if (value instanceof Uint8Array) value.fill(0)
    if (resources.store)
      effects.push({ kind: 'cleanup', owner, resources: { store: resources.store } })
    if (resources.writer)
      effects.push({ kind: 'cleanup', owner, resources: { writer: resources.writer } })
    state.buffers.delete(owner)
  }
  const own = (op: Operation, resources: Resources): void => {
    op.resources = { ...op.resources, ...resources }
    state.buffers.set(op.id, { generation: op.generation, resources: op.resources })
  }
  const settle = (op: Operation, value?: unknown, error?: unknown): void => {
    state.operations.delete(op.id)
    cleanup(op.id, op.resources)
    if (op.request) {
      const entry = state.audits.get(op.request.id)
      if (
        entry?.terminal &&
        entry.waiting.size === 0 &&
        Array.from(state.operations, ([, operation]) => operation).every(
          (operation) => operation.request?.id !== op.request?.id,
        )
      )
        state.audits.delete(op.request.id)
    }
    if (state.unlockOwner === op.id) {
      state.unlockOwner = undefined
      const waitingOperations = Array.from(state.operations, ([, value]) => value)
      for (const waiting of waitingOperations)
        if (waiting.phase === 'waitingUnlock') fail(waiting, 'locked')
    }
    effects.push({ kind: 'settle', id: op.id, value, ...(error !== undefined && { error }) })
    const wasFirst = state.serial[0] === op.id
    state.serial = state.serial.filter((id) => id !== op.id)
    for (const [id, waiting] of state.draining) {
      waiting.delete(op.id)
      if (
        waiting.size === 0 &&
        ['drain', 'finalDrain'].includes(state.operations.get(id)?.phase ?? '')
      )
        finishDrain(id)
    }
    if (!wasFirst) return
    const next = state.operations.get(state.serial[0] ?? '')
    if (next) start(next)
  }
  const finishDrain = (id: string): void => {
    const op = state.operations.get(id)
    if (!op) return
    state.draining.delete(id)
    effects.push({ kind: 'cancelDeadline', id })
    if (op.command.kind === 'lock') {
      const writer = op.resources.writer
      op.resources.writer = undefined
      if (writer) {
        if (
          Array.from(state.audits, ([, value]) => value).some(
            (row) => row.writer === writer && row.waiting.size > 0,
          )
        )
          state.retiringWriters.add(writer)
        else cleanup(id, { writer })
      }
      effects.push({ kind: 'locked', epoch: state.epoch })
    }
    settle(op, undefined, op.result)
  }
  const audit = (
    op: Operation,
    decision: Row['decision'],
    authority: Row['authority'],
    outcome: Row['outcome'],
    grantId: string | null = null,
  ): void => {
    const subject = op.request ?? op.subject
    if (!subject) {
      settle(op, op.result)
      return
    }
    const auditId = op.request?.id ?? op.id
    let entry = state.audits.get(auditId)
    const writer = entry?.writer ?? state.writer
    if (!writer) {
      settle(op, op.result)
      return
    }
    if (outcome === 'pending' && entry?.terminal) {
      settle(op, denied(op.reason ?? 'locked'))
      return
    }
    if (!entry) {
      entry = { subject, writer, version: 0, terminal: false, outcome, waiting: new Set() }
      state.audits.set(auditId, entry)
    }
    if (entry.terminal) {
      settle(op, op.result)
      return
    }
    entry.version += 1
    entry.terminal = outcome !== 'pending'
    entry.outcome = outcome
    if (entry.terminal) op.terminalOutcome = outcome
    entry.waiting.add(op.id)
    op.phase = 'audit'
    effects.push({
      kind: 'audit',
      operationId: auditId,
      version: entry.version,
      writer,
      row: {
        time: event.now,
        requester: subject.requester,
        handle: subject.item.handle,
        kind: subject.use.kind,
        target: `${subject.use.kind}:${subject.digest}`,
        digest: subject.digest,
        decision,
        authority,
        grantId,
        outcome,
      },
    })
  }
  const fail = (
    op: Operation,
    reason: Reason,
    outcome: Row['outcome'] = reason === 'expired' || reason === 'locked' ? reason : 'denied',
  ): void => {
    // A terminal operation settles its recorded liability; it cannot wait on itself.
    if (op.command.kind === 'finish' && op.terminalOutcome !== undefined) return
    op.reason = reason
    op.result = denied(reason)
    if (state.unlockOwner === op.id) {
      state.unlockOwner = undefined
      const waitingOperations = Array.from(state.operations, ([, value]) => value)
      for (const waiting of waitingOperations)
        if (waiting.phase === 'waitingUnlock') unlock(waiting)
    }
    if (
      op.command.kind === 'register' &&
      op.token &&
      state.registrations.get(op.token.id)?.token === op.token
    )
      state.registrations.delete(op.token.id)
    if (op.ticket) {
      const admission = state.active.get(op.ticket.id)
      state.tickets.delete(op.ticket.id)
      state.active.delete(op.ticket.id)
      if (admission?.lifetime) terminate(admission, outcome)
    }
    if (op.request) state.pending.delete(op.request.id)
    if (['unwrap', 'open', 'writer', 'read', 'release'].includes(op.phase)) {
      // The tag no longer has an operation owner. Late I/O can only erase its own result.
      settle(
        op,
        op.command.kind === 'request' ? denied(reason) : undefined,
        op.command.kind === 'request' ? undefined : new Error(UI_TEXT.vault.noAccess),
      )
      return
    }
    cleanup(op.id, op.resources)
    op.resources = {}
    const terminalOwner = op.request && state.operations.get(`${op.request.id}:terminal`)
    const entry = op.request && state.audits.get(op.request.id)
    if (terminalOwner && entry) {
      op.phase = 'audit'
      entry.waiting.add(op.id)
      return
    }
    if (['request', 'answer', 'redeem'].includes(op.command.kind))
      audit(
        op,
        'deny',
        'failClosed',
        outcome,
        op.authority?.kind === 'grant' ? op.authority.grantId : null,
      )
    else
      settle(
        op,
        op.command.kind === 'list' ? [] : undefined,
        op.command.kind === 'list' ? undefined : new Error(UI_TEXT.vault.noAccess),
      )
  }
  const invalid = (op: Operation): Reason | null => operationReason(state, op, event.now)
  const mint = (
    op: Operation,
    requester: VaultRequester,
    item: VaultItemMetadata,
    use: VaultUse,
    taint: VaultTaint,
  ): void => {
    op.request = {
      id: op.id,
      nonce: event.nonce,
      requester,
      item,
      use,
      taint,
      digest: vaultUseDigest(use),
      createdAt: event.now,
      expiresAt: event.now + VAULT_APPROVAL_TTL_MS,
      lockEpoch: state.epoch,
    }
    if (state.writer)
      state.audits.set(op.id, {
        subject: op.request,
        writer: state.writer,
        version: 0,
        terminal: false,
        outcome: 'pending',
        waiting: new Set(),
      })
  }
  const hasTicketRoom = (op: Operation): boolean => {
    if (state.tickets.size >= VAULT_LIMITS.items) {
      fail(op, 'policy')
      return false
    }
    return true
  }
  const ticketAudit = (op: Operation): void => {
    if (!hasTicketRoom(op)) return
    const authority = requireValue(op.authority)
    audit(
      op,
      'allow',
      authority.kind,
      'pending',
      authority.kind === 'grant' ? authority.grantId : null,
    )
  }
  const makeTicket = (op: Operation): void => {
    const request = requireValue(op.request),
      token = requireValue(op.token),
      authority = requireValue(op.authority)
    const ticket: VaultTicket = {
      id: event.nonce,
      requestId: request.id,
      requesterId: request.requester.id,
      itemId: request.item.id,
      digest: request.digest,
      nonce: request.nonce,
      issuedAt: event.now,
      expiresAt: request.expiresAt,
      lockEpoch: state.epoch,
      maxUses: 1,
    }
    state.tickets.set(ticket.id, {
      request,
      ticket,
      authority,
      token,
      generation: state.generation,
    })
    if (op.session) {
      const key = sessionKey(request.requester, request.item.id)
      const digests = new Set(state.sessions.get(key))
      digests.add(request.digest)
      state.sessions.set(key, digests)
    }
    state.lastUse = event.now
    settle(op, { kind: 'ticket', ticket: structuredClone(ticket), authority })
  }
  const load = (op: Operation): void => {
    if (!state.store) {
      fail(op, 'locked')
      return
    }
    const store = state.store
    io(op, 'list', async () => ({ value: await store.list() }))
  }
  const grants = (op: Operation): void => {
    io(op, 'grants', async (deps) => ({ value: await deps.repository.grants() }))
  }
  const read = (op: Operation, itemId: string): void => {
    const store = requireValue(state.store)
    io(op, 'read', async () => ({ item: vaultItemSchema.parse(await store.read(itemId)) }))
  }
  const unlock = (op: Operation): void => {
    if (state.unlockOwner) {
      op.phase = 'waitingUnlock'
      return
    }
    state.unlockOwner = op.id
    io(op, 'unlockEpoch', async (deps) => ({ value: await deps.epoch.current() }))
  }
  const presence = (
    op: Operation,
    itemId: string,
    use: VaultUse | ReturnType<typeof vaultPrivateReadSchema.parse>,
  ): void => {
    io(op, 'presence', async (deps) => ({
      value: await deps.unlock.presence(itemId, event.nonce, use),
    }))
  }
  const release = (op: Operation): void => {
    const reason = invalid(op)
    if (reason) {
      fail(op, reason)
      return
    }
    const item = requireValue(op.resources.item)
    op.phase = 'release'
    state.lastUse = event.now
    if (op.command.kind === 'material')
      effects.push({ kind: 'release', tags: operationTags(op), item, run: op.command.run })
    else if (op.command.kind === 'private' && item.material.kind === 'apiKey') {
      const buffer = Buffer.alloc(item.material.value.byteLength)
      buffer.set(item.material.value)
      own(op, { buffer })
      effects.push({
        kind: 'release',
        tags: operationTags(op),
        item,
        buffer,
        ...(op.command.send && { send: op.command.send }),
      })
    }
  }
  const revokeItem = (
    itemId: string | undefined,
    grantId: string | null,
    parent: Operation,
  ): void => {
    const ids = new Set<string>()
    for (const admission of [
      ...state.pending.values(),
      ...state.tickets.values(),
      ...state.active.values(),
    ])
      if (admission.request.item.id === itemId) ids.add(admission.token.id)
    for (const op of state.operations.values())
      if (op.token && op.request?.item.id === itemId) ids.add(op.token.id)
    for (const id of ids) cancel(id, undefined, grantId, parent)
  }
  const terminate = (admission: Admission, outcome: Row['outcome'], parent?: Operation): void => {
    const op: Operation = {
      id: `${admission.request.id}:terminal`,
      generation: state.generation,
      command: { kind: 'finish', ticketId: admission.ticket?.id ?? '', succeeded: false },
      phase: 'terminate',
      resources: {},
      request: admission.request,
      authority: admission.authority,
      parent: parent?.id,
      terminalOutcome: outcome,
    }
    state.operations.set(op.id, op)
    if (parent) state.draining.get(parent.id)?.add(op.id)
    // close is synchronous, performed before the runner starts termination.
    const lifetime = admission.lifetime
    if (lifetime) {
      effects.push(
        { kind: 'closeLifetime', lifetime },
        {
          kind: 'io',
          tags: operationTags(op),
          run: async () => ({ value: await lifetime.terminate() }),
        },
      )
    } else {
      op.result = undefined
      audit(op, 'deny', 'failClosed', outcome)
    }
  }
  const cancel = (
    requesterId: string,
    token: RegistrationToken | undefined,
    grantId: string | null,
    parent?: Operation,
  ): void => {
    const registration = state.registrations.get(requesterId)
    if (token && registration?.token !== token) return
    state.registrations.delete(requesterId)
    if (registration)
      for (const key of state.sessions.keys())
        if (
          key.startsWith(
            JSON.stringify([registration.requester.hostId, registration.requester.sessionId]).slice(
              0,
              -1,
            ),
          )
        )
          state.sessions.delete(key)
    effects.push({ kind: 'invalidate', requesterId, token: registration?.token, grantId })
    const seen = new Set<string>()
    for (const collection of [state.pending, state.tickets, state.active])
      for (const [id, admission] of collection)
        if (admission.token.id === requesterId) {
          collection.delete(id)
          if (!seen.has(admission.request.id)) {
            seen.add(admission.request.id)
            terminate(admission, 'revoked', parent)
          }
        }
    for (const op of state.operations.values())
      if (op !== parent && op.command.kind !== 'finish' && op.token?.id === requesterId)
        fail(op, 'peer')
  }
  const lock = (op: Operation, shouldBump: boolean, epoch?: number): void => {
    state.generation += 1
    state.unlockOwner = undefined
    state.epoch = Math.max(state.epoch, epoch ?? state.epoch)
    state.sessions.clear()
    const writer = state.writer
    op.generation = state.generation
    op.phase = 'barrier'
    op.resources = { writer }
    if (state.store || state.key) cleanup('installed', { store: state.store, key: state.key })
    state.store = undefined
    state.key = undefined
    state.writer = undefined
    state.slot = undefined
    for (const [owner, held] of state.buffers) cleanup(owner, held.resources)
    state.buffers.clear()
    const waiting = new Set<string>()
    state.draining.set(op.id, waiting)
    const seen = new Set<string>()
    for (const collection of [state.active, state.pending, state.tickets])
      for (const [id, admission] of collection) {
        collection.delete(id)
        if (seen.has(admission.request.id)) {
          continue
        }

        seen.add(admission.request.id)
        terminate(admission, 'locked', op)
      }
    for (const old of state.operations.values())
      if (
        old.id !== op.id &&
        old.command.kind !== 'finish' &&
        old.command.kind !== 'lock' &&
        !state.draining.has(old.id)
      ) {
        if (old.request && ['request', 'answer', 'redeem'].includes(old.command.kind))
          waiting.add(old.id)
        fail(old, 'locked')
      }
    for (const old of state.operations.values())
      if (old.command.kind === 'finish') waiting.add(old.id)
    effects.push({ kind: 'invalidate', requesterId: null, grantId: null })
    if (shouldBump) {
      const child: Operation = {
        id: `${op.id}:epoch`,
        generation: state.generation,
        command: { kind: 'tick' },
        phase: 'bump',
        resources: {},
        parent: op.id,
      }
      state.operations.set(child.id, child)
      waiting.add(child.id)
      io(child, 'bump', async (deps, canCommit) => ({
        value: await deps.epoch.bump(() => {
          if (!canCommit()) throw new Error(UI_TEXT.vault.noAccess)
        }),
      }))
    }
    op.phase = 'drain'
    effects.push({ kind: 'deadline', id: op.id })
    if (waiting.size === 0) finishDrain(op.id)
  }
  const start = (op: Operation): void => {
    const command = op.command
    if (state.disposed && !['dispose', 'lock', 'status', 'tick', 'redeem'].includes(command.kind)) {
      fail(op, 'locked')
      return
    }
    switch (command.kind) {
      case 'connect': {
        if (state.connections.size >= VAULT_LIMITS.items) {
          fail(op, 'peer')
          return
        }
        state.connections.set(command.connection.id, {
          token: command.connection,
          snapshot: new Map(Array.from(state.registrations, ([id, reg]) => [id, reg.token])),
        })
        settle(op)
        return
      }
      case 'disconnect': {
        const connection = state.connections.get(command.connection.id)
        if (connection?.token === command.connection) {
          state.connections.delete(command.connection.id)
          if (connection.registration)
            cancel(connection.registration.id, connection.registration, null)
          for (const old of state.operations.values())
            if (old.connection === connection.token && old.id !== op.id) fail(old, 'peer')
        }
        settle(op)
        return
      }
      case 'authenticate': {
        if (state.connections.get(command.connection.id)?.token !== command.connection) {
          fail(op, 'peer')
          return
        }
        op.connection = command.connection
        io(op, 'authenticate', async () => ({ identity: await command.identify() }))
        return
      }
      case 'cancel': {
        op.phase = 'barrier'
        state.draining.set(op.id, new Set())
        cancel(command.requesterId, command.token, command.grantId, op)
        op.phase = 'drain'
        if (state.draining.get(op.id)?.size === 0) finishDrain(op.id)
        return
      }
      case 'abort': {
        const aborted = state.operations.get(command.operationId)
        if (aborted) fail(aborted, 'peer')
        settle(op)
        return
      }
      case 'revoked': {
        state.revoked.add(command.grantId)
        state.draining.set(op.id, new Set())
        revokeItem(state.grants.get(command.grantId)?.itemId, command.grantId, op)
        op.phase = 'drain'
        if (state.draining.get(op.id)?.size === 0) finishDrain(op.id)
        return
      }
      case 'policy': {
        op.phase = 'barrier'
        state.draining.set(op.id, new Set())
        revokeItem(command.itemId, null, op)
        for (const old of state.operations.values())
          if (old.resources.item?.metadata.id === command.itemId) fail(old, 'policy')
        op.phase = 'drain'
        if (state.draining.get(op.id)?.size === 0) finishDrain(op.id)
        return
      }
      case 'dispose': {
        state.disposed = true
        op.command = { kind: 'lock', bump: true }
        lock(op, true)
        return
      }
      case 'lock': {
        lock(op, command.bump, command.epoch)
        return
      }
      case 'finish': {
        const admission = state.active.get(command.ticketId)
        if (!admission) {
          settle(op)
          return
        }
        state.active.delete(command.ticketId)
        op.request = admission.request
        op.authority = admission.authority
        if (admission.lifetime)
          effects.push({ kind: 'closeLifetime', lifetime: admission.lifetime })
        for (const old of state.operations.values())
          if (old !== op && old.command.kind === 'material' && old.ticket?.id === command.ticketId)
            fail(old, 'replay')
        audit(
          op,
          'allow',
          requireValue(admission.authority).kind,
          command.succeeded ? 'succeeded' : 'failed',
          admission.authority?.kind === 'grant' ? admission.authority.grantId : null,
        )
        return
      }
      case 'register': {
        const registration = command.registration
        if (
          command.connection &&
          state.connections.get(command.connection.id)?.token !== command.connection
        ) {
          fail(op, 'peer')
          return
        }
        if (
          !command.peer.ui ||
          command.peer.hostId !== registration.requester.hostId ||
          state.registrations.has(registration.requester.id) ||
          state.registrations.size >= VAULT_LIMITS.items
        ) {
          fail(op, 'peer')
          return
        }
        const token: RegistrationToken = Object.freeze({
          kind: 'registration',
          id: registration.requester.id,
          incarnation: op.id,
        })
        op.token = token
        op.connection = command.connection
        state.registrations.set(token.id, { ...registration, token, ready: false })
        io(op, 'host', async (deps) => ({ value: await deps.identity.verifyHost(command.peer) }))
        return
      }
      case 'answer': {
        const admission = state.pending.get(command.answer.requestId)
        if (!admission) {
          settle(op, denied('replay'))
          return
        }
        op.request = admission.request
        op.token = admission.token
        if (!command.peer.ui || command.peer.hostId !== admission.request.requester.hostId) {
          op.subject = op.request
          op.request = undefined
          fail(op, 'peer')
          return
        }
        io(op, 'host', async (deps) => ({ value: await deps.identity.verifyHost(command.peer) }))
        return
      }
      case 'grant':
      case 'revoke':
      case 'audit':
      case 'private': {
        if (!command.peer.ui) {
          fail(op, 'peer')
          return
        }
        if (command.kind === 'private' || command.kind === 'audit')
          op.connection = command.connection
        io(op, 'host', async (deps) => ({ value: await deps.identity.verifyHost(command.peer) }))
        return
      }
      case 'redeem': {
        const admission = state.tickets.get(command.ticket.id)
        if (!admission) {
          settle(op, denied('replay'))
          return
        }
        if (
          command.requesterId !== admission.token.id ||
          (command.token && command.token !== admission.token) ||
          JSON.stringify(command.ticket) !== JSON.stringify(admission.ticket)
        ) {
          settle(op, denied('peer'))
          return
        }
        state.tickets.delete(command.ticket.id)
        op.request = admission.request
        op.authority = admission.authority
        op.ticket = command.ticket
        op.token = admission.token
        state.active.set(command.ticket.id, { ...admission, lifetime: command.lifetime })
        if (vaultUseDigest(command.use) !== command.ticket.digest) {
          fail(op, 'digest')
          return
        }
        break
      }
      case 'material': {
        const admission = state.active.get(command.ticketId)
        if (
          !admission ||
          !admission.redeemed ||
          admission.released ||
          command.requesterId !== admission.token.id ||
          vaultUseDigest(command.use) !== admission.request.digest
        ) {
          fail(op, 'peer')
          return
        }
        state.active.set(command.ticketId, { ...admission, released: true })
        op.request = admission.request
        op.authority = admission.authority
        op.ticket = admission.ticket
        op.token = admission.token
        break
      }
      case 'request':
      case 'list': {
        const registration = registered(state, command.requester, command.token)
        if (!registration) {
          if (command.kind === 'request' && state.key)
            op.subject = {
              requester: command.requester,
              item: { handle: command.handle },
              use: command.use,
              digest: vaultUseDigest(command.use),
            }
          fail(op, 'peer')
          return
        }
        op.token = registration.token
        if (command.kind === 'request' && state.store === undefined) {
          unlock(op)
          return
        }
        if (state.store === undefined) {
          settle(op, [])
          return
        }
        break
      }
      case 'unlock': {
        if (!state.key) {
          unlock(op)
          return
        }
        break
      }
      case 'tick': {
        for (const old of state.operations.values()) {
          const reason = invalid(old)
          if (reason === 'expired' && old.id !== op.id) fail(old, reason)
        }
        for (const collection of [state.pending, state.tickets, state.active])
          for (const [id, admission] of collection) {
            if (!(
              event.now >= admission.request.expiresAt ||
              (admission.request.item.dates.expiresAt !== null &&
                event.now >= admission.request.item.dates.expiresAt)
            )) {
              continue
            }

            collection.delete(id)
            terminate(admission, 'expired')
          }
        break
      }
      case 'status': {
        break
      }
    }
    const reason = invalid(op)
    if (reason) {
      fail(op, reason)
      return
    }
    io(op, 'epoch', async (deps) => ({ value: await deps.epoch.current() }))
  }
  const afterAudit = (op: Operation): void => {
    const reason = invalid(op)
    if (op.reason || op.command.kind === 'finish') {
      if (op.reason && !['request', 'answer', 'redeem', 'finish'].includes(op.command.kind))
        settle(op, undefined, new Error(UI_TEXT.vault.noAccess))
      else settle(op, op.result)
      return
    }
    if (reason) {
      fail(op, reason)
      return
    }
    if (op.command.kind === 'request' && !op.authority) {
      const request = requireValue(op.request),
        token = requireValue(op.token)
      state.pending.set(request.id, { request, token, generation: state.generation })
      effects.push({ kind: 'approval', request: structuredClone(request) })
      settle(op, { kind: 'approval', request: structuredClone(request) })
    } else if (op.command.kind === 'request' || op.command.kind === 'answer') {
      if (op.request) state.pending.delete(op.request.id)
      makeTicket(op)
    } else if (op.command.kind === 'redeem') {
      const ticket = requireValue(op.ticket),
        admission = state.active.get(ticket.id)
      if (!admission) {
        fail(op, 'replay')
        return
      }
      state.active.set(ticket.id, { ...admission, redeemed: true })
      state.lastUse = event.now
      settle(op, { kind: 'ticket', ticket: op.ticket, authority: op.authority })
    } else settle(op)
  }
  switch (event.kind) {
    case 'command': {
      const op: Operation = {
        id: event.id,
        command: event.command,
        generation: state.generation,
        phase: 'new',
        resources: {},
      }
      state.operations.set(op.id, op)
      if (['request', 'answer', 'redeem', 'grant'].includes(op.command.kind)) {
        state.serial.push(op.id)
        if (state.serial[0] === op.id) start(op)
      } else start(op)

      break
    }
    case 'audited': {
      const entry = state.audits.get(event.operationId)
      if (entry?.writer === event.writer && entry.version === event.version) {
        const waiting = [...entry.waiting]
        entry.waiting.clear()
        for (const id of waiting) {
          const op = state.operations.get(id)
          if (!op) continue
          if (event.error === undefined) {
            afterAudit(op)
          } else {
            effects.push({ kind: 'failure' })
            if (op.command.kind === 'redeem' && op.ticket) {
              const admission = state.active.get(op.ticket.id)
              state.active.delete(op.ticket.id)
              state.tickets.delete(op.ticket.id)
              if (admission) terminate(admission, 'failed')
            }
            if (op.parent) {
              const parent = state.operations.get(op.parent)
              if (parent) parent.result = event.error
            }
            settle(op, undefined, event.error)
          }
        }
        if (
          entry.terminal &&
          Array.from(state.operations, ([, operation]) => operation).every(
            (operation) => operation.request?.id !== event.operationId,
          )
        )
          state.audits.delete(event.operationId)
        if (
          state.retiringWriters.has(event.writer) &&
          Array.from(state.audits, ([, value]) => value).every(
            (row) => !(row.writer === event.writer && row.waiting.size > 0),
          )
        ) {
          state.retiringWriters.delete(event.writer)
          cleanup(event.operationId, { writer: event.writer })
        }
      }

      break
    }
    case 'deadline': {
      const parent = state.operations.get(event.operationId)
      if (parent) {
        if (parent.phase === 'finalDrain') {
          effects.push({ kind: 'failure' })
          finishDrain(parent.id)
          return { state, effects }
        }
        parent.result = new Error(UI_TEXT.vault.noAccess)
        const draining = state.draining.get(parent.id) ?? []
        for (const id of draining) {
          const op = state.operations.get(id)
          if (op?.phase !== 'terminate') {
            continue
          }

          op.phase = 'audit'
          op.result = undefined
          audit(op, 'deny', 'failClosed', 'unrecallable')
        }
        const waiting = state.draining.get(parent.id)
        if (!waiting || waiting.size === 0) finishDrain(parent.id)
        else {
          parent.phase = 'finalDrain'
          effects.push({ kind: 'deadline', id: parent.id })
        }
      }

      break
    }
    default: {
      const { tags: completed, result } = event
      const op = state.operations.get(completed.operationId)
      if (
        !isEffectCurrent(state, completed) &&
        !(
          op &&
          (op.command.kind === 'finish' || op.phase === 'bump') &&
          op.phase === completed.phase &&
          op.generation === completed.generation
        )
      ) {
        cleanup(completed.operationId, result)
      } else if (op) {
        const phase = op.phase
        op.phase = `${phase}:completed`
        try {
          if (event.error === undefined) {
            const command = op.command
            const reason = invalid(op)
            if (reason && phase !== 'bump' && command.kind !== 'finish') {
              cleanup(op.id, result)
              fail(op, reason)
            } else
              switch (phase) {
                case 'authenticate': {
                  const identity = requireValue(result.identity),
                    connection = state.connections.get(requireValue(op.connection).id)
                  if (
                    !connection ||
                    (identity.requester &&
                      (!registered(
                        state,
                        identity.requester,
                        connection.snapshot.get(identity.requester.id),
                      ) ||
                        connection.snapshot.get(identity.requester.id) !==
                          state.registrations.get(identity.requester.id)?.token))
                  ) {
                    fail(op, 'peer')
                    break
                  }
                  const token = identity.requester
                    ? state.registrations.get(identity.requester.id)?.token
                    : undefined
                  state.connections.set(connection.token.id, {
                    ...connection,
                    ...(token && { registration: token }),
                  })
                  if (command.kind === 'authenticate')
                    effects.push({
                      kind: 'authenticated',
                      identity,
                      token,
                      receive: command.receive,
                    })
                  settle(op)
                  break
                }
                case 'host': {
                  if (result.value !== true) {
                    if (command.kind === 'answer') {
                      op.subject = op.request
                      op.request = undefined
                    }
                    fail(op, 'peer')
                    break
                  }
                  if (command.kind === 'register')
                    io(op, 'launched', async (deps) => ({
                      value: await deps.identity.verifyLaunched(command.peer, command.registration),
                    }))
                  else if (command.kind === 'revoke') {
                    state.revoked.add(command.grantId)
                    state.draining.set(op.id, new Set())
                    revokeItem(state.grants.get(command.grantId)?.itemId, command.grantId, op)
                    io(op, 'removed', async (deps) => {
                      await deps.repository.removeGrant(command.grantId)
                      return {}
                    })
                  } else if (!state.key && command.kind === 'private') unlock(op)
                  else io(op, 'epoch', async (deps) => ({ value: await deps.epoch.current() }))
                  break
                }
                case 'launched': {
                  const registration = state.registrations.get(requireValue(op.token).id)
                  if (!registration || result.value !== true) {
                    fail(op, 'peer')
                    break
                  }
                  state.registrations.set(registration.token.id, { ...registration, ready: true })
                  if (command.kind === 'register') {
                    if (!command.connection) {
                      settle(op)
                      break
                    }
                    const connection = state.connections.get(command.connection.id)
                    if (connection)
                      state.connections.set(connection.token.id, {
                        ...connection,
                        snapshot: new Map(connection.snapshot).set(
                          registration.token.id,
                          registration.token,
                        ),
                        registration: registration.token,
                      })
                    if (command.receive)
                      effects.push({
                        kind: 'registered',
                        token: registration.token,
                        receive: command.receive,
                      })
                  }
                  settle(op)
                  break
                }
                case 'unlockEpoch': {
                  op.before = Number(result.value)
                  io(op, 'unwrap', async (deps) => {
                    const unlocked = await deps.unlock.unlock(
                      command.kind === 'unlock' ? command.slotId : null,
                    )
                    return { source: unlocked.key, slot: unlocked.slot }
                  })
                  break
                }
                case 'unwrap': {
                  const source = requireValue(result.source)
                  own(op, { source, key: Buffer.alloc(VAULT_KEY_BYTES) })
                  if (source.byteLength !== VAULT_KEY_BYTES) {
                    fail(op, 'locked')
                    break
                  }
                  requireValue(op.resources.key).set(source)
                  source.fill(0)
                  op.resources.source = undefined
                  op.slot = vaultSlotRecordSchema.parse(result.slot)
                  const key = requireValue(op.resources.key)
                  io(op, 'open', async (deps) => ({ store: await deps.repository.open(key) }))
                  break
                }
                case 'open': {
                  own(op, { store: requireValue(result.store) })
                  const key = requireValue(op.resources.key)
                  io(op, 'writer', async (deps) => ({ writer: await deps.audit.openWriter(key) }))
                  break
                }
                case 'writer': {
                  own(op, { writer: requireValue(result.writer) })
                  io(op, 'installEpoch', async (deps) => ({ value: await deps.epoch.current() }))
                  break
                }
                case 'installEpoch': {
                  if (result.value !== op.before || Number(result.value) < state.epoch) {
                    fail(op, 'locked')
                    break
                  }
                  state.generation += 1
                  op.generation = state.generation
                  const previousOperations = Array.from(state.operations, ([, value]) => value)
                  for (const old of previousOperations) {
                    if (
                      old.id === op.id ||
                      old.command.kind === 'finish' ||
                      state.draining.has(old.id) ||
                      old.phase === 'bump'
                    )
                      continue
                    if (old.phase === 'waitingUnlock') old.generation = state.generation
                    else fail(old, 'locked')
                  }
                  state.key = op.resources.key
                  state.store = op.resources.store
                  state.writer = op.resources.writer
                  state.slot = op.slot
                  state.epoch = Number(result.value)
                  state.lastUse = event.now
                  state.buffers.delete(op.id)
                  op.resources = {}
                  state.unlockOwner = undefined
                  const waitingOperations = Array.from(state.operations, ([, value]) => value)
                  for (const waiting of waitingOperations)
                    if (waiting.phase === 'waitingUnlock') {
                      if (waiting.command.kind === 'unlock') settle(waiting)
                      else if (waiting.command.kind === 'private')
                        read(waiting, waiting.command.request.itemId)
                      else load(waiting)
                    }
                  if (command.kind === 'unlock') settle(op)
                  else if (command.kind === 'private') read(op, command.request.itemId)
                  else load(op)
                  break
                }
                case 'epoch': {
                  if (result.value !== state.epoch) {
                    const barrier: Operation = {
                      id: event.id,
                      command: { kind: 'lock', bump: false },
                      generation: state.generation,
                      phase: 'new',
                      resources: {},
                    }
                    state.operations.set(barrier.id, barrier)
                    lock(barrier, false, Number(result.value))
                    break
                  }
                  if (command.kind === 'unlock' || command.kind === 'tick') {
                    settle(op)
                    break
                  }
                  if (command.kind === 'status' && !state.store) {
                    settle(op, {
                      state: 'locked',
                      lockEpoch: state.epoch,
                      tier: null,
                      provider: null,
                      silentUnlock: false,
                      itemCount: 0,
                      reason: 'locked',
                    })
                    break
                  }
                  if (command.kind === 'audit') {
                    if (state.writer) {
                      const writer = state.writer
                      io(op, 'auditRead', async () => ({ value: await writer.read() }))
                    } else fail(op, 'locked')
                    break
                  }
                  if (command.kind === 'grant') {
                    if (!state.key) {
                      fail(op, 'locked')
                      break
                    }
                    grants(op)
                    break
                  }
                  if (command.kind === 'answer') {
                    const request = requireValue(op.request)
                    if (command.answer.digest !== request.digest) {
                      op.subject = op.request
                      op.request = undefined
                      fail(op, 'digest')
                      break
                    }
                    if (command.answer.decision === 'deny') {
                      state.pending.delete(request.id)
                      op.result = denied('policy')
                      op.reason = 'policy'
                      audit(op, 'deny', 'user', 'denied')
                      break
                    }
                  }
                  if (command.kind === 'private') read(op, command.request.itemId)
                  else if (command.kind === 'material') grants(op)
                  else load(op)
                  break
                }
                case 'list': {
                  const metadata = requireValue(result.value)
                  if (!Array.isArray(metadata)) throw new Error(UI_TEXT.vault.noAccess)
                  const items = metadata.map((entry: unknown) =>
                    vaultItemMetadataSchema.parse(entry),
                  )
                  if (command.kind === 'status') {
                    const status: VaultStatus = {
                      state: state.key ? 'unlocked' : 'locked',
                      lockEpoch: state.epoch,
                      tier: state.slot?.tier ?? null,
                      provider: state.slot?.provider ?? null,
                      silentUnlock:
                        state.slot !== undefined &&
                        !['presence', 'passphrase'].includes(state.slot.tier),
                      itemCount: items.length,
                      reason: state.key ? null : 'locked',
                    }
                    settle(op, status)
                    break
                  }
                  if (command.kind === 'list') {
                    const registration = state.registrations.get(requireValue(op.token).id)
                    settle(
                      op,
                      items.filter(
                        (item) =>
                          !item.hidden &&
                          !item.firstParty &&
                          !['internal', 'devicePair'].includes(item.kind) &&
                          isCeilingCovered(requireValue(registration).ceiling, item.handle),
                      ),
                    )
                    break
                  }
                  if (command.kind === 'request') {
                    const item = items.find((item) => item.handle === command.handle)
                    if (!item) {
                      op.subject = {
                        requester: command.requester,
                        item: { handle: command.handle },
                        use: command.use,
                        digest: vaultUseDigest(command.use),
                      }
                      fail(op, 'scope')
                      break
                    }
                    mint(op, command.requester, item, command.use, command.taint)
                    grants(op)
                    break
                  }
                  const item = items.find(
                    (item) => item.id === (op.request?.item.id ?? op.resources.item?.metadata.id),
                  )
                  if (
                    !item ||
                    JSON.stringify(item) !==
                      JSON.stringify(op.request?.item ?? op.resources.item?.metadata)
                  ) {
                    fail(op, 'policy')
                    break
                  }
                  if (command.kind === 'private' || command.kind === 'material') {
                    release(op)
                    break
                  }
                  if (command.kind === 'answer') {
                    const request = requireValue(op.request)
                    if (
                      command.answer.decision === 'allowSession' &&
                      (request.item.policy.mode !== 'askOncePerSession' ||
                        request.requester.sessionId === null ||
                        request.taint.tainted ||
                        request.use.kind === 'disclosure')
                    ) {
                      fail(op, 'policy')
                      break
                    }
                    op.session = command.answer.decision === 'allowSession'
                    op.authority = { kind: 'user' }
                    ticketAudit(op)
                    break
                  }
                  if (command.kind === 'redeem') grants(op)
                  break
                }
                case 'grants': {
                  if (!Array.isArray(result.value)) throw new Error(UI_TEXT.vault.noAccess)
                  state.grants.clear()
                  for (const entry of result.value) {
                    const grant = vaultGrantSchema.parse(entry)
                    state.grants.set(grant.id, grant)
                  }
                  if (command.kind === 'grant') {
                    if (
                      command.grant.uses !== 0 ||
                      state.grants.has(command.grant.id) ||
                      state.revoked.has(command.grant.id)
                    ) {
                      fail(op, 'policy')
                      break
                    }
                    io(op, 'saved', async (deps, canCommit) => {
                      await deps.repository.saveGrant(command.grant, () => {
                        if (!canCommit()) throw new Error(UI_TEXT.vault.noAccess)
                      })
                      return {}
                    })
                    break
                  }
                  const reason = invalid(op)
                  if (reason) {
                    fail(op, reason)
                    break
                  }
                  if (command.kind === 'material') {
                    read(op, requireValue(op.request).item.id)
                    break
                  }
                  if (command.kind === 'redeem') {
                    const request = requireValue(op.request)
                    if (request.item.requirePresence || command.use.kind === 'disclosure')
                      presence(op, request.item.id, command.use)
                    else ticketAudit(op)
                    break
                  }
                  if (command.kind === 'request') {
                    const request = requireValue(op.request),
                      registration = requireValue(
                        state.registrations.get(requireValue(op.token).id),
                      )
                    const decision = evaluateVaultPolicy(
                      request.item,
                      request.requester,
                      request.use,
                      request.taint,
                      Array.from(state.grants, ([, value]) => value).filter(
                        (grant) => !state.revoked.has(grant.id),
                      ),
                      registration.ceiling,
                      event.now,
                      state.sessions.get(sessionKey(request.requester, request.item.id)) ??
                        new Set(),
                    )
                    if (decision.kind === 'denied') {
                      fail(op, decision.reason)
                      break
                    }
                    if (decision.kind === 'ask') {
                      if (state.pending.size >= VAULT_LIMITS.items) fail(op, 'policy')
                      else audit(op, 'ask', request.taint.tainted ? 'taint' : 'user', 'pending')
                      break
                    }
                    if (!hasTicketRoom(op)) break
                    op.authority = decision.grant
                      ? { kind: 'grant', grantId: decision.grant.id }
                      : { kind: 'mode' }
                    if (decision.grant) {
                      const grantId = decision.grant.id
                      io(op, 'consume', async (deps) => ({
                        value: await deps.repository.consumeGrant(grantId, event.now),
                      }))
                    } else ticketAudit(op)
                  }
                  break
                }
                case 'consume': {
                  if (result.value === true) ticketAudit(op)
                  else fail(op, 'scope')
                  break
                }
                case 'read': {
                  const item = requireValue(result.item)
                  own(op, { item })
                  if (command.kind === 'private') {
                    if (
                      !item.metadata.firstParty ||
                      !item.metadata.hidden ||
                      item.material.kind !== 'apiKey' ||
                      item.material.origin !== command.request.origin ||
                      item.metadata.bindings.every(
                        (binding) =>
                          !(binding.kind === 'origin' && binding.origin === command.request.origin),
                      )
                    ) {
                      fail(op, 'peer')
                      break
                    }
                    if (item.metadata.requirePresence)
                      presence(op, item.metadata.id, command.request)
                    else load(op)
                  } else load(op)
                  break
                }
                case 'presence': {
                  if (result.value !== true) fail(op, 'presence')
                  else if (command.kind === 'private') load(op)
                  else ticketAudit(op)
                  break
                }
                case 'release': {
                  if (command.kind === 'private' && !command.send) {
                    const buffer = requireValue(op.resources.buffer)
                    cleanup(op.id, { item: op.resources.item })
                    op.resources = {}
                    state.buffers.set(op.id, {
                      generation: state.generation,
                      resources: { buffer },
                    })
                    state.operations.delete(op.id)
                    effects.push({ kind: 'settle', id: op.id, value: buffer })
                  } else settle(op)
                  break
                }
                case 'auditRead': {
                  settle(op, result.value)
                  break
                }
                case 'saved': {
                  if (command.kind === 'grant') state.grants.set(command.grant.id, command.grant)
                  settle(op)
                  break
                }
                case 'removed': {
                  if ((state.draining.get(op.id)?.size ?? 0) === 0) finishDrain(op.id)
                  else op.phase = 'drain'
                  break
                }
                case 'bump': {
                  if (op.generation === state.generation)
                    state.epoch = Math.max(state.epoch, Number(result.value))
                  settle(op)
                  break
                }
                case 'terminate': {
                  audit(
                    op,
                    'deny',
                    'failClosed',
                    result.value === true ? (op.terminalOutcome ?? 'unrecallable') : 'unrecallable',
                  )
                  break
                }
              }
          } else {
            if (phase === 'terminate') {
              op.result = undefined
              audit(op, 'deny', 'failClosed', 'unrecallable')
            } else if (phase === 'bump') {
              const parent = state.operations.get(requireValue(op.parent))
              if (parent) parent.result = event.error
              settle(op)
            } else {
              if (
                op.command.kind === 'register' &&
                state.registrations.get(op.token?.id ?? '')?.token === op.token
              )
                state.registrations.delete(op.token?.id ?? '')
              const reason = invalid(op)
              if (reason) fail(op, reason)
              else if (op.command.kind === 'request') fail(op, 'locked')
              else settle(op, undefined, event.error)
            }
          }
        } catch (error: unknown) {
          cleanup(op.id, result)
          settle(op, undefined, error)
        }
      } else cleanup(completed.operationId, result)
    }
  }
  return { state, effects }
}

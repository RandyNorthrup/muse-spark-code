import { createHash, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import { UI_TEXT, VAULT_APPROVAL_TTL_MS, VAULT_LIMITS } from '../../shared/constants'
import {
  vaultBindingSchema,
  vaultGrantSchema,
  vaultRequesterSchema,
  vaultTaintSchema,
  type VaultRequester,
  type VaultTicket,
  type VaultUse,
} from '../../shared/vault'
import {
  vaultAuthorizationResultSchema,
  vaultUseProposalSchema,
  type VaultAuthorizationResult,
  type VaultAuthenticatedPeer,
} from '../../shared/vaultProtocol'
import { type VaultBroker } from './broker/broker'
import { isBindingCovered, isCeilingCovered, type VaultCeiling } from './broker/policy'
import { vaultUseDigest } from './useDigest'

/** M96 embeds this field in its charter; models cannot supply the effective ceiling. */
export const vaultRoleSecretsSchema = vaultGrantSchema.shape.ceiling.check(
  z.refine((v) => !Array.isArray(v) || new Set(v).size === v.length),
)
const scopeSchema = z.strictObject({
  handle: vaultUseProposalSchema.shape.handle,
  target: vaultBindingSchema,
  maxUses: z.number().check(z.int(), z.positive(), z.maximum(VAULT_LIMITS.grants)),
})
const scopesSchema = z.array(scopeSchema).check(
  z.minLength(1),
  z.maxLength(VAULT_LIMITS.names),
  z.refine((v) => new Set(v.map((scope) => scopeKey(scope))).size === v.length),
)
type Scope = z.infer<typeof scopeSchema>
export const vaultDelegationCardSchema = z.strictObject({
  id: vaultRequesterSchema.shape.id,
  requester: vaultRequesterSchema,
  scopes: scopesSchema,
  digest: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  expiresAt: z.number().check(z.int(), z.nonnegative()),
})
export type VaultDelegationCard = z.infer<typeof vaultDelegationCardSchema>
const answerSchema = z.strictObject({
  id: vaultRequesterSchema.shape.id,
  digest: vaultDelegationCardSchema.shape.digest,
  decision: z.enum(['allowOnce', 'deny']),
})
type Proposal = ReturnType<typeof vaultUseProposalSchema.parse>
const triggerSchema = z.enum([
  'interactive',
  'schedule',
  'timedSend',
  'goal',
  'scheduler',
  'relocation',
  'headless',
  'userUnattended',
])
export interface VaultWorkerLaunch {
  requester: Omit<VaultRequester, 'id' | 'unattended'>
  trigger: z.infer<typeof triggerSchema>
  secrets?: unknown
}
export interface VaultWorkerAccess {
  readonly requester: VaultRequester
  readonly socket: string
}
/** S/X bind an owned socket and paused launched process, never a caller-chosen socket. */
export interface VaultWorkerRoute {
  readonly socket: string
  /** X writes only on the inherited pipe; canSend runs at the physical write. */
  handoff(ticket: VaultTicket, use: VaultUse, canSend: () => boolean): Promise<void>
  /** Synchronous revocation closes only this owned route and its pending pipe. */
  close(): void
}
export interface VaultFleetDelegationPort {
  /** U/H bind the authenticated host UI; no hook, reviewer or model answers this port. */
  approve(card: VaultDelegationCard, signal: AbortSignal): Promise<unknown>
  /** B installs no standing grant. It rechecks policy/presence/taint and calls canAdmit
   * synchronously at admission for temporary task authority, before minting a ticket. */
  request(
    requester: VaultRequester,
    proposal: Proposal,
    card: VaultDelegationCard,
    canAdmit: () => boolean,
    signal: AbortSignal,
    canUse: () => boolean,
  ): Promise<VaultAuthorizationResult>
  /** B must force an approval (or denial), even if an ordinary Always/session grant covers it. */
  requestOutside(
    requester: VaultRequester,
    proposal: Proposal,
    signal: AbortSignal,
  ): Promise<VaultAuthorizationResult>
}
interface Worker {
  requester: VaultRequester
  ceiling: VaultCeiling
  controller: AbortController
  route?: VaultWorkerRoute
  delegation?: { card: VaultDelegationCard; scopes: Scope[]; uses: Map<string, number> }
  pendingCard: boolean
  parent?: VaultWorkerAccess
}
export interface VaultFleetPorts {
  peer: VaultAuthenticatedPeer
  broker: Pick<
    VaultBroker,
    'clock' | 'register' | 'request' | 'endRequester' | 'subscribeInvalidation'
  >
  routes: { open(requester: VaultRequester, signal: AbortSignal): Promise<VaultWorkerRoute> }
  delegation: VaultFleetDelegationPort
  /** Trusted context provenance; a clean tool proposal cannot clear it. */
  taint(requester: VaultRequester): ReturnType<typeof vaultTaintSchema.parse>
}

export function vaultRoleCeiling(role: VaultRequester['role'], secrets?: unknown): VaultCeiling {
  if (secrets !== undefined) return vaultRoleSecretsSchema.parse(secrets)
  return role.kind === 'role' && ['research', 'design', 'marketing'].includes(role.name)
    ? 'none'
    : 'ask'
}
function intersection(parent: VaultCeiling, child: VaultCeiling): VaultCeiling {
  if (parent === 'none' || child === 'none') return 'none'
  if (parent === 'ask') return structuredClone(child)
  return child === 'ask' ? [...parent] : child.filter((handle) => parent.includes(handle))
}
function scopeKey(scope: Scope): string {
  return JSON.stringify([scope.handle, scope.target])
}
function socketKey(socket: string): string {
  if (
    !z
      .string()
      .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0\r\n]+$/u))
      .safeParse(socket).success
  )
    throw new Error(UI_TEXT.vault.noAccess)
  const normalized = socket.replaceAll('\\', '/')
  return /^[A-Za-z]:\//u.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}
function delegationDigest(card: Omit<VaultDelegationCard, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(card)).digest('hex')
}

/** UI promises own no bytes. Bound their wait even if an adapter ignores cancellation. */
export async function awaitVaultApproval(
  answer: Promise<unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  const denied = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      reject(new Error(UI_TEXT.vault.approvalExpired))
    }
    signal.addEventListener('abort', cancel, { once: true })
    timer = setTimeout(cancel, VAULT_APPROVAL_TTL_MS)
    timer.unref()
    if (signal.aborted) cancel()
  })
  try {
    return await Promise.race([answer, denied])
  } finally {
    clearTimeout(timer)
    if (cancel) signal.removeEventListener('abort', cancel)
  }
}

/** One synchronous owner of worker/task authority; every I/O completion checks its capability. */
export class VaultFleet {
  private readonly workers = new Map<VaultWorkerAccess, Worker>()
  private readonly sockets = new Set<string>()
  private generation = 0
  private disposed = false
  private readonly opening = new Set<AbortController>()
  private readonly unsubscribe: () => void
  constructor(private readonly ports: VaultFleetPorts) {
    this.unsubscribe = ports.broker.subscribeInvalidation((id) => {
      if (id === null) {
        this.generation += 1
        for (const controller of this.opening) controller.abort()
      }
      let hasFailed = false
      for (const [access, worker] of this.workers)
        if (id === null || id === worker.requester.id)
          try {
            this.retire(access)
          } catch {
            hasFailed = true
          }
      if (hasFailed) throw new Error(UI_TEXT.vault.noAccess)
    })
  }
  private worker(access: VaultWorkerAccess): Worker {
    const worker = this.workers.get(access)
    if (!worker || worker.controller.signal.aborted) throw new Error(UI_TEXT.vault.noAccess)
    return worker
  }
  private current(access: VaultWorkerAccess, worker: Worker): boolean {
    return this.workers.get(access) === worker && !worker.controller.signal.aborted
  }
  private descendants(access: VaultWorkerAccess): Set<VaultWorkerAccess> {
    const retired = new Set([access])
    for (const [candidate, worker] of this.workers)
      if (worker.parent && retired.has(worker.parent)) retired.add(candidate)
    return retired
  }
  private retire(access: VaultWorkerAccess): void {
    const retired = this.descendants(access)
    const routes: VaultWorkerRoute[] = []
    for (const candidate of retired) {
      const worker = this.workers.get(candidate)
      if (!worker) continue
      this.workers.delete(candidate)
      worker.controller.abort()
      delete worker.delegation
      if (worker.route) routes.push(worker.route)
    }
    let hasFailed = false
    for (const route of routes)
      try {
        route.close()
      } catch {
        hasFailed = true
      }
    if (hasFailed) throw new Error(UI_TEXT.vault.noAccess)
  }
  async open(launch: VaultWorkerLaunch, parent?: VaultWorkerAccess): Promise<VaultWorkerAccess> {
    if (this.disposed || this.sockets.size >= VAULT_LIMITS.items)
      throw new Error(UI_TEXT.vault.noAccess)
    const trigger = triggerSchema.parse(launch.trigger)
    const ancestor = parent ? this.worker(parent) : undefined
    let source = launch.requester.source
    switch (trigger) {
      case 'relocation': {
        source = 'relocated'
        break
      }
      case 'schedule':
      case 'timedSend':
      case 'goal':
      case 'headless': {
        source = trigger
        break
      }
      default: {
        break
      }
    }
    const requester = vaultRequesterSchema.parse({
      ...launch.requester,
      id: randomBytes(VAULT_LIMITS.idBytes).toString('hex'),
      source,
      unattended:
        trigger !== 'interactive' ||
        launch.requester.role.kind === 'headless' ||
        ancestor?.requester.unattended === true ||
        ['headless', 'schedule', 'timedSend', 'goal', 'relocated'].includes(
          launch.requester.source,
        ),
    })
    if (requester.hostId !== this.ports.peer.hostId) throw new Error(UI_TEXT.vault.noAccess)
    if (
      ancestor &&
      ['hostId', 'conversationId', 'sessionId', 'workspaceId', 'deviceId'].some(
        (field) => Reflect.get(ancestor.requester, field) !== Reflect.get(requester, field),
      )
    )
      throw new Error(UI_TEXT.vault.noAccess)
    const role = vaultRoleCeiling(requester.role, launch.secrets)
    const ceiling = ancestor ? intersection(ancestor.ceiling, role) : role
    const worker: Worker = {
      requester,
      ceiling,
      controller: new AbortController(),
      pendingCard: false,
      ...(parent && { parent }),
    }
    const generation = this.generation
    this.opening.add(worker.controller)
    let route: VaultWorkerRoute
    try {
      route = await this.ports.routes.open(structuredClone(requester), worker.controller.signal)
    } finally {
      this.opening.delete(worker.controller)
    }
    let access: VaultWorkerAccess | undefined
    try {
      const key = socketKey(route.socket)
      if (
        !key ||
        this.sockets.has(key) ||
        generation !== this.generation ||
        worker.controller.signal.aborted ||
        (parent && ancestor && !this.current(parent, ancestor))
      )
        throw new Error(UI_TEXT.vault.noAccess)
      this.sockets.add(key)
      worker.route = route
      access = { requester: structuredClone(requester), socket: route.socket }
      this.workers.set(access, worker)
      await this.ports.broker.register(this.ports.peer, structuredClone(requester), ceiling)
      if (!this.current(access, worker)) throw new Error(UI_TEXT.vault.noAccess)
      return access
    } catch (error: unknown) {
      worker.controller.abort()
      if (access) this.workers.delete(access)
      try {
        route.close()
      } finally {
        await this.ports.broker.endRequester(requester.id)
      }
      throw error
    }
  }
  async delegate(access: VaultWorkerAccess, input: unknown): Promise<boolean> {
    const worker = this.worker(access)
    const scopes = scopesSchema.parse(input)
    if (
      !this.ports.peer.ui ||
      worker.requester.role.kind === 'hook' ||
      worker.requester.deviceId !== null ||
      worker.pendingCard ||
      worker.delegation ||
      worker.requester.unattended ||
      worker.requester.taskId === null ||
      worker.requester.sessionId === null ||
      scopes.some((scope) => !isCeilingCovered(worker.ceiling, scope.handle))
    )
      throw new Error(UI_TEXT.vault.noAccess)
    const unsigned = {
      id: randomBytes(VAULT_LIMITS.idBytes).toString('hex'),
      requester: structuredClone(worker.requester),
      scopes,
      expiresAt: this.ports.broker.clock.now() + VAULT_APPROVAL_TTL_MS,
    }
    const card = vaultDelegationCardSchema.parse({
      ...unsigned,
      digest: delegationDigest(unsigned),
    })
    worker.pendingCard = true
    try {
      const answer = answerSchema.parse(
        await awaitVaultApproval(
          this.ports.delegation.approve(structuredClone(card), worker.controller.signal),
          worker.controller.signal,
        ),
      )
      if (
        !this.current(access, worker) ||
        this.ports.broker.clock.now() >= card.expiresAt ||
        answer.id !== card.id ||
        answer.digest !== card.digest
      )
        throw new Error(UI_TEXT.vault.approvalExpired)
      if (answer.decision === 'deny') return false
      worker.delegation = { card, scopes: structuredClone(scopes), uses: new Map() }
      return true
    } finally {
      worker.pendingCard = false
    }
  }
  /** The model may remove scopes or lower counts; it cannot add a target or restore spent uses. */
  narrowDelegation(access: VaultWorkerAccess, input: unknown): void {
    const delegation = this.worker(access).delegation
    if (!delegation) throw new Error(UI_TEXT.vault.noAccess)
    const next = z.array(scopeSchema).check(z.maxLength(VAULT_LIMITS.names)).parse(input)
    if (
      new Set(next.map((scope) => scopeKey(scope))).size !== next.length ||
      next.some((scope) =>
        delegation.scopes.every(
          (old) => !(scopeKey(old) === scopeKey(scope) && scope.maxUses <= old.maxUses),
        ),
      )
    )
      throw new Error(UI_TEXT.vault.noAccess)
    delegation.scopes = next
  }
  async request(access: VaultWorkerAccess, input: unknown): Promise<VaultAuthorizationResult> {
    const worker = this.worker(access)
    const proposal = vaultUseProposalSchema.parse(input)
    if (!isCeilingCovered(worker.ceiling, proposal.handle))
      return { kind: 'denied', reason: 'ceiling' }
    const trusted = vaultTaintSchema.parse(this.ports.taint(structuredClone(worker.requester)))
    proposal.taint = vaultTaintSchema.parse({
      tainted: trusted.tainted || proposal.taint.tainted,
      reasons: [...trusted.reasons, ...proposal.taint.reasons],
    })
    const delegation = worker.delegation
    const scope =
      !worker.requester.unattended && !proposal.taint.tainted && worker.requester.deviceId === null
        ? delegation?.scopes.find(
            (entry) =>
              entry.handle === proposal.handle &&
              isBindingCovered(entry.target, proposal.use) &&
              (delegation.uses.get(scopeKey(entry)) ?? 0) < entry.maxUses,
          )
        : undefined
    let hasSpent = false
    let admittedUse = 0
    const canUse = (): boolean => {
      if (!hasSpent || !scope || !delegation || !this.current(access, worker)) return false
      const current = delegation.scopes.find((entry) => scopeKey(entry) === scopeKey(scope))
      return current !== undefined && admittedUse <= current.maxUses
    }
    const canAdmit = (): boolean => {
      if (hasSpent || !scope || !delegation || !this.current(access, worker)) return false
      const key = scopeKey(scope),
        used = delegation.uses.get(key) ?? 0
      const current = delegation.scopes.find((entry) => scopeKey(entry) === key)
      if (!current || used >= current.maxUses) return false
      delegation.uses.set(key, used + 1)
      admittedUse = used + 1
      hasSpent = true
      return true
    }
    let pending: Promise<VaultAuthorizationResult>
    const requiresTaskApproval = delegation !== undefined && scope === undefined
    if (scope && delegation) {
      pending = this.ports.delegation.request(
        structuredClone(worker.requester),
        structuredClone(proposal),
        structuredClone(delegation.card),
        canAdmit,
        worker.controller.signal,
        canUse,
      )
    } else if (requiresTaskApproval) {
      pending = this.ports.delegation.requestOutside(
        structuredClone(worker.requester),
        structuredClone(proposal),
        worker.controller.signal,
      )
    } else {
      pending = this.ports.broker.request(
        structuredClone(worker.requester),
        proposal.handle,
        proposal.use,
        proposal.taint,
      )
    }
    const result = vaultAuthorizationResultSchema.parse(await pending)
    if (!this.current(access, worker)) return { kind: 'denied', reason: 'peer' }
    if (requiresTaskApproval && result.kind === 'ticket')
      return { kind: 'denied', reason: 'policy' }
    if (
      result.kind === 'approval' &&
      (result.request.requester.id !== worker.requester.id ||
        result.request.item.handle !== proposal.handle ||
        result.request.digest !== vaultUseDigest(proposal.use))
    )
      return { kind: 'denied', reason: 'digest' }
    if (result.kind === 'ticket') {
      const canSend = (): boolean =>
        this.current(access, worker) &&
        (!scope || canUse()) &&
        result.ticket.requesterId === worker.requester.id &&
        result.ticket.digest === vaultUseDigest(proposal.use) &&
        this.ports.broker.clock.now() < result.ticket.expiresAt
      if (!canSend()) return { kind: 'denied', reason: 'digest' }
      if (!worker.route) throw new Error(UI_TEXT.vault.noAccess)
      await worker.route.handoff(result.ticket, proposal.use, canSend)
      if (!canSend()) return { kind: 'denied', reason: 'peer' }
    }
    return result
  }
  async end(access: VaultWorkerAccess): Promise<void> {
    this.worker(access)
    const ids = Array.from(
      this.descendants(access),
      (candidate) => this.workers.get(candidate)?.requester.id,
    )
    let hasCleanupFailed: boolean
    try {
      this.retire(access)
    } finally {
      const results = await Promise.allSettled(
        ids.map((id) => (id ? this.ports.broker.endRequester(id) : Promise.resolve())),
      )
      hasCleanupFailed = results.some((result) => result.status === 'rejected')
    }
    if (hasCleanupFailed) throw new Error(UI_TEXT.vault.noAccess)
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.generation += 1
    for (const controller of this.opening) controller.abort()
    let hasFailed = false
    try {
      this.unsubscribe()
    } catch {
      hasFailed = true
    }
    const ids = Array.from(this.workers.values(), (worker) => worker.requester.id)
    try {
      for (const access of this.workers.keys())
        try {
          this.retire(access)
        } catch {
          hasFailed = true
        }
    } finally {
      const results = await Promise.allSettled(ids.map((id) => this.ports.broker.endRequester(id)))
      hasFailed ||= results.some((result) => result.status === 'rejected')
    }
    if (hasFailed) throw new Error(UI_TEXT.vault.noAccess)
  }
}

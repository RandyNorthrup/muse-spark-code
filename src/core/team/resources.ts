// The team's shared resources (M96 lane B, PLAN.md D75): the registry of
// exclusive, shared and free resources, and the leases between one window's
// workers.
//
// A resource is an MCP server, a device, a port, or anything else two tasks
// must not use at once. Each is one of three kinds: `exclusive` (one holder
// at a time), `shared` (up to its concurrent-call limit) or `free` (no
// capacity limit). A
// command can be declared to need a resource too (`npm run dev` needs
// `port:3000`); the worker's shell takes that lease before running it.
//
// Leases are held by the window's scheduler (M96c), which owns the single
// `ResourceRegistry` per window, in memory. A lease records its holder (the
// task and its attempt), window, server and generation under a unique id.
// Each call has its own id and state; a late completion cannot settle a
// replacement. A late call from an earlier attempt is refused.
// Across windows there is no lease: a window that sees an exclusive server in
// another window's fresh hint asks the user before starting its own (lane K
// asks; this module names the collision through `externalUserOf`).
//
// The clock and timers are injected so the scheduler (and the tests) drive
// time; production passes nothing and gets the system clock. Pure otherwise:
// no `vscode` import, and user-facing text only through `UI_TEXT` at call
// time, never at module load.
//
// Lane 0's Team region of `src/shared/constants.ts` absorbs `TEAM_LEASE_*`
// at integration; the values below are D75's.

import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

/**
 * Idle release for an MCP server's lease (D75): after this long with no call
 * queued, running or unanswered after a cancel, counted from the last call's
 * terminal answer. A call longer than that keeps the lease, and so does a
 * cancelled call the server never answers.
 */
export const TEAM_LEASE_IDLE_MS = 120_000

/**
 * How long a request for a held resource waits in its queue (D75). Past
 * that, it answers "resource busy" with the holder named.
 */
export const TEAM_LEASE_WAIT_MS = 300_000

/** Unknown servers are shared, with a per-role limit the user sets (D75). */
export const TEAM_SHARED_RESOURCE_DEFAULT_LIMIT = 2

export type ResourceKind = 'exclusive' | 'shared' | 'free'

export const resourceKindSchema = z.enum(['exclusive', 'shared', 'free'])

const sharedLimitSchema = z.int().check(z.gte(1))

export const resourceDeclarationSchema = z.object({
  name: z.string(),
  kind: resourceKindSchema,
  sharedLimit: z.optional(sharedLimitSchema),
  idleRelease: z.optional(z.boolean()),
  commandPatterns: z.optional(z.array(z.string())),
  assignedRoles: z.optional(z.array(z.string())),
})

export type ResourceDeclaration = z.infer<typeof resourceDeclarationSchema>

/** What the defaults match a server by: its command, and its package name. */
export interface ServerIdentity {
  readonly command?: string | undefined
  readonly packageName?: string | undefined
}

/**
 * Known singletons (D75): Chrome Control and other browser-control servers,
 * Playwright with a fixed profile, and serial or device servers. Matched by
 * lowercase substring on the command's basename and on the package name; a
 * substring that hits too widely still only serialises the server, which is
 * the safe direction. The user overrides any server in the panel.
 */
const COMMAND_SINGLETON_TOKENS: readonly string[] = [
  'chrome',
  'chromium',
  'playwright',
  'puppeteer',
  'selenium',
  'browser',
  'serial',
  'usb',
  'adb',
  'modem',
  'tty',
  'gdb',
  'lldb',
  'clipboard',
]

const PACKAGE_SINGLETON_TOKENS: readonly string[] = [
  ...COMMAND_SINGLETON_TOKENS,
  'gadget',
  'device',
]

/** The default kind for a server: exclusive when a singleton matcher hits, else shared. */
export function defaultResourceKind(identity: ServerIdentity): 'exclusive' | 'shared' {
  // The whole command line, not only its basename: wrappers run the package
  // as an argument (`npx <package>`, `uvx <package>`). A token that hits too
  // widely still only serialises the server, which is the safe direction,
  // and the user overrides any server in the panel.
  const command = (identity.command ?? '').toLowerCase()
  if (command !== '' && COMMAND_SINGLETON_TOKENS.some((token) => command.includes(token))) {
    return 'exclusive'
  }
  const packageName = (identity.packageName ?? '').toLowerCase()
  return packageName !== '' && PACKAGE_SINGLETON_TOKENS.some((token) => packageName.includes(token))
    ? 'exclusive'
    : 'shared'
}

export interface ResourceDeclarationInit {
  readonly name: string
  readonly kind: ResourceKind
  readonly sharedLimit?: number | undefined
  /** False for a command's declared resource: held until its process exits, never on idleness. */
  readonly idleRelease?: boolean | undefined
  readonly commandPatterns?: readonly string[] | undefined
  readonly assignedRoles?: readonly string[] | undefined
}

/** One entry of the repository's lowering file, which may only narrow (D75). */
export const repositoryResourceSchema = z.object({
  name: z.string(),
  kind: z.optional(resourceKindSchema),
  sharedLimit: z.optional(sharedLimitSchema),
})

export type RepositoryResource = z.infer<typeof repositoryResourceSchema>

/** Who holds (or waits for) a lease: the task, and which attempt of it. */
export interface LeaseHolder {
  readonly role: string
  /** The orchestrator holds leases under this role: a holder like any other (D75). */
  readonly taskId: string
  readonly attempt: number
}

export type AcquireOutcome =
  | { readonly status: 'held'; readonly lease: LeaseToken }
  | { readonly status: 'busy'; readonly holder: LeaseHolder }
  | { readonly status: 'stale' }
  | { readonly status: 'closed' }
  | { readonly status: 'cancelled' }

export type CallAdmission =
  | { readonly status: 'ok' }
  | { readonly status: 'stale-attempt' }
  | { readonly status: 'not-holder'; readonly holder: LeaseHolder | undefined }
  | { readonly status: 'taken-back'; readonly holder: LeaseHolder }

/** Another window's hint (lane K feeds fresh ones): the exclusive servers it runs. */
export interface ExternalResourceHint {
  readonly windowLabel: string
  readonly exclusiveServers: readonly string[]
}

/** Time, injected so the scheduler and the tests drive it. */
export interface RegistryClock {
  readonly now: () => number
  readonly schedule: (callback: () => void, ms: number) => { cancel(): void }
}

const systemClock: RegistryClock = {
  now: () => Date.now(),
  schedule: (callback: () => void, ms: number) => {
    const timer = setTimeout(callback, ms)
    return {
      cancel: () => {
        clearTimeout(timer)
      },
    }
  },
}

/** Identity required for every release; holder identity alone cannot release a lease. */
export interface LeaseToken {
  readonly id: string
  readonly generation: number
  readonly windowId: string
  readonly resourceName: string
  readonly holder: LeaseHolder
}

export interface CallToken {
  readonly id: string
  readonly lease: LeaseToken
}

export type AcquireCallOutcome =
  | Exclude<AcquireOutcome, { readonly status: 'held' | 'cancelled' }>
  | { readonly status: 'held'; readonly call: CallToken; readonly signal: AbortSignal }
  | { readonly status: 'cancelled'; readonly reason: unknown }
  | { readonly status: 'duplicate' }

type LeaseState = 'requested' | 'granted' | 'releasing' | 'released'
type CallState = 'pending' | 'dispatched' | 'answered' | 'failed' | 'abandoned'

interface HeldLease {
  readonly token: LeaseToken
  state: LeaseState
  readonly calls: Map<string, LiveCall>
  idleTimer: { cancel(): void } | undefined
  lastTerminalAt: number | undefined
  /** Generic acquisition (a command) must not be undone by a cancelled call. */
  explicitOwner: boolean
}

interface LiveCall {
  readonly token: CallToken
  readonly clientId: string
  readonly requestId: string
  readonly controller: AbortController
  readonly detach: () => void
  state: CallState
  admitted: boolean
}

interface Waiter {
  readonly lease: HeldLease
  readonly call: LiveCall | undefined
  readonly deadline: number
  readonly finish: (outcome: AcquireOutcome) => void
}

interface LiveResource {
  declaration: ResourceDeclaration
  transitioning: boolean
  generation: number
  leases: HeldLease[]
  waiters: Waiter[]
  readonly takenBack: Map<string, LeaseHolder>
  takeBackTo: LeaseHolder | undefined
}

const windowSequence = { next: 0 }

function holderKey(holder: LeaseHolder): string {
  return `${holder.taskId}\n${String(holder.attempt)}`
}

function normalizeCommand(line: string): string {
  return line.trim().replaceAll(/\s+/g, ' ')
}

/**
 * "resource busy, held by `<role>` task `<id>`" (D75): the answer past the
 * wait, and the holder's next call after Take back.
 */
export function busyText(holder: LeaseHolder): string {
  return fill(UI_TEXT.teamResourceBusy, { role: holder.role, taskId: holder.taskId })
}

export interface RegistryDeps {
  readonly windowId?: string | undefined
  readonly clock?: RegistryClock | undefined
  /** How long a waiter waits: `TEAM_LEASE_WAIT_MS` unless a test shortens it. */
  readonly waitMs?: number | undefined
  /** Idle release: `TEAM_LEASE_IDLE_MS` unless a test shortens it. */
  readonly idleMs?: number | undefined
}

export interface RepositoryRefusal {
  readonly name: string
  readonly reason: string
}

export interface ResourceSnapshot {
  readonly name: string
  readonly kind: ResourceKind
  readonly holders: readonly LeaseHolder[]
  readonly waiters: readonly LeaseHolder[]
}

export class ResourceRegistry {
  private readonly clock: RegistryClock
  private readonly waitMs: number
  private readonly idleMs: number
  private readonly resources = new Map<string, LiveResource>()
  private readonly retired = new Map<string, number>()
  private closed = false
  private readonly windowId: string
  private readonly registryId: number
  private nextId = 0
  private readonly leases = new Map<string, HeldLease>()
  private readonly calls = new Map<string, LiveCall>()

  public constructor(deps: RegistryDeps = {}) {
    windowSequence.next += 1
    this.registryId = windowSequence.next
    this.windowId = deps.windowId ?? `window:${String(windowSequence.next)}`
    this.clock = deps.clock ?? systemClock
    this.waitMs = deps.waitMs ?? TEAM_LEASE_WAIT_MS
    this.idleMs = deps.idleMs ?? TEAM_LEASE_IDLE_MS
  }

  private live(name: string): LiveResource | undefined {
    return this.resources.get(name)
  }

  private capacityOf(declaration: ResourceDeclaration): number {
    if (declaration.kind === 'free') {
      return Infinity
    }
    return declaration.kind === 'exclusive'
      ? 1
      : (declaration.sharedLimit ?? TEAM_SHARED_RESOURCE_DEFAULT_LIMIT)
  }

  private isRetired(holder: LeaseHolder): boolean {
    return (this.retired.get(holder.taskId) ?? -1) >= holder.attempt
  }

  private newLease(live: LiveResource, holder: LeaseHolder): HeldLease {
    this.nextId += 1
    live.generation += 1
    const lease: HeldLease = {
      token: {
        id: `${this.windowId}:${String(this.registryId)}:lease:${String(this.nextId)}`,
        generation: live.generation,
        windowId: this.windowId,
        resourceName: live.declaration.name,
        holder: { ...holder },
      },
      state: 'requested',
      calls: new Map(),
      idleTimer: undefined,
      lastTerminalAt: undefined,
      explicitOwner: false,
    }
    live.leases.push(lease)
    this.leases.set(lease.token.id, lease)
    return lease
  }

  private leaseFor(token: LeaseToken): HeldLease | undefined {
    const lease = this.leases.get(token.id)
    return lease?.token.generation === token.generation &&
      lease.token.windowId === token.windowId &&
      lease.token.resourceName === token.resourceName &&
      holderKey(lease.token.holder) === holderKey(token.holder)
      ? lease
      : undefined
  }

  private callFor(token: CallToken): LiveCall | undefined {
    const call = this.calls.get(token.id)
    return call?.token.lease.id === token.lease.id && this.leaseFor(token.lease) !== undefined
      ? call
      : undefined
  }

  private active(live: LiveResource): HeldLease[] {
    return live.leases.filter((lease) => lease.state === 'granted' || lease.state === 'releasing')
  }

  private canAdmit(live: LiveResource, lease: HeldLease, call: LiveCall | undefined): boolean {
    if (
      lease.state === 'releasing' ||
      lease.state === 'released' ||
      (live.takeBackTo !== undefined &&
        holderKey(live.takeBackTo) !== holderKey(lease.token.holder))
    ) {
      return false
    }
    if (live.declaration.kind === 'exclusive') {
      return this.active(live).every((other) => other === lease)
    }
    if (call === undefined || live.declaration.kind === 'free') {
      return true
    }
    let running = 0
    for (const other of live.leases) {
      for (const entry of other.calls.values()) {
        if (entry.admitted) running += 1
      }
    }
    return running < this.capacityOf(live.declaration)
  }

  private finishCall(call: LiveCall, state: 'answered' | 'failed' | 'abandoned'): void {
    call.state = state
    call.detach()
    this.calls.delete(call.token.id)
    const lease = this.leaseFor(call.token.lease)
    lease?.calls.delete(call.token.id)
    if (lease === undefined) {
      return
    }
    if (state !== 'abandoned') {
      lease.lastTerminalAt = this.clock.now()
    }
    this.idleOrRelease(lease)
  }

  private idleOrRelease(lease: HeldLease): void {
    if (lease.calls.size > 0) {
      return
    }
    const live = this.live(lease.token.resourceName)
    if (live === undefined || live.waiters.some((waiter) => waiter.lease === lease)) {
      return
    }
    if (
      lease.state === 'releasing' ||
      lease.state === 'requested' ||
      (!lease.explicitOwner && lease.lastTerminalAt === undefined)
    ) {
      this.release(lease.token)
      return
    }
    if (
      this.closed ||
      live.declaration.idleRelease === false ||
      lease.lastTerminalAt === undefined
    ) {
      return
    }
    lease.idleTimer?.cancel()
    lease.idleTimer = this.clock.schedule(
      () => {
        this.release(lease.token)
      },
      Math.max(0, this.idleMs - (this.clock.now() - lease.lastTerminalAt)),
    )
  }

  /** FIFO admission; every granted pending call reserves capacity before its continuation runs. */
  private pump(name: string): void {
    const live = this.live(name)
    if (live === undefined || this.closed || live.transitioning) {
      return
    }
    const to = live.takeBackTo
    if (to !== undefined && this.active(live).length === 0) {
      live.takeBackTo = undefined
      if (!this.isRetired(to)) {
        const lease =
          live.leases.find((entry) => holderKey(entry.token.holder) === holderKey(to)) ??
          this.newLease(live, to)
        lease.state = 'granted'
        lease.explicitOwner = true
      }
    }
    for (const waiter of live.waiters) {
      const holder = waiter.lease.token.holder
      const taken = live.takenBack.get(holderKey(holder))
      if (this.isRetired(holder)) {
        waiter.finish({ status: 'stale' })
      } else if (taken !== undefined || this.clock.now() >= waiter.deadline) {
        waiter.finish({
          status: 'busy',
          holder: taken ?? this.active(live)[0]?.token.holder ?? holder,
        })
      } else if (this.canAdmit(live, waiter.lease, waiter.call)) {
        waiter.lease.state = 'granted'
        if (waiter.call === undefined) {
          waiter.lease.explicitOwner = true
        } else {
          waiter.call.admitted = true
        }
        waiter.finish({ status: 'held', lease: waiter.lease.token })
      }
    }
  }

  private wake(name: string): void {
    this.pump(name)
  }

  private refusal(
    resourceName: string,
    holder: LeaseHolder,
    signal?: AbortSignal,
  ): Exclude<AcquireOutcome, { readonly status: 'held' }> | undefined {
    if (this.closed) return { status: 'closed' }
    if (signal?.aborted === true) return { status: 'cancelled' }
    if (this.isRetired(holder)) return { status: 'stale' }
    const taken = this.live(resourceName)?.takenBack.get(holderKey(holder))
    return taken === undefined ? undefined : { status: 'busy', holder: taken }
  }

  private requestedLease(resourceName: string, holder: LeaseHolder): HeldLease {
    if (this.live(resourceName) === undefined) {
      this.declare({ name: resourceName, kind: 'free' })
    }
    const live = this.live(resourceName)
    if (live === undefined) throw new Error('Resource declaration failed')
    return (
      live.leases.find(
        (lease) =>
          lease.state !== 'releasing' && holderKey(lease.token.holder) === holderKey(holder),
      ) ?? this.newLease(live, holder)
    )
  }

  private wait(
    lease: HeldLease,
    call: LiveCall | undefined,
    signal?: AbortSignal,
  ): Promise<AcquireOutcome> {
    const live = this.live(lease.token.resourceName)
    if (live === undefined) return Promise.resolve({ status: 'closed' })
    lease.idleTimer?.cancel()
    lease.idleTimer = undefined
    return new Promise((resolve) => {
      let isFinished = false
      const waiter: Waiter = {
        lease,
        call,
        deadline: this.clock.now() + this.waitMs,
        finish: (outcome) => {
          if (isFinished) return
          isFinished = true
          live.waiters = live.waiters.filter((entry) => entry !== waiter)
          timer.cancel()
          signal?.removeEventListener('abort', onAbort)
          if (outcome.status !== 'held') {
            if (call === undefined) {
              this.idleOrRelease(lease)
            } else {
              this.finishCall(call, 'abandoned')
            }
          }
          resolve(outcome)
        },
      }
      const onAbort = () => {
        waiter.finish({ status: 'cancelled' })
        this.wake(lease.token.resourceName)
      }
      const timer = this.clock.schedule(() => {
        this.pump(lease.token.resourceName)
      }, this.waitMs)
      live.waiters.push(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pump(lease.token.resourceName)
    })
  }

  /**
   * The user-level set from the panel's Tools and devices section: creates or
   * replaces the declaration. A repository cannot do this; see
   * `applyRepositoryResources`.
   */
  public declare(init: ResourceDeclarationInit): ResourceDeclaration {
    if (init.name === '') {
      throw new Error('A resource needs a name')
    }
    const sharedLimit = init.sharedLimit ?? TEAM_SHARED_RESOURCE_DEFAULT_LIMIT
    if (!sharedLimitSchema.safeParse(sharedLimit).success) {
      throw new Error(`A shared resource's limit is at least 1: ${init.name}`)
    }
    const declaration: ResourceDeclaration = {
      name: init.name,
      kind: init.kind,
      sharedLimit,
      idleRelease: init.idleRelease ?? true,
      commandPatterns: [...(init.commandPatterns ?? [])],
      assignedRoles: [...(init.assignedRoles ?? [])],
    }
    const live = this.resources.get(init.name)
    if (live === undefined) {
      this.resources.set(init.name, {
        declaration,
        transitioning: false,
        generation: 0,
        leases: [],
        waiters: [],
        takenBack: new Map(),
        takeBackTo: undefined,
      })
    } else {
      live.declaration = declaration
    }
    return declaration
  }

  /**
   * The declaration a bridge server gets: the user's override when one is
   * set, else the defaults matched by command and package. Called before the
   * first call, so every bridged server passes through the registry.
   */
  public ensureServer(name: string, identity: ServerIdentity = {}): ResourceDeclaration {
    const live = this.resources.get(name)
    return live === undefined
      ? this.declare({ name, kind: defaultResourceKind(identity), idleRelease: true })
      : live.declaration
  }

  /** A command's declared need: the worker's shell takes the lease before running it. */
  public declareCommandNeed(pattern: string, resourceName: string): void {
    const normalized = normalizeCommand(pattern)
    if (normalized === '') {
      throw new Error('A command pattern needs a command')
    }
    const live = this.resources.get(resourceName)
    if (live === undefined) {
      // A command's resource is held until its process has exited, never on idleness.
      this.declare({
        name: resourceName,
        kind: 'exclusive',
        idleRelease: false,
        commandPatterns: [normalized],
      })
      return
    }
    if (!live.declaration.commandPatterns?.includes(normalized)) {
      live.declaration = {
        ...live.declaration,
        commandPatterns: [...(live.declaration.commandPatterns ?? []), normalized],
      }
    }
  }

  /** The resource a command line needs, if a declared pattern matches it. */
  public resourceForCommand(commandLine: string): string | undefined {
    const line = normalizeCommand(commandLine)
    if (line === '') {
      return undefined
    }
    for (const live of this.resources.values()) {
      const patterns = live.declaration.commandPatterns ?? []
      for (const pattern of patterns) {
        if (line === pattern || line.startsWith(`${pattern} `)) {
          return live.declaration.name
        }
      }
    }
    return undefined
  }

  /**
   * The repository's lowering file (D75): it may only narrow. It cannot
   * declare a resource free, loosen exclusive to shared, or raise a limit.
   */
  public applyRepositoryResources(entries: readonly RepositoryResource[]): {
    readonly accepted: readonly string[]
    readonly refused: readonly RepositoryRefusal[]
  } {
    const accepted: string[] = []
    const refused: RepositoryRefusal[] = []
    for (const entry of entries) {
      if (
        entry.sharedLimit !== undefined &&
        !sharedLimitSchema.safeParse(entry.sharedLimit).success
      ) {
        refused.push({ name: entry.name, reason: 'invalid shared limit' })
        continue
      }
      const live = this.resources.get(entry.name)
      if (live === undefined) {
        refused.push({ name: entry.name, reason: 'unknown resource' })
        continue
      }
      const current = live.declaration
      const nextKind = entry.kind ?? current.kind
      if (nextKind === 'free' && current.kind !== 'free') {
        refused.push({ name: entry.name, reason: 'a repository cannot declare a resource free' })
        continue
      }
      if (nextKind !== 'exclusive' && current.kind === 'exclusive') {
        refused.push({
          name: entry.name,
          reason: 'a repository cannot loosen an exclusive resource',
        })
        continue
      }
      const nextLimit =
        entry.sharedLimit ?? current.sharedLimit ?? TEAM_SHARED_RESOURCE_DEFAULT_LIMIT
      const currentLimit = current.sharedLimit ?? TEAM_SHARED_RESOURCE_DEFAULT_LIMIT
      if (nextLimit > currentLimit) {
        refused.push({ name: entry.name, reason: 'a repository cannot raise a limit' })
        continue
      }
      live.declaration = { ...current, kind: nextKind, sharedLimit: nextLimit }
      accepted.push(entry.name)
    }
    return { accepted, refused }
  }

  /** The servers explicitly assigned by the user to this role. */
  public serversForRole(role: string): readonly string[] {
    const names: string[] = []
    for (const live of this.resources.values()) {
      const assigned = live.declaration.assignedRoles ?? []
      if (assigned.includes(role)) {
        names.push(live.declaration.name)
      }
    }
    return names
  }

  public list(): readonly ResourceDeclaration[] {
    return Array.from(this.resources.values(), (live) => live.declaration)
  }

  /** Who holds what and who waits: the Agent map's source (D75). */
  public snapshot(): readonly ResourceSnapshot[] {
    return Array.from(this.resources.values(), (live) => ({
      name: live.declaration.name,
      kind: live.declaration.kind,
      holders:
        live.declaration.kind === 'free'
          ? []
          : this.active(live).map((lease) => lease.token.holder),
      waiters: live.waiters.map((waiter) => waiter.lease.token.holder),
    }))
  }

  /**
   * Reserves ownership without dispatching work. A command uses acquireCall
   * and dispatch until proved process exit; release names the returned lease.
   */
  public acquire(
    resourceName: string,
    holder: LeaseHolder,
    signal?: AbortSignal,
  ): Promise<AcquireOutcome> {
    const refused = this.refusal(resourceName, holder, signal)
    return refused === undefined
      ? this.wait(this.requestedLease(resourceName, holder), undefined, signal)
      : Promise.resolve(refused)
  }

  /** Called only after local validation. Each admission gets an independent call record. */
  public async acquireCall(
    resourceName: string,
    holder: LeaseHolder,
    clientId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<AcquireCallOutcome> {
    const refused = this.refusal(resourceName, holder, signal)
    if (refused !== undefined) {
      return refused.status === 'cancelled' ? { ...refused, reason: signal.reason } : refused
    }
    for (const call of this.calls.values()) {
      if (call.clientId === clientId && call.requestId === requestId) {
        return { status: 'duplicate' }
      }
    }
    const lease = this.requestedLease(resourceName, holder)
    this.nextId += 1
    const token: CallToken = {
      id: `${this.windowId}:${String(this.registryId)}:call:${String(this.nextId)}`,
      lease: lease.token,
    }
    const controller = new AbortController()
    const onAbort = () => {
      this.cancelCall(token, signal.reason)
    }
    const call: LiveCall = {
      token,
      clientId,
      requestId,
      controller,
      detach: () => {
        signal.removeEventListener('abort', onAbort)
      },
      state: 'pending',
      admitted: false,
    }
    lease.calls.set(token.id, call)
    this.calls.set(token.id, call)
    signal.addEventListener('abort', onAbort, { once: true })
    const outcome = await this.wait(lease, call, controller.signal)
    if (outcome.status === 'held') return { status: 'held', call: token, signal: controller.signal }
    return outcome.status === 'cancelled'
      ? { ...outcome, reason: controller.signal.reason }
      : outcome
  }

  /** Atomic pending-to-dispatched transition: cancellation/revocation before this creates no liability. */
  public dispatch(token: CallToken): AbortSignal | undefined {
    const call = this.callFor(token)
    const lease = this.leaseFor(token.lease)
    if (call === undefined || lease === undefined || call.state !== 'pending') return undefined
    if (
      !call.admitted ||
      lease.state !== 'granted' ||
      this.refusal(token.lease.resourceName, lease.token.holder, call.controller.signal) !==
        undefined
    ) {
      this.cancelCall(token)
      return undefined
    }
    call.state = 'dispatched'
    return call.controller.signal
  }

  /** Terminal server answers alone settle dispatched liability. Duplicate/old completions do nothing. */
  public settle(token: CallToken, state: 'answered' | 'failed'): void {
    const call = this.callFor(token)
    if (call?.state !== 'dispatched') return
    this.finishCall(call, state)
    this.wake(token.lease.resourceName)
  }

  public cancelCall(token: CallToken, reason?: unknown): void {
    const call = this.callFor(token)
    if (call === undefined) return
    // Delete a pending record only after the waiter has heard its abort.
    call.controller.abort(reason)
    if (call.state === 'pending' && this.calls.has(token.id)) this.finishCall(call, 'abandoned')
    this.wake(token.lease.resourceName)
  }

  public cancelClient(clientId: string, resourceName?: string, requestId?: string): void {
    const tokens: CallToken[] = []
    for (const call of this.calls.values()) {
      if (
        call.clientId === clientId &&
        (resourceName === undefined || call.token.lease.resourceName === resourceName) &&
        (requestId === undefined || call.requestId === requestId)
      )
        tokens.push(call.token)
    }
    // Snapshot matching identities before abort listeners can re-enter.
    for (const token of tokens) this.cancelCall(token)
  }

  /** Release requires exact lease id/generation and waits for every pending/dispatched call. */
  public release(token: LeaseToken): void {
    const lease = this.leaseFor(token)
    if (lease === undefined) return
    lease.state = 'releasing'
    lease.idleTimer?.cancel()
    lease.idleTimer = undefined
    for (const call of lease.calls.values()) {
      if (call.state === 'pending') this.cancelCall(call.token)
    }
    if (lease.calls.size > 0) return
    const live = this.live(token.resourceName)
    if (live === undefined || live.waiters.some((waiter) => waiter.lease === lease)) return
    lease.state = 'released'
    this.leases.delete(token.id)
    live.leases = live.leases.filter((entry) => entry !== lease)
    this.wake(token.resourceName)
  }

  public retireAttempt(taskId: string, attempt: number): void {
    this.retired.set(taskId, Math.max(this.retired.get(taskId) ?? -1, attempt))
    for (const [name, live] of this.resources) {
      for (const lease of live.leases) {
        if (lease.token.holder.taskId === taskId && lease.token.holder.attempt <= attempt) {
          this.release(lease.token)
        }
      }
      this.wake(name)
    }
  }

  public checkCall(resourceName: string, holder: LeaseHolder): CallAdmission {
    if (this.isRetired(holder)) return { status: 'stale-attempt' }
    const live = this.live(resourceName)
    if (live === undefined || live.declaration.kind === 'free') return { status: 'ok' }
    const taken = live.takenBack.get(holderKey(holder))
    if (taken !== undefined) return { status: 'taken-back', holder: taken }
    return this.active(live).some(
      (lease) => lease.state === 'granted' && holderKey(lease.token.holder) === holderKey(holder),
    )
      ? { status: 'ok' }
      : { status: 'not-holder', holder: this.active(live)[0]?.token.holder }
  }

  public takeBack(resourceName: string, to: LeaseHolder): void {
    const live = this.live(resourceName)
    if (live === undefined) return
    live.takeBackTo = to
    live.takenBack.delete(holderKey(to))
    for (const lease of live.leases) {
      if (holderKey(lease.token.holder) === holderKey(to)) {
        continue
      }

      live.takenBack.set(holderKey(lease.token.holder), to)
      this.release(lease.token)
    }
    this.wake(resourceName)
  }

  /** Proved process exit, or explicit user override: abandon old calls, then release those exact leases. */
  public markServerExited(resourceName: string): void {
    const live = this.live(resourceName)
    if (live === undefined) return
    // Keep never-dispatched waiters; abandon only the generations that used
    // the exited server. Queue pumping waits for the complete transition.
    live.transitioning = true
    try {
      for (const lease of this.active(live)) {
        lease.state = 'releasing'
        for (const call of lease.calls.values()) {
          call.controller.abort()
          this.finishCall(call, 'abandoned')
        }
        this.release(lease.token)
      }
    } finally {
      live.transitioning = false
    }
    this.wake(resourceName)
  }

  public releaseAnyway(resourceName: string): void {
    this.markServerExited(resourceName)
  }

  /**
   * The hint question (D75): the other window running this exclusive server,
   * when a fresh hint names it. The caller (lane K) passes fresh hints only;
   * a stale or missing hint asks nothing.
   */
  public externalUserOf(
    resourceName: string,
    freshHints: readonly ExternalResourceHint[],
  ): string | undefined {
    const live = this.live(resourceName)
    return live?.declaration.kind === 'exclusive'
      ? freshHints.find((hint) => hint.exclusiveServers.includes(resourceName))?.windowLabel
      : undefined
  }

  /** Closing cancels pending calls and timers; dispatched uncertainty remains owned. */
  public close(): void {
    this.closed = true
    for (const live of this.resources.values()) {
      for (const waiter of live.waiters) waiter.finish({ status: 'closed' })
      for (const lease of live.leases) {
        lease.idleTimer?.cancel()
        lease.idleTimer = undefined
        this.release(lease.token)
        for (const call of lease.calls.values()) this.cancelCall(call.token)
      }
    }
  }
}

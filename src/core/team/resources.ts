// The team's shared resources (M96 lane B, PLAN.md D75): the registry of
// exclusive, shared and free resources, and the leases between one window's
// workers.
//
// A resource is an MCP server, a device, a port, or anything else two tasks
// must not use at once. Each is one of three kinds: `exclusive` (one holder
// at a time), `shared` (up to its limit at once) or `free` (no lease). A
// command can be declared to need a resource too (`npm run dev` needs
// `port:3000`); the worker's shell takes that lease before running it.
//
// Leases are held by the window's scheduler (M96c), which owns the single
// `ResourceRegistry` per window, in memory. A lease records its holder (the
// task and its attempt); a late call from an earlier attempt is refused.
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

export const resourceDeclarationSchema = z.object({
  name: z.string(),
  kind: resourceKindSchema,
  sharedLimit: z.optional(z.number()),
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
  sharedLimit: z.optional(z.number()),
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
  | { readonly status: 'held' }
  | { readonly status: 'busy'; readonly holder: LeaseHolder }
  | { readonly status: 'stale' }
  | { readonly status: 'closed' }

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
  readonly delay: (ms: number) => Promise<void>
  readonly schedule: (callback: () => void, ms: number) => { cancel(): void }
}

const systemClock: RegistryClock = {
  now: () => Date.now(),
  delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  schedule: (callback: () => void, ms: number) => {
    const timer = setTimeout(callback, ms)
    return {
      cancel: () => {
        clearTimeout(timer)
      },
    }
  },
}

interface HeldLease {
  holder: LeaseHolder
  openCalls: number
  uncertainCalls: number
  lastTerminalAt: number | undefined
  idleTimer: { cancel(): void } | undefined
  /**
   * Set by Take back: this previous holder's next call is told the resource
   * is busy, naming who took it.
   */
  takenBackBy: LeaseHolder | undefined
}

interface Waiter {
  holder: LeaseHolder
  deadline: number
  resolve: (outcome: AcquireOutcome) => void
}

interface LiveResource {
  declaration: ResourceDeclaration
  leases: HeldLease[]
  waiters: Waiter[]
}

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

  public constructor(deps: RegistryDeps = {}) {
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

  private grant(live: LiveResource, holder: LeaseHolder): void {
    live.leases.push({
      holder,
      openCalls: 0,
      uncertainCalls: 0,
      lastTerminalAt: undefined,
      idleTimer: undefined,
      takenBackBy: undefined,
    })
  }

  /** Hands freed capacity to the queue's head, in order; expired waiters hear "busy". */
  private pump(name: string): void {
    const live = this.live(name)
    if (live === undefined || this.closed) {
      return
    }
    const now = this.clock.now()
    while (live.waiters.length > 0) {
      const waiter = live.waiters[0]
      if (waiter === undefined) {
        return
      }
      if (this.isRetired(waiter.holder)) {
        live.waiters.shift()
        waiter.resolve({ status: 'stale' })
        continue
      }
      if (now >= waiter.deadline) {
        live.waiters.shift()
        const holder = live.leases[0]?.holder ?? waiter.holder
        waiter.resolve({ status: 'busy', holder })
        continue
      }
      if (live.leases.length >= this.capacityOf(live.declaration)) {
        return
      }
      live.waiters.shift()
      this.grant(live, waiter.holder)
      waiter.resolve({ status: 'held' })
    }
  }

  private wake(name: string): void {
    this.pump(name)
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
    if (!Number.isSafeInteger(sharedLimit) || sharedLimit < 1) {
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
      this.resources.set(init.name, { declaration, leases: [], waiters: [] })
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

  /** The servers a role may use: assigned ones, or every unassigned server. */
  public serversForRole(role: string): readonly string[] {
    const names: string[] = []
    for (const live of this.resources.values()) {
      const assigned = live.declaration.assignedRoles ?? []
      if (assigned.length === 0 || assigned.includes(role)) {
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
      holders: live.leases.map((lease) => lease.holder),
      waiters: live.waiters.map((waiter) => waiter.holder),
    }))
  }

  /**
   * Takes the lease, waiting in its queue up to the wait. One holder's
   * re-entry (its next call's admission) answers at once. Unknown resources
   * are free: held with no lease tracked.
   */
  public acquire(resourceName: string, holder: LeaseHolder): Promise<AcquireOutcome> {
    const live = this.live(resourceName)
    if (live === undefined) {
      return Promise.resolve({ status: 'held' })
    }
    if (this.closed) {
      return Promise.resolve({ status: 'closed' })
    }
    if (this.isRetired(holder)) {
      return Promise.resolve({ status: 'stale' })
    }
    if (live.declaration.kind === 'free') {
      return Promise.resolve({ status: 'held' })
    }
    if (live.leases.some((lease) => holderKey(lease.holder) === holderKey(holder))) {
      return Promise.resolve({ status: 'held' })
    }
    if (live.leases.length < this.capacityOf(live.declaration)) {
      this.grant(live, holder)
      return Promise.resolve({ status: 'held' })
    }
    const deadline = this.clock.now() + this.waitMs
    return new Promise<AcquireOutcome>((resolve) => {
      live.waiters.push({ holder, deadline, resolve })
      void this.clock.delay(this.waitMs).then(() => {
        this.pump(resourceName)
      })
    })
  }

  /** Releases the holder's lease: at finish, stop and cancel (D75), by the holder. */
  public release(resourceName: string, holder: LeaseHolder): void {
    const live = this.live(resourceName)
    if (live === undefined) {
      return
    }
    const key = holderKey(holder)
    const index = live.leases.findIndex((lease) => holderKey(lease.holder) === key)
    if (index === -1) {
      return
    }
    const [lease] = live.leases.splice(index, 1)
    lease?.idleTimer?.cancel()
    this.wake(resourceName)
  }

  /**
   * Retires the attempt: its leases are released, and its late calls are
   * refused by attempt number (D75).
   */
  public retireAttempt(taskId: string, attempt: number): void {
    this.retired.set(taskId, Math.max(this.retired.get(taskId) ?? -1, attempt))
    // Every queue is pumped, not only the changed ones: a waiter retired
    // while waiting hears it at once instead of at its deadline.
    for (const [name, live] of this.resources) {
      live.leases = live.leases.filter((lease) => {
        if (lease.holder.taskId === taskId && lease.holder.attempt <= attempt) {
          lease.idleTimer?.cancel()
          return false
        }
        return true
      })
      this.wake(name)
    }
  }

  /** Every call carries its lease (D75): admits the holder's call, or refuses it. */
  public checkCall(resourceName: string, holder: LeaseHolder): CallAdmission {
    const live = this.live(resourceName)
    if (live === undefined || live.declaration.kind === 'free') {
      return { status: 'ok' }
    }
    const lease = live.leases.find((candidate) => holderKey(candidate.holder) === holderKey(holder))
    if (lease !== undefined) {
      return lease.takenBackBy === undefined
        ? { status: 'ok' }
        : { status: 'taken-back', holder: lease.takenBackBy }
    }
    return this.isRetired(holder)
      ? { status: 'stale-attempt' }
      : { status: 'not-holder', holder: live.leases[0]?.holder }
  }

  /** A call started: idle release waits while any call is open. */
  public callStarted(resourceName: string, holder: LeaseHolder): void {
    const lease = this.live(resourceName)?.leases.find(
      (candidate) => holderKey(candidate.holder) === holderKey(holder),
    )
    if (lease === undefined) {
      return
    }
    lease.openCalls += 1
    lease.idleTimer?.cancel()
    lease.idleTimer = undefined
  }

  /**
   * A call ended. `isTerminal` is false for a cancelled call the server
   * never answered: it stays uncertain and keeps the lease (D75). Idle time
   * is counted from the last terminal answer, never from the call's start.
   */
  public callEnded(resourceName: string, holder: LeaseHolder, isTerminal: boolean): void {
    const live = this.live(resourceName)
    const lease = live?.leases.find(
      (candidate) => holderKey(candidate.holder) === holderKey(holder),
    )
    if (live === undefined || lease === undefined) {
      return
    }
    if (isTerminal) {
      if (lease.openCalls > 0) {
        lease.openCalls -= 1
      } else if (lease.uncertainCalls > 0) {
        lease.uncertainCalls -= 1
      }
      lease.lastTerminalAt = this.clock.now()
    } else if (lease.openCalls > 0) {
      lease.openCalls -= 1
      lease.uncertainCalls += 1
    }
    if (
      live.declaration.idleRelease === false ||
      lease.openCalls !== 0 ||
      lease.uncertainCalls !== 0
    ) {
      return
    }
    lease.idleTimer?.cancel()
    lease.idleTimer = this.clock.schedule(() => {
      const current = this.live(resourceName)?.leases.find(
        (candidate) => holderKey(candidate.holder) === holderKey(holder),
      )
      if (current === undefined) {
        return
      }
      if (current.openCalls === 0 && current.uncertainCalls === 0) {
        this.release(resourceName, holder)
      }
    }, this.idleMs)
  }

  /**
   * Take it back (D75): the lease moves to the orchestrator, and the old
   * holder's next call is told the resource is busy.
   */
  public takeBack(resourceName: string, to: LeaseHolder): void {
    const live = this.live(resourceName)
    if (live === undefined) {
      return
    }
    for (const lease of live.leases) {
      lease.takenBackBy = to
    }
    live.leases.push({
      holder: to,
      openCalls: 0,
      uncertainCalls: 0,
      lastTerminalAt: undefined,
      idleTimer: undefined,
      takenBackBy: undefined,
    })
    this.wake(resourceName)
  }

  /**
   * **Restart server** (D75): a server the window started (stdio) whose
   * process has exited. Every lease on it is released, uncertain calls with
   * them, and the queue moves.
   */
  public markServerExited(resourceName: string): void {
    const live = this.live(resourceName)
    if (live === undefined) {
      return
    }
    for (const lease of live.leases) {
      lease.idleTimer?.cancel()
    }
    live.leases = []
    this.wake(resourceName)
  }

  /**
   * **Release anyway** (D75): a remote server's uncertain call, released as
   * the user's decision, not as proof. The earlier call may still be acting
   * on the resource.
   */
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

  /** The window going away: timers stop, and every waiter hears it. */
  public close(): void {
    this.closed = true
    for (const live of this.resources.values()) {
      for (const lease of live.leases) {
        lease.idleTimer?.cancel()
        lease.idleTimer = undefined
      }
      const waiters = live.waiters.splice(0)
      for (const waiter of waiters) {
        waiter.resolve({ status: 'closed' })
      }
    }
  }
}

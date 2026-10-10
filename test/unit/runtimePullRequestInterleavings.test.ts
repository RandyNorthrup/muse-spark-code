// Every interleaving of the pull request checkout protocol (M123 lane P,
// M123P7): two and three windows run the real protocol
// (`PullRequestCheckoutProtocol`) over the real record store logic
// (`createWorktreeRecordStore`) for one folder. The registry under them is
// a model of the fenced file lease and generations: a hold takes the lock
// and the next fence and reads the head; a publish checks the head's fence
// and the hold's currency, then (a separate step) lands only on the head it
// read. Each await point that touches shared state is a step of a small
// state machine — acquire, publish, link, make, dispatch, remove — and
// the scheduler enumerates every order of those steps, with clock steps
// (a hold's lease running out while it is paused, a window's wall clock
// stepped forward) and trust revoked as further steps. States reached
// again with the same history are explored once. Whatever the order, the
// store never ends with a folder no record names, at most one window
// succeeds, and no git runs for a window whose trust is gone.

import type * as NodeCrypto from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PullRequest } from '../../src/core/git/github'
import { currentProcessOwner } from '../../src/core/locks/processOwner'
import type { CoreLogger } from '../../src/core/logging'
import type { WorktreeRecord } from '../../src/core/worktreeConversations'
import {
  HeldFolderTakenError,
  PullRequestCheckoutProtocol,
  type CheckoutGates,
  type GitGate,
  type MadeFolder,
  type OpenPullRequestResult,
  type PullRequestCheckoutGit,
} from '../../src/runtime/panel/pullRequests/checkout'
import {
  createWorktreeRecordStore,
  type RecordRegistry,
  type RegistryHold,
} from '../../src/runtime/panel/pullRequests/records'
import { PENDING_CHECKOUT_RECOVERY_MS } from '../../src/shared/constants'

// Checkout ids name the window that made them, in order, so a state
// reached again by another order reads the same.
const ids = vi.hoisted(() => ({ running: 'setup', counts: new Map<string, number>() }))

vi.mock('node:crypto', async (importOriginal) => {
  const crypto = await importOriginal<typeof NodeCrypto>()
  return {
    ...crypto,
    randomUUID: () => {
      const count = (ids.counts.get(ids.running) ?? 0) + 1
      ids.counts.set(ids.running, count)
      return `${ids.running}-${String(count)}`
    },
  }
})

const FOLDER = '/data/pr-worktrees/51-interleave'
const SHA = 'c'.repeat(40)
const START = 1_000_000_000_000
const quiet = () => undefined
const log: CoreLogger = { trace: quiet, info: quiet, warn: quiet, error: quiet }
const REMOTE = { name: 'origin', repository: { owner: 'RandyNorthrup', name: 'muse-spark-code' } }
const PULL: PullRequest = {
  number: 51,
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
  state: 'open',
  title: 'A foreign pull request',
  isDraft: false,
  isMerged: false,
  author: { login: 'Piangpi1997', id: 2 },
  headRef: 'feature',
  headSha: SHA,
  headRepository: 'Piangpi1997/muse-spark-code',
  baseRef: 'main',
  baseRepository: 'RandyNorthrup/muse-spark-code',
}

type Label = 'acquire' | 'publish' | 'link' | 'make' | 'dispatch' | 'remove'

/** Where a hold may be paused past its lease: after it read, before or after its checks. */
const STALLABLE: ReadonlySet<Label> = new Set(['publish', 'link', 'make'])

interface Parked {
  readonly label: Label
  readonly isEnabled: () => boolean
  readonly resume: () => void
}

/** Runs one window at a time, from one await point to its next. */
class Scheduler {
  private wake: (() => void) | undefined
  public readonly parked = new Map<string, Parked>()
  public readonly finished = new Set<string>()

  private notify(): void {
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  public point(id: string, label: Label, isEnabled: () => boolean = () => true): Promise<void> {
    return new Promise<void>((resolve) => {
      this.parked.set(id, {
        label,
        isEnabled,
        resume: () => {
          this.parked.delete(id)
          ids.running = id
          resolve()
        },
      })
      this.notify()
    })
  }

  public finish(id: string): void {
    this.finished.add(id)
    this.notify()
  }

  /** Waits until `id` parks at its next point or finishes. */
  public async settle(id: string): Promise<void> {
    while (!this.parked.has(id) && !this.finished.has(id)) {
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }
}

interface Hold {
  readonly id: string
  readonly fence: number
  isExpired: boolean
}

interface Folder {
  readonly maker: string
  readonly identity: bigint
}

interface Budget {
  /** Holds whose lease may run out while paused. */
  expiries: number
  /** Windows whose trust may be revoked. */
  revocations: number
  /** Windows whose wall clock may step an hour forward. */
  steps: number
  /**
   * Publishes that land and then fail (an I/O error after the link: the
   * write is in, its caller is told only that something failed).
   */
  faults?: number
}

interface Window {
  readonly id: string
  /** Its wall clock starts stepped (it judges a pending checkout stale). */
  readonly isStepped?: boolean
}

interface Config {
  readonly windows: readonly Window[]
  readonly budget: Budget
  /**
   * Whose holds may run out (all when undefined), and whether one may stall
   * before its checks too, not only after them (true when undefined).
   */
  readonly expiring?: readonly string[]
  readonly canStallBeforeChecks?: boolean
  /** A finished checkout's record whose folder is gone, at the start. */
  readonly seedReady?: boolean
  /** No lease runs out and no trust goes: exactly one window succeeds. */
  readonly expectOneOwner: boolean
}

/** The world all windows share: the registry, the folder, git's registrations. */
class World {
  // The registry: the fenced lease and the generations, as a model.
  public generation = 0
  public headFence: number | undefined
  public records: readonly WorktreeRecord[] = []
  /** The head's content, digested once per publish. */
  public headDigest = digest('[]')
  public nextFence = 0
  public lock: Hold | undefined
  // The folder and git's worktree registrations (by folder identity).
  public folder: Folder | undefined
  public readonly registrations = new Map<bigint, string>()
  public nextIdentity = 0n
  public readonly trusted = new Map<string, boolean>()
  public readonly offsets = new Map<string, number>()
  /** Each window's history: every value shared state handed it, folded into one digest. */
  public readonly histories = new Map<string, string>()
  public readonly violations: string[] = []
  public readonly revoked = new Set<string>()
  /** The holds whose work is still running, a stale one (run out, still inside) included. */
  public readonly active = new Set<Hold>()
  /** Windows whose next link lands and then fails. */
  public readonly faulty = new Set<string>()

  public constructor(
    public readonly sched: Scheduler,
    public readonly budget: Budget,
    public readonly canStallBeforeChecks: boolean,
    public readonly expiring: readonly string[] | undefined,
    public readonly trace: string[] | undefined,
  ) {}

  /**
   * Whether `id`'s hold must stop between its read, its checks and its
   * link. One that can no longer run out, while no stale hold is still
   * inside its own, is exclusive: in between only other windows' reads and
   * folder steps can run, and each commutes with the read or the write, so
   * it reads, checks and links in one step without losing an outcome. A
   * stale hold can still link in between, so then every hold stops.
   */
  public mustStop(id: string): boolean {
    for (const hold of this.active) {
      if (hold.isExpired) {
        return true
      }
    }
    return (
      (this.budget.faults ?? 0) > 0 ||
      (this.budget.expiries > 0 && (this.expiring === undefined || this.expiring.includes(id)))
    )
  }

  public seen(id: string, what: string): void {
    this.histories.set(id, digest(`${this.histories.get(id) ?? ''}\n${what}`))
    this.trace?.push(`  ${id} saw ${what}`)
  }

  public setRecords(records: readonly WorktreeRecord[]): void {
    this.records = records
    this.headDigest = digest(JSON.stringify(records))
  }

  public isCurrent(hold: Hold): boolean {
    return this.lock === hold && !hold.isExpired
  }

  public registry(id: string): RecordRegistry {
    return {
      read: () => {
        this.seen(id, `read:${this.headDigest}`)
        return Promise.resolve(this.records)
      },
      readSync: () => {
        this.seen(id, `readSync:${this.headDigest}`)
        return this.records
      },
      hold: async <T>(work: (hold: RegistryHold) => Promise<T>): Promise<T> => {
        await this.sched.point(id, 'acquire', () => this.lock === undefined || this.lock.isExpired)
        this.nextFence += 1
        const hold: Hold = { id, fence: this.nextFence, isExpired: false }
        this.lock = hold
        this.active.add(hold)
        const head = { generation: this.generation, fence: this.headFence, records: this.records }
        this.seen(id, `head:${String(head.generation)}:${String(hold.fence)}:${this.headDigest}`)
        try {
          return await work({
            fence: hold.fence,
            records: head.records,
            publish: async (next) => {
              if (this.mustStop(id) && this.canStallBeforeChecks) {
                await this.sched.point(id, 'publish')
              }
              // writeNextGeneration: the fence compare, then the lease check.
              if (head.fence !== undefined && head.fence >= hold.fence) {
                this.seen(id, 'publish:fenced')
                return 'lost'
              }
              if (!this.isCurrent(hold)) {
                this.seen(id, 'publish:stale')
                return 'lost'
              }
              if (this.mustStop(id)) {
                await this.sched.point(id, 'link')
              }
              // The link: only onto the head it read.
              const isFaulty = this.faulty.delete(id)
              if (this.generation !== head.generation) {
                this.seen(id, 'link:lost')
                return 'lost'
              }
              this.generation += 1
              this.setRecords(next)
              this.headFence = hold.fence
              if (isFaulty) {
                // Landed; then the I/O after it failed.
                this.seen(id, 'link:landed-then-failed')
                throw Object.assign(new Error('EACCES: injected after the write landed'), {
                  code: 'EACCES',
                })
              }
              this.seen(id, 'link:written')
              return 'written'
            },
          })
        } finally {
          this.active.delete(hold)
          // A release removes only its own instance.
          if (this.lock === hold) {
            this.lock = undefined
          }
        }
      },
    }
  }

  public git(id: string): PullRequestCheckoutGit {
    const isGoneAfterRemoving = async (made: MadeFolder, gate: GitGate): Promise<boolean> => {
      await this.sched.point(id, 'remove')
      const isOurs = this.folder?.identity === made.identity.ino
      this.seen(id, `remove:${String(isOurs)}`)
      if (!isOurs) {
        return true
      }
      if (made.hasAdded) {
        try {
          gate()
          this.registrations.delete(made.identity.ino)
        } catch {
          // Trust is gone: the registration is left to git's prune.
        }
      }
      this.folder = undefined
      return true
    }
    const addInto = async (made: MadeFolder, gates: CheckoutGates): Promise<void> => {
      await this.sched.point(id, 'dispatch')
      gates.run()
      // The gate passed in this same turn: git starts now.
      if (this.trusted.get(id) !== true) {
        this.violations.push(`${id} ran git without trust`)
      }
      if (this.folder?.identity !== made.identity.ino || this.folder.maker !== id) {
        this.violations.push(`${id} added a worktree into a folder it did not make`)
      }
      this.registrations.set(made.identity.ino, id)
      made.hasAdded = true
      this.seen(id, 'dispatch:add')
    }
    const checkOut = async (
      gates: CheckoutGates,
      claim: () => Promise<MadeFolder>,
      isHeld: boolean,
    ): Promise<void> => {
      if (isHeld) {
        // The listing, before anything is made.
        await this.sched.point(id, 'dispatch')
        gates.run()
        this.seen(id, 'dispatch:list')
      }
      const made = await claim()
      try {
        await addInto(made, gates)
      } catch (error: unknown) {
        await isGoneAfterRemoving(made, gates.cleanup)
        throw error
      }
    }
    return {
      fetch: () => Promise.resolve(),
      readFetchHead: () => Promise.resolve(SHA),
      claimFolder: async () => {
        await this.sched.point(id, 'make')
        if (this.folder !== undefined) {
          this.seen(id, 'make:taken')
          throw new HeldFolderTakenError(FOLDER)
        }
        this.nextIdentity += 1n
        this.folder = { maker: id, identity: this.nextIdentity }
        this.seen(id, `make:${String(this.nextIdentity)}`)
        return {
          folder: FOLDER,
          identity: { dev: 1n, ino: this.nextIdentity },
          bornNs: 0n,
          hasAdded: false,
        }
      },
      addOwnWorktree: (_cwd, _folder, _sha, gates, claim) => checkOut(gates, claim, false),
      checkOutHeld: (_folder, _sha, _cwd, gates, claim) => checkOut(gates, claim, true),
      removeMade: (_cwd, made, gate) => isGoneAfterRemoving(made, gate),
      identityOf: (made) => {
        const isMade = this.folder?.identity === made.identity.ino
        this.seen(id, `identity:${String(isMade)}`)
        return Promise.resolve(isMade ? `1:${String(made.identity.ino)}:0` : undefined)
      },
    }
  }

  /** Everything that decides what happens next, as one string. */
  public key(): string {
    const windows = sortedKeys(this.histories).map((id) => {
      const parked =
        this.sched.parked.get(id)?.label ?? (this.sched.finished.has(id) ? 'done' : '?')
      return `${id}@${parked}#${this.histories.get(id) ?? ''}`
    })
    return [
      this.generation,
      this.headFence,
      this.nextFence,
      this.lock === undefined
        ? '-'
        : `${this.lock.id}:${String(this.lock.fence)}:${String(this.lock.isExpired)}`,
      this.headDigest,
      this.folder === undefined ? '-' : `${this.folder.maker}:${String(this.folder.identity)}`,
      JSON.stringify([...this.registrations].map(([key, value]) => `${String(key)}=${value}`)),
      JSON.stringify([...this.trusted]),
      JSON.stringify([...this.offsets]),
      `${String(this.budget.expiries)}/${String(this.budget.revocations)}/${String(this.budget.steps)}/${String(this.budget.faults ?? 0)}`,
      Array.from(this.faulty, (id) => id)
        .toSorted((left, right) => left.localeCompare(right))
        .join(','),
      ...windows,
    ].join('|')
  }
}

/** A map's keys in one order, whatever order they were added in. */
function sortedKeys(map: ReadonlyMap<string, unknown>): string[] {
  return Array.from(map.keys(), (key) => key).toSorted((left, right) => left.localeCompare(right))
}

/** Two 32-bit FNV-1a variants: a 64-bit digest of a window's history. */
function digest(text: string): string {
  let left = 0x81_1c_9d_c5
  let right = 0x01_00_01_93
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index) ?? 0
    left = Math.imul(left ^ code, 0x01_00_01_93) >>> 0
    right = Math.imul(right ^ code, 0x05_f5_e1_01) >>> 0
  }
  return `${left.toString(16)}${right.toString(16)}`
}

interface Choice {
  choice: number
  readonly count: number
  /** One of the first steps, fixed for one part of the search: never advanced. */
  readonly isPinned?: boolean
  /** A pinned step's alternatives, as the run found them. */
  width?: number
}

type Step =
  | { readonly kind: 'run'; readonly id: string }
  | { readonly kind: 'expire' }
  | { readonly kind: 'revoke'; readonly id: string }
  | { readonly kind: 'step'; readonly id: string }
  | { readonly kind: 'fault'; readonly id: string }

interface Run {
  readonly outcome: 'finished' | 'pruned'
  readonly world: World
  readonly results: ReadonlyMap<string, OpenPullRequestResult>
}

function seededReady(): WorktreeRecord {
  return {
    folder: FOLDER,
    repositoryRoot: '/repo',
    createdAt: START - 10_000,
    checkoutId: 'seed-1',
    revision: 2,
    fence: 0,
    folderIdentity: '1:99:0',
    pullRequest: {
      repository: 'RandyNorthrup/muse-spark-code',
      number: 51,
      url: PULL.url,
      title: PULL.title,
      author: PULL.author.login,
      headSha: SHA,
      isAuthoredByUser: false,
    },
    isHeld: true,
  }
}

/** One run: replays `choices`, then explores new states first-choice-first. */
async function runOnce(
  config: Config,
  choices: Choice[],
  visited: Set<string>,
  isHeld: boolean,
  trace?: string[],
): Promise<Run> {
  const sched = new Scheduler()
  const world = new World(
    sched,
    { ...config.budget },
    config.canStallBeforeChecks ?? true,
    config.expiring,
    trace,
  )
  if (config.seedReady === true) {
    world.setRecords([seededReady()])
    world.generation = 1
    world.headFence = 0
  }
  ids.counts.clear()
  const results = new Map<string, OpenPullRequestResult>()
  for (const window of config.windows) {
    world.trusted.set(window.id, true)
    world.offsets.set(window.id, window.isStepped === true ? PENDING_CHECKOUT_RECOVERY_MS + 1 : 0)
    world.histories.set(window.id, '')
  }
  for (const window of config.windows) {
    const { id } = window
    const protocol = new PullRequestCheckoutProtocol({
      records: createWorktreeRecordStore(world.registry(id), 'linux', log),
      git: world.git(id),
      pathExists: () => {
        world.seen(id, `exists:${String(world.folder !== undefined)}`)
        return world.folder !== undefined
      },
      isTrusted: () => {
        const isTrusted = world.trusted.get(id) === true
        world.seen(id, `trusted:${String(isTrusted)}`)
        return isTrusted
      },
      signal: new AbortController().signal,
      log,
      now: () => {
        const offset = world.offsets.get(id) ?? 0
        world.seen(id, `now:${String(offset)}`)
        return START + offset
      },
      confirm: () => Promise.resolve(false),
      openFolder: () => Promise.resolve(),
      repositoryRoot: '/repo',
    })
    ids.running = id
    void (async () => {
      try {
        results.set(id, await protocol.reserveAndCheckout(FOLDER, REMOTE, 51, PULL, !isHeld))
      } catch (error: unknown) {
        results.set(id, { ok: false, reason: `threw: ${String(error)}` })
      } finally {
        sched.finish(id)
      }
    })()
    await sched.settle(id)
  }
  for (let depth = 0; ; depth += 1) {
    const holder = world.lock
    const steps = stepsOf(config, world)
    if (steps.length === 0) {
      if (sched.finished.size !== config.windows.length) {
        world.violations.push(`deadlock with ${sortedKeys(sched.parked).join(',')} parked`)
      }
      return { outcome: 'finished', world, results }
    }
    let choice: number
    const replayed = choices[depth]
    if (replayed === undefined) {
      const key = world.key()
      if (visited.has(key)) {
        return { outcome: 'pruned', world, results }
      }
      visited.add(key)
      choices.push({ choice: 0, count: steps.length })
      choice = 0
    } else {
      if (replayed.isPinned === true) {
        replayed.width = steps.length
      }
      if (
        replayed.isPinned === true
          ? replayed.choice >= steps.length
          : replayed.count !== steps.length
      ) {
        throw new Error(
          `replay diverged at ${String(depth)}: ${String(replayed.count)} vs ${String(steps.length)}`,
        )
      }
      choice = replayed.choice
    }
    const step = steps[choice]
    if (step === undefined) {
      throw new Error('no such step')
    }
    trace?.push(
      step.kind === 'run'
        ? `${step.id} resumes at ${sched.parked.get(step.id)?.label ?? '?'}`
        : `event ${step.kind} ${step.kind === 'expire' ? (holder?.id ?? '?') : step.id}`,
    )
    await take(step, world)
  }
}

/** Every step that may come next: a window resumed, or an event. */
function stepsOf(config: Config, world: World): Step[] {
  const { sched } = world
  const parked = sortedKeys(sched.parked)
  const steps: Step[] = parked
    .filter((id) => sched.parked.get(id)?.isEnabled() === true)
    .map((id) => ({ kind: 'run', id }))
  if (canExpire(config, world)) {
    steps.push({ kind: 'expire' })
  }
  if (steps.length === 0) {
    return steps
  }
  for (const id of parked) {
    if (world.budget.revocations > 0 && world.trusted.get(id) === true) {
      steps.push({ kind: 'revoke', id })
    }
    if (world.budget.steps > 0 && world.offsets.get(id) === 0) {
      steps.push({ kind: 'step', id })
    }
    if (
      (world.budget.faults ?? 0) > 0 &&
      sched.parked.get(id)?.label === 'link' &&
      !world.faulty.has(id)
    ) {
      steps.push({ kind: 'fault', id })
    }
  }
  return steps
}

/** Whether the holder's lease may run out now: paused inside its hold, with budget left. */
function canExpire(config: Config, world: World): boolean {
  const holder = world.lock
  if (holder === undefined || holder.isExpired || world.budget.expiries <= 0) {
    return false
  }
  const label = world.sched.parked.get(holder.id)?.label
  return (
    label !== undefined &&
    STALLABLE.has(label) &&
    (config.expiring === undefined || config.expiring.includes(holder.id))
  )
}

/** Takes one step: resumes a window until its next point, or applies an event. */
async function take(step: Step, world: World): Promise<void> {
  switch (step.kind) {
    case 'run': {
      world.sched.parked.get(step.id)?.resume()
      await world.sched.settle(step.id)
      return
    }
    case 'expire': {
      if (world.lock !== undefined) {
        world.lock.isExpired = true
      }
      world.budget.expiries -= 1
      return
    }
    case 'revoke': {
      world.trusted.set(step.id, false)
      world.revoked.add(step.id)
      world.budget.revocations -= 1
      return
    }
    case 'step': {
      world.offsets.set(step.id, PENDING_CHECKOUT_RECOVERY_MS + 1)
      world.budget.steps -= 1
      return
    }
    case 'fault': {
      world.faulty.add(step.id)
      world.budget.faults = (world.budget.faults ?? 0) - 1
    }
  }
}

/** What must hold however the windows interleaved. */
function violationsOf(config: Config, run: Run): string[] {
  const { world, results } = run
  const found = [...world.violations]
  const winners = [...results].filter(([, result]) => result.ok).map(([id]) => id)
  if (winners.length > 1) {
    found.push(`two windows succeeded: ${winners.join(',')}`)
  }
  const record = world.records.find((entry) => entry.folder === FOLDER)
  if (world.records.some((entry) => entry.isCheckoutPending === true)) {
    found.push('a pending record was left behind')
  }
  if (world.folder === undefined) {
    const isSeed = record?.checkoutId === 'seed-1'
    if (record !== undefined && !isSeed) {
      found.push(`a record names a folder that is gone: ${record.checkoutId ?? '?'}`)
    }
  } else {
    // The folder is named by its maker's finished record, and its maker won.
    const maker = world.folder.maker
    if (
      record?.isCheckoutPending === true ||
      record?.checkoutId?.startsWith(`${maker}-`) !== true
    ) {
      found.push(`the folder ${maker} made is named by no finished record of its own`)
    }
    // Finished but not opened is the one exception: trust went at the end.
    if (!winners.includes(maker) && !world.revoked.has(maker)) {
      found.push(`the folder ${maker} made stayed although ${maker} failed`)
    }
  }
  for (const [identity, registrant] of world.registrations) {
    const isLive = world.folder?.identity === identity
    if (!isLive && !world.revoked.has(registrant)) {
      found.push(`a worktree registration of ${registrant} outlived its folder`)
    }
  }
  const wasDisturbed =
    world.budget.expiries < config.budget.expiries ||
    world.budget.revocations < config.budget.revocations ||
    (world.budget.faults ?? 0) < (config.budget.faults ?? 0)
  if (!wasDisturbed && config.expectOneOwner && winners.length !== 1) {
    found.push(`${String(winners.length)} windows succeeded`)
  }
  for (const [id, result] of results) {
    if (!result.ok && result.reason.startsWith('threw:')) {
      found.push(`${id} ${result.reason}`)
    }
  }
  return found
}

/** The next order to try: the deepest choice with an alternative left. False when none is. */
function hasNextOrder(choices: Choice[]): boolean {
  for (let top = choices.at(-1); top !== undefined; top = choices.at(-1)) {
    if (top.choice + 1 < top.count) {
      top.choice += 1
      return true
    }
    choices.pop()
  }
  return false
}

interface Exploration {
  readonly runs: number
  readonly finished: number
  readonly states: number
  readonly violations: readonly string[]
  readonly outcomes: ReadonlyMap<string, number>
  readonly widths: readonly number[]
}

/**
 * Every order of `config`'s steps, or every order that begins with the
 * steps `prefix` names (the parts together are every order: a search too
 * long for one test runs as one test per prefix; `widths` reports each
 * pinned step's alternatives, so a test can prove its parts cover them).
 */
async function explore(
  config: Config,
  isHeld = true,
  prefix: readonly number[] = [],
): Promise<Exploration> {
  const visited = new Set<string>()
  const pinned: Choice[] = prefix.map((choice) => ({ choice, count: choice + 1, isPinned: true }))
  const choices: Choice[] = [...pinned]
  const violations = new Set<string>()
  const outcomes = new Map<string, number>()
  let firstViolating: Choice[] | undefined
  let runs = 0
  let finished = 0
  for (;;) {
    const run = await runOnce(config, choices, visited, isHeld)
    runs += 1
    if (run.outcome === 'finished') {
      finished += 1
      for (const violation of violationsOf(config, run)) {
        violations.add(`${violation} [schedule ${choices.map((entry) => entry.choice).join('')}]`)
        firstViolating ??= choices.map((entry) => ({ ...entry }))
      }
      const summary = config.windows
        .map(({ id }) => `${id}:${run.results.get(id)?.ok === true ? 'ok' : 'no'}`)
        .join(' ')
      outcomes.set(summary, (outcomes.get(summary) ?? 0) + 1)
    }
    if (!hasNextOrder(choices)) {
      break
    }
  }
  const reported = [...violations].slice(0, 5)
  if (firstViolating !== undefined) {
    // The first violating order, step by step, to read in the failure.
    const trace: string[] = []
    await runOnce(config, firstViolating, new Set(), isHeld, trace)
    reported.push(trace.join('\n'))
  }
  return {
    runs,
    finished,
    states: visited.size,
    violations: reported,
    outcomes,
    widths: pinned.map((entry) => entry.width ?? 0),
  }
}

const NONE: Budget = { expiries: 0, revocations: 0, steps: 0 }

describe('pull request checkout interleavings (M123 lane P)', () => {
  beforeAll(async () => {
    // The owner probe reads this process's birth once; every run reuses it.
    await currentProcessOwner()
  })

  const STALE_JUDGE: readonly Window[] = [{ id: 'A' }, { id: 'B', isStepped: true }]
  const THREE: readonly Window[] = [
    { id: 'A' },
    { id: 'B', isStepped: true },
    { id: 'C', isStepped: true },
  ]

  it('settles two windows to one owner in every order, one judging the other stale', async () => {
    // RVM123P6 finding 1's shape: B's wall clock makes A's pending
    // reservation look stale, so B may supersede it at any point.
    const result = await explore({ windows: STALE_JUDGE, budget: NONE, expectOneOwner: true })
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(50)
    // Both outcomes occur: each window wins in some order.
    expect(sortedKeys(result.outcomes)).toEqual(['A:no B:ok', 'A:ok B:no'])
  })

  it('leaves no folder unnamed when a hold’s lease runs out mid-protocol', async () => {
    // The stale holder: paused after it read, before or after its checks,
    // or while making the folder, its lease runs out and the other window
    // takes the lock over.
    const result = await explore({
      windows: STALE_JUDGE,
      budget: { expiries: 1, revocations: 0, steps: 0 },
      expectOneOwner: true,
    })
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(600)
  })

  it('leaves no folder unnamed when both windows’ holds run out', async () => {
    // Two stalls, each after its checks or while making the folder (one
    // stall before the checks is covered above).
    const result = await explore({
      windows: STALE_JUDGE,
      budget: { expiries: 2, revocations: 0, steps: 0 },
      canStallBeforeChecks: false,
      expectOneOwner: true,
    })
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(2000)
  })

  it('runs no git for a window once its trust is revoked, at any point', async () => {
    // RVM123P6 finding 2's shape: trust goes while a window waits on the
    // records (its claim, its reservation), right before git would start.
    const result = await explore({
      windows: STALE_JUDGE,
      budget: { expiries: 0, revocations: 1, steps: 0 },
      expectOneOwner: true,
    })
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(250)
  })

  it('runs no git once trust is revoked, with a lease running out as well', async () => {
    const result = await explore({
      windows: STALE_JUDGE,
      budget: { expiries: 1, revocations: 1, steps: 0 },
      canStallBeforeChecks: false,
      expectOneOwner: true,
    })
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(2000)
  })

  it.each([
    { faults: 1, minimum: 200 },
    { faults: 2, minimum: 600 },
  ])(
    'leaves nothing pending and no folder unnamed when $faults writes land and then fail',
    async ({ faults, minimum }) => {
      // RVM123P7 finding 1's shape: a publish lands, then the I/O after it
      // fails (a listing, a proof), so its caller does not know it landed.
      // A landed claim is never undone; a write not known to have landed
      // is dropped by every fence it may hold.
      const result = await explore({
        windows: STALE_JUDGE,
        budget: { expiries: 0, revocations: 0, steps: 0, faults },
        expectOneOwner: true,
      })
      expect(result.violations).toEqual([])
      expect(result.states).toBeGreaterThan(minimum)
    },
  )

  it('leaves nothing pending when a write lands and then fails, own or replacing', async () => {
    const own = await explore(
      {
        windows: STALE_JUDGE,
        budget: { expiries: 0, revocations: 0, steps: 0, faults: 1 },
        expectOneOwner: true,
      },
      false,
    )
    const replacing = await explore({
      windows: [{ id: 'A' }, { id: 'B' }],
      budget: { expiries: 0, revocations: 0, steps: 0, faults: 1 },
      seedReady: true,
      expectOneOwner: true,
    })
    expect([...own.violations, ...replacing.violations]).toEqual([])
    expect(own.states + replacing.states).toBeGreaterThan(400)
  })

  it('settles a wall clock stepped at any point to one owner', async () => {
    const result = await explore({
      windows: [{ id: 'A' }, { id: 'B' }],
      budget: { expiries: 0, revocations: 0, steps: 1 },
      expectOneOwner: true,
    })
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(100)
  })

  it('settles two windows replacing one finished checkout whose folder is gone', async () => {
    const result = await explore({
      windows: [{ id: 'A' }, { id: 'B' }],
      budget: { expiries: 1, revocations: 0, steps: 0 },
      seedReady: true,
      expectOneOwner: true,
    })
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(700)
  })

  it('settles the user’s own checkout the same way', async () => {
    const result = await explore(
      {
        windows: STALE_JUDGE,
        budget: { expiries: 1, revocations: 0, steps: 0 },
        expectOneOwner: true,
      },
      false,
    )
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(450)
  })

  it('settles three windows to one owner in every order', async () => {
    const result = await explore({ windows: THREE, budget: NONE, expectOneOwner: true })
    expect(result.violations).toEqual([])
    expect(result.states).toBeGreaterThan(1300)
  })

  // B, judging A stale, takes over and is paused past its lease (after its
  // checks or while making the folder) while C, judging both stale, comes
  // in. One search, in parts by its first two steps: the parts' pinned
  // steps cover every alternative the search found.
  const TAKER_STALLS: Config = {
    windows: THREE,
    budget: { expiries: 1, revocations: 0, steps: 0 },
    expiring: ['B'],
    canStallBeforeChecks: false,
    expectOneOwner: true,
  }
  it.each([
    { prefix: [0, 0], widths: [3, 3] },
    { prefix: [0, 1], widths: [3, 3] },
    { prefix: [0, 2], widths: [3, 3] },
    { prefix: [1], widths: [3] },
    { prefix: [2], widths: [3] },
  ])(
    'leaves no folder unnamed among three windows when the taker’s lease runs out ($prefix)',
    async ({ prefix, widths }) => {
      const result = await explore(TAKER_STALLS, true, prefix)
      expect(result.violations).toEqual([])
      expect(result.widths).toEqual(widths)
      expect(result.finished).toBeGreaterThan(0)
    },
  )
})

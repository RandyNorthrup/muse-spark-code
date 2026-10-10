import {
  DEVELOPER_CLICK_WINDOW_MS,
  DEVELOPER_UNLOCK_MS,
  DEVELOPER_VERSION_CLICKS,
  UI_TEXT,
} from '../../shared/constants'
import {
  developerAuditSchema,
  developerProfileSchema,
  developerStateSchema,
  type DeveloperAudit,
  type DeveloperSnapshot,
  type DeveloperState,
} from '../../shared/developerOptions'
import type { DeveloperProfileResources } from './localProfiles'

export interface DeveloperStore {
  /** Restore must apply durable revocations even when state publication failed. */
  read(): Promise<unknown>
  /** Audit before enabling; revoke state even after audit failure where possible.
   * Durable revocations take precedence over an older enabled state on restore.
   * The single machine owner serializes calls, including other editor clients.
   * One exception (DEVID017E): a foreign `resetForeign` clear is never
   * published when its audit row was not written — a failed foreign Reset
   * leaves stored state unchanged instead of clearing it unaudited. Every
   * other revocation, own-machine Reset included, is still published after
   * an audit failure, and the caller still gets the persistence error. */
  commit(state: DeveloperState, audit: DeveloperAudit): Promise<void>
}
export interface DeveloperOptionsDeps {
  readonly machineId: string
  /** Ids this machine was known by before DEVID017B (its raw hostname, its
   * hostname digest, or that digest for the short or `.local` hostname
   * forms). A stored grant under one is adopted once and re-bound to
   * machineId, compared case-insensitively. */
  readonly previousMachineIds?: readonly string[]
  readonly now: () => number
  readonly newProfileId: () => string
  readonly store: DeveloperStore
  readonly resources: DeveloperProfileResources
  /** Password/standard-input entry stays with K, vendor eligibility with P/M.
   * The port must refuse unsupported products and unbound/absent accounts. */
  readonly checkAccount: (provider: string, account: string) => Promise<void>
  readonly confirm: (question: 'unlock' | 'multiple' | 'reset' | 'resetForeign') => Promise<boolean>
  /** Pushes the same snapshot/badge to all registered surfaces. */
  readonly changed: (snapshot: DeveloperSnapshot) => void
}

export class DeveloperOptionsError extends Error {
  public constructor(
    public readonly code: 'locked' | 'unavailable' | 'invalidRequest' | 'differentMachine',
  ) {
    super(UI_TEXT.developer[code])
    this.name = 'DeveloperOptionsError'
  }
}

function isPreviousMachine(stored: string, previous: readonly string[] | undefined): boolean {
  // Hostnames compare case-insensitively; digests are already lowercase.
  const normalized = stored.toLowerCase()
  return (previous ?? []).some((id) => id.toLowerCase() === normalized)
}

/** One parent-owned service across windows, editor bridges and terminal clients.
 * Serialized ownership starts before I/O; Reset/disable fence it synchronously. */
export class DeveloperOptions {
  public static async open(deps: DeveloperOptionsDeps): Promise<DeveloperOptions> {
    const empty = developerStateSchema.parse({
      v: 1,
      machineId: deps.machineId,
      unlockedAt: null,
      expiresAt: null,
      isMultipleAccountsOn: false,
      profiles: [],
    })
    const stored = await deps.store.read()
    const parsed = stored === undefined ? undefined : developerStateSchema.safeParse(stored)
    if (
      stored !== undefined &&
      (parsed === undefined ||
        !parsed.success ||
        (parsed.data.unlockedAt !== null && parsed.data.unlockedAt > deps.now()))
    ) {
      throw new DeveloperOptionsError('unavailable')
    }
    if (
      parsed?.success === true &&
      parsed.data.machineId !== deps.machineId &&
      !isPreviousMachine(parsed.data.machineId, deps.previousMachineIds)
    ) {
      // Set up under a different machine identity: the profiles stay on
      // disk until the user resets (DEVID017B).
      throw new DeveloperOptionsError('differentMachine')
    }
    // A grant stored under this machine's legacy id (its raw hostname or
    // hostname digest) keeps working: it is re-bound to the stored id here
    // and persisted at once — with no grant change and so no authority
    // audit entry, only the `migrate` identity row — so the identifying raw
    // hostname leaves stored state on this open, not on some later save.
    const isMigrated = parsed?.success === true && parsed.data.machineId !== deps.machineId
    let restored = empty
    if (parsed?.success === true) {
      restored = isMigrated ? { ...parsed.data, machineId: deps.machineId } : parsed.data
    }
    const owner = new DeveloperOptions(deps, restored)
    if (isMigrated) {
      try {
        await owner.save(owner.state, 'migrate', 'lifecycle')
      } catch {
        throw new DeveloperOptionsError('unavailable')
      }
    }
    await owner.refresh()
    if (owner.isMultipleAccountsOn()) {
      const current = owner.fence()
      try {
        for (const profile of owner.state.profiles) {
          await deps.checkAccount(profile.provider, profile.account)
          owner.assertCurrent(current)
          await deps.resources.start(profile, current)
        }
      } catch (error) {
        await owner.setMultiple(false, 'lifecycle')
        throw error
      }
    }
    return owner
  }

  /** Reset state bound to another machine's identity (DEVID017B, redesigned
   * DEVID017C, hardened DEVID017D). `open` refuses such state, so the
   * terminal `developer reset` recovers through here without an owner.
   * Confirmation comes first — under its own `resetForeign` question, whose
   * text says exactly what happens: this machine's developer state is
   * cleared, nothing is stopped, and profile folders stay on disk — and
   * nothing is mutated before the answer: denying re-refuses with the honest
   * identity message and leaves everything — stored identity, unlock,
   * profiles, audit — unchanged, so the next open still refuses with
   * `differentMachine`. On confirmation the foreign unlock and registration
   * are cleared to a fresh record for this machine; nothing is transferred,
   * on no path: not before confirmation, not in a `finally`, not on cancel
   * or failure. Profiles recorded under the foreign id cannot be running
   * under this machine's authority, so they are cleared from the record
   * without stopping through this machine's resource port — and the single
   * `resetForeign` audit row records exactly that: a reset with no stop and
   * no disable. Their state folders and credential slots stay on disk: PLAN
   * D88 (b) gives Reset the job of turning every option off and stopping
   * the profiles (PLAN.md:12407), never of deleting profile folders. The
   * store writes that audit row before the cleared state; when the audit
   * write fails the state is left unchanged and the failure is reported,
   * never an unaudited clearing. */
  public static async resetForeign(
    deps: DeveloperOptionsDeps,
    source: DeveloperAudit['source'],
  ): Promise<DeveloperSnapshot> {
    const stored = await deps.store.read()
    const parsed = stored === undefined ? undefined : developerStateSchema.safeParse(stored)
    if (parsed?.success !== true) throw new DeveloperOptionsError('differentMachine')
    if (!(await deps.confirm('resetForeign'))) throw new DeveloperOptionsError('differentMachine')
    const cleared = developerStateSchema.parse({
      v: 1,
      machineId: deps.machineId,
      unlockedAt: null,
      expiresAt: null,
      isMultipleAccountsOn: false,
      profiles: [],
    })
    const owner = new DeveloperOptions(deps, cleared)
    await owner.save(owner.state, 'resetForeign', source)
    return owner.snapshot()
  }

  private state: DeveloperState
  private writes: Promise<void> = Promise.resolve()
  private generation = 0
  private readonly clicks = new Map<string, { time: number; count: number }>()

  private constructor(
    private readonly deps: DeveloperOptionsDeps,
    state: DeveloperState,
  ) {
    this.state = state
  }

  private async serialize<T>(use: () => Promise<T>): Promise<T> {
    const previous = this.writes
    // Not `Promise.withResolvers`, which Node 20 (VS Code 1.99's host) lacks.
    let releaseGate: (() => void) | undefined
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Node 20 (VS Code 1.99's host) lacks Promise.withResolvers (PLAN.md §8); the executor assigns the resolver synchronously, so releaseGate?.() in finally always releases the next owner.
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    this.writes = (async (): Promise<void> => {
      await previous
      await gate
    })()
    try {
      await previous
      return await use()
    } finally {
      releaseGate?.()
    }
  }

  private isUnlocked(): boolean {
    const now = this.deps.now()
    return (
      Number.isSafeInteger(now) &&
      this.state.unlockedAt !== null &&
      this.state.expiresAt !== null &&
      now >= this.state.unlockedAt &&
      now < this.state.expiresAt
    )
  }

  private fence(): () => boolean {
    const generation = this.generation
    const expiresAt = this.state.expiresAt
    return () =>
      generation === this.generation &&
      expiresAt === this.state.expiresAt &&
      this.isMultipleAccountsOn()
  }

  private assertCurrent(isCurrent: () => boolean): void {
    if (!isCurrent()) throw new DeveloperOptionsError('locked')
  }

  private async save(
    next: DeveloperState,
    action: DeveloperAudit['action'],
    source: DeveloperAudit['source'],
    profile?: string,
  ): Promise<void> {
    const state = developerStateSchema.parse(next)
    const audit = developerAuditSchema.parse({
      v: 1,
      time: this.deps.now(),
      action,
      source,
      ...(profile !== undefined && { profile }),
    })
    const generation = this.generation
    await this.deps.store.commit(state, audit)
    if (generation !== this.generation) throw new DeveloperOptionsError('locked')
    this.state = state
    this.deps.changed(this.snapshot())
  }

  private invalidate(): void {
    this.generation += 1
    this.state = { ...this.state, isMultipleAccountsOn: false }
    this.clicks.clear()
    this.deps.changed(this.snapshot())
  }

  private async stopAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.state.profiles.map((profile) => this.deps.resources.stop(profile)),
    )
    if (results.some((result) => result.status === 'rejected'))
      throw new DeveloperOptionsError('unavailable')
  }

  public isMultipleAccountsOn(): boolean {
    return this.isUnlocked() && this.state.isMultipleAccountsOn
  }

  public snapshot(): DeveloperSnapshot {
    return {
      type: 'developer/state',
      isUnlocked: this.isUnlocked(),
      isMultipleAccountsOn: this.isMultipleAccountsOn(),
      expiresAt: this.isUnlocked() ? this.state.expiresAt : null,
      profiles: structuredClone(this.state.profiles),
    }
  }

  public async unlock(source: 'version' | 'palette' | 'terminal'): Promise<DeveloperSnapshot> {
    const generation = this.generation
    return await this.serialize(async () => {
      if (generation !== this.generation) throw new DeveloperOptionsError('locked')
      if (this.isUnlocked()) return this.snapshot()
      const isAllowed = await this.deps.confirm('unlock')
      if (generation !== this.generation) throw new DeveloperOptionsError('locked')
      if (isAllowed) {
        const now = this.deps.now()
        await this.save(
          {
            ...this.state,
            unlockedAt: now,
            expiresAt: now + DEVELOPER_UNLOCK_MS,
            isMultipleAccountsOn: false,
          },
          'unlock',
          source,
        )
      }
      return this.snapshot()
    })
  }

  /** Surface id comes from the authenticated host, never the page payload. */
  public async versionClick(surface: string): Promise<DeveloperSnapshot> {
    const now = this.deps.now()
    const previous = this.clicks.get(surface)
    const count =
      previous === undefined ||
      now < previous.time ||
      now - previous.time > DEVELOPER_CLICK_WINDOW_MS
        ? 1
        : previous.count + 1
    this.clicks.set(surface, { time: count === 1 ? now : (previous?.time ?? now), count })
    if (count < DEVELOPER_VERSION_CLICKS) return this.snapshot()
    this.clicks.delete(surface)
    return await this.unlock('version')
  }

  public async setMultiple(
    isEnabled: boolean,
    source: DeveloperAudit['source'] = 'page',
  ): Promise<DeveloperSnapshot> {
    if (!isEnabled) this.invalidate()
    const generation = this.generation
    return await this.serialize(async () => {
      if (generation !== this.generation) throw new DeveloperOptionsError('locked')
      if (!isEnabled) {
        try {
          await this.stopAll()
        } finally {
          await this.save({ ...this.state, isMultipleAccountsOn: false }, 'disable', source)
        }
      } else if (!this.isMultipleAccountsOn()) {
        if (!this.isUnlocked()) throw new DeveloperOptionsError('locked')
        const isAllowed = await this.deps.confirm('multiple')
        if (generation !== this.generation || !this.isUnlocked())
          throw new DeveloperOptionsError('locked')
        if (isAllowed) {
          await this.save({ ...this.state, isMultipleAccountsOn: true }, 'enable', source)
          const current = this.fence()
          try {
            for (const profile of this.state.profiles) {
              await this.deps.checkAccount(profile.provider, profile.account)
              this.assertCurrent(current)
              await this.deps.resources.start(profile, current)
            }
          } catch (error) {
            this.invalidate()
            try {
              await this.stopAll()
            } finally {
              await this.save(
                { ...this.state, isMultipleAccountsOn: false },
                'disable',
                'lifecycle',
              )
            }
            throw error
          }
        }
      }
      return this.snapshot()
    })
  }

  public async addProfile(
    provider: string,
    account: string,
    source: DeveloperAudit['source'] = 'page',
  ): Promise<DeveloperSnapshot> {
    const current = this.fence()
    return await this.serialize(async () => {
      this.assertCurrent(current)
      const profile = developerProfileSchema.parse({
        id: this.deps.newProfileId(),
        provider,
        account,
      })
      const next = developerStateSchema.parse({
        ...this.state,
        profiles: [...this.state.profiles, profile],
      })
      await this.deps.checkAccount(provider, account)
      this.assertCurrent(current)
      // Record ownership before creating resources; failed starts remain
      // visible/removable and never become an unrecorded cleanup target.
      await this.save(next, 'create', source, profile.id)
      this.assertCurrent(current)
      await this.deps.resources.start(profile, current)
      this.assertCurrent(current)
      return this.snapshot()
    })
  }

  public async removeProfile(
    id: string,
    source: DeveloperAudit['source'] = 'page',
  ): Promise<DeveloperSnapshot> {
    if (this.state.profiles.every((row) => row.id !== id))
      throw new DeveloperOptionsError('invalidRequest')
    this.invalidate()
    return await this.serialize(async () => {
      const profile = this.state.profiles.find((row) => row.id === id)
      if (profile === undefined) throw new DeveloperOptionsError('invalidRequest')
      try {
        await this.stopAll()
      } finally {
        await this.save({ ...this.state, isMultipleAccountsOn: false }, 'disable', 'lifecycle')
      }
      await this.deps.resources.remove(profile)
      await this.save(
        { ...this.state, profiles: this.state.profiles.filter((row) => row.id !== id) },
        'remove',
        source,
        id,
      )
      return this.snapshot()
    })
  }

  /** The owning host schedules this at expiresAt as well as before commands. */
  public async refresh(): Promise<DeveloperSnapshot> {
    if (this.state.expiresAt !== null && !this.isUnlocked()) {
      this.invalidate()
      this.state = { ...this.state, unlockedAt: null, expiresAt: null }
      await this.serialize(async () => {
        try {
          await this.stopAll()
        } finally {
          await this.save(this.state, 'expire', 'lifecycle')
        }
      })
    }
    return this.snapshot()
  }

  public async reset(source: DeveloperAudit['source'] = 'page'): Promise<DeveloperSnapshot> {
    // Reset revokes pending work as soon as requested, even while its
    // destructive cleanup confirmation is pending or denied.
    this.invalidate()
    return await this.serialize(async () => {
      try {
        await this.stopAll()
      } finally {
        await this.save({ ...this.state, isMultipleAccountsOn: false }, 'disable', 'lifecycle')
      }
      if (await this.deps.confirm('reset')) {
        for (const profile of this.state.profiles) await this.deps.resources.remove(profile)
        await this.save(
          { ...this.state, unlockedAt: null, expiresAt: null, profiles: [] },
          'reset',
          source,
        )
      }
      return this.snapshot()
    })
  }
}

import { usdAmountSchema, Usd as ExactUsd } from '../../shared/usd'
// D88.5–7. One provider's pool, shared by conversation and background callers.
// The owner binds the real journal, registry, budgets and transcript ports.
import {
  accountEventSchema,
  accountIdSchema,
  accountPoolSchema,
  type Account,
  type AccountEvent,
  type AccountJournalReader,
  type AccountTrigger,
} from '../../shared/accounts'
import { ACCOUNT_DEFAULTS, TOKENS_PER_MILLION, UI_TEXT } from '../../shared/constants'
import { multiplyUsd, parseUsd, sumUsd, usdDecimal, type Usd } from '../../shared/accountUsd'
import type { AccountPolicy } from '../providers/accountPolicy'
import { accountLimitIdentity, isAccountLimitEligible } from './limitBlock'
import type { AccountPolicyGate, AccountPolicyDecision } from './policyGate'
import {
  AccountThresholdExceededError,
  evaluateAccountThresholds,
  type AccountLimitsReader,
} from './thresholds'

export interface AccountRequestEstimate {
  readonly costUsd: Usd
  readonly inputTokens: number
  readonly outputTokens: number
  readonly requests: number
}
export interface AccountPoolClaim {
  readonly started?: () => void
  /** Excludes this owned pending projection only. Already-sent attempts and
   * settled/uncertain liability (including earlier retries) remain visible. */
  readonly journal: AccountJournalReader
  /** Original shared daily and conversation scopes, never changed by a swap. */
  readonly checkSharedCaps: () => void
  /** null retains uncertain liability on its original account; zero refunds a nonsend. */
  readonly settle: (actualUsd: Usd | null, hasSent: boolean) => Promise<void>
}
export interface AccountPoolDeps {
  readonly readSelection?: (owner: string) => string | undefined
  readonly writeSelection?: (owner: string, account: string) => void
  readonly provider: string
  readonly policy: () => AccountPolicy | undefined
  readonly accounts: () => readonly Account[]
  readonly journal: AccountJournalReader
  readonly limits: (request: AccountPoolRequest) => AccountLimitsReader
  readonly gate: AccountPolicyGate
  readonly now: () => number
  readonly usageUrl: string
  readonly settings?: () => { readonly isSwapOn: boolean; readonly isParallelOn: boolean }
  readonly isHeld?: () => boolean
  /** Comparable integer capacity, incorporating outstanding reservations. */
  readonly headroom: (account: Account, request: AccountPoolRequest) => bigint
  /** M95's account-specific model scan/capability record for the selected model. */
  readonly canUseModel: (account: Account, request: AccountPoolRequest) => boolean
  readonly coldCache: (previous: Account, next: Account, request: AccountPoolRequest) => Usd
  /** Atomic budget/rate reservation. Includes cold-cache liability, with fixed parent scopes. */
  readonly reserve: (
    account: Account,
    estimate: AccountRequestEstimate,
    request: AccountPoolRequest,
  ) => Promise<AccountPoolClaim>
  /** Resolves only after the credential-free event is recorded and the UI can show it. */
  readonly record: (event: AccountEvent) => Promise<void>
  /** Owner transaction: call adopt and publish the event synchronously together.
   * A thrown fence/I/O refusal commits neither. No await or reentry between them. */
  readonly commit: (
    event: AccountEvent,
    adopt: () => () => void,
    request?: AccountPoolRequest,
  ) => void
  readonly sharedGroupNotice: (account: string) => Promise<void>
}
export interface AccountPoolRequest {
  readonly retryAccount?: string | undefined
  readonly owner: string
  /** Original conversation, including children/candidates/schedules; never the chosen account. */
  readonly budgetOwner: string
  readonly modelId: string
  readonly kind: 'conversation' | 'worker'
  readonly account: string
  readonly estimate: AccountRequestEstimate
  readonly isInteractive: boolean
  /** H enables this only with --account-pool; CI stdin-key callers never set it. */
  readonly hasPoolFlag?: boolean
  readonly checkSharedCaps?: () => void
  readonly isCurrent?: () => boolean
  readonly hasOfferedRecovery?: boolean
}

export class AccountPoolStoppedError extends Error {
  public constructor(
    public readonly trigger: AccountTrigger | undefined,
    public readonly decision: AccountPolicyDecision | undefined,
    public readonly resetAt: string | null,
    public readonly usageUrl: string,
  ) {
    super(UI_TEXT.accounts.stopEvent)
    this.name = 'AccountPoolStoppedError'
  }
}

export class AccountPoolBusyError extends Error {
  public readonly code = 'busyOwner'
  public constructor() {
    super(UI_TEXT.accounts.ownerBusy)
    this.name = 'AccountPoolBusyError'
  }
}

function projected(estimate: AccountRequestEstimate) {
  return {
    settledUsd: ExactUsd.from(0).toAmount(),
    reservedUsd: usdAmountSchema.parse(usdDecimal(estimate.costUsd)),
    uncertainUsd: ExactUsd.from(0).toAmount(),
    inputTokens: estimate.inputTokens,
    outputTokens: estimate.outputTokens,
    requests: estimate.requests,
  }
}

/** Conservative full re-read, even within a group until Q-M108 captures cache sharing. */
export function accountColdCacheEstimate(inputTokens: number, inputUsdPerMillion: string): Usd {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0)
    throw new Error(UI_TEXT.accounts.invalidAccount)
  return multiplyUsd(parseUsd(inputUsdPerMillion), BigInt(inputTokens), BigInt(TOKENS_PER_MILLION))
}

export class AccountPool {
  private readonly sticky = new Map<
    string,
    {
      readonly account: string
      readonly trigger: AccountTrigger | undefined
      readonly decision: Extract<AccountPolicyDecision, { kind: 'allow' }> | undefined
    }
  >()
  private readonly active = new Set<string>()
  private readonly next = new Map<string, string>()
  private admission: Promise<void> = Promise.resolve()
  private readonly boundaries = new Set<string>()

  public constructor(public readonly deps: AccountPoolDeps) {}

  private owner(request: AccountPoolRequest): string {
    return JSON.stringify([request.kind, request.owner])
  }

  private rows(): Account[] {
    return accountPoolSchema.parse(this.deps.accounts()).toSorted((a, b) => a.order - b.order)
  }

  private triggers(
    account: Account,
    estimate: AccountRequestEstimate,
    journal: AccountJournalReader,
    request: AccountPoolRequest,
  ) {
    const own = evaluateAccountThresholds({
      provider: this.deps.provider,
      account,
      now: this.deps.now(),
      journal,
      limits: this.deps.limits(request),
      request: projected(estimate),
    })
    const shared: AccountTrigger[] = []
    // A second key cannot escape a live block on its group or a global limit.
    for (const peer of this.rows()) {
      if (
        peer.id === account.id ||
        isAccountLimitEligible(account, accountLimitIdentity(peer, this.deps.policy()))
      )
        continue
      shared.push(
        ...evaluateAccountThresholds({
          provider: this.deps.provider,
          account: peer,
          now: this.deps.now(),
          journal: this.deps.journal,
          limits: this.deps.limits(request),
        }).filter((trigger) => trigger.kind === 'vendorLimit'),
      )
    }
    return [...shared, ...own]
  }

  private reset(triggers: readonly AccountTrigger[]): string | null {
    if (triggers.length === 0 || triggers.some((entry) => entry.resetAt === null)) return null
    let latest: string | null = null
    for (const entry of triggers) {
      const reset = entry.resetAt
      if (reset !== null && (latest === null || Date.parse(reset) > Date.parse(latest)))
        latest = reset
    }
    return latest
  }

  private async stop(
    account: Account,
    triggers: readonly AccountTrigger[],
    decision?: AccountPolicyDecision,
    recoveries: readonly (string | null)[] = [this.reset(triggers)],
  ): Promise<never> {
    const trigger = triggers[0]
    if (trigger !== undefined)
      await this.deps.record(
        accountEventSchema.parse({
          type: 'stop',
          provider: this.deps.provider,
          account: account.id,
          time: new Date(this.deps.now()).toISOString(),
          trigger,
        }),
      )
    const resetAt =
      recoveries
        .filter((reset) => reset !== null)
        .toSorted((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
    throw new AccountPoolStoppedError(trigger, decision, resetAt, this.deps.usageUrl)
  }

  private async select(request: AccountPoolRequest, isEligible: (account: Account) => boolean) {
    const rows = this.rows()
    const owner = this.owner(request)
    const saved = this.deps.readSelection?.(owner)
    const held =
      this.sticky.get(owner) ??
      (saved === undefined
        ? undefined
        : { account: saved, trigger: undefined, decision: undefined })
    const chosen = request.retryAccount ?? held?.account ?? request.account
    const current = rows.find((row) => row.id === chosen)
    if (current === undefined && saved !== undefined && request.retryAccount === undefined) {
      this.next.delete(owner)
      this.sticky.set(owner, { account: request.account, trigger: undefined, decision: undefined })
      this.deps.writeSelection?.(owner, request.account)
      throw new Error(UI_TEXT.accounts.selectedRemoved)
    }
    if (current === undefined || !accountIdSchema.safeParse(this.deps.provider).success)
      throw new Error(UI_TEXT.accounts.invalidAccount)
    const settings = this.deps.settings?.() ?? ACCOUNT_DEFAULTS
    const canPool = request.isInteractive || request.hasPoolFlag === true
    const triggers = this.triggers(current, request.estimate, this.deps.journal, request)
    const isCurrentEligible = isEligible(current)
    const row = this.deps.policy()
    if (row === undefined || row.pooling === 'notOffered' || !row.isCredentialHeld)
      return await this.stop(current, triggers, { kind: 'stop', reason: 'notOffered' })
    let heldDecision = held?.decision
    if (heldDecision?.isCurrent(row) === false) {
      const refreshed = await this.deps.gate.authorize({
        policy: this.deps.policy,
        trigger: held?.trigger,
        isInteractive: request.isInteractive,
        hasOfferedRecovery: request.hasOfferedRecovery === true,
      })
      if (refreshed.kind !== 'allow') return await this.stop(current, triggers, refreshed)
      heldDecision = refreshed
    }
    if (
      (!isCurrentEligible || triggers.length > 0) &&
      (!canPool || !settings.isSwapOn || request.retryAccount !== undefined)
    )
      return await this.stop(current, triggers)
    if (triggers.length > 0 && rows.length === 1) return await this.stop(current, triggers)
    const isSpread =
      canPool &&
      settings.isParallelOn &&
      rows.length > 1 &&
      request.kind === 'worker' &&
      request.retryAccount === undefined &&
      held === undefined
    if (!isSpread && isCurrentEligible && triggers.length === 0)
      return {
        account: current,
        previousAccount: current.id,
        trigger: undefined,
        estimate: request.estimate,
        coldCacheUsd: parseUsd(0),
        decision: heldDecision,
        policyTrigger: held?.trigger,
        spread: false,
      }
    const decision = await this.deps.gate.authorize({
      policy: this.deps.policy,
      trigger: triggers[0],
      isInteractive: request.isInteractive,
      hasOfferedRecovery: request.hasOfferedRecovery === true,
    })
    if (decision.kind !== 'allow') return await this.stop(current, triggers, decision)
    const start = rows.indexOf(current) + 1
    const candidates = isSpread
      ? this.spreadOrder(rows, request)
      : [...rows.slice(start), ...rows.slice(0, start)]
    const allTriggers = [...triggers]
    const recoveries = [this.reset(triggers)]
    for (const account of candidates) {
      if (account.id === current.id && triggers.length > 0) continue
      if (!isEligible(account) || !this.deps.canUseModel(account, request)) continue
      const coldCacheUsd =
        account.id === current.id ? parseUsd(0) : this.deps.coldCache(current, account, request)
      if (coldCacheUsd < parseUsd(0)) throw new Error(UI_TEXT.accounts.invalidAccount)
      const estimate = {
        ...request.estimate,
        costUsd: sumUsd([request.estimate.costUsd, coldCacheUsd]),
      }
      const blocked = this.triggers(account, estimate, this.deps.journal, request)
      allTriggers.push(...blocked)
      recoveries.push(this.reset(blocked))
      if (
        triggers[0]?.kind === 'vendorLimit' &&
        !isAccountLimitEligible(account, accountLimitIdentity(current, this.deps.policy()))
      ) {
        await this.deps.sharedGroupNotice(account.id)
        continue
      }
      if (blocked.length === 0)
        return {
          account,
          previousAccount: current.id,
          trigger: triggers[0],
          estimate,
          coldCacheUsd,
          decision,
          policyTrigger: triggers[0],
          spread: isSpread,
        }
    }
    return await this.stop(current, allTriggers, undefined, recoveries)
  }

  /** A hint confirmed while holding the queue slot: same shape as selection. */
  private confirm(
    request: AccountPoolRequest,
    isEligible: (account: Account) => boolean,
    hint: Awaited<ReturnType<AccountPool['select']>>,
  ): Awaited<ReturnType<AccountPool['select']>> | undefined {
    const row = this.deps.policy()
    if (row === undefined || row.pooling === 'notOffered' || !row.isCredentialHeld) return undefined
    if (hint.decision?.isCurrent(row) === false) return undefined
    const account = this.rows().find((entry) => entry.id === hint.account.id)
    if (account === undefined || !isEligible(account) || !this.deps.canUseModel(account, request))
      return undefined
    if (this.triggers(account, hint.estimate, this.deps.journal, request).length > 0)
      return undefined
    // A worker that chose at equal headroom sees a concurrent reservation
    // here and reranks instead of joining it.
    return hint.spread && this.spreadOrder(this.rows(), request)[0]?.id !== account.id
      ? undefined
      : { ...hint, account }
  }

  private spreadOrder(rows: Account[], request: AccountPoolRequest): Account[] {
    return rows.toSorted((a, b) => {
      const left = this.deps.headroom(a, request),
        right = this.deps.headroom(b, request)
      if (left < parseUsd(0) || right < parseUsd(0))
        throw new Error(UI_TEXT.accounts.invalidAccount)
      if (left === right) return a.order - b.order
      return left > right ? -1 : 1
    })
  }

  private async admit(
    request: AccountPoolRequest,
    isEligible: (account: Account) => boolean,
  ): Promise<
    Awaited<ReturnType<AccountPool['select']>> & { claim: AccountPoolClaim; check: () => void }
  > {
    // The lease owns its paid request from choice to settlement. Choice
    // starts outside the reservation queue, so one owner's policy
    // confirmation never blocks another owner's admission; it is confirmed
    // inside the queue, so a second worker at equal headroom sees the first
    // reservation and reranks instead of joining it.
    const hint = await this.select(request, isEligible)
    const previous = this.admission
    const operation = (async () => {
      await previous
      const selected =
        this.confirm(request, isEligible, hint) ?? (await this.select(request, isEligible))
      if (this.triggers(selected.account, selected.estimate, this.deps.journal, request).length > 0)
        return
      const claim = await this.deps.reserve(selected.account, selected.estimate, request)
      const check = () => {
        if (this.deps.isHeld?.() === true) throw new AccountPoolBusyError()
        if (request.isCurrent?.() === false) throw new Error(UI_TEXT.accounts.invalidAccount)
        const account = this.rows().find((row) => row.id === selected.account.id)
        const row = this.deps.policy()
        if (
          account === undefined ||
          row === undefined ||
          !isEligible(account) ||
          !this.deps.canUseModel(account, request) ||
          row.pooling === 'notOffered' ||
          !row.isCredentialHeld ||
          selected.decision?.isCurrent(row) === false
        )
          throw new Error(UI_TEXT.accounts.invalidAccount)
        if (selected.previousAccount !== account.id) {
          const settings = this.deps.settings?.() ?? ACCOUNT_DEFAULTS
          if (
            !(request.kind === 'worker' && selected.trigger === undefined
              ? settings.isParallelOn
              : settings.isSwapOn)
          )
            throw new Error(UI_TEXT.accounts.invalidAccount)
          const previous = this.rows().find((entry) => entry.id === selected.previousAccount)
          if (previous === undefined) throw new Error(UI_TEXT.accounts.invalidAccount)
          const vendor = this.triggers(previous, request.estimate, this.deps.journal, request).find(
            (entry) => entry.kind === 'vendorLimit',
          )
          if (vendor !== undefined && selected.trigger?.kind !== 'vendorLimit')
            throw new AccountThresholdExceededError(vendor)
        }
        claim.checkSharedCaps()
        const triggers = this.triggers(account, selected.estimate, claim.journal, request)
        if (triggers[0] !== undefined) throw new AccountThresholdExceededError(triggers[0])
      }
      try {
        check()
        return { ...selected, claim, check }
      } catch (error: unknown) {
        await claim.settle(parseUsd(0), false)
        throw error
      }
    })()
    this.admission = (async () => {
      try {
        await operation
      } catch {
        /* Caller receives the refusal. */
      }
    })()
    const admitted = await operation
    return admitted ?? (await this.admit(request, isEligible))
  }

  private release(owner: string): void {
    this.active.delete(owner)
    if (this.boundaries.has(owner)) return
    const next = this.next.get(owner)
    this.next.delete(owner)
    if (next !== undefined)
      this.sticky.set(owner, { account: next, trigger: undefined, decision: undefined })
  }

  /** Offers consult the same full-group limits as admission, before reservation. */
  public hasRoom(account: Account, request: AccountPoolRequest): boolean {
    return (
      this.deps.canUseModel(account, request) &&
      this.triggers(account, request.estimate, this.deps.journal, request).length === 0
    )
  }

  /** Select/reserve once; the caller owns completion even after failure or abort. */
  public async acquire(
    request: AccountPoolRequest,
    isEligible: (account: Account) => boolean = () => true,
  ) {
    request = Object.freeze({ ...request, estimate: Object.freeze({ ...request.estimate }) })
    if (this.deps.isHeld?.() === true) throw new AccountPoolBusyError()
    const owner = this.owner(request)
    if (this.active.has(owner)) throw new AccountPoolBusyError()
    this.active.add(owner)
    const operation = this.admit(request, isEligible)
    try {
      const admitted = await operation
      const sent = { value: false }
      const didSend = () => sent.value
      let isSettled = false
      return {
        account: admitted.account.id,
        estimate: admitted.estimate,
        check: () => {
          if (isSettled) throw new Error(UI_TEXT.accounts.invalidAccount)
          admitted.check()
        },
        beforeSend: () => {
          if (isSettled) throw new Error(UI_TEXT.accounts.invalidAccount)
          const adopt = () => {
            admitted.check()
            admitted.claim.started?.()
            const previous = this.sticky.get(owner)
            const wasSent = sent.value
            if (!this.next.has(owner)) this.deps.writeSelection?.(owner, admitted.account.id)
            this.sticky.set(owner, {
              account: admitted.account.id,
              decision: admitted.decision,
              trigger: admitted.policyTrigger,
            })
            sent.value = true
            return () => {
              if (previous === undefined) this.sticky.delete(owner)
              else this.sticky.set(owner, previous)
              sent.value = wasSent
            }
          }
          if (sent.value || admitted.previousAccount === admitted.account.id) adopt()
          else {
            const trigger = admitted.trigger
            this.deps.commit(
              accountEventSchema.parse({
                provider: this.deps.provider,
                account: admitted.account.id,
                time: new Date(this.deps.now()).toISOString(),
                ...(trigger === undefined
                  ? { type: 'spread', workerId: request.owner }
                  : {
                      type: 'swap',
                      previousAccount: admitted.previousAccount,
                      trigger,
                      coldCacheUsd: usdDecimal(admitted.coldCacheUsd),
                    }),
              }),
              adopt,
              request,
            )
            if (!didSend()) throw new Error(UI_TEXT.accounts.invalidAccount)
          }
        },
        settle: async (actualUsd: Usd | null, didDispatch = sent.value) => {
          if (isSettled) throw new Error(UI_TEXT.accounts.invalidAccount)
          if (actualUsd !== null && actualUsd < parseUsd(0))
            throw new Error(UI_TEXT.accounts.invalidAccount)
          isSettled = true
          try {
            await admitted.claim.settle(didDispatch ? actualUsd : parseUsd(0), didDispatch)
          } finally {
            this.release(owner)
          }
        },
      }
    } catch (error: unknown) {
      this.release(owner)
      throw error
    }
  }

  /** Only admissions serialize. Requests already sent keep their client and liability. */
  public async run<T>(
    request: AccountPoolRequest,
    dispatch: (admission: {
      readonly account: string
      readonly estimate: AccountRequestEstimate
      readonly check: () => void
      readonly beforeSend: () => void
    }) => Promise<{ readonly value: T; readonly actualUsd: Usd | null }>,
    isEligible: (account: Account) => boolean = () => true,
  ): Promise<T> {
    const admitted = await this.acquire(request, isEligible)
    let actualUsd: Usd | null = null
    const sent = { value: false }
    try {
      const result = await dispatch({
        ...admitted,
        beforeSend: () => {
          admitted.beforeSend()
          sent.value = true
        },
      })
      if (!sent.value) throw new Error(UI_TEXT.accounts.invalidAccount)
      if (result.actualUsd !== null && result.actualUsd < parseUsd(0))
        throw new Error(UI_TEXT.accounts.invalidAccount)
      actualUsd = result.actualUsd
      return result.value
    } finally {
      await admitted.settle(actualUsd)
    }
  }

  public async withinRequest<T>(
    kind: AccountPoolRequest['kind'],
    owner: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([kind, owner])
    if (this.boundaries.has(key)) throw new AccountPoolBusyError()
    this.boundaries.add(key)
    try {
      return await run()
    } finally {
      this.boundaries.delete(key)
      this.release(key)
    }
  }

  /** A user's explicit selection is fenced against an active request. */
  public use(
    kind: AccountPoolRequest['kind'],
    owner: string,
    account: string,
    canCommit: () => boolean,
  ): void {
    const key = JSON.stringify([kind, owner])
    if (this.active.has(key)) throw new AccountPoolBusyError()
    if (this.rows().every((row) => row.id !== account) || !canCommit())
      throw new Error(UI_TEXT.accounts.invalidAccount)
    this.deps.writeSelection?.(key, account)
    this.sticky.set(key, { account, trigger: undefined, decision: undefined })
  }

  /** Queue an explicit selection without changing an admitted request's payer. */
  public useNext(
    kind: AccountPoolRequest['kind'],
    owner: string,
    account: string,
    canCommit: () => boolean,
  ): void {
    const key = JSON.stringify([kind, owner])
    if (!this.active.has(key) && !this.boundaries.has(key)) {
      this.use(kind, owner, account, canCommit)
      return
    }
    if (this.rows().every((row) => row.id !== account) || !canCommit())
      throw new Error(UI_TEXT.accounts.invalidAccount)
    this.deps.writeSelection?.(key, account)
    this.next.set(key, account)
  }

  public current(kind: AccountPoolRequest['kind'], owner: string): string | undefined {
    const key = JSON.stringify([kind, owner])
    return this.next.get(key) ?? this.sticky.get(key)?.account ?? this.deps.readSelection?.(key)
  }
}

export interface AccountReplayIdentity {
  readonly provider: string
  readonly account: string
  readonly origin: string
  readonly model: string
}

/** Captured codecs classify native items and retain their visible text. No group exception yet. */
export function accountReplay<Item>(
  entries: readonly {
    readonly item: Item
    readonly producer?: AccountReplayIdentity
  }[],
  target: AccountReplayIdentity,
  codec: {
    readonly isNative: (item: Item) => boolean
    readonly textOnly: (item: Item) => readonly Item[]
  },
): readonly Item[] {
  return entries.flatMap(({ item, producer }) =>
    !codec.isNative(item) ||
    (producer?.provider === target.provider &&
      producer.account === target.account &&
      producer.origin === target.origin &&
      producer.model === target.model)
      ? [item]
      : codec.textOnly(item),
  )
}

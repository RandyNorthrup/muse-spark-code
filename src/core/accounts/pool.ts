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
import { multiplyUsd, parseUsd, sumUsd, usdNumber, type Usd } from '../../shared/usd'
import type { AccountPolicy } from '../providers/accountPolicy'
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
  /** Excludes this owned pending projection only. Already-sent attempts and
   * settled/uncertain liability (including earlier retries) remain visible. */
  readonly journal: AccountJournalReader
  /** Original shared daily and conversation scopes, never changed by a swap. */
  readonly checkSharedCaps: () => void
  /** null retains uncertain liability on its original account; zero refunds a nonsend. */
  readonly settle: (actualUsd: Usd | null, hasSent: boolean) => Promise<void>
}
export interface AccountPoolDeps {
  readonly provider: string
  readonly policy: () => AccountPolicy | undefined
  readonly accounts: () => readonly Account[]
  readonly journal: AccountJournalReader
  readonly limits: (request: AccountPoolRequest) => AccountLimitsReader
  readonly gate: AccountPolicyGate
  readonly now: () => number
  readonly usageUrl: string
  readonly settings?: () => { readonly isSwapOn: boolean; readonly isParallelOn: boolean }
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
  readonly commit: (event: AccountEvent, adopt: () => void) => void
  readonly sharedGroupNotice: (account: string) => Promise<void>
}
export interface AccountPoolRequest {
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
    super(UI_TEXT.acpPromptBusy)
    this.name = 'AccountPoolBusyError'
  }
}

/** Lane-0 numeric outputs may not silently lose an exact nano-USD liability. */
function numericUsd(value: Usd): number {
  const converted = usdNumber(value)
  if (parseUsd(converted) !== value) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  return converted
}

function projected(estimate: AccountRequestEstimate) {
  return {
    settledUsd: 0,
    reservedUsd: numericUsd(estimate.costUsd),
    uncertainUsd: 0,
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
  private admission: Promise<void> = Promise.resolve()

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
        (this.deps.policy()?.limitScopes.includes('global') !== true &&
          (account.limitGroup === undefined || account.limitGroup !== peer.limitGroup))
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
    const held = this.sticky.get(owner)
    const current = rows.find((row) => row.id === (held?.account ?? request.account))
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
    if ((!isCurrentEligible || triggers.length > 0) && (!canPool || !settings.isSwapOn))
      return await this.stop(current, triggers)
    if (triggers.length > 0 && rows.length === 1) return await this.stop(current, triggers)
    const isSpread =
      canPool &&
      settings.isParallelOn &&
      rows.length > 1 &&
      request.kind === 'worker' &&
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
      ? rows.toSorted((a, b) => {
          const left = this.deps.headroom(a, request),
            right = this.deps.headroom(b, request)
          if (left < parseUsd(0) || right < parseUsd(0))
            throw new Error(UI_TEXT.accounts.invalidAccount)
          if (left === right) return a.order - b.order
          return left > right ? -1 : 1
        })
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
        (this.deps.policy()?.limitScopes.includes('global') === true ||
          (current.limitGroup !== undefined && account.limitGroup === current.limitGroup))
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
        }
    }
    return await this.stop(current, allTriggers, undefined, recoveries)
  }

  private async admit(request: AccountPoolRequest, isEligible: (account: Account) => boolean) {
    const selected = await this.select(request, isEligible)
    const claim = await this.deps.reserve(selected.account, selected.estimate, request)
    const check = () => {
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
  }

  /** Offers consult the same full-group limits as admission, before reservation. */
  public hasRoom(account: Account, request: AccountPoolRequest): boolean {
    return (
      this.deps.canUseModel(account, request) &&
      this.triggers(account, request.estimate, this.deps.journal, request).length === 0
    )
  }

  /** Only admissions serialize. Requests already sent keep their client and liability. */
  public async run<T>(
    request: AccountPoolRequest,
    dispatch: (admission: {
      readonly account: string
      readonly estimate: AccountRequestEstimate
      readonly check: () => void
      /** Call synchronously immediately before EVERY send/retry, after credential lookup. */
      readonly beforeSend: () => void
    }) => Promise<{ readonly value: T; readonly actualUsd: Usd | null }>,
    isEligible: (account: Account) => boolean = () => true,
  ): Promise<T> {
    request = Object.freeze({ ...request, estimate: Object.freeze({ ...request.estimate }) })
    const owner = this.owner(request)
    if (this.active.has(owner)) throw new AccountPoolBusyError()
    this.active.add(owner)
    const previous = this.admission
    const operation = (async () => {
      await previous
      return await this.admit(request, isEligible)
    })()
    this.admission = (async () => {
      try {
        await operation
      } catch {
        /* Caller receives the refusal. */
      }
    })()
    try {
      const admitted = await operation
      const state = { hasSent: false }
      const hasSent = () => state.hasSent
      let actualUsd: Usd | null = null
      try {
        const result = await dispatch({
          account: admitted.account.id,
          estimate: admitted.estimate,
          check: admitted.check,
          beforeSend: () => {
            const adopt = () => {
              admitted.check()
              this.sticky.set(owner, {
                account: admitted.account.id,
                decision: admitted.decision,
                trigger: admitted.policyTrigger,
              })
              state.hasSent = true
            }
            if (state.hasSent || admitted.previousAccount === admitted.account.id) adopt()
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
                        coldCacheUsd: numericUsd(admitted.coldCacheUsd),
                      }),
                }),
                adopt,
              )
              if (!hasSent()) throw new Error(UI_TEXT.accounts.invalidAccount)
            }
          },
        })
        if (!hasSent()) throw new Error(UI_TEXT.accounts.invalidAccount)
        if (result.actualUsd !== null && result.actualUsd < parseUsd(0))
          throw new Error(UI_TEXT.accounts.invalidAccount)
        actualUsd = result.actualUsd
        return result.value
      } finally {
        await admitted.claim.settle(state.hasSent ? actualUsd : parseUsd(0), state.hasSent)
      }
    } finally {
      this.active.delete(owner)
    }
  }

  public current(kind: AccountPoolRequest['kind'], owner: string): string | undefined {
    return this.sticky.get(JSON.stringify([kind, owner]))?.account
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

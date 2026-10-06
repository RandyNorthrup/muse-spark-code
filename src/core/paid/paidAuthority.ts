import { UI_TEXT } from '../../shared/constants'
// One synchronous owner of quote authority. Awaited work can only complete a
// tagged effect; it cannot choose a generation, key or tariff after the wait.
import type { PaidQuote, SearchSettlement } from '../../shared/paid'
import { searchSettlement } from '../../shared/paid'
import { Usd, sumUsd, type UsdAmount } from '../../shared/usd'

export interface PaidGrant {
  readonly generation: string
  readonly order?: number | undefined
  readonly quote: PaidQuote
}

interface QuoteState extends PaidGrant {
  readonly status: 'asking' | 'saving' | 'approved'
}
interface ClaimState {
  readonly quote?: PaidQuote
  readonly actualUsd?: UsdAmount
  readonly retainedUsd?: UsdAmount
  readonly pending?: MoneyEffect
  readonly reservedUsd: UsdAmount
  readonly settlement?: SearchSettlement
}
interface MoneyEffect {
  readonly type: 'persistMoney'
  readonly claimId: string
  readonly amount: UsdAmount
  readonly isFinal: boolean
  readonly hasUnknownCost: boolean
}
export interface PaidAuthorityState {
  readonly days: ReadonlyMap<string, { readonly capUsd: UsdAmount; readonly spentUsd: UsdAmount }>
  readonly generations: ReadonlyMap<string, string>
  readonly quotes: ReadonlyMap<string, QuoteState>
  readonly grants: ReadonlyMap<string, PaidGrant>
  readonly claims: ReadonlyMap<string, ClaimState>
  readonly settledUsd: UsdAmount
}
export type PaidAuthorityEvent =
  | { readonly type: 'observedGrant'; readonly grant: PaidGrant }
  | {
      readonly type: 'day'
      readonly day: string
      readonly capUsd: UsdAmount
      readonly spentUsd: UsdAmount
    }
  | { readonly type: 'moneyReserve'; readonly claimId: string; readonly reservedUsd: UsdAmount }
  | {
      readonly type: 'moneySettle'
      readonly claimId: string
      readonly amount: UsdAmount
      readonly isFinal: boolean
      readonly hasUnknownCost: boolean
    }
  | { readonly type: 'moneySaved'; readonly effect: MoneyEffect }
  | { readonly type: 'moneyFailed'; readonly effect: MoneyEffect }
  | {
      readonly type: 'quote'
      readonly order?: number | undefined
      readonly quote: PaidQuote
      readonly generation: string
      readonly grant?: PaidGrant
      readonly ask: boolean
    }
  | {
      readonly type: 'answer'
      readonly grant: PaidGrant
      readonly answer: 'once' | 'always' | 'deny'
    }
  | { readonly type: 'saved'; readonly grant: PaidGrant; readonly ok: boolean }
  | { readonly type: 'revoke'; readonly key: string; readonly generation: string }
  | {
      readonly type: 'reserve'
      readonly claimId: string
      readonly quote: PaidQuote
      readonly reservedUsd: UsdAmount
    }
  | {
      readonly type: 'settle'
      readonly claimId: string
      readonly returnedCalls: number
      readonly isTerminal: boolean
    }
export type PaidAuthorityEffect =
  | MoneyEffect
  | { readonly type: 'persistReserve'; readonly claimId: string; readonly amount: UsdAmount }
  | { readonly type: 'ask' | 'save'; readonly grant: PaidGrant }
  | { readonly type: 'settled'; readonly claimId: string; readonly settlement: SearchSettlement }

export function paidAuthorityKey(quote: PaidQuote): string {
  return JSON.stringify([quote.feature, quote.provider, quote.model])
}
export function initialPaidAuthorityState(): PaidAuthorityState {
  return {
    days: new Map(),
    generations: new Map(),
    quotes: new Map(),
    grants: new Map(),
    claims: new Map(),
    settledUsd: Usd.from(0).toAmount(),
  }
}

/** All decisions happen here, before effects run. Persistence never supplies authority. */
export function step(
  state: PaidAuthorityState,
  event: PaidAuthorityEvent,
): {
  readonly state: PaidAuthorityState
  readonly effects: readonly PaidAuthorityEffect[]
} {
  if (event.type === 'observedGrant') {
    const key = paidAuthorityKey(event.grant.quote)
    if (state.generations.get(key) !== event.grant.generation) return { state, effects: [] }
    const current = state.quotes.get(key)
    if (
      current === undefined ||
      current.quote.id === event.grant.quote.id ||
      (event.grant.order ?? 0) < (current.order ?? 0)
    )
      return { state, effects: [] }
    const quotes = new Map(state.quotes)
    quotes.delete(key)
    const grants = new Map(state.grants)
    grants.set(key, event.grant)
    return { state: { ...state, quotes, grants }, effects: [] }
  }
  if (event.type === 'day') {
    const days = new Map(state.days)
    days.set(event.day, { capUsd: event.capUsd, spentUsd: event.spentUsd })
    return { state: { ...state, days }, effects: [] }
  }
  if (event.type === 'moneyReserve') {
    if (state.claims.has(event.claimId)) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    const claims = new Map(state.claims)
    claims.set(event.claimId, { reservedUsd: event.reservedUsd })
    return {
      state: { ...state, claims },
      effects: [{ type: 'persistReserve', claimId: event.claimId, amount: event.reservedUsd }],
    }
  }
  if ('effect' in event || event.type === 'moneySettle') {
    const effect: MoneyEffect =
      event.type === 'moneySettle' ? { ...event, type: 'persistMoney' } : event.effect
    const claim = state.claims.get(effect.claimId)
    if (claim === undefined) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    const previous = claim.pending
    const isSame = (other: MoneyEffect) =>
      other.amount === effect.amount &&
      other.isFinal === effect.isFinal &&
      other.hasUnknownCost === effect.hasUnknownCost
    if (event.type !== 'moneySettle' && (previous === undefined || !isSame(previous)))
      return { state, effects: [] }
    if (event.type === 'moneySettle') {
      if (claim.actualUsd !== undefined && claim.actualUsd !== effect.amount)
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      if (
        !effect.isFinal &&
        Usd.from(effect.amount).compare(Usd.from(claim.retainedUsd ?? claim.reservedUsd)) < 0
      )
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      if (previous !== undefined && !isSame(previous))
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      if (previous !== undefined) return { state, effects: [] }
    }
    const claims = new Map(state.claims)
    if (event.type === 'moneySettle') claims.set(effect.claimId, { ...claim, pending: effect })
    else {
      const { pending: _completed, ...settled } = claim
      claims.set(
        effect.claimId,
        event.type === 'moneyFailed'
          ? settled
          : {
              ...settled,
              ...(effect.isFinal ? { actualUsd: effect.amount } : { retainedUsd: effect.amount }),
            },
      )
    }
    return { state: { ...state, claims }, effects: event.type === 'moneySettle' ? [effect] : [] }
  }
  if (event.type === 'revoke') {
    const generations = new Map(state.generations)
    const grants = new Map(state.grants)
    const quotes = new Map(state.quotes)
    generations.set(event.key, event.generation)
    grants.delete(event.key)
    quotes.delete(event.key)
    return { state: { ...state, generations, grants, quotes }, effects: [] }
  }
  if (event.type === 'quote') {
    const key = paidAuthorityKey(event.quote)
    const generations = new Map(state.generations)
    const quotes = new Map(state.quotes)
    const grants = new Map(state.grants)
    generations.set(key, event.generation)
    const grant =
      event.grant?.generation === event.generation && paidAuthorityKey(event.grant.quote) === key
        ? event.grant
        : undefined
    if (grant === undefined) grants.delete(key)
    else grants.set(key, grant)
    const isApproved =
      !event.ask &&
      grant !== undefined &&
      Usd.from(event.quote.tariffUsd).compare(Usd.from(grant.quote.tariffUsd)) <= 0
    const tag = { quote: event.quote, generation: event.generation, order: event.order ?? 1 }
    quotes.set(key, { ...tag, status: isApproved ? 'approved' : 'asking' })
    return {
      state: { ...state, generations, quotes, grants },
      effects: isApproved ? [] : [{ type: 'ask', grant: tag }],
    }
  }
  if (event.type === 'answer' || event.type === 'saved') {
    const key = paidAuthorityKey(event.grant.quote)
    const current = state.quotes.get(key)
    if (
      state.generations.get(key) !== event.grant.generation ||
      current?.quote.id !== event.grant.quote.id ||
      current.generation !== event.grant.generation ||
      (current.order ?? 1) !== (event.grant.order ?? 1)
    )
      return { state, effects: [] }
    if (event.type === 'answer' && current.status !== 'asking') return { state, effects: [] }
    if (event.type === 'saved' && current.status !== 'saving') return { state, effects: [] }
    const quotes = new Map(state.quotes)
    const grants = new Map(state.grants)
    if (event.type === 'answer' && event.answer === 'deny') quotes.delete(key)
    else
      quotes.set(key, {
        ...current,
        status: event.type === 'answer' && event.answer === 'always' ? 'saving' : 'approved',
      })
    if (event.type === 'saved' && event.ok) grants.set(key, event.grant)
    return {
      state: { ...state, quotes, grants },
      effects:
        event.type === 'answer' && event.answer === 'always'
          ? [{ type: 'save', grant: event.grant }]
          : [],
    }
  }
  if (event.type === 'reserve') {
    const current = state.quotes.get(paidAuthorityKey(event.quote))
    if (current?.status !== 'approved' || current.quote.id !== event.quote.id)
      throw new Error(UI_TEXT.sessionBudgetSearchUnavailable)
    if (state.claims.has(event.claimId)) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    const claims = new Map(state.claims)
    claims.set(event.claimId, { quote: current.quote, reservedUsd: event.reservedUsd })
    return { state: { ...state, claims }, effects: [] }
  }
  const claim = state.claims.get(event.claimId)
  if (claim?.quote === undefined) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  const settlement = searchSettlement(claim.quote, event.returnedCalls, event.isTerminal)
  const previous = claim.settlement
  if (
    previous?.isTerminal === true &&
    (previous.returnedCalls !== settlement.returnedCalls || !settlement.isTerminal)
  )
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  if (previous !== undefined && settlement.returnedCalls < previous.returnedCalls)
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  const delta = Usd.from(settlement.costUsd)
    .subtract(Usd.from(previous?.costUsd ?? 0))
    .toAmount()
  const claims = new Map(state.claims)
  claims.set(event.claimId, { ...claim, settlement })
  return {
    state: { ...state, claims, settledUsd: sumUsd(state.settledUsd, delta) },
    effects: [{ type: 'settled', claimId: event.claimId, settlement }],
  }
}

export class PaidAuthority {
  private state = initialPaidAuthorityState()
  private readonly validators = new Map<string, () => boolean>()
  public nextOrder(quote: PaidQuote, grant: PaidGrant | undefined): number {
    return (
      Math.max(this.state.quotes.get(paidAuthorityKey(quote))?.order ?? 0, grant?.order ?? 0) + 1
    )
  }
  public day(scope: string) {
    return this.state.days.get(scope)
  }
  public bind(quote: PaidQuote, isCurrent: () => boolean): void {
    this.validators.set(quote.id, isCurrent)
  }
  public canSpend(quote: PaidQuote): boolean {
    const current = this.state.quotes.get(paidAuthorityKey(quote))
    if (current?.quote.id !== quote.id || current.status !== 'approved') return false
    if (this.validators.get(quote.id)?.() === false) {
      this.dispatch({
        type: 'revoke',
        key: paidAuthorityKey(quote),
        generation: this.state.generations.get(paidAuthorityKey(quote)) ?? current.generation,
      })
      return false
    }
    return true
  }
  public dispatch(event: PaidAuthorityEvent): readonly PaidAuthorityEffect[] {
    const result = step(this.state, event)
    for (const [key, previous] of this.state.quotes) {
      const current = result.state.quotes.get(key)
      if (current?.quote.id !== previous.quote.id || current.order !== previous.order)
        this.validators.delete(previous.quote.id)
    }
    this.state = result.state
    return result.effects
  }
  public hasGrant(): boolean {
    return this.state.grants.size > 0
  }
  public grant(quote: PaidQuote): PaidGrant | undefined {
    return this.state.grants.get(paidAuthorityKey(quote))
  }
  public isApproved(grant: PaidGrant): boolean {
    const current = this.state.quotes.get(paidAuthorityKey(grant.quote))
    return (
      current?.status === 'approved' &&
      current.quote.id === grant.quote.id &&
      current.generation === grant.generation &&
      (current.order ?? 1) === (grant.order ?? 1)
    )
  }
  public isCurrent(grant: PaidGrant): boolean {
    const current = this.state.quotes.get(paidAuthorityKey(grant.quote))
    return (
      current?.quote.id === grant.quote.id &&
      current.generation === grant.generation &&
      (current.order ?? 1) === (grant.order ?? 1)
    )
  }
  public revokeAll(generation: string): void {
    const keys = new Set([...this.state.quotes.keys(), ...this.state.grants.keys()])
    for (const key of keys) this.dispatch({ type: 'revoke', key, generation })
  }
}

/** Immutable quote records: newest issued answer wins, concurrent ties fail closed. */
export function latestPaidGrant(grants: readonly PaidGrant[]): PaidGrant | undefined {
  let latest: PaidGrant | undefined
  for (const grant of grants) {
    if (
      latest === undefined ||
      (grant.order ?? 0) > (latest.order ?? 0) ||
      ((grant.order ?? 0) === (latest.order ?? 0) &&
        Usd.from(grant.quote.tariffUsd).compare(Usd.from(latest.quote.tariffUsd)) < 0)
    )
      latest = grant
  }
  return latest
}

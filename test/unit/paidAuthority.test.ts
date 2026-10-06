import { UI_TEXT } from '../../src/shared/constants'
import { describe, expect, it } from 'vitest'
import {
  latestPaidGrant,
  PaidAuthority,
  initialPaidAuthorityState,
  paidAuthorityKey,
  step,
  type PaidAuthorityEvent,
  type PaidAuthorityState,
  type PaidGrant,
} from '../../src/core/paid/paidAuthority'
import { quotedSearch } from './helpers/paidQuote'
import { PaidUsage } from '../../src/core/paid/paidFeatures'
import { paidCostUsd } from '../../src/shared/paid'
import { Usd } from '../../src/shared/usd'
import { FakeLogOutputChannel } from './helpers/fakes'

function permutations<T>(items: readonly T[]): T[][] {
  return items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permutations(items.filter((_value, other) => other !== index)).map((tail) => [
          item,
          ...tail,
        ]),
      )
}
function answer(grant: PaidGrant): PaidAuthorityEvent {
  return { type: 'answer', grant, answer: 'always' }
}
function saving(state: PaidAuthorityState, grant: PaidGrant): PaidAuthorityState {
  const quoting = step(state, { type: 'quote', ...grant, ask: true }).state
  return step(quoting, answer(grant)).state
}

const a: PaidGrant = { quote: quotedSearch('0.01').quote, generation: 'old' }
const b: PaidGrant = {
  quote: quotedSearch('0.1234567890123456789', 'model-b').quote,
  generation: 'old',
}

describe('serialized paid authority (REDM106H)', () => {
  it('R3 P2-1: a save only changes its provider/model key', () => {
    let state = saving(saving(initialPaidAuthorityState(), a), b)
    state = step(state, { type: 'saved', grant: b, ok: true }).state
    expect(state.grants.has(paidAuthorityKey(a.quote))).toBe(false)
    expect(state.grants.get(paidAuthorityKey(b.quote))).toEqual(b)
  })

  it('R3 P2-2: discards an old expensive save after revocation and a cheaper approval', () => {
    const key = paidAuthorityKey(a.quote)
    let state = saving(initialPaidAuthorityState(), a)
    state = step(state, { type: 'revoke', key, generation: 'new' }).state
    const fresh = { quote: quotedSearch('0.0025', 'model-a', 'fresh').quote, generation: 'new' }
    state = saving(state, fresh)
    state = step(state, { type: 'saved', grant: fresh, ok: true }).state
    expect(step(state, { type: 'saved', grant: a, ok: true })).toEqual({ state, effects: [] })
    expect(state.grants.get(key)?.quote.tariffUsd).toBe(Usd.from('0.0025').toAmount())
  })

  it('rejects quote-id reuse after a pricing refresh and unconsented reservations', () => {
    let state = saving(initialPaidAuthorityState(), a)
    state = step(state, {
      type: 'quote',
      quote: quotedSearch('0.0025', 'model-a', 'refresh').quote,
      generation: 'old',
      ask: true,
    }).state
    expect(step(state, { type: 'saved', grant: a, ok: true }).state).toBe(state)
    expect(() =>
      step(state, {
        type: 'reserve',
        quote: a.quote,
        claimId: 'unconsented',
        reservedUsd: Usd.from('0.01').toAmount(),
      }),
    ).toThrow(UI_TEXT.sessionBudgetSearchUnavailable)
  })

  it('all 720 completion orders preserve keys, generations, quote consent and exact projections', () => {
    const key = paidAuthorityKey(a.quote)
    let initial = saving(saving(initialPaidAuthorityState(), a), b)
    initial = step(initial, { type: 'answer', grant: b, answer: 'once' }).state
    // A different already-consented quote owns a dispatched request.
    const dispatched = {
      quote: quotedSearch('0.1234567890123456789', 'sent').quote,
      generation: 'old',
    }
    initial = step(initial, { type: 'quote', ...dispatched, ask: true }).state
    initial = step(initial, { type: 'answer', grant: dispatched, answer: 'once' }).state
    initial = step(initial, {
      type: 'reserve',
      quote: dispatched.quote,
      claimId: 'sent',
      reservedUsd: Usd.from('1').toAmount(),
    }).state
    const fresh: PaidGrant = {
      quote: quotedSearch('0.0025', 'model-a', 'new').quote,
      generation: 'new',
    }
    const events: PaidAuthorityEvent[] = [
      { type: 'saved', grant: a, ok: true },
      { type: 'saved', grant: b, ok: true },
      { type: 'revoke', key, generation: 'new' },
      answer(a),
      { type: 'quote', ...fresh, ask: true },
      { type: 'settle', claimId: 'sent', returnedCalls: 3, isTerminal: true },
    ]
    for (const order of permutations(events)) {
      let state = initial
      const tally = new PaidUsage(new FakeLogOutputChannel())
      let daily = Usd.from(0).toAmount()
      let session = Usd.from(0).toAmount()
      for (const event of order) {
        const result = step(state, event)
        state = result.state
        for (const [grantKey, grant] of state.grants) {
          expect(paidAuthorityKey(grant.quote)).toBe(grantKey)
          expect(grant.generation).toBe(state.generations.get(grantKey))
        }
        for (const effect of result.effects) {
          if (effect.type !== 'settled') continue
          const { settlement } = effect
          expect(settlement.quote).toBe(dispatched.quote)
          expect(settlement.costUsd).toBe(Usd.from('0.3703703670370370367').toAmount())
          daily = settlement.costUsd
          session = settlement.costUsd
          tally.add('webSearch', settlement.returnedCalls, settlement)
        }
        expect(daily).toBe(session)
        expect(daily).toBe(paidCostUsd('webSearch', tally.current))
        expect(state.settledUsd).toBe(daily)
      }
    }
  })
})

describe('paid effect ownership', () => {
  it('owns daily claims, coalesces a write, discards stale completions and retries failures', () => {
    const owner = new PaidAuthority()
    const amount = Usd.from('0.00000000000000004').toAmount()
    expect(owner.dispatch({ type: 'moneyReserve', claimId: 'daily', reservedUsd: amount })).toEqual(
      [{ type: 'persistReserve', claimId: 'daily', amount }],
    )
    expect(() =>
      owner.dispatch({ type: 'moneyReserve', claimId: 'daily', reservedUsd: amount }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(() =>
      owner.dispatch({
        type: 'moneySettle',
        claimId: 'other',
        amount,
        isFinal: true,
        hasUnknownCost: false,
      }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    const request = {
      type: 'moneySettle',
      claimId: 'daily',
      amount,
      isFinal: false,
      hasUnknownCost: true,
    } as const
    const [effect] = owner.dispatch(request)
    if (effect?.type !== 'persistMoney') throw new Error('missing write effect')
    expect(owner.dispatch(request)).toEqual([])
    expect(() => owner.dispatch({ ...request, amount: Usd.from('1').toAmount() })).toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    expect(owner.dispatch({ type: 'moneySaved', effect: { ...effect, isFinal: true } })).toEqual([])
    owner.dispatch({ type: 'moneyFailed', effect })
    expect(owner.dispatch(request)).toEqual([effect])
    owner.dispatch({ type: 'moneySaved', effect })
    expect(() => owner.dispatch({ ...request, amount: Usd.from(0).toAmount() })).toThrow(
      UI_TEXT.sessionBudgetStoreUnavailable,
    )
    const [final] = owner.dispatch({ ...request, isFinal: true })
    if (final?.type !== 'persistMoney') throw new Error('missing final effect')
    owner.dispatch({ type: 'moneySaved', effect: final })
    expect(() =>
      owner.dispatch({ ...request, isFinal: true, amount: Usd.from('1').toAmount() }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    owner.dispatch({ type: 'day', day: 'today', capUsd: Usd.from(1).toAmount(), spentUsd: amount })
    expect(owner.day('today')).toEqual({ capUsd: Usd.from(1).toAmount(), spentUsd: amount })
  })

  it('reuses only matching ceilings and consumes each tagged answer once', () => {
    const owner = new PaidAuthority()
    const grant = { quote: a.quote, generation: 'old' }
    expect(owner.dispatch({ type: 'quote', ...grant, grant: b, ask: false })).toHaveLength(1)
    owner.dispatch({ type: 'answer', grant, answer: 'deny' })
    expect(owner.isCurrent(grant)).toBe(false)
    owner.dispatch({ type: 'quote', ...grant, grant, ask: false })
    expect(owner.isApproved(grant)).toBe(true)
    expect(owner.grant(a.quote)).toEqual(grant)
    expect(owner.hasGrant()).toBe(true)
    expect(owner.dispatch({ type: 'answer', grant, answer: 'always' })).toEqual([])
    expect(owner.dispatch({ type: 'saved', grant, ok: true })).toEqual([])
    const higher = { quote: quotedSearch('0.02', 'model-a', 'higher').quote, generation: 'old' }
    owner.dispatch({ type: 'quote', ...higher, grant, ask: false })
    owner.dispatch({ type: 'answer', grant: higher, answer: 'always' })
    owner.dispatch({ type: 'saved', grant: higher, ok: false })
    expect(owner.isApproved(higher)).toBe(true)
    owner.bind(higher.quote, () => false)
    expect(owner.canSpend(higher.quote)).toBe(false)
    expect(owner.canSpend(higher.quote)).toBe(false)
    owner.dispatch({ type: 'quote', ...grant, ask: true })
    owner.bind(a.quote, () => true)
    expect(owner.canSpend(a.quote)).toBe(false)
    owner.dispatch({ type: 'answer', grant, answer: 'once' })
    expect(owner.canSpend(a.quote)).toBe(true)
    const another = { quote: quotedSearch('0.01', 'model-a', 'another').quote, generation: 'old' }
    owner.dispatch({ type: 'quote', ...another, ask: true })
    expect(owner.isApproved(grant)).toBe(false)
    owner.revokeAll('new')
    expect(owner.isCurrent(another)).toBe(false)
  })

  it('settles an owned dispatched quote monotonically, including identical terminal repeats', () => {
    let state = step(initialPaidAuthorityState(), { type: 'quote', ...a, ask: true }).state
    state = step(state, { type: 'answer', grant: a, answer: 'once' }).state
    const reserve = {
      type: 'reserve',
      claimId: 'request',
      quote: a.quote,
      reservedUsd: Usd.from('1').toAmount(),
    } as const
    state = step(state, reserve).state
    expect(() => step(state, reserve)).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(() =>
      step(state, { type: 'settle', claimId: 'missing', returnedCalls: 1, isTerminal: true }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    state = step(state, {
      type: 'settle',
      claimId: 'request',
      returnedCalls: 2,
      isTerminal: false,
    }).state
    expect(() =>
      step(state, { type: 'settle', claimId: 'request', returnedCalls: 1, isTerminal: false }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    state = step(state, {
      type: 'settle',
      claimId: 'request',
      returnedCalls: 3,
      isTerminal: true,
    }).state
    expect(
      step(state, { type: 'settle', claimId: 'request', returnedCalls: 3, isTerminal: true }).state
        .settledUsd,
    ).toBe(Usd.from('0.03').toAmount())
    expect(() =>
      step(state, { type: 'settle', claimId: 'request', returnedCalls: 3, isTerminal: false }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })
})

it('immutable persisted answers prefer newer order and the lower ceiling on a concurrent tie', () => {
  const old = { ...a, order: 1 }
  const fresh = {
    quote: quotedSearch('0.0025', 'model-a', 'fresh').quote,
    generation: 'old',
    order: 2,
  }
  expect(latestPaidGrant([fresh, old])).toEqual(fresh)
  expect(latestPaidGrant([old, fresh])).toEqual(fresh)
  expect(latestPaidGrant([{ ...old, order: 2 }, fresh])).toEqual(fresh)
  const owner = new PaidAuthority()
  expect(owner.nextOrder(a.quote, undefined)).toBe(1)
  owner.dispatch({ type: 'quote', ...old, ask: true })
  expect(owner.nextOrder(a.quote, fresh)).toBe(3)
  expect(
    owner.dispatch({ type: 'observedGrant', grant: { ...fresh, generation: 'other' } }),
  ).toEqual([])
  expect(owner.dispatch({ type: 'observedGrant', grant: old })).toEqual([])
  expect(owner.dispatch({ type: 'observedGrant', grant: { ...fresh, order: 0 } })).toEqual([])
  owner.dispatch({ type: 'observedGrant', grant: fresh })
  expect(owner.isCurrent(old)).toBe(false)
  expect(owner.dispatch({ type: 'observedGrant', grant: fresh })).toEqual([])
  expect(owner.hasGrant()).toBe(true)
  owner.revokeAll('revoked')
  expect(owner.hasGrant()).toBe(false)
})

it('R3 P2-2: a reissued quote id still rejects its original revocation generation', () => {
  const key = paidAuthorityKey(a.quote)
  const fresh = { ...a, generation: 'new' }
  let state = step(saving(initialPaidAuthorityState(), a), {
    type: 'revoke',
    key,
    generation: 'new',
  }).state
  state = saving(state, fresh)
  expect(step(state, { type: 'saved', grant: a, ok: true })).toEqual({ state, effects: [] })
  expect(state.grants.size).toBe(0)
})

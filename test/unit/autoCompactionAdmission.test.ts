import { describe, expect, it, vi } from 'vitest'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import { MODEL_API_PRICES_PER_MILLION } from '../../src/shared/constants'
import type {
  AutoCompactDecision,
  AutoCompactModel,
} from '../../src/core/backends/modelapi/autoCompact'
import {
  createAutoCompactionAdmission,
  resolveAutoCompactModel,
  type AutoCompactionLedger,
  type AutoCompactionLedgerClaim,
} from '../../src/core/backends/modelapi/autoCompactionAdmission'
import { PaidUseConsent, paidUseQuestion } from '../../src/core/paid/paidConsent'
import { paidWindowOnceFeatures, paidTotalUsd, type PaidUseRequest } from '../../src/shared/paid'
import { EN } from '../../src/shared/l10n/en'
import { FakeLogOutputChannel } from './helpers/fakes'

const PRICED: AutoCompactModel = {
  pricing: {
    kind: 'priced',
    card: { input: 0.000001, cachedInput: 0.0000002, output: 0.000004, source: 'catalogue' },
  },
}
const COST: AutoCompactDecision = {
  reason: 'cost',
  newDebt: 0.012,
  saving: 0.05,
  breakEvenRequests: 3,
  writeReadRatio: 2,
}
const USAGE = {
  input_tokens: 1000,
  output_tokens: 500,
  input_tokens_details: { cached_tokens: 200 },
}
const ZERO = Usd.from(0).toAmount()

function requestFor(decision: AutoCompactDecision = COST, signal = new AbortController().signal) {
  return {
    sessionId: 'session',
    turnId: 'turn',
    modelId: 'muse-spark-1.3',
    model: PRICED,
    decision,
    signal,
  }
}
function fakeClaim(reservedUsd = Usd.from(0.012).toAmount()) {
  let isFinalized = false
  return {
    reservedUsd,
    check: vi.fn(() => {
      if (isFinalized) throw new Error('isFinalized claim')
    }),
    settle: vi.fn((_amount: UsdAmount, _hasUnknownCost: boolean) => {
      if (isFinalized) throw new Error('double settlement')
      isFinalized = true
      return Promise.resolve()
    }),
  }
}
function setup(reserve?: AutoCompactionLedger['reserveCompaction'], isOn = () => true) {
  const claims: ReturnType<typeof fakeClaim>[] = []
  const reserveCompaction = vi.fn(
    reserve ??
      ((amount: UsdAmount) => {
        const claim = fakeClaim(amount)
        claims.push(claim)
        return Promise.resolve(claim)
      }),
  )
  const allowsPaidUse = vi.fn(() => Promise.resolve(true))
  const notePaidUse = vi.fn()
  const admit = createAutoCompactionAdmission({
    accounting: { reserveCompaction },
    allowsPaidUse,
    isOn,
    dailyBudgetUsd: () => Usd.from(5).toAmount(),
    notePaidUse,
    log: new FakeLogOutputChannel(),
    storeUnavailable: 'ledger unavailable',
  })
  return { admit, claims, reserveCompaction, allowsPaidUse, notePaidUse }
}

describe('automatic compaction production admission', () => {
  it('asks first-charge consent before preparing any claim and reserves at HTTP preparation', async () => {
    const t = setup()
    const a = await t.admit(requestFor())
    expect(t.allowsPaidUse).toHaveBeenCalledWith(
      {
        feature: 'autoCompaction',
        modelId: 'muse-spark-1.3',
        dailyBudgetUsd: Usd.from(5).toAmount(),
      },
      false,
      'session',
    )
    expect(t.reserveCompaction).not.toHaveBeenCalled()
    await a?.guard.prepare?.()
    expect(t.reserveCompaction).toHaveBeenCalledTimes(1)
    expect(t.reserveCompaction.mock.calls[0]?.[0]).toBe(Usd.from(0.012).toAmount())
    await a?.close?.()
  })
  it('an off paid gate declines before consent and is rechecked at final send', async () => {
    let isEnabled = false
    const t = setup(undefined, () => isEnabled)
    expect(await t.admit(requestFor())).toBeUndefined()
    expect(t.allowsPaidUse).not.toHaveBeenCalled()
    isEnabled = true
    const a = await t.admit(requestFor())
    await a?.guard.prepare?.()
    isEnabled = false
    expect(() => a?.guard('digest')).toThrow('ledger unavailable')
    await a?.close?.()
    expect(t.claims[0]?.settle).toHaveBeenCalledWith(ZERO, false)
  })
  it('denied consent sends nothing and never reserves', async () => {
    const t = setup()
    t.allowsPaidUse.mockResolvedValue(false)
    expect(await t.admit(requestFor())).toBeUndefined()
    expect(t.reserveCompaction).not.toHaveBeenCalled()
  })
  it.each(['cost', 'overflow', 'near-window'] as const)(
    'refuses Stop/storage/cap errors for %s protection',
    async (reason) => {
      const t = setup(() => Promise.reject(new Error('stopped or unreadable')))
      const a = await t.admit(requestFor({ ...COST, reason }))
      await expect(a?.guard.prepare?.()).rejects.toThrow('stopped or unreadable')
      expect(() => a?.guard('digest')).toThrow('ledger unavailable')
      expect(t.notePaidUse).not.toHaveBeenCalled()
      await a?.close?.()
    },
  )
  it('refuses an absent claim at send', async () => {
    const t = setup(() => Promise.resolve(undefined))
    const a = await t.admit(requestFor())
    await expect(a?.guard.prepare?.()).rejects.toThrow('ledger unavailable')
  })
  it('final-send checks the live claim synchronously', async () => {
    const t = setup()
    const a = await t.admit(requestFor())
    await a?.guard.prepare?.()
    a?.guard('digest')
    expect(t.claims[0]?.check).toHaveBeenCalledTimes(1)
    await a?.close?.()
  })
  it('settles exact returned usage once and gives every retry/fallback a fresh claim', async () => {
    const t = setup()
    const a = await t.admit(requestFor())
    for (const outcome of ['rate-limited', 'returned', 'returned'] as const) {
      await a?.guard.prepare?.()
      a?.guard('digest')
      a?.guard.onRequestStarted?.()
      await a?.settle('muse-spark-1.3', outcome === 'rate-limited' ? undefined : USAGE, outcome)
    }
    await a?.close?.()
    expect(t.reserveCompaction).toHaveBeenCalledTimes(3)
    expect(t.notePaidUse).toHaveBeenCalledTimes(3)
    for (const claim of t.claims) expect(claim.settle).toHaveBeenCalledTimes(1)
    expect(t.claims[0]?.settle).toHaveBeenCalledWith(ZERO, false)
    const rates = MODEL_API_PRICES_PER_MILLION.standard
    const exact = Usd.from(rates.input)
      .times(800)
      .add(Usd.from(rates.cachedInput).times(200))
      .add(Usd.from(rates.output).times(500))
      .divide(1_000_000)
      .toAmount()
    expect(t.claims[1]?.settle).toHaveBeenCalledWith(exact, false)
  })
  it('retains uncertain sends and refunds known nonsends on close', async () => {
    const t = setup()
    const a = await t.admit(requestFor())
    await a?.guard.prepare?.()
    await a?.close?.()
    expect(t.claims[0]?.settle).toHaveBeenCalledWith(ZERO, false)
    await a?.guard.prepare?.()
    a?.guard.onRequestStarted?.()
    await a?.close?.()
    expect(t.claims[1]?.settle).toHaveBeenCalledWith(Usd.from(0.012).toAmount(), true)
  })
  it('refunds cancellation racing reservation publication', async () => {
    const stop = new AbortController()
    const claim = fakeClaim()
    const t = setup(() => {
      stop.abort()
      return Promise.resolve(claim)
    })
    const a = await t.admit(requestFor(COST, stop.signal))
    await expect(a?.guard.prepare?.()).rejects.toThrow()
    expect(claim.settle).toHaveBeenCalledWith(ZERO, false)
    await a?.close?.()
    expect(claim.settle).toHaveBeenCalledTimes(1)
  })
  it('awaits settlement and surfaces rejection before the next attempt', async () => {
    const held = Promise.withResolvers<unknown>()
    const claim = fakeClaim()
    const failing: AutoCompactionLedgerClaim = { ...claim, settle: () => held.promise }
    const t = setup(() => Promise.resolve(failing))
    const a = await t.admit(requestFor())
    await a?.guard.prepare?.()
    a?.guard.onRequestStarted?.()
    const settled = a?.settle('muse-spark-1.3', USAGE, 'returned')
    const preparing = a?.guard.prepare?.()
    expect(t.reserveCompaction).toHaveBeenCalledTimes(1)
    held.reject(new Error('disk gone'))
    await expect(settled).rejects.toThrow('ledger unavailable')
    await expect(preparing).rejects.toThrow('ledger unavailable')
    await expect(a?.close?.()).rejects.toThrow('ledger unavailable')
  })
  it('declines unpriced models and corrupt projections before consent', async () => {
    const t = setup()
    expect(
      await t.admit({ ...requestFor(), model: { pricing: { kind: 'unpriced' } } }),
    ).toBeUndefined()
    expect(await t.admit(requestFor({ ...COST, newDebt: NaN }))).toBeUndefined()
    expect(t.allowsPaidUse).not.toHaveBeenCalled()
  })
  it('uses the shared ask-once consent and revokes when disabled', async () => {
    let isEnabled = true
    const ask = vi.fn(() => Promise.resolve('once' as const))
    const consent = new PaidUseConsent({
      isOn: () => isEnabled,
      canRemember: () => true,
      readGrants: () => new Set(),
      writeGrants: () => Promise.resolve(),
      ask,
      windowOnceFeatures: paidWindowOnceFeatures(),
      log: new FakeLogOutputChannel(),
    })
    const request: PaidUseRequest = {
      feature: 'autoCompaction',
      modelId: 'muse-spark-1.3',
      dailyBudgetUsd: Usd.from(5).toAmount(),
    }
    expect(await consent.allows(request)).toBe(true)
    expect(await consent.allows(request)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    isEnabled = false
    expect(await consent.allows(request)).toBe(false)
    const question = await paidUseQuestion(request)
    expect(question.title).toContain(EN.autoCompactionName)
    expect(question.detail).toContain('$5.00')
    expect(question.detail).toContain('muse-spark-1.3')
    // Summaries already enter session token totals; the paid row never doubles their cost.
    expect(
      paidTotalUsd({
        webSearches: 0,
        images: 0,
        voiceSeconds: 0,
        scheduledRuns: 0,
        autoCompactionRequests: 1,
      }),
    ).toBe(ZERO)
  })
})

describe('automatic compaction model reader', () => {
  it('prices a Meta model at its catalogue rates', () => {
    const model = resolveAutoCompactModel('muse-spark-1.3')
    expect(model?.pricing.kind).toBe('priced')
    if (model?.pricing.kind !== 'priced') throw new Error('expected priced model')
    const rates = MODEL_API_PRICES_PER_MILLION.standard
    expect(model.pricing.card.source).toBe('catalogue')
    expect(
      Usd.from(model.pricing.card.input).compare(Usd.from(rates.input).divide(1_000_000)),
    ).toBe(0)
    expect(
      Usd.from(model.pricing.card.cachedInput ?? 0).compare(
        Usd.from(rates.cachedInput).divide(1_000_000),
      ),
    ).toBe(0)
    expect(
      Usd.from(model.pricing.card.output).compare(Usd.from(rates.output).divide(1_000_000)),
    ).toBe(0)
  })

  it('leaves BYO, local and unknown models unpriced for near-window protection only', () => {
    expect(resolveAutoCompactModel('openai/gpt-5')).toBe(undefined)
    expect(resolveAutoCompactModel('ollama/llama3')).toBe(undefined)
    expect(resolveAutoCompactModel('no-such-model')).toBe(undefined)
  })
})

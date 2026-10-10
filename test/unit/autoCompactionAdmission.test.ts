// C-M101-1: the shared D78 admission for automatic compaction. Every
// automatic attempt passes one gate and ledger: refusal (or no ledger)
// means zero dispatches, the guard rechecks at send, and each attempt
// settles exactly once. Protection (near-window/overflow) is never blocked.
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
import type { Usage } from '../../src/core/backends/modelapi/schemas'
import { FakeLogOutputChannel } from './helpers/fakes'

const PRICED: AutoCompactModel = {
  pricing: {
    kind: 'priced',
    card: { input: 0.000001, cachedInput: 0.0000002, output: 0.000004, source: 'catalogue' },
  },
}
const UNPRICED: AutoCompactModel = { pricing: { kind: 'unpriced' } }
const COST: AutoCompactDecision = {
  reason: 'cost',
  newDebt: 0.012,
  saving: 0.05,
  breakEvenRequests: 3,
  writeReadRatio: 2,
}
const OVERFLOW: AutoCompactDecision = { ...COST, reason: 'overflow' }
const NEAR_WINDOW: AutoCompactDecision = { ...COST, reason: 'near-window' }
const USAGE: Usage = {
  input_tokens: 1000,
  output_tokens: 500,
  input_tokens_details: { cached_tokens: 200 },
}
const ZERO = Usd.from(0).toAmount()

interface FakeClaim extends AutoCompactionLedgerClaim {
  readonly settled: { readonly amount: UsdAmount; readonly unknown: boolean }[]
  checks: number
}

function fakeClaim(reservedUsd: UsdAmount): FakeClaim {
  const settled: { amount: UsdAmount; unknown: boolean }[] = []
  const claim: FakeClaim = {
    reservedUsd,
    settled,
    checks: 0,
    check: () => {
      claim.checks += 1
    },
    settle: vi.fn((amount: UsdAmount, hasUnknownCost: boolean) => {
      settled.push({ amount, unknown: hasUnknownCost })
      return Promise.resolve()
    }),
  }
  return claim
}

function requestFor(model: AutoCompactModel, decision: AutoCompactDecision) {
  return {
    sessionId: 'session',
    turnId: 'turn',
    modelId: 'muse-spark-1.3',
    model,
    decision,
    signal: new AbortController().signal,
  }
}

function setup(reserve: AutoCompactionLedger['reserveCompaction']) {
  const log = new FakeLogOutputChannel()
  const admit = createAutoCompactionAdmission({
    ledger: { reserveCompaction: reserve },
    log,
    storeUnavailable: 'ledger unavailable',
  })
  return { admit, log }
}

function declinedReserve(): Promise<never> {
  throw new Error('over cap')
}

describe('automatic compaction admission', () => {
  it('admits the cost path with one reserve for the projected debt', async () => {
    const claim = fakeClaim(Usd.from(0.012).toAmount())
    const reserve = vi.fn((_amount: UsdAmount): Promise<AutoCompactionLedgerClaim> =>
      Promise.resolve(claim),
    )
    const { admit } = setup(reserve)
    const admission = await admit(requestFor(PRICED, COST))
    expect(admission).not.toBe(undefined)
    expect(reserve).toHaveBeenCalledTimes(1)
    const reserved = reserve.mock.calls[0]?.[0] ?? ZERO
    expect(Usd.from(reserved).toString()).toBe(Usd.from(0.012).toString())
  })

  it('refuses the cost path when the ledger refuses: no admission, zero dispatch', async () => {
    const { admit } = setup(declinedReserve)
    await expect(admit(requestFor(PRICED, COST))).resolves.toBe(undefined)
  })

  it('refuses the cost path when the ledger is missing', async () => {
    const { admit } = setup(() => Promise.resolve(undefined))
    await expect(admit(requestFor(PRICED, COST))).resolves.toBe(undefined)
  })

  it('refuses an aborted admission and refunds its claim', async () => {
    const claim = fakeClaim(Usd.from(0.012).toAmount())
    const aborted = new AbortController()
    const log = new FakeLogOutputChannel()
    const admit = createAutoCompactionAdmission({
      ledger: {
        reserveCompaction: () => {
          aborted.abort()
          return Promise.resolve(claim)
        },
      },
      log,
      storeUnavailable: 'ledger unavailable',
    })
    await expect(
      admit({
        sessionId: 'session',
        turnId: 'turn',
        modelId: 'muse-spark-1.3',
        model: PRICED,
        decision: COST,
        signal: aborted.signal,
      }),
    ).resolves.toBe(undefined)
    expect(claim.settled).toHaveLength(1)
    expect(Usd.from(claim.settled[0]?.amount ?? ZERO).compare(Usd.from(0))).toBe(0)
  })

  it('rechecks the claim synchronously at send: final-send', async () => {
    const claim = fakeClaim(Usd.from(0.012).toAmount())
    const { admit } = setup(() => Promise.resolve(claim))
    const admission = await admit(requestFor(PRICED, COST))
    admission?.guard('digest')
    expect(claim.checks).toBe(1)
  })

  it('settles returned usage at its exact catalogue cost', async () => {
    const claim = fakeClaim(Usd.from(0.012).toAmount())
    const { admit } = setup(() => Promise.resolve(claim))
    const admission = await admit(requestFor(PRICED, COST))
    admission?.settle('muse-spark-1.3', USAGE, 'returned')
    await vi.waitFor(() => {
      expect(claim.settled).toHaveLength(1)
    })
    const rates = MODEL_API_PRICES_PER_MILLION.standard
    const expected = Usd.from(rates.input)
      .times(800)
      .add(Usd.from(rates.cachedInput).times(200))
      .add(Usd.from(rates.output).times(500))
      .divide(1_000_000)
    expect(claim.settled[0]?.unknown).toBe(false)
    expect(Usd.from(claim.settled[0]?.amount ?? ZERO).compare(Usd.from(expected.toAmount()))).toBe(
      0,
    )
  })

  it('retains the reservation as uncertain when no usage came back', async () => {
    const claim = fakeClaim(Usd.from(0.012).toAmount())
    const { admit } = setup(() => Promise.resolve(claim))
    const admission = await admit(requestFor(PRICED, COST))
    admission?.settle('muse-spark-1.3', undefined, 'uncertain')
    await vi.waitFor(() => {
      expect(claim.settled).toHaveLength(1)
    })
    expect(claim.settled[0]?.unknown).toBe(true)
    expect(Usd.from(claim.settled[0]?.amount ?? ZERO).compare(Usd.from(claim.reservedUsd))).toBe(0)
  })

  it('refunds a rate-limited attempt as a known nonsend', async () => {
    const claim = fakeClaim(Usd.from(0.012).toAmount())
    const { admit } = setup(() => Promise.resolve(claim))
    const admission = await admit(requestFor(PRICED, COST))
    admission?.settle('muse-spark-1.3', USAGE, 'rate-limited')
    await vi.waitFor(() => {
      expect(claim.settled).toHaveLength(1)
    })
    expect(claim.settled[0]?.unknown).toBe(false)
    expect(Usd.from(claim.settled[0]?.amount ?? ZERO).compare(Usd.from(0))).toBe(0)
  })

  it('ends the turn on the ledger error after a settlement failure', async () => {
    const claim = fakeClaim(Usd.from(0.012).toAmount())
    const failing = vi.fn(() => Promise.reject(new Error('disk gone')))
    claim.settle = failing
    const { admit } = setup(() => Promise.resolve(claim))
    const admission = await admit(requestFor(PRICED, COST))
    admission?.settle('muse-spark-1.3', USAGE, 'returned')
    await vi.waitFor(() => {
      expect(failing).toHaveBeenCalledTimes(1)
    })
    // The async write fails after the sync settle returned; the next
    // synchronous guard check refuses the send instead of spending blind.
    await vi.waitFor(() => {
      expect(() => admission?.guard('digest')).toThrow('ledger unavailable')
    })
  })

  it('never blocks overflow protection when the ledger refuses', async () => {
    const reserve = vi.fn((_amount: UsdAmount): Promise<AutoCompactionLedgerClaim> =>
      Promise.reject(new Error('over cap')),
    )
    const { admit } = setup(reserve)
    const admission = await admit(requestFor(PRICED, OVERFLOW))
    expect(admission).not.toBe(undefined)
    expect(() => admission?.guard('digest')).not.toThrow()
    expect(() => admission?.settle('muse-spark-1.3', USAGE, 'returned')).not.toThrow()
    expect(reserve).toHaveBeenCalledTimes(1)
  })

  it('never blocks near-window protection on an unpriced model', async () => {
    const reserve = vi.fn((amount: UsdAmount): Promise<AutoCompactionLedgerClaim> =>
      Promise.resolve(fakeClaim(amount)),
    )
    const { admit } = setup(reserve)
    const admission = await admit(requestFor(UNPRICED, NEAR_WINDOW))
    expect(admission).not.toBe(undefined)
    const reserved = reserve.mock.calls[0]?.[0] ?? Usd.from(-1).toAmount()
    expect(Usd.from(reserved).compare(Usd.from(0))).toBe(0)
  })

  it('declines a corrupt cost projection instead of reserving blind', async () => {
    const reserve = vi.fn((_amount: UsdAmount): Promise<AutoCompactionLedgerClaim | undefined> =>
      Promise.resolve(undefined),
    )
    const { admit } = setup(reserve)
    await expect(admit(requestFor(PRICED, { ...COST, newDebt: NaN }))).resolves.toBe(undefined)
    expect(reserve).not.toHaveBeenCalled()
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

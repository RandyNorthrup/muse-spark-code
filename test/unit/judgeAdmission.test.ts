import { describe, expect, it, vi } from 'vitest'
import {
  admitJudgeCall,
  JudgeLedgerError,
  JudgeUnpricedError,
  rebindJudgeClaim,
  verifyJudgeDispatch,
  worstCaseJudgeCostUsd,
  type JudgeAdmissionBinding,
  type JudgeAdmissionClaim,
  type JudgeBilling,
  type JudgeDailyLedger,
  type JudgeLedgerClaim,
} from '../../src/core/judge/admission'

const MODEL = 'muse-spark-1.3'

interface MemoryClaim extends JudgeLedgerClaim {
  settled: number[]
}

function memoryLedger(balanceUsd: number): JudgeDailyLedger & {
  readonly claims: Map<string, MemoryClaim>
  readonly calls: string[]
  failRemaining: boolean
  failReserve: boolean
  failSettle: boolean
  remaining: number
} {
  let next = 1
  const ledger = {
    claims: new Map<string, MemoryClaim>(),
    calls: [] as string[],
    failRemaining: false,
    failReserve: false,
    failSettle: false,
    remaining: balanceUsd,
    remainingUsd(): Promise<number> {
      ledger.calls.push('remaining')
      if (ledger.failRemaining) {
        return Promise.reject(new Error('store unreadable'))
      }
      let open = 0
      for (const claim of ledger.claims.values()) {
        if (claim.settled.length === 0) {
          open += claim.reservedUsd
        }
      }
      return Promise.resolve(ledger.remaining - open)
    },
    reserve(costUsd: number): Promise<JudgeLedgerClaim> {
      ledger.calls.push('reserve')
      if (ledger.failReserve) {
        return Promise.reject(new Error('lock failure'))
      }
      const claim: MemoryClaim = {
        claimId: `claim-${String(next++)}`,
        reservedUsd: costUsd,
        settled: [],
        settle(actualCostUsd: number): Promise<void> {
          if (ledger.failSettle) {
            return Promise.reject(new Error('store unwritable'))
          }
          if (claim.settled.length > 0) {
            return claim.settled[0] === actualCostUsd
              ? Promise.resolve()
              : Promise.reject(new Error(`claim ${claim.claimId} already settled`))
          }
          claim.settled.push(actualCostUsd)
          return Promise.resolve()
        },
      }
      ledger.claims.set(claim.claimId, claim)
      return Promise.resolve(claim)
    },
  }
  return ledger
}

function binding(overrides: Partial<JudgeAdmissionBinding> = {}): JudgeAdmissionBinding {
  return {
    ownerId: 'owner-1',
    backend: 'modelApi',
    modelId: MODEL,
    engine: 'auto',
    confidential: false,
    consent: 'granted',
    ...overrides,
  }
}

function metered(ledger: JudgeDailyLedger): JudgeBilling {
  return { kind: 'metered', ledger }
}

async function admittedClaim(
  ledger: JudgeDailyLedger,
  overrides: Partial<JudgeAdmissionBinding> = {},
): Promise<JudgeAdmissionClaim> {
  const admission = await admitJudgeCall({
    binding: binding(overrides),
    billing: metered(ledger),
    estimatedInputTokens: 1000,
    maxOutputTokens: 100,
  })
  if (!admission.admitted) {
    throw new Error(`expected admission, got ${admission.refusal}`)
  }
  return admission.claim
}

describe('worstCaseJudgeCostUsd', () => {
  it('reserves the uncached worst case at list price', () => {
    // 1000 input at 1.25 and 100 output at 4.25 per million, no cache
    // discount: (1250 + 425) / 1e6.
    expect(
      worstCaseJudgeCostUsd({ modelId: MODEL, estimatedInputTokens: 1000, maxOutputTokens: 100 }),
    ).toBeCloseTo(0.001675, 12)
  })

  it('refuses an unpriced model instead of estimating', () => {
    expect(() =>
      worstCaseJudgeCostUsd({
        modelId: 'future-model-9',
        estimatedInputTokens: 10,
        maxOutputTokens: 1,
      }),
    ).toThrow(JudgeUnpricedError)
  })

  it('throws on caller-bug counts, never reserving nonsense', () => {
    expect(() =>
      worstCaseJudgeCostUsd({ modelId: MODEL, estimatedInputTokens: -1, maxOutputTokens: 1 }),
    ).toThrow(TypeError)
    expect(() =>
      worstCaseJudgeCostUsd({ modelId: MODEL, estimatedInputTokens: 1, maxOutputTokens: 0 }),
    ).toThrow(TypeError)
    expect(() =>
      worstCaseJudgeCostUsd({ modelId: MODEL, estimatedInputTokens: NaN, maxOutputTokens: 1 }),
    ).toThrow(TypeError)
  })

  it('reads an injected tariff and rejects an unusable one', () => {
    expect(
      worstCaseJudgeCostUsd({
        modelId: MODEL,
        estimatedInputTokens: 1000,
        maxOutputTokens: 100,
        priceOf: () => ({ input: 2, output: 8 }),
      }),
    ).toBeCloseTo((2000 + 800) / 1_000_000, 12)
    expect(() =>
      worstCaseJudgeCostUsd({
        modelId: MODEL,
        estimatedInputTokens: 1000,
        maxOutputTokens: 100,
        priceOf: () => ({ input: -1, output: 8 }),
      }),
    ).toThrow(JudgeLedgerError)
  })
})

describe('admitJudgeCall', () => {
  it('commits the durable reservation before the dispatch runs', async () => {
    const ledger = memoryLedger(1)
    const events: string[] = []
    const tracking = {
      ...ledger,
      async reserve(costUsd: number): Promise<JudgeLedgerClaim> {
        const claim = await ledger.reserve(costUsd)
        events.push('reserved')
        return claim
      },
    }
    const admission = await admitJudgeCall({
      binding: binding(),
      billing: metered(tracking),
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    if (!admission.admitted) {
      throw new Error(`expected admission, got ${admission.refusal}`)
    }
    // The dispatch runs after admission resolves: the funds are held first.
    events.push('dispatched')
    expect(events).toEqual(['reserved', 'dispatched'])
    expect(admission.claim.reservedUsd).toBeCloseTo(0.001675, 12)
    expect(admission.claim.billed).toBe(true)
    expect(await tracking.remainingUsd()).toBeCloseTo(1 - 0.001675, 12)
  })

  it('refuses an over-budget call and reserves nothing', async () => {
    const ledger = memoryLedger(0.0001)
    const admission = await admitJudgeCall({
      binding: binding(),
      billing: metered(ledger),
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    expect(admission).toEqual({ admitted: false, refusal: 'over-budget' })
    expect(ledger.claims.size).toBe(0)
  })

  it('refuses an unpriced call without touching the ledger', async () => {
    const ledger = memoryLedger(1)
    const remaining = vi.spyOn(ledger, 'remainingUsd')
    const reserve = vi.spyOn(ledger, 'reserve')
    const admission = await admitJudgeCall({
      binding: binding({ modelId: 'future-model-9' }),
      billing: metered(ledger),
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    expect(admission).toEqual({ admitted: false, refusal: 'unpriced' })
    expect(remaining).not.toHaveBeenCalled()
    expect(reserve).not.toHaveBeenCalled()
  })

  it('refuses without paid consent, needed and declined', async () => {
    for (const consent of ['needed', 'declined'] as const) {
      const ledger = memoryLedger(1)
      const admission = await admitJudgeCall({
        binding: binding({ consent }),
        billing: metered(ledger),
        estimatedInputTokens: 1000,
        maxOutputTokens: 100,
      })
      expect(admission).toEqual({
        admitted: false,
        refusal: consent === 'needed' ? 'consent-needed' : 'consent-declined',
      })
      expect(ledger.claims.size).toBe(0)
    }
  })

  it('refuses an invalid binding and a backend without its billing', async () => {
    const ledger = memoryLedger(1)
    const invalid: JudgeAdmissionBinding[] = [
      binding({ ownerId: '' }),
      binding({ modelId: '' }),
      binding({ engine: 'separate' }),
    ]
    for (const current of invalid) {
      const admission = await admitJudgeCall({
        binding: current,
        billing: metered(ledger),
        estimatedInputTokens: 1000,
        maxOutputTokens: 100,
      })
      expect(admission).toEqual({ admitted: false, refusal: 'binding-invalid' })
    }
    // A Model API call without a ledger claim would bill nothing; a Muse
    // Code call against the ledger would charge the subscription twice over.
    const meteredMismatch = await admitJudgeCall({
      binding: binding({ backend: 'museCode', modelId: MODEL, consent: 'not-required' }),
      billing: metered(ledger),
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    expect(meteredMismatch).toEqual({ admitted: false, refusal: 'binding-invalid' })
    const subscriptionMismatch = await admitJudgeCall({
      binding: binding(),
      billing: { kind: 'subscription' },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    expect(subscriptionMismatch).toEqual({ admitted: false, refusal: 'binding-invalid' })
    expect(ledger.claims.size).toBe(0)
  })

  it('fails closed when the ledger is unreadable, before or during reserve', async () => {
    const unreadable = memoryLedger(1)
    unreadable.failRemaining = true
    expect(
      await admitJudgeCall({
        binding: binding(),
        billing: metered(unreadable),
        estimatedInputTokens: 1000,
        maxOutputTokens: 100,
      }),
    ).toEqual({ admitted: false, refusal: 'ledger-unavailable' })
    expect(unreadable.claims.size).toBe(0)

    const unreservable = memoryLedger(1)
    unreservable.failReserve = true
    expect(
      await admitJudgeCall({
        binding: binding(),
        billing: metered(unreservable),
        estimatedInputTokens: 1000,
        maxOutputTokens: 100,
      }),
    ).toEqual({ admitted: false, refusal: 'ledger-unavailable' })
  })

  it('fails closed on a ledger that reports nonsense or echoes the wrong claim', async () => {
    const negative = memoryLedger(1)
    negative.remaining = -5
    expect(
      await admitJudgeCall({
        binding: binding(),
        billing: metered(negative),
        estimatedInputTokens: 1000,
        maxOutputTokens: 100,
      }),
    ).toEqual({ admitted: false, refusal: 'ledger-unavailable' })

    const base = memoryLedger(1)
    const echoing: JudgeDailyLedger = {
      remainingUsd: () => base.remainingUsd(),
      reserve: async (costUsd: number) => {
        const claim = await base.reserve(costUsd)
        return { ...claim, reservedUsd: costUsd + 1 }
      },
    }
    expect(
      await admitJudgeCall({
        binding: binding(),
        billing: metered(echoing),
        estimatedInputTokens: 1000,
        maxOutputTokens: 100,
      }),
    ).toEqual({ admitted: false, refusal: 'ledger-unavailable' })
  })

  it('admits a subscription call with no ledger claim', async () => {
    const admission = await admitJudgeCall({
      binding: binding({ backend: 'museCode', consent: 'not-required' }),
      billing: { kind: 'subscription' },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    if (!admission.admitted) {
      throw new Error(`expected admission, got ${admission.refusal}`)
    }
    expect(admission.claim.billed).toBe(false)
    expect(admission.claim.reservedUsd).toBeCloseTo(0.001675, 12)
    // The actual is still computed for the result's settled cost; it just
    // touches no ledger.
    const settled = await admission.claim.settleKnown({
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 0,
    })
    expect(settled).toBeCloseTo(0.001675, 12)
    expect(admission.claim.outstandingUsd()).toBeCloseTo(0.001675, 12)
  })

  it('makes a retry a new claim', async () => {
    const ledger = memoryLedger(1)
    const first = await admittedClaim(ledger)
    const second = await admittedClaim(ledger)
    expect(second.claimId).not.toBe(first.claimId)
    expect(ledger.claims.size).toBe(2)
  })
})

describe('JudgeAdmissionClaim settlement', () => {
  it('settles known usage at the actual cost with the cache discount', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    // 600 fresh input at 1.25, 400 cached at 0.15, 100 output at 4.25:
    // (750 + 60 + 425) / 1e6, under the 0.001675 reservation.
    const settled = await claim.settleKnown({
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 400,
    })
    expect(settled).toBeCloseTo(0.001235, 12)
    expect(claim.outstandingUsd()).toBeCloseTo(0.001235, 12)
    expect(ledger.claims.get(claim.claimId)?.settled).toEqual([settled])
  })

  it('refunds a known non-send to zero', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    await claim.refundNonSend()
    expect(claim.outstandingUsd()).toBe(0)
    expect(ledger.claims.get(claim.claimId)?.settled).toEqual([0])
  })

  it('keeps the full liability for an uncertain outcome', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    // A timeout: no settlement call exists, so nothing runs. The
    // reservation stays open in the ledger.
    expect(claim.outstandingUsd()).toBeCloseTo(0.001675, 12)
    expect(ledger.claims.get(claim.claimId)?.settled).toEqual([])
    expect(await ledger.remainingUsd()).toBeCloseTo(1 - 0.001675, 12)
  })

  it('settles idempotently for the same value and refuses a conflict', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    const usage = { inputTokens: 1000, outputTokens: 100, cachedTokens: 400 }
    const first = await claim.settleKnown(usage)
    await expect(claim.settleKnown(usage)).resolves.toBe(first)
    expect(ledger.claims.get(claim.claimId)?.settled).toEqual([first])
    await expect(
      claim.settleKnown({ inputTokens: 500, outputTokens: 50, cachedTokens: 0 }),
    ).rejects.toThrow(JudgeLedgerError)
    await expect(claim.refundNonSend()).rejects.toThrow(JudgeLedgerError)
  })

  it('keeps liability when the store fails at settlement', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    ledger.failSettle = true
    await expect(
      claim.settleKnown({ inputTokens: 1000, outputTokens: 100, cachedTokens: 0 }),
    ).rejects.toThrow(JudgeLedgerError)
    expect(claim.outstandingUsd()).toBeCloseTo(0.001675, 12)
  })

  it('keeps liability when the tariff vanished before settlement', async () => {
    const ledger = memoryLedger(1)
    const tariffs = new Map([[MODEL, { input: 1.25, output: 4.25 }]])
    const admission = await admitJudgeCall({
      binding: binding(),
      billing: metered(ledger),
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
      priceOf: (modelId: string) => tariffs.get(modelId),
    })
    if (!admission.admitted) {
      throw new Error('expected admission')
    }
    tariffs.delete(MODEL)
    await expect(
      admission.claim.settleKnown({ inputTokens: 1000, outputTokens: 100, cachedTokens: 0 }),
    ).rejects.toThrow(JudgeLedgerError)
    expect(admission.claim.outstandingUsd()).toBeCloseTo(0.001675, 12)
  })

  it('rejects garbage usage instead of settling it', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    await expect(
      claim.settleKnown({ inputTokens: 100, outputTokens: 10, cachedTokens: 101 }),
    ).rejects.toThrow(TypeError)
    expect(claim.outstandingUsd()).toBeCloseTo(0.001675, 12)
  })
})

describe('rebindJudgeClaim', () => {
  it('rebounds an unchanged binding', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    expect(rebindJudgeClaim(claim, binding())).toEqual({ rebound: true })
  })

  it('refuses each changed field with its reason', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    const cases: { readonly current: JudgeAdmissionBinding; readonly reason: string }[] = [
      { current: binding({ ownerId: 'owner-2' }), reason: 'owner-changed' },
      {
        current: binding({ backend: 'museCode', consent: 'not-required' }),
        reason: 'backend-changed',
      },
      { current: binding({ modelId: 'muse-spark-1.2' }), reason: 'model-changed' },
      { current: binding({ engine: 'same' }), reason: 'engine-changed' },
      { current: binding({ confidential: true }), reason: 'confidential-changed' },
      { current: binding({ consent: 'needed' }), reason: 'consent-needed' },
      { current: binding({ consent: 'declined' }), reason: 'consent-declined' },
    ]
    for (const { current, reason } of cases) {
      expect(rebindJudgeClaim(claim, current)).toEqual({ rebound: false, reason })
    }
  })
})

describe('verifyJudgeDispatch', () => {
  it('proceeds when the binding is current and the ledger answers', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    expect(await verifyJudgeDispatch(claim, binding(), ledger)).toEqual({ proceed: true })
  })

  it('refuses after a held modal revoked consent', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    expect(await verifyJudgeDispatch(claim, binding({ consent: 'declined' }), ledger)).toEqual({
      proceed: false,
      reason: 'consent-declined',
    })
    // The liability is still reserved: the revoked dispatch was not sent.
    expect(claim.outstandingUsd()).toBeCloseTo(0.001675, 12)
  })

  it('refuses when the ledger went away during the wait', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    ledger.failRemaining = true
    expect(await verifyJudgeDispatch(claim, binding(), ledger)).toEqual({
      proceed: false,
      reason: 'ledger-unavailable',
    })
  })

  it('refuses a claim that is already settled', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    await claim.refundNonSend()
    expect(await verifyJudgeDispatch(claim, binding(), ledger)).toEqual({
      proceed: false,
      reason: 'already-settled',
    })
  })

  it('proceeds for a subscription claim with no ledger to ping', async () => {
    const admission = await admitJudgeCall({
      binding: binding({ backend: 'museCode', consent: 'not-required' }),
      billing: { kind: 'subscription' },
      estimatedInputTokens: 1000,
      maxOutputTokens: 100,
    })
    if (!admission.admitted) {
      throw new Error('expected admission')
    }
    expect(await verifyJudgeDispatch(admission.claim, binding(admission.claim.binding))).toEqual({
      proceed: true,
    })
  })

  it('needs the ledger for a billed claim', async () => {
    const ledger = memoryLedger(1)
    const claim = await admittedClaim(ledger)
    expect(await verifyJudgeDispatch(claim, binding(), undefined)).toEqual({
      proceed: false,
      reason: 'ledger-unavailable',
    })
  })
})

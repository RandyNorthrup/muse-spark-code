import { reserveRequestAmount } from '../../src/core/providers/priceCard'
import { requestImageCount } from '../../src/core/backends/modelapi/modelPolicy'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { removeFolder } from './helpers/temporaryFolders'
import { describe, expect, it, vi } from 'vitest'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
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
import {
  AutoCompactionNotAuthorizedError,
  PaidUseConsent,
  paidUseQuestion,
} from '../../src/core/paid/paidConsent'
import { paidWindowOnceFeatures, paidTotalUsd, type PaidUseRequest } from '../../src/shared/paid'
import { EN } from '../../src/shared/l10n/en'
import { FakeLogOutputChannel } from './helpers/fakes'

const PRICED: AutoCompactModel = {
  pricing: {
    kind: 'priced',
    card: { input: 0.00000125, cachedInput: 0.00000015, output: 0.00000425, source: 'catalogue' },
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
const BODY: CreateResponseBody = {
  max_output_tokens: 5000,
  prompt_cache_key: 'stable',
  prompt_cache_retention: 'in_memory',
  include: ['reasoning.encrypted_content'],
  model: 'muse-spark-1.3',
  input: [],
  instructions: '',
  tools: [],
  tool_choice: 'auto',
  reasoning: { effort: 'high', summary: 'auto' },
  stream: true,
  store: false,
}
const RESERVE = Usd.from(0.0225).toAmount()

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
function isConsentCurrent(): boolean {
  return true
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
function setup(
  reserve?: AutoCompactionLedger['reserveCompaction'],
  isOn = () => true,
  loadPricing: NonNullable<
    Parameters<typeof createAutoCompactionAdmission>[0]['loadPricing']
  > | null = () => Promise.resolve({ reserveRequestAmount, requestImageCount }),
) {
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
    ...(loadPricing !== null && { loadPricing }),
    accounting: { reserveCompaction },
    allowsPaidUse,
    isOn,
    isTrusted: () => true,
    isEvaluated: () => true,
    paidUseFence: () => isConsentCurrent,
    dailyBudgetUsd: () => Usd.from(5).toAmount(),
    notePaidUse,
    log: new FakeLogOutputChannel(),
    storeUnavailable: 'ledger unavailable',
  })
  return { admit, claims, reserveCompaction, allowsPaidUse, notePaidUse }
}

async function rejection(work: Promise<unknown> | undefined): Promise<unknown> {
  try {
    await work
    return undefined
  } catch (error: unknown) {
    return error
  }
}
function thrown(run: () => void): unknown {
  try {
    run()
    return undefined
  } catch (error: unknown) {
    return error
  }
}

/**
 * One session's overlapping automatic compactions against shared ports: a
 * ledger whose cap fits one open reservation, ask-once consent and a
 * revocable session fence. `reused` keeps one admission for the session;
 * `per-request` builds one for every request, as the production entry does.
 * Returns every port call and what the caller saw.
 */
async function crossRequestRun(mode: 'reused' | 'per-request') {
  const trace: string[] = []
  const outcomes: string[] = []
  const cap = Usd.from(0.03)
  let open = Usd.from(0)
  let spent = Usd.from(0)
  const reserveCompaction: AutoCompactionLedger['reserveCompaction'] = (amount) => {
    if (spent.add(open).add(Usd.from(amount)).compare(cap) > 0) {
      trace.push(`refuse ${amount}`)
      return Promise.reject(new Error('over the daily cap'))
    }
    open = open.add(Usd.from(amount))
    trace.push(`reserve ${amount}`)
    let isSettled = false
    return Promise.resolve({
      reservedUsd: amount,
      check: () => {
        trace.push(`check ${amount}`)
      },
      settle: (actual: UsdAmount, hasUnknownCost: boolean) => {
        if (isSettled) throw new Error('double settlement')
        isSettled = true
        open = open.subtract(Usd.from(amount))
        spent = spent.add(Usd.from(actual))
        trace.push(`settle ${actual} ${String(hasUnknownCost)} spent ${spent.toAmount()}`)
        return Promise.resolve()
      },
    })
  }
  const consented = new Set<string>()
  let fence = 0
  const deps: Parameters<typeof createAutoCompactionAdmission>[0] = {
    loadPricing: () => Promise.resolve({ reserveRequestAmount, requestImageCount }),
    accounting: { reserveCompaction },
    allowsPaidUse: (_request, _requiresAsking, sessionId) => {
      trace.push(`${consented.has(sessionId) ? 'remembered' : 'ask'} ${sessionId}`)
      consented.add(sessionId)
      return Promise.resolve(true)
    },
    isOn: () => true,
    isTrusted: () => true,
    isEvaluated: () => true,
    paidUseFence: () => {
      const captured = fence
      return () => fence === captured
    },
    dailyBudgetUsd: () => Usd.from(5).toAmount(),
    notePaidUse: (feature, units) => {
      trace.push(`note ${feature} ${String(units)}`)
    },
    log: new FakeLogOutputChannel(),
    storeUnavailable: 'ledger unavailable',
  }
  const shared = createAutoCompactionAdmission(deps)
  const admit = (turnId: string) =>
    (mode === 'reused' ? shared : createAutoCompactionAdmission(deps))({ ...requestFor(), turnId })

  // The first request reserves and stays in flight.
  const first = await admit('turn-1')
  await first?.guard.prepareRequest?.(BODY, 1000)
  outcomes.push('first reserved')
  // A second request of the same session meets the first one's open claim.
  const second = await admit('turn-2')
  outcomes.push(
    (await rejection(second?.guard.prepareRequest?.(BODY, 1000))) === undefined
      ? 'second reserved beside the first claim'
      : 'second refused while the first claim is open',
  )
  // The first is sent and settles: its cost joins the day's tally.
  first?.guard('digest')
  first?.guard.onRequestStarted?.()
  await first?.settle('muse-spark-1.3', USAGE, 'returned')
  await first?.close?.()
  await second?.close?.()
  const third = await admit('turn-3')
  await third?.guard.prepareRequest?.(BODY, 1000)
  outcomes.push('third reserved after the first settled')
  // Revocation reaches every admitted use, whichever admission made it.
  const fourth = await admit('turn-4')
  fence += 1
  const refusals = [
    thrown(() => {
      third?.guard('digest')
    }),
    await rejection(fourth?.guard.prepareRequest?.(BODY, 1000)),
  ]
  outcomes.push(
    refusals.every((error) => error instanceof AutoCompactionNotAuthorizedError)
      ? 'revocation stops both admitted uses'
      : 'revocation missed an admitted use',
  )
  await third?.close?.()
  await fourth?.close?.()
  return { trace, outcomes }
}

describe('automatic compaction production admission', () => {
  it('refuses a missing pricing dependency before consent or reservation', async () => {
    const t = setup(undefined, () => true, null)
    expect(await t.admit(requestFor())).toBe(undefined)
    expect(t.allowsPaidUse).not.toHaveBeenCalled()
    expect(t.reserveCompaction).not.toHaveBeenCalled()
    expect(t.notePaidUse).not.toHaveBeenCalled()
  })

  it.each(['absent', 'failed'] as const)(
    'refuses %s lazy pricing before reserving or dispatching',
    async (outcome) => {
      const t = setup(
        undefined,
        () => true,
        () =>
          outcome === 'absent'
            ? Promise.resolve(undefined)
            : Promise.reject(new Error('pricing chunk unavailable')),
      )
      const a = await t.admit(requestFor())
      await expect(a?.guard.prepareRequest?.(BODY, 1000)).rejects.toThrow()
      expect(t.reserveCompaction).not.toHaveBeenCalled()
      expect(t.notePaidUse).not.toHaveBeenCalled()
      expect(() => a?.guard('digest')).toThrow('ledger unavailable')
      await a?.close?.()
    },
  )

  it.each(['switch', 'stop'] as const)(
    'rechecks %s after the lazy pricing wait before reservation',
    async (withdrawn) => {
      let isOn = true
      const controller = new AbortController()
      const loaded = Promise.withResolvers<{
        readonly reserveRequestAmount: typeof reserveRequestAmount
        readonly requestImageCount: typeof requestImageCount
      }>()
      const loadPricing = vi.fn(() => loaded.promise)
      const t = setup(undefined, () => isOn, loadPricing)
      const a = await t.admit(requestFor(COST, controller.signal))
      const preparing = a?.guard.prepareRequest?.(BODY, 1000)
      await vi.waitFor(() => {
        expect(loadPricing).toHaveBeenCalledExactlyOnceWith()
      })
      if (withdrawn === 'switch') isOn = false
      else controller.abort()
      loaded.resolve({ reserveRequestAmount, requestImageCount })
      await expect(preparing).rejects.toThrow()
      expect(t.reserveCompaction).not.toHaveBeenCalled()
      expect(t.notePaidUse).not.toHaveBeenCalled()
      await a?.close?.()
    },
  )

  it('a short previous summary cannot overspend the real hard daily journal', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm101-hard-bound-'))
    try {
      const daily = createPaidDailyBudget({
        directory,
        now: () => new Date(2026, 9, 10, 12).getTime(),
        capUsd: () => Usd.from(1).toAmount(),
        sleep: () => Promise.resolve(),
        isModelApi: () => true,
      })
      const earlier = await daily.reserveExact(Usd.from(0.985).toAmount())
      await earlier.settle(Usd.from(0.985).toAmount())
      const t = setup(async (amount) => {
        const claim = await daily.reserveExact(amount)
        return {
          ...claim,
          check: () => {
            claim.check()
          },
        }
      })
      const a = await t.admit(requestFor({ ...COST, newDebt: 0.01027 }))
      await expect(a?.guard.prepareRequest?.(BODY, 1000)).rejects.toThrow()
      expect(t.notePaidUse).not.toHaveBeenCalled()
      await a?.close?.()
      const day = await daily.latestDay()
      expect(day.spentUsd).toBe(Usd.from(0.985).toAmount())
    } finally {
      await removeFolder(directory)
    }
  })

  it('reserves the actual input and full output allowance independently of economic debt', async () => {
    const t = setup()
    const a = await t.admit(requestFor({ ...COST, newDebt: 0.000001 }))
    await a?.guard.prepareRequest?.(BODY, 1000)
    expect(t.claims[0]?.reservedUsd).toBe(RESERVE)
    a?.guard('digest')
    a?.guard.onRequestStarted?.()
    await a?.settle(BODY.model, { input_tokens: 1000, output_tokens: 5000 }, 'returned')
    expect(t.claims[0]?.settle).toHaveBeenCalledWith(RESERVE, false)
    await a?.guard.prepareRequest?.({ ...BODY, max_output_tokens: 100 }, 2000)
    expect(t.claims[1]?.reservedUsd).toBe(Usd.from(0.002925).toAmount())
    await a?.close?.()
  })

  it.each(['consent', 'switch', 'trust', 'evaluation'] as const)(
    'one authority checks %s before preparation, after reserve, at final send and before retry',
    async (withdrawn) => {
      const live = { consent: true, switch: true, trust: true, evaluation: true }
      const isLiveConsent = (): boolean => live.consent
      const reserveCompaction = vi.fn((amount: UsdAmount) => Promise.resolve(fakeClaim(amount)))
      const allowsPaidUse = vi.fn(() => Promise.resolve(true))
      const admit = createAutoCompactionAdmission({
        loadPricing: () => Promise.resolve({ reserveRequestAmount, requestImageCount }),
        accounting: { reserveCompaction },
        allowsPaidUse,
        isOn: () => live.switch,
        isTrusted: () => live.trust,
        isEvaluated: () => live.evaluation,
        paidUseFence: () => isLiveConsent,
        dailyBudgetUsd: () => Usd.from(1).toAmount(),
        notePaidUse: vi.fn(),
        log: new FakeLogOutputChannel(),
        storeUnavailable: 'ledger unavailable',
      })
      const a = await admit(requestFor())
      live[withdrawn] = false
      await expect(a?.guard.prepareRequest?.(BODY, 1000)).rejects.toThrow(
        AutoCompactionNotAuthorizedError,
      )
      expect(reserveCompaction).not.toHaveBeenCalled()
      live[withdrawn] = true
      await a?.guard.prepareRequest?.(BODY, 1000)
      live[withdrawn] = false
      expect(() => a?.guard('digest')).toThrow(AutoCompactionNotAuthorizedError)
      await expect(a?.guard.prepareRequest?.(BODY, 1000)).rejects.toThrow(
        AutoCompactionNotAuthorizedError,
      )
      expect(reserveCompaction).toHaveBeenCalledTimes(1)
      live[withdrawn] = true
      const held = Promise.withResolvers<ReturnType<typeof fakeClaim>>()
      reserveCompaction.mockImplementationOnce(() => held.promise)
      const preparing = a?.guard.prepareRequest?.(BODY, 1000)
      await vi.waitFor(() => {
        expect(reserveCompaction).toHaveBeenCalledTimes(2)
      })
      live[withdrawn] = false
      const claim = fakeClaim(RESERVE)
      held.resolve(claim)
      await expect(preparing).rejects.toThrow(AutoCompactionNotAuthorizedError)
      expect(claim.settle).toHaveBeenCalledWith(ZERO, false)
      await a?.close?.()
    },
  )

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
    await a?.guard.prepareRequest?.(BODY, 1000)
    expect(t.reserveCompaction).toHaveBeenCalledTimes(1)
    expect(t.reserveCompaction.mock.calls[0]?.[0]).toBe(RESERVE)
    await a?.close?.()
  })
  it('an off paid gate declines before consent and is rechecked at final send', async () => {
    let isEnabled = false
    const t = setup(undefined, () => isEnabled)
    expect(await t.admit(requestFor())).toBeUndefined()
    expect(t.allowsPaidUse).not.toHaveBeenCalled()
    isEnabled = true
    const a = await t.admit(requestFor())
    await a?.guard.prepareRequest?.(BODY, 1000)
    isEnabled = false
    expect(() => a?.guard('digest')).toThrow(AutoCompactionNotAuthorizedError)
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
      await expect(a?.guard.prepareRequest?.(BODY, 1000)).rejects.toThrow('stopped or unreadable')
      expect(() => a?.guard('digest')).toThrow('ledger unavailable')
      expect(t.notePaidUse).not.toHaveBeenCalled()
      await a?.close?.()
    },
  )
  it('refuses an absent claim at send', async () => {
    const t = setup(() => Promise.resolve(undefined))
    const a = await t.admit(requestFor())
    await expect(a?.guard.prepareRequest?.(BODY, 1000)).rejects.toThrow('ledger unavailable')
  })
  it('final-send checks the live claim synchronously', async () => {
    const t = setup()
    const a = await t.admit(requestFor())
    await a?.guard.prepareRequest?.(BODY, 1000)
    a?.guard('digest')
    expect(t.claims[0]?.check).toHaveBeenCalledTimes(1)
    await a?.close?.()
  })
  it('settles exact returned usage once and gives every retry/fallback a fresh claim', async () => {
    const t = setup()
    const a = await t.admit(requestFor())
    for (const outcome of ['rate-limited', 'returned', 'returned'] as const) {
      await a?.guard.prepareRequest?.(BODY, 1000)
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
    await a?.guard.prepareRequest?.(BODY, 1000)
    await a?.close?.()
    expect(t.claims[0]?.settle).toHaveBeenCalledWith(ZERO, false)
    await a?.guard.prepareRequest?.(BODY, 1000)
    a?.guard.onRequestStarted?.()
    await a?.close?.()
    expect(t.claims[1]?.settle).toHaveBeenCalledWith(RESERVE, true)
  })
  it('refunds cancellation racing reservation publication', async () => {
    const stop = new AbortController()
    const claim = fakeClaim()
    const t = setup(() => {
      stop.abort()
      return Promise.resolve(claim)
    })
    const a = await t.admit(requestFor(COST, stop.signal))
    await expect(a?.guard.prepareRequest?.(BODY, 1000)).rejects.toThrow()
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
    await a?.guard.prepareRequest?.(BODY, 1000)
    a?.guard.onRequestStarted?.()
    const settled = a?.settle('muse-spark-1.3', USAGE, 'returned')
    const preparing = a?.guard.prepareRequest?.(BODY, 1000)
    expect(t.reserveCompaction).toHaveBeenCalledTimes(1)
    held.reject(new Error('disk gone'))
    await expect(settled).rejects.toThrow('ledger unavailable')
    await expect(preparing).rejects.toThrow('ledger unavailable')
    await expect(a?.close?.()).rejects.toThrow('ledger unavailable')
  })
  it('declines unpriced models before consent and refuses unpriced request parts', async () => {
    const t = setup()
    expect(
      await t.admit({ ...requestFor(), model: { pricing: { kind: 'unpriced' } } }),
    ).toBeUndefined()
    const a = await t.admit(requestFor({ ...COST, newDebt: NaN }))
    expect(a).toBeDefined() // Economic debt never prices the HTTP allowance.
    await expect(a?.guard.prepareRequest?.(BODY, NaN)).rejects.toThrow('ledger unavailable')
    expect(t.reserveCompaction).not.toHaveBeenCalled()
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

  // The production entry (modelApiEntry.ts) builds this admission anew for
  // every request, so the factory can load behind the backend. That is sound
  // only while the factory keeps nothing between requests: in-flight claims
  // and the day's tally live in the ledger, consent and its fence in the
  // paid-use ports. One scripted session, both constructions: the ports must
  // see the same calls and the caller the same answers.
  it('keeps nothing between requests: one admission and one per request are indistinguishable', async () => {
    const reused = await crossRequestRun('reused')
    const perRequest = await crossRequestRun('per-request')
    expect(perRequest).toEqual(reused)
    expect(perRequest.outcomes).toEqual([
      'first reserved',
      'second refused while the first claim is open',
      'third reserved after the first settled',
      'revocation stops both admitted uses',
    ])
    // Asked once for the session; the three later requests found it remembered.
    expect(perRequest.trace.filter((line) => line.startsWith('ask '))).toEqual(['ask session'])
    expect(perRequest.trace.filter((line) => line.startsWith('remembered '))).toHaveLength(3)
    expect(perRequest.trace.filter((line) => line.startsWith('reserve '))).toHaveLength(2)
    expect(perRequest.trace.filter((line) => line.startsWith('refuse '))).toHaveLength(1)
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

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Usd } from '../../src/shared/usd'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  estimateInput,
  helperRequestSettlement,
  requestParts,
  reserveRequest,
  SessionBudgetExceededError,
  withAccountBudgetAdmission,
  type SessionBudgetClaim,
} from '../../src/core/backends/modelapi/sessionBudget'
import { createSessionBudgetJournal } from '../../src/host/backend/sessionBudgetJournal'
import { removeFolder } from './helpers/temporaryFolders'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { formatUsd } from '../../src/core/usage/insights'
import { MODEL_API_MAX_OUTPUT_TOKENS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText } from '../../src/shared/l10n/text'

const MODEL = 'muse-spark-1.3'
const CONTRIBUTOR = 'muse-spark-1.3-contributor'

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('requestParts', () => {
  it('is the instructions, the tools and each input item, as JSON', () => {
    const item = { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }
    const body = {
      instructions: 'Be brief.',
      tools: [],
      input: [item],
    } as unknown as Pick<CreateResponseBody, 'instructions' | 'tools' | 'input'>
    expect(requestParts(body)).toEqual(['"Be brief."', '[]', JSON.stringify(item)])
  })
})

describe('estimateInput', () => {
  it('refuses fractional, negative and overflowing input token counts', () => {
    for (const inputTokens of [0.5, -1, Number.MAX_SAFE_INTEGER, Infinity])
      expect(() => estimateInput(['x'], { inputTokens, parts: new Map() })).toThrow(
        UI_TEXT.sessionBudgetStoreUnavailable,
      )
  })
  it('counts every UTF-8 byte of every part as a token when there is no base', () => {
    expect(estimateInput(['ab', 'cd'], undefined).inputTokens).toBe(4)
    // é is two bytes, each CJK character three: bytes, not characters.
    expect(estimateInput(['é', '日本'], undefined).inputTokens).toBe(8)
  })

  it('adds to the reported tokens only the parts the base did not carry', () => {
    const base = { inputTokens: 100, parts: estimateInput(['a', 'bb'], undefined).parts }
    expect(estimateInput(['a', 'bb', 'ccc'], base).inputTokens).toBe(103)
    // A changed part counts whole; a repeated one counts again.
    expect(estimateInput(['a', 'bx'], base).inputTokens).toBe(102)
    expect(estimateInput(['a', 'a', 'bb'], base).inputTokens).toBe(101)
  })

  it('never subtracts a part the base carried and this request does not', () => {
    const base = { inputTokens: 100, parts: estimateInput(['a', 'bb'], undefined).parts }
    expect(estimateInput(['a'], base).inputTokens).toBe(100)
    expect(estimateInput([], base).inputTokens).toBe(100)
  })

  it('returns its own parts, to become the next base', () => {
    const first = estimateInput(['x', 'y'], undefined)
    const next = estimateInput(['x', 'y', 'z'], { inputTokens: 7, parts: first.parts })
    expect(next.inputTokens).toBe(8)
    expect(next.parts.size).toBe(3)
  })
})

describe('calibrated media budget parts', () => {
  it('uses the upper bound independently of encoded size and a 170-token count base', () => {
    const media = { mediaIdentity: 'uploaded-clip', upperBoundInputTokens: 5502 }
    expect(estimateInput(['hi', media], undefined).inputTokens).toBe(5504)
    const parts = estimateInput(['hi', media], undefined).parts
    expect(estimateInput(['hi', media], { inputTokens: 170, parts }).inputTokens).toBe(5672)
    expect(estimateInput([media], { inputTokens: 2751, parts }).inputTokens).toBe(8253)
  })

  it('keeps a media identity from hiding a newly added text part with the same text', () => {
    const media = { mediaIdentity: 'same', upperBoundInputTokens: 5502 }
    const parts = estimateInput([media], undefined).parts
    expect(estimateInput(['same'], { inputTokens: 170, parts }).inputTokens).toBe(174)
  })

  it('rejects an unsafe calibrated token allowance', () => {
    for (const upperBoundInputTokens of [-1, 0.1, NaN, Infinity]) {
      expect(() =>
        estimateInput([{ mediaIdentity: 'clip', upperBoundInputTokens }], undefined),
      ).toThrow()
    }
  })
})

const request = (capUsd: number, spentUsd: number, modelId = MODEL) => ({
  capUsd: Usd.from(capUsd).toAmount(),
  spentUsd: Usd.from(spentUsd).toAmount(),
  modelId,
})

const refuseAtCap = () => reserveRequest(request(1, 1))

async function withJournal(
  run: (journal: ReturnType<typeof createSessionBudgetJournal>) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'muse-f3-journal-'))
  try {
    await run(
      createSessionBudgetJournal({
        directory,
        sleep: () => Promise.resolve(),
        initialBudget: () =>
          Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
      }),
    )
  } finally {
    await removeFolder(directory)
  }
}

describe('reserveRequest', () => {
  // Lane LIMITSFIX, F3 (D113): ONE admission rule. A request is sent while the
  // real spend already settled is below the cap; nothing of the response is
  // estimated or held. These tests pin that contract on purpose: the earlier
  // ones asserted an input estimate compared with what was left.
  it('sends a request while real spend is below the cap, whatever its input would cost', () => {
    // The 2026-10-14 incident: $2.03 spent of a $5 cap and a request whose
    // worst case was about $3.03 was refused. Real spend is under the cap.
    expect(reserveRequest(request(5, 2.03)).maxOutputTokens).toBe(MODEL_API_MAX_OUTPUT_TOKENS)
    // A $0.001 cap at $0 spent used to refuse 1,000 input tokens (estimated
    // $0.00125). Nothing is estimated now, so the first request goes.
    expect(reserveRequest(request(0.001, 0)).maxOutputTokens).toBe(MODEL_API_MAX_OUTPUT_TOKENS)
    // One cent below the cap is still below it.
    expect(reserveRequest(request(1, 0.99)).costUsd).toBe(Usd.from(0).toAmount())
  })

  it('holds nothing for the response: no input estimate, no output worst case', () => {
    for (const modelId of [MODEL, CONTRIBUTOR]) {
      expect(reserveRequest(request(100, 0, modelId)).costUsd).toBe(Usd.from(0).toAmount())
    }
  })

  it('stops once real spend has reached the cap, naming spent, cap and how to raise it', () => {
    expect(refuseAtCap).toThrow(SessionBudgetExceededError)
    expect(refuseAtCap).toThrow(
      fill(UI_TEXT.sessionBudgetStopped, { spent: formatUsd(1), cap: formatUsd(1) }),
    )
    expect(refuseAtCap).toThrow('museSpark.modelApiSessionBudgetUsd')
    expect(() => reserveRequest(request(1, 1.5))).toThrow(SessionBudgetExceededError)
  })

  it('never says the cap was reached while real spend is below it', () => {
    for (const [cap, spent] of [
      [0.001, 0],
      [0.01, 0.0099999],
      [5, 2.03],
      [100, 99.99],
    ] as const) {
      expect(() => reserveRequest(request(cap, spent))).not.toThrow()
    }
  })

  it('holds only the exact hosted-search fee ceiling, from its own bound and approved tariff', () => {
    const reservation = reserveRequest({
      ...request(5, 0),
      maxToolCalls: 5,
      searchPriceUsd: Usd.from(0.0025).toAmount(),
    })
    expect(reservation.costUsd).toBe(Usd.from('0.0125').toAmount())
    expect(reservation.maxOutputTokens).toBe(MODEL_API_MAX_OUTPUT_TOKENS)
  })

  it.each([0, -1, 21, 1.5, NaN, Infinity])(
    'refuses an invalid hosted-call bound of %s',
    (maxToolCalls) => {
      expect(() =>
        reserveRequest({
          ...request(1, 0),
          maxToolCalls,
          searchPriceUsd: Usd.from(0.0025).toAmount(),
        }),
      ).toThrow(SessionBudgetExceededError)
    },
  )

  it.each([undefined, -1, NaN, Infinity])(
    'refuses an unverified or invalid search price of %s',
    (searchPriceUsd) => {
      expect(() =>
        reserveRequest({
          ...request(1, 0),
          maxToolCalls: 5,
          searchPriceUsd:
            searchPriceUsd === undefined || !Number.isFinite(searchPriceUsd)
              ? undefined
              : Usd.from(searchPriceUsd).toAmount(),
        }),
      ).toThrow(SessionBudgetExceededError)
    },
  )

  it('keeps the caller’s own output allowance, large or small, and refuses an invalid one', () => {
    for (const maxOutputTokens of [1, 4096, 131_072]) {
      expect(reserveRequest({ ...request(1, 0), maxOutputTokens }).maxOutputTokens).toBe(
        maxOutputTokens,
      )
    }
    for (const maxOutputTokens of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => reserveRequest({ ...request(1, 0), maxOutputTokens })).toThrow(
        'invalid output.maxTokens',
      )
    }
  })

  it('refuses a model whose price it does not know: its spend could not be settled', () => {
    const unknown = request(100, 0, 'muse-x')
    expect(() => reserveRequest(unknown)).toThrow(SessionBudgetExceededError)
    expect(() => reserveRequest(unknown)).toThrow(
      fill(UI_TEXT.sessionBudgetUnpriced, { model: 'muse-x' }),
    )
  })

  it('validates the provider minimum but never lets it gate sending', () => {
    expect(reserveRequest({ ...request(1, 0), minOutputTokens: 16 }).maxOutputTokens).toBe(
      MODEL_API_MAX_OUTPUT_TOKENS,
    )
    for (const minOutputTokens of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => reserveRequest({ ...request(1, 0), minOutputTokens })).toThrow(
        'invalid output.minTokens',
      )
    }
  })
})

describe('the journal admits by settled real spend, not by its own hold', () => {
  const owner = 'b'.repeat(64)

  it('admits a request whose old worst-case hold would have passed the cap', async () => {
    await withJournal(async (journal) => {
      await journal.record('conversation', owner, Usd.from(2.03).toAmount())
      // The incident's request: a held worst case of about $3.03 against $5.
      const claim = await journal.reserve('conversation', owner, Usd.from(3.03).toAmount())
      expect(Number(claim.check(Usd.from(5).toAmount()).spentUsd)).toBeCloseTo(5.06)
      await claim.settle(Usd.from(0.01).toAmount())
    })
  })

  it('stops the next request once settled real spend has reached the cap, naming it', async () => {
    await withJournal(async (journal) => {
      await journal.record('conversation', owner, Usd.from(5).toAmount())
      const next = await journal.reserve('conversation', owner, Usd.from(0).toAmount())
      expect(() => next.check(Usd.from(5).toAmount())).toThrow(
        fill(UI_TEXT.sessionBudgetStopped, { spent: formatUsd(5), cap: formatUsd(5) }),
      )
      await next.settle(Usd.from(0).toAmount())
    })
  })

  it('records a response lost before its usage as unknown, and the next capped request says so', async () => {
    await withJournal(async (journal) => {
      const lost = await journal.reserve('conversation', owner, Usd.from(0).toAmount())
      await lost.settle(Usd.from(0).toAmount(), true)
      const next = await journal.reserve('conversation', owner, Usd.from(0).toAmount())
      expect(() => next.check(Usd.from(5).toAmount())).toThrow(
        UI_TEXT.sessionBudgetLegacyFeesUnknown,
      )
      await next.settle(Usd.from(0).toAmount())
    })
  })
})

it('settles helper token costs exactly and retains unknown sent liability', () => {
  const usage = { input_tokens: 7, output_tokens: 3, total_tokens: 10 }
  expect(
    helperRequestSettlement(CONTRIBUTOR, usage, () => true, true, false, Usd.from(1).toAmount()),
  ).toEqual({
    costUsd: Usd.from('0.0000013').toAmount(),
    isUnknown: false,
  })
  expect(
    helperRequestSettlement(
      CONTRIBUTOR,
      undefined,
      () => false,
      true,
      false,
      Usd.from(0.1).toAmount(),
    ),
  ).toEqual({
    costUsd: Usd.from(0.1).toAmount(),
    isUnknown: true,
  })
  expect(
    helperRequestSettlement(
      CONTRIBUTOR,
      undefined,
      () => false,
      false,
      false,
      Usd.from(0.1).toAmount(),
    ),
  ).toEqual({
    costUsd: Usd.from(0).toAmount(),
    isUnknown: false,
  })
  expect(() =>
    helperRequestSettlement('unpriced', usage, () => true, true, false, Usd.from(1).toAmount()),
  ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
})

describe('M108 T account budget admission', () => {
  it('keeps an unbound claim identical and binds a guard once for initial and every final check', async () => {
    const total = { spentUsd: Usd.from(0.5).toAmount(), hasUnknownHistoricalFees: false }
    const claim: SessionBudgetClaim = {
      claimId: 'owned-claim',
      reservedUsd: Usd.from(0.1).toAmount(),
      check: vi.fn(() => total),
      settle: vi.fn(() => Promise.resolve(total)),
    }
    expect(withAccountBudgetAdmission(claim, undefined)).toBe(claim)
    const guard = vi.fn<() => void>()
    const bind = vi.fn(() => guard)
    const admitted = withAccountBudgetAdmission(claim, bind)
    expect(bind).toHaveBeenCalledExactlyOnceWith(claim)
    expect(guard).toHaveBeenCalledOnce()
    expect(admitted.check(Usd.from(1).toAmount())).toBe(total)
    expect(admitted.check(Usd.from(2).toAmount())).toBe(total)
    expect(guard).toHaveBeenCalledTimes(3)
    expect(claim.check).toHaveBeenNthCalledWith(1, Usd.from(1).toAmount())
    expect(claim.check).toHaveBeenNthCalledWith(2, Usd.from(2).toAmount())
    expect(admitted.claimId).toBe(claim.claimId)
    expect(admitted.reservedUsd).toBe(claim.reservedUsd)
    await expect(admitted.settle(Usd.from(0.1).toAmount(), true)).resolves.toBe(total)
    expect(claim.settle).toHaveBeenCalledExactlyOnceWith(Usd.from(0.1).toAmount(), true)
    const stop = new Error('Account threshold reached')
    guard.mockImplementation(() => {
      throw stop
    })
    expect(() => admitted.check(Usd.from(1).toAmount())).toThrow(stop)
    expect(claim.check).toHaveBeenCalledTimes(2)
    expect(() => withAccountBudgetAdmission(claim, bind)).toThrow(stop)
  })

  it('does not let an account swap reset M82 settled spend or outstanding liability', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-account-session-'))
    try {
      const journal = createSessionBudgetJournal({
        directory,
        sleep: () => Promise.resolve(),
        initialBudget: () =>
          Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
      })
      const owner = 'a'.repeat(64)
      await journal.record('conversation', owner, Usd.from(0.8).toAmount())
      const open = await journal.reserve('conversation', owner, Usd.from(0.1).toAmount())
      const check = vi.fn<() => void>()
      withAccountBudgetAdmission(open, () => check).check(Usd.from(1).toAmount())
      const afterSwap = await journal.reserve('conversation', owner, Usd.from(0.1).toAmount())
      const swapped = withAccountBudgetAdmission(afterSwap, () => check)
      expect(Number(swapped.check(Usd.from(1).toAmount()).spentUsd)).toBeCloseTo(1)
      await swapped.settle(Usd.from(0.1).toAmount())
      const rejected = await journal.reserve('conversation', owner, Usd.from(0.01).toAmount())
      expect(() =>
        withAccountBudgetAdmission(rejected, () => check).check(Usd.from(1).toAmount()),
      ).toThrow(fill(UI_TEXT.sessionBudgetStopped, { cap: formatUsd(1), spent: formatUsd(1) }))
      await rejected.settle(Usd.from(0).toAmount())
      const total = await journal.read('conversation', owner)
      expect(Number(total.spentUsd)).toBeCloseTo(1)
      // The old account's unresolved request remains owed after the swap.
      expect(open.reservedUsd).toBe(Usd.from(0.1).toAmount())
    } finally {
      await removeFolder(directory)
    }
  })
})

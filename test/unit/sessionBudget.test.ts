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
// Standard output: $4.25 per million tokens.
const STANDARD_OUTPUT_TOKEN_USD = 4.25 / 1_000_000
const FLOAT_SLACK = 1e-12

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

describe('reserveRequest', () => {
  it('admits one output token when search and input consume the exact remaining allowance', () => {
    const reservation = reserveRequest({
      capUsd: Usd.from(0.0025055).toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      estimatedInputTokens: 1,
      modelId: MODEL,
      maxToolCalls: 1,
      searchPriceUsd: Usd.from(0.0025).toAmount(),
    })
    expect(reservation.maxOutputTokens).toBe(1)
    expect(reservation.costUsd).toBe(Usd.from('0.0025055').toAmount())
  })
  it('holds the search bound times its price before allocating output tokens', () => {
    const reservation = reserveRequest({
      capUsd: Usd.from(0.14).toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      estimatedInputTokens: 100_000,
      modelId: MODEL,
      maxToolCalls: 5,
      searchPriceUsd: Usd.from(0.0025).toAmount(),
    })
    expect(reservation.maxOutputTokens).toBe(588)
    expect(Number(reservation.costUsd)).toBeCloseTo(
      0.125 + 588 * STANDARD_OUTPUT_TOKEN_USD + 0.0125,
      12,
    )
    expect(Number(reservation.costUsd)).toBeLessThanOrEqual(0.14 + FLOAT_SLACK)
  })

  it.each([0, -1, 21, 1.5, NaN, Infinity])(
    'refuses an invalid hosted-call bound of %s',
    (maxToolCalls) => {
      expect(() =>
        reserveRequest({
          capUsd: Usd.from(1).toAmount(),
          spentUsd: Usd.from(0).toAmount(),
          estimatedInputTokens: 0,
          modelId: MODEL,
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
          capUsd: Usd.from(1).toAmount(),
          spentUsd: Usd.from(0).toAmount(),
          estimatedInputTokens: 0,
          modelId: MODEL,
          maxToolCalls: 5,
          searchPriceUsd:
            searchPriceUsd === undefined || !Number.isFinite(searchPriceUsd)
              ? undefined
              : Usd.from(searchPriceUsd).toAmount(),
        }),
      ).toThrow(SessionBudgetExceededError)
    },
  )

  it('refuses search when its allowance leaves no room for a reply', () => {
    expect(() =>
      reserveRequest({
        capUsd: Usd.from(0.0125).toAmount(),
        spentUsd: Usd.from(0).toAmount(),
        estimatedInputTokens: 0,
        modelId: MODEL,
        maxToolCalls: 5,
        searchPriceUsd: Usd.from(0.0025).toAmount(),
      }),
    ).toThrow(SessionBudgetExceededError)
  })

  it('keeps exactly one output token affordable after decimal cap subtraction', () => {
    // $0.30 - $0.20 is exactly $0.10: the remaining $0.0000002 buys one token.
    const request = {
      capUsd: Usd.from(0.3).toAmount(),
      spentUsd: Usd.from(0.2).toAmount(),
      estimatedInputTokens: 999_998,
      modelId: CONTRIBUTOR,
    }
    const reservation = reserveRequest(request)
    expect(reservation.maxOutputTokens).toBe(1)
    expect(reservation.costUsd).toBe(Usd.from(0.1).toAmount())
  })

  it('lowers max_output_tokens so input plus output at list price fits what is left', () => {
    // Input $0.125 (100k × $1.25/M); $0.005 left pays 1,176 output tokens at $4.25/M.
    const reservation = reserveRequest({
      capUsd: Usd.from(0.13).toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      estimatedInputTokens: 100_000,
      modelId: MODEL,
    })
    expect(reservation.maxOutputTokens).toBe(1176)
    expect(Number(reservation.costUsd)).toBeCloseTo(0.125 + 1176 * STANDARD_OUTPUT_TOKEN_USD, 12)
    expect(Number(reservation.costUsd)).toBeLessThanOrEqual(0.13 + FLOAT_SLACK)
  })

  it('keeps the usual maximum when the cap has room for it', () => {
    const reservation = reserveRequest({
      capUsd: Usd.from(1).toAmount(),
      spentUsd: Usd.from(0.2).toAmount(),
      estimatedInputTokens: 100_000,
      modelId: MODEL,
    })
    expect(reservation.maxOutputTokens).toBe(MODEL_API_MAX_OUTPUT_TOKENS)
    expect(Number(reservation.costUsd)).toBeCloseTo(
      0.125 + MODEL_API_MAX_OUTPUT_TOKENS * STANDARD_OUTPUT_TOKEN_USD,
      12,
    )
  })

  it('clamps the selected model cap to affordable tokens without enlarging smaller caps', () => {
    for (const maxOutputTokens of [1, 4096, 131_072]) {
      const reservation = reserveRequest({
        capUsd: Usd.from(1).toAmount(),
        spentUsd: Usd.from(0).toAmount(),
        estimatedInputTokens: 0,
        modelId: MODEL,
        maxOutputTokens,
      })
      expect(reservation.maxOutputTokens).toBe(maxOutputTokens)
    }
    expect(
      reserveRequest({
        capUsd: Usd.from(0.01).toAmount(),
        spentUsd: Usd.from(0).toAmount(),
        estimatedInputTokens: 50_000,
        modelId: CONTRIBUTOR,
        maxOutputTokens: 131_072,
      }).maxOutputTokens,
    ).toBe(25_000)
    for (const maxOutputTokens of [0, -1, 1.5, Infinity, NaN]) {
      expect(() =>
        reserveRequest({
          capUsd: Usd.from(1).toAmount(),
          spentUsd: Usd.from(0).toAmount(),
          estimatedInputTokens: 0,
          modelId: MODEL,
          maxOutputTokens,
        }),
      ).toThrow('invalid output.maxTokens')
    }
  })

  it('prices a contributor model at its own tier', () => {
    // $0.10/M in: 50k is $0.005; the other $0.005 pays 25,000 at $0.20/M.
    expect(
      reserveRequest({
        capUsd: Usd.from(0.01).toAmount(),
        spentUsd: Usd.from(0).toAmount(),
        estimatedInputTokens: 50_000,
        modelId: CONTRIBUTOR,
      }).maxOutputTokens,
    ).toBe(25_000)
  })

  it('sends a request that has room for a single output token', () => {
    // $0.00125 of input, and one and a half output tokens' worth left.
    const reservation = reserveRequest({
      capUsd: Usd.from(0.00125 + 1.5 * STANDARD_OUTPUT_TOKEN_USD).toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      estimatedInputTokens: 1000,
      modelId: MODEL,
    })
    expect(reservation.maxOutputTokens).toBe(1)
  })

  it('refuses a request with no room for one output token, and says why', () => {
    const capUsd = 0.00125 + 0.9 * STANDARD_OUTPUT_TOKEN_USD
    const refuse = () =>
      reserveRequest({
        capUsd: Usd.from(capUsd).toAmount(),
        spentUsd: Usd.from(0).toAmount(),
        estimatedInputTokens: 1000,
        modelId: MODEL,
      })
    expect(refuse).toThrow(SessionBudgetExceededError)
    expect(refuse).toThrow(
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatUsd(0.00125),
        cap: formatUsd(capUsd),
        spent: formatUsd(0),
      }),
    )
  })

  it('refuses once the spend has reached the cap, whatever the request', () => {
    expect(() =>
      reserveRequest({
        capUsd: Usd.from(1).toAmount(),
        spentUsd: Usd.from(1).toAmount(),
        estimatedInputTokens: 0,
        modelId: MODEL,
      }),
    ).toThrow(SessionBudgetExceededError)
    expect(() =>
      reserveRequest({
        capUsd: Usd.from(1).toAmount(),
        spentUsd: Usd.from(1.5).toAmount(),
        estimatedInputTokens: 0,
        modelId: MODEL,
      }),
    ).toThrow(SessionBudgetExceededError)
  })

  it('refuses a model whose price it does not know: the cap could not be kept', () => {
    const request = {
      capUsd: Usd.from(100).toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      estimatedInputTokens: 1,
      modelId: 'muse-x',
    }
    expect(() => reserveRequest(request)).toThrow(SessionBudgetExceededError)
    expect(() => reserveRequest(request)).toThrow(
      fill(UI_TEXT.sessionBudgetUnpriced, { model: 'muse-x' }),
    )
  })

  it('never reserves more than what is left', () => {
    for (const capUsd of [0.001, 0.01, 0.1, 0.5, 2]) {
      for (const spentUsd of [0, capUsd / 3, capUsd / 2]) {
        for (const estimatedInputTokens of [0, 10, 700, 5000, 70_000]) {
          for (const modelId of [MODEL, CONTRIBUTOR]) {
            let reservation
            try {
              reservation = reserveRequest({
                capUsd: Usd.from(capUsd).toAmount(),
                spentUsd: Usd.from(spentUsd).toAmount(),
                estimatedInputTokens,
                modelId,
              })
            } catch (error: unknown) {
              expect(error).toBeInstanceOf(SessionBudgetExceededError)
              continue
            }
            expect(reservation.maxOutputTokens).toBeGreaterThanOrEqual(1)
            expect(Number(reservation.costUsd)).toBeLessThanOrEqual(capUsd - spentUsd + FLOAT_SLACK)
          }
        }
      }
    }
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
      ).toThrow(
        fill(UI_TEXT.sessionBudgetStopped, {
          estimate: formatUsd(0.01),
          cap: formatUsd(1),
          spent: formatUsd(1),
        }),
      )
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

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  estimateInput,
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

describe('reserveRequest', () => {
  it('lowers max_output_tokens so input plus output at list price fits what is left', () => {
    // Input $0.125 (100k × $1.25/M); $0.005 left pays 1,176 output tokens at $4.25/M.
    const reservation = reserveRequest({
      capUsd: 0.13,
      spentUsd: 0,
      estimatedInputTokens: 100_000,
      modelId: MODEL,
    })
    expect(reservation.maxOutputTokens).toBe(1176)
    expect(reservation.costUsd).toBeCloseTo(0.125 + 1176 * STANDARD_OUTPUT_TOKEN_USD, 12)
    expect(reservation.costUsd).toBeLessThanOrEqual(0.13 + FLOAT_SLACK)
  })

  it('keeps the usual maximum when the cap has room for it', () => {
    const reservation = reserveRequest({
      capUsd: 1,
      spentUsd: 0.2,
      estimatedInputTokens: 100_000,
      modelId: MODEL,
    })
    expect(reservation.maxOutputTokens).toBe(MODEL_API_MAX_OUTPUT_TOKENS)
    expect(reservation.costUsd).toBeCloseTo(
      0.125 + MODEL_API_MAX_OUTPUT_TOKENS * STANDARD_OUTPUT_TOKEN_USD,
      12,
    )
  })

  it('prices a contributor model at its own tier', () => {
    // $0.10/M in: 50k is $0.005; the other $0.005 pays 25,000 at $0.20/M.
    expect(
      reserveRequest({
        capUsd: 0.01,
        spentUsd: 0,
        estimatedInputTokens: 50_000,
        modelId: CONTRIBUTOR,
      }).maxOutputTokens,
    ).toBe(25_000)
  })

  it('sends a request that has room for a single output token', () => {
    // $0.00125 of input, and one and a half output tokens' worth left.
    const reservation = reserveRequest({
      capUsd: 0.00125 + 1.5 * STANDARD_OUTPUT_TOKEN_USD,
      spentUsd: 0,
      estimatedInputTokens: 1000,
      modelId: MODEL,
    })
    expect(reservation.maxOutputTokens).toBe(1)
  })

  it('refuses a request with no room for one output token, and says why', () => {
    const capUsd = 0.00125 + 0.9 * STANDARD_OUTPUT_TOKEN_USD
    const refuse = () =>
      reserveRequest({ capUsd, spentUsd: 0, estimatedInputTokens: 1000, modelId: MODEL })
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
      reserveRequest({ capUsd: 1, spentUsd: 1, estimatedInputTokens: 0, modelId: MODEL }),
    ).toThrow(SessionBudgetExceededError)
    expect(() =>
      reserveRequest({ capUsd: 1, spentUsd: 1.5, estimatedInputTokens: 0, modelId: MODEL }),
    ).toThrow(SessionBudgetExceededError)
  })

  it('refuses a model whose price it does not know: the cap could not be kept', () => {
    const request = { capUsd: 100, spentUsd: 0, estimatedInputTokens: 1, modelId: 'muse-x' }
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
              reservation = reserveRequest({ capUsd, spentUsd, estimatedInputTokens, modelId })
            } catch (error: unknown) {
              expect(error).toBeInstanceOf(SessionBudgetExceededError)
              continue
            }
            expect(reservation.maxOutputTokens).toBeGreaterThanOrEqual(1)
            expect(reservation.costUsd).toBeLessThanOrEqual(capUsd - spentUsd + FLOAT_SLACK)
          }
        }
      }
    }
  })
})

describe('M108 T account budget admission', () => {
  it('keeps an unbound claim identical and binds a guard once for initial and every final check', async () => {
    const total = { spentUsd: 0.5, hasUnknownHistoricalFees: false }
    const claim: SessionBudgetClaim = {
      claimId: 'owned-claim',
      reservedUsd: 0.1,
      check: vi.fn(() => total),
      settle: vi.fn(() => Promise.resolve(total)),
    }
    expect(withAccountBudgetAdmission(claim, undefined)).toBe(claim)
    const guard = vi.fn<() => void>()
    const bind = vi.fn(() => guard)
    const admitted = withAccountBudgetAdmission(claim, bind)
    expect(bind).toHaveBeenCalledExactlyOnceWith(claim)
    expect(guard).toHaveBeenCalledOnce()
    expect(admitted.check(1)).toBe(total)
    expect(admitted.check(2)).toBe(total)
    expect(guard).toHaveBeenCalledTimes(3)
    expect(claim.check).toHaveBeenNthCalledWith(1, 1)
    expect(claim.check).toHaveBeenNthCalledWith(2, 2)
    expect(admitted.claimId).toBe(claim.claimId)
    expect(admitted.reservedUsd).toBe(claim.reservedUsd)
    await expect(admitted.settle(0.1, true)).resolves.toBe(total)
    expect(claim.settle).toHaveBeenCalledExactlyOnceWith(0.1, true)
    const stop = new Error('Account threshold reached')
    guard.mockImplementation(() => {
      throw stop
    })
    expect(() => admitted.check(1)).toThrow(stop)
    expect(claim.check).toHaveBeenCalledTimes(2)
    expect(() => withAccountBudgetAdmission(claim, bind)).toThrow(stop)
  })

  it('does not let an account swap reset M82 settled spend or outstanding liability', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-account-session-'))
    try {
      const journal = createSessionBudgetJournal({
        directory,
        sleep: () => Promise.resolve(),
        initialBudget: () => Promise.resolve({ spentUsd: 0, hasUnknownHistoricalFees: false }),
      })
      const owner = 'a'.repeat(64)
      await journal.record('conversation', owner, 0.8)
      const open = await journal.reserve('conversation', owner, 0.1)
      const check = vi.fn<() => void>()
      withAccountBudgetAdmission(open, () => check).check(1)
      const afterSwap = await journal.reserve('conversation', owner, 0.1)
      const swapped = withAccountBudgetAdmission(afterSwap, () => check)
      expect(swapped.check(1).spentUsd).toBeCloseTo(1)
      await swapped.settle(0.1)
      const rejected = await journal.reserve('conversation', owner, 0.01)
      expect(() => withAccountBudgetAdmission(rejected, () => check).check(1)).toThrow(
        fill(UI_TEXT.sessionBudgetStopped, {
          estimate: formatUsd(0.01),
          cap: formatUsd(1),
          spent: formatUsd(1),
        }),
      )
      await rejected.settle(0)
      const total = await journal.read('conversation', owner)
      expect(total.spentUsd).toBeCloseTo(1)
      // The old account's unresolved request remains owed after the swap.
      expect(open.reservedUsd).toBe(0.1)
    } finally {
      await removeFolder(directory)
    }
  })
})

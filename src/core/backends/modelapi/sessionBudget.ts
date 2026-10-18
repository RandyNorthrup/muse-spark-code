// The Model API session budget (M82; PLAN.md D121): a dollar limit per
// conversation that the person sets, none by default.
//
// With no limit there is no spending check at all on the request path. With
// one, the conversation keeps a running total in memory, added to after each
// call from the usage the provider reported, and saved with the session
// after the call, so a resume continues from it. Before a request is sent its
// cost is estimated, and a request whose estimate would pass the limit is
// not sent. Nothing is held for a request in flight: a call that went out and
// reported no usage is recorded as cost unknown and adds nothing.
//
// The estimate: the request's input is counted high, at one token per UTF-8
// byte of each part (a byte-level tokenizer never makes a token of less than
// one byte, and the parts are counted with their JSON around them), plus the
// calibrated upper bound of each M105 media part, at list price with no cache
// discount; `max_output_tokens` is then lowered so that input plus output at
// list price fits what is left of the limit. When even the provider's minimum
// output does not fit, the request is not sent.
//
// Pure: the session owns the running total, this module the arithmetic.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_PRICES_PER_MILLION,
  SESSION_BUDGET_MIN_BYTES_PER_TOKEN,
  TOKENS_PER_MILLION,
  UI_TEXT,
  WEB_SEARCH_MIN_PER_REQUEST,
  WEB_SEARCH_MAX_PER_REQUEST_LIMIT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { modelApiPaidTier } from '../../../shared/paid'
import { Usd, multiplyUsd, usdAmountSchema, type UsdAmount } from '../../../shared/usd'
import { SpendLedgerError } from '../../paid/spendLedgerError'
import { formatUsd, estimateCostUsd } from '../../usage/insights'
import { type ModelPricePolicy, modelPricedUsage } from './modelPolicy'

import type { CreateResponseBody, Usage } from './schemas'

const PART_DIGEST = 'sha256'
const ONE_TOKEN = 1n
const ZERO_TOKENS = 0n

/** The last reported request: what the next request's estimate starts from. */
export interface BudgetBase {
  /** Its input tokens, as Meta reported (or counted) them. */
  readonly inputTokens: number
  /** Each part it carried, by digest, with how many times. */
  readonly parts: ReadonlyMap<string, number>
}

/** A detached media part from the builder: metadata digest and calibrated tokens. */
export interface BudgetMediaPart {
  /** Stable metadata only, never base64 or a file's bytes. Text stays a separate part. */
  readonly mediaIdentity: string
  readonly upperBoundInputTokens: number
}

/** A request's estimated input, and its parts: the base once its usage is reported. */
export interface InputEstimate {
  readonly inputTokens: number
  readonly parts: ReadonlyMap<string, number>
}

/** A request the limit still fits. */
export interface BudgetFit {
  readonly estimatedInputTokens: number
  /** The `max_output_tokens` the request is sent with. */
  readonly maxOutputTokens: number
  /** The estimated input and the whole output allowance at list price: at most what was left. */
  readonly estimateUsd: UsdAmount
}

/**
 * The owner conversation's running total, for calls made outside its own
 * transcript (a review, a hook model, a best-of-N attempt): they are checked
 * against the owner's limit and charged to the owner's total.
 */
export interface OwnedSessionBudgetScope {
  readonly sessionId: string
  readonly accountId: string
  /** The person's limit, read live; zero is none. */
  readonly capUsd: () => UsdAmount
  /** What the conversation spent so far, from the usage each of its calls reported. */
  readonly spentUsd: () => UsdAmount
  /** One finished call: its cost, or `undefined` when it went out and reported no usage. */
  readonly charge: (costUsd: UsdAmount | undefined) => void
  /** Caller supplies the digest of the actual key about to send, never the key itself. */
  readonly isStillAllowed: (keyDigest: string | undefined) => boolean
}

/** A request a spending limit refused: it is not sent, and the turn stops with this reason. */
export class SessionBudgetExceededError extends Error {
  public readonly code = 'budget'
  public constructor(message: string) {
    super(message)
    this.name = 'SessionBudgetExceededError'
  }
}

/** What in a request body Meta counts as input: the instructions, the tools, and each input item. */
export function requestParts(
  body: Pick<CreateResponseBody, 'instructions' | 'tools' | 'input'>,
): readonly string[] {
  return [
    JSON.stringify(body.instructions),
    JSON.stringify(body.tools),
    ...body.input.map((item) => JSON.stringify(item)),
  ]
}

/**
 * The request's input estimated high from the base (see the file comment):
 * with no base, every part counts; with one, the base's tokens plus the
 * parts it did not carry.
 */
export function estimateInput(
  parts: readonly (string | BudgetMediaPart)[],
  base: BudgetBase | undefined,
): InputEstimate {
  const baseTokens = base?.inputTokens ?? 0
  if (!Number.isSafeInteger(baseTokens) || baseTokens < 0)
    throw new SpendLedgerError('integrity', { scope: 'session', file: 'claim or amount' })
  const own = new Map<string, number>()
  const unmatched = new Map(base?.parts)
  let addedBytes = ZERO_TOKENS
  let mediaTokens = 0
  for (const part of parts) {
    const media = typeof part === 'string' ? undefined : part
    if (media !== undefined) {
      if (!Number.isSafeInteger(media.upperBoundInputTokens) || media.upperBoundInputTokens < 0)
        throw new Error('Media budget needs a validated calibrated upper bound')
      // Reported input may include old media, but the count route does not.
      // Keep the base whole and estimate media on every round, including replay.
      mediaTokens += media.upperBoundInputTokens
    }
    const serialized = typeof part === 'string' ? part : part.mediaIdentity
    const digest = createHash(PART_DIGEST)
      .update(media === undefined ? '' : 'media:')
      .update(serialized)
      .digest('hex')
    own.set(digest, (own.get(digest) ?? 0) + 1)
    const left = unmatched.get(digest) ?? 0
    if (left > 0) {
      unmatched.set(digest, left - 1)
    } else if (media === undefined) {
      addedBytes += BigInt(Buffer.byteLength(serialized))
    }
  }
  const bytesPerToken = BigInt(SESSION_BUDGET_MIN_BYTES_PER_TOKEN)
  const inputTokens =
    BigInt(baseTokens) +
    (addedBytes + bytesPerToken - ONE_TOKEN) / bytesPerToken +
    BigInt(mediaTokens)
  if (inputTokens > BigInt(Number.MAX_SAFE_INTEGER))
    throw new SpendLedgerError('integrity', { scope: 'session', file: 'claim or amount' })
  return {
    inputTokens: Number(inputTokens),
    parts: own,
  }
}

/**
 * Fits a request whose input is estimated at `estimatedInputTokens` into
 * what is left of the limit, at the model's list price with no cache
 * discount assumed. Throws when the model has no verified price (the limit
 * could not be kept) or when the provider's minimum output
 * (`minOutputTokens`, 1 when no minimum was captured) does not fit on top of
 * the input: the request is not sent, and the turn stops with the budget
 * reason instead of a provider rejection.
 */
export function fitRequest(request: {
  readonly capUsd: UsdAmount
  readonly spentUsd: UsdAmount
  readonly estimatedInputTokens: number
  readonly modelId: string
  readonly maxToolCalls?: number
  readonly searchPriceUsd?: UsdAmount | undefined
  /** Selected model's output allowance. Omitted callers keep the Model API maximum. */
  readonly maxOutputTokens?: number
  /** The selected provider's smallest accepted output cap; unknown keeps 1. */
  readonly minOutputTokens?: number | undefined
  readonly price?: ModelPricePolicy | undefined
  readonly images?: number | undefined
}): BudgetFit {
  if (request.price !== undefined) return fitProviderRequest({ ...request, price: request.price })
  const searchCostUsd = searchAllowanceUsd(request.maxToolCalls, request.searchPriceUsd)
  const tier = modelApiPaidTier(request.modelId)
  if (tier === undefined) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetUnpriced, { model: request.modelId }),
    )
  }
  if (!Number.isSafeInteger(request.estimatedInputTokens) || request.estimatedInputTokens < 0)
    throw new SpendLedgerError('integrity', { scope: 'session', file: 'claim or amount' })
  const prices = MODEL_API_PRICES_PER_MILLION[tier]
  const inputCost = Usd.from(prices.input)
    .times(request.estimatedInputTokens)
    .divide(TOKENS_PER_MILLION)
  const outputPrice = Usd.from(prices.output).divide(TOKENS_PER_MILLION)
  const left = Usd.from(request.capUsd).subtract(Usd.from(request.spentUsd))
  const affordableOutputTokens = left
    .subtract(inputCost)
    .subtract(Usd.from(searchCostUsd))
    .floorDivide(outputPrice)
  const floor = request.minOutputTokens ?? 1
  if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError('invalid output.minTokens')
  if (affordableOutputTokens < BigInt(floor)) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatUsd(
          inputCost.add(outputPrice.times(floor)).add(Usd.from(searchCostUsd)).toAmount(),
        ),
        cap: formatUsd(request.capUsd),
        spent: formatUsd(request.spentUsd),
      }),
    )
  }
  const outputCap = request.maxOutputTokens ?? MODEL_API_MAX_OUTPUT_TOKENS
  if (!Number.isSafeInteger(outputCap) || outputCap < 1)
    throw new RangeError('invalid output.maxTokens')
  const maxOutputTokens = Number(
    affordableOutputTokens < BigInt(outputCap) ? affordableOutputTokens : BigInt(outputCap),
  )
  return {
    estimatedInputTokens: request.estimatedInputTokens,
    maxOutputTokens,
    estimateUsd: inputCost
      .add(outputPrice.times(maxOutputTokens))
      .add(Usd.from(searchCostUsd))
      .toAmount(),
  }
}

/** The hosted fee estimated alongside tokens, from a verified bound and tariff. */
export function searchAllowanceUsd(
  bound: number | undefined,
  priceUsd: UsdAmount | undefined,
): UsdAmount {
  if (
    bound !== undefined &&
    (priceUsd === undefined ||
      !usdAmountSchema.safeParse(priceUsd).success ||
      Usd.from(priceUsd).compare(Usd.from(0)) < 0 ||
      !Number.isSafeInteger(bound) ||
      bound < WEB_SEARCH_MIN_PER_REQUEST ||
      bound > WEB_SEARCH_MAX_PER_REQUEST_LIMIT)
  ) {
    throw new SessionBudgetExceededError(UI_TEXT.sessionBudgetSearchUnavailable)
  }
  return multiplyUsd(priceUsd ?? Usd.from(0).toAmount(), bound ?? 0)
}

/**
 * A hidden paid request's cost (a review, a hook model): zero when it was not
 * sent or was refused before any response; its price from the reported usage;
 * `undefined` (cost unknown) when it went out and no usable usage or price
 * came back. Never its estimate.
 */
export function helperRequestCost(
  modelId: string,
  usage: Usage | null | undefined,
  isCountedUsage: (usage: Usage) => boolean,
  wasSent: boolean,
  wasRefused: boolean,
  price?: ModelPricePolicy,
): UsdAmount | undefined {
  if (!wasSent || wasRefused) return Usd.from(0).toAmount()
  if (usage === null || usage === undefined || !isCountedUsage(usage)) return undefined
  if (price !== undefined)
    return price.settle(modelPricedUsage(usage), { cost: usage.provider_cost_usd })
  if (modelApiPaidTier(modelId) === undefined) return undefined
  return estimateCostUsd(
    {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    },
    modelId,
  )
}

/** A provider's public price card bounds every potentially written input token. */
function fitProviderRequest(request: {
  readonly capUsd: UsdAmount
  readonly spentUsd: UsdAmount
  readonly estimatedInputTokens: number
  readonly modelId: string
  readonly price: ModelPricePolicy
  readonly maxOutputTokens?: number | undefined
  readonly minOutputTokens?: number | undefined
  readonly images?: number | undefined
}): BudgetFit {
  const usage = {
    inputTokens: request.estimatedInputTokens,
    outputTokens: 0,
    images: request.images,
  }
  const inputCostUsd = request.price.reserve(usage)
  if (
    inputCostUsd === undefined ||
    !usdAmountSchema.safeParse(inputCostUsd).success ||
    Usd.from(inputCostUsd).compare(Usd.from(0)) < 0
  ) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetUnpriced, { model: request.modelId }),
    )
  }
  const leftUsd = Usd.from(request.capUsd).subtract(Usd.from(request.spentUsd))
  let low = 0
  let high = request.maxOutputTokens ?? MODEL_API_MAX_OUTPUT_TOKENS
  while (low < high) {
    const tokens = Math.ceil((low + high) / 2)
    const cost = request.price.reserve({ ...usage, outputTokens: tokens })
    if (
      cost !== undefined &&
      usdAmountSchema.safeParse(cost).success &&
      Usd.from(cost).compare(leftUsd) <= 0
    )
      low = tokens
    else high = tokens - 1
  }
  const floor = request.minOutputTokens ?? 1
  if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError('invalid output.minTokens')
  if (low < floor) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatUsd(
          request.price.reserve({ ...usage, outputTokens: floor }) ?? inputCostUsd,
        ),
        cap: formatUsd(request.capUsd),
        spent: formatUsd(request.spentUsd),
      }),
    )
  }
  const estimateUsd = request.price.reserve({ ...usage, outputTokens: low })
  if (estimateUsd === undefined) throw new SessionBudgetExceededError(UI_TEXT.subagentTariffUnknown)
  return { estimatedInputTokens: usage.inputTokens, maxOutputTokens: low, estimateUsd }
}

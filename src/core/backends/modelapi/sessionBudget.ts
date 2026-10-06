import { USD_DECIMAL_ONE } from '../../../shared/usdConstants'
// The Model API session budget (M82, PLAN.md M82): a dollar cap per
// conversation, kept by reservation, since a request's cost is incurred
// once it is sent.
//
// Before each request its input is estimated high: the last reported
// request's input tokens, as Meta counted them, plus every part of this
// request that the reported one did not carry, counted at one token per
// UTF-8 byte. A byte-level tokenizer never makes a token of less than one
// byte, and the parts are counted with their JSON around them, so for text
// the estimate is above the real count; images and files count at their
// encoded size, far above theirs. A part the reported request carried and
// this one does not (a compaction, older media left out) is never
// subtracted, so a removal can only raise the estimate. `max_output_tokens`
// is then set so that input plus output at list price fits what is left; a
// request that cannot fit is not sent.
//
// Pure: the session owns the spend and the base, this module the arithmetic.

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
import { formatUsd, estimateCostUsd } from '../../usage/insights'
import type { CreateResponseBody, Usage } from './schemas'

const PART_DIGEST = 'sha256'

/** The last reported request: what the next request's estimate starts from. */
export interface BudgetBase {
  /** Its input tokens, as Meta reported (or counted) them. */
  readonly inputTokens: number
  /** Each part it carried, by digest, with how many times. */
  readonly parts: ReadonlyMap<string, number>
}

/** A request's estimated input, and its parts: the base once its usage is reported. */
export interface InputEstimate {
  readonly inputTokens: number
  readonly parts: ReadonlyMap<string, number>
}

/** A request the cap still fits. */
export interface BudgetReservation {
  readonly estimatedInputTokens: number
  /** The `max_output_tokens` the request is sent with. */
  readonly maxOutputTokens: number
  /** The estimated input and the whole output allowance at list price: at most what was left. */
  readonly costUsd: UsdAmount
}

/** Authoritative shared spend, including requests whose result is still unknown. */
export interface SessionBudgetTotal {
  readonly spentUsd: UsdAmount
  readonly hasUnknownHistoricalFees: boolean
}

/** One request owns its liability until its verified actual cost or a nonsent refund. */
export interface SessionBudgetClaim {
  readonly claimId: string
  readonly reservedUsd: UsdAmount
  /** Synchronous final admission after key retrieval; refuses an incomplete or over-cap ledger. */
  check(capUsd: UsdAmount): SessionBudgetTotal
  /** Only this claim's owner settles it. Entries remain visible, including a zero refund. */
  settle(
    actualCostUsd: UsdAmount,
    hasUnknownCost?: boolean,
    /** False atomically retains an updated liability on this row without closing it. */
    isFinal?: boolean,
  ): Promise<SessionBudgetTotal>
}

/** The session store's scoped spend journal; all callers share the same account-owned history. */
export interface SessionBudgetJournal {
  read(sessionId: string, accountId: string): Promise<SessionBudgetTotal>
  reserve(
    sessionId: string,
    accountId: string,
    costUsd: UsdAmount,
    liability?: {
      readonly isUnbounded?: boolean
      readonly hasUnknownCost?: boolean
    },
  ): Promise<SessionBudgetClaim>
  record(
    sessionId: string,
    accountId: string,
    costUsd: UsdAmount,
    hasUnknownCost?: boolean,
  ): Promise<SessionBudgetTotal>
}

/** Parent-owned spend for extension calls with independent temporary transcripts. */
export interface OwnedSessionBudgetScope {
  readonly sessionId: string
  readonly accountId: string
  readonly journal: SessionBudgetJournal
  /** Machine setting stays live through async work and final admission. */
  readonly capUsd: () => UsdAmount
  /** Caller supplies the digest of the actual key about to send, never the key itself. */
  readonly isStillAllowed: (keyDigest: string | undefined) => boolean
}

/** A request the budget refused: it is not sent, and the turn stops with this reason. */
export class SessionBudgetExceededError extends Error {
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
  parts: readonly string[],
  base: BudgetBase | undefined,
): InputEstimate {
  const own = new Map<string, number>()
  const unmatched = new Map(base?.parts)
  let addedBytes = 0
  for (const part of parts) {
    const digest = createHash(PART_DIGEST).update(part).digest('hex')
    own.set(digest, (own.get(digest) ?? 0) + 1)
    const left = unmatched.get(digest) ?? 0
    if (left > 0) {
      unmatched.set(digest, left - 1)
    } else {
      addedBytes += Buffer.byteLength(part)
    }
  }
  return {
    inputTokens:
      (base?.inputTokens ?? 0) + Math.ceil(addedBytes / SESSION_BUDGET_MIN_BYTES_PER_TOKEN),
    parts: own,
  }
}

/**
 * The reservation for a request whose input is estimated at
 * `estimatedInputTokens`, at the model's list price with no cache discount
 * assumed. Throws when the model has no verified price (the cap could not
 * be kept) or when not even one output token fits on top of the input.
 */
export function reserveRequest(request: {
  readonly capUsd: UsdAmount
  readonly spentUsd: UsdAmount
  readonly estimatedInputTokens: number
  readonly modelId: string
  readonly maxToolCalls?: number
  readonly searchPriceUsd?: UsdAmount | undefined
}): BudgetReservation {
  const searchCostUsd = searchAllowanceUsd(request.maxToolCalls, request.searchPriceUsd)
  const tier = modelApiPaidTier(request.modelId)
  if (tier === undefined) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetUnpriced, { model: request.modelId }),
    )
  }
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
  if (affordableOutputTokens < USD_DECIMAL_ONE) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatUsd(inputCost.add(Usd.from(searchCostUsd)).toAmount()),
        cap: formatUsd(request.capUsd),
        spent: formatUsd(request.spentUsd),
      }),
    )
  }
  const maxOutputTokens = Number(
    affordableOutputTokens < BigInt(MODEL_API_MAX_OUTPUT_TOKENS)
      ? affordableOutputTokens
      : BigInt(MODEL_API_MAX_OUTPUT_TOKENS),
  )
  return {
    estimatedInputTokens: request.estimatedInputTokens,
    maxOutputTokens,
    costUsd: inputCost
      .add(outputPrice.times(maxOutputTokens))
      .add(Usd.from(searchCostUsd))
      .toAmount(),
  }
}

/** The hosted fee held alongside tokens, from a verified bound and tariff. */
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

/** A hidden paid request's known charge, or its retained uncertain reservation. */
export function helperRequestSettlement(
  modelId: string,
  usage: Usage | null | undefined,
  isCountedUsage: (usage: Usage) => boolean,
  wasSent: boolean,
  wasRefused: boolean,
  reservedUsd: UsdAmount,
) {
  const hasUsage = usage !== null && usage !== undefined && isCountedUsage(usage)
  let costUsd = Usd.from(wasSent && !wasRefused ? reservedUsd : 0).toAmount()
  if (usage !== null && usage !== undefined && isCountedUsage(usage)) {
    costUsd = estimateCostUsd(
      {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      },
      modelId,
    )
  }
  return { costUsd, isUnknown: wasSent && !wasRefused && !hasUsage }
}

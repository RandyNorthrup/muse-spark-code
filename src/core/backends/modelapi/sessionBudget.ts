// The Model API session budget (M82, PLAN.md M82): a dollar cap per
// conversation, kept by reservation, since a request's cost is incurred
// once it is sent.
//
// Before each request its input is estimated high: the last reported
// request's input tokens, as Meta counted them, plus every part of this
// request that the reported one did not carry, counted at one token per
// UTF-8 byte. A byte-level tokenizer never makes a token of less than one
// byte, and the parts are counted with their JSON around them, so for text
// the estimate is above the real count. M105 media parts instead carry a
// calibrated upper bound: encoded size is never their token count. A part
// the reported request carried and this one does not (a compaction, older
// media left out) is never subtracted, so a removal can only raise the
// estimate. `max_output_tokens`
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
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { modelApiPaidTier } from '../../../shared/paid'
import { formatUsd } from '../../usage/insights'
import type { ModelPricePolicy } from './modelPolicy'
import { modelPricedUsage } from './modelPolicy'
import {
  formatUsd as formatAccountUsd,
  multiplyUsd,
  parseUsd,
  subtractUsd,
  sumUsd,
  usdNumber,
} from '../../../shared/accountUsd'
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

/** A request the cap still fits. */
export interface BudgetReservation {
  readonly estimatedInputTokens: number
  /** The `max_output_tokens` the request is sent with. */
  readonly maxOutputTokens: number
  /** The estimated input and the whole output allowance at list price: at most what was left. */
  readonly costUsd: number
}

/** Authoritative shared spend, including requests whose result is still unknown. */
export interface SessionBudgetTotal {
  readonly spentUsd: number
  readonly hasUnknownHistoricalFees: boolean
}

/** One request owns its liability until its verified actual cost or a nonsent refund. */
export interface SessionBudgetClaim {
  readonly claimId: string
  readonly reservedUsd: number
  /** Synchronous final admission after key retrieval; refuses an incomplete or over-cap ledger. */
  check(capUsd: number): SessionBudgetTotal
  /** Only this claim's owner settles it. Entries remain visible, including a zero refund. */
  settle(actualCostUsd: number, hasUnknownCost?: boolean): Promise<SessionBudgetTotal>
}

/** P binds the selected account and M102's owned-claim exclusion once.
 * The returned guard rereads thresholds/limits synchronously at every send.
 * The caller refunds this claim when initial admission throws. */
export type AccountBudgetAdmission = (claim: SessionBudgetClaim) => () => void

/** Account admission supplements the existing conversation/daily cap. */
export function withAccountBudgetAdmission(
  claim: SessionBudgetClaim,
  admission: AccountBudgetAdmission | undefined,
): SessionBudgetClaim {
  if (admission === undefined) return claim
  const checkAccount = admission(claim)
  checkAccount()
  return {
    ...claim,
    check(capUsd) {
      checkAccount()
      return claim.check(capUsd)
    },
  }
}

/** The session store's scoped spend journal; all callers share the same account-owned history. */
export interface SessionBudgetJournal {
  /** Display-only read: never seeds or reserves an unopened scope. */
  readonly readExisting?: (
    sessionId: string,
    accountId: string,
  ) => Promise<(SessionBudgetTotal & { readonly uncertainUsd?: number }) | undefined>
  read(sessionId: string, accountId: string): Promise<SessionBudgetTotal>
  reserve(
    sessionId: string,
    accountId: string,
    costUsd: number,
    liability?: {
      readonly isUnbounded?: boolean
      readonly hasUnknownCost?: boolean
    },
  ): Promise<SessionBudgetClaim>
  record(
    sessionId: string,
    accountId: string,
    costUsd: number,
    hasUnknownCost?: boolean,
  ): Promise<SessionBudgetTotal>
}

/** Parent-owned spend for extension calls with independent temporary transcripts. */
export interface OwnedSessionBudgetScope {
  readonly sessionId: string
  readonly accountId: string
  readonly journal: SessionBudgetJournal
  /** Machine setting stays live through async work and final admission. */
  readonly capUsd: () => number
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
  parts: readonly (string | BudgetMediaPart)[],
  base: BudgetBase | undefined,
): InputEstimate {
  const baseTokens = base?.inputTokens ?? 0
  if (!Number.isSafeInteger(baseTokens) || baseTokens < 0)
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
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
      // Keep the base whole and reserve media on every round, including replay.
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
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  return {
    inputTokens: Number(inputTokens),
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
  readonly capUsd: number
  readonly spentUsd: number
  readonly estimatedInputTokens: number
  readonly modelId: string
  readonly price?: ModelPricePolicy | undefined
  readonly maxOutputTokens?: number | undefined
  readonly images?: number | undefined
}): BudgetReservation {
  if (request.price !== undefined) {
    return reserveProviderRequest({ ...request, price: request.price })
  }
  const tier = modelApiPaidTier(request.modelId)
  if (tier === undefined) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetUnpriced, { model: request.modelId }),
    )
  }
  if (!Number.isSafeInteger(request.estimatedInputTokens) || request.estimatedInputTokens < 0)
    throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  const prices = MODEL_API_PRICES_PER_MILLION[tier]
  const inputCost = multiplyUsd(
    parseUsd(prices.input),
    BigInt(request.estimatedInputTokens),
    BigInt(TOKENS_PER_MILLION),
  )
  const cap = parseUsd(request.capUsd, 'floor')
  const spent = parseUsd(request.spentUsd)
  const left = subtractUsd(subtractUsd(cap, spent), inputCost)
  const outputTokenCost = multiplyUsd(
    parseUsd(prices.output),
    ONE_TOKEN,
    BigInt(TOKENS_PER_MILLION),
  )
  const affordableOutputTokens = left / outputTokenCost
  if (affordableOutputTokens < ONE_TOKEN) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatAccountUsd(inputCost),
        cap: formatAccountUsd(cap),
        spent: formatAccountUsd(spent),
      }),
    )
  }
  const maxOutputTokens = Math.min(
    Number(
      affordableOutputTokens < BigInt(MODEL_API_MAX_OUTPUT_TOKENS)
        ? affordableOutputTokens
        : BigInt(MODEL_API_MAX_OUTPUT_TOKENS),
    ),
    request.maxOutputTokens ?? MODEL_API_MAX_OUTPUT_TOKENS,
  )
  return {
    estimatedInputTokens: request.estimatedInputTokens,
    maxOutputTokens,
    costUsd: usdNumber(sumUsd([inputCost, multiplyUsd(outputTokenCost, BigInt(maxOutputTokens))])),
  }
}

/** A hidden paid request's known charge, or its retained uncertain reservation. */
export function helperRequestSettlement(
  modelId: string,
  usage: Usage | null | undefined,
  isCountedUsage: (usage: Usage) => boolean,
  wasSent: boolean,
  wasRefused: boolean,
  reservedUsd: number,
  price?: ModelPricePolicy,
) {
  const hasUsage = usage !== null && usage !== undefined && isCountedUsage(usage)
  let costUsd = wasSent && !wasRefused ? reservedUsd : 0
  let hasKnownCost = price === undefined
  if (usage !== null && usage !== undefined && isCountedUsage(usage)) {
    const settled = price?.settle(modelPricedUsage(usage), { cost: usage.provider_cost_usd })
    hasKnownCost = price === undefined || settled !== undefined
    if (price === undefined) {
      const tier = modelApiPaidTier(modelId)
      if (tier === undefined) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      const prices = MODEL_API_PRICES_PER_MILLION[tier]
      const cached = Math.min(usage.input_tokens_details?.cached_tokens ?? 0, usage.input_tokens)
      costUsd = usdNumber(
        sumUsd([
          multiplyUsd(
            parseUsd(prices.input),
            BigInt(usage.input_tokens - cached),
            BigInt(TOKENS_PER_MILLION),
          ),
          multiplyUsd(parseUsd(prices.cachedInput), BigInt(cached), BigInt(TOKENS_PER_MILLION)),
          multiplyUsd(
            parseUsd(prices.output),
            BigInt(usage.output_tokens),
            BigInt(TOKENS_PER_MILLION),
          ),
        ]),
      )
    } else costUsd = settled ?? reservedUsd
  }
  return { costUsd, isUnknown: wasSent && !wasRefused && (!hasUsage || !hasKnownCost) }
}

/** A provider's public price-card reservation bounds every potentially written input token. */
function reserveProviderRequest(request: {
  readonly capUsd: number
  readonly spentUsd: number
  readonly estimatedInputTokens: number
  readonly modelId: string
  readonly price: ModelPricePolicy
  readonly maxOutputTokens?: number | undefined
  readonly images?: number | undefined
}): BudgetReservation {
  const usage = {
    inputTokens: request.estimatedInputTokens,
    outputTokens: 0,
    images: request.images,
  }
  const inputCostUsd = request.price.reserve(usage)
  if (inputCostUsd === undefined || !Number.isFinite(inputCostUsd) || inputCostUsd < 0) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetUnpriced, { model: request.modelId }),
    )
  }
  const leftUsd = request.capUsd - request.spentUsd
  let low = 0
  let high = request.maxOutputTokens ?? MODEL_API_MAX_OUTPUT_TOKENS
  while (low < high) {
    const tokens = Math.ceil((low + high) / 2)
    const cost = request.price.reserve({ ...usage, outputTokens: tokens })
    if (cost !== undefined && Number.isFinite(cost) && cost <= leftUsd) low = tokens
    else high = tokens - 1
  }
  if (low < 1) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetStopped, {
        estimate: formatUsd(inputCostUsd),
        cap: formatUsd(request.capUsd),
        spent: formatUsd(request.spentUsd),
      }),
    )
  }
  const costUsd = request.price.reserve({ ...usage, outputTokens: low })
  if (costUsd === undefined) throw new SessionBudgetExceededError(UI_TEXT.subagentTariffUnknown)
  return { estimatedInputTokens: usage.inputTokens, maxOutputTokens: low, costUsd }
}

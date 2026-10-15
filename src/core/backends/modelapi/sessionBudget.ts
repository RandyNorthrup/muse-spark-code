// The Model API session budget (M82, PLAN.md M82; real-spend accounting
// lane LIMITSFIX, F3, D113): a dollar cap per conversation, compared against
// the real settled spend, never against an estimate or a worst case.
//
// ONE admission and settlement contract, used by every consumer of a cap the
// person set (the conversation, its sub-agents, compaction, the hook and
// review helper requests, hosted search, the shared daily extras and Tab):
//   - admission: a request is sent while the settled real spend is below the
//     cap. At or over the cap the next request stops, in words naming the
//     spend, the cap and how to raise it. No input estimate, no output worst
//     case, and the request keeps its own `max_output_tokens`;
//   - settlement: each response's real cost lands in the shared ledger when
//     its usage arrives;
//   - a response lost before its usage is recorded as UNKNOWN (never as a
//     guessed amount), and the next capped request says so and stops.
// The honest overshoot bound: the cap can be passed by at most one response
// per request in flight at the moment of admission (the conversation's own,
// up to SUBAGENT_CAPACITY sub-agents' and each helper request's).
//
// The input estimate below remains only for the scheduled runs' own finite
// ledger (D95) and the media request accounting (M105): the last reported
// request's input tokens plus every part it did not carry, at one token per
// UTF-8 byte.
//
// Pure: the session owns the spend and the base, this module the arithmetic.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  MODEL_API_MAX_OUTPUT_TOKENS,
  SESSION_BUDGET_MIN_BYTES_PER_TOKEN,
  UI_TEXT,
  WEB_SEARCH_MIN_PER_REQUEST,
  WEB_SEARCH_MAX_PER_REQUEST_LIMIT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { modelApiPaidTier } from '../../../shared/paid'
import { isBelowCap } from '../../../shared/spendCap'
import {
  Usd,
  isPositiveUsd,
  multiplyUsd,
  usdAmountSchema,
  type UsdAmount,
} from '../../../shared/usd'
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

/** A request the cap still admits. */
export interface BudgetReservation {
  /** The `max_output_tokens` the request is sent with: its own allowance, never lowered. */
  readonly maxOutputTokens: number
  /** What is held up front: only the exact hosted-search fee ceiling, never tokens (zero without search). */
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
  ) => Promise<(SessionBudgetTotal & { readonly uncertainUsd?: UsdAmount }) | undefined>
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

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 } as const

/**
 * Admits one capped request (lane LIMITSFIX, F3): the shared rule
 * (`isBelowCap`, src/shared/spendCap.ts) against the settled real spend. At
 * or over the cap the request is not sent and the sentence names the spend,
 * the cap and how to raise it. Nothing of the response is held: its tokens
 * settle as the real cost when its usage arrives, and a response lost before
 * its usage is recorded as unknown. Only the hosted-search fee ceiling, exact
 * for the request's own bound and the tariff the person approved, is held.
 * Throws when the model has no verified price (its spend could not be
 * settled, so the cap could not be kept). The request keeps its own
 * `max_output_tokens`, so the cap can be passed by at most the responses in
 * flight when it was admitted.
 */
export function reserveRequest(request: {
  readonly capUsd: UsdAmount
  readonly spentUsd: UsdAmount
  readonly modelId: string
  readonly maxToolCalls?: number
  readonly searchPriceUsd?: UsdAmount | undefined
  /** Selected model's output allowance. Omitted callers retain their legacy limit. */
  readonly maxOutputTokens?: number
  /** The selected provider's smallest accepted output cap; unknown keeps 1. */
  readonly minOutputTokens?: number | undefined
  readonly price?: ModelPricePolicy | undefined
}): BudgetReservation {
  const searchCostUsd = searchAllowanceUsd(request.maxToolCalls, request.searchPriceUsd)
  const pricedAt = request.price?.settle(NO_USAGE) ?? modelApiPaidTier(request.modelId)
  if (pricedAt === undefined) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetUnpriced, { model: request.modelId }),
    )
  }
  const floor = request.minOutputTokens ?? 1
  if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError('invalid output.minTokens')
  if (!isBelowCap(request.capUsd, request.spentUsd)) {
    throw new SessionBudgetExceededError(
      fill(UI_TEXT.sessionBudgetStopped, {
        spent: formatUsd(request.spentUsd),
        cap: formatUsd(request.capUsd),
      }),
    )
  }
  const outputCap = request.maxOutputTokens ?? MODEL_API_MAX_OUTPUT_TOKENS
  if (!Number.isSafeInteger(outputCap) || outputCap < 1)
    throw new RangeError('invalid output.maxTokens')
  return { maxOutputTokens: outputCap, costUsd: searchCostUsd }
}

/**
 * A hook or review helper request under the owner's scope (F3): admitted by
 * the one cap rule against the scope's settled spend, then given its own
 * journal claim with nothing held (an uncapped scope marks it unbounded).
 * Both helpers call this, so they cannot admit differently.
 */
export async function admitScopedRequest(
  scope: OwnedSessionBudgetScope,
  request: Omit<Parameters<typeof reserveRequest>[0], 'capUsd' | 'spentUsd'>,
): Promise<SessionBudgetClaim> {
  const total = await scope.journal.read(scope.sessionId, scope.accountId)
  const capUsd = scope.capUsd()
  if (isPositiveUsd(capUsd)) reserveRequest({ ...request, capUsd, spentUsd: total.spentUsd })
  return await scope.journal.reserve(scope.sessionId, scope.accountId, Usd.from(0).toAmount(), {
    isUnbounded: !isPositiveUsd(capUsd),
  })
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
  price?: ModelPricePolicy,
) {
  const hasUsage = usage !== null && usage !== undefined && isCountedUsage(usage)
  let costUsd = Usd.from(wasSent && !wasRefused ? reservedUsd : 0).toAmount()
  let hasKnownCost = price === undefined
  if (usage !== null && usage !== undefined && isCountedUsage(usage)) {
    const settled = price?.settle(modelPricedUsage(usage), { cost: usage.provider_cost_usd })
    hasKnownCost = price === undefined || settled !== undefined
    // An unpriced model's spend cannot be settled: the ledger fails closed.
    if (price === undefined && modelApiPaidTier(modelId) === undefined)
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    costUsd =
      price === undefined
        ? estimateCostUsd(
            {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
            },
            modelId,
          )
        : (settled ?? reservedUsd)
  }
  return { costUsd, isUnknown: wasSent && !wasRefused && (!hasUsage || !hasKnownCost) }
}

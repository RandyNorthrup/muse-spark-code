// The judge's admission (M98, PLAN.md D77): every paid judge call is
// reserved worst-case before dispatch, settled at its known cost, refunded
// when known not sent, and kept as liability when its outcome is uncertain.
// A batch is one call; a retry is a new claim. Pure core, no `vscode`
// import: the durable daily ledger arrives as an injected JudgeDailyLedger,
// and this module keeps no store, lock or journal of its own.
//
// The seam for D78's `src/host/paid/paidDailyBudget.ts`: that ledger must
// meet D77's entry criteria (one canonical namespace for VS Code windows and
// standalone clients; a durable reservation committed before dispatch; crash
// recovery that keeps a sent-or-possibly-sent claim as uncertain liability;
// idempotent settlement by claim id; fail-closed refusal on an unreadable
// store or lock failure; a stable lock; network filesystems refused). Until
// FIXDEF merges, the host passes a ledger with this shape and lane A's
// integration tests run against M82's journal, the store that ledger builds
// on. Only ids, token counts and dollars cross this module: never state,
// questions, answers or probabilities (D77 privacy).

import { randomUUID } from 'node:crypto'
import { estimateCostUsd } from '../usage/insights'
import { MODEL_API_PRICES_PER_MILLION, TOKENS_PER_MILLION } from '../../shared/constants'
import { modelApiPaidTier } from '../../shared/paid'

/** Per-million-token prices a reservation is computed from. */
export interface JudgeTokenPrices {
  readonly input: number
  readonly output: number
}

/**
 * The verified tariff for a model, or undefined when the extension knows no
 * price for it. Unpriced models are refused, never estimated (a suffix
 * display fallback is not a verified tariff or capped spending).
 */
export function judgePriceOf(modelId: string): JudgeTokenPrices | undefined {
  const tier = modelApiPaidTier(modelId)
  return tier === undefined ? undefined : { ...MODEL_API_PRICES_PER_MILLION[tier] }
}

/** A model with no verified tariff: admission refuses it before any popup. */
export class JudgeUnpricedError extends Error {
  public constructor(modelId: string) {
    super(`Judge admission has no verified price for model ${modelId}`)
    this.name = 'JudgeUnpricedError'
  }
}

/** The daily ledger failed: admission refuses, settlement keeps liability. */
export class JudgeLedgerError extends Error {
  public constructor(detail: string) {
    super(`Judge admission ledger failed: ${detail}`)
    this.name = 'JudgeLedgerError'
  }
}

function assertUsableCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Judge admission ${name} must be a nonnegative integer`)
  }
}

/**
 * The worst-case uncached price of one judge call: the estimated input at
 * the full input rate plus the whole output allowance at the output rate,
 * with no cache discount assumed. Throws JudgeUnpricedError for a model
 * with no verified tariff, TypeError for caller-bug counts.
 */
export function worstCaseJudgeCostUsd(args: {
  readonly modelId: string
  readonly estimatedInputTokens: number
  readonly maxOutputTokens: number
  readonly priceOf?: (modelId: string) => JudgeTokenPrices | undefined
}): number {
  assertUsableCount(args.estimatedInputTokens, 'estimated input tokens')
  assertUsableCount(args.maxOutputTokens, 'max output tokens')
  if (args.maxOutputTokens < 1) {
    throw new TypeError('Judge admission max output tokens must be at least 1')
  }
  const price = (args.priceOf ?? judgePriceOf)(args.modelId)
  if (price === undefined) {
    throw new JudgeUnpricedError(args.modelId)
  }
  if (
    !Number.isFinite(price.input) ||
    !Number.isFinite(price.output) ||
    price.input < 0 ||
    price.output < 0
  ) {
    throw new JudgeLedgerError('priced model has an unusable tariff')
  }
  const costUsd =
    (args.estimatedInputTokens * price.input + args.maxOutputTokens * price.output) /
    TOKENS_PER_MILLION
  if (!Number.isFinite(costUsd)) {
    throw new JudgeLedgerError('reservation cost is not finite')
  }
  return costUsd
}

/** Which conversation the call judges on. Phase 1 is these two backends. */
export type JudgeBackend = 'modelApi' | 'museCode'

/** Phase-1 engines: `auto` is `same` (lane J's resolver decides). */
export type JudgeAdmissionEngine = 'auto' | 'same'

/** Paid consent for the Model API `judge` feature (lane U owns the modal). */
export type JudgeAdmissionConsent = 'granted' | 'not-required' | 'needed' | 'declined'

/**
 * What a dispatch is bound to. After every wait (a held consent modal, a
 * delayed dispatch) the claim is re-bound to the current binding, and any
 * change refuses the dispatch while keeping the liability.
 */
export interface JudgeAdmissionBinding {
  readonly ownerId: string
  readonly backend: JudgeBackend
  readonly modelId: string
  /** Raw `museSpark.judge.engine` value; parsed here, unknown fails closed. */
  readonly engine: unknown
  readonly confidential: boolean
  readonly consent: JudgeAdmissionConsent
}

/**
 * One durable claim in the daily ledger. Settlement is idempotent by claim
 * id for the same value; a conflicting re-settle throws JudgeLedgerError.
 * A store failure throws JudgeLedgerError: fail closed, never forgiven.
 */
export interface JudgeLedgerClaim {
  readonly claimId: string
  readonly reservedUsd: number
  settle(actualCostUsd: number): Promise<void>
}

/**
 * D78's daily ledger as lane A requires it. The reservation is committed
 * durably before dispatch; `remainingUsd` already excludes open
 * reservations. A method throws JudgeLedgerError (or a ledger error this
 * module wraps) on an unreadable store, a lock failure or any other fault:
 * admission then refuses and settlement keeps the liability.
 */
export interface JudgeDailyLedger {
  remainingUsd(): Promise<number>
  reserve(costUsd: number): Promise<JudgeLedgerClaim>
}

/**
 * Where the call is billed. On the Model API the `judge` paid feature bills
 * each call to the Model API key through the daily ledger; on Muse Code the
 * subscription covers it and no claim is made.
 */
export type JudgeBilling =
  | { readonly kind: 'metered'; readonly ledger: JudgeDailyLedger }
  | { readonly kind: 'subscription' }

/** Why a call was not admitted. Reason codes, not user text: lane U says them. */
export type JudgeAdmissionRefusal =
  | 'binding-invalid'
  | 'consent-needed'
  | 'consent-declined'
  | 'unpriced'
  | 'over-budget'
  | 'ledger-unavailable'

export interface JudgeAdmissionRequest {
  readonly binding: JudgeAdmissionBinding
  readonly billing: JudgeBilling
  readonly estimatedInputTokens: number
  readonly maxOutputTokens: number
  readonly priceOf?: (modelId: string) => JudgeTokenPrices | undefined
}

/** Known token usage for a call that answered. */
export interface JudgeKnownUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  /** Cached input tokens, inside `inputTokens` (the Responses API convention). */
  readonly cachedTokens: number
}

/**
 * One admitted call. `settleKnown` settles the verified actual cost (cached
 * tokens discounted, as reported); `refundNonSend` settles zero for a call
 * known never sent. There is deliberately no third way out: a timeout, a
 * lost response or any other uncertain outcome keeps the full reservation
 * as liability by simply doing nothing.
 */
export interface JudgeAdmissionClaim {
  readonly claimId: string
  readonly reservedUsd: number
  readonly modelId: string
  /** The binding snapshot re-binding compares against after waits. */
  readonly binding: JudgeAdmissionBinding
  /** Whether a ledger claim backs this admission (`metered`) or not. */
  readonly billed: boolean
  /** The reservation while open, the settled cost once closed. */
  outstandingUsd(): number
  settleKnown(usage: JudgeKnownUsage): Promise<number>
  refundNonSend(): Promise<void>
}

export type JudgeAdmission =
  | { readonly admitted: true; readonly claim: JudgeAdmissionClaim }
  | { readonly admitted: false; readonly refusal: JudgeAdmissionRefusal }

const JUDGE_BACKENDS: ReadonlySet<unknown> = new Set(['modelApi', 'museCode'])
const JUDGE_ADMISSION_ENGINES: ReadonlySet<unknown> = new Set(['auto', 'same'])
const JUDGE_ADMISSION_CONSENTS: ReadonlySet<unknown> = new Set([
  'granted',
  'not-required',
  'needed',
  'declined',
])

function isJudgeBackend(value: unknown): value is JudgeBackend {
  return JUDGE_BACKENDS.has(value)
}

function isJudgeAdmissionEngine(value: unknown): value is JudgeAdmissionEngine {
  return JUDGE_ADMISSION_ENGINES.has(value)
}

function isJudgeAdmissionConsent(value: unknown): value is JudgeAdmissionConsent {
  return JUDGE_ADMISSION_CONSENTS.has(value)
}

function isValidBinding(binding: JudgeAdmissionBinding): boolean {
  return (
    binding.ownerId.length > 0 &&
    binding.modelId.length > 0 &&
    isJudgeBackend(binding.backend) &&
    isJudgeAdmissionEngine(binding.engine) &&
    isJudgeAdmissionConsent(binding.consent) &&
    typeof binding.confidential === 'boolean'
  )
}

function wrapLedgerError(error: unknown): JudgeLedgerError {
  return error instanceof JudgeLedgerError
    ? error
    : new JudgeLedgerError(error instanceof Error ? error.message : String(error))
}

interface ClaimState {
  settledUsd: number | undefined
  ledger: JudgeLedgerClaim | undefined
}

function createClaim(args: {
  readonly claimId: string
  readonly reservedUsd: number
  readonly modelId: string
  readonly binding: JudgeAdmissionBinding
  readonly priceOf: (modelId: string) => JudgeTokenPrices | undefined
  readonly ledger: JudgeLedgerClaim | undefined
}): JudgeAdmissionClaim {
  const state: ClaimState = { settledUsd: undefined, ledger: args.ledger }
  const closeAt = async (actualCostUsd: number): Promise<void> => {
    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) {
      throw new JudgeLedgerError('settlement cost is not a finite nonnegative amount')
    }
    if (state.settledUsd !== undefined) {
      if (state.settledUsd !== actualCostUsd) {
        throw new JudgeLedgerError(`claim ${args.claimId} is already settled`)
      }
      return
    }
    if (state.ledger !== undefined) {
      try {
        await state.ledger.settle(actualCostUsd)
      } catch (error: unknown) {
        throw wrapLedgerError(error)
      }
    }
    state.settledUsd = actualCostUsd
  }
  return {
    claimId: args.claimId,
    reservedUsd: args.reservedUsd,
    modelId: args.modelId,
    binding: { ...args.binding },
    billed: args.ledger !== undefined,
    outstandingUsd: () => state.settledUsd ?? args.reservedUsd,
    settleKnown: async (usage: JudgeKnownUsage): Promise<number> => {
      assertUsableCount(usage.inputTokens, 'settled input tokens')
      assertUsableCount(usage.outputTokens, 'settled output tokens')
      assertUsableCount(usage.cachedTokens, 'settled cached tokens')
      if (usage.cachedTokens > usage.inputTokens) {
        throw new TypeError('Judge admission settled cached tokens exceed input tokens')
      }
      if (args.priceOf(args.modelId) === undefined) {
        // The tariff vanished after admission: keep the liability rather
        // than settle a guessed cost.
        throw new JudgeLedgerError(
          `model ${args.modelId} lost its verified price before settlement`,
        )
      }
      const actualCostUsd = estimateCostUsd(usage, args.modelId)
      await closeAt(actualCostUsd)
      return actualCostUsd
    },
    refundNonSend: async (): Promise<void> => {
      await closeAt(0)
    },
  }
}

/**
 * Admit one judge call: reserve its worst-case uncached price before
 * dispatch. Fail-closed order: an invalid binding, a missing or declined
 * paid consent, an unpriced model, a call over the remaining budget, and an
 * unreadable ledger each refuse, and a refusal reserves nothing. A batch is
 * one call; a retry admits again for a new claim.
 */
export async function admitJudgeCall(request: JudgeAdmissionRequest): Promise<JudgeAdmission> {
  assertUsableCount(request.estimatedInputTokens, 'estimated input tokens')
  assertUsableCount(request.maxOutputTokens, 'max output tokens')
  if (!isValidBinding(request.binding)) {
    return { admitted: false, refusal: 'binding-invalid' }
  }
  if (
    (request.binding.backend === 'modelApi') !== (request.billing.kind === 'metered') ||
    (request.binding.backend === 'museCode') !== (request.billing.kind === 'subscription')
  ) {
    // A Model API call without a ledger claim would bill nothing; a Muse
    // Code call against the ledger would charge the subscription twice over.
    return { admitted: false, refusal: 'binding-invalid' }
  }
  if (request.binding.consent === 'needed') {
    return { admitted: false, refusal: 'consent-needed' }
  }
  if (request.binding.consent === 'declined') {
    return { admitted: false, refusal: 'consent-declined' }
  }
  const priceOf = request.priceOf ?? judgePriceOf
  let reservedUsd: number
  try {
    reservedUsd = worstCaseJudgeCostUsd({
      modelId: request.binding.modelId,
      estimatedInputTokens: request.estimatedInputTokens,
      maxOutputTokens: request.maxOutputTokens,
      priceOf,
    })
  } catch (error: unknown) {
    if (error instanceof JudgeUnpricedError) {
      return { admitted: false, refusal: 'unpriced' }
    }
    throw error
  }
  if (request.billing.kind === 'subscription') {
    return {
      admitted: true,
      claim: createClaim({
        claimId: randomUUID(),
        reservedUsd,
        modelId: request.binding.modelId,
        binding: request.binding,
        priceOf,
        ledger: undefined,
      }),
    }
  }
  const { ledger } = request.billing
  let remainingUsd: number
  try {
    remainingUsd = await ledger.remainingUsd()
  } catch {
    return { admitted: false, refusal: 'ledger-unavailable' }
  }
  if (!Number.isFinite(remainingUsd) || remainingUsd < 0) {
    // A ledger that reports nonsense is unreadable: fail closed.
    return { admitted: false, refusal: 'ledger-unavailable' }
  }
  if (reservedUsd > remainingUsd) {
    return { admitted: false, refusal: 'over-budget' }
  }
  let reserved: JudgeLedgerClaim
  try {
    reserved = await ledger.reserve(reservedUsd)
  } catch {
    return { admitted: false, refusal: 'ledger-unavailable' }
  }
  if (reserved.claimId.length === 0 || reserved.reservedUsd !== reservedUsd) {
    // The store answered with a claim that is not this reservation: it
    // cannot back the dispatch, so fail closed with the funds unheld.
    try {
      await reserved.settle(0)
    } catch {
      // The mismatched claim stays the ledger's liability, never ours to
      // spend: the dispatch is still refused.
    }
    return { admitted: false, refusal: 'ledger-unavailable' }
  }
  return {
    admitted: true,
    claim: createClaim({
      claimId: reserved.claimId,
      reservedUsd,
      modelId: request.binding.modelId,
      binding: request.binding,
      priceOf,
      ledger: reserved,
    }),
  }
}

/** Why a wait ended without a dispatch. Reason codes, not user text. */
export type JudgeRebindRefusal =
  | 'owner-changed'
  | 'backend-changed'
  | 'model-changed'
  | 'engine-changed'
  | 'confidential-changed'
  | 'consent-needed'
  | 'consent-declined'
  | 'already-settled'
  | 'ledger-unavailable'

/**
 * Re-bind a claim after a wait to the current owner, backend, model, engine,
 * confidential flag and consent. Pure: any change refuses, so the caller
 * keeps the liability (refunding only a known non-send) instead of
 * dispatching under a stale binding.
 */
export function rebindJudgeClaim(
  claim: JudgeAdmissionClaim,
  current: JudgeAdmissionBinding,
): { readonly rebound: true } | { readonly rebound: false; readonly reason: JudgeRebindRefusal } {
  if (!isValidBinding(current)) {
    return { rebound: false, reason: 'owner-changed' }
  }
  const before = claim.binding
  if (current.ownerId !== before.ownerId) {
    return { rebound: false, reason: 'owner-changed' }
  }
  if (current.backend !== before.backend) {
    return { rebound: false, reason: 'backend-changed' }
  }
  if (current.modelId !== before.modelId) {
    return { rebound: false, reason: 'model-changed' }
  }
  if (current.engine !== before.engine) {
    return { rebound: false, reason: 'engine-changed' }
  }
  if (current.confidential !== before.confidential) {
    return { rebound: false, reason: 'confidential-changed' }
  }
  if (current.consent === 'needed') {
    return { rebound: false, reason: 'consent-needed' }
  }
  return current.consent === 'declined'
    ? { rebound: false, reason: 'consent-declined' }
    : { rebound: true }
}

/**
 * The last check before dispatch, after every wait (a held consent modal, a
 * delayed batch): the binding is current, the claim is still open, and the
 * ledger is still reachable. Anything else refuses the dispatch; the
 * liability stays reserved until a known settlement or non-send refund.
 * Subscription claims need no ledger: pass none.
 */
export async function verifyJudgeDispatch(
  claim: JudgeAdmissionClaim,
  current: JudgeAdmissionBinding,
  ledger?: JudgeDailyLedger,
): Promise<
  { readonly proceed: true } | { readonly proceed: false; readonly reason: JudgeRebindRefusal }
> {
  const rebound = rebindJudgeClaim(claim, current)
  if (!rebound.rebound) {
    return { proceed: false, reason: rebound.reason }
  }
  if (claim.outstandingUsd() !== claim.reservedUsd) {
    return { proceed: false, reason: 'already-settled' }
  }
  if (!claim.billed) {
    return { proceed: true }
  }
  if (ledger === undefined) {
    return { proceed: false, reason: 'ledger-unavailable' }
  }
  try {
    await ledger.remainingUsd()
  } catch {
    return { proceed: false, reason: 'ledger-unavailable' }
  }
  return { proceed: true }
}

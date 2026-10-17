import { Usd, usdAmountSchema, type UsdAmount } from '../../shared/usd'
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
import { MODEL_API_PRICES_PER_MILLION, TOKENS_PER_MILLION } from '../../shared/constants'
import { modelApiPaidTier } from '../../shared/paid'

/** Per-million-token prices a reservation is computed from. */
export interface JudgeTokenPrices {
  readonly input: UsdAmount
  readonly cachedInput: UsdAmount
  readonly output: UsdAmount
}

/**
 * The verified tariff for a model, or undefined when the extension knows no
 * price for it. Unpriced models are refused, never estimated (a suffix
 * display fallback is not a verified tariff or capped spending).
 */
export function judgePriceOf(modelId: string): JudgeTokenPrices | undefined {
  const tier = modelApiPaidTier(modelId)
  if (tier === undefined) return undefined
  const prices = MODEL_API_PRICES_PER_MILLION[tier]
  return {
    input: Usd.from(prices.input).toAmount(),
    cachedInput: Usd.from(prices.cachedInput).toAmount(),
    output: Usd.from(prices.output).toAmount(),
  }
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

function verifiedPrices(
  modelId: string,
  priceOf: (modelId: string) => JudgeTokenPrices | undefined,
): JudgeTokenPrices {
  const price = priceOf(modelId)
  if (price === undefined) {
    throw new JudgeUnpricedError(modelId)
  }
  for (const rate of [price.input, price.cachedInput, price.output]) {
    if (!usdAmountSchema.safeParse(rate).success || Usd.from(rate).compare(Usd.from(0)) < 0) {
      throw new JudgeLedgerError('priced model has an unusable tariff')
    }
  }
  return price
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
}): UsdAmount {
  assertUsableCount(args.estimatedInputTokens, 'estimated input tokens')
  assertUsableCount(args.maxOutputTokens, 'max output tokens')
  if (args.maxOutputTokens < 1) {
    throw new TypeError('Judge admission max output tokens must be at least 1')
  }
  const price = verifiedPrices(args.modelId, args.priceOf ?? judgePriceOf)
  return Usd.from(price.input)
    .times(args.estimatedInputTokens)
    .add(Usd.from(price.output).times(args.maxOutputTokens))
    .divide(TOKENS_PER_MILLION)
    .toAmount()
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
interface JudgeBindingIdentity {
  readonly ownerId: string
  readonly modelId: string
  /** Raw `museSpark.judge.engine` value; parsed here, unknown fails closed. */
  readonly engine: unknown
  readonly confidential: boolean
}

export type JudgeAdmissionBinding = JudgeBindingIdentity &
  (
    | {
        readonly backend: 'modelApi'
        readonly consent: Exclude<JudgeAdmissionConsent, 'not-required'>
      }
    | { readonly backend: 'museCode'; readonly consent: JudgeAdmissionConsent }
  )

/**
 * One durable claim in the daily ledger. Settlement is idempotent by claim
 * id for the same value; a conflicting re-settle throws JudgeLedgerError.
 * A store failure throws JudgeLedgerError: fail closed, never forgiven.
 */
export interface JudgeLedgerClaim {
  readonly claimId: string
  readonly reservedUsd: UsdAmount
  /** D78's synchronous guard: current cap/day/stop/cancellation and claim validity. */
  check(): void
  settle(actualCostUsd: UsdAmount): Promise<void>
}

/**
 * D78's daily ledger as lane A requires it. The reservation is committed
 * durably before dispatch; `remainingUsd` already excludes open
 * reservations. A method throws JudgeLedgerError (or a ledger error this
 * module wraps) on an unreadable store, a lock failure or any other fault:
 * admission then refuses and settlement keeps the liability.
 */
export interface JudgeDailyLedger {
  remainingUsd(): Promise<UsdAmount>
  reserve(costUsd: UsdAmount): Promise<JudgeLedgerClaim>
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
  /** Read replaced session/consent state after waits; defaults to the supplied binding. */
  readonly currentBinding?: () => JudgeAdmissionBinding
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
  readonly reservedUsd: UsdAmount
  readonly modelId: string
  /** The binding snapshot re-binding compares against after waits. */
  readonly binding: JudgeAdmissionBinding
  /** Whether a ledger claim backs this admission (`metered`) or not. */
  readonly billed: boolean
  /** Closure belongs to this claim id; equal dollar amounts never mean open. */
  status(): 'open' | 'settling' | 'settled' | 'refunded'
  /** Synchronous final guard; call again if the sender waits after verification. */
  check(): void
  /** The reservation while open, the settled cost once closed. */
  outstandingUsd(): UsdAmount
  settleKnown(usage: JudgeKnownUsage): Promise<UsdAmount>
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

function consentRefusal(
  backend: JudgeBackend,
  consent: JudgeAdmissionConsent,
): 'consent-needed' | 'consent-declined' | undefined {
  if (consent === 'declined') return 'consent-declined'
  return consent === 'needed' || (backend === 'modelApi' && consent !== 'granted')
    ? 'consent-needed'
    : undefined
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
  status: ReturnType<JudgeAdmissionClaim['status']>
  settledUsd: UsdAmount | undefined
  settlingCost: UsdAmount | undefined
  settling: Promise<void> | undefined
}

function createClaim(args: {
  readonly claimId: string
  readonly reservedUsd: UsdAmount
  readonly modelId: string
  readonly binding: JudgeAdmissionBinding
  readonly priceOf: (modelId: string) => JudgeTokenPrices | undefined
  readonly ledger: JudgeLedgerClaim | undefined
}): JudgeAdmissionClaim {
  const state: ClaimState = {
    status: 'open',
    settledUsd: undefined,
    settlingCost: undefined,
    settling: undefined,
  }
  const closeAt = async (actualCostUsd: UsdAmount): Promise<void> => {
    if (
      !usdAmountSchema.safeParse(actualCostUsd).success ||
      Usd.from(actualCostUsd).compare(Usd.from(0)) < 0
    ) {
      throw new JudgeLedgerError('settlement cost is not a finite nonnegative amount')
    }
    if (state.status === 'settled' || state.status === 'refunded') {
      if (state.settledUsd !== actualCostUsd) {
        throw new JudgeLedgerError(`claim ${args.claimId} is already settled`)
      }
      return
    }
    if (state.settlingCost !== undefined && state.settlingCost !== actualCostUsd) {
      throw new JudgeLedgerError(`claim ${args.claimId} has a conflicting settlement`)
    }
    // Close admission synchronously, before a store wait can race dispatch.
    // A failed write keeps both the liability and this dispatch prohibition.
    state.status = 'settling'
    state.settlingCost = actualCostUsd
    state.settling ??= (async () => {
      if (args.ledger !== undefined) {
        await args.ledger.settle(actualCostUsd)
      }
      state.settledUsd = actualCostUsd
      state.status = actualCostUsd === '0' ? 'refunded' : 'settled'
    })()
    const pending = state.settling
    try {
      await pending
    } catch (error: unknown) {
      throw wrapLedgerError(error)
    } finally {
      if (state.settling === pending) state.settling = undefined
    }
  }
  return {
    claimId: args.claimId,
    reservedUsd: args.reservedUsd,
    modelId: args.modelId,
    binding: { ...args.binding },
    billed: args.ledger !== undefined,
    status: () => state.status,
    check: () => {
      if (state.status !== 'open') {
        throw new JudgeLedgerError(`claim ${args.claimId} is already closing or closed`)
      }
      args.ledger?.check()
    },
    outstandingUsd: () => state.settledUsd ?? args.reservedUsd,
    settleKnown: async (usage: JudgeKnownUsage): Promise<UsdAmount> => {
      assertUsableCount(usage.inputTokens, 'settled input tokens')
      assertUsableCount(usage.outputTokens, 'settled output tokens')
      assertUsableCount(usage.cachedTokens, 'settled cached tokens')
      if (usage.cachedTokens > usage.inputTokens) {
        throw new TypeError('Judge admission settled cached tokens exceed input tokens')
      }
      // Use the same verified source as reservation, including its cache
      // rate. A missing tariff throws JudgeUnpricedError and keeps liability.
      const price = verifiedPrices(args.modelId, args.priceOf)
      const actualCostUsd = Usd.from(price.input)
        .times(usage.inputTokens - usage.cachedTokens)
        .add(Usd.from(price.cachedInput).times(usage.cachedTokens))
        .add(Usd.from(price.output).times(usage.outputTokens))
        .divide(TOKENS_PER_MILLION)
        .toAmount()
      await closeAt(actualCostUsd)
      return actualCostUsd
    },
    refundNonSend: async (): Promise<void> => {
      await closeAt(Usd.from(0).toAmount())
    },
  }
}

/**
 * Admit one judge call: reserve its worst-case uncached price before
 * dispatch. Fail-closed order: an invalid binding, a missing or declined
 * paid consent, an unpriced model, a call over the remaining budget, and an
 * unreadable ledger each refuse. Any owned known nonsent reservation is
 * refunded on refusal; a failed refund retains liability. A batch is one
 * call; a retry admits again for a new claim.
 */
export async function admitJudgeCall(request: JudgeAdmissionRequest): Promise<JudgeAdmission> {
  assertUsableCount(request.estimatedInputTokens, 'estimated input tokens')
  assertUsableCount(request.maxOutputTokens, 'max output tokens')
  const before = { ...request.binding }
  const readBinding = request.currentBinding ?? (() => request.binding)
  const bindingRefusal = (): JudgeAdmissionRefusal | undefined => {
    const rebound = rebindBinding(before, readBinding())
    if (rebound.rebound) return
    return rebound.reason === 'consent-needed' || rebound.reason === 'consent-declined'
      ? rebound.reason
      : 'binding-invalid'
  }
  if (!isValidBinding(before)) {
    return { admitted: false, refusal: 'binding-invalid' }
  }
  if (
    (before.backend === 'modelApi') !== (request.billing.kind === 'metered') ||
    (before.backend === 'museCode') !== (request.billing.kind === 'subscription')
  ) {
    // A Model API call without a ledger claim would bill nothing; a Muse
    // Code call against the ledger would charge the subscription twice over.
    return { admitted: false, refusal: 'binding-invalid' }
  }
  const initialRefusal = bindingRefusal()
  if (initialRefusal !== undefined) {
    return { admitted: false, refusal: initialRefusal }
  }
  const priceOf = request.priceOf ?? judgePriceOf
  let reservedUsd: UsdAmount
  try {
    reservedUsd = worstCaseJudgeCostUsd({
      modelId: before.modelId,
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
        modelId: before.modelId,
        binding: before,
        priceOf,
        ledger: undefined,
      }),
    }
  }
  const { ledger } = request.billing
  let remainingUsd: UsdAmount
  try {
    remainingUsd = await ledger.remainingUsd()
  } catch {
    return { admitted: false, refusal: 'ledger-unavailable' }
  }
  const afterRemaining = bindingRefusal()
  if (afterRemaining !== undefined) return { admitted: false, refusal: afterRemaining }
  if (
    !usdAmountSchema.safeParse(remainingUsd).success ||
    Usd.from(remainingUsd).compare(Usd.from(0)) < 0
  ) {
    // A ledger that reports nonsense is unreadable: fail closed.
    return { admitted: false, refusal: 'ledger-unavailable' }
  }
  if (Usd.from(reservedUsd).compare(Usd.from(remainingUsd)) > 0) {
    return { admitted: false, refusal: 'over-budget' }
  }
  let reserved: JudgeLedgerClaim
  try {
    reserved = await ledger.reserve(reservedUsd)
  } catch {
    return { admitted: false, refusal: 'ledger-unavailable' }
  }
  let refusal = bindingRefusal()
  if (refusal === undefined) {
    try {
      if (reserved.claimId.length === 0 || reserved.reservedUsd !== reservedUsd) {
        throw new JudgeLedgerError('store returned a mismatched reservation')
      }
      // A competing reservation, lowered cap, new day or Stop can invalidate
      // an earlier remainingUsd read. Only D78's per-claim guard admits it.
      reserved.check()
    } catch {
      refusal = 'ledger-unavailable'
    }
  }
  if (refusal !== undefined) {
    // We own a known nonsent reservation even if its final guard refused it.
    try {
      await reserved.settle(Usd.from(0).toAmount())
    } catch {
      return { admitted: false, refusal: 'ledger-unavailable' }
    }
    return { admitted: false, refusal: bindingRefusal() ?? refusal }
  }
  return {
    admitted: true,
    claim: createClaim({
      claimId: reserved.claimId,
      reservedUsd,
      modelId: before.modelId,
      binding: before,
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
  return rebindBinding(claim.binding, current)
}

function rebindBinding(
  before: JudgeAdmissionBinding,
  current: JudgeAdmissionBinding,
): ReturnType<typeof rebindJudgeClaim> {
  if (!isValidBinding(current)) {
    return { rebound: false, reason: 'owner-changed' }
  }
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
  const refusal = consentRefusal(current.backend, current.consent)
  return refusal === undefined ? { rebound: true } : { rebound: false, reason: refusal }
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
  current: JudgeAdmissionBinding | (() => JudgeAdmissionBinding),
  ledger?: JudgeDailyLedger,
): Promise<
  { readonly proceed: true } | { readonly proceed: false; readonly reason: JudgeRebindRefusal }
> {
  const readBinding = typeof current === 'function' ? current : () => current
  const rebound = rebindJudgeClaim(claim, readBinding())
  if (!rebound.rebound) {
    return { proceed: false, reason: rebound.reason }
  }
  if (claim.status() !== 'open') {
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
  const afterWait = rebindJudgeClaim(claim, readBinding())
  if (!afterWait.rebound) return { proceed: false, reason: afterWait.reason }
  if (claim.status() !== 'open') return { proceed: false, reason: 'already-settled' }
  try {
    claim.check()
  } catch {
    return { proceed: false, reason: 'ledger-unavailable' }
  }
  return { proceed: true }
}

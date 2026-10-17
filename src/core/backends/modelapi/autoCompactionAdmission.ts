// C-M101-1: paid consent and per-attempt daily claims shared by editor and runtime.
import { Usd, type UsdAmount } from '../../../shared/usd'
import { MODEL_API_PRICES_PER_MILLION, TOKENS_PER_MILLION } from '../../../shared/constants'
import { modelApiPaidTier } from '../../../shared/paid'
import { estimateCostUsd } from '../../usage/insights'
import type { CoreLogger } from '../../logging'
import type { reserveRequestAmount } from '../../providers/priceCard'
import type { requestImageCount } from './modelPolicy'
import type { AutoCompactModel } from './autoCompact'
import { AutoCompactionNotAuthorizedError } from '../../paid/autoCompactionError'
import type { ModelApiHostDeps } from './ModelApiHost'
import type { CreateResponseBody, Usage } from './schemas'

/**
 * Meta catalogue rates for the cost model, projected to exact per-token
 * money like every other catalogue quote; anything else is unpriced there.
 */
function perTokenUsd(amount: UsdAmount): number {
  return Number(Usd.from(amount).divide(TOKENS_PER_MILLION).toString())
}

export function resolveAutoCompactModel(modelId: string): AutoCompactModel | undefined {
  const tier = modelApiPaidTier(modelId)
  if (tier === undefined) return undefined
  const million = MODEL_API_PRICES_PER_MILLION[tier]
  return {
    pricing: {
      kind: 'priced',
      card: {
        input: perTokenUsd(million.input),
        cachedInput: perTokenUsd(million.cachedInput),
        output: perTokenUsd(million.output),
        source: 'catalogue',
      },
    },
  }
}

/** The D78 daily claim behind one automatic compaction, in either manager. */
export interface AutoCompactionLedgerClaim {
  readonly reservedUsd: UsdAmount
  /** Synchronous final admission; refuses an over-cap or stopped ledger. */
  check(): void
  settle(actualCostUsd: UsdAmount, hasUnknownCost: boolean): Promise<unknown>
}

/** Amount-based daily reserve; a refusal (over cap, stopped, unreadable) throws. */
export interface AutoCompactionLedger {
  reserveCompaction(
    amount: UsdAmount,
    signal: AbortSignal,
  ): Promise<AutoCompactionLedgerClaim | undefined>
}

/** Supplied by the backend and providers bundles when the first attempt prepares. */
export interface AutoCompactionPricing {
  readonly reserveRequestAmount: typeof reserveRequestAmount
  readonly requestImageCount: typeof requestImageCount
}

export interface AutoCompactionAdmissionDeps {
  /** Missing pricing refuses admission; a failed load cannot dispatch a request. */
  readonly loadPricing?: () => Promise<AutoCompactionPricing | undefined>
  /** Runtime transport already owns the daily claim for every HTTP attempt. */
  readonly accounting: AutoCompactionLedger | 'transport'
  readonly allowsPaidUse: ModelApiHostDeps['allowsPaidUse']
  readonly isOn: () => boolean
  readonly isTrusted: () => boolean
  readonly isEvaluated: () => boolean
  /** Captured before consent; revocation invalidates the entire admitted use. */
  readonly paidUseFence: (sessionId: string) => () => boolean
  readonly dailyBudgetUsd: () => UsdAmount | Promise<UsdAmount>
  readonly notePaidUse: ModelApiHostDeps['notePaidUse']
  readonly log: CoreLogger
  /** `UI_TEXT.sessionBudgetStoreUnavailable` in the installed language. */
  readonly storeUnavailable: string
}

type AdmitAutoCompaction = NonNullable<ModelApiHostDeps['admitAutoCompaction']>

function reserveAmountUsd(
  model: AutoCompactModel,
  body: CreateResponseBody,
  inputTokens: number,
  pricing: AutoCompactionPricing | undefined,
): UsdAmount | undefined {
  if (
    pricing === undefined ||
    model.pricing.kind !== 'priced' ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    !Number.isSafeInteger(body.max_output_tokens) ||
    body.max_output_tokens < 0 ||
    body.tools.some((tool) => tool.type === 'web_search')
  )
    return undefined
  try {
    return Usd.from(
      pricing.reserveRequestAmount(model.pricing.card, {
        inputTokens,
        outputTokens: body.max_output_tokens,
      }),
    )
      .add(Usd.from(model.pricing.card.image ?? 0).times(pricing.requestImageCount(body)))
      .toAmount()
  } catch {
    return undefined
  }
}

/** Exact cost of returned usage, or the retained reservation when unknown. */
function settleAmount(
  modelId: string,
  usage: Usage | undefined,
  outcome: 'returned' | 'uncertain' | 'rate-limited',
  reservedUsd: UsdAmount,
): { readonly amount: UsdAmount; readonly hasUnknownCost: boolean } {
  // A rate-limited attempt was refused before doing billed work: a known nonsend.
  if (outcome === 'rate-limited') return { amount: Usd.from(0).toAmount(), hasUnknownCost: false }
  if (usage === undefined) return { amount: reservedUsd, hasUnknownCost: true }
  try {
    return {
      amount: estimateCostUsd(
        {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        },
        modelId,
      ),
      hasUnknownCost: false,
    }
  } catch {
    return { amount: reservedUsd, hasUnknownCost: true }
  }
}

/** Consent once per use; reserve/recheck/settle each HTTP attempt before further spending. */
export function createAutoCompactionAdmission(
  deps: AutoCompactionAdmissionDeps,
): AdmitAutoCompaction {
  return async ({ signal, model, modelId, sessionId }) => {
    const isAvailable = () => deps.isOn() && deps.isTrusted() && deps.isEvaluated()
    if (signal.aborted || !isAvailable() || deps.loadPricing === undefined) return
    // Only the verified catalogue is settled here; BYO tariffs belong to C-M101-4.
    if (model.pricing.kind !== 'priced' || modelApiPaidTier(modelId) === undefined) return
    const beforeConsent = deps.paidUseFence(sessionId)
    let isConsentCurrent = beforeConsent
    const checkAuthorization = () => {
      signal.throwIfAborted()
      if (!isAvailable() || !isConsentCurrent()) throw new AutoCompactionNotAuthorizedError()
    }
    const dailyBudgetUsd = await deps.dailyBudgetUsd()
    signal.throwIfAborted()
    const paidDecision = await deps.allowsPaidUse(
      { feature: 'autoCompaction', modelId, dailyBudgetUsd },
      false,
      sessionId,
    )
    signal.throwIfAborted()
    if (paidDecision !== true || !isAvailable() || !isConsentCurrent()) return
    const acceptedConsent = deps.paidUseFence(sessionId)
    isConsentCurrent = () => beforeConsent() && acceptedConsent()
    let claim: AutoCompactionLedgerClaim | undefined
    let didSend = false
    let hasFailed = false
    let pending: Promise<void> = Promise.resolve()
    const settle = (
      sentModelId: string,
      usage: Usage | undefined,
      outcome: 'returned' | 'uncertain' | 'rate-limited',
    ): Promise<void> => {
      const owned = claim
      claim = undefined
      const wasSent = didSend
      didSend = false
      if (owned === undefined) return pending
      const { amount, hasUnknownCost } = wasSent
        ? settleAmount(sentModelId, usage, outcome, owned.reservedUsd)
        : { amount: Usd.from(0).toAmount(), hasUnknownCost: false }
      pending = (async () => {
        try {
          await owned.settle(amount, hasUnknownCost)
        } catch (error: unknown) {
          hasFailed = true
          deps.log.warn('Automatic compaction could not settle its ledger claim')
          throw new Error(deps.storeUnavailable, { cause: error })
        }
      })()
      // Cleanup/retry awaits the same write; observe rejections even when Stop wins.
      void pending.catch(() => {
        /* Cleanup owns the rejected write. */
      })
      return pending
    }
    const guard = Object.assign(
      () => {
        checkAuthorization()
        if (hasFailed) throw new Error(deps.storeUnavailable)
        if (claim === undefined && deps.accounting !== 'transport')
          throw new Error(deps.storeUnavailable)
        claim?.check()
      },
      {
        prepareRequest: async (body: CreateResponseBody, inputTokens: number) => {
          await settle(modelId, undefined, 'uncertain')
          checkAuthorization()
          if (hasFailed || body.model !== modelId) throw new Error(deps.storeUnavailable)
          const pricing = await deps.loadPricing?.()
          checkAuthorization()
          const reserveUsd = reserveAmountUsd(model, body, inputTokens, pricing)
          if (reserveUsd === undefined) throw new Error(deps.storeUnavailable)
          if (deps.accounting === 'transport') return
          claim = await deps.accounting.reserveCompaction(reserveUsd, signal)
          if (claim === undefined) throw new Error(deps.storeUnavailable)
          try {
            checkAuthorization()
          } catch (error: unknown) {
            await settle(modelId, undefined, 'uncertain')
            throw error
          }
        },
        onRequestStarted: () => {
          didSend = true
          deps.notePaidUse('autoCompaction', 1)
        },
      },
    )
    return {
      guard,
      settle,
      close: () => settle(modelId, undefined, 'uncertain'),
    }
  }
}

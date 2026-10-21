import { SpendLedgerError } from '../../paid/spendLedgerError'
import type { SpendClaim } from '../../paid/spendClaim'
// C-M101-1: paid consent and, under a person-set daily limit (D208), per-attempt
// daily claims shared by editor and runtime.
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
Meta catalogue rates for the cost model, projected to exact per-token
money like every other catalogue quote; anything else is unpriced there.
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

/**
The daily limit behind automatic compaction: a claim under the limit the
person set, `undefined` when none is set (nothing is checked); a refusal
(over the limit, stopped, unreadable) throws.
*/
export interface AutoCompactionLedger {
  reserveCompaction(amount: UsdAmount, signal: AbortSignal): Promise<SpendClaim | undefined>
}

/** Supplied by the backend and providers bundles when the first attempt prepares. */
export interface AutoCompactionPricing {
  readonly reserveRequestAmount: typeof reserveRequestAmount
  readonly requestImageCount: typeof requestImageCount
}

export interface AutoCompactionAdmissionDeps {
  /** Missing pricing refuses admission; a failed load cannot dispatch a request. */
  readonly loadPricing?: () => Promise<AutoCompactionPricing | undefined>
  /** The runtime transport already checks a daily limit for every HTTP attempt. */
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
        inputTokens: Buffer.byteLength(JSON.stringify(body), 'utf8'),
        outputTokens: body.max_output_tokens,
      }),
    )
      .add(Usd.from(model.pricing.card.image ?? 0).times(pricing.requestImageCount(body)))
      .toAmount()
  } catch {
    return undefined
  }
}

/** Exact cost of returned usage; `undefined` (cost unknown) without it, never an estimate. */
function settleAmount(
  modelId: string,
  usage: Usage | undefined,
  outcome: 'returned' | 'uncertain' | 'refused',
): UsdAmount | undefined {
  // An initial provider refusal did no billed work: known zero cost.
  if (outcome === 'refused') return Usd.from(0).toAmount()
  if (usage === undefined) return undefined
  try {
    return estimateCostUsd(
      {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      },
      modelId,
    )
  } catch {
    return undefined
  }
}

/** Consent once per use; under a daily limit, check/settle each HTTP attempt. */
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
    let claim: SpendClaim | undefined
    let didSend = false
    let hasFailed = false
    let pending: Promise<void> = Promise.resolve()
    const settle = (
      sentModelId: string,
      usage: Usage | undefined,
      outcome: 'returned' | 'uncertain' | 'refused',
    ): Promise<void> => {
      const owned = claim
      claim = undefined
      const wasSent = didSend
      didSend = false
      if (owned === undefined) return pending
      const costUsd = wasSent ? settleAmount(sentModelId, usage, outcome) : Usd.from(0).toAmount()
      pending = (async () => {
        try {
          await owned.settle(costUsd)
        } catch (error: unknown) {
          hasFailed = true
          deps.log.warn('Automatic compaction could not settle its ledger claim')
          throw error
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
        if (hasFailed)
          throw new SpendLedgerError('integrity', {
            scope: 'session',
            file: 'compaction admission',
          })
        claim?.check()
      },
      {
        prepareRequest: async (body: CreateResponseBody, inputTokens: number) => {
          await settle(modelId, undefined, 'uncertain')
          checkAuthorization()
          if (hasFailed || body.model !== modelId)
            throw new SpendLedgerError('integrity', {
              scope: 'session',
              file: 'compaction admission',
            })
          const pricing = await deps.loadPricing?.()
          checkAuthorization()
          const reserveUsd = reserveAmountUsd(model, body, inputTokens, pricing)
          if (reserveUsd === undefined)
            throw new SpendLedgerError('integrity', {
              scope: 'session',
              file: 'compaction admission',
            })
          if (deps.accounting === 'transport') return
          claim = await deps.accounting.reserveCompaction(reserveUsd, signal)
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

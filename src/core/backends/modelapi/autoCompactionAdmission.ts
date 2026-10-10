// C-M101-1: paid consent and per-attempt daily claims shared by editor and runtime.
import { Usd, type UsdAmount } from '../../../shared/usd'
import { MODEL_API_PRICES_PER_MILLION, TOKENS_PER_MILLION } from '../../../shared/constants'
import { modelApiPaidTier } from '../../../shared/paid'
import { estimateCostUsd } from '../../usage/insights'
import type { CoreLogger } from '../../logging'
import type { AutoCompactDecision, AutoCompactModel } from './autoCompact'
import type { ModelApiHostDeps } from './ModelApiHost'
import type { Usage } from './schemas'

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

export interface AutoCompactionAdmissionDeps {
  /** Runtime transport already owns the daily claim for every HTTP attempt. */
  readonly accounting: AutoCompactionLedger | 'transport'
  readonly allowsPaidUse: ModelApiHostDeps['allowsPaidUse']
  readonly isOn: () => boolean
  readonly dailyBudgetUsd: () => UsdAmount | Promise<UsdAmount>
  readonly notePaidUse: ModelApiHostDeps['notePaidUse']
  readonly log: CoreLogger
  /** `UI_TEXT.sessionBudgetStoreUnavailable` in the installed language. */
  readonly storeUnavailable: string
}

type AdmitAutoCompaction = NonNullable<ModelApiHostDeps['admitAutoCompaction']>

function reserveAmountUsd(
  model: AutoCompactModel,
  decision: AutoCompactDecision,
): UsdAmount | undefined {
  if (model.pricing.kind !== 'priced') return Usd.from(0).toAmount()
  const { newDebt } = decision
  if (typeof newDebt !== 'number' || !Number.isFinite(newDebt) || newDebt < 0) return undefined
  try {
    return Usd.from(newDebt).toAmount()
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
  return async ({ signal, model, decision, modelId, sessionId }) => {
    if (signal.aborted || !deps.isOn()) return
    const reserveUsd = reserveAmountUsd(model, decision)
    // A corrupt projection or missing tariff cannot authorize a paid extra.
    if (reserveUsd === undefined || model.pricing.kind !== 'priced') return
    const dailyBudgetUsd = await deps.dailyBudgetUsd()
    signal.throwIfAborted()
    const paidDecision = await deps.allowsPaidUse(
      { feature: 'autoCompaction', modelId, dailyBudgetUsd },
      false,
      sessionId,
    )
    signal.throwIfAborted()
    if (paidDecision !== true || !deps.isOn()) return
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
        signal.throwIfAborted()
        if (hasFailed) throw new Error(deps.storeUnavailable)
        if (!deps.isOn()) throw new Error(deps.storeUnavailable)
        if (claim === undefined && deps.accounting !== 'transport')
          throw new Error(deps.storeUnavailable)
        claim?.check()
      },
      {
        prepare: async () => {
          await settle(modelId, undefined, 'uncertain')
          signal.throwIfAborted()
          if (hasFailed || !deps.isOn()) throw new Error(deps.storeUnavailable)
          if (deps.accounting === 'transport') return
          claim = await deps.accounting.reserveCompaction(reserveUsd, signal)
          if (claim === undefined) throw new Error(deps.storeUnavailable)
          if (!signal.aborted) return
          await settle(modelId, undefined, 'uncertain')
          signal.throwIfAborted()
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

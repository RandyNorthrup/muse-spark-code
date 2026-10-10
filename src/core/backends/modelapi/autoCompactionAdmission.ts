// C-M101-1: one shared D78 gate and ledger for automatic compaction.
//
// `ModelApiHost` decides and sends compaction itself, but every automatic
// attempt must pass a production admission (`admitAutoCompaction`) and read
// its cost-model rates from a production reader (`autoCompactModel`). Both
// managers (the panel's `modelApiBackendManager.ts` and the runtime's
// `backends.ts`, covering VS Code, ACP, exec and the panel) bind the two
// functions here, so every editor admits the same way on every OS.
//
// Gate: fail closed. No reservation means zero dispatches: a refused or
// unreadable daily ledger declines the cost path, an aborted admission
// refunds its claim, and the returned guard rechecks the claim
// synchronously at send (D78: reserve before dispatch, recheck at send).
// The M82 account/key/budget/final-send fences still run on each extra POST
// inside the host's own composed guard.
//
// Ledger: settle known usage at its exact cost (M121 exact money), refund
// known nonsends, and retain the reservation with an unknown-cost mark when
// no usage came back. A settlement failure is flagged so the next guard
// check ends the turn on the ledger-unavailable error instead of spending
// blind. Cost-model protection (near-window and overflow) is never blocked
// by economics: when the ledger refuses there, admission still succeeds
// with a tally-only claim, exactly like a manual `/compact`.
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
  readonly ledger: AutoCompactionLedger
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

/**
 * The production `admitAutoCompaction`: one D78 reserve per automatic
 * compaction, one synchronous recheck per send, one settlement per attempt.
 * Undefined means declined: the host then sends no extra request.
 */
export function createAutoCompactionAdmission(
  deps: AutoCompactionAdmissionDeps,
): AdmitAutoCompaction {
  return async ({ signal, model, decision }) => {
    if (signal.aborted) return
    // Only the cost path can wait for money; protection compacts regardless.
    const isProtection = decision.reason !== 'cost'
    const reserveUsd = reserveAmountUsd(model, decision)
    if (reserveUsd === undefined && !isProtection) return
    let claim: AutoCompactionLedgerClaim | undefined
    if (reserveUsd !== undefined) {
      try {
        signal.throwIfAborted()
        claim = await deps.ledger.reserveCompaction(reserveUsd, signal)
      } catch {
        deps.log.warn('Automatic compaction was refused by the daily ledger')
        claim = undefined
      }
    }
    try {
      signal.throwIfAborted()
    } catch {
      // The reservation never became a dispatch: refund it before declining.
      // A throw here is the abort racing the reserve, not a ledger failure.
      try {
        await claim?.settle(Usd.from(0).toAmount(), false)
      } catch {
        deps.log.warn('Automatic compaction could not refund its ledger claim')
      }
      return
    }
    // Economics never block near-window or overflow protection; the M82
    // per-send fences still run on each extra POST inside the host.
    if (claim === undefined && !isProtection) return
    let hasSettleFailed = false
    return {
      guard: () => {
        if (hasSettleFailed) throw new Error(deps.storeUnavailable)
        claim?.check()
      },
      settle: (sentModelId, usage, outcome) => {
        // Without a journal row (protection admitted past a refused
        // ledger) there is nothing to settle; the M82 fences still ran.
        if (claim === undefined) return
        const { amount, hasUnknownCost } = settleAmount(
          sentModelId,
          usage,
          outcome,
          claim.reservedUsd,
        )
        try {
          const settled = claim.settle(amount, hasUnknownCost)
          if (settled instanceof Promise) {
            void settled.catch(() => {
              hasSettleFailed = true
              deps.log.warn('Automatic compaction could not settle its ledger claim')
            })
          }
        } catch {
          hasSettleFailed = true
        }
      },
    }
  }
}

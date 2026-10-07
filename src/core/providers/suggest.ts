// The local suggestion engine (M95, PLAN.md D74): `suggest(kind, context)`
// returns `{value, reason}` from local facts only — the vendored or fetched
// catalogues and the user's own history (M82's local tallies), never the
// network. M95 implements `defaultModel` and `sessionBudget`; M96 adds
// `roleModel` and `roleBudget` beside them. Every value carries its reason,
// and the panel shows **Accept** or **Change**. Pure.

import {
  HARNESS_MIN_CONTEXT_TOKENS,
  SUGGEST_REFERENCE_SESSION_INPUT_TOKENS,
  SUGGEST_REFERENCE_SESSION_OUTPUT_TOKENS,
} from '../../shared/constants'
import { fill, formatUsd, UI_TEXT } from '../../shared/l10n/text'
import { reserveRequestUsd, type PriceCard } from './priceCard'

/** The suggestion kinds M95 implements (M96 adds role kinds beside them). */
export type SuggestKind = 'defaultModel' | 'sessionBudget'

/** One model the engine may suggest, from a scan joined with prices. */
export interface SuggestModel {
  readonly ref: string
  readonly toolCalling: boolean
  readonly contextTokens?: number | undefined
  /** USD per token; absent means unpriced (never suggested as cheapest). */
  readonly inputUsd?: number | undefined
  readonly outputUsd?: number | undefined
  readonly recommended?: boolean | undefined
  /** The catalogue marks Together's serverless models; others default so. */
  readonly serverless?: boolean | undefined
}

export interface SuggestContext {
  readonly models: readonly SuggestModel[]
  /** The median of the user's own recent sessions, in USD (M82's tallies). */
  readonly historyMedianUsd?: number | undefined
  /** The default chosen last time, when there was one. */
  readonly lastDefaultRef?: string | undefined
}

export interface Suggestion<T> {
  readonly kind: SuggestKind
  readonly value: T
  /** Why, in plain words (localized at use time). */
  readonly reason: string
}

/** Whether the model can serve as a default: tools, room, priced, runnable. */
export function isDefaultCapable(model: SuggestModel): boolean {
  return (
    model.toolCalling &&
    (model.contextTokens ?? 0) >= HARNESS_MIN_CONTEXT_TOKENS &&
    model.inputUsd !== undefined &&
    model.outputUsd !== undefined &&
    model.serverless !== false
  )
}

/**
 * The default model: the cheapest capable one (tools, the harness's
 * minimum context, priced, runnable), the recommended one winning ties.
 * Undefined when nothing qualifies: the panel then says so instead of
 * suggesting an unpriced or tool-less model.
 */
export function suggestDefaultModel(context: SuggestContext): Suggestion<string> | undefined {
  const capable = context.models.filter((model) => isDefaultCapable(model))
  if (capable.length === 0) {
    return undefined
  }
  const cheapest = capable.toSorted((a, b) => (a.inputUsd ?? 0) - (b.inputUsd ?? 0))
  const first = cheapest.at(0)
  if (first === undefined) {
    return undefined
  }
  const lowest = first.inputUsd ?? 0
  const tied = cheapest.filter((model) => (model.inputUsd ?? 0) === lowest)
  const pick = tied.find((model) => model.recommended === true) ?? first
  const isKeptLast = context.lastDefaultRef !== undefined && context.lastDefaultRef === pick.ref
  const reason = fill(
    pick.recommended === true
      ? UI_TEXT.providerText.suggest.recommended
      : UI_TEXT.providerText.suggest.cheapest,
    { ref: pick.ref },
  )
  return {
    kind: 'defaultModel',
    value: pick.ref,
    reason: isKeptLast ? fill(UI_TEXT.providerText.suggest.last, { reason }) : reason,
  }
}

export interface SessionBudgetSuggestion {
  /** The suggested dollar cap for one session, in USD. */
  readonly usd: number
}

/**
 * A session budget from the default model's price card and the median of
 * the user's own recent sessions. With no history, the stated assumption:
 * the default model's price for a reference session.
 */
export function suggestSessionBudget(
  defaultCard: PriceCard | undefined,
  historyMedianUsd: number | undefined,
): Suggestion<SessionBudgetSuggestion> | undefined {
  if (historyMedianUsd !== undefined && Number.isFinite(historyMedianUsd) && historyMedianUsd > 0) {
    return {
      kind: 'sessionBudget',
      value: { usd: historyMedianUsd },
      reason: fill(UI_TEXT.providerText.suggest.history, {
        amount: formatUsd(historyMedianUsd, 2),
      }),
    }
  }
  if (defaultCard === undefined) {
    return undefined
  }
  const usd = reserveRequestUsd(defaultCard, {
    inputTokens: SUGGEST_REFERENCE_SESSION_INPUT_TOKENS,
    outputTokens: SUGGEST_REFERENCE_SESSION_OUTPUT_TOKENS,
  })
  return {
    kind: 'sessionBudget',
    value: { usd },
    reason: fill(UI_TEXT.providerText.suggest.reference, { amount: formatUsd(usd, 2) }),
  }
}

/** Both M95 suggestions for a context, each with its reason. */
export function suggest(
  kind: SuggestKind,
  context: SuggestContext,
  defaultCard?: PriceCard,
): Suggestion<string> | Suggestion<SessionBudgetSuggestion> | undefined {
  return kind === 'defaultModel'
    ? suggestDefaultModel(context)
    : suggestSessionBudget(defaultCard, context.historyMedianUsd)
}

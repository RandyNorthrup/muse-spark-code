// Adaptive autofill (M96 lane F, PLAN.md D75): M96's suggestion kinds
// for M95's local suggestion engine (`src/core/providers/suggest.ts`),
// with no telemetry and no model call. Each suggestion is shown as a
// `SuggestionCard` (lane U1) with its reason, and a dismissed suggestion
// stays dismissed for that role. Pure; no `vscode` import.
//
// Seams: the suggestion engine itself, the capability check (lane R) and
// the price cards (M95) arrive injected. Learning reads the team ledger's
// per-role task tokens (lane A); here they arrive as plain numbers.

import { UI_TEXT } from '../../shared/constants'
import { fill, formatUsd } from '../../shared/l10n/text'
import { TEAM_ROLE_TYPICAL_TASK_TOKENS, type TeamDraft } from './templates'

/** M96's suggestion kinds for M95's engine (D75). */
export type TeamSuggestionKind = 'roleModel' | 'roleBudget' | 'reviewVendor' | 'poolFallback'

/** One suggestion with its reason in the display language. */
export interface TeamSuggestion {
  readonly kind: TeamSuggestionKind
  readonly role: string
  readonly reason: string
  /** The model reference the suggestion names, when it names one. */
  readonly modelRef: string | undefined
  /** The suggested amount, for budget and cap suggestions. */
  readonly amount: number | undefined
}

/** A catalogue model reduced to what the rules need. */
export interface TeamSuggestionModel {
  readonly modelRef: string
  readonly vendor: string
  /** US dollars per million input tokens; absent when unpriced. */
  readonly usdPerMTokInput: number | undefined
  readonly free: boolean
}

/** The local record per role: each finished task's tokens (lane A's ledger). */
export interface TeamRoleRecord {
  readonly role: string
  readonly taskTokens: readonly number[]
}

/** Dismissals, stored per role by the host; injected so core stays pure. */
export interface TeamDismissalStore {
  isDismissed(role: string, kind: TeamSuggestionKind): boolean
  dismiss(role: string, kind: TeamSuggestionKind): void
}

/** Everything the rules read. */
export interface TeamAutofillContext {
  readonly draft: TeamDraft
  readonly models: readonly TeamSuggestionModel[]
  readonly records: readonly TeamRoleRecord[]
  readonly dismissals: TeamDismissalStore
  /** Lane R's capability check: whether the model may serve the role. */
  readonly isCapable: (modelRef: string, role: string) => boolean
  /** The team's remaining daily budget in dollars. */
  readonly remainingDailyBudgetUsd: number
}

/** The tasks a role needs before the record replaces the starting value. */
export const TEAM_LEARNED_MIN_TASKS = 5

/**
 * Typical use per role: the starting value until the role has five tasks
 * here, then the median of the local record (D75).
 */
export function typicalUseFor(
  role: string,
  records: readonly TeamRoleRecord[],
): { tokens: number; learned: boolean } {
  const record = records.find((entry) => entry.role === role)
  const samples = record?.taskTokens ?? []
  return samples.length >= TEAM_LEARNED_MIN_TASKS
    ? { tokens: medianOf(samples), learned: true }
    : { tokens: typicalTokensFor(role), learned: false }
}

/** The starting typical use for a role; custom roles read as engineering. */
export function typicalTokensFor(role: string): number {
  const table: Readonly<Record<string, number>> = TEAM_ROLE_TYPICAL_TASK_TOKENS
  return table[role] ?? TEAM_ROLE_TYPICAL_TASK_TOKENS.engineering
}

function medianOf(samples: readonly number[]): number {
  const sorted = samples.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
}

/**
 * Every suggestion the rules fire, each with its reason; dismissed ones
 * stay out. Rule order is stable: review vendor, cheapest capable, no
 * fallback, caps from the budget.
 */
export function buildTeamSuggestions(context: TeamAutofillContext): readonly TeamSuggestion[] {
  const suggestions: TeamSuggestion[] = []
  const reviewVendor = suggestReviewVendor(context)
  if (reviewVendor !== undefined) {
    suggestions.push(reviewVendor)
  }
  suggestions.push(
    ...suggestCheapestCapable(context),
    ...suggestPoolFallback(context),
    ...suggestBudgetCaps(context),
  )
  return suggestions
}

/** Review on another vendor: `code-review` off `engineering`'s vendor. */
function suggestReviewVendor(context: TeamAutofillContext): TeamSuggestion | undefined {
  const engineering = context.draft.roles.find((role) => role.role === 'engineering')
  const review = context.draft.roles.find((role) => role.role === 'code-review')
  if (engineering === undefined || review === undefined) {
    return undefined
  }
  if (context.dismissals.isDismissed('code-review', 'reviewVendor')) {
    return undefined
  }
  const primary = engineering.pool[0]?.modelRef
  if (primary === undefined) {
    return undefined
  }
  const primaryVendor = vendorOf(context.models, primary)
  const candidate = context.models.find(
    (model) =>
      model.vendor !== primaryVendor &&
      model.modelRef !== primary &&
      context.isCapable(model.modelRef, 'code-review') &&
      review.pool.every((entry) => entry.modelRef !== model.modelRef),
  )
  if (candidate === undefined) {
    return undefined
  }
  return {
    kind: 'reviewVendor',
    role: 'code-review',
    reason: fill(UI_TEXT.teamSuggestReviewVendorDetail, {
      model: candidate.modelRef,
      vendor: candidate.vendor,
    }),
    modelRef: candidate.modelRef,
    amount: undefined,
  }
}

/** Cheapest capable for research and docs, naming a free local model first. */
function suggestCheapestCapable(context: TeamAutofillContext): readonly TeamSuggestion[] {
  const suggestions: TeamSuggestion[] = []
  for (const role of ['research', 'docs'] as const) {
    if (
      context.draft.roles.every((entry) => entry.role !== role) ||
      context.dismissals.isDismissed(role, 'roleModel')
    ) {
      continue
    }
    const capable = context.models.filter((model) => context.isCapable(model.modelRef, role))
    if (capable.length === 0) {
      continue
    }
    const free = capable.find((model) => model.free)
    const cheapest =
      free ??
      capable.toSorted(
        (a, b) =>
          (a.usdPerMTokInput ?? Number.MAX_SAFE_INTEGER) -
          (b.usdPerMTokInput ?? Number.MAX_SAFE_INTEGER),
      )[0]
    if (cheapest === undefined) {
      continue
    }
    suggestions.push({
      kind: 'roleModel',
      role,
      reason: fill(
        cheapest.free ? UI_TEXT.teamSuggestFreeLocal : UI_TEXT.teamSuggestCheapestDetail,
        {
          model: cheapest.modelRef,
          role,
        },
      ),
      modelRef: cheapest.modelRef,
      amount: undefined,
    })
  }
  return suggestions
}

/** No fallback: a pool with a single entry gets a second-entry suggestion. */
function suggestPoolFallback(context: TeamAutofillContext): readonly TeamSuggestion[] {
  const suggestions: TeamSuggestion[] = []
  for (const role of context.draft.roles) {
    if (role.pool.length !== 1 || context.dismissals.isDismissed(role.role, 'poolFallback')) {
      continue
    }
    const only = role.pool[0]?.modelRef
    if (only === undefined) {
      continue
    }
    const onlyVendor = vendorOf(context.models, only)
    const candidate = context.models.find(
      (model) =>
        model.modelRef !== only &&
        (model.vendor !== onlyVendor || model.free) &&
        context.isCapable(model.modelRef, role.role),
    )
    if (candidate === undefined) {
      continue
    }
    suggestions.push({
      kind: 'poolFallback',
      role: role.role,
      reason: fill(UI_TEXT.teamSuggestFallbackDetail, {
        role: role.role,
        model: candidate.modelRef,
      }),
      modelRef: candidate.modelRef,
      amount: undefined,
    })
  }
  return suggestions
}

/** Caps from the budget: day caps that fit the remaining daily budget. */
function suggestBudgetCaps(context: TeamAutofillContext): readonly TeamSuggestion[] {
  const suggestions: TeamSuggestion[] = []
  if (context.remainingDailyBudgetUsd <= 0) {
    return suggestions
  }
  for (const role of context.draft.roles) {
    if (context.dismissals.isDismissed(role.role, 'roleBudget')) {
      continue
    }
    const hasDayCap = role.pool.some((entry) =>
      entry.caps.some((cap) => cap.measure === 'spendUsd' && cap.window === 'day'),
    )
    if (hasDayCap) {
      continue
    }
    const share = budgetShareFor(
      role.role,
      context.draft.roles.map((entry) => entry.role),
      context.records,
    )
    const amount = Math.floor(context.remainingDailyBudgetUsd * share * 100) / 100
    suggestions.push({
      kind: 'roleBudget',
      role: role.role,
      reason: fill(UI_TEXT.teamSuggestBudget, {
        role: role.role,
        amount: formatUsd(amount, 2),
      }),
      modelRef: undefined,
      amount,
    })
  }
  return suggestions
}

/**
 * Each role's share of the daily budget, weighted by its typical use
 * among the draft's roles.
 */
export function budgetShareFor(
  role: string,
  roles: readonly string[],
  records: readonly TeamRoleRecord[] = [],
): number {
  const total = roles.reduce((sum, name) => sum + typicalUseFor(name, records).tokens, 0)
  return total === 0 ? 0 : typicalUseFor(role, records).tokens / total
}

function vendorOf(models: readonly TeamSuggestionModel[], modelRef: string): string {
  return models.find((model) => model.modelRef === modelRef)?.vendor ?? ''
}

/** Remembers a dismissal for that role (lane U1 calls this on Dismiss). */
export function dismissTeamSuggestion(
  store: TeamDismissalStore,
  role: string,
  kind: TeamSuggestionKind,
): void {
  store.dismiss(role, kind)
}

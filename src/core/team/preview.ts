// The preview, before anything is saved (M96 lane F, PLAN.md D75): for
// a sample task, the panel shows which roles and entries would be used,
// any switch the caps would force, and the estimated cost range. It runs
// D75's selection over the unsaved draft, with each built-in flow's fixed
// plan, the price cards and typical use. It makes no model call and costs
// nothing. Pure; no `vscode` import.
//
// Seams: lane A's live selection arrives as the injected `selectEntry`;
// the price cards are M95's, reduced to `TeamPreviewPrice`. `Try with the
// orchestrator` (a `dry_run` turn) is lane T's; here the preview states
// its cost first through `dryRunCostLabel`.

import { UI_TEXT } from '../../shared/constants'
import { fill, formatUsd, plural } from '../../shared/l10n/text'
import { typicalTokensFor } from './autofill'
import type { TeamDraft } from './templates'

/** The sample tasks the panel offers (D75). */
export type TeamPreviewSample = 'feature-tests' | 'research-library' | 'review-branch'

export const TEAM_PREVIEW_SAMPLES: readonly TeamPreviewSample[] = [
  'feature-tests',
  'research-library',
  'review-branch',
]

/** A sample's name in the display language. */
export function previewSampleName(sample: TeamPreviewSample): string {
  switch (sample) {
    case 'feature-tests': {
      return UI_TEXT.teamPreviewFeatureTests
    }
    case 'research-library': {
      return UI_TEXT.teamPreviewResearchLibrary
    }
    case 'review-branch': {
      return UI_TEXT.teamPreviewReviewBranch
    }
  }
}

/**
 * Each built-in flow's fixed plan: the roles it runs and how much of the
 * role's typical use one step takes.
 */
export interface TeamSampleStep {
  readonly role: string
  /** Fraction of the role's typical task tokens this step uses. */
  readonly share: number
}

export const TEAM_SAMPLE_PLANS: Readonly<Record<TeamPreviewSample, readonly TeamSampleStep[]>> = {
  'feature-tests': [
    { role: 'engineering', share: 1 },
    { role: 'code-review', share: 1 },
  ],
  'research-library': [{ role: 'research', share: 1 }],
  'review-branch': [{ role: 'code-review', share: 1 }],
}

/** A price card reduced to what the estimates need (M95's data). */
export interface TeamPreviewPrice {
  readonly modelRef: string
  /** US dollars per million tokens; absent when M95 never priced it. */
  readonly usdPerMTokInput: number | undefined
  readonly usdPerMTokOutput: number | undefined
  readonly usdPerMTokCachedInput: number | undefined
}

/**
 * Lane A's selection over the draft: the pool index that would take the
 * role's next step given what each entry already spent, or -1 when no
 * entry has headroom. Usage is in input tokens.
 */
export type TeamPreviewSelect = (
  role: string,
  poolSize: number,
  spentPerEntry: readonly number[],
) => number

/** One step's assignment in the preview. */
export interface TeamPreviewStep {
  readonly role: string
  readonly entryIndex: number
  readonly modelRef: string
  /** True when the caps forced a switch off the role's first entry. */
  readonly switched: boolean
  readonly tokens: number
}

/** The preview for a sample: steps, switches and the cost range. */
export interface TeamPreview {
  readonly sample: TeamPreviewSample
  readonly steps: readonly TeamPreviewStep[]
  readonly switchCount: number
  readonly tokens: number
  /** Undefined when no priced entry takes part: tokens only. */
  readonly usdLow: number | undefined
  readonly usdHigh: number | undefined
  readonly unstaffedRoles: readonly string[]
}

const TOKENS_PER_MTOK = 1_000_000
/** The output share of a step's tokens in the estimate. */
const PREVIEW_OUTPUT_SHARE = 0.3
/** Estimates stay readable below a dollar: four fraction digits. */
const USD_PREVIEW_FRACTION_DIGITS = 4

export interface TeamPreviewInput {
  readonly draft: TeamDraft
  readonly sample: TeamPreviewSample
  readonly prices: readonly TeamPreviewPrice[]
  readonly select: TeamPreviewSelect
}

/**
 * Runs the sample's fixed plan over the draft. Token figures come from
 * each role's typical use; the low end prices input at the cached rate
 * (cached input is never priced at the full rate) and the high end at
 * the full rate. Roles with no pool, and steps no entry can take, are
 * listed as unstaffed rather than guessed.
 */
export function previewDraft(input: TeamPreviewInput): TeamPreview {
  const steps: TeamPreviewStep[] = []
  const unstaffed: string[] = []
  const spent = new Map<string, number[]>()
  let switchCount = 0

  const plan = TEAM_SAMPLE_PLANS[input.sample]
  for (const step of plan) {
    const role = input.draft.roles.find((entry) => entry.role === step.role)
    if (role === undefined || role.pool.length === 0) {
      unstaffed.push(step.role)
      continue
    }
    const tokens = Math.round(typicalTokensFor(step.role) * step.share)
    const spentForRole = spent.get(step.role) ?? Array.from({ length: role.pool.length }, () => 0)
    const entryIndex = input.select(step.role, role.pool.length, spentForRole)
    if (entryIndex < 0 || entryIndex >= role.pool.length) {
      unstaffed.push(step.role)
      continue
    }
    const entry = role.pool[entryIndex]
    if (entry === undefined) {
      unstaffed.push(step.role)
      continue
    }
    spentForRole[entryIndex] = (spentForRole[entryIndex] ?? 0) + tokens
    spent.set(step.role, spentForRole)
    const isSwitched = entryIndex !== 0
    if (isSwitched) {
      switchCount += 1
    }
    steps.push({
      role: step.role,
      entryIndex,
      modelRef: entry.modelRef,
      switched: isSwitched,
      tokens,
    })
  }

  const pricedSteps: { step: TeamPreviewStep; price: TeamPreviewPrice }[] = []
  for (const step of steps) {
    const price = input.prices.find((entry) => entry.modelRef === step.modelRef)
    if (price?.usdPerMTokInput !== undefined) {
      pricedSteps.push({ step, price })
    }
  }
  if (pricedSteps.length === 0) {
    return {
      sample: input.sample,
      steps,
      switchCount,
      tokens: totalTokens(steps),
      usdLow: undefined,
      usdHigh: undefined,
      unstaffedRoles: unstaffed,
    }
  }
  return {
    sample: input.sample,
    steps,
    switchCount,
    tokens: totalTokens(steps),
    usdLow: costOf(pricedSteps, (price) => price.usdPerMTokCachedInput),
    usdHigh: costOf(pricedSteps, (price) => price.usdPerMTokInput),
    unstaffedRoles: unstaffed,
  }
}

function totalTokens(steps: readonly TeamPreviewStep[]): number {
  let total = 0
  for (const step of steps) {
    total += step.tokens
  }
  return total
}

function costOf(
  pricedSteps: readonly { step: TeamPreviewStep; price: TeamPreviewPrice }[],
  inputRateOf: (price: TeamPreviewPrice) => number | undefined,
): number {
  let total = 0
  for (const { step, price } of pricedSteps) {
    const output = step.tokens * PREVIEW_OUTPUT_SHARE
    const inputTokens = step.tokens - output
    const inputRate = inputRateOf(price) ?? price.usdPerMTokInput ?? 0
    const outputRate = price.usdPerMTokOutput ?? 0
    total += (inputTokens * inputRate + output * outputRate) / TOKENS_PER_MTOK
  }
  return total
}

/** The preview's cost line: the range with its token figure. */
export function previewCostLabel(preview: TeamPreview): string {
  if (preview.usdLow === undefined || preview.usdHigh === undefined) {
    return fill(UI_TEXT.teamPreviewCostTokens, { tokens: preview.tokens })
  }
  return fill(UI_TEXT.teamPreviewCost, {
    low: formatUsd(preview.usdLow, USD_PREVIEW_FRACTION_DIGITS),
    high: formatUsd(preview.usdHigh, USD_PREVIEW_FRACTION_DIGITS),
    tokens: preview.tokens,
  })
}

/** The switch line: how many steps the caps moved off the first entry. */
export function previewSwitchLabel(preview: TeamPreview): string {
  return plural(UI_TEXT.teamPreviewSwitches, preview.switchCount, { count: preview.switchCount })
}

/** `Try with the orchestrator` states its one-turn cost first (D75). */
export function dryRunCostLabel(usd: number): string {
  return fill(UI_TEXT.teamPreviewDryRunCost, { cost: formatUsd(usd, USD_PREVIEW_FRACTION_DIGITS) })
}

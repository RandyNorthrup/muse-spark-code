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

import {
  UI_TEXT,
  TEAM_TOKENS_PER_MTOK,
  TEAM_PREVIEW_OUTPUT_SHARE,
  TEAM_PREVIEW_USD_FRACTION_DIGITS,
} from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
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
  /** Only key-billed work uses dollar rates; subscriptions/local use tokens. */
  readonly billable: boolean
  /** US dollars per million tokens; absent when M95 never priced it. */
  readonly usdPerMTokInput: number | undefined
  readonly usdPerMTokOutput: number | undefined
  readonly usdPerMTokCachedInput: number | undefined
}

/**
 * Lane A's selection over the draft: the pool index that would take the
 * role's next step given what each entry already spent, or -1 when no
 * entry has headroom. Usage is in total tokens.
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
  /** Undefined for tokens-only work or when any billed price is unknown. */
  readonly usdLow: number | undefined
  readonly usdHigh: number | undefined
  readonly hasUnknownPrice: boolean
  readonly unstaffedRoles: readonly string[]
}

/** The output share of a step's tokens in the estimate. */

/** Estimates stay readable below a dollar: four fraction digits. */

export interface TeamPreviewInput {
  readonly draft: TeamDraft
  readonly sample: TeamPreviewSample
  readonly prices: readonly TeamPreviewPrice[]
  readonly select: TeamPreviewSelect
  /** Supplied only for an active team; resolves the live orchestrator slot. */
  readonly resolveDefault?: (role: string) => string | undefined
}

/**
 * Runs the sample's fixed plan over the draft. Token figures come from
 * each role's typical use; the low end prices input at the cached rate
 * (cached input is never priced at the full rate) and the high end at
 * the full rate. An active team's missing custom pool uses live Default
 * through the resolver; steps no entry can take are listed as unstaffed.
 */
export function previewDraft(input: TeamPreviewInput): TeamPreview {
  const steps: TeamPreviewStep[] = []
  const unstaffed: string[] = []
  const spent = new Map<string, number[]>()
  let switchCount = 0

  const plan = TEAM_SAMPLE_PLANS[input.sample]
  for (const step of plan) {
    const role = input.draft.roles.find((entry) => entry.role === step.role)
    let modelRefs = role?.pool.map((entry) => entry.modelRef) ?? []
    if (modelRefs.length === 0) {
      const defaultRef = input.resolveDefault?.(step.role)
      if (defaultRef === undefined) {
        unstaffed.push(step.role)
        continue
      }
      modelRefs = [defaultRef]
    }
    const tokens = Math.round(typicalTokensFor(step.role) * step.share)
    const spentForRole = spent.get(step.role) ?? Array.from({ length: modelRefs.length }, () => 0)
    const entryIndex = input.select(step.role, modelRefs.length, spentForRole)
    if (entryIndex < 0 || entryIndex >= modelRefs.length) {
      unstaffed.push(step.role)
      continue
    }
    const selectedRef = modelRefs[entryIndex]
    const modelRef = selectedRef === 'default' ? input.resolveDefault?.(step.role) : selectedRef
    if (modelRef === undefined) {
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
      modelRef,
      switched: isSwitched,
      tokens,
    })
  }

  const pricedSteps: {
    step: TeamPreviewStep
    inputRate: number
    outputRate: number
    cachedInputRate: number
  }[] = []
  let hasUnknownPrice = false
  for (const step of steps) {
    const price = input.prices.find((entry) => entry.modelRef === step.modelRef)
    if (price?.billable === false) {
      continue
    }
    if (price?.usdPerMTokInput === undefined || price.usdPerMTokOutput === undefined) {
      hasUnknownPrice = true
      continue
    }
    pricedSteps.push({
      step,
      inputRate: price.usdPerMTokInput,
      outputRate: price.usdPerMTokOutput,
      cachedInputRate: price.usdPerMTokCachedInput ?? price.usdPerMTokInput,
    })
  }
  return {
    sample: input.sample,
    steps,
    switchCount,
    tokens: totalTokens(steps),
    hasUnknownPrice,
    usdLow: hasUnknownPrice || pricedSteps.length === 0 ? undefined : costOf(pricedSteps, true),
    usdHigh: hasUnknownPrice || pricedSteps.length === 0 ? undefined : costOf(pricedSteps, false),
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
  pricedSteps: readonly {
    step: TeamPreviewStep
    inputRate: number
    outputRate: number
    cachedInputRate: number
  }[],
  isCached: boolean,
): number {
  let total = 0
  for (const { step, inputRate, outputRate, cachedInputRate } of pricedSteps) {
    const output = step.tokens * TEAM_PREVIEW_OUTPUT_SHARE
    const inputTokens = step.tokens - output
    total +=
      (inputTokens * (isCached ? cachedInputRate : inputRate) + output * outputRate) /
      TEAM_TOKENS_PER_MTOK
  }
  return total
}

/** The preview's cost line: the range with its token figure. */
export function previewCostLabel(preview: TeamPreview): string {
  if (preview.hasUnknownPrice) {
    return fill(UI_TEXT.teamPreviewCostUnknown, { tokens: preview.tokens })
  }
  if (preview.usdLow === undefined || preview.usdHigh === undefined) {
    return fill(UI_TEXT.teamPreviewCostTokens, { tokens: preview.tokens })
  }
  return fill(UI_TEXT.teamPreviewCost, {
    low: formatUsd(preview.usdLow, TEAM_PREVIEW_USD_FRACTION_DIGITS),
    high: formatUsd(preview.usdHigh, TEAM_PREVIEW_USD_FRACTION_DIGITS),
    tokens: preview.tokens,
  })
}

/** The switch line: how many steps the caps moved off the first entry. */
export function previewSwitchLabel(preview: TeamPreview): string {
  return plural(UI_TEXT.teamPreviewSwitches, preview.switchCount, { count: preview.switchCount })
}

/** `Try with the orchestrator` states its one-turn cost first (D75). */
export function dryRunCostLabel(usd: number): string {
  return fill(UI_TEXT.teamPreviewDryRunCost, {
    cost: formatUsd(usd, TEAM_PREVIEW_USD_FRACTION_DIGITS),
  })
}

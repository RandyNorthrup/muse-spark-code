// Team intensity (M96 lane F, PLAN.md D75): one control from Minimal to
// Max that sets the whole team's concurrency, effort and budgets. A manual
// edit to a role overrides the level for that role only (marked custom);
// changing the level leaves custom roles alone until Re-apply level.
// Pure; no `vscode` import.
//
// Seams: the computed ceilings (provider limit, hard ceiling, machine) are
// lane A's `teamCeilings.ts`; here they arrive as plain numbers. The
// model's effort tiers are M95's capability data, reduced to the string
// list the effort helpers take.

import { UI_TEXT } from '../../shared/constants'
import { fill, formatUsd } from '../../shared/l10n/text'
import type { TeamRoleDraft } from './templates'

/** The five intensity levels, cheapest first. */
export type TeamIntensityLevel = 'minimal' | 'light' | 'balanced' | 'heavy' | 'max'

export const TEAM_INTENSITY_LEVELS: readonly TeamIntensityLevel[] = [
  'minimal',
  'light',
  'balanced',
  'heavy',
  'max',
]

/** The default level for a new team. */
export const DEFAULT_INTENSITY_LEVEL: TeamIntensityLevel = 'balanced'

/**
 * What one level sets (D75's table): the running cap per role, the effort
 * shift from each role's base, the tokens per task, and the team's own
 * daily budget beneath `museSpark.teamDailyBudgetUsd`.
 */
export interface TeamIntensitySpec {
  readonly runningPerRole: number | 'ceiling'
  /** Effort steps from the role's base; negative lowers, positive raises. */
  readonly effortSteps: number
  readonly tokensPerTask: number
  readonly dailyBudgetUsd: number
  readonly dailyBudgetTokens: number
}

export const TEAM_INTENSITY_SPECS: Readonly<Record<TeamIntensityLevel, TeamIntensitySpec>> = {
  minimal: {
    runningPerRole: 1,
    effortSteps: -2,
    tokensPerTask: 100_000,
    dailyBudgetUsd: 2,
    dailyBudgetTokens: 1_000_000,
  },
  light: {
    runningPerRole: 2,
    effortSteps: -1,
    tokensPerTask: 200_000,
    dailyBudgetUsd: 5,
    dailyBudgetTokens: 2_500_000,
  },
  balanced: {
    runningPerRole: 4,
    effortSteps: 0,
    tokensPerTask: 400_000,
    dailyBudgetUsd: 10,
    dailyBudgetTokens: 5_000_000,
  },
  heavy: {
    runningPerRole: 8,
    effortSteps: 1,
    tokensPerTask: 800_000,
    dailyBudgetUsd: 25,
    dailyBudgetTokens: 12_000_000,
  },
  max: {
    runningPerRole: 'ceiling',
    effortSteps: 2,
    tokensPerTask: 1_500_000,
    dailyBudgetUsd: 50,
    dailyBudgetTokens: 25_000_000,
  },
}

/**
 * The three ceilings a running count never passes (D75; computed by lane
 * A's `teamCeilings.ts`): the provider's limit, our hard ceiling and the
 * machine's.
 */
export interface TeamRunningCeilings {
  readonly provider: number
  readonly hard: number
  readonly machine: number
}

/** Max is the lowest of the three ceilings; every other level is fixed. */
export function runningForLevel(level: TeamIntensityLevel, ceilings: TeamRunningCeilings): number {
  const spec = TEAM_INTENSITY_SPECS[level]
  return spec.runningPerRole === 'ceiling'
    ? Math.max(0, Math.min(ceilings.provider, ceilings.hard, ceilings.machine))
    : Math.max(0, Math.min(spec.runningPerRole, ceilings.provider, ceilings.hard, ceilings.machine))
}

/** A level's name in the display language. */
export function intensityName(level: TeamIntensityLevel): string {
  return UI_TEXT.teamIntensityLevels[level]
}

/**
 * A role's applied intensity: either the team's level or a manual
 * override the level leaves alone.
 */
export interface TeamRoleIntensity {
  readonly role: string
  readonly level: TeamIntensityLevel
  readonly custom: boolean
  readonly runningCap: number
  readonly tokensPerTask: number
}

/**
 * Applies a level to every non-custom role; custom roles keep their
 * values. Returns the per-role settings the panel stores.
 */
export function applyIntensityLevel(
  roles: readonly TeamRoleIntensity[],
  level: TeamIntensityLevel,
  ceilings: TeamRunningCeilings,
): readonly TeamRoleIntensity[] {
  const spec = TEAM_INTENSITY_SPECS[level]
  return roles.map((role) => {
    if (role.custom) {
      return role
    }
    return {
      ...role,
      level,
      runningCap: runningForLevel(level, ceilings),
      tokensPerTask: spec.tokensPerTask,
    }
  })
}

/** Re-apply level resets one custom role to the level (D75). */
export function reapplyIntensityLevel(
  role: TeamRoleIntensity,
  level: TeamIntensityLevel,
  ceilings: TeamRunningCeilings,
): TeamRoleIntensity {
  const spec = TEAM_INTENSITY_SPECS[level]
  return {
    ...role,
    level,
    custom: false,
    runningCap: runningForLevel(level, ceilings),
    tokensPerTask: spec.tokensPerTask,
  }
}

/** Marks one role custom after a manual edit, keeping its edited values. */
export function markRoleCustom(role: TeamRoleIntensity): TeamRoleIntensity {
  return { ...role, custom: true }
}

/**
 * The live adaptation (D75): a 429, or a low remaining header, halves the
 * entry's running cap, down to 1. Each `throttleRecoverMs` without another
 * 429 adds one back, up to the configured cap. Lane A owns the durable
 * marks; these are the pure transitions it stores.
 */
export interface TeamThrottleState {
  readonly configuredCap: number
  readonly runningCap: number
  /** When the last throttle landed, for the recovery step. */
  readonly throttledAtMs: number | undefined
}

export function throttleBackoff(state: TeamThrottleState, nowMs: number): TeamThrottleState {
  return {
    configuredCap: state.configuredCap,
    runningCap: Math.min(state.configuredCap, Math.max(1, Math.floor(state.runningCap / 2))),
    throttledAtMs: nowMs,
  }
}

/** Whether the Agent map shows "throttled by provider" for the entry. */
export function isThrottled(state: TeamThrottleState): boolean {
  return state.runningCap < state.configuredCap
}

export function throttledLabel(): string {
  return UI_TEXT.teamThrottledByProvider
}

export function recoverThrottleStep(
  state: TeamThrottleState,
  nowMs: number,
  throttleRecoverMs: number,
): TeamThrottleState {
  if (state.throttledAtMs === undefined || state.runningCap >= state.configuredCap) {
    return state
  }
  if (nowMs - state.throttledAtMs < throttleRecoverMs) {
    return state
  }
  return {
    configuredCap: state.configuredCap,
    runningCap: state.runningCap + 1,
    throttledAtMs: nowMs,
  }
}

/**
 * The cost of a level, shown first (D75): the estimated cost per hour of
 * team work and its tokens per hour, from the level's counts, the price
 * cards of the entries it would use, and the worker throughput estimate.
 * Subscription and local entries show tokens only. Supply one selected
 * entry's price per role, including non-billable roles.
 */
export interface TeamLevelPrice {
  /** US dollars per million tokens, input and output averaged. */
  readonly usdPerMTok: number | undefined
  /** The same at the cached-input rate, for the range's low end. */
  readonly cachedUsdPerMTok: number | undefined
  readonly billable: boolean
}

/** Tokens a worker moves per minute when it runs (D75's estimate). */
export const TEAM_WORKER_TPM_ESTIMATE = 250_000

export interface TeamLevelCost {
  readonly tokensPerHour: number
  /** Undefined for tokens-only teams or when any billed price is unknown. */
  readonly usdPerHourLow: number | undefined
  readonly usdPerHourHigh: number | undefined
  readonly hasUnknownPrice: boolean
}

const MINUTES_PER_HOUR = 60
const TOKENS_PER_MTOK = 1_000_000

function average(values: readonly number[]): number {
  let sum = 0
  for (const value of values) {
    sum += value
  }
  return sum / values.length
}

export function levelCostPerHour(
  level: TeamIntensityLevel,
  ceilings: TeamRunningCeilings,
  roleCount: number,
  prices: readonly TeamLevelPrice[],
  workerTpm = TEAM_WORKER_TPM_ESTIMATE,
): TeamLevelCost {
  const running = runningForLevel(level, ceilings)
  const tokensPerHour = running * roleCount * workerTpm * MINUTES_PER_HOUR
  const billable = prices.filter((price) => price.billable)
  const priced = billable.flatMap((price) =>
    price.usdPerMTok === undefined
      ? []
      : [{ high: price.usdPerMTok, low: price.cachedUsdPerMTok ?? price.usdPerMTok }],
  )
  const hasUnknownPrice = prices.length !== roleCount || priced.length !== billable.length
  if (hasUnknownPrice) {
    return {
      tokensPerHour,
      usdPerHourLow: undefined,
      usdPerHourHigh: undefined,
      hasUnknownPrice: true,
    }
  }
  if (billable.length === 0) {
    return {
      tokensPerHour,
      usdPerHourLow: undefined,
      usdPerHourHigh: undefined,
      hasUnknownPrice: false,
    }
  }
  const billableTokensPerHour = running * billable.length * workerTpm * MINUTES_PER_HOUR
  return {
    tokensPerHour,
    hasUnknownPrice: false,
    usdPerHourLow:
      (billableTokensPerHour / TOKENS_PER_MTOK) * average(priced.map((price) => price.low)),
    usdPerHourHigh:
      (billableTokensPerHour / TOKENS_PER_MTOK) * average(priced.map((price) => price.high)),
  }
}

/** The level's cost line, shown before the user picks it. */
export function levelCostLabel(cost: TeamLevelCost): string {
  if (cost.hasUnknownPrice) {
    return fill(UI_TEXT.teamLevelCostUnknown, { tokens: cost.tokensPerHour })
  }
  if (cost.usdPerHourLow === undefined || cost.usdPerHourHigh === undefined) {
    return fill(UI_TEXT.teamLevelCostTokens, { tokens: cost.tokensPerHour })
  }
  return fill(UI_TEXT.teamLevelCost, {
    low: formatUsd(cost.usdPerHourLow, 2),
    high: formatUsd(cost.usdPerHourHigh, 2),
    tokens: cost.tokensPerHour,
  })
}

/** Builds the stored per-role rows for a draft's roles at a level. */
export function rolesForDraft(
  roles: readonly TeamRoleDraft[],
  level: TeamIntensityLevel,
  ceilings: TeamRunningCeilings,
): readonly TeamRoleIntensity[] {
  const spec = TEAM_INTENSITY_SPECS[level]
  return roles.map((role) => ({
    role: role.role,
    level,
    custom: false,
    runningCap: runningForLevel(level, ceilings),
    tokensPerTask: spec.tokensPerTask,
  }))
}

import { Usd } from '../../src/shared/usd'
// Team intensity (M96 lane F): each level's running caps, effort steps,
// task tokens and budgets; custom roles kept; re-apply; Max clamped; the
// throttle backoff and recovery; each level's cost per hour.

import { describe, expect, it } from 'vitest'
import {
  applyIntensityLevel,
  DEFAULT_INTENSITY_LEVEL,
  intensityName,
  isThrottled,
  levelCostLabel,
  levelCostPerHour,
  markRoleCustom,
  reapplyIntensityLevel,
  recoverThrottleStep,
  rolesForDraft,
  runningForLevel,
  TEAM_INTENSITY_LEVELS,
  TEAM_INTENSITY_SPECS,
  TEAM_WORKER_TPM_ESTIMATE,
  throttleBackoff,
  throttledLabel,
  type TeamLevelPrice,
  type TeamRoleIntensity,
  type TeamRunningCeilings,
} from '../../src/core/team/intensity'
import { buildTemplateDraft } from '../../src/core/team/templates'

const CEILINGS: TeamRunningCeilings = { provider: 12, hard: 20, machine: 16 }
const TIGHT: TeamRunningCeilings = { provider: 3, hard: 20, machine: 16 }

function role(roleName: string, isCustom = false): TeamRoleIntensity {
  return {
    role: roleName,
    level: 'balanced',
    custom: isCustom,
    runningCap: 4,
    tokensPerTask: 400_000,
  }
}

describe('level table', () => {
  it('holds five levels with Balanced the default', () => {
    expect([...TEAM_INTENSITY_LEVELS]).toEqual(['minimal', 'light', 'balanced', 'heavy', 'max'])
    expect(DEFAULT_INTENSITY_LEVEL).toBe('balanced')
  })

  it('maps each level to its caps, steps, tokens and budgets', () => {
    expect(TEAM_INTENSITY_SPECS.minimal).toEqual({
      runningPerRole: 1,
      effortSteps: -2,
      tokensPerTask: 100_000,
      dailyBudgetUsd: Usd.from(2).toAmount(),
      dailyBudgetTokens: 1_000_000,
    })
    expect(TEAM_INTENSITY_SPECS.light.runningPerRole).toBe(2)
    expect(TEAM_INTENSITY_SPECS.balanced).toMatchObject({ runningPerRole: 4, effortSteps: 0 })
    expect(TEAM_INTENSITY_SPECS.heavy).toMatchObject({ runningPerRole: 8, effortSteps: 1 })
    expect(TEAM_INTENSITY_SPECS.max).toMatchObject({
      runningPerRole: 'ceiling',
      effortSteps: 2,
      tokensPerTask: 1_500_000,
      dailyBudgetUsd: Usd.from(50).toAmount(),
      dailyBudgetTokens: 25_000_000,
    })
  })

  it('clamps fixed levels and Max to the lowest ceiling', () => {
    expect(runningForLevel('minimal', CEILINGS)).toBe(1)
    expect(runningForLevel('heavy', CEILINGS)).toBe(8)
    expect(runningForLevel('heavy', TIGHT)).toBe(3)
    expect(runningForLevel('max', CEILINGS)).toBe(12)
    expect(runningForLevel('max', TIGHT)).toBe(3)
    expect(runningForLevel('max', { provider: 0, hard: 0, machine: 0 })).toBe(0)
  })

  it('never starts a worker above any zero limiting ceiling', () => {
    for (const level of TEAM_INTENSITY_LEVELS) {
      for (const ceiling of ['provider', 'hard', 'machine']) {
        expect(runningForLevel(level, { ...CEILINGS, [ceiling]: 0 }), `${level}: ${ceiling}`).toBe(
          0,
        )
      }
    }
    expect(
      throttleBackoff({ configuredCap: 0, runningCap: 0, throttledAtMs: undefined }, 1000)
        .runningCap,
    ).toBe(0)
  })
})

describe('custom roles', () => {
  it('leaves custom roles alone until re-applied', () => {
    const mine = { ...role('engineering', true), runningCap: 2, tokensPerTask: 100_000 }
    const applied = applyIntensityLevel([mine, role('qa')], 'heavy', CEILINGS)
    expect(applied[0]).toEqual(mine)
    expect(applied[1]).toMatchObject({ level: 'heavy', runningCap: 8, tokensPerTask: 800_000 })
    expect(reapplyIntensityLevel(mine, 'balanced', CEILINGS)).toMatchObject({
      custom: false,
      runningCap: 4,
      tokensPerTask: 400_000,
    })
    expect(markRoleCustom(role('qa')).custom).toBe(true)
  })

  it('re-applies the current team level after preserving a custom role', () => {
    const mine = { ...role('engineering', true), runningCap: 2, tokensPerTask: 100_000 }
    const [kept] = applyIntensityLevel([mine], 'heavy', CEILINGS)
    if (kept === undefined) {
      throw new Error('missing custom role')
    }
    expect(kept).toEqual(mine)
    expect(reapplyIntensityLevel(kept, 'heavy', CEILINGS)).toMatchObject({
      level: 'heavy',
      custom: false,
      runningCap: 8,
      tokensPerTask: 800_000,
    })
    expect(reapplyIntensityLevel(kept, 'minimal', TIGHT)).toMatchObject({
      level: 'minimal',
      runningCap: 1,
      tokensPerTask: 100_000,
    })
  })

  it('builds stored rows for a draft', () => {
    const draft = buildTemplateDraft('pair', [])
    const rows = rolesForDraft(draft.roles, 'light', CEILINGS)
    expect(rows.map((row) => [row.role, row.runningCap, row.tokensPerTask])).toEqual([
      ['engineering', 2, 200_000],
      ['code-review', 2, 200_000],
    ])
  })
})

describe('throttle backoff', () => {
  it('halves the running cap down to one, then recovers one step at a time', () => {
    const state = { configuredCap: 8, runningCap: 8, throttledAtMs: undefined }
    const halved = throttleBackoff(state, 1000)
    expect(halved.runningCap).toBe(4)
    expect(isThrottled(halved)).toBe(true)
    expect(throttledLabel()).toContain('throttled')
    const floored = throttleBackoff({ ...halved, runningCap: 1 }, 2000)
    expect(floored.runningCap).toBe(1)
    expect(recoverThrottleStep(halved, 1000 + 30_000, 60_000)).toBe(halved)
    const recovered = recoverThrottleStep(halved, 1000 + 60_000, 60_000)
    expect(recovered.runningCap).toBe(5)
    const whole = recoverThrottleStep(
      { configuredCap: 8, runningCap: 8, throttledAtMs: 1000 },
      61_000,
      60_000,
    )
    expect(whole.runningCap).toBe(8)
  })
})

describe('cost per hour', () => {
  const PRICES: readonly TeamLevelPrice[] = [
    { usdPerMTok: 9, cachedUsdPerMTok: 2.4, billable: true },
    { usdPerMTok: 15, cachedUsdPerMTok: 6, billable: true },
  ]

  it('estimates tokens and the cost range by hand', () => {
    // Balanced: 4 running × 2 roles × 250,000 tokens/min × 60 min.
    const cost = levelCostPerHour('balanced', CEILINGS, 2, PRICES, TEAM_WORKER_TPM_ESTIMATE)
    expect(cost.tokensPerHour).toBe(120_000_000)
    expect(cost.usdPerHourHigh).toBeCloseTo(120 * ((9 + 15) / 2), 10)
    expect(cost.usdPerHourLow).toBeCloseTo(120 * ((2.4 + 6) / 2), 10)
    expect(levelCostLabel(cost)).toContain('120,000,000')
  })

  it('shows tokens only for subscription and local entries', () => {
    const cost = levelCostPerHour('minimal', CEILINGS, 1, [
      { usdPerMTok: 0, cachedUsdPerMTok: 0, billable: false },
    ])
    expect(cost.tokensPerHour).toBe(15_000_000)
    expect(cost.usdPerHourLow).toBeUndefined()
    expect(levelCostLabel(cost)).not.toContain('$')
  })

  it('prices only the key role tokens in a mixed team', () => {
    const cost = levelCostPerHour('minimal', CEILINGS, 3, [
      { usdPerMTok: 10, cachedUsdPerMTok: 4, billable: true },
      { usdPerMTok: 99, cachedUsdPerMTok: 99, billable: false },
      { usdPerMTok: 99, cachedUsdPerMTok: 99, billable: false },
    ])
    expect(cost.tokensPerHour).toBe(45_000_000)
    expect(cost.usdPerHourHigh).toBe(150)
    expect(cost.usdPerHourLow).toBe(60)
  })

  it('marks an unknown hourly key price instead of omitting it', () => {
    const cost = levelCostPerHour('minimal', CEILINGS, 2, [
      { usdPerMTok: 10, cachedUsdPerMTok: 4, billable: true },
      { usdPerMTok: undefined, cachedUsdPerMTok: undefined, billable: true },
    ])
    expect(cost.hasUnknownPrice).toBe(true)
    expect(cost.usdPerHourHigh).toBeUndefined()
    expect(levelCostLabel(cost)).toContain('price unknown')
    expect(levelCostPerHour('minimal', CEILINGS, 2, []).hasUnknownPrice).toBe(true)
  })

  it('names each level', () => {
    expect(intensityName('balanced')).toBe('Balanced')
    expect(intensityName('max')).toBe('Max')
  })
})

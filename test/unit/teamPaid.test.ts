// The team paid-use quote and grant identity (M96): the real tariff table
// prices the delegate popup's lines, and the grant identity binds the
// provider, model and verified tariff, so a consent for one model never
// covers another.
import { describe, expect, it } from 'vitest'
import {
  MODEL_API_PRICE_DECIMALS,
  MODEL_API_PRICES_PER_MILLION,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill, formatNumber } from '../../src/shared/l10n/text'
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import { Usd } from '../../src/shared/usd'
import type { TeamWorkerConfirmation } from '../../src/shared/paid'
import { teamWorkerPaidTier, teamWorkerPrice, teamWorkerScopes } from '../../src/core/team/teamPaid'

const STANDARD_MODEL = 'muse-spark-1.3'
const CONTRIBUTOR_MODEL = 'muse-spark-1.3-contributor'
const UNPRICED_MODEL = 'other-model-7'

function confirmation(overrides: Partial<TeamWorkerConfirmation> = {}): TeamWorkerConfirmation {
  return {
    role: 'engineering',
    modelId: STANDARD_MODEL,
    taskCeilingTokens: 50_000,
    ...overrides,
  }
}

describe('the team worker tariff', () => {
  it('prices Meta models on their verified tier and nothing else', () => {
    expect(teamWorkerPaidTier(confirmation())).toBe('standard')
    expect(teamWorkerPaidTier(confirmation({ modelId: CONTRIBUTOR_MODEL }))).toBe('contributor')
    expect(teamWorkerPaidTier(confirmation({ modelId: UNPRICED_MODEL }))).toBeUndefined()
    expect(teamWorkerPaidTier(confirmation({ provider: 'other' }))).toBeUndefined()
    expect(teamWorkerPaidTier(confirmation({ priceTier: 'standard' }))).toBe('standard')
    expect(teamWorkerPaidTier(confirmation({ priceTier: 'contributor' }))).toBeUndefined()
  })

  it('quotes a priced task with its exact tariff line', () => {
    const tariff = MODEL_API_PRICES_PER_MILLION.standard
    const expected = fill(UI_TEXT.paidTeamWorkerLine, {
      role: 'engineering',
      model: `${STANDARD_MODEL} (meta, standard)`,
      rates: fill(UI_TEXT.paidTeamWorkerRates, {
        model: STANDARD_MODEL,
        input: formatUsd(tariff.input, MODEL_API_PRICE_DECIMALS),
        cached: formatUsd(tariff.cachedInput, MODEL_API_PRICE_DECIMALS),
        output: formatUsd(tariff.output, MODEL_API_PRICE_DECIMALS),
        tokens: formatNumber(50_000),
      }),
    })
    expect(teamWorkerPrice([confirmation()], undefined)).toBe(expected)
  })

  it('quotes an unpriced task without rates, and appends the daily budgets', () => {
    const line = fill(UI_TEXT.paidTeamWorkerLine, {
      role: 'engineering',
      model: `${UNPRICED_MODEL} (meta)`,
      rates: fill(UI_TEXT.paidTeamWorkerUnpriced, { tokens: formatNumber(50_000) }),
    })
    expect(teamWorkerPrice([confirmation({ modelId: UNPRICED_MODEL })], undefined)).toBe(line)
    const budgeted = teamWorkerPrice(
      [confirmation({ modelId: UNPRICED_MODEL })],
      Usd.from('2.5').toAmount(),
      100_000,
    )
    expect(budgeted).toBe(
      [
        line,
        fill(UI_TEXT.paidTeamWorkerBudget, { budget: formatUsd(Usd.from('2.5').toAmount(), 2) }),
        fill(UI_TEXT.paidTeamWorkerTokenBudget, { tokens: formatNumber(100_000) }),
      ].join('\n'),
    )
  })

  it('quotes each task on its own line', () => {
    const quoted = teamWorkerPrice(
      [confirmation(), confirmation({ modelId: CONTRIBUTOR_MODEL })],
      undefined,
    )
    const lines = quoted.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(STANDARD_MODEL)
    expect(lines[1]).toContain(CONTRIBUTOR_MODEL)
  })
})

describe('the team grant identity', () => {
  it('binds the provider, model and verified tariff snapshot', () => {
    const [scope = ''] = teamWorkerScopes([confirmation()])
    const parsed: unknown = JSON.parse(scope)
    expect(parsed).toEqual([
      'meta',
      STANDARD_MODEL,
      'standard',
      MODEL_API_PRICES_PER_MILLION.standard,
    ])
  })

  it('never lets one model spend another consent', () => {
    const [standard, contributor, unpriced, foreign] = teamWorkerScopes([
      confirmation(),
      confirmation({ modelId: CONTRIBUTOR_MODEL }),
      confirmation({ modelId: UNPRICED_MODEL }),
      confirmation({ provider: 'other' }),
    ])
    expect(new Set([standard, contributor, unpriced, foreign]).size).toBe(4)
  })
})

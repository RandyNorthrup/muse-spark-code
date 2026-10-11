// The preview (M96 lane F): roles, entries, forced switches and the cost
// range for a sample task, from the fake prices, with no model call.

import { describe, expect, it } from 'vitest'
import {
  dryRunCostLabel,
  previewCostLabel,
  previewDraft,
  previewSampleName,
  previewSwitchLabel,
  TEAM_PREVIEW_SAMPLES,
  TEAM_SAMPLE_PLANS,
  type TeamPreviewPrice,
  type TeamPreviewSelect,
} from '../../src/core/team/preview'
import { buildTemplateDraft } from '../../src/core/team/templates'

const PRICES: readonly TeamPreviewPrice[] = [
  {
    modelRef: 'muse-spark-1.3',
    billable: true,
    usdPerMTokInput: 3,
    usdPerMTokOutput: 15,
    usdPerMTokCachedInput: 0.3,
  },
  {
    modelRef: 'codex-cli',
    billable: true,
    usdPerMTokInput: 5,
    usdPerMTokOutput: 20,
    usdPerMTokCachedInput: 1,
  },
]

/** Lane A's selection reduced to first entry with headroom (a test fake). */
function firstWithHeadroom(dayCaps: Readonly<Record<string, number>>): TeamPreviewSelect {
  return (_role, poolSize, spentPerEntry) => {
    for (let index = 0; index < poolSize; index += 1) {
      if ((spentPerEntry[index] ?? 0) < (dayCaps[_role] ?? Number.MAX_SAFE_INTEGER)) {
        return index
      }
    }
    return -1
  }
}

function pairDraft() {
  return buildTemplateDraft('pair', [
    { modelRef: 'muse-spark-1.3', vendor: 'meta', payKind: 'key' },
    { modelRef: 'codex-cli', vendor: 'openai', payKind: 'key' },
  ])
}

describe('samples', () => {
  it('offers three samples with fixed plans', () => {
    expect([...TEAM_PREVIEW_SAMPLES]).toEqual([
      'feature-tests',
      'research-library',
      'review-branch',
    ])
    expect(TEAM_SAMPLE_PLANS['feature-tests'].map((step) => step.role)).toEqual([
      'engineering',
      'code-review',
    ])
    expect(previewSampleName('feature-tests')).toBe('A feature with tests')
    expect(previewSampleName('research-library')).toBe('Research a library')
    expect(previewSampleName('review-branch')).toBe('Review my branch')
  })
})

describe('previewDraft', () => {
  it('selects live Default for a role without custom entries in an active team', () => {
    const selected: string[] = []
    const draft = buildTemplateDraft('pair', [
      { modelRef: 'muse-spark-1.3', vendor: 'meta', payKind: 'key' },
    ])
    let currentDefault = 'codex-cli'
    const input = {
      draft,
      sample: 'feature-tests' as const,
      prices: PRICES,
      resolveDefault: () => currentDefault,
      select: (role: string, poolSize: number) => {
        selected.push(role)
        expect(poolSize).toBe(1)
        return 0
      },
    }
    const preview = previewDraft(input)
    expect(preview.unstaffedRoles).toEqual([])
    expect(preview.steps.map((step) => step.modelRef)).toEqual(['muse-spark-1.3', 'codex-cli'])
    expect(selected).toEqual(['engineering', 'code-review'])
    currentDefault = 'muse-spark-1.3'
    expect(previewDraft(input).steps[1]?.modelRef).toBe('muse-spark-1.3')
    expect(preview.steps[1]?.modelRef).toBe('codex-cli')
    expect(previewDraft({ ...input, sample: 'research-library' }).steps[0]?.modelRef).toBe(
      'muse-spark-1.3',
    )
    expect(previewDraft({ ...input, select: () => -1 }).unstaffedRoles).toEqual([
      'engineering',
      'code-review',
    ])
  })

  it('resolves an explicit Default fallback after selection', () => {
    const base = pairDraft()
    const draft = {
      ...base,
      roles: base.roles.map((role) => ({
        ...role,
        pool: [...role.pool, { modelRef: 'default', caps: [] }],
      })),
    }
    const preview = previewDraft({
      draft,
      sample: 'feature-tests',
      prices: PRICES,
      select: () => 1,
      resolveDefault: () => 'muse-spark-1.3',
    })
    expect(preview.steps.map((step) => step.modelRef)).toEqual(['muse-spark-1.3', 'muse-spark-1.3'])
    expect(preview.switchCount).toBe(2)
  })

  it('estimates the cost range by hand from the fake prices', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES,
      select: firstWithHeadroom({}),
    })
    expect(preview.tokens).toBe(520_000)
    expect(preview.switchCount).toBe(0)
    expect(preview.unstaffedRoles).toEqual([])
    // Engineering: 400,000 tokens (280,000 in, 120,000 out);
    // review: 120,000 tokens (84,000 in, 36,000 out).
    // Low prices input at the cached rate, high at the full rate.
    const low = (280_000 * 0.3 + 120_000 * 15 + 84_000 * 1 + 36_000 * 20) / 1_000_000
    const high = (280_000 * 3 + 120_000 * 15 + 84_000 * 5 + 36_000 * 20) / 1_000_000
    expect(preview.usdLow).toBeCloseTo(low, 10)
    expect(preview.usdHigh).toBeCloseTo(high, 10)
    expect(low).toBeCloseTo(2.688, 10)
    expect(high).toBeCloseTo(3.78, 10)
    const label = previewCostLabel(preview)
    expect(label).toContain('520,000')
  })

  it('never prices cached input at the full rate', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES,
      select: firstWithHeadroom({}),
    })
    expect(preview.usdLow).toBeLessThan(preview.usdHigh ?? 0)
  })

  it('shows the switch the caps force', () => {
    const base = pairDraft()
    const draft = {
      ...base,
      roles: base.roles.map((role) =>
        role.role === 'engineering'
          ? {
              ...role,
              pool: [...role.pool, { modelRef: 'codex-cli', caps: [] }],
            }
          : role,
      ),
    }
    const preview = previewDraft({
      draft,
      sample: 'feature-tests',
      prices: PRICES,
      // Engineering's first entry is exhausted from the start.
      select: (role, poolSize, spent) =>
        role === 'engineering' ? 1 : firstWithHeadroom({})(role, poolSize, spent),
    })
    expect(preview.steps[0]?.switched).toBe(true)
    expect(preview.switchCount).toBe(1)
    expect(previewSwitchLabel(preview)).toContain('1')
  })

  it('lists a role no entry can take as unstaffed', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES,
      select: () => 5,
    })
    expect(preview.unstaffedRoles).toEqual(['engineering', 'code-review'])
    expect(preview.steps).toEqual([])
  })

  it('lists unstaffed roles instead of guessing', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'research-library',
      prices: PRICES,
      select: firstWithHeadroom({}),
    })
    expect(preview.unstaffedRoles).toEqual(['research'])
    expect(preview.steps).toEqual([])
  })

  it('marks an unknown output price instead of treating output as free', () => {
    const preview = previewDraft({
      draft: {
        template: 'custom',
        roles: [
          {
            role: 'research',
            mode: 'read-only',
            toolGroups: ['read'],
            pool: [{ modelRef: 'm', caps: [] }],
          },
        ],
      },
      sample: 'research-library',
      prices: [
        {
          modelRef: 'm',
          billable: true,
          usdPerMTokInput: 10,
          usdPerMTokOutput: undefined,
          usdPerMTokCachedInput: undefined,
        },
      ],
      select: () => 0,
    })
    expect(preview.hasUnknownPrice).toBe(true)
    expect(preview.usdLow).toBeUndefined()
    expect(preview.usdHigh).toBeUndefined()
    expect(previewCostLabel(preview)).toContain('price unknown')
  })

  it('marks an entirely unpriced preview as unknown', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'review-branch',
      prices: [],
      select: firstWithHeadroom({}),
    })
    expect(preview.usdLow).toBeUndefined()
    expect(preview.hasUnknownPrice).toBe(true)
    expect(previewCostLabel(preview)).toContain('120,000')
    expect(previewCostLabel(preview)).toContain('price unknown')
  })

  it('marks a mixed known and unknown total as unknown', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES.filter((price) => price.modelRef === 'muse-spark-1.3'),
      select: () => 0,
    })
    expect(preview.tokens).toBe(520_000)
    expect(preview.steps).toHaveLength(2)
    expect(preview.hasUnknownPrice).toBe(true)
    expect(preview.usdHigh).toBeUndefined()
    expect(previewCostLabel(preview)).toContain('price unknown')
  })

  it('uses tokens only for subscription and local work even with key-model prices', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES.map((price) => ({ ...price, billable: false })),
      select: () => 0,
    })
    expect(preview.hasUnknownPrice).toBe(false)
    expect(preview.usdHigh).toBeUndefined()
    expect(previewCostLabel(preview)).not.toContain('$')
    const mixed = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES.map((price) => ({ ...price, billable: price.modelRef === 'muse-spark-1.3' })),
      select: () => 0,
    })
    expect(mixed.usdHigh).toBeCloseTo((280_000 * 3 + 120_000 * 15) / 1_000_000, 10)
  })

  it('uses the known full input rate when a cached rate is absent', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES.map((price) => ({ ...price, usdPerMTokCachedInput: undefined })),
      select: () => 0,
    })
    expect(preview.hasUnknownPrice).toBe(false)
    expect(preview.usdLow).toBe(preview.usdHigh)
  })

  it('states the dry-run cost first', () => {
    expect(dryRunCostLabel(0.42)).toContain('0.42')
  })
})

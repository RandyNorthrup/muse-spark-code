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
    usdPerMTokInput: 3,
    usdPerMTokOutput: 15,
    usdPerMTokCachedInput: 0.3,
  },
  { modelRef: 'codex-cli', usdPerMTokInput: 5, usdPerMTokOutput: 20, usdPerMTokCachedInput: 1 },
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
    { modelRef: 'codex-cli', vendor: 'openai', payKind: 'subscription' },
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

  it('falls back to the full rate with no cached or output price', () => {
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
          usdPerMTokInput: 10,
          usdPerMTokOutput: undefined,
          usdPerMTokCachedInput: undefined,
        },
      ],
      select: () => 0,
    })
    // 150,000 tokens (105,000 in, 45,000 out): input at the full rate, output free.
    expect(preview.usdLow).toBeCloseTo((105_000 * 10) / 1_000_000, 10)
    expect(preview.usdHigh).toBeCloseTo((105_000 * 10) / 1_000_000, 10)
  })

  it('shows tokens only when no priced entry takes part', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'review-branch',
      prices: [],
      select: firstWithHeadroom({}),
    })
    expect(preview.usdLow).toBeUndefined()
    expect(previewCostLabel(preview)).toContain('120,000')
  })

  it('states the dry-run cost first', () => {
    expect(dryRunCostLabel(0.42)).toContain('0.42')
  })
})

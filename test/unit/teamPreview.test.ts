// The preview (M96 lane F): roles, entries, forced switches and the cost
// range for a sample task, priced from the product's own Model API price
// table (Meta's published rates, the constants every paid path reads), with
// no model call. `select` is previewDraft's own input: every case passes a
// constant strategy, so each proof covers the preview's logic, never a
// selection algorithm's.

import { describe, expect, it } from 'vitest'
import { MODEL_API_PRICES_PER_MILLION } from '../../src/shared/constants'
import { modelApiPaidTier } from '../../src/shared/paidBoundary'
import { Usd } from '../../src/shared/usd'
import {
  dryRunCostLabel,
  previewCostLabel,
  previewDraft,
  previewSampleName,
  previewSwitchLabel,
  TEAM_PREVIEW_SAMPLES,
  TEAM_SAMPLE_PLANS,
  type TeamPreviewPrice,
} from '../../src/core/team/preview'
import { buildTemplateDraft } from '../../src/core/team/templates'

const STANDARD = 'muse-spark-1.3'
const CONTRIBUTOR = 'muse-spark-1.3-contributor'

/** A model's published rates, read from the table its paid paths read. */
function publishedPrice(modelRef: string): TeamPreviewPrice {
  const tier = modelApiPaidTier(modelRef)
  if (tier === undefined) throw new Error(`${modelRef} has no published Model API price`)
  const rates = MODEL_API_PRICES_PER_MILLION[tier]
  return {
    modelRef,
    billable: true,
    usdPerMTokInput: Number(rates.input),
    usdPerMTokOutput: Number(rates.output),
    usdPerMTokCachedInput: Number(rates.cachedInput),
  }
}

const PRICES: readonly TeamPreviewPrice[] = [publishedPrice(STANDARD), publishedPrice(CONTRIBUTOR)]

function pairDraft() {
  return buildTemplateDraft('pair', [
    { modelRef: STANDARD, vendor: 'meta', payKind: 'key' },
    { modelRef: CONTRIBUTOR, vendor: 'meta', payKind: 'key' },
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
      { modelRef: STANDARD, vendor: 'meta', payKind: 'key' },
    ])
    let currentDefault = CONTRIBUTOR
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
    expect(preview.steps.map((step) => step.modelRef)).toEqual([STANDARD, CONTRIBUTOR])
    expect(selected).toEqual(['engineering', 'code-review'])
    currentDefault = STANDARD
    expect(previewDraft(input).steps[1]?.modelRef).toBe(STANDARD)
    expect(preview.steps[1]?.modelRef).toBe(CONTRIBUTOR)
    expect(previewDraft({ ...input, sample: 'research-library' }).steps[0]?.modelRef).toBe(STANDARD)
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
      resolveDefault: () => STANDARD,
    })
    expect(preview.steps.map((step) => step.modelRef)).toEqual([STANDARD, STANDARD])
    expect(preview.switchCount).toBe(2)
  })

  it('estimates the cost range by hand from the published prices', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES,
      select: () => 0,
    })
    expect(preview.tokens).toBe(520_000)
    expect(preview.switchCount).toBe(0)
    expect(preview.unstaffedRoles).toEqual([])
    // Engineering: 400,000 tokens (280,000 in, 120,000 out);
    // review: 120,000 tokens (84,000 in, 36,000 out).
    // Low prices input at the cached rate, high at the full rate. Published
    // per-million rates (verified 2026-09-26): standard 1.25 in, 0.15 cached,
    // 4.25 out; contributor 0.1 in, 0.002 cached, 0.2 out.
    // (280,000 × 0.15 + 120,000 × 4.25 + 84,000 × 0.002 + 36,000 × 0.2) / 1,000,000
    // and (280,000 × 1.25 + 120,000 × 4.25 + 84,000 × 0.1 + 36,000 × 0.2) / 1,000,000,
    // exactly (M121: no binary dollars).
    expect(preview.usdLow).toBe('0.559368')
    expect(preview.usdHigh).toBe('0.8756')
    const label = previewCostLabel(preview)
    expect(label).toContain('520,000')
  })

  it('never prices cached input at the full rate', () => {
    const preview = previewDraft({
      draft: pairDraft(),
      sample: 'feature-tests',
      prices: PRICES,
      select: () => 0,
    })
    expect(Number(preview.usdLow)).toBeLessThan(Number(preview.usdHigh ?? 0))
  })

  it('shows the switch the caps force', () => {
    const base = pairDraft()
    const draft = {
      ...base,
      roles: base.roles.map((role) =>
        role.role === 'engineering'
          ? {
              ...role,
              pool: [...role.pool, { modelRef: CONTRIBUTOR, caps: [] }],
            }
          : role,
      ),
    }
    const preview = previewDraft({
      draft,
      sample: 'feature-tests',
      prices: PRICES,
      // Engineering selects past its first entry; every other role takes its first.
      select: (role) => (role === 'engineering' ? 1 : 0),
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
      select: () => 0,
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
            pool: [{ modelRef: STANDARD, caps: [] }],
          },
        ],
      },
      sample: 'research-library',
      // The published card with its output rate absent: M95's shape for a
      // rate it never priced.
      prices: [{ ...publishedPrice(STANDARD), usdPerMTokOutput: undefined }],
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
      select: () => 0,
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
      prices: PRICES.filter((price) => price.modelRef === STANDARD),
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
      prices: PRICES.map((price) => ({ ...price, billable: price.modelRef === STANDARD })),
      select: () => 0,
    })
    // Engineering alone at the standard full rates: (280,000 × 1.25 + 120,000 × 4.25) / 1,000,000.
    expect(mixed.usdHigh).toBe('0.86')
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
    expect(dryRunCostLabel(Usd.from('0.42').toAmount())).toContain('0.42')
  })
})

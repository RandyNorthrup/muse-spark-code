import { describe, expect, it, vi } from 'vitest'
import { fakeEstimate } from './helpers/estimator/fixtures'

describe('first-use estimator contracts', () => {
  it('refuses use before loading and validates the complete contract after loading', async () => {
    vi.resetModules()
    const lazy = await import('../../src/webview/estimator/lazyContracts')
    const section = fakeEstimate()
    expect(() => lazy.estimateSectionSchema.parse(section)).toThrow()
    expect(() => lazy.estimateRequestSchema.parse(section.inputs.request)).toThrow()
    await Promise.all([lazy.ensureEstimateContracts(), lazy.ensureEstimateContracts()])
    expect(lazy.estimateSectionSchema.parse(section)).toEqual(section)
    expect(lazy.estimateRequestSchema.parse(section.inputs.request)).toEqual(section.inputs.request)
    expect(lazy.estimateSectionSchema.safeParse({ ...section, disclosures: [] }).success).toBe(
      false,
    )
    expect(
      lazy.estimateRequestSchema.safeParse({
        ...section.inputs.request,
        goal: { kind: 'issues', numbers: [1, 1] },
      }).success,
    ).toBe(false)
  })
})

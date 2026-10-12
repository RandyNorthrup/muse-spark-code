// Help's feature entries combine the feature's own details with the reference
// generator's REFERENCE_DETAILS. Lane MONEY017E found the merge overwrote the
// feature-level list, which erased the schedules media limitation (and the
// accounts developer detail) from Help before accounts publication was removed.

import { describe, expect, it } from 'vitest'
import { featureCatalog } from '../../src/shared/featureCatalog'
import { EN } from '../../src/shared/l10n/en'
import { referenceModel } from '../../src/shared/reference/reference.generated'

/** The `ui` keys of one catalogue entry's details. */
function detailKeys(id: string): string[] {
  const feature = featureCatalog().find((entry) => entry.id === id)
  if (feature === undefined) throw new Error(`missing feature: ${id}`)
  return feature.details.flatMap((detail) => ('ui' in detail ? [detail.ui] : []))
}

describe('feature catalogue details merge', () => {
  it('keeps the schedules feature-level details beside reference details', () => {
    expect(detailKeys('schedules')).toContain('referenceAttachments')
    expect(detailKeys('schedules')).toContain('scheduledMediaSupport')
  })

  it('publishes accounts with the developer detail beside the developer CLI route', () => {
    expect(detailKeys('accounts')).toEqual(['referenceDeveloper'])
    const published = referenceModel()
    expect(published.features.find((feature) => feature.id === 'accounts')?.details).toEqual([
      { ui: 'referenceDeveloper' },
    ])
    expect(published.cli.some((command) => command.route === 'developer')).toBe(true)
  })

  it('still merges the reference details in', () => {
    expect(detailKeys('chat')).toContain('referenceThinking')
    expect(detailKeys('permissions')).toContain('referencePermissionLimits')
    // The train keeps the vault dormant (REFERENCE_IN_PROGRESS_FEATURES), so
    // Help shows the in-progress summary with no feature details.
    expect(detailKeys('vault')).toEqual([])
  })

  it('ships the schedules limitation in the generated reference model', () => {
    const schedules = referenceModel().features.find((feature) => feature.id === 'schedules')
    if (schedules === undefined) throw new Error('missing generated schedules feature')
    const keys = schedules.details.flatMap((detail) => ('ui' in detail ? [detail.ui] : []))
    expect(keys).toContain('scheduledMediaSupport')
    expect(EN.scheduledMediaSupport).toContain('unsupported in this version')
  })
})

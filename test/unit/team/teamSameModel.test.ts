// Lane R (M96, PLAN.md D75): model identity for the single-model rule.

import { describe, expect, it } from 'vitest'
import {
  distinctTeamModels,
  isSingleTeamModel,
  normalizeTeamModelId,
  isSameTeamModel,
} from '../../../src/core/team/sameModel'

describe('isSameTeamModel', () => {
  it('matches after trimming, exactly', () => {
    expect(isSameTeamModel('muse-spark-1.3', '  muse-spark-1.3 ')).toBe(true)
    expect(normalizeTeamModelId('  muse-spark-1.3 ')).toBe('muse-spark-1.3')
  })

  it('treats the same model on two providers as one model', () => {
    // Acceptance 47's duplicate models: the orchestrator's own model with
    // other caps or through another provider is still single-model mode.
    // A check that compared providers instead would count two here.
    expect(distinctTeamModels(['muse-spark-1.3', 'muse-spark-1.3'])).toEqual(['muse-spark-1.3'])
    expect(isSingleTeamModel(['muse-spark-1.3', 'muse-spark-1.3'])).toBe(true)
  })

  it('tells two models apart, whatever serves them', () => {
    expect(isSameTeamModel('muse-spark-1.3', 'muse-spark-1.3-contributor')).toBe(false)
    expect(isSameTeamModel('Muse-Spark-1.3', 'muse-spark-1.3')).toBe(false)
    expect(isSingleTeamModel(['muse-spark-1.3', 'muse-spark-1.3-contributor'])).toBe(false)
  })

  it('counts nothing configured as single-model mode', () => {
    expect(isSingleTeamModel([])).toBe(true)
    expect(distinctTeamModels([])).toEqual([])
  })
})

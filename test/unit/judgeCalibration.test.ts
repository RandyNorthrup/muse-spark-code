import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyCalibration } from '../../src/core/judge/calibration/apply'
import { calibrationProbability, fitCalibration } from '../../src/core/judge/calibration/fit'
import { reportCalibration } from '../../src/core/judge/calibration/report'
import { judgeProfileIdentitySchema } from '../../src/core/judge/schema'
import {
  parseCalibrationDataset,
  parseCalibrationProfile,
  type CalibrationDataset,
  type CalibrationIdentity,
  type CalibrationLimits,
  type CalibrationProfile,
} from '../../src/core/judge/calibration/schema'

const limits: CalibrationLimits = {
  maxSamples: 2000,
  maxIdentifierLength: 256,
  maxBins: 20,
  isotonicMinimumLabels: 200,
  probabilityEpsilon: 1e-6,
  maxIterations: 100,
  convergenceTolerance: 1e-8,
  regularization: 1e-6,
  weightFloor: 1e-6,
}

function dataset(): CalibrationDataset {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL('../fixtures/judge/calibration/grouped-risk.json', import.meta.url),
      'utf8',
    ),
  )
  const parsed = parseCalibrationDataset(raw, limits)
  if (parsed.status !== 'valid') throw new Error(parsed.reason)
  return parsed.dataset
}

function fitted(input = dataset(), method: 'platt' | 'isotonic' = 'platt'): CalibrationProfile {
  const result = fitCalibration(input, method, limits)
  if (result.status !== 'fitted') throw new Error(result.reason)
  return result.profile
}

function withFitCount(count: number): CalibrationDataset {
  const input = dataset()
  const base = input.samples.filter((row) => row.split === 'fit')
  input.samples = [
    ...Array.from({ length: count }, (_, index) => ({
      ...base[index % base.length]!,
      id: `fit-${String(index)}`,
      labelId: `hand-fit-${String(index)}`,
      taskGroup: `fit-task-${String(index)}`,
    })),
    ...input.samples.filter((row) => row.split !== 'fit'),
  ]
  return input
}

describe('calibration family labels and grouped splits', () => {
  it('uses independent family labels even when a destructive command was approved', () => {
    const labels: unknown = JSON.parse(
      readFileSync(new URL('../fixtures/judge/calibration/labels.json', import.meta.url), 'utf8'),
    )
    expect(labels).toMatchObject({
      'risk.destructive': expect.arrayContaining([
        expect.objectContaining({
          state: 'rm -rf ./data',
          label: 1,
          labelSource: 'independent-hand',
        }),
      ]),
    })
    const input = dataset()
    expect(fitCalibration(input, 'platt', limits).status).toBe('fitted')
    input.identity.family = 'skill.fit'
    expect(fitCalibration(input, 'platt', limits)).toMatchObject({ reason: 'invalid-label-source' })
    for (const row of input.samples) row.labelSource = 'm75-routing'
    expect(fitCalibration(input, 'platt', limits).status).toBe('fitted')
    input.identity.family = 'risk.destructive'
    expect(fitCalibration(input, 'platt', limits)).toMatchObject({ reason: 'invalid-label-source' })
    for (const row of input.samples) row.labelSource = 'm75'
    expect(fitCalibration(input, 'platt', limits).status).toBe('fitted')
  })

  it.each([
    'approval',
    'test-success',
    'reviewer',
    'logprob',
    'model-belief',
    'suggestion-accepted',
  ])('excludes %s as factual labels', (labelSource) => {
    const input = dataset()
    const samples = input.samples.map((row) => ({ ...row, labelSource }))
    expect(fitCalibration({ ...input, samples }, 'platt', limits)).toEqual({
      status: 'uncalibrated',
      reason: 'invalid-dataset',
    })
  })

  it('rejects outcome/content fields instead of mixing optional signals with labels', () => {
    const input = dataset()
    expect(
      fitCalibration({ ...input, outcomeSignals: ['approved'] }, 'platt', limits),
    ).toMatchObject({ reason: 'invalid-dataset' })
    expect(
      fitCalibration(
        { ...input, samples: input.samples.map((row) => ({ ...row, vendorConfidence: 1 })) },
        'platt',
        limits,
      ),
    ).toMatchObject({ reason: 'invalid-dataset' })
  })

  it.each(['taskGroup', 'repositoryGroup'] as const)(
    'refuses an evaluation %s reused in fit or tuning',
    (key) => {
      for (const split of ['fit', 'tuning'] as const) {
        const input = dataset()
        input.samples.find((row) => row.split === split)![key] = input.samples.find(
          (row) => row.split === 'evaluation',
        )![key]
        expect(fitCalibration(input, 'platt', limits)).toEqual({
          status: 'uncalibrated',
          reason: 'overlapping-groups',
        })
      }
    },
  )

  it.each(['id', 'labelId'] as const)('counts an independent %s once', (key) => {
    const input = dataset()
    input.samples[1]![key] = input.samples[0]![key]
    expect(fitCalibration(input, 'platt', limits)).toMatchObject({ reason: 'duplicate-label' })
  })

  it.each(['fit', 'tuning', 'evaluation'] as const)('refuses a missing %s split', (split) => {
    const input = dataset()
    input.samples = input.samples.filter((row) => row.split !== split)
    expect(fitCalibration(input, 'platt', limits)).toMatchObject({ reason: 'missing-split' })
  })

  it('bounds datasets, identifiers, finite probabilities and binary labels', () => {
    const input = dataset()
    expect(fitCalibration(input, 'platt', { ...limits, maxSamples: 1 })).toMatchObject({
      reason: 'invalid-dataset',
    })
    for (const probability of [NaN, Infinity, -0.1, 1.1]) {
      input.samples[0]!.probability = probability
      expect(fitCalibration(input, 'platt', limits)).toMatchObject({ reason: 'invalid-dataset' })
    }
    for (const identity of [
      { ...dataset().identity, model: '' },
      { ...dataset().identity, modelVersion: 'x'.repeat(257) },
    ]) {
      expect(fitCalibration({ ...dataset(), identity }, 'platt', limits)).toMatchObject({
        reason: 'invalid-dataset',
      })
    }
    const rows = dataset().samples
    expect(
      fitCalibration(
        { ...dataset(), samples: [{ ...rows[0], label: 0.5 }, ...rows.slice(1)] },
        'platt',
        limits,
      ),
    ).toMatchObject({ reason: 'invalid-dataset' })
    rows[0]!.taskGroup = ' '
    expect(fitCalibration({ ...dataset(), samples: rows }, 'platt', limits)).toMatchObject({
      reason: 'invalid-dataset',
    })
  })

  it('refuses unsupported families and techniques explicitly', () => {
    for (const family of ['unknown', 'context.relevance']) {
      expect(
        fitCalibration(
          { ...dataset(), identity: { ...dataset().identity, family } },
          'platt',
          limits,
        ),
      ).toMatchObject({ reason: 'unsupported-family' })
    }
    for (const technique of ['top1', 'sampling', 'contrastive', 'vendor-confidence']) {
      expect(
        fitCalibration(
          { ...dataset(), identity: { ...dataset().identity, technique } },
          'platt',
          limits,
        ),
      ).toMatchObject({ reason: 'unsupported-technique' })
    }
  })

  it('refuses invalid injected limits, including a lowered 200-label floor', () => {
    for (const invalid of [
      { maxSamples: 0 },
      { maxIdentifierLength: 0 },
      { maxBins: 0 },
      { isotonicMinimumLabels: 199 },
      { probabilityEpsilon: 0 },
      { probabilityEpsilon: Number.MIN_VALUE },
      { probabilityEpsilon: 0.5 },
      { maxIterations: 0 },
      { convergenceTolerance: NaN },
      { regularization: 0 },
      { weightFloor: 0 },
      { weightFloor: Number.MIN_VALUE },
    ]) {
      expect(fitCalibration(dataset(), 'platt', { ...limits, ...invalid })).toMatchObject({
        reason: 'invalid-limits',
      })
    }
  })
})

describe('binary fitting', () => {
  it('fits the known overconfident distribution with Platt scaling', () => {
    const profile = fitted()
    expect(profile.fit).toMatchObject({
      method: 'platt',
      slope: expect.closeTo(0.5, 3),
      intercept: expect.closeTo(0, 5),
    })
    expect(calibrationProbability(profile, 0.1)).toBeCloseTo(0.25, 4)
    expect(calibrationProbability(profile, 0.9)).toBeCloseTo(0.75, 4)
    expect(profile.evaluation).toBeUndefined()
  })

  it('never fits evaluation or tuning labels; weights use tuning only', () => {
    const baseline = fitted()
    const input = dataset()
    for (const row of input.samples) if (row.split !== 'fit') row.label = row.label === 1 ? 0 : 1
    const changed = fitted(input)
    expect(changed.fit).toEqual(baseline.fit)
    expect(changed.combinationWeight).toBeLessThan(baseline.combinationWeight)
    const evalOnly = dataset()
    for (const row of evalOnly.samples)
      if (row.split === 'evaluation') row.label = row.label === 1 ? 0 : 1
    expect(fitted(evalOnly)).toEqual(baseline)
  })

  it('learns an intercept and can correct an inverted binary predictor', () => {
    const input = dataset()
    input.samples[2]!.label = 1
    const biased = fitted(input)
    expect(calibrationProbability(biased, 0.1)).toBeCloseTo(0.5, 4)
    expect(calibrationProbability(biased, 0.9)).toBeCloseTo(0.75, 4)
    for (const row of input.samples) if (row.split === 'fit') row.label = row.label === 1 ? 0 : 1
    const inverted = fitted(input)
    expect(calibrationProbability(inverted, 0.9)).toBeCloseTo(0.25, 4)
    expect(calibrationProbability(inverted, 0.1)).toBeCloseTo(0.5, 4)
  })

  it('bounds endpoint predictions and keeps separated data finite', () => {
    const input = dataset()
    for (const row of input.samples)
      if (row.split === 'fit') {
        row.probability = row.label
      }
    const profile = fitted(input)
    for (const p of [0, Number.MIN_VALUE, 0.5, 1 - Number.EPSILON, 1]) {
      const prediction = calibrationProbability(profile, p)
      expect(Number.isFinite(prediction)).toBe(true)
      expect(prediction).toBeGreaterThanOrEqual(0)
      expect(prediction).toBeLessThanOrEqual(1)
    }
    for (const p of [NaN, Infinity, -1, 2]) {
      expect(() => calibrationProbability(profile, p)).toThrow('invalid-probability')
    }
  })

  it('refuses one-class or constant-probability fit data', () => {
    for (const field of ['label', 'probability'] as const) {
      const input = dataset()
      for (const row of input.samples) if (row.split === 'fit') row[field] = 1
      expect(fitCalibration(input, 'platt', limits)).toMatchObject({ reason: 'degenerate-dataset' })
    }
  })

  it('returns an explicit failure when optimization cannot converge', () => {
    expect(fitCalibration(dataset(), 'platt', { ...limits, maxIterations: 1 })).toEqual({
      status: 'uncalibrated',
      reason: 'fit-did-not-converge',
    })
  })

  it('refuses isotonic at 199 fit labels even with more labels in other splits', () => {
    expect(fitCalibration(withFitCount(199), 'isotonic', limits)).toEqual({
      status: 'uncalibrated',
      reason: 'insufficient-isotonic-labels',
    })
    const profile = fitted(withFitCount(200), 'isotonic')
    expect(profile.fit).toEqual({
      method: 'isotonic',
      knots: [
        { probability: 0.1, calibratedProbability: 0.25 },
        { probability: 0.9, calibratedProbability: 0.75 },
      ],
    })
    expect(calibrationProbability(profile, 0)).toBe(0.25)
    expect(calibrationProbability(profile, 0.9)).toBe(0.75)
    expect(calibrationProbability(profile, 1)).toBe(0.75)
  })

  it('pools decreasing blocks and aggregates ties before pooling', () => {
    const input = withFitCount(200)
    const rows = input.samples.filter((row) => row.split === 'fit')
    for (const [index, row] of rows.entries()) {
      row.probability = index < 100 ? 0.1 : 0.2
      row.label = index < 80 || (index >= 100 && index < 190) ? 1 : 0
    }
    expect(fitted(input, 'isotonic').fit).toEqual({
      method: 'isotonic',
      knots: [
        { probability: 0.1, calibratedProbability: 0.8 },
        { probability: 0.2, calibratedProbability: 0.9 },
      ],
    })
    for (const row of rows) row.label = row.label === 1 ? 0 : 1
    expect(fitted(input, 'isotonic').fit).toEqual({
      method: 'isotonic',
      knots: [{ probability: 0.1, calibratedProbability: 0.15 }],
    })
  })
})

describe('evaluation-only reports and runtime profiles', () => {
  it('fits and reports the shared exact provider-bound profile identity', () => {
    const input = dataset()
    input.identity = judgeProfileIdentitySchema.parse({
      ...input.identity,
      providerId: 'provider-A',
    })
    const profile = fitted(input)
    expect(profile.identity).toEqual(input.identity)
    expect(judgeProfileIdentitySchema.parse(profile.identity)).toEqual(input.identity)
    const reported = reportCalibration(profile, input, 5, limits)
    if (reported.status !== 'reported') throw new Error(reported.reason)
    expect(judgeProfileIdentitySchema.parse(reported.profile.identity)).toEqual(input.identity)
  })

  it('refuses an independently evaluated profile for another provider at the same endpoint', () => {
    const input = dataset()
    input.identity = judgeProfileIdentitySchema.parse({
      ...input.identity,
      providerId: 'provider-A',
    })
    // This simulates trusted evidence under test only; it is no real receipt.
    input.evidence = 'independent'
    const reported = reportCalibration(fitted(input), input, 5, limits)
    if (reported.status !== 'reported') throw new Error(reported.reason)
    expect(applyCalibration(reported.profile, input.identity, 0.1, false, limits)).toMatchObject({
      status: 'calibrated',
    })
    const anotherProvider = judgeProfileIdentitySchema.parse({
      ...input.identity,
      providerId: 'provider-B',
    })
    expect(applyCalibration(reported.profile, anotherProvider, 0.1, false, limits)).toEqual({
      status: 'uncalibrated',
      reason: 'profile-mismatch',
    })
    expect(
      reportCalibration(reported.profile, { ...input, identity: anotherProvider }, 5, limits),
    ).toEqual({ status: 'uncalibrated', reason: 'profile-mismatch' })
  })

  it('requires a bounded nonblank provider identity in datasets and persisted profiles', () => {
    const input = dataset()
    const profile = fitted(input)
    for (const providerId of [undefined, '', ' ', 'x'.repeat(257), 1]) {
      const identity = { ...input.identity, providerId }
      expect(fitCalibration({ ...input, identity }, 'platt', limits)).toEqual({
        status: 'uncalibrated',
        reason: 'invalid-dataset',
      })
      expect(parseCalibrationProfile({ ...profile, identity }, limits)).toBeUndefined()
    }
  })

  it('reports ECE/Brier from evaluation only, with counts and the uncalibrated arm', () => {
    const profile = { ...fitted(), fit: { method: 'platt', slope: 0, intercept: 0 } }
    const result = reportCalibration(profile, dataset(), 5, limits)
    expect(result).toMatchObject({
      status: 'reported',
      report: {
        sampleCounts: { fit: 8, tuning: 2, evaluation: 2 },
        activationEligible: false,
        evaluation: {
          evidence: 'synthetic',
          bins: 5,
          uncalibrated: { sampleCount: 2, brier: expect.closeTo(0.04), ece: expect.closeTo(0.2) },
          calibrated: { sampleCount: 2, brier: 0.25, ece: 0 },
        },
      },
    })
    expect(JSON.stringify(result)).not.toContain('tuningBrier')
    const changed = dataset()
    for (const row of changed.samples)
      if (row.split !== 'evaluation') {
        row.probability = row.label
      }
    expect(reportCalibration(profile, changed, 5, limits)).toEqual(result)
  })

  it('puts p=1 in the last ECE bin and refuses invalid bin counts', () => {
    const input = dataset()
    for (const row of input.samples) if (row.split === 'evaluation') row.probability = row.label
    const profile = { ...fitted(input), fit: { method: 'platt', slope: 1, intercept: 0 } }
    expect(reportCalibration(profile, input, 1, limits)).toMatchObject({
      status: 'reported',
      report: { evaluation: { uncalibrated: { brier: 0, ece: 0 } } },
    })
    for (const bins of [0, 21, 1.5, NaN])
      expect(reportCalibration(profile, input, bins, limits)).toMatchObject({
        reason: 'invalid-limits',
      })
  })

  it('refuses a changed evaluation partition or overlapping profile groups', () => {
    const input = dataset()
    const profile = fitted(input)
    input.samples.at(-1)!.taskGroup = 'new-evaluation-group'
    expect(reportCalibration(profile, input, 5, limits)).toMatchObject({
      reason: 'partition-mismatch',
    })
    profile.partitions.fit.tasks[0] = profile.partitions.evaluation.tasks[0]!
    expect(reportCalibration(profile, dataset(), 5, limits)).toMatchObject({
      reason: 'invalid-profile',
    })
  })

  it('keeps a fitted or synthetic-evaluated profile uncalibrated', () => {
    const input = dataset()
    const profile = fitted(input)
    expect(applyCalibration(profile, input.identity, 0.8, false, limits)).toMatchObject({
      reason: 'independent-evaluation-required',
    })
    const result = reportCalibration(profile, input, 5, limits)
    if (result.status !== 'reported') throw new Error(result.reason)
    expect(applyCalibration(result.profile, input.identity, 0.8, false, limits)).toMatchObject({
      reason: 'independent-evaluation-required',
    })
  })

  it('allows an independently evaluated exact profile and keeps the technique label', () => {
    for (const technique of ['stated', 'logprob']) {
      const input = dataset()
      // This simulates trusted evidence under test only; it is no real receipt.
      input.evidence = 'independent'
      input.identity.technique = technique
      const result = reportCalibration(fitted(input), input, 5, limits)
      if (result.status !== 'reported') throw new Error(result.reason)
      expect(result.report.activationEligible).toBe(true)
      expect(applyCalibration(result.profile, input.identity, 0.1, false, limits)).toMatchObject({
        status: 'calibrated',
        probability: expect.closeTo(0.25, 4),
        label: `calibrated (${technique})`,
        combinationWeight: expect.any(Number),
      })
    }
  })

  it.each([
    'providerId',
    'model',
    'modelVersion',
    'endpoint',
    'source',
    'technique',
    'family',
    'promptVersion',
    'criteriaVersion',
    'fitVersion',
  ] as const)('never inherits a profile after %s changes', (key) => {
    const input = dataset()
    const profile = fitted(input)
    const identity: CalibrationIdentity = { ...input.identity }
    switch (key) {
      case 'source': {
        identity.source = 'separate'
        break
      }
      case 'technique': {
        identity.technique = 'logprob'
        break
      }
      case 'family': {
        identity.family = 'skill.fit'
        break
      }
      default: {
        identity[key] = `${identity[key]}-changed`
      }
    }
    expect(applyCalibration(profile, identity, 0.1, false, limits)).toMatchObject({
      reason: 'profile-mismatch',
    })
    const changed = {
      ...input,
      identity,
      samples: input.samples.map((row) => ({
        ...row,
        labelSource: key === 'family' ? 'm75-routing' : row.labelSource,
      })),
    }
    expect(reportCalibration(profile, changed, 5, limits)).toMatchObject({
      reason: 'profile-mismatch',
    })
  })

  it('refuses partial, approximate, unsupported and corrupt runtime probabilities', () => {
    const input = dataset()
    input.evidence = 'independent'
    const reported = reportCalibration(fitted(input), input, 5, limits)
    if (reported.status !== 'reported') throw new Error(reported.reason)
    const profile = reported.profile
    expect(applyCalibration(profile, input.identity, 0.1, true, limits)).toMatchObject({
      reason: 'partial-result',
    })
    expect(
      applyCalibration(profile, { ...input.identity, technique: 'top1' }, 0.9, false, limits),
    ).toMatchObject({ reason: 'unsupported-technique' })
    expect(
      applyCalibration(profile, { ...input.identity, family: 'unknown' }, 0.9, false, limits),
    ).toMatchObject({ reason: 'unsupported-family' })
    for (const p of [NaN, Infinity, -1, 2])
      expect(applyCalibration(profile, input.identity, p, false, limits)).toMatchObject({
        reason: 'invalid-probability',
      })
  })

  it('validates persisted parameters, partitions, evaluation and identity before use', () => {
    const input = dataset()
    const profile = fitted(input)
    for (const corrupt of [
      null,
      { ...profile, fit: { method: 'platt', slope: Infinity, intercept: 0 } },
      { ...profile, combinationWeight: 0 },
      { ...profile, epsilon: 0 },
      { ...profile, identity: { ...profile.identity, model: '' } },
    ]) {
      expect(parseCalibrationProfile(corrupt, limits)).toBeUndefined()
      expect(applyCalibration(corrupt, input.identity, 0.5, false, limits)).toMatchObject({
        reason: 'invalid-profile',
      })
    }
    expect(parseCalibrationProfile(profile, { ...limits, regularization: 0 })).toBeUndefined()
    for (const field of ['ids', 'labels', 'tasks', 'repositories'] as const) {
      const corrupt = structuredClone(profile)
      corrupt.partitions.tuning[field] = []
      expect(parseCalibrationProfile(corrupt, limits)).toBeUndefined()
      corrupt.partitions.tuning[field] = [...profile.partitions.tuning[field]]
      corrupt.partitions.tuning[field][0] = corrupt.partitions.fit[field][0]!
      expect(parseCalibrationProfile(corrupt, limits)).toBeUndefined()
    }
    const mismatchedCounts = structuredClone(profile)
    mismatchedCounts.partitions.fit.labels.pop()
    expect(parseCalibrationProfile(mismatchedCounts, limits)).toBeUndefined()
    const tooManyGroups = structuredClone(profile)
    tooManyGroups.partitions.tuning.tasks.push('extra-task')
    expect(parseCalibrationProfile(tooManyGroups, limits)).toBeUndefined()
    const tooManyRepositories = structuredClone(profile)
    tooManyRepositories.partitions.tuning.repositories.push('extra-repo-1', 'extra-repo-2')
    expect(parseCalibrationProfile(tooManyRepositories, limits)).toBeUndefined()
    for (const id of [' ', 'x'.repeat(257)]) {
      const corruptIdentifier = structuredClone(profile)
      corruptIdentifier.partitions.fit.ids[0] = id
      expect(parseCalibrationProfile(corruptIdentifier, limits)).toBeUndefined()
    }
    expect(parseCalibrationProfile(profile, { ...limits, maxSamples: 1 })).toBeUndefined()
    expect(parseCalibrationProfile(profile, { ...limits, maxSamples: 8 })).toBeUndefined()
    const emptyPartition = structuredClone(profile)
    emptyPartition.partitions.tuning = { ids: [], labels: [], tasks: [], repositories: [] }
    expect(parseCalibrationProfile(emptyPartition, limits)).toBeUndefined()
    const reported = reportCalibration(profile, input, 5, limits)
    if (reported.status !== 'reported') throw new Error(reported.reason)
    for (const invalid of [
      { evidence: 'independent' },
      { bins: 21 },
      { calibrated: { sampleCount: 1, ece: 0, brier: 0 } },
      { uncalibrated: { sampleCount: 1, ece: 0, brier: 0 } },
    ]) {
      expect(
        parseCalibrationProfile(
          { ...reported.profile, evaluation: { ...reported.profile.evaluation, ...invalid } },
          limits,
        ),
      ).toBeUndefined()
    }
    expect(
      reportCalibration(profile, { ...input, evidence: 'independent' }, 5, limits),
    ).toMatchObject({ reason: 'profile-mismatch' })
  })

  it('rejects empty, nonmonotonic or undersized persisted isotonic fits', () => {
    const profile = fitted(withFitCount(200), 'isotonic')
    for (const knots of [
      [],
      [
        { probability: 0.9, calibratedProbability: 0.7 },
        { probability: 0.1, calibratedProbability: 0.8 },
      ],
      [
        { probability: 0.1, calibratedProbability: 0.8 },
        { probability: 0.9, calibratedProbability: 0.7 },
      ],
    ]) {
      expect(
        parseCalibrationProfile({ ...profile, fit: { method: 'isotonic', knots } }, limits),
      ).toBeUndefined()
    }
    const tooManyKnots = {
      ...profile,
      fit: {
        method: 'isotonic',
        knots: Array.from({ length: 201 }, (_, index) => ({
          probability: index / 200,
          calibratedProbability: index / 200,
        })),
      },
    }
    expect(parseCalibrationProfile(tooManyKnots, limits)).toBeUndefined()
    profile.partitions.fit.labels.pop()
    profile.partitions.fit.ids.pop()
    profile.partitions.fit.tasks.pop()
    expect(parseCalibrationProfile(profile, limits)).toBeUndefined()
    const empty: CalibrationProfile = { ...profile, fit: { method: 'isotonic', knots: [] } }
    expect(() => calibrationProbability(empty, 0.5)).toThrow('invalid-profile')
  })

  it('reports explicit invalid input/profile failures and ignores JSON key order', () => {
    const profile = fitted()
    expect(reportCalibration(profile, {}, 5, limits)).toMatchObject({ reason: 'invalid-dataset' })
    expect(reportCalibration({}, dataset(), 5, limits)).toMatchObject({ reason: 'invalid-profile' })
    const input = dataset()
    const reordered = {
      fitVersion: input.identity.fitVersion,
      criteriaVersion: input.identity.criteriaVersion,
      promptVersion: input.identity.promptVersion,
      family: input.identity.family,
      technique: input.identity.technique,
      source: input.identity.source,
      endpoint: input.identity.endpoint,
      modelVersion: input.identity.modelVersion,
      model: input.identity.model,
      providerId: input.identity.providerId,
    }
    input.identity = reordered
    input.samples.reverse()
    expect(reportCalibration(profile, input, 5, limits).status).toBe('reported')
  })
})

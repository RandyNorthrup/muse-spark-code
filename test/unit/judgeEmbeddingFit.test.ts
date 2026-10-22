// Fitting guards for the embedding fast path (M98 phase 2, lane I).
// Fakes and synthetic fixtures only; no live, paid or local model calls.

import { describe, expect, it } from 'vitest'
import { fitEmbeddingHead, scoreEmbedding, sigmoid } from '../../src/core/judge/embedding/fit'
import {
  embeddingHeadDigest,
  parseEmbeddingDataset,
  parseEmbeddingHead,
  parseWeightEnvelope,
  weightEnvelopeFor,
} from '../../src/core/judge/embedding/schema'
import {
  embeddingLimits,
  fixtureDatasetInput,
  groupedDataset,
  trainedHead,
} from './judgeEmbeddingFixtures'

describe('embedding sigmoid and scoring', () => {
  it('saturates without overflowing', () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(1000)).toBe(1)
    expect(sigmoid(-1000)).toBe(0)
  })

  it('refuses to score a mismatched or non-finite vector', () => {
    expect(scoreEmbedding([1, 0], 0, [0.5])).toBeUndefined()
    expect(scoreEmbedding([1, 0], 0, [0.5, NaN])).toBeUndefined()
    expect(scoreEmbedding([1, 0], Infinity, [0.5, 0.5])).toBeUndefined()
    const probability = scoreEmbedding([4, -4], 0, [0.9, 0.1])
    expect(probability).toBeGreaterThan(0.9)
  })

  it.each([
    ['null', [0.9, null]],
    ['undefined', [0.9, undefined]],
    ['sparse', Object.assign(Array.from({ length: 2 }), { 0: 0.9 })],
    ['string', [0.9, '0.1']],
    ['infinite', [0.9, Infinity]],
  ])('refuses the %s component before scoring arithmetic (RVM98P2IC 2)', (_name, vector) => {
    // Reflect models an untyped source crossing the public numeric signature.
    const probability: unknown = Reflect.apply(scoreEmbedding, undefined, [[4, -4], 0, vector])
    expect(probability).toBeUndefined()
  })

  it('refuses arithmetic overflow from otherwise finite components', () => {
    expect(scoreEmbedding([2], 0, [Number.MAX_VALUE])).toBeUndefined()
  })
})

describe('embedding dataset parsing', () => {
  it('accepts the synthetic grouped fixture with disjoint groups', () => {
    const parsed = parseEmbeddingDataset(fixtureDatasetInput(), embeddingLimits)
    expect(parsed.status).toBe('valid')
  })

  it('refuses a dimension mismatch against the head identity', () => {
    const dataset = groupedDataset(6)
    const broken = {
      ...dataset,
      samples: [{ ...dataset.samples[0]!, embedding: [0.5, 0.5] }],
    }
    expect(parseEmbeddingDataset(broken, embeddingLimits)).toEqual({
      status: 'refused',
      reason: 'dimension-mismatch',
    })
  })

  it('refuses a reused task group across splits', () => {
    const dataset = groupedDataset(6)
    const broken = {
      ...dataset,
      samples: dataset.samples.map((sample, index) =>
        index === 0 ? { ...sample, taskGroup: 'eval-task' } : sample,
      ),
    }
    expect(parseEmbeddingDataset(broken, embeddingLimits)).toEqual({
      status: 'refused',
      reason: 'overlapping-groups',
    })
  })

  it('refuses a duplicate label and a missing split', () => {
    const dataset = groupedDataset(6)
    const duplicate = {
      ...dataset,
      samples: dataset.samples.map((sample, index) =>
        index === 1 ? { ...sample, labelId: dataset.samples[0]!.labelId } : sample,
      ),
    }
    expect(parseEmbeddingDataset(duplicate, embeddingLimits)).toEqual({
      status: 'refused',
      reason: 'duplicate-label',
    })
    const missing = {
      ...dataset,
      samples: dataset.samples.filter((sample) => sample.split !== 'evaluation'),
    }
    expect(parseEmbeddingDataset(missing, embeddingLimits)).toEqual({
      status: 'refused',
      reason: 'missing-split',
    })
  })

  it('refuses an approval treated as truth and an unknown family', () => {
    const dataset = groupedDataset(6)
    const approval = {
      ...dataset,
      samples: dataset.samples.map((sample) => ({ ...sample, labelSource: 'approved' })),
    }
    expect(parseEmbeddingDataset(approval, embeddingLimits)).toEqual({
      status: 'refused',
      reason: 'invalid-dataset',
    })
    const family = {
      ...dataset,
      identity: { ...dataset.identity, family: 'unmeasured-family' },
    }
    expect(parseEmbeddingDataset(family, embeddingLimits)).toEqual({
      status: 'refused',
      reason: 'unsupported-family',
    })
  })
})

describe('embedding head fitting', () => {
  it('refuses training without an explicit opt-in', () => {
    expect(fitEmbeddingHead(groupedDataset(6), { optedIn: false }, embeddingLimits)).toEqual({
      status: 'refused',
      reason: 'opt-in-required',
    })
  })

  it('refuses to enable on the 40-label prototype below the evidence bar', () => {
    const prototype = groupedDataset(40)
    expect(
      fitEmbeddingHead(prototype, { optedIn: true }, { ...embeddingLimits, minLabels: 200 }),
    ).toEqual({ status: 'refused', reason: 'insufficient-labels' })
  })

  it('refuses a degenerate single-label fit set', () => {
    const dataset = groupedDataset(6)
    const single = {
      ...dataset,
      samples: dataset.samples.map((sample) =>
        sample.split === 'fit' ? { ...sample, label: 1 as const } : sample,
      ),
    }
    expect(fitEmbeddingHead(single, { optedIn: true }, embeddingLimits)).toEqual({
      status: 'refused',
      reason: 'degenerate-dataset',
    })
  })

  it('fits the synthetic fixture into a verifying head with grouped partitions', () => {
    const head = trainedHead()
    expect(head.trainedLabels).toBe(12)
    expect(head.evidence).toBe('synthetic')
    expect(parseEmbeddingHead(head).status).toBe('valid')
    expect(head.digest).toBe(embeddingHeadDigest(head))
    expect(head.partitions.fit.tasks).toEqual(['fit-task-a', 'fit-task-b'])
    expect(head.partitions.tuning.tasks).toEqual(['tune-task-a'])
    expect(head.partitions.evaluation.ids).toHaveLength(4)
    const positive = scoreEmbedding(head.weights, head.bias, [0.9, 0.1, 0.5])
    const negative = scoreEmbedding(head.weights, head.bias, [0.1, 0.9, 0.5])
    expect(positive).toBeGreaterThan(0.9)
    expect(negative).toBeLessThan(0.1)
  })

  it('refuses corrupt weights whose digest no longer matches', () => {
    const head = trainedHead()
    const tampered = { ...head, weights: [head.weights[0]! + 1, ...head.weights.slice(1)] }
    expect(parseEmbeddingHead(tampered)).toEqual({
      status: 'refused',
      reason: 'weight-digest-mismatch',
    })
  })

  it('binds the stored partitions to the head digest', () => {
    const head = trainedHead()
    // A trimmed but otherwise disjoint record: only the digest may refuse it.
    const trimmed = {
      ...head,
      partitions: {
        ...head.partitions,
        evaluation: {
          ...head.partitions.evaluation,
          ids: head.partitions.evaluation.ids.slice(1),
          labels: head.partitions.evaluation.labels.slice(1),
        },
      },
    }
    // Untouched digest: the edited record no longer verifies.
    expect(parseEmbeddingHead(trimmed)).toEqual({
      status: 'refused',
      reason: 'weight-digest-mismatch',
    })
    expect(parseWeightEnvelope(weightEnvelopeFor(trimmed))).toEqual({
      status: 'refused',
      reason: 'weight-digest-mismatch',
    })
  })

  it('refuses a re-digested record with overlapping or emptied partitions', () => {
    const head = trainedHead()
    const overlapping = {
      ...head,
      partitions: {
        ...head.partitions,
        evaluation: {
          ...head.partitions.evaluation,
          tasks: head.partitions.fit.tasks,
          repositories: head.partitions.fit.repositories,
        },
      },
    }
    const relabelled = { ...overlapping, digest: embeddingHeadDigest(overlapping) }
    expect(parseEmbeddingHead(relabelled)).toEqual({
      status: 'refused',
      reason: 'overlapping-groups',
    })
    expect(parseWeightEnvelope(weightEnvelopeFor(relabelled)).status).toBe('refused')
    const emptied = {
      ...head,
      partitions: {
        ...head.partitions,
        evaluation: { ids: [], labels: [], tasks: [], repositories: [] },
      },
    }
    const reemptied = { ...emptied, digest: embeddingHeadDigest(emptied) }
    expect(parseEmbeddingHead(reemptied)).toEqual({
      status: 'refused',
      reason: 'missing-split',
    })
    expect(parseWeightEnvelope(weightEnvelopeFor(reemptied)).status).toBe('refused')
  })

  it.each([['ids'], ['labels'], ['tasks'], ['repositories']] as const)(
    'refuses a re-digested record with a blank evaluation %s',
    (field) => {
      const head = trainedHead()
      const blanked = {
        ...head,
        partitions: {
          ...head.partitions,
          evaluation: { ...head.partitions.evaluation, [field]: [' '] },
        },
      }
      const redigested = { ...blanked, digest: embeddingHeadDigest(blanked) }
      expect(parseEmbeddingHead(redigested)).toEqual({
        status: 'refused',
        reason: 'invalid-dataset',
      })
      expect(parseWeightEnvelope(weightEnvelopeFor(redigested)).status).toBe('refused')
    },
  )

  it('loads weights only from the global-storage envelope, never a package', () => {
    const head = trainedHead()
    expect(parseWeightEnvelope(weightEnvelopeFor(head)).status).toBe('valid')
    expect(parseWeightEnvelope({ location: 'vsix', head })).toEqual({
      status: 'refused',
      reason: 'invalid-storage',
    })
    expect(parseWeightEnvelope({ location: 'bundle', head })).toEqual({
      status: 'refused',
      reason: 'invalid-storage',
    })
    expect(
      parseWeightEnvelope({ location: 'global-storage', head: { ...head, bias: 99 } }),
    ).toEqual({
      status: 'refused',
      reason: 'weight-digest-mismatch',
    })
  })
})

// Shared fakes for the embedding fast-path tests (M98 phase 2, lane I).
// Every dataset, vector and cost here is fabricated under `test/`; nothing
// is a model capture, a real receipt or evidence that a head is useful.

import { readFileSync } from 'node:fs'
import { fitEmbeddingHead } from '../../src/core/judge/embedding/fit'
import type { EmbeddingSource } from '../../src/core/judge/embedding/route'
import type {
  EmbeddingDataset,
  EmbeddingHead,
  EmbeddingLimits,
  EmbeddingSample,
} from '../../src/core/judge/embedding/schema'
import { Usd } from '../../src/shared/usd'

export const embeddingLimits: EmbeddingLimits = {
  maxSamples: 64,
  maxIdentifierLength: 64,
  maxDimension: 8,
  minLabels: 6,
  maxIterations: 5000,
  convergenceTolerance: 0.0000001,
  learningRate: 1,
  regularization: 0.01,
}

/** The synthetic labelled fixture, parsed but never certified. */
export function fixtureDatasetInput(): unknown {
  return JSON.parse(
    readFileSync(new URL('../fixtures/judge/embedding/labels.json', import.meta.url), 'utf8'),
  )
}

function uniqueSample(
  name: string,
  split: EmbeddingSample['split'],
  embedding: readonly number[],
  label: 0 | 1,
  taskGroup: string,
  repositoryGroup: string,
): EmbeddingSample {
  return {
    id: `sample-${name}`,
    labelId: `label-${name}`,
    taskGroup,
    repositoryGroup,
    split,
    embedding: [...embedding],
    label,
    labelSource: 'm75',
  }
}

/**
A synthetic dataset with grouped splits: each split owns its task and
repository groups. Fit rows alternate either side of the fixture's
separating direction so the head can learn them.
*/
export function groupedDataset(fitCount: number): EmbeddingDataset {
  const samples: EmbeddingSample[] = []
  for (let index = 0; index < fitCount; index += 1) {
    const isPositive = index % 2 === 0
    samples.push(
      uniqueSample(
        `fit-${String(index)}`,
        'fit',
        isPositive ? [0.9, 0.1, 0.5] : [0.1, 0.9, 0.5],
        isPositive ? 1 : 0,
        `fit-task-${String(index)}`,
        `fit-repo-${String(index)}`,
      ),
    )
  }
  samples.push(
    uniqueSample('tune-1', 'tuning', [0.85, 0.15, 0.5], 1, 'tune-task', 'tune-repo'),
    uniqueSample('tune-0', 'tuning', [0.15, 0.85, 0.5], 0, 'tune-task', 'tune-repo'),
    uniqueSample('eval-1', 'evaluation', [0.88, 0.12, 0.5], 1, 'eval-task', 'eval-repo'),
    uniqueSample('eval-0', 'evaluation', [0.12, 0.88, 0.5], 0, 'eval-task', 'eval-repo'),
  )
  return {
    identity: {
      providerId: 'fixture-provider',
      model: 'fixture-model',
      modelVersion: 'v1',
      endpoint: 'https://fixture.invalid/v1',
      source: 'same',
      technique: 'embedding',
      family: 'risk.destructive',
      promptVersion: 'prompt-1',
      criteriaVersion: 'criteria-1',
      fitVersion: 'fit-1',
      dimension: 3,
    },
    evidence: 'synthetic',
    samples,
  }
}

export function trainedHead(
  input: unknown = fixtureDatasetInput(),
  limits: EmbeddingLimits = embeddingLimits,
): EmbeddingHead {
  const fitted = fitEmbeddingHead(input, { optedIn: true }, limits)
  if (!('version' in fitted)) throw new Error(`fit refused: ${fitted.reason}`)
  return fitted
}

/**
Far along the fixture head's learned positive direction, with overwhelming
margin: the answered-path probe. Ordinary near-distribution vectors sit
under the fallback floor and exercise the fallback instead.
*/
export const confidentVectors: readonly (readonly number[])[] = [[2, -1, 0.5]]

/** An embedding source answering fixed vectors, recording every input batch. */
export function embeddingSource(overrides: Partial<EmbeddingSource> = {}): {
  source: EmbeddingSource
  calls: readonly (readonly string[])[]
} {
  const calls: (readonly string[])[] = []
  const { embed, ...rest } = overrides
  const source: EmbeddingSource = {
    providerId: 'fixture-provider',
    model: 'fixture-model',
    modelVersion: 'v1',
    endpoint: 'https://fixture.invalid/v1',
    source: 'same',
    locality: 'same-provider',
    providerPolicy: 'allow',
    dimension: 3,
    inputTokens: 12,
    uncachedCostUsd: Usd.from(0.0002).toAmount(),
    ...rest,
    embed: (inputs, signal) => {
      calls.push([...inputs])
      return embed === undefined
        ? Promise.resolve(inputs.map(() => [0.9, 0.1, 0.5]))
        : embed(inputs, signal)
    },
  }
  return { source, calls }
}

// Local, opt-in logistic-head training (M98 phase 2, lane I, PLAN.md 2i).
// Fitting runs offline on labelled embeddings and costs nothing; acquiring
// real embeddings is the separately counted L98P2-EMBED receipt. A head
// enables only after its family's hundreds-label paired evidence exists —
// that enabling decision belongs to assembly, never to this module. No
// `vscode` import.

import {
  embeddingFailure,
  embeddingHeadDigest,
  embeddingPartitions,
  parseEmbeddingDataset,
  type EmbeddingDataset,
  type EmbeddingFailure,
  type EmbeddingHead,
  type EmbeddingLimits,
  type EmbeddingSample,
} from './schema'

export interface FitEmbeddingHeadOptions {
  /** Training without an explicit opt-in is refused, never fitted. */
  readonly optedIn: boolean
}

/** Clamped sigmoid: large logits saturate instead of overflowing. */
export function sigmoid(logit: number): number {
  if (logit >= 0) {
    const decaying = Math.exp(-logit)
    return 1 / (1 + decaying)
  }
  const growing = Math.exp(logit)
  return growing / (1 + growing)
}

function dotProduct(weights: readonly number[], embedding: readonly number[]): number {
  let sum = 0
  for (const [index, weight] of weights.entries()) {
    sum += weight * (embedding[index] ?? 0)
  }
  return sum
}

/**
Batch gradient descent from zero with L2 shrinkage. Deterministic: the
same rows and limits always produce the same weights, so a drill can
restore byte-exact bytes. Returns `undefined` when the step never settles.
*/
function descendLogistic(
  rows: readonly EmbeddingSample[],
  limits: EmbeddingLimits,
): { readonly weights: number[]; readonly bias: number } | undefined {
  const dimension = rows[0]?.embedding.length ?? 0
  const weights = Array.from({ length: dimension }, () => 0)
  let bias = 0
  for (let iteration = 0; iteration < limits.maxIterations; iteration += 1) {
    const gradient = Array.from({ length: dimension }, () => 0)
    let biasGradient = 0
    for (const row of rows) {
      const predicted = sigmoid(dotProduct(weights, row.embedding) + bias)
      const error = predicted - row.label
      for (let index = 0; index < dimension; index += 1) {
        gradient[index] =
          (gradient[index] ?? 0) +
          error * (row.embedding[index] ?? 0) +
          limits.regularization * (weights[index] ?? 0)
      }
      biasGradient += error
    }
    const scale = limits.learningRate / rows.length
    let largestStep = 0
    for (let index = 0; index < dimension; index += 1) {
      const step = scale * (gradient[index] ?? 0)
      weights[index] = (weights[index] ?? 0) - step
      largestStep = Math.max(largestStep, Math.abs(step))
    }
    const biasStep = scale * biasGradient
    bias -= biasStep
    largestStep = Math.max(largestStep, Math.abs(biasStep))
    if (largestStep < limits.convergenceTolerance) {
      return { weights, bias }
    }
  }
  return undefined
}

/**
Score one embedding with a trained head. `undefined` on a dimension
mismatch or a non-finite value: the caller falls back, never guesses.
*/
export function scoreEmbedding(
  weights: readonly number[],
  bias: number,
  vector: readonly number[],
): number | undefined {
  // Spreading visits holes too: sparse arrays must fail before any product.
  if (
    !Number.isFinite(bias) ||
    vector.length !== weights.length ||
    [...weights].some((weight) => !Number.isFinite(weight)) ||
    [...vector].some((value) => !Number.isFinite(value))
  )
    return undefined
  let logit = bias
  for (const [index, weight] of weights.entries()) {
    const value = vector[index]
    if (value === undefined) return undefined
    logit += weight * value
  }
  return Number.isFinite(logit) ? sigmoid(logit) : undefined
}

/**
Fit one logistic head on the dataset's fit split. Tuning and evaluation
splits are recorded untouched for the later paired report; they never
train. Synthetic evidence fits mechanics only and cannot certify a family.
*/
export function fitEmbeddingHead(
  input: unknown,
  options: FitEmbeddingHeadOptions,
  limits: EmbeddingLimits,
): EmbeddingHead | EmbeddingFailure {
  if (!options.optedIn) return embeddingFailure('opt-in-required')
  const parsed = parseEmbeddingDataset(input, limits)
  if (parsed.status !== 'valid') return parsed
  const dataset: EmbeddingDataset = parsed.dataset
  const rows = dataset.samples.filter((sample) => sample.split === 'fit')
  if (rows.length < limits.minLabels) return embeddingFailure('insufficient-labels')
  if (rows.every((row) => row.label === rows[0]?.label)) {
    return embeddingFailure('degenerate-dataset')
  }
  const fitted = descendLogistic(rows, limits)
  if (fitted === undefined) return embeddingFailure('fit-did-not-converge')
  const head: EmbeddingHead = {
    version: 1,
    identity: dataset.identity,
    evidence: dataset.evidence,
    weights: fitted.weights,
    bias: fitted.bias,
    digest: '',
    trainedLabels: rows.length,
    partitions: embeddingPartitions(dataset.samples),
  }
  return { ...head, digest: embeddingHeadDigest(head) }
}

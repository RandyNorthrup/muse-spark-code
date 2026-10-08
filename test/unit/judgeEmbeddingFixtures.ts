// Shared fakes for the embedding fast-path tests (M98 phase 2, lane I).
// Every dataset, vector and cost here is fabricated under `test/`; nothing
// is a model capture, a real receipt or evidence that a head is useful.

import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import { fitEmbeddingHead } from '../../src/core/judge/embedding/fit'
import type {
  EmbeddingAdmission,
  EmbeddingCostClaim,
  EmbeddingFallback,
  EmbeddingRouteDependencies,
  EmbeddingSource,
} from '../../src/core/judge/embedding/route'
import type {
  EmbeddingDataset,
  EmbeddingHead,
  EmbeddingLimits,
  EmbeddingSample,
} from '../../src/core/judge/embedding/schema'
import type { JudgeOutcome, JudgeRequest } from '../../src/core/judge/schema'

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
 * A synthetic dataset with grouped splits: each split owns its task and
 * repository groups. Fit rows alternate either side of the fixture's
 * separating direction so the head can learn them.
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

export const noulRequest: JudgeRequest = {
  state: { command: 'synthetic command', context: ['complete', 'state'] },
  questions: { risk: { type: 'noul', instructions: 'Can it destroy data?' } },
}

export interface FallbackMuseCosts {
  readonly reservedCostUsd?: number | undefined
  readonly settledCostUsd?: number | undefined
  readonly uncertainCostUsd?: number | undefined
}

/**
 * A fake full judge: reserves its own worst-case cost on its own ledger,
 * records its calls and answers with a stated verdict, optionally carrying
 * its own reported muse dollars for accounting probes.
 */
export function fallbackFixture(museCosts: FallbackMuseCosts = {}) {
  const calls: JudgeRequest[] = []
  const ledger = admissionLedger()
  const fallback: EmbeddingFallback = {
    run: vi.fn(async (request: JudgeRequest, signal: AbortSignal): Promise<JudgeOutcome> => {
      calls.push(request)
      await ledger.admission.run({ inputTokens: 40, uncachedCostUsd: 0.001 }, signal)
      return {
        outcome: 'answered',
        result: {
          model: 'fixture-model',
          answers: {
            risk: { type: 'noul', noul: 0.7, probabilities: { true: 0.7, false: 0.3 } },
          },
          muse: {
            risk: {
              source: 'same',
              model: 'fixture-model',
              technique: 'stated',
              label: 'uncalibrated',
              confidence: 0.2,
              partial: false,
              ...museCosts,
            },
          },
          usage: { input_tokens: 40, output_tokens: 1 },
        },
      }
    }),
  }
  return { calls, fallback, fallbackClaims: ledger.claims }
}

/**
 * Capture every embed input batch beside a fixed vector answer, so redaction
 * and framing probes share one capture shape.
 */
export function captureEmbedInputs(vectors: readonly (readonly number[])[]) {
  const seen: string[][] = []
  const embed = vi.fn((inputs: readonly string[]): Promise<readonly (readonly number[])[]> => {
    seen.push([...inputs])
    return Promise.resolve(vectors)
  })
  return { seen, embed }
}

/**
 * A full judge that aborts the signal mid-wait, then answers anyway: the
 * route must discard the late answer. The verdict shape stays the shared
 * fixture's; only the Stop is new.
 */
export function abortingFallbackFixture(controller: AbortController) {
  const calls: JudgeRequest[] = []
  const { fallback } = fallbackFixture()
  const aborting: EmbeddingFallback = {
    run: vi.fn(async (request: JudgeRequest, signal: AbortSignal): Promise<JudgeOutcome> => {
      calls.push(request)
      controller.abort()
      return await fallback.run(request, signal)
    }),
  }
  return { calls, fallback: aborting }
}

/** A fake ledger: each run is a NEW reservation claim, settled at once. */
export function admissionLedger() {
  const claims: { readonly inputTokens: number; readonly uncachedCostUsd: number }[] = []
  const admission: EmbeddingAdmission = {
    run: vi.fn((call: EmbeddingCostClaim, _signal: AbortSignal) => {
      claims.push({ inputTokens: call.inputTokens, uncachedCostUsd: call.uncachedCostUsd })
      return Promise.resolve({
        reservedCostUsd: call.uncachedCostUsd,
        settledCostUsd: call.uncachedCostUsd,
        uncertainCostUsd: 0,
      })
    }),
  }
  return { claims, admission }
}

/**
 * Far along the fixture head's learned positive direction, with overwhelming
 * margin: the answered-path probe. Ordinary near-distribution vectors sit
 * under the fallback floor and exercise the fallback instead.
 */
export const confidentVectors: readonly (readonly number[])[] = [[2, -1, 0.5]]

export function embeddingSource(overrides: Partial<EmbeddingSource> = {}): {
  source: EmbeddingSource
  embed: ReturnType<typeof vi.fn>
} {
  const embed = vi.fn(
    overrides.embed ??
      ((inputs: readonly string[]): Promise<readonly (readonly number[])[]> =>
        Promise.resolve(inputs.map(() => [0.9, 0.1, 0.5]))),
  )
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
    uncachedCostUsd: 0.0002,
    ...overrides,
    embed,
  }
  return { source, embed }
}

export function routeDependencies(
  input: {
    readonly source?: Partial<EmbeddingSource> | undefined
    readonly family?: string | undefined
    readonly promptVersion?: string | undefined
    readonly criteriaVersion?: string | undefined
    readonly fitVersion?: string | undefined
    readonly head?: unknown
    readonly fallback?: EmbeddingFallback | undefined
    readonly fallbackCosts?: FallbackMuseCosts | undefined
    readonly admission?: EmbeddingAdmission | undefined
  } = {},
): {
  deps: EmbeddingRouteDependencies
  fallbackCalls: JudgeRequest[]
  fallbackClaims: { readonly inputTokens: number; readonly uncachedCostUsd: number }[]
  claims: { readonly inputTokens: number; readonly uncachedCostUsd: number }[]
  embed: ReturnType<typeof vi.fn>
} {
  const built = embeddingSource(input.source ?? {})
  const { calls, fallback, fallbackClaims } = fallbackFixture(input.fallbackCosts ?? {})
  const { claims, admission } = admissionLedger()
  const deps: EmbeddingRouteDependencies = {
    source: built.source,
    family: input.family ?? 'risk.destructive',
    promptVersion: input.promptVersion ?? 'prompt-1',
    criteriaVersion: input.criteriaVersion ?? 'criteria-1',
    fitVersion: input.fitVersion ?? 'fit-1',
    head: input.head === undefined ? trainedHead() : input.head,
    fallback: input.fallback ?? fallback,
    admission: input.admission ?? admission,
  }
  return { deps, fallbackCalls: calls, fallbackClaims, claims, embed: built.embed }
}

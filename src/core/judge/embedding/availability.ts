// Family adoption artifacts remain in owner storage. Capabilities, never vendor
// names, decide whether an embedding transport can be offered.
import * as z from 'zod/mini'
import type { PaidUseRequest } from '../../../shared/paid'
import type { PaidFeatureGate } from '../../paid/paidFeatures'
import type { JudgeDailyLedger } from '../admission'
import type { JudgeCascadeOptions, JudgeCascadeSide } from '../cascade'
import { JUDGE_ISOTONIC_MIN_LABELS } from '../../../shared/constants'
import { judgeEvidenceRowIdentity, judgeProfileIdentitySchema } from '../schema'
import { parseWeightEnvelope } from './schema'
import type { EmbeddingSource } from './route'

const probability = z.number().check(z.minimum(0), z.maximum(1))
const manifestSchema = z.strictObject({
  identity: z.extend(judgeProfileIdentitySchema, {
    technique: z.literal('embedding'),
    dimension: z.int().check(z.positive()),
  }),
  evidence: z.literal('independent'),
  rows: z.array(
    z.strictObject({
      ...judgeEvidenceRowIdentity,
      split: z.enum(['fit', 'tuning', 'evaluation']),
      labelSource: z.enum(['m75', 'm75-routing', 'independent-hand']),
      label: z.boolean(),
      embeddingAttempts: z.literal(1),
      fallbackAttempts: z.union([z.literal(1), z.literal(2)]),
      fullProbability: z.optional(probability),
      embeddingProbability: z.optional(probability),
    }),
  ),
})

export interface JudgeEmbeddingBinding {
  readonly capable: boolean
  readonly source: EmbeddingSource
  /** Paid capability is available by default; a free local source requires explicit opt-in. */
  readonly localOptedIn: boolean
  readonly head: unknown
  readonly weights: unknown
  readonly manifest: unknown
  readonly fitVersion: string
  readonly gate: Pick<PaidFeatureGate, 'isOn'>
  readonly isEnabled: () => boolean
  readonly priceFingerprint: string
  readonly consentEpoch: () => string
  readonly dailyBudgetUsd: () => number
  readonly allowsPaidUse: (
    request: Extract<PaidUseRequest, { feature: 'judge' }>,
  ) => Promise<boolean>
  readonly ledger?: JudgeDailyLedger | undefined
}

interface FullBinding {
  readonly context: { readonly confidential: boolean }
  readonly options: JudgeCascadeOptions
  readonly same?: JudgeCascadeSide | undefined
  readonly separate?: JudgeCascadeSide | undefined
}

export type JudgeEmbeddingAvailability =
  | { readonly available: true; readonly attemptCeiling: number }
  | {
      readonly available: false
      readonly reason:
        | 'capability-unavailable'
        | 'local-unverified'
        | 'explicit-off'
        | 'confidential-refused'
        | 'profile-mismatch'
        | 'source-untested'
        | 'unpriced'
    }

/** Validate grouped lineage and paired held-out predictions before any dispatch. */
export function embeddingAvailability(
  embedding: JudgeEmbeddingBinding | undefined,
  full: FullBinding,
  mode: 'same' | 'separate' | 'both',
): JudgeEmbeddingAvailability {
  const refuse = (
    reason: Extract<JudgeEmbeddingAvailability, { available: false }>['reason'],
  ): JudgeEmbeddingAvailability => ({ available: false, reason })
  if (!embedding?.capable) return refuse('capability-unavailable')
  const source = embedding.source
  if (source.locality === 'unverified-local') return refuse('local-unverified')
  if (source.locality === 'verified-local' && !embedding.localOptedIn) return refuse('explicit-off')
  if (
    source.locality === 'same-provider' &&
    (!embedding.isEnabled() || embedding.ledger === undefined)
  )
    return refuse('explicit-off')
  const chat = full.same?.capability
  if (
    source.locality === 'same-provider' &&
    (chat?.providerId !== source.providerId || chat.endpoint !== source.endpoint)
  )
    return refuse('profile-mismatch')
  if (
    full.context.confidential &&
    source.locality === 'same-provider' &&
    source.providerPolicy !== 'allow'
  )
    return refuse('confidential-refused')
  if (
    !Number.isFinite(source.uncachedCostUsd) ||
    (source.locality === 'same-provider'
      ? source.uncachedCostUsd <= 0
      : source.uncachedCostUsd !== 0)
  )
    return refuse('unpriced')
  const stored = parseWeightEnvelope(embedding.weights)
  const manifest = manifestSchema.safeParse(embedding.manifest)
  if (
    stored.status !== 'valid' ||
    !manifest.success ||
    JSON.stringify(stored.head) !== JSON.stringify(embedding.head)
  )
    return refuse('profile-mismatch')
  const head = stored.head
  const expected = {
    providerId: source.providerId,
    model: source.model,
    modelVersion: source.modelVersion,
    endpoint: source.endpoint,
    source: source.source,
    technique: 'embedding',
    family: full.options.family,
    promptVersion: full.options.promptVersion,
    criteriaVersion: full.options.criteriaVersion,
    fitVersion: embedding.fitVersion,
    dimension: source.dimension,
  }
  if (
    Object.entries(expected).some(
      ([key, value]) =>
        Reflect.get(head.identity, key) !== value ||
        Reflect.get(manifest.data.identity, key) !== value,
    )
  )
    return refuse('profile-mismatch')
  if (
    head.evidence !== 'independent' ||
    head.trainedLabels < JUDGE_ISOTONIC_MIN_LABELS ||
    head.trainedLabels !== head.partitions.fit.labels.length
  )
    return refuse('source-untested')
  const ids = new Set<string>()
  const labels = new Set<string>()
  const rows = manifest.data.rows
  const groups = new Map<string, string>()
  let attemptCeiling = 0
  let fullBrier = 0
  let embeddingBrier = 0
  let evaluated = 0
  for (const row of rows) {
    if (ids.has(row.id) || labels.has(row.labelId)) return refuse('source-untested')
    ids.add(row.id)
    labels.add(row.labelId)
    for (const group of [`task:${row.taskGroup}`, `repository:${row.repositoryGroup}`]) {
      const owner = groups.get(group)
      if (owner !== undefined && owner !== row.split) return refuse('source-untested')
      groups.set(group, row.split)
    }
    const partition = head.partitions[row.split]
    let expectedLabelSource = 'm75'
    if (full.options.family === 'skill.fit') expectedLabelSource = 'm75-routing'
    else if (row.labelSource === 'independent-hand') expectedLabelSource = 'independent-hand'
    if (
      !partition.ids.includes(row.id) ||
      !partition.labels.includes(row.labelId) ||
      !partition.tasks.includes(row.taskGroup) ||
      !partition.repositories.includes(row.repositoryGroup) ||
      row.labelSource !== expectedLabelSource ||
      (mode === 'both' && row.fallbackAttempts !== 2)
    )
      return refuse('source-untested')
    attemptCeiling += row.embeddingAttempts + row.fallbackAttempts
    if (row.split !== 'evaluation') {
      continue
    }

    if (row.fullProbability === undefined || row.embeddingProbability === undefined)
      return refuse('source-untested')
    fullBrier += (row.fullProbability - Number(row.label)) ** 2
    embeddingBrier += (row.embeddingProbability - Number(row.label)) ** 2
    evaluated += 1
  }
  return ids.size !==
    Object.values(head.partitions).reduce((sum, partition) => sum + partition.ids.length, 0) ||
    evaluated < 2 ||
    embeddingBrier > fullBrier
    ? refuse('source-untested')
    : { available: true, attemptCeiling }
}

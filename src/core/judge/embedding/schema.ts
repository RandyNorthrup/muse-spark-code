// The embedding fast path's contract (M98 phase 2, lane I, PLAN.md 2i): a
// logistic head per recurring family over embeddings from the same provider
// or an explicitly opted-in local judge. Training stays local and opt-in;
// weights live in global storage and never in the VSIX. This module owns its
// injected limits, so P0's shared constants and schemas stay untouched: the
// only shared values read here are the `embedding` technique identity and
// `JUDGE_EMBED_FALLBACK_CONFIDENCE`. No `vscode` import.

import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { judgeProfileIdentitySchema } from '../schema'

/** Caller-injected bounds; the enabling evidence bar rides in `minLabels`. */
export interface EmbeddingLimits {
  readonly maxSamples: number
  readonly maxIdentifierLength: number
  readonly maxDimension: number
  readonly minLabels: number
  readonly maxIterations: number
  readonly convergenceTolerance: number
  readonly learningRate: number
  readonly regularization: number
}

const positiveInteger = z.int().check(z.positive())
const finiteNumber = z.number().check(z.refine((value) => Number.isFinite(value)))

const limitsSchema = z.strictObject({
  maxSamples: positiveInteger,
  maxIdentifierLength: positiveInteger,
  maxDimension: positiveInteger,
  minLabels: positiveInteger,
  maxIterations: positiveInteger,
  convergenceTolerance: z.number().check(z.gt(0), z.lt(1)),
  learningRate: z.number().check(z.gt(0), z.lte(1)),
  regularization: z.number().check(z.gte(0), z.lte(1)),
})

/** Every refusal a fit, parse or storage read can report, never empty success. */
export type EmbeddingReason =
  | 'invalid-limits'
  | 'invalid-dataset'
  | 'unsupported-family'
  | 'invalid-label-source'
  | 'duplicate-label'
  | 'overlapping-groups'
  | 'missing-split'
  | 'degenerate-dataset'
  | 'insufficient-labels'
  | 'dimension-mismatch'
  | 'invalid-embedding'
  | 'invalid-head'
  | 'weight-digest-mismatch'
  | 'invalid-storage'
  | 'opt-in-required'
  | 'fit-did-not-converge'

export interface EmbeddingFailure {
  readonly status: 'refused'
  readonly reason: EmbeddingReason
}

export function embeddingFailure(reason: EmbeddingReason): EmbeddingFailure {
  return { status: 'refused', reason }
}

/** Recurring families with independent M75/hand labels, as in lane B. */
export const EMBEDDING_FAMILIES = ['risk.destructive', 'skill.fit'] as const

/**
A head's identity is P0's profile identity pinned to the `embedding`
technique, plus the vector dimension every sample and weight shares.
*/
const identitySchema = z.extend(judgeProfileIdentitySchema, {
  technique: z.literal('embedding'),
  dimension: positiveInteger,
})
export type EmbeddingHeadIdentity = z.infer<typeof identitySchema>

const splitSchema = z.enum(['fit', 'tuning', 'evaluation'])
const evidenceSchema = z.enum(['synthetic', 'independent'])
const labelSchema = z.union([z.literal(0), z.literal(1)])
const labelSourceSchema = z.enum(['independent-hand', 'm75', 'm75-routing'])

const sampleSchema = z.strictObject({
  embedding: z.array(finiteNumber),
  label: labelSchema,
  labelSource: labelSourceSchema,
  split: splitSchema,
  id: z.string(),
  labelId: z.string(),
  taskGroup: z.string(),
  repositoryGroup: z.string(),
})
export type EmbeddingSample = z.infer<typeof sampleSchema>

const datasetSchema = z.strictObject({
  identity: identitySchema,
  evidence: evidenceSchema,
  samples: z.array(sampleSchema),
})
export type EmbeddingDataset = z.infer<typeof datasetSchema>

const stringList = z.array(z.string())
const partitionSchema = z.strictObject({
  ids: stringList,
  labels: stringList,
  tasks: stringList,
  repositories: stringList,
})

const headSchema = z.strictObject({
  version: z.literal(1),
  identity: identitySchema,
  evidence: evidenceSchema,
  weights: z.array(finiteNumber),
  bias: finiteNumber,
  digest: z.string().check(z.regex(/^[a-f\d]{64}$/)),
  trainedLabels: positiveInteger,
  partitions: z.strictObject({
    fit: partitionSchema,
    tuning: partitionSchema,
    evaluation: partitionSchema,
  }),
})
export type EmbeddingHead = z.infer<typeof headSchema>

/**
Weights cross the storage boundary only in this envelope. The location is
`global-storage` and nothing else: a bundle, VSIX or extension-directory
location never parses, so packaged weights cannot load.
*/
const weightEnvelopeSchema = z.strictObject({
  location: z.literal('global-storage'),
  head: headSchema,
})
export type EmbeddingWeightEnvelope = z.infer<typeof weightEnvelopeSchema>

function isValidIdentifier(value: string, limits: EmbeddingLimits): boolean {
  return value.trim().length > 0 && value.length <= limits.maxIdentifierLength
}

/** Every content-free key a sample carries must fit the injected bounds. */
function areValidIdentifiers(sample: EmbeddingSample, limits: EmbeddingLimits): boolean {
  return [sample.id, sample.labelId, sample.taskGroup, sample.repositoryGroup].every((id) =>
    isValidIdentifier(id, limits),
  )
}

function isValidIdentity(identity: EmbeddingHeadIdentity, limits: EmbeddingLimits): boolean {
  return (
    Object.values(identity).every(
      (value) => typeof value !== 'string' || isValidIdentifier(value, limits),
    ) && identity.dimension <= limits.maxDimension
  )
}

function isLabelSourcePermitted(family: string, source: EmbeddingSample['labelSource']): boolean {
  return family === 'risk.destructive'
    ? source === 'independent-hand' || source === 'm75'
    : source === 'm75-routing'
}

export function parseEmbeddingDataset(
  input: unknown,
  limits: EmbeddingLimits,
): EmbeddingFailure | { readonly status: 'valid'; readonly dataset: EmbeddingDataset } {
  if (!limitsSchema.safeParse(limits).success) return embeddingFailure('invalid-limits')
  const parsed = datasetSchema.safeParse(input)
  if (!parsed.success) return embeddingFailure('invalid-dataset')
  const dataset = parsed.data
  if (
    !isValidIdentity(dataset.identity, limits) ||
    dataset.samples.length === 0 ||
    dataset.samples.length > limits.maxSamples
  ) {
    return embeddingFailure('invalid-dataset')
  }
  if (
    dataset.samples.some(
      (sample) =>
        sample.embedding.length !== dataset.identity.dimension ||
        sample.embedding.length > limits.maxDimension,
    )
  ) {
    return embeddingFailure('dimension-mismatch')
  }
  if (
    !EMBEDDING_FAMILIES.includes(dataset.identity.family as (typeof EMBEDDING_FAMILIES)[number])
  ) {
    return embeddingFailure('unsupported-family')
  }
  // One pass over disjoint concerns: label provenance, unique sample and
  // label keys, single-split group ownership, and split coverage. A task or
  // repository group names one split; both groups share one owner map under
  // distinct key prefixes.
  const seen = new Set<string>()
  const groupOwner = new Map<string, string>()
  const splits = new Set<string>()
  for (const sample of dataset.samples) {
    if (!areValidIdentifiers(sample, limits)) {
      return embeddingFailure('invalid-dataset')
    }
    if (!isLabelSourcePermitted(dataset.identity.family, sample.labelSource)) {
      return embeddingFailure('invalid-label-source')
    }
    for (const key of [`sample:${sample.id}`, `label:${sample.labelId}`]) {
      if (seen.has(key)) return embeddingFailure('duplicate-label')
      seen.add(key)
    }
    for (const [kind, name] of [
      ['task', sample.taskGroup],
      ['repository', sample.repositoryGroup],
    ] as const) {
      const owned = groupOwner.get(`${kind}:${name}`)
      if (owned !== undefined && owned !== sample.split) {
        return embeddingFailure('overlapping-groups')
      }
      groupOwner.set(`${kind}:${name}`, sample.split)
    }
    splits.add(sample.split)
  }
  return ['fit', 'tuning', 'evaluation'].some((split) => !splits.has(split))
    ? embeddingFailure('missing-split')
    : { status: 'valid', dataset }
}

/**
The digest binds the exact head bytes: identity, evidence, weights, bias,
trained-label count and the stored split partitions, in a fixed key order.
A stored head whose bytes changed after training never verifies, including
an edited partition record.
*/
export function embeddingHeadDigest(
  head: Pick<
    EmbeddingHead,
    'identity' | 'evidence' | 'weights' | 'bias' | 'trainedLabels' | 'partitions'
  >,
): string {
  const canonical = JSON.stringify({
    version: 1,
    identity: head.identity,
    evidence: head.evidence,
    weights: head.weights,
    bias: head.bias,
    trainedLabels: head.trainedLabels,
    partitions: head.partitions,
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
The stored partition record must itself describe disjoint held-out splits:
every split keeps its ids, labels and groups, and no task or repository
group, sample id or label id names two splits. A re-digested but
overlapping, emptied or blank record still refuses.
*/
function partitionsReason(partitions: EmbeddingHead['partitions']): EmbeddingReason | undefined {
  const splits = [
    ['fit', partitions.fit],
    ['tuning', partitions.tuning],
    ['evaluation', partitions.evaluation],
  ] as const
  if (
    splits.some(
      ([, partition]) =>
        partition.ids.length === 0 ||
        partition.labels.length === 0 ||
        partition.tasks.length === 0 ||
        partition.repositories.length === 0,
    )
  ) {
    return 'missing-split'
  }
  // The dataset rule refuses blank identifiers; a stored partition record
  // with a blank entry describes a split dataset validation would refuse,
  // even when re-digested.
  if (
    splits.some(([, partition]) =>
      [partition.ids, partition.labels, partition.tasks, partition.repositories].some((names) =>
        names.some((name) => name.trim().length === 0),
      ),
    )
  ) {
    return 'invalid-dataset'
  }
  const seenIds = new Set<string>()
  for (const [, partition] of splits) {
    for (const id of partition.ids) {
      if (seenIds.has(`sample:${id}`)) return 'duplicate-label'
      seenIds.add(`sample:${id}`)
    }
    for (const label of partition.labels) {
      if (seenIds.has(`label:${label}`)) return 'duplicate-label'
      seenIds.add(`label:${label}`)
    }
  }
  const groupOwner = new Map<string, string>()
  for (const [split, partition] of splits) {
    for (const [kind, names] of [
      ['task', partition.tasks],
      ['repository', partition.repositories],
    ] as const) {
      for (const name of names) {
        const owned = groupOwner.get(`${kind}:${name}`)
        if (owned !== undefined && owned !== split) return 'overlapping-groups'
        groupOwner.set(`${kind}:${name}`, split)
      }
    }
  }
  return undefined
}

/** A stored head loads only with its training digest and exact dimension. */
export function parseEmbeddingHead(
  input: unknown,
): EmbeddingFailure | { readonly status: 'valid'; readonly head: EmbeddingHead } {
  const parsed = headSchema.safeParse(input)
  if (!parsed.success) return embeddingFailure('invalid-head')
  const head = parsed.data
  if (head.weights.length !== head.identity.dimension) {
    return embeddingFailure('dimension-mismatch')
  }
  const partitionsFailure = partitionsReason(head.partitions)
  if (partitionsFailure !== undefined) return embeddingFailure(partitionsFailure)
  return embeddingHeadDigest(head) === head.digest
    ? { status: 'valid', head }
    : embeddingFailure('weight-digest-mismatch')
}

/** A weights envelope loads only from global storage, never from a package. */
export function parseWeightEnvelope(
  input: unknown,
): EmbeddingFailure | { readonly status: 'valid'; readonly head: EmbeddingHead } {
  const parsed = weightEnvelopeSchema.safeParse(input)
  return parsed.success ? parseEmbeddingHead(parsed.data.head) : embeddingFailure('invalid-storage')
}

/** The envelope a trained head is stored in. Nothing else may carry weights. */
export function weightEnvelopeFor(head: EmbeddingHead): EmbeddingWeightEnvelope {
  return { location: 'global-storage', head }
}

function compareIdentifiers(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
Sorted, content-free partition records for every split in one pass. Each
bucket gathers its split's ids, label ids and group names; sorting keeps
the stored record stable across runs.
*/
export function embeddingPartitions(
  samples: readonly EmbeddingSample[],
): EmbeddingHead['partitions'] {
  const buckets = new Map<
    EmbeddingSample['split'],
    { ids: string[]; labels: string[]; tasks: Set<string>; repositories: Set<string> }
  >()
  for (const sample of samples) {
    let bucket = buckets.get(sample.split)
    if (bucket === undefined) {
      bucket = { ids: [], labels: [], tasks: new Set(), repositories: new Set() }
      buckets.set(sample.split, bucket)
    }
    bucket.ids.push(sample.id)
    bucket.labels.push(sample.labelId)
    bucket.tasks.add(sample.taskGroup)
    bucket.repositories.add(sample.repositoryGroup)
  }
  const record = (split: EmbeddingSample['split']): EmbeddingHead['partitions']['fit'] => {
    const bucket = buckets.get(split)
    return {
      ids: (bucket?.ids ?? []).toSorted(compareIdentifiers),
      labels: (bucket?.labels ?? []).toSorted(compareIdentifiers),
      tasks: [...(bucket?.tasks ?? [])].toSorted(compareIdentifiers),
      repositories: [...(bucket?.repositories ?? [])].toSorted(compareIdentifiers),
    }
  }
  return { fit: record('fit'), tuning: record('tuning'), evaluation: record('evaluation') }
}

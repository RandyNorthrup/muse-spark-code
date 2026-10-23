import * as z from 'zod/mini'

/** P0 supplies the named limits; calibration never installs settings or a store. */
export interface CalibrationLimits {
  readonly maxSamples: number
  readonly maxIdentifierLength: number
  readonly maxBins: number
  readonly isotonicMinimumLabels: number
  readonly probabilityEpsilon: number
  readonly maxIterations: number
  readonly convergenceTolerance: number
  readonly regularization: number
  readonly weightFloor: number
}

const positiveInteger = z.int().check(z.positive())
const probability = z.number().check(z.minimum(0), z.maximum(1))
const limitsSchema = z.strictObject({
  maxSamples: positiveInteger,
  maxIdentifierLength: positiveInteger,
  maxBins: positiveInteger,
  // D77's fixed floor is 200 independent fit labels, even with injected limits.
  isotonicMinimumLabels: z.int().check(z.minimum(2 * 100)),
  probabilityEpsilon: z.number().check(z.gte(Number.EPSILON), z.lt(1 / 2)),
  maxIterations: positiveInteger,
  convergenceTolerance: z.number().check(z.gt(0), z.lt(1)),
  regularization: z.number().check(z.gt(0), z.lte(1)),
  weightFloor: z.number().check(z.gte(Number.EPSILON), z.lte(1)),
})

export type CalibrationReason =
  | 'invalid-limits'
  | 'invalid-dataset'
  | 'unsupported-family'
  | 'unsupported-technique'
  | 'invalid-label-source'
  | 'duplicate-label'
  | 'overlapping-groups'
  | 'missing-split'
  | 'degenerate-dataset'
  | 'insufficient-isotonic-labels'
  | 'fit-did-not-converge'
  | 'invalid-profile'
  | 'profile-mismatch'
  | 'partition-mismatch'
  | 'independent-evaluation-required'
  | 'partial-result'
  | 'invalid-probability'

export interface CalibrationFailure {
  readonly status: 'uncalibrated'
  readonly reason: CalibrationReason
}

export function calibrationFailure(reason: CalibrationReason): CalibrationFailure {
  return { status: 'uncalibrated', reason }
}

const identitySchema = z.strictObject({
  providerId: z.string(),
  model: z.string(),
  modelVersion: z.string(),
  endpoint: z.string(),
  source: z.enum(['same', 'separate']),
  technique: z.string(),
  family: z.string(),
  promptVersion: z.string(),
  criteriaVersion: z.string(),
  fitVersion: z.string(),
})
export type CalibrationIdentity = z.infer<typeof identitySchema>

const sampleSchema = z.strictObject({
  id: z.string(),
  labelId: z.string(),
  taskGroup: z.string(),
  repositoryGroup: z.string(),
  split: z.enum(['fit', 'tuning', 'evaluation']),
  probability,
  label: z.union([z.literal(0), z.literal(1)]),
  labelSource: z.enum(['independent-hand', 'm75', 'm75-routing']),
})
export type CalibrationSample = z.infer<typeof sampleSchema>

const datasetSchema = z.strictObject({
  identity: identitySchema,
  evidence: z.enum(['synthetic', 'independent']),
  samples: z.array(sampleSchema),
})
export type CalibrationDataset = z.infer<typeof datasetSchema>

const partitionSchema = z.strictObject({
  ids: z.array(z.string()),
  labels: z.array(z.string()),
  tasks: z.array(z.string()),
  repositories: z.array(z.string()),
})
const metricsSchema = z.strictObject({
  sampleCount: positiveInteger,
  brier: probability,
  ece: probability,
})
const evaluationSchema = z.strictObject({
  evidence: z.enum(['synthetic', 'independent']),
  bins: positiveInteger,
  uncalibrated: metricsSchema,
  calibrated: metricsSchema,
})
const profileSchema = z.strictObject({
  version: z.literal(1),
  identity: identitySchema,
  evidence: z.enum(['synthetic', 'independent']),
  epsilon: z.number().check(z.gte(Number.EPSILON), z.lt(1 / 2)),
  fit: z.discriminatedUnion('method', [
    z.strictObject({ method: z.literal('platt'), slope: z.number(), intercept: z.number() }),
    z.strictObject({
      method: z.literal('isotonic'),
      knots: z.array(z.strictObject({ probability, calibratedProbability: probability })),
    }),
  ]),
  combinationWeight: z.number().check(z.positive()),
  partitions: z.strictObject({
    fit: partitionSchema,
    tuning: partitionSchema,
    evaluation: partitionSchema,
  }),
  evaluation: z.optional(evaluationSchema),
})
export type CalibrationProfile = z.infer<typeof profileSchema>

function isValidIdentifier(value: string, limits: CalibrationLimits): boolean {
  return value.trim().length > 0 && value.length <= limits.maxIdentifierLength
}

function isValidIdentity(identity: CalibrationIdentity, limits: CalibrationLimits): boolean {
  return Object.values(identity).every((value) => isValidIdentifier(value, limits))
}

/** M98's techniques plus lane L's `systemone`, fitted per engine identity. */
export const CALIBRATION_TECHNIQUES: readonly string[] = ['logprob', 'stated', 'systemone']

/**
M98's families plus lane L's nine fast-judge families. The nine mirror
the fast contract's decision ids; the calibration suite guards the
mirror, so the two lists cannot drift apart.
*/
export const CALIBRATION_FAMILIES: readonly string[] = [
  'risk.destructive',
  'skill.fit',
  'triage.needFull',
  'context.include',
  'loop.stuck',
  'effort.lower',
  'edit.misfit',
  'failure.unmentioned',
  'scope.outside',
  'claim.inconsistent',
  'done.unbacked',
]

export function identityReason(identity: CalibrationIdentity): CalibrationReason | undefined {
  if (!CALIBRATION_FAMILIES.includes(identity.family)) {
    return 'unsupported-family'
  }
  return CALIBRATION_TECHNIQUES.includes(identity.technique) ? undefined : 'unsupported-technique'
}

/** Exact structural identity, independent of JSON property order. */
export function isSameCalibrationIdentity(a: CalibrationIdentity, b: CalibrationIdentity): boolean {
  return Object.entries(a).every(([key, value]) => Reflect.get(b, key) === value)
}

export function parseCalibrationDataset(
  input: unknown,
  limits: CalibrationLimits,
): CalibrationFailure | { readonly status: 'valid'; readonly dataset: CalibrationDataset } {
  if (!limitsSchema.safeParse(limits).success) return calibrationFailure('invalid-limits')
  const parsed = datasetSchema.safeParse(input)
  if (!parsed.success) return calibrationFailure('invalid-dataset')
  const dataset = parsed.data
  if (
    !isValidIdentity(dataset.identity, limits) ||
    dataset.samples.length > limits.maxSamples ||
    dataset.samples.some((sample) =>
      [sample.id, sample.labelId, sample.taskGroup, sample.repositoryGroup].some(
        (id) => !isValidIdentifier(id, limits),
      ),
    )
  )
    return calibrationFailure('invalid-dataset')
  const reason = identityReason(dataset.identity)
  if (reason !== undefined) return calibrationFailure(reason)
  const ids = new Set<string>()
  const labels = new Set<string>()
  const tasks = new Map<string, string>()
  const repositories = new Map<string, string>()
  const splits = new Set<string>()
  for (const sample of dataset.samples) {
    // Routing labels stay on routing; every other family — M98's risk
    // and lane L's nine — fits only from independent labels. The
    // setup's rows carry no label source, so they can never enter a
    // dataset, and weak signals refuse below with the rest.
    const isPermitted =
      dataset.identity.family === 'skill.fit'
        ? sample.labelSource === 'm75-routing'
        : sample.labelSource === 'independent-hand' || sample.labelSource === 'm75'
    if (!isPermitted) return calibrationFailure('invalid-label-source')
    if (ids.has(sample.id) || labels.has(sample.labelId))
      return calibrationFailure('duplicate-label')
    ids.add(sample.id)
    labels.add(sample.labelId)
    const taskSplit = tasks.get(sample.taskGroup)
    const repositorySplit = repositories.get(sample.repositoryGroup)
    if (
      (taskSplit !== undefined && taskSplit !== sample.split) ||
      (repositorySplit !== undefined && repositorySplit !== sample.split)
    )
      return calibrationFailure('overlapping-groups')
    tasks.set(sample.taskGroup, sample.split)
    repositories.set(sample.repositoryGroup, sample.split)
    splits.add(sample.split)
  }
  return ['fit', 'tuning', 'evaluation'].some((split) => !splits.has(split))
    ? calibrationFailure('missing-split')
    : { status: 'valid', dataset }
}

function compareIdentifiers(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

export function calibrationPartitions(
  samples: readonly CalibrationSample[],
): CalibrationProfile['partitions'] {
  const partition = (
    split: CalibrationSample['split'],
  ): CalibrationProfile['partitions']['fit'] => {
    const rows = samples.filter((sample) => sample.split === split)
    return {
      ids: rows.map((sample) => sample.id).toSorted(compareIdentifiers),
      labels: rows.map((sample) => sample.labelId).toSorted(compareIdentifiers),
      tasks: [...new Set(rows.map((sample) => sample.taskGroup))].toSorted(compareIdentifiers),
      repositories: [...new Set(rows.map((sample) => sample.repositoryGroup))].toSorted(
        compareIdentifiers,
      ),
    }
  }
  return { fit: partition('fit'), tuning: partition('tuning'), evaluation: partition('evaluation') }
}

export function parseCalibrationProfile(
  input: unknown,
  limits: CalibrationLimits,
): CalibrationProfile | undefined {
  if (!limitsSchema.safeParse(limits).success) return undefined
  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) return undefined
  const profile = parsed.data
  if (!isValidIdentity(profile.identity, limits) || identityReason(profile.identity) !== undefined)
    return undefined
  const partitions = Object.values(profile.partitions)
  if (partitions.reduce((sum, partition) => sum + partition.ids.length, 0) > limits.maxSamples) {
    return undefined
  }
  const partitionFields = ['ids', 'labels', 'tasks', 'repositories'] as const
  for (const key of partitionFields) {
    const seen = new Set<string>()
    for (const partition of partitions) {
      const values = partition[key]
      if (values.length === 0) return undefined
      for (const id of values) {
        if (!isValidIdentifier(id, limits) || seen.has(id)) return undefined
        seen.add(id)
      }
    }
  }
  if (profile.fit.method === 'isotonic') {
    if (profile.partitions.fit.labels.length < limits.isotonicMinimumLabels) return undefined
    const knots = profile.fit.knots
    if (knots.length === 0 || knots.length > profile.partitions.fit.labels.length) return undefined
    for (let index = 1; index < knots.length; index += 1) {
      const previous = knots[index - 1]
      const current = knots[index]
      if (
        previous === undefined ||
        current === undefined ||
        current.probability <= previous.probability ||
        current.calibratedProbability < previous.calibratedProbability
      )
        return undefined
    }
  }
  if (
    profile.evaluation !== undefined &&
    (profile.evaluation.bins > limits.maxBins ||
      profile.evaluation.evidence !== profile.evidence ||
      profile.evaluation.calibrated.sampleCount !== profile.partitions.evaluation.ids.length ||
      profile.evaluation.uncalibrated.sampleCount !== profile.partitions.evaluation.ids.length)
  )
    return undefined
  for (const partition of partitions) {
    if (
      partition.ids.length !== partition.labels.length ||
      partition.tasks.length > partition.ids.length ||
      partition.repositories.length > partition.ids.length
    )
      return undefined
  }
  return profile
}

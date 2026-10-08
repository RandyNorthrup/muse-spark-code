// Recorded, independently labelled held-out replays are the automatic-mode gate.
// This is an offline artifact, not a provider wire shape or a permission grant.
import * as z from 'zod/mini'
import { JUDGE_MIN_READY_RATE } from '../../shared/constants'
import { reportCalibration } from './calibration/report'
import { judgeEvidenceRowIdentity } from './schema'
import {
  parseCalibrationDataset,
  parseCalibrationProfile,
  type CalibrationLimits,
} from './calibration/schema'

const rate = z.number().check(z.minimum(0), z.maximum(1))
const nonnegative = z.number().check(z.nonnegative())
const arm = z.strictObject({
  ready: z.boolean(),
  caution: z.boolean(),
  probability: rate,
  latencyMs: nonnegative,
  costUsd: nonnegative,
})
const recordSchema = z.strictObject({
  same: z.strictObject({ profile: z.unknown(), dataset: z.unknown() }),
  separate: z.strictObject({ profile: z.unknown(), dataset: z.unknown() }),
  rows: z
    .array(
      z.strictObject({
        ...judgeEvidenceRowIdentity,
        labelSource: z.enum(['m75', 'm75-routing']),
        label: z.boolean(),
        same: arm,
        separate: arm,
        both: arm,
      }),
    )
    .check(z.minLength(2)),
})

export interface JudgeAdoptionContext {
  readonly providerId: string
  readonly modelId: string
  readonly limits: CalibrationLimits
  readonly sameProfile?: unknown
  readonly separateProfile?: unknown
}

/** Recompute eligibility from rows and profiles; a stored "passed" flag is never sufficient. */
export function hasJudgeAdoptionEvidence(input: unknown, context: JudgeAdoptionContext): boolean {
  const parsed = recordSchema.safeParse(input)
  if (!parsed.success) return false
  const record = parsed.data
  const same = parseCalibrationProfile(record.same.profile, context.limits)
  const separate = parseCalibrationProfile(record.separate.profile, context.limits)
  if (
    same === undefined ||
    separate === undefined ||
    same.identity.source !== 'same' ||
    separate.identity.source !== 'separate' ||
    same.identity.providerId !== context.providerId ||
    same.identity.model !== context.modelId ||
    same.identity.family !== separate.identity.family ||
    same.identity.promptVersion !== separate.identity.promptVersion ||
    same.identity.criteriaVersion !== separate.identity.criteriaVersion
  )
    return false
  for (const [selected, recorded] of [
    [context.sameProfile, same],
    [context.separateProfile, separate],
  ] as const) {
    if (selected === undefined) {
      continue
    }

    const profile = parseCalibrationProfile(selected, context.limits)
    if (profile === undefined || JSON.stringify(profile) !== JSON.stringify(recorded)) return false
  }
  for (const side of [record.same, record.separate]) {
    const report = reportCalibration(side.profile, side.dataset, 1, context.limits)
    if (report.status !== 'reported' || !report.report.activationEligible) return false
  }
  const datasets = [record.same.dataset, record.separate.dataset].map((input) =>
    parseCalibrationDataset(input, context.limits),
  )
  for (const parsedDataset of datasets) {
    if (parsedDataset.status !== 'valid') return false
    for (const row of record.rows) {
      const sample = parsedDataset.dataset.samples.find((sample) => sample.id === row.id)
      if (
        sample?.split !== 'evaluation' ||
        sample.labelId !== row.labelId ||
        sample.taskGroup !== row.taskGroup ||
        sample.repositoryGroup !== row.repositoryGroup ||
        Boolean(sample.label) !== row.label
      )
        return false
    }
  }
  const ids = new Set<string>()
  const labels = new Set<string>()
  for (const row of record.rows) {
    if (
      ids.has(row.id) ||
      labels.has(row.labelId) ||
      row.labelSource !== (same.identity.family === 'skill.fit' ? 'm75-routing' : 'm75') ||
      [row.same, row.separate, row.both].some((value) => value.caution && !value.ready)
    )
      return false
    ids.add(row.id)
    labels.add(row.labelId)
    for (const profile of [same, separate]) {
      for (const partition of [profile.partitions.fit, profile.partitions.tuning]) {
        if (
          partition.ids.includes(row.id) ||
          partition.labels.includes(row.labelId) ||
          partition.tasks.includes(row.taskGroup) ||
          partition.repositories.includes(row.repositoryGroup)
        )
          return false
      }
      const evaluation = profile.partitions.evaluation
      if (
        !evaluation.ids.includes(row.id) ||
        !evaluation.labels.includes(row.labelId) ||
        !evaluation.tasks.includes(row.taskGroup) ||
        !evaluation.repositories.includes(row.repositoryGroup)
      )
        return false
    }
  }
  if (
    labels.size !== same.partitions.evaluation.labels.length ||
    labels.size !== separate.partitions.evaluation.labels.length ||
    record.rows.every((row) => !row.label) ||
    record.rows.every((row) => row.label)
  )
    return false
  const metrics = (key: 'same' | 'both') => {
    let ready = 0
    let cautions = 0
    let correct = 0
    let brier = 0
    for (const row of record.rows) {
      const value = row[key]
      ready += value.ready ? 1 : 0
      cautions += value.caution ? 1 : 0
      correct += value.caution && row.label ? 1 : 0
      brier += (value.probability - Number(row.label)) ** 2
    }
    return {
      ready: ready / record.rows.length,
      precision: cautions === 0 ? 0 : correct / cautions,
      cautions,
      brier,
    }
  }
  const baseline = metrics('same')
  const cascade = metrics('both')
  return (
    cascade.ready >= JUDGE_MIN_READY_RATE &&
    cascade.ready >= baseline.ready &&
    cascade.cautions > 0 &&
    cascade.precision >= baseline.precision &&
    cascade.brier <= baseline.brier
  )
}

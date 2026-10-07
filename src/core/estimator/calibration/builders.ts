import * as z from 'zod/mini'
import {
  estimateLaneSchema,
  historyRecordSchema,
  type EstimateHistoryPort,
  type HistoryRecord,
} from '../../../shared/estimate'
import { MILLISECONDS_PER_SECOND, SECONDS_PER_HOUR } from '../../../shared/constants'
import { calibrationFailure, canonicalHistory, canonicalRecord, compareIds } from './records'

/** Application projections only. Bind after each owner's captured-wire parser, never to raw frames. */
const laneSchema = z.strictObject({
  laneId: historyRecordSchema.shape.laneId,
  kind: historyRecordSchema.shape.kind,
  estimatedHours: z.nullable(historyRecordSchema.shape.estimatedHours),
  state: estimateLaneSchema.shape.state,
})
const durationFields = {
  machineClassId: historyRecordSchema.shape.machineClassId,
  startedAt: historyRecordSchema.shape.startedAt,
  finishedAt: historyRecordSchema.shape.finishedAt,
}
const boardSchema = z.strictObject({
  ...durationFields,
  actualHours: historyRecordSchema.shape.actualHours,
})
const gitSchema = z.strictObject(durationFields)
const ciSchema = z.strictObject({ ciHours: historyRecordSchema.shape.actualHours })
export type HistoryLane = z.infer<typeof laneSchema>

export interface HistoryBuilderPorts {
  /** M96: completed active-agent hours, including fixes, excluding waits and CI. */
  readonly board?: { duration(laneId: string, asOf: string): Promise<unknown> }
  /** M113 git source: evidenced first implementation commit to integration merge. */
  readonly git?: { duration(laneId: string, asOf: string): Promise<unknown> }
  /** M116: complete lane rounds, current module/class strikes and named redesign events. */
  readonly playbook?: { review(laneId: string, asOf: string): Promise<unknown> }
  /** M113 CI source: summed job-hours, not elapsed wall time of concurrent jobs. */
  readonly ci?: { duration(laneId: string, asOf: string): Promise<unknown> }
}

export interface BuiltHistory {
  readonly records: readonly HistoryRecord[]
  readonly excluded: readonly {
    laneId: string
    reason: 'notMerged' | 'missingEstimate' | 'missingDuration' | 'afterSnapshot'
  }[]
}

/** No clock, model, git command or network. Missing measurements stay missing. */
export async function buildHistory(
  values: readonly HistoryLane[],
  ports: HistoryBuilderPorts,
  asOf: string,
): Promise<BuiltHistory> {
  if (!z.iso.datetime().safeParse(asOf).success) throw calibrationFailure('invalidSnapshot')
  const parsed = z.array(laneSchema).safeParse(values)
  if (!parsed.success) throw calibrationFailure('invalidHistoryLane')
  const lanes = parsed.data.toSorted((left, right) => compareIds(left.laneId, right.laneId))
  if (new Set(lanes.map((lane) => lane.laneId)).size !== lanes.length)
    throw calibrationFailure('duplicateHistoryLane')
  const records: HistoryRecord[] = []
  const excluded: BuiltHistory['excluded'][number][] = []
  for (const lane of lanes) {
    if (lane.state !== 'merged' || lane.estimatedHours === null) {
      excluded.push({
        laneId: lane.laneId,
        reason: lane.state === 'merged' ? 'missingEstimate' : 'notMerged',
      })
      continue
    }
    let board: unknown
    let git: unknown
    let review: unknown
    let ci: unknown
    try {
      board = await ports.board?.duration(lane.laneId, asOf)
      if (board === undefined) git = await ports.git?.duration(lane.laneId, asOf)
      ;[review, ci] = await Promise.all([
        ports.playbook?.review(lane.laneId, asOf),
        ports.ci?.duration(lane.laneId, asOf),
      ])
    } catch {
      throw calibrationFailure('historySourceUnavailable')
    }
    if (board === undefined && git === undefined) {
      excluded.push({ laneId: lane.laneId, reason: 'missingDuration' })
      continue
    }
    const duration = (board === undefined ? gitSchema : boardSchema).safeParse(board ?? git)
    const reviewResult = historyRecordSchema.shape.review.safeParse(
      review === undefined ? { status: 'unknown' } : review,
    )
    const ciResult = ci === undefined ? undefined : ciSchema.safeParse(ci)
    if (!duration.success || !reviewResult.success || (ciResult && !ciResult.success))
      throw calibrationFailure('invalidHistorySource')
    if (Date.parse(duration.data.finishedAt) > Date.parse(asOf)) {
      excluded.push({ laneId: lane.laneId, reason: 'afterSnapshot' })
      continue
    }
    records.push(
      canonicalRecord({
        laneId: lane.laneId,
        kind: lane.kind,
        estimatedHours: lane.estimatedHours,
        ...duration.data,
        actualHours:
          'actualHours' in duration.data
            ? duration.data.actualHours
            : (Date.parse(duration.data.finishedAt) - Date.parse(duration.data.startedAt)) /
              (MILLISECONDS_PER_SECOND * SECONDS_PER_HOUR),
        durationBasis: board === undefined ? 'gitElapsed' : 'agentTime',
        source: board === undefined ? 'git' : 'board',
        review: reviewResult.data,
        ...(ciResult?.success && { ciHours: ciResult.data.ciHours }),
      }),
    )
  }
  return { records: canonicalHistory(records), excluded }
}

/** Immutable completed observations; a retry is idempotent at the journal. */
export async function collectHistory(
  journal: EstimateHistoryPort,
  lanes: readonly HistoryLane[],
  ports: HistoryBuilderPorts,
  asOf: string,
): Promise<BuiltHistory> {
  const built = await buildHistory(lanes, ports, asOf)
  for (const record of built.records) await journal.append(record)
  return built
}

import * as z from 'zod/mini'
import {
  estimateGoalSchema,
  estimateLaneSchema,
  estimateRequestSchema,
  type EstimateGoal,
  type EstimateLane,
} from '../../shared/estimate'
import { ESTIMATE_MAX_ITEMS } from '../../shared/constants'
import { UI_TEXT, fill } from '../../shared/l10n/text'

const areUnique = (values: readonly (string | number)[]): boolean =>
  new Set(values).size === values.length
const id = estimateLaneSchema.shape.id
const ids = z.array(id).check(z.maxLength(ESTIMATE_MAX_ITEMS), z.refine(areUnique))
const milestoneId = z.string().check(z.regex(/^M[1-9]\d*[a-z\d]*$/))
const numbered = { number: z.int().check(z.positive()), laneIds: ids }
const snapshotSchema = z
  .strictObject({
    asOf: estimateRequestSchema.shape.asOf,
    lanes: z.array(z.strictObject({ lane: estimateLaneSchema, rigId: z.optional(id) })),
    milestones: z.array(z.strictObject({ id: milestoneId, laneIds: ids })),
    pullRequests: z.array(
      z.strictObject({ ...numbered, state: z.enum(['open', 'closed', 'merged']) }),
    ),
    issues: z.array(
      z.strictObject({ ...numbered, labels: z.array(z.string().check(z.minLength(1))) }),
    ),
    releases: z.array(
      z.strictObject({
        id: z.string().check(z.regex(/^[\w.-]+$/)),
        milestoneIds: z.array(milestoneId).check(z.refine(areUnique)),
      }),
    ),
    rigs: z.array(z.strictObject({ id, affinity: estimateLaneSchema.shape.affinity })),
  })
  .check(
    z.refine((snapshot) => {
      const laneIds = new Set(snapshot.lanes.map((entry) => entry.lane.id))
      const milestoneIds = new Set(snapshot.milestones.map((entry) => entry.id))
      return (
        areUnique(snapshot.lanes.map((entry) => entry.lane.id)) &&
        [snapshot.milestones, snapshot.releases, snapshot.rigs].every((entries) =>
          areUnique(entries.map((entry) => entry.id)),
        ) &&
        [snapshot.pullRequests, snapshot.issues].every((entries) =>
          areUnique(entries.map((entry) => entry.number)),
        ) &&
        [snapshot.milestones, snapshot.pullRequests, snapshot.issues].every((entries) =>
          entries.every((entry) => entry.laneIds.every((laneId) => laneIds.has(laneId))),
        ) &&
        snapshot.milestones.every((entry) =>
          entry.laneIds.every((laneId) => laneId.startsWith(`${entry.id}:`)),
        ) &&
        snapshot.releases.every((entry) =>
          entry.milestoneIds.every((id) => milestoneIds.has(id)),
        ) &&
        snapshot.lanes.every(
          (entry) =>
            entry.lane.dependencies.every((id) => laneIds.has(id)) &&
            (entry.rigId === undefined || snapshot.rigs.some((rig) => rig.id === entry.rigId)),
        )
      )
    }),
  )

export type EstimateGoalSnapshot = z.infer<typeof snapshotSchema>

/** M117-G-M113-snapshot: scrubbed application projections, not wire frames.
 * The adapter reads one bounded snapshot at asOf, including prerequisites.
 * Missing sources/estimates reject the read; no empty fallback is supplied.
 * Rig facts, board agent time and calibrated minima are projected upstream.
 */
export interface EstimateGoalSourcesPort {
  snapshot(goal: EstimateGoal, asOf: string): Promise<unknown>
}

/** Code-unit order is independent of the host's language and ICU version. */
export function compareEstimateIds(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

/** Remaining active agent hours; git wall time is never subtracted here. */
export function remainingHours(lane: EstimateLane): number {
  if (lane.state === 'merged') return 0
  return lane.state === 'running'
    ? Math.max(lane.minimumRemainingHours, lane.estimatedHours - lane.elapsedAgentHours)
    : lane.estimatedHours
}

function intersect<T extends string>(left: readonly T[], right: readonly T[]): T[] {
  let result = [...left]
  if (left.length === 0) result = [...right]
  else if (right.length > 0) result = left.filter((value) => right.includes(value))
  if (left.length > 0 && right.length > 0 && result.length === 0)
    throw new Error(UI_TEXT.estimateNoCapacity)
  return [...new Set(result)].toSorted(compareEstimateIds)
}

function relativeFile(file: string): string {
  const normalized = file.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '')
  if (/^(?:\/|[a-z]:)/i.test(normalized) || normalized.split('/').includes('..'))
    throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'nonrelative-file' }))
  return normalized
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/')
}

function fileAffinity(file: string): EstimateLane['affinity'] {
  const normalized = relativeFile(file)
  const os: EstimateLane['affinity']['os'] = []
  if (/^native\/windows(?:\/|$)/i.test(normalized)) os.push('windows')
  if (/^native\/darwin(?:\/|$)/i.test(normalized)) os.push('macos')
  if (/^os(?:\/|$)/i.test(normalized)) os.push('linux')
  const architectures: EstimateLane['affinity']['architectures'] = []
  if (os.includes('linux')) {
    if (/(?:^|\/)(?:x64|amd64|x86_64)(?:\/|$)/i.test(normalized)) architectures.push('x64')
    if (/(?:^|\/)(?:arm64|aarch64)(?:\/|$)/i.test(normalized)) architectures.push('arm64')
    if (architectures.length > 1) throw new Error(UI_TEXT.estimateNoCapacity)
  }
  return { os, architectures, machineClassIds: [], gpuRequired: false }
}

function affinityFor(lane: EstimateLane, rig: EstimateLane['affinity'] | undefined) {
  const files = lane.files.map((file) => fileAffinity(file))
  let affinity = {
    os: intersect(lane.affinity.os, []),
    architectures: intersect(lane.affinity.architectures, []),
    machineClassIds: intersect(lane.affinity.machineClassIds, []),
    gpuRequired: lane.affinity.gpuRequired,
  }
  for (const constraint of [rig, ...files]) {
    if (!constraint) continue
    affinity = {
      os: intersect(affinity.os, constraint.os),
      architectures: intersect(affinity.architectures, constraint.architectures),
      machineClassIds: intersect(affinity.machineClassIds, constraint.machineClassIds),
      gpuRequired: affinity.gpuRequired || constraint.gpuRequired,
    }
  }
  if (files.some((file) => file.os.includes('linux')) && affinity.architectures.length === 0)
    throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'unknown-os-architecture' }))
  return { ...affinity, gpuRequired: affinity.gpuRequired || /^gpu(?:[.-]|$)/i.test(lane.kind) }
}

/** Implements EstimateSourcesPort.lanes when bound to the real M113 adapter.
 * All lists use code-unit ordering; selection includes transitive unfinished
 * prerequisites. Merged records remain evidence, with satisfied edges removed.
 */
export async function resolveEstimateGoal(
  goalInput: unknown,
  asOf: string,
  sources: EstimateGoalSourcesPort,
): Promise<EstimateLane[]> {
  const goal = estimateGoalSchema.parse(goalInput)
  const instant = estimateRequestSchema.shape.asOf.parse(asOf)
  const snapshot = snapshotSchema.parse(await sources.snapshot(goal, instant))
  if (snapshot.asOf !== instant)
    throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'snapshot-asOf' }))
  const notFound = (): never => {
    throw new Error(fill(UI_TEXT.estimateNotFound, { goal: JSON.stringify(goal) }))
  }
  const milestone = (id: string) =>
    snapshot.milestones.find((entry) => entry.id === id) ?? notFound()
  let selected: string[]
  switch (goal.kind) {
    case 'milestone': {
      selected = milestone(goal.milestoneId).laneIds
      break
    }
    case 'lanes': {
      const available = milestone(goal.milestoneId).laneIds
      selected = goal.laneIds.map((id) => {
        const laneId = `${goal.milestoneId}:${id}`
        return available.includes(laneId) ? laneId : notFound()
      })
      break
    }
    case 'pullRequest': {
      selected = (snapshot.pullRequests.find((entry) => entry.number === goal.number) ?? notFound())
        .laneIds
      break
    }
    case 'issues': {
      selected = goal.numbers.flatMap(
        (number) =>
          (snapshot.issues.find((entry) => entry.number === number) ?? notFound()).laneIds,
      )
      break
    }
    case 'label': {
      const issues = snapshot.issues.filter((entry) => entry.labels.includes(goal.label))
      if (issues.length === 0) notFound()
      selected = issues.flatMap((entry) => entry.laneIds)
      break
    }
    case 'release': {
      const release = snapshot.releases.find((entry) => entry.id === goal.release) ?? notFound()
      selected = release.milestoneIds.flatMap((id) => milestone(id).laneIds)
      break
    }
  }
  const merged = new Set(
    snapshot.pullRequests.filter((pr) => pr.state === 'merged').flatMap((pr) => pr.laneIds),
  )
  const lanes = new Map(snapshot.lanes.map((entry) => [entry.lane.id, entry]))
  const included = new Map<string, EstimateLane>()
  const pending = [...selected]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (included.has(id)) continue
    const entry = lanes.get(id) ?? notFound()
    const lane = { ...entry.lane, state: merged.has(id) ? 'merged' : entry.lane.state }
    const resolved = estimateLaneSchema.parse({
      ...lane,
      dependencies: lane.state === 'merged' ? [] : lane.dependencies.toSorted(compareEstimateIds),
      files: lane.files.map((file) => relativeFile(file)).toSorted(compareEstimateIds),
      affinity:
        lane.state === 'merged'
          ? entry.lane.affinity
          : affinityFor(entry.lane, snapshot.rigs.find((rig) => rig.id === entry.rigId)?.affinity),
    })
    included.set(id, resolved)
    pending.push(...resolved.dependencies)
  }
  if (included.size > ESTIMATE_MAX_ITEMS)
    throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'lane-limit' }))
  return Array.from(included, ([, lane]) => lane).toSorted((left, right) =>
    compareEstimateIds(left.id, right.id),
  )
}

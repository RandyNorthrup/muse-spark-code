import { estimateLaneSchema, type EstimateLane } from '../../shared/estimate'
import { ESTIMATE_MAX_ITEMS } from '../../shared/constants'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import { compareEstimateIds, remainingHours } from './goal'

/** A node's duration with its evidence, frozen: an eight-hour plan
 * assumption and eight hours backed by calibration must not compare equal.
 * `unit` is always hours; `source` names the plan or the sampler;
 * `basis`/`samples` reuse the disclosure vocabulary (`calibration` with its
 * fit's sample count, otherwise `assumption` with zero).
 */
export interface EstimateDurationEvidence {
  readonly hours: number
  readonly unit: 'hour'
  readonly source: 'plan' | 'sample'
  readonly basis: 'assumption' | 'calibration'
  readonly samples: number
}

/** The closed evidence vocabulary, checked by membership: forged objects
 * from untyped callers must fail closed rather than ride a literal type. */
const EVIDENCE_UNITS = new Set(['hour'])
const EVIDENCE_SOURCES = new Set(['plan', 'sample'])
const EVIDENCE_BASES = new Set(['assumption', 'calibration'])

/** Shape and evidence invariant for a duration object. Hours range checks
 * stay with the caller: merged lanes and running floors differ by context. */
export function isEstimateDurationEvidence(value: unknown): value is EstimateDurationEvidence {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record['hours'] === 'number' &&
    typeof record['unit'] === 'string' &&
    EVIDENCE_UNITS.has(record['unit']) &&
    typeof record['source'] === 'string' &&
    EVIDENCE_SOURCES.has(record['source']) &&
    typeof record['basis'] === 'string' &&
    EVIDENCE_BASES.has(record['basis']) &&
    typeof record['samples'] === 'number' &&
    Number.isSafeInteger(record['samples']) &&
    record['samples'] >= 0 &&
    (record['basis'] === 'assumption') === (record['samples'] === 0)
  )
}

interface DagNode {
  laneId: string
  duration: EstimateDurationEvidence
  earliestStartHours: number
  earliestFinishHours: number
  latestStartHours: number
  latestFinishHours: number
  slackHours: number
  /** Longest remaining downstream path, including this lane; S's priority. */
  tailHours: number
  critical: boolean
}

export interface EstimateDag {
  /** Nodes in topological order; ready ties are resolved by lane ID. */
  nodes: DagNode[]
  topologicalOrder: string[]
  /** One stable longest path; nodes on other equal longest paths are critical too. */
  criticalPath: string[]
  criticalPathHours: number
}

function invalid(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/** A plan duration with no measurement behind it: an assumption of zero samples. */
export function planDurationEvidence(hours: number): EstimateDurationEvidence {
  const evidence: EstimateDurationEvidence = {
    hours,
    unit: 'hour',
    source: 'plan',
    basis: 'assumption',
    samples: 0,
  }
  return Object.freeze(evidence)
}

/** Dependency-only timing: no machine, account or CI constraint can shorten it.
 * Durations, when supplied by S, are sampled *remaining* hours with their
 * evidence, not bare totals. Their map must cover exactly the graph. Merged
 * work always stays at zero.
 */
export function buildEstimateDag(
  input: readonly EstimateLane[],
  durations?: ReadonlyMap<string, EstimateDurationEvidence>,
): EstimateDag {
  if (input.length > ESTIMATE_MAX_ITEMS) invalid('lane-limit')
  const lanes = input.map((lane) => estimateLaneSchema.parse(lane))
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  if (byId.size !== lanes.length) invalid('duplicate-lane')
  if (
    durations &&
    (durations.size !== lanes.length || lanes.some((lane) => !durations.has(lane.id)))
  )
    invalid('duration-coverage')
  if (durations)
    for (const evidence of durations.values()) {
      if (!isEstimateDurationEvidence(evidence)) invalid('invalid-duration-evidence')
    }
  const successors = new Map(lanes.map((lane) => [lane.id, new Set<string>()]))
  const pending = new Map<string, number>()
  const nodes = new Map<string, DagNode>()
  const predecessors = new Map<string, string>()
  const order: string[] = []
  for (const lane of lanes) {
    const duration = durations
      ? (durations.get(lane.id) ?? invalid('duration-coverage'))
      : planDurationEvidence(remainingHours(lane))
    const hours = duration.hours
    if (hours < 0 || !Number.isFinite(hours)) invalid('invalid-duration')
    if (hours !== 0 && lane.state === 'merged') invalid('merged-duration')
    if (lane.state === 'running' && hours < lane.minimumRemainingHours) invalid('minimum-duration')
    nodes.set(lane.id, {
      laneId: lane.id,
      duration: Object.freeze({ ...duration }),
      earliestStartHours: 0,
      earliestFinishHours: 0,
      latestStartHours: 0,
      latestFinishHours: 0,
      slackHours: 0,
      tailHours: hours,
      critical: false,
    })
    pending.set(lane.id, lane.dependencies.length)
    for (const dependency of lane.dependencies) {
      if (dependency === lane.id) invalid('self-dependency')
      const children = successors.get(dependency)
      if (!children) invalid('missing-dependency')
      children.add(lane.id)
    }
  }
  const nodeFor = (id: string): DagNode => nodes.get(id) ?? invalid('missing-node')
  let ready = lanes
    .filter((lane) => lane.dependencies.length === 0)
    .map((lane) => lane.id)
    .toSorted(compareEstimateIds)
  while (ready.length > 0) {
    const id = ready.shift()
    if (id === undefined) invalid('missing-node')
    const lane = byId.get(id)
    if (!lane) invalid('missing-lane')
    const node = nodeFor(id)
    let predecessor: string | undefined
    for (const dependency of lane.dependencies.toSorted(compareEstimateIds)) {
      const finish = nodeFor(dependency).earliestFinishHours
      if (!(predecessor === undefined || finish > node.earliestStartHours)) {
        continue
      }

      node.earliestStartHours = finish
      predecessor = dependency
    }
    if (predecessor !== undefined) predecessors.set(id, predecessor)
    node.earliestFinishHours = node.earliestStartHours + node.duration.hours
    if (!Number.isFinite(node.earliestFinishHours)) invalid('duration-overflow')
    order.push(id)
    const children = successors.get(id) ?? []
    for (const child of children) {
      const count = (pending.get(child) ?? invalid('missing-lane')) - 1
      pending.set(child, count)
      if (count === 0) ready.push(child)
    }
    ready = ready.toSorted(compareEstimateIds)
  }
  if (order.length !== lanes.length) throw new Error(UI_TEXT.estimateCycle)
  let finishHours = 0
  let endpoint: string | undefined
  for (const id of order.toSorted(compareEstimateIds)) {
    const finish = nodeFor(id).earliestFinishHours
    if (!(finish > finishHours)) {
      continue
    }

    finishHours = finish
    endpoint = id
  }
  // Bound accumulated floating-point error, rather than making fractional-hour
  // critical lanes noncritical after forward/backward subtraction.
  const epsilon = Number.EPSILON * finishHours * Math.max(1, lanes.length)
  const zeroSmall = (value: number): number => (Math.abs(value) <= epsilon ? 0 : value)
  for (const id of order.toReversed()) {
    const node = nodeFor(id)
    const children = [...(successors.get(id) ?? [])].map((child) => nodeFor(child))
    node.latestFinishHours =
      children.length === 0
        ? finishHours
        : Math.min(...children.map((child) => child.latestStartHours))
    node.latestStartHours = zeroSmall(node.latestFinishHours - node.duration.hours)
    node.slackHours = zeroSmall(node.latestStartHours - node.earliestStartHours)
    node.tailHours = node.duration.hours + Math.max(0, ...children.map((child) => child.tailHours))
    node.critical = node.duration.hours > 0 && node.slackHours === 0
  }
  const path: string[] = []
  for (let id = endpoint; id !== undefined; id = predecessors.get(id)) {
    if (nodeFor(id).duration.hours > 0) path.push(id)
  }
  return {
    nodes: order.map((id) => nodeFor(id)),
    topologicalOrder: order,
    criticalPath: path.toReversed(),
    criticalPathHours: finishHours,
  }
}

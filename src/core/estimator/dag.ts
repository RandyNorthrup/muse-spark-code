import { estimateLaneSchema, type EstimateLane } from '../../shared/estimate'
import { ESTIMATE_MAX_ITEMS } from '../../shared/constants'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import { compareEstimateIds, remainingHours } from './goal'

interface DagNode {
  laneId: string
  durationHours: number
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

/** Dependency-only timing: no machine, account or CI constraint can shorten it.
 * Durations, when supplied by S, are sampled *remaining* hours, not totals.
 * Their map must cover exactly the graph. Merged work always stays at zero.
 */
export function buildEstimateDag(
  input: readonly EstimateLane[],
  durations?: ReadonlyMap<string, number>,
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
  const successors = new Map(lanes.map((lane) => [lane.id, new Set<string>()]))
  const pending = new Map<string, number>()
  const nodes = new Map<string, DagNode>()
  const predecessors = new Map<string, string>()
  const order: string[] = []
  for (const lane of lanes) {
    const duration = durations ? durations.get(lane.id) : remainingHours(lane)
    if (duration === undefined || duration < 0 || !Number.isFinite(duration))
      invalid('invalid-duration')
    if (duration !== 0 && lane.state === 'merged') invalid('merged-duration')
    if (lane.state === 'running' && duration < lane.minimumRemainingHours)
      invalid('minimum-duration')
    nodes.set(lane.id, {
      laneId: lane.id,
      durationHours: duration,
      earliestStartHours: 0,
      earliestFinishHours: 0,
      latestStartHours: 0,
      latestFinishHours: 0,
      slackHours: 0,
      tailHours: duration,
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
    node.earliestFinishHours = node.earliestStartHours + node.durationHours
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
    node.latestStartHours = zeroSmall(node.latestFinishHours - node.durationHours)
    node.slackHours = zeroSmall(node.latestStartHours - node.earliestStartHours)
    node.tailHours = node.durationHours + Math.max(0, ...children.map((child) => child.tailHours))
    node.critical = node.durationHours > 0 && node.slackHours === 0
  }
  const path: string[] = []
  for (let id = endpoint; id !== undefined; id = predecessors.get(id)) {
    if (nodeFor(id).durationHours > 0) path.push(id)
  }
  return {
    nodes: order.map((id) => nodeFor(id)),
    topologicalOrder: order,
    criticalPath: path.toReversed(),
    criticalPathHours: finishHours,
  }
}

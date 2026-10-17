import type {
  PlaybookBoard,
  PlaybookDrill,
  PlaybookLane,
  PlaybookWhyNote,
} from '../../../shared/playbook'

/** The planner supplies the trusted inventory of every introduced guard. */
export interface PlaybookDrillRequirements {
  guards(lane: PlaybookLane): readonly string[]
}

export function laneIdentity(lane: PlaybookLane): string {
  return `${lane.milestoneId}:${lane.id}`
}

export function dependencyIdentity(lane: PlaybookLane, dependency: string): string {
  return dependency.includes(':') ? dependency : `${lane.milestoneId}:${dependency}`
}

export function missingPrerequisites(lane: PlaybookLane, board: PlaybookBoard): string[] {
  return lane.starts.filter((dependency) => {
    const id = dependencyIdentity(lane, dependency)
    const local = board.lanes.find((candidate) => laneIdentity(candidate) === id)
    return local
      ? !local.merged
      : !board.mergedPrerequisites.includes(id) &&
          (dependency.includes(':') || !board.mergedPrerequisites.includes(dependency))
  })
}

export function hasReadyContracts(lane: PlaybookLane, board: PlaybookBoard): boolean {
  return board.lanes.some(
    (candidate) =>
      candidate.milestoneId === lane.milestoneId &&
      candidate.kind === 'contracts' &&
      candidate.merged &&
      candidate.reviewed,
  )
}

export function isValidDrill(drill: PlaybookDrill): boolean {
  return (
    [drill.guard, drill.mutation, drill.test, drill.observedFailure].every(
      (text) => text.trim().length > 0,
    ) &&
    /^[a-f\d]{64}$/u.test(drill.beforeSha256) &&
    drill.beforeSha256 === drill.restoredSha256
  )
}

/** Kahn's algorithm picks the smallest currently ready lane, rather than
 * sorting a topological result after the fact and breaking dependencies. */
export function orderedLanes(
  queue: readonly PlaybookLane[],
): { queue: PlaybookLane[] } | { missing: string[] } {
  const remaining = new Map(queue.map((lane) => [laneIdentity(lane), lane]))
  if (
    remaining.size !== queue.length ||
    queue.some((lane) => !Number.isFinite(lane.estimateHours) || lane.estimateHours < 0)
  )
    return { missing: queue.map((lane) => lane.id) }
  const result: PlaybookLane[] = []
  const admitted = new Set<string>()
  while (remaining.size > 0) {
    const ready = [...remaining]
      .map(([, lane]) => lane)
      .filter((lane) =>
        lane.starts.every((dependency) => admitted.has(dependencyIdentity(lane, dependency))),
      )
    ready.sort(
      (left, right) =>
        left.estimateHours - right.estimateHours ||
        Number(left.id > right.id) - Number(left.id < right.id) ||
        Number(laneIdentity(left) > laneIdentity(right)) -
          Number(laneIdentity(left) < laneIdentity(right)),
    )
    const next = ready[0]
    if (!next)
      return {
        missing: [
          ...new Set(
            [...remaining]
              .map(([, lane]) => lane)
              .flatMap((lane) =>
                lane.starts.filter(
                  (dependency) => !admitted.has(dependencyIdentity(lane, dependency)),
                ),
              ),
          ),
        ],
      }
    result.push(next)
    admitted.add(laneIdentity(next))
    remaining.delete(laneIdentity(next))
  }
  return { queue: result }
}

export function mergeBlock(
  lane: PlaybookLane,
  requirements: PlaybookDrillRequirements,
  isDrillRequired: boolean,
  isIntegrationRequired: boolean,
): PlaybookWhyNote['code'] | undefined {
  const guards = isDrillRequired && lane.addsTestsOrGates ? requirements.guards(lane) : []
  if (
    isDrillRequired &&
    lane.addsTestsOrGates &&
    (lane.drills.length === 0 ||
      lane.drills.some((drill) => !isValidDrill(drill)) ||
      guards.length === 0 ||
      guards.some((guard) => lane.drills.every((drill) => drill.guard !== guard)))
  )
    return 'drillMissing'
  return isIntegrationRequired &&
    (!lane.integrationTrunk.trim() || !lane.mergedTrunks.includes(lane.integrationTrunk))
    ? 'integrationRequired'
    : undefined
}

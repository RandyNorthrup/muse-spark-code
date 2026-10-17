import { REPORT_EXIT_CODES } from '../../../shared/constants'
import type { PlanFacts, PlanMilestone } from '../sources/types'
import { comparePlanText } from './grammar'

function normalize(id: string): string {
  const lower = id.toLowerCase()
  return /^\d+[a-z\d]*$/.test(lower) ? `m${lower}` : lower
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (const [index, character] of left.split('').entries()) {
    const row = [index + 1]
    for (let column = 0; column < right.length; column += 1)
      row.push(
        Math.min(
          (row[column] ?? 0) + 1,
          (previous[column + 1] ?? 0) + 1,
          (previous[column] ?? 0) + Number(character !== right[column]),
        ),
      )
    previous = row
  }
  return previous.at(-1) ?? 0
}

export function findMilestone(
  facts: PlanFacts,
  id: string,
):
  | { readonly exitCode: typeof REPORT_EXIT_CODES.generated; readonly milestone: PlanMilestone }
  | { readonly exitCode: typeof REPORT_EXIT_CODES.notFound; readonly nearest: readonly string[] } {
  const key = normalize(id)
  const milestone = facts.milestones.find((milestone) => normalize(milestone.id) === key)
  if (milestone) return { exitCode: REPORT_EXIT_CODES.generated, milestone }
  return {
    exitCode: REPORT_EXIT_CODES.notFound,
    nearest: facts.milestones
      .map(({ id }) => ({ id, distance: editDistance(key, normalize(id)) }))
      .toSorted(
        (left, right) => left.distance - right.distance || comparePlanText(left.id, right.id),
      )
      .slice(0, 2)
      .map(({ id }) => id),
  }
}

const COMPLETE_STATES = new Set<PlanMilestone['status']>([
  'complete',
  'merged',
  'released',
  'superseded',
])

/** Keep declared delivery order, and require evidence for every declared dependency. */
export function nextSteps(facts: PlanFacts): PlanFacts['deliveryOrder'] {
  const complete = (id: string) => {
    const [milestoneId = '', laneId] = id.split(/[/:]/, 2)
    const selected = findMilestone(facts, milestoneId)
    return selected.exitCode === REPORT_EXIT_CODES.generated
      ? COMPLETE_STATES.has(selected.milestone.status) ||
          (laneId !== undefined &&
            selected.milestone.lanes.some(
              (lane) => lane.id.toLowerCase() === laneId.toLowerCase() && lane.state === 'merged',
            ))
      : facts.releases.some(
          ({ version, text }) =>
            version === id.replace(/^v/, '') && !/^\*\*v?\d+\.\d+\.\d+ preparation \(/.test(text),
        )
  }
  return facts.deliveryOrder.filter(
    ({ id, needs }) => !complete(id) && needs.every((need) => complete(need)),
  )
}

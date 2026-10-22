// M96d stacked dependencies: the one satisfaction rule every
// scheduler surface shares. A `merged` edge waits for the landing, a
// `done` edge for the finished report, and a `stacked` edge for any
// finished head: the dependent starts from it and refreshes at its
// next attempt boundary when rework moves it.
import type { TeamBoardTaskState } from '../../../shared/team'

export type TeamDependencyOn = 'merged' | 'done' | 'stacked'

/** States whose work finished with a head the dependent can start from. */
const STACKED_FINISHED: ReadonlySet<TeamBoardTaskState> = new Set([
  'review',
  'merge',
  'merged',
  'done',
])

/**
Whether a dependency edge is satisfied by the dependency's state. A
missing `on` reads `done`-like: submit and reschedule resolve it
before it ever reaches here.
*/
export function isDependencySatisfied(
  on: TeamDependencyOn | undefined,
  state: TeamBoardTaskState,
): boolean {
  if (on === 'merged') return state === 'merged'
  return on === 'stacked' ? STACKED_FINISHED.has(state) : state === 'done' || state === 'merged'
}

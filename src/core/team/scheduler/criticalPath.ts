import { TEAM_SIZE_MINUTES } from '../../../shared/constants'
import { type TeamBoardTask } from '../../../shared/team'

/** Estimates include the task itself and its longest unfinished dependent chain. */
export function criticalPaths(
  tasks: readonly TeamBoardTask[],
  minutes: (task: TeamBoardTask) => number = (task) => TEAM_SIZE_MINUTES[task.size],
): ReadonlyMap<string, number> {
  const lengths = new Map<string, number>()
  const visiting = new Set<string>()
  const open = tasks.filter((task) =>
    ['queued', 'ready', 'running', 'blocked', 'review', 'merge'].includes(task.state),
  )
  const measure = (task: TeamBoardTask): number => {
    const cached = lengths.get(task.id)
    if (cached !== undefined) return cached
    if (visiting.has(task.id)) throw new Error('team:cycle')
    visiting.add(task.id)
    const dependents = open.filter((item) => item.depends_on?.some((edge) => edge.task === task.id))
    const length = minutes(task) + Math.max(0, ...dependents.map((dependent) => measure(dependent)))
    visiting.delete(task.id)
    lengths.set(task.id, length)
    return length
  }
  for (const task of open) measure(task)
  return lengths
}

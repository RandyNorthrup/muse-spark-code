// Preference management and Move to… (M120 lane P, PLAN.md D103 and D212).
//
// The preference editor reads and writes the same preference lists the
// selector runs: candidate order, secondary roles, borrow timers and the
// opt-in auto-order. Every writer validates through the shared schemas, so
// a stored list always parses. Move to… requeues a waiting task under
// another role and links the chain; a running task refuses, so stopping
// (lane H) comes first. Pure: the board and lists arrive as arguments.

import type { TaskBoard } from './scheduler/board'
import { chainMove } from './handoff'
import {
  teamBorrowTimersSchema,
  teamPreferenceListSchema,
  teamRoleAssignmentSchema,
  type TeamBorrowTimers,
  type TeamPreferenceList,
  type TeamRoleAssignment,
} from '../../shared/teamPreference'
import type { TeamHandoffRecord, TeamMoveTrigger } from '../../shared/teamHandoff'

/** A blank preference list for a role: one pool, no candidates yet. */
export function blankPreferenceList(roleId: string): TeamPreferenceList {
  return teamPreferenceListSchema.parse({ role: roleId, pool: [] })
}

/** Reorders a list's candidates; every id must appear exactly once. */
export function reorderCandidates(
  list: TeamPreferenceList,
  ids: readonly string[],
): TeamPreferenceList {
  const current = list.pool.map((candidate) => candidate.id)
  if (
    ids.length !== current.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !current.includes(id))
  ) {
    throw new Error('team:preferenceOrder')
  }
  const byId = new Map(list.pool.map((candidate) => [candidate.id, candidate]))
  return teamPreferenceListSchema.parse({
    ...list,
    pool: ids.map((id) => byId.get(id)),
  })
}

/** Sets an agent's secondary roles, in order; the main role is never secondary. */
export function setSecondaryRoles(
  assignments: readonly TeamRoleAssignment[],
  candidateId: string,
  mainRole: string,
  secondaryRoles: readonly string[],
): TeamRoleAssignment[] {
  const next = teamRoleAssignmentSchema.parse({ candidateId, mainRole, secondaryRoles })
  const kept = assignments.filter((assignment) => assignment.candidateId !== candidateId)
  return [...kept, next]
}

/** Sets a role's borrow timers; the demand wait keeps its 60 s floor. */
export function setBorrowTimers(
  list: TeamPreferenceList,
  timers: TeamBorrowTimers,
): TeamPreferenceList {
  return teamPreferenceListSchema.parse({ ...list, borrow: teamBorrowTimersSchema.parse(timers) })
}

/** Turns a role's opt-in auto-order on or off; off is the default. */
export function setAutoOrder(list: TeamPreferenceList, isOn: boolean): TeamPreferenceList {
  return teamPreferenceListSchema.parse({ ...list, autoOrder: isOn })
}

/**
Moves a waiting task to another role (Move to…): the board requeues it, and
the handoff chain links the move with the trigger the caller names. The
target names the target list's head candidate; launch selection still picks
by live headroom. A running task refuses with `team:taskRunning`: stop and
capture first. An unknown or empty target role refuses with
`team:roleNotStaffed`.
*/
export function moveTaskToRole(
  board: TaskBoard,
  lists: readonly TeamPreferenceList[],
  record: TeamHandoffRecord | undefined,
  taskId: string,
  roleId: string,
  atMs: number,
  trigger: TeamMoveTrigger = 'user',
): TeamHandoffRecord {
  const task = board.task(taskId)
  if (task.state === 'running') throw new Error('team:taskRunning')
  const target = lists.find((list) => list.role === roleId)
  if (target?.pool[0] === undefined) throw new Error('team:roleNotStaffed')
  if (!board.moveToRole(taskId, roleId, atMs)) throw new Error('team:taskRunning')
  const head = target.pool[0]
  const from = task.attempts.at(-1)?.entryId ?? task.roleId
  return chainMove(record, taskId, roleId, atMs, trigger, from, head.id, {
    commits: [],
    newFiles: [],
  })
}

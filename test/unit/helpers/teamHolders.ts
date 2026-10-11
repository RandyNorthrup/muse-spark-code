// The lease holders the team tests share (M96 lane B): the orchestrator is
// a holder like any other (D75).

import type { LeaseHolder } from '../../../src/core/team/resources'

export const RESEARCHER: LeaseHolder = { role: 'research', taskId: 'task-a', attempt: 1 }
export const ENGINEER: LeaseHolder = { role: 'engineering', taskId: 'task-b', attempt: 1 }
export const ORCHESTRATOR: LeaseHolder = { role: 'orchestrator', taskId: 'main', attempt: 1 }

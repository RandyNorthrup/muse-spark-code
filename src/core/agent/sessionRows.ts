// The History dialog row for a stored session of either backend.

import { type SessionRow, sessionTitle } from '../../shared/sessions'
import type { SessionRecord } from './agentBackend'

export function toSessionRow(record: SessionRecord): SessionRow {
  return {
    sessionId: record.sessionId,
    title: sessionTitle(record),
    isNamed: record.name !== undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.lastActivityAt !== undefined && { lastActivityAt: record.lastActivityAt }),
    ...(record.branch !== undefined && { branch: record.branch }),
    status: record.status,
    turnCount: record.turnCount,
    isFork: record.forkedFrom !== undefined && record.forkedFrom !== null,
  }
}

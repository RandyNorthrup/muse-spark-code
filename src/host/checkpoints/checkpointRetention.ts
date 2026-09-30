// How long checkpoints and redo records are kept (M72, PLAN.md D51): the
// newest CHECKPOINTS_PER_SESSION_MAX checkpoints and
// CHECKPOINT_RESTORES_PER_SESSION_MAX redo records of each conversation,
// for the CHECKPOINT_SESSIONS_MAX conversations used most recently, none
// older than `museSpark.cleanupPeriodDays`. A running turn's checkpoint is
// always kept. Pure: the store drops the refs and prunes.

import {
  CHECKPOINT_RESTORES_PER_SESSION_MAX,
  CHECKPOINT_SESSIONS_MAX,
  CHECKPOINTS_PER_SESSION_MAX,
  MILLISECONDS_PER_DAY,
} from '../../shared/constants'
import type { CheckpointRecord, CheckpointRecords, RestoreRecord } from './checkpointRecords'

export interface Retained {
  readonly checkpoints: CheckpointRecord[]
  readonly restores: RestoreRecord[]
  /** The records that went: their keep refs are dropped. */
  readonly dropped: readonly { readonly id: string }[]
}

function oldestFirst<T extends { readonly createdAt: number }>(records: readonly T[]): T[] {
  return records.toSorted((left, right) => left.createdAt - right.createdAt)
}

/** The newest `limit` records of each conversation, and every one `isAlwaysKept` names. */
function newestPerSession<T extends { readonly createdAt: number; readonly sessionId: string }>(
  records: readonly T[],
  limit: number,
  isAlwaysKept: (record: T) => boolean,
): readonly T[] {
  const counts = new Map<string, number>()
  return records
    .toSorted((left, right) => right.createdAt - left.createdAt)
    .filter((record) => {
      const count = (counts.get(record.sessionId) ?? 0) + 1
      counts.set(record.sessionId, count)
      return isAlwaysKept(record) || count <= limit
    })
}

/** The conversations used most recently, by their newest checkpoint or redo record. */
function recentSessions(records: CheckpointRecords): ReadonlySet<string> {
  const sessions: string[] = []
  const newestFirst = [...records.checkpoints, ...records.restores].toSorted(
    (left, right) => right.createdAt - left.createdAt,
  )
  for (const record of newestFirst) {
    if (!sessions.includes(record.sessionId)) {
      sessions.push(record.sessionId)
    }
  }
  return new Set(sessions.slice(0, CHECKPOINT_SESSIONS_MAX))
}

/** What the retention bounds keep of the records, and what they drop. */
export function retainRecords(
  records: CheckpointRecords,
  now: number,
  retentionDays: number,
  isOpen: (record: CheckpointRecord) => boolean,
): Retained {
  const cutoff = retentionDays > 0 ? now - retentionDays * MILLISECONDS_PER_DAY : -Infinity
  const sessions = recentSessions(records)
  const isCurrent = (record: CheckpointRecord | RestoreRecord) =>
    sessions.has(record.sessionId) && record.createdAt >= cutoff
  const checkpoints = newestPerSession(
    records.checkpoints.filter((record) => isOpen(record) || isCurrent(record)),
    CHECKPOINTS_PER_SESSION_MAX,
    isOpen,
  )
  const restores = newestPerSession(
    records.restores.filter((record) => isCurrent(record)),
    CHECKPOINT_RESTORES_PER_SESSION_MAX,
    () => false,
  )
  return {
    checkpoints: oldestFirst(checkpoints),
    restores: oldestFirst(restores),
    dropped: [
      ...records.checkpoints.filter((record) => !checkpoints.includes(record)),
      ...records.restores.filter((record) => !restores.includes(record)),
    ],
  }
}

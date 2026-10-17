// How long checkpoint records are kept (M72, M86; PLAN.md D51, D63). Within
// a conversation by number only, never by the clock: the newest
// CHECKPOINTS_PER_SESSION_MAX units (turns, restores and Redos alike) stay,
// so a restore from a turn still offered has every unit it needs (they are
// all newer than anything dropped). Whole conversations go: beyond the
// CHECKPOINT_SESSIONS_MAX used most recently, or idle longer than
// `museSpark.cleanupPeriodDays`. A conversation with a unit still running is
// kept whole. Pure: the store drops the refs and prunes.

import {
  CHECKPOINT_SESSIONS_MAX,
  CHECKPOINTS_PER_SESSION_MAX,
  MILLISECONDS_PER_DAY,
} from '../../shared/constants'

/** What retention reads of a record. */
export interface RetainedRecord {
  readonly sessionId: string
  /** Its number in its conversation (an M72 record without one counts as before every other). */
  readonly sequence: number
  readonly createdAt: number
  /** Still running here, or in another live window. */
  readonly isOpen: boolean
}

/** The records the retention bounds drop: whole conversations, and each one's oldest by number. */
export function droppedRecords<T extends RetainedRecord>(
  records: readonly T[],
  now: number,
  retentionDays: number,
): readonly T[] {
  const cutoff = retentionDays > 0 ? now - retentionDays * MILLISECONDS_PER_DAY : -Infinity
  const conversations = new Map<string, T[]>()
  for (const record of records) {
    conversations.set(record.sessionId, [...(conversations.get(record.sessionId) ?? []), record])
  }
  const lastUsed = (members: readonly T[]) => Math.max(...members.map((record) => record.createdAt))
  const recent = new Set(
    [...conversations]
      .filter(([, members]) => lastUsed(members) >= cutoff)
      .toSorted(([, left], [, right]) => lastUsed(right) - lastUsed(left))
      .slice(0, CHECKPOINT_SESSIONS_MAX)
      .map(([sessionId]) => sessionId),
  )
  const dropped: T[] = []
  for (const [sessionId, members] of conversations) {
    if (members.some((record) => record.isOpen)) {
      continue
    }
    if (!recent.has(sessionId)) {
      dropped.push(...members)
      continue
    }
    const newestFirst = members.toSorted((left, right) => right.sequence - left.sequence)
    dropped.push(...newestFirst.slice(CHECKPOINTS_PER_SESSION_MAX))
  }
  return dropped
}

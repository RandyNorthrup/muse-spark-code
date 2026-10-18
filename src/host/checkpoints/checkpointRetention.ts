// How long checkpoint records are kept (M72, M86; PLAN.md D51, D63). By the
// clock only, never by number: every unit of a conversation stays (turns,
// restores and Redos alike), so a restore from a turn still offered has
// every unit it needs. Whole conversations go when idle longer than
// `museSpark.cleanupPeriodDays` (0: no age limit). A conversation with a
// unit still running is kept whole. Pure: the store drops the refs and prunes.

import { MILLISECONDS_PER_DAY } from '../../shared/constants'

/** What retention reads of a record. */
export interface RetainedRecord {
  readonly sessionId: string
  /** Its number in its conversation (an M72 record without one counts as before every other). */
  readonly sequence: number
  readonly createdAt: number
  /** Still running here, or in another live window. */
  readonly isOpen: boolean
}

/** The records the retention bounds drop: idle whole conversations only, never units by number. */
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
  const dropped: T[] = []
  for (const [, members] of conversations) {
    if (members.some((record) => record.isOpen)) {
      continue
    }
    if (lastUsed(members) < cutoff) {
      dropped.push(...members)
    }
  }
  return dropped
}

import { historyRecordSchema, type HistoryRecord } from '../../../shared/estimate'
import { UI_TEXT, fill } from '../../../shared/l10n/text'

/** Fixed technical codes only: source errors, paths and content never enter a message. */
export function calibrationFailure(code: string): Error {
  return Object.assign(new Error(fill(UI_TEXT.estimateFailed, { detail: code })), { code })
}

export function compareIds(left: string, right: string): number {
  return left < right ? -1 : Number(left > right)
}

/** Canonical metadata, with complete lane rounds preserved rather than summed over modules. */
export function canonicalRecord(value: unknown): HistoryRecord {
  const parsed = historyRecordSchema.safeParse(value)
  if (!parsed.success) throw calibrationFailure('invalidHistory')
  const record = parsed.data
  record.startedAt = new Date(record.startedAt).toISOString()
  record.finishedAt = new Date(record.finishedAt).toISOString()
  if (record.review.status === 'known') {
    record.review.modules.sort((left, right) => compareIds(left.familyId, right.familyId))
    for (const module of record.review.modules)
      module.classes.sort((left, right) => compareIds(left.class, right.class))
    record.review.redesigns.sort(
      (left, right) =>
        compareIds(left.moduleFamilyId, right.moduleFamilyId) || left.afterRound - right.afterRound,
    )
  }
  return record
}

export function recordKey(record: HistoryRecord): string {
  return `${record.laneId}/${record.durationBasis}`
}

/** Replayed observations count once; conflicting observations are never chosen by input order. */
export function canonicalHistory(values: readonly unknown[]): HistoryRecord[] {
  const unique = new Map<string, HistoryRecord>()
  const identities = new Map<string, string>()
  for (const value of values) {
    const record = canonicalRecord(value)
    const identity = `${record.kind}/${record.machineClassId}`
    const previousIdentity = identities.get(record.laneId)
    if (previousIdentity !== undefined && previousIdentity !== identity)
      throw calibrationFailure('conflictingLaneIdentity')
    identities.set(record.laneId, identity)
    const key = recordKey(record)
    const previous = unique.get(key)
    if (previous && JSON.stringify(previous) !== JSON.stringify(record))
      throw calibrationFailure('conflictingHistory')
    unique.set(key, record)
  }
  return Array.from(unique, ([, record]) => record).toSorted((left, right) =>
    compareIds(recordKey(left), recordKey(right)),
  )
}

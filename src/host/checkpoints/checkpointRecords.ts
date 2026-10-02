// The checkpoint store's records (M72, M86; PLAN.md D51, D63). Each record
// is its own JSON blob in the shadow repository, under a ref of its own
// (recordRefs.ts), parsed with zod when read (rule 7); a record that does not
// parse is dropped (a unit whose record does not parse refuses any range it
// is in).
//
// - A unit record (M86): one turn of a conversation, or one restore or Redo
//   of it (a batch), with its number in the conversation and every write its
//   tools journaled, each with how it ended (toolWrites.ts).
// - M72 records, read only: a turn's checkpoint, which is listed as legacy
//   (no file restore), and a restore's redo record, which is not redoable.
// - The restore reservation (`RESTORE_REF`) holds a record of the M72 restore
//   shape naming its window, so a 0.10.0 window still reads its owner.

import * as z from 'zod/mini'
import type { UnitRecord } from '../../core/checkpoints/toolWrites'

const contentStateSchema = z.object({
  present: z.boolean(),
  oid: z.optional(z.string()),
  mode: z.optional(z.string()),
})

const ownerSchema = z.object({
  instance: z.string(),
  sessionId: z.string(),
  unitKind: z.enum(['turn', 'batch']),
  unitId: z.string(),
})

const foldedWriteSchema = z.object({
  id: z.string(),
  instance: z.string(),
  seq: z.number(),
  owner: ownerSchema,
  path: z.string(),
  before: contentStateSchema,
  after: contentStateSchema,
  createdFolders: z.array(z.string()),
  isKept: z.boolean(),
  outcome: z.enum(['done', 'aborted', 'unsettled']),
})

const unitRecordSchema = z.object({
  kind: z.literal('unit'),
  owner: ownerSchema,
  sequence: z.number(),
  createdAt: z.number(),
  endedAt: z.optional(z.number()),
  status: z.enum(['complete', 'incomplete']),
  ranProcesses: z.boolean(),
  /**
   * Its journal says writes may exist that no intent describes: the unit
   * passed its intent budget, or a journal line of it could not be read. Any
   * range that holds it is refused whole.
   */
  isMarkedIncomplete: z.boolean(),
  /** Retention keeps identity/sequence only, so old journal owners are explained. */
  isRetired: z.optional(z.boolean()),
  transcript: z.optional(z.object({ fromTurnId: z.string(), turnIds: z.array(z.string()) })),
  writes: z.array(foldedWriteSchema),
})

/** A unit's record as stored: the shared shape and what the store adds. */
export type StoredUnit = UnitRecord & {
  readonly kind: 'unit'
  readonly isMarkedIncomplete: boolean
  readonly isRetired?: boolean | undefined
  readonly transcript?:
    { readonly fromTurnId: string; readonly turnIds: readonly string[] } | undefined
}

/** A unit record from its JSON; undefined when it does not parse. */
export function parseUnit(text: string): StoredUnit | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const result = unitRecordSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

// Every M72 record names the work tree and the workspace's place in it: a
// record of another place (the workspace moved) is not this workspace's.
const legacyCheckpointSchema = z.object({
  kind: z.literal('checkpoint'),
  top: z.string(),
  prefix: z.string(),
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  createdAt: z.number(),
  /** Its start's number among its conversation's starts and ends; absent in a 0.10.0 candidate's. */
  sequence: z.optional(z.number()),
  endSequence: z.optional(z.number()),
})

const legacyRestoreSchema = z.object({
  kind: z.literal('restore'),
  top: z.string(),
  prefix: z.string(),
  id: z.string(),
  sessionId: z.string(),
  createdAt: z.number(),
  /** The window owning a transient restore reservation, when present. */
  owner: z.optional(z.string()),
  entries: z.array(z.unknown()),
})

const storedRecordSchema = z.discriminatedUnion('kind', [
  legacyCheckpointSchema,
  legacyRestoreSchema,
])
export type StoredRecord = z.infer<typeof storedRecordSchema>

/** An M72 record (or the restore reservation) from its JSON; undefined when it does not parse. */
export function parseRecord(text: string): StoredRecord | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const result = storedRecordSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

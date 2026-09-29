// The checkpoint store's records (M72, PLAN.md D51): which checkpoint
// belongs to which conversation and turn, what each capture left out, the
// ignored files each turn changed, and what each restore can redo. Each
// record is its own JSON blob in the shadow repository, under a ref of its
// own (recordRefs.ts), parsed with zod when read (rule 7); a record that
// does not parse is dropped.

import * as z from 'zod/mini'

const blobRefSchema = z.object({ mode: z.string(), oid: z.string() })
const statSchema = z.object({ size: z.number(), mtimeMs: z.number() })
const coverageSchema = z.object({
  skipped: z.array(z.string()),
  repositories: z.array(z.string()),
})
const captureSchema = z.object({
  tree: z.string(),
  coverage: coverageSchema,
  /**
   * The folders the capture holds no file of (empty, or only ignored or
   * left-out content), a folder listed whole standing for everything below
   * it; absent when unknown (over the limit), and then a restore removes no
   * folder.
   */
  folders: z.optional(z.array(z.string())),
})
const ignoredChangeSchema = z.object({
  path: z.string(),
  kind: z.enum(['created', 'changed', 'deleted']),
  preImage: z.optional(z.nullable(blobRefSchema)),
  startStat: z.nullable(statSchema),
  endStat: z.nullable(statSchema),
})

// Every record names the work tree and the workspace's place in it: a record
// of another place (the workspace moved) is not this workspace's.
const checkpointRecordSchema = z.object({
  kind: z.literal('checkpoint'),
  top: z.string(),
  prefix: z.string(),
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  createdAt: z.number(),
  start: captureSchema,
  /** The capture at the turn's end; absent while it runs, or when the end was not seen. */
  end: z.optional(captureSchema),
  /** When the turn's end was seen (with or without a capture): other conversations' overlap. */
  endedAt: z.optional(z.number()),
  /** The store (one per window) that recorded it: only it ends the turn. */
  owner: z.optional(z.string()),
  /**
   * The ignored files the turn changed. `isComplete` is false when the turn's
   * start scan was not at hand (a window reload mid-turn) or the list was cut.
   */
  ignored: z.optional(z.object({ changes: z.array(ignoredChangeSchema), isComplete: z.boolean() })),
})
export type CheckpointRecord = z.infer<typeof checkpointRecordSchema>

const restoreEntrySchema = z.object({
  path: z.string(),
  /** What the restore replaced (put back by a redo); `null`: nothing was there. */
  before: z.nullable(blobRefSchema),
  /** What the restore left; `null`: it deleted the file. */
  after: z.nullable(blobRefSchema),
})
export type RestoreEntry = z.infer<typeof restoreEntrySchema>

const restoreRecordSchema = z.object({
  kind: z.literal('restore'),
  top: z.string(),
  prefix: z.string(),
  id: z.string(),
  sessionId: z.string(),
  createdAt: z.number(),
  entries: z.array(restoreEntrySchema),
})
export type RestoreRecord = z.infer<typeof restoreRecordSchema>

const storedRecordSchema = z.discriminatedUnion('kind', [
  checkpointRecordSchema,
  restoreRecordSchema,
])
export type StoredRecord = z.infer<typeof storedRecordSchema>

/** A workspace's records, as the retention bounds see them. */
export interface CheckpointRecords {
  readonly checkpoints: readonly CheckpointRecord[]
  readonly restores: readonly RestoreRecord[]
}

/** A record from its JSON; undefined when it does not parse. */
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

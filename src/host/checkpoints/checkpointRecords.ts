// The checkpoint store's own records (M72, PLAN.md D51): which checkpoint
// belongs to which conversation and turn, what each capture left out, the
// ignored files each turn changed, and what each restore can redo. Kept as
// JSON beside the shadow repository and parsed with zod when read (rule 7):
// a file that does not parse is set aside and the store starts afresh.

import { rename } from 'node:fs/promises'
import * as z from 'zod/mini'
import { writeFileAtomically } from '../fsAtomic'
import { readOptionalText } from './shadowGit'

const RECORDS_VERSION = 1
const SET_ASIDE_SUFFIX = '.unreadable'

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

const checkpointRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  createdAt: z.number(),
  start: captureSchema,
  /** The capture at the turn's end; absent while it runs, or when the end was not seen. */
  end: z.optional(captureSchema),
  /** When the turn's end was seen (with or without a capture): other conversations' overlap. */
  endedAt: z.optional(z.number()),
  /** The store (one per window) that recorded it: a running turn of a live window counts. */
  owner: z.optional(z.string()),
  /**
   * The ignored files the turn changed. `isComplete` is false when the turn's
   * start scan was not at hand (a window reload mid-turn) or the list was cut.
   */
  ignored: z.optional(z.object({ changes: z.array(ignoredChangeSchema), isComplete: z.boolean() })),
  /** The tree object that keeps every copy this record needs from pruning. */
  keep: z.string(),
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
  id: z.string(),
  sessionId: z.string(),
  createdAt: z.number(),
  entries: z.array(restoreEntrySchema),
  keep: z.string(),
})
export type RestoreRecord = z.infer<typeof restoreRecordSchema>

const recordsSchema = z.object({
  version: z.literal(RECORDS_VERSION),
  /** The work tree and the workspace's place in it: a change starts afresh. */
  top: z.string(),
  prefix: z.string(),
  checkpoints: z.array(checkpointRecordSchema),
  restores: z.array(restoreRecordSchema),
  /**
   * Conversations archived lately, and when: a capture taken before then,
   * in any window, is not recorded for them. Archiving in Restricted Mode
   * drops the records here with no git; their copies go at the next
   * trusted open.
   */
  forgotten: z.optional(z.array(z.object({ sessionId: z.string(), at: z.number() }))),
})
export type CheckpointRecords = z.infer<typeof recordsSchema>

export function emptyRecords(top: string, prefix: string): CheckpointRecords {
  return { version: RECORDS_VERSION, top, prefix, checkpoints: [], restores: [] }
}

/**
 * The records on disk, or undefined when there are none or they do not
 * parse (the unreadable file is renamed aside, and `onUnreadable` says why).
 */
export async function loadRecords(
  filePath: string,
  onUnreadable: (reason: string) => void,
): Promise<CheckpointRecords | undefined> {
  const text = await readOptionalText(filePath)
  if (text === undefined) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    onUnreadable(error instanceof Error ? error.message : String(error))
    await rename(filePath, `${filePath}${SET_ASIDE_SUFFIX}`)
    return undefined
  }
  const result = recordsSchema.safeParse(parsed)
  if (!result.success) {
    onUnreadable(z.prettifyError(result.error))
    await rename(filePath, `${filePath}${SET_ASIDE_SUFFIX}`)
    return undefined
  }
  return result.data
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function saveRecords(filePath: string, records: CheckpointRecords): Promise<void> {
  await writeFileAtomically(filePath, JSON.stringify(records), { sleep: pause })
}

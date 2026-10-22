import * as z from 'zod/mini'

const idSchema = z.string().check(z.minLength(1))
const timeSchema = z.int().check(z.nonnegative())

// What moves a running task (D103), and D212's borrow and recall.
export const teamMoveTriggers = [
  'returnToPreferred',
  'stall',
  'timeBox',
  'cap',
  'refusal',
  'user',
] as const
export const teamMoveTriggerSchema = z.enum(teamMoveTriggers)
export type TeamMoveTrigger = z.infer<typeof teamMoveTriggerSchema>

/** References to the captured work: never the bytes themselves. */
export const teamCapturedWorkSchema = z.object({
  commits: z.array(idSchema),
  /** The binary-safe uncommitted diff's stored reference, if any. */
  diffRef: z.optional(idSchema),
  newFiles: z.array(idSchema),
  /** The progress note's stored reference, if any. */
  noteRef: z.optional(idSchema),
})
export type TeamCapturedWork = z.infer<typeof teamCapturedWorkSchema>

// How a recall ended (D212): the task finished in grace, stopped at a safe
// point, or was stopped after the recall wait.
export const teamRecallEndings = ['finished', 'safePoint', 'stopped'] as const
export type TeamRecallEnding = (typeof teamRecallEndings)[number]

/** One link of a task's chain: a move, a borrow or a recall. */
export const teamChainEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    atMs: timeSchema,
    trigger: teamMoveTriggerSchema,
    fromCandidateId: idSchema,
    toCandidateId: idSchema,
    work: teamCapturedWorkSchema,
  }),
  z.object({
    kind: z.literal('borrow'),
    atMs: timeSchema,
    candidateId: idSchema,
    mainRole: idSchema,
    borrowingRole: idSchema,
  }),
  z.object({
    kind: z.literal('recall'),
    atMs: timeSchema,
    candidateId: idSchema,
    mainRole: idSchema,
    ending: z.enum(teamRecallEndings),
    work: z.optional(teamCapturedWorkSchema),
  }),
])
export type TeamChainEntry = z.infer<typeof teamChainEntrySchema>

/** The handoff record a task's report carries: its chain, oldest first. */
export const teamHandoffRecordSchema = z
  .object({
    taskId: idSchema,
    roleId: idSchema,
    chain: z.array(teamChainEntrySchema),
  })
  .check(
    z.refine((record) =>
      record.chain.every(
        (entry, at) => at === 0 || entry.atMs >= (record.chain[at - 1]?.atMs ?? 0),
      ),
    ),
  )
export type TeamHandoffRecord = z.infer<typeof teamHandoffRecordSchema>

// M88: prompt sequences, portable contracts only. The file store lives in
// core (sequenceStore), the runner behind the host's deferred send.
import * as z from 'zod/mini'
import { SEQUENCE_SCHEMA_VERSION, UI_TEXT } from './constants'

export const sequenceScopeSchema = z.enum(['user', 'workspace'])
export type SequenceScope = z.infer<typeof sequenceScopeSchema>

export const savedSequenceSchema = z
  .strictObject({
    schemaVersion: z.literal(SEQUENCE_SCHEMA_VERSION),
    id: z.string().check(z.minLength(1)),
    name: z.string().check(z.minLength(1)),
    /** The step texts in run order, each non-blank (checked on write, D121). */
    steps: z.array(z.string()),
    scope: sequenceScopeSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .check(z.refine((sequence) => Date.parse(sequence.createdAt) <= Date.parse(sequence.updatedAt)))
export type SavedSequence = z.infer<typeof savedSequenceSchema>

/** Whole-file JSON, pretty so a sequence stays hand-editable. */
export function serialiseSequenceFile(input: SavedSequence): string {
  return JSON.stringify(savedSequenceSchema.parse(input), undefined, 2)
}

/** Malformed or foreign JSON throws; never yields an empty sequence. */
export function parseSequenceFile(file: string): SavedSequence {
  let parsed: unknown
  try {
    parsed = JSON.parse(file)
  } catch {
    throw new Error(UI_TEXT.promptStoreDamaged)
  }
  return savedSequenceSchema.parse(parsed)
}

/** User first, then workspace; name/id lexical order, same name in both stays. */
export function mergeSequenceScopes(
  user: readonly SavedSequence[],
  workspace: readonly SavedSequence[],
): SavedSequence[] {
  return [
    ...user.filter((s) => s.scope === 'user'),
    ...workspace.filter((s) => s.scope === 'workspace'),
  ]
    .toSorted((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'user' ? -1 : 1
      const left = `${a.name}\u{0}${a.id}`
      const right = `${b.name}\u{0}${b.id}`
      if (left === right) return 0
      return left < right ? -1 : 1
    })
    .filter((s, index, all) => all.findIndex((v) => v.scope === s.scope && v.id === s.id) === index)
}

/** A run the panel shows: sequence, position, nothing else. */
export const sequenceRunViewSchema = z.strictObject({
  sequenceId: z.string().check(z.minLength(1)),
  scope: sequenceScopeSchema,
  name: z.string().check(z.minLength(1)),
  /** The step running or next, 1-based; total never changes mid-run. */
  step: z.number().check(z.int(), z.minimum(1)),
  total: z.number().check(z.int(), z.minimum(1)),
})
export type SequenceRunView = z.infer<typeof sequenceRunViewSchema>

/** A run's end: stopped, or the terminal that ended it. */
export const sequenceEndReasonSchema = z.enum(['stopped', 'failed', 'cancelled', 'switched'])
export type SequenceEndReason = z.infer<typeof sequenceEndReasonSchema>

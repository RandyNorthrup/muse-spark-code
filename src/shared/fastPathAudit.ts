// D107 §9.6: a fast-path allow's audit facts. The journal entry and
// the agent event share this one schema: class, program, the resolved
// executable for the eight programs that exec one (stat runs none),
// confinement and its version, the veto's deadline, the entries not
// read, and — only when the veto ran a pipeline that exposes its
// numbers — engine, calibrated p(yes) and bar, in permille. Closed
// vocabularies and bounded integers throughout; no command text, no
// output, no paths outside the verified system table.
import * as z from 'zod/mini'
import { PERMILLE_MAX } from './constants'

const SYSTEM_EXECUTABLE = /^\/(?:bin|usr\/bin)\/(?:ls|cat|head|tail|wc|du|grep|find)$/
const ENGINE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9.:/_-]{0,63}$/

export const fastPathAuditSchema = z.strictObject({
  class: z.literal('B1'),
  program: z.enum(['ls', 'cat', 'head', 'tail', 'wc', 'stat', 'du', 'grep', 'find']),
  executable: z.optional(z.string().check(z.regex(SYSTEM_EXECUTABLE))),
  confinement: z.enum(['landlock', 'seatbelt']),
  confinementVersion: z.number().check(z.int(), z.minimum(0)),
  deadlineMs: z.number().check(z.int(), z.minimum(0)),
  excluded: z.number().check(z.int(), z.minimum(0)),
  engine: z.optional(z.string().check(z.regex(ENGINE_TOKEN))),
  pYesMilli: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(PERMILLE_MAX))),
  thresholdMilli: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(PERMILLE_MAX))),
})

export type FastPathAudit = z.infer<typeof fastPathAuditSchema>

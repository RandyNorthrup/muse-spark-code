// Node bundles validate team payloads through the existing deferred team bundle.
// The browser uses teamView.ts directly; ordinary items never invoke these lazies.
import * as z from 'zod/mini'
import { createRequire } from 'node:module'
import type { createTeamViewSchemas } from '../core/team/teamEntry'

interface TeamViewBundle {
  readonly createTeamViewSchemas: typeof createTeamViewSchemas
}

// The factory signature is trusted across bundles built/shipped together (PLAN §8).
function isTeamViewBundle(value: unknown): value is TeamViewBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createTeamViewSchemas' in value &&
    typeof value.createTeamViewSchemas === 'function'
  )
}

const current: { schemas: ReturnType<typeof createTeamViewSchemas> | undefined } = {
  schemas: undefined,
}
function schemas(): ReturnType<typeof createTeamViewSchemas> {
  if (current.schemas !== undefined) return current.schemas
  const bundle: unknown = createRequire(__filename)('./team.js')
  if (!isTeamViewBundle(bundle)) throw new Error('Team view schema factory is unavailable')
  current.schemas = bundle.createTeamViewSchemas()
  return current.schemas
}

// Zod's optional metadata consults a lazy getter even for an absent field.
// A pipe resolves the real schema only while parsing a present payload.
function deferred<T>(read: () => z.ZodMiniType<T>): z.ZodMiniType<T> {
  return z.pipe(
    z.nonoptional(z.unknown()),
    z.transform((input, payload) => {
      const result = read().safeParse(input)
      if (result.success) return result.data
      for (const issue of result.error.issues) {
        payload.issues.push({ code: 'custom', input, path: issue.path, message: issue.message })
      }
      return z.NEVER
    }),
  )
}

export const teamTreeSchema = deferred(() => schemas().teamTreeSchema)
export const teamUsageSchema = deferred(() => schemas().teamUsageSchema)
export const teamItemFields = {
  // The outer optional prevents an absent field from loading the team bundle.
  teamPlan: z.optional(deferred(() => schemas().teamItemFields.teamPlan)),
  teamSwitch: z.optional(deferred(() => schemas().teamItemFields.teamSwitch)),
  teamWaiting: z.optional(deferred(() => schemas().teamItemFields.teamWaiting)),
  teamMerge: z.optional(deferred(() => schemas().teamItemFields.teamMerge)),
  teamReport: z.optional(deferred(() => schemas().teamItemFields.teamReport)),
  teamWorker: z.optional(deferred(() => schemas().teamItemFields.teamWorker)),
  teamDecision: z.optional(z.string()),
} as const

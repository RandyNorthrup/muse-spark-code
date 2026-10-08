// Extension-owned Judge status, validated at the panel boundary.
import * as z from 'zod/mini'

export const judgeStatusSchema = z.object({
  mode: z.enum(['same', 'separate', 'both', 'off']),
  modelId: z.string(),
  billing: z.enum(['subscription', 'modelApi']),
  reason: z.enum([
    'explicit-off',
    'unknown-setting',
    'consent-needed',
    'consent-declined',
    'source-unavailable',
    'ready-rate-low',
    'auto-same',
    'explicit-same',
    'source-untested',
    'profile-missing',
    'auto-both',
    'explicit-separate',
    'explicit-both',
  ]),
  autoSameReason: z.optional(
    z.enum(['source-unavailable', 'source-untested', 'profile-missing', 'evidence-missing']),
  ),
})
export type JudgeStatus = z.infer<typeof judgeStatusSchema>

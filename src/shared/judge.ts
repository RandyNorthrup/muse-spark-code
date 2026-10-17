// Extension-owned Judge status, validated at the panel boundary.
import * as z from 'zod/mini'

export const judgeStatusSchema = z.object({
  mode: z.enum(['same', 'off']),
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
  ]),
})
export type JudgeStatus = z.infer<typeof judgeStatusSchema>

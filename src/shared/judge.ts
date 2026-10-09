// Extension-owned Judge status, validated at the panel boundary.
import * as z from 'zod/mini'
import { JUDGE_PANEL_REASONS } from './judgePanelSchema'

/**
 * Why a configured separate source has no side in this build (M98 phase 2
 * redesign); the status line names it in plain words. Window-only.
 */
export const JUDGE_SEPARATE_GAPS = [
  'needs-key',
  'needs-capability-capture',
  'needs-local-install',
  'unknown-source',
] as const

export const judgeStatusSchema = z.object({
  mode: z.enum(['same', 'separate', 'both', 'off']),
  modelId: z.string(),
  billing: z.enum(['subscription', 'modelApi', 'free']),
  // `labels-missing` is window-only: a configured embedding transport with
  // no recorded head yet (L98P2-EMBED). It never comes from the panel wire.
  embeddingReason: z.optional(z.enum([...JUDGE_PANEL_REASONS, 'labels-missing'])),
  reason: z.enum([
    ...JUDGE_PANEL_REASONS,
    'auto-same',
    'explicit-same',
    'auto-both',
    'explicit-separate',
    'explicit-both',
  ]),
  separateGap: z.optional(z.enum(JUDGE_SEPARATE_GAPS)),
  autoSameReason: z.optional(
    z.enum(['source-unavailable', 'source-untested', 'profile-missing', 'evidence-missing']),
  ),
})
export type JudgeStatus = z.infer<typeof judgeStatusSchema>

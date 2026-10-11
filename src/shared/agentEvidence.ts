// D101: owned structured evidence, validated independently of presentation.
import * as z from 'zod/mini'

export const agentOutcomeSchema = z.enum([
  'complete',
  'incomplete',
  'failed',
  'cancelled',
  'unverified',
])
export type AgentOutcome = z.infer<typeof agentOutcomeSchema>
export const agentStopSchema = z.enum(['normal', 'budget', 'error', 'cancelled', 'unknown'])
export const agentFileSchema = z.object({
  path: z.string(),
  added: z.number(),
  removed: z.number(),
})
export const agentCheckSchema = z.object({
  command: z.string(),
  exitCode: z.optional(z.number()),
  durationMs: z.optional(z.number()),
  outcome: z.optional(z.string()),
})
export const agentReceiptSchema = z.object({
  files: z.array(agentFileSchema),
  checks: z.array(agentCheckSchema),
  stopReason: agentStopSchema,
  finalMessage: z.string(),
  unfinished: z.array(z.string()),
  truncated: z.boolean(),
})
export type AgentReceipt = z.infer<typeof agentReceiptSchema>
export const agentAttemptSchema = z.object({
  number: z.int().check(z.gte(1)),
  outcome: agentOutcomeSchema,
  receipt: agentReceiptSchema,
})
export type AgentAttempt = z.infer<typeof agentAttemptSchema>
export const agentEvidenceSchema = z.object({
  stopReason: z.optional(agentStopSchema),
  reportedComplete: z.optional(z.boolean()),
  unfinished: z.optional(z.array(z.string())),
  checksRequired: z.optional(z.boolean()),
  finalCheck: z.optional(z.enum(['passed', 'failed', 'missing', 'unknown'])),
  worktree: z.optional(z.enum(['clean', 'dirty', 'unknown', 'shared'])),
  inFlight: z.optional(z.boolean()),
  lastOutputAt: z.optional(z.number()),
  waiting: z.optional(z.enum(['approval', 'input', 'queued', 'interrupted', 'idle'])),
  attempt: z.optional(z.int().check(z.gte(1))),
  attempts: z.optional(z.array(agentAttemptSchema)),
})
export type AgentEvidence = z.infer<typeof agentEvidenceSchema>

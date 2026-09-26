// The transcript rows the webview keeps, as zod schemas with the types
// inferred from them (M25, PLAN.md D28). The schemas exist because the rows
// outlive the document: the panel saves its conversation in VS Code's webview
// state, and what comes back after a reload (or from an older build of the
// extension) is validated like any other boundary input before the reducer
// touches it. Deriving the types from the schemas means a field added to a
// row cannot be forgotten by the validation. Arrays are read-only, as the
// reducer treats them.

import * as z from 'zod/mini'
import {
  approvalChoiceSchema,
  approvalSubjectSchema,
  answerSchema,
  citationSchema,
  outputRefSchema,
  patchSummarySchema,
  questionSchema,
  requirementRefSchema,
  tokenUsageSchema,
  workflowRunFields,
} from '../../shared/agentEvents'
import { PAID_FEATURES, TASK_REQUESTS } from '../../shared/constants'
import { NOTICE_LEVELS } from '../../shared/protocol'

const pendingApprovalSchema = z.object({
  approvalId: z.string(),
  requirementId: requirementRefSchema,
  subject: approvalSubjectSchema,
  rawArgs: z.string(),
  availableChoices: z.readonly(z.array(approvalChoiceSchema)),
  isProtectedWrite: z.boolean(),
  isJudgeEscalated: z.boolean(),
  /**
   * The stage the user has already decided, so the card locks until the host
   * moves to the next stage or resolves. The host may repeat
   * `approval/updated` for a decided stage (seen live 2026-09-22), so the
   * update alone cannot unlock it.
   */
  decidedSourceIndex: z.optional(z.number()),
})
export type PendingApproval = z.infer<typeof pendingApprovalSchema>

const pendingQuestionSchema = z.object({
  userInputId: z.string(),
  questions: z.readonly(z.array(questionSchema)),
  /** Answered or cancelled from the card (M25): locked until the host settles it. */
  isSubmitted: z.optional(z.boolean()),
})
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>

export type OutputRef = z.infer<typeof outputRefSchema>
export type PatchSummary = z.infer<typeof patchSummarySchema>

/**
 * An image chip on a user card: what was attached now, or what the durable
 * log echoes for a replayed message (media type and pixel size only, M6).
 */
const userAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.optional(z.number()),
  height: z.optional(z.number()),
})

const userEntrySchema = z.object({
  kind: z.literal('user'),
  id: z.string(),
  /** Where the message falls in the arrival order (M20): the rewind boundary. */
  seq: z.number(),
  text: z.string(),
  status: z.enum(['pending', 'sent', 'failed']),
  reason: z.optional(z.string()),
  attachments: z.readonly(z.array(userAttachmentSchema)),
  /** The open-file chip that went with the message (M5). */
  contextLabel: z.optional(z.string()),
  /** "Replying to: …" / "Asking about: …" as the message was sent (M17). */
  referenceLabel: z.optional(z.string()),
  /** The turn the message started, once known (fork cut points, M6). */
  turnId: z.optional(z.string()),
})

const assistantEntrySchema = z.object({
  kind: z.literal('assistant'),
  id: z.string(),
  text: z.string(),
  isStreaming: z.boolean(),
  /** The web pages the reply cites (M33), listed under it as links. */
  citations: z.optional(z.readonly(z.array(citationSchema))),
})

const reasoningEntrySchema = z.object({
  kind: z.literal('reasoning'),
  id: z.string(),
  /** Summary parts (`summary.N` deltas), or the raw text as one part. */
  parts: z.readonly(z.array(z.string())),
  isStreaming: z.boolean(),
  startedAt: z.number(),
  /** Unknown for a row replayed from history (M25): it reads "Thought". */
  durationMs: z.optional(z.number()),
})

const toolEntrySchema = z.object({
  kind: z.literal('tool'),
  id: z.string(),
  tool: z.string(),
  args: z.string(),
  status: z.string(),
  /** Transcript-visible output (`output` deltas / `visibleOutput`). */
  output: z.string(),
  failureReason: z.optional(z.string()),
  patchSummary: z.optional(patchSummarySchema),
  patchRef: z.optional(outputRefSchema),
  outputRef: z.optional(outputRefSchema),
  /**
   * The arrival-order number the row took when it completed (M20): the
   * order its edit landed on disk, across the conversation and its agents.
   * A subagent's row read back from its session sits just after the agent's
   * own number (M25), since nothing tells when it really landed.
   */
  completedSeq: z.optional(z.number()),
  /** Durably backgrounded (M14): the turn went on without waiting for it. */
  isBackground: z.boolean(),
  backgroundInitiator: z.optional(z.string()),
  /** A call billed on top of tokens (M33, PLAN.md D30): the row says it is paid. */
  paid: z.optional(z.enum(PAID_FEATURES)),
  /** Pictures the tool reported the model saw (`modelVisibleContent`, M43), by path. */
  images: z.optional(z.readonly(z.array(z.string()))),
  approval: z.optional(pendingApprovalSchema),
  approvalOutcome: z.optional(z.object({ decision: z.string(), resolvedBy: z.string() })),
  question: z.optional(pendingQuestionSchema),
  questionOutcome: z.optional(
    z.object({
      outcome: z.string(),
      answers: z.readonly(z.array(answerSchema)),
      /** The explanation given instead of an answer (M46). */
      clarification: z.optional(z.string()),
    }),
  ),
  /**
   * Move to the background or Stop was pressed (M46): the button waits for
   * the host's word, the row's next update or a refusal, as a decided
   * approval card does (M25).
   */
  taskRequest: z.optional(z.enum(TASK_REQUESTS)),
})

/**
 * The user's own shell command, the TUI's `!` (M46, MSP `userShell`,
 * captured live 2026-09-25): outside any turn, its exit code or signal and
 * its run time beside what it printed.
 */
const userShellEntrySchema = z.object({
  kind: z.literal('userShell'),
  id: z.string(),
  command: z.string(),
  status: z.string(),
  output: z.string(),
  exitCode: z.optional(z.number()),
  exitSignal: z.optional(z.number()),
  durationMs: z.optional(z.number()),
  outputRef: z.optional(outputRefSchema),
  failureReason: z.optional(z.string()),
  taskRequest: z.optional(z.enum(TASK_REQUESTS)),
})

const subagentEntrySchema = z.object({
  /** A native subagent the CLI spawned for this turn (M14). */
  kind: z.literal('subagent'),
  id: z.string(),
  /**
   * The arrival number the row took when it first appeared (M25): the
   * anchor for the agent's rows read back from its own session.
   */
  seq: z.number(),
  role: z.optional(z.string()),
  objective: z.optional(z.string()),
  status: z.string(),
  controlStatus: z.optional(z.string()),
  subagentId: z.optional(z.string()),
  childSessionId: z.optional(z.string()),
  usage: z.optional(tokenUsageSchema),
  depth: z.optional(z.number()),
  durationMs: z.optional(z.number()),
  resultSummary: z.optional(z.string()),
  /** The result envelope's full text, when the CLI sent one (M18). */
  resultText: z.optional(z.string()),
})

/**
 * One agent of a workflow run (MSP `WorkflowChild`, captured live
 * 2026-09-25), keyed by `childId`; `attempt` is its current one, the key
 * `workflow/childControl` needs. Muse Code re-sends the whole list on every
 * change but drops a field once it moves on (the label after `scheduled`,
 * the tokens after `usage`), so the row keeps what it was told.
 */
export const workflowChildSchema = z.object({
  childId: z.string(),
  attempt: z.number(),
  status: z.string(),
  label: z.optional(z.string()),
  phase: z.optional(z.string()),
  /** The child's outcome once it ends (`completed`, `failed`, `cancelled`). */
  terminal: z.optional(z.string()),
  durationMs: z.optional(z.number()),
  usage: z.optional(tokenUsageSchema),
})
export type WorkflowChild = z.infer<typeof workflowChildSchema>

const workflowEntrySchema = z.object({
  /** A workflow run Muse Code launched (M47, PLAN.md D40). */
  kind: z.literal('workflow'),
  id: z.string(),
  status: z.string(),
  /** Without its `workflowRunId` the card offers no control. */
  ...workflowRunFields,
  /** The server's one-line summary, the name when the entry is not one the panel reads. */
  fallbackText: z.optional(z.string()),
  children: z.readonly(z.array(workflowChildSchema)),
  /** The reconciled message the run ends with (`workflowOutcome` reads it). */
  message: z.optional(z.string()),
})

const itemEntrySchema = z.object({
  /** Kinds the UI does not know (compaction, …). */
  kind: z.literal('item'),
  id: z.string(),
  itemKind: z.string(),
  status: z.string(),
  text: z.optional(z.string()),
})

const errorEntrySchema = z.object({ kind: z.literal('error'), id: z.string(), text: z.string() })

export type NoticeLevel = (typeof NOTICE_LEVELS)[number]

const noticeEntrySchema = z.object({
  kind: z.literal('notice'),
  id: z.string(),
  level: z.enum(NOTICE_LEVELS),
  text: z.string(),
})

export const transcriptEntrySchema = z.discriminatedUnion('kind', [
  userEntrySchema,
  assistantEntrySchema,
  reasoningEntrySchema,
  toolEntrySchema,
  userShellEntrySchema,
  subagentEntrySchema,
  workflowEntrySchema,
  itemEntrySchema,
  errorEntrySchema,
  noticeEntrySchema,
])
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>

/** A subagent's own transcript, read for the Agent map (M14). */
export const childTranscriptSchema = z.object({
  name: z.optional(z.string()),
  entries: z.readonly(z.array(transcriptEntrySchema)),
})
export type ChildTranscript = z.infer<typeof childTranscriptSchema>

export const usageSummarySchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  // Absent where the backend cannot total it (Muse Code, PLAN.md D26).
  cachedTokens: z.optional(z.number()),
})
export type UsageSummary = z.infer<typeof usageSummarySchema>

export const contextSummarySchema = z.object({
  usedTokens: z.number(),
  windowTokens: z.optional(z.number()),
  pressure: z.string(),
})
export type ContextSummary = z.infer<typeof contextSummarySchema>

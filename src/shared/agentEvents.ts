// Backend-agnostic events a conversation emits. The MSP backend maps Muse
// Session Protocol notifications onto these; the Model API backend (M7) will
// map its own stream onto the same union. The webview renders only these, so
// it never learns which backend is active.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'

/** A stored-output handle (`item/readOutput` fetches the bytes by `id`). */
export const outputRefSchema = z.object({ id: z.string(), byteLen: z.number() })

/** A user message's image, as the durable log echoes it (MSP `MessageAttachment`). */
const messageAttachmentSchema = z.object({
  type: z.string(),
  mediaType: z.string(),
  width: z.optional(z.number()),
  height: z.optional(z.number()),
})

/** Server-authored edit summary: line counts, never hunks or bytes. */
export const patchSummarySchema = z.object({
  files: z.number(),
  added: z.number(),
  removed: z.number(),
})

/**
 * One transcript item at one revision: the common fields plus the per-kind
 * fields the UI renders (MSP `Item`, verified live 2026-09-21 for
 * `agentMessage`, `toolCall`, `userMessage`, `reminderChild`). Exported as a
 * shape so the MSP mapper can widen `turnId` to nullable.
 */
export const itemSnapshotFields = {
  itemId: z.string(),
  kind: z.string(),
  status: z.string(),
  turnId: z.optional(z.string()),
  /** `agentMessage` / `userMessage`: the text; `reasoning`: raw text if exposed. */
  text: z.optional(z.string()),
  /** `reasoning`: summary parts, streamed as `summary.N` deltas. */
  summary: z.optional(z.array(z.string())),
  /** `toolCall`: tool name and the model-authored argument JSON, verbatim. */
  tool: z.optional(z.string()),
  args: z.optional(z.string()),
  /** `toolCall` / `userShell`: transcript-visible result text (streams as `output`). */
  visibleOutput: z.optional(z.string()),
  failureReason: z.optional(z.string()),
  outputRef: z.optional(outputRefSchema),
  patchRef: z.optional(outputRefSchema),
  patchSummary: z.optional(patchSummarySchema),
  /** Server one-liner for kinds the UI does not know. */
  fallbackText: z.optional(z.string()),
  /** `userMessage`: image attachment metadata (no bytes), for replayed history (M6). */
  attachments: z.optional(z.array(messageAttachmentSchema)),
} as const

const itemSnapshotSchema = z.object(itemSnapshotFields)

export type ItemSnapshot = z.infer<typeof itemSnapshotSchema>

export const approvalChoiceSchema = z.object({
  choiceId: z.string(),
  label: z.string(),
  decision: z.string(),
  scope: z.string(),
  acceptsFeedback: z.optional(z.boolean()),
  rulePreview: z.optional(z.string()),
})
export type ApprovalChoice = z.infer<typeof approvalChoiceSchema>

/** Stage token echoed back on `approval/decide`. */
export const requirementRefSchema = z.object({ approvalId: z.string(), sourceIndex: z.number() })
export type RequirementRef = z.infer<typeof requirementRefSchema>

/**
 * One stage of a multi-command shell approval (`a; b` is two stages, each
 * decided in turn; verified live 2026-09-22).
 */
export const approvalStageSchema = z.object({
  requirementId: requirementRefSchema,
  position: z.number(),
  totalStages: z.number(),
  argv: z.array(z.string()),
})
export type ApprovalStage = z.infer<typeof approvalStageSchema>

/** What the approval is about (`ApprovalSubject`, open discriminator). */
export const approvalSubjectSchema = z.object({
  kind: z.string(),
  command: z.optional(z.string()),
  path: z.optional(z.string()),
  host: z.optional(z.string()),
  target: z.optional(z.string()),
  toolName: z.optional(z.string()),
  stages: z.optional(z.array(approvalStageSchema)),
})
export type ApprovalSubject = z.infer<typeof approvalSubjectSchema>

export const questionOptionSchema = z.object({
  label: z.string(),
  description: z.optional(z.string()),
})
export const questionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  selection: z.object({
    mode: z.string(),
    minSelections: z.optional(z.number()),
    maxSelections: z.optional(z.number()),
  }),
  options: z.array(questionOptionSchema),
})
export type Question = z.infer<typeof questionSchema>

export const answerSchema = z.object({
  questionId: z.string(),
  selectedLabel: z.optional(z.string()),
  selectedLabels: z.optional(z.array(z.string())),
  freeText: z.optional(z.string()),
})
export type QuestionAnswer = z.infer<typeof answerSchema>

export const todoItemSchema = z.object({
  text: z.string(),
  status: z.string(),
  activeForm: z.optional(z.string()),
})
export type TodoItem = z.infer<typeof todoItemSchema>

const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turnStarted'), turnId: z.string() }),
  z.object({ type: z.literal('itemStarted'), item: itemSnapshotSchema }),
  z.object({
    type: z.literal('textDelta'),
    itemId: z.string(),
    field: z.string(),
    delta: z.string(),
  }),
  /** A non-terminal change deltas cannot express: the whole item again. */
  z.object({ type: z.literal('itemUpdated'), item: itemSnapshotSchema }),
  z.object({ type: z.literal('itemCompleted'), item: itemSnapshotSchema }),
  z.object({
    type: z.literal('turnCompleted'),
    turnId: z.string(),
    terminal: z.string(),
    reason: z.optional(z.string()),
    errorKind: z.optional(z.string()),
    durationMs: z.optional(z.number()),
  }),
  z.object({
    type: z.literal('turnRetry'),
    turnId: z.string(),
    attempt: z.number(),
    maxAttempts: z.number(),
    retryDelayMs: z.number(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('tokenUsage'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedTokens: z.number(),
    reasoningTokens: z.number(),
    modelId: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('contextUsage'),
    usedTokens: z.number(),
    windowTokens: z.optional(z.number()),
    pressure: z.string(),
  }),
  z.object({ type: z.literal('modelChanged'), modelId: z.string() }),
  z.object({ type: z.literal('sessionStatus'), status: z.string() }),
  z.object({ type: z.literal('sessionNamed'), name: z.string() }),
  // The session's standing reasoning effort changed (wire vocabulary).
  z.object({ type: z.literal('effortChanged'), effort: z.string() }),
  // The session's approval mode changed (wire vocabulary).
  z.object({ type: z.literal('approvalModeChanged'), mode: z.string() }),
  // The session's user-invocable skill set changed; re-list.
  z.object({ type: z.literal('skillsChanged') }),
  // The host is waiting for a decision on a gated tool call.
  z.object({
    type: z.literal('approvalRequested'),
    approvalId: z.string(),
    itemId: z.string(),
    toolName: z.string(),
    rawArgs: z.string(),
    requirementId: requirementRefSchema,
    subject: approvalSubjectSchema,
    availableChoices: z.array(approvalChoiceSchema),
    isJudgeEscalated: z.boolean(),
    isProtectedWrite: z.boolean(),
  }),
  // A stage was decided and the next one is pending: new choices, same card.
  z.object({
    type: z.literal('approvalUpdated'),
    approvalId: z.string(),
    requirementId: requirementRefSchema,
    subject: approvalSubjectSchema,
    availableChoices: z.array(approvalChoiceSchema),
  }),
  z.object({
    type: z.literal('approvalResolved'),
    approvalId: z.string(),
    itemId: z.string(),
    decision: z.string(),
    resolvedBy: z.string(),
  }),
  // The agent asked the user something (`request_user_input`).
  z.object({
    type: z.literal('questionRequested'),
    userInputId: z.string(),
    itemId: z.string(),
    questions: z.array(questionSchema),
  }),
  z.object({
    type: z.literal('questionSettled'),
    userInputId: z.string(),
    outcome: z.string(),
    answers: z.array(answerSchema),
  }),
  // The full todo list, replaced wholesale.
  z.object({ type: z.literal('todoChanged'), items: z.array(todoItemSchema) }),
])

export type AgentEvent = z.infer<typeof agentEventSchema>

export { agentEventSchema, itemSnapshotSchema }

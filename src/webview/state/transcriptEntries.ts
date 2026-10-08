import { legacyUsdSchema } from '../../shared/usd'
// The transcript rows the webview keeps, as zod schemas with the types
// inferred from them (M25, PLAN.md D28). The schemas exist because the rows
// outlive the document: the panel saves its conversation in VS Code's webview
// state, and what comes back after a reload (or from an older build of the
// extension) is validated like any other boundary input before the reducer
// touches it. Deriving the types from the schemas means a field added to a
// row cannot be forgotten by the validation. Arrays are read-only, as the
// reducer treats them.

import * as z from 'zod/mini'
import { agentEvidenceSchema, agentFileSchema } from '../../shared/agentOutcome'
import {
  approvalChoiceSchema,
  approvalSubjectSchema,
  answerSchema,
  citationSchema,
  elicitationFieldSchema,
  outputRefSchema,
  patchSummarySchema,
  questionSchema,
  requirementRefSchema,
  thenRunResultSchema,
  tokenUsageSchema,
  toolArgumentPreviewSchema,
  verifySummarySchema,
  workflowRunFields,
} from '../../shared/agentEvents'
import { QUESTION_STATES } from '../../shared/questions'
import { PAID_FEATURES, TASK_REQUESTS } from '../../shared/constants'
import { NOTICE_ACTIONS, NOTICE_LEVELS, reportEventRefSchema } from '../../shared/protocol'
import {
  teamMergeFields,
  teamPlanFields,
  teamReportFields,
  teamSwitchFields,
  teamWaitingFields,
  teamWorkerLabelSchema,
} from '../../shared/teamView'

const pendingApprovalSchema = z.object({
  approvalId: z.string(),
  requirementId: requirementRefSchema,
  subject: approvalSubjectSchema,
  rawArgs: z.string(),
  availableChoices: z.readonly(z.array(approvalChoiceSchema)),
  isProtectedWrite: z.boolean(),
  isJudgeEscalated: z.boolean(),
  judgeCaution: z.optional(z.boolean()),
  /** Why the card asks beyond the mode (M78), as the host said it. */
  note: z.optional(z.string()),
  /**
   * The stage the user has already decided, so the card locks until the host
   * moves to the next stage or resolves. The host may repeat
   * `approval/updated` for a decided stage (seen live 2026-09-22), so the
   * update alone cannot unlock it.
   */
  decidedSourceIndex: z.optional(z.number()),
  /**
   * A decision was refused as stale (D26): the card says, on itself, that
   * the request moved to the step it now shows, until the user chooses there.
   */
  hasMovedOn: z.optional(z.boolean()),
})
export type PendingApproval = z.infer<typeof pendingApprovalSchema>

const pendingQuestionSchema = z.object({
  userInputId: z.string(),
  questions: z.readonly(z.array(questionSchema)),
  state: z.optional(z.enum(QUESTION_STATES)),
  askedAt: z.optional(z.number()),
  deadlineAt: z.optional(z.number()),
  reminders: z.optional(z.number()),
  /** Answered or cancelled from the card (M25): locked until the host settles it. */
  isSubmitted: z.optional(z.boolean()),
  /** Local availability only: an authoritative snapshot retired this active card. */
  isNoLongerOpen: z.optional(z.boolean()),
})
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>

/**
 * An MCP elicitation form waiting on the user (M91 lane M): the server's
 * message and the schema to fill. Values live only in the card's draft
 * while it is open: settling clears the form, so nothing typed survives in
 * the saved transcript.
 */
const pendingElicitationSchema = z.object({
  elicitationId: z.string(),
  server: z.string(),
  message: z.string(),
  fields: z.readonly(z.array(elicitationFieldSchema)),
  /** Answered, declined or cancelled from the form: locked until the host settles it. */
  isSubmitted: z.optional(z.boolean()),
})
export type PendingElicitation = z.infer<typeof pendingElicitationSchema>

export type OutputRef = z.infer<typeof outputRefSchema>
export type PatchSummary = z.infer<typeof patchSummarySchema>

/**
 * An image chip on a user card: what was attached now, or what the durable
 * log echoes for a replayed message (media type and pixel size only, M6).
 */
const userAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType: z.optional(z.string()),
  width: z.optional(z.number()),
  height: z.optional(z.number()),
})

// `turnAccepted.disposition` (M87, PLAN.md D66): the backend's words for a
// message the model does not have yet.
export const QUEUED_DISPOSITION = 'queued'
export const STEERED_DISPOSITION = 'steered'

// A backend's recorded time (M87): RFC 3339, as Muse Code sends `recordedAt`
// (M46, M79) and the Model API host stamps it.
const recordedAtSchema = z.iso.datetime({ offset: true })

/**
 * A recorded time as epoch milliseconds (M87, PLAN.md D66), or undefined for
 * none or one that does not parse: an invalid value costs the time, never the
 * row, and no other time stands in for it.
 */
export function recordedAtMs(recordedAt: string | undefined): number | undefined {
  if (recordedAt === undefined || !recordedAtSchema.safeParse(recordedAt).success) {
    return undefined
  }
  const epochMs = Date.parse(recordedAt)
  return Number.isFinite(epochMs) ? epochMs : undefined
}

/** Whether a card's chips include an image (M87): what a withdrawn message may not get back. */
export function hasImageAttachment(
  attachments: readonly z.infer<typeof userAttachmentSchema>[],
): boolean {
  return attachments.some((attachment) =>
    attachment.mediaType === undefined
      ? attachment.width !== undefined || attachment.height !== undefined
      : attachment.mediaType.startsWith('image/'),
  )
}

export function hasFileAttachment(
  attachments: readonly z.infer<typeof userAttachmentSchema>[],
): boolean {
  return attachments.some((attachment) =>
    attachment.mediaType === undefined
      ? attachment.width === undefined && attachment.height === undefined
      : !attachment.mediaType.startsWith('image/'),
  )
}

const userEntrySchema = z.object({
  kind: z.literal('user'),
  id: z.string(),
  /** Where the message falls in the arrival order (M20): the rewind boundary. */
  seq: z.number(),
  text: z.string(),
  /**
   * `queued` (M87, PLAN.md D66): accepted, but the model does not have it
   * yet; it lasts until the message reaches a request or its turn starts.
   */
  status: z.enum(['pending', 'queued', 'sent', 'failed']),
  reason: z.optional(z.string()),
  /** What the backend did with it (`turnAccepted.disposition`): `queued` or `steered` matter here. */
  disposition: z.optional(z.string()),
  /**
   * When it was sent (M87): the backend's recorded time (`recordedAt`), or
   * the moment the host accepted it until that time arrives. Absent where
   * nothing recorded one (a Model API session stored before M87).
   */
  atMs: z.optional(z.number()),
  attachments: z.readonly(z.array(userAttachmentSchema)),
  /** The open-file chip that went with the message (M5). */
  contextLabel: z.optional(z.string()),
  /** "Replying to: …" / "Asking about: …" as the message was sent (M17). */
  referenceLabel: z.optional(z.string()),
  /** The turn the message started, once known (fork cut points, M6). */
  turnId: z.optional(z.string()),
  /** The Model API replay item's ID; live cards keep their local `id` for UI updates. */
  replayItemId: z.optional(z.string()),
  /**
   * The Muse Code user item whose recorded time this live card took (M87),
   * matched by turn and text: that item no longer stamps another card.
   */
  recordedItemId: z.optional(z.string()),
  /** Sent from this panel in Plan mode (M79): the reply it gets may be a plan. */
  isPlanTurn: z.optional(z.boolean()),
})

const assistantEntrySchema = z.object({
  kind: z.literal('assistant'),
  id: z.string(),
  text: z.string(),
  displayText: z.optional(z.string()),
  isStreaming: z.boolean(),
  /** The web pages the reply cites (M33), listed under it as links. */
  citations: z.optional(z.readonly(z.array(citationSchema))),
  /** The response's tokens and dollar estimate (M82, Model API only). */
  usage: z.optional(tokenUsageSchema),
  costUsd: z.optional(legacyUsdSchema),
  /**
   * When it was received (M87): the backend's recorded time, or the moment
   * it began arriving until that time comes with its completion.
   */
  atMs: z.optional(z.number()),
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
  exitCode: z.optional(z.number()),
  durationMs: z.optional(z.number()),
  changedFiles: z.optional(z.array(agentFileSchema)),
  kind: z.literal('tool'),
  id: z.string(),
  tool: z.string(),
  args: z.string(),
  argumentPreview: z.optional(toolArgumentPreviewSchema),
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
  /**
   * A worker's own card, routed to the main panel (M96 lane U2): the role,
   * the agent and the task, drawn by the panel's chrome, never by the
   * worker (D75, threat T8).
   */
  teamWorker: z.optional(teamWorkerLabelSchema),
  /** Pictures the tool reported the model saw (`modelVisibleContent`, M43), by path. */
  images: z.optional(z.readonly(z.array(z.string()))),
  /** The verify loop's row (M68): the files, their errors and warnings, each check. */
  verifySummary: z.optional(verifySummarySchema),
  /** An edit's `then_run` (M68): the second result of the call. */
  thenRun: z.optional(thenRunResultSchema),
  approval: z.optional(pendingApprovalSchema),
  approvalOutcome: z.optional(
    z.object({
      decision: z.string(),
      resolvedBy: z.string(),
      /** Why the Auto reviewer on Muse Code allowed it (M90). */
      reason: z.optional(z.string()),
    }),
  ),
  question: z.optional(pendingQuestionSchema),
  elicitation: z.optional(pendingElicitationSchema),
  elicitationOutcome: z.optional(
    z.object({ server: z.string(), action: z.enum(['accept', 'decline', 'cancel']) }),
  ),
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
  agentEvidence: z.optional(agentEvidenceSchema),
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
  /** Model API children consume paid requests; retained across panel snapshots. */
  paid: z.optional(z.enum(PAID_FEATURES)),
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
 * 2026-09-25), keyed by `childId`; `attempt` is the number it reports.
 * Captured revisions carried a `children` list but omitted some fields as
 * a child moved on (the label after `scheduled`, tokens after `usage`).
 * The row keeps previously reported fields within that attempt.
 */
export const workflowChildSchema = z.object({
  agentEvidence: z.optional(agentEvidenceSchema),
  childId: z.string(),
  attempt: z.number(),
  status: z.string(),
  label: z.optional(z.string()),
  /** The child's reported terminal outcome; the capture observed `completed`. */
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
  /** The opaque run identity when Muse Code reports one. */
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

/**
 * The team's transcript cards (M96 lane U2, PLAN.md D75): the delegation
 * card and plan, the switch row, the "waiting for you" card, the merge
 * card and each task's report row. Lanes T/A/W create these from the
 * orchestrator's tools; the webview renders them from these fields.
 */
const teamPlanEntrySchema = z.object({
  kind: z.literal('teamPlan'),
  id: z.string(),
  status: z.string(),
  ...teamPlanFields,
})

const teamSwitchEntrySchema = z.object({
  kind: z.literal('teamSwitch'),
  id: z.string(),
  status: z.string(),
  ...teamSwitchFields,
})

const teamWaitingEntrySchema = z.object({
  kind: z.literal('teamWaiting'),
  id: z.string(),
  status: z.string(),
  ...teamWaitingFields,
  teamDecision: z.optional(z.string()),
})

const teamMergeEntrySchema = z.object({
  kind: z.literal('teamMerge'),
  id: z.string(),
  status: z.string(),
  ...teamMergeFields,
  teamDecision: z.optional(z.string()),
})

const teamReportEntrySchema = z.object({
  kind: z.literal('teamReport'),
  id: z.string(),
  status: z.string(),
  ...teamReportFields,
})

const errorEntrySchema = z.object({
  kind: z.literal('error'),
  id: z.string(),
  text: z.string(),
  /**
   * The sanitized handoff when the host recorded this failure (M93 lane W):
   * which journal event the row means, never its text. The row offers
   * "Report this" only while it is present.
   */
  reportRef: z.optional(reportEventRefSchema),
  errorKind: z.optional(z.string()),
})

export type NoticeLevel = (typeof NOTICE_LEVELS)[number]

const noticeEntrySchema = z.object({
  kind: z.literal('notice'),
  id: z.string(),
  level: z.enum(NOTICE_LEVELS),
  text: z.string(),
  /** A file restore's Redo (M72): pressed and awaiting the host, or spent. */
  redoRestoreId: z.optional(z.string()),
  isRedoPending: z.optional(z.boolean()),
  isRedoUsed: z.optional(z.boolean()),
  /** A Muse Code fault's way on (D26): its buttons. */
  actions: z.optional(z.readonly(z.array(z.enum(NOTICE_ACTIONS)))),
  /**
   * The sanitized handoff when the host recorded this failure (M93 lane W):
   * which journal event the row means, never its text. The row offers
   * "Report this" only while it is present.
   */
  reportRef: z.optional(reportEventRefSchema),
  /**
   * How many times the same notice was said (D26), set from the second: the
   * repeats are this one row. Optional, so a snapshot saved before it reads.
   */
  repeatCount: z.optional(z.number()),
})

export const transcriptEntrySchema = z.discriminatedUnion('kind', [
  userEntrySchema,
  assistantEntrySchema,
  reasoningEntrySchema,
  toolEntrySchema,
  userShellEntrySchema,
  subagentEntrySchema,
  workflowEntrySchema,
  teamPlanEntrySchema,
  teamSwitchEntrySchema,
  teamWaitingEntrySchema,
  teamMergeEntrySchema,
  teamReportEntrySchema,
  itemEntrySchema,
  errorEntrySchema,
  noticeEntrySchema,
])
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>

// M118: adding a union member never admits it to conversation-only sharing.
const CONVERSATION_SHARE_ENTRY_KINDS: ReadonlySet<string> = new Set(['user', 'assistant'])
export function isConversationShareEntry(entry: { readonly kind: string }): boolean {
  return CONVERSATION_SHARE_ENTRY_KINDS.has(entry.kind)
}

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
  // The packing ledger's estimate (M73): absent unless packing runs.
  packedTokensAvoided: z.optional(z.number()),
  hookTokensAdded: z.optional(z.number()),
})
export type UsageSummary = z.infer<typeof usageSummarySchema>

export const contextSummarySchema = z.object({
  usedTokens: z.number(),
  windowTokens: z.optional(z.number()),
  pressure: z.string(),
})
export type ContextSummary = z.infer<typeof contextSummarySchema>

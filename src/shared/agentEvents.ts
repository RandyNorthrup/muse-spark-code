// Backend-agnostic events a conversation emits. The MSP backend maps Muse
// Session Protocol notifications onto these; the Model API backend (M7) will
// map its own stream onto the same union. The webview renders only these, so
// it never learns which backend is active.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'
import { scheduleViewSchema } from './schedule'
import { teamItemFields } from './teamView'
import { CHECK_OUTCOMES, CHECK_SKIPS, PAID_FEATURES, PERMISSION_MODES } from './constants'

const stringSchema = z.string()
const numberSchema = z.number()
const booleanSchema = z.boolean()

const optionalString = z.optional(stringSchema)
const optionalNumber = z.optional(numberSchema)
const optionalBoolean = z.optional(booleanSchema)

/**
 * One check command as a row reports it (M68): its name, how it ended, why
 * it did not run, and that reason's detail (the user's feedback on Reject,
 * or a hook's words).
 */
export const checkSummarySchema = z.object({
  name: stringSchema,
  outcome: z.enum(CHECK_OUTCOMES),
  skip: z.optional(z.enum(CHECK_SKIPS)),
  detail: optionalString,
})
export type CheckSummary = z.infer<typeof checkSummarySchema>

/**
 * The verify loop's row (M68, PLAN.md D49): the files it checked, the errors
 * and warnings of those it read (absent when the diagnostics are off or
 * could not be read), how many files it could not read, and each check.
 */
export const verifySummarySchema = z.object({
  files: z.array(stringSchema),
  errors: optionalNumber,
  warnings: optionalNumber,
  unchecked: optionalNumber,
  checks: z.array(checkSummarySchema),
})
export type VerifySummary = z.infer<typeof verifySummarySchema>

/** An edit's `then_run` (M68): the second result of the same call. */
export const thenRunResultSchema = z.object({
  command: stringSchema,
  outcome: z.enum(CHECK_OUTCOMES),
  skip: z.optional(z.enum(CHECK_SKIPS)),
  detail: optionalString,
  output: stringSchema,
  exitCode: optionalNumber,
})
export type ThenRunResult = z.infer<typeof thenRunResultSchema>

/** A source a reply cites: the page's URL and, when Meta sent one, its title (M33). */
export const citationSchema = z.object({ url: stringSchema, title: optionalString })
export type CitationSummary = z.infer<typeof citationSchema>

/** A stored-output handle (`item/readOutput` fetches the bytes by `id`). */
export const outputRefSchema = z.object({ id: stringSchema, byteLen: numberSchema })

/**
 * A user message's image, as the durable log echoes it (MSP
 * `MessageAttachment`, whose vocabulary "grows additively"), or a PDF the
 * Model API backend sent (M54, `type: "file"`): its name, size and pages.
 */
const messageAttachmentSchema = z.object({
  type: stringSchema,
  mediaType: stringSchema,
  width: optionalNumber,
  height: optionalNumber,
  name: optionalString,
  sizeBytes: optionalNumber,
  pageCount: optionalNumber,
})

/** Server-authored edit summary: line counts, never hunks or bytes. */
export const patchSummarySchema = z.object({
  files: numberSchema,
  added: numberSchema,
  removed: numberSchema,
})
export type PatchSummary = z.infer<typeof patchSummarySchema>

/**
 * One transcript item at one revision: the common fields plus the per-kind
 * fields the UI renders (MSP `Item`, verified live 2026-09-21 for
 * `agentMessage`, `toolCall`, `userMessage`, `reminderChild`). Exported as a
 * shape so the MSP mapper can widen `turnId` to nullable.
 */
/** Provider-reported tokens (`session/tokenUsage`, a subagent's transitive usage). */
export const tokenUsageSchema = z.object({
  inputTokens: numberSchema,
  outputTokens: numberSchema,
  cachedTokens: numberSchema,
  reasoningTokens: numberSchema,
})
export type TokenUsage = z.infer<typeof tokenUsageSchema>

/** A subagent's result envelope, the parts the map shows. */
const subagentResultSchema = z.object({
  summary: stringSchema,
  text: optionalString,
  errorKind: optionalString,
})

/**
 * A workflow run as its item names it (M47): the handle its controls send,
 * the entry and script it launched, and what started it. The wire item and
 * the transcript's saved row share these.
 */
export const workflowRunFields = {
  workflowRunId: optionalString,
  entryId: optionalString,
  scriptId: optionalString,
  triggerSource: optionalString,
} as const

export const itemSnapshotFields = {
  itemId: stringSchema,
  kind: stringSchema,
  status: stringSchema,
  turnId: optionalString,
  /** `agentMessage` / `userMessage`: the text; `reasoning`: raw text if exposed. */
  text: optionalString,
  displayText: optionalString,
  /** `reasoning`: summary parts, streamed as `summary.N` deltas. */
  summary: z.optional(z.array(stringSchema)),
  /** `toolCall`: tool name and the model-authored argument JSON, verbatim. */
  tool: optionalString,
  args: optionalString,
  /** `toolCall` / `userShell`: transcript-visible result text (streams as `output`). */
  visibleOutput: optionalString,
  failureReason: optionalString,
  outputRef: z.optional(outputRefSchema),
  patchRef: z.optional(outputRefSchema),
  patchSummary: z.optional(patchSummarySchema),
  /** Server one-liner for kinds the UI does not know. */
  fallbackText: optionalString,
  /** `userMessage`: image attachment metadata (no bytes), for replayed history (M6). */
  attachments: z.optional(z.array(messageAttachmentSchema)),
  /** `subagent`: the child as spawned, its control state and transitive usage (M14). */
  role: optionalString,
  objective: optionalString,
  subagentId: optionalString,
  childSessionId: optionalString,
  depth: optionalNumber,
  durationMs: optionalNumber,
  controlStatus: optionalString,
  /**
   * `agentMessage`: the response's tokens (M82, Model API only, and only
   * while its setting is on; Muse Code reports no per-reply totals on its
   * protocol, PLAN.md D26).
   */
  usage: z.optional(tokenUsageSchema),
  result: z.optional(subagentResultSchema),
  /** `toolCall`: durably backgrounded, and by whom (M14). */
  background: optionalBoolean,
  backgroundInitiator: optionalString,
  /**
   * `userShell` (M46, captured live 2026-09-25): the command as the user
   * typed it, and how it ended, an exit code or a signal number (MSP
   * `exitSignal`, verbatim). `durationMs` above is its run time.
   */
  commandText: optionalString,
  exitCode: optionalNumber,
  exitSignal: optionalNumber,
  /** `toolCall`: a call billed on top of tokens (M33, PLAN.md D30), marked paid in its row. */
  paid: z.optional(z.enum(PAID_FEATURES)),
  /**
   * `toolCall`: what the model saw beyond text (MSP 1.3.0 `ModelVisibleContent`,
   * metadata only). Muse Code did not send it on the live stream (captured
   * 2026-09-25), so it is taken as it comes and read element by element
   * (`reportedImages`): a shape that differs costs the picture, never the
   * item (the review of PR #29).
   */
  modelVisibleContent: z.optional(z.array(z.unknown())),
  /** `agentMessage`: the sources the reply cites (`url_citation`, M33), each once. */
  citations: z.optional(z.array(citationSchema)),
  /**
   * `agentMessage`: the response's dollar estimate (M82, Model API only,
   * and only while its setting is on). Muse Code reports no per-reply
   * totals on its protocol, and its cost is never invented (PLAN.md D26).
   */
  costUsd: optionalNumber,
  /**
   * `workflow` (M47, captured live 2026-09-25): the run as above, and the
   * reconciled message it ends with. Its `children` are taken as they come
   * and read one by one (`reportedChildren`), so a child whose shape
   * differs costs that child, never the run.
   */
  ...workflowRunFields,
  children: z.optional(z.array(z.unknown())),
  message: optionalString,
  /** `toolCall` of the verify loop (M68): its files, counts and checks. */
  verifySummary: z.optional(verifySummarySchema),
  /** `toolCall` of an edit with `then_run` (M68): the command's result beside the edit's. */
  thenRun: z.optional(thenRunResultSchema),
  /**
   * The team's cards (M96 lane U2): the delegation plan, a switch, the
   * waiting card, the merge card, a report row, and the worker label on a
   * worker's own card. Lanes T/A/W fill these; the webview only renders.
   */
  ...teamItemFields,
  /**
   * When the item was recorded (M87, PLAN.md D66), an RFC 3339 string: MSP
   * `Item.recordedAt` as captured on `userMessage`, `agentMessage` and
   * `userShell` items (M46, M79), or the Model API host's own stamp. Kept as
   * the string it came as: a time that does not parse costs the time where
   * it is read, never the item.
   */
  recordedAt: z.optional(z.string()),
} as const

const itemSnapshotSchema = z.object(itemSnapshotFields)

export type ItemSnapshot = z.infer<typeof itemSnapshotSchema>

// M118: default deny, including future wire kinds and internal items.
const CONVERSATION_SHARE_ITEM_KINDS: ReadonlySet<string> = new Set(['userMessage', 'agentMessage'])
export function isConversationShareItem(item: Pick<ItemSnapshot, 'kind'>): boolean {
  return CONVERSATION_SHARE_ITEM_KINDS.has(item.kind)
}

export const approvalChoiceSchema = z.object({
  choiceId: stringSchema,
  label: stringSchema,
  decision: stringSchema,
  scope: stringSchema,
  acceptsFeedback: optionalBoolean,
  rulePreview: optionalString,
})
export type ApprovalChoice = z.infer<typeof approvalChoiceSchema>

/** Stage token echoed back on `approval/decide`. */
export const requirementRefSchema = z.object({
  approvalId: stringSchema,
  sourceIndex: numberSchema,
})
export type RequirementRef = z.infer<typeof requirementRefSchema>

/**
 * One stage of a multi-command shell approval (`a; b` is two stages, each
 * decided in turn; verified live 2026-09-22).
 */
export const approvalStageSchema = z.object({
  requirementId: requirementRefSchema,
  position: numberSchema,
  totalStages: numberSchema,
  argv: z.array(stringSchema),
  /**
   * The rule "Always allow in this workspace" would add for this stage; its
   * `label` is the label and preview Muse Code gives that choice while this
   * stage is current (captured 2026-10-02, Muse Code 1.4.0 and 1.4.2).
   */
  suggestedPrefix: z.optional(z.object({ argvPrefix: z.array(stringSchema), label: stringSchema })),
})
export type ApprovalStage = z.infer<typeof approvalStageSchema>

/** What the approval is about (`ApprovalSubject`, open discriminator). */
export const approvalSubjectSchema = z.object({
  kind: stringSchema,
  command: optionalString,
  path: optionalString,
  /** `fileAccess` subjects: what access is asked for (`read` / `write`). */
  access: optionalString,
  host: optionalString,
  target: optionalString,
  toolName: optionalString,
  stages: z.optional(z.array(approvalStageSchema)),
})
export type ApprovalSubject = z.infer<typeof approvalSubjectSchema>

export const questionOptionSchema = z.object({
  label: stringSchema,
  description: optionalString,
})
export const questionSchema = z.object({
  id: stringSchema,
  header: stringSchema,
  question: stringSchema,
  selection: z.object({
    mode: stringSchema,
    minSelections: optionalNumber,
    maxSelections: optionalNumber,
  }),
  options: z.array(questionOptionSchema),
})
export type Question = z.infer<typeof questionSchema>

export const answerSchema = z.object({
  questionId: stringSchema,
  selectedLabel: optionalString,
  selectedLabels: z.optional(z.array(stringSchema)),
  freeText: optionalString,
})
export type QuestionAnswer = z.infer<typeof answerSchema>

/** One field of an MCP elicitation form (M91 lane M): the schema, never values. */
export const elicitationFieldSchema = z.object({
  name: z.string(),
  title: z.optional(z.string()),
  description: z.optional(z.string()),
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  required: z.boolean(),
  enum: z.optional(z.array(z.string())),
  enumNames: z.optional(z.array(z.string())),
  format: z.optional(z.enum(['email', 'uri', 'date', 'date-time'])),
  default: z.optional(z.union([z.string(), z.number(), z.boolean()])),
  minLength: z.optional(z.number()),
  maxLength: z.optional(z.number()),
  minimum: z.optional(z.number()),
  maximum: z.optional(z.number()),
})
export type ElicitationField = z.infer<typeof elicitationFieldSchema>

/** How an elicitation form settles (M91 lane M): accept, decline or cancel. */
export const elicitationReplySchema = z.union([
  z.object({
    kind: z.literal('accepted'),
    values: z.record(z.string(), z.unknown()),
  }),
  z.object({ kind: z.literal('declined') }),
  z.object({ kind: z.literal('cancelled') }),
])
export type ElicitationReply = z.infer<typeof elicitationReplySchema>

export const todoItemSchema = z.object({
  text: stringSchema,
  status: stringSchema,
  activeForm: optionalString,
})
export type TodoItem = z.infer<typeof todoItemSchema>

/**
 * The session goal (M45, PLAN.md D38): MSP 1.3.0's `Goal` block, as
 * `session/goalChanged` and a resumed snapshot carry it (captured live
 * 2026-09-25). `status` and `percentComplete` are verbatim: a status Muse
 * Code adds later is shown as it came, and the bar clamps the percentage.
 * The Model API backend's goal takes the same shape.
 */
export const sessionGoalSchema = z.object({
  objective: stringSchema,
  status: stringSchema,
  percentComplete: numberSchema,
  currentWork: optionalString,
  nextWork: optionalString,
})
export type SessionGoal = z.infer<typeof sessionGoalSchema>

const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turnStarted'), turnId: stringSchema }),
  /** An accepted steer needed its own later turn after the previous one ended. */
  z.object({
    type: z.literal('userMessageTurnChanged'),
    userMessageId: stringSchema,
    turnId: stringSchema,
  }),
  z.object({ type: z.literal('itemStarted'), item: itemSnapshotSchema }),
  z.object({
    type: z.literal('textDelta'),
    itemId: stringSchema,
    field: stringSchema,
    delta: stringSchema,
  }),
  /** A non-terminal change deltas cannot express: the whole item again. */
  z.object({ type: z.literal('itemUpdated'), item: itemSnapshotSchema }),
  z.object({ type: z.literal('itemCompleted'), item: itemSnapshotSchema }),
  z.object({
    type: z.literal('turnCompleted'),
    turnId: stringSchema,
    terminal: stringSchema,
    reason: optionalString,
    errorKind: optionalString,
    durationMs: optionalNumber,
  }),
  z.object({
    type: z.literal('turnRetry'),
    turnId: stringSchema,
    attempt: numberSchema,
    maxAttempts: numberSchema,
    retryDelayMs: numberSchema,
    reason: stringSchema,
  }),
  // The session's totals on both backends (PLAN.md D26): prompt tokens counted
  // once and output tokens. Cached and reasoning totals only where the
  // backend can sum them honestly (the Model API: one provider's convention).
  // `packedTokensAvoided` is the extension's own estimate (M73): the tokens
  // observation packing left out of the requests, defined only while it runs.
  z.object({
    type: z.literal('tokenUsage'),
    inputTokens: numberSchema,
    outputTokens: numberSchema,
    cachedTokens: optionalNumber,
    reasoningTokens: optionalNumber,
    modelId: optionalString,
    packedTokensAvoided: optionalNumber,
    hookTokensAdded: z.optional(z.int().check(z.nonnegative())),
  }),
  z.object({
    type: z.literal('contextUsage'),
    usedTokens: numberSchema,
    windowTokens: optionalNumber,
    pressure: stringSchema,
  }),
  z.object({ type: z.literal('modelChanged'), modelId: stringSchema }),
  z.object({ type: z.literal('sessionStatus'), status: stringSchema }),
  z.object({ type: z.literal('sessionNamed'), name: stringSchema }),
  // The session's standing reasoning effort changed (wire vocabulary).
  z.object({ type: z.literal('effortChanged'), effort: stringSchema }),
  // The session's approval mode changed (wire vocabulary).
  z.object({ type: z.literal('approvalModeChanged'), mode: stringSchema }),
  // The session's user-invocable skill set changed; re-list.
  z.object({ type: z.literal('skillsChanged') }),
  /** Extension-owned Model API schedules, never Muse Code's native cron jobs (M52). */
  z.object({ type: z.literal('schedulesChanged'), jobs: z.array(scheduleViewSchema) }),
  // The host is waiting for a decision on a gated tool call.
  z.object({
    type: z.literal('approvalRequested'),
    approvalId: stringSchema,
    itemId: stringSchema,
    toolName: stringSchema,
    rawArgs: stringSchema,
    /** Extension-owned advisory, never a Muse Code wire field. */
    judgeCaution: z.optional(booleanSchema),
    requirementId: requirementRefSchema,
    subject: approvalSubjectSchema,
    availableChoices: z.array(approvalChoiceSchema),
    isJudgeEscalated: booleanSchema,
    isProtectedWrite: booleanSchema,
    /**
     * Why the card asks beyond the mode (M78): the user's ask rule, the
     * permission profile, or the Auto reviewer's reason. The extension's
     * own; Muse Code sends none.
     */
    note: optionalString,
    /**
     * A custom child's own `permission-mode`: the client answers it under
     * the less automatic of this and its own mode (childPermissionMode).
     */
    permissionMode: z.optional(z.enum(PERMISSION_MODES)),
    /** A pending card shown to a later surface; joining never approves it automatically. */
    isReplayed: optionalBoolean,
    /**
     * The turn that asked (Muse Code's `turnId`, captured 2026-10-02): the
     * Auto reviewer answers only the running parent turn's (M90).
     */
    turnId: optionalString,
  }),
  // Extension-owned note only: cannot change a choice or settle an approval.
  z.object({
    type: z.literal('approvalCaution'),
    approvalId: z.string(),
    requirementId: requirementRefSchema,
  }),
  // A stage was decided and the next one is pending: new choices, same card.
  z.object({
    type: z.literal('approvalUpdated'),
    approvalId: stringSchema,
    requirementId: requirementRefSchema,
    subject: approvalSubjectSchema,
    availableChoices: z.array(approvalChoiceSchema),
    /**
     * Why the card asks beyond the mode. The CLI sends none; the controller
     * sets the secret note here too when it scrubs one in (M92e).
     */
    note: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('approvalResolved'),
    approvalId: stringSchema,
    itemId: stringSchema,
    decision: stringSchema,
    resolvedBy: stringSchema,
    /** Why the one who answered allowed it (the Auto reviewer on Muse Code, M90); the extension's own. */
    reason: optionalString,
  }),
  // The agent asked the user something (`request_user_input`).
  z.object({
    type: z.literal('questionRequested'),
    userInputId: stringSchema,
    itemId: stringSchema,
    questions: z.array(questionSchema),
    /** A pending question shown to a later surface (M82): it raises no new notice. */
    isReplayed: optionalBoolean,
  }),
  z.object({
    type: z.literal('questionSettled'),
    userInputId: stringSchema,
    outcome: stringSchema,
    answers: z.array(answerSchema),
    /** The explanation given instead of an answer (`clarified`, M46). */
    clarification: optionalString,
  }),
  // An MCP server asked the user for structured input (`elicitation/create`,
  // M91 lane M): the panel shows a form, the ACP agent its form path. The
  // request carries the schema, never values; the settlement carries the
  // action only, so values reach no transcript or export.
  z.object({
    type: z.literal('elicitationRequested'),
    elicitationId: z.string(),
    server: z.string(),
    message: z.string(),
    fields: z.array(elicitationFieldSchema),
    /** The tool row the form belongs under; absent, it stands on its own. */
    itemId: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('elicitationSettled'),
    elicitationId: z.string(),
    action: z.enum(['accept', 'decline', 'cancel']),
    /** Why a hook declined or cancelled it. */
    reason: z.optional(z.string()),
  }),
  // The full todo list, replaced wholesale.
  z.object({ type: z.literal('todoChanged'), items: z.array(todoItemSchema) }),
  // The session goal, replaced wholesale; `null` when it was cleared (M45).
  z.object({ type: z.literal('goalChanged'), goal: z.nullable(sessionGoalSchema) }),
  // A queued message that will never run (D26): the host withdrew it
  // (`turn/unqueued`) or Stop cleared the queue. Only its message is marked;
  // the running turn, if any, runs on.
  z.object({ type: z.literal('turnWithdrawn'), turnId: stringSchema, reason: stringSchema }),
  // A queued or steered message reached a request (M87, PLAN.md D66): from
  // now on the model has it, so it can no longer be withdrawn. Named by the
  // user item id its acceptance gave (`turnAccepted.userMessageId`).
  z.object({ type: z.literal('messageAdmitted'), userMessageId: z.string().check(z.minLength(1)) }),
  // The two below are the controller's, never forwarded (PLAN.md D26): live
  // delivery dropped events, so the transcript is reloaded from the host...
  z.object({ type: z.literal('viewGap') }),
  // ...and a fact the user is told as a notice (a model the account cannot serve).
  z.object({
    type: z.literal('backendNotice'),
    level: z.enum(['info', 'warning', 'error']),
    text: stringSchema,
  }),
])

export type AgentEvent = z.infer<typeof agentEventSchema>

export { agentEventSchema, itemSnapshotSchema }

/** Known child sessions prefix their forwarded turn ids (M48). */
export function isChildTurn(turnId: string, childSessionIds: ReadonlySet<string>): boolean {
  for (const childSessionId of childSessionIds) {
    if (turnId === childSessionId || turnId.startsWith(`${childSessionId}:`)) return true
  }
  return false
}

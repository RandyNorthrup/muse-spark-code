import { redactDiagnosticEvent } from '../../redact'
// Maps Muse Session Protocol notifications onto backend-agnostic AgentEvents.
// Pure and total: an unknown method is `UNKNOWN_METHOD` and params that fail
// their schema are `MALFORMED_PARAMS`, and the caller decides how loudly to
// log either. Only the fields the UI consumes are validated; the wire carries
// far more (see the SDK's msp.d.ts). Shapes were verified against live
// captures on 2026-09-21/22 (docs/certification/m4.md).

import * as z from 'zod/mini'
import {
  type AgentEvent,
  answerSchema,
  approvalChoiceSchema,
  approvalSubjectSchema,
  questionSchema,
  requirementRefSchema,
  todoItemSchema,
} from '../../../shared/agentEvents'
import {
  QUESTION_OUTCOME_CLARIFIED,
  QUESTION_OUTCOME_DEFERRED,
  UI_TEXT,
} from '../../../shared/constants'
import { isProtectedFileAccess } from '../../protectedPaths'
import { toSessionGoal, toSnapshot, wireGoalSchema, wireItemSchema } from './sessionRecords'
import type { SessionRecord } from '../../agent/agentBackend'

/** Parsed domain values for lane W's captured-frame lifecycle adapter. */
export type MuseCodeLifecycleEvent =
  | { readonly type: 'started'; readonly record: SessionRecord }
  | {
      readonly type: 'deleteCompleted'
      readonly sessionId: string
      readonly commandId: string
      readonly outcome: string
      readonly reason?: string
      readonly physicalChange?: string
    }

/** No default wire parser: new frames require the missing served captures. */
export interface MuseCodeLifecycleReader {
  parseNotification(notification: {
    readonly method: string
    readonly params: unknown
  }): MuseCodeLifecycleEvent
  parseDeleteAdmission(receipt: unknown, commandId: string): void
}

export type MappedNotification =
  | { readonly sessionId: string; readonly event: AgentEvent }
  /** The host already holds this approval's terminal (`change.kind: alreadyTerminal`). */
  | { readonly sessionId: string; readonly closedApprovalId: string }

export const UNKNOWN_METHOD = 'unknown'
export const MALFORMED_PARAMS = 'malformed'
export type MapOutcome = MappedNotification | typeof UNKNOWN_METHOD | typeof MALFORMED_PARAMS

const ALREADY_TERMINAL = 'alreadyTerminal'
const ONCE_SCOPE = 'once'
// MSP's approving decisions: `approved`, `approvedPolicyAmendment`, …
const APPROVING_DECISION_PREFIX = 'approved'

type WireChoice = z.infer<typeof approvalChoiceSchema>

/**
A file write the extension's list protects (D24, 2026-10-04) offers no
approval that outlasts it: "Always Allow" would be a rule Muse Code
answers later writes by, without a card. Allow once and every refusal
stay, as Muse Code offers for its own protected writes.
*/
function choicesFor(
  subject: z.infer<typeof approvalSubjectSchema>,
  choices: WireChoice[],
): WireChoice[] {
  return isProtectedFileAccess(subject)
    ? choices.filter(
        (choice) =>
          choice.scope === ONCE_SCOPE || !choice.decision.startsWith(APPROVING_DECISION_PREFIX),
      )
    : choices
}

export interface WireNotification {
  readonly method: string
  readonly params?: Record<string, unknown> | undefined
}

const itemSchema = wireItemSchema

const sessionScoped = { sessionId: z.string() }

/**
Which child the CLI's own reviewer decided for (2026-10-11,
subagentRowsCapture): every field is optional, so a frame that names the
child any of these ways still reads. Unknown fields strip, as elsewhere.
*/
const subagentOriginSchema = z.object({
  childRunId: z.optional(z.string()),
  childSessionId: z.optional(z.string()),
  subagentId: z.optional(z.string()),
})

const schemas = {
  'turn/started': z.object({ ...sessionScoped, turnId: z.string() }),
  'item/started': z.object({ ...sessionScoped, item: itemSchema }),
  'item/delta': z.object({
    ...sessionScoped,
    itemId: z.string(),
    delta: z.string(),
    field: z.optional(z.string()),
  }),
  'item/updated': z.object({ ...sessionScoped, item: itemSchema }),
  'item/completed': z.object({ ...sessionScoped, item: itemSchema }),
  'turn/completed': z.object({
    ...sessionScoped,
    turnId: z.string(),
    terminal: z.string(),
    reason: z.optional(z.string()),
    durationMs: z.optional(z.number()),
    // The CLI's own retry judgment rides beside the kind (captured
    // 2026-10-04, m91-captures/05-linux-msp-failure/turn-completed.jsonl);
    // absent on older hosts, which never sent it.
    error: z.optional(
      z.object({
        kind: z.string(),
        message: z.string(),
        retryable: z.optional(z.boolean()),
      }),
    ),
  }),
  'turn/retryScheduled': z.object({
    ...sessionScoped,
    turnId: z.string(),
    attempt: z.number(),
    // Required by the CLI's own schema export (1.4.10) but optional here so
    // a 1.4.5/1.4.6 host that omits it still parses.
    nextAttempt: z.optional(z.number()),
    // Lane RETRYLIMITS: an older sender always names one; a newer sender
    // omits it when neither the provider nor the person sets a retry limit.
    maxAttempts: z.optional(z.number()),
    retryDelayMs: z.number(),
    reason: z.string(),
    // The failing model attempt's facets (1.4.6); absent on older hosts.
    errorKind: z.optional(z.string()),
    httpStatus: z.optional(z.number()),
    system: z.optional(z.string()),
  }),
  // A provider backoff behind one model attempt, observable mid-turn and
  // non-terminal (served 2026-10-17 by 1.4.9-R6297.1). Unlike its
  // turn-level sibling it carries no recorded reason: the reason reads
  // from the failing attempt's own words.
  'turn/modelRetryScheduled': z.object({
    ...sessionScoped,
    turnId: z.string(),
    attempt: z.number(),
    nextAttempt: z.number(),
    maxAttempts: z.number(),
    retryDelayMs: z.number(),
    errorKind: z.optional(z.string()),
    httpStatus: z.optional(z.number()),
    system: z.optional(z.string()),
  }),
  // The built-in Auto-review reviewer holds an approval (1.4.9): a UI may
  // show the request is under review. Same shape as the request it holds.
  'approval/reviewing': z.object({
    ...sessionScoped,
    approvalId: z.string(),
  }),
  // An install landed, or a marketplace was added, updated or removed
  // (1.4.6): clients re-issue `plugin/list` (plus `hook/list` and
  // `skill/list`). The skill set is the one this UI re-lists.
  'plugin/changed': z.object(sessionScoped),
  'plugin/marketplaceChanged': z.object(sessionScoped),
  // A settlement nobody asked for (requested ones resolve the waiter in
  // dispatchHostEvent and never reach here): show the text as it came, a
  // title first when the host gave one. Outcome and reason are open
  // vocabularies; the outcome always reads.
  'recap/completed': z.object({
    ...sessionScoped,
    commandId: z.string(),
    outcome: z.string(),
    title: z.optional(z.string()),
    text: z.optional(z.string()),
    reason: z.optional(z.string()),
  }),
  // The session's VCS branch moved (1.4.6); `null` on a detached-HEAD
  // observation — a fact, not "unchanged".
  'session/branchChanged': z.object({
    ...sessionScoped,
    branch: z.nullable(z.string()),
  }),
  // The host's view-health state moved (v1 emits only `unavailable`;
  // the vocabulary is open, so the word reads as served).
  'session/viewHealthChanged': z.object({
    ...sessionScoped,
    health: z.string(),
    noneReason: z.optional(z.string()),
  }),
  // The turn's foreground work is done while background checks still hold
  // it open; the turn indicator keeps spinning, this says why.
  'turn/foregroundCompleted': z.object({
    ...sessionScoped,
    turnId: z.string(),
    blockingAgents: z.array(z.string()),
  }),
  // A loaded session was unloaded from this host (1.4.11): the log stays
  // on disk and `session/resume` reloads it. The reason is open (`leave`
  // for a released handoff, also idle unload and host shutdown).
  'session/closed': z.object({ ...sessionScoped, reason: z.string() }),
  // A handoff nobody asked for (requested ones resolve the waiter in
  // dispatchHostEvent and never reach here): outcome and reason are open.
  'session/leaveCompleted': z.object({
    ...sessionScoped,
    commandId: z.string(),
    outcome: z.string(),
    reason: z.optional(z.string()),
  }),
  // The session's running totals (D26): `cumulative` counts prompt tokens once
  // under the provider's cache convention. Since 1.4 the frame also carries
  // one completion's own counters (`usage`, counted-once `promptTokens`, the
  // call's `durationMs` and the effective `modelId`): the journal records
  // those per completion, and the cumulative pair keeps its session-total
  // meaning for every surface that sums it. The raw per-completion counters
  // beside it do not sum across providers, so they are not shown. The
  // cumulative cache reads sum on the same basis as the prompt total, so
  // they are carried where the wire reports them (live 2026-10-08); the
  // cumulative never carries reasoning, which stays unreported.
  'session/tokenUsage': z.object({
    ...sessionScoped,
    modelId: z.optional(z.nullable(z.string())),
    durationMs: z.optional(z.number()),
    promptTokens: z.optional(z.number()),
    totalTokens: z.optional(z.number()),
    usage: z.optional(
      z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        cachedTokens: z.optional(z.number()),
        reasoningTokens: z.optional(z.number()),
        cacheReadTokens: z.optional(z.number()),
        cacheWriteTokens: z.optional(z.number()),
      }),
    ),
    cumulative: z.object({
      promptTokens: z.int().check(z.gte(0)),
      outputTokens: z.int().check(z.gte(0)),
      cacheReadTokens: z.optional(z.nullable(z.int().check(z.gte(0)))),
    }),
  }),
  'session/contextUsage': z.object({
    ...sessionScoped,
    usedTokens: z.number(),
    windowTokens: z.optional(z.number()),
    pressure: z.string(),
  }),
  'session/modelChanged': z.object({ ...sessionScoped, modelId: z.string() }),
  'session/statusChanged': z.object({ ...sessionScoped, status: z.string() }),
  'session/nameChanged': z.object({ ...sessionScoped, name: z.string() }),
  'session/reasoningEffortChanged': z.object({ ...sessionScoped, reasoningEffort: z.string() }),
  'session/approvalModeChanged': z.object({ ...sessionScoped, mode: z.string() }),
  'session/todoListChanged': z.object({ ...sessionScoped, items: z.array(todoItemSchema) }),
  // The goal block replaced wholesale; an explicit `null` clears it (tdd
  // SS4.6.2, captured live 2026-09-25, M45). Absent reads as cleared too:
  // the schema types it optional, and it never means "unchanged".
  'session/goalChanged': z.object({
    ...sessionScoped,
    goal: z.optional(z.nullable(wireGoalSchema)),
  }),
  'skill/changed': z.object(sessionScoped),
  'approval/requested': z.object({
    ...sessionScoped,
    approvalId: z.string(),
    itemId: z.string(),
    toolName: z.string(),
    rawArgs: z.string(),
    currentRequirementId: requirementRefSchema,
    subject: approvalSubjectSchema,
    availableChoices: z.array(approvalChoiceSchema),
    judgeEscalated: z.boolean(),
    protectedWrite: z.boolean(),
    // The asking turn, on every captured frame (2026-10-02, stageRaceCapture).
    turnId: z.optional(z.string()),
  }),
  'approval/updated': z.object({
    ...sessionScoped,
    approvalId: z.string(),
    currentRequirementId: requirementRefSchema,
    subject: approvalSubjectSchema,
    availableChoices: z.array(approvalChoiceSchema),
    change: z.optional(z.object({ kind: z.string() })),
    // The CLI reviewer's own frames for one child (2026-10-11, subagentRowsCapture).
    subagentOrigin: z.optional(subagentOriginSchema),
  }),
  'approval/resolved': z.object({
    ...sessionScoped,
    approvalId: z.string(),
    itemId: z.string(),
    decision: z.string(),
    resolvedBy: z.string(),
    // The CLI reviewer's own frames for one child (2026-10-11, subagentRowsCapture).
    subagentOrigin: z.optional(subagentOriginSchema),
  }),
  'userInput/requested': z.object({
    ...sessionScoped,
    userInputId: z.string(),
    itemId: z.string(),
    questions: z.array(questionSchema),
  }),
  'userInput/settled': z.object({
    ...sessionScoped,
    userInputId: z.string(),
    outcome: z.string(),
    answers: z.array(answerSchema),
    // The explanation a `clarified` prompt settled with (M46); null otherwise.
    clarification: z.optional(z.nullable(z.object({ content: z.string() }))),
  }),
  // A queued submission reclaimed: its turn never runs (tdd SS3.6).
  'turn/unqueued': z.object({ ...sessionScoped, turnId: z.string() }),
  // Another client withdrew a submission; the item itself is re-sent as updated.
  // Since 1.4.10 the settlement carries its outcome: absent reads as
  // `accepted` (older hosts settle accepted retracts only).
  'turn/retracted': z.object({
    ...sessionScoped,
    turnId: z.string(),
    outcome: z.optional(z.string()),
  }),
  // Live delivery dropped events between two cursors (spec 208 SS4.8).
  'view/gap': z.object({ ...sessionScoped, after: z.string(), next: z.string() }),
  // The account's provider cannot serve the session's standing model (#25603).
  'session/modelRouteUnserved': z.object({ ...sessionScoped, modelId: z.string() }),
} as const

type MappedMethod = keyof typeof schemas

function isMappedMethod(method: string): method is MappedMethod {
  return Object.hasOwn(schemas, method)
}

/** The default delta field when the host omits one. */
const DEFAULT_DELTA_FIELD = 'text'

function rawNotification(notification: WireNotification): MapOutcome {
  const { method } = notification
  if (!isMappedMethod(method)) {
    return UNKNOWN_METHOD
  }
  // Parse the new goal frame under its literal method so TypeScript can
  // verify the schema/data relationship without an unchecked cast (M45).
  if (method === 'session/goalChanged') {
    const parsedGoal = schemas[method].safeParse(notification.params)
    if (!parsedGoal.success) {
      return MALFORMED_PARAMS
    }
    const { sessionId, goal } = parsedGoal.data
    return {
      sessionId,
      event: {
        type: 'goalChanged',
        goal: goal === undefined || goal === null ? null : toSessionGoal(goal),
      },
    }
  }
  const parsed = schemas[method].safeParse(notification.params)
  if (!parsed.success) {
    return MALFORMED_PARAMS
  }
  const params = parsed.data
  switch (method) {
    case 'turn/started': {
      const { sessionId, turnId } = params as z.infer<(typeof schemas)['turn/started']>
      return { sessionId, event: { type: 'turnStarted', turnId } }
    }
    case 'item/started': {
      const { sessionId, item } = params as z.infer<(typeof schemas)['item/started']>
      return { sessionId, event: { type: 'itemStarted', item: toSnapshot(item) } }
    }
    case 'item/delta': {
      const { sessionId, itemId, delta, field } = params as z.infer<(typeof schemas)['item/delta']>
      return {
        sessionId,
        event: { type: 'textDelta', itemId, field: field ?? DEFAULT_DELTA_FIELD, delta },
      }
    }
    case 'item/updated': {
      const { sessionId, item } = params as z.infer<(typeof schemas)['item/updated']>
      return { sessionId, event: { type: 'itemUpdated', item: toSnapshot(item) } }
    }
    case 'item/completed': {
      const { sessionId, item } = params as z.infer<(typeof schemas)['item/completed']>
      return { sessionId, event: { type: 'itemCompleted', item: toSnapshot(item) } }
    }
    case 'turn/completed': {
      const { sessionId, turnId, terminal, reason, durationMs, error } = params as z.infer<
        (typeof schemas)['turn/completed']
      >
      return {
        sessionId,
        event: {
          type: 'turnCompleted',
          turnId,
          terminal,
          ...(reason !== undefined && { reason }),
          ...(error !== undefined && { errorKind: error.kind }),
          // Whether resubmitting may work (RLF-ACPTURNS, RLWINFIX2): the
          // CLI's own judgment where it spoke; absent judgment stays absent.
          ...(error?.retryable !== undefined && { retryable: error.retryable }),
          ...(durationMs !== undefined && { durationMs }),
        },
      }
    }
    case 'turn/retryScheduled': {
      const { sessionId, turnId, attempt, maxAttempts, retryDelayMs, reason, ...facets } =
        params as z.infer<(typeof schemas)['turn/retryScheduled']>
      return {
        sessionId,
        event: {
          type: 'turnRetry',
          turnId,
          attempt,
          // The platform's ceiling survives the mapping (PR #214 review),
          // while Model API retries stay unbounded by leaving the shared
          // event's own field unnamed.
          ...(maxAttempts !== undefined && { maxAttempts }),
          retryDelayMs,
          reason,
          ...(facets.nextAttempt !== undefined && { nextAttempt: facets.nextAttempt }),
          ...(facets.errorKind !== undefined && { errorKind: facets.errorKind }),
          ...(facets.httpStatus !== undefined && { httpStatus: facets.httpStatus }),
          ...(facets.system !== undefined && { system: facets.system }),
        },
      }
    }
    case 'turn/modelRetryScheduled': {
      const {
        sessionId,
        turnId,
        attempt,
        nextAttempt,
        maxAttempts,
        retryDelayMs,
        errorKind,
        httpStatus,
        system,
      } = params as z.infer<(typeof schemas)['turn/modelRetryScheduled']>
      // No recorded reason on this layer: the failing attempt's own words,
      // else the provider system, else a plain unknown.
      const httpWord = httpStatus === undefined ? undefined : `HTTP ${String(httpStatus)}`
      const reason = errorKind ?? httpWord ?? system ?? UI_TEXT.resourceUnknown
      return {
        sessionId,
        event: {
          type: 'turnRetry',
          turnId,
          attempt,
          maxAttempts,
          retryDelayMs,
          reason,
          nextAttempt,
          ...(errorKind !== undefined && { errorKind }),
          ...(httpStatus !== undefined && { httpStatus }),
          ...(system !== undefined && { system }),
        },
      }
    }
    case 'approval/reviewing': {
      const { sessionId, approvalId } = params as z.infer<(typeof schemas)['approval/reviewing']>
      return {
        sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          text: `${UI_TEXT.approvalReviewing} (${approvalId})`,
        },
      }
    }
    case 'plugin/changed':
    case 'plugin/marketplaceChanged': {
      return { sessionId: params.sessionId, event: { type: 'skillsChanged' } }
    }
    case 'recap/completed': {
      const { sessionId, title, text, reason, outcome } = params as z.infer<
        (typeof schemas)['recap/completed']
      >
      const body = text ?? reason ?? outcome
      return {
        sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          text: title === undefined ? body : `${title}: ${body}`,
        },
      }
    }
    case 'session/branchChanged': {
      const { sessionId, branch } = params as z.infer<(typeof schemas)['session/branchChanged']>
      return {
        sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          text:
            branch === null
              ? UI_TEXT.sessionBranchChanged
              : `${UI_TEXT.sessionBranchChanged} (${branch})`,
        },
      }
    }
    case 'session/viewHealthChanged': {
      const { sessionId, health, noneReason } = params as z.infer<
        (typeof schemas)['session/viewHealthChanged']
      >
      return {
        sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          // The reason is the actionable half: it says why the view cannot
          // be used (SDK `SessionViewHealthChangedParams.noneReason`).
          text:
            noneReason === undefined
              ? `${UI_TEXT.sessionViewHealthChanged} (${health})`
              : `${UI_TEXT.sessionViewHealthChanged} (${health}: ${noneReason})`,
        },
      }
    }
    case 'turn/foregroundCompleted': {
      return {
        sessionId: params.sessionId,
        event: { type: 'backendNotice', level: 'info', text: UI_TEXT.turnForegroundCompleted },
      }
    }
    case 'session/closed': {
      const { sessionId, reason } = params as z.infer<(typeof schemas)['session/closed']>
      return {
        sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          text: `${UI_TEXT.sessionClosed} (${reason})`,
        },
      }
    }
    case 'session/leaveCompleted': {
      const { sessionId, outcome, reason } = params as z.infer<
        (typeof schemas)['session/leaveCompleted']
      >
      return {
        sessionId,
        event: {
          type: 'backendNotice',
          level: 'info',
          text:
            reason === undefined
              ? `${UI_TEXT.sessionLeaveCompleted} (${outcome})`
              : `${UI_TEXT.sessionLeaveCompleted} (${outcome}: ${reason})`,
        },
      }
    }
    case 'session/tokenUsage': {
      const { sessionId, cumulative, modelId, durationMs, promptTokens, usage } = params as z.infer<
        (typeof schemas)['session/tokenUsage']
      >
      return {
        sessionId,
        event: {
          type: 'tokenUsage',
          inputTokens: cumulative.promptTokens,
          outputTokens: cumulative.outputTokens,
          ...(typeof cumulative.cacheReadTokens === 'number' && {
            cachedTokens: cumulative.cacheReadTokens,
          }),
          ...(typeof modelId === 'string' && { modelId }),
          ...(usage !== undefined && {
            completion: {
              inputTokens: promptTokens ?? usage.inputTokens,
              outputTokens: usage.outputTokens,
              ...(usage.cachedTokens !== undefined && { cachedTokens: usage.cachedTokens }),
              ...(usage.reasoningTokens !== undefined && {
                reasoningTokens: usage.reasoningTokens,
              }),
              ...(usage.cacheWriteTokens !== undefined && {
                cacheWriteTokens: usage.cacheWriteTokens,
              }),
              ...(durationMs !== undefined && { durationMs }),
              ...(typeof modelId === 'string' && { modelId }),
            },
          }),
        },
      }
    }
    case 'session/contextUsage': {
      const { sessionId, usedTokens, windowTokens, pressure } = params as z.infer<
        (typeof schemas)['session/contextUsage']
      >
      return {
        sessionId,
        event: {
          type: 'contextUsage',
          usedTokens,
          pressure,
          ...(windowTokens !== undefined && { windowTokens }),
        },
      }
    }
    case 'session/modelChanged': {
      const { sessionId, modelId } = params as z.infer<(typeof schemas)['session/modelChanged']>
      return { sessionId, event: { type: 'modelChanged', modelId } }
    }
    case 'session/statusChanged': {
      const { sessionId, status } = params as z.infer<(typeof schemas)['session/statusChanged']>
      return { sessionId, event: { type: 'sessionStatus', status } }
    }
    case 'session/nameChanged': {
      const { sessionId, name } = params as z.infer<(typeof schemas)['session/nameChanged']>
      return { sessionId, event: { type: 'sessionNamed', name } }
    }
    case 'session/reasoningEffortChanged': {
      const { sessionId, reasoningEffort } = params as z.infer<
        (typeof schemas)['session/reasoningEffortChanged']
      >
      return { sessionId, event: { type: 'effortChanged', effort: reasoningEffort } }
    }
    case 'session/approvalModeChanged': {
      const { sessionId, mode } = params as z.infer<(typeof schemas)['session/approvalModeChanged']>
      return { sessionId, event: { type: 'approvalModeChanged', mode } }
    }
    case 'session/todoListChanged': {
      const { sessionId, items } = params as z.infer<(typeof schemas)['session/todoListChanged']>
      return { sessionId, event: { type: 'todoChanged', items } }
    }
    case 'skill/changed': {
      return { sessionId: params.sessionId, event: { type: 'skillsChanged' } }
    }
    case 'approval/requested': {
      const p = params as z.infer<(typeof schemas)['approval/requested']>
      return {
        sessionId: p.sessionId,
        event: {
          type: 'approvalRequested',
          approvalId: p.approvalId,
          itemId: p.itemId,
          toolName: p.toolName,
          rawArgs: p.rawArgs,
          requirementId: p.currentRequirementId,
          subject: p.subject,
          availableChoices: choicesFor(p.subject, p.availableChoices),
          isJudgeEscalated: p.judgeEscalated,
          // Muse Code's own flag, or the extension's list (a Muse Code file
          // write it does not flag).
          isProtectedWrite: p.protectedWrite || isProtectedFileAccess(p.subject),
          ...(p.turnId !== undefined && { turnId: p.turnId }),
        },
      }
    }
    case 'approval/updated': {
      const p = params as z.infer<(typeof schemas)['approval/updated']>
      if (p.change?.kind === ALREADY_TERMINAL) {
        // A decision against it could only bounce: the card waits for its resolve.
        return { sessionId: p.sessionId, closedApprovalId: p.approvalId }
      }
      return {
        sessionId: p.sessionId,
        event: {
          type: 'approvalUpdated',
          approvalId: p.approvalId,
          requirementId: p.currentRequirementId,
          subject: p.subject,
          availableChoices: choicesFor(p.subject, p.availableChoices),
          ...(p.subagentOrigin !== undefined && { subagentOrigin: p.subagentOrigin }),
        },
      }
    }
    case 'approval/resolved': {
      const { sessionId, approvalId, itemId, decision, resolvedBy, subagentOrigin } =
        params as z.infer<(typeof schemas)['approval/resolved']>
      return {
        sessionId,
        event: {
          type: 'approvalResolved',
          approvalId,
          itemId,
          decision,
          resolvedBy,
          ...(subagentOrigin !== undefined && { subagentOrigin }),
        },
      }
    }
    case 'userInput/requested': {
      const { sessionId, userInputId, itemId, questions } = params as z.infer<
        (typeof schemas)['userInput/requested']
      >
      return { sessionId, event: { type: 'questionRequested', userInputId, itemId, questions } }
    }
    case 'userInput/settled': {
      const { sessionId, userInputId, outcome, answers, clarification } = params as z.infer<
        (typeof schemas)['userInput/settled']
      >
      return {
        sessionId,
        event: {
          type: 'questionSettled',
          userInputId,
          outcome,
          answers,
          ...(typeof clarification?.content === 'string' && {
            clarification: clarification.content,
          }),
        },
      }
    }
    case 'turn/unqueued': {
      const { sessionId, turnId } = params as z.infer<(typeof schemas)['turn/unqueued']>
      // Not a turn completion: the foreground turn, if any, runs on.
      return {
        sessionId,
        event: { type: 'turnWithdrawn', turnId, reason: UI_TEXT.turnUnqueued },
      }
    }
    case 'turn/retracted': {
      // A declined retract withdrew nothing: the turn runs on.
      if ((params as z.infer<(typeof schemas)['turn/retracted']>).outcome === 'declined') {
        return {
          sessionId: params.sessionId,
          event: { type: 'backendNotice', level: 'info', text: UI_TEXT.turnRetractDeclined },
        }
      }
      return {
        sessionId: params.sessionId,
        event: { type: 'backendNotice', level: 'info', text: UI_TEXT.turnRetracted },
      }
    }
    case 'view/gap': {
      return { sessionId: params.sessionId, event: { type: 'viewGap' } }
    }
    case 'session/modelRouteUnserved': {
      const { sessionId, modelId } = params as z.infer<
        (typeof schemas)['session/modelRouteUnserved']
      >
      return {
        sessionId,
        event: {
          type: 'backendNotice',
          level: 'warning',
          text: `${UI_TEXT.modelRouteUnserved} (${modelId})`,
        },
      }
    }
  }
}

/** Diagnostic events are safe before any backend subscriber sees them. */
export function mapNotification(notification: WireNotification): MapOutcome {
  const mapped = rawNotification(notification)
  return typeof mapped === 'string' || !('event' in mapped)
    ? mapped
    : { ...mapped, event: redactDiagnosticEvent(mapped.event) }
}

/** Only a harness-deferred id changes M46's captured clarified outcome. Future words pass through. */
export function questionSettlementOutcome(outcome: string, wasDeferred: boolean): string {
  return wasDeferred && outcome === QUESTION_OUTCOME_CLARIFIED ? QUESTION_OUTCOME_DEFERRED : outcome
}

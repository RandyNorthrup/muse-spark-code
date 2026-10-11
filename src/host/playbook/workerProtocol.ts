// What crosses the thread boundary between a VS Code window and its
// playbook worker (M116, lane C-M116-6). Both directions are parsed like any
// other boundary (AGENTS.md rule 7): the window validates every worker
// message, the worker every request. No error text crosses: a refusal carries
// the policy's own why-note, anything else is the fixed word `unavailable`.

import * as z from 'zod/mini'
import {
  PLAYBOOK_ID_MAX_CHARS,
  PLAYBOOK_RECORD_MAX,
  PLAYBOOK_WORKER_KIND,
  REVIEW_FINDING_PATH_MAX_CHARS,
  REVIEW_FINDING_TEXT_MAX_CHARS,
  REVIEW_FINDINGS_MAX,
} from '../../shared/constants'
import {
  playbookDesignDecisionSchema,
  playbookFindingRefSchema,
  playbookRoundSchema,
  playbookWhyNoteSchema,
} from '../../shared/playbook'
import { playbookChangeSchema, playbookSnapshotSchema } from '../../runtime/playbook/command'
import {
  playbookAgentRecordsSchema,
  playbookAgentRefSchema,
} from '../../runtime/playbook/panelWire'

const id = z.string().check(z.trim(), z.minLength(1), z.maxLength(PLAYBOOK_ID_MAX_CHARS))
const request = z.int().check(z.gte(1))
const text = z.string().check(z.trim(), z.minLength(1), z.maxLength(REVIEW_FINDING_TEXT_MAX_CHARS))
const file = z.string().check(z.minLength(1), z.maxLength(REVIEW_FINDING_PATH_MAX_CHARS))
// A session id may be longer than a journal id; the governor bounds what it records.
const session = z.string().check(z.minLength(1), z.maxLength(REVIEW_FINDING_PATH_MAX_CHARS))

/** What the worker is started with. */
export const playbookWorkerDataSchema = z.strictObject({
  kind: z.literal(PLAYBOOK_WORKER_KIND),
  agentDataFolder: z.string().check(z.minLength(1)),
  workspaceFolder: z.string().check(z.minLength(1)),
  /** Windows only: the compiled job type, and where Windows lives. */
  assemblyPath: z.optional(z.string().check(z.minLength(1))),
  systemRoot: z.optional(z.string().check(z.minLength(1))),
  /** The window's display language: its table and locale. */
  table: z.unknown(),
  locale: z.string().check(z.minLength(1)),
})
export type PlaybookWorkerData = z.infer<typeof playbookWorkerDataSchema>

export const panelChildSchema = z.strictObject({
  agentId: session,
  sessionId: session,
  files: z.array(file).check(z.maxLength(PLAYBOOK_RECORD_MAX)),
})

/** The two events a review is settled by; nothing else of a turn crosses. */
export const playbookReviewEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('itemCompleted'),
    item: z.strictObject({
      itemId: z.string(),
      kind: z.string(),
      status: z.string(),
      turnId: z.optional(z.string()),
      text: z.optional(z.string()),
    }),
  }),
  z.strictObject({ type: z.literal('turnCompleted'), turnId: z.string(), terminal: z.string() }),
])
export type PlaybookReviewEvent = z.infer<typeof playbookReviewEventSchema>

/** The answers the panel offers: an override needs authority no panel control carries. */
export const panelAnswerSchema = z.discriminatedUnion('status', [
  z.strictObject({ findingId: id, status: z.literal('fixed') }),
  z.strictObject({ findingId: id, status: z.literal('disputed'), reason: text }),
  z.strictObject({
    findingId: id,
    status: z.literal('residual'),
    name: id,
    whySafe: text,
    followUp: text,
  }),
])

export const panelDesignFieldsSchema = z.strictObject({
  failureClass: text,
  whyPatchesFailed: text,
  structuralChange: text,
  planLocation: z
    .string()
    .check(z.trim(), z.minLength(1), z.maxLength(REVIEW_FINDING_PATH_MAX_CHARS)),
})

/** The dispatches a conversation in the panel makes. */
const dispatchKind = z.enum(['subagent', 'delegate', 'bestOfN'])
export type PlaybookDispatchKind = z.infer<typeof dispatchKind>

export const toPlaybookWorkerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('read'), id: request }),
  z.strictObject({ type: z.literal('change'), id: request, change: playbookChangeSchema }),
  z.strictObject({
    type: z.literal('agents'),
    id: request,
    children: z.array(playbookAgentRefSchema).check(z.maxLength(PLAYBOOK_RECORD_MAX)),
  }),
  z.strictObject({ type: z.literal('standing'), id: request, sessionId: session }),
  z.strictObject({
    type: z.literal('reviewOpen'),
    id: request,
    reviewId: id,
    sessionId: session,
    files: z.array(file).check(z.maxLength(PLAYBOOK_RECORD_MAX)),
    children: z.array(panelChildSchema).check(z.maxLength(PLAYBOOK_RECORD_MAX)),
  }),
  z.strictObject({
    type: z.literal('reviewObserve'),
    id: request,
    reviewId: id,
    event: playbookReviewEventSchema,
  }),
  z.strictObject({ type: z.literal('reviewBind'), id: request, reviewId: id, turnId: z.string() }),
  z.strictObject({ type: z.literal('reviewCancel'), id: request, reviewId: id }),
  z.strictObject({
    type: z.literal('dispatch'),
    id: request,
    kind: dispatchKind,
    sessionId: session,
    targetId: z.optional(session),
    /** Restricted Mode runs no git and no hook: a governed round refuses there. */
    isTrusted: z.boolean(),
  }),
  // The window's answers to a dispatch's two callbacks, by the dispatch's id.
  z.strictObject({ type: z.literal('effectDone'), dispatch: request, ok: z.boolean() }),
  z.strictObject({ type: z.literal('completionDone'), dispatch: request, ok: z.boolean() }),
  z.strictObject({
    type: z.literal('answer'),
    id: request,
    sessionId: session,
    moduleId: id,
    answers: z.array(panelAnswerSchema).check(z.minLength(1), z.maxLength(REVIEW_FINDINGS_MAX)),
  }),
  z.strictObject({
    type: z.literal('design'),
    id: request,
    sessionId: session,
    moduleId: id,
    fields: panelDesignFieldsSchema,
  }),
])
export type ToPlaybookWorker = z.infer<typeof toPlaybookWorkerSchema>

/** The journal's finding with what a card adds: the review's title, and whether it is answered. */
const finding = z.extend(playbookFindingRefSchema, {
  title: z.optional(z.string().check(z.maxLength(REVIEW_FINDING_TEXT_MAX_CHARS))),
  isAnswered: z.boolean(),
})

export const panelModuleSummarySchema = z.strictObject({
  moduleId: id,
  moduleKey: file,
  round: z.int().check(z.gte(1)),
  phase: z.enum(['build', 'fix', 'redesign']),
  findings: z.array(finding).check(z.maxLength(REVIEW_FINDINGS_MAX)),
  design: z.optional(z.enum(['pending', 'impossible', 'caught', 'remains'])),
  isEscalated: z.boolean(),
})

/** Each request's own answer; the window parses `result.value` with the one it asked for. */
export const playbookResultSchemas = {
  snapshot: playbookSnapshotSchema,
  agents: playbookAgentRecordsSchema,
  standing: z.array(panelModuleSummarySchema).check(z.maxLength(PLAYBOOK_RECORD_MAX)),
  reviewOpening: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ordinary') }),
    z.strictObject({
      kind: z.literal('playbook'),
      modules: z
        .array(
          z.strictObject({
            moduleId: id,
            moduleKey: file,
            prior: z.optional(playbookRoundSchema),
            design: z.optional(playbookDesignDecisionSchema),
          }),
        )
        .check(z.minLength(1), z.maxLength(REVIEW_FINDINGS_MAX)),
    }),
  ]),
  reviewProgress: z.strictObject({
    isClosed: z.boolean(),
    rounds: z.array(panelModuleSummarySchema).check(z.maxLength(REVIEW_FINDINGS_MAX)),
  }),
  done: z.strictObject({ ok: z.boolean() }),
  dispatch: z.enum(['ungoverned', 'completed']),
} as const

export const fromPlaybookWorkerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('result'), id: request, value: z.unknown() }),
  // The policy refused, and this is its why-note.
  z.strictObject({ type: z.literal('refused'), id: request, note: playbookWhyNoteSchema }),
  z.strictObject({ type: z.literal('unavailable'), id: request }),
  // A dispatch's callbacks: start the work; wait for the child's own end; stop it.
  z.strictObject({ type: z.literal('effect'), dispatch: request }),
  z.strictObject({ type: z.literal('completion'), dispatch: request }),
  z.strictObject({ type: z.literal('abort'), dispatch: request }),
  z.strictObject({
    type: z.literal('note'),
    sessionId: session,
    /** The request whose synchronous part said it, when there is one. */
    request: z.optional(request),
    note: playbookWhyNoteSchema,
  }),
  z.strictObject({ type: z.literal('offer'), sessionId: session, moduleId: id, moduleKey: file }),
  z.strictObject({ type: z.literal('hookOutput'), sessionId: session, output: z.string() }),
  z.strictObject({ type: z.literal('failure'), sessionId: session }),
  // Windows: the decision's job, so the window can end it by name; absent when it ended.
  z.strictObject({ type: z.literal('job'), name: z.optional(z.string()) }),
  // Sent before every contained call: the worker is working, not stuck.
  z.strictObject({ type: z.literal('alive') }),
])
export type FromPlaybookWorker = z.infer<typeof fromPlaybookWorkerSchema>

// M112's portable question contracts. Internal harness data, not new MSP
// fields: Muse Code's deferral uses M46's captured userInput/clarify shape.
// No Node, DOM or editor API; Q implements the registry and key function.

import * as z from 'zod/mini'
import { answerSchema, questionSchema, type Question } from './agentEvents'
import {
  OPEN_QUESTIONS_MAX,
  QUESTION_ID_MAX_CHARS,
  QUESTION_OUTCOME_DEFERRED,
  QUESTION_REMINDERS_MAX,
} from './constants'

export const QUESTION_STATES = [
  'waiting',
  'open',
  'answered',
  'cancelled',
  'clarified',
  'answeredLater',
  'answeredOnReask',
  'dismissed',
  'expired',
] as const
export type QuestionState = (typeof QUESTION_STATES)[number]

const idSchema = z.string().check(z.minLength(1), z.maxLength(QUESTION_ID_MAX_CHARS))
const timestampSchema = z.int().check(z.gte(0))
const deferredStates: ReadonlySet<QuestionState> = new Set([
  'open',
  'answeredLater',
  'answeredOnReask',
  'dismissed',
  'expired',
])

/** One card's durable identity and lifecycle; question text never enters logs or exports. */
export const openQuestionSchema = z
  .strictObject({
    userInputId: idSchema,
    sessionId: idSchema,
    itemId: idSchema,
    turnId: idSchema,
    questions: z.array(questionSchema).check(z.minLength(1)),
    key: z.string().check(z.minLength(1)),
    state: z.enum(QUESTION_STATES),
    /** Milliseconds from the injected clock; no surface owns the deadline. */
    askedAt: timestampSchema,
    deferredAt: z.optional(timestampSchema),
    reminders: z.int().check(z.gte(0), z.lte(QUESTION_REMINDERS_MAX)),
    backend: z.enum(['museCode', 'modelApi']),
  })
  .check(
    z.refine((entry) => !deferredStates.has(entry.state) || entry.deferredAt !== undefined),
    z.refine((entry) => entry.deferredAt === undefined || entry.deferredAt >= entry.askedAt),
    z.refine(
      (entry) =>
        new Set(entry.questions.map((question) => question.id)).size === entry.questions.length,
    ),
  )
export type OpenQuestion = z.infer<typeof openQuestionSchema>

/** Snapshot may include terminal updates so both row and dock settle together. */
export const openQuestionsSnapshotSchema = z
  .strictObject({
    sessionId: idSchema,
    questions: z.array(openQuestionSchema),
  })
  .check(
    z.refine((snapshot) =>
      snapshot.questions.every((entry) => entry.sessionId === snapshot.sessionId),
    ),
    z.refine(
      (snapshot) =>
        new Set(snapshot.questions.map((entry) => entry.userInputId)).size ===
        snapshot.questions.length,
    ),
    z.refine(
      (snapshot) =>
        snapshot.questions.filter((entry) => entry.state === 'open').length <= OPEN_QUESTIONS_MAX,
    ),
  )
export type OpenQuestionsSnapshot = z.infer<typeof openQuestionsSnapshotSchema>

/** Owner-only per-session file; adapters validate before loading or writing. */
export const openQuestionStoreSchema = z.strictObject({
  version: z.literal(1),
  snapshot: openQuestionsSnapshotSchema,
})

/** The existing replies plus the internal fourth reply Q binds in ModelApiHost. */
export const questionReplySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('answered'),
    answers: z.array(answerSchema).check(z.minLength(1)),
  }),
  z.strictObject({ kind: z.literal('cancelled') }),
  z.strictObject({ kind: z.literal('clarified'), text: z.string().check(z.minLength(1)) }),
  z.strictObject({ kind: z.literal(QUESTION_OUTCOME_DEFERRED), userInputId: idSchema }),
])
export type QuestionReply = z.infer<typeof questionReplySchema>

/** One late answer, either choices/text answers or an explanation; never an approval. */
export const openQuestionAnswerSchema = z.union([
  z.strictObject({ answers: z.array(answerSchema).check(z.minLength(1)) }),
  z.strictObject({ explanation: z.string().check(z.minLength(1)) }),
])
export type OpenQuestionAnswer = z.infer<typeof openQuestionAnswerSchema>

export const answerOpenQuestionSchema = z.strictObject({
  type: z.literal('answerOpenQuestion'),
  sessionId: idSchema,
  userInputId: idSchema,
  reply: openQuestionAnswerSchema,
})
export const dismissOpenQuestionSchema = z.strictObject({
  type: z.literal('dismissOpenQuestion'),
  sessionId: idSchema,
  userInputId: idSchema,
})
export const jumpToOpenQuestionSchema = z.strictObject({
  type: z.literal('jumpToOpenQuestion'),
  sessionId: idSchema,
  direction: z.enum(['next', 'previous']),
})
export const openQuestionsMessageSchema = z.strictObject({
  type: z.literal('openQuestions'),
  snapshot: openQuestionsSnapshotSchema,
})

/** The dock lists identities; drafts and focus stay on the surface, never in a status item. */
export const attentionDockStateSchema = z
  .strictObject({
    approvalIds: z.array(idSchema),
    waitingQuestionIds: z.array(idSchema),
    elicitationIds: z.array(idSchema),
    openQuestionIds: z.array(idSchema).check(z.maxLength(OPEN_QUESTIONS_MAX)),
    fullCard: z.optional(
      z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('question'), userInputId: idSchema }),
        z.strictObject({ kind: z.literal('elicitation'), elicitationId: idSchema }),
      ]),
    ),
  })
  .check(
    z.refine((dock) => {
      const questionIds = [...dock.waitingQuestionIds, ...dock.openQuestionIds]
      return (
        new Set(questionIds).size === questionIds.length &&
        new Set(dock.approvalIds).size === dock.approvalIds.length &&
        new Set(dock.elicitationIds).size === dock.elicitationIds.length &&
        (dock.fullCard === undefined ||
          (dock.fullCard.kind === 'question'
            ? questionIds.includes(dock.fullCard.userInputId)
            : dock.elicitationIds.includes(dock.fullCard.elicitationId)))
      )
    }),
  )
export type AttentionDockState = z.infer<typeof attentionDockStateSchema>

/** Q's questionKey: NFC, trim, folded whitespace, toLowerCase; sorted option-label sets. */
export type QuestionKey = (questions: readonly Question[]) => string

export interface QuestionStore {
  /** Missing session returns []; malformed storage rejects, never an empty success. */
  load(sessionId: string): Promise<readonly OpenQuestion[]>
  /** Atomic owner-only replacement, scoped to this session. */
  save(sessionId: string, questions: readonly OpenQuestion[]): Promise<void>
  remove(sessionId: string): Promise<void>
}

export interface QuestionClock {
  now(): number
  /** Delay in milliseconds; returns an idempotent cancellation function. */
  setTimer(delayMs: number, callback: () => void): () => void
}

export interface QuestionDelivery {
  readonly sessionId: string
  readonly userInputId: string
  readonly text: string
  /** User-visible text only; the model reads `text`. */
  readonly displayText: string | undefined
}

/** Only notTaken permits a retry; an uncertain acknowledgement remains marked. */
export type QuestionDeliveryOutcome = 'taken' | 'notTaken' | 'uncertain'

/** Required by the registry; a session without it cannot start the deferral clock. */
export interface QuestionDeferralPort {
  /** Resolve only once the tool call is settled; an existing settlement rejects as PromptSettledError. */
  deferQuestions(userInputId: string): Promise<void>
}

export interface QuestionRegistryPort extends QuestionClock, QuestionDeferralPort {
  readonly store: QuestionStore
  /** Uses submit: steer, refused-steer fallback, or a new turn. Dismissals may be queued lazily. */
  deliver(message: QuestionDelivery): Promise<QuestionDeliveryOutcome>
}

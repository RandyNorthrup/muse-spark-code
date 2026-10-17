import type { Question } from '../../shared/agentEvents'
import {
  MILLISECONDS_PER_SECOND,
  OPEN_QUESTIONS_MAX,
  QUESTION_DEFER_DEFAULT_SECONDS,
  QUESTION_DEFER_MAX_SECONDS,
  QUESTION_DEFER_MIN_SECONDS,
  QUESTION_DELIVERY_MODEL_TEXT,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  openQuestionsSnapshotSchema,
  type OpenQuestion,
  type OpenQuestionAnswer,
  type OpenQuestionsSnapshot,
  type QuestionDeliveryOutcome,
  type QuestionRegistryPort,
} from '../../shared/questions'
import { isPromptSettledError } from '../agent/agentBackend'
import { questionKey } from './key'
import {
  answersForRequest,
  lateAnswer,
  validatedAnswer,
  type QuestionAnswerText,
} from './lateAnswer'
import { nextQuestionReminder } from './reminders'

export interface QuestionRegistryDeps extends QuestionRegistryPort {
  /** ACP owns its form deadline; its registry only applies the transition. */
  readonly hasExternalTimer?: boolean
  readonly formatAnswer: QuestionAnswerText
  /** Waiting requests settle on their own turn, never through user-message delivery. */
  readonly reply: (userInputId: string, reply: OpenQuestionAnswer | undefined) => Promise<void>
  readonly changed: (snapshot: OpenQuestionsSnapshot) => void
  readonly failed: () => void
}

export interface QuestionRequest {
  readonly userInputId: string
  readonly itemId: string
  readonly turnId: string
  readonly questions: readonly Question[]
}

export function questionDeferSeconds(value: number): number {
  if (value === 0) return 0
  const bounded = Math.min(QUESTION_DEFER_MAX_SECONDS, Math.max(QUESTION_DEFER_MIN_SECONDS, value))
  return Number.isSafeInteger(value) ? bounded : QUESTION_DEFER_DEFAULT_SECONDS
}

/** One holding process per session. Persistence and marks precede external effects. */
export class QuestionRegistry {
  private readonly entries = new Map<string, OpenQuestion>()
  private readonly requests = new Map<string, QuestionRequest & { cardId: string }>()
  private readonly timers = new Map<string, () => void>()
  private readonly deferrals = new Map<
    string,
    { readonly ids: ReadonlySet<string>; readonly promise: Promise<void> }
  >()
  /** Presentation only: the durable answer mark is deletion before any reply dispatch. */
  private readonly replying = new Map<string, OpenQuestion>()
  private readonly endedTurns = new Set<string>()
  private publication = 0
  private tail: Promise<void> = Promise.resolve()
  private readonly loading: Promise<void>
  private isDisposed = false

  public constructor(
    public readonly sessionId: string,
    private readonly backend: OpenQuestion['backend'],
    private readonly deps: QuestionRegistryDeps,
  ) {
    this.loading = this.load()
  }

  private async load(): Promise<void> {
    const questions = await this.deps.store.load(this.sessionId)
    const parsed = openQuestionsSnapshotSchema.safeParse({ sessionId: this.sessionId, questions })
    if (!parsed.success) throw new Error(UI_TEXT.questionAnswerFailed)
    const snapshot = parsed.data
    for (const entry of snapshot.questions) {
      if (['waiting', 'open', 'dismissed'].includes(entry.state)) {
        this.entries.set(
          entry.userInputId,
          entry.state === 'waiting'
            ? {
                ...entry,
                state: 'open',
                deferredAt: entry.deferredAt ?? Math.max(entry.askedAt, this.deps.now()),
              }
            : entry,
        )
      }
    }
    this.expireOldest()
    await this.publish()
  }

  private run<T>(work: () => Promise<T> | T): Promise<T> {
    const previous = this.tail
    const result = (async () => {
      await previous
      await this.loading
      if (this.isDisposed) throw new Error(UI_TEXT.questionAnswerFailed)
      const entries = structuredClone([...this.entries])
      const requests = structuredClone([...this.requests])
      const replying = structuredClone([...this.replying])
      const endedTurns = [...this.endedTurns]
      const publication = this.publication
      try {
        return await work()
      } catch (error: unknown) {
        this.entries.clear()
        this.requests.clear()
        this.replying.clear()
        this.endedTurns.clear()
        for (const turn of endedTurns) this.endedTurns.add(turn)
        for (const [id, entry] of entries) this.entries.set(id, entry)
        for (const [id, request] of requests) this.requests.set(id, request)
        for (const [id, entry] of replying) this.replying.set(id, entry)
        for (const id of this.timers.keys()) this.stopTimer(id)
        for (const entry of this.entries.values())
          if (entry.deadlineAt !== undefined && entry.deadlineAt > this.deps.now())
            this.armTimer(entry)
        if (this.publication !== publication) {
          await this.deps.store.save(this.sessionId, this.snapshot(false).questions)
          this.deps.changed(this.snapshot())
        }
        throw error
      }
    })()
    this.tail = (async () => {
      try {
        await result
      } catch {
        // The caller receives the error; later operations still run in order.
        return
      }
    })()
    return result
  }

  private stopTimer(id: string): void {
    this.timers.get(id)?.()
    this.timers.delete(id)
  }

  private armTimer(entry: OpenQuestion): void {
    if (
      !this.deps.hasExternalTimer &&
      entry.state === 'waiting' &&
      entry.deadlineAt !== undefined
    ) {
      this.timers.set(
        entry.userInputId,
        this.deps.setTimer(Math.max(0, entry.deadlineAt - this.deps.now()), () => {
          void this.defer(entry.userInputId).catch(this.deps.failed)
        }),
      )
    }
  }

  private expireOldest(): void {
    const open = this.snapshot().questions.filter((entry) => entry.state === 'open')
    const expired = open.slice(0, Math.max(0, open.length - OPEN_QUESTIONS_MAX))
    for (const entry of expired) this.entries.set(entry.userInputId, { ...entry, state: 'expired' })
  }

  private async publish(): Promise<void> {
    const snapshot = openQuestionsSnapshotSchema.parse(this.snapshot(false))
    const retained = snapshot.questions.filter((entry) =>
      ['waiting', 'open', 'dismissed'].includes(entry.state),
    )
    // One atomic replacement: terminal deletion is itself the durable answer mark.
    await this.deps.store.save(this.sessionId, retained)
    this.publication += 1
    for (const entry of snapshot.questions) {
      if (retained.every((kept) => kept.userInputId !== entry.userInputId))
        this.entries.delete(entry.userInputId)
    }
    this.deps.changed(
      structuredClone({
        ...snapshot,
        questions: [
          ...snapshot.questions.filter((entry) => !this.replying.has(entry.userInputId)),
          ...this.replying.values(),
        ],
      }),
    )
  }

  public async ready(): Promise<void> {
    await this.loading
    await this.tail
  }

  public snapshot(shouldIncludePendingReplies = true): OpenQuestionsSnapshot {
    const entries = new Map(this.entries)
    if (shouldIncludePendingReplies) for (const [id, entry] of this.replying) entries.set(id, entry)
    return structuredClone({
      sessionId: this.sessionId,
      questions: Array.from(entries.values(), (entry) => ({ ...entry })).toSorted(
        (a, b) => a.askedAt - b.askedAt,
      ),
    })
  }

  public register(
    request: QuestionRequest,
    seconds: number,
    isImmediate = false,
    timing?: { readonly askedAt: number; readonly deadlineAt?: number },
  ): Promise<OpenQuestion> {
    const askedAt = timing?.askedAt ?? this.deps.now()
    return this.run(async () => {
      const existingRequest = this.requests.get(request.userInputId)
      const existing =
        existingRequest === undefined ? undefined : this.entries.get(existingRequest.cardId)
      if (existing !== undefined) return structuredClone(existing)
      const key = questionKey(request.questions)
      const cards = Array.from(this.entries.values(), (entry) => ({ ...entry }))
      const previous = cards.find(
        (entry) => entry.key === key && (entry.state === 'waiting' || entry.state === 'open'),
      )
      const duration = questionDeferSeconds(seconds)
      const scheduledDeadline = isImmediate ? askedAt : undefined
      const interactiveDeadline =
        duration === 0 ? undefined : askedAt + duration * MILLISECONDS_PER_SECOND
      const deadlineAt =
        timing === undefined ? (scheduledDeadline ?? interactiveDeadline) : timing.deadlineAt
      const entry =
        previous?.state === 'waiting'
          ? previous
          : {
              ...previous,
              itemId: request.itemId,
              turnId: request.turnId,
              questions: [...request.questions],
              userInputId: previous?.userInputId ?? request.userInputId,
              sessionId: this.sessionId,
              backend: this.backend,
              key,
              state: 'waiting' as const,
              askedAt: previous?.askedAt ?? askedAt,
              reminders: previous?.reminders ?? 0,
              ...(deadlineAt !== undefined && { deadlineAt }),
            }
      // A re-ask keeps the durable card and its original answer IDs/text.
      if (previous !== undefined) {
        entry.questions = previous.questions
        entry.itemId = previous.itemId
        entry.turnId = previous.turnId
      }
      if (deadlineAt === undefined && previous?.state !== 'waiting') delete entry.deadlineAt
      this.entries.set(entry.userInputId, entry)
      this.requests.set(request.userInputId, { ...request, cardId: entry.userInputId })
      this.stopTimer(entry.userInputId)
      await this.publish()
      this.armTimer(entry)
      return structuredClone(entry)
    })
  }

  public defer(cardId: string): Promise<void> {
    const current = this.deferrals.get(cardId)
    const ids = new Set(
      Array.from(this.requests.values(), (request) => ({ ...request }))
        .filter((request) => request.cardId === cardId)
        .map((request) => request.userInputId),
    )
    if (current !== undefined && [...ids].every((id) => current.ids.has(id))) return current.promise
    const batchIds = new Set([...(current?.ids ?? []), ...ids])
    const pending = (async () => {
      try {
        const ids = await this.run(async () => {
          const entry = this.entries.get(cardId)
          if (entry?.state !== 'waiting') return []
          this.stopTimer(cardId)
          this.entries.set(cardId, {
            ...entry,
            state: 'open',
            deferredAt: entry.deferredAt ?? Math.max(entry.askedAt, this.deps.now()),
          })
          this.expireOldest()
          await this.publish()
          const requests = Array.from(this.requests.values(), (request) => ({ ...request }))
          return requests
            .filter(
              (request) =>
                request.cardId === cardId && current?.ids.has(request.userInputId) !== true,
            )
            .map((request) => request.userInputId)
        })
        const results = await Promise.allSettled(ids.map((id) => this.deps.deferQuestions(id)))
        for (const result of results)
          if (result.status === 'rejected' && !isPromptSettledError(result.reason))
            this.deps.failed()
        await this.run(() => {
          for (const id of ids) this.requests.delete(id)
        })
        // A fresh deadline dispatches its own IDs before waiting for an older ack.
        await current?.promise
      } finally {
        if (this.deferrals.get(cardId)?.ids === batchIds) this.deferrals.delete(cardId)
      }
    })()
    this.deferrals.set(cardId, {
      ids: batchIds,
      promise: pending,
    })
    return pending
  }

  public settle(userInputId: string, outcome: string): Promise<void> {
    return this.run(async () => {
      const request = this.requests.get(userInputId)
      if (request === undefined) return
      this.requests.delete(userInputId)
      const entry = this.entries.get(request.cardId)
      if (entry === undefined || this.replying.has(request.cardId)) return
      let state: OpenQuestion['state'] = 'open'
      switch (outcome) {
        case 'answered': {
          state = entry.deferredAt === undefined ? 'answered' : 'answeredOnReask'
          break
        }
        case 'cancelled': {
          state = 'cancelled'
          break
        }
        case 'clarified': {
          state = 'clarified'
          break
        }
        default: {
          break
        }
      }
      const requests = Array.from(this.requests.values(), (request) => ({ ...request }))
      if (state === 'open' && requests.some((other) => other.cardId === request.cardId)) return
      this.stopTimer(request.cardId)
      this.entries.set(request.cardId, {
        ...entry,
        state,
        ...(state === 'open' && {
          deferredAt: entry.deferredAt ?? Math.max(entry.askedAt, this.deps.now()),
        }),
      })
      this.expireOldest()
      await this.publish()
    })
  }

  public async answer(
    cardId: string,
    raw: OpenQuestionAnswer | undefined,
  ): Promise<QuestionDeliveryOutcome> {
    await this.deferrals.get(cardId)?.promise
    const reserved = await this.run(async () => {
      const entry = this.entries.get(cardId)
      if (entry === undefined || (entry.state !== 'open' && entry.state !== 'waiting'))
        throw new Error(UI_TEXT.answerNotAccepted)
      if (raw === undefined && entry.state !== 'waiting')
        throw new Error(UI_TEXT.questionCancelFailed)
      const reply = raw === undefined ? undefined : validatedAnswer(entry, raw)
      const currentRequests = Array.from(this.requests.values(), (request) => ({ ...request }))
      const requests = currentRequests.filter((request) => request.cardId === cardId)
      this.stopTimer(cardId)
      let state: OpenQuestion['state'] = 'cancelled'
      if (reply !== undefined) {
        if (entry.state === 'open') state = 'answeredLater'
        else if (entry.deferredAt === undefined)
          state = 'explanation' in reply ? 'clarified' : 'answered'
        else state = 'answeredOnReask'
      }
      this.entries.set(cardId, { ...entry, state })
      if (entry.state === 'waiting') this.replying.set(cardId, entry)
      // A durable mark prevents a second surface or a reload from sending again.
      await this.publish()
      return { entry, reply, requests, state }
    })
    let outcome: QuestionDeliveryOutcome = 'uncertain'
    try {
      // Check after reserving: the deadline can win while this answer waits for its turn.
      await this.deferrals.get(cardId)?.promise
      if (reserved.entry.state === 'waiting') {
        const results = await Promise.allSettled(
          reserved.requests.map(async (request) => {
            let reply = reserved.reply
            if (reply !== undefined && 'answers' in reply)
              reply = {
                answers: answersForRequest(reserved.entry, reply.answers, request.questions),
              }
            await this.deps.reply(request.userInputId, reply)
          }),
        )
        outcome = 'taken'
        for (const result of results) {
          if (result.status !== 'rejected' || isPromptSettledError(result.reason)) continue
          outcome = 'uncertain'
          this.deps.failed()
        }
        await this.run(() => {
          for (const request of reserved.requests) this.requests.delete(request.userInputId)
          this.replying.delete(cardId)
          // Already durably marked. Retire the visible card only after every attempt settles.
          this.deps.changed({
            ...this.snapshot(),
            questions: [
              ...this.snapshot().questions,
              structuredClone({ ...reserved.entry, state: reserved.state }),
            ],
          })
        })
      } else if (reserved.reply !== undefined)
        outcome = await this.deps.deliver(
          lateAnswer(reserved.entry, reserved.reply, this.deps.formatAnswer),
        )
    } catch {
      this.deps.failed()
    }
    if (outcome === 'notTaken')
      await this.run(async () => {
        this.entries.set(cardId, reserved.entry)
        await this.publish()
      })
    return outcome
  }

  public dismiss(cardId: string): Promise<void> {
    return this.run(async () => {
      const entry = this.entries.get(cardId)
      if (entry?.state !== 'open') throw new Error(UI_TEXT.questionDismissFailed)
      this.entries.set(cardId, { ...entry, state: 'dismissed' })
      await this.publish()
    })
  }

  /** Consume before dispatch. Only proof of non-admission restores the queued notes. */
  public async takeDismissals(): Promise<{
    text: string
    finish: (outcome: QuestionDeliveryOutcome) => Promise<void>
  }> {
    const entries = await this.run(async () => {
      const cards = Array.from(this.entries.values(), (entry) => ({ ...entry }))
      const dismissed = cards.filter((entry) => entry.state === 'dismissed')
      for (const entry of dismissed) this.entries.delete(entry.userInputId)
      if (dismissed.length > 0) await this.publish()
      return dismissed
    })
    return {
      text: entries
        .map((entry) => fill(QUESTION_DELIVERY_MODEL_TEXT.dismissed, { id: entry.userInputId }))
        .join('\n'),
      finish: async (outcome) => {
        if (outcome === 'notTaken')
          await this.run(async () => {
            for (const entry of entries) this.entries.set(entry.userInputId, entry)
            await this.publish()
          })
      },
    }
  }

  public endTurn(
    turnId: string,
    wasStopped: boolean,
    hasApproval: boolean,
  ): Promise<OpenQuestion | undefined> {
    return this.run(async () => {
      if (this.endedTurns.has(turnId)) return
      this.endedTurns.add(turnId)
      const requests = Array.from(this.requests.values(), (request) => ({ ...request }))
      for (const request of requests) {
        if (request.turnId !== turnId) continue
        const entry = this.entries.get(request.cardId)
        if (entry?.state === 'waiting') {
          this.stopTimer(entry.userInputId)
          this.entries.set(entry.userInputId, {
            ...entry,
            state: wasStopped ? 'cancelled' : 'open',
            ...(!wasStopped && {
              deferredAt: entry.deferredAt ?? Math.max(entry.askedAt, this.deps.now()),
            }),
          })
        }
        this.requests.delete(request.userInputId)
      }
      this.expireOldest()
      const reminder = nextQuestionReminder(this.snapshot().questions, hasApproval)
      if (reminder !== undefined)
        this.entries.set(reminder.userInputId, { ...reminder, reminders: reminder.reminders + 1 })
      await this.publish()
      return reminder
    })
  }

  public async remove(): Promise<void> {
    await this.run(async () => {
      for (const id of this.timers.keys()) this.stopTimer(id)
      this.entries.clear()
      this.requests.clear()
      this.replying.clear()
      await this.deps.store.remove(this.sessionId)
      this.deps.changed(this.snapshot())
    })
    this.dispose()
  }

  public dispose(): void {
    this.isDisposed = true
    for (const id of this.timers.keys()) this.stopTimer(id)
  }
}

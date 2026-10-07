// M112 lane A: the agent owns the clock; the portable registry owns state,
// persistence, coalescing and exactly-once delivery. Cancellation is cooperative.
import type { AgentContext, CreateElicitationResponse } from '@agentclientprotocol/sdk'
import { isSteerRefusedError, type AgentSession, type TurnPart } from '../core/agent/agentBackend'
import type { AgentEvent } from '../shared/agentEvents'
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../shared/constants'
import { fill, formatNumber } from '../shared/l10n/text'
import type {
  OpenQuestion,
  OpenQuestionAnswer,
  QuestionClock,
  QuestionDelivery,
  QuestionDeliveryOutcome,
  QuestionReply,
} from '../shared/questions'
import { questionDeferSeconds } from '../shared/questionDeadline'
import { formAnswers, questionCommand, questionForm, questionsText } from './questions'

type QuestionRequest = Extract<AgentEvent, { type: 'questionRequested' }>

/** In-memory ownership only; durable answers remain queued until commit. */
export interface AcpQueuedAnswerLease {
  readonly token: symbol
  readonly parts: readonly TurnPart[]
}

/** Q/runtime integration: required, with no production substitute on the lane-0 base. */
export interface AcpQuestionRegistry {
  load(): Promise<void>
  /** Register without a second clock; return the canonical record, retaining a replay's deadline. */
  register(
    event: QuestionRequest,
    timing: { readonly askedAt: number; readonly deadlineAt?: number; readonly turnId?: string },
  ): Promise<OpenQuestion>
  /** Settle through AgentSession.deferQuestions; true only for a new open transition. */
  defer(userInputId: string): Promise<boolean>
  /** Settle every waiting request sharing this card; no user-message delivery. */
  replyWaiting(
    userInputId: string,
    reply: Exclude<QuestionReply, { kind: 'deferred' }>,
  ): Promise<void>
  list(): readonly OpenQuestion[]
  /** Validate against stored questions and mark before calling the supplied delivery port. */
  answer(
    userInputId: string,
    reply: OpenQuestionAnswer,
  ): Promise<QuestionDeliveryOutcome | undefined>
  settled(userInputId: string, outcome: string): void
  turnEnded(isCancelled: boolean): Promise<void>
  /** Persist idle answers before acknowledging them. Return taken only after the write. */
  queue(message: QuestionDelivery): Promise<QuestionDeliveryOutcome>
  /** Exclusive non-destructive peek; an empty queue needs no lease. */
  peekQueued(): Promise<AcpQueuedAnswerLease | undefined>
  /** Persist removal only after successful model submission. */
  commitQueued(token: symbol): Promise<void>
  /** Release ownership without writing or removing answers. */
  releaseQueued(token: symbol): Promise<void>
  dispose(): void
}

export type AcpQuestionRegistryFactory = (input: {
  readonly session: AgentSession
  readonly clock: QuestionClock
  readonly deliver: (message: QuestionDelivery) => Promise<QuestionDeliveryOutcome>
}) => AcpQuestionRegistry

interface Form {
  readonly event: QuestionRequest
  readonly registered: Promise<OpenQuestion>
  readonly controller: AbortController
  cancelTimer?: () => void
  cardId: string
  phase: 'waiting' | 'deferring' | 'open' | 'closed'
  deferral?: Promise<boolean>
}

export interface AcpQuestionDeferralDeps {
  readonly registry: AcpQuestionRegistry
  readonly clock: QuestionClock
  readonly seconds: number
  readonly session: AgentSession
  readonly notice: (text: string) => void
  /** Fresh ownership/turn snapshot after each asynchronous admission step. */
  readonly turn?: () => {
    readonly isReleased: boolean
    readonly isCancelled: boolean
    readonly turnId: string | undefined
    readonly starting: Promise<unknown> | undefined
  }
  /** Fixed diagnostic only; never the form, response or question text. */
  readonly failed: () => void
}

export class AcpQuestionDeferral {
  private readonly forms = new Map<string, Form>()
  private readonly numbers = new Map<string, number>()
  private nextNumber = 0
  private isDisposed = false
  private readonly queuedAnswers = new Set<string>()

  public constructor(private readonly deps: AcpQuestionDeferralDeps) {}

  private number(id: string): string {
    const live = new Set(
      this.deps.registry
        .list()
        .filter((record) => record.state === 'open' || record.state === 'waiting')
        .map((record) => record.userInputId),
    )
    for (const previous of this.numbers.keys()) {
      if (!live.has(previous)) this.numbers.delete(previous)
    }
    const existing = this.numbers.get(id)
    if (existing !== undefined) return formatNumber(existing)
    this.nextNumber += 1
    this.numbers.set(id, this.nextNumber)
    return formatNumber(this.nextNumber)
  }

  private async answerReply(
    id: string,
    reply: OpenQuestionAnswer,
    number?: string,
  ): Promise<string> {
    if (this.isDisposed) return UI_TEXT.questionAnswerFailed
    let outcome: QuestionDeliveryOutcome | undefined
    try {
      outcome = await this.deps.registry.answer(id, reply)
    } catch {
      this.deps.failed()
      return UI_TEXT.questionAnswerUncertain
    }
    switch (outcome) {
      case 'taken': {
        return this.queuedAnswers.has(id)
          ? UI_TEXT.acpQuestionAnswerQueued
          : UI_TEXT.announceLateAnswerSent
      }
      case 'uncertain': {
        return UI_TEXT.questionAnswerUncertain
      }
      case 'notTaken': {
        return UI_TEXT.questionAnswerFailed
      }
      case undefined: {
        return number === undefined
          ? UI_TEXT.questionNoOpen
          : fill(UI_TEXT.acpQuestionNotFound, { number })
      }
    }
  }

  private closed(form: Form): boolean {
    return this.isDisposed || form.phase === 'closed'
  }

  private defer(form: Form): Promise<boolean> {
    if (form.deferral !== undefined) return form.deferral
    if (this.isDisposed || form.phase !== 'waiting') return Promise.resolve(false)
    form.phase = 'deferring'
    // Registration may still be writing; defer must follow it, not race its disk write.
    form.deferral = this.deferRegistered(form)
    return form.deferral
  }

  private async deferRegistered(form: Form): Promise<boolean> {
    try {
      const record = await form.registered
      form.cardId = record.userInputId
      if (this.closed(form) || form.phase !== 'deferring') return false
      const isOpened = await this.deps.registry.defer(form.event.userInputId)
      if (this.closed(form)) return false
      form.phase = isOpened ? 'open' : 'closed'
      form.controller.abort()
      if (isOpened)
        this.deps.notice(fill(UI_TEXT.acpQuestionDeferred, { number: this.number(form.cardId) }))
      return isOpened
    } catch {
      await this.failDeferral(form)
      return false
    }
  }

  private async failDeferral(form: Form): Promise<void> {
    if (this.closed(form)) return
    form.phase = 'closed'
    form.cancelTimer?.()
    form.controller.abort()
    this.deps.failed()
    try {
      await this.deps.registry.replyWaiting(form.cardId, { kind: 'cancelled' })
    } catch {
      this.deps.failed()
      try {
        await this.deps.session.cancelQuestions(form.event.userInputId)
      } catch {
        this.deps.failed()
      }
    }
  }

  private async openAfterTurn(
    form: Form,
    opening: Promise<void>,
    previous: Promise<boolean> | undefined,
  ): Promise<boolean> {
    try {
      await previous
      await opening
      if (this.closed(form)) return false
      const record = this.deps.registry.list().find((entry) => entry.userInputId === form.cardId)
      const isOpen = record?.state === 'open'
      form.phase = isOpen ? 'open' : 'closed'
      return isOpen
    } catch {
      await this.failDeferral(form)
      return false
    }
  }

  public list(): string {
    const open = this.deps.registry.list().filter((question) => question.state === 'open')
    if (open.length === 0) return UI_TEXT.questionNoOpen
    return open
      .map((record) =>
        record.questions
          .map((question) =>
            fill(UI_TEXT.acpQuestionListEntry, {
              number: this.number(record.userInputId),
              header: question.header,
              question: question.question,
            }),
          )
          .join('\n'),
      )
      .join('\n')
  }

  public async answer(number: number, text: string): Promise<string> {
    // Assign stable, never-reused numbers even if /questions has not been run yet.
    this.list()
    let id: string | undefined
    for (const [candidate, assigned] of this.numbers) {
      if (assigned === number) id = candidate
    }
    return id === undefined
      ? fill(UI_TEXT.acpQuestionNotFound, { number: formatNumber(number) })
      : await this.answerReply(id, { explanation: text }, formatNumber(number))
  }

  public async command(text: string): Promise<string> {
    const command = questionCommand(text)
    if (command?.kind === 'list') return this.list()
    return command?.kind === 'answer'
      ? await this.answer(command.number, command.text)
      : UI_TEXT.acpQuestionAnswerUsage
  }

  public async askClient(
    event: QuestionRequest,
    client: AgentContext,
    hasForms: boolean,
    turnId: string | undefined,
  ): Promise<void> {
    if (!hasForms) {
      this.deps.notice(questionsText(event.questions))
      await this.ask(event, undefined, turnId)
      return
    }
    await this.ask(
      event,
      (cancellationSignal) =>
        client.request(
          'elicitation/create',
          {
            sessionId: this.deps.session.sessionId,
            mode: 'form',
            message: UI_TEXT.acpQuestionFormMessage,
            requestedSchema: questionForm(event.questions),
          },
          { cancellationSignal },
        ),
      turnId,
    )
  }

  public async deliver(message: QuestionDelivery): Promise<QuestionDeliveryOutcome> {
    let turn = this.deps.turn?.()
    if (turn === undefined || turn.isReleased || message.sessionId !== this.deps.session.sessionId)
      return 'notTaken'
    if (turn.turnId === undefined) {
      try {
        await turn.starting
      } catch {
        return 'uncertain'
      }
      turn = this.deps.turn?.()
    }
    if (turn === undefined || turn.isReleased) return 'notTaken'
    if (turn.turnId !== undefined && !turn.isCancelled) {
      try {
        await this.deps.session.steer(turn.turnId, [{ type: 'text', text: message.text }])
        return 'taken'
      } catch (error: unknown) {
        if (!isSteerRefusedError(error)) return 'uncertain'
      }
    }
    if (this.deps.turn?.().isReleased !== false) return 'notTaken'
    const outcome = await this.deps.registry.queue(message)
    if (outcome === 'taken') this.queuedAnswers.add(message.userInputId)
    return outcome
  }

  public sentQueued(): void {
    this.queuedAnswers.clear()
    this.deps.notice(UI_TEXT.announceLateAnswerSent)
  }

  /** No forms (and unattended callers) defer immediately, irrespective of seconds=0. */
  public async ask(
    event: QuestionRequest,
    request: ((signal: AbortSignal) => Promise<CreateElicitationResponse>) | undefined,
    turnId?: string,
  ): Promise<void> {
    if (this.isDisposed || this.forms.has(event.userInputId)) return
    const askedAt = this.deps.clock.now()
    const seconds = questionDeferSeconds(this.deps.seconds)
    if (seconds === undefined) throw new Error('Invalid ACP question deadline')
    let deadlineAt = seconds === 0 ? undefined : askedAt + seconds * MILLISECONDS_PER_SECOND
    if (request === undefined) deadlineAt = askedAt
    const form: Form = {
      event,
      registered: this.deps.registry.register(event, {
        askedAt,
        ...(deadlineAt !== undefined && { deadlineAt }),
        ...(turnId !== undefined && { turnId }),
      }),
      cardId: event.userInputId,
      controller: new AbortController(),
      phase: 'waiting',
    }
    this.forms.set(event.userInputId, form)
    let isRegistered = false
    try {
      const record = await form.registered
      isRegistered = true
      form.cardId = record.userInputId
      if (this.closed(form) || record.state !== 'waiting') return
      if (request === undefined) {
        await this.defer(form)
        return
      }
      for (const other of this.forms.values()) {
        if (
          other !== form &&
          other.cardId === form.cardId &&
          (other.phase === 'waiting' || other.phase === 'deferring')
        )
          return
      }
      if (record.deadlineAt !== undefined) {
        form.cancelTimer = this.deps.clock.setTimer(
          Math.max(0, record.deadlineAt - this.deps.clock.now()),
          () => {
            void this.defer(form)
          },
        )
      }
      const response = await request(form.controller.signal)
      if (this.closed(form)) return
      if (form.deferral !== undefined) await form.deferral
      if (this.closed(form)) return
      const answers = formAnswers(event.questions, response)
      if (form.phase === 'open') {
        if (answers !== undefined)
          this.deps.notice(await this.answerReply(form.cardId, { answers: [...answers] }))
        return
      }
      form.phase = 'closed'
      form.cancelTimer?.()
      try {
        await this.deps.registry.replyWaiting(
          form.cardId,
          answers === undefined
            ? { kind: 'cancelled' }
            : { kind: 'answered', answers: [...answers] },
        )
      } catch {
        this.deps.failed()
      }
    } catch {
      if (this.closed(form)) return
      // Withdrawal can reject the form promise; an open question stays answerable.
      if (form.deferral !== undefined) await form.deferral
      if (form.phase === 'open' || this.closed(form)) return
      form.phase = 'closed'
      form.cancelTimer?.()
      this.deps.failed()
      try {
        if (isRegistered) await this.deps.registry.replyWaiting(form.cardId, { kind: 'cancelled' })
        else await this.deps.session.cancelQuestions(event.userInputId)
      } catch {
        this.deps.failed()
      }
    } finally {
      form.cancelTimer?.()
      this.forms.delete(event.userInputId)
    }
  }

  public settled(id: string, outcome: string): void {
    this.deps.registry.settled(id, outcome)
    if (outcome === 'deferred') return
    const form = this.forms.get(id)
    if (form === undefined) {
      return
    }

    form.phase = 'closed'
    form.cancelTimer?.()
    form.controller.abort()
  }

  public async turnEnded(isCancelled: boolean): Promise<void> {
    const opening = this.deps.registry.turnEnded(isCancelled)
    for (const form of this.forms.values()) {
      form.cancelTimer?.()
      if (form.phase !== 'open' && form.phase !== 'closed') {
        if (isCancelled) form.phase = 'closed'
        else {
          form.phase = 'deferring'
          form.deferral = this.openAfterTurn(form, opening, form.deferral)
        }
      }
      form.controller.abort()
    }
    await opening
  }

  public dispose(): void {
    this.isDisposed = true
    for (const form of this.forms.values()) {
      form.phase = 'closed'
      form.cancelTimer?.()
      form.controller.abort()
    }
    this.forms.clear()
    this.deps.registry.dispose()
  }
}

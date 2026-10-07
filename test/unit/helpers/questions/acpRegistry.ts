// Test-only stand-in for Q's integration binding. These tests certify ACP,
// not the registry's disk adapter, normalization, coalescing or security.
import { vi } from 'vitest'
import type {
  AcpQuestionRegistry,
  AcpQuestionRegistryFactory,
} from '../../../../src/acp/questionDeferral'
import type { AgentEvent } from '../../../../src/shared/agentEvents'
import { QUESTION_DELIVERY_MODEL_TEXT } from '../../../../src/shared/constants'
import { fill } from '../../../../src/shared/l10n/text'
import type { OpenQuestion, QuestionDelivery } from '../../../../src/shared/questions'
import { questionFixture } from './fixtures'

function resolved(): Promise<void> {
  return Promise.resolve()
}

export class FakeAcpQuestionRegistry implements AcpQuestionRegistry {
  public readonly records = new Map<string, OpenQuestion>()
  public readonly queued: QuestionDelivery[] = []
  public readonly load = vi.fn(resolved)
  public readonly dispose = vi.fn()
  public readonly register = vi.fn<AcpQuestionRegistry['register']>((event, timing) => {
    const record = questionFixture({
      userInputId: event.userInputId,
      sessionId: this.input.session.sessionId,
      itemId: event.itemId,
      questions: [...event.questions],
      state: 'waiting',
      askedAt: timing.askedAt,
      deadlineAt: timing.deadlineAt,
      deferredAt: undefined,
    })
    this.records.set(event.userInputId, record)
    return Promise.resolve(record)
  })
  public readonly defer = vi.fn<AcpQuestionRegistry['defer']>(async (id) => {
    const record = this.records.get(id)
    if (record?.state !== 'waiting') return false
    await this.input.session.deferQuestions(id)
    this.records.set(id, {
      ...record,
      state: 'open',
      deferredAt: record.deadlineAt ?? record.askedAt,
    })
    return true
  })
  public readonly replyWaiting = vi.fn<AcpQuestionRegistry['replyWaiting']>(async (id, reply) => {
    if (reply.kind === 'answered') await this.input.session.answerQuestions(id, reply.answers)
    else if (reply.kind === 'clarified') await this.input.session.clarifyQuestions(id, reply.text)
    else await this.input.session.cancelQuestions(id)
    this.records.delete(id)
  })
  public readonly answer = vi.fn<AcpQuestionRegistry['answer']>(async (id, reply) => {
    const record = this.records.get(id)
    if (record?.state !== 'open') return undefined
    this.records.set(id, { ...record, state: 'answeredLater' })
    const result = await this.input.deliver({
      sessionId: this.input.session.sessionId,
      userInputId: id,
      displayText: undefined,
      text: fill(QUESTION_DELIVERY_MODEL_TEXT.lateAnswer, {
        id,
        question: record.questions.map((question) => question.question).join('\n'),
        answer:
          'answers' in reply ? `Answers:\n${JSON.stringify(reply.answers)}` : reply.explanation,
      }),
    })
    if (result === 'notTaken') this.records.set(id, record)
    return result
  })
  public readonly queue = vi.fn<AcpQuestionRegistry['queue']>((message) => {
    this.queued.push(message)
    return Promise.resolve('taken')
  })
  public readonly queuedParts = vi.fn<AcpQuestionRegistry['queuedParts']>(() =>
    Promise.resolve(this.queued.map((message) => ({ type: 'text', text: message.text }))),
  )
  public readonly acknowledgeQueued = vi.fn<AcpQuestionRegistry['acknowledgeQueued']>((outcome) => {
    if (outcome !== 'notTaken') this.queued.length = 0
    return Promise.resolve()
  })
  public readonly turnEnded = vi.fn<AcpQuestionRegistry['turnEnded']>((isCancelled) => {
    for (const [id, record] of this.records) {
      if (record.state === 'waiting')
        this.records.set(id, {
          ...record,
          state: isCancelled ? 'cancelled' : 'open',
          ...(!isCancelled && { deferredAt: record.askedAt }),
        })
    }
    return Promise.resolve()
  })

  public constructor(
    private readonly input: Pick<Parameters<AcpQuestionRegistryFactory>[0], 'session' | 'deliver'>,
  ) {}

  public list(): readonly OpenQuestion[] {
    const records: OpenQuestion[] = []
    for (const record of this.records.values()) records.push(record)
    return records
  }

  public settled(id: string, outcome: string): void {
    const record = this.records.get(id)
    if (record === undefined || !['answered', 'cancelled', 'clarified'].includes(outcome)) return
    this.records.delete(id)
  }
}

/** Existing ACP tests use a test-only shim until Q binds full fake sessions. */
export function fakeAcpQuestions(
  input: Parameters<AcpQuestionRegistryFactory>[0],
): AcpQuestionRegistry {
  if (typeof input.session.deferQuestions !== 'function') {
    Object.defineProperty(input.session, 'deferQuestions', {
      value: vi.fn(() => Promise.resolve()),
    })
  }
  return new FakeAcpQuestionRegistry(input)
}

export function acpQuestionEvent(id = 'q-1'): Extract<AgentEvent, { type: 'questionRequested' }> {
  const record = questionFixture({ userInputId: id })
  return {
    type: 'questionRequested',
    userInputId: id,
    itemId: record.itemId,
    questions: record.questions,
  }
}

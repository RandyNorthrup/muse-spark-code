import type {
  AcpQueuedAnswerLease,
  AcpQuestionRegistry,
  AcpQuestionRegistryFactory,
} from '../../acp/questionDeferral'
import type {
  QuestionDelivery,
  QuestionDeliveryOutcome,
  OpenQuestionsSnapshot,
} from '../../shared/questions'
import { OPEN_QUESTIONS_MAX, UI_TEXT } from '../../shared/constants'
import { QuestionRegistry } from '../../core/questions/registry'
import { questionAnswerText } from '../../core/questions/lateAnswer'
import { createQuestionQueueStore, createQuestionStore } from './questionStore'
import path from 'node:path'
import { isPromptSettledError } from '../../core/agent/agentBackend'

/** Concrete ACP binding. Forms own the timer; the registry owns every durable transition. */
export function createRuntimeQuestionRegistry(
  input: Parameters<AcpQuestionRegistryFactory>[0],
  directory: string,
  backend: 'museCode' | 'modelApi',
  failed: () => void,
): AcpQuestionRegistry & { flush(): Promise<void> } {
  const { session, clock } = input
  const queueStore = createQuestionQueueStore(path.join(directory, 'queued'))
  let queued: QuestionDelivery[] = []
  let lease: AcpQueuedAnswerLease | undefined
  let turnId: string | undefined
  const queueLoaded = (async () => {
    queued = await queueStore.load(session.sessionId)
  })()
  let tail = queueLoaded
  void queueLoaded.catch(failed)
  const write = <T>(work: () => T | Promise<T>): Promise<T> => {
    const previous = tail
    const result = (async () => {
      await previous
      await queueLoaded
      return await work()
    })()
    tail = (async () => {
      try {
        await result
      } catch {
        /* Keep later writes usable; the caller receives the rejection. */ failed()
      }
    })()
    return result
  }
  let published: OpenQuestionsSnapshot | undefined
  const aliases = new Map<string, string>()
  const failedDeferrals = new Set<string>()
  const registry = new QuestionRegistry(session.sessionId, backend, {
    store: createQuestionStore(directory),
    now: () => clock.now(),
    setTimer: (ms, callback) => clock.setTimer(ms, callback),
    hasExternalTimer: true,
    deferQuestions: async (id) => {
      try {
        await session.deferQuestions(id)
      } catch (error: unknown) {
        if (!isPromptSettledError(error)) {
          failedDeferrals.add(aliases.get(id) ?? id)
          try {
            await session.cancelQuestions(id)
          } catch {
            // Report a failed fallback without exposing the backend's text.
            failed()
          }
        }
        throw error
      }
    },
    formatAnswer: questionAnswerText,
    deliver: input.deliver,
    reply: (id, reply) => {
      if (reply === undefined) return session.cancelQuestions(id)
      return 'answers' in reply
        ? session.answerQuestions(id, reply.answers)
        : session.clarifyQuestions(id, reply.explanation)
    },
    changed: (snapshot) => {
      published = snapshot
    },
    failed,
  })
  // Loading begins in the constructor; observe failures before ACP's later replay setup.
  void registry.ready().catch(failed)
  const card = (id: string) =>
    registry.snapshot().questions.find((entry) => entry.userInputId === id)
  return {
    async load() {
      await registry.ready()
      await tail
    },
    async register(event, timing) {
      turnId = timing.turnId ?? turnId
      if (turnId === undefined) throw new Error(UI_TEXT.questionAnswerFailed)
      const record = await registry.register({ ...event, turnId }, 0, false, timing)
      aliases.set(event.userInputId, record.userInputId)
      return record
    },
    async defer(id) {
      const cardId = aliases.get(id) ?? id
      if (card(cardId)?.state !== 'waiting') return false
      await registry.defer(cardId)
      if (failedDeferrals.delete(cardId)) throw new Error(UI_TEXT.questionAnswerFailed)
      return card(cardId)?.state === 'open'
    },
    async replyWaiting(id, reply) {
      const cardId = aliases.get(id) ?? id
      if (card(cardId)?.state !== 'waiting') throw new Error(UI_TEXT.answerNotAccepted)
      if (reply.kind === 'cancelled') await registry.answer(cardId, undefined)
      else
        await registry.answer(
          cardId,
          reply.kind === 'answered' ? { answers: [...reply.answers] } : { explanation: reply.text },
        )
    },
    list: () =>
      (published ?? registry.snapshot()).questions.filter((entry) =>
        ['waiting', 'open', 'dismissed'].includes(entry.state),
      ),
    async answer(id, reply) {
      return card(id)?.state === 'open' ? await registry.answer(id, reply) : undefined
    },
    settled(id, outcome) {
      void registry.settle(id, outcome).catch(failed)
    },
    async turnEnded(isCancelled) {
      if (turnId !== undefined) await registry.endTurn(turnId, isCancelled, true)
    },
    queue: (message) =>
      write(async (): Promise<QuestionDeliveryOutcome> => {
        if (message.sessionId !== session.sessionId || queued.length >= OPEN_QUESTIONS_MAX)
          return 'notTaken'
        const next = [...queued, message]
        await queueStore.save(session.sessionId, next)
        queued = next
        return 'taken'
      }),
    peekQueued: () =>
      write(() => {
        if (lease !== undefined) throw new Error(UI_TEXT.questionQueueLeaseFailed)
        if (queued.length === 0) return
        lease = {
          token: Symbol(),
          parts: queued.map((message) => ({ type: 'text', text: message.text })),
        }
        return lease
      }),
    commitQueued: (token) =>
      write(async () => {
        if (lease?.token !== token) throw new Error(UI_TEXT.questionQueueLeaseFailed)
        const remaining = queued.slice(lease.parts.length)
        try {
          await queueStore.save(session.sessionId, remaining)
          queued = remaining
        } finally {
          // A failed write retains the durable prefix, but must not strand ownership.
          lease = undefined
        }
      }),
    releaseQueued: (token) =>
      write(() => {
        if (lease?.token !== token) throw new Error(UI_TEXT.questionQueueLeaseFailed)
        lease = undefined
      }),
    dispose() {
      void write(async () => {
        if (turnId !== undefined) await registry.endTurn(turnId, false, true)
        registry.dispose()
      }).catch(failed)
    },
    async flush() {
      await registry.ready()
      await tail
    },
  }
}

export async function removeRuntimeQuestions(directory: string, sessionId: string): Promise<void> {
  await createQuestionStore(directory).remove(sessionId)
  await createQuestionQueueStore(path.join(directory, 'queued')).remove(sessionId)
}

import { vi } from 'vitest'
import {
  QuestionRegistry,
  type QuestionRegistryDeps,
} from '../../../../src/core/questions/registry'
import { questionResultText } from '../../../../src/core/backends/modelapi/ModelApiHost'
import type { OpenQuestionAnswer, OpenQuestionsSnapshot } from '../../../../src/shared/questions'
import { FakeQuestionClock } from './clock'
import { FakeQuestionStore } from './store'
import { ScriptedQuestionSession } from './session'
import { questionFixture } from './fixtures'

export function questionAnswerText(reply: OpenQuestionAnswer): string {
  return questionResultText(
    'answers' in reply
      ? { kind: 'answered', answers: reply.answers }
      : { kind: 'clarified', text: reply.explanation },
  )
}

export function registryHarness(store = new FakeQuestionStore()) {
  const clock = new FakeQuestionClock()
  const session = new ScriptedQuestionSession('session-1', 'muse-spark-1.3')
  const snapshots: OpenQuestionsSnapshot[] = []
  const port: QuestionRegistryDeps = {
    store,
    now: () => clock.now(),
    setTimer: (delay, callback) => clock.setTimer(delay, callback),
    deferQuestions: (id) => session.deferQuestions(id),
    deliver: vi.fn(() => Promise.resolve('taken' as const)),
    formatAnswer: questionAnswerText,
    reply: vi.fn((id: string, reply: OpenQuestionAnswer | undefined) => {
      if (reply === undefined) return session.cancelQuestions(id)
      const response =
        'answers' in reply
          ? session.answerQuestions(id, reply.answers)
          : session.clarifyQuestions(id, reply.explanation)
      return response
    }),
    changed: (snapshot) => {
      snapshots.push(structuredClone(snapshot))
    },
    failed: vi.fn(),
  }
  const registry = new QuestionRegistry('session-1', 'modelApi', port)
  const register = (
    id = 'q-1',
    seconds = 60,
    isImmediate = false,
    text = 'Which colour?',
    turnId = 'turn-1',
  ) =>
    registry.register(
      {
        userInputId: id,
        itemId: `item-${id}`,
        turnId,
        questions: questionFixture().questions.map((question) => ({ ...question, question: text })),
      },
      seconds,
      isImmediate,
    )
  return { clock, store, session, port, snapshots, registry, register }
}

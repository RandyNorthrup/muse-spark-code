// Crowded-out questions are said, never silently forgotten: deferring past
// the open cap expires the oldest open card, keeps its text on the card,
// and reports the expired card with the cap through onExpired. Real
// QuestionRegistry over its real file store; only the clock the registry
// requires is controlled.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { QuestionRegistry } from '../../src/core/questions/registry'
import { createQuestionStore } from '../../src/runtime/questions/questionStore'
import { OPEN_QUESTIONS_MAX } from '../../src/shared/constants'
import type { Question } from '../../src/shared/agentEvents'

function question(index: number): Question {
  return {
    id: `colour-${String(index)}`,
    header: 'Colour',
    question: `Which colour number ${String(index)}?`,
    selection: { mode: 'single' },
    options: [{ label: 'Blue' }],
  }
}

const cancelTimer = (): void => undefined
const noTimer = (): (() => void) => cancelTimer

describe('question expiry past the open cap', () => {
  const clock = { now: 0 }
  const now = (): number => clock.now

  it('expires the oldest open card, keeps its text, and reports it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rllimits-questions-'))
    try {
      const expired: { userInputId: string; max: number }[] = []
      const registry = new QuestionRegistry('s1', 'modelApi', {
        store: createQuestionStore(directory),
        now,
        setTimer: noTimer,
        deferQuestions: () => Promise.resolve(),
        reply: () => Promise.resolve(),
        changed: () => undefined,
        failed: () => undefined,
        deliver: () => Promise.resolve('taken'),
        formatAnswer: () => 'answer',
        onExpired: (cards, max) => {
          for (const card of cards) expired.push({ userInputId: card.userInputId, max })
        },
      })
      for (let index = 0; index <= OPEN_QUESTIONS_MAX; index += 1) {
        const id = `q-${String(index)}`
        clock.now = index
        await registry.register(
          {
            userInputId: id,
            itemId: `item-${String(index)}`,
            turnId: 't1',
            questions: [question(index)],
          },
          0,
        )
        await registry.defer(id)
      }
      await registry.ready()
      expect(expired).toEqual([{ userInputId: 'q-0', max: OPEN_QUESTIONS_MAX }])
      const snapshot = registry.snapshot()
      const first = snapshot.questions.find((entry) => entry.userInputId === 'q-0')
      expect(first?.state).toBe('expired')
      expect(first?.questions[0]?.question).toContain('number 0')
      expect(snapshot.questions.filter((entry) => entry.state === 'open')).toHaveLength(
        OPEN_QUESTIONS_MAX,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

// B22: load real owner-only records, then check retained text and notices.
// No backend/session stands in: any attempt to answer or defer is an error.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { QuestionRegistry } from '../../src/core/questions/registry'
import { questionAnswerText } from '../../src/core/questions/lateAnswer'
import { questionKey } from '../../src/core/questions/key'
import { createQuestionStore } from '../../src/runtime/questions/questionStore'
import { OPEN_QUESTIONS_MAX } from '../../src/shared/constants'
import {
  openQuestionStoreSchema,
  type OpenQuestion,
  type OpenQuestionsSnapshot,
} from '../../src/shared/questions'

function unexpected(): never {
  throw new Error('load-only retention must not call a backend or deliver an answer')
}

function waiting(index: number): OpenQuestion {
  const id = String(index)
  const questions = [
    {
      id: `c-${id}`,
      header: `Header ${id}`,
      question: `Question ${id} text`,
      selection: { mode: 'single' as const },
      options: [],
    },
  ]
  return {
    userInputId: `q-${id}`,
    itemId: `item-${id}`,
    turnId: 't1',
    sessionId: 'session-1',
    questions,
    key: questionKey(questions),
    state: 'waiting',
    askedAt: index,
    reminders: 0,
    backend: 'modelApi',
  }
}

describe('question expiry retains real stored records', () => {
  let directory = ''
  afterEach(() => {
    if (directory !== '') rmSync(directory, { recursive: true, force: true })
  })

  function load(
    changed: OpenQuestionsSnapshot[],
    expired: OpenQuestion[][],
    durableAtNotice: boolean[],
  ) {
    return new QuestionRegistry('session-1', 'modelApi', {
      store: createQuestionStore(directory),
      now: Date.now,
      setTimer: unexpected,
      deferQuestions: unexpected,
      reply: unexpected,
      deliver: unexpected,
      formatAnswer: questionAnswerText,
      failed: unexpected,
      changed: (snapshot) => {
        changed.push(snapshot)
      },
      onExpired: (cards) => {
        expired.push([...cards])
        const saved = openQuestionStoreSchema.parse(
          JSON.parse(readFileSync(path.join(directory, 'session-1.json'), 'utf8')),
        )
        durableAtNotice.push(
          cards.every((card) =>
            saved.snapshot.questions.some(
              (entry) => entry.userInputId === card.userInputId && entry.state === 'expired',
            ),
          ),
        )
      },
    })
  }

  it('retains crowded-out text on disk, publishes it and announces it once across reload', async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'b22-questions-'))
    const store = createQuestionStore(directory)
    await store.save(
      'session-1',
      Array.from({ length: OPEN_QUESTIONS_MAX + 1 }, (_, i) => waiting(i)),
    )
    const changed: OpenQuestionsSnapshot[] = []
    const expired: OpenQuestion[][] = []
    const durableAtNotice: boolean[] = []
    const registry = load(changed, expired, durableAtNotice)
    await registry.ready()
    const crowded = registry.snapshot().questions.find((entry) => entry.userInputId === 'q-0')
    expect(crowded).toMatchObject({
      state: 'expired',
      questions: [{ question: 'Question 0 text' }],
    })
    expect(registry.snapshot().questions.filter((entry) => entry.state === 'open')).toHaveLength(
      OPEN_QUESTIONS_MAX,
    )
    expect(changed.at(-1)?.questions).toContainEqual(crowded)
    expect(expired.flat().map((entry) => entry.userInputId)).toEqual(['q-0'])
    expect(await store.load('session-1')).toContainEqual(crowded)
    expect(durableAtNotice).toEqual([true])
    registry.dispose()
    const reloaded = load(changed, expired, durableAtNotice)
    await reloaded.ready()
    expect(reloaded.snapshot().questions).toContainEqual(crowded)
    expect(expired.flat().map((entry) => entry.userInputId)).toEqual(['q-0'])
    reloaded.dispose()
  })
})

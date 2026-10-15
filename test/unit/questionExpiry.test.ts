// B22: the oldest open questions must never vanish silently past the open
// cap. Expired cards stay readable (memory and store) and the surface is
// told once, at that moment. Real registry over a real temporary folder,
// values passed in as data.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { QuestionRegistry } from '../../src/core/questions/registry'
import { questionAnswerText } from '../../src/core/questions/lateAnswer'
import { createQuestionStore } from '../../src/runtime/questions/questionStore'
import { OPEN_QUESTIONS_MAX, UI_TEXT } from '../../src/shared/constants'
import { plural } from '../../src/shared/l10n/text'
import type {
  OpenQuestion,
  OpenQuestionsSnapshot,
  QuestionDeliveryOutcome,
} from '../../src/shared/questions'

function request(index: number) {
  const number = String(index)
  return {
    userInputId: `q-${number}`,
    itemId: `item-${number}`,
    turnId: 't1',
    questions: [
      {
        id: `c-${number}`,
        header: `Header ${number}`,
        question: `Question ${number} text`,
        selection: { mode: 'single' as const },
        options: [],
      },
    ],
  }
}

describe('question expiry past the open cap', () => {
  let directory = ''
  afterEach(() => {
    if (directory !== '') rmSync(directory, { recursive: true, force: true })
  })

  async function twentyOneOpen() {
    directory = mkdtempSync(path.join(tmpdir(), 'b22-questions-'))
    const changed: OpenQuestionsSnapshot[] = []
    const expired: OpenQuestion[][] = []
    const registry = new QuestionRegistry('session-1', 'modelApi', {
      store: createQuestionStore(directory),
      now: () => 1000,
      setTimer: (ms, callback) => {
        const handle = setTimeout(callback, ms)
        return () => {
          clearTimeout(handle)
        }
      },
      deferQuestions: () => Promise.resolve(),
      formatAnswer: questionAnswerText,
      reply: () => Promise.resolve(),
      deliver: (): Promise<QuestionDeliveryOutcome> => Promise.resolve('notTaken'),
      changed: (snapshot) => {
        changed.push(snapshot)
      },
      failed: () => {
        throw new Error('expiry must not fail')
      },
      onExpired: (cards) => {
        expired.push([...cards])
      },
    })
    await registry.ready()
    for (let index = 0; index <= OPEN_QUESTIONS_MAX; index += 1) {
      await registry.register(request(index), 0)
      await registry.defer(`q-${String(index)}`)
    }
    return { registry, changed, expired }
  }

  it('retains the crowded-out card with its text instead of forgetting it', async () => {
    const { registry } = await twentyOneOpen()
    const questions = registry.snapshot().questions
    expect(questions.filter((entry) => entry.state === 'open')).toHaveLength(OPEN_QUESTIONS_MAX)
    const crowded = questions.filter((entry) => entry.state === 'expired')
    expect(crowded.map((entry) => entry.userInputId)).toEqual(['q-0'])
    expect(crowded[0]?.questions[0]?.question).toBe('Question 0 text')
  })

  it('tells the surface once, at that moment, with the surviving count', async () => {
    const { expired } = await twentyOneOpen()
    expect(expired).toHaveLength(1)
    expect(expired[0]?.map((entry) => entry.userInputId)).toEqual(['q-0'])
    const notice = plural(UI_TEXT.questionsExpiredNotice, expired[0]?.length ?? 0, {
      max: OPEN_QUESTIONS_MAX,
    })
    expect(notice).toContain('newest')
    expect(notice).toContain(String(OPEN_QUESTIONS_MAX))
    expect(notice).toContain('card')
  })

  it('publishes the expired card so the panel receives it', async () => {
    const { changed } = await twentyOneOpen()
    const last = changed.at(-1)
    expect(last?.questions.find((entry) => entry.userInputId === 'q-0')?.state).toBe('expired')
  })

  it('keeps the expired card across a reload', async () => {
    const { registry } = await twentyOneOpen()
    const reloaded = new QuestionRegistry('session-1', 'modelApi', {
      store: createQuestionStore(directory),
      now: () => 2000,
      setTimer: (ms, callback) => {
        const handle = setTimeout(callback, ms)
        return () => {
          clearTimeout(handle)
        }
      },
      deferQuestions: () => Promise.resolve(),
      formatAnswer: questionAnswerText,
      reply: () => Promise.resolve(),
      deliver: (): Promise<QuestionDeliveryOutcome> => Promise.resolve('notTaken'),
      changed: () => undefined,
      failed: () => {
        throw new Error('reload must not fail')
      },
    })
    await reloaded.ready()
    const crowded = reloaded.snapshot().questions.find((entry) => entry.userInputId === 'q-0')
    expect(crowded?.state).toBe('expired')
    expect(crowded?.questions[0]?.question).toBe('Question 0 text')
    expect(registry.snapshot().questions).toHaveLength(OPEN_QUESTIONS_MAX + 1)
  })
})

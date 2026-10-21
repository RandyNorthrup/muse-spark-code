// The deferral wait honors the seconds the person set, however long: a
// deadline past one timer's reach (2^31-1 ms) re-arms in timer-sized pieces
// instead of firing the first piece at once, and defers only at the
// deadline. Drives the real QuestionRegistry over its real file store; only
// the clock its signature requires is controlled (the host passes the
// setTimeout versions).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { QuestionRegistry, questionDeferSeconds } from '../../src/core/questions/registry'
import { createQuestionStore } from '../../src/runtime/questions/questionStore'
import {
  MILLISECONDS_PER_SECOND,
  QUESTION_DEFER_DEFAULT_SECONDS,
  TIMER_MAX_DELAY_MS,
} from '../../src/shared/constants'
import type { Question } from '../../src/shared/agentEvents'

interface PendingPiece {
  readonly delayMs: number
  readonly fire: () => void
  revoked: boolean
}

/**
Waits on the registry's own events (a timer armed, a deferral delivered, a
change published), never on a clock of ours: a loaded runner finishes the
file-store work late, and a fixed sleep read that as no deferral.
*/
function eventWaiter() {
  const waiting: (() => void)[] = []
  return {
    notify: () => {
      for (const check of waiting.splice(0)) check()
    },
    until: (isReady: () => boolean) =>
      new Promise<void>((resolve) => {
        const check = (): void => {
          if (isReady()) resolve()
          else waiting.push(check)
        }
        check()
      }),
  }
}

describe('question deferral with no ceiling of ours', () => {
  it('takes any whole number of seconds as set and defaults what is not a count', () => {
    expect(questionDeferSeconds(0)).toBe(0)
    expect(questionDeferSeconds(1)).toBe(1)
    expect(questionDeferSeconds(3601)).toBe(3601)
    expect(questionDeferSeconds(100_000)).toBe(100_000)
    expect(questionDeferSeconds(NaN)).toBe(QUESTION_DEFER_DEFAULT_SECONDS)
    expect(questionDeferSeconds(-5)).toBe(QUESTION_DEFER_DEFAULT_SECONDS)
    expect(questionDeferSeconds(1.5)).toBe(QUESTION_DEFER_DEFAULT_SECONDS)
  })

  it('re-arms a wait past one timer range and defers only at the deadline', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nolimitsq-questions-'))
    try {
      let clockMs = 0
      const pieces: PendingPiece[] = []
      const deferred: string[] = []
      const failures: unknown[] = []
      const events = eventWaiter()
      const registry = new QuestionRegistry('s1', 'modelApi', {
        store: createQuestionStore(directory),
        now: () => clockMs,
        setTimer: (delayMs: number, callback: () => void) => {
          const piece: PendingPiece = { delayMs, fire: callback, revoked: false }
          pieces.push(piece)
          events.notify()
          return () => {
            piece.revoked = true
          }
        },
        deferQuestions: (userInputId: string) => {
          deferred.push(userInputId)
          events.notify()
          return Promise.resolve()
        },
        reply: () => Promise.resolve(),
        changed: () => {
          events.notify()
        },
        failed: () => {
          failures.push(new Error('registry failed'))
        },
        deliver: () => Promise.resolve('taken'),
        formatAnswer: () => 'answer',
      })
      const questions: readonly Question[] = [
        {
          id: 'colour',
          header: 'Colour',
          question: 'Which colour?',
          selection: { mode: 'single' },
          options: [{ label: 'Blue' }],
        },
      ]
      const seconds = Math.floor(TIMER_MAX_DELAY_MS / MILLISECONDS_PER_SECOND) + 5
      const entry = await registry.register(
        { userInputId: 'q-1', itemId: 'i-1', turnId: 't-1', questions },
        seconds,
      )
      const deadlineAt = entry.deadlineAt
      expect(deadlineAt).toBe(seconds * MILLISECONDS_PER_SECOND)
      expect(entry.state).toBe('waiting')
      // The first piece spans exactly one timer's reach, not the whole wait.
      expect(pieces).toHaveLength(1)
      expect(pieces[0]?.delayMs).toBe(TIMER_MAX_DELAY_MS)

      // One plain timer would have fired after 1 ms here; the first piece
      // reaching its end only re-arms toward the still-ahead deadline.
      clockMs += TIMER_MAX_DELAY_MS
      pieces[0]?.fire()
      await events.until(() => pieces.length === 2)
      expect(deferred).toEqual([])
      expect(registry.snapshot().questions[0]?.state).toBe('waiting')
      expect(pieces).toHaveLength(2)
      expect(pieces[1]?.delayMs).toBe((deadlineAt ?? 0) - clockMs)

      clockMs = deadlineAt ?? clockMs
      pieces[1]?.fire()
      await events.until(
        () => deferred.length > 0 && registry.snapshot().questions[0]?.state === 'open',
      )
      expect(deferred).toEqual(['q-1'])
      expect(registry.snapshot().questions[0]?.state).toBe('open')
      expect(failures).toEqual([])
      registry.dispose()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

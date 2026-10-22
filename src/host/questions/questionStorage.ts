import path from 'node:path'
import { createQuestionStore } from '../../runtime/questions/questionStore'
import type { QuestionClock, QuestionStore } from '../../shared/questions'

/** Private storage loads with conversation.js, outside the workspace. */
export function createHostQuestionStore(globalStoragePath: string): QuestionStore {
  return createQuestionStore(path.join(globalStoragePath, 'questions'))
}

export function questionClock(): QuestionClock {
  return {
    now: () => Date.now(),
    setTimer(delayMs, callback) {
      const timer = setTimeout(callback, delayMs)
      return () => {
        clearTimeout(timer)
      }
    },
  }
}

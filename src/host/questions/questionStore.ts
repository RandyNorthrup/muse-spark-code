import * as vscode from 'vscode'
import { questionDeferSeconds, questionMaxOpen } from '../../shared/questionDeadline'
import {
  OPEN_QUESTIONS_MAX,
  QUESTION_DEFER_DEFAULT_SECONDS,
  QUESTION_DEFER_SETTING,
  QUESTION_DEFER_MAX_SECONDS,
  QUESTION_MAX_OPEN_SETTING,
  SETTINGS_SECTION,
} from '../../shared/constants'
import type { QuestionClock } from '../../shared/questions'

/** Machine scope deliberately excludes values supplied by a repository or workspace folder. */
export function questionsDeferAfterSeconds(): number {
  const setting = vscode.workspace
    .getConfiguration(SETTINGS_SECTION)
    .inspect<unknown>(QUESTION_DEFER_SETTING)
  const value = setting?.globalValue
  return (
    questionDeferSeconds(
      typeof value === 'number'
        ? Math.min(QUESTION_DEFER_MAX_SECONDS, Math.max(0, value))
        : QUESTION_DEFER_DEFAULT_SECONDS,
    ) ?? QUESTION_DEFER_DEFAULT_SECONDS
  )
}

/** Machine scope deliberately excludes values supplied by a repository or workspace folder. */
export function questionsMaxOpenQuestions(): number {
  const setting = vscode.workspace
    .getConfiguration(SETTINGS_SECTION)
    .inspect<unknown>(QUESTION_MAX_OPEN_SETTING)
  const value = setting?.globalValue
  return questionMaxOpen(typeof value === 'number' ? value : OPEN_QUESTIONS_MAX)
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

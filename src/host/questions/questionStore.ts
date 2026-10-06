import * as vscode from 'vscode'
import path from 'node:path'
import { createQuestionStore } from '../../runtime/questions/questionStore'
import { questionDeferSeconds } from '../../core/questions/registry'
import {
  QUESTION_DEFER_DEFAULT_SECONDS,
  QUESTION_DEFER_SETTING,
  SETTINGS_SECTION,
} from '../../shared/constants'
import type { QuestionClock, QuestionStore } from '../../shared/questions'

/** Machine scope deliberately excludes values supplied by a repository or workspace folder. */
export function questionsDeferAfterSeconds(): number {
  const setting = vscode.workspace
    .getConfiguration(SETTINGS_SECTION)
    .inspect<unknown>(QUESTION_DEFER_SETTING)
  const value = setting?.globalValue
  return questionDeferSeconds(typeof value === 'number' ? value : QUESTION_DEFER_DEFAULT_SECONDS)
}

/** Bound at activation by the integration lane; no question text is placed in workspace storage. */
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

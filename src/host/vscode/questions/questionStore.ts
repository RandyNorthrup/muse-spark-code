import * as vscode from 'vscode'
import { questionDeferSeconds } from '../../../shared/questionDeadline'
import {
  QUESTION_DEFER_DEFAULT_SECONDS,
  QUESTION_DEFER_SETTING,
  SETTINGS_SECTION,
} from '../../../shared/constants'

/** Machine scope deliberately excludes values supplied by a repository or workspace folder. */
export function questionsDeferAfterSeconds(): number {
  const setting = vscode.workspace
    .getConfiguration(SETTINGS_SECTION)
    .inspect<unknown>(QUESTION_DEFER_SETTING)
  const value = setting?.globalValue
  return (
    questionDeferSeconds(typeof value === 'number' ? value : QUESTION_DEFER_DEFAULT_SECONDS) ??
    QUESTION_DEFER_DEFAULT_SECONDS
  )
}

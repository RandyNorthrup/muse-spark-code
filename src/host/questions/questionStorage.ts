import path from 'node:path'
import { createQuestionStore } from '../../runtime/questions/questionStore'
import type { QuestionStore } from '../../shared/questions'

/** Private storage loads with conversation.js, outside the workspace. */
export function createHostQuestionStore(globalStoragePath: string): QuestionStore {
  return createQuestionStore(path.join(globalStoragePath, 'questions'))
}

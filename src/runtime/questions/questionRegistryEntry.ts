import {
  createRuntimeQuestionRegistry as runtimeRegistry,
  removeRuntimeQuestions as removeQuestions,
} from './acpRegistry'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

export async function removeRuntimeQuestions(
  directory: string,
  sessionId: string,
  table: UiText,
  locale: string,
): Promise<void> {
  setUiText(table, locale)
  await removeQuestions(directory, sessionId)
}

export function createRuntimeQuestionRegistry(
  input: Parameters<typeof runtimeRegistry>[0],
  directory: string,
  backend: Parameters<typeof runtimeRegistry>[2],
  failed: () => void,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  return runtimeRegistry(input, directory, backend, failed)
}

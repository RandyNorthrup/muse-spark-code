// Lazy input bundle owns its installed-language state, like every Node bundle.
import {
  createSessionReportReader as sessionReader,
  createUsageReportReader as usageReader,
} from './reportInputs'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export {
  createReportJournalReader,
  readHostReportSession,
  readStoredReportSession,
  readUsageReportJournal,
  reportTimezoneOffset,
  type SessionHistoryInput,
} from './reportInputs'
export function createSessionReportReader(
  input: Parameters<typeof sessionReader>[0],
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  return sessionReader(input)
}
export function createUsageReportReader(
  input: Parameters<typeof usageReader>[0],
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  return usageReader(input)
}

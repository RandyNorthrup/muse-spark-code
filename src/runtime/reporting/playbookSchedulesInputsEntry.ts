// Lazy input bundle owns its installed-language state, like every Node bundle.
import {
  createPlaybookReportOrder as playbookOrder,
  createPlaybookReportReader as playbookReader,
  createSchedulesReportReader as schedulesReader,
} from './playbookSchedulesInputs'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export function createPlaybookReportReader(
  input: Parameters<typeof playbookReader>[0],
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  return playbookReader(input)
}
export function createPlaybookReportOrder(
  input: Parameters<typeof playbookOrder>[0],
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  return playbookOrder(input)
}
export function createSchedulesReportReader(
  input: Parameters<typeof schedulesReader>[0],
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  return schedulesReader(input)
}

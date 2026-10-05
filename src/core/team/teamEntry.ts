// The Model API team's tools and roster load only for a team conversation (D6).
import * as tools from './teamTools'
import * as roster from './roster'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export function createTeamRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return { ...tools, ...roster }
}

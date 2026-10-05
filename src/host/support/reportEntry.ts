// The report dialog's bundle (M93, PLAN.md D6, D72): esbuild builds this file
// into dist/report.js, which the conversation controller imports the first
// time the dialog opens, so the report builder, its second scrub, the export
// paths and the dialog's handler stay out of the bundle VS Code loads at
// activation. The flight recorder itself stays there: it records from the
// first moment. The bundle keeps its own installed-language state, so the
// factory installs the caller's table before anything reads it.

import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import {
  createReportProblemHandler as createHandler,
  type ReportProblemHandlerDeps,
} from '../conversation/reportProblemHandler'

/** The dialog's handler for one surface, in the caller's display language. */
export function createReportProblemHandler(
  deps: ReportProblemHandlerDeps,
  table: UiText,
  locale: string,
): ReturnType<typeof createHandler> {
  setUiText(table, locale)
  return createHandler(deps)
}

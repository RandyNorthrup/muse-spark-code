// The report fallback's bundle (M93, lane REPORTFLOW R2): esbuild builds
// this file into dist/reportFallback.js, which the conversation controller
// imports when the report entry cannot be loaded, and the Report command
// imports when no conversation surface becomes ready. The fallback builds
// the same sealed draft with the editor-native quick pick, so it stays out
// of the bundle VS Code loads at activation AND out of the report bundle it
// replaces. Like the report entry, it keeps its own installed-language
// state, so the factory installs the caller's table before anything reads it.

import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import type { ReportPanelState } from '../../shared/constants'
import type { ReportEventRef } from '../../shared/protocol'
import { runReportFallback, type ReportFallbackDeps } from './reportFallback'

/** The editor-native report fallback for one use, in the caller's display language. */
export function createReportFallback(
  deps: ReportFallbackDeps,
  table: UiText,
  locale: string,
): {
  run: (ref: ReportEventRef | undefined, panelState: ReportPanelState | undefined) => Promise<void>
} {
  setUiText(table, locale)
  return {
    run: (ref, panelState) => runReportFallback(deps, ref, panelState),
  }
}

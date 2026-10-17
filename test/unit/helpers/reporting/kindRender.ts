import {
  createReportCollector,
  type ReportCollectorDependencies,
} from '../../../../src/core/reporting/collect'
import { finalizeReport } from '../../../../src/core/reporting/render/canonical'
import { REPORT_EMPTY_HASH } from '../../../../src/shared/constants'
import type { ReportCollector } from '../../../../src/core/reporting/sources/types'
import type { ReportDocument } from '../../../../src/shared/reportSchema'
import { RENDERERS, REPORT_THEME } from '../../reportKindRenderFixtures'
import { unavailableSource } from './kindFixtures'

// Shared production collector/finalizer wiring for renderer-level
// determinism regressions (RVCM1131 finding 1). The finalizer matches
// src/runtime/reporting/engine.ts: a placeholder hash satisfies the
// document type, then the production finalizer recomputes it.
export function testSelections(): ReportCollectorDependencies['selections'] {
  return {
    changes: () => unavailableSource('changesRange', 'No range evidence'),
    changeBranches: () => unavailableSource('changeBranches', 'No branch ancestry evidence'),
    risksSinceRelease: () => unavailableSource('risksSinceRelease', 'No revision evidence'),
  }
}

export function reportTestCollector(
  selections: ReportCollectorDependencies['selections'] = testSelections(),
): ReportCollector {
  return createReportCollector({
    finalize: (draft) =>
      finalizeReport({
        ...draft,
        header: { ...draft.header, contentHash: REPORT_EMPTY_HASH },
      }),
    nextStepLimit: 3,
    selections,
  })
}

/** The production collector with unavailable selections (session/usage kinds use none). */
export const renderTestCollector = reportTestCollector()

export type RenderedReport = Record<'md' | 'html' | 'json' | 'text', string>

/** Render a finalized document in every format the engine supports. */
export function renderAllFormats(document: ReportDocument): RenderedReport {
  const rendered: RenderedReport = {
    md: RENDERERS.md(document, 'en', REPORT_THEME),
    html: RENDERERS.html(document, 'en', REPORT_THEME),
    json: RENDERERS.json(document, 'en', REPORT_THEME),
    text: RENDERERS.text(document, 'en', REPORT_THEME),
  }
  for (const output of Object.values(rendered)) {
    if (!output.includes(document.header.contentHash))
      throw new Error('Rendered report lost its content hash')
  }
  return rendered
}

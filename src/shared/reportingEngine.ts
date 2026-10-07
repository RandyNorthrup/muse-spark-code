import type { ReportsHostPort } from './hostApi/reports'
import type { REPORT_FORMATS } from './constants'
import type { ReportDocument, ReportRenderer } from './reportSchema'

export interface ReportPanelEngine {
  readonly reports: Pick<ReportsHostPort, 'run' | 'history' | 'get' | 'compare'>
  readonly render: Readonly<Record<(typeof REPORT_FORMATS)[number], ReportRenderer>>
  readonly verify: (input: unknown) => ReportDocument
  readonly scrub: (text: string) => string
}

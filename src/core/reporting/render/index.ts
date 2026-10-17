import { canonicalReportJson, scrubReportOutput, verifyReport } from './canonical'
import { reportDisplay, type ReportLocalePort } from './display'
import { htmlParts } from './html'
import { markdownParts } from './markdown'
import { textParts } from './text'
import { reportScrubber, type ReportRedaction } from './redaction'
import type { ReportRenderer } from '../../../shared/reportSchema'

/** Shared engine entry: VS Code, native hosts, ACP, CLI and companion bind the same factory. */
export function createReportRenderers(
  localePort: ReportLocalePort,
  redaction: ReportRedaction = {},
): Record<'md' | 'html' | 'json' | 'text', ReportRenderer> {
  const renderer =
    (format: 'md' | 'html' | 'text'): ReportRenderer =>
    (input, locale, theme) => {
      const document = verifyReport(input, redaction)
      const display = reportDisplay(document, locale, localePort, reportScrubber(redaction))
      let parts: readonly [string, string]
      if (format === 'md') parts = markdownParts(document, display)
      else if (format === 'html') parts = htmlParts(document, display, locale, theme)
      else parts = textParts(document, display)
      const [beforeHash, afterHash] = parts
      return `${scrubReportOutput(beforeHash, redaction)}${document.header.contentHash}${scrubReportOutput(afterHash, redaction)}`
    }
  return {
    md: renderer('md'),
    html: renderer('html'),
    text: renderer('text'),
    json: (document) => canonicalReportJson(document, redaction),
  }
}

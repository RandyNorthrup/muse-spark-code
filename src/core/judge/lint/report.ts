import type { LintDecision } from './cache'
import type { LintCoverage, LintUnit } from './units'

export interface LintFinding {
  readonly path: string
  readonly ruleId: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly unit: LintUnit
  readonly decision: LintDecision
  readonly advisory: boolean
  readonly startLine: number
  readonly startColumn: number
  readonly endLine: number
  readonly endColumn: number
}

export interface LintReport {
  readonly findings: readonly LintFinding[]
  readonly coverage: readonly LintCoverage[]
  readonly incomplete: boolean
  readonly error?: string
}

/** User-visible sentences are supplied by P0's translated runtime tables. */
export interface LintReportWording {
  finding(finding: LintFinding): string
  coverage(row: LintCoverage): string
  error(code: string): string
}

export function lintExitCode(report: LintReport, failOn?: 'error' | 'warning'): 0 | 1 | 2 {
  if (report.error !== undefined || report.incomplete) return 2
  const isFailure = report.findings.some(
    (finding) =>
      !finding.advisory &&
      (finding.severity === 'error' || (failOn === 'warning' && finding.severity === 'warning')),
  )
  return failOn !== undefined && isFailure ? 1 : 0
}

export function formatLintReport(
  report: LintReport,
  format: 'text' | 'json' | 'sarif',
  wording: LintReportWording,
): string {
  if (format === 'json') return JSON.stringify(report)
  if (format === 'text') {
    const lines = [
      ...report.findings.map((finding) => wording.finding(finding)),
      ...report.coverage.map((row) => wording.coverage(row)),
      ...(report.error === undefined ? [] : [wording.error(report.error)]),
    ]
    return lines.join('\n')
  }
  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: { driver: { name: 'Muse Spark Code (Unofficial)' } },
        results: report.findings.map((finding) => ({
          ruleId: finding.ruleId,
          level: finding.severity === 'info' ? 'note' : finding.severity,
          message: { text: wording.finding(finding) },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.path },
                region: {
                  startLine: finding.startLine,
                  startColumn: finding.startColumn,
                  endLine: finding.endLine,
                  endColumn: finding.endColumn,
                },
              },
            },
          ],
          properties: { advisory: finding.advisory, confidence: finding.decision.confidence },
        })),
        properties: { coverage: report.coverage, incomplete: report.incomplete },
        invocations: [
          {
            executionSuccessful: report.error === undefined && !report.incomplete,
            ...(report.error !== undefined && {
              toolExecutionNotifications: [
                { level: 'error', message: { text: wording.error(report.error) } },
              ],
            }),
          },
        ],
      },
    ],
  })
}

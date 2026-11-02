// Muse Desktop (M111, D91.13) lane BP: the Problems view's pure helpers.
// Severity order follows M68's `DIAGNOSTIC_SEVERITIES` (worst first);
// the suite pins the two orders together so they cannot drift.

import { formatNumber } from '../../../shared/l10n/text'
import type { PanelProblem } from '../../../shared/desktop/bridge'

/** Worst first, exactly M68's order; unknown severities sort last. */
export const PROBLEM_SEVERITY_ORDER = ['error', 'warning', 'information', 'hint'] as const

export function problemSeverityRank(severity: string): number {
  for (const [rank, known] of PROBLEM_SEVERITY_ORDER.entries()) {
    if (known === severity) return rank
  }
  return PROBLEM_SEVERITY_ORDER.length
}

/** Rows worst-first, then by position, for one file's group. */
export function sortProblemRows(rows: readonly PanelProblem[]): PanelProblem[] {
  return rows.toSorted((left, right) => {
    const rank = problemSeverityRank(left.severity) - problemSeverityRank(right.severity)
    if (rank !== 0) return rank
    return left.line === right.line ? left.column - right.column : left.line - right.line
  })
}

export interface ProblemFileGroup {
  readonly path: string
  readonly rows: readonly PanelProblem[]
}

/** Groups rows by file, files alphabetically, rows worst-first. */
export function groupProblemsByFile(problems: readonly PanelProblem[]): ProblemFileGroup[] {
  const byPath = new Map<string, PanelProblem[]>()
  for (const problem of problems) {
    const rows = byPath.get(problem.path)
    if (rows === undefined) byPath.set(problem.path, [problem])
    else rows.push(problem)
  }
  const groups: ProblemFileGroup[] = []
  for (const [path, rows] of byPath) {
    groups.push({ path, rows: sortProblemRows(rows) })
  }
  return groups.toSorted((left, right) => left.path.localeCompare(right.path))
}

/** The `line:column` reference after a row's message. */
export function formatProblemLocation(line: number, column: number): string {
  return `${formatNumber(line)}:${formatNumber(column)}`
}

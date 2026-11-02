import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_SEVERITIES } from '../../../src/core/diagnostics'
import {
  formatProblemLocation,
  groupProblemsByFile,
  problemSeverityRank,
  PROBLEM_SEVERITY_ORDER,
} from '../../../src/webview/desktop/panel/problemsFormat'

describe('M111 lane BP problems helpers', () => {
  it('ranks severities worst-first, exactly M68 order', () => {
    expect([...PROBLEM_SEVERITY_ORDER]).toEqual([...DIAGNOSTIC_SEVERITIES])
    expect(problemSeverityRank('error')).toBe(0)
    expect(problemSeverityRank('warning')).toBe(1)
    expect(problemSeverityRank('information')).toBe(2)
    expect(problemSeverityRank('hint')).toBe(3)
    expect(problemSeverityRank('fatal')).toBe(4)
  })

  it('groups rows by file, rows worst-first then by position', () => {
    const groups = groupProblemsByFile([
      { path: 'b.ts', severity: 'hint', line: 9, column: 0, message: 'h' },
      { path: 'a.ts', severity: 'warning', line: 5, column: 2, message: 'w' },
      { path: 'a.ts', severity: 'error', line: 5, column: 1, message: 'e' },
      { path: 'a.ts', severity: 'error', line: 2, column: 0, message: 'e2' },
    ])
    expect(groups.map((group) => group.path)).toEqual(['a.ts', 'b.ts'])
    expect(groups[0]?.rows.map((row) => row.message)).toEqual(['e2', 'e', 'w'])
  })

  it('formats the line reference through the locale', () => {
    expect(formatProblemLocation(3, 7)).toBe('3:7')
  })
})

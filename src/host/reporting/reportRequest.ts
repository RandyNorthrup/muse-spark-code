import { REPORT_KINDS, UI_TEXT } from '../../shared/constants'
import { reportOptionsSchema, type ReportOptions } from '../../shared/reportSchema'

export type ReportRequest =
  | { readonly action: 'pick' }
  | { readonly action: 'problem' }
  | { readonly action: 'history' }
  | { readonly action: 'run'; readonly options: ReportOptions }

/** Editor syntax only; the CLI's flags and file reads remain with lane X. */
export function parseReportRequest(argumentsText: string, asOf: string): ReportRequest {
  const words = argumentsText.trim().split(/\s+/).filter(Boolean)
  const kind = words.shift()
  if (kind === undefined) return { action: 'pick' }
  if (kind === 'problem' || kind === 'history') {
    if (words.length > 0) throw new Error(UI_TEXT.reportUi.invalidArguments)
    return { action: kind }
  }
  if (REPORT_KINDS.every((candidate) => candidate !== kind))
    throw new Error(UI_TEXT.reportUi.invalidArguments)
  const values: Record<string, unknown> = {
    kind,
    asOf,
    scope: '',
    full: false,
    network: false,
    failOn: [],
  }
  const scope: string[] = []
  const seen = new Set<string>()
  const flags = new Map([
    ['--by', 'by'],
    ['--session', 'sessionId'],
    ['--module', 'module'],
    ['--milestone', 'milestone'],
    ['--fleet', 'fleet'],
  ])
  while (words.length > 0) {
    const word = words.shift()
    if (word === undefined) break
    if (!word.startsWith('--')) {
      scope.push(word)
      continue
    }
    if (seen.has(word)) throw new Error(UI_TEXT.reportUi.invalidArguments)
    seen.add(word)
    if (word === '--full' || word === '--network') {
      values[word.slice(2)] = true
      continue
    }
    const field = word === '--by' && kind === 'estimate' ? 'deadline' : flags.get(word)
    const value = words.shift()
    if (field === undefined || value === undefined || value.startsWith('--'))
      throw new Error(UI_TEXT.reportUi.invalidArguments)
    values[field] = value
  }
  values['scope'] = scope.join(' ')
  if ((kind === 'milestone' || kind === 'release') && scope.length !== 1)
    throw new Error(UI_TEXT.reportUi.invalidArguments)
  const result = reportOptionsSchema.safeParse(values)
  if (!result.success) throw new Error(UI_TEXT.reportUi.invalidArguments)
  return { action: 'run', options: result.data }
}

import { describe, expect, it } from 'vitest'
import { reportCommandArguments } from '../../src/host/reporting/reportCommand'
import { parseReportRequest } from '../../src/host/reporting/reportRequest'

const AS_OF = '2026-10-06T12:00:00Z'
describe('the local report command grammar', () => {
  it('reserves report with any whitespace or arguments and leaves ordinary messages alone', () => {
    for (const text of ['/report', ' /report  ', '/report\nproject', '/report\tinvalid --oops'])
      expect(reportCommandArguments(text)).toBeDefined()
    for (const text of ['/reporter project', 'explain /report', '/reports'])
      expect(reportCommandArguments(text)).toBeUndefined()
  })
  it('parses the picker, problem report, history and scoped deterministic kinds', () => {
    expect(parseReportRequest('', AS_OF)).toEqual({ action: 'pick' })
    expect(parseReportRequest('problem', AS_OF)).toEqual({ action: 'problem' })
    expect(parseReportRequest('history', AS_OF)).toEqual({ action: 'history' })
    expect(parseReportRequest('milestone M110a0 --full', AS_OF)).toMatchObject({
      action: 'run',
      options: { kind: 'milestone', scope: 'M110a0', full: true, asOf: AS_OF, network: false },
    })
    expect(parseReportRequest('usage 30d --by model --network', AS_OF)).toMatchObject({
      options: { kind: 'usage', scope: '30d', by: 'model', network: true },
    })
    expect(
      parseReportRequest('estimate M113 --by 2026-11-01T00:00:00Z --fleet minimum', AS_OF),
    ).toMatchObject({ options: { deadline: '2026-11-01T00:00:00Z', fleet: 'minimum' } })
  })
  it('refuses malformed scopes, flags and duplicate options without quoting the input', () => {
    for (const text of [
      'unknown',
      'milestone',
      'release 1 2',
      'usage --by',
      'usage --by invented',
      'project --full --full',
      'project --out private',
      'problem private',
      'history --full',
    ])
      expect(() => parseReportRequest(text, AS_OF)).toThrow('Invalid report arguments')
  })
})

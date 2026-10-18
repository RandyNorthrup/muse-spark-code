import { EN } from '../../src/shared/l10n/en'
// C-M113-2: failures thrown from a lazy bundle's own copy of
// LocalSourceError must keep their code across the bundle boundary.
import { describe, expect, it } from 'vitest'
import {
  localFailureOf,
  localSource,
  LocalSourceError,
} from '../../src/core/reporting/sources/local'
import { UI_TEXT } from '../../src/shared/constants'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/kindFixtures'

/** A second bundle copy: the same shape and brand, no shared prototype. */
class ForeignLocalSourceError extends Error {
  readonly isLocalSourceError = true as const
  constructor(readonly code: string) {
    super(code)
  }
}

describe('local source failures', () => {
  it('keeps the instanceof code', () => {
    expect(localFailureOf(new LocalSourceError('history'))).toBe('history')
    expect(localFailureOf(new Error('boom'))).toBeUndefined()
    expect(localFailureOf(null)).toBeUndefined()
  })

  it('recognizes a branded failure from another bundle copy', () => {
    const foreign = new ForeignLocalSourceError('history')
    expect(foreign instanceof LocalSourceError).toBe(false)
    expect(localFailureOf(foreign)).toBe('history')
  })

  it('R22 refuses branded prototype and unknown codes', () => {
    expect(localFailureOf({ isLocalSourceError: true, code: 'nope' })).toBeUndefined()
    expect(localFailureOf({ isLocalSourceError: true })).toBeUndefined()
    expect(localFailureOf({ code: 'history' })).toBeUndefined()
    for (const code of ['constructor', 'toString', '__proto__'])
      expect(localFailureOf({ isLocalSourceError: true, code })).toBeUndefined()
  })

  it('reports the foreign code instead of a generic failure', async () => {
    const source = localSource('session', () =>
      Promise.reject(new ForeignLocalSourceError('history')),
    )
    const result = await source.read({
      reportText: EN,
      locale: 'en',
      asOf: REPORT_FIXTURE_AS_OF,
      workspaceKey: 'fixture',
      options: reportOptions('session'),
      signal: new AbortController().signal,
    })
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(UI_TEXT.reportSourceReasons.history)
    expect(result.data).toBeNull()
  })
})

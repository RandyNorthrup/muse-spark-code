// Bounded reads for the problem report (lane REPORTFLOW R2): a hanging
// source rejects with the fixed `TimeoutError` word, a throw keeps its
// class when the vocabulary names it, and anything else reads `unknown`.
// Never a message, which can hold anything.

import { describe, expect, it } from 'vitest'
import {
  reportReasonOf,
  ReportTimeoutError,
  withReportTimeout,
} from '../../src/host/support/reportTimeout'

describe('reportTimeout', () => {
  it('resolves a read that answers before its bound', async () => {
    const seen: string[] = []
    const task = (async (): Promise<string> => {
      const value = await Promise.resolve('facts')
      seen.push(value)
      return value
    })()
    await expect(withReportTimeout(task, 5000)).resolves.toBe('facts')
    expect(seen).toEqual(['facts'])
  })

  it('rejects a hanging read with the fixed TimeoutError word', async () => {
    const built = withReportTimeout(new Promise<never>(() => undefined), 10)
    await expect(built).rejects.toBeInstanceOf(ReportTimeoutError)
    expect(reportReasonOf(new ReportTimeoutError(10))).toBe('TimeoutError')
  })

  it('passes a throw through for the reason mapping', async () => {
    await expect(withReportTimeout(Promise.reject(new Error('nope')), 1000)).rejects.toThrow('nope')
    expect(reportReasonOf(new Error('nope'))).toBe('Error')
    expect(reportReasonOf(new TypeError('nope'))).toBe('TypeError')
    expect(reportReasonOf(new Error('PRIVATE /home/someone'))).toBe('Error')
    expect(reportReasonOf('a string')).toBe('unknown')
    expect(reportReasonOf(undefined)).toBe('unknown')
  })
})

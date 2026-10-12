// RVREPORTJOIN P2-2: problems are bounded by construction. A count plus
// the first few examples plus the localized remainder can never exceed the
// source-reason bound, so 5,000 bad slots beside one good row keep the good
// row, and problem text can never cause evidence to be dropped.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_MAX_TEXT_CHARS } from '../../src/shared/constants'
import { joinPartialReasons } from '../../src/core/reporting/sources/boundary'
import { readReportSource } from '../../src/core/reporting/sources/boundary'
import { createLocalReportSources } from '../../src/core/reporting/sources'
import { createAccountsReportReader } from '../../src/runtime/reporting/reportInputs'
import type { AccountsFacts } from '../../src/core/reporting/sources/types'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'

const TEMP = path.resolve(import.meta.dirname, '../../temp')
const badUsage = (account: string): AccountsFacts['usage'][number] => ({
  provider: 'meta',
  account,
  label: 'Bad',
  period: 'day',
  inputTokens: -1,
  outputTokens: 2,
  costUsd: null,
  certainty: 'unknown',
})
const goodUsage = (): AccountsFacts['usage'][number] => ({
  provider: 'meta',
  account: 'primary',
  label: 'Primary',
  period: 'day',
  inputTokens: 10,
  outputTokens: 2,
  costUsd: null,
  certainty: 'unknown',
})

describe('bounded problem text', () => {
  it('joins short lists whole with exact duplicates kept once', () => {
    expect(joinPartialReasons(EN, [])).toBeUndefined()
    expect(joinPartialReasons(EN, [undefined, ''])).toBeUndefined()
    expect(joinPartialReasons(EN, ['a', 'b', 'a'])).toBe('a b')
  })

  it('summarizes an over-long list as examples plus a localized count', () => {
    const reasons = Array.from(
      { length: 5000 },
      (_, index) => `Reason ${String(index).padStart(4, '0')} ${'x'.repeat(50)}`,
    )
    const summary = joinPartialReasons(EN, reasons)
    expect(summary).toBeDefined()
    expect(summary!.length).toBeLessThanOrEqual(REPORT_MAX_TEXT_CHARS)
    expect(summary).toContain('Reason 0000')
    expect(summary).toContain('more problems')
    const tail = /([\d,]+) more problems/u.exec(summary!)
    expect(tail?.[1]).toBeDefined()
    const rest = Number((tail?.[1] ?? '').replaceAll(',', ''))
    expect(rest).toBeGreaterThan(0)
    expect(summary!.split('Reason ').length - 1 + rest).toBe(5000)
  })

  it('keeps one good row beside 5,000 bad slots through the engine boundary', async () => {
    const rows: AccountsFacts['usage'] = [
      ...Array.from({ length: 5000 }, (_, index) => badUsage(`bad-${String(index)}`)),
      goodUsage(),
    ]
    const sources = createLocalReportSources({
      files: {
        read: () => Promise.reject(new Error('unused')),
        list: () => Promise.reject(new Error('unused')),
      },
      git: { run: () => Promise.resolve({ stdout: '', code: 1 }) },
      scrub: (text) => text,
      roots: [],
      accounts: createAccountsReportReader({
        dataDir: path.join(TEMP, 'problem-bounds-no-registry'),
        readUsage: () => Promise.resolve(rows),
      }),
      enabledAgents: [],
      agentFiles: [],
    })
    const context = {
      reportText: EN,
      asOf: REPORT_FIXTURE_AS_OF,
      workspaceKey: 'workspace',
      options: reportOptions('accounts'),
      signal: new AbortController().signal,
    }
    const result = await readReportSource('accounts', sources.accounts, context)
    expect(result.record.status).toBe('partial')
    expect(result.data?.usage).toEqual([goodUsage()])
    if (result.record.status !== 'partial') throw new Error('Expected a partial reason')
    expect(result.record.reason.length).toBeLessThanOrEqual(REPORT_MAX_TEXT_CHARS)
    expect(result.record.reason).toContain('more problems')
  })
})

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { Usd } from '../../src/shared/usd'
import { usageReportFacts } from '../../src/core/usage/reportUsage'
import { EN } from '../../src/shared/l10n/en'
import { analyzeSource } from './helpers/moneyTypeGuard'

// Collection time, like the walk it replaces: one checker over the reporting
// roots is a ten-second build, which the per-test deadline is not for
// (paidMoneyStructure.test.ts keeps the same pattern for all of `src`).
const ROOT = path.resolve(import.meta.dirname, '../..')
const SOURCE = analyzeSource(
  ROOT,
  ['src/core/reporting', 'src/runtime/reporting'].flatMap((folder) =>
    readdirSync(path.join(ROOT, folder), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.join(ROOT, folder, file)),
  ),
)

it('the exact-money inventory covers every reporting file without a sanctioned money exception', () => {
  expect([...SOURCE.flagged].filter((value) => value.includes('/reporting/'))).toEqual([])
})

it('paid budget limits keep large fractional decimals through source facts', () => {
  const spent = Usd.from('9007199254740993.000000001').toAmount()
  const cap = Usd.from('9007199254740994.000000002').toAmount()
  const facts = usageReportFacts({
    reportText: EN,
    journal: {
      records: [],
      rollups: [],
      limits: [],
      budgets: [
        {
          budget: { id: 'exact', kind: 'paidDaily', spentUsd: spent, capUsd: cap, stopped: false },
        },
      ],
      budgetDay: '2026-10-06',
    },
    scope: 'today',
    by: undefined,
    now: Date.parse('2026-10-06T12:00:00Z'),
    asOf: '2026-10-06T12:00:00Z',
    timezoneOffsetMins: 0,
  })
  expect(facts.usage.limits[0]).toMatchObject({ used: spent, limit: cap, unit: 'usd' })
  const code = readFileSync(
    path.resolve(import.meta.dirname, '../../src/core/usage/reportUsage.ts'),
    'utf8',
  )
  expect(code).not.toContain('limitDollars')
})

import { describe, expect, it } from 'vitest'
import { codeUnitCompare } from '../../src/core/reporting/sources/local'
import {
  collectFixture,
  fullSnapshot,
  getSection,
  noSources,
  availableSource,
} from './helpers/reporting/kindFixtures'
import type { AccountsFacts } from '../../src/core/reporting/sources/types'

function collectWithAccounts(overrides: Partial<AccountsFacts>) {
  const snapshot = fullSnapshot()
  return collectFixture(
    'accounts',
    {},
    {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        accounts: availableSource('accounts', {
          ...snapshot.sources.accounts.data!,
          ...overrides,
        }),
      },
    },
  )
}

describe('accounts collector', () => {
  it('renders the registry, thresholds, use, swaps, stops and confirmations', () => {
    const report = collectFixture('accounts')
    expect(getSection(report, 'accounts/accounts').rows[0]!.cells).toMatchObject({
      provider: { type: 'text', value: 'meta' },
      account: { type: 'text', value: 'primary' },
      name: { type: 'text', value: 'Primary' },
    })
    const limits = getSection(report, 'accounts/limits').rows
    expect(limits).toHaveLength(3)
    // Rows sort by stable key, not by threshold kind: compare as a set.
    const kindOf = (row: (typeof limits)[number]) => (row.cells['kind'] as { value: string }).value
    expect(limits.map((row) => kindOf(row)).toSorted(codeUnitCompare)).toEqual([
      'percent/plan',
      'requests/day',
      'spendUsd/day',
    ])
    const limit = (kind: string) => limits.find((row) => kindOf(row) === kind)!
    expect(limit('spendUsd/day').cells['count']).toEqual({
      type: 'usd',
      value: '5',
      certainty: 'reported',
    })
    expect(limit('requests/day').cells['count']).toEqual({ type: 'count', value: 100 })
    expect(limit('percent/plan').cells['count']).toEqual({ type: 'percent', value: 80 })
    expect(getSection(report, 'accounts/usage').rows[0]!.cells).toMatchObject({
      name: { type: 'text', value: 'Primary' },
      scope: { type: 'text', value: 'meta' },
      inputTokens: { type: 'count', value: 100 },
      cost: { type: 'usd', value: '0.25', certainty: 'reported' },
    })
    expect(getSection(report, 'accounts/swaps').rows[0]!.cells).toMatchObject({
      // The swapped-to account is outside the registry: its id still names it.
      name: { type: 'text', value: 'backup' },
      kind: { type: 'text', value: 'swap' },
      outcome: { type: 'text', value: 'userCap/spendUsd/day' },
    })
    expect(getSection(report, 'accounts/refusals').rows[0]!.cells).toMatchObject({
      name: { type: 'text', value: 'Primary' },
      kind: { type: 'text', value: 'stop' },
      outcome: { type: 'text', value: 'vendorLimit/quota' },
    })
    expect(getSection(report, 'accounts/confirmations').rows[0]!.cells).toMatchObject({
      provider: { type: 'text', value: 'meta' },
      name: { type: 'text', value: 'muse' },
      kind: { type: 'text', value: 'confirm' },
    })
  })

  it('keeps every section present but empty when the registry is empty', () => {
    const report = collectWithAccounts({ providers: [], usage: [], events: [], confirmations: [] })
    for (const id of [
      'accounts/accounts',
      'accounts/limits',
      'accounts/usage',
      'accounts/swaps',
      'accounts/refusals',
      'accounts/confirmations',
    ]) {
      expect(getSection(report, id).rows).toEqual([])
    }
  })

  it('names the registry unavailable with its reason instead of empty sections', () => {
    const report = collectFixture('accounts', {}, noSources())
    const sections = report.sections.filter((entry) => entry.id !== 'planFormat')
    for (const section of sections) {
      expect(section.rows[0]!.cells['status']).toEqual({ type: 'label', value: 'unavailable' })
      expect(section.rows[0]!.sourceIds).toEqual(['accounts'])
    }
  })

  it('collects the same rows regardless of fact order', () => {
    const snapshot = fullSnapshot()
    const facts = snapshot.sources.accounts.data!
    const reordered = collectFixture(
      'accounts',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          accounts: availableSource('accounts', {
            ...facts,
            events: facts.events.toReversed(),
            usage: [...facts.usage],
          }),
        },
      },
    )
    expect(JSON.stringify(reordered)).toBe(JSON.stringify(collectFixture('accounts')))
  })
})

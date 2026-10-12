import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import { collectFixture, fullSnapshot, getSection } from './helpers/reporting/collect'
import { availableSource } from './helpers/reporting/snapshot'
import type { UsageFacts } from '../../src/core/reporting/sources/types'

function collectWithUsage(overrides: Partial<UsageFacts>) {
  const snapshot = fullSnapshot()
  return collectFixture(
    'usage',
    {},
    {
      ...snapshot,
      sources: {
        ...snapshot.sources,
        usage: availableSource('usage', { ...snapshot.sources.usage.data!, ...overrides }),
      },
    },
  )
}

describe('usage collector', () => {
  it('preserves M102 totals, the selected grouping, limits and certainty', () => {
    const report = collectFixture('usage', { by: 'provider' })
    expect(getSection(report, 'totals').rows[0]!.cells).toMatchObject({
      inputTokens: { type: 'count', value: 100 },
      outputTokens: { type: 'count', value: 20 },
      cost: { type: 'usd', value: '0.25', certainty: 'reported' },
    })
    expect(typeof getSection(report, 'totals').rows[0]!.cells['cost']!.value).toBe('string')
    expect(getSection(report, 'breakdown').rows[0]!.cells['scope']).toEqual({
      type: 'text',
      value: 'provider',
    })
    expect(getSection(report, 'limits').rows[0]!.cells['totals']).toEqual({
      type: 'number',
      value: 5,
    })
    expect(getSection(report, 'agentUsage').rows[0]!.cells['files']).toEqual({
      type: 'text',
      value: '~/.codex/usage.jsonl',
    })
    expect(getSection(report, 'agentLimits').rows[0]!.cells).toMatchObject({
      count: { type: 'number', value: 0.25 },
      totals: { type: 'number', value: 5 },
    })
  })

  it('omits unsupported cache columns while naming the capability as not applicable', () => {
    const report = collectWithUsage({ cachedTokens: null, costUsd: null, certainty: 'unknown' })
    expect(
      getSection(report, 'totals').columns.some((column) => column.key === 'cachedTokens'),
    ).toBe(false)
    expect(getSection(report, 'totals').rows[0]!.cells['cost']).toEqual({
      type: 'usd',
      value: null,
      certainty: 'unknown',
    })
    expect(report.sources.find((source) => source.id === 'usage/cachedTokens')).toMatchObject({
      status: 'notApplicable',
      reason: 'cachedTokens=null',
    })
  })

  it('normalizes agent usage file identities before comparing rows across platforms', () => {
    const snapshot = fullSnapshot()
    const windows = collectFixture(
      'usage',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          agentUsage: availableSource(
            'agentUsage',
            snapshot.sources.agentUsage.data!.map((entry) => ({
              ...entry,
              file: entry.file.replaceAll('/', '\\'),
            })),
          ),
        },
      },
    )
    const portable = collectFixture('usage', {}, snapshot)
    for (const id of ['agentUsage', 'agentLimits']) {
      expect(getSection(windows, id)).toEqual(getSection(portable, id))
    }
  })

  it('renders dollar budgets and percent windows in their own fields', () => {
    const report = collectWithUsage({
      limits: [
        { key: 'meta/weekly', used: 25, limit: 100, resetsAt: null, unit: 'percent' },
        {
          key: 'paidDaily/daily',
          used: Usd.from('0.5').toAmount(),
          limit: Usd.from('1').toAmount(),
          resetsAt: null,
          unit: 'usd',
        },
        { key: 'foreign/agent', used: 0.25, limit: 5, resetsAt: null },
      ],
    })
    const rows = getSection(report, 'limits').rows
    const cells = (name: string) =>
      rows.find((row) => {
        const cell = row.cells['name']
        return cell?.type === 'text' && cell.value === name
      })?.cells
    // Dollars in dollar fields, percentages in percent fields (RVCM1132B
    // finding 5): the two rows must never share one plain-number shape.
    expect(cells('meta/weekly')?.['count']).toEqual({ type: 'percent', value: 25 })
    expect(cells('meta/weekly')?.['totals']).toEqual({ type: 'percent', value: 100 })
    expect(cells('paidDaily/daily')?.['count']).toEqual({
      type: 'usd',
      value: '0.5',
      certainty: 'reported',
    })
    expect(cells('paidDaily/daily')?.['totals']).toEqual({
      type: 'usd',
      value: '1',
      certainty: 'reported',
    })
    expect(cells('foreign/agent')?.['count']).toEqual({ type: 'number', value: 0.25 })
    expect(cells('foreign/agent')?.['totals']).toEqual({ type: 'number', value: 5 })
  })
})

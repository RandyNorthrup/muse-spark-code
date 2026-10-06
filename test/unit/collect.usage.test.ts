import { describe, expect, it } from 'vitest'
import { collectFixture, fullSnapshot, getSection } from './helpers/reporting/collect'
import { availableSource } from './helpers/reporting/snapshot'

describe('usage collector', () => {
  it('preserves M102 totals, the selected grouping, limits and certainty', () => {
    const report = collectFixture('usage', { by: 'provider' })
    expect(getSection(report, 'totals').rows[0]!.cells).toMatchObject({
      inputTokens: { type: 'count', value: 100 },
      outputTokens: { type: 'count', value: 20 },
      cost: { type: 'usd', value: 0.25, certainty: 'reported' },
    })
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
    const snapshot = fullSnapshot()
    const report = collectFixture(
      'usage',
      {},
      {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          usage: availableSource('usage', {
            ...snapshot.sources.usage.data!,
            cachedTokens: null,
            costUsd: null,
            certainty: 'unknown',
          }),
        },
      },
    )
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
})

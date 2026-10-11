import { describe, expect, it } from 'vitest'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import { rollupUsageRecords, type UsageJournalRead } from '../../src/core/usage/journalStore'
import {
  exportUsageCallsCsv,
  exportUsageSummaryCsv,
  exportUsageJson,
  usageCsvCell,
} from '../../src/core/usage/usageExport'
import { usagePageStateSchema } from '../../src/shared/usagePage'
import type { UsageRecord } from '../../src/shared/usageJournal'
import { usageState } from './helpers/usageAdapters'

const at = new Date(2026, 9, 5, 12).getTime()
function record(id: string, model = 'model'): UsageRecord {
  return createUsageRecord(
    { input_tokens: 10, output_tokens: 2 },
    {
      id,
      at,
      startedAt: at,
      client: 'Zed',
      backend: 'modelApi',
      provider: 'custom',
      model,
      kind: 'turn',
      outcome: 'completed',
    },
  )
}
function journal(records: UsageRecord[] = []): UsageJournalRead {
  return {
    records,
    limits: [],
    rollups: [],
    recordCount: records.length,
    newerVersionRecords: 0,
    newerVersionFiles: 0,
    tornLines: 0,
    invalidLines: 0,
  }
}
function cells(line: string): string[] {
  return Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g), (match) =>
    (match[1] ?? '').replaceAll('""', '"'),
  )
}
function summaryState() {
  const totals = {
    records: 2,
    tokens: { input: 100, output: 20 },
    units: { images: 2 },
    costs: [
      { certainty: 'reported', records: 1, usd: 0.25 },
      { certainty: 'unpriced', records: 1 },
    ],
    retries: 0,
    rateLimited: 0,
    durationMs: 1000,
  }
  return usagePageStateSchema.parse({
    v: 1,
    query: { range: '30d', groupBy: 'model', metric: 'cost' },
    generatedAt: at,
    history: {
      ...usageState().history,
      host: 'Kubuntu',
    },
    totals,
    previousTotals: { records: 0, tokens: {}, units: {}, costs: [], retries: 0, rateLimited: 0 },
    buckets: [],
    breakdown: [
      { id: 'custom/model', label: '=FORMULA', provider: 'custom', model: 'model', totals },
    ],
    features: [],
    limits: [],
    budgets: [],
    unreportedLimits: [],
    attempts: [],
    savings: {},
  })
}

describe('usage exports', () => {
  it.each(['=1+1', '+cmd', '-cmd', '@SUM(A1)', '\t=cmd', '\r=cmd'])(
    'escapes spreadsheet formula prefix %j',
    (value) => {
      expect(usageCsvCell(value)).toBe(`"'${value}"`)
    },
  )
  it('quotes comma, quote and newline values and preserves absent amounts as empty cells', () => {
    expect(usageCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"')
    expect(usageCsvCell(undefined)).toBe('""')
    expect(usageCsvCell(0)).toBe('"0"')
    expect(usageCsvCell(false)).toBe('"false"')
  })
  it('exports per-call fields, safe model/editor cells and inclusive local-day filters', () => {
    const records = [
      record('today', '=FORMULA'),
      { ...record('past'), day: '2026-10-04' },
      { ...record('future'), day: '2026-10-06' },
    ]
    const output = exportUsageCallsCsv(
      journal(records),
      { from: '2026-10-05', to: '2026-10-05' },
      at,
    )
    const lines = output.trimEnd().split('\r\n')
    expect(lines).toHaveLength(2)
    const headers = cells(lines[0]!)
    const values = cells(lines[1]!)
    expect(values[headers.indexOf('model')]).toBe("'=FORMULA")
    expect(values[headers.indexOf('usd')]).toBe('')
    expect(values[headers.indexOf('cached')]).toBe('')
    expect(values[headers.indexOf('input')]).toBe('10')
    expect(output).not.toContain('past')
    expect(output).not.toContain('future')
    expect(output.endsWith('\r\n')).toBe(true)
  })
  it('allows exactly the 30 detailed days and refuses older, future, reversed or rolled ranges', () => {
    const data = journal([record('today')])
    expect(() =>
      exportUsageCallsCsv(data, { from: '2026-09-06', to: '2026-10-05' }, at),
    ).not.toThrow()
    for (const range of [
      { from: '2026-09-05', to: '2026-10-05' },
      { from: '2026-10-05', to: '2026-10-06' },
      { from: '2026-10-05', to: '2026-10-04' },
    ])
      expect(() => exportUsageCallsCsv(data, range, at)).toThrow()
    const rolled = { ...data, rollups: rollupUsageRecords([record('covered')]) }
    expect(() => exportUsageCallsCsv(rolled, { from: '2026-10-05', to: '2026-10-05' }, at)).toThrow(
      'exportRange',
    )
  })
  it('summary CSV agrees with displayed aggregates without duplicating group tokens for certainty rows', () => {
    const state = summaryState()
    const lines = exportUsageSummaryCsv(state).trimEnd().split('\r\n')
    const header = cells(lines.shift()!)
    const rows = lines.map((line) => cells(line))
    expect(rows).toHaveLength(2)
    for (const [field, expected] of [
      ['records', 2],
      ['input', 100],
      ['output', 20],
      ['images', 2],
      ['usd', 0.25],
      ['durationMs', 1000],
    ] as const)
      expect(rows.reduce((sum, row) => sum + Number(row[header.indexOf(field)]), 0)).toBe(expected)
    expect(rows[0]?.[header.indexOf('label')]).toBe("'=FORMULA")
    expect(rows[1]?.[header.indexOf('certainty')]).toBe('unpriced')
    expect(rows[1]?.[header.indexOf('usd')]).toBe('')
  })
  it('versioned JSON includes raw, limits, old summaries and honest reader diagnostics', () => {
    const data = {
      ...journal([record('today'), { ...record('excluded'), day: '2026-10-06' }]),
      newerVersionRecords: 2,
      newerVersionFiles: 1,
      tornLines: 1,
      invalidLines: 1,
      rollups: rollupUsageRecords([{ ...record('old'), day: '2026-01-01' }]),
      limits: [
        {
          v: 1,
          type: 'limit',
          id: 'limit',
          at,
          day: '2026-10-05',
          timezoneOffsetMins: 0,
          client: 'cli',
          backend: 'museCode',
          provider: 'museCode',
          source: 'museCode',
          observedAt: at,
          windows: [],
        },
      ],
    } satisfies UsageJournalRead
    const result: unknown = JSON.parse(
      exportUsageJson(data, { from: '2026-01-01', to: '2026-10-05' }),
    )
    expect(result).toMatchObject({
      v: 1,
      range: { from: '2026-01-01', to: '2026-10-05' },
      records: [{ id: 'today' }],
      limits: [{ id: 'limit' }],
      rollups: [{ day: '2026-01-01', cost: { certainty: 'unpriced' } }],
      newerVersionRecords: 2,
      newerVersionFiles: 1,
      tornLines: 1,
      invalidLines: 1,
    })
    expect(JSON.stringify(result)).not.toContain('excluded')
  })
  it('validates export inputs so added prompt, path, digest and tool content cannot escape', () => {
    const smuggled = {
      ...record('canary'),
      prompt: 'private-canary',
      path: '/private-canary',
      keyDigest: 'private-canary',
      toolArguments: 'private-canary',
    }
    const data = journal([smuggled])
    expect(() => exportUsageCallsCsv(data, { from: '2026-10-05', to: '2026-10-05' }, at)).toThrow()
    expect(() => exportUsageJson(data, { from: '2026-01-01', to: '2026-10-05' })).toThrow()
    const privatePage = { ...summaryState(), prompt: 'private-canary' }
    expect(() => exportUsageSummaryCsv(privatePage)).toThrow()
  })
})

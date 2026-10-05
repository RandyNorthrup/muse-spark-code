// Lane L: the ledger's history queries — filters, search, sorting, totals,
// the record's figures and export (M96 acceptance 42, PLAN.md D75 "The team
// ledger").

import { describe, expect, it } from 'vitest'
import { REDACTED_MARK } from '../../src/shared/constants'
import {
  durationMs,
  entryFigures,
  exportHistoryCsv,
  exportHistoryJson,
  filterHistory,
  historyTotals,
  searchHistory,
  selectRetained,
  sortHistory,
  totalTokens,
  type TeamHistoryRow,
} from '../../src/core/team/teamHistory'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** A fixed Monday noon UTC, so day and week windows are exact. */
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0)

function row(overrides: Partial<TeamHistoryRow> & { readonly taskId: string }): TeamHistoryRow {
  return {
    roleId: 'engineering',
    entryId: 'e1',
    provider: 'model-api',
    model: 'muse-spark-1.3',
    outcome: 'merged',
    brief: 'fix the null dereference',
    reasonCode: 'delegate.large-change',
    startTime: NOW - HOUR,
    endTime: NOW - HOUR / 2,
    tokens: { input: 100, cachedInput: 20, output: 50, reasoning: 10 },
    estimated: false,
    modelCalls: 3,
    costUsd: 0.05,
    ...overrides,
  }
}

const rows: readonly TeamHistoryRow[] = [
  row({ taskId: 't1' }),
  row({
    taskId: 't2',
    entryId: 'e2',
    outcome: 'capped',
    startTime: NOW - 2 * HOUR,
    endTime: NOW - HOUR,
    tokens: { input: 120, cachedInput: 0, output: 60, reasoning: 20 },
    modelCalls: 4,
    costUsd: 0.1,
    brief: 'migrate the settings page',
  }),
  row({
    taskId: 't3',
    roleId: 'code-review',
    outcome: 'failed',
    model: 'other-model',
    startTime: NOW - 2 * DAY,
    endTime: NOW - 2 * DAY + 10 * 60_000,
    tokens: { input: 30, cachedInput: 0, output: 15, reasoning: 5 },
    estimated: true,
    modelCalls: 1,
    costUsd: undefined,
    brief: 'review the auth flow',
    findingSeverities: ['critical', 'Bogus'],
  }),
  row({
    taskId: 't4',
    outcome: 'interrupted',
    startTime: NOW - 10 * DAY,
    endTime: undefined,
    tokens: { input: 20, cachedInput: 0, output: 10, reasoning: 0 },
    modelCalls: 2,
    costUsd: 0.01,
    hookAddedTokens: 5,
    paidToolCostUsd: 0.002,
    roundsUsed: 2,
    brief: 'partial refactor of router',
    findingSeverities: ['high'],
  }),
  row({
    taskId: 't5',
    roleId: 'docs',
    entryId: 'e9',
    outcome: 'discarded',
    startTime: NOW - 3 * HOUR,
    endTime: NOW - 3 * HOUR + 30 * 60_000,
    tokens: { input: 10, cachedInput: 0, output: 10, reasoning: 0 },
    modelCalls: 1,
    costUsd: 0.02,
    brief: 'draft the changelog',
  }),
]

describe('filters', () => {
  it('filters by role, entry, model and outcome', () => {
    expect(filterHistory(rows, { roleIds: ['engineering'] }).map((item) => item.taskId)).toEqual([
      't1',
      't2',
      't4',
    ])
    expect(filterHistory(rows, { entryIds: ['e2'] }).map((item) => item.taskId)).toEqual(['t2'])
    expect(filterHistory(rows, { models: ['other-model'] }).map((item) => item.taskId)).toEqual([
      't3',
    ])
    expect(
      filterHistory(rows, { outcomes: ['merged', 'discarded'] }).map((item) => item.taskId),
    ).toEqual(['t1', 't5'])
  })

  it('combines filters', () => {
    expect(
      filterHistory(rows, { roleIds: ['engineering'], outcomes: ['merged'] }).map(
        (item) => item.taskId,
      ),
    ).toEqual(['t1'])
  })

  it('an empty filter keeps every row without mutating the input', () => {
    const before = rows.length
    const filtered = filterHistory(rows, {})
    expect(filtered).toHaveLength(before)
    expect(filtered).not.toBe(rows)
    expect(rows).toHaveLength(before)
  })

  it('the date range is start-inclusive and end-exclusive', () => {
    const start = NOW - HOUR
    expect(filterHistory(rows, { from: start }).some((item) => item.taskId === 't1')).toBe(true)
    expect(filterHistory(rows, { to: start }).some((item) => item.taskId === 't1')).toBe(false)
    expect(filterHistory(rows, { from: start, to: start + 1 }).map((item) => item.taskId)).toEqual([
      't1',
    ])
  })
})

describe('search', () => {
  it('matches text in the brief, case-insensitively', () => {
    expect(searchHistory(rows, 'NULL DEREFERENCE').map((item) => item.taskId)).toEqual(['t1'])
    expect(searchHistory(rows, 'review').map((item) => item.taskId)).toEqual(['t3'])
  })

  it('does not match other fields', () => {
    expect(searchHistory(rows, 'other-model')).toEqual([])
  })

  it('blank text matches everything', () => {
    expect(searchHistory(rows, ' '.repeat(3))).toHaveLength(rows.length)
  })
})

describe('sorting', () => {
  it('sorts by tokens both ways, stably', () => {
    const tied: readonly TeamHistoryRow[] = [
      row({ taskId: 'a', startTime: NOW - HOUR }),
      row({ taskId: 'b', startTime: NOW - 2 * HOUR }),
    ]
    expect(
      sortHistory(tied, { key: 'tokens', direction: 'asc' }).map((item) => item.taskId),
    ).toEqual(['a', 'b'])
    expect(
      sortHistory(rows, { key: 'tokens', direction: 'desc' }).map((item) => item.taskId),
    ).toEqual(['t2', 't1', 't3', 't4', 't5'])
  })

  it('sorts by cost with unpriced rows last in both directions', () => {
    expect(sortHistory(rows, { key: 'cost', direction: 'asc' }).map((item) => item.taskId)).toEqual(
      ['t4', 't5', 't1', 't2', 't3'],
    )
    expect(
      sortHistory(rows, { key: 'cost', direction: 'desc' }).map((item) => item.taskId),
    ).toEqual(['t2', 't1', 't5', 't4', 't3'])
  })

  it('sorts by duration with open rows last in both directions', () => {
    expect(
      sortHistory(rows, { key: 'duration', direction: 'asc' }).map((item) => item.taskId),
    ).toEqual(['t3', 't1', 't5', 't2', 't4'])
    expect(
      sortHistory(rows, { key: 'duration', direction: 'desc' }).map((item) => item.taskId),
    ).toEqual(['t2', 't1', 't5', 't3', 't4'])
  })
})

describe('totals', () => {
  it('totals today per role', () => {
    const totals = historyTotals(rows, { groupBy: 'role', period: 'day', now: NOW })
    const engineering = totals.find((item) => item.roleId === 'engineering')
    expect(engineering?.tasks).toBe(2)
    expect(engineering?.tokens).toBe(180 + 200)
    expect(engineering?.estimatedTokens).toBe(0)
    expect(engineering?.costUsd).toBeCloseTo(0.15, 10)
    expect(engineering?.unpricedTasks).toBe(0)
    expect(totals.find((item) => item.roleId === 'docs')?.tasks).toBe(1)
    expect(totals.some((item) => item.roleId === 'code-review')).toBe(false)
  })

  it('the week per entry counts the estimated, unpriced review', () => {
    const totals = historyTotals(rows, { groupBy: 'entry', period: 'week', now: NOW })
    const reviewed = totals.find((item) => item.roleId === 'code-review')
    expect(reviewed?.tasks).toBe(1)
    expect(reviewed?.tokens).toBe(50)
    expect(reviewed?.estimatedTokens).toBe(50)
    expect(reviewed?.unpricedTasks).toBe(1)
    expect(reviewed?.costUsd).toBe(0)
    expect(reviewed?.provider).toBe('model-api')
    expect(reviewed?.model).toBe('other-model')
  })

  it('all time keeps hook-added and paid-tool lines apart', () => {
    const totals = historyTotals(rows, { groupBy: 'role', period: 'all', now: NOW })
    const engineering = totals.find((item) => item.roleId === 'engineering')
    expect(engineering?.tasks).toBe(3)
    expect(engineering?.hookAddedTokens).toBe(5)
    expect(engineering?.paidToolCostUsd).toBeCloseTo(0.002, 10)
    expect(engineering?.tokens).toBe(180 + 200 + 30)
  })
})

describe('the record figures', () => {
  const pool = [
    { roleId: 'engineering', entryId: 'e2' },
    { roleId: 'engineering', entryId: 'e1' },
    { roleId: 'code-review', entryId: 'e1' },
  ] as const

  it('follows the pool order and never mutates it', () => {
    const order = pool.map((entry) => ({ ...entry }))
    Object.freeze(order)
    const figures = entryFigures(rows, order)
    expect(figures.map((figure) => figure.entryId)).toEqual(['e2', 'e1', 'e1'])
    expect(figures.map((figure) => figure.roleId)).toEqual([
      'engineering',
      'engineering',
      'code-review',
    ])
    expect(order.map((entry) => entry.entryId)).toEqual(['e2', 'e1', 'e1'])
  })

  it('counts outcomes, severities and averages per entry', () => {
    const figures = entryFigures(rows, pool)
    const first = figures[1]
    expect(first?.tasks).toBe(2)
    expect(first?.done).toBe(1)
    expect(first?.merged).toBe(1)
    expect(first?.interrupted).toBe(1)
    expect(first?.capped).toBe(0)
    expect(first?.findingsBySeverity).toEqual({ high: 1 })
    expect(first?.roundsToPassAvg).toBe(2)
    expect(first?.avgTokens).toBe((180 + 30) / 2)
    expect(first?.avgCostUsd).toBeCloseTo(0.03, 10)
    expect(first?.avgMinutes).toBe(30)
    const reviewed = figures[2]
    expect(reviewed?.failed).toBe(1)
    expect(reviewed?.findingsBySeverity).toEqual({ critical: 1, unknown: 1 })
    expect(reviewed?.roundsToPassAvg).toBeUndefined()
  })

  it('ignores rows for entries no longer in the pool', () => {
    const figures = entryFigures(rows, [{ roleId: 'engineering', entryId: 'e1' }])
    expect(figures).toHaveLength(1)
    expect(figures[0]?.tasks).toBe(2)
  })
})

function loadTranscript(row: TeamHistoryRow): string | undefined {
  return row.taskId === 't1' ? 'transcript body for t1' : undefined
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right)
}

describe('retention', () => {
  it('drops rows older than the cleanup period, and keeps all at zero', () => {
    expect(
      selectRetained(rows, NOW, 7)
        .map((item) => item.taskId)
        .toSorted(compareStrings),
    ).toEqual(['t1', 't2', 't3', 't5'].toSorted(compareStrings))
    expect(selectRetained(rows, NOW, 0)).toHaveLength(rows.length)
  })
})

describe('export', () => {
  it('CSV holds no transcript content by default, even with a loader', () => {
    const csv = exportHistoryCsv(rows, { loadTranscript })
    expect(csv).not.toContain('transcript')
    expect(csv).not.toContain('transcript body for t1')
    expect(csv.split('\n', 1)[0]).toContain('brief')
  })

  it('CSV includes transcripts only with the tick', () => {
    const csv = exportHistoryCsv(rows, { includeTranscripts: true, loadTranscript })
    expect(csv.split('\n', 1)[0]).toContain('transcript')
    expect(csv).toContain('transcript body for t1')
  })

  it('CSV escapes commas, quotes and newlines in the brief', () => {
    const tricky = row({ taskId: 'x', brief: 'say "hi", then\nleave' })
    const csv = exportHistoryCsv([tricky])
    expect(csv).toContain('"say ""hi"", then\nleave"')
  })

  it('JSON holds no transcript key by default', () => {
    const parsed = JSON.parse(exportHistoryJson(rows, { loadTranscript })) as unknown[]
    expect(parsed).toHaveLength(rows.length)
    for (const item of parsed) {
      expect(item).not.toHaveProperty('transcript')
    }
  })

  it('JSON includes the transcript with the tick', () => {
    const parsed = JSON.parse(
      exportHistoryJson(rows, { includeTranscripts: true, loadTranscript }),
    ) as { readonly taskId: string; readonly transcript?: string }[]
    expect(parsed.find((item) => item.taskId === 't1')?.transcript).toBe('transcript body for t1')
    expect(parsed.find((item) => item.taskId === 't2')).not.toHaveProperty('transcript')
  })

  it('a secret in a brief reaches the export only as the mark', () => {
    const secret = row({
      taskId: 's',
      brief: 'use Bearer abcdefgh12345678 to call the service',
    })
    const csv = exportHistoryCsv([secret])
    expect(csv).not.toContain('abcdefgh12345678')
    expect(csv).toContain(REDACTED_MARK)
    const parsed = JSON.parse(exportHistoryJson([secret])) as { readonly brief: string }[]
    expect(parsed[0]?.brief).not.toContain('abcdefgh12345678')
  })
})

describe('measures', () => {
  it('totals tokens by kind and durations by end minus start', () => {
    expect(totalTokens(rows[0] ?? row({ taskId: 'z' }))).toBe(180)
    expect(durationMs(rows[0] ?? row({ taskId: 'z' }))).toBe(30 * 60_000)
    expect(durationMs(rows[3] ?? row({ taskId: 'z' }))).toBeUndefined()
  })
})

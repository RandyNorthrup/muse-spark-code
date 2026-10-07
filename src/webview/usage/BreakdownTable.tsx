import { useState } from 'react'
import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import type { UsageTotals } from '../../shared/usagePage'
import { billedCost, count, costText, duration, type BreakdownRow, type PostUsage } from './display'

type SortKey = 'name' | 'cost' | 'input' | 'output' | 'requests' | 'time'
function sortValue(row: BreakdownRow, key: SortKey): string | number | undefined {
  const totals = row.totals
  switch (key) {
    case 'name': {
      return row.label
    }
    case 'cost': {
      return billedCost(totals)
    }
    case 'input': {
      return totals.tokens.input
    }
    case 'output': {
      return totals.tokens.output
    }
    case 'requests': {
      return totals.records
    }
    case 'time': {
      return totals.durationMs
    }
  }
}
export function TotalCells({ totals }: { readonly totals: UsageTotals }) {
  return (
    <>
      <td>{costText(totals)}</td>
      <td>{count(totals.tokens.input)}</td>
      <td>{count(totals.tokens.output)}</td>
      <td>{count(totals.tokens.cached)}</td>
      <td>{count(totals.tokens.cacheWrite)}</td>
      <td>{count(totals.tokens.reasoning)}</td>
      <td>{count(totals.records)}</td>
      <td>{duration(totals.durationMs)}</td>
      <td>{count(totals.retries)}</td>
      <td>{count(totals.rateLimited)}</td>
    </>
  )
}
export function BreakdownTable({
  rows,
  post,
}: {
  readonly rows: readonly BreakdownRow[]
  readonly post: PostUsage
}) {
  const [sort, setSort] = useState<SortKey>('name')
  const [ascending, setAscending] = useState(true)
  if (rows.length === 0)
    return (
      <section>
        <h2>{USAGE_TEXT.breakdown}</h2>
        <p>{USAGE_TEXT.emptyRange}</p>
      </section>
    )
  const sorted = rows.toSorted((a, b) => {
    const left = sortValue(a, sort)
    const right = sortValue(b, sort)
    // Unknown remains unknown and sorts last in both directions.
    if (left === undefined) return right === undefined ? a.id.localeCompare(b.id) : 1
    if (right === undefined) return -1
    const comparison =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right)
        : Number(left) - Number(right)
    return (ascending ? comparison : -comparison) || a.id.localeCompare(b.id)
  })
  function heading(key: SortKey, label: string) {
    return (
      <th scope="col" aria-sort={sort === key ? (ascending ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          aria-label={`${label}: ${sort === key && ascending ? USAGE_TEXT.sortDescending : USAGE_TEXT.sortAscending}`}
          onClick={() => {
            setSort(key)
            setAscending(sort !== key || !ascending)
          }}
        >
          {label} {sort === key ? (ascending ? '↑' : '↓') : ''}
        </button>
      </th>
    )
  }
  return (
    <section>
      <h2>{USAGE_TEXT.breakdown}</h2>
      <div
        className="usage-table-scroll"
        role="region"
        aria-label={USAGE_TEXT.breakdown}
        tabIndex={0}
      >
        <table>
          <caption>{USAGE_TEXT.breakdown}</caption>
          <thead>
            <tr>
              {heading('name', USAGE_TEXT.nameColumn)}
              {heading('cost', USAGE_TEXT.cost)}
              {heading('input', USAGE_TEXT.inputTokens)}
              {heading('output', USAGE_TEXT.outputTokens)}
              <th scope="col">{USAGE_TEXT.cachedTokens}</th>
              <th scope="col">{USAGE_TEXT.cacheWriteTokens}</th>
              <th scope="col">{USAGE_TEXT.reasoningTokens}</th>
              {heading('requests', USAGE_TEXT.requests)}
              {heading('time', USAGE_TEXT.time)}
              <th scope="col">{USAGE_TEXT.retries}</th>
              <th scope="col">{USAGE_TEXT.rateLimited}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  {row.provider === undefined || row.model === undefined ? (
                    row.label
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (row.provider !== undefined && row.model !== undefined)
                          post({
                            type: 'usage/modelDetail',
                            provider: row.provider,
                            model: row.model,
                          })
                      }}
                    >
                      {row.label}
                    </button>
                  )}
                </th>
                <TotalCells totals={row.totals} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

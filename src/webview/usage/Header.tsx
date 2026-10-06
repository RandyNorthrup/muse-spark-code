import { useId, useState } from 'react'
import { USAGE_DETAIL_DAYS } from '../../shared/constants'
import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import { plural } from '../../shared/l10n/text'
import { usageQuerySchema, type UsageQuery } from '../../shared/usagePage'
import { groupLabel, metricLabel, type PostUsage } from './display'

export function Header({
  query,
  busy,
  post,
  onQuery,
}: {
  readonly query: UsageQuery
  readonly busy: boolean
  readonly post: PostUsage
  readonly onQuery: (query: UsageQuery) => void
}) {
  const id = useId()
  const [custom, setCustom] = useState(query.range === 'custom')
  const [from, setFrom] = useState(query.from ?? '')
  const [to, setTo] = useState(query.to ?? '')
  const [invalid, setInvalid] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [rangeQuery, setRangeQuery] = useState(query)
  if (
    rangeQuery.range !== query.range ||
    rangeQuery.from !== query.from ||
    rangeQuery.to !== query.to
  ) {
    setRangeQuery(query)
    setCustom(query.range === 'custom')
    setFrom(query.from ?? '')
    setTo(query.to ?? '')
    setInvalid(false)
  }
  function rangeLabel(range: UsageQuery['range']) {
    if (range === 'today') return USAGE_TEXT.today
    return range === 'custom'
      ? USAGE_TEXT.customRange
      : plural(USAGE_TEXT.rangeDays, Number(range.slice(0, -1)))
  }
  function customQuery(nextFrom: string, nextTo: string) {
    const parsed = usageQuerySchema.safeParse({
      ...query,
      range: 'custom',
      from: nextFrom,
      to: nextTo,
    })
    setInvalid(!parsed.success)
    if (parsed.success) onQuery(parsed.data)
  }
  return (
    <header className="usage-page-header">
      <h1>{USAGE_TEXT.title}</h1>
      <p>{USAGE_TEXT.subtitle}</p>
      <fieldset className="usage-range">
        <legend>{USAGE_TEXT.range}</legend>
        {(['today', '7d', '30d', '90d', 'custom'] as const).map((range) => (
          <label key={range}>
            <input
              type="radio"
              name={`${id}-range`}
              checked={range === 'custom' ? custom : !custom && query.range === range}
              onChange={() => {
                setCustom(range === 'custom')
                setInvalid(false)
                if (range === 'custom') customQuery(from, to)
                else onQuery({ range, groupBy: query.groupBy, metric: query.metric })
              }}
            />
            {rangeLabel(range)}
          </label>
        ))}
      </fieldset>
      {custom ? (
        <div className="usage-controls">
          <label>
            {USAGE_TEXT.fromDate}
            <input
              type="date"
              value={from}
              aria-invalid={invalid}
              aria-describedby={invalid ? `${id}-range-error` : undefined}
              onChange={(event) => {
                setFrom(event.target.value)
                customQuery(event.target.value, to)
              }}
            />
          </label>
          <label>
            {USAGE_TEXT.toDate}
            <input
              type="date"
              value={to}
              aria-invalid={invalid}
              aria-describedby={invalid ? `${id}-range-error` : undefined}
              onChange={(event) => {
                setTo(event.target.value)
                customQuery(from, event.target.value)
              }}
            />
          </label>
          {invalid ? (
            <p id={`${id}-range-error`} role="alert">
              {USAGE_TEXT.invalidRange}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="usage-controls">
        <label>
          {USAGE_TEXT.groupBy}
          <select
            value={query.groupBy}
            onChange={(event) => {
              const parsed = usageQuerySchema.safeParse({ ...query, groupBy: event.target.value })
              if (parsed.success) onQuery(parsed.data)
            }}
          >
            {(['provider', 'model', 'kind', 'client'] as const).map((group) => (
              <option key={group} value={group}>
                {groupLabel(group)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {USAGE_TEXT.metric}
          <select
            value={query.metric}
            onChange={(event) => {
              const parsed = usageQuerySchema.safeParse({ ...query, metric: event.target.value })
              if (parsed.success) onQuery(parsed.data)
            }}
          >
            {(['cost', 'tokens', 'requests', 'time'] as const).map((metric) => (
              <option key={metric} value={metric}>
                {metricLabel(metric)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            post({ type: 'usage/refresh' })
          }}
        >
          {USAGE_TEXT.refresh}
        </button>
        <div className="usage-export">
          <button
            type="button"
            aria-expanded={exportOpen}
            aria-controls={`${id}-exports`}
            onClick={() => {
              setExportOpen(!exportOpen)
            }}
          >
            {USAGE_TEXT.export}
          </button>
          {exportOpen ? (
            <div
              id={`${id}-exports`}
              className="usage-export-options"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setExportOpen(false)
              }}
            >
              {(['callsCsv', 'summaryCsv', 'json'] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => {
                    post({ type: 'usage/export', requestId: crypto.randomUUID(), query, format })
                    setExportOpen(false)
                  }}
                >
                  {
                    {
                      callsCsv: plural(USAGE_TEXT.exportCallsCsv, USAGE_DETAIL_DAYS),
                      summaryCsv: USAGE_TEXT.exportSummaryCsv,
                      json: USAGE_TEXT.exportJson,
                    }[format]
                  }
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            post({ type: 'usage/deleteHistory', requestId: crypto.randomUUID() })
          }}
        >
          {USAGE_TEXT.deleteHistory}
        </button>
        <button
          type="button"
          onClick={() => {
            post({ type: 'usage/openSettings' })
          }}
        >
          {USAGE_TEXT.settings}
        </button>
        <button
          type="button"
          onClick={() => {
            post({ type: 'usage/revealFolder' })
          }}
        >
          {USAGE_TEXT.revealFolder}
        </button>
      </div>
    </header>
  )
}

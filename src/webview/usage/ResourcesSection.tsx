import { useMemo, useState } from 'react'
import {
  UI_TEXT,
  RESOURCE_HISTORY_MINUTE_MS,
  RESOURCE_HISTORY_PAGE_SIZE,
} from '../../shared/constants'
import { fill, formatBytes, formatNumber, formatPercent, formatUnit } from '../../shared/l10n/text'
import {
  resourceHistoryBucket,
  resourceHistoryDateTime,
  resourceHistoryEventDetail,
  resourceHistoryEventName,
  resourceHistoryLevel,
  resourceHistorySchema,
  type ResourceHistory,
} from '../../shared/resourceHistory'
import './ResourcesSection.css'

export interface ResourcesSectionProps {
  /** The shared usage bridge supplies the validated aggregate, never raw trees. */
  readonly history: unknown
}

const percent = (value: number | null) =>
  value === null ? UI_TEXT.resourceUnknown : formatPercent(value)

function intervals(history: ResourceHistory, nextAtMs: number) {
  return history.minutes.map((record, index) => ({
    record,
    endMs: Math.min(
      history.minutes[index + 1]?.atMs ?? nextAtMs,
      (Math.floor(record.atMs / RESOURCE_HISTORY_MINUTE_MS) + 1) * RESOURCE_HISTORY_MINUTE_MS,
    ),
  }))
}

function historyPage<T>(entries: readonly T[], requestedPage: number) {
  const page = Math.min(
    requestedPage,
    Math.max(0, Math.ceil(entries.length / RESOURCE_HISTORY_PAGE_SIZE) - 1),
  )
  const end = entries.length - page * RESOURCE_HISTORY_PAGE_SIZE
  return { page, end, entries: entries.slice(Math.max(0, end - RESOURCE_HISTORY_PAGE_SIZE), end) }
}

function HistoryPager({
  length,
  page,
  onPage,
  label,
}: {
  readonly length: number
  readonly page: number
  readonly onPage: (page: number) => void
  readonly label: string
}) {
  const pages = Math.ceil(length / RESOURCE_HISTORY_PAGE_SIZE)
  if (pages <= 1) return null
  return (
    <nav className="usage-resource-pages" aria-label={label}>
      <button
        type="button"
        disabled={page === 0}
        onClick={() => {
          onPage(page - 1)
        }}
      >
        {UI_TEXT.resourceHistoryNewer}
      </button>
      <span role="status">
        {fill(UI_TEXT.resourceHistoryPage, {
          page: formatNumber(page + 1),
          pages: formatNumber(pages),
        })}
      </span>
      <button
        type="button"
        disabled={page + 1 >= pages}
        onClick={() => {
          onPage(page + 1)
        }}
      >
        {UI_TEXT.resourceHistoryOlder}
      </button>
    </nav>
  )
}

function ResourceChart({
  history,
  metric,
  nextAtMs,
}: {
  readonly history: ResourceHistory
  readonly metric: 'cpuPercent' | 'memoryUsedPercent'
  readonly nextAtMs: number
}) {
  const spans = intervals(history, nextAtMs)
  const start = spans[0]?.record.atMs ?? 0
  const end = spans.at(-1)?.endMs ?? start + 1
  const width = Math.max(1, end - start)
  const x = (atMs: number) => ((atMs - start) / width) * 100
  const label = metric === 'cpuPercent' ? UI_TEXT.resourceCpu : UI_TEXT.resourceMemory
  return (
    <figure className="usage-resource-chart">
      <figcaption>{label}</figcaption>
      <svg viewBox="0 0 100 100" role="img" aria-label={label} preserveAspectRatio="none">
        {spans.map(({ record, endMs }, index) => {
          const minute = record.minute
          if (minute === null) return null
          const value = minute[metric]
          const limit =
            metric === 'cpuPercent'
              ? minute.thresholds.cpuMaxPercent
              : minute.thresholds.memoryMaxPercent
          const next = spans[index + 1]?.record.minute?.[metric]
          const isConnected =
            endMs === spans[index + 1]?.record.atMs && value !== null && next != null
          return (
            <g key={`${String(record.atMs)}:${String(index)}`}>
              <path
                className="usage-resource-limit"
                data-limit={limit}
                d={`M ${String(x(record.atMs))} ${String(100 - limit)} H ${String(x(endMs))}`}
              />
              {value === null ? null : (
                <path
                  className="usage-resource-reading"
                  data-reading={value}
                  d={`M ${String(x(record.atMs))} ${String(100 - value)} H ${String(x(endMs))}${isConnected ? ` V ${String(100 - next)}` : ''}`}
                />
              )}
            </g>
          )
        })}
      </svg>
      <div className="usage-resource-legend">
        <span>
          {formatPercent(0)} – {formatPercent(100)}
        </span>
        <span className="usage-resource-limit-label">{UI_TEXT.resourceHistoryThreshold}</span>
      </div>
    </figure>
  )
}

/** Shared usage page section for VS Code, MHP and the companion; no editor API. */
export default function ResourcesSection({ history: raw }: ResourcesSectionProps) {
  const parsed = useMemo(() => resourceHistorySchema.safeParse(raw), [raw])
  const [minutePageIndex, setMinutePage] = useState(0)
  const [eventPageIndex, setEventPage] = useState(0)
  if (!parsed.success)
    return (
      <section className="usage-resources">
        <h2>{UI_TEXT.resourceTitle}</h2>
        <p role="alert">{UI_TEXT.resourceHistoryInvalid}</p>
      </section>
    )
  const history = parsed.data
  const minutePage = historyPage(history.minutes, minutePageIndex)
  const eventPage = historyPage(history.events, eventPageIndex)
  const visibleHistory = { ...history, minutes: minutePage.entries }
  const nextAtMs = history.minutes[minutePage.end]?.atMs ?? Infinity
  const spans = intervals(visibleHistory, nextAtMs)
  const start = spans[0]?.record.atMs ?? 0
  const width = Math.max(1, (spans.at(-1)?.endMs ?? start) - start)
  return (
    <section className="usage-resources" aria-label={UI_TEXT.resourceTitle}>
      <h2>{UI_TEXT.resourceTitle}</h2>
      <p>{UI_TEXT.resourceHistoryObserved}</p>
      {history.minutes.length + history.events.length === 0 ? null : (
        <p>{UI_TEXT.resourceHistoryDetailNotice}</p>
      )}
      {history.minutes.length === 0 && history.events.length === 0 ? (
        <p>{UI_TEXT.resourceHistoryEmpty}</p>
      ) : null}
      {history.minutes.length === 0 ? null : (
        <>
          <div className="usage-resource-charts">
            <ResourceChart history={visibleHistory} metric="cpuPercent" nextAtMs={nextAtMs} />
            <ResourceChart
              history={visibleHistory}
              metric="memoryUsedPercent"
              nextAtMs={nextAtMs}
            />
          </div>
          <div className="usage-resource-band" role="img" aria-label={UI_TEXT.resourceHistoryLevel}>
            {spans.map(({ record, endMs }, index) =>
              record.minute === null ? null : (
                <span
                  key={`${String(record.atMs)}:${String(index)}`}
                  data-level={record.minute.level}
                  title={`${resourceHistoryDateTime(record.atMs)}: ${resourceHistoryLevel(record.minute.level)}`}
                  style={{
                    left: `${String(((record.atMs - start) / width) * 100)}%`,
                    width: `${String(((endMs - record.atMs) / width) * 100)}%`,
                  }}
                />
              ),
            )}
          </div>
          <div
            className="usage-resource-table"
            role="region"
            aria-label={UI_TEXT.resourceHistory}
            tabIndex={0}
          >
            <table>
              <caption>{UI_TEXT.resourceHistory}</caption>
              <thead>
                <tr>
                  <th scope="col">{UI_TEXT.resourceHistoryTime}</th>
                  <th scope="col">{UI_TEXT.resourceHistoryLevel}</th>
                  <th scope="col">
                    {UI_TEXT.resourceCpu} / {UI_TEXT.resourceHistoryThreshold}
                  </th>
                  <th scope="col">
                    {UI_TEXT.resourceMemory} / {UI_TEXT.resourceHistoryThreshold}
                  </th>
                  <th scope="col">{UI_TEXT.resourceAvailableMemory}</th>
                  <th scope="col">{UI_TEXT.resourceGpu}</th>
                  <th scope="col">{UI_TEXT.resourceDisk}</th>
                </tr>
              </thead>
              <tbody>
                {minutePage.entries.map((record, index) =>
                  record.minute === null ? null : (
                    <tr key={`${String(record.atMs)}:${String(index)}`}>
                      <th scope="row">{resourceHistoryDateTime(record.atMs)}</th>
                      <td>{resourceHistoryLevel(record.minute.level)}</td>
                      <td>
                        {percent(record.minute.cpuPercent)} /{' '}
                        {formatPercent(record.minute.thresholds.cpuMaxPercent)}
                      </td>
                      <td>
                        {percent(record.minute.memoryUsedPercent)} /{' '}
                        {formatPercent(record.minute.thresholds.memoryMaxPercent)}
                      </td>
                      <td>{resourceHistoryBucket(record.minute.availableMemory)}</td>
                      <td>{percent(record.minute.gpuPercent)}</td>
                      <td>{percent(record.minute.diskBusyPercent)}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <HistoryPager
            length={history.minutes.length}
            page={minutePage.page}
            onPage={setMinutePage}
            label={UI_TEXT.resourceHistory}
          />
        </>
      )}
      {history.events.length === 0 ? null : (
        <div
          className="usage-resource-table"
          role="region"
          aria-label={UI_TEXT.resourceHistoryEvents}
          tabIndex={0}
        >
          <table>
            <caption>{UI_TEXT.resourceHistoryEvents}</caption>
            <thead>
              <tr>
                <th scope="col">{UI_TEXT.resourceHistoryTime}</th>
                <th scope="col">{UI_TEXT.resourceHistoryEvents}</th>
              </tr>
            </thead>
            <tbody>
              {eventPage.entries.map((event, index) => (
                <tr key={index}>
                  <th scope="row">{resourceHistoryDateTime(event.atMs)}</th>
                  <td>
                    {resourceHistoryEventName(event.type)}: {resourceHistoryEventDetail(event)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <HistoryPager
            length={history.events.length}
            page={eventPage.page}
            onPage={setEventPage}
            label={UI_TEXT.resourceHistoryEvents}
          />
          <table>
            <caption>{UI_TEXT.resourceHistoryCount}</caption>
            <thead>
              <tr>
                <th scope="col">{UI_TEXT.resourceHistoryEvents}</th>
                <th scope="col">{UI_TEXT.resourceHistoryKind}</th>
                <th scope="col">{UI_TEXT.resourceHistoryCount}</th>
              </tr>
            </thead>
            <tbody>
              {history.counts.map((row) => (
                <tr key={`${row.type}:${row.kind ?? ''}`}>
                  <th scope="row">{resourceHistoryEventName(row.type)}</th>
                  <td>{row.kind ?? UI_TEXT.resourceTitle}</td>
                  <td>{formatNumber(row.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.work.length === 0 ? null : (
        <div
          className="usage-resource-table"
          role="region"
          aria-label={UI_TEXT.resourceHarness}
          tabIndex={0}
        >
          <table>
            <caption>{UI_TEXT.resourceHarness}</caption>
            <thead>
              <tr>
                <th scope="col">{UI_TEXT.resourceHistoryKind}</th>
                <th scope="col">{UI_TEXT.resourceCpuTime}</th>
                <th scope="col">{UI_TEXT.resourcePeakMemory}</th>
              </tr>
            </thead>
            <tbody>
              {history.work.map((row) => (
                <tr key={row.kind}>
                  <th scope="row">
                    <code>{row.kind}</code>
                  </th>
                  <td>{formatUnit(row.cpuSeconds, 'second')}</td>
                  <td>{formatBytes(row.peakMemoryBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

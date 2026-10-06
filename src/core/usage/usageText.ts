import { UI_TEXT } from '../../shared/constants'
import { formatBytes, formatNumber, formatPercent, formatUnit } from '../../shared/l10n/text'
import {
  resourceHistoryBucket,
  resourceHistoryDateTime,
  resourceHistoryEventDetail,
  resourceHistoryEventName,
  resourceHistoryLevel,
} from '../../shared/resourceHistory'
import type { ResourceRecord } from '../../shared/resources'
import { aggregateResources } from './aggregate'

/** J's resource branch for /usage resources and usage resources; no runtime-only imports. */
export function usageResourcesText(records: readonly ResourceRecord[]): string {
  const history = aggregateResources(records)
  const lines = [UI_TEXT.resourceTitle, UI_TEXT.resourceHistoryObserved]
  if (history.minutes.length === 0 && history.events.length === 0)
    return [...lines, UI_TEXT.resourceHistoryEmpty].join('\n')
  lines.push(UI_TEXT.resourceHistoryDetailNotice)
  const percent = (value: number | null) =>
    value === null ? UI_TEXT.resourceUnknown : formatPercent(value)
  for (const record of history.minutes) {
    const minute = record.minute
    if (minute === null) continue
    lines.push(
      [
        resourceHistoryDateTime(record.atMs),
        resourceHistoryLevel(minute.level),
        `${UI_TEXT.resourceCpu}: ${percent(minute.cpuPercent)} / ${formatPercent(minute.thresholds.cpuMaxPercent)}`,
        `${UI_TEXT.resourceMemory}: ${percent(minute.memoryUsedPercent)} / ${formatPercent(minute.thresholds.memoryMaxPercent)}`,
        `${UI_TEXT.resourceAvailableMemory}: ${resourceHistoryBucket(minute.availableMemory)}`,
        `${UI_TEXT.resourceGpu}: ${percent(minute.gpuPercent)}`,
        `${UI_TEXT.resourceDisk}: ${percent(minute.diskBusyPercent)}`,
      ].join(' · '),
    )
  }
  lines.push(UI_TEXT.resourceHistoryEvents)
  for (const event of history.events)
    lines.push(
      `${resourceHistoryDateTime(event.atMs)}: ${resourceHistoryEventName(event.type)}: ${resourceHistoryEventDetail(event)}`,
    )
  for (const row of history.counts)
    lines.push(
      `${resourceHistoryEventName(row.type)}${row.kind === null ? '' : ` (${row.kind})`}: ${formatNumber(row.count)}`,
    )
  lines.push(UI_TEXT.resourceHarness)
  for (const row of history.work)
    lines.push(
      `${row.kind}: ${UI_TEXT.resourceCpuTime}: ${formatUnit(row.cpuSeconds, 'second')}, ${UI_TEXT.resourcePeakMemory}: ${formatBytes(row.peakMemoryBytes)}`,
    )
  return lines.join('\n')
}

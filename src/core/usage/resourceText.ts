import { UI_TEXT } from '../../shared/constants'
import { formatBytes, formatNumber, formatPercent, formatUnit } from '../../shared/l10n/text'
import {
  isResourceHistoryCurrentMinute,
  resourceHistoryDayCpuSeconds,
  resourceHistoryLevelMinutes,
  resourceHistoryBucket,
  resourceHistoryDateTime,
  resourceHistoryEventDetail,
  resourceHistoryEventName,
  resourceHistoryLevel,
  resourceHistorySchema,
  type ResourceHistory,
} from '../../shared/resourceHistory'

const percent = (value: number | null) =>
  value === null ? UI_TEXT.resourceUnknown : formatPercent(value)

/**
 * J's resource branch for `/usage resources`, `usage resources` and
 * `resources history`: the usage page's Resources section as text, from the
 * same validated aggregate. The minute containing `now` is labelled as this
 * minute so far. No usage-table or runtime-only imports.
 */
export function resourceHistoryText(input: ResourceHistory, now = Date.now()): string {
  const history = resourceHistorySchema.parse(input)
  const days = history.days ?? []
  const lines = [UI_TEXT.resourceTitle, UI_TEXT.resourceHistoryObserved]
  if (history.minutes.length === 0 && history.events.length === 0 && days.length === 0)
    return [...lines, UI_TEXT.resourceHistoryEmpty].join('\n')
  lines.push(UI_TEXT.resourceHistoryDetailNotice)
  for (const record of history.minutes) {
    const minute = record.minute
    if (minute === null) continue
    lines.push(
      [
        resourceHistoryDateTime(record.atMs),
        ...(isResourceHistoryCurrentMinute(record.atMs, now)
          ? [UI_TEXT.resourceHistoryCurrentMinute]
          : []),
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
  if (days.length > 0) {
    lines.push(UI_TEXT.resourceHistoryDaily, UI_TEXT.resourceHistoryDailyNotice)
    for (const day of days)
      lines.push(
        [
          `${UI_TEXT.resourceHistoryDay}: ${day.day}`,
          `${UI_TEXT.resourceCpu} (${UI_TEXT.resourceHistoryAverage}): ${percent(day.cpuPercent)}`,
          `${UI_TEXT.resourceMemory} (${UI_TEXT.resourceHistoryAverage}): ${percent(day.memoryUsedPercent)}`,
          `${UI_TEXT.resourceHistoryMinutes}: ${formatNumber(day.minutes)}`,
          `${UI_TEXT.resourceHistoryLevelMinutes}: ${resourceHistoryLevelMinutes(day.levels)}`,
          `${UI_TEXT.resourceHistoryEvents}: ${formatNumber(day.events)}`,
          `${UI_TEXT.resourceHarness}: ${formatUnit(resourceHistoryDayCpuSeconds(day), 'second')}`,
        ].join(' · '),
      )
  }
  return lines.join('\n')
}

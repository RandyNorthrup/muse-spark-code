import { RESOURCE_GIB_BYTES, UI_TEXT } from '../../shared/constants'
import {
  fill,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatUnit,
} from '../../shared/l10n/text'
import {
  resourceMemoryFloorBytes,
  resourceRecordSchema,
  resourceStatusSchema,
  type ResourceEvent,
  type ResourceLevel,
  type ResourceRecord,
  type ResourceStatus,
} from '../../shared/resources'

export function resourceLevelText(level: ResourceLevel): string {
  switch (level) {
    case 'normal': {
      return UI_TEXT.resourceNormal
    }
    case 'throttle': {
      return UI_TEXT.resourceThrottle
    }
    case 'relocate': {
      return UI_TEXT.resourceRelocate
    }
    case 'pause': {
      return UI_TEXT.resourcePause
    }
  }
}
const percentage = (value: number | null | undefined) =>
  value == null ? UI_TEXT.resourceUnknown : formatPercent(value)

export function resourceStatusText(raw: ResourceStatus): string {
  const status = resourceStatusSchema.parse(raw)
  const { sample, settings } = status
  const floor =
    sample?.memoryTotalBytes == null
      ? settings.memoryMinFreeGiB * RESOURCE_GIB_BYTES
      : resourceMemoryFloorBytes(settings, sample.memoryTotalBytes)
  const lines = [
    `${UI_TEXT.resourceTitle}: ${resourceLevelText(status.level)}`,
    `${UI_TEXT.resourceCpu}: ${percentage(sample?.cpuPercent)} (${formatPercent(settings.cpuMaxPercent)})`,
    `${UI_TEXT.resourceMemory}: ${percentage(sample?.memoryUsedPercent)} (${formatPercent(settings.memoryMaxPercent)})`,
    `${UI_TEXT.resourceAvailableMemory}: ${sample?.memoryAvailableBytes == null ? UI_TEXT.resourceUnknown : formatBytes(sample.memoryAvailableBytes)} (${formatBytes(floor)})`,
  ]
  if (settings.gpuMaxPercent !== null)
    lines.push(
      `${UI_TEXT.resourceGpu}: ${percentage(sample?.gpuPercent)} (${formatPercent(settings.gpuMaxPercent)})`,
    )
  if (settings.diskBusyMaxPercent !== null)
    lines.push(
      `${UI_TEXT.resourceDisk}: ${percentage(sample?.diskBusyPercent)} (${formatPercent(settings.diskBusyMaxPercent)})`,
    )
  for (const row of status.queued)
    lines.push(`${UI_TEXT.resourceWaiting}: ${row.kind} (${row.class}): ${formatNumber(row.count)}`)
  if (status.overrideUntilMs !== null)
    lines.push(
      fill(UI_TEXT.resourceOverrideNotice, { time: formatDateTime(status.overrideUntilMs) }),
    )
  return lines.join('\n')
}

/** Only metric/threshold values, never tree or command details. */
export function resourceNoticeText(event: ResourceEvent, status: ResourceStatus): string {
  if (event.type === 'override')
    return fill(UI_TEXT.resourceOverrideNotice, { time: formatDateTime(event.untilMs) })
  if (status.level !== 'pause') return resourceStatusText(status)
  const sample = status.sample
  const reason = event.type === 'levelChanged' ? event.reason : undefined
  const isFree =
    reason === 'memoryFree' ||
    (reason === 'critical' &&
      sample?.memoryAvailableBytes != null &&
      sample.memoryTotalBytes !== null &&
      sample.memoryAvailableBytes <
        resourceMemoryFloorBytes(status.settings, sample.memoryTotalBytes) / 2)
  let metric = UI_TEXT.resourceCpu
  let reading = percentage(sample?.cpuPercent)
  let threshold = percentage(status.settings.cpuMaxPercent)
  switch (reason) {
    case 'memoryUsed': {
      metric = UI_TEXT.resourceMemory
      reading = percentage(sample?.memoryUsedPercent)
      threshold = percentage(status.settings.memoryMaxPercent)
      break
    }
    case 'gpu': {
      metric = UI_TEXT.resourceGpu
      reading = percentage(sample?.gpuPercent)
      threshold = percentage(status.settings.gpuMaxPercent)
      break
    }
    case 'disk': {
      metric = UI_TEXT.resourceDisk
      reading = percentage(sample?.diskBusyPercent)
      threshold = percentage(status.settings.diskBusyMaxPercent)
      break
    }
    default: {
      break
    }
  }
  if (isFree) {
    metric = UI_TEXT.resourceAvailableMemory
    reading =
      sample?.memoryAvailableBytes == null
        ? UI_TEXT.resourceUnknown
        : formatBytes(sample.memoryAvailableBytes)
    threshold =
      sample?.memoryTotalBytes == null
        ? UI_TEXT.resourceUnknown
        : formatBytes(resourceMemoryFloorBytes(status.settings, sample.memoryTotalBytes))
  }
  return [
    fill(UI_TEXT.resourcePauseNotice, { metric, reading, threshold }),
    resourceStatusText(status),
    `${UI_TEXT.resourceResumeNow}: /resources resume`,
    UI_TEXT.openSettings,
    `${UI_TEXT.resourceShow}: /resources`,
  ].join('\n')
}

export function resourceHistoryText(records: readonly ResourceRecord[]): string {
  return [
    UI_TEXT.resourceHistory,
    ...records.map((raw) => {
      const record = resourceRecordSchema.parse(raw)
      const detail =
        record.minute === null
          ? JSON.stringify(record.event)
          : `${resourceLevelText(record.minute.level)} · ${UI_TEXT.resourceCpu}: ${percentage(record.minute.cpuPercent)} · ${UI_TEXT.resourceMemory}: ${percentage(record.minute.memoryUsedPercent)}`
      const work = record.work.map(
        (row) =>
          `${row.kind}: ${UI_TEXT.resourceCpuTime}: ${formatUnit(row.cpuSeconds, 'second')}, ${UI_TEXT.resourcePeakMemory}: ${formatBytes(row.peakMemoryBytes)}`,
      )
      return [`${formatDateTime(record.atMs)}: ${detail}`, ...work].join('\n')
    }),
  ].join('\n')
}

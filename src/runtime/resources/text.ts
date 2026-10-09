import {
  RESOURCE_SERVICE_PRESSURE_PERCENT,
  RESOURCE_TRANSPORT_FAILURE_PERCENT,
  RESOURCE_CRITICAL_CPU_PERCENT,
  RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION,
  RESOURCE_GIB_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import {
  fill,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../../shared/l10n/text'
import {
  resourceMemoryFloorBytes,
  resourceStatusSchema,
  type ResourceEvent,
  type ResourceLevel,
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
  if (status.relocation === 'noRoute') lines.push(UI_TEXT.resourceRelocationNoRoute)
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
  const details = [
    resourceStatusText(status),
    `${UI_TEXT.resourceResumeNow}: /resources resume`,
    UI_TEXT.openSettings,
    `${UI_TEXT.resourceShow}: /resources`,
  ]
  // A deferred/paused event has no trigger metric. Show its level/readings honestly.
  if (event.type !== 'levelChanged') return [UI_TEXT.resourceWaiting, ...details].join('\n')
  const sample = status.sample
  const reason = event.reason
  const isFree =
    reason === 'memoryFree' ||
    (reason === 'critical' &&
      sample?.memoryAvailableBytes != null &&
      sample.memoryTotalBytes !== null &&
      sample.memoryAvailableBytes <
        resourceMemoryFloorBytes(status.settings, sample.memoryTotalBytes) *
          RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION)
  let metric = UI_TEXT.resourceCpu
  let reading = percentage(sample?.cpuPercent)
  let threshold = percentage(
    reason === 'critical' ? RESOURCE_CRITICAL_CPU_PERCENT : status.settings.cpuMaxPercent,
  )
  switch (reason) {
    case 'transport': {
      metric = UI_TEXT.resourceTransport
      reading = percentage(sample?.transportFailurePercent)
      threshold = percentage(RESOURCE_TRANSPORT_FAILURE_PERCENT)
      break
    }
    case 'osService': {
      metric = UI_TEXT.resourceOsService
      const values = [
        sample?.pressure?.cpuSomePercent ?? null,
        sample?.pressure?.memorySomePercent ?? null,
        sample?.pressure?.memoryFullPercent ?? null,
      ]
      const known = values.filter((value) => value !== null)
      reading = percentage(known.length === 0 || values.includes(null) ? null : Math.max(...known))
      threshold = percentage(RESOURCE_SERVICE_PRESSURE_PERCENT)
      break
    }
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
        : formatBytes(
            resourceMemoryFloorBytes(status.settings, sample.memoryTotalBytes) *
              (reason === 'critical' ? RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION : 1),
          )
  }
  return [fill(UI_TEXT.resourcePauseNotice, { metric, reading, threshold }), ...details].join('\n')
}

import type { CoreLogger } from '../../core/logging'
import { causeForLog } from '../../core/backends/musecode/logText'
import {
  RESOURCE_SERVICE_PRESSURE_PERCENT,
  RESOURCE_TRANSPORT_FAILURE_PERCENT,
  RESOURCE_CRITICAL_CPU_PERCENT,
  RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION,
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

// An unset limit shows no parenthetical: the reading is measured, not held.
const limited = (reading: string, threshold: string | null): string =>
  threshold === null ? reading : `${reading} (${threshold})`

function availableMemoryText(sample: ResourceStatus['sample'], floor: number | null): string {
  if (sample?.memoryAvailableBytes == null) return UI_TEXT.resourceUnknown
  return limited(
    formatBytes(sample.memoryAvailableBytes),
    floor === null ? null : formatBytes(floor),
  )
}

export function resourceStatusText(raw: ResourceStatus): string {
  const status = resourceStatusSchema.parse(raw)
  const { sample, settings } = status
  const floor =
    sample?.memoryTotalBytes == null
      ? null
      : resourceMemoryFloorBytes(settings, sample.memoryTotalBytes)
  const lines = [
    `${UI_TEXT.resourceTitle}: ${resourceLevelText(status.level)}`,
    `${UI_TEXT.resourceCpu}: ${limited(
      percentage(sample?.cpuPercent),
      settings.cpuMaxPercent === null ? null : formatPercent(settings.cpuMaxPercent),
    )}`,
    `${UI_TEXT.resourceMemory}: ${limited(
      percentage(sample?.memoryUsedPercent),
      settings.memoryMaxPercent === null ? null : formatPercent(settings.memoryMaxPercent),
    )}`,
    `${UI_TEXT.resourceAvailableMemory}: ${availableMemoryText(sample, floor)}`,
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
  // A bound route with no approved target: the runner-route sentence appears
  // only once the wiring binds a route, never before.
  if (status.relocation === 'noRoute') lines.push(UI_TEXT.resourceRelocationNoRoute)
  else if (status.relocation === 'noTarget') lines.push(UI_TEXT.resourceRelocationNoTarget)
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
  const memoryFloor =
    sample?.memoryTotalBytes == null
      ? null
      : resourceMemoryFloorBytes(status.settings, sample.memoryTotalBytes)
  const isFree =
    reason === 'memoryFree' ||
    (reason === 'critical' &&
      memoryFloor !== null &&
      sample?.memoryAvailableBytes != null &&
      sample.memoryAvailableBytes < memoryFloor * RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION)
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
      memoryFloor === null
        ? UI_TEXT.resourceUnknown
        : formatBytes(
            memoryFloor * (reason === 'critical' ? RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION : 1),
          )
  }
  return [fill(UI_TEXT.resourcePauseNotice, { metric, reading, threshold }), ...details].join('\n')
}

// Technical reading identifiers name the failed port, without a native message or path.
const RESOURCE_READINGS = [
  'resources.settings',
  'resources.resume',
  'resources.sample',
  'resources.history',
  'resources.status',
  'resources.admission',
] as const
export type ResourceReading = (typeof RESOURCE_READINGS)[number]

/**
Stable cross-bundle brand (R2): the resources bundle ships separately
from the ACP agent, so each bundle carries its own class object and
`instanceof` cannot recognise the other's failures. Matching is on this
brand plus a reading from the fixed vocabulary, never on identity.
*/
export const RESOURCE_READING_CODE = 'resource_reading'

export class ResourceReadingError extends Error {
  public readonly code: typeof RESOURCE_READING_CODE = RESOURCE_READING_CODE
  public constructor(
    public readonly reading: ResourceReading,
    options?: { readonly cause?: unknown },
  ) {
    super(UI_TEXT.resourceUnavailable, options)
    this.name = 'ResourceReadingError'
  }
}

/** A resource-reading failure from any bundle that built it. */
export function isResourceReadingError(error: unknown): error is ResourceReadingError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RESOURCE_READING_CODE &&
    'reading' in error &&
    typeof error.reading === 'string' &&
    (RESOURCE_READINGS as readonly string[]).includes(error.reading)
  )
}

/** The named reading when branded, else the generic status reading. */
export function resourceReadingOf(error: unknown): ResourceReading {
  return isResourceReadingError(error) ? error.reading : 'resources.status'
}

/** A reading name from the fixed vocabulary, for rebuilding outbound data. */
export function isResourceReadingName(value: unknown): value is ResourceReading {
  return typeof value === 'string' && (RESOURCE_READINGS as readonly string[]).includes(value)
}

export async function readResource<T>(
  reading: ResourceReading,
  work: () => T | Promise<T>,
): Promise<T> {
  try {
    return await work()
  } catch (error: unknown) {
    // The fixed reading identity crosses the resource/log boundary; the
    // original fault rides along as `cause` for the in-process record.
    throw new ResourceReadingError(reading, { cause: error })
  }
}

/** The connected process reports each unavailable reading once, in its installed language. */
export function resourceFailureReporter(log: Pick<CoreLogger, 'warn'>): (error: unknown) => void {
  const reported = new Set<ResourceReading>()
  return (error) => {
    const reading = resourceReadingOf(error)
    if (reported.has(reading)) return
    reported.add(reading)
    // The fault behind our branded wrapper, else the failure itself, named
    // by its kind and code, never its text (RLF-HARVEST H8: the 0.19.0
    // reporter dropped the error entirely and said the bare sentence). A
    // fault whose kind is the sentence itself stays the plain line instead
    // of repeating it as its own cause.
    const fault = isResourceReadingError(error) && error.cause !== undefined ? error.cause : error
    const cause = causeForLog(fault)
    log.warn(
      cause === UI_TEXT.resourceUnavailable
        ? `${reading}: ${UI_TEXT.resourceUnavailable}`
        : `${reading}: ${fill(UI_TEXT.resourceUnavailableWhy, { cause })}`,
    )
  }
}

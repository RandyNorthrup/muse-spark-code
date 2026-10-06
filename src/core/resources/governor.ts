import {
  RESOURCE_CPU_WINDOW_MS,
  RESOURCE_CRITICAL_CPU_PERCENT,
  RESOURCE_CRITICAL_CPU_WINDOW_MS,
  RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION,
  RESOURCE_ESCALATE_MS,
  RESOURCE_EXIT_MS,
  RESOURCE_GIB_BYTES,
  RESOURCE_HYSTERESIS_POINTS,
  RESOURCE_MEMORY_ENTER_SAMPLES,
  RESOURCE_MEMORY_HYSTERESIS_GIB,
  RESOURCE_MIN_DWELL_MS,
  RESOURCE_OPTIONAL_MIN_PERCENT,
  RESOURCE_OVERRIDE_MS,
  RESOURCE_SAMPLE_MS,
} from '../../shared/constants'
import {
  resourceMemoryFloorBytes,
  resourceSampleSchema,
  resourceSettingsSchema,
  resourceStatusSchema,
  type ResourceClock,
  type ResourceEvent,
  type ResourceKind,
  type ResourceLevel,
  type ResourceSample,
  type ResourceSampler,
  type ResourceSettings,
  type ResourceStatus,
} from '../../shared/resources'
import { type ResourceEvents } from './events'
import { diskPressure } from './disk'

type Reason = Extract<ResourceEvent, { type: 'levelChanged' }>['reason']
type Metric = 'cpu' | 'memoryUsed' | 'memoryFree' | 'gpu' | 'disk' | 'diskFree'
interface Threshold {
  metric: Metric
  high: boolean | null
  recovered: boolean
}
export interface ResourceGovernorOptions {
  clock: ResourceClock
  sampler: ResourceSampler
  settings: ResourceSettings
  events: ResourceEvents
  /** R binds approved paired-device/runner availability; off never calls it. */
  hasRelocationTarget: () => boolean
  onError: (error: unknown) => void
}

/** Portable policy only: no process changes, network requests or activation work. */
export class ResourceGovernor {
  private settings: ResourceSettings
  private sample: ResourceSample | null = null
  private diskHeld = false
  private current: ResourceLevel = 'normal'
  private changedAt = -RESOURCE_MIN_DWELL_MS
  private readonly highSince = new Map<Metric, number>()
  private readonly highSamples = new Map<Metric, number>()
  private criticalSince: number | undefined
  private recoveredSince: number | undefined
  private overrideUntil: number | null = null
  private expiredOverrideAt: number | null = null
  private cancelOverride: (() => void) | undefined
  private cancelSample: (() => void) | undefined
  private pending: Promise<void> | undefined
  private started = false
  private readonly sampleListeners = new Set<() => void>()
  private disposed = false

  constructor(private readonly options: ResourceGovernorOptions) {
    this.settings = resourceSettingsSchema.parse(options.settings)
  }

  private schedule(delayMs: number): void {
    this.cancelSample = this.options.clock.setTimeout(() => {
      void this.refresh().finally(() => {
        if (this.started) this.schedule(RESOURCE_SAMPLE_MS)
      })
    }, delayMs)
  }

  private async read(): Promise<void> {
    // Yield before a port that may throw synchronously, so pending is installed first.
    await Promise.resolve()
    try {
      for (;;) {
        const requestedAt = this.options.clock.now()
        try {
          const sample = resourceSampleSchema.parse(await this.options.sampler.sample())
          if (this.disposed) return
          // Keep the shared promise pending while an older read drains, then sample serially.
          if (this.expiredOverrideAt !== null && requestedAt < this.expiredOverrideAt) continue
          if (this.expiredOverrideAt !== null && sample.atMs < this.expiredOverrideAt)
            throw new Error('Resource sample predates override expiry')
          this.expiredOverrideAt = null
          this.evaluate(sample)
          this.publishSample()
        } catch (error) {
          if (!this.disposed) {
            if (this.expiredOverrideAt !== null && requestedAt < this.expiredOverrideAt) continue
            this.options.onError(error)
            this.evaluate({
              atMs: this.options.clock.now(),
              cpuPercent: null,
              memoryUsedPercent: null,
              memoryAvailableBytes: null,
              memoryTotalBytes: null,
              gpuPercent: null,
              diskBusyPercent: null,
              pressure: null,
            })
            this.publishSample()
          }
        }
        return
      }
    } finally {
      this.pending = undefined
    }
  }

  private publishSample(): void {
    for (const listener of this.sampleListeners) {
      try {
        listener()
      } catch (error: unknown) {
        this.options.onError(error)
      }
    }
  }

  private thresholds(sample: ResourceSample): Threshold[] {
    const percentage = (metric: Metric, value: number | null, limit: number): Threshold => ({
      metric,
      high: value === null ? null : value >= limit,
      recovered:
        value !== null &&
        value <
          limit -
            Math.max(RESOURCE_OPTIONAL_MIN_PERCENT / 2, (limit * RESOURCE_HYSTERESIS_POINTS) / 100),
    })
    const floor =
      sample.memoryTotalBytes === null
        ? null
        : resourceMemoryFloorBytes(this.settings, sample.memoryTotalBytes)
    const free = sample.memoryAvailableBytes
    const memoryMargin =
      sample.memoryTotalBytes === null
        ? null
        : Math.min(
            sample.memoryTotalBytes / 2,
            RESOURCE_MEMORY_HYSTERESIS_GIB * RESOURCE_GIB_BYTES,
            Math.max(1, (sample.memoryTotalBytes * RESOURCE_HYSTERESIS_POINTS) / 100),
          )
    const readings: Threshold[] = [
      percentage('cpu', sample.cpuPercent, this.settings.cpuMaxPercent),
      percentage('memoryUsed', sample.memoryUsedPercent, this.settings.memoryMaxPercent),
      {
        metric: 'memoryFree',
        high: free === null || floor === null ? null : free < floor,
        recovered:
          free !== null && floor !== null && memoryMargin !== null && free > floor + memoryMargin,
      },
    ]
    if (this.settings.gpuMaxPercent !== null)
      readings.push(percentage('gpu', sample.gpuPercent, this.settings.gpuMaxPercent))
    if (this.settings.diskBusyMaxPercent !== null)
      readings.push(percentage('disk', sample.diskBusyPercent, this.settings.diskBusyMaxPercent))
    if (sample.diskVolumes !== undefined) {
      const disk = diskPressure(sample.diskVolumes, this.settings)
      readings.push({ metric: 'diskFree', high: disk.high, recovered: disk.hasRecovered })
    }
    return readings
  }

  private evaluate(sample: ResourceSample): void {
    this.sample = sample
    const now = this.options.clock.now()
    const readings = this.thresholds(sample)
    let enter: Metric | undefined
    for (const reading of readings) {
      if (reading.high !== true) {
        this.highSince.delete(reading.metric)
        this.highSamples.delete(reading.metric)
        continue
      }
      const since = this.highSince.get(reading.metric) ?? now
      const count = (this.highSamples.get(reading.metric) ?? 0) + 1
      this.highSince.set(reading.metric, since)
      this.highSamples.set(reading.metric, count)
      const isSustained =
        reading.metric === 'diskFree' ||
        (reading.metric === 'memoryUsed' || reading.metric === 'memoryFree'
          ? count >= RESOURCE_MEMORY_ENTER_SAMPLES
          : now - since >= RESOURCE_CPU_WINDOW_MS)
      if (isSustained) enter ??= reading.metric
    }
    if (sample.cpuPercent !== null && sample.cpuPercent >= RESOURCE_CRITICAL_CPU_PERCENT)
      this.criticalSince ??= now
    else this.criticalSince = undefined
    const floor =
      sample.memoryTotalBytes === null
        ? null
        : resourceMemoryFloorBytes(this.settings, sample.memoryTotalBytes)
    const disk = diskPressure(sample.diskVolumes ?? [], this.settings)
    if (disk.high === true || disk.isPaused || disk.isCritical) this.diskHeld = true
    else if (disk.hasRecovered && this.current === 'normal') this.diskHeld = false
    const isCritical =
      disk.isCritical ||
      disk.isPaused ||
      (this.criticalSince !== undefined &&
        now - this.criticalSince >= RESOURCE_CRITICAL_CPU_WINDOW_MS) ||
      (sample.memoryAvailableBytes !== null &&
        floor !== null &&
        sample.memoryAvailableBytes < floor * RESOURCE_CRITICAL_MEMORY_FLOOR_FRACTION)
    if (readings.every((reading) => reading.recovered)) this.recoveredSince ??= now
    else this.recoveredSince = undefined
    if (!this.settings.enabled || this.overrideUntil !== null) return
    if (isCritical) {
      this.change('pause', 'critical')
      return
    }
    if (this.current === 'normal') {
      if (enter !== undefined && now - this.changedAt >= RESOURCE_MIN_DWELL_MS)
        this.change('throttle', enter === 'diskFree' ? 'disk' : enter)
      return
    }
    // Recovery/escalation windows each also enforce the sixty-second dwell.
    if (this.recoveredSince !== undefined && now - this.recoveredSince >= RESOURCE_EXIT_MS) {
      let lower: ResourceLevel = 'throttle'
      if (this.current === 'pause' && this.canRelocate()) lower = 'relocate'
      else if (this.current === 'throttle') lower = 'normal'
      this.change(lower, 'recovery')
      this.recoveredSince = now
      return
    }
    const high = readings.find((reading) => reading.high === true)
    if (high !== undefined && now - this.changedAt >= RESOURCE_ESCALATE_MS)
      this.change(
        this.current === 'throttle' && this.canRelocate() ? 'relocate' : 'pause',
        high.metric === 'diskFree' ? 'disk' : high.metric,
      )
  }

  private canRelocate(): boolean {
    return this.settings.relocate !== 'off' && this.options.hasRelocationTarget()
  }

  private change(to: ResourceLevel, reason: Reason): void {
    if (to === this.current) return
    const from = this.current
    this.current = to
    if (to === 'normal' && reason === 'recovery') this.diskHeld = false
    this.changedAt = this.options.clock.now()
    this.options.events.publish({ type: 'levelChanged', atMs: this.changedAt, from, to, reason })
  }

  private resetWindows(): void {
    this.highSince.clear()
    this.highSamples.clear()
    this.criticalSince = undefined
    this.recoveredSince = undefined
  }

  /** Admission must wake on disk recovery even while an override keeps the level normal. */
  onSample(listener: () => void): () => void {
    this.sampleListeners.add(listener)
    return () => {
      this.sampleListeners.delete(listener)
    }
  }

  level(): ResourceLevel {
    return this.current
  }

  /** null means the governor adds no limit; callers retain their own slot caps. */
  capacity(_kind: ResourceKind): number | null {
    if (this.current === 'normal') return null
    return this.current === 'pause' ? 0 : 1
  }

  /** Disk-heavy work cannot use foreground's automatic twenty-second bypass. */
  diskBlocked(): boolean {
    return this.settings.enabled && this.overrideUntil === null && this.diskHeld
  }

  status(queued: ResourceStatus['queued']): ResourceStatus {
    return resourceStatusSchema.parse({
      level: this.current,
      sample: this.sample,
      settings: this.settings,
      queued,
      overrideUntilMs: this.overrideUntil,
    })
  }

  updateSettings(settings: ResourceSettings): void {
    this.settings = resourceSettingsSchema.parse(settings)
    this.resetWindows()
    if (this.settings.enabled) {
      return
    }

    this.cancelOverride?.()
    this.overrideUntil = null
    this.expiredOverrideAt = null
    this.change('normal', 'disabled')
  }

  resumeNow(): void {
    if (this.disposed) throw new Error('Resource governor disposed')
    this.cancelOverride?.()
    const atMs = this.options.clock.now()
    this.overrideUntil = atMs + RESOURCE_OVERRIDE_MS
    this.expiredOverrideAt = null
    this.resetWindows()
    this.change('normal', 'override')
    this.options.events.publish({ type: 'override', atMs, untilMs: this.overrideUntil })
    this.cancelOverride = this.options.clock.setTimeout(() => {
      this.overrideUntil = null
      this.expiredOverrideAt = this.options.clock.now()
      this.resetWindows()
      // A fresh reading, never the cached sample, decides when the override ends.
      void this.refresh()
    }, RESOURCE_OVERRIDE_MS)
  }

  /** The first governed spawn's host calls this; constructing/importing does nothing. */
  start(): void {
    if (this.disposed) throw new Error('Resource governor disposed')
    if (this.started) return
    this.started = true
    this.schedule(0)
  }

  dispose(): void {
    this.disposed = true
    this.started = false
    this.sampleListeners.clear()
    this.cancelSample?.()
    this.cancelOverride?.()
    this.overrideUntil = null
    this.expiredOverrideAt = null
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Resource governor disposed'))
    this.pending ??= this.read()
    return this.pending
  }
}

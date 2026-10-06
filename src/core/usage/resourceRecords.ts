import {
  RESOURCE_GIB_BYTES,
  RESOURCE_HISTORY_MINUTE_MS,
  RESOURCE_HYSTERESIS_POINTS,
  RESOURCE_MEMORY_HYSTERESIS_GIB,
} from '../../shared/constants'
import {
  resourceEventSchema,
  resourceMemoryFloorBytes,
  resourceRecordSchema,
  resourceStatusSchema,
  resourceTicketSchema,
  resourceTreeUsageSchema,
  type ResourceEvent,
  type ResourceKind,
  type ResourceRecord,
  type ResourceStatus,
  type ResourceTicket,
  type ResourceTreeUsage,
} from '../../shared/resources'

/** T/C1 supplies only registered, identity-verified trees, including a final retirement sample. */
export interface ResourceRecordWorkSource {
  read(): Promise<readonly { ticket: ResourceTicket; usage: ResourceTreeUsage | null }[]>
}
/** M102 supplies durable append and owns retention, local-day rollups and journal consent. */
export interface ResourceRecordSink {
  append(record: ResourceRecord): Promise<void>
}

type Minute = NonNullable<ResourceRecord['minute']>
type Metric = 'cpuPercent' | 'memoryUsedPercent' | 'gpuPercent' | 'diskBusyPercent'
const metrics: readonly Metric[] = [
  'cpuPercent',
  'memoryUsedPercent',
  'gpuPercent',
  'diskBusyPercent',
]
const levels = ['normal', 'throttle', 'relocate', 'pause'] as const
const buckets = ['unknown', 'ample', 'low', 'belowFloor'] as const

function memoryBucket(status: ResourceStatus): Minute['availableMemory'] {
  const sample = status.sample
  if (sample?.memoryAvailableBytes == null || sample.memoryTotalBytes === null) return 'unknown'
  const floor = resourceMemoryFloorBytes(status.settings, sample.memoryTotalBytes)
  const margin = Math.min(
    sample.memoryTotalBytes / 2,
    RESOURCE_MEMORY_HYSTERESIS_GIB * RESOURCE_GIB_BYTES,
    Math.max(1, (sample.memoryTotalBytes * RESOURCE_HYSTERESIS_POINTS) / 100),
  )
  if (sample.memoryAvailableBytes < floor) return 'belowFloor'
  return sample.memoryAvailableBytes <= floor + margin ? 'low' : 'ample'
}

/** Feed the governor's existing samples; this collector starts no sampler or process. */
export class ResourceRecords {
  private minute: ResourceRecord | undefined
  private readonly readings = new Map<Metric, { total: number; count: number }>()
  private counters = new Map<string, number>()
  private lastSampleAt = -1
  private settingsSignature: string | undefined
  private pending: ResourceRecord | undefined
  private tail = Promise.resolve()

  constructor(
    private readonly sink: ResourceRecordSink,
    private readonly work: ResourceRecordWorkSource,
  ) {}

  private serialize(action: () => Promise<void>): Promise<void> {
    // A rejected append stays pending. The next operation retries it before admitting data.
    const previous = this.tail
    const run = async () => {
      try {
        await previous
      } catch {
        // The original caller received the failure; drain retries its retained record.
      }
      await action()
    }
    const next = run()
    this.tail = next
    return next
  }

  private async drain(): Promise<void> {
    if (this.pending === undefined) return
    await this.sink.append(resourceRecordSchema.parse(this.pending))
    this.pending = undefined
  }

  private async flushMinute(): Promise<void> {
    await this.drain()
    if (this.minute === undefined) return
    this.pending = this.minute
    this.minute = undefined
    this.readings.clear()
    await this.drain()
  }

  sample(input: ResourceStatus): Promise<void> {
    // Copy before queueing: a caller changing its status cannot change a pending record.
    const status = resourceStatusSchema.parse(input)
    return this.serialize(async () => {
      await this.drain()
      const sample = status.sample
      if (sample === null || !status.settings.enabled) {
        await this.flushMinute()
        return
      }
      if (sample.atMs < this.lastSampleAt) throw new Error('Resource history sample out of order')
      const isNewSample = sample.atMs !== this.lastSampleAt
      const atMs = Math.floor(sample.atMs / RESOURCE_HISTORY_MINUTE_MS) * RESOURCE_HISTORY_MINUTE_MS
      const signature = JSON.stringify(status.settings)
      if (
        this.minute === undefined ||
        Math.floor(this.minute.atMs / RESOURCE_HISTORY_MINUTE_MS) * RESOURCE_HISTORY_MINUTE_MS !==
          atMs ||
        this.settingsSignature !== signature
      )
        await this.flushMinute()
      // Validate the complete work batch before changing counters or the minute.
      const snapshots = await this.work.read()
      const batch = snapshots.map((row) => ({
        ticket: resourceTicketSchema.parse(row.ticket),
        usage: row.usage === null ? null : resourceTreeUsageSchema.parse(row.usage),
      }))
      const nextCounters = new Map<string, number>()
      const work = new Map<ResourceKind, ResourceRecord['work'][number]>()
      const seen = new Set<string>()
      for (const { ticket, usage } of batch) {
        // Local only. A ticket reclassification keeps its CPU baseline; PID reuse does not.
        const identity = JSON.stringify([ticket.root, ticket.scope])
        if (seen.has(identity)) throw new Error('Resource history duplicate tree')
        seen.add(identity)
        const previous = this.counters.get(identity) ?? 0
        nextCounters.set(identity, Math.max(previous, usage?.cpuSeconds ?? previous))
        if (usage === null) continue
        const row = work.get(ticket.kind) ?? {
          kind: ticket.kind,
          cpuSeconds: 0,
          peakMemoryBytes: 0,
        }
        row.cpuSeconds += Math.max(0, usage.cpuSeconds - previous)
        row.peakMemoryBytes += usage.residentBytes
        work.set(ticket.kind, row)
      }
      this.minute ??= {
        type: 'resource',
        atMs: sample.atMs,
        event: null,
        minute: {
          cpuPercent: null,
          memoryUsedPercent: null,
          availableMemory: 'unknown',
          gpuPercent: null,
          diskBusyPercent: null,
          level: 'normal',
          thresholds: {
            cpuMaxPercent: status.settings.cpuMaxPercent,
            memoryMaxPercent: status.settings.memoryMaxPercent,
            memoryMinFreeGiB: status.settings.memoryMinFreeGiB,
          },
        },
        work: [],
      }
      const minute = this.minute.minute
      if (minute === null) throw new Error('Resource history minute missing')
      for (const metric of metrics) {
        if (!isNewSample) continue
        const value =
          (metric === 'gpuPercent' && status.settings.gpuMaxPercent === null) ||
          (metric === 'diskBusyPercent' && status.settings.diskBusyMaxPercent === null)
            ? null
            : sample[metric]
        if (value === null) continue
        const reading = this.readings.get(metric) ?? { total: 0, count: 0 }
        reading.total += value
        reading.count += 1
        this.readings.set(metric, reading)
        minute[metric] = reading.total / reading.count
      }
      if (levels.indexOf(status.level) > levels.indexOf(minute.level)) minute.level = status.level
      const bucket = memoryBucket(status)
      if (buckets.indexOf(bucket) > buckets.indexOf(minute.availableMemory))
        minute.availableMemory = bucket
      for (const row of work.values()) {
        const current = this.minute.work.find((item) => item.kind === row.kind)
        if (current === undefined) this.minute.work.push(row)
        else {
          current.cpuSeconds += row.cpuSeconds
          current.peakMemoryBytes = Math.max(current.peakMemoryBytes, row.peakMemoryBytes)
        }
      }
      this.counters = nextCounters
      this.lastSampleAt = sample.atMs
      this.settingsSignature = signature
    })
  }

  event(input: ResourceEvent): Promise<void> {
    const event = resourceEventSchema.parse(input)
    return this.serialize(async () => {
      await this.drain()
      this.pending = resourceRecordSchema.parse({
        type: 'resource',
        atMs: event.atMs,
        minute: null,
        event,
        work: [],
      })
      await this.drain()
    })
  }

  /** Call before a journal read and on clean shutdown; failed appends remain retryable. */
  flush(): Promise<void> {
    return this.serialize(async () => {
      await this.flushMinute()
    })
  }
}

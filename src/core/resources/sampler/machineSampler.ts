import { RESOURCE_SAMPLE_MS, RESOURCE_TREE_SAMPLE_MS } from '../../../shared/constants'
import {
  resourceSampleSchema,
  type ResourceSample,
  type ResourceSampler,
  type ResourceSettings,
} from '../../../shared/resources'
import { linuxMemoryLimit, type SamplerFileReader } from './linuxMemory'
import type { ResourceDiskSampler } from '../disk'
import { counterReading, CpuDelta, percentReading, pressureReading } from './readings'

export interface ResourceOptionalProbes {
  gpu(): Promise<number | null>
  disk(): Promise<number | null>
  reset(kind: 'gpu' | 'disk'): void
}

/** Ports keep OS failures and optional probe loading deterministic in tests. */
export interface MachineSamplerPort {
  readonly platform: NodeJS.Platform
  now(): number
  cpus(): unknown
  totalMemory(): number
  freeMemory(): number
  availableMemory(): number | null
  readonly read: SamplerFileReader
  loadOptionalProbes(): Promise<ResourceOptionalProbes>
}

interface ProbeCache {
  atMs: number
  value: number | null
}

async function unknownOnFailure<T>(read: () => T | Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

export class MachineResourceSampler implements ResourceSampler {
  private readonly cpu = new CpuDelta()
  private pending: Promise<ResourceSample> | undefined
  private probes: Promise<ResourceOptionalProbes> | undefined
  private gpu: ProbeCache | undefined
  private disk: ProbeCache | undefined

  constructor(
    private readonly port: MachineSamplerPort,
    private readonly settings: () => ResourceSettings,
    private readonly disks?: ResourceDiskSampler,
  ) {}

  private async optional(
    kind: 'gpu' | 'disk',
    isEnabled: boolean,
    atMs: number,
  ): Promise<number | null> {
    if (!isEnabled) {
      const cached = this[kind]
      const probes = this.probes
      this[kind] = undefined
      if (cached !== undefined && probes !== undefined) {
        const loaded = await unknownOnFailure(() => probes)
        loaded?.reset(kind)
      }
      return null
    }
    const cached = this[kind]
    const interval = kind === 'gpu' ? RESOURCE_SAMPLE_MS : RESOURCE_TREE_SAMPLE_MS
    if (cached !== undefined && atMs >= cached.atMs && atMs - cached.atMs < interval)
      return cached.value
    const value = await unknownOnFailure(async () => {
      this.probes ??= this.loadProbes()
      const probes = await this.probes
      return percentReading(await probes[kind]())
    })
    this[kind] = { atMs, value }
    return value
  }

  private async memory(): Promise<
    Pick<ResourceSample, 'memoryTotalBytes' | 'memoryAvailableBytes' | 'memoryUsedPercent'>
  > {
    let total = counterReading(await unknownOnFailure(() => this.port.totalMemory()))
    if (total === 0) total = null
    const available = counterReading(await unknownOnFailure(() => this.port.availableMemory()))
    // Lane 0 measured free pages alone on Darwin; never substitute them for headroom.
    const free =
      this.port.platform === 'darwin'
        ? available
        : counterReading(await unknownOnFailure(() => this.port.freeMemory()))
    let usable = free === null ? null : Math.min(free, available ?? free)
    if (this.port.platform === 'linux') {
      const limit = await unknownOnFailure(() => linuxMemoryLimit(this.port.read))
      if (limit === null) {
        total = null
        usable = null
      } else if (limit !== undefined) {
        total = total === null ? null : Math.min(total, limit.total)
        usable = usable === null ? null : Math.min(usable, limit.available)
      }
    }
    if (total !== null && usable !== null && usable > total) usable = null
    return {
      memoryTotalBytes: total,
      memoryAvailableBytes: usable,
      memoryUsedPercent: total === null || usable === null ? null : (1 - usable / total) * 100,
    }
  }

  private async readSample(): Promise<ResourceSample> {
    const atMs = this.port.now()
    const settings = this.settings()
    const cpuPercent = this.cpu.read(await unknownOnFailure(() => this.port.cpus()))
    const [memory, cpuPressure, memoryPressure, gpuPercent, diskBusyPercent] = await Promise.all([
      this.memory(),
      this.port.platform === 'linux'
        ? unknownOnFailure(() => this.port.read('/proc/pressure/cpu'))
        : null,
      this.port.platform === 'linux'
        ? unknownOnFailure(() => this.port.read('/proc/pressure/memory'))
        : null,
      this.optional('gpu', settings.enabled && settings.gpuMaxPercent !== null, atMs),
      this.optional('disk', settings.enabled && settings.diskBusyMaxPercent !== null, atMs),
    ])
    return resourceSampleSchema.parse({
      atMs,
      cpuPercent,
      ...memory,
      gpuPercent,
      diskBusyPercent,
      ...(this.disks !== undefined && { diskVolumes: await this.disks.sample() }),
      pressure:
        cpuPressure == null && memoryPressure == null
          ? null
          : {
              cpuSomePercent: pressureReading(cpuPressure, 'some'),
              memorySomePercent: pressureReading(memoryPressure, 'some'),
              memoryFullPercent: pressureReading(memoryPressure, 'full'),
            },
    })
  }
  private async loadProbes(): Promise<ResourceOptionalProbes> {
    try {
      return await this.port.loadOptionalProbes()
    } catch (error) {
      this.probes = undefined
      throw error
    }
  }

  private async readPending(): Promise<ResourceSample> {
    try {
      return await this.readSample()
    } finally {
      this.pending = undefined
    }
  }

  /** The governor owns the five-second timer; construction/import starts nothing. */
  sample(): Promise<ResourceSample> {
    this.pending ??= this.readPending()
    return this.pending
  }
}

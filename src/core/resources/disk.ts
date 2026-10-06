import { statfs } from 'node:fs/promises'
import path from 'node:path'
import {
  RESOURCE_DISK_CRITICAL_FRACTION,
  RESOURCE_DISK_CRITICAL_GIB,
  RESOURCE_DISK_DEFAULT_FREE_GIB,
  RESOURCE_DISK_ETA_MS,
  RESOURCE_DISK_FAST_SAMPLE_MS,
  RESOURCE_DISK_FLOOR_FRACTION,
  RESOURCE_DISK_HYSTERESIS_GIB,
  RESOURCE_DISK_MIN_FREE_GIB,
  RESOURCE_DISK_SAMPLE_MS,
  RESOURCE_DISK_TREND_MS,
  RESOURCE_GIB_BYTES,
  RESOURCE_BIGINT_ZERO,
  UI_TEXT,
} from '../../shared/constants'
import {
  resourceDiskVolumeSchema,
  type ResourceDiskRole,
  type ResourceDiskVolume,
  type ResourceSettings,
  type DeviceResource,
} from '../../shared/resources'
import { fill } from '../../shared/l10n/text'

export interface ResourceDiskTarget {
  readonly role: ResourceDiskRole
  readonly path: string
}
export interface ResourceDiskPort {
  now(): number
  read(path: string): Promise<{ bsize: bigint; blocks: bigint; bavail: bigint }>
}

export function resourceDiskFloorBytes(settings: ResourceSettings, totalBytes: number): number {
  return settings.diskMinFreeGiB === null
    ? Math.max(
        RESOURCE_DISK_MIN_FREE_GIB * RESOURCE_GIB_BYTES,
        Math.min(
          RESOURCE_DISK_DEFAULT_FREE_GIB * RESOURCE_GIB_BYTES,
          totalBytes * RESOURCE_DISK_FLOOR_FRACTION,
        ),
      )
    : settings.diskMinFreeGiB * RESOURCE_GIB_BYTES
}

export function diskPressure(volumes: readonly ResourceDiskVolume[], settings: ResourceSettings) {
  let high: boolean | null = false
  let isPaused = false
  let isCritical = false
  let hasRecovered = true
  for (const volume of volumes) {
    if (volume.freeBytes === null || volume.totalBytes === null) {
      if (high === false) high = null
      hasRecovered = false
      continue
    }
    const floor = resourceDiskFloorBytes(settings, volume.totalBytes)
    if (
      volume.freeBytes <= floor ||
      (volume.etaMs !== null && volume.etaMs <= RESOURCE_DISK_ETA_MS)
    )
      high = true
    isPaused ||= volume.freeBytes <= floor / 2
    isCritical ||=
      volume.freeBytes <=
      Math.max(
        RESOURCE_DISK_CRITICAL_GIB * RESOURCE_GIB_BYTES,
        volume.totalBytes * RESOURCE_DISK_CRITICAL_FRACTION,
      )
    hasRecovered &&=
      volume.freeBytes > floor + RESOURCE_DISK_HYSTERESIS_GIB * RESOURCE_GIB_BYTES &&
      (volume.etaMs === null || volume.etaMs > RESOURCE_DISK_ETA_MS)
  }
  return { high, isPaused, isCritical, hasRecovered }
}

/** Peer data is validated by deviceResourceSchema before this admission check. */
export function hasDeviceDiskHeadroom(device: DeviceResource): boolean {
  const disk = device.diskFree
  return (
    device.level === 'normal' &&
    disk?.freeBytes !== undefined &&
    disk.freeBytes !== null &&
    disk.floorBytes !== null &&
    disk.freeBytes > disk.floorBytes
  )
}

interface DiskCache {
  volume: ResourceDiskVolume
  history: { atMs: number; freeBytes: number }[]
}

/** No timers or processes: S/G owns sampling; every target is a harness write location. */
export class ResourceDiskSampler {
  private readonly cache = new Map<ResourceDiskRole, DiskCache>()
  private pending: Promise<ResourceDiskVolume[]> | undefined
  constructor(
    private readonly targets: readonly ResourceDiskTarget[],
    private readonly settings: () => ResourceSettings,
    private readonly port: ResourceDiskPort = {
      now: () => Date.now(),
      read: (file) => statfs(file, { bigint: true }),
    },
  ) {
    const roles = new Set<ResourceDiskRole>()
    for (const target of targets) {
      if (!path.isAbsolute(target.path) || roles.has(target.role))
        throw new Error('Invalid disk watch target')
      roles.add(target.role)
    }
  }

  private async read(target: ResourceDiskTarget, atMs: number): Promise<ResourceDiskVolume> {
    let freeBytes: number | null = null
    let totalBytes: number | null = null
    try {
      const stats = await this.port.read(target.path)
      const total = stats.bsize * stats.blocks
      const free = stats.bsize * stats.bavail
      if (
        stats.bsize > RESOURCE_BIGINT_ZERO &&
        total > RESOURCE_BIGINT_ZERO &&
        free >= RESOURCE_BIGINT_ZERO &&
        free <= total &&
        total <= BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        freeBytes = Number(free)
        totalBytes = Number(total)
      }
    } catch {
      // ENOSPC, inaccessible and missing locations are unknown, never zero.
    }
    const previous = this.cache.get(target.role)
    const history =
      previous?.history.filter(
        (entry) => entry.atMs >= atMs - RESOURCE_DISK_TREND_MS && entry.atMs < atMs,
      ) ?? []
    let etaMs: number | null = null
    if (freeBytes !== null && totalBytes !== null) {
      const first = history[0]
      if (first !== undefined && first.freeBytes > freeBytes) {
        const remaining = Math.max(
          0,
          freeBytes - resourceDiskFloorBytes(this.settings(), totalBytes),
        )
        etaMs = (remaining * (atMs - first.atMs)) / (first.freeBytes - freeBytes)
      }
      history.push({ atMs, freeBytes })
    } else history.length = 0
    const volume = resourceDiskVolumeSchema.parse({
      role: target.role,
      atMs,
      freeBytes,
      totalBytes,
      etaMs,
    })
    this.cache.set(target.role, { volume, history })
    return volume
  }

  private async readAll(): Promise<ResourceDiskVolume[]> {
    await Promise.resolve()
    try {
      const atMs = this.port.now()
      return await Promise.all(
        this.targets.map(async (target) => {
          const cached = this.cache.get(target.role)?.volume
          const interval =
            cached?.freeBytes !== null &&
            cached?.freeBytes !== undefined &&
            cached.totalBytes !== null &&
            cached.freeBytes < 2 * resourceDiskFloorBytes(this.settings(), cached.totalBytes)
              ? RESOURCE_DISK_FAST_SAMPLE_MS
              : RESOURCE_DISK_SAMPLE_MS
          return cached !== undefined && atMs >= cached.atMs && atMs - cached.atMs < interval
            ? structuredClone(cached)
            : await this.read(target, atMs)
        }),
      )
    } finally {
      this.pending = undefined
    }
  }

  sample(): Promise<ResourceDiskVolume[]> {
    this.pending ??= this.readAll()
    return this.pending
  }

  /** Fresh destination read, including new files' nearest existing ancestor. No override bypass. */
  async assertWrite(file: string): Promise<void> {
    let candidate = path.resolve(file)
    for (;;) {
      try {
        const stats = await this.port.read(candidate)
        const volume = resourceDiskVolumeSchema.parse({
          role: 'workspace',
          atMs: this.port.now(),
          freeBytes: Number(stats.bsize * stats.bavail),
          totalBytes: Number(stats.bsize * stats.blocks),
          etaMs: null,
        })
        if (diskPressure([volume], this.settings()).isCritical)
          throw Object.assign(
            new Error(fill(UI_TEXT.resourceDiskWriteRefused, { volume: candidate })),
            { code: 'resourceDiskCritical', volume: candidate },
          )
        return
      } catch (error: unknown) {
        // Only absence permits walking upwards; permission/invalid readings are explicit errors.
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error
        const parent = path.dirname(candidate)
        if (parent === candidate) throw error
        candidate = parent
      }
    }
  }

  headroom(): DeviceResource['diskFree'] {
    const known: ResourceDiskVolume[] = []
    for (const { volume } of this.cache.values()) known.push(volume)
    if (
      known.length !== this.targets.length ||
      known.length === 0 ||
      known.some((volume) => volume.freeBytes === null || volume.totalBytes === null)
    )
      return { freeBytes: null, floorBytes: null }
    const tightest = known.toSorted(
      (left, right) =>
        (left.freeBytes ?? 0) -
        resourceDiskFloorBytes(this.settings(), left.totalBytes ?? 1) -
        ((right.freeBytes ?? 0) - resourceDiskFloorBytes(this.settings(), right.totalBytes ?? 1)),
    )[0]
    return {
      freeBytes: tightest?.freeBytes ?? null,
      floorBytes:
        tightest?.totalBytes == null
          ? null
          : resourceDiskFloorBytes(this.settings(), tightest.totalBytes),
    }
  }
}

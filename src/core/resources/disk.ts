import { statfs } from 'node:fs/promises'
import path from 'node:path'
import {
  RESOURCE_DISK_ETA_MS,
  RESOURCE_DISK_FAST_SAMPLE_MS,
  RESOURCE_DISK_HYSTERESIS_GIB,
  RESOURCE_DISK_SAMPLE_MS,
  RESOURCE_DISK_TREND_MS,
  RESOURCE_DISK_READ_TIMEOUT_MS,
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

/** null when the person set no disk floor: the volume is measured, never held. */
export function resourceDiskFloorBytes(settings: ResourceSettings): number | null {
  return settings.diskMinFreeGiB === null ? null : settings.diskMinFreeGiB * RESOURCE_GIB_BYTES
}

export function diskPressure(volumes: readonly ResourceDiskVolume[], settings: ResourceSettings) {
  let high: boolean | null = false
  let isPaused = false
  let hasRecovered = true
  for (const volume of volumes) {
    if (volume.freeBytes === null || volume.totalBytes === null) {
      if (high === false) high = null
      hasRecovered = false
      continue
    }
    // D121: no threshold of ours — only the person's floor holds a volume.
    const floor = resourceDiskFloorBytes(settings)
    // No person-set floor: this volume reports its readings but never trips,
    // pauses or clears a level.
    if (floor === null) continue
    if (
      volume.freeBytes <= floor ||
      (volume.etaMs !== null && volume.etaMs <= RESOURCE_DISK_ETA_MS)
    )
      high = true
    isPaused ||= volume.freeBytes <= floor / 2
    hasRecovered &&=
      volume.freeBytes > floor + RESOURCE_DISK_HYSTERESIS_GIB * RESOURCE_GIB_BYTES &&
      (volume.etaMs === null || volume.etaMs > RESOURCE_DISK_ETA_MS)
  }
  return { high, isPaused, hasRecovered }
}

/** Peer data is validated by deviceResourceSchema before this admission check.
@unwired M107 device disk headroom check
*/
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

/** The production disk port: the wall clock and the filesystem's volume reader. */
const DEFAULT_RESOURCE_DISK_PORT: ResourceDiskPort = {
  now: () => Date.now(),
  read: (file) => statfs(file, { bigint: true }),
}

/** No timers or processes: S/G owns sampling; every target is a harness write location. */
export class ResourceDiskSampler {
  private readonly cache = new Map<ResourceDiskRole, DiskCache>()
  private pending: Promise<ResourceDiskVolume[]> | undefined
  constructor(
    private readonly targets: readonly ResourceDiskTarget[],
    private readonly settings: () => ResourceSettings,
    private readonly port: ResourceDiskPort = DEFAULT_RESOURCE_DISK_PORT,
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
      const stats = await this.readStats(target.path)
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
      // A fill-rate forecast needs the person's floor as its destination.
      const floor = resourceDiskFloorBytes(this.settings())
      if (floor !== null && first !== undefined && first.freeBytes > freeBytes) {
        const remaining = Math.max(0, freeBytes - floor)
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

  private async readStats(file: string): ReturnType<ResourceDiskPort['read']> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        this.port.read(file),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(
              Object.assign(new Error('Disk sampling timed out'), { code: 'resourceDiskUnknown' }),
            )
          }, RESOURCE_DISK_READ_TIMEOUT_MS)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  private async readAll(): Promise<ResourceDiskVolume[]> {
    await Promise.resolve()
    try {
      const atMs = this.port.now()
      return await Promise.all(
        this.targets.map(async (target) => {
          const cached = this.cache.get(target.role)?.volume
          const floor = resourceDiskFloorBytes(this.settings())
          const interval =
            floor !== null &&
            cached?.freeBytes !== null &&
            cached?.freeBytes !== undefined &&
            cached.freeBytes < 2 * floor
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
        const stats = await this.readStats(candidate)
        const volume = resourceDiskVolumeSchema.parse({
          role: 'workspace',
          atMs: this.port.now(),
          freeBytes: Number(stats.bsize * stats.bavail),
          totalBytes: Number(stats.bsize * stats.blocks),
          etaMs: null,
        })
        // D121: writes are refused only at the person's floor (its pause
        // level), never at a threshold of ours; with no floor set every
        // write is admitted and the volume is only measured.
        if (diskPressure([volume], this.settings()).isPaused)
          throw Object.assign(
            new Error(fill(UI_TEXT.resourceDiskWriteRefused, { volume: candidate })),
            { code: 'resourceDiskFloor', volume: candidate },
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
    const ranked = known.map((volume) => ({
      volume,
      floor: resourceDiskFloorBytes(this.settings()),
    }))
    // Without the person's floor there is no headroom to report, only bytes.
    if (ranked.some((row) => row.floor === null)) {
      const tightest = ranked.toSorted(
        (left, right) => (left.volume.freeBytes ?? 0) - (right.volume.freeBytes ?? 0),
      )[0]
      return { freeBytes: tightest?.volume.freeBytes ?? null, floorBytes: null }
    }
    const tightest = ranked.toSorted(
      (left, right) =>
        (left.volume.freeBytes ?? 0) -
        (left.floor ?? 0) -
        ((right.volume.freeBytes ?? 0) - (right.floor ?? 0)),
    )[0]
    return {
      freeBytes: tightest?.volume.freeBytes ?? null,
      floorBytes: tightest?.floor ?? null,
    }
  }
}

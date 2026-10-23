// M110os OS3: install-target candidates from sysfs. Whole disks with a
// size; partitions, empty slots and eMMC boot/RPMB areas are not install
// targets. A missing block directory (or a vanished entry) yields nothing;
// the wizard's typed field stays for odd cases.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface DiskCandidate {
  readonly name: string
  readonly device: string
  readonly sizeBytes: number
  readonly removable: boolean
}

/** sysfs `size` counts 512-byte sectors (Documentation/block/stat.rst). */
const SYSFS_SECTOR_BYTES = 512
/** eMMC hardware areas that are never install targets. */
const NON_TARGET_SUFFIX = /(boot\d+|rpmb)$/u

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function readDisk(sysfsRoot: string, name: string): DiskCandidate | undefined {
  if (NON_TARGET_SUFFIX.test(name)) return undefined
  const dir = path.join(sysfsRoot, 'block', name)
  try {
    // A `partition` file marks a partition, not a disk.
    if (existsSync(path.join(dir, 'partition'))) return undefined
    const sectors = Number(readFileSync(path.join(dir, 'size'), 'utf8').trim())
    if (!Number.isSafeInteger(sectors) || sectors <= 0) return undefined
    const isRemovable = readFileSync(path.join(dir, 'removable'), 'utf8').trim() === '1'
    return {
      name,
      device: `/dev/${name}`,
      sizeBytes: sectors * SYSFS_SECTOR_BYTES,
      removable: isRemovable,
    }
  } catch (error: unknown) {
    if (isMissing(error)) return undefined
    throw new Error('setup block device is not readable', { cause: error })
  }
}

/** Whole disks under `<sysfsRoot>/block`, by name. */
export function listDisks(sysfsRoot: string): DiskCandidate[] {
  let names: string[]
  try {
    names = readdirSync(path.join(sysfsRoot, 'block'))
  } catch (error: unknown) {
    if (isMissing(error)) return []
    throw new Error('setup block devices are not readable', { cause: error })
  }
  const disks: DiskCandidate[] = []
  for (const name of names) {
    const disk = readDisk(sysfsRoot, name)
    if (disk !== undefined) disks.push(disk)
  }
  return disks.toSorted((left, right) => left.name.localeCompare(right.name, 'en'))
}

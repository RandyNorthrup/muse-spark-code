// Builds before D95.9's versioned store root kept their store one level up
// (`<dataDir>/schedules`); the first start on the versioned root carries
// those entries across, one by one, so no draft is orphaned. The carry is
// idempotent: two hosts starting together move disjoint entries, and a
// missing or already-moved entry on either side is never an error. When the
// versioned root already holds an entry (a downgrade wrote to the legacy
// root again, then an upgrade returned), folders merge entry by entry and
// a file already in `v1/` is never overwritten: the current root wins and
// the legacy copy stays where it was instead of silently replacing it.
import { lstat, mkdir, readdir, rename, rmdir } from 'node:fs/promises'
import path from 'node:path'

/**
The catch-gate-visible form of the expected file-system condition: `is`-named
so the inventory reads it as the one handled case, with exactly the same
answer as reading the code member on every input.
*/
function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

/** Another host carried the same entry first, or the destination appeared mid-rename. */
function isBenignCarryRace(error: unknown): boolean {
  return (
    isFileErrorCode(error, 'ENOENT') ||
    isFileErrorCode(error, 'EEXIST') ||
    isFileErrorCode(error, 'ENOTEMPTY')
  )
}

/** A missing or still-filling source directory after the carry. */
function isBenignRmdirRace(error: unknown): boolean {
  return isFileErrorCode(error, 'ENOENT') || isFileErrorCode(error, 'ENOTEMPTY')
}

async function carryEntry(source: string, destination: string): Promise<void> {
  let sourceStat
  try {
    sourceStat = await lstat(source)
  } catch (error: unknown) {
    if (isFileErrorCode(error, 'ENOENT')) return
    throw error
  }
  let hasDestination = true
  try {
    await lstat(destination)
  } catch (error: unknown) {
    if (isFileErrorCode(error, 'ENOENT')) hasDestination = false
    else throw error
  }
  if (!hasDestination) {
    try {
      await rename(source, destination)
    } catch (error: unknown) {
      if (isBenignCarryRace(error)) return
      throw error
    }
    return
  }
  if (!sourceStat.isDirectory()) return
  let names: string[]
  try {
    names = await readdir(source)
  } catch (error: unknown) {
    if (isFileErrorCode(error, 'ENOENT')) return
    throw error
  }
  for (const name of names) await carryEntry(path.join(source, name), path.join(destination, name))
  try {
    await rmdir(source)
  } catch (error: unknown) {
    if (isBenignRmdirRace(error)) return
    throw error
  }
}

/** Carry `<dataDir>/schedules/*` into `<dataDir>/schedules/v1/`, once. */
export async function carryLegacyScheduleStore(dataDir: string): Promise<void> {
  const root = path.join(dataDir, 'schedules', 'v1')
  await mkdir(root, { recursive: true })
  const legacy = path.join(dataDir, 'schedules')
  let names: string[]
  try {
    names = await readdir(legacy)
  } catch (error: unknown) {
    // A fresh machine has no legacy root; any other read failure is real.
    if (isFileErrorCode(error, 'ENOENT')) return
    throw error
  }
  for (const name of names) {
    if (name === 'v1') continue
    await carryEntry(path.join(legacy, name), path.join(root, name))
  }
}

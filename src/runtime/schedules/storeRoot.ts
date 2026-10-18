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

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

async function carryEntry(source: string, destination: string): Promise<void> {
  let sourceStat
  try {
    sourceStat = await lstat(source)
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  let hasDestination = true
  try {
    await lstat(destination)
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') hasDestination = false
    else throw error
  }
  if (!hasDestination) {
    try {
      await rename(source, destination)
    } catch (error: unknown) {
      const code = errorCode(error)
      // Another host carried the same entry first (ENOENT on the source),
      // or the destination appeared between the check and the rename.
      if (code !== undefined && ['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(code)) return
      throw error
    }
    return
  }
  if (!sourceStat.isDirectory()) return
  let names: string[]
  try {
    names = await readdir(source)
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  for (const name of names) await carryEntry(path.join(source, name), path.join(destination, name))
  try {
    await rmdir(source)
  } catch (error: unknown) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTEMPTY') return
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
  } catch {
    return
  }
  for (const name of names) {
    if (name === 'v1') continue
    await carryEntry(path.join(legacy, name), path.join(root, name))
  }
}

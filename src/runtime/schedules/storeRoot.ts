// Builds before D95.9's versioned store root kept their store one level up
// (`<dataDir>/schedules`); the first start on the versioned root carries
// those entries across, one by one, so no draft is orphaned. The carry is
// idempotent: two hosts starting together move disjoint entries, and a
// missing or already-moved entry on either side is never an error.
import { mkdir, readdir, rename } from 'node:fs/promises'
import path from 'node:path'

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
    try {
      await rename(path.join(legacy, name), path.join(root, name))
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'EEXIST')
      )
        continue
      throw error
    }
  }
}

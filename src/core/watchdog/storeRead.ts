// M115w: the watchdog's records read from the file port, in a module that
// pulls in nothing else: the report source reads the same files the
// watchdog writes, without the GitHub client riding along.
import { WATCHDOG_STORE_SUBFOLDER } from '../../shared/constants'
import { watchdogRepoDataSchema, type WatchdogRepoData } from '../../shared/watchdog'
import type { ScheduleFsPort } from '../schedules/journal'

/** Every watched repository's data, by repository name. Damaged JSON or a
file the schema refuses throws; it is never an empty success. */
export async function readWatchdogRepositories(
  fs: Pick<ScheduleFsPort, 'names' | 'read'>,
): Promise<readonly WatchdogRepoData[]> {
  const names = await fs.names(WATCHDOG_STORE_SUBFOLDER)
  const found: WatchdogRepoData[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const raw = await fs.read(`${WATCHDOG_STORE_SUBFOLDER}/${name}`)
    if (raw === undefined) continue
    found.push(watchdogRepoDataSchema.parse(JSON.parse(raw)))
  }
  return found.toSorted((left, right) =>
    left.policy.repository < right.policy.repository
      ? -1
      : Number(left.policy.repository > right.policy.repository),
  )
}

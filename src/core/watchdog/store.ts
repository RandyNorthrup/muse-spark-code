// M115w W0: the watchdog's record store over a file port. One JSON file
// per repository beside the schedules, every read-modify-write under the
// file's cross-process lock. Repositories validate as `owner/name`; the
// file name keeps both parts whole.
import * as z from 'zod/mini'
import { WATCHDOG_STORE_SUBFOLDER } from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import {
  defaultWatchdogPolicy,
  watchdogIssueSchema,
  watchdogPolicySchema,
} from '../../shared/watchdog'
import { repositoryFromFullName } from '../git/github'
import type { ScheduleFsPort } from '../schedules/journal'

const repoDataSchema = z.strictObject({
  policy: watchdogPolicySchema,
  issues: z.array(watchdogIssueSchema),
})
export type WatchdogRepoData = z.infer<typeof repoDataSchema>

export interface WatchdogExclusiveOutcome<T> {
  readonly data: WatchdogRepoData
  readonly result: T
}

export interface WatchdogStore {
  exclusive<T>(
    repository: string,
    work: (
      data: WatchdogRepoData,
    ) => Promise<WatchdogExclusiveOutcome<T>> | WatchdogExclusiveOutcome<T>,
  ): Promise<T>
  list(): Promise<readonly WatchdogRepoData[]>
}

function repoFile(repository: string): string {
  const parts = repositoryFromFullName(repository)
  if (parts === undefined) throw new Error(UI_TEXT.watchdog.cli.invalidRepository)
  return `${WATCHDOG_STORE_SUBFOLDER}/${parts.owner}__${parts.name}.json`
}

export function createWatchdogStore(fs: ScheduleFsPort): WatchdogStore {
  return {
    async exclusive<T>(
      repository: string,
      work: (
        data: WatchdogRepoData,
      ) => Promise<WatchdogExclusiveOutcome<T>> | WatchdogExclusiveOutcome<T>,
    ): Promise<T> {
      const file = repoFile(repository)
      return await fs.lock(file, async () => {
        const raw = await fs.read(file)
        const current =
          raw === undefined
            ? { policy: defaultWatchdogPolicy(repository), issues: [] }
            : repoDataSchema.parse(JSON.parse(raw))
        const { data, result } = await work(repoDataSchema.parse(current))
        await fs.replace(file, JSON.stringify(repoDataSchema.parse(data)))
        return result
      })
    },
    async list(): Promise<readonly WatchdogRepoData[]> {
      const names = await fs.names(WATCHDOG_STORE_SUBFOLDER)
      const found: WatchdogRepoData[] = []
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const raw = await fs.read(`${WATCHDOG_STORE_SUBFOLDER}/${name}`)
        if (raw === undefined) continue
        found.push(repoDataSchema.parse(JSON.parse(raw)))
      }
      return found.toSorted((left, right) =>
        left.policy.repository < right.policy.repository
          ? -1
          : Number(left.policy.repository > right.policy.repository),
      )
    },
  }
}

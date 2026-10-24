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
  type WatchdogIssue,
} from '../../shared/watchdog'
import { repositoryFromFullName } from '../git/github'
import type { GitHubRepository } from '../git/githubRemote'
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

/** A record replaced by its patch, the clock stamped. */
export function patchedWatchdogData(
  data: WatchdogRepoData,
  number: number,
  nowMs: number,
  patch: Partial<WatchdogIssue>,
): WatchdogRepoData {
  return {
    policy: data.policy,
    issues: data.issues.map((record) =>
      record.issueNumber === number ? { ...record, ...patch, updatedAtMs: nowMs } : record,
    ),
  }
}

/** Every step's opening: the named repository (a bad name is refused
before anything is read) and the clock, then `work` on the live data under
the repository's lock. A step that reads GitHub, posts and records does
all three here, so a second writer waits and then sees the record: nothing
is ever posted twice. */
export async function withWatchdogRepository<T>(
  deps: { store: WatchdogStore; now(): number },
  repository: string,
  work: (
    live: WatchdogRepoData,
    opening: { named: GitHubRepository; nowMs: number },
  ) => Promise<WatchdogExclusiveOutcome<T>> | WatchdogExclusiveOutcome<T>,
): Promise<T> {
  const named = repositoryFromFullName(repository)
  if (named === undefined) throw new Error(UI_TEXT.watchdog.cli.invalidRepository)
  const nowMs = deps.now()
  return await deps.store.exclusive(repository, (live) => work(live, { named, nowMs }))
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

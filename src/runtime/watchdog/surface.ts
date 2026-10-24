// M115w WU: the watchdog's bound surface for user-initiated callers (the
// CLI, ACP local commands). The store lives under the trusted agent data
// folder; the GitHub sign-in is the terminal's device flow, read silently,
// and only for the verbs that call GitHub. Anything else never touches
// the credential store.
import { randomUUID } from 'node:crypto'
import { GitHubClient } from '../../core/git/github'
import { createWatchdogStore } from '../../core/watchdog/store'
import type { SecretStore } from '../../host/auth/credentialStore'
import type { Logger } from '../../host/logger'
import { createNodeScheduleFs } from '../schedules/nodeScheduleFs'
import { terminalGitHubDeviceFlow } from '../github/terminalDeviceFlow'
import type { WatchdogSurfacePort } from './command'

export interface WatchdogSurfaceDeps {
  readonly log: Logger
  /** Trusted agent data folder; the watchdog store lives under it. */
  readonly dataFolder: string
  /** `muse-spark-code/<version>`: GitHub refuses a request without one. */
  readonly userAgent: string
  /** The credential store the GitHub sign-in is read from, silently.
  Undefined for a verb that never calls GitHub: that surface touches no
  store. */
  readonly secrets: SecretStore | undefined
}

export async function createWatchdogSurface(
  deps: WatchdogSurfaceDeps,
): Promise<WatchdogSurfacePort> {
  const network = globalThis.fetch.bind(globalThis)
  const store = createWatchdogStore(createNodeScheduleFs(deps.dataFolder))
  const credential =
    deps.secrets === undefined
      ? undefined
      : await terminalGitHubDeviceFlow(network, deps.secrets).credential(
          'silent',
          new AbortController().signal,
        )
  return {
    store,
    client:
      credential === undefined
        ? undefined
        : new GitHubClient({
            fetch: credential.fetch,
            userAgent: deps.userAgent,
            log: deps.log,
          }),
    token: credential?.bearer,
    now: Date.now,
    newRunId: () => randomUUID(),
  }
}

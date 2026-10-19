// What Amp and OpenCode plugin children run in (M91b; RVM91X P1 5, P2 12).
// On Windows each child starts through M50's compiled job launcher
// (`spawnMcpJob`): the launcher creates the runtime suspended, assigns it to
// a no-breakaway job with kill-on-close, and only then resumes it, so
// everything the plugin starts is in that job from its first instruction.
// Ending the launcher closes the job's only handle, which ends every process
// in it (`jobProcessTree` in core). POSIX uses the child's own process
// group. D121: no memory bound of ours — the job carries kill-on-close and
// the OS's own limits, not a limit we set.
//
// A hook never runs without that containment. A failed preparation is tried
// again on every dispatch past a short pacing delay, with a notice in the
// user's language; **Retry Plugin Hooks** (`reset`) clears the count.

import { PLUGIN_JOB_RETRY_BACKOFF_MS, UI_TEXT } from '../../shared/constants'
import type { PluginContainment } from '../../core/backends/modelapi/pluginHost'
import { spawnMcpJob } from './mcpJobLaunch'

export interface PluginContainmentDeps {
  readonly shellJobAssembly?: (() => Promise<string | undefined>) | undefined
  readonly platform: NodeJS.Platform
  /** A fresh M50 launcher preparation (`mcpJobExecutable`); undefined when Windows has none. */
  readonly newJobExecutable: () => (() => Promise<string | undefined>) | undefined
  readonly now: () => number
  readonly log: (message: string) => void
}

export interface PluginContainmentSource {
  readonly containment: () => Promise<PluginContainment>
  /** Forget a failed preparation: the next plugin hook prepares the launcher again. */
  readonly reset: () => void
}

const EXECUTABLE_SUFFIX = '.exe'
// D121: no failure latch of ours — the backoff delay only paces retries,
// and every dispatch past it prepares fresh and tries again.

/** The platform's containment: process groups off Windows, M50's job launcher on it. */
export function pluginContainment(deps: PluginContainmentDeps): PluginContainmentSource {
  if (deps.platform !== 'win32') {
    return {
      containment: () => Promise.resolve({ kind: 'processGroup' }),
      reset: () => {
        // Nothing is prepared off Windows, so nothing is forgotten.
      },
    }
  }
  const state: {
    prepare: (() => Promise<string | undefined>) | undefined
    failures: number
    failedAt: number
  } = { prepare: undefined, failures: 0, failedAt: 0 }
  const executable = async (): Promise<string | undefined> => {
    // D121: no failure latch of ours — past the pacing delay every
    // dispatch prepares fresh and tries again; only Retry resets the count.
    if (state.failures > 0) {
      if (deps.now() - state.failedAt < PLUGIN_JOB_RETRY_BACKOFF_MS) {
        return undefined
      }
      // One more try, from a fresh preparation: the old one keeps its failure.
      state.prepare = undefined
    }
    state.prepare ??= deps.newJobExecutable()
    let found: string | undefined
    try {
      found = await state.prepare?.()
    } catch {
      found = undefined
    }
    if (found !== undefined) {
      state.failures = 0
      return found
    }
    state.failures += 1
    state.failedAt = deps.now()
    deps.log(
      state.failures === 1
        ? 'Plugin hooks: the Windows job launcher could not be prepared; it is tried once more shortly'
        : 'Plugin hooks: the Windows job launcher failed again; it is tried again shortly',
    )
    return undefined
  }
  return {
    containment: async () => {
      const executablePath = await executable()
      if (executablePath === undefined) {
        return { kind: 'unavailable', notice: UI_TEXT.pluginHooksNoJob }
      }
      const resourceAssembly = await deps.shellJobAssembly?.()
      return {
        kind: 'job',
        launch: (command, args, options) => {
          // CreateProcessW starts an executable only; a batch shim needs a shell.
          if (!command.toLowerCase().endsWith(EXECUTABLE_SUFFIX)) {
            throw new Error('the plugin runtime is not an executable')
          }
          // D121: no job memory limit of ours — the OS's own limits apply.
          return spawnMcpJob({
            executablePath,
            file: command,
            args,
            isVerbatim: false,
            cwd: options.cwd,
            env: options.env,
            log: deps.log,
            resource: options.resource,
            resourceAssembly,
          })
        },
      }
    },
    reset: () => {
      state.failures = 0
      state.prepare = undefined
    },
  }
}

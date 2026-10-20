// What Amp and OpenCode plugin children run in (M91b; RVM91X P1 5, P2 12).
// On Windows each child starts through M50's compiled job launcher
// (`spawnMcpJob`): the launcher creates the runtime suspended, assigns it to
// a no-breakaway job with kill-on-close, and only then resumes it, so
// everything the plugin starts is in that job from its first instruction.
// Ending the launcher closes the job's only handle, which ends every process
// in it (`jobProcessTree` in core). POSIX uses the child's own process
// group. D121: no memory bound of ours — without a set ceiling the job
// carries kill-on-close and the OS's own limits, not a limit we set.
//
// A hook never runs without that containment. A failed preparation is tried
// again on every dispatch past a short pacing delay, with a notice in the
// user's language; the person's own failure latch sets plugin hooks aside
// until **Retry Plugin Hooks** (`reset`), which clears the count.

import { BYTES_PER_MIB, PLUGIN_JOB_RETRY_BACKOFF_MS, UI_TEXT } from '../../shared/constants'
import type { PluginContainment } from '../../core/backends/modelapi/pluginHost'
import { spawnMcpJob } from './mcpJobLaunch'

export interface PluginContainmentDeps {
  readonly shellJobAssembly?: (() => Promise<string | undefined>) | undefined
  readonly platform: NodeJS.Platform
  /** A fresh M50 launcher preparation (`mcpJobExecutable`); undefined when Windows has none. */
  readonly newJobExecutable: () => (() => Promise<string | undefined>) | undefined
  readonly now: () => number
  readonly log: (message: string) => void
  /**
   * Consecutive launcher failures that set plugin hooks aside until Retry
   * (D121: 0, the default, keeps trying past the pacing delay). Re-read per
   * dispatch, so a changed setting applies without rebinding.
   */
  readonly maxFailures?: (() => number) | undefined
  /**
   * The Windows job's memory ceiling in MiB (D121: 0, the default, is the
   * OS's own limits). Re-read per containment, so a changed setting applies.
   */
  readonly maxMemoryMiB?: (() => number) | undefined
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
    // The person's own failure latch, or none of ours: past the pacing
    // delay every dispatch prepares fresh and tries again; at the set count
    // plugin hooks stay off until Retry resets the count.
    const maxFailures = deps.maxFailures?.() ?? 0
    if (maxFailures > 0 && state.failures >= maxFailures) {
      return undefined
    }
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
    if (maxFailures > 0 && state.failures >= maxFailures) {
      deps.log(
        'Plugin hooks: the Windows job launcher failed again; they stay off until Retry Plugin Hooks',
      )
    } else if (state.failures === 1) {
      deps.log(
        'Plugin hooks: the Windows job launcher could not be prepared; it is tried once more shortly',
      )
    } else {
      deps.log('Plugin hooks: the Windows job launcher failed again; it is tried again shortly')
    }
    return undefined
  }
  return {
    containment: async () => {
      const executablePath = await executable()
      if (executablePath === undefined) {
        return { kind: 'unavailable', notice: UI_TEXT.pluginHooksNoJob }
      }
      const resourceAssembly = await deps.shellJobAssembly?.()
      // The person's own memory ceiling, or the OS's own limits: a set
      // ceiling caps the job the launcher starts through.
      const maxMemoryMiB = deps.maxMemoryMiB?.() ?? 0
      return {
        kind: 'job',
        launch: (command, args, options) => {
          // CreateProcessW starts an executable only; a batch shim needs a shell.
          if (!command.toLowerCase().endsWith(EXECUTABLE_SUFFIX)) {
            throw new Error('the plugin runtime is not an executable')
          }
          return spawnMcpJob({
            executablePath,
            file: command,
            args,
            isVerbatim: false,
            cwd: options.cwd,
            env: options.env,
            log: deps.log,
            ...(maxMemoryMiB > 0 && { jobMemoryLimit: maxMemoryMiB * BYTES_PER_MIB }),
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

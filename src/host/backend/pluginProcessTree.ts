// How Amp and OpenCode plugin children start and end as one tree (M91,
// RVM91X P1 5). On Windows each child starts through M50's compiled job
// launcher (`spawnMcpJob`): the launcher creates the runtime suspended,
// assigns it to a no-breakaway job with kill-on-close, and only then resumes
// it, so everything the plugin starts is in that job from its first
// instruction. Ending the launcher closes the job's only handle, which ends
// every process in it; the launcher also returns, closing the job, when the
// child exits or the extension host dies. Without the launcher the hook is
// refused (the call fails as its fail-closed rule says). POSIX uses the
// child's own process group (`posixProcessTree`).

import type { ChildProcess } from 'node:child_process'
import {
  nodeChildHandle,
  posixProcessTree,
  type PluginChildHandle,
  type PluginProcessTree,
} from '../../core/backends/modelapi/pluginHost'
import { spawnMcpJob } from './mcpJobLaunch'

export interface PluginProcessTreeDeps {
  readonly platform: NodeJS.Platform
  /** M50's job launcher (`mcpJobExecutable`); undefined when Windows cannot build it. */
  readonly jobExecutable: () => Promise<string | undefined>
  readonly log: (message: string) => void
}

const EXECUTABLE_SUFFIX = '.exe'

/** The tree for this platform: the job launcher on Windows, process groups elsewhere. */
export function pluginProcessTree(deps: PluginProcessTreeDeps): PluginProcessTree {
  if (deps.platform !== 'win32') {
    return posixProcessTree
  }
  const launchers = new WeakMap<PluginChildHandle, ChildProcess>()
  return {
    spawn: async (command, args, options) => {
      const executablePath = await deps.jobExecutable()
      if (executablePath === undefined) {
        throw new Error('Windows job containment is unavailable; the plugin was not started')
      }
      // CreateProcessW starts an executable only; a batch shim needs a shell.
      if (!command.toLowerCase().endsWith(EXECUTABLE_SUFFIX)) {
        throw new Error('the plugin runtime is not an executable')
      }
      const launcher = spawnMcpJob({
        executablePath,
        file: command,
        args,
        isVerbatim: false,
        cwd: options.cwd,
        env: options.env,
        log: deps.log,
      })
      const handle = nodeChildHandle(launcher)
      launchers.set(handle, launcher)
      return handle
    },
    killTree: (child) => {
      try {
        // TerminateProcess on the launcher closes the job's only handle:
        // kill-on-close ends the runtime and everything it started.
        launchers.get(child)?.kill()
      } catch {
        // Already gone: its job closed with it.
      }
    },
  }
}

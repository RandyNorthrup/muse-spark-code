// The shared Git runner's unconfigured-admission rule (src/host/git.ts):
// an embedding without a governor keeps its direct route. Kept outside
// checkout.ts so its pinned guard continues to forbid every raw launch there.
import { execFile, spawn } from 'node:child_process'
import type { GitProcessPort } from './checkout'

export const unconfiguredGitProcesses: GitProcessPort = {
  run: (file, args, options) =>
    new Promise((resolve, reject) => {
      const { beforeSpawn, ...launch } = options
      options.signal.throwIfAborted()
      beforeSpawn()
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Only absent resource admission (same shared Git rule), pinned file and argument array, bounded output/deadline, synchronous caller gate; PLAN SPAWNM123 round 3, section 8.
      execFile(file, [...args], { ...launch, windowsHide: true }, (error, stdout) => {
        if (error === null) resolve(stdout)
        else {
          const failure: Error = error
          reject(failure)
        }
      })
    }),
  start: (file, args, options) => {
    const { beforeSpawn, ...launch } = options
    options.signal.throwIfAborted()
    beforeSpawn()
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Only absent resource admission, as the shared Git runner; pinned file, argument array, deadline, owned POSIX group and synchronous caller gate; PLAN SPAWNM123 round 3, section 8.
    return spawn(file, [...args], { ...launch, windowsHide: true })
  },
}

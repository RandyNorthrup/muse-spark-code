// `git` and the hook writer of a fixture repository, for the playbook suites
// that run the real policy over real git (M116).
import { execFileSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function gitWorkspace(workspace: string, env: NodeJS.ProcessEnv) {
  return {
    /** Runs git there and returns what it printed. */
    git: (args: string[]): string =>
      execFileSync('git', args, { cwd: workspace, env, encoding: 'utf8', stdio: 'pipe' }).trim(),
    /** Writes one of the repository's own hooks. */
    hook: (name: string, body: string): void => {
      const file = path.join(workspace, '.git', 'hooks', name)
      writeFileSync(file, `#!/bin/sh\n${body}\n`)
      chmodSync(file, 0o755)
    },
  }
}

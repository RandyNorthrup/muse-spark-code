// How the extension runs git (the mention index, the Model API prompt's
// environment facts): by absolute path, found on the absolute PATH entries
// only, so a `git.exe` committed to the workspace is never the one that runs
// (PLAN.md D24); with a timeout, no console window, no credential prompt,
// and `GIT_OPTIONAL_LOCKS=0` so a background `git status` never takes the
// index lock out from under the user's own git.

import type { ExecFileOptions } from 'node:child_process'
import { resolveExecutable } from '../core/executables'
import { environmentValue } from '../core/backends/musecode/launch'
import { GIT_OUTPUT_MAX_BYTES, GIT_TIMEOUT_MS } from '../shared/constants'

const GIT = 'git'
const PATH_VARIABLE = 'PATH'

export interface GitRunnerDeps {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly fileExists: (filePath: string) => boolean
  /** `execFile` as a promise of stdout; rejects on a failure, a timeout or a non-zero exit. */
  readonly execFile: (
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
  ) => Promise<string>
}

/** A git runner; rejects when git is not on the absolute PATH. */
export function createGitRunner(
  deps: GitRunnerDeps,
): (args: readonly string[], cwd: string) => Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...deps.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  }
  // Found once per PATH value; a miss is not cached, so git installed while
  // the window is open is found on the next call.
  let cache: { readonly pathValue: string | undefined; readonly git: string } | undefined
  const gitPath = (): string | undefined => {
    const pathValue = environmentValue(deps.env, deps.platform, PATH_VARIABLE)
    if (cache === undefined || cache.pathValue !== pathValue) {
      const git = resolveExecutable(GIT, {
        platform: deps.platform,
        pathVariable: pathValue,
        fileExists: deps.fileExists,
      })
      cache = git === undefined ? undefined : { pathValue, git }
    }
    return cache?.git
  }
  return async (args, cwd) => {
    const git = gitPath()
    if (git === undefined) {
      throw new Error('git was not found on the absolute entries of PATH')
    }
    return await deps.execFile(git, args, {
      cwd,
      env,
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    })
  }
}

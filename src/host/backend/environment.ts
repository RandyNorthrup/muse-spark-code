// The git facts for the Model API prompt's environment section (PLAN.md
// D15): branch, how many entries `git status` lists and the latest commit
// subjects, gathered once per session. Metadata only, never file contents.
// Never rejects: outside a repository, without git, or in a repository with
// no commit yet the section says so instead. Not in Restricted Mode (D24):
// git reads the repository's own `.git/config`, and `core.fsmonitor` or
// `core.hooksPath` there would run a program the workspace chose.

import type { EnvironmentFacts } from '../../core/backends/modelapi/instructions'
import {
  ENVIRONMENT_RECENT_COMMITS,
  GIT_FILTER_NAMES_ARGS,
  GIT_METADATA_OPTIONS,
  UI_TEXT,
} from '../../shared/constants'
import { failureForLog } from '../../core/backends/musecode/logText'
import { gitFilterOptions } from '../git'
import type { Logger } from '../logger'

export interface EnvironmentDeps {
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  readonly workspaceRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly log: Logger
  readonly now: () => number
}

const LINE_BREAK = /\r?\n/

function nonEmptyLines(text: string): readonly string[] {
  return text.split(LINE_BREAK).filter((line) => line.trim() !== '')
}

async function recentCommits(
  run: (args: readonly string[]) => Promise<string>,
): Promise<readonly string[]> {
  try {
    return nonEmptyLines(await run(['log', '--oneline', `-${String(ENVIRONMENT_RECENT_COMMITS)}`]))
  } catch {
    // A repository before its first commit has a branch but no log.
    return []
  }
}

export async function describeEnvironment(deps: EnvironmentDeps): Promise<EnvironmentFacts> {
  const root = deps.workspaceRoot
  if (root === undefined || !deps.isWorkspaceTrusted()) {
    return { git: undefined }
  }
  const startedAt = deps.now()
  try {
    let names: string
    try {
      names = await deps.runGit([...GIT_METADATA_OPTIONS, ...GIT_FILTER_NAMES_ARGS], root)
    } catch (error: unknown) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 1) {
        throw error
      }
      names = ''
    }
    const filters = gitFilterOptions(names)
    const run = async (args: readonly string[]) => {
      if (!deps.isWorkspaceTrusted()) {
        throw new Error(UI_TEXT.checkpointFailed)
      }
      return await deps.runGit([...GIT_METADATA_OPTIONS, ...filters, ...args], root)
    }
    // Together, not one after another (M39): each may take up to git's own
    // timeout, and the first Model API turn waits for them.
    const [branchText, status, commits] = await Promise.all([
      run(['rev-parse', '--abbrev-ref', 'HEAD']),
      run(['status', '--porcelain']),
      recentCommits(run),
    ])
    deps.log.trace(`Git facts for the prompt in ${String(deps.now() - startedAt)} ms`)
    return {
      git: {
        branch: branchText.trim(),
        changedFiles: nonEmptyLines(status).length,
        recentCommits: commits,
      },
    }
  } catch (error: unknown) {
    // Outside a repository, without git, or git timing out: the log says
    // which (M39); the prompt only says there are no git facts.
    const reason = failureForLog(error)
    deps.log.info(`No git facts for the prompt: ${reason}`)
    return { git: undefined }
  }
}

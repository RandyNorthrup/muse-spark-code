// The git facts for the Model API prompt's environment section (PLAN.md
// D15): branch, how many entries `git status` lists and the latest commit
// subjects, gathered once per session. Metadata only, never file contents.
// Never rejects: outside a repository, without git, or in a repository with
// no commit yet the section says so instead. Not in Restricted Mode (D24):
// git reads the repository's own `.git/config`, and `core.fsmonitor` or
// `core.hooksPath` there would run a program the workspace chose.

import type { EnvironmentFacts } from '../../core/backends/modelapi/instructions'
import { ENVIRONMENT_RECENT_COMMITS } from '../../shared/constants'
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

async function recentCommits(deps: EnvironmentDeps, root: string): Promise<readonly string[]> {
  try {
    return nonEmptyLines(
      await deps.runGit(['log', '--oneline', `-${String(ENVIRONMENT_RECENT_COMMITS)}`], root),
    )
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
    // Together, not one after another (M39): each may take up to git's own
    // timeout, and the first Model API turn waits for them.
    const [branchText, status, commits] = await Promise.all([
      deps.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root),
      deps.runGit(['status', '--porcelain'], root),
      recentCommits(deps, root),
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
    const reason = error instanceof Error ? error.message : String(error)
    deps.log.info(`No git facts for the prompt: ${reason}`)
    return { git: undefined }
  }
}

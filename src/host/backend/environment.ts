// The git facts for the Model API prompt's environment section (PLAN.md
// D15): branch, how many entries `git status` lists and the latest commit
// subjects, gathered once per session. Metadata only, never file contents.
// Never rejects: outside a repository, without git, or in a repository with
// no commit yet the section says so instead. Not in Restricted Mode (D24):
// git reads the repository's own `.git/config`, and `core.fsmonitor` or
// `core.hooksPath` there would run a program the workspace chose.

import type { EnvironmentFacts } from '../../core/backends/modelapi/instructions'
import { ENVIRONMENT_RECENT_COMMITS } from '../../shared/constants'

export interface EnvironmentDeps {
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  readonly workspaceRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
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
  try {
    const branchText = await deps.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], root)
    const status = await deps.runGit(['status', '--porcelain'], root)
    return {
      git: {
        branch: branchText.trim(),
        changedFiles: nonEmptyLines(status).length,
        recentCommits: await recentCommits(deps, root),
      },
    }
  } catch {
    return { git: undefined }
  }
}

// Lists workspace paths for the mention index. With `respectGitIgnore` on the
// list comes from `git ls-files --cached --others --exclude-standard`, which
// applies every .gitignore exactly the way git does; when git is missing or
// the folder is not a repository it falls back to VS Code's file search
// (which honours `files.exclude` but not .gitignore). With the setting off,
// or in Restricted Mode (git would read the untrusted repository's own
// config, PLAN.md D24), only the file search is used.

import { GIT_LS_FILES_ARGS } from '../../shared/constants'
import type { Logger } from '../logger'

export interface WorkspaceFileListerDeps {
  readonly workspaceRoot: string
  readonly respectGitIgnore: () => boolean
  readonly isWorkspaceTrusted: () => boolean
  /** Runs git with `args` in `cwd` and resolves stdout; rejects on any failure. */
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** Workspace-relative paths (forward slashes) from `workspace.findFiles`. */
  readonly findFiles: () => Promise<readonly string[]>
  readonly log: Logger
}

/** Splits NUL-separated output, dropping the empty trailing entry. */
export function parseNulSeparated(output: string): readonly string[] {
  return output.split('\0').filter((entry) => entry !== '')
}

export function createWorkspaceFileLister(
  deps: WorkspaceFileListerDeps,
): () => Promise<readonly string[]> {
  return async () => {
    if (!deps.respectGitIgnore() || !deps.isWorkspaceTrusted()) {
      return await deps.findFiles()
    }
    try {
      const output = await deps.runGit(GIT_LS_FILES_ARGS, deps.workspaceRoot)
      return parseNulSeparated(output)
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      deps.log.warn(`git ls-files unavailable (${reason}); .gitignore is not applied to mentions`)
      return await deps.findFiles()
    }
  }
}

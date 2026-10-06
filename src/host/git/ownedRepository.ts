import { isSameFolder } from '../../core/worktrees'
import { UI_TEXT } from '../../shared/constants'
import type { CaptureGitOwner, GitRepository } from './repositoryPort'

/** Runtime error identity; the installed VS Code entry supplies its native identity. */
export class GitUnavailableError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'GitUnavailableError'
  }
}

/** Shared ownership checks; the injected repository service retains native Git credentials. */
export async function openOwnedRepository(
  root: string,
  platform: NodeJS.Platform,
  repositoryAtRoot: (root: string) => Promise<GitRepository>,
  captureOwner: CaptureGitOwner,
  check: () => void,
  ErrorType: typeof GitUnavailableError = GitUnavailableError,
) {
  const selected = await captureOwner(root, check)
  const requireSelected = () => {
    check()
    if (!selected.isCurrent()) throw new ErrorType(UI_TEXT.gitOperationChanged)
  }
  requireSelected()
  const repository = await repositoryAtRoot(selected.cwd)
  requireSelected()
  const originalRoot = repository.rootUri.fsPath
  const actual = await captureOwner(originalRoot, requireSelected)
  const requireOwned = () => {
    requireSelected()
    const isSameOwner = actual.isCurrent() && isSameFolder(actual.cwd, selected.cwd, platform)
    const isSameRoot = isSameFolder(repository.rootUri.fsPath, originalRoot, platform)
    if (!isSameOwner || !isSameRoot) throw new ErrorType(UI_TEXT.gitOperationChanged)
  }
  requireOwned()
  await repository.status()
  requireOwned()
  return { repository, cwd: selected.cwd, check: requireOwned }
}

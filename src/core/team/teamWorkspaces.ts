import path from 'node:path'
import { UI_TEXT } from '../../shared/constants'

// --- M96c lane Q: checkout guard. M96 lane I owns the workspace lifecycle. ---
export interface TeamCheckoutGuard {
  readonly canonicalPath: (target: string) => Promise<string>
  readonly platform: NodeJS.Platform
}

/** Called at worker start and before every command, including after a cwd change. */
export async function assertTeamCheckout(
  repositoryRoot: string,
  directory: string,
  mode: 'read-only' | 'own-branch' | 'in-place',
  deps: TeamCheckoutGuard,
): Promise<void> {
  const root = await deps.canonicalPath(repositoryRoot)
  const cwd = await deps.canonicalPath(directory)
  const paths = deps.platform === 'win32' ? path.win32 : path.posix
  const relative = paths.relative(root, cwd)
  const isInCheckout =
    relative === '' ||
    (!relative.startsWith(`..${paths.sep}`) && relative !== '..' && !paths.isAbsolute(relative))
  if (isInCheckout && mode !== 'in-place') throw new Error(UI_TEXT.checkpointFailed)
}
// --- End lane Q region. ---

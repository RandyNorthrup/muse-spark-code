// The physical identity of a workspace folder: its canonical path and its
// device and inode (bigint, which Node 20 hosts read too), so a request bound
// to a folder can tell when the path it was given now leads to another one. A
// link or junction retargeted, or a directory replaced, changes the identity
// while the lexical and canonical paths still resolve. Used by the review's
// git reads (M70) and by the ACP agent's Model API hosts (PLAN.md D62).

import { statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { WORKSPACE_IDENTITY_ZERO } from '../shared/constants'
import { canonicalPath } from './canonicalPath'

export interface WorkspaceIdentity {
  /** The folder's canonical path, links and junctions resolved. */
  readonly canonical: string
  /** `device:inode`, to compare one identity with another. */
  readonly key: string
  /**
   * Whether the path the folder was given by, and its canonical path, still
   * lead to the directory that was captured. Reads the file system afresh
   * each time and answers false for anything it cannot read.
   */
  readonly isCurrent: () => boolean
}

/**
 * The identity of the directory `root` leads to now; undefined when it leads
 * to no directory or one with no usable identity. Rejects when the path
 * cannot be resolved or read at all (a permission error, a link loop).
 */
export async function captureWorkspaceIdentity(
  root: string,
): Promise<WorkspaceIdentity | undefined> {
  const canonical = await canonicalPath(root)
  const captured = await stat(canonical, { bigint: true })
  if (
    !captured.isDirectory() ||
    captured.ino <= WORKSPACE_IDENTITY_ZERO ||
    captured.dev < WORKSPACE_IDENTITY_ZERO
  ) {
    return undefined
  }
  return {
    canonical,
    key: `${captured.dev.toString()}:${captured.ino.toString()}`,
    isCurrent: () => {
      try {
        return [root, canonical].every((folder) => {
          const current = statSync(folder, { bigint: true })
          return (
            current.isDirectory() && current.dev === captured.dev && current.ino === captured.ino
          )
        })
      } catch {
        return false
      }
    },
  }
}

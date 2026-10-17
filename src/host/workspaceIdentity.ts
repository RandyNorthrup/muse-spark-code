// The physical identity of a workspace folder: its canonical path and its
// native file ID (sampled by core/fs/fileIdentity, the one place that reads
// device and inode), so a request bound to a folder can tell when the path it
// was given now leads to another one. A link or junction retargeted, or a
// directory replaced, changes the identity while the lexical and canonical
// paths still resolve. Used by the review's git reads (M70) and by the ACP
// agent's Model API hosts (PLAN.md D62).

import { fileIdentityKey, sameFile, statIdentity, statIdentitySync } from '../core/fs/fileIdentity'
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
  const captured = await statIdentity(canonical)
  const key = fileIdentityKey(captured)
  if (key === undefined || !captured.isDirectory()) {
    return undefined
  }
  return {
    canonical,
    key,
    isCurrent: () => {
      try {
        return [root, canonical].every((folder) => {
          const current = statIdentitySync(folder)
          return current.isDirectory() && sameFile(current, captured)
        })
      } catch {
        return false
      }
    },
  }
}

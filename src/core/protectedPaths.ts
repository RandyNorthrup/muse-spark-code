// Protected writes (PLAN.md D24): a file that configures or runs code
// outside the edit itself (git's hooks and config, the editor's tasks, CI
// workflows, the agent's own rules and skills, other coding agents' hooks
// and settings). The Model API's permission
// engine asks before writing one; the conversation controller refuses one
// as a picked text file (M54). Apart from the engine so the activation
// bundle carries only this (M57, PLAN.md D6).

import { PROTECTED_FILE_NAMES, PROTECTED_PATH_SEGMENTS } from '../shared/constants'

/**
 * Whether a workspace-relative path (forward slashes, links resolved) is a
 * protected write. Case is ignored: Windows and macOS file systems fold it.
 */
export function isProtectedPath(canonicalRelative: string): boolean {
  const segments = canonicalRelative.toLowerCase().split('/')
  const name = segments.at(-1) ?? ''
  if (PROTECTED_FILE_NAMES.has(name)) {
    return true
  }
  // The run may sit anywhere (a nested repository's `.git`) and may be the
  // file itself (a `.git` file points git at another directory).
  return segments.some((_segment, index) =>
    PROTECTED_PATH_SEGMENTS.some(
      (protectedSegments) =>
        protectedSegments.length <= segments.length - index &&
        protectedSegments.every((part, offset) => segments[index + offset] === part),
    ),
  )
}

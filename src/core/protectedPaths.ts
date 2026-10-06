// Protected writes (PLAN.md D24): a file that configures or runs code
// outside the edit itself (git's hooks and config, the editor's tasks, CI
// workflows, the agent's own rules and skills, other coding agents' hooks
// and settings). The Model API's permission
// engine asks before writing one; the conversation controller refuses one
// as a picked text file (M54). Apart from the engine so the activation
// bundle carries only this (M57, PLAN.md D6).
//
// On Muse Code the CLI decides which writes ask, and flags its own protected
// ones; the extension also judges a Muse Code file-write approval by this
// list (`isProtectedFileAccess`), so Edit automatically and the Auto reviewer
// never answer one and its card offers no standing rule (2026-10-04).

import type { ApprovalSubject } from '../shared/agentEvents'
import { PROTECTED_FILE_NAMES, PROTECTED_PATH_SEGMENTS } from '../shared/constants'

// MSP's file-access subject (Muse Code; the Model API sends `fileWrite`).
const FILE_ACCESS_SUBJECT = 'fileAccess'
const READ_ACCESS = 'read'

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

/**
 * Whether a Muse Code approval asks to write a protected file: a
 * `fileAccess` subject with any access but a read (an access it does not
 * name counts as a write). Muse Code names the file by its absolute path,
 * `\\?\C:\…\.muse\hooks.json` on Windows (captured 2026-10-04,
 * docs/certification/protect-agent-folders.md), and a file outside the
 * workspace by its own path, so both separators split and every segment
 * counts: one outside the workspace (`~/.claude/settings.json`) is
 * protected, and so is every file of a workspace inside a protected folder,
 * which only asks more. The Model API's `fileWrite` subjects are judged by
 * its host on the canonical path instead (`isProtectedWrite`), and a memory
 * note there is an ordinary edit (D41).
 */
export function isProtectedFileAccess(
  subject: Pick<ApprovalSubject, 'kind' | 'path' | 'access'>,
): boolean {
  return (
    subject.kind === FILE_ACCESS_SUBJECT &&
    subject.access !== READ_ACCESS &&
    subject.path !== undefined &&
    isProtectedPath(subject.path.replaceAll('\\', '/'))
  )
}

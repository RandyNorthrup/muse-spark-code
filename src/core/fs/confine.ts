// A path confined to a root. Lexical `..` is not enough: a later read or
// create follows a symlink or a Windows junction, including when the final
// name does not exist yet. The walk follows each link the way the open
// will, and returns the resolved path only when it stays inside the root.
// A link that leaves, or a link whose target is not there, is refused.
// Callers say the refusal in their own words.

import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { isErrno } from './errno'

function isOutsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate).replaceAll('\\', '/')
  return (
    relative === '..' ||
    relative.startsWith('../') ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative)
  )
}

function partsOf(absolute: string): readonly string[] {
  const root = path.parse(absolute).root
  return absolute
    .slice(root.length)
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part !== '')
}

/**
The path of `given` under `root`, or undefined when it leaves the root.
`given` may be absolute or relative. A symlink or junction is resolved and
kept only when its target stays inside the root. The returned path is the
one a later open uses, so a link that was refused is not opened by name.
*/
export async function confineToRoot(root: string, given: string): Promise<string | undefined> {
  const realRoot = await realpath(root)
  // Resolve lexical `..` against the real root for a relative name. An
  // absolute name is walked from its own root so a symlink spelling of
  // the same directory (`/tmp` and `/private/tmp`) still resolves inside.
  const absolute = path.isAbsolute(given) ? path.resolve(given) : path.resolve(realRoot, given)
  const parts = partsOf(absolute)
  let current = path.parse(absolute).root
  for (const [index, part] of parts.entries()) {
    if (part === '..') {
      current = path.dirname(current)
      continue
    }
    const next = path.join(current, part)
    let info: Awaited<ReturnType<typeof lstat>>
    try {
      info = await lstat(next)
    } catch (error: unknown) {
      // A missing name cannot itself be a link. Keep it only when the
      // directory already walked is inside the root. Anything else keeps
      // its kind.
      if (isErrno(error) && error.code === 'ENOENT') {
        const rest = path.join(current, ...parts.slice(index))
        return isOutsideRoot(realRoot, current) || isOutsideRoot(realRoot, rest) ? undefined : rest
      }
      throw error
    }
    if (info.isSymbolicLink()) {
      let target: string
      try {
        target = await realpath(next)
      } catch (error: unknown) {
        // A link with no target cannot be shown to stay inside the root.
        if (isErrno(error) && error.code === 'ENOENT') return undefined
        throw error
      }
      current = target
      continue
    }
    if (index < parts.length - 1 && !info.isDirectory()) return undefined
    current = next
  }
  return isOutsideRoot(realRoot, current) ? undefined : current
}

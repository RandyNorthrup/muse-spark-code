// The canonical form of a path that may not exist yet (PLAN.md D24): the
// real path of its nearest existing ancestor, symbolic links, junctions and
// short names resolved by the operating system, with the missing tail
// appended as given. Confinement compares canonical forms, so a link inside
// the workspace that points outside it is seen for what it is.
//
// A broken link (one whose target does not exist) is, by default, a missing
// component like any other: right for a write that replaces the link (the
// atomic write renames over it, fsAtomic.ts). A caller that appends to a file
// or opens it in an editor follows the link instead, so it asks for
// `followsBrokenLinks` and the link's target is canonicalised in its place
// (M83: a dangling `AGENTS.md` → `~/.bashrc` would otherwise read as inside).

import { lstat, readlink, realpath } from 'node:fs/promises'
import path from 'node:path'
import { LINK_FOLLOW_MAX_HOPS } from '../shared/constants'

const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])
const LINK_LOOP = 'ELOOP'

/** A file system error that means "not there": the file, or a directory on its way. */
export function isMissingPath(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    MISSING_CODES.has(error.code)
  )
}

export interface CanonicalPathOptions {
  /** Follow a link whose target does not exist, as an append or an editor would. */
  readonly followsBrokenLinks?: boolean
}

/** Where a broken link leads; undefined when the path is not a link. */
async function brokenLinkTarget(absolutePath: string): Promise<string | undefined> {
  try {
    const info = await lstat(absolutePath)
    return info.isSymbolicLink()
      ? path.resolve(path.dirname(absolutePath), await readlink(absolutePath))
      : undefined
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

async function resolveThrough(
  absolutePath: string,
  options: CanonicalPathOptions,
  hops: number,
): Promise<string> {
  const tail: string[] = []
  let current = path.resolve(absolutePath)
  for (;;) {
    try {
      const real = await realpath(current)
      return tail.length === 0 ? real : path.join(real, ...tail.toReversed())
    } catch (error: unknown) {
      if (!isMissingPath(error)) {
        throw error
      }
      const target =
        options.followsBrokenLinks === true ? await brokenLinkTarget(current) : undefined
      if (target !== undefined) {
        if (hops >= LINK_FOLLOW_MAX_HOPS) {
          throw Object.assign(new Error('too many levels of links'), { code: LINK_LOOP })
        }
        return await resolveThrough(path.join(target, ...tail.toReversed()), options, hops + 1)
      }
      const parent = path.dirname(current)
      if (parent === current) {
        // Not even the root exists (an unmounted drive): nothing to resolve.
        return path.join(current, ...tail.toReversed())
      }
      tail.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * Resolves `absolutePath` through the file system. Rejects on anything but
 * a missing component (a permission error, a link loop), so a caller never
 * mistakes an unreadable path for a confined one.
 */
export async function canonicalPath(
  absolutePath: string,
  options: CanonicalPathOptions = {},
): Promise<string> {
  return await resolveThrough(absolutePath, options, 0)
}

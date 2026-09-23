// The canonical form of a path that may not exist yet (PLAN.md D24): the
// real path of its nearest existing ancestor, symbolic links, junctions and
// short names resolved by the operating system, with the missing tail
// appended as given. Confinement compares canonical forms, so a link inside
// the workspace that points outside it is seen for what it is.

import { realpath } from 'node:fs/promises'
import path from 'node:path'

const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR'])

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    MISSING_CODES.has(error.code)
  )
}

/**
 * Resolves `absolutePath` through the file system. Rejects on anything but
 * a missing component (a permission error, a link loop), so a caller never
 * mistakes an unreadable path for a confined one.
 */
export async function canonicalPath(absolutePath: string): Promise<string> {
  const tail: string[] = []
  let current = path.resolve(absolutePath)
  for (;;) {
    try {
      const real = await realpath(current)
      return tail.length === 0 ? real : path.join(real, ...tail.toReversed())
    } catch (error: unknown) {
      if (!isMissing(error)) {
        throw error
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

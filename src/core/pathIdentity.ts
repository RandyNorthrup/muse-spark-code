import path from 'node:path'
import { realpathSync } from 'node:fs'
import { fileIdentityKey, sameFile, statIdentitySync, type FileIdentity } from './fs/fileIdentity'
import { isWithinFolder } from './paths'

type IdentityRelation = 'inside' | 'outside' | 'unknown'

/** A segment shaped like an NTFS 8.3 alias (`GIT~1`, `CLAUDE~1`). */
export const SHORT_NAME_SHAPE = /~\d/u

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * The native long name of an absolute path: the nearest existing ancestor
 * resolved by `realpath.native` (8.3 names, junctions, links and `subst`
 * letters become the real path), the missing leaves appended as given.
 * Undefined when a missing leaf still has an 8.3 shape (nothing can resolve
 * it yet) or when no ancestor can be read.
 */
export function resolvedLongPath(given: string): string | undefined {
  if (!path.isAbsolute(given)) return undefined
  const tail: string[] = []
  let current = path.resolve(given)
  for (;;) {
    try {
      const real = realpathSync.native(current)
      return tail.some((part) => SHORT_NAME_SHAPE.test(part))
        ? undefined
        : path.join(real, ...tail.toReversed())
    } catch (error: unknown) {
      if (!isMissing(error)) return undefined
      const parent = path.dirname(current)
      if (parent === current) return undefined
      tail.push(path.basename(current))
      current = parent
    }
  }
}

/** The identities of a folder's resolved ancestors (itself included), and their root. */
function resolvedAncestors(folder: string, p: path.PlatformPath) {
  const keys = new Set<string>()
  let current = realpathSync.native(folder)
  for (;;) {
    const key = fileIdentityKey(statIdentitySync(current))
    if (key !== undefined) keys.add(key)
    const parent = p.dirname(current)
    if (parent === current) return { keys, top: current }
    current = parent
  }
}

/**
 * Compare native identities (volume serial plus a non-zero file ID): a path
 * is inside `folder` exactly when it or one of its existing ancestors has the
 * folder's identity. The nearest existing ancestor is resolved once, so a
 * junction, symbolic link, `subst` letter or 8.3 name above it is judged by
 * the real folder it reaches, and a link above a trusted root is ordinary.
 * A target on another volume (another device id, WSL's device 0 included)
 * is outside. On the folder's own volume the walk must end at a root that is
 * one of the folder's resolved ancestors (its drive root, `\\localhost\C$`,
 * a `\\localhost\Users` share above it): a share rooted elsewhere on that
 * volume, or a missing file ID below the root, cannot establish exclusion.
 * A missing folder (the held-worktrees folder before the first checkout) is
 * its nearest existing ancestor plus the missing names below it.
 */
export function pathIdentityRelation(
  candidate: string,
  folder: string,
  platform: NodeJS.Platform = process.platform,
): IdentityRelation {
  const isTextuallyInside = isWithinFolder(candidate, folder, platform)
  if (platform !== process.platform) return isTextuallyInside ? 'inside' : 'unknown'
  const p = platform === 'win32' ? path.win32 : path.posix
  const sameName = (left: string, right: string | undefined) =>
    platform === 'win32' ? left.toLowerCase() === right?.toLowerCase() : left === right
  try {
    const reserved: string[] = []
    let existingFolder = p.resolve(folder)
    let folderIdentity: FileIdentity
    for (;;) {
      try {
        folderIdentity = statIdentitySync(existingFolder)
        break
      } catch (error: unknown) {
        if (!isMissing(error)) return 'unknown'
        const parent = p.dirname(existingFolder)
        if (parent === existingFolder) return isTextuallyInside ? 'inside' : 'unknown'
        reserved.unshift(p.basename(existingFolder))
        existingFolder = parent
      }
    }
    let current = p.resolve(candidate)
    const suffix: string[] = []
    let target: FileIdentity | undefined
    let top: FileIdentity
    for (;;) {
      let identity: FileIdentity
      try {
        identity = statIdentitySync(current)
      } catch (error: unknown) {
        if (target !== undefined || !isMissing(error)) return 'unknown'
        const parent = p.dirname(current)
        if (parent === current) return 'unknown'
        suffix.unshift(p.basename(current))
        current = parent
        continue
      }
      if (target === undefined) {
        // The target (its nearest existing ancestor) decides the volume.
        if (identity.dev !== folderIdentity.dev) return 'outside'
        if (fileIdentityKey(folderIdentity) === undefined) return 'unknown'
        // Resolve it once; its canonical parents no longer traverse the
        // link's lexical location. Bind the resolved name to the same object.
        const canonical = realpathSync.native(current)
        if (!sameFile(identity, statIdentitySync(canonical))) return 'unknown'
        current = canonical
        target = identity
      }
      const parent = p.dirname(current)
      const isTop = parent === current
      if (identity.dev === folderIdentity.dev) {
        if (fileIdentityKey(identity) === undefined) {
          // A root without a file index (FAT/exFAT) is never the folder itself.
          if (!isTop) return 'unknown'
        } else if (sameFile(identity, folderIdentity)) {
          return reserved.every((part, index) => sameName(part, suffix[index]))
            ? 'inside'
            : 'outside'
        }
      }
      if (isTop) {
        top = identity
        break
      }
      suffix.unshift(p.basename(current))
      current = parent
    }
    if (top.dev !== folderIdentity.dev) return 'outside'
    // The walk is complete only when its root lies above the folder.
    const above = resolvedAncestors(existingFolder, p)
    const key = fileIdentityKey(top)
    return (key !== undefined && above.keys.has(key)) || sameName(current, above.top)
      ? 'outside'
      : 'unknown'
  } catch {
    return 'unknown'
  }
}

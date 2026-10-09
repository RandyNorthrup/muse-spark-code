import path from 'node:path'
import { realpathSync } from 'node:fs'
import {
  fileIdentityKey,
  isSameVolume,
  sameFile,
  statIdentitySync,
  type FileIdentity,
} from './fs/fileIdentity'
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

/** Whether a folder's resolved ancestors (itself included) include `identity`. */
function isResolvedAncestor(identity: FileIdentity, folder: string, p: path.PlatformPath) {
  let current = realpathSync.native(folder)
  for (;;) {
    if (sameFile(statIdentitySync(current), identity)) return true
    const parent = p.dirname(current)
    if (parent === current) return false
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
 * is outside. On the folder's own volume the walk must reach the volume's
 * root, or a share root that is one of the folder's resolved ancestors
 * (`\\localhost\C$`, a `\\localhost\Users` share above it): a share rooted
 * elsewhere on that volume, or a missing file ID below the root, cannot
 * establish exclusion. A missing folder (the held-worktrees folder before the
 * first checkout) is its nearest existing ancestor plus the names below it.
 */
export function pathIdentityRelation(
  candidate: string,
  folder: string,
  platform: NodeJS.Platform = process.platform,
): IdentityRelation {
  const isTextuallyInside = isWithinFolder(candidate, folder, platform)
  if (platform !== process.platform) return isTextuallyInside ? 'inside' : 'unknown'
  const p = platform === 'win32' ? path.win32 : path.posix
  const isSameName = (left: string, right: string | undefined) =>
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
        if (!isSameVolume(identity, folderIdentity)) return 'outside'
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
      if (isSameVolume(identity, folderIdentity)) {
        if (fileIdentityKey(identity) === undefined) {
          // A root without a file index (FAT/exFAT) is never the folder itself.
          if (!isTop) return 'unknown'
        } else if (sameFile(identity, folderIdentity)) {
          return reserved.every((part, index) => isSameName(part, suffix[index]))
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
    if (!isSameVolume(top, folderIdentity)) return 'outside'
    // The walk is complete at the volume's own root (`realpath` resolves
    // `subst` letters), or at a share root that lies above the folder.
    const isVolumeRoot = platform === 'win32' ? /^[a-z]:\\$/iu.test(current) : current === '/'
    return isVolumeRoot ||
      (fileIdentityKey(top) !== undefined && isResolvedAncestor(top, existingFolder, p))
      ? 'outside'
      : 'unknown'
  } catch {
    return 'unknown'
  }
}

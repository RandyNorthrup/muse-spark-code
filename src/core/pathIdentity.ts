import path from 'node:path'
import { realpathSync } from 'node:fs'
import { fileIdentityKey, sameFile, statIdentitySync } from './fs/fileIdentity'
import { isWithinFolder } from './paths'
import { isUncPath } from './windowsPathSpelling'

type IdentityRelation = 'inside' | 'outside' | 'unknown'

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Compare native volume/file identities up from the nearest existing ancestor.
 * Missing leaves are allowed; inaccessible objects and incomparable SMB volumes
 * never establish exclusion. No path rewrite claims a Win32 alias's identity.
 */
export function pathIdentityRelation(
  candidate: string,
  folder: string,
  platform: NodeJS.Platform = process.platform,
): IdentityRelation {
  const isTextuallyInside = isWithinFolder(candidate, folder, platform)
  if (platform !== process.platform) return isTextuallyInside ? 'inside' : 'unknown'
  const p = platform === 'win32' ? path.win32 : path.posix
  const isUnc = platform === 'win32' && (isUncPath(candidate) || isUncPath(folder))
  try {
    const root = statIdentitySync(folder)
    if (fileIdentityKey(root) === undefined) return 'unknown'
    const volumeRoot = isUnc
      ? statIdentitySync(p.parse(realpathSync.native(folder)).root)
      : undefined
    if (volumeRoot !== undefined && fileIdentityKey(volumeRoot) === undefined) return 'unknown'
    let current = p.isAbsolute(candidate) ? candidate : p.resolve(candidate)
    let hasFoundAncestor = false
    let hasComparableRoot = false
    for (;;) {
      let parent: string
      try {
        const identity = statIdentitySync(current)
        if (fileIdentityKey(identity) === undefined) return 'unknown'
        if (sameFile(identity, root)) return 'inside'
        const isNearestAncestor = !hasFoundAncestor
        hasFoundAncestor = true
        if (isNearestAncestor) {
          // Resolve the nearest ancestor once; its canonical parents no longer
          // traverse the junction's lexical location. Bind the resolved name too.
          const canonical = realpathSync.native(current)
          if (!sameFile(identity, statIdentitySync(canonical))) return 'unknown'
          current = canonical
        }
        hasComparableRoot ||= volumeRoot !== undefined && sameFile(identity, volumeRoot)
        parent = p.dirname(current)
      } catch (error: unknown) {
        if (hasFoundAncestor || !isMissing(error)) return 'unknown'
        parent = p.dirname(current)
      }
      if (parent === current) break
      current = parent
    }
    return hasFoundAncestor && (!isUnc || hasComparableRoot) ? 'outside' : 'unknown'
  } catch (error: unknown) {
    // A not-yet-created DOS root has no native alias yet. Its literal descendants
    // remain reserved; UNC exclusion still needs native proof.
    return !isUnc && isMissing(error) ? (isTextuallyInside ? 'inside' : 'outside') : 'unknown'
  }
}

// Whether two absolute paths name the same file, by the platform's rules
// (PLAN.md D27): Windows compares without case and with either separator,
// POSIX compares the normalised paths exactly. Pure.

import path from 'node:path'
import { windowsPathIdentity } from './pathIdentity'

export function isSamePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32'
    ? windowsPathIdentity(left) === windowsPathIdentity(right)
    : path.posix.normalize(left) === path.posix.normalize(right)
}

/** Whether absolute `candidate` is `folder` itself or somewhere under it, by the same rules. */
export function isWithinFolder(
  candidate: string,
  folder: string,
  platform: NodeJS.Platform,
): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix
  const fold = (value: string) => (platform === 'win32' ? windowsPathIdentity(value) : value)
  // Fold before relative resolves: resolve drops the final separator, which
  // changes Win32's treatment of a directory ending in dots or spaces.
  const relative = p.relative(fold(folder), fold(candidate))
  // `..` as a whole segment: a folder named `..cache` inside is still inside.
  const isAbove = relative === '..' || relative.startsWith(`..${p.sep}`)
  return !isAbove && !p.isAbsolute(relative)
}

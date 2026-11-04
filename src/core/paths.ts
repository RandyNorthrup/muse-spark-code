// Whether two absolute paths name the same file, by the platform's rules
// (PLAN.md D27): Windows compares without case and with either separator,
// POSIX compares the normalised paths exactly. Pure.

import path from 'node:path'

/** What two absolute paths share exactly when they name the same file: a set's key. */
export function samePathKey(name: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? path.win32.normalize(name).toLowerCase()
    : path.posix.normalize(name)
}

export function isSamePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return samePathKey(left, platform) === samePathKey(right, platform)
}

/** Whether absolute `candidate` is `folder` itself or somewhere under it, by the same rules. */
export function isWithinFolder(
  candidate: string,
  folder: string,
  platform: NodeJS.Platform,
): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix
  const fold = (value: string) => (platform === 'win32' ? value.toLowerCase() : value)
  const relative = p.relative(fold(p.resolve(folder)), fold(p.resolve(candidate)))
  // `..` as a whole segment: a folder named `..cache` inside is still inside.
  const isAbove = relative === '..' || relative.startsWith(`..${p.sep}`)
  return !isAbove && !p.isAbsolute(relative)
}

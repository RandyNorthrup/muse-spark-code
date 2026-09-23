// Whether two absolute paths name the same file, by the platform's rules
// (PLAN.md D27): Windows compares without case and with either separator,
// POSIX compares the normalised paths exactly. Pure.

import path from 'node:path'

export function isSamePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32'
    ? path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase()
    : path.posix.normalize(left) === path.posix.normalize(right)
}

// The glob compiler (glob.ts) with the extension's limits (PLAN.md D24),
// for everything but the search worker, which gets them with its job.

import { GLOB_MAX_ALTERNATIVES, GLOB_MAX_LENGTH } from '../../../shared/constants'
import { compileDenyGlobsWithin, compileGlobWithin, type GlobLimits } from './glob'

export const GLOB_LIMITS: GlobLimits = {
  maxLength: GLOB_MAX_LENGTH,
  maxAlternatives: GLOB_MAX_ALTERNATIVES,
}

/** A glob as a matcher; throws on one longer than the cap or with too many alternatives. */
export function compileGlob(pattern: string): (relativePath: string) => boolean {
  return compileGlobWithin(pattern, GLOB_LIMITS)
}

export function isGlobMatch(relativePath: string, pattern: string): boolean {
  return compileGlob(pattern)(relativePath)
}

/** The permission settings' deny-read globs as one matcher (M78). */
export function compileDenyGlobs(
  lowerCaseGlobs: readonly string[],
): (relativePaths: readonly string[]) => boolean {
  return compileDenyGlobsWithin(lowerCaseGlobs, GLOB_LIMITS)
}

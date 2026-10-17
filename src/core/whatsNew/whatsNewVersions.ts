// What's New after an update (M99, PLAN.md D79): the version arithmetic and
// the choice of what to show. Pure, so it is unit-tested directly.
//
// - A version is semantic versioning's `MAJOR.MINOR.PATCH[-PRERELEASE]`
//   (build metadata ignored), compared by semver's precedence: a prerelease
//   sorts below its release, its dot-separated identifiers numerically when
//   both are numbers, otherwise as text, and a shorter list below a longer
//   one that it starts.
// - The first activation with no stored version is a fresh install (nothing
//   is shown: the walkthrough and onboarding cover new users), unless there
//   is evidence of earlier use: then it is an upgrade from a version before
//   this feature, whose previous version is unknown.
// - A newer version is an upgrade; the same or an older one shows nothing.

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const NUMERIC_IDENTIFIER = /^\d+$/

interface ParsedVersion {
  readonly core: readonly [number, number, number]
  readonly prerelease: readonly string[]
}

function parseVersion(version: string): ParsedVersion | undefined {
  const match = SEMVER.exec(version)
  if (match === null) {
    return undefined
  }
  const [, major = '', minor = '', patch = '', prerelease] = match
  return {
    core: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  }
}

/** Whether a text is a semantic version this module can compare. */
export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && parseVersion(value) !== undefined
}

function compareIdentifiers(a: string, b: string): number {
  const isNumberA = NUMERIC_IDENTIFIER.test(a)
  const isNumberB = NUMERIC_IDENTIFIER.test(b)
  if (isNumberA && isNumberB) {
    return Math.sign(Number(a) - Number(b))
  }
  if (isNumberA !== isNumberB) {
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    return isNumberA ? -1 : 1
  }
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) {
    // A release outranks every prerelease of the same core version.
    return Math.sign(b.length - a.length)
  }
  return compareIdentifierLists(a, b)
}

/** The first identifier that differs decides; a list that the other starts with is lower. */
function compareIdentifierLists(a: readonly string[], b: readonly string[]): number {
  const [first = '', ...rest] = a
  const [other = '', ...others] = b
  if (a.length === 0 || b.length === 0) {
    return Math.sign(a.length - b.length)
  }
  const order = compareIdentifiers(first, other)
  return order === 0 ? compareIdentifierLists(rest, others) : order
}

/**
 * Semver precedence: negative when `a` is older than `b`, positive when newer,
 * 0 when equal (build metadata aside). Throws on a text that is not a version.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === undefined || right === undefined) {
    throw new Error(`Not a semantic version: ${left === undefined ? a : b}`)
  }
  for (let index = 0; index < left.core.length; index += 1) {
    const order = Math.sign((left.core[index] ?? 0) - (right.core[index] ?? 0))
    if (order !== 0) {
      return order
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

export type UpdateDecision =
  /** No version stored and no sign of earlier use: record it, show nothing. */
  | { readonly kind: 'firstInstall' }
  /** The stored version is this one, or newer (a downgrade): show nothing. */
  | { readonly kind: 'notNewer' }
  /** An upgrade; `from` is undefined when it came from a version before this feature. */
  | { readonly kind: 'upgrade'; readonly from: string | undefined }

export interface UpdateFacts {
  /** The version stored the last time What's New ran, as read (anything). */
  readonly previous: unknown
  readonly current: string
  /** Whether the extension was used before (its stored state, folders): an upgrade, not an install. */
  readonly hasEarlierUse: boolean
}

/** What this activation is: an install, an upgrade, or neither. */
export function decideUpdate(facts: UpdateFacts): UpdateDecision {
  if (!isVersion(facts.previous)) {
    return facts.hasEarlierUse ? { kind: 'upgrade', from: undefined } : { kind: 'firstInstall' }
  }
  return compareVersions(facts.current, facts.previous) > 0
    ? { kind: 'upgrade', from: facts.previous }
    : { kind: 'notNewer' }
}

/** A release as the selection needs it. */
export interface VersionedRelease {
  readonly version: string
  readonly highlights: readonly unknown[]
}

/**
 * The releases a page shows, newest first.
 *
 * - After an upgrade from a known version: every release after it, up to and
 *   including `through`.
 * - Otherwise (the palette command, or an upgrade from a version before this
 *   feature): from the newest release at or below `through` that has
 *   Highlights, up to `through`, so a patch release still shows the minor
 *   release it builds on; only `through` when none has Highlights.
 */
export function releasesToShow<T extends VersionedRelease>(
  releases: readonly T[],
  from: string | undefined,
  through: string,
): readonly T[] {
  const upTo = releases
    .filter((release) => compareVersions(release.version, through) <= 0)
    .toSorted((a, b) => compareVersions(b.version, a.version))
  if (from !== undefined) {
    return upTo.filter((release) => compareVersions(release.version, from) > 0)
  }
  const newestHighlighted = upTo.findIndex((release) => release.highlights.length > 0)
  return newestHighlighted === -1
    ? upTo.filter((release) => compareVersions(release.version, through) === 0)
    : upTo.slice(0, newestHighlighted + 1)
}

/**
 * Whether an update opens the page (M99, D79): when any release it brings
 * has Highlights. Otherwise (a patch of fixes only) a quiet notification
 * offers the page instead.
 */
export function hasHighlights(releases: readonly VersionedRelease[]): boolean {
  return releases.some((release) => release.highlights.length > 0)
}

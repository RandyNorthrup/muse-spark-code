// M125 lane H (D107 §8.1): update planning. Pure version arithmetic:
// whether the pin has moved past the installed runtime. Anything
// unparsable reads as no proven update, never a guessed one; the
// refetch itself runs the install path again (live-proof deferred
// with the archives).
export interface RuntimeUpdatePlan {
  readonly current: string | undefined
  readonly pinned: string
  readonly updateAvailable: boolean
}

function parseVersion(version: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  const [major, minor, patch] = [match?.[1], match?.[2], match?.[3]]
  return major === undefined || minor === undefined || patch === undefined
    ? undefined
    : [Number(major), Number(minor), Number(patch)]
}

/** Negative when the pin is older, zero when equal, positive when newer. */
export function compareVersions(pinned: string, current: string): number | undefined {
  const left = parseVersion(pinned)
  const right = parseVersion(current)
  if (left === undefined || right === undefined) return undefined
  for (const [index, part] of left.entries()) {
    const difference = part - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** Whether the installed runtime is behind the pin (or unknown). */
export function planRuntimeUpdate(
  currentVersion: string | undefined,
  pinnedVersion: string,
): RuntimeUpdatePlan {
  if (currentVersion === undefined) {
    return { current: undefined, pinned: pinnedVersion, updateAvailable: true }
  }
  const comparison = compareVersions(pinnedVersion, currentVersion)
  return {
    current: currentVersion,
    pinned: pinnedVersion,
    updateAvailable: comparison !== undefined && comparison > 0,
  }
}

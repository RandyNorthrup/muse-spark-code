// Next edit suggestions (M94b, PLAN.md D73): edits away from the cursor,
// in the words of VS Code's `inlineCompletionsAdditions` proposal
// (`isInlineEdit`/`showRange`). Built ready, switched on only when a
// stable `vscode.d.ts` carries them: TAB_NEXT_EDIT_STABLE_SINCE names the
// first stable release that does, and no stable release does yet. Pure:
// no `vscode` import, so the tests run it as real code.

import { TAB_NEXT_EDIT_STABLE_SINCE } from '../../shared/constants'

/** A 0-based position, as `vscode.Position` reads it. */
export interface NextEditPosition {
  readonly line: number
  readonly character: number
}

/** A range, as `vscode.Range` reads it. */
export interface NextEditRange {
  readonly start: NextEditPosition
  readonly end: NextEditPosition
}

/**
One away-from-cursor edit the engine proposes. `range` is the text it
replaces; `showRange` is the cursor range the host may show it for (the
proposal's `showRange`).
*/
export interface NextEditCandidate {
  readonly insertText: string
  readonly range: NextEditRange
  readonly showRange: NextEditRange
}

/**
The proposal-shaped item the provider hands the host: the stable
insert-text-and-range plus the proposal's `isInlineEdit` marker and
`showRange`.
*/
export interface NextEditItem {
  readonly insertText: string
  readonly range: NextEditRange
  readonly isInlineEdit: true
  readonly showRange: NextEditRange
}

/** A dotted version's numeric parts, or none when it is not a version. */
function versionParts(version: string): readonly number[] | undefined {
  const base = version.split('-', 1)[0] ?? ''
  if (base === '') {
    return undefined
  }
  const parts: number[] = []
  for (const piece of base.split('.')) {
    if (piece === '' || !/^\d+$/.test(piece)) {
      return undefined
    }
    parts.push(Number(piece))
  }
  return parts.length === 0 ? undefined : parts
}

/**
Whether `host` is at least `stableSince`, part by part. A pre-release of
the stable release itself (an insider build of it) does not count: it
predates the stable API.
*/
function isAtLeast(host: string, stableSince: string): boolean {
  const hostParts = versionParts(host)
  const stableParts = versionParts(stableSince)
  if (hostParts === undefined || stableParts === undefined) {
    return false
  }
  const width = Math.max(hostParts.length, stableParts.length)
  for (let index = 0; index < width; index += 1) {
    const hostPart = hostParts[index] ?? 0
    const stablePart = stableParts[index] ?? 0
    if (hostPart !== stablePart) {
      return hostPart > stablePart
    }
  }
  return !host.includes('-')
}

/**
Whether the running host's stable API carries next edit suggestions: its
version is at least the first stable release whose `vscode.d.ts` has
`isInlineEdit`/`showRange`. No stable release has them yet, so this is
false on every host until that release ships and names itself in
TAB_NEXT_EDIT_STABLE_SINCE. Anything unparseable fails closed.
*/
export function isNextEditStable(
  hostVersion: string,
  stableSince: string | undefined = TAB_NEXT_EDIT_STABLE_SINCE,
): boolean {
  return stableSince !== undefined && isAtLeast(hostVersion, stableSince)
}

/**
The candidates as proposal-shaped items, or none while the API is still a
proposal. The provider appends these after its at-cursor item; on every
host shipped today that appends nothing.
*/
export function toNextEditItems(
  candidates: readonly NextEditCandidate[],
  hostVersion: string,
  stableSince: string | undefined = TAB_NEXT_EDIT_STABLE_SINCE,
): NextEditItem[] {
  if (!isNextEditStable(hostVersion, stableSince)) {
    return []
  }
  return candidates.map((candidate) => ({
    insertText: candidate.insertText,
    range: candidate.range,
    isInlineEdit: true as const,
    showRange: candidate.showRange,
  }))
}

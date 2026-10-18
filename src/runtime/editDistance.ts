// Edit distance over short command-line names, for nearest-match
// suggestions. Pure and dependency-free, so the headless preflight can use
// it without carrying the help table.
export function optionDistance(first: string, second: string): number {
  const previous: number[] = Array.from({ length: second.length + 1 }, (_, index) => index)
  for (let i = 1; i <= first.length; i += 1) {
    let diagonal = i - 1
    previous[0] = i
    for (let j = 1; j <= second.length; j += 1) {
      const current = previous[j] ?? 0
      const cost = first[i - 1] === second[j - 1] ? 0 : 1
      const next = Math.min((previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + 1, diagonal + cost)
      diagonal = current
      previous[j] = next
    }
  }
  return previous[second.length] ?? 0
}

/** A typo closer than this earns a suggestion. */
const SUGGESTION_DISTANCE = 4

/** The closest valid name, when the typo is close. */
export function nearestOptionName(wanted: string, valid: readonly string[]): string | undefined {
  let nearest: string | undefined
  let distance = SUGGESTION_DISTANCE
  for (const candidate of valid) {
    const current = optionDistance(wanted, candidate)
    if (current >= distance) continue
    distance = current
    nearest = candidate
  }
  return nearest
}

// Breaking literal marker text inside fenced data (RLF-SECTEXT,
// research §6 H): the Auto reviewer and the same-model judge fence
// their data between fresh random markers per request, as web fetch
// does. Any occurrence of the marker inside the data is broken up
// first, so the data cannot close its own block. The break is a middle
// dot: visible to a reader, never part of the hex alphabet, and it
// keeps the data on one line.

/** What splits a literal marker occurrence inside fenced data. */
const MARKER_BREAK = '·'

/**
Every occurrence of `marker` in `data`, broken in the middle so it
cannot close the fence; an empty marker breaks nothing.
*/
export function breakMarkerOccurrences(data: string, marker: string): string {
  if (marker === '') {
    return data
  }
  const half = Math.floor(marker.length / 2)
  const broken = `${marker.slice(0, half)}${MARKER_BREAK}${marker.slice(half)}`
  // A replacer function: marker text reaching the output literally, never
  // as a `$` pattern.
  return data.replaceAll(marker, () => broken)
}

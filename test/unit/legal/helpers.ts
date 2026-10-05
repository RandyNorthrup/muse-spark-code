// Fixture snapshots for the legal scanner's unit tests (M97): an
// in-memory file map behind the `LegalFileSnapshot` interface, so every
// reader test runs offline with no file-system writes.

import type { LegalFileSnapshot } from '../../src/core/legal/files'

/** A snapshot over caller-owned text: sorted paths, exact reads. */
export function snapshotFrom(files: Record<string, string>): LegalFileSnapshot {
  const paths = Object.keys(files).toSorted()
  const table = new Map(Object.entries(files))
  return {
    files: paths,
    readFile: (path: string) => table.get(path),
  }
}

/** A snapshot that counts `readFile` calls, for bound and write proofs. */
export function countingSnapshot(files: Record<string, string>): {
  readonly snapshot: LegalFileSnapshot
  readonly reads: () => number
} {
  const inner = snapshotFrom(files)
  let count = 0
  return {
    snapshot: {
      files: inner.files,
      readFile: (path: string) => {
        count += 1
        return inner.readFile(path)
      },
    },
    reads: () => count,
  }
}

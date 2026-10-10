// Fixture snapshots for the legal scanner's unit tests (M97): an
// in-memory file map behind the `LegalFileSnapshot` interface, so every
// reader test runs offline with no file-system writes.

import type { LegalFileSnapshot } from '../../../src/core/legal/files'

/** A snapshot over caller-owned text: sorted paths, exact reads. */
export function snapshotFrom(files: Record<string, string>): LegalFileSnapshot {
  const paths = Object.keys(files).toSorted((a, b) => a.localeCompare(b, 'en'))
  const table = new Map(Object.entries(files))
  return {
    files: paths,
    readFile: (path: string) => table.get(path),
  }
}

/**
 * A verbatim MIT license text (C-M97-1): the canonical SPDX License List
 * 3.28.0 wording with a fictional holder, so the pinned full-text matcher
 * must recognize it exactly. Keep byte-identical to the canonical text
 * apart from the holder line: any wording drift breaks the exact-match
 * assertions on purpose.
 */
export const FULL_MIT_LICENSE = `MIT License

Copyright (c) 2026 Example Corp

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.
`

/** A snapshot that counts `readFile` calls, for bound and write proofs. */
export function countingSnapshot(files: Record<string, string>): {
  readonly snapshot: LegalFileSnapshot
  readonly reads: () => number
  readonly readPaths: () => readonly string[]
} {
  const inner = snapshotFrom(files)
  let count = 0
  const paths: string[] = []
  return {
    snapshot: {
      files: inner.files,
      readFile: (path: string) => {
        count += 1
        paths.push(path)
        return inner.readFile(path)
      },
    },
    reads: () => count,
    readPaths: () => paths,
  }
}

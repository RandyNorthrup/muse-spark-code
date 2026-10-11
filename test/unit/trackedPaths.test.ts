// Tracked paths on a file system without case (Windows, macOS). Two paths
// that differ only by letter case cannot both be checked out there, and two
// TypeScript sources that differ only by case and by their extension are one
// file to the type-aware lint: `playbookPanel.test.ts` beside
// `PlaybookPanel.test.tsx` failed `lint:js:unit` on both systems and passed on
// Linux (M116, docs/certification/m116.md). The whole repository is checked.
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const SOURCE_EXTENSION = /\.(?:[cm]?ts|tsx)$/u
const TRACKED_LIST_MAX_BYTES = 64 * 1024 * 1024

/** The groups of paths that `key` makes one path. */
function collisions(
  paths: readonly string[],
  key: (file: string) => string | undefined,
): string[][] {
  const groups = new Map<string, string[]>()
  for (const file of paths) {
    const name = key(file)
    if (name !== undefined) groups.set(name, [...(groups.get(name) ?? []), file])
  }
  const found: string[][] = []
  for (const group of groups.values()) if (group.length > 1) found.push(group)
  return found
}

/** A path as a file system without case names it. */
function caseKey(file: string): string {
  return file.toLowerCase()
}

/** A TypeScript source as the type-aware lint names it there: no case, no extension. */
function sourceKey(file: string): string | undefined {
  return SOURCE_EXTENSION.test(file) ? file.replace(SOURCE_EXTENSION, '').toLowerCase() : undefined
}

describe('tracked paths on a file system without case', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: TRACKED_LIST_MAX_BYTES,
  })
    .split('\0')
    .filter((file) => file !== '')

  it('finds a pair when there is one', () => {
    const sample = [
      'test/unit/PlaybookPanel.test.tsx',
      'test/unit/playbookPanel.test.ts',
      'docs/Notes.md',
      'docs/notes.md',
      'src/alone.ts',
    ]
    expect(collisions(sample, caseKey)).toEqual([['docs/Notes.md', 'docs/notes.md']])
    expect(collisions(sample, sourceKey)).toEqual([
      ['test/unit/PlaybookPanel.test.tsx', 'test/unit/playbookPanel.test.ts'],
    ])
  })

  it('has no two paths that differ only by letter case', () => {
    // The list is the repository's, not an empty answer.
    expect(tracked).toContain('package.json')
    expect(collisions(tracked, caseKey)).toEqual([])
  })

  it('has no two TypeScript sources that differ only by case and extension', () => {
    expect(collisions(tracked, sourceKey)).toEqual([])
  })
})

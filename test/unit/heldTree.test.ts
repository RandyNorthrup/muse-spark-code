import { describe, expect, it } from 'vitest'
import { foldName, heldTree } from '../../src/core/git/heldTree'
import {
  HELD_CHECKOUT_MAX_BYTES,
  HELD_CHECKOUT_MAX_ENTRIES,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill, formatBytes } from '../../src/shared/l10n/text'

const BLOB = 'ce013625030ba8dba906f756967f9e9ca394464a'
const COMMIT = '1111111111111111111111111111111111111111'

/** One record of `git ls-tree -r -z --full-tree --long`, as git pads it. */
function record(mode: string, entryPath: string, size = 6): string {
  return mode === '160000'
    ? `${mode} commit ${COMMIT}       -\t${entryPath}\0`
    : `${mode} blob ${BLOB} ${String(size).padStart(7)}\t${entryPath}\0`
}

function files(...paths: readonly string[]): string {
  return paths.map((entryPath) => record('100644', entryPath)).join('')
}

function unsafe(entryPath: string): string {
  return fill(UI_TEXT.openPullRequestUnsafePath, { path: JSON.stringify(entryPath) })
}

describe('heldTree (M71): what a held pull request writes', () => {
  it('reads each kind with its size, in the listing’s order', () => {
    const listing = [
      record('100644', 'a.txt'),
      record('100755', 'bin/run.sh', 10),
      record('120000', 'link', 9),
      record('160000', 'vendor/sub'),
      // A tab or a newline is part of a POSIX name; -z keeps it unquoted.
      record('100644', 'odd\tname\n'),
    ].join('')
    expect(heldTree(listing, 'linux')).toEqual({
      ok: true,
      entries: [
        { path: 'a.txt', kind: 'file', oid: BLOB, size: 6 },
        { path: 'bin/run.sh', kind: 'executable', oid: BLOB, size: 10 },
        { path: 'link', kind: 'link', oid: BLOB, size: 9 },
        { path: 'vendor/sub', kind: 'submodule', oid: COMMIT, size: 0 },
        { path: 'odd\tname\n', kind: 'file', oid: BLOB, size: 6 },
      ],
    })
    expect(heldTree('', 'win32')).toEqual({ ok: true, entries: [] })
  })

  it.each([
    `040000 tree ${BLOB}       -\tdir\0`,
    `100664 blob ${BLOB}       6\tlegacy\0`,
    `160000 blob ${BLOB}       6\tnot-a-commit\0`,
    `100644 blob ${BLOB}       -\tno-size\0`,
  ])('refuses a record it does not write (%j)', (listing) => {
    const result = heldTree(listing, 'linux')
    expect(result).toEqual({
      ok: false,
      reason: unsafe(listing.slice(listing.indexOf('\t') + 1, -1)),
    })
  })

  it.each([
    '.git',
    '.git/config',
    'a/.GIT/hooks/post-checkout',
    '.Git',
    '.git.',
    '.git ',
    '.git. .',
    'git~1/config',
    'GIT~1',
    // HFS+ ignores these characters, so the name is `.git` there.
    '.g\u{200C}it/config',
    '\u{FEFF}.git',
    '..',
    '../outside',
    'a/../../outside',
    './a',
    'a/./b',
    '/absolute',
    'a//b',
    'a/',
    String.raw`a\..\..\outside`,
    'not-utf8-\u{FFFD}',
  ])('refuses %j on every platform', (entryPath) => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      expect(heldTree(files(entryPath), platform)).toEqual({ ok: false, reason: unsafe(entryPath) })
    }
  })

  it.each([
    'C:',
    'a:stream',
    'con',
    'NUL.txt',
    'aux .md',
    'COM1',
    'lpt9.log',
    'COM¹',
    'conin$',
    'a<b',
    'a>b',
    'quote"d',
    'pipe|d',
    'what?',
    'star*',
    'trailing.',
    'trailing ',
    'dir./file',
    'bell\u{7}',
    'tab\tname',
  ])('refuses %j on Windows only', (entryPath) => {
    expect(heldTree(files(entryPath), 'win32')).toEqual({ ok: false, reason: unsafe(entryPath) })
    expect(heldTree(files(entryPath), 'linux').ok).toBe(true)
  })

  it.each([
    [['A.txt', 'a.txt'], 'A.txt', 'a.txt'],
    [['Docs/a.md', 'docs/b.md'], 'Docs', 'docs'],
    [['\u{E9}.txt', 'e\u{301}.txt'], '\u{E9}.txt', 'e\u{301}.txt'],
  ])(
    'refuses two spellings of one name where letter case or composition does not count (%j)',
    (paths, first, second) => {
      const reason = fill(UI_TEXT.openPullRequestPathCollision, {
        first: JSON.stringify(first),
        second: JSON.stringify(second),
      })
      for (const platform of ['win32', 'darwin'] as const) {
        expect(heldTree(files(...paths), platform)).toEqual({ ok: false, reason })
      }
      expect(heldTree(files(...paths), 'linux').ok).toBe(true)
    },
  )

  it.each([
    [[record('100644', 'a'), record('100644', 'a/b')], 'a', 'a'],
    [[record('100644', 'a/b'), record('100644', 'a')], 'a', 'a'],
    [[record('100644', 'x'), record('100755', 'x')], 'x', 'x'],
    [[record('160000', 'sub'), record('100644', 'sub/file')], 'sub', 'sub'],
  ])(
    'refuses a file where a folder is, or one path twice, everywhere (%j)',
    (records, first, second) => {
      const reason = fill(UI_TEXT.openPullRequestPathCollision, {
        first: JSON.stringify(first),
        second: JSON.stringify(second),
      })
      for (const platform of ['linux', 'darwin', 'win32'] as const) {
        expect(heldTree(records.join(''), platform)).toEqual({ ok: false, reason })
      }
    },
  )

  it('writes up to its limits and refuses one entry or one byte more', () => {
    const tooLarge = {
      ok: false,
      reason: fill(UI_TEXT.openPullRequestTooLarge, {
        files: HELD_CHECKOUT_MAX_ENTRIES,
        size: formatBytes(HELD_CHECKOUT_MAX_BYTES),
      }),
    }
    const names = Array.from(
      { length: HELD_CHECKOUT_MAX_ENTRIES + 1 },
      (_, index) => `f${String(index)}`,
    )
    const most = heldTree(files(...names.slice(0, -1)), 'linux')
    expect(most.ok ? most.entries.length : 0).toBe(HELD_CHECKOUT_MAX_ENTRIES)
    expect(heldTree(files(...names), 'linux')).toEqual(tooLarge)
    const half = Math.floor(HELD_CHECKOUT_MAX_BYTES / 2)
    expect(heldTree(record('100644', 'a', half) + record('100644', 'b', half), 'linux').ok).toBe(
      true,
    )
    expect(
      heldTree(
        record('100644', 'a', half) + record('100644', 'b', HELD_CHECKOUT_MAX_BYTES - half + 1),
        'linux',
      ),
    ).toEqual(tooLarge)
  })

  it('folds names as the platform’s usual file systems compare them', () => {
    expect(foldName('Docs/E\u{301}', 'win32')).toBe('docs/\u{E9}')
    expect(foldName('Docs/E\u{301}', 'darwin')).toBe('docs/\u{E9}')
    expect(foldName('Docs/E\u{301}', 'linux')).toBe('Docs/E\u{301}')
  })
})

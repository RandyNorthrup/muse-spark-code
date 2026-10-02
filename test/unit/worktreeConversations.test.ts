import { describe, expect, it } from 'vitest'
import { isWithinFolder } from '../../src/core/paths'
import {
  heldWorktreeFolder,
  heldWorktreesRoot,
  holdFor,
  parseWorktreeRegistry,
  recordFor,
  withRecord,
  type WorktreeRecord,
} from '../../src/core/worktreeConversations'

const STORAGE = String.raw`C:\Users\me\AppData\Roaming\Code\User\globalStorage\ext`
const HELD_ROOT = heldWorktreesRoot(STORAGE, 'win32')
const FOLDER = heldWorktreeFolder(
  STORAGE,
  { owner: 'RandyNorthrup', name: 'muse-spark-code' },
  51,
  'win32',
)

const PULL_REQUEST = {
  repository: 'RandyNorthrup/muse-spark-code',
  number: 51,
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
  title: 'test: lock Android/Termux P0 behavior',
  author: 'Piangpi1997',
  headSha: '29fe2d8a111e5424c69c3ad0e7328b53a98646af',
  isAuthoredByUser: false,
}

function record(fields: Partial<WorktreeRecord>): WorktreeRecord {
  return {
    folder: FOLDER,
    repositoryRoot: String.raw`C:\repos\muse`,
    createdAt: 1,
    pullRequest: PULL_REQUEST,
    isHeld: true,
    ...fields,
  }
}

describe('the pull request worktree folders (M71)', () => {
  it('lives under the extension storage, one short folder per pull request and repository', () => {
    expect(HELD_ROOT).toBe(String.raw`${STORAGE}\pr-worktrees`)
    expect(FOLDER).toMatch(/\\pr-worktrees\\51-[\da-f]{8}$/)
    const other = heldWorktreeFolder(STORAGE, { owner: 'someone', name: 'else' }, 51, 'win32')
    expect(other).not.toBe(FOLDER)
    // The same repository in another case is the same folder.
    expect(
      heldWorktreeFolder(STORAGE, { owner: 'randynorthrup', name: 'Muse-Spark-Code' }, 51, 'win32'),
    ).toBe(FOLDER)
  })
})

describe('holdFor (M71): held by location, let go only by a confirmed record', () => {
  it('holds a window on a pull request worktree, naming the pull request', () => {
    expect(holdFor([FOLDER], [HELD_ROOT], [record({})], 'win32')).toEqual({
      folder: FOLDER,
      pullRequest: PULL_REQUEST,
    })
  })

  it('holds with no record at all, and on a folder under the worktree or the root itself', () => {
    expect(holdFor([FOLDER], [HELD_ROOT], [], 'win32')).toEqual({
      folder: FOLDER,
      pullRequest: undefined,
    })
    expect(holdFor([String.raw`${FOLDER}\src`], [HELD_ROOT], [record({})], 'win32')?.folder).toBe(
      FOLDER,
    )
    expect(holdFor([HELD_ROOT], [HELD_ROOT], [record({})], 'win32')).toBeDefined()
  })

  it('holds whatever the spelling: case, separators, or only the resolved form matching', () => {
    const lower = FOLDER.toLowerCase().replaceAll('\\', '/')
    expect(holdFor([lower], [HELD_ROOT], [], 'win32')).toBeDefined()
    expect(
      holdFor(
        [String.raw`C:\link\51-x`, String.raw`D:\real\pr-worktrees\51-x`],
        [HELD_ROOT, String.raw`D:\real\pr-worktrees`],
        [],
        'win32',
      ),
    ).toBeDefined()
  })

  it('lets go once the user confirmed trust for that worktree', () => {
    expect(
      holdFor([FOLDER], [HELD_ROOT], [record({ isHeld: false, trustConfirmedAt: 5 })], 'win32'),
    ).toBeUndefined()
  })

  it('no other record lets it go: not held by its author, nor a branch made inside', () => {
    expect(holdFor([FOLDER], [HELD_ROOT], [record({ isHeld: false })], 'win32')).toBeDefined()
    const branch = String.raw`${FOLDER}.worktrees\fix`
    expect(
      holdFor(
        [branch],
        [HELD_ROOT],
        [record({ folder: branch, pullRequest: undefined, isHeld: false })],
        'win32',
      ),
    ).toBeDefined()
  })

  it('a confirmed record for another worktree does not let this one go', () => {
    const other = String.raw`${HELD_ROOT}\56-00000000`
    expect(
      holdFor(
        [FOLDER],
        [HELD_ROOT],
        [record({ folder: other, isHeld: false, trustConfirmedAt: 5 })],
        'win32',
      ),
    ).toBeDefined()
  })

  it.each([false, true])(
    'keeps each root held independently of trusted-root order (%s)',
    (reverse) => {
      const other = String.raw`${HELD_ROOT}\56-00000000`
      const trusted = record({ folder: other, isHeld: false, trustConfirmedAt: 5 })
      const held = record({})
      const roots = reverse ? [other, FOLDER] : [FOLDER, other]
      for (const records of [
        [trusted, held],
        [held, trusted],
      ]) {
        expect(holdFor(roots, [HELD_ROOT], records, 'win32')).toEqual({
          folder: FOLDER,
          pullRequest: PULL_REQUEST,
        })
        expect(holdFor([FOLDER], [HELD_ROOT], records, 'win32')?.folder).toBe(FOLDER)
        expect(holdFor([other], [HELD_ROOT], records, 'win32')).toBeUndefined()
      }
    },
  )

  it('never holds a window outside the held root, whatever a record says', () => {
    expect(
      holdFor(
        [String.raw`C:\repos\muse.worktrees\feature`],
        [HELD_ROOT],
        [record({ folder: String.raw`C:\repos\muse.worktrees\feature` })],
        'win32',
      ),
    ).toBeUndefined()
    expect(
      holdFor([String.raw`${STORAGE}\pr-worktrees-other\x`], [HELD_ROOT], [], 'win32'),
    ).toBeUndefined()
  })

  it('works on POSIX paths, case-sensitively', () => {
    const root = '/home/me/.config/Code/User/globalStorage/ext/pr-worktrees'
    expect(holdFor([`${root}/51-abc`], [root], [], 'linux')).toBeDefined()
    expect(holdFor([`${root.toUpperCase()}/51-abc`], [root], [], 'linux')).toBeUndefined()
  })
})

describe('the registry (M71)', () => {
  it('reads a stored list, and anything else as none', () => {
    const stored = [record({})]
    expect(parseWorktreeRegistry(stored)).toEqual(stored)
    expect(parseWorktreeRegistry(undefined)).toEqual([])
    expect(parseWorktreeRegistry([{ folder: 1 }])).toEqual([])
    expect(parseWorktreeRegistry('x')).toEqual([])
  })

  it('keeps one record per folder, whatever its spelling', () => {
    const first = record({})
    const replaced = withRecord(
      [first],
      record({ folder: FOLDER.toUpperCase(), isHeld: false }),
      'win32',
    )
    expect(replaced).toHaveLength(1)
    expect(recordFor(replaced, FOLDER, 'win32')?.isHeld).toBe(false)
  })
})

describe('isWithinFolder', () => {
  it('treats `..` only as a whole segment', () => {
    expect(isWithinFolder('/a/..cache/x', '/a', 'linux')).toBe(true)
    expect(isWithinFolder('/a/../b', '/a', 'linux')).toBe(false)
    expect(isWithinFolder('/ab', '/a', 'linux')).toBe(false)
    expect(isWithinFolder(String.raw`D:\a`, String.raw`C:\a`, 'win32')).toBe(false)
  })
})

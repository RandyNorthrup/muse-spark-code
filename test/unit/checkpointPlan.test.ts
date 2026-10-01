import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  gitBlobOid,
  parseBatchCheck,
  parseCatFileBatch,
  parseDiffTree,
  parseStatusListing,
  splitNul,
} from '../../src/core/checkpoints/gitListings'
import {
  type IgnoredChange,
  isCovered,
  planRestore,
  type RestoreInput,
  type RestorePlan,
} from '../../src/core/checkpoints/restorePlan'

const blob = (oid: string) => ({ mode: '100644', oid })
const stat = (size: number, mtimeMs = 1) => ({ size, mtimeMs })
const none = { skipped: [], repositories: [] }

function input(overrides: Partial<RestoreInput> = {}): RestoreInput {
  return {
    changes: [],
    changedOutsideTurns: new Set(),
    uncertain: new Set(),
    ignoredTurns: [],
    coverage: { checkpoint: none, current: none },
    currentStat: new Map(),
    isUnsaved: () => false,
    ...overrides,
  }
}

describe('git listings (M72)', () => {
  it('reads a status listing: files, repositories of their own, ignored files and folders', () => {
    const listing = parseStatusListing(
      '?? a.txt\0?? nested/\0!! .env\0!! node_modules/\0?? dir/b c.txt\0 M tracked.txt\0',
    )
    expect(listing).toEqual({
      files: ['a.txt', 'dir/b c.txt'],
      repositories: ['nested'],
      ignoredFiles: ['.env'],
      ignoredFolders: ['node_modules'],
    })
  })

  it('reads diff-tree output with additions, deletions and changes', () => {
    const changes = parseDiffTree(
      [
        ':000000 100644 0000 aaaa A',
        'new.txt',
        ':100644 000000 bbbb 0000 D',
        'gone.txt',
        ':100644 100755 cccc dddd M',
        'dir/run.sh',
        '',
      ].join('\0'),
    )
    expect(changes).toEqual([
      { path: 'new.txt', before: undefined, after: { mode: '100644', oid: 'aaaa' } },
      { path: 'gone.txt', before: { mode: '100644', oid: 'bbbb' }, after: undefined },
      {
        path: 'dir/run.sh',
        before: { mode: '100644', oid: 'cccc' },
        after: { mode: '100755', oid: 'dddd' },
      },
    ])
  })

  it('reads cat-file --batch output, binary bytes and a missing object included', () => {
    const output = Buffer.concat([
      Buffer.from('aaaa blob 3\n'),
      Buffer.from([0, 10, 255]),
      Buffer.from('\nbbbb missing\n'),
    ])
    const objects = parseCatFileBatch(output)
    expect([...(objects.get('aaaa') ?? [])]).toEqual([0, 10, 255])
    expect(objects.has('bbbb')).toBe(true)
    expect(objects.get('bbbb')).toBeUndefined()
  })

  it('refuses a cat-file answer that claims more bytes than it has', () => {
    expect(() => parseCatFileBatch(Buffer.from('aaaa blob 99\nshort\n'))).toThrow(/malformed/)
  })

  it('names bytes as git names a blob, and reads a batch-check answer', () => {
    // `git hash-object` of the empty blob and of "hello\n".
    expect(gitBlobOid(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(gitBlobOid(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(parseBatchCheck('aaaa blob 12\nbbbb missing\n')).toEqual(new Map([['aaaa', 12]]))
  })

  it('splits NUL-separated fields and drops the empty tail', () => {
    expect(splitNul('a\0b\0')).toEqual(['a', 'b'])
    expect(splitNul('')).toEqual([])
  })
})

describe('planRestore (M72)', () => {
  it.each([
    [
      'an ignored file the turn made visible to git is put back from the kept bytes, not deleted',
      'changed',
      blob('pre'),
    ],
    ['a file the turn created is still deleted', 'created', undefined],
  ] as const)('%s', (_name, kind, preImage) => {
    const plan = planRestore(
      input({
        changes: [{ path: 'cache.txt', before: undefined, after: blob('edited') }],
        ignoredTurns: [
          [{ path: 'cache.txt', kind, preImage, startStat: stat(3), endStat: stat(7) }],
        ],
        currentStat: new Map([['cache.txt', stat(7)]]),
      }),
    )
    expect(plan.refused).toEqual([])
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject(
      kind === 'changed'
        ? { path: 'cache.txt', target: blob('pre'), isIgnoreChecked: false }
        : { path: 'cache.txt', target: null, isIgnoreChecked: true },
    )
  })

  it('refuses, never deletes, a file a shell command changed before the turn made it visible to git', () => {
    const plan = planRestore(
      input({
        changes: [{ path: 'cache.txt', before: undefined, after: blob('edited') }],
        // A shell command changed it: the journal knows it existed, but kept no bytes.
        ignoredTurns: [
          [{ path: 'cache.txt', kind: 'changed', startStat: stat(3), endStat: stat(7) }],
        ],
        currentStat: new Map([['cache.txt', stat(7)]]),
      }),
    )
    expect(plan.steps).toEqual([])
    expect(plan.refused).toEqual([{ path: 'cache.txt', reason: 'noEarlierCopy' }])
  })

  it('writes changed and deleted files back and deletes the added ones', () => {
    const plan = planRestore(
      input({
        changes: [
          { path: 'changed.ts', before: blob('b1'), after: blob('a1') },
          { path: 'deleted.ts', before: blob('b2'), after: undefined },
          { path: 'added.ts', before: undefined, after: blob('a3') },
        ],
      }),
    )
    expect(plan).toEqual({
      steps: [
        {
          path: 'changed.ts',
          target: blob('b1'),
          expect: { kind: 'blob', oid: 'a1' },
          isIgnoreChecked: false,
        },
        {
          path: 'deleted.ts',
          target: blob('b2'),
          expect: { kind: 'absent' },
          isIgnoreChecked: false,
        },
        {
          path: 'added.ts',
          target: null,
          expect: { kind: 'blob', oid: 'a3' },
          isIgnoreChecked: true,
        },
      ],
      refused: [],
      unsure: [],
    })
  })

  it('names the restored paths a turn with no recorded end may not have changed itself', () => {
    const plan = planRestore(
      input({
        changes: [
          { path: 'a.ts', before: blob('b1'), after: blob('a1') },
          { path: 'b.ts', before: blob('b2'), after: blob('a2') },
        ],
        uncertain: new Set(['b.ts', 'c.ts']),
      }),
    )
    expect(plan.unsure).toEqual(['b.ts'])
  })

  it('refuses a file changed outside the turns, one with unsaved changes, and one left out', () => {
    const plan = planRestore(
      input({
        changes: [
          { path: 'user.ts', before: blob('b1'), after: blob('a1') },
          { path: 'open.ts', before: blob('b2'), after: blob('a2') },
          { path: 'vendor/x.c', before: blob('b3'), after: blob('a3') },
          { path: 'big.bin', before: undefined, after: blob('a4') },
        ],
        changedOutsideTurns: new Set(['user.ts']),
        isUnsaved: (path) => path === 'open.ts',
        coverage: {
          checkpoint: { skipped: [], repositories: ['vendor'] },
          current: { skipped: ['big.bin'], repositories: ['vendor'] },
        },
      }),
    )
    expect(plan.steps).toEqual([])
    expect(plan.refused).toEqual([
      { path: 'user.ts', reason: 'changedAfter' },
      { path: 'open.ts', reason: 'unsaved' },
      { path: 'vendor/x.c', reason: 'notInCheckpoint' },
      { path: 'big.bin', reason: 'notInCheckpoint' },
    ])
  })

  it('names a file that came into or went out of the captures', () => {
    const plan = planRestore(
      input({
        coverage: {
          checkpoint: { skipped: ['was-small.bin'], repositories: [] },
          current: { skipped: ['grew.bin'], repositories: ['cloned'] },
        },
      }),
    )
    expect(plan.refused).toEqual([
      { path: 'cloned', reason: 'notInCheckpoint' },
      { path: 'grew.bin', reason: 'notInCheckpoint' },
      { path: 'was-small.bin', reason: 'notInCheckpoint' },
    ])
  })

  it('deletes an ignored file a turn created, restores one copied first, lists one without a copy', () => {
    const turn: readonly IgnoredChange[] = [
      { path: 'dist/new.js', kind: 'created', startStat: null, endStat: stat(5) },
      {
        path: '.env',
        kind: 'changed',
        preImage: blob('env0'),
        startStat: stat(3),
        endStat: stat(4),
      },
      { path: 'app.log', kind: 'changed', startStat: stat(7), endStat: stat(9) },
      { path: 'cache.db', kind: 'deleted', startStat: stat(2), endStat: null },
    ]
    const plan = planRestore(
      input({
        ignoredTurns: [turn],
        currentStat: new Map([
          ['dist/new.js', stat(5)],
          ['.env', stat(4)],
          ['app.log', stat(9)],
          ['cache.db', null],
        ]),
      }),
    )
    expect(plan).toEqual({
      steps: [
        {
          path: 'dist/new.js',
          target: null,
          expect: { kind: 'stat', stat: stat(5) },
          isIgnoreChecked: false,
        },
        {
          path: '.env',
          target: blob('env0'),
          expect: { kind: 'stat', stat: stat(4) },
          isIgnoreChecked: false,
        },
      ],
      refused: [
        { path: 'app.log', reason: 'noEarlierCopy' },
        { path: 'cache.db', reason: 'noEarlierCopy' },
      ],
      unsure: [],
    } satisfies RestorePlan)
  })

  it('refuses an ignored file another conversation changed meanwhile', () => {
    const plan = planRestore(
      input({
        ignoredTurns: [[{ path: 'out.js', kind: 'created', startStat: null, endStat: stat(5) }]],
        currentStat: new Map([['out.js', stat(5)]]),
        changedOutsideTurns: new Set(['out.js']),
      }),
    )
    expect(plan.steps).toEqual([])
    expect(plan.refused).toEqual([{ path: 'out.js', reason: 'changedAfter' }])
  })

  it('refuses an ignored file changed after the last turn, or between two turns that changed it', () => {
    const first: readonly IgnoredChange[] = [
      { path: '.env', kind: 'changed', preImage: blob('e0'), startStat: stat(1), endStat: stat(2) },
      { path: 'x.log', kind: 'created', startStat: null, endStat: stat(5) },
    ]
    const second: readonly IgnoredChange[] = [
      // Its start is not the first turn's end: someone else wrote it between.
      { path: '.env', kind: 'changed', preImage: blob('e1'), startStat: stat(9), endStat: stat(3) },
    ]
    const plan = planRestore(
      input({
        ignoredTurns: [first, second],
        currentStat: new Map([
          ['.env', stat(3)],
          ['x.log', stat(6)],
        ]),
      }),
    )
    expect(plan.refused).toEqual([
      { path: '.env', reason: 'changedAfter' },
      { path: 'x.log', reason: 'changedAfter' },
    ])
  })

  it('takes the first turn’s copy when consecutive turns changed an ignored file', () => {
    const plan = planRestore(
      input({
        ignoredTurns: [
          [
            {
              path: 'a.log',
              kind: 'changed',
              preImage: blob('a0'),
              startStat: stat(1),
              endStat: stat(2),
            },
          ],
          [
            {
              path: 'a.log',
              kind: 'changed',
              preImage: blob('a1'),
              startStat: stat(2),
              endStat: stat(3),
            },
          ],
        ],
        currentStat: new Map([['a.log', stat(3)]]),
      }),
    )
    expect(plan.steps).toEqual([
      {
        path: 'a.log',
        target: blob('a0'),
        expect: { kind: 'stat', stat: stat(3) },
        isIgnoreChecked: false,
      },
    ])
  })

  it('leaves an ignored file alone when the work-tree change already covers it', () => {
    const plan = planRestore(
      input({
        changes: [{ path: 'now-ignored.txt', before: blob('b'), after: undefined }],
        ignoredTurns: [
          [{ path: 'now-ignored.txt', kind: 'changed', startStat: stat(1), endStat: stat(2) }],
        ],
        currentStat: new Map([['now-ignored.txt', stat(2)]]),
      }),
    )
    expect(plan.steps.map((step) => [step.path, step.target])).toEqual([
      ['now-ignored.txt', blob('b')],
    ])
    expect(plan.refused).toEqual([])
  })

  it('says whether a capture holds a path, a linked folder covering everything below it', () => {
    const coverage = { skipped: ['big.bin', 'linked'], repositories: ['vendor'] }
    expect(isCovered(coverage, 'src/a.ts')).toBe(true)
    expect(isCovered(coverage, 'big.bin')).toBe(false)
    expect(isCovered(coverage, 'vendor/lib.c')).toBe(false)
    expect(isCovered(coverage, 'linked/deep/x.txt')).toBe(false)
    expect(isCovered(coverage, 'vendor-other/lib.c')).toBe(true)
  })
})

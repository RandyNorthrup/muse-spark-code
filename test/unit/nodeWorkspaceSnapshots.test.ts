// M110b W2: snapshots parse porcelain (tricky names round-trip), keep
// archives inside the tree, build tar/btrfs/zfs argv, and detect the
// volume behind the workspace. Porcelain over the recorded exchange
// (test/fixtures/workspaces/porcelain-tricky.txt, captured 2026-10-22
// from `git status --porcelain -uall` in a scratch repo holding plain,
// spaced, quoted, unicode, backslashed and newline names).
import { readFileSync, statfsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  btrfsDeleteArgv,
  btrfsIsSubvolumeArgv,
  btrfsRestoreArgv,
  btrfsSnapshotArgv,
  detectVolumeFs,
  isSafeArchiveMember,
  parseUntracked,
  tarCreateArgv,
  tarExtractArgv,
  tarListArgv,
  type SnapshotVolumeFs,
  unquotePorcelainPath,
  zfsDatasetAt,
  zfsListArgv,
  zfsRollbackArgv,
  zfsSnapshotArgv,
} from '../../src/runtime/node/workspaces/snapshots'

const PORCELAIN = readFileSync(
  path.join(__dirname, '..', 'fixtures', 'workspaces', 'porcelain-tricky.txt'),
  'utf8',
)

function compareStrings(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

describe('workspace snapshots', () => {
  it('parses the recorded porcelain: every tricky name round-trips', () => {
    expect(parseUntracked(PORCELAIN).toSorted(compareStrings)).toEqual(
      [String.raw`back\slash`, 'new\nline', 'plain', 'quo"te', 'sp ace', 'uni—code'].toSorted(
        compareStrings,
      ),
    )
  })
  it('unquotes C escapes as bytes, and leaves the plain alone', () => {
    expect(unquotePorcelainPath('plain')).toBe('plain')
    expect(unquotePorcelainPath('"sp ace"')).toBe('sp ace')
    expect(unquotePorcelainPath(String.raw`"a\tb"`)).toBe('a\tb')
    expect(unquotePorcelainPath(String.raw`"a\303\244"`)).toBe('aä')
  })
  it('keeps archives inside the tree: absolute and escaping members refuse', () => {
    expect(isSafeArchiveMember('src/a.ts')).toBe(true)
    expect(isSafeArchiveMember('./src/a.ts')).toBe(true)
    expect(isSafeArchiveMember('a/../b')).toBe(true)
    expect(isSafeArchiveMember('/etc/passwd')).toBe(false)
    expect(isSafeArchiveMember('../escape')).toBe(false)
    expect(isSafeArchiveMember('a/../../escape')).toBe(false)
    expect(isSafeArchiveMember(String.raw`..\win`)).toBe(false)
    expect(isSafeArchiveMember('')).toBe(false)
  })
  it('builds tar, btrfs and zfs argv', () => {
    expect(tarCreateArgv('/snap/u.tar.gz', '/ws', '/tmp/list')).toEqual([
      '-czf',
      '/snap/u.tar.gz',
      '-C',
      '/ws',
      '--null',
      '-T',
      '/tmp/list',
    ])
    expect(tarExtractArgv('/snap/u.tar.gz', '/ws')).toEqual(['-xzf', '/snap/u.tar.gz', '-C', '/ws'])
    expect(tarListArgv('/snap/u.tar.gz')).toEqual(['-tzf', '/snap/u.tar.gz'])
    expect(btrfsIsSubvolumeArgv('/ws')).toEqual(['subvolume', 'show', '/ws'])
    expect(btrfsSnapshotArgv('/ws', '/snap/sub')).toEqual([
      'subvolume',
      'snapshot',
      '-r',
      '/ws',
      '/snap/sub',
    ])
    expect(btrfsDeleteArgv('/ws')).toEqual(['subvolume', 'delete', '/ws'])
    expect(btrfsRestoreArgv('/snap/sub', '/ws')).toEqual([
      'subvolume',
      'snapshot',
      '/snap/sub',
      '/ws',
    ])
    expect(zfsListArgv()).toEqual(['list', '-H', '-o', 'name,mountpoint'])
    expect(zfsSnapshotArgv('tank/ws', 'muse-1')).toEqual(['snapshot', 'tank/ws@muse-1'])
    expect(zfsRollbackArgv('tank/ws', 'muse-1')).toEqual(['rollback', 'tank/ws@muse-1'])
    expect(zfsDatasetAt('tank/ws\t/ws\ntank/other\t/other\n', '/ws')).toBe('tank/ws')
    expect(zfsDatasetAt('tank/ws\t/ws\n', '/nowhere')).toBeUndefined()
  })
  it('detects the volume behind real paths, and fails closed', () => {
    const magic = statfsSync('/').type
    let expected: SnapshotVolumeFs = 'other'
    if (magic === 0x91_23_68_3e) {
      expected = 'btrfs'
    } else if (magic === 0x2f_c1_2f_c1) {
      expected = 'zfs'
    }
    expect(detectVolumeFs('/')).toBe(expected)
    expect(detectVolumeFs('/definitely/not/a/path anywhere')).toBe('other')
  })
})

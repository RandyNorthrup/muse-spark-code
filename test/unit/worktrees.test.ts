import { describe, expect, it } from 'vitest'
import {
  branchCheckArgs,
  branchExistsArgs,
  isDirtyWorktreeError,
  isSameFolder,
  parseWorktreeList,
  worktreeAddArgs,
  worktreeFolder,
  worktreeRemoveArgs,
} from '../../src/core/worktrees'

// `git worktree list --porcelain` (git 2.4x), every attribute it prints.
const PORCELAIN = [
  'worktree /repo/app',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /repo/app.worktrees/feature-login',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature/login',
  'locked moved to a USB drive',
  '',
  'worktree /repo/app.worktrees/probe',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  'prunable gitdir file points to non-existent location',
  '',
  'worktree /repo/bare.git',
  'bare',
  '',
].join('\n')

describe('parseWorktreeList', () => {
  it('reads every worktree and its attributes, the main one first', () => {
    expect(parseWorktreeList(PORCELAIN)).toEqual([
      {
        path: '/repo/app',
        branch: 'main',
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
      },
      {
        path: '/repo/app.worktrees/feature-login',
        branch: 'feature/login',
        isBare: false,
        isDetached: false,
        isLocked: true,
        isPrunable: false,
      },
      {
        path: '/repo/app.worktrees/probe',
        branch: undefined,
        isBare: false,
        isDetached: true,
        isLocked: false,
        isPrunable: true,
      },
      {
        path: '/repo/bare.git',
        branch: undefined,
        isBare: true,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
      },
    ])
  })

  it('reads Windows line endings and ignores a block with no worktree line', () => {
    expect(
      parseWorktreeList('worktree C:/r\r\nbranch refs/heads/x\r\n\r\nHEAD 1\r\n').map((entry) => [
        entry.path,
        entry.branch,
      ]),
    ).toEqual([['C:/r', 'x']])
    expect(parseWorktreeList('')).toEqual([])
  })
})

describe('worktreeFolder', () => {
  it('goes beside the repository, the branch’s slashes folded', () => {
    expect(worktreeFolder('/src/app', 'feature/login', 'linux')).toBe(
      '/src/app.worktrees/feature-login',
    )
    expect(worktreeFolder(String.raw`D:\src\app`, 'fix', 'win32')).toBe(
      String.raw`D:\src\app.worktrees\fix`,
    )
  })
})

describe('isSameFolder', () => {
  it('compares resolved paths, ignoring case on Windows only', () => {
    expect(isSameFolder('D:/Src/App/', String.raw`d:\src\app`, 'win32')).toBe(true)
    expect(isSameFolder('/src/App', '/src/app', 'linux')).toBe(false)
    expect(isSameFolder('/src/app/', '/src/app', 'darwin')).toBe(true)
  })
})

describe('git arguments', () => {
  it('builds each command with its paths as separate arguments', () => {
    expect(branchCheckArgs('a b')).toEqual(['check-ref-format', '--branch', 'a b'])
    expect(branchExistsArgs('x')).toEqual(['show-ref', '--verify', '--quiet', 'refs/heads/x'])
    expect(worktreeAddArgs('/w/x', 'x', 'HEAD')).toEqual([
      'worktree',
      'add',
      '-b',
      'x',
      '/w/x',
      'HEAD',
    ])
    expect(worktreeRemoveArgs('/w/x', false)).toEqual(['worktree', 'remove', '/w/x'])
    expect(worktreeRemoveArgs('/w/x', true)).toEqual(['worktree', 'remove', '--force', '/w/x'])
  })

  it('tells git’s dirty-worktree refusal from other failures', () => {
    expect(
      isDirtyWorktreeError(
        "fatal: '/w/x' contains modified or untracked files, use --force to delete it",
      ),
    ).toBe(true)
    expect(isDirtyWorktreeError("fatal: '/w/x' is not a working tree")).toBe(false)
  })
})

// Native Git core (M123 lane G, PLAN.md D104): status parsing, the
// bounded binary-safe diff and commit preparation, proved on hand-written
// git words and on lane 0's fixture repositories (no network: GitHub URLs
// route to local bare repositories through `insteadOf`).

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGitProcess, type GitProcess } from '../../src/host/git'
import {
  commitMessageProblem,
  nativeCommitArgs,
  nativeStageAllArgs,
  readCommitSigning,
} from '../../src/core/git/commit'
import { nativeDiffArgs, readNativeDiff, truncateDiffBytes } from '../../src/core/git/diff'
import {
  isReadableRemoteName,
  nativeRemoteNamesArgs,
  nativeStatusArgs,
  parseRemoteNames,
  parseStatusV2,
  readNativeStatus,
  remoteFetchUrlArgs,
  remotePushUrlArgs,
  toPushHead,
  type NativeGitContext,
} from '../../src/core/git/status'
import type { RemoteFacts } from '../../src/core/git/pushPlan'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'

const NUL = '\0'
// Building the fixture repositories runs dozens of real git processes
// (inits, clones, commits, pushes between local bare repositories); on a
// loaded machine that passes the 10 s hook default while every case
// still passes, so the build hook carries its own named budget.
const FIXTURE_BUILD_TIMEOUT_MS = 60_000

function contextFor(repos: FixtureRepositories, cwd: string): NativeGitContext {
  return { cwd, env: repos.environment }
}

describe('parseStatusV2', () => {
  it('reads a branch with its upstream, counts and files', () => {
    const snapshot = parseStatusV2(
      [
        '# branch.oid abc0001',
        '# branch.head feature',
        '# branch.upstream origin/feature',
        '# branch.ab +1 -0',
        '1 M. N... 100644 100644 100644 abc0001 abc0002 staged.txt',
        '1 .M N... 100644 100644 100644 abc0001 abc0002 unstaged.txt',
        '? new.txt',
      ].join(NUL),
    )
    expect(snapshot).toEqual({
      branch: 'feature',
      upstream: 'origin/feature',
      ahead: 1,
      behind: 0,
      headOid: 'abc0001',
      staged: ['staged.txt'],
      unstaged: ['unstaged.txt'],
      untracked: ['new.txt'],
      records: [
        '1 M. N... 100644 100644 100644 abc0001 abc0002 staged.txt',
        '1 .M N... 100644 100644 100644 abc0001 abc0002 unstaged.txt',
        '? new.txt',
      ],
      submodules: [],
    })
  })

  it('names a submodule change by its `S` field, so its own content stays its own', () => {
    // git-status(1), porcelain v2: `<sub>` is `S<c><m><u>` for a submodule.
    const snapshot = parseStatusV2(
      [
        '# branch.head main',
        '1 .M S.M. 160000 160000 160000 abc0001 abc0001 vendor/lib',
        '1 .M N... 100644 100644 100644 abc0001 abc0002 plain.txt',
      ].join(NUL),
    )
    expect(snapshot.unstaged).toEqual(['vendor/lib', 'plain.txt'])
    expect(snapshot.submodules).toEqual(['vendor/lib'])
  })

  it('reads an unmerged record past its three stages, to the path alone', () => {
    // `u XY sub m1 m2 m3 mW h1 h2 h3 path`: ten fields before the path.
    const snapshot = parseStatusV2(
      [
        '# branch.oid abc0001',
        '# branch.head main',
        'u UU N... 100644 100644 100644 100644 h1aaaaa h2bbbbb h3ccccc conflict file.txt',
      ].join(NUL),
    )
    expect(snapshot.staged).toEqual(['conflict file.txt'])
    expect(snapshot.unstaged).toEqual(['conflict file.txt'])
  })

  it('keeps the staged object name in the records, so other bytes under one name differ', () => {
    const before = parseStatusV2(
      ['# branch.head main', '1 M. N... 100644 100644 100644 abc0001 abc0002 a.txt'].join(NUL),
    )
    const after = parseStatusV2(
      ['# branch.head main', '1 M. N... 100644 100644 100644 abc0001 abc0003 a.txt'].join(NUL),
    )
    expect(after.staged).toEqual(before.staged)
    expect(after.records).not.toEqual(before.records)
  })

  it('reads a detached HEAD as no branch', () => {
    const snapshot = parseStatusV2(['# branch.oid abc0001', '# branch.head (detached)'].join(NUL))
    expect(snapshot.branch).toBeUndefined()
    expect(snapshot.upstream).toBeUndefined()
    expect(snapshot.headOid).toBe('abc0001')
  })

  it('reads a rename once, under its new name', () => {
    const snapshot = parseStatusV2(
      [
        '# branch.oid abc0001',
        '# branch.head main',
        '2 R. N... 100644 100644 100644 abc0001 abc0002 R100 new.txt',
        'old.txt',
      ].join(NUL),
    )
    expect(snapshot.staged).toEqual(['new.txt'])
    expect(snapshot.unstaged).toEqual([])
  })

  it('keeps a path with spaces whole', () => {
    const snapshot = parseStatusV2(
      ['# branch.oid abc0001', '# branch.head main', '? my new file.txt'].join(NUL),
    )
    expect(snapshot.untracked).toEqual(['my new file.txt'])
  })

  it('refuses an unknown record instead of guessing', () => {
    expect(() => parseStatusV2(['# branch.head main', '9 whatever'].join(NUL))).toThrow(
      /Unexpected git status record/,
    )
  })
})

describe('parseRemoteNames', () => {
  it('reads one remote per line', () => {
    expect(parseRemoteNames('origin\nupstream\n')).toEqual(['origin', 'upstream'])
    expect(parseRemoteNames('')).toEqual([])
  })

  it('judges which names may carry a URL read', () => {
    expect(isReadableRemoteName('origin')).toBe(true)
    expect(isReadableRemoteName('team/alpha')).toBe(true)
    expect(isReadableRemoteName('')).toBe(false)
    expect(isReadableRemoteName('-upload-pack')).toBe(false)
    expect(isReadableRemoteName('a b')).toBe(false)
    expect(remoteFetchUrlArgs('origin')).toEqual(['config', '--get', 'remote.origin.url'])
    expect(remotePushUrlArgs('origin')).toEqual(['config', '--get', 'remote.origin.pushurl'])
  })
})

describe('toPushHead', () => {
  const remotes: RemoteFacts[] = [
    { name: 'origin', fetchUrl: 'https://github.com/o/r.git' },
    { name: 'team/alpha', fetchUrl: 'https://github.com/t/r.git' },
  ]

  it('splits the upstream on the longest remote name', () => {
    expect(
      toPushHead(
        { branch: 'feature', upstream: 'team/alpha/feature', ahead: 1, behind: 0 },
        remotes,
      ),
    ).toEqual({
      ok: true,
      head: {
        branch: 'feature',
        upstream: { remote: 'team/alpha', name: 'feature' },
        ahead: 1,
        behind: 0,
      },
    })
  })

  it('refuses an upstream no remote answers instead of pushing elsewhere', () => {
    expect(
      toPushHead({ branch: 'feature', upstream: 'gone/feature', ahead: 1, behind: 0 }, remotes),
    ).toEqual({ ok: false, reason: 'unmatchedUpstream' })
  })

  it('passes a branch without an upstream through for a first push', () => {
    expect(
      toPushHead(
        { branch: 'feature', upstream: undefined, ahead: undefined, behind: undefined },
        remotes,
      ),
    ).toEqual({
      ok: true,
      head: { branch: 'feature', upstream: undefined, ahead: undefined, behind: undefined },
    })
  })
})

describe('fixed arguments', () => {
  it('builds status, remote and diff commands with no room for user text', () => {
    expect(nativeStatusArgs()).toEqual([
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
      '-z',
    ])
    expect(nativeRemoteNamesArgs()).toEqual(['remote'])
    expect(nativeDiffArgs(true)).toEqual([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--cached',
    ])
    expect(nativeDiffArgs(false)).toEqual(['diff', '--no-color', '--no-ext-diff', '--no-textconv'])
    expect(nativeStageAllArgs()).toEqual(['add', '-A'])
    // The message is one `-m` value in an argument array, never a flag.
    expect(nativeCommitArgs('Commit subject\n\nBody with -dash and : colon')).toEqual([
      'commit',
      '-m',
      'Commit subject\n\nBody with -dash and : colon',
    ])
  })
})

describe('truncateDiffBytes', () => {
  it('passes a short diff through whole', () => {
    const bytes = Buffer.from('a\nb\n', 'utf8')
    expect(truncateDiffBytes(bytes, 100)).toEqual({ bytes, truncated: false })
  })

  it('cuts at the last whole line within the cap', () => {
    const { bytes, truncated } = truncateDiffBytes(Buffer.from('aaa\nbbb\nccc\n', 'utf8'), 8)
    expect(truncated).toBe(true)
    expect(bytes.toString('utf8')).toBe('aaa\nbbb\n')
  })

  it('cuts a single long line hard and says so', () => {
    const { bytes, truncated } = truncateDiffBytes(Buffer.from('abcdefgh', 'utf8'), 4)
    expect(truncated).toBe(true)
    expect(bytes.toString('utf8')).toBe('abcd')
  })
})

describe('commitMessageProblem', () => {
  it('refuses an empty message', () => {
    expect(commitMessageProblem('')).toBe('empty')
    expect(commitMessageProblem('   \n  ')).toBe('empty')
  })

  it('passes an ordinary message', () => {
    expect(commitMessageProblem('Add the native status read')).toBeUndefined()
  })

  it('refuses a credential-shaped string before it reaches the repository', () => {
    expect(commitMessageProblem('Ship it ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'credentialShaped',
    )
  })
})

describe('native Git against the fixture repositories', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'm123-native-core-'))
  const built: FixtureRepositories[] = []
  const repos = (): FixtureRepositories => {
    const [first] = built
    if (first === undefined) {
      throw new Error('the fixture repositories were not built')
    }
    return first
  }
  let run: GitProcess | undefined
  const runner = (): GitProcess => {
    if (run === undefined) {
      throw new Error('the git runner was not built')
    }
    return run
  }

  beforeAll(() => {
    built.push(createFixtureRepositories(root))
    run = createGitProcess({
      platform: process.platform,
      env: repos().environment,
      fileExists: existsSync,
      spawn,
    })
  }, FIXTURE_BUILD_TIMEOUT_MS)

  // Removing the fixture tree is the same long operation the build timeout covers.
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  }, FIXTURE_BUILD_TIMEOUT_MS)

  it('reads the own fixture one commit ahead of its upstream', async () => {
    const { snapshot, remotes } = await readNativeStatus(runner(), contextFor(repos(), repos().own))
    expect(snapshot.branch).toBe('feature')
    expect(snapshot.upstream).toBe('origin/feature')
    expect(snapshot.ahead).toBe(1)
    expect(snapshot.behind).toBe(0)
    expect(snapshot.headOid).toMatch(/^[0-9a-f]{40}$/)
    expect(snapshot.staged).toEqual([])
    expect(remotes.map((remote) => remote.name)).toContain('origin')
  })

  it('reads the behind fixture behind its upstream', async () => {
    const { snapshot } = await readNativeStatus(runner(), contextFor(repos(), repos().behind))
    expect(snapshot.branch).toBe('main')
    expect((snapshot.behind ?? 0) > 0).toBe(true)
  })

  it('names a real merge conflict by its path alone', async () => {
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-conflict-'))
    try {
      const environment = repos().environment
      const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: direct, env: environment, stdio: 'pipe' })
      git('init', '-q', '-b', 'main')
      writeFileSync(path.join(direct, 'conflict.txt'), 'base\n')
      git('add', 'conflict.txt')
      git('commit', '-q', '-m', 'Base')
      git('checkout', '-q', '-b', 'other')
      writeFileSync(path.join(direct, 'conflict.txt'), 'other\n')
      git('commit', '-q', '-am', 'Other')
      git('checkout', '-q', 'main')
      writeFileSync(path.join(direct, 'conflict.txt'), 'main\n')
      git('commit', '-q', '-am', 'Main')
      expect(() => git('merge', '-q', 'other')).toThrow()
      const { snapshot } = await readNativeStatus(runner(), contextFor(repos(), direct))
      expect(snapshot.unstaged).toEqual(['conflict.txt'])
      expect(snapshot.records.some((record) => record.startsWith('u '))).toBe(true)
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  it('reads the detached fixture with no branch', async () => {
    const { snapshot } = await readNativeStatus(runner(), contextFor(repos(), repos().detached))
    expect(snapshot.branch).toBeUndefined()
  })

  it('reads the configured signer for the consent', async () => {
    const signing = await readCommitSigning(runner(), contextFor(repos(), repos().signer))
    expect(signing).toEqual({
      gpgsign: true,
      format: 'ssh',
      key: expect.stringContaining('missing-signing-key.pub'),
    })
  })

  it('reads no signer where none is configured', async () => {
    const signing = await readCommitSigning(runner(), contextFor(repos(), repos().own))
    expect(signing).toEqual({ gpgsign: false, format: undefined, key: undefined })
  })

  it('reads a staged and an unstaged diff', async () => {
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-diff-'))
    try {
      const environment = repos().environment
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'tracked.txt'), 'one\n')
      execFileSync('git', ['add', 'tracked.txt'], { cwd: direct, env: environment })
      execFileSync('git', ['commit', '-q', '-m', 'Add files'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'tracked.txt'), 'two\n')
      const staged = await readNativeDiff(runner(), contextFor(repos(), direct), true, 1024)
      expect(staged.truncated).toBe(false)
      expect(staged.bytes.length).toBe(0)
      const unstaged = await readNativeDiff(runner(), contextFor(repos(), direct), false, 1024)
      expect(unstaged.truncated).toBe(false)
      expect(unstaged.bytes.toString('utf8')).toContain('tracked.txt')
      const cut = await readNativeDiff(runner(), contextFor(repos(), direct), false, 10)
      expect(cut.truncated).toBe(true)
      expect(cut.bytes.length).toBeLessThanOrEqual(10)
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  it('keeps non-UTF-8 bytes intact in the diff', async () => {
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-latin-'))
    try {
      const environment = repos().environment
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
      execFileSync('git', ['add', 'latin.txt'], { cwd: direct, env: environment })
      execFileSync('git', ['commit', '-q', '-m', 'Add latin'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe8, 0x0a]))
      const unstaged = await readNativeDiff(runner(), contextFor(repos(), direct), false, 4096)
      expect(unstaged.bytes.includes(Buffer.from([0xe9]))).toBe(true)
      expect(unstaged.bytes.includes(Buffer.from([0xe8]))).toBe(true)
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })
})

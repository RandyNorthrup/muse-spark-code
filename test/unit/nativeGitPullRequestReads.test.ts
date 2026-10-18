// M123's native route, the pull request draft's reads (PLAN.md D104): the
// branch's commit subjects and changed files since the base, through the
// real NativeGitService and the user's real `git` over fixture
// repositories in this test's own folder (GitHub remotes routed to local
// bare repositories by `insteadOf`, so nothing leaves the machine).
//
// What a person would be hurt by: a base branch typed into the pull
// request form (or drafted by the model) that git reads as an option or a
// range would run git with arguments nobody approved; the service must
// refuse it before any git starts, and its argument allowlist must refuse
// any other shape.

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  isRangeSafeRefName,
  nativeBranchFilesArgs,
  nativeBranchLogArgs,
} from '../../src/core/git/diff'
import { isGhLoginEnabled } from '../../src/core/git/tokenSource'
import { processGitPath, processGitRunner } from '../../src/host/git'
import { stderrLogger } from '../../src/runtime/stderrLog'
import {
  assertNativeGitArgs,
  NativeGitRefusalError,
  NativeGitService,
} from '../../src/runtime/panel/git/service'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'

describe('the pull request reads in the native allowlist', () => {
  it('lets the draft read the branch since a plain remote base', () => {
    expect(() => {
      assertNativeGitArgs(nativeBranchLogArgs('origin', 'main'))
    }).not.toThrow()
    expect(() => {
      assertNativeGitArgs(nativeBranchFilesArgs('upstream', 'release/1.0'))
    }).not.toThrow()
  })

  it('refuses a base git would read as an option, a range or a reflog step', () => {
    for (const base of [
      '--output=x',
      '-n',
      'main..evil',
      'main@{1}',
      'a b',
      'x:y',
      '+main',
      '',
      'release/-x',
      'release/.x',
      'release//x',
    ]) {
      expect(isRangeSafeRefName(base)).toBe(false)
    }
    expect(isRangeSafeRefName('feature/one-2')).toBe(true)
  })

  it('refuses any other log or diff shape, whatever its names', () => {
    const log = nativeBranchLogArgs('origin', 'main')
    const files = nativeBranchFilesArgs('origin', 'main')
    const refused = [
      // A flag added beside the fixed ones.
      [...log.slice(0, -1), '--output=/tmp/x', log.at(-1) ?? ''],
      // The range without the remote-tracking prefix, or with an option in it.
      ['log', '--no-color', '--format=%s', '--max-count=50', 'main..HEAD'],
      [...log.slice(0, -1), 'refs/remotes/origin/--output=x..HEAD'],
      [...log.slice(0, -1), 'refs/remotes/origin/main..evil..HEAD'],
      // The changed-files read with its pair swapped or an extra path.
      [...files.slice(0, -2), 'HEAD', 'refs/remotes/origin/main'],
      [...files, 'secret.txt'],
    ]
    for (const args of refused) {
      expect(() => {
        assertNativeGitArgs(args)
      }).toThrow(/Refused git (log|diff) arguments/)
    }
  })
})

describe('the pull request draft reads, against real repositories', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'm123-pr-reads-'))
  const built: FixtureRepositories[] = []
  const repos = (): FixtureRepositories => {
    const [first] = built
    if (first === undefined) {
      throw new Error('the fixture repositories were not built')
    }
    return first
  }
  const gitPath = processGitPath()

  beforeAll(() => {
    built.push(createFixtureRepositories(root))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** The runtime's own log lines, as the service wrote them. */
  const logged: string[] = []

  /**
   * The service over `folder`, with what a host gives it: the folder, the
   * user's git, the window's signal, its trust, the user's Git environment
   * (here the fixture's, with no user or system configuration), and the
   * runtime's logger.
   */
  const serviceAt = (folder: string): NativeGitService => {
    if (gitPath === undefined) {
      throw new Error('git is not on PATH')
    }
    return new NativeGitService({
      repositoryRoot: folder,
      gitPath,
      signal: new AbortController().signal,
      isTrusted: () => true,
      userEnvironment: () => repos().environment,
      dataFolder: root,
      log: stderrLogger((line) => {
        logged.push(line)
      }, 'trace'),
    })
  }

  it('names the branch’s commits and changed files since the base, newest first', async () => {
    const since = await serviceAt(repos().own).branchSince('origin', 'main')
    expect(since.subjects).toEqual(['Add ahead.txt', 'Add feature.txt'])
    expect(since.files.toSorted((left, right) => left.localeCompare(right))).toEqual([
      'ahead.txt',
      'feature.txt',
    ])
  })

  it('fetches a base git does not have yet, then reads it', async () => {
    execFileSync('git', ['update-ref', '-d', 'refs/remotes/origin/main'], {
      cwd: repos().fork,
      env: repos().environment,
    })
    const since = await serviceAt(repos().fork).branchSince('origin', 'main')
    expect(since.subjects).toEqual([])
    expect(since.files).toEqual([])
    const fetched = execFileSync('git', ['rev-parse', '--verify', 'refs/remotes/origin/main'], {
      cwd: repos().fork,
      env: repos().environment,
      encoding: 'utf8',
    })
    expect(fetched.trim()).toMatch(/^[0-9a-f]{40}$/)
    // The failed first read is logged in fixed words: no path, no remote address.
    expect(logged.some((line) => line.includes('git log failed'))).toBe(true)
    expect(logged.join(' ')).not.toContain(repos().fork)
    expect(logged.join(' ')).not.toContain('github.com')
  })

  it('refuses an option-shaped base before any git runs', async () => {
    const service = serviceAt(repos().own)
    await expect(service.branchSince('origin', '--output=pwned')).rejects.toEqual(
      new NativeGitRefusalError('refused'),
    )
    await expect(service.branchSince('-c', 'main')).rejects.toEqual(
      new NativeGitRefusalError('refused'),
    )
  })
})

describe('no deadline of ours on a checkout’s git (M123)', () => {
  it('lets a commit whose hook takes over a second finish under Infinity', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'm123-no-deadline-'))
    try {
      const env = {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        HOME: folder,
        USERPROFILE: folder,
      }
      const git = (args: readonly string[]) => {
        execFileSync('git', [...args], { cwd: folder, env })
      }
      git(['init', '--initial-branch=main'])
      git(['config', 'user.email', 'test@example.invalid'])
      git(['config', 'user.name', 'Test'])
      // A pre-commit hook that takes 1.2 s: past any small deadline, so a
      // clamped Infinity (Node reads setTimeout(Infinity) as 1 ms) fails.
      const hook = path.join(folder, '.git', 'hooks', 'pre-commit')
      writeFileSync(
        hook,
        `#!/bin/sh\n"${process.execPath.replaceAll('\\', '/')}" -e "setTimeout(()=>{},1200)"\n`,
      )
      chmodSync(hook, 0o755)
      writeFileSync(path.join(folder, 'a.txt'), 'a\n')
      git(['add', 'a.txt'])
      const started = Date.now()
      await processGitRunner({ env })(['commit', '-m', 'slow hook'], folder, Infinity)
      expect(Date.now() - started).toBeGreaterThanOrEqual(1100)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('the gh sign-in setting (D104 source c)', () => {
  it('counts only the user’s or the machine’s own true, never a repository’s', () => {
    expect(isGhLoginEnabled(undefined)).toBe(false)
    expect(isGhLoginEnabled({ workspaceValue: true })).toBe(false)
    expect(isGhLoginEnabled({ workspaceFolderValue: true })).toBe(false)
    expect(isGhLoginEnabled({ globalValue: 'true' })).toBe(false)
    expect(isGhLoginEnabled({ globalValue: true, workspaceValue: false })).toBe(true)
  })
})

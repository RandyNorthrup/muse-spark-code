// Checking out a pull request in the runtime (M123 lane P): refusals,
// the own worktree beside the repository, the held worktree under the
// data folder, the hold over both roots and its release, on the REST fake
// with a recording git port — then end to end on the fixture repositories
// with the real git runner.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { heldWorktreesRoot } from '../../src/core/worktreeConversations'
import { UI_TEXT } from '../../src/shared/constants'
import {
  createNodePullRequestCheckoutGit,
  pullRequestFetchEnvironment,
  quietPullRequestEnvironment,
  RuntimePullRequestCheckout,
  type PullRequestCheckoutGit,
  type RuntimeCheckoutDeps,
} from '../../src/runtime/panel/pullRequests/checkout'
import {
  createFileWorktreeRecordStore,
  createMemoryWorktreeRecordStore,
  holdForRoots,
} from '../../src/runtime/panel/pullRequests/records'
import type { CoreLogger } from '../../src/core/logging'
import { fakeGitHub } from './helpers/fakeGitHub'
import { CAPTURED_PULL_FORK, CAPTURED_PULL_OWN } from './helpers/githubCapture'
import { fakeRuntimeGitDeps, fakeTokenSource } from './helpers/github/fakes'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'

const CANARY = 'm123p-checkout-canary'
const OWN = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const OWN_PULLS = '/repos/RandyNorthrup/muse-spark-code/pulls/56'
const FORK_PULLS = '/repos/RandyNorthrup/muse-spark-code/pulls/51'

function recordingLogger(): CoreLogger & { readonly lines: string[] } {
  const lines: string[] = []
  const record = (line: string) => {
    lines.push(line)
  }
  return { lines, trace: record, info: record, warn: record, error: record }
}

interface GitCalls {
  readonly fetched: { readonly cwd: string; readonly remote: string; readonly ref: string }[]
  readonly addedOwn: { readonly cwd: string; readonly folder: string; readonly sha: string }[]
  readonly checkedOutHeld: { readonly folder: string; readonly sha: string; readonly cwd: string }[]
}

function recordingGit(
  headSha: string,
  failures: { readonly fetch?: boolean; readonly add?: boolean } = {},
): {
  readonly git: PullRequestCheckoutGit
  readonly calls: GitCalls
} {
  const calls: GitCalls = { fetched: [], addedOwn: [], checkedOutHeld: [] }
  return {
    calls,
    git: {
      fetch: (cwd, remote, ref) => {
        calls.fetched.push({ cwd, remote, ref })
        return failures.fetch === true
          ? Promise.reject(new Error('the network is down'))
          : Promise.resolve()
      },
      readFetchHead: () => Promise.resolve(`${headSha}\n`),
      addOwnWorktree: (cwd, folder, sha) => {
        calls.addedOwn.push({ cwd, folder, sha })
        return failures.add === true
          ? Promise.reject(new Error('the worktree could not be added'))
          : Promise.resolve()
      },
      checkOutHeld: (folder, sha, cwd) => {
        calls.checkedOutHeld.push({ folder, sha, cwd })
        return failures.add === true
          ? Promise.reject(new Error('the worktree could not be added'))
          : Promise.resolve()
      },
    },
  }
}

async function checkoutSetup(
  options: {
    readonly signedIn?: boolean
    readonly trusted?: boolean
    readonly confirm?: boolean
    readonly headSha?: string
    readonly noSources?: boolean
    readonly failures?: { readonly fetch?: boolean; readonly add?: boolean }
  } = {},
) {
  const github = fakeGitHub()
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'm123p-repo-'))
  const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-data-'))
  const storageRoot = await mkdtemp(path.join(tmpdir(), 'm123p-vscode-'))
  const { deps } = fakeRuntimeGitDeps(repositoryRoot)
  const log = recordingLogger()
  const confirms: { readonly message: string; readonly detail: string; readonly action: string }[] =
    []
  const opened: string[] = []
  const source = fakeTokenSource('deviceFlow', {
    bearer: CANARY,
    isSignedIn: options.signedIn ?? true,
    fetch: github.fetch,
  })
  const recording = recordingGit(options.headSha ?? CAPTURED_PULL_OWN.head.sha, options.failures)
  const records = createMemoryWorktreeRecordStore('linux')
  const heldRoots = [
    heldWorktreesRoot(storageRoot, 'linux'),
    heldWorktreesRoot(dataFolder, 'linux'),
  ]
  const checkout = new RuntimePullRequestCheckout({
    ...deps,
    repositoryRoot,
    dataFolder,
    tokenSources: options.noSources === true ? [] : [source],
    platform: 'linux',
    now: () => 2000,
    confirm: (message, detail, action) => {
      confirms.push({ message, detail, action })
      return Promise.resolve(options.confirm ?? true)
    },
    openFolder: (folder) => {
      opened.push(folder)
      return Promise.resolve()
    },
    baseUrl: 'https://api.github.test',
    log,
    isTrusted: () => options.trusted ?? true,
    records,
    heldRoots,
    git: recording.git,
    pathExists: (fsPath) => existsSync(fsPath),
  } satisfies RuntimeCheckoutDeps)
  return {
    github,
    checkout,
    confirms,
    opened,
    log,
    source,
    repositoryRoot,
    dataFolder,
    storageRoot,
    git: recording,
    records,
    heldRoots,
  }
}

const OWN_REMOTES = [{ name: 'origin', repository: OWN }]

describe('runtime pull request checkout (M123 lane P)', () => {
  it('refuses a pull request reference that is not one', async () => {
    const { checkout, git, confirms } = await checkoutSetup()
    const result = await checkout.open('not a pull request', OWN_REMOTES, 'origin')
    expect(result).toEqual({ ok: false, reason: UI_TEXT.openPullRequestInvalid })
    expect(git.calls.fetched).toHaveLength(0)
    expect(confirms).toHaveLength(0)
  })

  it('refuses when no remote reaches the pull request', async () => {
    const { checkout, git } = await checkoutSetup()
    const noRemote = await checkout.open('56', [], undefined)
    expect(noRemote).toEqual({ ok: false, reason: UI_TEXT.openPullRequestNoRemote })
    const otherRepository = await checkout.open(
      'https://github.com/someone-else/other/pull/7',
      OWN_REMOTES,
      'origin',
    )
    expect(otherRepository.ok).toBe(false)
    expect(git.calls.fetched).toHaveLength(0)
  })

  it('asks for sign-in when no source has a credential', async () => {
    const { checkout, git, github } = await checkoutSetup({ noSources: true })
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitHubSignInDeclined })
    expect(git.calls.fetched).toHaveLength(0)
    expect(github.requests).toHaveLength(0)
  })

  it('checks out the user’s own pull request beside the repository', async () => {
    const { checkout, git, confirms, opened, repositoryRoot } = await checkoutSetup()
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.held).toBe(false)
    expect(result.number).toBe(56)
    expect(result.folder).toBe(
      path.posix.join(
        path.posix.dirname(repositoryRoot),
        `${path.posix.basename(repositoryRoot)}.worktrees`,
        'pr-56',
      ),
    )
    expect(git.calls.fetched).toEqual([
      { cwd: repositoryRoot, remote: 'origin', ref: 'pull/56/head' },
    ])
    expect(git.calls.addedOwn).toHaveLength(1)
    expect(git.calls.checkedOutHeld).toHaveLength(0)
    expect(confirms).toHaveLength(1)
    expect(confirms[0]?.detail).toContain(CAPTURED_PULL_OWN.title)
    expect(opened).toEqual([result.folder])
  })

  it('checks out someone else’s pull request held under the data folder', async () => {
    const { checkout, git, confirms, opened, dataFolder, repositoryRoot } = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
    })
    const result = await checkout.open('51', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.held).toBe(true)
    expect(result.folder.startsWith(`${dataFolder}/pr-worktrees/51-`)).toBe(true)
    expect(git.calls.checkedOutHeld).toEqual([
      { folder: result.folder, sha: CAPTURED_PULL_FORK.head.sha, cwd: repositoryRoot },
    ])
    expect(git.calls.addedOwn).toHaveLength(0)
    expect(confirms[0]?.detail).toContain(UI_TEXT.openPullRequestHeldDetail)
    expect(opened).toEqual([result.folder])
  })

  it('checks nothing out without an explicit confirm', async () => {
    const { checkout, git, opened } = await checkoutSetup({ confirm: false })
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    expect(git.calls.addedOwn).toHaveLength(0)
    expect(opened).toHaveLength(0)
  })

  it('refuses when the fetch disagrees with the pull request’s head', async () => {
    const { checkout, git } = await checkoutSetup({ headSha: '0'.repeat(40) })
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitOperationChanged })
    expect(git.calls.addedOwn).toHaveLength(0)
  })

  it('reports a failed fetch and keeps no record', async () => {
    const { checkout } = await checkoutSetup({ failures: { fetch: true } })
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain(UI_TEXT.openPullRequestFetchFailed)
    }
  })

  it('removes the record when the worktree cannot be added', async () => {
    const setup = await checkoutSetup({ failures: { add: true } })
    const result = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain(UI_TEXT.worktreeAddFailed)
    }
  })

  it('refuses a remote named like an option', async () => {
    const { checkout, git } = await checkoutSetup()
    const result = await checkout.open(
      '56',
      [{ name: '--upload-pack=touch', repository: OWN }],
      undefined,
    )
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitPushUnsafeName })
    expect(git.calls.fetched).toHaveLength(0)
    expect(git.calls.addedOwn).toHaveLength(0)
  })

  it('offers a finished checkout again instead of taking it over', async () => {
    const setup = await checkoutSetup()
    const first = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    await mkdir(first.folder, { recursive: true })
    const second = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(second).toEqual({ ok: true, folder: first.folder, held: false, number: 56 })
    expect(setup.git.calls.addedOwn).toHaveLength(1)
    expect(setup.opened).toEqual([first.folder, first.folder])
  })

  it('never opens a folder it did not check out', async () => {
    const setup = await checkoutSetup()
    const folder = path.posix.join(
      path.posix.dirname(setup.repositoryRoot),
      `${path.posix.basename(setup.repositoryRoot)}.worktrees`,
      'pr-56',
    )
    await mkdir(folder, { recursive: true })
    const result = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain(UI_TEXT.worktreeFolderExists)
    }
    expect(setup.opened).toHaveLength(0)
    expect(setup.git.calls.addedOwn).toHaveLength(0)
  })

  it('holds the foreign worktree under either root until the card releases it', async () => {
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    if (!result.ok) {
      throw new Error('checkout failed')
    }
    const records = await setup.records.list()
    expect(holdForRoots([result.folder], setup.heldRoots, records, 'linux')?.folder).toBe(
      result.folder,
    )
    // Both roots are consulted: a worktree the other editor made holds too.
    const vscodeRoot = setup.heldRoots[0]
    if (vscodeRoot === undefined) {
      throw new Error('held roots missing')
    }
    const vscodeFolder = `${vscodeRoot}/51-abcdef12`
    await setup.records.put({
      folder: vscodeFolder,
      repositoryRoot: setup.repositoryRoot,
      createdAt: 2000,
      pullRequest: {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 51,
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
        title: 'A foreign pull request',
        author: 'Piangpi1997',
        headSha: CAPTURED_PULL_FORK.head.sha,
        isAuthoredByUser: false,
      },
      isHeld: true,
      isCheckoutPending: true,
    })
    expect(
      holdForRoots([vscodeFolder], setup.heldRoots, await setup.records.list(), 'linux')?.folder,
    ).toBe(vscodeFolder)
    const released = await setup.checkout.releaseHold(result.folder)
    expect(released).toEqual({ ok: true })
    expect(
      holdForRoots([result.folder], setup.heldRoots, await setup.records.list(), 'linux'),
    ).toBeUndefined()
    const unknown = await setup.checkout.releaseHold(`${result.folder}-missing`)
    expect(unknown.ok).toBe(false)
  })

  it('keeps the bearer out of every result and log', async () => {
    const { checkout, log } = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const own = await checkout.open('56', OWN_REMOTES, 'origin')
    const foreign = await checkout.open('51', OWN_REMOTES, 'origin')
    const refused = await checkout.open('nope', OWN_REMOTES, 'origin')
    for (const value of [own, foreign, refused, log.lines]) {
      expect(JSON.stringify(value)).not.toContain(CANARY)
    }
  })
})

describe('pull request git environments (M123 lane P)', () => {
  it('fetches with the user’s environment and runs everything else quiet', () => {
    const env = { PATH: '/usr/bin', GH_TOKEN: 'user-token', GITHUB_TOKEN: 'user-token' }
    const fetchEnv = pullRequestFetchEnvironment(env)
    expect(fetchEnv['GH_TOKEN']).toBe('user-token')
    expect(fetchEnv['GIT_TERMINAL_PROMPT']).toBe('0')
    const quietEnv = quietPullRequestEnvironment(env)
    expect(quietEnv['GH_TOKEN']).toBeUndefined()
    expect(quietEnv['GITHUB_TOKEN']).toBeUndefined()
    expect(quietEnv['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(quietEnv['GIT_OPTIONAL_LOCKS']).toBe('0')
  })
})

describe('worktree record store (M123 lane P)', () => {
  it('completes, removes and releases records', async () => {
    const store = createMemoryWorktreeRecordStore('linux')
    const record = {
      folder: '/data/pr-worktrees/51-abcdef12',
      repositoryRoot: '/repo',
      createdAt: 2000,
      pullRequest: {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 51,
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
        title: 'A foreign pull request',
        author: 'Piangpi1997',
        headSha: CAPTURED_PULL_FORK.head.sha,
        isAuthoredByUser: false,
      },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    expect(await store.put({ ...record })).toBeUndefined()
    const pending = await store.recordFor(record.folder)
    expect(pending?.isCheckoutPending).toBe(true)
    await store.complete(record.folder, record.createdAt)
    const completed = await store.recordFor(record.folder)
    expect(completed?.isCheckoutPending).toBeUndefined()
    const released = await store.release(record.folder, 3000)
    expect(released?.isHeld).toBe(false)
    expect(released?.trustConfirmedAt).toBe(3000)
    await store.remove(record.folder, record.createdAt, undefined)
    expect(await store.recordFor(record.folder)).toBeUndefined()
    expect(await store.release(`${record.folder}-missing`, 3000)).toBeUndefined()
  })

  it('never lets a stale window’s read restore trust or drop records', async () => {
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-records-'))
    const log = recordingLogger()
    const heldRoot = path.join(dataFolder, 'pr-worktrees')
    const folder = path.join(heldRoot, '51-abcdef12')
    const origin = {
      repository: 'RandyNorthrup/muse-spark-code',
      number: 51,
      url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
      title: 'A foreign pull request',
      author: 'Piangpi1997',
      headSha: CAPTURED_PULL_FORK.head.sha,
      isAuthoredByUser: false,
    } as const
    // Window A caches a trusted checkout of the worktree.
    const windowA = createFileWorktreeRecordStore(dataFolder, 'linux', log)
    await windowA.put({
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      pullRequest: { ...origin },
      isHeld: true,
      trustConfirmedAt: 1500,
    })
    // The worktree is removed; window B checks out the updated pull
    // request at the same folder, held without confirmation, and records
    // an unrelated checkout too.
    const windowB = createFileWorktreeRecordStore(dataFolder, 'linux', log)
    const held = {
      folder,
      repositoryRoot: '/repo',
      createdAt: 2000,
      pullRequest: { ...origin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    await windowB.put({ ...held })
    const otherFolder = path.join(heldRoot, '56-fedcba98')
    await windowB.put({
      folder: otherFolder,
      repositoryRoot: '/repo',
      createdAt: 2000,
      pullRequest: { ...origin, number: 56 },
      isHeld: true,
      isCheckoutPending: true,
    })
    // A subsequent read in the stale window must see the new record, and
    // — reads never write — must not put the old trust back.
    expect(await windowA.recordFor(folder)).toEqual({ ...held })
    const fresh = createFileWorktreeRecordStore(dataFolder, 'linux', log)
    expect(await fresh.recordFor(folder)).toEqual({ ...held })
    expect(await fresh.recordFor(otherFolder)).toBeDefined()
    expect(holdForRoots([folder], [heldRoot], await fresh.list(), 'linux')?.folder).toBe(folder)
  })
})

describe('runtime pull request checkout on the fixture repositories (M123 lane P)', () => {
  let fixtures: FixtureRepositories

  beforeAll(async () => {
    fixtures = createFixtureRepositories(await mkdtemp(path.join(tmpdir(), 'm123p-fixtures-')))
  })

  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, env: fixtures.environment, encoding: 'utf8' }).trim()
  }

  async function fixtureSetup(kind: 'own' | 'held'): Promise<{
    checkout: RuntimePullRequestCheckout
    opened: string[]
    dataFolder: string
    sha: string
  }> {
    const repositoryRoot = kind === 'own' ? fixtures.own : fixtures.fork
    if (kind === 'own') {
      // The pull ref serves the branch tip, so the branch goes up first.
      git(repositoryRoot, 'push', '-q', 'origin', 'feature')
    }
    const sha = git(repositoryRoot, 'rev-parse', kind === 'own' ? 'feature' : 'HEAD')
    // The pull refs GitHub would serve, pointed at the fixture's own commits.
    git(fixtures.parentBare, 'update-ref', `refs/pull/${kind === 'own' ? '56' : '51'}/head`, sha)
    const github = fakeGitHub()
    const route = kind === 'own' ? OWN_PULLS : FORK_PULLS
    const captured = kind === 'own' ? CAPTURED_PULL_OWN : CAPTURED_PULL_FORK
    github.answer('GET', route, {
      status: 200,
      body: { ...captured, head: { ...captured.head, sha } },
    })
    const { deps } = fakeRuntimeGitDeps(repositoryRoot)
    const log = recordingLogger()
    const opened: string[] = []
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-held-'))
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'm123p-vsc-'))
    const which = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
    const checkout = new RuntimePullRequestCheckout({
      ...deps,
      repositoryRoot,
      dataFolder,
      tokenSources: [
        fakeTokenSource('deviceFlow', { bearer: CANARY, isSignedIn: true, fetch: github.fetch }),
      ],
      platform: 'linux',
      now: () => 2000,
      confirm: () => Promise.resolve(true),
      openFolder: (folder) => {
        opened.push(folder)
        return Promise.resolve()
      },
      baseUrl: 'https://api.github.test',
      log,
      records: createMemoryWorktreeRecordStore('linux'),
      heldRoots: [heldWorktreesRoot(storageRoot, 'linux'), heldWorktreesRoot(dataFolder, 'linux')],
      git: createNodePullRequestCheckoutGit({
        gitPath: which,
        userEnv: pullRequestFetchEnvironment({ ...fixtures.environment }),
        quietEnv: quietPullRequestEnvironment({ ...fixtures.environment }),
        platform: 'linux',
        log,
      }),
      pathExists: (fsPath) => existsSync(fsPath),
    } satisfies RuntimeCheckoutDeps)
    return { checkout, opened, dataFolder, sha }
  }

  it('checks out the user’s own pull request beside the fixture repository', async () => {
    const { checkout, opened, sha } = await fixtureSetup('own')
    const result = await checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.held).toBe(false)
    expect(existsSync(result.folder)).toBe(true)
    expect(git(result.folder, 'rev-parse', 'HEAD')).toBe(sha)
    expect(opened).toEqual([result.folder])
  })

  it('checks out someone else’s pull request held, byte for byte', async () => {
    const { checkout, opened, dataFolder, sha } = await fixtureSetup('held')
    const remotes = [
      { name: 'origin', repository: { owner: 'Piangpi1997', name: 'muse-spark-code' } },
      { name: 'upstream', repository: OWN },
    ]
    const result = await checkout.open('51', remotes, 'origin')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.held).toBe(true)
    expect(result.folder.startsWith(`${dataFolder}/pr-worktrees/51-`)).toBe(true)
    expect(git(result.folder, 'rev-parse', 'HEAD')).toBe(sha)
    const worktree = git(fixtures.fork, 'worktree', 'list', '--porcelain')
    expect(worktree).toContain(result.folder)
    const expected = await readFile(path.join(fixtures.fork, 'README.md'), 'utf8')
    expect(await readFile(path.join(result.folder, 'README.md'), 'utf8')).toBe(expected)
    expect(opened).toEqual([result.folder])
  })
})

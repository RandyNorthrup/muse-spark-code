// Checking out a pull request in the runtime (M123 lane P): refusals,
// the own worktree beside the repository, the held worktree under the
// data folder, the hold over both roots and its release, on the REST fake
// with a recording git port — then end to end on the fixture repositories
// with the real git runner.

import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname as hostnameOf, tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveExecutable } from '../../src/core/executables'
import { BlobAnswers } from '../../src/core/git/heldCheckoutCore'
import type { HeldEntry } from '../../src/core/git/heldTree'
import {
  heldWorktreeFolder,
  heldWorktreesRoot,
  type WorktreeRecord,
} from '../../src/core/worktreeConversations'
import { createFileExclusively } from '../../src/host/fsAtomic'
import { PENDING_CHECKOUT_RECOVERY_MS, UI_TEXT } from '../../src/shared/constants'
import {
  CleanupPendingError,
  createNodePullRequestCheckoutGit,
  HeldFolderTakenError,
  HeldWriters,
  pullRequestFetchEnvironment,
  quietPullRequestEnvironment,
  runBatchChild,
  RuntimePullRequestCheckout,
  type PullRequestCheckoutGit,
  type RuntimeCheckoutDeps,
} from '../../src/runtime/panel/pullRequests/checkout'
import {
  createFileWorktreeRecordStore,
  createMemoryWorktreeRecordStore,
  holdForRoots,
  recordRevision,
  versionOf,
  type TrustTicket,
} from '../../src/runtime/panel/pullRequests/records'
import { currentProcessOwner } from '../../src/runtime/panel/pullRequests/processOwner'
import type { CoreLogger } from '../../src/core/logging'
import { fakeGitHub } from './helpers/fakeGitHub'
import { CAPTURED_PULL_FORK, CAPTURED_PULL_OWN } from './helpers/githubCapture'
import { fakeRuntimeGitDeps, fakeTokenSource } from './helpers/github/fakes'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'

const CANARY = 'm123p-checkout-canary'
const OWN = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
const OWN_PULLS = '/repos/RandyNorthrup/muse-spark-code/pulls/56'
const FORK_PULLS = '/repos/RandyNorthrup/muse-spark-code/pulls/51'
const FOREIGN_TEXT = 'not this checkout’s'

/** A held destination under a fresh data folder, and a foreign file's place in it. */
async function raceFolder(): Promise<{ readonly folder: string; readonly foreign: string }> {
  const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-own-'))
  const folder = path.join(dataFolder, 'pr-worktrees', '51-race')
  return { folder, foreign: path.join(folder, 'foreign.txt') }
}

// The held checkout asks its owner check twice per hook listing (once after
// git's version, cached after the first) and once before each git step:
// listing, check, ls-tree, listing, check, then the worktree is added.
const LAST_CHECK_BEFORE_ADD = 6
const CAPTURED_ORIGIN = {
  repository: 'RandyNorthrup/muse-spark-code',
  number: 51,
  url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
  title: 'A foreign pull request',
  author: 'Piangpi1997',
  headSha: CAPTURED_PULL_FORK.head.sha,
  isAuthoredByUser: false,
} as const

/** Where the service checks pull request `number` of OWN out, held. */
function heldFolderOf(dataFolder: string, number: number): string {
  return heldWorktreeFolder(dataFolder, OWN, number, process.platform)
}

/** The id of a process that has exited: provably gone on this host. */
async function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true })
  await new Promise((resolve) => {
    child.once('exit', resolve)
  })
  if (child.pid === undefined) {
    throw new Error('the process never started')
  }
  return child.pid
}

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

/** Git as a successful add leaves it: the worktree folder exists. */
async function made(folder: string, work: Promise<void>): Promise<void> {
  await work
  await mkdir(folder, { recursive: true })
}

function recordingGit(
  headSha: string,
  failures: { readonly fetch?: boolean; readonly add?: boolean } = {},
  addOwnWorktree?: (call: number) => Promise<void>,
  checkOutHeld?: (folder: string) => Promise<void>,
): {
  readonly git: PullRequestCheckoutGit
  readonly calls: GitCalls
} {
  const calls: GitCalls = { fetched: [], addedOwn: [], checkedOutHeld: [] }
  const added = () =>
    failures.add === true
      ? Promise.reject(new Error('the worktree could not be added'))
      : Promise.resolve()
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
        return made(
          folder,
          addOwnWorktree === undefined ? added() : addOwnWorktree(calls.addedOwn.length),
        )
      },
      checkOutHeld: (folder, sha, cwd) => {
        calls.checkedOutHeld.push({ folder, sha, cwd })
        return checkOutHeld === undefined ? made(folder, added()) : checkOutHeld(folder)
      },
    },
  }
}

/** The folder as the store spells it: `/` separators on every platform. */
function slashedPath(folder: string): string {
  return folder.replaceAll('\\', '/')
}

async function ticketFor(checkout: RuntimePullRequestCheckout, folder: string) {
  const ticket = await checkout.trustTicket(folder)
  if (ticket === undefined) {
    throw new Error(`no trust ticket for ${folder}`)
  }
  return ticket
}

/** The card shown for `folder`, confirmed: whether the hold was released. */
async function isTrustedInCard(checkout: RuntimePullRequestCheckout, folder: string) {
  const released = await checkout.releaseHold(await ticketFor(checkout, folder))
  return released.ok
}

/** Something to resolve from outside, as a paused writer or a late cleanup is. */
function deferred(): { readonly promise: Promise<undefined>; readonly resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<undefined>()
  return {
    promise,
    resolve: () => {
      resolve(undefined)
    },
  }
}

/** How a promise settled, without letting a rejection go unhandled. */
async function settled<T>(work: Promise<T>): Promise<T | Error> {
  try {
    return await work
  } catch (error: unknown) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * A batch root that answers the first of two blobs and then goes quiet,
 * so its deadline fires while the first blob's writer is in flight.
 */
function oneAnswerBatch(): {
  readonly child: ReturnType<typeof spawn>
  readonly blobs: HeldEntry[]
} {
  const blobs: HeldEntry[] = [
    { path: 'first.txt', kind: 'file', oid: 'a'.repeat(40), size: 5 },
    { path: 'second.txt', kind: 'file', oid: 'b'.repeat(40), size: 5 },
  ]
  const script = [
    String.raw`process.stdout.write('${'a'.repeat(40)} blob 5\nhello\n');`,
    'process.stdin.resume();',
    'setTimeout(() => {}, 60000);',
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script], {
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  child.stderr.resume()
  return { child, blobs }
}

async function checkoutSetup(
  options: {
    readonly signedIn?: boolean
    readonly trusted?: boolean
    readonly confirm?: boolean
    readonly headSha?: string
    readonly noSources?: boolean
    readonly failures?: { readonly fetch?: boolean; readonly add?: boolean }
    readonly now?: () => number
    readonly addOwnWorktree?: (call: number) => Promise<void>
    readonly checkOutHeld?: (folder: string) => Promise<void>
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
  const recording = recordingGit(
    options.headSha ?? CAPTURED_PULL_OWN.head.sha,
    options.failures,
    options.addOwnWorktree,
    options.checkOutHeld,
  )
  const records = createMemoryWorktreeRecordStore(process.platform)
  const heldRoots = [
    heldWorktreesRoot(storageRoot, process.platform),
    heldWorktreesRoot(dataFolder, process.platform),
  ]
  const checkout = new RuntimePullRequestCheckout({
    ...deps,
    repositoryRoot,
    dataFolder,
    tokenSources: options.noSources === true ? [] : [source],
    platform: process.platform,
    now: options.now ?? (() => 2000),
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

function uncancelledCheck(): void {
  // The operation runs uncancelled; the signal carries the cancel.
}

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
      path.join(
        path.dirname(repositoryRoot),
        `${path.basename(repositoryRoot)}.worktrees`,
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
    expect(result.folder.startsWith(path.join(dataFolder, 'pr-worktrees', '51-'))).toBe(true)
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

  it('drops the credential on a 401 and asks to sign in again', async () => {
    const setup = await checkoutSetup()
    setup.github.answer('GET', OWN_PULLS, { status: 401, body: {} })
    const result = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.needsSignIn).toBe(true)
    }
    expect(setup.source.rejectedBearers).toEqual([CANARY])
    expect(setup.git.calls.addedOwn).toHaveLength(0)
    expect(setup.opened).toHaveLength(0)
  })

  it('removes the record when the worktree cannot be added', async () => {
    const setup = await checkoutSetup({ failures: { add: true } })
    const result = await setup.checkout.open('56', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain(UI_TEXT.worktreeAddFailed)
    }
  })

  it('serializes overlapping opens instead of stranding the checkout pending', async () => {
    let stamps = 0
    const setup = await checkoutSetup({
      now: () => {
        stamps += 1
        return 1000 + stamps
      },
      // A second add would fail, as its folder is taken; the queued open
      // must never get that far.
      addOwnWorktree: (call) =>
        new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            if (call === 1) {
              resolve()
            } else {
              reject(new Error('the worktree folder exists already'))
            }
          }, 30)
        }),
    })
    const [first, second] = await Promise.all([
      setup.checkout.open('56', OWN_REMOTES, 'origin'),
      setup.checkout.open('56', OWN_REMOTES, 'origin'),
    ])
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    // The queued open finds the finished checkout and offers it again.
    expect(second).toEqual({ ok: true, folder: first.folder, held: false, number: 56 })
    expect(setup.git.calls.addedOwn).toHaveLength(1)
    const record = await setup.records.recordFor(first.folder)
    expect(record?.isCheckoutPending).toBeUndefined()
  })

  it('refuses a second window’s open while the first checkout is pending', async () => {
    // Two service instances share one file store, as two windows do: the
    // second follows the pending record instead of racing it, and the
    // first still completes its checkout.
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'm123p-repo-'))
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-data-'))
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'm123p-vsc-'))
    const log = recordingLogger()
    const { deps } = fakeRuntimeGitDeps(repositoryRoot)
    const heldRoots = [
      heldWorktreesRoot(storageRoot, process.platform),
      heldWorktreesRoot(dataFolder, process.platform),
    ]
    const addedFolders: string[] = []
    const makeWindow = () => {
      const github = fakeGitHub()
      const recording = recordingGit(CAPTURED_PULL_OWN.head.sha, {}, (call) =>
        call === 1
          ? new Promise<void>((resolve) => {
              setTimeout(resolve, 50)
            })
          : Promise.reject(new Error('the worktree folder exists already')),
      )
      const checkout = new RuntimePullRequestCheckout({
        ...deps,
        repositoryRoot,
        dataFolder,
        tokenSources: [
          fakeTokenSource('deviceFlow', { bearer: CANARY, isSignedIn: true, fetch: github.fetch }),
        ],
        platform: process.platform,
        now: () => 2000,
        confirm: () => Promise.resolve(true),
        openFolder: () => Promise.resolve(),
        baseUrl: 'https://api.github.test',
        log,
        isTrusted: () => true,
        records: createFileWorktreeRecordStore(dataFolder, process.platform, log),
        heldRoots,
        git: {
          ...recording.git,
          addOwnWorktree: (cwd, folder, sha, check) => {
            addedFolders.push(folder)
            return recording.git.addOwnWorktree(cwd, folder, sha, check)
          },
        },
        pathExists: (fsPath) => existsSync(fsPath),
      } satisfies RuntimeCheckoutDeps)
      return checkout
    }
    const [first, second] = await Promise.all([
      makeWindow().open('56', OWN_REMOTES, 'origin'),
      makeWindow().open('56', OWN_REMOTES, 'origin'),
    ])
    const succeeded = [first, second].filter((result) => result.ok)
    const refused = [first, second].filter((result) => !result.ok)
    expect(succeeded).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0]).toEqual({ ok: false, reason: UI_TEXT.gitOperationChanged })
    // `at` stays optional under every project config; the length
    // assert above guards the lookup.
    const winner = succeeded.at(0)
    if (winner === undefined) {
      throw new Error('one checkout should succeed')
    }
    // Exactly one git add ran, and the surviving record is finished —
    // never stranded pending by the loser's rollback.
    expect(addedFolders).toEqual([winner.folder])
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const surviving = await fresh.recordFor(winner.folder)
    expect(surviving?.isCheckoutPending).toBeUndefined()
  })

  it('releases only a finished checkout from the card', async () => {
    const setup = await checkoutSetup()
    const folder = path.join(setup.dataFolder, 'pr-worktrees', '51-abcdef12')
    await mkdir(folder, { recursive: true })
    const reserved = await setup.records.reserve({
      folder,
      repositoryRoot: setup.repositoryRoot,
      createdAt: 2000,
      checkoutId: 'pending-checkout',
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
    if (!reserved.ok) {
      throw new Error('reserve refused')
    }
    // The card has nothing to show for a checkout still being written…
    expect(await setup.checkout.trustTicket(folder)).toBeUndefined()
    // …and a ticket forged for it releases nothing.
    const forged: TrustTicket = {
      folder,
      checkoutId: 'pending-checkout',
      revision: recordRevision(reserved.stored),
      headSha: CAPTURED_PULL_FORK.head.sha,
      folderIdentity: 'any',
      pullRequest: reserved.stored.pullRequest ?? CAPTURED_ORIGIN,
    }
    expect(await setup.checkout.releaseHold(forged)).toEqual({
      ok: false,
      reason: UI_TEXT.gitOperationChanged,
    })
    const untouched = await setup.records.recordFor(folder)
    expect(untouched?.trustConfirmedAt).toBeUndefined()
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
    const folder = path.join(
      path.dirname(setup.repositoryRoot),
      `${path.basename(setup.repositoryRoot)}.worktrees`,
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
    expect(holdForRoots([result.folder], setup.heldRoots, records, process.platform)?.folder).toBe(
      slashedPath(result.folder),
    )
    // Both roots are consulted: a worktree the other editor made holds too.
    const vscodeRoot = setup.heldRoots[0]
    if (vscodeRoot === undefined) {
      throw new Error('held roots missing')
    }
    const vscodeFolder = `${vscodeRoot}/51-abcdef12`
    const vscodeReserved = await setup.records.reserve({
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
    expect(vscodeReserved.ok).toBe(true)
    expect(
      holdForRoots([vscodeFolder], setup.heldRoots, await setup.records.list(), process.platform)
        ?.folder,
    ).toBe(slashedPath(vscodeFolder))
    const ticket = await ticketFor(setup.checkout, result.folder)
    expect(ticket.pullRequest.number).toBe(51)
    const released = await setup.checkout.releaseHold(ticket)
    expect(released).toEqual({ ok: true })
    expect(
      holdForRoots([result.folder], setup.heldRoots, await setup.records.list(), process.platform),
    ).toBeUndefined()
    expect(await setup.checkout.trustTicket(`${result.folder}-missing`)).toBeUndefined()
  })

  it('consumes a trust ticket once, for the very folder the checkout finished in', async () => {
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    if (!result.ok) {
      throw new Error('checkout failed')
    }
    const ticket = await ticketFor(setup.checkout, result.folder)
    // The folder made again at the same path is not the folder the user saw.
    await rm(result.folder, { recursive: true, force: true })
    await mkdir(result.folder)
    expect(await setup.checkout.releaseHold(ticket)).toEqual({
      ok: false,
      reason: UI_TEXT.gitOperationChanged,
    })
    expect(await setup.checkout.trustTicket(result.folder)).toBeUndefined()
    const held = await setup.records.recordFor(result.folder)
    expect(held?.trustConfirmedAt).toBeUndefined()
  })

  it('never lets a stale trust card release a replacement checkout', async () => {
    // RVM123P3 finding 3: the card shows checkout A; another window removes
    // A and finishes B at the same folder before A's confirmation arrives.
    let stamp = 1000
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      now: () => {
        stamp += 1000
        return stamp
      },
    })
    const first = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    const cardForA = await ticketFor(setup.checkout, first.folder)
    await rm(first.folder, { recursive: true, force: true })
    const second = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(second.ok).toBe(true)
    const replacement = await setup.records.recordFor(first.folder)
    expect(replacement?.checkoutId).not.toBe(cardForA.checkoutId)
    expect(replacement?.isCheckoutPending).toBeUndefined()
    // A's confirmation, delivered late, releases nothing.
    expect(await setup.checkout.releaseHold(cardForA)).toEqual({
      ok: false,
      reason: UI_TEXT.gitOperationChanged,
    })
    const after = await setup.records.recordFor(first.folder)
    expect(after?.trustConfirmedAt).toBeUndefined()
    expect(
      holdForRoots([first.folder], setup.heldRoots, await setup.records.list(), process.platform)
        ?.folder,
    ).toBe(slashedPath(first.folder))
    // Its own card, used once, does; used again, nothing more happens.
    const cardForB = await ticketFor(setup.checkout, first.folder)
    expect(await setup.checkout.releaseHold(cardForB)).toEqual({ ok: true })
    const replayed = await setup.checkout.releaseHold(cardForB)
    expect(replayed.ok).toBe(false)
  })

  it('never restores the displaced trust when a replacement fails with files left', async () => {
    // RVM123P3 finding 2: a trusted checkout's folder is removed, the
    // updated pull request is checked out at the same folder, and that
    // checkout fails after a foreign file landed (its cleanup could not
    // remove it).
    let isFailing = false
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      checkOutHeld: async (folder) => {
        await mkdir(folder, { recursive: true })
        if (!isFailing) {
          return
        }

        await writeFile(path.join(folder, 'foreign.txt'), 'not yet trusted')
        throw new Error('cancelled after the first file')
      },
    })
    const first = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    expect(await isTrustedInCard(setup.checkout, first.folder)).toBe(true)
    await rm(first.folder, { recursive: true, force: true })
    isFailing = true
    const replacement = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(replacement.ok).toBe(false)
    const record = await setup.records.recordFor(first.folder)
    // Still pending and unconfirmed: held, never offered, never trusted.
    expect(record?.isCheckoutPending).toBe(true)
    expect(record?.trustConfirmedAt).toBeUndefined()
    expect(
      holdForRoots([first.folder], setup.heldRoots, await setup.records.list(), process.platform)
        ?.folder,
    ).toBe(slashedPath(first.folder))
    expect(await setup.checkout.trustTicket(first.folder)).toBeUndefined()
    // The next open refuses the folder rather than offering it.
    const again = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(again.ok).toBe(false)
  })

  it('discards a failed replacement whose folder is gone, restoring nothing', async () => {
    let isFailing = false
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      checkOutHeld: async (folder) => {
        if (isFailing) {
          throw new Error('the worktree could not be added')
        }
        await mkdir(folder, { recursive: true })
      },
    })
    const first = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    expect(await isTrustedInCard(setup.checkout, first.folder)).toBe(true)
    await rm(first.folder, { recursive: true, force: true })
    isFailing = true
    const replacement = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(replacement.ok).toBe(false)
    // No record at all: the hold by location applies, and no trust survives.
    expect(await setup.records.recordFor(first.folder)).toBeUndefined()
  })

  it('keeps a failed checkout pending until a writer still in flight has stopped', async () => {
    // RVM123P3 finding 4, at the service: the git port hands back the
    // cleanup that waits for the writer.
    const writerStopped = deferred()
    const cleanedUp = deferred()
    const cleanupAfterWriter = async (folder: string) => {
      await writerStopped.promise
      await rm(folder, { recursive: true, force: true })
      cleanedUp.resolve()
    }
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      checkOutHeld: async (folder) => {
        await mkdir(folder, { recursive: true })
        throw new CleanupPendingError(
          new Error('the batch passed its deadline'),
          cleanupAfterWriter(folder),
        )
      },
    })
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    const folder = setup.git.calls.checkedOutHeld[0]?.folder ?? ''
    const quarantined = await setup.records.recordFor(folder)
    expect(quarantined?.isCheckoutPending).toBe(true)
    writerStopped.resolve()
    await cleanedUp.promise
    let remaining: WorktreeRecord | undefined = quarantined
    for (let attempt = 1; remaining !== undefined && attempt <= 50; attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
      remaining = await setup.records.recordFor(folder)
    }
    expect(remaining).toBeUndefined()
  })

  it('takes over a pending checkout whose process is gone', async () => {
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const gonePid = await exitedProcessId()
    const folder = heldFolderOf(setup.dataFolder, 51)
    const stranded = await setup.records.reserve({
      folder,
      repositoryRoot: setup.repositoryRoot,
      createdAt: 1000,
      checkoutId: 'crashed-checkout',
      pendingOwner: { host: hostnameOf(), pid: gonePid, processStart: 1 },
      pullRequest: CAPTURED_ORIGIN,
      isHeld: true,
      isCheckoutPending: true,
    })
    expect(stranded.ok).toBe(true)
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(true)
    const record = await setup.records.recordFor(folder)
    expect(record?.checkoutId).not.toBe('crashed-checkout')
    expect(record?.isCheckoutPending).toBeUndefined()
  })

  it('never takes over a pending checkout whose process still runs', async () => {
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const folder = heldFolderOf(setup.dataFolder, 51)
    const live = await setup.records.reserve({
      folder,
      repositoryRoot: setup.repositoryRoot,
      createdAt: 1000,
      checkoutId: 'live-checkout',
      pendingOwner: await currentProcessOwner(),
      pullRequest: CAPTURED_ORIGIN,
      isHeld: true,
      isCheckoutPending: true,
    })
    expect(live.ok).toBe(true)
    expect(await setup.checkout.open('51', OWN_REMOTES, 'origin')).toEqual({
      ok: false,
      reason: UI_TEXT.gitOperationChanged,
    })
    expect(setup.git.calls.checkedOutHeld).toHaveLength(0)
  })

  it('takes over a pending checkout whose process id now names another process', async () => {
    // RVM123P4 finding 4: the checkout crashed before its folder existed and
    // the system gave its id to a live, unrelated process.
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const folder = heldFolderOf(setup.dataFolder, 51)
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      windowsHide: true,
    })
    const exited = new Promise((resolve) => {
      live.once('exit', resolve)
    })
    try {
      const stranded = await setup.records.reserve({
        folder,
        repositoryRoot: setup.repositoryRoot,
        createdAt: 1000,
        checkoutId: 'crashed-checkout',
        pendingOwner: { host: hostnameOf(), pid: live.pid ?? 0, processStart: Date.now() - 60_000 },
        pullRequest: CAPTURED_ORIGIN,
        isHeld: true,
        isCheckoutPending: true,
      })
      expect(stranded.ok).toBe(true)
      const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
      expect(result.ok).toBe(true)
      const record = await setup.records.recordFor(folder)
      expect(record?.checkoutId).not.toBe('crashed-checkout')
      expect(record?.isCheckoutPending).toBeUndefined()
    } finally {
      live.kill('SIGKILL')
      await exited
    }
  })

  it('recovers a pending checkout whose folder never appeared within the bound', async () => {
    // RVM123P4 finding 4's bound: however alive its process id looks, a
    // checkout pending this long without its folder crashed long ago.
    const setup = await checkoutSetup({ headSha: CAPTURED_PULL_FORK.head.sha })
    const folder = heldFolderOf(setup.dataFolder, 51)
    const stranded = await setup.records.reserve({
      folder,
      repositoryRoot: setup.repositoryRoot,
      createdAt: 2000 - PENDING_CHECKOUT_RECOVERY_MS - 1,
      checkoutId: 'stranded-checkout',
      pendingOwner: await currentProcessOwner(),
      pullRequest: CAPTURED_ORIGIN,
      isHeld: true,
      isCheckoutPending: true,
    })
    expect(stranded.ok).toBe(true)
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(true)
    const record = await setup.records.recordFor(folder)
    expect(record?.checkoutId).not.toBe('stranded-checkout')
  })

  it('drops its reservation when the held folder was someone else’s all along', async () => {
    const setup = await checkoutSetup({
      headSha: CAPTURED_PULL_FORK.head.sha,
      checkOutHeld: async (folder) => {
        await mkdir(folder, { recursive: true })
        throw new HeldFolderTakenError(folder)
      },
    })
    const result = await setup.checkout.open('51', OWN_REMOTES, 'origin')
    expect(result.ok).toBe(false)
    const folder = setup.git.calls.checkedOutHeld[0]?.folder ?? ''
    // Nothing of this checkout's is there: no pending record strands it.
    expect(await setup.records.recordFor(folder)).toBeUndefined()
    expect(existsSync(folder)).toBe(true)
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
  const heldOrigin = {
    repository: 'RandyNorthrup/muse-spark-code',
    number: 51,
    url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
    title: 'A foreign pull request',
    author: 'Piangpi1997',
    headSha: CAPTURED_PULL_FORK.head.sha,
    isAuthoredByUser: false,
  } as const

  /** A ticket as the card would hand it back for `record`. */
  function cardTicket(record: WorktreeRecord, folderIdentity = 'dev:1'): TrustTicket {
    return {
      folder: record.folder,
      checkoutId: record.checkoutId ?? '',
      revision: recordRevision(record),
      headSha: record.pullRequest?.headSha ?? '',
      folderIdentity,
      pullRequest: { ...heldOrigin },
    }
  }

  it('reserves, completes, discards and releases records', async () => {
    const store = createMemoryWorktreeRecordStore(process.platform)
    const record = {
      folder: '/data/pr-worktrees/51-abcdef12',
      repositoryRoot: '/repo',
      createdAt: 2000,
      checkoutId: 'checkout-a',
      pullRequest: { ...heldOrigin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    const reserved = await store.reserve({ ...record })
    if (!reserved.ok) {
      throw new Error('reserve refused')
    }
    expect(reserved.stored.revision).toBe(1)
    // A second reserve never replaces the first checkout's record.
    const rival = await store.reserve({ ...record, checkoutId: 'checkout-b' })
    expect(rival.ok ? undefined : rival.current?.checkoutId).toBe('checkout-a')
    // Only the reserved version completes.
    expect(
      await store.complete(record.folder, { checkoutId: 'checkout-a', revision: 9 }, 'd:1'),
    ).toBe(false)
    expect(
      await store.complete(record.folder, { checkoutId: 'checkout-b', revision: 1 }, 'd:1'),
    ).toBe(false)
    expect(await store.complete(record.folder, versionOf(reserved.stored), 'dev:1')).toBe(true)
    const completed = await store.recordFor(record.folder)
    if (completed === undefined) {
      throw new Error('record missing')
    }
    expect(completed.isCheckoutPending).toBeUndefined()
    expect(completed.revision).toBe(2)
    expect(completed.folderIdentity).toBe('dev:1')
    // A stale completer that lost re-reads: its version no longer matches.
    expect(await store.complete(record.folder, versionOf(reserved.stored), 'dev:1')).toBe(false)
    // Only a pending checkout is ever discarded.
    expect(await store.discard(record.folder, versionOf(completed))).toBe(false)
    // A ticket for another identity, head or revision releases nothing.
    expect(await store.release(cardTicket(completed, 'dev:2'), 3000)).toBeUndefined()
    expect(
      await store.release({ ...cardTicket(completed), headSha: '0'.repeat(40) }, 3000),
    ).toBeUndefined()
    expect(await store.release({ ...cardTicket(completed), revision: 1 }, 3000)).toBeUndefined()
    const released = await store.release(cardTicket(completed), 3000)
    expect(released?.isHeld).toBe(false)
    expect(released?.trustConfirmedAt).toBe(3000)
    // Single use.
    expect(await store.release(cardTicket(completed), 3001)).toBeUndefined()
    expect(
      await store.release({ ...cardTicket(completed), folder: `${record.folder}-missing` }, 3000),
    ).toBeUndefined()
  })

  it('refuses a release for a checkout still pending', async () => {
    const store = createMemoryWorktreeRecordStore(process.platform)
    const folder = '/data/pr-worktrees/51-abcdef12'
    const reserved = await store.reserve({
      folder,
      repositoryRoot: '/repo',
      createdAt: 2000,
      checkoutId: 'checkout-a',
      folderIdentity: 'dev:1',
      pullRequest: { ...heldOrigin },
      isHeld: true,
      isCheckoutPending: true,
    })
    if (!reserved.ok) {
      throw new Error('reserve refused')
    }
    // Trust always lands on the finished checkout the user saw, never on
    // one still being written.
    expect(await store.release(cardTicket(reserved.stored), 3000)).toBeUndefined()
    const untrusted = await store.recordFor(folder)
    expect(untrusted?.isCheckoutPending).toBe(true)
    expect(untrusted?.trustConfirmedAt).toBeUndefined()
  })

  it('supersedes only the exact version read, and never restores it', async () => {
    const store = createMemoryWorktreeRecordStore(process.platform)
    const folder = '/data/pr-worktrees/51-abcdef12'
    const ready = {
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      checkoutId: 'checkout-a',
      pullRequest: { ...heldOrigin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    const reserved = await store.reserve({ ...ready })
    if (!reserved.ok) {
      throw new Error('reserve refused')
    }
    expect(await store.complete(folder, versionOf(reserved.stored), 'dev:1')).toBe(true)
    const completed = await store.recordFor(folder)
    if (completed === undefined) {
      throw new Error('record missing')
    }
    expect(await store.release(cardTicket(completed), 1500)).toBeDefined()
    const finished = await store.recordFor(folder)
    if (finished === undefined) {
      throw new Error('record missing')
    }
    // A stale version never takes over the finished checkout.
    const stale = await store.supersede(
      folder,
      { checkoutId: 'checkout-a', revision: 1 },
      { ...ready, checkoutId: 'checkout-b', createdAt: 2000 },
    )
    expect(stale.ok).toBe(false)
    const kept = await store.recordFor(folder)
    expect(kept?.trustConfirmedAt).toBe(1500)
    // The version read does: pending, unconfirmed, a new checkout id, and
    // nothing of the old trust or folder identity carried over.
    const takeover = await store.supersede(folder, versionOf(finished), {
      ...ready,
      checkoutId: 'checkout-b',
      createdAt: 2000,
      trustConfirmedAt: 1500,
      folderIdentity: 'dev:1',
    })
    if (!takeover.ok) {
      throw new Error('supersede refused')
    }
    expect(takeover.stored.trustConfirmedAt).toBeUndefined()
    expect(takeover.stored.folderIdentity).toBeUndefined()
    expect(takeover.stored.isCheckoutPending).toBe(true)
    // Its checkout fails with the folder gone: the record goes, and the
    // displaced trust is never restored.
    expect(await store.discard(folder, versionOf(takeover.stored))).toBe(true)
    expect(await store.recordFor(folder)).toBeUndefined()
  })

  it('names one checkout through either separator and any case on Windows', async () => {
    const store = createMemoryWorktreeRecordStore('win32')
    const record = {
      folder: String.raw`C:\data\pr-worktrees\51-abcdef12`,
      repositoryRoot: String.raw`C:\repo`,
      createdAt: 1000,
      pullRequest: { ...heldOrigin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    const reservedWin = await store.reserve({ ...record })
    expect(reservedWin.ok).toBe(true)
    // The store keeps `/` separators; either spelling still finds it.
    expect(await store.recordFor('C:/data/pr-worktrees/51-abcdef12')).toEqual({
      ...record,
      folder: 'C:/data/pr-worktrees/51-abcdef12',
      revision: 1,
    })
    expect(await store.recordFor(String.raw`c:\DATA\PR-WORKTREES\51-ABCDEF12`)).toBeDefined()
  })

  it('never lets a stale window’s read restore trust or drop records', async () => {
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-records-'))
    const log = recordingLogger()
    const heldRoot = path.join(dataFolder, 'pr-worktrees')
    const folder = path.join(heldRoot, '51-abcdef12')
    const origin = { ...heldOrigin }
    // Window A holds a trusted checkout of the worktree.
    // The store keeps folders with `/` separators, which git accepts on
    // Windows too, so the records compare on either platform.
    const key = folder.replaceAll('\\', '/')
    const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const trusted = await windowA.reserve({
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      pullRequest: { ...origin },
      isHeld: true,
      trustConfirmedAt: 1500,
    })
    expect(trusted.ok).toBe(true)
    // The worktree is removed; window B checks out the updated pull
    // request at the same folder. A blind second reserve cannot merge
    // over A's record — B takes over exactly the version it read.
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const held = {
      folder: key,
      repositoryRoot: '/repo',
      createdAt: 2000,
      pullRequest: { ...origin },
      isHeld: true,
      isCheckoutPending: true,
    } as const
    const refused = await windowB.reserve({ ...held })
    expect(refused.ok).toBe(false)
    if (refused.ok || refused.current === undefined) {
      throw new Error('second reserve should report the trusted record')
    }
    const takeover = await windowB.supersede(folder, versionOf(refused.current), { ...held })
    expect(takeover.ok).toBe(true)
    // Window B records an unrelated checkout too.
    const otherFolder = path.join(heldRoot, '56-fedcba98')
    const other = await windowB.reserve({
      folder: otherFolder,
      repositoryRoot: '/repo',
      createdAt: 2000,
      pullRequest: { ...origin, number: 56 },
      isHeld: true,
      isCheckoutPending: true,
    })
    expect(other.ok).toBe(true)
    // The stale window's old trust grant can never be written back: the
    // reserve for it refuses against the fresh state.
    const stale = await windowA.reserve({
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      pullRequest: { ...origin },
      isHeld: true,
      trustConfirmedAt: 1500,
    })
    expect(stale.ok).toBe(false)
    // A subsequent read in the stale window sees the new record, and —
    // reads never write — the file keeps B's unconfirmed pending
    // checkout and the unrelated record.
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    expect(await windowA.recordFor(folder)).toEqual({ ...held, revision: 2 })
    expect(await fresh.recordFor(folder)).toEqual({ ...held, revision: 2 })
    expect(await fresh.recordFor(otherFolder)).toBeDefined()
    expect(holdForRoots([folder], [heldRoot], await fresh.list(), process.platform)?.folder).toBe(
      key,
    )
  })

  it('merges concurrent file mutations instead of losing them', async () => {
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'm123p-records-race-'))
    const log = recordingLogger()
    const heldRoot = path.join(dataFolder, 'pr-worktrees')
    const folder = path.join(heldRoot, '51-abcdef12')
    const windowA = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const windowB = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    // Window A holds the old trusted record.
    const trusted = await windowA.reserve({
      folder,
      repositoryRoot: '/repo',
      createdAt: 1000,
      pullRequest: { ...heldOrigin },
      isHeld: true,
      trustConfirmedAt: 1500,
    })
    expect(trusted.ok).toBe(true)
    // Window B replaces it with a new pending checkout while window A
    // adds an unrelated record: the two mutations race the same file.
    const otherFolder = path.join(heldRoot, '56-fedcba98')
    const [replaced, added] = await Promise.all([
      windowB.supersede(
        folder,
        { checkoutId: undefined, revision: 1 },
        {
          folder,
          repositoryRoot: '/repo',
          createdAt: 2000,
          pullRequest: { ...heldOrigin },
          isHeld: true,
          isCheckoutPending: true,
        },
      ),
      windowA.reserve({
        folder: otherFolder,
        repositoryRoot: '/repo',
        createdAt: 2000,
        pullRequest: { ...heldOrigin, number: 56 },
        isHeld: true,
        isCheckoutPending: true,
      }),
    ])
    expect(replaced.ok).toBe(true)
    expect(added.ok).toBe(true)
    // Whichever mutation won the file first, the final registry keeps
    // B's unconfirmed pending checkout and A's unrelated record — the
    // old trust grant is never restored, and no record is dropped.
    const fresh = createFileWorktreeRecordStore(dataFolder, process.platform, log)
    const current = await fresh.recordFor(folder)
    expect(current?.isCheckoutPending).toBe(true)
    expect(current?.trustConfirmedAt).toBeUndefined()
    expect(await fresh.recordFor(otherFolder)).toBeDefined()
  })
})

// A root that answers nothing, with a helper holding the root's stdout
// open past the root's death, as a git transport can.
const BATCH_ROOT_WITH_HELPER = [
  "const { spawn } = require('node:child_process');",
  "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'ignore'] });",
  'helper.unref();',
  "require('node:fs').writeFileSync(process.env['M123P_HELPER_PID_FILE'], String(helper.pid));",
  'process.stdin.resume();',
  'setTimeout(() => {}, 60000);',
].join('\n')

function unreadableBatchAnswers(): BlobAnswers {
  return new BlobAnswers(
    [{ path: 'README.md', kind: 'file', oid: '0'.repeat(40), size: 1 }],
    () => Promise.resolve(),
    () => new Error('unreadable'),
  )
}

async function batchHelperPidOf(pidFile: string): Promise<number | undefined> {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      const pid = Number(await readFile(pidFile, 'utf8'))
      if (Number.isSafeInteger(pid)) {
        return pid
      }
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
  return undefined
}

function isBatchPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('pull request batch child (M123 lane P)', () => {
  it('ends the batch past its deadline and stops the helper tree', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'm123p-batch-'))
    const pidFile = path.join(dir, 'helper.pid')
    const child = spawn(process.execPath, ['-e', BATCH_ROOT_WITH_HELPER], {
      cwd: dir,
      env: { ...process.env, M123P_HELPER_PID_FILE: pidFile },
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    child.stderr.resume()
    const helperPid = await batchHelperPidOf(pidFile)
    expect(helperPid).toBeDefined()
    if (helperPid === undefined) {
      child.kill('SIGKILL')
      throw new Error('the helper never started')
    }
    expect(isBatchPidAlive(helperPid)).toBe(true)
    const started = Date.now()
    await expect(
      runBatchChild(child, unreadableBatchAnswers(), {
        deadlineMs: 300,
        killGraceMs: 1000,
        drainGraceMs: 1000,
        platform: process.platform,
        signal: new AbortController().signal,
        writers: new HeldWriters(),
      }),
    ).rejects.toThrow()
    // Settled by its own deadline, not by the pipes the helper held.
    expect(Date.now() - started).toBeLessThan(5000)
    try {
      if (process.platform !== 'win32') {
        for (let attempt = 1; isBatchPidAlive(helperPid) && attempt <= 40; attempt += 1) {
          await new Promise((resolve) => {
            setTimeout(resolve, 50)
          })
        }
        expect(isBatchPidAlive(helperPid)).toBe(false)
      }
    } finally {
      try {
        process.kill(helperPid, 'SIGKILL')
      } catch {
        // The deadline already stopped it.
      }
      child.kill('SIGKILL')
    }
  })

  it('settles a running batch on abort instead of hanging', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'm123p-batch-abort-'))
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      cwd: dir,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    child.stderr.resume()
    const controller = new AbortController()
    const run = runBatchChild(child, unreadableBatchAnswers(), {
      deadlineMs: 60_000,
      killGraceMs: 1000,
      drainGraceMs: 1000,
      platform: process.platform,
      signal: controller.signal,
      writers: new HeldWriters(),
    })
    const started = Date.now()
    setTimeout(() => {
      controller.abort()
    }, 200)
    await expect(run).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(5000)
    child.kill('SIGKILL')
  })

  it('invalidates the writer in flight at the deadline and waits for it before failing', async () => {
    // RVM123P3 finding 4: the deadline must retire an in-flight writer
    // before cleanup, so it can never publish after the failure.
    const { child, blobs } = oneAnswerBatch()
    const writers = new HeldWriters()
    const writerHeld = deferred()
    const events: string[] = []
    const published: string[] = []
    const answers = new BlobAnswers(
      blobs,
      (entry) =>
        writers.run(async () => {
          events.push('writer started')
          await writerHeld.promise
          // What every real publisher asks before each step on disk.
          writers.check()
          published.push(entry.path)
        }),
      () => new Error('unreadable'),
    )
    const running = runBatchChild(child, answers, {
      deadlineMs: 200,
      killGraceMs: 1000,
      drainGraceMs: 3000,
      platform: process.platform,
      signal: new AbortController().signal,
      writers,
    })
    const outcome = (async () => {
      const result = await settled(running)
      events.push('failed')
      return result
    })()
    try {
      await new Promise((resolve) => {
        setTimeout(resolve, 700)
      })
      // Past the deadline, the failure waits for the writer in flight.
      expect(events).toEqual(['writer started'])
      writerHeld.resolve()
      const error = await outcome
      expect(events).toEqual(['writer started', 'failed'])
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(CleanupPendingError)
      // Invalidated before it resumed: it published nothing.
      expect(published).toEqual([])
    } finally {
      writerHeld.resolve()
      child.kill('SIGKILL')
    }
  })

  it('hands the cleanup to a writer that outlives its grace', async () => {
    const { child, blobs } = oneAnswerBatch()
    const writers = new HeldWriters()
    const writerHeld = deferred()
    const published: string[] = []
    const answers = new BlobAnswers(
      blobs,
      (entry) =>
        writers.run(async () => {
          await writerHeld.promise
          writers.check()
          published.push(entry.path)
        }),
      () => new Error('unreadable'),
    )
    try {
      const error = await settled(
        runBatchChild(child, answers, {
          deadlineMs: 200,
          killGraceMs: 1000,
          drainGraceMs: 100,
          platform: process.platform,
          signal: new AbortController().signal,
          writers,
        }),
      )
      if (!(error instanceof CleanupPendingError)) {
        throw new Error('expected the cleanup to wait for the writer')
      }
      let isSettled = false
      const watching = (async () => {
        await error.settled
        isSettled = true
      })()
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      expect(isSettled).toBe(false)
      writerHeld.resolve()
      await watching
      expect(isSettled).toBe(true)
      expect(published).toEqual([])
    } finally {
      writerHeld.resolve()
      child.kill('SIGKILL')
    }
  })
})

describe('runtime pull request checkout on the fixture repositories (M123 lane P)', () => {
  let fixtures: FixtureRepositories
  let gitPath: string

  beforeAll(async () => {
    fixtures = createFixtureRepositories(await mkdtemp(path.join(tmpdir(), 'm123p-fixtures-')))
    const resolved = resolveExecutable('git', {
      platform: process.platform,
      pathVariable: process.env['PATH'],
      fileExists: existsSync,
    })
    if (resolved === undefined) {
      throw new Error('git is not on PATH')
    }
    gitPath = resolved
  })

  function git(cwd: string, ...args: string[]): string {
    return execFileSync(gitPath, args, { cwd, env: fixtures.environment, encoding: 'utf8' }).trim()
  }

  async function fixtureSetup(
    kind: 'own' | 'held',
    options: {
      readonly signal?: AbortSignal
      readonly batchDeadlineMs?: number
      readonly createFile?: typeof createFileExclusively
    } = {},
  ): Promise<{
    checkout: RuntimePullRequestCheckout
    opened: string[]
    dataFolder: string
    sha: string
    records: ReturnType<typeof createMemoryWorktreeRecordStore>
    heldRoots: readonly string[]
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
    const records = createMemoryWorktreeRecordStore(process.platform)
    const heldRoots = [
      heldWorktreesRoot(storageRoot, process.platform),
      heldWorktreesRoot(dataFolder, process.platform),
    ]
    const signal = options.signal ?? deps.signal
    const checkout = new RuntimePullRequestCheckout({
      ...deps,
      repositoryRoot,
      dataFolder,
      tokenSources: [
        fakeTokenSource('deviceFlow', { bearer: CANARY, isSignedIn: true, fetch: github.fetch }),
      ],
      platform: process.platform,
      now: () => 2000,
      confirm: () => Promise.resolve(true),
      openFolder: (folder) => {
        opened.push(folder)
        return Promise.resolve()
      },
      baseUrl: 'https://api.github.test',
      log,
      signal,
      records,
      heldRoots,
      git: createNodePullRequestCheckoutGit({
        gitPath,
        userEnv: pullRequestFetchEnvironment({ ...fixtures.environment }),
        quietEnv: quietPullRequestEnvironment({ ...fixtures.environment }),
        platform: process.platform,
        signal,
        log,
        ...(options.batchDeadlineMs !== undefined && { batchDeadlineMs: options.batchDeadlineMs }),
        ...(options.createFile !== undefined && { createFile: options.createFile }),
      }),
      pathExists: (fsPath) => existsSync(fsPath),
    } satisfies RuntimeCheckoutDeps)
    return { checkout, opened, dataFolder, sha, records, heldRoots }
  }

  const FORK_REMOTES = [
    { name: 'origin', repository: { owner: 'Piangpi1997', name: 'muse-spark-code' } },
    { name: 'upstream', repository: OWN },
  ]

  it('removes a held checkout cancelled after its first file and restores no trust', async () => {
    // RVM123P3 finding 2 on the real runner: a trusted checkout's folder
    // is gone, the pull request is checked out again at the same folder,
    // and Cancel lands right after the first foreign file is published.
    const controller = new AbortController()
    let isCancelling = false
    const setup = await fixtureSetup('held', {
      signal: controller.signal,
      createFile: async (target, content, fileOptions) => {
        await createFileExclusively(target, content, fileOptions)
        if (isCancelling) {
          controller.abort()
        }
      },
    })
    const first = await setup.checkout.open('51', FORK_REMOTES, 'origin')
    if (!first.ok) {
      throw new Error('first checkout failed')
    }
    expect(await isTrustedInCard(setup.checkout, first.folder)).toBe(true)
    git(fixtures.fork, 'worktree', 'remove', '--force', first.folder)
    isCancelling = true
    const replacement = await setup.checkout.open('51', FORK_REMOTES, 'origin')
    expect(replacement.ok).toBe(false)
    // Cleaned up despite Cancel, and nothing restored the old trust.
    expect(existsSync(first.folder)).toBe(false)
    expect(await setup.records.recordFor(first.folder)).toBeUndefined()
    expect(
      holdForRoots([first.folder], setup.heldRoots, await setup.records.list(), process.platform),
    ).toBeDefined()
  })

  it('waits for a file writer in flight past the batch deadline, then cleans up', async () => {
    // RVM123P3 finding 4 on the real runner: the first file's writer is
    // held on a slow disk while the batch's deadline passes.
    const writerHeld = deferred()
    const writerReached = deferred()
    const setup = await fixtureSetup('held', {
      batchDeadlineMs: 300,
      createFile: async (target, content, fileOptions) => {
        writerReached.resolve()
        await writerHeld.promise
        await createFileExclusively(target, content, fileOptions)
      },
    })
    const opening = setup.checkout.open('51', FORK_REMOTES, 'origin')
    try {
      await writerReached.promise
      await new Promise((resolve) => {
        setTimeout(resolve, 700)
      })
      // Past the deadline: the record stays pending (held) while the
      // writer is in flight, and nothing has been cleaned up under it.
      const [pending] = await setup.records.list()
      expect(pending?.isCheckoutPending).toBe(true)
      writerHeld.resolve()
      const result = await opening
      expect(result.ok).toBe(false)
      // Drained, then cleaned up: no foreign file, no folder, no record.
      expect(existsSync(pending?.folder ?? '')).toBe(false)
      expect(await setup.records.list()).toEqual([])
    } finally {
      writerHeld.resolve()
      await opening
    }
  })

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

  function heldRunner(): PullRequestCheckoutGit {
    return createNodePullRequestCheckoutGit({
      gitPath,
      userEnv: pullRequestFetchEnvironment({ ...fixtures.environment }),
      quietEnv: quietPullRequestEnvironment({ ...fixtures.environment }),
      platform: process.platform,
      signal: new AbortController().signal,
      log: recordingLogger(),
    })
  }

  it('never deletes a folder another process puts at the destination before git adds it', async () => {
    // RVM123P4 finding 1: the destination is free when the checkout looks,
    // another process puts a populated folder there, and git refuses to
    // add over it. The cleanup must not delete what this checkout never made.
    const { folder, foreign } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    let calls = 0
    const check = () => {
      calls += 1
      // The last owner check before the worktree is added (two per hook
      // listing, one before the tree listing): the other process's folder
      // lands right after it, before git looks.
      if (calls === LAST_CHECK_BEFORE_ADD) {
        queueMicrotask(() => {
          mkdirSync(folder, { recursive: true })
          writeFileSync(foreign, FOREIGN_TEXT)
        })
      }
    }
    await expect(heldRunner().checkOutHeld(folder, sha, fixtures.fork, check)).rejects.toThrow()
    expect(readFileSync(foreign, 'utf8')).toBe(FOREIGN_TEXT)
    const worktrees = git(fixtures.fork, 'worktree', 'list', '--porcelain')
    expect(worktrees.replaceAll('\\', '/')).not.toContain(slashedPath(folder))
  })

  it('never deletes a folder put in place of the worktree while the checkout ran', async () => {
    // RVM123P4 finding 1, the replacement case: the worktree is moved away
    // and another folder put at its name before the checkout fails.
    const { folder, foreign } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    let isSwapped = false
    const check = () => {
      if (isSwapped || !existsSync(path.join(folder, '.git'))) {
        return
      }
      isSwapped = true
      renameSync(folder, `${folder}-moved`)
      mkdirSync(folder)
      writeFileSync(foreign, FOREIGN_TEXT)
      throw new Error('cancelled while the folder was replaced')
    }
    await expect(heldRunner().checkOutHeld(folder, sha, fixtures.fork, check)).rejects.toThrow(
      /cancelled/u,
    )
    expect(readFileSync(foreign, 'utf8')).toBe(FOREIGN_TEXT)
  })

  it('never deletes what another process drops into the claimed folder before git adds it', async () => {
    // RVM123P4 finding 1, inside the claim: the folder is this checkout's,
    // but git refuses it once another process wrote into it. Only an empty
    // folder of this checkout's own is ever removed when git added nothing.
    const { folder, foreign } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    let calls = 0
    const check = () => {
      calls += 1
      if (calls === LAST_CHECK_BEFORE_ADD + 1) {
        writeFileSync(foreign, FOREIGN_TEXT)
      }
    }
    await expect(heldRunner().checkOutHeld(folder, sha, fixtures.fork, check)).rejects.toThrow()
    expect(readFileSync(foreign, 'utf8')).toBe(FOREIGN_TEXT)
    const worktrees = git(fixtures.fork, 'worktree', 'list', '--porcelain')
    expect(worktrees.replaceAll('\\', '/')).not.toContain(slashedPath(folder))
  })

  it('removes a claimed folder git never used when the checkout is cancelled', async () => {
    const { folder } = await raceFolder()
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    let calls = 0
    const check = () => {
      calls += 1
      if (calls === LAST_CHECK_BEFORE_ADD + 1) {
        throw new Error('cancelled before git added the worktree')
      }
    }
    await expect(heldRunner().checkOutHeld(folder, sha, fixtures.fork, check)).rejects.toThrow(
      /cancelled/u,
    )
    expect(existsSync(folder)).toBe(false)
    expect(readdirSync(path.dirname(folder))).toEqual([])
  })

  it('leaves a folder already at the destination alone', async () => {
    const { folder, foreign } = await raceFolder()
    mkdirSync(folder, { recursive: true })
    writeFileSync(foreign, FOREIGN_TEXT)
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    await expect(
      heldRunner().checkOutHeld(folder, sha, fixtures.fork, uncancelledCheck),
    ).rejects.toBeInstanceOf(HeldFolderTakenError)
    expect(readFileSync(foreign, 'utf8')).toBe(FOREIGN_TEXT)
    const worktrees = git(fixtures.fork, 'worktree', 'list', '--porcelain')
    expect(worktrees.replaceAll('\\', '/')).not.toContain(slashedPath(folder))
  })

  it('removes its own failed held checkout whole, and nothing beside it', async () => {
    const { folder } = await raceFolder()
    const sibling = path.join(path.dirname(folder), '52-sibling')
    mkdirSync(sibling, { recursive: true })
    writeFileSync(path.join(sibling, 'kept.txt'), FOREIGN_TEXT)
    const sha = git(fixtures.fork, 'rev-parse', 'HEAD')
    const check = () => {
      if (!existsSync(path.join(folder, '.git'))) {
        return
      }
      throw new Error('cancelled after the worktree was added')
    }
    await expect(heldRunner().checkOutHeld(folder, sha, fixtures.fork, check)).rejects.toThrow(
      /cancelled/u,
    )
    expect(existsSync(folder)).toBe(false)
    expect(readdirSync(path.dirname(folder))).toEqual(['52-sibling'])
    expect(readFileSync(path.join(sibling, 'kept.txt'), 'utf8')).toBe(FOREIGN_TEXT)
  })

  it('stops the fetch and the held batch on cancel instead of hanging', async () => {
    const log = recordingLogger()
    const runner = createNodePullRequestCheckoutGit({
      gitPath,
      userEnv: pullRequestFetchEnvironment({ ...fixtures.environment }),
      quietEnv: quietPullRequestEnvironment({ ...fixtures.environment }),
      platform: process.platform,
      signal: AbortSignal.abort(),
      log,
    })
    // A fetch that would succeed against the fixture's origin is refused
    // before git starts, and the held batch never spawns its child.
    await expect(runner.fetch(fixtures.own, 'origin', 'feature', uncancelledCheck)).rejects.toThrow(
      /abort/iu,
    )
    const sha = git(fixtures.own, 'rev-parse', 'HEAD')
    const folder = await mkdtemp(path.join(tmpdir(), 'm123p-cancelled-'))
    await expect(runner.checkOutHeld(folder, sha, fixtures.own, uncancelledCheck)).rejects.toThrow()
  })

  it('checks out someone else’s pull request held, byte for byte', async () => {
    const { checkout, opened, dataFolder, sha } = await fixtureSetup('held')
    const result = await checkout.open('51', FORK_REMOTES, 'origin')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.held).toBe(true)
    expect(result.folder.startsWith(path.join(dataFolder, 'pr-worktrees', '51-'))).toBe(true)
    expect(git(result.folder, 'rev-parse', 'HEAD')).toBe(sha)
    const worktree = git(fixtures.fork, 'worktree', 'list', '--porcelain')
    // Git spells worktree folders with `/` separators; compare slashed.
    expect(worktree.replaceAll('\\', '/')).toContain(result.folder.replaceAll('\\', '/'))
    const expected = await readFile(path.join(fixtures.fork, 'README.md'), 'utf8')
    expect(await readFile(path.join(result.folder, 'README.md'), 'utf8')).toBe(expected)
    expect(opened).toEqual([result.folder])
  })
})
